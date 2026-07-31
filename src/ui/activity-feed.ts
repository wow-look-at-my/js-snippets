/**
 * <activity-feed> — a filterable activity/event log table.
 *
 * One element = one feed of timestamped, kinded events ("what has this
 * service been doing?"). It renders the rows, derives each row's severity
 * and family from its kind string, and owns the filtering UI: a free-text
 * query plus severity (and optionally family) toggle chips with live
 * counts. Dependency-free.
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
import {
  SEVERITIES,
  familyOf,
  formatTimestamp,
  isFiltering,
  messageOf,
  parseStoredFilter,
  selectEntries,
  severityOf,
  toStoredFilter,
  type ActivityEntry,
  type Severity,
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
  private barEl: HTMLDivElement;
  private queryEl: HTMLInputElement;
  private sevChipsEl: HTMLDivElement;
  private famChipsEl: HTMLDivElement;
  private countEl: HTMLSpanElement;
  private clearEl: HTMLButtonElement;
  private tableEl: HTMLTableElement;
  private headEl: HTMLTableSectionElement;
  private bodyEl: HTMLTableSectionElement;
  private emptyEl: HTMLParagraphElement;

  private _entries: ActivityEntry[] = [];
  private _query = '';
  private _hiddenSeverities = new Set<string>();
  private _hiddenFamilies = new Set<string>();
  private _messageRenderer: MessageRenderer | null = null;
  private _familyAliases: Record<string, string> = {};
  private _columns: ColumnLabels = DEFAULT_COLUMNS;
  private _timeFormatter: ((t: ActivityEntry['time'], e: ActivityEntry) => string) | null = null;
  private restored = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(ACTIVITY_CSS);
      this.root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = ACTIVITY_CSS;
      this.root.append(style);
    }

    this.barEl = document.createElement('div');
    this.barEl.className = 'bar';

    this.queryEl = document.createElement('input');
    this.queryEl.className = 'q';
    this.queryEl.type = 'search';
    this.queryEl.placeholder = this.getAttribute('placeholder') ?? 'filter activity…';
    this.queryEl.setAttribute('aria-label', 'Filter activity');
    this.queryEl.addEventListener('input', () => {
      this._query = this.queryEl.value;
      this.filterChanged();
    });

    this.sevChipsEl = document.createElement('div');
    this.sevChipsEl.className = 'chips';
    this.famChipsEl = document.createElement('div');
    this.famChipsEl.className = 'chips';
    this.famChipsEl.hidden = true;

    this.countEl = document.createElement('span');
    this.countEl.className = 'count';

    this.clearEl = document.createElement('button');
    this.clearEl.className = 'clear';
    this.clearEl.type = 'button';
    this.clearEl.textContent = 'clear filter';
    this.clearEl.hidden = true;
    this.clearEl.addEventListener('click', () => this.clearFilter());

    this.barEl.append(this.queryEl, this.sevChipsEl, this.famChipsEl, this.countEl, this.clearEl);

    this.tableEl = document.createElement('table');
    this.headEl = document.createElement('thead');
    this.bodyEl = document.createElement('tbody');
    this.tableEl.append(this.headEl, this.bodyEl);

    this.emptyEl = document.createElement('p');
    this.emptyEl.className = 'empty';
    this.emptyEl.hidden = true;

    this.root.append(this.barEl, this.tableEl, this.emptyEl);
    this.renderHead();
  }

  // -- Properties -----------------------------------------------------------

  /** The rows to display, newest-first as given (order is preserved). */
  get entries(): ActivityEntry[] {
    return this._entries;
  }
  set entries(v: ActivityEntry[] | null | undefined) {
    this._entries = Array.isArray(v) ? v : [];
    this.render();
  }

  /** Per-row message renderer (linkification hook). */
  get messageRenderer(): MessageRenderer | null {
    return this._messageRenderer;
  }
  set messageRenderer(fn: MessageRenderer | null) {
    this._messageRenderer = typeof fn === 'function' ? fn : null;
    this.render();
  }

  /** Per-row time formatter; defaults to the host locale's date-time. */
  get timeFormatter(): ((t: ActivityEntry['time'], e: ActivityEntry) => string) | null {
    return this._timeFormatter;
  }
  set timeFormatter(fn: ((t: ActivityEntry['time'], e: ActivityEntry) => string) | null) {
    this._timeFormatter = typeof fn === 'function' ? fn : null;
    this.render();
  }

  /** Singular/plural family folding, e.g. {hooks: 'hook'}. */
  get familyAliases(): Record<string, string> {
    return this._familyAliases;
  }
  set familyAliases(v: Record<string, string> | null | undefined) {
    this._familyAliases = v && typeof v === 'object' ? { ...v } : {};
    this.render();
  }

  get columns(): ColumnLabels {
    return this._columns;
  }
  set columns(v: Partial<ColumnLabels> | null | undefined) {
    this._columns = { ...DEFAULT_COLUMNS, ...(v ?? {}) };
    this.renderHead();
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
    return toStoredFilter({
      query: this._query,
      hiddenSeverities: this._hiddenSeverities,
      hiddenFamilies: this._hiddenFamilies,
    });
  }
  set filter(v: Partial<StoredFilter> | null | undefined) {
    const f = parseStoredFilter(JSON.stringify(v ?? {}));
    this._query = f.query;
    this._hiddenSeverities = new Set(f.hiddenSeverities);
    this._hiddenFamilies = new Set(f.hiddenFamilies);
    this.queryEl.value = this._query;
    this.render();
  }

  /** Drop every facet and the query. */
  clearFilter(): void {
    this._query = '';
    this._hiddenSeverities.clear();
    this._hiddenFamilies.clear();
    this.queryEl.value = '';
    this.filterChanged();
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
    if (!this.restored) {
      this.restored = true;
      this.restoreFilter();
    }
    this.render();
  }

  attributeChangedCallback(name: string): void {
    if (name === 'placeholder') this.queryEl.placeholder = this.getAttribute('placeholder') ?? 'filter activity…';
    if (name === 'storage-key') this.restoreFilter();
    this.render();
  }

  // -- Filter plumbing ------------------------------------------------------

  private restoreFilter(): void {
    const key = this.storageKey;
    if (!key) return;
    try {
      const f = parseStoredFilter(globalThis.localStorage?.getItem(key));
      this._query = f.query;
      this._hiddenSeverities = new Set(f.hiddenSeverities);
      this._hiddenFamilies = new Set(f.hiddenFamilies);
      this.queryEl.value = this._query;
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

  private filterChanged(): void {
    this.persistFilter();
    this.render();
    this.dispatchEvent(
      new CustomEvent('activity-filter-change', { detail: this.filter, bubbles: true, composed: true }),
    );
  }

  private toggle(set: Set<string>, value: string): void {
    if (set.has(value)) set.delete(value);
    else set.add(value);
    this.filterChanged();
  }

  // -- Rendering ------------------------------------------------------------

  private renderHead(): void {
    this.headEl.replaceChildren();
    const tr = document.createElement('tr');
    for (const key of ['time', 'kind', 'message'] as const) {
      const th = document.createElement('th');
      th.textContent = this._columns[key];
      tr.append(th);
    }
    this.headEl.append(tr);
  }

  private chip(label: string, count: number, off: boolean, extraClass: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip ${extraClass}${off ? ' off' : ''}`;
    b.textContent = `${label} ×${count}`;
    b.setAttribute('aria-pressed', String(!off));
    b.title = off ? `${count} ${label} entr(ies) hidden — click to show` : `click to hide ${label} entries`;
    b.addEventListener('click', onClick);
    return b;
  }

  private render(): void {
    const filter = {
      query: this._query,
      hiddenSeverities: this._hiddenSeverities,
      hiddenFamilies: this._hiddenFamilies,
      familyAliases: this._familyAliases,
    };
    const { shown, severityCounts, familyCounts } = selectEntries(this._entries, filter);

    // Severity chips: every bucket that occurs, plus every hidden one (a
    // chip must stay visible while it is hiding rows).
    this.sevChipsEl.replaceChildren();
    for (const sev of SEVERITIES) {
      const n = severityCounts.get(sev) ?? 0;
      if (n === 0 && !this._hiddenSeverities.has(sev)) continue;
      this.sevChipsEl.append(
        this.chip(sev, n, this._hiddenSeverities.has(sev), `sev-${sev}`, () => this.toggle(this._hiddenSeverities, sev)),
      );
    }

    this.famChipsEl.hidden = !this.familyChips;
    if (this.familyChips) {
      this.famChipsEl.replaceChildren();
      const fams = new Set([...familyCounts.keys(), ...this._hiddenFamilies]);
      for (const fam of [...fams].sort()) {
        const chip = this.chip(fam, familyCounts.get(fam) ?? 0, this._hiddenFamilies.has(fam), 'fam', () =>
          this.toggle(this._hiddenFamilies, fam),
        );
        chip.style.setProperty('--fam-hue', String(familyHue(fam)));
        this.famChipsEl.append(chip);
      }
    }

    const total = this._entries.length;
    const filtering = isFiltering(filter);
    this.countEl.textContent = filtering ? `showing ${shown.length} of ${total}` : '';
    this.clearEl.hidden = !filtering;

    this.bodyEl.replaceChildren();
    for (const entry of shown) {
      const sev = severityOf(entry.kind);
      const fam = familyOf(entry.kind, this._familyAliases);

      const tr = document.createElement('tr');
      tr.className = `sev-${sev}`;

      const tdTime = document.createElement('td');
      tdTime.className = 'time';
      tdTime.textContent = this._timeFormatter ? this._timeFormatter(entry.time, entry) : formatTimestamp(entry.time);

      const tdKind = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `kind sev-${sev} fam-${fam}`;
      badge.style.setProperty('--fam-hue', String(familyHue(fam)));
      badge.textContent = entry.kind ?? '';
      tdKind.append(badge);

      const tdMsg = document.createElement('td');
      tdMsg.className = 'msg';
      const message = messageOf(entry);
      const rendered = this._messageRenderer ? this._messageRenderer(message, entry) : message;
      // A string result becomes a TEXT node — producer strings can never be
      // parsed as markup here. A Node result is the consumer's own DOM.
      if (typeof rendered === 'string') tdMsg.append(document.createTextNode(rendered));
      else if (rendered) tdMsg.append(rendered);

      tr.append(tdTime, tdKind, tdMsg);
      this.bodyEl.append(tr);
    }

    const nothing = shown.length === 0;
    this.tableEl.hidden = nothing;
    this.emptyEl.hidden = !nothing;
    if (nothing) {
      // Say WHICH emptiness this is. "Nothing yet" in front of a feed that
      // holds 200 rows the filter is hiding is the bug worth avoiding.
      this.emptyEl.textContent =
        total > 0 && filtering ? `No entries match the filter (${total} hidden).` : this.emptyText;
    }
  }
}

// Auto-register under the conventional tag name, but never clobber an existing
// definition (a consumer may have registered their own, or loaded this twice).
if (typeof customElements !== 'undefined' && !customElements.get('activity-feed')) {
  customElements.define('activity-feed', ActivityFeedElement);
}
