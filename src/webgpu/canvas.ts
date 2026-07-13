// Canvas backing-store sizing for HiDPI rendering. ~Every GPU scratchpad
// reimplements this device-pixel-ratio resize; it is backend-agnostic (plain
// WebGL or WebGPU).

/** Options for `resizeCanvasToDisplay`. */
export interface ResizeCanvasOptions {
  /** Clamp the device pixel ratio (default 2) so 3x/4x screens don't over-allocate. */
  maxDpr?: number;
  /** Round the backing-store dimensions to a multiple of this many pixels (default 1). */
  roundTo?: number;
}

/**
 * Size a canvas's backing store (`canvas.width`/`height`) to its CSS display size
 * times the (clamped) device pixel ratio. Returns `true` if the size changed, so
 * callers can reconfigure the swap chain / depth buffer only when needed. A
 * minimum of 1x1 is enforced.
 */
export function resizeCanvasToDisplay(canvas: HTMLCanvasElement, options: ResizeCanvasOptions = {}): boolean {
  const { maxDpr = 2, roundTo = 1 } = options;
  const dpr = Math.min(maxDpr, globalThis.devicePixelRatio || 1);
  const step = Math.max(1, Math.floor(roundTo));
  const round = (n: number) => Math.max(step, Math.round(n / step) * step);
  const w = round(canvas.clientWidth * dpr);
  const h = round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}
