// Deterministic procedural noise -- integer hash -> value noise -> fbm, in 2D
// and 3D. Pure functions, no DOM, no allocations in the hot path.

// -- 2D ------------------------------------------------------------------------

/*Lattice coords are wrapped by `period` so the noise tiles seamlessly at
 * that period. */
export function hash2(ix: number, iy: number, period: number, seed: number): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let h = (x * 374761393 + y * 668265263 + seed * 362437) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/* */
export function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/*Quintic interpolation. */
export function valueNoise2(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smootherstep(x - ix);
  const fy = smootherstep(y - iy);
  const a = hash2(ix, iy, cells, seed);
  const b = hash2(ix + 1, iy, cells, seed);
  const c = hash2(ix, iy + 1, cells, seed);
  const d = hash2(ix + 1, iy + 1, cells, seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/* */
export function fbm2(u: number, v: number, baseCells: number, octaves: number, seed: number): number {
  let sum = 0, amp = 1, norm = 0, cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2(u, v, cells, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    cells *= 2;
  }
  return sum / norm;
}

/* */
export function ridged2(u: number, v: number, baseCells: number, octaves: number, seed: number): number {
  const n = fbm2(u, v, baseCells, octaves, seed);
  const r = 1 - Math.abs(2 * n - 1);
  return r * r;
}

// -- 3D ------------------------------------------------------------------------

/* */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 1274126177 + (seed | 0) * 40503;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* */
function smooth3(t: number): number {
  return t * t * (3 - 2 * t);
}

/*Cubic interpolation. */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = smooth3(xf), v = smooth3(yf), w = smooth3(zf);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi, seed),         c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed),     c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed),     c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed), c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w,
  );
}

/* */
export function fbm3(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let f = 0, amp = 0.5, sum = 0, freq = 1;
  for (let o = 0; o < octaves; o++) {
    f += amp * valueNoise3(x * freq, y * freq, z * freq, seed + o * 97);
    sum += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return f / sum;
}
