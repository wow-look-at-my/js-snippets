/**
 * Custom <select> dropdown replacement — for browsers whose native dropdown
 * is broken or unusable.
 *
 * The motivating case is Tesla's in-car browser: it renders a native
 * `<select>` popup in a separate OS-level window that the page compositor
 * never captures, so the option list is invisible and every dropdown is
 * unusable. This module replaces a `<select>` with an **in-page popup
 * listbox** built from ordinary DOM and appended to `<body>` — no native
 * dropdown is ever opened, so nothing spawns the uncapturable window.
 *
 * The original `<select>` stays in the DOM as the model: it is hidden but
 * keeps its value, and choosing an option sets that value and dispatches
 * `input` + `change`, so any existing listener (or framework, e.g. lil-gui)
 * runs unchanged. Options are read live at open time, so a select whose
 * `<option>`s are repopulated later still works.
 *
 * Two ways to use it:
 *
 *   // 1. Upgrade existing native <select>s (gate on a broken-dropdown UA):
 *   import { installSelectFallback } from '.../ui/combobox.js';
 *   installSelectFallback();              // Tesla UA by default; force with { force: true }
 *
 *   // 2. Declarative custom element (always a custom dropdown):
 *   import '.../ui/combobox.js';          // registers <combo-box>
 *   //  <combo-box><select>…</select></combo-box>
 *
 * Rendered in the LIGHT DOM and injects its own themeable stylesheet once —
 * drop the module in, no CSS file to ship (the styles compile into this
 * module from combobox.css as a text import). Theme by overriding the
 * `--cb-*` custom properties (see COMBOBOX_CSS).
 *
 * The pure half — the activation gate, option navigation, type-ahead, and
 * popup placement math — lives in ui/combobox-logic.js and is re-exported
 * here, so one import is enough.
 */

import CSS_TEXT from './combobox.css';
import {
  computePopupPlacement,
  firstEnabledIndex,
  lastEnabledIndex,
  optionText,
  shouldEnable,
  stepActiveIndex,
  typeAheadTarget,
} from './combobox-logic.ts';
import type { EnableOptions, OptionLike } from './combobox-logic.ts';

export * from './combobox-logic.ts';

// -- Theme ---------------------------------------------------------------------

/**
 * The component's self-contained stylesheet (the combobox.css source). Every
 * colour reads a `--cb-*` custom property with an inline fallback, so it
 * works unthemed and retints when you set those on `:root`, a host, or any
 * ancestor. The popup is appended to `<body>`, so its rules are global (not
 * scoped to a host).
 */
export const COMBOBOX_CSS: string = CSS_TEXT;

const STYLE_ID = 'js-snippets-combobox-styles';

/** Inject the component stylesheet once (idempotent; no-op without a DOM). */
export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = COMBOBOX_CSS;
  (document.head || document.documentElement).appendChild(style);
}

// -- Upgrading a single <select> -------------------------------------------------

const UPGRADED = new WeakSet<HTMLSelectElement>();

export interface UpgradeOptions {
  /**
   * Return an existing element to reuse as the trigger (and leave the value
   * display to the host) instead of generating one. Lets the select's
   * surrounding widget keep painting the value — e.g. a lil-gui option
   * controller, where you would return the `.widget` and its `.display`
   * stays in sync. Return null/undefined to generate a trigger (default).
   */
  existingTrigger?: (select: HTMLSelectElement) => HTMLElement | null | undefined;
}

function currentText(select: HTMLSelectElement): string {
  return optionText(select.options[select.selectedIndex]);
}

