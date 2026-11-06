// Separable Gaussian blur kernel builder (linear-sampling). Pure math, no browser APIs.

/** Maximum kernel radius (in texels) `buildGaussianKernel` will return. */
export const MAX_RADIUS = 192;

/** A linear-sampling Gaussian kernel. */
export interface GaussianKernel {
  /** The clamped sigma actually used (>= 1e-3). */
  sigma: number;
  /*MAX_RADIUS). */
  radius: number;
  /* */
  weights: number[];
  /* */
  entries: [number, number][];
}

/** Build a linear-sampling separable Gaussian kernel for the given sigma. */
export function buildGaussianKernel(sigma: number): GaussianKernel {
  const s = Math.max(sigma, 1e-3);
  const radius = Math.max(1, Math.min(MAX_RADIUS, Math.ceil(s * 3)));

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
