// Pure math for the <perf-graph> element: a fixed-capacity Float32Array ring
// buffer, stats / display-range / tick helpers, a min-max downsampler for
// more-samples-than-pixels rendering, and the HUD value formatter. No DOM or
// browser APIs — everything here runs (and is tested) under node;
// ui/perf-graph.ts is the canvas-bound half that consumes it.
//
// Hot paths are allocation-free by design: SampleRing allocates only in the
// constructor and setCapacity(), and computeStats / binMinMax write into
// caller-owned outputs, so a per-frame HUD redraw performs no allocation.
// niceTicks is the one allocating helper — call it only when the display
// range changes.

// -- Ring buffer ---------------------------------------------------------------

/**
 * Fixed-capacity ring buffer of f32 samples: push() overwrites the oldest
 * sample once full. Values are stored as float32 (they round-trip through
 * Math.fround). Only the constructor and setCapacity() allocate.
 */
export class SampleRing {
  private buf: Float32Array;
  private head = 0; // next write position
  private count = 0; // valid samples (<= capacity)

  /* */
  constructor(capacity: number) {
    this.buf = new Float32Array(clampCapacity(capacity));
  }

  /** Number of samples currently stored. */
  get length(): number {
    return this.count;
  }

  /** Maximum number of samples held before the oldest is overwritten. */
  get capacity(): number {
    return this.buf.length;
  }

  /** Append a sample, overwriting the oldest once full. */
  push(v: number): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.buf.length;
    if (this.count < this.buf.length) this.count++;
  }

  /*NaN out of range. */
  at(i: number): number {
    if (i < 0 || i >= this.count) return NaN;
    const cap = this.buf.length;
    return this.buf[(this.head - this.count + i + cap) % cap];
  }

  /** The most recent sample (NaN when empty). */
  latest(): number {
    if (this.count === 0) return NaN;
    const cap = this.buf.length;
    return this.buf[(this.head - 1 + cap) % cap];
  }

  /** Drop all samples (keeps the buffer). */
  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /**
   * Resize the ring, preserving the newest samples that still fit. A no-op
   * (and allocation-free) when the capacity is unchanged.
   */
  setCapacity(n: number): void {
    const cap = clampCapacity(n);
    if (cap === this.buf.length) return;
    const next = new Float32Array(cap);
    const keep = Math.min(this.count, cap);
    for (let i = 0; i < keep; i++) next[i] = this.at(this.count - keep + i);
    this.buf = next;
    this.head = keep % cap;
    this.count = keep;
  }
}

function clampCapacity(n: number): number {
  return Math.max(1, Math.floor(n) || 1);
}

// -- Stats ---------------------------------------------------------------------

/** Caller-owned stats output for computeStats (reuse one object across frames). */
export interface PerfStats {
  /** The most recent sample, verbatim (NaN when empty). */
  current: number;
  /** Mean of the finite samples (NaN when there are none). */
  avg: number;
  /** Minimum finite sample (NaN when there are none). */
  min: number;
  /** Maximum finite sample (NaN when there are none). */
  max: number;
}

/** Fill `out` with the stats of the ring's contents. Non-finite samples are
 * skipped for avg/min/max (all of them are NaN when no finite sample exists);
 * `current` is the raw latest sample. Writes into the caller-owned object —
 * no allocation — and returns it. */
export function computeStats(ring: SampleRing, out: PerfStats): PerfStats {
  let n = 0;
  let sum = 0;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const v = ring.at(i);
    if (!Number.isFinite(v)) continue;
    n++;
    sum += v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  out.current = ring.latest();
  out.avg = n > 0 ? sum / n : NaN;
  out.min = n > 0 ? mn : NaN;
  out.max = n > 0 ? mx : NaN;
  return out;
}

// -- Display range ---------------------------------------------------------------

/** Options for autoRange. */
export interface AutoRangeOptions {
  /** Pin the low end exactly (no padding is applied to a pinned end). */
  fixedMin?: number;
  /** Pin the high end exactly (no padding is applied to a pinned end). */
  fixedMax?: number;
  /* */
  pad?: number;
  /* */
  includeZero?: boolean;
}

/** A display range: what maps to the bottom and top of the plot. */
export interface DisplayRange {
  min: number;
  max: number;
}

/** Padded display range for the given data extremes. Degenerate-safe:
 * empty (non-finite) or flat data still yields a usable nonzero span.
 * fixedMin / fixedMax pin their end exactly. */
