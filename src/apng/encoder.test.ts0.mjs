// src/apng/encoder.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/apng/png.ts
var PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
var CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes, seed = 0) {
  let c = ~seed >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
  return ~c >>> 0;
}
function writeChunk(type, data) {
  if (type.length !== 4) throw new Error(`PNG chunk type must be 4 characters, got ${JSON.stringify(type)}`);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
var FIXED_FILTER = {
  none: 0,
  sub: 1,
  up: 2,
  average: 3,
  paeth: 4
};
function filterRow(dst, dstAt, row, prev, stride, bpp, type) {
  for (let i = 0; i < stride; i++) {
    const x = row[i];
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = prev && i >= bpp ? prev[i - bpp] : 0;
    let v;
    switch (type) {
      case 1:
        v = x - a;
        break;
      case 2:
        v = x - b;
        break;
      case 3:
        v = x - (a + b >> 1);
        break;
      case 4:
        v = x - paeth(a, b, c);
        break;
      default:
        v = x;
        break;
    }
    dst[dstAt + i] = v & 255;
  }
}
function rowCost(bytes, at, stride) {
  let sum = 0;
  for (let i = 0; i < stride; i++) {
    const v = bytes[at + i];
    sum += v < 128 ? v : 256 - v;
  }
  return sum;
}
function filterScanlines(raw, stride, height, bpp, strategy = "adaptive") {
  const out = new Uint8Array((stride + 1) * height);
  if (strategy !== "adaptive") {
    const type = FIXED_FILTER[strategy];
    for (let y = 0; y < height; y++) {
      const row = raw.subarray(y * stride, (y + 1) * stride);
      const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null;
      out[y * (stride + 1)] = type;
      filterRow(out, y * (stride + 1) + 1, row, prev, stride, bpp, type);
    }
    return out;
  }
  const trial = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null;
    let bestType = 0;
    let bestCost = Infinity;
    for (let type = 0; type <= 4; type++) {
      filterRow(trial, 0, row, prev, stride, bpp, type);
      const cost = rowCost(trial, 0, stride);
      if (cost < bestCost) {
        bestCost = cost;
        bestType = type;
      }
    }
    out[y * (stride + 1)] = bestType;
    filterRow(out, y * (stride + 1) + 1, row, prev, stride, bpp, bestType);
  }
  return out;
}
function unfilterScanlines(filtered, stride, height, bpp) {
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const type = filtered[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = filtered[src + i];
      const a = i >= bpp ? raw[dst + i - bpp] : 0;
      const b = y > 0 ? raw[up + i] : 0;
      const c = y > 0 && i >= bpp ? raw[up + i - bpp] : 0;
      let v;
      switch (type) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + (a + b >> 1);
          break;
        case 4:
          v = x + paeth(a, b, c);
          break;
        default:
          throw new Error(`unknown PNG filter type ${type} on row ${y}`);
      }
      raw[dst + i] = v & 255;
    }
  }
  return raw;
}

// src/apng/diff.ts
function diffFrames(canvas, next, width, height, options = {}) {
  const t = options.threshold ?? 2;
  const at = options.alphaThreshold ?? t;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let changed = 0;
  let opaque = true;
  for (let y = 0; y < height; y++) {
    let rowMin = -1;
    let rowMax = -1;
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      const dr = canvas[i] - next[i];
      const dg = canvas[i + 1] - next[i + 1];
      const db = canvas[i + 2] - next[i + 2];
      const da = canvas[i + 3] - next[i + 3];
      if (dr > t || dr < -t || (dg > t || dg < -t) || (db > t || db < -t) || (da > at || da < -at)) {
        if (rowMin < 0) rowMin = x;
        rowMax = x;
        changed++;
        if (next[i + 3] !== 255) opaque = false;
      }
    }
    if (rowMin >= 0) {
      if (rowMin < minX) minX = rowMin;
      if (rowMax > maxX) maxX = rowMax;
      if (minY > y) minY = y;
      maxY = y;
    }
  }
  if (maxX < 0) return null;
  return {
    rect: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    changed,
    opaque
  };
}
function cropRect(src, width, rect) {
  const out = new Uint8Array(rect.w * rect.h * 4);
  const rowBytes = rect.w * 4;
  for (let y = 0; y < rect.h; y++) {
    const from = ((rect.y + y) * width + rect.x) * 4;
    out.set(src.subarray(from, from + rowBytes), y * rowBytes);
  }
  return out;
}
function cropRectMasked(canvas, next, width, rect, options = {}, fill = [0, 0, 0, 0]) {
  const t = options.threshold ?? 2;
  const at = options.alphaThreshold ?? t;
  const out = new Uint8Array(rect.w * rect.h * 4);
  if (fill[0] !== 0 || fill[1] !== 0 || fill[2] !== 0) {
    for (let o = 0; o < out.length; o += 4) {
      out[o] = fill[0];
      out[o + 1] = fill[1];
      out[o + 2] = fill[2];
    }
  }
  for (let y = 0; y < rect.h; y++) {
    let i = ((rect.y + y) * width + rect.x) * 4;
    let o = y * rect.w * 4;
    for (let x = 0; x < rect.w; x++, i += 4, o += 4) {
      const dr = canvas[i] - next[i];
      const dg = canvas[i + 1] - next[i + 1];
      const db = canvas[i + 2] - next[i + 2];
      const da = canvas[i + 3] - next[i + 3];
      if (dr > t || dr < -t || (dg > t || dg < -t) || (db > t || db < -t) || (da > at || da < -at)) {
        out[o] = next[i];
        out[o + 1] = next[i + 1];
        out[o + 2] = next[i + 2];
        out[o + 3] = next[i + 3];
      }
    }
  }
  return out;
}
function composite(canvas, width, rect, payload, blend) {
  const rowBytes = rect.w * 4;
  if (blend === "source") {
    for (let y = 0; y < rect.h; y++) {
      const to = ((rect.y + y) * width + rect.x) * 4;
      canvas.set(payload.subarray(y * rowBytes, (y + 1) * rowBytes), to);
    }
    return;
  }
  for (let y = 0; y < rect.h; y++) {
    let o = y * rowBytes;
    let i = ((rect.y + y) * width + rect.x) * 4;
    for (let x = 0; x < rect.w; x++, i += 4, o += 4) {
      const sa = payload[o + 3];
      if (sa === 0) continue;
      if (sa === 255) {
        canvas[i] = payload[o];
        canvas[i + 1] = payload[o + 1];
        canvas[i + 2] = payload[o + 2];
        canvas[i + 3] = 255;
        continue;
      }
      const da = canvas[i + 3];
      const oa = sa + Math.round(da * (255 - sa) / 255);
      if (oa === 0) {
        canvas[i] = canvas[i + 1] = canvas[i + 2] = canvas[i + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) {
        const s = payload[o + c] * sa;
        const d = canvas[i + c] * da * (255 - sa) / 255;
        canvas[i + c] = Math.round((s + d) / oa);
      }
      canvas[i + 3] = oa;
    }
  }
}

// src/apng/palette.ts
function packRgba(r, g, b, a) {
  return (r << 24 | g << 16 | b << 8 | a) >>> 0;
}
function buildPalette(images, limit = 256, reserveTransparent = true) {
  const slotOf = /* @__PURE__ */ new Map();
  const keys = [];
  const counts = [];
  let sawTransparent = false;
  let runKey = -1;
  let runSlot = -1;
  let runLength = 0;
  for (const img of images) {
    for (let i = 0; i < img.length; i += 4) {
      const key = packRgba(img[i], img[i + 1], img[i + 2], img[i + 3]);
      if (key === runKey) {
        runLength++;
        continue;
      }
      if (runSlot >= 0) counts[runSlot] += runLength;
      runKey = key;
      runLength = 1;
      let slot = slotOf.get(key);
      if (slot === void 0) {
        if (img[i + 3] === 0) sawTransparent = true;
        const budget = reserveTransparent && !sawTransparent ? limit - 1 : limit;
        if (keys.length >= budget) return null;
        slot = keys.length;
        slotOf.set(key, slot);
        keys.push(key);
        counts.push(0);
      }
      runSlot = slot;
    }
  }
  if (runSlot >= 0) counts[runSlot] += runLength;
  if (keys.length === 0) return null;
  keys.sort((ka, kb) => {
    const aa = ka & 255;
    const ab = kb & 255;
    if (aa === 255 !== (ab === 255)) return aa === 255 ? 1 : -1;
    const ca = counts[slotOf.get(ka)];
    const cb = counts[slotOf.get(kb)];
    if (ca !== cb) return cb - ca;
    return ka - kb;
  });
  let transparentIndex = keys.findIndex((k) => (k & 255) === 0);
  if (transparentIndex < 0 && reserveTransparent) {
    keys.unshift(0);
    transparentIndex = 0;
  }
  const size = keys.length;
  const rgba = new Uint8Array(size * 4);
  const lookup = /* @__PURE__ */ new Map();
  let trnsCount = 0;
  for (let i = 0; i < size; i++) {
    const k = keys[i];
    rgba[i * 4] = k >>> 24 & 255;
    rgba[i * 4 + 1] = k >>> 16 & 255;
    rgba[i * 4 + 2] = k >>> 8 & 255;
    rgba[i * 4 + 3] = k & 255;
    lookup.set(k, i);
    if ((k & 255) !== 255) trnsCount = i + 1;
  }
  return { rgba, size, trnsCount, transparentIndex, lookup };
}
function indexImage(src, palette) {
  const n = src.length >> 2;
  const out = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const key = packRgba(src[i], src[i + 1], src[i + 2], src[i + 3]);
    const idx = palette.lookup.get(key);
    if (idx === void 0) {
      throw new Error(
        `colour rgba(${src[i]},${src[i + 1]},${src[i + 2]},${src[i + 3]}) is not in the palette`
      );
    }
    out[p] = idx;
  }
  return out;
}

// src/apng/encoder.ts
async function deflateZlib(bytes) {
  const cs = new CompressionStream("deflate");
  const done = new Response(cs.readable).arrayBuffer();
  const writer = cs.writable.getWriter();
  const write = writer.write(bytes).then(() => writer.close());
  const [buffer] = await Promise.all([done, write]);
  return new Uint8Array(buffer);
}
function u32(view, at, value) {
  view.setUint32(at, value >>> 0);
}
function ihdr(width, height, colorType) {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  u32(v, 0, width);
  u32(v, 4, height);
  d[8] = 8;
  d[9] = colorType;
  return writeChunk("IHDR", d);
}
function actl(frameCount, loops) {
  const d = new Uint8Array(8);
  const v = new DataView(d.buffer);
  u32(v, 0, frameCount);
  u32(v, 4, loops);
  return writeChunk("acTL", d);
}
function delayFraction(ms) {
  const clamped = Math.max(0, Math.round(ms));
  for (const den of [1e3, 100, 10, 1]) {
    const num = Math.round(clamped * den / 1e3);
    if (num <= 65535) return { num, den };
  }
  return { num: 65535, den: 1 };
}
function fctl(seq, rect, delayMs, blend) {
  const d = new Uint8Array(26);
  const v = new DataView(d.buffer);
  const { num, den } = delayFraction(delayMs);
  u32(v, 0, seq);
  u32(v, 4, rect.w);
  u32(v, 8, rect.h);
  u32(v, 12, rect.x);
  u32(v, 16, rect.y);
  v.setUint16(20, num);
  v.setUint16(22, den);
  d[24] = 0;
  d[25] = blend === "over" ? 1 : 0;
  return writeChunk("fcTL", d);
}
function fdat(seq, payload) {
  const d = new Uint8Array(4 + payload.length);
  new DataView(d.buffer).setUint32(0, seq >>> 0);
  d.set(payload, 4);
  return writeChunk("fdAT", d);
}
function plteChunks(palette) {
  const plte = new Uint8Array(palette.size * 3);
  for (let i = 0; i < palette.size; i++) {
    plte[i * 3] = palette.rgba[i * 4];
    plte[i * 3 + 1] = palette.rgba[i * 4 + 1];
    plte[i * 3 + 2] = palette.rgba[i * 4 + 2];
  }
  const out = [writeChunk("PLTE", plte)];
  if (palette.trnsCount > 0) {
    const trns = new Uint8Array(palette.trnsCount);
    for (let i = 0; i < palette.trnsCount; i++) trns[i] = palette.rgba[i * 4 + 3];
    out.push(writeChunk("tRNS", trns));
  }
  return out;
}
async function encodeRect(rgba, rect, palette, filter, effort, deflate) {
  const raw = palette ? indexImage(rgba, palette) : rgba;
  const bpp = palette ? 1 : 4;
  const stride = rect.w * bpp;
  const candidates = effort === "best" ? ["adaptive", "none", "sub", "up", "average", "paeth"] : [filter];
  let best = null;
  for (const strategy of candidates) {
    const payload = await deflate(filterScanlines(raw, stride, rect.h, bpp, strategy));
    if (!best || payload.length < best.payload.length) best = { payload, filter: strategy };
  }
  return best;
}
async function encodeApng(width, height, frames, options = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`APNG size must be positive integers, got ${width}x${height}`);
  }
  if (frames.length === 0) throw new Error("APNG needs at least one frame");
  const expected = width * height * 4;
  const images = frames.map((f, i) => {
    if (f.data.length !== expected) {
      throw new Error(
        `frame ${i} is ${f.data.length} bytes, expected ${expected} (${width}x${height} RGBA8)`
      );
    }
    return f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.length);
  });
  const threshold = options.threshold ?? 2;
  const alphaThreshold = options.alphaThreshold ?? threshold;
  const defaultDelay = options.delayMs ?? 100;
  const loops = options.loops ?? 0;
  const filter = options.filter ?? "adaptive";
  const effort = options.effort ?? "fast";
  const coalesce = options.coalesce ?? true;
  const deflate = options.deflate ?? deflateZlib;
  const diffOptions = { threshold, alphaThreshold };
  const wantIndexed = (options.colorType ?? "auto") !== "rgba";
  const palette = wantIndexed ? buildPalette(images) : null;
  if (options.colorType === "indexed" && !palette) {
    throw new Error('colorType "indexed" requested but the frames use more than 256 distinct colours');
  }
  if (palette && palette.transparentIndex < 0) {
    throw new Error("internal: indexed APNG needs a transparent palette entry");
  }
  const maskFill = palette ? [
    palette.rgba[palette.transparentIndex * 4],
    palette.rgba[palette.transparentIndex * 4 + 1],
    palette.rgba[palette.transparentIndex * 4 + 2],
    0
  ] : [0, 0, 0, 0];
  const canvas = new Uint8Array(expected);
  const pending = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const delayMs = frames[i].delayMs ?? defaultDelay;
    const diff = i === 0 ? { rect: { x: 0, y: 0, w: width, h: height }, changed: width * height, opaque: false } : diffFrames(canvas, image, width, height, diffOptions);
    if (!diff) {
      const last = pending[pending.length - 1];
      if (coalesce && last) {
        last.delayMs += delayMs;
        last.coalesced++;
        options.onProgress?.(i + 1, images.length);
        continue;
      }
      const rect2 = { x: 0, y: 0, w: 1, h: 1 };
      const blank = Uint8Array.from(maskFill);
      const encoded = await encodeRect(blank, rect2, palette, filter, effort, deflate);
      pending.push({
        rect: rect2,
        blend: "over",
        filter: encoded.filter,
        payload: encoded.payload,
        changed: 0,
        delayMs,
        coalesced: 0,
        sourceIndex: i
      });
      options.onProgress?.(i + 1, images.length);
      continue;
    }
    const { rect } = diff;
    const overLegal = i > 0 && diff.opaque;
    const overIsSource = diff.changed === rect.w * rect.h;
    const blends = [];
    if (overLegal) blends.push("over");
    if (!overLegal || effort === "best" && !overIsSource) blends.push("source");
    let chosen;
    let shown;
    for (const blend of blends) {
      const payloadRgba = blend === "over" ? cropRectMasked(canvas, image, width, rect, diffOptions, maskFill) : cropRect(image, width, rect);
      const encoded = await encodeRect(payloadRgba, rect, palette, filter, effort, deflate);
      if (!chosen || encoded.payload.length < chosen.payload.length) {
        chosen = {
          rect,
          blend,
          filter: encoded.filter,
          payload: encoded.payload,
          changed: diff.changed,
          delayMs,
          coalesced: 0,
          sourceIndex: i
        };
        shown = payloadRgba;
      }
    }
    if (!chosen || !shown) throw new Error(`internal: frame ${i} produced no encoding`);
    pending.push(chosen);
    composite(canvas, width, rect, shown, chosen.blend);
    options.onProgress?.(i + 1, images.length);
  }
  const parts = [PNG_SIGNATURE, ihdr(width, height, palette ? 3 : 6)];
  if (palette) parts.push(...plteChunks(palette));
  parts.push(actl(pending.length, loops));
  const stats = [];
  let seq = 0;
  for (let i = 0; i < pending.length; i++) {
    const f = pending[i];
    parts.push(fctl(seq++, f.rect, f.delayMs, i === 0 ? "source" : f.blend));
    parts.push(i === 0 ? writeChunk("IDAT", f.payload) : fdat(seq++, f.payload));
    stats.push({
      index: i,
      sourceIndex: f.sourceIndex,
      rect: f.rect,
      blend: i === 0 ? "source" : f.blend,
      filter: f.filter,
      bytes: f.payload.length,
      changed: f.changed,
      delayMs: f.delayMs,
      coalesced: f.coalesced
    });
  }
  parts.push(writeChunk("IEND", new Uint8Array(0)));
  return {
    bytes: concatBytes(parts),
    width,
    height,
    frameCount: pending.length,
    sourceFrameCount: images.length,
    colorType: palette ? "indexed" : "rgba",
    paletteSize: palette ? palette.size : 0,
    frames: stats
  };
}

