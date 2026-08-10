/**
 * <timeline-view> — a canvas-rendered, realtime swimlane timeline.
 *
 * A shared horizontal time axis across the full width; stacked labeled
 * lanes, each a band of interval bars (left = start, right = end; a lane
 * grows extra sub-tracks when its intervals overlap). Everything is data:
 * lanes {id, label, group?}, intervals {id, laneId, start, end, label?,
 * category?, state?, segments?, data?}, plus optional connectors between
 * intervals, and vertical time markers. Color encodes CATEGORY (stable hue
 * per category string); rendering STYLE encodes state/phase via a named
 * style map (hatching, desaturation, stipple, emphasis borders + glyphs —
 * never hue). Zero/near-zero-width intervals render as instant diamond
 * pips (still colored, styled, hoverable, clickable — never an invisible
 * sliver). Not a Gantt (many bars per row), not a flame chart (no nesting).
 *
 *   import 'https://…/js-snippets/ui/timeline-view.js'; // registers <timeline-view>
 *
 *   const tl = document.querySelector('timeline-view');
 *   tl.setData({
 *     lanes: [{ id: 'ci', label: 'ci pipeline' }],
 *     intervals: [{ id: 'r1', laneId: 'ci', start: Date.now() - 60_000, end: null,
 *                   label: 'build #42', category: 'build' }],
 *   });
 *
 * Follow-now mode (default) pins the right edge to a live "now"; scroll or
 * drag into the past and a jump-to-now pill appears (panning backward
 * disengages follow immediately; panning forward re-docks magnetically at
 * the live edge). Every follow transition is CONTINUOUS: engaging eases
 * the small follow lead in over ~200ms from where the gesture parked,
 * disengaging lets the backward deltas consume the lead (any residual
 * glides out), and the pill glides to the followed position — the view
 * never teleports in a single frame (reduced motion snaps instead).
 * Interaction is trackpad-first, and wheel routing is by DOMINANT axis
 * with a GESTURE-LEVEL AXIS LOCK (WheelGestureRouter): the first decisive
 * unmodified event locks its stream's axis for as long as events keep
 * arriving within WHEEL_GESTURE_GAP_MS. A horizontal-locked gesture is
 * consumed WHOLE — dx pans time, the minor vertical component nudges the
 * lane stack when it overflows and never leaks into page scroll (a real
 * swipe's jittery minority events are individually vertical-dominant); a
 * vertical-locked gesture (ties included) follows the NESTED-SCROLLER
 * contract, latching its target from the lane stack's scrollability at
 * lock time: while the stack can move in the wheel's direction the
 * gesture SCROLLS THE STACK in place (consumed, clamped at its edges —
 * browser-style scroll latching, so an edge hit mid-swipe never janks
 * into page scroll; drag and arrow keys still scroll it too), and when
 * it cannot — already at that edge, or no overflow — nothing is
 * consumed, its horizontal jitter never pans the chart, and the page
 * scrolls normally, so the page is always reachable past a tall
 * chart; a DECISIVE opposite-axis event (>2x
 * dominance, ≥24px) re-locks mid-gesture, so a genuine direction change
 * never waits out the gap; ctrl/meta+wheel = smooth zoom anchored
 * under the cursor (discrete wheel steps glide; trackpad pinch arrives
 * as ctrl+wheel), shift+wheel = time pan, drag = pan, pinch = zoom,
 * arrows/±/Home/End when focused. `loadRange` turns scrolling into
 * the past into async history requests — for BACKWARD gaps only; the live
 * forward edge always belongs to the consumer's own setData/mergeData
 * `coverage` — with uncovered regions visibly distinct from empty-but-known
 * ones and an explicit end-of-history boundary. Browser navigation
 * gestures never fire over the component: the wheel listener lives on the
 * HOST (horizontal deltas over the DOM chrome are consumed like over the
 * canvas) and the host carries overscroll-behavior-x: none, so panning
 * hard into exhausted history can't turn into a history-back swipe —
 * horizontal ONLY, so vertical scroll chaining (and vertical touch pans,
 * via the plot canvas' touch-action: pan-y) stays the page's. A corner
 * ⤢ toggle (always visible; `no-fullscreen-button` hides it) flips the
 * reflected `fullscreen` attribute: viewport-fill via position:fixed —
 * deliberately NOT the Fullscreen API — with the page scroll locked while
 * active, Escape to exit, and a 'fullscreenchange' event. A minimap strip
 * along the bottom (own canvas; hidden with no data, on short hosts, or
 * via `no-minimap`) shows the full loaded extent as per-lane density
 * marks with the viewport as a draggable window: edge handles resize it,
 * grabbing the middle pans it, clicking outside centers it — all through
 * the same follow/park/loadRange semantics as canvas gestures.
 *
 * FEED STALENESS: every setData/mergeData (or an explicit markFresh())
 * stamps the feed fresh; when `staleAfterMs` (default 10s) passes without
 * a stamp the chart STOPS trusting the clock — the live edge (ongoing
 * bars, the now line, the follow pin, the forward clamp) freezes at the
 * last vouched timestamp instead of extrapolating a dead feed (a finished
 * run must never render as "running forever"), ongoing bars restyle as
 * unknown (dim + hatch), a "live data stale (Ns) — reconnecting…" note
 * counts up forever, and 'stalechange' fires. The next stamp recovers,
 * gliding the edge back to the live clock — no teleports in either
 * direction (reduced motion snaps). Consumers should resync with one full
 * setData on recovery.
 *
 * Rendering is stability-first: the viewport origin is snapped to WHOLE
 * device pixels once per frame (bars keep exact relative offsets while
 * scrolling — no per-element rounding jiggle; TEXT origins are the one
 * per-element exception — they snap to the device grid for crisp glyph
 * rasterization, stepping in whole pixels while things move), bar-vs-pip
 * shapes are decided from data-space durations (never from rounded screen
 * coords, so shapes don't flicker during pans), rows are VERTICALLY
 * STICKY (a stateful per-lane TrackAllocator: a visible interval keeps
 * its sub-track while on screen — panning and live updates never
 * reshuffle the rows being watched — a returning interval remembers its
 * old row, new arrivals fill from the bottom), and lane heights derive
 * from the parallelism visible in the CURRENT window (a historical burst
 * stops padding its lane once off-screen; height changes tween ~150ms,
 * honoring prefers-reduced-motion).
 *
 * Cheap by construction: draws only when dirty (one rAF at a time), and
 * data ingest coalesces the same way — mergeData/setData/setLanes/
 * setIntervals mark the layout dirty and re-lay-out ONCE on the next rAF
 * (scheduleRebuild), so a consumer hammering mergeData in a loop, or a
 * backlog of deltas flushed on tab wake, pays one O(N) rebuild per frame
 * instead of one per call. A rAF loop runs only while something on screen
 * actually moves — follow-now
 * scroll, visible ongoing bars, tweens/gestures — and the element is
 * visible; a parked static chart schedules nothing and draws nothing.
 * While animating, frames are paced adaptively — full rate while
 * interacting (plus a short grace window), ~30fps idle, ~10fps idle on
 * battery (feature-detected via navigator.getBattery), paused while the
 * document is hidden. Those tier rates are the CEILING; when the only
 * motion is clock-driven (the follow scroll, ongoing-bar growth) the
 * effective rate is min(tier fps, device px per second) — the loop keeps
 * running and skips frames that would be pixel-identical, on an even
 * frame-aligned cadence (clockDrawBudgetMs; never timer wakes, so motion
 * stays smooth at every zoom); culled to the viewport (per-lane
 * lower-bound binary search — a drawn frame costs O(visible), never
 * O(all data)); clustering/track-assignment memoized (position-
 * independent clustering re-derives only on data/zoom/width changes;
 * assignment additionally on window-start quanta); the minimap's density
 * marks served from a pixel-shifted offscreen texture (one blit per
 * frame; merges paint only their sliver; full rebuilds run async in
 * slices); DPR-aware (capped
 * at 3), on
 * an OPAQUE canvas (subpixel text AA; keep --timeline-bg opaque).
 * Theme via --timeline-* custom properties (see THEME_DEFAULTS); the DOM
 * chrome (tooltip, live pill, empty hint) is styled by timeline-view.css.
 * The pure math lives in ui/timeline-view-math.ts (node-tested) and is
 * re-exported here so one import serves both.
 */

import {
  toMs,
  timeToX,
  xToTime,
  panView,
  clampViewToNow,
  zoomView,
  zoomFactorForWheel,
  WheelGestureRouter,
  followAfterGesture,
  FOLLOW_LEAD_FRAC,
  FOLLOW_LEAD_TWEEN_MS,
  JUMP_TO_NOW_TWEEN_MS,
  followLeadAt,
  gestureLeadFrac,
  STALE_AFTER_DEFAULT_MS,
  feedIsStale,
  snapViewToDevicePixels,
  snapTextOrigin,
  nowLineX,
  MIN_SPAN_MS,
  MAX_SPAN_MS,
  DEFAULT_SPAN_REF_MS,
  defaultSpanForAspect,
  timeTicks,
  timeTickStep,
  formatTimeTick,
  formatTimeFull,
  formatDuration,
  TrackAllocator,
  layoutLanes,
  trackTop,
  computeAutoFit,
  fitText,
  isInstantWidth,
  durationWidthPx,
  edgeContinuation,
  clusterInstants,
  clusterMarkerTime,
  clusterZoomView,
  CLUSTER_STACK_MAX_PX,
  CLUSTER_MIN_PITCH_PX,
  CLUSTER_OVERLAP_FRAC,
  type ClusterMark,
  fitSpanView,
  segmentAtTime,
  type SegmentHit,
  minimapExtent,
  minimapWindowRect,
  minimapHitZone,
  minimapPan,
  minimapResize,
  minimapCenter,
  MIN_BAR_PX,
  expandHitRect,
  hitTestPolyline,
  connectorRoute,
  categoryHue,
  categoryJitter,
  categoryColor,
  dimColor,
  labelHaloColor,
  DEFAULT_STYLES,
  CoverageTracker,
  historyProbe,
  frameBudgetMs,
  shouldRender,
  clockDrawBudgetMs,
  INTERACT_GRACE_MS,
  type RenderTier,
  type TimelineLane,
  type TimelineInterval,
  type TimelineConnector,
  type TimelineMarker,
  type TimeView,
  type TimeRange,
  type IntervalStyle,
  type StyleMap,
  type LaneLayout,
  type HitRect,
  type PackItem,
} from './timeline-view-math.ts';
import type { LaneScrollable } from './timeline-view-math.ts';

import { FADE_TAIL_CHARS, FadeTextPainter, deriveLabelTiers, fitTieredText } from './canvas-text.ts';

import TIMELINE_CSS from './timeline-view.css';

export * from './timeline-view-math.ts';

// -- Theme -----------------------------------------------------------------------

/**
 * Theme defaults — the dark "Scratch Proto" palette. Override per element /
 * ancestor / :root with the CSS custom properties named here.
 */
export const THEME_DEFAULTS = {
  /** --timeline-bg — plot background. */
  bg: '#0d0f14',
  /** --timeline-fg — bar labels and primary text. */
  fg: '#e8ecf4',
  /** --timeline-muted — axis ticks, lane labels, secondary text. */
  muted: '#6b7280',
  /** --timeline-grid — vertical time gridlines. */
  grid: 'rgba(200, 205, 216, 0.07)',
  /** --timeline-hairline — horizontal lane separators. */
  hairline: 'rgba(200, 205, 216, 0.10)',
  /** --timeline-row-tint — alternating lane tint ('none' disables). */
  rowTint: 'rgba(255, 255, 255, 0.015)',
  /** --timeline-now — the live now line + jump pill accent. */
  now: '#00e47a',
  /** --timeline-emphasis — emphasis/failed borders and glyphs. */
  emphasis: '#ff5c5c',
  /** --timeline-font — font family for all canvas text. */
  font: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
  /** --timeline-font-size — base font size in px. */
  fontSize: 11,
  /** --timeline-cat-lightness — oklch lightness for category fills (0..1). */
  catLightness: 0.62,
  /** --timeline-cat-chroma — oklch chroma for category fills. */
  catChroma: 0.11,
  /** --timeline-track-height — sub-track bar height in px (clamped 10..40). */
  trackHeight: 18,
  /**
   * --timeline-track-height-compact — sub-track height in CSS px for lanes
   * auto-fit demotes (clamped 2..track-height; the canvas' DPR scaling
   * already multiplies to device pixels, so 4 here is 8 device px at dpr 2).
   */
  trackHeightCompact: 4,
  /** --timeline-gutter-width — lane-label gutter in px (0 = auto-size). */
  gutterWidth: 0,
};

type Theme = typeof THEME_DEFAULTS;

// -- Public data / callback types ----------------------------------------------------

/** The full data payload for setData / mergeData. */
export interface TimelineData {
  lanes?: TimelineLane[];
  intervals?: TimelineInterval[];
  connectors?: TimelineConnector[];
  markers?: TimelineMarker[];
  /** Time range the supplied intervals fully cover (for async history). */
  coverage?: TimeRange;
}

/**
 * Async history loader: invoked when the viewport reaches uncovered past.
 * Supply the data via mergeData() before resolving; resolve
 * `{ exhausted: true }` when nothing exists before this range.
 */
export type LoadRangeFn = (start: number, end: number) => Promise<{ exhausted?: boolean } | void>;

/**
 * What the pointer is over — handed to tooltipFor and hover/click events.
 * 'cluster' (a stacked group of visually-overlapping instant markers) is the
 * one hit type NEVER handed to tooltipFor: its summary tooltip is
 * component-built, and clicking it zooms to the member extent instead of
 * dispatching intervalclick. An interval hit's `segment` names the phase
 * segment under the pointer (null over the base bar) — ADDITIVE, so
 * existing tooltipFor callbacks keep working unchanged and opt in by
 * reading it.
 */
export type TimelineHit =
  | { type: 'interval'; interval: TimelineInterval; lane: TimelineLane; segment?: SegmentHit | null }
  | { type: 'cluster'; intervals: TimelineInterval[]; lane: TimelineLane }
  | { type: 'connector'; connector: TimelineConnector; missingEndpoint?: 'from' | 'to' }
  | { type: 'marker'; marker: TimelineMarker }
  | { type: 'lane'; lane: TimelineLane };

/** Tooltip content callback: string or Node (never injected as HTML). */
export type TooltipFn = (hit: TimelineHit) => string | Node | null | undefined;

/** Color override callback: return a CSS color, or null for the default. */
export type ColorFn = (interval: TimelineInterval, lane: TimelineLane) => string | null | undefined;

// -- Internal shapes ---------------------------------------------------------------

interface NSeg {
  start: number;
  end: number | null;
  kind: string;
}

interface NInterval {
  src: TimelineInterval;
  id: string;
  laneIdx: number;
  start: number;
  end: number | null; // null = ongoing
  label: string;
  /** Label fallbacks, fullest → most compact; null = `label` is the only tier. */
  tiers: string[] | null;
  catKey: string;
  state: string;
  segs: NSeg[] | null;
  track: number;
  /** True while a cluster marker represents this instant (it is not drawn/hit itself). */
  clustered: boolean;
}

/**
 * A cluster of instant markers, re-derived per layout pass at the current
 * scale (clusterInstants). Occupies ONE packing slot spanning its member
 * extent — coincident instants can never blow up the lane height.
 *
 * It draws one of two ways. A POINT cluster (`point`) is narrower than a
 * pip, so it is the 3-stack glyph at one anchor. A SPREAD cluster covers
 * real time and draws its `marks` — separated ticks at true timestamps,
 * thinned as you zoom out, never merged (see
 * docs/timeline/zoom-out-never-merges.md).
 */
interface NCluster {
  /** 'cluster:' + the FIRST member's id — the sticky packing identity (stable while membership is; see packLane). */
  id: string;
  laneIdx: number;
  /** Member start-time extent — the marker anchor and the click-to-zoom target. */
  extent: TimeRange;
  /** Members in (start, id) order. */
  members: NInterval[];
  /** The members thinned to a drawable pitch (clusterInstants) — what a spread cluster draws and hit-tests by. */
  marks: ClusterMark[];
  /** Extent under a pip's width at the clustering scale: draw the stack glyph. */
  point: boolean;
  /** Uniform member category, else the lane default (see clusterKeys). */
  catKey: string;
  /** Uniform member state, else '' — the neutral treatment for mixed clusters. */
  state: string;
  track: number;
}

interface ResolvedStyle {
  fill: string;
  border: string;
  borderWidth: number;
  dash: number[] | null;
  pattern: 'solid' | 'hatch' | 'stipple' | 'outline';
  glyph: 'none' | 'bang' | 'dot';
}
// Deliberately NO label color here: a dimmed style dims its GEOMETRY
// (fill, border, hatching) only, while label text always renders at the
// full-contrast theme foreground through labelText()'s halo — deriving
// the text color from the span's style is exactly what made labels go
// grey (unreadable) over dimmed/hatched sections, flipping with zoom as
// the anchor crossed segment boundaries.

const LAYOUT_TWEEN_MS = 150; // lane-height ease on visible-track-count AND fit-height change
const AXIS_H = 22;
const LANE_LABEL_MIN_PX = 10; // below this lane height the gutter label is tooltip-only
// Floor for the compact-lane label font. Also the bottom of the range the
// cold surface warms, so keep the two together.
const LANE_LABEL_MIN_FONT_PX = 7;
const HIT_MIN_W = 9; // widened hit target for instants (px)
const CONNECTOR_TOL = 4;
const CLICK_SLOP = 4;
const EMPTY_DASH: number[] = [];
const MARKER_DASH = [4, 3];
// Label-halo stroke width (CSS px): centered on the glyph outline, so the
// visible rim is half this — thin enough to read as edge contrast, not a box.
const LABEL_HALO_PX = 3;
// A terminal-cut ('outline'-kind) segment never renders narrower than this
// many DEVICE pixels — a kill tail is typically sub-second (docker-kill
// latency), which at a 10-min window maps under half a CSS px and used to
// vanish entirely, leaving a cancelled bar pixel-identical to a success.
const TERMINAL_SEG_MIN_DEVICE_PX = 3;
// The kill-point cut line draws only when the terminal-cut tail is at
// least this wide (CSS px). Narrower tails render scrim-only: their cut
// point is within a couple of pixels of the span's end border, where a
// lone vertical line reads as a stray rendering artifact — and the scrim
// + the dashed cancelled border already carry the state at that size.
const CUT_LINE_MIN_TAIL_PX = 4;
// A dashed border needs room to read as dashes; narrower bars draw it
// solid (the hollow body still carries the state on a tiny bar).
const BORDER_DASH_MIN_PX = 12;
// Width (CSS px) of the edge-continuation shadow on a span the viewport
// clips: the clipped end darkens toward the edge — the span reads as
// sliding UNDER the window edge, which casts a shadow on it (see
// edgeContinuation for the exemptions).
const EDGE_FADE_PX = 12;
// Shadow strength at the window edge itself: black at this alpha over
// any span body (or background sliver) lands clearly DARKER than the
// page background, so the end reads covered-up, never dissolved.
const EDGE_SHADOW_ALPHA = 0.85;
// Backing-store cap: 3 keeps >2-DPR displays (150% 4K scaling, many
// laptops/mobiles) sharp instead of compositor-upscaled soft, without the
// fully-uncapped perf cliff on 4k+ screens.
const MAX_DPR = 3;
// Cluster 3-stack ghost alphas (front draws at 1).
const LANE_FIT_CACHE_MAX = 512;
// Diamonds per batched path. Measured in Chromium (2400x1200 canvas, 1200
// diamonds): 2.50 us/marker one per path, 1.75 at 8-32 per path, 2.75 at 256
// and 8.08 with all 1200 in ONE path — a giant path costs far more to
// rasterize than the calls it saves. Batching is a win only inside that
// window, so the flush is capped rather than "one path per lane".
const CLUSTER_BATCH_MAX = 32;
// Baked pip glyphs kept alive (see pipSprite). Generous enough to hold every
// (style, radius, dpr) a chart cycles through, bounded so a lane-height tween
// walking radii cannot grow it forever.
const PIP_SPRITE_CACHE_MAX = 96;
// Markers of one baked glyph a frame must hold before baking it is worth
// doing. A bake is ~82 us and saves ~0.55 us/marker, so it repays at ~150
// markers in ONE frame; at 48 it repays within about three, which a chart
// dense enough to hit it will always draw. Below that the live path wins
// outright, and a static chart with a handful of pips never bakes at all.
const PIP_SPRITE_MIN_MARKERS = 48;
const CLUSTER_MID_ALPHA = 0.65;
const CLUSTER_BACK_ALPHA = 0.35;
// The minimap strip's height (CSS px) — the plot canvas cedes this band
// at the bottom while the strip is visible. One source of truth: the
// element sets the strip canvas' CSS height from it too.
const MINIMAP_H = 32;
// Hosts shorter than this hide the strip: below ~140px the band would eat
// a third of an already-cramped plot.
const MINIMAP_MIN_HOST_PX = 140;
// Accumulated minimap-texture placement error (css px) that forces the
// async full rebuild.
const MM_DRIFT_REBUILD_PX = 1.75;
// An extent step needing more than this fraction of the strip repainted
// defers to the async rebuild instead.
const MM_STEP_MAX_FRAC = 0.25;
// Side length (CSS px) of the repeating hatch/stipple pattern tile —
// shared by tile generation (patternFor) and phase anchoring
// (anchorPattern), where translating by whole tiles must be identity.
const PATTERN_TILE_PX = 7;
// Fraction of the span the window START may drift before track assignment
// re-runs (the visible-layout memo's quantum). Small enough that an item
// entering the window rides a stale row only for a blink; large enough
// that follow-mode's per-device-pixel drift amortizes ~dozens of frames
// per assignment.
const ASSIGN_QUANTUM_FRAC = 0.02;
// Span buckets for the clustering memo: ~0.14% span change per bucket —
// float noise from the follow pin's per-frame end±span arithmetic (sub-µs
// on epoch-ms magnitudes) can never re-bucket, while any real zoom step
// crosses buckets immediately (scale-aware clustering stays "re-clusters
// as you zoom").
function spanBucket(span: number): number {
  return Math.round(Math.log2(span) * 512);
}

// -- Legend ------------------------------------------------------------------------

/**
 * A consumer-supplied legend row (`legendEntries`): a short glyph sample —
 * rendered verbatim in the swatch column — plus its plain-language
 * meaning. This is how a consumer teaches the glyphs IT composes into
 * labels (e.g. an adapter's '⧗ group · 3rd' queue badge or '⏳N' holder
 * count) alongside the component's own vocabulary.
 */
export interface TimelineLegendEntry {
  /** The glyph/badge sample (e.g. '⧗', '⏳3'). */
  glyph: string;
  /** What it means. */
  text: string;
}

// The component-OWNED glyph vocabulary shown by the "?" legend pill: each
// row pairs a CSS-drawn swatch (timeline-view.css .lg-*) with its meaning.
// Swatches use a neutral hue on purpose — they teach shape and pattern,
// never a specific category color. Consumer rows append after these.
// Entries name a GLYPH and what it means — nothing meta, no styling-policy
// notes — and only glyphs that are actually cryptic: self-explanatory
// chrome (the minimap strip, edge treatments) stays out.
const LEGEND_ROWS: readonly { swatch: string; text: string }[] = [
  { swatch: 'lg-instant', text: 'instant — a zero-duration event (filled pip)' },
  { swatch: 'lg-cancelled-pip', text: 'cancelled instant (hollow, dashed pip)' },
  { swatch: 'lg-cluster', text: 'stacked pips — several instants at one point at this zoom; zoom in or click to split' },
  { swatch: 'lg-bar lg-failed', text: 'failed — stippled body, red border, corner bang' },
  { swatch: 'lg-bar lg-hatch', text: 'hatched phase — a declared wait (lock, group slot, sleep) or queued time' },
  { swatch: 'lg-bar lg-dim', text: 'dim — queued / de-emphasized' },
  { swatch: 'lg-bar lg-killed', text: 'cancelled span — hollow, dashed; the darkened tail marks the kill point' },
];

// -- The custom element ----------------------------------------------------------------

/**
 * The timeline element. Auto-registered as `<timeline-view>` when this
 * module loads (unless the name is taken). Data arrives via properties and
 * methods — setData / mergeData / setLanes / setIntervals / setConnectors /
 * setMarkers — never attributes; the only attributes are scalar toggles:
 * `no-live-pill` (hide the jump-to-now pill), `no-auto-fit` (disable
 * compact-lane auto-fit), `history-end-text` (boundary label), `empty-text`
 * (empty-state hint), `fullscreen` (reflected viewport-fill mode — see the
 * `fullscreen` property), `no-fullscreen-button` (hide the corner toggle;
 * the property/attribute still work programmatically), `no-minimap` (hide
 * the bottom overview strip), `no-legend` (hide the "?" legend pill —
 * the in-place glyph dictionary; consumers append their own rows via the
 * `legendEntries` property).
 *
 * Auto-fit (default ON): each layout pass compares the natural lane stack
 * (every lane at --timeline-track-height) against the host's plot height;
 * while it overflows, whole lanes are demoted to the compact track height
 * (--timeline-track-height-compact, default 4px) one at a time — tallest
 * (most parallel) lane first, ties demoting the LOWER lane first so
 * top-of-chart lanes keep detail longest — until it fits or every lane is
 * compact (then the vertical lane scroll takes over as before). Demotion
 * is immediate; promotion is hysteretic (~10% headroom required) so
 * heights never flap at the boundary, and changes ease through the same
 * ~150ms layout tween as track-count changes. Read `fitState` / listen
 * for 'fitchange' to observe the demotion set.
 */
