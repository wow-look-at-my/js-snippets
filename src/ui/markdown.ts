// Markdown -> DOM renderer (CommonMark + GFM).
//
// The DOM half of ui/markdown-parse.ts, which parses (micromark) and holds
// the safety argument. By the time a tree reaches this walker it has been
// through sanitizeTree, so no node can express markup and no URL has an
// unsafe scheme -- which makes this file mechanical: it maps node types to
// elements and nothing else.
//
// It calls createElement/createTextNode and assigns textContent. There is NO
// innerHTML path here, deliberately and permanently. Note what that buys:
// there is no HTML string anywhere in the pipeline, so there is also no
// sanitizer to configure correctly -- the usual "parse to HTML, then scrub
// the HTML" round trip, and every mis-scrub bug that comes with it, simply
// does not exist here.
//
// Re-exports the parse module so one import is enough. A consumer wanting
// different output (real <img> tags, linked #123 references, a framework's
// virtual DOM) should walk parseMarkdown()'s mdast tree directly rather than
// post-processing this renderer's elements.

import { parseMarkdown } from './markdown-parse.ts';
import type { Nodes, Root } from 'mdast';

export * from './markdown-parse.ts';

export interface RenderMarkdownOptions {
  /**
   * Prefix for every class name the renderer sets: the root gets `<prefix>`,
   * and the parts needing styling hooks get `<prefix>-code`, `<prefix>-task`
   * and `<prefix>-table`. Default 'md'.
   */
  classPrefix?: string;
  /**
   * Added to every heading level, clamped to h1..h6. Use a positive offset
   * when the markdown is embedded in a page that owns its own headings -- a
   * description's `# Title` is a section of that description, and should not
   * outrank the page's real heading. Default 0 (faithful levels).
   */
  headingOffset?: number;
  /**
   * `target` for generated links, or null for same-tab navigation. When set,
   * `rel="noopener noreferrer"` is set with it -- never hand an untrusted
   * link a live `window.opener`. Default '_blank'.
   */
  linkTarget?: string | null;
  /**
   * Render images as real `<img>` elements. Default false: an image renders
   * as its alt text linked to the source instead, because loading a remote
   * image named by untrusted markdown leaks the reader's IP and referrer to
   * whoever wrote it. Turn it on only for markdown you trust.
   */
  renderImages?: boolean;
  /**
   * Document used to create nodes. Default `globalThis.document`; pass one
   * explicitly to render into another document (an iframe, a template).
   */
  document?: Document;
}

/**
 * Renders markdown into a fresh container element, or null when the source
 * is absent, empty, or has no content -- so a caller can tell "no content"
 * from "content that rendered to nothing" and show its own empty state.
 */