// src/apng/encoder.test.ts
async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  const done = new Response(ds.readable).arrayBuffer();
  const writer = ds.writable.getWriter();
  const write = writer.write(bytes).then(() => writer.close());
  const [buffer] = await Promise.all([done, write]);
  return new Uint8Array(buffer);
}
function readChunks(bytes) {
  for (let i = 0; i < 8; i++) {
    assert.equal(bytes[i], PNG_SIGNATURE[i], `signature byte ${i}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
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
  assert.equal(chunks[chunks.length - 1].type, "IEND");
  return chunks;
}
async function decodeApng(bytes) {
  const chunks = readChunks(bytes);
  const ihdr2 = chunks.find((c) => c.type === "IHDR");
  assert.ok(ihdr2, "no IHDR");
  const hv = new DataView(ihdr2.data.buffer, ihdr2.data.byteOffset, ihdr2.data.byteLength);
  const width = hv.getUint32(0);
  const height = hv.getUint32(4);
  const bitDepth = ihdr2.data[8];
  const colorType = ihdr2.data[9];
  assert.equal(bitDepth, 8);
  assert.ok(colorType === 6 || colorType === 3, `unexpected colour type ${colorType}`);
  assert.equal(ihdr2.data[10], 0, "compression method");
  assert.equal(ihdr2.data[11], 0, "filter method");
  assert.equal(ihdr2.data[12], 0, "interlace");
  const plte = chunks.find((c) => c.type === "PLTE");
  const trns = chunks.find((c) => c.type === "tRNS");
  let palette = null;
  if (colorType === 3) {
    assert.ok(plte, "indexed PNG without PLTE");
    const n = plte.data.length / 3;
    palette = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      palette[i * 4] = plte.data[i * 3];
      palette[i * 4 + 1] = plte.data[i * 3 + 1];
      palette[i * 4 + 2] = plte.data[i * 3 + 2];
      palette[i * 4 + 3] = trns && i < trns.data.length ? trns.data[i] : 255;
    }
  }
  const actl2 = chunks.find((c) => c.type === "acTL");
  assert.ok(actl2, "no acTL");
  const av = new DataView(actl2.data.buffer, actl2.data.byteOffset, actl2.data.byteLength);
  const declaredFrames = av.getUint32(0);
  const loops = av.getUint32(4);
  assert.ok(
    chunks.indexOf(actl2) < chunks.findIndex((c) => c.type === "IDAT"),
    "acTL must precede IDAT"
  );
  const raws = [];
  let expectedSeq = 0;
  let current = null;
  for (const chunk of chunks) {
    if (chunk.type === "fcTL") {
      const v = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
      assert.equal(v.getUint32(0), expectedSeq++, "fcTL sequence number");
      const delayNum = v.getUint16(20);
      const delayDen = v.getUint16(22) || 100;
      assert.equal(chunk.data[24], 0, "dispose_op");
      current = {
        rect: { w: v.getUint32(4), h: v.getUint32(8), x: v.getUint32(12), y: v.getUint32(16) },
        delayMs: delayNum / delayDen * 1e3,
        blend: chunk.data[25] === 1 ? "over" : "source"
      };
    } else if (chunk.type === "IDAT") {
      assert.ok(current, "IDAT without a preceding fcTL");
      assert.deepEqual(current.rect, { x: 0, y: 0, w: width, h: height }, "frame 0 must be full size");
      raws.push({ ...current, payload: chunk.data });
      current = null;
    } else if (chunk.type === "fdAT") {
      assert.ok(current, "fdAT without a preceding fcTL");
      const v = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
      assert.equal(v.getUint32(0), expectedSeq++, "fdAT sequence number");
      raws.push({ ...current, payload: chunk.data.subarray(4) });
      current = null;
    }
  }
  assert.equal(current, null, "trailing fcTL with no image data");
  const canvas = new Uint8Array(width * height * 4);
  const frames = [];
  for (const raw of raws) {
    assert.ok(
      raw.rect.x + raw.rect.w <= width && raw.rect.y + raw.rect.h <= height,
      `frame rectangle ${JSON.stringify(raw.rect)} leaves the canvas`
    );
    const bpp = palette ? 1 : 4;
    const inflated = await inflate(raw.payload);
    const stride = raw.rect.w * bpp;
    assert.equal(inflated.length, (stride + 1) * raw.rect.h, "inflated scanline size");
    const flat = unfilterScanlines(inflated, stride, raw.rect.h, bpp);
    let sub;
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
    width,
    height,
    colorType,
    paletteSize: palette ? palette.length / 4 : 0,
    declaredFrames,
    loops,
    frames
  };
}
var W = 40;
var H = 24;
function sceneFrame(x, y, size = 6, alpha = 255) {
  const px = new Uint8Array(W * H * 4);
  for (let py = 0; py < H; py++) {
    for (let pxx = 0; pxx < W; pxx++) {
      const i = (py * W + pxx) * 4;
      px[i] = pxx * 4 & 255;
      px[i + 1] = py * 8 & 255;
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
function walkFrames(count, alpha = 255) {
  return Array.from({ length: count }, (_, i) => ({ data: sceneFrame(2 + i * 3, 5, 6, alpha) }));
}
function maxChannelDelta(a, b) {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}
test("delayFraction keeps millisecond precision and stays inside uint16", () => {
  assert.deepEqual(delayFraction(100), { num: 100, den: 1e3 });
  assert.deepEqual(delayFraction(33), { num: 33, den: 1e3 });
  assert.deepEqual(delayFraction(0), { num: 0, den: 1e3 });
  for (const ms of [1, 16, 65, 65535, 65536, 1e5, 6e5, 1e7]) {
    const { num, den } = delayFraction(ms);
    assert.ok(num >= 0 && num <= 65535, `num ${num} out of range for ${ms}ms`);
    assert.ok(den >= 1 && den <= 65535, `den ${den} out of range for ${ms}ms`);
    const decoded = num / den * 1e3;
    assert.ok(Math.abs(decoded - ms) <= ms * 0.01 + 1, `${ms}ms decoded as ${decoded}ms`);
  }
});
test("threshold 0 reproduces every frame exactly", async () => {
  const frames = walkFrames(5);
  const result = await encodeApng(W, H, frames, { threshold: 0, colorType: "rgba" });
  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.width, W);
  assert.equal(decoded.height, H);
  assert.equal(decoded.frames.length, frames.length);
  assert.equal(decoded.declaredFrames, frames.length);
  for (let i = 0; i < frames.length; i++) {
    assert.equal(
      maxChannelDelta(decoded.frames[i].rgba, frames[i].data),
      0,
      `frame ${i} differs`
    );
  }
});
test("a non-zero threshold stays within itself on every pixel of every frame", async () => {
  let seed = 99;
  const frames = walkFrames(6).map((f) => {
    const px = f.data.slice();
    for (let i = 0; i < px.length; i += 4) {
      seed = seed * 1103515245 + 12345 >>> 0;
      const d = (seed >>> 20) % 5 - 2;
      for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, px[i + c] + d));
    }
    return { data: px };
  });
  const threshold = 2;
  const result = await encodeApng(W, H, frames, { threshold, colorType: "rgba" });
  const decoded = await decodeApng(result.bytes);
  let out = 0;
  for (const stat of result.frames) {
    for (let k = 0; k <= stat.coalesced; k++) {
      assert.ok(
        maxChannelDelta(decoded.frames[out].rgba, frames[stat.sourceIndex + k].data) <= threshold,
        `source frame ${stat.sourceIndex + k} drifted past the threshold`
      );
    }
    out++;
  }
});
test("every source frame is accounted for, in order", async () => {
  const frames = [...walkFrames(3), { data: sceneFrame(2 + 2 * 3, 5) }, ...walkFrames(2)];
  const result = await encodeApng(W, H, frames, { threshold: 0 });
  let expected = 0;
  for (const stat of result.frames) {
    assert.equal(stat.sourceIndex, expected, "frames must stay in source order");
    expected += 1 + stat.coalesced;
  }
  assert.equal(expected, frames.length);
  assert.equal(result.sourceFrameCount, frames.length);
});
test("identical frames coalesce into one frame with the delays added up", async () => {
  const still = sceneFrame(4, 4);
  const frames = [
    { data: still, delayMs: 40 },
    { data: still.slice(), delayMs: 60 },
    { data: still.slice(), delayMs: 100 },
    { data: sceneFrame(10, 4), delayMs: 40 }
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
test("coalescing off keeps every frame, and the still ones stay tiny", async () => {
  const still = sceneFrame(4, 4);
  const frames = [{ data: still }, { data: still.slice() }, { data: still.slice() }];
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
test("the dirty rectangle is the changed area, not the whole canvas", async () => {
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
test("an opaque partial change uses OVER; a translucent one falls back to SOURCE", async () => {
  const opaque = await encodeApng(W, H, walkFrames(3), { threshold: 0, colorType: "rgba" });
  assert.equal(opaque.frames[1].blend, "over");
  const translucent = await encodeApng(W, H, walkFrames(3, 128), { threshold: 0, colorType: "rgba" });
  assert.equal(translucent.frames[1].blend, "source");
  const decoded = await decodeApng(translucent.bytes);
  const sources = walkFrames(3, 128);
  for (let i = 0; i < 3; i++) {
    assert.equal(maxChannelDelta(decoded.frames[i].rgba, sources[i].data), 0, `frame ${i}`);
  }
});
test("few-colour frames become an indexed PNG and still decode exactly", async () => {
  const flat = (shift) => {
    const px = new Uint8Array(W * H * 4);
    for (let p = 0; p < W * H; p++) {
      const on = (p + shift >> 3) % 2 === 0;
      px.set(on ? [200, 30, 30, 255] : [20, 20, 40, 255], p * 4);
    }
    return px;
  };
  const frames = [{ data: flat(0) }, { data: flat(4) }, { data: flat(8) }];
  const result = await encodeApng(W, H, frames, { threshold: 0 });
  assert.equal(result.colorType, "indexed");
  assert.equal(result.paletteSize, 3);
  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.colorType, 3);
  for (let i = 0; i < frames.length; i++) {
    assert.equal(maxChannelDelta(decoded.frames[i].rgba, frames[i].data), 0, `frame ${i}`);
  }
});
test("indexed output beats RGBA on few-colour frames", async () => {
  const flat = (shift) => {
    const px = new Uint8Array(W * H * 4);
    for (let p = 0; p < W * H; p++) {
      px.set((p + shift >> 3) % 2 === 0 ? [200, 30, 30, 255] : [20, 20, 40, 255], p * 4);
    }
    return px;
  };
  const frames = [{ data: flat(0) }, { data: flat(5) }];
  const indexed = await encodeApng(W, H, frames, { threshold: 0, colorType: "auto" });
  const rgba = await encodeApng(W, H, frames, { threshold: 0, colorType: "rgba" });
  assert.equal(indexed.colorType, "indexed");
  assert.equal(rgba.colorType, "rgba");
  assert.ok(indexed.bytes.length < rgba.bytes.length, `${indexed.bytes.length} vs ${rgba.bytes.length}`);
});
test("a many-colour frame stays RGBA under colorType auto", async () => {
  const noisy = new Uint8Array(W * H * 4);
  let seed = 7;
  for (let i = 0; i < noisy.length; i += 4) {
    seed = seed * 1664525 + 1013904223 >>> 0;
    noisy[i] = seed & 255;
    noisy[i + 1] = seed >>> 8 & 255;
    noisy[i + 2] = seed >>> 16 & 255;
    noisy[i + 3] = 255;
  }
  const result = await encodeApng(W, H, [{ data: noisy }], { threshold: 0 });
  assert.equal(result.colorType, "rgba");
  assert.equal((await decodeApng(result.bytes)).colorType, 6);
});
test('colorType "indexed" fails loudly rather than quantising', async () => {
  const noisy = new Uint8Array(W * H * 4);
  for (let i = 0; i < noisy.length; i += 4) {
    noisy[i] = i / 4 & 255;
    noisy[i + 1] = i / 8 & 255;
    noisy[i + 2] = i / 16 & 255;
    noisy[i + 3] = 255;
  }
  await assert.rejects(
    () => encodeApng(W, H, [{ data: noisy }], { colorType: "indexed" }),
    /more than 256 distinct colours/
  );
});
test('effort "best" is never larger than "fast"', async () => {
  const frames = walkFrames(4);
  const fast = await encodeApng(W, H, frames, { threshold: 0, effort: "fast", colorType: "rgba" });
  const best = await encodeApng(W, H, frames, { threshold: 0, effort: "best", colorType: "rgba" });
  assert.ok(best.bytes.length <= fast.bytes.length, `${best.bytes.length} vs ${fast.bytes.length}`);
  const decoded = await decodeApng(best.bytes);
  for (let i = 0; i < frames.length; i++) {
    assert.equal(maxChannelDelta(decoded.frames[i].rgba, frames[i].data), 0, `frame ${i}`);
  }
});
test("differencing beats storing every frame whole", async () => {
  const noise = new Uint8Array(W * H * 4);
  let seed = 4242;
  for (let i = 0; i < noise.length; i += 4) {
    seed = seed * 1664525 + 1013904223 >>> 0;
    noise[i] = seed & 255;
    noise[i + 1] = seed >>> 8 & 255;
    noise[i + 2] = seed >>> 16 & 255;
    noise[i + 3] = 255;
  }
  const frames = Array.from({ length: 8 }, (_, k) => {
    const px = noise.slice();
    for (let dy = 0; dy < 5; dy++) {
      for (let dx = 0; dx < 5; dx++) {
        px.set([255, 255, 255, 255], ((6 + dy) * W + (2 + k * 4 + dx)) * 4);
      }
    }
    return { data: px };
  });
  const result = await encodeApng(W, H, frames, { threshold: 0, colorType: "rgba" });
  const keyframe = result.frames[0].bytes;
  const laterBytes = result.frames.slice(1).reduce((s, f) => s + f.bytes, 0);
  assert.ok(laterBytes < keyframe / 4, `${laterBytes} vs one whole frame at ${keyframe}`);
  const decoded = await decodeApng(result.bytes);
  for (let i = 0; i < frames.length; i++) {
    assert.equal(maxChannelDelta(decoded.frames[i].rgba, frames[i].data), 0, `frame ${i}`);
  }
});
test("loops is written to acTL, 0 meaning forever", async () => {
  const frames = walkFrames(2);
  assert.equal((await decodeApng((await encodeApng(W, H, frames, { threshold: 0 })).bytes)).loops, 0);
  const thrice = await encodeApng(W, H, frames, { threshold: 0, loops: 3 });
  assert.equal((await decodeApng(thrice.bytes)).loops, 3);
});
test("onProgress reports every source frame once, in order", async () => {
  const seen = [];
  const frames = walkFrames(4);
  await encodeApng(W, H, frames, {
    threshold: 0,
    onProgress: (done, total) => {
      assert.equal(total, 4);
      seen.push(done);
    }
  });
  assert.deepEqual(seen, [1, 2, 3, 4]);
});
test("a custom deflate is used for every frame", async () => {
  let calls = 0;
  const frames = walkFrames(3);
  const result = await encodeApng(W, H, frames, {
    threshold: 0,
    deflate: async (bytes) => {
      calls++;
      const cs = new CompressionStream("deflate");
      const done = new Response(cs.readable).arrayBuffer();
      const writer = cs.writable.getWriter();
      await Promise.all([done, writer.write(bytes).then(() => writer.close())]);
      return new Uint8Array(await done);
    }
  });
  assert.equal(calls, 3);
  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.frames.length, 3);
});
test("bad input is rejected instead of encoded", async () => {
  await assert.rejects(() => encodeApng(W, H, []), /at least one frame/);
  await assert.rejects(
    () => encodeApng(W, H, [{ data: new Uint8Array(10) }]),
    /expected 3840 \(40x24 RGBA8\)/
  );
  await assert.rejects(() => encodeApng(0, H, walkFrames(1)), /positive integers/);
  await assert.rejects(() => encodeApng(W, 1.5, walkFrames(1)), /positive integers/);
});
test("a single-frame animation is a valid one-frame APNG", async () => {
  const frames = walkFrames(1);
  const result = await encodeApng(W, H, frames, { threshold: 0 });
  assert.equal(result.frameCount, 1);
  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.declaredFrames, 1);
  assert.equal(maxChannelDelta(decoded.frames[0].rgba, frames[0].data), 0);
});
test("a 1x1 animation encodes and decodes", async () => {
  const a = Uint8Array.from([255, 0, 0, 255]);
  const b = Uint8Array.from([0, 0, 255, 255]);
  const result = await encodeApng(1, 1, [{ data: a }, { data: b }], { threshold: 0 });
  const decoded = await decodeApng(result.bytes);
  assert.equal(decoded.frames.length, 2);
  assert.deepEqual([...decoded.frames[1].rgba], [...b]);
});
test("frames with alpha round-trip through the OVER path", async () => {
  const px = (a, shift) => {
    const out = new Uint8Array(W * H * 4);
    for (let p = 0; p < W * H; p++) {
      out.set(p % 7 === shift ? [10, 200, 30, a] : [0, 0, 0, 0], p * 4);
    }
    return out;
  };
  const frames = [{ data: px(255, 0) }, { data: px(255, 1) }, { data: px(128, 2) }];
  const result = await encodeApng(W, H, frames, { threshold: 0, colorType: "rgba" });
  const decoded = await decodeApng(result.bytes);
  for (let i = 0; i < frames.length; i++) {
    assert.equal(maxChannelDelta(decoded.frames[i].rgba, frames[i].data), 0, `frame ${i}`);
  }
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiZW5jb2Rlci50ZXN0LnRzIiwgInBuZy50cyIsICJkaWZmLnRzIiwgInBhbGV0dGUudHMiLCAiZW5jb2Rlci50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gVGVzdHMgZm9yIHRoZSBBUE5HIGVuY29kZXIuXG5cbmltcG9ydCB7IHRlc3QgfSBmcm9tICdub2RlOnRlc3QnO1xuaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydC9zdHJpY3QnO1xuXG5pbXBvcnQgeyBjcmMzMiwgUE5HX1NJR05BVFVSRSwgdW5maWx0ZXJTY2FubGluZXMgfSBmcm9tICcuL3BuZy50cyc7XG5pbXBvcnQgeyBjb21wb3NpdGUsIHR5cGUgUmVjdCB9IGZyb20gJy4vZGlmZi50cyc7XG5pbXBvcnQgeyBkZWxheUZyYWN0aW9uLCBlbmNvZGVBcG5nLCB0eXBlIEFwbmdGcmFtZSB9IGZyb20gJy4vZW5jb2Rlci50cyc7XG5cbi8vIC0tIEEgbWluaW1hbCBBUE5HIGRlY29kZXIsIHVzZWQgb25seSBhcyB0aGlzIGZpbGUncyBvcmFjbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIERlY29kZWRGcmFtZSB7XG4gIC8qKiBUaGUgZnVsbCBjYW52YXMgYXMgaXQgc3RhbmRzIG9uY2UgdGhpcyBmcmFtZSBoYXMgYmVlbiBjb21wb3NpdGVkLiAqL1xuICByZ2JhOiBVaW50OEFycmF5O1xuICBkZWxheU1zOiBudW1iZXI7XG4gIHJlY3Q6IFJlY3Q7XG4gIGJsZW5kOiAnc291cmNlJyB8ICdvdmVyJztcbn1cblxuaW50ZXJmYWNlIERlY29kZWQge1xuICB3aWR0aDogbnVtYmVyO1xuICBoZWlnaHQ6IG51bWJlcjtcbiAgY29sb3JUeXBlOiBudW1iZXI7XG4gIHBhbGV0dGVTaXplOiBudW1iZXI7XG4gIGRlY2xhcmVkRnJhbWVzOiBudW1iZXI7XG4gIGxvb3BzOiBudW1iZXI7XG4gIGZyYW1lczogRGVjb2RlZEZyYW1lW107XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluZmxhdGUoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgY29uc3QgZHMgPSBuZXcgRGVjb21wcmVzc2lvblN0cmVhbSgnZGVmbGF0ZScpO1xuICBjb25zdCBkb25lID0gbmV3IFJlc3BvbnNlKGRzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpO1xuICBjb25zdCB3cml0ZXIgPSBkcy53cml0YWJsZS5nZXRXcml0ZXIoKSBhcyBXcml0YWJsZVN0cmVhbURlZmF1bHRXcml0ZXI8VWludDhBcnJheT47XG4gIGNvbnN0IHdyaXRlID0gd3JpdGVyLndyaXRlKGJ5dGVzKS50aGVuKCgpID0+IHdyaXRlci5jbG9zZSgpKTtcbiAgY29uc3QgW2J1ZmZlcl0gPSBhd2FpdCBQcm9taXNlLmFsbChbZG9uZSwgd3JpdGVdKTtcbiAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGJ1ZmZlcik7XG59XG5cbmludGVyZmFjZSBDaHVuayB7XG4gIHR5cGU6IHN0cmluZztcbiAgZGF0YTogVWludDhBcnJheTtcbn1cblxuZnVuY3Rpb24gcmVhZENodW5rcyhieXRlczogVWludDhBcnJheSk6IENodW5rW10ge1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDg7IGkrKykge1xuICAgIGFzc2VydC5lcXVhbChieXRlc1tpXSwgUE5HX1NJR05BVFVSRVtpXSwgYHNpZ25hdHVyZSBieXRlICR7aX1gKTtcbiAgfVxuICBjb25zdCB2aWV3ID0gbmV3IERhdGFWaWV3KGJ5dGVzLmJ1ZmZlciwgYnl0ZXMuYnl0ZU9mZnNldCwgYnl0ZXMuYnl0ZUxlbmd0aCk7XG4gIGNvbnN0IGNodW5rczogQ2h1bmtbXSA9IFtdO1xuICBsZXQgYXQgPSA4O1xuICB3aGlsZSAoYXQgPCBieXRlcy5sZW5ndGgpIHtcbiAgICBjb25zdCBsZW5ndGggPSB2aWV3LmdldFVpbnQzMihhdCk7XG4gICAgY29uc3QgdHlwZSA9IFN0cmluZy5mcm9tQ2hhckNvZGUoLi4uYnl0ZXMuc3ViYXJyYXkoYXQgKyA0LCBhdCArIDgpKTtcbiAgICBjb25zdCBkYXRhID0gYnl0ZXMuc3ViYXJyYXkoYXQgKyA4LCBhdCArIDggKyBsZW5ndGgpO1xuICAgIGNvbnN0IHN0b3JlZCA9IHZpZXcuZ2V0VWludDMyKGF0ICsgOCArIGxlbmd0aCk7XG4gICAgYXNzZXJ0LmVxdWFsKHN0b3JlZCwgY3JjMzIoYnl0ZXMuc3ViYXJyYXkoYXQgKyA0LCBhdCArIDggKyBsZW5ndGgpKSwgYENSQyBvZiAke3R5cGV9IGNodW5rYCk7XG4gICAgY2h1bmtzLnB1c2goeyB0eXBlLCBkYXRhIH0pO1xuICAgIGF0ICs9IDEyICsgbGVuZ3RoO1xuICB9XG4gIGFzc2VydC5lcXVhbChjaHVua3NbY2h1bmtzLmxlbmd0aCAtIDFdLnR5cGUsICdJRU5EJyk7XG4gIHJldHVybiBjaHVua3M7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRlY29kZUFwbmcoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPERlY29kZWQ+IHtcbiAgY29uc3QgY2h1bmtzID0gcmVhZENodW5rcyhieXRlcyk7XG4gIGNvbnN0IGloZHIgPSBjaHVua3MuZmluZCgoYykgPT4gYy50eXBlID09PSAnSUhEUicpO1xuICBhc3NlcnQub2soaWhkciwgJ25vIElIRFInKTtcbiAgY29uc3QgaHYgPSBuZXcgRGF0YVZpZXcoaWhkci5kYXRhLmJ1ZmZlciwgaWhkci5kYXRhLmJ5dGVPZmZzZXQsIGloZHIuZGF0YS5ieXRlTGVuZ3RoKTtcbiAgY29uc3Qgd2lkdGggPSBodi5nZXRVaW50MzIoMCk7XG4gIGNvbnN0IGhlaWdodCA9IGh2LmdldFVpbnQzMig0KTtcbiAgY29uc3QgYml0RGVwdGggPSBpaGRyLmRhdGFbOF07XG4gIGNvbnN0IGNvbG9yVHlwZSA9IGloZHIuZGF0YVs5XTtcbiAgYXNzZXJ0LmVxdWFsKGJpdERlcHRoLCA4KTtcbiAgYXNzZXJ0Lm9rKGNvbG9yVHlwZSA9PT0gNiB8fCBjb2xvclR5cGUgPT09IDMsIGB1bmV4cGVjdGVkIGNvbG91ciB0eXBlICR7Y29sb3JUeXBlfWApO1xuICBhc3NlcnQuZXF1YWwoaWhkci5kYXRhWzEwXSwgMCwgJ2NvbXByZXNzaW9uIG1ldGhvZCcpO1xuICBhc3NlcnQuZXF1YWwoaWhkci5kYXRhWzExXSwgMCwgJ2ZpbHRlciBtZXRob2QnKTtcbiAgYXNzZXJ0LmVxdWFsKGloZHIuZGF0YVsxMl0sIDAsICdpbnRlcmxhY2UnKTtcblxuICBjb25zdCBwbHRlID0gY2h1bmtzLmZpbmQoKGMpID0+IGMudHlwZSA9PT0gJ1BMVEUnKTtcbiAgY29uc3QgdHJucyA9IGNodW5rcy5maW5kKChjKSA9PiBjLnR5cGUgPT09ICd0Uk5TJyk7XG4gIGxldCBwYWxldHRlOiBVaW50OEFycmF5IHwgbnVsbCA9IG51bGw7XG4gIGlmIChjb2xvclR5cGUgPT09IDMpIHtcbiAgICBhc3NlcnQub2socGx0ZSwgJ2luZGV4ZWQgUE5HIHdpdGhvdXQgUExURScpO1xuICAgIGNvbnN0IG4gPSBwbHRlLmRhdGEubGVuZ3RoIC8gMztcbiAgICBwYWxldHRlID0gbmV3IFVpbnQ4QXJyYXkobiAqIDQpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7XG4gICAgICBwYWxldHRlW2kgKiA0XSA9IHBsdGUuZGF0YVtpICogM107XG4gICAgICBwYWxldHRlW2kgKiA0ICsgMV0gPSBwbHRlLmRhdGFbaSAqIDMgKyAxXTtcbiAgICAgIHBhbGV0dGVbaSAqIDQgKyAyXSA9IHBsdGUuZGF0YVtpICogMyArIDJdO1xuICAgICAgcGFsZXR0ZVtpICogNCArIDNdID0gdHJucyAmJiBpIDwgdHJucy5kYXRhLmxlbmd0aCA/IHRybnMuZGF0YVtpXSA6IDI1NTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBhY3RsID0gY2h1bmtzLmZpbmQoKGMpID0+IGMudHlwZSA9PT0gJ2FjVEwnKTtcbiAgYXNzZXJ0Lm9rKGFjdGwsICdubyBhY1RMJyk7XG4gIGNvbnN0IGF2ID0gbmV3IERhdGFWaWV3KGFjdGwuZGF0YS5idWZmZXIsIGFjdGwuZGF0YS5ieXRlT2Zmc2V0LCBhY3RsLmRhdGEuYnl0ZUxlbmd0aCk7XG4gIGNvbnN0IGRlY2xhcmVkRnJhbWVzID0gYXYuZ2V0VWludDMyKDApO1xuICBjb25zdCBsb29wcyA9IGF2LmdldFVpbnQzMig0KTtcbiAgYXNzZXJ0Lm9rKFxuICAgIGNodW5rcy5pbmRleE9mKGFjdGwpIDwgY2h1bmtzLmZpbmRJbmRleCgoYykgPT4gYy50eXBlID09PSAnSURBVCcpLFxuICAgICdhY1RMIG11c3QgcHJlY2VkZSBJREFUJyxcbiAgKTtcblxuICAvLyBXYWxrIGZjVEwgLyBJREFUIC8gZmRBVCBpbiBzdHJlYW0gb3JkZXIsIGNoZWNraW5nIHNlcXVlbmNlIG51bWJlcnMuXG4gIGludGVyZmFjZSBSYXcgeyByZWN0OiBSZWN0OyBkZWxheU1zOiBudW1iZXI7IGJsZW5kOiAnc291cmNlJyB8ICdvdmVyJzsgcGF5bG9hZDogVWludDhBcnJheSB9XG4gIGNvbnN0IHJhd3M6IFJhd1tdID0gW107XG4gIGxldCBleHBlY3RlZFNlcSA9IDA7XG4gIGxldCBjdXJyZW50OiBPbWl0PFJhdywgJ3BheWxvYWQnPiB8IG51bGwgPSBudWxsO1xuICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgIGlmIChjaHVuay50eXBlID09PSAnZmNUTCcpIHtcbiAgICAgIGNvbnN0IHYgPSBuZXcgRGF0YVZpZXcoY2h1bmsuZGF0YS5idWZmZXIsIGNodW5rLmRhdGEuYnl0ZU9mZnNldCwgY2h1bmsuZGF0YS5ieXRlTGVuZ3RoKTtcbiAgICAgIGFzc2VydC5lcXVhbCh2LmdldFVpbnQzMigwKSwgZXhwZWN0ZWRTZXErKywgJ2ZjVEwgc2VxdWVuY2UgbnVtYmVyJyk7XG4gICAgICBjb25zdCBkZWxheU51bSA9IHYuZ2V0VWludDE2KDIwKTtcbiAgICAgIGNvbnN0IGRlbGF5RGVuID0gdi5nZXRVaW50MTYoMjIpIHx8IDEwMDtcbiAgICAgIGFzc2VydC5lcXVhbChjaHVuay5kYXRhWzI0XSwgMCwgJ2Rpc3Bvc2Vfb3AnKTtcbiAgICAgIGN1cnJlbnQgPSB7XG4gICAgICAgIHJlY3Q6IHsgdzogdi5nZXRVaW50MzIoNCksIGg6IHYuZ2V0VWludDMyKDgpLCB4OiB2LmdldFVpbnQzMigxMiksIHk6IHYuZ2V0VWludDMyKDE2KSB9LFxuICAgICAgICBkZWxheU1zOiAoZGVsYXlOdW0gLyBkZWxheURlbikgKiAxMDAwLFxuICAgICAgICBibGVuZDogY2h1bmsuZGF0YVsyNV0gPT09IDEgPyAnb3ZlcicgOiAnc291cmNlJyxcbiAgICAgIH07XG4gICAgfSBlbHNlIGlmIChjaHVuay50eXBlID09PSAnSURBVCcpIHtcbiAgICAgIGFzc2VydC5vayhjdXJyZW50LCAnSURBVCB3aXRob3V0IGEgcHJlY2VkaW5nIGZjVEwnKTtcbiAgICAgIGFzc2VydC5kZWVwRXF1YWwoY3VycmVudC5yZWN0LCB7IHg6IDAsIHk6IDAsIHc6IHdpZHRoLCBoOiBoZWlnaHQgfSwgJ2ZyYW1lIDAgbXVzdCBiZSBmdWxsIHNpemUnKTtcbiAgICAgIHJhd3MucHVzaCh7IC4uLmN1cnJlbnQsIHBheWxvYWQ6IGNodW5rLmRhdGEgfSk7XG4gICAgICBjdXJyZW50ID0gbnVsbDtcbiAgICB9IGVsc2UgaWYgKGNodW5rLnR5cGUgPT09ICdmZEFUJykge1xuICAgICAgYXNzZXJ0Lm9rKGN1cnJlbnQsICdmZEFUIHdpdGhvdXQgYSBwcmVjZWRpbmcgZmNUTCcpO1xuICAgICAgY29uc3QgdiA9IG5ldyBEYXRhVmlldyhjaHVuay5kYXRhLmJ1ZmZlciwgY2h1bmsuZGF0YS5ieXRlT2Zmc2V0LCBjaHVuay5kYXRhLmJ5dGVMZW5ndGgpO1xuICAgICAgYXNzZXJ0LmVxdWFsKHYuZ2V0VWludDMyKDApLCBleHBlY3RlZFNlcSsrLCAnZmRBVCBzZXF1ZW5jZSBudW1iZXInKTtcbiAgICAgIHJhd3MucHVzaCh7IC4uLmN1cnJlbnQsIHBheWxvYWQ6IGNodW5rLmRhdGEuc3ViYXJyYXkoNCkgfSk7XG4gICAgICBjdXJyZW50ID0gbnVsbDtcbiAgICB9XG4gIH1cbiAgYXNzZXJ0LmVxdWFsKGN1cnJlbnQsIG51bGwsICd0cmFpbGluZyBmY1RMIHdpdGggbm8gaW1hZ2UgZGF0YScpO1xuXG4gIGNvbnN0IGNhbnZhcyA9IG5ldyBVaW50OEFycmF5KHdpZHRoICogaGVpZ2h0ICogNCk7XG4gIGNvbnN0IGZyYW1lczogRGVjb2RlZEZyYW1lW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXcgb2YgcmF3cykge1xuICAgIGFzc2VydC5vayhcbiAgICAgIHJhdy5yZWN0LnggKyByYXcucmVjdC53IDw9IHdpZHRoICYmIHJhdy5yZWN0LnkgKyByYXcucmVjdC5oIDw9IGhlaWdodCxcbiAgICAgIGBmcmFtZSByZWN0YW5nbGUgJHtKU09OLnN0cmluZ2lmeShyYXcucmVjdCl9IGxlYXZlcyB0aGUgY2FudmFzYCxcbiAgICApO1xuICAgIGNvbnN0IGJwcCA9IHBhbGV0dGUgPyAxIDogNDtcbiAgICBjb25zdCBpbmZsYXRlZCA9IGF3YWl0IGluZmxhdGUocmF3LnBheWxvYWQpO1xuICAgIGNvbnN0IHN0cmlkZSA9IHJhdy5yZWN0LncgKiBicHA7XG4gICAgYXNzZXJ0LmVxdWFsKGluZmxhdGVkLmxlbmd0aCwgKHN0cmlkZSArIDEpICogcmF3LnJlY3QuaCwgJ2luZmxhdGVkIHNjYW5saW5lIHNpemUnKTtcbiAgICBjb25zdCBmbGF0ID0gdW5maWx0ZXJTY2FubGluZXMoaW5mbGF0ZWQsIHN0cmlkZSwgcmF3LnJlY3QuaCwgYnBwKTtcbiAgICBsZXQgc3ViOiBVaW50OEFycmF5O1xuICAgIGlmIChwYWxldHRlKSB7XG4gICAgICBzdWIgPSBuZXcgVWludDhBcnJheShyYXcucmVjdC53ICogcmF3LnJlY3QuaCAqIDQpO1xuICAgICAgZm9yIChsZXQgcCA9IDA7IHAgPCBmbGF0Lmxlbmd0aDsgcCsrKSB7XG4gICAgICAgIGNvbnN0IGlkeCA9IGZsYXRbcF07XG4gICAgICAgIGFzc2VydC5vayhpZHggKiA0IDwgcGFsZXR0ZS5sZW5ndGgsIGBwYWxldHRlIGluZGV4ICR7aWR4fSBvdXQgb2YgcmFuZ2VgKTtcbiAgICAgICAgc3ViLnNldChwYWxldHRlLnN1YmFycmF5KGlkeCAqIDQsIGlkeCAqIDQgKyA0KSwgcCAqIDQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBzdWIgPSBmbGF0O1xuICAgIH1cbiAgICBjb21wb3NpdGUoY2FudmFzLCB3aWR0aCwgcmF3LnJlY3QsIHN1YiwgcmF3LmJsZW5kKTtcbiAgICBmcmFtZXMucHVzaCh7IHJnYmE6IGNhbnZhcy5zbGljZSgpLCBkZWxheU1zOiByYXcuZGVsYXlNcywgcmVjdDogcmF3LnJlY3QsIGJsZW5kOiByYXcuYmxlbmQgfSk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHdpZHRoLCBoZWlnaHQsIGNvbG9yVHlwZSxcbiAgICBwYWxldHRlU2l6ZTogcGFsZXR0ZSA/IHBhbGV0dGUubGVuZ3RoIC8gNCA6IDAsXG4gICAgZGVjbGFyZWRGcmFtZXMsIGxvb3BzLCBmcmFtZXMsXG4gIH07XG59XG5cbi8vIC0tIEZpeHR1cmVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBXID0gNDA7XG5jb25zdCBIID0gMjQ7XG5cbi8qKiBBIHN0YXRpYyBncmFkaWVudCBiYWNrZ3JvdW5kIHdpdGggYW4gb3BhcXVlIHNxdWFyZSBhdCAoeCwgeSkuICovXG5mdW5jdGlvbiBzY2VuZUZyYW1lKHg6IG51bWJlciwgeTogbnVtYmVyLCBzaXplID0gNiwgYWxwaGEgPSAyNTUpOiBVaW50OEFycmF5IHtcbiAgY29uc3QgcHggPSBuZXcgVWludDhBcnJheShXICogSCAqIDQpO1xuICBmb3IgKGxldCBweSA9IDA7IHB5IDwgSDsgcHkrKykge1xuICAgIGZvciAobGV0IHB4eCA9IDA7IHB4eCA8IFc7IHB4eCsrKSB7XG4gICAgICBjb25zdCBpID0gKHB5ICogVyArIHB4eCkgKiA0O1xuICAgICAgcHhbaV0gPSAocHh4ICogNCkgJiAweGZmO1xuICAgICAgcHhbaSArIDFdID0gKHB5ICogOCkgJiAweGZmO1xuICAgICAgcHhbaSArIDJdID0gNjQ7XG4gICAgICBweFtpICsgM10gPSAyNTU7XG4gICAgfVxuICB9XG4gIGZvciAobGV0IGR5ID0gMDsgZHkgPCBzaXplOyBkeSsrKSB7XG4gICAgZm9yIChsZXQgZHggPSAwOyBkeCA8IHNpemU7IGR4KyspIHtcbiAgICAgIGNvbnN0IGkgPSAoKHkgKyBkeSkgKiBXICsgKHggKyBkeCkpICogNDtcbiAgICAgIHB4W2ldID0gMjU1O1xuICAgICAgcHhbaSArIDFdID0gMDtcbiAgICAgIHB4W2kgKyAyXSA9IDA7XG4gICAgICBweFtpICsgM10gPSBhbHBoYTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHB4O1xufVxuXG5mdW5jdGlvbiB3YWxrRnJhbWVzKGNvdW50OiBudW1iZXIsIGFscGhhID0gMjU1KTogQXBuZ0ZyYW1lW10ge1xuICByZXR1cm4gQXJyYXkuZnJvbSh7IGxlbmd0aDogY291bnQgfSwgKF8sIGkpID0+ICh7IGRhdGE6IHNjZW5lRnJhbWUoMiArIGkgKiAzLCA1LCA2LCBhbHBoYSkgfSkpO1xufVxuXG4vKiogTGFyZ2VzdCBwZXItY2hhbm5lbCBkaWZmZXJlbmNlIGJldHdlZW4gUkdCQSBpbWFnZXMuICovXG5mdW5jdGlvbiBtYXhDaGFubmVsRGVsdGEoYTogVWludDhBcnJheSwgYjogVWludDhBcnJheSk6IG51bWJlciB7XG4gIGxldCB3b3JzdCA9IDA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYS5sZW5ndGg7IGkrKykgd29yc3QgPSBNYXRoLm1heCh3b3JzdCwgTWF0aC5hYnMoYVtpXSAtIGJbaV0pKTtcbiAgcmV0dXJuIHdvcnN0O1xufVxuXG4vLyAtLSBUZXN0cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnZGVsYXlGcmFjdGlvbiBrZWVwcyBtaWxsaXNlY29uZCBwcmVjaXNpb24gYW5kIHN0YXlzIGluc2lkZSB1aW50MTYnLCAoKSA9PiB7XG4gIGFzc2VydC5kZWVwRXF1YWwoZGVsYXlGcmFjdGlvbigxMDApLCB7IG51bTogMTAwLCBkZW46IDEwMDAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZGVsYXlGcmFjdGlvbigzMyksIHsgbnVtOiAzMywgZGVuOiAxMDAwIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGRlbGF5RnJhY3Rpb24oMCksIHsgbnVtOiAwLCBkZW46IDEwMDAgfSk7XG4gIGZvciAoY29uc3QgbXMgb2YgWzEsIDE2LCA2NSwgNjU1MzUsIDY1NTM2LCAxMDAwMDAsIDYwMDAwMCwgMTBfMDAwXzAwMF0pIHtcbiAgICBjb25zdCB7IG51bSwgZGVuIH0gPSBkZWxheUZyYWN0aW9uKG1zKTtcbiAgICBhc3NlcnQub2sobnVtID49IDAgJiYgbnVtIDw9IDB4ZmZmZiwgYG51bSAke251bX0gb3V0IG9mIHJhbmdlIGZvciAke21zfW1zYCk7XG4gICAgYXNzZXJ0Lm9rKGRlbiA+PSAxICYmIGRlbiA8PSAweGZmZmYsIGBkZW4gJHtkZW59IG91dCBvZiByYW5nZSBmb3IgJHttc31tc2ApO1xuICAgIGNvbnN0IGRlY29kZWQgPSAobnVtIC8gZGVuKSAqIDEwMDA7XG4gICAgYXNzZXJ0Lm9rKE1hdGguYWJzKGRlY29kZWQgLSBtcykgPD0gbXMgKiAwLjAxICsgMSwgYCR7bXN9bXMgZGVjb2RlZCBhcyAke2RlY29kZWR9bXNgKTtcbiAgfVxufSk7XG5cbnRlc3QoJ3RocmVzaG9sZCAwIHJlcHJvZHVjZXMgZXZlcnkgZnJhbWUgZXhhY3RseScsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgZnJhbWVzID0gd2Fsa0ZyYW1lcyg1KTtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZW5jb2RlQXBuZyhXLCBILCBmcmFtZXMsIHsgdGhyZXNob2xkOiAwLCBjb2xvclR5cGU6ICdyZ2JhJyB9KTtcbiAgY29uc3QgZGVjb2RlZCA9IGF3YWl0IGRlY29kZUFwbmcocmVzdWx0LmJ5dGVzKTtcbiAgYXNzZXJ0LmVxdWFsKGRlY29kZWQud2lkdGgsIFcpO1xuICBhc3NlcnQuZXF1YWwoZGVjb2RlZC5oZWlnaHQsIEgpO1xuICBhc3NlcnQuZXF1YWwoZGVjb2RlZC5mcmFtZXMubGVuZ3RoLCBmcmFtZXMubGVuZ3RoKTtcbiAgYXNzZXJ0LmVxdWFsKGRlY29kZWQuZGVjbGFyZWRGcmFtZXMsIGZyYW1lcy5sZW5ndGgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGZyYW1lcy5sZW5ndGg7IGkrKykge1xuICAgIGFzc2VydC5lcXVhbChcbiAgICAgIG1heENoYW5uZWxEZWx0YShkZWNvZGVkLmZyYW1lc1tpXS5yZ2JhLCBmcmFtZXNbaV0uZGF0YSBhcyBVaW50OEFycmF5KSwgMCxcbiAgICAgIGBmcmFtZSAke2l9IGRpZmZlcnNgLFxuICAgICk7XG4gIH1cbn0pO1xuXG50ZXN0KCdhIG5vbi16ZXJvIHRocmVzaG9sZCBzdGF5cyB3aXRoaW4gaXRzZWxmIG9uIGV2ZXJ5IHBpeGVsIG9mIGV2ZXJ5IGZyYW1lJywgYXN5bmMgKCkgPT4ge1xuICBsZXQgc2VlZCA9IDk5O1xuICBjb25zdCBmcmFtZXMgPSB3YWxrRnJhbWVzKDYpLm1hcCgoZikgPT4ge1xuICAgIGNvbnN0IHB4ID0gKGYuZGF0YSBhcyBVaW50OEFycmF5KS5zbGljZSgpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcHgubGVuZ3RoOyBpICs9IDQpIHtcbiAgICAgIHNlZWQgPSAoc2VlZCAqIDExMDM1MTUyNDUgKyAxMjM0NSkgPj4+IDA7XG4gICAgICBjb25zdCBkID0gKChzZWVkID4+PiAyMCkgJSA1KSAtIDI7XG4gICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDM7IGMrKykgcHhbaSArIGNdID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMjU1LCBweFtpICsgY10gKyBkKSk7XG4gICAgfVxuICAgIHJldHVybiB7IGRhdGE6IHB4IH07XG4gIH0pO1xuICBjb25zdCB0aHJlc2hvbGQgPSAyO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBlbmNvZGVBcG5nKFcsIEgsIGZyYW1lcywgeyB0aHJlc2hvbGQsIGNvbG9yVHlwZTogJ3JnYmEnIH0pO1xuICBjb25zdCBkZWNvZGVkID0gYXdhaXQgZGVjb2RlQXBuZyhyZXN1bHQuYnl0ZXMpO1xuXG4gIGxldCBvdXQgPSAwO1xuICBmb3IgKGNvbnN0IHN0YXQgb2YgcmVzdWx0LmZyYW1lcykge1xuICAgIGZvciAobGV0IGsgPSAwOyBrIDw9IHN0YXQuY29hbGVzY2VkOyBrKyspIHtcbiAgICAgIGFzc2VydC5vayhcbiAgICAgICAgbWF4Q2hhbm5lbERlbHRhKGRlY29kZWQuZnJhbWVzW291dF0ucmdiYSwgZnJhbWVzW3N0YXQuc291cmNlSW5kZXggKyBrXS5kYXRhIGFzIFVpbnQ4QXJyYXkpIDw9IHRocmVzaG9sZCxcbiAgICAgICAgYHNvdXJjZSBmcmFtZSAke3N0YXQuc291cmNlSW5kZXggKyBrfSBkcmlmdGVkIHBhc3QgdGhlIHRocmVzaG9sZGAsXG4gICAgICApO1xuICAgIH1cbiAgICBvdXQrKztcbiAgfVxufSk7XG5cbnRlc3QoJ2V2ZXJ5IHNvdXJjZSBmcmFtZSBpcyBhY2NvdW50ZWQgZm9yLCBpbiBvcmRlcicsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgZnJhbWVzID0gWy4uLndhbGtGcmFtZXMoMyksIHsgZGF0YTogc2NlbmVGcmFtZSgyICsgMiAqIDMsIDUpIH0sIC4uLndhbGtGcmFtZXMoMildO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBlbmNvZGVBcG5nKFcsIEgsIGZyYW1lcywgeyB0aHJlc2hvbGQ6IDAgfSk7XG4gIGxldCBleHBlY3RlZCA9IDA7XG4gIGZvciAoY29uc3Qgc3RhdCBvZiByZXN1bHQuZnJhbWVzKSB7XG4gICAgYXNzZXJ0LmVxdWFsKHN0YXQuc291cmNlSW5kZXgsIGV4cGVjdGVkLCAnZnJhbWVzIG11c3Qgc3RheSBpbiBzb3VyY2Ugb3JkZXInKTtcbiAgICBleHBlY3RlZCArPSAxICsgc3RhdC5jb2FsZXNjZWQ7XG4gIH1cbiAgYXNzZXJ0LmVxdWFsKGV4cGVjdGVkLCBmcmFtZXMubGVuZ3RoKTtcbiAgYXNzZXJ0LmVxdWFsKHJlc3VsdC5zb3VyY2VGcmFtZUNvdW50LCBmcmFtZXMubGVuZ3RoKTtcbn0pO1xuXG50ZXN0KCdpZGVudGljYWwgZnJhbWVzIGNvYWxlc2NlIGludG8gb25lIGZyYW1lIHdpdGggdGhlIGRlbGF5cyBhZGRlZCB1cCcsIGFzeW5jICgpID0+IHtcbiAgY29uc3Qgc3RpbGwgPSBzY2VuZUZyYW1lKDQsIDQpO1xuICBjb25zdCBmcmFtZXM6IEFwbmdGcmFtZVtdID0gW1xuICAgIHsgZGF0YTogc3RpbGwsIGRlbGF5TXM6IDQwIH0sXG4gICAgeyBkYXRhOiBzdGlsbC5zbGljZSgpLCBkZWxheU1zOiA2MCB9LFxuICAgIHsgZGF0YTogc3RpbGwuc2xpY2UoKSwgZGVsYXlNczogMTAwIH0sXG4gICAgeyBkYXRhOiBzY2VuZUZyYW1lKDEwLCA0KSwgZGVsYXlNczogNDAgfSxcbiAgXTtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZW5jb2RlQXBuZyhXLCBILCBmcmFtZXMsIHsgdGhyZXNob2xkOiAwIH0pO1xuICBhc3NlcnQuZXF1YWwocmVzdWx0LmZyYW1lQ291bnQsIDIpO1xuICBhc3NlcnQuZXF1YWwocmVzdWx0LmZyYW1lc1swXS5kZWxheU1zLCAyMDApO1xuICBhc3NlcnQuZXF1YWwocmVzdWx0LmZyYW1lc1swXS5jb2FsZXNjZWQsIDIpO1xuXG4gIGNvbnN0IGRlY29kZWQgPSBhd2FpdCBkZWNvZGVBcG5nKHJlc3VsdC5ieXRlcyk7XG4gIGFzc2VydC5lcXVhbChkZWNvZGVkLmZyYW1lcy5sZW5ndGgsIDIpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoZGVjb2RlZC5mcmFtZXNbMF0uZGVsYXlNcyAtIDIwMCkgPCAxKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGRlY29kZWQuZnJhbWVzWzFdLmRlbGF5TXMgLSA0MCkgPCAxKTtcbn0pO1xuXG50ZXN0KCdjb2FsZXNjaW5nIG9mZiBrZWVwcyBldmVyeSBmcmFtZSwgYW5kIHRoZSBzdGlsbCBvbmVzIHN0YXkgdGlueScsIGFzeW5jICgpID0+IHtcbiAgY29uc3Qgc3RpbGwgPSBzY2VuZUZyYW1lKDQsIDQpO1xuICBjb25zdCBmcmFtZXM6IEFwbmdGcmFtZVtdID0gW3sgZGF0YTogc3RpbGwgfSwgeyBkYXRhOiBzdGlsbC5zbGljZSgpIH0sIHsgZGF0YTogc3RpbGwuc2xpY2UoKSB9XTtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZW5jb2RlQXBuZyhXLCBILCBmcmFtZXMsIHsgdGhyZXNob2xkOiAwLCBjb2FsZXNjZTogZmFsc2UgfSk7XG4gIGFzc2VydC5lcXVhbChyZXN1bHQuZnJhbWVDb3VudCwgMyk7XG4gIGZvciAoY29uc3Qgc3RhdCBvZiByZXN1bHQuZnJhbWVzLnNsaWNlKDEpKSB7XG4gICAgYXNzZXJ0LmRlZXBFcXVhbChzdGF0LnJlY3QsIHsgeDogMCwgeTogMCwgdzogMSwgaDogMSB9KTtcbiAgfVxuICBjb25zdCBkZWNvZGVkID0gYXdhaXQgZGVjb2RlQXBuZyhyZXN1bHQuYnl0ZXMpO1xuICBhc3NlcnQuZXF1YWwoZGVjb2RlZC5mcmFtZXMubGVuZ3RoLCAzKTtcbiAgZm9yIChjb25zdCBmcmFtZSBvZiBkZWNvZGVkLmZyYW1lcykge1xuICAgIGFzc2VydC5lcXVhbChtYXhDaGFubmVsRGVsdGEoZnJhbWUucmdiYSwgc3RpbGwpLCAwKTtcbiAgfVxufSk7XG5cbnRlc3QoJ3RoZSBkaXJ0eSByZWN0YW5nbGUgaXMgdGhlIGNoYW5nZWQgYXJlYSwgbm90IHRoZSB3aG9sZSBjYW52YXMnLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IGEgPSBzY2VuZUZyYW1lKDQsIDQpO1xuICBjb25zdCBiID0gYS5zbGljZSgpO1xuICBjb25zdCBpID0gKDEwICogVyArIDIwKSAqIDQ7XG4gIGJbaV0gPSAwO1xuICBiW2kgKyAxXSA9IDI1NTtcbiAgYltpICsgMl0gPSAyNTU7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVuY29kZUFwbmcoVywgSCwgW3sgZGF0YTogYSB9LCB7IGRhdGE6IGIgfV0sIHsgdGhyZXNob2xkOiAwIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKHJlc3VsdC5mcmFtZXNbMF0ucmVjdCwgeyB4OiAwLCB5OiAwLCB3OiBXLCBoOiBIIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKHJlc3VsdC5mcmFtZXNbMV0ucmVjdCwgeyB4OiAyMCwgeTogMTAsIHc6IDEsIGg6IDEgfSk7XG4gIGFzc2VydC5vayhyZXN1bHQuZnJhbWVzWzFdLmJ5dGVzIDwgcmVzdWx0LmZyYW1lc1swXS5ieXRlcyAvIDQpO1xufSk7XG5cbnRlc3QoJ2FuIG9wYXF1ZSBwYXJ0aWFsIGNoYW5nZSB1c2VzIE9WRVI7IGEgdHJhbnNsdWNlbnQgb25lIGZhbGxzIGJhY2sgdG8gU09VUkNFJywgYXN5bmMgKCkgPT4ge1xuICBjb25zdCBvcGFxdWUgPSBhd2FpdCBlbmNvZGVBcG5nKFcsIEgsIHdhbGtGcmFtZXMoMyksIHsgdGhyZXNob2xkOiAwLCBjb2xvclR5cGU6ICdyZ2JhJyB9KTtcbiAgYXNzZXJ0LmVxdWFsKG9wYXF1ZS5mcmFtZXNbMV0uYmxlbmQsICdvdmVyJyk7XG5cbiAgY29uc3QgdHJhbnNsdWNlbnQgPSBhd2FpdCBlbmNvZGVBcG5nKFcsIEgsIHdhbGtGcmFtZXMoMywgMTI4KSwgeyB0aHJlc2hvbGQ6IDAsIGNvbG9yVHlwZTogJ3JnYmEnIH0pO1xuICBhc3NlcnQuZXF1YWwodHJhbnNsdWNlbnQuZnJhbWVzWzFdLmJsZW5kLCAnc291cmNlJyk7XG4gIGNvbnN0IGRlY29kZWQgPSBhd2FpdCBkZWNvZGVBcG5nKHRyYW5zbHVjZW50LmJ5dGVzKTtcbiAgY29uc3Qgc291cmNlcyA9IHdhbGtGcmFtZXMoMywgMTI4KTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAzOyBpKyspIHtcbiAgICBhc3NlcnQuZXF1YWwobWF4Q2hhbm5lbERlbHRhKGRlY29kZWQuZnJhbWVzW2ldLnJnYmEsIHNvdXJjZXNbaV0uZGF0YSBhcyBVaW50OEFycmF5KSwgMCwgYGZyYW1lICR7aX1gKTtcbiAgfVxufSk7XG5cbnRlc3QoJ2Zldy1jb2xvdXIgZnJhbWVzIGJlY29tZSBhbiBpbmRleGVkIFBORyBhbmQgc3RpbGwgZGVjb2RlIGV4YWN0bHknLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IGZsYXQgPSAoc2hpZnQ6IG51bWJlcik6IFVpbnQ4QXJyYXkgPT4ge1xuICAgIGNvbnN0IHB4ID0gbmV3IFVpbnQ4QXJyYXkoVyAqIEggKiA0KTtcbiAgICBmb3IgKGxldCBwID0gMDsgcCA8IFcgKiBIOyBwKyspIHtcbiAgICAgIGNvbnN0IG9uID0gKChwICsgc2hpZnQpID4+IDMpICUgMiA9PT0gMDtcbiAgICAgIHB4LnNldChvbiA/IFsyMDAsIDMwLCAzMCwgMjU1XSA6IFsyMCwgMjAsIDQwLCAyNTVdLCBwICogNCk7XG4gICAgfVxuICAgIHJldHVybiBweDtcbiAgfTtcbiAgY29uc3QgZnJhbWVzID0gW3sgZGF0YTogZmxhdCgwKSB9LCB7IGRhdGE6IGZsYXQoNCkgfSwgeyBkYXRhOiBmbGF0KDgpIH1dO1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBlbmNvZGVBcG5nKFcsIEgsIGZyYW1lcywgeyB0aHJlc2hvbGQ6IDAgfSk7XG4gIGFzc2VydC5lcXVhbChyZXN1bHQuY29sb3JUeXBlLCAnaW5kZXhlZCcpO1xuICBhc3NlcnQuZXF1YWwocmVzdWx0LnBhbGV0dGVTaXplLCAzKTsgLy8gY29sb3VycyBwbHVzIHRoZSB0cmFuc3BhcmVudCBzZW50aW5lbFxuXG4gIGNvbnN0IGRlY29kZWQgPSBhd2FpdCBkZWNvZGVBcG5nKHJlc3VsdC5ieXRlcyk7XG4gIGFzc2VydC5lcXVhbChkZWNvZGVkLmNvbG9yVHlwZSwgMyk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZnJhbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgYXNzZXJ0LmVxdWFsKG1heENoYW5uZWxEZWx0YShkZWNvZGVkLmZyYW1lc1tpXS5yZ2JhLCBmcmFtZXNbaV0uZGF0YSBhcyBVaW50OEFycmF5KSwgMCwgYGZyYW1lICR7aX1gKTtcbiAgfVxufSk7XG5cbnRlc3QoJ2luZGV4ZWQgb3V0cHV0IGJlYXRzIFJHQkEgb24gZmV3LWNvbG91ciBmcmFtZXMnLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IGZsYXQgPSAoc2hpZnQ6IG51bWJlcik6IFVpbnQ4QXJyYXkgPT4ge1xuICAgIGNvbnN0IHB4ID0gbmV3IFVpbnQ4QXJyYXkoVyAqIEggKiA0KTtcbiAgICBmb3IgKGxldCBwID0gMDsgcCA8IFcgKiBIOyBwKyspIHtcbiAgICAgIHB4LnNldCgoKHAgKyBzaGlmdCkgPj4gMykgJSAyID09PSAwID8gWzIwMCwgMzAsIDMwLCAyNTVdIDogWzIwLCAyMCwgNDAsIDI1NV0sIHAgKiA0KTtcbiAgICB9XG4gICAgcmV0dXJuIHB4O1xuICB9O1xuICBjb25zdCBmcmFtZXMgPSBbeyBkYXRhOiBmbGF0KDApIH0sIHsgZGF0YTogZmxhdCg1KSB9XTtcbiAgY29uc3QgaW5kZXhlZCA9IGF3YWl0IGVuY29kZUFwbmcoVywgSCwgZnJhbWVzLCB7IHRocmVzaG9sZDogMCwgY29sb3JUeXBlOiAnYXV0bycgfSk7XG4gIGNvbnN0IHJnYmEgPSBhd2FpdCBlbmNvZGVBcG5nKFcsIEgsIGZyYW1lcywgeyB0aHJlc2hvbGQ6IDAsIGNvbG9yVHlwZTogJ3JnYmEnIH0pO1xuICBhc3NlcnQuZXF1YWwoaW5kZXhlZC5jb2xvclR5cGUsICdpbmRleGVkJyk7XG4gIGFzc2VydC5lcXVhbChyZ2JhLmNvbG9yVHlwZSwgJ3JnYmEnKTtcbiAgYXNzZXJ0Lm9rKGluZGV4ZWQuYnl0ZXMubGVuZ3RoIDwgcmdiYS5ieXRlcy5sZW5ndGgsIGAke2luZGV4ZWQuYnl0ZXMubGVuZ3RofSB2cyAke3JnYmEuYnl0ZXMubGVuZ3RofWApO1xufSk7XG5cbnRlc3QoJ2EgbWFueS1jb2xvdXIgZnJhbWUgc3RheXMgUkdCQSB1bmRlciBjb2xvclR5cGUgYXV0bycsIGFzeW5jICgpID0+IHtcbiAgY29uc3Qgbm9pc3kgPSBuZXcgVWludDhBcnJheShXICogSCAqIDQpO1xuICBsZXQgc2VlZCA9IDc7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbm9pc3kubGVuZ3RoOyBpICs9IDQpIHtcbiAgICBzZWVkID0gKHNlZWQgKiAxNjY0NTI1ICsgMTAxMzkwNDIyMykgPj4+IDA7XG4gICAgbm9pc3lbaV0gPSBzZWVkICYgMHhmZjtcbiAgICBub2lzeVtpICsgMV0gPSAoc2VlZCA+Pj4gOCkgJiAweGZmO1xuICAgIG5vaXN5W2kgKyAyXSA9IChzZWVkID4+PiAxNikgJiAweGZmO1xuICAgIG5vaXN5W2kgKyAzXSA9IDI1NTtcbiAgfVxuICBjb25zdCByZXN1bHQgPSBhd2FpdCBlbmNvZGVBcG5nKFcsIEgsIFt7IGRhdGE6IG5vaXN5IH1dLCB7IHRocmVzaG9sZDogMCB9KTtcbiAgYXNzZXJ0LmVxdWFsKHJlc3VsdC5jb2xvclR5cGUsICdyZ2JhJyk7XG4gIGFzc2VydC5lcXVhbCgoYXdhaXQgZGVjb2RlQXBuZyhyZXN1bHQuYnl0ZXMpKS5jb2xvclR5cGUsIDYpO1xufSk7XG5cbnRlc3QoJ2NvbG9yVHlwZSBcImluZGV4ZWRcIiBmYWlscyBsb3VkbHkgcmF0aGVyIHRoYW4gcXVhbnRpc2luZycsIGFzeW5jICgpID0+IHtcbiAgY29uc3Qgbm9pc3kgPSBuZXcgVWludDhBcnJheShXICogSCAqIDQpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IG5vaXN5Lmxlbmd0aDsgaSArPSA0KSB7XG4gICAgbm9pc3lbaV0gPSAoaSAvIDQpICYgMHhmZjtcbiAgICBub2lzeVtpICsgMV0gPSAoaSAvIDgpICYgMHhmZjtcbiAgICBub2lzeVtpICsgMl0gPSAoaSAvIDE2KSAmIDB4ZmY7XG4gICAgbm9pc3lbaSArIDNdID0gMjU1O1xuICB9XG4gIGF3YWl0IGFzc2VydC5yZWplY3RzKFxuICAgICgpID0+IGVuY29kZUFwbmcoVywgSCwgW3sgZGF0YTogbm9pc3kgfV0sIHsgY29sb3JUeXBlOiAnaW5kZXhlZCcgfSksXG4gICAgL21vcmUgdGhhbiAyNTYgZGlzdGluY3QgY29sb3Vycy8sXG4gICk7XG59KTtcblxudGVzdCgnZWZmb3J0IFwiYmVzdFwiIGlzIG5ldmVyIGxhcmdlciB0aGFuIFwiZmFzdFwiJywgYXN5bmMgKCkgPT4ge1xuICBjb25zdCBmcmFtZXMgPSB3YWxrRnJhbWVzKDQpO1xuICBjb25zdCBmYXN0ID0gYXdhaXQgZW5jb2RlQXBuZyhXLCBILCBmcmFtZXMsIHsgdGhyZXNob2xkOiAwLCBlZmZvcnQ6ICdmYXN0JywgY29sb3JUeXBlOiAncmdiYScgfSk7XG4gIGNvbnN0IGJlc3QgPSBhd2FpdCBlbmNvZGVBcG5nKFcsIEgsIGZyYW1lcywgeyB0aHJlc2hvbGQ6IDAsIGVmZm9ydDogJ2Jlc3QnLCBjb2xvclR5cGU6ICdyZ2JhJyB9KTtcbiAgYXNzZXJ0Lm9rKGJlc3QuYnl0ZXMubGVuZ3RoIDw9IGZhc3QuYnl0ZXMubGVuZ3RoLCBgJHtiZXN0LmJ5dGVzLmxlbmd0aH0gdnMgJHtmYXN0LmJ5dGVzLmxlbmd0aH1gKTtcbiAgY29uc3QgZGVjb2RlZCA9IGF3YWl0IGRlY29kZUFwbmcoYmVzdC5ieXRlcyk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZnJhbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgYXNzZXJ0LmVxdWFsKG1heENoYW5uZWxEZWx0YShkZWNvZGVkLmZyYW1lc1tpXS5yZ2JhLCBmcmFtZXNbaV0uZGF0YSBhcyBVaW50OEFycmF5KSwgMCwgYGZyYW1lICR7aX1gKTtcbiAgfVxufSk7XG5cbnRlc3QoJ2RpZmZlcmVuY2luZyBiZWF0cyBzdG9yaW5nIGV2ZXJ5IGZyYW1lIHdob2xlJywgYXN5bmMgKCkgPT4ge1xuICAvLyBBIG5vaXN5IGJhY2tncm91bmQgaXMgdGhlIGhvbmVzdCBmaXh0dXJlOiBhIHNtb290aCBncmFkaWVudCBjb21wcmVzc2VzIHNvIHdlbGwgd2hvbGUgdGhhdCBzdG9yaW5nIGl0IHNldmVyYWwgdGltZXMgd291bGQgYWxzbyBsb29rIGNoZWFwLlxuICBjb25zdCBub2lzZSA9IG5ldyBVaW50OEFycmF5KFcgKiBIICogNCk7XG4gIGxldCBzZWVkID0gNDI0MjtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBub2lzZS5sZW5ndGg7IGkgKz0gNCkge1xuICAgIHNlZWQgPSAoc2VlZCAqIDE2NjQ1MjUgKyAxMDEzOTA0MjIzKSA+Pj4gMDtcbiAgICBub2lzZVtpXSA9IHNlZWQgJiAweGZmO1xuICAgIG5vaXNlW2kgKyAxXSA9IChzZWVkID4+PiA4KSAmIDB4ZmY7XG4gICAgbm9pc2VbaSArIDJdID0gKHNlZWQgPj4+IDE2KSAmIDB4ZmY7XG4gICAgbm9pc2VbaSArIDNdID0gMjU1O1xuICB9XG4gIGNvbnN0IGZyYW1lczogQXBuZ0ZyYW1lW10gPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiA4IH0sIChfLCBrKSA9PiB7XG4gICAgY29uc3QgcHggPSBub2lzZS5zbGljZSgpO1xuICAgIGZvciAobGV0IGR5ID0gMDsgZHkgPCA1OyBkeSsrKSB7XG4gICAgICBmb3IgKGxldCBkeCA9IDA7IGR4IDwgNTsgZHgrKykge1xuICAgICAgICBweC5zZXQoWzI1NSwgMjU1LCAyNTUsIDI1NV0sICgoNiArIGR5KSAqIFcgKyAoMiArIGsgKiA0ICsgZHgpKSAqIDQpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4geyBkYXRhOiBweCB9O1xuICB9KTtcblxuICBjb25zdCByZXN1bHQgPSBhd2FpdCBlbmNvZGVBcG5nKFcsIEgsIGZyYW1lcywgeyB0aHJlc2hvbGQ6IDAsIGNvbG9yVHlwZTogJ3JnYmEnIH0pO1xuICBjb25zdCBrZXlmcmFtZSA9IHJlc3VsdC5mcmFtZXNbMF0uYnl0ZXM7XG4gIGNvbnN0IGxhdGVyQnl0ZXMgPSByZXN1bHQuZnJhbWVzLnNsaWNlKDEpLnJlZHVjZSgocywgZikgPT4gcyArIGYuYnl0ZXMsIDApO1xuICAvLyBNb3JlIGZyYW1lcyBvZiBhIHN0YXRpYyBzY2VuZSBjb3N0IGEgZnJhY3Rpb24gb2Ygb25lIHdob2xlIGZyYW1lLlxuICBhc3NlcnQub2sobGF0ZXJCeXRlcyA8IGtleWZyYW1lIC8gNCwgYCR7bGF0ZXJCeXRlc30gdnMgb25lIHdob2xlIGZyYW1lIGF0ICR7a2V5ZnJhbWV9YCk7XG5cbiAgY29uc3QgZGVjb2RlZCA9IGF3YWl0IGRlY29kZUFwbmcocmVzdWx0LmJ5dGVzKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBmcmFtZXMubGVuZ3RoOyBpKyspIHtcbiAgICBhc3NlcnQuZXF1YWwobWF4Q2hhbm5lbERlbHRhKGRlY29kZWQuZnJhbWVzW2ldLnJnYmEsIGZyYW1lc1tpXS5kYXRhIGFzIFVpbnQ4QXJyYXkpLCAwLCBgZnJhbWUgJHtpfWApO1xuICB9XG59KTtcblxudGVzdCgnbG9vcHMgaXMgd3JpdHRlbiB0byBhY1RMLCAwIG1lYW5pbmcgZm9yZXZlcicsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgZnJhbWVzID0gd2Fsa0ZyYW1lcygyKTtcbiAgYXNzZXJ0LmVxdWFsKChhd2FpdCBkZWNvZGVBcG5nKChhd2FpdCBlbmNvZGVBcG5nKFcsIEgsIGZyYW1lcywgeyB0aHJlc2hvbGQ6IDAgfSkpLmJ5dGVzKSkubG9vcHMsIDApO1xuICBjb25zdCB0aHJpY2UgPSBhd2FpdCBlbmNvZGVBcG5nKFcsIEgsIGZyYW1lcywgeyB0aHJlc2hvbGQ6IDAsIGxvb3BzOiAzIH0pO1xuICBhc3NlcnQuZXF1YWwoKGF3YWl0IGRlY29kZUFwbmcodGhyaWNlLmJ5dGVzKSkubG9vcHMsIDMpO1xufSk7XG5cbnRlc3QoJ29uUHJvZ3Jlc3MgcmVwb3J0cyBldmVyeSBzb3VyY2UgZnJhbWUgb25jZSwgaW4gb3JkZXInLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHNlZW46IG51bWJlcltdID0gW107XG4gIGNvbnN0IGZyYW1lcyA9IHdhbGtGcmFtZXMoNCk7XG4gIGF3YWl0IGVuY29kZUFwbmcoVywgSCwgZnJhbWVzLCB7XG4gICAgdGhyZXNob2xkOiAwLFxuICAgIG9uUHJvZ3Jlc3M6IChkb25lLCB0b3RhbCkgPT4ge1xuICAgICAgYXNzZXJ0LmVxdWFsKHRvdGFsLCA0KTtcbiAgICAgIHNlZW4ucHVzaChkb25lKTtcbiAgICB9LFxuICB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChzZWVuLCBbMSwgMiwgMywgNF0pO1xufSk7XG5cbnRlc3QoJ2EgY3VzdG9tIGRlZmxhdGUgaXMgdXNlZCBmb3IgZXZlcnkgZnJhbWUnLCBhc3luYyAoKSA9PiB7XG4gIGxldCBjYWxscyA9IDA7XG4gIGNvbnN0IGZyYW1lcyA9IHdhbGtGcmFtZXMoMyk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVuY29kZUFwbmcoVywgSCwgZnJhbWVzLCB7XG4gICAgdGhyZXNob2xkOiAwLFxuICAgIGRlZmxhdGU6IGFzeW5jIChieXRlcykgPT4ge1xuICAgICAgY2FsbHMrKztcbiAgICAgIGNvbnN0IGNzID0gbmV3IENvbXByZXNzaW9uU3RyZWFtKCdkZWZsYXRlJyk7XG4gICAgICBjb25zdCBkb25lID0gbmV3IFJlc3BvbnNlKGNzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpO1xuICAgICAgY29uc3Qgd3JpdGVyID0gY3Mud3JpdGFibGUuZ2V0V3JpdGVyKCkgYXMgV3JpdGFibGVTdHJlYW1EZWZhdWx0V3JpdGVyPFVpbnQ4QXJyYXk+O1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW2RvbmUsIHdyaXRlci53cml0ZShieXRlcykudGhlbigoKSA9PiB3cml0ZXIuY2xvc2UoKSldKTtcbiAgICAgIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCBkb25lKTtcbiAgICB9LFxuICB9KTtcbiAgYXNzZXJ0LmVxdWFsKGNhbGxzLCAzKTtcbiAgY29uc3QgZGVjb2RlZCA9IGF3YWl0IGRlY29kZUFwbmcocmVzdWx0LmJ5dGVzKTtcbiAgYXNzZXJ0LmVxdWFsKGRlY29kZWQuZnJhbWVzLmxlbmd0aCwgMyk7XG59KTtcblxudGVzdCgnYmFkIGlucHV0IGlzIHJlamVjdGVkIGluc3RlYWQgb2YgZW5jb2RlZCcsIGFzeW5jICgpID0+IHtcbiAgYXdhaXQgYXNzZXJ0LnJlamVjdHMoKCkgPT4gZW5jb2RlQXBuZyhXLCBILCBbXSksIC9hdCBsZWFzdCBvbmUgZnJhbWUvKTtcbiAgYXdhaXQgYXNzZXJ0LnJlamVjdHMoXG4gICAgKCkgPT4gZW5jb2RlQXBuZyhXLCBILCBbeyBkYXRhOiBuZXcgVWludDhBcnJheSgxMCkgfV0pLFxuICAgIC9leHBlY3RlZCAzODQwIFxcKDQweDI0IFJHQkE4XFwpLyxcbiAgKTtcbiAgYXdhaXQgYXNzZXJ0LnJlamVjdHMoKCkgPT4gZW5jb2RlQXBuZygwLCBILCB3YWxrRnJhbWVzKDEpKSwgL3Bvc2l0aXZlIGludGVnZXJzLyk7XG4gIGF3YWl0IGFzc2VydC5yZWplY3RzKCgpID0+IGVuY29kZUFwbmcoVywgMS41LCB3YWxrRnJhbWVzKDEpKSwgL3Bvc2l0aXZlIGludGVnZXJzLyk7XG59KTtcblxudGVzdCgnYSBzaW5nbGUtZnJhbWUgYW5pbWF0aW9uIGlzIGEgdmFsaWQgb25lLWZyYW1lIEFQTkcnLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IGZyYW1lcyA9IHdhbGtGcmFtZXMoMSk7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVuY29kZUFwbmcoVywgSCwgZnJhbWVzLCB7IHRocmVzaG9sZDogMCB9KTtcbiAgYXNzZXJ0LmVxdWFsKHJlc3VsdC5mcmFtZUNvdW50LCAxKTtcbiAgY29uc3QgZGVjb2RlZCA9IGF3YWl0IGRlY29kZUFwbmcocmVzdWx0LmJ5dGVzKTtcbiAgYXNzZXJ0LmVxdWFsKGRlY29kZWQuZGVjbGFyZWRGcmFtZXMsIDEpO1xuICBhc3NlcnQuZXF1YWwobWF4Q2hhbm5lbERlbHRhKGRlY29kZWQuZnJhbWVzWzBdLnJnYmEsIGZyYW1lc1swXS5kYXRhIGFzIFVpbnQ4QXJyYXkpLCAwKTtcbn0pO1xuXG50ZXN0KCdhIDF4MSBhbmltYXRpb24gZW5jb2RlcyBhbmQgZGVjb2RlcycsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgYSA9IFVpbnQ4QXJyYXkuZnJvbShbMjU1LCAwLCAwLCAyNTVdKTtcbiAgY29uc3QgYiA9IFVpbnQ4QXJyYXkuZnJvbShbMCwgMCwgMjU1LCAyNTVdKTtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZW5jb2RlQXBuZygxLCAxLCBbeyBkYXRhOiBhIH0sIHsgZGF0YTogYiB9XSwgeyB0aHJlc2hvbGQ6IDAgfSk7XG4gIGNvbnN0IGRlY29kZWQgPSBhd2FpdCBkZWNvZGVBcG5nKHJlc3VsdC5ieXRlcyk7XG4gIGFzc2VydC5lcXVhbChkZWNvZGVkLmZyYW1lcy5sZW5ndGgsIDIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKFsuLi5kZWNvZGVkLmZyYW1lc1sxXS5yZ2JhXSwgWy4uLmJdKTtcbn0pO1xuXG50ZXN0KCdmcmFtZXMgd2l0aCBhbHBoYSByb3VuZC10cmlwIHRocm91Z2ggdGhlIE9WRVIgcGF0aCcsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgcHggPSAoYTogbnVtYmVyLCBzaGlmdDogbnVtYmVyKTogVWludDhBcnJheSA9PiB7XG4gICAgY29uc3Qgb3V0ID0gbmV3IFVpbnQ4QXJyYXkoVyAqIEggKiA0KTtcbiAgICBmb3IgKGxldCBwID0gMDsgcCA8IFcgKiBIOyBwKyspIHtcbiAgICAgIG91dC5zZXQocCAlIDcgPT09IHNoaWZ0ID8gWzEwLCAyMDAsIDMwLCBhXSA6IFswLCAwLCAwLCAwXSwgcCAqIDQpO1xuICAgIH1cbiAgICByZXR1cm4gb3V0O1xuICB9O1xuICBjb25zdCBmcmFtZXMgPSBbeyBkYXRhOiBweCgyNTUsIDApIH0sIHsgZGF0YTogcHgoMjU1LCAxKSB9LCB7IGRhdGE6IHB4KDEyOCwgMikgfV07XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVuY29kZUFwbmcoVywgSCwgZnJhbWVzLCB7IHRocmVzaG9sZDogMCwgY29sb3JUeXBlOiAncmdiYScgfSk7XG4gIGNvbnN0IGRlY29kZWQgPSBhd2FpdCBkZWNvZGVBcG5nKHJlc3VsdC5ieXRlcyk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZnJhbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgYXNzZXJ0LmVxdWFsKG1heENoYW5uZWxEZWx0YShkZWNvZGVkLmZyYW1lc1tpXS5yZ2JhLCBmcmFtZXNbaV0uZGF0YSBhcyBVaW50OEFycmF5KSwgMCwgYGZyYW1lICR7aX1gKTtcbiAgfVxufSk7XG4iLCAiLy8gUE5HIGNvbnRhaW5lciBwcmltaXRpdmVzOiBDUkMtMzIsIGNodW5rIGZyYW1pbmcsIGFuZCBzY2FubGluZSBmaWx0ZXJpbmcuXG5cbi8qKiBUaGUgOC1ieXRlIFBORyBmaWxlIHNpZ25hdHVyZSB0aGF0IG9wZW5zIGV2ZXJ5IHN0cmVhbS4gKi9cbmV4cG9ydCBjb25zdCBQTkdfU0lHTkFUVVJFID0gbmV3IFVpbnQ4QXJyYXkoWzB4ODksIDB4NTAsIDB4NGUsIDB4NDcsIDB4MGQsIDB4MGEsIDB4MWEsIDB4MGFdKTtcblxuLy8gLS0gQ1JDLTMyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IENSQ19UQUJMRSA9ICgoKSA9PiB7XG4gIGNvbnN0IHQgPSBuZXcgVWludDMyQXJyYXkoMjU2KTtcbiAgZm9yIChsZXQgbiA9IDA7IG4gPCAyNTY7IG4rKykge1xuICAgIGxldCBjID0gbjtcbiAgICBmb3IgKGxldCBrID0gMDsgayA8IDg7IGsrKykgYyA9IGMgJiAxID8gMHhlZGI4ODMyMCBeIChjID4+PiAxKSA6IGMgPj4+IDE7XG4gICAgdFtuXSA9IGMgPj4+IDA7XG4gIH1cbiAgcmV0dXJuIHQ7XG59KSgpO1xuXG4vKiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyYzMyKGJ5dGVzOiBVaW50OEFycmF5LCBzZWVkID0gMCk6IG51bWJlciB7XG4gIGxldCBjID0gfnNlZWQgPj4+IDA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIGMgPSBDUkNfVEFCTEVbKGMgXiBieXRlc1tpXSkgJiAweGZmXSBeIChjID4+PiA4KTtcbiAgcmV0dXJuIH5jID4+PiAwO1xufVxuXG4vLyAtLSBDaHVua3MgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEZyYW1lIG9uZSBQTkcgY2h1bms6IGxlbmd0aCwgNC1ieXRlIEFTQ0lJIHR5cGUsIGRhdGEsIENSQy0zMiBvZlxuICogdHlwZStkYXRhLiBgdHlwZWAgbXVzdCBiZSBhIGZldyBjaGFyYWN0ZXJzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdyaXRlQ2h1bmsodHlwZTogc3RyaW5nLCBkYXRhOiBVaW50OEFycmF5KTogVWludDhBcnJheSB7XG4gIGlmICh0eXBlLmxlbmd0aCAhPT0gNCkgdGhyb3cgbmV3IEVycm9yKGBQTkcgY2h1bmsgdHlwZSBtdXN0IGJlIDQgY2hhcmFjdGVycywgZ290ICR7SlNPTi5zdHJpbmdpZnkodHlwZSl9YCk7XG4gIGNvbnN0IG91dCA9IG5ldyBVaW50OEFycmF5KDEyICsgZGF0YS5sZW5ndGgpO1xuICBjb25zdCB2aWV3ID0gbmV3IERhdGFWaWV3KG91dC5idWZmZXIpO1xuICB2aWV3LnNldFVpbnQzMigwLCBkYXRhLmxlbmd0aCk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgNDsgaSsrKSBvdXRbNCArIGldID0gdHlwZS5jaGFyQ29kZUF0KGkpO1xuICBvdXQuc2V0KGRhdGEsIDgpO1xuICB2aWV3LnNldFVpbnQzMig4ICsgZGF0YS5sZW5ndGgsIGNyYzMyKG91dC5zdWJhcnJheSg0LCA4ICsgZGF0YS5sZW5ndGgpKSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBDb25jYXRlbmF0ZSBieXRlIHJ1bnMgaW50byBvbmUgYnVmZmVyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbmNhdEJ5dGVzKHBhcnRzOiByZWFkb25seSBVaW50OEFycmF5W10pOiBVaW50OEFycmF5PEFycmF5QnVmZmVyPiB7XG4gIGxldCB0b3RhbCA9IDA7XG4gIGZvciAoY29uc3QgcCBvZiBwYXJ0cykgdG90YWwgKz0gcC5sZW5ndGg7XG4gIGNvbnN0IG91dCA9IG5ldyBVaW50OEFycmF5KHRvdGFsKTtcbiAgbGV0IGF0ID0gMDtcbiAgZm9yIChjb25zdCBwIG9mIHBhcnRzKSB7XG4gICAgb3V0LnNldChwLCBhdCk7XG4gICAgYXQgKz0gcC5sZW5ndGg7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLy8gLS0gU2NhbmxpbmUgZmlsdGVyaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBIb3cgYGZpbHRlclNjYW5saW5lc2AgcGlja3MgYSBmaWx0ZXIgYnl0ZSBwZXIgcm93LiAqL1xuZXhwb3J0IHR5cGUgRmlsdGVyU3RyYXRlZ3kgPSAnbm9uZScgfCAnc3ViJyB8ICd1cCcgfCAnYXZlcmFnZScgfCAncGFldGgnIHwgJ2FkYXB0aXZlJztcblxuLyoqIFRoZSBmaWx0ZXIgc3RyYXRlZ2llcywgaW4gdGhlIG9yZGVyIGEgVUkgc2hvdWxkIG9mZmVyIHRoZW0uICovXG5leHBvcnQgY29uc3QgRklMVEVSX1NUUkFURUdJRVM6IHJlYWRvbmx5IEZpbHRlclN0cmF0ZWd5W10gPSBbXG4gICdhZGFwdGl2ZScsXG4gICdub25lJyxcbiAgJ3N1YicsXG4gICd1cCcsXG4gICdhdmVyYWdlJyxcbiAgJ3BhZXRoJyxcbl07XG5cbi8qKiBQTkcncyBQYWV0aCBwcmVkaWN0b3I6IHdoaWNoZXZlciBvZiBhIChsZWZ0KSwgYiAoYWJvdmUpLCBjICh1cHBlci1sZWZ0KSBpcyBjbG9zZXN0IHRvIGErYi1jLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhZXRoKGE6IG51bWJlciwgYjogbnVtYmVyLCBjOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCBwID0gYSArIGIgLSBjO1xuICBjb25zdCBwYSA9IE1hdGguYWJzKHAgLSBhKTtcbiAgY29uc3QgcGIgPSBNYXRoLmFicyhwIC0gYik7XG4gIGNvbnN0IHBjID0gTWF0aC5hYnMocCAtIGMpO1xuICBpZiAocGEgPD0gcGIgJiYgcGEgPD0gcGMpIHJldHVybiBhO1xuICByZXR1cm4gcGIgPD0gcGMgPyBiIDogYztcbn1cblxuY29uc3QgRklYRURfRklMVEVSOiBSZWNvcmQ8RXhjbHVkZTxGaWx0ZXJTdHJhdGVneSwgJ2FkYXB0aXZlJz4sIG51bWJlcj4gPSB7XG4gIG5vbmU6IDAsXG4gIHN1YjogMSxcbiAgdXA6IDIsXG4gIGF2ZXJhZ2U6IDMsXG4gIHBhZXRoOiA0LFxufTtcblxuLy8gQXBwbHkgZmlsdGVyIGB0eXBlYCB0byBvbmUgcm93LCB3cml0aW5nIGBzdHJpZGVgIHJlc2lkdWFsIGJ5dGVzIGludG8gYGRzdGAuXG4vLyBgcm93YCAvIGBwcmV2YCBhcmUgdGhlIHJhdyAodW5maWx0ZXJlZCkgY3VycmVudCBhbmQgcHJldmlvdXMgc2NhbmxpbmVzO1xuLy8gYHByZXZgIGlzIGFsbC16ZXJvIGZvciB0aGUgZmlyc3Qgcm93LCBleGFjdGx5IGFzIHRoZSBzcGVjIHJlcXVpcmVzLlxuZnVuY3Rpb24gZmlsdGVyUm93KFxuICBkc3Q6IFVpbnQ4QXJyYXksXG4gIGRzdEF0OiBudW1iZXIsXG4gIHJvdzogVWludDhBcnJheSxcbiAgcHJldjogVWludDhBcnJheSB8IG51bGwsXG4gIHN0cmlkZTogbnVtYmVyLFxuICBicHA6IG51bWJlcixcbiAgdHlwZTogbnVtYmVyLFxuKTogdm9pZCB7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc3RyaWRlOyBpKyspIHtcbiAgICBjb25zdCB4ID0gcm93W2ldO1xuICAgIGNvbnN0IGEgPSBpID49IGJwcCA/IHJvd1tpIC0gYnBwXSA6IDA7XG4gICAgY29uc3QgYiA9IHByZXYgPyBwcmV2W2ldIDogMDtcbiAgICBjb25zdCBjID0gcHJldiAmJiBpID49IGJwcCA/IHByZXZbaSAtIGJwcF0gOiAwO1xuICAgIGxldCB2OiBudW1iZXI7XG4gICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICBjYXNlIDE6IHYgPSB4IC0gYTsgYnJlYWs7XG4gICAgICBjYXNlIDI6IHYgPSB4IC0gYjsgYnJlYWs7XG4gICAgICBjYXNlIDM6IHYgPSB4IC0gKChhICsgYikgPj4gMSk7IGJyZWFrO1xuICAgICAgY2FzZSA0OiB2ID0geCAtIHBhZXRoKGEsIGIsIGMpOyBicmVhaztcbiAgICAgIGRlZmF1bHQ6IHYgPSB4OyBicmVhaztcbiAgICB9XG4gICAgZHN0W2RzdEF0ICsgaV0gPSB2ICYgMHhmZjtcbiAgfVxufVxuXG4vLyBUaGUgYWRhcHRpdmUgaGV1cmlzdGljJ3MgY29zdDogc3VtIG9mIHxyZXNpZHVhbHwgcmVhZCBhcyBhIHNpZ25lZCBieXRlLlxuZnVuY3Rpb24gcm93Q29zdChieXRlczogVWludDhBcnJheSwgYXQ6IG51bWJlciwgc3RyaWRlOiBudW1iZXIpOiBudW1iZXIge1xuICBsZXQgc3VtID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzdHJpZGU7IGkrKykge1xuICAgIGNvbnN0IHYgPSBieXRlc1thdCArIGldO1xuICAgIHN1bSArPSB2IDwgMTI4ID8gdiA6IDI1NiAtIHY7XG4gIH1cbiAgcmV0dXJuIHN1bTtcbn1cblxuLyoqIEZpbHRlciBgaGVpZ2h0YCByYXcgc2NhbmxpbmVzIG9mIGBzdHJpZGVgIGJ5dGVzIGVhY2ggaW50byB0aGUgUE5HJ3NcbiAqIHByZS1jb21wcmVzc2lvbiBmb3JtOiBvbmUgZmlsdGVyIGJ5dGUgZm9sbG93ZWQgYnkgYHN0cmlkZWAgcmVzaWR1YWwgYnl0ZXNcbiAqIHBlciByb3cuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsdGVyU2NhbmxpbmVzKFxuICByYXc6IFVpbnQ4QXJyYXksXG4gIHN0cmlkZTogbnVtYmVyLFxuICBoZWlnaHQ6IG51bWJlcixcbiAgYnBwOiBudW1iZXIsXG4gIHN0cmF0ZWd5OiBGaWx0ZXJTdHJhdGVneSA9ICdhZGFwdGl2ZScsXG4pOiBVaW50OEFycmF5IHtcbiAgY29uc3Qgb3V0ID0gbmV3IFVpbnQ4QXJyYXkoKHN0cmlkZSArIDEpICogaGVpZ2h0KTtcbiAgaWYgKHN0cmF0ZWd5ICE9PSAnYWRhcHRpdmUnKSB7XG4gICAgY29uc3QgdHlwZSA9IEZJWEVEX0ZJTFRFUltzdHJhdGVneV07XG4gICAgZm9yIChsZXQgeSA9IDA7IHkgPCBoZWlnaHQ7IHkrKykge1xuICAgICAgY29uc3Qgcm93ID0gcmF3LnN1YmFycmF5KHkgKiBzdHJpZGUsICh5ICsgMSkgKiBzdHJpZGUpO1xuICAgICAgY29uc3QgcHJldiA9IHkgPiAwID8gcmF3LnN1YmFycmF5KCh5IC0gMSkgKiBzdHJpZGUsIHkgKiBzdHJpZGUpIDogbnVsbDtcbiAgICAgIG91dFt5ICogKHN0cmlkZSArIDEpXSA9IHR5cGU7XG4gICAgICBmaWx0ZXJSb3cob3V0LCB5ICogKHN0cmlkZSArIDEpICsgMSwgcm93LCBwcmV2LCBzdHJpZGUsIGJwcCwgdHlwZSk7XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG4gIH1cblxuICBjb25zdCB0cmlhbCA9IG5ldyBVaW50OEFycmF5KHN0cmlkZSk7XG4gIGZvciAobGV0IHkgPSAwOyB5IDwgaGVpZ2h0OyB5KyspIHtcbiAgICBjb25zdCByb3cgPSByYXcuc3ViYXJyYXkoeSAqIHN0cmlkZSwgKHkgKyAxKSAqIHN0cmlkZSk7XG4gICAgY29uc3QgcHJldiA9IHkgPiAwID8gcmF3LnN1YmFycmF5KCh5IC0gMSkgKiBzdHJpZGUsIHkgKiBzdHJpZGUpIDogbnVsbDtcbiAgICBsZXQgYmVzdFR5cGUgPSAwO1xuICAgIGxldCBiZXN0Q29zdCA9IEluZmluaXR5O1xuICAgIGZvciAobGV0IHR5cGUgPSAwOyB0eXBlIDw9IDQ7IHR5cGUrKykge1xuICAgICAgZmlsdGVyUm93KHRyaWFsLCAwLCByb3csIHByZXYsIHN0cmlkZSwgYnBwLCB0eXBlKTtcbiAgICAgIGNvbnN0IGNvc3QgPSByb3dDb3N0KHRyaWFsLCAwLCBzdHJpZGUpO1xuICAgICAgaWYgKGNvc3QgPCBiZXN0Q29zdCkge1xuICAgICAgICBiZXN0Q29zdCA9IGNvc3Q7XG4gICAgICAgIGJlc3RUeXBlID0gdHlwZTtcbiAgICAgIH1cbiAgICB9XG4gICAgb3V0W3kgKiAoc3RyaWRlICsgMSldID0gYmVzdFR5cGU7XG4gICAgZmlsdGVyUm93KG91dCwgeSAqIChzdHJpZGUgKyAxKSArIDEsIHJvdywgcHJldiwgc3RyaWRlLCBicHAsIGJlc3RUeXBlKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKiogVGhlIGludmVyc2Ugb2YgYGZpbHRlclNjYW5saW5lc2A6IHJlY29uc3RydWN0IGBoZWlnaHRgIHJhdyBzY2FubGluZXMgb2ZcbiAqIGBzdHJpZGVgIGJ5dGVzIGZyb20gUE5HJ3MgZmlsdGVyLWJ5dGUtcHJlZml4ZWQgcm93cy4gRXhwb3J0ZWQgYmVjYXVzZSBhXG4gKiBjYWxsZXIgdGhhdCB2ZXJpZmllcyBpdHMgb3duIG91dHB1dCAob3IgcmVhZHMgYSBQTkcgaXQgZGlkIG5vdCB3cml0ZSlcbiAqIG5lZWRzIHRoZSBleGFjdCBzYW1lIHByZWRpY3RvciBhcml0aG1ldGljOyBnZXR0aW5nIGl0IGZyb20gaGVyZSByYXRoZXJcbiAqIHRoYW4gcmVpbXBsZW1lbnRpbmcgaXQgaXMgd2hhdCBrZWVwcyBib3RoIGhhbHZlcyBpbiBzdGVwLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVuZmlsdGVyU2NhbmxpbmVzKFxuICBmaWx0ZXJlZDogVWludDhBcnJheSxcbiAgc3RyaWRlOiBudW1iZXIsXG4gIGhlaWdodDogbnVtYmVyLFxuICBicHA6IG51bWJlcixcbik6IFVpbnQ4QXJyYXkge1xuICBjb25zdCByYXcgPSBuZXcgVWludDhBcnJheShzdHJpZGUgKiBoZWlnaHQpO1xuICBmb3IgKGxldCB5ID0gMDsgeSA8IGhlaWdodDsgeSsrKSB7XG4gICAgY29uc3QgdHlwZSA9IGZpbHRlcmVkW3kgKiAoc3RyaWRlICsgMSldO1xuICAgIGNvbnN0IHNyYyA9IHkgKiAoc3RyaWRlICsgMSkgKyAxO1xuICAgIGNvbnN0IGRzdCA9IHkgKiBzdHJpZGU7XG4gICAgY29uc3QgdXAgPSBkc3QgLSBzdHJpZGU7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzdHJpZGU7IGkrKykge1xuICAgICAgY29uc3QgeCA9IGZpbHRlcmVkW3NyYyArIGldO1xuICAgICAgY29uc3QgYSA9IGkgPj0gYnBwID8gcmF3W2RzdCArIGkgLSBicHBdIDogMDtcbiAgICAgIGNvbnN0IGIgPSB5ID4gMCA/IHJhd1t1cCArIGldIDogMDtcbiAgICAgIGNvbnN0IGMgPSB5ID4gMCAmJiBpID49IGJwcCA/IHJhd1t1cCArIGkgLSBicHBdIDogMDtcbiAgICAgIGxldCB2OiBudW1iZXI7XG4gICAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgICAgY2FzZSAwOiB2ID0geDsgYnJlYWs7XG4gICAgICAgIGNhc2UgMTogdiA9IHggKyBhOyBicmVhaztcbiAgICAgICAgY2FzZSAyOiB2ID0geCArIGI7IGJyZWFrO1xuICAgICAgICBjYXNlIDM6IHYgPSB4ICsgKChhICsgYikgPj4gMSk7IGJyZWFrO1xuICAgICAgICBjYXNlIDQ6IHYgPSB4ICsgcGFldGgoYSwgYiwgYyk7IGJyZWFrO1xuICAgICAgICBkZWZhdWx0OiB0aHJvdyBuZXcgRXJyb3IoYHVua25vd24gUE5HIGZpbHRlciB0eXBlICR7dHlwZX0gb24gcm93ICR7eX1gKTtcbiAgICAgIH1cbiAgICAgIHJhd1tkc3QgKyBpXSA9IHYgJiAweGZmO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmF3O1xufVxuIiwgIi8vIEludGVyLWZyYW1lIGRpZmZlcmVuY2luZyBmb3IgdGhlIEFQTkcgZW5jb2Rlcjogd2hpY2ggcGl4ZWxzIG1vdmVkLCB0aGVcbi8vIHNtYWxsZXN0IHJlY3RhbmdsZSB0aGF0IGNvdmVycyB0aGVtLCBhbmQgdGhlIHdheXMgdG8gZW5jb2RlIGl0LlxuXG4vKiogQSByZWN0YW5nbGUgaW4gcGl4ZWxzLiBgd2AvYGhgIGFyZSBhbHdheXMgPj0gMSBvbiBhIHJldHVybmVkIGRpZmYuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlY3Qge1xuICB4OiBudW1iZXI7XG4gIHk6IG51bWJlcjtcbiAgdzogbnVtYmVyO1xuICBoOiBudW1iZXI7XG59XG5cbi8qKiBXaGF0IGBkaWZmRnJhbWVzYCBmb3VuZCBiZXR3ZWVuIGEgY2FudmFzIGFuZCB0aGUgbmV4dCBmcmFtZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRnJhbWVEaWZmIHtcbiAgLyoqIFNtYWxsZXN0IHJlY3RhbmdsZSBjb3ZlcmluZyBldmVyeSBjaGFuZ2VkIHBpeGVsLiAqL1xuICByZWN0OiBSZWN0O1xuICAvKiogSG93IG1hbnkgcGl4ZWxzIGluc2lkZSBgcmVjdGAgYXJlIGNvbnNpZGVyZWQgY2hhbmdlZC4gKi9cbiAgY2hhbmdlZDogbnVtYmVyO1xuICAvKiogVHJ1ZSB3aGVuIGV2ZXJ5IGNoYW5nZWQgcGl4ZWwgaXMgZnVsbHkgb3BhcXVlLCB3aGljaCBpcyB3aGF0IG1ha2VzIHRoZSBgb3ZlcmAgZW5jb2RpbmcgbGVnYWwuICovXG4gIG9wYXF1ZTogYm9vbGVhbjtcbn1cblxuLyoqIEEgcGl4ZWwgY291bnRzIGFzIGNoYW5nZWQgd2hlbiBhbnkgY29sb3VyIGNoYW5uZWwgbW92ZXMgYnkgbW9yZSB0aGFuXG4gKiBgdGhyZXNob2xkYCwgb3IgYWxwaGEgYnkgbW9yZSB0aGFuIGBhbHBoYVRocmVzaG9sZGAuICovXG5leHBvcnQgaW50ZXJmYWNlIERpZmZPcHRpb25zIHtcbiAgdGhyZXNob2xkPzogbnVtYmVyO1xuICBhbHBoYVRocmVzaG9sZD86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBEaWZmIGBuZXh0YCBhZ2FpbnN0IGBjYW52YXNgIChib3RoIFJHQkE4LCBgd2lkdGggKiBoZWlnaHQgKiA0YCBieXRlcykuXG4gKlxuICogUmV0dXJucyBudWxsIHdoZW4gbm90aGluZyBjaGFuZ2VkIHBhc3QgdGhlIHRocmVzaG9sZCBcdTIwMTQgdGhlIGNhbGxlciBzaG91bGRcbiAqIHRoZW4gZHJvcCB0aGUgZnJhbWUgYW5kIGV4dGVuZCB0aGUgcHJldmlvdXMgZnJhbWUncyBkZWxheSBpbnN0ZWFkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGlmZkZyYW1lcyhcbiAgY2FudmFzOiBVaW50OEFycmF5LFxuICBuZXh0OiBVaW50OEFycmF5LFxuICB3aWR0aDogbnVtYmVyLFxuICBoZWlnaHQ6IG51bWJlcixcbiAgb3B0aW9uczogRGlmZk9wdGlvbnMgPSB7fSxcbik6IEZyYW1lRGlmZiB8IG51bGwge1xuICBjb25zdCB0ID0gb3B0aW9ucy50aHJlc2hvbGQgPz8gMjtcbiAgY29uc3QgYXQgPSBvcHRpb25zLmFscGhhVGhyZXNob2xkID8/IHQ7XG5cbiAgbGV0IG1pblggPSB3aWR0aDtcbiAgbGV0IG1pblkgPSBoZWlnaHQ7XG4gIGxldCBtYXhYID0gLTE7XG4gIGxldCBtYXhZID0gLTE7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgbGV0IG9wYXF1ZSA9IHRydWU7XG5cbiAgZm9yIChsZXQgeSA9IDA7IHkgPCBoZWlnaHQ7IHkrKykge1xuICAgIGxldCByb3dNaW4gPSAtMTtcbiAgICBsZXQgcm93TWF4ID0gLTE7XG4gICAgbGV0IGkgPSB5ICogd2lkdGggKiA0O1xuICAgIGZvciAobGV0IHggPSAwOyB4IDwgd2lkdGg7IHgrKywgaSArPSA0KSB7XG4gICAgICBjb25zdCBkciA9IGNhbnZhc1tpXSAtIG5leHRbaV07XG4gICAgICBjb25zdCBkZyA9IGNhbnZhc1tpICsgMV0gLSBuZXh0W2kgKyAxXTtcbiAgICAgIGNvbnN0IGRiID0gY2FudmFzW2kgKyAyXSAtIG5leHRbaSArIDJdO1xuICAgICAgY29uc3QgZGEgPSBjYW52YXNbaSArIDNdIC0gbmV4dFtpICsgM107XG4gICAgICBpZiAoXG4gICAgICAgIChkciA+IHQgfHwgZHIgPCAtdCkgfHxcbiAgICAgICAgKGRnID4gdCB8fCBkZyA8IC10KSB8fFxuICAgICAgICAoZGIgPiB0IHx8IGRiIDwgLXQpIHx8XG4gICAgICAgIChkYSA+IGF0IHx8IGRhIDwgLWF0KVxuICAgICAgKSB7XG4gICAgICAgIGlmIChyb3dNaW4gPCAwKSByb3dNaW4gPSB4O1xuICAgICAgICByb3dNYXggPSB4O1xuICAgICAgICBjaGFuZ2VkKys7XG4gICAgICAgIGlmIChuZXh0W2kgKyAzXSAhPT0gMjU1KSBvcGFxdWUgPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHJvd01pbiA+PSAwKSB7XG4gICAgICBpZiAocm93TWluIDwgbWluWCkgbWluWCA9IHJvd01pbjtcbiAgICAgIGlmIChyb3dNYXggPiBtYXhYKSBtYXhYID0gcm93TWF4O1xuICAgICAgaWYgKG1pblkgPiB5KSBtaW5ZID0geTtcbiAgICAgIG1heFkgPSB5O1xuICAgIH1cbiAgfVxuXG4gIGlmIChtYXhYIDwgMCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7XG4gICAgcmVjdDogeyB4OiBtaW5YLCB5OiBtaW5ZLCB3OiBtYXhYIC0gbWluWCArIDEsIGg6IG1heFkgLSBtaW5ZICsgMSB9LFxuICAgIGNoYW5nZWQsXG4gICAgb3BhcXVlLFxuICB9O1xufVxuXG4vKiogQ29weSBgcmVjdGAgb3V0IG9mIGFuIFJHQkE4IGltYWdlIGFzIGEgdGlnaHRseSBwYWNrZWQgc3ViLWltYWdlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyb3BSZWN0KHNyYzogVWludDhBcnJheSwgd2lkdGg6IG51bWJlciwgcmVjdDogUmVjdCk6IFVpbnQ4QXJyYXkge1xuICBjb25zdCBvdXQgPSBuZXcgVWludDhBcnJheShyZWN0LncgKiByZWN0LmggKiA0KTtcbiAgY29uc3Qgcm93Qnl0ZXMgPSByZWN0LncgKiA0O1xuICBmb3IgKGxldCB5ID0gMDsgeSA8IHJlY3QuaDsgeSsrKSB7XG4gICAgY29uc3QgZnJvbSA9ICgocmVjdC55ICsgeSkgKiB3aWR0aCArIHJlY3QueCkgKiA0O1xuICAgIG91dC5zZXQoc3JjLnN1YmFycmF5KGZyb20sIGZyb20gKyByb3dCeXRlcyksIHkgKiByb3dCeXRlcyk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDcm9wIGByZWN0YCBvdXQgb2YgYG5leHRgLCBidXQgd3JpdGUgYSBmdWxseSB0cmFuc3BhcmVudCBwaXhlbCB3aGVyZXZlciB0aGVcbiAqIHBpeGVsIGRpZCBub3QgY2hhbmdlIGZyb20gYGNhbnZhc2AuXG4gKlxuICogVGhpcyBpcyB0aGUgcGF5bG9hZCBmb3IgYSBibGVuZF9vcD1PVkVSIGZyYW1lOiB0aGUgZGVjb2RlciBsZWF2ZXMgdGhvc2VcbiAqIHBpeGVscyBhbG9uZSwgYW5kIHRoZSBlbmNvZGVyIGdldHMgbG9uZyBydW5zIG9mIG9uZSByZXBlYXRlZCB2YWx1ZSB0aHJvdWdoXG4gKiB0aGUgbWlkZGxlIG9mIHRoZSByZWN0YW5nbGUgaW5zdGVhZCBvZiBzdGFsZSBwaXhlbCBkYXRhLiBPbmx5IHZhbGlkIHdoZW5cbiAqIGV2ZXJ5IGNoYW5nZWQgcGl4ZWwgaXMgb3BhcXVlIChzZWUgYEZyYW1lRGlmZi5vcGFxdWVgKS5cbiAqXG4gKiBgZmlsbGAgaXMgdGhlIHRyYW5zcGFyZW50IFJHQkEgdG8gd3JpdGUsIGRlZmF1bHRpbmcgdG8gdHJhbnNwYXJlbnQgYmxhY2suIEFuXG4gKiBpbmRleGVkIGVuY29kZXIgbXVzdCBwYXNzIHRoZSBleGFjdCBjb2xvdXIgb2YgaXRzIHRyYW5zcGFyZW50IHBhbGV0dGUgZW50cnk6XG4gKiBhbnkgYWxwaGEtMCBjb2xvdXIgaXMgZXF1YWxseSBpbnZpc2libGUsIGJ1dCBvbmx5IG9uZSBvZiB0aGVtIGlzIGluIHRoZVxuICogcGFsZXR0ZSwgYW5kIGEgY29sb3VyIHRoYXQgaXMgbm90IGluIHRoZSBwYWxldHRlIGNhbm5vdCBiZSBzdG9yZWQgYXQgYWxsLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JvcFJlY3RNYXNrZWQoXG4gIGNhbnZhczogVWludDhBcnJheSxcbiAgbmV4dDogVWludDhBcnJheSxcbiAgd2lkdGg6IG51bWJlcixcbiAgcmVjdDogUmVjdCxcbiAgb3B0aW9uczogRGlmZk9wdGlvbnMgPSB7fSxcbiAgZmlsbDogcmVhZG9ubHkgbnVtYmVyW10gPSBbMCwgMCwgMCwgMF0sXG4pOiBVaW50OEFycmF5IHtcbiAgY29uc3QgdCA9IG9wdGlvbnMudGhyZXNob2xkID8/IDI7XG4gIGNvbnN0IGF0ID0gb3B0aW9ucy5hbHBoYVRocmVzaG9sZCA/PyB0O1xuICBjb25zdCBvdXQgPSBuZXcgVWludDhBcnJheShyZWN0LncgKiByZWN0LmggKiA0KTtcbiAgaWYgKGZpbGxbMF0gIT09IDAgfHwgZmlsbFsxXSAhPT0gMCB8fCBmaWxsWzJdICE9PSAwKSB7XG4gICAgZm9yIChsZXQgbyA9IDA7IG8gPCBvdXQubGVuZ3RoOyBvICs9IDQpIHtcbiAgICAgIG91dFtvXSA9IGZpbGxbMF07XG4gICAgICBvdXRbbyArIDFdID0gZmlsbFsxXTtcbiAgICAgIG91dFtvICsgMl0gPSBmaWxsWzJdO1xuICAgIH1cbiAgfVxuICBmb3IgKGxldCB5ID0gMDsgeSA8IHJlY3QuaDsgeSsrKSB7XG4gICAgbGV0IGkgPSAoKHJlY3QueSArIHkpICogd2lkdGggKyByZWN0LngpICogNDtcbiAgICBsZXQgbyA9IHkgKiByZWN0LncgKiA0O1xuICAgIGZvciAobGV0IHggPSAwOyB4IDwgcmVjdC53OyB4KyssIGkgKz0gNCwgbyArPSA0KSB7XG4gICAgICBjb25zdCBkciA9IGNhbnZhc1tpXSAtIG5leHRbaV07XG4gICAgICBjb25zdCBkZyA9IGNhbnZhc1tpICsgMV0gLSBuZXh0W2kgKyAxXTtcbiAgICAgIGNvbnN0IGRiID0gY2FudmFzW2kgKyAyXSAtIG5leHRbaSArIDJdO1xuICAgICAgY29uc3QgZGEgPSBjYW52YXNbaSArIDNdIC0gbmV4dFtpICsgM107XG4gICAgICBpZiAoXG4gICAgICAgIChkciA+IHQgfHwgZHIgPCAtdCkgfHxcbiAgICAgICAgKGRnID4gdCB8fCBkZyA8IC10KSB8fFxuICAgICAgICAoZGIgPiB0IHx8IGRiIDwgLXQpIHx8XG4gICAgICAgIChkYSA+IGF0IHx8IGRhIDwgLWF0KVxuICAgICAgKSB7XG4gICAgICAgIG91dFtvXSA9IG5leHRbaV07XG4gICAgICAgIG91dFtvICsgMV0gPSBuZXh0W2kgKyAxXTtcbiAgICAgICAgb3V0W28gKyAyXSA9IG5leHRbaSArIDJdO1xuICAgICAgICBvdXRbbyArIDNdID0gbmV4dFtpICsgM107XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogQWR2YW5jZSB0aGUgY2FudmFzIHRoZSB3YXkgYSBkZWNvZGVyIHdvdWxkIHdoZW4gaXQgY29tcG9zaXRlcyBgcGF5bG9hZGBcbiAqIChhIGByZWN0YC1zaXplZCBSR0JBOCBzdWItaW1hZ2UpIHdpdGggdGhlIGdpdmVuIGJsZW5kIG9wLlxuICpcbiAqIGBvdmVyYCBsZWF2ZXMgdGhlIGNhbnZhcyBhbG9uZSB3aGVyZSB0aGUgcGF5bG9hZCBpcyBmdWxseSB0cmFuc3BhcmVudDtcbiAqIGBzb3VyY2VgIHJlcGxhY2VzIHRoZSByZWN0YW5nbGUgb3V0cmlnaHQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wb3NpdGUoXG4gIGNhbnZhczogVWludDhBcnJheSxcbiAgd2lkdGg6IG51bWJlcixcbiAgcmVjdDogUmVjdCxcbiAgcGF5bG9hZDogVWludDhBcnJheSxcbiAgYmxlbmQ6ICdvdmVyJyB8ICdzb3VyY2UnLFxuKTogdm9pZCB7XG4gIGNvbnN0IHJvd0J5dGVzID0gcmVjdC53ICogNDtcbiAgaWYgKGJsZW5kID09PSAnc291cmNlJykge1xuICAgIGZvciAobGV0IHkgPSAwOyB5IDwgcmVjdC5oOyB5KyspIHtcbiAgICAgIGNvbnN0IHRvID0gKChyZWN0LnkgKyB5KSAqIHdpZHRoICsgcmVjdC54KSAqIDQ7XG4gICAgICBjYW52YXMuc2V0KHBheWxvYWQuc3ViYXJyYXkoeSAqIHJvd0J5dGVzLCAoeSArIDEpICogcm93Qnl0ZXMpLCB0byk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBmb3IgKGxldCB5ID0gMDsgeSA8IHJlY3QuaDsgeSsrKSB7XG4gICAgbGV0IG8gPSB5ICogcm93Qnl0ZXM7XG4gICAgbGV0IGkgPSAoKHJlY3QueSArIHkpICogd2lkdGggKyByZWN0LngpICogNDtcbiAgICBmb3IgKGxldCB4ID0gMDsgeCA8IHJlY3QudzsgeCsrLCBpICs9IDQsIG8gKz0gNCkge1xuICAgICAgY29uc3Qgc2EgPSBwYXlsb2FkW28gKyAzXTtcbiAgICAgIGlmIChzYSA9PT0gMCkgY29udGludWU7XG4gICAgICBpZiAoc2EgPT09IDI1NSkge1xuICAgICAgICBjYW52YXNbaV0gPSBwYXlsb2FkW29dO1xuICAgICAgICBjYW52YXNbaSArIDFdID0gcGF5bG9hZFtvICsgMV07XG4gICAgICAgIGNhbnZhc1tpICsgMl0gPSBwYXlsb2FkW28gKyAyXTtcbiAgICAgICAgY2FudmFzW2kgKyAzXSA9IDI1NTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICAvLyBOb24tcHJlbXVsdGlwbGllZCBzb3VyY2Utb3ZlciwgYXMgdGhlIEFQTkcgc3BlYyBzcGVsbHMgaXQgb3V0LlxuICAgICAgY29uc3QgZGEgPSBjYW52YXNbaSArIDNdO1xuICAgICAgY29uc3Qgb2EgPSBzYSArIE1hdGgucm91bmQoKGRhICogKDI1NSAtIHNhKSkgLyAyNTUpO1xuICAgICAgaWYgKG9hID09PSAwKSB7XG4gICAgICAgIGNhbnZhc1tpXSA9IGNhbnZhc1tpICsgMV0gPSBjYW52YXNbaSArIDJdID0gY2FudmFzW2kgKyAzXSA9IDA7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCAzOyBjKyspIHtcbiAgICAgICAgY29uc3QgcyA9IHBheWxvYWRbbyArIGNdICogc2E7XG4gICAgICAgIGNvbnN0IGQgPSAoY2FudmFzW2kgKyBjXSAqIGRhICogKDI1NSAtIHNhKSkgLyAyNTU7XG4gICAgICAgIGNhbnZhc1tpICsgY10gPSBNYXRoLnJvdW5kKChzICsgZCkgLyBvYSk7XG4gICAgICB9XG4gICAgICBjYW52YXNbaSArIDNdID0gb2E7XG4gICAgfVxuICB9XG59XG4iLCAiLy8gUGFsZXR0ZSBkZXRlY3Rpb24gZm9yIHRoZSBBUE5HIGVuY29kZXIuIFB1cmUgXHUyMDE0IG5vIERPTSwgbm8gYnJvd3NlciBBUElzLlxuXG4vKiAqL1xuZXhwb3J0IGludGVyZmFjZSBQYWxldHRlIHtcbiAgLyoqIFBhbGV0dGUgZW50cmllcywgYSBmZXcgYnl0ZXMgKFJHQkEpIGVhY2gsIGluIGluZGV4IG9yZGVyLiAqL1xuICByZ2JhOiBVaW50OEFycmF5O1xuICAvKiAqL1xuICBzaXplOiBudW1iZXI7XG4gIC8qICovXG4gIHRybnNDb3VudDogbnVtYmVyO1xuICAvKiAqL1xuICB0cmFuc3BhcmVudEluZGV4OiBudW1iZXI7XG4gIC8qKiBQYWNrZWQtUkdCQSBrZXkgLT4gcGFsZXR0ZSBpbmRleC4gKi9cbiAgbG9va3VwOiBNYXA8bnVtYmVyLCBudW1iZXI+O1xufVxuXG4vKiogUGFjayBhbiBSR0JBIHF1YWRydXBsZXQgaW50byBvbmUgaW50ZWdlciBrZXkgKGVuZGlhbi1pbmRlcGVuZGVudCkuICovXG5leHBvcnQgZnVuY3Rpb24gcGFja1JnYmEocjogbnVtYmVyLCBnOiBudW1iZXIsIGI6IG51bWJlciwgYTogbnVtYmVyKTogbnVtYmVyIHtcbiAgcmV0dXJuICgociA8PCAyNCkgfCAoZyA8PCAxNikgfCAoYiA8PCA4KSB8IGEpID4+PiAwO1xufVxuXG4vKiogQnVpbGQgYW4gZXhhY3QgcGFsZXR0ZSBjb3ZlcmluZyBldmVyeSBwaXhlbCBvZiBldmVyeSBpbWFnZSwgb3IgcmV0dXJuIG51bGxcbiAqIHdoZW4gdGhleSB1c2UgbW9yZSB0aGFuIGBsaW1pdGAgZGlzdGluY3QgY29sb3Vycy4gYHJlc2VydmVUcmFuc3BhcmVudGAgYWRkcyBhXG4gKiBmdWxseSB0cmFuc3BhcmVudCBlbnRyeSB3aGVuIHRoZSBpbWFnZXMgZG8gbm90IGFscmVhZHkgY29udGFpbiBvbmUgXHUyMDE0IHRoZVxuICogZW5jb2RlciBuZWVkcyBpdCB0byB3cml0ZSBcImxlYXZlIHRoaXMgcGl4ZWwgYWxvbmVcIiBpbnRvIGEgYmxlbmRfb3A9T1ZFUiBmcmFtZS5cbiAqIEl0IGNvc3RzIG9uZSBwYWxldHRlIHNsb3QsIHNvIHRoZSBlZmZlY3RpdmUgY29sb3VyIGJ1ZGdldCBpcyBgbGltaXQgLSAxYCBmb3JcbiAqIGZ1bGx5IG9wYXF1ZSBpbnB1dC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFBhbGV0dGUoXG4gIGltYWdlczogcmVhZG9ubHkgVWludDhBcnJheVtdLFxuICBsaW1pdCA9IDI1NixcbiAgcmVzZXJ2ZVRyYW5zcGFyZW50ID0gdHJ1ZSxcbik6IFBhbGV0dGUgfCBudWxsIHtcbiAgLy8gQ29sb3VycyBhcmUgaW50ZXJuZWQgdG8gYSBzbG90IHNvIHRoZSBwZXItcGl4ZWwgd29yayBpcyBhbiBpbnRlZ2VyIGNvbXBhcmUgYWdhaW5zdCB0aGUgcGl4ZWwuXG4gIGNvbnN0IHNsb3RPZiA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KCk7XG4gIGNvbnN0IGtleXM6IG51bWJlcltdID0gW107XG4gIGNvbnN0IGNvdW50czogbnVtYmVyW10gPSBbXTtcbiAgbGV0IHNhd1RyYW5zcGFyZW50ID0gZmFsc2U7XG4gIGxldCBydW5LZXkgPSAtMTtcbiAgbGV0IHJ1blNsb3QgPSAtMTtcbiAgbGV0IHJ1bkxlbmd0aCA9IDA7XG5cbiAgLy8gT25lIHNsb3QgaXMgaGVsZCBiYWNrIGZvciB0aGUgdHJhbnNwYXJlbnQgc2VudGluZWwgdW50aWwgd2Ugc2VlIHRoYXQgdGhlXG4gIC8vIGltYWdlcyBhbHJlYWR5IGNvbnRhaW4gb25lLlxuICBmb3IgKGNvbnN0IGltZyBvZiBpbWFnZXMpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGltZy5sZW5ndGg7IGkgKz0gNCkge1xuICAgICAgY29uc3Qga2V5ID0gcGFja1JnYmEoaW1nW2ldLCBpbWdbaSArIDFdLCBpbWdbaSArIDJdLCBpbWdbaSArIDNdKTtcbiAgICAgIGlmIChrZXkgPT09IHJ1bktleSkge1xuICAgICAgICBydW5MZW5ndGgrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAocnVuU2xvdCA+PSAwKSBjb3VudHNbcnVuU2xvdF0gKz0gcnVuTGVuZ3RoO1xuICAgICAgcnVuS2V5ID0ga2V5O1xuICAgICAgcnVuTGVuZ3RoID0gMTtcbiAgICAgIGxldCBzbG90ID0gc2xvdE9mLmdldChrZXkpO1xuICAgICAgaWYgKHNsb3QgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpZiAoaW1nW2kgKyAzXSA9PT0gMCkgc2F3VHJhbnNwYXJlbnQgPSB0cnVlO1xuICAgICAgICBjb25zdCBidWRnZXQgPSByZXNlcnZlVHJhbnNwYXJlbnQgJiYgIXNhd1RyYW5zcGFyZW50ID8gbGltaXQgLSAxIDogbGltaXQ7XG4gICAgICAgIGlmIChrZXlzLmxlbmd0aCA+PSBidWRnZXQpIHJldHVybiBudWxsO1xuICAgICAgICBzbG90ID0ga2V5cy5sZW5ndGg7XG4gICAgICAgIHNsb3RPZi5zZXQoa2V5LCBzbG90KTtcbiAgICAgICAga2V5cy5wdXNoKGtleSk7XG4gICAgICAgIGNvdW50cy5wdXNoKDApO1xuICAgICAgfVxuICAgICAgcnVuU2xvdCA9IHNsb3Q7XG4gICAgfVxuICB9XG4gIGlmIChydW5TbG90ID49IDApIGNvdW50c1tydW5TbG90XSArPSBydW5MZW5ndGg7XG4gIGlmIChrZXlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAga2V5cy5zb3J0KChrYSwga2IpID0+IHtcbiAgICBjb25zdCBhYSA9IGthICYgMHhmZjtcbiAgICBjb25zdCBhYiA9IGtiICYgMHhmZjtcbiAgICAvLyBOb24tb3BhcXVlIGZpcnN0IChzaG9ydGVzdCBwb3NzaWJsZSB0Uk5TKSwgdGhlbiBtb3N0LXVzZWQgZmlyc3QuXG4gICAgaWYgKChhYSA9PT0gMjU1KSAhPT0gKGFiID09PSAyNTUpKSByZXR1cm4gYWEgPT09IDI1NSA/IDEgOiAtMTtcbiAgICBjb25zdCBjYSA9IGNvdW50c1tzbG90T2YuZ2V0KGthKSBhcyBudW1iZXJdO1xuICAgIGNvbnN0IGNiID0gY291bnRzW3Nsb3RPZi5nZXQoa2IpIGFzIG51bWJlcl07XG4gICAgaWYgKGNhICE9PSBjYikgcmV0dXJuIGNiIC0gY2E7XG4gICAgcmV0dXJuIGthIC0ga2I7XG4gIH0pO1xuXG4gIGxldCB0cmFuc3BhcmVudEluZGV4ID0ga2V5cy5maW5kSW5kZXgoKGspID0+IChrICYgMHhmZikgPT09IDApO1xuICBpZiAodHJhbnNwYXJlbnRJbmRleCA8IDAgJiYgcmVzZXJ2ZVRyYW5zcGFyZW50KSB7XG4gICAga2V5cy51bnNoaWZ0KDApOyAvLyByPWc9Yj1hPTBcbiAgICB0cmFuc3BhcmVudEluZGV4ID0gMDtcbiAgfVxuXG4gIGNvbnN0IHNpemUgPSBrZXlzLmxlbmd0aDtcbiAgY29uc3QgcmdiYSA9IG5ldyBVaW50OEFycmF5KHNpemUgKiA0KTtcbiAgY29uc3QgbG9va3VwID0gbmV3IE1hcDxudW1iZXIsIG51bWJlcj4oKTtcbiAgbGV0IHRybnNDb3VudCA9IDA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2l6ZTsgaSsrKSB7XG4gICAgY29uc3QgayA9IGtleXNbaV07XG4gICAgcmdiYVtpICogNF0gPSAoayA+Pj4gMjQpICYgMHhmZjtcbiAgICByZ2JhW2kgKiA0ICsgMV0gPSAoayA+Pj4gMTYpICYgMHhmZjtcbiAgICByZ2JhW2kgKiA0ICsgMl0gPSAoayA+Pj4gOCkgJiAweGZmO1xuICAgIHJnYmFbaSAqIDQgKyAzXSA9IGsgJiAweGZmO1xuICAgIGxvb2t1cC5zZXQoaywgaSk7XG4gICAgaWYgKChrICYgMHhmZikgIT09IDI1NSkgdHJuc0NvdW50ID0gaSArIDE7XG4gIH1cblxuICByZXR1cm4geyByZ2JhLCBzaXplLCB0cm5zQ291bnQsIHRyYW5zcGFyZW50SW5kZXgsIGxvb2t1cCB9O1xufVxuXG4vKiogTWFwIGFuIFJHQkE4IGltYWdlIHRvIG9uZSBieXRlIHBlciBwaXhlbCB0aHJvdWdoIGBwYWxldHRlYC4gVGhyb3dzIG9uIGFcbiAqIGNvbG91ciB0aGUgcGFsZXR0ZSBkb2VzIG5vdCBjb250YWluOiB0aGUgcGFsZXR0ZSBpcyBidWlsdCBmcm9tIHRoZSB2ZXJ5XG4gKiBwaXhlbHMgYmVpbmcgaW5kZXhlZCwgc28gYSBtaXNzIG1lYW5zIHRoZSBjYWxsZXIgbWl4ZWQgaW1hZ2VzIGZyb21cbiAqIGRpZmZlcmVudCBidWlsZHMgXHUyMDE0IHNpbGVudGx5IHN1YnN0aXR1dGluZyBhIG5lYXJieSBjb2xvdXIgd291bGQgc2hpcCBhXG4gKiBjb3JydXB0ZWQgZnJhbWUgdGhhdCBsb29rcyBhbG1vc3QgcmlnaHQuICovXG5leHBvcnQgZnVuY3Rpb24gaW5kZXhJbWFnZShzcmM6IFVpbnQ4QXJyYXksIHBhbGV0dGU6IFBhbGV0dGUpOiBVaW50OEFycmF5IHtcbiAgY29uc3QgbiA9IHNyYy5sZW5ndGggPj4gMjtcbiAgY29uc3Qgb3V0ID0gbmV3IFVpbnQ4QXJyYXkobik7XG4gIGZvciAobGV0IHAgPSAwLCBpID0gMDsgcCA8IG47IHArKywgaSArPSA0KSB7XG4gICAgY29uc3Qga2V5ID0gcGFja1JnYmEoc3JjW2ldLCBzcmNbaSArIDFdLCBzcmNbaSArIDJdLCBzcmNbaSArIDNdKTtcbiAgICBjb25zdCBpZHggPSBwYWxldHRlLmxvb2t1cC5nZXQoa2V5KTtcbiAgICBpZiAoaWR4ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYGNvbG91ciByZ2JhKCR7c3JjW2ldfSwke3NyY1tpICsgMV19LCR7c3JjW2kgKyAyXX0sJHtzcmNbaSArIDNdfSkgaXMgbm90IGluIHRoZSBwYWxldHRlYCxcbiAgICAgICk7XG4gICAgfVxuICAgIG91dFtwXSA9IGlkeDtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuIiwgIi8vIFNpemUtb3B0aW1pc2luZyBBUE5HIGVuY29kZXIuXG5cbmltcG9ydCB7IGNvbmNhdEJ5dGVzLCBmaWx0ZXJTY2FubGluZXMsIFBOR19TSUdOQVRVUkUsIHdyaXRlQ2h1bmssIHR5cGUgRmlsdGVyU3RyYXRlZ3kgfSBmcm9tICcuL3BuZy50cyc7XG5pbXBvcnQgeyBjb21wb3NpdGUsIGNyb3BSZWN0LCBjcm9wUmVjdE1hc2tlZCwgZGlmZkZyYW1lcywgdHlwZSBSZWN0IH0gZnJvbSAnLi9kaWZmLnRzJztcbmltcG9ydCB7IGJ1aWxkUGFsZXR0ZSwgaW5kZXhJbWFnZSwgdHlwZSBQYWxldHRlIH0gZnJvbSAnLi9wYWxldHRlLnRzJztcblxuLyoqIE9uZSBzb3VyY2UgZnJhbWU6IGFuIFJHQkE4IGltYWdlIHBsdXMgaG93IGxvbmcgaXQgaXMgc2hvd24uICovXG5leHBvcnQgaW50ZXJmYWNlIEFwbmdGcmFtZSB7XG4gIC8qKiBgd2lkdGggKiBoZWlnaHQgKiA0YCBieXRlcywgUkdCQTgsIG5vbi1wcmVtdWx0aXBsaWVkLiAqL1xuICBkYXRhOiBVaW50OEFycmF5IHwgVWludDhDbGFtcGVkQXJyYXk7XG4gIC8qKiBEaXNwbGF5IGR1cmF0aW9uIGluIG1pbGxpc2Vjb25kcy4gRGVmYXVsdHMgdG8gYEFwbmdPcHRpb25zLmRlbGF5TXNgLiAqL1xuICBkZWxheU1zPzogbnVtYmVyO1xufVxuXG4vKiogSG93IGhhcmQgdGhlIGVuY29kZXIgd29ya3MgZm9yIHRoZSBsYXN0IGZldyBwZXJjZW50IG9mIHNpemUuICovXG5leHBvcnQgdHlwZSBBcG5nRWZmb3J0ID0gJ2Zhc3QnIHwgJ2Jlc3QnO1xuXG4vKiogV2hpY2ggUE5HIGNvbG91ciB0eXBlIHRvIGVtaXQuICovXG5leHBvcnQgdHlwZSBBcG5nQ29sb3JUeXBlID0gJ2F1dG8nIHwgJ3JnYmEnIHwgJ2luZGV4ZWQnO1xuXG4vKiogQSBwbHVnZ2FibGUgemxpYiBjb21wcmVzc29yOiByYXcgYnl0ZXMgaW4sIHpsaWIgc3RyZWFtIG91dC4gKi9cbmV4cG9ydCB0eXBlIERlZmxhdGUgPSAoYnl0ZXM6IFVpbnQ4QXJyYXkpID0+IFByb21pc2U8VWludDhBcnJheT47XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXBuZ09wdGlvbnMge1xuICAvKiAqL1xuICB0aHJlc2hvbGQ/OiBudW1iZXI7XG4gIC8qKiBTYW1lLCBmb3IgdGhlIGFscGhhIGNoYW5uZWwuIERlZmF1bHRzIHRvIGB0aHJlc2hvbGRgLiAqL1xuICBhbHBoYVRocmVzaG9sZD86IG51bWJlcjtcbiAgLyoqIERlZmF1bHQgcGVyLWZyYW1lIGR1cmF0aW9uIGluIG1zIHdoZW4gYSBmcmFtZSBkb2VzIG5vdCBjYXJyeSBpdHMgb3duLiAqL1xuICBkZWxheU1zPzogbnVtYmVyO1xuICAvKiAqL1xuICBsb29wcz86IG51bWJlcjtcbiAgLyoqIENvbG91ciB0eXBlLiAnYXV0bycgdXNlcyBhbiBleGFjdCBwYWxldHRlIHdoZW4gdGhlIGZyYW1lcyBmaXQgaW4gbXVsdGlwbGUgY29sb3Vycy4gKi9cbiAgY29sb3JUeXBlPzogQXBuZ0NvbG9yVHlwZTtcbiAgLyoqIFJvdyBmaWx0ZXIgc3RyYXRlZ3kuIERlZmF1bHQgJ2FkYXB0aXZlJy4gSWdub3JlZCBhdCBlZmZvcnQgJ2Jlc3QnLCB3aGljaCB0cmllcyB0aGVtLiAqL1xuICBmaWx0ZXI/OiBGaWx0ZXJTdHJhdGVneTtcbiAgLyoqICdmYXN0JyBlbmNvZGVzIGVhY2ggZnJhbWUgb25jZSB3aXRoIHRoZSBoZXVyaXN0aWMgY2hvaWNlIG9mIGJsZW5kIG9wIGFuZCBmaWx0ZXIuICovXG4gIGVmZm9ydD86IEFwbmdFZmZvcnQ7XG4gIC8qKiBEcm9wIGZyYW1lcyB0aGF0IGNoYW5nZSBub3RoaW5nIGFuZCBhZGQgdGhlaXIgZGVsYXkgdG8gdGhlIHByZXZpb3VzIGZyYW1lLiBEZWZhdWx0IHRydWUuICovXG4gIGNvYWxlc2NlPzogYm9vbGVhbjtcbiAgLyoqIE92ZXJyaWRlIHRoZSBjb21wcmVzc29yLiBEZWZhdWx0OiBgQ29tcHJlc3Npb25TdHJlYW0oJ2RlZmxhdGUnKWAuICovXG4gIGRlZmxhdGU/OiBEZWZsYXRlO1xuICAvKiogQ2FsbGVkIGFmdGVyIGVhY2ggc291cmNlIGZyYW1lIGlzIHByb2Nlc3NlZC4gKi9cbiAgb25Qcm9ncmVzcz86IChkb25lOiBudW1iZXIsIHRvdGFsOiBudW1iZXIpID0+IHZvaWQ7XG59XG5cbi8qKiBXaGF0IHRoZSBlbmNvZGVyIGRpZCB3aXRoIG9uZSBlbWl0dGVkIGZyYW1lLiAqL1xuZXhwb3J0IGludGVyZmFjZSBBcG5nRnJhbWVTdGF0IHtcbiAgLyoqIEluZGV4IG9mIHRoaXMgZnJhbWUgaW4gdGhlIE9VVFBVVCBhbmltYXRpb24uICovXG4gIGluZGV4OiBudW1iZXI7XG4gIC8qKiBJbmRleCBvZiB0aGUgc291cmNlIGZyYW1lIGl0IGNhbWUgZnJvbS4gKi9cbiAgc291cmNlSW5kZXg6IG51bWJlcjtcbiAgLyoqIFRoZSBzdG9yZWQgcmVjdGFuZ2xlLiAqL1xuICByZWN0OiBSZWN0O1xuICAvKiogSG93IGl0IGNvbXBvc2l0ZXM6ICdzb3VyY2UnIHJlcGxhY2VzIHRoZSByZWN0YW5nbGUsICdvdmVyJyBza2lwcyB0cmFuc3BhcmVudCBwaXhlbHMuICovXG4gIGJsZW5kOiAnc291cmNlJyB8ICdvdmVyJztcbiAgLyoqIFRoZSBjaG9zZW4gUE5HIHJvdyBmaWx0ZXIsIG9yICdhZGFwdGl2ZScgd2hlbiBjaG9zZW4gcGVyIHJvdy4gKi9cbiAgZmlsdGVyOiBGaWx0ZXJTdHJhdGVneTtcbiAgLyoqIENvbXByZXNzZWQgcGF5bG9hZCBzaXplIGluIGJ5dGVzICh0aGUgSURBVC9mZEFUIGRhdGEsIGV4Y2x1ZGluZyBjaHVuayBmcmFtaW5nKS4gKi9cbiAgYnl0ZXM6IG51bWJlcjtcbiAgLyoqIFBpeGVscyBpbnNpZGUgYHJlY3RgIHRoYXQgYWN0dWFsbHkgY2hhbmdlZC4gKi9cbiAgY2hhbmdlZDogbnVtYmVyO1xuICAvKiogVG90YWwgZGlzcGxheSB0aW1lIGluIG1zLCBpbmNsdWRpbmcgYW55IGNvYWxlc2NlZCBmcmFtZXMuICovXG4gIGRlbGF5TXM6IG51bWJlcjtcbiAgLyogKi9cbiAgY29hbGVzY2VkOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXBuZ1Jlc3VsdCB7XG4gIC8qKiBUaGUgY29tcGxldGUgLmFwbmcgLyAucG5nIGZpbGUuICovXG4gIGJ5dGVzOiBVaW50OEFycmF5PEFycmF5QnVmZmVyPjtcbiAgd2lkdGg6IG51bWJlcjtcbiAgaGVpZ2h0OiBudW1iZXI7XG4gIC8qKiBGcmFtZXMgaW4gdGhlIG91dHB1dCBhbmltYXRpb24uICovXG4gIGZyYW1lQ291bnQ6IG51bWJlcjtcbiAgLyoqIEZyYW1lcyBoYW5kZWQgdG8gdGhlIGVuY29kZXIuICovXG4gIHNvdXJjZUZyYW1lQ291bnQ6IG51bWJlcjtcbiAgY29sb3JUeXBlOiAncmdiYScgfCAnaW5kZXhlZCc7XG4gIC8qKiBQYWxldHRlIGVudHJ5IGNvdW50IHdoZW4gaW5kZXhlZC4gKi9cbiAgcGFsZXR0ZVNpemU6IG51bWJlcjtcbiAgZnJhbWVzOiBBcG5nRnJhbWVTdGF0W107XG59XG5cbi8vIC0tIENvbXByZXNzaW9uIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIERlZmxhdGUgdG8gYSB6bGliIHN0cmVhbSB1c2luZyB0aGUgcGxhdGZvcm0ncyBgQ29tcHJlc3Npb25TdHJlYW1gLlxuICpcbiAqIFRoZSByZWFkZXIgaXMgYXR0YWNoZWQgYmVmb3JlIGFueXRoaW5nIGlzIHdyaXR0ZW46IHdyaXRpbmcgZmlyc3QgY2FuIGJsb2NrIG9uXG4gKiBiYWNrcHJlc3N1cmUgd2l0aCBubyBvbmUgZHJhaW5pbmcgdGhlIG90aGVyIGVuZC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlZmxhdGVabGliKGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gIGNvbnN0IGNzID0gbmV3IENvbXByZXNzaW9uU3RyZWFtKCdkZWZsYXRlJyk7XG4gIGNvbnN0IGRvbmUgPSBuZXcgUmVzcG9uc2UoY3MucmVhZGFibGUpLmFycmF5QnVmZmVyKCk7XG4gIC8vIFRoZSBzdHJlYW0gaXMgdHlwZWQgYXMgdGFraW5nIGEgdmlldyBvbnRvIGEgcGxhaW4gQXJyYXlCdWZmZXI7IGEgVWludDhBcnJheSBvdmVyIGFueSBidWZmZXIgaXMgd2hhdCBpdCBhY2NlcHRzLlxuICBjb25zdCB3cml0ZXIgPSBjcy53cml0YWJsZS5nZXRXcml0ZXIoKSBhcyBXcml0YWJsZVN0cmVhbURlZmF1bHRXcml0ZXI8VWludDhBcnJheT47XG4gIGNvbnN0IHdyaXRlID0gd3JpdGVyLndyaXRlKGJ5dGVzKS50aGVuKCgpID0+IHdyaXRlci5jbG9zZSgpKTtcbiAgY29uc3QgW2J1ZmZlcl0gPSBhd2FpdCBQcm9taXNlLmFsbChbZG9uZSwgd3JpdGVdKTtcbiAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGJ1ZmZlcik7XG59XG5cbi8vIC0tIENodW5rIGJ1aWxkZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiB1MzIodmlldzogRGF0YVZpZXcsIGF0OiBudW1iZXIsIHZhbHVlOiBudW1iZXIpOiB2b2lkIHtcbiAgdmlldy5zZXRVaW50MzIoYXQsIHZhbHVlID4+PiAwKTtcbn1cblxuZnVuY3Rpb24gaWhkcih3aWR0aDogbnVtYmVyLCBoZWlnaHQ6IG51bWJlciwgY29sb3JUeXBlOiBudW1iZXIpOiBVaW50OEFycmF5IHtcbiAgY29uc3QgZCA9IG5ldyBVaW50OEFycmF5KDEzKTtcbiAgY29uc3QgdiA9IG5ldyBEYXRhVmlldyhkLmJ1ZmZlcik7XG4gIHUzMih2LCAwLCB3aWR0aCk7XG4gIHUzMih2LCA0LCBoZWlnaHQpO1xuICBkWzhdID0gODsgLy8gYml0IGRlcHRoXG4gIGRbOV0gPSBjb2xvclR5cGU7XG4gIHJldHVybiB3cml0ZUNodW5rKCdJSERSJywgZCk7XG59XG5cbmZ1bmN0aW9uIGFjdGwoZnJhbWVDb3VudDogbnVtYmVyLCBsb29wczogbnVtYmVyKTogVWludDhBcnJheSB7XG4gIGNvbnN0IGQgPSBuZXcgVWludDhBcnJheSg4KTtcbiAgY29uc3QgdiA9IG5ldyBEYXRhVmlldyhkLmJ1ZmZlcik7XG4gIHUzMih2LCAwLCBmcmFtZUNvdW50KTtcbiAgdTMyKHYsIDQsIGxvb3BzKTtcbiAgcmV0dXJuIHdyaXRlQ2h1bmsoJ2FjVEwnLCBkKTtcbn1cblxuLyoqXG4gKiBBUE5HIHN0b3JlcyBhIGRlbGF5IGFzIHRoZSBmcmFjdGlvbiBgbnVtL2RlbmAgc2Vjb25kcywgYm90aCB1aW50MTYuIFBpY2sgdGhlXG4gKiBsYXJnZXN0IGRlbm9taW5hdG9yIHRoYXQga2VlcHMgdGhlIG51bWVyYXRvciBpbiByYW5nZSwgc28gc2hvcnQgZGVsYXlzIGtlZXBcbiAqIG1pbGxpc2Vjb25kIHByZWNpc2lvbiBhbmQgbG9uZyBvbmVzIHN0aWxsIGZpdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlbGF5RnJhY3Rpb24obXM6IG51bWJlcik6IHsgbnVtOiBudW1iZXI7IGRlbjogbnVtYmVyIH0ge1xuICBjb25zdCBjbGFtcGVkID0gTWF0aC5tYXgoMCwgTWF0aC5yb3VuZChtcykpO1xuICBmb3IgKGNvbnN0IGRlbiBvZiBbMTAwMCwgMTAwLCAxMCwgMV0pIHtcbiAgICBjb25zdCBudW0gPSBNYXRoLnJvdW5kKChjbGFtcGVkICogZGVuKSAvIDEwMDApO1xuICAgIGlmIChudW0gPD0gMHhmZmZmKSByZXR1cm4geyBudW0sIGRlbiB9O1xuICB9XG4gIHJldHVybiB7IG51bTogMHhmZmZmLCBkZW46IDEgfTtcbn1cblxuZnVuY3Rpb24gZmN0bChzZXE6IG51bWJlciwgcmVjdDogUmVjdCwgZGVsYXlNczogbnVtYmVyLCBibGVuZDogJ3NvdXJjZScgfCAnb3ZlcicpOiBVaW50OEFycmF5IHtcbiAgY29uc3QgZCA9IG5ldyBVaW50OEFycmF5KDI2KTtcbiAgY29uc3QgdiA9IG5ldyBEYXRhVmlldyhkLmJ1ZmZlcik7XG4gIGNvbnN0IHsgbnVtLCBkZW4gfSA9IGRlbGF5RnJhY3Rpb24oZGVsYXlNcyk7XG4gIHUzMih2LCAwLCBzZXEpO1xuICB1MzIodiwgNCwgcmVjdC53KTtcbiAgdTMyKHYsIDgsIHJlY3QuaCk7XG4gIHUzMih2LCAxMiwgcmVjdC54KTtcbiAgdTMyKHYsIDE2LCByZWN0LnkpO1xuICB2LnNldFVpbnQxNigyMCwgbnVtKTtcbiAgdi5zZXRVaW50MTYoMjIsIGRlbik7XG4gIGRbMjRdID0gMDsgLy8gZGlzcG9zZV9vcCA9IE5PTkUuXG4gIGRbMjVdID0gYmxlbmQgPT09ICdvdmVyJyA/IDEgOiAwO1xuICByZXR1cm4gd3JpdGVDaHVuaygnZmNUTCcsIGQpO1xufVxuXG5mdW5jdGlvbiBmZGF0KHNlcTogbnVtYmVyLCBwYXlsb2FkOiBVaW50OEFycmF5KTogVWludDhBcnJheSB7XG4gIGNvbnN0IGQgPSBuZXcgVWludDhBcnJheSg0ICsgcGF5bG9hZC5sZW5ndGgpO1xuICBuZXcgRGF0YVZpZXcoZC5idWZmZXIpLnNldFVpbnQzMigwLCBzZXEgPj4+IDApO1xuICBkLnNldChwYXlsb2FkLCA0KTtcbiAgcmV0dXJuIHdyaXRlQ2h1bmsoJ2ZkQVQnLCBkKTtcbn1cblxuZnVuY3Rpb24gcGx0ZUNodW5rcyhwYWxldHRlOiBQYWxldHRlKTogVWludDhBcnJheVtdIHtcbiAgY29uc3QgcGx0ZSA9IG5ldyBVaW50OEFycmF5KHBhbGV0dGUuc2l6ZSAqIDMpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhbGV0dGUuc2l6ZTsgaSsrKSB7XG4gICAgcGx0ZVtpICogM10gPSBwYWxldHRlLnJnYmFbaSAqIDRdO1xuICAgIHBsdGVbaSAqIDMgKyAxXSA9IHBhbGV0dGUucmdiYVtpICogNCArIDFdO1xuICAgIHBsdGVbaSAqIDMgKyAyXSA9IHBhbGV0dGUucmdiYVtpICogNCArIDJdO1xuICB9XG4gIGNvbnN0IG91dCA9IFt3cml0ZUNodW5rKCdQTFRFJywgcGx0ZSldO1xuICBpZiAocGFsZXR0ZS50cm5zQ291bnQgPiAwKSB7XG4gICAgY29uc3QgdHJucyA9IG5ldyBVaW50OEFycmF5KHBhbGV0dGUudHJuc0NvdW50KTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBhbGV0dGUudHJuc0NvdW50OyBpKyspIHRybnNbaV0gPSBwYWxldHRlLnJnYmFbaSAqIDQgKyAzXTtcbiAgICBvdXQucHVzaCh3cml0ZUNodW5rKCd0Uk5TJywgdHJucykpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8vIC0tIEVuY29kaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgRW5jb2RlZCB7XG4gIHBheWxvYWQ6IFVpbnQ4QXJyYXk7XG4gIGZpbHRlcjogRmlsdGVyU3RyYXRlZ3k7XG59XG5cbi8vIENvbXByZXNzIG9uZSByZWN0YW5nbGUncyBwaXhlbHMuIEF0IGVmZm9ydCAnYmVzdCcgZXZlcnkgZmlsdGVyIHN0cmF0ZWd5IGlzXG4vLyBjb21wcmVzc2VkIGFuZCB0aGUgc21hbGxlc3Qga2VwdDsgJ2Zhc3QnIGNvbXByZXNzZXMgdGhlIHJlcXVlc3RlZCBvbmUgb25jZS5cbmFzeW5jIGZ1bmN0aW9uIGVuY29kZVJlY3QoXG4gIHJnYmE6IFVpbnQ4QXJyYXksXG4gIHJlY3Q6IFJlY3QsXG4gIHBhbGV0dGU6IFBhbGV0dGUgfCBudWxsLFxuICBmaWx0ZXI6IEZpbHRlclN0cmF0ZWd5LFxuICBlZmZvcnQ6IEFwbmdFZmZvcnQsXG4gIGRlZmxhdGU6IERlZmxhdGUsXG4pOiBQcm9taXNlPEVuY29kZWQ+IHtcbiAgY29uc3QgcmF3ID0gcGFsZXR0ZSA/IGluZGV4SW1hZ2UocmdiYSwgcGFsZXR0ZSkgOiByZ2JhO1xuICBjb25zdCBicHAgPSBwYWxldHRlID8gMSA6IDQ7XG4gIGNvbnN0IHN0cmlkZSA9IHJlY3QudyAqIGJwcDtcblxuICBjb25zdCBjYW5kaWRhdGVzOiBGaWx0ZXJTdHJhdGVneVtdID1cbiAgICBlZmZvcnQgPT09ICdiZXN0JyA/IFsnYWRhcHRpdmUnLCAnbm9uZScsICdzdWInLCAndXAnLCAnYXZlcmFnZScsICdwYWV0aCddIDogW2ZpbHRlcl07XG5cbiAgbGV0IGJlc3Q6IEVuY29kZWQgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBzdHJhdGVneSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgY29uc3QgcGF5bG9hZCA9IGF3YWl0IGRlZmxhdGUoZmlsdGVyU2NhbmxpbmVzKHJhdywgc3RyaWRlLCByZWN0LmgsIGJwcCwgc3RyYXRlZ3kpKTtcbiAgICBpZiAoIWJlc3QgfHwgcGF5bG9hZC5sZW5ndGggPCBiZXN0LnBheWxvYWQubGVuZ3RoKSBiZXN0ID0geyBwYXlsb2FkLCBmaWx0ZXI6IHN0cmF0ZWd5IH07XG4gIH1cbiAgLy8gYGNhbmRpZGF0ZXNgIGlzIG5ldmVyIGVtcHR5LCBzbyBgYmVzdGAgaXMgYWx3YXlzIGFzc2lnbmVkLlxuICByZXR1cm4gYmVzdCBhcyBFbmNvZGVkO1xufVxuXG5pbnRlcmZhY2UgUGVuZGluZ0ZyYW1lIHtcbiAgcmVjdDogUmVjdDtcbiAgYmxlbmQ6ICdzb3VyY2UnIHwgJ292ZXInO1xuICBmaWx0ZXI6IEZpbHRlclN0cmF0ZWd5O1xuICBwYXlsb2FkOiBVaW50OEFycmF5O1xuICBjaGFuZ2VkOiBudW1iZXI7XG4gIGRlbGF5TXM6IG51bWJlcjtcbiAgY29hbGVzY2VkOiBudW1iZXI7XG4gIHNvdXJjZUluZGV4OiBudW1iZXI7XG59XG5cbi8qKlxuICogRW5jb2RlIGBmcmFtZXNgIGludG8gb25lIGFuaW1hdGVkIFBORy5cbiAqXG4gKiBFdmVyeSBmcmFtZSBtdXN0IGJlIGV4YWN0bHkgYHdpZHRoICogaGVpZ2h0ICogNGAgYnl0ZXMgb2YgUkdCQTguIFRocm93cyBvbiBhXG4gKiB3cm9uZy1zaXplZCBmcmFtZSBvciBhbiBlbXB0eSBsaXN0IHJhdGhlciB0aGFuIGVuY29kaW5nIHNvbWV0aGluZyBzdWJ0bHlcbiAqIHdyb25nLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZW5jb2RlQXBuZyhcbiAgd2lkdGg6IG51bWJlcixcbiAgaGVpZ2h0OiBudW1iZXIsXG4gIGZyYW1lczogcmVhZG9ubHkgQXBuZ0ZyYW1lW10sXG4gIG9wdGlvbnM6IEFwbmdPcHRpb25zID0ge30sXG4pOiBQcm9taXNlPEFwbmdSZXN1bHQ+IHtcbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHdpZHRoKSB8fCAhTnVtYmVyLmlzSW50ZWdlcihoZWlnaHQpIHx8IHdpZHRoIDwgMSB8fCBoZWlnaHQgPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBBUE5HIHNpemUgbXVzdCBiZSBwb3NpdGl2ZSBpbnRlZ2VycywgZ290ICR7d2lkdGh9eCR7aGVpZ2h0fWApO1xuICB9XG4gIGlmIChmcmFtZXMubGVuZ3RoID09PSAwKSB0aHJvdyBuZXcgRXJyb3IoJ0FQTkcgbmVlZHMgYXQgbGVhc3Qgb25lIGZyYW1lJyk7XG5cbiAgY29uc3QgZXhwZWN0ZWQgPSB3aWR0aCAqIGhlaWdodCAqIDQ7XG4gIGNvbnN0IGltYWdlczogVWludDhBcnJheVtdID0gZnJhbWVzLm1hcCgoZiwgaSkgPT4ge1xuICAgIGlmIChmLmRhdGEubGVuZ3RoICE9PSBleHBlY3RlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgZnJhbWUgJHtpfSBpcyAke2YuZGF0YS5sZW5ndGh9IGJ5dGVzLCBleHBlY3RlZCAke2V4cGVjdGVkfSAoJHt3aWR0aH14JHtoZWlnaHR9IFJHQkE4KWAsXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gZi5kYXRhIGluc3RhbmNlb2YgVWludDhBcnJheSA/IGYuZGF0YSA6IG5ldyBVaW50OEFycmF5KGYuZGF0YS5idWZmZXIsIGYuZGF0YS5ieXRlT2Zmc2V0LCBmLmRhdGEubGVuZ3RoKTtcbiAgfSk7XG5cbiAgY29uc3QgdGhyZXNob2xkID0gb3B0aW9ucy50aHJlc2hvbGQgPz8gMjtcbiAgY29uc3QgYWxwaGFUaHJlc2hvbGQgPSBvcHRpb25zLmFscGhhVGhyZXNob2xkID8/IHRocmVzaG9sZDtcbiAgY29uc3QgZGVmYXVsdERlbGF5ID0gb3B0aW9ucy5kZWxheU1zID8/IDEwMDtcbiAgY29uc3QgbG9vcHMgPSBvcHRpb25zLmxvb3BzID8/IDA7XG4gIGNvbnN0IGZpbHRlciA9IG9wdGlvbnMuZmlsdGVyID8/ICdhZGFwdGl2ZSc7XG4gIGNvbnN0IGVmZm9ydCA9IG9wdGlvbnMuZWZmb3J0ID8/ICdmYXN0JztcbiAgY29uc3QgY29hbGVzY2UgPSBvcHRpb25zLmNvYWxlc2NlID8/IHRydWU7XG4gIGNvbnN0IGRlZmxhdGUgPSBvcHRpb25zLmRlZmxhdGUgPz8gZGVmbGF0ZVpsaWI7XG4gIGNvbnN0IGRpZmZPcHRpb25zID0geyB0aHJlc2hvbGQsIGFscGhhVGhyZXNob2xkIH07XG5cbiAgY29uc3Qgd2FudEluZGV4ZWQgPSAob3B0aW9ucy5jb2xvclR5cGUgPz8gJ2F1dG8nKSAhPT0gJ3JnYmEnO1xuICBjb25zdCBwYWxldHRlID0gd2FudEluZGV4ZWQgPyBidWlsZFBhbGV0dGUoaW1hZ2VzKSA6IG51bGw7XG4gIGlmIChvcHRpb25zLmNvbG9yVHlwZSA9PT0gJ2luZGV4ZWQnICYmICFwYWxldHRlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjb2xvclR5cGUgXCJpbmRleGVkXCIgcmVxdWVzdGVkIGJ1dCB0aGUgZnJhbWVzIHVzZSBtb3JlIHRoYW4gMjU2IGRpc3RpbmN0IGNvbG91cnMnKTtcbiAgfVxuICAvLyBBIGJsZW5kX29wPU9WRVIgcGF5bG9hZCB3cml0ZXMgdHJhbnNwYXJlbnQgcGl4ZWxzLlxuICBpZiAocGFsZXR0ZSAmJiBwYWxldHRlLnRyYW5zcGFyZW50SW5kZXggPCAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdpbnRlcm5hbDogaW5kZXhlZCBBUE5HIG5lZWRzIGEgdHJhbnNwYXJlbnQgcGFsZXR0ZSBlbnRyeScpO1xuICB9XG4gIGNvbnN0IG1hc2tGaWxsID0gcGFsZXR0ZVxuICAgID8gW1xuICAgICAgICBwYWxldHRlLnJnYmFbcGFsZXR0ZS50cmFuc3BhcmVudEluZGV4ICogNF0sXG4gICAgICAgIHBhbGV0dGUucmdiYVtwYWxldHRlLnRyYW5zcGFyZW50SW5kZXggKiA0ICsgMV0sXG4gICAgICAgIHBhbGV0dGUucmdiYVtwYWxldHRlLnRyYW5zcGFyZW50SW5kZXggKiA0ICsgMl0sXG4gICAgICAgIDAsXG4gICAgICBdXG4gICAgOiBbMCwgMCwgMCwgMF07XG5cbiAgY29uc3QgY2FudmFzID0gbmV3IFVpbnQ4QXJyYXkoZXhwZWN0ZWQpO1xuICBjb25zdCBwZW5kaW5nOiBQZW5kaW5nRnJhbWVbXSA9IFtdO1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaW1hZ2VzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgaW1hZ2UgPSBpbWFnZXNbaV07XG4gICAgY29uc3QgZGVsYXlNcyA9IGZyYW1lc1tpXS5kZWxheU1zID8/IGRlZmF1bHREZWxheTtcblxuICAgIGNvbnN0IGRpZmYgPSBpID09PSAwID8geyByZWN0OiB7IHg6IDAsIHk6IDAsIHc6IHdpZHRoLCBoOiBoZWlnaHQgfSwgY2hhbmdlZDogd2lkdGggKiBoZWlnaHQsIG9wYXF1ZTogZmFsc2UgfVxuICAgICAgOiBkaWZmRnJhbWVzKGNhbnZhcywgaW1hZ2UsIHdpZHRoLCBoZWlnaHQsIGRpZmZPcHRpb25zKTtcblxuICAgIGlmICghZGlmZikge1xuICAgICAgY29uc3QgbGFzdCA9IHBlbmRpbmdbcGVuZGluZy5sZW5ndGggLSAxXTtcbiAgICAgIGlmIChjb2FsZXNjZSAmJiBsYXN0KSB7XG4gICAgICAgIGxhc3QuZGVsYXlNcyArPSBkZWxheU1zO1xuICAgICAgICBsYXN0LmNvYWxlc2NlZCsrO1xuICAgICAgICBvcHRpb25zLm9uUHJvZ3Jlc3M/LihpICsgMSwgaW1hZ2VzLmxlbmd0aCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLy8gQ29hbGVzY2luZyBvZmY6IHN0aWxsIG5vdGhpbmcgY2hhbmdlZCwgc28gc3RvcmUgdGhlIHNtYWxsZXN0IGxlZ2FsIGZyYW1lIFx1MjAxNCBvbmUgdHJhbnNwYXJlbnQgcGl4ZWwgY29tcG9zaXRlZC5cbiAgICAgIGNvbnN0IHJlY3Q6IFJlY3QgPSB7IHg6IDAsIHk6IDAsIHc6IDEsIGg6IDEgfTtcbiAgICAgIGNvbnN0IGJsYW5rID0gVWludDhBcnJheS5mcm9tKG1hc2tGaWxsKTtcbiAgICAgIGNvbnN0IGVuY29kZWQgPSBhd2FpdCBlbmNvZGVSZWN0KGJsYW5rLCByZWN0LCBwYWxldHRlLCBmaWx0ZXIsIGVmZm9ydCwgZGVmbGF0ZSk7XG4gICAgICBwZW5kaW5nLnB1c2goe1xuICAgICAgICByZWN0LCBibGVuZDogJ292ZXInLCBmaWx0ZXI6IGVuY29kZWQuZmlsdGVyLCBwYXlsb2FkOiBlbmNvZGVkLnBheWxvYWQsXG4gICAgICAgIGNoYW5nZWQ6IDAsIGRlbGF5TXMsIGNvYWxlc2NlZDogMCwgc291cmNlSW5kZXg6IGksXG4gICAgICB9KTtcbiAgICAgIG9wdGlvbnMub25Qcm9ncmVzcz8uKGkgKyAxLCBpbWFnZXMubGVuZ3RoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHsgcmVjdCB9ID0gZGlmZjtcbiAgICAvLyBPVkVSIG9ubHkgcmVwcm9kdWNlcyBpdHMgc291cmNlIHdoZXJlIHRoYXQgc291cmNlIGlzIGZ1bGx5IG9wYXF1ZS5cbiAgICBjb25zdCBvdmVyTGVnYWwgPSBpID4gMCAmJiBkaWZmLm9wYXF1ZTtcblxuICAgIC8vIFdpdGggZXZlcnkgcGl4ZWwgaW4gdGhlIHJlY3RhbmdsZSBjaGFuZ2VkIHRoZXJlIGlzIG5vdGhpbmcgZm9yIE9WRVIgdG8gc2tpcC5cbiAgICBjb25zdCBvdmVySXNTb3VyY2UgPSBkaWZmLmNoYW5nZWQgPT09IHJlY3QudyAqIHJlY3QuaDtcbiAgICBjb25zdCBibGVuZHM6IEFycmF5PCdzb3VyY2UnIHwgJ292ZXInPiA9IFtdO1xuICAgIGlmIChvdmVyTGVnYWwpIGJsZW5kcy5wdXNoKCdvdmVyJyk7XG4gICAgaWYgKCFvdmVyTGVnYWwgfHwgKGVmZm9ydCA9PT0gJ2Jlc3QnICYmICFvdmVySXNTb3VyY2UpKSBibGVuZHMucHVzaCgnc291cmNlJyk7XG5cbiAgICBsZXQgY2hvc2VuOiBQZW5kaW5nRnJhbWUgfCB1bmRlZmluZWQ7XG4gICAgLy8gVGhlIHdpbm5pbmcgYmxlbmQncyBwaXhlbHMgYXJlIGtlcHQsIG5vdCByZWNvbXB1dGVkLlxuICAgIGxldCBzaG93bjogVWludDhBcnJheSB8IHVuZGVmaW5lZDtcbiAgICBmb3IgKGNvbnN0IGJsZW5kIG9mIGJsZW5kcykge1xuICAgICAgY29uc3QgcGF5bG9hZFJnYmEgPSBibGVuZCA9PT0gJ292ZXInXG4gICAgICAgID8gY3JvcFJlY3RNYXNrZWQoY2FudmFzLCBpbWFnZSwgd2lkdGgsIHJlY3QsIGRpZmZPcHRpb25zLCBtYXNrRmlsbClcbiAgICAgICAgOiBjcm9wUmVjdChpbWFnZSwgd2lkdGgsIHJlY3QpO1xuICAgICAgY29uc3QgZW5jb2RlZCA9IGF3YWl0IGVuY29kZVJlY3QocGF5bG9hZFJnYmEsIHJlY3QsIHBhbGV0dGUsIGZpbHRlciwgZWZmb3J0LCBkZWZsYXRlKTtcbiAgICAgIGlmICghY2hvc2VuIHx8IGVuY29kZWQucGF5bG9hZC5sZW5ndGggPCBjaG9zZW4ucGF5bG9hZC5sZW5ndGgpIHtcbiAgICAgICAgY2hvc2VuID0ge1xuICAgICAgICAgIHJlY3QsIGJsZW5kLCBmaWx0ZXI6IGVuY29kZWQuZmlsdGVyLCBwYXlsb2FkOiBlbmNvZGVkLnBheWxvYWQsXG4gICAgICAgICAgY2hhbmdlZDogZGlmZi5jaGFuZ2VkLCBkZWxheU1zLCBjb2FsZXNjZWQ6IDAsIHNvdXJjZUluZGV4OiBpLFxuICAgICAgICB9O1xuICAgICAgICBzaG93biA9IHBheWxvYWRSZ2JhO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIWNob3NlbiB8fCAhc2hvd24pIHRocm93IG5ldyBFcnJvcihgaW50ZXJuYWw6IGZyYW1lICR7aX0gcHJvZHVjZWQgbm8gZW5jb2RpbmdgKTtcbiAgICBwZW5kaW5nLnB1c2goY2hvc2VuKTtcblxuICAgIC8vIEFkdmFuY2UgdGhlIGNhbnZhcyB0aGUgd2F5IGEgZGVjb2RlciB3b3VsZCwgc28gdGhlIG5leHQgZnJhbWUgZGlmZnMgYWdhaW5zdCB3aGF0IHdpbGwgYmUgb24gc2NyZWVuLlxuICAgIGNvbXBvc2l0ZShjYW52YXMsIHdpZHRoLCByZWN0LCBzaG93biwgY2hvc2VuLmJsZW5kKTtcbiAgICBvcHRpb25zLm9uUHJvZ3Jlc3M/LihpICsgMSwgaW1hZ2VzLmxlbmd0aCk7XG4gIH1cblxuICAvLyAtLSBBc3NlbWJsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBjb25zdCBwYXJ0czogVWludDhBcnJheVtdID0gW1BOR19TSUdOQVRVUkUsIGloZHIod2lkdGgsIGhlaWdodCwgcGFsZXR0ZSA/IDMgOiA2KV07XG4gIGlmIChwYWxldHRlKSBwYXJ0cy5wdXNoKC4uLnBsdGVDaHVua3MocGFsZXR0ZSkpO1xuICBwYXJ0cy5wdXNoKGFjdGwocGVuZGluZy5sZW5ndGgsIGxvb3BzKSk7XG5cbiAgY29uc3Qgc3RhdHM6IEFwbmdGcmFtZVN0YXRbXSA9IFtdO1xuICBsZXQgc2VxID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwZW5kaW5nLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgZiA9IHBlbmRpbmdbaV07XG4gICAgcGFydHMucHVzaChmY3RsKHNlcSsrLCBmLnJlY3QsIGYuZGVsYXlNcywgaSA9PT0gMCA/ICdzb3VyY2UnIDogZi5ibGVuZCkpO1xuICAgIHBhcnRzLnB1c2goaSA9PT0gMCA/IHdyaXRlQ2h1bmsoJ0lEQVQnLCBmLnBheWxvYWQpIDogZmRhdChzZXErKywgZi5wYXlsb2FkKSk7XG4gICAgc3RhdHMucHVzaCh7XG4gICAgICBpbmRleDogaSxcbiAgICAgIHNvdXJjZUluZGV4OiBmLnNvdXJjZUluZGV4LFxuICAgICAgcmVjdDogZi5yZWN0LFxuICAgICAgYmxlbmQ6IGkgPT09IDAgPyAnc291cmNlJyA6IGYuYmxlbmQsXG4gICAgICBmaWx0ZXI6IGYuZmlsdGVyLFxuICAgICAgYnl0ZXM6IGYucGF5bG9hZC5sZW5ndGgsXG4gICAgICBjaGFuZ2VkOiBmLmNoYW5nZWQsXG4gICAgICBkZWxheU1zOiBmLmRlbGF5TXMsXG4gICAgICBjb2FsZXNjZWQ6IGYuY29hbGVzY2VkLFxuICAgIH0pO1xuICB9XG4gIHBhcnRzLnB1c2god3JpdGVDaHVuaygnSUVORCcsIG5ldyBVaW50OEFycmF5KDApKSk7XG5cbiAgcmV0dXJuIHtcbiAgICBieXRlczogY29uY2F0Qnl0ZXMocGFydHMpLFxuICAgIHdpZHRoLFxuICAgIGhlaWdodCxcbiAgICBmcmFtZUNvdW50OiBwZW5kaW5nLmxlbmd0aCxcbiAgICBzb3VyY2VGcmFtZUNvdW50OiBpbWFnZXMubGVuZ3RoLFxuICAgIGNvbG9yVHlwZTogcGFsZXR0ZSA/ICdpbmRleGVkJyA6ICdyZ2JhJyxcbiAgICBwYWxldHRlU2l6ZTogcGFsZXR0ZSA/IHBhbGV0dGUuc2l6ZSA6IDAsXG4gICAgZnJhbWVzOiBzdGF0cyxcbiAgfTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFFQSxTQUFTLFlBQVk7QUFDckIsT0FBTyxZQUFZ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
