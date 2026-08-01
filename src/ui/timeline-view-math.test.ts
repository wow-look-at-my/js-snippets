// Tests for the pure math half of <timeline-view> (ui/timeline-view-math.ts):
// scales + anchor-preserving zoom, wheel normalization + gesture routing,
// the follow-now engage/disengage rule (2-device-px re-engage at the hard
// `now` end stop), the eased follow lead (engage/disengage/jump-to-now
// glide continuously — never a one-frame lead teleport; reduced motion
// snaps), whole-device-pixel view snapping, the time tick ladder
// and label granularity, sub-track packing (whole-set and visible-window,
// incl. coincident instants), lane layout (incl. per-lane track heights),
// auto-fit compact-lane demotion (tallest-first order, hysteresis,
// stability under viewport translation), label fitting, instant-width
// thresholds (duration-based, translation-stable), the minimap strip's
// window math (extent derivation, px mapping + crop, handle hit zones,
// pan/resize/center drags with extent + span clamps), hit testing,
// connector routing, category hue hashing, coverage / range-request
// bookkeeping (incl. the loadRange request-flood regression), and
// render-loop pacing.
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
  DEFAULT_SPAN_REF_MS,
  defaultSpanForAspect,
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
  classifyWheel,
  WheelGestureRouter,
  WHEEL_GESTURE_GAP_MS,
  followAfterGesture,
  FOLLOW_LEAD_FRAC,
  FOLLOW_SNAP_DEVICE_PX,
  FOLLOW_LEAD_TWEEN_MS,
  JUMP_TO_NOW_TWEEN_MS,
  followLeadAt,
  gestureLeadFrac,
  STALE_AFTER_DEFAULT_MS,
  feedIsStale,
  liveEdgeTarget,
  clampViewToNow,
  snapViewToDevicePixels,
  snapTextOrigin,
  nowLineX,
  durationWidthPx,
  edgeContinuation,
  MIN_BAR_PX,
  packVisibleTracks,
  TrackAllocator,
  clusterInstants,
  clusterZoomView,
  clusterMarkerTime,
  fitSpanView,
  segmentAtTime,
  CLUSTER_JOIN_PX,
  CLUSTER_MAX_SPAN_PX,
  CLUSTER_ZOOM_FILL_FRAC,
  minimapExtent,
  minimapWindowRect,
  minimapHitZone,
  minimapPan,
  minimapResize,
  minimapCenter,
  MINIMAP_HANDLE_HIT_PX,
  MINIMAP_MIN_WINDOW_PX,
  laneHeight,
  demotionOrder,
  computeAutoFit,
  FIT_HYSTERESIS_FRAC,
  frameBudgetMs,
  shouldRender,
  clockDrawBudgetMs,
  IDLE_FRAME_MS,
  IDLE_BATTERY_FRAME_MS,
  dimColor,
  labelHaloColor,
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

// -- Default span (aspect-scaled initial window) -----------------------------------

test('defaultSpanForAspect: exactly the 3-min reference at 16:9', () => {
  assert.equal(defaultSpanForAspect(1600, 900), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(1920, 1080), DEFAULT_SPAN_REF_MS);
  assert.equal(DEFAULT_SPAN_REF_MS, 180_000);
});

test('defaultSpanForAspect: scales linearly with the container aspect ratio', () => {
  // 21:9 ultrawide: span × (21/9)/(16/9) = ×(21/16).
  assert.ok(Math.abs(defaultSpanForAspect(2100, 900) - DEFAULT_SPAN_REF_MS * (21 / 16)) < 1e-6);
  // 1:1 square: span × 1/(16/9) = ×(9/16).
  assert.ok(Math.abs(defaultSpanForAspect(900, 900) - DEFAULT_SPAN_REF_MS * (9 / 16)) < 1e-6);
  // Linearity: doubling the width doubles the span (below the clamp).
  assert.ok(Math.abs(defaultSpanForAspect(3200, 900) - 2 * defaultSpanForAspect(1600, 900)) < 1e-6);
  // Pure-scale invariance: only the RATIO matters, not the absolute size.
  assert.equal(defaultSpanForAspect(160, 90), defaultSpanForAspect(3200, 1800));
});

test('defaultSpanForAspect: degenerate/unsized hosts fall back to the 3-min reference', () => {
  assert.equal(defaultSpanForAspect(0, 900), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(1600, 0), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(0, 0), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(-4, 100), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(NaN, 900), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(1600, Infinity), DEFAULT_SPAN_REF_MS);
});

test('defaultSpanForAspect: clamps to [MIN_SPAN_MS, MAX_SPAN_MS] at extreme aspects', () => {
  assert.equal(defaultSpanForAspect(1e9, 1), MAX_SPAN_MS);
  assert.equal(defaultSpanForAspect(1, 1e6), MIN_SPAN_MS);
  // Just inside the clamps stays unclamped.
  const wide = defaultSpanForAspect(6000, 900);
  assert.ok(wide > DEFAULT_SPAN_REF_MS && wide < MAX_SPAN_MS);
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
  // dim/queued and hatch/waiting are DIMMED regions: the element runs
  // every color painted inside them (fill, border, label text) through
  // the uniform dimColor transform — no per-channel scale soup.
  assert.equal(DEFAULT_STYLES.dim.dimmed, true);
  assert.equal(DEFAULT_STYLES.hatch.dimmed, true);
  assert.equal(DEFAULT_STYLES.hatch.pattern, 'hatch');
  assert.equal(DEFAULT_STYLES.outline.pattern, 'outline');
});

