// Tests for inter-frame differencing.
//
// The properties that matter are the ones a wrong answer would corrupt output
// with rather than merely make it bigger: the rectangle must COVER every
// changed pixel (a tight-but-wrong box drops pixels silently), the threshold
// must be symmetric, and `composite` must reproduce exactly what a decoder
// does — it is the encoder's model of the screen, and a mismatch there lets
// error accumulate frame over frame.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composite, cropRect, cropRectMasked, diffFrames, type Rect } from './diff.ts';

const W = 8;
const H = 6;

function blank(fill = 0): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  px.fill(fill);
  return px;
}

function setPixel(px: Uint8Array, x: number, y: number, rgba: readonly number[]): void {
  const i = (y * W + x) * 4;
  px[i] = rgba[0];
  px[i + 1] = rgba[1];
  px[i + 2] = rgba[2];
  px[i + 3] = rgba[3];
}

function getPixel(px: Uint8Array, x: number, y: number, width = W): number[] {
  const i = (y * width + x) * 4;
  return [px[i], px[i + 1], px[i + 2], px[i + 3]];
}

test('an unchanged frame diffs to null', () => {
  const a = blank();
  assert.equal(diffFrames(a, a.slice(), W, H, { threshold: 0 }), null);
});

test('the rectangle is the tight bounding box of the changed pixels', () => {
  const a = blank();
  const b = a.slice();
  setPixel(b, 2, 1, [255, 0, 0, 255]);
  setPixel(b, 5, 4, [0, 255, 0, 255]);
  const diff = diffFrames(a, b, W, H, { threshold: 0 });
  assert.ok(diff);
  assert.deepEqual(diff.rect, { x: 2, y: 1, w: 4, h: 4 });
  assert.equal(diff.changed, 2);
});

test('the rectangle covers every changed pixel', () => {
  const a = blank();
  const b = a.slice();
  const marks: [number, number][] = [[0, 0], [7, 5], [3, 2]];
  for (const [x, y] of marks) setPixel(b, x, y, [1, 2, 3, 255]);
  const diff = diffFrames(a, b, W, H, { threshold: 0 });
  assert.ok(diff);
  for (const [x, y] of marks) {
    assert.ok(
      x >= diff.rect.x && x < diff.rect.x + diff.rect.w &&
      y >= diff.rect.y && y < diff.rect.y + diff.rect.h,
      `(${x},${y}) outside ${JSON.stringify(diff.rect)}`,
    );
  }
});

test('a change of exactly the threshold is not a change; one more is', () => {
  const a = blank(100);
  const b = a.slice();
  setPixel(b, 3, 3, [102, 100, 100, 100]);
  assert.equal(diffFrames(a, b, W, H, { threshold: 2 }), null);

  const c = a.slice();
  setPixel(c, 3, 3, [103, 100, 100, 100]);
  const diff = diffFrames(a, c, W, H, { threshold: 2 });
  assert.ok(diff);
  assert.deepEqual(diff.rect, { x: 3, y: 3, w: 1, h: 1 });
});

test('the threshold is symmetric in both directions', () => {
  const a = blank(100);
  const down = a.slice();
  setPixel(down, 1, 1, [97, 100, 100, 100]);
  assert.ok(diffFrames(a, down, W, H, { threshold: 2 }));
  const up = a.slice();
  setPixel(up, 1, 1, [103, 100, 100, 100]);
  assert.ok(diffFrames(a, up, W, H, { threshold: 2 }));
});

test('alpha has its own threshold', () => {
  const a = blank(100);
  const b = a.slice();
  setPixel(b, 1, 1, [100, 100, 100, 110]);
  assert.equal(diffFrames(a, b, W, H, { threshold: 0, alphaThreshold: 20 }), null);
  assert.ok(diffFrames(a, b, W, H, { threshold: 0, alphaThreshold: 5 }));
});

test('opaque is false as soon as one changed pixel is not fully opaque', () => {
  const a = blank();
  const opaque = a.slice();
  setPixel(opaque, 1, 1, [10, 20, 30, 255]);
  assert.equal(diffFrames(a, opaque, W, H, { threshold: 0 })?.opaque, true);

  const translucent = a.slice();
  setPixel(translucent, 1, 1, [10, 20, 30, 255]);
  setPixel(translucent, 2, 2, [10, 20, 30, 128]);
  assert.equal(diffFrames(a, translucent, W, H, { threshold: 0 })?.opaque, false);
});

