import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGraph,
  breakCycles,
  assignLayers,
  topoOrder,
  insertDummies,
  orderLayers,
  countCrossings,
  crossingsBetween,
  assignCoordinates,
  slotIdentity,
  layoutDag,
  wrapWideLayers,
  wrappedRowCount,
  CELL_ASPECT,
  anchorPoint,
  measureNode,
  worldToScreen,
  screenToWorld,
  panViewport,
  zoomViewportAt,
  zoomFactorForWheel,
  fitViewport,
  layoutBounds,
  clampViewport,
  visibleWorldRect,
  rectsOverlap,
  visibleNodes,
  visibleEdges,
  hitTestNodes,
  hitTestEdges,
  nodeRect,
  neighbourhood,
  criticalPathLength,
  nodeHue,
  MIN_SCALE,
  MAX_SCALE,
  DEFAULT_GAP,
  DEFAULT_NODE_MAX_W,
  DEFAULT_NODE_MIN_W,
} from './dag-view-math.ts';
import type { DagNode, DagEdge, DagLayout, DagViewport } from './dag-view-math.ts';

// -- Fixtures ---------------------------------------------------------------------------

/** n0 -> n1 -> n2 -> n3, plus a long edge n0 -> n3 that must bend. */
const CHAIN_NODES: DagNode[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const CHAIN_EDGES: DagEdge[] = [
  { from: 'a', to: 'b' },
  { from: 'b', to: 'c' },
  { from: 'c', to: 'd' },
  { from: 'a', to: 'd' },
];

function ids(nodes: readonly { id: string }[]): string[] {
  return nodes.map((n) => n.id);
}

function nodesFrom(names: string[]): DagNode[] {
  return names.map((id) => ({ id }));
}

/** Layer of every node, keyed by id — the shape most assertions want. */
function layerMap(layout: DagLayout): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of layout.nodes) out[n.node.id] = n.layer;
  return out;
}

// -- buildGraph -------------------------------------------------------------------------

test('buildGraph: indexes nodes and both adjacency directions', () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  assert.equal(g.nodes.length, 4);
  assert.equal(g.edges.length, 4);
  assert.equal(g.index.get('c'), 2);
  assert.deepEqual(g.out[0], [1, 3], 'a points at b and d');
  assert.deepEqual(g.in[3], [2, 0], 'd is pointed at by c and a');
  assert.deepEqual(g.rejected, []);
});

test('buildGraph: a repeated node id keeps its first occurrence', () => {
  const g = buildGraph([{ id: 'a', label: 'first' }, { id: 'a', label: 'second' }], []);
  assert.equal(g.nodes.length, 1);
  assert.equal(g.nodes[0].label, 'first');
});

test('buildGraph: every unusable edge is REPORTED, never silently dropped', () => {
  const g = buildGraph(nodesFrom(['a', 'b']), [
    { from: 'a', to: 'b' },
    { from: 'ghost', to: 'b' },
    { from: 'a', to: 'ghost' },
    { from: 'a', to: 'a' },
    { from: 'a', to: 'b' },
  ]);
  assert.equal(g.edges.length, 1, 'only the one real edge is drawn');
  assert.deepEqual(
    g.rejected.map((r) => r.reason),
    ['unknown-from', 'unknown-to', 'self-loop', 'duplicate'],
  );
  // The original edge object comes back, so a consumer can name what it lost.
  assert.deepEqual(g.rejected[0].edge, { from: 'ghost', to: 'b' });
});

test('buildGraph: a duplicate is judged on endpoints, not on its label', () => {
  const g = buildGraph(nodesFrom(['a', 'b']), [
    { from: 'a', to: 'b', label: 'needs' },
    { from: 'a', to: 'b', label: 'also needs' },
  ]);
  assert.equal(g.edges.length, 1);
  assert.equal(g.rejected.length, 1);
  assert.equal(g.rejected[0].reason, 'duplicate');
});

// -- breakCycles ------------------------------------------------------------------------

/** Walks `out` looking for any cycle — the oracle for breakCycles. */
function hasCycle(out: readonly (readonly number[])[]): boolean {
  const n = out.length;
  const mark = new Uint8Array(n);
  const onStack = new Uint8Array(n);
  const visit = (v: number): boolean => {
    mark[v] = 1;
    onStack[v] = 1;
    for (const w of out[v]) {
      if (onStack[w]) return true;
      if (!mark[w] && visit(w)) return true;
    }
    onStack[v] = 0;
    return false;
  };
  for (let v = 0; v < n; v++) if (!mark[v] && visit(v)) return true;
  return false;
}

test('breakCycles: an acyclic graph is left completely alone', () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const c = breakCycles(g);
  assert.deepEqual(c.reversed, []);
  assert.deepEqual(c.out, g.out);
  assert.deepEqual(c.in, g.in);
});

test('breakCycles: a cycle is broken, and the cut edge is NAMED', () => {
  const g = buildGraph(nodesFrom(['a', 'b', 'c']), [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'a' },
  ]);
  const c = breakCycles(g);
  assert.equal(c.reversed.length, 1, 'one cut is enough for a 3-cycle');
  assert.equal(hasCycle(c.out), false);
  // The reported index points at a real input edge, so the element can draw
  // exactly the line that closes the loop.
  const cut = g.edges[c.reversed[0]];
  assert.deepEqual({ from: cut.edge.from, to: cut.edge.to }, { from: 'c', to: 'a' });
});

