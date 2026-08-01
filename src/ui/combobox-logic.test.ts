// Tests for the pure half of the combobox (ui/combobox-logic.ts): the
// activation gate (UA matching + force overrides), option-text extraction,
// enabled-option navigation, type-ahead matching, and the popup placement
// math. The DOM half (ui/combobox.ts — the popup, <combo-box>, select
// upgrading) needs a real browser and is not node-testable — see the Testing
// section in CLAUDE.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isBrokenDropdownUA,
  hasForceParam,
  shouldEnable,
  optionText,
  firstEnabledIndex,
  lastEnabledIndex,
  stepActiveIndex,
  typeAheadTarget,
  computePopupPlacement,
  type OptionLike,
  type PlacementInput,
} from './combobox-logic.ts';

// -- Activation gating ---------------------------------------------------------

const TESLA_UA =
  'Mozilla/5.0 (X11; GNU/Linux) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chromium/79.0.3945.130 Chrome/79.0.3945.130 Safari/537.36 Tesla/2020.16.2.1-e8b0f4a54b1f';
const QT_CAR_UA =
  'Mozilla/5.0 (X11; Linux) AppleWebKit/534.34 (KHTML, like Gecko) QtCarBrowser Safari/534.34';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36';

test('isBrokenDropdownUA matches Tesla and QtCarBrowser, not ordinary browsers', () => {
  assert.equal(isBrokenDropdownUA(TESLA_UA), true);
  assert.equal(isBrokenDropdownUA(QT_CAR_UA), true);
  assert.equal(isBrokenDropdownUA(DESKTOP_UA), false);
  assert.equal(isBrokenDropdownUA('tesla'), true); // case-insensitive
  assert.equal(isBrokenDropdownUA(''), false);
});

test('hasForceParam accepts only a real combobox=force query param', () => {
  assert.equal(hasForceParam('?combobox=force'), true);
  assert.equal(hasForceParam('?x=1&combobox=force&y=2'), true);
  assert.equal(hasForceParam('?notcombobox=force'), false); // no [?&] boundary
  assert.equal(hasForceParam('?combobox=forced'), false); // \b after force
  assert.equal(hasForceParam('?combobox=off'), false);
  assert.equal(hasForceParam(''), false);
  assert.equal(hasForceParam(null), false);
  assert.equal(hasForceParam(undefined), false);
});

test('shouldEnable: force bypasses the gate; the default gate is off under node', () => {
  assert.equal(shouldEnable({ force: true }), true);
  // Node's navigator.userAgent is not a Tesla, there is no location, and no
  // force override is set — the fallback must stay off.
  assert.equal(shouldEnable(), false);
  assert.equal(shouldEnable({}), false);
});

test('shouldEnable: a custom match receives the UA string and decides', () => {
  let seen: unknown;
  assert.equal(
    shouldEnable({ match: (ua) => { seen = ua; return true; } }),
    true,
  );
  assert.equal(typeof seen, 'string');
  assert.equal(shouldEnable({ match: () => false }), false);
});

test('shouldEnable: the __JS_COMBOBOX_FORCE__ global overrides', () => {
  const g = globalThis as { __JS_COMBOBOX_FORCE__?: boolean };
  assert.equal(shouldEnable(), false);
  g.__JS_COMBOBOX_FORCE__ = true;
  try {
    assert.equal(shouldEnable(), true);
  } finally {
    delete g.__JS_COMBOBOX_FORCE__;
  }
  assert.equal(shouldEnable(), false);
});

// -- optionText ------------------------------------------------------------------

test('optionText prefers textContent, falls back to value, never returns null', () => {
  assert.equal(optionText({ textContent: 'Label', value: 'v' }), 'Label');
  assert.equal(optionText({ textContent: '', value: 'v' }), 'v');
  assert.equal(optionText({ textContent: null, value: 'v' }), 'v');
  assert.equal(optionText({ textContent: '', value: '' }), '');
  assert.equal(optionText(undefined), '');
  assert.equal(optionText(null), '');
});

// -- Enabled-option navigation -----------------------------------------------------

