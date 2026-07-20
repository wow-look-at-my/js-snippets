/// <reference types="@webgpu/types" />

// `.wgsl` files are imported as strings (esbuild's text loader, configured in
// ts0.json). This ambient declaration lets those imports type-check. The
// reference above makes the WebGPU globals (GPUDevice, GPUTexture, ...)
// available project-wide without a tsconfig `types` array, which ts0's
// generated type-check config does not set.
declare module '*.wgsl' {
  const src: string;
  export default src;
}
