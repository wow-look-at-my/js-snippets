// Turning drawable sources (an ImageBitmap decoded from a file, a video frame,
// a canvas) into the RGBA8 the encoder wants — on whichever thread calls it.
//
// This exists so a browser consumer never has to touch pixels on the main
// thread: hand `apng/worker.ts` ImageBitmaps and the rasterising happens beside
// the encoding, in the worker. Doing it in the page with drawImage +
// getImageData works, and it is exactly the kind of "just this bit" main-thread
// work that adds up to a janky UI for a long frame list.
//
// The fit maths is pure and lives here so it can be tested and reused; only
// `rasterizeToRgba` needs a canvas, and OffscreenCanvas gives it one in a
// worker.

/** How a source of one aspect ratio is placed into a canvas of another. */
export type FitMode = 'contain' | 'cover' | 'stretch';

/** A destination rectangle, in pixels, possibly extending past the canvas (cover). */
export interface FitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where to draw a `srcW`x`srcH` source inside a `dstW`x`dstH` canvas.
 *
 * 'contain' fits the whole source and centres it, leaving the rest of the
 * canvas untouched (transparent, for an APNG frame). 'cover' fills the canvas
 * and lets the overflow fall off the edges. 'stretch' ignores aspect ratio.
 */
export function fitRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  mode: FitMode = 'contain',
): FitRect {
  if (srcW <= 0 || srcH <= 0) throw new Error(`source size must be positive, got ${srcW}x${srcH}`);
  if (mode === 'stretch') return { x: 0, y: 0, w: dstW, h: dstH };
  const scaleX = dstW / srcW;
  const scaleY = dstH / srcH;
  const scale = mode === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/**
 * Scale `size` down so neither side exceeds `max`, keeping the aspect ratio.
 * Returns integers >= 1, and never scales up.
 */
export function clampSize(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error(`size must be positive, got ${width}x${height}`);
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Anything `drawImage` accepts that also carries its own dimensions. */
export interface RasterSource {
  width: number;
  height: number;
}

/**
 * Draw `source` into a `width`x`height` RGBA8 buffer.
 *
 * Runs wherever OffscreenCanvas does, which includes a worker. The canvas
 * starts transparent, so a 'contain' fit leaves transparent bars rather than
 * black ones — and an APNG stores those for free.
 */
export function rasterizeToRgba(
  source: CanvasImageSource & RasterSource,
  width: number,
  height: number,
  mode: FitMode = 'contain',
): Uint8ClampedArray {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('rasterizeToRgba needs OffscreenCanvas, which this environment does not have');
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('could not get a 2d context for rasterising');
  const rect = fitRect(source.width, source.height, width, height, mode);
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h);
  return ctx.getImageData(0, 0, width, height).data;
}
