/** <perf-graph> — a compact, stackable, canvas-rendered performance graph. */

import {
  SampleRing,
  SeriesRing,
  computeStats,
  autoRange,
  niceStep,
  niceTicks,
  binMinMax,
  binLast,
  stackedMax,
  stackedTotal,
  formatValue,
  type PerfStats,
  type AutoRangeOptions,
  type SeriesSpec,
} from './perf-graph-math.ts';
import { categoryColor, categoryHue } from './color.ts';

export * from './perf-graph-math.ts';

// -- Defaults ------------------------------------------------------------------

const DEFAULT_HISTORY = 240;
const DEFAULT_HEIGHT = 48;
/** Default height of a `compact` graph: one text row over the trace. */
const DEFAULT_HEIGHT_COMPACT = 32;
const DEFAULT_UNIT = 'ms';
const MAX_TICKS = 3;
const PAD_X = 3; // CSS px text inset
const PAD_Y = 2;

/** Dash pattern for the budget guide line (canvas copies it; shared const). */
const BUDGET_DASH: number[] = [4, 3];
const SOLID_DASH: number[] = [];

/**
 * Theme defaults — the dark "Scratch Proto" palette (deep slate background,
 * signal-green trace, amber budget line, JetBrains-Mono-ish stack). Override
 * per element / ancestor / :root with the CSS custom properties named here.
 */
export const THEME_DEFAULTS = {
  /** --perf-graph-bg — plot background. */
  bg: '#0d0f14',
  /** --perf-graph-line — data polyline / min-max columns. */
  line: '#00e47a',
  /** --perf-graph-fill — soft area fill under the polyline ('none' disables). */
  fill: 'rgba(0, 228, 122, 0.10)',
  /** --perf-graph-grid — horizontal gridlines. */
  grid: 'rgba(200, 205, 216, 0.08)',
  /** --perf-graph-text — label, stats line, tick labels. */
  text: '#6b7280',
  /** --perf-graph-value — the emphasised current-value readout. */
  value: '#e8ecf4',
  /** --perf-graph-budget — the dashed budget guide line. */
  budget: '#f0a500',
  /** --perf-graph-font — font family for all canvas text. */
  font: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
  /** --perf-graph-font-size — base font size in px (the value readout is +1). */
  fontSize: 10,
};

type Theme = typeof THEME_DEFAULTS;

// -- The custom element ----------------------------------------------------------

/** The graph element. Auto-registered as `<perf-graph>` when this module loads
 * (unless that name is already taken). API: push(value), clear(),
 * refreshTheme(). */