export function autoRange(dataMin: number, dataMax: number, opts: AutoRangeOptions = {}): DisplayRange {
  const pad = opts.pad !== undefined && Number.isFinite(opts.pad) ? opts.pad : 0.1;
  let lo = Number.isFinite(dataMin) ? dataMin : 0;
  let hi = Number.isFinite(dataMax) ? dataMax : 1;
  if (hi < lo) {
    const t = lo;
    lo = hi;
    hi = t;
  }
  if (opts.includeZero) {
    if (lo > 0) lo = 0;
    if (hi < 0) hi = 0;
  }
  if (hi - lo <= 0) {
    // Flat (or single-value) data: synthesize a span around the value.
    const half = Math.max(Math.abs(lo) * 0.5, 0.5);
    lo -= half;
    hi += half;
  }
  const span = hi - lo;
  let min = lo - span * pad;
  let max = hi + span * pad;
  if (opts.includeZero && lo >= 0 && min < 0) min = 0;
  const { fixedMin, fixedMax } = opts;
  if (fixedMin !== undefined && Number.isFinite(fixedMin)) min = fixedMin;
  if (fixedMax !== undefined && Number.isFinite(fixedMax)) max = fixedMax;
  if (!(max > min)) {
    // Degenerate pins (equal or crossed): keep the range usable by moving the
    // un-pinned end (or, when both are pinned, the top).
    if (fixedMax !== undefined && fixedMin === undefined) min = max - 1;
    else max = min + 1;
  }
  return { min, max };
}

// -- Ticks ---------------------------------------------------------------------

const NICE_MANTISSAS = [1, 2, 5];

/* */
export function niceStep(span: number, maxTicks: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const max = Math.max(1, Math.floor(maxTicks));
  let e = Math.floor(Math.log10(span / max));
  for (;;) {
    for (let i = 0; i < NICE_MANTISSAS.length; i++) {
      const step = NICE_MANTISSAS[i] * Math.pow(10, e);
      if (span / step <= max) return step;
    }
    e++;
  }
}

/*Returns [] for an empty/invalid range. Allocates (the element calls it
 * only when the display range changes). */
export function niceTicks(lo: number, hi: number, maxTicks: number): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return [];
  const step = niceStep(hi - lo, maxTicks);
  const first = Math.ceil(lo / step);
  const last = Math.floor(hi / step);
  const ticks: number[] = [];
  for (let i = first; i <= last; i++) ticks.push(i * step);
  return ticks;
}

// -- Min-max downsampling --------------------------------------------------------

/** Min-max downsample of the ring into `bins` buckets — the classic
 * more-samples-than-pixels reduction. Empty bins (and both arrays past a
 * clamped `bins`) are NaN. `bins` is clamped to the shorter out array.
 * Writes only into the caller-owned arrays — no allocation. Returns the
 * number of non-empty bins (min(bins, count) for finite data). */
export function binMinMax(ring: SampleRing, bins: number, outMin: Float32Array, outMax: Float32Array): number {
  const nBins = Math.min(Math.max(0, Math.floor(bins)), outMin.length, outMax.length);
  for (let b = 0; b < nBins; b++) {
    outMin[b] = NaN;
    outMax[b] = NaN;
  }
  const count = ring.length;
  if (nBins === 0 || count === 0) return 0;
  let used = 0;
  for (let i = 0; i < count; i++) {
    const v = ring.at(i);
    if (!Number.isFinite(v)) continue;
    const b = Math.floor((i * nBins) / count);
    if (outMin[b] === outMin[b]) {
      // Bin already seeded: widen its envelope.
      if (v < outMin[b]) outMin[b] = v;
      if (v > outMax[b]) outMax[b] = v;
    } else {
      outMin[b] = v;
      outMax[b] = v;
      used++;
    }
  }
  return used;
}

/** Newest finite sample in each of `bins` buckets — the reduction a stacked
 * AREA wants, where binMinMax's envelope would draw a band as a ragged blur.
 * Bin membership matches binMinMax exactly (sample i lands in floor(i * bins
 * / count)), so every series of one SeriesRing bins onto the same columns and
 * the bands stay aligned. Empty bins are NaN. `bins` is clamped to
 * out.length. Writes only into the caller-owned array — no allocation. */
