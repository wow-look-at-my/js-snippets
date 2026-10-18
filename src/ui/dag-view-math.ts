// Pure math for the <dag-view> element: graph normalization, cycle breaking (reported, never silently dropped), layer assignment.

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
  /** Pins the node to a layer. */
  layer?: number;
  /** Multi-line explanation: why the node is in its state. The tooltip and the selected-node panel show it in full. */
  detail?: string;
  /** A link for the node. The selected-node panel and Ctrl/Cmd-click open it. Only http(s) and relative links open. */
  href?: string;
  /** The id of a group in the `groups` list. A collapsed group draws all its members as one node. */
  group?: string;
  /** Text for the badge on the first line. Defaults to the state. */
  badge?: string;
  /** Named links. The selected-node card lists each one under the detail text. */
  links?: DagLink[];
  /** Work is running on this node now. A light sheen sweeps across its box. A style entry with `active: true` marks a whole state. */
  active?: boolean;
  /** Consumer payload, passed back untouched on every event and callback. */
  meta?: unknown;
}

/** One named link on a node: a pull request, a run, a log. */
export interface DagLink {
  label: string;
  href: string;
}

/** One directed edge, read as "`to` depends on `from`", so `from` is drawn
 * ABOVE `to` (or left of it in 'LR'). */
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
  /** Input edges that are not in the graph. */
  rejected: readonly RejectedEdge[];
}

/** Validate and index the input. A duplicate edge (same from/to, whatever
 * its label) is kept once, a couple of lines between the same pair say
 * nothing a reader can act on. A node id that repeats keeps its
 * FIRST occurrence, so an id is a stable identity for the whole render. */
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
 * depth-first search from every node in input order. An edge back to a node
 * still on the stack closes a cycle, so that edge is the one reversed.
 *
 * The reversed set is RETURNED, not swallowed. A circular dependency is the
 * single most important thing a dependency graph can tell you. A layout
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
  /* */
  layers: readonly number[];
  /** Highest layer index in use. */
  maxLayer: number;
  /** Ids whose `layer` hint was dropped because an edge contradicted it. */
  ignoredPins: readonly string[];
}

/** Options for assignLayers. */
export interface LayerOptions {
  /** 'sources' puts every node as EARLY as its dependencies allow. */
  align?: 'sources' | 'sinks';
}

/**
 * Longest-path layering over the acyclic adjacency: a node's layer is one
 * past the deepest of its dependencies. No edge ever points backwards or
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
    // Walk the topological order backwards and pull each node down to above
    // its earliest dependent. A node with no dependents lands on the last
    // layer, which is what bottom-aligning means.
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

/** Nodes per row before a layer wraps onto another row. */
export const DEFAULT_MAX_LAYER_WIDTH = 14;

/** Break a layer that is too wide to read into consecutive rows. The graph is
 *not empty and it is not broken. It is unreadable, which the reader cannot
 *tell apart. */
export function wrapWideLayers(layout: LayerResult, max = DEFAULT_MAX_LAYER_WIDTH): LayerResult {
  if (max <= 0) return layout;
  const members: number[][] = [];
  for (let i = 0; i <= layout.maxLayer; i++) members.push([]);
  layout.layers.forEach((l, v) => members[l].push(v));

  const layers = layout.layers.slice();
  let next = 0;
  let maxLayer = 0;
  for (const row of members) {
    // An empty layer still consumes its index, so a pinned node that named a far layer keeps the gap it asked for.
    const rows = row.length === 0 ? 1 : Math.ceil(row.length / max);
    // Widen to the flattest split rather than filling every row to `max` and leaving a remainder of one.
    const per = row.length === 0 ? 0 : Math.ceil(row.length / rows);
    row.forEach((v, i) => {
      layers[v] = next + Math.floor(i / per);
    });
    maxLayer = Math.max(maxLayer, next + rows - 1);
    next += rows;
  }
  return { layers, maxLayer, ignoredPins: layout.ignoredPins };
}

/**
 * Kahn topological order over an adjacency list, ties broken by node index
 * so the result is the same on every run. A graph with a cycle left in it
 * would strand nodes. They are appended in index order rather than dropped,
 * because losing a node is never an acceptable way to report a cycle.
 */
export function topoOrder(out: readonly (readonly number[])[], n: number): number[] {
  const indeg = new Int32Array(n);
  for (let v = 0; v < n; v++) for (const w of out[v]) indeg[w]++;
  // A binary heap will be faster.
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
  /* */
  node: number;
  /* */
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

/** A slot's identity: stable under any reordering of its layer. */
export function slotIdentity(s: LayerSlot): string {
  return s.node >= 0 ? `n${s.node}` : `d${s.edge}@${s.layer}`;
}

/** Split every edge that spans more than one layer into a chain of
 * single-layer segments through dummy slots. This is what makes long edges
 * behave. With the dummies, a long edge occupies real width in every layer
 * it crosses, gets ordered like anything else. And comes out as a routed
 * polyline instead of a chord across the drawing. */
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
export const ORDER_SWEEPS = 16;

/**
 * Reorder the slots inside each layer to reduce edge crossings: the
 * weighted-median heuristic, swept down and up alternately. Those slots
 * are with an adjacent-transpose pass after each sweep that swaps
 * neighbours whenever the swap removes crossings.
 *
 * Crossing minimization is NP-hard, so this is a heuristic and it is
 * supposed to be. What it must be is monotone and deterministic: the best
 * ordering seen so far is kept. A sweep that makes things worse is
 * discarded, and every tie breaks on the slot's current position. Mutates
 * `proper.layers` in place and returns the crossing count it settled on.
 */
export function orderLayers(proper: ProperLayering, sweeps = ORDER_SWEEPS): number {
  const { layers, succ, pred } = proper;
  let best = layers.map((l) => l.slice());
  let bestCrossings = countCrossings(proper);

  // Zero crossings is NOT a reason to skip the sweeps. insertDummies appends
  // every bend point to the END of its layer.

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
    // A TIE is accepted, not an improvement.
    if (c <= bestCrossings) {
      bestCrossings = c;
      best = layers.map((x) => x.slice());
    }
  }
  for (let l = 0; l < layers.length; l++) layers[l] = best[l];
  return bestCrossings;
}

/** Adjacent-exchange pass: swap neighbouring slots whenever the swap
 * strictly reduces the crossings between this layer and its neighbours. Runs
 * until a full pass changes nothing, or the guard trips. A heuristic that
 * cannot terminate would hang the layout, and the guard is what makes that
 * impossible rather than unlikely. */
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

