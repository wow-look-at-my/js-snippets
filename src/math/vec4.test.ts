// Tests for the minimal vec4 utilities. All functions return new arrays.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  create,
  add,
  subtract,
  scale,
  dot,
  length,
  normalize,
  fromVec3,
  toVec3,
  project,
} from './vec4.ts';
import type { Vec4 } from './vec4.ts';

test('create defaults to all zeros and copies components', () => {
  assert.deepEqual(create(), [0, 0, 0, 0]);
  assert.deepEqual(create(1, 2, 3, 4), [1, 2, 3, 4]);
});

test('add / subtract are componentwise', () => {
  assert.deepEqual(add([1, 2, 3, 4], [5, 6, 7, 8]), [6, 8, 10, 12]);
  assert.deepEqual(subtract([5, 6, 7, 8], [1, 2, 3, 4]), [4, 4, 4, 4]);
});

test('add does not mutate its arguments', () => {
  const a: Vec4 = [1, 2, 3, 4];
  const b: Vec4 = [5, 6, 7, 8];
  add(a, b);
  assert.deepEqual(a, [1, 2, 3, 4]);
  assert.deepEqual(b, [5, 6, 7, 8]);
});

test('scale multiplies every component', () => {
  assert.deepEqual(scale([1, -2, 3, -4], 2), [2, -4, 6, -8]);
  assert.deepEqual(scale([1, 2, 3, 4], 0), [0, 0, 0, 0]);
});

test('dot product', () => {
  assert.equal(dot([1, 2, 3, 4], [5, 6, 7, 8]), 5 + 12 + 21 + 32);
  assert.equal(dot([1, 0, 0, 0], [0, 1, 0, 0]), 0);
});

test('length is the Euclidean norm', () => {
  assert.equal(length([1, 1, 1, 1]), 2);
  assert.equal(length([0, 0, 0, 0]), 0);
  assert.equal(length([3, 4, 0, 0]), 5);
});

test('normalize returns a unit vector', () => {
  const n = normalize([1, 1, 1, 1]);
  assert.ok(Math.abs(length(n) - 1) < 1e-12);
  assert.ok(n.every((c) => Math.abs(c - 0.5) < 1e-12));
});

test('normalize guards the zero vector (no NaN / divide-by-zero)', () => {
  const n = normalize([0, 0, 0, 0]);
  assert.deepEqual(n, [0, 0, 0, 0]);
  assert.ok(n.every((c) => Number.isFinite(c)));
});

test('fromVec3 defaults to a point (w = 1) and takes an explicit w', () => {
  assert.deepEqual(fromVec3([1, 2, 3]), [1, 2, 3, 1]);
  assert.deepEqual(fromVec3([1, 2, 3], 0), [1, 2, 3, 0]);
});

test('toVec3 truncates and never divides', () => {
  assert.deepEqual(toVec3([2, 4, 6, 2]), [2, 4, 6]);
});

test('project divides by w', () => {
  assert.deepEqual(project([2, 4, 6, 2]), [1, 2, 3]);
  // w = 0 is a direction: the components pass through unchanged.
  assert.deepEqual(project([1, 2, 3, 0]), [1, 2, 3]);
});
