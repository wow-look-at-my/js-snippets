// Tests for the arbitrary-dimension vector utilities.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  create,
  clone,
  add,
  subtract,
  multiply,
  scale,
  negate,
  dot,
  length,
  lengthSq,
  distance,
  normalize,
  lerp,
  sum,
  mean,
} from './vecn.ts';

test('create fills n components and rejects a bad n', () => {
  assert.deepEqual(create(3), [0, 0, 0]);
  assert.deepEqual(create(2, 7), [7, 7]);
  assert.deepEqual(create(0), []);
  assert.throws(() => create(-1), RangeError);
  assert.throws(() => create(1.5), RangeError);
});

test('clone copies rather than aliases', () => {
  const v = [1, 2, 3];
  const c = clone(v);
  c[0] = 99;
  assert.deepEqual(v, [1, 2, 3]);
});

test('componentwise operations', () => {
  assert.deepEqual(add([1, 2, 3, 4], [10, 20, 30, 40]), [11, 22, 33, 44]);
  assert.deepEqual(subtract([10, 20], [1, 2]), [9, 18]);
  assert.deepEqual(multiply([2, 3, 4], [5, 6, 7]), [10, 18, 28]);
  assert.deepEqual(scale([1, 2, 3], -2), [-2, -4, -6]);
  assert.deepEqual(negate([1, -2, 0]), [-1, 2, -0]);
});

test('operations do not mutate their arguments', () => {
  const a = [1, 2, 3];
  const b = [4, 5, 6];
  add(a, b);
  subtract(a, b);
  lerp(a, b, 0.5);
  assert.deepEqual(a, [1, 2, 3]);
  assert.deepEqual(b, [4, 5, 6]);
});

test('a length mismatch throws instead of picking the shorter vector', () => {
  assert.throws(() => add([1, 2], [1, 2, 3]), RangeError);
  assert.throws(() => subtract([1], []), RangeError);
  assert.throws(() => multiply([1], [1, 2]), RangeError);
  assert.throws(() => dot([1, 2, 3], [1, 2]), RangeError);
  assert.throws(() => distance([1], [1, 2]), RangeError);
  assert.throws(() => lerp([1], [1, 2], 0.5), RangeError);
});

test('dot, length and lengthSq', () => {
  assert.equal(dot([1, 2, 3, 4], [1, 1, 1, 1]), 10);
  assert.equal(length([1, 1, 1, 1]), 2);
  assert.equal(lengthSq([1, 2, 3]), 14);
  assert.equal(length([]), 0);
  assert.equal(lengthSq([]), 0);
});

test('distance is the norm of the difference', () => {
  assert.equal(distance([0, 0, 0, 0], [1, 1, 1, 1]), 2);
  assert.equal(distance([3, 4], [0, 0]), 5);
});

test('normalize returns a unit vector and keeps a zero vector finite', () => {
  const n = normalize([0, 3, 4]);
  assert.ok(Math.abs(length(n) - 1) < 1e-12);
  assert.deepEqual(normalize([0, 0, 0]), [0, 0, 0]);
});

test('lerp interpolates and hits both endpoints', () => {
  assert.deepEqual(lerp([0, 0], [10, 20], 0), [0, 0]);
  assert.deepEqual(lerp([0, 0], [10, 20], 1), [10, 20]);
  assert.deepEqual(lerp([0, 0], [10, 20], 0.5), [5, 10]);
  // t outside [0,1] extrapolates rather than clamping.
  assert.deepEqual(lerp([0, 0], [10, 20], 2), [20, 40]);
});

test('sum adds every component', () => {
  assert.equal(sum([1, 2, 3, 4]), 10);
  assert.equal(sum([]), 0);
});

test('mean averages a list componentwise and rejects an empty list', () => {
  assert.deepEqual(mean([[1, 2], [3, 4], [5, 6]]), [3, 4]);
  assert.throws(() => mean([]), RangeError);
  assert.throws(() => mean([[1, 2], [3]]), RangeError);
});
