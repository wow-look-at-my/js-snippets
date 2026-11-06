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

/** One element of a batch: its label, its forms, and the width and font a read gave. */
interface Job {
  el: HTMLElement;
  label: string;
  forms: string[];
  avail: number;
  font: string;
}

function prepare(el: HTMLElement, label: string, tiers?: readonly string[]): Job {
  el.title = label;
  el.style.overflow = 'hidden';
  el.style.whiteSpace = 'nowrap';
  const own = (tiers ?? []).filter((s) => s !== '');
  return { el, label, forms: own.length > 0 ? own : fitLabelTiers(label), avail: 0, font: '' };
}

/**Fit a batch in passes: every style write, then every layout read, then every
 * text write. A read after a write forces a layout, so one read per element
 * freezes the page for a few labels. */
function fitJobs(jobs: Job[]): void {
  for (const j of jobs) {
    j.avail = j.el.clientWidth;
    if (j.avail > 0) j.font = getComputedStyle(j.el).font;
  }
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  for (const j of jobs) {
    if (ctx === null || j.avail <= 0) {
      j.el.textContent = j.label;
      continue;
    }
    if (ctx.font !== j.font) ctx.font = j.font;
    const i = selectTier(j.forms, j.avail, (s) => ctx.measureText(s).width);
    j.el.textContent = i >= 0 ? j.forms[i] : j.forms[j.forms.length - 1];
  }
}

/**Show in `el` the longest form of `label` that fits its width. `tiers`
 * replaces the derived forms. The full label goes in `el.title`. */
export function fitLabel(el: HTMLElement, label: string, tiers?: readonly string[]): void {
  fitJobs([prepare(el, label, tiers)]);
}

const watched = new WeakSet<Element>();

/**
 * Fit every `[data-fit-label]` element under `root`, from its attribute value,
 * and fit them again whenever `root` changes size. Call it again after a
 * redraw; it watches each root only once. The whole batch costs one layout.
 */
export function fitLabelsIn(root: HTMLElement): void {
  const run = () => {
    const els = root.querySelectorAll<HTMLElement>('[data-fit-label]');
    fitJobs(Array.from(els, (el) => prepare(el, el.dataset.fitLabel ?? '')));
  };
  run();
  if (watched.has(root)) return;
  watched.add(root);
  new ResizeObserver(run).observe(root);
}
