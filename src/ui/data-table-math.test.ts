import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareValues,
  hiddenFromStored,
  isFiltering,
  matchesQuery,
  nextSortState,
  parseStoredTableFilter,
  selectRows,
  sortRows,
  textOf,
  toStoredTableFilter,
  valueOf,
  type DataColumn,
} from './data-table-math.ts';

interface Run extends Record<string, unknown> {
  id: string;
  status: string;
  ms: number | null;
}

const COLUMNS: DataColumn<Run>[] = [
  { key: 'id', label: 'Run' },
  { key: 'status', label: 'Status' },
  { key: 'ms', label: 'Duration', value: (r) => r.ms, text: (r) => (r.ms == null ? '' : `${r.ms}ms`) },
];

const rows: Run[] = [
  { id: 'alpha', status: 'success', ms: 900 },
  { id: 'beta', status: 'failure', ms: 90 },
  { id: 'gamma', status: 'skipped', ms: null },
];

// -- Column value/text ---------------------------------------------------------

test('valueOf falls back to the row property, textOf to the value', () => {
  assert.equal(valueOf(rows[0]!, COLUMNS[0]!), 'alpha');
  assert.equal(textOf(rows[0]!, COLUMNS[0]!), 'alpha');
  // A column with both: sorts by number, searches by rendered text.
  assert.equal(valueOf(rows[0]!, COLUMNS[2]!), 900);
  assert.equal(textOf(rows[0]!, COLUMNS[2]!), '900ms');
  assert.equal(textOf(rows[2]!, COLUMNS[2]!), '');
});

// -- Comparison ----------------------------------------------------------------

test('compareValues orders numbers numerically, not lexically', () => {
  assert.ok(compareValues(9, 10) < 0, '9 must precede 10 (a string sort would not)');
  assert.ok(compareValues(10, 9) > 0);
  assert.equal(compareValues(5, 5), 0);
});

test('compareValues sorts nullish LAST in both directions', () => {
  // Absence is not a value. Blanks marching to the top of every descending
  // sort makes a mostly-empty column useless.
  assert.ok(compareValues(null, 1) > 0);
  assert.ok(compareValues(1, null) < 0);
  assert.ok(compareValues(undefined, 'a') > 0);
  assert.ok(compareValues('', 'a') > 0);
  assert.equal(compareValues(null, undefined), 0);
});

test('compareValues handles dates, booleans and numeric-aware strings', () => {
  assert.ok(compareValues(new Date(1), new Date(2)) < 0);
  assert.ok(compareValues(false, true) < 0);
  assert.ok(compareValues('run 9', 'run 10') < 0, 'numeric-aware collation');
});

// -- Sorting -------------------------------------------------------------------

test('sortRows is stable and leaves the input untouched', () => {
  const ties: Run[] = [
    { id: 'first', status: 'x', ms: 1 },
    { id: 'second', status: 'x', ms: 1 },
    { id: 'third', status: 'x', ms: 1 },
  ];
  const asc = sortRows(ties, COLUMNS, { key: 'ms', dir: 'asc' });
  assert.deepEqual(asc.map((r) => r.id), ['first', 'second', 'third']);
  // Descending must not reverse ties either — only the compared values flip.
  const desc = sortRows(ties, COLUMNS, { key: 'ms', dir: 'desc' });
  assert.deepEqual(desc.map((r) => r.id), ['first', 'second', 'third']);
  assert.deepEqual(ties.map((r) => r.id), ['first', 'second', 'third'], 'input array is not mutated');
});

test('sortRows uses the column value, and parks nullish last both ways', () => {
  const asc = sortRows(rows, COLUMNS, { key: 'ms', dir: 'asc' });
  assert.deepEqual(asc.map((r) => r.id), ['beta', 'alpha', 'gamma']);
  const desc = sortRows(rows, COLUMNS, { key: 'ms', dir: 'desc' });
  assert.deepEqual(desc.map((r) => r.id), ['alpha', 'beta', 'gamma'], 'the null duration stays last');
});

