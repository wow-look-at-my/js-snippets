// `.css` files are imported as strings (esbuild's text loader, configured in
// ts0.json), mirroring glsl.d.ts — component stylesheets live in real .css
// files and are adopted into shadow roots at runtime.
declare module '*.css' {
  const src: string;
  export default src;
}
