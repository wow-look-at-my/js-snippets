// Pure math for the <timeline-view> element: time<->pixel scales, an anchor-preserving zoom.

import type { HitRect } from './hit-test.ts';

// -- Data model ------------------------------------------------------------------

/** A swimlane: one labeled horizontal band of the timeline. */
export interface TimelineLane {
  /** Unique lane id — intervals reference it via `laneId`. */
  id: string;
  /** Text drawn in the left gutter (ellipsized; full text via tooltip). */
  label: string;
  /** Optional grouping key — the default color category for intervals that set none. */
  group?: string;
}

/** A phase within an interval, rendered as a sub-span of the bar. */
export interface TimelineSegment {
  /** Phase start (ms since epoch, or a Date). Clamped into the parent interval. */
  start: number | Date;
  /** Phase end; null/undefined = runs to the parent interval's end. */
  end?: number | Date | null;
  /** Style-map key for this phase (e.g. a built-in like 'dim' or 'hatch'). */
  kind: string;
}

/** One bar on a lane: [start, end] on the shared time axis. */
export interface TimelineInterval {
  /** Unique interval id — connectors reference it, mergeData dedupes on it. */
  id: string;
  /** The lane this interval belongs to. */
  laneId: string;
  /** Start time (ms since epoch, or a Date). */
  start: number | Date;
  /** End time; null/undefined = ongoing (renders to the live "now" edge). */
  end?: number | Date | null;
  /** Text drawn inside the bar when it fits (never overflows the bar). */
  label?: string;
  /** Ordered label fallbacks, fullest → most compact; the widest that fits draws. */
  labelTiers?: string[];
  /** Color key: same category = same hue. Defaults to lane.group, then laneId. */
  category?: string;
  /** Style-map key: rendering treatment (e.g. 'failed', 'dim', 'hatch'). */
  state?: string;
  /** Phases within the bar, each styled via its `kind`. */
  segments?: TimelineSegment[];
  /** The interval this is a SUB-SPAN of. */
  parentId?: string | null;
  /** Opaque consumer payload — echoed back in events and tooltip callbacks. */
  data?: unknown;
}

/** A line between intervals (e.g. a handoff or dependency of the consumer's choosing). */
export interface TimelineConnector {
  fromIntervalId: string;
  toIntervalId: string;
  /** Consumer-defined kind — echoed in events/tooltips. */
  kind?: string;
  /** Tooltip text for the connector. */
  label?: string;
}

/** A vertical time marker across all lanes. */
export interface TimelineMarker {
  time: number | Date;
  label?: string;
  /** 'emphasis' renders in the emphasis color; anything else is muted. */
  kind?: string;
}

/** Accept ms-since-epoch or Date anywhere a time enters the API. */
export function toMs(t: number | Date): number {
  return typeof t === 'number' ? t : t.getTime();
}

// -- Viewport / scale --------------------------------------------------------------

/** A visible time window [start, end] in ms since epoch. */
export interface TimeView {
  start: number;
  end: number;
}

/* */
export const MIN_SPAN_MS = 2_000;
export const MAX_SPAN_MS = 7 * 86_400_000;

/* */
export const DEFAULT_SPAN_REF_MS = 180_000;

/** The container aspect ratio DEFAULT_SPAN_REF_MS is calibrated at. */
const DEFAULT_SPAN_REF_ASPECT = 16 / 9;

/* */
export function defaultSpanForAspect(hostW: number, hostH: number, refSpanMs = DEFAULT_SPAN_REF_MS): number {
  let span = refSpanMs;
  if (Number.isFinite(hostW) && hostW > 0 && Number.isFinite(hostH) && hostH > 0) {
    span = (refSpanMs * (hostW / hostH)) / DEFAULT_SPAN_REF_ASPECT;
  }
  return Math.min(MAX_SPAN_MS, Math.max(MIN_SPAN_MS, span));
}

/* */
export function timeToX(t: number, view: TimeView, width: number): number {
  return ((t - view.start) / (view.end - view.start)) * width;
}

/** x → time for the view (inverse of timeToX). */
export function xToTime(x: number, view: TimeView, width: number): number {
  return view.start + (x / width) * (view.end - view.start);
}

/** Shift the view by dt ms (positive = later). */
export function panView(view: TimeView, dt: number): TimeView {
  return { start: view.start + dt, end: view.end + dt };
}

/** The hard right end stop for user-driven views: the right edge never passes
 * `now` (span preserved; views already at/before now come back unchanged). */
export function clampViewToNow(view: TimeView, now: number): TimeView {
  if (view.end <= now) return view;
  return { start: now - (view.end - view.start), end: now };
}

/** Static scroll bounds: the earliest time the view may start at and the
 * latest it may end at. */
export interface TimeBounds {
  min: number | null;
  max: number | null;
}

/**
 * Clamp a view into `bounds`, preserving its span: a view past `max`
 * shifts back, one before `min` shifts forward. A span WIDER than the
 * bounded range cannot preserve both stops, so it collapses to exactly
 * [min, max] — which is what a zoom-out against a short static window
 * should land on. Null and non-finite sides are ignored, so an unbounded
 * view comes back untouched.
 */
export function clampViewToBounds(view: TimeView, bounds: TimeBounds): TimeView {
  const min = bounds.min !== null && Number.isFinite(bounds.min) ? bounds.min : null;
  const max = bounds.max !== null && Number.isFinite(bounds.max) ? bounds.max : null;
  if (min === null && max === null) return view;
  const span = view.end - view.start;
  if (min !== null && max !== null && max - min <= span) return { start: min, end: max };
  let out = view;
  if (max !== null && out.end > max) out = { start: max - span, end: max };
  if (min !== null && out.start < min) out = { start: min, end: min + span };
  return out;
}

/** The widest span `bounds` can show, for a zoom clamp: the distance between finite stops, else `maxSpan`. Never below `minSpan` — a bounded range narrower than the hard zoom floor still zooms to the floor, and clampViewToBounds then parks that
 * window over the range. */
export function boundedMaxSpan(bounds: TimeBounds, maxSpan = MAX_SPAN_MS, minSpan = MIN_SPAN_MS): number {
  const { min, max } = bounds;
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return maxSpan;
  return Math.max(minSpan, Math.min(maxSpan, max - min));
}

/**
 * Zoom the view by `factor` (> 1 zooms in) keeping `anchor` at the same
 * on-screen fraction — the time under the cursor stays under the cursor.
 * The span is clamped to [minSpan, maxSpan]; clamping preserves the anchor
 * fraction, so the invariant holds even at the clamp.
 */
export function zoomView(
  view: TimeView,
  anchor: number,
  factor: number,
  minSpan = MIN_SPAN_MS,
  maxSpan = MAX_SPAN_MS,
): TimeView {
  const span = view.end - view.start;
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  let next = span / f;
  if (next < minSpan) next = minSpan;
  else if (next > maxSpan) next = maxSpan;
  const frac = span > 0 ? (anchor - view.start) / span : 0.5;
  const start = anchor - frac * next;
  return { start, end: start + next };
}

/**
 * The view that renders ONE span full-width: [start, end] plus `pad`
 * fraction of the span on each side. Spans whose padded window would fall
 * under `minSpan` (instants, sub-second runs) center in a `minSpan`
 * window instead — never left-anchored by a later span clamp. Order- and
 * NaN-tolerant like setViewport (callers still clamp through it).
 */
export function fitSpanView(start: number | Date, end: number | Date, pad = 0.05, minSpan = MIN_SPAN_MS): TimeView {
  const a = toMs(start);
  const b = toMs(end);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const p = Number.isFinite(pad) && pad > 0 ? pad : pad === 0 ? 0 : 0.05;
  const span = hi - lo;
  if (span * (1 + 2 * p) < minSpan) {
    const mid = (lo + hi) / 2;
    return { start: mid - minSpan / 2, end: mid + minSpan / 2 };
  }
  return { start: lo - span * p, end: hi + span * p };
}

/* */
export function wheelDeltaToPixels(delta: number, deltaMode: number, lineHeight = 16, pageHeight = 800): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * lineHeight;
  if (deltaMode === 2) return delta * pageHeight;
  return delta;
}

/** Pixels of zoom wheel per doubling of the scale. */
export const ZOOM_PX_PER_DOUBLE = 260;

/** Continuous exponential zoom factor for a wheel delta in pixels: negative
 * (scroll up / pinch out) zooms in. */
export function zoomFactorForWheel(deltaPx: number): number {
  return Math.pow(2, -deltaPx / ZOOM_PX_PER_DOUBLE);
}

