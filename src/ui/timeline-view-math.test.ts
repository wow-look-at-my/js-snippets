// Tests for the pure math half of <timeline-view> (ui/timeline-view-math.ts):
// scales + anchor-preserving zoom, wheel normalization + gesture routing,
// the follow-now engage/disengage rule (2-device-px re-engage at the hard
// `now` end stop), whole-device-pixel view snapping, the time tick ladder
// and label granularity, sub-track packing (whole-set and visible-window,
// incl. coincident instants), lane layout (incl. per-lane track heights),
// auto-fit compact-lane demotion (tallest-first order, hysteresis,
// stability under viewport translation), label fitting, instant-width
// thresholds (duration-based, translation-stable), hit testing, connector
// routing, category hue hashing, coverage / range-request bookkeeping
// (incl. the loadRange request-flood regression), and render-loop pacing.
// The element itself (ui/timeline-view.ts) is canvas/DOM-bound and not
// node-testable — see the Testing section in CLAUDE.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toMs,
  timeToX,
  xToTime,
  panView,
  zoomView,
  wheelDeltaToPixels,
  zoomFactorForWheel,
  ZOOM_PX_PER_DOUBLE,
  MIN_SPAN_MS,
  MAX_SPAN_MS,
  TIME_TICK_STEPS,
  timeTickStep,
  timeTicks,
  formatTimeTick,
  formatTimeFull,
  formatDuration,
  packTracks,
  PACK_MIN_MS,
  layoutLanes,
  trackTop,
  fitText,
  ELLIPSIS,
  INSTANT_THRESHOLD_PX,
  isInstantWidth,
  expandHitRect,
  hitTestRects,
  distSqToSegment,
  hitTestPolyline,
  connectorRoute,
  hashString,
  categoryHue,
  categoryJitter,
  categoryColor,
  DEFAULT_STYLES,
  mergeRanges,
  subtractRanges,
  CoverageTracker,
  historyProbe,
  routeWheel,
  followAfterGesture,
  FOLLOW_LEAD_FRAC,
  FOLLOW_SNAP_DEVICE_PX,
  clampViewToNow,
  snapViewToDevicePixels,
  durationWidthPx,
  MIN_BAR_PX,
  packVisibleTracks,
  laneHeight,
  demotionOrder,
  computeAutoFit,
  FIT_HYSTERESIS_FRAC,
  frameBudgetMs,
  shouldRender,
  IDLE_FRAME_MS,
  IDLE_BATTERY_FRAME_MS,
  type WheelInput,
  type TimeView,
  type PackItem,
  type HitRect,
  type TimeRange,
  type LaneMetrics,
} from './timeline-view-math.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;

// -- toMs / scale -----------------------------------------------------------------

test('toMs: numbers pass through, Dates convert', () => {
  assert.equal(toMs(1234), 1234);
  assert.equal(toMs(new Date(56789)), 56789);
});

test('timeToX/xToTime: endpoints, midpoint, and round-trip', () => {
  const view: TimeView = { start: 1000, end: 2000 };
  assert.equal(timeToX(1000, view, 500), 0);
  assert.equal(timeToX(2000, view, 500), 500);
  assert.equal(timeToX(1500, view, 500), 250);
  assert.equal(xToTime(250, view, 500), 1500);
  for (const x of [0, 17.5, 333, 500]) {
    assert.ok(Math.abs(timeToX(xToTime(x, view, 500), view, 500) - x) < 1e-9, `round-trip ${x}`);
  }
});

test('panView: shifts both ends, preserving the span', () => {
  const v = panView({ start: 100, end: 300 }, 50);
  assert.deepEqual(v, { start: 150, end: 350 });
});

// -- zoomView ----------------------------------------------------------------------

test('zoomView: the time under the cursor stays under the cursor', () => {
  const width = 800;
  let seed = 42;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 200; i++) {
    const start = rand() * 1e12;
    const span = MIN_SPAN_MS * 4 + rand() * (MAX_SPAN_MS / 4);
    const view: TimeView = { start, end: start + span };
    const x = rand() * width;
    const anchor = xToTime(x, view, width);
    const factor = Math.pow(2, rand() * 4 - 2); // 0.25x .. 4x
    const zoomed = zoomView(view, anchor, factor);
    const xAfter = timeToX(anchor, zoomed, width);
    assert.ok(Math.abs(xAfter - x) < 1e-6 * width, `anchor pixel moved: ${x} -> ${xAfter}`);
  }
});

test('zoomView: factor > 1 shrinks the span by exactly that factor', () => {
  const view: TimeView = { start: 0, end: 100_000 };
  const z = zoomView(view, 50_000, 2);
  assert.ok(Math.abs(z.end - z.start - 50_000) < 1e-9);
});

test('zoomView: span clamps to [MIN_SPAN_MS, MAX_SPAN_MS] and keeps the anchor fraction', () => {
  const tiny = zoomView({ start: 0, end: MIN_SPAN_MS * 2 }, MIN_SPAN_MS, 1e9);
  assert.equal(tiny.end - tiny.start, MIN_SPAN_MS);
  // anchor was at fraction 0.5 → still at 0.5
  assert.ok(Math.abs((MIN_SPAN_MS - tiny.start) / (tiny.end - tiny.start) - 0.5) < 1e-9);

  const huge = zoomView({ start: 0, end: DAY }, DAY / 4, 1e-9);
  assert.equal(huge.end - huge.start, MAX_SPAN_MS);
  assert.ok(Math.abs((DAY / 4 - huge.start) / MAX_SPAN_MS - 0.25) < 1e-9);
});

test('zoomView: degenerate factors are ignored', () => {
  const view: TimeView = { start: 0, end: 10_000 };
  assert.deepEqual(zoomView(view, 5_000, NaN), view);
  assert.deepEqual(zoomView(view, 5_000, 0), view);
  assert.deepEqual(zoomView(view, 5_000, -2), view);
});

// -- Wheel normalization -----------------------------------------------------------

test('wheelDeltaToPixels: deltaMode 0 is 1:1, 1 is lines, 2 is pages', () => {
  assert.equal(wheelDeltaToPixels(7.5, 0), 7.5);
  assert.equal(wheelDeltaToPixels(-120, 0), -120);
  assert.equal(wheelDeltaToPixels(3, 1), 48); // 3 lines × 16px
  assert.equal(wheelDeltaToPixels(3, 1, 20), 60);
  assert.equal(wheelDeltaToPixels(1, 2), 800);
  assert.equal(wheelDeltaToPixels(-2, 2, 16, 500), -1000);
  assert.equal(wheelDeltaToPixels(NaN, 0), 0);
});

test('zoomFactorForWheel: exponential, composable, and doubling at the constant', () => {
  assert.equal(zoomFactorForWheel(0), 1);
  assert.equal(zoomFactorForWheel(-ZOOM_PX_PER_DOUBLE), 2); // scroll up = zoom in
  assert.equal(zoomFactorForWheel(ZOOM_PX_PER_DOUBLE), 0.5);
  const a = zoomFactorForWheel(-37) * zoomFactorForWheel(-63);
  const b = zoomFactorForWheel(-100);
  assert.ok(Math.abs(a - b) < 1e-12, 'factors compose: f(a)*f(b) == f(a+b)');
});

// -- Time ticks --------------------------------------------------------------------

test('timeTickStep: picks ladder steps across spans from seconds to days', () => {
  assert.equal(timeTickStep(2_000, 8), 500); // 2s span → 500ms ticks
  assert.equal(timeTickStep(60_000, 8), 10_000); // 1min → 10s
  assert.equal(timeTickStep(25 * 60_000, 8), 300_000); // 25min → 5min
  assert.equal(timeTickStep(6 * HOUR, 8), HOUR); // 6h → 1h
  assert.equal(timeTickStep(2 * DAY, 8), 6 * HOUR); // 2d → 6h
  assert.equal(timeTickStep(7 * DAY, 8), DAY); // 7d → 1d
  assert.equal(timeTickStep(1e12, 8), TIME_TICK_STEPS[TIME_TICK_STEPS.length - 1]);
});