/** Crossings between layer `l` and `l + 1`, counted by the pair rule: edges
 * cross exactly when their endpoints are in opposite order on both layers. */
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
  /** Gap between adjacent edge routing slots. See DEFAULT_ROUTE_GAP. */
  routeGap?: number;
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
/** Straightening passes. */
export const DEFAULT_COORD_PASSES = 12;

/** Edge routing slots side by side need enough room to read as a couple of lines and no more. */
export const DEFAULT_ROUTE_GAP = 10;

/** Put each slot as close as it can get to where it WANTS to be, keeping the row's order and a minimum gap between neighbours. This is the whole difference between a drawing that reads and the strip this replaced. Minimizing the total distance from the desired positions cannot do that. Where the desires already fit, they are used unchanged. Where they collide, the block that forms
 * sits at its members' median, which is the position that minimizes the sum of absolute errors. So a row is never wider than what its own nodes asked for. The constraint x[i] - x[i-1] >= gap[i] becomes a plain "not decreasing" once each position is shifted by the gaps before it. This is the standard isotonic regression that pool-adjacent-violators solves exactly. */
export function fitToDesired(desired: readonly number[], gap: readonly number[]): number[] {
  const n = desired.length;
  if (n === 0) return [];

  // Shift out the gaps, so the only remaining constraint is monotonicity.
  const prefix = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) prefix[i] = prefix[i - 1] + (gap[i] ?? 0);
  const target = desired.map((d, i) => d - prefix[i]);

  // Each block keeps its members' values sorted, so its median is a lookup.
  const blockValues: number[][] = [];
  const blockCount: number[] = [];
  const median = (v: readonly number[]): number => {
    const m = v.length >> 1;
    return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

  for (const t of target) {
    blockValues.push([t]);
    blockCount.push(1);
    // A block that wants to sit left of the one before it cannot: merge them
    // and let the pair share one position.
    while (blockValues.length > 1) {
      const b = blockValues.length - 1;
      if (median(blockValues[b - 1]) <= median(blockValues[b])) break;
      const merged: number[] = [];
      let i = 0;
      let j = 0;
      const left = blockValues[b - 1];
      const right = blockValues[b];
      while (i < left.length || j < right.length) {
        if (j >= right.length || (i < left.length && left[i] <= right[j])) merged.push(left[i++]);
        else merged.push(right[j++]);
      }
      blockValues.splice(b - 1, 2, merged);
      blockCount.splice(b - 1, 2, blockCount[b - 1] + blockCount[b]);
    }
  }

  const out = new Array<number>(n);
  let at = 0;
  for (let b = 0; b < blockValues.length; b++) {
    const v = median(blockValues[b]);
    for (let k = 0; k < blockCount[b]; k++) out[at + k] = v + prefix[at + k];
    at += blockCount[b];
  }
  return out;
}

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

/** Give every slot a cross-axis center. The first pass packs each layer left to right at the minimum gap, which is correct and ugly. A chain of single nodes comes out as a staircase. The straightening passes then repeatedly pull each slot toward the median of its neighbours in the adjacent layer. And re-separate any overlap the pull created, alternating direction. That is the priority method rather than full Brandes-Kopf, and the property it buys is the one that matters to a reader. A straight dependency chain draws as a straight line, and a long edge's bend points line
 * up with each other instead of zig-zagging. The separation step runs AFTER every pull, never as a final tidy-up. A layout that resolves overlaps once at the end can still hand back overlapping boxes. Boxes drawn on top of each other is worse than any amount of crookedness. */
