// VAO construction from typed arrays — the boilerplate between "I have
// positions/uvs/indices" and a drawable WebGL2 mesh. One buffer per attribute
// (tightly packed floats), optional index buffer with automatic 16/32-bit
// element sizing.

/** One vertex attribute: float data bound at a fixed location. */
export interface MeshAttribute {
  /** Attribute location in the program (pin with `createProgram`'s `attribLocations`). */
  location: number;
  /** Tightly packed float data. */
  data: Float32Array;
  /** Components per vertex (1–4). */
  size: number;
}

/** Options for `createMesh`. */
export interface MeshOptions {
  /** Draw mode (default `gl.TRIANGLES`). */
  mode?: GLenum;
  /** Triangle/line indices. Plain arrays are converted via `chooseIndexArray`. */
  indices?: ArrayLike<number> | Uint16Array | Uint32Array;
}

/** A drawable mesh: VAO + buffers + a `draw()` that binds and issues the call. */
export interface Mesh {
  vao: WebGLVertexArrayObject;
  /** Element count passed to drawElements / vertex count for drawArrays. */
  count: number;
  /** `gl.UNSIGNED_SHORT` / `gl.UNSIGNED_INT`, or 0 when non-indexed. */
  indexType: GLenum;
  /** Draw mode (`gl.TRIANGLES`, `gl.LINES`, ...). */
  mode: GLenum;
  /** Bind the VAO and draw (drawElements when indexed, else drawArrays). */
  draw(): void;
  /** Delete the VAO and every buffer it references. */
  dispose(): void;
}

/**
 * Pick the smallest index array type that can address `vertexCount` vertices:
 * `Uint16Array` when every valid index (≤ vertexCount − 1) fits in 16 bits,
 * else `Uint32Array`. Typed input arrays are returned as-is (no copy). Pure —
 * no GL required.
 */
export function chooseIndexArray(
  indices: ArrayLike<number> | Uint16Array | Uint32Array,
  vertexCount: number,
): Uint16Array | Uint32Array {
  if (indices instanceof Uint16Array || indices instanceof Uint32Array) return indices;
  return vertexCount > 65536 ? new Uint32Array(indices) : new Uint16Array(indices);
}

/**
 * Build a VAO from per-attribute typed arrays (one `ARRAY_BUFFER` per
 * attribute, `STATIC_DRAW`). The vertex count is derived from the first
 * attribute (`data.length / size`); with `indices` the mesh draws
 * `drawElements`, otherwise `drawArrays` over every vertex. Leaves the VAO
 * unbound on return; `draw()` binds/unbinds it around the draw call.
 */
export function createMesh(
  gl: WebGL2RenderingContext,
  attributes: MeshAttribute[],
  options: MeshOptions = {},
): Mesh {
  if (attributes.length === 0) throw new Error('createMesh: at least one attribute required');
  const mode = options.mode ?? gl.TRIANGLES;
  const vertexCount = Math.floor(attributes[0].data.length / attributes[0].size);

  const vao = gl.createVertexArray();
  if (!vao) throw new Error('createVertexArray failed');
  const buffers: WebGLBuffer[] = [];
  gl.bindVertexArray(vao);

  for (const attr of attributes) {
    const buf = gl.createBuffer();
    if (!buf) throw new Error('createBuffer failed');
    buffers.push(buf);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, attr.data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attr.location);
    gl.vertexAttribPointer(attr.location, attr.size, gl.FLOAT, false, 0, 0);
  }

  let count = vertexCount;
  let indexType: GLenum = 0;
  if (options.indices) {
    const indexArray = chooseIndexArray(options.indices, vertexCount);
    const ibo = gl.createBuffer();
    if (!ibo) throw new Error('createBuffer failed for index buffer');
    buffers.push(ibo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexArray, gl.STATIC_DRAW);
    count = indexArray.length;
    indexType = indexArray instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
  }

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return {
    vao,
    count,
    indexType,
    mode,
    draw() {
      gl.bindVertexArray(vao);
      if (indexType) gl.drawElements(mode, count, indexType, 0);
      else gl.drawArrays(mode, 0, count);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.deleteVertexArray(vao);
      for (const buf of buffers) gl.deleteBuffer(buf);
    },
  };
}
