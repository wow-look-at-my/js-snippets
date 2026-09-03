// Pure math for the <dag-view> element: graph normalization, cycle
// breaking (reported, never silently dropped), layer assignment, dummy-node
// insertion, crossing-reduction ordering, coordinate assignment, edge
// routing, the pan/zoom viewport transform, culling, hit tests and
// reachability. No DOM or browser APIs -- everything here runs (and is
// tested) under node; ui/dag-view.ts is the canvas-bound half that consumes
// it.
//
// THE LAYOUT IS A LAYERED (Sugiyama) DRAWING. A dependency graph has a
// direction, and the whole point of drawing one is to see that direction:
// every edge must point the same way down the page. A force-directed blob
// cannot promise that, so the pipeline is the classical one --
//
//   normalize -> break cycles -> assign layers -> insert dummies
//     -> order within layers -> assign cross-axis coordinates -> route
//
// -- with each stage a separate exported function over plain data, so each
// one is testable on its own and a consumer can stop after any of them.
//
// DETERMINISM IS A HARD REQUIREMENT. The same nodes and edges must produce
// the same picture on every machine and every reload: a graph that
// reshuffles when you refresh it cannot be compared against what you saw a
// minute ago. Every stage that could tie breaks the tie on the node's index
// in the input, never on iteration order of a Map built elsewhere and never
// on a random source.

import { hashString } from './color.ts';
import { distSqToSegment } from './hit-test.ts';
import type { HitRect } from './hit-test.ts';

// -- Data model ------------------------------------------------------------------

/** One vertex. `id` is the identity used by every edge and every lookup. */
export interface DagNode {
  id: string;
  /** Primary line of text. Falls back to the id when absent. */
  label?: string;
  /** Second line, drawn smaller (a repo name under a PR title, a version). */
  sublabel?: string;
  /** Color family. Nodes sharing a category share a hue (see ./color.ts). */
  category?: string;
  /** Style-map key: picks the fill pattern and border treatment. */
  state?: string;
  /**
   * Pins the node to a layer. Layer assignment still runs, and a pin that
   * would put a node at or before one of its own dependencies is IGNORED
   * rather than honoured -- the edge direction outranks the hint. Read
   * `LayerResult.ignoredPins` to find out that happened.
   */
  layer?: number;
  /** Consumer payload, passed back untouched on every event and callback. */
  meta?: unknown;
}

/**
 * One directed edge, read as "`to` depends on `from`", so `from` is drawn
 * ABOVE `to` (or left of it in 'LR'). This is the direction a dependency
 * graph is usually spoken in: the thing you need comes first.
 */
export interface DagEdge {
  from: string;
  to: string;
  label?: string;
  /** Style-map key for the line treatment. */
  state?: string;
  meta?: unknown;
}

/** Which way the layers stack. */
export type DagOrientation = 'TB' | 'LR';

// -- Normalization -----------------------------------------------------------------

/** An input edge the graph could not use, and the reason. */
export interface RejectedEdge {
  edge: DagEdge;
  reason: 'unknown-from' | 'unknown-to' | 'self-loop' | 'duplicate';
}

/** The validated graph: dense indices, adjacency, and what was thrown out. */
export interface DagGraph {
  nodes: readonly DagNode[];
  /** Every accepted edge, as index pairs into `nodes`. */
  edges: readonly { from: number; to: number; edge: DagEdge }[];
  /** id -> index. */
  index: ReadonlyMap<string, number>;
  /** Per node, the indices it points AT (its dependents). */
  out: readonly (readonly number[])[];
  /** Per node, the indices pointing at IT (its dependencies). */
  in: readonly (readonly number[])[];
  /**
   * Input edges that are not in the graph. NEVER empty-and-forgotten: the
   * element surfaces the count, because an edge that vanishes without a
   * word is a graph that quietly lies about what depends on what.
   */
  rejected: readonly RejectedEdge[];
}

/**
 * Validate and index the input. A duplicate edge (same from/to, whatever
 * its label) is kept once -- two lines between the same pair say nothing a
 * reader can act on -- and a node id that repeats keeps its FIRST
 * occurrence, so an id is a stable identity for the whole render.
 */
export function buildGraph(nodes: readonly DagNode[], edges: readonly DagEdge[]): DagGraph {
  const index = new Map<string, number>();
  const kept: DagNode[] = [];
  for (const n of nodes) {
    if (index.has(n.id)) continue;
    index.set(n.id, kept.length);
    kept.push(n);
  }
  const out: number[][] = kept.map(() => []);
  const inc: number[][] = kept.map(() => []);
  const accepted: { from: number; to: number; edge: DagEdge }[] = [];
  const rejected: RejectedEdge[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    const f = index.get(e.from);
    const t = index.get(e.to);
    if (f === undefined) {
      rejected.push({ edge: e, reason: 'unknown-from' });
      continue;
    }
    if (t === undefined) {
      rejected.push({ edge: e, reason: 'unknown-to' });
      continue;
    }
    if (f === t) {
      rejected.push({ edge: e, reason: 'self-loop' });
      continue;
    }
    const key = `${f}>${t}`;
    if (seen.has(key)) {
      rejected.push({ edge: e, reason: 'duplicate' });
      continue;
    }
    seen.add(key);
    out[f].push(t);
    inc[t].push(f);
    accepted.push({ from: f, to: t, edge: e });
  }
  return { nodes: kept, edges: accepted, index, out, in: inc, rejected };
}

// -- Cycle breaking ------------------------------------------------------------------