export function assignCoordinates(
  proper: ProperLayering,
  sizes: readonly NodeSize[],
  opts: CoordOptions = {},
): CoordResult {
  const gap = opts.gap ?? DEFAULT_GAP;
  const routeGap = opts.routeGap ?? DEFAULT_ROUTE_GAP;
  const layerGap = opts.layerGap ?? DEFAULT_LAYER_GAP;
  const dummyW = opts.dummyWidth ?? DEFAULT_DUMMY_WIDTH;
  const passes = opts.passes ?? DEFAULT_COORD_PASSES;
  const rows = proper.layers;

  const cSizeOf = (s: LayerSlot): number => (s.node >= 0 ? sizes[s.node].w : dummyW);
  const lSizeOf = (s: LayerSlot): number => (s.node >= 0 ? sizes[s.node].h : 0);

  // A box against anything needs the full gap.
  const gapBetween = (a: LayerSlot, b: LayerSlot): number => (a.node < 0 && b.node < 0 ? routeGap : gap);

  // Minimum center-to-center distance for each slot from the one before it.
  const gapsFor = (row: readonly LayerSlot[]): number[] =>
    row.map((s, i) => (i === 0 ? 0 : cSizeOf(row[i - 1]) / 2 + gapBetween(row[i - 1], s) + cSizeOf(s) / 2));

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
    const gaps = gapsFor(row);
    const out: number[] = [];
    let x = 0;
    for (let i = 0; i < row.length; i++) {
      x = i === 0 ? cSizeOf(row[0]) / 2 : x + gaps[i];
      out.push(x);
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
    centers[l] = fitToDesired(centers[l], gapsFor(rows[l]));
  };

  // A slot with an edge at either end has a reason to sit where the
  // straightening put it. One with no edge at all has none.
  const anchored = (s: LayerSlot): boolean => {
    const key = slotIdentity(s);
    return (proper.pred.get(key)?.length ?? 0) > 0 || (proper.succ.get(key)?.length ?? 0) > 0;
  };

  /**
   * Close the slack the straightening opens up.
   *
   * separate() enforces a MINIMUM distance and nothing enforces a maximum. A
   * node pulled toward a far-off neighbour's median leaves a hole where it
   * used to be. An unanchored node keeps whatever position the initial
   * packing gave it. On a graph whose nodes are mostly unconnected that
   * reads as boxes huddled at both ends of a row with a void between them.
   * This is not a fact about the dependencies.
   *
   * Only unanchored slots move, and only up against a neighbour, so no
   * alignment the straightening earned is undone.
   */
  const compact = (l: number): void => {
    const row = rows[l];
    for (let i = 1; i < row.length; i++) {
      if (anchored(row[i])) continue;
      const min = centers[l][i - 1] + cSizeOf(row[i - 1]) / 2 + gapBetween(row[i - 1], row[i]) + cSizeOf(row[i]) / 2;
      if (centers[l][i] > min) centers[l][i] = min;
    }
    // A row that OPENS with unanchored slots cannot close its gap by moving left -- there is nothing to its left.
    let first = 0;
    while (first < row.length && !anchored(row[first])) first++;
    if (first === 0 || first >= row.length) return;
    for (let i = first - 1; i >= 0; i--) {
      const max = centers[l][i + 1] - cSizeOf(row[i + 1]) / 2 - gapBetween(row[i], row[i + 1]) - cSizeOf(row[i]) / 2;
      if (centers[l][i] < max) centers[l][i] = max;
    }
  };

  /** Total cross-axis distance the edges travel, which is the thing a
   * reader experiences as a tangle. Only the cross axis moves here, so this
   * is the whole difference between candidate placements. */
  const wireLength = (): number => {
    let sum = 0;
    rows.forEach((row, l) => {
      if (l + 1 >= rows.length) return;
      const posByIdentity = new Map<string, number>();
      rows[l + 1].forEach((t, ti) => posByIdentity.set(slotIdentity(t), ti));
      row.forEach((s, i) => {
        for (const key of proper.succ.get(slotIdentity(s)) ?? []) {
          const ti = posByIdentity.get(key);
          if (ti !== undefined) sum += Math.abs(centers[l][i] - centers[l + 1][ti]);
        }
      });
    });
    return sum;
  };

  /** Every routing slot of one long edge is one block, and a block moves as a unit. */
  const blockOf = new Map<string, number>();
  const blockMembers: string[][] = [];
  for (const chain of proper.chains.values()) {
    const dummies = chain.filter((id) => id.startsWith('d'));
    if (dummies.length < 2) continue;
    const b = blockMembers.length;
    blockMembers.push(dummies);
    for (const id of dummies) blockOf.set(id, b);
  }

  /** Where each slot sits, indexed the same way the rows are. */
  const slotAt = new Map<string, { l: number; i: number }>();
  rows.forEach((row, l) => row.forEach((s, i) => slotAt.set(slotIdentity(s), { l, i })));

  // One position per block: the median of what its slots wanted, which is
  // the value minimizing the total distance from all of them.
  const alignBlocks = (desiredByRow: number[][]): void => {
    for (const members of blockMembers) {
      const wants: number[] = [];
      for (const id of members) {
        const at = slotAt.get(id);
        if (at !== undefined) wants.push(desiredByRow[at.l][at.i]);
      }
      if (wants.length === 0) continue;
      wants.sort((a, b) => a - b);
      const m = wants.length >> 1;
      const v = wants.length % 2 === 1 ? wants[m] : (wants[m - 1] + wants[m]) / 2;
      for (const id of members) {
        const at = slotAt.get(id);
        if (at !== undefined) desiredByRow[at.l][at.i] = v;
      }
    }
  };

  // A sweep is a guess, not an improvement: the up pass.
  let best = centers.map((row) => row.slice());
  let bestScore = wireLength();
  for (let p = 0; p < passes; p++) {
    const up = p % 2 === 0;
    const order = up
      ? Array.from({ length: rows.length }, (_, i) => i)
      : Array.from({ length: rows.length }, (_, i) => rows.length - 1 - i);
    // A slot with nothing in the swept direction still has a reason to sit
    // somewhere: the other side.
    const desiredByRow = rows.map((row, l) =>
      row.map((_, i) => neighbourMedian(l, i, up) ?? neighbourMedian(l, i, !up) ?? centers[l][i]),
    );
    alignBlocks(desiredByRow);
    for (const l of order) centers[l] = fitToDesired(desiredByRow[l], gapsFor(rows[l]));
    const score = wireLength();
    if (score < bestScore) {
      bestScore = score;
      best = centers.map((row) => row.slice());
    }
  }
  centers.splice(0, centers.length, ...best.map((row) => row.slice()));

  // After the last pull, never between some of them: compacting mid-run
  // would be undone by the next pass.
  for (let l = 0; l < rows.length; l++) {
    compact(l);
    separate(l);
  }

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
      // A dummy has no thickness, so it sits on the layer's mid-line and the routed polyline bends there.
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
  /** Source to target, including the bend points. At least points. */
  points: readonly { x: number; y: number }[];
  /** True when cycle-breaking reversed this edge. */
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
  /** The groups with at least one member, collapsed and expanded. Absent from a layout made without groups. */
  groups?: readonly PlacedGroup[];
}

/** Options for layoutDag. */
export interface DagLayoutOptions extends CoordOptions, LayerOptions {
  orientation?: DagOrientation;
  /** Measures a node. Defaults to measureNode with its own defaults. */
  sizeOf?: (node: DagNode, index: number) => NodeSize;
  /** Ordering sweeps (see ORDER_SWEEPS). */
  sweeps?: number;
  /** Nodes per row before a layer wraps. See wrapWideLayers. */
  maxLayerWidth?: number;
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
  const probe = buildGraph(nodes, edges);
  const degree = new Array<number>(probe.nodes.length).fill(0);
  for (const e of probe.edges) {
    degree[e.from]++;
    degree[e.to]++;
  }
  // A node with no edge is not part of the dependency structure, and putting it in a layer says it is.
  const parts = componentsOf(probe, degree);
  if (parts.wired.length > 1 || parts.loose.length > 0) return layoutBlocks(probe, parts, opts);
  return layoutConnected(nodes, edges, opts);
}

/** The wired components, largest first, and the edgeless nodes on their own. */
interface GraphParts {
  wired: number[][];
  loose: number[];
}

/** Split into pieces that share no edge. */
function componentsOf(graph: DagGraph, degree: readonly number[]): GraphParts {
  const near = graph.nodes.map((): number[] => []);
  for (const e of graph.edges) {
    near[e.from].push(e.to);
    near[e.to].push(e.from);
  }
  const seen = new Array<boolean>(graph.nodes.length).fill(false);
  const wired: number[][] = [];
  const loose: number[] = [];
  for (let v = 0; v < graph.nodes.length; v++) {
    if (seen[v]) continue;
    // A pinned node named its own layer, so it stays in the layered part
    // even with no edge to hold it there.
    if (degree[v] === 0 && graph.nodes[v].layer === undefined) {
      seen[v] = true;
      loose.push(v);
      continue;
    }
    const stack = [v];
    const members: number[] = [];
    seen[v] = true;
    while (stack.length > 0) {
      const u = stack.pop() as number;
      members.push(u);
      for (const w of near[u]) {
        if (seen[w]) continue;
        seen[w] = true;
        stack.push(w);
      }
    }
    members.sort((a, b) => a - b);
    wired.push(members);
  }
  wired.sort((a, b) => b.length - a.length || a[0] - b[0]);
  return { wired, loose };
}

