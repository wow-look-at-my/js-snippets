// src/ui/perf-graph-math.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/ui/perf-graph-math.ts
var SampleRing = class {
  buf;
  head = 0;
  // next write position
  count = 0;
  // valid samples (<= capacity)
  /* */
  constructor(capacity) {
    this.buf = new Float32Array(clampCapacity(capacity));
  }
  /** Number of samples currently stored. */
  get length() {
    return this.count;
  }
  /** Maximum number of samples held before the oldest is overwritten. */
  get capacity() {
    return this.buf.length;
  }
  /** Append a sample, overwriting the oldest once full. */
  push(v) {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.buf.length;
    if (this.count < this.buf.length) this.count++;
  }
  /*NaN out of range. */
  at(i) {
    if (i < 0 || i >= this.count) return NaN;
    const cap = this.buf.length;
    return this.buf[(this.head - this.count + i + cap) % cap];
  }
  /** The most recent sample (NaN when empty). */
  latest() {
    if (this.count === 0) return NaN;
    const cap = this.buf.length;
    return this.buf[(this.head - 1 + cap) % cap];
  }
  /** Drop all samples (keeps the buffer). */
  clear() {
    this.head = 0;
    this.count = 0;
  }
  /**
   * Resize the ring, preserving the newest samples that still fit. A no-op
   * (and allocation-free) when the capacity is unchanged.
   */
  setCapacity(n) {
    const cap = clampCapacity(n);
    if (cap === this.buf.length) return;
    const next = new Float32Array(cap);
    const keep = Math.min(this.count, cap);
    for (let i = 0; i < keep; i++) next[i] = this.at(this.count - keep + i);
    this.buf = next;
    this.head = keep % cap;
    this.count = keep;
  }
};
function clampCapacity(n) {
  return Math.max(1, Math.floor(n) || 1);
}
function computeStats(ring, out) {
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
function autoRange(dataMin, dataMax, opts = {}) {
  const pad = opts.pad !== void 0 && Number.isFinite(opts.pad) ? opts.pad : 0.1;
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
    const half = Math.max(Math.abs(lo) * 0.5, 0.5);
    lo -= half;
    hi += half;
  }
  const span = hi - lo;
  let min = lo - span * pad;
  let max = hi + span * pad;
  if (opts.includeZero && lo >= 0 && min < 0) min = 0;
  const { fixedMin, fixedMax } = opts;
  if (fixedMin !== void 0 && Number.isFinite(fixedMin)) min = fixedMin;
  if (fixedMax !== void 0 && Number.isFinite(fixedMax)) max = fixedMax;
  if (!(max > min)) {
    if (fixedMax !== void 0 && fixedMin === void 0) min = max - 1;
    else max = min + 1;
  }
  return { min, max };
}
var NICE_MANTISSAS = [1, 2, 5];
function niceStep(span, maxTicks) {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const max = Math.max(1, Math.floor(maxTicks));
  let e = Math.floor(Math.log10(span / max));
  for (; ; ) {
    for (let i = 0; i < NICE_MANTISSAS.length; i++) {
      const step = NICE_MANTISSAS[i] * Math.pow(10, e);
      if (span / step <= max) return step;
    }
    e++;
  }
}
function niceTicks(lo, hi, maxTicks) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return [];
  const step = niceStep(hi - lo, maxTicks);
  const first = Math.ceil(lo / step);
  const last = Math.floor(hi / step);
  const ticks = [];
  for (let i = first; i <= last; i++) ticks.push(i * step);
  return ticks;
}
function binMinMax(ring, bins, outMin, outMax) {
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
    const b = Math.floor(i * nBins / count);
    if (outMin[b] === outMin[b]) {
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
function binLast(ring, bins, out) {
  const nBins = Math.min(Math.max(0, Math.floor(bins)), out.length);
  for (let b = 0; b < nBins; b++) out[b] = NaN;
  const count = ring.length;
  if (nBins === 0 || count === 0) return 0;
  let used = 0;
  for (let i = 0; i < count; i++) {
    const v = ring.at(i);
    if (!Number.isFinite(v)) continue;
    const b = Math.floor(i * nBins / count);
    if (out[b] !== out[b]) used++;
    out[b] = v;
  }
  return used;
}
var SeriesRing = class {
  ks;
  rings;
  cap;
  constructor(keys, capacity) {
    this.cap = clampCapacity(capacity);
    this.ks = keys.slice();
    this.rings = this.ks.map(() => new SampleRing(this.cap));
  }
  /** The series keys, in stacking order (index multiple sits at the bottom). */
  get keys() {
    return this.ks;
  }
  /** Number of series. */
  get count() {
    return this.ks.length;
  }
  /** Samples currently stored per series (every series holds the same number). */
  get length() {
    return this.rings.length > 0 ? this.rings[0].length : 0;
  }
  /** Samples held per series before the oldest is overwritten. */
  get capacity() {
    return this.cap;
  }
  /** The ring behind one series (NaN-safe reads via at()). */
  ring(series) {
    return this.rings[series];
  }
  /*NaN out of range. */
  at(series, i) {
    const r = this.rings[series];
    return r === void 0 ? NaN : r.at(i);
  }
  /** Append one column. A record is read by key; an array is read by
   * series index. */
  push(values) {
    const byIndex = Array.isArray(values);
    for (let s = 0; s < this.rings.length; s++) {
      const raw = byIndex ? values[s] : values[this.ks[s]];
      this.rings[s].push(Number.isFinite(raw) ? raw : 0);
    }
  }
  /** Drop every series' samples (keeps the series and their buffers). */
  clear() {
    for (const r of this.rings) r.clear();
  }
  /** Resize every series, preserving the newest samples that still fit. */
  setCapacity(n) {
    const cap = clampCapacity(n);
    if (cap === this.cap) return;
    this.cap = cap;
    for (const r of this.rings) r.setCapacity(cap);
  }
  /** Replace the series list. A key present before and after keeps its
   * history. */
  setKeys(keys) {
    const length = this.length;
    const previous = /* @__PURE__ */ new Map();
    for (let s = 0; s < this.ks.length; s++) previous.set(this.ks[s], this.rings[s]);
    this.ks = keys.slice();
    this.rings = this.ks.map((key) => {
      const kept = previous.get(key);
      if (kept !== void 0) return kept;
      const fresh = new SampleRing(this.cap);
      for (let i = 0; i < length; i++) fresh.push(0);
      return fresh;
    });
  }
};
function stackedTop(s, series, i) {
  let sum = 0;
  for (let j = 0; j <= series && j < s.count; j++) {
    const v = s.at(j, i);
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}
function stackedTotal(s, i) {
  return stackedTop(s, s.count - 1, i);
}
function stackedMax(s) {
  let mx = 0;
  for (let i = 0; i < s.length; i++) {
    const total = stackedTotal(s, i);
    if (total > mx) mx = total;
  }
  return mx;
}
function formatValue(v, unit) {
  if (!Number.isFinite(v)) return "\u2014";
  if (unit === "fps") return `${Math.round(v)}fps`;
  if (unit === "ms" || unit === "") {
    const a = Math.abs(v);
    const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
    return s + unit;
  }
  return v.toFixed(1) + unit;
}

// src/ui/perf-graph-math.test.ts
var contents = (r) => {
  const out = [];
  for (let i = 0; i < r.length; i++) out.push(r.at(i));
  return out;
};
var freshStats = () => ({ current: 0, avg: 0, min: 0, max: 0 });
test("ring: push/length/at/latest before wrapping", () => {
  const r = new SampleRing(4);
  assert.equal(r.capacity, 4);
  assert.equal(r.length, 0);
  r.push(1);
  r.push(2);
  r.push(3);
  assert.equal(r.length, 3);
  assert.deepEqual(contents(r), [1, 2, 3]);
  assert.equal(r.latest(), 3);
});
test("ring: wraps, keeping exactly the newest `capacity` samples", () => {
  const r = new SampleRing(3);
  for (let v = 1; v <= 5; v++) r.push(v);
  assert.equal(r.length, 3);
  assert.deepEqual(contents(r), [3, 4, 5]);
  assert.equal(r.latest(), 5);
});
test("ring: at() out of range and latest() on empty are NaN", () => {
  const r = new SampleRing(3);
  assert.ok(Number.isNaN(r.latest()));
  assert.ok(Number.isNaN(r.at(0)));
  r.push(7);
  assert.ok(Number.isNaN(r.at(-1)));
  assert.ok(Number.isNaN(r.at(1)));
});
test("ring: clear() empties but keeps the capacity", () => {
  const r = new SampleRing(3);
  r.push(1);
  r.push(2);
  r.clear();
  assert.equal(r.length, 0);
  assert.equal(r.capacity, 3);
  r.push(9);
  assert.deepEqual(contents(r), [9]);
});
test("ring: setCapacity() shrink preserves the newest samples", () => {
  const r = new SampleRing(5);
  for (let v = 1; v <= 5; v++) r.push(v);
  r.setCapacity(3);
  assert.equal(r.capacity, 3);
  assert.deepEqual(contents(r), [3, 4, 5]);
  r.push(6);
  assert.deepEqual(contents(r), [4, 5, 6]);
});
test("ring: setCapacity() grow preserves order across an old wrap point", () => {
  const r = new SampleRing(3);
  for (let v = 1; v <= 5; v++) r.push(v);
  r.setCapacity(6);
  assert.deepEqual(contents(r), [3, 4, 5]);
  r.push(6);
  r.push(7);
  r.push(8);
  assert.deepEqual(contents(r), [3, 4, 5, 6, 7, 8]);
  r.push(9);
  assert.deepEqual(contents(r), [4, 5, 6, 7, 8, 9]);
});
test("ring: setCapacity() with the same capacity is a no-op", () => {
  const r = new SampleRing(3);
  r.push(1);
  r.push(2);
  r.setCapacity(3);
  assert.equal(r.capacity, 3);
  assert.deepEqual(contents(r), [1, 2]);
});
test("ring: capacity is clamped to >= 1 and a capacity-1 ring works", () => {
  assert.equal(new SampleRing(0).capacity, 1);
  assert.equal(new SampleRing(NaN).capacity, 1);
  const r = new SampleRing(1);
  r.push(1);
  r.push(2);
  assert.deepEqual(contents(r), [2]);
});
test("ring: values are stored as float32", () => {
  const r = new SampleRing(2);
  r.push(0.1);
  assert.equal(r.at(0), Math.fround(0.1));
});
test("stats: current/avg/min/max over the ring, into the caller-owned object", () => {
  const r = new SampleRing(4);
  r.push(2);
  r.push(6);
  r.push(4);
  const out = freshStats();
  const ret = computeStats(r, out);
  assert.equal(ret, out);
  assert.equal(out.current, 4);
  assert.equal(out.avg, 4);
  assert.equal(out.min, 2);
  assert.equal(out.max, 6);
});
test("stats: reflect only the retained window after a wrap", () => {
  const r = new SampleRing(3);
  for (let v = 1; v <= 5; v++) r.push(v);
  const out = computeStats(r, freshStats());
  assert.equal(out.current, 5);
  assert.equal(out.avg, 4);
  assert.equal(out.min, 3);
  assert.equal(out.max, 5);
});
test("stats: empty ring yields all-NaN fields", () => {
  const out = computeStats(new SampleRing(4), freshStats());
  assert.ok(Number.isNaN(out.current));
  assert.ok(Number.isNaN(out.avg));
  assert.ok(Number.isNaN(out.min));
  assert.ok(Number.isNaN(out.max));
});
test("stats: non-finite samples are skipped for avg/min/max", () => {
  const r = new SampleRing(4);
  r.push(1);
  r.push(NaN);
  r.push(3);
  const out = computeStats(r, freshStats());
  assert.equal(out.current, 3);
  assert.equal(out.avg, 2);
  assert.equal(out.min, 1);
  assert.equal(out.max, 3);
});
test("autoRange: pads each end by pad \xD7 span", () => {
  assert.deepEqual(autoRange(0, 10, { pad: 0.1 }), { min: -1, max: 11 });
});
test("autoRange: empty (non-finite) data yields a usable nonzero span", () => {
  const r = autoRange(NaN, NaN);
  assert.ok(Number.isFinite(r.min) && Number.isFinite(r.max));
  assert.ok(r.max > r.min);
});
test("autoRange: flat data yields a nonzero span containing the value", () => {
  for (const v of [5, 0, -16.7]) {
    const r = autoRange(v, v);
    assert.ok(r.max > r.min, `span for flat ${v}`);
    assert.ok(r.min < v && v < r.max, `contains ${v}`);
  }
});
test("autoRange: fixedMin/fixedMax pin their end exactly", () => {
  const r = autoRange(0, 10, { fixedMin: 0, pad: 0.1 });
  assert.equal(r.min, 0);
  assert.equal(r.max, 11);
  const both = autoRange(0, 100, { fixedMin: 2, fixedMax: 4 });
  assert.deepEqual(both, { min: 2, max: 4 });
});
test("autoRange: includeZero extends to zero without padding below it", () => {
  const r = autoRange(5, 10, { includeZero: true, pad: 0.1 });
  assert.equal(r.min, 0);
  assert.equal(r.max, 11);
});
test("autoRange: swapped inputs are normalized", () => {
  assert.deepEqual(autoRange(10, 0, { pad: 0.1 }), autoRange(0, 10, { pad: 0.1 }));
});
test("niceStep: picks the smallest 1-2-5 step fitting maxTicks intervals", () => {
  assert.equal(niceStep(10, 5), 2);
  assert.equal(niceStep(10, 4), 5);
  assert.equal(niceStep(10, 10), 1);
  assert.equal(niceStep(1, 10), 0.1);
  assert.equal(niceStep(100, 5), 20);
  assert.equal(niceStep(0.05, 5), 0.01);
});
test("niceTicks: known grids", () => {
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(0, 10, 3), [0, 5, 10]);
  assert.deepEqual(niceTicks(14.2, 33.8, 4), [15, 20, 25, 30]);
});
test("niceTicks: ticks lie in [lo, hi], on the 1-2-5 grid, at most maxTicks + 1", () => {
  const cases = [
    [-3.3, 2.1, 5],
    [0.02, 0.09, 4],
    [16.4, 16.9, 3],
    [0, 1e3, 2],
    [-250, -30, 4]
  ];
  for (const [lo, hi, max] of cases) {
    const ticks = niceTicks(lo, hi, max);
    assert.ok(ticks.length >= 1, `has ticks for [${lo}, ${hi}]`);
    assert.ok(ticks.length <= max + 1, `count ${ticks.length} <= ${max + 1}`);
    const step = niceStep(hi - lo, max);
    const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
    assert.ok(
      [1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-9),
      `step ${step} is 1-2-5`
    );
    for (const tick of ticks) {
      assert.ok(tick >= lo - 1e-9 && tick <= hi + 1e-9, `${tick} in [${lo}, ${hi}]`);
      const k = tick / step;
      assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `${tick} is a multiple of ${step}`);
    }
  }
});
test("niceTicks: empty/invalid ranges yield no ticks", () => {
  assert.deepEqual(niceTicks(5, 5, 3), []);
  assert.deepEqual(niceTicks(3, 1, 3), []);
  assert.deepEqual(niceTicks(NaN, 1, 3), []);
});
test("binMinMax: exact bins when count is a multiple of bins", () => {
  const r = new SampleRing(8);
  for (const v of [0, 1, 2, 3, 4, 5, 6, 7]) r.push(v);
  const mn = new Float32Array(4);
  const mx = new Float32Array(4);
  assert.equal(binMinMax(r, 4, mn, mx), 4);
  assert.deepEqual([...mn], [0, 2, 4, 6]);
  assert.deepEqual([...mx], [1, 3, 5, 7]);
});
test("binMinMax: uneven split follows floor(i * bins / count)", () => {
  const r = new SampleRing(5);
  for (const v of [10, 20, 30, 40, 50]) r.push(v);
  const mn = new Float32Array(2);
  const mx = new Float32Array(2);
  assert.equal(binMinMax(r, 2, mn, mx), 2);
  assert.deepEqual([...mn], [10, 40]);
  assert.deepEqual([...mx], [30, 50]);
});
test("binMinMax: fewer samples than bins leaves NaN gaps at the mapped positions", () => {
  const r = new SampleRing(3);
  for (const v of [1, 2, 3]) r.push(v);
  const mn = new Float32Array(9);
  const mx = new Float32Array(9);
  assert.equal(binMinMax(r, 9, mn, mx), 3);
  for (let b = 0; b < 9; b++) {
    if (b === 0 || b === 3 || b === 6) {
      assert.equal(mn[b], b / 3 + 1);
      assert.equal(mx[b], b / 3 + 1);
    } else {
      assert.ok(Number.isNaN(mn[b]) && Number.isNaN(mx[b]), `bin ${b} empty`);
    }
  }
});
test("binMinMax: matches a JS mirror on pseudorandom data (every sample counted, min <= max)", () => {
  const count = 200;
  const bins = 33;
  const r = new SampleRing(count);
  let seed = 12345;
  const rand = () => {
    seed = seed * 1103515245 + 12345 & 2147483647;
    return seed / 2147483647;
  };
  const values = [];
  for (let i = 0; i < count; i++) {
    const v = Math.fround(rand() * 40 - 10);
    values.push(v);
    r.push(v);
  }
  const expMin = new Array(bins).fill(NaN);
  const expMax = new Array(bins).fill(NaN);
  for (let i = 0; i < count; i++) {
    const b = Math.floor(i * bins / count);
    if (Number.isNaN(expMin[b])) {
      expMin[b] = values[i];
      expMax[b] = values[i];
    } else {
      expMin[b] = Math.min(expMin[b], values[i]);
      expMax[b] = Math.max(expMax[b], values[i]);
    }
  }
  const mn = new Float32Array(bins);
  const mx = new Float32Array(bins);
  assert.equal(binMinMax(r, bins, mn, mx), bins);
  for (let b = 0; b < bins; b++) {
    assert.ok(Object.is(mn[b], Math.fround(expMin[b])), `min bin ${b}`);
    assert.ok(Object.is(mx[b], Math.fround(expMax[b])), `max bin ${b}`);
    assert.ok(mn[b] <= mx[b], `min <= max in bin ${b}`);
  }
});
test("binMinMax: empty ring fills NaN and reports 0; bins clamp to the out arrays", () => {
  const empty = new SampleRing(4);
  const mn = new Float32Array(3);
  const mx = new Float32Array(3);
  assert.equal(binMinMax(empty, 3, mn, mx), 0);
  assert.ok([...mn].every(Number.isNaN) && [...mx].every(Number.isNaN));
  const r = new SampleRing(8);
  for (let v = 1; v <= 8; v++) r.push(v);
  const mn4 = new Float32Array(4);
  const mx4 = new Float32Array(4);
  assert.equal(binMinMax(r, 10, mn4, mx4), 4);
  assert.deepEqual([...mn4], [1, 3, 5, 7]);
  assert.deepEqual([...mx4], [2, 4, 6, 8]);
});
test("binLast: keeps the newest sample of each bin, NaN for empty bins", () => {
  const r = new SampleRing(8);
  for (const v of [1, 2, 3, 4, 5, 6, 7, 8]) r.push(v);
  const out = new Float32Array(4);
  assert.equal(binLast(r, 4, out), 4);
  assert.deepEqual(Array.from(out), [2, 4, 6, 8]);
  const wide = new Float32Array(6);
  const three = new SampleRing(3);
  three.push(10);
  three.push(20);
  three.push(30);
  assert.equal(binLast(three, 6, wide), 3);
  assert.deepEqual(Array.from(wide.map((v) => Number.isNaN(v) ? -1 : v)), [10, -1, 20, -1, 30, -1]);
});
test("binLast: a non-finite sample never claims a bin", () => {
  const r = new SampleRing(4);
  r.push(5);
  r.push(NaN);
  r.push(7);
  r.push(Infinity);
  const out = new Float32Array(2);
  assert.equal(binLast(r, 2, out), 2);
  assert.deepEqual(Array.from(out), [5, 7]);
});
test("binLast: empty ring and zero bins write nothing and report none", () => {
  const out = new Float32Array(3);
  out.fill(42);
  assert.equal(binLast(new SampleRing(4), 3, out), 0);
  assert.ok(Array.from(out).every(Number.isNaN), "every bin of an empty ring is NaN");
  assert.equal(binLast(new SampleRing(4), 0, out), 0);
});
test("binLast: bins onto the same columns binMinMax uses", () => {
  const r = new SampleRing(10);
  for (let i = 0; i < 10; i++) r.push(i);
  const last = new Float32Array(4);
  const mn = new Float32Array(4);
  const mx = new Float32Array(4);
  binLast(r, 4, last);
  binMinMax(r, 4, mn, mx);
  for (let b = 0; b < 4; b++) {
    assert.equal(last[b], mx[b], `bin ${b}: rising data makes the newest sample the max`);
  }
});
test("SeriesRing: a record push fills every series, an absent key records 0", () => {
  const s = new SeriesRing(["hit", "miss"], 4);
  s.push({ hit: 3, miss: 1 });
  s.push({ hit: 2 });
  assert.equal(s.length, 2);
  assert.equal(s.count, 2);
  assert.deepEqual([s.at(0, 0), s.at(0, 1)], [3, 2]);
  assert.deepEqual([s.at(1, 0), s.at(1, 1)], [1, 0]);
});
test("SeriesRing: an array push reads by series index, non-finite records 0", () => {
  const s = new SeriesRing(["a", "b"], 4);
  s.push([1, NaN]);
  assert.deepEqual([s.at(0, 0), s.at(1, 0)], [1, 0]);
});
test("SeriesRing: out-of-range reads are NaN, not 0", () => {
  const s = new SeriesRing(["a"], 4);
  s.push({ a: 1 });
  assert.ok(Number.isNaN(s.at(0, 5)), "past the samples");
  assert.ok(Number.isNaN(s.at(3, 0)), "past the series");
  assert.equal(s.ring(3), void 0);
});
test("SeriesRing: every series shares one capacity and drops together", () => {
  const s = new SeriesRing(["a", "b"], 2);
  s.push({ a: 1, b: 10 });
  s.push({ a: 2, b: 20 });
  s.push({ a: 3, b: 30 });
  assert.equal(s.length, 2);
  assert.deepEqual([s.at(0, 0), s.at(1, 0)], [2, 20]);
  s.setCapacity(4);
  assert.equal(s.capacity, 4);
  assert.equal(s.length, 2, "a grow keeps what was there");
});
test("SeriesRing: setKeys keeps a surviving series and starts a new one flat", () => {
  const s = new SeriesRing(["a", "b"], 8);
  s.push({ a: 1, b: 5 });
  s.push({ a: 2, b: 6 });
  s.setKeys(["b", "c"]);
  assert.deepEqual(s.keys, ["b", "c"]);
  assert.equal(s.length, 2, "the new series is padded to the existing column count");
  assert.deepEqual([s.at(0, 0), s.at(0, 1)], [5, 6], "b keeps its history");
  assert.deepEqual([s.at(1, 0), s.at(1, 1)], [0, 0], "c begins flat");
  s.push({ b: 7, c: 9 });
  assert.deepEqual([s.at(0, 2), s.at(1, 2)], [7, 9]);
});
test("SeriesRing: clear empties every series and keeps the keys", () => {
  const s = new SeriesRing(["a", "b"], 4);
  s.push({ a: 1, b: 2 });
  s.clear();
  assert.equal(s.length, 0);
  assert.deepEqual(s.keys, ["a", "b"]);
});
test("stackedTop: a band top is the sum up to and including its own series", () => {
  const s = new SeriesRing(["a", "b", "c"], 4);
  s.push({ a: 1, b: 2, c: 3 });
  assert.equal(stackedTop(s, 0, 0), 1);
  assert.equal(stackedTop(s, 1, 0), 3);
  assert.equal(stackedTop(s, 2, 0), 6);
  assert.equal(stackedTotal(s, 0), 6);
});
test("stackedTop: a non-finite sample shortens its own band and nothing else", () => {
  const s = new SeriesRing(["a", "b"], 4);
  s.ring(0)?.push(NaN);
  s.ring(1)?.push(4);
  assert.equal(stackedTop(s, 0, 0), 0);
  assert.equal(stackedTotal(s, 0), 4);
});
test("stackedMax: the largest column total, and 0 with no samples", () => {
  const s = new SeriesRing(["a", "b"], 8);
  assert.equal(stackedMax(s), 0);
  s.push({ a: 1, b: 1 });
  s.push({ a: 5, b: 4 });
  s.push({ a: 2, b: 2 });
  assert.equal(stackedMax(s), 9);
});
test("stackedTotal: a series-less ring totals 0", () => {
  const s = new SeriesRing([], 4);
  assert.equal(s.count, 0);
  assert.equal(stackedTotal(s, 0), 0);
  assert.equal(stackedMax(s), 0);
});
test("formatValue: table", () => {
  const cases = [
    [NaN, "ms", "\u2014"],
    [Infinity, "fps", "\u2014"],
    [-Infinity, "", "\u2014"],
    [123.46, "ms", "123ms"],
    [100, "ms", "100ms"],
    [16.666, "ms", "16.7ms"],
    [10, "ms", "10.0ms"],
    [5.4321, "ms", "5.43ms"],
    [0, "ms", "0.00ms"],
    [-5.4321, "ms", "-5.43ms"],
    // decimals follow |v|
    [-123.4, "ms", "-123ms"],
    [59.6, "fps", "60fps"],
    [0.4, "fps", "0fps"],
    [42.34, "MB", "42.3MB"],
    [7, "%", "7.0%"],
    [7.891, "", "7.89"],
    [123.9, "", "124"]
  ];
  for (const [v, unit, expected] of cases) {
    assert.equal(formatValue(v, unit), expected, `formatValue(${v}, '${unit}')`);
  }
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsicGVyZi1ncmFwaC1tYXRoLnRlc3QudHMiLCAicGVyZi1ncmFwaC1tYXRoLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBUZXN0cyBmb3IgdGhlIHB1cmUgbWF0aCBoYWxmIG9mIDxwZXJmLWdyYXBoPiAodWkvcGVyZi1ncmFwaC1tYXRoLnRzKTogcmluZy1idWZmZXIgc2VtYW50aWNzLCBjYWxsZXItb3duZWQgc3RhdHMuXG5cbmltcG9ydCB7IHRlc3QgfSBmcm9tICdub2RlOnRlc3QnO1xuaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydC9zdHJpY3QnO1xuXG5pbXBvcnQge1xuICBTYW1wbGVSaW5nLFxuICBjb21wdXRlU3RhdHMsXG4gIGF1dG9SYW5nZSxcbiAgbmljZVN0ZXAsXG4gIG5pY2VUaWNrcyxcbiAgYmluTWluTWF4LFxuICBiaW5MYXN0LFxuICBTZXJpZXNSaW5nLFxuICBzdGFja2VkVG9wLFxuICBzdGFja2VkVG90YWwsXG4gIHN0YWNrZWRNYXgsXG4gIGZvcm1hdFZhbHVlLFxuICB0eXBlIFBlcmZTdGF0cyxcbn0gZnJvbSAnLi9wZXJmLWdyYXBoLW1hdGgudHMnO1xuXG5jb25zdCBjb250ZW50cyA9IChyOiBTYW1wbGVSaW5nKTogbnVtYmVyW10gPT4ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgci5sZW5ndGg7IGkrKykgb3V0LnB1c2goci5hdChpKSk7XG4gIHJldHVybiBvdXQ7XG59O1xuXG5jb25zdCBmcmVzaFN0YXRzID0gKCk6IFBlcmZTdGF0cyA9PiAoeyBjdXJyZW50OiAwLCBhdmc6IDAsIG1pbjogMCwgbWF4OiAwIH0pO1xuXG4vLyAtLSBTYW1wbGVSaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgncmluZzogcHVzaC9sZW5ndGgvYXQvbGF0ZXN0IGJlZm9yZSB3cmFwcGluZycsICgpID0+IHtcbiAgY29uc3QgciA9IG5ldyBTYW1wbGVSaW5nKDQpO1xuICBhc3NlcnQuZXF1YWwoci5jYXBhY2l0eSwgNCk7XG4gIGFzc2VydC5lcXVhbChyLmxlbmd0aCwgMCk7XG4gIHIucHVzaCgxKTtcbiAgci5wdXNoKDIpO1xuICByLnB1c2goMyk7XG4gIGFzc2VydC5lcXVhbChyLmxlbmd0aCwgMyk7XG4gIGFzc2VydC5kZWVwRXF1YWwoY29udGVudHMociksIFsxLCAyLCAzXSk7XG4gIGFzc2VydC5lcXVhbChyLmxhdGVzdCgpLCAzKTtcbn0pO1xuXG50ZXN0KCdyaW5nOiB3cmFwcywga2VlcGluZyBleGFjdGx5IHRoZSBuZXdlc3QgYGNhcGFjaXR5YCBzYW1wbGVzJywgKCkgPT4ge1xuICBjb25zdCByID0gbmV3IFNhbXBsZVJpbmcoMyk7XG4gIGZvciAobGV0IHYgPSAxOyB2IDw9IDU7IHYrKykgci5wdXNoKHYpO1xuICBhc3NlcnQuZXF1YWwoci5sZW5ndGgsIDMpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGNvbnRlbnRzKHIpLCBbMywgNCwgNV0pO1xuICBhc3NlcnQuZXF1YWwoci5sYXRlc3QoKSwgNSk7XG59KTtcblxudGVzdCgncmluZzogYXQoKSBvdXQgb2YgcmFuZ2UgYW5kIGxhdGVzdCgpIG9uIGVtcHR5IGFyZSBOYU4nLCAoKSA9PiB7XG4gIGNvbnN0IHIgPSBuZXcgU2FtcGxlUmluZygzKTtcbiAgYXNzZXJ0Lm9rKE51bWJlci5pc05hTihyLmxhdGVzdCgpKSk7XG4gIGFzc2VydC5vayhOdW1iZXIuaXNOYU4oci5hdCgwKSkpO1xuICByLnB1c2goNyk7XG4gIGFzc2VydC5vayhOdW1iZXIuaXNOYU4oci5hdCgtMSkpKTtcbiAgYXNzZXJ0Lm9rKE51bWJlci5pc05hTihyLmF0KDEpKSk7XG59KTtcblxudGVzdCgncmluZzogY2xlYXIoKSBlbXB0aWVzIGJ1dCBrZWVwcyB0aGUgY2FwYWNpdHknLCAoKSA9PiB7XG4gIGNvbnN0IHIgPSBuZXcgU2FtcGxlUmluZygzKTtcbiAgci5wdXNoKDEpO1xuICByLnB1c2goMik7XG4gIHIuY2xlYXIoKTtcbiAgYXNzZXJ0LmVxdWFsKHIubGVuZ3RoLCAwKTtcbiAgYXNzZXJ0LmVxdWFsKHIuY2FwYWNpdHksIDMpO1xuICByLnB1c2goOSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoY29udGVudHMociksIFs5XSk7XG59KTtcblxudGVzdCgncmluZzogc2V0Q2FwYWNpdHkoKSBzaHJpbmsgcHJlc2VydmVzIHRoZSBuZXdlc3Qgc2FtcGxlcycsICgpID0+IHtcbiAgY29uc3QgciA9IG5ldyBTYW1wbGVSaW5nKDUpO1xuICBmb3IgKGxldCB2ID0gMTsgdiA8PSA1OyB2KyspIHIucHVzaCh2KTtcbiAgci5zZXRDYXBhY2l0eSgzKTtcbiAgYXNzZXJ0LmVxdWFsKHIuY2FwYWNpdHksIDMpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGNvbnRlbnRzKHIpLCBbMywgNCwgNV0pO1xuICByLnB1c2goNik7IC8vIG92ZXJ3cml0ZXMgdGhlIG9sZGVzdCBrZXB0IHNhbXBsZVxuICBhc3NlcnQuZGVlcEVxdWFsKGNvbnRlbnRzKHIpLCBbNCwgNSwgNl0pO1xufSk7XG5cbnRlc3QoJ3Jpbmc6IHNldENhcGFjaXR5KCkgZ3JvdyBwcmVzZXJ2ZXMgb3JkZXIgYWNyb3NzIGFuIG9sZCB3cmFwIHBvaW50JywgKCkgPT4ge1xuICBjb25zdCByID0gbmV3IFNhbXBsZVJpbmcoMyk7XG4gIGZvciAobGV0IHYgPSAxOyB2IDw9IDU7IHYrKykgci5wdXNoKHYpO1xuICByLnNldENhcGFjaXR5KDYpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGNvbnRlbnRzKHIpLCBbMywgNCwgNV0pO1xuICByLnB1c2goNik7XG4gIHIucHVzaCg3KTtcbiAgci5wdXNoKDgpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGNvbnRlbnRzKHIpLCBbMywgNCwgNSwgNiwgNywgOF0pO1xuICByLnB1c2goOSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoY29udGVudHMociksIFs0LCA1LCA2LCA3LCA4LCA5XSk7XG59KTtcblxudGVzdCgncmluZzogc2V0Q2FwYWNpdHkoKSB3aXRoIHRoZSBzYW1lIGNhcGFjaXR5IGlzIGEgbm8tb3AnLCAoKSA9PiB7XG4gIGNvbnN0IHIgPSBuZXcgU2FtcGxlUmluZygzKTtcbiAgci5wdXNoKDEpO1xuICByLnB1c2goMik7XG4gIHIuc2V0Q2FwYWNpdHkoMyk7XG4gIGFzc2VydC5lcXVhbChyLmNhcGFjaXR5LCAzKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChjb250ZW50cyhyKSwgWzEsIDJdKTtcbn0pO1xuXG50ZXN0KCdyaW5nOiBjYXBhY2l0eSBpcyBjbGFtcGVkIHRvID49IDEgYW5kIGEgY2FwYWNpdHktMSByaW5nIHdvcmtzJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwobmV3IFNhbXBsZVJpbmcoMCkuY2FwYWNpdHksIDEpO1xuICBhc3NlcnQuZXF1YWwobmV3IFNhbXBsZVJpbmcoTmFOKS5jYXBhY2l0eSwgMSk7XG4gIGNvbnN0IHIgPSBuZXcgU2FtcGxlUmluZygxKTtcbiAgci5wdXNoKDEpO1xuICByLnB1c2goMik7XG4gIGFzc2VydC5kZWVwRXF1YWwoY29udGVudHMociksIFsyXSk7XG59KTtcblxudGVzdCgncmluZzogdmFsdWVzIGFyZSBzdG9yZWQgYXMgZmxvYXQzMicsICgpID0+IHtcbiAgY29uc3QgciA9IG5ldyBTYW1wbGVSaW5nKDIpO1xuICByLnB1c2goMC4xKTtcbiAgYXNzZXJ0LmVxdWFsKHIuYXQoMCksIE1hdGguZnJvdW5kKDAuMSkpO1xufSk7XG5cbi8vIC0tIGNvbXB1dGVTdGF0cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ3N0YXRzOiBjdXJyZW50L2F2Zy9taW4vbWF4IG92ZXIgdGhlIHJpbmcsIGludG8gdGhlIGNhbGxlci1vd25lZCBvYmplY3QnLCAoKSA9PiB7XG4gIGNvbnN0IHIgPSBuZXcgU2FtcGxlUmluZyg0KTtcbiAgci5wdXNoKDIpO1xuICByLnB1c2goNik7XG4gIHIucHVzaCg0KTtcbiAgY29uc3Qgb3V0ID0gZnJlc2hTdGF0cygpO1xuICBjb25zdCByZXQgPSBjb21wdXRlU3RhdHMociwgb3V0KTtcbiAgYXNzZXJ0LmVxdWFsKHJldCwgb3V0KTsgLy8gb3V0LXBhcmFtIGNvbnRyYWN0OiBmaWxscyBhbmQgcmV0dXJucyB0aGUgc2FtZSBvYmplY3RcbiAgYXNzZXJ0LmVxdWFsKG91dC5jdXJyZW50LCA0KTtcbiAgYXNzZXJ0LmVxdWFsKG91dC5hdmcsIDQpO1xuICBhc3NlcnQuZXF1YWwob3V0Lm1pbiwgMik7XG4gIGFzc2VydC5lcXVhbChvdXQubWF4LCA2KTtcbn0pO1xuXG50ZXN0KCdzdGF0czogcmVmbGVjdCBvbmx5IHRoZSByZXRhaW5lZCB3aW5kb3cgYWZ0ZXIgYSB3cmFwJywgKCkgPT4ge1xuICBjb25zdCByID0gbmV3IFNhbXBsZVJpbmcoMyk7XG4gIGZvciAobGV0IHYgPSAxOyB2IDw9IDU7IHYrKykgci5wdXNoKHYpO1xuICBjb25zdCBvdXQgPSBjb21wdXRlU3RhdHMociwgZnJlc2hTdGF0cygpKTtcbiAgYXNzZXJ0LmVxdWFsKG91dC5jdXJyZW50LCA1KTtcbiAgYXNzZXJ0LmVxdWFsKG91dC5hdmcsIDQpO1xuICBhc3NlcnQuZXF1YWwob3V0Lm1pbiwgMyk7XG4gIGFzc2VydC5lcXVhbChvdXQubWF4LCA1KTtcbn0pO1xuXG50ZXN0KCdzdGF0czogZW1wdHkgcmluZyB5aWVsZHMgYWxsLU5hTiBmaWVsZHMnLCAoKSA9PiB7XG4gIGNvbnN0IG91dCA9IGNvbXB1dGVTdGF0cyhuZXcgU2FtcGxlUmluZyg0KSwgZnJlc2hTdGF0cygpKTtcbiAgYXNzZXJ0Lm9rKE51bWJlci5pc05hTihvdXQuY3VycmVudCkpO1xuICBhc3NlcnQub2soTnVtYmVyLmlzTmFOKG91dC5hdmcpKTtcbiAgYXNzZXJ0Lm9rKE51bWJlci5pc05hTihvdXQubWluKSk7XG4gIGFzc2VydC5vayhOdW1iZXIuaXNOYU4ob3V0Lm1heCkpO1xufSk7XG5cbnRlc3QoJ3N0YXRzOiBub24tZmluaXRlIHNhbXBsZXMgYXJlIHNraXBwZWQgZm9yIGF2Zy9taW4vbWF4JywgKCkgPT4ge1xuICBjb25zdCByID0gbmV3IFNhbXBsZVJpbmcoNCk7XG4gIHIucHVzaCgxKTtcbiAgci5wdXNoKE5hTik7XG4gIHIucHVzaCgzKTtcbiAgY29uc3Qgb3V0ID0gY29tcHV0ZVN0YXRzKHIsIGZyZXNoU3RhdHMoKSk7XG4gIGFzc2VydC5lcXVhbChvdXQuY3VycmVudCwgMyk7XG4gIGFzc2VydC5lcXVhbChvdXQuYXZnLCAyKTtcbiAgYXNzZXJ0LmVxdWFsKG91dC5taW4sIDEpO1xuICBhc3NlcnQuZXF1YWwob3V0Lm1heCwgMyk7XG59KTtcblxuLy8gLS0gYXV0b1JhbmdlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnYXV0b1JhbmdlOiBwYWRzIGVhY2ggZW5kIGJ5IHBhZCBcdTAwRDcgc3BhbicsICgpID0+IHtcbiAgYXNzZXJ0LmRlZXBFcXVhbChhdXRvUmFuZ2UoMCwgMTAsIHsgcGFkOiAwLjEgfSksIHsgbWluOiAtMSwgbWF4OiAxMSB9KTtcbn0pO1xuXG50ZXN0KCdhdXRvUmFuZ2U6IGVtcHR5IChub24tZmluaXRlKSBkYXRhIHlpZWxkcyBhIHVzYWJsZSBub256ZXJvIHNwYW4nLCAoKSA9PiB7XG4gIGNvbnN0IHIgPSBhdXRvUmFuZ2UoTmFOLCBOYU4pO1xuICBhc3NlcnQub2soTnVtYmVyLmlzRmluaXRlKHIubWluKSAmJiBOdW1iZXIuaXNGaW5pdGUoci5tYXgpKTtcbiAgYXNzZXJ0Lm9rKHIubWF4ID4gci5taW4pO1xufSk7XG5cbnRlc3QoJ2F1dG9SYW5nZTogZmxhdCBkYXRhIHlpZWxkcyBhIG5vbnplcm8gc3BhbiBjb250YWluaW5nIHRoZSB2YWx1ZScsICgpID0+IHtcbiAgZm9yIChjb25zdCB2IG9mIFs1LCAwLCAtMTYuN10pIHtcbiAgICBjb25zdCByID0gYXV0b1JhbmdlKHYsIHYpO1xuICAgIGFzc2VydC5vayhyLm1heCA+IHIubWluLCBgc3BhbiBmb3IgZmxhdCAke3Z9YCk7XG4gICAgYXNzZXJ0Lm9rKHIubWluIDwgdiAmJiB2IDwgci5tYXgsIGBjb250YWlucyAke3Z9YCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdhdXRvUmFuZ2U6IGZpeGVkTWluL2ZpeGVkTWF4IHBpbiB0aGVpciBlbmQgZXhhY3RseScsICgpID0+IHtcbiAgY29uc3QgciA9IGF1dG9SYW5nZSgwLCAxMCwgeyBmaXhlZE1pbjogMCwgcGFkOiAwLjEgfSk7XG4gIGFzc2VydC5lcXVhbChyLm1pbiwgMCk7XG4gIGFzc2VydC5lcXVhbChyLm1heCwgMTEpO1xuICBjb25zdCBib3RoID0gYXV0b1JhbmdlKDAsIDEwMCwgeyBmaXhlZE1pbjogMiwgZml4ZWRNYXg6IDQgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYm90aCwgeyBtaW46IDIsIG1heDogNCB9KTtcbn0pO1xuXG50ZXN0KCdhdXRvUmFuZ2U6IGluY2x1ZGVaZXJvIGV4dGVuZHMgdG8gemVybyB3aXRob3V0IHBhZGRpbmcgYmVsb3cgaXQnLCAoKSA9PiB7XG4gIGNvbnN0IHIgPSBhdXRvUmFuZ2UoNSwgMTAsIHsgaW5jbHVkZVplcm86IHRydWUsIHBhZDogMC4xIH0pO1xuICBhc3NlcnQuZXF1YWwoci5taW4sIDApO1xuICBhc3NlcnQuZXF1YWwoci5tYXgsIDExKTtcbn0pO1xuXG50ZXN0KCdhdXRvUmFuZ2U6IHN3YXBwZWQgaW5wdXRzIGFyZSBub3JtYWxpemVkJywgKCkgPT4ge1xuICBhc3NlcnQuZGVlcEVxdWFsKGF1dG9SYW5nZSgxMCwgMCwgeyBwYWQ6IDAuMSB9KSwgYXV0b1JhbmdlKDAsIDEwLCB7IHBhZDogMC4xIH0pKTtcbn0pO1xuXG4vLyAtLSBuaWNlU3RlcCAvIG5pY2VUaWNrcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ25pY2VTdGVwOiBwaWNrcyB0aGUgc21hbGxlc3QgMS0yLTUgc3RlcCBmaXR0aW5nIG1heFRpY2tzIGludGVydmFscycsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKG5pY2VTdGVwKDEwLCA1KSwgMik7XG4gIGFzc2VydC5lcXVhbChuaWNlU3RlcCgxMCwgNCksIDUpO1xuICBhc3NlcnQuZXF1YWwobmljZVN0ZXAoMTAsIDEwKSwgMSk7XG4gIGFzc2VydC5lcXVhbChuaWNlU3RlcCgxLCAxMCksIDAuMSk7XG4gIGFzc2VydC5lcXVhbChuaWNlU3RlcCgxMDAsIDUpLCAyMCk7XG4gIGFzc2VydC5lcXVhbChuaWNlU3RlcCgwLjA1LCA1KSwgMC4wMSk7XG59KTtcblxudGVzdCgnbmljZVRpY2tzOiBrbm93biBncmlkcycsICgpID0+IHtcbiAgYXNzZXJ0LmRlZXBFcXVhbChuaWNlVGlja3MoMCwgMTAsIDUpLCBbMCwgMiwgNCwgNiwgOCwgMTBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChuaWNlVGlja3MoMCwgMTAsIDMpLCBbMCwgNSwgMTBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChuaWNlVGlja3MoMTQuMiwgMzMuOCwgNCksIFsxNSwgMjAsIDI1LCAzMF0pO1xufSk7XG5cbnRlc3QoJ25pY2VUaWNrczogdGlja3MgbGllIGluIFtsbywgaGldLCBvbiB0aGUgMS0yLTUgZ3JpZCwgYXQgbW9zdCBtYXhUaWNrcyArIDEnLCAoKSA9PiB7XG4gIGNvbnN0IGNhc2VzOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl1bXSA9IFtcbiAgICBbLTMuMywgMi4xLCA1XSxcbiAgICBbMC4wMiwgMC4wOSwgNF0sXG4gICAgWzE2LjQsIDE2LjksIDNdLFxuICAgIFswLCAxMDAwLCAyXSxcbiAgICBbLTI1MCwgLTMwLCA0XSxcbiAgXTtcbiAgZm9yIChjb25zdCBbbG8sIGhpLCBtYXhdIG9mIGNhc2VzKSB7XG4gICAgY29uc3QgdGlja3MgPSBuaWNlVGlja3MobG8sIGhpLCBtYXgpO1xuICAgIGFzc2VydC5vayh0aWNrcy5sZW5ndGggPj0gMSwgYGhhcyB0aWNrcyBmb3IgWyR7bG99LCAke2hpfV1gKTtcbiAgICBhc3NlcnQub2sodGlja3MubGVuZ3RoIDw9IG1heCArIDEsIGBjb3VudCAke3RpY2tzLmxlbmd0aH0gPD0gJHttYXggKyAxfWApO1xuICAgIGNvbnN0IHN0ZXAgPSBuaWNlU3RlcChoaSAtIGxvLCBtYXgpO1xuICAgIGNvbnN0IG1hbnRpc3NhID0gc3RlcCAvIE1hdGgucG93KDEwLCBNYXRoLmZsb29yKE1hdGgubG9nMTAoc3RlcCkpKTtcbiAgICBhc3NlcnQub2soXG4gICAgICBbMSwgMiwgNV0uc29tZSgobSkgPT4gTWF0aC5hYnMobWFudGlzc2EgLSBtKSA8IDFlLTkpLFxuICAgICAgYHN0ZXAgJHtzdGVwfSBpcyAxLTItNWAsXG4gICAgKTtcbiAgICBmb3IgKGNvbnN0IHRpY2sgb2YgdGlja3MpIHtcbiAgICAgIGFzc2VydC5vayh0aWNrID49IGxvIC0gMWUtOSAmJiB0aWNrIDw9IGhpICsgMWUtOSwgYCR7dGlja30gaW4gWyR7bG99LCAke2hpfV1gKTtcbiAgICAgIGNvbnN0IGsgPSB0aWNrIC8gc3RlcDtcbiAgICAgIGFzc2VydC5vayhNYXRoLmFicyhrIC0gTWF0aC5yb3VuZChrKSkgPCAxZS02LCBgJHt0aWNrfSBpcyBhIG11bHRpcGxlIG9mICR7c3RlcH1gKTtcbiAgICB9XG4gIH1cbn0pO1xuXG50ZXN0KCduaWNlVGlja3M6IGVtcHR5L2ludmFsaWQgcmFuZ2VzIHlpZWxkIG5vIHRpY2tzJywgKCkgPT4ge1xuICBhc3NlcnQuZGVlcEVxdWFsKG5pY2VUaWNrcyg1LCA1LCAzKSwgW10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKG5pY2VUaWNrcygzLCAxLCAzKSwgW10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKG5pY2VUaWNrcyhOYU4sIDEsIDMpLCBbXSk7XG59KTtcblxuLy8gLS0gYmluTWluTWF4IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnYmluTWluTWF4OiBleGFjdCBiaW5zIHdoZW4gY291bnQgaXMgYSBtdWx0aXBsZSBvZiBiaW5zJywgKCkgPT4ge1xuICBjb25zdCByID0gbmV3IFNhbXBsZVJpbmcoOCk7XG4gIGZvciAoY29uc3QgdiBvZiBbMCwgMSwgMiwgMywgNCwgNSwgNiwgN10pIHIucHVzaCh2KTtcbiAgY29uc3QgbW4gPSBuZXcgRmxvYXQzMkFycmF5KDQpO1xuICBjb25zdCBteCA9IG5ldyBGbG9hdDMyQXJyYXkoNCk7XG4gIGFzc2VydC5lcXVhbChiaW5NaW5NYXgociwgNCwgbW4sIG14KSwgNCk7XG4gIGFzc2VydC5kZWVwRXF1YWwoWy4uLm1uXSwgWzAsIDIsIDQsIDZdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChbLi4ubXhdLCBbMSwgMywgNSwgN10pO1xufSk7XG5cbnRlc3QoJ2Jpbk1pbk1heDogdW5ldmVuIHNwbGl0IGZvbGxvd3MgZmxvb3IoaSAqIGJpbnMgLyBjb3VudCknLCAoKSA9PiB7XG4gIGNvbnN0IHIgPSBuZXcgU2FtcGxlUmluZyg1KTtcbiAgZm9yIChjb25zdCB2IG9mIFsxMCwgMjAsIDMwLCA0MCwgNTBdKSByLnB1c2godik7XG4gIGNvbnN0IG1uID0gbmV3IEZsb2F0MzJBcnJheSgyKTtcbiAgY29uc3QgbXggPSBuZXcgRmxvYXQzMkFycmF5KDIpO1xuICBhc3NlcnQuZXF1YWwoYmluTWluTWF4KHIsIDIsIG1uLCBteCksIDIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKFsuLi5tbl0sIFsxMCwgNDBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChbLi4ubXhdLCBbMzAsIDUwXSk7XG59KTtcblxudGVzdCgnYmluTWluTWF4OiBmZXdlciBzYW1wbGVzIHRoYW4gYmlucyBsZWF2ZXMgTmFOIGdhcHMgYXQgdGhlIG1hcHBlZCBwb3NpdGlvbnMnLCAoKSA9PiB7XG4gIGNvbnN0IHIgPSBuZXcgU2FtcGxlUmluZygzKTtcbiAgZm9yIChjb25zdCB2IG9mIFsxLCAyLCAzXSkgci5wdXNoKHYpO1xuICBjb25zdCBtbiA9IG5ldyBGbG9hdDMyQXJyYXkoOSk7XG4gIGNvbnN0IG14ID0gbmV3IEZsb2F0MzJBcnJheSg5KTtcbiAgYXNzZXJ0LmVxdWFsKGJpbk1pbk1heChyLCA5LCBtbiwgbXgpLCAzKTtcbiAgZm9yIChsZXQgYiA9IDA7IGIgPCA5OyBiKyspIHtcbiAgICBpZiAoYiA9PT0gMCB8fCBiID09PSAzIHx8IGIgPT09IDYpIHtcbiAgICAgIGFzc2VydC5lcXVhbChtbltiXSwgYiAvIDMgKyAxKTtcbiAgICAgIGFzc2VydC5lcXVhbChteFtiXSwgYiAvIDMgKyAxKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXNzZXJ0Lm9rKE51bWJlci5pc05hTihtbltiXSkgJiYgTnVtYmVyLmlzTmFOKG14W2JdKSwgYGJpbiAke2J9IGVtcHR5YCk7XG4gICAgfVxuICB9XG59KTtcblxudGVzdCgnYmluTWluTWF4OiBtYXRjaGVzIGEgSlMgbWlycm9yIG9uIHBzZXVkb3JhbmRvbSBkYXRhIChldmVyeSBzYW1wbGUgY291bnRlZCwgbWluIDw9IG1heCknLCAoKSA9PiB7XG4gIGNvbnN0IGNvdW50ID0gMjAwO1xuICBjb25zdCBiaW5zID0gMzM7XG4gIGNvbnN0IHIgPSBuZXcgU2FtcGxlUmluZyhjb3VudCk7XG4gIGxldCBzZWVkID0gMTIzNDU7XG4gIGNvbnN0IHJhbmQgPSAoKTogbnVtYmVyID0+IHtcbiAgICBzZWVkID0gKHNlZWQgKiAxMTAzNTE1MjQ1ICsgMTIzNDUpICYgMHg3ZmZmZmZmZjtcbiAgICByZXR1cm4gc2VlZCAvIDB4N2ZmZmZmZmY7XG4gIH07XG4gIGNvbnN0IHZhbHVlczogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgY29uc3QgdiA9IE1hdGguZnJvdW5kKHJhbmQoKSAqIDQwIC0gMTApOyAvLyBmcm91bmQ6IHRoZSByaW5nIHN0b3JlcyBmMzJcbiAgICB2YWx1ZXMucHVzaCh2KTtcbiAgICByLnB1c2godik7XG4gIH1cbiAgY29uc3QgZXhwTWluID0gbmV3IEFycmF5PG51bWJlcj4oYmlucykuZmlsbChOYU4pO1xuICBjb25zdCBleHBNYXggPSBuZXcgQXJyYXk8bnVtYmVyPihiaW5zKS5maWxsKE5hTik7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgIGNvbnN0IGIgPSBNYXRoLmZsb29yKChpICogYmlucykgLyBjb3VudCk7XG4gICAgaWYgKE51bWJlci5pc05hTihleHBNaW5bYl0pKSB7XG4gICAgICBleHBNaW5bYl0gPSB2YWx1ZXNbaV07XG4gICAgICBleHBNYXhbYl0gPSB2YWx1ZXNbaV07XG4gICAgfSBlbHNlIHtcbiAgICAgIGV4cE1pbltiXSA9IE1hdGgubWluKGV4cE1pbltiXSwgdmFsdWVzW2ldKTtcbiAgICAgIGV4cE1heFtiXSA9IE1hdGgubWF4KGV4cE1heFtiXSwgdmFsdWVzW2ldKTtcbiAgICB9XG4gIH1cbiAgY29uc3QgbW4gPSBuZXcgRmxvYXQzMkFycmF5KGJpbnMpO1xuICBjb25zdCBteCA9IG5ldyBGbG9hdDMyQXJyYXkoYmlucyk7XG4gIGFzc2VydC5lcXVhbChiaW5NaW5NYXgociwgYmlucywgbW4sIG14KSwgYmlucyk7IC8vIGNvdW50ID4gYmlucyBcdTIxOTIgZXZlcnkgYmluIG5vbi1lbXB0eVxuICBmb3IgKGxldCBiID0gMDsgYiA8IGJpbnM7IGIrKykge1xuICAgIGFzc2VydC5vayhPYmplY3QuaXMobW5bYl0sIE1hdGguZnJvdW5kKGV4cE1pbltiXSkpLCBgbWluIGJpbiAke2J9YCk7XG4gICAgYXNzZXJ0Lm9rKE9iamVjdC5pcyhteFtiXSwgTWF0aC5mcm91bmQoZXhwTWF4W2JdKSksIGBtYXggYmluICR7Yn1gKTtcbiAgICBhc3NlcnQub2sobW5bYl0gPD0gbXhbYl0sIGBtaW4gPD0gbWF4IGluIGJpbiAke2J9YCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdiaW5NaW5NYXg6IGVtcHR5IHJpbmcgZmlsbHMgTmFOIGFuZCByZXBvcnRzIDA7IGJpbnMgY2xhbXAgdG8gdGhlIG91dCBhcnJheXMnLCAoKSA9PiB7XG4gIGNvbnN0IGVtcHR5ID0gbmV3IFNhbXBsZVJpbmcoNCk7XG4gIGNvbnN0IG1uID0gbmV3IEZsb2F0MzJBcnJheSgzKTtcbiAgY29uc3QgbXggPSBuZXcgRmxvYXQzMkFycmF5KDMpO1xuICBhc3NlcnQuZXF1YWwoYmluTWluTWF4KGVtcHR5LCAzLCBtbiwgbXgpLCAwKTtcbiAgYXNzZXJ0Lm9rKFsuLi5tbl0uZXZlcnkoTnVtYmVyLmlzTmFOKSAmJiBbLi4ubXhdLmV2ZXJ5KE51bWJlci5pc05hTikpO1xuXG4gIGNvbnN0IHIgPSBuZXcgU2FtcGxlUmluZyg4KTtcbiAgZm9yIChsZXQgdiA9IDE7IHYgPD0gODsgdisrKSByLnB1c2godik7XG4gIGNvbnN0IG1uNCA9IG5ldyBGbG9hdDMyQXJyYXkoNCk7XG4gIGNvbnN0IG14NCA9IG5ldyBGbG9hdDMyQXJyYXkoNCk7XG4gIGFzc2VydC5lcXVhbChiaW5NaW5NYXgociwgMTAsIG1uNCwgbXg0KSwgNCk7IC8vIGNsYW1wZWQgdG8gdGhlIGFycmF5cycgbGVuZ3RoXG4gIGFzc2VydC5kZWVwRXF1YWwoWy4uLm1uNF0sIFsxLCAzLCA1LCA3XSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoWy4uLm14NF0sIFsyLCA0LCA2LCA4XSk7XG59KTtcblxuLy8gLS0gYmluTGFzdCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ2Jpbkxhc3Q6IGtlZXBzIHRoZSBuZXdlc3Qgc2FtcGxlIG9mIGVhY2ggYmluLCBOYU4gZm9yIGVtcHR5IGJpbnMnLCAoKSA9PiB7XG4gIGNvbnN0IHIgPSBuZXcgU2FtcGxlUmluZyg4KTtcbiAgZm9yIChjb25zdCB2IG9mIFsxLCAyLCAzLCA0LCA1LCA2LCA3LCA4XSkgci5wdXNoKHYpO1xuICBjb25zdCBvdXQgPSBuZXcgRmxvYXQzMkFycmF5KDQpO1xuICBhc3NlcnQuZXF1YWwoYmluTGFzdChyLCA0LCBvdXQpLCA0KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChBcnJheS5mcm9tKG91dCksIFsyLCA0LCA2LCA4XSk7XG5cbiAgY29uc3Qgd2lkZSA9IG5ldyBGbG9hdDMyQXJyYXkoNik7XG4gIGNvbnN0IHRocmVlID0gbmV3IFNhbXBsZVJpbmcoMyk7XG4gIHRocmVlLnB1c2goMTApO1xuICB0aHJlZS5wdXNoKDIwKTtcbiAgdGhyZWUucHVzaCgzMCk7XG4gIGFzc2VydC5lcXVhbChiaW5MYXN0KHRocmVlLCA2LCB3aWRlKSwgMyk7XG4gIGFzc2VydC5kZWVwRXF1YWwoQXJyYXkuZnJvbSh3aWRlLm1hcCgodikgPT4gKE51bWJlci5pc05hTih2KSA/IC0xIDogdikpKSwgWzEwLCAtMSwgMjAsIC0xLCAzMCwgLTFdKTtcbn0pO1xuXG50ZXN0KCdiaW5MYXN0OiBhIG5vbi1maW5pdGUgc2FtcGxlIG5ldmVyIGNsYWltcyBhIGJpbicsICgpID0+IHtcbiAgY29uc3QgciA9IG5ldyBTYW1wbGVSaW5nKDQpO1xuICByLnB1c2goNSk7XG4gIHIucHVzaChOYU4pO1xuICByLnB1c2goNyk7XG4gIHIucHVzaChJbmZpbml0eSk7XG4gIGNvbnN0IG91dCA9IG5ldyBGbG9hdDMyQXJyYXkoMik7XG4gIGFzc2VydC5lcXVhbChiaW5MYXN0KHIsIDIsIG91dCksIDIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKEFycmF5LmZyb20ob3V0KSwgWzUsIDddKTtcbn0pO1xuXG50ZXN0KCdiaW5MYXN0OiBlbXB0eSByaW5nIGFuZCB6ZXJvIGJpbnMgd3JpdGUgbm90aGluZyBhbmQgcmVwb3J0IG5vbmUnLCAoKSA9PiB7XG4gIGNvbnN0IG91dCA9IG5ldyBGbG9hdDMyQXJyYXkoMyk7XG4gIG91dC5maWxsKDQyKTtcbiAgYXNzZXJ0LmVxdWFsKGJpbkxhc3QobmV3IFNhbXBsZVJpbmcoNCksIDMsIG91dCksIDApO1xuICBhc3NlcnQub2soQXJyYXkuZnJvbShvdXQpLmV2ZXJ5KE51bWJlci5pc05hTiksICdldmVyeSBiaW4gb2YgYW4gZW1wdHkgcmluZyBpcyBOYU4nKTtcbiAgYXNzZXJ0LmVxdWFsKGJpbkxhc3QobmV3IFNhbXBsZVJpbmcoNCksIDAsIG91dCksIDApO1xufSk7XG5cbnRlc3QoJ2Jpbkxhc3Q6IGJpbnMgb250byB0aGUgc2FtZSBjb2x1bW5zIGJpbk1pbk1heCB1c2VzJywgKCkgPT4ge1xuICBjb25zdCByID0gbmV3IFNhbXBsZVJpbmcoMTApO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDEwOyBpKyspIHIucHVzaChpKTtcbiAgY29uc3QgbGFzdCA9IG5ldyBGbG9hdDMyQXJyYXkoNCk7XG4gIGNvbnN0IG1uID0gbmV3IEZsb2F0MzJBcnJheSg0KTtcbiAgY29uc3QgbXggPSBuZXcgRmxvYXQzMkFycmF5KDQpO1xuICBiaW5MYXN0KHIsIDQsIGxhc3QpO1xuICBiaW5NaW5NYXgociwgNCwgbW4sIG14KTtcbiAgZm9yIChsZXQgYiA9IDA7IGIgPCA0OyBiKyspIHtcbiAgICBhc3NlcnQuZXF1YWwobGFzdFtiXSwgbXhbYl0sIGBiaW4gJHtifTogcmlzaW5nIGRhdGEgbWFrZXMgdGhlIG5ld2VzdCBzYW1wbGUgdGhlIG1heGApO1xuICB9XG59KTtcblxuLy8gLS0gU2VyaWVzUmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnU2VyaWVzUmluZzogYSByZWNvcmQgcHVzaCBmaWxscyBldmVyeSBzZXJpZXMsIGFuIGFic2VudCBrZXkgcmVjb3JkcyAwJywgKCkgPT4ge1xuICBjb25zdCBzID0gbmV3IFNlcmllc1JpbmcoWydoaXQnLCAnbWlzcyddLCA0KTtcbiAgcy5wdXNoKHsgaGl0OiAzLCBtaXNzOiAxIH0pO1xuICBzLnB1c2goeyBoaXQ6IDIgfSk7XG4gIGFzc2VydC5lcXVhbChzLmxlbmd0aCwgMik7XG4gIGFzc2VydC5lcXVhbChzLmNvdW50LCAyKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChbcy5hdCgwLCAwKSwgcy5hdCgwLCAxKV0sIFszLCAyXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoW3MuYXQoMSwgMCksIHMuYXQoMSwgMSldLCBbMSwgMF0pO1xufSk7XG5cbnRlc3QoJ1Nlcmllc1Jpbmc6IGFuIGFycmF5IHB1c2ggcmVhZHMgYnkgc2VyaWVzIGluZGV4LCBub24tZmluaXRlIHJlY29yZHMgMCcsICgpID0+IHtcbiAgY29uc3QgcyA9IG5ldyBTZXJpZXNSaW5nKFsnYScsICdiJ10sIDQpO1xuICBzLnB1c2goWzEsIE5hTl0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKFtzLmF0KDAsIDApLCBzLmF0KDEsIDApXSwgWzEsIDBdKTtcbn0pO1xuXG50ZXN0KCdTZXJpZXNSaW5nOiBvdXQtb2YtcmFuZ2UgcmVhZHMgYXJlIE5hTiwgbm90IDAnLCAoKSA9PiB7XG4gIGNvbnN0IHMgPSBuZXcgU2VyaWVzUmluZyhbJ2EnXSwgNCk7XG4gIHMucHVzaCh7IGE6IDEgfSk7XG4gIGFzc2VydC5vayhOdW1iZXIuaXNOYU4ocy5hdCgwLCA1KSksICdwYXN0IHRoZSBzYW1wbGVzJyk7XG4gIGFzc2VydC5vayhOdW1iZXIuaXNOYU4ocy5hdCgzLCAwKSksICdwYXN0IHRoZSBzZXJpZXMnKTtcbiAgYXNzZXJ0LmVxdWFsKHMucmluZygzKSwgdW5kZWZpbmVkKTtcbn0pO1xuXG50ZXN0KCdTZXJpZXNSaW5nOiBldmVyeSBzZXJpZXMgc2hhcmVzIG9uZSBjYXBhY2l0eSBhbmQgZHJvcHMgdG9nZXRoZXInLCAoKSA9PiB7XG4gIGNvbnN0IHMgPSBuZXcgU2VyaWVzUmluZyhbJ2EnLCAnYiddLCAyKTtcbiAgcy5wdXNoKHsgYTogMSwgYjogMTAgfSk7XG4gIHMucHVzaCh7IGE6IDIsIGI6IDIwIH0pO1xuICBzLnB1c2goeyBhOiAzLCBiOiAzMCB9KTtcbiAgYXNzZXJ0LmVxdWFsKHMubGVuZ3RoLCAyKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChbcy5hdCgwLCAwKSwgcy5hdCgxLCAwKV0sIFsyLCAyMF0pO1xuICBzLnNldENhcGFjaXR5KDQpO1xuICBhc3NlcnQuZXF1YWwocy5jYXBhY2l0eSwgNCk7XG4gIGFzc2VydC5lcXVhbChzLmxlbmd0aCwgMiwgJ2EgZ3JvdyBrZWVwcyB3aGF0IHdhcyB0aGVyZScpO1xufSk7XG5cbnRlc3QoJ1Nlcmllc1Jpbmc6IHNldEtleXMga2VlcHMgYSBzdXJ2aXZpbmcgc2VyaWVzIGFuZCBzdGFydHMgYSBuZXcgb25lIGZsYXQnLCAoKSA9PiB7XG4gIGNvbnN0IHMgPSBuZXcgU2VyaWVzUmluZyhbJ2EnLCAnYiddLCA4KTtcbiAgcy5wdXNoKHsgYTogMSwgYjogNSB9KTtcbiAgcy5wdXNoKHsgYTogMiwgYjogNiB9KTtcbiAgcy5zZXRLZXlzKFsnYicsICdjJ10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKHMua2V5cywgWydiJywgJ2MnXSk7XG4gIGFzc2VydC5lcXVhbChzLmxlbmd0aCwgMiwgJ3RoZSBuZXcgc2VyaWVzIGlzIHBhZGRlZCB0byB0aGUgZXhpc3RpbmcgY29sdW1uIGNvdW50Jyk7XG4gIGFzc2VydC5kZWVwRXF1YWwoW3MuYXQoMCwgMCksIHMuYXQoMCwgMSldLCBbNSwgNl0sICdiIGtlZXBzIGl0cyBoaXN0b3J5Jyk7XG4gIGFzc2VydC5kZWVwRXF1YWwoW3MuYXQoMSwgMCksIHMuYXQoMSwgMSldLCBbMCwgMF0sICdjIGJlZ2lucyBmbGF0Jyk7XG4gIHMucHVzaCh7IGI6IDcsIGM6IDkgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoW3MuYXQoMCwgMiksIHMuYXQoMSwgMildLCBbNywgOV0pO1xufSk7XG5cbnRlc3QoJ1Nlcmllc1Jpbmc6IGNsZWFyIGVtcHRpZXMgZXZlcnkgc2VyaWVzIGFuZCBrZWVwcyB0aGUga2V5cycsICgpID0+IHtcbiAgY29uc3QgcyA9IG5ldyBTZXJpZXNSaW5nKFsnYScsICdiJ10sIDQpO1xuICBzLnB1c2goeyBhOiAxLCBiOiAyIH0pO1xuICBzLmNsZWFyKCk7XG4gIGFzc2VydC5lcXVhbChzLmxlbmd0aCwgMCk7XG4gIGFzc2VydC5kZWVwRXF1YWwocy5rZXlzLCBbJ2EnLCAnYiddKTtcbn0pO1xuXG4vLyAtLSBTdGFja2luZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdzdGFja2VkVG9wOiBhIGJhbmQgdG9wIGlzIHRoZSBzdW0gdXAgdG8gYW5kIGluY2x1ZGluZyBpdHMgb3duIHNlcmllcycsICgpID0+IHtcbiAgY29uc3QgcyA9IG5ldyBTZXJpZXNSaW5nKFsnYScsICdiJywgJ2MnXSwgNCk7XG4gIHMucHVzaCh7IGE6IDEsIGI6IDIsIGM6IDMgfSk7XG4gIGFzc2VydC5lcXVhbChzdGFja2VkVG9wKHMsIDAsIDApLCAxKTtcbiAgYXNzZXJ0LmVxdWFsKHN0YWNrZWRUb3AocywgMSwgMCksIDMpO1xuICBhc3NlcnQuZXF1YWwoc3RhY2tlZFRvcChzLCAyLCAwKSwgNik7XG4gIGFzc2VydC5lcXVhbChzdGFja2VkVG90YWwocywgMCksIDYpO1xufSk7XG5cbnRlc3QoJ3N0YWNrZWRUb3A6IGEgbm9uLWZpbml0ZSBzYW1wbGUgc2hvcnRlbnMgaXRzIG93biBiYW5kIGFuZCBub3RoaW5nIGVsc2UnLCAoKSA9PiB7XG4gIGNvbnN0IHMgPSBuZXcgU2VyaWVzUmluZyhbJ2EnLCAnYiddLCA0KTtcbiAgLy8gcHVzaCgpIGFscmVhZHkgbm9ybWFsaXplcywgc28gd3JpdGUgdGhlIGJhZCB2YWx1ZSBzdHJhaWdodCBpbnRvIHRoZSByaW5nLlxuICBzLnJpbmcoMCk/LnB1c2goTmFOKTtcbiAgcy5yaW5nKDEpPy5wdXNoKDQpO1xuICBhc3NlcnQuZXF1YWwoc3RhY2tlZFRvcChzLCAwLCAwKSwgMCk7XG4gIGFzc2VydC5lcXVhbChzdGFja2VkVG90YWwocywgMCksIDQpO1xufSk7XG5cbnRlc3QoJ3N0YWNrZWRNYXg6IHRoZSBsYXJnZXN0IGNvbHVtbiB0b3RhbCwgYW5kIDAgd2l0aCBubyBzYW1wbGVzJywgKCkgPT4ge1xuICBjb25zdCBzID0gbmV3IFNlcmllc1JpbmcoWydhJywgJ2InXSwgOCk7XG4gIGFzc2VydC5lcXVhbChzdGFja2VkTWF4KHMpLCAwKTtcbiAgcy5wdXNoKHsgYTogMSwgYjogMSB9KTtcbiAgcy5wdXNoKHsgYTogNSwgYjogNCB9KTtcbiAgcy5wdXNoKHsgYTogMiwgYjogMiB9KTtcbiAgYXNzZXJ0LmVxdWFsKHN0YWNrZWRNYXgocyksIDkpO1xufSk7XG5cbnRlc3QoJ3N0YWNrZWRUb3RhbDogYSBzZXJpZXMtbGVzcyByaW5nIHRvdGFscyAwJywgKCkgPT4ge1xuICBjb25zdCBzID0gbmV3IFNlcmllc1JpbmcoW10sIDQpO1xuICBhc3NlcnQuZXF1YWwocy5jb3VudCwgMCk7XG4gIGFzc2VydC5lcXVhbChzdGFja2VkVG90YWwocywgMCksIDApO1xuICBhc3NlcnQuZXF1YWwoc3RhY2tlZE1heChzKSwgMCk7XG59KTtcblxuLy8gLS0gZm9ybWF0VmFsdWUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdmb3JtYXRWYWx1ZTogdGFibGUnLCAoKSA9PiB7XG4gIGNvbnN0IGNhc2VzOiBbbnVtYmVyLCBzdHJpbmcsIHN0cmluZ11bXSA9IFtcbiAgICBbTmFOLCAnbXMnLCAnXHUyMDE0J10sXG4gICAgW0luZmluaXR5LCAnZnBzJywgJ1x1MjAxNCddLFxuICAgIFstSW5maW5pdHksICcnLCAnXHUyMDE0J10sXG4gICAgWzEyMy40NiwgJ21zJywgJzEyM21zJ10sXG4gICAgWzEwMCwgJ21zJywgJzEwMG1zJ10sXG4gICAgWzE2LjY2NiwgJ21zJywgJzE2LjdtcyddLFxuICAgIFsxMCwgJ21zJywgJzEwLjBtcyddLFxuICAgIFs1LjQzMjEsICdtcycsICc1LjQzbXMnXSxcbiAgICBbMCwgJ21zJywgJzAuMDBtcyddLFxuICAgIFstNS40MzIxLCAnbXMnLCAnLTUuNDNtcyddLCAvLyBkZWNpbWFscyBmb2xsb3cgfHZ8XG4gICAgWy0xMjMuNCwgJ21zJywgJy0xMjNtcyddLFxuICAgIFs1OS42LCAnZnBzJywgJzYwZnBzJ10sXG4gICAgWzAuNCwgJ2ZwcycsICcwZnBzJ10sXG4gICAgWzQyLjM0LCAnTUInLCAnNDIuM01CJ10sXG4gICAgWzcsICclJywgJzcuMCUnXSxcbiAgICBbNy44OTEsICcnLCAnNy44OSddLFxuICAgIFsxMjMuOSwgJycsICcxMjQnXSxcbiAgXTtcbiAgZm9yIChjb25zdCBbdiwgdW5pdCwgZXhwZWN0ZWRdIG9mIGNhc2VzKSB7XG4gICAgYXNzZXJ0LmVxdWFsKGZvcm1hdFZhbHVlKHYsIHVuaXQpLCBleHBlY3RlZCwgYGZvcm1hdFZhbHVlKCR7dn0sICcke3VuaXR9JylgKTtcbiAgfVxufSk7XG4iLCAiLy8gUHVyZSBtYXRoIGZvciB0aGUgPHBlcmYtZ3JhcGg+IGVsZW1lbnQ6IGEgZml4ZWQtY2FwYWNpdHkgRmxvYXQzMkFycmF5IHJpbmdcbi8vIGJ1ZmZlciwgc3RhdHMgLyBkaXNwbGF5LXJhbmdlIC8gdGljayBoZWxwZXJzLCBhIG1pbi1tYXggZG93bnNhbXBsZXIgZm9yXG4vLyBtb3JlLXNhbXBsZXMtdGhhbi1waXhlbHMgcmVuZGVyaW5nLCBhbmQgdGhlIEhVRCB2YWx1ZSBmb3JtYXR0ZXIuIE5vIERPTSBvclxuLy8gYnJvd3NlciBBUElzIFx1MjAxNCBldmVyeXRoaW5nIGhlcmUgcnVucyAoYW5kIGlzIHRlc3RlZCkgdW5kZXIgbm9kZTtcbi8vIHVpL3BlcmYtZ3JhcGgudHMgaXMgdGhlIGNhbnZhcy1ib3VuZCBoYWxmIHRoYXQgY29uc3VtZXMgaXQuXG4vL1xuLy8gSG90IHBhdGhzIGFyZSBhbGxvY2F0aW9uLWZyZWUgYnkgZGVzaWduOiBTYW1wbGVSaW5nIGFsbG9jYXRlcyBvbmx5IGluIHRoZVxuLy8gY29uc3RydWN0b3IgYW5kIHNldENhcGFjaXR5KCksIGFuZCBjb21wdXRlU3RhdHMgLyBiaW5NaW5NYXggd3JpdGUgaW50b1xuLy8gY2FsbGVyLW93bmVkIG91dHB1dHMsIHNvIGEgcGVyLWZyYW1lIEhVRCByZWRyYXcgcGVyZm9ybXMgbm8gYWxsb2NhdGlvbi5cbi8vIG5pY2VUaWNrcyBpcyB0aGUgb25lIGFsbG9jYXRpbmcgaGVscGVyIFx1MjAxNCBjYWxsIGl0IG9ubHkgd2hlbiB0aGUgZGlzcGxheVxuLy8gcmFuZ2UgY2hhbmdlcy5cblxuLy8gLS0gUmluZyBidWZmZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRml4ZWQtY2FwYWNpdHkgcmluZyBidWZmZXIgb2YgZjMyIHNhbXBsZXM6IHB1c2goKSBvdmVyd3JpdGVzIHRoZSBvbGRlc3RcbiAqIHNhbXBsZSBvbmNlIGZ1bGwuIFZhbHVlcyBhcmUgc3RvcmVkIGFzIGZsb2F0MzIgKHRoZXkgcm91bmQtdHJpcCB0aHJvdWdoXG4gKiBNYXRoLmZyb3VuZCkuIE9ubHkgdGhlIGNvbnN0cnVjdG9yIGFuZCBzZXRDYXBhY2l0eSgpIGFsbG9jYXRlLlxuICovXG5leHBvcnQgY2xhc3MgU2FtcGxlUmluZyB7XG4gIHByaXZhdGUgYnVmOiBGbG9hdDMyQXJyYXk7XG4gIHByaXZhdGUgaGVhZCA9IDA7IC8vIG5leHQgd3JpdGUgcG9zaXRpb25cbiAgcHJpdmF0ZSBjb3VudCA9IDA7IC8vIHZhbGlkIHNhbXBsZXMgKDw9IGNhcGFjaXR5KVxuXG4gIC8qICovXG4gIGNvbnN0cnVjdG9yKGNhcGFjaXR5OiBudW1iZXIpIHtcbiAgICB0aGlzLmJ1ZiA9IG5ldyBGbG9hdDMyQXJyYXkoY2xhbXBDYXBhY2l0eShjYXBhY2l0eSkpO1xuICB9XG5cbiAgLyoqIE51bWJlciBvZiBzYW1wbGVzIGN1cnJlbnRseSBzdG9yZWQuICovXG4gIGdldCBsZW5ndGgoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5jb3VudDtcbiAgfVxuXG4gIC8qKiBNYXhpbXVtIG51bWJlciBvZiBzYW1wbGVzIGhlbGQgYmVmb3JlIHRoZSBvbGRlc3QgaXMgb3ZlcndyaXR0ZW4uICovXG4gIGdldCBjYXBhY2l0eSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmJ1Zi5sZW5ndGg7XG4gIH1cblxuICAvKiogQXBwZW5kIGEgc2FtcGxlLCBvdmVyd3JpdGluZyB0aGUgb2xkZXN0IG9uY2UgZnVsbC4gKi9cbiAgcHVzaCh2OiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLmJ1Zlt0aGlzLmhlYWRdID0gdjtcbiAgICB0aGlzLmhlYWQgPSAodGhpcy5oZWFkICsgMSkgJSB0aGlzLmJ1Zi5sZW5ndGg7XG4gICAgaWYgKHRoaXMuY291bnQgPCB0aGlzLmJ1Zi5sZW5ndGgpIHRoaXMuY291bnQrKztcbiAgfVxuXG4gIC8qTmFOIG91dCBvZiByYW5nZS4gKi9cbiAgYXQoaTogbnVtYmVyKTogbnVtYmVyIHtcbiAgICBpZiAoaSA8IDAgfHwgaSA+PSB0aGlzLmNvdW50KSByZXR1cm4gTmFOO1xuICAgIGNvbnN0IGNhcCA9IHRoaXMuYnVmLmxlbmd0aDtcbiAgICByZXR1cm4gdGhpcy5idWZbKHRoaXMuaGVhZCAtIHRoaXMuY291bnQgKyBpICsgY2FwKSAlIGNhcF07XG4gIH1cblxuICAvKiogVGhlIG1vc3QgcmVjZW50IHNhbXBsZSAoTmFOIHdoZW4gZW1wdHkpLiAqL1xuICBsYXRlc3QoKTogbnVtYmVyIHtcbiAgICBpZiAodGhpcy5jb3VudCA9PT0gMCkgcmV0dXJuIE5hTjtcbiAgICBjb25zdCBjYXAgPSB0aGlzLmJ1Zi5sZW5ndGg7XG4gICAgcmV0dXJuIHRoaXMuYnVmWyh0aGlzLmhlYWQgLSAxICsgY2FwKSAlIGNhcF07XG4gIH1cblxuICAvKiogRHJvcCBhbGwgc2FtcGxlcyAoa2VlcHMgdGhlIGJ1ZmZlcikuICovXG4gIGNsZWFyKCk6IHZvaWQge1xuICAgIHRoaXMuaGVhZCA9IDA7XG4gICAgdGhpcy5jb3VudCA9IDA7XG4gIH1cblxuICAvKipcbiAgICogUmVzaXplIHRoZSByaW5nLCBwcmVzZXJ2aW5nIHRoZSBuZXdlc3Qgc2FtcGxlcyB0aGF0IHN0aWxsIGZpdC4gQSBuby1vcFxuICAgKiAoYW5kIGFsbG9jYXRpb24tZnJlZSkgd2hlbiB0aGUgY2FwYWNpdHkgaXMgdW5jaGFuZ2VkLlxuICAgKi9cbiAgc2V0Q2FwYWNpdHkobjogbnVtYmVyKTogdm9pZCB7XG4gICAgY29uc3QgY2FwID0gY2xhbXBDYXBhY2l0eShuKTtcbiAgICBpZiAoY2FwID09PSB0aGlzLmJ1Zi5sZW5ndGgpIHJldHVybjtcbiAgICBjb25zdCBuZXh0ID0gbmV3IEZsb2F0MzJBcnJheShjYXApO1xuICAgIGNvbnN0IGtlZXAgPSBNYXRoLm1pbih0aGlzLmNvdW50LCBjYXApO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwga2VlcDsgaSsrKSBuZXh0W2ldID0gdGhpcy5hdCh0aGlzLmNvdW50IC0ga2VlcCArIGkpO1xuICAgIHRoaXMuYnVmID0gbmV4dDtcbiAgICB0aGlzLmhlYWQgPSBrZWVwICUgY2FwO1xuICAgIHRoaXMuY291bnQgPSBrZWVwO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNsYW1wQ2FwYWNpdHkobjogbnVtYmVyKTogbnVtYmVyIHtcbiAgcmV0dXJuIE1hdGgubWF4KDEsIE1hdGguZmxvb3IobikgfHwgMSk7XG59XG5cbi8vIC0tIFN0YXRzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQ2FsbGVyLW93bmVkIHN0YXRzIG91dHB1dCBmb3IgY29tcHV0ZVN0YXRzIChyZXVzZSBvbmUgb2JqZWN0IGFjcm9zcyBmcmFtZXMpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQZXJmU3RhdHMge1xuICAvKiogVGhlIG1vc3QgcmVjZW50IHNhbXBsZSwgdmVyYmF0aW0gKE5hTiB3aGVuIGVtcHR5KS4gKi9cbiAgY3VycmVudDogbnVtYmVyO1xuICAvKiogTWVhbiBvZiB0aGUgZmluaXRlIHNhbXBsZXMgKE5hTiB3aGVuIHRoZXJlIGFyZSBub25lKS4gKi9cbiAgYXZnOiBudW1iZXI7XG4gIC8qKiBNaW5pbXVtIGZpbml0ZSBzYW1wbGUgKE5hTiB3aGVuIHRoZXJlIGFyZSBub25lKS4gKi9cbiAgbWluOiBudW1iZXI7XG4gIC8qKiBNYXhpbXVtIGZpbml0ZSBzYW1wbGUgKE5hTiB3aGVuIHRoZXJlIGFyZSBub25lKS4gKi9cbiAgbWF4OiBudW1iZXI7XG59XG5cbi8qKiBGaWxsIGBvdXRgIHdpdGggdGhlIHN0YXRzIG9mIHRoZSByaW5nJ3MgY29udGVudHMuIE5vbi1maW5pdGUgc2FtcGxlcyBhcmVcbiAqIHNraXBwZWQgZm9yIGF2Zy9taW4vbWF4IChhbGwgb2YgdGhlbSBhcmUgTmFOIHdoZW4gbm8gZmluaXRlIHNhbXBsZSBleGlzdHMpO1xuICogYGN1cnJlbnRgIGlzIHRoZSByYXcgbGF0ZXN0IHNhbXBsZS4gV3JpdGVzIGludG8gdGhlIGNhbGxlci1vd25lZCBvYmplY3QgXHUyMDE0XG4gKiBubyBhbGxvY2F0aW9uIFx1MjAxNCBhbmQgcmV0dXJucyBpdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlU3RhdHMocmluZzogU2FtcGxlUmluZywgb3V0OiBQZXJmU3RhdHMpOiBQZXJmU3RhdHMge1xuICBsZXQgbiA9IDA7XG4gIGxldCBzdW0gPSAwO1xuICBsZXQgbW4gPSBJbmZpbml0eTtcbiAgbGV0IG14ID0gLUluZmluaXR5O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJpbmcubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB2ID0gcmluZy5hdChpKTtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2KSkgY29udGludWU7XG4gICAgbisrO1xuICAgIHN1bSArPSB2O1xuICAgIGlmICh2IDwgbW4pIG1uID0gdjtcbiAgICBpZiAodiA+IG14KSBteCA9IHY7XG4gIH1cbiAgb3V0LmN1cnJlbnQgPSByaW5nLmxhdGVzdCgpO1xuICBvdXQuYXZnID0gbiA+IDAgPyBzdW0gLyBuIDogTmFOO1xuICBvdXQubWluID0gbiA+IDAgPyBtbiA6IE5hTjtcbiAgb3V0Lm1heCA9IG4gPiAwID8gbXggOiBOYU47XG4gIHJldHVybiBvdXQ7XG59XG5cbi8vIC0tIERpc3BsYXkgcmFuZ2UgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBPcHRpb25zIGZvciBhdXRvUmFuZ2UuICovXG5leHBvcnQgaW50ZXJmYWNlIEF1dG9SYW5nZU9wdGlvbnMge1xuICAvKiogUGluIHRoZSBsb3cgZW5kIGV4YWN0bHkgKG5vIHBhZGRpbmcgaXMgYXBwbGllZCB0byBhIHBpbm5lZCBlbmQpLiAqL1xuICBmaXhlZE1pbj86IG51bWJlcjtcbiAgLyoqIFBpbiB0aGUgaGlnaCBlbmQgZXhhY3RseSAobm8gcGFkZGluZyBpcyBhcHBsaWVkIHRvIGEgcGlubmVkIGVuZCkuICovXG4gIGZpeGVkTWF4PzogbnVtYmVyO1xuICAvKiAqL1xuICBwYWQ/OiBudW1iZXI7XG4gIC8qICovXG4gIGluY2x1ZGVaZXJvPzogYm9vbGVhbjtcbn1cblxuLyoqIEEgZGlzcGxheSByYW5nZTogd2hhdCBtYXBzIHRvIHRoZSBib3R0b20gYW5kIHRvcCBvZiB0aGUgcGxvdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGlzcGxheVJhbmdlIHtcbiAgbWluOiBudW1iZXI7XG4gIG1heDogbnVtYmVyO1xufVxuXG4vKiogUGFkZGVkIGRpc3BsYXkgcmFuZ2UgZm9yIHRoZSBnaXZlbiBkYXRhIGV4dHJlbWVzLiBEZWdlbmVyYXRlLXNhZmU6XG4gKiBlbXB0eSAobm9uLWZpbml0ZSkgb3IgZmxhdCBkYXRhIHN0aWxsIHlpZWxkcyBhIHVzYWJsZSBub256ZXJvIHNwYW4uXG4gKiBmaXhlZE1pbiAvIGZpeGVkTWF4IHBpbiB0aGVpciBlbmQgZXhhY3RseS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhdXRvUmFuZ2UoZGF0YU1pbjogbnVtYmVyLCBkYXRhTWF4OiBudW1iZXIsIG9wdHM6IEF1dG9SYW5nZU9wdGlvbnMgPSB7fSk6IERpc3BsYXlSYW5nZSB7XG4gIGNvbnN0IHBhZCA9IG9wdHMucGFkICE9PSB1bmRlZmluZWQgJiYgTnVtYmVyLmlzRmluaXRlKG9wdHMucGFkKSA/IG9wdHMucGFkIDogMC4xO1xuICBsZXQgbG8gPSBOdW1iZXIuaXNGaW5pdGUoZGF0YU1pbikgPyBkYXRhTWluIDogMDtcbiAgbGV0IGhpID0gTnVtYmVyLmlzRmluaXRlKGRhdGFNYXgpID8gZGF0YU1heCA6IDE7XG4gIGlmIChoaSA8IGxvKSB7XG4gICAgY29uc3QgdCA9IGxvO1xuICAgIGxvID0gaGk7XG4gICAgaGkgPSB0O1xuICB9XG4gIGlmIChvcHRzLmluY2x1ZGVaZXJvKSB7XG4gICAgaWYgKGxvID4gMCkgbG8gPSAwO1xuICAgIGlmIChoaSA8IDApIGhpID0gMDtcbiAgfVxuICBpZiAoaGkgLSBsbyA8PSAwKSB7XG4gICAgLy8gRmxhdCAob3Igc2luZ2xlLXZhbHVlKSBkYXRhOiBzeW50aGVzaXplIGEgc3BhbiBhcm91bmQgdGhlIHZhbHVlLlxuICAgIGNvbnN0IGhhbGYgPSBNYXRoLm1heChNYXRoLmFicyhsbykgKiAwLjUsIDAuNSk7XG4gICAgbG8gLT0gaGFsZjtcbiAgICBoaSArPSBoYWxmO1xuICB9XG4gIGNvbnN0IHNwYW4gPSBoaSAtIGxvO1xuICBsZXQgbWluID0gbG8gLSBzcGFuICogcGFkO1xuICBsZXQgbWF4ID0gaGkgKyBzcGFuICogcGFkO1xuICBpZiAob3B0cy5pbmNsdWRlWmVybyAmJiBsbyA+PSAwICYmIG1pbiA8IDApIG1pbiA9IDA7XG4gIGNvbnN0IHsgZml4ZWRNaW4sIGZpeGVkTWF4IH0gPSBvcHRzO1xuICBpZiAoZml4ZWRNaW4gIT09IHVuZGVmaW5lZCAmJiBOdW1iZXIuaXNGaW5pdGUoZml4ZWRNaW4pKSBtaW4gPSBmaXhlZE1pbjtcbiAgaWYgKGZpeGVkTWF4ICE9PSB1bmRlZmluZWQgJiYgTnVtYmVyLmlzRmluaXRlKGZpeGVkTWF4KSkgbWF4ID0gZml4ZWRNYXg7XG4gIGlmICghKG1heCA+IG1pbikpIHtcbiAgICAvLyBEZWdlbmVyYXRlIHBpbnMgKGVxdWFsIG9yIGNyb3NzZWQpOiBrZWVwIHRoZSByYW5nZSB1c2FibGUgYnkgbW92aW5nIHRoZVxuICAgIC8vIHVuLXBpbm5lZCBlbmQgKG9yLCB3aGVuIGJvdGggYXJlIHBpbm5lZCwgdGhlIHRvcCkuXG4gICAgaWYgKGZpeGVkTWF4ICE9PSB1bmRlZmluZWQgJiYgZml4ZWRNaW4gPT09IHVuZGVmaW5lZCkgbWluID0gbWF4IC0gMTtcbiAgICBlbHNlIG1heCA9IG1pbiArIDE7XG4gIH1cbiAgcmV0dXJuIHsgbWluLCBtYXggfTtcbn1cblxuLy8gLS0gVGlja3MgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IE5JQ0VfTUFOVElTU0FTID0gWzEsIDIsIDVdO1xuXG4vKiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5pY2VTdGVwKHNwYW46IG51bWJlciwgbWF4VGlja3M6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHNwYW4pIHx8IHNwYW4gPD0gMCkgcmV0dXJuIDE7XG4gIGNvbnN0IG1heCA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IobWF4VGlja3MpKTtcbiAgbGV0IGUgPSBNYXRoLmZsb29yKE1hdGgubG9nMTAoc3BhbiAvIG1heCkpO1xuICBmb3IgKDs7KSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBOSUNFX01BTlRJU1NBUy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3Qgc3RlcCA9IE5JQ0VfTUFOVElTU0FTW2ldICogTWF0aC5wb3coMTAsIGUpO1xuICAgICAgaWYgKHNwYW4gLyBzdGVwIDw9IG1heCkgcmV0dXJuIHN0ZXA7XG4gICAgfVxuICAgIGUrKztcbiAgfVxufVxuXG4vKlJldHVybnMgW10gZm9yIGFuIGVtcHR5L2ludmFsaWQgcmFuZ2UuIEFsbG9jYXRlcyAodGhlIGVsZW1lbnQgY2FsbHMgaXRcbiAqIG9ubHkgd2hlbiB0aGUgZGlzcGxheSByYW5nZSBjaGFuZ2VzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuaWNlVGlja3MobG86IG51bWJlciwgaGk6IG51bWJlciwgbWF4VGlja3M6IG51bWJlcik6IG51bWJlcltdIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUobG8pIHx8ICFOdW1iZXIuaXNGaW5pdGUoaGkpIHx8ICEoaGkgPiBsbykpIHJldHVybiBbXTtcbiAgY29uc3Qgc3RlcCA9IG5pY2VTdGVwKGhpIC0gbG8sIG1heFRpY2tzKTtcbiAgY29uc3QgZmlyc3QgPSBNYXRoLmNlaWwobG8gLyBzdGVwKTtcbiAgY29uc3QgbGFzdCA9IE1hdGguZmxvb3IoaGkgLyBzdGVwKTtcbiAgY29uc3QgdGlja3M6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSBmaXJzdDsgaSA8PSBsYXN0OyBpKyspIHRpY2tzLnB1c2goaSAqIHN0ZXApO1xuICByZXR1cm4gdGlja3M7XG59XG5cbi8vIC0tIE1pbi1tYXggZG93bnNhbXBsaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBNaW4tbWF4IGRvd25zYW1wbGUgb2YgdGhlIHJpbmcgaW50byBgYmluc2AgYnVja2V0cyBcdTIwMTQgdGhlIGNsYXNzaWNcbiAqIG1vcmUtc2FtcGxlcy10aGFuLXBpeGVscyByZWR1Y3Rpb24uIEVtcHR5IGJpbnMgKGFuZCBib3RoIGFycmF5cyBwYXN0IGFcbiAqIGNsYW1wZWQgYGJpbnNgKSBhcmUgTmFOLiBgYmluc2AgaXMgY2xhbXBlZCB0byB0aGUgc2hvcnRlciBvdXQgYXJyYXkuXG4gKiBXcml0ZXMgb25seSBpbnRvIHRoZSBjYWxsZXItb3duZWQgYXJyYXlzIFx1MjAxNCBubyBhbGxvY2F0aW9uLiBSZXR1cm5zIHRoZVxuICogbnVtYmVyIG9mIG5vbi1lbXB0eSBiaW5zIChtaW4oYmlucywgY291bnQpIGZvciBmaW5pdGUgZGF0YSkuICovXG5leHBvcnQgZnVuY3Rpb24gYmluTWluTWF4KHJpbmc6IFNhbXBsZVJpbmcsIGJpbnM6IG51bWJlciwgb3V0TWluOiBGbG9hdDMyQXJyYXksIG91dE1heDogRmxvYXQzMkFycmF5KTogbnVtYmVyIHtcbiAgY29uc3QgbkJpbnMgPSBNYXRoLm1pbihNYXRoLm1heCgwLCBNYXRoLmZsb29yKGJpbnMpKSwgb3V0TWluLmxlbmd0aCwgb3V0TWF4Lmxlbmd0aCk7XG4gIGZvciAobGV0IGIgPSAwOyBiIDwgbkJpbnM7IGIrKykge1xuICAgIG91dE1pbltiXSA9IE5hTjtcbiAgICBvdXRNYXhbYl0gPSBOYU47XG4gIH1cbiAgY29uc3QgY291bnQgPSByaW5nLmxlbmd0aDtcbiAgaWYgKG5CaW5zID09PSAwIHx8IGNvdW50ID09PSAwKSByZXR1cm4gMDtcbiAgbGV0IHVzZWQgPSAwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICBjb25zdCB2ID0gcmluZy5hdChpKTtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2KSkgY29udGludWU7XG4gICAgY29uc3QgYiA9IE1hdGguZmxvb3IoKGkgKiBuQmlucykgLyBjb3VudCk7XG4gICAgaWYgKG91dE1pbltiXSA9PT0gb3V0TWluW2JdKSB7XG4gICAgICAvLyBCaW4gYWxyZWFkeSBzZWVkZWQ6IHdpZGVuIGl0cyBlbnZlbG9wZS5cbiAgICAgIGlmICh2IDwgb3V0TWluW2JdKSBvdXRNaW5bYl0gPSB2O1xuICAgICAgaWYgKHYgPiBvdXRNYXhbYl0pIG91dE1heFtiXSA9IHY7XG4gICAgfSBlbHNlIHtcbiAgICAgIG91dE1pbltiXSA9IHY7XG4gICAgICBvdXRNYXhbYl0gPSB2O1xuICAgICAgdXNlZCsrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdXNlZDtcbn1cblxuLyoqIE5ld2VzdCBmaW5pdGUgc2FtcGxlIGluIGVhY2ggb2YgYGJpbnNgIGJ1Y2tldHMgXHUyMDE0IHRoZSByZWR1Y3Rpb24gYSBzdGFja2VkXG4gKiBBUkVBIHdhbnRzLCB3aGVyZSBiaW5NaW5NYXgncyBlbnZlbG9wZSB3b3VsZCBkcmF3IGEgYmFuZCBhcyBhIHJhZ2dlZCBibHVyLlxuICogQmluIG1lbWJlcnNoaXAgbWF0Y2hlcyBiaW5NaW5NYXggZXhhY3RseSAoc2FtcGxlIGkgbGFuZHMgaW4gZmxvb3IoaSAqIGJpbnNcbiAqIC8gY291bnQpKSwgc28gZXZlcnkgc2VyaWVzIG9mIG9uZSBTZXJpZXNSaW5nIGJpbnMgb250byB0aGUgc2FtZSBjb2x1bW5zIGFuZFxuICogdGhlIGJhbmRzIHN0YXkgYWxpZ25lZC4gRW1wdHkgYmlucyBhcmUgTmFOLiBgYmluc2AgaXMgY2xhbXBlZCB0b1xuICogb3V0Lmxlbmd0aC4gV3JpdGVzIG9ubHkgaW50byB0aGUgY2FsbGVyLW93bmVkIGFycmF5IFx1MjAxNCBubyBhbGxvY2F0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJpbkxhc3QocmluZzogU2FtcGxlUmluZywgYmluczogbnVtYmVyLCBvdXQ6IEZsb2F0MzJBcnJheSk6IG51bWJlciB7XG4gIGNvbnN0IG5CaW5zID0gTWF0aC5taW4oTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihiaW5zKSksIG91dC5sZW5ndGgpO1xuICBmb3IgKGxldCBiID0gMDsgYiA8IG5CaW5zOyBiKyspIG91dFtiXSA9IE5hTjtcbiAgY29uc3QgY291bnQgPSByaW5nLmxlbmd0aDtcbiAgaWYgKG5CaW5zID09PSAwIHx8IGNvdW50ID09PSAwKSByZXR1cm4gMDtcbiAgbGV0IHVzZWQgPSAwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICBjb25zdCB2ID0gcmluZy5hdChpKTtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2KSkgY29udGludWU7XG4gICAgY29uc3QgYiA9IE1hdGguZmxvb3IoKGkgKiBuQmlucykgLyBjb3VudCk7XG4gICAgaWYgKG91dFtiXSAhPT0gb3V0W2JdKSB1c2VkKys7XG4gICAgb3V0W2JdID0gdjsgLy8gbGF0ZXIgc2FtcGxlcyBpbiB0aGUgYmluIG92ZXJ3cml0ZTogdGhlIG5ld2VzdCBvbmUgd2luc1xuICB9XG4gIHJldHVybiB1c2VkO1xufVxuXG4vLyAtLSBNdWx0aS1zZXJpZXMgKHN0YWNrZWQpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogT25lIGJhbmQgb2YgYSBzdGFja2VkIGdyYXBoOiBpdHMgZGF0YSBrZXksIGl0cyBsZWdlbmQgdGV4dCBhbmQgaXRzIGNvbG9yLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTZXJpZXNTcGVjIHtcbiAgLyoqIFRoZSBrZXkgcHVzaCgpIHJlYWRzIG91dCBvZiBhIHNhbXBsZSByZWNvcmQuIEFsc28gdGhlIGNvbG9yIHNlZWQuICovXG4gIGtleTogc3RyaW5nO1xuICAvKiogTGVnZW5kIHRleHQuIERlZmF1bHRzIHRvIHRoZSBrZXkuICovXG4gIGxhYmVsPzogc3RyaW5nO1xuICAvKiogRXhwbGljaXQgQ1NTIGNvbG9yLiBBYnNlbnQsIHRoZSBiYW5kIHRha2VzIGEgc3RhYmxlIGNvbG9yIGZyb20gaXRzIGtleS4gKi9cbiAgY29sb3I/OiBzdHJpbmc7XG59XG5cbi8qKiBUaGUgZGF0YSBiZWhpbmQgYSBzdGFja2VkIGFyZWE6IG9uZSBTYW1wbGVSaW5nIHBlciBiYW5kLCBvbiBvbmUgdGltZVxuICogYXhpcy4gRXZlcnkgcHVzaCBhZHZhbmNlcyBFVkVSWSBzZXJpZXMsIHNvIHNhbXBsZSBpIG9mIG9uZSBiYW5kIGxpbmVzIHVwXG4gKiB3aXRoIHNhbXBsZSBpIG9mIHRoZSBuZXh0LiBPbmx5IHRoZSBjb25zdHJ1Y3Rvciwgc2V0Q2FwYWNpdHkoKSBhbmRcbiAqIHNldEtleXMoKSBhbGxvY2F0ZS4gKi9cbmV4cG9ydCBjbGFzcyBTZXJpZXNSaW5nIHtcbiAgcHJpdmF0ZSBrczogc3RyaW5nW107XG4gIHByaXZhdGUgcmluZ3M6IFNhbXBsZVJpbmdbXTtcbiAgcHJpdmF0ZSBjYXA6IG51bWJlcjtcblxuICBjb25zdHJ1Y3RvcihrZXlzOiByZWFkb25seSBzdHJpbmdbXSwgY2FwYWNpdHk6IG51bWJlcikge1xuICAgIHRoaXMuY2FwID0gY2xhbXBDYXBhY2l0eShjYXBhY2l0eSk7XG4gICAgdGhpcy5rcyA9IGtleXMuc2xpY2UoKTtcbiAgICB0aGlzLnJpbmdzID0gdGhpcy5rcy5tYXAoKCkgPT4gbmV3IFNhbXBsZVJpbmcodGhpcy5jYXApKTtcbiAgfVxuXG4gIC8qKiBUaGUgc2VyaWVzIGtleXMsIGluIHN0YWNraW5nIG9yZGVyIChpbmRleCBtdWx0aXBsZSBzaXRzIGF0IHRoZSBib3R0b20pLiAqL1xuICBnZXQga2V5cygpOiByZWFkb25seSBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIHRoaXMua3M7XG4gIH1cblxuICAvKiogTnVtYmVyIG9mIHNlcmllcy4gKi9cbiAgZ2V0IGNvdW50KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMua3MubGVuZ3RoO1xuICB9XG5cbiAgLyoqIFNhbXBsZXMgY3VycmVudGx5IHN0b3JlZCBwZXIgc2VyaWVzIChldmVyeSBzZXJpZXMgaG9sZHMgdGhlIHNhbWUgbnVtYmVyKS4gKi9cbiAgZ2V0IGxlbmd0aCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnJpbmdzLmxlbmd0aCA+IDAgPyB0aGlzLnJpbmdzWzBdLmxlbmd0aCA6IDA7XG4gIH1cblxuICAvKiogU2FtcGxlcyBoZWxkIHBlciBzZXJpZXMgYmVmb3JlIHRoZSBvbGRlc3QgaXMgb3ZlcndyaXR0ZW4uICovXG4gIGdldCBjYXBhY2l0eSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmNhcDtcbiAgfVxuXG4gIC8qKiBUaGUgcmluZyBiZWhpbmQgb25lIHNlcmllcyAoTmFOLXNhZmUgcmVhZHMgdmlhIGF0KCkpLiAqL1xuICByaW5nKHNlcmllczogbnVtYmVyKTogU2FtcGxlUmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMucmluZ3Nbc2VyaWVzXTtcbiAgfVxuXG4gIC8qTmFOIG91dCBvZiByYW5nZS4gKi9cbiAgYXQoc2VyaWVzOiBudW1iZXIsIGk6IG51bWJlcik6IG51bWJlciB7XG4gICAgY29uc3QgciA9IHRoaXMucmluZ3Nbc2VyaWVzXTtcbiAgICByZXR1cm4gciA9PT0gdW5kZWZpbmVkID8gTmFOIDogci5hdChpKTtcbiAgfVxuXG4gIC8qKiBBcHBlbmQgb25lIGNvbHVtbi4gQSByZWNvcmQgaXMgcmVhZCBieSBrZXk7IGFuIGFycmF5IGlzIHJlYWQgYnlcbiAgICogc2VyaWVzIGluZGV4LiAqL1xuICBwdXNoKHZhbHVlczogUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgbnVtYmVyPj4gfCByZWFkb25seSBudW1iZXJbXSk6IHZvaWQge1xuICAgIGNvbnN0IGJ5SW5kZXggPSBBcnJheS5pc0FycmF5KHZhbHVlcyk7XG4gICAgZm9yIChsZXQgcyA9IDA7IHMgPCB0aGlzLnJpbmdzLmxlbmd0aDsgcysrKSB7XG4gICAgICBjb25zdCByYXcgPSBieUluZGV4ID8gKHZhbHVlcyBhcyByZWFkb25seSBudW1iZXJbXSlbc10gOiAodmFsdWVzIGFzIFJlY29yZDxzdHJpbmcsIG51bWJlcj4pW3RoaXMua3Nbc11dO1xuICAgICAgdGhpcy5yaW5nc1tzXS5wdXNoKE51bWJlci5pc0Zpbml0ZShyYXcpID8gcmF3IDogMCk7XG4gICAgfVxuICB9XG5cbiAgLyoqIERyb3AgZXZlcnkgc2VyaWVzJyBzYW1wbGVzIChrZWVwcyB0aGUgc2VyaWVzIGFuZCB0aGVpciBidWZmZXJzKS4gKi9cbiAgY2xlYXIoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCByIG9mIHRoaXMucmluZ3MpIHIuY2xlYXIoKTtcbiAgfVxuXG4gIC8qKiBSZXNpemUgZXZlcnkgc2VyaWVzLCBwcmVzZXJ2aW5nIHRoZSBuZXdlc3Qgc2FtcGxlcyB0aGF0IHN0aWxsIGZpdC4gKi9cbiAgc2V0Q2FwYWNpdHkobjogbnVtYmVyKTogdm9pZCB7XG4gICAgY29uc3QgY2FwID0gY2xhbXBDYXBhY2l0eShuKTtcbiAgICBpZiAoY2FwID09PSB0aGlzLmNhcCkgcmV0dXJuO1xuICAgIHRoaXMuY2FwID0gY2FwO1xuICAgIGZvciAoY29uc3QgciBvZiB0aGlzLnJpbmdzKSByLnNldENhcGFjaXR5KGNhcCk7XG4gIH1cblxuICAvKiogUmVwbGFjZSB0aGUgc2VyaWVzIGxpc3QuIEEga2V5IHByZXNlbnQgYmVmb3JlIGFuZCBhZnRlciBrZWVwcyBpdHNcbiAgICogaGlzdG9yeS4gKi9cbiAgc2V0S2V5cyhrZXlzOiByZWFkb25seSBzdHJpbmdbXSk6IHZvaWQge1xuICAgIGNvbnN0IGxlbmd0aCA9IHRoaXMubGVuZ3RoO1xuICAgIGNvbnN0IHByZXZpb3VzID0gbmV3IE1hcDxzdHJpbmcsIFNhbXBsZVJpbmc+KCk7XG4gICAgZm9yIChsZXQgcyA9IDA7IHMgPCB0aGlzLmtzLmxlbmd0aDsgcysrKSBwcmV2aW91cy5zZXQodGhpcy5rc1tzXSwgdGhpcy5yaW5nc1tzXSk7XG4gICAgdGhpcy5rcyA9IGtleXMuc2xpY2UoKTtcbiAgICB0aGlzLnJpbmdzID0gdGhpcy5rcy5tYXAoKGtleSkgPT4ge1xuICAgICAgY29uc3Qga2VwdCA9IHByZXZpb3VzLmdldChrZXkpO1xuICAgICAgaWYgKGtlcHQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGtlcHQ7XG4gICAgICBjb25zdCBmcmVzaCA9IG5ldyBTYW1wbGVSaW5nKHRoaXMuY2FwKTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIGZyZXNoLnB1c2goMCk7XG4gICAgICByZXR1cm4gZnJlc2g7XG4gICAgfSk7XG4gIH1cbn1cblxuLyogKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFja2VkVG9wKHM6IFNlcmllc1JpbmcsIHNlcmllczogbnVtYmVyLCBpOiBudW1iZXIpOiBudW1iZXIge1xuICBsZXQgc3VtID0gMDtcbiAgZm9yIChsZXQgaiA9IDA7IGogPD0gc2VyaWVzICYmIGogPCBzLmNvdW50OyBqKyspIHtcbiAgICBjb25zdCB2ID0gcy5hdChqLCBpKTtcbiAgICBpZiAoTnVtYmVyLmlzRmluaXRlKHYpKSBzdW0gKz0gdjtcbiAgfVxuICByZXR1cm4gc3VtO1xufVxuXG4vKiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YWNrZWRUb3RhbChzOiBTZXJpZXNSaW5nLCBpOiBudW1iZXIpOiBudW1iZXIge1xuICByZXR1cm4gc3RhY2tlZFRvcChzLCBzLmNvdW50IC0gMSwgaSk7XG59XG5cbi8qICovXG5leHBvcnQgZnVuY3Rpb24gc3RhY2tlZE1heChzOiBTZXJpZXNSaW5nKTogbnVtYmVyIHtcbiAgbGV0IG14ID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdG90YWwgPSBzdGFja2VkVG90YWwocywgaSk7XG4gICAgaWYgKHRvdGFsID4gbXgpIG14ID0gdG90YWw7XG4gIH1cbiAgcmV0dXJuIG14O1xufVxuXG4vLyAtLSBWYWx1ZSBmb3JtYXR0aW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBEZXRlcm1pbmlzdGljIEhVRCB2YWx1ZSBmb3JtYXR0aW5nLiBOb24tZmluaXRlIFx1MjE5MiAnXHUyMDE0Jy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRWYWx1ZSh2OiBudW1iZXIsIHVuaXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHYpKSByZXR1cm4gJ1x1MjAxNCc7XG4gIGlmICh1bml0ID09PSAnZnBzJykgcmV0dXJuIGAke01hdGgucm91bmQodil9ZnBzYDtcbiAgaWYgKHVuaXQgPT09ICdtcycgfHwgdW5pdCA9PT0gJycpIHtcbiAgICBjb25zdCBhID0gTWF0aC5hYnModik7XG4gICAgY29uc3QgcyA9IGEgPj0gMTAwID8gdi50b0ZpeGVkKDApIDogYSA+PSAxMCA/IHYudG9GaXhlZCgxKSA6IHYudG9GaXhlZCgyKTtcbiAgICByZXR1cm4gcyArIHVuaXQ7XG4gIH1cbiAgcmV0dXJuIHYudG9GaXhlZCgxKSArIHVuaXQ7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBRUEsU0FBUyxZQUFZO0FBQ3JCLE9BQU8sWUFBWTs7O0FDZ0JaLElBQU0sYUFBTixNQUFpQjtBQUFBLEVBQ2Q7QUFBQSxFQUNBLE9BQU87QUFBQTtBQUFBLEVBQ1AsUUFBUTtBQUFBO0FBQUE7QUFBQSxFQUdoQixZQUFZLFVBQWtCO0FBQzVCLFNBQUssTUFBTSxJQUFJLGFBQWEsY0FBYyxRQUFRLENBQUM7QUFBQSxFQUNyRDtBQUFBO0FBQUEsRUFHQSxJQUFJLFNBQWlCO0FBQ25CLFdBQU8sS0FBSztBQUFBLEVBQ2Q7QUFBQTtBQUFBLEVBR0EsSUFBSSxXQUFtQjtBQUNyQixXQUFPLEtBQUssSUFBSTtBQUFBLEVBQ2xCO0FBQUE7QUFBQSxFQUdBLEtBQUssR0FBaUI7QUFDcEIsU0FBSyxJQUFJLEtBQUssSUFBSSxJQUFJO0FBQ3RCLFNBQUssUUFBUSxLQUFLLE9BQU8sS0FBSyxLQUFLLElBQUk7QUFDdkMsUUFBSSxLQUFLLFFBQVEsS0FBSyxJQUFJLE9BQVEsTUFBSztBQUFBLEVBQ3pDO0FBQUE7QUFBQSxFQUdBLEdBQUcsR0FBbUI7QUFDcEIsUUFBSSxJQUFJLEtBQUssS0FBSyxLQUFLLE1BQU8sUUFBTztBQUNyQyxVQUFNLE1BQU0sS0FBSyxJQUFJO0FBQ3JCLFdBQU8sS0FBSyxLQUFLLEtBQUssT0FBTyxLQUFLLFFBQVEsSUFBSSxPQUFPLEdBQUc7QUFBQSxFQUMxRDtBQUFBO0FBQUEsRUFHQSxTQUFpQjtBQUNmLFFBQUksS0FBSyxVQUFVLEVBQUcsUUFBTztBQUM3QixVQUFNLE1BQU0sS0FBSyxJQUFJO0FBQ3JCLFdBQU8sS0FBSyxLQUFLLEtBQUssT0FBTyxJQUFJLE9BQU8sR0FBRztBQUFBLEVBQzdDO0FBQUE7QUFBQSxFQUdBLFFBQWM7QUFDWixTQUFLLE9BQU87QUFDWixTQUFLLFFBQVE7QUFBQSxFQUNmO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLFlBQVksR0FBaUI7QUFDM0IsVUFBTSxNQUFNLGNBQWMsQ0FBQztBQUMzQixRQUFJLFFBQVEsS0FBSyxJQUFJLE9BQVE7QUFDN0IsVUFBTSxPQUFPLElBQUksYUFBYSxHQUFHO0FBQ2pDLFVBQU0sT0FBTyxLQUFLLElBQUksS0FBSyxPQUFPLEdBQUc7QUFDckMsYUFBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLElBQUssTUFBSyxDQUFDLElBQUksS0FBSyxHQUFHLEtBQUssUUFBUSxPQUFPLENBQUM7QUFDdEUsU0FBSyxNQUFNO0FBQ1gsU0FBSyxPQUFPLE9BQU87QUFDbkIsU0FBSyxRQUFRO0FBQUEsRUFDZjtBQUNGO0FBRUEsU0FBUyxjQUFjLEdBQW1CO0FBQ3hDLFNBQU8sS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLENBQUMsS0FBSyxDQUFDO0FBQ3ZDO0FBb0JPLFNBQVMsYUFBYSxNQUFrQixLQUEyQjtBQUN4RSxNQUFJLElBQUk7QUFDUixNQUFJLE1BQU07QUFDVixNQUFJLEtBQUs7QUFDVCxNQUFJLEtBQUs7QUFDVCxXQUFTLElBQUksR0FBRyxJQUFJLEtBQUssUUFBUSxLQUFLO0FBQ3BDLFVBQU0sSUFBSSxLQUFLLEdBQUcsQ0FBQztBQUNuQixRQUFJLENBQUMsT0FBTyxTQUFTLENBQUMsRUFBRztBQUN6QjtBQUNBLFdBQU87QUFDUCxRQUFJLElBQUksR0FBSSxNQUFLO0FBQ2pCLFFBQUksSUFBSSxHQUFJLE1BQUs7QUFBQSxFQUNuQjtBQUNBLE1BQUksVUFBVSxLQUFLLE9BQU87QUFDMUIsTUFBSSxNQUFNLElBQUksSUFBSSxNQUFNLElBQUk7QUFDNUIsTUFBSSxNQUFNLElBQUksSUFBSSxLQUFLO0FBQ3ZCLE1BQUksTUFBTSxJQUFJLElBQUksS0FBSztBQUN2QixTQUFPO0FBQ1Q7QUF5Qk8sU0FBUyxVQUFVLFNBQWlCLFNBQWlCLE9BQXlCLENBQUMsR0FBaUI7QUFDckcsUUFBTSxNQUFNLEtBQUssUUFBUSxVQUFhLE9BQU8sU0FBUyxLQUFLLEdBQUcsSUFBSSxLQUFLLE1BQU07QUFDN0UsTUFBSSxLQUFLLE9BQU8sU0FBUyxPQUFPLElBQUksVUFBVTtBQUM5QyxNQUFJLEtBQUssT0FBTyxTQUFTLE9BQU8sSUFBSSxVQUFVO0FBQzlDLE1BQUksS0FBSyxJQUFJO0FBQ1gsVUFBTSxJQUFJO0FBQ1YsU0FBSztBQUNMLFNBQUs7QUFBQSxFQUNQO0FBQ0EsTUFBSSxLQUFLLGFBQWE7QUFDcEIsUUFBSSxLQUFLLEVBQUcsTUFBSztBQUNqQixRQUFJLEtBQUssRUFBRyxNQUFLO0FBQUEsRUFDbkI7QUFDQSxNQUFJLEtBQUssTUFBTSxHQUFHO0FBRWhCLFVBQU0sT0FBTyxLQUFLLElBQUksS0FBSyxJQUFJLEVBQUUsSUFBSSxLQUFLLEdBQUc7QUFDN0MsVUFBTTtBQUNOLFVBQU07QUFBQSxFQUNSO0FBQ0EsUUFBTSxPQUFPLEtBQUs7QUFDbEIsTUFBSSxNQUFNLEtBQUssT0FBTztBQUN0QixNQUFJLE1BQU0sS0FBSyxPQUFPO0FBQ3RCLE1BQUksS0FBSyxlQUFlLE1BQU0sS0FBSyxNQUFNLEVBQUcsT0FBTTtBQUNsRCxRQUFNLEVBQUUsVUFBVSxTQUFTLElBQUk7QUFDL0IsTUFBSSxhQUFhLFVBQWEsT0FBTyxTQUFTLFFBQVEsRUFBRyxPQUFNO0FBQy9ELE1BQUksYUFBYSxVQUFhLE9BQU8sU0FBUyxRQUFRLEVBQUcsT0FBTTtBQUMvRCxNQUFJLEVBQUUsTUFBTSxNQUFNO0FBR2hCLFFBQUksYUFBYSxVQUFhLGFBQWEsT0FBVyxPQUFNLE1BQU07QUFBQSxRQUM3RCxPQUFNLE1BQU07QUFBQSxFQUNuQjtBQUNBLFNBQU8sRUFBRSxLQUFLLElBQUk7QUFDcEI7QUFJQSxJQUFNLGlCQUFpQixDQUFDLEdBQUcsR0FBRyxDQUFDO0FBR3hCLFNBQVMsU0FBUyxNQUFjLFVBQTBCO0FBQy9ELE1BQUksQ0FBQyxPQUFPLFNBQVMsSUFBSSxLQUFLLFFBQVEsRUFBRyxRQUFPO0FBQ2hELFFBQU0sTUFBTSxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sUUFBUSxDQUFDO0FBQzVDLE1BQUksSUFBSSxLQUFLLE1BQU0sS0FBSyxNQUFNLE9BQU8sR0FBRyxDQUFDO0FBQ3pDLGFBQVM7QUFDUCxhQUFTLElBQUksR0FBRyxJQUFJLGVBQWUsUUFBUSxLQUFLO0FBQzlDLFlBQU0sT0FBTyxlQUFlLENBQUMsSUFBSSxLQUFLLElBQUksSUFBSSxDQUFDO0FBQy9DLFVBQUksT0FBTyxRQUFRLElBQUssUUFBTztBQUFBLElBQ2pDO0FBQ0E7QUFBQSxFQUNGO0FBQ0Y7QUFJTyxTQUFTLFVBQVUsSUFBWSxJQUFZLFVBQTRCO0FBQzVFLE1BQUksQ0FBQyxPQUFPLFNBQVMsRUFBRSxLQUFLLENBQUMsT0FBTyxTQUFTLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSyxRQUFPLENBQUM7QUFDeEUsUUFBTSxPQUFPLFNBQVMsS0FBSyxJQUFJLFFBQVE7QUFDdkMsUUFBTSxRQUFRLEtBQUssS0FBSyxLQUFLLElBQUk7QUFDakMsUUFBTSxPQUFPLEtBQUssTUFBTSxLQUFLLElBQUk7QUFDakMsUUFBTSxRQUFrQixDQUFDO0FBQ3pCLFdBQVMsSUFBSSxPQUFPLEtBQUssTUFBTSxJQUFLLE9BQU0sS0FBSyxJQUFJLElBQUk7QUFDdkQsU0FBTztBQUNUO0FBU08sU0FBUyxVQUFVLE1BQWtCLE1BQWMsUUFBc0IsUUFBOEI7QUFDNUcsUUFBTSxRQUFRLEtBQUssSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sSUFBSSxDQUFDLEdBQUcsT0FBTyxRQUFRLE9BQU8sTUFBTTtBQUNsRixXQUFTLElBQUksR0FBRyxJQUFJLE9BQU8sS0FBSztBQUM5QixXQUFPLENBQUMsSUFBSTtBQUNaLFdBQU8sQ0FBQyxJQUFJO0FBQUEsRUFDZDtBQUNBLFFBQU0sUUFBUSxLQUFLO0FBQ25CLE1BQUksVUFBVSxLQUFLLFVBQVUsRUFBRyxRQUFPO0FBQ3ZDLE1BQUksT0FBTztBQUNYLFdBQVMsSUFBSSxHQUFHLElBQUksT0FBTyxLQUFLO0FBQzlCLFVBQU0sSUFBSSxLQUFLLEdBQUcsQ0FBQztBQUNuQixRQUFJLENBQUMsT0FBTyxTQUFTLENBQUMsRUFBRztBQUN6QixVQUFNLElBQUksS0FBSyxNQUFPLElBQUksUUFBUyxLQUFLO0FBQ3hDLFFBQUksT0FBTyxDQUFDLE1BQU0sT0FBTyxDQUFDLEdBQUc7QUFFM0IsVUFBSSxJQUFJLE9BQU8sQ0FBQyxFQUFHLFFBQU8sQ0FBQyxJQUFJO0FBQy9CLFVBQUksSUFBSSxPQUFPLENBQUMsRUFBRyxRQUFPLENBQUMsSUFBSTtBQUFBLElBQ2pDLE9BQU87QUFDTCxhQUFPLENBQUMsSUFBSTtBQUNaLGFBQU8sQ0FBQyxJQUFJO0FBQ1o7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQVFPLFNBQVMsUUFBUSxNQUFrQixNQUFjLEtBQTJCO0FBQ2pGLFFBQU0sUUFBUSxLQUFLLElBQUksS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLElBQUksQ0FBQyxHQUFHLElBQUksTUFBTTtBQUNoRSxXQUFTLElBQUksR0FBRyxJQUFJLE9BQU8sSUFBSyxLQUFJLENBQUMsSUFBSTtBQUN6QyxRQUFNLFFBQVEsS0FBSztBQUNuQixNQUFJLFVBQVUsS0FBSyxVQUFVLEVBQUcsUUFBTztBQUN2QyxNQUFJLE9BQU87QUFDWCxXQUFTLElBQUksR0FBRyxJQUFJLE9BQU8sS0FBSztBQUM5QixVQUFNLElBQUksS0FBSyxHQUFHLENBQUM7QUFDbkIsUUFBSSxDQUFDLE9BQU8sU0FBUyxDQUFDLEVBQUc7QUFDekIsVUFBTSxJQUFJLEtBQUssTUFBTyxJQUFJLFFBQVMsS0FBSztBQUN4QyxRQUFJLElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyxFQUFHO0FBQ3ZCLFFBQUksQ0FBQyxJQUFJO0FBQUEsRUFDWDtBQUNBLFNBQU87QUFDVDtBQWtCTyxJQUFNLGFBQU4sTUFBaUI7QUFBQSxFQUNkO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUVSLFlBQVksTUFBeUIsVUFBa0I7QUFDckQsU0FBSyxNQUFNLGNBQWMsUUFBUTtBQUNqQyxTQUFLLEtBQUssS0FBSyxNQUFNO0FBQ3JCLFNBQUssUUFBUSxLQUFLLEdBQUcsSUFBSSxNQUFNLElBQUksV0FBVyxLQUFLLEdBQUcsQ0FBQztBQUFBLEVBQ3pEO0FBQUE7QUFBQSxFQUdBLElBQUksT0FBMEI7QUFDNUIsV0FBTyxLQUFLO0FBQUEsRUFDZDtBQUFBO0FBQUEsRUFHQSxJQUFJLFFBQWdCO0FBQ2xCLFdBQU8sS0FBSyxHQUFHO0FBQUEsRUFDakI7QUFBQTtBQUFBLEVBR0EsSUFBSSxTQUFpQjtBQUNuQixXQUFPLEtBQUssTUFBTSxTQUFTLElBQUksS0FBSyxNQUFNLENBQUMsRUFBRSxTQUFTO0FBQUEsRUFDeEQ7QUFBQTtBQUFBLEVBR0EsSUFBSSxXQUFtQjtBQUNyQixXQUFPLEtBQUs7QUFBQSxFQUNkO0FBQUE7QUFBQSxFQUdBLEtBQUssUUFBd0M7QUFDM0MsV0FBTyxLQUFLLE1BQU0sTUFBTTtBQUFBLEVBQzFCO0FBQUE7QUFBQSxFQUdBLEdBQUcsUUFBZ0IsR0FBbUI7QUFDcEMsVUFBTSxJQUFJLEtBQUssTUFBTSxNQUFNO0FBQzNCLFdBQU8sTUFBTSxTQUFZLE1BQU0sRUFBRSxHQUFHLENBQUM7QUFBQSxFQUN2QztBQUFBO0FBQUE7QUFBQSxFQUlBLEtBQUssUUFBb0U7QUFDdkUsVUFBTSxVQUFVLE1BQU0sUUFBUSxNQUFNO0FBQ3BDLGFBQVMsSUFBSSxHQUFHLElBQUksS0FBSyxNQUFNLFFBQVEsS0FBSztBQUMxQyxZQUFNLE1BQU0sVUFBVyxPQUE2QixDQUFDLElBQUssT0FBa0MsS0FBSyxHQUFHLENBQUMsQ0FBQztBQUN0RyxXQUFLLE1BQU0sQ0FBQyxFQUFFLEtBQUssT0FBTyxTQUFTLEdBQUcsSUFBSSxNQUFNLENBQUM7QUFBQSxJQUNuRDtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBR0EsUUFBYztBQUNaLGVBQVcsS0FBSyxLQUFLLE1BQU8sR0FBRSxNQUFNO0FBQUEsRUFDdEM7QUFBQTtBQUFBLEVBR0EsWUFBWSxHQUFpQjtBQUMzQixVQUFNLE1BQU0sY0FBYyxDQUFDO0FBQzNCLFFBQUksUUFBUSxLQUFLLElBQUs7QUFDdEIsU0FBSyxNQUFNO0FBQ1gsZUFBVyxLQUFLLEtBQUssTUFBTyxHQUFFLFlBQVksR0FBRztBQUFBLEVBQy9DO0FBQUE7QUFBQTtBQUFBLEVBSUEsUUFBUSxNQUErQjtBQUNyQyxVQUFNLFNBQVMsS0FBSztBQUNwQixVQUFNLFdBQVcsb0JBQUksSUFBd0I7QUFDN0MsYUFBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLEdBQUcsUUFBUSxJQUFLLFVBQVMsSUFBSSxLQUFLLEdBQUcsQ0FBQyxHQUFHLEtBQUssTUFBTSxDQUFDLENBQUM7QUFDL0UsU0FBSyxLQUFLLEtBQUssTUFBTTtBQUNyQixTQUFLLFFBQVEsS0FBSyxHQUFHLElBQUksQ0FBQyxRQUFRO0FBQ2hDLFlBQU0sT0FBTyxTQUFTLElBQUksR0FBRztBQUM3QixVQUFJLFNBQVMsT0FBVyxRQUFPO0FBQy9CLFlBQU0sUUFBUSxJQUFJLFdBQVcsS0FBSyxHQUFHO0FBQ3JDLGVBQVMsSUFBSSxHQUFHLElBQUksUUFBUSxJQUFLLE9BQU0sS0FBSyxDQUFDO0FBQzdDLGFBQU87QUFBQSxJQUNULENBQUM7QUFBQSxFQUNIO0FBQ0Y7QUFHTyxTQUFTLFdBQVcsR0FBZSxRQUFnQixHQUFtQjtBQUMzRSxNQUFJLE1BQU07QUFDVixXQUFTLElBQUksR0FBRyxLQUFLLFVBQVUsSUFBSSxFQUFFLE9BQU8sS0FBSztBQUMvQyxVQUFNLElBQUksRUFBRSxHQUFHLEdBQUcsQ0FBQztBQUNuQixRQUFJLE9BQU8sU0FBUyxDQUFDLEVBQUcsUUFBTztBQUFBLEVBQ2pDO0FBQ0EsU0FBTztBQUNUO0FBR08sU0FBUyxhQUFhLEdBQWUsR0FBbUI7QUFDN0QsU0FBTyxXQUFXLEdBQUcsRUFBRSxRQUFRLEdBQUcsQ0FBQztBQUNyQztBQUdPLFNBQVMsV0FBVyxHQUF1QjtBQUNoRCxNQUFJLEtBQUs7QUFDVCxXQUFTLElBQUksR0FBRyxJQUFJLEVBQUUsUUFBUSxLQUFLO0FBQ2pDLFVBQU0sUUFBUSxhQUFhLEdBQUcsQ0FBQztBQUMvQixRQUFJLFFBQVEsR0FBSSxNQUFLO0FBQUEsRUFDdkI7QUFDQSxTQUFPO0FBQ1Q7QUFLTyxTQUFTLFlBQVksR0FBVyxNQUFzQjtBQUMzRCxNQUFJLENBQUMsT0FBTyxTQUFTLENBQUMsRUFBRyxRQUFPO0FBQ2hDLE1BQUksU0FBUyxNQUFPLFFBQU8sR0FBRyxLQUFLLE1BQU0sQ0FBQyxDQUFDO0FBQzNDLE1BQUksU0FBUyxRQUFRLFNBQVMsSUFBSTtBQUNoQyxVQUFNLElBQUksS0FBSyxJQUFJLENBQUM7QUFDcEIsVUFBTSxJQUFJLEtBQUssTUFBTSxFQUFFLFFBQVEsQ0FBQyxJQUFJLEtBQUssS0FBSyxFQUFFLFFBQVEsQ0FBQyxJQUFJLEVBQUUsUUFBUSxDQUFDO0FBQ3hFLFdBQU8sSUFBSTtBQUFBLEVBQ2I7QUFDQSxTQUFPLEVBQUUsUUFBUSxDQUFDLElBQUk7QUFDeEI7OztBRDdYQSxJQUFNLFdBQVcsQ0FBQyxNQUE0QjtBQUM1QyxRQUFNLE1BQWdCLENBQUM7QUFDdkIsV0FBUyxJQUFJLEdBQUcsSUFBSSxFQUFFLFFBQVEsSUFBSyxLQUFJLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQztBQUNuRCxTQUFPO0FBQ1Q7QUFFQSxJQUFNLGFBQWEsT0FBa0IsRUFBRSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRyxLQUFLLEVBQUU7QUFJMUUsS0FBSywrQ0FBK0MsTUFBTTtBQUN4RCxRQUFNLElBQUksSUFBSSxXQUFXLENBQUM7QUFDMUIsU0FBTyxNQUFNLEVBQUUsVUFBVSxDQUFDO0FBQzFCLFNBQU8sTUFBTSxFQUFFLFFBQVEsQ0FBQztBQUN4QixJQUFFLEtBQUssQ0FBQztBQUNSLElBQUUsS0FBSyxDQUFDO0FBQ1IsSUFBRSxLQUFLLENBQUM7QUFDUixTQUFPLE1BQU0sRUFBRSxRQUFRLENBQUM7QUFDeEIsU0FBTyxVQUFVLFNBQVMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUN2QyxTQUFPLE1BQU0sRUFBRSxPQUFPLEdBQUcsQ0FBQztBQUM1QixDQUFDO0FBRUQsS0FBSyw4REFBOEQsTUFBTTtBQUN2RSxRQUFNLElBQUksSUFBSSxXQUFXLENBQUM7QUFDMUIsV0FBUyxJQUFJLEdBQUcsS0FBSyxHQUFHLElBQUssR0FBRSxLQUFLLENBQUM7QUFDckMsU0FBTyxNQUFNLEVBQUUsUUFBUSxDQUFDO0FBQ3hCLFNBQU8sVUFBVSxTQUFTLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUM7QUFDdkMsU0FBTyxNQUFNLEVBQUUsT0FBTyxHQUFHLENBQUM7QUFDNUIsQ0FBQztBQUVELEtBQUsseURBQXlELE1BQU07QUFDbEUsUUFBTSxJQUFJLElBQUksV0FBVyxDQUFDO0FBQzFCLFNBQU8sR0FBRyxPQUFPLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQztBQUNsQyxTQUFPLEdBQUcsT0FBTyxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUMvQixJQUFFLEtBQUssQ0FBQztBQUNSLFNBQU8sR0FBRyxPQUFPLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0FBQ2hDLFNBQU8sR0FBRyxPQUFPLE1BQU0sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ2pDLENBQUM7QUFFRCxLQUFLLGdEQUFnRCxNQUFNO0FBQ3pELFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQztBQUMxQixJQUFFLEtBQUssQ0FBQztBQUNSLElBQUUsS0FBSyxDQUFDO0FBQ1IsSUFBRSxNQUFNO0FBQ1IsU0FBTyxNQUFNLEVBQUUsUUFBUSxDQUFDO0FBQ3hCLFNBQU8sTUFBTSxFQUFFLFVBQVUsQ0FBQztBQUMxQixJQUFFLEtBQUssQ0FBQztBQUNSLFNBQU8sVUFBVSxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUNuQyxDQUFDO0FBRUQsS0FBSywyREFBMkQsTUFBTTtBQUNwRSxRQUFNLElBQUksSUFBSSxXQUFXLENBQUM7QUFDMUIsV0FBUyxJQUFJLEdBQUcsS0FBSyxHQUFHLElBQUssR0FBRSxLQUFLLENBQUM7QUFDckMsSUFBRSxZQUFZLENBQUM7QUFDZixTQUFPLE1BQU0sRUFBRSxVQUFVLENBQUM7QUFDMUIsU0FBTyxVQUFVLFNBQVMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUN2QyxJQUFFLEtBQUssQ0FBQztBQUNSLFNBQU8sVUFBVSxTQUFTLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUM7QUFDekMsQ0FBQztBQUVELEtBQUsscUVBQXFFLE1BQU07QUFDOUUsUUFBTSxJQUFJLElBQUksV0FBVyxDQUFDO0FBQzFCLFdBQVMsSUFBSSxHQUFHLEtBQUssR0FBRyxJQUFLLEdBQUUsS0FBSyxDQUFDO0FBQ3JDLElBQUUsWUFBWSxDQUFDO0FBQ2YsU0FBTyxVQUFVLFNBQVMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUN2QyxJQUFFLEtBQUssQ0FBQztBQUNSLElBQUUsS0FBSyxDQUFDO0FBQ1IsSUFBRSxLQUFLLENBQUM7QUFDUixTQUFPLFVBQVUsU0FBUyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ2hELElBQUUsS0FBSyxDQUFDO0FBQ1IsU0FBTyxVQUFVLFNBQVMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUNsRCxDQUFDO0FBRUQsS0FBSyx5REFBeUQsTUFBTTtBQUNsRSxRQUFNLElBQUksSUFBSSxXQUFXLENBQUM7QUFDMUIsSUFBRSxLQUFLLENBQUM7QUFDUixJQUFFLEtBQUssQ0FBQztBQUNSLElBQUUsWUFBWSxDQUFDO0FBQ2YsU0FBTyxNQUFNLEVBQUUsVUFBVSxDQUFDO0FBQzFCLFNBQU8sVUFBVSxTQUFTLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3RDLENBQUM7QUFFRCxLQUFLLGlFQUFpRSxNQUFNO0FBQzFFLFNBQU8sTUFBTSxJQUFJLFdBQVcsQ0FBQyxFQUFFLFVBQVUsQ0FBQztBQUMxQyxTQUFPLE1BQU0sSUFBSSxXQUFXLEdBQUcsRUFBRSxVQUFVLENBQUM7QUFDNUMsUUFBTSxJQUFJLElBQUksV0FBVyxDQUFDO0FBQzFCLElBQUUsS0FBSyxDQUFDO0FBQ1IsSUFBRSxLQUFLLENBQUM7QUFDUixTQUFPLFVBQVUsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFDbkMsQ0FBQztBQUVELEtBQUssc0NBQXNDLE1BQU07QUFDL0MsUUFBTSxJQUFJLElBQUksV0FBVyxDQUFDO0FBQzFCLElBQUUsS0FBSyxHQUFHO0FBQ1YsU0FBTyxNQUFNLEVBQUUsR0FBRyxDQUFDLEdBQUcsS0FBSyxPQUFPLEdBQUcsQ0FBQztBQUN4QyxDQUFDO0FBSUQsS0FBSywwRUFBMEUsTUFBTTtBQUNuRixRQUFNLElBQUksSUFBSSxXQUFXLENBQUM7QUFDMUIsSUFBRSxLQUFLLENBQUM7QUFDUixJQUFFLEtBQUssQ0FBQztBQUNSLElBQUUsS0FBSyxDQUFDO0FBQ1IsUUFBTSxNQUFNLFdBQVc7QUFDdkIsUUFBTSxNQUFNLGFBQWEsR0FBRyxHQUFHO0FBQy9CLFNBQU8sTUFBTSxLQUFLLEdBQUc7QUFDckIsU0FBTyxNQUFNLElBQUksU0FBUyxDQUFDO0FBQzNCLFNBQU8sTUFBTSxJQUFJLEtBQUssQ0FBQztBQUN2QixTQUFPLE1BQU0sSUFBSSxLQUFLLENBQUM7QUFDdkIsU0FBTyxNQUFNLElBQUksS0FBSyxDQUFDO0FBQ3pCLENBQUM7QUFFRCxLQUFLLHdEQUF3RCxNQUFNO0FBQ2pFLFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQztBQUMxQixXQUFTLElBQUksR0FBRyxLQUFLLEdBQUcsSUFBSyxHQUFFLEtBQUssQ0FBQztBQUNyQyxRQUFNLE1BQU0sYUFBYSxHQUFHLFdBQVcsQ0FBQztBQUN4QyxTQUFPLE1BQU0sSUFBSSxTQUFTLENBQUM7QUFDM0IsU0FBTyxNQUFNLElBQUksS0FBSyxDQUFDO0FBQ3ZCLFNBQU8sTUFBTSxJQUFJLEtBQUssQ0FBQztBQUN2QixTQUFPLE1BQU0sSUFBSSxLQUFLLENBQUM7QUFDekIsQ0FBQztBQUVELEtBQUssMkNBQTJDLE1BQU07QUFDcEQsUUFBTSxNQUFNLGFBQWEsSUFBSSxXQUFXLENBQUMsR0FBRyxXQUFXLENBQUM7QUFDeEQsU0FBTyxHQUFHLE9BQU8sTUFBTSxJQUFJLE9BQU8sQ0FBQztBQUNuQyxTQUFPLEdBQUcsT0FBTyxNQUFNLElBQUksR0FBRyxDQUFDO0FBQy9CLFNBQU8sR0FBRyxPQUFPLE1BQU0sSUFBSSxHQUFHLENBQUM7QUFDL0IsU0FBTyxHQUFHLE9BQU8sTUFBTSxJQUFJLEdBQUcsQ0FBQztBQUNqQyxDQUFDO0FBRUQsS0FBSyx5REFBeUQsTUFBTTtBQUNsRSxRQUFNLElBQUksSUFBSSxXQUFXLENBQUM7QUFDMUIsSUFBRSxLQUFLLENBQUM7QUFDUixJQUFFLEtBQUssR0FBRztBQUNWLElBQUUsS0FBSyxDQUFDO0FBQ1IsUUFBTSxNQUFNLGFBQWEsR0FBRyxXQUFXLENBQUM7QUFDeEMsU0FBTyxNQUFNLElBQUksU0FBUyxDQUFDO0FBQzNCLFNBQU8sTUFBTSxJQUFJLEtBQUssQ0FBQztBQUN2QixTQUFPLE1BQU0sSUFBSSxLQUFLLENBQUM7QUFDdkIsU0FBTyxNQUFNLElBQUksS0FBSyxDQUFDO0FBQ3pCLENBQUM7QUFJRCxLQUFLLDZDQUEwQyxNQUFNO0FBQ25ELFNBQU8sVUFBVSxVQUFVLEdBQUcsSUFBSSxFQUFFLEtBQUssSUFBSSxDQUFDLEdBQUcsRUFBRSxLQUFLLElBQUksS0FBSyxHQUFHLENBQUM7QUFDdkUsQ0FBQztBQUVELEtBQUssbUVBQW1FLE1BQU07QUFDNUUsUUFBTSxJQUFJLFVBQVUsS0FBSyxHQUFHO0FBQzVCLFNBQU8sR0FBRyxPQUFPLFNBQVMsRUFBRSxHQUFHLEtBQUssT0FBTyxTQUFTLEVBQUUsR0FBRyxDQUFDO0FBQzFELFNBQU8sR0FBRyxFQUFFLE1BQU0sRUFBRSxHQUFHO0FBQ3pCLENBQUM7QUFFRCxLQUFLLG1FQUFtRSxNQUFNO0FBQzVFLGFBQVcsS0FBSyxDQUFDLEdBQUcsR0FBRyxLQUFLLEdBQUc7QUFDN0IsVUFBTSxJQUFJLFVBQVUsR0FBRyxDQUFDO0FBQ3hCLFdBQU8sR0FBRyxFQUFFLE1BQU0sRUFBRSxLQUFLLGlCQUFpQixDQUFDLEVBQUU7QUFDN0MsV0FBTyxHQUFHLEVBQUUsTUFBTSxLQUFLLElBQUksRUFBRSxLQUFLLFlBQVksQ0FBQyxFQUFFO0FBQUEsRUFDbkQ7QUFDRixDQUFDO0FBRUQsS0FBSyxzREFBc0QsTUFBTTtBQUMvRCxRQUFNLElBQUksVUFBVSxHQUFHLElBQUksRUFBRSxVQUFVLEdBQUcsS0FBSyxJQUFJLENBQUM7QUFDcEQsU0FBTyxNQUFNLEVBQUUsS0FBSyxDQUFDO0FBQ3JCLFNBQU8sTUFBTSxFQUFFLEtBQUssRUFBRTtBQUN0QixRQUFNLE9BQU8sVUFBVSxHQUFHLEtBQUssRUFBRSxVQUFVLEdBQUcsVUFBVSxFQUFFLENBQUM7QUFDM0QsU0FBTyxVQUFVLE1BQU0sRUFBRSxLQUFLLEdBQUcsS0FBSyxFQUFFLENBQUM7QUFDM0MsQ0FBQztBQUVELEtBQUssbUVBQW1FLE1BQU07QUFDNUUsUUFBTSxJQUFJLFVBQVUsR0FBRyxJQUFJLEVBQUUsYUFBYSxNQUFNLEtBQUssSUFBSSxDQUFDO0FBQzFELFNBQU8sTUFBTSxFQUFFLEtBQUssQ0FBQztBQUNyQixTQUFPLE1BQU0sRUFBRSxLQUFLLEVBQUU7QUFDeEIsQ0FBQztBQUVELEtBQUssNENBQTRDLE1BQU07QUFDckQsU0FBTyxVQUFVLFVBQVUsSUFBSSxHQUFHLEVBQUUsS0FBSyxJQUFJLENBQUMsR0FBRyxVQUFVLEdBQUcsSUFBSSxFQUFFLEtBQUssSUFBSSxDQUFDLENBQUM7QUFDakYsQ0FBQztBQUlELEtBQUssc0VBQXNFLE1BQU07QUFDL0UsU0FBTyxNQUFNLFNBQVMsSUFBSSxDQUFDLEdBQUcsQ0FBQztBQUMvQixTQUFPLE1BQU0sU0FBUyxJQUFJLENBQUMsR0FBRyxDQUFDO0FBQy9CLFNBQU8sTUFBTSxTQUFTLElBQUksRUFBRSxHQUFHLENBQUM7QUFDaEMsU0FBTyxNQUFNLFNBQVMsR0FBRyxFQUFFLEdBQUcsR0FBRztBQUNqQyxTQUFPLE1BQU0sU0FBUyxLQUFLLENBQUMsR0FBRyxFQUFFO0FBQ2pDLFNBQU8sTUFBTSxTQUFTLE1BQU0sQ0FBQyxHQUFHLElBQUk7QUFDdEMsQ0FBQztBQUVELEtBQUssMEJBQTBCLE1BQU07QUFDbkMsU0FBTyxVQUFVLFVBQVUsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFDekQsU0FBTyxVQUFVLFVBQVUsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFDaEQsU0FBTyxVQUFVLFVBQVUsTUFBTSxNQUFNLENBQUMsR0FBRyxDQUFDLElBQUksSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUM3RCxDQUFDO0FBRUQsS0FBSyw2RUFBNkUsTUFBTTtBQUN0RixRQUFNLFFBQW9DO0FBQUEsSUFDeEMsQ0FBQyxNQUFNLEtBQUssQ0FBQztBQUFBLElBQ2IsQ0FBQyxNQUFNLE1BQU0sQ0FBQztBQUFBLElBQ2QsQ0FBQyxNQUFNLE1BQU0sQ0FBQztBQUFBLElBQ2QsQ0FBQyxHQUFHLEtBQU0sQ0FBQztBQUFBLElBQ1gsQ0FBQyxNQUFNLEtBQUssQ0FBQztBQUFBLEVBQ2Y7QUFDQSxhQUFXLENBQUMsSUFBSSxJQUFJLEdBQUcsS0FBSyxPQUFPO0FBQ2pDLFVBQU0sUUFBUSxVQUFVLElBQUksSUFBSSxHQUFHO0FBQ25DLFdBQU8sR0FBRyxNQUFNLFVBQVUsR0FBRyxrQkFBa0IsRUFBRSxLQUFLLEVBQUUsR0FBRztBQUMzRCxXQUFPLEdBQUcsTUFBTSxVQUFVLE1BQU0sR0FBRyxTQUFTLE1BQU0sTUFBTSxPQUFPLE1BQU0sQ0FBQyxFQUFFO0FBQ3hFLFVBQU0sT0FBTyxTQUFTLEtBQUssSUFBSSxHQUFHO0FBQ2xDLFVBQU0sV0FBVyxPQUFPLEtBQUssSUFBSSxJQUFJLEtBQUssTUFBTSxLQUFLLE1BQU0sSUFBSSxDQUFDLENBQUM7QUFDakUsV0FBTztBQUFBLE1BQ0wsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLEtBQUssQ0FBQyxNQUFNLEtBQUssSUFBSSxXQUFXLENBQUMsSUFBSSxJQUFJO0FBQUEsTUFDbkQsUUFBUSxJQUFJO0FBQUEsSUFDZDtBQUNBLGVBQVcsUUFBUSxPQUFPO0FBQ3hCLGFBQU8sR0FBRyxRQUFRLEtBQUssUUFBUSxRQUFRLEtBQUssTUFBTSxHQUFHLElBQUksUUFBUSxFQUFFLEtBQUssRUFBRSxHQUFHO0FBQzdFLFlBQU0sSUFBSSxPQUFPO0FBQ2pCLGFBQU8sR0FBRyxLQUFLLElBQUksSUFBSSxLQUFLLE1BQU0sQ0FBQyxDQUFDLElBQUksTUFBTSxHQUFHLElBQUkscUJBQXFCLElBQUksRUFBRTtBQUFBLElBQ2xGO0FBQUEsRUFDRjtBQUNGLENBQUM7QUFFRCxLQUFLLGtEQUFrRCxNQUFNO0FBQzNELFNBQU8sVUFBVSxVQUFVLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZDLFNBQU8sVUFBVSxVQUFVLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZDLFNBQU8sVUFBVSxVQUFVLEtBQUssR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQzNDLENBQUM7QUFJRCxLQUFLLDBEQUEwRCxNQUFNO0FBQ25FLFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQztBQUMxQixhQUFXLEtBQUssQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsRUFBRyxHQUFFLEtBQUssQ0FBQztBQUNsRCxRQUFNLEtBQUssSUFBSSxhQUFhLENBQUM7QUFDN0IsUUFBTSxLQUFLLElBQUksYUFBYSxDQUFDO0FBQzdCLFNBQU8sTUFBTSxVQUFVLEdBQUcsR0FBRyxJQUFJLEVBQUUsR0FBRyxDQUFDO0FBQ3ZDLFNBQU8sVUFBVSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ3RDLFNBQU8sVUFBVSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ3hDLENBQUM7QUFFRCxLQUFLLDJEQUEyRCxNQUFNO0FBQ3BFLFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQztBQUMxQixhQUFXLEtBQUssQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUUsRUFBRyxHQUFFLEtBQUssQ0FBQztBQUM5QyxRQUFNLEtBQUssSUFBSSxhQUFhLENBQUM7QUFDN0IsUUFBTSxLQUFLLElBQUksYUFBYSxDQUFDO0FBQzdCLFNBQU8sTUFBTSxVQUFVLEdBQUcsR0FBRyxJQUFJLEVBQUUsR0FBRyxDQUFDO0FBQ3ZDLFNBQU8sVUFBVSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUM7QUFDbEMsU0FBTyxVQUFVLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUNwQyxDQUFDO0FBRUQsS0FBSyw4RUFBOEUsTUFBTTtBQUN2RixRQUFNLElBQUksSUFBSSxXQUFXLENBQUM7QUFDMUIsYUFBVyxLQUFLLENBQUMsR0FBRyxHQUFHLENBQUMsRUFBRyxHQUFFLEtBQUssQ0FBQztBQUNuQyxRQUFNLEtBQUssSUFBSSxhQUFhLENBQUM7QUFDN0IsUUFBTSxLQUFLLElBQUksYUFBYSxDQUFDO0FBQzdCLFNBQU8sTUFBTSxVQUFVLEdBQUcsR0FBRyxJQUFJLEVBQUUsR0FBRyxDQUFDO0FBQ3ZDLFdBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLFFBQUksTUFBTSxLQUFLLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFDakMsYUFBTyxNQUFNLEdBQUcsQ0FBQyxHQUFHLElBQUksSUFBSSxDQUFDO0FBQzdCLGFBQU8sTUFBTSxHQUFHLENBQUMsR0FBRyxJQUFJLElBQUksQ0FBQztBQUFBLElBQy9CLE9BQU87QUFDTCxhQUFPLEdBQUcsT0FBTyxNQUFNLEdBQUcsQ0FBQyxDQUFDLEtBQUssT0FBTyxNQUFNLEdBQUcsQ0FBQyxDQUFDLEdBQUcsT0FBTyxDQUFDLFFBQVE7QUFBQSxJQUN4RTtBQUFBLEVBQ0Y7QUFDRixDQUFDO0FBRUQsS0FBSywwRkFBMEYsTUFBTTtBQUNuRyxRQUFNLFFBQVE7QUFDZCxRQUFNLE9BQU87QUFDYixRQUFNLElBQUksSUFBSSxXQUFXLEtBQUs7QUFDOUIsTUFBSSxPQUFPO0FBQ1gsUUFBTSxPQUFPLE1BQWM7QUFDekIsV0FBUSxPQUFPLGFBQWEsUUFBUztBQUNyQyxXQUFPLE9BQU87QUFBQSxFQUNoQjtBQUNBLFFBQU0sU0FBbUIsQ0FBQztBQUMxQixXQUFTLElBQUksR0FBRyxJQUFJLE9BQU8sS0FBSztBQUM5QixVQUFNLElBQUksS0FBSyxPQUFPLEtBQUssSUFBSSxLQUFLLEVBQUU7QUFDdEMsV0FBTyxLQUFLLENBQUM7QUFDYixNQUFFLEtBQUssQ0FBQztBQUFBLEVBQ1Y7QUFDQSxRQUFNLFNBQVMsSUFBSSxNQUFjLElBQUksRUFBRSxLQUFLLEdBQUc7QUFDL0MsUUFBTSxTQUFTLElBQUksTUFBYyxJQUFJLEVBQUUsS0FBSyxHQUFHO0FBQy9DLFdBQVMsSUFBSSxHQUFHLElBQUksT0FBTyxLQUFLO0FBQzlCLFVBQU0sSUFBSSxLQUFLLE1BQU8sSUFBSSxPQUFRLEtBQUs7QUFDdkMsUUFBSSxPQUFPLE1BQU0sT0FBTyxDQUFDLENBQUMsR0FBRztBQUMzQixhQUFPLENBQUMsSUFBSSxPQUFPLENBQUM7QUFDcEIsYUFBTyxDQUFDLElBQUksT0FBTyxDQUFDO0FBQUEsSUFDdEIsT0FBTztBQUNMLGFBQU8sQ0FBQyxJQUFJLEtBQUssSUFBSSxPQUFPLENBQUMsR0FBRyxPQUFPLENBQUMsQ0FBQztBQUN6QyxhQUFPLENBQUMsSUFBSSxLQUFLLElBQUksT0FBTyxDQUFDLEdBQUcsT0FBTyxDQUFDLENBQUM7QUFBQSxJQUMzQztBQUFBLEVBQ0Y7QUFDQSxRQUFNLEtBQUssSUFBSSxhQUFhLElBQUk7QUFDaEMsUUFBTSxLQUFLLElBQUksYUFBYSxJQUFJO0FBQ2hDLFNBQU8sTUFBTSxVQUFVLEdBQUcsTUFBTSxJQUFJLEVBQUUsR0FBRyxJQUFJO0FBQzdDLFdBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxLQUFLO0FBQzdCLFdBQU8sR0FBRyxPQUFPLEdBQUcsR0FBRyxDQUFDLEdBQUcsS0FBSyxPQUFPLE9BQU8sQ0FBQyxDQUFDLENBQUMsR0FBRyxXQUFXLENBQUMsRUFBRTtBQUNsRSxXQUFPLEdBQUcsT0FBTyxHQUFHLEdBQUcsQ0FBQyxHQUFHLEtBQUssT0FBTyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsV0FBVyxDQUFDLEVBQUU7QUFDbEUsV0FBTyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxHQUFHLHFCQUFxQixDQUFDLEVBQUU7QUFBQSxFQUNwRDtBQUNGLENBQUM7QUFFRCxLQUFLLCtFQUErRSxNQUFNO0FBQ3hGLFFBQU0sUUFBUSxJQUFJLFdBQVcsQ0FBQztBQUM5QixRQUFNLEtBQUssSUFBSSxhQUFhLENBQUM7QUFDN0IsUUFBTSxLQUFLLElBQUksYUFBYSxDQUFDO0FBQzdCLFNBQU8sTUFBTSxVQUFVLE9BQU8sR0FBRyxJQUFJLEVBQUUsR0FBRyxDQUFDO0FBQzNDLFNBQU8sR0FBRyxDQUFDLEdBQUcsRUFBRSxFQUFFLE1BQU0sT0FBTyxLQUFLLEtBQUssQ0FBQyxHQUFHLEVBQUUsRUFBRSxNQUFNLE9BQU8sS0FBSyxDQUFDO0FBRXBFLFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQztBQUMxQixXQUFTLElBQUksR0FBRyxLQUFLLEdBQUcsSUFBSyxHQUFFLEtBQUssQ0FBQztBQUNyQyxRQUFNLE1BQU0sSUFBSSxhQUFhLENBQUM7QUFDOUIsUUFBTSxNQUFNLElBQUksYUFBYSxDQUFDO0FBQzlCLFNBQU8sTUFBTSxVQUFVLEdBQUcsSUFBSSxLQUFLLEdBQUcsR0FBRyxDQUFDO0FBQzFDLFNBQU8sVUFBVSxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZDLFNBQU8sVUFBVSxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ3pDLENBQUM7QUFJRCxLQUFLLG9FQUFvRSxNQUFNO0FBQzdFLFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQztBQUMxQixhQUFXLEtBQUssQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsRUFBRyxHQUFFLEtBQUssQ0FBQztBQUNsRCxRQUFNLE1BQU0sSUFBSSxhQUFhLENBQUM7QUFDOUIsU0FBTyxNQUFNLFFBQVEsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDO0FBQ2xDLFNBQU8sVUFBVSxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBRTlDLFFBQU0sT0FBTyxJQUFJLGFBQWEsQ0FBQztBQUMvQixRQUFNLFFBQVEsSUFBSSxXQUFXLENBQUM7QUFDOUIsUUFBTSxLQUFLLEVBQUU7QUFDYixRQUFNLEtBQUssRUFBRTtBQUNiLFFBQU0sS0FBSyxFQUFFO0FBQ2IsU0FBTyxNQUFNLFFBQVEsT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDO0FBQ3ZDLFNBQU8sVUFBVSxNQUFNLEtBQUssS0FBSyxJQUFJLENBQUMsTUFBTyxPQUFPLE1BQU0sQ0FBQyxJQUFJLEtBQUssQ0FBRSxDQUFDLEdBQUcsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRSxDQUFDO0FBQ3BHLENBQUM7QUFFRCxLQUFLLG1EQUFtRCxNQUFNO0FBQzVELFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQztBQUMxQixJQUFFLEtBQUssQ0FBQztBQUNSLElBQUUsS0FBSyxHQUFHO0FBQ1YsSUFBRSxLQUFLLENBQUM7QUFDUixJQUFFLEtBQUssUUFBUTtBQUNmLFFBQU0sTUFBTSxJQUFJLGFBQWEsQ0FBQztBQUM5QixTQUFPLE1BQU0sUUFBUSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUM7QUFDbEMsU0FBTyxVQUFVLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUMxQyxDQUFDO0FBRUQsS0FBSyxtRUFBbUUsTUFBTTtBQUM1RSxRQUFNLE1BQU0sSUFBSSxhQUFhLENBQUM7QUFDOUIsTUFBSSxLQUFLLEVBQUU7QUFDWCxTQUFPLE1BQU0sUUFBUSxJQUFJLFdBQVcsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUM7QUFDbEQsU0FBTyxHQUFHLE1BQU0sS0FBSyxHQUFHLEVBQUUsTUFBTSxPQUFPLEtBQUssR0FBRyxtQ0FBbUM7QUFDbEYsU0FBTyxNQUFNLFFBQVEsSUFBSSxXQUFXLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDO0FBQ3BELENBQUM7QUFFRCxLQUFLLHNEQUFzRCxNQUFNO0FBQy9ELFFBQU0sSUFBSSxJQUFJLFdBQVcsRUFBRTtBQUMzQixXQUFTLElBQUksR0FBRyxJQUFJLElBQUksSUFBSyxHQUFFLEtBQUssQ0FBQztBQUNyQyxRQUFNLE9BQU8sSUFBSSxhQUFhLENBQUM7QUFDL0IsUUFBTSxLQUFLLElBQUksYUFBYSxDQUFDO0FBQzdCLFFBQU0sS0FBSyxJQUFJLGFBQWEsQ0FBQztBQUM3QixVQUFRLEdBQUcsR0FBRyxJQUFJO0FBQ2xCLFlBQVUsR0FBRyxHQUFHLElBQUksRUFBRTtBQUN0QixXQUFTLElBQUksR0FBRyxJQUFJLEdBQUcsS0FBSztBQUMxQixXQUFPLE1BQU0sS0FBSyxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsT0FBTyxDQUFDLCtDQUErQztBQUFBLEVBQ3RGO0FBQ0YsQ0FBQztBQUlELEtBQUsseUVBQXlFLE1BQU07QUFDbEYsUUFBTSxJQUFJLElBQUksV0FBVyxDQUFDLE9BQU8sTUFBTSxHQUFHLENBQUM7QUFDM0MsSUFBRSxLQUFLLEVBQUUsS0FBSyxHQUFHLE1BQU0sRUFBRSxDQUFDO0FBQzFCLElBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFDO0FBQ2pCLFNBQU8sTUFBTSxFQUFFLFFBQVEsQ0FBQztBQUN4QixTQUFPLE1BQU0sRUFBRSxPQUFPLENBQUM7QUFDdkIsU0FBTyxVQUFVLENBQUMsRUFBRSxHQUFHLEdBQUcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDakQsU0FBTyxVQUFVLENBQUMsRUFBRSxHQUFHLEdBQUcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDbkQsQ0FBQztBQUVELEtBQUsseUVBQXlFLE1BQU07QUFDbEYsUUFBTSxJQUFJLElBQUksV0FBVyxDQUFDLEtBQUssR0FBRyxHQUFHLENBQUM7QUFDdEMsSUFBRSxLQUFLLENBQUMsR0FBRyxHQUFHLENBQUM7QUFDZixTQUFPLFVBQVUsQ0FBQyxFQUFFLEdBQUcsR0FBRyxDQUFDLEdBQUcsRUFBRSxHQUFHLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNuRCxDQUFDO0FBRUQsS0FBSyxpREFBaUQsTUFBTTtBQUMxRCxRQUFNLElBQUksSUFBSSxXQUFXLENBQUMsR0FBRyxHQUFHLENBQUM7QUFDakMsSUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLENBQUM7QUFDZixTQUFPLEdBQUcsT0FBTyxNQUFNLEVBQUUsR0FBRyxHQUFHLENBQUMsQ0FBQyxHQUFHLGtCQUFrQjtBQUN0RCxTQUFPLEdBQUcsT0FBTyxNQUFNLEVBQUUsR0FBRyxHQUFHLENBQUMsQ0FBQyxHQUFHLGlCQUFpQjtBQUNyRCxTQUFPLE1BQU0sRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFTO0FBQ25DLENBQUM7QUFFRCxLQUFLLG1FQUFtRSxNQUFNO0FBQzVFLFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQyxLQUFLLEdBQUcsR0FBRyxDQUFDO0FBQ3RDLElBQUUsS0FBSyxFQUFFLEdBQUcsR0FBRyxHQUFHLEdBQUcsQ0FBQztBQUN0QixJQUFFLEtBQUssRUFBRSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUM7QUFDdEIsSUFBRSxLQUFLLEVBQUUsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDO0FBQ3RCLFNBQU8sTUFBTSxFQUFFLFFBQVEsQ0FBQztBQUN4QixTQUFPLFVBQVUsQ0FBQyxFQUFFLEdBQUcsR0FBRyxDQUFDLEdBQUcsRUFBRSxHQUFHLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUNsRCxJQUFFLFlBQVksQ0FBQztBQUNmLFNBQU8sTUFBTSxFQUFFLFVBQVUsQ0FBQztBQUMxQixTQUFPLE1BQU0sRUFBRSxRQUFRLEdBQUcsNkJBQTZCO0FBQ3pELENBQUM7QUFFRCxLQUFLLDBFQUEwRSxNQUFNO0FBQ25GLFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQyxLQUFLLEdBQUcsR0FBRyxDQUFDO0FBQ3RDLElBQUUsS0FBSyxFQUFFLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQztBQUNyQixJQUFFLEtBQUssRUFBRSxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFDckIsSUFBRSxRQUFRLENBQUMsS0FBSyxHQUFHLENBQUM7QUFDcEIsU0FBTyxVQUFVLEVBQUUsTUFBTSxDQUFDLEtBQUssR0FBRyxDQUFDO0FBQ25DLFNBQU8sTUFBTSxFQUFFLFFBQVEsR0FBRyx1REFBdUQ7QUFDakYsU0FBTyxVQUFVLENBQUMsRUFBRSxHQUFHLEdBQUcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcscUJBQXFCO0FBQ3hFLFNBQU8sVUFBVSxDQUFDLEVBQUUsR0FBRyxHQUFHLENBQUMsR0FBRyxFQUFFLEdBQUcsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLGVBQWU7QUFDbEUsSUFBRSxLQUFLLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDO0FBQ3JCLFNBQU8sVUFBVSxDQUFDLEVBQUUsR0FBRyxHQUFHLENBQUMsR0FBRyxFQUFFLEdBQUcsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ25ELENBQUM7QUFFRCxLQUFLLDZEQUE2RCxNQUFNO0FBQ3RFLFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQyxLQUFLLEdBQUcsR0FBRyxDQUFDO0FBQ3RDLElBQUUsS0FBSyxFQUFFLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQztBQUNyQixJQUFFLE1BQU07QUFDUixTQUFPLE1BQU0sRUFBRSxRQUFRLENBQUM7QUFDeEIsU0FBTyxVQUFVLEVBQUUsTUFBTSxDQUFDLEtBQUssR0FBRyxDQUFDO0FBQ3JDLENBQUM7QUFJRCxLQUFLLHdFQUF3RSxNQUFNO0FBQ2pGLFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQyxLQUFLLEtBQUssR0FBRyxHQUFHLENBQUM7QUFDM0MsSUFBRSxLQUFLLEVBQUUsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQztBQUMzQixTQUFPLE1BQU0sV0FBVyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUM7QUFDbkMsU0FBTyxNQUFNLFdBQVcsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDO0FBQ25DLFNBQU8sTUFBTSxXQUFXLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQztBQUNuQyxTQUFPLE1BQU0sYUFBYSxHQUFHLENBQUMsR0FBRyxDQUFDO0FBQ3BDLENBQUM7QUFFRCxLQUFLLDBFQUEwRSxNQUFNO0FBQ25GLFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQyxLQUFLLEdBQUcsR0FBRyxDQUFDO0FBRXRDLElBQUUsS0FBSyxDQUFDLEdBQUcsS0FBSyxHQUFHO0FBQ25CLElBQUUsS0FBSyxDQUFDLEdBQUcsS0FBSyxDQUFDO0FBQ2pCLFNBQU8sTUFBTSxXQUFXLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQztBQUNuQyxTQUFPLE1BQU0sYUFBYSxHQUFHLENBQUMsR0FBRyxDQUFDO0FBQ3BDLENBQUM7QUFFRCxLQUFLLCtEQUErRCxNQUFNO0FBQ3hFLFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQyxLQUFLLEdBQUcsR0FBRyxDQUFDO0FBQ3RDLFNBQU8sTUFBTSxXQUFXLENBQUMsR0FBRyxDQUFDO0FBQzdCLElBQUUsS0FBSyxFQUFFLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQztBQUNyQixJQUFFLEtBQUssRUFBRSxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUM7QUFDckIsSUFBRSxLQUFLLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDO0FBQ3JCLFNBQU8sTUFBTSxXQUFXLENBQUMsR0FBRyxDQUFDO0FBQy9CLENBQUM7QUFFRCxLQUFLLDZDQUE2QyxNQUFNO0FBQ3RELFFBQU0sSUFBSSxJQUFJLFdBQVcsQ0FBQyxHQUFHLENBQUM7QUFDOUIsU0FBTyxNQUFNLEVBQUUsT0FBTyxDQUFDO0FBQ3ZCLFNBQU8sTUFBTSxhQUFhLEdBQUcsQ0FBQyxHQUFHLENBQUM7QUFDbEMsU0FBTyxNQUFNLFdBQVcsQ0FBQyxHQUFHLENBQUM7QUFDL0IsQ0FBQztBQUlELEtBQUssc0JBQXNCLE1BQU07QUFDL0IsUUFBTSxRQUFvQztBQUFBLElBQ3hDLENBQUMsS0FBSyxNQUFNLFFBQUc7QUFBQSxJQUNmLENBQUMsVUFBVSxPQUFPLFFBQUc7QUFBQSxJQUNyQixDQUFDLFdBQVcsSUFBSSxRQUFHO0FBQUEsSUFDbkIsQ0FBQyxRQUFRLE1BQU0sT0FBTztBQUFBLElBQ3RCLENBQUMsS0FBSyxNQUFNLE9BQU87QUFBQSxJQUNuQixDQUFDLFFBQVEsTUFBTSxRQUFRO0FBQUEsSUFDdkIsQ0FBQyxJQUFJLE1BQU0sUUFBUTtBQUFBLElBQ25CLENBQUMsUUFBUSxNQUFNLFFBQVE7QUFBQSxJQUN2QixDQUFDLEdBQUcsTUFBTSxRQUFRO0FBQUEsSUFDbEIsQ0FBQyxTQUFTLE1BQU0sU0FBUztBQUFBO0FBQUEsSUFDekIsQ0FBQyxRQUFRLE1BQU0sUUFBUTtBQUFBLElBQ3ZCLENBQUMsTUFBTSxPQUFPLE9BQU87QUFBQSxJQUNyQixDQUFDLEtBQUssT0FBTyxNQUFNO0FBQUEsSUFDbkIsQ0FBQyxPQUFPLE1BQU0sUUFBUTtBQUFBLElBQ3RCLENBQUMsR0FBRyxLQUFLLE1BQU07QUFBQSxJQUNmLENBQUMsT0FBTyxJQUFJLE1BQU07QUFBQSxJQUNsQixDQUFDLE9BQU8sSUFBSSxLQUFLO0FBQUEsRUFDbkI7QUFDQSxhQUFXLENBQUMsR0FBRyxNQUFNLFFBQVEsS0FBSyxPQUFPO0FBQ3ZDLFdBQU8sTUFBTSxZQUFZLEdBQUcsSUFBSSxHQUFHLFVBQVUsZUFBZSxDQUFDLE1BQU0sSUFBSSxJQUFJO0FBQUEsRUFDN0U7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
