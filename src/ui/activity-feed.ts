/**
 * <activity-feed> — a filterable activity/event log table.
 *
 * One element = one feed of timestamped, kinded events ("what has this
 * service been doing?"). It derives each row's severity and family from its
 * kind string and presents a query box plus severity (and optionally
 * family) chips.
 *
 *   import 'https://…/js-snippets/ui/activity-feed.js'; // registers <activity-feed>
 *
 *   <activity-feed empty-text="Nothing yet." storage-key="myapp.activity">
 *     <p>loading activity…</p>          <!-- shown until the module upgrades -->
 *   </activity-feed>
 *
 *   const feed = document.querySelector('activity-feed');
 *   feed.entries = [{ time: '2026-07-31T10:00:00Z', kind: 'manager.inbox_dropped',
 *                     message: 'gha-coordinator: inbox full…' }];
 *
 * IT IS A <data-table> UNDERNEATH. Rows, chips, counts, the two empty
 * states and the filter plumbing are that component's; this file supplies
 * only what is specific to an event feed — three columns, the kind badge,
 * and the severity/family derivation. Nothing about tables is implemented
 * twice, which is the point: drift between two hand-rolled tables is
 * invisible until one of them is quietly wrong.
 *
 * COLOR IS DERIVED, NEVER ENUMERATED. Severity comes from the action half
 * of the kind ("manager.inbox_dropped" → bad) and family from the namespace
 * half (→ a stable per-family dot hue), so a kind the producer adds
 * tomorrow is styled the first time it appears. The alternative — a
 * stylesheet listing known kinds — drifts silently: everything unlisted
 * shares one grey, and a feed of 77 kinds reads as three colors.
 *
 * Entry text is rendered as TEXT NODES, never innerHTML, so arbitrary
 * producer strings can never inject markup. A consumer that wants richer
 * messages (linkified issue refs, say) sets `messageRenderer` to a function
 * returning a Node — it is called per row and its result is appended as-is,
 * so the consumer owns that DOM's safety.
 *
 * Theme via --activity-* custom properties (see activity-feed.css). The
 * pure logic lives in ui/activity-feed-math.ts (node-tested) and is
 * re-exported here so one import serves both.
 */

import ACTIVITY_CSS from './activity-feed.css';
import { DataTableElement, type FacetGroup, type TableColumn } from './data-table.ts';
import {
  SEVERITIES,
  familyOf,
  formatTimestamp,
  messageOf,
  parseStoredFilter,
  severityOf,
  type ActivityEntry,
  type StoredFilter,
} from './activity-feed-math.ts';

export * from './activity-feed-math.ts';

/** Renders one entry's message into a node (or a string, appended as text). */
export type MessageRenderer = (message: string, entry: ActivityEntry) => Node | string;

/** Column headings; override for a localized or retitled table. */
export interface ColumnLabels {
  time: string;
  kind: string;
  message: string;
}

const DEFAULT_COLUMNS: ColumnLabels = { time: 'Time', kind: 'Kind', message: 'What happened' };
const DEFAULT_EMPTY = 'Nothing yet.';

/** Facet group keys. Internal: the persisted shape keeps its own names. */
const SEV_GROUP = 'severity';
const FAM_GROUP = 'family';

/**
 * A stable hue per family name (0..359). A tiny FNV-ish string hash: the
 * same family is always the same color across instances and reloads, and an
 * unseen family gets a usable color immediately rather than falling off an
 * allowlist. Hues are quantized to 24 steps so neighbours stay separable.
 */
export function familyHue(family: string): number {
  let h = 2166136261;
  for (let i = 0; i < family.length; i++) {
    h ^= family.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 24) * 15;
}

export class ActivityFeedElement extends HTMLElement {
  static observedAttributes = ['empty-text', 'storage-key', 'family-chips', 'placeholder'];

  private root: ShadowRoot;
  private table: DataTableElement<ActivityEntry>;

