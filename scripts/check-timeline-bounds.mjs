// Browser check for <timeline-view>'s static bounds, against the built
// gallery.
//
// Nothing under `node --test` renders the element (see CLAUDE.md,
// "Testing"), and minTime/maxTime are element-level: they clamp gestures,
// gate follow mode and hide chrome. The math they stand on is unit-tested
// in src/ui/timeline-view-math.test.ts; this drives the REAL element with
// real pointer and wheel input and asserts the properties that only exist
// once it is on a page.
//
//   pnpm build:showcase
//   NODE_PATH=/opt/node22/lib/node_modules \
//     node scripts/check-timeline-bounds.mjs showcase/dist/index.html /tmp
//
// Needs playwright and a chromium (both preinstalled in the org's session
// images: NODE_PATH=/opt/node22/lib/node_modules, PLAYWRIGHT_BROWSERS_PATH
// =/opt/pw-browsers). Exits non-zero on a failed check or any page error.

// Node's ESM resolver ignores NODE_PATH, and playwright is preinstalled
// globally rather than depended on here, so it comes through CJS
// resolution, which honours it. A bare import throws ERR_MODULE_NOT_FOUND.
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

// Drag the frozen chart hard to the LEFT (pans the view forward in time):
// the view must stop at maxTime, not sail past it.
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

for (const id of ['static', 'floor']) {
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
