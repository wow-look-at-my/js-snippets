import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseIndexArray } from './mesh.ts';

test('chooseIndexArray picks Uint16Array when every index fits 16 bits', () => {
  const out = chooseIndexArray([0, 1, 2, 2, 1, 3], 4);
  assert.ok(out instanceof Uint16Array);
  assert.deepEqual(Array.from(out), [0, 1, 2, 2, 1, 3]);
});

test('chooseIndexArray picks Uint16Array at the 65536-vertex boundary', () => {
  // Max valid index 65535 still fits in 16 bits.
  const out = chooseIndexArray([65535, 0, 1], 65536);
  assert.ok(out instanceof Uint16Array);
  assert.equal(out[0], 65535);
});

test('chooseIndexArray picks Uint32Array past the boundary', () => {
  const out = chooseIndexArray([65536, 0, 1], 65537);
  assert.ok(out instanceof Uint32Array);
  assert.equal(out[0], 65536);
});

test('chooseIndexArray returns typed inputs as-is (no copy)', () => {
  const u16 = new Uint16Array([1, 2, 3]);
  assert.equal(chooseIndexArray(u16, 100_000), u16, 'Uint16Array passes through even with a huge vertex count');
  const u32 = new Uint32Array([1, 2, 3]);
  assert.equal(chooseIndexArray(u32, 4), u32, 'Uint32Array passes through even with a tiny vertex count');
});
