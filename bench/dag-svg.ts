// Measures the cost of a <dag-view> frame drawn on its canvas against the
// same scene as SVG DOM.

import '../src/ui/dag-view.ts';
import PAGE_CSS from './dag-svg.css';
import type { DagViewElement, DagNode, DagEdge, DagStyleMap, DagGroup } from '../src/ui/dag-view.ts';
import { SvgContext, vectorPattern } from './svg-context.ts';
import type { SvgPattern } from './svg-context.ts';

// The HTML target turns a <link> stylesheet into JS text, so the page adopts its CSS from here.
document.head.append(Object.assign(document.createElement('style'), { textContent: PAGE_CSS }));

const W = 1200;
const H = 700;
const SIZES = (new URLSearchParams(location.search).get('n') ?? '200,1000,3000').split(',').map(Number);
const FRAMES = Number(new URLSearchParams(location.search).get('frames') ?? 180);

// Every treatment the canvas draws: solid, active sheen, hatch, stipple, outline, dim, a fixed color, and a state with no rule.
const STYLES: DagStyleMap = {
	running: { active: true },
	pinned: { color: '#b07cf0' },
};
const STATES = ['done', 'running', 'failed', 'blocked', 'pending', 'missing', 'pinned', 'unheard-of'];

/** A layered graph: a seeded LCG, so every run and every browser gets the same graph. */
function makeGraph(n: number): { nodes: DagNode[]; edges: DagEdge[] } {
	let seed = 12345;
	const rnd = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
	const width = Math.max(4, Math.round(Math.sqrt(n) * 1.6));
	const nodes: DagNode[] = [];
	const edges: DagEdge[] = [];
	for (let i = 0; i < n; i++) {
		nodes.push({
			id: `n${i}`,
			label: `service-${i}`,
			sublabel: `build #${(i * 37) % 1000}`,
			category: `cat${i % 9}`,
			state: STATES[i % STATES.length],
			...(i % 11 === 0 ? { badge: `#${i}` } : {}),
		});
		const layer = Math.floor(i / width);
		if (layer === 0) continue;
		const fan = 1 + Math.floor(rnd() * 2);
		for (let k = 0; k < fan; k++) {
			const from = (layer - 1) * width + Math.floor(rnd() * width);
			if (from < i) edges.push({ from: `n${from}`, to: `n${i}` });
		}
	}
	return { nodes, edges };
}

interface Stats {
	p50: number;
	p95: number;
	max: number;
	fps: number;
}

function stats(intervals: number[], wall: number): Stats {
	const s = [...intervals].sort((a, b) => a - b);
	const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN;
	return { p50: q(0.5), p95: q(0.95), max: s[s.length - 1] ?? NaN, fps: (intervals.length / wall) * 1000 };
}

const raf = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));

/**
 * Runs `step(i)` inside FRAMES animation frames in a row. `js` is the time
 * spent inside step. `frame` is the gap between frame starts. That gap also
 * holds style, layout, paint and raster, which the JS time cannot see.
 */
async function runFrames(step: (i: number) => void): Promise<{ js: Stats; frame: Stats }> {
	for (let i = 0; i < 10; i++) {
		await raf();
		step(i);
	}
	const js: number[] = [];
	const gaps: number[] = [];
	let last = await raf();
	const t0 = last;
	for (let i = 0; i < FRAMES; i++) {
		const a = performance.now();
		step(i);
		js.push(performance.now() - a);
		const ts = await raf();
		gaps.push(ts - last);
		last = ts;
	}
	const wall = last - t0;
	return { js: stats(js, wall), frame: stats(gaps, wall) };
}

/** A pan path: one slow figure-of-eight across the graph, at a fixed scale. */
function panAt(i: number, scale: number, bw: number, bh: number): { x: number; y: number; scale: number } {
	const t = (i / FRAMES) * Math.PI * 2;
	const cx = (bw / 2) * scale;
	const cy = (bh / 2) * scale;
	return {
		x: W / 2 - cx + Math.sin(t) * Math.min(cx, 400),
		y: H / 2 - cy + Math.sin(2 * t) * Math.min(cy, 250),
		scale,
	};
}

