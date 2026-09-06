// The <dag-view> custom element: a canvas-painted, pan/zoom directed
// acyclic graph. The layout, the viewport transform and every hit test live
// in ./dag-view-math.ts (pure, node-tested); this file is the canvas and
// DOM half -- sizing, theming, painting, input, accessibility.
//
// WHY CANVAS. A dependency graph is the case where SVG stops being free: a
// few hundred nodes with their edges is a few thousand elements, and every
// pan and zoom then asks the engine to re-style and re-layout all of them.
// Canvas turns that into one transform and a redraw of only what is on
// screen, which is what makes a graph of a whole org's repositories usable
// rather than technically possible.

import dagCss from './dag-view.css';
import {
  layoutDag,
  layoutBounds,
  fitViewport,
  clampViewport,
  zoomViewportAt,
  zoomFactorForWheel,
  panViewport,
  screenToWorld,
  worldToScreen,
  visibleWorldRect,
  visibleNodes,
  visibleEdges,
  hitTestNodes,
  hitTestEdges,
  neighbourhood,
  criticalPathLength,
  nodeHue,
  measureNode,
  MIN_SCALE,
  MAX_SCALE,
} from './dag-view-math.ts';
import type {
  DagNode,
  DagEdge,
  DagLayout,
  DagOrientation,
  DagViewport,
  PlacedNode,
  PlacedEdge,
  Neighbourhood,
  WorldRect,
} from './dag-view-math.ts';
import { categoryColor, categoryJitter, dimColor, labelHaloColor } from './color.ts';

export * from './dag-view-math.ts';

// -- Theme -------------------------------------------------------------------------

/**
 * Theme defaults. Override per element / ancestor / :root with the CSS
 * custom properties named here.
 */
export const THEME_DEFAULTS = {
  /** --dag-bg — canvas background. MUST be opaque (see ctx2d). */
  bg: '#0d0f14',
  /** --dag-fg — node labels and primary text. */
  fg: '#e8ecf4',
  /** --dag-muted — sublabels, secondary text, idle chrome. */
  muted: '#6b7280',
  /** --dag-grid — the background dot grid ('none' disables it). */
  grid: 'rgba(200, 205, 216, 0.06)',
  /** --dag-hairline — node borders when a node has no category. */
  hairline: 'rgba(200, 205, 216, 0.22)',
  /** --dag-edge — the default edge line. */
  edge: 'rgba(200, 205, 216, 0.42)',
  /** --dag-accent — selection, focus ring, search matches. */
  accent: '#4aa3ff',
  /** --dag-emphasis — cycle edges and the notice strip. */
  emphasis: '#ff5c5c',
  /** --dag-font — font family for all canvas text. */
  font: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
  /** --dag-font-size — base font size in px. */
  fontSize: 11,
  /** --dag-node-radius — node corner radius in px. */
  nodeRadius: 5,
  /** --dag-cat-lightness — oklch lightness for category fills (0..1). */
  catLightness: 0.62,
  /** --dag-cat-chroma — oklch chroma for category fills. */
  catChroma: 0.11,
  /** --dag-gap — cross-axis gap between nodes in a layer, px. */
  gap: 24,
  /**
   * --dag-layer-gap — gap between layers, px. Every layer costs this plus a
   * node's height, so it sets how many layers fit legibly in a given box:
   * generous spacing that pushes the fitted view under the label LOD buys
   * air at the cost of the labels.
   */
  layerGap: 48,
};

type Theme = typeof THEME_DEFAULTS;

// -- Public types --------------------------------------------------------------------

/** The full data payload for setData. */
export interface DagData {
  nodes?: DagNode[];
  edges?: DagEdge[];
}

/** Fill pattern for a node `state`. */
export type DagPattern = 'solid' | 'hatch' | 'outline' | 'stipple';

/** Rendering treatment for one node `state` or edge `state`. */
export interface DagStyle {
  pattern?: DagPattern;
  /** Overrides the category color entirely. */
  color?: string;
  /** Dashed outline / dashed edge line. */
  dashed?: boolean;
  /** Draws the border thicker, for a state that must be noticed. */
  emphasis?: boolean;
  /** Renders the node and its labels at half saturation and value. */
  dim?: boolean;
}

/** Named style map: node/edge `state` -> treatment. */
export type DagStyleMap = Record<string, DagStyle>;

/**
 * Built-in states. A consumer's own `styles` map is merged OVER this, so
 * these are defaults rather than a closed vocabulary -- any `state` string
 * with no entry falls back to a plain solid node in its category color,
 * which is a readable node, never a blank one.
 */
export const DEFAULT_STYLES: DagStyleMap = {
  done: { pattern: 'solid' },
  blocked: { pattern: 'hatch', emphasis: true },
  pending: { pattern: 'outline', dashed: true },
  missing: { pattern: 'outline', dim: true, dashed: true },
  failed: { pattern: 'stipple', emphasis: true },
};

/** What the pointer is over. Handed to tooltipFor and the hover events. */
export type DagHit =
  | { type: 'node'; node: DagNode; placed: PlacedNode }
  | { type: 'edge'; edge: DagEdge; placed: PlacedEdge };

/** One row of a tooltip. A `null` return means "no tooltip for this hit". */
export interface TooltipRow {
  key: string;
  value: string;
}

/** Consumer tooltip builder. */
export type TooltipFn = (hit: DagHit) => { title?: string; rows?: TooltipRow[] } | null;

/** Consumer color override. Returning null keeps the derived category color. */
export type ColorFn = (node: DagNode) => string | null;

/** Read-only layout facts, for a consumer that wants to report on the graph. */
export interface DagInfo {
  nodeCount: number;
  edgeCount: number;
  layerCount: number;
  /** Longest dependency chain, in nodes. */
  criticalPath: number;
  /** Edge crossings the layout settled on. */
  crossings: number;
  /** Ids of the edges reversed to break a cycle, as `from -> to` pairs. */
  cycles: { from: string; to: string }[];
  /** Input edges not drawn, with the reason. */
  rejected: { from: string; to: string; reason: string }[];
}

/** A rectangle, in whichever coordinate system its field names. */
export interface DagSnapshotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One node, where the layout put it and where that landed on the canvas. */
export interface DagSnapshotNode {
  id: string;
  label: string | null;
  sublabel: string | null;
  category: string | null;
  state: string | null;
  layer: number;
  world: DagSnapshotRect;
  /** CSS pixels, origin at the canvas top-left. */
  screen: DagSnapshotRect;
  /** Whether the box overlaps the canvas at all. */
  visible: boolean;
}

/** One routed edge, in both coordinate systems. */
export interface DagSnapshotEdge {
  from: string;
  to: string;
  label: string | null;
  reversed: boolean;
  world: { x: number; y: number }[];
  screen: { x: number; y: number }[];
}

/**
 * Everything on screen, as data. See the `snapshot` getter, and the
 * right-click that copies this to the clipboard.
 */
export interface DagSnapshot {
  capturedAt: string;
  orientation: DagOrientation;
  canvas: { width: number; height: number; dpr: number };
  viewport: DagViewport;
  bounds: DagSnapshotRect;
  info: DagInfo;
  nodes: DagSnapshotNode[];
  edges: DagSnapshotEdge[];
}

// -- Constants ---------------------------------------------------------------------

const MAX_DPR = 3;
/** World-space tolerance for grabbing an edge, in CSS px at scale 1. */
const EDGE_HIT_TOL = 6;

/** How long the right-click's confirmation stays on screen, in ms. */
const TOAST_MS = 2600;
/**
 * Below this scale, node labels stop being drawn. The threshold is the
 * point where an 11px label is under ~4.5px and genuinely unreadable --
 * pitched deliberately low, because a graph whose fitted view lands just
 * under it shows a reader nothing but coloured boxes and reads as broken.
 */
