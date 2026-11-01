import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rasterScale, MAX_DPR, MAX_BACKING_PX } from './dag-view-math.ts';

test('no pinch: the device ratio, capped at MAX_DPR', () => {
  assert.equal(rasterScale(1, 1, 800, 600), 1);
  assert.equal(rasterScale(2, 1, 800, 600), 2);
  assert.equal(rasterScale(4, 1, 800, 600), MAX_DPR);
});

test('a pinch multiplies the ratio, so the magnified bitmap keeps one canvas pixel per device pixel', () => {
  assert.equal(rasterScale(1, 3, 800, 600), 3);
  assert.equal(rasterScale(2, 2, 800, 600), 4);
});

test('the pinch part stops at the pixel budget', () => {
  const s = rasterScale(2, 10, 1200, 700);
  assert.ok(Math.abs(1200 * 700 * s * s - MAX_BACKING_PX) < 1, `scale ${s} misses the budget`);
});

test('the budget never drops the scale under the no-pinch ratio', () => {
  // A full-screen canvas at 3x is over the budget already. A pinch must not make it worse than no pinch.
  assert.equal(rasterScale(3, 2, 3840, 2160), 3);
});

test('junk input reads as 1', () => {
  assert.equal(rasterScale(NaN, NaN, 0, 0), 1);
  assert.equal(rasterScale(0, 0.5, 100, 100), 1);
});
