// Browser check for <perf-graph>'s STACKED mode on the REAL element.
//
// The math under it is node-tested. What is not reachable under `node --test`
// is the element: that setting `series` upgrades the graph into a stacked
// area at all, that the bands reach the canvas as SEPARATE colors, that the
// ceiling follows the tallest column, and that a band joining late leaves the
// others' colors alone. This drives the built showcase and reads the painted
// pixels back.
//
// pnpm build:showcase NODE_PATH=/opt/node22/lib/node_modules node
// scripts/check-perf-graph.mjs
//
// Writes showcase-perf-graph.png beside the built gallery unless a second
// argument names another path.

// Node's ESM resolver ignores NODE_PATH, and playwright is preinstalled
// globally rather than depended on here, so it comes through CJS resolution.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const file = process.argv[2] ?? 'showcase/dist/index.html';
const out = process.argv[3] ?? 'showcase/dist/perf-graph-stacked.png';
/** Past the 6s mark the gallery adds its late band, which is a case to see. */
const SETTLE_MS = Number(process.env.PERF_GRAPH_SETTLE_MS ?? 8000);

const failures = [];
const check = (ok, what) => {
	if (!ok) failures.push(what);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

// The gallery shows only the section its hash names, and a hidden section
// never draws: its canvases are out of view, which the element honours.
await page.goto(`${pathToFileURL(resolve(file)).href}#perf-graph`, { waitUntil: 'load' });
await page.waitForTimeout(SETTLE_MS);

const report = await page.evaluate(() => {
	// The readout row at the top and the legend row at the bottom are text and
	// swatches, not data: a legend swatch is a band's color whether or not
	// that band has a column. Reading only the plot between them is what makes
	// "this graph drew a band" a claim about the DATA.
	const read = (id, skipTop, skipBottom) => {
		const el = document.getElementById(id);
		if (!el) return { missing: true };
		const canvas = el.shadowRoot?.querySelector('canvas');
		if (!canvas) return { notUpgraded: true };
		const ctx = canvas.getContext('2d');
		// One vertical scanline across the middle: every band with height
		// there paints its own color into it. The middle, not the right
		// edge, because the value readout sits in the top-right corner and
		// its antialiased text would count as colors of its own.
		const x = Math.floor(canvas.width / 2);
		const top = Math.min(skipTop, canvas.height - 1);
		const rows = Math.max(1, canvas.height - top - skipBottom);
		const column = ctx.getImageData(x, top, 1, rows).data;
		const colors = new Set();
		let painted = 0;
		for (let i = 0; i < column.length; i += 4) {
			if (column[i + 3] === 0) continue;
			painted++;
			colors.add(`${column[i]},${column[i + 1]},${column[i + 2]}`);
		}
		return {
			stacked: el.stacked,
			seriesCount: el.series.length,
			keys: el.series.map((s) => s.key),
			height: rows,
			painted,
			colors: colors.size,
			colorList: [...colors],
		};
	};
	// Device px at deviceScaleFactor 2: a 10px font row plus its padding is
	// about 26 at the top, and the legend is about 30 at the bottom. A
	// compact graph draws no legend, so only the top row is skipped there.
	return {
		full: read('demo-perf-stacked', 26, 30),
		compact: read('demo-perf-stacked-compact', 26, 2),
		empty: read('demo-perf-stacked-empty', 26, 30),
	};
});

const { full, compact, empty } = report;

check(full.stacked === true, 'the full stacked graph reports stacked');
check(full.seriesCount === 6, `the late band joined (6 series, got ${full.seriesCount})`);
check(full.keys?.includes('webhook-runner'), 'the late band is in the series list');
check(full.painted === full.height, `the column is painted end to end (${full.painted} of ${full.height} px)`);
// Background, plus one color per band that has height. 'gosmopolitan' is flat
// at 0 the whole run, so 6 series draw at most 5 distinct bands.
check(full.colors >= 5, `the bands paint as separate colors (${full.colors} distinct in one column)`);

check(compact.stacked === true, 'the compact stacked graph reports stacked');
check(compact.colors >= 5, `the binned path still paints separate bands (${compact.colors} distinct)`);

check(empty.stacked === true, 'a stacked graph with no column pushed still reports stacked');
// With no column pushed there is nothing to fill, so the column holds the
// background and the gridline blended over it, and no third color.
check(empty.colors <= 2, `an empty stacked graph draws no band (${empty.colors} colors: ${empty.colorList?.join(' ')})`);

const section = await page.$('#perf-graph');
if (section) await section.screenshot({ path: out });
else failures.push('no #perf-graph section in the gallery');

await browser.close();

if (errors.length > 0) failures.push('page errors:\n    ' + errors.slice(0, 5).join('\n    '));
if (failures.length > 0) {
	console.error('check-perf-graph FAILED:\n  ' + failures.join('\n  '));
	process.exit(1);
}
console.log(`check-perf-graph OK (wrote ${out})`);
console.log(JSON.stringify(report, null, 2));
