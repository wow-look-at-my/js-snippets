// GPU exclusive prefix scan (Blelloch) over a u32 region of a storage buffer.

import scanWgsl from './shaders/scan.wgsl';
import { planScan } from './scan-plan.ts';

export { planScan, SCAN_BLOCK_SIZE, SCAN_ADDBACK_SIZE } from './scan-plan.ts';
export type { ScanDispatch, ScanLevelPlan, ScanPlan } from './scan-plan.ts';
import type { ScanPlan } from './scan-plan.ts';

/** A scan baked for one fixed region layout (see GpuScan.prepare). */
export interface PreparedScan {
  plan: ScanPlan;
  /** ABSOLUTE element index (into the buffer) holding the grand total. */
  grandTotalElem: number;
  /** Record the scan's dispatches into an open compute pass. */
  encode(pass: GPUComputePassEncoder): void;
  /** Destroy the per-level uniform buffers. */
  destroy(): void;
}

export interface ScanRegion {
  /** Buffer (STORAGE usage) holding the src, dst, AND scratch regions. */
  buffer: GPUBuffer;
  /** Elements in the input run. */
  count: number;
  /** Element index of the input run [srcElem, srcElem + count). */
  srcElem: number;
  /** Element index of the output run (may equal srcElem for in-place). */
  dstElem: number;
  /** Element index of the scratch region: planScan(count).scratchElems u32s. */
  scratchElem: number;
}

export interface GpuScan {
  /** Bake uniforms + bind groups for one region layout (create once, encode many). */
  prepare(region: ScanRegion): PreparedScan;
}

/** Compile the scan pipelines for a device (do this once per device). */
export function createScan(device: GPUDevice): GpuScan {
  const module = device.createShaderModule({ label: 'scan', code: scanWgsl });
  const layout = device.createBindGroupLayout({
    label: 'scan',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipeBlock = device.createComputePipeline({
    label: 'scan_block',
    layout: pipelineLayout,
    compute: { module, entryPoint: 'scan_block' },
  });
  const pipeAddback = device.createComputePipeline({
    label: 'scan_addback',
    layout: pipelineLayout,
    compute: { module, entryPoint: 'scan_addback' },
  });
  const maxWg = device.limits.maxComputeWorkgroupsPerDimension;

  return {
    prepare(region: ScanRegion): PreparedScan {
      const plan = planScan(region.count, maxWg);
      // Absolute per-level bases: level multiple reads/writes the caller's
      // runs; each further level scans the level's sums in place inside scratch.
      const uniforms = plan.levels.map((l, i) => {
        const prevSums = i === 0 ? 0 : region.scratchElem + plan.levels[i - 1].sumsBase;
        const src = i === 0 ? region.srcElem : prevSums;
        const dst = i === 0 ? region.dstElem : prevSums;
        const buf = device.createBuffer({
          label: `scan-level-${i}`,
          size: 16,
          usage: GPUBufferUsage.UNIFORM,
          mappedAtCreation: true,
        });
        new Uint32Array(buf.getMappedRange()).set([
          src, dst, region.scratchElem + l.sumsBase, l.count,
        ]);
        buf.unmap();
        return buf;
      });
      const bindGroups = uniforms.map((u, i) =>
        device.createBindGroup({
          label: `scan-level-${i}`,
          layout,
          entries: [
            { binding: 0, resource: { buffer: u } },
            { binding: 1, resource: { buffer: region.buffer } },
          ],
        }),
      );
      return {
        plan,
        grandTotalElem: region.scratchElem + plan.grandTotalElem,
        encode(pass: GPUComputePassEncoder): void {
          pass.setPipeline(pipeBlock);
          for (let i = 0; i < plan.levels.length; i++) {
            const d = plan.levels[i].scanDispatch;
            pass.setBindGroup(0, bindGroups[i]);
            pass.dispatchWorkgroups(d.x, d.y);
          }
          if (plan.levels.length > 1) {
            pass.setPipeline(pipeAddback);
            for (let i = plan.levels.length - 2; i >= 0; i--) {
              const d = plan.levels[i].addbackDispatch;
              pass.setBindGroup(0, bindGroups[i]);
              pass.dispatchWorkgroups(d.x, d.y);
            }
          }
        },
        destroy(): void {
          for (const u of uniforms) u.destroy();
        },
      };
    },
  };
}
