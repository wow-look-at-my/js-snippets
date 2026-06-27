// Tests for the linear-sampling separable Gaussian kernel builder. Ported from
// the local-contrast scratchpad's smoke.mjs oracle (the kernel half; the remap
// half is scratchpad-specific and not part of this library).
//
// Verifies the kernel is unbiased: the merged bilinear taps expand back to the
// exact discrete Gaussian and the effective integer-tap weights sum to 1, plus
// the sigma edge cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildGaussianKernel, MAX_RADIUS } from './gaussian-kernel.ts';

const approx = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

// Expand the linear-sampling entries back to per-integer-texel weights. Each
// side entry (oc, wc) is a bilinear fetch at a fractional offset, sampled at
// BOTH +oc and -oc.
function expandToIntegerTaps(entries: [number, number][]): Map<number, number> {
  const eff = new Map<number, number>();
  const addw = (o: number, w: number): void => { eff.set(o, (eff.get(o) || 0) + w); };
  addw(0, entries[0][1]); // centre, once
  for (let i = 1; i < entries.length; i++) {
    const [oc, wc] = entries[i];
    const t1 = Math.floor(oc + 1e-9);
    const f = oc - t1;
    addw(t1, wc * (1 - f));
    addw(t1 + 1, wc * f);
    addw(-t1, wc * (1 - f));
    addw(-(t1 + 1), wc * f);
  }
  return eff;
}

for (const sigma of [1, 2, 4, 8, 16, 32, 64]) {
  test(`kernel (sigma=${sigma}): effective integer-tap weights sum to 1`, () => {
    const k = buildGaussianKernel(sigma);
    const eff = expandToIntegerTaps(k.entries);
    let sum = 0;
    for (const w of eff.values()) sum += w;
    assert.ok(approx(sum, 1, 1e-6), `sum=${sum}`);
  });

  test(`kernel (sigma=${sigma}): merged taps reconstruct the exact discrete Gaussian`, () => {
    const k = buildGaussianKernel(sigma);
    const R = k.radius;

    // Reference discrete Gaussian (two-sided, normalised to 1).
    const ref: number[] = [];
    let tot = 0;
    for (let m = 0; m <= R; m++) {
      ref[m] = Math.exp(-(m * m) / (2 * sigma * sigma));
      tot += m === 0 ? ref[m] : 2 * ref[m];
    }
    for (let m = 0; m <= R; m++) ref[m] /= tot;

    const eff = expandToIntegerTaps(k.entries);
    let maxErr = 0;
    for (let m = -R; m <= R; m++) {
      maxErr = Math.max(maxErr, Math.abs((eff.get(m) || 0) - ref[Math.abs(m)]));
    }
    assert.ok(maxErr < 1e-6, `maxErr=${maxErr}`);
  });
}

test('kernel weights array also sums (two-sided) to 1', () => {
  const k = buildGaussianKernel(5);
  let total = k.weights[0];
  for (let i = 1; i < k.weights.length; i++) total += 2 * k.weights[i];
  assert.ok(approx(total, 1, 1e-6), `two-sided weights sum=${total}`);
  assert.equal(k.weights.length, k.radius + 1);
});

test('radius is capped at MAX_RADIUS for a huge sigma', () => {
  assert.equal(buildGaussianKernel(10000).radius, MAX_RADIUS);
});

test('sigma is clamped to a positive floor and a tiny sigma still has a centre tap', () => {
  const k = buildGaussianKernel(0);
  assert.ok(k.sigma >= 1e-3, `clamped sigma = ${k.sigma}`);
  assert.ok(k.radius >= 1, `radius = ${k.radius}`);
  assert.ok(k.entries.length >= 1, 'has at least the centre tap');
  // The centre tap is at offset 0.
  assert.equal(k.entries[0][0], 0);
});

test('negative sigma is also clamped (no NaN weights)', () => {
  const k = buildGaussianKernel(-5);
  assert.ok(k.sigma >= 1e-3);
  assert.ok(k.weights.every((w) => Number.isFinite(w)));
});
