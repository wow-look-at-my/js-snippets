import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dagToSvg, dagToMermaid, mermaidText, xmlEscape, exportFileName, pngScale, EXPORT_PAD, PNG_MAX_SIDE } from './dag-export.ts';
import type { ExportNode, ExportEdge, ExportTheme } from './dag-export.ts';

const theme: ExportTheme = { bg: '#000', fg: '#fff', muted: '#888', font: 'sans-serif', fontSize: 11, radius: 6 };

const node = (id: string, x: number, y: number, extra: Partial<ExportNode> = {}): ExportNode => ({
  id,
  label: [id],
  sub: [],
  x,
  y,
  w: 100,
  h: 40,
  fill: '#abc',
  border: '#def',
  outline: false,
  dashed: false,
  emphasis: false,
  ...extra,
});

test('svg: the canvas is the bounds plus the pad on each side, and every node and edge is drawn', () => {
  const nodes = [node('a', 0, 0), node('b <&>', 200, 100, { outline: true, sub: ['sub "q"'] })];
  const edges: ExportEdge[] = [{ from: 'a', to: 'b <&>', label: 'waits', points: [{ x: 100, y: 20 }, { x: 200, y: 120 }], color: '#555', dashed: true }];
  const svg = dagToSvg(nodes, edges, { x: 0, y: 0, w: 300, h: 140 }, theme);
  assert.match(svg, new RegExp(`width="${300 + 2 * EXPORT_PAD}" height="${140 + 2 * EXPORT_PAD}"`));
  assert.equal((svg.match(/<rect x=/g) ?? []).length, 2);
  assert.equal((svg.match(/<polyline /g) ?? []).length, 1);
  assert.match(svg, /stroke-dasharray="6 4"/);
  assert.match(svg, /<title>b &lt;&amp;&gt;<\/title>/, 'an id is escaped');
  assert.match(svg, /sub &quot;q&quot;/, 'a sublabel is escaped');
  assert.match(svg, /points="124,44 224,144"/, 'points shift by the pad');
  assert.ok(!svg.includes('<&>'), 'no raw markup leaks');
});

test('svg: an edge with fewer than two points draws nothing', () => {
  const svg = dagToSvg([], [{ from: 'a', to: 'b', label: null, points: [{ x: 0, y: 0 }], color: '#555', dashed: false }], { x: 0, y: 0, w: 0, h: 0 }, theme);
  assert.ok(!svg.includes('<polyline '));
});

test('mermaid: generated ids, the real id in a comment, labels quoted and escaped, edges to unknown nodes dropped', () => {
  const text = dagToMermaid(
    [
      { id: 'o/r#1', label: 'Fix "x"', state: 'blocked' },
      { id: 'o/r#2', label: null, state: null },
    ],
    [
      { from: 'o/r#1', to: 'o/r#2', label: 'waits for merge' },
      { from: 'o/r#2', to: 'o/r#1', label: null },
      { from: 'o/r#1', to: 'gone', label: null },
    ],
    'LR',
  );
  assert.equal(
    text,
    [
      'flowchart LR',
      '  %% o/r#1',
      '  n0["Fix #quot;x#quot; [blocked]"]',
      '  %% o/r#2',
      '  n1["o/r#2"]',
      '  n0 -->|"waits for merge"| n1',
      '  n1 --> n0',
      '',
    ].join('\n'),
  );
});

test('escapes', () => {
  assert.equal(xmlEscape(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  assert.equal(mermaidText('a "b"\nc'), 'a #quot;b#quot; c');
});

test('file names carry the capture time to the second, with no colons', () => {
  assert.equal(exportFileName('graph', '2026-10-21T17:38:04.123Z', 'svg'), 'graph-2026-10-21T17-38-04Z.svg');
});

test('png scale keeps the asked scale, unless the longer side would pass the limit', () => {
  assert.equal(pngScale(1000, 500, 2), 2);
  assert.equal(pngScale(PNG_MAX_SIDE, 10, 2), 1);
  assert.equal(pngScale(4 * PNG_MAX_SIDE, 10, 1), 0.25);
});
