// Browser check for <dag-view> on the REAL element.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import type { DagViewElement } from '../src/ui/dag-view.ts';

// The slice of playwright this file drives.
interface ElementHandle {
	screenshot(options: { path: string }): Promise<unknown>;
}
interface ConsoleMessage {
	type(): string;
	text(): string;
}
interface Page {
	on(event: 'console', fn: (m: ConsoleMessage) => void): void;
	on(event: 'pageerror', fn: (e: unknown) => void): void;
	goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
	waitForTimeout(ms: number): Promise<void>;
	evaluate<T>(fn: () => T): Promise<Awaited<T>>;
	evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<Awaited<T>>;
	emulateMedia(options: { reducedMotion: 'reduce' | 'no-preference' }): Promise<void>;
	$(selector: string): Promise<ElementHandle | null>;
	mouse: {
		move(x: number, y: number): Promise<void>;
		click(x: number, y: number, options?: { button?: 'left' | 'right' | 'middle' }): Promise<void>;
		wheel(dx: number, dy: number): Promise<void>;
	};
	keyboard: { press(key: string): Promise<void>; down(key: string): Promise<void>; up(key: string): Promise<void> };
}
interface Browser {
	newPage(options: {
		viewport: { width: number; height: number };
		deviceScaleFactor: number;
	}): Promise<Page>;
	close(): Promise<void>;
}

// Node's ESM resolver ignores NODE_PATH, and playwright comes from the global
// install, so it is pulled through CJS resolution, which honours it.
const { chromium } = createRequire(import.meta.url)('playwright') as {
	chromium: { launch(options: { args?: string[] }): Promise<Browser> };
};

// Flags are stripped so the positional path stays positional.
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const file = args[0] ?? 'showcase/dist/index.html';
const shots = !process.argv.includes('--no-shots');
const outDir = process.env.DAG_SHOT_DIR ?? dirname(resolve(file));

const failures: string[] = [];
let checks = 0;

function check(name: string, ok: boolean, detail?: string): void {
	checks++;
	if (ok) {
		console.log(`  ok  ${name}`);
		return;
	}
	console.log(`FAIL  ${name}${detail === undefined ? '' : ` -- ${detail}`}`);
	failures.push(name);
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
const pageErrors: string[] = [];
page.on('console', (m) => {
	if (m.type() === 'error') pageErrors.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(String(e)));

// The gallery draws only the section its hash names.
await page.goto(`${pathToFileURL(resolve(file)).href}#dag-view`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

// -- Upgrade A demo whose import got elided sits on its light-DOM
// "loading..." line with the build green throughout, which is the exact
// failure the gallery exists to catch.

const upgrade = await page.evaluate(() => {
	const out: { id: string; upgraded: boolean; hasCanvas: boolean; w: number; h: number }[] = [];
	for (const el of document.querySelectorAll('dag-view')) {
		const canvas = el.shadowRoot?.querySelector('canvas');
		out.push({
			id: el.id,
			upgraded: el.constructor.name !== 'HTMLElement' && el.shadowRoot !== null,
			hasCanvas: canvas !== null && canvas !== undefined,
			w: canvas?.width ?? 0,
			h: canvas?.height ?? 0,
		});
	}
	return out;
});

check('found every gallery instance', upgrade.length === 8, `saw ${upgrade.length}`);
for (const u of upgrade) {
	check(`#${u.id} upgraded with a sized canvas`, u.upgraded && u.hasCanvas && u.w > 0 && u.h > 0, JSON.stringify(u));
}

// -- The canvas painted ------------------------------------------------- A
// component can upgrade, size its canvas and still draw nothing. The only
// proof is pixels that are not the background.

const painted = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const canvas = el.shadowRoot!.querySelector('canvas')!;
	const ctx = canvas.getContext('2d')!;
	const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
	const first = [d[0], d[1], d[2]];
	let different = 0;
	for (let i = 0; i < d.length; i += 4) {
		if (d[i] !== first[0] || d[i + 1] !== first[1] || d[i + 2] !== first[2]) different++;
	}
	return { total: d.length / 4, different };
});
check(
	'the graph canvas is not a flat fill',
	painted.different > painted.total * 0.01,
	`${painted.different}/${painted.total} pixels differ from the corner`,
);

// -- What the layout could not honour is REPORTED ---------------------------------

const info = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const notice = el.shadowRoot!.querySelector<HTMLElement>('.notice')!;
	return { info: el.info, noticeHidden: notice.hidden, noticeText: notice.textContent ?? '' };
});
check('every node is placed', info.info.nodeCount === 13, `nodeCount ${info.info.nodeCount}`);
check(
	'the two unusable edges are reported, not dropped in silence',
	info.info.rejected.length === 2,
	JSON.stringify(info.info.rejected),
);
check('the build graph has no cycle', info.info.cycles.length === 0);
check('the notice strip states the finding', !info.noticeHidden && /not drawn/.test(info.noticeText), info.noticeText);