test('cropRect copies the rectangle verbatim', () => {
  const src = blank();
  setPixel(src, 2, 1, [9, 8, 7, 255]);
  const rect: Rect = { x: 2, y: 1, w: 3, h: 2 };
  const out = cropRect(src, W, rect);
  assert.equal(out.length, 3 * 2 * 4);
  assert.deepEqual(getPixel(out, 0, 0, 3), [9, 8, 7, 255]);
  assert.deepEqual(getPixel(out, 1, 0, 3), [0, 0, 0, 0]);
});

test('cropRectMasked keeps changed pixels and zeroes the rest', () => {
  const canvas = blank(40);
  const next = canvas.slice();
  setPixel(next, 2, 1, [200, 200, 200, 255]);
  const rect: Rect = { x: 1, y: 1, w: 3, h: 1 };
  const out = cropRectMasked(canvas, next, W, rect, { threshold: 2 });
  assert.deepEqual(getPixel(out, 0, 0, 3), [0, 0, 0, 0]);
  assert.deepEqual(getPixel(out, 1, 0, 3), [200, 200, 200, 255]);
  assert.deepEqual(getPixel(out, 2, 0, 3), [0, 0, 0, 0]);
});

test('cropRectMasked fills unchanged pixels with the requested transparent colour', () => {
  const canvas = blank(40);
  const next = canvas.slice();
  setPixel(next, 1, 1, [200, 200, 200, 255]);
  const out = cropRectMasked(canvas, next, W, { x: 1, y: 1, w: 2, h: 1 }, { threshold: 2 }, [7, 8, 9, 0]);
  assert.deepEqual(getPixel(out, 0, 0, 2), [200, 200, 200, 255]);
  assert.deepEqual(getPixel(out, 1, 0, 2), [7, 8, 9, 0]);
});

test('composite source replaces the rectangle outright', () => {
  const canvas = blank(40);
  const payload = new Uint8Array(2 * 1 * 4);
  payload.fill(200);
  composite(canvas, W, { x: 3, y: 2, w: 2, h: 1 }, payload, 'source');
  assert.deepEqual(getPixel(canvas, 3, 2), [200, 200, 200, 200]);
  assert.deepEqual(getPixel(canvas, 5, 2), [40, 40, 40, 40]);
});

test('composite over leaves the canvas where the payload is transparent', () => {
  const canvas = blank(40);
  const payload = new Uint8Array(2 * 1 * 4);
  payload.set([1, 2, 3, 255], 0); // opaque
  payload.set([9, 9, 9, 0], 4); // transparent
  composite(canvas, W, { x: 3, y: 2, w: 2, h: 1 }, payload, 'over');
  assert.deepEqual(getPixel(canvas, 3, 2), [1, 2, 3, 255]);
  assert.deepEqual(getPixel(canvas, 4, 2), [40, 40, 40, 40]);
});

test('composite over blends a translucent source the way the APNG spec states', () => {
  const canvas = blank(0);
  setPixel(canvas, 0, 0, [0, 0, 0, 255]); // opaque black underneath
  const payload = Uint8Array.from([255, 255, 255, 128]);
  composite(canvas, W, { x: 0, y: 0, w: 1, h: 1 }, payload, 'over');
  const [r, g, b, a] = getPixel(canvas, 0, 0);
  assert.equal(a, 255);
  // 128/255 of white over black: ~128 on every channel.
  for (const c of [r, g, b]) assert.ok(Math.abs(c - 128) <= 1, `channel ${c}`);
});

test('cropRectMasked and diffFrames agree on which pixels changed', () => {
  const canvas = blank(50);
  const next = canvas.slice();
  let seed = 12345;
  for (let i = 0; i < next.length; i += 4) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    if (seed % 5 === 0) {
      const v = (seed >>> 16) & 0xff;
      next[i] = v;
      next[i + 1] = v;
      next[i + 2] = v;
      next[i + 3] = 255;
    }
  }
  const opts = { threshold: 2 };
  const diff = diffFrames(canvas, next, W, H, opts);
  assert.ok(diff);
  const masked = cropRectMasked(canvas, next, W, diff.rect, opts);
  let nonTransparent = 0;
  for (let o = 3; o < masked.length; o += 4) if (masked[o] !== 0) nonTransparent++;
  assert.equal(nonTransparent, diff.changed);
});