/** Which accepted edges were reversed to make the graph acyclic. */
export interface CycleResult {
  /** Indices into `graph.edges` of the edges the layout reversed. */
  reversed: readonly number[];
  /** Adjacency with those edges flipped -- acyclic by construction. */
  out: readonly (readonly number[])[];
  in: readonly (readonly number[])[];
}

/**
 * Reverse the minimum-ish set of edges that makes the graph acyclic, by
 * depth-first search from every node in input order: an edge back to a node
 * still on the stack closes a cycle, so that edge is the one reversed.
 *
 * The reversed set is RETURNED, not swallowed. A circular dependency is the
 * single most important thing a dependency graph can tell you, and a layout
 * that quietly straightened it out would be hiding exactly the fact the
 * reader opened the graph to find. `<dag-view>` draws these edges in the
 * emphasis color with the arrow still pointing the true way.
 */
export function breakCycles(graph: DagGraph): CycleResult {
  const n = graph.nodes.length;
  const reversed: number[] = [];
  const reversedSet = new Set<number>();
  // Edge index by (from, to) so the DFS can name the edge it is cutting.
  const edgeAt = new Map<string, number>();
  graph.edges.forEach((e, i) => edgeAt.set(`${e.from}>${e.to}`, i));

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const mark = new Uint8Array(n);
  // Explicit stack: a deep chain of dependencies is a perfectly ordinary
  // graph, and recursion would blow up on one.
  for (let root = 0; root < n; root++) {
    if (mark[root] !== WHITE) continue;
    const stack: { node: number; next: number }[] = [{ node: root, next: 0 }];
    mark[root] = GREY;
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const succ = graph.out[top.node];
      if (top.next >= succ.length) {
        mark[top.node] = BLACK;
        stack.pop();
        continue;
      }
      const next = succ[top.next++];
      if (mark[next] === GREY) {
        const ei = edgeAt.get(`${top.node}>${next}`);
        if (ei !== undefined && !reversedSet.has(ei)) {
          reversedSet.add(ei);
          reversed.push(ei);
        }
        continue;
      }
      if (mark[next] === BLACK) continue;
      mark[next] = GREY;
      stack.push({ node: next, next: 0 });
    }
  }

  const out: number[][] = graph.nodes.map(() => []);
  const inc: number[][] = graph.nodes.map(() => []);
  graph.edges.forEach((e, i) => {
    const [f, t] = reversedSet.has(i) ? [e.to, e.from] : [e.from, e.to];
    out[f].push(t);
    inc[t].push(f);
  });
  return { reversed, out, in: inc };
}

// -- Layer assignment ------------------------------------------------------------------

/** Per-node layer plus the pins the edge directions overruled. */
export interface LayerResult {
  /** Layer of each node, 0-based, 0 = no dependencies. */
  layers: readonly number[];
  /** Highest layer index in use. */
  maxLayer: number;
  /** Ids whose `layer` hint was dropped because an edge contradicted it. */
  ignoredPins: readonly string[];
}

/** Options for assignLayers. */
export interface LayerOptions {
  /**
   * 'sources' puts every node as EARLY as its dependencies allow (the
   * default: a node sits directly under the last thing it needs).
   * 'sinks' pushes every node as LATE as its dependents allow, which
   * bottom-aligns the leaves and reads better when the interesting nodes
   * are the ones nothing depends on yet.
   */
  align?: 'sources' | 'sinks';
}

/**
 * Longest-path layering over the acyclic adjacency: a node's layer is one
 * past the deepest of its dependencies, so no edge ever points backwards or
 * stays inside one layer.
 *
 * A node's `layer` hint can only push it DOWN, never up past a dependency.
 * The hint is a presentation preference; the edge is a fact.
 */
export function assignLayers(graph: DagGraph, acyclic: CycleResult, opts: LayerOptions = {}): LayerResult {
  const n = graph.nodes.length;
  const layers = new Array<number>(n).fill(0);
  const ignoredPins: string[] = [];
  const order = topoOrder(acyclic.out, n);
  for (const v of order) {
    let base = 0;
    for (const dep of acyclic.in[v]) base = Math.max(base, layers[dep] + 1);
    const pin = graph.nodes[v].layer;
    if (pin !== undefined && Number.isFinite(pin)) {
      const wanted = Math.max(0, Math.floor(pin));
      if (wanted >= base) base = wanted;
      else ignoredPins.push(graph.nodes[v].id);
    }
    layers[v] = base;
  }

  let maxLayer = 0;
  for (const l of layers) maxLayer = Math.max(maxLayer, l);

  if (opts.align === 'sinks') {
    // Walk the topological order backwards and pull each node down to just
    // above its earliest dependent. A node with no dependents lands on the
    // last layer, which is what bottom-aligning means.
    for (let i = order.length - 1; i >= 0; i--) {
      const v = order[i];
      if (graph.nodes[v].layer !== undefined) continue;
      let limit = maxLayer;
      for (const dependent of acyclic.out[v]) limit = Math.min(limit, layers[dependent] - 1);
      layers[v] = Math.max(layers[v], limit);
    }
  }

  return { layers, maxLayer, ignoredPins };
}

/**
 * Kahn topological order over an adjacency list, ties broken by node index
 * so the result is the same on every run. A graph with a cycle left in it
 * would strand nodes; they are appended in index order rather than dropped,
 * because losing a node is never an acceptable way to report a cycle.
 */