const cycleInfo = await page.evaluate(() => {
	const el = document.getElementById('demo-dag-cycle') as DagViewElement;
	const notice = el.shadowRoot!.querySelector<HTMLElement>('.notice')!;
	return { info: el.info, noticeText: notice.textContent ?? '', noticeHidden: notice.hidden };
});
check('the cycle is found and named', cycleInfo.info.cycles.length === 1, JSON.stringify(cycleInfo.info.cycles));
check(
	'the cycle edge is still DRAWN, not deleted',
	cycleInfo.info.edgeCount === 4,
	`edgeCount ${cycleInfo.info.edgeCount}`,
);
check(
	'the notice announces the circular dependency',
	!cycleInfo.noticeHidden && /circular/.test(cycleInfo.noticeText),
	cycleInfo.noticeText,
);

// -- Orientation ------------------------------------------------------------------

const orient = await page.evaluate(() => {
	const tb = document.getElementById('demo-dag') as DagViewElement;
	const lr = document.getElementById('demo-dag-lr') as DagViewElement;
	return { tb: tb.info, lrOrientation: lr.orientation, lrNodes: lr.info.nodeCount };
});
check('the LR instance reports its orientation', orient.lrOrientation === 'LR', orient.lrOrientation);
check('the LR instance lays out the same graph', orient.lrNodes === orient.tb.nodeCount);

// -- Interaction: selection ---------------------------------------------------------

// The section sits well down a scrolling page.
await page.evaluate(() => document.getElementById('demo-dag')!.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(300);

// focusNode centers the node in the element, so its screen position is the
// element's center -- no reliance on private layout state.
const nodeScreenPoint = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	el.focusNode('bundle');
	el.selected = null;
	const r = el.getBoundingClientRect();
	return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.waitForTimeout(200);
check(
	'focusNode leaves nothing selected once cleared',
	(await page.evaluate(() => (document.getElementById('demo-dag') as DagViewElement).selected)) === null,
);

await page.mouse.move(nodeScreenPoint.x, nodeScreenPoint.y);
await page.waitForTimeout(150);

const hovered = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const tip = el.shadowRoot!.querySelector<HTMLElement>('.tooltip')!;
	return { visible: tip.classList.contains('visible'), text: tip.textContent ?? '' };
});
check('hovering a node shows its tooltip', hovered.visible, JSON.stringify(hovered));
check('the tooltip names the node', /bundle/.test(hovered.text), hovered.text);

await page.mouse.click(nodeScreenPoint.x, nodeScreenPoint.y);
await page.waitForTimeout(150);

const selected = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	return { selected: el.selected, readout: document.getElementById('demo-dag-click')!.textContent ?? '' };
});
check('clicking a node selects it', selected.selected === 'bundle', String(selected.selected));
check('the nodeclick event reaches the page', /bundle/.test(selected.readout), selected.readout);

// -- Interaction: right-click copies the drawn state ----------------------------------

// Driven as the real gesture rather than by calling the getter. This is
// because what has to hold is that a reader looking at a wrong picture can
// hand somebody the numbers. A getter nothing is wired to does not do that.
await page.evaluate(() => {
	const el = document.getElementById('demo-dag')!;
	el.addEventListener('snapshotcopy', (e) => {
		(window as unknown as { __snap?: string }).__snap = (e as CustomEvent<{ text: string }>).detail.text;
	});
});
await page.mouse.click(nodeScreenPoint.x, nodeScreenPoint.y, { button: 'right' });
await page.waitForTimeout(150);

// The right-click opens a MENU. Copying on the click itself was invisible:
// the browser's own menu is suppressed. A reader who saw nothing open read a
// working feature as a dead click.
const menu = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const m = el.shadowRoot!.querySelector<HTMLElement>('.menu')!;
	return {
		hidden: m.hidden,
		items: [...m.querySelectorAll('.menu-item')].map((b) => b.textContent ?? ''),
	};
});
check('the right-click opens a menu', !menu.hidden, JSON.stringify(menu));
check(
	'the menu offers the graph state and the node under the cursor',
	menu.items.some((t) => /Copy graph state/.test(t)) && menu.items.some((t) => /^Copy id of/.test(t)),
	menu.items.join(' | '),
);

// The component's pill rule used to be a bare `button` selector, which took
// every menu item out of flow. It drew all of them at one spot. Reading the
// text back cannot see that -- only the boxes can.
const rows = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	return [...el.shadowRoot!.querySelectorAll('.menu-item')].map((b) => {
		const r = b.getBoundingClientRect();
		return { top: Math.round(r.top), h: Math.round(r.height) };
	});
});
check(
	'the menu items are stacked, not piled on one spot',
	rows.length > 1 && rows.every((r, i) => i === 0 || r.top >= rows[i - 1].top + rows[i - 1].h),
	JSON.stringify(rows),
);

// Nothing is copied until an item is chosen.
const beforeChoice = await page.evaluate(() => (window as unknown as { __snap?: string }).__snap ?? '');
check('the menu copies nothing on its own', beforeChoice === '', `${beforeChoice.length} bytes`);

