// PNG container primitives: CRC-32, chunk framing, and scanline filtering.
// Pure — no DOM, no browser APIs — so it runs and is tested under node.
//
// Filtering is where most of a PNG's compression comes from: each scanline is
// prefixed with a filter byte and its pixels are stored as residuals against
// already-decoded neighbours, which turns smooth gradients into runs of small
// numbers deflate can pack. `filterScanlines` implements all five spec filters
// plus the adaptive selector every real encoder uses.

/** The 8-byte PNG file signature that opens every stream. */
export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// -- CRC-32 --------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * PNG's CRC-32 (IEEE 802.3, the zlib polynomial) over `bytes`.
 *
 * `seed` continues a running CRC and is the *finalised* value of the previous
 * call, so a chunk's CRC can be computed over its type and data separately:
 * `crc32(data, crc32(typeBytes))`.
 */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// -- Chunks --------------------------------------------------------------------

/**
 * Frame one PNG chunk: length, 4-byte ASCII type, data, CRC-32 of type+data.
 * `type` must be exactly 4 characters.
 */
export function writeChunk(type: string, data: Uint8Array): Uint8Array {
  if (type.length !== 4) throw new Error(`PNG chunk type must be 4 characters, got ${JSON.stringify(type)}`);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Concatenate byte runs into one buffer. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// -- Scanline filtering --------------------------------------------------------

/**
 * How `filterScanlines` picks a filter byte per row.
 *
 * `adaptive` is the standard minimum-sum-of-absolute-differences heuristic:
 * try all five and keep the row whose residuals are smallest as signed bytes.
 * The fixed strategies exist because they are cheaper and sometimes win — a
 * frame whose unchanged pixels were zeroed out is mostly zero runs, which
 * `none` leaves intact and the predictive filters would churn.
 */
export type FilterStrategy = 'none' | 'sub' | 'up' | 'average' | 'paeth' | 'adaptive';

/** The filter strategies, in the order a UI should offer them. */
export const FILTER_STRATEGIES: readonly FilterStrategy[] = [
  'adaptive',
  'none',
  'sub',
  'up',
  'average',
  'paeth',
];

/** PNG's Paeth predictor: whichever of a (left), b (above), c (upper-left) is closest to a+b-c. */
export function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

const FIXED_FILTER: Record<Exclude<FilterStrategy, 'adaptive'>, number> = {
  none: 0,
  sub: 1,
  up: 2,
  average: 3,
  paeth: 4,
};

// Apply filter `type` to one row, writing `stride` residual bytes into `dst`.
// `row` / `prev` are the raw (unfiltered) current and previous scanlines;
// `prev` is all-zero for the first row, exactly as the spec requires.
function filterRow(
  dst: Uint8Array,
  dstAt: number,
  row: Uint8Array,
  prev: Uint8Array | null,
  stride: number,
  bpp: number,
  type: number,
): void {
  for (let i = 0; i < stride; i++) {
    const x = row[i];
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = prev && i >= bpp ? prev[i - bpp] : 0;
    let v: number;
    switch (type) {
      case 1: v = x - a; break;
      case 2: v = x - b; break;
      case 3: v = x - ((a + b) >> 1); break;
      case 4: v = x - paeth(a, b, c); break;
      default: v = x; break;
    }
    dst[dstAt + i] = v & 0xff;
  }
}

// The adaptive heuristic's cost: sum of |residual| read as a signed byte.
function rowCost(bytes: Uint8Array, at: number, stride: number): number {
  let sum = 0;
  for (let i = 0; i < stride; i++) {
    const v = bytes[at + i];
    sum += v < 128 ? v : 256 - v;
  }
  return sum;
}

/**
 * Filter `height` raw scanlines of `stride` bytes each into the PNG's
 * pre-compression form: one filter byte followed by `stride` residual bytes
 * per row.
 *
 * `bpp` is the byte distance to the pixel on the left (4 for RGBA8, 1 for
 * 8-bit indexed) — the spec's "bpp", floored at 1.
 */
export function filterScanlines(
  raw: Uint8Array,
  stride: number,
  height: number,
  bpp: number,
  strategy: FilterStrategy = 'adaptive',
): Uint8Array {
  const out = new Uint8Array((stride + 1) * height);
  if (strategy !== 'adaptive') {
    const type = FIXED_FILTER[strategy];
    for (let y = 0; y < height; y++) {
      const row = raw.subarray(y * stride, (y + 1) * stride);
      const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null;
      out[y * (stride + 1)] = type;
      filterRow(out, y * (stride + 1) + 1, row, prev, stride, bpp, type);
    }
    return out;
  }

  const trial = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null;
    let bestType = 0;
    let bestCost = Infinity;
    for (let type = 0; type <= 4; type++) {
      filterRow(trial, 0, row, prev, stride, bpp, type);
      const cost = rowCost(trial, 0, stride);
      if (cost < bestCost) {
        bestCost = cost;
        bestType = type;
      }
    }
    out[y * (stride + 1)] = bestType;
    filterRow(out, y * (stride + 1) + 1, row, prev, stride, bpp, bestType);
  }
  return out;
}

/**
 * The inverse of `filterScanlines`: reconstruct `height` raw scanlines of
 * `stride` bytes from PNG's filter-byte-prefixed rows.
 *
 * Exported because a caller that verifies its own output (or reads a PNG it
 * did not write) needs the exact same predictor arithmetic; getting it from
 * here rather than reimplementing it is what keeps the two halves in step.
 */
export function unfilterScanlines(
  filtered: Uint8Array,
  stride: number,
  height: number,
  bpp: number,
): Uint8Array {
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const type = filtered[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = filtered[src + i];
      const a = i >= bpp ? raw[dst + i - bpp] : 0;
      const b = y > 0 ? raw[up + i] : 0;
      const c = y > 0 && i >= bpp ? raw[up + i - bpp] : 0;
      let v: number;
      switch (type) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`unknown PNG filter type ${type} on row ${y}`);
      }
      raw[dst + i] = v & 0xff;
    }
  }
  return raw;
}
