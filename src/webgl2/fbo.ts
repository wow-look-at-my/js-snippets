// Float-color framebuffer (RGBA16F by default) — the render target you need
// for additive/HDR accumulation without 8-bit clamping. Rendering to float
// color in WebGL2 requires the EXT_color_buffer_float extension; this helper
// performs that check and fails loudly instead of leaving an incomplete FBO.
// createPingPong pairs two of them for iterative feedback passes (sample the
// previous result while rendering the next).

/** Options for `createFloatFbo`. */
export interface FloatFboOptions {
  /** Texture internal format (default `'rgba16f'`). */
  internalFormat?: 'rgba16f' | 'rgba32f';
  /** Min+mag filter (default `gl.LINEAR`). Float filtering of RGBA16F is core WebGL2. */
  filter?: GLenum;
}

/** A float color target: FBO + backing texture + resize/dispose. */
export interface FloatFbo {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
  /** Reallocate the backing texture (no-op when the size is unchanged). */
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * Create a framebuffer with a float color texture attached. Throws when
 * `EXT_color_buffer_float` is unavailable (float attachments would be
 * incomplete) or the framebuffer fails its completeness check. Bind with
 * `gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer)` and remember to set
 * the viewport; `readPixels(..., gl.FLOAT, ...)` works while it is bound.
 * No depth attachment — pair with a renderbuffer yourself if you need one.
 */
export function createFloatFbo(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  options: FloatFboOptions = {},
): FloatFbo {
  const { internalFormat = 'rgba16f', filter = gl.LINEAR } = options;
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error(
      'EXT_color_buffer_float is unavailable: this context cannot render to float textures ' +
        `(needed for a ${internalFormat} framebuffer)`,
    );
  }
  const glFormat = internalFormat === 'rgba32f' ? gl.RGBA32F : gl.RGBA16F;
  const glType = internalFormat === 'rgba32f' ? gl.FLOAT : gl.HALF_FLOAT;

  const texture = gl.createTexture();
  if (!texture) throw new Error('createTexture failed');
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) {
    gl.deleteTexture(texture);
    throw new Error('createFramebuffer failed');
  }

  const allocate = (w: number, h: number) => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, glFormat, w, h, 0, gl.RGBA, glType, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  };

  allocate(width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new Error(`float framebuffer incomplete: status 0x${status.toString(16)}`);
  }

  return {
    framebuffer,
    texture,
    width,
    height,
    resize(w: number, h: number) {
      if (w === this.width && h === this.height) return;
      allocate(w, h);
      this.width = w;
      this.height = h;
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    },
  };
}

/** The subset of `FloatFbo` that ping-pong management needs. */
export interface PingPongTarget {
  resize(width: number, height: number): void;
  dispose(): void;
}

/** A ping-pong pair of render targets: sample `read` while rendering into `write`, then `swap()`. */
export interface PingPong<T extends PingPongTarget = FloatFbo> {
  read: T;
  write: T;
  /** Exchange `read` and `write` (reassigns the properties — re-fetch them after). */
  swap(): void;
  /** Resize both targets (each target's resize semantics apply, e.g. `FloatFbo` clears). */
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * Pure pairing logic behind `createPingPong`: wrap two existing targets into
 * a ping-pong pair (`read` starts as `a`, `write` as `b`). `swap()` works even
 * when the method is detached from the pair.
 */
export function makePingPong<T extends PingPongTarget>(a: T, b: T): PingPong<T> {
  const pair: PingPong<T> = {
    read: a,
    write: b,
    swap() {
      const t = pair.read;
      pair.read = pair.write;
      pair.write = t;
    },
    resize(width: number, height: number) {
      pair.read.resize(width, height);
      pair.write.resize(width, height);
    },
    dispose() {
      pair.read.dispose();
      pair.write.dispose();
    },
  };
  return pair;
}

/**
 * Create a ping-pong pair of equal float FBOs (see `createFloatFbo`) for
 * iterative accumulation passes: bind `write.framebuffer`, sample
 * `read.texture`, then `swap()`. Float targets matter here — feedback loops
 * make small per-step changes that 8-bit storage quantizes away (e.g. a
 * ×0.999 alpha decay rounds straight back to 255/255, so it never fades).
 *
 * Both targets start empty/transparent (WebGL2 zero-initializes texture
 * storage), so the first `read` samples transparent black. `resize()`
 * reallocates — and thereby clears — both targets (no-op when the size is
 * unchanged). `swap()` reassigns `read`/`write`, so always access the targets
 * through the pair instead of caching them across swaps.
 */
export function createPingPong(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  options: FloatFboOptions = {},
): PingPong<FloatFbo> {
  const first = createFloatFbo(gl, width, height, options);
  let second: FloatFbo;
  try {
    second = createFloatFbo(gl, width, height, options);
  } catch (err) {
    first.dispose();
    throw err;
  }
  return makePingPong(first, second);
}
