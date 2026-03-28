// WebGPU device + canvas context initialization.

export interface WebGPUContext {
  device: GPUDevice;
  ctx: GPUCanvasContext;
  format: GPUTextureFormat;
}

/**
 * Request a WebGPU device and configure a canvas context.
 *
 * @param canvas         The canvas element to bind.
 * @param features       Optional device features to request (only requested if
 *                       the adapter supports them).
 * @returns null if WebGPU is unavailable.
 */
export async function initWebGPU(
  canvas: HTMLCanvasElement,
  features?: GPUFeatureName[],
): Promise<WebGPUContext | null> {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;

  const supported = features?.filter(f => adapter.features.has(f)) ?? [];
  const device = await adapter.requestDevice({
    requiredFeatures: supported,
  });

  const ctx = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  return { device, ctx, format };
}
