/**
 * <code-editor> — a tiny, dependency-free syntax-highlighting code editor.
 *
 * The whole trick is that the highlighted token spans ARE the editable content
 * (a single `contenteditable` whose children are coloured `<span>`s and bare
 * whitespace text nodes). There is no textarea hidden under a highlight layer
 * and no transparent-text overlay to keep aligned — the native caret sits in
 * the real glyphs, so it can never drift. On every edit the text is
 * re-tokenized and the spans rebuilt, with the caret offset saved and restored
 * around the rebuild.
 *
 * It is a normal custom element rendered in the LIGHT DOM (so the proven
 * `window.getSelection()` caret math works identically across browsers) and it
 * injects its own scoped, themeable stylesheet once — drop the one module in
 * and you have a working editor, no CSS file to ship.
 *
 *   import { CodeEditor } from '.../editor/code-editor.js'; // registers <code-editor>
 *
 *   <code-editor language="glsl">float x = 1.0;</code-editor>
 *
 *   const ed = document.querySelector('code-editor');
 *   ed.value = 'vec3 n = normalize(p);';
 *   ed.addEventListener('input', () => console.log(ed.value));
 *
 * Theme by overriding the `--ce-*` custom properties (see CODE_EDITOR_CSS).
 * For read-only highlighting without an editor, use highlightToHTML() /
 * highlightToFragment().
 */

import {
  tokenize,
  classify,
  resolveLanguage,
  type HiToken,
  type LanguageDef,
} from './tokenizer';

export * from './tokenizer';

// -- Theme -------------------------------------------------------------------

/**
 * The component's self-contained stylesheet. Layout is scoped under `.ce-host`
 * (added to every editor element, so it works regardless of the registered tag
 * name); token colours are global `.ce-<role>` rules with inline `var()`
 * fallbacks, so highlightToHTML() output is coloured anywhere it lands. Every
 * colour reads a `--ce-*` custom property — set those on `:root`, the host, or
 * any ancestor to retheme. The defaults are a calm dark theme.
 */
export const CODE_EDITOR_CSS = `
.ce-host {
  --ce-bg: #0d1117;
  --ce-fg: #c9d1d9;
  --ce-caret: #58a6ff;
  --ce-selection: #2d4f7c66;
  --ce-border: #21262d;
  --ce-radius: 6px;
  --ce-pad: 12px 14px;
  --ce-font: ui-monospace, "JetBrains Mono", "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
  --ce-font-size: 13px;
  --ce-line-height: 1.6;

  display: block;
  background: var(--ce-bg);
  border: 1px solid var(--ce-border);
  border-radius: var(--ce-radius);
  overflow: hidden;
  box-sizing: border-box;
}
.ce-host .ce-editor {
  margin: 0;
  padding: var(--ce-pad);
  height: 100%;
  min-height: inherit;
  box-sizing: border-box;
  background: transparent;
  color: var(--ce-fg);
  font-family: var(--ce-font);
  font-size: var(--ce-font-size);
  line-height: var(--ce-line-height);
  tab-size: 4;
  white-space: pre;
  overflow: auto;
  outline: none;
  caret-color: var(--ce-caret);
}
.ce-host .ce-editor::selection,
.ce-host .ce-editor *::selection { background: var(--ce-selection); }
.ce-host .ce-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--ce-comment, #6e7681);
  opacity: 0.7;
}
.ce-host.ce-readonly .ce-editor { caret-color: transparent; cursor: default; }

/* Token colours — global so standalone highlightToHTML() output is coloured too. */
.ce-comment  { color: var(--ce-comment,  #6e7681); font-style: italic; }
.ce-number   { color: var(--ce-number,   #79c0ff); }
.ce-string   { color: var(--ce-string,   #a5d6ff); }
.ce-keyword  { color: var(--ce-keyword,  #ff7b72); }
.ce-function { color: var(--ce-function, #d2a8ff); }
.ce-member   { color: var(--ce-member,   #79c0ff); }
.ce-punct    { color: var(--ce-punct,    #8b949e); }
.ce-ident    { color: var(--ce-ident,    inherit); }
`;

const STYLE_ID = 'code-editor-styles';