test('timeTicks: aligned to the step, within the view, at most maxTicks + 1', () => {
  for (const span of [2_000, 45_000, 25 * 60_000, 3 * HOUR, 5 * DAY]) {
    const view: TimeView = { start: 1_700_000_123_456, end: 1_700_000_123_456 + span };
    const ticks = timeTicks(view, 8);
    const step = timeTickStep(span, 8);
    assert.ok(ticks.length >= 1, `has ticks for span ${span}`);
    assert.ok(ticks.length <= 9, `count ${ticks.length} <= 9 for span ${span}`);
    for (const t of ticks) {
      assert.ok(t >= view.start && t <= view.end, `${t} inside view`);
      assert.equal(t % step, 0, `${t} on the ${step} grid`);
    }
  }
});

test('timeTicks: tzOffset aligns day ticks to local midnight', () => {
  const offset = -5 * HOUR; // UTC-5
  const view: TimeView = { start: 1_700_000_000_000, end: 1_700_000_000_000 + 4 * DAY };
  const ticks = timeTicks(view, 5, offset);
  assert.ok(ticks.length > 0);
  for (const t of ticks) {
    assert.equal((t + offset) % DAY, 0, `${t} is local midnight`);
  }
});

test('timeTicks: empty/invalid view yields no ticks', () => {
  assert.deepEqual(timeTicks({ start: 5, end: 5 }, 8), []);
  assert.deepEqual(timeTicks({ start: 9, end: 3 }, 8), []);
  assert.deepEqual(timeTicks({ start: NaN, end: 3 }, 8), []);
});

// -- Tick / time formatting ----------------------------------------------------------

// 2021-01-02 03:04:05.678 UTC
const T = Date.UTC(2021, 0, 2, 3, 4, 5, 678);

test('formatTimeTick: granularity follows the step', () => {
  assert.equal(formatTimeTick(T, 500), ':05.678');
  assert.equal(formatTimeTick(T, 5_000), '03:04:05');
  assert.equal(formatTimeTick(T, 60_000), '03:04');
  assert.equal(formatTimeTick(T, HOUR), '03:04');
  assert.equal(formatTimeTick(T, DAY), 'Jan 2');
});

test('formatTimeTick: a local-midnight tick labels as the date', () => {
  const midnight = Date.UTC(2021, 0, 2);
  assert.equal(formatTimeTick(midnight, HOUR), 'Jan 2');
  // …and respects the tz offset: 05:00 UTC == midnight at UTC-5.
  assert.equal(formatTimeTick(Date.UTC(2021, 0, 2, 5), HOUR, -5 * HOUR), 'Jan 2');
  assert.equal(formatTimeTick(Date.UTC(2021, 0, 2, 5), HOUR), '05:00');
});

test('formatTimeFull: date + time, optional ms', () => {
  assert.equal(formatTimeFull(T), 'Jan 2 03:04:05');
  assert.equal(formatTimeFull(T, 0, true), 'Jan 2 03:04:05.678');
  assert.equal(formatTimeFull(T, 3 * HOUR), 'Jan 2 06:04:05');
});

test('formatDuration: table', () => {
  const cases: [number, string][] = [
    [NaN, '—'],
    [-5, '—'],
    [0, '0ms'],
    [742, '742ms'],
    [1_000, '1.0s'],
    [12_340, '12.3s'],
    [83_000, '1m 23s'],
    [605_000, '10m 05s'],
    [2 * HOUR + 14 * 60_000, '2h 14m'],
    [3 * DAY + 4 * HOUR, '3d 4h'],
  ];
  for (const [ms, expected] of cases) {
    assert.equal(formatDuration(ms), expected, `formatDuration(${ms})`);
  }
});

// -- packTracks --------------------------------------------------------------------

const packOf = (items: PackItem[]): { tracks: number[]; trackCount: number } => packTracks(items);

test('pack: non-overlapping intervals share track 0', () => {
  const { tracks, trackCount } = packOf([
    { id: 'a', start: 0, end: 10 },
    { id: 'b', start: 10, end: 20 }, // touching: end == start reuses the track
    { id: 'c', start: 25, end: 30 },
  ]);
  assert.deepEqual(tracks, [0, 0, 0]);
  assert.equal(trackCount, 1);
});

test('pack: an overlap chain stacks first-fit', () => {
  const { tracks, trackCount } = packOf([
    { id: 'a', start: 0, end: 100 },
    { id: 'b', start: 10, end: 50 },
    { id: 'c', start: 20, end: 30 },
    { id: 'd', start: 60, end: 90 }, // b and c ended → reuses track 1
  ]);
  assert.deepEqual(tracks, [0, 1, 2, 1]);
  assert.equal(trackCount, 3);
});

test('pack: ongoing intervals (end null/undefined) block their track forever', () => {
  const { tracks, trackCount } = packOf([
    { id: 'a', start: 0, end: null },
    { id: 'b', start: 1_000_000 }, // far later, but a never ends
    { id: 'c', start: 2_000_000, end: 2_000_001 },
  ]);
  assert.deepEqual(tracks, [0, 1, 2]);
  assert.equal(trackCount, 3);
});

test('pack: deterministic under input re-ordering (results index-aligned)', () => {
  const items: PackItem[] = [
    { id: 'a', start: 0, end: 40 },
    { id: 'b', start: 10, end: 30 },
    { id: 'c', start: 35, end: 60 },
    { id: 'd', start: 50, end: null },
    { id: 'e', start: 55, end: 58 },
  ];
  const base = packOf(items);
  const byId = new Map(items.map((it, i) => [it.id, base.tracks[i]]));
  const shuffled = [items[3], items[0], items[4], items[2], items[1]];
  const re = packOf(shuffled);
  assert.equal(re.trackCount, base.trackCount);
  shuffled.forEach((it, i) => {
    assert.equal(re.tracks[i], byId.get(it.id), `track for ${it.id} stable under re-sort`);
  });
});

test('pack: equal starts tie-break by id, deterministically', () => {
  const a = packOf([
    { id: 'x', start: 5, end: 10 },
    { id: 'y', start: 5, end: 10 },
  ]);
  const b = packOf([
    { id: 'y', start: 5, end: 10 },
    { id: 'x', start: 5, end: 10 },
  ]);
  // 'x' sorts first → track 0 in both orderings.
  assert.deepEqual(a.tracks, [0, 1]);
  assert.deepEqual(b.tracks, [1, 0]);
});

test('pack: coincident zero-length instants get their own tracks (never vanish)', () => {
  const { tracks, trackCount } = packOf([
    { id: 'i1', start: 100, end: 100 },
    { id: 'i2', start: 100, end: 100 },
    { id: 'i3', start: 100, end: 100 },
  ]);
  assert.deepEqual([...tracks].sort(), [0, 1, 2]);
  assert.equal(trackCount, 3);
});

test('pack: an instant at a bar start does not share the bar track', () => {
  const { tracks } = packOf([
    { id: 'bar', start: 100, end: 500 },
    { id: 'pip', start: 100, end: 100 },
  ]);
  assert.notEqual(tracks[0], tracks[1]);
  // …but an instant at the bar END reuses it (bar released the track).
  const after = packOf([
    { id: 'bar', start: 100, end: 500 },
    { id: 'pip', start: 500, end: 500 },
  ]);
  assert.deepEqual(after.tracks, [0, 0]);
  assert.ok(PACK_MIN_MS >= 1);
});

test('pack: empty input yields one (empty) track', () => {
  assert.deepEqual(packOf([]), { tracks: [], trackCount: 1 });
});

// -- Lane layout --------------------------------------------------------------------

test('layoutLanes: heights grow with track count; tops stack; totals add up', () => {
  const m = { trackHeight: 16, trackGap: 2, lanePad: 4 };
  const { tops, heights, totalHeight } = layoutLanes([1, 3, 1], m);
  assert.deepEqual(heights, [24, 60, 24]); // 8 + n*16 + (n-1)*2
  assert.deepEqual(tops, [0, 24, 84]);
  assert.equal(totalHeight, 108);
  assert.equal(trackTop(0, m), 4);
  assert.equal(trackTop(2, m), 4 + 2 * 18);
});

