import assert from 'node:assert/strict';
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

// The schema github-state-mirror sends. It lives in the TEST, not the module:
// the module decodes a LAYOUT and the column names are the producer's own, so
// a consumer's vocabulary must never leak into the shared decoder.
const GSM: WireSchema = {
  magic: 'TLC1',
  deltaU: ['id'],
  deltaZ: ['start'],
  plain: ['dur', 'status', 'attempt'],
  bits: ['final'],
  strings: [
    'kind', 'lane', 'disposition', 'event_type', 'action', 'delivery_id',
    'repo', 'method', 'route', 'actor', 'actor_name', 'detail', 'target',
  ],
};

// ---- the cross-language pin ----
//
// These bytes were produced by the GO encoder in github-state-mirror, whose
// TestTimelineWireGoldenBytes asserts it still emits exactly this string for a
// fixed snapshot. Two implementations of one layout in two repos, held
// together by the only thing both can agree on: the payload itself. Neither
// side can drift without one of them going red.
const GOLDEN_B64 =
  'VExDMQOAqN2A92egtJHT92cDAQEBgJiQ0/dnuBeIJwMM+gEAyAH2AwAAAAADAAd3ZWJob29rB3JlcXVlc3QBAgIEAAjih5Ag' +
  'cHVzaB9HRVQgL3JlcG9zL3tvd25lcn0ve3JlcG99L3B1bGxzDVBPU1QgL2dyYXBocWwBAgMEAAdhcHBsaWVkA2hpdAVlcnJv' +
  'cgECAwIABHB1c2gBAAABAAIADGQtw5xuaWNvZGUtMQEAAAIACm93bmVyL3JlcG8BAAADAANHRVQEUE9TVAABAgMAGy9yZXBv' +
  'cy97b3duZXJ9L3tyZXBvfS9wdWxscwgvZ3JhcGhxbAABAgMABnVzZXI6MQZhcHA6OTkAAQICAAdQYXplck9QAAEAAQABAA==';

function golden(): Uint8Array {
  return Uint8Array.from(Buffer.from(GOLDEN_B64, 'base64'));
}

test('decodes the Go encoder’s golden payload', () => {
  const { c, maxId, retentionStart, now } = decodePage(golden(), GSM);

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
  assert.deepEqual([0, 1, 2].map((i) => stringAt(c, 'disposition', i)),
    ['applied', 'hit', 'error']);
});

test('non-ASCII survives the dictionary', () => {
  const { c } = decodePage(golden(), GSM);
  assert.equal(stringAt(c, 'delivery_id', 0), 'd-Ünicode-1');
});

test('a column no row used reads empty for every row', () => {
  // The encoder writes such a column as a one-entry dictionary and NO index
  // run — the compression that makes the format small on sparse windows. Every
  // row must still answer, and answer "".
  const { c } = decodePage(golden(), GSM);
  assert.equal(c.s.target.idx, null, 'target should carry no index run');
  assert.equal(c.s.detail.idx, null, 'detail should carry no index run');
  for (let i = 0; i < c.n; i++) {
    assert.equal(stringAt(c, 'target', i), '');
    assert.equal(stringAt(c, 'detail', i), '');
  }
  // Same for the bitset and the unused numeric column.
  for (let i = 0; i < c.n; i++) assert.equal(bitAt(c, 'final', i), false);
  assert.deepEqual([...c.p.attempt], [0, 0, 0]);
});

test('a value present on only some rows stays on its own row', () => {
  const { c } = decodePage(golden(), GSM);
  assert.deepEqual([0, 1, 2].map((i) => stringAt(c, 'actor_name', i)),
    ['', 'PazerOP', '']);
  assert.deepEqual([0, 1, 2].map((i) => stringAt(c, 'repo', i)),
    ['owner/repo', '', '']);
});

test('rowOfId binary-searches the ascending id column', () => {
  const { c } = decodePage(golden(), GSM);
  assert.equal(rowOfId(c, 'id', 1), 0);
  assert.equal(rowOfId(c, 'id', 2), 1);
  assert.equal(rowOfId(c, 'id', 3), 2);
  assert.equal(rowOfId(c, 'id', 4), -1, 'a missing id is -1, never a wrong row');
  assert.equal(rowOfId(c, 'id', 0), -1);
});

test('rowObject materializes every column of one row', () => {
  const { c } = decodePage(golden(), GSM);
  const row = rowObject(c, 1);
  assert.equal(row.id, 2);
  assert.equal(row.status, 200);
  assert.equal(row.method, 'GET');
  assert.equal(row.actor, 'user:1');
  assert.equal(row.final, false);
  assert.equal(row.repo, '', 'a column this row does not use is present and empty');
});

test('a truncated or corrupt payload throws rather than decoding garbage', () => {
  const good = golden();
  assert.throws(() => decodePage(good.subarray(0, good.length - 4), GSM),
    /truncated|trailing/);

  const badMagic = golden();
  badMagic[0] = 0x58; // "X"
  assert.throws(() => decodePage(badMagic, GSM), /bad magic/);

  // Trailing bytes mean the reader and the writer disagree about the layout,
  // even though everything up to here parsed.
  const extra = new Uint8Array(good.length + 1);
  extra.set(good);
  assert.throws(() => decodePage(extra, GSM), /trailing bytes/);
});

test('the schema drives the layout — a wrong column count is caught', () => {
  const short: WireSchema = { ...GSM, strings: GSM.strings.slice(0, 5) };
  assert.throws(() => decodePage(golden(), short), /trailing bytes/);
});

test('decodePageGen yields, so a page can be spread across frames', () => {
  let steps = 0;
  const gen = decodePageGen(golden(), GSM);
  let r = gen.next();
  while (!r.done) {
    steps++;
    r = gen.next();
    assert.ok(steps < 1000, 'generator must terminate');
  }
  assert.ok(steps > 0, 'a decode must be interruptible, not one blocking step');
  assert.equal(r.value.c.n, 3);
  // Draining by hand and via drain() must agree.
  assert.equal(drain(decodePageGen(golden(), GSM)).maxId, 3);
});

test('runSliced completes a task and reports each chunk it ran', async () => {
  // Under node there are no frames, so this checks the contract that matters
  // off-browser: every chunk is measured and the task runs to completion.
  const slices: number[] = [];
  const page = await runSliced(decodePageGen(golden(), GSM), (ms) => slices.push(ms));
  assert.equal(page.c.n, 3);
  assert.ok(slices.length > 0, 'onSlice must see every chunk');
  for (const ms of slices) assert.ok(ms >= 0 && ms < CHUNK_MS + 50, `implausible slice ${ms}ms`);
});
