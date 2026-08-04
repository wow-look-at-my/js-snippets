import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CHUNK_MS,
  bitAt,
  decodePage,
  decodePageGen,
  drain,
  rowObject,
  rowOfId,
  runSliced,
  stringAt,
} from './timeline-wire.ts';
import type { WireSchema } from './timeline-wire.ts';

// ONE FIXTURE, BOTH LANGUAGES. ../../timelinewire/testdata/golden-v1.b64 is
// written by the Go ENCODER in this repo (timelinewire/wire_test.go asserts it
// still emits exactly these bytes) and decoded here. That single file is what
// holds the two halves of the format together — there is no second
// implementation of the layout anywhere, in this repo or a consumer's, so
// there is nothing to keep in step by hand.
const GOLDEN_B64 = readFileSync(
  new URL('../../timelinewire/testdata/golden-v1.b64', import.meta.url), 'utf8').trim();

// The schema the golden page was encoded with. It lives in the TEST, not the
// module: the module decodes a LAYOUT and the column names belong to whoever
// produced the payload, so no producer's vocabulary reaches the decoder.
const GOLDEN: WireSchema = {
  magic: 'TLC1',
  deltaU: ['id'],
  deltaZ: ['start'],
  plain: ['dur', 'status', 'attempt'],
  bits: ['final'],
  strings: ['kind', 'lane', 'delivery_id', 'actor_name', 'detail'],
};

function golden(): Uint8Array {
  return Uint8Array.from(Buffer.from(GOLDEN_B64, 'base64'));
}

test('decodes the Go encoder’s golden payload', () => {
  const { c, maxId, retentionStart, now } = decodePage(golden(), GOLDEN);

  assert.equal(c.n, 3);
  assert.equal(maxId, 3);
  // 2026-08-01T12:00:00Z minus 24h, and plus 10s.
  assert.equal(retentionStart, Date.UTC(2026, 6, 31, 12, 0, 0));
  assert.equal(now, Date.UTC(2026, 7, 1, 12, 0, 10));

  assert.deepEqual([...c.u.id], [1, 2, 3]);
  assert.deepEqual([...c.z.start], [
    Date.UTC(2026, 7, 1, 12, 0, 0),
    Date.UTC(2026, 7, 1, 12, 0, 1, 500),
    Date.UTC(2026, 7, 1, 12, 0, 4),
  ]);
  assert.deepEqual([...c.p.dur], [3, 12, 250]);
  assert.deepEqual([...c.p.status], [0, 200, 502]);

  assert.deepEqual([0, 1, 2].map((i) => stringAt(c, 'kind', i)),
    ['webhook', 'request', 'request']);
  assert.deepEqual([0, 1, 2].map((i) => stringAt(c, 'lane', i)),
    ['⇐ push', 'GET /repos/{owner}/{repo}/pulls', 'POST /graphql']);

});

test('non-ASCII survives the dictionary', () => {
  const { c } = decodePage(golden(), GOLDEN);
  assert.equal(stringAt(c, 'delivery_id', 0), 'd-Ünicode-1');
});

test('a column no row used reads empty for every row', () => {
  // The encoder writes such a column as a one-entry dictionary and NO index
  // run — the compression that makes the format small on sparse windows. Every
  // row must still answer, and answer "".
  const { c } = decodePage(golden(), GOLDEN);
  assert.equal(c.s.detail.idx, null, 'detail should carry no index run');
  for (let i = 0; i < c.n; i++) assert.equal(stringAt(c, 'detail', i), '');
  // Same for the bitset and the unused numeric column.
  for (let i = 0; i < c.n; i++) assert.equal(bitAt(c, 'final', i), false);
  assert.deepEqual([...c.p.attempt], [0, 0, 0]);
});

test('a value present on only some rows stays on its own row', () => {
  const { c } = decodePage(golden(), GOLDEN);
  assert.deepEqual([0, 1, 2].map((i) => stringAt(c, 'actor_name', i)),
    ['', 'PazerOP', '']);

});

test('rowOfId binary-searches the ascending id column', () => {
  const { c } = decodePage(golden(), GOLDEN);
  assert.equal(rowOfId(c, 'id', 1), 0);
  assert.equal(rowOfId(c, 'id', 2), 1);
  assert.equal(rowOfId(c, 'id', 3), 2);
  assert.equal(rowOfId(c, 'id', 4), -1, 'a missing id is -1, never a wrong row');
  assert.equal(rowOfId(c, 'id', 0), -1);
});

test('rowObject materializes every column of one row', () => {
  const { c } = decodePage(golden(), GOLDEN);
  const row = rowObject(c, 1);
  assert.equal(row.id, 2);
  assert.equal(row.status, 200);
  assert.equal(row.lane, 'GET /repos/{owner}/{repo}/pulls');
  assert.equal(row.actor_name, 'PazerOP');
  assert.equal(row.final, false);
  assert.equal(row.delivery_id, '', 'a column this row does not use is present and empty');
});

test('a truncated or corrupt payload throws rather than decoding garbage', () => {
  const good = golden();
  assert.throws(() => decodePage(good.subarray(0, good.length - 4), GOLDEN),
    /truncated|trailing/);

  const badMagic = golden();
  badMagic[0] = 0x58; // "X"
  assert.throws(() => decodePage(badMagic, GOLDEN), /bad magic/);

  // Trailing bytes mean the reader and the writer disagree about the layout,
  // even though everything up to here parsed.
  const extra = new Uint8Array(good.length + 1);
  extra.set(good);
  assert.throws(() => decodePage(extra, GOLDEN), /trailing bytes/);
});

test('the schema drives the layout — a wrong column count is caught', () => {
  const short: WireSchema = { ...GOLDEN, strings: GOLDEN.strings.slice(0, -1) };
  assert.throws(() => decodePage(golden(), short), /trailing bytes/);
});

test('decodePageGen yields, so a page can be spread across frames', () => {
  let steps = 0;
  const gen = decodePageGen(golden(), GOLDEN);
  let r = gen.next();
  while (!r.done) {
    steps++;
    r = gen.next();
    assert.ok(steps < 1000, 'generator must terminate');
  }
  assert.ok(steps > 0, 'a decode must be interruptible, not one blocking step');
  assert.equal(r.value.c.n, 3);
  // Draining by hand and via drain() must agree.
  assert.equal(drain(decodePageGen(golden(), GOLDEN)).maxId, 3);
});

test('runSliced completes a task and reports each chunk it ran', async () => {
  // Under node there are no frames, so this checks the contract that matters
  // off-browser: every chunk is measured and the task runs to completion.
  const slices: number[] = [];
  const page = await runSliced(decodePageGen(golden(), GOLDEN), (ms) => slices.push(ms));
  assert.equal(page.c.n, 3);
  assert.ok(slices.length > 0, 'onSlice must see every chunk');
  for (const ms of slices) assert.ok(ms >= 0 && ms < CHUNK_MS + 50, `implausible slice ${ms}ms`);
});
