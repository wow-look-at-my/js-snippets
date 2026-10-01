// Tests for the pure fit maths behind rasterising a source into a frame.
// `rasterizeToRgba` itself needs a canvas and is left to browser use.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clampSize, fitRect } from './raster.ts';

test('contain fits the whole source and centres it', () => {
  // 2:1 source into a square: full width, half height, centred vertically.
  assert.deepEqual(fitRect(200, 100, 100, 100, 'contain'), { x: 0, y: 25, w: 100, h: 50 });
  // 1:2 source into a square: full height, half width.
  assert.deepEqual(fitRect(100, 200, 100, 100, 'contain'), { x: 25, y: 0, w: 50, h: 100 });
});

test('contain never overflows the canvas', () => {
  for (const [sw, sh] of [[16, 9], [9, 16], [1, 100], [100, 1], [640, 480]]) {
    const r = fitRect(sw, sh, 300, 200, 'contain');
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9, `origin ${r.x},${r.y}`);
    assert.ok(r.x + r.w <= 300 + 1e-9 && r.y + r.h <= 200 + 1e-9, `extent ${r.w}x${r.h}`);
  }
});

test('cover fills the canvas in both axes', () => {
  for (const [sw, sh] of [[16, 9], [9, 16], [1, 100], [640, 480]]) {
    const r = fitRect(sw, sh, 300, 200, 'cover');
    assert.ok(r.w >= 300 - 1e-9 && r.h >= 200 - 1e-9, `${r.w}x${r.h} does not cover 300x200`);
  }
});

test('contain and cover preserve the aspect ratio; stretch does not', () => {
  for (const mode of ['contain', 'cover'] as const) {
    const r = fitRect(200, 100, 300, 300, mode);
    assert.ok(Math.abs(r.w / r.h - 2) < 1e-9, `${mode} skewed to ${r.w}x${r.h}`);
  }
  assert.deepEqual(fitRect(200, 100, 300, 300, 'stretch'), { x: 0, y: 0, w: 300, h: 300 });
});

test('a matching aspect ratio fills exactly under every mode', () => {
  for (const mode of ['contain', 'cover', 'stretch'] as const) {
    assert.deepEqual(fitRect(100, 50, 200, 100, mode), { x: 0, y: 0, w: 200, h: 100 }, mode);
  }
});

test('fitRect rejects a degenerate source', () => {
  assert.throws(() => fitRect(0, 10, 100, 100), /source size must be positive/);
  assert.throws(() => fitRect(10, -1, 100, 100), /source size must be positive/);
});

test('clampSize scales the long side down to the cap and keeps the ratio', () => {
  assert.deepEqual(clampSize(1600, 900, 800), { width: 800, height: 450 });
  assert.deepEqual(clampSize(900, 1600, 800), { width: 450, height: 800 });
});

test('clampSize never scales up', () => {
  assert.deepEqual(clampSize(100, 50, 800), { width: 100, height: 50 });
});

test('clampSize keeps a very thin source at least one pixel wide', () => {
  const { width, height } = clampSize(4000, 3, 100);
  assert.equal(width, 100);
  assert.ok(height >= 1, `height ${height}`);
});

test('clampSize rejects a degenerate size', () => {
  assert.throws(() => clampSize(0, 10, 100), /size must be positive/);
});
