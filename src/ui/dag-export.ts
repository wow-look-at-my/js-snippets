// The pure half of the <dag-view> download menu: a placed graph as SVG text and as a Mermaid flowchart. No DOM.

/** One node as the export draws it, in world units. */
export interface ExportNode {
  id: string;
  /** The wrapped label lines, first line first. */
  label: string[];
  /** The wrapped sublabel lines. */
  sub: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  border: string;
  /** An outline box keeps the background as its fill, so its text takes the theme's colour. */
  outline: boolean;
  dashed: boolean;
  emphasis: boolean;
}

/** One routed edge as the export draws it, in world units. */
export interface ExportEdge {
  from: string;
  to: string;
  label: string | null;
  points: readonly { x: number; y: number }[];
  color: string;
  dashed: boolean;
}

/** The colours and the font of the picture. */
export interface ExportTheme {
  bg: string;
  fg: string;
  muted: string;
  font: string;
  fontSize: number;
  radius: number;
}

/** A margin round the whole picture, in world units. */
export const EXPORT_PAD = 24;

const LINE_GAP = 1.3;

/** Escapes text for an SVG text node or an attribute value. */
export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

function num(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/**
 * The whole graph as one standalone SVG document. Every node and edge is in it, not only the part
 * on screen. The text is real text, so a reader can search and copy it. `bounds` is the world box
 * that holds the drawing (`layoutBounds`).
 */
export function dagToSvg(
  nodes: readonly ExportNode[],
  edges: readonly ExportEdge[],
  bounds: { x: number; y: number; w: number; h: number },
  theme: ExportTheme,
): string {
  const ox = EXPORT_PAD - bounds.x;
  const oy = EXPORT_PAD - bounds.y;
  const W = Math.ceil(bounds.w + 2 * EXPORT_PAD);
  const H = Math.ceil(bounds.h + 2 * EXPORT_PAD);
  const fs = theme.fontSize;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(
    `<defs><marker id="dag-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill="${xmlEscape(theme.muted)}"/></marker></defs>`,
  );
  out.push(`<rect width="${W}" height="${H}" fill="${xmlEscape(theme.bg)}"/>`);
  out.push(`<g fill="none" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round">`);
  for (const e of edges) {
    if (e.points.length < 2) continue;
    const pts = e.points.map((p) => `${num(p.x + ox)},${num(p.y + oy)}`).join(' ');
    const dash = e.dashed ? ' stroke-dasharray="6 4"' : '';
    const title = `${e.from} → ${e.to}${e.label !== null ? ` (${e.label})` : ''}`;
    out.push(`<polyline points="${pts}" stroke="${xmlEscape(e.color)}"${dash} marker-end="url(#dag-arrow)"><title>${xmlEscape(title)}</title></polyline>`);
  }
  out.push(`</g>`);
  out.push(`<g font-family="${xmlEscape(theme.font)}" font-size="${num(fs)}">`);
  for (const n of nodes) {
    const x = n.x + ox;
    const y = n.y + oy;
    const r = Math.min(theme.radius, n.w / 2, n.h / 2);
    const fill = n.outline ? theme.bg : n.fill;
    const sw = n.emphasis ? 2.5 : 1;
    const dash = n.dashed ? ' stroke-dasharray="4 3"' : '';
    out.push(`<g><title>${xmlEscape(n.id)}</title>`);
    out.push(
      `<rect x="${num(x)}" y="${num(y)}" width="${num(n.w)}" height="${num(n.h)}" rx="${num(r)}" fill="${xmlEscape(fill)}" stroke="${xmlEscape(n.border)}" stroke-width="${sw}"${dash}/>`,
    );
    // A filled box sits on a light category colour, so its text is dark. An outline box takes the theme's text colour.
    const ink = n.outline ? theme.fg : '#0d0f14';
    let ty = y + 8 + fs;
    for (const line of n.label) {
      out.push(`<text x="${num(x + 8)}" y="${num(ty)}" fill="${xmlEscape(ink)}" font-weight="600">${xmlEscape(line)}</text>`);
      ty += fs * LINE_GAP;
    }
    for (const line of n.sub) {
      out.push(`<text x="${num(x + 8)}" y="${num(ty)}" fill="${xmlEscape(n.outline ? theme.muted : ink)}" opacity="0.8">${xmlEscape(line)}</text>`);
      ty += fs * LINE_GAP;
    }
    out.push(`</g>`);
  }
  out.push(`</g></svg>`);
  return out.join('\n');
}

/** Escapes text for a quoted Mermaid label. Mermaid reads `#name;` as an entity, so a quote becomes `#quot;`. */
export function mermaidText(s: string): string {
  return s.replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ');
}

/**
 * The graph as a Mermaid flowchart. A node id in this graph can hold any character, so each node
 * gets a short generated id (`n0`, `n1`, ...) and carries its real id in a `%%` comment.
 */
export function dagToMermaid(
  nodes: readonly { id: string; label: string | null; state: string | null }[],
  edges: readonly { from: string; to: string; label: string | null }[],
  orientation: 'TB' | 'LR',
): string {
  const ids = new Map<string, string>();
  const out: string[] = [`flowchart ${orientation}`];
  nodes.forEach((n, i) => {
    const key = `n${i}`;
    ids.set(n.id, key);
    const text = n.label !== null && n.label !== '' ? n.label : n.id;
    const state = n.state !== null && n.state !== '' ? ` [${n.state}]` : '';
    out.push(`  %% ${n.id.replace(/[\r\n]+/g, ' ')}`);
    out.push(`  ${key}["${mermaidText(text + state)}"]`);
  });
  for (const e of edges) {
    const a = ids.get(e.from);
    const b = ids.get(e.to);
    if (a === undefined || b === undefined) continue;
    out.push(e.label !== null && e.label !== '' ? `  ${a} -->|"${mermaidText(e.label)}"| ${b}` : `  ${a} --> ${b}`);
  }
  return out.join('\n') + '\n';
}

/** A file name for a download: a stem, the capture time to the second, and the extension. */
export function exportFileName(stem: string, capturedAt: string, ext: string): string {
  const t = capturedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return `${stem}-${t}.${ext}`;
}

/** The largest side, in device pixels, a PNG export draws at. Browsers refuse a canvas much larger. */
export const PNG_MAX_SIDE = 8192;

/** The scale a PNG export draws at: the asked one, shrunk until the longer side fits `PNG_MAX_SIDE`. */
export function pngScale(w: number, h: number, wanted: number): number {
  const side = Math.max(w, h);
  return side * wanted > PNG_MAX_SIDE ? PNG_MAX_SIDE / side : wanted;
}
