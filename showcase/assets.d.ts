// Ambient decls for the showcase's own type-check pass. The root css.d.ts /
// wgsl.d.ts / glsl.d.ts are NOT root files of this nested ts0 project's
// tsconfig (its include glob is scoped to showcase/), so the loader-backed
// text imports inside ../src/ui/timeline-view.ts need these mirrored here.
// Keep in sync with the repo-root decls.
declare module '*.css' {
  const text: string;
  export default text;
}
declare module '*.wgsl' {
  const text: string;
  export default text;
}
declare module '*.glsl' {
  const text: string;
  export default text;
}