/**
 * Inject the component stylesheet into `document.head` once (idempotent). Safe
 * to call in non-DOM environments — it no-ops. Called automatically by the
 * element and by the highlight helpers, so you rarely need it directly.
 */
export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CODE_EDITOR_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

// -- Read-only highlighting --------------------------------------------------

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function appendTokens(target: DocumentFragment, tokens: HiToken[]): void {
  for (const t of tokens) {
    if (t.role === 'ws') {
      target.appendChild(document.createTextNode(t.text));
      continue;
    }
    const span = document.createElement('span');
    span.textContent = t.text;
    span.className = 'ce-' + t.role;
    target.appendChild(span);
  }
}

/**
 * Highlight `code` into a DocumentFragment of coloured spans + whitespace text
 * nodes (its `textContent` equals `code` exactly). Injects the stylesheet so
 * the colours apply. Ideal for read-only views you build with the DOM.
 */
export function highlightToFragment(
  code: string,
  language?: string | LanguageDef,
): DocumentFragment {
  injectStyles();
  const frag = document.createDocumentFragment();
  appendTokens(frag, classify(tokenize(code), resolveLanguage(language)));
  return frag;
}

/**
 * Highlight `code` into an HTML string of coloured `<span>`s (text safely
 * escaped). Drop it into `innerHTML`; pair with CODE_EDITOR_CSS / injectStyles()
 * for the colours. Injects the stylesheet when a DOM is present.
 */
export function highlightToHTML(
  code: string,
  language?: string | LanguageDef,
): string {
  injectStyles();
  const tokens = classify(tokenize(code), resolveLanguage(language));
  let out = '';
  for (const t of tokens) {
    if (t.role === 'ws') out += escapeHtml(t.text);
    else out += `<span class="ce-${t.role}">${escapeHtml(t.text)}</span>`;
  }
  return out;
}

// -- The custom element ------------------------------------------------------

/**
 * The editor element. Auto-registered as `<code-editor>` when this module
 * loads (unless that name is already taken). Exported so you can register it
 * under a different name: `customElements.define('my-editor', CodeEditor)`.
 *
 * Attributes (all optional): `language`, `placeholder`, `readonly`,
 * `tab-size`, `spellcheck`. Property `value` is the source of truth; `language`
 * also accepts a LanguageDef object via the property. Emits the native
 * bubbling `input` event on user edits (read `.value` in the handler).
 */
