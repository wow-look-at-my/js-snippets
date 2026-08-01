/**
 * The pure half of <data-table>: column resolution, sorting, faceting and
 * filter selection. No DOM — unit-tested under node.
 *
 * The element is a thin renderer over these functions, so the parts that
 * are easy to get subtly wrong (sort stability, where nullish values land,
 * whether a facet chip counts before or after the query) are testable
 * without a browser.
 */

/**
 * One row is any object the consumer hands over; columns read it.
 *
 * Deliberately `object`, NOT `Record<string, unknown>`: a real consumer's
 * row is a declared interface (`ActivityEntry`, `RunState`), and a declared
 * interface has no index signature, so the Record constraint rejects every
 * type anyone actually has. Key lookup is narrowed internally instead.
 */
export type DataRow = object;

/** Reads `row[key]` without demanding an index signature of the caller. */
function byKey(row: DataRow, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

/** Sort direction, or none. */
export type SortDir = 'asc' | 'desc';

/** The active sort: which column, which way. null = the consumer's order. */
export interface SortState {
  key: string;
  dir: SortDir;
}

/**
 * A column declaration. `key` identifies it (and, by default, reads the
 * row's property of that name); everything else is optional.
 *
 * The split between `value` and `text` is deliberate. `value` is what the
 * column SORTS and COMPARES by — a number, a Date, a string. `text` is what
 * the column SEARCHES by, and defaults to the rendered string. A duration
 * column formatted "1.2s" sorts by its millisecond number and searches by
 * the text the operator can actually see; conflating them gives you a table
 * that sorts "10s" before "9s".
 */
export interface DataColumn<Row extends DataRow = DataRow> {
  key: string;
  label: string;
  /** Sort/compare value. Default: `row[key]`. */
  value?: (row: Row) => unknown;
  /** Search text. Default: the string form of `value`. */
  text?: (row: Row) => string;
  /** Set false to make the header inert. Default: true. */
  sortable?: boolean;
  /** Set false to keep this column out of the free-text query. Default: true. */
  searchable?: boolean;
  /** Column alignment; 'end' for numerics. */
  align?: 'start' | 'end';
  /** Extra class on every cell in this column. */
  className?: string;
}

/** Reads a column's sort/compare value out of a row. */
export function valueOf<Row extends DataRow>(row: Row, col: DataColumn<Row>): unknown {
  return col.value ? col.value(row) : byKey(row, col.key);
}

/** Reads a column's searchable text out of a row. */
export function textOf<Row extends DataRow>(row: Row, col: DataColumn<Row>): string {
  if (col.text) return col.text(row);
  const v = valueOf(row, col);
  return v == null ? '' : String(v);
}

/**
 * Three-way compare for cell values.
 *
 * NULLISH ALWAYS SORTS LAST, in both directions — it is absence, not a
 * value, and a column of mostly-empty cells whose blanks march to the top
 * on every descending sort is useless. Numbers compare numerically, Dates
 * chronologically, everything else as locale strings (numeric-aware, so
 * "run 10" follows "run 9").
 */
export function isBlank(v: unknown): boolean {
  return v == null || v === '';
}

export function compareValues(a: unknown, b: unknown): number {
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b) ? 0 : isBlank(a) ? 1 : -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Sorts a COPY of rows by the active sort. STABLE: equal rows keep the
 * consumer's order, which is what makes a secondary ordering (already
 * newest-first from the server, say) survive sorting by another column.
 * An unknown sort key, or a null sort, returns the rows untouched.
 */
