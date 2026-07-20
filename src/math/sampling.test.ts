// Tests for the low-discrepancy + hemisphere sampling helpers.
//
// Asserts: radicalInverse2 known bit-reversal values, hammersley(0,n) == [0,0]
// and components in [0,1), and that uniformHemisphere / cosineHemisphere return
// unit-length vectors on the +Z hemisphere (z >= 0).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { radicalInverse2, hammersley, uniformHemisphere, cosineHemisphere } from './sampling.ts';

const len = (v: [number, number, number]): number => Math.hypot(v[0], v[1], v[2]);

test('radicalInverse2 matches known base-2 van der Corput values', () => {
  assert.equal(radicalInverse2(0), 0);
  assert.equal(radicalInverse2(1), 0.5);
  assert.equal(radicalInverse2(2), 0.25);
  assert.equal(radicalInverse2(3), 0.75);
  assert.equal(radicalInverse2(4), 0.125);
  assert.equal(radicalInverse2(8), 0.0625);
});

test('radicalInverse2 outputs lie in [0, 1)', () => {
  for (let i = 0; i < 1024; i++) {
    const v = radicalInverse2(i);
    assert.ok(v >= 0 && v < 1, `radicalInverse2(${i}) = ${v}`);
  }
});

test('hammersley(0, n) == [0, 0] and components stay in [0, 1)', () => {
  assert.deepEqual(hammersley(0, 16), [0, 0]);
  const n = 64;
  for (let i = 0; i < n; i++) {
    const [a, b] = hammersley(i, n);
    assert.equal(a, i / n);
    assert.ok(a >= 0 && a < 1, `hammersley x: ${a}`);
    assert.ok(b >= 0 && b < 1, `hammersley y: ${b}`);
  }
});

test('hammersley second component is radicalInverse2(i)', () => {
  for (let i = 0; i < 32; i++) {
    assert.equal(hammersley(i, 32)[1], radicalInverse2(i));
  }
});

test('uniformHemisphere returns unit-length vectors with z >= 0', () => {
  const n = 256;
  for (let i = 0; i < n; i++) {
    const [u, v] = hammersley(i, n);
    const d = uniformHemisphere(u, v);
    assert.ok(Math.abs(len(d) - 1) < 1e-9, `not unit length: ${len(d)}`);
    assert.ok(d[2] >= 0, `z must be >= 0: ${d[2]}`);
  }
});

test('uniformHemisphere maps u=1 to the pole (+Z) and u=0 to the equator', () => {
  const pole = uniformHemisphere(1, 0.3);
  assert.ok(Math.abs(pole[2] - 1) < 1e-9, `pole z = ${pole[2]}`);
  const equator = uniformHemisphere(0, 0.0);
  assert.ok(Math.abs(equator[2]) < 1e-9, `equator z = ${equator[2]}`);
  assert.ok(Math.abs(len(equator) - 1) < 1e-9);
});

test('cosineHemisphere returns unit-length vectors with z >= 0', () => {
  const n = 256;
  for (let i = 0; i < n; i++) {
    const [u, v] = hammersley(i, n);
    const d = cosineHemisphere(u, v);
    assert.ok(Math.abs(len(d) - 1) < 1e-9, `not unit length: ${len(d)}`);
    assert.ok(d[2] >= 0, `z must be >= 0: ${d[2]}`);
  }
});

test('cosineHemisphere maps u=0 to the pole (+Z)', () => {
  // r = sqrt(0) = 0, so the direction is straight up.
  const pole = cosineHemisphere(0, 0.7);
  assert.ok(Math.abs(pole[2] - 1) < 1e-9, `pole z = ${pole[2]}`);
});
