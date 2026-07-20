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
// range actually changes.

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

  /** `capacity` is floored and clamped to >= 1. */
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

  /** Sample by age: at(0) is the oldest, at(length - 1) the newest. NaN out of range. */
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

/**
 * Fill `out` with the stats of the ring's contents. Non-finite samples are
 * skipped for avg/min/max (all three are NaN when no finite sample exists);
 * `current` is the raw latest sample. Writes into the caller-owned object —
 * no allocation — and returns it.
 */
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
  /** Fraction of the data span added to each un-pinned end (default 0.1). */
  pad?: number;
  /** Extend the un-pinned low/high end to include 0 (default false). */
  includeZero?: boolean;
}

/** A display range: what maps to the bottom and top of the plot. */
export interface DisplayRange {
  min: number;
  max: number;
}

/**
 * Padded display range for the given data extremes. Degenerate-safe: empty
 * (non-finite) or flat data still yields a usable nonzero span. fixedMin /
 * fixedMax pin their end exactly. With includeZero, a zero floor pulled in
 * from non-negative data is kept at exactly 0 rather than padded below it.
 */
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

/**
 * The smallest "nice" step (1, 2 or 5 × 10^k) that divides `span` into at
 * most `maxTicks` intervals. Returns 1 for a non-positive/non-finite span.
 */
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

/**
 * Tick positions on the 1-2-5 × 10^k grid within [lo, hi], using
 * niceStep(hi - lo, maxTicks) — so at most maxTicks + 1 ticks. Returns []
 * for an empty/invalid range. Allocates (the element calls it only when the
 * display range changes).
 */
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

/**
 * Min-max downsample of the ring into `bins` buckets — the classic
 * more-samples-than-pixels reduction. Sample i (0 = oldest) lands in bin
 * floor(i * bins / count), so every finite sample influences exactly one bin
 * and outMin[b] <= outMax[b] for every non-empty bin. Empty bins (and both
 * arrays past a clamped `bins`) are NaN. `bins` is clamped to the shorter
 * out array. Writes only into the caller-owned arrays — no allocation.
 * Returns the number of non-empty bins (min(bins, count) for finite data).
 */
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

// -- Value formatting --------------------------------------------------------------

/**
 * Deterministic HUD value formatting. Non-finite → '—'. Unit 'ms' → adaptive
 * decimals (|v| >= 100 → 0, >= 10 → 1, else 2) + 'ms'; 'fps' → Math.round +
 * 'fps'; any other non-empty unit → 1 decimal + the unit as a suffix; '' →
 * the bare adaptive number.
 */
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