export function topoOrder(out: readonly (readonly number[])[], n: number): number[] {
  const indeg = new Int32Array(n);
  for (let v = 0; v < n; v++) for (const w of out[v]) indeg[w]++;
  // A binary heap would be faster; at DAG sizes a person can read, the
  // sorted-array frontier is simpler and its determinism is obvious.
  const frontier: number[] = [];
  for (let v = 0; v < n; v++) if (indeg[v] === 0) frontier.push(v);
  const order: number[] = [];
  const done = new Uint8Array(n);
  while (frontier.length > 0) {
    frontier.sort((a, b) => a - b);
    const v = frontier.shift() as number;
    order.push(v);
    done[v] = 1;
    for (const w of out[v]) {
      if (--indeg[w] === 0) frontier.push(w);
    }
  }
  for (let v = 0; v < n; v++) if (!done[v]) order.push(v);
  return order;
}

// -- Dummy nodes -------------------------------------------------------------------

/**
 * A slot in a layer: either a real node (`node` is its index) or a bend
 * point standing in for one long edge crossing this layer.
 */
export interface LayerSlot {
  /** Index into graph.nodes, or -1 for a dummy. */
  node: number;
  /** Index into graph.edges for a dummy, -1 for a real node. */
  edge: number;
  layer: number;
}

/** Layers with their long edges broken into per-layer bend points. */
export interface ProperLayering {
  /** Slots per layer, in the order they will be drawn across the layer. */
  layers: LayerSlot[][];
  /** Successors one layer down, keyed and valued by slot IDENTITY. */
  succ: Map<string, string[]>;
  /** Predecessors one layer up, likewise by identity. */
  pred: Map<string, string[]>;
  /** Per edge index, its bend points' identities, source to target. */
  chains: Map<number, string[]>;
}

/**
 * A slot's identity: stable under any reordering of its layer.
 *
 * The obvious key for a slot is its position, `${layer}:${index}` — and
 * that key is wrong, because reordering a layer is exactly what the next
 * two stages do. Every adjacency here is keyed on WHAT a slot is (which
 * node, or which edge crossing which layer), never on where it currently
 * sits, so the ordering pass can permute freely and the graph structure
 * still resolves.
 */
export function slotIdentity(s: LayerSlot): string {
  return s.node >= 0 ? `n${s.node}` : `d${s.edge}@${s.layer}`;
}

/**
 * Split every edge that spans more than one layer into a chain of
 * single-layer segments through dummy slots.
 *
 * This is what makes long edges behave. Without it, an edge from layer 0 to
 * layer 6 passes straight through five layers, crossing whatever happens to
 * be there and counting for nothing in the crossing-reduction pass -- so
 * the ordering step would optimize a picture nobody is looking at. With the
 * dummies, a long edge occupies real width in every layer it crosses, gets
 * ordered like anything else, and comes out as a routed polyline instead of
 * a chord across the drawing.
 */
export function insertDummies(graph: DagGraph, acyclic: CycleResult, layout: LayerResult): ProperLayering {
  const layers: LayerSlot[][] = [];
  for (let l = 0; l <= layout.maxLayer; l++) layers.push([]);
  graph.nodes.forEach((_, v) => {
    layers[layout.layers[v]].push({ node: v, edge: -1, layer: layout.layers[v] });
  });

  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();
  const chains = new Map<number, string[]>();
  const link = (a: string, b: string): void => {
    const o = succ.get(a);
    if (o) o.push(b);
    else succ.set(a, [b]);
    const i = pred.get(b);
    if (i) i.push(a);
    else pred.set(b, [a]);
  };

  const reversedSet = new Set(acyclic.reversed);
  graph.edges.forEach((e, ei) => {
    const [f, t] = reversedSet.has(ei) ? [e.to, e.from] : [e.from, e.to];
    const lf = layout.layers[f];
    const lt = layout.layers[t];
    let prev = `n${f}`;
    const chain: string[] = [];
    for (let l = lf + 1; l < lt; l++) {
      const slot: LayerSlot = { node: -1, edge: ei, layer: l };
      layers[l].push(slot);
      const id = slotIdentity(slot);
      chain.push(id);
      link(prev, id);
      prev = id;
    }
    link(prev, `n${t}`);
    chains.set(ei, chain);
  });

  return { layers, succ, pred, chains };
}

// -- Ordering (crossing reduction) --------------------------------------------------

/** Sweeps of the median heuristic run before the transpose pass gives up. */
export const ORDER_SWEEPS = 8;

/**
 * Reorder the slots inside each layer to reduce edge crossings: the
 * weighted-median heuristic, swept down and up alternately, with an
 * adjacent-transpose pass after each sweep that swaps neighbours whenever
 * the swap removes crossings.
 *
 * Crossing minimization is NP-hard, so this is a heuristic and it is
 * supposed to be. What it must be is monotone and deterministic: the best
 * ordering seen so far is kept, a sweep that makes things worse is
 * discarded, and every tie breaks on the slot's current position. Mutates
 * `proper.layers` in place and returns the crossing count it settled on.
 */
