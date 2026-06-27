// Tests for the PURE orbit-camera helpers (orbitEye / dirFromAzEl).
//
// NOTE: createOrbitController is intentionally NOT tested here -- it wires
// pointer/wheel DOM events onto an HTMLCanvasElement, so it is DOM-bound and
// belongs to browser/integration testing, not a node:test unit. Only the pure
// spherical-to-cartesian helpers are unit-tested below.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orbitEye, dirFromAzEl } from './camera.ts';
import type { Vec3 } from '../math/vec3.ts';

const close = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

test('orbitEye at az=0, el=0 is +Z * distance offset from the target', () => {
  const target: Vec3 = [1, 2, 3];
  const dist = 5;
  const eye = orbitEye(target, 0, 0, dist);
  assert.ok(close(eye[0], target[0]), `x ${eye[0]}`);
  assert.ok(close(eye[1], target[1]), `y ${eye[1]}`);
  assert.ok(close(eye[2], target[2] + dist), `z ${eye[2]}`);
});

test('orbitEye at az=90deg, el=0 lies along +X from the target', () => {
  const target: Vec3 = [0, 0, 0];
  const dist = 4;
  const eye = orbitEye(target, Math.PI / 2, 0, dist);
  assert.ok(close(eye[0], dist, 1e-12), `x ${eye[0]}`);
  assert.ok(close(eye[1], 0, 1e-12), `y ${eye[1]}`);
  assert.ok(close(eye[2], 0, 1e-12), `z ${eye[2]}`);
});

test('orbitEye at el=90deg places the eye straight above the target', () => {
  const target: Vec3 = [2, -1, 0];
  const dist = 3;
  const eye = orbitEye(target, 0.9, Math.PI / 2, dist);
  assert.ok(close(eye[0], target[0], 1e-12), `x ${eye[0]}`);
  assert.ok(close(eye[1], target[1] + dist, 1e-12), `y ${eye[1]}`);
  assert.ok(close(eye[2], target[2], 1e-12), `z ${eye[2]}`);
});

test('orbitEye keeps the eye at exactly `distance` from the target', () => {
  const target: Vec3 = [3, -2, 1];
  const dist = 7;
  for (const az of [0, 0.5, 1.7, Math.PI, 4.2]) {
    for (const el of [-1, -0.3, 0, 0.6, 1.4]) {
      const eye = orbitEye(target, az, el, dist);
      const off: Vec3 = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
      assert.ok(close(len(off), dist, 1e-9), `|eye-target| = ${len(off)} at az=${az}, el=${el}`);
    }
  }
});

test('orbitEye equals target + distance * dirFromAzEl (consistency)', () => {
  const target: Vec3 = [-1, 4, 2];
  const dist = 6;
  for (const az of [0.2, 1.1, 3.0]) {
    for (const el of [-0.4, 0.0, 0.8]) {
      const eye = orbitEye(target, az, el, dist);
      const dir = dirFromAzEl(az, el);
      assert.ok(close(eye[0], target[0] + dist * dir[0], 1e-9), 'x consistency');
      assert.ok(close(eye[1], target[1] + dist * dir[1], 1e-9), 'y consistency');
      assert.ok(close(eye[2], target[2] + dist * dir[2], 1e-9), 'z consistency');
    }
  }
});

test('dirFromAzEl returns unit vectors', () => {
  for (const az of [0, 0.3, 1.5, 3.1, 5.9]) {
    for (const el of [-1.2, -0.5, 0, 0.5, 1.2]) {
      const d = dirFromAzEl(az, el);
      assert.ok(close(len(d), 1, 1e-12), `|dir| = ${len(d)} at az=${az}, el=${el}`);
    }
  }
});

test('dirFromAzEl known directions', () => {
  // az=0, el=0 -> +Z.
  assert.deepEqual(dirFromAzEl(0, 0).map((c) => Math.round(c)), [0, 0, 1]);
  // el=90deg -> +Y regardless of azimuth.
  const up = dirFromAzEl(2.3, Math.PI / 2);
  assert.ok(close(up[1], 1, 1e-12), `up y ${up[1]}`);
});
