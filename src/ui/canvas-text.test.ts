import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FADE_TAIL_CHARS,
  MIN_CLIP_CHARS,
  clipToWidth,
  deriveLabelTiers,
  fitTieredText,
  selectTier,
} from './canvas-text.ts';
import type { MeasureText } from './canvas-text.ts';

const mono = (charW: number): MeasureText => (s) => s.length * charW;

// -- deriveLabelTiers -------------------------------------------------------------

test('deriveLabelTiers: owner/repo - event yields three tiers', () => {
  assert.deepEqual(deriveLabelTiers('wow-look-at-my/gosmopolitan - workflow_job'), [
    'wow-look-at-my/gosmopolitan - workflow_job',
    'gosmopolitan - workflow_job',
    'gosmopolitan',
  ]);
});

test('deriveLabelTiers: owner prefix only', () => {
  assert.deepEqual(deriveLabelTiers('owner/repo'), ['owner/repo', 'repo']);
});

test('deriveLabelTiers: suffix only', () => {
  assert.deepEqual(deriveLabelTiers('build - deploy'), ['build - deploy', 'build']);
});

test('deriveLabelTiers: suffix strip cuts at the FIRST separator', () => {
  assert.deepEqual(deriveLabelTiers('a - b - c'), ['a - b - c', 'a']);
});

test('deriveLabelTiers: plain label is a single tier', () => {
  assert.deepEqual(deriveLabelTiers('just-a-label'), ['just-a-label']);
  assert.deepEqual(deriveLabelTiers(''), ['']);
});

test('deriveLabelTiers: whitespace before the slash blocks the owner strip', () => {
  assert.deepEqual(deriveLabelTiers('fix things in foo/bar'), ['fix things in foo/bar']);
});

test('deriveLabelTiers: degenerate slashes and separators are skipped', () => {
  assert.deepEqual(deriveLabelTiers('/leading'), ['/leading']);
  assert.deepEqual(deriveLabelTiers('trailing/'), ['trailing/']);
  assert.deepEqual(deriveLabelTiers('owner/ '), ['owner/ ']);
  assert.deepEqual(deriveLabelTiers(' - x'), [' - x']);
});

test('deriveLabelTiers: compact head is right-trimmed', () => {
  assert.deepEqual(deriveLabelTiers('a  - x'), ['a  - x', 'a']);
});

// -- selectTier -------------------------------------------------------------------

test('selectTier: picks the largest tier that fits', () => {
  const tiers = ['aaaaaaaaaa', 'aaaaa', 'aa'];
  const m = mono(6);
  assert.equal(selectTier(tiers, 100, m), 0);
  assert.equal(selectTier(tiers, 40, m), 1);
  assert.equal(selectTier(tiers, 14, m), 2);
  assert.equal(selectTier(tiers, 5, m), -1);
  assert.equal(selectTier(tiers, 0, m), -1);
});

test('selectTier: empty tiers are skipped', () => {
  assert.equal(selectTier(['', 'ab'], 100, mono(6)), 1);
  assert.equal(selectTier([], 100, mono(6)), -1);
});

// -- clipToWidth ------------------------------------------------------------------

test('clipToWidth: exact monospace boundaries', () => {
  const m = mono(6);
  assert.equal(clipToWidth('abcdef', 100, m), 'abcdef'); // fits whole
  assert.equal(clipToWidth('abcdef', 24, m), 'abcd'); // 4 chars exactly
  assert.equal(clipToWidth('abcdef', 23, m), 'abc');
  assert.equal(clipToWidth('abcdef', 6, m), 'a');
  assert.equal(clipToWidth('abcdef', 5, m), '');
  assert.equal(clipToWidth('abcdef', 0, m), '');
  assert.equal(clipToWidth('', 100, m), '');
});

test('clipToWidth: works with a non-uniform measure', () => {
  const wide: MeasureText = (s) => {
    let w = 0;
    for (const ch of s) w += ch === 'w' ? 10 : 4;
    return w;
  };
  assert.equal(clipToWidth('awawa', 18, wide), 'awa'); // 4+10+4
  assert.equal(clipToWidth('awawa', 17, wide), 'aw');
  const out = clipToWidth('awawaww', 25, wide);
  assert.ok(wide(out) <= 25);
  assert.ok(wide(out + 'awawaww'[out.length]) > 25); // longest fitting prefix
});

// -- fitTieredText ----------------------------------------------------------------

test('fitTieredText: returns the first fitting tier with its width', () => {
  const tiers = ['aaaaaaaaaa', 'aaaaa', 'aa'];
  const fit = fitTieredText(tiers, 31, mono(6));
  assert.deepEqual(fit, { text: 'aaaaa', tier: 1, faded: false, width: 30 });
});

test('fitTieredText: clips the most compact tier and flags faded', () => {
  const fit = fitTieredText(['aaaaaaaaaa', 'abcdefgh'], 30, mono(6));
  assert.deepEqual(fit, { text: 'abcde', tier: 1, faded: true, width: 30 });
});

test('fitTieredText: plain string input behaves as a single tier', () => {
  const m = mono(6);
  assert.deepEqual(fitTieredText('abc', 100, m), { text: 'abc', tier: 0, faded: false, width: 18 });
  assert.deepEqual(fitTieredText('abcdefgh', 30, m), { text: 'abcde', tier: 0, faded: true, width: 30 });
  assert.equal(fitTieredText('', 100, m), null);
});

test('fitTieredText: suppresses below minClipChars', () => {
  const m = mono(6);
  assert.equal(fitTieredText('abcdefgh', 12, m), null); // 2 chars < default 3
  assert.notEqual(fitTieredText('abcdefgh', 18, m), null); // 3 chars fit
  assert.equal(fitTieredText('abcdefgh', 18, m, { minClipChars: 4 }), null);
  assert.deepEqual(fitTieredText('abcdefgh', 12, m, { minClipChars: 2 }), {
    text: 'ab',
    tier: 0,
    faded: true,
    width: 12,
  });
});

test('fitTieredText: all-empty tiers yield null', () => {
  assert.equal(fitTieredText([], 100, mono(6)), null);
  assert.equal(fitTieredText(['', ''], 100, mono(6)), null);
});

test('fitTieredText: never overflows the available width', () => {
  const m = mono(7);
  const tiers = deriveLabelTiers('wow-look-at-my/gosmopolitan - workflow_job');
  for (let avail = 0; avail <= 320; avail += 3) {
    const fit = fitTieredText(tiers, avail, m);
    if (fit !== null) {
      assert.ok(fit.width <= avail, `width ${fit.width} fits ${avail}px`);
      assert.equal(fit.width, m(fit.text));
    }
  }
});

test('fitTieredText: tier indexes track the input list', () => {
  const tiers = ['', 'medium-tier', 'tiny'];
  const m = mono(6);
  assert.equal(fitTieredText(tiers, 200, m)?.tier, 1);
  assert.equal(fitTieredText(tiers, 30, m)?.tier, 2);
  assert.equal(fitTieredText(tiers, 20, m)?.tier, 2); // clipped from the last tier
});

test('FADE_TAIL_CHARS covers the last two to three characters', () => {
  assert.ok(FADE_TAIL_CHARS >= 2 && FADE_TAIL_CHARS <= 3);
  assert.ok(MIN_CLIP_CHARS * 1 >= FADE_TAIL_CHARS); // a min clip always spans the fade
});
