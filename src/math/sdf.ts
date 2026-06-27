// Pure signed-distance-field math -- no DOM, no WebGPU, no CDN imports.
//
// Signed-distance primitives, a column-major point transform, a CPU grid bake
// of an arbitrary scene SDF, trilinear sampling with a continuous outside-the-box
// extension, ray/AABB intersection, and the Inigo Quilez closest-approach soft
// shadow march. The same formulas are typically mirrored in a WGSL/GLSL shader;
// keep the GPU copies in sync with the math here.
//
// Conventions:
//  - Primitives are evaluated in their own local frame, centred at the origin,
//    Y up. Placement is a rigid transform (rotation + translation, no scale) so
//    the local distance is already a true world distance -- feed a world point
//    through the object's inverse model matrix with `transformPoint`.
//  - mat4 is column-major (the layout produced by ./mat4 and consumed by WGSL's
//    `mat4x4<f32>`): element (row r, col c) = m[c*4 + r].

import type { Vec3 } from './vec3.ts';

// -- Primitive type ids -- convenient when packing a scene description. ---------
export const SDF_SPHERE = 0;
export const SDF_BOX = 1;
export const SDF_CYLINDER = 2;
export const SDF_TORUS = 3;

/** A 4-component params vector; each primitive reads the components it needs. */
export type SdfParams = readonly [number, number, number, number];

// -- Primitive distance functions (local space) ------------------------------
// `params` is a 4-vector; each primitive reads the components it needs.

/** Signed distance to a sphere. params: [radius]. */
export function sdSphere(p: Vec3, params: SdfParams): number {
  return Math.hypot(p[0], p[1], p[2]) - params[0];
}

/** Signed distance to an axis-aligned box. params: [halfX, halfY, halfZ]. */
export function sdBox(p: Vec3, params: SdfParams): number {
  const qx = Math.abs(p[0]) - params[0];
  const qy = Math.abs(p[1]) - params[1];
  const qz = Math.abs(p[2]) - params[2];
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  const outside = Math.hypot(ox, oy, oz);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return outside + inside;
}

/** Signed distance to a Y-axis cylinder. params: [radius, halfHeight]. */
export function sdCylinder(p: Vec3, params: SdfParams): number {
  const dx = Math.hypot(p[0], p[2]) - params[0];
  const dy = Math.abs(p[1]) - params[1];
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ox, oy);
}

/** Signed distance to a torus whose ring lies in the XZ plane. params: [majorRadius, minorRadius]. */
export function sdTorus(p: Vec3, params: SdfParams): number {
  const qx = Math.hypot(p[0], p[2]) - params[0];
  return Math.hypot(qx, p[1]) - params[1];
}

/** Dispatch a primitive by its SDF_* type id. */
export function primitiveSDF(type: number, p: Vec3, params: SdfParams): number {
  switch (type) {
    case SDF_SPHERE: return sdSphere(p, params);
    case SDF_BOX: return sdBox(p, params);
    case SDF_CYLINDER: return sdCylinder(p, params);
    case SDF_TORUS: return sdTorus(p, params);
    default: return 1e9;
  }
}

// -- Transforms --------------------------------------------------------------