// The bench reaches the element's private fields. A cast is the honest way to say that.
type Inner = HTMLElement &
	Pick<DagViewElement, 'nodes' | 'edges' | 'styles' | 'groups' | 'selected'> & {
		view: { x: number; y: number; scale: number };
		draw(): void;
		bounds: { x: number; y: number; w: number; h: number };
		ensureLayout(): void;
		invalidate(): void;
		patternFor(kind: 'hatch' | 'stipple', color: string): unknown;
		ctx: unknown;
		canvas: HTMLCanvasElement;
		dpr: number;
		cssW: number;
		cssH: number;
		crop: unknown;
		raf: number;
		frameTs: number;
	};

const SVG_NS = 'http://www.w3.org/2000/svg';

function stage(label: string, w = W, h = H): HTMLDivElement {
	const box = document.createElement('div');
	box.className = 'stage';
	box.style.width = `${w}px`;
	box.style.height = `${h}px`;
	box.dataset.label = label;
	document.getElementById('stages')!.replaceChildren(box);
	return box;
}

/** A mounted dag-view that draws only when the bench calls draw(): its own frame loop is off, so no case pays for renders. */
async function mount(host: HTMLElement, data: { nodes: DagNode[]; edges: DagEdge[]; groups?: DagGroup[] }): Promise<Inner> {
	const el = document.createElement('dag-view') as unknown as Inner;
	el.style.width = '100%';
	el.style.height = '100%';
	el.styles = STYLES;
	if (data.groups) el.groups = data.groups;
	el.nodes = data.nodes;
	el.edges = data.edges;
	host.append(el);
	await raf();
	await raf();
	el.invalidate = (): void => {};
	if (el.raf !== 0) cancelAnimationFrame(el.raf);
	el.raf = 0;
	el.frameTs = 1500;
	el.ensureLayout();
	return el;
}

/** Points the element's draw() at an SVG context. It draws in CSS pixels, since SVG has no backing store. */
function toSvg(el: Inner): { shim: SvgContext; restore(): void } {
	const saved = { ctx: el.ctx, dpr: el.dpr, crop: el.crop, patternFor: el.patternFor };
	const measure = document.createElement('canvas').getContext('2d')!;
	const shim = new SvgContext(measure);
	const tiles = new Map<string, SvgPattern>();
	el.ctx = shim;
	el.dpr = 1;
	el.crop = null;
	el.patternFor = (kind, color): SvgPattern => {
		const key = `${kind}|${color}`;
		let p = tiles.get(key);
		if (p === undefined) tiles.set(key, (p = vectorPattern(kind, color, `t${tiles.size}`)));
		return p;
	};
	return {
		shim,
		restore(): void {
			el.ctx = saved.ctx;
			el.dpr = saved.dpr;
			el.crop = saved.crop;
			el.patternFor = saved.patternFor;
		},
	};
}

function svgElement(w: number, h: number): SVGSVGElement {
	const s = document.createElementNS(SVG_NS, 'svg');
	s.setAttribute('width', String(w));
	s.setAttribute('height', String(h));
	s.style.position = 'absolute';
	s.style.left = '0';
	s.style.top = '0';
	return s;
}

/** One frame of the element's draw() as SVG markup, at its current view. */
function drawSvg(el: Inner, shim: SvgContext): string {
	shim.begin();
	el.draw();
	return shim.markup();
}

// -- Parity: the SVG must be the canvas picture, pixel for pixel, before its timings mean anything. --

