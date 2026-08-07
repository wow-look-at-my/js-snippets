// Tests for the APNG encoder.
//
// The oracle is a decoder. Every optimisation here — dirty rectangles,
// transparent skipping, palettes, frame coalescing — changes what is stored
// without being allowed to change what is SEEN, and the only way to check that
// is to decode the file back and replay it. So this file carries a small,
// independent APNG reader (chunk walk with CRC verification, inflate, unfilter,
// composite) and asserts the replayed frames match the originals.
//
// Asserting on the encoder's own stats instead would prove only that it agrees
// with itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crc32, PNG_SIGNATURE, unfilterScanlines } from './png.ts';
import { composite, type Rect } from './diff.ts';
import { delayFraction, encodeApng, type ApngFrame } from './encoder.ts';

// -- A minimal APNG decoder, used only as this file's oracle --------------------

interface DecodedFrame {
  /** The full canvas as it stands once this frame has been composited. */
  rgba: Uint8Array;
  delayMs: number;
  rect: Rect;
  blend: 'source' | 'over';
}

interface Decoded {
  width: number;
  height: number;
  colorType: number;
  paletteSize: number;
  declaredFrames: number;
  loops: number;
  frames: DecodedFrame[];
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const done = new Response(ds.readable).arrayBuffer();
  const writer = ds.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
  const write = writer.write(bytes).then(() => writer.close());
  const [buffer] = await Promise.all([done, write]);
  return new Uint8Array(buffer);
}

interface Chunk {
  type: string;
  data: Uint8Array;
}

