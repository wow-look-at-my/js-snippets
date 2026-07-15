// Pure math for the <timeline-view> element: time<->pixel scales, an
// anchor-preserving zoom (with wheel-delta normalization and gesture
// routing), the follow-now engage/disengage rule (plus the eased follow
// lead — engage/disengage/jump transitions glide, never teleport), feed
// staleness (a dead live feed freezes the live edge at the last vouched
// timestamp instead of extrapolating), a device-pixel-snapped render
// origin (whole-pixel scrolling), a nice TIME tick ladder
// (1/2/5/10/15/30 across ms → s → min → h → days, with per-step label
// granularity), greedy first-fit sub-track packing (whole-set and
// visible-window variants) plus the STICKY TrackAllocator (rows that stop
// reshuffling while you watch), lane layout, auto-fit lane demotion (compact
// track heights, tallest lanes first, hysteretic), label-fit and instant-interval
// (zero/near-zero DURATION) helpers, scale-aware clustering of instant
// markers (clusters split as you zoom in), the minimap strip's window
// math (extent derivation, px mapping, handle hit zones, drag/resize/
// center semantics with extent + span clamps), stable category → hue
// hashing, data-coverage / range-request bookkeeping for async history
// loading, render-loop pacing tiers, and hit-testing. No DOM or browser APIs —
// everything here runs (and is tested) under node; ui/timeline-view.ts is
// the canvas-bound half that consumes it.

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
  /** Color key: same category = same hue. Defaults to lane.group, then laneId. */
  category?: string;
  /** Style-map key: rendering treatment (e.g. 'failed', 'dim', 'hatch'). */
  state?: string;
  /** Phases within the bar, each styled via its `kind`. */
  segments?: TimelineSegment[];
  /** Opaque consumer payload — echoed back in events and tooltip callbacks. */
  data?: unknown;
}

/** A line between two intervals (e.g. a handoff or dependency of the consumer's choosing). */
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

/** Hard zoom clamps: ~2 s to ~7 days of visible span. */
export const MIN_SPAN_MS = 2_000;
export const MAX_SPAN_MS = 7 * 86_400_000;

/** Time → x in [0, width] for the view (un-clamped; callers cull). */
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

/**
 * The hard right end stop for user-driven views: the right edge never
 * passes `now` (span preserved; views already at/before now come back
 * unchanged). Every user input path (wheel, drag, pinch, keyboard,
 * setViewport) clamps through this, so panning/zooming toward the future
 * reliably parks EXACTLY at the stop — which is what makes the
 * FOLLOW_SNAP_DEVICE_PX follow re-engage trivially hittable.
 */
export function clampViewToNow(view: TimeView, now: number): TimeView {
  if (view.end <= now) return view;
  return { start: now - (view.end - view.start), end: now };
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
 * Normalize a WheelEvent delta to pixels. deltaMode 0 (pixel) passes
 * through 1:1; 1 (line) and 2 (page) — discrete wheels — convert via the
 * given heights. Non-finite deltas normalize to 0.
 */
export function wheelDeltaToPixels(delta: number, deltaMode: number, lineHeight = 16, pageHeight = 800): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * lineHeight;
  if (deltaMode === 2) return delta * pageHeight;
  return delta;
}

/** Pixels of zoom wheel per doubling of the scale. */
export const ZOOM_PX_PER_DOUBLE = 260;

/**
 * Continuous exponential zoom factor for a wheel delta in pixels: negative
 * (scroll up / pinch out) zooms in. ZOOM_PX_PER_DOUBLE px doubles the scale,
 * so factors compose exactly: f(a) * f(b) === f(a + b).
 */
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
  /** Zoom (ctrl/meta + wheel), from the vertical delta. 0 = no zoom. */
  zoomPx: number;
  /** Horizontal time pan. */
  panPx: number;
  /** Vertical lane-stack scroll. */
  laneScrollPx: number;
  /**
   * False = the chart takes NOTHING from this event — the caller must not
   * preventDefault, so the page scrolls normally over the chart. True the
   * moment any axis routes somewhere (preventDefault the whole event; a
   * diagonal gesture's unconsumed axis is dropped, never half-forwarded).
   */
  consumed: boolean;
}

/**
 * Route a wheel/trackpad gesture: ctrl/meta+wheel zooms (always consumed —
 * a pinch stream must never leak browser page-zoom, even on a zero-delta
 * tick); shift+wheel pans time (a vertical wheel pans horizontally);
 * otherwise deltaX pans time and deltaY scrolls the lane stack ONLY when
 * it overflows the host. A plain vertical wheel over a non-overflowing
 * chart is NOT consumed — vertical scrolling must never scroll the chart
 * sideways, and the page keeps scrolling normally across the chart. A
 * diagonal two-finger gesture applies each axis to its own behavior and is
 * consumed iff at least one axis routed.
 */
export function routeWheel(e: WheelInput, lanesOverflow: boolean): WheelRoute {
  const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode);
  const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode);
  if (e.ctrlKey || e.metaKey) return { zoomPx: dy, panPx: 0, laneScrollPx: 0, consumed: true };
  if (e.shiftKey) {
    const pan = dy || dx;
    return { zoomPx: 0, panPx: pan, laneScrollPx: 0, consumed: pan !== 0 };
  }
  const laneScrollPx = lanesOverflow ? dy : 0;
  return { zoomPx: 0, panPx: dx, laneScrollPx, consumed: dx !== 0 || laneScrollPx !== 0 };
}