const PARITY_NODES: DagNode[] = [
	{ id: 'checkout', label: 'checkout', sublabel: 'actions/checkout', category: 'setup', state: 'done' },
	{ id: 'deps', label: 'install deps', sublabel: 'pnpm install', category: 'setup', state: 'running' },
	{ id: 'unit', label: 'unit tests for absolutely everything in the repository', sublabel: 'node --test', category: 'verify', state: 'failed' },
	{ id: 'e2e', label: 'e2e', sublabel: 'playwright', category: 'verify', state: 'blocked', badge: 'arm64' },
	{ id: 'lint', label: 'lint', category: 'verify', state: 'pending' },
	{ id: 'bundle', label: 'bundle', sublabel: 'esbuild', category: 'build', state: 'pinned' },
	{ id: 'docs', label: 'docs', category: 'build', state: 'missing' },
	{ id: 'img-a', label: 'image amd64', category: 'image', state: 'done', group: 'images' },
	{ id: 'img-b', label: 'image arm64', category: 'image', state: 'unheard-of', group: 'images' },
	{ id: 'w1', label: 'worker 1', category: 'pool', state: 'done', group: 'pool' },
	{ id: 'w2', label: 'worker 2', category: 'pool', state: 'done', group: 'pool' },
	{ id: 'svc-a', label: 'svc a', category: 'svc', state: 'done' },
	{ id: 'svc-b', label: 'svc b', category: 'svc', state: 'running' },
	{ id: 'deploy', label: 'deploy', sublabel: 'prod', category: 'release', state: 'pending' },
];
const PARITY_EDGES: DagEdge[] = [
	{ from: 'checkout', to: 'deps' },
	{ from: 'deps', to: 'unit' },
	{ from: 'deps', to: 'e2e', state: 'pending' },
	{ from: 'deps', to: 'lint' },
	{ from: 'unit', to: 'bundle' },
	{ from: 'lint', to: 'bundle' },
	{ from: 'bundle', to: 'docs' },
	{ from: 'bundle', to: 'img-a' },
	{ from: 'bundle', to: 'img-b' },
	{ from: 'checkout', to: 'w1' },
	{ from: 'w2', to: 'deploy' },
	{ from: 'img-a', to: 'svc-a' },
	{ from: 'svc-a', to: 'svc-b' },
	{ from: 'svc-b', to: 'svc-a' },
	{ from: 'img-b', to: 'deploy' },
	{ from: 'checkout', to: 'deploy' },
];
const PARITY_GROUPS: DagGroup[] = [
	{ id: 'images', label: 'images' },
	{ id: 'pool', label: 'worker pool', collapsed: true },
];

async function rasterize(markup: string, w: number, h: number, px: number, py: number): Promise<ImageData> {
	const doc = `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${markup}</svg>`;
	const url = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml' }));
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		const c = document.createElement('canvas');
		c.width = px;
		c.height = py;
		const g = c.getContext('2d')!;
		g.drawImage(img, 0, 0, px, py);
		return g.getImageData(0, 0, px, py);
	} finally {
		URL.revokeObjectURL(url);
	}
}

interface Parity {
	differPct: number;
	meanDelta: number;
	elements: number;
}