export function orderLayers(proper: ProperLayering, sweeps = ORDER_SWEEPS): number {
  const { layers, succ, pred } = proper;
  let best = layers.map((l) => l.slice());
  let bestCrossings = countCrossings(proper);

  // Zero crossings is NOT a reason to skip the sweeps. insertDummies
  // appends every bend point to the END of its layer, so a long edge in an
  // already-planar graph would keep a column parked off to one side of the
  // drawing, dragging the whole thing's bounding box out with it. The
  // sweeps are what pull those bend points in under the edge they belong
  // to, and they cost nothing at the sizes a person can read.

  const positionsIn = (layer: number): Map<string, number> => {
    const m = new Map<string, number>();
    layers[layer].forEach((s, i) => m.set(slotIdentity(s), i));
    return m;
  };

  for (let s = 0; s < sweeps; s++) {
    const down = s % 2 === 0;
    const range = down
      ? Array.from({ length: layers.length - 1 }, (_, i) => i + 1)
      : Array.from({ length: layers.length - 1 }, (_, i) => layers.length - 2 - i);
    for (const l of range) {
      const fixedPos = positionsIn(down ? l - 1 : l + 1);
      const adj = down ? pred : succ;
      // The median of a slot's neighbours in the fixed layer. -1 means "no
      // neighbours there": those slots keep their current position rather
      // than piling up at one end of the layer.
      const withIdx = layers[l].map((slot, i) => {
        const ps = (adj.get(slotIdentity(slot)) ?? [])
          .map((k) => fixedPos.get(k))
          .filter((p): p is number => p !== undefined)
          .sort((a, b) => a - b);
        if (ps.length === 0) return { slot, i, m: -1 };
        const mid = ps.length >> 1;
        return { slot, i, m: ps.length % 2 === 1 ? ps[mid] : (ps[mid - 1] + ps[mid]) / 2 };
      });
      withIdx.sort((a, b) => {
        if (a.m < 0 || b.m < 0) return a.i - b.i;
        return a.m !== b.m ? a.m - b.m : a.i - b.i;
      });
      layers[l] = withIdx.map((w) => w.slot);
    }
    transpose(proper);
    const c = countCrossings(proper);
    // A TIE is accepted, not just an improvement. The median sweep's other
    // job is alignment, and refusing an arrangement that crosses no more
    // than the last one throws that away -- which is exactly what left a
    // planar graph's bend points where they were first appended.
    if (c <= bestCrossings) {
      bestCrossings = c;
      best = layers.map((x) => x.slice());
    }
  }
  for (let l = 0; l < layers.length; l++) layers[l] = best[l];
  return bestCrossings;
}

/**
 * Adjacent-exchange pass: swap neighbouring slots whenever the swap strictly
 * reduces the crossings between this layer and its two neighbours. Runs
 * until a full pass changes nothing, or the guard trips -- a heuristic that
 * cannot terminate would hang the layout, and the guard is what makes that
 * impossible rather than unlikely.
 */
function transpose(proper: ProperLayering): void {
  let improved = true;
  let guard = 0;
  while (improved && guard++ < TRANSPOSE_PASS_CAP) {
    improved = false;
    for (let l = 0; l < proper.layers.length; l++) {
      const row = proper.layers[l];
      for (let i = 0; i + 1 < row.length; i++) {
        const before = localCrossings(proper, l);
        const tmp = row[i];
        row[i] = row[i + 1];
        row[i + 1] = tmp;
        if (localCrossings(proper, l) < before) {
          improved = true;
        } else {
          row[i + 1] = row[i];
          row[i] = tmp;
        }
      }
    }
  }
}

/** Full transpose passes before the exchange loop stops (see transpose). */
const TRANSPOSE_PASS_CAP = 64;

/** Crossings between `layer` and its immediate neighbours only. */
function localCrossings(proper: ProperLayering, layer: number): number {
  let c = 0;
  if (layer > 0) c += crossingsBetween(proper, layer - 1);
  if (layer + 1 < proper.layers.length) c += crossingsBetween(proper, layer);
  return c;
}

/** Total crossings across every adjacent layer pair. */
export function countCrossings(proper: ProperLayering): number {
  let c = 0;
  for (let l = 0; l + 1 < proper.layers.length; l++) c += crossingsBetween(proper, l);
  return c;
}

/**
 * Crossings between layer `l` and `l + 1`, counted by the pair rule: two
 * edges cross exactly when their endpoints are in opposite order on the two
 * layers. O(E^2) in the edges between one pair of layers, which at the sizes
 * a person can actually read is nothing, and it is obviously correct --
 * worth more here than the accumulator-tree version.
 */
export function crossingsBetween(proper: ProperLayering, l: number): number {
  const upper = proper.layers[l];
  const lower = proper.layers[l + 1];
  const lowerPos = new Map<string, number>();
  lower.forEach((s, i) => lowerPos.set(slotIdentity(s), i));
  const pairs: { u: number; v: number }[] = [];
  upper.forEach((s, i) => {
    for (const k of proper.succ.get(slotIdentity(s)) ?? []) {
      const v = lowerPos.get(k);
      if (v !== undefined) pairs.push({ u: i, v });
    }
  });
  let c = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const a = pairs[i];
      const b = pairs[j];
      if ((a.u - b.u) * (a.v - b.v) < 0) c++;
    }
  }
  return c;
}

// -- Coordinates ---------------------------------------------------------------------

/** Box size of a node in layout units (CSS px before the viewport scale). */
export interface NodeSize {
  w: number;
  h: number;
}

/** Spacing knobs for assignCoordinates. */
export interface CoordOptions {
  /** Gap between adjacent boxes within a layer. */
  gap?: number;
  /** Gap between layers, measured between facing edges. */
  layerGap?: number;
  /** Cross-axis width reserved for a dummy (an edge passing through). */
  dummyWidth?: number;
  /** Straightening passes. More is straighter and slower. */
  passes?: number;
}

export const DEFAULT_GAP = 24;
export const DEFAULT_LAYER_GAP = 56;
export const DEFAULT_DUMMY_WIDTH = 12;
export const DEFAULT_COORD_PASSES = 6;

/** A laid-out slot: its cross-axis center and its extent along the layer axis. */
export interface SlotPlacement {
  /** Center on the cross axis (x in 'TB', y in 'LR'). */
  c: number;
  /** Start on the layer axis (y in 'TB', x in 'LR'). */
  l: number;
  /** Size on the cross axis. */
  cSize: number;
  /** Size on the layer axis. */
  lSize: number;
}