/** The parts of a WheelEvent the gesture router reads. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Where a wheel gesture's energy goes (all deltaMode-normalized pixels). */
export interface WheelRoute {
  /** Zoom (ctrl/meta + wheel), from the vertical delta. */
  zoomPx: number;
  /** Horizontal time pan. */
  panPx: number;
  /** Vertical lane-stack scroll. */
  laneScrollPx: number;
  /** False = the chart takes NOTHING from this event — the caller must not preventDefault. */
  consumed: boolean;
}

/** Direction-aware lane-stack scrollability: whether the stack can move up
 * (toward earlier lanes. */
export interface LaneScrollable {
  up: boolean;
  down: boolean;
}

/** routeWheel/WheelGestureRouter's lane-stack input: the boolean. */
export type LaneScrollInput = boolean | LaneScrollable;

/** Whether the stack overflows at all — gates the minor-dy nudge inside a
 * consumed horizontal gesture (clamping owns the edges there). */
function laneOverflows(lanes: LaneScrollInput): boolean {
  return typeof lanes === 'boolean' ? lanes : lanes.up || lanes.down;
}

/** Whether the stack can take a vertical delta: moves in dy's direction with
 * headroom. */
function laneCanTake(lanes: LaneScrollInput, dy: number): boolean {
  if (typeof lanes === 'boolean') return false;
  if (dy > 0) return lanes.down;
  if (dy < 0) return lanes.up;
  return false;
}

/** Route a wheel/trackpad gesture: ctrl/meta+wheel zooms (always consumed —
 * a pinch stream must never leak browser page-zoom, even on a zero-delta
 * tick); shift+wheel pans time (a vertical wheel pans horizontally);
 * otherwise the DOMINANT axis decides. */
export function routeWheel(e: WheelInput, lanes: LaneScrollInput): WheelRoute {
  const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode);
  const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode);
  if (e.ctrlKey || e.metaKey) return { zoomPx: dy, panPx: 0, laneScrollPx: 0, consumed: true };
  if (e.shiftKey) {
    const pan = dy || dx;
    return { zoomPx: 0, panPx: pan, laneScrollPx: 0, consumed: pan !== 0 };
  }
  if (!(Math.abs(dx) > Math.abs(dy))) {
    if (laneCanTake(lanes, dy)) return { zoomPx: 0, panPx: 0, laneScrollPx: dy, consumed: true };
    return { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false };
  }
  return { zoomPx: 0, panPx: dx, laneScrollPx: laneOverflows(lanes) ? dy : 0, consumed: true };
}

/** Those wheel-routing outcomes, without magnitudes (see classifyWheel). */
export type WheelClass = 'zoom' | 'pan' | 'passthrough';

/** classifyWheel(e): the routing decision without magnitudes. */
export function classifyWheel(e: WheelInput): WheelClass {
  if (e.ctrlKey || e.metaKey) return 'zoom';
  const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode);
  const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode);
  if (e.shiftKey) return (dy || dx) !== 0 ? 'pan' : 'passthrough';
  return Math.abs(dx) > Math.abs(dy) ? 'pan' : 'passthrough';
}

/** Milliseconds of unmodified-wheel silence that ends a gesture. */
export const WHEEL_GESTURE_GAP_MS = 200;

/** Mid-gesture decisive-flip re-lock thresholds: the opposite axis must beat the locked axis by MORE than the ratio AND carry. */
export const WHEEL_AXIS_FLIP_RATIO = 2;
export const WHEEL_AXIS_FLIP_MIN_PX = 24;

/** Stream-level wheel router: routeWheel's per-event table plus a GESTURE AXIS
 * LOCK. */
export class WheelGestureRouter {
  private axis: 'h' | 'v' | null = null;
  /** A 'v'-locked gesture's latched target: true = the lane stack. */
  private vLane = false;
  private lastTs = -Infinity;

  /**
   * Route one event of the stream. `ts` is the event's timestamp in ms
   * on any monotonic clock (e.timeStamp / performance.now()); WheelRoute
   * semantics — `consumed` is the preventDefault contract — are
   * unchanged from routeWheel.
   */
  route(e: WheelInput, lanes: LaneScrollInput, ts: number): WheelRoute {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return routeWheel(e, lanes);
    const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode);
    const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode);
    if (dx === 0 && dy === 0) return { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false };
    if (this.axis === null || ts - this.lastTs > WHEEL_GESTURE_GAP_MS) {
      // Fresh gesture: the per-event dominant-axis rule locks the stream.
      this.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (this.axis === 'v') this.vLane = laneCanTake(lanes, dy);
    } else if (this.axis === 'h' && Math.abs(dy) > WHEEL_AXIS_FLIP_RATIO * Math.abs(dx) && Math.abs(dy) >= WHEEL_AXIS_FLIP_MIN_PX) {
      this.axis = 'v';
      this.vLane = laneCanTake(lanes, dy);
    } else if (this.axis === 'v' && Math.abs(dx) > WHEEL_AXIS_FLIP_RATIO * Math.abs(dy) && Math.abs(dx) >= WHEEL_AXIS_FLIP_MIN_PX) {
      this.axis = 'h';
    }
    this.lastTs = ts;
    if (this.axis === 'v') {
      if (this.vLane) return { zoomPx: 0, panPx: 0, laneScrollPx: dy, consumed: true };
      return { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false };
    }
    return { zoomPx: 0, panPx: dx, laneScrollPx: laneOverflows(lanes) ? dy : 0, consumed: true };
  }
}

// -- Follow-now rule ---------------------------------------------------------------

/** Fraction of the span "now" sits in from the right edge while following. */
export const FOLLOW_LEAD_FRAC = 0.02;
/* */
export const FOLLOW_SNAP_DEVICE_PX = 2;

/** Whether follow-now is engaged after a user-driven viewport change. */
export function followAfterGesture(
  wasFollowing: boolean,
  prevEnd: number,
  next: TimeView,
  now: number,
  isPan: boolean,
  msPerDevicePx: number,
): boolean {
  if (isPan && next.end < prevEnd) return false;
  if (wasFollowing) return true;
  return next.end >= now - FOLLOW_SNAP_DEVICE_PX * (Number.isFinite(msPerDevicePx) && msPerDevicePx > 0 ? msPerDevicePx : 0);
}

// -- Follow-lead easing ---------------------------------------------------------------

/** Duration of the follow-lead ease (ms): engaging follow ramps the lead in from where the gesture parked. */
export const FOLLOW_LEAD_TWEEN_MS = 200;
/** Duration of the jump-to-now glide (ms): fast, deliberate — but continuous. */
export const JUMP_TO_NOW_TWEEN_MS = 250;

/** The eased follow lead `elapsedMs` into a glide from `fromFrac` toward
 * `targetFrac` over `tweenMs`. */
export function followLeadAt(fromFrac: number, targetFrac: number, elapsedMs: number, tweenMs: number): number {
  if (!(tweenMs > 0) || !(elapsedMs < tweenMs)) return targetFrac;
  if (!(elapsedMs > 0)) return fromFrac;
  const p = elapsedMs / tweenMs;
  return fromFrac + (targetFrac - fromFrac) * p * (2 - p);
}

/** The lead fraction a user gesture legitimately holds: its own end relative
 * to `now`. */
export function gestureLeadFrac(endMs: number, now: number, span: number, maxFrac: number): number {
  if (!(span > 0)) return Math.min(0, maxFrac);
  return Math.min((endMs - now) / span, maxFrac);
}

// -- Feed staleness ---------------------------------------------------------------

/** Default ms without fresh data before a live chart declares its feed STALE (the element's `staleAfterMs`). */
export const STALE_AFTER_DEFAULT_MS = 10_000;

/** Whether the live feed is stale: fresh data last arrived at `lastFresh`
 * (null = no data has EVER arrived — an empty chart is never stale) and
 * more than `staleAfterMs` has since passed. */
export function feedIsStale(now: number, lastFresh: number | null, staleAfterMs: number): boolean {
  if (lastFresh === null || !Number.isFinite(staleAfterMs) || staleAfterMs <= 0) return false;
  return now - lastFresh > staleAfterMs;
}

/** The LIVE EDGE every live semantic advances to — ongoing (end = null) bar
 * ends, the now line, the follow-mode pin, and the user-view forward clamp. */
export function liveEdgeTarget(now: number, lastFresh: number | null, staleAfterMs: number): number {
  return feedIsStale(now, lastFresh, staleAfterMs) ? (lastFresh as number) : now;
}

// -- Whole-pixel scrolling ------------------------------------------------------------

