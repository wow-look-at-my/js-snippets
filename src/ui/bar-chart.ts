/** <bar-chart>: a horizontal bar chart in SVG. Each row is a stack of segments, with optional value markers. */

import CHART_CSS from './bar-chart.css';
import * as palette from './color.ts';
import { onFirstListener } from './listener-watch.ts';
import { adoptShadowStyles } from './shadow-styles.ts';
import { upgradeProperties } from './upgrade-properties.ts';
import {
  barScale,
  ellipsize,
  formatCompact,
  formatShare,
  gutterWidth,
  hitTestBars,
  placeMarkers,
  rowTotal,
  rowY,
  segmentRect,
  stackRow,
  summarize,
  type BarHit,
  type BarMarker,
  type BarRow,
  type BarRowLayout,
  type BarSeries,
  type StackedRow,
} from './bar-chart-math.ts';

export * from './bar-chart-math.ts';

/** The `row-click` event detail. */
export interface BarRowClickDetail {
  row: BarRow;
}

/** The `segment-hover` event detail. Both are null when the pointer leaves the bars. */
export interface BarSegmentHoverDetail {
  row: BarRow | null;
  series: BarSeries | null;
}

export const ROW_HEIGHT = 22;
export const ROW_GAP = 2;
/** The px of background between segments of one row. */
export const SEGMENT_GAP = 2;
/** The corner radius at the outer end of a stack. */
export const END_RADIUS = 4;

const AXIS_HEIGHT = 20;
const MARKER_LANE = 18;
const TOP_PAD = 4;
const LABEL_PAD = 8;
const VALUE_PAD = 6;
const DEFAULT_EMPTY_TEXT = 'No data';
const SVG_NS = 'http://www.w3.org/2000/svg';

interface ChartState {
  series: BarSeries[];
  rows: BarRow[];
  markers: BarMarker[];
  max: number | null;
  format: (value: number) => string;
}

function asList<T>(v: readonly T[] | null | undefined): T[] {
  return Array.isArray(v) ? [...v] : [];
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function html<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** A rectangle with only its right corners rounded. */
function endPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w, h / 2));
  const right = x + w;
  return (
    `M${x},${y}H${right - rr}` +
    `A${rr},${rr} 0 0 1 ${right},${y + rr}` +
    `V${y + h - rr}` +
    `A${rr},${rr} 0 0 1 ${right - rr},${y + h}` +
    `H${x}Z`
  );
}

/** The chart element. Auto-registered as `<bar-chart>` when this module loads, unless that tag is taken. */
export class BarChartElement extends HTMLElement {
  static observedAttributes = ['show-values', 'no-legend', 'empty-text'];

  private legendEl = html('ul', 'legend');
  private svgEl = svg('svg');
  private tipEl = html('div', 'tooltip');
  private emptyEl = html('p', 'empty');
  private tableEl = html('table', 'sr-only');

  private state: ChartState = { series: [], rows: [], markers: [], max: null, format: formatCompact };