/** Every slot placed, plus the drawing's own extent. */
export interface CoordResult {
  /** Placement per layer, parallel to `proper.layers`. */
  placements: SlotPlacement[][];
  /** Total cross-axis extent of the drawing. */
  crossExtent: number;
  /** Total layer-axis extent of the drawing. */
  layerExtent: number;
}

/**
 * Give every slot a cross-axis center.
 *
 * The first pass packs each layer left to right at the minimum gap, which
 * is correct and ugly: a chain of single nodes comes out as a staircase.
 * The straightening passes then repeatedly pull each slot toward the median
 * of its neighbours in the adjacent layer and re-separate any overlap the
 * pull created, alternating direction. That is the priority method rather
 * than full Brandes-Kopf, and the property it buys is the one that matters
 * to a reader: a straight dependency chain draws as a straight line, and a
 * long edge's bend points line up with each other instead of zig-zagging.
 *
 * The separation step runs AFTER every pull, never as a final tidy-up: a
 * layout that resolves overlaps once at the end can still hand back
 * overlapping boxes, and two boxes drawn on top of each other is worse than
 * any amount of crookedness.
 */
export function assignCoordinates(
  proper: ProperLayering,
  sizes: readonly NodeSize[],
  opts: CoordOptions = {},
): CoordResult {
  const gap = opts.gap ?? DEFAULT_GAP;
  const layerGap = opts.layerGap ?? DEFAULT_LAYER_GAP;
  const dummyW = opts.dummyWidth ?? DEFAULT_DUMMY_WIDTH;
  const passes = opts.passes ?? DEFAULT_COORD_PASSES;
  const rows = proper.layers;

  const cSizeOf = (s: LayerSlot): number => (s.node >= 0 ? sizes[s.node].w : dummyW);
  const lSizeOf = (s: LayerSlot): number => (s.node >= 0 ? sizes[s.node].h : 0);

  // Layer-axis offsets: each layer is as tall as its tallest box.
  const layerStart: number[] = [];
  const layerThick: number[] = [];
  let cursor = 0;
  for (const row of rows) {
    let thick = 0;
    for (const s of row) thick = Math.max(thick, lSizeOf(s));
    layerStart.push(cursor);
    layerThick.push(thick);
    cursor += thick + layerGap;
  }
  const layerExtent = Math.max(0, cursor - layerGap);

  // Initial packing.
  const centers: number[][] = rows.map((row) => {
    const out: number[] = [];
    let x = 0;
    for (const s of row) {
      const w = cSizeOf(s);
      out.push(x + w / 2);
      x += w + gap;
    }
    return out;
  });

  const neighbourMedian = (l: number, i: number, up: boolean): number | null => {
    const s = rows[l][i];
    const keys = (up ? proper.pred : proper.succ).get(slotIdentity(s)) ?? [];
    if (keys.length === 0) return null;
    const target = up ? l - 1 : l + 1;
    if (target < 0 || target >= rows.length) return null;
    const posByIdentity = new Map<string, number>();
    rows[target].forEach((t, ti) => posByIdentity.set(slotIdentity(t), ti));
    const cs = keys
      .map((k) => posByIdentity.get(k))
      .filter((p): p is number => p !== undefined)
      .map((p) => centers[target][p])
      .sort((a, b) => a - b);
    if (cs.length === 0) return null;
    const m = cs.length >> 1;
    return cs.length % 2 === 1 ? cs[m] : (cs[m - 1] + cs[m]) / 2;
  };

  const separate = (l: number): void => {
    const row = rows[l];
    // Left to right, then right to left: one direction alone drifts the
    // whole layer toward the end it swept from.
    for (let i = 1; i < row.length; i++) {
      const minC = centers[l][i - 1] + cSizeOf(row[i - 1]) / 2 + gap + cSizeOf(row[i]) / 2;
      if (centers[l][i] < minC) centers[l][i] = minC;
    }
    for (let i = row.length - 2; i >= 0; i--) {
      const maxC = centers[l][i + 1] - cSizeOf(row[i + 1]) / 2 - gap - cSizeOf(row[i]) / 2;
      if (centers[l][i] > maxC) centers[l][i] = maxC;
    }
  };

  for (let p = 0; p < passes; p++) {
    const up = p % 2 === 0;
    const order = up
      ? Array.from({ length: rows.length }, (_, i) => i)
      : Array.from({ length: rows.length }, (_, i) => rows.length - 1 - i);
    for (const l of order) {
      for (let i = 0; i < rows[l].length; i++) {
        const m = neighbourMedian(l, i, up);
        if (m !== null) centers[l][i] = m;
      }
      separate(l);
    }
  }

  // Normalize so the drawing starts at 0 on the cross axis.
  let minC = Infinity;
  let maxC = -Infinity;
  rows.forEach((row, l) => {
    row.forEach((s, i) => {
      minC = Math.min(minC, centers[l][i] - cSizeOf(s) / 2);
      maxC = Math.max(maxC, centers[l][i] + cSizeOf(s) / 2);
    });
  });
  if (!Number.isFinite(minC)) {
    minC = 0;
    maxC = 0;
  }

  const placements: SlotPlacement[][] = rows.map((row, l) =>
    row.map((s, i) => ({
      c: centers[l][i] - minC,
      // A dummy has no thickness, so it sits on the layer's mid-line and the
      // routed polyline bends there rather than at the layer's top edge.
      l: s.node >= 0 ? layerStart[l] : layerStart[l] + layerThick[l] / 2,
      cSize: cSizeOf(s),
      lSize: lSizeOf(s),
    })),
  );

  return { placements, crossExtent: Math.max(0, maxC - minC), layerExtent };
}

