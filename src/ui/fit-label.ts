// Fits one line of DOM text to its element's width by dropping pieces of the label until it fits.
import { deriveLabelTiers, selectTier } from './canvas-text.ts';

/**The forms of a label, longest first: deriveLabelTiers' forms, each followed
 * by itself with its leading ` · ` pieces dropped in turn. A ` · ` title goes
 * from the general to the specific (`repo · runner · job 42`), so its tail is
 * the part that tells labels apart. */
export function fitLabelTiers(label: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (s.trim() !== '' && !out.includes(s)) out.push(s);
  };
  for (const tier of deriveLabelTiers(label)) {
    add(tier);
    const parts = tier.split(' · ');
    for (let i = 1; i < parts.length; i++) add(parts.slice(i).join(' · '));
  }
  if (out.length === 0) out.push(label);
  // Every form is the label with pieces taken away, so longer keeps more.
  return out.sort((a, b) => b.length - a.length);
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/**Show in `el` the longest form of `label` that fits its width. `tiers`
 * replaces the derived forms. The full label goes in `el.title`. */
export function fitLabel(el: HTMLElement, label: string, tiers?: readonly string[]): void {
  el.title = label;
  el.style.overflow = 'hidden';
  el.style.whiteSpace = 'nowrap';
  const own = (tiers ?? []).filter((s) => s !== '');
  const forms = own.length > 0 ? own : fitLabelTiers(label);
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  const avail = el.clientWidth;
  if (ctx === null || avail <= 0) {
    el.textContent = label;
    return;
  }
  ctx.font = getComputedStyle(el).font;
  const i = selectTier(forms, avail, (s) => ctx.measureText(s).width);
  el.textContent = i >= 0 ? forms[i] : forms[forms.length - 1];
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