// -- Follow-now rule ---------------------------------------------------------------

/** Fraction of the span "now" sits in from the right edge while following. */
export const FOLLOW_LEAD_FRAC = 0.02;
/**
 * A gesture ending with the right edge within this many DEVICE pixels
 * (literal screen pixels — at dpr 2 this is 1 CSS px) of the `now` end
 * stop re-engages follow.
 */
export const FOLLOW_SNAP_DEVICE_PX = 2;

/**
 * Whether follow-now is engaged after a user-driven viewport change.
 *
 * A PURE PAN that moves the right edge backward (into the past) always
 * disengages. This is load-bearing for trackpads: a two-finger pan arrives
 * as many small wheel events, and an unconditional magnetic rule re-pinned
 * the view after every event smaller than the snap zone — making it
 * impossible to leave "now" by scrolling. While ALREADY following, any
 * other NON-ZOOM gesture stays pinned (a forward pan at the stop stays
 * live). ZOOM gestures never inherit the pin: the element passes
 * `wasFollowing: false` for them, because during a zoom the
 * cursor-anchored view must beat the now pin (the pin kept only the
 * zoomed SPAN and re-derived the position from `now`, anchoring
 * wheel/pinch zoom at the now marker instead of the cursor) — so a zoom
 * re-earns follow through the same snap rule as any fresh gesture: an
 * anchored zoom-in that pulls the right edge out of the snap zone parks
 * with the anchor intact, while one that stays at the live edge (or a
 * zoom-out pressing into the end stop) keeps following. While NOT
 * following, a gesture re-engages only when the right edge lands within
 * FOLLOW_SNAP_DEVICE_PX DEVICE pixels of the `now` end stop — pass the
 * view's ms-per-DEVICE-pixel scale (span / (plotWidthCss * dpr)). The
 * zone is deliberately tiny (the old span-fraction zone re-docked views
 * that merely got NEAR the edge): user views hard-stop at now
 * (clampViewToNow), so a forward drag parks exactly at the stop and
 * reliably re-docks, while a view parked 3+ device px short stays put.
 */
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

/**
 * Duration of the follow-lead ease (ms): engaging follow ramps the lead in
 * from where the gesture parked, and a backward-pan disengage glides any
 * residual lead back out — both over this window, instead of teleporting
 * the view by span * FOLLOW_LEAD_FRAC in a single frame (~2% of the plot
 * width — 50+ device px on a wide monitor).
 */
export const FOLLOW_LEAD_TWEEN_MS = 200;
/** Duration of the jump-to-now glide (ms): fast, deliberate — but continuous. */
export const JUMP_TO_NOW_TWEEN_MS = 250;

/**
 * The eased follow lead `elapsedMs` into a glide from `fromFrac` toward
 * `targetFrac` over `tweenMs`. Leads are FRACTIONS of the span (like
 * FOLLOW_LEAD_FRAC) — dimensionless, so zooming mid-glide rescales the
 * lead with the span exactly like the steady-state lead does. easeOutQuad
 * (the LAYOUT_TWEEN family): monotone from → target with no overshoot,
 * the per-tick step is bounded by |target - from| * 2 * dt / tweenMs (the
 * no-teleport guarantee — the ease's steepest slope is at t=0), and it
 * lands EXACTLY on the target at elapsed >= tweenMs (no asymptote). A
 * non-positive tweenMs snaps straight to the target — the
 * prefers-reduced-motion path.
 */
export function followLeadAt(fromFrac: number, targetFrac: number, elapsedMs: number, tweenMs: number): number {
  if (!(tweenMs > 0) || !(elapsedMs < tweenMs)) return targetFrac;
  if (!(elapsedMs > 0)) return fromFrac;
  const p = elapsedMs / tweenMs;
  return fromFrac + (targetFrac - fromFrac) * p * (2 - p);
}

/**
 * The lead fraction a user gesture legitimately holds: its own end
 * relative to `now`, capped at `maxFrac` — the lead the view was already
 * allowed (a gesture may consume lead or park behind now, never mint
 * lead). ENGAGE seeds the ease-in from this (a gesture parked at/just
 * short of the now stop seeds ≈ 0; a jump-to-now from deep in the past
 * seeds very negative — the glide crosses the gap); DISENGAGE floors it
 * at 0 for the residual that glides back out.
 */
export function gestureLeadFrac(endMs: number, now: number, span: number, maxFrac: number): number {
  if (!(span > 0)) return Math.min(0, maxFrac);
  return Math.min((endMs - now) / span, maxFrac);
}

// -- Feed staleness ---------------------------------------------------------------

/**
 * Default ms without fresh data before a live chart declares its feed
 * STALE (the element's `staleAfterMs`). Tune to ~2 poll intervals of the
 * consumer's live feed; a non-finite or non-positive value disables
 * staleness entirely (static, never-fed datasets).
 */
export const STALE_AFTER_DEFAULT_MS = 10_000;

