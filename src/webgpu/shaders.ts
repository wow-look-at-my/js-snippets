// Shader source loading -- the most-duplicated GPU snippet (a fetch -> text
// helper copy-pasted into nearly every WebGPU/WebGL renderer).

/** Fetch a shader source file as text. Throws (with the URL) on a non-OK response. */
export async function loadShader(url: string | URL): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load shader: ${url}`);
  return res.text();
}

/** Fetch several shader files under `baseUrl` (in order). */
export async function loadShaders(baseUrl: string | URL, names: string[]): Promise<string[]> {
  return Promise.all(names.map((name) => loadShader(new URL(name, baseUrl))));
}