/** Snap a view's ORIGIN to the device-pixel grid, span preserved: with the
 * snapped view, any fixed time's x keeps a constant subpixel phase, so a
 * moving viewport translates the whole scene in WHOLE device-pixel steps and
 * bars keep exact relative offsets. This is the place rounding may touch
 * time→x. */
export function snapViewToDevicePixels(view: TimeView, plotWidthCss: number, dpr: number): TimeView {
  const span = view.end - view.start;
  const msPerDevPx = span / (plotWidthCss * dpr);
  if (!Number.isFinite(msPerDevPx) || msPerDevPx <= 0) return view;
  const start = Math.round(view.start / msPerDevPx) * msPerDevPx;
  return { start, end: start + span };
}

/** Snap a CSS-px coordinate to the nearest WHOLE device pixel — for TEXT
 * draw origins only. */
export function snapTextOrigin(v: number, dpr: number): number {
  if (!Number.isFinite(v) || !(dpr > 0)) return v;
  return Math.round(v * dpr) / dpr;
}

/** The now line's x (CSS px, `gutterX` offset included), snapped to the
 * device-pixel grid + half a device px (a crisp 1px stroke). */
export function nowLineX(now: number, view: TimeView, gutterX: number, plotWidthCss: number, dpr: number): number {
  const x = gutterX + timeToX(now, view, plotWidthCss);
  if (!Number.isFinite(x) || !(dpr > 0)) return x;
  return (Math.round(x * dpr) + 0.5) / dpr;
}

// -- Time ticks --------------------------------------------------------------------

/* */
export const TIME_TICK_STEPS: readonly number[] = [
  1, 2, 5, 10, 20, 50, 100, 200, 500,
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
  3_600_000, 7_200_000, 10_800_000, 21_600_000, 43_200_000,
  86_400_000, 172_800_000, 604_800_000,
];

/**
 * The smallest ladder step splitting `span` ms into at most `maxTicks`
 * intervals (the largest step is returned when even it is too fine).
 */
export function timeTickStep(span: number, maxTicks: number): number {
  const max = Math.max(1, maxTicks);
  for (const step of TIME_TICK_STEPS) {
    if (span / step <= max) return step;
  }
  return TIME_TICK_STEPS[TIME_TICK_STEPS.length - 1];
}

/**
 * Tick times within the view on the ladder step for `maxTicks`, aligned so
 * ticks land on round LOCAL times (pass the zone's UTC offset in ms —
 * `-new Date().getTimezoneOffset() * 60000` — so hour/day steps align to
 * local midnight; fixed-offset alignment, DST shifts are not chased).
 */
export function timeTicks(view: TimeView, maxTicks: number, tzOffsetMs = 0): number[] {
  const span = view.end - view.start;
  if (!Number.isFinite(span) || span <= 0) return [];
  const step = timeTickStep(span, maxTicks);
  const first = Math.ceil((view.start + tzOffsetMs) / step) * step - tzOffsetMs;
  const ticks: number[] = [];
  for (let t = first; t <= view.end; t += step) ticks.push(t);
  return ticks;
}

/** Civil date parts for a UTC-shifted timestamp (pure, Date-free). */
interface Civil {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
  dayMs: number; // ms since local midnight
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function civil(t: number, tzOffsetMs: number): Civil {
  const local = t + tzOffsetMs;
  const dayMs = ((local % 86_400_000) + 86_400_000) % 86_400_000;
  const days = Math.floor(local / 86_400_000);
  // Howard Hinnant's civil_from_days.
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1_460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mo = mp < 10 ? mp + 3 : mp - 9;
  return {
    y: mo <= 2 ? y + 1 : y,
    mo,
    d,
    h: Math.floor(dayMs / 3_600_000),
    mi: Math.floor(dayMs / 60_000) % 60,
    s: Math.floor(dayMs / 1_000) % 60,
    ms: dayMs % 1_000,
    dayMs,
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Tick label with granularity matched to the step: sub-second steps show
 * `:SS.mmm`, second steps `HH:MM:SS`, minute/hour steps `HH:MM`, and day+
 * steps `Mon D`. Times are rendered in the zone given by `tzOffsetMs`
 * (see timeTicks). */
export function formatTimeTick(t: number, step: number, tzOffsetMs = 0): string {
  const c = civil(t, tzOffsetMs);
  if (step < 86_400_000 && c.dayMs === 0) return `${MONTHS[c.mo - 1]} ${c.d}`;
  if (step < 1_000) return `:${pad2(c.s)}.${String(c.ms).padStart(3, '0')}`;
  if (step < 60_000) return `${pad2(c.h)}:${pad2(c.mi)}:${pad2(c.s)}`;
  if (step < 86_400_000) return `${pad2(c.h)}:${pad2(c.mi)}`;
  return `${MONTHS[c.mo - 1]} ${c.d}`;
}

/** Full timestamp for tooltips/readouts: `Mon D HH:MM:SS` (+ `.mmm` when withMs). */
export function formatTimeFull(t: number, tzOffsetMs = 0, withMs = false): string {
  const c = civil(t, tzOffsetMs);
  const base = `${MONTHS[c.mo - 1]} ${c.d} ${pad2(c.h)}:${pad2(c.mi)}:${pad2(c.s)}`;
  return withMs ? `${base}.${String(c.ms).padStart(3, '0')}` : base;
}

/**
 * Compact human duration: '—' for non-finite/negative, then 0ms → '0ms',
 * sub-second → 'Nms', sub-minute → 'N.Ns', sub-hour → 'Nm NNs',
 * sub-day → 'Nh NNm', else 'Nd Nh'.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${pad2(Math.round(ms / 1_000) % 60)}s`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ${pad2(Math.floor(ms / 60_000) % 60)}m`;
  return `${Math.floor(ms / 86_400_000)}d ${Math.floor(ms / 3_600_000) % 24}h`;
}

// -- Sub-track packing --------------------------------------------------------------

/** Effective minimum interval footprint used by packing, so coincident zero-length intervals stack. */
export const PACK_MIN_MS = 1;

/** The slice of an interval that packing needs. */
export interface PackItem {
  id: string;
  start: number;
  /** null/undefined = ongoing (blocks its track forever). */
  end?: number | null;
  rows?: number;
}

/** Greedy first-fit interval packing for one lane: returns `tracks[i]` = the
 * sub-track (row within the lane) for items[i], plus the track count. */
export function packTracks(items: readonly PackItem[]): { tracks: number[]; trackCount: number } {
  const order = items.map((_, i) => i);
  order.sort((a, b) => {
    const ia = items[a];
    const ib = items[b];
    return ia.start - ib.start || (ia.id < ib.id ? -1 : ia.id > ib.id ? 1 : 0);
  });
  const tracks = new Array<number>(items.length).fill(0);
  const trackEnds: number[] = [];
  for (const i of order) {
    const it = items[i];
    const rows = packRows(it);
    const t = lowestFit(trackEnds, it.start, rows);
    const end = packEnd(it);
    for (let k = 0; k < rows; k++) trackEnds[t + k] = end;
    tracks[i] = t;
  }
  return { tracks, trackCount: Math.max(1, trackEnds.length) };
}

/** Effective packing footprint end: ongoing blocks forever, instants occupy PACK_MIN_MS. */
function packEnd(it: PackItem): number {
  return Math.max(it.end == null ? Infinity : it.end, it.start + PACK_MIN_MS);
}

function packRows(it: PackItem): number {
  const r = it.rows;
  return r !== undefined && r > 1 ? Math.floor(r) : 1;
}

/**
 * The lowest track t such that tracks t .. t+rows-1 are all free at
 * `start` (a track past the end of `trackEnds` is free). A busy track
 * inside a candidate run moves the candidate past that track.
 */
function lowestFit(trackEnds: readonly number[], start: number, rows: number): number {
  let t = 0;
  for (;;) {
    let k = 0;
    while (k < rows && !(t + k < trackEnds.length && trackEnds[t + k] > start)) k++;
    if (k === rows) return t;
    t += k + 1;
  }
}

/** packTracks over only the items that intersect `view` (a partially visible
 * interval counts; an ongoing one — end null — intersects every window
 * at/after its start). Same deterministic (start, id) ordering and first-fit
 * reuse as packTracks, evaluated over the visible subset only — so one
 * historical parallelism burst stops padding its lane the moment it scrolls
 * out of view. Assignment is a pure function of the visible SET: while the
 * window slides over unchanged overlap, nothing hops tracks. */
export function packVisibleTracks(items: readonly PackItem[], view: TimeView): { tracks: number[]; trackCount: number } {
  const order: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.start <= view.end && packEnd(it) >= view.start) order.push(i);
  }
  order.sort((a, b) => {
    const ia = items[a];
    const ib = items[b];
    return ia.start - ib.start || (ia.id < ib.id ? -1 : ia.id > ib.id ? 1 : 0);
  });
  const tracks = new Array<number>(items.length).fill(-1);
  const trackEnds: number[] = [];
  for (const i of order) {
    const it = items[i];
    const rows = packRows(it);
    const t = lowestFit(trackEnds, it.start, rows);
    const end = packEnd(it);
    for (let k = 0; k < rows; k++) trackEnds[t + k] = end;
    tracks[i] = t;
  }
  return { tracks, trackCount: Math.max(1, trackEnds.length) };
}

/** Bound on remembered id → track assignments per TrackAllocator (LRU eviction beyond it). */
export const TRACK_MEMORY_CAP = 2048;

/** STICKY sub-track allocation for one lane — the STATEFUL counterpart of
 * packVisibleTracks, built so rows stop shifting under the viewer as the
 * visible membership churns (panning, live updates):
 *
 * - An item assigned in the call and still visible KEEPS its
 *   track unconditionally (re-verified against the other keepers, so
 *   even an item whose times were live-edited can never create a
 *   same-track overlap).
 * - An item RETURNING after scrolling out gets its remembered track back
 *   when no visible occupant conflicts — best-effort row memory, bounded
 *   by an LRU cap (`memoryCap`, default TRACK_MEMORY_CAP). */
export class TrackAllocator {
  /** id → last assigned track. Map insertion order doubles as LRU recency. */
  private memory = new Map<string, number>();
  /** ids assigned (visible) by the previous call — their tracks are kept. */
  private live = new Set<string>();
  /** Double-buffer partner for `live` (swapped per call — no Set churn). */
  private liveNext = new Set<string>();
  private cap: number;
  // Per-call scratch, reused across calls (assign runs on the element's layout path).
  private visScratch: number[] = [];
  private returningScratch: number[] = [];
  private freshScratch: number[] = [];
  private placedScratch: number[][] = [];

