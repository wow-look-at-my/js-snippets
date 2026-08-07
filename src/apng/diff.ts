// Inter-frame differencing for the APNG encoder: which pixels actually moved,
// the smallest rectangle that covers them, and the two ways to encode it.
// Pure — no DOM, no browser APIs.
//
// This is where an animated PNG's size is won or lost. A naive encoder stores
// every frame whole; storing only the changed rectangle, and inside it only the
// changed pixels, is usually an order of magnitude less data for screen capture
// or UI animation.
//
// THE COMPARISON IS AGAINST THE CANVAS, NOT THE PREVIOUS SOURCE FRAME. The
// caller keeps a canvas of what a decoder would be showing and diffs each new
// frame against that. With a non-zero threshold the two are not the same thing:
// sub-threshold differences are dropped, and comparing against the last source
// frame would let a slow drift accumulate silently, one tolerated step at a
// time, until the visible error is arbitrarily large.

/** A rectangle in pixels. `w`/`h` are always >= 1 on a returned diff. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What `diffFrames` found between a canvas and the next frame. */
export interface FrameDiff {
  /** Smallest rectangle covering every changed pixel. */
  rect: Rect;
  /** How many pixels inside `rect` are considered changed. */
  changed: number;
  /**
   * True when every changed pixel is fully opaque, which is what makes the
   * `over` encoding legal: an APNG frame composited with blend_op=OVER only
   * reproduces its source exactly where that source has alpha 255.
   */
  opaque: boolean;
}

/**
 * A pixel counts as changed when any colour channel moves by more than
 * `threshold`, or alpha by more than `alphaThreshold`.
 *
 * Both default to 2 — small enough that no one sees the difference in 8-bit
 * colour, large enough to absorb the ±1 noise that video decoding, camera
 * sensors, and repeated resampling sprinkle over otherwise identical frames.
 * That noise is what stops a dirty-rect encoder from finding anything static.
 * 0 makes the comparison exact and lossless.
 */
export interface DiffOptions {
  threshold?: number;
  alphaThreshold?: number;
}

/**
 * Diff `next` against `canvas` (both RGBA8, `width * height * 4` bytes).
 *
 * Returns null when nothing changed past the threshold — the caller should
 * then drop the frame and extend the previous frame's delay instead.
 */
export function diffFrames(
  canvas: Uint8Array,
  next: Uint8Array,
  width: number,
  height: number,
  options: DiffOptions = {},
): FrameDiff | null {
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
      if (
        (dr > t || dr < -t) ||
        (dg > t || dg < -t) ||
        (db > t || db < -t) ||
        (da > at || da < -at)
      ) {
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
    opaque,
  };
}

/** Copy `rect` out of an RGBA8 image as a tightly packed sub-image. */
export function cropRect(src: Uint8Array, width: number, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.w * rect.h * 4);
  const rowBytes = rect.w * 4;
  for (let y = 0; y < rect.h; y++) {
    const from = ((rect.y + y) * width + rect.x) * 4;
    out.set(src.subarray(from, from + rowBytes), y * rowBytes);
  }
  return out;
}

/**
 * Crop `rect` out of `next`, but write a fully transparent pixel wherever the
 * pixel did not change from `canvas`.
 *
 * This is the payload for a blend_op=OVER frame: the decoder leaves those
 * pixels alone, and the encoder gets long runs of one repeated value through
 * the middle of the rectangle instead of stale pixel data. Only valid when
 * every changed pixel is opaque (see `FrameDiff.opaque`).
 *
 * `fill` is the transparent RGBA to write, defaulting to transparent black. An
 * indexed encoder must pass the exact colour of its transparent palette entry:
 * any alpha-0 colour is equally invisible, but only one of them is in the
 * palette, and a colour that is not in the palette cannot be stored at all.
 */
export function cropRectMasked(
  canvas: Uint8Array,
  next: Uint8Array,
  width: number,
  rect: Rect,
  options: DiffOptions = {},
  fill: readonly number[] = [0, 0, 0, 0],
): Uint8Array {
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
      if (
        (dr > t || dr < -t) ||
        (dg > t || dg < -t) ||
        (db > t || db < -t) ||
        (da > at || da < -at)
      ) {
        out[o] = next[i];
        out[o + 1] = next[i + 1];
        out[o + 2] = next[i + 2];
        out[o + 3] = next[i + 3];
      }
    }
  }
  return out;
}

/**
 * Advance the canvas the way a decoder would when it composites `payload`
 * (a `rect`-sized RGBA8 sub-image) with the given blend op.
 *
 * `over` leaves the canvas alone where the payload is fully transparent;
 * `source` replaces the rectangle outright.
 */
export function composite(
  canvas: Uint8Array,
  width: number,
  rect: Rect,
  payload: Uint8Array,
  blend: 'over' | 'source',
): void {
  const rowBytes = rect.w * 4;
  if (blend === 'source') {
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
      // Non-premultiplied source-over, as the APNG spec spells it out.
      const da = canvas[i + 3];
      const oa = sa + Math.round((da * (255 - sa)) / 255);
      if (oa === 0) {
        canvas[i] = canvas[i + 1] = canvas[i + 2] = canvas[i + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) {
        const s = payload[o + c] * sa;
        const d = (canvas[i + c] * da * (255 - sa)) / 255;
        canvas[i + c] = Math.round((s + d) / oa);
      }
      canvas[i + 3] = oa;
    }
  }
}
