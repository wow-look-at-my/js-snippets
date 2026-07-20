// `.glsl` files are imported as strings (esbuild's text loader, configured in
// ts0.json), mirroring wgsl.d.ts for the WebGL modules.
declare module '*.glsl' {
  const src: string;
  export default src;
}
