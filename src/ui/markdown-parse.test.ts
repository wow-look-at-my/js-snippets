// Tests for the pure half of the markdown renderer (ui/markdown-parse.ts):
// the mdast tree micromark produces, and — the part that matters — the
// sanitize transform that is the safety boundary. ui/markdown.ts itself is
// DOM-bound (createElement / createTextNode) and not node-testable, see the
// Testing section in CLAUDE.md; but because sanitizeTree runs BEFORE any
// node reaches that walker, the properties below hold for the rendered
// output too. That is the whole point of doing the sanitizing in the tree.
//
// Parsing correctness itself is micromark's job and is not re-tested here;
// what IS tested is that GFM is actually switched on (tables, task lists,
// strikethrough), since that is a configuration decision this module makes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMarkdown,
  sanitizeTree,
  safeHref,
  markdownToText,
  type Nodes,
  type Root,
} from './markdown-parse.ts';

/** Every node in the tree, depth-first — the surface anything could hide in. */
const allNodes = (node: Nodes): Nodes[] => {
  const kids = (node as { children?: Nodes[] }).children ?? [];
  return [node, ...kids.flatMap(allNodes)];
};

const parse = (src: string): Root => {
  const tree = parseMarkdown(src);
  assert.ok(tree !== null, `expected a tree for ${JSON.stringify(src)}`);
  return tree;
};

const typesIn = (tree: Root): string[] => allNodes(tree as Nodes).map((n) => n.type);

const textIn = (tree: Root): string =>
  allNodes(tree as Nodes)
    .filter((n) => n.type === 'text')
    .map((n) => (n as { value: string }).value)
    .join('');

const linkish = (tree: Root): Nodes[] =>
  allNodes(tree as Nodes).filter(
    (n) =>
      n.type === 'link' ||
      n.type === 'image' ||
      n.type === 'linkReference' ||
      n.type === 'imageReference',
  );

// -- shape ---------------------------------------------------------------------

test('absent or blank input parses to nothing', () => {
  assert.equal(parseMarkdown(null), null);
  assert.equal(parseMarkdown(undefined), null);
  assert.equal(parseMarkdown(''), null);
  assert.equal(parseMarkdown('   \n\n \t '), null);
});

test('GFM is enabled: tables, task lists and strikethrough parse', () => {
  const table = parse('| a | b |\n| - | -: |\n| 1 | 2 |');
  const types = typesIn(table);
  assert.ok(types.includes('table'), types.join(','));
  assert.ok(types.includes('tableRow'));
  assert.ok(types.includes('tableCell'));
  // Column alignment survives — it is what the renderer styles cells from.
  const node = allNodes(table as Nodes).find((n) => n.type === 'table')!;
  assert.deepEqual((node as { align?: unknown }).align, [null, 'right']);

  const items = allNodes(parse('- [x] done\n- [ ] todo') as Nodes).filter(
    (n) => n.type === 'listItem',
  );
  assert.deepEqual(
    items.map((i) => (i as { checked?: boolean | null }).checked),
    [true, false],
  );

  assert.ok(typesIn(parse('~~gone~~')).includes('delete'));
});

test('nested lists nest, rather than flattening to one level', () => {
  // The concrete gap that made a hand-rolled parser the wrong answer here.
  const lists = allNodes(parse('- outer\n  - inner') as Nodes).filter((n) => n.type === 'list');
  assert.equal(lists.length, 2, 'an outer and a nested inner list');
  const outerItem = (lists[0] as unknown as { children: Nodes[] }).children[0];
  assert.ok(
    allNodes(outerItem).some((n) => n.type === 'list'),
    'the inner list hangs off the outer item',
  );
});

test('headings keep their depth; offsetting is the renderer’s job', () => {
  const headings = allNodes(parse('# One\n\n###### Six') as Nodes).filter(
    (n) => n.type === 'heading',
  );
  assert.deepEqual(
    headings.map((h) => (h as { depth: number }).depth),
    [1, 6],
  );
});

test('fenced code keeps its text and language verbatim', () => {
  const code = allNodes(parse('```js\nconst x = 1 < 2 && 3 > 2;\n```') as Nodes).find(
    (n) => n.type === 'code',
  ) as { lang?: string | null; value: string };
  assert.equal(code.lang, 'js');
  assert.equal(code.value, 'const x = 1 < 2 && 3 > 2;');
});