/**
 * Whether the live feed is stale: fresh data last arrived at `lastFresh`
 * (null = no data has EVER arrived — an empty chart is never stale) and
 * more than `staleAfterMs` has since passed. The guard against a chart
 * misrepresenting state when its feed silently dies: a finished run whose
 * end never arrived would otherwise render as "running" forever.
 */
export function feedIsStale(now: number, lastFresh: number | null, staleAfterMs: number): boolean {
  if (lastFresh === null || !Number.isFinite(staleAfterMs) || staleAfterMs <= 0) return false;
  return now - lastFresh > staleAfterMs;
}

/**
 * The LIVE EDGE every live semantic advances to — ongoing (end = null)
 * bar ends, the now line, the follow-mode pin, and the user-view forward
 * clamp: real `now` while the feed is fresh, FROZEN at `lastFresh` once
 * stale. Once stale the chart never extrapolates past the last timestamp
 * the data actually vouched for — frozen bars can only be honest. (The
 * element eases the transition between the two targets with followLeadAt;
 * this is the steady-state value.)
 */
export function liveEdgeTarget(now: number, lastFresh: number | null, staleAfterMs: number): number {
  return feedIsStale(now, lastFresh, staleAfterMs) ? (lastFresh as number) : now;
}

// -- Whole-pixel scrolling ------------------------------------------------------------

/**
 * Snap a view's ORIGIN to the device-pixel grid, span preserved: with the
 * snapped view, any fixed time's x keeps a constant subpixel phase, so a
 * moving viewport translates the whole scene in WHOLE device-pixel steps
 * and bars keep exact relative offsets. This is the ONE place rounding may
 * touch time→x. Rounding per element instead makes neighboring bars round
 * in different directions as a fractional translation slides under them —
 * they visibly jiggle relative to each other. Snapping happens in DEVICE
 * pixels (dpr-aware) so HiDPI displays don't land on half pixels.
 */
export function snapViewToDevicePixels(view: TimeView, plotWidthCss: number, dpr: number): TimeView {
  const span = view.end - view.start;
  const msPerDevPx = span / (plotWidthCss * dpr);
  if (!Number.isFinite(msPerDevPx) || msPerDevPx <= 0) return view;
  const start = Math.round(view.start / msPerDevPx) * msPerDevPx;
  return { start, end: start + span };
}

/**
 * Snap a CSS-px coordinate to the nearest WHOLE device pixel — for TEXT
 * draw origins only. Glyphs rasterize sharpest when their origin sits on
 * the device-pixel grid (a fractional baseline smears every horizontal
 * stroke across two pixel rows as gray), and text — unlike bar
 * geometry — tolerates per-element rounding: nothing tiles against a
 * label, so the at-most-half-device-px step during scrolls/tweens reads
 * as stepping, never as neighbors jiggling. Geometry keeps the single
 * global view-origin rounding (snapViewToDevicePixels); never round bars
 * per element.
 */
export function snapTextOrigin(v: number, dpr: number): number {
  if (!Number.isFinite(v) || !(dpr > 0)) return v;
  return Math.round(v * dpr) / dpr;
}

// -- Time ticks --------------------------------------------------------------------

/**
 * The tick ladder, in ms: 1/2/5-style steps through ms, then the natural
 * time subdivisions (10/15/30 s and min, 1/2/3/6/12 h), then days/weeks.
 */
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
  mo: number; // 1-12
  d: number; // 1-31
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

/**
 * Tick label with granularity matched to the step: sub-second steps show
 * `:SS.mmm`, second steps `HH:MM:SS`, minute/hour steps `HH:MM`, and day+
 * steps `Mon D`. A tick exactly at local midnight labels as the date (the
 * day boundary reads as a date, not '00:00'). Times are rendered in the
 * zone given by `tzOffsetMs` (see timeTicks).
 */
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
}

/**
 * Greedy first-fit interval packing for one lane: returns `tracks[i]` = the
 * sub-track (row within the lane) for items[i], plus the track count.
 *
 * Deterministic and stable under re-sorting: items are ordered by (start,
 * id) internally, so the same SET of intervals packs identically no matter
 * the input order, and results are index-aligned with the input. An
 * interval reuses the lowest track whose last occupant ended at or before
 * its start; ongoing intervals (end == null) block their track forever.
 * Every interval occupies at least PACK_MIN_MS, so coincident instants (and
 * an instant at a bar's start) get their own track instead of vanishing.
 */
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
    const end = Math.max(it.end == null ? Infinity : it.end, it.start + PACK_MIN_MS);
    let t = 0;
    while (t < trackEnds.length && trackEnds[t] > it.start) t++;
    trackEnds[t] = end;
    tracks[i] = t;
  }
  return { tracks, trackCount: Math.max(1, trackEnds.length) };
}

/** Effective packing footprint end: ongoing blocks forever, instants occupy PACK_MIN_MS. */
function packEnd(it: PackItem): number {
  return Math.max(it.end == null ? Infinity : it.end, it.start + PACK_MIN_MS);
}

