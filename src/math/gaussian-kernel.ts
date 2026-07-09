// Separable Gaussian blur kernel builder (linear-sampling). Pure math, no
// browser APIs.
//
// Produces a *linear-sampling* kernel: adjacent tap pairs are merged into a
// single bilinear fetch at a fractional texel offset, which halves the number of
// texture samples a blur shader has to issue while reproducing the exact
// discrete Gaussian (a texture's linear filter does the in-between blend for
// free).
//
// Returned `entries` are [offsetInTexels, weight] pairs:
//   - entries[0] is the centre tap: offset 0, sampled once.
//   - entries[1..] are side taps: the shader samples BOTH +offset and -offset
//     and scales each by `weight` (the kernel is symmetric).
//
// Effective integer-tap weights therefore sum to exactly 1:
//   weight[0] + 2 * sum(side weights) === 1.

/** Maximum kernel radius (in texels) `buildGaussianKernel` will return. */
export const MAX_RADIUS = 192;

/** A linear-sampling Gaussian kernel. */
export interface GaussianKernel {
  /** The clamped sigma actually used (>= 1e-3). */
  sigma: number;
  /** Discrete radius in texels (1 .. MAX_RADIUS). */
  radius: number;
  /** Per-integer-tap weights `weights[k]` for k in 0..radius (two-sided sum = 1). */
  weights: number[];
  /** Merged bilinear taps as [offsetInTexels, weight] pairs (entry 0 is the centre). */
  entries: [number, number][];
}

/** Build a linear-sampling separable Gaussian kernel for the given sigma. */
export function buildGaussianKernel(sigma: number): GaussianKernel {
  const s = Math.max(sigma, 1e-3);
  const radius = Math.max(1, Math.min(MAX_RADIUS, Math.ceil(s * 3)));

  // Discrete Gaussian, normalised so the full (two-sided) tap set sums to 1.
  const g = new Array<number>(radius + 1);
  let total = 0;
  for (let k = 0; k <= radius; k++) {
    g[k] = Math.exp(-(k * k) / (2 * s * s));
    total += k === 0 ? g[k] : 2 * g[k];
  }
  for (let k = 0; k <= radius; k++) g[k] /= total;

  // Centre tap (sampled once).
  const entries: [number, number][] = [[0, g[0]]];

  // Merge (k, k+1) pairs into one bilinear fetch; carry an odd leftover alone.
  let k = 1;
  while (k <= radius) {
    if (k + 1 <= radius) {
      const w1 = g[k];
      const w2 = g[k + 1];
      const wc = w1 + w2;
      const oc = (k * w1 + (k + 1) * w2) / wc; // lies in (k, k+1)
      entries.push([oc, wc]);
      k += 2;
    } else {
      entries.push([k, g[k]]); // odd tap at the rim, no partner
      k += 1;
    }
  }

  return { sigma: s, radius, weights: g, entries };
}
