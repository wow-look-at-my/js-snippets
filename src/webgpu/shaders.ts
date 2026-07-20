// Shader source loading -- the single most-duplicated GPU snippet (a fetch -> text
// helper copy-pasted into nearly every WebGPU/WebGL renderer).
//
// Typical call site, resolving paths relative to the module that imports them:
//
//   const base = new URL('./shaders/', import.meta.url);
//   const [sky, surface] = await loadShaders(base, ['sky.wgsl', 'surface.wgsl']);
//
// `loadShader` works for a WGSL, GLSL, or any text shader URL.

/** Fetch a shader source file as text. Throws (with the URL) on a non-OK response. */
export async function loadShader(url: string | URL): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load shader: ${url}`);
  return res.text();
}

/**
 * Fetch several shader files under `baseUrl` (in order). Each name is resolved
 * against `baseUrl` via the URL constructor, so pass a directory URL ending in
 * `/` (e.g. `new URL('./shaders/', import.meta.url)`). Returns the sources in
 * the same order as `names`.
 */
export async function loadShaders(baseUrl: string | URL, names: string[]): Promise<string[]> {
  return Promise.all(names.map((name) => loadShader(new URL(name, baseUrl))));
}