/**
 * packTracks over only the items that intersect `view` (a partially
 * visible interval counts; an ongoing one — end null — intersects every
 * window at/after its start). Same deterministic (start, id) ordering and
 * first-fit reuse as packTracks, evaluated over the visible subset only —
 * so one historical parallelism burst stops padding its lane the moment it
 * scrolls out of view. Assignment is a pure function of the visible SET:
 * while the window slides over unchanged overlap, nothing hops tracks.
 * Items outside the view get track -1 (callers keep or cull them);
 * trackCount is >= 1, so a lane with nothing visible collapses to one
 * track. STATELESS — when the visible membership changes, everything
 * reflows into freed tracks; the element rows its lanes through the
 * sticky TrackAllocator below instead, which shares this contract but
 * keeps visible rows pinned across membership churn.
 */
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
    let t = 0;
    while (t < trackEnds.length && trackEnds[t] > it.start) t++;
    trackEnds[t] = packEnd(it);
    tracks[i] = t;
  }
  return { tracks, trackCount: Math.max(1, trackEnds.length) };
}

/**
 * Bound on remembered id → track assignments per TrackAllocator (LRU
 * eviction beyond it): generous enough to cover every id a lane plausibly
 * cycles through between revisits, small enough that an unbounded live
 * feed can never grow the memory forever. An evicted id simply re-packs
 * as new on return.
 */
export const TRACK_MEMORY_CAP = 2048;

/**
 * STICKY sub-track allocation for one lane — the STATEFUL counterpart of
 * packVisibleTracks, built so rows stop shifting under the viewer as the
 * visible membership churns (panning, live updates):
 *
 * - An item assigned in the PREVIOUS call and still visible KEEPS its
 *   track unconditionally (re-verified against the other keepers, so
 *   even an item whose times were live-edited can never create a
 *   same-track overlap).
 * - An item RETURNING after scrolling out gets its remembered track back
 *   when no visible occupant conflicts — best-effort row memory, bounded
 *   by an LRU cap (`memoryCap`, default TRACK_MEMORY_CAP).
 * - Everything else — brand-new arrivals, the rare displaced returner —
 *   takes the LOWEST track with no time overlap among the items placed
 *   this call. Density recovers from the bottom: once a tall burst
 *   scrolls off-screen its high tracks fall out of use and the lane
 *   shrinks to what is still visible, WITHOUT re-rowing anything the
 *   viewer is looking at (a lone survivor parked on a high track holds
 *   its row — and the lane's height — until it leaves the window).
 *
 * Same contract as packVisibleTracks otherwise: tracks[i] aligned to the
 * input (-1 = outside the view; callers keep the previous assignment),
 * trackCount = highest in-use visible track + 1 (>= 1 — an empty window
 * collapses to one track), footprints via PACK_MIN_MS instants and
 * ongoing-blocks-forever, visible same-track items can never overlap in
 * time, and results are deterministic given the same call sequence. A
 * FRESH allocator's first call reproduces packVisibleTracks exactly (no
 * memory yet — pure lowest-free in (start, id) order).
 */
export class TrackAllocator {
  /** id → last assigned track. Map insertion order doubles as LRU recency. */
  private memory = new Map<string, number>();
  /** ids assigned (visible) by the previous call — their tracks are kept. */
  private live = new Set<string>();
  private cap: number;

  constructor(memoryCap = TRACK_MEMORY_CAP) {
    this.cap = Math.max(1, Math.floor(memoryCap));
  }

  /** Assign tracks for the items visible in `view` (see the class doc). */
  assign(items: readonly PackItem[], view: TimeView): { tracks: number[]; trackCount: number } {
    const tracks = new Array<number>(items.length).fill(-1);
    const vis: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.start <= view.end && packEnd(it) >= view.start) vis.push(i);
    }
    vis.sort((a, b) => {
      const ia = items[a];
      const ib = items[b];
      return ia.start - ib.start || (ia.id < ib.id ? -1 : ia.id > ib.id ? 1 : 0);
    });
    // Per-track footprints placed THIS call — the only conflict authority
    // (memory is a preference, never proof of fit).
    const placed: { start: number; end: number }[][] = [];
    const canPlace = (t: number, s: number, e: number): boolean => {
      const list = placed[t];
      if (!list) return true;
      for (const f of list) if (s < f.end && f.start < e) return false;
      return true;
    };
    const place = (i: number, t: number): void => {
      tracks[i] = t;
      (placed[t] ??= []).push({ start: items[i].start, end: packEnd(items[i]) });
    };
    const lowestFree = (s: number, e: number): number => {
      let t = 0;
      while (!canPlace(t, s, e)) t++;
      return t;
    };
    // Pass 1 — keepers: continuously-visible items hold their rows.
    const returning: number[] = [];
    const fresh: number[] = [];
    for (const i of vis) {
      const it = items[i];
      const kept = this.live.has(it.id) ? this.memory.get(it.id) : undefined;
      if (kept !== undefined && canPlace(kept, it.start, packEnd(it))) place(i, kept);
      else if (this.memory.has(it.id)) returning.push(i);
      else fresh.push(i);
    }
    // Pass 2 — returning items reclaim their old row when still free.
    for (const i of returning) {
      const it = items[i];
      const end = packEnd(it);
      const remembered = this.memory.get(it.id) as number;
      place(i, canPlace(remembered, it.start, end) ? remembered : lowestFree(it.start, end));
    }
    // Pass 3 — new items fill from the bottom (density recovery).
    for (const i of fresh) {
      const it = items[i];
      place(i, lowestFree(it.start, packEnd(it)));
    }
    // Remember every visible assignment (refreshing LRU recency), then
    // prune the oldest beyond the cap.
    this.live = new Set<string>();
    let maxTrack = -1;
    for (const i of vis) {
      const id = items[i].id;
      this.live.add(id);
      this.memory.delete(id);
      this.memory.set(id, tracks[i]);
      if (tracks[i] > maxTrack) maxTrack = tracks[i];
    }
    while (this.memory.size > this.cap) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
    return { tracks, trackCount: Math.max(1, maxTrack + 1) };
  }
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
  /** Top y of each lane (starting at 0; add the axis offset / scroll externally). */
  tops: number[];
  /** Height of each lane. */
  heights: number[];
  /** Sum of all lane heights. */
  totalHeight: number;
}

