// Pure markdown parsing and the safety transform: source text -> a SAFE
// mdast tree.
//
// This is the node-testable half of ui/markdown.ts, split the way
// perf-graph-math is split out of perf-graph. It touches no DOM, so every
// decision that matters for safety is testable under `node --test`.
//
// Parsing is micromark via mdast-util-from-markdown, with GFM enabled --
// CommonMark plus tables, task lists, strikethrough and literal autolinks.
// Correctness is therefore somebody else's full-time job, not a pile of
// regexes here.
//
// What IS this module's job is the step after parsing. A markdown renderer
// is usually handed text somebody else wrote -- a PR description, an issue
// body, a comment -- and there are exactly two ways that hurts you:
//
//   1. Raw HTML. CommonMark says `<script>alert(1)</script>` in the source
//      is HTML, and mdast faithfully reports it as an `html` node. Render
//      that as markup and you have handed the author script execution.
//   2. Link destinations. `[click](javascript:alert(1))` is a perfectly
//      well-formed CommonMark link; the danger is entirely in its URL.
//
// sanitizeTree() closes both, in the tree, before anything reaches a DOM:
// `html` nodes become literal text, and unsafe URLs lose their link. The
// renderer downstream is then mechanical -- it cannot reintroduce either
// problem, because no node reaching it can express markup and no URL
// reaching it has an unsafe scheme. That is why there is no HTML string and
// no sanitizer pass anywhere in this module pair.

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { Nodes, Root, RootContent } from 'mdast';

export type { Nodes, Root, RootContent } from 'mdast';

/** Schemes a link may use. Everything else is refused outright. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * The href to use for `raw`, or null if it must not become a link.
 *
 * Absolute URLs are allowed only on SAFE_SCHEMES -- this is what keeps
 * `javascript:`, `data:`, `vbscript:` and `file:` out of an href. Relative
 * URLs (including protocol-relative `//host/path`) have no scheme of their
 * own and inherit the page's, so they pass through.
 *
 * Scheme detection is the URL parser's, not a string match, so the usual
 * evasions are already handled: it lowercases the scheme and strips leading
 * whitespace and embedded tab/newline/CR before parsing, making
 * `JaVaScRiPt:`, ` javascript:` and `java&#9;script:` all resolve to the
 * javascript: protocol and be refused.
 */
export function safeHref(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed; // relative: no scheme of its own
  }
  return SAFE_SCHEMES.has(url.protocol) ? trimmed : null;
}

/**
 * Parses markdown to an mdast tree (CommonMark + GFM), already sanitized by
 * sanitizeTree. Returns null for input that is absent, or whose tree has no
 * content -- so a caller can tell "no content" from "content that rendered
 * to nothing" and show its own empty state.
 */
export function parseMarkdown(source: string | null | undefined): Root | null {
  if (typeof source !== 'string' || source.trim() === '') return null;
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  sanitizeTree(tree);
  return tree.children.length > 0 ? tree : null;
}

/**
 * Rewrites a tree in place so nothing in it can express markup or an unsafe
 * URL. Exported (and separately tested) because it IS the safety boundary:
 *
 *   - `html` nodes -- raw HTML, block or inline -- become `text` nodes
 *     carrying the same characters, so the source shows up as the literal
 *     text it was written as rather than as markup. Nothing is dropped: a
 *     reader still sees exactly what the author typed.
 *   - `link` / `image` / `definition` URLs go through safeHref. A refused
 *     link is REPLACED BY ITS OWN CHILDREN (its visible label survives,
 *     unlinked); a refused image becomes its alt text. Removing the node
 *     entirely would silently swallow content.
 *   - Reference-style links and images (`[a][b]`) whose definition is
 *     refused resolve to nothing linkable, so they are flattened the same
 *     way.
 */
export function sanitizeTree(tree: Root): Root {
  // A definition whose URL is refused must not be reachable by reference.
  const refusedDefinitions = new Set<string>();
  collectRefusedDefinitions(tree, refusedDefinitions);
  sanitizeChildren(tree as unknown as { children?: RootContent[] }, refusedDefinitions);
  return tree;
}

function collectRefusedDefinitions(node: Nodes, refused: Set<string>): void {
  if (node.type === 'definition' && safeHref(node.url) === null) {
    refused.add(node.identifier);
  }
  const kids = (node as { children?: Nodes[] }).children;
  if (kids) for (const child of kids) collectRefusedDefinitions(child, refused);
}

function sanitizeChildren(parent: { children?: RootContent[] }, refused: Set<string>): void {
  const children = parent.children;
  if (!children) return;

  const out: RootContent[] = [];
  for (const child of children) {
    // Recurse first so a replacement inherits already-clean descendants.
    sanitizeChildren(child as { children?: RootContent[] }, refused);

    switch (child.type) {
      case 'html':
        // Raw HTML: keep the characters, lose the markup-ness.
        out.push({ type: 'text', value: child.value, position: child.position });
        break;

      case 'link':
      case 'linkReference': {
        const ok =
          child.type === 'link'
            ? safeHref(child.url) !== null
            : !refused.has(child.identifier);
        if (ok) {
          if (child.type === 'link') child.url = safeHref(child.url)!;
          out.push(child);
        } else {
          // Unlink: the label survives as ordinary content.
          out.push(...(child.children as RootContent[]));
        }
        break;
      }

      case 'image':
      case 'imageReference': {
        const ok =
          child.type === 'image'
            ? safeHref(child.url) !== null
            : !refused.has(child.identifier);
        if (ok) {
          if (child.type === 'image') child.url = safeHref(child.url)!;
          out.push(child);
        } else if (child.alt) {
          out.push({ type: 'text', value: child.alt, position: child.position });
        }
        break;
      }

      case 'definition':
        // Definitions render nothing; a refused one is already unreachable.
        out.push(child);
        break;

      default:
        out.push(child);
    }
  }
  parent.children = out;
}

/**
 * Plain-text flattening for a tooltip or one-line summary: markup removed,
 * block-level nodes newline-separated. Pure -- no DOM.
 */
export function markdownToText(source: string | null | undefined): string {
  const tree = parseMarkdown(source);
  if (tree === null) return '';

  const lines: string[] = [];
  const inline = (node: Nodes): string => {
    if (node.type === 'text' || node.type === 'inlineCode') return node.value;
    if (node.type === 'break') return ' ';
    if (node.type === 'image') return node.alt ?? '';
    const kids = (node as { children?: Nodes[] }).children;
    return kids ? kids.map(inline).join('') : '';
  };

  const walk = (node: Nodes): void => {
    switch (node.type) {
      case 'code':
        lines.push(node.value);
        return;
      case 'thematicBreak':
        return;
      case 'paragraph':
      case 'heading':
      case 'tableCell':
        lines.push(inline(node));
        return;
      default: {
        const kids = (node as { children?: Nodes[] }).children;
        if (kids) for (const child of kids) walk(child);
      }
    }
  };

  walk(tree);
  return lines.filter((line) => line.trim() !== '').join('\n');
}
