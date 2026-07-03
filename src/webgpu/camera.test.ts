// Tests for the PURE camera helpers (orbitEye / dirFromAzEl / applyLookDrag).
//
// NOTE: createOrbitController and createLookController are intentionally NOT
// tested here -- they wire pointer/wheel DOM events onto an element, so they
// are DOM-bound and belong to browser/integration testing, not a node:test
// unit. Only the pure helpers are unit-tested below.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orbitEye, dirFromAzEl, applyLookDrag } from './camera.ts';
import type { LookState } from './camera.ts';
import { cross, dot } from '../math/vec3.ts';
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

// --- applyLookDrag (first-person look camera) --------------------------------

const DEG = Math.PI / 180;

test('applyLookDrag: pointer up (dy < 0) raises elevation, pointer down lowers it', () => {
  const state: LookState = { azDeg: 0, elDeg: 0 };
  const up = applyLookDrag(state, 0, -40);
  assert.equal(up.elDeg, 10, `pointer up: elDeg ${up.elDeg}`); // 40px * 0.25 deg/px
  assert.equal(up.azDeg, 0, 'pure vertical drag leaves azimuth alone');
  const down = applyLookDrag(state, 0, 40);
  assert.equal(down.elDeg, -10, `pointer down: elDeg ${down.elDeg}`);
});

test('applyLookDrag: invertY flips the pitch axis', () => {
  const state: LookState = { azDeg: 0, elDeg: 0 };
  const up = applyLookDrag(state, 0, -40, { invertY: true });
  assert.equal(up.elDeg, -10, `inverted pointer up: elDeg ${up.elDeg}`);
  const down = applyLookDrag(state, 0, 40, { invertY: true });
  assert.equal(down.elDeg, 10, `inverted pointer down: elDeg ${down.elDeg}`);
});

test('applyLookDrag: pointer right yaws toward the camera right of dirFromAzEl', () => {
  // Screen-right for a camera looking along `forward` with world up +Y is
  // cross(forward, up) -- mat4.lookAt's side vector x = cross(up, backward).
  // A rightward drag must rotate the view direction toward that side.
  const worldUp: Vec3 = [0, 1, 0];
  for (const azDeg of [0, 45, 90, 179, -120, -170]) {
    const before = dirFromAzEl(azDeg * DEG, 0);
    const screenRight = cross(before, worldUp);
    const after = applyLookDrag({ azDeg, elDeg: 0 }, 50, 0);
    const fwd = dirFromAzEl(after.azDeg * DEG, after.elDeg * DEG);
    assert.ok(dot(fwd, screenRight) > 0, `az=${azDeg}: dot ${dot(fwd, screenRight)}`);
    assert.equal(after.elDeg, 0, 'pure horizontal drag leaves elevation alone');
  }
});

test('applyLookDrag: elevation clamps at both limits', () => {
  const top = applyLookDrag({ azDeg: 0, elDeg: 80 }, 0, -100);
  assert.equal(top.elDeg, 89, `default max: ${top.elDeg}`); // 80 + 25 -> clamp 89
  const bottom = applyLookDrag({ azDeg: 0, elDeg: -80 }, 0, 100);
  assert.equal(bottom.elDeg, -89, `default min: ${bottom.elDeg}`);
  const customTop = applyLookDrag({ azDeg: 0, elDeg: 40 }, 0, -100, { maxElDeg: 45 });
  assert.equal(customTop.elDeg, 45, `custom max: ${customTop.elDeg}`);
  const customBottom = applyLookDrag({ azDeg: 0, elDeg: -20 }, 0, 100, { minElDeg: -30 });
  assert.equal(customBottom.elDeg, -30, `custom min: ${customBottom.elDeg}`);
});

test('applyLookDrag: azimuth wraps to (-180, 180]', () => {
  // Pointer left (dx < 0) grows azimuth; +2deg from 179 crosses +180.
  const overPos = applyLookDrag({ azDeg: 179, elDeg: 0 }, -8, 0);
  assert.equal(overPos.azDeg, -179, `179 + 2 -> ${overPos.azDeg}`);
  // Pointer right shrinks azimuth; -2deg from -179 crosses -180.
  const overNeg = applyLookDrag({ azDeg: -179, elDeg: 0 }, 8, 0);
  assert.equal(overNeg.azDeg, 179, `-179 - 2 -> ${overNeg.azDeg}`);
  // The interval is half-open: exactly +180 stays, exactly -180 wraps to +180.
  const atPos = applyLookDrag({ azDeg: 178, elDeg: 0 }, -8, 0);
  assert.equal(atPos.azDeg, 180, `178 + 2 -> ${atPos.azDeg}`);
  const atNeg = applyLookDrag({ azDeg: -178, elDeg: 0 }, 8, 0);
  assert.equal(atNeg.azDeg, 180, `-178 - 2 -> ${atNeg.azDeg}`);
});

test('applyLookDrag: sensitivity scales the step linearly', () => {
  const state: LookState = { azDeg: 0, elDeg: 0 };
  assert.equal(applyLookDrag(state, 10, 0, { sensDegPerPx: 0.25 }).azDeg, -2.5);
  assert.equal(applyLookDrag(state, 10, 0, { sensDegPerPx: 0.5 }).azDeg, -5);
  assert.equal(applyLookDrag(state, 10, 0, { sensDegPerPx: 1 }).azDeg, -10);
  assert.equal(applyLookDrag(state, 0, 10, { sensDegPerPx: 0.5 }).elDeg, -5);
  // Default sensitivity is 0.25 deg/px.
  assert.equal(applyLookDrag(state, 10, 0).azDeg, -2.5);
});

test('applyLookDrag: returns a new state, never mutates the input', () => {
  const state: LookState = { azDeg: 12, elDeg: -3 };
  const out = applyLookDrag(state, 10, 10);
  assert.notEqual(out, state, 'must return a new object');
  assert.deepEqual(state, { azDeg: 12, elDeg: -3 }, 'input state mutated');
  assert.deepEqual(out, { azDeg: 9.5, elDeg: -5.5 });
});