const LOD_LABEL_SCALE = 0.4;
/** Below this scale, nodes draw as plain filled marks with no border or text. */
const LOD_MARK_SCALE = 0.22;
/** Pointer travel (CSS px) past which a press is a pan, not a click. */
const DRAG_SLOP = 4;
/** Zoom step for the buttons and the +/- keys. */
const ZOOM_STEP = 1.35;
/** Alpha applied to everything outside the highlighted neighbourhood. */
const FADE_ALPHA = 0.14;
/** Frame budget while nothing is being interacted with (~30fps). */
const IDLE_FRAME_MS = 1000 / 30;
/** Full-rate grace window after the last input, so interaction never feels throttled. */
const INTERACT_GRACE_MS = 500;
/** Node count past which hover highlighting is computed lazily, once per hover. */
const HIGHLIGHT_CACHE_MAX = 64;

// -- The element ---------------------------------------------------------------------

/**
 * The DAG element. Auto-registered as `<dag-view>` when this module loads
 * (unless the name is taken). Data arrives via properties and methods --
 * `setData` / `nodes` / `edges` -- never attributes; the attributes are
 * scalar toggles: `orientation` ("TB" or "LR"), `no-search`, `no-toolbar`,
 * `no-fullscreen-button`, `no-minimap`, `empty-text`, and `fullscreen`
 * (reflected viewport-fill mode -- see the `fullscreen` property).
 *
 * INPUT. Drag pans. Ctrl/Cmd + wheel and pinch zoom; a PLAIN wheel pans
 * instead of zooming, so the element never swallows a page scroll that was
 * meant for the page -- the zoom buttons and the +/- keys are the
 * discoverable path. Clicking a node selects it; hovering one fades
 * everything outside its dependency neighbourhood, which is the question a
 * dependency graph exists to answer and the one thing you cannot do by
 * following lines with your eyes.
 *
 * WHAT THE LAYOUT COULD NOT HONOUR IS SHOWN, NOT SWALLOWED. A circular
 * dependency is drawn in the emphasis color with its arrow still pointing
 * the true way, and the notice strip names the count of cycles, dropped
 * edges and overruled layer hints. Read `info` for the same facts as data.
 */