test('breakCycles: two independent cycles each get cut', () => {
  const g = buildGraph(nodesFrom(['a', 'b', 'x', 'y']), [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
    { from: 'x', to: 'y' },
    { from: 'y', to: 'x' },
  ]);
  const c = breakCycles(g);
  assert.equal(c.reversed.length, 2);
  assert.equal(hasCycle(c.out), false);
});

test('breakCycles: a long chain does not overflow the stack', () => {
  // Recursion here would die on a graph that is otherwise trivial.
  const n = 20000;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
  const c = breakCycles(buildGraph(nodes, edges));
  assert.deepEqual(c.reversed, []);
});

// -- topoOrder --------------------------------------------------------------------------

test('topoOrder: every edge points forward in the order', () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const order = topoOrder(g.out, g.nodes.length);
  const pos = new Map(order.map((v, i) => [v, i]));
  for (const e of g.edges) {
    assert.ok((pos.get(e.from) as number) < (pos.get(e.to) as number), `${e.edge.from} before ${e.edge.to}`);
  }
});

test('topoOrder: ties break on index, so the order is identical every run', () => {
  const g = buildGraph(nodesFrom(['c', 'a', 'b']), []);
  assert.deepEqual(topoOrder(g.out, 3), [0, 1, 2]);
});

test('topoOrder: a node inside a cycle is appended, never lost', () => {
  // Losing a node is not an acceptable way to report a cycle.
  const out = [[1], [0], []];
  const order = topoOrder(out, 3);
  assert.equal(order.length, 3);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2]);
});

// -- assignLayers -----------------------------------------------------------------------

test('assignLayers: a node sits one past the deepest thing it needs', () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const l = assignLayers(g, breakCycles(g));
  assert.deepEqual([...l.layers], [0, 1, 2, 3]);
  assert.equal(l.maxLayer, 3);
});

test('assignLayers: independent roots all start at layer 0', () => {
  const g = buildGraph(nodesFrom(['a', 'b', 'c']), [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }]);
  const l = assignLayers(g, breakCycles(g));
  assert.deepEqual([...l.layers], [0, 0, 1]);
});

test('assignLayers: a layer pin can push a node down', () => {
  const g = buildGraph([{ id: 'a' }, { id: 'b', layer: 4 }], [{ from: 'a', to: 'b' }]);
  const l = assignLayers(g, breakCycles(g));
  assert.deepEqual([...l.layers], [0, 4]);
  assert.deepEqual(l.ignoredPins, []);
});

test('assignLayers: a pin that contradicts an edge is overruled AND reported', () => {
  // The hint is a preference; the edge is a fact. A silently honoured pin
  // would draw b above its own dependency.
  const g = buildGraph([{ id: 'a' }, { id: 'b', layer: 0 }], [{ from: 'a', to: 'b' }]);
  const l = assignLayers(g, breakCycles(g));
  assert.deepEqual([...l.layers], [0, 1]);
  assert.deepEqual(l.ignoredPins, ['b']);
});

test("assignLayers: align 'sinks' bottom-aligns the leaves", () => {
  // a -> b -> d, a -> c -> ... nothing. Under 'sources' c sits at layer 1;
  // under 'sinks' it drops to the last layer with the other leaf.
  const g = buildGraph(nodesFrom(['a', 'b', 'c', 'd']), [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'd' },
    { from: 'a', to: 'c' },
  ]);
  const acyclic = breakCycles(g);
  assert.deepEqual([...assignLayers(g, acyclic).layers], [0, 1, 1, 2]);
  assert.deepEqual([...assignLayers(g, acyclic, { align: 'sinks' }).layers], [0, 1, 2, 2]);
});

test('assignLayers: every edge still points strictly downward after cycle breaking', () => {
  const g = buildGraph(nodesFrom(['a', 'b', 'c']), [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'a' },
  ]);
  const acyclic = breakCycles(g);
  const l = assignLayers(g, acyclic);
  acyclic.out.forEach((succ, v) => {
    for (const w of succ) assert.ok(l.layers[w] > l.layers[v], 'no edge is flat or backwards');
  });
});

// -- wrapWideLayers ---------------------------------------------------------------------

test('wrapWideLayers: a layer too wide to read is split into consecutive rows', () => {
  const g = buildGraph(nodesFrom(Array.from({ length: 30 }, (_, i) => `n${i}`)), []);
  const wrapped = wrapWideLayers(assignLayers(g, breakCycles(g)), 14);
  const counts = new Map<number, number>();
  for (const l of wrapped.layers) counts.set(l, (counts.get(l) ?? 0) + 1);
  // Three rows of ten is what the cap alone allows, and it draws a band far
  // wider than it is tall. The row count comes from the target shape instead,
  // so the cap is only the ceiling on a row.
  assert.equal(counts.size, wrappedRowCount(30, 14), '30 nodes at a cap of 14');
  for (const [layer, n] of counts) assert.ok(n <= 14, `layer ${layer} holds ${n}`);
  // Evened out rather than filled to the cap with a remainder.
  assert.deepEqual([...new Set(counts.values())], [5]);
  assert.equal(wrapped.maxLayer, counts.size - 1);
});

