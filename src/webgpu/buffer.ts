// GPU buffer creation helper.

/**
 * Create a GPUBuffer pre-filled with data from a typed array.
 */
export function createBuffer(
  device: GPUDevice,
  data: ArrayBufferView,
  usage: GPUBufferUsageFlags,
): GPUBuffer {
  const buf = device.createBuffer({
    size: data.byteLength,
    usage,
    mappedAtCreation: true,
  });
  new Uint8Array(buf.getMappedRange()).set(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  );
  buf.unmap();
  return buf;
}