export function binLast(ring: SampleRing, bins: number, out: Float32Array): number {
  const nBins = Math.min(Math.max(0, Math.floor(bins)), out.length);
  for (let b = 0; b < nBins; b++) out[b] = NaN;
  const count = ring.length;
  if (nBins === 0 || count === 0) return 0;
  let used = 0;
  for (let i = 0; i < count; i++) {
    const v = ring.at(i);
    if (!Number.isFinite(v)) continue;
    const b = Math.floor((i * nBins) / count);
    if (out[b] !== out[b]) used++;
    out[b] = v; // later samples in the bin overwrite: the newest one wins
  }
  return used;
}

// -- Multi-series (stacked) ---------------------------------------------------

/** One band of a stacked graph: its data key, its legend text and its color. */
export interface SeriesSpec {
  /** The key push() reads out of a sample record. Also the color seed. */
  key: string;
  /** Legend text. Defaults to the key. */
  label?: string;
  /** Explicit CSS color. Absent, the band takes a stable color from its key. */
  color?: string;
}

/** The data behind a stacked area: one SampleRing per band, on one time
 * axis. Every push advances EVERY series, so sample i of one band lines up
 * with sample i of the next. Only the constructor, setCapacity() and
 * setKeys() allocate. */
export class SeriesRing {
  private ks: string[];
  private rings: SampleRing[];
  private cap: number;

  constructor(keys: readonly string[], capacity: number) {
    this.cap = clampCapacity(capacity);
    this.ks = keys.slice();
    this.rings = this.ks.map(() => new SampleRing(this.cap));
  }

  /** The series keys, in stacking order (index multiple sits at the bottom). */
  get keys(): readonly string[] {
    return this.ks;
  }

  /** Number of series. */
  get count(): number {
    return this.ks.length;
  }

  /** Samples currently stored per series (every series holds the same number). */
  get length(): number {
    return this.rings.length > 0 ? this.rings[0].length : 0;
  }

  /** Samples held per series before the oldest is overwritten. */
  get capacity(): number {
    return this.cap;
  }

  /** The ring behind one series (NaN-safe reads via at()). */
  ring(series: number): SampleRing | undefined {
    return this.rings[series];
  }

  /*NaN out of range. */
  at(series: number, i: number): number {
    const r = this.rings[series];
    return r === undefined ? NaN : r.at(i);
  }

  /** Append one column. A record is read by key; an array is read by
   * series index. */
  push(values: Readonly<Record<string, number>> | readonly number[]): void {
    const byIndex = Array.isArray(values);
    for (let s = 0; s < this.rings.length; s++) {
      const raw = byIndex ? (values as readonly number[])[s] : (values as Record<string, number>)[this.ks[s]];
      this.rings[s].push(Number.isFinite(raw) ? raw : 0);
    }
  }

  /** Drop every series' samples (keeps the series and their buffers). */
  clear(): void {
    for (const r of this.rings) r.clear();
  }

  /** Resize every series, preserving the newest samples that still fit. */
  setCapacity(n: number): void {
    const cap = clampCapacity(n);
    if (cap === this.cap) return;
    this.cap = cap;
    for (const r of this.rings) r.setCapacity(cap);
  }

  /** Replace the series list. A key present before and after keeps its
   * history. */
  setKeys(keys: readonly string[]): void {
    const length = this.length;
    const previous = new Map<string, SampleRing>();
    for (let s = 0; s < this.ks.length; s++) previous.set(this.ks[s], this.rings[s]);
    this.ks = keys.slice();
    this.rings = this.ks.map((key) => {
      const kept = previous.get(key);
      if (kept !== undefined) return kept;
      const fresh = new SampleRing(this.cap);
      for (let i = 0; i < length; i++) fresh.push(0);
      return fresh;
    });
  }
}

/* */
export function stackedTop(s: SeriesRing, series: number, i: number): number {
  let sum = 0;
  for (let j = 0; j <= series && j < s.count; j++) {
    const v = s.at(j, i);
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

/* */
export function stackedTotal(s: SeriesRing, i: number): number {
  return stackedTop(s, s.count - 1, i);
}

/* */
export function stackedMax(s: SeriesRing): number {
  let mx = 0;
  for (let i = 0; i < s.length; i++) {
    const total = stackedTotal(s, i);
    if (total > mx) mx = total;
  }
  return mx;
}

// -- Value formatting --------------------------------------------------------------

/** Deterministic HUD value formatting. Non-finite → '—'. */
export function formatValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '—';
  if (unit === 'fps') return `${Math.round(v)}fps`;
  if (unit === 'ms' || unit === '') {
    const a = Math.abs(v);
    const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
    return s + unit;
  }
  return v.toFixed(1) + unit;
}
