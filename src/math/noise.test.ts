// Tests for the deterministic procedural noise (hash -> value noise -> fbm, 2D
// and 3D).
//
// Asserts: determinism (same input -> identical output), the documented [0,1)
// output range, byte-equivalence of the hash to specific known constants (so a
// silent change to the hash math is caught), 2D lattice tiling, and that fbm
// accumulates octaves (more octaves change the result; output stays normalised).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hash2, hash3, smootherstep, valueNoise2, valueNoise3, fbm2, fbm3, ridged2,
} from './noise.ts';

// ---- Determinism -----------------------------------------------------------

test('hash2 / hash3 are deterministic (same input -> identical output)', () => {
  assert.equal(hash2(7, 13, 32, 5), hash2(7, 13, 32, 5));
  assert.equal(hash3(7, 13, 21, 5), hash3(7, 13, 21, 5));
});

test('valueNoise / fbm are deterministic', () => {
  assert.equal(valueNoise2(0.31, 0.62, 8, 3), valueNoise2(0.31, 0.62, 8, 3));
  assert.equal(valueNoise3(1.5, 2.5, 3.5, 9), valueNoise3(1.5, 2.5, 3.5, 9));
  assert.equal(fbm2(0.4, 0.7, 4, 5, 1), fbm2(0.4, 0.7, 4, 5, 1));
  assert.equal(fbm3(0.4, 0.7, 0.9, 1, 5), fbm3(0.4, 0.7, 0.9, 1, 5));
});

// ---- Known hash constants (byte-equivalence to the source math) ------------

test('hash2 matches specific known constants', () => {
  // All-zero inputs hash to exactly 0.
  assert.equal(hash2(0, 0, 16, 0), 0);
  assert.equal(hash2(1, 2, 16, 7), 0.08902817570814588);
  assert.equal(hash2(3, 5, 8, 1), 0.5579161333287871);
});

test('hash3 matches specific known constants', () => {
  assert.equal(hash3(0, 0, 0, 0), 0);
  assert.equal(hash3(1, 2, 3, 4), 0.773636489873752);
  assert.equal(hash3(5, 6, 7, 0), 0.7271849496755749);
});

test('hash2 wraps lattice coords by the period (tileable)', () => {
  assert.equal(hash2(17, 0, 16, 0), hash2(1, 0, 16, 0));
  assert.equal(hash2(-1, 0, 16, 0), hash2(15, 0, 16, 0));
  assert.equal(hash2(0, 16, 16, 3), hash2(0, 0, 16, 3));
});

// ---- Output range ----------------------------------------------------------

test('hash2 / hash3 outputs lie in [0, 1)', () => {
  for (let i = 0; i < 500; i++) {
    const a = hash2(i * 7, i * 13 + 1, 64, i % 11);
    const b = hash3(i * 3, i * 5, i * 11, i % 7);
    assert.ok(a >= 0 && a < 1, `hash2 in range: ${a}`);
    assert.ok(b >= 0 && b < 1, `hash3 in range: ${b}`);
  }
});

test('valueNoise2 / valueNoise3 stay within [0, 1]', () => {
  for (let i = 0; i < 200; i++) {
    const u = i / 200, v = (i * 3 % 200) / 200;
    const a = valueNoise2(u, v, 8, 2);
    const b = valueNoise3(u * 5, v * 5, (i % 7), 2);
    assert.ok(a >= 0 && a <= 1, `valueNoise2 in range: ${a}`);
    assert.ok(b >= 0 && b <= 1, `valueNoise3 in range: ${b}`);
  }
});

test('fbm2 / fbm3 stay within [0, 1] (normalised back)', () => {
  for (let i = 0; i < 200; i++) {
    const u = i / 200, v = (i * 7 % 200) / 200;
    const a = fbm2(u, v, 4, 5, 1);
    const b = fbm3(u * 3, v * 3, i % 5, 1, 5);
    assert.ok(a >= 0 && a <= 1, `fbm2 in range: ${a}`);
    assert.ok(b >= 0 && b <= 1, `fbm3 in range: ${b}`);
  }
});

// ---- smootherstep ----------------------------------------------------------

test('smootherstep maps 0/0.5/1 to 0/0.5/1 (Perlin quintic)', () => {
  assert.equal(smootherstep(0), 0);
  assert.equal(smootherstep(1), 1);
  assert.ok(Math.abs(smootherstep(0.5) - 0.5) < 1e-12);
});

// ---- fbm octave accumulation ----------------------------------------------

test('fbm2 octave count changes the result (octaves accumulate detail)', () => {
  const one = fbm2(0.37, 0.59, 4, 1, 1);
  const four = fbm2(0.37, 0.59, 4, 4, 1);
  // With one octave fbm == the base value noise (single normalised octave).
  assert.ok(Math.abs(one - valueNoise2(0.37, 0.59, 4, 1)) < 1e-12, 'one octave == base noise');
  // Adding octaves changes the value (extra frequency content is folded in).
  assert.ok(Math.abs(four - one) > 1e-6, 'more octaves produce a different value');
});

test('fbm3 octave count changes the result', () => {
  const two = fbm3(0.4, 0.7, 0.9, 5, 2);
  const five = fbm3(0.4, 0.7, 0.9, 5, 5);
  assert.ok(Math.abs(five - two) > 1e-6, 'more octaves produce a different value');
});

// ---- ridged ----------------------------------------------------------------

test('ridged2 is deterministic and within [0, 1]', () => {
  assert.equal(ridged2(0.4, 0.7, 4, 5, 1), ridged2(0.4, 0.7, 4, 5, 1));
  for (let i = 0; i < 100; i++) {
    const r = ridged2(i / 100, (i * 3 % 100) / 100, 4, 4, 2);
    assert.ok(r >= 0 && r <= 1, `ridged2 in range: ${r}`);
  }
});
