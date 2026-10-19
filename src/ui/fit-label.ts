// Fits one line of DOM text to its element's width the way <timeline-view> fits a bar label: the widest tier that fits shows whole.
import { FADE_TAIL_CHARS, deriveLabelTiers, fitTieredText } from './canvas-text.ts';

export { deriveLabelTiers, fitTieredText } from './canvas-text.ts';

// The probe <timeline-view> takes its average character width from, so the fade is as long here as there.
const PROBE = 'abcdefghijklmnop0123456789';

let measureCtx: CanvasRenderingContext2D | null | undefined;

/**Fit `label` into `el`. `el` must have a width of its own (a block, a flex or
 * grid item with the first min-width). The text goes in a child span that
 * fades its tail when clipped. `tiers` overrides the tiers derived from the
 * label. The full label goes in `el.title`. */
export function fitLabel(el: HTMLElement, label: string, tiers?: readonly string[]): void {
  el.title = label;
  el.style.overflow = 'hidden';
  el.style.whiteSpace = 'nowrap';
  let span = el.firstElementChild as HTMLSpanElement | null;
  if (span === null || span.dataset.fitText === undefined) {
    span = document.createElement('span');
    span.dataset.fitText = '';
    span.style.display = 'inline-block';
    el.replaceChildren(span);
  }
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  const avail = el.clientWidth;
  if (ctx === null || avail <= 0) {
    show(span, label, 0);
    return;
  }
  ctx.font = getComputedStyle(el).font;
  const measure = (s: string) => ctx.measureText(s).width;
  const own = (tiers ?? []).filter((s) => s !== '');
  const fitted = fitTieredText(own.length > 0 ? own : deriveLabelTiers(label), avail, measure);
  if (fitted === null) {
    show(span, '', 0);
    return;
  }
  const charW = measure(PROBE) / PROBE.length || 6;
  show(span, fitted.text, fitted.faded ? Math.min(fitted.width, FADE_TAIL_CHARS * charW) : 0);
}

function show(span: HTMLSpanElement, text: string, fadePx: number): void {
  span.textContent = text;
  const mask = fadePx > 0 ? `linear-gradient(to right, #000 calc(100% - ${fadePx}px), transparent)` : '';
  span.style.maskImage = mask;
  span.style.setProperty('-webkit-mask-image', mask);
}

const watched = new WeakSet<Element>();

/**
 * Fit every `[data-fit-label]` element under `root`, from its attribute value,
 * and fit them again whenever `root` changes size. Call it again after a
 * redraw; it watches each root only once.
 */
export function fitLabelsIn(root: HTMLElement): void {
  const run = () => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-fit-label]')) fitLabel(el, el.dataset.fitLabel ?? '');
  };
  run();
  if (watched.has(root)) return;
  watched.add(root);
  new ResizeObserver(run).observe(root);
}