test('layoutLanes: a zero/negative track count still yields a one-track lane', () => {
  const m = { trackHeight: 16, trackGap: 2, lanePad: 4 };
  assert.deepEqual(layoutLanes([0], m).heights, [24]);
});

test('layoutLanes/trackTop: per-lane track heights override the metrics (compact lanes)', () => {
  const m: LaneMetrics = { trackHeight: 18, trackGap: 2, lanePad: 3 };
  const { tops, heights, totalHeight } = layoutLanes([2, 3], m, [4, 18]);
  assert.deepEqual(heights, [16, 64]); // 6 + 2*4 + 2  |  6 + 3*18 + 2*2
  assert.deepEqual(tops, [0, 16]);
  assert.equal(totalHeight, 80);
  assert.equal(laneHeight(2, m, 4), 16);
  assert.equal(laneHeight(2, m), 44);
  // Track offsets within a compact lane shrink with the track height.
  assert.equal(trackTop(1, m, 4), 3 + 4 + 2);
  assert.equal(trackTop(1, m), 3 + 18 + 2);
});

// -- Auto-fit (compact lane demotion) ---------------------------------------------------

// The element's real metrics: laneHeight(n) = 20n + 4; compact(4) = 6n + 4.
const FIT_M: LaneMetrics = { trackHeight: 18, trackGap: 2, lanePad: 3 };

test('computeAutoFit: a naturally fitting layout demotes nothing', () => {
  const counts = [1, 2, 1];
  const natural = 24 + 44 + 24; // 92
  for (const avail of [natural, natural + 1, 10_000]) {
    const fit = computeAutoFit(counts, FIT_M, 4, avail, 0);
    assert.deepEqual(fit.demoted, [false, false, false]);
    assert.equal(fit.count, 0);
  }
});

test('demotionOrder: tallest first; equal counts demote the LATER lane first (top keeps detail longest)', () => {
  assert.deepEqual(demotionOrder([2, 5, 3, 5]), [3, 1, 2, 0]);
  assert.deepEqual(demotionOrder([1, 1, 1]), [2, 1, 0]);
  assert.deepEqual(demotionOrder([]), []);
});

test('computeAutoFit: demotes strictly tallest-first and stops at the first fit', () => {
  const counts = [2, 5, 3, 5]; // heights [44, 104, 64, 104], total 316
  // One demotion (lane 3, the LATER of the two 5-track lanes) fits 250.
  const one = computeAutoFit(counts, FIT_M, 4, 250, 0);
  assert.deepEqual(one.demoted, [false, false, false, true]);
  assert.equal(one.count, 1, 'stops at the first fitting count');
  // 180 needs two: lane 3 then lane 1 — never lane 2/0 before the 5s.
  const two = computeAutoFit(counts, FIT_M, 4, 180, 0);
  assert.deepEqual(two.demoted, [false, true, false, true]);
  assert.equal(two.count, 2);
});

test('computeAutoFit: all-compact fallback when even full demotion overflows (lane scroll takes over)', () => {
  const fit = computeAutoFit([1, 2, 3], FIT_M, 4, 10, 0);
  assert.deepEqual(fit.demoted, [true, true, true]);
  assert.equal(fit.count, 3);
});

test('computeAutoFit: hysteresis — borderline heights do not flap across jittering evaluations', () => {
  const counts = [4, 1, 1]; // natural 84 + 24 + 24 = 132
  assert.equal(FIT_HYSTERESIS_FRAC, 0.1);
  // Overflow at 130 → demote the 4-track lane.
  let count = computeAutoFit(counts, FIT_M, 4, 130, 0).count;
  assert.equal(count, 1);
  // Jitter around the boundary: 132 fits naturally but WITHOUT 10%
  // headroom, so the demoted lane must stay demoted — repeatedly.
  for (const avail of [132, 130, 133, 131, 132, 134, 130]) {
    const fit = computeAutoFit(counts, FIT_M, 4, avail, count);
    assert.deepEqual(fit.demoted, [true, false, false], `avail ${avail} must not flap`);
    count = fit.count;
  }
  // Only real headroom promotes: 132 <= 150 * 0.9.
  const promoted = computeAutoFit(counts, FIT_M, 4, 150, count);
  assert.deepEqual(promoted.demoted, [false, false, false]);
  assert.equal(promoted.count, 0);
  // And the clean state is just as stable across the same jitter.
  let clean = 0;
  for (const avail of [134, 133, 137, 133, 134]) {
    const fit = computeAutoFit(counts, FIT_M, 4, avail, clean);
    assert.equal(fit.count, 0, `avail ${avail} must not demote a fitting layout`);
    clean = fit.count;
  }
});

test('computeAutoFit: stable under pure viewport translation with unchanged overlap', () => {
  // Two lanes; every item intersects both translated windows, so the
  // visible-window packing — and therefore the fit — must be identical.
  const laneA: PackItem[] = [
    { id: 'a1', start: 0, end: 100 },
    { id: 'a2', start: 50, end: 150 },
    { id: 'a3', start: 120, end: 300 },
  ];
  const laneB: PackItem[] = [{ id: 'b1', start: 0, end: 400 }];
  const winA: TimeView = { start: 40, end: 160 };
  const winB: TimeView = { start: 60, end: 180 };
  const countsA = [packVisibleTracks(laneA, winA).trackCount, packVisibleTracks(laneB, winA).trackCount];
  const countsB = [packVisibleTracks(laneA, winB).trackCount, packVisibleTracks(laneB, winB).trackCount];
  assert.deepEqual(countsA, countsB);
  const fitA = computeAutoFit(countsA, FIT_M, 4, 50, 0);
  const fitB = computeAutoFit(countsB, FIT_M, 4, 50, fitA.count);
  assert.deepEqual(fitA, fitB);
  assert.deepEqual(fitA.demoted, [true, false]);
});

test('computeAutoFit: the compact height from the CSS prop drives the math (and clamps to the normal height)', () => {
  const counts = [4, 1]; // natural 84 + 24 = 108
  // compact 4: demoting the tall lane alone fits 60 (28 + 24 = 52).
  const at4 = computeAutoFit(counts, FIT_M, 4, 60, 0);
  assert.deepEqual(at4.demoted, [true, false]);
  // compact 12: the same demotion only reaches 60 + 24 = 84 — everything
  // must go compact (and still overflows → lane scroll's problem).
  assert.equal(laneHeight(4, FIT_M, 12), 60);
  const at12 = computeAutoFit(counts, FIT_M, 12, 60, 0);
  assert.deepEqual(at12.demoted, [true, true]);
  // compact above the normal height clamps to it: zero savings, saturates.
  const clamped = computeAutoFit(counts, FIT_M, 25, 60, 0);
  assert.equal(clamped.count, 2);
});

test('computeAutoFit: visible-window count changes re-evaluate the fit deterministically', () => {
  // Lane 0 is the parallel one in the early window; lane 1 in the late one.
  const mk = (n: number, s: number, e: number, tag: string): PackItem[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, start: s, end: e }));
  const lane0 = [...mk(10, 0, 100, 'w'), ...mk(2, 200, 300, 'x')];
  const lane1 = [...mk(2, 0, 100, 'y'), ...mk(12, 200, 300, 'z')];
  const early: TimeView = { start: 0, end: 100 };
  const late: TimeView = { start: 200, end: 300 };
  const countsEarly = [packVisibleTracks(lane0, early).trackCount, packVisibleTracks(lane1, early).trackCount];
  assert.deepEqual(countsEarly, [10, 2]);
  const fitEarly = computeAutoFit(countsEarly, FIT_M, 4, 120, 0);
  assert.deepEqual(fitEarly.demoted, [true, false]);
  // The window slides: the demotion hands off to the NOW-tallest lane
  // (same demoted count, different lane — re-derived, not remembered).
  const countsLate = [packVisibleTracks(lane0, late).trackCount, packVisibleTracks(lane1, late).trackCount];
  assert.deepEqual(countsLate, [2, 12]);
  const fitLate = computeAutoFit(countsLate, FIT_M, 4, 120, fitEarly.count);
  assert.deepEqual(fitLate.demoted, [false, true]);
  // Re-evaluating the same state is a fixed point (determinism).
  assert.deepEqual(computeAutoFit(countsLate, FIT_M, 4, 120, fitLate.count), fitLate);
  // Growing the host promotes everything once headroom is real.
  assert.equal(computeAutoFit(countsLate, FIT_M, 4, 400, fitLate.count).count, 0);
});