await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const items = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.menu-item')];
	items.find((b) => /Copy graph state/.test(b.textContent ?? ''))?.click();
});
await page.waitForTimeout(150);

check(
	'choosing an item closes the menu',
	await page.evaluate(() => {
		const el = document.getElementById('demo-dag') as DagViewElement;
		return el.shadowRoot!.querySelector<HTMLElement>('.menu')!.hidden;
	}),
);

const dump = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const toast = el.shadowRoot!.querySelector<HTMLElement>('.toast')!;
	const text = (window as unknown as { __snap?: string }).__snap ?? '';
	return { text, toast: toast.textContent ?? '', hidden: toast.hidden };
});
check('the right-click says what it did', !dump.hidden && /Copied graph state/.test(dump.toast), dump.toast);

let snap: {
	canvas: { width: number; height: number };
	viewport: { scale: number };
	nodes: { id: string; screen: { x: number; y: number; w: number; h: number }; visible: boolean }[];
	edges: { screen: { x: number; y: number }[] }[];
} | null = null;
try {
	snap = JSON.parse(dump.text);
} catch {
	snap = null;
}
check('the clipboard holds parseable JSON', snap !== null, `${dump.text.length} bytes`);
check(
	'the dump is indented with tabs',
	/\n\t"/.test(dump.text) && !/\n {2}"/.test(dump.text),
	dump.text.split('\n')[1] ?? '',
);

if (snap !== null) {
	check('every drawn node is in the dump', snap.nodes.length === info.info.nodeCount, `${snap.nodes.length}`);
	check('every drawn edge is in the dump', snap.edges.length > 0, `${snap.edges.length}`);
	// The whole point of the screen half: these are canvas pixels.
	const bundle = snap.nodes.find((n) => n.id === 'bundle');
	const onCanvas =
		bundle !== undefined &&
		bundle.visible &&
		bundle.screen.w > 0 &&
		bundle.screen.x >= 0 &&
		bundle.screen.x < snap.canvas.width;
	check('a visible node carries its canvas pixels', onCanvas, JSON.stringify(bundle));
	check('edge points carry canvas pixels too', snap.edges.every((e) => e.screen.length >= 2));
}

// -- Interaction: the arrow keys walk the graph ---------------------------------------

await page.mouse.click(nodeScreenPoint.x, nodeScreenPoint.y);
await page.waitForTimeout(120);

await page.keyboard.press('ArrowDown');
await page.waitForTimeout(120);
const walked = await page.evaluate(() => (document.getElementById('demo-dag') as DagViewElement).selected);
check(
	'ArrowDown walks to a dependent of the selected node',
	walked !== 'bundle' && ['e2e', 'docs', 'sign'].includes(walked ?? ''),
	String(walked),
);

await page.keyboard.press('ArrowUp');
await page.waitForTimeout(120);
const walkedBack = await page.evaluate(() => (document.getElementById('demo-dag') as DagViewElement).selected);
check('ArrowUp walks back toward a dependency', walkedBack !== walked, `${walked} -> ${walkedBack}`);

await page.keyboard.press('Escape');
await page.waitForTimeout(120);
check(
	'Escape clears the selection',
	(await page.evaluate(() => (document.getElementById('demo-dag') as DagViewElement).selected)) === null,
);

// -- Interaction: the toolbar moves the viewport ----------------------------------------

const zoomed = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	el.fit();
	const before = el.viewport.scale;
	el.shadowRoot!.querySelector<HTMLButtonElement>('.zoom-in-btn')!.click();
	const after = el.viewport.scale;
	el.shadowRoot!.querySelector<HTMLButtonElement>('.zoom-out-btn')!.click();
	const back = el.viewport.scale;
	return { before, after, back };
});
check('the zoom-in button zooms in', zoomed.after > zoomed.before, JSON.stringify(zoomed));
check('the zoom-out button undoes it', Math.abs(zoomed.back - zoomed.before) < 1e-6, JSON.stringify(zoomed));

const fitted = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	el.viewport = { x: 9999, y: 9999, scale: 3 };
	el.shadowRoot!.querySelector<HTMLButtonElement>('.fit-btn')!.click();
	return el.viewport;
});
check('the fit button brings the graph back on screen', Math.abs(fitted.x) < 5000 && fitted.scale < 3, JSON.stringify(fitted));

// -- Search highlights rather than filters -----------------------------------------------

const searched = await page.evaluate(async () => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const input = el.shadowRoot!.querySelector<HTMLInputElement>('.search')!;
	input.value = 'sign';
	input.dispatchEvent(new Event('input'));
	await new Promise((r) => requestAnimationFrame(r));
	return { nodeCount: el.info.nodeCount, edgeCount: el.info.edgeCount };
});
check(
	'searching hides no nodes and no edges -- it highlights',
	searched.nodeCount === 13 && searched.edgeCount === info.info.edgeCount,
	JSON.stringify(searched),
);

