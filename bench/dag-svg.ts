// Measures the cost of a <dag-view> frame drawn on its canvas against the
// same scene as SVG DOM.

import '../src/ui/dag-view.ts';
import PAGE_CSS from './dag-svg.css';
import type { DagViewElement, DagNode, DagEdge, DagStyleMap } from '../src/ui/dag-view.ts';

// The HTML target turns a <link> stylesheet into JS text, so the page adopts its CSS from here.
document.head.append(Object.assign(document.createElement('style'), { textContent: PAGE_CSS }));

const W = 1200;
const H = 700;
const SIZES = (new URLSearchParams(location.search).get('n') ?? '200,1000,3000').split(',').map(Number);
const FRAMES = Number(new URLSearchParams(location.search).get('frames') ?? 180);

const STYLES: DagStyleMap = {
	done: {},
	running: { active: true },
	failed: { emphasis: true },
	pending: { pattern: 'outline', dashed: true },
	queued: { pattern: 'hatch' },
};
const STATES = Object.keys(STYLES);

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
	Pick<DagViewElement, 'nodes' | 'edges' | 'styles'> & {
		view: { x: number; y: number; scale: number };
		draw(): void;
		bounds: { x: number; y: number; w: number; h: number };
		download(blob: Blob, ext: string): void;
		downloadSvg(): void;
		ensureLayout(): void;
	};

function stage(label: string): HTMLDivElement {
	const box = document.createElement('div');
	box.className = 'stage';
	box.style.width = `${W}px`;
	box.style.height = `${H}px`;
	box.dataset.label = label;
	document.getElementById('stages')!.replaceChildren(box);
	return box;
}

async function svgText(el: Inner): Promise<string> {
	let out = '';
	el.download = (blob: Blob): void => {
		void blob.text().then((t) => (out = t));
	};
	el.downloadSvg();
	while (out === '') await raf();
	return out;
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
		`${String(r.n).padStart(5)} ${String(r.edges).padStart(5)}  ${r.mode.padEnd(10)} ${r.zoom.padEnd(4)}` +
		`${f(r.buildMs)}${f(r.jsP50)}${f(r.frameP50)}${f(r.frameP95)}${f(r.frameMax)}${r.fps.toFixed(0).padStart(6)}${String(r.elements).padStart(8)}\n`;
}

async function benchSize(n: number): Promise<void> {
	const g = makeGraph(n);
	const host = stage(`canvas n=${n}`);
	const el = document.createElement('dag-view') as unknown as Inner;
	el.style.width = '100%';
	el.style.height = '100%';
	el.styles = STYLES;
	el.nodes = g.nodes;
	el.edges = g.edges;
	host.append(el);
	await raf();
	el.ensureLayout();
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

	const svg = await svgText(el);
	el.remove();

	// The export draws the whole graph at world scale with a pad; the pad goes back out of the pan.
	const pad = 24;
	for (const variant of ['svg-attr', 'svg-layer'] as const) {
		for (const [zoom, scale] of zooms) {
			const box = stage(`${variant} n=${n}`);
			const a = performance.now();
			const doc = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
			const svgEl = document.importNode(doc, true);
			const inner = document.createElementNS('http://www.w3.org/2000/svg', 'g');
			inner.append(...Array.from(svgEl.childNodes));
			svgEl.append(inner);
			let move: (v: { x: number; y: number; scale: number }) => void;
			if (variant === 'svg-attr') {
				// The transform lives on the root group: every frame re-paints the vector scene at its true scale.
				svgEl.setAttribute('width', String(W));
				svgEl.setAttribute('height', String(H));
				svgEl.removeAttribute('viewBox');
				box.append(svgEl);
				move = (v) => inner.setAttribute('transform', `matrix(${v.scale} 0 0 ${v.scale} ${v.x - pad * v.scale} ${v.y - pad * v.scale})`);
			} else {
				// The whole drawing is one composited layer; a pan moves the layer and paints nothing.
				svgEl.style.position = 'absolute';
				svgEl.style.left = '0';
				svgEl.style.top = '0';
				svgEl.style.transformOrigin = '0 0';
				svgEl.style.willChange = 'transform';
				box.append(svgEl);
				move = (v) => (svgEl.style.transform = `translate(${v.x - pad * v.scale}px, ${v.y - pad * v.scale}px) scale(${v.scale})`);
			}
			move(panAt(0, scale, b.w, b.h));
			await raf();
			await raf();
			const buildMs = performance.now() - a;
			const r = await runFrames((i) => move(panAt(i, scale, b.w, b.h)));
			report({ n, edges: g.edges.length, mode: variant, zoom, buildMs, jsP50: r.js.p50, frameP50: r.frame.p50, frameP95: r.frame.p95, frameMax: r.frame.max, fps: r.frame.fps, elements: svgEl.getElementsByTagName('*').length });
		}
	}
}

async function main(): Promise<void> {
	const gl = document.createElement('canvas').getContext('webgl');
	const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
	const renderer = gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
	out.textContent = `GPU: ${renderer}\nUA: ${navigator.userAgent}\ndevicePixelRatio: ${devicePixelRatio}, frames per case: ${FRAMES}\n\n`;
	out.textContent += `    n edges  mode       zoom   build   js-p50 frm-p50 frm-p95 frm-max    fps  elems\n`;
	for (const n of SIZES) await benchSize(n);
	document.getElementById('stages')!.replaceChildren();
	(window as unknown as { __results: unknown }).__results = { renderer, dpr: devicePixelRatio, rows };
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