export function sortRows<Row extends DataRow>(
  rows: readonly Row[],
  columns: readonly DataColumn<Row>[],
  sort: SortState | null,
): Row[] {
  if (!sort) return [...rows];
  const col = columns.find((c) => c.key === sort.key);
  if (!col) return [...rows];
  const sign = sort.dir === 'desc' ? -1 : 1;
  // Decorate with the original index so ties resolve to input order —
  // Array.prototype.sort is spec-stable, but the index also lets the
  // descending case keep input order among ties instead of reversing it.
  return rows
    .map((row, i) => ({ row, i, v: valueOf(row, col) }))
    .sort((x, y) => {
      // Blanks are handled OUTSIDE the direction sign. Folding them into
      // the signed compare is the obvious implementation and it is wrong:
      // it flips "absent sorts last" into "absent sorts first" on every
      // descending sort, so a mostly-empty column answers a click with a
      // screen of blank rows.
      const xb = isBlank(x.v);
      const yb = isBlank(y.v);
      if (xb || yb) return xb && yb ? x.i - y.i : xb ? 1 : -1;
      const c = compareValues(x.v, y.v);
      return c !== 0 ? c * sign : x.i - y.i;
    })
    .map((d) => d.row);
}

/**
 * The header-click cycle: unsorted → ascending → descending → unsorted.
 * Returning to unsorted matters — it is how an operator gets back to the
 * order the producer chose (usually "newest first"), which no combination
 * of asc/desc reproduces.
 */
