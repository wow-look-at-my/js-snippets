// Size-optimising APNG encoder.
//
// Takes a list of RGBA8 frames and produces one animated PNG. Everything it
// does beyond "write the frames out" is aimed at the file size:
//
//   - dirty rectangles: each frame stores only the bounding box of the pixels
//     that moved since the previous one;
//   - transparent skipping: inside that box, pixels that did not move are
//     written as fully transparent and composited with blend_op=OVER, so the
//     decoder keeps what was already there and deflate sees long zero runs;
//   - a change threshold: channel movements at or below it are treated as no
//     movement, which is what lets a dirty-rect encoder find anything static in
//     input that carries resampling or sensor noise;
//   - frame coalescing: a frame that changes nothing is dropped and its delay
//     added to the frame before it;
//   - exact palette detection: <= 256 distinct colours become an 8-bit indexed
//     PNG, one byte per pixel instead of four, with no colour change at all;
//   - per-row adaptive filter selection, and at effort 'best' a real trial of
//     every legal (blend, filter) pairing per frame, keeping the smallest.
//
// Compression itself is the platform's: `CompressionStream('deflate')` emits
// the zlib stream PNG wants. Supply `options.deflate` to swap in something
// slower and denser.
//
// No DOM is used, so this runs unchanged in a worker (where it belongs — see
// apng/worker.ts) and under node.

import { concatBytes, filterScanlines, PNG_SIGNATURE, writeChunk, type FilterStrategy } from './png.ts';
import { composite, cropRect, cropRectMasked, diffFrames, type Rect } from './diff.ts';
import { buildPalette, indexImage, type Palette } from './palette.ts';

/** One source frame: an RGBA8 image plus how long it is shown. */
export interface ApngFrame {
  /** `width * height * 4` bytes, RGBA8, non-premultiplied. */
  data: Uint8Array | Uint8ClampedArray;
  /** Display duration in milliseconds. Defaults to `ApngOptions.delayMs`. */
  delayMs?: number;
}

/** How hard the encoder works for the last few percent of size. */
export type ApngEffort = 'fast' | 'best';

/** Which PNG colour type to emit. */
export type ApngColorType = 'auto' | 'rgba' | 'indexed';

/** A pluggable zlib compressor: raw bytes in, zlib stream out. */
export type Deflate = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface ApngOptions {
  /**
   * Per-channel change threshold, 0..255. A pixel counts as unchanged while
   * every colour channel is within this of what the decoder already shows.
   * Default 2: invisible at 8 bits, and enough to absorb the ±1 noise that
   * stops identical-looking frames from differencing to nothing. 0 is exact.
   */
  threshold?: number;
  /** Same, for the alpha channel. Defaults to `threshold`. */
  alphaThreshold?: number;
  /** Default per-frame duration in ms when a frame does not carry its own. Default 100. */
  delayMs?: number;
  /** Times to play the animation; 0 (the default) loops forever. */
  loops?: number;
  /** Colour type. 'auto' uses an exact palette when the frames fit in 256 colours. */
  colorType?: ApngColorType;
  /** Row filter strategy. Default 'adaptive'. Ignored at effort 'best', which tries them. */
  filter?: FilterStrategy;
  /**
   * 'fast' encodes each frame once with the heuristic choice of blend op and
   * filter. 'best' compresses every legal combination and keeps the smallest,
   * which costs several deflate passes per frame.
   */
  effort?: ApngEffort;
  /** Drop frames that change nothing and add their delay to the previous frame. Default true. */
  coalesce?: boolean;
  /** Override the compressor. Default: `CompressionStream('deflate')`. */
  deflate?: Deflate;
  /** Called after each source frame is processed. */
  onProgress?: (done: number, total: number) => void;
}