// -- fitText / instants ----------------------------------------------------------------

test('fitText: fits, truncates with an ellipsis, or suppresses entirely', () => {
  assert.equal(fitText('build', 50, 6), 'build'); // 8 chars fit
  assert.equal(fitText('deploy-production', 60, 6), `deploy-pr${ELLIPSIS}`); // 10 chars max → 9 + …
  assert.equal(fitText('deploy-production', 60, 6).length, 10);
  assert.equal(fitText('ab', 30, 6), 'ab');
  assert.equal(fitText('abcdef', 17, 6), ''); // 2 chars max → below minChars+1 → hide
  assert.equal(fitText('abcdef', 0, 6), '');
  assert.equal(fitText('', 100, 6), '');
  assert.equal(fitText('abc', 100, 0), '');
});

test('fitText: never overflows the available width', () => {
  const charW = 7;
  for (const avail of [0, 5, 10, 21, 35, 70, 200]) {
    const out = fitText('a-fairly-long-interval-label', avail, charW);
    assert.ok(out.length * charW <= avail || out === '', `"${out}" fits in ${avail}px`);
  }
});

test('isInstantWidth: threshold behavior', () => {
  assert.equal(isInstantWidth(0), true);
  assert.equal(isInstantWidth(INSTANT_THRESHOLD_PX - 0.01), true);
  assert.equal(isInstantWidth(INSTANT_THRESHOLD_PX), false);
  assert.equal(isInstantWidth(10), false);
  assert.equal(isInstantWidth(4, 6), true); // custom threshold
});

// -- Hit testing --------------------------------------------------------------------

test('expandHitRect: widens a narrow rect around its center, keeps wide rects', () => {
  const narrow: HitRect = { x: 100, y: 10, w: 1, h: 12 };
  const wide = expandHitRect(narrow, 9);
  assert.deepEqual(wide, { x: 96, y: 10, w: 9, h: 12 });
  const big: HitRect = { x: 0, y: 0, w: 50, h: 10 };
  assert.equal(expandHitRect(big, 9), big);
});

test('hitTestRects: topmost (last) wins; edges inclusive; miss = -1', () => {
  const rects: HitRect[] = [
    { x: 0, y: 0, w: 100, h: 20 },
    { x: 50, y: 0, w: 100, h: 20 },
  ];
  assert.equal(hitTestRects(75, 10, rects), 1);
  assert.equal(hitTestRects(25, 10, rects), 0);
  assert.equal(hitTestRects(0, 0, rects), 0);
  assert.equal(hitTestRects(150, 20, rects), 1);
  assert.equal(hitTestRects(300, 10, rects), -1);
});

test('hit-testing an instant: the expanded rect catches near-misses', () => {
  // A zero-width instant at x=200 drawn as a pip: visual ~1px, hit target 9px.
  const visual: HitRect = { x: 200, y: 40, w: 0.5, h: 14 };
  const hit = expandHitRect(visual, 9);
  assert.equal(hitTestRects(203, 47, [hit]), 0, '3px right of the pip still hits');
  assert.equal(hitTestRects(197, 47, [hit]), 0, '3px left of the pip still hits');
  assert.equal(hitTestRects(206, 47, [hit]), -1, 'outside the widened target misses');
});

test('distSqToSegment: interior projection and endpoint clamping', () => {
  assert.equal(distSqToSegment(5, 5, 0, 0, 10, 0), 25);
  assert.equal(distSqToSegment(-3, 4, 0, 0, 10, 0), 25); // clamps to endpoint a
  assert.equal(distSqToSegment(13, 4, 0, 0, 10, 0), 25); // clamps to endpoint b
  assert.equal(distSqToSegment(4, 4, 4, 4, 4, 4), 0); // degenerate segment
});

test('hitTestPolyline: within tolerance of any segment', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  assert.equal(hitTestPolyline(5, 2, pts, 3), true);
  assert.equal(hitTestPolyline(12, 5, pts, 3), true);
  assert.equal(hitTestPolyline(5, 5, pts, 3), false);
});

// -- connectorRoute ----------------------------------------------------------------

test('connectorRoute: straight 2-point segment when rows align going forward', () => {
  const from: HitRect = { x: 0, y: 10, w: 20, h: 10 };
  const to: HitRect = { x: 50, y: 10, w: 20, h: 10 };
  assert.deepEqual(connectorRoute(from, to), [
    { x: 20, y: 15 },
    { x: 50, y: 15 },
  ]);
});

test('connectorRoute: forward S-curve — exact endpoints, monotonic y, mid crossing', () => {
  const from: HitRect = { x: 0, y: 0, w: 20, h: 10 };
  const to: HitRect = { x: 60, y: 40, w: 20, h: 10 };
  const pts = connectorRoute(from, to, 24);
  assert.equal(pts.length, 25);
  assert.deepEqual(pts[0], { x: 20, y: 5 });
  assert.deepEqual(pts[pts.length - 1], { x: 60, y: 45 });
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].y >= pts[i - 1].y - 1e-9, 'y descends monotonically toward the target');
  }
  // The horizontal-handle cubic crosses the vertical midpoint at t = 0.5.
  assert.ok(Math.abs(pts[12].y - 25) < 1e-9);
});

test('connectorRoute: backward target loops out of the source and into the target', () => {
  const from: HitRect = { x: 100, y: 0, w: 40, h: 10 }; // ends at 140
  const to: HitRect = { x: 20, y: 40, w: 30, h: 10 }; // starts left of that
  const pts = connectorRoute(from, to, 32);
  assert.deepEqual(pts[0], { x: 140, y: 5 });
  assert.deepEqual(pts[pts.length - 1], { x: 20, y: 45 });
  // Leaves the source rightward and enters the target leftward.
  assert.ok(pts[1].x > 140, 'exits forward');
  assert.ok(pts[pts.length - 2].x < 20, 'enters backward');
  // Stays within the control-handle envelope.
  const c = 90;
  for (const p of pts) {
    assert.ok(p.x >= 20 - c - 1e-9 && p.x <= 140 + c + 1e-9);
    assert.ok(p.y >= 5 - 1e-9 && p.y <= 45 + 1e-9);
  }
});

// -- Category hue ------------------------------------------------------------------

test('hashString: stable published values (FNV-1a)', () => {
  assert.equal(hashString(''), 0x811c9dc5);
  assert.equal(hashString('a'), 0xe40c292c);
  assert.equal(hashString('foobar'), 0xbf9cf968);
});

test('categoryHue: deterministic, in [0, 360)', () => {
  const names = ['build', 'deploy', 'test', 'lint', 'release', 'db', 'cache', 'api'];
  for (const n of names) {
    const h = categoryHue(n);
    assert.equal(h, categoryHue(n), `stable for ${n}`);
    assert.ok(h >= 0 && h < 360 && Number.isInteger(h), `hue ${h} valid for ${n}`);
  }
});

test('categoryHue: stable published values (a color must never drift across sessions)', () => {
  // Regression-pinned: if any of these move, every consumer's colors change.
  assert.deepEqual(
    ['build', 'deploy', 'test', 'lint', 'release', 'db'].map(categoryHue),
    [64, 89, 260, 71, 305, 279],
  );
});