/** Transform a point by a column-major affine mat4 (w = 1). Returns a new Vec3. */
export function transformPoint(m: ArrayLike<number>, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// -- Baked grid ---------------------------------------------------------------

/** A baked dense SDF grid: voxel-centre, world-space distance samples. */
export interface SdfGrid {
  data: Float32Array;
  dims: readonly [number, number, number];
  volMin: Vec3;
  volMax: Vec3;
}

/** A scene distance field as a plain callback: world (x,y,z) -> signed distance. */
export type SceneSDF = (x: number, y: number, z: number) => number;

/**
 * Bake an arbitrary scene SDF into a dense grid (voxel-centre samples,
 * world-space distance). `scene(x,y,z)` returns the signed distance at a world
 * point -- compose it from the primitives above (and `transformPoint`) however
 * you like; this stays demo-agnostic. The bake is a one-time CPU cost before the
 * field is uploaded to a 3D texture.
 */
export function makeGrid(
  scene: SceneSDF,
  volMin: Vec3,
  volMax: Vec3,
  dims: readonly [number, number, number],
): SdfGrid {
  const [nx, ny, nz] = dims;
  const data = new Float32Array(nx * ny * nz);
  const ex = volMax[0] - volMin[0], ey = volMax[1] - volMin[1], ez = volMax[2] - volMin[2];
  for (let z = 0; z < nz; z++) {
    const wz = volMin[2] + (z + 0.5) / nz * ez;
    for (let y = 0; y < ny; y++) {
      const wy = volMin[1] + (y + 0.5) / ny * ey;
      const row = (z * ny + y) * nx;
      for (let x = 0; x < nx; x++) {
        const wx = volMin[0] + (x + 0.5) / nx * ex;
        data[row + x] = scene(wx, wy, wz);
      }
    }
  }
  return { data, dims, volMin, volMax };
}

function loadTexel(grid: SdfGrid, ix: number, iy: number, iz: number): number {
  const [nx, ny, nz] = grid.dims;
  const cx = Math.min(Math.max(ix, 0), nx - 1);
  const cy = Math.min(Math.max(iy, 0), ny - 1);
  const cz = Math.min(Math.max(iz, 0), nz - 1);
  return grid.data[(cz * ny + cy) * nx + cx];
}

/** Trilinear fetch at a clamped [0,1] coordinate (texel-centre convention). */
export function trilinear(grid: SdfGrid, q: Vec3): number {
  const [nx, ny, nz] = grid.dims;
  const gx = q[0] * nx - 0.5, gy = q[1] * ny - 0.5, gz = q[2] * nz - 0.5;
  const bx = Math.floor(gx), by = Math.floor(gy), bz = Math.floor(gz);
  const fx = gx - bx, fy = gy - by, fz = gz - bz;
  const c000 = loadTexel(grid, bx, by, bz);
  const c100 = loadTexel(grid, bx + 1, by, bz);
  const c010 = loadTexel(grid, bx, by + 1, bz);
  const c110 = loadTexel(grid, bx + 1, by + 1, bz);
  const c001 = loadTexel(grid, bx, by, bz + 1);
  const c101 = loadTexel(grid, bx + 1, by, bz + 1);
  const c011 = loadTexel(grid, bx, by + 1, bz + 1);
  const c111 = loadTexel(grid, bx + 1, by + 1, bz + 1);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(c000, c100, fx), x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx), x11 = lerp(c011, c111, fx);
  const y0 = lerp(x00, x10, fy), y1 = lerp(x01, x11, fy);
  return lerp(y0, y1, fz);
}

/**
 * Sample the baked field at a world point, with the safe outside extension.
 * Inside the volume the trilinear value is returned verbatim (it may be negative,
 * inside an object). Outside, returns max(edgeValue, distanceToBox): continuous
 * at the face (dOut = 0 there) and never spuriously small, so a ray leaving the
 * volume is never falsely shadowed.
 */
export function sampleGrid(grid: SdfGrid, p: Vec3): number {
  const { volMin, volMax } = grid;
  const ext: Vec3 = [volMax[0] - volMin[0], volMax[1] - volMin[1], volMax[2] - volMin[2]];
  const q: Vec3 = [
    (p[0] - volMin[0]) / ext[0],
    (p[1] - volMin[1]) / ext[1],
    (p[2] - volMin[2]) / ext[2],
  ];
  const inside = q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1 && q[2] >= 0 && q[2] <= 1;
  const cq: Vec3 = [
    Math.min(Math.max(q[0], 0), 1),
    Math.min(Math.max(q[1], 0), 1),
    Math.min(Math.max(q[2], 0), 1),
  ];
  const dIn = trilinear(grid, cq);
  if (inside) return dIn;
  const dOut = Math.hypot(
    Math.max(volMin[0] - p[0], p[0] - volMax[0], 0),
    Math.max(volMin[1] - p[1], p[1] - volMax[1], 0),
    Math.max(volMin[2] - p[2], p[2] - volMax[2], 0),
  );
  return Math.max(dIn, dOut);
}

// -- Ray / box intersection --------------------------------------------------

