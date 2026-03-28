// IBL environment map prefiltering — GGX importance sampling.
//
// Generates a mip chain where each level is convolved with a GGX lobe
// at increasing roughness:
//   mip 0 = sharp (roughness 0)
//   mip N = fully diffuse (roughness 1)
//
// Use the output texture with textureSampleLevel(tex, sampler, uv, roughness * maxMip)
// for split-sum specular IBL.

import prefilterSource from './shaders/prefilter.wgsl';

interface MipLayout {
  width: number;
  height: number;
  padWidth: number;
  bufOffset: number;
}

/**
 * Generate a prefiltered environment mip chain from an equirectangular HDRI.
 *
 * The source texture's mip 0 must contain the HDRI data. The output mip
 * levels 1..N are filled with GGX-convolved versions at increasing roughness.
 *
 * @param device      The GPUDevice.
 * @param texture     Target texture — must have mipLevelCount > 1 and COPY_DST usage.
 *                    Mip 0 must already be populated.
 * @param numSamples  Samples per pixel for the convolution (default 1024).
 *                    Higher = better quality, slower.
 */
export function prefilterEnvMap(
  device: GPUDevice,
  texture: GPUTexture,
  numSamples = 1024,
): void {
  const BUF = GPUBufferUsage;
  const srcW = texture.width;
  const srcH = texture.height;
  const mipCount = texture.mipLevelCount;

  if (mipCount <= 1) return;

  // Compute per-mip buffer layout
  const mips: MipLayout[] = [];
  let totalVec4s = 0;
  let w = srcW, h = srcH;
  for (let i = 1; i < mipCount; i++) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    const padWidth = Math.max(Math.ceil(w / 16) * 16, 16);
    mips.push({ width: w, height: h, padWidth, bufOffset: totalVec4s });
    totalVec4s += padWidth * h;
  }

  const outBuf = device.createBuffer({
    size: totalVec4s * 16,
    usage: BUF.STORAGE | BUF.COPY_SRC,
  });

  // Compile shader + create pipeline
  const module = device.createShaderModule({ code: prefilterSource });

  const bgl = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
  ]});
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const pipeline = device.createComputePipeline({
    layout,
    compute: { module, entryPoint: 'prefilter' },
  });

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  const encoder = device.createCommandEncoder();

  // Dispatch one pass per mip level
  const paramBufs: GPUBuffer[] = [];
  for (let i = 0; i < mips.length; i++) {
    const m = mips[i];
    const roughness = i / (mips.length - 1 || 1);

    // Params uniform
    const paramData = new ArrayBuffer(32);
    const u32 = new Uint32Array(paramData);
    const f32 = new Float32Array(paramData);
    u32[0] = m.width;
    u32[1] = m.height;
    u32[2] = m.padWidth;
    u32[3] = m.bufOffset;
    f32[4] = roughness;
    u32[5] = numSamples;

    const paramBuf = device.createBuffer({
      size: 32,
      usage: BUF.UNIFORM,
      mappedAtCreation: true,
    });
    new Uint8Array(paramBuf.getMappedRange()).set(new Uint8Array(paramData));
    paramBuf.unmap();
    paramBufs.push(paramBuf);

    const bg = device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: texture.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: outBuf } },
        { binding: 3, resource: { buffer: paramBuf } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(
      Math.ceil(m.width / 8),
      Math.ceil(m.height / 8),
    );
    pass.end();
  }

  // Copy results to texture mip levels
  for (let i = 0; i < mips.length; i++) {
    const m = mips[i];
    encoder.copyBufferToTexture(
      { buffer: outBuf, offset: m.bufOffset * 16, bytesPerRow: m.padWidth * 16 },
      { texture, mipLevel: i + 1 },
      [m.width, m.height],
    );
  }

  device.queue.submit([encoder.finish()]);

  // Clean up
  outBuf.destroy();
  for (const buf of paramBufs) buf.destroy();
}
