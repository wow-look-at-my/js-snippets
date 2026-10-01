/**
 * Deterministic category colors, the uniform dim transform, and the label
 * halo — the color primitives shared by the canvas-painted components
 * (`<timeline-view>`, `<dag-view>`).
 *
 * The contract that matters: a category string maps to ONE color, forever,
 * on every machine. Nothing here reads state, a clock, or a random source.
 */

/** FNV-1a 32-bit hash (stable across sessions/platforms). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Stable category → hue in [0, 360): FNV-1a scattered by the golden-ratio
 * conjugate, so similar strings land far apart and hues spread uniformly.
 * Same string = same hue, forever.
 */
export function categoryHue(category: string): number {
  const g = (hashString(category) * 0.61803398875) % 1;
  return Math.floor(g * 360);
}

/**
 * The salt categoryJitter hashes after the category name. A NUL separator
 * keeps two different names from spelling each other's salted form. It is
 * built from a char code, not an escape, so this file stays plain ASCII —
 * a raw NUL byte makes grep call the whole source "binary".
 */
const TONE_SALT = `${String.fromCharCode(0)}tone`;

/**
 * Deterministic per-category lightness/chroma offsets (|dl| <= 0.05,
 * |dc| <= 0.02), derived from independent hash bits. A second visual
 * discriminator: two categories that happen to hash to nearby hues still
 * separate by tone, while every category keeps one stable color forever.
 */
export function categoryJitter(category: string): { dl: number; dc: number } {
  const h = hashString(category + TONE_SALT);
  return {
    dl: ((h & 0xff) / 255 - 0.5) * 0.1,
    dc: (((h >>> 8) & 0xff) / 255 - 0.5) * 0.04,
  };
}

/** Options for categoryColor. */
export interface CategoryColorOptions {
  /** 'oklch' (perceptually even lightness — preferred) or 'hsl' fallback. */
  mode?: 'oklch' | 'hsl';
  /** oklch lightness 0..1 (default 0.62 — readable chips on a dark bg). */
  lightness?: number;
  /** oklch chroma (default 0.11 — saturated but not neon). */
  chroma?: number;
  /** Alpha 0..1 (default 1). */
  alpha?: number;
}

/**
 * CSS color for a category hue. oklch keeps perceived lightness even across
 * hues (label text stays readable on every category); the hsl fallback
 * approximates it for engines without oklch support.
 */
export function categoryColor(hue: number, opts: CategoryColorOptions = {}): string {
  const l = opts.lightness ?? 0.62;
  const c = opts.chroma ?? 0.11;
  const a = opts.alpha ?? 1;
  if (opts.mode === 'hsl') {
    const s = Math.round(Math.min(1, c / 0.32) * 100);
    const ll = Math.round(l * 88);
    return a >= 1 ? `hsl(${hue}, ${s}%, ${ll}%)` : `hsla(${hue}, ${s}%, ${ll}%, ${round3(a)})`;
  }
  return a >= 1 ? `oklch(${round3(l)} ${round3(c)} ${hue})` : `oklch(${round3(l)} ${round3(c)} ${hue} / ${round3(a)})`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// -- Dim transform -------------------------------------------------------------------

/** Parse a CSS color into sRGB 0..255 channels + alpha, or null if unsupported. */
function parseColor(color: string): { r: number; g: number; b: number; a: number } | null {
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    const n = hex.length;
    if (n === 3 || n === 4) {
      const v = hex.split('').map((ch) => parseInt(ch + ch, 16));
      if (v.some(Number.isNaN)) return null;
      return { r: v[0], g: v[1], b: v[2], a: n === 4 ? v[3] / 255 : 1 };
    }
    if (n === 6 || n === 8) {
      const v = [0, 2, 4, 6].slice(0, n / 2).map((i) => parseInt(hex.slice(i, i + 2), 16));
      if (v.some(Number.isNaN)) return null;
      return { r: v[0], g: v[1], b: v[2], a: n === 8 ? v[3] / 255 : 1 };
    }
    return null;
  }
  const fn = c.match(/^(rgba?|hsla?|oklch)\(([^)]+)\)$/i);
  if (!fn) return null;
  const name = fn[1].toLowerCase();
  const parts = fn[2].split(/[\s,/]+/).filter((p) => p !== '');
  if (parts.length < 3) return null;
  const num = (s: string): number => parseFloat(s);
  const alpha = parts.length >= 4 ? (parts[3].endsWith('%') ? num(parts[3]) / 100 : num(parts[3])) : 1;
  if (Number.isNaN(alpha)) return null;
  if (name.startsWith('rgb')) {
    const [r, g, b] = parts.map(num);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b, a: alpha };
  }
  if (name.startsWith('hsl')) {
    const h = num(parts[0]);
    const s = num(parts[1]) / 100;
    const l = num(parts[2]) / 100;
    if ([h, s, l].some(Number.isNaN)) return null;
    const f = (k: number): number => {
      const kk = (k + h / 30) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(kk - 3, 9 - kk, 1));
    };
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: alpha };
  }
  // oklch(L C H [/ a]) → sRGB (Björn Ottosson's OKLab constants).
  const L = num(parts[0]);
  const C = num(parts[1]);
  const H = num(parts[2]);
  if ([L, C, H].some(Number.isNaN)) return null;
  const hr = (H * Math.PI) / 180;
  const aa = C * Math.cos(hr);
  const bb = C * Math.sin(hr);
  const l3 = L + 0.3963377774 * aa + 0.2158037573 * bb;
  const m3 = L - 0.1055613458 * aa - 0.0638541728 * bb;
  const s3 = L - 0.0894841775 * aa - 1.291485548 * bb;
  const l = l3 * l3 * l3;
  const m = m3 * m3 * m3;
  const s = s3 * s3 * s3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((ch) => {
    const cl = Math.max(0, Math.min(1, ch));
    return (cl <= 0.0031308 ? 12.92 * cl : 1.055 * Math.pow(cl, 1 / 2.4) - 0.055) * 255;
  });
  return { r: lin[0], g: lin[1], b: lin[2], a: alpha };
}

