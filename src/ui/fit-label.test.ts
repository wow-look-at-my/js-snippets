import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitLabelTiers } from './fit-label.ts';

test('fitLabelTiers: a task title drops its owner, then each leading · piece', () => {
  assert.deepEqual(fitLabelTiers('wow-look-at-my/webhooks · wow-dind runner · job 117925653277'), [
    'wow-look-at-my/webhooks · wow-dind runner · job 117925653277',
    'webhooks · wow-dind runner · job 117925653277',
    'wow-dind runner · job 117925653277',
    'job 117925653277',
  ]);
});

test('fitLabelTiers: a plain label has one form, and no form is listed twice', () => {
  assert.deepEqual(fitLabelTiers('release build'), ['release build']);
  assert.deepEqual(fitLabelTiers('a · b'), ['a · b', 'b']);
});
