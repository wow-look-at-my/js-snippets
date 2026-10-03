// Fullscreen pass — a single triangle that covers the screen, generated from gl_VertexID (no vertex buffer).

import fullscreenVertGlsl from './shaders/fullscreen.vert.glsl';

/* */
export const FULLSCREEN_VERTEX_SHADER: string = fullscreenVertGlsl;

/** A drawable fullscreen pass (empty VAO + drawArrays of multiple vertices). */
export interface FullscreenPass {
  /** Bind the (attribute-less) VAO and draw the triangle. Program/uniforms/blend state are yours to set. */
  draw(): void;
  dispose(): void;
}

/**
 * Create the fullscreen pass. Uses a dedicated empty VAO so the draw never
 * inherits stale attribute bindings from other meshes.
 */
export function createFullscreenPass(gl: WebGL2RenderingContext): FullscreenPass {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('createVertexArray failed');
  return {
    draw() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.deleteVertexArray(vao);
    },
  };
}