// -- The whole layout ------------------------------------------------------------------

/** A placed node, in layout coordinates (CSS px, pre-viewport). */
export interface PlacedNode {
  node: DagNode;
  /** Index into the input node list. */
  index: number;
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A routed edge, in the same coordinates. */
export interface PlacedEdge {
  edge: DagEdge;
  /** Index into graph.edges. */
  index: number;
  from: number;
  to: number;
  /** Source to target, including the bend points. At least two points. */
  points: readonly { x: number; y: number }[];
  /**
   * True when cycle-breaking reversed this edge. The line is drawn from the
   * lower node UP to the higher one and the component marks it, because a
   * circular dependency is a finding, not a rendering detail.
   */
  reversed: boolean;
}

/** Everything the renderer needs, and nothing it has to recompute per frame. */
export interface DagLayout {
  nodes: readonly PlacedNode[];
  edges: readonly PlacedEdge[];
  /** Node id -> index into `nodes`. */
  byId: ReadonlyMap<string, number>;
  width: number;
  height: number;
  orientation: DagOrientation;
  /** Crossings the ordering pass settled on -- a layout-quality readout. */
  crossings: number;
  /** Edges reversed to break a cycle, as indices into `edges`. */
  cycleEdges: readonly number[];
  /** Input edges not drawn at all, with the reason (see DagGraph.rejected). */
  rejected: readonly RejectedEdge[];
  /** Ids whose `layer` hint an edge overruled. */
  ignoredPins: readonly string[];
}

/** Options for layoutDag. */
export interface DagLayoutOptions extends CoordOptions, LayerOptions {
  orientation?: DagOrientation;
  /** Measures a node. Defaults to measureNode with its own defaults. */
  sizeOf?: (node: DagNode, index: number) => NodeSize;
  /** Ordering sweeps (see ORDER_SWEEPS). */
  sweeps?: number;
}

/**
 * The whole pipeline, from raw nodes and edges to placed boxes and routed
 * polylines. Every intermediate stage is exported above; this is the
 * ordinary path.
 */
export function layoutDag(
  nodes: readonly DagNode[],
  edges: readonly DagEdge[],
  opts: DagLayoutOptions = {},
): DagLayout {
  const orientation = opts.orientation ?? 'TB';
  const graph = buildGraph(nodes, edges);
  const acyclic = breakCycles(graph);
  const layered = assignLayers(graph, acyclic, opts);
  const proper = insertDummies(graph, acyclic, layered);
  const crossings = orderLayers(proper, opts.sweeps);
  const sizeOf = opts.sizeOf ?? ((n: DagNode): NodeSize => measureNode(n));
  const sizes = graph.nodes.map((n, i) => sizeOf(n, i));
  // In 'LR' the layer axis is x and the cross axis is y, so the two
  // dimensions of a box swap before the layout sees them and swap back
  // after. One layout implementation, two orientations.
  const layoutSizes: NodeSize[] = orientation === 'TB' ? sizes : sizes.map((s) => ({ w: s.h, h: s.w }));
  const coords = assignCoordinates(proper, layoutSizes, opts);

  const placed: PlacedNode[] = new Array(graph.nodes.length);
  const slotPos = new Map<string, { c: number; l: number; cSize: number; lSize: number }>();
  proper.layers.forEach((row, l) => {
    row.forEach((s, i) => {
      const p = coords.placements[l][i];
      slotPos.set(slotIdentity(s), p);
      if (s.node < 0) return;
      const size = sizes[s.node];
      placed[s.node] = {
        node: graph.nodes[s.node],
        index: s.node,
        layer: l,
        x: orientation === 'TB' ? p.c - size.w / 2 : p.l,
        y: orientation === 'TB' ? p.l : p.c - size.h / 2,
        w: size.w,
        h: size.h,
      };
    });
  });

  const byId = new Map<string, number>();
  placed.forEach((p, i) => byId.set(p.node.id, i));

  const reversedSet = new Set(acyclic.reversed);
  const cycleEdges: number[] = [];
  const routed: PlacedEdge[] = graph.edges.map((e, ei) => {
    const reversed = reversedSet.has(ei);
    if (reversed) cycleEdges.push(ei);
    // The chain was built along the ACYCLIC direction. A reversed edge is
    // therefore routed tail-first and flipped back here, so `points` always
    // runs from the edge's real source to its real target and an arrowhead
    // at the last point always means what it says.
    const chain = (proper.chains.get(ei) ?? []).map((id) => slotPos.get(id));
    const bends = chain
      .filter((p): p is SlotPlacement => p !== undefined)
      .map((p) => (orientation === 'TB' ? { x: p.c, y: p.l } : { x: p.l, y: p.c }));
    const a = placed[e.from];
    const b = placed[e.to];
    const start = anchorPoint(a, orientation, reversed ? 'in' : 'out');
    const end = anchorPoint(b, orientation, reversed ? 'out' : 'in');
    const mids = reversed ? bends.slice().reverse() : bends;
    return { edge: e.edge, index: ei, from: e.from, to: e.to, points: [start, ...mids, end], reversed };
  });

  return {
    nodes: placed,
    edges: routed,
    byId,
    width: orientation === 'TB' ? coords.crossExtent : coords.layerExtent,
    height: orientation === 'TB' ? coords.layerExtent : coords.crossExtent,
    orientation,
    crossings,
    cycleEdges,
    rejected: graph.rejected,
    ignoredPins: layered.ignoredPins,
  };
}

/**
 * Where an edge meets a box: the middle of the face pointing along the
 * layer axis. Attaching to the face rather than the center is what stops
 * every arrowhead from disappearing under the box it points at.
 */
export function anchorPoint(n: PlacedNode, orientation: DagOrientation, side: 'in' | 'out'): { x: number; y: number } {
  if (orientation === 'TB') {
    return { x: n.x + n.w / 2, y: side === 'out' ? n.y + n.h : n.y };
  }
  return { x: side === 'out' ? n.x + n.w : n.x, y: n.y + n.h / 2 };
}

// -- Node measurement ------------------------------------------------------------------

/** Options for measureNode. */
export interface MeasureOptions {
  /** Average glyph advance for the label font, CSS px. */
  charW?: number;
  /** Horizontal padding inside the box, per side. */
  padX?: number;
  /** Vertical padding inside the box, per side. */
  padY?: number;
  /** Label line height. */
  lineH?: number;
  /** Sublabel line height (0 when the node has no sublabel). */
  subLineH?: number;
  /** Clamp on the box width, so one long title cannot set the whole layout. */
  maxW?: number;
  /** Floor on the box width, so a one-character node is still a target. */
  minW?: number;
}

export const DEFAULT_NODE_MAX_W = 240;
export const DEFAULT_NODE_MIN_W = 72;

/**
 * A default box size from a node's text. Rough by construction: it works off
 * an average glyph advance rather than a real text measurement, because the
 * layout runs before anything has a canvas context. `<dag-view>` passes its
 * own measured `charW` from the live font, which is what makes the estimate
 * track the actual rendering.
 */
export function measureNode(node: DagNode, opts: MeasureOptions = {}): NodeSize {
  const charW = opts.charW ?? 6.2;
  const padX = opts.padX ?? 10;
  const padY = opts.padY ?? 7;
  const lineH = opts.lineH ?? 15;
  const subLineH = opts.subLineH ?? 13;
  const maxW = opts.maxW ?? DEFAULT_NODE_MAX_W;
  const minW = opts.minW ?? DEFAULT_NODE_MIN_W;
  const label = node.label ?? node.id;
  const sub = node.sublabel ?? '';
  const textW = Math.max(label.length * charW, sub.length * charW * 0.88);
  const w = Math.max(minW, Math.min(maxW, Math.ceil(textW + padX * 2)));
  const h = padY * 2 + lineH + (sub !== '' ? subLineH : 0);
  return { w, h };
}

// -- Viewport ------------------------------------------------------------------------

/** Pan and zoom: world (layout) coordinates to screen (CSS px). */
export interface DagViewport {
  /** Screen x of world x = 0. */
  x: number;
  /** Screen y of world y = 0. */
  y: number;
  scale: number;
}

/** Hard zoom clamps. Below MIN a node is a smudge; above MAX it is wallpaper. */
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 4;

/** Pixels of wheel travel per doubling of the scale. */
export const ZOOM_PX_PER_DOUBLE = 260;

export function worldToScreen(p: { x: number; y: number }, v: DagViewport): { x: number; y: number } {
  return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y };
}

