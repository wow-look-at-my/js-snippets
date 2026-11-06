// Tests for ui/listener-watch.ts, on node's own EventTarget.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onFirstListener } from './listener-watch.ts';

test('onFirstListener: fires once, on the first listener of the watched type', () => {
  const target = new EventTarget();
  let calls = 0;
  onFirstListener(target, 'row-click', () => calls++);
  target.addEventListener('other', () => {});
  assert.equal(calls, 0);
  target.addEventListener('row-click', () => {});
  target.addEventListener('row-click', () => {});
  assert.equal(calls, 1);
});

test('onFirstListener: a null listener does not count', () => {
  const target = new EventTarget();
  let calls = 0;
  onFirstListener(target, 'row-click', () => calls++);
  target.addEventListener('row-click', null);
  assert.equal(calls, 0);
});

test('onFirstListener: the listener is still added and still receives events', () => {
  const target = new EventTarget();
  onFirstListener(target, 'ping', () => {});
  let got = 0;
  target.addEventListener('ping', () => got++);
  target.dispatchEvent(new Event('ping'));
  assert.equal(got, 1);
});
