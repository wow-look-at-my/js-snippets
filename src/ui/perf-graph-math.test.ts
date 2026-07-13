// Tests for the pure math half of <perf-graph> (ui/perf-graph-math.ts):
// ring-buffer semantics, caller-owned stats, display-range + tick math, the
// min-max downsampler, and the value formatter. The element itself
// (ui/perf-graph.ts) is canvas/DOM-bound and not node-testable — see the
// Testing section in CLAUDE.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SampleRing,
  computeStats,
  autoRange,
  niceStep,
  niceTicks,
  binMinMax,
  formatValue,
  type PerfStats,
} from './perf-graph-math.ts';

const contents = (r: SampleRing): number[] => {
  const out: number[] = [];
  for (let i = 0; i < r.length; i++) out.push(r.at(i));
  return out;
};

const freshStats = (): PerfStats => ({ current: 0, avg: 0, min: 0, max: 0 });

// -- SampleRing ----------------------------------------------------------------

test('ring: push/length/at/latest before wrapping', () => {
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

test('ring: wraps, keeping exactly the newest `capacity` samples', () => {
  const r = new SampleRing(3);
  for (let v = 1; v <= 5; v++) r.push(v);
  assert.equal(r.length, 3);
  assert.deepEqual(contents(r), [3, 4, 5]);
  assert.equal(r.latest(), 5);
});

test('ring: at() out of range and latest() on empty are NaN', () => {
  const r = new SampleRing(3);
  assert.ok(Number.isNaN(r.latest()));
  assert.ok(Number.isNaN(r.at(0)));
  r.push(7);
  assert.ok(Number.isNaN(r.at(-1)));
  assert.ok(Number.isNaN(r.at(1)));
});

test('ring: clear() empties but keeps the capacity', () => {
  const r = new SampleRing(3);
  r.push(1);
  r.push(2);
  r.clear();
  assert.equal(r.length, 0);
  assert.equal(r.capacity, 3);
  r.push(9);
  assert.deepEqual(contents(r), [9]);
});

test('ring: setCapacity() shrink preserves the newest samples', () => {
  const r = new SampleRing(5);
  for (let v = 1; v <= 5; v++) r.push(v);
  r.setCapacity(3);
  assert.equal(r.capacity, 3);
  assert.deepEqual(contents(r), [3, 4, 5]);
  r.push(6); // overwrites the oldest kept sample
  assert.deepEqual(contents(r), [4, 5, 6]);
});

test('ring: setCapacity() grow preserves order across an old wrap point', () => {
  const r = new SampleRing(3);
  for (let v = 1; v <= 5; v++) r.push(v); // holds [3, 4, 5], wrapped
  r.setCapacity(6);
  assert.deepEqual(contents(r), [3, 4, 5]);
  r.push(6);
  r.push(7);
  r.push(8);
  assert.deepEqual(contents(r), [3, 4, 5, 6, 7, 8]);
  r.push(9);
  assert.deepEqual(contents(r), [4, 5, 6, 7, 8, 9]);
});

test('ring: setCapacity() with the same capacity is a no-op', () => {
  const r = new SampleRing(3);
  r.push(1);
  r.push(2);
  r.setCapacity(3);
  assert.equal(r.capacity, 3);
  assert.deepEqual(contents(r), [1, 2]);
});

test('ring: capacity is clamped to >= 1 and a capacity-1 ring works', () => {
  assert.equal(new SampleRing(0).capacity, 1);
  assert.equal(new SampleRing(NaN).capacity, 1);
  const r = new SampleRing(1);
  r.push(1);
  r.push(2);
  assert.deepEqual(contents(r), [2]);
});

test('ring: values are stored as float32', () => {
  const r = new SampleRing(2);
  r.push(0.1);
  assert.equal(r.at(0), Math.fround(0.1));
});

// -- computeStats ----------------------------------------------------------------

test('stats: current/avg/min/max over the ring, into the caller-owned object', () => {
  const r = new SampleRing(4);
  r.push(2);
  r.push(6);
  r.push(4);
  const out = freshStats();
  const ret = computeStats(r, out);
  assert.equal(ret, out); // out-param contract: fills and returns the same object
  assert.equal(out.current, 4);
  assert.equal(out.avg, 4);
  assert.equal(out.min, 2);
  assert.equal(out.max, 6);
});

test('stats: reflect only the retained window after a wrap', () => {
  const r = new SampleRing(3);
  for (let v = 1; v <= 5; v++) r.push(v); // [3, 4, 5]
  const out = computeStats(r, freshStats());
  assert.equal(out.current, 5);
  assert.equal(out.avg, 4);
  assert.equal(out.min, 3);
  assert.equal(out.max, 5);
});

test('stats: empty ring yields all-NaN fields', () => {
  const out = computeStats(new SampleRing(4), freshStats());
  assert.ok(Number.isNaN(out.current));
  assert.ok(Number.isNaN(out.avg));
  assert.ok(Number.isNaN(out.min));
  assert.ok(Number.isNaN(out.max));
});

test('stats: non-finite samples are skipped for avg/min/max', () => {
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

// -- autoRange ----------------------------------------------------------------

test('autoRange: pads each end by pad × span', () => {
  assert.deepEqual(autoRange(0, 10, { pad: 0.1 }), { min: -1, max: 11 });
});

test('autoRange: empty (non-finite) data yields a usable nonzero span', () => {
  const r = autoRange(NaN, NaN);
  assert.ok(Number.isFinite(r.min) && Number.isFinite(r.max));
  assert.ok(r.max > r.min);
});

test('autoRange: flat data yields a nonzero span containing the value', () => {
  for (const v of [5, 0, -16.7]) {
    const r = autoRange(v, v);
    assert.ok(r.max > r.min, `span for flat ${v}`);
    assert.ok(r.min < v && v < r.max, `contains ${v}`);
  }
});

test('autoRange: fixedMin/fixedMax pin their end exactly', () => {
  const r = autoRange(0, 10, { fixedMin: 0, pad: 0.1 });
  assert.equal(r.min, 0);
  assert.equal(r.max, 11);
  const both = autoRange(0, 100, { fixedMin: 2, fixedMax: 4 });
  assert.deepEqual(both, { min: 2, max: 4 });
});

test('autoRange: includeZero extends to zero without padding below it', () => {
  const r = autoRange(5, 10, { includeZero: true, pad: 0.1 });
  assert.equal(r.min, 0);
  assert.equal(r.max, 11); // span became 10 once zero was included
});

test('autoRange: swapped inputs are normalized', () => {
  assert.deepEqual(autoRange(10, 0, { pad: 0.1 }), autoRange(0, 10, { pad: 0.1 }));
});

// -- niceStep / niceTicks ----------------------------------------------------------

test('niceStep: picks the smallest 1-2-5 step fitting maxTicks intervals', () => {
  assert.equal(niceStep(10, 5), 2);
  assert.equal(niceStep(10, 4), 5); // 2 gives 5 intervals, so bump to 5
  assert.equal(niceStep(10, 10), 1);
  assert.equal(niceStep(1, 10), 0.1);
  assert.equal(niceStep(100, 5), 20);
  assert.equal(niceStep(0.05, 5), 0.01);
});

test('niceTicks: known grids', () => {
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(0, 10, 3), [0, 5, 10]);
  assert.deepEqual(niceTicks(14.2, 33.8, 4), [15, 20, 25, 30]);
});

test('niceTicks: ticks lie in [lo, hi], on the 1-2-5 grid, at most maxTicks + 1', () => {
  const cases: [number, number, number][] = [
    [-3.3, 2.1, 5],
    [0.02, 0.09, 4],
    [16.4, 16.9, 3],
    [0, 1000, 2],
    [-250, -30, 4],
  ];
  for (const [lo, hi, max] of cases) {
    const ticks = niceTicks(lo, hi, max);
    assert.ok(ticks.length >= 1, `has ticks for [${lo}, ${hi}]`);
    assert.ok(ticks.length <= max + 1, `count ${ticks.length} <= ${max + 1}`);
    const step = niceStep(hi - lo, max);
    const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
    assert.ok(
      [1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-9),
      `step ${step} is 1-2-5`,
    );
    for (const tick of ticks) {
      assert.ok(tick >= lo - 1e-9 && tick <= hi + 1e-9, `${tick} in [${lo}, ${hi}]`);
      const k = tick / step;
      assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `${tick} is a multiple of ${step}`);
    }
  }
});

test('niceTicks: empty/invalid ranges yield no ticks', () => {
  assert.deepEqual(niceTicks(5, 5, 3), []);
  assert.deepEqual(niceTicks(3, 1, 3), []);
  assert.deepEqual(niceTicks(NaN, 1, 3), []);
});

// -- binMinMax ----------------------------------------------------------------

test('binMinMax: exact bins when count is a multiple of bins', () => {
  const r = new SampleRing(8);
  for (const v of [0, 1, 2, 3, 4, 5, 6, 7]) r.push(v);
  const mn = new Float32Array(4);
  const mx = new Float32Array(4);
  assert.equal(binMinMax(r, 4, mn, mx), 4);
  assert.deepEqual([...mn], [0, 2, 4, 6]);
  assert.deepEqual([...mx], [1, 3, 5, 7]);
});

test('binMinMax: uneven split follows floor(i * bins / count)', () => {
  const r = new SampleRing(5);
  for (const v of [10, 20, 30, 40, 50]) r.push(v);
  const mn = new Float32Array(2);
  const mx = new Float32Array(2);
  assert.equal(binMinMax(r, 2, mn, mx), 2);
  assert.deepEqual([...mn], [10, 40]); // i = 0..2 → bin 0, i = 3..4 → bin 1
  assert.deepEqual([...mx], [30, 50]);
});

test('binMinMax: fewer samples than bins leaves NaN gaps at the mapped positions', () => {
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

test('binMinMax: matches a JS mirror on pseudorandom data (every sample counted, min <= max)', () => {
  const count = 200;
  const bins = 33;
  const r = new SampleRing(count);
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = Math.fround(rand() * 40 - 10); // fround: the ring stores f32
    values.push(v);
    r.push(v);
  }
  const expMin = new Array<number>(bins).fill(NaN);
  const expMax = new Array<number>(bins).fill(NaN);
  for (let i = 0; i < count; i++) {
    const b = Math.floor((i * bins) / count);
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
  assert.equal(binMinMax(r, bins, mn, mx), bins); // count > bins → every bin non-empty
  for (let b = 0; b < bins; b++) {
    assert.ok(Object.is(mn[b], Math.fround(expMin[b])), `min bin ${b}`);
    assert.ok(Object.is(mx[b], Math.fround(expMax[b])), `max bin ${b}`);
    assert.ok(mn[b] <= mx[b], `min <= max in bin ${b}`);
  }
});

test('binMinMax: empty ring fills NaN and reports 0; bins clamp to the out arrays', () => {
  const empty = new SampleRing(4);
  const mn = new Float32Array(3);
  const mx = new Float32Array(3);
  assert.equal(binMinMax(empty, 3, mn, mx), 0);
  assert.ok([...mn].every(Number.isNaN) && [...mx].every(Number.isNaN));

  const r = new SampleRing(8);
  for (let v = 1; v <= 8; v++) r.push(v);
  const mn4 = new Float32Array(4);
  const mx4 = new Float32Array(4);
  assert.equal(binMinMax(r, 10, mn4, mx4), 4); // clamped to the arrays' length
  assert.deepEqual([...mn4], [1, 3, 5, 7]);
  assert.deepEqual([...mx4], [2, 4, 6, 8]);
});

// -- formatValue ----------------------------------------------------------------

test('formatValue: table', () => {
  const cases: [number, string, string][] = [
    [NaN, 'ms', '—'],
    [Infinity, 'fps', '—'],
    [-Infinity, '', '—'],
    [123.46, 'ms', '123ms'],
    [100, 'ms', '100ms'],
    [16.666, 'ms', '16.7ms'],
    [10, 'ms', '10.0ms'],
    [5.4321, 'ms', '5.43ms'],
    [0, 'ms', '0.00ms'],
    [-5.4321, 'ms', '-5.43ms'], // decimals follow |v|
    [-123.4, 'ms', '-123ms'],
    [59.6, 'fps', '60fps'],
    [0.4, 'fps', '0fps'],
    [42.34, 'MB', '42.3MB'],
    [7, '%', '7.0%'],
    [7.891, '', '7.89'],
    [123.9, '', '124'],
  ];
  for (const [v, unit, expected] of cases) {
    assert.equal(formatValue(v, unit), expected, `formatValue(${v}, '${unit}')`);
  }
});
