import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEVERITIES,
  familyOf,
  formatTimestamp,
  isFiltering,
  matchesQuery,
  messageOf,
  parseStoredFilter,
  selectEntries,
  severityOf,
  timeOf,
  toStoredFilter,
} from './activity-feed-math.ts';
import type { ActivityEntry } from './activity-feed-math.ts';

const entry = (kind: string, message = '', extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  time: '2026-07-31T10:00:00Z',
  kind,
  message,
  ...extra,
});

test('severity reads the action half, and rule ORDER decides the traps', () => {
  assert.equal(severityOf('manager.inbox_dropped'), 'bad');
  assert.equal(severityOf('image.build_failed'), 'bad');
  assert.equal(severityOf('reload.held_red'), 'bad', 'a red gate status is bad news, not a mere hold');

  // Order is the whole reason SEVERITY_RULES is a list: each of these
  // matches a LATER rule too, and the earlier one has to win.
  assert.equal(severityOf('hook.disabled_rejected'), 'bad', 'bad(rejected) over warn(disabled)');
  assert.equal(severityOf('reload.unverified'), 'warn', 'warn(unverified) over good(verified)');
  assert.equal(severityOf('concurrency.override_cleared'), 'good', 'good(cleared) must not trip warn(overridden)');

  assert.equal(severityOf('hook.disabled'), 'warn');
  assert.equal(severityOf('lock.ttl_reaped'), 'warn');
  assert.equal(severityOf('image.built'), 'good');
  assert.equal(severityOf('run.skipped'), 'skip');

  // Unclaimed = ordinary chatter.
  assert.equal(severityOf('run.queued'), 'info');
  assert.equal(severityOf('github.push'), 'info');
  // Degenerate kinds must not throw: no dot means no action half.
  assert.equal(severityOf('bare'), 'info');
  assert.equal(severityOf(''), 'info');
  assert.equal(severityOf(undefined as unknown as string), 'info');
});

test('family is the namespace half; folding is an explicit alias map', () => {
  assert.equal(familyOf('manager.inbox_dropped'), 'manager');
  assert.equal(familyOf('bare'), 'bare');
  assert.equal(familyOf(''), '');

  // The alias map exists because automatic plural-stripping is wrong: it
  // would fold the ordinary family "status" into "statu".
  assert.equal(familyOf('hooks.reloaded'), 'hooks', 'no folding without an explicit alias');
  assert.equal(familyOf('hooks.reloaded', { hooks: 'hook' }), 'hook');
  assert.equal(familyOf('status.changed', { hooks: 'hook' }), 'status', 'unrelated families are untouched');
});

test('a query ANDs its terms across kind, message and field values', () => {
  const e = entry('manager.inbox_dropped', 'gha-coordinator: inbox full; dropped oldest', { fields: { hook: 'gha-coordinator' } });
  assert.equal(matchesQuery(e, ''), true, 'an empty query matches everything');
  assert.equal(matchesQuery(e, '   '), true);
  assert.equal(matchesQuery(e, 'manager'), true, 'kind is searchable');
  assert.equal(matchesQuery(e, 'INBOX FULL'), true, 'case-insensitive over the message');
  assert.equal(matchesQuery(e, 'gha-coordinator'), true, 'field values are searchable');
  assert.equal(matchesQuery(e, 'manager dropped'), true, 'all terms present');
  assert.equal(matchesQuery(e, 'manager missing'), false, 'every term must match — AND, not OR');
});

test('selectEntries counts over the WHOLE input and shows only survivors', () => {
  const entries = [
    entry('manager.inbox_dropped', 'dropped'),
    entry('run.queued', 'queued'),
    entry('run.skipped', 'skipped'),
    entry('hooks.reloaded', 'reloaded'),
    entry('image.build_failed', 'boom'),
  ];

  const all = selectEntries(entries);
  assert.equal(all.shown.length, 5);
  assert.equal(all.hiddenCount, 0);
  assert.equal(all.severityCounts.get('bad'), 2);
  assert.equal(all.severityCounts.get('info'), 1);
  assert.equal(all.familyCounts.get('run'), 2);

  // Hiding a severity: counts are UNCHANGED (a chip must keep showing what
  // it hides) while shown shrinks.
  const noBad = selectEntries(entries, { hiddenSeverities: ['bad'] });
  assert.deepEqual(noBad.shown.map((e) => e.kind), ['run.queued', 'run.skipped', 'hooks.reloaded']);
  assert.equal(noBad.severityCounts.get('bad'), 2, 'the hidden bucket still counts');
  assert.equal(noBad.hiddenCount, 2);

  // Facets and the query compose.
  const both = selectEntries(entries, { hiddenSeverities: ['bad'], query: 'run' });
  assert.deepEqual(both.shown.map((e) => e.kind), ['run.queued', 'run.skipped']);

  // Family hiding, with the alias applied to the FILTER as well as counts.
  const noHook = selectEntries(entries, { hiddenFamilies: ['hook'], familyAliases: { hooks: 'hook' } });
  assert.equal(noHook.familyCounts.get('hook'), 1, 'aliased family is counted under its canonical name');
  assert.ok(!noHook.shown.some((e) => e.kind === 'hooks.reloaded'), 'hiding the canonical name hides the alias');

  // Degenerate inputs.
  assert.deepEqual(selectEntries(null).shown, []);
  assert.deepEqual(selectEntries(undefined, { query: 'x' }).shown, []);
  assert.equal(selectEntries([]).hiddenCount, 0);
});