/** Shifts a finished layout, boxes and routed points alike. */
function translateLayout(layout: DagLayout, dx: number, dy: number): DagLayout {
  return {
    ...layout,
    nodes: layout.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
    edges: layout.edges.map((e) => ({
      ...e,
      points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    })),
  };
}

/**
 * Lay every piece out on its own, then set the pieces side by side.
 *
 * Shelf packing, widest row first, against a target width taken from the
 * total area. A piece keeps its own internal drawing exactly, so nothing the
 * layering earned is disturbed -- only where the piece SITS changes.
 */
function layoutBlocks(probe: DagGraph, parts: GraphParts, opts: DagLayoutOptions): DagLayout {
  const orientation = opts.orientation ?? 'TB';
  const sizeOf = opts.sizeOf ?? ((n: DagNode): NodeSize => measureNode(n));
  const gap = opts.gap ?? DEFAULT_GAP;
  const layerGap = opts.layerGap ?? DEFAULT_LAYER_GAP;

  const inputEdges = probe.edges.map((e) => e.edge);
  const blocks = parts.wired.map((members) => {
    const keep = new Set(members);
    const sub = members.map((i) => probe.nodes[i]);
    const subEdges = probe.edges.filter((e) => keep.has(e.from) && keep.has(e.to)).map((e) => e.edge);
    return layoutConnected(sub, subEdges, opts);
  });

  // The edgeless nodes are one block of their own, packed as a grid rather than a line.
  const looseNodes = parts.loose.map((i) => probe.nodes[i]);
  const looseSizes = looseNodes.map((n, i) => sizeOf(n, i));
  const looseArea = looseSizes.reduce((s, z) => s + (z.w + gap) * (z.h + gap), 0);
  const graphArea = blocks.reduce((s, b) => s + (b.width + gap) * (b.height + gap), 0);
  // A landscape target, because a reader's window is wider than it is tall.
  const target = Math.max(
    blocks.reduce((m, b) => Math.max(m, b.width), 0),
    Math.sqrt(Math.max(1, graphArea + looseArea) * 1.7),
  );

  const looseBlock: PlacedNode[] = [];
  {
    let cursor = 0;
    let lineStart = 0;
    let lineThick = 0;
    looseNodes.forEach((n, i) => {
      const size = looseSizes[i];
      if (cursor > 0 && cursor + size.w > target) {
        lineStart += lineThick + gap;
        cursor = 0;
        lineThick = 0;
      }
      looseBlock.push({ node: n, index: -1, layer: -1, x: cursor, y: lineStart, w: size.w, h: size.h });
      cursor += size.w + gap;
      lineThick = Math.max(lineThick, size.h);
    });
  }
  const looseW = looseBlock.reduce((m, p) => Math.max(m, p.x + p.w), 0);
  const looseH = looseBlock.reduce((m, p) => Math.max(m, p.y + p.h), 0);

  // Shelf the wired blocks, then the edgeless block last so it reads as an appendix rather than as part.
  const shelved: DagLayout[] = [];
  let x = 0;
  let y = 0;
  let rowThick = 0;
  let width = 0;
  for (const b of blocks) {
    if (x > 0 && x + b.width > target) {
      y += rowThick + layerGap;
      x = 0;
      rowThick = 0;
    }
    shelved.push(translateLayout(b, x, y));
    x += b.width + layerGap;
    width = Math.max(width, x - layerGap);
    rowThick = Math.max(rowThick, b.height);
  }
  const afterWired = blocks.length === 0 ? 0 : y + rowThick;
  const looseY = blocks.length === 0 ? 0 : afterWired + layerGap;
  for (const p of looseBlock) p.y += looseY;

  const allNodes = [...shelved.flatMap((b) => b.nodes), ...looseBlock];
  const byId = new Map<string, number>();
  allNodes.forEach((p, i) => byId.set(p.node.id, i));
  const byEdge = new Map<DagEdge, number>();
  inputEdges.forEach((e, i) => byEdge.set(e, i));

  // Each block numbered its own nodes from zero.
  const cycleEdges: number[] = [];
  const edges: PlacedEdge[] = [];
  let nodeOffset = 0;
  for (const b of shelved) {
    for (const e of b.edges) {
      if (e.reversed) cycleEdges.push(edges.length);
      edges.push({ ...e, index: byEdge.get(e.edge) ?? edges.length, from: e.from + nodeOffset, to: e.to + nodeOffset });
    }
    nodeOffset += b.nodes.length;
  }

  const layoutOut: DagLayout = {
    nodes: allNodes,
    edges,
    byId,
    width: Math.max(width, looseW),
    height: Math.max(afterWired, looseBlock.length === 0 ? 0 : looseY + looseH),
    orientation,
    crossings: shelved.reduce((s, b) => s + b.crossings, 0),
    cycleEdges,
    rejected: probe.rejected,
    ignoredPins: shelved.flatMap((b) => b.ignoredPins),
  };
  return layoutOut;
}

function layoutConnected(
  nodes: readonly DagNode[],
  edges: readonly DagEdge[],
  opts: DagLayoutOptions = {},
): DagLayout {
  const orientation = opts.orientation ?? 'TB';
  const graph = buildGraph(nodes, edges);
  const acyclic = breakCycles(graph);
  const layered = wrapWideLayers(assignLayers(graph, acyclic, opts), opts.maxLayerWidth);
  const proper = insertDummies(graph, acyclic, layered);
  const crossings = orderLayers(proper, opts.sweeps);
  const sizeOf = opts.sizeOf ?? ((n: DagNode): NodeSize => measureNode(n));
  const sizes = graph.nodes.map((n, i) => sizeOf(n, i));
  // In 'LR' the layer axis is x and the cross axis is y.
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
    // The chain was built along the ACYCLIC direction.
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
  /* */
  subLineH?: number;
  /** Clamp on the box width, so one long title cannot set the whole layout. */
  maxW?: number;
  /** Floor on the box width, so a one-character node is still a target. */
  minW?: number;
  /** Most lines the label wraps to. The last line ends in an ellipsis when text is left over. */
  labelLines?: number;
  /** Most lines the sublabel wraps to. */
  subLines?: number;
}

