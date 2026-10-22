/** The feed variant of <data-table>: the columns, kind badge, facet chips and stored filter of an event log. */

import type { FacetGroup, TableColumn } from './data-table.ts';
import type { StoredTableFilter } from './data-table-math.ts';
import {
  SEVERITIES,
  familyOf,
  formatTimestamp,
  messageOf,
  parseStoredFilter,
  severityOf,
  type ActivityEntry,
  type StoredFilter,
} from './data-table-feed-math.ts';

/** Renders one entry's message into a node (or a string, appended as text). */
export type MessageRenderer = (message: string, entry: ActivityEntry) => Node | string;

/** Renders one entry's time. */
export type TimeFormatter = (time: ActivityEntry['time'], entry: ActivityEntry) => string;

/** Column headings; override for a localized or retitled feed. */
export interface ColumnLabels {
  time: string;
  kind: string;
  message: string;
}

export const DEFAULT_COLUMN_LABELS: ColumnLabels = { time: 'Time', kind: 'Kind', message: 'What happened' };
export const FEED_PLACEHOLDER = 'filter activity…';

/** Facet group keys. The stored filter keeps its own names. */
export const SEVERITY_GROUP = 'severity';
export const FAMILY_GROUP = 'family';

export function familyHue(family: string): number {
  let h = 2166136261;
  for (let i = 0; i < family.length; i++) {
    h ^= family.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 24) * 15;
}

/** Reads a stored feed filter into the table's filter shape. Malformed input gives no filter. */
export function feedFilterFromStored(raw: string | null | undefined): StoredTableFilter {
  const f = parseStoredFilter(raw);
  return { query: f.query, hidden: { [SEVERITY_GROUP]: f.hiddenSeverities, [FAMILY_GROUP]: f.hiddenFamilies }, sort: null };
}

/** Writes the table's filter in the stored feed shape that consumers already hold in localStorage. */
export function feedFilterToStored(f: StoredTableFilter): StoredFilter {
  return {
    query: f.query,
    hiddenSeverities: [...(f.hidden[SEVERITY_GROUP] ?? [])].sort(),
    hiddenFamilies: [...(f.hidden[FAMILY_GROUP] ?? [])].sort(),
  };
}

/** The table surface that a feed drives. */
export interface FeedHost {
  columns: TableColumn<ActivityEntry>[];
  facets: FacetGroup<ActivityEntry>[];
  rows: ActivityEntry[];
  searchText: ((row: ActivityEntry) => string) | null;
  rowClass: ((row: ActivityEntry) => string) | null;
  filteredEmptyText: ((total: number) => string) | null;
}

/** The feed settings. The table holds one and applies it in feed mode only. */
export class FeedState {
  entries: ActivityEntry[] = [];
  messageRenderer: MessageRenderer | null = null;
  timeFormatter: TimeFormatter | null = null;
  familyAliases: Record<string, string> = {};
  columnLabels: ColumnLabels = DEFAULT_COLUMN_LABELS;

  /** Sets the columns, facets, search text, row class and rows of `host` from this feed. */
  apply(host: FeedHost, familyChips: boolean): void {
    host.columns = this.columns();
    host.facets = this.facets(familyChips);
    // The haystack is the kind, the message and every field VALUE.
    host.searchText = (e) => [e.kind ?? '', messageOf(e), ...Object.values(e.fields ?? {})].join(' ');
    host.rowClass = (e) => `sev-${severityOf(e.kind)}`;
    host.filteredEmptyText = (total) => `No entries match the filter (${total} hidden).`;
    host.rows = this.entries;
  }

  private columns(): TableColumn<ActivityEntry>[] {
    return [
      {
        key: 'time',
        label: this.columnLabels.time,
        className: 'time',
        // A feed is a chronology in the producer's order.
        sortable: false,
        // The query does not search the timestamp: "2026" would match every row.
        searchable: false,
        render: (e) => (this.timeFormatter ? this.timeFormatter(e.time, e) : formatTimestamp(e.time)),
      },
      {
        key: 'kind',
        label: this.columnLabels.kind,
        sortable: false,
        render: (e) => {
          const fam = familyOf(e.kind, this.familyAliases);
          const badge = document.createElement('span');
          badge.className = `kind sev-${severityOf(e.kind)} fam-${fam}`;
          badge.style.setProperty('--fam-hue', String(familyHue(fam)));
          badge.textContent = e.kind ?? '';
          return badge;
        },
      },
      {
        key: 'message',
        label: this.columnLabels.message,
        className: 'msg',
        sortable: false,
        render: (e) => {
          const message = messageOf(e);
          return this.messageRenderer ? this.messageRenderer(message, e) : message;
        },
      },
    ];
  }

  private facets(familyChips: boolean): FacetGroup<ActivityEntry>[] {
    return [
      {
        key: SEVERITY_GROUP,
        label: 'entr(ies)',
        of: (e) => severityOf(e.kind),
        order: SEVERITIES,
        chipClass: (b) => `sev-${b}`,
      },
      {
        key: FAMILY_GROUP,
        label: 'entr(ies)',
        of: (e) => familyOf(e.kind, this.familyAliases),
        chipClass: () => 'fam',
        decorate: (chip, fam) => chip.style.setProperty('--fam-hue', String(familyHue(fam))),
        hidden: !familyChips,
      },
    ];
  }
}
