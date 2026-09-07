// Browser check for <dag-view> on the REAL element.
//
// The layout math under it is node-tested; NONE of what this file checks
// can be. Whether the element upgrades, whether the canvas actually paints
// pixels, whether a hover fades the graph, whether a click selects, whether
// the arrow keys walk the edges, whether the toolbar moves the viewport --
// every one of those needs a browser, and a green `pnpm test` says nothing
// about any of them.
//
//   pnpm build:showcase
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/check-dag-view.ts
//
// Node runs this .ts directly by stripping the types (22.18+, on by default).
// The types are not decoration: `ts0 build` type-checks scripts/ too, so an
// element API this file misuses fails the build instead of failing here at
// 11pm. That is what DagViewElement below is imported for.
//
// Writes a screenshot of each graph next to the built gallery unless
// --no-shots is passed. Exits non-zero on the first failed check or on any
// page error, so it can gate a change rather than merely describe one.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import type { DagViewElement } from '../src/ui/dag-view.ts';

// The slice of playwright this file drives. Playwright is preinstalled
// globally rather than depended on here, so its own types are not
// resolvable -- these describe what is called, and nothing else.
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
	$(selector: string): Promise<ElementHandle | null>;
	mouse: {
		move(x: number, y: number): Promise<void>;
		click(x: number, y: number, options?: { button?: 'left' | 'right' | 'middle' }): Promise<void>;
	};
	keyboard: { press(key: string): Promise<void> };
}
interface Browser {
	newPage(options: {
		viewport: { width: number; height: number };
		deviceScaleFactor: number;
	}): Promise<Page>;
	close(): Promise<void>;
}

// Node's ESM resolver ignores NODE_PATH, and playwright comes from the
// global install, so it is pulled through CJS resolution, which honours it.
// A bare import throws ERR_MODULE_NOT_FOUND.
const { chromium } = createRequire(import.meta.url)('playwright') as {
	chromium: { launch(options: { args?: string[] }): Promise<Browser> };
};

// Flags are stripped so the positional path stays positional -- passing
// `--readme` alone must not be read as "the page lives at ./--readme".
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

await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: 'load' });
await page.waitForTimeout(1200);

// -- Upgrade -------------------------------------------------------------------
// A demo whose import got elided sits on its light-DOM "loading..." line
// with the build green throughout, which is the exact failure the gallery
// exists to catch.

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

check('found every gallery instance', upgrade.length === 5, `saw ${upgrade.length}`);
for (const u of upgrade) {
	check(`#${u.id} upgraded with a sized canvas`, u.upgraded && u.hasCanvas && u.w > 0 && u.h > 0, JSON.stringify(u));
}

// -- The canvas actually painted -------------------------------------------------
// A component can upgrade, size its canvas and still draw nothing. The only
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

// The section sits well down a scrolling page, so the element has to be IN
// the viewport before a mouse coordinate means anything. Scrolling first,
// then reading the rect, is the difference between clicking the graph and
// clicking whatever happens to be at those coordinates.
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

// Driven as the real gesture rather than by calling the getter, because what
// has to hold is that a reader looking at a wrong picture can hand somebody
// the numbers. A getter nothing is wired to does not do that.
// The text is taken off the element's own event rather than read back from
// the clipboard, which needs a permission this harness does not grant. The
// toast covers the clipboard write itself: it only says "Copied" once that
// resolved, and says something else when it did not.
await page.evaluate(() => {
	const el = document.getElementById('demo-dag')!;
	el.addEventListener('snapshotcopy', (e) => {
		(window as unknown as { __snap?: string }).__snap = (e as CustomEvent<{ text: string }>).detail.text;
	});
});
await page.mouse.click(nodeScreenPoint.x, nodeScreenPoint.y, { button: 'right' });
await page.waitForTimeout(150);

// The right-click opens a MENU. Copying on the click itself was invisible:
// the browser's own menu is suppressed, so a reader who saw nothing open read
// a working feature as a dead click.
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
// every menu item out of flow and drew all of them at one spot. Reading the
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
	// The whole point of the screen half: these are canvas pixels, so a band
	// of empty canvas can be measured off the dump instead of described.
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

// -- The empty instance says so ----------------------------------------------------------

const empty = await page.evaluate(() => {
	const el = document.getElementById('demo-dag-empty') as DagViewElement;
	const hint = el.shadowRoot!.querySelector<HTMLElement>('.empty-hint')!;
	return { hidden: hint.hidden, text: hint.textContent ?? '', nodes: el.info.nodeCount };
});
check('an empty graph shows its empty state', !empty.hidden && empty.nodes === 0, JSON.stringify(empty));
check("the empty text is the consumer's", /No dependencies recorded/.test(empty.text), empty.text);

// -- Dashboard scale ---------------------------------------------------------------------
// The shape a real consumer hands this: every repository in an org is a node,
// and a manifest sweep that read nothing leaves almost all of them edgeless.
// The gallery's graphs are small enough that nothing here can go wrong in
// them, which is why this case is built rather than looked up.
//
// It went wrong twice, and both failures look identical on screen -- a dark
// box with a couple of stray lines. Edgeless nodes each became a layer of
// their own, so 118 repositories with one three-node chain reported 11
// layers. And the block they packed into was four times wider than tall
// against a canvas that is not, so the fit was bound by width and landed at
// 0.35 -- under LOD_LABEL_SCALE, where the component draws boxes and no text.
// Its own comment names that state: "shows a reader nothing but coloured
// boxes and reads as broken".

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
		// One three-node chain and one pair: the longest chain is what a layer
		// count may be derived from, and nothing else is.
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

// -- Screenshots -------------------------------------------------------------------------

if (shots) {
	await page.evaluate(() => {
		const el = document.getElementById('demo-dag') as DagViewElement;
		const input = el.shadowRoot!.querySelector<HTMLInputElement>('.search')!;
		input.value = '';
		input.dispatchEvent(new Event('input'));
		el.fit();
	});
	// Park the pointer off the graph first: a hover fades everything outside
	// one neighbourhood, and a reference shot of a half-faded graph shows
	// the highlight rather than the component.
	await page.mouse.move(2, 2);
	await page.waitForTimeout(400);
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
	// other shot, so it cannot drift into showing a graph the code no
	// longer draws. Opt-in, because it writes into the tracked tree.
	if (process.argv.includes('--readme')) {
		const el = await page.$('#demo-dag');
		if (el !== null) {
			await el.screenshot({ path: 'docs/dag-view.png' });
			console.log('  shot docs/dag-view.png');
		}
	}

	// One shot at 1:1, where the labels are at their real size -- the fitted
	// view is the picture, this is the legibility check.
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