test('input order is preserved — the producer decides sort, not the filter', () => {
  const entries = [entry('a.one'), entry('b.two'), entry('c.three')];
  assert.deepEqual(selectEntries(entries).shown.map((e) => e.kind), ['a.one', 'b.two', 'c.three']);
});

test('isFiltering distinguishes a narrowed feed from an untouched one', () => {
  assert.equal(isFiltering(), false);
  assert.equal(isFiltering({ query: '' }), false);
  assert.equal(isFiltering({ query: '   ' }), false, 'whitespace is not a filter');
  assert.equal(isFiltering({ query: 'x' }), true);
  assert.equal(isFiltering({ hiddenSeverities: [] }), false);
  assert.equal(isFiltering({ hiddenSeverities: ['bad'] }), true);
  assert.equal(isFiltering({ hiddenFamilies: ['run'] }), true);
});

test('the stored filter shape is stable and degrades instead of throwing', () => {
  const stored = toStoredFilter({ query: 'x', hiddenSeverities: new Set(['warn', 'bad']), hiddenFamilies: ['run'] });
  assert.deepEqual(stored, { query: 'x', hiddenSeverities: ['bad', 'warn'], hiddenFamilies: ['run'] });
  // Sorted, so persisting an unchanged filter never rewrites storage.
  assert.deepEqual(toStoredFilter({ hiddenSeverities: new Set(['warn', 'bad']) }).hiddenSeverities, ['bad', 'warn']);

  assert.deepEqual(parseStoredFilter(JSON.stringify(stored)), stored, 'round-trips');
  const empty = { query: '', hiddenSeverities: [], hiddenFamilies: [] };
  assert.deepEqual(parseStoredFilter(null), empty);
  assert.deepEqual(parseStoredFilter(''), empty);
  assert.deepEqual(parseStoredFilter('not json'), empty, 'corrupt storage must not break the feed');
  assert.deepEqual(parseStoredFilter('[1,2,3]'), empty);
  assert.deepEqual(parseStoredFilter('{"query":5}'), empty, 'wrong types fall back');
});

test('message and time accessors tolerate every producer spelling', () => {
  assert.equal(messageOf(entry('a.b', 'hello')), 'hello');
  assert.equal(messageOf({ time: 0, kind: 'a.b', msg: 'legacy' }), 'legacy', 'msg is accepted as an alias');
  assert.equal(messageOf({ time: 0, kind: 'a.b' }), '');

  assert.equal(timeOf(entry('a.b')), Date.parse('2026-07-31T10:00:00Z'));
  assert.ok(Number.isNaN(timeOf({ time: '', kind: 'a.b' })));
  assert.ok(Number.isNaN(timeOf({ time: 'nonsense', kind: 'a.b' })));

  assert.equal(formatTimestamp(''), '', 'a missing time renders blank, never "Invalid Date"');
  assert.equal(formatTimestamp('nonsense'), '');
  assert.ok(formatTimestamp('2026-07-31T10:00:00Z').length > 0);
});

test('SEVERITIES is the loudest-first chip order and covers every rule output', () => {
  assert.deepEqual([...SEVERITIES], ['bad', 'warn', 'skip', 'good', 'info']);
  const produced = new Set(
    ['x.failed', 'x.disabled', 'x.skipped', 'x.built', 'x.queued'].map((k) => severityOf(k)),
  );
  for (const sev of produced) assert.ok(SEVERITIES.includes(sev), `${sev} missing from SEVERITIES`);
});
