// Tests for the column-major Float32Array(16) mat4 utilities. Covers the
// existing API (identity / multiply / perspective / lookAt / invert /
// normalMatrix) and the newer functions (perspectiveGL, normalMatrix3,
// rotateZ, transpose).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  identity, multiply, perspective, perspectiveGL, lookAt, invert,
  normalMatrix, normalMatrix3, transpose, rotateZ, scale, translate,
} from './mat4.ts';
import type { Mat4 } from './mat4.ts';
import type { Vec3 } from './vec3.ts';

const close = (a: number, b: number, tol = 1e-5): boolean => Math.abs(a - b) <= tol;

function assertMatClose(a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-5, msg = ''): void {
  assert.equal(a.length, b.length, `length ${msg}`);
  for (let i = 0; i < a.length; i++) {
    assert.ok(close(a[i], b[i], tol), `${msg} index ${i}: ${a[i]} != ${b[i]}`);
  }
}

// Apply a column-major mat4 to a homogeneous point (w = 1). Returns [x,y,z,w].
function apply(m: Mat4, p: [number, number, number, number]): [number, number, number, number] {
  const [x, y, z, w] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

test('identity is the column-major 4x4 identity', () => {
  assertMatClose(
    identity(),
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    0,
    'identity',
  );
});

test('multiply by identity is a no-op on either side', () => {
  const m = scale(translate(identity(), [1, 2, 3]), [2, 3, 4]);
  assertMatClose(multiply(m, identity()), m, 1e-6, 'm*I');
  assertMatClose(multiply(identity(), m), m, 1e-6, 'I*m');
});

test('multiply is associative', () => {
  const a = translate(identity(), [1, 0, -2]);
  const b = rotateZ(identity(), 0.5);
  const c = scale(identity(), [2, 0.5, 3]);
  assertMatClose(multiply(multiply(a, b), c), multiply(a, multiply(b, c)), 1e-5, '(ab)c == a(bc)');
});

test('perspective uses WebGPU clip-Z: -near -> 0, -far -> 1 after divide', () => {
  const near = 0.5, far = 100;
  const m = perspective(Math.PI / 3, 1.5, near, far);
  // A point on the -Z axis at z = -near. Clip w = -z = near; clip z maps to 0.
  const cn = apply(m, [0, 0, -near, 1]);
  assert.ok(close(cn[3], near, 1e-5), `w at near = ${cn[3]}`);
  assert.ok(close(cn[2] / cn[3], 0, 1e-5), `ndc-z at near = ${cn[2] / cn[3]}`);
  // A point at z = -far maps to clip-z 1.
  const cf = apply(m, [0, 0, -far, 1]);
  assert.ok(close(cf[3], far, 1e-4), `w at far = ${cf[3]}`);
  assert.ok(close(cf[2] / cf[3], 1, 1e-5), `ndc-z at far = ${cf[2] / cf[3]}`);
});

test('perspectiveGL uses OpenGL clip-Z: -near -> -1, -far -> +1 after divide', () => {
  const near = 0.5, far = 100;
  const m = perspectiveGL(Math.PI / 3, 1.5, near, far);
  const cn = apply(m, [0, 0, -near, 1]);
  assert.ok(close(cn[2] / cn[3], -1, 1e-5), `ndc-z at near = ${cn[2] / cn[3]}`);
  const cf = apply(m, [0, 0, -far, 1]);
  assert.ok(close(cf[2] / cf[3], 1, 1e-5), `ndc-z at far = ${cf[2] / cf[3]}`);
});

test('perspective sets the standard projection entries (aspect, fov, w = -z)', () => {
  const m = perspective(Math.PI / 2, 2, 1, 10);
  // fovY = 90deg -> f = 1/tan(45) = 1; m[5] = f, m[0] = f/aspect.
  assert.ok(close(m[5], 1, 1e-6), `m[5] = ${m[5]}`);
  assert.ok(close(m[0], 0.5, 1e-6), `m[0] = ${m[0]}`);
  // m[11] = -1 makes clip-w = -z (perspective divide).
  assert.equal(m[11], -1);
});

test('lookAt places the eye at the origin of view space', () => {
  const eye: Vec3 = [0, 0, 5];
  const center: Vec3 = [0, 0, 0];
  const up: Vec3 = [0, 1, 0];
  const v = lookAt(eye, center, up);
  // The eye maps to the view-space origin.
  const e = apply(v, [eye[0], eye[1], eye[2], 1]);
  assert.ok(close(e[0], 0) && close(e[1], 0) && close(e[2], 0), `eye -> ${e.slice(0, 3)}`);
  // The center is in front of the camera: -Z in view space (looking down -Z).
  const c = apply(v, [center[0], center[1], center[2], 1]);
  assert.ok(c[2] < 0, `center view-z should be negative, got ${c[2]}`);
});

test('invert round-trips: m * inv(m) == identity', () => {
  const m = scale(rotateZ(translate(identity(), [2, -3, 1]), 0.7), [1.5, 2, 0.5]);
  const inv = invert(m);
  assert.ok(inv, 'invert returned null for an invertible matrix');
  assertMatClose(multiply(m, inv!), identity(), 1e-4, 'm * inv == I');
  assertMatClose(multiply(inv!, m), identity(), 1e-4, 'inv * m == I');
});

test('invert returns null for a singular matrix', () => {
  // A matrix with a zero scale on Z is non-invertible.
  const m = scale(identity(), [1, 1, 0]);
  assert.equal(invert(m), null);
});

test('transpose matches a hand-computed transpose', () => {
  // Column-major: m[c*4 + r]. Build a matrix with distinct entries.
  const m = new Float32Array([
    0, 1, 2, 3,
    4, 5, 6, 7,
    8, 9, 10, 11,
    12, 13, 14, 15,
  ]);
  const t = transpose(m);
  // Element (r,c) of t equals element (c,r) of m.
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      assert.equal(t[c * 4 + r], m[r * 4 + c], `t(${r},${c})`);
    }
  }
});

