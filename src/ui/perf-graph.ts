/**
 * <perf-graph> — a compact, stackable, canvas-rendered performance graph.
 *
 * One element = one scrolling metric strip (frame time, fps, heap MB, any
 * numeric gauge). push(value) appends a sample; the newest sample hugs the
 * right edge and history scrolls left. EVERY pixel — including all text — is
 * drawn on the one <canvas> via fillText (zero DOM text nodes, no layout),
 * so a whole column of stacked instances costs N canvases and nothing else.
 * Dependency-free.
 *
 *   import 'https://…/js-snippets/ui/perf-graph.js'; // registers <perf-graph>
 *
 *   <perf-graph label="frame" unit="ms" budget="16.7"></perf-graph>
 *
 *   const g = document.querySelector('perf-graph');
 *   requestAnimationFrame(function tick(now) {
 *     g.push(now - last); last = now;
 *     requestAnimationFrame(tick);
 *   });
 *
 * Cheap by construction: a redraw happens only when new data / size / theme
 * arrived (dirty flag, at most one rAF pending, none when idle), drawing is
 * skipped entirely while the tab is hidden or the element is scrolled out of
 * view (one deferred draw runs on becoming visible), the backing store is
 * DPR-exact (crisp on HiDPI), and a steady-state draw allocates nothing —
 * stats/bins go into preallocated buffers, tick arrays rebuild only when the
 * display range moves, font strings are cached (transient formatted value
 * strings are the accepted exception).
 *
 * Theme via --perf-graph-* CSS custom properties (see THEME_DEFAULTS; dark
 * "Scratch Proto" defaults). The pure math lives in ui/perf-graph-math.ts
 * (node-tested) and is re-exported here so one import serves both.
 */

import {
  SampleRing,
  computeStats,
  autoRange,
  niceStep,
  niceTicks,
  binMinMax,
  formatValue,
  type PerfStats,
  type AutoRangeOptions,
} from './perf-graph-math.ts';

export * from './perf-graph-math.ts';

// -- Defaults ------------------------------------------------------------------

const DEFAULT_HISTORY = 240;
const DEFAULT_HEIGHT = 48;
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

/**
 * The graph element. Auto-registered as `<perf-graph>` when this module loads
 * (unless that name is already taken). Attributes (all optional, mirrored by
 * properties): `label`, `unit` ('ms' default | 'fps' | custom suffix | ''),
 * `history` (sample count, default 240), `height` (CSS px, default 48),
 * `min` / `max` (fixed scale ends; absent → autoscale), `budget` (dashed
 * guide value, e.g. 16.7). API: push(value), clear(), refreshTheme().
 */
export class PerfGraphElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['label', 'unit', 'history', 'height', 'min', 'max', 'budget'];
  }

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;

  private ring = new SampleRing(DEFAULT_HISTORY);
  private stats: PerfStats = { current: NaN, avg: NaN, min: NaN, max: NaN };

  // Attribute caches (kept in sync by attributeChangedCallback) so a draw
  // never re-parses attributes.
  private aLabel = '';
  private aUnit = DEFAULT_UNIT;
  private aMin: number | null = null;
  private aMax: number | null = null;
  private aBudget: number | null = null;

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

  // Cached theme + prebuilt ctx font strings (rebuilt on connect / resize /
  // DPR change / refreshTheme(), never per frame).
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
        break;
      case 'height':
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

  /** Number of samples kept and displayed (default 240). */
  get history(): number {
    return this.ring.capacity;
  }
  set history(v: number) {
    this.setAttribute('history', String(v));
  }

  /** Element height in CSS px (default 48). */
  get height(): number {
    return parseNum(this.getAttribute('height')) ?? DEFAULT_HEIGHT;
  }
  set height(v: number) {
    this.setAttribute('height', String(v));
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

  /** Append one sample and schedule (at most) one rAF redraw. */
  push(value: number): void {
    this.ring.push(value);
    this.dirty = true;
    this.schedule();
  }

  /** Drop all samples. */
  clear(): void {
    this.ring.clear();
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
    const h = parseNum(this.getAttribute('height'));
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
    let dLo = this.stats.min;
    let dHi = this.stats.max;
    const b = this.aBudget;
    if (b != null) {
      dLo = Number.isFinite(dLo) ? Math.min(dLo, b) : b;
      dHi = Number.isFinite(dHi) ? Math.max(dHi, b) : b;
    }
    const opts = this.rangeOpts;
    opts.fixedMin = this.aMin ?? undefined;
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, w, h);

    computeStats(this.ring, this.stats);
    this.updateRange();
    const lo = this.rangeMin;
    const hi = this.rangeMax;
    const plotTop = 1;
    const plotBottom = h - 1;
    const sy = (plotBottom - plotTop) / (hi - lo);
    const hairline = 1 / dpr;
    const fs = t.fontSize;

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
      // (label/current) or bottom (stats) readout rows.
      if (y > fs * 2 + PAD_Y + 3 && y < h - fs - PAD_Y) {
        ctx.fillStyle = t.text;
        ctx.font = this.fontText;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(formatValue(tick, ''), PAD_X, y - 1);
      }
    }

    // Data: min-max columns when samples outnumber device pixels, else a
    // polyline (+ soft area fill). Newest sample at the right edge.
    const count = this.ring.length;
    const cap = this.ring.capacity;
    const plotWdev = this.canvas.width;
    if (count > plotWdev) {
      const binsUsed = Math.max(1, Math.min(plotWdev, Math.floor((plotWdev * count) / cap)));
      binMinMax(this.ring, binsUsed, this.binMin, this.binMax);
      const x0 = w - binsUsed * hairline; // right-aligned, 1 device px per bin
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
    ctx.font = this.fontValue;
    ctx.textAlign = 'right';
    ctx.fillText(formatValue(this.stats.current, this.aUnit), w - PAD_X, PAD_Y);
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

// Auto-register under the conventional tag name, but never clobber an existing
// definition (a consumer may have registered their own, or loaded this twice).
if (typeof customElements !== 'undefined' && !customElements.get('perf-graph')) {
  customElements.define('perf-graph', PerfGraphElement);
}
