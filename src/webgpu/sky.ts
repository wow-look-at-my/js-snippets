// Equirectangular HDRI sky renderer.
// Draws a fullscreen triangle with no vertex buffer — just bind and draw(3).

import skySource from './shaders/sky.wgsl';

export interface Sky {
  pipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
}

/**
 * Create a sky rendering pipeline for an equirectangular HDRI texture.
 *
 * @param device      The GPUDevice.
 * @param format      Target color format (e.g. 'bgra8unorm' or 'rgba16float').
 * @param hdriView    Texture view of the HDRI.
 * @param hdriSampler Sampler for the HDRI (typically linear + mip filtering).
 * @param depthFormat Optional depth format. Defaults to 'depth24plus'.
 *                    The sky renders at z=1 with depthCompare='less-equal'
 *                    and no depth writes.
 */
export function createSky(
  device: GPUDevice,
  format: GPUTextureFormat,
  hdriView: GPUTextureView,
  hdriSampler: GPUSampler,
  depthFormat: GPUTextureFormat = 'depth24plus',
): Sky {
  const module = device.createShaderModule({ code: skySource });

  const uniformBuffer = device.createBuffer({
    size: 64, // mat4x4
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module, entryPoint: 'vsMain', buffers: [] },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
    },
    primitive: { topology: 'triangle-list' },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: hdriView },
      { binding: 2, resource: hdriSampler },
    ],
  });

  return { pipeline, uniformBuffer, bindGroup };
}

/**
 * Draw the sky into an active render pass.
 *
 * Write `invViewProj` to `sky.uniformBuffer` before calling this:
 *   device.queue.writeBuffer(sky.uniformBuffer, 0, invViewProj);
 */
export function drawSky(pass: GPURenderPassEncoder, sky: Sky): void {
  pass.setPipeline(sky.pipeline);
  pass.setBindGroup(0, sky.bindGroup);
  pass.draw(3);
}