export class DagViewElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['orientation', 'no-search', 'no-toolbar', 'no-fullscreen-button', 'no-minimap', 'empty-text', 'fullscreen'];
  }

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private tooltipEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private emptyEl: HTMLDivElement;
  private noticeEl: HTMLButtonElement;
  private searchEl: HTMLInputElement;
  private fitBtn: HTMLButtonElement;
  private zoomInBtn: HTMLButtonElement;
  private zoomOutBtn: HTMLButtonElement;
  private orientBtn: HTMLButtonElement;
  private fsBtn: HTMLButtonElement;
  private liveEl: HTMLDivElement;

  private ro: ResizeObserver | null = null;
  private raf = 0;
  private dirty = true;
  private lastRenderTs = 0;
  private lastInputTs = 0;

  private dpr = 1;
  private cssW = 0;
  private cssH = 0;

  private theme: Theme = { ...THEME_DEFAULTS };
  private fontLabel = `11px ${THEME_DEFAULTS.font}`;
  private fontSub = `10px ${THEME_DEFAULTS.font}`;
  private charW = 6.2;
  private labelHalo = labelHaloColor(THEME_DEFAULTS.fg);
  private oklch = true;

  private rawNodes: DagNode[] = [];
  private rawEdges: DagEdge[] = [];
  private layout: DagLayout = layoutDag([], []);
  private bounds: WorldRect = { x: 0, y: 0, w: 0, h: 0 };
  private view: DagViewport = { x: 0, y: 0, scale: 1 };
  /** False until the first fit or a consumer viewport write; see fitIfUntouched. */
  private viewTouched = false;
  private layoutStale = true;

  private orientationValue: DagOrientation = 'TB';
  private styleMap: DagStyleMap = { ...DEFAULT_STYLES };
  private tooltipFn: TooltipFn | null = null;
  private colorFn: ColorFn | null = null;

  private hoverIndex = -1;
  private hoverEdgeIndex = -1;
  private selectedIndex = -1;
  private highlight: Neighbourhood | null = null;
  private highlightCache = new Map<number, Neighbourhood>();
  private searchQuery = '';
  // NOT `matches`: HTMLElement already owns that name, and shadowing it
  // makes the class stop being an Element as far as the type system cares.
  private searchMatches = new Set<number>();
  private noticeDismissed = '';

  private drag: { id: number; lastX: number; lastY: number; startX: number; startY: number; moved: boolean } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;

  private colorCache = new Map<string, { fill: string; border: string }>();
  private patternCache = new Map<string, CanvasPattern | null>();

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(dagCss);
      shadow.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement('style');
      style.textContent = dagCss;
      shadow.appendChild(style);
    }

    this.canvas = document.createElement('canvas');
    shadow.appendChild(this.canvas);

    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'empty-hint';
    this.emptyEl.hidden = true;
    shadow.appendChild(this.emptyEl);

    this.searchEl = document.createElement('input');
    this.searchEl.className = 'search';
    this.searchEl.type = 'search';
    this.searchEl.placeholder = 'filter nodes';
    this.searchEl.setAttribute('aria-label', 'Filter graph nodes');
    shadow.appendChild(this.searchEl);

    this.noticeEl = document.createElement('button');
    this.noticeEl.className = 'notice';
    this.noticeEl.hidden = true;
    this.noticeEl.title = 'Dismiss';
    shadow.appendChild(this.noticeEl);

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'tooltip';
    shadow.appendChild(this.tooltipEl);

    // Says what the right-click did. Separate from the notice, which carries
    // layout findings a reader dismisses on their own terms.
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.toastEl.hidden = true;
    shadow.appendChild(this.toastEl);

    this.fitBtn = this.makeButton('fit', 'fit-btn', 'Fit the whole graph on screen');
    this.zoomInBtn = this.makeButton('+', 'zoom-in-btn', 'Zoom in');
    this.zoomOutBtn = this.makeButton('−', 'zoom-out-btn', 'Zoom out');
    this.orientBtn = this.makeButton('⇅', 'orient-btn', 'Switch between top-down and left-right');
    this.fsBtn = this.makeButton('⤡', 'fs-btn', 'Fullscreen');
    for (const b of [this.fitBtn, this.zoomInBtn, this.zoomOutBtn, this.orientBtn, this.fsBtn]) shadow.appendChild(b);

    // The announcement channel for screen readers: selection changes are
    // visual by nature, so they are also said out loud.
    this.liveEl = document.createElement('div');
    this.liveEl.setAttribute('aria-live', 'polite');
    this.liveEl.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    shadow.appendChild(this.liveEl);

    this.onFrame = this.onFrame.bind(this);
  }

  private makeButton(text: string, cls: string, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    return b;
  }

  // -- Lifecycle -------------------------------------------------------------------

  connectedCallback(): void {
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    if (!this.hasAttribute('role')) this.setAttribute('role', 'application');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Dependency graph');

    this.readTheme();
    this.resizeBackingStore();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resizeBackingStore());
      this.ro.observe(this);
    }

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.addEventListener('keydown', this.onKeyDown);
    this.searchEl.addEventListener('input', this.onSearchInput);
    this.noticeEl.addEventListener('click', this.onNoticeDismiss);
    this.fitBtn.addEventListener('click', this.onFitClick);
    this.zoomInBtn.addEventListener('click', this.onZoomInClick);
    this.zoomOutBtn.addEventListener('click', this.onZoomOutClick);
    this.orientBtn.addEventListener('click', this.onOrientClick);
    this.fsBtn.addEventListener('click', this.onFsClick);

    this.syncChrome();
    this.invalidate();
  }

  disconnectedCallback(): void {
    this.ro?.disconnect();
    this.ro = null;
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    clearTimeout(this.toastTimer);
    this.removeEventListener('keydown', this.onKeyDown);
    this.searchEl.removeEventListener('input', this.onSearchInput);
    this.noticeEl.removeEventListener('click', this.onNoticeDismiss);
    this.fitBtn.removeEventListener('click', this.onFitClick);
    this.zoomInBtn.removeEventListener('click', this.onZoomInClick);
    this.zoomOutBtn.removeEventListener('click', this.onZoomOutClick);
    this.orientBtn.removeEventListener('click', this.onOrientClick);
    this.fsBtn.removeEventListener('click', this.onFsClick);
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'orientation') {
      const next: DagOrientation = value !== null && value.toUpperCase() === 'LR' ? 'LR' : 'TB';
      if (next !== this.orientationValue) {
        this.orientationValue = next;
        this.layoutStale = true;
        this.viewTouched = false;
      }
    }
    if (name === 'empty-text') this.emptyEl.textContent = value ?? '';
    this.syncChrome();
    this.invalidate();
  }

  // -- Public API ------------------------------------------------------------------

  /** Replace the whole graph. Omitted fields keep their current value. */
  setData(data: DagData): void {
    if (data.nodes !== undefined) this.rawNodes = data.nodes.slice();
    if (data.edges !== undefined) this.rawEdges = data.edges.slice();
    this.layoutStale = true;
    this.selectedIndex = -1;
    this.hoverIndex = -1;
    this.highlight = null;
    this.highlightCache.clear();
    this.invalidate();
  }

  get nodes(): DagNode[] {
    return this.rawNodes.slice();
  }

  set nodes(v: DagNode[]) {
    this.setData({ nodes: v });
  }

  get edges(): DagEdge[] {
    return this.rawEdges.slice();
  }

  set edges(v: DagEdge[]) {
    this.setData({ edges: v });
  }

  get orientation(): DagOrientation {
    return this.orientationValue;
  }

  set orientation(v: DagOrientation) {
    this.setAttribute('orientation', v === 'LR' ? 'LR' : 'TB');
  }

  /** Node/edge `state` -> treatment. Merged over DEFAULT_STYLES. */
  get styles(): DagStyleMap {
    return { ...this.styleMap };
  }

  set styles(map: DagStyleMap | null | undefined) {
    this.styleMap = { ...DEFAULT_STYLES, ...(map ?? {}) };
    this.colorCache.clear();
    this.invalidate();
  }

  get tooltipFor(): TooltipFn | null {
    return this.tooltipFn;
  }

  set tooltipFor(fn: TooltipFn | null | undefined) {
    this.tooltipFn = fn ?? null;
  }

  get colorFor(): ColorFn | null {
    return this.colorFn;
  }

  set colorFor(fn: ColorFn | null | undefined) {
    this.colorFn = fn ?? null;
    this.colorCache.clear();
    this.invalidate();
  }

  /** The selected node's id, or null. */
  get selected(): string | null {
    return this.selectedIndex >= 0 ? this.layout.nodes[this.selectedIndex].node.id : null;
  }

  set selected(id: string | null) {
    this.ensureLayout();
    const i = id === null ? -1 : this.layout.byId.get(id) ?? -1;
    this.select(i, false);
  }

  /** The current pan/zoom. Writing one counts as a deliberate view choice. */
  get viewport(): DagViewport {
    return { ...this.view };
  }

  set viewport(v: DagViewport) {
    this.view = { x: v.x, y: v.y, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale)) };
    this.viewTouched = true;
    this.invalidate();
  }

  /** Layout facts: counts, the critical path, and what could not be honoured. */
  get info(): DagInfo {
    this.ensureLayout();
    return {
      nodeCount: this.layout.nodes.length,
      edgeCount: this.layout.edges.length,
      layerCount: criticalPathLength(this.layout),
      criticalPath: criticalPathLength(this.layout),
      crossings: this.layout.crossings,
      cycles: this.layout.cycleEdges.map((i) => ({
        from: this.layout.edges[i].edge.from,
        to: this.layout.edges[i].edge.to,
      })),
      rejected: this.layout.rejected.map((r) => ({ from: r.edge.from, to: r.edge.to, reason: r.reason })),
    };
  }

  /**
   * The whole drawn state, in both coordinate systems, as a plain object.
   *
   * `world` is what the layout decided. `screen` is where that landed on the
   * canvas in CSS pixels, with the origin at the canvas top-left, so a reader
   * can measure what they are looking at: an empty band between two columns,
   * a node parked off screen, a row that did not line up with the one above.
   * A description of a gap is a guess. These numbers are the gap.
   *
   * `visible` says whether a node's box overlaps the canvas at all, so
   * everything scrolled out of view is countable rather than merely missing.
   */
  get snapshot(): DagSnapshot {
    this.ensureLayout();
    const toScreen = (p: { x: number; y: number }): { x: number; y: number } => {
      const s = worldToScreen(p, this.view);
      return { x: round(s.x), y: round(s.y) };
    };
    return {
      capturedAt: new Date().toISOString(),
      orientation: this.orientation,
      canvas: { width: round(this.cssW), height: round(this.cssH), dpr: this.dpr },
      viewport: { x: round(this.view.x), y: round(this.view.y), scale: this.view.scale },
      bounds: {
        x: round(this.bounds.x),
        y: round(this.bounds.y),
        w: round(this.bounds.w),
        h: round(this.bounds.h),
      },
      info: this.info,
      nodes: this.layout.nodes.map((n) => {
        const s = toScreen({ x: n.x, y: n.y });
        const w = round(n.w * this.view.scale);
        const h = round(n.h * this.view.scale);
        return {
          id: n.node.id,
          label: n.node.label ?? null,
          sublabel: n.node.sublabel ?? null,
          category: n.node.category ?? null,
          state: n.node.state ?? null,
          layer: n.layer,
          world: { x: round(n.x), y: round(n.y), w: round(n.w), h: round(n.h) },
          screen: { x: s.x, y: s.y, w, h },
          visible: s.x + w > 0 && s.y + h > 0 && s.x < this.cssW && s.y < this.cssH,
        };
      }),
      edges: this.layout.edges.map((e) => ({
        from: e.edge.from,
        to: e.edge.to,
        label: e.edge.label ?? null,
        reversed: e.reversed,
        world: e.points.map((p) => ({ x: round(p.x), y: round(p.y) })),
        screen: e.points.map(toScreen),
      })),
    };
  }

  get fullscreen(): boolean {
    return this.hasAttribute('fullscreen');
  }

  set fullscreen(v: boolean) {
    if (v === this.fullscreen) return;
    if (v) this.setAttribute('fullscreen', '');
    else this.removeAttribute('fullscreen');
    // The host box changed size; the observer confirms asynchronously, but
    // resizing now keeps the first frame after the toggle correct.
    this.resizeBackingStore();
    this.dispatchEvent(new CustomEvent('fullscreenchange', { detail: { fullscreen: v } }));
  }

  /**
   * Fit the whole graph on screen, never magnified past 1:1.
   *
   * A graph small enough to fit already is not improved by being blown up:
   * the boxes turn into slabs and the labels into headlines. Fit means
   * "show me everything", and once everything is showing there is nothing
   * left for more zoom to do. Use `focusNode(id, zoom)` to magnify
   * deliberately.
   */
  fit(pad = 32): void {
    this.ensureLayout();
    if (this.layout.nodes.length === 0) return;
    this.view = fitViewport(this.bounds, this.cssW, this.cssH, pad, MIN_SCALE, 1);
    this.viewTouched = true;
    this.invalidate();
  }

  /**
   * Center one node, select it, and light up its neighbourhood. `zoom`
   * defaults to the current zoom: "show me this node" is a request to move,
   * not a request to change how much of the graph is legible.
   */
  focusNode(id: string, zoom?: number): void {
    this.ensureLayout();
    const i = this.layout.byId.get(id);
    if (i === undefined) return;
    const n = this.layout.nodes[i];
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, zoom ?? this.view.scale));
    this.view = {
      scale,
      x: this.cssW / 2 - (n.x + n.w / 2) * scale,
      y: this.cssH / 2 - (n.y + n.h / 2) * scale,
    };
    this.viewTouched = true;
    this.select(i, true);
  }

  /** Fit the graph on the next frame if the consumer has not set a viewport. */
  private fitIfUntouched(): void {
    if (this.viewTouched || this.layout.nodes.length === 0 || this.cssW <= 0) return;
    this.view = fitViewport(this.bounds, this.cssW, this.cssH, 32, MIN_SCALE, 1);
  }

  // -- Layout ----------------------------------------------------------------------

  private ensureLayout(): void {
    if (!this.layoutStale) return;
    this.layoutStale = false;
    const t = this.theme;
    this.layout = layoutDag(this.rawNodes, this.rawEdges, {
      orientation: this.orientationValue,
      gap: t.gap,
      layerGap: t.layerGap,
      // The live font decides the box widths, so a bold or wide face grows
      // the boxes instead of overflowing them.
      sizeOf: (n) =>
        measureNode(n, {
          charW: this.charW,
          lineH: t.fontSize + 4,
          subLineH: t.fontSize + 2,
        }),
    });
    this.bounds = layoutBounds(this.layout);
    this.highlightCache.clear();
    this.applySearch();
    this.updateNotice();
    this.emptyEl.hidden = this.layout.nodes.length > 0;
    if (this.emptyEl.textContent === '') this.emptyEl.textContent = this.getAttribute('empty-text') ?? 'No graph data';
    this.dispatchEvent(new CustomEvent('layoutchange', { detail: this.info }));
  }

  /**
   * The notice strip: what the layout could not honour. It states the
   * finding ONCE and can be dismissed; the same finding never comes back,
   * because a warning that follows you around stops being read.
   */
  private updateNotice(): void {
    const parts: string[] = [];
    const cycles = this.layout.cycleEdges.length;
    const dropped = this.layout.rejected.length;
    const pins = this.layout.ignoredPins.length;
    if (cycles > 0) parts.push(`${cycles} circular ${cycles === 1 ? 'dependency' : 'dependencies'}`);
    if (dropped > 0) parts.push(`${dropped} edge${dropped === 1 ? '' : 's'} not drawn`);
    if (pins > 0) parts.push(`${pins} layer hint${pins === 1 ? '' : 's'} overruled`);
    const text = parts.join(' · ');
    if (text === '' || text === this.noticeDismissed) {
      this.noticeEl.hidden = true;
      return;
    }
    this.noticeEl.textContent = text;
    this.noticeEl.hidden = false;
  }

  private onNoticeDismiss = (): void => {
    this.noticeDismissed = this.noticeEl.textContent ?? '';
    this.noticeEl.hidden = true;
  };

  // -- The state dump --------------------------------------------------------------

  /**
   * Right-click copies the whole drawn state as JSON.
   *
   * A reader who can see something wrong with the picture usually cannot say
   * it in numbers, and the numbers are what anybody else needs to act. This
   * turns "there is a huge gap in the middle" into coordinates.
   *
   * It replaces the browser's own menu, which offers nothing for a canvas.
   * Shift-right-click gets that menu back.
   */
  private onContextMenu = (e: MouseEvent): void => {
    if (e.shiftKey) return;
    e.preventDefault();
    const text = JSON.stringify(this.snapshot, null, '\t');
    void this.copyText(text).then(
      () => {
        const n = this.layout.nodes.length;
        this.toast(`Copied graph state: ${n} node${n === 1 ? '' : 's'}, ${text.length} bytes`);
        this.dispatchEvent(new CustomEvent('snapshotcopy', { detail: { text }, bubbles: true }));
      },
      (err: unknown) => {
        // Never silent. A reader who thinks they copied and pasted nothing
        // reports the wrong problem next.
        this.toast('Could not reach the clipboard. The state is in the console.');
        console.error('dag-view: copying the state failed', err);
        console.log(text);
      },
    );
  };

  /**
   * The clipboard, by whichever route this context allows.
   *
   * Two ways the async API comes to nothing, and they need different
   * handling. A page served over plain http has no `navigator.clipboard` at
   * all, because it is not a secure context. And a page that HAS it can still
   * be refused: the write permission is the user's to withhold, and Chromium
   * denies it outright to a page nobody has interacted with in the way it
   * wants. Only the second was missed here, which left the failure path
   * reachable in an ordinary browser. So the selection route runs after a
   * rejection as well as after an absence.
   */
  private async copyText(text: string): Promise<void> {
    if (navigator.clipboard !== undefined) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall through to the selection route below.
      }
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('the browser refused the copy');
  }

  private toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.hidden = true;
    }, TOAST_MS) as unknown as number;
  }

  // -- Search ----------------------------------------------------------------------

  private onSearchInput = (): void => {
    this.searchQuery = this.searchEl.value.trim().toLowerCase();
    this.applySearch();
    this.invalidate();
  };

  /**
   * Search HIGHLIGHTS, it does not filter. Removing the non-matching nodes
   * would also remove the edges that explain why a match matters, and "what
   * is this connected to" is the reason to look one up in the first place.
   */
  private applySearch(): void {
    this.searchMatches.clear();
    if (this.searchQuery === '') return;
    this.layout.nodes.forEach((n, i) => {
      const hay = `${n.node.id} ${n.node.label ?? ''} ${n.node.sublabel ?? ''}`.toLowerCase();
      if (hay.includes(this.searchQuery)) this.searchMatches.add(i);
    });
  }

  // -- Chrome --------------------------------------------------------------------

  private syncChrome(): void {
    this.searchEl.hidden = this.hasAttribute('no-search');
    const noToolbar = this.hasAttribute('no-toolbar');
    this.fitBtn.hidden = noToolbar;
    this.zoomInBtn.hidden = noToolbar;
    this.zoomOutBtn.hidden = noToolbar;
    this.orientBtn.hidden = noToolbar;
    this.fsBtn.hidden = noToolbar || this.hasAttribute('no-fullscreen-button');
    this.fsBtn.setAttribute('aria-pressed', String(this.fullscreen));
    this.orientBtn.textContent = this.orientationValue === 'TB' ? '⇅' : '⇆';
  }

  private onFitClick = (): void => this.fit();
  private onZoomInClick = (): void => this.zoomBy(ZOOM_STEP);
  private onZoomOutClick = (): void => this.zoomBy(1 / ZOOM_STEP);
  private onFsClick = (): void => {
    this.fullscreen = !this.fullscreen;
    this.syncChrome();
  };

  private onOrientClick = (): void => {
    this.orientation = this.orientationValue === 'TB' ? 'LR' : 'TB';
    this.syncChrome();
  };

  /** Zoom about the center of the viewport, for the buttons and keys. */
  private zoomBy(factor: number): void {
    this.view = zoomViewportAt(this.view, this.cssW / 2, this.cssH / 2, factor);
    this.viewTouched = true;
    this.invalidate();
  }

  // -- Input -----------------------------------------------------------------------

  private localPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.lastInputTs = performance.now();
    const p = this.localPoint(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.drag = null;
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, lastX: p.x, lastY: p.y, startX: p.x, startY: p.y, moved: false };
    this.focus({ preventScroll: true });
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.lastInputTs = performance.now();
    const p = this.localPoint(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0 && d > 0) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.view = zoomViewportAt(this.view, mid.x, mid.y, d / this.pinchDist);
        this.viewTouched = true;
        this.invalidate();
      }
      this.pinchDist = d;
      return;
    }

    if (this.drag !== null && this.drag.id === e.pointerId) {
      const dx = p.x - this.drag.lastX;
      const dy = p.y - this.drag.lastY;
      if (Math.hypot(p.x - this.drag.startX, p.y - this.drag.startY) > DRAG_SLOP) this.drag.moved = true;
      if (this.drag.moved) {
        this.drag.lastX = p.x;
        this.drag.lastY = p.y;
        this.view = clampViewport(panViewport(this.view, dx, dy), this.bounds, this.cssW, this.cssH);
        this.viewTouched = true;
        this.hideTooltip();
        this.invalidate();
      }
      return;
    }

    this.updateHover(p.x, p.y);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.drag === null || this.drag.id !== e.pointerId) return;
    const wasClick = !this.drag.moved;
    const p = this.localPoint(e);
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!wasClick) return;

    const w = screenToWorld(p, this.view);
    const ni = hitTestNodes(this.layout, w.x, w.y);
    if (ni >= 0) {
      this.select(ni, true);
      this.dispatchEvent(
        new CustomEvent('nodeclick', { detail: { node: this.layout.nodes[ni].node, placed: this.layout.nodes[ni] } }),
      );
      return;
    }
    const ei = hitTestEdges(this.layout, w.x, w.y, EDGE_HIT_TOL / this.view.scale);
    if (ei >= 0) {
      this.dispatchEvent(
        new CustomEvent('edgeclick', { detail: { edge: this.layout.edges[ei].edge, placed: this.layout.edges[ei] } }),
      );
      return;
    }
    // A click on empty canvas clears the selection: the way out of a
    // highlight has to be as easy as the way in.
    this.select(-1, true);
  };

  private onPointerLeave = (): void => {
    this.pointers.clear();
    this.hoverIndex = -1;
    this.hoverEdgeIndex = -1;
    this.applyHighlight();
    this.hideTooltip();
    this.invalidate();
  };

  private onDoubleClick = (e: MouseEvent): void => {
    const p = this.localPoint(e);
    const w = screenToWorld(p, this.view);
    const ni = hitTestNodes(this.layout, w.x, w.y);
    if (ni < 0) {
      this.fit();
      return;
    }
    // Zoom to the node AND everything it touches -- on a large graph the
    // useful frame is the neighbourhood, not the box.
    const nb = this.neighbourhoodOf(ni);
    const members = [ni, ...nb.ancestors, ...nb.descendants];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of members) {
      const n = this.layout.nodes[i];
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.w);
      y1 = Math.max(y1, n.y + n.h);
    }
    this.view = fitViewport({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, this.cssW, this.cssH, 40);
    this.viewTouched = true;
    this.select(ni, true);
  };

  /**
   * A PLAIN wheel pans; ctrl/meta + wheel zooms.
   *
   * Zooming on a plain wheel is what most diagram tools do, and inside a
   * page it is the wrong default: the element sits in a document the reader
   * is also scrolling, and swallowing that scroll to zoom a graph they were
   * only passing over is the single most irritating thing an embedded
   * canvas can do. Ctrl+wheel is the browser's own zoom gesture, the
   * buttons and the +/- keys are discoverable, and the page keeps working.
   */
  private onWheel = (e: WheelEvent): void => {
    this.lastInputTs = performance.now();
    const px = normalizeWheel(e.deltaY, e.deltaMode);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const p = this.localPoint(e);
      this.view = zoomViewportAt(this.view, p.x, p.y, zoomFactorForWheel(px));
      this.viewTouched = true;
      this.invalidate();
      return;
    }
    const dx = normalizeWheel(e.deltaX, e.deltaMode);
    // Only claim the gesture when there is somewhere to go in that
    // direction; otherwise it chains to the page, which is what the reader
    // meant by scrolling past a graph.
    const next = clampViewport(panViewport(this.view, -dx, -px), this.bounds, this.cssW, this.cssH);
    if (next.x !== this.view.x || next.y !== this.view.y) {
      e.preventDefault();
      this.view = next;
      this.viewTouched = true;
      this.hideTooltip();
      this.invalidate();
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target === this.searchEl) return;
    this.lastInputTs = performance.now();
    const step = e.shiftKey ? 120 : 40;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        // With a node selected the arrows WALK THE GRAPH; with nothing
        // selected they pan. One key, and which it means is exactly what
        // the reader can see on screen.
        if (this.selectedIndex >= 0) this.walk(e.key);
        else {
          const dx = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;
          const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
          this.view = clampViewport(panViewport(this.view, dx, dy), this.bounds, this.cssW, this.cssH);
          this.viewTouched = true;
          this.invalidate();
        }
        break;
      case '+':
      case '=':
        e.preventDefault();
        this.zoomBy(ZOOM_STEP);
        break;
      case '-':
      case '_':
        e.preventDefault();
        this.zoomBy(1 / ZOOM_STEP);
        break;
      case '0':
        e.preventDefault();
        this.fit();
        break;
      case 'Enter':
        if (this.selectedIndex >= 0) {
          e.preventDefault();
          const n = this.layout.nodes[this.selectedIndex];
          this.dispatchEvent(new CustomEvent('nodeclick', { detail: { node: n.node, placed: n } }));
        }
        break;
      case 'Escape':
        if (this.selectedIndex >= 0 || this.searchQuery !== '') {
          e.preventDefault();
          this.searchEl.value = '';
          this.searchQuery = '';
          this.applySearch();
          this.select(-1, true);
        }
        break;
      case 'Tab':
        // Tab is the browser's, not ours -- trapping focus inside a graph
        // is how a keyboard user gets stuck on a page.
        break;
      default:
        break;
    }
  };

  /**
   * Move the selection along an edge. Up/down (left/right in 'LR') follow
   * the dependency direction; the cross-axis keys move to the next sibling
   * in the same layer, so a wide layer is walkable without leaving it.
   */
  private walk(key: string): void {
    const cur = this.layout.nodes[this.selectedIndex];
    const alongAxis = this.orientationValue === 'TB' ? key === 'ArrowUp' || key === 'ArrowDown' : key === 'ArrowLeft' || key === 'ArrowRight';
    const forward = key === 'ArrowDown' || key === 'ArrowRight';

    if (alongAxis) {
      const candidates = this.layout.edges
        .filter((e) => (forward ? e.from === cur.index : e.to === cur.index))
        .map((e) => (forward ? e.to : e.from));
      if (candidates.length === 0) return;
      // Nearest on the cross axis: the visually adjacent one is the one the
      // reader means, not the first in edge order.
      const center = this.orientationValue === 'TB' ? cur.x + cur.w / 2 : cur.y + cur.h / 2;
      let best = candidates[0];
      let bestD = Infinity;
      for (const c of candidates) {
        const n = this.layout.nodes[c];
        const nc = this.orientationValue === 'TB' ? n.x + n.w / 2 : n.y + n.h / 2;
        const d = Math.abs(nc - center);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      this.selectAndReveal(best);
      return;
    }

    const wantGreater = key === 'ArrowRight' || key === 'ArrowDown';
    const pos = (n: PlacedNode): number => (this.orientationValue === 'TB' ? n.x : n.y);
    const siblings = this.layout.nodes
      .filter((n) => n.layer === cur.layer && n.index !== cur.index)
      .filter((n) => (wantGreater ? pos(n) > pos(cur) : pos(n) < pos(cur)))
      .sort((a, b) => (wantGreater ? pos(a) - pos(b) : pos(b) - pos(a)));
    if (siblings.length > 0) this.selectAndReveal(this.layout.byId.get(siblings[0].node.id) as number);
  }

  /** Select a node and pan it into view if it is off screen. */
  private selectAndReveal(i: number): void {
    this.select(i, true);
    const n = this.layout.nodes[i];
    const s = worldToScreen({ x: n.x + n.w / 2, y: n.y + n.h / 2 }, this.view);
    const m = 60;
    if (s.x < m || s.y < m || s.x > this.cssW - m || s.y > this.cssH - m) {
      this.view = {
        scale: this.view.scale,
        x: this.cssW / 2 - (n.x + n.w / 2) * this.view.scale,
        y: this.cssH / 2 - (n.y + n.h / 2) * this.view.scale,
      };
      this.viewTouched = true;
      this.invalidate();
    }
  }

  private select(i: number, announce: boolean): void {
    if (i === this.selectedIndex) return;
    this.selectedIndex = i;
    this.applyHighlight();
    this.invalidate();
    const node = i >= 0 ? this.layout.nodes[i].node : null;
    if (announce && node !== null) {
      const nb = this.neighbourhoodOf(i);
      this.liveEl.textContent = `${node.label ?? node.id}. ${nb.ancestors.size} dependencies, ${nb.descendants.size} dependents.`;
    } else if (announce) {
      this.liveEl.textContent = 'Selection cleared.';
    }
    this.dispatchEvent(new CustomEvent('selectionchange', { detail: { node } }));
  }

  private updateHover(px: number, py: number): void {
    const w = screenToWorld({ x: px, y: py }, this.view);
    const ni = hitTestNodes(this.layout, w.x, w.y);
    const ei = ni >= 0 ? -1 : hitTestEdges(this.layout, w.x, w.y, EDGE_HIT_TOL / this.view.scale);
    if (ni === this.hoverIndex && ei === this.hoverEdgeIndex) {
      if (ni >= 0 || ei >= 0) this.positionTooltip(px, py);
      return;
    }
    this.hoverIndex = ni;
    this.hoverEdgeIndex = ei;
    this.canvas.style.cursor = ni >= 0 || ei >= 0 ? 'pointer' : 'grab';
    this.applyHighlight();
    this.invalidate();

    const hit: DagHit | null =
      ni >= 0
        ? { type: 'node', node: this.layout.nodes[ni].node, placed: this.layout.nodes[ni] }
        : ei >= 0
          ? { type: 'edge', edge: this.layout.edges[ei].edge, placed: this.layout.edges[ei] }
          : null;
    this.dispatchEvent(new CustomEvent('nodehover', { detail: { hit } }));
    if (hit === null) {
      this.hideTooltip();
      return;
    }
    this.showTooltip(hit, px, py);
  }

  /**
   * The highlight follows the HOVER when there is one and the SELECTION
   * otherwise, so a reader can pin a neighbourhood by clicking and then
   * move the pointer away to read it.
   */
  private applyHighlight(): void {
    const i = this.hoverIndex >= 0 ? this.hoverIndex : this.selectedIndex;
    this.highlight = i >= 0 ? this.neighbourhoodOf(i) : null;
  }

  private neighbourhoodOf(i: number): Neighbourhood {
    const hit = this.highlightCache.get(i);
    if (hit !== undefined) return hit;
    const nb = neighbourhood(this.layout, i);
    // Bounded: a pointer sweeping a large graph would otherwise cache one
    // traversal per node it crossed.
    if (this.highlightCache.size >= HIGHLIGHT_CACHE_MAX) this.highlightCache.clear();
    this.highlightCache.set(i, nb);
    return nb;
  }

  // -- Tooltip -------------------------------------------------------------------

  private showTooltip(hit: DagHit, px: number, py: number): void {
    const custom = this.tooltipFn?.(hit) ?? null;
    if (custom === null && this.tooltipFn !== null) {
      this.hideTooltip();
      return;
    }
    const frag = document.createDocumentFragment();
    const title = document.createElement('div');
    title.className = 'tt-title';
    const rows: TooltipRow[] = [];
    if (custom !== null) {
      title.textContent = custom.title ?? '';
      rows.push(...(custom.rows ?? []));
    } else if (hit.type === 'node') {
      const n = hit.node;
      title.textContent = n.label ?? n.id;
      if (n.sublabel !== undefined) rows.push({ key: '', value: n.sublabel });
      const nb = this.neighbourhoodOf(this.layout.byId.get(n.id) as number);
      rows.push({ key: 'depends on', value: String(nb.ancestors.size) });
      rows.push({ key: 'needed by', value: String(nb.descendants.size) });
      if (n.state !== undefined) rows.push({ key: 'state', value: n.state });
    } else {
      title.textContent = `${hit.edge.from} → ${hit.edge.to}`;
      if (hit.edge.label !== undefined) rows.push({ key: '', value: hit.edge.label });
      if (hit.placed.reversed) rows.push({ key: '', value: 'part of a circular dependency' });
    }
    if (title.textContent !== '') frag.appendChild(title);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'tt-row';
      if (r.key !== '') {
        const k = document.createElement('span');
        k.className = 'tt-k';
        k.textContent = r.key;
        row.appendChild(k);
      }
      const v = document.createElement('span');
      v.className = 'tt-v';
      v.textContent = r.value;
      row.appendChild(v);
      frag.appendChild(row);
    }
    this.tooltipEl.replaceChildren(frag);
    this.tooltipEl.classList.add('visible');
    this.positionTooltip(px, py);
  }

  /** Keep the box inside the host, flipping sides rather than clipping. */
  private positionTooltip(px: number, py: number): void {
    const pad = 12;
    const w = this.tooltipEl.offsetWidth;
    const h = this.tooltipEl.offsetHeight;
    let x = px + pad;
    let y = py + pad;
    if (x + w > this.cssW - 4) x = Math.max(4, px - pad - w);
    if (y + h > this.cssH - 4) y = Math.max(4, py - pad - h);
    this.tooltipEl.style.left = `${Math.round(x)}px`;
    this.tooltipEl.style.top = `${Math.round(y)}px`;
  }

  private hideTooltip(): void {
    this.tooltipEl.classList.remove('visible');
  }

  // -- Sizing / theme --------------------------------------------------------------

  private resizeBackingStore(): void {
    const raw = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const dpr = Math.min(MAX_DPR, raw);
    const bw = Math.max(1, Math.round(this.clientWidth * dpr));
    const bh = Math.max(1, Math.round(this.clientHeight * dpr));
    if (bw === this.canvas.width && bh === this.canvas.height && dpr === this.dpr) return;
    this.canvas.width = bw;
    this.canvas.height = bh;
    this.dpr = dpr;
    this.cssW = bw / dpr;
    this.cssH = bh / dpr;
    this.readTheme();
    this.invalidate();
  }

  /**
   * The 2d context is OPAQUE (alpha: false) on purpose: the graph paints its
   * own background every frame, and an opaque canvas lets the engine use
   * subpixel text antialiasing (alpha canvases get grayscale only) -- a real
   * legibility win at 11px. Consequence: --dag-bg must be an opaque color.
   */
  private ctx2d(): CanvasRenderingContext2D | null {
    return (this.ctx ??= this.canvas.getContext('2d', { alpha: false }));
  }

  private readTheme(): void {
    const cs = getComputedStyle(this);
    const t = this.theme;
    t.bg = readProp(cs, '--dag-bg', THEME_DEFAULTS.bg);
    t.fg = readProp(cs, '--dag-fg', THEME_DEFAULTS.fg);
    t.muted = readProp(cs, '--dag-muted', THEME_DEFAULTS.muted);
    t.grid = readProp(cs, '--dag-grid', THEME_DEFAULTS.grid);
    t.hairline = readProp(cs, '--dag-hairline', THEME_DEFAULTS.hairline);
    t.edge = readProp(cs, '--dag-edge', THEME_DEFAULTS.edge);
    t.accent = readProp(cs, '--dag-accent', THEME_DEFAULTS.accent);
    t.emphasis = readProp(cs, '--dag-emphasis', THEME_DEFAULTS.emphasis);
    t.font = readProp(cs, '--dag-font', THEME_DEFAULTS.font);
    t.fontSize = readNum(cs, '--dag-font-size', THEME_DEFAULTS.fontSize, 6, 24);
    t.nodeRadius = readNum(cs, '--dag-node-radius', THEME_DEFAULTS.nodeRadius, 0, 20);
    t.catLightness = readNum(cs, '--dag-cat-lightness', THEME_DEFAULTS.catLightness, 0.2, 0.95);
    t.catChroma = readNum(cs, '--dag-cat-chroma', THEME_DEFAULTS.catChroma, 0, 0.3);
    t.gap = readNum(cs, '--dag-gap', THEME_DEFAULTS.gap, 4, 200);
    t.layerGap = readNum(cs, '--dag-layer-gap', THEME_DEFAULTS.layerGap, 8, 400);
    this.fontLabel = `${t.fontSize}px ${t.font}`;
    this.fontSub = `${t.fontSize - 1}px ${t.font}`;
    this.labelHalo = labelHaloColor(t.fg);
    this.oklch = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('color', 'oklch(0.6 0.1 120)');
    const ctx = this.ctx2d();
    if (ctx) {
      ctx.font = this.fontLabel;
      const probe = 'abcdefghijklmnop0123456789';
      this.charW = ctx.measureText(probe).width / probe.length || 6.2;
    }
    this.colorCache.clear();
    this.patternCache.clear();
    // Box sizes come from charW and the layer gaps, so a theme change is a
    // layout change, not just a repaint.
    this.layoutStale = true;
  }

  // -- Colors --------------------------------------------------------------------

  private colorsFor(node: DagNode): { fill: string; border: string } {
    const style = node.state !== undefined ? this.styleMap[node.state] : undefined;
    const key = `${node.category ?? node.id}|${node.state ?? ''}`;
    const hit = this.colorCache.get(key);
    if (hit !== undefined) return hit;
    const t = this.theme;
    let fill: string;
    let border: string;
    const override = this.colorFn?.(node) ?? style?.color ?? null;
    if (override !== null) {
      fill = override;
      border = override;
    } else {
      const hue = nodeHue(node);
      const j = categoryJitter(node.category ?? node.id);
      const mode = this.oklch ? 'oklch' : 'hsl';
      const l = clamp(t.catLightness + j.dl, 0.2, 0.95);
      const c = clamp(t.catChroma + j.dc, 0, 0.3);
      fill = categoryColor(hue, { mode, lightness: l, chroma: c });
      border = categoryColor(hue, { mode, lightness: clamp(l + 0.16, 0, 0.96), chroma: c });
    }
    const out = style?.dim === true ? { fill: dimColor(fill), border: dimColor(border) } : { fill, border };
    this.colorCache.set(key, out);
    return out;
  }

  // -- Render loop ---------------------------------------------------------------

  private invalidate(): void {
    this.dirty = true;
    if (this.raf === 0) this.raf = requestAnimationFrame(this.onFrame);
  }

  private onFrame(ts: number): void {
    this.raf = 0;
    // Full rate while the reader is interacting, throttled to ~30fps when
    // they are not: a graph is a static picture most of the time, and
    // repainting one at 120fps for nobody is pure heat.
    const interacting = ts - this.lastInputTs < INTERACT_GRACE_MS;
    if (!interacting && ts - this.lastRenderTs < IDLE_FRAME_MS) {
      this.raf = requestAnimationFrame(this.onFrame);
      return;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.lastRenderTs = ts;
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx2d();
    if (ctx === null) return;
    this.ensureLayout();
    this.fitIfUntouched();

    const t = this.theme;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    if (this.layout.nodes.length === 0) return;

    const view = visibleWorldRect(this.view, this.cssW, this.cssH);
    this.drawGrid(ctx, view);

    // Edges first, so a node always covers the lines that reach it.
    ctx.save();
    ctx.transform(this.view.scale, 0, 0, this.view.scale, this.view.x, this.view.y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const i of visibleEdges(this.layout, view)) this.drawEdge(ctx, i);
    ctx.restore();

    for (const i of visibleNodes(this.layout, view)) this.drawNode(ctx, i);
  }

  /**
   * The background dot grid, drawn in SCREEN space at a pitch that steps by
   * powers of two as you zoom. Without it a pan across empty canvas gives
   * no motion cue at all, and the reader cannot tell a slow drag from a
   * frozen frame.
   */
  private drawGrid(ctx: CanvasRenderingContext2D, view: WorldRect): void {
    if (this.theme.grid === 'none') return;
    let pitch = 40 * this.view.scale;
    while (pitch < 18) pitch *= 2;
    while (pitch > 90) pitch /= 2;
    const ox = ((this.view.x % pitch) + pitch) % pitch;
    const oy = ((this.view.y % pitch) + pitch) % pitch;
    ctx.fillStyle = this.theme.grid;
    for (let x = ox; x < this.cssW; x += pitch) {
      for (let y = oy; y < this.cssH; y += pitch) ctx.fillRect(x, y, 1, 1);
    }
    void view;
  }

  private drawEdge(ctx: CanvasRenderingContext2D, index: number): void {
    const e = this.layout.edges[index];
    const t = this.theme;
    const faded = this.highlight !== null && !this.highlight.edges.has(index);
    const style = e.edge.state !== undefined ? this.styleMap[e.edge.state] : undefined;

    ctx.save();
    ctx.globalAlpha = faded ? FADE_ALPHA : 1;
    ctx.strokeStyle = e.reversed ? t.emphasis : style?.color ?? t.edge;
    ctx.lineWidth = (e.reversed || this.hoverEdgeIndex === index ? 2 : 1.25) / this.view.scale;
    // A cycle edge is dashed as well as colored: color alone is not a
    // signal a colorblind reader can act on.
    if (e.reversed || style?.dashed === true) ctx.setLineDash([6 / this.view.scale, 4 / this.view.scale]);

    ctx.beginPath();
    roundedPolyline(ctx, e.points, 10);
    ctx.stroke();
    ctx.setLineDash([]);

    // The arrowhead carries the direction, so it is drawn at a fixed SCREEN
    // size: it must stay readable at every zoom, which a world-space
    // triangle does not.
    const last = e.points[e.points.length - 1];
    const prev = e.points[e.points.length - 2] ?? last;
    drawArrowhead(ctx, prev, last, 8 / this.view.scale, ctx.strokeStyle as string);
    ctx.restore();
  }

  private drawNode(ctx: CanvasRenderingContext2D, index: number): void {
    const n = this.layout.nodes[index];
    const t = this.theme;
    const s = this.view.scale;
    const style = n.node.state !== undefined ? this.styleMap[n.node.state] : undefined;
    const colors = this.colorsFor(n.node);

    const inHighlight =
      this.highlight === null ||
      index === this.hoverIndex ||
      index === this.selectedIndex ||
      this.highlight.ancestors.has(index) ||
      this.highlight.descendants.has(index);
    const matched = this.searchQuery !== '' && this.searchMatches.has(index);
    const searchFaded = this.searchQuery !== '' && !matched;

    const p = worldToScreen({ x: n.x, y: n.y }, this.view);
    const w = n.w * s;
    const h = n.h * s;

    ctx.save();
    ctx.globalAlpha = !inHighlight || searchFaded ? FADE_ALPHA : 1;

    // Below this zoom a box is a few pixels tall: a plain filled mark reads
    // as "something is here", where a border and clipped text read as mud.
    if (s < LOD_MARK_SCALE) {
      ctx.fillStyle = colors.fill;
      ctx.fillRect(p.x, p.y, Math.max(2, w), Math.max(2, h));
      ctx.restore();
      return;
    }

    const r = Math.min(t.nodeRadius, w / 2, h / 2);
    ctx.beginPath();
    roundRect(ctx, p.x, p.y, w, h, r);

    const pattern = style?.pattern ?? 'solid';
    if (pattern === 'outline') {
      ctx.fillStyle = t.bg;
      ctx.fill();
    } else if (pattern === 'hatch' || pattern === 'stipple') {
      ctx.fillStyle = t.bg;
      ctx.fill();
      const pat = this.patternFor(pattern, colors.fill);
      if (pat !== null) {
        ctx.fillStyle = pat;
        ctx.fill();
      }
    } else {
      ctx.fillStyle = colors.fill;
      ctx.fill();
    }

    ctx.strokeStyle = matched ? t.accent : style?.emphasis === true ? t.emphasis : colors.border;
    ctx.lineWidth = index === this.selectedIndex ? 2.5 : style?.emphasis === true || matched ? 2 : 1;
    if (style?.dashed === true) ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (index === this.selectedIndex) {
      ctx.strokeStyle = t.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      roundRect(ctx, p.x - 3, p.y - 3, w + 6, h + 6, r + 3);
      ctx.stroke();
    } else if (index === this.hoverIndex) {
      ctx.strokeStyle = t.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      roundRect(ctx, p.x - 2, p.y - 2, w + 4, h + 4, r + 2);
      ctx.stroke();
    }

    if (s >= LOD_LABEL_SCALE) this.drawLabels(ctx, n, p.x, p.y, w, h, pattern);
    ctx.restore();
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D,
    n: PlacedNode,
    x: number,
    y: number,
    w: number,
    h: number,
    pattern: DagPattern,
  ): void {
    const t = this.theme;
    const s = this.view.scale;
    const padX = 9 * s;
    const avail = w - padX * 2;
    if (avail <= 8) return;

    const label = n.node.label ?? n.node.id;
    const sub = n.node.sublabel;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // The halo is what makes a label survive a hatched or stippled fill,
    // and a fill in any category hue, without picking a text color per
    // node.
    const paint = (text: string, font: string, px: number, cy: number, color: string): void => {
      ctx.font = font;
      const fitted = fitToWidth(ctx, text, avail);
      if (fitted === '') return;
      // The halo width tracks the GLYPH size. A fixed 3px rim is a rim on a
      // 14px label and a blot that swallows a 6px one, and small is exactly
      // where a label needs the help.
      ctx.lineWidth = Math.max(1.5, px * 0.26);
      ctx.strokeStyle = this.labelHalo;
      ctx.lineJoin = 'round';
      ctx.strokeText(fitted, x + padX, cy);
      ctx.fillStyle = color;
      ctx.fillText(fitted, x + padX, cy);
    };

    const labelPx = t.fontSize * s;
    const subPx = (t.fontSize - 1) * s;
    const labelFont = `${labelPx}px ${t.font}`;
    const subFont = `${subPx}px ${t.font}`;
    void pattern;
    if (sub === undefined || sub === '') {
      paint(label, labelFont, labelPx, y + h / 2, t.fg);
      return;
    }
    paint(label, labelFont, labelPx, y + h * 0.36, t.fg);
    // The sublabel is the FOREGROUND colour at reduced alpha, never
    // --dag-muted. Muted is chosen to sit on the page background; a node is
    // painted in a saturated category hue, and a mid-grey on top of one is
    // simply unreadable. Alpha keeps it secondary without picking a second
    // colour per category.
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * 0.72;
    paint(sub, subFont, subPx, y + h * 0.7, t.fg);
    ctx.globalAlpha = prevAlpha;
  }

  /** A 45-degree hatch or a dot stipple, baked once per (kind, color). */
  private patternFor(kind: 'hatch' | 'stipple', color: string): CanvasPattern | null {
    const key = `${kind}|${color}`;
    if (this.patternCache.has(key)) return this.patternCache.get(key) ?? null;
    const size = 8;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    let pat: CanvasPattern | null = null;
    if (g !== null) {
      g.strokeStyle = color;
      g.fillStyle = color;
      if (kind === 'hatch') {
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-2, size + 2);
        g.lineTo(size + 2, -2);
        g.moveTo(size - 2, size + 2);
        g.lineTo(size + 6, -2);
        g.stroke();
      } else {
        g.beginPath();
        g.arc(2, 2, 1.2, 0, Math.PI * 2);
        g.arc(6, 6, 1.2, 0, Math.PI * 2);
        g.fill();
      }
      pat = this.ctx2d()?.createPattern(c, 'repeat') ?? null;
    }
    this.patternCache.set(key, pat);
    return pat;
  }
}

