/**
 * <data-table> — a declarative, filterable, sortable table.
 *
 * One element = one tabular view. You declare the columns and hand over the
 * rows; it owns the header, the sort cycle, the free-text query, the facet
 * chips, the "showing N of M" readout and the two distinct empty states.
 * Dependency-free.
 *
 *   import 'https://…/js-snippets/ui/data-table.js'; // registers <data-table>
 *
 *   <data-table empty-text="No runs yet." storage-key="myapp.runs" searchable>
 *     <p>loading…</p>                <!-- light DOM: shown until upgrade -->
 *   </data-table>
 *
 *   const t = document.querySelector('data-table');
 *   t.columns = [
 *     { key: 'started', label: 'Queued', value: r => Date.parse(r.started),
 *       render: r => fmtTime(r.started) },
 *     { key: 'status', label: 'Status', render: r => statusBadge(r) },
 *     { key: 'duration', label: 'Duration', align: 'end',
 *       value: r => r.ms, render: r => fmtMs(r.ms) },
 *   ];
 *   t.facets = [{ key: 'status', label: 'status', of: r => r.status }];
 *   t.rows = runs;
 *
 * WHY THIS EXISTS: a dashboard grows one hand-rolled <table> per view, each
 * re-implementing rows, sorting, empty states and (worst) its own filter
 * chips with their own persistence. They drift: one sorts nullish to the
 * top, one forgets to say "N hidden by the filter" and reads as "nothing
 * happened", one loses the operator's choice on reload. This is that logic,
 * once.
 *
 * VALUE vs RENDER vs TEXT is the core of the column contract. `value`
 * sorts, `render` displays, `text` searches (defaulting to `value`'s
 * string). A duration column sorts by milliseconds, shows "1.2s", and is
 * searched as "1.2s" — collapse those and you get a table that sorts "10s"
 * before "9s".
 *
 * SAFETY: a `render` returning a string is appended as a TEXT NODE, never
 * innerHTML, so producer strings cannot inject markup. Returning a Node is
 * the opt-in for richer cells, and that DOM's safety is the consumer's.
 *
 * Theme via --table-* custom properties (see data-table.css). The pure
 * logic lives in ui/data-table-math.ts (node-tested) and is re-exported
 * here so one import serves both.
 */

import TABLE_CSS from './data-table.css';
import {
  hiddenFromStored,
  isFiltering,
  nextSortState,
  parseStoredTableFilter,
  selectRows,
  sortRows,
  toStoredTableFilter,
  type DataColumn,
  type DataRow,
  type SortState,
  type StoredTableFilter,
} from './data-table-math.ts';

export * from './data-table-math.ts';

/** Renders one cell. A string is appended as text; a Node as-is. */
export type CellRenderer<Row extends DataRow = DataRow> = (row: Row) => Node | string | null;

/** A column as the ELEMENT consumes it: the math half plus how to draw it. */
export interface TableColumn<Row extends DataRow = DataRow> extends DataColumn<Row> {
  render?: CellRenderer<Row>;
}

/**
 * A group of facet chips. `of` buckets a row; the rest is presentation.
 *
 * `order` pins the chip order for a closed vocabulary (severities, run
 * statuses) so the row does not reshuffle as counts change. Without it,
 * buckets sort alphabetically. `decorate` is the hook for per-bucket
 * styling — a stable hue, an icon — applied to the chip button.
 */
export interface FacetGroup<Row extends DataRow = DataRow> {
  key: string;
  /** Human name used in chip tooltips ("status", "severity"). */
  label?: string;
  of: (row: Row) => string | null | undefined;
  order?: readonly string[];
  /** Extra class per chip, e.g. `sev-bad`. */
  chipClass?: (bucket: string) => string;
  decorate?: (chip: HTMLButtonElement, bucket: string) => void;
  /** Hide the whole group's chip row. */
  hidden?: boolean;

  /**
   * Set false when the HOST does the filtering — typically server-side,
   * before its own row cap. The chips still render, toggle and persist,
   * and `table-filter-change` still fires, but the table does NOT drop
   * rows locally: the host is expected to refetch.
   *
   * This exists because doing it the other way round is a real bug. A
   * server that caps a page BEFORE excluding a status hands over a window
   * that is entirely that status; filtering it again here empties the
   * table, and it reports "nothing matches" while the rows the operator
   * wants sit just past the cap, unreachable at any limit. If the data is
   * a server-filtered window, say so here.
   */
  local?: boolean;

