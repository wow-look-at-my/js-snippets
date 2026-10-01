/**
 * ui/activity-feed-math — the pure half of <activity-feed>.
 *
 * Everything here is DOM-free and node-tested: how an entry's kind maps to a
 * severity and a family, how a query and a hidden-facet set select entries,
 * and how the facet counts the chips display are derived. The element in
 * ui/activity-feed.ts owns rendering and re-exports this module, so a
 * consumer needs one import.
 */

/** One row of a feed. `time` accepts anything `new Date()` understands. */
export interface ActivityEntry {
  time: string | number | Date;
  kind: string;
  /** Human sentence. `message` is canonical; `msg` is accepted as an alias. */
  message?: string;
  msg?: string;
  fields?: Record<string, string>;
}

/** Severity buckets, ordered loudest-first — the chip order too. */
export const SEVERITIES = ['bad', 'warn', 'skip', 'good', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * Severity rules over the ACTION half of a dotted kind
 * ("manager.inbox_dropped" → "inbox_dropped"), FIRST match wins.
 *
 * Order is load-bearing, and the traps are why this is a list rather than a
 * lookup: "hook.disabled_rejected" must be bad (not warn on "disabled") and
 * "reload.unverified" must be warn (not good on "verified"). Deriving
 * severity instead of enumerating kinds is the point — a feed's vocabulary
 * grows on the producer's side, and an enumeration silently greys out
 * everything it has not been taught yet.
 */
export const SEVERITY_RULES: ReadonlyArray<readonly [Severity, RegExp]> = [
  ['bad', /(failed|error|denied|refused|dropped|unresolved|misconfigured|invalid|unknown|rejected|blind|_red$)/],
  ['skip', /skipped$/],
  ['warn', /(held|waiting|deferred|orphaned|unverified|ignored|stale|exited|disabled|overridden|stolen|ttl_|parked)/],
  ['good', /(built|reloaded|pulled|enabled|switched|verified|restored|replayed|leased|cleared|released)/],
];

/**
 * Classify a kind's action half. Anything no rule claims is 'info' —
 * ordinary lifecycle chatter, which is most of a healthy feed.
 */
export function severityOf(kind: string): Severity {
  const action = String(kind ?? '')
    .split('.')
    .slice(1)
    .join('.');
  for (const [sev, re] of SEVERITY_RULES) {
    if (re.test(action)) return sev;
  }
  return 'info';
}

/**
 * The namespace half of a dotted kind — the subsystem that spoke. A kind
 * with no dot is its own family.
 *
 * `aliases` folds the singular/plural spellings producers reliably drift
 * into ({hooks: 'hook'} makes "hooks.reloaded" and "hook.enabled" one
 * family). It is an explicit map rather than automatic plural-stripping on
 * purpose: stripping a trailing "s" turns the perfectly ordinary family
 * "status" into "statu".
 */
export function familyOf(kind: string, aliases?: Readonly<Record<string, string>>): string {
  const raw = String(kind ?? '').split('.')[0] ?? '';
  return aliases?.[raw] ?? raw;
}

/** The sentence of an entry, whichever field the producer used. */
export function messageOf(entry: ActivityEntry): string {
  return entry.message ?? entry.msg ?? '';
}

/** Milliseconds for an entry's time, or NaN when it has none/unparseable. */
export function timeOf(entry: ActivityEntry): number {
  const t = entry?.time;
  if (t == null || t === '') return NaN;
  return new Date(t as string).getTime();
}

/**
 * Does the entry match a free-text query? Case-insensitive substring over
 * the kind, the message and any field VALUES, so typing a family
 * ("manager"), a status word ("failed") or a repo slug all narrow the same
 * box. Every whitespace-separated term must match somewhere (AND), which is
 * what makes "manager failed" useful.
 */
export function matchesQuery(entry: ActivityEntry, query: string): boolean {
  const terms = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const hay = [entry.kind ?? '', messageOf(entry), ...Object.values(entry.fields ?? {})].join(' ').toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export interface FeedFilter {
  /** Free-text query; empty matches everything. */
  query?: string;
  /** Severities to HIDE (the chip toggles are exclusions, like the runs table). */
  hiddenSeverities?: Iterable<string>;
  /** Families to HIDE. */
  hiddenFamilies?: Iterable<string>;
  /** Singular/plural family folding, e.g. {hooks: 'hook'}. */
  familyAliases?: Readonly<Record<string, string>>;
}

export interface FeedSelection {
  /** Entries to render, input order preserved. */
  shown: ActivityEntry[];
  /** Entries in the input, per severity — the chip counts. */
  severityCounts: Map<Severity, number>;
  /** Entries in the input, per family. */
  familyCounts: Map<string, number>;
  /** How many the filter removed. */
  hiddenCount: number;
}

/**
 * The one selection function the element renders from: counts are computed
 * over the WHOLE input (a chip must keep showing what it is hiding), while
 * `shown` is what survives every facet.
 */
export function selectEntries(entries: readonly ActivityEntry[] | null | undefined, filter: FeedFilter = {}): FeedSelection {
  const hiddenSev = new Set(filter.hiddenSeverities ?? []);
  const hiddenFam = new Set(filter.hiddenFamilies ?? []);
  const query = filter.query ?? '';
  const shown: ActivityEntry[] = [];
  const severityCounts = new Map<Severity, number>();
  const familyCounts = new Map<string, number>();
  for (const entry of entries ?? []) {
    const sev = severityOf(entry.kind);
    const fam = familyOf(entry.kind, filter.familyAliases);
    severityCounts.set(sev, (severityCounts.get(sev) ?? 0) + 1);
    familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
    if (hiddenSev.has(sev) || hiddenFam.has(fam)) continue;
    if (!matchesQuery(entry, query)) continue;
    shown.push(entry);
  }
  return { shown, severityCounts, familyCounts, hiddenCount: (entries?.length ?? 0) - shown.length };
}

/** Is any facet or query actually narrowing the feed? */
export function isFiltering(filter: FeedFilter = {}): boolean {
  return (
    String(filter.query ?? '').trim() !== '' ||
    [...(filter.hiddenSeverities ?? [])].length > 0 ||
    [...(filter.hiddenFamilies ?? [])].length > 0
  );
}

/**
 * Serialize/parse a filter for persistence (localStorage) and for the
 * `activity-filter-change` event. Deliberately a plain, sorted, stable
 * shape: a consumer storing it must not see spurious writes.
 */
export interface StoredFilter {
  query: string;
  hiddenSeverities: string[];
  hiddenFamilies: string[];
}

export function toStoredFilter(filter: FeedFilter = {}): StoredFilter {
  return {
    query: String(filter.query ?? ''),
    hiddenSeverities: [...(filter.hiddenSeverities ?? [])].map(String).sort(),
    hiddenFamilies: [...(filter.hiddenFamilies ?? [])].map(String).sort(),
  };
}

/** Parse a stored filter; anything malformed degrades to "no filter". */
export function parseStoredFilter(raw: string | null | undefined): StoredFilter {
  const empty: StoredFilter = { query: '', hiddenSeverities: [], hiddenFamilies: [] };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<StoredFilter>;
    if (!v || typeof v !== 'object') return empty;
    return {
      query: typeof v.query === 'string' ? v.query : '',
      hiddenSeverities: Array.isArray(v.hiddenSeverities) ? v.hiddenSeverities.map(String) : [],
      hiddenFamilies: Array.isArray(v.hiddenFamilies) ? v.hiddenFamilies.map(String) : [],
    };
  } catch {
    return empty;
  }
}

/**
 * Default row timestamp: the host's locale date-time, matching what a
 * dashboard would render with `new Date(t).toLocaleString()`. Returns ''
 * for a missing/unparseable time so a row never shows "Invalid Date".
 */
export function formatTimestamp(value: ActivityEntry['time']): string {
  if (value == null || value === '') return '';
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}