// -- Drawing helpers -----------------------------------------------------------------

/** A polyline with its corners rounded, appended to the current path. */
/**
 * A coordinate, to two decimals. The snapshot is read by a person, and a
 * layout float carries seventeen digits of noise past the part that matters.
 */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function roundedPolyline(ctx: CanvasRenderingContext2D, pts: readonly { x: number; y: number }[], r: number): void {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    // The radius shrinks to fit the shorter of the two legs, so a tight
    // bend rounds less rather than overshooting into the neighbouring one.
    const r1 = Math.min(r, Math.hypot(cur.x - prev.x, cur.y - prev.y) / 2);
    const r2 = Math.min(r, Math.hypot(next.x - cur.x, next.y - cur.y) / 2);
    const rr = Math.min(r1, r2);
    if (rr <= 0.5) {
      ctx.lineTo(cur.x, cur.y);
      continue;
    }
    ctx.arcTo(cur.x, cur.y, next.x, next.y, rr);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

/** A filled triangle at `to`, pointing along the `from -> to` direction. */
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  color: string,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len;
  const uy = dy / len;
  const bx = to.x - ux * size;
  const by = to.y - uy * size;
  const nx = -uy * size * 0.42;
  const ny = ux * size * 0.42;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(bx + nx, by + ny);
  ctx.lineTo(bx - nx, by - ny);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** A rounded rectangle appended to the current path. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
}

/**
 * Truncate to fit, with an ellipsis. Binary search over a real
 * `measureText` rather than a character-count estimate: a proportional font
 * makes "iiii" and "WWWW" different widths, and an estimate is what puts
 * text through the side of a box.
 */
function fitToWidth(ctx: CanvasRenderingContext2D, text: string, avail: number): string {
  if (avail <= 0) return '';
  if (ctx.measureText(text).width <= avail) return text;
  const ell = '…';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + ell).width <= avail) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? '' : text.slice(0, lo) + ell;
}

/** Wheel deltas in the three deltaModes, normalized to CSS px. */
function normalizeWheel(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 800;
  return delta;
}

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

if (typeof customElements !== 'undefined' && customElements.get('dag-view') === undefined) {
  customElements.define('dag-view', DagViewElement);
}
