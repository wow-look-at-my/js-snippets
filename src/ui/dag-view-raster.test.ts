import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rasterScale, visibleCrop } from './dag-view-math.ts';

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

test('crop: a tall element in a short window keeps only the window', () => {
  assert.deepEqual(visibleCrop(0, -1200, 300, 2400, { left: 0, top: 0, width: 1300, height: 500 }), { x: 0, y: 1200, w: 300, h: 500 });
});

test('scale: one canvas pixel per screen pixel, the device ratio times the pinch, with no cap', () => {
  assert.equal(rasterScale(1, 1), 1);
  assert.equal(rasterScale(2, 1), 2);
  assert.equal(rasterScale(4, 1), 4);
  assert.equal(rasterScale(2, 3), 6);
  assert.equal(rasterScale(2, 10), 20);
});

test('scale x crop never backs more pixels than the screen shows', () => {
  const dpr = 2;
  const pinch = 5;
  const crop = visibleCrop(0, 0, 3000, 2000, { left: 400.3, top: 300.7, width: 1440 / pinch, height: 900 / pinch });
  const s = rasterScale(dpr, pinch);
  const w = Math.round(crop.w * s);
  const h = Math.round(crop.h * s);
  // Snapping the crop out to whole CSS pixels adds at most one CSS pixel on each side.
  assert.ok(w <= 1440 * dpr + 2 * s && h <= 900 * dpr + 2 * s, `backed ${w} x ${h} for a ${1440 * dpr} x ${900 * dpr} screen`);
});

test('junk input reads as 1', () => {
  assert.equal(rasterScale(NaN, NaN), 1);
  assert.equal(rasterScale(0, 0.5), 1);
});