/** What the encoder did with one emitted frame. */
export interface ApngFrameStat {
  /** Index of this frame in the OUTPUT animation. */
  index: number;
  /** Index of the source frame it came from. */
  sourceIndex: number;
  /** The stored rectangle. */
  rect: Rect;
  /** How it composites: 'source' replaces the rectangle, 'over' skips transparent pixels. */
  blend: 'source' | 'over';
  /** The chosen PNG row filter, or 'adaptive' when chosen per row. */
  filter: FilterStrategy;
  /** Compressed payload size in bytes (the IDAT/fdAT data, excluding chunk framing). */
  bytes: number;
  /** Pixels inside `rect` that actually changed. */
  changed: number;
  /** Total display time in ms, including any coalesced frames. */
  delayMs: number;
  /** How many source frames were folded into this one (0 when none were). */
  coalesced: number;
}

export interface ApngResult {
  /**
   * The complete .apng / .png file. Typed over a plain ArrayBuffer, which is
   * what Blob and a postMessage transfer list accept.
   */
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  /** Frames in the output animation. */
  frameCount: number;
  /** Frames handed to the encoder. */
  sourceFrameCount: number;
  colorType: 'rgba' | 'indexed';
  /** Palette entry count when indexed. */
  paletteSize: number;
  frames: ApngFrameStat[];
}

// -- Compression ---------------------------------------------------------------

/**
 * Deflate to a zlib stream using the platform's `CompressionStream`.
 *
 * The reader is attached before anything is written: writing first can block on
 * backpressure with no one draining the other end.
 */
export async function deflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const done = new Response(cs.readable).arrayBuffer();
  // The stream is typed as taking a view onto a plain ArrayBuffer; a Uint8Array
  // over any buffer is what it actually accepts.
  const writer = cs.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
  const write = writer.write(bytes).then(() => writer.close());
  const [buffer] = await Promise.all([done, write]);
  return new Uint8Array(buffer);
}

// -- Chunk builders ------------------------------------------------------------

function u32(view: DataView, at: number, value: number): void {
  view.setUint32(at, value >>> 0);
}

function ihdr(width: number, height: number, colorType: number): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  u32(v, 0, width);
  u32(v, 4, height);
  d[8] = 8; // bit depth
  d[9] = colorType; // 6 = RGBA, 3 = indexed
  return writeChunk('IHDR', d);
}

function actl(frameCount: number, loops: number): Uint8Array {
  const d = new Uint8Array(8);
  const v = new DataView(d.buffer);
  u32(v, 0, frameCount);
  u32(v, 4, loops);
  return writeChunk('acTL', d);
}

/**
 * APNG stores a delay as the fraction `num/den` seconds, both uint16. Pick the
 * largest denominator that keeps the numerator in range, so short delays keep
 * millisecond precision and long ones still fit.
 */
export function delayFraction(ms: number): { num: number; den: number } {
  const clamped = Math.max(0, Math.round(ms));
  for (const den of [1000, 100, 10, 1]) {
    const num = Math.round((clamped * den) / 1000);
    if (num <= 0xffff) return { num, den };
  }
  return { num: 0xffff, den: 1 };
}

function fctl(seq: number, rect: Rect, delayMs: number, blend: 'source' | 'over'): Uint8Array {
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
  d[24] = 0; // dispose_op = NONE: leave the canvas for the next frame to build on
  d[25] = blend === 'over' ? 1 : 0;
  return writeChunk('fcTL', d);
}

function fdat(seq: number, payload: Uint8Array): Uint8Array {
  const d = new Uint8Array(4 + payload.length);
  new DataView(d.buffer).setUint32(0, seq >>> 0);
  d.set(payload, 4);
  return writeChunk('fdAT', d);
}

function plteChunks(palette: Palette): Uint8Array[] {
  const plte = new Uint8Array(palette.size * 3);
  for (let i = 0; i < palette.size; i++) {
    plte[i * 3] = palette.rgba[i * 4];
    plte[i * 3 + 1] = palette.rgba[i * 4 + 1];
    plte[i * 3 + 2] = palette.rgba[i * 4 + 2];
  }
  const out = [writeChunk('PLTE', plte)];
  if (palette.trnsCount > 0) {
    const trns = new Uint8Array(palette.trnsCount);
    for (let i = 0; i < palette.trnsCount; i++) trns[i] = palette.rgba[i * 4 + 3];
    out.push(writeChunk('tRNS', trns));
  }
  return out;
}