/** Draws one view both ways and compares the pixels. */
async function parity(): Promise<Parity> {
	const PW = 900;
	const PH = 560;
	const host = stage('parity', PW, PH);
	const el = await mount(host, { nodes: PARITY_NODES, edges: PARITY_EDGES, groups: PARITY_GROUPS });
	el.selected = 'deploy';
	el.view = { x: 20, y: 20, scale: 1 };
	el.draw();
	const cw = el.canvas.width;
	const ch = el.canvas.height;
	const a = (el.ctx as CanvasRenderingContext2D).getImageData(0, 0, cw, ch);

	const { shim, restore } = toSvg(el);
	const markup = drawSvg(el, shim);
	restore();
	const b = await rasterize(markup, el.cssW, el.cssH, cw, ch);

	let differ = 0;
	let sum = 0;
	const diff = new ImageData(cw, ch);
	for (let i = 0; i < a.data.length; i += 4) {
		const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
		sum += d;
		if (d > 48) differ++;
		diff.data[i] = d > 48 ? 255 : d * 2;
		diff.data[i + 1] = 0;
		diff.data[i + 2] = 0;
		diff.data[i + 3] = 255;
	}

	// Keep the pictures on the page: canvas, the live SVG beside it, and the difference.
	const panel = document.getElementById('parity')!;
	const shot = document.createElement('canvas');
	shot.width = cw;
	shot.height = ch;
	shot.style.width = `${PW}px`;
	shot.getContext('2d')!.putImageData(a, 0, 0);
	const live = document.createElement('div');
	live.className = 'stage';
	live.style.width = `${PW}px`;
	live.style.height = `${PH}px`;
	const s = svgElement(el.cssW, el.cssH);
	s.innerHTML = markup;
	live.append(s);
	const dv = document.createElement('canvas');
	dv.width = cw;
	dv.height = ch;
	dv.style.width = `${PW}px`;
	dv.getContext('2d')!.putImageData(diff, 0, 0);
	panel.replaceChildren(
		Object.assign(document.createElement('figure'), { innerHTML: '<figcaption>canvas</figcaption>' }),
		Object.assign(document.createElement('figure'), { innerHTML: '<figcaption>SVG, live DOM</figcaption>' }),
		Object.assign(document.createElement('figure'), { innerHTML: '<figcaption>difference (red: over 48/255)</figcaption>' }),
	);
	panel.children[0].append(shot);
	panel.children[1].append(live);
	panel.children[2].append(dv);

	// The first node's text, both ways, at 8x with no smoothing: text is where both can disagree.
	const zoomId = new URLSearchParams(location.search).get('zoom') ?? 'unit';
	const placed = (el as unknown as { layout: { nodes: { x: number; y: number; w: number; h: number; node: DagNode }[] } }).layout.nodes;
	const first = placed.find((p) => p.node.id === zoomId) ?? null;
	if (first !== undefined && first !== null) {
		const r = el.dpr;
		const v = el.view;
		const sx = Math.round((first.x * v.scale + v.x) * r);
		const sy = Math.round((first.y * v.scale + v.y) * r);
		const sw = Math.round(first.w * v.scale * r);
		const sh = Math.round(first.h * v.scale * r);
		const zoom = document.createElement('canvas');
		const Z = 8;
		zoom.width = sw * Z;
		zoom.height = sh * Z;
		const zg = zoom.getContext('2d')!;
		zg.imageSmoothingEnabled = false;
		const src = document.createElement('canvas');
		src.width = cw;
		src.height = ch;
		src.getContext('2d')!.putImageData(a, 0, 0);
		zg.drawImage(src, sx, sy, sw, sh, 0, 0, sw * Z, sh * Z);
		zoom.style.width = `${(sw * Z) / r}px`;
		zoom.style.display = 'block';
		// The live SVG, cropped by its viewBox to the same node and drawn 8x larger: the browser renders the vectors at that size.
		const big = document.createElementNS(SVG_NS, 'svg');
		big.setAttribute('viewBox', `${sx / r} ${sy / r} ${sw / r} ${sh / r}`);
		big.setAttribute('width', String((sw * Z) / r));
		big.setAttribute('height', String((sh * Z) / r));
		big.style.display = 'block';
		big.style.marginTop = '8px';
		big.innerHTML = markup;
		const fig = Object.assign(document.createElement('figure'), {
			innerHTML: '<figcaption>one node magnified 8x, as a browser zoom does: the canvas bitmap above, the live SVG below</figcaption>',
		});
		fig.append(zoom, big);
		panel.append(fig);
	}
	el.remove();
	return { differPct: (differ / (cw * ch)) * 100, meanDelta: sum / (cw * ch), elements: shim.elementCount };
}

interface Row {
	n: number;
	edges: number;
	mode: string;
	zoom: string;
	buildMs: number;
	jsP50: number;
	frameP50: number;
	frameP95: number;
	frameMax: number;
	fps: number;
	elements: number;
}

const rows: Row[] = [];
const out = document.getElementById('out')!;

function report(r: Row): void {
	rows.push(r);
	const f = (v: number): string => v.toFixed(2).padStart(8);
	out.textContent +=
		`${String(r.n).padStart(5)} ${String(r.edges).padStart(5)}  ${r.mode.padEnd(12)} ${r.zoom.padEnd(4)}` +
		`${f(r.buildMs)}${f(r.jsP50)}${f(r.frameP50)}${f(r.frameP95)}${f(r.frameMax)}${r.fps.toFixed(0).padStart(6)}${String(r.elements).padStart(8)}\n`;
}

