import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePingPong } from './fbo.ts';

function fakeTarget(name: string) {
  return {
    name,
    resizes: [] as Array<[number, number]>,
    disposed: 0,
    resize(width: number, height: number) {
      this.resizes.push([width, height]);
    },
    dispose() {
      this.disposed++;
    },
  };
}

test('makePingPong starts with read = a, write = b', () => {
  const a = fakeTarget('a');
  const b = fakeTarget('b');
  const pp = makePingPong(a, b);
  assert.equal(pp.read, a);
  assert.equal(pp.write, b);
});

test('swap exchanges read and write; a second swap restores them', () => {
  const a = fakeTarget('a');
  const b = fakeTarget('b');
  const pp = makePingPong(a, b);
  pp.swap();
  assert.equal(pp.read, b);
  assert.equal(pp.write, a);
  pp.swap();
  assert.equal(pp.read, a);
  assert.equal(pp.write, b);
});

test('swap works when the method is detached from the pair', () => {
  const a = fakeTarget('a');
  const b = fakeTarget('b');
  const pp = makePingPong(a, b);
  const { swap } = pp;
  swap();
  assert.equal(pp.read, b);
  assert.equal(pp.write, a);
});

test('resize forwards to both targets with the same size', () => {
  const a = fakeTarget('a');
  const b = fakeTarget('b');
  const pp = makePingPong(a, b);
  pp.resize(64, 32);
  assert.deepEqual(a.resizes, [[64, 32]]);
  assert.deepEqual(b.resizes, [[64, 32]]);
});

test('dispose disposes both targets exactly once', () => {
  const a = fakeTarget('a');
  const b = fakeTarget('b');
  const pp = makePingPong(a, b);
  pp.swap(); // dispose must reach both regardless of swap state
  pp.dispose();
  assert.equal(a.disposed, 1);
  assert.equal(b.disposed, 1);
});
