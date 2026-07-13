// Generic exclusive prefix sum over u32s in ONE storage buffer, addressed by
// element bases from a small uniform. The caller lays src/dst/per-block-sums
// regions out in a single buffer (element granularity — no bind-offset
// alignment constraints) and dispatches the level hierarchy (see scan.ts
// planScan for the level math).
//
// scan_block: Blelloch work-efficient scan of 512 elements per workgroup
// (256 threads x 2). dst gets each block's exclusive scan; sums[block] gets
// the block total (so the LAST level's sums[0] is the grand total). A block
// is dispatched even when count == 0 so the grand total is always written.
//
// scan_addback: dst[i] += sums[i / 512] — applied per level in reverse after
// the upper level has scanned the sums region in place.
//
// Dispatches may be 2D (x clamped to maxComputeWorkgroupsPerDimension): both
// entry points linearize the workgroup id with @builtin(num_workgroups) and
// early-out the padding workgroups (workgroup-uniform, so the barriers below
// stay in uniform control flow).
//
// Bindings (storage buffers: 1): @0 level (uniform)   @1 data (rw)

struct ScanLevel {
  srcBase: u32,  // element index of the input run
  dstBase: u32,  // element index of the exclusive-scan output (may == srcBase)
  sumsBase: u32, // element index of the per-block totals
  count: u32,    // number of elements
}

@group(0) @binding(0) var<uniform> level: ScanLevel;
@group(0) @binding(1) var<storage, read_write> data: array<u32>;

const SCAN_BLOCK: u32 = 512u;
var<workgroup> temp: array<u32, 512>;

@compute @workgroup_size(256)
fn scan_block(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(num_workgroups) nwg: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let block = wg.y * nwg.x + wg.x;
  let blocks = max(1u, (level.count + SCAN_BLOCK - 1u) / SCAN_BLOCK);
  if (block >= blocks) { return; } // 2D-dispatch padding (workgroup-uniform)

  let blockBase = block * SCAN_BLOCK;
  let i0 = blockBase + li;
  let i1 = blockBase + li + 256u;
  var v0 = 0u;
  var v1 = 0u;
  if (i0 < level.count) { v0 = data[level.srcBase + i0]; }
  if (i1 < level.count) { v1 = data[level.srcBase + i1]; }
  temp[li] = v0;
  temp[li + 256u] = v1;

  // Up-sweep (reduce).
  var offset = 1u;
  for (var d = SCAN_BLOCK >> 1u; d > 0u; d >>= 1u) {
    workgroupBarrier();
    if (li < d) {
      let ai = offset * (2u * li + 1u) - 1u;
      let bi = offset * (2u * li + 2u) - 1u;
      temp[bi] += temp[ai];
    }
    offset <<= 1u;
  }
  workgroupBarrier();
  if (li == 0u) {
    data[level.sumsBase + block] = temp[SCAN_BLOCK - 1u];
    temp[SCAN_BLOCK - 1u] = 0u;
  }
  // Down-sweep.
  for (var d = 1u; d < SCAN_BLOCK; d <<= 1u) {
    offset >>= 1u;
    workgroupBarrier();
    if (li < d) {
      let ai = offset * (2u * li + 1u) - 1u;
      let bi = offset * (2u * li + 2u) - 1u;
      let t = temp[ai];
      temp[ai] = temp[bi];
      temp[bi] += t;
    }
  }
  workgroupBarrier();
  if (i0 < level.count) { data[level.dstBase + i0] = temp[li]; }
  if (i1 < level.count) { data[level.dstBase + i1] = temp[li + 256u]; }
}

@compute @workgroup_size(256)
fn scan_addback(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(num_workgroups) nwg: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let i = (wg.y * nwg.x + wg.x) * 256u + li;
  if (i >= level.count) { return; }
  data[level.dstBase + i] += data[level.sumsBase + i / SCAN_BLOCK];
}
