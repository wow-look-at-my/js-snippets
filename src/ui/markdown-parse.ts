// Pure markdown parsing and the safety transform: source text -> a SAFE mdast tree.

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { Nodes, Root, RootContent } from 'mdast';

export type { Nodes, Root, RootContent } from 'mdast';

/** Schemes a link may use. Everything else is refused outright. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** The href to use for `raw`, or null if it must not become a link. */
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

/** Rewrites a tree in place so nothing in it can express markup or an unsafe
 * URL. */
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
