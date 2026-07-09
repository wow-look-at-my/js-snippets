// Tests for the procedural mesh generators.
//
// These are pure typed-array generators (no GPU), so they unit-test cleanly.
// For every generator we assert structural invariants: positions/normals share
// the same vertex count, every index is in range, normals are ~unit length, and
// positions stay within the expected bounds for the generator's parameters.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCube, createSphere, createCylinder, createPlane, createBox, createTorus,
} from './geometry.ts';
import type { Mesh } from './geometry.ts';

function vertexCount(m: Mesh): number {
  assert.equal(m.positions.length % 3, 0, 'positions length divisible by 3');
  assert.equal(m.normals.length % 3, 0, 'normals length divisible by 3');
  assert.equal(m.positions.length, m.normals.length, 'positions and normals same length');
  return m.positions.length / 3;
}

function assertIndicesInRange(m: Mesh): void {
  const vc = vertexCount(m);
  assert.equal(m.indices.length % 3, 0, 'indices form whole triangles');
  assert.ok(m.indices.length > 0, 'has at least one triangle');
  for (let i = 0; i < m.indices.length; i++) {
    assert.ok(m.indices[i] < vc, `index ${m.indices[i]} >= vertexCount ${vc}`);
    assert.ok(m.indices[i] >= 0, `index ${m.indices[i]} is negative`);
  }
}

function assertNormalsUnit(m: Mesh, tol = 1e-3): void {
  const vc = vertexCount(m);
  for (let i = 0; i < vc; i++) {
    const x = m.normals[i * 3], y = m.normals[i * 3 + 1], z = m.normals[i * 3 + 2];
    const l = Math.hypot(x, y, z);
    assert.ok(Math.abs(l - 1) < tol, `normal ${i} length ${l}`);
  }
}

function bounds(m: Mesh): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], m.positions[i + a]);
      max[a] = Math.max(max[a], m.positions[i + a]);
    }
  }
  return { min, max };
}

test('createCube: structural invariants and bounds', () => {
  const m = createCube(2);
  assert.equal(vertexCount(m), 24); // 6 faces * 4 verts
  assert.equal(m.indices.length, 36); // 6 faces * 2 tris * 3
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  const b = bounds(m);
  for (let a = 0; a < 3; a++) {
    assert.ok(Math.abs(b.min[a] + 1) < 1e-6, `min[${a}] ~ -1`);
    assert.ok(Math.abs(b.max[a] - 1) < 1e-6, `max[${a}] ~ +1`);
  }
});

test('createBox: independent extents per axis, bounds match half-extents', () => {
  const m = createBox(2, 4, 6);
  assert.equal(vertexCount(m), 24);
  assert.equal(m.indices.length, 36);
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  const b = bounds(m);
  const half = [1, 2, 3];
  for (let a = 0; a < 3; a++) {
    assert.ok(Math.abs(b.min[a] + half[a]) < 1e-6, `min[${a}] ~ ${-half[a]}`);
    assert.ok(Math.abs(b.max[a] - half[a]) < 1e-6, `max[${a}] ~ ${half[a]}`);
  }
});

test('createSphere: structural invariants and radius bound', () => {
  const segments = 16;
  const radius = 1.5;
  const m = createSphere(radius, segments);
  assert.equal(vertexCount(m), (segments + 1) * (segments + 1));
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  // Every vertex sits on the sphere of the given radius.
  for (let i = 0; i < m.positions.length; i += 3) {
    const r = Math.hypot(m.positions[i], m.positions[i + 1], m.positions[i + 2]);
    assert.ok(Math.abs(r - radius) < 1e-4, `vertex radius ${r} != ${radius}`);
  }
});

test('createCylinder: structural invariants, radius and height bounds', () => {
  const segments = 20;
  const m = createCylinder(0.5, 0.5, 2, segments);
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  const b = bounds(m);
  // Half-height is 1; radius 0.5.
  assert.ok(Math.abs(b.min[1] + 1) < 1e-6, `min y ~ -1: ${b.min[1]}`);
  assert.ok(Math.abs(b.max[1] - 1) < 1e-6, `max y ~ +1: ${b.max[1]}`);
  for (const a of [0, 2]) {
    assert.ok(b.max[a] <= 0.5 + 1e-6, `extent[${a}] within radius`);
    assert.ok(b.min[a] >= -0.5 - 1e-6, `extent[${a}] within radius`);
  }
});

test('createPlane: a single quad in the XZ plane', () => {
  const m = createPlane(20, 10);
  assert.equal(vertexCount(m), 4);
  assert.equal(m.indices.length, 6);
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  // All normals point +Y; all positions lie on y = 0.
  for (let i = 0; i < m.positions.length; i += 3) {
    assert.equal(m.positions[i + 1], 0, 'plane vertex on y=0');
  }
  const b = bounds(m);
  assert.ok(Math.abs(b.max[0] - 10) < 1e-6 && Math.abs(b.min[0] + 10) < 1e-6, 'width bounds');
  assert.ok(Math.abs(b.max[2] - 5) < 1e-6 && Math.abs(b.min[2] + 5) < 1e-6, 'depth bounds');
});

test('createTorus: structural invariants and bounds', () => {
  const radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 16;
  const m = createTorus(radius, tube, radialSegments, tubularSegments);
  assert.equal(vertexCount(m), (tubularSegments + 1) * (radialSegments + 1));
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  const b = bounds(m);
  // Outer radius = radius + tube in the XZ plane; the tube reaches +/-tube in Y.
  const outer = radius + tube;
  assert.ok(b.max[0] <= outer + 1e-5 && b.max[2] <= outer + 1e-5, 'within outer radius');
  assert.ok(Math.abs(b.max[1] - tube) < 1e-5, `max y ~ tube: ${b.max[1]}`);
  assert.ok(Math.abs(b.min[1] + tube) < 1e-5, `min y ~ -tube: ${b.min[1]}`);
});