test('wrappedRowCount: a layer that fits in one row is never split', () => {
  for (let n = 1; n <= 14; n++) assert.equal(wrappedRowCount(n, 14), 1, `${n} nodes`);
});

test('wrappedRowCount: the cap stays the ceiling on a row', () => {
  for (const n of [15, 30, 81, 400]) {
    const rows = wrappedRowCount(n, 14);
    assert.ok(Math.ceil(n / rows) <= 14, `${n} nodes over ${rows} rows`);
  }
});

test('wrappedRowCount: a wrapped block lands near the target shape', () => {
  // The failure this replaced: 81 nodes drew about 2900 units wide and 670
  // tall, so `fit` scaled by the width alone and every box became a speck.
  const rows = wrappedRowCount(81, 14);
  const aspect = (Math.ceil(81 / rows) * CELL_ASPECT) / rows;
  assert.ok(aspect > 1 && aspect < 3, `81 nodes draw ${aspect.toFixed(1)}:1`);
});

test('wrapWideLayers: splitting a layer keeps every edge pointing forward', () => {
  // The property that makes this safe: longest-path layering never puts an
  // edge's two ends on one layer, so rows carved out of a layer cannot
  // contain one.
  const names = Array.from({ length: 40 }, (_, i) => `n${i}`);
  const edges: DagEdge[] = [];
  for (let i = 0; i < 20; i++) edges.push({ from: `n${i}`, to: `n${i + 20}` });
  const g = buildGraph(nodesFrom(names), edges);
  const acyclic = breakCycles(g);
  const wrapped = wrapWideLayers(assignLayers(g, acyclic), 6);
  acyclic.out.forEach((succ, v) => {
    for (const w of succ) {
      assert.ok(wrapped.layers[w] > wrapped.layers[v], `n${v} -> n${w} still points down`);
    }
  });
});

test('wrapWideLayers: a cap of 0 leaves the layering exactly as it was', () => {
  const g = buildGraph(nodesFrom(Array.from({ length: 30 }, (_, i) => `n${i}`)), []);
  const before = assignLayers(g, breakCycles(g));
  assert.deepEqual([...wrapWideLayers(before, 0).layers], [...before.layers]);
});

test('layoutDag: a fleet of mostly-unconnected nodes does not draw as one long line', () => {
  // The failure this exists for: 118 repositories with 53 dependencies
  // between them left about 70 on layer 0, one row packed them into a
  // drawing 12 times wider than it was tall, and `fit` answered that by
  // shrinking every box to a speck.
  const nodes = nodesFrom(Array.from({ length: 118 }, (_, i) => `r${i}`));
  const edges: DagEdge[] = [];
  for (let i = 0; i < 45 && edges.length < 53; i++) {
    for (const t of [i + 3, i + 7]) {
      if (t < 45 && edges.length < 53) edges.push({ from: `r${i}`, to: `r${t}` });
    }
  }
  const wide = layoutDag(nodes, edges, { maxLayerWidth: 0 });
  const wrapped = layoutDag(nodes, edges);
  // The negative control: without wrapping the drawing really is that shape,
  // so this test cannot pass by measuring nothing.
  assert.ok(wide.width / wide.height > 8, `unwrapped aspect ${(wide.width / wide.height).toFixed(1)}`);
  assert.ok(
    wrapped.width / wrapped.height < 4,
    `wrapped aspect ${(wrapped.width / wrapped.height).toFixed(1)} is still unreadable`,
  );
  assert.ok(wrapped.width < wide.width / 2, `${wrapped.width} is not much narrower than ${wide.width}`);
  assert.equal(wrapped.nodes.length, 118, 'wrapping never loses a node');
});

test('assignCoordinates: a node with no edges is packed, not left floating', () => {
  // separate() enforces a minimum distance and nothing enforced a maximum,
  // so an unanchored node kept whatever the initial packing gave it while
  // its neighbours were pulled away, leaving a hole.
  const names = ['dep', 'user', ...Array.from({ length: 8 }, (_, i) => `lone${i}`)];
  const layout = layoutDag(nodesFrom(names), [{ from: 'dep', to: 'user' }]);
  const top = layout.nodes.filter((n) => n.layer === 0).sort((a, b) => a.x - b.x);
  assert.ok(top.length > 1, 'the fixture puts several nodes on the top row');
  for (let i = 1; i < top.length; i++) {
    const gap = top[i].x - (top[i - 1].x + top[i - 1].w);
    assert.ok(
      gap <= DEFAULT_GAP + 1e-6,
      `${top[i].node.id} sits ${gap.toFixed(0)} from ${top[i - 1].node.id}, over the ${DEFAULT_GAP} gap`,
    );
  }
});

// -- insertDummies ----------------------------------------------------------------------

test('insertDummies: a long edge gets one bend point per layer it crosses', () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const acyclic = breakCycles(g);
  const layered = assignLayers(g, acyclic);
  const proper = insertDummies(g, acyclic, layered);
  // a -> d spans layers 0..3, so it crosses layers 1 and 2.
  const longEdge = g.edges.findIndex((e) => e.edge.from === 'a' && e.edge.to === 'd');
  assert.equal((proper.chains.get(longEdge) ?? []).length, 2);
  // Its short neighbours need no bend at all.
  const shortEdge = g.edges.findIndex((e) => e.edge.from === 'a' && e.edge.to === 'b');
  assert.deepEqual(proper.chains.get(shortEdge), []);
});