export class CodeEditor extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['language', 'placeholder', 'readonly', 'tab-size', 'spellcheck'];
  }

  /** The editable element whose children are the highlighted tokens. */
  private editor!: HTMLDivElement;
  private _value = '';
  private _language: string | LanguageDef = 'clike';
  private _composing = false;
  private _initialized = false;

  // -- Lifecycle -------------------------------------------------------------

  connectedCallback(): void {
    if (this._initialized) return;
    this._initialized = true;

    injectStyles();
    this.classList.add('ce-host');

    // Seed initial text from the `value` attribute or the element's own text,
    // captured before we replace the children with the editor.
    const initial = this.getAttribute('value') ?? this.textContent ?? '';
    this._value = initial;
    const langAttr = this.getAttribute('language');
    if (langAttr) this._language = langAttr;

    this.editor = document.createElement('div');
    this.editor.className = 'ce-editor';
    this.editor.setAttribute(
      'spellcheck',
      this.getAttribute('spellcheck') ?? 'false',
    );
    this.editor.setAttribute('autocapitalize', 'off');
    this.editor.setAttribute('autocorrect', 'off');

    this.editor.addEventListener('compositionstart', this.onCompositionStart);
    this.editor.addEventListener('compositionend', this.onCompositionEnd);
    this.editor.addEventListener('input', this.onInputEvent);
    this.editor.addEventListener('keydown', this.onKeyDown);

    this.replaceChildren(this.editor);
    this.syncEditorAttrs();
    this.applyEditable();
    this.render();
  }

  attributeChangedCallback(
    name: string,
    _old: string | null,
    value: string | null,
  ): void {
    if (!this._initialized) return;
    switch (name) {
      case 'language':
        this._language = value ?? 'clike';
        this.render();
        break;
      case 'readonly':
        this.applyEditable();
        break;
      case 'spellcheck':
        this.editor.setAttribute('spellcheck', value ?? 'false');
        break;
      case 'placeholder':
      case 'tab-size':
        this.syncEditorAttrs();
        break;
    }
  }

  // -- Public API ------------------------------------------------------------

  /** The current source text. Setting it re-renders (does not fire `input`). */
  get value(): string {
    return this.editor ? this.editor.textContent ?? '' : this._value;
  }
  set value(v: string) {
    this._value = v ?? '';
    if (this._initialized) this.render();
  }

  /** The active language: a built-in name or a custom LanguageDef. */
  get language(): string | LanguageDef {
    return this._language;
  }
  set language(lang: string | LanguageDef) {
    this._language = lang || 'clike';
    if (this._initialized) this.render();
  }

  /** Whether editing is disabled. */
  get readOnly(): boolean {
    return this.hasAttribute('readonly');
  }
  set readOnly(v: boolean) {
    if (v) this.setAttribute('readonly', '');
    else this.removeAttribute('readonly');
  }

  /** Move keyboard focus into the editor. */
  override focus(): void {
    this.editor?.focus();
  }

  // -- Rendering -------------------------------------------------------------

  private render(): void {
    const lang = resolveLanguage(this._language);
    const frag = document.createDocumentFragment();
    appendTokens(frag, classify(tokenize(this._value), lang));
    this.editor.replaceChildren(frag);
  }

  private syncEditorAttrs(): void {
    const placeholder = this.getAttribute('placeholder');
    if (placeholder != null) this.editor.dataset.placeholder = placeholder;
    else delete this.editor.dataset.placeholder;

    const tabSize = this.getAttribute('tab-size');
    this.editor.style.tabSize = tabSize ?? '';
  }

  private applyEditable(): void {
    const ro = this.hasAttribute('readonly');
    this.classList.toggle('ce-readonly', ro);
    this.editor.setAttribute('contenteditable', ro ? 'false' : 'plaintext-only');
  }

  // -- Editing ---------------------------------------------------------------

  private onCompositionStart = (): void => {
    this._composing = true;
  };

  private onCompositionEnd = (): void => {
    this._composing = false;
    this.rehighlight();
  };

  private onInputEvent = (): void => {
    if (!this._composing) this.rehighlight();
  };

  // Re-tokenize and rebuild the spans, keeping the caret where the user was.
  private rehighlight(): void {
    const caret = this.getCaret();
    this._value = this.editor.textContent ?? '';
    this.render();
    this.setCaret(caret);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Tab inserts a real tab instead of moving focus out of the editor.
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      this.insertText('\t');
    }
  };

  private insertText(text: string): void {
    // execCommand keeps the native undo stack intact and fires `input`, which
    // drives the re-highlight. Fall back to a manual range edit if unavailable.
    try {
      if (document.execCommand('insertText', false, text)) return;
    } catch {
      /* fall through */
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    this.rehighlight();
  }

  // -- Caret save / restore (offset = character count from editor start) ------

  private getCaret(): number | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!this.editor.contains(range.endContainer)) return null;
    const pre = range.cloneRange();
    pre.selectNodeContents(this.editor);
    pre.setEnd(range.endContainer, range.endOffset);
    return pre.toString().length;
  }

  private setCaret(pos: number | null): void {
    if (pos == null) return;
    const range = document.createRange();
    let remaining = pos;
    let placed = false;
    const walk = (node: Node): void => {
      for (const child of Array.from(node.childNodes)) {
        if (placed) return;
        if (child.nodeType === Node.TEXT_NODE) {
          const len = child.textContent?.length ?? 0;
          if (remaining <= len) {
            range.setStart(child, remaining);
            placed = true;
            return;
          }
          remaining -= len;
        } else {
          walk(child);
        }
      }
    };
    walk(this.editor);
    if (!placed) {
      range.selectNodeContents(this.editor);
      range.collapse(false);
    } else {
      range.collapse(true);
    }
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// Auto-register under the conventional tag name, but never clobber an existing
// definition (a consumer may have registered their own, or loaded this twice).
if (typeof customElements !== 'undefined' && !customElements.get('code-editor')) {
  customElements.define('code-editor', CodeEditor);
}
