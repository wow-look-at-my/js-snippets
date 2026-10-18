import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  collapseGroups,
  layoutGrouped,
  layoutDag,
  groupNodeId,
  groupLabel,
  hitTestGroupHeader,
  groupOfNode,
  groupMatches,
  GROUP_HEADER,
} from './dag-view-math.ts';
import type { DagNode, DagEdge, DagGroup } from './dag-view-math.ts';

const pending = (n: number): DagNode[] =>
  Array.from({ length: n }, (_, idx) => ({ id: `p${idx}`, label: `pending ${idx}`, group: 'pending' }));

test('groupLabel: the group label, else a count', () => {
  assert.equal(groupLabel({ id: 'g', label: '12 pending PRs' }, 12), '12 pending PRs');
  assert.equal(groupLabel({ id: 'g' }, 3), '3 nodes');
  assert.equal(groupLabel({ id: 'g', label: '  ' }, 1), '1 node');
});

test('collapseGroups: a collapsed group becomes one stand-in with a count badge, at its first member', () => {
  const nodes: DagNode[] = [{ id: 'a' }, ...pending(3), { id: 'b' }];
  const g = collapseGroups(nodes, [], [{ id: 'pending', label: '3 pending PRs', collapsed: true }]);
  assert.deepEqual(
    g.nodes.map((n) => n.id),
    ['a', groupNodeId('pending'), 'b'],
  );
  const stand = g.nodes[1];
  assert.equal(stand.label, '3 pending PRs');
  assert.equal(stand.badge, '3');
  assert.equal(g.groups[0].members.length, 3);
  assert.equal(g.groups[0].collapsed, true);
});

test('collapseGroups: edges reroute to the stand-in, inner edges go, repeats are kept once', () => {
  const nodes: DagNode[] = [{ id: 'a' }, { id: 'm1', group: 'g' }, { id: 'm2', group: 'g' }, { id: 'z' }];
  const edges: DagEdge[] = [
    { from: 'a', to: 'm1', label: 'first' },
    { from: 'a', to: 'm2', label: 'second' },
    { from: 'm1', to: 'm2' },
    { from: 'm2', to: 'z' },
    { from: 'a', to: 'z' },
  ];
  const g = collapseGroups(nodes, edges, [{ id: 'g', collapsed: true }]);
  const sid = groupNodeId('g');
  assert.deepEqual(
    g.edges.map((e) => [e.from, e.to, e.label ?? '']),
    [
      ['a', sid, 'first'],
      [sid, 'z', ''],
      ['a', 'z', ''],
    ],
  );
});

test('collapseGroups: an expanded group, an unknown group and an empty group change nothing', () => {
  const nodes: DagNode[] = [{ id: 'a', group: 'nope' }, { id: 'm', group: 'g' }];
  const g = collapseGroups(nodes, [], [{ id: 'g', collapsed: false }, { id: 'empty', collapsed: true }]);
  assert.deepEqual(
    g.nodes.map((n) => n.id),
    ['a', 'm'],
  );
  assert.deepEqual(
    g.groups.map((x) => x.group.id),
    ['g'],
  );
});

test('collapseGroups: the stand-in is active when a member is', () => {
  const nodes: DagNode[] = [{ id: 'm1', group: 'g' }, { id: 'm2', group: 'g', active: true }];
  assert.equal(collapseGroups(nodes, [], [{ id: 'g', collapsed: true }]).nodes[0].active, true);
  const calm = collapseGroups([{ id: 'm1', group: 'g' }], [], [{ id: 'g', collapsed: true }]);
  assert.equal(calm.nodes[0].active, undefined);
});

test('layoutGrouped: no groups is exactly layoutDag', () => {
  const nodes: DagNode[] = [{ id: 'a' }, { id: 'b' }];
  const edges: DagEdge[] = [{ from: 'a', to: 'b' }];
  assert.deepEqual(layoutGrouped(nodes, edges, []), layoutDag(nodes, edges));
});

