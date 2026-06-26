// Low-discrepancy + hemisphere sampling. Pure, deterministic, no DOM.
//
// `radicalInverse2`/`hammersley` match the GPU convention this library already
// uses in webgpu/shaders/prefilter.wgsl (the Hammersley + GGX IBL prefilter), so
// the same sample index produces the same point on CPU and GPU.

import { Vec3 } from './vec3';

/**
 * Van der Corput radical inverse in base 2 (bit-reversal), in [0, 1).
 * `radicalInverse2(0) === 0`. Mirrors `radicalInverse` in prefilter.wgsl.
 */
export function radicalInverse2(i: number): number {
  let bits = i >>> 0;
  bits = (bits << 16) | (bits >>> 16);
  bits = ((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1);
  bits = ((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2);
  bits = ((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4);
  bits = ((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8);
  return (bits >>> 0) / 4294967296;
}

/**
 * The i-th of `n` points of the 2D Hammersley set: `[i / n, radicalInverse2(i)]`.
 * `hammersley(0, n) === [0, 0]`. Matches `hammersley` in prefilter.wgsl.
 */
export function hammersley(i: number, n: number): [number, number] {
  return [i / n, radicalInverse2(i)];
}

/**
 * A direction on the upper hemisphere (+Z), uniform over solid angle, from two
 * stratified samples `u, v` in [0, 1). `u` maps to cos(theta) (so the pole is at
 * u = 1), `v` to the azimuth. Returns a unit Vec3 with z >= 0.
 */
export function uniformHemisphere(u: number, v: number): Vec3 {
  const z = u;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const phi = 2 * Math.PI * v;
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

/**
 * A cosine-weighted direction on the upper hemisphere (+Z) via Malley's method,
 * from two samples `u, v` in [0, 1). `u` sets the radius (r = sqrt(u)), `v` the
 * azimuth. Returns a unit Vec3 with z >= 0; the density is proportional to z.
 */
export function cosineHemisphere(u: number, v: number): Vec3 {
  const r = Math.sqrt(u);
  const phi = 2 * Math.PI * v;
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - u))];
}