const opts = (...disabled: boolean[]): { disabled: boolean }[] =>
  disabled.map((d) => ({ disabled: d }));

test('firstEnabledIndex / lastEnabledIndex skip disabled ends', () => {
  assert.equal(firstEnabledIndex(opts(false, false)), 0);
  assert.equal(lastEnabledIndex(opts(false, false)), 1);
  assert.equal(firstEnabledIndex(opts(true, false, true)), 1);
  assert.equal(lastEnabledIndex(opts(true, false, true)), 1);
  assert.equal(firstEnabledIndex(opts(true, true, false, false)), 2);
  assert.equal(lastEnabledIndex(opts(false, false, true, true)), 1);
});

test('firstEnabledIndex / lastEnabledIndex fall back on all-disabled and empty lists', () => {
  assert.equal(firstEnabledIndex(opts(true, true)), 0);
  assert.equal(lastEnabledIndex(opts(true, true)), 1);
  assert.equal(firstEnabledIndex([]), 0);
  assert.equal(lastEnabledIndex([]), -1);
});

test('stepActiveIndex steps and wraps in both directions', () => {
  const all = opts(false, false, false, false);
  assert.equal(stepActiveIndex(0, 1, all), 1);
  assert.equal(stepActiveIndex(3, 1, all), 0); // wrap forward
  assert.equal(stepActiveIndex(0, -1, all), 3); // wrap backward
  assert.equal(stepActiveIndex(2, -1, all), 1);
});

test('stepActiveIndex skips disabled options', () => {
  const mid = opts(false, true, false);
  assert.equal(stepActiveIndex(0, 1, mid), 2);
  assert.equal(stepActiveIndex(2, 1, mid), 0);
  assert.equal(stepActiveIndex(0, -1, mid), 2);
  assert.equal(stepActiveIndex(2, -1, mid), 0);
  const single = opts(true, false, true);
  assert.equal(stepActiveIndex(0, 1, single), 1);
  assert.equal(stepActiveIndex(1, 1, single), 1); // full lap back to the only enabled one
  assert.equal(stepActiveIndex(1, -1, single), 1);
});

test('stepActiveIndex stays put on all-disabled or empty lists', () => {
  assert.equal(stepActiveIndex(1, 1, opts(true, true, true)), 1);
  assert.equal(stepActiveIndex(2, -1, opts(true, true, true)), 2);
  assert.equal(stepActiveIndex(0, 1, []), 0);
});

// -- Type-ahead ----------------------------------------------------------------

const FRUIT: OptionLike[] = [
  { text: 'Apple' },
  { text: 'Apricot' },
  { text: 'Banana' },
  { text: 'Avocado', disabled: true },
  { text: 'Cherry' },
];

test('typeAheadTarget: a fresh single character searches AFTER the active option', () => {
  assert.equal(typeAheadTarget('a', 0, FRUIT), 1); // Apple active -> Apricot
  // From Apricot, the next 'a' match wraps past disabled Avocado back to Apple.
  assert.equal(typeAheadTarget('a', 1, FRUIT), 0);
});

test('typeAheadTarget: a multi-character buffer includes the active option', () => {
  assert.equal(typeAheadTarget('ap', 0, FRUIT), 0); // Apple keeps matching as the buffer grows
  assert.equal(typeAheadTarget('apr', 0, FRUIT), 1);
});

test('typeAheadTarget is case-insensitive and skips disabled matches', () => {
  assert.equal(typeAheadTarget('CH', 0, FRUIT), 4);
  assert.equal(typeAheadTarget('av', 0, FRUIT), -1); // only the disabled Avocado matches
});

test('typeAheadTarget wraps around and reports no match as -1', () => {
  assert.equal(typeAheadTarget('b', 4, FRUIT), 2); // wraps from Cherry to Banana
  assert.equal(typeAheadTarget('z', 0, FRUIT), -1);
  assert.equal(typeAheadTarget('', 0, FRUIT), -1);
  assert.equal(typeAheadTarget('a', 0, []), -1);
});

// -- Popup placement ---------------------------------------------------------------