test('categoryHue: hues spread roughly uniformly over many category names', () => {
  const sectors = new Array<number>(8).fill(0);
  for (let i = 0; i < 320; i++) sectors[Math.floor(categoryHue(`category-${i}`) / 45)]++;
  for (let s = 0; s < 8; s++) {
    assert.ok(sectors[s] >= 20, `sector ${s} underpopulated (${sectors[s]}/320)`);
  }
});

test('categoryJitter: deterministic, bounded tone offsets', () => {
  for (const n of ['build', 'deploy', 'a', '']) {
    const j = categoryJitter(n);
    assert.deepEqual(j, categoryJitter(n), `stable for '${n}'`);
    assert.ok(Math.abs(j.dl) <= 0.05, `|dl| bounded for '${n}'`);
    assert.ok(Math.abs(j.dc) <= 0.02, `|dc| bounded for '${n}'`);
  }
  // The near-hue pair from the fixture set separates by tone instead.
  const a = categoryJitter('deploy');
  const b = categoryJitter('lint');
  assert.ok(Math.abs(a.dl - b.dl) > 0.01, 'nearby hues get distinct lightness');
});

test('categoryColor: oklch and hsl forms, with alpha', () => {
  assert.equal(categoryColor(210), 'oklch(0.62 0.11 210)');
  assert.equal(categoryColor(210, { alpha: 0.5 }), 'oklch(0.62 0.11 210 / 0.5)');
  assert.equal(categoryColor(210, { lightness: 0.7, chroma: 0.2 }), 'oklch(0.7 0.2 210)');
  assert.equal(categoryColor(120, { mode: 'hsl' }), 'hsl(120, 34%, 55%)');
  assert.equal(categoryColor(120, { mode: 'hsl', alpha: 0.25 }), 'hsla(120, 34%, 55%, 0.25)');
});

test('DEFAULT_STYLES: the required built-in treatments exist and alias', () => {
  assert.deepEqual(DEFAULT_STYLES.failed, DEFAULT_STYLES.emphasis);
  assert.deepEqual(DEFAULT_STYLES.queued, DEFAULT_STYLES.dim);
  assert.deepEqual(DEFAULT_STYLES.waiting, DEFAULT_STYLES.hatch);
  assert.equal(DEFAULT_STYLES.failed.glyph, 'bang');
  assert.equal(DEFAULT_STYLES.failed.border?.emphasis, true);
  assert.ok((DEFAULT_STYLES.failed.border?.width ?? 0) >= 2);
  assert.ok((DEFAULT_STYLES.dim.alphaScale ?? 1) < 1);
  assert.equal(DEFAULT_STYLES.hatch.pattern, 'hatch');
  assert.equal(DEFAULT_STYLES.outline.pattern, 'outline');
});

// -- Coverage ----------------------------------------------------------------------

test('mergeRanges: merges overlaps and touches, drops empties, sorts', () => {
  const merged = mergeRanges([
    { start: 50, end: 60 },
    { start: 0, end: 10 },
    { start: 8, end: 20 },
    { start: 20, end: 30 },
    { start: 99, end: 99 },
  ]);
  assert.deepEqual(merged, [
    { start: 0, end: 30 },
    { start: 50, end: 60 },
  ]);
});

test('subtractRanges: gaps of a span vs a cover list', () => {
  const covers: TimeRange[] = [
    { start: 10, end: 20 },
    { start: 30, end: 40 },
  ];
  assert.deepEqual(subtractRanges({ start: 0, end: 50 }, covers), [
    { start: 0, end: 10 },
    { start: 20, end: 30 },
    { start: 40, end: 50 },
  ]);
  assert.deepEqual(subtractRanges({ start: 12, end: 18 }, covers), []);
  assert.deepEqual(subtractRanges({ start: 15, end: 35 }, covers), [{ start: 20, end: 30 }]);
});

test('coverage: requests the uncovered past, widened to the min chunk', () => {
  const c = new CoverageTracker({ minChunkMs: 1_000 });
  c.addCovered(10_000, 20_000);
  const req = c.nextRequest({ start: 9_700, end: 15_000 }, 0);
  assert.ok(req, 'a request is issued');
  assert.equal(req.end, 10_000);
  assert.equal(req.start, 9_000); // 300ms gap widened to the 1s chunk
});

test('coverage: in-flight requests dedupe; settling covers and re-enables', () => {
  const c = new CoverageTracker({ minChunkMs: 1_000 });
  c.addCovered(10_000, 20_000);
  const view: TimeView = { start: 5_000, end: 15_000 };
  const req = c.nextRequest(view, 0);
  assert.ok(req);
  assert.equal(c.nextRequest(view, 0), null, 'no second request while one is in flight');
  assert.deepEqual(c.pending(), req);
  c.settle(req, { ok: true });
  assert.equal(c.pending(), null);
  assert.equal(c.nextRequest(view, 0), null, 'fully covered → no more requests');
  assert.deepEqual(c.uncoveredIn({ start: 5_000, end: 15_000 }), []);
  const wider: TimeView = { start: 2_000, end: 15_000 };
  const req2 = c.nextRequest(wider, 0);
  assert.ok(req2, 'scrolling further back requests the newly exposed gap');
  assert.equal(req2.end, req.start);
  assert.equal(req2.start, 2_000);
});

test('coverage: a fully covered viewport issues no request', () => {
  const c = new CoverageTracker();
  c.addCovered(0, 100_000);
  assert.equal(c.nextRequest({ start: 10_000, end: 90_000 }, 0), null);
});

test('coverage: rejection retries on a fixed cadence — constant gap, no cap, no give-up', () => {
  const c = new CoverageTracker({ minChunkMs: 1_000, retryMs: 2_000 });
  c.addCovered(10_000, 20_000);
  const view: TimeView = { start: 0, end: 15_000 };
  assert.equal(c.waitingRetry(0), false, 'no retry pending before any failure');
  // Many consecutive failures: the gate reopens exactly 2s after EVERY
  // failure — the delay never grows, never hits a cap, never latches off.
  let at = 0;
  for (let i = 0; i < 50; i++) {
    const req = c.nextRequest(view, at);
    assert.ok(req, `attempt ${i + 1} is issued (never gives up)`);
    assert.equal(c.waitingRetry(at), false, 'in flight is not a retry wait');
    c.settle(req, { ok: false }, at);
    assert.equal(c.nextRequest(view, at + 1_999), null, 'gated within the cadence window');
    assert.ok(c.waitingRetry(at + 1_999), 'reports the wait (keeps the frame loop pumping)');
    assert.equal(c.waitingRetry(at + 2_000), false, 'wait ends exactly at the cadence boundary');
    at += 2_000;
  }
  const r = c.nextRequest(view, at);
  assert.ok(r, 'attempt 51 fires exactly one cadence step after the 50th failure');
  c.settle(r, { ok: true });
  assert.equal(c.waitingRetry(at), false, 'success clears the retry wait');
  const r2 = c.nextRequest({ start: -5_000, end: 1_000 }, at);
  assert.ok(r2, 'after a success the next gap is requested immediately');
});

test('coverage: exhausted pins the history boundary; nothing below is requested', () => {
  const c = new CoverageTracker({ minChunkMs: 1_000 });
  c.addCovered(10_000, 20_000);
  const req = c.nextRequest({ start: 4_000, end: 15_000 }, 0);
  assert.ok(req);
  c.settle(req, { ok: true, exhausted: true });
  assert.equal(c.exhaustedBefore, req.start);
  assert.equal(c.nextRequest({ start: 0, end: 15_000 }, 10), null, 'no requests below the boundary');
  // uncoveredIn clips at the boundary too: nothing "loading" before history.
  assert.deepEqual(c.uncoveredIn({ start: 0, end: 15_000 }), []);
});

test('coverage: settle with a stale/unknown range is a no-op', () => {
  const c = new CoverageTracker({ minChunkMs: 1_000 });
  c.addCovered(10_000, 20_000);
  const req = c.nextRequest({ start: 0, end: 15_000 }, 0);
  assert.ok(req);
  c.settle({ start: 1, end: 2 }, { ok: true });
  assert.deepEqual(c.pending(), req, 'the real in-flight request survives');
});