/**
 * Height of one lane given its track count, at `trackHeight` px per track
 * (defaults to the metrics' normal height). Fractional counts are allowed —
 * they drive the lane-height tween.
 */
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

/**
 * Headroom hysteresis for auto-fit: a demoted lane only re-promotes when
 * the resulting layout would fit with this fraction of the available
 * height to spare, so heights can't flap when hovering at the boundary.
 */
export const FIT_HYSTERESIS_FRAC = 0.1;

/** Result of computeAutoFit. */
export interface FitResult {
  /** Per lane (input order): true = render ALL of that lane's tracks at the compact height. */
  demoted: boolean[];
  /**
   * Number of demoted lanes — the hysteresis state. Feed it back as
   * `prevDemotedCount` on the next evaluation.
   */
  count: number;
}

/**
 * The order lanes are demoted to compact in: by visible track count
 * DESCENDING (the tallest / most parallel lane first — one compact tall
 * lane recovers the most height), ties broken by LATER display order
 * first — so when two lanes are equally tall, the one further down the
 * chart demotes first and top-of-chart lanes keep their detail longest.
 * Returns lane indices, first-to-demote first. Deterministic for a given
 * count list.
 */
export function demotionOrder(trackCounts: readonly number[]): number[] {
  const order = trackCounts.map((_, i) => i);
  order.sort((a, b) => trackCounts[b] - trackCounts[a] || b - a);
  return order;
}

/**
 * Auto-fit: decide which lanes render at the compact track height so the
 * lane stack fits `availHeight` (the host's plot height). Evaluate with
 * the NATURAL layout (every lane at the normal track height); while it
 * overflows, demote lanes one at a time in demotionOrder() until the
 * total fits or every lane is compact (if all-compact still overflows,
 * the caller's vertical lane scrolling takes over). Demotion applies to a
 * whole lane — all of its tracks go compact together.
 *
 * Deterministic and oscillation-free: the result is a pure function of
 * (track counts, metrics, heights, prevDemotedCount). Demotion reacts
 * immediately (an overflowing layout never persists), but promotion is
 * hysteretic — a demoted lane is only promoted when the layout stays
 * fitting with `hysteresisFrac` headroom (so all lanes re-promote only
 * once the natural layout fits within availHeight * (1 - hysteresisFrac)).
 * Between the two thresholds the previous demotion COUNT is kept; the
 * demotion SET is always re-derived from the CURRENT counts, so a lane
 * whose parallelism left the window hands its demotion to the now-tallest
 * lane deterministically. `compactTrackHeight` is clamped to at most the
 * normal track height.
 */
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
  // kMin: fewest demotions (in order) that fit availHeight. kHead: fewest
  // that fit with headroom (>= kMin). Both saturate at nLanes.
  const headAvail = availHeight * (1 - hysteresisFrac);
  let kMin = total <= availHeight ? 0 : nLanes;
  let kHead = total <= headAvail ? 0 : nLanes;
  let running = total;
  for (let k = 1; k <= nLanes && (kMin === nLanes || kHead === nLanes); k++) {
    running -= savings[order[k - 1]];
    if (kMin === nLanes && running <= availHeight) kMin = k;
    if (kHead === nLanes && running <= headAvail) kHead = k;
  }
  // Hysteresis on the count: demote immediately when overflowing, promote
  // only as far as keeps the headroom, otherwise keep the previous count.
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

/**
 * Rendered width of [startMs, endMs] mapped through the view's scale,
 * computed from the DURATION alone. This — not a difference of two rounded
 * screen coordinates — is what the bar-vs-pip decision must use: it is
 * exactly invariant under viewport translation, so an event's shape can
 * never flicker while the timeline scrolls (round(xEnd) - round(xStart)
 * oscillates ±1px as the bar's subpixel phase shifts).
 */
export function durationWidthPx(startMs: number, endMs: number, view: TimeView, plotWidth: number): number {
  const span = view.end - view.start;
  return span > 0 ? ((endMs - startMs) / span) * plotWidth : 0;
}