const place = (
  trigger: PlacementInput['trigger'],
  viewport: PlacementInput['viewport'],
  popup: PlacementInput['popup'],
) => computePopupPlacement({ trigger, viewport, popup });

test('placement: opens below the trigger when there is room', () => {
  const p = place(
    { top: 100, bottom: 130, left: 50, width: 150 },
    { width: 1000, height: 800 },
    { width: 180, height: 200 },
  );
  assert.equal(p.openUp, false);
  assert.equal(p.top, 132); // trigger bottom + 2
  assert.equal(p.left, 50);
  assert.equal(p.maxHeight, 320); // plenty of room -> the 320 cap
  assert.equal(p.minWidth, 150);
  assert.equal(p.maxWidth, 200); // max(trigger width, 200), viewport not the limit
});

test('placement: flips above when below is short and above is roomier', () => {
  const p = place(
    { top: 600, bottom: 630, left: 50, width: 150 },
    { width: 1000, height: 700 },
    { width: 180, height: 300 },
  );
  assert.equal(p.openUp, true);
  assert.equal(p.top, 298); // 600 - 2 - 300: popup bottom lands 2px above the trigger
  assert.ok(p.top + 300 <= 600, 'popup sits fully above the trigger');
  assert.ok(p.top >= 4);
});

test('placement: stays below when above is even shorter than below', () => {
  const p = place(
    { top: 50, bottom: 80, left: 10, width: 100 },
    { width: 500, height: 200 },
    { width: 120, height: 300 },
  );
  assert.equal(p.openUp, false);
  assert.equal(p.top, 82);
  assert.equal(p.maxHeight, 112); // spaceBelow - 8
});

test('placement: maxHeight never drops below 80 in a cramped viewport', () => {
  const p = place(
    { top: 10, bottom: 40, left: 10, width: 100 },
    { width: 500, height: 100 },
    { width: 120, height: 300 },
  );
  assert.equal(p.maxHeight, 80);
});

test('placement: clamps the popup inside the right viewport edge', () => {
  const p = place(
    { top: 10, bottom: 40, left: 900, width: 80 },
    { width: 1000, height: 600 },
    { width: 250, height: 100 },
  );
  // Effective width clamps to maxWidth = 200; right edge pinned to vw - 4.
  assert.equal(p.maxWidth, 200);
  assert.equal(p.left, 796);
});

test('placement: floors left at 4; maxWidth stops at the trigger width', () => {
  const p = place(
    { top: 10, bottom: 40, left: 0, width: 300 },
    { width: 320, height: 600 },
    { width: 400, height: 100 },
  );
  assert.equal(p.maxWidth, 300); // max(width, 200) already under the vw - 16 cap
  assert.equal(p.left, 4);
});

test('placement: the viewport caps maxWidth for an over-wide trigger', () => {
  const p = place(
    { top: 10, bottom: 40, left: 0, width: 400 },
    { width: 320, height: 600 },
    { width: 400, height: 100 },
  );
  assert.equal(p.maxWidth, 304); // vw - 16
  assert.equal(p.minWidth, 400); // min-width wins over max-width, as in CSS
  assert.equal(p.left, 4);
});

test('placement invariants hold across a sweep of geometries', () => {
  for (const vw of [200, 480, 1024, 2560]) {
    for (const vh of [160, 400, 900]) {
      for (const top of [0, 40, vh * 0.5, vh - 50]) {
        for (const h of [40, 200, 800]) {
          const p = place(
            { top, bottom: top + 30, left: vw * 0.7, width: 120 },
            { width: vw, height: vh },
            { width: 260, height: h },
          );
          assert.ok(p.maxHeight >= 80 && p.maxHeight <= 320, 'maxHeight within [80, 320]');
          assert.ok(p.left >= 4, 'left keeps the 4px inset');
          assert.ok(p.maxWidth >= 120, 'maxWidth keeps the floor');
          assert.equal(p.minWidth, 120);
          if (p.openUp) assert.ok(top > vh - (top + 30), 'flips only when above is roomier');
        }
      }
    }
  }
});