// -- Wheel routing --------------------------------------------------------------

const wheel = (over: Partial<WheelInput>): WheelInput => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

// The full routing matrix: {plain, ctrl, meta, shift} x {deltaX only,
// deltaY only, diagonal} x {lanes overflow, no overflow}. `consumed` is
// the preventDefault contract — false means the element must NOT call
// preventDefault and the page scrolls normally over the chart.

test('routeWheel: deltaX always pans time (consumed), with and without lane overflow', () => {
  for (const lanesOverflow of [false, true]) {
    const r = routeWheel(wheel({ deltaX: -8 }), lanesOverflow);
    assert.deepEqual(r, { zoomPx: 0, panPx: -8, laneScrollPx: 0, consumed: true });
  }
});

test('routeWheel: plain deltaY scrolls lanes only when they overflow — NEVER pans time', () => {
  assert.deepEqual(routeWheel(wheel({ deltaY: 5 }), true), { zoomPx: 0, panPx: 0, laneScrollPx: 5, consumed: true });
  // No overflow: nothing routes and the event is NOT consumed — no
  // preventDefault, the page scrolls. Vertical scrolling must never
  // scroll the chart sideways.
  assert.deepEqual(routeWheel(wheel({ deltaY: 5 }), false), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
  assert.deepEqual(routeWheel(wheel({ deltaY: -240 }), false), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
});

test('routeWheel: a diagonal gesture routes each axis to its own behavior', () => {
  assert.deepEqual(routeWheel(wheel({ deltaX: -6, deltaY: 4 }), true), { zoomPx: 0, panPx: -6, laneScrollPx: 4, consumed: true });
  // No overflow: deltaX pans time, the vertical component is DROPPED (not
  // half-forwarded to the page — the event is consumed because one axis
  // routed).
  assert.deepEqual(routeWheel(wheel({ deltaX: -6, deltaY: 4 }), false), { zoomPx: 0, panPx: -6, laneScrollPx: 0, consumed: true });
});

test('routeWheel: ctrl/meta+wheel is zoom only (deltaX ignored), always consumed', () => {
  for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
    for (const lanesOverflow of [false, true]) {
      assert.deepEqual(routeWheel(wheel({ deltaX: -6, deltaY: -10, ...mod }), lanesOverflow), {
        zoomPx: -10,
        panPx: 0,
        laneScrollPx: 0,
        consumed: true,
      });
      assert.deepEqual(routeWheel(wheel({ deltaY: -10, ...mod }), lanesOverflow), {
        zoomPx: -10,
        panPx: 0,
        laneScrollPx: 0,
        consumed: true,
      });
      // Even a zero-delta tick mid-pinch is consumed — a ctrl/meta stream
      // must never leak browser page-zoom.
      assert.equal(routeWheel(wheel({ ...mod }), lanesOverflow).consumed, true);
    }
  }
});

test('routeWheel: shift+wheel pans time (vertical delta wins, else horizontal), consumed when nonzero', () => {
  for (const lanesOverflow of [false, true]) {
    assert.deepEqual(routeWheel(wheel({ deltaY: 7, shiftKey: true }), lanesOverflow), {
      zoomPx: 0,
      panPx: 7,
      laneScrollPx: 0,
      consumed: true,
    });
    assert.deepEqual(routeWheel(wheel({ deltaX: 3, shiftKey: true }), lanesOverflow), {
      zoomPx: 0,
      panPx: 3,
      laneScrollPx: 0,
      consumed: true,
    });
    assert.deepEqual(routeWheel(wheel({ deltaX: 3, deltaY: 7, shiftKey: true }), lanesOverflow), {
      zoomPx: 0,
      panPx: 7,
      laneScrollPx: 0,
      consumed: true,
    });
    assert.equal(routeWheel(wheel({ shiftKey: true }), lanesOverflow).consumed, false);
  }
});

test('routeWheel: deltaMode 1 (lines) normalizes to pixels on every path', () => {
  assert.deepEqual(routeWheel(wheel({ deltaX: -2, deltaMode: 1 }), false), { zoomPx: 0, panPx: -32, laneScrollPx: 0, consumed: true });
  assert.deepEqual(routeWheel(wheel({ deltaY: 3, deltaMode: 1 }), true), { zoomPx: 0, panPx: 0, laneScrollPx: 48, consumed: true });
  // Discrete vertical wheel, no overflow: still a pure passthrough.
  assert.deepEqual(routeWheel(wheel({ deltaY: 3, deltaMode: 1 }), false), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
  assert.deepEqual(routeWheel(wheel({ deltaY: -1, deltaMode: 1, ctrlKey: true }), false), {
    zoomPx: -16,
    panPx: 0,
    laneScrollPx: 0,
    consumed: true,
  });
});

// -- Follow-now rule ----------------------------------------------------------------

// A 1000-CSS-px plot at dpr 1: ms per device pixel for a given span.
const mppx = (span: number, plotW = 1000, dpr = 1): number => span / (plotW * dpr);

test('followAfterGesture: a small backward PAN disengages follow (trackpad panning must escape now)', () => {
  const now = 1_000_000_000;
  const span = 900_000; // 15 min
  // Pinned view: end = now + lead.
  const end = now + span * FOLLOW_LEAD_FRAC;
  const view: TimeView = { start: end - span, end };
  // One trackpad wheel step pans ~10s.
  const next = panView(view, -10_000);
  assert.equal(followAfterGesture(true, view.end, next, now, true, mppx(span)), false, 'backward pan disengages');
  // The same shift as a NON-pan while already following stays pinned.
  assert.equal(followAfterGesture(true, view.end, next, now, false, mppx(span)), true);
});

test('followAfterGesture: consecutive backward pans stay disengaged', () => {
  const now = 1_000_000_000;
  const span = 900_000;
  let view: TimeView = { start: now + span * FOLLOW_LEAD_FRAC - span, end: now + span * FOLLOW_LEAD_FRAC };
  let following = true;
  for (let i = 0; i < 5; i++) {
    const next = panView(view, -5_000);
    following = followAfterGesture(following, view.end, next, now, true, mppx(span));
    assert.equal(following, false, `step ${i} must not re-engage`);
    view = next;
  }
});

test('followAfterGesture: re-engages at the end stop — exactly at now, 1 and 2 device px short', () => {
  const now = 1_000_000_000;
  const span = 900_000;
  const px = mppx(span);
  const prevEnd = now - span; // parked well in the past, panning forward
  for (const devPx of [0, 1, 2]) {
    const v: TimeView = { start: now - devPx * px - span, end: now - devPx * px };
    assert.equal(followAfterGesture(false, prevEnd, v, now, true, px), true, `${devPx} device px re-engages`);
  }
  assert.equal(FOLLOW_SNAP_DEVICE_PX, 2);
});

test('followAfterGesture: does NOT re-engage 3+ device px from the stop (near the edge is not at the edge)', () => {
  const now = 1_000_000_000;
  const span = 900_000;
  const px = mppx(span);
  const prevEnd = now - span;
  for (const devPx of [3, 4, 10, 200]) {
    const v: TimeView = { start: now - devPx * px - span, end: now - devPx * px };
    assert.equal(followAfterGesture(false, prevEnd, v, now, true, px), false, `${devPx} device px stays put`);
  }
  // The old span-fraction zone would have grabbed a pan parked 1% of the
  // span (= 10 CSS px here) from now; the device-pixel zone must not.
  const nearFrac: TimeView = { start: now - span * 1.01, end: now - span * 0.01 };
  assert.equal(followAfterGesture(false, prevEnd, nearFrac, now, true, px), false);
});

test('followAfterGesture: device-pixel conversion — 2 device px is 1 CSS px at dpr 2', () => {
  const now = 1_000_000_000;
  const span = 900_000;
  const plotW = 1000;
  const cssPx = span / plotW; // ms per CSS px
  const prevEnd = now - span;
  // dpr 2: 1 CSS px = 2 device px → exactly at the threshold → re-engages.
  assert.equal(
    followAfterGesture(false, prevEnd, { start: now - 1 * cssPx - span, end: now - 1 * cssPx }, now, true, mppx(span, plotW, 2)),
    true,
  );
  // dpr 2: 1.6 CSS px = 3.2 device px → out.
  assert.equal(
    followAfterGesture(false, prevEnd, { start: now - 1.6 * cssPx - span, end: now - 1.6 * cssPx }, now, true, mppx(span, plotW, 2)),
    false,
  );
  // dpr 1: 2 CSS px = 2 device px → in; 3 CSS px → out.
  assert.equal(
    followAfterGesture(false, prevEnd, { start: now - 2 * cssPx - span, end: now - 2 * cssPx }, now, true, mppx(span, plotW, 1)),
    true,
  );
  assert.equal(
    followAfterGesture(false, prevEnd, { start: now - 3 * cssPx - span, end: now - 3 * cssPx }, now, true, mppx(span, plotW, 1)),
    false,
  );
});

test('followAfterGesture: zooming while pinned stays pinned (span change is not a pan)', () => {
  const now = 1_000_000_000;
  const span = 900_000;
  const end = now + span * FOLLOW_LEAD_FRAC;
  const view: TimeView = { start: end - span, end };
  const zoomed = zoomView(view, end - span / 2, 1.05); // anchor mid-screen: end moves back a bit
  assert.ok(zoomed.end < view.end);
  // The raw end lands well outside the 2-device-px zone — following must
  // survive anyway (the explicit wasFollowing rule, not the zone).
  assert.ok(zoomed.end < now - FOLLOW_SNAP_DEVICE_PX * mppx(zoomed.end - zoomed.start));
  assert.equal(followAfterGesture(true, view.end, zoomed, now, false, mppx(zoomed.end - zoomed.start)), true, 'zoom keeps follow');
  // The same zoom while NOT following does not grab the pin.
  assert.equal(followAfterGesture(false, view.end, zoomed, now, false, mppx(zoomed.end - zoomed.start)), false);
});

test('clampViewToNow: the hard end stop — end never passes now, span preserved, no-op at/before now', () => {
  const now = 1_000_000_000;
  const span = 600_000;
  for (const overshoot of [1, 5_000, span, 40 * span]) {
    const c = clampViewToNow({ start: now - span + overshoot, end: now + overshoot }, now);
    assert.equal(c.end, now, `overshoot ${overshoot} parks at the stop`);
    assert.equal(c.end - c.start, span, 'span preserved');
  }
  const before: TimeView = { start: now - 2 * span, end: now - span };
  assert.deepEqual(clampViewToNow(before, now), before);
  const at: TimeView = { start: now - span, end: now };
  assert.deepEqual(clampViewToNow(at, now), at);
});

test('clampViewToNow + followAfterGesture: any forward overshoot parks at the stop and reliably re-docks', () => {
  const now = 1_000_000_000;
  const span = 900_000;
  const px = mppx(span);
  // Every input path funnels through the clamp — wheel pan, drag, pinch,
  // keyboard, setViewport all produce some raw view; overshooting ones
  // park exactly at the stop, where re-engage is trivially within 2 px.
  for (const rawEnd of [now + 1, now + 250 * px, now + span]) {
    const clamped = clampViewToNow({ start: rawEnd - span, end: rawEnd }, now);
    assert.equal(clamped.end, now);
    assert.equal(followAfterGesture(false, now - span, clamped, now, true, px), true);
  }
});

// -- Whole-pixel scrolling ------------------------------------------------------------

test('snapViewToDevicePixels: relative offsets are exactly stable across fractional translations', () => {
  const plotW = 1000;
  const span = 600_000;
  const t0 = 1_750_000_000_000;
  const t1 = t0 + (10.4 * span) / plotW; // two times 10.4 CSS px apart
  for (const dpr of [1, 2]) {
    const offsets = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const view: TimeView = { start: t0 - span / 2 + i * 7.13, end: t0 + span / 2 + i * 7.13 };
      const rv = snapViewToDevicePixels(view, plotW, dpr);
      const off = timeToX(t1, rv, plotW) - timeToX(t0, rv, plotW);
      offsets.add(Math.round(off * 1e6) / 1e6);
    }
    assert.equal(offsets.size, 1, `dpr ${dpr}: one exact relative offset across all subpixel phases`);
    assert.ok(Math.abs([...offsets][0] - 10.4) < 1e-6);
  }
});

test('snapViewToDevicePixels: a fixed time keeps a constant subpixel phase (integer device-pixel steps)', () => {
  const plotW = 977; // deliberately odd
  const span = 123_456;
  const t = 1_750_000_000_000;
  for (const dpr of [1, 2]) {
    const phases = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const view: TimeView = { start: t - span / 3 + i * 0.377, end: t + (2 * span) / 3 + i * 0.377 };
      const rv = snapViewToDevicePixels(view, plotW, dpr);
      const xDev = timeToX(t, rv, plotW) * dpr;
      const phase = xDev - Math.floor(xDev);
      phases.add(Math.round(phase * 1e6) / 1e6);
    }
    assert.ok(phases.size <= 2, `dpr ${dpr}: phase is constant (mod float noise), got ${phases.size}`);
    const [a, b] = [...phases];
    if (b !== undefined) assert.ok(Math.abs(a - b) < 1e-3 || Math.abs(Math.abs(a - b) - 1) < 1e-3);
  }
});