// -- Encoding ------------------------------------------------------------------

interface Encoded {
  payload: Uint8Array;
  filter: FilterStrategy;
}

// Compress one rectangle's pixels. At effort 'best' every filter strategy is
// compressed and the smallest kept; 'fast' compresses the requested one once.
async function encodeRect(
  rgba: Uint8Array,
  rect: Rect,
  palette: Palette | null,
  filter: FilterStrategy,
  effort: ApngEffort,
  deflate: Deflate,
): Promise<Encoded> {
  const raw = palette ? indexImage(rgba, palette) : rgba;
  const bpp = palette ? 1 : 4;
  const stride = rect.w * bpp;

  const candidates: FilterStrategy[] =
    effort === 'best' ? ['adaptive', 'none', 'sub', 'up', 'average', 'paeth'] : [filter];

  let best: Encoded | null = null;
  for (const strategy of candidates) {
    const payload = await deflate(filterScanlines(raw, stride, rect.h, bpp, strategy));
    if (!best || payload.length < best.payload.length) best = { payload, filter: strategy };
  }
  // `candidates` is never empty, so `best` is always assigned.
  return best as Encoded;
}

interface PendingFrame {
  rect: Rect;
  blend: 'source' | 'over';
  filter: FilterStrategy;
  payload: Uint8Array;
  changed: number;
  delayMs: number;
  coalesced: number;
  sourceIndex: number;
}

/**
 * Encode `frames` into one animated PNG.
 *
 * Every frame must be exactly `width * height * 4` bytes of RGBA8. Throws on a
 * wrong-sized frame or an empty list rather than encoding something subtly
 * wrong.
 */
