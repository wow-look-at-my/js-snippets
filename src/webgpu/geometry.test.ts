// Tests for the procedural mesh generators.
//
// These are pure typed-array generators (no GPU), so they unit-test cleanly.
// For every generator we assert structural invariants: positions/normals share
// the same vertex count, every index is in range, normals are ~unit length,
// positions stay within the expected bounds for the generator's parameters,
// and every non-degenerate triangle is wound counter-clockwise viewed from
// outside (front-facing under WebGPU's default frontFace: 'ccw').

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCube, createSphere, createCylinder, createPlane, createBox, createTorus,
  flipWinding,
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

// Winding oracle: for each non-degenerate triangle, the geometric normal
// cross(p1 - p0, p2 - p0) must agree with the average of the three stored
// vertex normals (dot > 0) — i.e. the triangle is counter-clockwise viewed
// from outside, front-facing under WebGPU's default frontFace: 'ccw'.
// Zero-area triangles (e.g. sphere pole rows, a cone's apex row) are skipped.
function windingDots(m: Mesh): { tri: number; dot: number }[] {
  const dots: { tri: number; dot: number }[] = [];
  const P = m.positions, N = m.normals, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const i0 = I[t] * 3, i1 = I[t + 1] * 3, i2 = I[t + 2] * 3;
    const e1x = P[i1] - P[i0], e1y = P[i1 + 1] - P[i0 + 1], e1z = P[i1 + 2] - P[i0 + 2];
    const e2x = P[i2] - P[i0], e2y = P[i2 + 1] - P[i0 + 1], e2z = P[i2 + 2] - P[i0 + 2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    if (Math.hypot(cx, cy, cz) < 1e-9) continue; // zero-area triangle
    const nx = (N[i0] + N[i1] + N[i2]) / 3;
    const ny = (N[i0 + 1] + N[i1 + 1] + N[i2 + 1]) / 3;
    const nz = (N[i0 + 2] + N[i1 + 2] + N[i2 + 2]) / 3;
    dots.push({ tri: t / 3, dot: cx * nx + cy * ny + cz * nz });
  }
  return dots;
}

// One representative instance per generator; the cylinder also as a frustum
// (unequal radii) and a cone (radiusTop 0, whose apex-row triangles are all
// degenerate and must be skipped, not failed).
function windingCases(): [string, Mesh][] {
  return [
    ['createCube', createCube(2)],
    ['createBox', createBox(2, 4, 6)],
    ['createSphere', createSphere(1.5, 16)],
    ['createCylinder equal radii', createCylinder(0.5, 0.5, 2, 20)],
    ['createCylinder unequal radii', createCylinder(0.2, 0.7, 1.5, 16)],
    ['createCylinder cone (radiusTop 0)', createCylinder(0, 0.5, 1, 16)],
    ['createPlane', createPlane(20, 10)],
    ['createTorus', createTorus(1, 0.4, 12, 16)],
  ];
}

test('winding: every generator emits CCW-from-outside triangles', () => {
  for (const [label, m] of windingCases()) {
    const dots = windingDots(m);
    assert.ok(dots.length > 0, `${label}: has non-degenerate triangles`);
    for (const { tri, dot } of dots) {
      assert.ok(dot > 0, `${label}: triangle ${tri} winds CW (dot ${dot})`);
    }
  }
});

test('flipWinding: output winds CW everywhere (fails the CCW oracle)', () => {
  for (const [label, m] of windingCases()) {
    const dots = windingDots(flipWinding(m));
    assert.ok(dots.length > 0, `${label}: flipped mesh has non-degenerate triangles`);
    for (const { tri, dot } of dots) {
      assert.ok(dot < 0, `${label}: flipped triangle ${tri} still CCW (dot ${dot})`);
    }
  }
});

test('flipWinding: (a,b,c) -> (a,c,b), no mutation, arrays pass through, double flip round-trips', () => {
  const m = createCube(1);
  const before = Array.from(m.indices);
  const flipped = flipWinding(m);
  // Positions/normals are the SAME arrays; indices are a NEW array.
  assert.equal(flipped.positions, m.positions, 'positions array passed through');
  assert.equal(flipped.normals, m.normals, 'normals array passed through');
  assert.notEqual(flipped.indices, m.indices, 'indices are a new array');
  // Input untouched.
  assert.deepEqual(Array.from(m.indices), before, 'input indices unmutated');
  // Each triangle (a, b, c) became (a, c, b).
  for (let t = 0; t < m.indices.length; t += 3) {
    assert.equal(flipped.indices[t], m.indices[t], `tri ${t / 3} keeps vertex 0`);
    assert.equal(flipped.indices[t + 1], m.indices[t + 2], `tri ${t / 3} vertex 1 <- 2`);
    assert.equal(flipped.indices[t + 2], m.indices[t + 1], `tri ${t / 3} vertex 2 <- 1`);
  }
  // Flipping twice restores the original index order exactly.
  const twice = flipWinding(flipped);
  assert.deepEqual(Array.from(twice.indices), before, 'double flip round-trips');
});
