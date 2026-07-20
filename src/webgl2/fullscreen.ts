// Fullscreen pass — a single triangle that covers the screen, generated from
// gl_VertexID (no vertex buffer). Pair `FULLSCREEN_VERTEX_SHADER` with your
// fragment shader (it receives `in vec2 vUv`, v=0 at the bottom, matching a
// flipY-uploaded texture) and call `pass.draw()`.

import fullscreenVertGlsl from './shaders/fullscreen.vert.glsl';

/**
 * `#version 300 es` vertex shader emitting one screen-covering triangle and a
 * `vUv` varying in [0,1]² (v=0 at the bottom of the screen).
 */
export const FULLSCREEN_VERTEX_SHADER: string = fullscreenVertGlsl;

/** A drawable fullscreen pass (empty VAO + drawArrays of 3 vertices). */
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