// -- The empty instance says. ----------------------------------------------------------

const empty = await page.evaluate(() => {
	const el = document.getElementById('demo-dag-empty') as DagViewElement;
	const hint = el.shadowRoot!.querySelector<HTMLElement>('.empty-hint')!;
	return { hidden: hint.hidden, text: hint.textContent ?? '', nodes: el.info.nodeCount };
});
check('an empty graph shows its empty state', !empty.hidden && empty.nodes === 0, JSON.stringify(empty));
check("the empty text is the consumer's", /No dependencies recorded/.test(empty.text), empty.text);

// -- A blocked node says WHY -------------------------------------------------------------
// The e2e node carries a multi-line `detail` and an `href`. The tooltip, the selected-node panel and the canvas box
// must each carry it readably. A reason that only lives in the payload is the board that said "zero detail".

const e2ePoint = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const input = el.shadowRoot!.querySelector<HTMLInputElement>('.search')!;
	input.value = '';
	input.dispatchEvent(new Event('input'));
	el.scrollIntoView({ block: 'center' });
	el.focusNode('e2e', 1);
	el.selected = null;
	const r = el.getBoundingClientRect();
	return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(2, 2);
await page.waitForTimeout(150);
await page.mouse.move(e2ePoint.x, e2ePoint.y);
await page.waitForTimeout(150);
const e2eTip = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const tip = el.shadowRoot!.querySelector<HTMLElement>('.tooltip')!;
	return { visible: tip.classList.contains('visible'), text: tip.textContent ?? '' };
});
check('hovering the blocked node shows its tooltip', e2eTip.visible, JSON.stringify(e2eTip));
check(
	'the tooltip carries the whole reason, every line',
	/Blocked: the browser image/.test(e2eTip.text) && /Retry: when the runner image/.test(e2eTip.text) && /Note: the fix belongs/.test(e2eTip.text),
	e2eTip.text,
);

await page.mouse.click(e2ePoint.x, e2ePoint.y);
await page.waitForTimeout(150);
const panel = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const d = el.shadowRoot!.querySelector<HTMLElement>('.detail')!;
	const body = d.querySelector<HTMLElement>('.dt-body');
	const link = d.querySelector<HTMLAnchorElement>('.dt-link');
	const state = d.querySelector<HTMLElement>('.dt-state');
	return {
		hidden: d.hidden,
		body: body?.textContent ?? '',
		lines: body === null ? 0 : Math.round(body.getBoundingClientRect().height / parseFloat(getComputedStyle(body).lineHeight)),
		href: link?.getAttribute('href') ?? null,
		target: link?.target ?? '',
		state: state?.textContent ?? '',
	};
});
check('selecting the node opens the detail panel', !panel.hidden, JSON.stringify(panel));
check('the panel shows the full reason as multi-line text', /Retry:/.test(panel.body) && panel.lines >= 3, JSON.stringify(panel));
check('the panel names the state as a badge', panel.state === 'blocked', panel.state);
check('the panel links the node href in a new tab', panel.href === '#dag-view' && panel.target === '_blank', JSON.stringify(panel));

// A refresh with the same node keeps it selected: a polling dashboard must not close the panel a reader is reading.
const kept = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	el.setData({ nodes: el.nodes, edges: el.edges });
	el.info;
	return { selected: el.selected, hidden: el.shadowRoot!.querySelector<HTMLElement>('.detail')!.hidden };
});
check('a data refresh keeps the selection and its panel', kept.selected === 'e2e' && !kept.hidden, JSON.stringify(kept));

if (shots) {
	await page.mouse.move(2, 2);
	await page.waitForTimeout(250);
	const el = await page.$('#demo-dag');
	if (el !== null) {
		const out = join(outDir, 'dag-view-detail.png');
		await el.screenshot({ path: out });
		console.log(`  shot ${out}`);
	}
}

await page.keyboard.press('Escape');
await page.waitForTimeout(120);
check(
	'clearing the selection hides the panel',
	await page.evaluate(() => (document.getElementById('demo-dag') as DagViewElement).shadowRoot!.querySelector<HTMLElement>('.detail')!.hidden),
);

// -- Dashboard scale ---------------------------------------------------------------------
// The shape a real consumer hands this: every repository in an org is a node.
// A manifest sweep that read nothing leaves almost all of them edgeless. The
// gallery's graphs are small enough that nothing here can go wrong in them,
// which is why this case is built rather than looked up.
//
// It went wrong twice, and both failures look identical on screen -- a dark
// box with a couple of stray lines. Its own comment names that state: "shows
// a reader nothing but coloured boxes and reads as broken".