test('transpose is an involution: transpose(transpose(m)) == m', () => {
  const m = scale(rotateZ(translate(identity(), [1, 2, 3]), 0.3), [2, 3, 4]);
  assertMatClose(transpose(transpose(m)), m, 0, 'TT == I');
});

test('rotateZ rotates +X toward +Y by 90 degrees', () => {
  const m = rotateZ(identity(), Math.PI / 2);
  const x = apply(m, [1, 0, 0, 1]);
  assert.ok(close(x[0], 0, 1e-6) && close(x[1], 1, 1e-6) && close(x[2], 0, 1e-6), `Rz(90)*X -> ${x.slice(0, 3)}`);
  const y = apply(m, [0, 1, 0, 1]);
  assert.ok(close(y[0], -1, 1e-6) && close(y[1], 0, 1e-6), `Rz(90)*Y -> ${y.slice(0, 3)}`);
});

test('normalMatrix embeds the inverse-transpose of the upper 3x3 in a 4x4', () => {
  // Pure rotation: the normal matrix equals the rotation itself (orthonormal).
  const r = rotateZ(identity(), 0.9);
  const nm = normalMatrix(r);
  // Upper-left 3x3 of nm should equal upper-left 3x3 of r.
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
    assert.ok(close(nm[i], r[i], 1e-5), `normalMatrix index ${i}: ${nm[i]} != ${r[i]}`);
  }
});

test('normalMatrix returns identity on a singular matrix', () => {
  const m = scale(identity(), [1, 1, 0]);
  assertMatClose(normalMatrix(m), identity(), 0, 'normalMatrix singular');
});

test('normalMatrix3 equals the inverse-transpose of the upper 3x3 for a non-uniform scale', () => {
  // For a pure non-uniform scale diag(sx,sy,sz), the inverse-transpose is
  // diag(1/sx, 1/sy, 1/sz). normalMatrix3 returns a column-major mat3.
  const sx = 2, sy = 4, sz = 0.5;
  const m = scale(identity(), [sx, sy, sz]);
  const n3 = normalMatrix3(m);
  assert.equal(n3.length, 9);
  assertMatClose(
    n3,
    [1 / sx, 0, 0, 0, 1 / sy, 0, 0, 0, 1 / sz],
    1e-5,
    'normalMatrix3 non-uniform scale',
  );
});

test('normalMatrix3 matches the 3x3 block of normalMatrix for a rigid+scale transform', () => {
  const m = scale(rotateZ(translate(identity(), [1, 2, 3]), 0.6), [1.5, 0.5, 2]);
  const n3 = normalMatrix3(m);
  const n4 = normalMatrix(m);
  // Map the 4x4 3x3 block (cols 0..2, rows 0..2) to the mat3 layout.
  const block = [n4[0], n4[1], n4[2], n4[4], n4[5], n4[6], n4[8], n4[9], n4[10]];
  assertMatClose(n3, block, 1e-4, 'normalMatrix3 vs normalMatrix block');
});

test('normalMatrix3 returns the column-major identity 3x3 on a singular matrix', () => {
  // Upper-left 3x3 with a zero column is singular (det 0).
  const m = scale(identity(), [1, 1, 0]);
  assertMatClose(
    normalMatrix3(m),
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    0,
    'normalMatrix3 singular -> identity',
  );
});