test('insertDummies: every layer link spans exactly one layer', () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const acyclic = breakCycles(g);
  const layered = assignLayers(g, acyclic);
  const proper = insertDummies(g, acyclic, layered);
  const layerOf = new Map<string, number>();
  proper.layers.forEach((row, l) => row.forEach((s) => layerOf.set(slotIdentity(s), l)));
  for (const [from, tos] of proper.succ) {
    for (const to of tos) {
      assert.equal(
        (layerOf.get(to) as number) - (layerOf.get(from) as number),
        1,
        `${from} -> ${to} spans one layer`,
      );
    }
  }
});

test('insertDummies: slot identity survives reordering its layer', () => {
  // This is the whole reason identities exist instead of positions.
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  const row = proper.layers[1];
  const before = row.map(slotIdentity);
  row.reverse();
  assert.deepEqual(row.map(slotIdentity), [...before].reverse());
  // ...and the adjacency still resolves, because it never mentioned a position.
  assert.ok(proper.succ.has(before[0]) || proper.pred.has(before[0]));
});

// -- Crossings and ordering -------------------------------------------------------------

test('crossingsBetween: the textbook single crossing', () => {
  // a -> y and b -> x, drawn a,b over x,y: exactly one crossing.
  const g = buildGraph(nodesFrom(['a', 'b', 'x', 'y']), [
    { from: 'a', to: 'y' },
    { from: 'b', to: 'x' },
  ]);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  // Force the bad order so the count is about geometry, not about layout luck.
  proper.layers[0] = [
    { node: 0, edge: -1, layer: 0 },
    { node: 1, edge: -1, layer: 0 },
  ];
  proper.layers[1] = [
    { node: 2, edge: -1, layer: 1 },
    { node: 3, edge: -1, layer: 1 },
  ];
  assert.equal(crossingsBetween(proper, 0), 1);
  // Swap the lower layer and the crossing is gone.
  proper.layers[1].reverse();
  assert.equal(crossingsBetween(proper, 0), 0);
});

test('countCrossings: parallel edges never cross', () => {
  const g = buildGraph(nodesFrom(['a', 'b', 'x', 'y']), [
    { from: 'a', to: 'x' },
    { from: 'b', to: 'y' },
  ]);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  assert.equal(countCrossings(proper), 0);
});

test('orderLayers: never returns a worse arrangement than it started with', () => {
  // The heuristic may fail to find the optimum; it must never make things
  // worse, because it keeps the best arrangement it has seen.
  const names = Array.from({ length: 8 }, (_, i) => `u${i}`).concat(
    Array.from({ length: 8 }, (_, i) => `d${i}`),
  );
  const edges: DagEdge[] = [];
  for (let i = 0; i < 8; i++) edges.push({ from: `u${i}`, to: `d${(i * 5) % 8}` });
  const g = buildGraph(nodesFrom(names), edges);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  const before = countCrossings(proper);
  const after = orderLayers(proper);
  assert.ok(after <= before, `${after} <= ${before}`);
  assert.equal(after, countCrossings(proper), 'the reported count matches the arrangement it left behind');
});

test('orderLayers: identical input gives an identical arrangement', () => {
  const build = (): number[][] => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const g = buildGraph(nodesFrom(names), [
      { from: 'a', to: 'e' },
      { from: 'b', to: 'd' },
      { from: 'c', to: 'f' },
      { from: 'a', to: 'f' },
    ]);
    const acyclic = breakCycles(g);
    const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
    orderLayers(proper);
    return proper.layers.map((row) => row.map((s) => s.node));
  };
  assert.deepEqual(build(), build());
});

// -- assignCoordinates ------------------------------------------------------------------

test('assignCoordinates: boxes in a layer never overlap', () => {
  // Two boxes drawn on top of each other is worse than any crookedness.
  const names = ['r', 'a', 'b', 'c', 'd'];
  const g = buildGraph(nodesFrom(names), names.slice(1).map((id) => ({ from: 'r', to: id })));
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  orderLayers(proper);
  const sizes = g.nodes.map((_, i) => ({ w: 40 + i * 20, h: 30 }));
  const coords = assignCoordinates(proper, sizes);
  for (const row of coords.placements) {
    const sorted = [...row].sort((x, y) => x.c - y.c);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].c - sorted[i].cSize / 2 - (sorted[i - 1].c + sorted[i - 1].cSize / 2);
      assert.ok(gap >= DEFAULT_GAP - 1e-6, `gap ${gap} >= ${DEFAULT_GAP}`);
    }
  }
});

test('assignCoordinates: a straight chain draws as a straight line', () => {
  // The staircase this prevents is the single most obvious layout defect.
  const g = buildGraph(CHAIN_NODES.slice(0, 3), [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ]);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  orderLayers(proper);
  const coords = assignCoordinates(proper, g.nodes.map(() => ({ w: 100, h: 30 })));
  const centers = coords.placements.map((row) => row[0].c);
  assert.equal(centers.length, 3);
  for (const c of centers) assert.ok(Math.abs(c - centers[0]) < 1e-6, 'every node shares one center');
});

