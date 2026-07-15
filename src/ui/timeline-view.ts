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
 * Interaction is trackpad-first: two-finger pan (x = time;
 * y scrolls the lane stack when it overflows, and is otherwise left to
 * the PAGE — a plain vertical wheel never pans the chart sideways and
 * never has its default prevented, so page scrolling works across the
 * chart), ctrl/meta+wheel = smooth zoom anchored under the cursor
 * (discrete wheel steps glide), shift+wheel = time pan, drag = pan, pinch =
 * zoom, arrows/±/Home/End when focused. `loadRange` turns scrolling into
 * the past into async history requests — for BACKWARD gaps only; the live
 * forward edge always belongs to the consumer's own setData/mergeData
 * `coverage` — with uncovered regions visibly distinct from empty-but-known
 * ones and an explicit end-of-history boundary. Browser navigation
 * gestures never fire over the component: the wheel listener lives on the
 * HOST (horizontal deltas over the DOM chrome are consumed like over the
 * canvas) and the host carries overscroll-behavior: none, so panning hard
 * into exhausted history can't turn into a history-back swipe. A corner
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
 * Cheap by construction: draws only when dirty (one rAF at a time), a
 * continuous loop runs only while following/animating and the element is
 * visible, and idle animation is paced adaptively — full rate while
 * interacting (plus a short grace window), ~30fps idle, ~10fps idle on
 * battery (feature-detected via navigator.getBattery), paused while the
 * document is hidden; culled to the viewport; DPR-aware (capped at 3), on
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
  routeWheel,
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
  MIN_SPAN_MS,
  MAX_SPAN_MS,
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
  DEFAULT_STYLES,
  CoverageTracker,
  historyProbe,
  frameBudgetMs,
  shouldRender,
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
 * 'cluster' (a ×N group of visually-overlapping instant markers) is the
 * one hit type NEVER handed to tooltipFor: its summary tooltip is
 * component-built, and clicking it zooms to the member extent instead of
 * dispatching intervalclick.
 */
export type TimelineHit =
  | { type: 'interval'; interval: TimelineInterval; lane: TimelineLane }
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
  catKey: string;
  state: string;
  segs: NSeg[] | null;
  track: number;
  /** True while a ×N cluster represents this instant (it is not drawn/hit itself). */
  clustered: boolean;
}

/**
 * A ×N cluster of instant markers, re-derived per layout pass at the
 * current scale (clusterInstants). Occupies ONE packing slot spanning its
 * member extent — coincident instants can never blow up the lane height.
 */
interface NCluster {
  /** 'cluster:' + the FIRST member's id — the sticky packing identity (stable while membership is; see packLane). */
  id: string;
  laneIdx: number;
  /** Member start-time extent — the marker anchor and the click-to-zoom target. */
  extent: TimeRange;
  /** Members in (start, id) order. */
  members: NInterval[];
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
  labelColor: string;
}