const scaled = await page.evaluate(async () => {
	const host = document.createElement('div');
	host.style.cssText = 'width:1200px;height:800px;position:fixed;left:-4000px;top:0';
	const el = document.createElement('dag-view') as DagViewElement;
	el.style.cssText = 'display:block;width:100%;height:100%';
	host.appendChild(el);
	document.body.appendChild(host);

	const ids: string[] = [];
	for (let i = 0; i < 118; i++) ids.push(`owner/repo-${String(i).padStart(3, '0')}`);
	el.setData({
		nodes: ids.map((id) => ({ id, label: id.split('/')[1], sublabel: id.split('/')[0] })),
		edges: [
			{ from: ids[3], to: ids[7] },
			{ from: ids[7], to: ids[11] },
			{ from: ids[20], to: ids[21] },
		],
	});
	await new Promise((r) => requestAnimationFrame(r));
	await new Promise((r) => setTimeout(r, 300));
	const snap = el.snapshot;
	host.remove();
	return {
		layerCount: snap.info.layerCount,
		scale: snap.viewport.scale,
		bounds: snap.bounds,
		offScreen: snap.nodes.filter((n) => !n.visible).length,
	};
});
check(
	'an edgeless node does not become a layer of its own',
	scaled.layerCount === 3,
	`layerCount ${scaled.layerCount} over a longest chain of 3`,
);
check(
	'the fitted view stays above the label LOD, so the nodes read as nodes',
	scaled.scale >= 0.4,
	`fit scale ${scaled.scale.toFixed(3)}, under LOD_LABEL_SCALE 0.4`,
);
check(
	'the drawn block is not far wider than the canvas it has to fit',
	scaled.bounds.w / scaled.bounds.h < 2,
	`bounds ${scaled.bounds.w}x${scaled.bounds.h}`,
);
check('nothing is parked off screen after the fit', scaled.offScreen === 0, `${scaled.offScreen} off screen`);

// -- Active nodes The sheen is the thing that moves without input.

interface Region {
	id: string;
	sums: number[];
}

/** Fingerprints the interior of each named box in #demo-dag-active, once per sample, a sample every `gap` ms. */
async function sampleBoxes(ids: string[], samples: number, gap: number): Promise<Region[]> {
	return page.evaluate(
		async (arg: { ids: string[]; samples: number; gap: number }) => {
			const el = document.getElementById('demo-dag-active') as DagViewElement;
			const canvas = el.shadowRoot!.querySelector('canvas')!;
			const ctx = canvas.getContext('2d')!;
			const out = arg.ids.map((id) => ({ id, sums: [] as number[] }));
			for (let step = 0; step < arg.samples; step++) {
				const snap = el.snapshot;
				const dpr = snap.canvas.dpr;
				for (const region of out) {
					const node = snap.nodes.find((n) => n.id === region.id)!;
					const inset = 3;
					const x = Math.round((node.screen.x + inset) * dpr);
					const y = Math.round((node.screen.y + inset) * dpr);
					const w = Math.max(1, Math.round((node.screen.w - 2 * inset) * dpr));
					const h = Math.max(1, Math.round((node.screen.h - 2 * inset) * dpr));
					const data = ctx.getImageData(x, y, w, h).data;
					let sum = 0;
					for (let idx = 0; idx < data.length; idx += 4) sum += data[idx] + data[idx + 1] * 3 + data[idx + 2] * 7;
					region.sums.push(sum);
				}
				await new Promise((r) => setTimeout(r, arg.gap));
			}
			return out;
		},
		{ ids, samples, gap },
	);
}

const changes = (r: Region): number => r.sums.filter((v, idx) => idx > 0 && v !== r.sums[idx - 1]).length;

await page.mouse.move(2, 2);
const activeState = await page.evaluate(() => {
	const el = document.getElementById('demo-dag-active') as DagViewElement;
	el.scrollIntoView({ block: 'center' });
	const snap = el.snapshot;
	return {
		animating: el.animating,
		active: snap.nodes.filter((n) => n.active).map((n) => n.id).sort(),
		canvas: snap.canvas,
		// Wholly inside the canvas, not merely overlapping it: a box half off the edge samples pixels that are not there.
		inside: snap.nodes.every(
			(n) =>
				n.screen.x >= 0 &&
				n.screen.y >= 0 &&
				n.screen.x + n.screen.w <= snap.canvas.width &&
				n.screen.y + n.screen.h <= snap.canvas.height &&
				n.screen.w >= 40,
		),
	};
});
await page.waitForTimeout(300);
check(
	'the style entries and the node field mark exactly the running nodes active',
	JSON.stringify(activeState.active) === JSON.stringify(['pr-12', 'pr-19', 'pr-33', 'pr-41']),
	JSON.stringify(activeState.active),
);
check(
	'the active board is laid out at a readable size',
	activeState.canvas.width >= 400 && activeState.canvas.height >= 200,
	JSON.stringify(activeState.canvas),
);
check('every active-board node lies wholly inside the canvas', activeState.inside);
check('the loop runs while an active node is in view', activeState.animating);

