/**
 * Pure logic for ui/combobox.ts — no DOM or browser APIs, unit-tested under
 * node. The DOM-bound half (ui/combobox.ts: the popup, the <combo-box>
 * element, the select upgrading) consumes and re-exports this module, so
 * consumers only ever import ui/combobox.js.
 *
 * What lives here: the activation gate (broken-dropdown UA matching + the
 * force overrides), option-text extraction, enabled-option navigation
 * (first/last/step with wrap-around and disabled skipping), type-ahead
 * matching, and the popup placement math (flip-above/below, viewport
 * clamping, width bounds).
 */

// -- Activation gating ---------------------------------------------------------

export interface EnableOptions {
  /** Bypass the user-agent gate entirely. */
  force?: boolean;
  /** Custom UA test. Default matches Tesla's in-car browser. */
  match?: (userAgent: string) => boolean;
}

/**
 * The default user-agent gate: browsers whose NATIVE `<select>` dropdown is
 * known-broken. Tesla's in-car browser (and its older QtCarBrowser shell)
 * renders the native dropdown in a separate OS window the page compositor
 * never captures, so the option list is invisible.
 */
export function isBrokenDropdownUA(userAgent: string): boolean {
  return /Tesla|QtCarBrowser/i.test(userAgent);
}

/** Whether a `location.search`-style query string carries `combobox=force`. */
export function hasForceParam(search: string | null | undefined): boolean {
  return !!search && /[?&]combobox=force\b/.test(search);
}

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
    const match = opts.match ?? isBrokenDropdownUA;
    if (match(globalThis.navigator?.userAgent ?? '')) return true;
    try {
      if (globalThis.localStorage && localStorage.getItem('js-combobox') === 'force') return true;
    } catch {
      /* storage may throw in sandboxed contexts */
    }
    if (hasForceParam(globalThis.location?.search)) return true;
  } catch {
    /* navigator/location may be absent */
  }
  return false;
}

// -- Options -------------------------------------------------------------------

/** The option shape the pure navigation/type-ahead helpers work on. */
export interface OptionLike {
  /** Display text (what type-ahead matches against). */
  text: string;
  disabled?: boolean;
}

/**
 * An option's display text: `textContent`, else `value`, else ''. Structural,
 * so it takes a real HTMLOptionElement or any `{ textContent?, value? }`.
 */
export function optionText(
  opt: { textContent?: string | null; value?: string } | null | undefined,
): string {
  return (opt && (opt.textContent || opt.value)) || '';
}

/** Index of the first non-disabled option (0 when there is none). */
export function firstEnabledIndex(options: readonly { disabled?: boolean }[]): number {
  for (let i = 0; i < options.length; i++) if (!options[i].disabled) return i;
  return 0;
}

/** Index of the last non-disabled option (length - 1 when there is none). */
export function lastEnabledIndex(options: readonly { disabled?: boolean }[]): number {
  for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) return i;
  return options.length - 1;
}

/**
 * The next active index after stepping `dir` (+1 / -1) from `current`:
 * wraps around and skips disabled options. With every option disabled the
 * step lands back on `current` (a full lap changes nothing); an empty list
 * returns `current` untouched.
 */
export function stepActiveIndex(
  current: number,
  dir: number,
  options: readonly { disabled?: boolean }[],
): number {
  let i = current;
  for (let n = 0; n < options.length; n++) {
    i = (i + dir + options.length) % options.length;
    if (!options[i].disabled) break;
  }
  return i;
}

/**
 * Type-ahead target: the first enabled option whose text starts with
 * `buffer` (case-insensitive), searching forward with wrap-around. A fresh
 * single-character buffer starts AFTER the active option (so repeating a
 * prefix walks through the matches); a multi-character buffer includes it
 * (the match under the caret should keep matching as the buffer grows).
 * Returns -1 when nothing matches (callers leave the active option alone).
 */
export function typeAheadTarget(
  buffer: string,
  activeIndex: number,
  options: readonly OptionLike[],
): number {
  const buf = buffer.toLowerCase();
  if (!buf) return -1;
  const startAt = buf.length === 1 ? activeIndex + 1 : activeIndex;
  for (let n = 0; n < options.length; n++) {
    const i = (startAt + n + options.length) % options.length;
    if (!options[i].disabled && options[i].text.toLowerCase().startsWith(buf)) return i;
  }
  return -1;
}

// -- Popup placement -----------------------------------------------------------

export interface PlacementInput {
  /** The trigger's bounding rect in viewport coordinates. */
  trigger: { top: number; bottom: number; left: number; width: number };
  /** Viewport size (window.innerWidth/innerHeight). */
  viewport: { width: number; height: number };
  /** The popup's natural (unconstrained) measured size. */
  popup: { width: number; height: number };
}

export interface PopupPlacement {
  top: number;
  left: number;
  /** Height cap: fits the chosen side, in [80, 320]. */
  maxHeight: number;
  /** Width floor: the trigger's own width. */
  minWidth: number;
  /** Width cap: at least 200 (unless the viewport is narrower), at most viewport - 16. */
  maxWidth: number;
  /** True when the popup opens above the trigger (more room there). */
  openUp: boolean;
}

/**
 * Where a fixed-position popup goes relative to its trigger. Prefers below;
 * flips above when the space below can't fit the (320px-capped) popup and
 * there is more room above. The chosen side's space caps `maxHeight`
 * (floored at 80 so a cramped viewport still shows a few options), and the
 * popup is clamped to stay >= 4px inside the viewport horizontally.
 */
export function computePopupPlacement(input: PlacementInput): PopupPlacement {
  const r = input.trigger;
  const vw = input.viewport.width;
  const vh = input.viewport.height;

  const minWidth = r.width;
  const maxWidth = Math.min(Math.max(r.width, 200), Math.max(vw - 16, 120));

  const spaceBelow = vh - r.bottom;
  const spaceAbove = r.top;
  const naturalHeight = input.popup.height || 0;
  const desired = Math.min(naturalHeight, 320);
  const openUp = spaceBelow < desired && spaceAbove > spaceBelow;

  let top: number;
  let maxHeight: number;
  if (openUp) {
    maxHeight = Math.max(80, Math.min(spaceAbove - 8, 320));
    const shown = Math.max(0, Math.min(naturalHeight, maxHeight, spaceAbove - 8));
    top = Math.max(4, r.top - 2 - shown);
  } else {
    maxHeight = Math.max(80, Math.min(spaceBelow - 8, 320));
    top = r.bottom + 2;
  }

  // Effective rendered width after the CSS min/max clamps above (min-width
  // wins over max-width, as in CSS).
  const width = Math.max(Math.min(input.popup.width || r.width, maxWidth), minWidth);
  let left = r.left;
  if (left + width > vw - 4) left = Math.max(4, vw - 4 - width);
  if (left < 4) left = 4;

  return { top, left, maxHeight, minWidth, maxWidth, openUp };
}