  /** True once a `row-click` listener exists. Rows are focusable buttons only then. */
  private clickable = false;
  private width = 0;
  private stacks: StackedRow[] = [];
  private layout: BarRowLayout = { top: 0, rowHeight: ROW_HEIGHT, rowGap: ROW_GAP, plotLeft: 0, plotWidth: 0 };
  private hoverKey = '';
  private queued = false;
  private sizeWatch: ResizeObserver | null = null;
  private measureCtx: CanvasRenderingContext2D | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptShadowStyles(root, CHART_CSS);
    this.legendEl.setAttribute('aria-hidden', 'true');
    this.tipEl.setAttribute('aria-hidden', 'true');
    this.tipEl.hidden = true;
    this.emptyEl.hidden = true;
    this.svgEl.addEventListener('pointermove', (e) => this.hover(e));
    this.svgEl.addEventListener('pointerleave', () => this.unhover());
    this.svgEl.addEventListener('click', (e) => this.clicked(e));
    if ('ResizeObserver' in globalThis) {
      this.sizeWatch = new ResizeObserver((entries) => this.resized(entries[entries.length - 1].contentRect.width));
    }
    root.append(this.legendEl, this.svgEl, this.tipEl, this.emptyEl, this.tableEl);
    onFirstListener(this, 'row-click', () => {
      this.clickable = true;
      this.requestPaint();
    });
  }

  /** The series, in stack order and legend order. */
  get series(): BarSeries[] {
    return this.state.series;
  }
  set series(v: BarSeries[] | null | undefined) {
    this.state.series = asList(v);
    this.requestPaint();
  }

  /** The rows, top to bottom. */
  get rows(): BarRow[] {
    return this.state.rows;
  }
  set rows(v: BarRow[] | null | undefined) {
    this.state.rows = asList(v);
    this.requestPaint();
  }

  /** Vertical lines across every row. */
  get markers(): BarMarker[] {
    return this.state.markers;
  }
  set markers(v: BarMarker[] | null | undefined) {
    this.state.markers = asList(v);
    this.requestPaint();
  }

  /** The scale end. */
  get max(): number | null {
    return this.state.max;
  }
  set max(v: number | null | undefined) {
    this.state.max = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    this.requestPaint();
  }

  /** The text of ticks, values and the tooltip. */
  get format(): (value: number) => string {
    return this.state.format;
  }
  set format(fn: ((value: number) => string) | null | undefined) {
    this.state.format = typeof fn === 'function' ? fn : formatCompact;
    this.requestPaint();
  }

  /** Draw each row total at the right end of its bar. Reflects `show-values`. */
  get showValues(): boolean {
    return this.hasAttribute('show-values');
  }
  set showValues(v: boolean) {
    this.toggleAttribute('show-values', !!v);
  }

  /** Reflects `no-legend`, inverted. */
  get legend(): boolean {
    return !this.hasAttribute('no-legend');
  }
  set legend(v: boolean) {
    this.toggleAttribute('no-legend', !v);
  }

  connectedCallback(): void {
    upgradeProperties(this, BarChartElement.prototype);
    this.sizeWatch?.observe(this);
    this.width = this.clientWidth;
    this.paint();
  }

  disconnectedCallback(): void {
    this.sizeWatch?.unobserve(this);
  }

  attributeChangedCallback(): void {
    this.requestPaint();
  }

  private resized(w: number): void {
    if (w !== this.width) {
      this.width = w;
      this.paint();
    }
  }

  /** Coalesce every change in one task into one paint. */
  private requestPaint(): void {
    if (this.queued) return undefined;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.isConnected) this.paint();
    });
  }

  private measurer(): (text: string) => number {
    const style = getComputedStyle(this);
    const ctx = (this.measureCtx ??= document.createElement('canvas').getContext('2d'));
    if (!ctx) {
      const em = parseFloat(style.fontSize) || 12;
      return (text) => text.length * em * 0.6;
    }
    ctx.font = `${style.fontSize} ${style.fontFamily}`;
    return (text) => ctx.measureText(text).width;
  }

  private colorOf(s: BarSeries): string {
    return s.color ?? palette.categoryColor(palette.categoryHue(s.key));
  }

  private swatch(s: BarSeries): HTMLSpanElement {
    const sw = html('span', s.muted ? 'swatch muted' : 'swatch');
    if (!s.muted) sw.style.background = this.colorOf(s);
    return sw;
  }

  private paint(): void {
    const { series, rows, format: fmt } = this.state;
    this.hoverKey = '';
    this.tipEl.hidden = true;
    this.paintLegend();
    this.paintTable();

    const hasRows = rows.length > 0;
    this.emptyEl.hidden = hasRows;
    this.emptyEl.textContent = this.getAttribute('empty-text') || DEFAULT_EMPTY_TEXT;
    this.svgEl.style.display = hasRows ? '' : 'none';
    this.svgEl.replaceChildren();
    this.svgEl.classList.remove('emph');
    this.stacks = [];
    // A chart with focusable rows is a group of buttons. One without is a single image.
    this.svgEl.setAttribute('role', this.clickable ? 'group' : 'img');
    this.svgEl.setAttribute('aria-label', summarize(rows, series, fmt));
    if (hasRows) this.paintPlot();
  }

  private paintPlot(): void {
    const { series, rows, markers, format: fmt } = this.state;
    const width = this.width > 0 ? this.width : this.clientWidth;
    const measure = this.measurer();
    const totals = rows.map((r) => rowTotal(r, series));
    const scale = barScale(totals, this.state.max);

    let widest = 0;
    for (const r of rows) widest = Math.max(widest, measure(r.label));
    const gutter = gutterWidth(width, widest + LABEL_PAD);
    let valuePad = 0;
    if (this.showValues) for (const t of totals) valuePad = Math.max(valuePad, measure(fmt(t)) + VALUE_PAD * 2);
    const lastTick = scale.ticks.length > 0 ? measure(fmt(scale.ticks[scale.ticks.length - 1])) / 2 + 2 : 0;
    const plotWidth = Math.max(0, width - gutter - Math.max(valuePad, lastTick, 4));
    const top = TOP_PAD + (markers.length > 0 ? MARKER_LANE : 0);
    this.layout = { top, rowHeight: ROW_HEIGHT, rowGap: ROW_GAP, plotLeft: gutter, plotWidth };
    const rowsBottom = rowY(rows.length, this.layout) - ROW_GAP;
    const height = rowsBottom + AXIS_HEIGHT;
    this.svgEl.setAttribute('height', String(height));
    this.svgEl.setAttribute('viewBox', `0 0 ${Math.max(1, width)} ${height}`);

    const crisp = (x: number): number => Math.round(x) + 0.5;
    const axis = svg('g', { 'aria-hidden': 'true' });
    for (const tick of scale.ticks) {
      const x = crisp(gutter + (tick / scale.max) * plotWidth);
      axis.append(svg('line', { class: 'grid', x1: x, x2: x, y1: top - 2, y2: rowsBottom }));
      const label = svg('text', { class: 'tick', x, y: rowsBottom + 14, 'text-anchor': 'middle' });
      label.textContent = fmt(tick);
      axis.append(label);
    }
    axis.append(svg('line', { class: 'axis', x1: gutter, x2: gutter + plotWidth, y1: crisp(rowsBottom), y2: crisp(rowsBottom) }));
    this.svgEl.append(axis);

    const bars = svg('g', { class: 'bars' });
    rows.forEach((row, i) => {
      const stack = stackRow(row, series, scale.max, plotWidth);
      this.stacks.push(stack);
      bars.append(this.paintRow(row, i, stack, measure, gutter));
    });
    this.svgEl.append(bars);

    if (markers.length > 0) this.svgEl.append(this.paintMarkers(scale.max, measure, top, rowsBottom, width));
  }

  private paintRow(row: BarRow, index: number, stack: StackedRow, measure: (t: string) => number, gutter: number): SVGGElement {
    const y = rowY(index, this.layout);
    const left = this.layout.plotLeft;
    const g = svg('g', { class: 'row' });
    g.dataset.rowId = row.id;

    // The band is the hit target of the whole row, gap included.
    const band = svg('rect', { class: 'band', x: 0, y, width: left + this.layout.plotWidth, height: ROW_HEIGHT + ROW_GAP });
    if (this.clickable && !row.href) {
      band.classList.add('interactive');
      band.setAttribute('tabindex', '0');
      band.setAttribute('role', 'button');
      band.setAttribute('aria-label', `${row.label}: ${this.state.format(stack.total)}`);
      band.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          this.emitRowClick(row);
        }
      });
    }
    g.append(band);

    const text = svg('text', { class: 'label', x: 0, y: y + ROW_HEIGHT / 2 });
    text.textContent = ellipsize(row.label, gutter - LABEL_PAD, measure);
    const link = row.href ? svg('a', { href: row.href }) : null;
    link?.append(text);
    g.append(link ?? text);

    const byKey = new Map(this.state.series.map((s) => [s.key, s]));
    for (const seg of stack.segments) {
      const s = byKey.get(seg.key);
      const rect = segmentRect(seg, SEGMENT_GAP);
      const shape = seg.end
        ? svg('path', { d: endPath(left + rect.x, y, rect.width, ROW_HEIGHT, END_RADIUS) })
        : svg('rect', { x: left + rect.x, y, width: rect.width, height: ROW_HEIGHT });
      shape.classList.add('seg');
      shape.dataset.key = seg.key;
      if (s?.muted) shape.classList.add('muted');
      else if (s) shape.setAttribute('fill', this.colorOf(s));
      g.append(shape);
    }

    if (this.showValues) {
      const end = stack.segments[stack.segments.length - 1];
      const x = left + (end ? end.x + end.width : 0) + VALUE_PAD;
      const value = svg('text', { class: 'value', x, y: y + ROW_HEIGHT / 2 });
      value.textContent = this.state.format(stack.total);
      g.append(value);
    }
    return g;
  }

  private paintMarkers(scaleMax: number, measure: (t: string) => number, top: number, rowsBottom: number, width: number): SVGGElement {
    const g = svg('g', { class: 'markers', 'aria-hidden': 'true' });
    const left = this.layout.plotLeft;
    for (const p of placeMarkers(this.state.markers, scaleMax, this.layout.plotWidth)) {
      const kind = p.marker.kind ?? 'default';
      const x = Math.round(left + p.x) + 0.5;
      const line = svg('line', { class: `marker ${kind}`, x1: x, x2: x, y1: top - 4, y2: rowsBottom });
      if (p.offScale) line.classList.add('off');
      g.append(line);

      // An off-scale marker sits at the plot edge, and its label points the way to its value.
      const atLeft = p.x <= 0;
      const text = p.offScale ? (atLeft ? `◂ ${p.marker.label}` : `${p.marker.label} ▸`) : p.marker.label;
      const w = measure(text);
      let anchor = 'middle';
      if (p.offScale) anchor = atLeft ? 'start' : 'end';
      else if (x - w / 2 < left) anchor = 'start';
      else if (x + w / 2 > width) anchor = 'end';
      const label = svg('text', { class: `marker-label ${kind}`, x, y: top - 7, 'text-anchor': anchor });
      if (p.offScale) label.classList.add('off');
      label.textContent = text;
      g.append(label);
    }
    return g;
  }

  private paintLegend(): void {
    const { series, rows } = this.state;
    const show = this.legend && series.length >= 2 && rows.length > 0;
    this.legendEl.hidden = !show;
    const items: HTMLLIElement[] = [];
    for (const s of show ? series : []) {
      const li = html('li', '');
      li.append(this.swatch(s), document.createTextNode(s.label ?? s.key));
      items.push(li);
    }
    this.legendEl.replaceChildren(...items);
  }

  /** The same numbers as a table, for a reader that cannot see the picture. */
  private paintTable(): void {
    const { series, rows, format: fmt } = this.state;
    const header = (text: string, scope: 'col' | 'row'): HTMLTableCellElement => {
      const th = html('th', '', text);
      th.scope = scope;
      return th;
    };
    const head = html('tr', '');
    for (const name of ['Row', ...series.map((s) => s.label ?? s.key), 'Total']) head.append(header(name, 'col'));
    const thead = html('thead', '');
    thead.append(head);
    const tbody = html('tbody', '');
    for (const row of rows) {
      const tr = html('tr', '');
      tr.append(header(row.label, 'row'));
      const stack = stackRow(row, series, 1, 1);
      for (const s of series) tr.append(html('td', '', fmt(stack.segments.find((seg) => seg.key === s.key)?.value ?? 0)));
      tr.append(html('td', '', fmt(stack.total)));
      tbody.append(tr);
    }
    if (rows.length > 0) this.tableEl.replaceChildren(thead, tbody);
    else this.tableEl.replaceChildren();
  }

  private hitAt(e: MouseEvent): BarHit | null {
    const svgBox = this.svgEl.getBoundingClientRect();
    return hitTestBars(e.clientX - svgBox.left, e.clientY - svgBox.top, this.layout, this.stacks);
  }

  private hover(e: PointerEvent): void {
    const hit = this.hitAt(e);
    if (hit === null) {
      this.unhover();
      return undefined;
    }
    const row = this.state.rows[hit.rowIndex];
    const series = hit.seriesKey === null ? null : (this.state.series.find((s) => s.key === hit.seriesKey) ?? null);
    const key = `${hit.rowIndex}:${hit.seriesKey ?? ''}`;
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      this.emphasize(series && !series.muted ? series.key : null);
      this.fillTooltip(hit.rowIndex, series);
      this.emitHover(row, series);
    }
    this.placeTooltip(e);
  }

  private unhover(): void {
    if (this.hoverKey !== '') {
      this.hoverKey = '';
      this.emphasize(null);
      this.tipEl.hidden = true;
      this.emitHover(null, null);
    }
  }

  private clicked(e: MouseEvent): void {
    const hit = this.hitAt(e);
    const row = hit ? this.state.rows[hit.rowIndex] : null;
    if (row && !row.href) this.emitRowClick(row);
  }

  private emitHover(row: BarRow | null, series: BarSeries | null): void {
    this.dispatchEvent(new CustomEvent<BarSegmentHoverDetail>('segment-hover', { detail: { row, series }, bubbles: true, composed: true }));
  }

  private emitRowClick(row: BarRow): void {
    this.dispatchEvent(new CustomEvent<BarRowClickDetail>('row-click', { detail: { row }, bubbles: true, composed: true }));
  }

  /** Dim every segment that is not of `key`. A muted segment never dims. */
  private emphasize(key: string | null): void {
    this.svgEl.classList.toggle('emph', key !== null);
    for (const seg of this.svgEl.querySelectorAll<SVGElement>('.seg')) seg.classList.toggle('hot', key !== null && seg.dataset.key === key);
  }

  private fillTooltip(rowIndex: number, series: BarSeries | null): void {
    const row = this.state.rows[rowIndex];
    const stack = this.stacks[rowIndex];
    const fmt = this.state.format;
    const line = (label: string, value: string, swatchOf: BarSeries | null): HTMLDivElement => {
      const div = html('div', 'line');
      if (swatchOf) div.append(this.swatch(swatchOf));
      div.append(document.createTextNode(label), html('span', 'num', value));
      return div;
    };
    this.tipEl.replaceChildren(html('div', 'title', row.label));
    if (series) {
      const seg = stack.segments.find((s) => s.key === series.key);
      this.tipEl.append(line(series.label ?? series.key, `${fmt(seg?.value ?? 0)} · ${formatShare(seg?.share ?? 0)}`, series));
    }
    this.tipEl.append(line('Total', fmt(stack.total), null));
    if (row.detail) this.tipEl.append(html('div', 'detail', row.detail));
    this.tipEl.hidden = false;
  }

  /** Put the tooltip beside the pointer, flipped to the other side at the host's right edge. */
  private placeTooltip(e: MouseEvent): void {
    const hostBox = this.getBoundingClientRect();
    const tipW = this.tipEl.offsetWidth;
    let left = e.clientX - hostBox.left + 12;
    if (left + tipW > hostBox.width) left = Math.max(0, e.clientX - hostBox.left - tipW - 12);
    this.tipEl.style.left = `${left}px`;
    this.tipEl.style.top = `${e.clientY - hostBox.top + 14}px`;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('bar-chart')) {
  customElements.define('bar-chart', BarChartElement);
}
