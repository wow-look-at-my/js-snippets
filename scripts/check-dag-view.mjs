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
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/check-dag-view.mjs
//
// Writes a screenshot of each graph next to the built gallery unless
// --no-shots is passed. Exits non-zero on the first failed check or on any
// page error, so it can gate a change rather than merely describe one.

// Node's ESM resolver ignores NODE_PATH, and playwright is preinstalled
// globally rather than depended on here, so it comes through CJS
// resolution, which honours it. A bare import throws ERR_MODULE_NOT_FOUND.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';

// Flags are stripped so the positional path stays positional -- passing
// `--readme` alone must not be read as "the page lives at ./--readme".
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const file = args[0] ?? 'showcase/dist/index.html';
const shots = !process.argv.includes('--no-shots');
const outDir = process.env.DAG_SHOT_DIR ?? dirname(resolve(file));

const failures = [];
let checks = 0;

function check(name, ok, detail) {
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
const pageErrors = [];
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
	const out = [];
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
	const el = document.getElementById('demo-dag');
	const canvas = el.shadowRoot.querySelector('canvas');
	const ctx = canvas.getContext('2d');
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
	const el = document.getElementById('demo-dag');
	const notice = el.shadowRoot.querySelector('.notice');
	return { info: el.info, noticeHidden: notice.hidden, noticeText: notice.textContent };
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
	const el = document.getElementById('demo-dag-cycle');
	const notice = el.shadowRoot.querySelector('.notice');
	return { info: el.info, noticeText: notice.textContent, noticeHidden: notice.hidden };
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
	const tb = document.getElementById('demo-dag');
	const lr = document.getElementById('demo-dag-lr');
	return { tb: tb.info, lrOrientation: lr.orientation, lrNodes: lr.info.nodeCount };
});
check('the LR instance reports its orientation', orient.lrOrientation === 'LR', orient.lrOrientation);
check('the LR instance lays out the same graph', orient.lrNodes === orient.tb.nodeCount);

// -- Interaction: selection ---------------------------------------------------------

// The section sits well down a scrolling page, so the element has to be IN
// the viewport before a mouse coordinate means anything. Scrolling first,
// then reading the rect, is the difference between clicking the graph and
// clicking whatever happens to be at those coordinates.
await page.evaluate(() => document.getElementById('demo-dag').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(300);

// focusNode centers the node in the element, so its screen position is the
// element's center -- no reliance on private layout state.
const nodeScreenPoint = await page.evaluate(() => {
	const el = document.getElementById('demo-dag');
	el.focusNode('bundle');
	el.selected = null;
	const r = el.getBoundingClientRect();
	return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.waitForTimeout(200);
check(
	'focusNode leaves nothing selected once cleared',
	(await page.evaluate(() => document.getElementById('demo-dag').selected)) === null,
);

await page.mouse.move(nodeScreenPoint.x, nodeScreenPoint.y);
await page.waitForTimeout(150);

const hovered = await page.evaluate(() => {
	const el = document.getElementById('demo-dag');
	const tip = el.shadowRoot.querySelector('.tooltip');
	return { visible: tip.classList.contains('visible'), text: tip.textContent };
});
check('hovering a node shows its tooltip', hovered.visible, JSON.stringify(hovered));
check('the tooltip names the node', /bundle/.test(hovered.text), hovered.text);

await page.mouse.click(nodeScreenPoint.x, nodeScreenPoint.y);
await page.waitForTimeout(150);

const selected = await page.evaluate(() => {
	const el = document.getElementById('demo-dag');
	return { selected: el.selected, readout: document.getElementById('demo-dag-click').textContent };
});
check('clicking a node selects it', selected.selected === 'bundle', String(selected.selected));
check('the nodeclick event reaches the page', /bundle/.test(selected.readout), selected.readout);

// -- Interaction: the arrow keys walk the graph ---------------------------------------

await page.keyboard.press('ArrowDown');
await page.waitForTimeout(120);
const walked = await page.evaluate(() => document.getElementById('demo-dag').selected);
check(
	'ArrowDown walks to a dependent of the selected node',
	walked !== 'bundle' && ['e2e', 'docs', 'sign'].includes(walked),
	String(walked),
);

await page.keyboard.press('ArrowUp');
await page.waitForTimeout(120);
const walkedBack = await page.evaluate(() => document.getElementById('demo-dag').selected);
check('ArrowUp walks back toward a dependency', walkedBack !== walked, `${walked} -> ${walkedBack}`);

await page.keyboard.press('Escape');
await page.waitForTimeout(120);
check(
	'Escape clears the selection',
	(await page.evaluate(() => document.getElementById('demo-dag').selected)) === null,
);

// -- Interaction: the toolbar moves the viewport ----------------------------------------

const zoomed = await page.evaluate(async () => {
	const el = document.getElementById('demo-dag');
	el.fit();
	const before = el.viewport.scale;
	el.shadowRoot.querySelector('.zoom-in-btn').click();
	const after = el.viewport.scale;
	el.shadowRoot.querySelector('.zoom-out-btn').click();
	const back = el.viewport.scale;
	return { before, after, back };
});
check('the zoom-in button zooms in', zoomed.after > zoomed.before, JSON.stringify(zoomed));
check('the zoom-out button undoes it', Math.abs(zoomed.back - zoomed.before) < 1e-6, JSON.stringify(zoomed));

const fitted = await page.evaluate(() => {
	const el = document.getElementById('demo-dag');
	el.viewport = { x: 9999, y: 9999, scale: 3 };
	el.shadowRoot.querySelector('.fit-btn').click();
	return el.viewport;
});
check('the fit button brings the graph back on screen', Math.abs(fitted.x) < 5000 && fitted.scale < 3, JSON.stringify(fitted));

// -- Search highlights rather than filters -----------------------------------------------

const searched = await page.evaluate(async () => {
	const el = document.getElementById('demo-dag');
	const input = el.shadowRoot.querySelector('.search');
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
	const el = document.getElementById('demo-dag-empty');
	const hint = el.shadowRoot.querySelector('.empty-hint');
	return { hidden: hint.hidden, text: hint.textContent, nodes: el.info.nodeCount };
});
check('an empty graph shows its empty state', !empty.hidden && empty.nodes === 0, JSON.stringify(empty));
check('the empty text is the consumer\'s', /No dependencies recorded/.test(empty.text), empty.text);

// -- Screenshots -------------------------------------------------------------------------

if (shots) {
	await page.evaluate(() => {
		const el = document.getElementById('demo-dag');
		const input = el.shadowRoot.querySelector('.search');
		input.value = '';
		input.dispatchEvent(new Event('input'));
		el.fit();
	});
	// Park the pointer off the graph first: a hover fades everything outside
	// one neighbourhood, and a reference shot of a half-faded graph shows
	// the highlight rather than the component.
	await page.mouse.move(2, 2);
	await page.waitForTimeout(400);
	for (const [id, name] of [
		['demo-dag', 'dag-view.png'],
		['demo-dag-cycle', 'dag-view-cycle.png'],
		['demo-dag-lr', 'dag-view-lr.png'],
		['demo-dag-theme', 'dag-view-theme.png'],
	]) {
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
		const el = document.getElementById('demo-dag');
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