// Samples over periods: a box rests for part of each period, so one pair of frames proves nothing.
const sweep = await sampleBoxes(['pr-12', 'pr-19', 'pr-41', 'pr-27', 'pr-45'], 10, 320);
for (const id of ['pr-12', 'pr-19', 'pr-41']) {
	const r = sweep.find((x) => x.id === id)!;
	check(`active ${id}: its pixels change between frames`, changes(r) >= 2, `sums ${r.sums.join(',')}`);
}
for (const id of ['pr-27', 'pr-45']) {
	const r = sweep.find((x) => x.id === id)!;
	check(
		`idle ${id}: its pixels do not change between frames`,
		changes(r) === 0 && r.sums[0] > 0,
		`sums ${r.sums.join(',')}`,
	);
}

await page.emulateMedia({ reducedMotion: 'reduce' });
await page.waitForTimeout(200);
const pulse = await sampleBoxes(['pr-12', 'pr-45'], 10, 320);
check('reduced motion: an active box still changes, as a pulse', changes(pulse[0]) >= 2, `sums ${pulse[0].sums.join(',')}`);
check('reduced motion: an idle box stays still', changes(pulse[1]) === 0, `sums ${pulse[1].sums.join(',')}`);
await page.emulateMedia({ reducedMotion: 'no-preference' });

// -- Node links on the detail card ----------------------------------------------------

const card = await page.evaluate(async () => {
	const el = document.getElementById('demo-dag-active') as DagViewElement;
	el.selected = 'pr-12';
	await new Promise((r) => setTimeout(r, 100));
	const panel = el.shadowRoot!.querySelector<HTMLElement>('.detail')!;
	const links = [...panel.querySelectorAll<HTMLAnchorElement>('.dt-links a')].map((a) => ({
		text: a.textContent ?? '',
		href: a.getAttribute('href') ?? '',
		target: a.target,
		rel: a.rel,
	}));
	const snapLinks = el.snapshot.nodes.find((n) => n.id === 'pr-12')!.links;
	const shown = !panel.hidden;
	const open = panel.querySelector('.dt-link') !== null;
	el.selected = null;
	return { shown, links, snapLinks, open };
});
check('selecting a node with links opens the card', card.shown);
check('the card keeps the href open link beside the named links', card.open);
check(
	'the card lists every safe link, in order, pointing where the node says',
	JSON.stringify(card.links.map((l) => l.href)) ===
		JSON.stringify([
			'https://github.com/wow-look-at-my/go-s3-server/pull/12',
			'#run=demo-run-12',
			'https://github.com/wow-look-at-my/webhooks/pull/27',
		]),
	JSON.stringify(card.links),
);
check(
	'an external link opens a new tab with rel=noopener',
	card.links
		.filter((l) => l.href.startsWith('https://'))
		.every((l) => l.target === '_blank' && /\bnoopener\b/.test(l.rel)),
	JSON.stringify(card.links),
);
check(
	'a relative link stays in this tab',
	card.links.filter((l) => l.href.startsWith('#')).every((l) => l.target === ''),
	JSON.stringify(card.links),
);
check('the label is the link text', card.links[1]?.text === 'worker run', JSON.stringify(card.links));
check('the unsafe link never renders', !card.links.some((l) => l.href.startsWith('javascript')));
check('the snapshot reports the same links', card.snapLinks.length === 3, JSON.stringify(card.snapLinks));

// -- Groups A collapsed group is ONE node, a click expands it in place, a
// header click collapses it again, and the edges follow it each. Way.

interface GroupState {
	nodes: string[];
	edges: string[];
	collapsed: boolean | null;
	scale: number;
	stand: { x: number; y: number } | null;
	header: { x: number; y: number } | null;
}

async function groupState(id: string): Promise<GroupState> {
	return page.evaluate((target: string) => {
		const el = document.getElementById(target) as DagViewElement;
		el.scrollIntoView({ block: 'center' });
		const snap = el.snapshot;
		const rect = el.getBoundingClientRect();
		const g = snap.groups[0];
		const stand = snap.nodes.find((n) => n.id === 'group:pending');
		const header =
			g !== undefined && !g.collapsed
				? {
						x: rect.left + snap.viewport.x + (g.world.x + 20) * snap.viewport.scale,
						y: rect.top + snap.viewport.y + (g.world.y + 8) * snap.viewport.scale,
					}
				: null;
		return {
			nodes: snap.nodes.map((n) => n.id),
			edges: snap.edges.map((e) => `${e.from}>${e.to}`),
			collapsed: g === undefined ? null : g.collapsed,
			scale: snap.viewport.scale,
			stand: stand === undefined ? null : { x: rect.left + stand.screen.x + stand.screen.w / 2, y: rect.top + stand.screen.y + stand.screen.h / 2 },
			header,
		};
	}, id);
}

