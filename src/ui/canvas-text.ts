// Multi-tier canvas labels. The widest tier that fits draws; past the last tier the text clips and fades.

/** Rendered width of `text` in px. Must be monotonic over prefixes of a string. */
export type MeasureText = (text: string) => number;

/* */
export const FADE_TAIL_CHARS = 2.5;

/** Default minimum characters a clipped (faded) result keeps; fewer → suppressed. */
export const MIN_CLIP_CHARS = 3;

export interface FittedText {
  /** Text to draw: a full tier, or the clipped head of the most compact one. */
  text: string;
  /* */
  tier: number;
  /** True when `text` is clipped and should be drawn with a fade tail. */
  faded: boolean;
  /** Measured width of `text` in px. */
  width: number;
}

/**
 * Derive tiers from a single label: the full text; then with a leading
 * `owner/` path segment stripped (only when that segment contains no
 * whitespace); then with everything from the first ` - ` on stripped.
 * Inapplicable tiers are skipped; always returns >= 1 tier.
 */
export function deriveLabelTiers(label: string): string[] {
  const tiers = [label];
  let s = label;
  const slash = s.indexOf('/');
  if (slash > 0 && slash < s.length - 1 && !/\s/.test(s.slice(0, slash))) {
    const rest = s.slice(slash + 1);
    if (rest.trim() !== '') {
      tiers.push(rest);
      s = rest;
    }
  }
  const sep = s.indexOf(' - ');
  if (sep > 0) {
    const head = s.slice(0, sep).trimEnd();
    if (head !== '') tiers.push(head);
  }
  return tiers;
}

/* */
export function selectTier(tiers: readonly string[], availPx: number, measure: MeasureText): number {
  for (let i = 0; i < tiers.length; i++) {
    if (tiers[i] !== '' && measure(tiers[i]) <= availPx) return i;
  }
  return -1;
}

/** Longest prefix of `text` whose measured width fits `availPx` ('' when none). */
export function clipToWidth(text: string, availPx: number, measure: MeasureText): string {
  if (text === '' || availPx <= 0) return '';
  if (measure(text) <= availPx) return text;
  let lo = 0; // fits
  let hi = text.length; // doesn't
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (measure(text.slice(0, mid)) <= availPx) lo = mid;
    else hi = mid;
  }
  return text.slice(0, lo);
}

export interface FitTieredOptions {
  /** Minimum characters a clipped result keeps; fewer → null. Default MIN_CLIP_CHARS. */
  minClipChars?: number;
}

/**
 * Fit a tiered label: the largest tier that fits wins (`faded: false`); when
 * none fits, the most compact tier is clipped to width (`faded: true` — draw
 * with a fade tail). Null = nothing presentable; suppress the label. A plain
 * string is a single tier.
 */
export function fitTieredText(
  tiers: string | readonly string[],
  availPx: number,
  measure: MeasureText,
  opts?: FitTieredOptions,
): FittedText | null {
  let lastText = '';
  let lastTier = -1;
  if (typeof tiers === 'string') {
    if (tiers !== '') {
      const width = measure(tiers);
      if (width <= availPx) return { text: tiers, tier: 0, faded: false, width };
      lastText = tiers;
      lastTier = 0;
    }
  } else {
    for (let i = 0; i < tiers.length; i++) {
      const text = tiers[i];
      if (text === '') continue;
      const width = measure(text);
      if (width <= availPx) return { text, tier: i, faded: false, width };
      lastText = text;
      lastTier = i;
    }
  }
  if (lastTier < 0) return null;
  const clipped = clipToWidth(lastText, availPx, measure);
  if (clipped.length < (opts?.minClipChars ?? MIN_CLIP_CHARS)) return null;
  return { text: clipped, tier: lastTier, faded: true, width: measure(clipped) };
}

/** Draws text whose trailing `fadePx` alpha-fades to transparent. */
export class FadeTextPainter {
  private grads = new Map<string, CanvasGradient>();

  /** Drop cached gradients (call when theme colors change). */
  clear(): void {
    this.grads.clear();
  }

  private gradient(ctx: CanvasRenderingContext2D, color: string, fadePx: number): CanvasGradient {
    const key = `${fadePx}\u0000${color}`;
    let g = this.grads.get(key);
    if (g === undefined) {
      if (this.grads.size >= 64) this.grads.clear(); // bound per-label color churn
      g = ctx.createLinearGradient(0, 0, fadePx, 0);
      g.addColorStop(0, color);
      g.addColorStop(1, 'transparent'); // premultiplied interpolation: alpha-only fade
      this.grads.set(key, g);
    }
    return g;
  }

  /**
   * Fill `text` at (x, y), left-aligned, `width` = its measured width, with
   * the last `fadePx` px fading out; an optional halo strokes under the fill
   * with the same fade. A fadePx wider than the text clamps to whole-px
   * steps so the gradient cache stays bounded.
   */
  paint(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    width: number,
    fadePx: number,
    fill: string,
    halo?: string,
    haloWidth = 0,
  ): void {
    const fw = fadePx <= width ? fadePx : Math.max(1, Math.floor(width));
    const tx = x + width - fw;
    ctx.save();
    ctx.translate(tx, 0);
    ctx.textAlign = 'left';
    const lx = x - tx;
    if (halo !== undefined && haloWidth > 0) {
      ctx.strokeStyle = this.gradient(ctx, halo, fw);
      ctx.lineWidth = haloWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, lx, y);
    }
    ctx.fillStyle = this.gradient(ctx, fill, fw);
    ctx.fillText(text, lx, y);
    ctx.restore();
  }
}
