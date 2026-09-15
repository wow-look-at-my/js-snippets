// Tests for the least-squares cylinder fit. Each case generates points on a
// KNOWN cylinder and checks that the recovered axis, centre and radius match.
// The axis is only defined up to sign, so direction checks use |dot| == 1.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitCylinder, fitCylinderForAxis, distanceToCylinderSurface } from './cylinder-fit.ts';
import type { Vec3 } from './vec3.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Points on the surface of a cylinder, wrapped around the axis and spread along
// it. `jitter` perturbs the radius, in radius units.
function cylinderPoints(
  center: Vec3,
  axis: Vec3,
  radius: number,
  halfHeight: number,
  rings: number,
  perRing: number,
  jitter = 0,
  seed = 1,
): Vec3[] {
  const w = normalize(axis);
  // A basis perpendicular to the axis.
  const helper: Vec3 = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize([
    w[1] * helper[2] - w[2] * helper[1],
    w[2] * helper[0] - w[0] * helper[2],
    w[0] * helper[1] - w[1] * helper[0],
  ]);
  const v = normalize([
    w[1] * u[2] - w[2] * u[1],
    w[2] * u[0] - w[0] * u[2],
    w[0] * u[1] - w[1] * u[0],
  ]);
  const rand = mulberry32(seed);
  const points: Vec3[] = [];
  for (let i = 0; i < rings; i++) {
    const t = rings === 1 ? 0 : -halfHeight + (2 * halfHeight * i) / (rings - 1);
    for (let j = 0; j < perRing; j++) {
      // Offset each ring so the samples do not line up into straight seams.
      const angle = (2 * Math.PI * (j + i * 0.37)) / perRing;
      const r = radius * (1 + (jitter === 0 ? 0 : (rand() - 0.5) * 2 * jitter));
      points.push([
        center[0] + w[0] * t + u[0] * r * Math.cos(angle) + v[0] * r * Math.sin(angle),
        center[1] + w[1] * t + u[1] * r * Math.cos(angle) + v[1] * r * Math.sin(angle),
        center[2] + w[2] * t + u[2] * r * Math.cos(angle) + v[2] * r * Math.sin(angle),
      ]);
    }
  }
  return points;
}

test('fitCylinderForAxis is exact when the axis is already known', () => {
  const center: Vec3 = [1, -2, 3];
  const axis: Vec3 = [0, 0, 1];
  const points = cylinderPoints(center, axis, 2, 5, 6, 12);
  const fit = fitCylinderForAxis(points, axis);
  assert.ok(fit);
  assert.ok(Math.abs(fit.radius - 2) < 1e-9, `radius ${fit.radius}`);
  assert.ok(fit.rms < 1e-9);
  // The centre is the axis point nearest the centroid, so x and y must match
  // and the axis coordinate is free.
  assert.ok(Math.abs(fit.center[0] - 1) < 1e-9);
  assert.ok(Math.abs(fit.center[1] + 2) < 1e-9);
  assert.ok(Math.abs(fit.height - 10) < 1e-9);
});

test('fitCylinderForAxis normalizes the given direction', () => {
  const points = cylinderPoints([0, 0, 0], [0, 0, 1], 1.5, 4, 6, 10);
  const fit = fitCylinderForAxis(points, [0, 0, 7]);
  assert.ok(fit);
  assert.ok(Math.abs(Math.hypot(...fit.axis) - 1) < 1e-12);
  assert.ok(Math.abs(fit.radius - 1.5) < 1e-9);
});

test('fitCylinderForAxis rejects too few points and a zero direction', () => {
  const points = cylinderPoints([0, 0, 0], [0, 0, 1], 1, 1, 6, 10);
  assert.equal(fitCylinderForAxis(points.slice(0, 4), [0, 0, 1]), null);
  assert.equal(fitCylinderForAxis(points, [0, 0, 0]), null);
});

test('fitCylinderForAxis is degenerate for points ON the axis', () => {
  // Every point projects to the same place, so no radius is determined.
  const points: Vec3[] = [];
  for (let i = 0; i < 10; i++) points.push([0, 0, i]);
  assert.equal(fitCylinderForAxis(points, [0, 0, 1]), null);
});

test('a wrong axis scores worse than the true one', () => {
  const points = cylinderPoints([0, 0, 0], [0, 0, 1], 2, 6, 8, 12);
  const good = fitCylinderForAxis(points, [0, 0, 1]);
  const bad = fitCylinderForAxis(points, [1, 0, 0]);
  assert.ok(good);
  assert.ok(bad);
  assert.ok(good.error < bad.error, `${good.error} vs ${bad.error}`);
});