  constructor(memoryCap = TRACK_MEMORY_CAP) {
    this.cap = Math.max(1, Math.floor(memoryCap));
  }

  /** Assign tracks for the items visible in `view` (see the class doc). */
  assign(items: readonly PackItem[], view: TimeView): { tracks: number[]; trackCount: number } {
    const tracks = new Array<number>(items.length).fill(-1);
    const vis = this.visScratch;
    vis.length = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.start <= view.end && packEnd(it) >= view.start) vis.push(i);
    }
    vis.sort((a, b) => {
      const ia = items[a];
      const ib = items[b];
      return ia.start - ib.start || (ia.id < ib.id ? -1 : ia.id > ib.id ? 1 : 0);
    });
    // Per-track footprints placed THIS call — the only conflict authority.
    const placed = this.placedScratch;
    let placedUsed = 0;
    // A multi-row item (a sub-span family) must fit on EVERY row of its run.
    const canPlace = (t: number, s: number, e: number, rows: number): boolean => {
      for (let r = 0; r < rows; r++) {
        if (t + r >= placedUsed) return true;
        const list = placed[t + r];
        for (let k = 0; k < list.length; k += 2) {
          if (s < list[k + 1] && list[k] < e) return false;
        }
      }
      return true;
    };
    const place = (i: number, t: number): void => {
      tracks[i] = t;
      const rows = packRows(items[i]);
      while (placedUsed < t + rows) {
        const slot = placed[placedUsed] ?? (placed[placedUsed] = []);
        slot.length = 0;
        placedUsed++;
      }
      for (let r = 0; r < rows; r++) placed[t + r].push(items[i].start, packEnd(items[i]));
    };
    const lowestFree = (s: number, e: number, rows: number): number => {
      let t = 0;
      while (!canPlace(t, s, e, rows)) t++;
      return t;
    };
    const returning = this.returningScratch;
    const fresh = this.freshScratch;
    returning.length = 0;
    fresh.length = 0;
    for (let vi = 0; vi < vis.length; vi++) {
      const i = vis[vi];
      const it = items[i];
      const kept = this.live.has(it.id) ? this.memory.get(it.id) : undefined;
      if (kept !== undefined && canPlace(kept, it.start, packEnd(it), packRows(it))) place(i, kept);
      else if (this.memory.has(it.id)) returning.push(i);
      else fresh.push(i);
    }
    for (let ri = 0; ri < returning.length; ri++) {
      const i = returning[ri];
      const it = items[i];
      const end = packEnd(it);
      const rows = packRows(it);
      const remembered = this.memory.get(it.id) as number;
      place(i, canPlace(remembered, it.start, end, rows) ? remembered : lowestFree(it.start, end, rows));
    }
    for (let fi = 0; fi < fresh.length; fi++) {
      const i = fresh[fi];
      const it = items[i];
      place(i, lowestFree(it.start, packEnd(it), packRows(it)));
    }
    // Remember every visible assignment (refreshing LRU recency), then prune the oldest beyond the cap.
    const liveNext = this.liveNext;
    liveNext.clear();
    let maxTrack = -1;
    for (let vi = 0; vi < vis.length; vi++) {
      const i = vis[vi];
      const id = items[i].id;
      liveNext.add(id);
      this.memory.delete(id);
      this.memory.set(id, tracks[i]);
      const last = tracks[i] + packRows(items[i]) - 1;
      if (last > maxTrack) maxTrack = last;
    }
    this.liveNext = this.live;
    this.live = liveNext;
    while (this.memory.size > this.cap) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
    return { tracks, trackCount: Math.max(1, maxTrack + 1) };
  }
}

// -- Sub-spans (families) ------------------------------------------------------------

/** The slice of an interval that parent resolution reads. */
export interface ParentItem {
  id: string;
  parentId?: string | null;
  laneId?: string;
}

/* An item nests only under a parent that exists in `items`, is not itself,
 * and sits in the same lane. A parent cycle is cut at the lowest-index
 * member, so the result is always a forest. Deterministic: ties resolve
 * by input position. */
export function resolveParents(items: readonly ParentItem[]): number[] {
  const idx = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    if (!idx.has(items[i].id)) idx.set(items[i].id, i);
  }
  const parent = new Array<number>(items.length).fill(-1);
  for (let i = 0; i < items.length; i++) {
    const pid = items[i].parentId;
    if (pid == null) continue;
    const p = idx.get(pid);
    if (p === undefined || p === i) continue;
    const a = items[i].laneId;
    const b = items[p].laneId;
    if (a !== undefined && b !== undefined && a !== b) continue;
    parent[i] = p;
  }
  for (let i = 0; i < items.length; i++) {
    let j = parent[i];
    let steps = 0;
    while (j >= 0 && j !== i && steps <= items.length) {
      j = parent[j];
      steps++;
    }
    if (j === i) parent[i] = -1;
  }
  return parent;
}

/** A pack item with its sub-spans, for packFamily. */
export interface PackNode extends PackItem {
  children?: readonly PackNode[] | null;
}

/** packFamily's result: the block's rows and extent, plus each member's row offset from the top. */
export interface FamilyLayout {
  rows: number;
  start: number;
  /** null while the root or any descendant is ongoing. */
  end: number | null;
  tops: Map<string, number>;
  /** Members whose span overlaps an earlier sibling's. A flame chart cannot draw them apart. */
  overlaps: string[];
}

/* A flame chart: a member's row is its depth, so siblings share the row
 * under their parent. Siblings must run one after another. One that
 * overlaps an earlier sibling is drawn on the same row and listed in
 * `overlaps`. The extent is the union of every member. */
export function packFamily(node: PackNode): FamilyLayout {
  const tops = new Map<string, number>();
  tops.set(node.id, 0);
  const overlaps: string[] = [];
  let start = node.start;
  let end: number | null = node.end == null ? null : node.end;
  let ongoing = end === null;
  const children = node.children;
  if (!children || children.length === 0) return { rows: 1, start, end, tops, overlaps };
  let deepest = 0;
  const subs = children.map((c) => ({ c, sub: packFamily(c) }));
  for (const { sub } of subs) {
    if (sub.rows > deepest) deepest = sub.rows;
    if (sub.start < start) start = sub.start;
    if (sub.end === null) ongoing = true;
    else if (end !== null && sub.end > end) end = sub.end;
    for (const [id, t] of sub.tops) tops.set(id, 1 + t);
    overlaps.push(...sub.overlaps);
  }
  subs.sort((a, b) => a.sub.start - b.sub.start);
  let reach = -Infinity;
  for (const { c, sub } of subs) {
    if (sub.start < reach) overlaps.push(c.id);
    reach = Math.max(reach, sub.end ?? Infinity);
  }
  return { rows: 1 + deepest, start, end: ongoing ? null : end, tops, overlaps };
}

