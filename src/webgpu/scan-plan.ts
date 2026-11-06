// PURE level math for the GPU exclusive prefix scan (webgpu/scan.ts).

/* */
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
  /* */
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
  /* */
  levels: ScanLevelPlan[];
  /** Total scratch elements required (sum of blocks over all levels). */
  scratchElems: number;
  /* */
  grandTotalElem: number;
}

/** Split `n` workgroups into a grid with each dimension <= maxPerDim. */
function splitDispatch(n: number, maxPerDim: number): ScanDispatch {
  const x = Math.min(n, maxPerDim);
  return { x, y: Math.ceil(n / x) };
}

/** PURE level math for an exclusive scan over `count` u32 elements. */
export function planScan(count: number, maxWorkgroupsPerDim = DEFAULT_MAX_WG): ScanPlan {
  const n0 = Math.max(0, Math.floor(count) || 0);
  const maxWg = Math.max(1, Math.floor(maxWorkgroupsPerDim) || 1);
  const levels: ScanLevelPlan[] = [];
  let n = n0;
  let sumsBase = 0;
  for (;;) {
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