export async function encodeApng(
  width: number,
  height: number,
  frames: readonly ApngFrame[],
  options: ApngOptions = {},
): Promise<ApngResult> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`APNG size must be positive integers, got ${width}x${height}`);
  }
  if (frames.length === 0) throw new Error('APNG needs at least one frame');

  const expected = width * height * 4;
  const images: Uint8Array[] = frames.map((f, i) => {
    if (f.data.length !== expected) {
      throw new Error(
        `frame ${i} is ${f.data.length} bytes, expected ${expected} (${width}x${height} RGBA8)`,
      );
    }
    return f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.length);
  });

  const threshold = options.threshold ?? 2;
  const alphaThreshold = options.alphaThreshold ?? threshold;
  const defaultDelay = options.delayMs ?? 100;
  const loops = options.loops ?? 0;
  const filter = options.filter ?? 'adaptive';
  const effort = options.effort ?? 'fast';
  const coalesce = options.coalesce ?? true;
  const deflate = options.deflate ?? deflateZlib;
  const diffOptions = { threshold, alphaThreshold };

  const wantIndexed = (options.colorType ?? 'auto') !== 'rgba';
  const palette = wantIndexed ? buildPalette(images) : null;
  if (options.colorType === 'indexed' && !palette) {
    throw new Error('colorType "indexed" requested but the frames use more than 256 distinct colours');
  }
  // A blend_op=OVER payload writes transparent pixels, so the palette must
  // contain one. buildPalette reserves a slot for it; if that ever stops
  // holding, masked frames would index a colour that is not there.
  if (palette && palette.transparentIndex < 0) {
    throw new Error('internal: indexed APNG needs a transparent palette entry');
  }
  const maskFill = palette
    ? [
        palette.rgba[palette.transparentIndex * 4],
        palette.rgba[palette.transparentIndex * 4 + 1],
        palette.rgba[palette.transparentIndex * 4 + 2],
        0,
      ]
    : [0, 0, 0, 0];

  const canvas = new Uint8Array(expected);
  const pending: PendingFrame[] = [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const delayMs = frames[i].delayMs ?? defaultDelay;

    // Frame 0 is the PNG's own image: full size, and a decoder that ignores
    // the animation shows exactly it.
    const diff = i === 0 ? { rect: { x: 0, y: 0, w: width, h: height }, changed: width * height, opaque: false }
      : diffFrames(canvas, image, width, height, diffOptions);

    if (!diff) {
      const last = pending[pending.length - 1];
      if (coalesce && last) {
        last.delayMs += delayMs;
        last.coalesced++;
        options.onProgress?.(i + 1, images.length);
        continue;
      }
      // Coalescing off: still nothing changed, so store the smallest legal
      // frame — one transparent pixel composited with OVER, which is a no-op.
      const rect: Rect = { x: 0, y: 0, w: 1, h: 1 };
      const blank = Uint8Array.from(maskFill);
      const encoded = await encodeRect(blank, rect, palette, filter, effort, deflate);
      pending.push({
        rect, blend: 'over', filter: encoded.filter, payload: encoded.payload,
        changed: 0, delayMs, coalesced: 0, sourceIndex: i,
      });
      options.onProgress?.(i + 1, images.length);
      continue;
    }

    const { rect } = diff;
    // OVER only reproduces its source where that source is fully opaque, so it
    // is legal exactly when every changed pixel is opaque. Frame 0 is the PNG's
    // own image and is always stored whole.
    const overLegal = i > 0 && diff.opaque;

    const blends: Array<'source' | 'over'> = [];
    if (overLegal) blends.push('over');
    if (!overLegal || effort === 'best') blends.push('source');

    let chosen: PendingFrame | undefined;
    for (const blend of blends) {
      const payloadRgba = blend === 'over'
        ? cropRectMasked(canvas, image, width, rect, diffOptions, maskFill)
        : cropRect(image, width, rect);
      const encoded = await encodeRect(payloadRgba, rect, palette, filter, effort, deflate);
      if (!chosen || encoded.payload.length < chosen.payload.length) {
        chosen = {
          rect, blend, filter: encoded.filter, payload: encoded.payload,
          changed: diff.changed, delayMs, coalesced: 0, sourceIndex: i,
        };
      }
    }
    if (!chosen) throw new Error(`internal: frame ${i} produced no encoding`);
    pending.push(chosen);

    // Advance the canvas the way a decoder would, so the next frame diffs
    // against what will actually be on screen.
    const shown = chosen.blend === 'over'
      ? cropRectMasked(canvas, image, width, rect, diffOptions, maskFill)
      : cropRect(image, width, rect);
    composite(canvas, width, rect, shown, chosen.blend);
    options.onProgress?.(i + 1, images.length);
  }

  // -- Assemble ---------------------------------------------------------------

  const parts: Uint8Array[] = [PNG_SIGNATURE, ihdr(width, height, palette ? 3 : 6)];
  if (palette) parts.push(...plteChunks(palette));
  parts.push(actl(pending.length, loops));

  const stats: ApngFrameStat[] = [];
  let seq = 0;
  for (let i = 0; i < pending.length; i++) {
    const f = pending[i];
    parts.push(fctl(seq++, f.rect, f.delayMs, i === 0 ? 'source' : f.blend));
    parts.push(i === 0 ? writeChunk('IDAT', f.payload) : fdat(seq++, f.payload));
    stats.push({
      index: i,
      sourceIndex: f.sourceIndex,
      rect: f.rect,
      blend: i === 0 ? 'source' : f.blend,
      filter: f.filter,
      bytes: f.payload.length,
      changed: f.changed,
      delayMs: f.delayMs,
      coalesced: f.coalesced,
    });
  }
  parts.push(writeChunk('IEND', new Uint8Array(0)));

  return {
    bytes: concatBytes(parts),
    width,
    height,
    frameCount: pending.length,
    sourceFrameCount: images.length,
    colorType: palette ? 'indexed' : 'rgba',
    paletteSize: palette ? palette.size : 0,
    frames: stats,
  };
}