/** Replace one native `<select>`'s dropdown with the in-page popup. */
export function upgradeSelect(select: HTMLSelectElement, opts: UpgradeOptions = {}): void {
  if (!select || UPGRADED.has(select)) return;
  if (select.multiple) return; // single-select popup only
  UPGRADED.add(select);

  injectStyles();
  select.classList.add('cb-select-hidden');

  const reuse = opts.existingTrigger?.(select) ?? null;
  let trigger: HTMLElement;
  let syncLabel: () => void = () => {};

  if (reuse) {
    // Host already paints the value (e.g. lil-gui's .display); just adopt it.
    trigger = reuse;
    trigger.classList.add('cb-trigger', 'cb-trigger-host');
  } else {
    trigger = document.createElement('div');
    trigger.className = 'cb-trigger cb-trigger-native';
    const textEl = document.createElement('span');
    textEl.className = 'cb-trigger-text';
    trigger.appendChild(textEl);
    select.insertAdjacentElement('afterend', trigger);
    syncLabel = () => { textEl.textContent = currentText(select); };
    syncLabel();
  }

  trigger.setAttribute('role', 'button');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  if (!trigger.hasAttribute('tabindex')) trigger.tabIndex = 0;

  const open = (e?: Event): void => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (select.disabled) return;
    openPopup(select, trigger, syncLabel);
  };

  trigger.addEventListener('click', open);
  trigger.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') open(e);
  });

  if (!reuse) {
    select.addEventListener('change', syncLabel);
    select.addEventListener('input', syncLabel);
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(syncLabel).observe(select, { childList: true, subtree: true, attributes: true });
    }
  }
}

// -- The popup listbox -----------------------------------------------------------

let currentPopup: { el: HTMLElement; cleanup: () => void } | null = null;

/** Open the popup listbox for a (hidden) select, anchored to its trigger. */
export function openPopup(select: HTMLSelectElement, trigger: HTMLElement, syncLabel: () => void = () => {}): void {
  closePopup();

  const options = Array.from(select.options);
  const optionData: OptionLike[] = options.map((o) => ({ text: optionText(o), disabled: o.disabled }));
  const popup = document.createElement('div');
  popup.className = 'cb-popup';
  popup.setAttribute('role', 'listbox');

  // Inherit the trigger's resolved colours so the popup matches its context.
  try {
    const ref = (trigger.querySelector && trigger.querySelector('.display')) || trigger;
    const cs = getComputedStyle(ref as Element);
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
      popup.style.background = cs.backgroundColor;
    }
    if (cs.color) popup.style.color = cs.color;
    if (cs.fontFamily) popup.style.fontFamily = cs.fontFamily;
    if (cs.fontSize) popup.style.fontSize = cs.fontSize;
  } catch {
    /* getComputedStyle can throw on detached nodes */
  }

  const items: HTMLElement[] = [];
  let activeIndex = select.selectedIndex < 0 ? firstEnabledIndex(optionData) : select.selectedIndex;

  function setActive(i: number): void {
    if (i < 0 || i >= items.length) return;
    items[activeIndex]?.classList.remove('cb-active');
    activeIndex = i;
    const el = items[activeIndex];
    el.classList.add('cb-active');
    el.scrollIntoView?.({ block: 'nearest' });
  }
  function choose(i: number): void {
    if (i < 0 || i >= options.length || optionData[i].disabled) return;
    if (select.selectedIndex !== i) {
      select.selectedIndex = i;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncLabel();
    closePopup();
    trigger.focus();
  }

  optionData.forEach((opt, i) => {
    const item = document.createElement('div');
    item.className = 'cb-option';
    item.setAttribute('role', 'option');
    item.textContent = opt.text;
    if (opt.disabled) item.classList.add('cb-disabled');
    if (i === select.selectedIndex) {
      item.classList.add('cb-selected');
      item.setAttribute('aria-selected', 'true');
    }
    item.addEventListener('mouseenter', () => { if (!opt.disabled) setActive(i); });
    item.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); choose(i); });
    popup.appendChild(item);
    items.push(item);
  });

  document.body.appendChild(popup);
  position(popup, trigger);
  setActive(activeIndex);
  trigger.setAttribute('aria-expanded', 'true');
  const hostDisplay = trigger.querySelector?.('.display') ?? null;
  hostDisplay?.classList.add('active');

  let typeBuf = '';
  let typeTimer: ReturnType<typeof setTimeout> | undefined;
  function typeAhead(ch: string): void {
    typeBuf += ch.toLowerCase();
    clearTimeout(typeTimer);
    typeTimer = setTimeout(() => { typeBuf = ''; }, 700);
    const target = typeAheadTarget(typeBuf, activeIndex, optionData);
    if (target >= 0) setActive(target);
  }

  const onKey = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive(stepActiveIndex(activeIndex, 1, optionData)); break;
      case 'ArrowUp': e.preventDefault(); setActive(stepActiveIndex(activeIndex, -1, optionData)); break;
      case 'Home': e.preventDefault(); setActive(firstEnabledIndex(optionData)); break;
      case 'End': e.preventDefault(); setActive(lastEnabledIndex(optionData)); break;
      case 'Enter':
      case ' ': e.preventDefault(); choose(activeIndex); break;
      case 'Escape': e.preventDefault(); closePopup(); trigger.focus(); break;
      case 'Tab': closePopup(); break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeAhead(e.key);
    }
  };
  const onDocPointer = (e: Event): void => {
    const t = e.target as Node;
    if (popup.contains(t) || trigger.contains(t)) return;
    closePopup();
  };
  const onReflow = (): void => closePopup();

  document.addEventListener('keydown', onKey, true);
  // Defer outside-click so the opening click doesn't immediately close us.
  setTimeout(() => document.addEventListener('pointerdown', onDocPointer, true), 0);
  window.addEventListener('scroll', onReflow, true);
  window.addEventListener('resize', onReflow, true);

  currentPopup = {
    el: popup,
    cleanup() {
      clearTimeout(typeTimer);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDocPointer, true);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow, true);
      trigger.setAttribute('aria-expanded', 'false');
      hostDisplay?.classList.remove('active');
      popup.remove();
    },
  };
}

