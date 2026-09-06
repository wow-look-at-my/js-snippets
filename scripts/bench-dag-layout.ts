// Measures the layout on a REAL captured graph, so a change to the layout is
// judged on the fleet that broke it rather than on a hand-made fixture.
//
// Input is a snapshot from <dag-view>'s own right-click copy. It carries the
// nodes and the edges, which is the layout's whole input -- the coordinates
// in it are the OUTPUT being replaced, and are read only to report what the
// captured run produced.
//
//   node scripts/bench-dag-layout.ts <snapshot.json>
//
// Prints the shape, the wire length and the crossings, plus a per-layer
// breakdown of how much of each row is real boxes and how much is edge
// routing slots.

import { readFileSync } from 'node:fs';
import {
  buildGraph,
  breakCycles,
  assignLayers,
  wrapWideLayers,
  insertDummies,
  orderLayers,
  layoutDag,
  measureNode,
} from '../src/ui/dag-view-math.ts';
import type { DagNode, DagEdge } from '../src/ui/dag-view-math.ts';

interface SnapshotNode {
  id: string;
  label: string;
  sublabel?: string;
  category?: string;
  state?: string;
}
interface SnapshotEdge {
  from: string;
  to: string;
  label?: string | null;
}

const path = process.argv[2];
if (path === undefined) throw new Error('usage: bench-dag-layout.ts <snapshot.json>');
const snap = JSON.parse(readFileSync(path, 'utf8')) as {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
  bounds: { w: number; h: number };
};

// The snapshot's `layer` is what the run produced. Feeding it back in would
// pin every node to the answer under test.
const nodes: DagNode[] = snap.nodes.map((n) => ({
  id: n.id,
  label: n.label,
  sublabel: n.sublabel,
  category: n.category,
  state: n.state,
}));
const edges: DagEdge[] = snap.edges.map((e) => ({ from: e.from, to: e.to, label: e.label ?? undefined }));

const wireOf = (l: ReturnType<typeof layoutDag>): number => {
  let w = 0;
  for (const e of l.edges) {
    for (let i = 1; i < e.points.length; i++) {
      w += Math.hypot(e.points[i].x - e.points[i - 1].x, e.points[i].y - e.points[i - 1].y);
    }
  }
  return w;
};

for (const sweeps of [2, 4, 8, 16, 32]) {
  const l = layoutDag(nodes, edges, { sweeps });
  console.log(
    `sweeps ${String(sweeps).padStart(2)}: ${l.width.toFixed(0).padStart(6)} x ${l.height.toFixed(0)}` +
      `  wire ${wireOf(l).toFixed(0).padStart(7)}  crossings ${l.crossings}`,
  );
}

for (const passes of [0, 1, 2, 4, 6, 12]) {
  const l = layoutDag(nodes, edges, { passes });
  let w = 0;
  for (const e of l.edges) {
    for (let i = 1; i < e.points.length; i++) {
      w += Math.hypot(e.points[i].x - e.points[i - 1].x, e.points[i].y - e.points[i - 1].y);
    }
  }
  console.log(`passes ${String(passes).padStart(2)}: ${l.width.toFixed(0).padStart(7)} wide, wire ${w.toFixed(0)}`);
}

const layout = layoutDag(nodes, edges);

let wire = 0;
for (const e of layout.edges) {
  for (let i = 1; i < e.points.length; i++) {
    wire += Math.hypot(e.points[i].x - e.points[i - 1].x, e.points[i].y - e.points[i - 1].y);
  }
}

// How much of each row is boxes, and how much is edge routing.
const graph = buildGraph(nodes, edges);
const acyclic = breakCycles(graph);
const layered = wrapWideLayers(assignLayers(graph, acyclic));
const proper = insertDummies(graph, acyclic, layered);
orderLayers(proper);

console.log(`nodes ${layout.nodes.length}  edges ${layout.edges.length}  layers ${proper.layers.length}`);
console.log(`captured: ${snap.bounds.w.toFixed(0)} x ${snap.bounds.h.toFixed(0)}`);
console.log(
  `now:      ${layout.width.toFixed(0)} x ${layout.height.toFixed(0)}   aspect ${(layout.width / layout.height).toFixed(1)}:1`,
);
console.log(`wire length ${wire.toFixed(0)}   crossings ${layout.crossings}`);

let dummyTotal = 0;
let realTotal = 0;
console.log('\nlayer  real  routing');
proper.layers.forEach((row, l) => {
  const real = row.filter((s) => s.node >= 0).length;
  const dummy = row.length - real;
  dummyTotal += dummy;
  realTotal += real;
  if (dummy > 0 || real > 0) console.log(`${String(l).padStart(5)} ${String(real).padStart(5)} ${String(dummy).padStart(8)}`);
});
console.log(`\ntotal real ${realTotal}, routing slots ${dummyTotal}`);

const widths = layout.nodes.map((n) => n.w);
console.log(`widest layer needs about ${Math.max(...widths).toFixed(0)} per box`);