export const DEFAULT_NODE_MAX_W = 300;
export const DEFAULT_NODE_MIN_W = 72;
export const DEFAULT_LABEL_LINES = 2;
export const DEFAULT_SUB_LINES = 2;
/** The sublabel font is one px smaller, so its glyphs run this much narrower. */
const SUB_CHAR_RATIO = 0.9;
/** Glyph widths of padding inside a state badge, both sides together. */
const BADGE_PAD_CHARS = 2;
/** Gap between the label and the state badge, in glyph widths. */
const BADGE_GAP_CHARS = 1;

/** Text wrapped to a line budget. */
export interface WrappedText {
  lines: string[];
  /** True when the text did not fit and the last line was cut. */
  truncated: boolean;
}

/** A character after which a line may break: a space, or a separator in an identifier such as a branch or a path. */
function breaksAfter(ch: string): boolean {
  return ch === ' ' || ch === '/' || ch === '-' || ch === '_' || ch === '.' || ch === ':' || ch === ',';
}

/**
 * Wrap `text` to lines of at most `maxChars` characters, breaking after a space or an identifier separator.
 * A token longer than a line breaks mid-token. The last line ends in an ellipsis when text is left over.
 */
export function wrapText(text: string, maxChars: number, maxLines: number): WrappedText {
  const clean = text.replace(/\s+/g, ' ').trim();
  const width = Math.max(1, Math.floor(maxChars));
  if (clean === '' || maxLines <= 0) return { lines: [], truncated: clean !== '' };
  const lines: string[] = [];
  let rest = clean;
  while (rest !== '' && lines.length < maxLines) {
    if (rest.length <= width) {
      lines.push(rest);
      rest = '';
      break;
    }
    let cut = -1;
    for (let pos = width; pos > 0; pos--) {
      if (breaksAfter(rest[pos - 1])) {
        cut = pos;
        break;
      }
    }
    // No break point in the first half: a mid-token cut keeps the line full.
    if (cut < width / 2) cut = width;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest === '') return { lines, truncated: false };
  const last = lines[lines.length - 1];
  lines[lines.length - 1] = (last.length >= width ? last.slice(0, width - 1) : last).trimEnd() + '…';
  return { lines, truncated: true };
}

/** A node's box and the text the box holds, line by line. */
export interface NodeText extends NodeSize {
  label: string[];
  sub: string[];
  /** The state word drawn as a badge on the first label line, or '' for none. */
  badge: string;
  /** Characters per label line that the box holds beside the badge. */
  labelChars: number;
  /** Characters per sublabel line. */
  subChars: number;
}

/**
 * The box size and the wrapped lines of a node. Rough by construction: it works off an average glyph advance
 * rather than a real text measurement. This is because the layout runs before anything has a canvas context.
 * `<dag-view>` passes its own measured `charW` from the live font, which is what makes the estimate track the
 * actual rendering. The state word takes room on the first label line, so it never covers the label.
 */
export function layoutNodeText(node: DagNode, opts: MeasureOptions = {}): NodeText {
  const charW = opts.charW ?? 6.2;
  const padX = opts.padX ?? 10;
  const padY = opts.padY ?? 7;
  const lineH = opts.lineH ?? 15;
  const subLineH = opts.subLineH ?? 13;
  const maxW = opts.maxW ?? DEFAULT_NODE_MAX_W;
  const minW = opts.minW ?? DEFAULT_NODE_MIN_W;
  const labelText = node.label ?? node.id;
  const subText = node.sublabel ?? '';
  const badge = node.badge ?? node.state ?? '';
  const badgeChars = badge === '' ? 0 : badge.length + BADGE_PAD_CHARS + BADGE_GAP_CHARS;
  const subW = charW * SUB_CHAR_RATIO;
  const wantW = Math.max((labelText.length + badgeChars) * charW, subText.length * subW);
  const w = Math.max(minW, Math.min(maxW, Math.ceil(wantW + padX * 2)));
  const inner = w - padX * 2;
  const labelChars = Math.max(1, Math.floor(inner / charW) - badgeChars);
  const subChars = Math.max(1, Math.floor(inner / subW));
  const label = wrapText(labelText, labelChars, opts.labelLines ?? DEFAULT_LABEL_LINES).lines;
  const sub = wrapText(subText, subChars, opts.subLines ?? DEFAULT_SUB_LINES).lines;
  const h = padY * 2 + Math.max(1, label.length) * lineH + sub.length * subLineH;
  return { w, h, label, sub, badge, labelChars, subChars };
}

/** A default box size from a node's text: the size half of layoutNodeText. */
export function measureNode(node: DagNode, opts: MeasureOptions = {}): NodeSize {
  const t = layoutNodeText(node, opts);
  return { w: t.w, h: t.h };
}

/**
 * A node `href` the element may open, or null. Only http(s) and same-origin relative links pass. A
 * `javascript:` or `data:` URL from a consumer's payload must never run on a click.
 */