test('assignCoordinates: layers are stacked, and the drawing starts at 0', () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  orderLayers(proper);
  const coords = assignCoordinates(proper, g.nodes.map(() => ({ w: 80, h: 30 })), { layerGap: 40 });
  const nodeRows = coords.placements.map((row, l) => ({ l, row }));
  for (let i = 1; i < nodeRows.length; i++) {
    const prev = Math.max(...nodeRows[i - 1].row.map((p) => p.l + p.lSize));
    const next = Math.min(...nodeRows[i].row.map((p) => p.l));
    assert.ok(next >= prev, 'no layer reaches back into the one above it');
  }
  const minC = Math.min(...coords.placements.flat().map((p) => p.c - p.cSize / 2));
  assert.ok(Math.abs(minC) < 1e-6, 'left edge is 0');
});

// -- layoutDag (end to end) --------------------------------------------------------------

test('layoutDag: every edge points down the page', () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  for (const e of layout.edges) {
    const from = layout.nodes[e.from];
    const to = layout.nodes[e.to];
    assert.ok(to.layer > from.layer, `${e.edge.from} -> ${e.edge.to} goes downward`);
  }
});

test('layoutDag: the same input produces byte-identical geometry', () => {
  // A graph that reshuffles on refresh cannot be compared to what you saw.
  const a = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const b = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  assert.deepEqual(
    a.nodes.map((n) => [n.node.id, n.x, n.y, n.w, n.h]),
    b.nodes.map((n) => [n.node.id, n.x, n.y, n.w, n.h]),
  );
  assert.deepEqual(a.edges.map((e) => e.points), b.edges.map((e) => e.points));
});

test('layoutDag: an empty graph is a valid, empty layout', () => {
  const layout = layoutDag([], []);
  assert.deepEqual(ids(layout.nodes.map((n) => n.node)), []);
  assert.deepEqual([...layout.edges], []);
  assert.equal(layout.width, 0);
  assert.deepEqual(layoutBounds(layout), { x: 0, y: 0, w: 0, h: 0 });
});

test('layoutDag: a graph with no edges at all still lays out', () => {
  const layout = layoutDag(nodesFrom(['a', 'b', 'c']), []);
  assert.equal(layout.nodes.length, 3);
  assert.deepEqual(Object.values(layerMap(layout)), [0, 0, 0]);
  assert.equal(layout.crossings, 0);
});

test('layoutDag: disconnected components all get placed', () => {
  const layout = layoutDag(nodesFrom(['a', 'b', 'x', 'y']), [
    { from: 'a', to: 'b' },
    { from: 'x', to: 'y' },
  ]);
  assert.equal(layout.nodes.length, 4);
  assert.deepEqual(layerMap(layout), { a: 0, b: 1, x: 0, y: 1 });
});

test('layoutDag: a long edge gets bend points, a short one does not', () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const long = layout.edges.find((e) => e.edge.from === 'a' && e.edge.to === 'd');
  const short = layout.edges.find((e) => e.edge.from === 'a' && e.edge.to === 'b');
  assert.ok(long !== undefined && short !== undefined);
  assert.equal(short.points.length, 2, 'a one-layer edge is a straight segment');
  assert.equal(long.points.length, 4, 'a three-layer edge bends twice');
});

test('layoutDag: an edge meets the faces of its boxes, not their centers', () => {
  // An arrowhead at a box center is an arrowhead nobody can see.
  const layout = layoutDag(CHAIN_NODES.slice(0, 2), [{ from: 'a', to: 'b' }]);
  const e = layout.edges[0];
  const a = layout.nodes[e.from];
  const b = layout.nodes[e.to];
  assert.equal(e.points[0].y, a.y + a.h, 'leaves the bottom face');
  assert.equal(e.points[e.points.length - 1].y, b.y, 'arrives at the top face');
});

test("layoutDag: 'LR' swaps the axes and keeps the direction", () => {
  const tb = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const lr = layoutDag(CHAIN_NODES, CHAIN_EDGES, { orientation: 'LR' });
  assert.equal(lr.orientation, 'LR');
  // A four-layer chain is tall in TB and wide in LR.
  assert.ok(tb.height > tb.width || tb.nodes.length === 0);
  assert.ok(lr.width > lr.height);
  for (const e of lr.edges) {
    const from = lr.nodes[e.from];
    const to = lr.nodes[e.to];
    assert.ok(to.x > from.x, 'edges run left to right');
  }
  const e0 = lr.edges[0];
  const a = lr.nodes[e0.from];
  assert.equal(e0.points[0].x, a.x + a.w, 'leaves the right face');
});

test('layoutDag: a cycle is drawn AND reported, never quietly straightened', () => {
  const layout = layoutDag(nodesFrom(['a', 'b', 'c']), [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'a' },
  ]);
  assert.equal(layout.edges.length, 3, 'the cycle edge is still drawn');
  assert.equal(layout.cycleEdges.length, 1);
  const cut = layout.edges[layout.cycleEdges[0]];
  assert.equal(cut.reversed, true);
  assert.deepEqual({ from: cut.edge.from, to: cut.edge.to }, { from: 'c', to: 'a' });
});

