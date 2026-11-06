import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyWheelSource, newWheelState, WHEEL_BURST_GAP_MS } from './dag-view-math.ts';
import type { WheelSample, WheelSource } from './dag-view-math.ts';

function run(samples: WheelSample[]): WheelSource[] {
  let state = newWheelState();
  return samples.map((e) => {
    const out = classifyWheelSource(state, e);
    state = out.state;
    return out.source;
  });
}

const px = (deltaY: number, time: number, deltaX = 0): WheelSample => ({ deltaX, deltaY, deltaMode: 0, time });

test('a line or page delta is a mouse wheel', () => {
  assert.deepEqual(run([{ deltaX: 0, deltaY: 3, deltaMode: 1, time: 0 }]), ['mouse']);
  assert.deepEqual(run([{ deltaX: 0, deltaY: 1, deltaMode: 2, time: 0 }]), ['mouse']);
});

test('a run of identical large pixel notches is a mouse wheel', () => {
  assert.deepEqual(run([px(100, 0), px(100, 40), px(100, 80)]), ['mouse', 'mouse', 'mouse']);
  assert.deepEqual(run([px(-120, 0), px(-120, 30)]), ['mouse', 'mouse']);
});

test('a fractional delta or a sideways part is a trackpad', () => {
  assert.deepEqual(run([px(2.5, 0)]), ['trackpad']);
  assert.deepEqual(run([px(4, 0, 1)]), ['trackpad']);
  assert.deepEqual(run([px(0, 0, -6)]), ['trackpad']);
});

test('small integer deltas with no other signal are a trackpad', () => {
  assert.deepEqual(run([px(3, 0), px(5, 16), px(8, 32)]), ['trackpad', 'trackpad', 'trackpad']);
});

test('a gesture keeps the source its first telling event gave it', () => {
  // A trackpad flick that ends in large integer deltas stays a trackpad.
  assert.deepEqual(run([px(1.5, 0), px(60, 16), px(120, 32)]), ['trackpad', 'trackpad', 'trackpad']);
  // A mouse burst whose last event looks soft stays a mouse.
  assert.deepEqual(run([px(100, 0), px(3.25, 20)]), ['mouse', 'mouse']);
});

test('a pause starts a new gesture, classified afresh', () => {
  const later = WHEEL_BURST_GAP_MS + 1;
  assert.deepEqual(run([px(100, 0), px(2.5, later)]), ['mouse', 'trackpad']);
  assert.deepEqual(run([px(2.5, 0), px(100, later)]), ['trackpad', 'mouse']);
});