/**
 * Which ends of [startMs, endMs] are CLIPPED by the view — the interval's
 * true extent continues off-screen past that edge. Drives the element's
 * edge-continuation fade. Two deliberate exemptions: an end within half a
 * pixel of the window edge does NOT count (the interval genuinely
 * starts/ends there — and the device-pixel view snap shifts edges by up
 * to a pixel, which must never read as continuation); and a side only
 * counts when the visible part reaches all the way through the fade zone
 * (`fadePx`), so a barely-poking stub stays a visible stub instead of
 * fading to nothing. Pass the live edge as `endMs` for ongoing intervals.
 */
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

/**
 * Instant markers whose centers sit within this many CSS px of their
 * neighbor merge into one ×N cluster (~the rendered width of a pip incl.
 * its stroke) — clusters exist exactly while the pips would visually
 * overlap at the current scale.
 */
export const CLUSTER_JOIN_PX = 12;

/** A group of visually-overlapping instant markers (see clusterInstants). */
export interface InstantCluster {
  /** Indices into the input array, in (start, id) order. */
  indices: number[];
  /**
   * Member start-time extent [first, last] (equal ends when every member
   * is coincident) — the click-to-zoom target (clusterZoomView) and the
   * marker anchor (clusterMarkerTime).
   */
  extent: TimeRange;
}

/**
 * SCALE-AWARE clustering of instant markers: a greedy transitive sweep
 * in time order merges instants whose centers sit within `joinPx` CSS px
 * of their neighbor at the view's scale, so a pile of coincident pips
 * reads as ONE point-like ×N marker while zooming in progressively
 * splits every cluster until each pip stands at its true timestamp.
 *
 * Only instants participate: an item must be terminal (end != null — an
 * ongoing interval will grow into a bar) with a duration mapping under
 * `instantPx` (the pip threshold) at this scale. Membership depends only
 * on time DELTAS and the scale — never on the viewport's position — so a
 * pure pan can never change clusters (no jitter), and items beyond the
 * view still cluster, so a group scrolls into view already formed.
 * Clusters have >= 2 members (a lone pip is not a cluster; everything
 * un-clustered gets memberOf -1). Deterministic under input re-ordering:
 * the sweep runs in (start, id) order and indices refer to input
 * positions.
 */
export function clusterInstants(
  items: readonly PackItem[],
  view: TimeView,
  plotWidth: number,
  joinPx = CLUSTER_JOIN_PX,
  instantPx = INSTANT_THRESHOLD_PX,
): { clusters: InstantCluster[]; memberOf: number[] } {
  const memberOf = new Array<number>(items.length).fill(-1);
  const clusters: InstantCluster[] = [];
  const span = view.end - view.start;
  if (!(span > 0) || !(plotWidth > 0)) return { clusters, memberOf };
  const msPerPx = span / plotWidth;
  const joinMs = joinPx * msPerPx;
  const instantMaxMs = instantPx * msPerPx;
  const order: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.end == null || it.end - it.start >= instantMaxMs) continue;
    order.push(i);
  }
  order.sort((a, b) => {
    const ia = items[a];
    const ib = items[b];
    return ia.start - ib.start || (ia.id < ib.id ? -1 : ia.id > ib.id ? 1 : 0);
  });
  let bucket: number[] = [];
  const flush = (): void => {
    if (bucket.length > 1) {
      for (const i of bucket) memberOf[i] = clusters.length;
      clusters.push({
        indices: bucket,
        extent: { start: items[bucket[0]].start, end: items[bucket[bucket.length - 1]].start },
      });
    }
    bucket = [];
  };
  for (const i of order) {
    if (bucket.length > 0 && items[i].start - items[bucket[bucket.length - 1]].start > joinMs) flush();
    bucket.push(i);
  }
  flush();
  return { clusters, memberOf };
}

/** Fraction of the zoomed window a clicked cluster's member extent occupies (centered). */
export const CLUSTER_ZOOM_FILL_FRAC = 0.6;

/**
 * The view a cluster click zooms to: the member extent centered, filling
 * CLUSTER_ZOOM_FILL_FRAC of the window, never narrower than `minSpan` —
 * deep enough that the members separate past the join threshold and the
 * cluster SPLITS. Fully coincident members zoom to minSpan and stay one
 * marker: they genuinely share a timestamp, and the tooltip lists them.
 */
export function clusterZoomView(extent: TimeRange, minSpan = MIN_SPAN_MS, fillFrac = CLUSTER_ZOOM_FILL_FRAC): TimeView {
  const dur = Math.max(0, extent.end - extent.start);
  const span = Math.max(fillFrac > 0 ? dur / fillFrac : dur, minSpan);
  const mid = (extent.start + extent.end) / 2;
  return { start: mid - span / 2, end: mid + span / 2 };
}

/**
 * Where a cluster's marker sits, in TIME: the extent midpoint while that
 * fits the window, slid along the visible slice of the extent when the
 * window clips it (the sticky-label pattern — a transitive chain
 * straddling a viewport edge keeps an on-screen marker instead of hiding
 * its members' evidence), and null once no part of the extent is
 * visible. `marginMs` insets the slid marker from the window edges (pass
 * the marker radius in ms) so it stays fully visible. Continuous in the
 * view — panning slides it smoothly, never a jump — and constant (the
 * midpoint) while the extent is fully inside the window.
 */