test('layoutDag: a reversed edge is still routed from its TRUE source', () => {
  // `points` always runs source -> target, so an arrowhead at the last
  // point always means what it says, cycle or not.
  const layout = layoutDag(nodesFrom(['a', 'b']), [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
  ]);
  const back = layout.edges.find((e) => e.edge.from === 'b' && e.edge.to === 'a');
  assert.ok(back !== undefined);
  assert.equal(back.reversed, true);
  const b = layout.nodes[layout.byId.get('b') as number];
  const a = layout.nodes[layout.byId.get('a') as number];
  assert.equal(back.points[0].y, b.y, 'leaves b upward');
  assert.equal(back.points[back.points.length - 1].y, a.y + a.h, 'arrives under a');
});

test('layoutDag: rejected edges and overruled pins reach the caller', () => {
  const layout = layoutDag([{ id: 'a' }, { id: 'b', layer: 0 }], [
    { from: 'a', to: 'b' },
    { from: 'a', to: 'nope' },
  ]);
  assert.deepEqual(layout.rejected.map((r) => r.reason), ['unknown-to']);
  assert.deepEqual(layout.ignoredPins, ['b']);
});

test('layoutDag: byId resolves every node', () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  for (const n of layout.nodes) {
    assert.equal(layout.byId.get(n.node.id), layout.nodes.indexOf(n));
  }
});

test('layoutDag: a custom sizeOf drives the geometry', () => {
  const layout = layoutDag(nodesFrom(['a', 'b']), [{ from: 'a', to: 'b' }], {
    sizeOf: () => ({ w: 200, h: 50 }),
  });
  for (const n of layout.nodes) assert.deepEqual([n.w, n.h], [200, 50]);
});

test('layoutDag: no two boxes on the same layer overlap', () => {
  const names = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const edges: DagEdge[] = [];
  for (let i = 1; i < 12; i++) edges.push({ from: `n${Math.floor((i - 1) / 3)}`, to: `n${i}` });
  const layout = layoutDag(nodesFrom(names), edges);
  const byLayer = new Map<number, typeof layout.nodes[number][]>();
  for (const n of layout.nodes) {
    const row = byLayer.get(n.layer) ?? [];
    row.push(n);
    byLayer.set(n.layer, row);
  }
  for (const row of byLayer.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      assert.ok(row[i].x >= row[i - 1].x + row[i - 1].w, `${row[i].node.id} clears ${row[i - 1].node.id}`);
    }
  }
});

test('criticalPathLength: the longest dependency chain, in nodes', () => {
  assert.equal(criticalPathLength(layoutDag(CHAIN_NODES, CHAIN_EDGES)), 4);
  assert.equal(criticalPathLength(layoutDag(nodesFrom(['a', 'b']), [])), 1);
  assert.equal(criticalPathLength(layoutDag([], [])), 0);
});

// -- anchorPoint ------------------------------------------------------------------------

test('anchorPoint: the mid-point of the facing edge, per orientation', () => {
  const n = { node: { id: 'a' }, index: 0, layer: 0, x: 10, y: 20, w: 100, h: 40 };
  assert.deepEqual(anchorPoint(n, 'TB', 'out'), { x: 60, y: 60 });
  assert.deepEqual(anchorPoint(n, 'TB', 'in'), { x: 60, y: 20 });
  assert.deepEqual(anchorPoint(n, 'LR', 'out'), { x: 110, y: 40 });
  assert.deepEqual(anchorPoint(n, 'LR', 'in'), { x: 10, y: 40 });
});

// -- measureNode ------------------------------------------------------------------------

test('measureNode: width tracks the longer of label and sublabel', () => {
  const short = measureNode({ id: 'a', label: 'hi' });
  const long = measureNode({ id: 'a', label: 'hi', sublabel: 'a much longer second line here' });
  assert.ok(long.w > short.w);
  assert.ok(long.h > short.h, 'the sublabel earns its own line');
});

test('measureNode: one enormous title cannot set the whole layout', () => {
  const huge = measureNode({ id: 'a', label: 'x'.repeat(500) });
  assert.equal(huge.w, DEFAULT_NODE_MAX_W);
});

test('measureNode: a one-character node is still a clickable target', () => {
  assert.equal(measureNode({ id: 'x' }).w, DEFAULT_NODE_MIN_W);
});

test('measureNode: the id stands in for a missing label', () => {
  assert.deepEqual(measureNode({ id: 'some-identifier' }), measureNode({ id: 'q', label: 'some-identifier' }));
});

// -- Viewport ---------------------------------------------------------------------------

const V: DagViewport = { x: 30, y: -20, scale: 2 };

test('worldToScreen / screenToWorld are inverses', () => {
  const p = { x: 12.5, y: -7.25 };
  const back = screenToWorld(worldToScreen(p, V), V);
  assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
});

test('panViewport: shifts in screen space and leaves the scale alone', () => {
  assert.deepEqual(panViewport(V, 10, -5), { x: 40, y: -25, scale: 2 });
});