/**
 * The uniform DIM transform: 50% saturation, 50% value (HSV), hue and
 * alpha untouched — "a filter laid over the whole dimmed region". Applied
 * to EVERY color painted inside a dimmed region (fill, hatching, border,
 * label text), so relative text-vs-fill contrast is preserved while the
 * whole section recedes. Accepts #hex, rgb()/rgba(), hsl()/hsla(), and
 * oklch() color forms; anything else (named colors, var() references) is
 * returned unchanged — the caller keeps a sane color either way.
 */
export function dimColor(color: string): string {
  const p = parseColor(color);
  if (!p) return color;
  const r = Math.max(0, Math.min(255, p.r)) / 255;
  const g = Math.max(0, Math.min(255, p.g)) / 255;
  const b = Math.max(0, Math.min(255, p.b)) / 255;
  const v = Math.max(r, g, b);
  const d = v - Math.min(r, g, b);
  const sat = v === 0 ? 0 : d / v;
  let h = 0;
  if (d !== 0) {
    if (v === r) h = ((g - b) / d) % 6;
    else if (v === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h + 6) % 6;
  }
  const s2 = sat * 0.5;
  const v2 = v * 0.5;
  const cc = v2 * s2;
  const x = cc * (1 - Math.abs((h % 2) - 1));
  const m0 = v2 - cc;
  const sector = Math.floor(h) % 6;
  const rgb1 = [
    [cc, x, 0],
    [x, cc, 0],
    [0, cc, x],
    [0, x, cc],
    [x, 0, cc],
    [cc, 0, x],
  ][sector];
  const out = rgb1.map((ch) => Math.round((ch + m0) * 255));
  return `rgba(${out[0]}, ${out[1]}, ${out[2]}, ${round3(p.a)})`;
}

// -- Label legibility -----------------------------------------------------------------

/** WCAG relative luminance (0..1) of sRGB 0..255 channels. */
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (ch: number): number => {
    const s = Math.max(0, Math.min(255, ch)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Halo color for canvas label text: the translucent counter-color rim
 * (`strokeText` under the fill) that guarantees label legibility over
 * ANY surface — solid fills, dimmed/hatched segments, pattern stripes,
 * scrims — at every zoom. Picks whichever of black/white contrasts more
 * with the foreground itself (the WCAG-ratio crossover sits at relative
 * luminance ≈ 0.1791): dark halo under a light fg, light halo under a
 * dark fg, so the pairing holds on light themes too. Alpha 0.55 keeps it
 * a rim, not a box. Unparseable colors (var() refs, named colors) fall
 * back to the dark halo — the shape of the dark default theme.
 */
export function labelHaloColor(fg: string): string {
  const p = parseColor(fg);
  // contrast(fg, black) >= contrast(fg, white) ⇔ (L+0.05)² >= 0.05·1.05.
  const dark = !p || relativeLuminance(p.r, p.g, p.b) >= Math.sqrt(0.05 * 1.05) - 0.05;
  return dark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.55)';
}