export function screenToWorld(p: { x: number; y: number }, v: DagViewport): { x: number; y: number } {
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}

/** Shift the viewport by a screen-space delta. */
export function panViewport(v: DagViewport, dx: number, dy: number): DagViewport {
  return { x: v.x + dx, y: v.y + dy, scale: v.scale };
}

/**
 * Zoom about a screen anchor: the world point under the anchor stays under
 * it. Anything else makes the content slide out from under the cursor, and
 * a reader who zooms toward a node and watches it leave has to chase it.
 */
export function zoomViewportAt(
  v: DagViewport,
  anchorX: number,
  anchorY: number,
  factor: number,
  minScale = MIN_SCALE,
  maxScale = MAX_SCALE,
): DagViewport {
  const next = Math.min(maxScale, Math.max(minScale, v.scale * factor));
  if (next === v.scale) return v;
  const w = screenToWorld({ x: anchorX, y: anchorY }, v);
  return { x: anchorX - w.x * next, y: anchorY - w.y * next, scale: next };
}

/** Scale factor for `deltaPx` of zoom wheel travel (negative = zoom in). */
export function zoomFactorForWheel(deltaPx: number): number {
  return Math.pow(2, -deltaPx / ZOOM_PX_PER_DOUBLE);
}

/** A rectangle in world coordinates. */
export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The viewport that fits `rect` inside a `vw` x `vh` box with `pad` screen
 * px of margin, centered. A degenerate rect (a single node, an empty graph)
 * still yields a usable viewport rather than an infinite or zero scale.
 */
export function fitViewport(
  rect: WorldRect,
  vw: number,
  vh: number,
  pad = 24,
  minScale = MIN_SCALE,
  maxScale = MAX_SCALE,
): DagViewport {
  const availW = Math.max(1, vw - pad * 2);
  const availH = Math.max(1, vh - pad * 2);
  const w = Math.max(1e-6, rect.w);
  const h = Math.max(1e-6, rect.h);
  const scale = Math.min(maxScale, Math.max(minScale, Math.min(availW / w, availH / h)));
  return {
    x: (vw - rect.w * scale) / 2 - rect.x * scale,
    y: (vh - rect.h * scale) / 2 - rect.y * scale,
    scale,
  };
}