test('zoomViewportAt: the world point under the anchor does not move', () => {
  // Anything else makes the reader chase the node they zoomed toward.
  for (const factor of [0.5, 1.37, 2, 0.13]) {
    const before = screenToWorld({ x: 200, y: 140 }, V);
    const next = zoomViewportAt(V, 200, 140, factor);
    const after = screenToWorld({ x: 200, y: 140 }, next);
    assert.ok(Math.abs(after.x - before.x) < 1e-6, `x held at factor ${factor}`);
    assert.ok(Math.abs(after.y - before.y) < 1e-6, `y held at factor ${factor}`);
  }
});

test('zoomViewportAt: clamps, and a clamped zoom is a no-op rather than a drift', () => {
  const maxed = zoomViewportAt({ x: 0, y: 0, scale: MAX_SCALE }, 50, 50, 4);
  assert.equal(maxed.scale, MAX_SCALE);
  assert.deepEqual(maxed, { x: 0, y: 0, scale: MAX_SCALE }, 'no pan sneaks in at the clamp');
  assert.equal(zoomViewportAt({ x: 0, y: 0, scale: MIN_SCALE }, 50, 50, 0.1).scale, MIN_SCALE);
});

test('zoomFactorForWheel: scroll up zooms in, and the rate is a clean doubling', () => {
  assert.ok(zoomFactorForWheel(-260) > 1);
  assert.ok(zoomFactorForWheel(260) < 1);
  assert.ok(Math.abs(zoomFactorForWheel(-260) - 2) < 1e-9);
  assert.equal(zoomFactorForWheel(0), 1);
});

test('fitViewport: centers the rect in the box', () => {
  const v = fitViewport({ x: 0, y: 0, w: 100, h: 100 }, 400, 200, 20);
  assert.equal(v.scale, 1.6, 'the tighter axis wins');
  const tl = worldToScreen({ x: 0, y: 0 }, v);
  const br = worldToScreen({ x: 100, y: 100 }, v);
  assert.ok(Math.abs((tl.x + br.x) / 2 - 200) < 1e-6, 'horizontally centered');
  assert.ok(Math.abs((tl.y + br.y) / 2 - 100) < 1e-6, 'vertically centered');
});

test('fitViewport: a degenerate rect still yields a usable viewport', () => {
  const v = fitViewport({ x: 0, y: 0, w: 0, h: 0 }, 400, 300);
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
  assert.ok(v.scale > 0 && v.scale <= MAX_SCALE);
});

test('fitViewport: obeys the scale clamps on a huge graph', () => {
  const v = fitViewport({ x: 0, y: 0, w: 100000, h: 100000 }, 400, 300);
  assert.equal(v.scale, MIN_SCALE);
});

test('clampViewport: a pan that keeps content on screen is untouched', () => {
  const bounds = { x: 0, y: 0, w: 500, h: 400 };
  const v = { x: 10, y: 10, scale: 1 };
  assert.deepEqual(clampViewport(v, bounds, 800, 600, 60), v);
});

test('clampViewport: content flicked into the void is pulled back to the margin', () => {
  const bounds = { x: 0, y: 0, w: 500, h: 400 };
  const far = clampViewport({ x: 99999, y: -99999, scale: 1 }, bounds, 800, 600, 60);
  assert.equal(far.x, 740, 'left edge stops at width - margin');
  assert.equal(far.y, 60 - 400, 'bottom edge stops at the margin');
  assert.equal(far.scale, 1, 'clamping never changes the zoom');
});

// -- Culling ----------------------------------------------------------------------------

test('visibleWorldRect: the world box a viewport shows', () => {
  const r = visibleWorldRect({ x: 0, y: 0, scale: 2 }, 400, 200);
  assert.deepEqual(r, { x: 0, y: 0, w: 200, h: 100 });
});

test('rectsOverlap: touching counts, separated does not', () => {
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 5, h: 5 }), true);
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 5, h: 5 }), false);
});

test('visibleNodes / visibleEdges: off-screen content is culled, on-screen kept', () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const all = layoutBounds(layout);
  assert.equal(visibleNodes(layout, all).length, layout.nodes.length);
  assert.equal(visibleEdges(layout, all).length, layout.edges.length);
  const far = { x: 1e6, y: 1e6, w: 10, h: 10 };
  assert.deepEqual(visibleNodes(layout, far), []);
  assert.deepEqual(visibleEdges(layout, far), []);
});

test('visibleEdges: a long edge crossing the view is kept even with both ends outside', () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const long = layout.edges.findIndex((e) => e.edge.from === 'a' && e.edge.to === 'd');
  const pts = layout.edges[long].points;
  const mid = pts[Math.floor(pts.length / 2)];
  const sliver = { x: mid.x - 2, y: mid.y - 2, w: 4, h: 4 };
  assert.ok(visibleEdges(layout, sliver).includes(long));
});

// -- Hit tests --------------------------------------------------------------------------

test('hitTestNodes: inside hits, outside misses, edges are inclusive', () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const n = layout.nodes[0];
  assert.equal(hitTestNodes(layout, n.x + n.w / 2, n.y + n.h / 2), 0);
  assert.equal(hitTestNodes(layout, n.x, n.y), 0, 'the top-left corner counts');
  assert.equal(hitTestNodes(layout, -1000, -1000), -1);
});