export function clusterMarkerTime(extent: TimeRange, view: TimeView, marginMs: number): number | null {
  if (extent.end < view.start || extent.start > view.end) return null;
  const mid = (extent.start + extent.end) / 2;
  let lo = Math.max(extent.start, view.start + marginMs);
  let hi = Math.min(extent.end, view.end - marginMs);
  if (lo > hi) {
    // Margins can cross on a tiny window, a near-point extent, or an
    // extent about to exit — fall back to the UN-inset visible slice
    // (never empty once the visibility gate above passed), so the marker
    // stays continuous and on-screen to the last visible sliver.
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

/**
 * Grab-the-middle: pan the window by a pointer delta in strip px, span
 * preserved, clamped inside the extent at both ends (a window wider than
 * the whole extent pins to the extent's live end). Pixel-delta based so
 * a drag stays 1:1 under the pointer even while the extent's live end
 * advances mid-drag.
 */
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

// -- Hit testing --------------------------------------------------------------------

/** An axis-aligned hit rectangle (CSS px). */
export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Widen a (possibly hairline) rect to at least `minW` px around its center —
 * instants get a hit target a few px larger than their visual so they stay
 * hoverable/clickable.
 */
export function expandHitRect(r: HitRect, minW: number): HitRect {
  if (r.w >= minW) return r;
  const cx = r.x + r.w / 2;
  return { x: cx - minW / 2, y: r.y, w: minW, h: r.h };
}

/**
 * Index of the TOPMOST (= last, matching paint order) rect containing the
 * point, or -1. Edges are inclusive.
 */
export function hitTestRects(x: number, y: number, rects: readonly HitRect[]): number {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

/** Squared distance from point p to segment ab. */
export function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** True when the point is within `tol` px of the polyline. */
export function hitTestPolyline(px: number, py: number, pts: readonly { x: number; y: number }[], tol: number): boolean {
  const t2 = tol * tol;
  for (let i = 1; i < pts.length; i++) {
    if (distSqToSegment(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= t2) return true;
  }
  return false;
}

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

// -- Category color -----------------------------------------------------------------

/** FNV-1a 32-bit hash (stable across sessions/platforms). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Stable category → hue in [0, 360): FNV-1a scattered by the golden-ratio
 * conjugate, so similar strings land far apart and hues spread uniformly.
 * Same string = same hue, forever.
 */
export function categoryHue(category: string): number {
  const g = (hashString(category) * 0.61803398875) % 1;
  return Math.floor(g * 360);
}

/**
 * Deterministic per-category lightness/chroma offsets (|dl| <= 0.05,
 * |dc| <= 0.02), derived from independent hash bits. A second visual
 * discriminator: two categories that happen to hash to nearby hues still
 * separate by tone, while every category keeps one stable color forever.
 */
export function categoryJitter(category: string): { dl: number; dc: number } {
  const h = hashString(`${category} tone`);
  return {
    dl: ((h & 0xff) / 255 - 0.5) * 0.1,
    dc: (((h >>> 8) & 0xff) / 255 - 0.5) * 0.04,
  };
}

/** Options for categoryColor. */
export interface CategoryColorOptions {
  /** 'oklch' (perceptually even lightness — preferred) or 'hsl' fallback. */
  mode?: 'oklch' | 'hsl';
  /** oklch lightness 0..1 (default 0.62 — readable chips on a dark bg). */
  lightness?: number;
  /** oklch chroma (default 0.11 — saturated but not neon). */
  chroma?: number;
  /** Alpha 0..1 (default 1). */
  alpha?: number;
}

/**
 * CSS color for a category hue. oklch keeps perceived lightness even across
 * hues (label text stays readable on every category); the hsl fallback
 * approximates it for engines without oklch support.
 */
export function categoryColor(hue: number, opts: CategoryColorOptions = {}): string {
  const l = opts.lightness ?? 0.62;
  const c = opts.chroma ?? 0.11;
  const a = opts.alpha ?? 1;
  if (opts.mode === 'hsl') {
    const s = Math.round(Math.min(1, c / 0.32) * 100);
    const ll = Math.round(l * 88);
    return a >= 1 ? `hsl(${hue}, ${s}%, ${ll}%)` : `hsla(${hue}, ${s}%, ${ll}%, ${round3(a)})`;
  }
  return a >= 1 ? `oklch(${round3(l)} ${round3(c)} ${hue})` : `oklch(${round3(l)} ${round3(c)} ${hue} / ${round3(a)})`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// -- Style map ----------------------------------------------------------------------

/** Fill pattern for an interval state / segment kind. */
export type StylePattern = 'solid' | 'hatch' | 'stipple' | 'outline';

/** Rendering treatment for one interval `state` or segment `kind`. */
export interface IntervalStyle {
  pattern?: StylePattern;
  /** Multiplies the fill alpha (default 1). */
  alphaScale?: number;
  /** Multiplies the category chroma/saturation (default 1). */
  saturationScale?: number;
  /** Multiplies the category lightness (default 1). */
  lightnessScale?: number;
  /** Border treatment; `emphasis: true` uses the theme emphasis color. */
  border?: { width?: number; dash?: number[]; emphasis?: boolean };
  /** Corner glyph: 'bang' is the unmissable failure mark. */
  glyph?: 'none' | 'bang' | 'dot';
}

/** Named style map: interval `state` / segment `kind` → treatment. */
export type StyleMap = Record<string, IntervalStyle>;

/**
 * Built-in treatments (consumer keys spread on top via the element's
 * `styles` property): '' solid; 'emphasis'/'failed' unmissable — thick
 * emphasis border + corner bang glyph + stipple, hue untouched;
 * 'dim'/'queued' desaturated + translucent; 'hatch'/'waiting' 45° stripes;
 * 'outline' hollow; 'cancelled' hollow + DASHED category-hue border —
 * reads "stopped, not failed" at a glance: never the emphasis color,
 * never the bang glyph, never a solid success body. (Below dash
 * legibility the element draws a BAR's border solid; the hollow body
 * still separates a tiny cancelled bar from a solid one. Pips are exempt:
 * a cancelled instant keeps a dashed diamond outline, the pattern
 * rescaled to close around the perimeter.)
 */
export const DEFAULT_STYLES: StyleMap = {
  '': { pattern: 'solid' },
  emphasis: { pattern: 'stipple', border: { width: 2, emphasis: true }, glyph: 'bang' },
  failed: { pattern: 'stipple', border: { width: 2, emphasis: true }, glyph: 'bang' },
  dim: { pattern: 'solid', alphaScale: 0.4, saturationScale: 0.45, lightnessScale: 0.85 },
  queued: { pattern: 'solid', alphaScale: 0.4, saturationScale: 0.45, lightnessScale: 0.85 },
  hatch: { pattern: 'hatch', alphaScale: 0.85 },
  waiting: { pattern: 'hatch', alphaScale: 0.85 },
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

/**
 * The range a consumer may ask `loadRange` about for this viewport: the
 * visible window plus a little backward prefetch, clamped to `now` AND to
 * the covered end. The covered-end clamp is load-bearing: the region
 * between the last covered time and "now" belongs to the consumer's LIVE
 * data feed (setData/mergeData `coverage`), and in follow mode "now"
 * advances every frame — if loadRange could be asked for that forward
 * sliver, a fresh gap would reopen the moment each request settled and the
 * loader would refire serially at ~one request per round-trip (~30/s),
 * forever. loadRange exists for BACKWARD history only. With no coverage at
 * all the probe may still reach `now` (the bootstrap load), which latches
 * once it settles. Returns null when nothing is requestable.
 */
export function historyProbe(view: TimeView, now: number, coveredEnd: number | null, prefetchFrac = 0.15): TimeRange | null {
  const span = view.end - view.start;
  let end = Math.min(view.end, now);
  if (coveredEnd !== null && coveredEnd < end) end = coveredEnd;
  const start = view.start - span * prefetchFrac;
  return end > start ? { start, end } : null;
}

/** Options for CoverageTracker. */
export interface CoverageOptions {
  /** Never request less than this much history at once (default 60 s). */
  minChunkMs?: number;
  /** Fixed delay between retries of a failed load (default 2 s). */
  retryMs?: number;
}

/**
 * Bookkeeping for `loadRange`-style async history loading. Tracks which
 * time ranges are covered by data the consumer has supplied, which request
 * is in flight (one at a time — no request storms), the exhausted-history
 * boundary, and the fixed retry cadence for rejected loads.
 *
 *   const next = tracker.nextRequest(view, now); // range to fetch, or null
 *   ...call loadRange(next)...                    // tracker marked it in flight
 *   tracker.settle(next, { ok: true });           // → covered
 *   tracker.settle(next, { ok: true, exhausted: true }); // → history ends here
 *   tracker.settle(next, { ok: false });          // → retried ~retryMs later, forever
 */
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

  /**
   * True while a failed load is waiting out the fixed retry cadence
   * (nothing in flight, next attempt scheduled). Callers driving requests
   * from a frame loop must keep the loop alive while this is true, or the
   * retry parks until the next unrelated wakeup.
   */
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
      // Fixed cadence, forever: the next attempt is always exactly
      // retryEvery away — no growth, no attempt cap, no give-up. A growing
      // backoff quietly converts a transient failure into a permanently
      // parked gap; a steady short cadence keeps the gap loading (and its
      // affordance honest) until the consumer's loader recovers.
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

/** ms-per-frame budget for a tier (0 = render every rAF tick). */
export function frameBudgetMs(tier: RenderTier): number {
  if (tier === 'idle') return IDLE_FRAME_MS;
  if (tier === 'idle-battery') return IDLE_BATTERY_FRAME_MS;
  return 0;
}

/**
 * Frame gate for a rAF loop: render when the tier's budget has elapsed
 * since the last RENDERED frame. The half-tick slack keeps a 33.3ms budget
 * from aliasing down (a 60Hz display ticks at 16.7ms — without slack,
 * 33.3ms would round up to every 3rd tick = 20fps instead of 30).
 */
export function shouldRender(nowTs: number, lastRenderTs: number, budgetMs: number, rafIntervalMs = 16.7): boolean {
  if (budgetMs <= 0) return true;
  return nowTs - lastRenderTs >= budgetMs - rafIntervalMs / 2;
}