test('snapViewToDevicePixels: span preserved; degenerate views returned unchanged', () => {
  const view: TimeView = { start: 1_000_000.4, end: 1_600_000.4 };
  const rv = snapViewToDevicePixels(view, 800, 2);
  assert.ok(Math.abs(rv.end - rv.start - 600_000) < 1e-6);
  const bad: TimeView = { start: 5, end: 5 };
  assert.deepEqual(snapViewToDevicePixels(bad, 800, 1), bad);
});

// -- Bar/pip stability -----------------------------------------------------------------

test('durationWidthPx: translation-invariant — shape decisions cannot flicker while scrolling', () => {
  const plotW = 1200;
  const span = 900_000; // 0.75 ms/px
  const msPerPx = span / plotW;
  const base = 1_750_000_000_000;
  // A spread of sub-second-to-seconds durations around the pip threshold.
  const durations = [0, 1, 100, 0.5 * msPerPx, 2.9 * msPerPx, 3.1 * msPerPx, 10 * msPerPx];
  for (const dur of durations) {
    const decisions = new Set<boolean>();
    for (let i = 0; i < 500; i++) {
      const view: TimeView = { start: base + i * 0.731, end: base + i * 0.731 + span };
      const w = durationWidthPx(base + span / 2, base + span / 2 + dur, view, plotW);
      decisions.add(isInstantWidth(w));
    }
    assert.equal(decisions.size, 1, `duration ${dur}ms: one representation across all viewport phases`);
  }
});

test('durationWidthPx: zero-duration events are pips at any zoom; real widths clear the threshold', () => {
  const view: TimeView = { start: 0, end: 600_000 };
  assert.equal(isInstantWidth(durationWidthPx(1_000, 1_000, view, 1000)), true, 'zero duration = pip');
  // 2px true width: below the pip threshold — but MIN_BAR_PX exists so a
  // bar that passes the threshold is never rendered thinner than 2px.
  assert.ok(MIN_BAR_PX >= 2 && MIN_BAR_PX < INSTANT_THRESHOLD_PX);
  const wide = durationWidthPx(0, 3_600, view, 1000); // 6px
  assert.equal(isInstantWidth(wide), false);
});

// -- Visible-window packing --------------------------------------------------------------

