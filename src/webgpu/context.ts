// WebGPU device + canvas context initialization.

export interface WebGPUContext {
  device: GPUDevice;
  ctx: GPUCanvasContext;
  format: GPUTextureFormat;
  /** The adapter the device came from (adapter.info, limits, features, ...). */
  adapter: GPUAdapter;
}

/** Options for `initWebGPU`. */
export interface InitWebGPUOptions {
  /** Passed to requestAdapter (e.g. 'high-performance'). */
  powerPreference?: GPUPowerPreference;
  /**
   * Limits to raise on the device, by name (e.g. maxStorageBufferBindingSize).
   * Each is requested as min(adapter's supported value, the cap you give);
   * pass Infinity to ask for the adapter's maximum. Names the adapter does
   * not report are skipped, so requesting a limit never turns a working init
   * into a validation failure.
   */
  limits?: Record<string, number>;
}

/**
 * Request a WebGPU device and configure a canvas context.
 *
 * @param canvas         The canvas element to bind.
 * @param features       Optional device features to request (only requested if
 *                       the adapter supports them).
 * @param options        Adapter power preference + limits to raise (see
 *                       `InitWebGPUOptions`).
 * @returns null if WebGPU is unavailable.
 */
export async function initWebGPU(
  canvas: HTMLCanvasElement,
  features?: GPUFeatureName[],
  options: InitWebGPUOptions = {},
): Promise<WebGPUContext | null> {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter(
    options.powerPreference ? { powerPreference: options.powerPreference } : undefined,
  );
  if (!adapter) return null;

  const supported = features?.filter(f => adapter.features.has(f)) ?? [];

  let requiredLimits: Record<string, number> | undefined;
  if (options.limits) {
    const adapterLimits = adapter.limits as unknown as Record<string, number>;
    for (const [name, cap] of Object.entries(options.limits)) {
      const supportedValue = adapterLimits[name];
      if (typeof supportedValue !== 'number') continue; // unknown on this adapter
      (requiredLimits ??= {})[name] = Math.min(supportedValue, cap);
    }
  }

  const device = await adapter.requestDevice({
    requiredFeatures: supported,
    ...(requiredLimits ? { requiredLimits } : {}),
  });

  const ctx = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  return { device, ctx, format, adapter };
}
