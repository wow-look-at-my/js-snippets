// Tests for the pure half of <bar-chart> (ui/bar-chart-math.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  barScale,
  cleanValue,
  ellipsize,
  formatCompact,
  formatShare,
  gutterWidth,
  hitTestBars,
  placeMarkers,
  rowTotal,
  rowY,
  scaleX,
  segmentRect,
  shareOf,
  stackRow,
  summarize,
  type BarRow,
  type BarRowLayout,
  type BarSeries,
} from './bar-chart-math.ts';

const SERIES: BarSeries[] = [{ key: 'a' }, { key: 'b' }, { key: 'c', muted: true }];

const row = (values: Record<string, number>, id = 'r'): BarRow => ({ id, label: id, values });

const near = (actual: number, expected: number, eps = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`);
};

// -- Values -----------------------------------------------------------------------

test('cleanValue: non-finite, negative and non-number values read as 0', () => {
  assert.equal(cleanValue(5), 5);
  assert.equal(cleanValue(0), 0);
  assert.equal(cleanValue(-3), 0);
  assert.equal(cleanValue(NaN), 0);
  assert.equal(cleanValue(Infinity), 0);
  assert.equal(cleanValue(-Infinity), 0);
  assert.equal(cleanValue(undefined), 0);
  assert.equal(cleanValue('7'), 0);
});

test('rowTotal: sums only the keys a series names, skipping bad values', () => {
  assert.equal(rowTotal(row({ a: 2, b: 3, c: 5 }), SERIES), 10);
  assert.equal(rowTotal(row({ a: 2, stray: 100 }), SERIES), 2);
  assert.equal(rowTotal(row({ a: NaN, b: -4, c: Infinity }), SERIES), 0);
  assert.equal(rowTotal(row({}), SERIES), 0);
});

// -- Scale ------------------------------------------------------------------------

test('barScale: auto max rounds the largest total up to the 1-2-5 step', () => {
  const s = barScale([3, 12, 7]);
  assert.equal(s.step, 5);
  assert.equal(s.max, 15);
  assert.deepEqual(s.ticks, [0, 5, 10, 15]);
});

test('barScale: a total already on the grid is the max as is', () => {
  const s = barScale([100]);
  assert.equal(s.max, 100);
  assert.deepEqual(s.ticks, [0, 20, 40, 60, 80, 100]);
});

test('barScale: decimal steps carry no float noise', () => {
  const s = barScale([0.7]);
  assert.equal(s.step, 0.2);
  assert.equal(s.max, 0.8);
  assert.deepEqual(s.ticks, [0, 0.2, 0.4, 0.6, 0.8]);
});

test('barScale: all-zero, empty and junk totals give a usable 0..1 axis', () => {
  for (const totals of [[0, 0], [], [NaN, -5]]) {
    const s = barScale(totals);
    assert.equal(s.max, 1);
    assert.ok(s.ticks.length >= 3);
    assert.equal(s.ticks[0], 0);
    assert.equal(s.ticks[s.ticks.length - 1], 1);
  }
});

test('barScale: a fixed max is kept exactly, with ticks only inside it', () => {
  const s = barScale([500], 7);
  assert.equal(s.max, 7);
  assert.equal(s.step, 2);
  assert.deepEqual(s.ticks, [0, 2, 4, 6]);
});

test('barScale: a fixed max that is null, 0, negative or not finite falls back to auto', () => {
  for (const fixed of [null, 0, -10, NaN, Infinity]) assert.equal(barScale([12], fixed).max, 15);
});

test('barScale: always between 3 and 6 ticks', () => {
  for (const total of [1, 7, 10, 11, 25, 51, 99, 101, 333, 999, 1001, 12345, 0.03]) {
    const n = barScale([total]).ticks.length;
    assert.ok(n >= 3 && n <= 6, `${total}: ${n} ticks`);
    const f = barScale([0], total).ticks.length;
    assert.ok(f >= 3 && f <= 6, `fixed ${total}: ${f} ticks`);
  }
});

test('scaleX: maps linearly and is 0 for a scale that is not above 0', () => {
  assert.equal(scaleX(5, 10, 200), 100);
  assert.equal(scaleX(5, 0, 200), 0);
});

// -- Stacking ---------------------------------------------------------------------

test('stackRow: segments follow series order and widths sum to the scaled total', () => {
  const r = stackRow(row({ c: 2, a: 5, b: 3 }), SERIES, 20, 400);
  assert.deepEqual(
    r.segments.map((s) => s.key),
    ['a', 'b', 'c'],
  );
  assert.equal(r.total, 10);
  near(r.segments.reduce((sum, s) => sum + s.width, 0), 200);
  assert.equal(r.segments[0].x, 0);
  near(r.segments[1].x, 100);
  near(r.segments[2].x, 160);
  assert.deepEqual(
    r.segments.map((s) => s.end),
    [false, false, true],
  );
  assert.equal(r.overflow, false);
});

test('stackRow: missing keys, negatives and non-finite values add no segment and no NaN', () => {
  const r = stackRow(row({ a: NaN, b: -2 }), SERIES, 10, 300);
  assert.equal(r.total, 0);
  assert.deepEqual(r.segments, []);
  const m = stackRow(row({ b: 4, c: Infinity }), SERIES, 10, 300);
  assert.equal(m.segments.length, 1);
  assert.equal(m.segments[0].key, 'b');
  assert.equal(m.segments[0].end, true);
  for (const seg of m.segments) assert.ok(Number.isFinite(seg.x) && Number.isFinite(seg.width));
});

test('stackRow: shares are of the row total', () => {
  const r = stackRow(row({ a: 1, b: 3 }), SERIES, 10, 100);
  assert.equal(r.segments[0].share, 0.25);
  assert.equal(r.segments[1].share, 0.75);
});

test('stackRow: a segment below 1px is still reported, and flagged', () => {
  const r = stackRow(row({ a: 1000, b: 1 }), SERIES, 1001, 200);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].tiny, false);
  assert.equal(r.segments[1].tiny, true);
  assert.ok(r.segments[1].width > 0 && r.segments[1].width < 1);
});

test('stackRow: a total past a fixed max is cut at the plot edge and flagged', () => {
  const r = stackRow(row({ a: 6, b: 6 }), SERIES, 10, 100);
  assert.equal(r.overflow, true);
  near(r.segments[0].width, 60);
  near(r.segments[1].x, 60);
  near(r.segments[1].width, 40);
  near(r.segments.reduce((sum, s) => sum + s.width, 0), 100);
  const beyond = stackRow(row({ a: 20, b: 5 }), SERIES, 10, 100);
  assert.equal(beyond.segments[1].x, 100);
  assert.equal(beyond.segments[1].width, 0);
});

test('stackRow: a scale of 0 or a negative plot width gives zero geometry, not NaN', () => {
  const r = stackRow(row({ a: 1 }), SERIES, 0, 100);
  assert.equal(r.segments[0].width, 0);
  assert.equal(r.overflow, false);
  const w = stackRow(row({ a: 1 }), SERIES, 10, -50);
  assert.equal(w.segments[0].width, 0);
});

test('segmentRect: inner segments give up the gap, the end keeps its width, and nothing goes below 1px', () => {
  const r = stackRow(row({ a: 5, b: 5 }), SERIES, 10, 100);
  assert.deepEqual(segmentRect(r.segments[0], 2), { x: 0, width: 48 });
  assert.deepEqual(segmentRect(r.segments[1], 2), { x: 50, width: 50 });
  const tiny = stackRow(row({ a: 0.01, b: 10 }), SERIES, 10, 100);
  assert.equal(segmentRect(tiny.segments[0], 2).width, 1);
});

// -- Markers ----------------------------------------------------------------------

test('placeMarkers: places on the scale and holds off-scale values at the edge', () => {
  const placed = placeMarkers(
    [
      { value: 5, label: 'mid' },
      { value: 0, label: 'zero' },
      { value: 10, label: 'end' },
      { value: 15, label: 'past' },
      { value: -1, label: 'below' },
      { value: NaN, label: 'junk' },
    ],
    10,
    200,
  );
  assert.deepEqual(
    placed.map((p) => [p.x, p.offScale]),
    [
      [100, false],
      [0, false],
      [200, false],
      [200, true],
      [0, true],
      [0, true],
    ],
  );
  assert.equal(placed[0].marker.label, 'mid');
});

// -- Hit-testing ------------------------------------------------------------------

const LAYOUT: BarRowLayout = { top: 10, rowHeight: 22, rowGap: 2, plotLeft: 100, plotWidth: 200 };

test('rowY: rows stack by height plus gap', () => {
  assert.equal(rowY(0, LAYOUT), 10);
  assert.equal(rowY(2, LAYOUT), 58);
});

test('hitTestBars: finds the row band and the segment under the point', () => {
  const rows = [stackRow(row({ a: 5, b: 5 }), SERIES, 10, 200), stackRow(row({ b: 2 }), SERIES, 10, 200)];
  assert.deepEqual(hitTestBars(150, 20, LAYOUT, rows), { rowIndex: 0, seriesKey: 'a' });
  assert.deepEqual(hitTestBars(250, 20, LAYOUT, rows), { rowIndex: 0, seriesKey: 'b' });
  assert.deepEqual(hitTestBars(150, 33, LAYOUT, rows), { rowIndex: 0, seriesKey: 'a' });
  assert.deepEqual(hitTestBars(110, 40, LAYOUT, rows), { rowIndex: 1, seriesKey: 'b' });
});

test('hitTestBars: the label gutter and the empty part of a row hit the row with no series', () => {
  const rows = [stackRow(row({ a: 2 }), SERIES, 10, 200)];
  assert.deepEqual(hitTestBars(20, 20, LAYOUT, rows), { rowIndex: 0, seriesKey: null });
  assert.deepEqual(hitTestBars(250, 20, LAYOUT, rows), { rowIndex: 0, seriesKey: null });
});

test('hitTestBars: above the first row, below the last row, and junk input miss', () => {
  const rows = [stackRow(row({ a: 2 }), SERIES, 10, 200)];
  assert.equal(hitTestBars(150, 5, LAYOUT, rows), null);
  assert.equal(hitTestBars(150, 34, LAYOUT, rows), null);
  assert.equal(hitTestBars(NaN, 20, LAYOUT, rows), null);
  assert.equal(hitTestBars(150, 20, LAYOUT, []), null);
  assert.equal(hitTestBars(150, 20, { ...LAYOUT, rowHeight: 0, rowGap: 0 }, rows), null);
});

test('hitTestBars: a tiny segment is hit over the 1px it is drawn with', () => {
  const rows = [stackRow(row({ a: 0.001, b: 10 }), SERIES, 10, 200)];
  assert.deepEqual(hitTestBars(100.5, 20, LAYOUT, rows), { rowIndex: 0, seriesKey: 'a' });
});

// -- Text -------------------------------------------------------------------------

test('formatCompact: plain numbers below 1000, suffixes above', () => {
  const cases: [number, string][] = [
    [0, '0'],
    [7, '7'],
    [12.5, '12.5'],
    [0.125, '0.13'],
    [999, '999'],
    [1000, '1k'],
    [1234, '1.2k'],
    [9999, '10k'],
    [12_345, '12k'],
    [999_499, '999k'],
    [999_999, '1M'],
    [2_500_000, '2.5M'],
    [3e9, '3B'],
    [4.2e12, '4.2T'],
    [5e15, '5000T'],
    [-1500, '-1.5k'],
    [-0.001, '0'],
    [999.999, '1k'],
    [NaN, '—'],
    [Infinity, '—'],
  ];
  for (const [v, s] of cases) assert.equal(formatCompact(v), s, `formatCompact(${v})`);
});

test('shareOf and formatShare: edges never read as 0% or 100% when they are not', () => {
  assert.equal(shareOf(1, 4), 0.25);
  assert.equal(shareOf(1, 0), 0);
  assert.equal(shareOf(NaN, 4), 0);
  assert.equal(shareOf(5, 4), 1);
  assert.equal(formatShare(0), '0%');
  assert.equal(formatShare(0.001), '<1%');
  assert.equal(formatShare(0.25), '25%');
  assert.equal(formatShare(0.995), '>99%');
  assert.equal(formatShare(1), '100%');
  assert.equal(formatShare(NaN), '0%');
});

test('ellipsize: cuts at the width and ends with an ellipsis', () => {
  const measure = (s: string): number => s.length * 10;
  assert.equal(ellipsize('short', 100, measure), 'short');
  assert.equal(ellipsize('a much longer label', 60, measure), 'a muc…');
  assert.equal(ellipsize('abc', 5, measure), '');
  assert.equal(ellipsize('ab cd', 40, measure), 'ab…');
});

test('gutterWidth: the widest label plus padding, inside its bounds', () => {
  assert.equal(gutterWidth(1000, 80), 90);
  assert.equal(gutterWidth(1000, 5), 48);
  assert.equal(gutterWidth(400, 500), 140);
  assert.equal(gutterWidth(50, 500), 48);
});

test('summarize: names each row with its total', () => {
  assert.equal(summarize([], SERIES, formatCompact), 'Bar chart, no data');
  assert.equal(
    summarize([{ id: 'x', label: 'disk', values: { a: 1500, b: 500 } }], SERIES, formatCompact),
    'Bar chart, 1 row: disk 2k',
  );
});