/** Close the open popup, if any. */
export function closePopup(): void {
  if (!currentPopup) return;
  const c = currentPopup;
  currentPopup = null;
  c.cleanup();
}

/** Measure the popup, place it via the pure placement math, apply. */
function position(popup: HTMLElement, trigger: HTMLElement): void {
  const r = trigger.getBoundingClientRect();
  const placement = computePopupPlacement({
    trigger: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
    viewport: {
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
    },
    popup: { width: popup.offsetWidth, height: popup.offsetHeight },
  });
  popup.style.position = 'fixed';
  popup.style.zIndex = '2147483647';
  popup.style.minWidth = `${placement.minWidth}px`;
  popup.style.maxWidth = `${placement.maxWidth}px`;
  popup.style.maxHeight = `${placement.maxHeight}px`;
  popup.style.left = `${placement.left}px`;
  popup.style.top = `${placement.top}px`;
}

// -- Bulk upgrade + observation ---------------------------------------------------

/** Upgrade every `<select>` under `root` (default: the whole document). */
export function upgradeAll(root: ParentNode = document, opts: UpgradeOptions = {}): void {
  root.querySelectorAll('select').forEach((s) => upgradeSelect(s as HTMLSelectElement, opts));
}

export interface FallbackOptions extends EnableOptions, UpgradeOptions {
  /** Scope to scan/observe. Default: the whole document. */
  root?: ParentNode;
  /** Install a MutationObserver to upgrade selects added later. Default true. */
  observe?: boolean;
}

/**
 * Upgrade all current `<select>`s and (by default) watch for new ones. No-op
 * unless {@link shouldEnable} passes. Returns a disposer that stops observing.
 */
export function installSelectFallback(opts: FallbackOptions = {}): () => void {
  if (!shouldEnable(opts)) return () => {};
  const root = opts.root ?? document;
  upgradeAll(root, opts);

  let observer: MutationObserver | null = null;
  if (opts.observe !== false && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length) { upgradeAll(root, opts); return; }
      }
    });
    // Observe the document body when given a Document, else the node itself.
    let target: Node = root as unknown as Node;
    if ('body' in root) {
      const body = (root as Document).body;
      if (body) target = body;
    }
    observer.observe(target, { childList: true, subtree: true });
  }
  return () => observer?.disconnect();
}

// -- Declarative custom element ----------------------------------------------------

/**
 * `<combo-box><select>…</select></combo-box>` — upgrades its child `<select>`
 * to the in-page popup on connect, unconditionally (no UA gate). Exported so
 * you can register under a different tag: `customElements.define('x', ComboBox)`.
 */
export class ComboBox extends HTMLElement {
  connectedCallback(): void {
    const select = this.querySelector('select');
    if (select) upgradeSelect(select as HTMLSelectElement);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('combo-box')) {
  customElements.define('combo-box', ComboBox);
}
