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
 * drop the module in, no CSS file to ship. Theme by overriding the `--cb-*`
 * custom properties (see COMBOBOX_CSS).
 */

// -- Theme -------------------------------------------------------------------

/**
 * The component's self-contained stylesheet. Every colour reads a `--cb-*`
 * custom property with an inline fallback, so it works unthemed and retints
 * when you set those on `:root`, a host, or any ancestor. The popup is
 * appended to `<body>`, so its rules are global (not scoped to a host).
 */
export const COMBOBOX_CSS = `
.cb-select-hidden { display: none !important; }

.cb-trigger:focus-visible {
  outline: 2px solid var(--cb-accent, #5b9dd9);
  outline-offset: 1px;
}

.cb-trigger-native {
  position: relative;
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  min-height: 2rem;
  padding: 0.4rem 1.9rem 0.4rem 0.6rem;
  background: var(--cb-bg, #12141f);
  color: var(--cb-fg, #e2e8f0);
  border: 1px solid var(--cb-border, #2d3148);
  border-radius: var(--cb-radius, 6px);
  font: inherit;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}

.cb-trigger-native .cb-trigger-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cb-trigger-native::after {
  content: "";
  position: absolute;
  right: 0.7rem;
  top: 50%;
  width: 0;
  height: 0;
  border-left: 0.3rem solid transparent;
  border-right: 0.3rem solid transparent;
  border-top: 0.35rem solid currentColor;
  transform: translateY(-25%);
  opacity: 0.75;
  pointer-events: none;
}

.cb-popup {
  position: fixed;
  margin: 0;
  padding: 0.25rem 0;
  background: var(--cb-popup-bg, #12141f);
  color: var(--cb-popup-fg, #e2e8f0);
  border: 1px solid var(--cb-popup-border, rgba(255, 255, 255, 0.16));
  border-radius: var(--cb-radius, 6px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.cb-option {
  padding: 0.45rem 0.85rem;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.25;
}

.cb-option.cb-active { background: var(--cb-active, rgba(255, 255, 255, 0.14)); }
.cb-option.cb-selected { font-weight: 600; }
.cb-option.cb-selected::before { content: "\\203A  "; opacity: 0.8; }
.cb-option.cb-disabled { opacity: 0.4; cursor: default; }
.cb-option.cb-disabled.cb-active { background: transparent; }
`;

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

// -- Activation gating -------------------------------------------------------

export interface EnableOptions {
  /** Bypass the user-agent gate entirely. */
  force?: boolean;
  /** Custom UA test. Default matches Tesla's in-car browser. */
  match?: (userAgent: string) => boolean;
}

const defaultMatch = (ua: string): boolean => /Tesla|QtCarBrowser/i.test(ua);

/**
 * Whether the fallback should activate. True if `force`, the UA matches
 * (Tesla by default), or a manual override is set: `?combobox=force`,
 * `localStorage['js-combobox'] === 'force'`, or
 * `globalThis.__JS_COMBOBOX_FORCE__ = true`.
 */
export function shouldEnable(opts: EnableOptions = {}): boolean {
  try {
    if (opts.force) return true;
    if ((globalThis as { __JS_COMBOBOX_FORCE__?: unknown }).__JS_COMBOBOX_FORCE__) return true;
    const match = opts.match ?? defaultMatch;
    if (match(globalThis.navigator?.userAgent ?? '')) return true;
    try {
      if (globalThis.localStorage && localStorage.getItem('js-combobox') === 'force') return true;
    } catch {
      /* storage may throw in sandboxed contexts */
    }
    const search = globalThis.location?.search;
    if (search && /[?&]combobox=force\b/.test(search)) return true;
  } catch {
    /* navigator/location may be absent */
  }
  return false;
}

// -- Upgrading a single <select> ---------------------------------------------

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

function optionText(opt: HTMLOptionElement | undefined): string {
  return (opt && (opt.textContent || opt.value)) || '';
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

// -- The popup listbox -------------------------------------------------------

let currentPopup: { el: HTMLElement; cleanup: () => void } | null = null;

/** Open the popup listbox for a (hidden) select, anchored to its trigger. */
export function openPopup(select: HTMLSelectElement, trigger: HTMLElement, syncLabel: () => void = () => {}): void {
  closePopup();

  const options = Array.from(select.options);
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
  let activeIndex = select.selectedIndex < 0 ? firstEnabled() : select.selectedIndex;

  function firstEnabled(): number {
    for (let i = 0; i < options.length; i++) if (!options[i].disabled) return i;
    return 0;
  }
  function lastEnabled(): number {
    for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) return i;
    return options.length - 1;
  }
  function setActive(i: number): void {
    if (i < 0 || i >= items.length) return;
    items[activeIndex]?.classList.remove('cb-active');
    activeIndex = i;
    const el = items[activeIndex];
    el.classList.add('cb-active');
    el.scrollIntoView?.({ block: 'nearest' });
  }
  function moveActive(dir: number): void {
    let i = activeIndex;
    for (let n = 0; n < items.length; n++) {
      i = (i + dir + items.length) % items.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
  }
  function choose(i: number): void {
    if (i < 0 || i >= options.length || options[i].disabled) return;
    if (select.selectedIndex !== i) {
      select.selectedIndex = i;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncLabel();
    closePopup();
    trigger.focus();
  }

  options.forEach((opt, i) => {
    const item = document.createElement('div');
    item.className = 'cb-option';
    item.setAttribute('role', 'option');
    item.textContent = optionText(opt);
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
    const startAt = typeBuf.length === 1 ? activeIndex + 1 : activeIndex;
    for (let n = 0; n < items.length; n++) {
      const i = (startAt + n + items.length) % items.length;
      if (!options[i].disabled && optionText(options[i]).toLowerCase().startsWith(typeBuf)) {
        setActive(i);
        break;
      }
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveActive(1); break;
      case 'ArrowUp': e.preventDefault(); moveActive(-1); break;
      case 'Home': e.preventDefault(); setActive(firstEnabled()); break;
      case 'End': e.preventDefault(); setActive(lastEnabled()); break;
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

function position(popup: HTMLElement, trigger: HTMLElement): void {
  const r = trigger.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;

  popup.style.position = 'fixed';
  popup.style.minWidth = `${r.width}px`;
  popup.style.maxWidth = `${Math.min(Math.max(r.width, 200), Math.max(vw - 16, 120))}px`;
  popup.style.zIndex = '2147483647';

  const spaceBelow = vh - r.bottom;
  const spaceAbove = r.top;
  const desired = Math.min(popup.offsetHeight || 0, 320);
  let top: number;
  if (spaceBelow < desired && spaceAbove > spaceBelow) {
    popup.style.maxHeight = `${Math.max(80, Math.min(spaceAbove - 8, 320))}px`;
    top = Math.max(4, r.top - 2 - Math.min(popup.offsetHeight, spaceAbove - 8));
  } else {
    popup.style.maxHeight = `${Math.max(80, Math.min(spaceBelow - 8, 320))}px`;
    top = r.bottom + 2;
  }

  let left = r.left;
  const width = popup.offsetWidth || r.width;
  if (left + width > vw - 4) left = Math.max(4, vw - 4 - width);
  if (left < 4) left = 4;

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

// -- Bulk upgrade + observation ----------------------------------------------

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

// -- Declarative custom element ----------------------------------------------

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
