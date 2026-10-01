// Tests for exact palette detection.
//
// The load-bearing property is that palettising is LOSSLESS: every colour in
// the input round-trips through the palette unchanged, or no palette is built
// at all. A palette that quietly drops a rare colour would produce a file that
// decodes fine and shows the wrong pixels.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPalette, indexImage, packRgba } from './palette.ts';

function imageOf(pixels: readonly (readonly number[])[]): Uint8Array {
  const out = new Uint8Array(pixels.length * 4);
  pixels.forEach((p, i) => out.set(p, i * 4));
  return out;
}

test('packRgba is order-preserving and endian-independent', () => {
  assert.equal(packRgba(0, 0, 0, 0), 0);
  assert.equal(packRgba(255, 255, 255, 255), 0xffffffff);
  assert.equal(packRgba(0x12, 0x34, 0x56, 0x78), 0x12345678);
});

test('a small palette covers every colour and round-trips exactly', () => {
  const img = imageOf([
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 128],
  ]);
  const palette = buildPalette([img]);
  assert.ok(palette);
  const indexed = indexImage(img, palette);
  assert.equal(indexed.length, 4);
  for (let p = 0; p < 4; p++) {
    const idx = indexed[p];
    for (let c = 0; c < 4; c++) {
      assert.equal(palette.rgba[idx * 4 + c], img[p * 4 + c], `pixel ${p} channel ${c}`);
    }
  }
});

test('non-opaque entries come first so tRNS is a short prefix', () => {
  const img = imageOf([
    [10, 10, 10, 255],
    [20, 20, 20, 255],
    [30, 30, 30, 128],
    [40, 40, 40, 0],
  ]);
  const palette = buildPalette([img]);
  assert.ok(palette);
  for (let i = 0; i < palette.trnsCount; i++) {
    assert.notEqual(palette.rgba[i * 4 + 3], 255, `entry ${i} in the tRNS prefix is opaque`);
  }
  for (let i = palette.trnsCount; i < palette.size; i++) {
    assert.equal(palette.rgba[i * 4 + 3], 255, `entry ${i} past the tRNS prefix is not opaque`);
  }
  assert.equal(palette.trnsCount, 2);
});

test('a transparent entry is reserved even when the images are fully opaque', () => {
  const img = imageOf([[1, 2, 3, 255], [4, 5, 6, 255]]);
  const palette = buildPalette([img]);
  assert.ok(palette);
  assert.ok(palette.transparentIndex >= 0);
  assert.equal(palette.rgba[palette.transparentIndex * 4 + 3], 0);
  assert.equal(palette.size, 3);
});

test('an existing transparent colour is used instead of adding another', () => {
  const img = imageOf([[9, 9, 9, 0], [1, 2, 3, 255]]);
  const palette = buildPalette([img]);
  assert.ok(palette);
  assert.equal(palette.size, 2);
  assert.equal(palette.transparentIndex, 0);
  assert.deepEqual([...palette.rgba.subarray(0, 4)], [9, 9, 9, 0]);
});

test('opaque input fits 255 colours but not 256, leaving room for the sentinel', () => {
  const fits = imageOf(Array.from({ length: 255 }, (_, i) => [i, 0, 0, 255]));
  assert.ok(buildPalette([fits]));
  const overflows = imageOf(Array.from({ length: 256 }, (_, i) => [i, 0, 0, 255]));
  assert.equal(buildPalette([overflows]), null);
});

test('a palette never exceeds 256 entries', () => {
  const img = imageOf(Array.from({ length: 255 }, (_, i) => [i, 0, 0, 255]));
  const palette = buildPalette([img]);
  assert.ok(palette);
  assert.ok(palette.size <= 256, `size ${palette.size}`);
  assert.equal(palette.rgba.length, palette.size * 4);
});

test('the colour budget spans every image, not each one alone', () => {
  const a = imageOf(Array.from({ length: 200 }, (_, i) => [i, 0, 0, 255]));
  const b = imageOf(Array.from({ length: 200 }, (_, i) => [0, i, 0, 255]));
  assert.ok(buildPalette([a]));
  assert.ok(buildPalette([b]));
  assert.equal(buildPalette([a, b]), null);
});

test('too many colours returns null rather than a lossy approximation', () => {
  const img = imageOf(Array.from({ length: 1000 }, (_, i) => [i & 0xff, (i >> 4) & 0xff, i & 0x7, 255]));
  assert.equal(buildPalette([img]), null);
});

test('indexImage throws on a colour the palette does not contain', () => {
  const palette = buildPalette([imageOf([[1, 2, 3, 255]])]);
  assert.ok(palette);
  assert.throws(() => indexImage(imageOf([[9, 9, 9, 255]]), palette), /not in the palette/);
});

test('the most-used opaque colour sorts ahead of a rare one', () => {
  const img = imageOf([
    [1, 1, 1, 255],
    [1, 1, 1, 255],
    [1, 1, 1, 255],
    [2, 2, 2, 255],
  ]);
  const palette = buildPalette([img]);
  assert.ok(palette);
  const common = palette.lookup.get(packRgba(1, 1, 1, 255));
  const rare = palette.lookup.get(packRgba(2, 2, 2, 255));
  assert.ok(common !== undefined && rare !== undefined);
  assert.ok(common < rare, `common ${common} should sort before rare ${rare}`);
});
