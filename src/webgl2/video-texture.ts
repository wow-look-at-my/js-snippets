// Texture that tracks an HTMLVideoElement (the raw-GL equivalent of
// three.js's VideoTexture). Call `update()` once per rendered frame: it
// uploads the video's current frame when one is available, using
// `requestVideoFrameCallback` (when the browser has it) to skip redundant
// uploads between video frames.

/** Options for `createVideoTexture`. */
export interface VideoTextureOptions {
  /**
   * Store as `SRGB8_ALPHA8` so sampling returns linear values (default true —
   * right for color video). Pass false for data-encoded video (e.g. depth
   * visualizations) to sample the raw `RGBA8` bytes.
   */
  srgb?: boolean;
  /** Flip rows on upload so v=0 is the bottom of the frame (default true, matching the three.js convention). */
  flipY?: boolean;
}

/** A live video texture. */
export interface VideoTexture {
  texture: WebGLTexture;
  video: HTMLVideoElement;
  /**
   * Upload the current video frame if a new one is available and the video
   * has data (`readyState >= HAVE_CURRENT_DATA`). Returns true when an upload
   * happened. Without `requestVideoFrameCallback` support every call with
   * data uploads (the pre-rVFC three.js behavior).
   */
  update(): boolean;
  dispose(): void;
}

/**
 * Create a LINEAR/CLAMP_TO_EDGE texture bound to `video`. The texture is
 * allocated on the first `update()` with data; reallocation happens
 * automatically if the video's dimensions change.
 */
export function createVideoTexture(
  gl: WebGL2RenderingContext,
  video: HTMLVideoElement,
  options: VideoTextureOptions = {},
): VideoTexture {
  const { srgb = true, flipY = true } = options;
  const internalFormat = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;

  const texture = gl.createTexture();
  if (!texture) throw new Error('createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  // With rVFC, `dirty` marks "a new frame was presented"; without it we treat
  // every update() as dirty (upload each render).
  const hasRvfc = typeof video.requestVideoFrameCallback === 'function';
  let dirty = true;
  let rvfcHandle = 0;
  let disposed = false;
  if (hasRvfc) {
    const onFrame = () => {
      dirty = true;
      if (!disposed) rvfcHandle = video.requestVideoFrameCallback(onFrame);
    };
    rvfcHandle = video.requestVideoFrameCallback(onFrame);
  }

  let allocatedW = 0;
  let allocatedH = 0;

  return {
    texture,
    video,
    update(): boolean {
      if (video.readyState < 2 /* HAVE_CURRENT_DATA */) return false;
      if (hasRvfc && !dirty) return false;
      dirty = false;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w === 0 || h === 0) return false;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
      if (w !== allocatedW || h !== allocatedH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
        allocatedW = w;
        allocatedH = h;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, video);
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return true;
    },
    dispose() {
      disposed = true;
      if (hasRvfc && rvfcHandle) video.cancelVideoFrameCallback(rvfcHandle);
      gl.deleteTexture(texture);
    },
  };
}