/**
 * Slab ray/AABB test. Returns [tNear, tFar]; the ray misses the box when
 * tFar < max(tNear, 0).
 */
export function intersectAABB(ro: Vec3, rd: Vec3, bmin: Vec3, bmax: Vec3): [number, number] {
  const inv: Vec3 = [1 / rd[0], 1 / rd[1], 1 / rd[2]];
  const t0: Vec3 = [(bmin[0] - ro[0]) * inv[0], (bmin[1] - ro[1]) * inv[1], (bmin[2] - ro[2]) * inv[2]];
  const t1: Vec3 = [(bmax[0] - ro[0]) * inv[0], (bmax[1] - ro[1]) * inv[1], (bmax[2] - ro[2]) * inv[2]];
  const ts: Vec3 = [Math.min(t0[0], t1[0]), Math.min(t0[1], t1[1]), Math.min(t0[2], t1[2])];
  const tb: Vec3 = [Math.max(t0[0], t1[0]), Math.max(t0[1], t1[1]), Math.max(t0[2], t1[2])];
  return [Math.max(ts[0], ts[1], ts[2]), Math.min(tb[0], tb[1], tb[2])];
}

// -- Soft shadow march (Inigo Quilez closest-approach penumbra) --------------

/** Optional clip box for `softShadow`. */
export interface SdfAabb {
  min: Vec3;
  max: Vec3;
}

/** Options for `softShadow`. */
export interface SoftShadowOptions {
  /** Start of the march (avoids self-shadow at the surface). Default 0.02. */
  tmin?: number;
  /** End of the march. Default 20. */
  tmax?: number;
  /** Penumbra sharpness -- large k = sharp, small k = soft. Default 16. */
  k?: number;
  /** Maximum step count. Default 64. */
  maxSteps?: number;
  /** Minimum advance per step. Default 0.01. */
  minStep?: number;
  /** Maximum advance per step. Default 5. */
  maxStep?: number;
  /** Distance below which the ray is considered fully occluded. Default 1e-3. */
  eps?: number;
  /** Clip the march to this box; a ray that misses it returns fully lit. Default none. */
  aabb?: SdfAabb | null;
}

/** Result of a `softShadow` march. */
export interface SoftShadowResult {
  /** Soft visibility in [0,1] (0 = fully shadowed, 1 = fully lit). */
  vis: number;
  /** Number of field samples taken (for cost visualisation). */
  steps: number;
}

/**
 * March from `ro` toward a light along unit `rd`, returning soft visibility in
 * [0,1] and the number of steps taken. `sampleFn(p)` returns the scene SDF at a
 * point. res = min(res, k*h/t): the closest the ray passes to the surface, scaled
 * by k, is the penumbra.
 *
 * If `aabb` is given, the march is clipped to that box and a ray that misses it
 * returns fully lit at zero cost. When the field has no occluder outside the
 * volume this is correctness-preserving, and it keeps large receivers cheap.
 */
export function softShadow(
  sampleFn: (p: Vec3) => number,
  ro: Vec3,
  rd: Vec3,
  opts: SoftShadowOptions = {},
): SoftShadowResult {
  const {
    tmin = 0.02, tmax = 20, k = 16, maxSteps = 64,
    minStep = 0.01, maxStep = 5, eps = 1e-3, aabb = null,
  } = opts;
  let lo = tmin, hi = tmax;
  if (aabb) {
    const [tn, tf] = intersectAABB(ro, rd, aabb.min, aabb.max);
    const tEnter = Math.max(tn, 0);
    if (tf <= tEnter) return { vis: 1, steps: 0 };
    lo = Math.max(tmin, tEnter);
    hi = Math.min(tmax, tf);
    if (hi <= lo) return { vis: 1, steps: 0 };
  }
  let res = 1;
  let t = lo;
  let steps = 0;
  for (let i = 0; i < maxSteps; i++) {
    if (t >= hi) break;
    const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const h = sampleFn(p);
    steps++;
    if (h < eps) { res = 0; break; }
    res = Math.min(res, (k * h) / t);
    t += Math.min(Math.max(h, minStep), maxStep);
  }
  return { vis: Math.min(Math.max(res, 0), 1), steps };
}
