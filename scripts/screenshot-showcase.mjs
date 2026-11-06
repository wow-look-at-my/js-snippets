// Capture the showcase gallery's live <timeline-view> for the README.

// Node's ESM resolver ignores NODE_PATH, and playwright is preinstalled globally rather than depended on here.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const file = process.argv[2] ?? 'showcase/dist/index.html';
const out = process.argv[3] ?? 'docs/timeline-view.png';
/** Long enough for the gallery's generator to fill the window with spans, waits, pips and lazily-loaded history. */
const SETTLE_MS = Number(process.env.SHOWCASE_SETTLE_MS ?? 9000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: 'load' });
// The gallery's live feed generates data on a timer.
await page.waitForTimeout(SETTLE_MS);

const el = await page.$('#main');
if (!el) {
	console.error('no #main <timeline-view> in the gallery — did the build succeed?');
	process.exit(1);
}
await el.screenshot({ path: out });
await browser.close();

// A page error means the capture may show a half-upgraded component (the
// exact failure the gallery exists to catch).
if (errors.length > 0) {
	console.error('page errors during capture:\n  ' + errors.slice(0, 5).join('\n  '));
	process.exit(1);
}
console.log(`wrote ${out}`);
