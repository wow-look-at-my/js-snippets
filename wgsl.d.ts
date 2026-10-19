/// <reference types="@webgpu/types" />

// `.wgsl` files are imported as strings (esbuild's text loader, configured in
// ts0.json).
declare module '*.wgsl' {
  const src: string;
  export default src;
}
