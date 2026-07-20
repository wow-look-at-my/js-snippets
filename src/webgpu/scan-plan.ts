// PURE level math for the GPU exclusive prefix scan (webgpu/scan.ts).
//
// Kept free of the .wgsl import so it loads under `node --test` (Node cannot
// resolve shader text imports); scan.ts re-exports everything here, so
// consumers still import a single module. Import THIS module directly only
// when you want the math without the GPU wrapper (e.g. in node).
//
// The hierarchy: level 0 block-scans the input run into the output run and
// writes one total per 512-element block into scratch; each further level
// scans the previous level's block sums IN PLACE inside scratch, until a
// level fits a single block — 3 levels cover 512^3 = 134M elements. The LAST
// level's sums[0] is the grand total (sum of all inputs). After the forward
// block scans, per-level "addback" passes (levels length-2 .. 0, in reverse)
// add the scanned block sums back into each block's elements.

/** Elements consumed per scan_block workgroup (256 threads x 2). */
export const SCAN_BLOCK_SIZE = 512;
/** Elements consumed per scan_addback workgroup. */
export const SCAN_ADDBACK_SIZE = 256;

/** WebGPU default maxComputeWorkgroupsPerDimension. */
const DEFAULT_MAX_WG = 65535;

/** Workgroup grid for one dispatch (y > 1 when x hit the per-dim clamp). */
export interface ScanDispatch {
  x: number;
  y: number;
}

export interface ScanLevelPlan {
  /** Elements scanned at this level. */
  count: number;
  /** Per-block sums produced: ceil(count / SCAN_BLOCK_SIZE), min 1. */
  blocks: number;
  /** Scratch-relative element index of this level's block sums. */
  sumsBase: number;
  /** Workgroups for scan_block (covers `blocks`). */
  scanDispatch: ScanDispatch;
  /** Workgroups for scan_addback (covers `count`; unused on the last level). */
  addbackDispatch: ScanDispatch;
}

export interface ScanPlan {
  /** Elements in the input run (>= 0). */
  count: number;
  /**
   * Level 0 scans the input run into the output run; level k >= 1 scans level
   * k-1's block sums IN PLACE inside scratch. Encode order: scan_block for
   * every level forward, then scan_addback for levels length-2 .. 0.
   */
  levels: ScanLevelPlan[];
  /** Total scratch elements required (sum of blocks over all levels). */
  scratchElems: number;
  /** Scratch-relative element index of the grand total (last level's sums[0]). */
  grandTotalElem: number;
}

/** Split `n` workgroups into a grid with each dimension <= maxPerDim. */
function splitDispatch(n: number, maxPerDim: number): ScanDispatch {
  const x = Math.min(n, maxPerDim);
  return { x, y: Math.ceil(n / x) };
}

/**
 * PURE level math for an exclusive scan over `count` u32 elements.
 * `maxWorkgroupsPerDim` should be the device's maxComputeWorkgroupsPerDimension
 * (default 65535, the WebGPU baseline).
 */
export function planScan(count: number, maxWorkgroupsPerDim = DEFAULT_MAX_WG): ScanPlan {
  const n0 = Math.max(0, Math.floor(count) || 0);
  const maxWg = Math.max(1, Math.floor(maxWorkgroupsPerDim) || 1);
  const levels: ScanLevelPlan[] = [];
  let n = n0;
  let sumsBase = 0;
  for (;;) {
    // A block is dispatched even for count 0 so the grand total gets written.
    const blocks = Math.max(1, Math.ceil(n / SCAN_BLOCK_SIZE));
    levels.push({
      count: n,
      blocks,
      sumsBase,
      scanDispatch: splitDispatch(blocks, maxWg),
      addbackDispatch: splitDispatch(Math.max(1, Math.ceil(n / SCAN_ADDBACK_SIZE)), maxWg),
    });
    sumsBase += blocks;
    if (blocks === 1) break;
    n = blocks;
  }
  return {
    count: n0,
    levels,
    scratchElems: sumsBase,
    grandTotalElem: levels[levels.length - 1].sumsBase,
  };
}