async function benchSize(n: number): Promise<void> {
	const g = makeGraph(n);
	const host = stage(`n=${n}`);
	const el = await mount(host, g);
	const b = el.bounds;
	const fit = Math.min(W / (b.w + 48), H / (b.h + 48));
	const zooms: [string, number][] = [
		['fit', fit],
		['1:1', 1],
	];

	for (const [zoom, scale] of zooms) {
		const a = performance.now();
		el.view = panAt(0, scale, b.w, b.h);
		el.draw();
		const buildMs = performance.now() - a;
		const r = await runFrames((i) => {
			el.view = panAt(i, scale, b.w, b.h);
			el.draw();
		});
		report({ n, edges: g.edges.length, mode: 'canvas', zoom, buildMs, jsP50: r.js.p50, frameP50: r.frame.p50, frameP95: r.frame.p95, frameMax: r.frame.max, fps: r.frame.fps, elements: 1 });
	}

	// The SVG draws over the element, and the canvas under it is hidden so it costs no paint.
	el.canvas.style.visibility = 'hidden';
	const { shim, restore } = toSvg(el);

	// Immediate: draw() runs every frame, exactly as for the canvas, and the frame's markup replaces the last.
	for (const [zoom, scale] of zooms) {
		const s = svgElement(W, H);
		host.append(s);
		const a = performance.now();
		el.view = panAt(0, scale, b.w, b.h);
		s.innerHTML = drawSvg(el, shim);
		await raf();
		const buildMs = performance.now() - a;
		const r = await runFrames((i) => {
			el.view = panAt(i, scale, b.w, b.h);
			s.innerHTML = drawSvg(el, shim);
		});
		report({ n, edges: g.edges.length, mode: 'svg-rebuild', zoom, buildMs, jsP50: r.js.p50, frameP50: r.frame.p50, frameP95: r.frame.p95, frameMax: r.frame.max, fps: r.frame.fps, elements: shim.elementCount });
		s.remove();
	}

	// Retained: draw() runs once over the whole graph at this scale, so nothing is culled, and a pan only moves one group.
	const margin = 40;
	for (const [zoom, scale] of zooms) {
		const s = svgElement(W, H);
		const root = document.createElementNS(SVG_NS, 'g');
		s.append(root);
		host.append(s);
		const a = performance.now();
		const full = { x: margin - b.x * scale, y: margin - b.y * scale, scale };
		el.view = full;
		el.cssW = Math.ceil(b.w * scale + 2 * margin);
		el.cssH = Math.ceil(b.h * scale + 2 * margin);
		root.innerHTML = drawSvg(el, shim);
		el.cssW = W;
		el.cssH = H;
		const move = (v: { x: number; y: number }): void => root.setAttribute('transform', `translate(${v.x - full.x} ${v.y - full.y})`);
		move(panAt(0, scale, b.w, b.h));
		await raf();
		const buildMs = performance.now() - a;
		const r = await runFrames((i) => move(panAt(i, scale, b.w, b.h)));
		report({ n, edges: g.edges.length, mode: 'svg-pan', zoom, buildMs, jsP50: r.js.p50, frameP50: r.frame.p50, frameP95: r.frame.p95, frameMax: r.frame.max, fps: r.frame.fps, elements: shim.elementCount });
		s.remove();
	}
	restore();
	el.remove();
}

async function main(): Promise<void> {
	const gl = document.createElement('canvas').getContext('webgl');
	const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
	const renderer = gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
	out.textContent = `GPU: ${renderer}\nUA: ${navigator.userAgent}\ndevicePixelRatio: ${devicePixelRatio}, frames per case: ${FRAMES}\n\n`;
	const p = await parity();
	out.textContent += `parity: ${p.differPct.toFixed(3)}% of pixels differ by over 48/255, mean channel delta ${p.meanDelta.toFixed(2)}, ${p.elements} SVG elements\n\n`;
	out.textContent += `    n edges  mode         zoom   build   js-p50 frm-p50 frm-p95 frm-max    fps  elems\n`;
	for (const n of SIZES) await benchSize(n);
	document.getElementById('stages')!.replaceChildren();
	(window as unknown as { __results: unknown }).__results = { renderer, dpr: devicePixelRatio, parity: p, rows };
	document.getElementById('copy')!.hidden = false;
}

document.getElementById('copy')!.addEventListener('click', () => {
	navigator.clipboard.writeText(out.textContent ?? '').catch(() => {
		// The clipboard can refuse the write. Select the text so a manual copy works.
		getSelection()?.selectAllChildren(out);
	});
});
document.getElementById('run')!.addEventListener('click', () => {
	(document.getElementById('run') as HTMLButtonElement).disabled = true;
	void main();
});
if (new URLSearchParams(location.search).has('auto')) document.getElementById('run')!.click();