export class PerfGraphElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['label', 'unit', 'history', 'height', 'min', 'max', 'budget', 'compact'];
  }

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;

  private ring = new SampleRing(DEFAULT_HISTORY);
  private stats: PerfStats = { current: NaN, avg: NaN, min: NaN, max: NaN };

  // Stacked mode. specs is empty for a plain single-series graph, and the series ring.
  private specs: SeriesSpec[] = [];
  private seriesRing = new SeriesRing([], DEFAULT_HISTORY);
  private colors: string[] = [];
  // Per-series band tops, one entry per drawn column.
  private tops: Float64Array[] = [];
  private binScratch = new Float32Array(0);

  // Attribute caches (kept in sync by attributeChangedCallback) so a draw never re-parses attributes.
  private aLabel = '';
  private aUnit = DEFAULT_UNIT;
  private aMin: number | null = null;
  private aMax: number | null = null;
  private aBudget: number | null = null;
  private aCompact = false;

  // Backing store: device px in canvas.width/height, CSS px mirrors here.
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;

  // Preallocated min-max bins, sized to the backing-store width on resize.
  private binMin = new Float32Array(0);
  private binMax = new Float32Array(0);

  // Display range + ticks, recomputed only when the (quantized) range moves.
  private rangeMin = NaN;
  private rangeMax = NaN;
  private ticks: number[] = [];
  private rangeOpts: AutoRangeOptions = { pad: 0.08 };

  // Cached theme + prebuilt ctx font strings.
  private theme: Theme = { ...THEME_DEFAULTS };
  private fontText = '';
  private fontValue = '';

  private raf = 0;
  private dirty = false;
  private connected = false;
  private inView = true;
  private heightApplied = false;
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      `:host { display: block; width: 100%; height: ${DEFAULT_HEIGHT}px; }` +
      'canvas { display: block; width: 100%; height: 100%; }';
    this.canvas = document.createElement('canvas');
    shadow.append(style, this.canvas);
  }

  // -- Lifecycle -------------------------------------------------------------

  connectedCallback(): void {
    this.connected = true;
    this.applyHeight();
    this.readTheme();

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.onResize);
      this.ro.observe(this);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver(this.onIntersect);
      this.io.observe(this);
    }
    document.addEventListener('visibilitychange', this.onVisibility);

    this.resizeBackingStore(); // initial size, even if the observer is late
    this.dirty = true;
    this.schedule();
  }

  disconnectedCallback(): void {
    this.connected = false;
    this.ro?.disconnect();
    this.ro = null;
    this.io?.disconnect();
    this.io = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    switch (name) {
      case 'label':
        this.aLabel = value ?? '';
        break;
      case 'unit':
        this.aUnit = value ?? DEFAULT_UNIT;
        break;
      case 'history':
        this.ring.setCapacity(parseNum(value) ?? DEFAULT_HISTORY);
        this.seriesRing.setCapacity(parseNum(value) ?? DEFAULT_HISTORY);
        break;
      case 'height':
        this.applyHeight();
        break;
      case 'compact':
        this.aCompact = value != null;
        this.applyHeight();
        break;
      case 'min':
      case 'max':
      case 'budget':
        this.aMin = parseNum(this.getAttribute('min'));
        this.aMax = parseNum(this.getAttribute('max'));
        this.aBudget = parseNum(this.getAttribute('budget'));
        this.rangeMin = NaN; // force a range + tick recompute
        this.rangeMax = NaN;
        break;
    }
    this.dirty = true;
    this.schedule();
  }

  // -- Attribute-mirroring properties -----------------------------------------

  /** Name drawn in the top-left corner. */
  get label(): string {
    return this.aLabel;
  }
  set label(v: string) {
    if (v) this.setAttribute('label', v);
    else this.removeAttribute('label');
  }

  /** Unit suffix: 'ms' (default), 'fps', a custom suffix, or '' for bare numbers. */
  get unit(): string {
    return this.aUnit;
  }
  set unit(v: string) {
    this.setAttribute('unit', v ?? '');
  }

  /* */
  get history(): number {
    return this.ring.capacity;
  }
  set history(v: number) {
    this.setAttribute('history', String(v));
  }

  /* */
  get height(): number {
    return parseNum(this.getAttribute('height')) ?? (this.aCompact ? DEFAULT_HEIGHT_COMPACT : DEFAULT_HEIGHT);
  }
  set height(v: number) {
    this.setAttribute('height', String(v));
  }

  /** Compact mode: label + current value in one row, no stats, no tick labels. */
  get compact(): boolean {
    return this.aCompact;
  }
  set compact(v: boolean) {
    this.toggleAttribute('compact', !!v);
  }

  /** Fixed low end of the scale, or null for autoscale. */
  get min(): number | null {
    return this.aMin;
  }
  set min(v: number | null) {
    if (v == null || !Number.isFinite(v)) this.removeAttribute('min');
    else this.setAttribute('min', String(v));
  }

  /** Fixed high end of the scale, or null for autoscale. */
  get max(): number | null {
    return this.aMax;
  }
  set max(v: number | null) {
    if (v == null || !Number.isFinite(v)) this.removeAttribute('max');
    else this.setAttribute('max', String(v));
  }

  /** Budget guide value (dashed line, kept inside the displayed range), or null. */
  get budget(): number | null {
    return this.aBudget;
  }
  set budget(v: number | null) {
    if (v == null || !Number.isFinite(v)) this.removeAttribute('budget');
    else this.setAttribute('budget', String(v));
  }

  // -- Public API ------------------------------------------------------------

  /** The stacked bands, bottom-up. An empty list (the default) leaves the
   * element a plain single-series graph. */
  get series(): readonly SeriesSpec[] {
    return this.specs;
  }
  set series(v: readonly SeriesSpec[]) {
    this.specs = v.map((spec) => ({ ...spec }));
    this.seriesRing.setKeys(this.specs.map((spec) => spec.key));
    this.colors = this.specs.map((spec) => spec.color ?? categoryColor(categoryHue(spec.key)));
    this.tops = []; // resized on the next draw
    this.rangeMin = NaN;
    this.rangeMax = NaN;
    this.dirty = true;
    this.schedule();
  }

  /** True while `series` is set, i.e. while this graph draws a stacked area. */
  get stacked(): boolean {
    return this.specs.length > 0;
  }

  /** Append one sample and schedule (at most) one rAF redraw. */
  push(value: number): void {
    this.ring.push(value);
    this.dirty = true;
    this.schedule();
  }

  /** Append one stacked column: a record read by series key, or an array read
   * by series index. */
  pushSeries(values: Readonly<Record<string, number>> | readonly number[]): void {
    this.seriesRing.push(values);
    this.dirty = true;
    this.schedule();
  }

  /** Drop all samples, single-series and stacked alike. */
  clear(): void {
    this.ring.clear();
    this.seriesRing.clear();
    this.rangeMin = NaN;
    this.rangeMax = NaN;
    this.dirty = true;
    this.schedule();
  }

  /** Re-read the --perf-graph-* custom properties (call after retheming). */
  refreshTheme(): void {
    this.readTheme();
    this.dirty = true;
    this.schedule();
  }

  // -- Scheduling / visibility -------------------------------------------------

  private schedule(): void {
    if (!this.connected || this.raf !== 0) return;
    // Hidden tab or out-of-view element: stay dirty, draw once on return.
    if (!this.inView || document.hidden) return;
    this.raf = requestAnimationFrame(this.onFrame);
  }

  private onFrame = (): void => {
    this.raf = 0;
    this.draw();
  };

  private onResize = (): void => {
    this.resizeBackingStore();
  };

  private onIntersect = (entries: IntersectionObserverEntry[]): void => {
    this.inView = entries[entries.length - 1].isIntersecting;
    if (this.inView && this.dirty) this.schedule();
  };

  private onVisibility = (): void => {
    if (!document.hidden && this.dirty) this.schedule();
  };

  // -- Sizing / theme ------------------------------------------------------------

  private applyHeight(): void {
    // The compact default is applied inline too: the :host rule carries the full-size default.
    const h = parseNum(this.getAttribute('height')) ?? (this.aCompact ? DEFAULT_HEIGHT_COMPACT : null);
    if (h != null) this.style.height = `${Math.max(1, h)}px`;
    else if (this.heightApplied) this.style.height = ''; // never clobber a user's own inline height
    this.heightApplied = h != null;
  }

  /** Match the backing store to client size × devicePixelRatio (integer device px). */
  private resizeBackingStore(): void {
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const bw = Math.max(1, Math.round(this.clientWidth * dpr));
    const bh = Math.max(1, Math.round(this.clientHeight * dpr));
    if (bw === this.canvas.width && bh === this.canvas.height && dpr === this.dpr) return;
    this.canvas.width = bw;
    this.canvas.height = bh;
    this.dpr = dpr;
    this.cssW = bw / dpr;
    this.cssH = bh / dpr;
    if (this.binMin.length !== bw) {
      this.binMin = new Float32Array(bw);
      this.binMax = new Float32Array(bw);
      this.tops = []; // the column count moved with the width
    }
    this.readTheme(); // size or DPR moved — colors may be media-query-bound too
    this.dirty = true;
    this.schedule();
  }

  private readTheme(): void {
    const cs = getComputedStyle(this);
    const t = this.theme;
    t.bg = readProp(cs, '--perf-graph-bg', THEME_DEFAULTS.bg);
    t.line = readProp(cs, '--perf-graph-line', THEME_DEFAULTS.line);
    t.fill = readProp(cs, '--perf-graph-fill', THEME_DEFAULTS.fill);
    t.grid = readProp(cs, '--perf-graph-grid', THEME_DEFAULTS.grid);
    t.text = readProp(cs, '--perf-graph-text', THEME_DEFAULTS.text);
    t.value = readProp(cs, '--perf-graph-value', THEME_DEFAULTS.value);
    t.budget = readProp(cs, '--perf-graph-budget', THEME_DEFAULTS.budget);
    t.font = readProp(cs, '--perf-graph-font', THEME_DEFAULTS.font);
    const size = parseFloat(readProp(cs, '--perf-graph-font-size', ''));
    t.fontSize = Number.isFinite(size) && size > 0 ? size : THEME_DEFAULTS.fontSize;
    this.fontText = `${t.fontSize}px ${t.font}`;
    this.fontValue = `600 ${t.fontSize + 1}px ${t.font}`;
  }

  // -- Range ---------------------------------------------------------------------

  /**
   * Display range: fixed ends win; otherwise autoRange over data (+ budget),
   * with the free ends quantized outward to a nice step so the range — and
   * therefore the tick array — only rebuilds when data crosses a grid line.
   */
  private updateRange(): void {
    let dLo = this.stacked ? 0 : this.stats.min;
    let dHi = this.stacked ? stackedMax(this.seriesRing) : this.stats.max;
    const b = this.aBudget;
    if (b != null) {
      dLo = Number.isFinite(dLo) ? Math.min(dLo, b) : b;
      dHi = Number.isFinite(dHi) ? Math.max(dHi, b) : b;
    }
    const opts = this.rangeOpts;
    opts.fixedMin = this.aMin ?? (this.stacked ? 0 : undefined);
    opts.fixedMax = this.aMax ?? undefined;
    const r = autoRange(dLo, dHi, opts);
    let lo = r.min;
    let hi = r.max;
    if (this.aMin == null || this.aMax == null) {
      const step = niceStep(hi - lo, MAX_TICKS + 1);
      if (this.aMin == null) lo = Math.floor(lo / step) * step;
      if (this.aMax == null) hi = Math.ceil(hi / step) * step;
    }
    if (lo !== this.rangeMin || hi !== this.rangeMax) {
      this.rangeMin = lo;
      this.rangeMax = hi;
      this.ticks = niceTicks(lo, hi, MAX_TICKS);
    }
  }

  // -- Drawing ---------------------------------------------------------------------

  private draw(): void {
    // Cheap DPR-change detection: zoom / monitor moves resize the store.
    const dprNow = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    if (dprNow !== this.dpr) this.resizeBackingStore();
    if (!this.dirty) return;
    const ctx = (this.ctx ??= this.canvas.getContext('2d'));
    if (!ctx) return;
    this.dirty = false;

    const dpr = this.dpr;
    const w = this.cssW;
    const h = this.cssH;
    const t = this.theme;
    // The background may be translucent.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, w, h);

    computeStats(this.ring, this.stats);
    this.updateRange();
    const lo = this.rangeMin;
    const hi = this.rangeMax;
    const fs = t.fontSize;
    const plotTop = 1;
    const plotBottom = h - 1;
    const sy = (plotBottom - plotTop) / (hi - lo);
    const hairline = 1 / dpr;

    // Horizontal gridlines + tick labels (skip rows the readout text owns).
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = hairline;
    for (let i = 0; i < this.ticks.length; i++) {
      const tick = this.ticks[i];
      if (tick < lo || tick > hi) continue;
      const y = (Math.floor((plotBottom - (tick - lo) * sy) * dpr) + 0.5) / dpr;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      // Label the line only where the text won't collide with the top
      // (label/current) or bottom (stats) readout rows. Compact has no room.
      if (!this.aCompact && y > fs * 2 + PAD_Y + 3 && y < h - fs - PAD_Y) {
        ctx.fillStyle = t.text;
        ctx.font = this.fontText;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(formatValue(tick, ''), PAD_X, y - 1);
      }
    }

    if (this.stacked) this.drawBands(ctx, lo, sy, plotTop, plotBottom);
    else this.drawTrace(ctx, lo, sy, plotTop, plotBottom, hairline);

    // Budget guide: dashed, visually distinct, drawn over the data.
    const budget = this.aBudget;
    if (budget != null && budget >= lo && budget <= hi) {
      const y = (Math.floor((plotBottom - (budget - lo) * sy) * dpr) + 0.5) / dpr;
      ctx.strokeStyle = t.budget;
      ctx.lineWidth = 1;
      ctx.setLineDash(BUDGET_DASH);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash(SOLID_DASH);
    }

    // Readout text: label top-left, current top-right, stats bottom-left.
    ctx.textBaseline = 'top';
    if (this.aLabel !== '') {
      ctx.fillStyle = t.text;
      ctx.font = this.fontText;
      ctx.textAlign = 'left';
      ctx.fillText(this.aLabel, PAD_X, PAD_Y);
    }
    ctx.fillStyle = t.value;
    ctx.font = this.aCompact ? this.fontText : this.fontValue;
    ctx.textAlign = 'right';
    ctx.fillText(formatValue(this.currentReadout(), this.aUnit), w - PAD_X, PAD_Y);
    if (this.aCompact) return;
    if (this.stacked) {
      this.drawLegend(ctx, w, h);
      return;
    }
    ctx.fillStyle = t.text;
    ctx.font = this.fontText;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
      `avg ${formatValue(this.stats.avg, this.aUnit)}  min ${formatValue(this.stats.min, this.aUnit)}  max ${formatValue(this.stats.max, this.aUnit)}`,
      PAD_X,
      h - PAD_Y,
    );
  }

  /** The number the top-right readout shows: the newest column's total when stacked. */
  private currentReadout(): number {
    if (!this.stacked) return this.stats.current;
    const last = this.seriesRing.length - 1;
    return last < 0 ? NaN : stackedTotal(this.seriesRing, last);
  }

  /**
   * Single-series data: min-max columns when samples outnumber device pixels,
   * else a polyline (+ soft area fill). Newest sample at the right edge.
   */
  private drawTrace(
    ctx: CanvasRenderingContext2D,
    lo: number,
    sy: number,
    plotTop: number,
    plotBottom: number,
    hairline: number,
  ): void {
    const t = this.theme;
    const w = this.cssW;
    const count = this.ring.length;
    const cap = this.ring.capacity;
    const plotWdev = this.canvas.width;
    if (count > plotWdev) {
      const binsUsed = Math.max(1, Math.min(plotWdev, Math.floor((plotWdev * count) / cap)));
      binMinMax(this.ring, binsUsed, this.binMin, this.binMax);
      const x0 = w - binsUsed * hairline;
      ctx.fillStyle = t.line;
      for (let bin = 0; bin < binsUsed; bin++) {
        const mn = this.binMin[bin];
        if (mn !== mn) continue; // empty bin
        let yTop = plotBottom - (this.binMax[bin] - lo) * sy;
        let yBot = plotBottom - (mn - lo) * sy;
        if (yTop < plotTop) yTop = plotTop;
        if (yBot > plotBottom) yBot = plotBottom;
        if (yBot - yTop < hairline) yBot = yTop + hairline;
        ctx.fillRect(x0 + bin * hairline, yTop, hairline, yBot - yTop);
      }
    } else if (count > 0) {
      const stepX = cap > 1 ? w / (cap - 1) : 0;
      if (t.fill !== 'none' && count > 1) {
        ctx.fillStyle = t.fill;
        ctx.beginPath();
        this.tracePath(ctx, count, stepX, lo, sy, plotTop, plotBottom);
        ctx.lineTo(w, plotBottom);
        ctx.lineTo(w - (count - 1) * stepX, plotBottom);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = t.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      this.tracePath(ctx, count, stepX, lo, sy, plotTop, plotBottom);
      ctx.stroke();
    }
  }

  /**
   * The stacked bands. Each band is filled as the whole area under its own
   * cumulative top, and the bands are painted from the top one down, so a
   * lower band simply covers the part of the one above it that it owns. That
   * is one closed path per band, and no shared edge to make agree.
   *
   * Columns are one per sample while the samples fit the backing store, and
   * one per device pixel past that, with binLast picking each column's newest
   * sample. Every band bins onto the same columns.
   */
  private drawBands(
    ctx: CanvasRenderingContext2D,
    lo: number,
    sy: number,
    plotTop: number,
    plotBottom: number,
  ): void {
    const w = this.cssW;
    const series = this.seriesRing;
    const count = series.length;
    const nSeries = series.count;
    if (count === 0 || nSeries === 0) return;

    const cap = series.capacity;
    const plotWdev = this.canvas.width;
    const binned = count > plotWdev;
    const columns = binned ? Math.max(1, Math.min(plotWdev, Math.floor((plotWdev * count) / cap))) : count;
    this.ensureTops(nSeries, columns);
    if (this.binScratch.length < columns) this.binScratch = new Float32Array(columns);

    // Cumulative tops, bottom band first: tops[s] is the top edge of band s.
    for (let s = 0; s < nSeries; s++) {
      const ring = series.ring(s);
      const out = this.tops[s];
      const below = s > 0 ? this.tops[s - 1] : null;
      if (binned && ring !== undefined) binLast(ring, columns, this.binScratch);
      for (let c = 0; c < columns; c++) {
        const raw = binned ? this.binScratch[c] : (ring?.at(c) ?? NaN);
        const v = Number.isFinite(raw) ? raw : 0;
        out[c] = (below === null ? 0 : below[c]) + v;
      }
    }

    // One device pixel per column when binned, otherwise the sample pitch the single-series trace uses.
    const stepX = binned ? 1 / this.dpr : cap > 1 ? w / (cap - 1) : 0;
    const xAt = (c: number): number => w - (columns - 1 - c) * stepX;
    for (let s = nSeries - 1; s >= 0; s--) {
      const top = this.tops[s];
      ctx.fillStyle = this.colors[s];
      ctx.beginPath();
      ctx.moveTo(xAt(0), plotBottom);
      for (let c = 0; c < columns; c++) {
        let y = plotBottom - (top[c] - lo) * sy;
        if (y < plotTop) y = plotTop;
        else if (y > plotBottom) y = plotBottom;
        ctx.lineTo(xAt(c), y);
      }
      ctx.lineTo(xAt(columns - 1), plotBottom);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Size the per-band cumulative-top scratch to the current series and columns. */
  private ensureTops(nSeries: number, columns: number): void {
    if (this.tops.length === nSeries && (nSeries === 0 || this.tops[0].length >= columns)) return;
    this.tops = [];
    for (let s = 0; s < nSeries; s++) this.tops.push(new Float64Array(columns));
  }

  /**
   * The legend row, in place of the stats line: a swatch and the newest value
   * per band, left to right, stopping at the edge rather than overflowing it.
   */
  private drawLegend(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const t = this.theme;
    const last = this.seriesRing.length - 1;
    const fs = t.fontSize;
    const swatch = Math.max(4, Math.round(fs * 0.7));
    const y = h - PAD_Y;
    ctx.font = this.fontText;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    let x = PAD_X;
    for (let s = 0; s < this.specs.length; s++) {
      const value = last < 0 ? NaN : this.seriesRing.at(s, last);
      const text = `${this.specs[s].label ?? this.specs[s].key} ${formatValue(value, this.aUnit)}`;
      const width = swatch + 3 + ctx.measureText(text).width;
      if (x + width > w - PAD_X) {
        // No room for this band's entry: say how many are unlisted instead of drawing a half one off the edge.
        ctx.fillStyle = t.text;
        ctx.fillText(`+${this.specs.length - s}`, x, y);
        return;
      }
      ctx.fillStyle = this.colors[s];
      ctx.fillRect(x, y - swatch, swatch, swatch);
      ctx.fillStyle = t.text;
      ctx.fillText(text, x + swatch + 3, y);
      x += width + fs;
    }
  }

  /** Emit the polyline path for the current samples (oldest → newest at right edge). */
  private tracePath(
    ctx: CanvasRenderingContext2D,
    count: number,
    stepX: number,
    lo: number,
    sy: number,
    plotTop: number,
    plotBottom: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const x = this.cssW - (count - 1 - i) * stepX;
      let y = plotBottom - (this.ring.at(i) - lo) * sy;
      if (y < plotTop) y = plotTop;
      else if (y > plotBottom) y = plotBottom;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
}

// -- Helpers -----------------------------------------------------------------------

function parseNum(v: string | null): number | null {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function readProp(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = cs.getPropertyValue(name).trim();
  return v !== '' ? v : fallback;
}

// Auto-register under the conventional tag name, but never clobber an
// existing definition.
if (typeof customElements !== 'undefined' && !customElements.get('perf-graph')) {
  customElements.define('perf-graph', PerfGraphElement);
}