test("DEFAULT_STYLES: 'cancelled' is hollow + dashed, distinct from BOTH failure and success", () => {
  const c = DEFAULT_STYLES.cancelled;
  assert.equal(c.pattern, 'outline', 'hollow body — never a solid success-look bar');
  assert.ok((c.border?.dash?.length ?? 0) >= 2, 'dashed whole-span border');
  assert.notEqual(c.border?.emphasis, true, 'category hue, never the failure emphasis color');
  assert.equal(c.glyph ?? 'none', 'none', 'no failure bang glyph');
  // Failure keeps its own unmistakable signature: solid-stroke emphasis
  // border + bang — no dash overlap between the two treatments.
  assert.equal(DEFAULT_STYLES.failed.border?.dash, undefined);
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
// deltaY only, diagonal by dominant axis} x {lanes overflow, no
// overflow}. `consumed` is the preventDefault contract — false means the
// element must NOT call preventDefault and the page scrolls normally over
// the chart. routeWheel is the PER-EVENT rule, exact for a FRESH or
// ISOLATED event ("vertical-dominant is never consumed" holds AS A FRESH
// EVENT); within a live stream the WheelGestureRouter's axis lock governs
// consumption instead — see the stream tests below the classify block.

test('routeWheel: deltaX always pans time (consumed), with and without lane overflow', () => {
  for (const lanesOverflow of [false, true]) {
    const r = routeWheel(wheel({ deltaX: -8 }), lanesOverflow);
    assert.deepEqual(r, { zoomPx: 0, panPx: -8, laneScrollPx: 0, consumed: true });
  }
});

test('routeWheel: plain deltaY routes NOTHING — page scroll wins even over an overflowing lane stack', () => {
  // The vertical-scroll contract: a vertical-dominant modifier-less wheel
  // is never consumed AS A FRESH/ISOLATED EVENT, so preventDefault is not
  // called and the page scrolls over the chart — regardless of lane
  // overflow (an overflowing stack used to capture deltaY and eat the
  // page's scroll on exactly the busy charts that always overflow).
  // Stream-level: inside a live HORIZONTAL-locked gesture the same event
  // IS consumed (see the WheelGestureRouter tests) — that's the fix for
  // its jitter creeping the page mid-pan, not a hole in this contract.
  for (const lanesOverflow of [false, true]) {
    assert.deepEqual(routeWheel(wheel({ deltaY: 5 }), lanesOverflow), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
    assert.deepEqual(routeWheel(wheel({ deltaY: -240 }), lanesOverflow), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
  }
});

test('routeWheel: a HORIZONTAL-dominant diagonal pans time; its minor deltaY nudges overflowing lanes', () => {
  assert.deepEqual(routeWheel(wheel({ deltaX: -6, deltaY: 4 }), true), { zoomPx: 0, panPx: -6, laneScrollPx: 4, consumed: true });
  // No overflow: deltaX pans time, the minor vertical component is
  // DROPPED (not half-forwarded to the page — the event is consumed
  // because the dominant axis routed).
  assert.deepEqual(routeWheel(wheel({ deltaX: -6, deltaY: 4 }), false), { zoomPx: 0, panPx: -6, laneScrollPx: 0, consumed: true });
});

test('routeWheel: a VERTICAL-dominant diagonal (ties included) belongs to the page', () => {
  for (const lanesOverflow of [false, true]) {
    // |dy| > |dx|: the whole gesture goes to the page — the minor dx is
    // never half-applied as a sideways chart pan.
    assert.deepEqual(routeWheel(wheel({ deltaX: 3, deltaY: -9 }), lanesOverflow), {
      zoomPx: 0,
      panPx: 0,
      laneScrollPx: 0,
      consumed: false,
    });
    // An exact tie counts as vertical: only a CLEARLY horizontal gesture
    // may take the event away from page scrolling.
    assert.deepEqual(routeWheel(wheel({ deltaX: 5, deltaY: 5 }), lanesOverflow), {
      zoomPx: 0,
      panPx: 0,
      laneScrollPx: 0,
      consumed: false,
    });
    // Zero-delta plain tick: nothing to route, not consumed.
    assert.equal(routeWheel(wheel({}), lanesOverflow).consumed, false);
  }
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
  // Horizontal-dominant discrete diagonal over overflowing lanes: both
  // axes come out normalized (lineHeight 16).
  assert.deepEqual(routeWheel(wheel({ deltaX: -4, deltaY: 1, deltaMode: 1 }), true), {
    zoomPx: 0,
    panPx: -64,
    laneScrollPx: 16,
    consumed: true,
  });
  // Discrete vertical wheel: a pure passthrough, overflow or not.
  assert.deepEqual(routeWheel(wheel({ deltaY: 3, deltaMode: 1 }), true), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
  assert.deepEqual(routeWheel(wheel({ deltaY: 3, deltaMode: 1 }), false), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
  assert.deepEqual(routeWheel(wheel({ deltaY: -1, deltaMode: 1, ctrlKey: true }), false), {
    zoomPx: -16,
    panPx: 0,
    laneScrollPx: 0,
    consumed: true,
  });
});

test('classifyWheel: spot checks of the three classes', () => {
  assert.equal(classifyWheel(wheel({ ctrlKey: true })), 'zoom'); // even zero-delta (pinch stream)
  assert.equal(classifyWheel(wheel({ metaKey: true, deltaY: 4 })), 'zoom');
  assert.equal(classifyWheel(wheel({ shiftKey: true, deltaY: 7 })), 'pan');
  assert.equal(classifyWheel(wheel({ shiftKey: true, deltaX: 3 })), 'pan'); // Firefox puts shift-pan in deltaX
  assert.equal(classifyWheel(wheel({ shiftKey: true })), 'passthrough'); // inert shift tick
  assert.equal(classifyWheel(wheel({ deltaX: -8 })), 'pan'); // horizontal-dominant
  assert.equal(classifyWheel(wheel({ deltaY: 120 })), 'passthrough'); // plain vertical → the page
  assert.equal(classifyWheel(wheel({ deltaX: 5, deltaY: 5 })), 'passthrough'); // ties are vertical
  assert.equal(classifyWheel(wheel({})), 'passthrough'); // zero-delta unmodified tick
  // deltaMode normalization happens BEFORE classification: a line-mode
  // wheel classifies exactly like its pixel-mode equivalent.
  assert.equal(classifyWheel(wheel({ deltaY: 3, deltaMode: 1 })), 'passthrough');
  assert.equal(classifyWheel(wheel({ deltaX: -2, deltaMode: 1 })), 'pan');
});

test('classifyWheel ↔ routeWheel invariant: consumed === (class !== passthrough), for ALL inputs and overflow', () => {
  // The pinned contract: lane overflow must NEVER influence consumption
  // (the pre-#42 regression), and the classifier must agree with the
  // router byte-for-byte on every combination. Sweep the full matrix:
  // modifiers × per-axis delta values (incl. zero, ties, negatives, and
  // non-finite — which normalize to 0) × deltaMode × lanesOverflow.
  const deltas = [-240, -16, -5, -1, 0, 1, 5, 16, 240, NaN, Infinity];
  const modes = [0, 1, 2];
  const mods = [
    {},
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, shiftKey: true },
  ];
  let checked = 0;
  for (const mod of mods) {
    for (const deltaMode of modes) {
      for (const deltaX of deltas) {
        for (const deltaY of deltas) {
          const e = wheel({ deltaX, deltaY, deltaMode, ...mod });
          const cls = classifyWheel(e);
          for (const lanesOverflow of [false, true]) {
            const route = routeWheel(e, lanesOverflow);
            assert.equal(
              route.consumed,
              cls !== 'passthrough',
              `mismatch at dx=${deltaX} dy=${deltaY} mode=${deltaMode} mods=${JSON.stringify(mod)} overflow=${lanesOverflow}: class=${cls}, consumed=${route.consumed}`,
            );
            checked++;
          }
          // The class also never depends on overflow by construction
          // (classifyWheel has no overflow parameter) — and consumption
          // agreeing across both overflow values re-proves the router
          // side of that same rule.
          assert.equal(routeWheel(e, false).consumed, routeWheel(e, true).consumed);
        }
      }
    }
  }
  assert.ok(checked >= 6 * 3 * 11 * 11 * 2, `full matrix swept (${checked})`);
});

// -- Wheel gesture axis lock (stream-level routing) -------------------------------

// WheelGestureRouter = the per-event table above + a gesture axis lock
// bounded by WHEEL_GESTURE_GAP_MS of unmodified-wheel silence. All tests
// drive time explicitly (the third `route` argument) — the router reads
// no clock of its own.

test('WheelGestureRouter: a FRESH router routes any single event exactly like routeWheel (full matrix)', () => {
  // The isolated-event contract: gesture state only ever changes what
  // happens WITHIN a stream — the first (or a lone) event's route is
  // byte-identical to the per-event router's, across the same matrix the
  // classify invariant sweeps.
  const deltas = [-240, -16, -5, -1, 0, 1, 5, 16, 240, NaN, Infinity];
  const modes = [0, 1, 2];
  const mods = [
    {},
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, shiftKey: true },
  ];
  let checked = 0;
  for (const mod of mods) {
    for (const deltaMode of modes) {
      for (const deltaX of deltas) {
        for (const deltaY of deltas) {
          const e = wheel({ deltaX, deltaY, deltaMode, ...mod });
          for (const lanesOverflow of [false, true]) {
            const fresh = new WheelGestureRouter();
            assert.deepEqual(
              fresh.route(e, lanesOverflow, 1000),
              routeWheel(e, lanesOverflow),
              `fresh-router mismatch at dx=${deltaX} dy=${deltaY} mode=${deltaMode} mods=${JSON.stringify(mod)} overflow=${lanesOverflow}`,
            );
            checked++;
          }
        }
      }
    }
  }
  assert.ok(checked >= 6 * 3 * 11 * 11 * 2, `full matrix swept (${checked})`);
});

test('WheelGestureRouter: h-locked stream consumes its vertical-dominant jitter — pan is Σdx, the page gets nothing', () => {
  // The operator gesture: a mostly-horizontal trackpad swipe whose edge /
  // momentum-tail events are individually vertical-dominant (-4, 10-ish).
  // Per-event routing leaked each of those to the page; locked, EVERY
  // unmodified event of the gesture is consumed — including a
  // pure-vertical momentum tick — and pan is the exact sum of dx.
  const stream: Array<[number, number]> = [
    [-120, 8],
    [-120, 8],
    [-4, 12], // vertical-dominant jitter: passthrough as a fresh event, consumed here
    [-120, 8],
    [0, 10], // pure-vertical momentum tick inside the gesture: still consumed
    [-120, 8],
    [-4, 12],
    [-120, 8],
  ];
  const r = new WheelGestureRouter();
  let ts = 5000;
  let pan = 0;
  for (const [deltaX, deltaY] of stream) {
    const route = r.route(wheel({ deltaX, deltaY }), false, ts);
    assert.equal(route.consumed, true, `(${deltaX}, ${deltaY}) at ${ts} must be consumed inside the h gesture`);
    assert.equal(route.zoomPx, 0);
    assert.equal(route.laneScrollPx, 0, 'no lane overflow: the minor dy is dropped, never half-forwarded');
    pan += route.panPx;
    ts += 16;
  }
  assert.equal(pan, -120 * 5 - 4 * 2, 'pan equals the sum of every event\'s dx, jitter included');
});

test('WheelGestureRouter: h-locked stream over overflowing lanes — dy keeps nudging the lane stack, jitter included', () => {
  const r = new WheelGestureRouter();
  let ts = 0;
  let pan = 0;
  let lane = 0;
  for (const [deltaX, deltaY] of [
    [-60, 4],
    [-3, 9], // vertical-dominant jitter
    [-60, 4],
  ] as Array<[number, number]>) {
    const route = r.route(wheel({ deltaX, deltaY }), true, ts);
    assert.equal(route.consumed, true);
    pan += route.panPx;
    lane += route.laneScrollPx;
    ts += 16;
  }
  assert.equal(pan, -123);
  assert.equal(lane, 17, 'the h route\'s laneScroll behavior applies stream-wide (lanesOverflow ? dy : 0)');
});

test('WheelGestureRouter: v-locked stream passes EVERYTHING through — horizontal jitter never pans the chart', () => {
  // The symmetric leak: a page scroll's jittery minority events are
  // individually horizontal-dominant and used to nudge the chart
  // sideways. Locked vertical, nothing is consumed and nothing routes.
  const stream: Array<[number, number]> = [
    [0, 120],
    [2, 90],
    [-12, 5], // horizontal-dominant jitter: pan as a fresh event, passthrough here
    [0, 120],
    [-14, 6],
    [0, 120],
  ];
  const r = new WheelGestureRouter();
  let ts = 9000;
  for (const [deltaX, deltaY] of stream) {
    for (const lanesOverflow of [false, true]) {
      // Routing must not depend on overflow either way; route twice at
      // the same ts (idempotent for a v-locked stream — nothing mutates
      // but the gesture clock).
      assert.deepEqual(r.route(wheel({ deltaX, deltaY }), lanesOverflow, ts), {
        zoomPx: 0,
        panPx: 0,
        laneScrollPx: 0,
        consumed: false,
      });
    }
    ts += 16;
  }
});

test('WheelGestureRouter: a gap over WHEEL_GESTURE_GAP_MS ends the gesture — the next event classifies fresh', () => {
  const r = new WheelGestureRouter();
  // h gesture...
  assert.equal(r.route(wheel({ deltaX: -120, deltaY: 8 }), false, 1000).consumed, true);
  assert.equal(r.route(wheel({ deltaX: -120, deltaY: 8 }), false, 1016).consumed, true);
  // ...pause 300ms, then a vertical-dominant event: FRESH → 'v' → the page.
  assert.equal(r.route(wheel({ deltaX: -4, deltaY: 10 }), false, 1316).consumed, false);
  // The fresh event locked 'v': horizontal JITTER inside its gesture
  // passes through too (under the flip floor — a DECISIVE horizontal
  // event would re-lock instead, see the flip test)...
  assert.equal(r.route(wheel({ deltaX: -12, deltaY: 5 }), false, 1332).consumed, false);
  // ...until a pause frees it again.
  assert.equal(r.route(wheel({ deltaX: -12, deltaY: 5 }), false, 1332 + WHEEL_GESTURE_GAP_MS + 1).consumed, true);

  // Boundary pin: exactly WHEEL_GESTURE_GAP_MS later is still the same
  // gesture; one ms past it is fresh.
  const b = new WheelGestureRouter();
  assert.equal(b.route(wheel({ deltaX: -120, deltaY: 8 }), false, 2000).consumed, true);
  assert.equal(b.route(wheel({ deltaX: -4, deltaY: 10 }), false, 2000 + WHEEL_GESTURE_GAP_MS).consumed, true, 'ts delta == gap: still locked');
  const c = new WheelGestureRouter();
  assert.equal(c.route(wheel({ deltaX: -120, deltaY: 8 }), false, 2000).consumed, true);
  assert.equal(c.route(wheel({ deltaX: -4, deltaY: 10 }), false, 2000 + WHEEL_GESTURE_GAP_MS + 1).consumed, false, 'ts delta > gap: fresh');
});

test('WheelGestureRouter: a DECISIVE opposite-axis event re-locks mid-gesture — proportional jitter never does', () => {
  // The load-bearing case (browser-verified on the two-chart showcase): a
  // page scroll carries a second chart under the cursor mid-stream, and
  // the first event that chart's FRESH router sees is horizontal-dominant
  // jitter → it locks 'h'. Without the flip it would eat the rest of the
  // page's scroll; the next full-size vertical tick must win it back.
  const r = new WheelGestureRouter();
  assert.equal(r.route(wheel({ deltaX: -12, deltaY: 5 }), false, 1000).consumed, true, 'fresh h-dominant jitter locks h (per-event rule)');
  assert.equal(r.route(wheel({ deltaY: 100 }), false, 1016).consumed, false, 'decisive vertical (>2x, >=24px) flips the lock to v');
  assert.equal(r.route(wheel({ deltaY: 100 }), false, 1032).consumed, false, 'the page keeps the stream');
  assert.equal(r.route(wheel({ deltaX: -12, deltaY: 5 }), false, 1048).consumed, false, 'later jitter is under the floor: no flip back');

  // Symmetric: a decisive horizontal event mid-v-stream reclaims the
  // chart without waiting out the gap.
  const v = new WheelGestureRouter();
  assert.equal(v.route(wheel({ deltaY: 120 }), false, 2000).consumed, false);
  assert.deepEqual(v.route(wheel({ deltaX: -120, deltaY: 8 }), false, 2016), {
    zoomPx: 0,
    panPx: -120,
    laneScrollPx: 0,
    consumed: true,
  });

  // The flip needs BOTH thresholds — this is what keeps the operator's
  // own jitter from re-leaking:
  const h = new WheelGestureRouter();
  assert.equal(h.route(wheel({ deltaX: -120, deltaY: 8 }), false, 3000).consumed, true);
  // ratio met (12 > 2*4) but under the 24px floor → still consumed.
  assert.equal(h.route(wheel({ deltaX: -4, deltaY: 12 }), false, 3016).consumed, true);
  // floor met but not the ratio (100 <= 2*60) → a strong diagonal stays h.
  assert.equal(h.route(wheel({ deltaX: -60, deltaY: 100 }), false, 3032).consumed, true);
  // exactly at the floor with the ratio → flips (>= is inclusive).
  assert.equal(h.route(wheel({ deltaX: -4, deltaY: 24 }), false, 3048).consumed, false);
});

test('WheelGestureRouter: modifier events route as routeWheel and neither read nor extend the lock', () => {
  // (d) a ctrl zoom mid-h-stream: routes exactly like per-event
  // routeWheel (always consumed), and the h lock survives for the next
  // unmodified event — jitter right after the pinch is still consumed.
  const r = new WheelGestureRouter();
  assert.equal(r.route(wheel({ deltaX: -120, deltaY: 8 }), false, 1000).consumed, true);
  assert.deepEqual(r.route(wheel({ deltaY: -40, ctrlKey: true }), true, 1016), {
    zoomPx: -40,
    panPx: 0,
    laneScrollPx: 0,
    consumed: true,
  });
  assert.deepEqual(r.route(wheel({ deltaX: -4, deltaY: 10 }), false, 1032), {
    zoomPx: 0,
    panPx: -4,
    laneScrollPx: 0,
    consumed: true,
  });

  // ...but modifiers do not EXTEND the gesture: a pinch outlasting the
  // gap is a real pause, so the next unmodified event classifies fresh.
  const s = new WheelGestureRouter();
  assert.equal(s.route(wheel({ deltaX: -120, deltaY: 8 }), false, 1000).consumed, true);
  for (let ts = 1016; ts <= 1250; ts += 16) {
    assert.equal(s.route(wheel({ deltaY: -10, ctrlKey: true }), false, ts).consumed, true);
  }
  assert.equal(s.route(wheel({ deltaX: -4, deltaY: 10 }), false, 1266).consumed, false, 'gap since the last UNMODIFIED event: fresh → v');

  // shift-pan mid-v-stream stays a consumed time pan while the v lock
  // survives around it (the page keeps the surrounding gesture).
  const v = new WheelGestureRouter();
  assert.equal(v.route(wheel({ deltaY: 120 }), false, 3000).consumed, false);
  assert.deepEqual(v.route(wheel({ deltaY: 7, shiftKey: true }), false, 3016), {
    zoomPx: 0,
    panPx: 7,
    laneScrollPx: 0,
    consumed: true,
  });
  assert.equal(v.route(wheel({ deltaX: -12, deltaY: 5 }), false, 3032).consumed, false, 'v lock intact across the shift event');

  // And modifiers never START a gesture: an isolated zoom leaves no lock
  // behind for the next unmodified event to inherit.
  const z = new WheelGestureRouter();
  assert.equal(z.route(wheel({ deltaY: -40, ctrlKey: true }), false, 4000).consumed, true);
  assert.equal(z.route(wheel({ deltaX: -4, deltaY: 10 }), false, 4016).consumed, false, 'fresh classification (v), not an inherited lock');
});

test('WheelGestureRouter: zero-delta unmodified ticks route nothing and neither start, extend, nor reset a gesture', () => {
  // Fresh zero tick: not consumed, no gesture begun.
  const r = new WheelGestureRouter();
  assert.deepEqual(r.route(wheel({}), false, 1000), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });

  // Zero ticks inside an h gesture leave the lock intact (no reset)...
  assert.equal(r.route(wheel({ deltaX: -120, deltaY: 8 }), false, 1016).consumed, true);
  assert.equal(r.route(wheel({}), false, 1032).consumed, false);
  assert.equal(r.route(wheel({ deltaX: -4, deltaY: 10 }), false, 1100).consumed, true, 'lock intact across the zero tick');

  // ...but do not extend it: with only zero ticks inside the gap window,
  // the gesture still expires relative to the last NONZERO event.
  const s = new WheelGestureRouter();
  assert.equal(s.route(wheel({ deltaX: -120, deltaY: 8 }), false, 2000).consumed, true);
  assert.equal(s.route(wheel({}), false, 2000 + 180).consumed, false);
  // 2000+380 is exactly GAP past the zero tick but PAST the gap from the
  // last nonzero event at 2000 → fresh → v → passthrough. (If zero ticks
  // extended the gesture, this would still be h-locked and consumed.)
  assert.equal(s.route(wheel({ deltaX: -4, deltaY: 10 }), false, 2000 + 180 + WHEEL_GESTURE_GAP_MS).consumed, false);
});

test('WheelGestureRouter: deltaMode-normalized classification — a line-mode stream locks and routes like its pixel equivalent', () => {
  // (e) classification and routing happen on wheelDeltaToPixels-normalized
  // deltas: a Firefox line-mode wheel stream behaves exactly like the
  // pixel-mode stream it converts to (lineHeight 16).
  const r = new WheelGestureRouter();
  assert.deepEqual(r.route(wheel({ deltaX: -2, deltaY: 1, deltaMode: 1 }), true, 1000), {
    zoomPx: 0,
    panPx: -32,
    laneScrollPx: 16,
    consumed: true,
  });
  // A 1-line pure-vertical tick inside the h gesture: consumed,
  // normalized to 16px — under the 24px flip floor.
  assert.deepEqual(r.route(wheel({ deltaY: 1, deltaMode: 1 }), true, 1016), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 16,
    consumed: true,
  });
  // A 2-line vertical tick normalizes to 32px — over the floor, so it
  // decisively FLIPS the gesture (discrete wheels do not jitter; the
  // thresholds apply to the normalized pixels, not raw line counts).
  assert.equal(r.route(wheel({ deltaY: 2, deltaMode: 1 }), true, 1032).consumed, false);
  // Fresh line-mode vertical-dominant event → 'v' lock, then a line-mode
  // horizontal jitter passes through: same table as pixel mode.
  const v = new WheelGestureRouter();
  assert.equal(v.route(wheel({ deltaY: 3, deltaMode: 1 }), false, 2000).consumed, false);
  assert.equal(v.route(wheel({ deltaX: -1, deltaMode: 1 }), false, 2016).consumed, false, 'line-mode h jitter inside the v gesture');
});

// -- Direction-aware lane scrolling (the nested-scroller contract) ----------------

// The LaneScrollable input form: a vertical wheel scrolls an overflowing
// lane stack IN PLACE while the stack can actually move in the wheel's
// direction, and passes to the page the moment it cannot — so a tall lane
// stack is finally wheel-scrollable AND the page stays reachable past it.
// The legacy boolean form keeps the pinned page-always-wins behavior
// byte-for-byte (every test above this section runs on it, unchanged).

test('routeWheel: direction-aware lanes — a vertical wheel scrolls the stack while it has headroom that way', () => {
  // Parked at the top (headroom below): wheel-down scrolls the stack,
  // wheel-up belongs to the page.
  assert.deepEqual(routeWheel(wheel({ deltaY: 90 }), { up: false, down: true }), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 90,
    consumed: true,
  });
  assert.deepEqual(routeWheel(wheel({ deltaY: -90 }), { up: false, down: true }), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 0,
    consumed: false,
  });
  // Symmetric at the bottom.
  assert.deepEqual(routeWheel(wheel({ deltaY: -90 }), { up: true, down: false }), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: -90,
    consumed: true,
  });
  assert.deepEqual(routeWheel(wheel({ deltaY: 90 }), { up: true, down: false }), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 0,
    consumed: false,
  });
  // No headroom at all (a stack that fits): identical to the boolean
  // form — the page owns every vertical wheel.
  for (const dy of [90, -90]) {
    assert.equal(routeWheel(wheel({ deltaY: dy }), { up: false, down: false }).consumed, false);
  }
  // The consumed-horizontal route's minor-dy nudge keys off OVERFLOW
  // (either direction), exactly like the boolean form — clamping owns the
  // edges inside an already-consumed gesture.
  assert.deepEqual(routeWheel(wheel({ deltaX: -60, deltaY: 4 }), { up: false, down: true }), {
    zoomPx: 0,
    panPx: -60,
    laneScrollPx: 4,
    consumed: true,
  });
  assert.deepEqual(routeWheel(wheel({ deltaX: -60, deltaY: 4 }), { up: false, down: false }), {
    zoomPx: 0,
    panPx: -60,
    laneScrollPx: 0,
    consumed: true,
  });
});