// -- Lane layout --------------------------------------------------------------------

/** Vertical metrics for lane layout (CSS px). */
export interface LaneMetrics {
  /** Height of one sub-track's bar row. */
  trackHeight: number;
  /** Vertical gap between sub-tracks within a lane. */
  trackGap: number;
  /** Padding above the first and below the last track of each lane. */
  lanePad: number;
}

/** Computed vertical extents of each lane, in stacked order. */
export interface LaneLayout {
  /* */
  tops: number[];
  /** Height of each lane. */
  heights: number[];
  /** Sum of all lane heights. */
  totalHeight: number;
}

/** Height of one lane given its track count, at `trackHeight` px per track (defaults to the metrics' normal height). Fractional counts are allowed — they drive the
 * lane-height tween. */
export function laneHeight(trackCount: number, m: LaneMetrics, trackHeight = m.trackHeight): number {
  const n = Math.max(1, trackCount);
  return m.lanePad * 2 + n * trackHeight + (n - 1) * m.trackGap;
}

/**
 * Stack lanes vertically: lane height grows with its packed track count.
 * `trackHeights[i]`, when given, overrides the metrics' track height for
 * lane i — how auto-fit renders demoted lanes at the compact height (and
 * how height changes tween: fractional per-lane heights are fine).
 */
export function layoutLanes(trackCounts: readonly number[], m: LaneMetrics, trackHeights?: readonly number[]): LaneLayout {
  const tops: number[] = [];
  const heights: number[] = [];
  let y = 0;
  for (let i = 0; i < trackCounts.length; i++) {
    const h = laneHeight(trackCounts[i], m, trackHeights?.[i] ?? m.trackHeight);
    tops.push(y);
    heights.push(h);
    y += h;
  }
  return { tops, heights, totalHeight: y };
}

/** y offset of a sub-track's top within its lane (per-lane `trackHeight` overrides the metrics'). */
export function trackTop(track: number, m: LaneMetrics, trackHeight = m.trackHeight): number {
  return m.lanePad + track * (trackHeight + m.trackGap);
}

// -- Auto-fit (compact lanes) ----------------------------------------------------------

/** Headroom hysteresis for auto-fit: a demoted lane only re-promotes when the resulting layout would fit with this fraction. */
export const FIT_HYSTERESIS_FRAC = 0.1;

/** Result of computeAutoFit. */
export interface FitResult {
  /** Per lane (input order): true = render ALL of that lane's tracks at the compact height. */
  demoted: boolean[];
  /** Number of demoted lanes — the hysteresis state. Feed it back as `prevDemotedCount` on the next evaluation. */
  count: number;
}

/** The order lanes are demoted to compact in: by visible track count
 * DESCENDING (the tallest / most parallel lane first — one compact tall
 * lane recovers the most height). */
export function demotionOrder(trackCounts: readonly number[]): number[] {
  const order = trackCounts.map((_, i) => i);
  order.sort((a, b) => trackCounts[b] - trackCounts[a] || b - a);
  return order;
}

/** Auto-fit: decide which lanes render at the compact track height so the lane stack fits `availHeight` (the host's plot height). Evaluate with the NATURAL layout (every lane at the normal track height); while it overflows, demote lanes one at a time in demotionOrder() until the total fits or every lane is compact (if all-compact still overflows, the caller's vertical lane scrolling takes over). Demotion applies to a whole lane — all of its tracks go compact together. Deterministic and oscillation-free: the result is a pure function of (track counts, metrics, heights, prevDemotedCount). Between both thresholds the demotion COUNT is kept; the demotion SET is always re-derived from the CURRENT counts, so
 *a lane whose parallelism left the window hands its demotion to the now-tallest lane deterministically. `compactTrackHeight` is clamped to at most the normal track height. */
export function computeAutoFit(
  trackCounts: readonly number[],
  m: LaneMetrics,
  compactTrackHeight: number,
  availHeight: number,
  prevDemotedCount = 0,
  hysteresisFrac = FIT_HYSTERESIS_FRAC,
): FitResult {
  const nLanes = trackCounts.length;
  const demoted = new Array<boolean>(nLanes).fill(false);
  if (nLanes === 0) return { demoted, count: 0 };
  const compact = Math.max(1, Math.min(compactTrackHeight, m.trackHeight));
  const order = demotionOrder(trackCounts);
  const savings = new Array<number>(nLanes);
  let total = 0;
  for (let i = 0; i < nLanes; i++) {
    const hN = laneHeight(trackCounts[i], m);
    total += hN;
    savings[i] = hN - laneHeight(trackCounts[i], m, compact);
  }
  // kMin: fewest demotions (in order) that fit availHeight. kHead: fewest that fit with headroom (>= kMin).
  const headAvail = availHeight * (1 - hysteresisFrac);
  let kMin = total <= availHeight ? 0 : nLanes;
  let kHead = total <= headAvail ? 0 : nLanes;
  let running = total;
  for (let k = 1; k <= nLanes && (kMin === nLanes || kHead === nLanes); k++) {
    running -= savings[order[k - 1]];
    if (kMin === nLanes && running <= availHeight) kMin = k;
    if (kHead === nLanes && running <= headAvail) kHead = k;
  }
  // Hysteresis on the count: demote immediately when overflowing, promote only as far as keeps the headroom.
  const prev = Math.max(0, Math.min(nLanes, Math.floor(prevDemotedCount)));
  const count = prev < kMin ? kMin : prev > kHead ? kHead : prev;
  for (let i = 0; i < count; i++) demoted[order[i]] = true;
  return { demoted, count };
}

// -- Labels / instants ----------------------------------------------------------------

/** Ellipsis used by fitText. */
export const ELLIPSIS = '…';

/**
 * Fit `text` into `availPx` given a (monospace) character width: returns the
 * text unchanged when it fits, an `abc…` truncation when at least `minChars`
 * characters + the ellipsis fit, else '' (suppress the label entirely —
 * never let it spill into a neighboring bar).
 */
export function fitText(text: string, availPx: number, charW: number, minChars = 2): string {
  if (!(charW > 0) || availPx <= 0 || text.length === 0) return '';
  const maxChars = Math.floor(availPx / charW);
  if (text.length <= maxChars) return text;
  if (maxChars - 1 < minChars) return '';
  return text.slice(0, maxChars - 1) + ELLIPSIS;
}

/** Below this rendered width (CSS px) an interval draws as an instant pip, not a bar. */
export const INSTANT_THRESHOLD_PX = 3;

/** True when a bar of `widthPx` should render as an instant pip/diamond. */
export function isInstantWidth(widthPx: number, threshold = INSTANT_THRESHOLD_PX): boolean {
  return widthPx < threshold;
}

/** Minimum rendered width (CSS px) for a real-duration bar — clamped up, never demoted to a pip. */
export const MIN_BAR_PX = 2;

/** Rendered width of [startMs, endMs] mapped through the view's scale,
 * computed from the DURATION alone. */
export function durationWidthPx(startMs: number, endMs: number, view: TimeView, plotWidth: number): number {
  const span = view.end - view.start;
  return span > 0 ? ((endMs - startMs) / span) * plotWidth : 0;
}

/** Which ends of [startMs, endMs] are CLIPPED by the view — the interval's
 * true extent continues off-screen past that edge. Drives the element's
 * edge-continuation shadow. */
export function edgeContinuation(
  startMs: number,
  endMs: number,
  view: TimeView,
  plotWidth: number,
  fadePx: number,
): { left: boolean; right: boolean } {
  const span = view.end - view.start;
  if (!(span > 0) || !(plotWidth > 0)) return { left: false, right: false };
  const eps = span / plotWidth / 2; // half a CSS px, in ms
  return {
    left: startMs < view.start - eps && timeToX(endMs, view, plotWidth) >= fadePx,
    right: endMs > view.end + eps && timeToX(startMs, view, plotWidth) <= plotWidth - fadePx,
  };
}

// -- Instant clustering ----------------------------------------------------------------

/* */
export const CLUSTER_OVERLAP_FRAC = 0.5;

/** Floor on that pitch, in CSS px. */
export const CLUSTER_MIN_PITCH_PX = 3;

/** Default centre-to-centre distance below which instants cannot both be drawn: half a full-size pip. */
export const CLUSTER_PITCH_PX = 12 * CLUSTER_OVERLAP_FRAC;

/** A cluster up to this wide (CSS px) is POINT-LIKE: its members do sit at one spot, so it draws as the ×N stack glyph. */
export const CLUSTER_STACK_MAX_PX = 12;

/** One drawn mark of a spread cluster — the unit it draws, hit-tests and
 * zooms by. */
