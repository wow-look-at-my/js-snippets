import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  layoutDag,
  isActiveNode,
  visibleActiveNodes,
  activePhase,
  sheenCentre,
  sheenHalfBand,
  pulseLevel,
  ACTIVE_PERIOD_MS,
  ACTIVE_SWEEP_SHARE,
} from './dag-view-math.ts';
import type { DagNode } from './dag-view-math.ts';

test('isActiveNode: the node field and the style entry each mark a node active', () => {
  const styles = { working: { active: true }, done: {} };
  assert.equal(isActiveNode({ id: 'a', active: true }, {}), true);
  assert.equal(isActiveNode({ id: 'b', state: 'working' }, styles), true);
  assert.equal(isActiveNode({ id: 'c', state: 'done' }, styles), false);
  assert.equal(isActiveNode({ id: 'd', state: 'nobody-defined-this' }, styles), false);
  assert.equal(isActiveNode({ id: 'e' }, styles), false);
  assert.equal(isActiveNode({ id: 'f', active: false, state: 'done' }, styles), false);
});

test('visibleActiveNodes: only active nodes inside the view', () => {
  const nodes: DagNode[] = [
    { id: 'a', state: 'working' },
    { id: 'b' },
    { id: 'c', active: true },
  ];
  const layout = layoutDag(nodes, [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ]);
  const styles = { working: { active: true } };
  const all = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 };
  const ids = (idxs: number[]): string[] => idxs.map((idx) => layout.nodes[idx].node.id).sort();
  assert.deepEqual(ids(visibleActiveNodes(layout, all, styles)), ['a', 'c']);
  const none = { x: 1e7, y: 1e7, w: 10, h: 10 };
  assert.deepEqual(visibleActiveNodes(layout, none, styles), []);
  const cNode = layout.nodes.find((n) => n.node.id === 'c');
  assert.ok(cNode !== undefined);
  const onlyC = { x: cNode.x, y: cNode.y, w: 1, h: 1 };
  assert.deepEqual(ids(visibleActiveNodes(layout, onlyC, styles)), ['c']);
});

test('activePhase: in [0, 1), periodic, and offset per id', () => {
  for (const now of [0, 1, 799, 1600, 123456.7, -50]) {
    const ph = activePhase('node', now);
    assert.ok(ph >= 0 && ph < 1, `phase ${ph} at ${now}`);
  }
  assert.ok(Math.abs(activePhase('x', 300) - activePhase('x', 300 + ACTIVE_PERIOD_MS)) < 1e-9);
  // Distinct ids land at distinct offsets, so a column of active nodes does not pulse in lockstep.
  const phases = new Set(['pr-1', 'pr-2', 'pr-3', 'pr-4', 'pr-5'].map((id) => activePhase(id, 0).toFixed(3)));
  assert.equal(phases.size, 5);
  // The phase advances with time at one period per ACTIVE_PERIOD_MS.
  const p0 = activePhase('y', 0);
  const p1 = activePhase('y', ACTIVE_PERIOD_MS / 4);
  assert.ok(Math.abs(((p1 - p0 + 1) % 1) - 0.25) < 1e-9);
});

test('sheenCentre: enters off the box, leaves off it, rests for the rest of the period', () => {
  const w = 120;
  const h = 40;
  const half = sheenHalfBand(w, h);
  const start = sheenCentre(0, w, h, half);
  assert.ok(start !== null);
  assert.ok(start + half <= 0, 'the band starts fully before the top-left corner');
  const end = sheenCentre(ACTIVE_SWEEP_SHARE - 1e-9, w, h, half);
  assert.ok(end !== null);
  assert.ok(end - half >= w + h - 1e-6, 'the band ends fully past the bottom-right corner');
  const mid = sheenCentre(ACTIVE_SWEEP_SHARE / 2, w, h, half);
  assert.ok(mid !== null && Math.abs(mid - (w + h) / 2) < 1e-9);
  assert.equal(sheenCentre(ACTIVE_SWEEP_SHARE, w, h, half), null);
  assert.equal(sheenCentre(0.99, w, h, half), null);
});

test('sheenHalfBand: grows with the box and never vanishes', () => {
  assert.ok(sheenHalfBand(200, 60) > sheenHalfBand(100, 30));
  assert.ok(sheenHalfBand(1, 1) >= 6);
});

test('pulseLevel: dark at the ends, full at the middle', () => {
  assert.ok(Math.abs(pulseLevel(0)) < 1e-9);
  assert.ok(Math.abs(pulseLevel(0.5) - 1) < 1e-9);
  assert.ok(Math.abs(pulseLevel(0.25) - 0.5) < 1e-9);
  for (let ph = 0; ph < 1; ph += 0.05) {
    const level = pulseLevel(ph);
    assert.ok(level >= 0 && level <= 1);
  }
});