test('packVisibleTracks: a parallelism burst outside the window does not inflate the lane', () => {
  const items: PackItem[] = [
    // Historical burst: 4 concurrent runs.
    { id: 'b1', start: 0, end: 100 },
    { id: 'b2', start: 10, end: 90 },
    { id: 'b3', start: 20, end: 80 },
    { id: 'b4', start: 30, end: 70 },
    // Recent, serial runs.
    { id: 'r1', start: 1_000, end: 1_100 },
    { id: 'r2', start: 1_200, end: 1_300 },
  ];
  const over = packVisibleTracks(items, { start: 950, end: 1_400 });
  assert.equal(over.trackCount, 1, 'only the serial runs are visible');
  assert.deepEqual(over.tracks.slice(0, 4), [-1, -1, -1, -1], 'burst items are out of view');
  const burst = packVisibleTracks(items, { start: 0, end: 200 });
  assert.equal(burst.trackCount, 4, 'looking AT the burst still shows 4 tracks');
});

test('packVisibleTracks: partial overlap counts; empty window collapses to one track', () => {
  const items: PackItem[] = [
    { id: 'a', start: 0, end: 500 },
    { id: 'b', start: 400, end: 900 },
  ];
  // Window clips both, they overlap each other → 2 tracks.
  assert.equal(packVisibleTracks(items, { start: 420, end: 480 }).trackCount, 2);
  // Window sees nothing → collapses to 1.
  const empty = packVisibleTracks(items, { start: 2_000, end: 3_000 });
  assert.equal(empty.trackCount, 1);
  assert.deepEqual(empty.tracks, [-1, -1]);
});

test('packVisibleTracks: ongoing intervals (end null) intersect every later window', () => {
  const items: PackItem[] = [
    { id: 'live', start: 100, end: null },
    { id: 'x', start: 5_000, end: 6_000 },
  ];
  const r = packVisibleTracks(items, { start: 4_000, end: 7_000 });
  assert.equal(r.trackCount, 2, 'the ongoing run still occupies a track');
  assert.notEqual(r.tracks[0], -1);
});

test('packVisibleTracks: assignment is stable while the window slides over an unchanged visible set', () => {
  const items: PackItem[] = [
    { id: 'a', start: 1_000, end: 2_000 },
    { id: 'b', start: 1_500, end: 2_500 },
    { id: 'c', start: 2_600, end: 3_000 },
  ];
  const first = packVisibleTracks(items, { start: 900, end: 3_100 });
  for (let dt = 0; dt < 80; dt += 7) {
    // All slides keep the same three items visible.
    const r = packVisibleTracks(items, { start: 900 + dt, end: 3_100 + dt });
    assert.deepEqual(r.tracks, first.tracks, `slide +${dt} keeps identical assignments`);
    assert.equal(r.trackCount, first.trackCount);
  }
});

// -- historyProbe (the request-flood regression) -----------------------------------------

test('historyProbe: never reaches past the covered end — the live edge belongs to the data feed', () => {
  const now0 = 1_000_000_000;
  const span = 900_000;
  const coveredEnd = now0; // consumer covered up to its last poll
  // Follow mode: the view's end rides ahead of now; "now" keeps advancing.
  for (let frame = 1; frame <= 100; frame++) {
    const now = now0 + frame * 16;
    const end = now + span * FOLLOW_LEAD_FRAC;
    const probe = historyProbe({ start: end - span, end }, now, coveredEnd);
    assert.ok(probe, 'the backward window is still probeable');
    assert.ok(probe.end <= coveredEnd, `frame ${frame}: probe must not chase "now" past coverage`);
  }
});

test('historyProbe + CoverageTracker: an idle covered viewport never re-fires (no request storm)', () => {
  const tracker = new CoverageTracker();
  const span = 900_000;
  const now0 = 1_000_000_000;
  tracker.addCovered(now0 - 2 * span, now0); // poll seeded coverage
  let requests = 0;
  for (let frame = 0; frame < 1_000; frame++) {
    const now = now0 + frame * 16;
    const end = now + span * FOLLOW_LEAD_FRAC;
    const probe = historyProbe({ start: end - span, end }, now, tracker.coveredEnd());
    if (!probe) continue;
    const req = tracker.nextRequest(probe, now);
    if (req) {
      requests++;
      tracker.settle(req, { ok: true }); // covered — must LATCH
    }
  }
  assert.equal(requests, 0, 'fully covered viewport issues zero loadRange requests while now advances');
});

test('historyProbe: bootstrap (no coverage) probes up to now, then latches after one settle', () => {
  const tracker = new CoverageTracker();
  const span = 900_000;
  let now = 1_000_000_000;
  const probe0 = historyProbe({ start: now - span, end: now }, now, tracker.coveredEnd());
  assert.ok(probe0 && probe0.end === now, 'first load may reach now');
  const req = tracker.nextRequest(probe0, now);
  assert.ok(req);
  tracker.settle(req, { ok: true });
  // Frames keep coming, now keeps advancing — but coverage now ends at the
  // settled edge, so the probe clamps there and nothing re-fires.
  let refires = 0;
  for (let frame = 0; frame < 500; frame++) {
    now += 16;
    const probe = historyProbe({ start: now - span, end: now }, now, tracker.coveredEnd());
    if (!probe) continue;
    const r = tracker.nextRequest(probe, now);
    if (r) {
      refires++;
      tracker.settle(r, { ok: true });
    }
  }
  assert.equal(refires, 0, 'the forward sliver between coverage and now is never requested');
});

test('historyProbe: backward gaps are still requested (panning into uncovered history works)', () => {
  const tracker = new CoverageTracker();
  const now = 1_000_000_000;
  tracker.addCovered(now - 1_000_000, now);
  // Viewport panned deep into the uncovered past.
  const view: TimeView = { start: now - 5_000_000, end: now - 4_000_000 };
  const probe = historyProbe(view, now, tracker.coveredEnd());
  assert.ok(probe);
  const req = tracker.nextRequest(probe, now);
  assert.ok(req, 'backward history is requestable');
  assert.ok(req.end <= now - 4_000_000 + 1e-6);
});

test('coverage: the fixed cadence still storm-proofs a 60Hz frame loop after a failure', () => {
  const c = new CoverageTracker(); // default: fixed 2s retry cadence
  const view: TimeView = { start: 0, end: 100_000 };
  const req = c.nextRequest(view, 0);
  assert.ok(req);
  c.settle(req, { ok: false }, 1_000);
  // A frame loop probing every 16ms issues NOTHING inside the window — the
  // cadence gate (not backoff growth) is what prevents request storms.
  let issued = 0;
  for (let now = 1_016; now < 3_000; now += 16) {
    if (c.nextRequest(view, now)) issued++;
  }
  assert.equal(issued, 0, 'no request storm within the retry window');
  assert.ok(c.nextRequest(view, 3_001), 'the retry fires once the cadence elapses');
});

// -- Render pacing ---------------------------------------------------------------------

test('frameBudgetMs: interactive renders every frame; idle ~30fps; battery ~10fps', () => {
  assert.equal(frameBudgetMs('interactive'), 0);
  assert.equal(frameBudgetMs('idle'), IDLE_FRAME_MS);
  assert.equal(frameBudgetMs('idle-battery'), IDLE_BATTERY_FRAME_MS);
  assert.ok(IDLE_FRAME_MS > 16.7 && IDLE_FRAME_MS < 34);
  assert.equal(IDLE_BATTERY_FRAME_MS, 100);
});

test('shouldRender: gates a 60Hz rAF stream to the tier budget without aliasing', () => {
  const countAt = (budget: number): number => {
    let rendered = 0;
    let last = -Infinity;
    for (let i = 0; i < 600; i++) {
      const t = i * (1000 / 60);
      if (shouldRender(t, last, budget)) {
        rendered++;
        last = t;
      }
    }
    return rendered;
  };
  assert.equal(countAt(0), 600, 'interactive: every frame');
  const idle = countAt(IDLE_FRAME_MS);
  assert.ok(idle >= 280 && idle <= 320, `idle ≈ 30fps over 10s, got ${idle / 10}/s`);
  const battery = countAt(IDLE_BATTERY_FRAME_MS);
  assert.ok(battery >= 95 && battery <= 105, `battery ≈ 10fps over 10s, got ${battery / 10}/s`);
});