export interface ClusterMark {
  /** The drawn member's timestamp — never a midpoint, never snapped. */
  time: number;
  /** Half-open range into the cluster's `indices`: this mark's member and the ones it stands for. */
  from: number;
  to: number;
}

/** A group of visually-overlapping instant markers (see clusterInstants). */
export interface InstantCluster {
  /** Indices into the input array, in (start, id) order. */
  indices: number[];
  /** Member start-time extent [first, last] (equal ends when every member is coincident) — the click-to-zoom target (clusterZoomView). */
  extent: TimeRange;
  /** The members THINNED to a drawable pitch, in time order, together covering every member exactly once. */
  marks: ClusterMark[];
}

/** SCALE-AWARE clustering of instant markers: a greedy transitive sweep in time order merges instants whose centers sit within `pitchPx` CSS px of their neighbor at the view's scale — exactly the ones whose pips would overdraw each other — and zooming in progressively splits every cluster until each pip stands at its true timestamp. The chain is maximal: it breaks only at a real gap in the data, never at a width cap, so a cluster is "one visually continuous run of instants" and nothing about it depends on where the sweep started. A run that spans real time is not compacted to a point — it carries `marks`: its members THINNED to `pitchPx`, each at its own true timestamp
 *and each drawn as the pip it always was. Marks are dropped, never merged and never redrawn as some other glyph, so however far out you zoom the run stays a row of separated pips (halve the width, halve the pips) and can never fuse into one shape. The rule and both ways this has been got wrong: docs/timeline/zoom-out-never-merges.md. Only instants participate: an item must be terminal (end != null — an ongoing interval will grow into a bar) with a duration mapping under `instantPx` (the pip threshold) at this scale. Membership depends only on time DELTAS and the scale — never on the viewport's position — so a pure pan can never change clusters (no jitter), and items
 *beyond the view still cluster, so a group scrolls into view already formed. Deterministic under input re-ordering: the sweep runs in (start, id) order and indices refer to input positions. */
export function clusterInstants(
  items: readonly PackItem[],
  view: TimeView,
  plotWidth: number,
  pitchPx = CLUSTER_PITCH_PX,
  instantPx = INSTANT_THRESHOLD_PX,
): { clusters: InstantCluster[]; memberOf: number[] } {
  const memberOf = new Array<number>(items.length).fill(-1);
  const clusters: InstantCluster[] = [];
  const span = view.end - view.start;
  if (!(span > 0) || !(plotWidth > 0)) return { clusters, memberOf };
  const msPerPx = span / plotWidth;
  const pitchMs = Math.max(0, pitchPx) * msPerPx;
  const instantMaxMs = instantPx * msPerPx;
  const order: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.end == null || it.end - it.start >= instantMaxMs) continue;
    order.push(i);
  }
  // The element feeds (start, id)-sorted lane arrays.
  let sorted = true;
  for (let k = 1; k < order.length; k++) {
    const ia = items[order[k - 1]];
    const ib = items[order[k]];
    if (ia.start > ib.start || (ia.start === ib.start && ia.id > ib.id)) {
      sorted = false;
      break;
    }
  }
  if (!sorted) {
    order.sort((a, b) => {
      const ia = items[a];
      const ib = items[b];
      return ia.start - ib.start || (ia.id < ib.id ? -1 : ia.id > ib.id ? 1 : 0);
    });
  }
  // Greedy transitive sweep over `order` as index ranges (no per-bucket array churn — this runs on the layout hot path).
  let bucketStart = 0;
  for (let oi = 0; oi <= order.length; oi++) {
    const boundary = oi === order.length || (oi > bucketStart && items[order[oi]].start - items[order[oi - 1]].start >= pitchMs);
    if (!boundary) continue;
    const len = oi - bucketStart;
    if (len > 1) {
      const indices = new Array<number>(len);
      for (let k = 0; k < len; k++) {
        const idx = order[bucketStart + k];
        indices[k] = idx;
        memberOf[idx] = clusters.length;
      }
      // THIN to the drawable pitch: keep a member only once it clears the last kept one by a whole mark plus its gap.
      const marks: ClusterMark[] = [];
      for (let k = 0; k < len; k++) {
        const t = items[indices[k]].start;
        const last = marks[marks.length - 1];
        if (last !== undefined && t - last.time < pitchMs) continue;
        if (last !== undefined) last.to = k;
        marks.push({ time: t, from: k, to: len });
      }
      clusters.push({
        indices,
        extent: { start: items[indices[0]].start, end: items[indices[len - 1]].start },
        marks,
      });
    }
    bucketStart = oi;
  }
  return { clusters, memberOf };
}

/** Fraction of the zoomed window a clicked cluster's member extent occupies (centered). */
export const CLUSTER_ZOOM_FILL_FRAC = 0.6;

/** The view a cluster click zooms to: the member extent centered, filling
 * CLUSTER_ZOOM_FILL_FRAC of the window, never narrower than `minSpan` —
 * deep enough that the members separate past the join threshold and the
 * cluster SPLITS. */
export function clusterZoomView(extent: TimeRange, minSpan = MIN_SPAN_MS, fillFrac = CLUSTER_ZOOM_FILL_FRAC): TimeView {
  const dur = Math.max(0, extent.end - extent.start);
  const span = Math.max(fillFrac > 0 ? dur / fillFrac : dur, minSpan);
  const mid = (extent.start + extent.end) / 2;
  return { start: mid - span / 2, end: mid + span / 2 };
}

/** Where a cluster's marker sits, in TIME: the extent midpoint while that fits
 * the window, slid along the visible slice of the extent when the window
 * clips it (the sticky-label pattern — a transitive chain straddling a
 * viewport edge keeps an on-screen marker instead of hiding its members'
 * evidence), and null once no part of the extent is visible. `marginMs`
 * insets the slid marker from the window edges (pass the marker radius in ms)
 * so it stays fully visible. */
export function clusterMarkerTime(extent: TimeRange, view: TimeView, marginMs: number): number | null {
  if (extent.end < view.start || extent.start > view.end) return null;
  const mid = (extent.start + extent.end) / 2;
  let lo = Math.max(extent.start, view.start + marginMs);
  let hi = Math.min(extent.end, view.end - marginMs);
  if (lo > hi) {
    // Margins can cross on a tiny window, a near-point extent.
    lo = Math.max(extent.start, view.start);
    hi = Math.min(extent.end, view.end);
  }
  return Math.min(Math.max(mid, lo), hi);
}

// -- Minimap strip ------------------------------------------------------------------

/** Half-width (CSS px) of a minimap handle's hit zone — generously past the drawn bar. */
export const MINIMAP_HANDLE_HIT_PX = 8;
/** Minimum drawn width (CSS px) of the minimap's window rect — a 10-min window on a week-long extent stays visible and grabbable. */
export const MINIMAP_MIN_WINDOW_PX = 6;

/** The minimap window rect's horizontal extent, in strip px. */
export interface MinimapWindowRect {
  x0: number;
  x1: number;
}

/** What a strip x coordinate lands on (see minimapHitZone). */
export type MinimapZone = 'left-handle' | 'right-handle' | 'inside' | 'before' | 'after';

/**
 * The strip's data extent, from what the element knows: the earliest
 * loaded interval start — widened by coverage knowledge where it helps
 * (the first covered time and the exhausted-history boundary both count:
 * loaded-but-empty history and the known start of time are part of the
 * overview) — through max(now, the latest interval end). Null when no
 * start is known at all (nothing loaded — the strip hides). A
 * degenerate/tiny extent is padded backward to `minSpanMs` so the strip
 * never divides by zero and a single instant still reads as a region.
 */
export function minimapExtent(
  earliestStart: number | null,
  latestEnd: number | null,
  now: number,
  exhaustedBefore: number | null = null,
  coveredStart: number | null = null,
  minSpanMs = 60_000,
): TimeView | null {
  let start = Infinity;
  if (earliestStart != null) start = Math.min(start, earliestStart);
  if (coveredStart != null) start = Math.min(start, coveredStart);
  if (exhaustedBefore != null) start = Math.min(start, exhaustedBefore);
  if (!Number.isFinite(start)) return null;
  const end = latestEnd != null && latestEnd > now ? latestEnd : now;
  if (end - start < minSpanMs) start = end - minSpanMs;
  return { start, end };
}

/**
 * Map the viewport into strip px: the window rect, CROPPED to the strip
 * (a view hanging past the extent shows truncated at the strip edge —
 * never slid to a lying position), with a minimum visual width applied
 * around the center BEFORE cropping (a tiny window on a huge extent
 * stays visible); a view entirely outside the extent pins a minimum
 * sliver at the nearer strip edge. Degenerate extent/width yields the
 * full strip.
 */