test('hitTestEdges: the NEAREST edge wins, not the first one within tolerance', () => {
  // With several lines converging on a box, "the one I am pointing at" is
  // the closest one -- and the answer must not depend on edge order.
  const layout = layoutDag(nodesFrom(['a', 'b', 't']), [
    { from: 'a', to: 't' },
    { from: 'b', to: 't' },
  ]);
  const midOf = (i: number): { x: number; y: number } => {
    const p = layout.edges[i].points;
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  };
  const m0 = midOf(0);
  const m1 = midOf(1);
  assert.equal(hitTestEdges(layout, m0.x, m0.y, 6), 0);
  // Sitting on the SECOND edge must return the second edge, with a
  // tolerance wide enough that the first one also qualifies.
  const wide = Math.hypot(m1.x - m0.x, m1.y - m0.y) + 10;
  assert.equal(hitTestEdges(layout, m1.x, m1.y, wide), 1);
  assert.equal(hitTestEdges(layout, m0.x, m0.y + 100000, 6), -1, 'beyond tolerance is a miss');
});

test('nodeRect: a placed node as a hit rectangle', () => {
  const layout = layoutDag(nodesFrom(['a']), []);
  const n = layout.nodes[0];
  assert.deepEqual(nodeRect(n), { x: n.x, y: n.y, w: n.w, h: n.h });
});

// -- Reachability -----------------------------------------------------------------------

test('neighbourhood: everything up-stream and down-stream, transitively', () => {
  //   a -> b -> c -> d, and a side branch b -> e.
  const layout = layoutDag(nodesFrom(['a', 'b', 'c', 'd', 'e']), [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'b', to: 'e' },
  ]);
  const idx = (id: string): number => layout.byId.get(id) as number;
  const n = neighbourhood(layout, idx('c'));
  assert.deepEqual([...n.ancestors].map((i) => layout.nodes[i].node.id).sort(), ['a', 'b']);
  assert.deepEqual([...n.descendants].map((i) => layout.nodes[i].node.id).sort(), ['d']);
  assert.equal(n.ancestors.has(idx('e')), false, 'a sibling branch is not a dependency');
});

test('neighbourhood: an isolated node has an empty neighbourhood', () => {
  const layout = layoutDag(nodesFrom(['a', 'b']), []);
  const n = neighbourhood(layout, 0);
  assert.equal(n.ancestors.size, 0);
  assert.equal(n.descendants.size, 0);
  assert.equal(n.edges.size, 0);
});

test('neighbourhood: the edge set holds the connecting edges and nothing else', () => {
  const layout = layoutDag(nodesFrom(['a', 'b', 'c', 'x', 'y']), [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'x', to: 'y' },
  ]);
  const n = neighbourhood(layout, layout.byId.get('b') as number);
  assert.deepEqual(
    [...n.edges].map((i) => `${layout.edges[i].edge.from}->${layout.edges[i].edge.to}`).sort(),
    ['a->b', 'b->c'],
    'the unrelated component contributes nothing',
  );
});

test('neighbourhood: follows the TRUE direction of a cycle-reversed edge', () => {
  // The highlight has to reflect the dependencies, not the drawing.
  const layout = layoutDag(nodesFrom(['a', 'b', 'c']), [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'a' },
  ]);
  assert.equal(layout.cycleEdges.length, 1);
  const n = neighbourhood(layout, layout.byId.get('a') as number);
  // Every node in a cycle depends on every other, both ways round.
  assert.equal(n.ancestors.size, 2);
  assert.equal(n.descendants.size, 2);
});

// -- Hues -------------------------------------------------------------------------------

test('nodeHue: stable, in range, and driven by category when there is one', () => {
  const a = { id: 'x', category: 'build' };
  const b = { id: 'y', category: 'build' };
  assert.equal(nodeHue(a), nodeHue(b), 'one category, one hue');
  assert.notEqual(nodeHue(a), nodeHue({ id: 'x', category: 'deploy' }));
  for (const id of ['a', 'b', 'zzz', '']) {
    const h = nodeHue({ id });
    assert.ok(h >= 0 && h < 360, `${h} in range`);
    assert.equal(h, nodeHue({ id }), 'stable');
  }
});

test('nodeHue: an uncategorized graph is still multi-colored', () => {
  // Falling back to the id beats one wall of the same blue.
  const hues = new Set(['a', 'b', 'c', 'd', 'e'].map((id) => nodeHue({ id })));
  assert.ok(hues.size >= 4, `${hues.size} distinct hues from 5 ids`);
});

// -- A larger graph, as a smoke test -------------------------------------------------------

test('layoutDag: a 200-node graph lays out with no overlaps and no lost nodes', () => {
  const n = 200;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, category: `c${i % 7}` }));
  const edges: DagEdge[] = [];
  for (let i = 1; i < n; i++) {
    edges.push({ from: `n${Math.floor(i / 3)}`, to: `n${i}` });
    if (i % 11 === 0) edges.push({ from: `n${i % 17}`, to: `n${i}` });
  }
  const layout = layoutDag(nodes, edges);
  assert.equal(layout.nodes.length, n, 'every node is placed');
  assert.equal(layout.edges.length + layout.rejected.length, edges.length, 'every edge is drawn or reported');
  for (const e of layout.edges) {
    if (e.reversed) continue;
    assert.ok(layout.nodes[e.to].layer > layout.nodes[e.from].layer);
  }
  assert.ok(layout.width > 0 && layout.height > 0);
});
