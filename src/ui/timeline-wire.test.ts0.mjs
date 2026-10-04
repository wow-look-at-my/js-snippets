// src/ui/timeline-wire.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// src/ui/timeline-wire.ts
var CHUNK_MS = 4;
var STEP = 1024;
var frameSeq = 0;
var framePending = null;
var frameQueue = Promise.resolve();
function yieldToBrowser() {
  const sched = globalThis.scheduler;
  if (typeof sched?.yield === "function") return sched.yield();
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}
function afterNextFrame() {
  if (framePending) return framePending;
  const start = frameSeq;
  framePending = new Promise((resolve) => {
    const wait = () => {
      requestAnimationFrame(() => {
        frameSeq++;
        setTimeout(() => {
          if (frameSeq > start) {
            framePending = null;
            resolve();
          } else {
            wait();
          }
        }, 0);
      });
    };
    wait();
  });
  return framePending;
}
function nextFrame() {
  if (typeof requestAnimationFrame !== "function") {
    return yieldToBrowser();
  }
  const turn = frameQueue.then(afterNextFrame);
  frameQueue = turn.catch(() => void 0);
  return turn;
}
async function runSliced(task, onSlice) {
  for (; ; ) {
    await nextFrame();
    const t0 = performance.now();
    let r;
    do {
      r = task.next();
    } while (!r.done && performance.now() - t0 < CHUNK_MS);
    onSlice?.(performance.now() - t0);
    if (r.done) return r.value;
  }
}
function drain(task) {
  let r = task.next();
  while (!r.done) r = task.next();
  return r.value;
}
var WireReader = class {
  p = 0;
  dec = new TextDecoder();
  b;
  // An explicit field, not a `private b: Uint8Array` parameter property:
  // node runs this module's tests by STRIPPING types.
  constructor(b) {
    this.b = b;
  }
  uvarint() {
    let x = 0, s = 0;
    for (; ; ) {
      const c = this.b[this.p++];
      if (c === void 0) throw new Error("timeline-wire: truncated varint");
      if (c < 128) return x + c * 2 ** s;
      x += (c & 127) * 2 ** s;
      s += 7;
    }
  }
  varint() {
    const u = this.uvarint();
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  }
  // Bulk readers.
  uvarints(out, from, to) {
    const b = this.b;
    let p = this.p;
    for (let i = from; i < to; i++) {
      const c0 = b[p++];
      if (c0 < 128) {
        out[i] = c0;
        continue;
      }
      let x = c0 & 127, sh = 7;
      for (; ; ) {
        const c = b[p++];
        if (c === void 0) throw new Error("timeline-wire: truncated varint");
        if (c < 128) {
          x += c * 2 ** sh;
          break;
        }
        x += (c & 127) * 2 ** sh;
        sh += 7;
      }
      out[i] = x;
    }
    this.p = p;
  }
  // Running sums of zigzag deltas, straight into the output column. The
  // accumulator is the value already written, so a range resumes exactly
  // where the last one stopped.
  varintSums(out, from, to) {
    const b = this.b;
    let p = this.p, acc = from === 0 ? 0 : out[from - 1];
    for (let i = from; i < to; i++) {
      let u = b[p++];
      if (u >= 128) {
        u &= 127;
        let sh = 7;
        for (; ; ) {
          const c = b[p++];
          if (c === void 0) throw new Error("timeline-wire: truncated varint");
          if (c < 128) {
            u += c * 2 ** sh;
            break;
          }
          u += (c & 127) * 2 ** sh;
          sh += 7;
        }
      }
      acc += u % 2 === 0 ? u / 2 : -(u + 1) / 2;
      out[i] = acc;
    }
    this.p = p;
  }
  // Running sums of unsigned deltas (ids), same resumption rule.
  uvarintSums(out, from, to) {
    const b = this.b;
    let p = this.p, acc = from === 0 ? 0 : out[from - 1];
    for (let i = from; i < to; i++) {
      const c0 = b[p++];
      if (c0 < 128) {
        out[i] = acc += c0;
        continue;
      }
      let x = c0 & 127, sh = 7;
      for (; ; ) {
        const c = b[p++];
        if (c === void 0) throw new Error("timeline-wire: truncated varint");
        if (c < 128) {
          x += c * 2 ** sh;
          break;
        }
        x += (c & 127) * 2 ** sh;
        sh += 7;
      }
      out[i] = acc += x;
    }
    this.p = p;
  }
  bytes(n) {
    if (this.p + n > this.b.length) throw new Error("timeline-wire: truncated payload");
    const out = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return out;
  }
  str() {
    return this.dec.decode(this.bytes(this.uvarint()));
  }
  // A dictionary can be large (unique ids per row), so reading one is
  // chunked like everything else.
  *dictChunked() {
    const n = this.uvarint();
    const out = new Array(n);
    for (let i = 0; i < n; ) {
      const to = Math.min(i + STEP, n);
      for (; i < to; i++) out[i] = this.str();
      yield;
    }
    return out;
  }
  expectMagic(want) {
    const got = String.fromCharCode(...this.bytes(4));
    if (got !== want) throw new Error(`timeline-wire: bad magic ${JSON.stringify(got)}`);
  }
  atEnd() {
    return this.p === this.b.length;
  }
};
function* chunked(n, work) {
  for (let i = 0; i < n; ) {
    const to = Math.min(i + STEP, n);
    work(i, to);
    i = to;
    yield;
  }
}
function* decodePageGen(buf, schema) {
  const r = new WireReader(buf);
  r.expectMagic(schema.magic);
  const maxId = r.uvarint();
  const retentionStart = r.varint();
  const now = r.varint();
  const n = r.uvarint();
  const c = { n, u: {}, z: {}, p: {}, b: {}, s: {} };
  for (const name of schema.deltaU) {
    const out = new Float64Array(n);
    yield* chunked(n, (from, to) => r.uvarintSums(out, from, to));
    c.u[name] = out;
  }
  for (const name of schema.deltaZ) {
    const out = new Float64Array(n);
    yield* chunked(n, (from, to) => r.varintSums(out, from, to));
    c.z[name] = out;
  }
  for (const name of schema.plain) {
    const out = new Int32Array(n);
    yield* chunked(n, (from, to) => r.uvarints(out, from, to));
    c.p[name] = out;
  }
  for (const name of schema.bits) {
    c.b[name] = r.bytes(n + 7 >> 3);
  }
  for (const name of schema.strings) {
    const dict = yield* r.dictChunked();
    if (dict.length === 1) {
      c.s[name] = { dict, idx: null };
      continue;
    }
    const idx = new Int32Array(n);
    yield* chunked(n, (from, to) => r.uvarints(idx, from, to));
    c.s[name] = { dict, idx };
  }
  if (!r.atEnd()) throw new Error("timeline-wire: trailing bytes in payload");
  return { c, maxId, retentionStart, now };
}
function decodePage(buf, schema) {
  return drain(decodePageGen(buf, schema));
}
function stringAt(c, name, i) {
  const col = c.s[name];
  if (!col) return "";
  return col.idx === null ? col.dict[0] ?? "" : col.dict[col.idx[i]] ?? "";
}
function bitAt(c, name, i) {
  const bits = c.b[name];
  return bits ? (bits[i >> 3] & 1 << (i & 7)) !== 0 : false;
}
function rowOfId(c, idColumn, id) {
  const ids = c.u[idColumn];
  if (!ids) return -1;
  let lo = 0, hi = c.n - 1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    const v = ids[mid];
    if (v === id) return mid;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
function rowObject(c, i) {
  const out = {};
  for (const [name, col] of Object.entries(c.u)) out[name] = col[i];
  for (const [name, col] of Object.entries(c.z)) out[name] = col[i];
  for (const [name, col] of Object.entries(c.p)) out[name] = col[i];
  for (const name of Object.keys(c.b)) out[name] = bitAt(c, name, i);
  for (const name of Object.keys(c.s)) out[name] = stringAt(c, name, i);
  return out;
}

// src/ui/timeline-wire.test.ts
var GOLDEN_B64 = readFileSync(
  new URL("../../timelinewire/testdata/golden-v1.b64", import.meta.url),
  "utf8"
).trim();
var GOLDEN = {
  magic: "TLC1",
  deltaU: ["id"],
  deltaZ: ["start"],
  plain: ["dur", "status", "attempt"],
  bits: ["final"],
  strings: ["kind", "lane", "delivery_id", "actor_name", "detail"]
};
function golden() {
  return Uint8Array.from(Buffer.from(GOLDEN_B64, "base64"));
}
test("decodes the Go encoder\u2019s golden payload", () => {
  const { c, maxId, retentionStart, now } = decodePage(golden(), GOLDEN);
  assert.equal(c.n, 3);
  assert.equal(maxId, 3);
  assert.equal(retentionStart, Date.UTC(2026, 6, 31, 12, 0, 0));
  assert.equal(now, Date.UTC(2026, 7, 1, 12, 0, 10));
  assert.deepEqual([...c.u.id], [1, 2, 3]);
  assert.deepEqual([...c.z.start], [
    Date.UTC(2026, 7, 1, 12, 0, 0),
    Date.UTC(2026, 7, 1, 12, 0, 1, 500),
    Date.UTC(2026, 7, 1, 12, 0, 4)
  ]);
  assert.deepEqual([...c.p.dur], [3, 12, 250]);
  assert.deepEqual([...c.p.status], [0, 200, 502]);
  assert.deepEqual(
    [0, 1, 2].map((i) => stringAt(c, "kind", i)),
    ["webhook", "request", "request"]
  );
  assert.deepEqual(
    [0, 1, 2].map((i) => stringAt(c, "lane", i)),
    ["\u21D0 push", "GET /repos/{owner}/{repo}/pulls", "POST /graphql"]
  );
});
test("non-ASCII survives the dictionary", () => {
  const { c } = decodePage(golden(), GOLDEN);
  assert.equal(stringAt(c, "delivery_id", 0), "d-\xDCnicode-1");
});
test("a column no row used reads empty for every row", () => {
  const { c } = decodePage(golden(), GOLDEN);
  assert.equal(c.s.detail.idx, null, "detail should carry no index run");
  for (let i = 0; i < c.n; i++) assert.equal(stringAt(c, "detail", i), "");
  for (let i = 0; i < c.n; i++) assert.equal(bitAt(c, "final", i), false);
  assert.deepEqual([...c.p.attempt], [0, 0, 0]);
});
test("a value present on only some rows stays on its own row", () => {
  const { c } = decodePage(golden(), GOLDEN);
  assert.deepEqual(
    [0, 1, 2].map((i) => stringAt(c, "actor_name", i)),
    ["", "PazerOP", ""]
  );
});
test("rowOfId binary-searches the ascending id column", () => {
  const { c } = decodePage(golden(), GOLDEN);
  assert.equal(rowOfId(c, "id", 1), 0);
  assert.equal(rowOfId(c, "id", 2), 1);
  assert.equal(rowOfId(c, "id", 3), 2);
  assert.equal(rowOfId(c, "id", 4), -1, "a missing id is -1, never a wrong row");
  assert.equal(rowOfId(c, "id", 0), -1);
});
test("rowObject materializes every column of one row", () => {
  const { c } = decodePage(golden(), GOLDEN);
  const row = rowObject(c, 1);
  assert.equal(row.id, 2);
  assert.equal(row.status, 200);
  assert.equal(row.lane, "GET /repos/{owner}/{repo}/pulls");
  assert.equal(row.actor_name, "PazerOP");
  assert.equal(row.final, false);
  assert.equal(row.delivery_id, "", "a column this row does not use is present and empty");
});
test("a truncated or corrupt payload throws rather than decoding garbage", () => {
  const good = golden();
  assert.throws(
    () => decodePage(good.subarray(0, good.length - 4), GOLDEN),
    /truncated|trailing/
  );
  const badMagic = golden();
  badMagic[0] = 88;
  assert.throws(() => decodePage(badMagic, GOLDEN), /bad magic/);
  const extra = new Uint8Array(good.length + 1);
  extra.set(good);
  assert.throws(() => decodePage(extra, GOLDEN), /trailing bytes/);
});
test("the schema drives the layout \u2014 a wrong column count is caught", () => {
  const short = { ...GOLDEN, strings: GOLDEN.strings.slice(0, -1) };
  assert.throws(() => decodePage(golden(), short), /trailing bytes/);
});
test("decodePageGen yields, so a page can be spread across frames", () => {
  let steps = 0;
  const gen = decodePageGen(golden(), GOLDEN);
  let r = gen.next();
  while (!r.done) {
    steps++;
    r = gen.next();
    assert.ok(steps < 1e3, "generator must terminate");
  }
  assert.ok(steps > 0, "a decode must be interruptible, not one blocking step");
  assert.equal(r.value.c.n, 3);
  assert.equal(drain(decodePageGen(golden(), GOLDEN)).maxId, 3);
});
test("runSliced completes a task and reports each chunk it ran", async () => {
  const slices = [];
  const page = await runSliced(decodePageGen(golden(), GOLDEN), (ms) => slices.push(ms));
  assert.equal(page.c.n, 3);
  assert.ok(slices.length > 0, "onSlice must see every chunk");
  for (const ms of slices) assert.ok(ms >= 0 && ms < CHUNK_MS + 50, `implausible slice ${ms}ms`);
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidGltZWxpbmUtd2lyZS50ZXN0LnRzIiwgInRpbWVsaW5lLXdpcmUudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCBhc3NlcnQgZnJvbSAnbm9kZTphc3NlcnQvc3RyaWN0JztcbmltcG9ydCB7IHJlYWRGaWxlU3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgdGVzdCB9IGZyb20gJ25vZGU6dGVzdCc7XG5pbXBvcnQge1xuICBDSFVOS19NUyxcbiAgYml0QXQsXG4gIGRlY29kZVBhZ2UsXG4gIGRlY29kZVBhZ2VHZW4sXG4gIGRyYWluLFxuICByb3dPYmplY3QsXG4gIHJvd09mSWQsXG4gIHJ1blNsaWNlZCxcbiAgc3RyaW5nQXQsXG59IGZyb20gJy4vdGltZWxpbmUtd2lyZS50cyc7XG5pbXBvcnQgdHlwZSB7IFdpcmVTY2hlbWEgfSBmcm9tICcuL3RpbWVsaW5lLXdpcmUudHMnO1xuXG4vLyBPTkUgRklYVFVSRSwgQk9USCBMQU5HVUFHRVMuIC4uLy4uL3RpbWVsaW5ld2lyZS90ZXN0ZGF0YS9nb2xkZW4tdjEuYjY0IGlzXG4vLyB3cml0dGVuIGJ5IHRoZSBHbyBFTkNPREVSIGluIHRoaXMgcmVwby5cbmNvbnN0IEdPTERFTl9CNjQgPSByZWFkRmlsZVN5bmMoXG4gIG5ldyBVUkwoJy4uLy4uL3RpbWVsaW5ld2lyZS90ZXN0ZGF0YS9nb2xkZW4tdjEuYjY0JywgaW1wb3J0Lm1ldGEudXJsKSwgJ3V0ZjgnKS50cmltKCk7XG5cbi8vIFRoZSBzY2hlbWEgdGhlIGdvbGRlbiBwYWdlIHdhcyBlbmNvZGVkIHdpdGguXG5jb25zdCBHT0xERU46IFdpcmVTY2hlbWEgPSB7XG4gIG1hZ2ljOiAnVExDMScsXG4gIGRlbHRhVTogWydpZCddLFxuICBkZWx0YVo6IFsnc3RhcnQnXSxcbiAgcGxhaW46IFsnZHVyJywgJ3N0YXR1cycsICdhdHRlbXB0J10sXG4gIGJpdHM6IFsnZmluYWwnXSxcbiAgc3RyaW5nczogWydraW5kJywgJ2xhbmUnLCAnZGVsaXZlcnlfaWQnLCAnYWN0b3JfbmFtZScsICdkZXRhaWwnXSxcbn07XG5cbmZ1bmN0aW9uIGdvbGRlbigpOiBVaW50OEFycmF5IHtcbiAgcmV0dXJuIFVpbnQ4QXJyYXkuZnJvbShCdWZmZXIuZnJvbShHT0xERU5fQjY0LCAnYmFzZTY0JykpO1xufVxuXG50ZXN0KCdkZWNvZGVzIHRoZSBHbyBlbmNvZGVyXHUyMDE5cyBnb2xkZW4gcGF5bG9hZCcsICgpID0+IHtcbiAgY29uc3QgeyBjLCBtYXhJZCwgcmV0ZW50aW9uU3RhcnQsIG5vdyB9ID0gZGVjb2RlUGFnZShnb2xkZW4oKSwgR09MREVOKTtcblxuICBhc3NlcnQuZXF1YWwoYy5uLCAzKTtcbiAgYXNzZXJ0LmVxdWFsKG1heElkLCAzKTtcbiAgLy8gMjAyNi0wOC0wMVQxMjowMDowMFogbWludXMgMjRoLCBhbmQgcGx1cyAxMHMuXG4gIGFzc2VydC5lcXVhbChyZXRlbnRpb25TdGFydCwgRGF0ZS5VVEMoMjAyNiwgNiwgMzEsIDEyLCAwLCAwKSk7XG4gIGFzc2VydC5lcXVhbChub3csIERhdGUuVVRDKDIwMjYsIDcsIDEsIDEyLCAwLCAxMCkpO1xuXG4gIGFzc2VydC5kZWVwRXF1YWwoWy4uLmMudS5pZF0sIFsxLCAyLCAzXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoWy4uLmMuei5zdGFydF0sIFtcbiAgICBEYXRlLlVUQygyMDI2LCA3LCAxLCAxMiwgMCwgMCksXG4gICAgRGF0ZS5VVEMoMjAyNiwgNywgMSwgMTIsIDAsIDEsIDUwMCksXG4gICAgRGF0ZS5VVEMoMjAyNiwgNywgMSwgMTIsIDAsIDQpLFxuICBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChbLi4uYy5wLmR1cl0sIFszLCAxMiwgMjUwXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoWy4uLmMucC5zdGF0dXNdLCBbMCwgMjAwLCA1MDJdKTtcblxuICBhc3NlcnQuZGVlcEVxdWFsKFswLCAxLCAyXS5tYXAoKGkpID0+IHN0cmluZ0F0KGMsICdraW5kJywgaSkpLFxuICAgIFsnd2ViaG9vaycsICdyZXF1ZXN0JywgJ3JlcXVlc3QnXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoWzAsIDEsIDJdLm1hcCgoaSkgPT4gc3RyaW5nQXQoYywgJ2xhbmUnLCBpKSksXG4gICAgWydcdTIxRDAgcHVzaCcsICdHRVQgL3JlcG9zL3tvd25lcn0ve3JlcG99L3B1bGxzJywgJ1BPU1QgL2dyYXBocWwnXSk7XG5cbn0pO1xuXG50ZXN0KCdub24tQVNDSUkgc3Vydml2ZXMgdGhlIGRpY3Rpb25hcnknLCAoKSA9PiB7XG4gIGNvbnN0IHsgYyB9ID0gZGVjb2RlUGFnZShnb2xkZW4oKSwgR09MREVOKTtcbiAgYXNzZXJ0LmVxdWFsKHN0cmluZ0F0KGMsICdkZWxpdmVyeV9pZCcsIDApLCAnZC1cdTAwRENuaWNvZGUtMScpO1xufSk7XG5cbnRlc3QoJ2EgY29sdW1uIG5vIHJvdyB1c2VkIHJlYWRzIGVtcHR5IGZvciBldmVyeSByb3cnLCAoKSA9PiB7XG4gIC8vIFRoZSBlbmNvZGVyIHdyaXRlcyBzdWNoIGEgY29sdW1uIGFzIGEgb25lLWVudHJ5IGRpY3Rpb25hcnkgYW5kIE5PIGluZGV4IHJ1biBcdTIwMTQgdGhlIGNvbXByZXNzaW9uIHRoYXQgbWFrZXMgdGhlIGZvcm1hdCBzbWFsbC5cbiAgY29uc3QgeyBjIH0gPSBkZWNvZGVQYWdlKGdvbGRlbigpLCBHT0xERU4pO1xuICBhc3NlcnQuZXF1YWwoYy5zLmRldGFpbC5pZHgsIG51bGwsICdkZXRhaWwgc2hvdWxkIGNhcnJ5IG5vIGluZGV4IHJ1bicpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGMubjsgaSsrKSBhc3NlcnQuZXF1YWwoc3RyaW5nQXQoYywgJ2RldGFpbCcsIGkpLCAnJyk7XG4gIC8vIFNhbWUgZm9yIHRoZSBiaXRzZXQgYW5kIHRoZSB1bnVzZWQgbnVtZXJpYyBjb2x1bW4uXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYy5uOyBpKyspIGFzc2VydC5lcXVhbChiaXRBdChjLCAnZmluYWwnLCBpKSwgZmFsc2UpO1xuICBhc3NlcnQuZGVlcEVxdWFsKFsuLi5jLnAuYXR0ZW1wdF0sIFswLCAwLCAwXSk7XG59KTtcblxudGVzdCgnYSB2YWx1ZSBwcmVzZW50IG9uIG9ubHkgc29tZSByb3dzIHN0YXlzIG9uIGl0cyBvd24gcm93JywgKCkgPT4ge1xuICBjb25zdCB7IGMgfSA9IGRlY29kZVBhZ2UoZ29sZGVuKCksIEdPTERFTik7XG4gIGFzc2VydC5kZWVwRXF1YWwoWzAsIDEsIDJdLm1hcCgoaSkgPT4gc3RyaW5nQXQoYywgJ2FjdG9yX25hbWUnLCBpKSksXG4gICAgWycnLCAnUGF6ZXJPUCcsICcnXSk7XG5cbn0pO1xuXG50ZXN0KCdyb3dPZklkIGJpbmFyeS1zZWFyY2hlcyB0aGUgYXNjZW5kaW5nIGlkIGNvbHVtbicsICgpID0+IHtcbiAgY29uc3QgeyBjIH0gPSBkZWNvZGVQYWdlKGdvbGRlbigpLCBHT0xERU4pO1xuICBhc3NlcnQuZXF1YWwocm93T2ZJZChjLCAnaWQnLCAxKSwgMCk7XG4gIGFzc2VydC5lcXVhbChyb3dPZklkKGMsICdpZCcsIDIpLCAxKTtcbiAgYXNzZXJ0LmVxdWFsKHJvd09mSWQoYywgJ2lkJywgMyksIDIpO1xuICBhc3NlcnQuZXF1YWwocm93T2ZJZChjLCAnaWQnLCA0KSwgLTEsICdhIG1pc3NpbmcgaWQgaXMgLTEsIG5ldmVyIGEgd3Jvbmcgcm93Jyk7XG4gIGFzc2VydC5lcXVhbChyb3dPZklkKGMsICdpZCcsIDApLCAtMSk7XG59KTtcblxudGVzdCgncm93T2JqZWN0IG1hdGVyaWFsaXplcyBldmVyeSBjb2x1bW4gb2Ygb25lIHJvdycsICgpID0+IHtcbiAgY29uc3QgeyBjIH0gPSBkZWNvZGVQYWdlKGdvbGRlbigpLCBHT0xERU4pO1xuICBjb25zdCByb3cgPSByb3dPYmplY3QoYywgMSk7XG4gIGFzc2VydC5lcXVhbChyb3cuaWQsIDIpO1xuICBhc3NlcnQuZXF1YWwocm93LnN0YXR1cywgMjAwKTtcbiAgYXNzZXJ0LmVxdWFsKHJvdy5sYW5lLCAnR0VUIC9yZXBvcy97b3duZXJ9L3tyZXBvfS9wdWxscycpO1xuICBhc3NlcnQuZXF1YWwocm93LmFjdG9yX25hbWUsICdQYXplck9QJyk7XG4gIGFzc2VydC5lcXVhbChyb3cuZmluYWwsIGZhbHNlKTtcbiAgYXNzZXJ0LmVxdWFsKHJvdy5kZWxpdmVyeV9pZCwgJycsICdhIGNvbHVtbiB0aGlzIHJvdyBkb2VzIG5vdCB1c2UgaXMgcHJlc2VudCBhbmQgZW1wdHknKTtcbn0pO1xuXG50ZXN0KCdhIHRydW5jYXRlZCBvciBjb3JydXB0IHBheWxvYWQgdGhyb3dzIHJhdGhlciB0aGFuIGRlY29kaW5nIGdhcmJhZ2UnLCAoKSA9PiB7XG4gIGNvbnN0IGdvb2QgPSBnb2xkZW4oKTtcbiAgYXNzZXJ0LnRocm93cygoKSA9PiBkZWNvZGVQYWdlKGdvb2Quc3ViYXJyYXkoMCwgZ29vZC5sZW5ndGggLSA0KSwgR09MREVOKSxcbiAgICAvdHJ1bmNhdGVkfHRyYWlsaW5nLyk7XG5cbiAgY29uc3QgYmFkTWFnaWMgPSBnb2xkZW4oKTtcbiAgYmFkTWFnaWNbMF0gPSAweDU4OyAvLyBcIlhcIlxuICBhc3NlcnQudGhyb3dzKCgpID0+IGRlY29kZVBhZ2UoYmFkTWFnaWMsIEdPTERFTiksIC9iYWQgbWFnaWMvKTtcblxuICAvLyBUcmFpbGluZyBieXRlcyBtZWFuIHRoZSByZWFkZXIgYW5kIHRoZSB3cml0ZXIgZGlzYWdyZWUgYWJvdXQgdGhlIGxheW91dCwgZXZlbiB0aG91Z2ggZXZlcnl0aGluZyB1cCB0byBoZXJlIHBhcnNlZC5cbiAgY29uc3QgZXh0cmEgPSBuZXcgVWludDhBcnJheShnb29kLmxlbmd0aCArIDEpO1xuICBleHRyYS5zZXQoZ29vZCk7XG4gIGFzc2VydC50aHJvd3MoKCkgPT4gZGVjb2RlUGFnZShleHRyYSwgR09MREVOKSwgL3RyYWlsaW5nIGJ5dGVzLyk7XG59KTtcblxudGVzdCgndGhlIHNjaGVtYSBkcml2ZXMgdGhlIGxheW91dCBcdTIwMTQgYSB3cm9uZyBjb2x1bW4gY291bnQgaXMgY2F1Z2h0JywgKCkgPT4ge1xuICBjb25zdCBzaG9ydDogV2lyZVNjaGVtYSA9IHsgLi4uR09MREVOLCBzdHJpbmdzOiBHT0xERU4uc3RyaW5ncy5zbGljZSgwLCAtMSkgfTtcbiAgYXNzZXJ0LnRocm93cygoKSA9PiBkZWNvZGVQYWdlKGdvbGRlbigpLCBzaG9ydCksIC90cmFpbGluZyBieXRlcy8pO1xufSk7XG5cbnRlc3QoJ2RlY29kZVBhZ2VHZW4geWllbGRzLCBzbyBhIHBhZ2UgY2FuIGJlIHNwcmVhZCBhY3Jvc3MgZnJhbWVzJywgKCkgPT4ge1xuICBsZXQgc3RlcHMgPSAwO1xuICBjb25zdCBnZW4gPSBkZWNvZGVQYWdlR2VuKGdvbGRlbigpLCBHT0xERU4pO1xuICBsZXQgciA9IGdlbi5uZXh0KCk7XG4gIHdoaWxlICghci5kb25lKSB7XG4gICAgc3RlcHMrKztcbiAgICByID0gZ2VuLm5leHQoKTtcbiAgICBhc3NlcnQub2soc3RlcHMgPCAxMDAwLCAnZ2VuZXJhdG9yIG11c3QgdGVybWluYXRlJyk7XG4gIH1cbiAgYXNzZXJ0Lm9rKHN0ZXBzID4gMCwgJ2EgZGVjb2RlIG11c3QgYmUgaW50ZXJydXB0aWJsZSwgbm90IG9uZSBibG9ja2luZyBzdGVwJyk7XG4gIGFzc2VydC5lcXVhbChyLnZhbHVlLmMubiwgMyk7XG4gIC8vIERyYWluaW5nIGJ5IGhhbmQgYW5kIHZpYSBkcmFpbigpIG11c3QgYWdyZWUuXG4gIGFzc2VydC5lcXVhbChkcmFpbihkZWNvZGVQYWdlR2VuKGdvbGRlbigpLCBHT0xERU4pKS5tYXhJZCwgMyk7XG59KTtcblxudGVzdCgncnVuU2xpY2VkIGNvbXBsZXRlcyBhIHRhc2sgYW5kIHJlcG9ydHMgZWFjaCBjaHVuayBpdCByYW4nLCBhc3luYyAoKSA9PiB7XG4gIC8vIFVuZGVyIG5vZGUgdGhlcmUgYXJlIG5vIGZyYW1lcywgc28gdGhpcyBjaGVja3MgdGhlIGNvbnRyYWN0IHRoYXQgbWF0dGVycyBvZmYtYnJvd3Nlci5cbiAgY29uc3Qgc2xpY2VzOiBudW1iZXJbXSA9IFtdO1xuICBjb25zdCBwYWdlID0gYXdhaXQgcnVuU2xpY2VkKGRlY29kZVBhZ2VHZW4oZ29sZGVuKCksIEdPTERFTiksIChtcykgPT4gc2xpY2VzLnB1c2gobXMpKTtcbiAgYXNzZXJ0LmVxdWFsKHBhZ2UuYy5uLCAzKTtcbiAgYXNzZXJ0Lm9rKHNsaWNlcy5sZW5ndGggPiAwLCAnb25TbGljZSBtdXN0IHNlZSBldmVyeSBjaHVuaycpO1xuICBmb3IgKGNvbnN0IG1zIG9mIHNsaWNlcykgYXNzZXJ0Lm9rKG1zID49IDAgJiYgbXMgPCBDSFVOS19NUyArIDUwLCBgaW1wbGF1c2libGUgc2xpY2UgJHttc31tc2ApO1xufSk7XG4iLCAiLy8gQSBDT0xVTU5BUiBXSVJFIEZPUk1BVCBmb3IgZmVlZGluZyA8dGltZWxpbmUtdmlldz4gYSBsb3Qgb2YgZXZlbnRzIGNoZWFwbHksXG4vLyBwbHVzIHRoZSBmcmFtZS1wYWNlZCBkcml2ZXIgdGhhdCBkZWNvZGVzIG9uZSB3aXRob3V0IGJsb2NraW5nIHRoZSBwYWdlLlxuXG4vKiogSG93IGEgcGF5bG9hZCdzIGNvbHVtbnMgYXJlIG5hbWVkIGFuZCBlbmNvZGVkLiBTdXBwbGllZCBieSB0aGUgY29uc3VtZXI6XG4gKiAgdGhlIGZvcm1hdCBpcyBhIGxheW91dCwgdGhlIG5hbWVzIGFyZSB0aGUgY29uc3VtZXIncyBvd24uICovXG5leHBvcnQgaW50ZXJmYWNlIFdpcmVTY2hlbWEge1xuICAgIC8qKiBhIGZldyBjaGFyYWN0ZXJzLCBjaGVja2VkIGFnYWluc3QgdGhlIHBheWxvYWQncyBmaXJzdCBhIGZldyBieXRlcy4gKi9cbiAgICBtYWdpYzogc3RyaW5nO1xuICAgIC8qKiBBc2NlbmRpbmcgdW5zaWduZWQgdmFsdWVzLCBkZWx0YS1lbmNvZGVkIChyb3cgaWRzKS4gKi9cbiAgICBkZWx0YVU6IHJlYWRvbmx5IHN0cmluZ1tdO1xuICAgIC8qKiBTaWduZWQgdmFsdWVzLCB6aWd6YWcgZGVsdGEtZW5jb2RlZCAoZXBvY2gtbXMgdGltZXN0YW1wcykuICovXG4gICAgZGVsdGFaOiByZWFkb25seSBzdHJpbmdbXTtcbiAgICAvKiogUGxhaW4gdW5zaWduZWQgdmFsdWVzLCBvbmUgdXZhcmludCBwZXIgcm93IChkdXJhdGlvbnMsIGNvZGVzKS4gKi9cbiAgICBwbGFpbjogcmVhZG9ubHkgc3RyaW5nW107XG4gICAgLyoqIEJvb2xlYW5zLCBvbmUgYml0IHBlciByb3cuICovXG4gICAgYml0czogcmVhZG9ubHkgc3RyaW5nW107XG4gICAgLyoqIFN0cmluZ3MsIGRpY3Rpb25hcnktZW5jb2RlZCB3aXRoIG9uZSBpbmRleCBwZXIgcm93LiAqL1xuICAgIHN0cmluZ3M6IHJlYWRvbmx5IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN0cmluZ0NvbHVtbiB7XG4gICAgZGljdDogc3RyaW5nW107XG4gICAgLyogKi9cbiAgICBpZHg6IEludDMyQXJyYXkgfCBudWxsO1xufVxuXG4vKiogT25lIGRlY29kZWQgcGFnZS4gTnVtYmVycyBsYW5kIGluIHR5cGVkIGFycmF5cywgc3RyaW5ncyBpbiBkaWN0aW9uYXJpZXM7XG4gKiAgbm8gcGVyLXJvdyBvYmplY3QgZXhpc3RzIHVudGlsIHtAbGluayByb3dPYmplY3R9IGJ1aWxkcyBvbmUuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbHVtbnMge1xuICAgIG46IG51bWJlcjtcbiAgICAvKiogRGVsdGEtZGVjb2RlZCB1bnNpZ25lZCBjb2x1bW5zLiAqL1xuICAgIHU6IFJlY29yZDxzdHJpbmcsIEZsb2F0NjRBcnJheT47XG4gICAgLyoqIERlbHRhLWRlY29kZWQgc2lnbmVkIGNvbHVtbnMgKGVwb2NoIG1zKSwgc2FtZSByZWFzb24uICovXG4gICAgejogUmVjb3JkPHN0cmluZywgRmxvYXQ2NEFycmF5PjtcbiAgICAvKiogUGxhaW4gdW5zaWduZWQgY29sdW1ucy4gKi9cbiAgICBwOiBSZWNvcmQ8c3RyaW5nLCBJbnQzMkFycmF5PjtcbiAgICAvKiogQml0c2V0czsgcmVhZCB3aXRoIHtAbGluayBiaXRBdH0uICovXG4gICAgYjogUmVjb3JkPHN0cmluZywgVWludDhBcnJheT47XG4gICAgLyoqIERpY3Rpb25hcnktZW5jb2RlZCBzdHJpbmcgY29sdW1uczsgcmVhZCB3aXRoIHtAbGluayBzdHJpbmdBdH0uICovXG4gICAgczogUmVjb3JkPHN0cmluZywgU3RyaW5nQ29sdW1uPjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBEZWNvZGVkUGFnZSB7XG4gICAgYzogQ29sdW1ucztcbiAgICAvKiogTmV3ZXN0IHJvdyBpZCBvbiB0aGlzIHBhZ2UgXHUyMDE0IHBhc3MgYmFjayBhcyB0aGUgbmV4dCByZXF1ZXN0J3MgY3Vyc29yLiAqL1xuICAgIG1heElkOiBudW1iZXI7XG4gICAgLyoqIEVwb2NoIG1zOiBub3RoaW5nIG9sZGVyIHRoYW4gdGhpcyBpcyByZXRhaW5lZCBieSB0aGUgcHJvZHVjZXIuICovXG4gICAgcmV0ZW50aW9uU3RhcnQ6IG51bWJlcjtcbiAgICAvKiogRXBvY2ggbXM6IHRoZSBwcm9kdWNlcidzIGNsb2NrIHdoZW4gaXQgYW5zd2VyZWQuICovXG4gICAgbm93OiBudW1iZXI7XG59XG5cbi8qKiBBIHJlc3VtYWJsZSB1bml0IG9mIHdvcms6IHlpZWxkcyBwZXJpb2RpY2FsbHksIHJldHVybnMgaXRzIHJlc3VsdC4gKi9cbmV4cG9ydCB0eXBlIFRhc2s8VD4gPSBHZW5lcmF0b3I8dW5kZWZpbmVkLCBULCB1bmRlZmluZWQ+O1xuXG4vLyAtLS0tIHBhY2luZyAtLS0tIE9ORSBDSFVOSyBQRVIgRlJBTUUsIHdoZXJlIGEgY2h1bmsgaXMgQSBGUkFNRSdTIFdPUlRIIE9GIFdPUksgXHUyMDE0IG5vdCBvbmUgc3RlcC5cblxuLyoqIEEgZnJhbWUncyB3b3J0aCBvZiBkZWNvZGUgd29yay4gKi9cbmV4cG9ydCBjb25zdCBDSFVOS19NUyA9IDQ7XG5cbi8qKiBSb3dzIHBlciBnZW5lcmF0b3Igc3RlcC4gKi9cbmV4cG9ydCBjb25zdCBTVEVQID0gMTAyNDtcblxubGV0IGZyYW1lU2VxID0gMDtcbmxldCBmcmFtZVBlbmRpbmc6IFByb21pc2U8dm9pZD4gfCBudWxsID0gbnVsbDtcbi8vIFdhaXRlcnMgdGFrZSBmcmFtZXMgaW4gdHVybjogTiBjb25jdXJyZW50IGxvYWRzIHNwcmVhZCBvdmVyIE4gZnJhbWVzIGluc3RlYWQgb2Ygc2hhcmluZyBvbmUuXG5sZXQgZnJhbWVRdWV1ZTogUHJvbWlzZTx2b2lkPiA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG5mdW5jdGlvbiB5aWVsZFRvQnJvd3NlcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzY2hlZCA9IChnbG9iYWxUaGlzIGFzIHsgc2NoZWR1bGVyPzogeyB5aWVsZD86ICgpID0+IFByb21pc2U8dm9pZD4gfSB9KS5zY2hlZHVsZXI7XG4gICAgaWYgKHR5cGVvZiBzY2hlZD8ueWllbGQgPT09ICdmdW5jdGlvbicpIHJldHVybiBzY2hlZC55aWVsZCgpO1xuICAgIHJldHVybiBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgICAgICBjb25zdCBjaCA9IG5ldyBNZXNzYWdlQ2hhbm5lbCgpO1xuICAgICAgICBjaC5wb3J0MS5vbm1lc3NhZ2UgPSAoKTogdm9pZCA9PiB7XG4gICAgICAgICAgICBjaC5wb3J0MS5jbG9zZSgpO1xuICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICB9O1xuICAgICAgICBjaC5wb3J0Mi5wb3N0TWVzc2FnZSgwKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gYWZ0ZXJOZXh0RnJhbWUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGZyYW1lUGVuZGluZykgcmV0dXJuIGZyYW1lUGVuZGluZztcbiAgICBjb25zdCBzdGFydCA9IGZyYW1lU2VxO1xuICAgIGZyYW1lUGVuZGluZyA9IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XG4gICAgICAgIGNvbnN0IHdhaXQgPSAoKTogdm9pZCA9PiB7XG4gICAgICAgICAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGZyYW1lU2VxKys7XG4gICAgICAgICAgICAgICAgLy8gUmVzdW1lIGluIGEgRlJFU0ggVEFTSyBhZnRlciB0aGUgZnJhbWUncyBjYWxsYmFja3MsIGFuZFxuICAgICAgICAgICAgICAgIC8vIG9ubHkgb25jZSB0aGUgZnJhbWUgY291bnRlciBtb3ZlZC5cbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZyYW1lU2VxID4gc3RhcnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZyYW1lUGVuZGluZyA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB3YWl0KCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgICAgICB3YWl0KCk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGZyYW1lUGVuZGluZztcbn1cblxuLyoqIFdhaXRzIGZvciBhIGZyYW1lIHRvIHJlbmRlci4gQSBmcmFtZSBpcyBhIGdsb2JhbCBUVVJOIFx1MjAxNCBjb25jdXJyZW50XG4gKiAgbG9hZHMgZ2V0IGRpZmZlcmVudCBmcmFtZXMgcmF0aGVyIHRoYW4gc2hhcmluZyBvbmUuICovXG5leHBvcnQgZnVuY3Rpb24gbmV4dEZyYW1lKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0eXBlb2YgcmVxdWVzdEFuaW1hdGlvbkZyYW1lICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHJldHVybiB5aWVsZFRvQnJvd3NlcigpOyAvLyBub2RlLCB0ZXN0cy5cbiAgICB9XG4gICAgY29uc3QgdHVybiA9IGZyYW1lUXVldWUudGhlbihhZnRlck5leHRGcmFtZSk7XG4gICAgZnJhbWVRdWV1ZSA9IHR1cm4uY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcbiAgICByZXR1cm4gdHVybjtcbn1cblxuLyoqXG4gKiBEcml2ZXMgYSB0YXNrIHRvIGNvbXBsZXRpb24gYXQgb25lIGNodW5rIHBlciBmcmFtZSwgYSBjaHVuayBiZWluZyBDSFVOS19NU1xuICogb2YgcmVhbCB3b3JrLiBgb25TbGljZWAgcmVwb3J0cyBlYWNoIGNodW5rJ3MgbWVhc3VyZWQgY29zdC5cbiAqXG4gKiBUaGUgZnJhbWUgaXMgY2xhaW1lZCBCRUZPUkUgdGhlIHdvcmssIG5ldmVyIGFmdGVyOiB5aWVsZGluZyBhZnRlcndhcmRzXG4gKiBsZWF2ZXMgc2VhbXMgd2hlcmUgYSB0YXNrJ3MgbGFzdCBjaHVuayBhbmQgdGhlIG5leHQgZmxvdydzIGZpcnN0IG9uZSBib3RoXG4gKiBydW4gdW53YWl0ZWQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5TbGljZWQ8VD4odGFzazogVGFzazxUPiwgb25TbGljZT86IChtczogbnVtYmVyKSA9PiB2b2lkKTogUHJvbWlzZTxUPiB7XG4gICAgZm9yICg7Oykge1xuICAgICAgICBhd2FpdCBuZXh0RnJhbWUoKTtcbiAgICAgICAgY29uc3QgdDAgPSBwZXJmb3JtYW5jZS5ub3coKTtcbiAgICAgICAgbGV0IHI6IEl0ZXJhdG9yUmVzdWx0PHVuZGVmaW5lZCwgVD47XG4gICAgICAgIGRvIHtcbiAgICAgICAgICAgIHIgPSB0YXNrLm5leHQoKTtcbiAgICAgICAgfSB3aGlsZSAoIXIuZG9uZSAmJiBwZXJmb3JtYW5jZS5ub3coKSAtIHQwIDwgQ0hVTktfTVMpO1xuICAgICAgICBvblNsaWNlPy4ocGVyZm9ybWFuY2Uubm93KCkgLSB0MCk7XG4gICAgICAgIGlmIChyLmRvbmUpIHJldHVybiByLnZhbHVlO1xuICAgIH1cbn1cblxuLyoqIFJ1bnMgYSB0YXNrIHN0cmFpZ2h0IHRocm91Z2gsIGZvciBjYWxsZXJzIG5vdCBvbiBhIGZyYW1lIGJ1ZGdldC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkcmFpbjxUPih0YXNrOiBUYXNrPFQ+KTogVCB7XG4gICAgbGV0IHIgPSB0YXNrLm5leHQoKTtcbiAgICB3aGlsZSAoIXIuZG9uZSkgciA9IHRhc2submV4dCgpO1xuICAgIHJldHVybiByLnZhbHVlO1xufVxuXG4vLyAtLS0tIHJlYWRpbmcgLS0tLVxuXG5jbGFzcyBXaXJlUmVhZGVyIHtcbiAgICBwcml2YXRlIHAgPSAwO1xuICAgIHByaXZhdGUgZGVjID0gbmV3IFRleHREZWNvZGVyKCk7XG4gICAgcHJpdmF0ZSBiOiBVaW50OEFycmF5O1xuXG4gICAgLy8gQW4gZXhwbGljaXQgZmllbGQsIG5vdCBhIGBwcml2YXRlIGI6IFVpbnQ4QXJyYXlgIHBhcmFtZXRlciBwcm9wZXJ0eTpcbiAgICAvLyBub2RlIHJ1bnMgdGhpcyBtb2R1bGUncyB0ZXN0cyBieSBTVFJJUFBJTkcgdHlwZXMuXG4gICAgY29uc3RydWN0b3IoYjogVWludDhBcnJheSkge1xuICAgICAgICB0aGlzLmIgPSBiO1xuICAgIH1cblxuICAgIHV2YXJpbnQoKTogbnVtYmVyIHtcbiAgICAgICAgbGV0IHggPSAwLCBzID0gMDtcbiAgICAgICAgZm9yICg7Oykge1xuICAgICAgICAgICAgY29uc3QgYyA9IHRoaXMuYlt0aGlzLnArK107XG4gICAgICAgICAgICBpZiAoYyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoJ3RpbWVsaW5lLXdpcmU6IHRydW5jYXRlZCB2YXJpbnQnKTtcbiAgICAgICAgICAgIGlmIChjIDwgMHg4MCkgcmV0dXJuIHggKyBjICogMiAqKiBzO1xuICAgICAgICAgICAgeCArPSAoYyAmIDB4N2YpICogMiAqKiBzO1xuICAgICAgICAgICAgcyArPSA3O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdmFyaW50KCk6IG51bWJlciB7IC8vIHppZ3phZ1xuICAgICAgICBjb25zdCB1ID0gdGhpcy51dmFyaW50KCk7XG4gICAgICAgIHJldHVybiB1ICUgMiA9PT0gMCA/IHUgLyAyIDogLSh1ICsgMSkgLyAyO1xuICAgIH1cblxuICAgIC8vIEJ1bGsgcmVhZGVycy5cbiAgICB1dmFyaW50cyhvdXQ6IEludDMyQXJyYXkgfCBGbG9hdDY0QXJyYXksIGZyb206IG51bWJlciwgdG86IG51bWJlcik6IHZvaWQge1xuICAgICAgICBjb25zdCBiID0gdGhpcy5iO1xuICAgICAgICBsZXQgcCA9IHRoaXMucDtcbiAgICAgICAgZm9yIChsZXQgaSA9IGZyb207IGkgPCB0bzsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCBjMCA9IGJbcCsrXTtcbiAgICAgICAgICAgIGlmIChjMCA8IDB4ODApIHtcbiAgICAgICAgICAgICAgICBvdXRbaV0gPSBjMDtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGxldCB4ID0gYzAgJiAweDdmLCBzaCA9IDc7XG4gICAgICAgICAgICBmb3IgKDs7KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYyA9IGJbcCsrXTtcbiAgICAgICAgICAgICAgICBpZiAoYyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoJ3RpbWVsaW5lLXdpcmU6IHRydW5jYXRlZCB2YXJpbnQnKTtcbiAgICAgICAgICAgICAgICBpZiAoYyA8IDB4ODApIHtcbiAgICAgICAgICAgICAgICAgICAgeCArPSBjICogMiAqKiBzaDtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHggKz0gKGMgJiAweDdmKSAqIDIgKiogc2g7XG4gICAgICAgICAgICAgICAgc2ggKz0gNztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG91dFtpXSA9IHg7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5wID0gcDtcbiAgICB9XG5cbiAgICAvLyBSdW5uaW5nIHN1bXMgb2YgemlnemFnIGRlbHRhcywgc3RyYWlnaHQgaW50byB0aGUgb3V0cHV0IGNvbHVtbi4gVGhlXG4gICAgLy8gYWNjdW11bGF0b3IgaXMgdGhlIHZhbHVlIGFscmVhZHkgd3JpdHRlbiwgc28gYSByYW5nZSByZXN1bWVzIGV4YWN0bHlcbiAgICAvLyB3aGVyZSB0aGUgbGFzdCBvbmUgc3RvcHBlZC5cbiAgICB2YXJpbnRTdW1zKG91dDogRmxvYXQ2NEFycmF5LCBmcm9tOiBudW1iZXIsIHRvOiBudW1iZXIpOiB2b2lkIHtcbiAgICAgICAgY29uc3QgYiA9IHRoaXMuYjtcbiAgICAgICAgbGV0IHAgPSB0aGlzLnAsIGFjYyA9IGZyb20gPT09IDAgPyAwIDogb3V0W2Zyb20gLSAxXTtcbiAgICAgICAgZm9yIChsZXQgaSA9IGZyb207IGkgPCB0bzsgaSsrKSB7XG4gICAgICAgICAgICBsZXQgdSA9IGJbcCsrXTtcbiAgICAgICAgICAgIGlmICh1ID49IDB4ODApIHtcbiAgICAgICAgICAgICAgICB1ICY9IDB4N2Y7XG4gICAgICAgICAgICAgICAgbGV0IHNoID0gNztcbiAgICAgICAgICAgICAgICBmb3IgKDs7KSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGMgPSBiW3ArK107XG4gICAgICAgICAgICAgICAgICAgIGlmIChjID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcigndGltZWxpbmUtd2lyZTogdHJ1bmNhdGVkIHZhcmludCcpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoYyA8IDB4ODApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHUgKz0gYyAqIDIgKiogc2g7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB1ICs9IChjICYgMHg3ZikgKiAyICoqIHNoO1xuICAgICAgICAgICAgICAgICAgICBzaCArPSA3O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGFjYyArPSB1ICUgMiA9PT0gMCA/IHUgLyAyIDogLSh1ICsgMSkgLyAyO1xuICAgICAgICAgICAgb3V0W2ldID0gYWNjO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMucCA9IHA7XG4gICAgfVxuXG4gICAgLy8gUnVubmluZyBzdW1zIG9mIHVuc2lnbmVkIGRlbHRhcyAoaWRzKSwgc2FtZSByZXN1bXB0aW9uIHJ1bGUuXG4gICAgdXZhcmludFN1bXMob3V0OiBGbG9hdDY0QXJyYXksIGZyb206IG51bWJlciwgdG86IG51bWJlcik6IHZvaWQge1xuICAgICAgICBjb25zdCBiID0gdGhpcy5iO1xuICAgICAgICBsZXQgcCA9IHRoaXMucCwgYWNjID0gZnJvbSA9PT0gMCA/IDAgOiBvdXRbZnJvbSAtIDFdO1xuICAgICAgICBmb3IgKGxldCBpID0gZnJvbTsgaSA8IHRvOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnN0IGMwID0gYltwKytdO1xuICAgICAgICAgICAgaWYgKGMwIDwgMHg4MCkge1xuICAgICAgICAgICAgICAgIG91dFtpXSA9IGFjYyArPSBjMDtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGxldCB4ID0gYzAgJiAweDdmLCBzaCA9IDc7XG4gICAgICAgICAgICBmb3IgKDs7KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYyA9IGJbcCsrXTtcbiAgICAgICAgICAgICAgICBpZiAoYyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoJ3RpbWVsaW5lLXdpcmU6IHRydW5jYXRlZCB2YXJpbnQnKTtcbiAgICAgICAgICAgICAgICBpZiAoYyA8IDB4ODApIHtcbiAgICAgICAgICAgICAgICAgICAgeCArPSBjICogMiAqKiBzaDtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHggKz0gKGMgJiAweDdmKSAqIDIgKiogc2g7XG4gICAgICAgICAgICAgICAgc2ggKz0gNztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG91dFtpXSA9IGFjYyArPSB4O1xuICAgICAgICB9XG4gICAgICAgIHRoaXMucCA9IHA7XG4gICAgfVxuXG4gICAgYnl0ZXMobjogbnVtYmVyKTogVWludDhBcnJheSB7XG4gICAgICAgIGlmICh0aGlzLnAgKyBuID4gdGhpcy5iLmxlbmd0aCkgdGhyb3cgbmV3IEVycm9yKCd0aW1lbGluZS13aXJlOiB0cnVuY2F0ZWQgcGF5bG9hZCcpO1xuICAgICAgICBjb25zdCBvdXQgPSB0aGlzLmIuc3ViYXJyYXkodGhpcy5wLCB0aGlzLnAgKyBuKTtcbiAgICAgICAgdGhpcy5wICs9IG47XG4gICAgICAgIHJldHVybiBvdXQ7XG4gICAgfVxuXG4gICAgc3RyKCk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiB0aGlzLmRlYy5kZWNvZGUodGhpcy5ieXRlcyh0aGlzLnV2YXJpbnQoKSkpO1xuICAgIH1cblxuICAgIC8vIEEgZGljdGlvbmFyeSBjYW4gYmUgbGFyZ2UgKHVuaXF1ZSBpZHMgcGVyIHJvdyksIHNvIHJlYWRpbmcgb25lIGlzXG4gICAgLy8gY2h1bmtlZCBsaWtlIGV2ZXJ5dGhpbmcgZWxzZS5cbiAgICAqZGljdENodW5rZWQoKTogVGFzazxzdHJpbmdbXT4ge1xuICAgICAgICBjb25zdCBuID0gdGhpcy51dmFyaW50KCk7XG4gICAgICAgIGNvbnN0IG91dCA9IG5ldyBBcnJheTxzdHJpbmc+KG4pO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47ICkge1xuICAgICAgICAgICAgY29uc3QgdG8gPSBNYXRoLm1pbihpICsgU1RFUCwgbik7XG4gICAgICAgICAgICBmb3IgKDsgaSA8IHRvOyBpKyspIG91dFtpXSA9IHRoaXMuc3RyKCk7XG4gICAgICAgICAgICB5aWVsZDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gb3V0O1xuICAgIH1cblxuICAgIGV4cGVjdE1hZ2ljKHdhbnQ6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICBjb25zdCBnb3QgPSBTdHJpbmcuZnJvbUNoYXJDb2RlKC4uLnRoaXMuYnl0ZXMoNCkpO1xuICAgICAgICBpZiAoZ290ICE9PSB3YW50KSB0aHJvdyBuZXcgRXJyb3IoYHRpbWVsaW5lLXdpcmU6IGJhZCBtYWdpYyAke0pTT04uc3RyaW5naWZ5KGdvdCl9YCk7XG4gICAgfVxuXG4gICAgYXRFbmQoKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnAgPT09IHRoaXMuYi5sZW5ndGg7XG4gICAgfVxufVxuXG4vKiAqL1xuZnVuY3Rpb24qIGNodW5rZWQobjogbnVtYmVyLCB3b3JrOiAoZnJvbTogbnVtYmVyLCB0bzogbnVtYmVyKSA9PiB2b2lkKTogVGFzazx2b2lkPiB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyApIHtcbiAgICAgICAgY29uc3QgdG8gPSBNYXRoLm1pbihpICsgU1RFUCwgbik7XG4gICAgICAgIHdvcmsoaSwgdG8pO1xuICAgICAgICBpID0gdG87XG4gICAgICAgIHlpZWxkO1xuICAgIH1cbn1cblxuLyoqXG4gKiBEZWNvZGVzIGEgcGF5bG9hZCBpbnRvIGNvbHVtbnMsIHlpZWxkaW5nIGJldHdlZW4gY2h1bmtzIHNvIGEgYmlnIHBhZ2UgbmV2ZXJcbiAqIGJsb2NrcyBhIGZyYW1lLiBEcml2ZSBpdCB3aXRoIHtAbGluayBydW5TbGljZWR9LlxuICpcbiAqIFRocm93cyBvbiBiYWQgbWFnaWMsIGEgdHJ1bmNhdGVkIHBheWxvYWQsIG9yIHRyYWlsaW5nIGJ5dGVzIFx1MjAxNCBhIHBheWxvYWQgdGhhdFxuICogZG9lcyBub3QgZGVjb2RlIGV4YWN0bHkgaXMgbm90IGEgcGF5bG9hZCB0aGF0IGRlY29kZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiogZGVjb2RlUGFnZUdlbihidWY6IFVpbnQ4QXJyYXksIHNjaGVtYTogV2lyZVNjaGVtYSk6IFRhc2s8RGVjb2RlZFBhZ2U+IHtcbiAgICBjb25zdCByID0gbmV3IFdpcmVSZWFkZXIoYnVmKTtcbiAgICByLmV4cGVjdE1hZ2ljKHNjaGVtYS5tYWdpYyk7XG4gICAgY29uc3QgbWF4SWQgPSByLnV2YXJpbnQoKTtcbiAgICBjb25zdCByZXRlbnRpb25TdGFydCA9IHIudmFyaW50KCk7XG4gICAgY29uc3Qgbm93ID0gci52YXJpbnQoKTtcbiAgICBjb25zdCBuID0gci51dmFyaW50KCk7XG5cbiAgICBjb25zdCBjOiBDb2x1bW5zID0geyBuLCB1OiB7fSwgejoge30sIHA6IHt9LCBiOiB7fSwgczoge30gfTtcblxuICAgIGZvciAoY29uc3QgbmFtZSBvZiBzY2hlbWEuZGVsdGFVKSB7XG4gICAgICAgIGNvbnN0IG91dCA9IG5ldyBGbG9hdDY0QXJyYXkobik7XG4gICAgICAgIHlpZWxkKiBjaHVua2VkKG4sIChmcm9tLCB0bykgPT4gci51dmFyaW50U3VtcyhvdXQsIGZyb20sIHRvKSk7XG4gICAgICAgIGMudVtuYW1lXSA9IG91dDtcbiAgICB9XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHNjaGVtYS5kZWx0YVopIHtcbiAgICAgICAgY29uc3Qgb3V0ID0gbmV3IEZsb2F0NjRBcnJheShuKTtcbiAgICAgICAgeWllbGQqIGNodW5rZWQobiwgKGZyb20sIHRvKSA9PiByLnZhcmludFN1bXMob3V0LCBmcm9tLCB0bykpO1xuICAgICAgICBjLnpbbmFtZV0gPSBvdXQ7XG4gICAgfVxuICAgIGZvciAoY29uc3QgbmFtZSBvZiBzY2hlbWEucGxhaW4pIHtcbiAgICAgICAgY29uc3Qgb3V0ID0gbmV3IEludDMyQXJyYXkobik7XG4gICAgICAgIHlpZWxkKiBjaHVua2VkKG4sIChmcm9tLCB0bykgPT4gci51dmFyaW50cyhvdXQsIGZyb20sIHRvKSk7XG4gICAgICAgIGMucFtuYW1lXSA9IG91dDtcbiAgICB9XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHNjaGVtYS5iaXRzKSB7XG4gICAgICAgIGMuYltuYW1lXSA9IHIuYnl0ZXMoKG4gKyA3KSA+PiAzKTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHNjaGVtYS5zdHJpbmdzKSB7XG4gICAgICAgIGNvbnN0IGRpY3QgPSB5aWVsZCogci5kaWN0Q2h1bmtlZCgpO1xuICAgICAgICBpZiAoZGljdC5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAgIGMuc1tuYW1lXSA9IHsgZGljdCwgaWR4OiBudWxsIH07IC8vIGNvbHVtbiB1bnVzZWQgaW4gdGhpcyB3aW5kb3dcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGlkeCA9IG5ldyBJbnQzMkFycmF5KG4pO1xuICAgICAgICB5aWVsZCogY2h1bmtlZChuLCAoZnJvbSwgdG8pID0+IHIudXZhcmludHMoaWR4LCBmcm9tLCB0bykpO1xuICAgICAgICBjLnNbbmFtZV0gPSB7IGRpY3QsIGlkeCB9O1xuICAgIH1cbiAgICBpZiAoIXIuYXRFbmQoKSkgdGhyb3cgbmV3IEVycm9yKCd0aW1lbGluZS13aXJlOiB0cmFpbGluZyBieXRlcyBpbiBwYXlsb2FkJyk7XG4gICAgcmV0dXJuIHsgYywgbWF4SWQsIHJldGVudGlvblN0YXJ0LCBub3cgfTtcbn1cblxuLyoqIERlY29kZXMgYSBwYXlsb2FkIGluIG9uZSBnby4gRm9yIHRlc3RzIGFuZCBzbWFsbCBwYWdlczsgdGhlIGNoYXJ0IHVzZXNcbiAqICB7QGxpbmsgZGVjb2RlUGFnZUdlbn0gdW5kZXIge0BsaW5rIHJ1blNsaWNlZH0uICovXG5leHBvcnQgZnVuY3Rpb24gZGVjb2RlUGFnZShidWY6IFVpbnQ4QXJyYXksIHNjaGVtYTogV2lyZVNjaGVtYSk6IERlY29kZWRQYWdlIHtcbiAgICByZXR1cm4gZHJhaW4oZGVjb2RlUGFnZUdlbihidWYsIHNjaGVtYSkpO1xufVxuXG4vLyAtLS0tIHJlYWRpbmcgb25lIHJvdyAtLS0tXG5cbi8qKiBSZWFkcyBhIHN0cmluZyBjb2x1bW4gYXQgb25lIHJvdywgaG9ub3JpbmcgdGhlIHVudXNlZC1jb2x1bW4gZW5jb2RpbmcuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaW5nQXQoYzogQ29sdW1ucywgbmFtZTogc3RyaW5nLCBpOiBudW1iZXIpOiBzdHJpbmcge1xuICAgIGNvbnN0IGNvbCA9IGMuc1tuYW1lXTtcbiAgICBpZiAoIWNvbCkgcmV0dXJuICcnO1xuICAgIHJldHVybiBjb2wuaWR4ID09PSBudWxsID8gKGNvbC5kaWN0WzBdID8/ICcnKSA6IChjb2wuZGljdFtjb2wuaWR4W2ldXSA/PyAnJyk7XG59XG5cbi8qKiBSZWFkcyBhIGJpdHNldCBjb2x1bW4gYXQgb25lIHJvdy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiaXRBdChjOiBDb2x1bW5zLCBuYW1lOiBzdHJpbmcsIGk6IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGJpdHMgPSBjLmJbbmFtZV07XG4gICAgcmV0dXJuIGJpdHMgPyAoYml0c1tpID4+IDNdICYgKDEgPDwgKGkgJiA3KSkpICE9PSAwIDogZmFsc2U7XG59XG5cbi8qICovXG5leHBvcnQgZnVuY3Rpb24gcm93T2ZJZChjOiBDb2x1bW5zLCBpZENvbHVtbjogc3RyaW5nLCBpZDogbnVtYmVyKTogbnVtYmVyIHtcbiAgICBjb25zdCBpZHMgPSBjLnVbaWRDb2x1bW5dO1xuICAgIGlmICghaWRzKSByZXR1cm4gLTE7XG4gICAgbGV0IGxvID0gMCwgaGkgPSBjLm4gLSAxO1xuICAgIHdoaWxlIChsbyA8PSBoaSkge1xuICAgICAgICBjb25zdCBtaWQgPSAobG8gKyBoaSkgPj4gMTtcbiAgICAgICAgY29uc3QgdiA9IGlkc1ttaWRdO1xuICAgICAgICBpZiAodiA9PT0gaWQpIHJldHVybiBtaWQ7XG4gICAgICAgIGlmICh2IDwgaWQpIGxvID0gbWlkICsgMTtcbiAgICAgICAgZWxzZSBoaSA9IG1pZCAtIDE7XG4gICAgfVxuICAgIHJldHVybiAtMTtcbn1cblxuLyoqIE1hdGVyaWFsaXplcyBvbmUgcm93IGFzIGEgZmxhdCBvYmplY3QgXHUyMDE0IGV2ZXJ5IGNvbHVtbiwga2V5ZWQgYnkgbmFtZS4gQ2FsbFxuICogIGl0IG9uY2UgcGVyIHRvb2x0aXAsIG5ldmVyIHBlciByb3cuICovXG5leHBvcnQgZnVuY3Rpb24gcm93T2JqZWN0KGM6IENvbHVtbnMsIGk6IG51bWJlcik6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+IHtcbiAgICBjb25zdCBvdXQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+ID0ge307XG4gICAgZm9yIChjb25zdCBbbmFtZSwgY29sXSBvZiBPYmplY3QuZW50cmllcyhjLnUpKSBvdXRbbmFtZV0gPSBjb2xbaV07XG4gICAgZm9yIChjb25zdCBbbmFtZSwgY29sXSBvZiBPYmplY3QuZW50cmllcyhjLnopKSBvdXRbbmFtZV0gPSBjb2xbaV07XG4gICAgZm9yIChjb25zdCBbbmFtZSwgY29sXSBvZiBPYmplY3QuZW50cmllcyhjLnApKSBvdXRbbmFtZV0gPSBjb2xbaV07XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIE9iamVjdC5rZXlzKGMuYikpIG91dFtuYW1lXSA9IGJpdEF0KGMsIG5hbWUsIGkpO1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiBPYmplY3Qua2V5cyhjLnMpKSBvdXRbbmFtZV0gPSBzdHJpbmdBdChjLCBuYW1lLCBpKTtcbiAgICByZXR1cm4gb3V0O1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFBLE9BQU8sWUFBWTtBQUNuQixTQUFTLG9CQUFvQjtBQUM3QixTQUFTLFlBQVk7OztBQ3dEZCxJQUFNLFdBQVc7QUFHakIsSUFBTSxPQUFPO0FBRXBCLElBQUksV0FBVztBQUNmLElBQUksZUFBcUM7QUFFekMsSUFBSSxhQUE0QixRQUFRLFFBQVE7QUFFaEQsU0FBUyxpQkFBZ0M7QUFDckMsUUFBTSxRQUFTLFdBQStEO0FBQzlFLE1BQUksT0FBTyxPQUFPLFVBQVUsV0FBWSxRQUFPLE1BQU0sTUFBTTtBQUMzRCxTQUFPLElBQUksUUFBYyxDQUFDLFlBQVk7QUFDbEMsVUFBTSxLQUFLLElBQUksZUFBZTtBQUM5QixPQUFHLE1BQU0sWUFBWSxNQUFZO0FBQzdCLFNBQUcsTUFBTSxNQUFNO0FBQ2YsY0FBUTtBQUFBLElBQ1o7QUFDQSxPQUFHLE1BQU0sWUFBWSxDQUFDO0FBQUEsRUFDMUIsQ0FBQztBQUNMO0FBRUEsU0FBUyxpQkFBZ0M7QUFDckMsTUFBSSxhQUFjLFFBQU87QUFDekIsUUFBTSxRQUFRO0FBQ2QsaUJBQWUsSUFB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