export function minimapWindowRect(
  view: TimeView,
  extent: TimeView,
  width: number,
  minPx = MINIMAP_MIN_WINDOW_PX,
): MinimapWindowRect {
  if (!(extent.end - extent.start > 0) || !(width > 0)) return { x0: 0, x1: Math.max(0, width) };
  let x0 = timeToX(view.start, extent, width);
  let x1 = timeToX(view.end, extent, width);
  if (x1 - x0 < minPx) {
    const c = (x0 + x1) / 2;
    x0 = c - minPx / 2;
    x1 = c + minPx / 2;
  }
  if (x1 <= 0) return { x0: 0, x1: Math.min(minPx, width) };
  if (x0 >= width) return { x0: Math.max(0, width - minPx), x1: width };
  return { x0: Math.max(0, x0), x1: Math.min(width, x1) };
}

/**
 * Hit-test a strip x against the window rect. Handles win over the
 * middle and their zones reach `hitPx` OUTSIDE the rect (generous grab
 * targets) but only min(hitPx, windowWidth/4) INSIDE it — a narrow
 * window keeps a grabbable middle instead of the handle zones swallowing
 * it. When both handle zones cover x (tiny window), the nearer handle
 * wins (ties go left). Outside everything: 'before'/'after' — the
 * click-to-center zones.
 */
export function minimapHitZone(x: number, rect: MinimapWindowRect, hitPx = MINIMAP_HANDLE_HIT_PX): MinimapZone {
  const inReach = Math.min(hitPx, (rect.x1 - rect.x0) / 4);
  const leftHit = x >= rect.x0 - hitPx && x <= rect.x0 + inReach;
  const rightHit = x >= rect.x1 - inReach && x <= rect.x1 + hitPx;
  if (leftHit && rightHit) return x - rect.x0 <= rect.x1 - x ? 'left-handle' : 'right-handle';
  if (leftHit) return 'left-handle';
  if (rightHit) return 'right-handle';
  if (x > rect.x0 && x < rect.x1) return 'inside';
  return x < rect.x0 ? 'before' : 'after';
}

/** Slide a window fully inside the extent (span preserved; wider-than-extent pins to the live end). */
function clampWindowToExtent(next: TimeView, extent: TimeView): TimeView {
  const span = next.end - next.start;
  if (span >= extent.end - extent.start) return { start: extent.end - span, end: extent.end };
  if (next.start < extent.start) return { start: extent.start, end: extent.start + span };
  if (next.end > extent.end) return { start: extent.end - span, end: extent.end };
  return next;
}

/** Grab-the-middle: pan the window by a pointer delta in strip px, span preserved, clamped inside the extent at both ends (a window wider than the whole extent pins to the extent's live end). */
export function minimapPan(view: TimeView, dxPx: number, extent: TimeView, width: number): TimeView {
  if (!(extent.end - extent.start > 0) || !(width > 0)) return { start: view.start, end: view.end };
  return clampWindowToExtent(panView(view, (dxPx * (extent.end - extent.start)) / width), extent);
}

/**
 * Drag one window edge to the strip x. The dragged edge is clamped to
 * the extent and to [minSpan, maxSpan] against the fixed opposite edge —
 * dragging a handle past (or into) the other CLAMPS at the minimum span,
 * it never flips which edge is which mid-drag. The min-span floor wins
 * over the extent clamp (the window must stay a valid view even inside
 * a tiny extent).
 */
export function minimapResize(
  view: TimeView,
  edge: 'left' | 'right',
  xPx: number,
  extent: TimeView,
  width: number,
  minSpan = MIN_SPAN_MS,
  maxSpan = MAX_SPAN_MS,
): TimeView {
  if (!(extent.end - extent.start > 0) || !(width > 0)) return { start: view.start, end: view.end };
  const t = xToTime(Math.min(Math.max(xPx, 0), width), extent, width);
  if (edge === 'left') {
    const start = Math.min(Math.max(t, extent.start, view.end - maxSpan), view.end - minSpan);
    return { start, end: view.end };
  }
  const end = Math.max(Math.min(t, extent.end, view.start + maxSpan), view.start + minSpan);
  return { start: view.start, end };
}

/** Click outside the window: re-center it at the clicked time, span preserved, extent-clamped like a pan. */
export function minimapCenter(view: TimeView, xPx: number, extent: TimeView, width: number): TimeView {
  if (!(extent.end - extent.start > 0) || !(width > 0)) return { start: view.start, end: view.end };
  const span = view.end - view.start;
  const t = xToTime(Math.min(Math.max(xPx, 0), width), extent, width);
  return clampWindowToExtent({ start: t - span / 2, end: t + span / 2 }, extent);
}

// -- Hit testing (./hit-test.ts) --------------------------------------------------------

export { expandHitRect, hitTestRects, distSqToSegment, hitTestPolyline } from './hit-test.ts';
export type { HitRect } from './hit-test.ts';

/**
 * Route for a connector from the right-center of `from` to the left-center
 * of `to`: a sampled cubic bezier with horizontal control handles, so the
 * line leaves the source rightward and enters the target leftward — a
 * gentle S-curve for forward targets, a readable loop-back for targets that
 * start earlier. Aligned same-row forward targets get a plain 2-point
 * segment. Returns `samples + 1` points (polyline: draw it, hit-test it
 * with hitTestPolyline).
 */
export function connectorRoute(from: HitRect, to: HitRect, samples = 24): { x: number; y: number }[] {
  const x0 = from.x + from.w;
  const y0 = from.y + from.h / 2;
  const x1 = to.x;
  const y1 = to.y + to.h / 2;
  if (Math.abs(y0 - y1) < 0.5 && x1 >= x0) {
    return [
      { x: x0, y: y0 },
      { x: x1, y: y1 },
    ];
  }
  const c = Math.min(90, Math.max(24, Math.abs(x1 - x0) * 0.5, Math.abs(y1 - y0) * 0.35));
  const pts: { x: number; y: number }[] = [];
  const n = Math.max(2, Math.floor(samples));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x: u * u * u * x0 + 3 * u * u * t * (x0 + c) + 3 * u * t * t * (x1 - c) + t * t * t * x1,
      y: u * u * u * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y1 + t * t * t * y1,
    });
  }
  return pts;
}

/** The clamped phase window `segmentAtTime` resolved, with its array index. */
export interface SegmentHit {
  /** Index into the interval's `segments` array. */
  index: number;
  /** The segment's `kind` (style-map key — the legend/tooltip vocabulary). */
  kind: string;
  /** Phase start, clamped into the interval (ms). */
  start: number;
  /** Phase end (null end resolves to `intervalEnd`), clamped (ms). */
  end: number;
}

/** The segment PAINTED at time `t` inside an interval's bar: the LAST array
 * entry covering t (segments draw in order — later overpaints earlier),
 * with the draw path's clamps (start floored to `intervalStart`, null/late
 * end capped to `intervalEnd` — pass the effective end: `end ?? now`).
 * Coverage is half-open [start, end) so shared phase boundaries resolve to
 * the incoming phase, EXCEPT t at the interval's own end still hits a segment
 * ending there (the bar's last pixel must resolve). */
export function segmentAtTime(
  segments: readonly TimelineSegment[] | null | undefined,
  intervalStart: number,
  intervalEnd: number,
  t: number,
): SegmentHit | null {
  if (!segments) return null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    const cs = Math.max(toMs(s.start), intervalStart);
    const ce = Math.min(s.end == null ? intervalEnd : toMs(s.end), intervalEnd);
    if (ce < cs) continue;
    if (t >= cs && (t < ce || (t === ce && ce === intervalEnd))) {
      return { index: i, kind: s.kind, start: cs, end: ce };
    }
  }
  return null;
}

// -- Category color (./color.ts) -------------------------------------------------------

export {
  hashString,
  categoryHue,
  categoryJitter,
  categoryColor,
  dimColor,
  labelHaloColor,
} from './color.ts';
export type { CategoryColorOptions } from './color.ts';

// -- Style map ----------------------------------------------------------------------

/** Fill pattern for an interval state / segment kind. */
export type StylePattern = 'solid' | 'hatch' | 'stipple' | 'outline';

/** Rendering treatment for one interval `state` or segment `kind`. */
export interface IntervalStyle {
  pattern?: StylePattern;
  /* */
  alphaScale?: number;
  /* */
  saturationScale?: number;
  /* */
  lightnessScale?: number;
  /** Border treatment; `emphasis: true` uses the theme emphasis color. */
  border?: { width?: number; dash?: number[]; emphasis?: boolean };
  /** Corner glyph: 'bang' is the unmissable failure mark. */
  glyph?: 'none' | 'bang' | 'dot';
  /* */
  dimmed?: boolean;
}

