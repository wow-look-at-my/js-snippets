// Tests for the PURE surface of webgpu/scan.ts: planScan's level hierarchy,
// scratch sizing, and 2D dispatch clamping — plus a faithful JS emulation of
// the WGSL block-scan/addback walk driven by the plan (the same absolute base
// derivation GpuScan.prepare uses), asserted against a naive exclusive scan.
// Imports go through scan-plan.ts (scan.ts re-exports it but ALSO imports the
// .wgsl, which node cannot load); createScan/prepare/encode are GPU-bound and
// are exercised by consumer browser harnesses (e.g. splat-webgpu's verify),
// not under node.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planScan, SCAN_BLOCK_SIZE, SCAN_ADDBACK_SIZE } from './scan-plan.ts';
import type { ScanPlan, ScanDispatch } from './scan-plan.ts';

test('planScan: level structure for boundary counts', () => {
  // count 0: one block still runs so the grand total (0) gets written.
  assert.deepEqual(
    planScan(0).levels.map((l) => ({ count: l.count, blocks: l.blocks, sumsBase: l.sumsBase })),
    [{ count: 0, blocks: 1, sumsBase: 0 }],
  );
  assert.equal(planScan(0).scratchElems, 1);
  assert.equal(planScan(0).grandTotalElem, 0);

  for (const n of [1, 511, 512]) {
    const p = planScan(n);
    assert.equal(p.levels.length, 1, `count ${n}: single level`);
    assert.equal(p.levels[0].blocks, 1, `count ${n}: one block`);
    assert.equal(p.scratchElems, 1);
    assert.equal(p.grandTotalElem, 0);
  }

  const p513 = planScan(513);
  assert.deepEqual(
    p513.levels.map((l) => ({ count: l.count, blocks: l.blocks, sumsBase: l.sumsBase })),
    [
      { count: 513, blocks: 2, sumsBase: 0 },
      { count: 2, blocks: 1, sumsBase: 2 },
    ],
  );
  assert.equal(p513.scratchElems, 3);
  assert.equal(p513.grandTotalElem, 2);

  const p512sq = planScan(512 * 512); // 262144
  assert.deepEqual(
    p512sq.levels.map((l) => ({ count: l.count, blocks: l.blocks, sumsBase: l.sumsBase })),
    [
      { count: 262144, blocks: 512, sumsBase: 0 },
      { count: 512, blocks: 1, sumsBase: 512 },
    ],
  );
  assert.equal(p512sq.scratchElems, 513);

  const p2m = planScan(2_000_000);
  assert.deepEqual(
    p2m.levels.map((l) => ({ count: l.count, blocks: l.blocks, sumsBase: l.sumsBase })),
    [
      { count: 2_000_000, blocks: 3907, sumsBase: 0 },
      { count: 3907, blocks: 8, sumsBase: 3907 },
      { count: 8, blocks: 1, sumsBase: 3915 },
    ],
  );
  assert.equal(p2m.scratchElems, 3916);
  assert.equal(p2m.grandTotalElem, 3915);
});

test('planScan: structural invariants across a count sweep', () => {
  for (const n of [0, 1, 2, 511, 512, 513, 1024, 100_000, 262_144, 262_145, 2_000_000, 1 << 25]) {
    const p = planScan(n);
    assert.equal(p.count, n);
    let cursor = 0;
    for (let i = 0; i < p.levels.length; i++) {
      const l = p.levels[i];
      assert.equal(l.sumsBase, cursor, `count ${n} level ${i}: sums packed after previous levels`);
      assert.equal(l.blocks, Math.max(1, Math.ceil(l.count / SCAN_BLOCK_SIZE)));
      if (i > 0) assert.equal(l.count, p.levels[i - 1].blocks, 'level scans previous block sums');
      cursor += l.blocks;
    }
    assert.equal(p.scratchElems, cursor, `count ${n}: scratch = sum of blocks`);
    assert.equal(p.levels[p.levels.length - 1].blocks, 1, `count ${n}: terminates at one block`);
    assert.equal(p.grandTotalElem, p.levels[p.levels.length - 1].sumsBase);
  }
});

test('planScan: dispatch clamping to maxWorkgroupsPerDim', () => {
  const check = (d: ScanDispatch, needed: number, maxDim: number, what: string) => {
    assert.ok(d.x >= 1 && d.x <= maxDim, `${what}: x ${d.x} within [1, ${maxDim}]`);
    assert.ok(d.y >= 1, `${what}: y >= 1`);
    assert.ok(d.x * d.y >= needed, `${what}: grid covers ${needed}`);
    assert.ok((d.y - 1) * d.x < needed, `${what}: grid is tight`);
  };
  for (const maxDim of [1, 7, 100, 65535]) {
    for (const n of [0, 1, 513, 262_144, 2_000_000]) {
      const p = planScan(n, maxDim);
      for (const [i, l] of p.levels.entries()) {
        check(l.scanDispatch, l.blocks, maxDim, `n=${n} maxDim=${maxDim} L${i} scan`);
        check(
          l.addbackDispatch,
          Math.max(1, Math.ceil(l.count / SCAN_ADDBACK_SIZE)),
          maxDim,
          `n=${n} maxDim=${maxDim} L${i} addback`,
        );
      }
    }
  }
  // Unclamped: everything fits in x.
  for (const l of planScan(2_000_000).levels) {
    assert.equal(l.scanDispatch.y, 1);
    assert.equal(l.addbackDispatch.y, 1);
  }
  assert.equal(planScan(2_000_000).levels[0].scanDispatch.x, 3907);
  assert.equal(planScan(2_000_000).levels[0].addbackDispatch.x, 7813);
});