test('layoutGrouped: collapsed draws ONE node, and the edges into members reach it', () => {
  const nodes: DagNode[] = [{ id: 'root' }, ...pending(12)];
  const edges: DagEdge[] = [
    { from: 'root', to: 'p0', label: 'feeds' },
    { from: 'root', to: 'p5' },
  ];
  const groups: DagGroup[] = [{ id: 'pending', label: '12 pending PRs', collapsed: true }];
  const lay = layoutGrouped(nodes, edges, groups);
  assert.equal(lay.nodes.length, 2);
  assert.equal(lay.edges.length, 1, 'two edges into members collapse to one');
  const sid = lay.byId.get(groupNodeId('pending'));
  assert.equal(lay.edges[0].to, sid);
  assert.equal(lay.edges[0].edge.to, 'p0', 'the placed edge keeps its input edge');
  assert.equal(lay.groups?.length, 1);
  assert.equal(lay.groups?.[0].collapsed, true);
  assert.equal(groupOfNode(lay, groupNodeId('pending'))?.id, 'pending');
  assert.equal(groupOfNode(lay, 'root'), null);
});

test('layoutGrouped: expanded draws every member inside one box, under its header', () => {
  const nodes: DagNode[] = [{ id: 'root' }, ...pending(4), { id: 'tail' }];
  const edges: DagEdge[] = [
    { from: 'root', to: 'p1' },
    { from: 'p1', to: 'p2' },
    { from: 'p3', to: 'tail' },
  ];
  const lay = layoutGrouped(nodes, edges, [{ id: 'pending', collapsed: false }]);
  assert.equal(lay.nodes.length, 6);
  const box = lay.groups?.[0];
  assert.ok(box !== undefined && !box.collapsed);
  for (const id of ['p0', 'p1', 'p2', 'p3']) {
    const p = lay.nodes[lay.byId.get(id)!];
    assert.ok(p.x >= box.x && p.x + p.w <= box.x + box.w + 1e-6, `${id} inside the box horizontally`);
    assert.ok(p.y >= box.y + GROUP_HEADER - 1e-6 && p.y + p.h <= box.y + box.h + 1e-6, `${id} under the header`);
  }
  for (const id of ['root', 'tail']) {
    const p = lay.nodes[lay.byId.get(id)!];
    const inside = p.x < box.x + box.w && p.x + p.w > box.x && p.y < box.y + box.h && p.y + p.h > box.y;
    assert.ok(!inside, `${id} stays outside the box`);
  }
  // Every input edge is drawn once and attached to the member it names.
  assert.equal(lay.edges.length, 3);
  const into = lay.edges.find((e) => e.edge.from === 'root')!;
  assert.equal(into.to, lay.byId.get('p1'));
  const inner = lay.edges.find((e) => e.edge.from === 'p1')!;
  assert.equal(inner.from, lay.byId.get('p1'));
  assert.equal(inner.to, lay.byId.get('p2'));
  // The header is a click target, the members' area is not.
  assert.equal(hitTestGroupHeader(lay, box.x + 4, box.y + 4)?.id, 'pending');
  assert.equal(hitTestGroupHeader(lay, box.x + 4, box.y + GROUP_HEADER + 4), null);
});

test('layoutGrouped: toggling uses the predicate, not only the group field', () => {
  const nodes = pending(5);
  const groups: DagGroup[] = [{ id: 'pending', collapsed: true }];
  assert.equal(layoutGrouped(nodes, [], groups).nodes.length, 1);
  assert.equal(layoutGrouped(nodes, [], groups, () => false).nodes.length, 5);
});

test('groupMatches: a query in any member matches the group', () => {
  const lay = layoutGrouped(pending(3), [], [{ id: 'pending', collapsed: true }]);
  const g = lay.groups![0];
  assert.equal(groupMatches(g, 'pending 2'), true);
  assert.equal(groupMatches(g, 'nothing'), false);
  assert.equal(groupMatches(g, ''), false);
});
