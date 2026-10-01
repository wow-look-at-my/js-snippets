// Tests for the PNG container primitives.
//
// The CRC is checked against published constants rather than against itself: a
// self-consistent CRC that uses the wrong polynomial produces a file every
// decoder rejects, and nothing else in the pipeline would notice. Filtering is
// checked by round-tripping through the inverse, which is what a decoder does.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  concatBytes,
  crc32,
  filterScanlines,
  paeth,
  PNG_SIGNATURE,
  unfilterScanlines,
  writeChunk,
  type FilterStrategy,
} from './png.ts';

const STRATEGIES: FilterStrategy[] = ['none', 'sub', 'up', 'average', 'paeth', 'adaptive'];

test('crc32 matches the standard CRC-32/ISO-HDLC check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('crc32 of the IEND chunk matches the constant every PNG ends with', () => {
  assert.equal(crc32(new TextEncoder().encode('IEND')), 0xae426082);
});

test('crc32 seeding continues a running CRC', () => {
  const a = new TextEncoder().encode('1234');
  const b = new TextEncoder().encode('56789');
  assert.equal(crc32(b, crc32(a)), 0xcbf43926);
});

test('writeChunk frames length, type, data and CRC', () => {
  const chunk = writeChunk('IEND', new Uint8Array(0));
  assert.deepEqual([...chunk], [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

  const data = Uint8Array.from([1, 2, 3]);
  const idat = writeChunk('IDAT', data);
  assert.equal(idat.length, 12 + 3);
  const view = new DataView(idat.buffer);
  assert.equal(view.getUint32(0), 3);
  assert.deepEqual([...idat.subarray(4, 8)], [0x49, 0x44, 0x41, 0x54]);
  assert.deepEqual([...idat.subarray(8, 11)], [1, 2, 3]);
  assert.equal(view.getUint32(11), crc32(idat.subarray(4, 11)));
});

test('writeChunk rejects a type that is not four characters', () => {
  assert.throws(() => writeChunk('IEN', new Uint8Array(0)), /4 characters/);
  assert.throws(() => writeChunk('IENDX', new Uint8Array(0)), /4 characters/);
});

test('PNG signature is the spec byte sequence', () => {
  assert.deepEqual([...PNG_SIGNATURE], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('concatBytes joins in order', () => {
  const out = concatBytes([Uint8Array.from([1, 2]), new Uint8Array(0), Uint8Array.from([3])]);
  assert.deepEqual([...out], [1, 2, 3]);
});

test('paeth picks the neighbour closest to a+b-c, breaking ties a then b', () => {
  // p = 10+20-15 = 15: |15-10|=5, |15-20|=5, |15-15|=0 -> c.
  assert.equal(paeth(10, 20, 15), 15);
  // p = 0+255-0 = 255: b is exact.
  assert.equal(paeth(0, 255, 0), 255);
  // p = 255+0-0 = 255: a is exact.
  assert.equal(paeth(255, 0, 0), 255);
  // p = 20+10-10 = 20: a is exact, and a wins a tie anyway.
  assert.equal(paeth(20, 10, 10), 20);
  assert.equal(paeth(5, 5, 5), 5);
});

// A deterministic image with gradients (predictive filters win), flat runs
// (None wins) and noise (nothing wins), so adaptive has something to choose.
function testImage(width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const raw = new Uint8Array(stride * height);
  let seed = 0x2f6e2b1;
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < stride; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const region = Math.floor((i / stride) * 3);
      raw[y * stride + i] = region === 0 ? (i + y) & 0xff : region === 1 ? 200 : (seed >>> 24) & 0xff;
    }
  }
  return raw;
}

for (const strategy of STRATEGIES) {
  for (const bpp of [1, 4]) {
    test(`filterScanlines (${strategy}, bpp=${bpp}) round-trips through unfilterScanlines`, () => {
      const width = 17;
      const height = 11;
      const raw = testImage(width, height, bpp);
      const filtered = filterScanlines(raw, width * bpp, height, bpp, strategy);
      assert.equal(filtered.length, (width * bpp + 1) * height);
      const back = unfilterScanlines(filtered, width * bpp, height, bpp);
      assert.deepEqual([...back], [...raw]);
    });
  }
}

test('every filter byte is a legal PNG filter type', () => {
  const width = 9;
  const height = 7;
  const raw = testImage(width, height, 4);
  const filtered = filterScanlines(raw, width * 4, height, 4, 'adaptive');
  for (let y = 0; y < height; y++) {
    const type = filtered[y * (width * 4 + 1)];
    assert.ok(type >= 0 && type <= 4, `row ${y} used filter ${type}`);
  }
});

test('a fixed strategy writes its own filter byte on every row', () => {
  const raw = testImage(8, 5, 4);
  const filtered = filterScanlines(raw, 32, 5, 4, 'up');
  for (let y = 0; y < 5; y++) assert.equal(filtered[y * 33], 2);
});

test('adaptive is never worse than the best fixed strategy on residual cost', () => {
  const width = 24;
  const height = 16;
  const raw = testImage(width, height, 4);
  const cost = (bytes: Uint8Array): number => {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      for (let i = 1; i <= width * 4; i++) {
        const v = bytes[y * (width * 4 + 1) + i];
        sum += v < 128 ? v : 256 - v;
      }
    }
    return sum;
  };
  const adaptive = cost(filterScanlines(raw, width * 4, height, 4, 'adaptive'));
  for (const strategy of ['none', 'sub', 'up', 'average', 'paeth'] as const) {
    assert.ok(
      adaptive <= cost(filterScanlines(raw, width * 4, height, 4, strategy)),
      `adaptive (${adaptive}) lost to ${strategy}`,
    );
  }
});

test('unfilterScanlines rejects an unknown filter type', () => {
  const bad = new Uint8Array(4 * 2 + 2);
  bad[0] = 9;
  assert.throws(() => unfilterScanlines(bad, 4, 2, 4), /unknown PNG filter type 9/);
});

test('a single all-zero row filters to zero under every strategy', () => {
  const raw = new Uint8Array(16);
  for (const strategy of STRATEGIES) {
    const filtered = filterScanlines(raw, 16, 1, 4, strategy);
    assert.deepEqual([...filtered.subarray(1)], [...raw], `strategy ${strategy}`);
  }
});