const DEFAULT_SPAN_MS = 15 * 60_000;
const LAYOUT_TWEEN_MS = 150; // lane-height ease on visible-track-count AND fit-height change
const AXIS_H = 22;
const LANE_LABEL_MIN_PX = 10; // below this lane height the gutter label is tooltip-only
const HIT_MIN_W = 9; // widened hit target for instants (px)
const CONNECTOR_TOL = 4;
const CLICK_SLOP = 4;
const EMPTY_DASH: number[] = [];
const MARKER_DASH = [4, 3];
// A terminal-cut ('outline'-kind) segment never renders narrower than this
// many DEVICE pixels — a kill tail is typically sub-second (docker-kill
// latency), which at a 10-min window maps under half a CSS px and used to
// vanish entirely, leaving a cancelled bar pixel-identical to a success.
const TERMINAL_SEG_MIN_DEVICE_PX = 3;
// A dashed border needs room to read as dashes; narrower bars draw it
// solid (the hollow body still carries the state on a tiny bar).
const BORDER_DASH_MIN_PX = 12;
// Width (CSS px) of the edge-continuation fade on a span the viewport
// clips: the clipped end dissolves toward the edge — the cue that it
// continues off-screen (see edgeContinuation for the exemptions).
const EDGE_FADE_PX = 12;
// Backing-store cap: 3 keeps >2-DPR displays (150% 4K scaling, many
// laptops/mobiles) sharp instead of compositor-upscaled soft, without the
// fully-uncapped perf cliff on 4k+ screens.
const MAX_DPR = 3;
// The minimap strip's height (CSS px) — the plot canvas cedes this band
// at the bottom while the strip is visible. One source of truth: the
// element sets the strip canvas' CSS height from it too.
const MINIMAP_H = 32;
// Hosts shorter than this hide the strip: below ~140px the band would eat
// a third of an already-cramped plot.
const MINIMAP_MIN_HOST_PX = 140;

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
 * the bottom overview strip).
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
    return ['no-live-pill', 'no-auto-fit', 'history-end-text', 'empty-text', 'fullscreen', 'no-fullscreen-button', 'no-minimap'];
  }

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private tooltipEl: HTMLDivElement;
  private pillEl: HTMLButtonElement;
  private fsEl: HTMLButtonElement;
  private emptyEl: HTMLDivElement;
  private staleEl: HTMLDivElement;

  // -- Minimap strip --
  private mmCanvas: HTMLCanvasElement;
  private mmCtx: CanvasRenderingContext2D | null = null;
  private mmVisible = false;
  private mmDrag: { mode: 'left' | 'right' | 'middle'; lastX: number } | null = null;
  private hadData = false; // data-emptiness edge → re-evaluate strip visibility

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
  private view: TimeView = { start: 0, end: 1 }; // set on connect/first data
  private following = true;
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
  private hoverClusterId: string | null = null; // first-member id of the hovered ×N cluster
  private glidePx = 0; // pending discrete-wheel zoom, in wheel px
  private glideX = 0; // zoom anchor (canvas x) for the glide
  private lastFrame = 0;
  private lastInputTs = -Infinity; // last wheel/drag/key input (perf-clock)
  private lastRenderTs = -Infinity; // last RENDERED frame (adaptive pacing)
  private batteryDischarging = false;
  private batteryOff: (() => void) | null = null;

  // -- Visible-window lane layout + auto-fit --
  private packEpoch = 0; // bumped on data changes; forces a re-pack
  private packedEpoch = -1;
  private packedStart = NaN;
  private packedEnd = NaN;
  private packedPlotW = NaN; // clustering is scale-aware: a resize re-derives it
  // Per-lane ×N clusters for the current window (rebuilt with the pack).
  private laneClusters: NCluster[][] = [];
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
  private charW = 6;
  private gutterW = 90;
  private oklch = true;
  private reducedMotion = false;
  private colorCache = new Map<string, ResolvedStyle>();
  private patternCache = new Map<string, CanvasPattern>();

  private raf = 0;
  private dirty = false;
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
    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'empty-hint';
    this.emptyEl.hidden = true;
    this.staleEl = document.createElement('div');
    this.staleEl.className = 'stale-note';
    this.staleEl.hidden = true;
    // fsEl precedes pillEl so `.fs-pill[hidden] ~ .live-pill` can reclaim
    // the corner when the toggle is opted out.
    shadow.append(this.canvas, this.mmCanvas, this.tooltipEl, this.fsEl, this.pillEl, this.emptyEl, this.staleEl);

    const now = this.nowMs();
    this.view = { start: now - DEFAULT_SPAN_MS, end: now };
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
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name === 'fullscreen' && oldValue !== newValue) this.applyFullscreen(newValue !== null);
    if (name === 'no-minimap' && oldValue !== newValue) this.resizeBackingStore(); // strip visibility re-evaluates there
    this.syncChrome();
    this.invalidate();
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
    if (e.key === 'Escape' && this.fullscreen) {
      e.preventDefault();
      this.fullscreen = false;
    }
  };

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
    this.loadTick++;
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
    this.rebuild();
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
    this.mergeData({ lanes, intervals: kept, connectors });
  }

  setIntervals(intervals: TimelineInterval[]): void {
    this.byId.clear();
    this.perLane = this.lanes.map(() => []);
    for (const iv of intervals) this.ingestInterval(iv);
    this.rebuild();
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
    const span = Math.min(Math.max(e - s, MIN_SPAN_MS), MAX_SPAN_MS);
    this.applyUserView({ start: s, end: s + span }, { jump: true });
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
    const lane = this.lanes[laneIdx];
    const start = toMs(iv.start);
    const end = iv.end == null ? null : toMs(iv.end);
    const n: NInterval = {
      src: iv,
      id: iv.id,
      laneIdx,
      start,
      end,
      label: iv.label ?? '',
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
      const arr = this.perLane[prev.laneIdx];
      arr.splice(arr.indexOf(prev), 1);
    }
    this.byId.set(iv.id, n);
    this.perLane[laneIdx].push(n);
  }

  /**
   * Re-sort and re-layout after any data change. Track assignment and lane
   * heights come from the VISIBLE window (updateVisibleLayout), so a
   * historical parallelism burst stops padding its lane once off-screen.
   */
  private rebuild(): void {
    for (const per of this.perLane) {
      per.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    // Row memory follows its lane's lifetime: allocators for lanes that
    // no longer exist are dropped; surviving lanes keep theirs (so a full
    // setData resync leaves on-screen rows exactly where they were).
    for (const key of [...this.allocators.keys()]) {
      if (!this.laneIdxById.has(key)) this.allocators.delete(key);
    }
    this.packEpoch++;
    this.updateVisibleLayout();
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
    this.invalidate();
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
    const structure = this.targetCounts.length !== this.perLane.length;
    let changed = false;
    if (
      this.packedEpoch !== this.packEpoch ||
      this.packedStart !== rv.start ||
      this.packedEnd !== rv.end ||
      this.packedPlotW !== plotW ||
      structure
    ) {
      this.packedEpoch = this.packEpoch;
      this.packedStart = rv.start;
      this.packedEnd = rv.end;
      this.packedPlotW = plotW;
      const prev = this.targetCounts;
      const next = new Array<number>(this.perLane.length);
      changed = structure;
      this.laneClusters.length = this.perLane.length;
      for (let i = 0; i < this.perLane.length; i++) {
        next[i] = this.packLane(i, rv, plotW);
        if (!changed && prev[i] !== next[i]) changed = true;
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
   * Cluster + row one lane for the current window; returns its visible
   * track count. Instant markers that visually overlap at this scale
   * merge into ×N clusters (clusterInstants — component-native and
   * scale-aware, so zooming in splits them); each cluster then packs as
   * ONE item spanning its member extent, which is what keeps a burst of
   * coincident instants from blowing up the lane height. Rows come from
   * the lane's sticky TrackAllocator; a cluster's packing identity is its
   * FIRST member's id, stable while membership is (pure pans never change
   * membership), so a cluster's row doesn't hop frame to frame. Members
   * ride their cluster's row — hit rects and connector endpoints anchored
   * on a member resolve to the cluster's position.
   */
  private packLane(laneIdx: number, rv: TimeView, plotW: number): number {
    const per = this.perLane[laneIdx];
    const lane = this.lanes[laneIdx];
    const { clusters, memberOf } = clusterInstants(per, rv, plotW);
    const ncs: NCluster[] = clusters.map((c) => {
      const members = c.indices.map((j) => per[j]);
      const keys = this.clusterKeys(members, lane);
      return { id: `cluster:${members[0].id}`, laneIdx, extent: c.extent, members, catKey: keys.catKey, state: keys.state, track: -1 };
    });
    const items: PackItem[] = [];
    const targets: { track: number }[] = [];
    for (let j = 0; j < per.length; j++) {
      per[j].clustered = memberOf[j] >= 0;
      if (memberOf[j] >= 0) continue;
      items.push(per[j]);
      targets.push(per[j]);
    }
    for (const nc of ncs) {
      items.push({ id: nc.id, start: nc.extent.start, end: nc.extent.end });
      targets.push(nc);
    }
    const { tracks, trackCount } = this.allocatorFor(lane.id).assign(items, rv);
    for (let k = 0; k < tracks.length; k++) {
      if (tracks[k] >= 0) targets[k].track = tracks[k];
    }
    for (const nc of ncs) {
      if (nc.track >= 0) for (const member of nc.members) member.track = nc.track;
    }
    this.laneClusters[laneIdx] = ncs;
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
    for (const member of members) {
      if (member.state !== state) state = '';
      if (member.catKey !== catKey) catKey = laneCat;
    }
    return { catKey, state };
  }

  private metrics(): { trackHeight: number; trackGap: number; lanePad: number } {
    return { trackHeight: this.theme.trackHeight, trackGap: 2, lanePad: 3 };
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

  /** True while something time-based needs continuous frames. */
  private animating(): boolean {
    if (this.glidePx !== 0 || this.layoutAnim !== null || this.leadAnim !== null || this.edgeAnim !== null) return true;
    // While STALE the followed view is frozen at the dead feed's edge —
    // nothing moves, so no continuous frames (the watchdog interval keeps
    // the note's counter alive and notices recovery).
    if (this.following && !this.feedStale) return true;
    // In-flight history loads AND failed ones waiting out the fixed retry
    // cadence both need frames — without the latter, a rejected loadRange in
    // a paused historical view would park silently until the next input
    // instead of retrying every ~2s.
    if (this.loadRangeFn && (this.coverage.pending() || this.coverage.waitingRetry(this.nowMs()))) return true;
    if (this.reducedMotion || this.feedStale) return false; // frozen stale bars don't pulse
    // Ongoing intervals pulse only while their live edge is in view.
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
    // Adaptive pacing: a pure animation frame (nothing dirty) renders only
    // when the current tier's budget has elapsed — full rate while
    // interacting, ~30fps idle, ~10fps idle on battery. Dirty frames
    // (fresh data, hover changes) always render immediately.
    if (!this.dirty && !shouldRender(t, this.lastRenderTs, frameBudgetMs(this.renderTier()))) {
      if (this.animating()) this.schedule();
      else this.lastFrame = 0;
      return;
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
      this.draw();
    }
    if (this.animating()) this.schedule();
    else this.lastFrame = 0;
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

  private resizeBackingStore(): void {
    const raw = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const dpr = Math.min(MAX_DPR, raw);
    const hostH = this.clientHeight;
    // Minimap visibility is decided here — the one place that already
    // owns geometry: data must exist, the host must not be opted out or
    // too short. While visible, the PLOT canvas cedes the strip's band
    // (cssW/cssH describe the plot canvas only, so every downstream
    // computation — lane packing, auto-fit, tooltip clamps, hit tests —
    // stays consistent without knowing the strip exists), and the corner
    // buttons ride up above the band.
    const wantMM = !this.hasAttribute('no-minimap') && this.byId.size > 0 && hostH >= MINIMAP_MIN_HOST_PX;
    if (wantMM !== this.mmVisible) {
      this.mmVisible = wantMM;
      this.mmCanvas.hidden = !wantMM;
      this.canvas.style.height = wantMM ? `calc(100% - ${MINIMAP_H}px)` : '';
      const lift = wantMM ? `${MINIMAP_H + 10}px` : '';
      this.pillEl.style.bottom = lift;
      this.fsEl.style.bottom = lift;
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
    this.oklch = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('color', 'oklch(0.6 0.1 120)');
    const ctx = this.ctx2d();
    if (ctx) {
      ctx.font = this.fontBar;
      const probe = 'abcdefghijklmnop0123456789';
      this.charW = ctx.measureText(probe).width / probe.length || 6;
    }
    this.colorCache.clear();
    this.patternCache.clear();
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
    const out: ResolvedStyle = {
      fill,
      border: emphasisBorder ? t.emphasis : border,
      borderWidth: st.border?.width ?? 1,
      dash: st.border?.dash ?? null,
      pattern: st.pattern ?? 'solid',
      glyph: st.glyph ?? 'none',
      labelColor: (st.alphaScale ?? 1) < 0.7 ? t.muted : t.fg,
    };
    this.colorCache.set(cacheKey, out);
    return out;
  }

  private patternFor(kind: 'hatch' | 'stipple', color: string): CanvasPattern | null {
    const key = `${kind}\u0000${color}`;
    const hit = this.patternCache.get(key);
    if (hit) return hit;
    const size = 7;
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

  // -- Geometry ----------------------------------------------------------------

  /**
   * CSS-px rect of an interval (valid even outside the viewport). Mapped
   * through the device-pixel-snapped render view and deliberately NOT
   * rounded per element — one global rounding policy (renderView), so bars
   * hold exact relative offsets while the viewport translates.
   */
  private rectFor(n: NInterval, now: number): HitRect {
    const w = this.plotWidth();
    const m = this.metrics();
    const rv = this.renderView();
    const th = this.laneTrackHeight(n.laneIdx); // per-lane: compact lanes (and tweens) shrink rect + hit target together
    const xs = this.gutterW + timeToX(n.start, rv, w);
    const xe = this.gutterW + timeToX(n.end ?? now, rv, w);
    const y = AXIS_H + this.layout.tops[n.laneIdx] - this.laneScroll + trackTop(n.track, m, th);
    return { x: xs, y, w: Math.max(0, xe - xs), h: th };
  }

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
    // puts the lane's ×N cluster markers (drawn after its bars) first.
    const laneIdx = this.laneAtY(y);
    if (laneIdx >= 0) {
      const ncs = this.laneClusters[laneIdx];
      if (ncs) {
        for (let i = ncs.length - 1; i >= 0; i--) {
          const p = this.clusterPos(ncs[i]);
          if (!p) continue;
          const r = expandHitRect({ x: p.cx - (p.r + 2), y: p.y, w: (p.r + 2) * 2, h: p.th }, HIT_MIN_W);
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            return { type: 'cluster', intervals: ncs[i].members.map((member) => member.src), lane: this.lanes[laneIdx] };
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
          return { type: 'interval', interval: n.src, lane: this.lanes[n.laneIdx] };
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
    const route = routeWheel(e, this.maxLaneScroll() > 0);
    // Consume (preventDefault) ONLY when some axis actually routed to the
    // chart. A plain vertical wheel while the lanes don't overflow routes
    // nowhere — it must reach the page and scroll it normally, never pan
    // the chart sideways. (The listener stays {passive: false} so
    // preventDefault remains available for the consumed cases.)
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
   * nothing is loaded (the strip is hidden then anyway). O(n) over the
   * loaded intervals; called per drawn frame and per strip pointer event,
   * both of which already do O(n) work.
   */
  private mmExtent(): TimeView | null {
    let earliest = Infinity;
    let latest = -Infinity;
    for (const per of this.perLane) {
      if (per.length > 0 && per[0].start < earliest) earliest = per[0].start;
      for (const n of per) {
        if (n.end !== null && n.end > latest) latest = n.end;
      }
    }
    const cov = this.coverage.coveredRanges();
    return minimapExtent(
      Number.isFinite(earliest) ? earliest : null,
      Number.isFinite(latest) ? latest : null,
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
    // identity). No intervalhover: a ×N group is not a single interval.
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
    // Per-lane collapsed density marks. Sub-pixel runs stay ≥ 1px so the
    // low-alpha marks accumulate into a density read where they pile up.
    const laneN = this.perLane.length;
    const padY = 3;
    const rowH = laneN > 0 ? (h - padY * 2) / laneN : 0;
    const markH = Math.max(1, Math.min(rowH * 0.75, 6));
    const dim = new Map<string, string>();
    for (let li = 0; li < laneN; li++) {
      const per = this.perLane[li];
      const y = padY + li * rowH + (rowH - markH) / 2;
      for (const n of per) {
        const x0 = timeToX(n.start, ext, w);
        if (x0 > w) break; // sorted by start
        const x1 = timeToX(n.end ?? now, ext, w);
        if (x1 < 0) continue;
        let fill = dim.get(n.catKey);
        if (fill === undefined) {
          fill = withAlpha(this.resolved(n.catKey, '', null).fill, 0.55);
          dim.set(n.catKey, fill);
        }
        ctx.fillStyle = fill;
        ctx.fillRect(x0, y, Math.max(x1 - x0, 1), markH);
      }
    }
    // The live edge, frozen + muted while the feed is stale (the main
    // now line's language).
    const nx = timeToX(now, ext, w);
    if (nx >= 0 && nx <= w) {
      ctx.fillStyle = this.feedStale ? t.muted : withAlpha(t.now, 0.8);
      ctx.fillRect(nx - 0.5, 0, 1, h);
    }
    // The visible window: brighter rect + edge handle bars.
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
    for (let i = 0; i < this.lanes.length; i++) {
      const top = AXIS_H + tops[i] - this.laneScroll;
      const lh = heights[i];
      if (top + lh < AXIS_H || top > h) continue;
      if (i % 2 === 1 && t.rowTint !== 'none') {
        ctx.fillStyle = t.rowTint;
        ctx.fillRect(0, Math.max(AXIS_H, top), w, Math.min(top + lh, h) - Math.max(AXIS_H, top));
      }
      const yBottom = snap(top + lh, dpr);
      if (yBottom > AXIS_H && yBottom < h) {
        ctx.strokeStyle = t.hairline;
        ctx.lineWidth = hairline;
        ctx.beginPath();
        ctx.moveTo(0, yBottom);
        ctx.lineTo(w, yBottom);
        ctx.stroke();
      }
      // Gutter label, graded by the lane's CURRENT height: full while the
      // lane comfortably fits the base font; smaller + faded while it
      // doesn't (compact lanes); skipped entirely below legibility
      // (LANE_LABEL_MIN_PX — the gutter tooltip still names the lane).
      // Every label is centered in its own band at a font under the band
      // height, so adjacent lanes' labels can never overlap.
      if (lh >= LANE_LABEL_MIN_PX && top + lh / 2 > AXIS_H + 4 && top + lh / 2 < h - 2) {
        const full = lh >= t.fontSize + 5;
        const fs = full ? t.fontSize : Math.max(7, Math.min(t.fontSize - 2, Math.floor(lh - 3)));
        const charW = full ? this.charW : (this.charW * fs) / t.fontSize;
        const label = fitText(this.lanes[i].label, this.gutterW - 16, charW);
        if (label !== '') {
          ctx.font = full ? this.fontBar : `${fs}px ${t.font}`;
          ctx.fillStyle = full ? t.muted : withAlpha(t.muted, 0.7);
          ctx.fillText(label, this.textPx(8), this.textPx(top + lh / 2 + 0.5));
        }
      }
    }
    ctx.font = this.fontBar; // undo any compact-label font downshift
    // Gutter | plot separator.
    ctx.strokeStyle = t.hairline;
    ctx.lineWidth = hairline;
    ctx.beginPath();
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
        ctx.fillStyle = pat ?? withAlpha(t.muted, 0.08);
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
      const per = this.perLane[laneIdx];
      for (let i = 0; i < per.length; i++) {
        const n = per[i];
        if (n.start > rv.end) break; // sorted by start
        if ((n.end ?? now) < rv.start && n.end !== null) continue;
        if (n.clustered) continue; // drawn as its cluster's ×N marker below
        this.drawInterval(ctx, n, now);
      }
      // The lane's ×N cluster markers, over its bars.
      const ncs = this.laneClusters[laneIdx];
      if (ncs) for (const c of ncs) this.drawCluster(ctx, c);
    }
    void dpr;
    void t;
  }

  private drawInterval(ctx: CanvasRenderingContext2D, n: NInterval, now: number): void {
    const t = this.theme;
    const dpr = this.dpr;
    const rv = this.renderView();
    const plotW = this.plotWidth();
    const r = this.rectFor(n, now);
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
      this.drawInstant(ctx, n, style, r.x + r.w / 2, r.y + bh / 2, bh, hovered);
      return;
    }

    // Which ends the viewport clips (the span truly continues off-screen
    // past them) — those ends get the edge-continuation fade, painted
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
        ctx.fillStyle = pat;
        ctx.fillRect(x0, y, bw, bh);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = style.fill;
      ctx.fill(path);
    }

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
          // and renders visibly — a dark scrim over the dead tail plus a
          // bright cut line at the kill point — never a near-invisible
          // low-alpha wash.
          const minW = TERMINAL_SEG_MIN_DEVICE_PX / dpr;
          if (sx1 - sx0 < minW) sx0 = Math.max(x0, sx1 - minW);
          ctx.fillStyle = withAlpha('#000000', 0.45);
          ctx.fillRect(sx0, y, sx1 - sx0, bh);
          ctx.fillStyle = withAlpha(t.fg, 0.85);
          ctx.fillRect(sx0, y, Math.min(1, sx1 - sx0), bh);
          continue;
        }
        if (sx1 - sx0 < 0.5) continue;
        if (ss.pattern === 'hatch' || ss.pattern === 'stipple') {
          ctx.fillStyle = withAlpha(ss.fill, 0.2);
          ctx.fillRect(sx0, y, sx1 - sx0, bh);
          const pat = this.patternFor(ss.pattern, ss.fill);
          if (pat) {
            ctx.fillStyle = pat;
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
          ctx.fillStyle = pat;
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
    // off-screen — just past the continuation fade when one is active, so
    // the sticky label never sits inside the dissolved zone.
    if (bh >= t.fontSize + 3) {
      const pad = 5;
      const glyphPad = style.glyph === 'bang' ? 8 : 0;
      const labelX = Math.max(x0, this.gutterW + (fade.left ? EDGE_FADE_PX : 0)) + pad;
      const label = fitText(n.label, x1 - labelX - pad - glyphPad, this.charW);
      if (label !== '') {
        ctx.fillStyle = style.labelColor;
        ctx.fillText(label, this.textPx(labelX), this.textPx(y + bh / 2 + 0.5));
      }
    }

    if (hovered) {
      ctx.strokeStyle = withAlpha('#ffffff', 0.75);
      ctx.lineWidth = 1.25;
      ctx.stroke(path);
    }

    // Edge-continuation fade: the clipped end dissolves into the
    // background over the last EDGE_FADE_PX toward the viewport edge —
    // the cue that the span continues off-screen. Painted OVER the
    // finished bar (fill, segments, border, hover ring) as a gradient to
    // the background color — not an alpha erase — so it reads identically
    // for solid, hollow, hatched, and scrimmed treatments and stays
    // correct on an opaque canvas. The rect overshoots the bar by 1px
    // vertically to catch the border's outer half (still inside the 2px
    // track gap).
    if (fade.left) {
      const gx = this.gutterW;
      const grad = ctx.createLinearGradient(gx, 0, gx + EDGE_FADE_PX, 0);
      grad.addColorStop(0, t.bg);
      grad.addColorStop(1, withAlpha(t.bg, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(gx, y - 1, EDGE_FADE_PX, bh + 2);
    }
    if (fade.right) {
      const ex = this.gutterW + plotW;
      const grad = ctx.createLinearGradient(ex - EDGE_FADE_PX, 0, ex, 0);
      grad.addColorStop(0, withAlpha(t.bg, 0));
      grad.addColorStop(1, t.bg);
      ctx.fillStyle = grad;
      ctx.fillRect(ex - EDGE_FADE_PX, y - 1, EDGE_FADE_PX, bh + 2);
    }
  }

  private drawInstant(
    ctx: CanvasRenderingContext2D,
    n: NInterval,
    style: ResolvedStyle,
    cx: number,
    cy: number,
    trackH: number,
    hovered: boolean,
  ): void {
    const t = this.theme;
    // Pips shrink with the track but never below a visible 4px diamond
    // (compact tracks: the pip fills the 4px band instead of vanishing).
    const r = Math.max(2, Math.min(trackH * 0.42, 8));
    const rx = r * 0.78;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + rx, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - rx, cy);
    ctx.closePath();
    ctx.fillStyle = style.pattern === 'outline' ? withAlpha(style.fill, 0.15) : style.fill;
    ctx.fill();
    const emphasis = style.glyph === 'bang' || style.border === t.emphasis;
    ctx.strokeStyle = style.border;
    ctx.lineWidth = emphasis ? 2 : 1;
    ctx.stroke();
    if (emphasis) {
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
    const r = Math.max(2, Math.min(th * 0.42, 8));
    const marginMs = ((r + 2) * (rv.end - rv.start)) / plotW;
    const mt = clusterMarkerTime(c.extent, rv, marginMs);
    if (mt === null) return null;
    const m = this.metrics();
    const y = AXIS_H + this.layout.tops[c.laneIdx] - this.laneScroll + trackTop(c.track, m, th);
    return { cx: this.gutterW + timeToX(mt, rv, plotW), cy: y + th / 2, y, th, r };
  }

  /**
   * A ×N cluster marker: a filled disc + halo ring with a ×N count badge.
   * ROUND on purpose — a point-like group marker that can never be
   * confused with the diamond pips (filled diamond = one instant, hollow
   * diamond = cancelled). Styled by the members' shared state where
   * uniform (an all-skipped cluster stays skip-flavored) and neutrally
   * when mixed; sits at the extent midpoint, sliding along the visible
   * slice at a window edge (clusterMarkerTime). Like pips, clusters get
   * no edge-continuation fade — a point marker has no clipped extent.
   */
  private drawCluster(ctx: CanvasRenderingContext2D, c: NCluster): void {
    const p = this.clusterPos(c);
    if (!p) return;
    const t = this.theme;
    const style = this.resolved(c.catKey, c.state, null);
    const rd = Math.max(1.6, p.r * 0.85);
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, rd, 0, Math.PI * 2);
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.strokeStyle = style.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    // The halo — the "more than one here" cue — only where the track is
    // tall enough to contain it (compact slivers keep the bare disc).
    if (p.th >= (rd + 2) * 2) {
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, rd + 2, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(style.border, 0.5);
      ctx.stroke();
    }
    // ×N badge — same fit rule as bar labels (suppressed on slivers).
    if (p.th >= t.fontSize + 3) {
      ctx.font = this.fontBar;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = style.labelColor;
      ctx.fillText(`×${c.members.length}`, this.textPx(p.cx + p.r + 4), this.textPx(p.cy + 0.5));
    }
    if (this.hoverClusterId === c.members[0].id) {
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, rd + 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha('#ffffff', 0.75);
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
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
    const rv = this.renderView();
    if (now < rv.start || now > rv.end) return;
    const t = this.theme;
    const x = snap(this.gutterW + timeToX(now, rv, this.plotWidth()), this.dpr);
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