const closed = await groupState('demo-dag-group-closed');
check('a collapsed group of twelve draws as ONE node', closed.nodes.length === 3 && closed.collapsed === true, JSON.stringify(closed.nodes));
check(
	'edges into and out of members reroute to the group node, once per pair',
	JSON.stringify(closed.edges.slice().sort()) === JSON.stringify(['base-fix>pending-2', 'pending-4>release']),
	JSON.stringify(closed.edges),
);
await page.mouse.click(closed.stand!.x, closed.stand!.y);
await page.waitForTimeout(250);
const opened = await groupState('demo-dag-group-closed');
check('a click on the group node expands it to its twelve members', opened.nodes.length === 14 && opened.collapsed === false, JSON.stringify(opened.nodes));
check(
	'expanded, every edge reaches the member it names',
	JSON.stringify(opened.edges.slice().sort()) ===
		JSON.stringify(['base-fix>pending-2', 'base-fix>pending-7', 'pending-2>pending-3', 'pending-4>release']),
	JSON.stringify(opened.edges),
);
check('expanding keeps the zoom', opened.scale === closed.scale, `${closed.scale} -> ${opened.scale}`);
await page.mouse.click(opened.header!.x, opened.header!.y);
await page.waitForTimeout(250);
const again = await groupState('demo-dag-group-closed');
check('a click on the header collapses it again', again.nodes.length === 3 && again.collapsed === true, JSON.stringify(again.nodes));
const viaKey = await page.evaluate(async () => {
	const el = document.getElementById('demo-dag-group-closed') as DagViewElement;
	el.selected = 'group:pending';
	el.focus();
	el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	await new Promise((r) => setTimeout(r, 100));
	const n = el.snapshot.nodes.length;
	el.setGroupCollapsed('pending', true);
	return n;
});
check('Enter on the selected group node expands it', viaKey === 14, `${viaKey} nodes`);
const openInstance = await groupState('demo-dag-group-open');
check('a group can start expanded', openInstance.nodes.length === 14 && openInstance.collapsed === false);

// -- Wheel ----------------------------------------------------------------------------
// A plain mouse wheel belongs to the page. Ctrl + wheel zooms. A trackpad pans.

const wheelTarget = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	el.scrollIntoView({ block: 'center' });
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const viewOf = (): Promise<{ v: { x: number; y: number; scale: number }; scrollY: number; hint: boolean; source: string | null }> =>
	page.evaluate(() => {
		const el = document.getElementById('demo-dag') as DagViewElement;
		const hint = el.shadowRoot!.querySelector('.wheel-hint')!;
		// The gallery scrolls `main`, not the window.
		const scrollY = window.scrollY + (document.querySelector('main')?.scrollTop ?? 0);
		return { v: el.viewport, scrollY, hint: hint.classList.contains('show'), source: el.lastWheelSource };
	});
await page.mouse.move(wheelTarget.x, wheelTarget.y);
await page.waitForTimeout(400);
const w0 = await viewOf();
await page.mouse.wheel(0, 120);
await page.waitForTimeout(250);
const w1 = await viewOf();
check(
	'a plain mouse wheel leaves the graph as it was',
	w1.v.x === w0.v.x && w1.v.y === w0.v.y && w1.v.scale === w0.v.scale && w1.source === 'mouse',
	JSON.stringify([w0, w1]),
);
check('a plain mouse wheel scrolls the page', w1.scrollY > w0.scrollY, `${w0.scrollY} -> ${w1.scrollY}`);
check('a plain mouse wheel shows the zoom hint', w1.hint);
await page.waitForTimeout(400);
const w2pos = await page.evaluate(() => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(w2pos.x, w2pos.y);
const z0 = await viewOf();
await page.keyboard.down('Control');
await page.mouse.wheel(0, -120);
await page.keyboard.up('Control');
await page.waitForTimeout(250);
const z1 = await viewOf();
check('Ctrl + mouse wheel zooms', z1.v.scale > z0.v.scale && z1.scrollY === z0.scrollY, JSON.stringify([z0, z1]));
await page.waitForTimeout(400);
const pad = await page.evaluate(async () => {
	const el = document.getElementById('demo-dag') as DagViewElement;
	const canvas = el.shadowRoot!.querySelector('canvas')!;
	const r = canvas.getBoundingClientRect();
	const before = el.viewport;
	const scrolled = (): number => window.scrollY + (document.querySelector('main')?.scrollTop ?? 0);
	const y0 = scrolled();
	for (let step = 0; step < 6; step++) {
		canvas.dispatchEvent(
			new WheelEvent('wheel', {
				deltaX: 3,
				deltaY: 2.5,
				deltaMode: 0,
				clientX: r.left + r.width / 2,
				clientY: r.top + r.height / 2,
				bubbles: true,
				cancelable: true,
			}),
		);
		await new Promise((res) => setTimeout(res, 16));
	}
	await new Promise((res) => setTimeout(res, 100));
	return { before, after: el.viewport, source: el.lastWheelSource, scrolled: scrolled() !== y0 };
});
check(
	'a trackpad-shaped scroll pans the graph and does not zoom',
	pad.source === 'trackpad' &&
		(pad.after.x !== pad.before.x || pad.after.y !== pad.before.y) &&
		pad.after.scale === pad.before.scale &&
		!pad.scrolled,
	JSON.stringify(pad),
);
await page.evaluate(() => (document.getElementById('demo-dag') as DagViewElement).fit());

// A scratch element, so the gallery board stays as the screenshots need it.
const stopped = await page.evaluate(async () => {
	const host = document.createElement('div');
	host.style.cssText = 'width:600px;height:300px;position:fixed;left:-4000px;top:0';
	const el = document.createElement('dag-view') as DagViewElement;
	el.style.cssText = 'display:block;width:100%;height:100%';
	host.appendChild(el);
	document.body.appendChild(host);
	const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 250));
	el.styles = { working: { active: true } };
	el.setData({
		nodes: [
			{ id: 'run', state: 'working' },
			{ id: 'idle', state: 'done' },
		],
		edges: [{ from: 'idle', to: 'run' }],
	});
	await tick();
	const running = el.animating;
	const original = el.viewport;
	// Pan every node out of view: the loop has nothing left to animate.
	el.viewport = { x: 1e6, y: 1e6, scale: original.scale };
	await tick();
	const pannedAway = el.animating;
	el.viewport = original;
	await tick();
	const pannedBack = el.animating;
	// The same nodes, and no style entry or field says active any more.
	el.styles = { working: { pattern: 'solid' } };
	await tick();
	const noneActive = el.animating;
	el.setData({ nodes: [{ id: 'run', state: 'working', active: true }], edges: [] });
	await tick();
	const fieldActive = el.animating;
	el.setData({ nodes: [{ id: 'run', state: 'working' }], edges: [] });
	await tick();
	const fieldCleared = el.animating;
	host.remove();
	return { running, pannedAway, pannedBack, noneActive, fieldActive, fieldCleared };
});
check('scratch graph: the loop runs with an active node in view', stopped.running);
check('the loop stops when every active node is out of view', !stopped.pannedAway);
check('the loop starts again when an active node comes back into view', stopped.pannedBack);
check('the loop stops when the style map no longer marks any node active', !stopped.noneActive);
check('a node field alone starts the loop', stopped.fieldActive);
check('the loop stops when no active node remains', !stopped.fieldCleared);