export function renderMarkdown(
  source: string | null | undefined,
  options: RenderMarkdownOptions = {},
): HTMLElement | null {
  const tree = parseMarkdown(source);
  if (tree === null) return null;

  const doc = options.document ?? globalThis.document;
  const prefix = options.classPrefix ?? 'md';
  const headingOffset = options.headingOffset ?? 0;
  const linkTarget = options.linkTarget === undefined ? '_blank' : options.linkTarget;
  const renderImages = options.renderImages ?? false;

  const el = (tag: string, className?: string): HTMLElement => {
    const node = doc.createElement(tag);
    if (className !== undefined) node.className = className;
    return node;
  };

  // Column alignment travels on the `table` node, but is applied per cell.
  let align: Array<'left' | 'right' | 'center' | null> = [];
  let column = 0;

  const appendChildren = (parent: Node, node: Nodes): void => {
    const kids = (node as { children?: Nodes[] }).children;
    if (kids) for (const child of kids) append(parent, child);
  };

  const wrap = (parent: Node, tag: string, node: Nodes, className?: string): void => {
    const element = el(tag, className);
    appendChildren(element, node);
    parent.appendChild(element);
  };

  const append = (parent: Node, node: Nodes): void => {
    switch (node.type) {
      case 'text':
        parent.appendChild(doc.createTextNode(node.value));
        break;

      case 'inlineCode': {
        const code = el('code');
        code.textContent = node.value;
        parent.appendChild(code);
        break;
      }

      case 'code': {
        const pre = el('pre', `${prefix}-code`);
        const code = el('code');
        code.textContent = node.value;
        if (node.lang) code.dataset.lang = node.lang;
        pre.appendChild(code);
        parent.appendChild(pre);
        break;
      }

      case 'paragraph':
        wrap(parent, 'p', node);
        break;

      case 'heading':
        wrap(parent, `h${Math.min(6, Math.max(1, node.depth + headingOffset))}`, node);
        break;

      case 'blockquote':
        wrap(parent, 'blockquote', node);
        break;

      case 'strong':
        wrap(parent, 'strong', node);
        break;

      case 'emphasis':
        wrap(parent, 'em', node);
        break;

      case 'delete':
        wrap(parent, 'del', node);
        break;

      case 'list':
        // `start` is meaningful only for ordered lists, and only when it is
        // not the default 1.
        if (node.ordered) {
          const ol = el('ol') as HTMLOListElement;
          if (typeof node.start === 'number' && node.start !== 1) ol.start = node.start;
          appendChildren(ol, node);
          parent.appendChild(ol);
        } else {
          wrap(parent, 'ul', node);
        }
        break;

      case 'listItem': {
        const li = el('li');
        // A GFM task item: render the checkbox as a disabled input so it
        // reads as state, not as something to click.
        if (typeof node.checked === 'boolean') {
          const box = el('input', `${prefix}-task`) as HTMLInputElement;
          box.type = 'checkbox';
          box.checked = node.checked;
          box.disabled = true;
          li.appendChild(box);
          li.appendChild(doc.createTextNode(' '));
        }
        appendChildren(li, node);
        parent.appendChild(li);
        break;
      }

      case 'table': {
        const table = el('table', `${prefix}-table`);
        const previousAlign = align;
        align = node.align ?? [];
        // GFM tables always have a header row; the rest is the body.
        const [head, ...body] = node.children;
        if (head) {
          const thead = el('thead');
          append(thead, head);
          table.appendChild(thead);
        }
        if (body.length > 0) {
          const tbody = el('tbody');
          for (const row of body) append(tbody, row);
          table.appendChild(tbody);
        }
        align = previousAlign;
        parent.appendChild(table);
        break;
      }

      case 'tableRow': {
        const tr = el('tr');
        column = 0;
        // A header row's cells are <th>; mdast does not mark them, so the
        // parent element decides.
        const cellTag = (parent as Element).tagName === 'THEAD' ? 'th' : 'td';
        for (const cell of node.children) {
          const td = el(cellTag);
          const alignment = align[column++];
          if (alignment) td.style.textAlign = alignment;
          appendChildren(td, cell);
          tr.appendChild(td);
        }
        parent.appendChild(tr);
        break;
      }

      case 'link': {
        const a = el('a') as HTMLAnchorElement;
        a.href = node.url;
        if (node.title) a.title = node.title;
        if (linkTarget !== null) {
          a.target = linkTarget;
          a.rel = 'noopener noreferrer';
        }
        appendChildren(a, node);
        parent.appendChild(a);
        break;
      }

      case 'image': {
        if (renderImages) {
          const img = el('img') as HTMLImageElement;
          img.src = node.url;
          img.alt = node.alt ?? '';
          if (node.title) img.title = node.title;
          parent.appendChild(img);
          break;
        }
        const a = el('a') as HTMLAnchorElement;
        a.href = node.url;
        if (linkTarget !== null) {
          a.target = linkTarget;
          a.rel = 'noopener noreferrer';
        }
        a.textContent = node.alt || node.url;
        parent.appendChild(a);
        break;
      }

      case 'thematicBreak':
        parent.appendChild(el('hr'));
        break;

      case 'break':
        parent.appendChild(el('br'));
        break;

      case 'footnoteReference':
      case 'definition':
      case 'footnoteDefinition':
        // Nothing to draw: definitions are link targets, and footnotes are
        // out of scope for an embedded description.
        break;

      default:
        // Any node type not handled above still contributes its content
        // rather than vanishing.
        appendChildren(parent, node);
    }
  };

  const root = el('div', prefix);
  appendChildren(root, tree as Root as Nodes);
  return root;
}