test('WheelGestureRouter: a v gesture latches lane-vs-page from scrollability at lock time', () => {
  // Downward headroom at lock time: the WHOLE gesture belongs to the
  // stack — including after the stack reports its edge mid-gesture
  // (browser-style scroll latching: no mid-swipe handoff jank; the
  // element's clamp owns the edge) — and its horizontal jitter is
  // consumed as lane scroll, never a chart pan.
  const r = new WheelGestureRouter();
  let ts = 1000;
  assert.deepEqual(r.route(wheel({ deltaY: 100 }), { up: false, down: true }, ts), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 100,
    consumed: true,
  });
  ts += 16;
  assert.deepEqual(
    r.route(wheel({ deltaY: 100 }), { up: true, down: false }, ts),
    { zoomPx: 0, panPx: 0, laneScrollPx: 100, consumed: true },
    'edge reached mid-gesture: still latched to the stack',
  );
  ts += 16;
  const jitter = r.route(wheel({ deltaX: -12, deltaY: 5 }), { up: true, down: false }, ts);
  assert.equal(jitter.consumed, true, 'h jitter under the flip floor stays in the lane gesture');
  assert.equal(jitter.panPx, 0);
  assert.equal(jitter.laneScrollPx, 5);
  // After the gesture gap, a fresh wheel-down against the exhausted stack
  // belongs to the page: the page is always reachable past a tall chart.
  ts += WHEEL_GESTURE_GAP_MS + 1;
  assert.deepEqual(r.route(wheel({ deltaY: 100 }), { up: true, down: false }, ts), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 0,
    consumed: false,
  });
  // And a page-latched gesture never grabs the stack mid-stream, even if
  // headroom appears under it (a re-layout mid-scroll): latched until the
  // gap, then the next gesture re-evaluates.
  ts += 16;
  assert.equal(r.route(wheel({ deltaY: 100 }), { up: true, down: true }, ts).consumed, false);
  ts += WHEEL_GESTURE_GAP_MS + 1;
  assert.equal(r.route(wheel({ deltaY: 100 }), { up: true, down: true }, ts).consumed, true, 'fresh gesture takes the now-scrollable stack');
});

test('WheelGestureRouter: a FRESH router equals routeWheel on direction-aware inputs too', () => {
  const scrolls = [
    { up: false, down: false },
    { up: true, down: false },
    { up: false, down: true },
    { up: true, down: true },
  ];
  for (const lanes of scrolls) {
    for (const deltaY of [-90, -1, 0, 1, 90]) {
      for (const deltaX of [0, -4, 120]) {
        const e = wheel({ deltaX, deltaY });
        const fresh = new WheelGestureRouter();
        assert.deepEqual(
          fresh.route(e, lanes, 500),
          routeWheel(e, lanes),
          `dx=${deltaX} dy=${deltaY} lanes=${JSON.stringify(lanes)}`,
        );
      }
    }
  }
});

// -- Now-line x ------------------------------------------------------------------

test('nowLineX: rock-steady while follow-now pins the view (the wiggle regression)', () => {
  // A steady follow pin holds `now` at a fixed span fraction of the RAW
  // view. Across hundreds of frames — while snapViewToDevicePixels keeps
  // re-quantizing the view origin underneath — the snapped now-line x
  // must come out IDENTICAL every frame. (Computing it through the
  // snapped render view instead re-adds the origin's per-frame ±half-px
  // error and flips the rounded x between adjacent device pixels.)
  const span = 15 * 60_000;
  const lead = 0.02;
  const plotW = 990;
  const gutter = 73.4;
  for (const dpr of [1, 1.5, 2, 3]) {
    const xs = new Set<number>();
    for (let f = 0; f < 400; f++) {
      const now = 1_752_000_000_000 + f * 16.7;
      const end = now + span * lead;
      const view = { start: end - span, end };
      xs.add(nowLineX(now, view, gutter, plotW, dpr));
    }
    assert.equal(xs.size, 1, `dpr ${dpr}: expected one constant x, saw ${xs.size}`);
  }
});

test('nowLineX: lands on the half-device-pixel grid (crisp 1px stroke)', () => {
  for (const dpr of [1, 1.5, 2, 3]) {
    const view = { start: 1_000_000, end: 1_900_000 };
    const x = nowLineX(1_400_000, view, 80.25, 987.5, dpr);
    const dev = x * dpr - 0.5;
    assert.ok(Math.abs(dev - Math.round(dev)) < 1e-6, `dpr ${dpr}: ${x} is not on the half-device-px grid`);
  }
});

test('nowLineX: on a parked (static) view the line steps whole device pixels with the clock', () => {
  const view = { start: 0, end: 900_000 };
  const plotW = 900;
  const dpr = 2;
  const msPerDevPx = (view.end - view.start) / (plotW * dpr);
  const x0 = nowLineX(450_000, view, 60, plotW, dpr);
  const x3 = nowLineX(450_000 + 3 * msPerDevPx, view, 60, plotW, dpr);
  assert.ok(Math.abs(x3 - (x0 + 3 / dpr)) < 1e-9, `expected exactly 3 device px of advance, got ${x3 - x0}`);
});