  private _entries: ActivityEntry[] = [];
  private _messageRenderer: MessageRenderer | null = null;
  private _familyAliases: Record<string, string> = {};
  private _columns: ColumnLabels = DEFAULT_COLUMNS;
  private _timeFormatter: ((t: ActivityEntry['time'], e: ActivityEntry) => string) | null = null;
  private restored = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });

    this.table = document.createElement('data-table') as DataTableElement<ActivityEntry>;
    this.table.searchable = true;
    // The feed's own sheet rides INTO the table's shadow root: the kind
    // badge and the row severity rule are rendered in there, out of reach
    // of any outer stylesheet. Applied after the table's own sheet, so
    // where the two overlap the feed's look wins.
    this.table.styleText = ACTIVITY_CSS;
    this.table.filteredEmptyText = (total) => `No entries match the filter (${total} hidden).`;
    // The feed owns persistence: its stored shape predates the generic
    // table's and is what consumers already have in localStorage, so the
    // inner table is left storage-less and this element translates.
    this.table.addEventListener('table-filter-change', (e) => {
      e.stopPropagation();
      this.persistFilter();
      this.dispatchEvent(
        new CustomEvent('activity-filter-change', { detail: this.filter, bubbles: true, composed: true }),
      );
    });

    this.applyColumns();
    this.applyFacets();
    this.root.append(this.table);
  }

  // -- Properties -----------------------------------------------------------

  /** The rows to display, newest-first as given (order is preserved). */
  get entries(): ActivityEntry[] {
    return this._entries;
  }
  set entries(v: ActivityEntry[] | null | undefined) {
    this._entries = Array.isArray(v) ? v : [];
    this.table.rows = this._entries;
  }

  /** Per-row message renderer (linkification hook). */
  get messageRenderer(): MessageRenderer | null {
    return this._messageRenderer;
  }
  set messageRenderer(fn: MessageRenderer | null) {
    this._messageRenderer = typeof fn === 'function' ? fn : null;
    this.applyColumns();
  }

  /** Per-row time formatter; defaults to the host locale's date-time. */
  get timeFormatter(): ((t: ActivityEntry['time'], e: ActivityEntry) => string) | null {
    return this._timeFormatter;
  }
  set timeFormatter(fn: ((t: ActivityEntry['time'], e: ActivityEntry) => string) | null) {
    this._timeFormatter = typeof fn === 'function' ? fn : null;
    this.applyColumns();
  }

  /** Singular/plural family folding, e.g. {hooks: 'hook'}. */
  get familyAliases(): Record<string, string> {
    return this._familyAliases;
  }
  set familyAliases(v: Record<string, string> | null | undefined) {
    this._familyAliases = v && typeof v === 'object' ? { ...v } : {};
    this.applyColumns();
    this.applyFacets();
  }

  get columns(): ColumnLabels {
    return this._columns;
  }
  set columns(v: Partial<ColumnLabels> | null | undefined) {
    this._columns = { ...DEFAULT_COLUMNS, ...(v ?? {}) };
    this.applyColumns();
  }

  get emptyText(): string {
    return this.getAttribute('empty-text') ?? DEFAULT_EMPTY;
  }
  set emptyText(v: string) {
    this.setAttribute('empty-text', v);
  }

  /** localStorage key for the filter choice; unset = don't persist. */
  get storageKey(): string | null {
    return this.getAttribute('storage-key');
  }
  set storageKey(v: string | null) {
    if (v == null) this.removeAttribute('storage-key');
    else this.setAttribute('storage-key', v);
  }

  /** Show a chip per family in addition to the severity chips. */
  get familyChips(): boolean {
    return this.hasAttribute('family-chips');
  }
  set familyChips(v: boolean) {
    if (v) this.setAttribute('family-chips', '');
    else this.removeAttribute('family-chips');
  }

  /** The current filter, as the stored/event shape. */
  get filter(): StoredFilter {
    const f = this.table.filter;
    return {
      query: f.query,
      hiddenSeverities: [...(f.hidden[SEV_GROUP] ?? [])].sort(),
      hiddenFamilies: [...(f.hidden[FAM_GROUP] ?? [])].sort(),
    };
  }
  set filter(v: Partial<StoredFilter> | null | undefined) {
    const f = parseStoredFilter(JSON.stringify(v ?? {}));
    this.table.filter = {
      query: f.query,
      hidden: { [SEV_GROUP]: f.hiddenSeverities, [FAM_GROUP]: f.hiddenFamilies },
      sort: null,
    };
  }

  /** Drop every facet and the query. */
  clearFilter(): void {
    this.table.clearFilter();
  }

  // -- Lifecycle ------------------------------------------------------------

  connectedCallback(): void {
    // Property upgrade: a consumer script that ran BEFORE this module loaded
    // (the component is fetched at runtime, so that is the normal case, not
    // an edge case) will have set instance properties that now shadow these
    // accessors. Re-assign them through the prototype so the values are not
    // silently lost.
    for (const prop of ['entries', 'messageRenderer', 'timeFormatter', 'familyAliases', 'columns', 'filter'] as const) {
      if (Object.prototype.hasOwnProperty.call(this, prop)) {
        const value = this[prop];
        delete (this as Partial<this>)[prop];
        (this as ActivityFeedElement)[prop] = value as never;
      }
    }
    this.syncAttributes();
    if (!this.restored) {
      this.restored = true;
      this.restoreFilter();
    }
  }

  attributeChangedCallback(name: string): void {
    this.syncAttributes();
    if (name === 'storage-key') this.restoreFilter();
    if (name === 'family-chips') this.applyFacets();
  }

  // -- Wiring ---------------------------------------------------------------

  private syncAttributes(): void {
    this.table.setAttribute('empty-text', this.emptyText);
    this.table.setAttribute('placeholder', this.getAttribute('placeholder') ?? 'filter activity…');
  }

  /** The three columns, rebuilt whenever a renderer or label changes. */
  private applyColumns(): void {
    const cols: TableColumn<ActivityEntry>[] = [
      {
        key: 'time',
        label: this._columns.time,
        className: 'time',
        // A feed is a chronology in the producer's order; offering to sort
        // it by a rendered locale string would be worse than not sorting.
        sortable: false,
        // The query never searched the timestamp and shouldn't start:
        // "2026" would match every row on the page.
        searchable: false,
        render: (e) => (this._timeFormatter ? this._timeFormatter(e.time, e) : formatTimestamp(e.time)),
      },
      {
        key: 'kind',
        label: this._columns.kind,
        sortable: false,
        render: (e) => {
          const sev = severityOf(e.kind);
          const fam = familyOf(e.kind, this._familyAliases);
          const badge = document.createElement('span');
          badge.className = `kind sev-${sev} fam-${fam}`;
          badge.style.setProperty('--fam-hue', String(familyHue(fam)));
          badge.textContent = e.kind ?? '';
          return badge;
        },
      },
      {
        key: 'message',
        label: this._columns.message,
        className: 'msg',
        sortable: false,
        render: (e) => {
          const message = messageOf(e);
          return this._messageRenderer ? this._messageRenderer(message, e) : message;
        },
      },
    ];
    this.table.columns = cols;
    // The haystack is the kind, the message and every field VALUE — typing
    // a family, a status word or a repo slug all narrow the same box.
    this.table.searchText = (e) => [e.kind ?? '', messageOf(e), ...Object.values(e.fields ?? {})].join(' ');
    this.table.rowClass = (e) => `sev-${severityOf(e.kind)}`;
  }

  private applyFacets(): void {
    const groups: FacetGroup<ActivityEntry>[] = [
      {
        key: SEV_GROUP,
        label: 'entr(ies)',
        of: (e) => severityOf(e.kind),
        order: SEVERITIES,
        chipClass: (b) => `sev-${b}`,
      },
      {
        key: FAM_GROUP,
        label: 'entr(ies)',
        of: (e) => familyOf(e.kind, this._familyAliases),
        chipClass: () => 'fam',
        decorate: (chip, fam) => chip.style.setProperty('--fam-hue', String(familyHue(fam))),
        hidden: !this.familyChips,
      },
    ];
    this.table.facets = groups;
  }

  private restoreFilter(): void {
    const key = this.storageKey;
    if (!key) return;
    try {
      this.filter = parseStoredFilter(globalThis.localStorage?.getItem(key));
    } catch {
      /* storage unavailable (private mode, sandboxed iframe): no persistence */
    }
  }

  private persistFilter(): void {
    const key = this.storageKey;
    if (!key) return;
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(this.filter));
    } catch {
      /* storage unavailable: the choice just doesn't persist */
    }
  }
}

// Auto-register under the conventional tag name, but never clobber an existing
// definition (a consumer may have registered their own, or loaded this twice).
if (typeof customElements !== 'undefined' && !customElements.get('activity-feed')) {
  customElements.define('activity-feed', ActivityFeedElement);
}
