// Browser check for <timeline-view>'s static bounds, against the built gallery.

// Node's ESM resolver ignores NODE_PATH, and playwright is preinstalled globally rather than depended on here.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const file = process.argv[2] ?? 'showcase/dist/index.html';
const outDir = process.argv[3] ?? '.';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1400 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: 'load' });
await page.waitForTimeout(4000);

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); else console.log('ok  ' + msg); };

const read = (id) => page.evaluate((sel) => {
	const el = document.getElementById(sel);
	return { vp: el.viewport, min: el.minTime, max: el.maxTime, follow: el.followNow };
}, id);

const st0 = await read('static');
check(st0.min !== null && st0.max !== null, 'static: both bounds set');
check(!st0.follow, 'static: follow is off');
check(st0.vp.end <= st0.max + 0.001, 'static: view ends at/before maxTime');

// Drag the frozen chart hard to the LEFT (pans the view forward in time): the view must stop at maxTime.
const box = await (await page.$('#static')).boundingBox();
const cy = box.y + box.height / 2;
await page.mouse.move(box.x + box.width - 30, cy);
await page.mouse.down();
await page.mouse.move(box.x + 30, cy, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
const stFwd = await read('static');
check(stFwd.vp.end <= stFwd.max + 0.001, `static: a forward drag parks at maxTime (end - max = ${stFwd.vp.end - stFwd.max})`);
check(!stFwd.follow, 'static: docking at the stop does NOT engage follow');

// ...and hard to the RIGHT: the view must stop at minTime.
await page.mouse.move(box.x + 30, cy);
await page.mouse.down();
await page.mouse.move(box.x + box.width - 30, cy, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
const stBack = await read('static');
check(stBack.vp.start >= stBack.min - 0.001, `static: a backward drag parks at minTime (start - min = ${stBack.vp.start - stBack.min})`);

// Zoom out past the whole bounded range: the view collapses onto it exactly.
await page.mouse.move(box.x + box.width / 2, cy);
await page.keyboard.down('Control');
for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 200);
await page.keyboard.up('Control');
await page.waitForTimeout(400);
const stZoom = await read('static');
check(
	stZoom.vp.start >= stZoom.min - 0.001 && stZoom.vp.end <= stZoom.max + 0.001,
	`static: zoomed all the way out stays inside the range (span ${stZoom.vp.end - stZoom.vp.start} vs range ${stZoom.max - stZoom.min})`,
);

// The frozen chart must not move on its own.
const a = await read('static');
await page.waitForTimeout(2500);
const b = await read('static');
check(a.vp.start === b.vp.start && a.vp.end === b.vp.end, 'static: the view does not advance with the clock');

// The back-limited one is still live.
const f0 = await read('floor');
check(f0.min !== null && f0.max === null, 'floor: minTime only');
check(f0.follow, 'floor: still following the clock');
await page.waitForTimeout(2500);
const f1 = await read('floor');
check(f1.vp.end > f0.vp.end, `floor: the right edge advanced (${Math.round(f1.vp.end - f0.vp.end)}ms)`);

// Drag it back hard: it must stop at its floor.
const fbox = await (await page.$('#floor')).boundingBox();
const fy = fbox.y + fbox.height / 2;
for (let i = 0; i < 3; i++) {
	await page.mouse.move(fbox.x + 30, fy);
	await page.mouse.down();
	await page.mouse.move(fbox.x + fbox.width - 30, fy, { steps: 10 });
	await page.mouse.up();
}
await page.waitForTimeout(500);
const f2 = await read('floor');
check(f2.vp.start >= f2.min - 0.001, `floor: parks at minTime (start - min = ${Math.round(f2.vp.start - f2.min)}ms)`);
check(!f2.follow, 'floor: a backward pan still disengages follow');

// The live one is untouched by any of this.
const m = await read('main');
check(m.min === null && m.max === null && m.follow, 'main: unbounded and still following (no regression)');

// -- Sub-spans ---------------------------------------------------------------------------
// Every 'intervalhover' the element fires, with the pointer position that
// caused it, is the only public window onto the element's row layout.
// The event fires on CHANGE only, so the page keeps the current hover state.
await page.evaluate(() => {
	const el = document.getElementById('subspans');
	window.__hover = null;
	el.addEventListener('intervalhover', (e) => {
		const iv = e.detail.interval;
		window.__hover = iv ? { id: iv.id, parentId: iv.parentId ?? null } : null;
	});
});
const hoverAt = async (hx, hy) => {
	await page.mouse.move(hx, hy);
	await page.waitForTimeout(8);
	return page.evaluate(() => window.__hover);
};
// The instance sits low on the page: bring it on screen.
const subHandle = await page.$('#subspans');
await subHandle.scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
const sbox = await subHandle.boundingBox();
const svp = await page.evaluate(() => document.getElementById('subspans').viewport);
check(svp.end > svp.start, 'subspans: the instance has a viewport');

// Sweep the pointer down one column of the plot, px per step, and record which interval each y lands on.
const sx = sbox.x + sbox.width * 0.55;
const rows = [];
for (let y = sbox.y + 24; y < sbox.y + sbox.height - 4; y += 2) {
	const h = await hoverAt(sx, y);
	rows.push({ y, id: h?.id ?? null, parentId: h?.parentId ?? null });
}
const hits = rows.filter((r) => r.id !== null);
const parentRow = hits.find((r) => r.parentId === null);
check(parentRow !== undefined, 'subspans: the sweep lands on a root interval (the release run)');
if (parentRow) {
	const pid = parentRow.id;
	const inFamily = (r) => r.id === pid || r.parentId === pid || hits.some((p) => p.id === r.parentId && p.parentId === pid);
	const kids = hits.filter((r) => r.parentId === pid);
	check(kids.length > 0, `subspans: a direct sub-span of ${pid} is under the pointer column`);
	if (kids.length === 0) {
		console.error('sweep:', rows.map((r) => `${Math.round(r.y)}:${r.id ?? '-'}`).join(' '));
		fail.push('subspans: no sub-span row found — the checks below need one');
	}
}
if (parentRow && hits.some((r) => r.parentId === parentRow.id)) {
	const pid = parentRow.id;
	const inFamily = (r) => r.id === pid || r.parentId === pid || hits.some((p) => p.id === r.parentId && p.parentId === pid);
	const kids = hits.filter((r) => r.parentId === pid);
	check(kids.every((r) => r.y > parentRow.y), 'subspans: every sub-span row lies BELOW its parent row');
	const lastFamilyY = Math.max(...hits.filter(inFamily).map((r) => r.y));
	const strangers = hits.filter((r) => r.y > parentRow.y && r.y < lastFamilyY && !inFamily(r));
	check(strangers.length === 0, `subspans: no stranger inside the family block (${strangers.map((s) => s.id).join(', ') || 'none'})`);

	// Between the parent row and the first sub-span row lies the track gap.
	const firstKid = kids[0];
	const lastParentY = Math.max(...hits.filter((r) => r.id === pid).map((r) => r.y));
	const gapY = (lastParentY + firstKid.y) / 2;
	const px = await page.evaluate(([cx, cy, ox]) => {
		const el = document.getElementById('subspans');
		const canvas = el.shadowRoot.querySelector('canvas');
		const r = canvas.getBoundingClientRect();
		const ctx = canvas.getContext('2d');
		const dpr = canvas.width / r.width;
		const read = (px, py) => Array.from(ctx.getImageData(Math.round((px - r.left) * dpr), Math.round((py - r.top) * dpr), 1, 1).data).slice(0, 3);
		return { inside: read(cx, cy), outside: read(ox, cy) };
	}, [sx, gapY, sbox.x + sbox.width * 0.995]);
	const diff = px.inside.reduce((s, v, i) => s + Math.abs(v - px.outside[i]), 0);
	check(diff >= 6, `subspans: the family box tints the gap between parent and sub-span rows (inside ${px.inside} vs outside ${px.outside})`);

	// Hover a sub-span: the gallery's tooltip names the parent from hit.parent.
	await page.mouse.move(sx, firstKid.y);
	await page.waitForTimeout(120);
	const tip = await page.evaluate(() => document.getElementById('subspans').shadowRoot.querySelector('.tooltip')?.textContent ?? '');
	check(/part of /.test(tip), `subspans: the sub-span tooltip names its parent (${JSON.stringify(tip.slice(0, 80))})`);

	// The empty part of the box hits the parent.
	let boxHit = null;
	for (let xx = sbox.x + sbox.width * 0.15; xx < sbox.x + sbox.width * 0.95; xx += 6) {
		const h = await hoverAt(xx, firstKid.y);
		if (h && h.id === pid) { boxHit = xx; break; }
	}
	check(boxHit !== null, 'subspans: the empty part of the family box hits the parent');
}

for (const id of ['static', 'floor', 'subspans']) {
	const el = await page.$('#' + id);
	await el.screenshot({ path: `${outDir}/timeline-${id}.png` });
}
await browser.close();

// A page error means the checks above ran against a half-upgraded component
// — the exact failure the gallery exists to catch.
if (errors.length > 0) {
	console.error('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
	process.exit(1);
}
if (fail.length > 0) {
	console.error('FAILED:\n  ' + fail.join('\n  '));
	process.exit(1);
}
console.log('\nall checks passed');
