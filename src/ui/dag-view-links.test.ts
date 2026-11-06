import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardLinks } from './dag-view-math.ts';
import type { DagLink } from './dag-view-math.ts';

test('cardLinks: keeps safe links in order and marks the external ones', () => {
  const links: DagLink[] = [
    { label: 'PR o/a#1', href: 'https://github.com/o/a/pull/1' },
    { label: 'worker run', href: '/#run=abc' },
  ];
  assert.deepEqual(cardLinks({ id: 'n', links }), [
    { label: 'PR o/a#1', href: 'https://github.com/o/a/pull/1', external: true },
    { label: 'worker run', href: '/#run=abc', external: false },
  ]);
});

test('cardLinks: drops unsafe hrefs and repeats, and falls back to the href for an empty label', () => {
  const links: DagLink[] = [
    { label: 'bad', href: 'javascript:alert(1)' },
    { label: 'data', href: 'data:text/html,x' },
    { label: 'proto', href: '//evil.example/x' },
    { label: '', href: 'https://github.com/o/b/pull/2' },
    { label: 'again', href: 'https://github.com/o/b/pull/2' },
    { label: 'blank', href: '   ' },
  ];
  assert.deepEqual(cardLinks({ id: 'n', links }), [
    { label: 'https://github.com/o/b/pull/2', href: 'https://github.com/o/b/pull/2', external: true },
  ]);
});

test('cardLinks: no links field gives an empty list', () => {
  assert.deepEqual(cardLinks({ id: 'n' }), []);
});
