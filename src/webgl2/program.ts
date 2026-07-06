// WebGL2 shader compilation + program linking with readable errors. Raw GL
// reports failures as bare info logs ("ERROR: 0:12: ..."), leaving you to count
// lines by hand; `annotateShaderLog` interleaves the log with the offending
// source lines so the message is actionable on its own. `injectChunk` splices
// a shared GLSL chunk (GLSL has no #include) into a shader source before
// compilation.

/**
 * Interleave a shader info log with the source lines it references.
 *
 * GLSL info logs reference lines as `ERROR: 0:<line>: message` (1-based).
 * For each such line in `infoLog`, the annotated output appends the referenced
 * source line plus `contextLines` lines on either side, with a `>` marker on
 * the offending line. Log lines without a recognizable line number are kept
 * verbatim. Pure string processing — no GL required.
 */
export function annotateShaderLog(source: string, infoLog: string, contextLines = 1): string {
  const srcLines = source.split('\n');
  const out: string[] = [];
  for (const logLine of infoLog.split('\n')) {
    if (logLine.trim() === '') continue;
    out.push(logLine);
    // Matches "ERROR: 0:12:" / "WARNING: 0:3:" style references.
    const m = /^\s*\w+:\s*\d+:(\d+):/.exec(logLine);
    if (!m) continue;
    const lineNo = parseInt(m[1], 10); // 1-based
    if (!(lineNo >= 1 && lineNo <= srcLines.length)) continue;
    const lo = Math.max(1, lineNo - contextLines);
    const hi = Math.min(srcLines.length, lineNo + contextLines);
    for (let n = lo; n <= hi; n++) {
      const marker = n === lineNo ? '>' : ' ';
      out.push(`  ${marker} ${String(n).padStart(4)} | ${srcLines[n - 1]}`);
    }
  }
  return out.join('\n');
}

/**
 * Insert a shared GLSL `chunk` (helper functions used by several shaders —
 * GLSL's missing #include) into `source`, immediately after the first-line
 * `#version` directive; when there is none, the chunk is prepended. Pure
 * string processing — no GL required.
 *
 * Exactly one newline separates the chunk from the following line whether or
 * not `chunk` ends with one, so injection shifts the host's error line
 * numbers by a fixed count (annotate the *injected* source and
 * `annotateShaderLog` stays accurate). Idempotence guard: when `chunk`
 * already appears verbatim in `source`, it is returned unchanged — so
 * double-injection is safe, but a chunk whose exact text legitimately occurs
 * in the host is skipped.
 *
 * The chunk lands *before* the host's `precision` statements, so it should
 * declare its own default precision for any types its functions use (repeat
 * precision declarations are legal GLSL).
 */
export function injectChunk(source: string, chunk: string): string {
  if (source.includes(chunk)) return source;
  const block = chunk.endsWith('\n') ? chunk : chunk + '\n';
  const nl = source.indexOf('\n');
  const firstLine = nl < 0 ? source : source.slice(0, nl);
  if (/^[ \t]*#[ \t]*version\b/.test(firstLine)) {
    return nl < 0 ? source + '\n' + block : source.slice(0, nl + 1) + block + source.slice(nl + 1);
  }
  return block + source;
}

/**
 * Compile a shader of `type` (`gl.VERTEX_SHADER` / `gl.FRAGMENT_SHADER`).
 * Throws an `Error` whose message includes the source-annotated info log
 * (see `annotateShaderLog`). `label` names the shader in error messages.
 */
export function compileShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
  label?: string,
): WebGLShader {
  const kind =
    label ?? (type === gl.VERTEX_SHADER ? 'vertex' : type === gl.FRAGMENT_SHADER ? 'fragment' : `0x${type.toString(16)}`);
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`createShader failed for ${kind} shader`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`${kind} shader compile failed:\n${annotateShaderLog(source, log)}`);
  }
  return shader;
}

/** Options for `createProgram`. */
export interface ProgramOptions {
  /** Name used in error messages. */
  label?: string;
  /** Attribute name → location bindings applied before linking. */
  attribLocations?: Record<string, number>;
}

/**
 * Compile `vertexSource` + `fragmentSource` and link them into a program.
 * Shaders are detached and deleted after a successful link. Throws with an
 * annotated log on compile failure and with the program info log on link
 * failure. Use `attribLocations` to pin attribute locations (so VAOs can be
 * built without querying the program).
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  options: ProgramOptions = {},
): WebGLProgram {
  const { label, attribLocations } = options;
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource, label && `${label} vertex`);
  let fs: WebGLShader;
  try {
    fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, label && `${label} fragment`);
  } catch (err) {
    gl.deleteShader(vs);
    throw err;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`createProgram failed${label ? ` for ${label}` : ''}`);
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  if (attribLocations) {
    for (const [name, location] of Object.entries(attribLocations)) {
      gl.bindAttribLocation(program, location, name);
    }
  }
  gl.linkProgram(program);
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`program link failed${label ? ` for ${label}` : ''}:\n${log}`);
  }
  return program;
}

/**
 * Look up several uniform locations at once. Returns `{ name: location }`;
 * a name the linker optimized away maps to `null` (matching
 * `gl.getUniformLocation`), so a typo shows up as a `null` you can assert on.
 */
export function getUniformLocations<T extends string>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly T[],
): Record<T, WebGLUniformLocation | null> {
  const out = {} as Record<T, WebGLUniformLocation | null>;
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}
