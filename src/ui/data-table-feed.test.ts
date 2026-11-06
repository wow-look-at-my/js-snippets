import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FAMILY_GROUP, SEVERITY_GROUP, familyHue, feedFilterFromStored, feedFilterToStored } from './data-table-feed.ts';

test('familyHue is stable per name and lands on the hue wheel', () => {
  assert.equal(familyHue('manager'), familyHue('manager'));
  for (const fam of ['', 'run', 'hook', 'weather', 'kettle']) {
    const h = familyHue(fam);
    assert.ok(Number.isInteger(h) && h >= 0 && h < 360 && h % 15 === 0, `${fam} -> ${h}`);
  }
});

test('a stored feed filter maps onto the severity and family facet groups', () => {
  const raw = JSON.stringify({ query: 'manager', hiddenSeverities: ['info'], hiddenFamilies: ['run', 'hook'] });
  assert.deepEqual(feedFilterFromStored(raw), {
    query: 'manager',
    hidden: { [SEVERITY_GROUP]: ['info'], [FAMILY_GROUP]: ['run', 'hook'] },
    sort: null,
  });
});

test('malformed storage reads as no filter', () => {
  const none = { query: '', hidden: { [SEVERITY_GROUP]: [], [FAMILY_GROUP]: [] }, sort: null };
  assert.deepEqual(feedFilterFromStored(null), none);
  assert.deepEqual(feedFilterFromStored('{not json'), none);
});

test('the table filter writes back in the stored feed shape, sorted', () => {
  const stored = feedFilterToStored({
    query: 'x',
    hidden: { [SEVERITY_GROUP]: ['warn', 'bad'], [FAMILY_GROUP]: ['run'], other: ['ignored'] },
    sort: null,
  });
  assert.deepEqual(stored, { query: 'x', hiddenSeverities: ['bad', 'warn'], hiddenFamilies: ['run'] });
  assert.deepEqual(feedFilterFromStored(JSON.stringify(stored)).hidden[SEVERITY_GROUP], ['bad', 'warn']);
});
