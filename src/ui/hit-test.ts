/**
 * Pointer hit-testing primitives for canvas-painted components.
 *
 * A canvas has no DOM to hit-test against, so every component that paints
 * its own surface must answer "what is under the pointer?" itself. These are
 * the shapes that answer it. `<timeline-view>` and `<dag-view>` both use
 * them, which is why they live here and not inside either one.
 *
 * Coordinates are CSS px in whatever space the caller works in. The
 * functions do no transformation: a component with a viewport transform maps
 * the pointer into its own space first.
 */

/** An axis-aligned hit rectangle (CSS px). */
export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Widen a (possibly hairline) rect to at least `minW` px around its center —
 * instants get a hit target a few px larger than their visual so they stay
 * hoverable/clickable.
 */
export function expandHitRect(r: HitRect, minW: number): HitRect {
  if (r.w >= minW) return r;
  const cx = r.x + r.w / 2;
  return { x: cx - minW / 2, y: r.y, w: minW, h: r.h };
}

/**
 * Index of the TOPMOST (= last, matching paint order) rect containing the
 * point, or -1. Edges are inclusive.
 */
export function hitTestRects(x: number, y: number, rects: readonly HitRect[]): number {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

/** Squared distance from point p to segment ab. */
export function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** True when the point is within `tol` px of the polyline. */
export function hitTestPolyline(px: number, py: number, pts: readonly { x: number; y: number }[], tol: number): boolean {
  const t2 = tol * tol;
  for (let i = 1; i < pts.length; i++) {
    if (distSqToSegment(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= t2) return true;
  }
  return false;
}