test('sortRows passes rows through for a null or unknown sort', () => {
  assert.deepEqual(sortRows(rows, COLUMNS, null).map((r) => r.id), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(
    sortRows(rows, COLUMNS, { key: 'nope', dir: 'asc' }).map((r) => r.id),
    ['alpha', 'beta', 'gamma'],
  );
});

test('nextSortState cycles asc -> desc -> unsorted', () => {
  const a = nextSortState(null, 'ms');
  assert.deepEqual(a, { key: 'ms', dir: 'asc' });
  const b = nextSortState(a, 'ms');
  assert.deepEqual(b, { key: 'ms', dir: 'desc' });
  // Returning to unsorted is how the producer's order (usually newest
  // first) becomes reachable again — no asc/desc pair reproduces it.
  assert.equal(nextSortState(b, 'ms'), null);
  // A different column starts its own cycle.
  assert.deepEqual(nextSortState(b, 'id'), { key: 'id', dir: 'asc' });
});

// -- Query ---------------------------------------------------------------------

test('matchesQuery requires EVERY term (AND), not any', () => {
  assert.ok(matchesQuery('manager inbox dropped', 'manager dropped'));
  assert.ok(!matchesQuery('manager inbox dropped', 'manager missing'));
  assert.ok(matchesQuery('anything', ''), 'an empty query matches everything');
  assert.ok(matchesQuery('anything', '   '));
});

// -- Selection -----------------------------------------------------------------

test('selectRows filters by query across searchable columns', () => {
  const { shown, total } = selectRows(rows, COLUMNS, { query: 'skip' });
  assert.deepEqual(shown.map((r) => r.id), ['gamma']);
  assert.equal(total, 3);
});

test('selectRows honors searchable:false and a custom searchText', () => {
  const cols: DataColumn<Run>[] = [
    { key: 'id', label: 'Run', searchable: false },
    { key: 'status', label: 'Status' },
  ];
  assert.equal(selectRows(rows, cols, { query: 'alpha' }).shown.length, 0, 'the id column is excluded from search');

  // searchText replaces the column concatenation entirely.
  const custom = selectRows(rows, cols, { query: 'alpha', searchText: (r) => r.id });
  assert.deepEqual(custom.shown.map((r) => r.id), ['alpha']);
});

test('selectRows hides facet buckets and counts across ALL rows', () => {
  const facets = [{ key: 'status', of: (r: Run) => r.status }];
  const hidden = new Map([['status', new Set(['skipped'])]]);
  const { shown, facetCounts } = selectRows(rows, COLUMNS, { facets, hidden });

  assert.deepEqual(shown.map((r) => r.id), ['alpha', 'beta']);
  // The hidden bucket must KEEP its count: the number you need to decide
  // whether to unhide is exactly the one a shown-only count would zero.
  assert.equal(facetCounts.get('status')?.get('skipped'), 1);
  assert.equal(facetCounts.get('status')?.get('success'), 1);
});

test('selectRows supports several independent facet groups', () => {
  interface Row extends Record<string, unknown> {
    sev: string;
    fam: string;
  }
  const data: Row[] = [
    { sev: 'bad', fam: 'run' },
    { sev: 'bad', fam: 'image' },
    { sev: 'info', fam: 'run' },
  ];
  const facets = [
    { key: 'severity', of: (r: Row) => r.sev },
    { key: 'family', of: (r: Row) => r.fam },
  ];
  const hidden = new Map([['family', new Set(['run'])]]);
  const { shown, facetCounts } = selectRows(data, [], { facets, hidden });

  assert.equal(shown.length, 1);
  assert.equal(shown[0]?.fam, 'image');
  // Both groups keep full counts even though one is doing the hiding.
  assert.equal(facetCounts.get('severity')?.get('bad'), 2);
  assert.equal(facetCounts.get('family')?.get('run'), 2);
});

test('selectRows ignores rows a group does not bucket', () => {
  const data = [{ k: 'a' }, { k: '' }, {}];
  const facets = [{ key: 'g', of: (r: Record<string, unknown>) => r.k as string }];
  const hidden = new Map([['g', new Set([''])]]);
  const { shown, facetCounts } = selectRows(data, [], { facets, hidden });
  // '' means "not in this group": never counted, never hidden by it.
  assert.equal(shown.length, 3);
  assert.equal(facetCounts.get('g')?.size, 1);
});

test('selectRows preserves input order (sorting is a separate step)', () => {
  const { shown } = selectRows(rows, COLUMNS, {});
  assert.deepEqual(shown.map((r) => r.id), ['alpha', 'beta', 'gamma']);
});

test('selectRows tolerates a missing row list', () => {
  assert.deepEqual(selectRows(null, COLUMNS, {}), { shown: [], facetCounts: new Map(), total: 0 });
});

test('a host-filtered group is excluded from selection by the caller', () => {
  // <data-table> drops FacetGroup.local === false groups before calling
  // selectRows: the host already applied them, upstream of its own row cap.
  // Re-applying here is how a server-filtered window gets emptied twice.
  const facets = [{ key: 'status', of: (r: Run) => r.status }];
  const hidden = new Map([['status', new Set(['success'])]]);
  const withGroup = selectRows(rows, COLUMNS, { facets, hidden });
  const withoutGroup = selectRows(rows, COLUMNS, { facets: [], hidden });
  assert.equal(withGroup.shown.length, 2);
  assert.equal(withoutGroup.shown.length, 3, 'no group declared = nothing dropped locally');
});

test('isFiltering ignores empty queries and empty hidden sets', () => {
  assert.ok(!isFiltering({}));
  assert.ok(!isFiltering({ query: '   ' }));
  assert.ok(!isFiltering({ hidden: new Map([['g', new Set()]]) }), 'an empty set is not a filter');
  assert.ok(isFiltering({ query: 'x' }));
  assert.ok(isFiltering({ hidden: new Map([['g', new Set(['a'])]]) }));
});

// -- Stored filter -------------------------------------------------------------

test('toStoredTableFilter sorts buckets and drops empty groups', () => {
  const stored = toStoredTableFilter({
    query: 'q',
    hidden: new Map([
      ['status', new Set(['skipped', 'error'])],
      ['other', new Set()],
    ]),
    sort: { key: 'ms', dir: 'desc' },
  });
  assert.deepEqual(stored, { query: 'q', hidden: { status: ['error', 'skipped'] }, sort: { key: 'ms', dir: 'desc' } });
});

test('round-tripping a stored filter preserves it', () => {
  const original = toStoredTableFilter({ query: 'x', hidden: new Map([['g', new Set(['a', 'b'])]]), sort: null });
  const parsed = parseStoredTableFilter(JSON.stringify(original));
  assert.deepEqual(parsed, original);
  assert.deepEqual(hiddenFromStored(parsed), new Map([['g', new Set(['a', 'b'])]]));
});

test('parseStoredTableFilter degrades to no-filter on anything malformed', () => {
  const empty = { query: '', hidden: {}, sort: null };
  // A corrupt or stale value must never leave a table silently hiding rows.
  for (const raw of [null, undefined, '', 'not json', '[]', '"str"', '{"hidden":5}', '{"sort":{"key":1}}']) {
    assert.deepEqual(parseStoredTableFilter(raw), empty, `raw=${String(raw)}`);
  }
  // A bad direction is dropped rather than trusted.
  assert.equal(parseStoredTableFilter('{"sort":{"key":"ms","dir":"sideways"}}').sort, null);
  // Non-string bucket entries are filtered out, the rest survives.
  assert.deepEqual(parseStoredTableFilter('{"hidden":{"g":["a",2,null,"b"]}}').hidden, { g: ['a', 'b'] });
});
