// Tests for the minimal vec2 utilities. All functions return new arrays.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { create, add, subtract, scale, dot, cross, perp, length, normalize } from './vec2.ts';
import type { Vec2 } from './vec2.ts';

test('create defaults to the origin and copies components', () => {
  assert.deepEqual(create(), [0, 0]);
  assert.deepEqual(create(1, 2), [1, 2]);
});

test('add / subtract are componentwise', () => {
  assert.deepEqual(add([1, 2], [3, 4]), [4, 6]);
  assert.deepEqual(subtract([3, 4], [1, 2]), [2, 2]);
});

test('add does not mutate its arguments', () => {
  const a: Vec2 = [1, 2];
  const b: Vec2 = [3, 4];
  add(a, b);
  assert.deepEqual(a, [1, 2]);
  assert.deepEqual(b, [3, 4]);
});

test('scale multiplies every component', () => {
  assert.deepEqual(scale([1, -2], 3), [3, -6]);
  assert.deepEqual(scale([1, 2], 0), [0, 0]);
});

test('dot product', () => {
  assert.equal(dot([1, 2], [3, 4]), 3 + 8);
  assert.equal(dot([1, 0], [0, 1]), 0);
});

test('cross is the signed z of the 3D cross product', () => {
  // x cross y is +z, and the reverse is -z.
  assert.equal(cross([1, 0], [0, 1]), 1);
  assert.equal(cross([0, 1], [1, 0]), -1);
  // A vector crossed with itself is zero.
  assert.equal(cross([2, 3], [2, 3]), 0);
  // The magnitude is the parallelogram area.
  assert.equal(cross([3, 0], [0, 2]), 6);
});

test('perp turns a quarter turn counter-clockwise and stays orthogonal', () => {
  assert.deepEqual(perp([1, 0]), [0, 1]);
  assert.deepEqual(perp([0, 1]), [-1, 0]);
  const v: Vec2 = [3, -4];
  assert.equal(dot(v, perp(v)), 0);
  assert.equal(length(perp(v)), length(v));
});

test('length is the Euclidean norm', () => {
  assert.equal(length([3, 4]), 5);
  assert.equal(length([0, 0]), 0);
});

test('normalize returns a unit vector', () => {
  const n = normalize([3, 4]);
  assert.ok(Math.abs(length(n) - 1) < 1e-12);
  assert.ok(Math.abs(n[0] - 0.6) < 1e-12);
  assert.ok(Math.abs(n[1] - 0.8) < 1e-12);
});

test('normalize guards the zero vector (no NaN / divide-by-zero)', () => {
  const n = normalize([0, 0]);
  assert.deepEqual(n, [0, 0]);
  assert.ok(n.every((c) => Number.isFinite(c)));
});
