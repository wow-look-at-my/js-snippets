// Tests for the pure signed-distance-field math. Ported from the
// distance-field-shadows scratchpad's smoke.mjs oracle and adapted to this
// library's API (a `SceneSDF` callback + `transformPoint`, rather than the
// scratchpad's bundled `evalSceneSDF`).
//
// Covers: primitive distances + signs, column-major inverse-model transforms,
// trilinear reconstruction of a linear field, the sampleGrid outside extension,
// the Inigo Quilez soft-shadow march (umbra/penumbra/monotone, baked vs
// analytic, k narrows the penumbra), and intersectAABB hit/miss + clip
// equivalence.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sdSphere, sdBox, sdCylinder, sdTorus, primitiveSDF,
  SDF_SPHERE, SDF_BOX,
  transformPoint, makeGrid, trilinear, sampleGrid, softShadow, intersectAABB,
} from './sdf.ts';
import type { SceneSDF, SdfGrid } from './sdf.ts';
import type { Vec3 } from './vec3.ts';

const near = (a: number, b: number, tol: number, msg: string): void => {
  assert.ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} +/-${tol})`);
};

// Inverse of a rigid model T(pos)*Ry(yaw): world -> local. Matches the
// column-major composition the shared mat4 helpers produce.
function rigidInvY(pos: Vec3, yaw: number): Float32Array {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const [px, py, pz] = pos;
  return new Float32Array([
    c, 0, s, 0,
    0, 1, 0, 0,
    -s, 0, c, 0,
    -(c * px - s * pz), -py, -(s * px + c * pz), 1,
  ]);
}

// ---- A) Primitive distances (local frame) ---------------------------------

test('sdSphere: sign and known distances', () => {
  near(sdSphere([2, 0, 0], [1, 0, 0, 0]), 1, 1e-9, 'sphere outside');
  near(sdSphere([0, 0, 0], [1, 0, 0, 0]), -1, 1e-9, 'sphere centre (inside)');
  near(sdSphere([0, 3, 0], [1, 0, 0, 0]), 2, 1e-9, 'sphere along +Y');
});

test('sdBox: sign and known distances', () => {
  near(sdBox([2, 0, 0], [1, 1, 1, 0]), 1, 1e-9, 'box face');
  near(sdBox([0, 0, 0], [1, 1, 1, 0]), -1, 1e-9, 'box centre (inside)');
  near(sdBox([2, 2, 0], [1, 1, 1, 0]), Math.SQRT2, 1e-9, 'box edge (diagonal)');
});

test('sdCylinder: sign and known distances', () => {
  near(sdCylinder([2, 0, 0], [1, 2, 0, 0]), 1, 1e-9, 'cylinder radial');
  near(sdCylinder([0, 3, 0], [1, 2, 0, 0]), 1, 1e-9, 'cylinder cap');
  near(sdCylinder([0, 0, 0], [1, 2, 0, 0]), -1, 1e-9, 'cylinder inside');
  near(sdCylinder([2, 3, 0], [1, 2, 0, 0]), Math.SQRT2, 1e-9, 'cylinder corner');
});

test('sdTorus: sign and known distances', () => {
  near(sdTorus([2, 0, 0], [2, 0.5, 0, 0]), -0.5, 1e-9, 'torus on ring centreline');
  near(sdTorus([3, 0, 0], [2, 0.5, 0, 0]), 0.5, 1e-9, 'torus outer');
  near(sdTorus([2, 1, 0], [2, 0.5, 0, 0]), 0.5, 1e-9, 'torus above ring');
});

test('primitiveSDF dispatches by type id and falls back far away', () => {
  near(primitiveSDF(SDF_SPHERE, [2, 0, 0], [1, 0, 0, 0]), 1, 1e-9, 'dispatch sphere');
  near(primitiveSDF(SDF_BOX, [2, 0, 0], [1, 1, 1, 0]), 1, 1e-9, 'dispatch box');
  assert.ok(primitiveSDF(999, [0, 0, 0], [0, 0, 0, 0]) > 1e8, 'unknown type returns a huge distance');
});

// ---- B) Transforms: column-major invModel brings world -> local -----------

test('transformPoint applies a column-major affine (inverse-model) transform', () => {
  // A translated sphere: a world point at +X from the centre maps to local +X.
  const pos: Vec3 = [3, 1.2, -2];
  const inv = rigidInvY(pos, 0);
  const local = transformPoint(inv, [pos[0] + 2, pos[1], pos[2]]);
  near(local[0], 2, 1e-6, 'translated +X -> local x');
  near(local[1], 0, 1e-6, 'translated +X -> local y');
  near(local[2], 0, 1e-6, 'translated +X -> local z');
  near(sdSphere(local, [0.7, 0, 0, 0]), 2 - 0.7, 1e-6, 'translated sphere distance');
});

test('transformPoint + sdBox: a yawed long box maps world axes to local axes', () => {
  // Box with a long X axis (he = [1.5, 0.5, 0.5]) yawed 90deg about Y. Its long
  // axis now lies along world Z; the short axis along world X.
  const inv = rigidInvY([0, 0, 0], Math.PI / 2);
  near(sdBox(transformPoint(inv, [0, 0, 2]), [1.5, 0.5, 0.5, 0]), 0.5, 1e-6, 'long axis -> world Z');
  near(sdBox(transformPoint(inv, [2, 0, 0]), [1.5, 0.5, 0.5, 0]), 1.5, 1e-6, 'short axis -> world X');
});

// ---- C) Trilinear reproduces a linear field exactly -----------------------

test('trilinear reconstructs a linear field exactly', () => {
  const dims: [number, number, number] = [6, 5, 4];
  const volMin: Vec3 = [-1, 0.5, 2], volMax: Vec3 = [2, 3, 4.5];
  const ext = [volMax[0] - volMin[0], volMax[1] - volMin[1], volMax[2] - volMin[2]];
  const A = 1.3, B = -0.7, C = 0.4, D = 2.1;
  const lin: SceneSDF = (x, y, z) => A * x + B * y + C * z + D;
  const grid = makeGrid(lin, volMin, volMax, dims);

  // Deterministic sweep strictly inside the texel-centre band (no clamping).
  let maxErr = 0;
  const N = 11;
  for (let iz = 1; iz < N - 1; iz++)
    for (let iy = 1; iy < N - 1; iy++)
      for (let ix = 1; ix < N - 1; ix++) {
        const q: Vec3 = [
          0.5 / dims[0] + (ix / (N - 1)) * (1 - 1 / dims[0]),
          0.5 / dims[1] + (iy / (N - 1)) * (1 - 1 / dims[1]),
          0.5 / dims[2] + (iz / (N - 1)) * (1 - 1 / dims[2]),
        ];
        const wx = volMin[0] + q[0] * ext[0];
        const wy = volMin[1] + q[1] * ext[1];
        const wz = volMin[2] + q[2] * ext[2];
        maxErr = Math.max(maxErr, Math.abs(trilinear(grid, q) - lin(wx, wy, wz)));
      }
  assert.ok(maxErr < 1e-5, `trilinear reproduces a linear field (maxErr ${maxErr})`);
});

// ---- Shared baked sphere for the sampling + shadow tests -------------------

const SPHERE_C: Vec3 = [0, 1.2, 0], SPHERE_R = 0.8;
const sphereScene: SceneSDF = (x, y, z) =>
  sdSphere(transformPoint(rigidInvY(SPHERE_C, 0), [x, y, z]), [SPHERE_R, 0, 0, 0]);
const VOL_MIN: Vec3 = [-1.6, -0.4, -1.6], VOL_MAX: Vec3 = [1.6, 2.8, 1.6];
const grid: SdfGrid = makeGrid(sphereScene, VOL_MIN, VOL_MAX, [48, 48, 48]);
const voxel = (VOL_MAX[0] - VOL_MIN[0]) / 48;

// ---- D) sampleGrid outside extension --------------------------------------

test('sampleGrid: baked centre matches the analytic sphere', () => {
  near(sampleGrid(grid, SPHERE_C), -SPHERE_R, 2 * voxel, 'baked centre ~= -r');
});

test('sampleGrid is continuous across the volume face', () => {
  const faceX = VOL_MAX[0];
  const dIn = sampleGrid(grid, [faceX - 0.5 * voxel, SPHERE_C[1], 0]);
  const dOut = sampleGrid(grid, [faceX + 0.5 * voxel, SPHERE_C[1], 0]);
  assert.ok(Math.abs(dIn - dOut) < 2 * voxel, `continuous across face (${dIn} vs ${dOut})`);
});

test('sampleGrid outside the box is >= distance to the box and grows with range', () => {
  const faceX = VOL_MAX[0];
  const d1 = sampleGrid(grid, [faceX + 0.5, SPHERE_C[1], 0]);
  const d2 = sampleGrid(grid, [faceX + 1.5, SPHERE_C[1], 0]);
  assert.ok(d1 >= 0.5 - 1e-6, `outside value >= distance to box (${d1} >= 0.5)`);
  assert.ok(d2 > d1, `grows moving away from the volume (${d2} > ${d1})`);
});

// ---- E) Soft shadows on the baked sphere ----------------------------------

const UP: Vec3 = [0, 1, 0];
const shadowOpts = { tmin: 0.02, tmax: 6, k: 12, maxSteps: 192, minStep: 0.5 * voxel, maxStep: 0.25, eps: 0.5 * voxel };
const visAt = (x: number, k = 12): number =>
  softShadow((p) => sampleGrid(grid, p), [x, 0, 0], UP, { ...shadowOpts, k }).vis;

test('soft shadow: point under the sphere is occluded, far point is lit', () => {
  assert.ok(visAt(0) < 0.05, `point under sphere is shadowed (vis ${visAt(0)})`);
  assert.ok(visAt(3) > 0.95, `point far from sphere is lit (vis ${visAt(3)})`);
});

test('soft shadow has a real penumbra (some 0 < vis < 1)', () => {
  let saw = false;
  for (let x = 0; x <= 2; x += 0.01) {
    const v = visAt(x);
    if (v > 0.02 && v < 0.98) { saw = true; break; }
  }
  assert.ok(saw, 'soft shadow has a penumbra');
});

test('soft shadow visibility is monotone non-decreasing moving out of shadow', () => {
  let prev = -1, mono = true;
  for (let x = 0; x <= 3; x += 0.05) {
    const v = visAt(x);
    if (v < prev - 1e-3) { mono = false; break; }
    prev = v;
  }
  assert.ok(mono, 'visibility is monotone non-decreasing');
});

test('soft shadow: baked field reproduces the analytic field (within trilinear tolerance)', () => {
  let maxDiff = 0;
  for (const x of [0.0, 0.6, 0.85, 1.0, 1.3, 2.0]) {
    const vBaked = softShadow((p) => sampleGrid(grid, p), [x, 0, 0], UP, shadowOpts).vis;
    const vExact = softShadow((p) => sphereScene(p[0], p[1], p[2]), [x, 0, 0], UP, shadowOpts).vis;
    maxDiff = Math.max(maxDiff, Math.abs(vBaked - vExact));
  }
  assert.ok(maxDiff < 0.2, `baked vs analytic shadow agree (maxDiff ${maxDiff})`);
});

test('soft shadow: larger k narrows the penumbra (the softness knob works)', () => {
  const penumbraWidth = (k: number): number => {
    let lo = Infinity, hi = -Infinity;
    for (let x = 0; x <= 2; x += 0.005) {
      const v = visAt(x, k);
      if (v > 0.05 && v < 0.95) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
    return hi >= lo ? hi - lo : 0;
  };
  const wSoft = penumbraWidth(6);
  const wSharp = penumbraWidth(48);
  assert.ok(wSoft > 0, `soft k has a measurable penumbra (${wSoft})`);
  assert.ok(wSharp < wSoft, `larger k narrows the penumbra (${wSharp} < ${wSoft})`);
});

// ---- F) intersectAABB hit/miss + clip equivalence -------------------------

test('intersectAABB: a vertical ray through the volume centre hits; a parallel outside ray misses', () => {
  const c: Vec3 = [(VOL_MIN[0] + VOL_MAX[0]) / 2, 0, (VOL_MIN[2] + VOL_MAX[2]) / 2];
  const through = intersectAABB([c[0], VOL_MIN[1] - 1, c[2]], [0, 1, 0], VOL_MIN, VOL_MAX);
  assert.ok(through[1] > Math.max(through[0], 0), 'vertical ray through centre hits');
  const beside = intersectAABB([VOL_MAX[0] + 1, 0, c[2]], [0, 1, 0], VOL_MIN, VOL_MAX);
  assert.ok(beside[1] < Math.max(beside[0], 0), 'parallel ray outside the box misses');
});

test('soft shadow: AABB-clipped march matches the full march', () => {
  const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const dirs: Vec3[] = [UP, norm([0.5, 0.8, 0.25]), norm([-0.6, 0.7, 0.1])];
  const aabb = { min: VOL_MIN, max: VOL_MAX };
  let maxDiff = 0;
  for (const rd of dirs) {
    for (let x = -2.5; x <= 3; x += 0.1) {
      const ro: Vec3 = [x, 0, 0];
      const vClip = softShadow((p) => sampleGrid(grid, p), ro, rd, { ...shadowOpts, aabb }).vis;
      const vFull = softShadow((p) => sampleGrid(grid, p), ro, rd, shadowOpts).vis;
      maxDiff = Math.max(maxDiff, Math.abs(vClip - vFull));
    }
  }
  assert.ok(maxDiff < 0.02, `AABB-clipped march matches the full march (maxDiff ${maxDiff})`);
});
