// Palette detection for the APNG encoder. Pure — no DOM, no browser APIs.
//
// An 8-bit indexed PNG stores one byte per pixel instead of four. For the
// content animated PNGs are usually made of — UI recordings, pixel art, charts,
// line drawings — that is a 4x cut before deflate even runs, and deflate does
// better on the narrower alphabet too. This module only ever detects an EXACT
// palette: if the frames genuinely use more than 256 distinct RGBA values it
// gives up and the caller stays on RGBA. Nothing here quantises, so indexing can
// never change a pixel.
//
// Entries are ordered non-opaque first because PNG's tRNS chunk is a prefix of
// the palette: alpha is stored for entries 0..n-1 and every later entry is
// implicitly opaque, so grouping the transparent ones up front makes tRNS as
// short as it can be.

/** An exact RGBA -> index mapping for 8-bit indexed (colour type 3) output. */
export interface Palette {
  /** Palette entries, 4 bytes (RGBA) each, in index order. */
  rgba: Uint8Array;
  /** Number of entries (1..256). */
  size: number;
  /** Length of the tRNS prefix: entries [0, trnsCount) have alpha < 255. */
  trnsCount: number;
  /** Index of a fully transparent entry, or -1 if the palette has none. */
  transparentIndex: number;
  /** Packed-RGBA key -> palette index. */
  lookup: Map<number, number>;
}

/** Pack an RGBA quadruplet into one integer key (endian-independent). */
export function packRgba(r: number, g: number, b: number, a: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

/**
 * Build an exact palette covering every pixel of every image, or return null
 * when they use more than `limit` distinct colours.
 *
 * `reserveTransparent` adds a fully transparent entry when the images do not
 * already contain one — the encoder needs it to write "leave this pixel alone"
 * into a blend_op=OVER frame. It costs one palette slot, so the effective
 * colour budget is `limit - 1` for fully opaque input.
 *
 * Bails out as soon as the distinct-colour count exceeds the budget, so
 * photographic input costs a few thousand pixel reads rather than a full scan.
 */
export function buildPalette(
  images: readonly Uint8Array[],
  limit = 256,
  reserveTransparent = true,
): Palette | null {
  const counts = new Map<number, number>();
  let sawTransparent = false;
  // One slot is held back for the transparent sentinel until we see that the
  // images already contain one.
  for (const img of images) {
    for (let i = 0; i < img.length; i += 4) {
      const key = packRgba(img[i], img[i + 1], img[i + 2], img[i + 3]);
      const prev = counts.get(key);
      if (prev !== undefined) {
        counts.set(key, prev + 1);
        continue;
      }
      if (img[i + 3] === 0) sawTransparent = true;
      const budget = reserveTransparent && !sawTransparent ? limit - 1 : limit;
      if (counts.size >= budget) return null;
      counts.set(key, 1);
    }
  }
  if (counts.size === 0) return null;

  const keys = [...counts.keys()];
  keys.sort((ka, kb) => {
    const aa = ka & 0xff;
    const ab = kb & 0xff;
    // Non-opaque first (shortest possible tRNS), then most-used first.
    if ((aa === 255) !== (ab === 255)) return aa === 255 ? 1 : -1;
    const ca = counts.get(ka) as number;
    const cb = counts.get(kb) as number;
    if (ca !== cb) return cb - ca;
    return ka - kb;
  });

  let transparentIndex = keys.findIndex((k) => (k & 0xff) === 0);
  if (transparentIndex < 0 && reserveTransparent) {
    keys.unshift(0); // r=g=b=a=0
    transparentIndex = 0;
  }

  const size = keys.length;
  const rgba = new Uint8Array(size * 4);
  const lookup = new Map<number, number>();
  let trnsCount = 0;
  for (let i = 0; i < size; i++) {
    const k = keys[i];
    rgba[i * 4] = (k >>> 24) & 0xff;
    rgba[i * 4 + 1] = (k >>> 16) & 0xff;
    rgba[i * 4 + 2] = (k >>> 8) & 0xff;
    rgba[i * 4 + 3] = k & 0xff;
    lookup.set(k, i);
    if ((k & 0xff) !== 255) trnsCount = i + 1;
  }

  return { rgba, size, trnsCount, transparentIndex, lookup };
}

/**
 * Map an RGBA8 image to one byte per pixel through `palette`.
 *
 * Throws on a colour the palette does not contain: the palette is built from
 * the very pixels being indexed, so a miss means the caller mixed images from
 * two different builds — silently substituting a nearby colour would ship a
 * corrupted frame that looks almost right.
 */
export function indexImage(src: Uint8Array, palette: Palette): Uint8Array {
  const n = src.length >> 2;
  const out = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const key = packRgba(src[i], src[i + 1], src[i + 2], src[i + 3]);
    const idx = palette.lookup.get(key);
    if (idx === undefined) {
      throw new Error(
        `colour rgba(${src[i]},${src[i + 1]},${src[i + 2]},${src[i + 3]}) is not in the palette`,
      );
    }
    out[p] = idx;
  }
  return out;
}