export function safeNodeHref(href: string | undefined): string | null {
  if (href === undefined) return null;
  const h = href.trim();
  if (h === '') return null;
  if (/^https?:\/\//i.test(h)) return h;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//')) return null;
  return h;
}

/** A node link the card can render: its text, its safe href, and whether it leaves this origin. */
export interface CardLink {
  label: string;
  href: string;
  external: boolean;
}

/**
 * The links the selected-node card lists, in input order. A link whose href
 * `safeNodeHref` refuses is left out. An empty label falls back to the href,
 * and a repeat of an earlier href is dropped. An absolute http(s) link is
 * external: the card opens it in a new tab.
 */
export function cardLinks(node: DagNode): CardLink[] {
  const out: CardLink[] = [];
  const seen = new Set<string>();
  for (const link of node.links ?? []) {
    const href = safeNodeHref(link?.href);
    if (href === null || seen.has(href)) continue;
    seen.add(href);
    const label = typeof link.label === 'string' && link.label.trim() !== '' ? link.label.trim() : href;
    out.push({ label, href, external: /^https?:\/\//i.test(href) });
  }
  return out;
}

// -- Viewport ------------------------------------------------------------------------

/** Pan and zoom: world (layout) coordinates to screen (CSS px). */
export interface DagViewport {
  /* */
  x: number;
  /* */
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
 * it. Anything else makes the content slide out from under the cursor. A
 * reader who zooms toward a node and watches it leave has to chase it.
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
  for (const g of layout.groups ?? []) {
    if (g.collapsed) continue;
    x0 = Math.min(x0, g.x);
    y0 = Math.min(y0, g.y);
    x1 = Math.max(x1, g.x + g.w);
    y1 = Math.max(y1, g.y + g.h);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Keep at least `margin` screen px of the drawing on screen. A graph is
 * pannable in every direction. This is a leash rather than a fence: it
 * stops the content being flicked into the void. It never blocks a pan
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

/** True when both world rectangles overlap at all. */
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

/*Later nodes win. */
export function hitTestNodes(layout: DagLayout, wx: number, wy: number): number {
  for (let i = layout.nodes.length - 1; i >= 0; i--) {
    const n = layout.nodes[i];
    if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return i;
  }
  return -1;
}

/*The nearest edge wins, not the first: with several lines converging on one
 * box, "the one I am pointing at" is the closest one. */
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

/** Everything up-stream and down-stream of a node, plus the edges
 * connecting them. This is what the hover highlight paints. "what does this
 * need, and what breaks if it moves" is the question a dependency graph
 * exists to answer, and on a graph past a few nodes it cannot be answered
 * by following lines. This holds with your eyes. Traversal follows the TRUE
 * edge direction, including edges that cycle-breaking reversed for layout
 * -- the highlight has to reflect the dependencies, not the drawing. */
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
  // An edgeless node is not in the layering and carries no layer, but it is still a chain of one.
  for (const n of layout.nodes) max = Math.max(max, n.layer < 0 ? 1 : n.layer + 1);
  return max;
}

// -- Grouping ---------------------------------------------------------------------------

/** Stable hue for a node: its `category`, else its own id. */
export function nodeHue(node: DagNode): number {
  const key = node.category ?? node.id;
  return Math.floor(((hashString(key) * 0.61803398875) % 1) * 360);
}


// -- Activity ---------------------------------------------------------------------------

/** One sweep of the active sheen, start to start, in ms. */
export const ACTIVE_PERIOD_MS = 1600;
/** One reduced-motion pulse, in ms. Slower, because the pulse replaces motion with a change of light. */
export const ACTIVE_PULSE_PERIOD_MS = 3200;
/** The share of a period the sheen spends crossing the box. The rest is rest, so the sweep reads as a beat and not a strobe. */
export const ACTIVE_SWEEP_SHARE = 0.6;

/** The part of a style entry the activity logic reads. */
export interface ActiveStyle {
  active?: boolean;
}

/** True when the node itself says `active: true`, or its state's style entry does. */
export function isActiveNode(node: DagNode, styles: Readonly<Record<string, ActiveStyle | undefined>>): boolean {
  if (node.active === true) return true;
  return node.state !== undefined && styles[node.state]?.active === true;
}

/** Indices of the active nodes that intersect `view`, in layout order. The element animates only while this is non-empty. */
export function visibleActiveNodes(
  layout: DagLayout,
  view: WorldRect,
  styles: Readonly<Record<string, ActiveStyle | undefined>>,
): number[] {
  return visibleNodes(layout, view).filter((idx) => isActiveNode(layout.nodes[idx].node, styles));
}

/** Each id gets its own fixed offset into the period, so active nodes
 * never beat in lockstep. One node keeps its offset across redraws and
 * reloads. */
export function activePhase(id: string, nowMs: number, periodMs: number = ACTIVE_PERIOD_MS): number {
  const offset = (hashString(id) / 0x100000000) * periodMs;
  const t = (((nowMs + offset) % periodMs) + periodMs) % periodMs;
  return t / periodMs;
}

/** Returns null outside the sweep share of the period. */
export function sheenCentre(phase: number, w: number, h: number, halfBand: number): number | null {
  if (phase >= ACTIVE_SWEEP_SHARE) return null;
  const k = phase / ACTIVE_SWEEP_SHARE;
  return -halfBand + k * (w + h + 2 * halfBand);
}

/** Half the sheen band's width on the diagonal axis, for a `w` x `h` box. */
export function sheenHalfBand(w: number, h: number): number {
  return Math.max(6, (w + h) * 0.14);
}

export function pulseLevel(phase: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
}

// -- Groups -----------------------------------------------------------------------------

/** A named set of nodes. A node joins it by naming its `id` in `group`. */
export interface DagGroup {
  id: string;
  /** The stand-in's label while collapsed, and the box header while expanded. Defaults to "<N> nodes". */
  label?: string;
  /** The starting state. A reader's click overrides it. */
  collapsed?: boolean;
}

/** A group as the layout drew it. */
export interface PlacedGroup {
  id: string;
  label: string;
  collapsed: boolean;
  /** The members, in input order. */
  members: readonly DagNode[];
  /** The id of the node that stands for a collapsed group. */
  nodeId: string;
  /** Collapsed: the stand-in's box. Expanded: the box around the members, with the header on top. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The header strip's height. Zero while collapsed. */
  header: number;
}

/** The prefix of a collapsed group's stand-in id. */
export const GROUP_NODE_PREFIX = 'group:';
/** The header strip of an expanded group, world px. */
export const GROUP_HEADER = 26;
/** Padding between an expanded group's box and its members, world px. */
export const GROUP_PAD = 12;

export function groupNodeId(id: string): string {
  return GROUP_NODE_PREFIX + id;
}

/** The text a group shows: its own label, else a count of its members. */
export function groupLabel(group: DagGroup, count: number): string {
  const label = group.label?.trim() ?? '';
  return label !== '' ? label : `${count} node${count === 1 ? '' : 's'}`;
}

/** The header line of an expanded group. The box is sized to hold it. */
export function groupHeaderText(label: string, count: number): string {
  return `▾ ${label}  ·  ${count}  ·  click to collapse`;
}

/** One group with its members, as collapseGroups found it. */
export interface GroupMembers {
  group: DagGroup;
  members: DagNode[];
  collapsed: boolean;
}

/** A graph with every collapsed group replaced by its stand-in. */
export interface CollapsedGraph {
  nodes: DagNode[];
  edges: DagEdge[];
  /** Groups with at least one member, in the order of the `groups` list. */
  groups: GroupMembers[];
}

/**
 * Replaces each collapsed group's members with ONE stand-in node, at the
 * place of its first member. An edge to or from a member goes to or from the
 * stand-in. An edge between members of one collapsed group goes. Edges that
 * now join the same pair are kept once. A node that names no listed group,
 * and a group with no member, change nothing.
 */
export function collapseGroups(
  nodes: readonly DagNode[],
  edges: readonly DagEdge[],
  groups: readonly DagGroup[],
  isCollapsed: (group: DagGroup) => boolean = (g) => g.collapsed === true,
): CollapsedGraph {
  const byId = new Map<string, DagGroup>();
  for (const g of groups) if (!byId.has(g.id)) byId.set(g.id, g);
  const membersOf = new Map<string, DagNode[]>();
  for (const n of nodes) {
    if (n.group === undefined || !byId.has(n.group)) continue;
    const list = membersOf.get(n.group) ?? [];
    list.push(n);
    membersOf.set(n.group, list);
  }
  const found: GroupMembers[] = [];
  const standIn = new Map<string, string>();
  for (const g of byId.values()) {
    const members = membersOf.get(g.id);
    if (members === undefined) continue;
    const collapsed = isCollapsed(g);
    found.push({ group: g, members, collapsed });
    if (collapsed) for (const m of members) standIn.set(m.id, groupNodeId(g.id));
  }
  const out: DagNode[] = [];
  const placed = new Set<string>();
  for (const n of nodes) {
    const sid = standIn.get(n.id);
    if (sid === undefined) {
      out.push(n);
      continue;
    }
    if (placed.has(sid)) continue;
    placed.add(sid);
    const entry = found.find((f) => groupNodeId(f.group.id) === sid)!;
    const count = entry.members.length;
    out.push({
      id: sid,
      label: groupLabel(entry.group, count),
      sublabel: 'click to expand',
      badge: String(count),
      state: 'group',
      category: sid,
      active: entry.members.some((m) => m.active === true) || undefined,
      meta: { group: entry.group.id },
    });
  }
  return { nodes: out, edges: rerouteEdges(edges, (id) => standIn.get(id) ?? id), groups: found };
}

/** Maps each edge's ends through `to`, drops an edge whose ends meet, and keeps the first edge of each pair. */
function rerouteEdges(edges: readonly DagEdge[], to: (id: string) => string): DagEdge[] {
  const seen = new Set<string>();
  const out: DagEdge[] = [];
  for (const e of edges) {
    const from = to(e.from);
    const target = to(e.to);
    if (from === target && (from !== e.from || target !== e.to)) continue;
    const key = `${from}\u0000${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(from === e.from && target === e.to ? e : { ...e, from, to: target });
  }
  return out;
}

/**
 * layoutDag with groups. A collapsed group is one node (see collapseGroups).
 * An expanded group lays its members out as a graph of their own, inside a
 * box with a header. The rest of the graph treats the box as one node, so an
 * edge to a member ends at the box. Each placed edge keeps the input edge it
 * came from.
 */
export function layoutGrouped(
  nodes: readonly DagNode[],
  edges: readonly DagEdge[],
  groups: readonly DagGroup[],
  isCollapsed: (group: DagGroup) => boolean = (g) => g.collapsed === true,
  opts: DagLayoutOptions = {},
): DagLayout {
  const flat = collapseGroups(nodes, edges, groups, isCollapsed);
  if (flat.groups.length === 0) return layoutDag(nodes, edges, opts);
  const open = flat.groups.filter((g) => !g.collapsed);
  if (open.length === 0) {
    const plain = layoutDag(flat.nodes, flat.edges, opts);
    const placed: PlacedGroup[] = [];
    for (const g of flat.groups) {
      const p = plain.nodes[plain.byId.get(groupNodeId(g.group.id)) ?? -1];
      if (p === undefined) continue;
      const label = groupLabel(g.group, g.members.length);
      placed.push({ id: g.group.id, label, collapsed: true, members: g.members, nodeId: groupNodeId(g.group.id), x: p.x, y: p.y, w: p.w, h: p.h, header: 0 });
    }
    // A stand-in carries a rerouted edge. Each placed edge still names the input edge it stands for.
    const inputOf = new Map<string, DagEdge>();
    const standIn = new Map<string, string>();
    for (const g of flat.groups) for (const m of g.members) standIn.set(m.id, groupNodeId(g.group.id));
    for (const e of edges) {
      const key = `${standIn.get(e.from) ?? e.from}\u0000${standIn.get(e.to) ?? e.to}`;
      if (!inputOf.has(key)) inputOf.set(key, e);
    }
    return {
      ...plain,
      edges: plain.edges.map((e) => ({ ...e, edge: inputOf.get(`${e.edge.from}\u0000${e.edge.to}`) ?? e.edge })),
      groups: placed,
    };
  }
  const sizeOf = opts.sizeOf ?? ((n: DagNode): NodeSize => measureNode(n));
  const memberGroup = new Map<string, string>();
  for (const g of open) for (const m of g.members) memberGroup.set(m.id, groupNodeId(g.group.id));
  const subs = new Map<string, DagLayout>();
  for (const g of open) {
    const ids = new Set(g.members.map((m) => m.id));
    const inner = flat.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    subs.set(groupNodeId(g.group.id), layoutDag(g.members, inner, opts));
  }
  const holderSize = new Map<string, NodeSize>();
  for (const g of open) {
    const id = groupNodeId(g.group.id);
    const sub = subs.get(id)!;
    // The header text must fit too, so a group of one narrow node still names itself.
    const head = sizeOf({ id, label: groupHeaderText(groupLabel(g.group, g.members.length), g.members.length) }, -1);
    holderSize.set(id, { w: Math.max(sub.width + 2 * GROUP_PAD, head.w), h: sub.height + GROUP_HEADER + GROUP_PAD });
  }

  // The outer graph: a holder node in place of each expanded group's first member.
  const outerNodes: DagNode[] = [];
  const holderPlaced = new Set<string>();
  for (const n of flat.nodes) {
    const hid = memberGroup.get(n.id);
    if (hid === undefined) {
      outerNodes.push(n);
    } else if (!holderPlaced.has(hid)) {
      holderPlaced.add(hid);
      outerNodes.push({ id: hid });
    }
  }
  const origin = new Map<DagEdge, DagEdge[]>();
  const outerEdges: DagEdge[] = [];
  {
    const seen = new Map<string, DagEdge>();
    for (const e of flat.edges) {
      const from = memberGroup.get(e.from) ?? e.from;
      const to = memberGroup.get(e.to) ?? e.to;
      if (from === to && (from !== e.from || to !== e.to)) continue;
      const key = `${from}\u0000${to}`;
      const shared = seen.get(key);
      if (shared !== undefined) {
        origin.get(shared)!.push(e);
        continue;
      }
      const outer = from === e.from && to === e.to ? e : { ...e, from, to };
      seen.set(key, outer);
      origin.set(outer, [e]);
      outerEdges.push(outer);
    }
  }
  const outer = layoutDag(outerNodes, outerEdges, {
    ...opts,
    sizeOf: (n, idx) => holderSize.get(n.id) ?? sizeOf(n, idx),
  });

  const allNodes: PlacedNode[] = [];
  const placedGroups: PlacedGroup[] = [];
  const subEdges: PlacedEdge[] = [];
  const subStart = new Map<string, number>();
  for (const p of outer.nodes) {
    const sub = subs.get(p.node.id);
    if (sub === undefined) {
      allNodes.push({ ...p, index: allNodes.length });
      continue;
    }
    const dx = p.x + GROUP_PAD;
    const dy = p.y + GROUP_HEADER;
    const start = allNodes.length;
    subStart.set(p.node.id, start);
    for (const m of sub.nodes) allNodes.push({ ...m, index: allNodes.length, x: m.x + dx, y: m.y + dy });
    for (const e of sub.edges) {
      subEdges.push({
        ...e,
        from: e.from + start,
        to: e.to + start,
        points: e.points.map((q) => ({ x: q.x + dx, y: q.y + dy })),
      });
    }
  }
  const byId = new Map<string, number>();
  allNodes.forEach((p, idx) => byId.set(p.node.id, idx));

  for (const g of flat.groups) {
    const id = groupNodeId(g.group.id);
    const label = groupLabel(g.group, g.members.length);
    if (g.collapsed) {
      const idx = byId.get(id);
      if (idx === undefined) continue;
      const p = allNodes[idx];
      placedGroups.push({ id: g.group.id, label, collapsed: true, members: g.members, nodeId: id, x: p.x, y: p.y, w: p.w, h: p.h, header: 0 });
      continue;
    }
    const holder = outer.nodes[outer.byId.get(id) ?? -1];
    if (holder === undefined) continue;
    placedGroups.push({
      id: g.group.id,
      label,
      collapsed: false,
      members: g.members,
      nodeId: id,
      x: holder.x,
      y: holder.y,
      w: holder.w,
      h: holder.h,
      header: GROUP_HEADER,
    });
  }

  // Edges into one expanded group share one route to its box.
  const placedEdges: PlacedEdge[] = [];
  for (const e of outer.edges) {
    for (const input of origin.get(e.edge) ?? [e.edge]) {
      const from = byId.get(input.from) ?? byId.get(e.edge.from) ?? -1;
      const to = byId.get(input.to) ?? byId.get(e.edge.to) ?? -1;
      placedEdges.push({ ...e, edge: input, from, to, index: placedEdges.length });
    }
  }
  for (const e of subEdges) placedEdges.push({ ...e, index: placedEdges.length });
  const cycleEdges: number[] = [];
  placedEdges.forEach((e, idx) => {
    if (e.reversed) cycleEdges.push(idx);
  });
  let crossings = outer.crossings;
  const ignoredPins = [...outer.ignoredPins];
  const rejected = [...outer.rejected];
  for (const sub of subs.values()) {
    crossings += sub.crossings;
    ignoredPins.push(...sub.ignoredPins);
    rejected.push(...sub.rejected);
  }
  return {
    nodes: allNodes,
    edges: placedEdges,
    byId,
    width: outer.width,
    height: outer.height,
    orientation: outer.orientation,
    crossings,
    cycleEdges,
    rejected,
    ignoredPins,
    groups: placedGroups,
  };
}

/** The expanded group whose header strip holds the world point, or null. */
export function hitTestGroupHeader(layout: DagLayout, wx: number, wy: number): PlacedGroup | null {
  for (const g of layout.groups ?? []) {
    if (g.collapsed) continue;
    if (wx >= g.x && wx <= g.x + g.w && wy >= g.y && wy <= g.y + g.header) return g;
  }
  return null;
}

/** The group a stand-in node id stands for, or null when the node is not a stand-in. */
export function groupOfNode(layout: DagLayout, nodeId: string): PlacedGroup | null {
  for (const g of layout.groups ?? []) if (g.collapsed && g.nodeId === nodeId) return g;
  return null;
}

/** True when the lower-case query is in a member's id, label or sublabel. Search uses it to light up a collapsed group. */
export function groupMatches(group: PlacedGroup, query: string): boolean {
  if (query === '') return false;
  return group.members.some((m) => `${m.id} ${m.label ?? ''} ${m.sublabel ?? ''}`.toLowerCase().includes(query));
}

// -- Wheel source --------------------------------------------------------------------

/** What sent a wheel event: a notched mouse wheel, or a trackpad's two-finger scroll. */
export type WheelSource = 'mouse' | 'trackpad';

/** The part of a WheelEvent the classifier reads. */
export interface WheelSample {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  /** ms, from the event's timeStamp. */
  time: number;
}

/** A gap longer than this starts a new gesture, which is classified afresh. */
export const WHEEL_BURST_GAP_MS = 300;
/** An integer pixel delta this large, with no sideways part, is a wheel notch. */
export const WHEEL_NOTCH_PX = 40;

/** What the classifier remembers between events: the source of the current gesture. */
export interface WheelState {
  source: WheelSource | null;
  lastTime: number;
  lastAbsY: number;
}

export function newWheelState(): WheelState {
  return { source: null, lastTime: -Infinity, lastAbsY: 0 };
}

/**
 * Guesses whether a wheel event came from a mouse wheel or a trackpad. It is
 * a heuristic, because a browser reports both as the same event. A gesture
 * keeps the source its first telling event gave it, so one burst never flips
 * between panning and passing through. Mouse: a line or page delta, a large
 * integer delta, or the same large delta again. Trackpad: a sideways part or
 * a fractional delta. A small integer delta that says neither is a trackpad,
 * because a mouse notch is never that small in pixels.
 */
export function classifyWheelSource(state: WheelState, e: WheelSample): { state: WheelState; source: WheelSource } {
  const fresh = e.time - state.lastTime > WHEEL_BURST_GAP_MS;
  const absY = Math.abs(e.deltaY);
  let source = fresh ? null : state.source;
  if (source === null) {
    if (e.deltaMode !== 0) source = 'mouse';
    else if (e.deltaX !== 0 || !Number.isInteger(e.deltaY)) source = 'trackpad';
    else if (absY >= WHEEL_NOTCH_PX) source = 'mouse';
    else if (!fresh && absY > 0 && absY === state.lastAbsY && absY >= WHEEL_NOTCH_PX / 2) source = 'mouse';
    else source = 'trackpad';
  }
  return { state: { source, lastTime: e.time, lastAbsY: absY }, source };
}