// -- Screenshots -------------------------------------------------------------------------

if (shots) {
	await page.evaluate(() => {
		const el = document.getElementById('demo-dag') as DagViewElement;
		const input = el.shadowRoot!.querySelector<HTMLInputElement>('.search')!;
		input.value = '';
		input.dispatchEvent(new Event('input'));
		el.fit();
	});
	// Park the pointer off the graph first: a hover fades everything outside one neighbourhood.
	await page.mouse.move(2, 2);
	await page.waitForTimeout(400);
	for (const [id, name] of [
		['demo-dag-group-closed', 'dag-view-group-collapsed.png'],
		['demo-dag-group-open', 'dag-view-group-expanded.png'],
	]) {
		const el = await page.$(`#${id}`);
		if (el === null) continue;
		const out = join(outDir, name);
		await el.screenshot({ path: out });
		console.log(`  shot ${out}`);
	}
	// The sheen moves, so frames apart show it at positions.
	for (const name of ['dag-view-active-1.png', 'dag-view-active-2.png']) {
		const el = await page.$('#demo-dag-active');
		if (el === null) break;
		const out = join(outDir, name);
		await el.screenshot({ path: out });
		console.log(`  shot ${out}`);
		await page.waitForTimeout(450);
	}
	const gallery: [string, string][] = [
		['demo-dag', 'dag-view.png'],
		['demo-dag-cycle', 'dag-view-cycle.png'],
		['demo-dag-lr', 'dag-view-lr.png'],
		['demo-dag-theme', 'dag-view-theme.png'],
	];
	for (const [id, name] of gallery) {
		const el = await page.$(`#${id}`);
		if (el === null) continue;
		const out = join(outDir, name);
		await el.screenshot({ path: out });
		console.log(`  shot ${out}`);
	}
	// The README's picture, captured from the SAME live component as every
	// other shot. It cannot drift into showing a graph the code no longer
	// draws. Opt-in, because it writes into the tracked tree.
	if (process.argv.includes('--readme')) {
		const el = await page.$('#demo-dag');
		if (el !== null) {
			await el.screenshot({ path: 'docs/dag-view.png' });
			console.log('  shot docs/dag-view.png');
		}
	}

	await page.evaluate(() => {
		const el = document.getElementById('demo-dag') as DagViewElement;
		el.focusNode('bundle', 1);
		el.selected = null;
	});
	await page.mouse.move(2, 2);
	await page.waitForTimeout(300);
	const zoomEl = await page.$('#demo-dag');
	if (zoomEl !== null) {
		const out = join(outDir, 'dag-view-1to1.png');
		await zoomEl.screenshot({ path: out });
		console.log(`  shot ${out}`);
	}
}

await browser.close();

if (pageErrors.length > 0) {
	console.error(`\npage errors:\n  ${pageErrors.slice(0, 8).join('\n  ')}`);
	process.exit(1);
}
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
	console.error(`failed: ${failures.join(', ')}`);
	process.exit(1);
}