  /**
   * Chip counts to display instead of counting the supplied rows. A
   * host-filtered group MUST supply these: the rows in hand no longer
   * contain the hidden buckets at all, so a derived count would read ×0
   * for precisely the chip you need a number on. Counts over the host's
   * whole window ("skipped ×4213") are the useful figure anyway.
   */
  counts?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;

  /** Buckets whose chip shows even at zero, so the control stays discoverable. */
  always?: readonly string[];
}

const DEFAULT_EMPTY = 'Nothing yet.';

export class DataTableElement<Row extends DataRow = DataRow> extends HTMLElement {
  static observedAttributes = ['empty-text', 'storage-key', 'placeholder', 'searchable'];

  protected root: ShadowRoot;
  private barEl: HTMLDivElement;
  private queryEl: HTMLInputElement;
  private chipsWrapEl: HTMLDivElement;
  private countEl: HTMLSpanElement;
  private clearEl: HTMLButtonElement;
  private tableEl: HTMLTableElement;
  private headEl: HTMLTableSectionElement;
  private bodyEl: HTMLTableSectionElement;
  private emptyEl: HTMLParagraphElement;

  private _columns: TableColumn<Row>[] = [];
  private _rows: Row[] = [];
  private _facets: FacetGroup<Row>[] = [];
  private _query = '';
  private _hidden = new Map<string, Set<string>>();
  private _sort: SortState | null = null;
  private _rowClass: ((row: Row) => string) | null = null;
  private _rowId: ((row: Row) => string) | null = null;
  private _searchText: ((row: Row) => string) | null = null;
  private _filteredEmptyText: ((total: number) => string) | null = null;
  private _styleText = '';
  private styleEl: HTMLStyleElement | null = null;
  private restored = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(TABLE_CSS);
      this.root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = TABLE_CSS;
      this.root.append(style);
    }

    this.barEl = document.createElement('div');
    this.barEl.className = 'bar';

    this.queryEl = document.createElement('input');
    this.queryEl.className = 'q';
    this.queryEl.type = 'search';
    this.queryEl.placeholder = this.getAttribute('placeholder') ?? 'filter…';
    this.queryEl.setAttribute('aria-label', 'Filter rows');
    this.queryEl.addEventListener('input', () => {
      this._query = this.queryEl.value;
      this.filterChanged();
    });

    this.chipsWrapEl = document.createElement('div');
    this.chipsWrapEl.className = 'chip-groups';

    this.countEl = document.createElement('span');
    this.countEl.className = 'count';

    this.clearEl = document.createElement('button');
    this.clearEl.className = 'clear';
    this.clearEl.type = 'button';
    this.clearEl.textContent = 'clear filter';
    this.clearEl.hidden = true;
    this.clearEl.addEventListener('click', () => this.clearFilter());

    this.barEl.append(this.queryEl, this.chipsWrapEl, this.countEl, this.clearEl);

    this.tableEl = document.createElement('table');
    this.headEl = document.createElement('thead');
    this.bodyEl = document.createElement('tbody');
    this.tableEl.append(this.headEl, this.bodyEl);

    this.emptyEl = document.createElement('p');
    this.emptyEl.className = 'empty';
    this.emptyEl.hidden = true;

    this.root.append(this.barEl, this.tableEl, this.emptyEl);
  }

  // -- Properties -----------------------------------------------------------

  get columns(): TableColumn<Row>[] {
    return this._columns;
  }
  set columns(v: TableColumn<Row>[] | null | undefined) {
    this._columns = Array.isArray(v) ? v : [];
    this.render();
  }

  /** The rows, rendered in the given order unless a sort is active. */
  get rows(): Row[] {
    return this._rows;
  }
  set rows(v: Row[] | null | undefined) {
    this._rows = Array.isArray(v) ? v : [];
    this.render();
  }

  get facets(): FacetGroup<Row>[] {
    return this._facets;
  }
  set facets(v: FacetGroup<Row>[] | null | undefined) {
    this._facets = Array.isArray(v) ? v : [];
    this.render();
  }

  /** Active sort; null = the consumer's row order. */
  get sort(): SortState | null {
    return this._sort;
  }
  set sort(v: SortState | null | undefined) {
    this._sort = v && typeof v.key === 'string' ? { key: v.key, dir: v.dir === 'desc' ? 'desc' : 'asc' } : null;
    this.render();
  }

  /** Extra class per row, e.g. a status tint. */
  get rowClass(): ((row: Row) => string) | null {
    return this._rowClass;
  }
  set rowClass(fn: ((row: Row) => string) | null) {
    this._rowClass = typeof fn === 'function' ? fn : null;
    this.render();
  }

  /** Stable id per row, echoed in the `row-click` event detail. */
  get rowId(): ((row: Row) => string) | null {
    return this._rowId;
  }
  set rowId(fn: ((row: Row) => string) | null) {
    this._rowId = typeof fn === 'function' ? fn : null;
    this.render();
  }

  /** Override what the query searches (see TableFilter.searchText). */
  get searchText(): ((row: Row) => string) | null {
    return this._searchText;
  }
  set searchText(fn: ((row: Row) => string) | null) {
    this._searchText = typeof fn === 'function' ? fn : null;
    this.render();
  }

  /**
   * Extra CSS applied INSIDE this element's shadow root, after the built-in
   * sheet. Shadow DOM is why this exists: a consumer whose `render` returns
   * styled cells cannot reach them from an outer stylesheet, so without an
   * escape hatch every richly-rendered cell has to carry inline styles.
   * Wrappers around this element (see <activity-feed>) pass their whole
   * sheet through here.
   */
  get styleText(): string {
    return this._styleText;
  }
  set styleText(v: string | null | undefined) {
    this._styleText = v ?? '';
    if (!this.styleEl) {
      this.styleEl = document.createElement('style');
      this.root.append(this.styleEl);
    }
    this.styleEl.textContent = this._styleText;
  }

  /**
   * Overrides the "everything is filtered out" message, which by default
   * names rows. A wrapper with its own noun ("entries") sets this so the
   * empty state does not suddenly change vocabulary.
   */
  get filteredEmptyText(): ((total: number) => string) | null {
    return this._filteredEmptyText;
  }
  set filteredEmptyText(fn: ((total: number) => string) | null) {
    this._filteredEmptyText = typeof fn === 'function' ? fn : null;
    this.render();
  }

  get emptyText(): string {
    return this.getAttribute('empty-text') ?? DEFAULT_EMPTY;
  }
  set emptyText(v: string) {
    this.setAttribute('empty-text', v);
  }

  /** localStorage key for query+chips+sort; unset = don't persist. */
  get storageKey(): string | null {
    return this.getAttribute('storage-key');
  }
  set storageKey(v: string | null) {
    if (v == null) this.removeAttribute('storage-key');
    else this.setAttribute('storage-key', v);
  }

  /** Show the free-text query box. */
  get searchable(): boolean {
    return this.hasAttribute('searchable');
  }
  set searchable(v: boolean) {
    if (v) this.setAttribute('searchable', '');
    else this.removeAttribute('searchable');
  }

  get filter(): StoredTableFilter {
    return toStoredTableFilter({ query: this._query, hidden: this._hidden, sort: this._sort });
  }
  set filter(v: Partial<StoredTableFilter> | null | undefined) {
    this.applyStored(parseStoredTableFilter(JSON.stringify(v ?? {})));
    this.render();
  }

  /** Drop the query and every hidden bucket. Sort is NOT a filter and stays. */
  clearFilter(): void {
    this._query = '';
    this._hidden.clear();
    this.queryEl.value = '';
    this.filterChanged();
  }

  // -- Lifecycle ------------------------------------------------------------

  connectedCallback(): void {
    // Property upgrade: this module is fetched at runtime, so a consumer
    // script setting properties BEFORE it loads is the normal case, not an
    // edge case. Re-assign through the prototype so nothing is lost.
    for (const prop of ['columns', 'rows', 'facets', 'sort', 'rowClass', 'rowId', 'searchText', 'filter'] as const) {
      if (Object.prototype.hasOwnProperty.call(this, prop)) {
        const value = this[prop];
        delete (this as Partial<this>)[prop];
        (this as DataTableElement<Row>)[prop] = value as never;
      }
    }
    if (!this.restored) {
      this.restored = true;
      this.restoreFilter();
    }
    this.render();
  }

  attributeChangedCallback(name: string): void {
    if (name === 'placeholder') this.queryEl.placeholder = this.getAttribute('placeholder') ?? 'filter…';
    if (name === 'storage-key') this.restoreFilter();
    this.render();
  }

  // -- Filter plumbing ------------------------------------------------------

  private applyStored(f: StoredTableFilter): void {
    this._query = f.query;
    this._hidden = hiddenFromStored(f);
    this._sort = f.sort;
    this.queryEl.value = this._query;
  }

  private restoreFilter(): void {
    const key = this.storageKey;
    if (!key) return;
    try {
      this.applyStored(parseStoredTableFilter(globalThis.localStorage?.getItem(key)));
    } catch {
      /* storage unavailable (private mode, sandboxed iframe): no persistence */
    }
  }

  protected persistFilter(): void {
    const key = this.storageKey;
    if (!key) return;
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(this.filter));
    } catch {
      /* storage unavailable: the choice just doesn't persist */
    }
  }

  /** Called after any filter/sort mutation. Subclasses may override to
   * persist or emit in their own shape (see <activity-feed>). */
  protected filterChanged(): void {
    this.persistFilter();
    this.render();
    this.dispatchEvent(new CustomEvent('table-filter-change', { detail: this.filter, bubbles: true, composed: true }));
  }

  protected toggleFacet(group: string, bucket: string): void {
    let set = this._hidden.get(group);
    if (!set) {
      set = new Set();
      this._hidden.set(group, set);
    }
    if (set.has(bucket)) set.delete(bucket);
    else set.add(bucket);
    this.filterChanged();
  }

  private headerClicked(key: string): void {
    this._sort = nextSortState(this._sort, key);
    this.filterChanged();
    this.dispatchEvent(new CustomEvent('table-sort-change', { detail: this._sort, bubbles: true, composed: true }));
  }

  // -- Rendering ------------------------------------------------------------

  private renderHead(): void {
    this.headEl.replaceChildren();
    const tr = document.createElement('tr');
    for (const col of this._columns) {
      const th = document.createElement('th');
      th.textContent = col.label;
      if (col.align === 'end') th.classList.add('end');
      if (col.className) th.classList.add(col.className);
      const sortable = col.sortable !== false;
      if (sortable) {
        th.classList.add('sortable');
        th.tabIndex = 0;
        th.setAttribute('role', 'button');
        const active = this._sort?.key === col.key;
        th.setAttribute('aria-sort', active ? (this._sort?.dir === 'desc' ? 'descending' : 'ascending') : 'none');
        if (active) {
          th.classList.add('sorted');
          const caret = document.createElement('span');
          caret.className = 'caret';
          caret.textContent = this._sort?.dir === 'desc' ? '▾' : '▴';
          th.append(caret);
        }
        const activate = () => this.headerClicked(col.key);
        th.addEventListener('click', activate);
        th.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        });
      }
      tr.append(th);
    }
    this.headEl.append(tr);
  }

  private chip(label: string, count: number, off: boolean, extraClass: string, what: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip ${extraClass}${off ? ' off' : ''}`;
    b.textContent = `${label} ×${count}`;
    b.setAttribute('aria-pressed', String(!off));
    b.title = off ? `${count} ${label} ${what} hidden — click to show` : `click to hide ${label} ${what}`;
    b.addEventListener('click', onClick);
    return b;
  }

  private renderChips(facetCounts: Map<string, Map<string, number>>): void {
    this.chipsWrapEl.replaceChildren();
    for (const group of this._facets) {
      if (group.hidden) continue;
      // Supplied counts win: a host-filtered group's rows no longer contain
      // its hidden buckets, so derived counts would read ×0 on exactly the
      // chips that need a number.
      const counts = group.counts
        ? group.counts instanceof Map
          ? group.counts
          : new Map(Object.entries(group.counts))
        : (facetCounts.get(group.key) ?? new Map<string, number>());
      const hidden = this._hidden.get(group.key) ?? new Set<string>();
      // Every bucket that occurs, PLUS every hidden one: a chip must stay
      // visible while it is hiding rows, or the filter becomes unreachable.
      // PLUS any the group pins, so a control with nothing to show yet is
      // still discoverable.
      const buckets = new Set([...counts.keys(), ...hidden, ...(group.always ?? [])]);
      if (buckets.size === 0) continue;
      const ordered = group.order
        ? [...group.order].filter((b) => buckets.has(b)).concat([...buckets].filter((b) => !group.order?.includes(b)).sort())
        : [...buckets].sort();

      const row = document.createElement('div');
      row.className = 'chips';
      row.dataset.group = group.key;
      for (const bucket of ordered) {
        const chip = this.chip(
          bucket,
          counts.get(bucket) ?? 0,
          hidden.has(bucket),
          group.chipClass?.(bucket) ?? '',
          group.label ? `${group.label} row(s)` : 'row(s)',
          () => this.toggleFacet(group.key, bucket),
        );
        group.decorate?.(chip, bucket);
        row.append(chip);
      }
      this.chipsWrapEl.append(row);
    }
  }

  protected render(): void {
    if (!this.isConnected && this._rows.length === 0 && this._columns.length === 0) return;

    this.queryEl.hidden = !this.searchable;

    // Only LOCAL groups take part in selection; a host-filtered group's
    // exclusions were already applied upstream (see FacetGroup.local).
    const filter = {
      query: this._query,
      hidden: this._hidden,
      facets: this._facets.filter((g) => g.local !== false),
      searchText: this._searchText ?? undefined,
    };
    const { shown, facetCounts, total } = selectRows(this._rows, this._columns, filter);

    this.renderHead();
    this.renderChips(facetCounts);

    const filtering = isFiltering(filter);
    // "showing N of M" describes what THIS element removed. A host-filtered
    // group's exclusions never reached these rows, so counting them here
    // would announce "showing 50 of 50" and mean nothing.
    this.countEl.textContent = shown.length !== total ? `showing ${shown.length} of ${total}` : '';
    // The clear affordance, though, covers every hidden bucket including a
    // host-filtered group's — otherwise a chip could be toggled on and
    // never cleared.
    const anyHidden = isFiltering({ query: this._query, hidden: this._hidden });
    this.clearEl.hidden = !anyHidden;
    this.barEl.hidden = !this.searchable && this.chipsWrapEl.childElementCount === 0 && !anyHidden;

    const ordered = sortRows(shown, this._columns, this._sort);

    this.bodyEl.replaceChildren();
    for (const row of ordered) {
      const tr = document.createElement('tr');
      const cls = this._rowClass?.(row);
      if (cls) tr.className = cls;
      if (this._rowId) tr.dataset.rowId = this._rowId(row);
      tr.addEventListener('click', () => {
        this.dispatchEvent(
          new CustomEvent('row-click', {
            detail: { row, id: this._rowId?.(row) ?? null },
            bubbles: true,
            composed: true,
          }),
        );
      });
      for (const col of this._columns) {
        const td = document.createElement('td');
        if (col.align === 'end') td.classList.add('end');
        if (col.className) td.classList.add(col.className);
        const rendered = col.render ? col.render(row) : textOfCell(row, col);
        // A string result becomes a TEXT node — producer strings can never
        // be parsed as markup here. A Node result is the consumer's own DOM.
        if (typeof rendered === 'string') td.append(document.createTextNode(rendered));
        else if (rendered) td.append(rendered);
        tr.append(td);
      }
      this.bodyEl.append(tr);
    }

    const nothing = ordered.length === 0;
    this.tableEl.hidden = nothing;
    this.emptyEl.hidden = !nothing;
    if (nothing) {
      // Say WHICH emptiness this is. "Nothing yet" in front of a table
      // holding rows the filter is hiding is the bug worth avoiding: it
      // reads as "the system did nothing" when the truth is "you hid it".
      this.emptyEl.textContent =
        total > 0 && filtering
          ? (this._filteredEmptyText?.(total) ?? `No rows match the filter (${total} hidden).`)
          : this.emptyText;
    }
  }
}

/** Default cell text when a column declares no renderer. */
function textOfCell<Row extends DataRow>(row: Row, col: TableColumn<Row>): string {
  const v = col.value ? col.value(row) : (row as Record<string, unknown>)[col.key];
  return v == null ? '' : String(v);
}

// Auto-register under the conventional tag name, but never clobber an existing
// definition (a consumer may have registered their own, or loaded this twice).
if (typeof customElements !== 'undefined' && !customElements.get('data-table')) {
  customElements.define('data-table', DataTableElement);
}
