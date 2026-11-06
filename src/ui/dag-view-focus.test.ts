import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  smoothstep,
  lerp,
  focusOpacity,
  newFocusFade,
  focusTarget,
  stepFocusFade,
  FOCUS_RELEASE_MS,
} from './dag-view-math.ts';
import type { FocusFade } from './dag-view-math.ts';

test('smoothstep and lerp', () => {
  assert.equal(smoothstep(1, 2, 0.5), 0);
  assert.equal(smoothstep(1, 2, 1), 0);
  assert.equal(smoothstep(1, 2, 1.5), 0.5);
  assert.equal(smoothstep(1, 2, 2), 1);
  assert.equal(smoothstep(1, 2, 9), 1);
  assert.equal(lerp(1, 0.14, 0), 1);
  assert.equal(lerp(1, 0.14, 1), 0.14);
});

test('focusOpacity: max alpha up to 1 s, full dim from 2 s, and never rising between', () => {
  for (const t of [0, 0.3, 0.99, 1]) assert.equal(focusOpacity(t, 1, 0.14), 1);
  for (const t of [2, 2.5, 60]) assert.equal(focusOpacity(t, 1, 0.14), 0.14);
  let prev = Infinity;
  for (let t = 0; t <= 3; t += 0.01) {
    const o = focusOpacity(t, 1, 0.14);
    assert.ok(o <= prev + 1e-12, `not monotonic at ${t}`);
    prev = o;
  }
});

function at(state: FocusFade, now: number): FocusFade {
  return stepFocusFade(state, now).state;
}

test('hovering one node dims nothing for a second, then the rest dims over the next', () => {
  let s = focusTarget(newFocusFade(), 3, 1000);
  s = at(s, 1500);
  assert.equal(s.shown, 3);
  assert.equal(s.fade, 0);
  assert.equal(at(s, 2500).fade, 0.5);
  const full = stepFocusFade(s, 3200);
  assert.equal(full.state.fade, 1);
  assert.equal(full.moving, false, 'a settled fade asks for no more frames');
});

test('leaving fades back from where it was, over the release time, and never snaps', () => {
  let s = at(focusTarget(newFocusFade(), 3, 0), 2500);
  assert.equal(s.fade, 1);
  s = focusTarget(s, -1, 2500);
  const mid = stepFocusFade(s, 2500 + FOCUS_RELEASE_MS / 2);
  assert.equal(mid.state.shown, 3, 'the old focus stays drawn while it fades');
  assert.ok(mid.state.fade > 0.4 && mid.state.fade < 0.6);
  assert.equal(mid.moving, true);
  const done = stepFocusFade(s, 2500 + FOCUS_RELEASE_MS + 1);
  assert.equal(done.state.fade, 0);
  assert.equal(done.state.shown, -1);
  assert.equal(done.moving, false);
});

test('moving to another node releases the first, then counts the new hover from its start', () => {
  let s = at(focusTarget(newFocusFade(), 3, 0), 2500);
  s = focusTarget(s, 5, 2500);
  s = at(s, 2500 + FOCUS_RELEASE_MS + 1);
  assert.equal(s.shown, 5);
  assert.equal(s.fade, 0, 'the new node has been hovered for only a quarter second');
  assert.equal(at(s, 2500 + 1500).fade, 0.5);
});

test('coming back during a release keeps the fade from snapping to bright', () => {
  let s = at(focusTarget(newFocusFade(), 3, 0), 2500);
  s = focusTarget(s, -1, 2500);
  s = at(s, 2550);
  const before = s.fade;
  s = focusTarget(s, 3, 2550);
  const after = at(s, 2560).fade;
  assert.ok(before - after < 0.2, `fade dropped from ${before} to ${after}`);
});

test('the same target again keeps its hover time', () => {
  const s = focusTarget(newFocusFade(), 3, 0);
  assert.equal(focusTarget(s, 3, 900), s);
});
