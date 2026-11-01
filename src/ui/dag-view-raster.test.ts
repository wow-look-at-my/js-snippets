import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rasterScale, visibleCrop, MAX_DPR, MAX_BACKING_PX } from './dag-view-math.ts';

test('crop: a pinch into the middle of the element keeps only the part on screen', () => {
  assert.deepEqual(visibleCrop(100, 50, 800, 600, { left: 300, top: 200, width: 400, height: 300 }), { x: 200, y: 150, w: 400, h: 300 });
});

test('crop: the viewport over an edge of the element clips to the element', () => {
  assert.deepEqual(visibleCrop(100, 50, 800, 600, { left: 0, top: 0, width: 300, height: 200 }), { x: 0, y: 0, w: 200, h: 150 });
  assert.deepEqual(visibleCrop(100, 50, 800, 600, { left: 850, top: 600, width: 300, height: 200 }), { x: 750, y: 550, w: 50, h: 50 });
});

test('crop: fractional edges snap outward, so no visible pixel is left out', () => {
  assert.deepEqual(visibleCrop(0, 0, 800, 600, { left: 10.4, top: 20.6, width: 100.2, height: 50.1 }), { x: 10, y: 20, w: 101, h: 51 });
});

test('crop: an element out of the viewport gets a 1 x 1 canvas', () => {
  assert.deepEqual(visibleCrop(2000, 0, 800, 600, { left: 0, top: 0, width: 400, height: 300 }), { x: 0, y: 0, w: 1, h: 1 });
});

test('no pinch: the device ratio, capped at MAX_DPR', () => {
  assert.equal(rasterScale(1, 1, 800, 600), 1);
  assert.equal(rasterScale(2, 1, 800, 600), 2);
  assert.equal(rasterScale(4, 1, 800, 600), MAX_DPR);
});

test('a pinch multiplies the ratio, so the magnified bitmap keeps one canvas pixel per device pixel', () => {
  assert.equal(rasterScale(1, 3, 800, 600), 3);
  assert.equal(rasterScale(2, 2, 800, 600), 4);
});

test('a pinch rounds up to a half step, so a gesture does not reallocate the canvas on every event', () => {
  assert.equal(rasterScale(1, 1.1, 800, 600), 1.5);
  assert.equal(rasterScale(1, 1.4, 800, 600), 1.5);
  assert.equal(rasterScale(1, 1.6, 800, 600), 2);
  assert.equal(rasterScale(2, 1.5, 800, 600), 3);
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
