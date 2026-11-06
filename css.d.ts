// `.css` files are imported as strings (esbuild's text loader, configured in
// ts0.json), mirroring glsl.d.ts.
declare module '*.css' {
  const src: string;
  export default src;
}
