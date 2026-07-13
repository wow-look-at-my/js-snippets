// Tests for the minimal vec3 utilities. All functions return new arrays.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { create, add, subtract, scale, dot, cross, length, normalize } from './vec3.ts';
import type { Vec3 } from './vec3.ts';

test('create defaults to the origin and copies components', () => {
  assert.deepEqual(create(), [0, 0, 0]);
  assert.deepEqual(create(1, 2, 3), [1, 2, 3]);
});

test('add / subtract are componentwise', () => {
  assert.deepEqual(add([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
  assert.deepEqual(subtract([4, 5, 6], [1, 2, 3]), [3, 3, 3]);
});

test('add does not mutate its arguments', () => {
  const a: Vec3 = [1, 2, 3];
  const b: Vec3 = [4, 5, 6];
  add(a, b);
  assert.deepEqual(a, [1, 2, 3]);
  assert.deepEqual(b, [4, 5, 6]);
});

test('scale multiplies every component', () => {
  assert.deepEqual(scale([1, -2, 3], 2), [2, -4, 6]);
  assert.deepEqual(scale([1, 2, 3], 0), [0, 0, 0]);
});

test('dot product', () => {
  assert.equal(dot([1, 2, 3], [4, 5, 6]), 4 + 10 + 18);
  // Orthogonal axes have zero dot product.
  assert.equal(dot([1, 0, 0], [0, 1, 0]), 0);
});

test('cross product obeys the right-hand rule', () => {
  // x cross y = z, y cross z = x, z cross x = y.
  assert.deepEqual(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.deepEqual(cross([0, 1, 0], [0, 0, 1]), [1, 0, 0]);
  assert.deepEqual(cross([0, 0, 1], [1, 0, 0]), [0, 1, 0]);
  // Anti-commutative: a x b == -(b x a).
  assert.deepEqual(cross([0, 1, 0], [1, 0, 0]), [0, 0, -1]);
  // A vector crossed with itself is zero.
  assert.deepEqual(cross([2, 3, 4], [2, 3, 4]), [0, 0, 0]);
});

test('cross result is orthogonal to both inputs', () => {
  const a: Vec3 = [1, 2, 3];
  const b: Vec3 = [-2, 0, 5];
  const c = cross(a, b);
  assert.ok(Math.abs(dot(c, a)) < 1e-12);
  assert.ok(Math.abs(dot(c, b)) < 1e-12);
});

test('length is the Euclidean norm', () => {
  assert.equal(length([3, 4, 0]), 5);
  assert.equal(length([0, 0, 0]), 0);
  assert.ok(Math.abs(length([1, 2, 2]) - 3) < 1e-12);
});

test('normalize returns a unit vector', () => {
  const n = normalize([3, 4, 0]);
  assert.ok(Math.abs(length(n) - 1) < 1e-12);
  assert.ok(Math.abs(n[0] - 0.6) < 1e-12);
  assert.ok(Math.abs(n[1] - 0.8) < 1e-12);
});

test('normalize guards the zero vector (no NaN / divide-by-zero)', () => {
  // The implementation falls back to a length of 1, so a zero vector stays zero.
  const n = normalize([0, 0, 0]);
  assert.deepEqual(n, [0, 0, 0]);
  assert.ok(n.every((c) => Number.isFinite(c)));
});