test('markdownToText flattens to plain lines', () => {
  assert.equal(markdownToText('# Title\n\nsome **bold** text'), 'Title\nsome bold text');
  assert.equal(markdownToText(''), '');
});

// -- the safety boundary -------------------------------------------------------
//
// Markdown is typically written by somebody other than the page's author.
// These invariants are what make rendering it safe, and they must not
// regress. Everything here is asserted on the tree, which is exactly what
// the DOM walker consumes.

test('raw HTML never survives as markup — it becomes literal text', () => {
  const tree = parse(
    '<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>\n\ntext <b>b</b>',
  );

  // CommonMark says these ARE html nodes; the whole job is that none reach
  // the renderer.
  assert.equal(
    typesIn(tree).filter((t) => t === 'html').length,
    0,
    'no html node may survive sanitizeTree',
  );

  // Nothing is dropped: the reader still sees what the author typed.
  const text = textIn(tree);
  assert.match(text, /<img src=x onerror="alert\(1\)">/);
  assert.match(text, /<script>alert\(1\)<\/script>/);
  assert.match(text, /<b>/);
});

test('safeHref allows only http(s) and mailto', () => {
  assert.equal(safeHref('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeHref('http://example.com/a'), 'http://example.com/a');
  assert.equal(safeHref('mailto:a@b.c'), 'mailto:a@b.c');
  // Relative URLs have no scheme of their own and inherit the page's.
  assert.equal(safeHref('/docs/x'), '/docs/x');
  assert.equal(safeHref('../x?y=1#z'), '../x?y=1#z');

  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'file:///etc/passwd',
    '',
    '   ',
    null,
    undefined,
  ]) {
    assert.equal(safeHref(bad), null, JSON.stringify(bad));
  }
});

test('safeHref is not fooled by case, padding, or embedded control characters', () => {
  // The URL parser lowercases the scheme and strips leading whitespace and
  // embedded tab/newline/CR before parsing — exactly as a browser would when
  // it navigates, which is why detection is delegated to it rather than to a
  // string match.
  for (const bad of [
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    '\tjavascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    'JAVASCRIPT:alert(1)',
  ]) {
    assert.equal(safeHref(bad), null, JSON.stringify(bad));
  }
});

test('a refused link is unlinked, and its label survives as content', () => {
  for (const src of [
    '[click](javascript:alert(1))',
    '[click](data:text/html,x)',
    '[click](vbscript:msgbox)',
    '# [click](javascript:alert(1))',
    '> [click](javascript:alert(1))',
    '- [click](javascript:alert(1))',
    '| h |\n| - |\n| [click](javascript:alert(1)) |',
  ]) {
    const tree = parse(src);
    assert.equal(linkish(tree).length, 0, src);
    assert.match(textIn(tree), /click/, src);
  }
});

test('a refused image degrades to its alt text', () => {
  const tree = parse('![shot](javascript:alert(1))');
  assert.equal(linkish(tree).length, 0);
  assert.match(textIn(tree), /shot/);
});

test('reference-style links cannot smuggle a refused URL in via a definition', () => {
  // The destination lives in a separate node from the link, so a check that
  // only looked at `link` nodes would miss this entirely.
  const tree = parse('[click][bad]\n\n[bad]: javascript:alert(1)');
  assert.equal(linkish(tree).length, 0);
  assert.match(textIn(tree), /click/);

  // The safe twin still resolves, so the guard is not just refusing everything.
  const ok = parse('[click][good]\n\n[good]: https://example.com/x');
  assert.equal(linkish(ok).length, 1);
});

test('a safe link keeps its destination', () => {
  const link = allNodes(parse('[docs](https://example.com/x)') as Nodes).find(
    (n) => n.type === 'link',
  ) as { url: string };
  assert.equal(link.url, 'https://example.com/x');

  // A destination with balanced parens is CommonMark's problem, and it gets
  // it right — a naive parser truncates this into a WRONG link.
  const wiki = allNodes(parse('[w](https://en.wikipedia.org/wiki/Foo_(bar))') as Nodes).find(
    (n) => n.type === 'link',
  ) as { url: string };
  assert.equal(wiki.url, 'https://en.wikipedia.org/wiki/Foo_(bar)');
});

test('sanitizeTree is idempotent and safe to re-run on a clean tree', () => {
  const tree = parse('[ok](https://e.example) and <b>raw</b>');
  const once = JSON.stringify(tree);
  assert.equal(JSON.stringify(sanitizeTree(tree)), once);
});
