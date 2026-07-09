import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dollyDelta, flyMoveDelta } from './fly-camera.ts';
import type { FlyMoveState } from './fly-camera.ts';

const NO_MOVE: FlyMoveState = { forward: false, back: false, left: false, right: false, up: false, down: false };
const moving = (keys: Partial<FlyMoveState>): FlyMoveState => ({ ...NO_MOVE, ...keys });

const assertVecClose = (got: readonly number[], want: readonly number[], msg?: string) => {
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(got[i] - want[i]) < 1e-12, `${msg ?? 'vec'}[${i}]: got ${got[i]}, want ${want[i]}`);
  }
};

test('flyMoveDelta forward moves along the view direction', () => {
  // az=0, el=0 looks along +Z (dirFromAzEl convention).
  assertVecClose(flyMoveDelta({ azDeg: 0, elDeg: 0 }, moving({ forward: true }), 5), [0, 0, 5]);
  // Pitched up 90°: forward flies straight up — noclip, not ground-clamped.
  assertVecClose(flyMoveDelta({ azDeg: 0, elDeg: 90 }, moving({ forward: true }), 2), [0, 2, 0]);
});

test('flyMoveDelta back is the exact opposite of forward', () => {
  const look = { azDeg: 37, elDeg: -12 };
  const fwd = flyMoveDelta(look, moving({ forward: true }), 3);
  const back = flyMoveDelta(look, moving({ back: true }), 3);
  assertVecClose(back, [-fwd[0], -fwd[1], -fwd[2]]);
});

test('flyMoveDelta strafes along cross(dir, up) — screen right', () => {
  // At az=0 forward is +Z, so screen-right is -X (see the camera.ts drag note).
  assertVecClose(flyMoveDelta({ azDeg: 0, elDeg: 0 }, moving({ right: true }), 4), [-4, 0, 0]);
  assertVecClose(flyMoveDelta({ azDeg: 0, elDeg: 0 }, moving({ left: true }), 4), [4, 0, 0]);
  // Strafe stays horizontal (unit length) even when pitched.
  const d = flyMoveDelta({ azDeg: 0, elDeg: 60 }, moving({ right: true }), 4);
  assertVecClose(d, [-4, 0, 0], 'pitched strafe');
});

test('flyMoveDelta up/down move along the world up axis, not camera up', () => {
  assertVecClose(flyMoveDelta({ azDeg: 45, elDeg: -80 }, moving({ up: true }), 5), [0, 5, 0]);
  assertVecClose(flyMoveDelta({ azDeg: 45, elDeg: -80 }, moving({ down: true }), 5), [0, -5, 0]);
  // Custom up axis.
  assertVecClose(flyMoveDelta({ azDeg: 0, elDeg: 0 }, moving({ up: true }), 5, [0, 0, 1]), [0, 0, 5]);
});

test('flyMoveDelta: opposite keys cancel, combos sum', () => {
  assertVecClose(flyMoveDelta({ azDeg: 12, elDeg: 34 }, moving({ forward: true, back: true }), 5), [0, 0, 0]);
  const combo = flyMoveDelta({ azDeg: 0, elDeg: 0 }, moving({ forward: true, right: true, up: true }), 1);
  assertVecClose(combo, [-1, 1, 1], 'forward(+Z) + right(-X) + up(+Y)');
});

test('flyMoveDelta with no keys held is zero', () => {
  assertVecClose(flyMoveDelta({ azDeg: 123, elDeg: -45 }, NO_MOVE, 99), [0, 0, 0]);
});

test('dollyDelta moves along the view direction, signed', () => {
  assertVecClose(dollyDelta({ azDeg: 0, elDeg: 0 }, 2.5), [0, 0, 2.5]);
  assertVecClose(dollyDelta({ azDeg: 0, elDeg: 0 }, -2.5), [0, 0, -2.5]);
  // az=90 looks along +X.
  assertVecClose(dollyDelta({ azDeg: 90, elDeg: 0 }, 3), [3, 0, 0]);
});

test('dollyDelta magnitude equals |amount|', () => {
  const d = dollyDelta({ azDeg: 33, elDeg: 21 }, -7);
  assert.ok(Math.abs(Math.hypot(d[0], d[1], d[2]) - 7) < 1e-12);
});