function readChunks(bytes: Uint8Array): Chunk[] {
  for (let i = 0; i < 8; i++) {
    assert.equal(bytes[i], PNG_SIGNATURE[i], `signature byte ${i}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let at = 8;
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    const stored = view.getUint32(at + 8 + length);
    assert.equal(stored, crc32(bytes.subarray(at + 4, at + 8 + length)), `CRC of ${type} chunk`);
    chunks.push({ type, data });
    at += 12 + length;
  }
  assert.equal(chunks[chunks.length - 1].type, 'IEND');
  return chunks;
}

async function decodeApng(bytes: Uint8Array): Promise<Decoded> {
  const chunks = readChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  assert.ok(ihdr, 'no IHDR');
  const hv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = hv.getUint32(0);
  const height = hv.getUint32(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  assert.equal(bitDepth, 8);
  assert.ok(colorType === 6 || colorType === 3, `unexpected colour type ${colorType}`);
  assert.equal(ihdr.data[10], 0, 'compression method');
  assert.equal(ihdr.data[11], 0, 'filter method');
  assert.equal(ihdr.data[12], 0, 'interlace');

  const plte = chunks.find((c) => c.type === 'PLTE');
  const trns = chunks.find((c) => c.type === 'tRNS');
  let palette: Uint8Array | null = null;
  if (colorType === 3) {
    assert.ok(plte, 'indexed PNG without PLTE');
    const n = plte.data.length / 3;
    palette = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      palette[i * 4] = plte.data[i * 3];
      palette[i * 4 + 1] = plte.data[i * 3 + 1];
      palette[i * 4 + 2] = plte.data[i * 3 + 2];
      palette[i * 4 + 3] = trns && i < trns.data.length ? trns.data[i] : 255;
    }
  }

  const actl = chunks.find((c) => c.type === 'acTL');
  assert.ok(actl, 'no acTL');
  const av = new DataView(actl.data.buffer, actl.data.byteOffset, actl.data.byteLength);
  const declaredFrames = av.getUint32(0);
  const loops = av.getUint32(4);
  assert.ok(
    chunks.indexOf(actl) < chunks.findIndex((c) => c.type === 'IDAT'),
    'acTL must precede IDAT',
  );

  // Walk fcTL / IDAT / fdAT in stream order, checking sequence numbers.
  interface Raw { rect: Rect; delayMs: number; blend: 'source' | 'over'; payload: Uint8Array }
  const raws: Raw[] = [];
  let expectedSeq = 0;
  let current: Omit<Raw, 'payload'> | null = null;
  for (const chunk of chunks) {
    if (chunk.type === 'fcTL') {
      const v = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
      assert.equal(v.getUint32(0), expectedSeq++, 'fcTL sequence number');
      const delayNum = v.getUint16(20);
      const delayDen = v.getUint16(22) || 100;
      assert.equal(chunk.data[24], 0, 'dispose_op');
      current = {
        rect: { w: v.getUint32(4), h: v.getUint32(8), x: v.getUint32(12), y: v.getUint32(16) },
        delayMs: (delayNum / delayDen) * 1000,
        blend: chunk.data[25] === 1 ? 'over' : 'source',
      };
    } else if (chunk.type === 'IDAT') {
      assert.ok(current, 'IDAT without a preceding fcTL');
      assert.deepEqual(current.rect, { x: 0, y: 0, w: width, h: height }, 'frame 0 must be full size');
      raws.push({ ...current, payload: chunk.data });
      current = null;
    } else if (chunk.type === 'fdAT') {
      assert.ok(current, 'fdAT without a preceding fcTL');
      const v = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
      assert.equal(v.getUint32(0), expectedSeq++, 'fdAT sequence number');
      raws.push({ ...current, payload: chunk.data.subarray(4) });
      current = null;
    }
  }
  assert.equal(current, null, 'trailing fcTL with no image data');

  const canvas = new Uint8Array(width * height * 4);
  const frames: DecodedFrame[] = [];
  for (const raw of raws) {
    assert.ok(
      raw.rect.x + raw.rect.w <= width && raw.rect.y + raw.rect.h <= height,
      `frame rectangle ${JSON.stringify(raw.rect)} leaves the canvas`,
    );
    const bpp = palette ? 1 : 4;
    const inflated = await inflate(raw.payload);
    const stride = raw.rect.w * bpp;
    assert.equal(inflated.length, (stride + 1) * raw.rect.h, 'inflated scanline size');
    const flat = unfilterScanlines(inflated, stride, raw.rect.h, bpp);
    let sub: Uint8Array;
    if (palette) {
      sub = new Uint8Array(raw.rect.w * raw.rect.h * 4);
      for (let p = 0; p < flat.length; p++) {
        const idx = flat[p];
        assert.ok(idx * 4 < palette.length, `palette index ${idx} out of range`);
        sub.set(palette.subarray(idx * 4, idx * 4 + 4), p * 4);
      }
    } else {
      sub = flat;
    }
    composite(canvas, width, raw.rect, sub, raw.blend);
    frames.push({ rgba: canvas.slice(), delayMs: raw.delayMs, rect: raw.rect, blend: raw.blend });
  }

  return {
    width, height, colorType,
    paletteSize: palette ? palette.length / 4 : 0,
    declaredFrames, loops, frames,
  };
}

// -- Fixtures ------------------------------------------------------------------

const W = 40;
const H = 24;

/** A static gradient background with an opaque square at (x, y). */
function sceneFrame(x: number, y: number, size = 6, alpha = 255): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  for (let py = 0; py < H; py++) {
    for (let pxx = 0; pxx < W; pxx++) {
      const i = (py * W + pxx) * 4;
      px[i] = (pxx * 4) & 0xff;
      px[i + 1] = (py * 8) & 0xff;
      px[i + 2] = 64;
      px[i + 3] = 255;
    }
  }
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const i = ((y + dy) * W + (x + dx)) * 4;
      px[i] = 255;
      px[i + 1] = 0;
      px[i + 2] = 0;
      px[i + 3] = alpha;
    }
  }
  return px;
}

function walkFrames(count: number, alpha = 255): ApngFrame[] {
  return Array.from({ length: count }, (_, i) => ({ data: sceneFrame(2 + i * 3, 5, 6, alpha) }));
}

/** Largest per-channel difference between two RGBA images. */
function maxChannelDelta(a: Uint8Array, b: Uint8Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

// -- Tests ---------------------------------------------------------------------

test('delayFraction keeps millisecond precision and stays inside uint16', () => {
  assert.deepEqual(delayFraction(100), { num: 100, den: 1000 });
  assert.deepEqual(delayFraction(33), { num: 33, den: 1000 });
  assert.deepEqual(delayFraction(0), { num: 0, den: 1000 });
  for (const ms of [1, 16, 65, 65535, 65536, 100000, 600000, 10_000_000]) {
    const { num, den } = delayFraction(ms);
    assert.ok(num >= 0 && num <= 0xffff, `num ${num} out of range for ${ms}ms`);
    assert.ok(den >= 1 && den <= 0xffff, `den ${den} out of range for ${ms}ms`);
    const decoded = (num / den) * 1000;
    assert.ok(Math.abs(decoded - ms) <= ms * 0.01 + 1, `${ms}ms decoded as ${decoded}ms`);
  }
});

test('threshold 0 reproduces every frame exactly', async () => {
  const frames = walkFrames(5);
  const result = await encodeApng(W, H, frames, { threshold: 0, colorType: 'rgba' });
  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.width, W);
  assert.equal(decoded.height, H);
  assert.equal(decoded.frames.length, frames.length);
  assert.equal(decoded.declaredFrames, frames.length);
  for (let i = 0; i < frames.length; i++) {
    assert.equal(
      maxChannelDelta(decoded.frames[i].rgba, frames[i].data as Uint8Array), 0,
      `frame ${i} differs`,
    );
  }
});

test('a non-zero threshold stays within itself on every pixel of every frame', async () => {
  // Add ±2 dither so a thresholding encoder has something to ignore.
  let seed = 99;
  const frames = walkFrames(6).map((f) => {
    const px = (f.data as Uint8Array).slice();
    for (let i = 0; i < px.length; i += 4) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const d = ((seed >>> 20) % 5) - 2;
      for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, px[i + c] + d));
    }
    return { data: px };
  });
  const threshold = 2;
  const result = await encodeApng(W, H, frames, { threshold, colorType: 'rgba' });
  const decoded = await decodeApng(result.bytes);

  let out = 0;
  for (const stat of result.frames) {
    for (let k = 0; k <= stat.coalesced; k++) {
      assert.ok(
        maxChannelDelta(decoded.frames[out].rgba, frames[stat.sourceIndex + k].data as Uint8Array) <= threshold,
        `source frame ${stat.sourceIndex + k} drifted past the threshold`,
      );
    }
    out++;
  }
});

test('every source frame is accounted for, in order', async () => {
  const frames = [...walkFrames(3), { data: sceneFrame(2 + 2 * 3, 5) }, ...walkFrames(2)];
  const result = await encodeApng(W, H, frames, { threshold: 0 });
  let expected = 0;
  for (const stat of result.frames) {
    assert.equal(stat.sourceIndex, expected, 'frames must stay in source order');
    expected += 1 + stat.coalesced;
  }
  assert.equal(expected, frames.length);
  assert.equal(result.sourceFrameCount, frames.length);
});

test('identical frames coalesce into one frame with the delays added up', async () => {
  const still = sceneFrame(4, 4);
  const frames: ApngFrame[] = [
    { data: still, delayMs: 40 },
    { data: still.slice(), delayMs: 60 },
    { data: still.slice(), delayMs: 100 },
    { data: sceneFrame(10, 4), delayMs: 40 },
  ];
  const result = await encodeApng(W, H, frames, { threshold: 0 });
  assert.equal(result.frameCount, 2);
  assert.equal(result.frames[0].delayMs, 200);
  assert.equal(result.frames[0].coalesced, 2);

  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.frames.length, 2);
  assert.ok(Math.abs(decoded.frames[0].delayMs - 200) < 1);
  assert.ok(Math.abs(decoded.frames[1].delayMs - 40) < 1);
});

test('coalescing off keeps every frame, and the still ones stay tiny', async () => {
  const still = sceneFrame(4, 4);
  const frames: ApngFrame[] = [{ data: still }, { data: still.slice() }, { data: still.slice() }];
  const result = await encodeApng(W, H, frames, { threshold: 0, coalesce: false });
  assert.equal(result.frameCount, 3);
  for (const stat of result.frames.slice(1)) {
    assert.deepEqual(stat.rect, { x: 0, y: 0, w: 1, h: 1 });
  }
  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.frames.length, 3);
  for (const frame of decoded.frames) {
    assert.equal(maxChannelDelta(frame.rgba, still), 0);
  }
});

test('the dirty rectangle is the changed area, not the whole canvas', async () => {
  const a = sceneFrame(4, 4);
  const b = a.slice();
  const i = (10 * W + 20) * 4;
  b[i] = 0;
  b[i + 1] = 255;
  b[i + 2] = 255;
  const result = await encodeApng(W, H, [{ data: a }, { data: b }], { threshold: 0 });
  assert.deepEqual(result.frames[0].rect, { x: 0, y: 0, w: W, h: H });
  assert.deepEqual(result.frames[1].rect, { x: 20, y: 10, w: 1, h: 1 });
  assert.ok(result.frames[1].bytes < result.frames[0].bytes / 4);
});

test('an opaque partial change uses OVER; a translucent one falls back to SOURCE', async () => {
  const opaque = await encodeApng(W, H, walkFrames(3), { threshold: 0, colorType: 'rgba' });
  assert.equal(opaque.frames[1].blend, 'over');

  const translucent = await encodeApng(W, H, walkFrames(3, 128), { threshold: 0, colorType: 'rgba' });
  assert.equal(translucent.frames[1].blend, 'source');
  const decoded = await decodeApng(translucent.bytes);
  const sources = walkFrames(3, 128);
  for (let i = 0; i < 3; i++) {
    assert.equal(maxChannelDelta(decoded.frames[i].rgba, sources[i].data as Uint8Array), 0, `frame ${i}`);
  }
});

test('few-colour frames become an indexed PNG and still decode exactly', async () => {
  const flat = (shift: number): Uint8Array => {
    const px = new Uint8Array(W * H * 4);
    for (let p = 0; p < W * H; p++) {
      const on = ((p + shift) >> 3) % 2 === 0;
      px.set(on ? [200, 30, 30, 255] : [20, 20, 40, 255], p * 4);
    }
    return px;
  };
  const frames = [{ data: flat(0) }, { data: flat(4) }, { data: flat(8) }];
  const result = await encodeApng(W, H, frames, { threshold: 0 });
  assert.equal(result.colorType, 'indexed');
  assert.equal(result.paletteSize, 3); // two colours plus the transparent sentinel

  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.colorType, 3);
  for (let i = 0; i < frames.length; i++) {
    assert.equal(maxChannelDelta(decoded.frames[i].rgba, frames[i].data as Uint8Array), 0, `frame ${i}`);
  }
});

test('indexed output beats RGBA on few-colour frames', async () => {
  const flat = (shift: number): Uint8Array => {
    const px = new Uint8Array(W * H * 4);
    for (let p = 0; p < W * H; p++) {
      px.set(((p + shift) >> 3) % 2 === 0 ? [200, 30, 30, 255] : [20, 20, 40, 255], p * 4);
    }
    return px;
  };
  const frames = [{ data: flat(0) }, { data: flat(5) }];
  const indexed = await encodeApng(W, H, frames, { threshold: 0, colorType: 'auto' });
  const rgba = await encodeApng(W, H, frames, { threshold: 0, colorType: 'rgba' });
  assert.equal(indexed.colorType, 'indexed');
  assert.equal(rgba.colorType, 'rgba');
  assert.ok(indexed.bytes.length < rgba.bytes.length, `${indexed.bytes.length} vs ${rgba.bytes.length}`);
});

test('a many-colour frame stays RGBA under colorType auto', async () => {
  const noisy = new Uint8Array(W * H * 4);
  let seed = 7;
  for (let i = 0; i < noisy.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    noisy[i] = seed & 0xff;
    noisy[i + 1] = (seed >>> 8) & 0xff;
    noisy[i + 2] = (seed >>> 16) & 0xff;
    noisy[i + 3] = 255;
  }
  const result = await encodeApng(W, H, [{ data: noisy }], { threshold: 0 });
  assert.equal(result.colorType, 'rgba');
  assert.equal((await decodeApng(result.bytes)).colorType, 6);
});

test('colorType "indexed" fails loudly rather than quantising', async () => {
  const noisy = new Uint8Array(W * H * 4);
  for (let i = 0; i < noisy.length; i += 4) {
    noisy[i] = (i / 4) & 0xff;
    noisy[i + 1] = (i / 8) & 0xff;
    noisy[i + 2] = (i / 16) & 0xff;
    noisy[i + 3] = 255;
  }
  await assert.rejects(
    () => encodeApng(W, H, [{ data: noisy }], { colorType: 'indexed' }),
    /more than 256 distinct colours/,
  );
});

test('effort "best" is never larger than "fast"', async () => {
  const frames = walkFrames(4);
  const fast = await encodeApng(W, H, frames, { threshold: 0, effort: 'fast', colorType: 'rgba' });
  const best = await encodeApng(W, H, frames, { threshold: 0, effort: 'best', colorType: 'rgba' });
  assert.ok(best.bytes.length <= fast.bytes.length, `${best.bytes.length} vs ${fast.bytes.length}`);
  const decoded = await decodeApng(best.bytes);
  for (let i = 0; i < frames.length; i++) {
    assert.equal(maxChannelDelta(decoded.frames[i].rgba, frames[i].data as Uint8Array), 0, `frame ${i}`);
  }
});

test('differencing beats storing every frame whole', async () => {
  // A noisy background is the honest fixture: a smooth gradient compresses so
  // well whole that storing it eight times would also look cheap, and the test
  // would pass without differencing doing anything.
  const noise = new Uint8Array(W * H * 4);
  let seed = 4242;
  for (let i = 0; i < noise.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    noise[i] = seed & 0xff;
    noise[i + 1] = (seed >>> 8) & 0xff;
    noise[i + 2] = (seed >>> 16) & 0xff;
    noise[i + 3] = 255;
  }
  const frames: ApngFrame[] = Array.from({ length: 8 }, (_, k) => {
    const px = noise.slice();
    for (let dy = 0; dy < 5; dy++) {
      for (let dx = 0; dx < 5; dx++) {
        px.set([255, 255, 255, 255], ((6 + dy) * W + (2 + k * 4 + dx)) * 4);
      }
    }
    return { data: px };
  });

  const result = await encodeApng(W, H, frames, { threshold: 0, colorType: 'rgba' });
  const keyframe = result.frames[0].bytes;
  const laterBytes = result.frames.slice(1).reduce((s, f) => s + f.bytes, 0);
  // Seven more frames of a static scene cost a fraction of one whole frame.
  assert.ok(laterBytes < keyframe / 4, `${laterBytes} vs one whole frame at ${keyframe}`);

  const decoded = await decodeApng(result.bytes);
  for (let i = 0; i < frames.length; i++) {
    assert.equal(maxChannelDelta(decoded.frames[i].rgba, frames[i].data as Uint8Array), 0, `frame ${i}`);
  }
});

test('loops is written to acTL, 0 meaning forever', async () => {
  const frames = walkFrames(2);
  assert.equal((await decodeApng((await encodeApng(W, H, frames, { threshold: 0 })).bytes)).loops, 0);
  const thrice = await encodeApng(W, H, frames, { threshold: 0, loops: 3 });
  assert.equal((await decodeApng(thrice.bytes)).loops, 3);
});

test('onProgress reports every source frame once, in order', async () => {
  const seen: number[] = [];
  const frames = walkFrames(4);
  await encodeApng(W, H, frames, {
    threshold: 0,
    onProgress: (done, total) => {
      assert.equal(total, 4);
      seen.push(done);
    },
  });
  assert.deepEqual(seen, [1, 2, 3, 4]);
});

test('a custom deflate is used for every frame', async () => {
  let calls = 0;
  const frames = walkFrames(3);
  const result = await encodeApng(W, H, frames, {
    threshold: 0,
    deflate: async (bytes) => {
      calls++;
      const cs = new CompressionStream('deflate');
      const done = new Response(cs.readable).arrayBuffer();
      const writer = cs.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
      await Promise.all([done, writer.write(bytes).then(() => writer.close())]);
      return new Uint8Array(await done);
    },
  });
  assert.equal(calls, 3);
  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.frames.length, 3);
});

test('bad input is rejected instead of encoded', async () => {
  await assert.rejects(() => encodeApng(W, H, []), /at least one frame/);
  await assert.rejects(
    () => encodeApng(W, H, [{ data: new Uint8Array(10) }]),
    /expected 3840 \(40x24 RGBA8\)/,
  );
  await assert.rejects(() => encodeApng(0, H, walkFrames(1)), /positive integers/);
  await assert.rejects(() => encodeApng(W, 1.5, walkFrames(1)), /positive integers/);
});

test('a single-frame animation is a valid one-frame APNG', async () => {
  const frames = walkFrames(1);
  const result = await encodeApng(W, H, frames, { threshold: 0 });
  assert.equal(result.frameCount, 1);
  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.declaredFrames, 1);
  assert.equal(maxChannelDelta(decoded.frames[0].rgba, frames[0].data as Uint8Array), 0);
});

test('a 1x1 animation encodes and decodes', async () => {
  const a = Uint8Array.from([255, 0, 0, 255]);
  const b = Uint8Array.from([0, 0, 255, 255]);
  const result = await encodeApng(1, 1, [{ data: a }, { data: b }], { threshold: 0 });
  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.frames.length, 2);
  assert.deepEqual([...decoded.frames[1].rgba], [...b]);
});

test('frames with alpha round-trip through the OVER path', async () => {
  const px = (a: number, shift: number): Uint8Array => {
    const out = new Uint8Array(W * H * 4);
    for (let p = 0; p < W * H; p++) {
      out.set(p % 7 === shift ? [10, 200, 30, a] : [0, 0, 0, 0], p * 4);
    }
    return out;
  };
  const frames = [{ data: px(255, 0) }, { data: px(255, 1) }, { data: px(128, 2) }];
  const result = await encodeApng(W, H, frames, { threshold: 0, colorType: 'rgba' });
  const decoded = await decodeApng(result.bytes);
  for (let i = 0; i < frames.length; i++) {
    assert.equal(maxChannelDelta(decoded.frames[i].rgba, frames[i].data as Uint8Array), 0, `frame ${i}`);
  }
});