export class TimelineViewElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['no-live-pill', 'no-auto-fit', 'history-end-text', 'empty-text', 'fullscreen', 'no-fullscreen-button', 'no-minimap', 'no-legend'];
  }

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private tooltipEl: HTMLDivElement;
  private pillEl: HTMLButtonElement;
  private fsEl: HTMLButtonElement;
  private emptyEl: HTMLDivElement;
  private staleEl: HTMLDivElement;

  // -- Legend --
  private legendEl: HTMLButtonElement;
  private legendPanelEl: HTMLDivElement;
  private legendOpen = false;
  private userLegend: TimelineLegendEntry[] = [];

  // -- Minimap strip --
  private mmCanvas: HTMLCanvasElement;
  private mmCtx: CanvasRenderingContext2D | null = null;
  private mmVisible = false;
  private mmDrag: { mode: 'left' | 'right' | 'middle'; lastX: number } | null = null;
  private hadData = false; // data-emptiness edge → re-evaluate strip visibility

  // -- Data extent / cull metadata (recomputed exactly in rebuild(); grown
  // incrementally in ingestInterval so it is never stale-small between) --
  /** Max terminated end across ALL intervals (-Infinity with none) — the minimap extent's data end, O(1) per frame. */
  private mmLatestEnd = -Infinity;
  /** Ongoing (end = null) intervals, flat — live-drawn on the minimap every frame, never baked into the density texture. */
  private mmOngoing: NInterval[] = [];
  /** Per lane: max TERMINATED duration (ms; 0 when none) — the drawIntervals lower-bound cull radius. */
  private laneMaxDur: number[] = [];
  /** Per lane: earliest ONGOING start (Infinity when none) — ongoing bars block the cull down to here. */
  private laneOngoingStart: number[] = [];

  // -- Minimap density texture (the pixel-shifted offscreen cache) --
  // The strip's per-lane density marks live in an offscreen texture,
  // ALWAYS allocated 1:1 with the strip's device-pixel size and only
  // ever blitted same-size — never scaled. The time→x mapping is FROZEN
  // at mmTexExtent and steps once the live extent has drifted a whole
  // strip pixel: content SHIFTS by the whole-pixel delta (a same-size
  // copy), only newly-exposed/invalidated columns repaint from data, and
  // the residual (shift rounding + the compression a shift cannot
  // express) accumulates in mmTexDriftPx until an ASYNC sliced rebuild
  // into a second texture trues it up (also the path for geometry/theme/
  // lane-count changes; the old texture keeps serving 1:1 meanwhile —
  // skipped entirely on a size mismatch). Merges paint only their new
  // right-edge marks. The now tick and the viewport window rect are live
  // overdraws every frame — never baked in.
  private mmTex: HTMLCanvasElement | null = null;
  private mmTexCtx: CanvasRenderingContext2D | null = null;
  /** Double-buffer partner for extent steps (self-blit needs snapshot semantics). */
  private mmTexB: HTMLCanvasElement | null = null;
  private mmTexBCtx: CanvasRenderingContext2D | null = null;
  private mmTexExtent: TimeView = { start: 0, end: 1 };
  private mmTexEpoch = -1; // packEpoch the texture content reflects
  private mmTexW = 0; // device px
  private mmTexH = 0;
  private mmTexDpr = 1;
  private mmTexLaneN = -1;
  private mmTexTheme = -1; // mmThemeGen stamp
  private mmThemeGen = 0; // bumped by readTheme() — colors baked into the texture went stale
  private mmTexDriftPx = 0; // accumulated content placement error (css px) since the last full build
  private mmTexDirty = false; // a baked mark was rewritten in place → full rebuild required
  /** Terminated intervals ingested since the texture's epoch — the incremental right-edge paints. */
  private mmPendingNew: NInterval[] = [];
  private mmRebuild: {
    tex: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    extent: TimeView;
    epoch: number;
    themeGen: number;
    laneN: number;
    w: number; // device px
    h: number;
    dpr: number;
    laneIdx: number;
    itemIdx: number;
  } | null = null;
  private mmRebuildTimer: ReturnType<typeof setTimeout> | null = null;
  /** catKey → the 0.55-alpha density fill (cleared with the theme). */
  private mmDimCache = new Map<string, string>();

  // -- Fullscreen (viewport-fill) --
  // While the host carries the `fullscreen` attribute it is position:fixed
  // over the whole viewport and the PAGE scroll is locked (html overflow
  // hidden, previous inline value restored on exit) — so the page behind
  // can neither scroll nor scroll-chain, and the page's scroll offset is
  // exactly where the user left it when fullscreen exits.
  private fsLocked = false;
  private fsPrevOverflow = '';
  // The page scroll offset as last seen BEFORE the lock. Snapshotted by a
  // passive window scroll listener (frozen while locked) because reading
  // scrollY inside the attribute callback is too late: the fixed host has
  // already left the flow, the page shrank, and the browser clamped the
  // offset — the direct read would save the clamped 0, not the user's spot.
  private fsSeenScrollX = 0;
  private fsSeenScrollY = 0;

  // -- Data (normalized) --
  private lanes: TimelineLane[] = [];
  private laneIdxById = new Map<string, number>();
  private perLane: NInterval[][] = []; // sorted by (start, id)
  private byId = new Map<string, NInterval>();
  private connectors: TimelineConnector[] = [];
  private markers: { time: number; label: string; kind: string }[] = [];
  private layout: LaneLayout = { tops: [], heights: [], totalHeight: 0 };
  private styleMap: StyleMap = { ...DEFAULT_STYLES };

  // -- Viewport --
  private view: TimeView = { start: 0, end: 1 }; // seeded in the constructor; aspect-derived on first layout
  private following = true;
  // Latched by the FIRST user gesture or programmatic setViewport (every
  // window-changing path funnels through applyUserView; setViewport latches
  // explicitly too). While false, resizeBackingStore keeps (re)deriving the
  // DEFAULT span from the host's aspect ratio (defaultSpanForAspect) — a
  // chosen window must always beat the default. followNow / jumpToNow /
  // the per-frame pin move POSITION only and deliberately do NOT latch:
  // the default governs the SPAN alone.
  private viewTouched = false;
  private laneScroll = 0;
  // The ONE scalar behind every follow transition: the current lead of the
  // view's end over "now", as a fraction of the span. Steady follow pins
  // end = now + span * leadFrac with leadFrac == FOLLOW_LEAD_FRAC; steady
  // parked is 0; transitions tween it (glideLead) so engage/disengage/jump
  // GLIDE instead of teleporting the view by the full lead in one frame.
  private leadFrac = FOLLOW_LEAD_FRAC;
  private leadAnim: { from: number; target: number; start: number; dur: number } | null = null;

  // -- Feed staleness --
  // The last time the live feed vouched for the data (setData/mergeData/
  // markFresh); null until data ever arrives. When more than `staleAfter`
  // ms pass without a stamp the chart goes STALE: the live edge — ongoing
  // bar ends, the now line, the follow pin, the forward clamp — freezes at
  // lastFreshMs instead of extrapolating dead data toward now.
  private lastFreshMs: number | null = null;
  private staleAfter = STALE_AFTER_DEFAULT_MS;
  private feedStale = false;
  private edgeAnim: { from: number; start: number } | null = null; // the eased stale<->fresh live-edge transition
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private staleNoteText = '';

  // -- Async history --
  private coverage = new CoverageTracker();
  private loadRangeFn: LoadRangeFn | null = null;
  private loadTick = 0; // guards stale settles across data resets

  // -- Callbacks --
  private tooltipForFn: TooltipFn | null = null;
  private colorForFn: ColorFn | null = null;
  private nowFn: (() => number) | null = null;

  // -- Interaction state --
  private pointers = new Map<number, { x: number; y: number }>();
  private lastMouse: { x: number; y: number; cx: number; cy: number } | null = null;
  private dragTotal = 0;
  private downHit: TimelineHit | null = null;
  private hover: TimelineHit | null = null;
  private hoverIntervalId: string | null = null;
  private hoverClusterId: string | null = null; // first-member id of the hovered cluster
  private glidePx = 0; // pending discrete-wheel zoom, in wheel px
  private glideX = 0; // zoom anchor (canvas x) for the glide
  private wheelGesture = new WheelGestureRouter(); // stream-level axis lock
  private lastFrame = 0;
  private lastInputTs = -Infinity; // last wheel/drag/key input (perf-clock)
  private lastRenderTs = -Infinity; // last RENDERED frame (adaptive pacing)
  private batteryDischarging = false;
  private batteryOff: (() => void) | null = null;

  // -- Visible-window lane layout + auto-fit --
  // The old single memo keyed (epoch, rv.start, rv.end, plotW) re-ran the
  // WHOLE pack pipeline every frame in follow mode (the pin moves rv.start
  // each drawn frame). Decomposed: CLUSTERING is position-independent
  // (clusterInstants reads the view only as span — pinned by the "pure
  // pans never change membership" test), so it memoizes on
  // (epoch, span bucket, plotW); TRACK ASSIGNMENT additionally re-runs
  // when the window START has moved a quantum (ASSIGN_QUANTUM_FRAC of the
  // span) since the last pass — items only ENTER the data via merges
  // (epoch bump), and an item sliding in over a stale row for under a
  // quantum is invisible in practice. layoutLanes/auto-fit stay per-frame
  // (O(lanes), the tweens need them).
  // Memoized lane-label fitting (drawLanes). Bounded, and keyed by
  // everything the answer depends on, so it self-invalidates.
  private laneFitCache = new Map<string, { text: string; width: number; faded: boolean } | null>();
  private packEpoch = 0; // bumped on data changes; forces a re-pack
  // INCREMENTAL REBUILD. A data change used to cost O(all lanes) — re-sort
  // check, metadata scan, re-cluster and re-assign, for every lane whether or
  // not it changed. A consumer that streams its history in batches (so each
  // batch stays inside a frame budget) therefore paid that whole-chart cost
  // once PER BATCH. These track which lanes an ingest actually touched, so the
  // rebuild visits those and leaves the rest exactly as they were.
  private dirtyLanes = new Set<number>();
  private rebuildAll = true; // first rebuild, and any wholesale replace
  private laneMaxEnd: number[] = []; // per-lane latest terminated end
  private laneOngoing: NInterval[][] = []; // per-lane ongoing intervals
  private clusteredEpoch = -1;
  private clusteredSpanKey = NaN; // log-quantized span bucket (spanBucket)
  private clusteredPlotW = NaN; // clustering is scale-aware: a resize re-derives it
  private assignedEpoch = -1;
  private assignedSpanKey = NaN;
  private assignedPlotW = NaN;
  private assignedStart = NaN;
  // Per-lane clusters for the current window (rebuilt with the clustering pass).
  private laneClusters: NCluster[][] = [];
  // Per-lane pack inputs (unclustered items + one slot per cluster), cached
  // between clustering passes and re-fed to the allocator on assignment.
  private lanePackItems: PackItem[][] = [];
  private lanePackTargets: { track: number }[][] = [];
  // The unclustered items alone, per lane, in (start, id) order — the draw
  // loop iterates THIS instead of skipping clustered members one by one
  // (at busy zooms most visible instants are clustered: iterating the full
  // lane burned thousands of skip-checks per frame).
  private laneUnclustered: NInterval[][] = [];
  // Sticky row state, one allocator per lane ID (not index — lane
  // insertions must never hand one lane's row memory to another). The
  // state deliberately survives setData: a full resync must not reshuffle
  // the rows on screen.
  private allocators = new Map<string, TrackAllocator>();
  private targetCounts: number[] = []; // visible track count per lane
  private displayCounts: number[] = []; // animated (float) counts driving layout
  private targetHeights: number[] = []; // per-lane track height target (normal or compact)
  private displayHeights: number[] = []; // animated (float) per-lane track heights
  private layoutAnim: { fromCounts: number[]; fromHeights: number[]; start: number } | null = null;
  private fitCount = 0; // auto-fit hysteresis state: number of demoted lanes
  private demotedIds: string[] = []; // current demotion set (lane ids, display order)
  private fitKey = ''; // demotion-set fingerprint for fitchange dedup
  private rvCache = { start: NaN, end: NaN, w: NaN, dpr: NaN, out: { start: 0, end: 1 } as TimeView };

  // -- Rendering state --
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private theme: Theme = { ...THEME_DEFAULTS };
  private fontAxis = '';
  private fontBar = '';
  private labelHalo = labelHaloColor(THEME_DEFAULTS.fg);
  private charW = 6;
  private labelPainter = new FadeTextPainter();
  // Width model for label fitting: char-count arithmetic on the mutable
  // measureCharW (set per call site — bar labels use charW, compact gutter
  // labels a downscaled one), so no closure is allocated per frame.
  private measureCharW = 6;
  private measureLabel = (s: string): number => s.length * this.measureCharW;
  private gutterW = 90;
  private oklch = true;
  private reducedMotion = false;
  private colorCache = new Map<string, ResolvedStyle>();
  private patternCache = new Map<string, CanvasPattern>();

  private raf = 0;
  // Coalesced rebuild: data-ingest marks layout dirty and schedules ONE
  // rebuild() per animation frame rather than re-laying-out synchronously per
  // call (0 = none scheduled). See scheduleRebuild.
  private rebuildRaf = 0;
  // Frame bookkeeping for the rebuild/paint split (see rebuild()): a paint may
  // be pushed one frame past its rebuild, but never so far that the chart
  // stops painting — the test is "did a paint happen in the last frame", not
  // a one-shot flag, so a stream of merges alternates layout/paint instead of
  // stalling after the first deferral.
  private frameNo = 0;
  private lastDrawFrame = -1;
  private dirty = false;
  // Due timestamp of the next clock-paced draw — the even-spacing grid
  // used while the only motion is clock-driven and slower than the tier
  // rate (0 = grid unarmed). See onFrame: advanced by whole budgets from
  // its own previous value, never re-anchored to the actual draw time.
  private clockDrawDue = 0;
  private connected = false;
  private inView = true;
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;
  private motionMq: MediaQueryList | null = null;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(TIMELINE_CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = TIMELINE_CSS;
      shadow.append(style);
    }
    this.canvas = document.createElement('canvas');
    this.mmCanvas = document.createElement('canvas');
    this.mmCanvas.className = 'minimap';
    this.mmCanvas.style.height = `${MINIMAP_H}px`; // sized here so MINIMAP_H stays the one source of truth
    this.mmCanvas.hidden = true;
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'tooltip';
    this.pillEl = document.createElement('button');
    this.pillEl.className = 'live-pill';
    this.pillEl.type = 'button';
    this.pillEl.textContent = '▸ now';
    this.pillEl.hidden = true;
    this.pillEl.addEventListener('click', () => this.jumpToNow());
    // The fullscreen toggle sits in the corner the pill slides in next to,
    // and — unlike the pill — is visible in BOTH follow and parked modes.
    this.fsEl = document.createElement('button');
    this.fsEl.className = 'fs-pill';
    this.fsEl.type = 'button';
    this.fsEl.addEventListener('click', () => {
      this.fullscreen = !this.fullscreen;
    });
    // The "?" legend pill — stacked above the fullscreen toggle, visible in
    // both follow and parked modes (and in fullscreen: shadow chrome rides
    // the host wherever it goes) — opens the glyph-vocabulary panel. Pure
    // DOM chrome: nothing legend-related runs on the canvas hot path; the
    // panel's rows are (re)built only when it opens.
    this.legendEl = document.createElement('button');
    this.legendEl.className = 'legend-pill';
    this.legendEl.type = 'button';
    this.legendEl.textContent = '?';
    this.legendEl.title = 'legend — what the glyphs mean';
    this.legendEl.setAttribute('aria-label', 'chart legend');
    this.legendEl.setAttribute('aria-expanded', 'false');
    this.legendEl.addEventListener('click', () => this.toggleLegend());
    this.legendPanelEl = document.createElement('div');
    this.legendPanelEl.className = 'legend-panel';
    this.legendPanelEl.hidden = true;
    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'empty-hint';
    this.emptyEl.hidden = true;
    this.staleEl = document.createElement('div');
    this.staleEl.className = 'stale-note';
    this.staleEl.hidden = true;
    // fsEl precedes pillEl so `.fs-pill[hidden] ~ .live-pill` can reclaim
    // the corner when the toggle is opted out.
    shadow.append(this.canvas, this.mmCanvas, this.tooltipEl, this.fsEl, this.pillEl, this.emptyEl, this.staleEl, this.legendEl, this.legendPanelEl);

    // Seed end = now with the 3-min reference span as the never-sized
    // fallback; the first resizeBackingStore with a real host box
    // re-derives the span from the container's aspect ratio (end stays
    // anchored) while the view is still untouched.
    const now = this.nowMs();
    this.view = { start: now - DEFAULT_SPAN_REF_MS, end: now };
  }

  // -- Lifecycle -------------------------------------------------------------

  connectedCallback(): void {
    this.connected = true;
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    this.readTheme();

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resizeBackingStore());
      this.ro.observe(this);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((entries) => {
        this.inView = entries[entries.length - 1].isIntersecting;
        if (this.inView) this.invalidate();
      });
      this.io.observe(this);
    }
    if (typeof matchMedia !== 'undefined') {
      this.motionMq = matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = this.motionMq.matches;
      this.motionMq.addEventListener?.('change', this.onMotionPref);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    // Escape exits fullscreen from anywhere (focus may sit on the toggle
    // button, the page body, …). Document-level on purpose; the handler
    // acts ONLY while fullscreen — Escape is never swallowed otherwise.
    document.addEventListener('keydown', this.onDocKeyDown);
    this.fsSeenScrollX = window.scrollX;
    this.fsSeenScrollY = window.scrollY;
    window.addEventListener('scroll', this.onWinScroll, { passive: true });
    this.watchBattery();
    // Staleness watchdog: rAF stops when nothing animates, so a dead feed
    // on a parked chart would never be NOTICED without an independent
    // fixed-cadence check. It also drives the stale note's live seconds
    // counter — forever; a stale chart never gives up announcing itself.
    this.staleTimer = setInterval(() => this.updateStale(), 500);

    // {passive: false} so preventDefault stays AVAILABLE — onWheel calls it
    // only for consumed gestures (an unconsumed vertical wheel must reach
    // the page). On the HOST, not the canvas: horizontal trackpad deltas
    // over the DOM chrome floating above the plot (live pill, fullscreen
    // toggle, stale note) must be consumed too, or a back-swipe at the pan
    // boundary leaks to the browser as history navigation the moment the
    // cursor crosses a button.
    this.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.mmCanvas.addEventListener('pointerdown', this.onMMPointerDown);
    this.mmCanvas.addEventListener('pointermove', this.onMMPointerMove);
    this.mmCanvas.addEventListener('pointerup', this.onMMPointerUp);
    this.mmCanvas.addEventListener('pointercancel', this.onMMPointerUp);
    this.mmCanvas.addEventListener('pointerleave', this.onMMPointerLeave);
    this.addEventListener('keydown', this.onKeyDown);

    this.syncScrollLock(); // an already-fullscreen element locks on (re)connect
    this.resizeBackingStore();
    this.syncChrome();
    // A rebuild coalesced-but-pending at disconnect was parked; if we hold
    // data, re-lay-out on reconnect so a moved element never shows stale
    // layout (a fresh connect with no data is a cheap no-op).
    if (this.byId.size > 0) this.scheduleRebuild();
    this.invalidate();
  }

  disconnectedCallback(): void {
    this.connected = false;
    this.ro?.disconnect();
    this.ro = null;
    this.io?.disconnect();
    this.io = null;
    this.motionMq?.removeEventListener?.('change', this.onMotionPref);
    this.motionMq = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('keydown', this.onDocKeyDown);
    window.removeEventListener('scroll', this.onWinScroll);
    this.syncScrollLock(); // never leave a removed element's page scroll-locked
    this.batteryOff?.();
    this.batteryOff = null;
    if (this.staleTimer !== null) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    this.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.mmCanvas.removeEventListener('pointerdown', this.onMMPointerDown);
    this.mmCanvas.removeEventListener('pointermove', this.onMMPointerMove);
    this.mmCanvas.removeEventListener('pointerup', this.onMMPointerUp);
    this.mmCanvas.removeEventListener('pointercancel', this.onMMPointerUp);
    this.mmCanvas.removeEventListener('pointerleave', this.onMMPointerLeave);
    this.removeEventListener('keydown', this.onKeyDown);
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.rebuildRaf !== 0) {
      cancelAnimationFrame(this.rebuildRaf);
      this.rebuildRaf = 0;
    }
    this.clockDrawDue = 0;
    // Park any in-flight minimap rebuild; a reconnect's first frame
    // re-arms the slice chain (mmKickRebuild re-schedules idempotently).
    if (this.mmRebuildTimer !== null) {
      clearTimeout(this.mmRebuildTimer);
      this.mmRebuildTimer = null;
    }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name === 'fullscreen' && oldValue !== newValue) this.applyFullscreen(newValue !== null);
    if (name === 'no-minimap' && oldValue !== newValue) this.resizeBackingStore(); // strip visibility re-evaluates there
    this.syncChrome();
    // A rebuild has already spent this frame on layout; stacking the paint on
    // top of it is what makes a single frame cost layout PLUS draw (measured
    // 8-10 ms together, either alone comfortably under). Hand the draw the
    // next frame instead — but never twice running, so a stream of merges
    // still animates: drawDeferred clears as soon as a draw actually renders.
    this.dirty = true;
    if (this.raf !== 0 && this.lastDrawFrame >= this.frameNo - 1) {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.onFrame);
    } else {
      this.schedule();
    }
  }

  // -- Fullscreen (viewport-fill) ---------------------------------------------------

  /**
   * Viewport-fill mode (NOT the Fullscreen API — deliberately: no
   * permission prompt, no browser chrome transition, plain CSS): the host
   * gets the reflected boolean `fullscreen` attribute and
   * :host([fullscreen]) pins it position:fixed over the whole viewport;
   * the existing ResizeObserver → resizeBackingStore path re-derives
   * everything (layout, clustering, DPR backing store — which stays
   * capped at MAX_DPR: fullscreen must not step off the perf cliff the
   * cap exists for). Toggled by the corner button, this property, or the
   * attribute; Escape exits; 'fullscreenchange' fires on every change.
   */
  get fullscreen(): boolean {
    return this.hasAttribute('fullscreen');
  }
  set fullscreen(v: boolean) {
    this.toggleAttribute('fullscreen', v === true);
  }

  /** The fullscreen side effects (scroll lock, resize, focus, event) — attribute-change driven. */
  private applyFullscreen(on: boolean): void {
    this.syncScrollLock();
    if (this.connected) {
      // Synchronous re-back: the fixed/inset styles apply on the next
      // layout read, so resizing here avoids a one-frame stale-size flash
      // (the ResizeObserver still confirms asynchronously).
      this.resizeBackingStore();
      this.focus({ preventScroll: true }); // keyboard nav (arrows, Esc) works immediately
    }
    this.dispatchEvent(new CustomEvent('fullscreenchange', { detail: { fullscreen: on } }));
  }

  /**
   * Page scroll lock: held exactly while CONNECTED && fullscreen. The
   * page behind a viewport-filling chart must not scroll (or scroll-chain
   * from unconsumed wheel deltas). Entering fullscreen collapses the
   * host's slot in the page AND hides the root's overflow — both of which
   * reset/clamp the viewport scroll offset — so the pre-lock offset (the
   * scroll listener's snapshot) is restored on unlock: the page is
   * exactly where the user left it when fullscreen exits.
   */
  private syncScrollLock(): void {
    const want = this.isConnected && this.hasAttribute('fullscreen');
    if (want === this.fsLocked) return;
    const root = document.documentElement;
    if (want) {
      this.fsPrevOverflow = root.style.overflow;
      root.style.overflow = 'hidden';
      this.fsLocked = true; // before any clamp-induced scroll event, so the snapshot stays pre-lock
    } else {
      root.style.overflow = this.fsPrevOverflow;
      this.fsPrevOverflow = '';
      this.fsLocked = false;
      window.scrollTo(this.fsSeenScrollX, this.fsSeenScrollY);
    }
  }

  /** Passive pre-lock scroll snapshot (see fsSeenScrollX) — frozen while locked. */
  private onWinScroll = (): void => {
    if (!this.fsLocked) {
      this.fsSeenScrollX = window.scrollX;
      this.fsSeenScrollY = window.scrollY;
    }
  };

  private onDocKeyDown = (e: KeyboardEvent): void => {
    // Legend first: Escape with the panel open closes the PANEL — inside
    // fullscreen a second Escape then exits the mode.
    if (e.key === 'Escape' && this.legendOpen) {
      e.preventDefault();
      this.closeLegend();
      return;
    }
    if (e.key === 'Escape' && this.fullscreen) {
      e.preventDefault();
      this.fullscreen = false;
    }
  };

  // -- Legend ------------------------------------------------------------------------

  /**
   * Consumer-supplied legend rows, appended under the component-owned
   * vocabulary in the "?" panel — the additive hook for glyphs a consumer
   * composes into its LABELS (queue-position badges, holder counts, …),
   * which the component draws but cannot explain. Entries are copied on
   * set; malformed values are dropped; an open panel re-renders at once.
   */
  get legendEntries(): TimelineLegendEntry[] {
    return this.userLegend.map((e) => ({ ...e }));
  }
  set legendEntries(v: TimelineLegendEntry[]) {
    this.userLegend = Array.isArray(v)
      ? v
          .filter((e) => e !== null && typeof e === 'object' && typeof e.glyph === 'string' && typeof e.text === 'string')
          .map((e) => ({ glyph: e.glyph, text: e.text }))
      : [];
    if (this.legendOpen) this.buildLegendPanel();
  }

  private toggleLegend(): void {
    if (this.legendOpen) {
      this.closeLegend();
      return;
    }
    this.buildLegendPanel();
    this.legendOpen = true;
    this.legendPanelEl.hidden = false;
    this.legendEl.setAttribute('aria-expanded', 'true');
  }

  private closeLegend(): void {
    if (!this.legendOpen) return;
    this.legendOpen = false;
    this.legendPanelEl.hidden = true;
    this.legendEl.setAttribute('aria-expanded', 'false');
  }

  /** (Re)build the panel rows — only ever runs on open / live entry swap. */
  private buildLegendPanel(): void {
    const p = this.legendPanelEl;
    p.textContent = '';
    const title = document.createElement('div');
    title.className = 'lg-title';
    title.textContent = 'legend';
    p.append(title);
    for (const row of LEGEND_ROWS) p.append(this.legendRow(row.swatch, null, row.text));
    if (this.userLegend.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'lg-sep';
      p.append(sep);
      for (const e of this.userLegend) p.append(this.legendRow('lg-glyph', e.glyph, e.text));
    }
  }

  private legendRow(swatchClass: string, glyph: string | null, text: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'lg-row';
    const sw = document.createElement('span');
    sw.className = `lg-swatch ${swatchClass}`;
    if (glyph !== null) sw.textContent = glyph; // textContent only — glyphs can't inject markup
    const tx = document.createElement('span');
    tx.className = 'lg-text';
    tx.textContent = text;
    row.append(sw, tx);
    return row;
  }

  // -- Public API: data --------------------------------------------------------

  /** Replace all data (lanes, intervals, connectors, markers, coverage). */
  setData(data: TimelineData): void {
    this.lanes = [];
    this.laneIdxById.clear();
    this.byId.clear();
    this.perLane = [];
    this.connectors = [];
    this.markers = [];
    this.coverage = new CoverageTracker();
    // Lane indices are about to be renumbered from scratch — any dirt
    // recorded against the old numbering is meaningless.
    this.dirtyLanes.clear();
    this.rebuildAll = true;
    this.loadTick++;
    // A full replace invalidates every mark the minimap density texture
    // baked — the incremental queue only covers additions.
    this.mmTexDirty = true;
    this.mmPendingNew.length = 0;
    this.mergeData(data);
  }

  /**
   * Merge data into the current set: lanes/intervals/connectors dedupe by
   * id (intervals replace in place), markers append-and-dedupe by
   * (time, label, kind). The way loadRange results are supplied.
   */
  mergeData(data: TimelineData): void {
    if (data.lanes) {
      for (const lane of data.lanes) {
        const at = this.laneIdxById.get(lane.id);
        if (at !== undefined) {
          this.lanes[at] = lane;
        } else {
          this.laneIdxById.set(lane.id, this.lanes.length);
          this.lanes.push(lane);
          this.perLane.push([]);
        }
      }
    }
    if (data.intervals) {
      for (const iv of data.intervals) this.ingestInterval(iv);
    }
    if (data.connectors) {
      const key = (c: TimelineConnector): string => `${c.fromIntervalId}\u0000${c.toIntervalId}\u0000${c.kind ?? ''}`;
      const seen = new Map(this.connectors.map((c) => [key(c), c]));
      for (const c of data.connectors) seen.set(key(c), c);
      this.connectors = [...seen.values()];
    }
    if (data.markers) {
      const key = (m: { time: number; label: string; kind: string }): string => `${m.time}\u0000${m.label}\u0000${m.kind}`;
      const seen = new Set(this.markers.map(key));
      for (const m of data.markers) {
        const n = { time: toMs(m.time), label: m.label ?? '', kind: m.kind ?? '' };
        if (!seen.has(key(n))) {
          seen.add(key(n));
          this.markers.push(n);
        }
      }
      this.markers.sort((a, b) => a.time - b.time);
    }
    if (data.coverage) this.coverage.addCovered(toMs(data.coverage.start), toMs(data.coverage.end));
    this.scheduleRebuild();
    // Every delivery proves the feed is alive — stamp freshness (and exit
    // stale mode; a full setData mid-stale is the documented resync path).
    this.markFresh();
  }

  /**
   * Stamp the live feed FRESH as of `ts` (default: the current clock).
   * setData/mergeData stamp automatically; call this from polls that
   * returned "no changes" so a quiet-but-healthy feed never reads as
   * stale. When more than `staleAfterMs` passes without a stamp the chart
   * enters stale mode: the live edge (ongoing bars, the now line, the
   * follow pin) FREEZES at the last stamped time — never extrapolating
   * state the data no longer vouches for — ongoing bars restyle as
   * unknown, and a "live data stale — reconnecting" note appears until
   * the next stamp. On recovery, do ONE full resync (setData) before
   * resuming incremental merges — runs that ended during the outage
   * otherwise stay unknown.
   */
  markFresh(ts?: number | Date): void {
    // Capture where the live edge renders BEFORE the stamp moves
    // lastFreshMs: the recovery glide must start from the FROZEN edge (the
    // old stamp), not from the new one — else recovery teleports.
    const edgeBefore = this.liveEdge();
    this.lastFreshMs = ts == null ? this.nowMs() : toMs(ts);
    this.updateStale(edgeBefore);
  }

  /**
   * ms without a freshness stamp before the chart declares its feed stale
   * (default STALE_AFTER_DEFAULT_MS = 10s; tune to ~2 poll intervals).
   * Zero or a non-finite value disables staleness — for static datasets
   * that are loaded once and never fed.
   */
  get staleAfterMs(): number {
    return this.staleAfter;
  }
  set staleAfterMs(v: number) {
    this.staleAfter = typeof v === 'number' ? v : STALE_AFTER_DEFAULT_MS;
    this.updateStale();
  }

  /** Read-back of the staleness state (mirrors the latest 'stalechange'). */
  get staleState(): { stale: boolean; lastFresh: number | null } {
    return { stale: this.feedStale, lastFresh: this.lastFreshMs };
  }

  /** Individual setters (each replaces just that slice of the data). */
  setLanes(lanes: TimelineLane[]): void {
    // Replace lane set but keep intervals whose lane survives.
    const kept: TimelineInterval[] = [];
    for (const per of this.perLane) for (const n of per) kept.push(n.src);
    const connectors = this.connectors;
    const markers = this.markers;
    this.lanes = [];
    this.laneIdxById.clear();
    this.byId.clear();
    this.perLane = [];
    this.connectors = [];
    this.markers = markers;
    // Lane indices are about to be renumbered from scratch — any dirt
    // recorded against the old numbering is meaningless.
    this.dirtyLanes.clear();
    this.rebuildAll = true;
    // Lane replacement can renumber every row — the baked marks are stale.
    this.mmTexDirty = true;
    this.mmPendingNew.length = 0;
    this.mergeData({ lanes, intervals: kept, connectors });
  }

  setIntervals(intervals: TimelineInterval[]): void {
    this.byId.clear();
    this.perLane = this.lanes.map(() => []);
    // Lane indices are about to be renumbered from scratch — any dirt
    // recorded against the old numbering is meaningless.
    this.dirtyLanes.clear();
    this.rebuildAll = true;
    // Full interval replace — the baked density marks are all stale.
    this.mmTexDirty = true;
    this.mmPendingNew.length = 0;
    for (const iv of intervals) this.ingestInterval(iv);
    this.scheduleRebuild();
  }

  setConnectors(connectors: TimelineConnector[]): void {
    this.connectors = [...connectors];
    this.invalidate();
  }

  setMarkers(markers: TimelineMarker[]): void {
    this.markers = markers.map((m) => ({ time: toMs(m.time), label: m.label ?? '', kind: m.kind ?? '' }));
    this.markers.sort((a, b) => a.time - b.time);
    this.invalidate();
  }

  /** Drop everything (data, coverage, viewport stays). */
  clear(): void {
    this.setData({});
  }

  /** Style map for interval `state` / segment `kind` (spread over the built-ins). */
  get styles(): StyleMap {
    return this.styleMap;
  }
  set styles(map: StyleMap | null | undefined) {
    this.styleMap = { ...DEFAULT_STYLES, ...(map ?? {}) };
    this.colorCache.clear();
    this.invalidate();
  }

  /** Async history loader (see LoadRangeFn); null disables. */
  get loadRange(): LoadRangeFn | null {
    return this.loadRangeFn;
  }
  set loadRange(fn: LoadRangeFn | null | undefined) {
    this.loadRangeFn = fn ?? null;
    this.invalidate();
  }

  /** Tooltip content override; null restores the built-in tooltip. */
  get tooltipFor(): TooltipFn | null {
    return this.tooltipForFn;
  }
  set tooltipFor(fn: TooltipFn | null | undefined) {
    this.tooltipForFn = fn ?? null;
  }

  /** Per-interval color override; null restores category colors. */
  get colorFor(): ColorFn | null {
    return this.colorForFn;
  }
  set colorFor(fn: ColorFn | null | undefined) {
    this.colorForFn = fn ?? null;
    this.colorCache.clear();
    this.invalidate();
  }

  /** Clock override (ms since epoch) for replay/testing; null = Date.now. */
  get nowProvider(): (() => number) | null {
    return this.nowFn;
  }
  set nowProvider(fn: (() => number) | null | undefined) {
    this.nowFn = fn ?? null;
    this.invalidate();
  }

  /**
   * Current auto-fit state (read-only): whether auto-fit is enabled (no
   * `no-auto-fit` attribute) and which lanes are demoted to the compact
   * track height right now, as lane ids in display order. Mirrors the
   * latest 'fitchange' event — cheap to poll, handy for debugging.
   */
  get fitState(): { enabled: boolean; demoted: string[] } {
    return { enabled: !this.hasAttribute('no-auto-fit'), demoted: this.demotedIds.slice() };
  }

  // -- Public API: viewport ------------------------------------------------------

  /** The visible time window (ms since epoch). */
  get viewport(): TimeView {
    return { start: this.view.start, end: this.view.end };
  }

  /**
   * Jump/zoom to an explicit window (hard-stops at now; disengages follow
   * unless it ends within the 2-device-px snap zone of now).
   */
  setViewport(start: number | Date, end: number | Date): void {
    const s = toMs(start);
    const e = toMs(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || !(e > s)) return;
    // A consumer-chosen window beats the aspect default from here on
    // (applyUserView latches too — this is the explicit belt for the one
    // programmatic path consumers call directly).
    this.viewTouched = true;
    const span = Math.min(Math.max(e - s, MIN_SPAN_MS), MAX_SPAN_MS);
    this.applyUserView({ start: s, end: s + span }, { jump: true });
  }

  /**
   * Fit the viewport to ONE interval: its span full-width plus
   * `pad` fraction of it each side (default 0.05) — the run-detail-dialog
   * convenience (an embedded instance shows just the clicked span, no
   * viewport math). A thin wrapper over setViewport, so it counts as a
   * consumer-chosen window (latches viewTouched; span clamps + the now
   * stop apply; instants center in the ~2s minimum window). False when
   * the id is unknown — viewport untouched.
   */
  fitToInterval(id: string, opts?: { pad?: number }): boolean {
    const n = this.byId.get(id);
    if (!n) return false;
    const v = fitSpanView(n.start, n.end ?? this.liveEdge(), opts?.pad);
    this.setViewport(v.start, v.end);
    return true;
  }

  /** Whether the right edge is pinned to live "now" (default true). */
  get followNow(): boolean {
    return this.following;
  }
  set followNow(v: boolean) {
    if (v === this.following) return;
    if (v) {
      this.engageFollowGlide(JUMP_TO_NOW_TWEEN_MS);
    } else {
      this.following = false;
      // Same continuous exit as a backward-pan disengage: whatever lead the
      // view holds glides out instead of parking a future-showing view.
      const span = this.view.end - this.view.start;
      this.glideLead(Math.max(0, gestureLeadFrac(this.view.end, this.nowMs(), span, this.currentLead())), 0, FOLLOW_LEAD_TWEEN_MS);
    }
    this.syncChrome();
    this.emitViewport();
    this.invalidate();
  }

  /**
   * Re-engage follow mode, keeping the current span: a fast
   * JUMP_TO_NOW_TWEEN_MS glide from wherever the view is to the followed
   * position — never a single-frame teleport (reduced motion snaps).
   */
  jumpToNow(): void {
    this.engageFollowGlide(JUMP_TO_NOW_TWEEN_MS);
    this.syncChrome();
    this.emitViewport();
    this.invalidate();
  }

  /** Re-read the --timeline-* custom properties (call after retheming). */
  refreshTheme(): void {
    this.readTheme();
    this.invalidate();
  }

  // -- Data normalization ---------------------------------------------------------

  private ingestInterval(iv: TimelineInterval): void {
    let laneIdx = this.laneIdxById.get(iv.laneId);
    if (laneIdx === undefined) {
      // Unknown lane: synthesize one so data never silently disappears.
      laneIdx = this.lanes.length;
      this.laneIdxById.set(iv.laneId, laneIdx);
      this.lanes.push({ id: iv.laneId, label: iv.laneId });
      this.perLane.push([]);
    }
    this.dirtyLanes.add(laneIdx);
    const lane = this.lanes[laneIdx];
    const start = toMs(iv.start);
    const end = iv.end == null ? null : toMs(iv.end);
    const label = iv.label ?? iv.labelTiers?.[0] ?? '';
    const n: NInterval = {
      src: iv,
      id: iv.id,
      laneIdx,
      start,
      end,
      label,
      tiers: intervalLabelTiers(iv.labelTiers, label),
      catKey: iv.category ?? lane.group ?? lane.id,
      state: iv.state ?? '',
      segs: iv.segments?.length
        ? iv.segments.map((s) => ({ start: toMs(s.start), end: s.end == null ? null : toMs(s.end), kind: s.kind }))
        : null,
      track: 0,
      clustered: false,
    };
    const prev = this.byId.get(iv.id);
    if (prev) {
      // A replace can MOVE an interval between lanes: both ends changed.
      this.dirtyLanes.add(prev.laneIdx);
      const arr = this.perLane[prev.laneIdx];
      arr.splice(arr.indexOf(prev), 1);
      // Replacing an already-TERMINATED interval can rewrite a mark the
      // minimap density texture already baked — stale pixels only a full
      // repaint can clear. (An ongoing→terminated transition is the
      // normal live flow and is NOT dirtying: the ongoing version was
      // never baked, the terminated one queues below.)
      if (prev.end !== null) this.mmTexDirty = true;
    }
    this.byId.set(iv.id, n);
    this.perLane[laneIdx].push(n);
    // Incremental cull/extent metadata (grow-only here — rebuild() runs
    // right after every ingest batch and recomputes exactly, shrinking
    // included; a transiently too-large bound only costs a few loop
    // iterations, never correctness).
    if (n.end !== null) {
      if (n.end > this.mmLatestEnd) this.mmLatestEnd = n.end;
      const dur = n.end - n.start;
      if (!(this.laneMaxDur[laneIdx] >= dur)) this.laneMaxDur[laneIdx] = dur;
      // Right-edge sliver for the density texture. Bounded: past the cap
      // (a hidden strip never drains the queue, or a giant setData) the
      // queue folds into one full-rebuild flag instead of growing.
      if (this.mmPendingNew.length >= 4096) {
        this.mmPendingNew.length = 0;
        this.mmTexDirty = true;
      } else {
        this.mmPendingNew.push(n);
      }
    } else if (!(this.laneOngoingStart[laneIdx] <= n.start)) {
      this.laneOngoingStart[laneIdx] = n.start;
    }
  }

  /**
   * Re-sort and re-layout after any data change. Track assignment and lane
   * heights come from the VISIBLE window (updateVisibleLayout), so a
   * historical parallelism burst stops padding its lane once off-screen.
   */
  /**
   * Coalesce rebuild() to ONE run per animation frame. Every data-ingest
   * path (mergeData / setData / setLanes / setIntervals) marks the layout
   * dirty via this instead of re-laying-out synchronously — so a consumer
   * feeding a BURST of merges pays a single O(N) rebuild on the next frame,
   * not one per call (the per-merge rebuild is the historical "5s merge
   * spike"; 6k merges in one task froze a real dashboard for 15s). rAF is
   * parked while the tab is backgrounded, so a backlog buffered while hidden
   * collapses into a single rebuild on foreground instead of freezing the
   * main thread when it flushes. The draw is already coalesced the same way
   * (invalidate → dirty → one rAF); this gives the layout the same treatment.
   * No caller reads layout synchronously after ingest — the draw, hit-tests,
   * and minimap all read it on the frame, after this runs.
   */
  private scheduleRebuild(): void {
    if (this.rebuildRaf !== 0) return;
    this.rebuildRaf = requestAnimationFrame(() => {
      this.rebuildRaf = 0;
      this.rebuild();
    });
  }

  private rebuild(): void {
    // The lanes this pass has to look at: everything on a wholesale replace,
    // otherwise exactly the ones an ingest touched. Streaming a window in
    // batches used to re-scan, re-cluster and re-assign the WHOLE chart per
    // batch; now each batch costs its own lanes.
    const visit: number[] = [];
    if (this.rebuildAll) {
      for (let i = 0; i < this.perLane.length; i++) visit.push(i);
    } else {
      for (const i of this.dirtyLanes) if (i < this.perLane.length) visit.push(i);
    }

    // Re-sort only lanes that actually fell out of (start, id) order: a
    // live merge APPENDS near-now intervals, leaving most lanes already
    // sorted — the O(n) plain-compare check replaces an O(n log n)
    // comparator sort per lane per merge (the 5s merge spike).
    for (const li of visit) {
      const per = this.perLane[li];
      let sorted = true;
      for (let i = 1; i < per.length; i++) {
        const a = per[i - 1];
        const b = per[i];
        if (a.start > b.start || (a.start === b.start && a.id > b.id)) {
          sorted = false;
          break;
        }
      }
      if (!sorted) per.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    // Exact recompute of the cull/extent metadata the ingest path grew
    // incrementally (this pass also SHRINKS after replaces): per-lane max
    // terminated duration + earliest ongoing start (the drawIntervals
    // lower-bound cull), the global latest end (the minimap extent's data
    // end — the retired per-frame O(N) mmExtent scan), and the flat
    // ongoing list the minimap live-draws over its density texture. One
    // O(N) pass per DATA CHANGE, next to the O(N log N) re-sort that
    // already runs here — never per frame.
    {
      const laneN = this.perLane.length;
      this.laneMaxDur.length = laneN;
      this.laneOngoingStart.length = laneN;
      this.laneMaxEnd.length = laneN;
      this.laneOngoing.length = laneN;
      for (const li of visit) {
        const per = this.perLane[li];
        let maxDur = 0;
        let ongoing = Infinity;
        let maxEnd = -Infinity;
        const ongoingList: NInterval[] = [];
        for (let i = 0; i < per.length; i++) {
          const n = per[i];
          if (n.end === null) {
            if (n.start < ongoing) ongoing = n.start;
            ongoingList.push(n);
          } else {
            const dur = n.end - n.start;
            if (dur > maxDur) maxDur = dur;
            if (n.end > maxEnd) maxEnd = n.end;
          }
        }
        this.laneMaxDur[li] = maxDur;
        this.laneOngoingStart[li] = ongoing;
        this.laneMaxEnd[li] = maxEnd;
        this.laneOngoing[li] = ongoingList;
      }
      // The two GLOBAL aggregates fold from the per-lane ones, so an
      // unchanged lane is never re-scanned to compute them.
      this.mmOngoing.length = 0;
      let latest = -Infinity;
      for (let li = 0; li < laneN; li++) {
        const e = this.laneMaxEnd[li];
        if (e !== undefined && e > latest) latest = e;
        const list = this.laneOngoing[li];
        if (list !== undefined) for (let i = 0; i < list.length; i++) this.mmOngoing.push(list[i]);
      }
      this.mmLatestEnd = latest;
    }
    // Row memory follows its lane's lifetime: allocators for lanes that
    // no longer exist are dropped; surviving lanes keep theirs (so a full
    // setData resync leaves on-screen rows exactly where they were).
    for (const key of [...this.allocators.keys()]) {
      if (!this.laneIdxById.has(key)) this.allocators.delete(key);
    }
    this.packEpoch++;
    this.updateVisibleLayout(); // reads dirtyLanes/rebuildAll
    this.dirtyLanes.clear();
    this.rebuildAll = false;
    this.autoGutter();
    this.clampLaneScroll();
    // The minimap shows iff data exists; only the emptiness EDGE re-runs
    // the (layout-forcing) resize — steady-state merges never touch it.
    const hasData = this.byId.size > 0;
    if (hasData !== this.hadData) {
      this.hadData = hasData;
      this.resizeBackingStore();
    }
    this.syncChrome();
    // A rebuild has already spent this frame on layout; stacking the paint on
    // top of it is what makes a single frame cost layout PLUS draw (measured
    // 8-10 ms together, either alone comfortably under). Hand the draw the
    // next frame instead — but never twice running, so a stream of merges
    // still animates: drawDeferred clears as soon as a draw actually renders.
    this.dirty = true;
    if (this.raf !== 0 && this.lastDrawFrame >= this.frameNo - 1) {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.onFrame);
    } else {
      this.schedule();
    }
  }

  /**
   * Track assignment + lane heights from the intervals intersecting the
   * CURRENT viewport (partial overlap counts; a lane with nothing visible
   * collapses to one track). Rows are STICKY (TrackAllocator, one per
   * lane): a visible interval keeps its track while it stays on screen —
   * visible-membership churn during pans/live updates never reflows the
   * rows being watched — a returning interval remembers its old track,
   * and new arrivals take the lowest conflict-free one, so lane height
   * recovers from the bottom once a tall burst scrolls away. Auto-fit
   * then demotes lanes to the compact track height until the stack fits
   * the host (computeAutoFit — tallest lanes first, hysteretic promotion,
   * a pure function of the visible counts + host height). Count AND
   * height CHANGES ease over LAYOUT_TWEEN_MS (snapped under
   * prefers-reduced-motion). this.layout always reflects the CURRENT
   * (possibly animating) heights, and hit-testing shares it (rectFor
   * reads displayHeights), so hovers stay aligned mid-tween.
   */
  private updateVisibleLayout(): void {
    const rv = this.renderView();
    const m = this.metrics();
    const plotW = this.plotWidth();
    const span = rv.end - rv.start;
    const spanKey = spanBucket(span);
    const structure = this.targetCounts.length !== this.perLane.length;
    let changed = false;
    // CLUSTERING — position-independent (proven: membership is a function
    // of (data, span, plotW) only), so pure pans and the follow pin never
    // re-cluster. Zooming crosses span buckets and re-clusters at once.
    const needCluster =
      this.clusteredEpoch !== this.packEpoch || this.clusteredSpanKey !== spanKey || this.clusteredPlotW !== plotW || structure;
    // A DATA-ONLY pass (the epoch moved; span, width and lane set did not)
    // can only have changed the lanes the ingest touched — every other lane's
    // clusters are still exactly right, because membership is a function of
    // (that lane's data, span, plotW). Re-clustering them was the whole-chart
    // cost a batched history load paid once per batch.
    const dataOnly =
      !structure && !this.rebuildAll && this.clusteredSpanKey === spanKey && this.clusteredPlotW === plotW;
    if (needCluster) {
      // A pure zoom/resize re-cluster sees the exact objects of the last
      // pass — clusterLane's membership-identical fast path may reuse its
      // derived structures. A data change (epoch moved) always rebuilds.
      const sameData = this.clusteredEpoch === this.packEpoch && !structure;
      this.clusteredEpoch = this.packEpoch;
      this.clusteredSpanKey = spanKey;
      this.clusteredPlotW = plotW;
      this.laneClusters.length = this.perLane.length;
      this.lanePackItems.length = this.perLane.length;
      this.lanePackTargets.length = this.perLane.length;
      this.laneUnclustered.length = this.perLane.length;
      if (dataOnly) {
        // sameData is false for these by definition: their data just changed.
        for (const i of this.dirtyLanes) if (i < this.perLane.length) this.clusterLane(i, rv, plotW, false);
      } else {
        for (let i = 0; i < this.perLane.length; i++) this.clusterLane(i, rv, plotW, sameData);
      }
    }
    // TRACK ASSIGNMENT — re-runs with the clustering, and additionally
    // once the window start has drifted a quantum since the last pass.
    const needAssign =
      needCluster ||
      this.assignedEpoch !== this.packEpoch ||
      this.assignedSpanKey !== spanKey ||
      this.assignedPlotW !== plotW ||
      !(Math.abs(rv.start - this.assignedStart) < span * ASSIGN_QUANTUM_FRAC);
    if (needAssign) {
      // The same argument as the clustering above, one step further: when the
      // ONLY thing that moved is the data (window, width and lane set all
      // unchanged), an untouched lane's visible count cannot have changed, so
      // its previous count stands.
      const assignDataOnly =
        dataOnly &&
        this.assignedSpanKey === spanKey &&
        this.assignedPlotW === plotW &&
        Math.abs(rv.start - this.assignedStart) < span * ASSIGN_QUANTUM_FRAC &&
        this.targetCounts.length === this.perLane.length;
      this.assignedEpoch = this.packEpoch;
      this.assignedSpanKey = spanKey;
      this.assignedPlotW = plotW;
      this.assignedStart = rv.start;
      const prev = this.targetCounts;
      const next = assignDataOnly ? prev.slice() : new Array<number>(this.perLane.length);
      changed = structure;
      if (assignDataOnly) {
        for (const i of this.dirtyLanes) {
          if (i >= this.perLane.length) continue;
          next[i] = this.assignLane(i, rv);
          if (!changed && prev[i] !== next[i]) changed = true;
        }
      } else {
        for (let i = 0; i < this.perLane.length; i++) {
          next[i] = this.assignLane(i, rv);
          if (!changed && prev[i] !== next[i]) changed = true;
        }
      }
      this.targetCounts = next;
    }
    // Auto-fit runs every pass (cheap, pure): it must also react to host
    // resizes and theme changes, not just data/window changes. Disabled —
    // or the host still unsized — means every lane stays at full height.
    const compact = this.compactTrackH();
    const fitOn = !this.hasAttribute('no-auto-fit') && this.cssH > AXIS_H + 4;
    const fit = fitOn
      ? computeAutoFit(this.targetCounts, m, compact, this.plotHeight(), this.fitCount)
      : { demoted: new Array<boolean>(this.targetCounts.length).fill(false), count: 0 };
    this.fitCount = fit.count;
    const targetH = new Array<number>(this.targetCounts.length);
    for (let i = 0; i < targetH.length; i++) targetH[i] = fit.demoted[i] ? compact : m.trackHeight;
    if (targetH.length !== this.targetHeights.length) {
      changed = true;
    } else {
      for (let i = 0; i < targetH.length; i++) {
        if (targetH[i] !== this.targetHeights[i]) {
          changed = true;
          break;
        }
      }
    }
    this.targetHeights = targetH;
    this.emitFitChange(fit.demoted);
    if (changed) {
      if (this.reducedMotion || structure || this.displayCounts.length !== this.targetCounts.length) {
        this.displayCounts = this.targetCounts.slice();
        this.displayHeights = this.targetHeights.slice();
        this.layoutAnim = null;
      } else {
        this.layoutAnim = {
          fromCounts: this.displayCounts.slice(),
          fromHeights: this.displayHeights.slice(),
          start: this.perfNow(),
        };
      }
    }
    if (this.layoutAnim) {
      const a = this.layoutAnim;
      const p = Math.min(1, (this.perfNow() - a.start) / LAYOUT_TWEEN_MS);
      const ease = p * (2 - p); // easeOutQuad
      const n = this.targetCounts.length;
      const dispC = new Array<number>(n);
      const dispH = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        const fromC = a.fromCounts[i] ?? this.targetCounts[i];
        const fromH = a.fromHeights[i] ?? this.targetHeights[i];
        dispC[i] = fromC + (this.targetCounts[i] - fromC) * ease;
        dispH[i] = fromH + (this.targetHeights[i] - fromH) * ease;
      }
      this.displayCounts = dispC;
      this.displayHeights = dispH;
      if (p >= 1) this.layoutAnim = null;
    } else {
      if (this.displayCounts.length !== this.targetCounts.length) this.displayCounts = this.targetCounts.slice();
      if (this.displayHeights.length !== this.targetHeights.length) this.displayHeights = this.targetHeights.slice();
    }
    this.layout = layoutLanes(this.displayCounts, m, this.displayHeights);
  }

  /** The lane's sticky row allocator (created on first use; pruned with its lane in rebuild). */
  private allocatorFor(laneId: string): TrackAllocator {
    let alloc = this.allocators.get(laneId);
    if (!alloc) {
      alloc = new TrackAllocator();
      this.allocators.set(laneId, alloc);
    }
    return alloc;
  }

  /**
   * Cluster one lane at the current scale (the position-independent half
   * of the old packLane). Instant markers that visually overlap at this
   * scale merge into clusters (clusterInstants — component-native and
   * scale-aware, so zooming in splits them); each cluster becomes ONE
   * pack slot spanning its member extent, which is what keeps a burst of
   * coincident instants from blowing up the lane height. The lane's pack
   * inputs (items + write-back targets) are cached for the assignment
   * passes that run between re-clusterings.
   */
  private clusterLane(laneIdx: number, rv: TimeView, plotW: number, sameData: boolean): void {
    const per = this.perLane[laneIdx];
    const lane = this.lanes[laneIdx];
    // The pitch is a fraction of THIS lane's pip width — pips overlap, and
    // a compact lane's dots pack tighter still. Read at cluster time, so a
    // lane-height tween runs on the previous pitch until the next
    // re-cluster: a sub-pixel drift for the length of the tween.
    const pitch = Math.max(CLUSTER_MIN_PITCH_PX, this.pipWidth(laneIdx) * CLUSTER_OVERLAP_FRAC);
    const { clusters, memberOf } = clusterInstants(per, rv, plotW, pitch);
    // Membership-identical fast path — pure ZOOM/RESIZE re-clusters only
    // (`sameData`: the pack epoch is unchanged, so `per` holds exactly the
    // objects the previous pass saw; a data change always rebuilds). Most
    // zoom bucket steps change NO lane's membership, and a cluster is a
    // CONTIGUOUS run of the sorted instant order, so (count, first, last)
    // member-reference identity proves the whole membership matches — then
    // every derived structure (NCluster objects, pack items/targets, the
    // unclustered list, per-item clustered flags) is already exactly
    // right and the rebuild below is skipped wholesale.
    if (sameData) {
      const prev = this.laneClusters[laneIdx];
      if (prev !== undefined && prev.length === clusters.length && this.lanePackItems[laneIdx] !== undefined && this.laneUnclustered[laneIdx] !== undefined) {
        let same = true;
        for (let k = 0; k < clusters.length; k++) {
          const idx = clusters[k].indices;
          const pm = prev[k].members;
          if (pm.length !== idx.length || pm[0] !== per[idx[0]] || pm[pm.length - 1] !== per[idx[idx.length - 1]]) {
            same = false;
            break;
          }
        }
        if (same) {
          // Membership survives, but the marks and point-ness are functions
          // of the SCALE this pass ran at — the one thing that changed.
          for (let k = 0; k < clusters.length; k++) {
            prev[k].marks = clusters[k].marks;
            prev[k].point = this.isPointCluster(clusters[k].extent, rv, plotW);
          }
          return;
        }
      }
    }
    const ncs: NCluster[] = new Array(clusters.length);
    for (let ci = 0; ci < clusters.length; ci++) {
      const c = clusters[ci];
      const members = new Array<NInterval>(c.indices.length);
      for (let k = 0; k < c.indices.length; k++) members[k] = per[c.indices[k]];
      const keys = this.clusterKeys(members, lane);
      ncs[ci] = {
        id: `cluster:${members[0].id}`,
        laneIdx,
        extent: c.extent,
        members,
        marks: c.marks,
        point: this.isPointCluster(c.extent, rv, plotW),
        catKey: keys.catKey,
        state: keys.state,
        track: -1,
      };
    }
    const items: PackItem[] = [];
    const targets: { track: number }[] = [];
    const unclustered: NInterval[] = [];
    for (let j = 0; j < per.length; j++) {
      per[j].clustered = memberOf[j] >= 0;
      if (memberOf[j] >= 0) continue;
      items.push(per[j]);
      targets.push(per[j]);
      unclustered.push(per[j]);
    }
    for (let k = 0; k < ncs.length; k++) {
      const nc = ncs[k];
      items.push({ id: nc.id, start: nc.extent.start, end: nc.extent.end });
      targets.push(nc);
    }
    this.laneClusters[laneIdx] = ncs;
    this.lanePackItems[laneIdx] = items;
    this.lanePackTargets[laneIdx] = targets;
    this.laneUnclustered[laneIdx] = unclustered;
  }

  /** Whether a cluster's extent is small enough to draw as the stack glyph. */
  private isPointCluster(extent: TimeRange, rv: TimeView, plotW: number): boolean {
    return durationWidthPx(extent.start, extent.end, rv, plotW) <= CLUSTER_STACK_MAX_PX;
  }

  /**
   * Baked pip glyphs, keyed by style + radius + dpr + variant. ONLY the
   * glyphs whose per-marker cost is real are sprited: a dashed
   * (cancelled) pip re-derives and applies a dash pattern per marker, and
   * a cluster's 3-stack is six path ops. A plain solid pip is deliberately
   * NOT sprited — batched paths beat drawImage for it. Measured in
   * Chromium, 1200 markers on a 2400x1200 canvas, us/marker:
   *
   *   solid   batched 0.75  |  one path each 1.14  |  sprite 1.56
   *   dashed  per-path 1.80  |  sprite 1.24
   *   stack   batched 1.81  |  sprite 1.29
   *
   * Measured on a software rasterizer (headless, no GPU), which is the
   * pessimistic case for drawImage — a GPU-backed canvas blits cheaper,
   * so these are lower bounds on the sprite's advantage, never upper ones.
   *
   * BAKING IS NOT FREE, and it is the cost a sprite table usually hides:
   * 82 us for a dashed pip, 84 for a stack, nearly all of it creating the
   * canvas and its context. Against a saving of ~0.55 us/marker that is
   * ~150 markers before a sprite has paid for itself, so a bake happens
   * only once a frame actually holds PIP_SPRITE_MIN_MARKERS of that glyph
   * — below that the live path is genuinely cheaper and is what runs.
   * Returns null to say exactly that: not cached, and not worth baking.
   */
  private pipSprites = new Map<string, { img: HTMLCanvasElement; w: number; h: number; ax: number; ay: number }>();
  private styleIds = new WeakMap<ResolvedStyle, string>();
  private styleSeq = 0;

  /** Stable id for a resolved style — resolved() interns them, so identity is the key. */
  private styleId(style: ResolvedStyle): string {
    let id = this.styleIds.get(style);
    if (id === undefined) {
      id = `s${this.styleSeq++}`;
      this.styleIds.set(style, id);
    }
    return id;
  }

  /**
   * The baked glyph for one style at one radius, drawn once and blitted
   * after. `ax`/`ay` place it: subtract them from the marker's centre.
   * Radius is quantized to a half pixel so a lane-height tween re-uses
   * one sprite instead of baking a new one every frame.
   */
  private pipSprite(style: ResolvedStyle, radius: number, stack: boolean, markers: number): { img: HTMLCanvasElement; w: number; h: number; ax: number; ay: number } | null {
    const r = Math.round(radius * 2) / 2;
    const key = `${this.styleId(style)}|${r}|${this.dpr}|${stack ? 'k' : 'p'}`;
    const hit = this.pipSprites.get(key);
    if (hit) return hit;
    if (markers < PIP_SPRITE_MIN_MARKERS) return null;
    const rx = r * 0.78;
    const step = stack ? Math.max(1, Math.min(2, r * 0.35)) : 0;
    const pad = 3;
    const w = Math.ceil(rx * 2 + step * 2 + pad * 2);
    const h = Math.ceil(r * 2 + pad * 2);
    const img = document.createElement('canvas');
    img.width = Math.ceil(w * this.dpr);
    img.height = Math.ceil(h * this.dpr);
    const sctx = img.getContext('2d');
    const ax = rx + pad;
    const ay = r + pad;
    if (sctx) {
      sctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (stack) {
        // Back and mid ghosts first (offset right, faded), then the front.
        for (const [alpha, off] of [
          [CLUSTER_BACK_ALPHA, 2],
          [CLUSTER_MID_ALPHA, 1],
          [1, 0],
        ] as const) {
          sctx.globalAlpha = alpha;
          this.strokePip(sctx, style, ax + off * step, ay, r);
        }
        sctx.globalAlpha = 1;
      } else {
        this.strokePip(sctx, style, ax, ay, r);
      }
    }
    const sprite = { img, w, h, ax, ay };
    // Bounded: a lane-height tween walks radii, and every (style, dpr)
    // pair adds its own. Evicting the oldest costs one re-bake.
    if (this.pipSprites.size >= PIP_SPRITE_CACHE_MAX) {
      const oldest = this.pipSprites.keys().next().value;
      if (oldest !== undefined) this.pipSprites.delete(oldest);
    }
    this.pipSprites.set(key, sprite);
    return sprite;
  }

  /** The diamond body: fill + border, dashed when the style is. Shared by the sprite bake and the live path. */
  private strokePip(ctx: CanvasRenderingContext2D, style: ResolvedStyle, cx: number, cy: number, r: number): void {
    const rx = r * 0.78;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + rx, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - rx, cy);
    ctx.closePath();
    ctx.fillStyle = style.pattern === 'outline' ? withAlpha(style.fill, 0.15) : style.fill;
    ctx.fill();
    ctx.strokeStyle = style.border;
    ctx.lineWidth = style.glyph === 'bang' || style.border === this.theme.emphasis ? 2 : 1;
    // A dashed state reads dashed at pip size too: the declared pattern is
    // rescaled so a whole number of dash+gap cycles (3-5) closes around the
    // diamond's perimeter.
    const dashSum = style.dash ? style.dash.reduce((a, b) => a + b, 0) : 0;
    if (style.dash && dashSum > 0) {
      const perim = Math.hypot(rx, r) * 4;
      const cycles = Math.max(3, Math.min(5, Math.round(perim / 10)));
      const unit = perim / cycles / (dashSum * (style.dash.length % 2 === 1 ? 2 : 1));
      ctx.setLineDash(style.dash.map((d) => d * unit));
    }
    ctx.stroke();
    if (style.dash) ctx.setLineDash(EMPTY_DASH);
  }

  /**
   * Blit baked glyphs, each centred on its (cx, cy) and snapped to whole
   * device pixels so it stays crisp. The transform switch is hoisted out
   * of the loop deliberately — per-blit save/setTransform/restore costs
   * more than the blit it wraps, and the measurements in pipSprite are
   * for this shape.
   */
  private blitPips(ctx: CanvasRenderingContext2D, blits: readonly { sprite: { img: HTMLCanvasElement; ax: number; ay: number }; cx: number; cy: number }[]): void {
    if (blits.length === 0) return;
    const dpr = this.dpr;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const b of blits) {
      ctx.drawImage(b.sprite.img, Math.round((b.cx - b.sprite.ax) * dpr), Math.round((b.cy - b.sprite.ay) * dpr));
    }
    ctx.restore();
  }

  /** A lane's drawn pip width — pipRadius x 2 x the diamond's 0.78 aspect (drawInstant). */
  private pipWidth(laneIdx: number): number {
    return this.pipRadius(this.laneTrackHeight(laneIdx)) * 0.78 * 2;
  }

  /** Pips shrink with the track but never below a visible 4px diamond. */
  private pipRadius(trackH: number): number {
    return Math.max(2, Math.min(trackH * 0.42, 8));
  }

  /**
   * Row one lane for the current window from its cached pack inputs;
   * returns its visible track count. Rows come from the lane's sticky
   * TrackAllocator; a cluster's packing identity is its FIRST member's
   * id, stable while membership is (pure pans never change membership),
   * so a cluster's row doesn't hop frame to frame. Members ride their
   * cluster's row — hit rects and connector endpoints anchored on a
   * member resolve to the cluster's position.
   */
  private assignLane(laneIdx: number, rv: TimeView): number {
    const lane = this.lanes[laneIdx];
    const items = this.lanePackItems[laneIdx];
    const targets = this.lanePackTargets[laneIdx];
    const { tracks, trackCount } = this.allocatorFor(lane.id).assign(items, rv);
    for (let k = 0; k < tracks.length; k++) {
      if (tracks[k] >= 0) targets[k].track = tracks[k];
    }
    const ncs = this.laneClusters[laneIdx];
    for (let k = 0; k < ncs.length; k++) {
      const nc = ncs[k];
      if (nc.track >= 0) {
        const members = nc.members;
        for (let mi = 0; mi < members.length; mi++) members[mi].track = nc.track;
      }
    }
    return trackCount;
  }

  /**
   * A cluster's styling keys: the members' shared state/category where
   * uniform (an all-skipped cluster stays skip-flavored), else the
   * neutral fallbacks — '' (the default treatment) for mixed states, the
   * lane's own color for mixed categories.
   */
  private clusterKeys(members: readonly NInterval[], lane: TimelineLane): { catKey: string; state: string } {
    const laneCat = lane.group ?? lane.id;
    let state = members[0]?.state ?? '';
    let catKey = members[0]?.catKey ?? laneCat;
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      if (member.state !== state) state = '';
      if (member.catKey !== catKey) catKey = laneCat;
    }
    return { catKey, state };
  }

  // Cached — theme-derived constants, refreshed by readTheme(). metrics()
  // sits inside rectForInto on the per-bar draw path: allocating a fresh
  // object per call was ~thousands of allocations per drawn frame.
  private metricsCache = { trackHeight: THEME_DEFAULTS.trackHeight, trackGap: 2, lanePad: 3 };

  private metrics(): { trackHeight: number; trackGap: number; lanePad: number } {
    return this.metricsCache;
  }

  /** Effective compact track height: the themed value, never above the normal height. */
  private compactTrackH(): number {
    return Math.min(this.theme.trackHeightCompact, this.theme.trackHeight);
  }

  /** The (possibly animating) per-track bar height of a lane. */
  private laneTrackHeight(laneIdx: number): number {
    return this.displayHeights[laneIdx] ?? this.theme.trackHeight;
  }

  /** Fire 'fitchange' when the demotion SET (by lane id) actually changes. */
  private emitFitChange(demoted: readonly boolean[]): void {
    const ids: string[] = [];
    for (let i = 0; i < demoted.length; i++) {
      if (demoted[i] && this.lanes[i]) ids.push(this.lanes[i].id);
    }
    const key = ids.join('\u0000');
    if (key === this.fitKey) return;
    this.fitKey = key;
    this.demotedIds = ids;
    this.dispatchEvent(new CustomEvent('fitchange', { detail: { demoted: ids.slice() } }));
  }

  private autoGutter(): void {
    if (this.theme.gutterWidth > 0) {
      this.gutterW = this.theme.gutterWidth;
      return;
    }
    let maxChars = 0;
    for (const lane of this.lanes) maxChars = Math.max(maxChars, lane.label.length);
    this.gutterW = Math.round(Math.min(220, Math.max(70, maxChars * this.charW + 16)));
  }

  private nowMs(): number {
    return this.nowFn ? this.nowFn() : Date.now();
  }

  private perfNow(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private tzOffsetMs(): number {
    return -new Date().getTimezoneOffset() * 60_000;
  }

  /** Battery awareness for the idle render tier (feature-detected; absent API = AC tier). */
  private watchBattery(): void {
    type BatteryLike = {
      charging: boolean;
      addEventListener?: (type: string, fn: () => void) => void;
      removeEventListener?: (type: string, fn: () => void) => void;
    };
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }) : null;
    if (!nav || typeof nav.getBattery !== 'function') return;
    nav
      .getBattery()
      .then((b) => {
        if (!this.connected || this.batteryOff) return;
        const update = (): void => {
          this.batteryDischarging = !b.charging;
        };
        update();
        b.addEventListener?.('chargingchange', update);
        this.batteryOff = () => {
          b.removeEventListener?.('chargingchange', update);
          this.batteryDischarging = false;
        };
      })
      .catch(() => {
        /* API present but denied: stay on the AC tier */
      });
  }

  private noteInput(): void {
    this.lastInputTs = this.perfNow();
  }

  /** Current pacing tier: any live gesture/tween = full rate; else idle (AC/battery). */
  private renderTier(): RenderTier {
    if (
      this.pointers.size > 0 ||
      this.mmDrag !== null ||
      this.glidePx !== 0 ||
      this.layoutAnim !== null ||
      this.leadAnim !== null ||
      this.edgeAnim !== null
    )
      return 'interactive';
    if (this.perfNow() - this.lastInputTs < INTERACT_GRACE_MS) return 'interactive';
    return this.batteryDischarging ? 'idle-battery' : 'idle';
  }

  // -- Feed staleness ---------------------------------------------------------------

  /**
   * The LIVE EDGE every live semantic uses — ongoing (end = null) bar
   * ends, the now line, the follow pin, and the forward clamp on user
   * views: the real clock while the feed is fresh, FROZEN at lastFreshMs
   * while it is stale (liveEdgeTarget). The stale <-> fresh transition is
   * EASED (followLeadAt over JUMP_TO_NOW_TWEEN_MS): entering stale mode
   * retracts the edge from wherever it had extrapolated back to the last
   * vouched timestamp as a glide, and recovery advances it to the live
   * clock the same way — composing with the follow pin, so neither
   * transition teleports the view. Reduced motion snaps.
   */
  private liveEdge(): number {
    const target = this.feedStale && this.lastFreshMs !== null ? this.lastFreshMs : this.nowMs();
    const a = this.edgeAnim;
    if (!a) return target;
    const dur = this.reducedMotion ? 0 : JUMP_TO_NOW_TWEEN_MS;
    const elapsed = this.perfNow() - a.start;
    if (elapsed >= dur) {
      this.edgeAnim = null;
      return target;
    }
    return followLeadAt(a.from, target, elapsed, dur);
  }

  /**
   * Re-evaluate staleness; on a transition, glide the live edge and
   * announce it. `edgeFrom` overrides the glide's start point — markFresh
   * passes the edge it captured before moving the stamp.
   */
  private updateStale(edgeFrom?: number): void {
    const now = this.nowMs();
    const stale = feedIsStale(now, this.lastFreshMs, this.staleAfter);
    if (stale !== this.feedStale) {
      const from = edgeFrom ?? this.liveEdge(); // where the edge renders right now, BEFORE the flip
      this.feedStale = stale;
      this.edgeAnim = this.reducedMotion ? null : { from, start: this.perfNow() };
      this.dispatchEvent(new CustomEvent('stalechange', { detail: { stale, lastFresh: this.lastFreshMs } }));
      this.invalidate();
    }
    this.syncStaleNote(now);
  }

  /** The stale affordance: "live data stale (Ns) — reconnecting…", counting forever. */
  private syncStaleNote(now: number): void {
    if (!this.feedStale || this.lastFreshMs === null) {
      this.staleEl.hidden = true;
      this.staleNoteText = '';
      return;
    }
    this.staleEl.hidden = false;
    const secs = Math.max(0, Math.floor((now - this.lastFreshMs) / 1000));
    const text = `live data stale (${secs}s) — reconnecting…`;
    if (text !== this.staleNoteText) {
      this.staleNoteText = text;
      this.staleEl.textContent = text;
    }
  }

  // -- Viewport internals -----------------------------------------------------------

  /**
   * Advance + read the animated follow lead (fraction of span). Time-based
   * (followLeadAt), so multiple reads within a frame agree; the tween
   * clears itself the moment it lands on its target. A reduced-motion
   * preference snaps any in-flight glide to its target.
   */
  private currentLead(): number {
    const a = this.leadAnim;
    if (a) {
      this.leadFrac = followLeadAt(a.from, a.target, this.perfNow() - a.start, this.reducedMotion ? 0 : a.dur);
      if (this.leadFrac === a.target) this.leadAnim = null;
    }
    return this.leadFrac;
  }

  /** Retarget the follow-lead tween from `from` toward `target` (reduced motion snaps). */
  private glideLead(from: number, target: number, dur: number): void {
    if (this.reducedMotion || from === target) {
      this.leadFrac = target;
      this.leadAnim = null;
      return;
    }
    this.leadFrac = from;
    this.leadAnim = { from, target, start: this.perfNow(), dur };
  }

  /**
   * following := true, easing from the CURRENT view position to the
   * followed lead over `dur` — jumpToNow's glide (and the followNow
   * setter's). The seed lead may be deeply negative (a parked view far in
   * the past): the glide crosses the whole gap, decelerating into the
   * pin — never a teleport. This frame's pin lands exactly where the view
   * already is.
   */
  private engageFollowGlide(dur: number): void {
    this.following = true;
    const span = this.view.end - this.view.start;
    this.glideLead(gestureLeadFrac(this.view.end, this.liveEdge(), span, this.currentLead()), FOLLOW_LEAD_FRAC, dur);
    this.pinToNow();
  }

  private pinToNow(): void {
    const span = this.view.end - this.view.start;
    const end = this.liveEdge() + span * this.currentLead();
    this.view = { start: end - span, end };
  }

  /**
   * The disengaged counterpart of the per-tick pin: while residual follow
   * lead is still gliding out after a backward-pan disengage, the view's
   * end tracks the DECAYING ceiling now + span * lead — moving backward by
   * at most the easing step per frame — until the lead is gone or "now"
   * overtakes the parked end first. Once settled this is a no-op and the
   * view is an ordinary parked view (end <= now).
   */
  private decayLead(): void {
    if (this.leadAnim === null && this.leadFrac === 0) return;
    const now = this.liveEdge();
    if (this.view.end <= now) {
      // Lead fully consumed (or now caught up): settle to parked.
      this.leadFrac = 0;
      this.leadAnim = null;
      return;
    }
    const span = this.view.end - this.view.start;
    const ceil = now + span * this.currentLead();
    if (this.view.end > ceil) this.view = { start: ceil - span, end: ceil };
  }

  /**
   * Apply a user-driven viewport. Backward PANS disengage follow outright;
   * everything else re-engages only within FOLLOW_SNAP_DEVICE_PX device
   * pixels of the `now` end stop (followAfterGesture — the pan carve-out
   * is load-bearing: without it, small trackpad pan steps were re-pinned
   * to "now" one by one and horizontal panning never escaped follow mode).
   * The follow rule reads the RAW gesture (an overshoot past now must
   * count as "at the stop"); the view actually applied hard-stops at now
   * (clampViewToNow), so every input path — wheel, drag, pinch, keyboard,
   * setViewport — parks exactly at the end stop, which is what makes the
   * tiny re-engage zone reliably hittable. Non-zoom interactive gestures
   * keep the pin while following (a forward pan at the stop stays live);
   * ZOOMS (`zoom`) and programmatic setViewport (`jump`) are exempt.
   * Zooms because the ANCHOR must win during the gesture: while pinned,
   * the pin used to rebuild the view from `now` keeping only the zoomed
   * SPAN, so wheel/pinch zoom anchored at the now marker instead of the
   * cursor — a zoom instead re-earns follow like a fresh gesture (it
   * keeps following only when its right edge stays inside the snap zone,
   * so zooming AT the live edge stays live; anywhere else it parks with
   * the timestamp under the cursor still under the cursor, and follow
   * may re-dock magnetically on a later gesture). One asymmetry is
   * deliberate: a zoom-OUT at the live edge still can't show the future —
   * the end stop caps it right-anchored, exactly like a parked zoom-out
   * at the stop.
   *
   * The FOLLOW LEAD is eased, never assigned: engaging keeps the view
   * exactly where the gesture parked it and the per-tick pin glides end
   * out to now + span * FOLLOW_LEAD_FRAC over FOLLOW_LEAD_TWEEN_MS;
   * disengaging (a backward pan) lets the gesture's own delta consume the
   * lead and glides any residual back down (decayLead) instead of slamming
   * end to now in the same frame — the two single-frame ~2%-of-plot-width
   * teleports this replaced. Reduced motion snaps both.
   */
  private applyUserView(next: TimeView, opts?: { pan?: boolean; jump?: boolean; zoom?: boolean }): void {
    // Every user gesture (wheel, glide, drag, pinch, keyboard, minimap)
    // and programmatic setViewport funnels through here — the window is
    // now CHOSEN, so the aspect-derived default span stops applying.
    this.viewTouched = true;
    const span = next.end - next.start;
    const now = this.liveEdge(); // stale mode: gestures clamp/dock at the FROZEN edge
    const wasFollowing = this.following;
    const msPerDevPx = span / (this.plotWidth() * this.dpr);
    const stayPinned = wasFollowing && opts?.jump !== true && opts?.zoom !== true;
    this.following = followAfterGesture(stayPinned, this.view.end, next, now, opts?.pan === true, msPerDevPx);
    if (this.following) {
      // ENGAGE (or a jump landing in the snap zone) seeds the lead ease
      // from where the gesture parked; while ALREADY pinned the current
      // (possibly still easing) lead simply carries over.
      if (!stayPinned) this.glideLead(gestureLeadFrac(next.end, now, span, this.currentLead()), FOLLOW_LEAD_FRAC, FOLLOW_LEAD_TWEEN_MS);
      const end = now + span * this.currentLead();
      this.view = { start: end - span, end };
    } else {
      // DISENGAGE by a backward pan: the delta consumed lead; the residual
      // glides out. The hard forward bound is the (decaying) ceiling —
      // plain "now" once the residual is gone, i.e. for every parked view.
      if (wasFollowing) this.glideLead(Math.max(0, gestureLeadFrac(next.end, now, span, this.currentLead())), 0, FOLLOW_LEAD_TWEEN_MS);
      this.view = clampViewToNow(next, now + span * this.currentLead());
    }
    if (wasFollowing !== this.following) this.syncChrome();
    // The content moved under a resting cursor — keep hover/tooltip honest.
    if (this.lastMouse && this.pointers.size === 0) {
      const p = this.lastMouse;
      this.setHover(this.hitAt(p.x, p.y), p.cx, p.cy);
    }
    this.emitViewport();
    this.invalidate();
  }

  private emitViewport(): void {
    this.dispatchEvent(
      new CustomEvent('viewportchange', {
        detail: { start: this.view.start, end: this.view.end, followNow: this.following },
      }),
    );
  }

  private plotWidth(): number {
    return Math.max(1, this.cssW - this.gutterW);
  }

  private plotHeight(): number {
    return Math.max(1, this.cssH - AXIS_H);
  }

  private maxLaneScroll(): number {
    return Math.max(0, this.layout.totalHeight - this.plotHeight());
  }

  /**
   * Direction-aware lane-stack scrollability for wheel routing: which way
   * the stack can actually move right now. Feeding this (rather than the
   * old bare overflow bit) is what lets a plain vertical wheel scroll an
   * overflowing stack in place while still handing the page every wheel
   * the stack cannot use — routeWheel's nested-scroller contract.
   */
  private laneScrollability(): LaneScrollable {
    return { up: this.laneScroll > 0, down: this.laneScroll < this.maxLaneScroll() };
  }

  private clampLaneScroll(): void {
    this.laneScroll = Math.max(0, Math.min(this.laneScroll, this.maxLaneScroll()));
  }

  private msPerPx(): number {
    return (this.view.end - this.view.start) / this.plotWidth();
  }

  /**
   * The view all GEOMETRY goes through: origin snapped to whole device
   * pixels (memoized). One global rounding, zero per-element rounding —
   * the scene translates in integer device-pixel steps and bars never
   * jiggle relative to each other (see snapViewToDevicePixels).
   */
  private renderView(): TimeView {
    const c = this.rvCache;
    const w = this.plotWidth();
    if (c.start !== this.view.start || c.end !== this.view.end || c.w !== w || c.dpr !== this.dpr) {
      c.start = this.view.start;
      c.end = this.view.end;
      c.w = w;
      c.dpr = this.dpr;
      c.out = snapViewToDevicePixels(this.view, w, this.dpr);
    }
    return c.out;
  }

  // -- Chrome (DOM) sync ---------------------------------------------------------

  private syncChrome(): void {
    this.pillEl.hidden = this.following || this.hasAttribute('no-live-pill');
    this.legendEl.hidden = this.hasAttribute('no-legend');
    if (this.legendEl.hidden) this.closeLegend();
    const fs = this.fullscreen;
    this.fsEl.hidden = this.hasAttribute('no-fullscreen-button');
    this.fsEl.textContent = fs ? '⤡' : '⤢';
    this.fsEl.title = fs ? 'exit fullscreen (Esc)' : 'fullscreen';
    this.fsEl.setAttribute('aria-pressed', fs ? 'true' : 'false');
    this.fsEl.setAttribute('aria-label', fs ? 'exit fullscreen' : 'fullscreen');
    const empty = this.lanes.length === 0 && this.byId.size === 0;
    this.emptyEl.hidden = !empty;
    if (empty) {
      this.emptyEl.textContent = this.getAttribute('empty-text') ?? 'nothing here yet — waiting for data';
    }
  }

  // -- Scheduling ---------------------------------------------------------------

  private invalidate(): void {
    this.dirty = true;
    this.schedule();
  }

  /**
   * True while something time-based needs frames at all (tween- or
   * clock-driven). ALL motion renders on the ONE rAF loop — while this
   * holds, the loop stays armed; when it returns false the loop disarms
   * and the chart draws nothing until the next invalidate().
   */
  private animating(): boolean {
    return this.tweening() || this.clockAnimating();
  }

  /**
   * Short-lived eased transitions (zoom glide, layout/lead/edge tweens)
   * plus async-history churn — rendered at the plain tier rate, exactly
   * the pre-existing pacing.
   */
  private tweening(): boolean {
    if (this.glidePx !== 0 || this.layoutAnim !== null || this.leadAnim !== null || this.edgeAnim !== null) return true;
    // In-flight history loads AND failed ones waiting out the fixed retry
    // cadence both need frames — without the latter, a rejected loadRange in
    // a paused historical view would park silently until the next input
    // instead of retrying every ~2s.
    return this.loadRangeFn !== null && Boolean(this.coverage.pending() || this.coverage.waitingRetry(this.nowMs()));
  }

  /**
   * CLOCK-driven animation: the follow-now scroll and visible ongoing-bar
   * growth/pulse. These advance with the wall clock — one device pixel
   * per span/(plotW*dpr) ms — so while they are the ONLY motion, the rAF
   * loop keeps running but skips down to that per-pixel rate: effective
   * fps = min(tier fps, device px per second), delivered as evenly spaced
   * rAF frames (see onFrame's clockDrawDue grid), never timer wakes.
   */
  private clockAnimating(): boolean {
    // While STALE the followed view is frozen at the dead feed's edge —
    // nothing moves, so no frames (the watchdog interval keeps the note's
    // counter alive and notices recovery).
    if (this.following && !this.feedStale) return true;
    if (this.reducedMotion || this.feedStale) return false; // frozen stale bars don't pulse
    // Ongoing intervals grow/pulse only while their live edge is in view.
    const now = this.nowMs();
    if (now < this.view.start || this.byId.size === 0) return false;
    for (const per of this.perLane) {
      for (let i = per.length - 1; i >= 0; i--) {
        const n = per[i];
        if (n.end === null && n.start <= this.view.end) return true;
        if (n.end !== null && n.end < this.view.start) break; // sorted by start; cheap bail
      }
    }
    return false;
  }

  private schedule(): void {
    if (!this.connected || this.raf !== 0) return;
    if (!this.inView || document.hidden) return;
    this.raf = requestAnimationFrame(this.onFrame);
  }

  private onFrame = (t: number): void => {
    this.raf = 0;
    this.frameNo++;
    // Adaptive pacing: a pure animation frame (nothing dirty) renders only
    // when its draw budget has elapsed. The budget is the tier's — full
    // rate while interacting, ~30fps idle, ~10fps idle on battery — and,
    // while the ONLY motion is clock-driven (follow scroll, ongoing
    // bars), it widens to the view's per-device-pixel period
    // (clockDrawBudgetMs): effective fps = min(tier fps, device px/sec),
    // skipping only frames that would be pixel-identical. All delivery is
    // ON the rAF loop by skipping ticks — never a timer, so motion stays
    // frame-aligned and smooth. Dirty frames (fresh data, hover changes)
    // always render immediately.
    if (!this.dirty) {
      const tierBudget = frameBudgetMs(this.renderTier());
      const budget = this.tweening() ? tierBudget : clockDrawBudgetMs(this.view, this.plotWidth(), this.dpr, tierBudget);
      if (budget > tierBudget) {
        // Clock-only motion slower than the tier rate: gate on the even
        // due-time grid. The due advances by whole budgets from its own
        // previous value (remainder carried, never re-anchored to the
        // actual draw time), so intervals stay even frame-aligned
        // multiples of the budget instead of jittering or drifting.
        if (this.clockDrawDue === 0) this.clockDrawDue = this.lastRenderTs > 0 ? this.lastRenderTs + budget : t;
        // Budget shrank mid-grid (zoom-in without a tween): a stale due
        // must never park the chart more than one current period out.
        if (this.clockDrawDue > t + budget) this.clockDrawDue = t + budget;
        // Draw on the first rAF at/past the due point (same half-tick
        // slack as the tier gate, via shouldRender's aliasing rule).
        if (!shouldRender(t, this.clockDrawDue - budget, budget)) {
          if (this.animating()) this.schedule();
          else {
            this.lastFrame = 0;
            this.clockDrawDue = 0;
          }
          return;
        }
        this.clockDrawDue += budget;
        // Stalled past a whole period (hidden tab, long main-thread
        // block): re-anchor forward — one fresh frame now, no burst of
        // catch-up draws.
        if (this.clockDrawDue <= t) this.clockDrawDue = t + budget;
      } else {
        // Tier-paced (tweens/interaction, or the px rate meets the tier
        // rate): the pre-existing pacing, unchanged.
        this.clockDrawDue = 0;
        if (!shouldRender(t, this.lastRenderTs, budget)) {
          if (this.animating()) this.schedule();
          else this.lastFrame = 0;
          return;
        }
      }
    }
    const dt = this.lastFrame > 0 ? Math.min(100, t - this.lastFrame) : 16;
    this.lastFrame = t;
    this.lastRenderTs = t;
    this.updateStale(); // frame-accurate stale transitions while animating (the 500ms watchdog covers parked charts)
    this.stepGlide(dt);
    if (this.following) this.pinToNow();
    else this.decayLead();
    this.pumpLoad();
    this.updateVisibleLayout();
    if (this.dirty || this.animating()) {
      this.dirty = false;
      this.lastDrawFrame = this.frameNo; // a paint is happening now
      this.draw();
    }
    if (this.animating()) this.schedule();
    else {
      this.lastFrame = 0;
      this.clockDrawDue = 0;
    }
  };

  private onVisibility = (): void => {
    if (!document.hidden) this.invalidate();
  };

  private onMotionPref = (e: MediaQueryListEvent): void => {
    this.reducedMotion = e.matches;
    this.invalidate();
  };

  // -- Async history -----------------------------------------------------------

  private pumpLoad(): void {
    const fn = this.loadRangeFn;
    if (!fn) return;
    const now = this.nowMs();
    // loadRange fills BACKWARD gaps only: the probe is clamped to the
    // covered end (historyProbe), so the sliver between the last covered
    // time and the ever-advancing "now" is NEVER requested — that region
    // belongs to the consumer's live merges. Without the clamp, follow
    // mode reopened a fresh forward gap every frame and refired loadRange
    // serially at ~one request per round-trip, forever (~30 req/s).
    const probe = historyProbe(this.view, now, this.coverage.coveredEnd());
    if (!probe) return;
    const req = this.coverage.nextRequest(probe, now);
    if (!req) return;
    const tick = this.loadTick;
    const tracker = this.coverage;
    fn(req.start, req.end).then(
      (res) => {
        if (tick === this.loadTick) tracker.settle(req, { ok: true, exhausted: res?.exhausted });
        this.invalidate();
      },
      () => {
        if (tick === this.loadTick) tracker.settle(req, { ok: false }, this.nowMs());
        this.invalidate();
      },
    );
    this.invalidate();
  }

  // -- Sizing / theme ------------------------------------------------------------

  // True while the plot canvas has been (re)sized but not yet painted; see
  // the cold-surface split in draw().
  private surfaceCold = true;

  private resizeBackingStore(): void {
    this.surfaceCold = true;
    const raw = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const dpr = Math.min(MAX_DPR, raw);
    const hostH = this.clientHeight;
    // Minimap visibility is decided here — the one place that already
    // owns geometry: data must exist, the host must not be opted out or
    // too short. While visible, the PLOT canvas cedes the strip's band
    // (cssW/cssH describe the plot canvas only, so every downstream
    // computation — lane packing, auto-fit, tooltip clamps, hit tests —
    // stays consistent without knowing the strip exists). The corner
    // chrome (fullscreen toggle, live pill, "?" legend pill + panel)
    // rides up above the band via the stylesheet's
    // `canvas.minimap:not([hidden]) ~ …` lift rules — ALL of it together,
    // never from here: a partial inline lift once parked the ⤢ toggle
    // under the statically-positioned legend pill.
    const wantMM = !this.hasAttribute('no-minimap') && this.byId.size > 0 && hostH >= MINIMAP_MIN_HOST_PX;
    if (wantMM !== this.mmVisible) {
      this.mmVisible = wantMM;
      this.mmCanvas.hidden = !wantMM;
      this.canvas.style.height = wantMM ? `calc(100% - ${MINIMAP_H}px)` : '';
    }
    const bw = Math.max(1, Math.round(this.clientWidth * dpr));
    const bh = Math.max(1, Math.round(Math.max(1, hostH - (wantMM ? MINIMAP_H : 0)) * dpr));
    const mmBh = Math.max(1, Math.round(MINIMAP_H * dpr));
    const mmStale = wantMM && (this.mmCanvas.width !== bw || this.mmCanvas.height !== mmBh);
    if (bw === this.canvas.width && bh === this.canvas.height && dpr === this.dpr && !mmStale) return;
    this.canvas.width = bw;
    this.canvas.height = bh;
    if (wantMM) {
      this.mmCanvas.width = bw;
      this.mmCanvas.height = mmBh;
    }
    this.dpr = dpr;
    this.cssW = bw / dpr;
    this.cssH = bh / dpr;
    // Aspect-scaled DEFAULT zoom: until the first user gesture or
    // programmatic setViewport (viewTouched), the visible span derives
    // from the HOST box's aspect ratio — 3 min at 16:9, scaled linearly
    // (defaultSpanForAspect, clamped) — re-derived on every real resize
    // with the view END anchored. The host box (container aspect) on
    // purpose, not the plot box: the default must not couple to gutter
    // auto-sizing or minimap visibility. A chosen window is never
    // overridden — this block stops running forever once touched.
    if (!this.viewTouched) {
      const hostW = this.clientWidth;
      if (hostW > 0 && hostH > 0) {
        const span = defaultSpanForAspect(hostW, hostH);
        if (span !== this.view.end - this.view.start) {
          this.view = { start: this.view.end - span, end: this.view.end };
        }
      }
    }
    this.readTheme();
    this.clampLaneScroll();
    this.invalidate();
  }

  /**
   * The 2d context — OPAQUE (alpha: false) on purpose: the chart paints
   * its own background every frame, and an opaque canvas lets the engine
   * use subpixel text antialiasing (alpha canvases get grayscale-only) — a
   * real legibility win at 10-11px. Consequence: --timeline-bg must be an
   * opaque color (a translucent bg would composite on black, not on the
   * host).
   */
  private ctx2d(): CanvasRenderingContext2D | null {
    return (this.ctx ??= this.canvas.getContext('2d', { alpha: false }));
  }

  /** The minimap strip's 2d context — OPAQUE for the same reasons as ctx2d. */
  private mmCtx2d(): CanvasRenderingContext2D | null {
    return (this.mmCtx ??= this.mmCanvas.getContext('2d', { alpha: false }));
  }

  private readTheme(): void {
    const cs = getComputedStyle(this);
    const t = this.theme;
    t.bg = readProp(cs, '--timeline-bg', THEME_DEFAULTS.bg);
    t.fg = readProp(cs, '--timeline-fg', THEME_DEFAULTS.fg);
    t.muted = readProp(cs, '--timeline-muted', THEME_DEFAULTS.muted);
    t.grid = readProp(cs, '--timeline-grid', THEME_DEFAULTS.grid);
    t.hairline = readProp(cs, '--timeline-hairline', THEME_DEFAULTS.hairline);
    t.rowTint = readProp(cs, '--timeline-row-tint', THEME_DEFAULTS.rowTint);
    t.now = readProp(cs, '--timeline-now', THEME_DEFAULTS.now);
    t.emphasis = readProp(cs, '--timeline-emphasis', THEME_DEFAULTS.emphasis);
    t.font = readProp(cs, '--timeline-font', THEME_DEFAULTS.font);
    t.fontSize = readNum(cs, '--timeline-font-size', THEME_DEFAULTS.fontSize, 6, 24);
    t.catLightness = readNum(cs, '--timeline-cat-lightness', THEME_DEFAULTS.catLightness, 0.2, 0.95);
    t.catChroma = readNum(cs, '--timeline-cat-chroma', THEME_DEFAULTS.catChroma, 0, 0.3);
    t.trackHeight = readNum(cs, '--timeline-track-height', THEME_DEFAULTS.trackHeight, 10, 40);
    t.trackHeightCompact = readNum(cs, '--timeline-track-height-compact', THEME_DEFAULTS.trackHeightCompact, 2, 40);
    t.gutterWidth = readNum(cs, '--timeline-gutter-width', THEME_DEFAULTS.gutterWidth, 0, 400);
    this.fontAxis = `${t.fontSize - 1}px ${t.font}`;
    this.fontBar = `${t.fontSize}px ${t.font}`;
    this.metricsCache.trackHeight = t.trackHeight;
    this.labelHalo = labelHaloColor(t.fg);
    this.oklch = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('color', 'oklch(0.6 0.1 120)');
    const ctx = this.ctx2d();
    if (ctx) {
      ctx.font = this.fontBar;
      const probe = 'abcdefghijklmnop0123456789';
      this.charW = ctx.measureText(probe).width / probe.length || 6;
    }
    this.colorCache.clear();
    this.patternCache.clear();
    this.labelPainter.clear();
    // Theme colors are baked into the minimap density texture — stamp it
    // stale (an async rebuild repaints it) and drop the cached fills.
    this.mmThemeGen++;
    this.mmDimCache.clear();
    this.layout = layoutLanes(this.displayCounts, this.metrics(), this.displayHeights);
    this.autoGutter();
  }

  // -- Styles / colors -------------------------------------------------------------

  private styleFor(state: string): IntervalStyle {
    return this.styleMap[state] ?? this.styleMap[''] ?? {};
  }

  private resolved(catKey: string, state: string, override: string | null): ResolvedStyle {
    const cacheKey = `${catKey}\u0000${state}\u0000${override ?? ''}`;
    const hit = this.colorCache.get(cacheKey);
    if (hit) return hit;
    const st = this.styleFor(state);
    const t = this.theme;
    let fill: string;
    let border: string;
    if (override) {
      fill = override;
      border = override;
    } else {
      const hue = categoryHue(catKey);
      const j = categoryJitter(catKey);
      const l = clamp(t.catLightness * (st.lightnessScale ?? 1) + j.dl, 0.2, 0.92);
      const c = clamp(t.catChroma * (st.saturationScale ?? 1) + j.dc, 0, 0.3);
      const mode = this.oklch ? 'oklch' : 'hsl';
      const alpha = clamp(st.alphaScale ?? 1, 0, 1);
      fill = categoryColor(hue, { mode, lightness: l, chroma: c, alpha });
      border = categoryColor(hue, { mode, lightness: clamp(l + 0.14, 0, 0.96), chroma: c, alpha: clamp(alpha + 0.1, 0, 1) });
    }
    const emphasisBorder = st.border?.emphasis === true;
    const dimmed = st.dimmed === true;
    const finalBorder = emphasisBorder ? t.emphasis : border;
    const out: ResolvedStyle = {
      // A dimmed region is "one filter over its GEOMETRY": fill and
      // border through the same dimColor transform. Label text is
      // deliberately exempt — see labelText().
      fill: dimmed ? dimColor(fill) : fill,
      border: dimmed ? dimColor(finalBorder) : finalBorder,
      borderWidth: st.border?.width ?? 1,
      dash: st.border?.dash ?? null,
      pattern: st.pattern ?? 'solid',
      glyph: st.glyph ?? 'none',
    };
    this.colorCache.set(cacheKey, out);
    return out;
  }

  /**
   * Draw label text at GUARANTEED contrast: the full-contrast theme
   * foreground over a thin counter-color halo (strokeText under the
   * fill; labelHaloColor picks dark-under-light-fg / light-under-dark-fg
   * at theme read). Every span-surface label goes through here so
   * legibility never depends on what happens to be underneath — solid
   * fill, dimmed section, hatch stripes, a scrim — or on the zoom level
   * that decides which of those the text lands on. (Labels used to take
   * a dimmed section's dimColor(fg) — mid-grey — which was unreadable
   * over the equally-dim fill and flipped with zoom as the anchor
   * crossed segment boundaries.) Callers set font/textAlign/textBaseline;
   * lineJoin is restored to the canvas default so border/connector
   * strokes are untouched.
   */
  private labelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
    ctx.strokeStyle = this.labelHalo;
    ctx.lineWidth = LABEL_HALO_PX;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.lineJoin = 'miter';
    ctx.fillStyle = this.theme.fg;
    ctx.fillText(text, x, y);
  }

  private patternFor(kind: 'hatch' | 'stipple', color: string): CanvasPattern | null {
    const key = `${kind}\u0000${color}`;
    const hit = this.patternCache.get(key);
    if (hit) return hit;
    const size = PATTERN_TILE_PX;
    const dpr = this.dpr;
    const tile = document.createElement('canvas');
    tile.width = size * dpr;
    tile.height = size * dpr;
    const c = tile.getContext('2d');
    if (!c) return null;
    c.scale(dpr, dpr);
    c.strokeStyle = color;
    c.fillStyle = color;
    if (kind === 'hatch') {
      c.lineWidth = 1.6;
      c.beginPath();
      // 45° stripes, drawn twice so the tile wraps seamlessly.
      c.moveTo(-size / 2, size * 1.5);
      c.lineTo(size * 1.5, -size / 2);
      c.moveTo(-size / 2, size / 2);
      c.lineTo(size / 2, -size / 2);
      c.moveTo(size / 2, size * 1.5);
      c.lineTo(size * 1.5, size / 2);
      c.stroke();
    } else {
      c.beginPath();
      c.arc(size * 0.28, size * 0.28, 0.9, 0, Math.PI * 2);
      c.arc(size * 0.78, size * 0.78, 0.9, 0, Math.PI * 2);
      c.fill();
    }
    const ctx = this.ctx;
    if (!ctx) return null;
    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return null;
    pattern.setTransform?.(new DOMMatrix().scale(1 / dpr));
    this.patternCache.set(key, pattern);
    return pattern;
  }

  /**
   * Phase-anchor a cached pattern to a CONTENT origin — a span's
   * unclamped start x / track top y, a coverage gap's start — so the tile
   * grid travels 1:1 with what it fills. createPattern tiles are pinned
   * to the CANVAS origin by default: under a scrolling/panning viewport
   * that read as spans sliding over a static hatch behind a stencil
   * instead of carrying their own texture. Anchoring to the (unclamped)
   * content origin keeps the phase stable while a span is partially
   * clipped off-screen AND rides lane scrolling/height changes in y. The
   * origin folds mod the tile size — identical rendering (a whole-tile
   * translate is identity), numerically tame for far-off-screen origins —
   * and non-finite origins fall back to the canvas-anchored default.
   * setTransform REPLACES the creation-time matrix, so the 1/dpr tile
   * scale is re-applied here; call before every patterned fill — the
   * cache shares one CanvasPattern per (kind, color) and the transform is
   * read at fill time.
   */
  /** Reused by anchorPattern — setTransform reads the matrix synchronously, so one mutable instance is safe (and kills a per-patterned-fill allocation). */
  private patternMatrix = typeof DOMMatrix !== 'undefined' ? new DOMMatrix() : null;

  private anchorPattern(pat: CanvasPattern, ox: number, oy: number): CanvasPattern {
    const px = ((ox % PATTERN_TILE_PX) + PATTERN_TILE_PX) % PATTERN_TILE_PX;
    const py = ((oy % PATTERN_TILE_PX) + PATTERN_TILE_PX) % PATTERN_TILE_PX;
    const m = this.patternMatrix;
    if (m && Number.isFinite(px) && Number.isFinite(py)) {
      const s = 1 / this.dpr;
      m.a = s;
      m.b = 0;
      m.c = 0;
      m.d = s;
      m.e = px;
      m.f = py;
      pat.setTransform?.(m);
    }
    return pat;
  }

  // -- Geometry ----------------------------------------------------------------

  /**
   * CSS-px rect of an interval (valid even outside the viewport). Mapped
   * through the device-pixel-snapped render view and deliberately NOT
   * rounded per element — one global rounding policy (renderView), so bars
   * hold exact relative offsets while the viewport translates.
   */
  private rectFor(n: NInterval, now: number): HitRect {
    return this.rectForInto(n, now, { x: 0, y: 0, w: 0, h: 0 });
  }

  /** rectFor into a caller-owned rect — the draw loop's per-frame path reuses one scratch rect instead of allocating per bar. */
  private rectForInto(n: NInterval, now: number, out: HitRect): HitRect {
    const w = this.plotWidth();
    const m = this.metrics();
    const rv = this.renderView();
    const th = this.laneTrackHeight(n.laneIdx); // per-lane: compact lanes (and tweens) shrink rect + hit target together
    const xs = this.gutterW + timeToX(n.start, rv, w);
    const xe = this.gutterW + timeToX(n.end ?? now, rv, w);
    out.x = xs;
    out.y = AXIS_H + this.layout.tops[n.laneIdx] - this.laneScroll + trackTop(n.track, m, th);
    out.w = Math.max(0, xe - xs);
    out.h = th;
    return out;
  }

  /** The draw loop's reused rect (drawInterval only — hit tests and connectors keep their own). */
  private rectScratch: HitRect = { x: 0, y: 0, w: 0, h: 0 };

  // -- Hit testing ---------------------------------------------------------------

  private hitAt(x: number, y: number): TimelineHit | null {
    if (this.lanes.length === 0) return null;
    const now = this.liveEdge(); // ongoing-bar geometry must match what draw() rendered
    // Lane gutter → the lane label.
    if (y >= AXIS_H && x < this.gutterW) {
      const laneIdx = this.laneAtY(y);
      return laneIdx >= 0 ? { type: 'lane', lane: this.lanes[laneIdx] } : null;
    }
    if (y < AXIS_H || x < this.gutterW) return null;
    // Connectors first (thin, drawn on top; tight tolerance).
    for (let i = this.connectors.length - 1; i >= 0; i--) {
      const c = this.connectors[i];
      const from = this.byId.get(c.fromIntervalId);
      const to = this.byId.get(c.toIntervalId);
      if (from && to) {
        const pts = connectorRoute(this.rectFor(from, now), this.rectFor(to, now));
        if (hitTestPolyline(x, y, pts, CONNECTOR_TOL)) return { type: 'connector', connector: c };
      } else if (from || to) {
        const anchor = this.rectFor((from ?? to) as NInterval, now);
        const stub = this.stubRect(anchor, !!from);
        if (x >= stub.x && x <= stub.x + stub.w && y >= stub.y && y <= stub.y + stub.h) {
          return { type: 'connector', connector: c, missingEndpoint: from ? 'to' : 'from' };
        }
      }
    }
    // Intervals: topmost = last in draw order within the lane — which
    // puts the lane's cluster stack markers (drawn after its bars) first.
    const laneIdx = this.laneAtY(y);
    if (laneIdx >= 0) {
      const ncs = this.laneClusters[laneIdx];
      if (ncs) {
        for (let i = ncs.length - 1; i >= 0; i--) {
          const c = ncs[i];
          // A spread cluster answers per MARK — the unit it draws. The
          // whole chain would report "x240 events" over four hours, which
          // tells the pointer nothing about what it is on.
          if (!c.point) {
            const geo = this.clusterMarks(c);
            if (!geo) continue;
            for (const p of geo.pips) {
              const r = expandHitRect({ x: p.cx - (geo.r + 2), y: geo.y, w: (geo.r + 2) * 2, h: geo.th }, HIT_MIN_W);
              if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                const members = c.members.slice(p.mark.from, p.mark.to);
                // A mark standing only for itself IS one event — it opens
                // like any other pip, not as a group of one.
                if (members.length === 1) return { type: 'interval', interval: members[0].src, lane: this.lanes[laneIdx], segment: null };
                return { type: 'cluster', intervals: members.map((member) => member.src), lane: this.lanes[laneIdx] };
              }
            }
            continue;
          }
          const p = this.clusterPos(c);
          if (!p) continue;
          const r = expandHitRect({ x: p.cx - (p.r + 2), y: p.y, w: (p.r + 2) * 2, h: p.th }, HIT_MIN_W);
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            return { type: 'cluster', intervals: c.members.map((member) => member.src), lane: this.lanes[laneIdx] };
          }
        }
      }
      const per = this.perLane[laneIdx];
      for (let i = per.length - 1; i >= 0; i--) {
        const n = per[i];
        if (n.clustered) continue; // represented by its cluster's marker
        if (n.start > this.renderView().end) continue;
        const r = expandHitRect(this.rectFor(n, now), HIT_MIN_W);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          // Which phase segment the pointer's TIME falls in (data-space —
          // the expanded hit halo around instants resolves to none).
          const t = xToTime(x - this.gutterW, this.renderView(), this.plotWidth());
          const segment = n.segs ? segmentAtTime(n.segs, n.start, n.end ?? now, t) : null;
          return { type: 'interval', interval: n.src, lane: this.lanes[n.laneIdx], segment };
        }
      }
    }
    // Markers (full-height lines, generous ±3px).
    const w = this.plotWidth();
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const mx = this.gutterW + timeToX(this.markers[i].time, this.renderView(), w);
      if (Math.abs(x - mx) <= 3) {
        return { type: 'marker', marker: this.markers[i] };
      }
    }
    return null;
  }

  private laneAtY(y: number): number {
    const rel = y - AXIS_H + this.laneScroll;
    const { tops, heights } = this.layout;
    for (let i = 0; i < tops.length; i++) {
      if (rel >= tops[i] && rel < tops[i] + heights[i]) return i;
    }
    return -1;
  }

  private stubRect(anchor: HitRect, fromSide: boolean): HitRect {
    const x = fromSide ? anchor.x + anchor.w : anchor.x - 14;
    return { x, y: anchor.y + anchor.h / 2 - 5, w: 14, h: 10 };
  }

  // -- Pointer / wheel / keyboard interaction ------------------------------------------

  private toLocal(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const b = this.canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  private onWheel = (e: WheelEvent): void => {
    // Stream-level routing: the gesture router applies routeWheel's
    // per-event table to a stream's first decisive event and then LOCKS
    // that axis (e.timeStamp bounds the gesture — WHEEL_GESTURE_GAP_MS of
    // silence ends it). Consume (preventDefault) ONLY when the gesture
    // routes to the chart: a horizontal-locked stream is consumed whole
    // (its vertical jitter must never creep the page); a vertical-locked
    // stream latches lane-stack-vs-page from the stack's scrollability in
    // the wheel's direction (the nested-scroller contract): with headroom
    // it scrolls the stack in place, without — at an edge, or no
    // overflow — it routes nowhere and the page scrolls normally;
    // ctrl/meta zooms and shift pans as per-event routeWheel, outside the
    // lock. (The listener stays {passive: false} so preventDefault
    // remains available for the consumed cases.)
    const route = this.wheelGesture.route(e, this.laneScrollability(), e.timeStamp);
    if (!route.consumed) return;
    e.preventDefault();
    this.noteInput();
    const p = this.toLocal(e);
    if (e.ctrlKey || e.metaKey) {
      if (e.deltaMode === 0) {
        // Pixel-precise trackpad pinch: apply 1:1, no smoothing, no lag.
        const anchor = xToTime(p.x - this.gutterW, this.view, this.plotWidth());
        this.applyUserView(zoomView(this.view, anchor, zoomFactorForWheel(route.zoomPx)), { zoom: true });
        this.glidePx = 0;
      } else {
        // Discrete wheel steps: glide over ~130ms so they feel smooth.
        this.glidePx += route.zoomPx;
        this.glideX = p.x;
        this.invalidate();
      }
      return;
    }
    if (route.laneScrollPx !== 0) {
      this.laneScroll += route.laneScrollPx;
      this.clampLaneScroll();
    }
    if (route.panPx !== 0) {
      // A pan, possibly alongside the lane scroll (diagonal gesture).
      this.applyUserView(panView(this.view, route.panPx * this.msPerPx()), { pan: true });
    } else if (route.laneScrollPx !== 0) {
      this.invalidate();
    }
  };

  private stepGlide(dt: number): void {
    if (this.glidePx === 0) return;
    const ease = 1 - Math.exp(-dt / 45);
    let apply = this.glidePx * ease;
    if (Math.abs(this.glidePx - apply) < 0.5) apply = this.glidePx;
    this.glidePx -= apply;
    const anchor = xToTime(this.glideX - this.gutterW, this.view, this.plotWidth());
    this.applyUserView(zoomView(this.view, anchor, zoomFactorForWheel(apply)), { zoom: true });
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.noteInput();
    this.closeLegend(); // a chart gesture dismisses the legend panel
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toLocal(e);
    this.pointers.set(e.pointerId, p);
    this.dragTotal = 0;
    this.downHit = this.pointers.size === 1 ? this.hitAt(p.x, p.y) : null;
    this.focus({ preventScroll: true });
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.toLocal(e);
    if (!this.pointers.has(e.pointerId)) {
      this.updateHover(p.x, p.y, e);
      return;
    }
    const prev = this.pointers.get(e.pointerId) as { x: number; y: number };
    this.pointers.set(e.pointerId, p);
    this.noteInput();
    if (this.pointers.size === 2) {
      // Pinch zoom + two-finger pan.
      const [a, b] = [...this.pointers.values()];
      const other = a.x === p.x && a.y === p.y ? b : a;
      const distNow = Math.hypot(p.x - other.x, p.y - other.y);
      const distPrev = Math.hypot(prev.x - other.x, prev.y - other.y);
      const midX = (p.x + other.x) / 2;
      const midPrevX = (prev.x + other.x) / 2;
      let next = panView(this.view, (midPrevX - midX) * this.msPerPx());
      const zoomed = distPrev > 8 && distNow > 8;
      if (zoomed) {
        const anchor = xToTime(midX - this.gutterW, next, this.plotWidth());
        next = zoomView(next, anchor, distNow / distPrev);
      }
      this.applyUserView(next, { pan: !zoomed, zoom: zoomed });
      return;
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    this.dragTotal += Math.abs(dx) + Math.abs(dy);
    if (this.dragTotal > CLICK_SLOP) {
      this.downHit = null;
      this.canvas.style.cursor = 'grabbing';
      this.hideTooltip();
    }
    if (this.dragTotal > CLICK_SLOP || this.downHit === null) {
      let next = this.view;
      if (dx !== 0) next = panView(next, -dx * this.msPerPx());
      this.laneScroll -= dy;
      this.clampLaneScroll();
      this.applyUserView(next, { pan: true });
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.style.cursor = '';
    if (this.pointers.size > 0) return;
    if (this.downHit && this.dragTotal <= CLICK_SLOP) {
      const hit = this.downHit;
      if (hit.type === 'interval') {
        this.dispatchEvent(new CustomEvent('intervalclick', { detail: { interval: hit.interval, lane: hit.lane } }));
      } else if (hit.type === 'cluster') {
        // A cluster click ZOOMS to the member extent so the group splits
        // into its true timestamps — never an intervalclick (there is no
        // single interval to open). Coincident members re-cluster at the
        // minimum span; their tooltip lists them.
        let s = Infinity;
        let e = -Infinity;
        for (const iv of hit.intervals) {
          const ms = toMs(iv.start);
          if (ms < s) s = ms;
          if (ms > e) e = ms;
        }
        if (Number.isFinite(s)) {
          const v = clusterZoomView({ start: s, end: e });
          this.setViewport(v.start, v.end);
        }
      } else if (hit.type === 'connector') {
        this.dispatchEvent(new CustomEvent('connectorclick', { detail: { connector: hit.connector } }));
      } else if (hit.type === 'lane') {
        // A click on the gutter label — lets consumers make lanes navigable
        // (e.g. a lane per CI hook linking to that hook's page).
        this.dispatchEvent(new CustomEvent('laneclick', { detail: { lane: hit.lane } }));
      }
    }
    this.downHit = null;
  };

  private onPointerLeave = (): void => {
    this.lastMouse = null;
    if (this.pointers.size === 0) this.setHover(null, 0, 0);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.noteInput();
    const span = this.view.end - this.view.start;
    const center = (this.view.start + this.view.end) / 2;
    switch (e.key) {
      case 'ArrowLeft':
        this.applyUserView(panView(this.view, -span * (e.shiftKey ? 0.5 : 0.1)), { pan: true });
        break;
      case 'ArrowRight':
        this.applyUserView(panView(this.view, span * (e.shiftKey ? 0.5 : 0.1)), { pan: true });
        break;
      case 'ArrowUp':
        this.laneScroll -= 48;
        this.clampLaneScroll();
        this.invalidate();
        break;
      case 'ArrowDown':
        this.laneScroll += 48;
        this.clampLaneScroll();
        this.invalidate();
        break;
      case '+':
      case '=':
        this.applyUserView(zoomView(this.view, center, 1.5), { zoom: true });
        break;
      case '-':
      case '_':
        this.applyUserView(zoomView(this.view, center, 1 / 1.5), { zoom: true });
        break;
      case 'End':
        this.jumpToNow();
        break;
      case 'Home': {
        let earliest = Infinity;
        for (const per of this.perLane) if (per.length > 0) earliest = Math.min(earliest, per[0].start);
        const ex = this.coverage.exhaustedBefore;
        if (ex != null) earliest = Math.min(earliest, ex);
        if (Number.isFinite(earliest)) {
          this.applyUserView({ start: earliest - span * 0.1, end: earliest + span * 0.9 });
        }
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  };

  // -- Minimap strip ---------------------------------------------------------------

  /**
   * The strip's data extent: earliest loaded interval start — widened by
   * coverage knowledge (the first covered time, the exhausted-history
   * boundary) — through max(live edge, latest interval end). Null while
   * nothing is loaded (the strip is hidden then anyway). O(lanes) now:
   * `earliest` reads each lane's sorted head, `latest` is the
   * incrementally-maintained mmLatestEnd (recomputed exactly in
   * rebuild()) — the old per-frame O(N) full scan is gone.
   */
  private mmExtent(): TimeView | null {
    let earliest = Infinity;
    for (let li = 0; li < this.perLane.length; li++) {
      const per = this.perLane[li];
      if (per.length > 0 && per[0].start < earliest) earliest = per[0].start;
    }
    const cov = this.coverage.coveredRanges();
    return minimapExtent(
      Number.isFinite(earliest) ? earliest : null,
      Number.isFinite(this.mmLatestEnd) ? this.mmLatestEnd : null,
      this.liveEdge(),
      this.coverage.exhaustedBefore,
      cov.length > 0 ? cov[0].start : null,
    );
  }

  private mmLocalX(e: PointerEvent): { x: number; w: number } {
    const b = this.mmCanvas.getBoundingClientRect();
    return { x: e.clientX - b.left, w: Math.max(1, b.width) };
  }

  private onMMPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const ext = this.mmExtent();
    if (!ext) return;
    this.noteInput();
    this.mmCanvas.setPointerCapture(e.pointerId);
    const { x, w } = this.mmLocalX(e);
    const zone = minimapHitZone(x, minimapWindowRect(this.view, ext, w));
    if (zone === 'before' || zone === 'after') {
      // Click outside the window: center it there (a jump, so follow only
      // re-engages inside the now snap zone), then drag as a grab.
      this.applyUserView(minimapCenter(this.view, x, ext, w), { jump: true });
      this.mmDrag = { mode: 'middle', lastX: x };
    } else if (zone === 'inside') {
      this.mmDrag = { mode: 'middle', lastX: x };
    } else {
      this.mmDrag = { mode: zone === 'left-handle' ? 'left' : 'right', lastX: x };
    }
    this.mmCanvas.style.cursor = this.mmDrag.mode === 'middle' ? 'grabbing' : 'ew-resize';
    this.focus({ preventScroll: true });
  };

  private onMMPointerMove = (e: PointerEvent): void => {
    const { x, w } = this.mmLocalX(e);
    const ext = this.mmExtent();
    const d = this.mmDrag;
    if (!d) {
      if (ext) {
        const zone = minimapHitZone(x, minimapWindowRect(this.view, ext, w));
        this.mmCanvas.style.cursor =
          zone === 'left-handle' || zone === 'right-handle' ? 'ew-resize' : zone === 'inside' ? 'grab' : 'pointer';
      }
      return;
    }
    if (!ext) return;
    this.noteInput();
    if (d.mode === 'middle') {
      // Grab-the-middle: constant-width pan, 1:1 under the pointer. The
      // SAME code path as a canvas pan ({pan: true}), so a backward drag
      // disengages follow and docking at the live edge re-engages it.
      const dx = x - d.lastX;
      d.lastX = x;
      if (dx !== 0) this.applyUserView(minimapPan(this.view, dx, ext, w), { pan: true });
    } else {
      // Handles: the left edge is zoom-like (a pinned live edge stays
      // pinned — dragging it only changes the span); the right edge is
      // pan-like, so pulling the window's end backward disengages follow
      // instead of fighting the per-frame pin.
      this.applyUserView(minimapResize(this.view, d.mode, x, ext, w), { pan: d.mode === 'right' });
    }
  };

  private onMMPointerUp = (e: PointerEvent): void => {
    if (this.mmDrag !== null && this.mmCanvas.hasPointerCapture(e.pointerId)) this.mmCanvas.releasePointerCapture(e.pointerId);
    this.mmDrag = null;
    this.mmCanvas.style.cursor = '';
  };

  private onMMPointerLeave = (): void => {
    if (this.mmDrag === null) this.mmCanvas.style.cursor = '';
  };

  // -- Hover / tooltip -----------------------------------------------------------

  private updateHover(x: number, y: number, e: MouseEvent): void {
    this.lastMouse = { x, y, cx: e.clientX, cy: e.clientY };
    const hit = this.hitAt(x, y);
    this.setHover(hit, e.clientX, e.clientY);
  }

  private setHover(hit: TimelineHit | null, clientX: number, clientY: number): void {
    const prevId = this.hoverIntervalId;
    const nextId = hit?.type === 'interval' ? hit.interval.id : null;
    this.hoverIntervalId = nextId;
    this.hover = hit;
    this.canvas.style.cursor = hit ? 'pointer' : '';
    if (nextId !== prevId) {
      this.dispatchEvent(
        new CustomEvent('intervalhover', {
          detail: hit?.type === 'interval' ? { interval: hit.interval, lane: hit.lane } : { interval: null, lane: null },
        }),
      );
      this.invalidate();
    }
    // Cluster hover ring (keyed by the first member — the cluster's
    // identity). No intervalhover: a cluster is not a single interval.
    const nextCluster = hit?.type === 'cluster' ? (hit.intervals[0]?.id ?? null) : null;
    if (nextCluster !== this.hoverClusterId) {
      this.hoverClusterId = nextCluster;
      this.invalidate();
    }
    if (hit) this.showTooltip(hit, clientX, clientY);
    else this.hideTooltip();
  }

  private showTooltip(hit: TimelineHit, clientX: number, clientY: number): void {
    // Lane tooltips only earn their keep when the gutter label is degraded:
    // truncated, downsized (compact lane), or skipped below legibility.
    if (hit.type === 'lane') {
      const idx = this.laneIdxById.get(hit.lane.id);
      const lh = idx !== undefined ? (this.layout.heights[idx] ?? 0) : 0;
      const fits = lh >= this.theme.fontSize + 5 && fitText(hit.lane.label, this.gutterW - 16, this.charW) === hit.lane.label;
      if (fits) {
        this.hideTooltip();
        return;
      }
    }
    const tt = this.tooltipEl;
    tt.textContent = '';
    let content: string | Node | null | undefined;
    // Clusters never consult tooltipFor: consumers describe INTERVALS,
    // and the ×N summary (count, extent, member labels) is the
    // component's own — old adapters keep working untouched.
    if (this.tooltipForFn && hit.type !== 'cluster') {
      content = this.tooltipForFn(hit);
      if (content == null) {
        this.hideTooltip();
        return;
      }
    } else {
      content = this.defaultTooltip(hit);
      if (content == null) {
        this.hideTooltip();
        return;
      }
    }
    if (typeof content === 'string') tt.textContent = content;
    else tt.append(content);
    tt.classList.add('visible');
    // Measure at a neutral position: a stale left/top from the previous
    // show could squeeze the box against the host edge and mis-measure
    // the wrapped size the flip-to-fit math is about to use.
    tt.style.left = '0px';
    tt.style.top = '0px';
    // Position near the cursor, flipped to stay inside the host.
    const host = this.getBoundingClientRect();
    let x = clientX - host.left + 14;
    let y = clientY - host.top + 16;
    const tw = tt.offsetWidth;
    const th = tt.offsetHeight;
    if (x + tw > this.cssW - 6) x = Math.max(6, clientX - host.left - tw - 12);
    if (y + th > this.cssH - 6) y = Math.max(6, clientY - host.top - th - 12);
    tt.style.left = `${Math.round(x)}px`;
    tt.style.top = `${Math.round(y)}px`;
  }

  private hideTooltip(): void {
    this.tooltipEl.classList.remove('visible');
  }

  private defaultTooltip(hit: TimelineHit): Node | null {
    const tz = this.tzOffsetMs();
    const frag = document.createDocumentFragment();
    const row = (k: string, v: string): void => {
      const r = document.createElement('div');
      r.className = 'tt-row';
      const kEl = document.createElement('span');
      kEl.className = 'tt-k';
      kEl.textContent = k;
      const vEl = document.createElement('span');
      vEl.className = 'tt-v';
      vEl.textContent = v;
      r.append(kEl, vEl);
      frag.append(r);
    };
    if (hit.type === 'interval') {
      const iv = hit.interval;
      const n = this.byId.get(iv.id);
      if (!n) return null;
      const title = document.createElement('div');
      title.className = 'tt-title';
      const swatch = document.createElement('span');
      swatch.className = 'tt-swatch';
      swatch.style.background = this.resolved(n.catKey, n.state, this.overrideColor(n)).fill;
      title.append(swatch, document.createTextNode(n.label || n.id));
      frag.append(title);
      row('lane', hit.lane.label);
      row('category', n.catKey);
      if (n.state) row('state', n.state);
      // The phase under the pointer, named by its style-map kind — the
      // legend's vocabulary, so no legend round-trip to decode a stripe.
      if (hit.segment) row('segment', `${hit.segment.kind} · ${formatDuration(hit.segment.end - hit.segment.start)}`);
      const now = this.nowMs();
      const end = n.end ?? now;
      const fine = end - n.start < 10_000;
      row('start', formatTimeFull(n.start, tz, fine));
      row('end', n.end === null ? 'ongoing' : formatTimeFull(n.end, tz, fine));
      row('duration', formatDuration(end - n.start) + (n.end === null ? ' …' : ''));
      if (n.segs) {
        for (const s of n.segs) {
          row(s.kind, `${formatDuration((s.end ?? end) - s.start)}`);
        }
      }
    } else if (hit.type === 'cluster') {
      // The component-built ×N summary: count, member time extent, up to
      // 8 member labels, and the zoom affordance.
      const ivs = hit.intervals;
      const members: NInterval[] = [];
      for (const iv of ivs) {
        const n = this.byId.get(iv.id);
        if (n) members.push(n);
      }
      let s = Infinity;
      let e = -Infinity;
      for (const iv of ivs) {
        const ms = toMs(iv.start);
        if (ms < s) s = ms;
        if (ms > e) e = ms;
      }
      const keys = this.clusterKeys(members, hit.lane);
      const title = document.createElement('div');
      title.className = 'tt-title';
      const swatch = document.createElement('span');
      swatch.className = 'tt-swatch';
      swatch.style.background = this.resolved(keys.catKey, keys.state, null).fill;
      title.append(swatch, document.createTextNode(`×${ivs.length} events`));
      frag.append(title);
      row('lane', hit.lane.label);
      if (keys.state) row('state', keys.state);
      const fine = e - s < 10_000;
      if (e > s) {
        row('from', formatTimeFull(s, tz, fine));
        row('to', formatTimeFull(e, tz, fine));
      } else if (Number.isFinite(s)) {
        row('time', formatTimeFull(s, tz, true));
      }
      const shown = Math.min(ivs.length, 8);
      for (let i = 0; i < shown; i++) {
        const n = this.byId.get(ivs[i].id);
        row('·', n ? n.label || n.id : ivs[i].id);
      }
      if (ivs.length > shown) row('·', `+${ivs.length - shown} more`);
      const hint = document.createElement('div');
      hint.className = 'tt-k';
      hint.textContent = 'click to zoom in';
      frag.append(hint);
    } else if (hit.type === 'connector') {
      const c = hit.connector;
      const title = document.createElement('div');
      title.className = 'tt-title';
      title.textContent = c.label ?? c.kind ?? 'link';
      frag.append(title);
      const name = (id: string): string => {
        const n = this.byId.get(id);
        return n ? n.label || n.id : `${id} (missing)`;
      };
      row('from', name(c.fromIntervalId));
      row('to', name(c.toIntervalId));
      if (hit.missingEndpoint) row('note', `${hit.missingEndpoint} endpoint not loaded`);
    } else if (hit.type === 'marker') {
      const title = document.createElement('div');
      title.className = 'tt-title';
      title.textContent = hit.marker.label ?? 'marker';
      frag.append(title);
      row('time', formatTimeFull(toMs(hit.marker.time), tz));
    } else {
      const title = document.createElement('div');
      title.className = 'tt-title';
      title.textContent = hit.lane.label;
      frag.append(title);
      row('lane id', hit.lane.id);
    }
    return frag;
  }

  private overrideColor(n: NInterval): string | null {
    if (!this.colorForFn) return null;
    return this.colorForFn(n.src, this.lanes[n.laneIdx]) ?? null;
  }

  // -- Drawing -------------------------------------------------------------------

  private draw(): void {
    const raw = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    if (Math.min(MAX_DPR, raw) !== this.dpr) this.resizeBackingStore();
    const ctx = this.ctx2d();
    if (!ctx || this.cssW < 4 || this.cssH < 4) return;
    const t = this.theme;
    const dpr = this.dpr;
    const w = this.cssW;
    const h = this.cssH;
    const now = this.liveEdge(); // frozen at lastFresh while stale — bars never extrapolate a dead feed
    const gx = this.gutterW;
    const plotW = this.plotWidth();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, w, h);

    // A COLD SURFACE is a frame's worth of work by itself: allocating the
    // backing store and first-touching ~11 MB of pixels costs several ms
    // where the rasterizer is software, and doing it in the same frame as the
    // first real render measured 8-11 ms — the one frame in a whole session
    // that missed the budget. So the cold frame establishes the surface and
    // stops; the next frame draws the chart into a surface that is already
    // warm. Costs one extra frame after a create or a resize, and nothing
    // afterwards.
    if (this.surfaceCold) {
      this.surfaceCold = false;
      // Warm the text pipeline while this frame is otherwise idle. The first
      // measureText/fillText with a given font shapes its glyphs, and paying
      // that for the axis ticks and every lane label inside the first REAL
      // draw is what pushed that frame to 9-10 ms. A cold frame that has
      // nothing else to do is exactly where it belongs.
      // Every size a lane label can be drawn at, not just the base one: a
      // compact lane picks its font from its own height, so the first draw
      // that lands with lanes at mixed heights shapes glyphs at several sizes
      // at once (measured: drawLanes 8 ms on that one frame).
      ctx.textBaseline = 'middle';
      ctx.fillStyle = t.bg; // paint warm glyphs offscreen-left, invisible
      for (let fs = LANE_LABEL_MIN_FONT_PX; fs <= t.fontSize; fs++) {
        ctx.font = `${fs}px ${t.font}`;
        ctx.measureText('0123456789:.-/{}_ abcdefghijklmnopqrstuvwxyz');
        ctx.measureText('ABCDEFGHIJKLMNOPQRSTUVWXYZ\u21d0\u21d2\u2026');
        ctx.fillText('0', -100, -100);
      }
      ctx.font = this.fontBar;
      this.dirty = true;
      this.schedule();
      return;
    }

    this.drawAxisAndGrid(ctx, now);
    this.drawLanes(ctx);

    // Plot-area clip for time-domain content.
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, AXIS_H, plotW, h - AXIS_H);
    ctx.clip();

    this.drawCoverage(ctx, now);
    this.drawIntervals(ctx, now);
    this.drawConnectors(ctx, now);
    this.drawMarkers(ctx);
    this.drawNowLine(ctx, now);

    ctx.restore();

    // Axis base hairline over everything.
    ctx.strokeStyle = t.hairline;
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    const yAxis = snap(AXIS_H, dpr);
    ctx.moveTo(0, yAxis);
    ctx.lineTo(w, yAxis);
    ctx.stroke();

    this.drawMinimap();
  }

  /**
   * The minimap strip: the FULL loaded extent (mmExtent) as per-lane
   * collapsed density marks in category hues at low alpha (no text), the
   * live edge as a now tick, and the current viewport as a brighter
   * window rect with grabbable edge handles. Rendered only from draw() —
   * the strip repaints exactly when the main chart does (same rAF loop,
   * same dirty flag, same idle pacing), never on its own schedule.
   *
   * The density marks are served from an offscreen TEXTURE (one blit per
   * frame) instead of the old O(all-intervals) per-frame refill — see the
   * mmTex field block: 1:1 device-size texture, whole-pixel shift steps,
   * incremental right-edge paints on merge, async sliced full rebuilds,
   * atomic swap. Only the now tick, the window rect, and the handful of
   * ONGOING interval marks (their ends track the live clock) draw per
   * frame.
   */
  private drawMinimap(): void {
    if (!this.mmVisible) return;
    const ctx = this.mmCtx2d();
    if (!ctx || this.cssW < 4) return;
    const t = this.theme;
    const dpr = this.dpr;
    const w = this.cssW;
    const h = MINIMAP_H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, w, h);
    // A faint band tint + top hairline set the strip off from the plot.
    ctx.fillStyle = 'rgba(128, 138, 158, 0.05)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = t.hairline;
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    const yTop = snap(0, dpr);
    ctx.moveTo(0, yTop);
    ctx.lineTo(w, yTop);
    ctx.stroke();
    const ext = this.mmExtent();
    if (!ext) return;
    const now = this.liveEdge();
    // Keep the density texture current (steps/increments/rebuild kicks),
    // then blit it 1:1 in device px — NEVER scaled. A size mismatch
    // (resize/DPR change whose async rebuild hasn't swapped in yet) skips
    // the blit: a blank band beats a stretched one, and the live
    // overdraws below still render.
    this.mmSyncTexture(ext, w, h);
    const tex = this.mmTex;
    if (tex && tex.width === Math.max(1, Math.round(w * dpr)) && tex.height === Math.max(1, Math.round(h * dpr))) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(tex, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    // ONGOING intervals are never baked (their right edge is the live
    // clock) — draw their marks over the texture every frame; there are
    // only ever a handful at once.
    const laneN = this.perLane.length;
    const ongoing = this.mmOngoing;
    if (ongoing.length > 0 && laneN > 0) {
      const padY = 3;
      const rowH = (h - padY * 2) / laneN;
      const markH = Math.max(1, Math.min(rowH * 0.75, 6));
      const x1 = timeToX(now, ext, w);
      for (let i = 0; i < ongoing.length; i++) {
        const n = ongoing[i];
        const x0 = timeToX(n.start, ext, w);
        if (x0 > w || x1 < 0) continue;
        const y = padY + n.laneIdx * rowH + (rowH - markH) / 2;
        ctx.fillStyle = this.mmDimFill(n.catKey);
        ctx.fillRect(x0, y, Math.max(x1 - x0, 1), markH);
      }
    }
    // The live edge, frozen + muted while the feed is stale (the main
    // now line's language). Live overdraw — never baked into the texture.
    const nx = timeToX(now, ext, w);
    if (nx >= 0 && nx <= w) {
      ctx.fillStyle = this.feedStale ? t.muted : withAlpha(t.now, 0.8);
      ctx.fillRect(nx - 0.5, 0, 1, h);
    }
    // The visible window: brighter rect + edge handle bars. Live overdraw.
    const rect = minimapWindowRect(this.view, ext, w);
    ctx.fillStyle = withAlpha(t.fg, 0.1);
    ctx.fillRect(rect.x0, 0, rect.x1 - rect.x0, h);
    ctx.strokeStyle = withAlpha(t.fg, 0.35);
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x0, 0.5, rect.x1 - rect.x0, h - 1);
    ctx.fillStyle = withAlpha(t.fg, 0.75);
    ctx.fillRect(rect.x0 - 1.5, 1, 3, h - 2);
    ctx.fillRect(rect.x1 - 1.5, 1, 3, h - 2);
  }

  /** catKey → the 0.55-alpha density fill (cached; cleared with the theme). */
  private mmDimFill(catKey: string): string {
    let fill = this.mmDimCache.get(catKey);
    if (fill === undefined) {
      fill = withAlpha(this.resolved(catKey, '', null).fill, 0.55);
      this.mmDimCache.set(catKey, fill);
    }
    return fill;
  }

  /**
   * Keep the density texture serving the current strip: decide between a
   * synchronous FIRST build (nothing exists to serve meanwhile — one-time,
   * equal to a single frame of the old per-frame cost), an ASYNC sliced
   * rebuild (geometry/theme/lane-count changes, in-place mark rewrites,
   * accumulated placement drift — the old texture keeps serving 1:1
   * until the swap), or INCREMENTAL maintenance (merge slivers painted
   * at the frozen mapping; whole-strip-pixel extent steps via shift +
   * exposed-column repaint).
   */
  private mmSyncTexture(ext: TimeView, w: number, h: number): void {
    const dpr = this.dpr;
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    const laneN = this.perLane.length;
    if (this.mmTex === null) {
      const built = this.mmPaintFull(ext, bw, bh, dpr, laneN);
      if (built) this.mmAdoptTexture(built);
      return;
    }
    const geomOk =
      this.mmTexW === bw && this.mmTexH === bh && this.mmTexDpr === dpr && this.mmTexLaneN === laneN && this.mmTexTheme === this.mmThemeGen;
    if (!geomOk || this.mmTexDirty || this.mmTexDriftPx >= MM_DRIFT_REBUILD_PX) {
      this.mmKickRebuild(ext, bw, bh, dpr, laneN);
      return;
    }
    // Incremental: paint marks merged since the last bake (stepping the
    // frozen extent first if any lands beyond its end — painting INTO the
    // texture at its own extent is exact by definition), then step the
    // mapping once it has drifted a whole strip pixel.
    if (this.mmPendingNew.length > 0) {
      const pend = this.mmPendingNew;
      let needEnd = this.mmTexExtent.end;
      for (let i = 0; i < pend.length; i++) {
        const e = pend[i].end;
        if (e !== null && e > needEnd) needEnd = e;
      }
      if (needEnd > this.mmTexExtent.end) this.mmStepExtent(ext, w);
      if (this.mmTexDirty) return; // step deferred to the rebuild; the queue survives for its kick
      this.mmPaintPending(w, h, laneN);
      this.mmTexEpoch = this.packEpoch;
    }
    const errStart = Math.abs(timeToX(this.mmTexExtent.start, ext, w));
    const errEnd = Math.abs(timeToX(this.mmTexExtent.end, ext, w) - w);
    if (errStart >= 1 || errEnd >= 1) this.mmStepExtent(ext, w);
  }

  /**
   * Step the texture's frozen extent to the live one WITHOUT resampling:
   * SHIFT the content by the whole-device-pixel translation delta (a
   * same-size copy through the double-buffer partner — self-blit lacks
   * snapshot semantics; never a scale-blit), clear + repaint from data
   * only the columns the shift/compression exposed or invalidated, and
   * accumulate the residual placement error (shift rounding + the
   * compression a shift cannot express) into mmTexDriftPx — the budget
   * that forces the async rebuild to true the approximation up. Handles
   * live-end compression AND the pad-regime translation (minimapExtent's
   * backward-padded start; exact under a shift) in one primitive. A step
   * needing more than MM_STEP_MAX_FRAC of the strip repainted (a
   * lazy-history jump) defers to the async rebuild via mmTexDirty — the
   * old pixels keep serving 1:1, briefly misplaced, never stretched.
   */
  private mmStepExtent(ext: TimeView, w: number): void {
    const tex = this.mmTex;
    const b = this.mmTexB;
    const bc = this.mmTexBCtx;
    if (!tex || !b || !bc) return;
    const dpr = this.mmTexDpr;
    const bw = tex.width;
    const bh = tex.height;
    const dx0 = timeToX(this.mmTexExtent.start, ext, w) * dpr;
    const dx1 = timeToX(this.mmTexExtent.end, ext, w) * dpr;
    const k = Math.round(dx0); // whole-device-px shift
    const leftW = Math.max(0, Math.min(k, bw)); // exposed left columns
    // Right repaint start: where correctly-placed shifted content ends.
    const xR = Math.max(leftW, Math.min(bw, Math.round(Math.min(dx1, k + bw))));
    if (leftW + (bw - xR) > bw * MM_STEP_MAX_FRAC) {
      this.mmTexDirty = true;
      return;
    }
    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.clearRect(0, 0, bw, bh);
    const cw = bw - Math.abs(k);
    if (cw > 0) bc.drawImage(tex, Math.max(0, -k), 0, cw, bh, Math.max(0, k), 0, cw, bh);
    if (xR < bw) bc.clearRect(xR, 0, bw - xR, bh);
    this.mmTexB = tex;
    this.mmTexBCtx = this.mmTexCtx;
    this.mmTex = b;
    this.mmTexCtx = bc;
    this.mmTexDriftPx += Math.max(Math.abs(k - dx0), Math.abs(k + bw - dx1)) / dpr;
    this.mmTexExtent = { start: ext.start, end: ext.end };
    if (leftW > 0) this.mmRepaintRegion(0, leftW, w);
    if (xR < bw) this.mmRepaintRegion(xR, bw, w);
  }

  /** Clear happened in the step; repaint device-px columns [x0, x1) from data at the frozen extent (clipped; laneMaxDur cull). */
  private mmRepaintRegion(x0: number, x1: number, w: number): void {
    const tex = this.mmTex;
    const c = this.mmTexCtx;
    if (!tex || !c || x1 <= x0) return;
    const dpr = this.mmTexDpr;
    const h = tex.height / dpr;
    const laneN = this.mmTexLaneN;
    const extent = this.mmTexExtent;
    const span = extent.end - extent.start;
    const bw = tex.width;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.beginPath();
    c.rect(x0, 0, x1 - x0, tex.height);
    c.clip();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const padY = 3;
    const rowH = laneN > 0 ? (h - padY * 2) / laneN : 0;
    const markH = Math.max(1, Math.min(rowH * 0.75, 6));
    // 2 css px margin: min-width marks + antialiasing bleed into the clip.
    const margin = (2 * span) / Math.max(1, w);
    const tA = extent.start + (x0 / bw) * span - margin;
    const tB = extent.start + (x1 / bw) * span + margin;
    for (let li = 0; li < laneN && li < this.perLane.length; li++) {
      const per = this.perLane[li];
      const cullFrom = tA - (this.laneMaxDur[li] ?? 0);
      let lo = 0;
      let hi = per.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (per[mid].start < cullFrom) lo = mid + 1;
        else hi = mid;
      }
      const y = padY + li * rowH + (rowH - markH) / 2;
      for (let i = lo; i < per.length; i++) {
        const n = per[i];
        if (n.start > tB) break; // sorted by start
        if (n.end === null || n.end < tA) continue;
        const mx0 = timeToX(n.start, extent, w);
        const mx1 = timeToX(n.end, extent, w);
        c.fillStyle = this.mmDimFill(n.catKey);
        c.fillRect(mx0, y, Math.max(mx1 - mx0, 1), markH);
      }
    }
    c.restore();
  }

  /** Paint the merge sliver (mmPendingNew) into the live texture at its frozen extent, then clear the queue. */
  private mmPaintPending(w: number, h: number, laneN: number): void {
    const c = this.mmTexCtx;
    if (!c) return;
    const dpr = this.mmTexDpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const padY = 3;
    const rowH = laneN > 0 ? (h - padY * 2) / laneN : 0;
    const markH = Math.max(1, Math.min(rowH * 0.75, 6));
    const extent = this.mmTexExtent;
    const pend = this.mmPendingNew;
    for (let i = 0; i < pend.length; i++) {
      const n = pend[i];
      // Skip superseded queue entries (replaced since ingest) and rows
      // beyond the texture's lane count — both funnels to a full rebuild
      // via mmTexDirty / the laneN stamp anyway.
      if (n.end === null || this.byId.get(n.id) !== n || n.laneIdx >= laneN) continue;
      const x0 = timeToX(n.start, extent, w);
      const x1 = timeToX(n.end, extent, w);
      if (x1 < 0 || x0 > w) continue;
      const y = padY + n.laneIdx * rowH + (rowH - markH) / 2;
      c.fillStyle = this.mmDimFill(n.catKey);
      c.fillRect(x0, y, Math.max(x1 - x0, 1), markH);
    }
    pend.length = 0;
  }

  /**
   * Start (or keep) an async full rebuild toward the current parameters.
   * An in-flight rebuild already targeting them is left to finish (the
   * slice chain is re-armed in case a disconnect dropped its timer); one
   * targeting STALE parameters — a merge/resize/retheme landed mid-build —
   * restarts from a fresh cursor. Extent motion is NOT staleness: the
   * shift step trues the captured extent up post-swap (restarting on it
   * would never converge under the pad-regime slide).
   */
  private mmKickRebuild(ext: TimeView, bw: number, bh: number, dpr: number, laneN: number): void {
    const r = this.mmRebuild;
    if (
      r !== null &&
      r.epoch === this.packEpoch &&
      r.themeGen === this.mmThemeGen &&
      r.w === bw &&
      r.h === bh &&
      r.dpr === dpr &&
      r.laneN === laneN
    ) {
      this.mmScheduleSlice();
      return;
    }
    const tex = document.createElement('canvas');
    tex.width = bw;
    tex.height = bh;
    const c = tex.getContext('2d');
    if (!c) return;
    this.mmRebuild = {
      tex,
      ctx: c,
      extent: { start: ext.start, end: ext.end },
      epoch: this.packEpoch,
      themeGen: this.mmThemeGen,
      laneN,
      w: bw,
      h: bh,
      dpr,
      laneIdx: 0,
      itemIdx: 0,
    };
    // The queued sliver is covered by the full repaint about to run.
    this.mmPendingNew.length = 0;
    this.mmScheduleSlice();
  }

  /** Arm the next rebuild slice off the frame path (idempotent). */
  private mmScheduleSlice(): void {
    if (this.mmRebuildTimer !== null) return;
    this.mmRebuildTimer = setTimeout(() => {
      this.mmRebuildTimer = null;
      this.mmRebuildSlice();
    }, 0);
  }

  /**
   * One budgeted (~3ms) rebuild slice: resume painting lanes/items into
   * the pending texture from the (laneIdx, itemIdx) cursor. On
   * completion the texture swaps in atomically — unless the parameters
   * went stale mid-build (data/theme moved), in which case the result is
   * discarded and the next frame re-kicks with fresh ones.
   */
  private mmRebuildSlice(): void {
    const r = this.mmRebuild;
    if (!r || !this.connected) return;
    const c = r.ctx;
    c.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    const w = r.w / r.dpr;
    const h = r.h / r.dpr;
    const padY = 3;
    const rowH = r.laneN > 0 ? (h - padY * 2) / r.laneN : 0;
    const markH = Math.max(1, Math.min(rowH * 0.75, 6));
    const t0 = this.perfNow();
    let count = 0;
    while (r.laneIdx < r.laneN && r.laneIdx < this.perLane.length) {
      const per = this.perLane[r.laneIdx];
      const y = padY + r.laneIdx * rowH + (rowH - markH) / 2;
      while (r.itemIdx < per.length) {
        const n = per[r.itemIdx];
        r.itemIdx++;
        if (n.end === null) continue; // live-drawn every frame, never baked
        const x0 = timeToX(n.start, r.extent, w);
        if (x0 > w) break; // sorted by start — the rest of the lane is past the extent
        const x1 = timeToX(n.end, r.extent, w);
        if (x1 < 0) continue;
        c.fillStyle = this.mmDimFill(n.catKey);
        c.fillRect(x0, y, Math.max(x1 - x0, 1), markH);
        if ((++count & 63) === 0 && this.perfNow() - t0 > 3) {
          this.mmScheduleSlice();
          return;
        }
      }
      r.laneIdx++;
      r.itemIdx = 0;
    }
    this.mmRebuild = null;
    if (r.epoch !== this.packEpoch || r.themeGen !== this.mmThemeGen) {
      // Painted from live arrays that changed mid-build — the content is
      // unaccountable; drop it and let the next frame re-kick fresh.
      this.invalidate();
      return;
    }
    this.mmAdoptTexture(r);
    this.invalidate(); // blit the fresh texture on the next frame
  }

  /** Synchronous full paint — the FIRST build only (nothing exists to serve while an async build runs). */
  private mmPaintFull(
    ext: TimeView,
    bw: number,
    bh: number,
    dpr: number,
    laneN: number,
  ): { tex: HTMLCanvasElement; ctx: CanvasRenderingContext2D; extent: TimeView; epoch: number; themeGen: number; laneN: number; w: number; h: number; dpr: number } | null {
    const tex = document.createElement('canvas');
    tex.width = bw;
    tex.height = bh;
    const c = tex.getContext('2d');
    if (!c) return null;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = bw / dpr;
    const h = bh / dpr;
    const padY = 3;
    const rowH = laneN > 0 ? (h - padY * 2) / laneN : 0;
    const markH = Math.max(1, Math.min(rowH * 0.75, 6));
    for (let li = 0; li < laneN && li < this.perLane.length; li++) {
      const per = this.perLane[li];
      const y = padY + li * rowH + (rowH - markH) / 2;
      for (let i = 0; i < per.length; i++) {
        const n = per[i];
        if (n.end === null) continue;
        const x0 = timeToX(n.start, ext, w);
        if (x0 > w) break; // sorted by start
        const x1 = timeToX(n.end, ext, w);
        if (x1 < 0) continue;
        c.fillStyle = this.mmDimFill(n.catKey);
        c.fillRect(x0, y, Math.max(x1 - x0, 1), markH);
      }
    }
    return {
      tex,
      ctx: c,
      extent: { start: ext.start, end: ext.end },
      epoch: this.packEpoch,
      themeGen: this.mmThemeGen,
      laneN,
      w: bw,
      h: bh,
      dpr,
    };
  }

  /** Swap a completed texture in and reset the drift budgets + queues. */
  private mmAdoptTexture(r: {
    tex: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    extent: TimeView;
    epoch: number;
    themeGen: number;
    laneN: number;
    w: number;
    h: number;
    dpr: number;
  }): void {
    this.mmTex = r.tex;
    this.mmTexCtx = r.ctx;
    this.mmTexExtent = { start: r.extent.start, end: r.extent.end };
    this.mmTexEpoch = r.epoch;
    this.mmTexW = r.w;
    this.mmTexH = r.h;
    this.mmTexDpr = r.dpr;
    this.mmTexLaneN = r.laneN;
    this.mmTexTheme = r.themeGen;
    this.mmTexDriftPx = 0;
    this.mmTexDirty = false;
    this.mmPendingNew.length = 0;
    if (!this.mmTexB || this.mmTexB.width !== r.w || this.mmTexB.height !== r.h) {
      this.mmTexB = document.createElement('canvas');
      this.mmTexB.width = r.w;
      this.mmTexB.height = r.h;
      this.mmTexBCtx = this.mmTexB.getContext('2d');
    }
  }

  /**
   * Snap a TEXT draw origin (x or y) to the device-pixel grid. Applied
   * per fillText call — text, unlike bar geometry, tolerates per-element
   * rounding (see snapTextOrigin): a fractional origin — laneScroll
   * accumulation, height tweens, odd track heights — smears every glyph
   * stroke across two pixel rows; a snapped one rasterizes crisp, at the
   * cost of labels stepping in whole device pixels while things move.
   */
  private textPx(v: number): number {
    return snapTextOrigin(v, this.dpr);
  }

  private drawAxisAndGrid(ctx: CanvasRenderingContext2D, now: number): void {
    const t = this.theme;
    const dpr = this.dpr;
    const w = this.cssW;
    const h = this.cssH;
    const gx = this.gutterW;
    const plotW = this.plotWidth();
    const tz = this.tzOffsetMs();
    const maxTicks = Math.max(2, Math.floor(plotW / 88));
    const rv = this.renderView();
    const span = rv.end - rv.start;
    const step = timeTickStep(span, maxTicks);
    const ticks = timeTicks(rv, maxTicks, tz);

    ctx.font = this.fontAxis;
    ctx.textBaseline = 'middle';
    const hairline = 1 / dpr;
    for (const tick of ticks) {
      const x = snap(gx + timeToX(tick, rv, plotW), dpr);
      if (x < gx) continue;
      const isDay = (tick + tz) % 86_400_000 === 0;
      ctx.strokeStyle = t.grid;
      ctx.lineWidth = isDay ? hairline * 2 : hairline;
      ctx.beginPath();
      ctx.moveTo(x, AXIS_H);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillStyle = isDay ? t.fg : t.muted;
      ctx.textAlign = 'center';
      const label = formatTimeTick(tick, step, tz);
      // Keep edge labels inside the canvas.
      const half = (label.length * this.charW * 0.92) / 2;
      const lx = Math.min(w - half - 2, Math.max(gx + half + 2, x));
      ctx.fillText(label, this.textPx(lx), this.textPx(AXIS_H / 2 + 0.5));
    }
    // Context date in the gutter corner when the ticks themselves are
    // sub-day (a date-step axis already says the date on every tick).
    if (step < 86_400_000 && this.lanes.length > 0) {
      ctx.fillStyle = t.muted;
      ctx.textAlign = 'left';
      const dateLabel = formatTimeFull(rv.start, tz).split(' ').slice(0, 2).join(' ');
      ctx.fillText(dateLabel, this.textPx(4), this.textPx(AXIS_H / 2 + 0.5));
    }
    void now;
  }

  private drawLanes(ctx: CanvasRenderingContext2D): void {
    const t = this.theme;
    const dpr = this.dpr;
    const w = this.cssW;
    const h = this.cssH;
    const { tops, heights } = this.layout;
    const hairline = 1 / dpr;
    ctx.font = this.fontBar;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const separators: number[] = [];
    for (let i = 0; i < this.lanes.length; i++) {
      const top = AXIS_H + tops[i] - this.laneScroll;
      const lh = heights[i];
      if (top + lh < AXIS_H || top > h) continue;
      if (i % 2 === 1 && t.rowTint !== 'none') {
        ctx.fillStyle = t.rowTint;
        ctx.fillRect(0, Math.max(AXIS_H, top), w, Math.min(top + lh, h) - Math.max(AXIS_H, top));
      }
      const yBottom = snap(top + lh, dpr);
      // Collected, not stroked here: one path for every lane separator beats
      // a beginPath/stroke pair per lane (49 lanes = 49 rasterizer round
      // trips per frame, for identical 1px lines).
      if (yBottom > AXIS_H && yBottom < h) separators.push(yBottom);
      // Gutter label, graded by the lane's CURRENT height: full while the
      // lane comfortably fits the base font; smaller + faded while it
      // doesn't (compact lanes); skipped entirely below legibility
      // (LANE_LABEL_MIN_PX — the gutter tooltip still names the lane).
      // Every label is centered in its own band at a font under the band
      // height, so adjacent lanes' labels can never overlap.
      if (lh >= LANE_LABEL_MIN_PX && top + lh / 2 > AXIS_H + 4 && top + lh / 2 < h - 2) {
        const full = lh >= t.fontSize + 5;
        const fs = full ? t.fontSize
          : Math.max(LANE_LABEL_MIN_FONT_PX, Math.min(t.fontSize - 2, Math.floor(lh - 3)));
        const charW = full ? this.charW : (this.charW * fs) / t.fontSize;
        this.measureCharW = charW;
        // fitTieredText measures text, which is the dearest thing a frame
        // does per lane — and the answer only changes when the label, the
        // gutter width or the font does. All three are in the key, so the
        // cache needs no invalidation hook.
        const label = this.lanes[i].label;
        const fitKey = `${label}\u0000${this.gutterW}\u0000${fs}\u0000${t.font}`;
        let fit = this.laneFitCache.get(fitKey);
        if (fit === undefined) {
          fit = fitTieredText(label, this.gutterW - 16, this.measureLabel);
          if (this.laneFitCache.size > LANE_FIT_CACHE_MAX) this.laneFitCache.clear();
          this.laneFitCache.set(fitKey, fit);
        }
        if (fit !== null) {
          ctx.font = full ? this.fontBar : `${fs}px ${t.font}`;
          const color = full ? t.muted : withAlpha(t.muted, 0.7);
          const lx = this.textPx(8);
          const ly = this.textPx(top + lh / 2 + 0.5);
          if (fit.faded) {
            this.labelPainter.paint(ctx, fit.text, lx, ly, fit.width, FADE_TAIL_CHARS * charW, color);
          } else {
            ctx.fillStyle = color;
            ctx.fillText(fit.text, lx, ly);
          }
        }
      }
    }
    ctx.font = this.fontBar; // undo any compact-label font downshift
    // Every lane separator plus the gutter | plot rule: ONE path, one stroke.
    ctx.strokeStyle = t.hairline;
    ctx.lineWidth = hairline;
    ctx.beginPath();
    for (const y of separators) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    const xg = snap(this.gutterW, dpr);
    ctx.moveTo(xg, AXIS_H);
    ctx.lineTo(xg, h);
    ctx.stroke();
  }

  private drawCoverage(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.loadRangeFn) return;
    const t = this.theme;
    const gx = this.gutterW;
    const plotW = this.plotWidth();
    const h = this.cssH;
    const rv = this.renderView();
    const probeEnd = Math.min(rv.end, now);
    if (probeEnd > rv.start) {
      const gaps = this.coverage.uncoveredIn({ start: rv.start, end: probeEnd });
      const pending = this.coverage.pending();
      for (const gap of gaps) {
        const x0 = gx + timeToX(gap.start, rv, plotW);
        const x1 = gx + timeToX(gap.end, rv, plotW);
        if (x1 - x0 < 1) continue;
        const busy = pending !== null && pending.start < gap.end && pending.end > gap.start;
        const pat = this.patternFor('hatch', busy ? withAlpha(t.muted, 0.35) : withAlpha(t.muted, 0.18));
        // Anchored to the gap's own start so the hatch scrolls WITH the
        // uncovered region (the busy-crawl translate below still animates
        // relative to it — pattern transforms compose with the CTM).
        ctx.fillStyle = pat ? this.anchorPattern(pat, x0, AXIS_H) : withAlpha(t.muted, 0.08);
        ctx.save();
        if (busy && !this.reducedMotion) ctx.translate((now / 40) % 7, 0);
        ctx.fillRect(x0 - 7, AXIS_H, x1 - x0 + 7, h - AXIS_H);
        ctx.restore();
        if (busy && x1 - x0 > 90) {
          ctx.fillStyle = t.muted;
          ctx.font = this.fontAxis;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('loading…', this.textPx((x0 + x1) / 2), this.textPx(AXIS_H + 14));
        }
      }
    }
    // Explicit end-of-history boundary.
    const ex = this.coverage.exhaustedBefore;
    if (ex !== null && ex >= rv.start && ex <= rv.end) {
      const x = snap(gx + timeToX(ex, rv, plotW), this.dpr);
      // The void before history: clearly darker than the plot bg.
      if (x > gx) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(gx, AXIS_H, x - gx, h - AXIS_H);
      }
      ctx.strokeStyle = t.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash(MARKER_DASH);
      ctx.beginPath();
      ctx.moveTo(x, AXIS_H);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.setLineDash(EMPTY_DASH);
      ctx.fillStyle = t.muted;
      ctx.font = this.fontAxis;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.getAttribute('history-end-text') ?? 'history ends here', this.textPx(x + 6), this.textPx(h - 12));
    }
  }

  private drawIntervals(ctx: CanvasRenderingContext2D, now: number): void {
    const t = this.theme;
    const dpr = this.dpr;
    const h = this.cssH;
    const m = this.metrics();
    const { tops, heights } = this.layout;
    ctx.font = this.fontBar;
    ctx.textBaseline = 'middle';
    const rv = this.renderView();
    for (let laneIdx = 0; laneIdx < this.perLane.length; laneIdx++) {
      const laneTop = AXIS_H + tops[laneIdx] - this.laneScroll;
      if (laneTop + heights[laneIdx] < AXIS_H || laneTop > h) continue;
      // Iterate only the UNCLUSTERED items (built at cluster time, same
      // (start, id) order — clustered members draw as their cluster's
      // stack marker below, and skipping them one by one used to burn
      // thousands of no-op iterations per frame on busy zooms).
      const per = this.laneUnclustered[laneIdx] ?? this.perLane[laneIdx];
      // Lower-bound cull: a TERMINATED item starting before
      // rv.start − maxDur necessarily ended before the window; ongoing
      // items (end = null, growing to now) block the bound only down to
      // the lane's earliest ongoing start. Binary-search the first
      // possibly-visible index (arrays are (start, id)-sorted) instead of
      // scanning every frame from 0 — the loop is O(visible + log N),
      // with the existing sorted `break` as the upper bound.
      let cullFrom = rv.start - (this.laneMaxDur[laneIdx] ?? 0);
      const ongoingStart = this.laneOngoingStart[laneIdx];
      if (ongoingStart !== undefined && ongoingStart < cullFrom) cullFrom = ongoingStart;
      let lo = 0;
      let hi = per.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (per[mid].start < cullFrom) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < per.length; i++) {
        const n = per[i];
        if (n.start > rv.end) break; // sorted by start
        if ((n.end ?? now) < rv.start && n.end !== null) continue;
        if (n.clustered) continue; // belt — membership changed since the last cluster pass
        this.drawInterval(ctx, n, now);
      }
      // The lane's cluster stack markers, over its bars.
      const ncs = this.laneClusters[laneIdx];
      if (ncs) this.drawClusters(ctx, ncs);
    }
    void dpr;
    void t;
  }

  private drawInterval(ctx: CanvasRenderingContext2D, n: NInterval, now: number): void {
    const t = this.theme;
    const dpr = this.dpr;
    const rv = this.renderView();
    const plotW = this.plotWidth();
    const r = this.rectForInto(n, now, this.rectScratch);
    const bh = r.h; // per-lane track height: compact lanes render slivers
    const style = this.resolved(n.catKey, n.state, this.overrideColor(n));
    const hovered = this.hoverIntervalId === n.id;

    // Bar vs pip from the DURATION mapped through the current scale —
    // translation-invariant, so a scrolling viewport can never flip an
    // event's shape (a rounded-coordinate width oscillates ±1px with
    // subpixel phase). Zero/near-zero-duration events are pips; anything
    // wider draws as a bar, clamped to MIN_BAR_PX so a real duration is
    // never demoted to a pip by rounding.
    const trueW = durationWidthPx(n.start, n.end ?? now, rv, plotW);
    if (isInstantWidth(trueW)) {
      this.drawInstant(ctx, style, r.x + r.w / 2, r.y + bh / 2, bh, hovered);
      return;
    }

    // Which ends the viewport clips (the span truly continues off-screen
    // past them) — those ends get the edge-continuation shadow, painted
    // last so it applies over every treatment.
    const fade = edgeContinuation(n.start, n.end ?? now, rv, plotW, EDGE_FADE_PX);

    // Unrounded coordinates on purpose: renderView is the single global
    // rounding step; rounding again per bar would jiggle neighbors
    // relative to each other during fractional translations.
    const x0 = r.x;
    const bw = Math.max(r.w, MIN_BAR_PX);
    const x1 = x0 + bw;
    const y = r.y;
    const radius = Math.min(3, bh / 3, bw / 2);
    const path = new Path2D();
    path.roundRect(x0, y, bw, bh, radius);

    // Body fill.
    if (style.pattern === 'outline') {
      ctx.fillStyle = withAlpha(style.fill, 0.1);
      ctx.fill(path);
    } else if (style.pattern === 'hatch' || style.pattern === 'stipple') {
      ctx.fillStyle = withAlpha(style.fill, style.pattern === 'hatch' ? 0.22 : 0.75);
      ctx.fill(path);
      const pat = this.patternFor(style.pattern, style.pattern === 'stipple' ? withAlpha('#000000', 0.4) : style.fill);
      if (pat) {
        ctx.save();
        ctx.clip(path);
        ctx.fillStyle = this.anchorPattern(pat, x0, y); // phase rides the bar, not the canvas
        ctx.fillRect(x0, y, bw, bh);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = style.fill;
      ctx.fill(path);
    }

    // Where the label anchors: the bar start, sticking to the plot's
    // left edge (past any continuation shadow) while the start is
    // scrolled off-screen.
    const labelPad = 5;
    const labelX = Math.max(x0, this.gutterW + (fade.left ? EDGE_FADE_PX : 0)) + labelPad;

    // Phase segments, clipped to the bar.
    if (n.segs) {
      ctx.save();
      ctx.clip(path);
      for (const s of n.segs) {
        let sx0 = Math.max(x0, this.gutterW + timeToX(s.start, rv, plotW));
        const sx1 = Math.min(x1, this.gutterW + timeToX(s.end ?? (n.end ?? now), rv, plotW));
        const ss = this.resolved(n.catKey, s.kind, null);
        if (ss.pattern === 'outline') {
          // A terminal cut (e.g. a kill tail: cancel requested → finished).
          // Unlike decorative phases it must NEVER vanish: it keeps a
          // minimum device-pixel footprint (grown backward from its end —
          // the tail sits at the bar end) instead of the sub-half-px skip,
          // and renders visibly as a dark scrim over the dead tail. Once
          // the tail is wide enough for a line to mark a point INSIDE the
          // span, a cut line in the segment's own hue (the same color
          // family as the cancelled border) marks the kill point. Never a
          // foreground-bright line: on a hairline tail that sat flush
          // against the end border and read as a stray white artifact.
          const minW = TERMINAL_SEG_MIN_DEVICE_PX / dpr;
          if (sx1 - sx0 < minW) sx0 = Math.max(x0, sx1 - minW);
          const segW = sx1 - sx0;
          ctx.fillStyle = withAlpha('#000000', 0.45);
          ctx.fillRect(sx0, y, segW, bh);
          if (segW >= CUT_LINE_MIN_TAIL_PX) {
            ctx.fillStyle = ss.border;
            ctx.fillRect(sx0, y, Math.min(1, segW), bh);
          }
          continue;
        }
        if (sx1 - sx0 < 0.5) continue;
        if (ss.pattern === 'hatch' || ss.pattern === 'stipple') {
          ctx.fillStyle = withAlpha(ss.fill, 0.2);
          ctx.fillRect(sx0, y, sx1 - sx0, bh);
          const pat = this.patternFor(ss.pattern, ss.fill);
          if (pat) {
            // Anchored to the BAR's unclamped origin (one phase per bar):
            // stable while the bar's start is clipped off-screen — the
            // clamped sx0 would phase-jump at the clip boundary.
            ctx.fillStyle = this.anchorPattern(pat, x0, y);
            ctx.fillRect(sx0, y, sx1 - sx0, bh);
          }
        } else {
          ctx.fillStyle = ss.fill;
          ctx.fillRect(sx0, y, sx1 - sx0, bh);
        }
        // Hairline phase boundary.
        ctx.fillStyle = withAlpha('#000000', 0.35);
        ctx.fillRect(sx0, y, 1 / dpr, bh);
      }
      ctx.restore();
    }

    // Ongoing: animated leading edge at the live end — unless the feed is
    // STALE: then the bar is frozen at the last vouched timestamp and its
    // state is UNKNOWN, not "running" — dim it and overlay hatching (the
    // same visual language as uncovered history) instead of pulsing.
    if (n.end === null && x1 > this.gutterW) {
      if (this.feedStale) {
        ctx.save();
        ctx.clip(path);
        ctx.fillStyle = withAlpha('#000000', 0.35); // dim
        ctx.fillRect(x0, y, bw, bh);
        const pat = this.patternFor('hatch', withAlpha(t.muted, 0.5));
        if (pat) {
          ctx.fillStyle = this.anchorPattern(pat, x0, y); // phase rides the bar
          ctx.fillRect(x0, y, bw, bh);
        }
        ctx.restore();
      } else {
        const pulse = this.reducedMotion ? 0.55 : 0.4 + 0.25 * Math.sin(now / 550);
        const gw = Math.min(14, bw);
        const grad = ctx.createLinearGradient(x1 - gw, 0, x1, 0);
        grad.addColorStop(0, withAlpha('#ffffff', 0));
        grad.addColorStop(1, withAlpha('#ffffff', pulse));
        ctx.save();
        ctx.clip(path);
        ctx.fillStyle = grad;
        ctx.fillRect(x1 - gw, y, gw, bh);
        ctx.restore();
      }
    }

    // Border — width capped for sliver bars so a 2px emphasis border can't
    // swallow a 4px compact track. Dashes (the cancelled treatment) fall
    // back to solid below BORDER_DASH_MIN_PX, where a dash pattern reads
    // as broken corners rather than a dashed edge.
    ctx.strokeStyle = style.border;
    ctx.lineWidth = Math.min(style.borderWidth, Math.max(1, bh / 4));
    const dash = style.dash && bw >= BORDER_DASH_MIN_PX ? style.dash : null;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke(path);
    if (dash) ctx.setLineDash(EMPTY_DASH);

    // Corner glyph (emphasis): a filled notch triangle, top-right.
    if (style.glyph === 'bang' && bw >= 8) {
      const g = Math.min(8, bh * 0.5);
      ctx.fillStyle = t.emphasis;
      ctx.beginPath();
      ctx.moveTo(x1 - g, y);
      ctx.lineTo(x1, y);
      ctx.lineTo(x1, y + g);
      ctx.closePath();
      ctx.fill();
    } else if (style.glyph === 'dot' && bw >= 8) {
      ctx.fillStyle = style.border;
      ctx.beginPath();
      ctx.arc(x0 + bh * 0.32, y + bh * 0.32, Math.min(1.8, bh * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }

    // Label — suppressed entirely below fit height (a compact sliver has
    // no room for text); otherwise never allowed to spill out of the bar,
    // sticking to the plot's left edge while the bar's start is scrolled
    // off-screen — just past the continuation shadow when one is active,
    // so the sticky label never sits inside the darkened zone.
    if (bh >= t.fontSize + 3) {
      const glyphPad = style.glyph === 'bang' ? 8 : 0;
      this.measureCharW = this.charW;
      const fit = fitTieredText(n.tiers ?? n.label, x1 - labelX - labelPad - glyphPad, this.measureLabel);
      if (fit !== null) {
        // Full-contrast text + halo regardless of the surface — the
        // span's own state/segments must never grey the label out.
        const lx = this.textPx(labelX);
        const ly = this.textPx(y + bh / 2 + 0.5);
        if (fit.faded) {
          this.labelPainter.paint(ctx, fit.text, lx, ly, fit.width, FADE_TAIL_CHARS * this.charW, t.fg, this.labelHalo, LABEL_HALO_PX);
        } else {
          this.labelText(ctx, fit.text, lx, ly);
        }
      }
    }

    if (hovered) {
      ctx.strokeStyle = withAlpha('#ffffff', 0.75);
      ctx.lineWidth = 1.25;
      ctx.stroke(path);
    }

    // Edge-continuation shadow: the clipped end darkens over the last
    // EDGE_FADE_PX toward the viewport edge — the span reads as sliding
    // UNDER the window edge, which casts a shadow on it. NEVER a fade to
    // the background color: dissolving the span made it look like it
    // evaporates there instead of continuing. Painted OVER the finished
    // bar (fill, segments, border, hover ring) as a black gradient —
    // full EDGE_SHADOW_ALPHA at the edge (clearly darker than the page
    // background over any body), eased via a mid stop, clear at the
    // inner side — plus a 1px near-black line at the boundary itself to
    // strengthen the occluding-edge read. Reads identically over solid,
    // hollow, hatched, and scrimmed treatments and stays correct on an
    // opaque canvas. The rect overshoots the bar by 1px vertically to
    // catch the border's outer half (still inside the 2px track gap).
    if (fade.left) {
      const gx = this.gutterW;
      const grad = ctx.createLinearGradient(gx, 0, gx + EDGE_FADE_PX, 0);
      grad.addColorStop(0, withAlpha('#000000', EDGE_SHADOW_ALPHA));
      grad.addColorStop(0.55, withAlpha('#000000', EDGE_SHADOW_ALPHA * 0.35));
      grad.addColorStop(1, withAlpha('#000000', 0));
      ctx.fillStyle = grad;
      ctx.fillRect(gx, y - 1, EDGE_FADE_PX, bh + 2);
      ctx.fillStyle = withAlpha('#000000', 0.9);
      ctx.fillRect(gx, y - 1, 1, bh + 2);
    }
    if (fade.right) {
      const ex = this.gutterW + plotW;
      const grad = ctx.createLinearGradient(ex - EDGE_FADE_PX, 0, ex, 0);
      grad.addColorStop(0, withAlpha('#000000', 0));
      grad.addColorStop(0.45, withAlpha('#000000', EDGE_SHADOW_ALPHA * 0.35));
      grad.addColorStop(1, withAlpha('#000000', EDGE_SHADOW_ALPHA));
      ctx.fillStyle = grad;
      ctx.fillRect(ex - EDGE_FADE_PX, y - 1, EDGE_FADE_PX, bh + 2);
      ctx.fillStyle = withAlpha('#000000', 0.9);
      ctx.fillRect(ex - 1, y - 1, 1, bh + 2);
    }
  }

  private drawInstant(
    ctx: CanvasRenderingContext2D,
    style: ResolvedStyle,
    cx: number,
    cy: number,
    trackH: number,
    hovered: boolean,
    ghost = false,
  ): void {
    const t = this.theme;
    const r = this.pipRadius(trackH);
    const rx = r * 0.78;
    // Pips deliberately skip the bars' below-12px dash-to-solid fallback —
    // a closed diamond outline has no broken-corner failure mode, and a
    // cancelled INSTANT must carry the same dashed signature as a
    // cancelled span. strokePip holds that geometry, shared with the
    // sprite bake so a blitted pip and a drawn one cannot diverge.
    this.strokePip(ctx, style, cx, cy, r);
    const emphasis = style.glyph === 'bang' || style.border === t.emphasis;
    // Ghost copies (the back layers of a cluster's 3-stack) draw fill +
    // border only: no emphasis stem (an emphasis cluster shows ONE stem on
    // its front copy, never a comb) and no hover ring (callers pass
    // hovered=false for ghosts). The dashed-cancelled outline deliberately
    // stays on ghosts — a cancelled cluster reads as a stack of dashed
    // hollow diamonds, matching the per-state language.
    if (emphasis && !ghost) {
      // Unmissable: a stem above the diamond, like an exclamation.
      ctx.strokeStyle = t.emphasis;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r - 1.5);
      ctx.lineTo(cx, cy - r - 5);
      ctx.stroke();
    }
    if (hovered) {
      ctx.strokeStyle = withAlpha('#ffffff', 0.75);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r - 2);
      ctx.lineTo(cx + rx + 2, cy);
      ctx.lineTo(cx, cy + r + 2);
      ctx.lineTo(cx - rx - 2, cy);
      ctx.closePath();
      ctx.stroke();
    }
  }

  /**
   * Screen geometry of a cluster's marker — shared by drawing and hit
   * testing so the two can never disagree. Null while the cluster is
   * unplaced (outside the window) or no part of its extent is visible.
   */
  private clusterPos(c: NCluster): { cx: number; cy: number; y: number; th: number; r: number } | null {
    if (c.track < 0) return null;
    const rv = this.renderView();
    const plotW = this.plotWidth();
    const th = this.laneTrackHeight(c.laneIdx);
    const r = this.pipRadius(th);
    const marginMs = ((r + 2) * (rv.end - rv.start)) / plotW;
    const mt = clusterMarkerTime(c.extent, rv, marginMs);
    if (mt === null) return null;
    const m = this.metrics();
    const y = AXIS_H + this.layout.tops[c.laneIdx] - this.laneScroll + trackTop(c.track, m, th);
    return { cx: this.gutterW + timeToX(mt, rv, plotW), cy: y + th / 2, y, th, r };
  }

  /**
   * Screen geometry of a SPREAD cluster's marks — shared by drawing and
   * hit testing so the two can never disagree. Every mark is exactly
   * CLUSTER_MARK_PX wide: no width here is derived from a time range,
   * which is the mechanical reason marks cannot fuse into a bar (see
   * docs/timeline/zoom-out-never-merges.md). Off-screen marks are
   * dropped; null while the cluster is unplaced or none is on screen.
   */
  private clusterMarks(c: NCluster): { y: number; th: number; r: number; pips: { cx: number; mark: ClusterMark }[] } | null {
    if (c.track < 0) return null;
    const rv = this.renderView();
    const plotW = this.plotWidth();
    const th = this.laneTrackHeight(c.laneIdx);
    const m = this.metrics();
    const y = AXIS_H + this.layout.tops[c.laneIdx] - this.laneScroll + trackTop(c.track, m, th);
    const r = this.pipRadius(th);
    const pips: { cx: number; mark: ClusterMark }[] = [];
    for (const mark of c.marks) {
      const cx = timeToX(mark.time, rv, plotW);
      if (cx < -r || cx > plotW + r) continue;
      pips.push({ cx: this.gutterW + cx, mark });
    }
    return pips.length > 0 ? { y, th, r, pips } : null;
  }

  /**
   * A cluster marker: the SAME diamond pip as a single instant, drawn as
   * a STACK of exactly THREE copies (two ghost copies offset straight
   * RIGHT behind the true pip, fading with depth — middle dimmer, back
   * dimmest) — the stack silhouette alone carries "several instants live
   * here at this zoom". Always three, never scaled by the member count:
   * the glyph says "a stack", the tooltip carries the real count. There
   * is no count text on the canvas. Styled by the members' shared state
   * exactly like singles (all-skipped = dim-filled diamonds,
   * all-cancelled = hollow dashed diamonds, mixed = the neutral default);
   * the FRONT copy sits at the true anchor — the extent midpoint, sliding
   * along the visible slice at a window edge (clusterMarkerTime) — so hit
   * rects, hover ring, and tooltip anchoring are unchanged. Ghost copies
   * skip the hover ring and emphasis stem (see drawInstant's `ghost`).
   * Like pips, clusters get no edge-continuation treatment — a point
   * marker has no clipped extent.
   */
  /**
   * A lane's cluster markers, from a BAKED sprite. Each marker is a
   * 3-diamond stack — six canvas path operations drawn live, and a dense
   * hour of traffic puts ~400 on screen, which measured as the single
   * largest slice of frame time (31 ms of a 59 ms draw budget across a
   * load). The whole stack bakes into one image per (style, radius, dpr),
   * so a marker costs one blit: 1.29 us against 1.81 batched (pipSprite
   * carries the measurements).
   *
   * A hovered marker or an emphasis stem is per-marker geometry, so those
   * fall back to drawCluster — and draw AFTER the blits, which is where
   * they belong anyway (a hover ring under a neighbour's ghost was always
   * a latent glitch).
   */
  private drawClusters(ctx: CanvasRenderingContext2D, ncs: NCluster[]): void {
    if (ncs.length === 0) return;
    const t = this.theme;
    let fallback: NCluster[] | null = null;
    // Grouped by the glyph they would blit, because whether baking pays
    // is a question about the SIZE of each group.
    let groups: Map<string, { style: ResolvedStyle; r: number; at: NCluster[] }> | null = null;
    for (const c of ncs) {
      const style = this.resolved(c.catKey, c.state, null);
      if (!c.point) {
        this.drawClusterMarks(ctx, c, style);
        continue;
      }
      const emphasis = style.glyph === 'bang' || style.border === t.emphasis;
      if (emphasis || this.hoverClusterId === c.members[0].id) {
        (fallback ??= []).push(c);
        continue;
      }
      const r = this.pipRadius(this.laneTrackHeight(c.laneIdx));
      const key = `${this.styleId(style)}|${r}`;
      const map = (groups ??= new Map());
      let g = map.get(key);
      if (g === undefined) map.set(key, (g = { style, r, at: [] }));
      g.at.push(c);
    }
    if (groups) {
      for (const g of groups.values()) {
        const sprite = this.pipSprite(g.style, g.r, true, g.at.length);
        if (!sprite) {
          for (const c of g.at) this.drawCluster(ctx, c);
          continue;
        }
        const blits: { sprite: typeof sprite; cx: number; cy: number }[] = [];
        for (const c of g.at) {
          const p = this.clusterPos(c);
          if (p) blits.push({ sprite, cx: p.cx, cy: p.cy });
        }
        this.blitPips(ctx, blits);
      }
    }
    if (fallback) for (const c of fallback) this.drawCluster(ctx, c);
  }

  /**
   * A SPREAD cluster's marks: the members' OWN pips, at their own
   * timestamps, thinned to a pitch so they never collide. An instant is a
   * diamond (a dot once the row is compact) at every zoom — nothing here
   * substitutes a different glyph for one, and a run of them stays a run
   * of separated pips no matter how far out you go.
   */
  private drawClusterMarks(ctx: CanvasRenderingContext2D, c: NCluster, style: ResolvedStyle): void {
    const geo = this.clusterMarks(c);
    if (!geo) return;
    const cy = geo.y + geo.th / 2;
    const hovered = this.hoverClusterId ?? this.hoverIntervalId;
    const emphasis = style.glyph === 'bang' || style.border === this.theme.emphasis;
    const dashed = style.dash !== null && style.dash.length > 0;
    const pips = geo.pips;
    const hoverAt = hovered === null ? -1 : pips.findIndex((p) => c.members[p.mark.from].id === hovered);
    const sprite = dashed || emphasis ? this.pipSprite(style, geo.r, false, pips.length) : null;
    if (sprite) {
      // Per-marker dash setup is the expensive glyph, so once there are
      // enough of them it comes off a baked sprite (1.24 us against 1.80
      // drawn live — see pipSprite).
      this.blitPips(
        ctx,
        pips.map((p) => ({ sprite, cx: p.cx, cy })),
      );
    } else if (dashed || emphasis) {
      for (const p of pips) this.drawInstant(ctx, style, p.cx, cy, geo.th, false);
    } else {
      // One cheap path per pip, so BATCHING beats blitting here (0.75 us
      // against 1.56): the whole run goes down as subpaths of one path.
      ctx.fillStyle = style.pattern === 'outline' ? withAlpha(style.fill, 0.15) : style.fill;
      ctx.strokeStyle = style.border;
      ctx.lineWidth = 1;
      const r = geo.r;
      const rx = r * 0.78;
      for (let i = 0; i < pips.length; i += CLUSTER_BATCH_MAX) {
        const to = Math.min(i + CLUSTER_BATCH_MAX, pips.length);
        ctx.beginPath();
        for (let k = i; k < to; k++) {
          const cx = pips[k].cx;
          ctx.moveTo(cx, cy - r);
          ctx.lineTo(cx + rx, cy);
          ctx.lineTo(cx, cy + r);
          ctx.lineTo(cx - rx, cy);
          ctx.closePath();
        }
        ctx.fill();
        ctx.stroke();
      }
    }
    // The hovered mark redraws whole, on top: its ring and any emphasis
    // stem are per-marker geometry the batch and the sprite both omit.
    if (hoverAt >= 0) this.drawInstant(ctx, style, pips[hoverAt].cx, cy, geo.th, true);
  }

  private drawCluster(ctx: CanvasRenderingContext2D, c: NCluster): void {
    const p = this.clusterPos(c);
    if (!p) return;
    const style = this.resolved(c.catKey, c.state, null);
    // Step degrades to 1px on compact tracks.
    const s = Math.max(1, Math.min(2, p.r * 0.35));
    ctx.save();
    ctx.globalAlpha = CLUSTER_BACK_ALPHA;
    this.drawInstant(ctx, style, p.cx + 2 * s, p.cy, p.th, false, true);
    ctx.globalAlpha = CLUSTER_MID_ALPHA;
    this.drawInstant(ctx, style, p.cx + s, p.cy, p.th, false, true);
    ctx.restore();
    this.drawInstant(ctx, style, p.cx, p.cy, p.th, this.hoverClusterId === c.members[0].id);
  }

  private drawConnectors(ctx: CanvasRenderingContext2D, now: number): void {
    const t = this.theme;
    if (this.connectors.length === 0) return;
    const hovered = this.hover?.type === 'connector' ? this.hover.connector : null;
    for (const c of this.connectors) {
      const from = this.byId.get(c.fromIntervalId);
      const to = this.byId.get(c.toIntervalId);
      const isHover = hovered === c;
      ctx.strokeStyle = isHover ? t.fg : withAlpha(t.muted, 0.8);
      ctx.lineWidth = isHover ? 1.6 : 1;
      ctx.lineJoin = 'round';
      if (from && to) {
        const fr = this.rectFor(from, now);
        const tr = this.rectFor(to, now);
        const pts = connectorRoute(fr, tr);
        if (!this.routeVisible(pts)) continue;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        // Endpoint dots; highlighted while hovered.
        ctx.fillStyle = isHover ? t.fg : withAlpha(t.muted, 0.9);
        const last = pts[pts.length - 1];
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, isHover ? 2.4 : 1.8, 0, Math.PI * 2);
        ctx.arc(last.x, last.y, isHover ? 2.4 : 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (from || to) {
        // Stub: one endpoint is missing/not loaded — mark it explicitly.
        const anchor = this.rectFor((from ?? to) as NInterval, now);
        const sr = this.stubRect(anchor, !!from);
        const yMid = sr.y + sr.h / 2;
        ctx.setLineDash(MARKER_DASH);
        ctx.beginPath();
        ctx.moveTo(from ? sr.x : sr.x + sr.w, yMid);
        ctx.lineTo(from ? sr.x + sr.w - 4 : sr.x + 4, yMid);
        ctx.stroke();
        ctx.setLineDash(EMPTY_DASH);
        ctx.beginPath();
        ctx.arc(from ? sr.x + sr.w - 3 : sr.x + 3, yMid, 2.4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private routeVisible(pts: { x: number; y: number }[]): boolean {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    return maxX >= this.gutterW && minX <= this.cssW;
  }

  private drawMarkers(ctx: CanvasRenderingContext2D): void {
    const t = this.theme;
    const gx = this.gutterW;
    const plotW = this.plotWidth();
    const h = this.cssH;
    ctx.font = this.fontAxis;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const rv = this.renderView();
    for (const m of this.markers) {
      if (m.time < rv.start || m.time > rv.end) continue;
      const x = snap(gx + timeToX(m.time, rv, plotW), this.dpr);
      const color = m.kind === 'emphasis' ? t.emphasis : t.muted;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(MARKER_DASH);
      ctx.beginPath();
      ctx.moveTo(x, AXIS_H);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.setLineDash(EMPTY_DASH);
      if (m.label) {
        ctx.fillStyle = color;
        ctx.fillText(m.label, this.textPx(x + 5), this.textPx(AXIS_H + 9));
      }
    }
  }

  private drawNowLine(ctx: CanvasRenderingContext2D, now: number): void {
    // The RAW view, not renderView(): the now line is VIEWPORT-anchored —
    // while follow-now pins the view, `now` sits at a fixed span fraction
    // and this x must be frame-to-frame constant. The snapped render view
    // carries a per-frame quantization error that used to flip the
    // rounded x between adjacent device pixels — a visible wiggle in the
    // one state where the line must hold perfectly still (see nowLineX).
    const view = this.view;
    if (now < view.start || now > view.end) return;
    const t = this.theme;
    const x = nowLineX(now, view, this.gutterW, this.plotWidth(), this.dpr);
    // Stale: the line is parked at the last vouched timestamp, not ticking —
    // muted + dashed so it can't be mistaken for a live edge.
    const stale = this.feedStale;
    ctx.strokeStyle = stale ? withAlpha(t.muted, 0.8) : withAlpha(t.now, 0.85);
    ctx.lineWidth = 1;
    if (stale) ctx.setLineDash(MARKER_DASH);
    ctx.beginPath();
    ctx.moveTo(x, AXIS_H);
    ctx.lineTo(x, this.cssH);
    ctx.stroke();
    if (stale) ctx.setLineDash(EMPTY_DASH);
    // Small cap at the axis.
    ctx.fillStyle = stale ? t.muted : t.now;
    ctx.beginPath();
    ctx.moveTo(x - 3.5, AXIS_H);
    ctx.lineTo(x + 3.5, AXIS_H);
    ctx.lineTo(x, AXIS_H + 4.5);
    ctx.closePath();
    ctx.fill();
  }
}

// -- Helpers -----------------------------------------------------------------------

function readProp(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = cs.getPropertyValue(name).trim();
  return v !== '' ? v : fallback;
}

function readNum(cs: CSSStyleDeclaration, name: string, fallback: number, min: number, max: number): number {
  const v = parseFloat(cs.getPropertyValue(name));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Snap a CSS-px coordinate to the device-pixel grid + half-pixel (crisp 1px lines). */
function snap(v: number, dpr: number): number {
  return (Math.round(v * dpr) + 0.5) / dpr;
}

/** Explicit labelTiers win (sanitized); else derive from the label; null = single tier. */
function intervalLabelTiers(explicit: string[] | undefined, label: string): string[] | null {
  if (explicit !== undefined) {
    const tiers = explicit.filter((s) => typeof s === 'string' && s !== '');
    if (tiers.length > 0) return tiers;
  }
  if (label === '') return null;
  const derived = deriveLabelTiers(label);
  return derived.length > 1 ? derived : null;
}

/**
 * Apply an alpha to any supported color form we produce (#rrggbb, rgb/rgba,
 * hsl/hsla, oklch). Unknown forms are returned unchanged.
 */
function withAlpha(color: string, alpha: number): string {
  const a = Math.round(alpha * 1000) / 1000;
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 6 || hex.length === 3) {
      const full = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    return color;
  }
  if (color.startsWith('oklch(') && !color.includes('/')) {
    return `${color.slice(0, -1)} / ${a})`;
  }
  const rgbHsl = color.match(/^(rgb|hsl)a?\(([^)]+)\)$/);
  if (rgbHsl) {
    const parts = rgbHsl[2].split(',').map((s) => s.trim());
    return `${rgbHsl[1]}a(${parts.slice(0, 3).join(', ')}, ${a})`;
  }
  return color;
}

// Auto-register under the conventional tag name, but never clobber an existing
// definition (a consumer may have registered their own, or loaded this twice).
if (typeof customElements !== 'undefined' && !customElements.get('timeline-view')) {
  customElements.define('timeline-view', TimelineViewElement);
}