test('fitCylinder recovers an axis-aligned cylinder without a hint', () => {
  const center: Vec3 = [-4, 7, 0.5];
  const axis: Vec3 = [0, 1, 0];
  const points = cylinderPoints(center, axis, 3, 8, 8, 16);
  const fit = fitCylinder(points);
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-6, `axis ${fit.axis}`);
  assert.ok(Math.abs(fit.radius - 3) < 1e-6, `radius ${fit.radius}`);
  assert.ok(fit.rms < 1e-6);
  // The centre must lie on the true axis: only the y coordinate is free.
  assert.ok(Math.abs(fit.center[0] + 4) < 1e-6);
  assert.ok(Math.abs(fit.center[2] - 0.5) < 1e-6);
  assert.ok(Math.abs(fit.height - 16) < 1e-6);
});

test('fitCylinder recovers an obliquely-oriented cylinder', () => {
  const center: Vec3 = [2, 2, -1];
  const axis = normalize([1, 2, -0.5]);
  const points = cylinderPoints(center, axis, 1.25, 6, 9, 14);
  const fit = fitCylinder(points);
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-6, `axis ${fit.axis}`);
  assert.ok(Math.abs(fit.radius - 1.25) < 1e-6, `radius ${fit.radius}`);
  assert.ok(fit.rms < 1e-6);
  // Distance from the reported centre to the true axis must be zero.
  const d: Vec3 = [fit.center[0] - center[0], fit.center[1] - center[1], fit.center[2] - center[2]];
  const along = dot(d, axis);
  const perp = Math.hypot(d[0] - along * axis[0], d[1] - along * axis[1], d[2] - along * axis[2]);
  assert.ok(perp < 1e-6, `centre off-axis by ${perp}`);
});

test('fitCylinder finds the axis of a SHORT wide cylinder, where the cloud is flat', () => {
  // The principal axis of this cloud is PERPENDICULAR to the true axis, which is
  // the case a local-only search gets wrong. The hemisphere sweep is what makes
  // it work.
  const axis: Vec3 = [0, 0, 1];
  const points = cylinderPoints([0, 0, 0], axis, 10, 0.4, 3, 40);
  const fit = fitCylinder(points);
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-4, `axis ${fit.axis}`);
  assert.ok(Math.abs(fit.radius - 10) < 1e-3, `radius ${fit.radius}`);
});

test('fitCylinder stays near the generator under radial noise', () => {
  const axis = normalize([0.3, -1, 0.2]);
  const center: Vec3 = [5, 5, 5];
  const points = cylinderPoints(center, axis, 4, 10, 12, 24, 0.02, 99);
  const fit = fitCylinder(points);
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-3, `axis ${fit.axis}`);
  assert.ok(Math.abs(fit.radius - 4) < 0.05, `radius ${fit.radius}`);
  // 2% radial jitter on radius 4 is a uniform band of +-0.08, whose rms is
  // about 0.046. Anything far above that means the axis drifted.
  assert.ok(fit.rms < 0.08, `rms ${fit.rms}`);
});

test('fitCylinder accepts an initial direction and refines it', () => {
  const axis = normalize([1, 1, 1]);
  const points = cylinderPoints([0, 0, 0], axis, 2, 5, 8, 14);
  // A hint 10 degrees off the truth, with the global sweep skipped.
  const hint = normalize([1, 1.3, 0.75]);
  const fit = fitCylinder(points, { direction: hint });
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-6, `axis ${fit.axis}`);
  assert.ok(Math.abs(fit.radius - 2) < 1e-6);
});

test('fitCylinder is deterministic: the same points give the same fit', () => {
  const points = cylinderPoints([1, 2, 3], normalize([0, 1, 2]), 1.75, 4, 7, 11);
  const a = fitCylinder(points);
  const b = fitCylinder(points);
  assert.ok(a && b);
  assert.deepEqual(a, b);
});

test('fitCylinder rejects fewer than 5 points', () => {
  const points = cylinderPoints([0, 0, 0], [0, 0, 1], 1, 1, 2, 2);
  assert.equal(fitCylinder(points), null);
});

test('a coarser sweep with fewer samples still lands on the axis', () => {
  const axis = normalize([2, -1, 3]);
  const points = cylinderPoints([0, 0, 0], axis, 2, 6, 8, 12);
  const fit = fitCylinder(points, { directionSamples: 16 });
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-5, `axis ${fit.axis}`);
});

test('distanceToCylinderSurface is signed and ignores the caps', () => {
  const points = cylinderPoints([0, 0, 0], [0, 0, 1], 2, 5, 6, 12);
  const fit = fitCylinder(points, { direction: [0, 0, 1] });
  assert.ok(fit);
  // On the surface, inside, outside.
  assert.ok(Math.abs(distanceToCylinderSurface(fit, [2, 0, 0])) < 1e-6);
  assert.ok(Math.abs(distanceToCylinderSurface(fit, [1, 0, 0]) + 1) < 1e-6);
  assert.ok(Math.abs(distanceToCylinderSurface(fit, [5, 0, 0]) - 3) < 1e-6);
  // Far beyond the data's extent along the axis, the distance is unchanged: the
  // fitted cylinder is infinite.
  assert.ok(Math.abs(distanceToCylinderSurface(fit, [2, 0, 1000])) < 1e-6);
});
