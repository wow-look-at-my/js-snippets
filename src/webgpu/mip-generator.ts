// AMD Single Pass Downsampler — WebGPU mip chain generator
//
// Generates a full mip chain for a GPUTexture in two compute dispatches
// instead of N blit passes. Works with any rgba32float texture.

import spdSource from './shaders/spd.wgsl';

interface MipLayout {
  bufOffset: number;
  padWidth: number;
  width: number;
  height: number;
}

function createGPUBuffer(device: GPUDevice, data: ArrayBufferView, usage: GPUBufferUsageFlags): GPUBuffer {
  const buf = device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
  const dst = buf.getMappedRange();
  if (data instanceof Uint32Array) {
    new Uint32Array(dst).set(data);
  } else if (data instanceof Float32Array) {
    new Float32Array(dst).set(data);
  } else {
    new Uint8Array(dst).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  buf.unmap();
  return buf;
}

/**
 * Generate the full mip chain for a texture using the AMD Single Pass
 * Downsampler algorithm.
 *
 * The texture must have been created with `COPY_DST` usage and the desired
 * `mipLevelCount`. Mip level 0 must already contain data. This function
 * fills levels 1 through mipLevelCount-1.
 *
 * @param device   The GPUDevice to use.
 * @param texture  The texture whose mip chain to generate. Must be rgba32float.
 * @param mipCount Number of mip levels (including level 0). If omitted,
 *                 uses `texture.mipLevelCount`.
 */
export function generateMips(device: GPUDevice, texture: GPUTexture, mipCount?: number): void {
  const BUF = GPUBufferUsage;
  const srcW = texture.width;
  const srcH = texture.height;
  const levels = mipCount ?? texture.mipLevelCount;

  if (levels <= 1) return;

  // Compute per-mip buffer layout (padded rows for copyBufferToTexture)
  const mipInfos: MipLayout[] = [];
  let totalVec4s = 0;
  let w = srcW, h = srcH;
  for (let i = 1; i < levels; i++) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    // bytesPerRow must be multiple of 256; rgba32float = 16 bytes/px → pad width to multiple of 16
    const padWidth = Math.max(Math.ceil(w / 16) * 16, 16);
    mipInfos.push({ bufOffset: totalVec4s, padWidth, width: w, height: h });
    totalVec4s += padWidth * h;
  }

  // Storage buffer for all mip pixel data
  const mipBuf = device.createBuffer({ size: totalVec4s * 16, usage: BUF.STORAGE | BUF.COPY_SRC });

  // MipInfo storage buffer (array of {u32, u32, u32, u32} per level)
  const mipInfoData = new Uint32Array(mipInfos.length * 4);
  for (let i = 0; i < mipInfos.length; i++) {
    const m = mipInfos[i];
    mipInfoData.set([m.bufOffset, m.padWidth, m.width, m.height], i * 4);
  }
  const mipInfoBuf = createGPUBuffer(device, mipInfoData, BUF.STORAGE);

  // Params: numWgX, numWgY, mipCount
  const numWgX = Math.ceil(srcW / 64);
  const numWgY = Math.ceil(srcH / 64);
  const paramData = new Uint32Array([numWgX, numWgY, levels, 0]);
  const paramBuf = createGPUBuffer(device, paramData, BUF.UNIFORM);

  // Compile shader
  const spdMod = device.createShaderModule({ code: spdSource });

  // Explicit layout — rgba32float needs 'unfilterable-float' for textureLoad
  const spdBGL = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
  ]});
  const spdPLL = device.createPipelineLayout({ bindGroupLayouts: [spdBGL] });
  const spdPL = device.createComputePipeline({ layout: spdPLL, compute: { module: spdMod, entryPoint: 'downsample' } });
  const tailPL = device.createComputePipeline({ layout: spdPLL, compute: { module: spdMod, entryPoint: 'downsampleTail' } });

  const bg = device.createBindGroup({
    layout: spdBGL,
    entries: [
      { binding: 0, resource: texture.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
      { binding: 1, resource: { buffer: mipBuf } },
      { binding: 2, resource: { buffer: mipInfoBuf } },
      { binding: 3, resource: { buffer: paramBuf } },
    ],
  });

  const encoder = device.createCommandEncoder();

  // Phase 1: mips 1-6 via shared memory
  {
    const pass = encoder.beginComputePass();
    pass.setPipeline(spdPL);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(numWgX, numWgY);
    pass.end();
  }

  // Phase 2: mips 7+ (single workgroup)
  if (levels > 7) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(tailPL);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  // Copy each mip level from storage buffer to texture
  for (let i = 0; i < mipInfos.length; i++) {
    const m = mipInfos[i];
    encoder.copyBufferToTexture(
      { buffer: mipBuf, offset: m.bufOffset * 16, bytesPerRow: m.padWidth * 16 },
      { texture, mipLevel: i + 1 },
      [m.width, m.height],
    );
  }

  device.queue.submit([encoder.finish()]);

  // Clean up one-shot buffers
  mipBuf.destroy();
  mipInfoBuf.destroy();
  paramBuf.destroy();
}