/** Bounding box of the placed nodes, including their edges' bend points. */
export function layoutBounds(layout: DagLayout): WorldRect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of layout.nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  for (const e of layout.edges) {
    for (const p of e.points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Keep at least `margin` screen px of the drawing on screen. A graph is
 * pannable in every direction, so this is a leash rather than a fence: it
 * stops the content being flicked into the void, and never blocks a pan
 * that keeps something visible.
 */
export function clampViewport(v: DagViewport, bounds: WorldRect, vw: number, vh: number, margin = 60): DagViewport {
  const w = bounds.w * v.scale;
  const h = bounds.h * v.scale;
  const left = bounds.x * v.scale + v.x;
  const top = bounds.y * v.scale + v.y;
  const minLeft = margin - w;
  const maxLeft = vw - margin;
  const minTop = margin - h;
  const maxTop = vh - margin;
  const nx = v.x + (Math.min(maxLeft, Math.max(minLeft, left)) - left);
  const ny = v.y + (Math.min(maxTop, Math.max(minTop, top)) - top);
  return { x: nx, y: ny, scale: v.scale };
}

// -- Culling and hit tests --------------------------------------------------------------

/** The world rectangle a `vw` x `vh` viewport currently shows. */
export function visibleWorldRect(v: DagViewport, vw: number, vh: number): WorldRect {
  const a = screenToWorld({ x: 0, y: 0 }, v);
  const b = screenToWorld({ x: vw, y: vh }, v);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** True when the two world rectangles overlap at all. */
export function rectsOverlap(a: WorldRect, b: WorldRect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Indices of the nodes intersecting `view`, in layout order. */
export function visibleNodes(layout: DagLayout, view: WorldRect): number[] {
  const out: number[] = [];
  layout.nodes.forEach((n, i) => {
    if (rectsOverlap({ x: n.x, y: n.y, w: n.w, h: n.h }, view)) out.push(i);
  });
  return out;
}

/** Indices of the edges whose polyline bounding box intersects `view`. */
export function visibleEdges(layout: DagLayout, view: WorldRect): number[] {
  const out: number[] = [];
  layout.edges.forEach((e, i) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of e.points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    if (rectsOverlap({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, view)) out.push(i);
  });
  return out;
}

/** Index of the node containing a world point, or -1. Later nodes win. */
export function hitTestNodes(layout: DagLayout, wx: number, wy: number): number {
  for (let i = layout.nodes.length - 1; i >= 0; i--) {
    const n = layout.nodes[i];
    if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return i;
  }
  return -1;
}

/**
 * Index of the edge within `tol` world units of a point, or -1. The nearest
 * edge wins, not the first: with several lines converging on one box, "the
 * one I am pointing at" is the closest one.
 */
export function hitTestEdges(layout: DagLayout, wx: number, wy: number, tol: number): number {
  let best = -1;
  let bestD = tol * tol;
  layout.edges.forEach((e, i) => {
    for (let k = 1; k < e.points.length; k++) {
      const d = distSqToSegment(wx, wy, e.points[k - 1].x, e.points[k - 1].y, e.points[k].x, e.points[k].y);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
  });
  return best;
}

/** A placed node as a hit rectangle, for the shared hit-test helpers. */
export function nodeRect(n: PlacedNode): HitRect {
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}

// -- Reachability -----------------------------------------------------------------------

/** The dependency neighbourhood of one node. */
export interface Neighbourhood {
  /** Everything the node depends on, transitively (itself excluded). */
  ancestors: ReadonlySet<number>;
  /** Everything that depends on the node, transitively (itself excluded). */
  descendants: ReadonlySet<number>;
  /** Edge indices on a path into or out of the node. */
  edges: ReadonlySet<number>;
}

/**
 * Everything up-stream and down-stream of a node, plus the edges connecting
 * them. This is what the hover highlight paints: "what does this need, and
 * what breaks if it moves" is the question a dependency graph exists to
 * answer, and on a graph past a few dozen nodes it cannot be answered by
 * following lines with your eyes.
 *
 * Traversal follows the TRUE edge direction, including edges that
 * cycle-breaking reversed for layout -- the highlight has to reflect the
 * dependencies, not the drawing.
 */
export function neighbourhood(layout: DagLayout, index: number): Neighbourhood {
  const n = layout.nodes.length;
  const outAdj: number[][] = Array.from({ length: n }, () => []);
  const inAdj: number[][] = Array.from({ length: n }, () => []);
  const edgeOut: number[][] = Array.from({ length: n }, () => []);
  const edgeIn: number[][] = Array.from({ length: n }, () => []);
  layout.edges.forEach((e, i) => {
    outAdj[e.from].push(e.to);
    inAdj[e.to].push(e.from);
    edgeOut[e.from].push(i);
    edgeIn[e.to].push(i);
  });

  const walk = (start: number, adj: number[][], edgeAdj: number[][], edges: Set<number>): Set<number> => {
    const seen = new Set<number>();
    const stack = [start];
    while (stack.length > 0) {
      const v = stack.pop() as number;
      adj[v].forEach((w, k) => {
        edges.add(edgeAdj[v][k]);
        if (seen.has(w) || w === start) return;
        seen.add(w);
        stack.push(w);
      });
    }
    return seen;
  };

  const edges = new Set<number>();
  const ancestors = walk(index, inAdj, edgeIn, edges);
  const descendants = walk(index, outAdj, edgeOut, edges);
  return { ancestors, descendants, edges };
}

/** Longest dependency chain in the layout, in nodes. */
export function criticalPathLength(layout: DagLayout): number {
  let max = 0;
  for (const n of layout.nodes) max = Math.max(max, n.layer + 1);
  return max;
}

// -- Grouping ---------------------------------------------------------------------------

/**
 * Stable hue for a node: its `category`, else its own id. Falling back to
 * the id means an uncategorized graph is still readably multi-colored,
 * instead of one wall of the same blue.
 */
export function nodeHue(node: DagNode): number {
  const key = node.category ?? node.id;
  return Math.floor(((hashString(key) * 0.61803398875) % 1) * 360);
}