export function nextSortState(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

/**
 * One group of facet chips: a named way of bucketing rows.
 *
 * Groups are plural because one axis is rarely enough — an event feed
 * wants severity AND subsystem, a runs table wants status, and a chip row
 * that mixes unrelated axes into one namespace cannot say which is which.
 * `of` returns the bucket for a row, or nullish/'' for "not in this group"
 * (such a row is never counted and never hidden by it).
 */
export interface FacetGroupSpec<Row extends DataRow = DataRow> {
  key: string;
  of: (row: Row) => string | null | undefined;
}

/** Hidden buckets, per facet group. */
export type HiddenFacets = ReadonlyMap<string, ReadonlySet<string>>;

/** The filter inputs a selection is computed from. */
export interface TableFilter<Row extends DataRow = DataRow> {
  query?: string;
  hidden?: HiddenFacets;
  facets?: readonly FacetGroupSpec<Row>[];
  /**
   * Overrides what the query searches. Default: every searchable column's
   * text. Set it when rows carry searchable content no column renders —
   * an event's `fields` values, say — so typing a repo slug still narrows.
   */
  searchText?: (row: Row) => string;
}

/** What a selection produced. */
export interface Selection<Row extends DataRow = DataRow> {
  /** The rows to render, in order. */
  shown: Row[];
  /** Per group, the count per bucket across ALL rows — see selectRows. */
  facetCounts: Map<string, Map<string, number>>;
  /** How many rows were supplied. */
  total: number;
}

/** The haystack a row is searched by. */
function haystackOf<Row extends DataRow>(row: Row, columns: readonly DataColumn<Row>[], custom?: (row: Row) => string): string {
  if (custom) return custom(row).toLowerCase();
  const parts: string[] = [];
  for (const col of columns) {
    if (col.searchable === false) continue;
    parts.push(textOf(row, col));
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Every whitespace-separated term must match somewhere (AND). That is what
 * makes a two-word query useful — "manager failed" should mean both words,
 * not the union, which on a busy table is indistinguishable from no filter.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const terms = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return terms.every((t) => haystack.includes(t));
}

/**
 * Applies the filter and computes the facet counts.
 *
 * FACET COUNTS COVER EVERY SUPPLIED ROW, not the surviving ones: a chip
 * reading "skipped ×0" the moment you hide skipped rows is useless, because
 * the number you need in order to decide whether to unhide is exactly the
 * one that just went to zero. The query narrows what is SHOWN; it never
 * rewrites the chips out from under the reader.
 *
 * Row order is PRESERVED — sorting is a separate step (sortRows), so a
 * producer's meaningful default order (usually newest-first) survives
 * filtering untouched.
 *
 * The caller's cap (a server-side `?max=`, say) is upstream of all of this
 * and is NOT this component's problem to solve — but it is the consumer's:
 * if the producer caps a page BEFORE applying the same exclusions, a burst
 * of unwanted rows fills the page, this filter empties it, and the table
 * reports "nothing here" while the rows the operator wants sit just past
 * the window. Filter first, cap second, on whichever side owns the data.
 */
export function selectRows<Row extends DataRow>(
  rows: readonly Row[] | null | undefined,
  columns: readonly DataColumn<Row>[],
  filter: TableFilter<Row> = {},
): Selection<Row> {
  const query = filter.query ?? '';
  const hidden = filter.hidden ?? new Map<string, ReadonlySet<string>>();
  const groups = filter.facets ?? [];

  const facetCounts = new Map<string, Map<string, number>>();
  for (const g of groups) facetCounts.set(g.key, new Map());

  const shown: Row[] = [];
  for (const row of rows ?? []) {
    let excluded = false;
    for (const g of groups) {
      const bucket = g.of(row);
      if (bucket == null || bucket === '') continue;
      const counts = facetCounts.get(g.key);
      counts?.set(bucket, (counts.get(bucket) ?? 0) + 1);
      if (hidden.get(g.key)?.has(bucket)) excluded = true;
    }
    // Counting continues across every group even once excluded — a chip
    // must report what it hides, including rows another chip also hides.
    if (excluded) continue;
    if (query.trim() !== '' && !matchesQuery(haystackOf(row, columns, filter.searchText), query)) continue;
    shown.push(row);
  }
  return { shown, facetCounts, total: rows?.length ?? 0 };
}

/** Is anything actually being filtered out? Drives the "clear" affordance. */
export function isFiltering<Row extends DataRow>(filter: TableFilter<Row> = {}): boolean {
  if (String(filter.query ?? '').trim() !== '') return true;
  for (const set of filter.hidden?.values() ?? []) {
    if (set.size > 0) return true;
  }
  return false;
}

/** The persisted/emitted filter shape. Plain JSON: sets become sorted arrays. */
export interface StoredTableFilter {
  query: string;
  /** Group key → sorted hidden buckets. */
  hidden: Record<string, string[]>;
  sort: SortState | null;
}

/** Serializes the live filter state into the stored shape. */
export function toStoredTableFilter(state: {
  query?: string;
  hidden?: HiddenFacets;
  sort?: SortState | null;
}): StoredTableFilter {
  const hidden: Record<string, string[]> = {};
  for (const [group, set] of state.hidden ?? []) {
    if (set.size > 0) hidden[group] = [...set].sort();
  }
  return { query: state.query ?? '', hidden, sort: state.sort ?? null };
}

/** Rebuilds the live hidden-facet map from a stored filter. */
export function hiddenFromStored(stored: StoredTableFilter): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [group, values] of Object.entries(stored.hidden)) out.set(group, new Set(values));
  return out;
}

/**
 * Parses a stored filter, tolerating anything. A corrupt or stale
 * localStorage value must degrade to "no filter" — never throw, and never
 * leave a table silently hiding rows because of a shape it can't read.
 */
export function parseStoredTableFilter(raw: string | null | undefined): StoredTableFilter {
  const empty: StoredTableFilter = { query: '', hidden: {}, sort: null };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<StoredTableFilter> | null;
    if (!v || typeof v !== 'object') return empty;
    const sort =
      v.sort && typeof v.sort === 'object' && typeof v.sort.key === 'string' && (v.sort.dir === 'asc' || v.sort.dir === 'desc')
        ? { key: v.sort.key, dir: v.sort.dir }
        : null;
    const hidden: Record<string, string[]> = {};
    if (v.hidden && typeof v.hidden === 'object') {
      for (const [group, values] of Object.entries(v.hidden)) {
        if (Array.isArray(values)) hidden[group] = values.filter((x): x is string => typeof x === 'string');
      }
    }
    return { query: typeof v.query === 'string' ? v.query : '', hidden, sort };
  } catch {
    return empty;
  }
}