test('nowLineX: degenerate dpr passes the unsnapped x through', () => {
  const view = { start: 0, end: 1000 };
  assert.equal(nowLineX(500, view, 10, 100, 0), 10 + 50);
  assert.equal(nowLineX(500, view, 10, 100, NaN), 10 + 50);
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

test('followAfterGesture: a span change is not a pan — wasFollowing=true stays engaged', () => {
  const now = 1_000_000_000;
  const span = 900_000;
  const end = now + span * FOLLOW_LEAD_FRAC;
  const view: TimeView = { start: end - span, end };
  const zoomed = zoomView(view, end - span / 2, 1.05); // anchor mid-screen: end moves back a bit
  assert.ok(zoomed.end < view.end);
  // The raw end lands well outside the 2-device-px zone — a wasFollowing
  // caller survives anyway (the explicit wasFollowing rule, not the
  // zone). NOTE the element deliberately does NOT pass wasFollowing for
  // ZOOM gestures anymore (the anchor must win during a zoom — item 9,
  // next tests); this pins the function-level contract for the callers
  // that still do (forward pans at the stop, lane scrolls).
  assert.ok(zoomed.end < now - FOLLOW_SNAP_DEVICE_PX * mppx(zoomed.end - zoomed.start));
  assert.equal(followAfterGesture(true, view.end, zoomed, now, false, mppx(zoomed.end - zoomed.start)), true);
  // The same zoom while NOT following does not grab the pin.
  assert.equal(followAfterGesture(false, view.end, zoomed, now, false, mppx(zoomed.end - zoomed.start)), false);
});

// -- Item 9: the zoom anchor wins over the follow pin --------------------------------
//
// The element applies a zoom gesture as zoomView(view, anchor, f) and —
// because a zoom never inherits the pin — routes it through
// followAfterGesture(false, ...) + clampViewToNow. These tests pin that
// composition: the timestamp under the cursor stays under the cursor,
// and follow is re-earned exactly at the snap boundary.

test('zoom while following: an anchored zoom-in parks with the timestamp under the cursor intact', () => {
  const now = 1_000_000_000;
  const span = 900_000;
  const plotW = 1000;
  // Steady-state pinned view: end = now + lead.
  const end = now + span * FOLLOW_LEAD_FRAC;
  const view: TimeView = { start: end - span, end };
  // Cursor a third of the plot from the left.
  const anchor = view.start + span / 3;
  const zoomed = zoomView(view, anchor, 2);
  // The anchor invariant across the zoom application itself.
  assert.ok(Math.abs((anchor - zoomed.start) / (zoomed.end - zoomed.start) - 1 / 3) < 1e-9);
  // A zoom is passed wasFollowing=false → the snap rule decides: the end
  // left the zone, so the view parks…
  const zSpan = zoomed.end - zoomed.start;
  assert.equal(followAfterGesture(false, view.end, zoomed, now, false, mppx(zSpan, plotW)), false);
  // …and the parked application (the disengaged branch clamps at now once
  // the lead is consumed) does not move it: the anchor survives end-to-end.
  assert.deepEqual(clampViewToNow(zoomed, now), zoomed);
});

test('zoom while following: follow is re-earned exactly at the snap boundary (both sides)', () => {
  const now = 1_000_000_000;
  const span = 900_000;
  const plotW = 1000;
  const view: TimeView = { start: now - span, end: now };
  const frac = 1 / 3;
  const anchor = view.start + span * frac;
  // Solve the zoom factor that lands the right edge exactly k device px
  // short of now — measured at the ZOOMED span's scale, because that is
  // the msPerDevPx the element hands the rule: with W device px across
  // the plot, end' = anchor + (1 - frac) * span' = now - k * span' / W
  // → span' = (now - anchor) / (1 - frac + k / W).
  const W = plotW; // dpr 1
  const spanFor = (k: number) => (now - anchor) / (1 - frac + k / W);
  for (const [k, engaged] of [
    [FOLLOW_SNAP_DEVICE_PX, true],
    [FOLLOW_SNAP_DEVICE_PX + 1, false],
  ] as const) {
    const zoomed = zoomView(view, anchor, span / spanFor(k));
    assert.ok(Math.abs(zoomed.end - (now - (k * spanFor(k)) / W)) < 1e-6);
    // The anchor held even for this hair's-width zoom…
    assert.ok(Math.abs((anchor - zoomed.start) / (zoomed.end - zoomed.start) - frac) < 1e-9);
    // …and the snap rule alone decides whether follow re-engages. (The
    // zone is measured at the ZOOMED span's scale, like the element does.)
    const zSpan = zoomed.end - zoomed.start;
    assert.equal(
      followAfterGesture(false, view.end, zoomed, now, false, mppx(zSpan, plotW)),
      engaged,
      `${k} device px short of now`,
    );
  }
});

test('zoom-out pressing into the end stop re-engages: the stop, not the anchor, wins at the wall', () => {
  const now = 1_000_000_000;
  const span = 900_000;
  const plotW = 1000;
  const end = now + span * FOLLOW_LEAD_FRAC;
  const view: TimeView = { start: end - span, end };
  const anchor = view.start + span / 3;
  const zoomedOut = zoomView(view, anchor, 1 / 2);
  // Preserving the anchor on a zoom-out at the live edge would show the
  // future — the raw end overshoots now…
  assert.ok(zoomedOut.end > now);
  // …so the one-sided snap rule re-engages follow (the pin then holds the
  // right edge at the stop: a zoom-out at the wall is right-anchored,
  // exactly like a parked zoom-out clamping at now).
  const zSpan = zoomedOut.end - zoomedOut.start;
  assert.equal(followAfterGesture(false, view.end, zoomedOut, now, false, mppx(zSpan, plotW)), true);
  // The parked-mode equivalent: the clamp right-anchors the same view.
  const clamped = clampViewToNow(zoomedOut, now);
  assert.equal(clamped.end, now);
  assert.equal(clamped.end - clamped.start, zSpan);
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

// -- Follow-lead easing (engage/disengage/jump glide, never teleport) ---------------------

const FRAME_MS = 1000 / 60;
/** Max per-frame lead change the easeOutQuad tween can produce (its slope peaks at t=0). */
const easeStepBound = (dist: number, dt: number, tween: number): number => Math.abs(dist) * 2 * (dt / tween);

test('gestureLeadFrac: a gesture consumes lead or parks behind now — never mints lead', () => {
  const now = 1_000_000_000;
  const span = 900_000;
  // Parked exactly at the stop: zero lead.
  assert.equal(gestureLeadFrac(now, now, span, 0), 0);
  // Parked 2 device px short (a 1000-px plot): a tiny NEGATIVE seed.
  const twoPx = 2 * mppx(span);
  const short = gestureLeadFrac(now - twoPx, now, span, 0);
  assert.ok(short < 0 && short > -0.01, `2 px short seeds slightly negative (${short})`);
  // A raw overshoot past the ceiling is capped at the lead already held.
  assert.equal(gestureLeadFrac(now + span, now, span, FOLLOW_LEAD_FRAC), FOLLOW_LEAD_FRAC);
  assert.equal(gestureLeadFrac(now + span, now, span, 0), 0);
  // Deep in the past (jump-to-now seed): deeply negative, uncapped below.
  assert.equal(gestureLeadFrac(now - 10 * span, now, span, 0), -10);
  // Degenerate span never yields a positive lead.
  assert.equal(gestureLeadFrac(now + 5, now, 0, FOLLOW_LEAD_FRAC), 0);
});

test('followLeadAt: engage starts from the parked end and monotonically approaches the lead — no overshoot, exact landing', () => {
  const from = 0; // the qualifying gesture parked at end = now
  let prev = from;
  assert.equal(followLeadAt(from, FOLLOW_LEAD_FRAC, 0, FOLLOW_LEAD_TWEEN_MS), from, 'frame 0 IS the parked position');
  for (let t = 1; t <= FOLLOW_LEAD_TWEEN_MS + 50; t += 1) {
    const v = followLeadAt(from, FOLLOW_LEAD_FRAC, t, FOLLOW_LEAD_TWEEN_MS);
    assert.ok(v >= prev, `monotone at t=${t}`);
    assert.ok(v <= FOLLOW_LEAD_FRAC, `no overshoot at t=${t}`);
    prev = v;
  }
  assert.equal(followLeadAt(from, FOLLOW_LEAD_FRAC, FOLLOW_LEAD_TWEEN_MS, FOLLOW_LEAD_TWEEN_MS), FOLLOW_LEAD_FRAC, 'lands EXACTLY on the lead');
});

test('engage: per-frame view displacement is bounded by the easing step — never the one-frame lead teleport', () => {
  const span = 900_000;
  const now0 = 1_000_000_000;
  // The element's per-tick pin while following: end = now + span * lead(t).
  const endAt = (t: number): number => now0 + t + span * followLeadAt(0, FOLLOW_LEAD_FRAC, t, FOLLOW_LEAD_TWEEN_MS);
  assert.equal(endAt(0), now0, 'the engaging frame leaves the view where the gesture parked');
  const teleport = span * FOLLOW_LEAD_FRAC; // what the instant assignment used to move in ONE frame
  const bound = easeStepBound(FOLLOW_LEAD_FRAC * span, FRAME_MS, FOLLOW_LEAD_TWEEN_MS);
  let maxStep = 0;
  for (let t = FRAME_MS; t <= FOLLOW_LEAD_TWEEN_MS + 3 * FRAME_MS; t += FRAME_MS) {
    const step = endAt(t) - endAt(t - FRAME_MS) - FRAME_MS; // minus the natural follow drift (now advanced)
    assert.ok(step >= -1e-6, `never moves backward while engaging (t=${t})`);
    assert.ok(step <= bound + 1e-6, `t=${t}: easing step ${step} within bound ${bound}`);
    maxStep = Math.max(maxStep, step);
  }
  assert.ok(maxStep < teleport / 4, `max per-frame step ${maxStep}ms is a fraction of the old ${teleport}ms teleport`);
  // Steady state after the tween: the pin is EXACTLY the old end = now + span * FOLLOW_LEAD_FRAC.
  const t = 10 * FOLLOW_LEAD_TWEEN_MS;
  assert.equal(endAt(t), now0 + t + span * FOLLOW_LEAD_FRAC);
});

test('disengage: a backward wheel sequence consumes the lead — no frame moves more than the user delta + easing step', () => {
  const span = 900_000;
  const tween = FOLLOW_LEAD_TWEEN_MS;
  let now = 1_000_000_000;
  // Steady follow.
  let lead = FOLLOW_LEAD_FRAC;
  let view: TimeView = { start: now + span * lead - span, end: now + span * lead };
  // Backward wheel ticks (~1/3 of the lead each), 3 frames apart — the
  // recording's disengage gesture shape.
  const deltas = [6_000, 6_000, 6_000, 6_000];
  let glide: { from: number; start: number } | null = null;
  let following = true;
  let tickIdx = 0;
  let t = 0;
  const leadAt = (tt: number): number => (glide ? followLeadAt(glide.from, 0, tt - glide.start, tween) : lead);
  for (let frame = 0; frame < 60; frame++) {
    const prevEnd = view.end;
    let userDelta = 0;
    t += FRAME_MS;
    now += FRAME_MS;
    // The element's per-frame step: pin while following, decay when not.
    if (following) {
      view = { start: now + span * lead - span, end: now + span * lead };
    } else {
      const ceil = now + span * leadAt(t);
      if (view.end > ceil) view = { start: ceil - span, end: ceil };
    }
    // A wheel tick lands every 3rd frame while any remain (applyUserView).
    if (frame % 3 === 2 && tickIdx < deltas.length) {
      userDelta = deltas[tickIdx++];
      const next = panView(view, -userDelta);
      if (following) {
        assert.equal(followAfterGesture(true, view.end, next, now, true, mppx(span)), false, 'backward pan disengages');
        following = false;
        const residual = Math.max(0, gestureLeadFrac(next.end, now, span, lead));
        glide = { from: residual, start: t };
        view = clampViewToNow(next, now + span * residual);
        assert.equal(view.end, next.end, "the disengaging tick moves EXACTLY the user's own delta — no lead collapse");
      } else {
        view = clampViewToNow(next, now + span * leadAt(t));
        assert.equal(view.end, next.end, 'later backward ticks stay pure user motion');
      }
    }
    const moved = prevEnd - view.end; // backward displacement this frame
    const easing = easeStepBound((glide ? glide.from : lead) * span, FRAME_MS, tween);
    // Forward motion is only ever the natural follow drift (now advancing
    // while still pinned) — once disengaged the view NEVER moves forward.
    assert.ok(moved >= (following ? -FRAME_MS : 0) - 1e-6, `frame ${frame}: view never jumps FORWARD while disengaging`);
    assert.ok(moved <= userDelta + easing + 1e-6, `frame ${frame}: moved ${moved}ms > user ${userDelta}ms + easing ${easing}ms`);
  }
  assert.equal(following, false);
  assert.ok(view.end <= now, 'the lead is fully consumed — the parked view is back behind now');
});

test('jumpToNow: the pill GLIDES from wherever you are and reaches the followed state exactly', () => {
  const span = 900_000;
  const now0 = 1_000_000_000;
  const parkedEnd = now0 - 10 * span; // deep in the past
  const from = gestureLeadFrac(parkedEnd, now0, span, 0);
  assert.equal(from, -10);
  const endAt = (t: number): number => now0 + t + span * followLeadAt(from, FOLLOW_LEAD_FRAC, t, JUMP_TO_NOW_TWEEN_MS);
  assert.equal(endAt(0), parkedEnd, 'the jump frame leaves the view where it was — no teleport');
  let prev = endAt(0);
  let movingFrames = 0;
  for (let t = FRAME_MS; t <= JUMP_TO_NOW_TWEEN_MS + FRAME_MS; t += FRAME_MS) {
    const e = endAt(Math.min(t, JUMP_TO_NOW_TWEEN_MS));
    assert.ok(e >= prev, `glides monotonically forward (t=${t})`);
    if (e - prev > FRAME_MS) movingFrames++;
    prev = e;
  }
  assert.ok(movingFrames >= 8, `the travel is spread over many frames (${movingFrames})`);
  const tEnd = JUMP_TO_NOW_TWEEN_MS;
  assert.equal(endAt(tEnd), now0 + tEnd + span * FOLLOW_LEAD_FRAC, 'lands EXACTLY on the followed position (end = now + lead)');
});

test('followLeadAt: reduced motion (non-positive tween) snaps straight to the target', () => {
  for (const tween of [0, -1]) {
    assert.equal(followLeadAt(0, FOLLOW_LEAD_FRAC, 0, tween), FOLLOW_LEAD_FRAC, 'engage snaps');
    assert.equal(followLeadAt(FOLLOW_LEAD_FRAC, 0, 0, tween), 0, 'disengage snaps');
    assert.equal(followLeadAt(-10, FOLLOW_LEAD_FRAC, 0, tween), FOLLOW_LEAD_FRAC, 'jump snaps');
  }
});

test('followLeadAt: steady-state follow is unchanged — at/after the tween the pin IS now + span * FOLLOW_LEAD_FRAC', () => {
  // from == target (no transition in flight): every elapsed value is the lead.
  for (const t of [0, 1, FOLLOW_LEAD_TWEEN_MS / 2, FOLLOW_LEAD_TWEEN_MS, 1e6]) {
    assert.equal(followLeadAt(FOLLOW_LEAD_FRAC, FOLLOW_LEAD_FRAC, t, FOLLOW_LEAD_TWEEN_MS), FOLLOW_LEAD_FRAC);
  }
  // And a finished transition parks exactly on the constant.
  assert.equal(followLeadAt(0, FOLLOW_LEAD_FRAC, FOLLOW_LEAD_TWEEN_MS + 1, FOLLOW_LEAD_TWEEN_MS), FOLLOW_LEAD_FRAC);
});

// -- Feed staleness (a dead feed must be impossible to misread) -----------------------

test('feedIsStale: trigger timing — fresh within the threshold, stale strictly past it', () => {
  const fresh = 1_000_000_000;
  assert.equal(feedIsStale(fresh, fresh, STALE_AFTER_DEFAULT_MS), false, 'just stamped');
  assert.equal(feedIsStale(fresh + STALE_AFTER_DEFAULT_MS, fresh, STALE_AFTER_DEFAULT_MS), false, 'exactly at the threshold');
  assert.equal(feedIsStale(fresh + STALE_AFTER_DEFAULT_MS + 1, fresh, STALE_AFTER_DEFAULT_MS), true, 'past the threshold');
  // A re-stamp resets the clock.
  assert.equal(feedIsStale(fresh + 60_000, fresh + 55_000, STALE_AFTER_DEFAULT_MS), false);
});

test('feedIsStale: never-fed charts and disabled thresholds are never stale', () => {
  assert.equal(feedIsStale(1e12, null, STALE_AFTER_DEFAULT_MS), false, 'no data ever arrived');
  for (const off of [0, -1, Infinity, NaN]) {
    assert.equal(feedIsStale(1e12, 0, off), false, `threshold ${off} disables staleness`);
  }
});

test('liveEdgeTarget: once stale the edge FREEZES at lastFresh — an ongoing bar can never render past the last vouched timestamp', () => {
  const fresh = 1_000_000_000;
  const after = STALE_AFTER_DEFAULT_MS;
  // While fresh the edge IS the clock (bars advance smoothly).
  assert.equal(liveEdgeTarget(fresh + 2_000, fresh, after), fresh + 2_000);
  // Once stale, no matter how long the feed stays dead, the edge (= the
  // right end of every end=null bar) is pinned at lastFresh: a 5s run
  // whose end never arrived shows 5-ish seconds, not "running forever".
  for (const dead of [after + 1, 60_000, 3_600_000, 86_400_000]) {
    assert.equal(liveEdgeTarget(fresh + dead, fresh, after), fresh);
  }
});

test('stale view pinning: a followed view stops scrolling while the feed is dead', () => {
  const fresh = 1_000_000_000;
  const span = 900_000;
  const after = STALE_AFTER_DEFAULT_MS;
  // The element's follow pin: end = liveEdge + span * lead.
  const pinned = new Set<number>();
  for (let t = after + 1; t < after + 60_000; t += FRAME_MS * 10) {
    pinned.add(liveEdgeTarget(fresh + t, fresh, after) + span * FOLLOW_LEAD_FRAC);
  }
  assert.equal(pinned.size, 1, 'the pinned end is one constant value — the frozen content cannot scroll out of view');
});

test('stale onset: the live edge RETRACTS to lastFresh as a bounded glide, not a one-frame teleport', () => {
  const fresh = 1_000_000_000;
  const after = STALE_AFTER_DEFAULT_MS;
  const from = fresh + after; // where the edge had extrapolated to when staleness was detected
  let prev = from;
  for (let t = FRAME_MS; t <= JUMP_TO_NOW_TWEEN_MS; t += FRAME_MS) {
    const e = followLeadAt(from, fresh, Math.min(t, JUMP_TO_NOW_TWEEN_MS), JUMP_TO_NOW_TWEEN_MS);
    assert.ok(e <= prev, 'retracts monotonically');
    assert.ok(e >= fresh, 'never overshoots below the vouched timestamp');
    const step = prev - e;
    assert.ok(step <= (after * 2 * FRAME_MS) / JUMP_TO_NOW_TWEEN_MS + 1e-6, `bounded step (${step}ms)`);
    prev = e;
  }
  assert.equal(prev, fresh, 'lands exactly on lastFresh');
});

test('stale recovery: the edge glides from the frozen point to the LIVE clock and the follow pin composes — no teleport', () => {
  const fresh = 1_000_000_000;
  const span = 900_000;
  const outage = 45_000; // the feed was dead 45s; markFresh arrives now
  const recoverAt = fresh + outage;
  const gap = outage; // distance the edge must travel (frozen at fresh, clock at recoverAt)
  let prevEnd = fresh + span * FOLLOW_LEAD_FRAC; // the frozen followed view
  for (let t = FRAME_MS; ; t += FRAME_MS) {
    const e = Math.min(t, JUMP_TO_NOW_TWEEN_MS);
    const clock = recoverAt + t; // real now keeps advancing during the glide
    const edge = followLeadAt(fresh, clock, e, JUMP_TO_NOW_TWEEN_MS);
    const end = edge + span * FOLLOW_LEAD_FRAC; // the element's follow pin
    const step = end - prevEnd;
    assert.ok(step >= -1e-6, 'the view only moves forward during recovery');
    assert.ok(step <= ((gap + JUMP_TO_NOW_TWEEN_MS + FRAME_MS) * 2 * FRAME_MS) / JUMP_TO_NOW_TWEEN_MS + FRAME_MS + 1e-6, 'bounded easing step');
    prevEnd = end;
    if (t >= JUMP_TO_NOW_TWEEN_MS) {
      assert.equal(edge, clock, 'the edge lands exactly on the live clock');
      assert.equal(end, clock + span * FOLLOW_LEAD_FRAC, 'the followed view is back to steady state');
      break;
    }
  }
});

test('stale transitions: reduced motion snaps the edge (tween 0)', () => {
  const fresh = 1_000_000_000;
  assert.equal(followLeadAt(fresh + STALE_AFTER_DEFAULT_MS, fresh, 0, 0), fresh, 'onset snaps to lastFresh');
  assert.equal(followLeadAt(fresh, fresh + 45_000, 0, 0), fresh + 45_000, 'recovery snaps to the clock');
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

test('snapTextOrigin: lands on whole device pixels at any dpr, moving at most half a device px', () => {
  assert.equal(snapTextOrigin(10.3, 1), 10);
  assert.equal(snapTextOrigin(10.6, 1), 11);
  assert.equal(snapTextOrigin(10.3, 2), 10.5); // 20.6 device px → 21
  assert.equal(snapTextOrigin(11.5, 2), 11.5); // already on the grid
  for (const dpr of [1, 2, 3]) {
    for (const v of [0, 3.7, 11.5, 123.49, 999.99]) {
      const snapped = snapTextOrigin(v, dpr);
      const dev = snapped * dpr;
      assert.ok(Math.abs(dev - Math.round(dev)) < 1e-9, `dpr ${dpr}: ${v} → integer device px`);
      assert.ok(Math.abs(snapped - v) <= 0.5 / dpr + 1e-9, `dpr ${dpr}: ${v} moved ≤ half a device px`);
      assert.equal(snapTextOrigin(snapped, dpr), snapped, `dpr ${dpr}: idempotent`);
    }
  }
});

test('snapTextOrigin: degenerate inputs pass through', () => {
  assert.ok(Number.isNaN(snapTextOrigin(NaN, 2)));
  assert.equal(snapTextOrigin(5.4, 0), 5.4);
  assert.equal(snapTextOrigin(5.4, -1), 5.4);
  assert.equal(snapTextOrigin(Infinity, 2), Infinity);
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

// -- Edge continuation (the clipped-span fade) --------------------------------------------

test('edgeContinuation: clipped ends are flagged; fully visible spans are not', () => {
  // 1000px plot over 600s → 600ms per px.
  const view: TimeView = { start: 600_000, end: 1_200_000 };
  const inside = edgeContinuation(700_000, 900_000, view, 1000, 12);
  assert.deepEqual(inside, { left: false, right: false });
  assert.deepEqual(edgeContinuation(100_000, 900_000, view, 1000, 12), { left: true, right: false });
  assert.deepEqual(edgeContinuation(700_000, 1_500_000, view, 1000, 12), { left: false, right: true });
  assert.deepEqual(edgeContinuation(100_000, 1_500_000, view, 1000, 12), { left: true, right: true });
});

test('edgeContinuation: an end coinciding with the window edge genuinely starts/ends there — no fade', () => {
  const view: TimeView = { start: 600_000, end: 1_200_000 };
  assert.deepEqual(edgeContinuation(view.start, 900_000, view, 1000, 12), { left: false, right: false });
  assert.deepEqual(edgeContinuation(700_000, view.end, view, 1000, 12), { left: false, right: false });
  // …including sub-half-pixel overhangs: the device-pixel view snap can
  // shift an exact edge by up to a pixel, which must not read as
  // continuation. (600ms/px here → half a px = 300ms.)
  assert.deepEqual(edgeContinuation(view.start - 299, 900_000, view, 1000, 12), { left: false, right: false });
  assert.deepEqual(edgeContinuation(700_000, view.end + 299, view, 1000, 12), { left: false, right: false });
  // A real overhang past the slack fades.
  assert.equal(edgeContinuation(view.start - 601, 900_000, view, 1000, 12).left, true);
  assert.equal(edgeContinuation(700_000, view.end + 601, view, 1000, 12).right, true);
});

test('edgeContinuation: a stub not reaching through the fade zone stays a visible stub', () => {
  const view: TimeView = { start: 600_000, end: 1_200_000 }; // 600ms per px
  // Continues far left but only 5px poke in (< 12px zone): fading it
  // would erase it entirely — no fade.
  assert.deepEqual(edgeContinuation(0, view.start + 5 * 600, view, 1000, 12), { left: false, right: false });
  assert.deepEqual(edgeContinuation(view.end - 5 * 600, 9_999_999, view, 1000, 12), { left: false, right: false });
  // Reaching exactly through the zone qualifies.
  assert.equal(edgeContinuation(0, view.start + 12 * 600, view, 1000, 12).left, true);
  assert.equal(edgeContinuation(view.end - 12 * 600, 9_999_999, view, 1000, 12).right, true);
});

test('edgeContinuation: an ongoing bar at the live edge never fades (the caller passes endMs = now, inside the view)', () => {
  const now = 1_150_000;
  const view: TimeView = { start: 600_000, end: 1_200_000 }; // follow lead keeps now < view.end
  assert.deepEqual(edgeContinuation(700_000, now, view, 1000, 12), { left: false, right: false });
});

test('edgeContinuation: degenerate view or plot width flags nothing', () => {
  assert.deepEqual(edgeContinuation(0, 100, { start: 5, end: 5 }, 1000, 12), { left: false, right: false });
  assert.deepEqual(edgeContinuation(0, 100, { start: 0, end: 1000 }, 0, 12), { left: false, right: false });
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

// -- TrackAllocator (sticky rows) --------------------------------------------------------

const ti = (id: string, start: number, end: number | null): PackItem => ({ id, start, end });

test('TrackAllocator: a fresh allocator reproduces the stateless first-fit packer exactly', () => {
  const items = [ti('a', 0, 10), ti('b', 5, 15), ti('c', 12, 20), ti('d', 14, 25), ti('e', 40, 50)];
  for (const view of [
    { start: 0, end: 30 },
    { start: 13, end: 45 },
    { start: 100, end: 200 },
  ]) {
    assert.deepEqual(new TrackAllocator().assign(items, view), packVisibleTracks(items, view));
  }
});

test('TrackAllocator: visible items keep their rows when membership churn would reflow the stateless packer', () => {
  // a leaves the view; the stateless packer then reflows b to track 0 and
  // c to 1 — flipping both rows under the viewer. Sticky keeps them put.
  const items = [ti('a', 0, 10), ti('b', 2, 12), ti('c', 11, 20)];
  const alloc = new TrackAllocator();
  const v1 = alloc.assign(items, { start: 0, end: 15 });
  assert.deepEqual(v1, { tracks: [0, 1, 0], trackCount: 2 }, 'first fill is plain first-fit');
  const v2view = { start: 10.5, end: 25 };
  const stateless = packVisibleTracks(items, v2view);
  assert.deepEqual(stateless.tracks, [-1, 0, 1], 'the stateless packer reshuffles');
  const v2 = alloc.assign(items, v2view);
  assert.deepEqual(v2.tracks, [-1, 1, 0], 'sticky rows: b stays on 1, c stays on 0');
});

test('TrackAllocator: burst-then-shrink — height recovers without moving surviving rows', () => {
  const items = [
    ti('b1', 0, 10),
    ti('b2', 0, 10),
    ti('b3', 0, 10),
    ti('b4', 0, 10),
    ti('b5', 0, 10),
    ti('n1', 30, 40),
    ti('n2', 35, 45),
  ];
  const alloc = new TrackAllocator();
  const wide = alloc.assign(items, { start: 0, end: 50 });
  assert.deepEqual(wide.tracks, [0, 1, 2, 3, 4, 0, 1], 'newcomers fill the freed low tracks');
  assert.equal(wide.trackCount, 5);
  // The burst scrolls off: the lane shrinks to the two visible rows, and
  // neither survivor moves.
  const after = alloc.assign(items, { start: 25, end: 60 });
  assert.deepEqual(after.tracks, [-1, -1, -1, -1, -1, 0, 1]);
  assert.equal(after.trackCount, 2, 'height recovered from 5 tracks to 2');
});

test('TrackAllocator: a returning interval gets its old row back when still free', () => {
  const items = [ti('a', 0, 10), ti('b', 0, 10), ti('c', 0, 10)];
  const alloc = new TrackAllocator();
  assert.deepEqual(alloc.assign(items, { start: 0, end: 20 }).tracks, [0, 1, 2]);
  // Scroll away (nothing visible), then come back: every row is restored.
  assert.deepEqual(alloc.assign(items, { start: 50, end: 60 }).tracks, [-1, -1, -1]);
  assert.equal(alloc.assign(items, { start: 50, end: 60 }).trackCount, 1);
  assert.deepEqual(alloc.assign(items, { start: 0, end: 20 }).tracks, [0, 1, 2]);
});

test('TrackAllocator: a returning interval whose old row is now taken falls to the lowest free one', () => {
  const alloc = new TrackAllocator();
  const a = ti('a', 0, 10);
  const b = ti('b', 0, 60); // long — overlaps a
  assert.deepEqual(alloc.assign([a], { start: 0, end: 20 }).tracks, [0]);
  // a scrolls out; b becomes visible and (new, lowest-free) takes track 0.
  assert.deepEqual(alloc.assign([a, b], { start: 50, end: 60 }).tracks, [-1, 0]);
  // a returns: its remembered track 0 is held by the still-visible b →
  // best-effort memory yields, a takes the lowest free track instead.
  assert.deepEqual(alloc.assign([a, b], { start: 0, end: 60 }).tracks, [1, 0]);
});

test('TrackAllocator: a live arrival at now never displaces existing rows (SSE case)', () => {
  const alloc = new TrackAllocator();
  const a = ti('run-a', 0, null); // ongoing
  const b = ti('run-b', 20, null); // ongoing
  const view = { start: 0, end: 100 };
  assert.deepEqual(alloc.assign([a, b], view).tracks, [0, 1]);
  // A brand-new running interval appears at "now": it stacks on top —
  // the rows already on screen do not move.
  const c = ti('run-c', 60, null);
  const r = alloc.assign([a, b, c], view);
  assert.deepEqual(r.tracks, [0, 1, 2]);
  assert.equal(r.trackCount, 3);
});

test('TrackAllocator: visible same-track items never overlap in time (invariant across sliding views)', () => {
  // Deterministic pseudo-random-ish set: staggered starts and durations.
  const items: PackItem[] = [];
  for (let i = 0; i < 30; i++) {
    const start = (i * 37) % 100;
    items.push(ti(`i${String(i).padStart(2, '0')}`, start, start + 5 + ((i * 13) % 20)));
  }
  const foot = (it: PackItem): { s: number; e: number } => ({ s: it.start, e: Math.max(it.end ?? Infinity, it.start + 1) });
  const alloc = new TrackAllocator();
  for (let t = 0; t <= 80; t += 3.7) {
    const view = { start: t, end: t + 40 };
    const { tracks } = alloc.assign(items, view);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (tracks[i] < 0 || tracks[i] !== tracks[j]) continue;
        const a = foot(items[i]);
        const b = foot(items[j]);
        assert.ok(a.e <= b.s || b.e <= a.s, `view +${t}: ${items[i].id} and ${items[j].id} share track ${tracks[i]} but overlap`);
      }
    }
  }
});

test('TrackAllocator: row memory is LRU-bounded — an evicted id re-packs as new', () => {
  const items = [ti('p', 0, 10), ti('q', 0, 10), ti('r', 0, 10)];
  const remembered = new TrackAllocator(1); // keeps only the most recent id (r)
  remembered.assign(items, { start: 0, end: 20 });
  assert.deepEqual(remembered.assign([ti('r', 0, 10)], { start: 0, end: 20 }).tracks, [2], 'r is remembered');
  const evicted = new TrackAllocator(1);
  evicted.assign(items, { start: 0, end: 20 });
  assert.deepEqual(evicted.assign([ti('q', 0, 10)], { start: 0, end: 20 }).tracks, [0], 'q was evicted → packs as new');
});

test('TrackAllocator: cluster-shaped synthetic ids hold their row across frames (one slot per cluster)', () => {
  // The element packs a ×N cluster as ONE item whose id derives from its
  // first member — as long as that id is stable, the row is too.
  const bar = ti('a-bar', 90, 200);
  const cluster = ti('cluster:run-a', 150, 150); // instant footprint
  const alloc = new TrackAllocator();
  const v1 = alloc.assign([bar, cluster], { start: 80, end: 220 });
  assert.deepEqual(v1.tracks, [0, 1], 'the cluster occupies exactly one slot');
  for (let dt = 5; dt <= 60; dt += 5) {
    const r = alloc.assign([bar, cluster], { start: 80 + dt, end: 220 + dt });
    assert.deepEqual(r.tracks, v1.tracks, `slide +${dt}: neither row hops`);
  }
});

test('TrackAllocator: deterministic — identical call sequences yield identical assignments', () => {
  const items = [ti('a', 0, 30), ti('b', 10, 40), ti('c', 35, 60), ti('d', 50, null)];
  const views = [
    { start: 0, end: 45 },
    { start: 32, end: 70 },
    { start: 100, end: 140 },
    { start: 0, end: 45 },
  ];
  const one = new TrackAllocator();
  const two = new TrackAllocator();
  for (const view of views) {
    assert.deepEqual(one.assign(items, view), two.assign(items, view));
  }
});

test('TrackAllocator: empty input and empty windows collapse to one track', () => {
  const alloc = new TrackAllocator();
  assert.deepEqual(alloc.assign([], { start: 0, end: 10 }), { tracks: [], trackCount: 1 });
  const r = alloc.assign([ti('a', 100, 110)], { start: 0, end: 10 });
  assert.deepEqual(r, { tracks: [-1], trackCount: 1 });
});

// -- Instant clustering --------------------------------------------------------------------

// A zero-duration instant (the skipped-run shape: started == finished).
const pip = (id: string, at: number): PackItem => ({ id, start: at, end: at });

test('clusterInstants: empty and single-instant inputs yield no clusters', () => {
  const view: TimeView = { start: 0, end: 600_000 };
  assert.deepEqual(clusterInstants([], view, 1000), { clusters: [], memberOf: [] });
  const one = clusterInstants([pip('a', 1_000)], view, 1000);
  assert.equal(one.clusters.length, 0, 'a lone pip is not a cluster');
  assert.deepEqual(one.memberOf, [-1]);
});

test('clusterInstants: coincident instants merge into ONE cluster (the lane-height bomb becomes one slot)', () => {
  const items = Array.from({ length: 50 }, (_, i) => pip(`s${String(i).padStart(2, '0')}`, 5_000));
  const r = clusterInstants(items, { start: 0, end: 600_000 }, 1000);
  assert.equal(r.clusters.length, 1);
  assert.equal(r.clusters[0].indices.length, 50);
  assert.deepEqual(r.clusters[0].extent, { start: 5_000, end: 5_000 }, 'coincident members: a point extent');
  assert.ok(r.memberOf.every((m) => m === 0));
});

test('clusterInstants: threshold boundary — a gap exactly at joinPx merges, just past it stays apart', () => {
  // 100_000ms over 1000px → 100ms/px → joinMs = CLUSTER_JOIN_PX * 100.
  const view: TimeView = { start: 0, end: 100_000 };
  const joinMs = CLUSTER_JOIN_PX * 100;
  const at = clusterInstants([pip('a', 10_000), pip('b', 10_000 + joinMs)], view, 1000);
  assert.equal(at.clusters.length, 1, 'exactly at the threshold merges');
  const past = clusterInstants([pip('a', 10_000), pip('b', 10_000 + joinMs + 1)], view, 1000);
  assert.equal(past.clusters.length, 0, 'one ms past it stays apart');
  assert.deepEqual(past.memberOf, [-1, -1]);
});

test('clusterInstants: a transitive chain merges only up to the width cap', () => {
  // 10px apart each (join 12px, cap 24px): a..c fit the cap; d would make
  // the chain 30px wide, so it breaks there instead of dragging d in.
  const view: TimeView = { start: 0, end: 100_000 }; // 100ms/px
  const items = [pip('a', 10_000), pip('b', 11_000), pip('c', 12_000), pip('d', 13_000)];
  const r = clusterInstants(items, view, 1000);
  assert.equal(r.clusters.length, 1);
  assert.deepEqual(r.clusters[0].indices, [0, 1, 2]);
  assert.deepEqual(r.clusters[0].extent, { start: 10_000, end: 12_000 });
  assert.equal(r.memberOf[3], -1, 'the pip past the cap keeps its own timestamp');
});

test('clusterInstants: a dense run stays a ROW of markers at any zoom — never one blob', () => {
  // 4000 instants, 1s apart: over an hour-wide window they are ~0.28px
  // apart, so the un-capped transitive chain swallowed the whole track
  // into ONE cluster and the densely populated lane rendered as a single
  // pip at the midpoint.
  const items = Array.from({ length: 4000 }, (_, i) => pip(`s${String(i).padStart(4, '0')}`, i * 1_000));
  const plotWidth = 1000;
  for (const span of [4_000_000, 40_000_000, 400_000_000]) {
    const view: TimeView = { start: 0, end: span };
    const r = clusterInstants(items, view, plotWidth);
    const msPerPx = span / plotWidth;
    const dataPx = (items[items.length - 1].start - items[0].start) / msPerPx;
    // The run's markers still span its real extent, at roughly one per cap.
    assert.ok(
      r.clusters.length >= Math.floor(dataPx / CLUSTER_MAX_SPAN_PX) - 1,
      `span ${span}: ${r.clusters.length} clusters across ${dataPx.toFixed(1)}px`,
    );
    for (const c of r.clusters) {
      assert.ok(
        (c.extent.end - c.extent.start) / msPerPx <= CLUSTER_MAX_SPAN_PX + 1e-9,
        'no cluster is wider than the cap',
      );
    }
    // Every input is accounted for, and none is displaced by more than
    // half a cap from the marker that represents it.
    const seen = new Set<number>();
    for (const c of r.clusters) for (const i of c.indices) seen.add(i);
    for (let i = 0; i < items.length; i++) {
      const ci = r.memberOf[i];
      assert.equal(ci >= 0, seen.has(i));
      if (ci < 0) continue;
      const mid = (r.clusters[ci].extent.start + r.clusters[ci].extent.end) / 2;
      assert.ok(Math.abs(items[i].start - mid) / msPerPx <= CLUSTER_MAX_SPAN_PX / 2 + 1e-9);
    }
  }
});

test('clusterInstants: bars and ongoing intervals never cluster', () => {
  const view: TimeView = { start: 0, end: 100_000 }; // 100ms/px → instants are < 300ms
  const items: PackItem[] = [
    pip('a', 10_000),
    pip('b', 10_100),
    { id: 'bar', start: 10_000, end: 10_000 + 300 }, // exactly the pip threshold → a bar
    { id: 'live', start: 10_050, end: null }, // ongoing — will grow into a bar
  ];
  const r = clusterInstants(items, view, 1000);
  assert.equal(r.clusters.length, 1);
  assert.deepEqual(r.clusters[0].indices, [0, 1], 'only the two pips merged');
  assert.equal(r.memberOf[2], -1);
  assert.equal(r.memberOf[3], -1);
});

test('clusterInstants: deterministic under input re-ordering (memberOf aligned to input positions)', () => {
  const view: TimeView = { start: 0, end: 100_000 };
  const sorted = [pip('a', 10_000), pip('b', 10_500), pip('x', 50_000), pip('y', 50_200)];
  const shuffled = [sorted[3], sorted[1], sorted[0], sorted[2]];
  const a = clusterInstants(sorted, view, 1000);
  const b = clusterInstants(shuffled, view, 1000);
  assert.equal(a.clusters.length, 2);
  assert.equal(b.clusters.length, 2);
  const memberIds = (items: PackItem[], c: { indices: number[] }): string[] => c.indices.map((i) => items[i].id);
  assert.deepEqual(memberIds(sorted, a.clusters[0]), ['a', 'b']);
  assert.deepEqual(memberIds(shuffled, b.clusters[0]), ['a', 'b'], 'same members, in (start, id) order');
  assert.deepEqual(a.clusters.map((c) => c.extent), b.clusters.map((c) => c.extent));
  assert.equal(b.memberOf[2], 0, 'memberOf refers to INPUT positions');
  assert.equal(b.memberOf[0], 1);
});

test('clusterInstants: pure pans never change membership or extents (translation-invariant)', () => {
  const items = [pip('a', 10_000), pip('b', 10_800), pip('c', 40_000)];
  const span = 100_000;
  const first = clusterInstants(items, { start: 0, end: span }, 1000);
  for (let dt = 0; dt <= 30_000; dt += 1_234.5) {
    const r = clusterInstants(items, { start: dt, end: dt + span }, 1000);
    assert.deepEqual(r, first, `pan +${dt} keeps identical clusters`);
  }
});

test('clusterInstants: zooming in progressively splits clusters until each pip stands alone', () => {
  // Gaps: a↔b 400ms, b↔c 3_600ms.
  const items = [pip('a', 10_000), pip('b', 10_400), pip('c', 14_000)];
  const wide = clusterInstants(items, { start: 0, end: 600_000 }, 1000); // 600ms/px → join 7_200ms
  assert.equal(wide.clusters.length, 1, 'wide: everything is one blob');
  assert.equal(wide.clusters[0].indices.length, 3);
  const mid = clusterInstants(items, { start: 0, end: 60_000 }, 1000); // 60ms/px → join 720ms
  assert.equal(mid.clusters.length, 1, 'mid: only the close pair remains merged');
  assert.deepEqual(mid.clusters[0].indices, [0, 1]);
  assert.equal(mid.memberOf[2], -1);
  const close = clusterInstants(items, { start: 0, end: 10_000 }, 1000); // 10ms/px → join 120ms
  assert.equal(close.clusters.length, 0, 'zoomed in: every pip stands at its true timestamp');
});

test('clusterZoomView: pads the member extent and floors at the minimum span; clicking it splits the cluster', () => {
  const extent = { start: 10_000, end: 10_400 };
  const v = clusterZoomView(extent);
  assert.equal(v.end - v.start, MIN_SPAN_MS, 'a sub-minimum extent floors at MIN_SPAN_MS');
  assert.equal((v.start + v.end) / 2, (extent.start + extent.end) / 2, 'centered on the extent');
  // The zoom is deep enough that the members separate → no cluster left.
  const items = [pip('a', 10_000), pip('b', 10_400)];
  assert.equal(clusterInstants(items, clusterZoomView(extent), 1000).clusters.length, 0);
  // A wide extent fills CLUSTER_ZOOM_FILL_FRAC of the window.
  const big = { start: 0, end: 60_000 };
  const bv = clusterZoomView(big);
  assert.ok(Math.abs((bv.end - bv.start) * CLUSTER_ZOOM_FILL_FRAC - 60_000) < 1e-6);
  // Fully coincident members floor at the minimum span (they can never split).
  const point = clusterZoomView({ start: 5_000, end: 5_000 });
  assert.equal(point.end - point.start, MIN_SPAN_MS);
  assert.equal((point.start + point.end) / 2, 5_000);
});

test('clusterMarkerTime: midpoint while fully visible; slides at a clipped edge; null once nothing is visible', () => {
  const view: TimeView = { start: 0, end: 1_000 };
  // Fully visible: the midpoint, stable.
  assert.equal(clusterMarkerTime({ start: 100, end: 200 }, view, 10), 150);
  // Straddling the left edge: slid to the inset window edge, on-screen.
  assert.equal(clusterMarkerTime({ start: -500, end: 200 }, view, 10), 10);
  // Straddling the right edge: symmetric.
  assert.equal(clusterMarkerTime({ start: 800, end: 1_500 }, view, 10), 990);
  // Entirely outside: no marker.
  assert.equal(clusterMarkerTime({ start: -500, end: -100 }, view, 10), null);
  assert.equal(clusterMarkerTime({ start: 1_100, end: 1_200 }, view, 10), null);
  // A point extent near the edge: margins cross → clamped into the extent.
  assert.equal(clusterMarkerTime({ start: 50, end: 50 }, view, 100), 50);
  // Continuity while panning: the marker never jumps, riding the extent's
  // last visible sliver all the way out.
  let prev = null as number | null;
  for (let s = -400; s <= 200; s += 10) {
    const t = clusterMarkerTime({ start: 100, end: 200 }, { start: s, end: s + 1_000 }, 10);
    assert.ok(t !== null, `visible at pan ${s}`);
    if (prev !== null) assert.ok(Math.abs(t - prev) <= 10 + 1e-9, `pan step moves the marker ≤ the pan step`);
    prev = t;
  }
});

// -- Minimap strip -----------------------------------------------------------------

test('minimapExtent: spans the earliest known start through max(now, latest end); null with no data', () => {
  // No start knowledge of any kind → no extent (the strip hides).
  assert.equal(minimapExtent(null, null, 1_000_000), null);
  // Plain data: earliest interval → now (now past the latest end).
  assert.deepEqual(minimapExtent(500_000, 800_000, 1_000_000), { start: 500_000, end: 1_000_000 });
  // A latest end past now (future-dated terminal) extends the end.
  assert.deepEqual(minimapExtent(500_000, 1_200_000, 1_000_000), { start: 500_000, end: 1_200_000 });
  // Coverage knowledge widens the start: loaded-but-empty history and the
  // exhausted boundary are both part of the overview.
  assert.deepEqual(minimapExtent(500_000, null, 1_000_000, null, 300_000), { start: 300_000, end: 1_000_000 });
  assert.deepEqual(minimapExtent(500_000, null, 1_000_000, 100_000, 300_000), { start: 100_000, end: 1_000_000 });
  // Coverage alone (no intervals) is still an extent.
  assert.deepEqual(minimapExtent(null, null, 1_000_000, null, 700_000), { start: 700_000, end: 1_000_000 });
});

test('minimapExtent: a degenerate/tiny span is padded backward to the minimum', () => {
  // A single instant at "now": pad backward so the strip has a real domain.
  assert.deepEqual(minimapExtent(1_000_000, null, 1_000_000, null, null, 60_000), { start: 940_000, end: 1_000_000 });
  // Just under the pad: widened to exactly the pad, end anchored.
  assert.deepEqual(minimapExtent(999_000, null, 1_000_000, null, null, 60_000), { start: 940_000, end: 1_000_000 });
  // At/above the pad: untouched.
  assert.deepEqual(minimapExtent(940_000, null, 1_000_000, null, null, 60_000), { start: 940_000, end: 1_000_000 });
});

test('minimapWindowRect: maps the view into strip px and crops at the strip edges', () => {
  const extent: TimeView = { start: 0, end: 10_000 };
  // Interior window: exact linear mapping.
  assert.deepEqual(minimapWindowRect({ start: 2_000, end: 6_000 }, extent, 1_000), { x0: 200, x1: 600 });
  // A view hanging past the extent start: CROPPED at 0 (never slid to a
  // lying position), the visible remainder honest.
  assert.deepEqual(minimapWindowRect({ start: -2_000, end: 4_000 }, extent, 1_000), { x0: 0, x1: 400 });
  // Symmetric at the live end.
  assert.deepEqual(minimapWindowRect({ start: 8_000, end: 12_000 }, extent, 1_000), { x0: 800, x1: 1_000 });
  // Degenerate extent/width: the whole strip.
  assert.deepEqual(minimapWindowRect({ start: 0, end: 1 }, { start: 5, end: 5 }, 1_000), { x0: 0, x1: 1_000 });
  assert.deepEqual(minimapWindowRect({ start: 0, end: 1 }, extent, 0), { x0: 0, x1: 0 });
});

test('minimapWindowRect: a tiny window keeps a minimum visual width; fully outside pins a sliver at the nearer edge', () => {
  const extent: TimeView = { start: 0, end: 1_000_000 };
  // A 10-min window on a week-long extent maps under a pixel — expanded
  // around its center to MINIMAP_MIN_WINDOW_PX so it stays grabbable.
  const r = minimapWindowRect({ start: 500_000, end: 500_100 }, extent, 1_000);
  assert.ok(Math.abs(r.x1 - r.x0 - MINIMAP_MIN_WINDOW_PX) < 1e-9, 'expanded to the minimum');
  assert.ok(Math.abs((r.x0 + r.x1) / 2 - 500.05) < 1e-6, 'centered where the window is');
  // Entirely before the extent: a sliver pinned at the left edge.
  assert.deepEqual(minimapWindowRect({ start: -900_000, end: -800_000 }, extent, 1_000), { x0: 0, x1: MINIMAP_MIN_WINDOW_PX });
  // Entirely after: pinned right.
  assert.deepEqual(minimapWindowRect({ start: 2_000_000, end: 2_100_000 }, extent, 1_000), {
    x0: 1_000 - MINIMAP_MIN_WINDOW_PX,
    x1: 1_000,
  });
});

test('minimapHitZone: handles win over the middle, zones reach outside the rect, boundaries exact', () => {
  const rect = { x0: 200, x1: 400 };
  const hit = MINIMAP_HANDLE_HIT_PX;
  // Outside reach: exactly hitPx away is still the handle; just past is not.
  assert.equal(minimapHitZone(200 - hit, rect), 'left-handle');
  assert.equal(minimapHitZone(200 - hit - 0.01, rect), 'before');
  assert.equal(minimapHitZone(400 + hit, rect), 'right-handle');
  assert.equal(minimapHitZone(400 + hit + 0.01, rect), 'after');
  // Inside reach: hitPx into a WIDE window still grabs the handle…
  assert.equal(minimapHitZone(200 + hit, rect), 'left-handle');
  assert.equal(minimapHitZone(400 - hit, rect), 'right-handle');
  // …and past it is the grabbable middle.
  assert.equal(minimapHitZone(200 + hit + 0.01, rect), 'inside');
  assert.equal(minimapHitZone(300, rect), 'inside');
});

test('minimapHitZone: a narrow window keeps a grabbable middle (inside reach shrinks with the window)', () => {
  // 12px window: inside reach shrinks to width/4 = 3px, so the center
  // stays 'inside' instead of the 8px handle zones swallowing it.
  const rect = { x0: 100, x1: 112 };
  assert.equal(minimapHitZone(106, rect), 'inside');
  assert.equal(minimapHitZone(102, rect), 'left-handle');
  assert.equal(minimapHitZone(110, rect), 'right-handle');
  // The width/4 rule keeps the two handle zones disjoint on ANY
  // nonzero-width window — even a 4px one keeps its 2px middle.
  const tiny = { x0: 100, x1: 104 };
  assert.equal(minimapHitZone(101, tiny), 'left-handle');
  assert.equal(minimapHitZone(103, tiny), 'right-handle');
  assert.equal(minimapHitZone(102, tiny), 'inside');
  // Zero-width rect (not producible by minimapWindowRect, but total): the
  // exact edge is the one overlap — the nearer-handle tie goes left.
  assert.equal(minimapHitZone(100, { x0: 100, x1: 100 }), 'left-handle');
});

test('minimapPan: pixel deltas pan at the extent scale; clamps at both extent edges', () => {
  const extent: TimeView = { start: 0, end: 10_000 };
  const view: TimeView = { start: 2_000, end: 4_000 };
  // +100px on a 1000px strip = +10% of the extent = +1000ms.
  assert.deepEqual(minimapPan(view, 100, extent, 1_000), { start: 3_000, end: 5_000 });
  assert.deepEqual(minimapPan(view, -100, extent, 1_000), { start: 1_000, end: 3_000 });
  // Clamped at the extent start (span preserved)…
  assert.deepEqual(minimapPan(view, -500, extent, 1_000), { start: 0, end: 2_000 });
  // …and at the live end.
  assert.deepEqual(minimapPan(view, 900, extent, 1_000), { start: 8_000, end: 10_000 });
  // A window wider than the whole extent pins to the live end.
  assert.deepEqual(minimapPan({ start: -20_000, end: 0 }, 50, extent, 1_000), { start: -10_000, end: 10_000 });
  // Degenerate inputs: unchanged (fresh object, same values).
  assert.deepEqual(minimapPan(view, 100, { start: 5, end: 5 }, 1_000), view);
  assert.deepEqual(minimapPan(view, 100, extent, 0), view);
});

test('minimapResize: each handle drags its edge, clamped to the extent and the span limits', () => {
  const extent: TimeView = { start: 0, end: 100_000 };
  const view: TimeView = { start: 40_000, end: 60_000 };
  // Left handle to x=200 on a 1000px strip → t = 20_000.
  assert.deepEqual(minimapResize(view, 'left', 200, extent, 1_000), { start: 20_000, end: 60_000 });
  // Right handle to x=800 → t = 80_000.
  assert.deepEqual(minimapResize(view, 'right', 800, extent, 1_000), { start: 40_000, end: 80_000 });
  // Pointer past the strip ends clamps to the extent edges.
  assert.deepEqual(minimapResize(view, 'left', -50, extent, 1_000), { start: 0, end: 60_000 });
  assert.deepEqual(minimapResize(view, 'right', 1_500, extent, 1_000), { start: 40_000, end: 100_000 });
  // The span ceiling holds: a huge extent can't stretch a window past MAX_SPAN_MS.
  const wide: TimeView = { start: 0, end: 30 * 86_400_000 };
  const atEnd: TimeView = { start: wide.end - 1_000_000, end: wide.end };
  assert.deepEqual(minimapResize(atEnd, 'left', 0, wide, 1_000), { start: wide.end - MAX_SPAN_MS, end: wide.end });
  // Degenerate extent/width: unchanged.
  assert.deepEqual(minimapResize(view, 'left', 200, { start: 5, end: 5 }, 1_000), view);
});

test('minimapResize: dragging a handle past (or into) the other CLAMPS at the min span — never flips', () => {
  const extent: TimeView = { start: 0, end: 100_000 };
  const view: TimeView = { start: 40_000, end: 60_000 };
  // Left handle dragged way past the right edge: parks at end - MIN_SPAN_MS.
  assert.deepEqual(minimapResize(view, 'left', 900, extent, 1_000), { start: 60_000 - MIN_SPAN_MS, end: 60_000 });
  // Right handle dragged way past the left edge: parks at start + MIN_SPAN_MS.
  assert.deepEqual(minimapResize(view, 'right', 100, extent, 1_000), { start: 40_000, end: 40_000 + MIN_SPAN_MS });
  // The min-span floor wins over the extent clamp near the extent's ends.
  const nearStart: TimeView = { start: 0, end: 1_000 };
  const r = minimapResize(nearStart, 'right', 0, extent, 1_000);
  assert.deepEqual(r, { start: 0, end: MIN_SPAN_MS });
});

test('minimapCenter: centers the window at the clicked time at constant span; extent-clamped', () => {
  const extent: TimeView = { start: 0, end: 10_000 };
  const view: TimeView = { start: 1_000, end: 3_000 };
  assert.deepEqual(minimapCenter(view, 700, extent, 1_000), { start: 6_000, end: 8_000 });
  // Near the edges the window slides inside instead of hanging out.
  assert.deepEqual(minimapCenter(view, 0, extent, 1_000), { start: 0, end: 2_000 });
  assert.deepEqual(minimapCenter(view, 1_000, extent, 1_000), { start: 8_000, end: 10_000 });
  // Degenerate: unchanged.
  assert.deepEqual(minimapCenter(view, 500, extent, 0), view);
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

test('clockDrawBudgetMs: normal zooms render at the plain tier budget', () => {
  // A 10s span over 900px at dpr 1: ~11ms per device pixel — the scene
  // moves at least a pixel per tier frame, so the budget IS the tier's
  // (min(tier fps, px/sec) = tier fps): pre-existing pacing, unchanged.
  const view = { start: 0, end: 10_000 };
  assert.equal(clockDrawBudgetMs(view, 900, 1, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs(view, 900, 2, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs(view, 900, 2, IDLE_BATTERY_FRAME_MS), IDLE_BATTERY_FRAME_MS);
});

test('clockDrawBudgetMs: zoomed OUT widens to the exact per-device-pixel period — no upper cap', () => {
  // 15-min span over a 900px plot at dpr 1: one device pixel per 1000ms.
  const view = { start: 0, end: 900_000 };
  assert.equal(clockDrawBudgetMs(view, 900, 1, IDLE_FRAME_MS), 1000);
  // dpr 2 halves the pixel period (device-pixel space, matching
  // snapViewToDevicePixels).
  assert.equal(clockDrawBudgetMs(view, 900, 2, IDLE_FRAME_MS), 500);
  // A week-long span advances a pixel every ~11 minutes and the budget
  // says exactly that — deliberately NO cap (the retired ~1s clock-wake
  // floor is what read as stuttery stepping; each 1px step now lands
  // precisely when due and intermediate frames would be identical).
  assert.equal(clockDrawBudgetMs({ start: 0, end: 7 * 86_400_000 }, 900, 1, IDLE_FRAME_MS), (7 * 86_400_000) / 900);
});

test('clockDrawBudgetMs: the tier budget is a hard floor — never renders faster than the tier', () => {
  // The ceiling constraint, structurally max(): sweep spans/widths/dprs/
  // budgets — every result is >= the tier budget, and equals it exactly
  // when the per-pixel period fits inside it.
  for (const span of [1_000, 60_000, 900_000, 3_600_000, 7 * 86_400_000]) {
    for (const plotW of [200, 900, 2500]) {
      for (const dpr of [1, 1.5, 2, 3]) {
        for (const budget of [IDLE_FRAME_MS, IDLE_BATTERY_FRAME_MS]) {
          const d = clockDrawBudgetMs({ start: 0, end: span }, plotW, dpr, budget);
          const period = span / (plotW * dpr);
          assert.ok(d >= budget, `span ${span} w ${plotW} dpr ${dpr} budget ${budget}: ${d} < ${budget}`);
          assert.equal(d, Math.max(budget, period));
        }
      }
    }
  }
});

test('clockDrawBudgetMs: monotone in span — zooming out never speeds up the cadence', () => {
  let prev = 0;
  for (const span of [1_000, 10_000, 60_000, 900_000, 3_600_000, 86_400_000]) {
    const d = clockDrawBudgetMs({ start: 0, end: span }, 900, 1, IDLE_FRAME_MS);
    assert.ok(d >= prev, `span ${span}: ${d} < ${prev}`);
    prev = d;
  }
});

test('clockDrawBudgetMs: interactive tier (budget 0) yields the bare px period; degenerate geometry falls back to the tier', () => {
  const view = { start: 0, end: 900_000 };
  // min(display rate, px rate) with an uncapped interactive tier is just
  // the px rate — 1000ms per device pixel here.
  assert.equal(clockDrawBudgetMs(view, 900, 1, 0), 1000);
  // Degenerate inputs: plain tier pacing, never a bogus throttle.
  assert.equal(clockDrawBudgetMs({ start: 5, end: 5 }, 900, 1, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs({ start: 10, end: 0 }, 900, 1, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs(view, 0, 1, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs(view, 900, NaN, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs({ start: NaN, end: 1 }, 900, 1, IDLE_FRAME_MS), IDLE_FRAME_MS);
});

// -- dimColor (the uniform dim transform) ----------------------------------------------

test('dimColor: hue preserved, saturation and value halved', () => {
  // Pure red (h 0, s 1, v 1) → s .5, v .5 → the red-family rgb(128, 64, 64).
  assert.equal(dimColor('#ff0000'), 'rgba(128, 64, 64, 1)');
  // Pure green stays green-dominant at half strength.
  assert.equal(dimColor('rgb(0, 255, 0)'), 'rgba(64, 128, 64, 1)');
});

test('dimColor: greys halve value without inventing hue or saturation', () => {
  assert.equal(dimColor('#808080'), 'rgba(64, 64, 64, 1)');
  assert.equal(dimColor('#ffffff'), 'rgba(128, 128, 128, 1)');
  assert.equal(dimColor('#000000'), 'rgba(0, 0, 0, 1)');
});

test('dimColor: alpha passes through untouched', () => {
  assert.equal(dimColor('rgba(255, 0, 0, 0.4)'), 'rgba(128, 64, 64, 0.4)');
  assert.equal(dimColor('hsla(0, 100%, 50%, 0.25)'), 'rgba(128, 64, 64, 0.25)');
  assert.equal(dimColor('#ff000080'), `rgba(128, 64, 64, ${128 / 255 * 1000 % 1 === 0 ? 128 / 255 : Math.round((128 / 255) * 1000) / 1000})`);
});

test('dimColor: hsl and oklch forms parse; unknown forms pass through', () => {
  assert.equal(dimColor('hsl(120, 100%, 25%)'), 'rgba(32, 64, 32, 1)');
  // oklch pure-red-ish input converts and stays red-dominant.
  const red = dimColor('oklch(0.628 0.258 29.234)');
  const m = red.match(/^rgba\((\d+), (\d+), (\d+), 1\)$/);
  assert.ok(m, `expected rgba() output, got ${red}`);
  assert.ok(Number(m[1]) > Number(m[2]) && Number(m[1]) > Number(m[3]), red);
  // oklch with alpha keeps it.
  assert.match(dimColor('oklch(0.62 0.11 210 / 0.9)'), /^rgba\(\d+, \d+, \d+, 0.9\)$/);
  // Unsupported forms return unchanged (named colors, var() references).
  assert.equal(dimColor('rebeccapurple'), 'rebeccapurple');
  assert.equal(dimColor('var(--x)'), 'var(--x)');
});

test('dimColor: applying to categoryColor output keeps the category hue family', () => {
  // The element feeds resolved category colors through dimColor for
  // dimmed regions — both color modes must round-trip.
  for (const mode of ['oklch', 'hsl'] as const) {
    const base = categoryColor(210, { mode });
    const dimmed = dimColor(base);
    assert.notEqual(dimmed, base);
    assert.match(dimmed, /^rgba\(/);
  }
});

// -- labelHaloColor (guaranteed label legibility) --------------------------------------

test('labelHaloColor: dark halo under a light foreground', () => {
  // The default dark-theme fg — labels are near-white, so the rim is dark.
  assert.equal(labelHaloColor('#e8ecf4'), 'rgba(0, 0, 0, 0.55)');
  assert.equal(labelHaloColor('#ffffff'), 'rgba(0, 0, 0, 0.55)');
  // Mid-grey (relative luminance ≈ 0.216) still contrasts more with black.
  assert.equal(labelHaloColor('#808080'), 'rgba(0, 0, 0, 0.55)');
});

test('labelHaloColor: light halo under a dark foreground (light themes)', () => {
  assert.equal(labelHaloColor('#111318'), 'rgba(255, 255, 255, 0.55)');
  assert.equal(labelHaloColor('#000000'), 'rgba(255, 255, 255, 0.55)');
  // Below the WCAG crossover (relative luminance ≈ 0.179) white wins:
  // #6b6b6b has relative luminance ≈ 0.15.
  assert.equal(labelHaloColor('#6b6b6b'), 'rgba(255, 255, 255, 0.55)');
});

test('labelHaloColor: accepts every parseColor form; alpha in fg is ignored', () => {
  assert.equal(labelHaloColor('rgb(232, 236, 244)'), 'rgba(0, 0, 0, 0.55)');
  assert.equal(labelHaloColor('rgba(232, 236, 244, 0.2)'), 'rgba(0, 0, 0, 0.55)');
  assert.equal(labelHaloColor('hsl(220, 35%, 93%)'), 'rgba(0, 0, 0, 0.55)');
  assert.equal(labelHaloColor('oklch(0.95 0.01 250)'), 'rgba(0, 0, 0, 0.55)');
  assert.equal(labelHaloColor('oklch(0.2 0.02 250)'), 'rgba(255, 255, 255, 0.55)');
});

test('labelHaloColor: unparseable colors fall back to the dark halo', () => {
  // The dark default theme's shape — a var()/named fg keeps a sane rim.
  assert.equal(labelHaloColor('var(--my-fg)'), 'rgba(0, 0, 0, 0.55)');
  assert.equal(labelHaloColor('papayawhip'), 'rgba(0, 0, 0, 0.55)');
});

// -- segmentAtTime (hovered-phase hit refinement) --------------------------------------

// The webhook-runner shape: a dim queue lead-in, a hatched wait, then the
// unsegmented base bar to the end.
const SEG_IV = { start: 0, end: 100_000 };
const SEGS = [
  { start: 0, end: 40_000, kind: 'queued' },
  { start: 40_000, end: 70_000, kind: 'waiting' },
];

test('segmentAtTime: resolves the phase covering t, with index and clamped window', () => {
  assert.deepEqual(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, 10_000), { index: 0, kind: 'queued', start: 0, end: 40_000 });
  assert.deepEqual(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, 55_000), { index: 1, kind: 'waiting', start: 40_000, end: 70_000 });
});

test('segmentAtTime: base bar (no covering phase) and off-bar times resolve to null', () => {
  assert.equal(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, 85_000), null); // past the last phase
  assert.equal(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, -5), null);
  assert.equal(segmentAtTime([], SEG_IV.start, SEG_IV.end, 10), null);
  assert.equal(segmentAtTime(null, SEG_IV.start, SEG_IV.end, 10), null);
  assert.equal(segmentAtTime(undefined, SEG_IV.start, SEG_IV.end, 10), null);
});

test('segmentAtTime: half-open boundaries — a shared edge belongs to the incoming phase', () => {
  assert.equal(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, 40_000)?.kind, 'waiting');
  // The last phase's trailing edge is exclusive too (base bar beyond it).
  assert.equal(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, 70_000), null);
});

test('segmentAtTime: overlaps resolve LAST-painted (draw order overpaints)', () => {
  const overlapping = [
    { start: 0, end: 80_000, kind: 'dim' },
    { start: 50_000, end: 100_000, kind: 'waiting' },
  ];
  assert.equal(segmentAtTime(overlapping, SEG_IV.start, SEG_IV.end, 60_000)?.kind, 'waiting');
  assert.equal(segmentAtTime(overlapping, SEG_IV.start, SEG_IV.end, 20_000)?.kind, 'dim');
});

test('segmentAtTime: null end runs to the interval end, inclusive at the bar\'s last instant', () => {
  const tail = [{ start: 90_000, end: null, kind: 'outline' }];
  assert.deepEqual(segmentAtTime(tail, SEG_IV.start, SEG_IV.end, 95_000), { index: 0, kind: 'outline', start: 90_000, end: 100_000 });
  // t exactly at the interval end still hits the segment ending there.
  assert.equal(segmentAtTime(tail, SEG_IV.start, SEG_IV.end, 100_000)?.kind, 'outline');
  assert.equal(segmentAtTime(tail, SEG_IV.start, SEG_IV.end, 100_001), null);
});

test('segmentAtTime: draw-path clamps — starts floor to the interval, ends cap to it, outside phases skip', () => {
  const segs = [
    { start: -10_000, end: 20_000, kind: 'queued' }, // start clamps to 0
    { start: 60_000, end: 500_000, kind: 'waiting' }, // end caps to the interval
    { start: 150_000, end: 160_000, kind: 'dim' }, // fully outside — never matches
  ];
  assert.deepEqual(segmentAtTime(segs, SEG_IV.start, SEG_IV.end, 5_000), { index: 0, kind: 'queued', start: 0, end: 20_000 });
  assert.deepEqual(segmentAtTime(segs, SEG_IV.start, SEG_IV.end, 99_000), { index: 1, kind: 'waiting', start: 60_000, end: 100_000 });
  assert.equal(segmentAtTime(segs, SEG_IV.start, SEG_IV.end, 30_000), null);
});

test('segmentAtTime: accepts Date phase bounds (toMs like every API edge)', () => {
  const segs = [{ start: new Date(10_000), end: new Date(20_000), kind: 'waiting' }];
  assert.equal(segmentAtTime(segs, SEG_IV.start, SEG_IV.end, 15_000)?.index, 0);
});

// -- fitSpanView (single-span full-width fit) ------------------------------------------

test('fitSpanView: pads the span by the fraction each side (default 0.05)', () => {
  assert.deepEqual(fitSpanView(0, 100_000), { start: -5_000, end: 105_000 });
  assert.deepEqual(fitSpanView(0, 100_000, 0.1), { start: -10_000, end: 110_000 });
  // pad 0 = exact span; a padded window exactly at minSpan is NOT re-centered.
  assert.deepEqual(fitSpanView(0, 100_000, 0), { start: 0, end: 100_000 });
  assert.deepEqual(fitSpanView(0, MIN_SPAN_MS, 0), { start: 0, end: MIN_SPAN_MS });
});

test('fitSpanView: short spans and instants center in the minimum window', () => {
  // 500ms padded (550ms) is under MIN_SPAN_MS — center, never left-anchor.
  assert.deepEqual(fitSpanView(0, 500), { start: 250 - MIN_SPAN_MS / 2, end: 250 + MIN_SPAN_MS / 2 });
  assert.deepEqual(fitSpanView(5_000, 5_000), { start: 5_000 - MIN_SPAN_MS / 2, end: 5_000 + MIN_SPAN_MS / 2 });
});

test('fitSpanView: order-tolerant, Date-tolerant, junk pad falls back to the default', () => {
  assert.deepEqual(fitSpanView(100_000, 0), fitSpanView(0, 100_000));
  assert.deepEqual(fitSpanView(new Date(0), new Date(100_000), 0.05), { start: -5_000, end: 105_000 });
  assert.deepEqual(fitSpanView(0, 100_000, -1), fitSpanView(0, 100_000, 0.05));
  assert.deepEqual(fitSpanView(0, 100_000, Number.NaN), fitSpanView(0, 100_000, 0.05));
});