/** Named style map: interval `state` / segment `kind` → treatment. */
export type StyleMap = Record<string, IntervalStyle>;

/* */
export const DEFAULT_STYLES: StyleMap = {
  '': { pattern: 'solid' },
  emphasis: { pattern: 'stipple', border: { width: 2, emphasis: true }, glyph: 'bang' },
  failed: { pattern: 'stipple', border: { width: 2, emphasis: true }, glyph: 'bang' },
  dim: { pattern: 'solid', dimmed: true },
  queued: { pattern: 'solid', dimmed: true },
  hatch: { pattern: 'hatch', dimmed: true },
  waiting: { pattern: 'hatch', dimmed: true },
  outline: { pattern: 'outline' },
  cancelled: { pattern: 'outline', border: { width: 1.5, dash: [4, 3] } },
};

// -- Coverage / async history ---------------------------------------------------------

/** A half-open-ish time range [start, end] used by coverage bookkeeping. */
export interface TimeRange {
  start: number;
  end: number;
}

/** Merge overlapping/touching ranges into a sorted disjoint list (new array). */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else {
      out.push({ start: r.start, end: r.end });
    }
  }
  return out;
}

/** Subtract a sorted disjoint cover list from `span`, returning the gaps. */
export function subtractRanges(span: TimeRange, covers: readonly TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  let cursor = span.start;
  for (const c of covers) {
    if (c.end <= cursor) continue;
    if (c.start >= span.end) break;
    if (c.start > cursor) out.push({ start: cursor, end: Math.min(c.start, span.end) });
    cursor = Math.max(cursor, c.end);
    if (cursor >= span.end) break;
  }
  if (cursor < span.end) out.push({ start: cursor, end: span.end });
  return out;
}

/** The range a consumer may ask `loadRange` about for this viewport: the
 * visible window plus a little backward prefetch, clamped to `now` AND to the
 * covered end. */
export function historyProbe(view: TimeView, now: number, coveredEnd: number | null, prefetchFrac = 0.15): TimeRange | null {
  const span = view.end - view.start;
  let end = Math.min(view.end, now);
  if (coveredEnd !== null && coveredEnd < end) end = coveredEnd;
  const start = view.start - span * prefetchFrac;
  return end > start ? { start, end } : null;
}

/** Options for CoverageTracker. */
export interface CoverageOptions {
  /* */
  minChunkMs?: number;
  /* */
  retryMs?: number;
}

/** Bookkeeping for `loadRange`-style async history loading. Tracks which time ranges are
 * covered by data the consumer has supplied, which request is in flight (one at a time
 * — no request storms), the exhausted-history boundary, and the fixed retry cadence
 * for rejected loads. const next = tracker.nextRequest(view, now); // range to fetch, or
 * null ...call loadRange(next)... // tracker marked it in flight tracker.settle(next, {
 * ok: true }); // → covered tracker.settle(next, { ok: true, exhausted: true }); //
 * → history ends here tracker.settle(next, { ok: false }); // → retried ~retryMs
 * later, forever */
export class CoverageTracker {
  private covered: TimeRange[] = [];
  private inflight: TimeRange | null = null;
  private minChunk: number;
  private retryEvery: number;
  private retryAt = -Infinity;
  /** Time before which history is known exhausted (null = unknown). */
  exhaustedBefore: number | null = null;

  constructor(opts: CoverageOptions = {}) {
    this.minChunk = opts.minChunkMs ?? 60_000;
    this.retryEvery = opts.retryMs ?? 2_000;
  }

  /** Mark [start, end] as covered by consumer-supplied data. */
  addCovered(start: number, end: number): void {
    if (!(end > start)) return;
    this.covered = mergeRanges([...this.covered, { start, end }]);
  }

  /** Sorted disjoint covered ranges (live reference — do not mutate). */
  coveredRanges(): readonly TimeRange[] {
    return this.covered;
  }

  /** End of the newest covered range (null while nothing is covered). */
  coveredEnd(): number | null {
    const last = this.covered[this.covered.length - 1];
    return last ? last.end : null;
  }

  /** The in-flight request, if any. */
  pending(): TimeRange | null {
    return this.inflight;
  }

  /** True while a failed load is waiting out the fixed retry cadence (nothing
   * in flight, next attempt scheduled). */
  waitingRetry(now: number): boolean {
    return this.inflight === null && now < this.retryAt;
  }

  /**
   * Uncovered gaps within `span` that could still hold data (gaps entirely
   * before the exhausted boundary are dropped; a gap straddling it is
   * clipped). Use for painting the loading / uncovered affordance.
   */
  uncoveredIn(span: TimeRange): TimeRange[] {
    let gaps = subtractRanges(span, this.covered);
    const ex = this.exhaustedBefore;
    if (ex != null) {
      gaps = gaps.filter((g) => g.end > ex).map((g) => (g.start < ex ? { start: ex, end: g.end } : g));
    }
    return gaps;
  }

  /**
   * The next range to fetch for the given viewport, or null (fully covered,
   * a request is already in flight, waiting out the retry cadence after a
   * failure, or history is exhausted). The returned range is marked in
   * flight — pass it to settle() when the load resolves or rejects.
   * Requests are widened to minChunkMs (extending into the past) so tiny
   * scroll steps don't spray tiny requests.
   */
  nextRequest(view: TimeView, now: number): TimeRange | null {
    if (this.inflight || now < this.retryAt) return null;
    const gaps = this.uncoveredIn({ start: view.start, end: view.end });
    if (gaps.length === 0) return null;
    const gap = gaps[gaps.length - 1]; // newest gap first — fill toward the past
    const req: TimeRange = { start: gap.start, end: gap.end };
    if (req.end - req.start < this.minChunk) req.start = req.end - this.minChunk;
    const ex = this.exhaustedBefore;
    if (ex != null && req.start < ex) req.start = ex;
    if (!(req.end > req.start)) return null;
    this.inflight = req;
    return req;
  }

  /** Resolve/reject the in-flight request (no-op for a stale range). */
  settle(range: TimeRange, result: { ok: boolean; exhausted?: boolean }, now = 0): void {
    if (!this.inflight || this.inflight.start !== range.start || this.inflight.end !== range.end) return;
    this.inflight = null;
    if (!result.ok) {
      // Fixed cadence, forever: the next attempt is always exactly retryEvery away — no growth, no attempt cap.
      this.retryAt = now + this.retryEvery;
      return;
    }
    this.retryAt = -Infinity;
    this.addCovered(range.start, range.end);
    if (result.exhausted) {
      const first = this.covered[0];
      this.exhaustedBefore = first ? first.start : range.start;
    }
  }
}

// -- Render pacing ---------------------------------------------------------------------

/** Render tiers: full rate while interacting, throttled idle, cheaper still on battery. */
export type RenderTier = 'interactive' | 'idle' | 'idle-battery';

/** Idle frame budget: ~30fps while nothing is being interacted with. */
export const IDLE_FRAME_MS = 1000 / 30;
/** Idle-on-battery frame budget: ~10fps. */
export const IDLE_BATTERY_FRAME_MS = 100;
/** Full-rate grace window after the last input — interaction never feels throttled. */
export const INTERACT_GRACE_MS = 500;

/* */
export function frameBudgetMs(tier: RenderTier): number {
  if (tier === 'idle') return IDLE_FRAME_MS;
  if (tier === 'idle-battery') return IDLE_BATTERY_FRAME_MS;
  return 0;
}

/** Frame gate for a rAF loop: render when the tier's budget has elapsed since
 * the last RENDERED frame. */
export function shouldRender(nowTs: number, lastRenderTs: number, budgetMs: number, rafIntervalMs = 16.7): boolean {
  if (budgetMs <= 0) return true;
  return nowTs - lastRenderTs >= budgetMs - rafIntervalMs / 2;
}

/** Draw budget (ms per rendered frame) while the ONLY motion on screen is
 * CLOCK-driven — the follow-now scroll and ongoing-bar growth. The scene
 * then translates exactly one whole DEVICE pixel per span / (plotWidthCss *
 * dpr) ms, so redrawing any faster produces pixel-identical frames. */
export function clockDrawBudgetMs(view: TimeView, plotWidthCss: number, dpr: number, tierBudgetMs: number): number {
  const span = view.end - view.start;
  const wDev = plotWidthCss * dpr;
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(wDev) || wDev <= 0) return tierBudgetMs;
  return Math.max(tierBudgetMs, span / wDev);
}