// ---------------------------------------------------------------------------
// Plan-driven emulation of the WGSL (same walk PreparedScan.encode dispatches,
// same absolute base derivation prepare() bakes into the level uniforms).

function emulateScan(
  data: Uint32Array,
  plan: ScanPlan,
  srcElem: number,
  dstElem: number,
  scratchElem: number,
): void {
  const levels = plan.levels;
  const bases = levels.map((l, i) => {
    const prevSums = i === 0 ? 0 : scratchElem + levels[i - 1].sumsBase;
    return {
      src: i === 0 ? srcElem : prevSums,
      dst: i === 0 ? dstElem : prevSums,
      sums: scratchElem + l.sumsBase,
    };
  });
  // scan_block, levels forward: per block, snapshot (WGSL loads to shared
  // first — makes in-place levels correct), exclusive scan + block total.
  for (let li = 0; li < levels.length; li++) {
    const l = levels[li];
    const b = bases[li];
    for (let block = 0; block < l.blocks; block++) {
      const vals = new Uint32Array(SCAN_BLOCK_SIZE);
      for (let j = 0; j < SCAN_BLOCK_SIZE; j++) {
        const i = block * SCAN_BLOCK_SIZE + j;
        if (i < l.count) vals[j] = data[b.src + i];
      }
      let total = 0;
      for (let j = 0; j < SCAN_BLOCK_SIZE; j++) {
        const i = block * SCAN_BLOCK_SIZE + j;
        if (i < l.count) data[b.dst + i] = total;
        total = (total + vals[j]) >>> 0;
      }
      data[b.sums + block] = total;
    }
  }
  // scan_addback, levels length-2 .. 0.
  for (let li = levels.length - 2; li >= 0; li--) {
    const l = levels[li];
    const b = bases[li];
    for (let i = 0; i < l.count; i++) {
      data[b.dst + i] = (data[b.dst + i] + data[b.sums + Math.floor(i / SCAN_BLOCK_SIZE)]) >>> 0;
    }
  }
}

test('plan-driven emulation matches a naive exclusive scan (offset regions)', () => {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0), seed % 8);
  const SENTINEL = 0xdeadbeef;

  for (const n of [0, 1, 2, 511, 512, 513, 1000, 4096, 100_000]) {
    const plan = planScan(n);
    // Regions with gaps: [pad][src n][pad][dst n][pad][scratch][pad].
    const srcElem = 3;
    const dstElem = srcElem + n + 2;
    const scratchElem = dstElem + n + 2;
    const data = new Uint32Array(scratchElem + plan.scratchElems + 2).fill(SENTINEL);
    const src = new Uint32Array(n);
    for (let i = 0; i < n; i++) src[i] = rand();
    data.set(src, srcElem);

    emulateScan(data, plan, srcElem, dstElem, scratchElem);

    let acc = 0;
    for (let i = 0; i < n; i++) {
      assert.equal(data[dstElem + i], acc >>> 0, `n=${n}: dst[${i}]`);
      acc = (acc + src[i]) >>> 0;
    }
    assert.equal(data[scratchElem + plan.grandTotalElem], acc >>> 0, `n=${n}: grand total`);
    for (let i = 0; i < n; i++) assert.equal(data[srcElem + i], src[i], `n=${n}: src preserved`);
    for (const g of [0, 1, 2, srcElem + n, srcElem + n + 1, dstElem + n, dstElem + n + 1,
      scratchElem - 1, data.length - 1]) {
      assert.equal(data[g], SENTINEL, `n=${n}: gap element ${g} untouched`);
    }
  }
});

test('plan-driven emulation: in-place (dst == src)', () => {
  const n = 5000;
  const plan = planScan(n);
  const srcElem = 5;
  const scratchElem = srcElem + n + 1;
  const data = new Uint32Array(scratchElem + plan.scratchElems);
  const src = new Uint32Array(n);
  let seed = 99;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    src[i] = seed % 16;
  }
  data.set(src, srcElem);

  emulateScan(data, plan, srcElem, srcElem, scratchElem);

  let acc = 0;
  for (let i = 0; i < n; i++) {
    assert.equal(data[srcElem + i], acc >>> 0, `in-place dst[${i}]`);
    acc = (acc + src[i]) >>> 0;
  }
  assert.equal(data[scratchElem + plan.grandTotalElem], acc >>> 0, 'in-place grand total');
});
