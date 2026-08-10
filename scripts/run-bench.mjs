// Run a bench/*.html page in the preinstalled chromium and print its results.
//
//   node scripts/run-bench.mjs bench/pip-draw.html
//
// The page owns the methodology; this only drives it and reports what it
// found. A page signals completion by setting window.__results.
//
// The runner reports the GL renderer the page saw. On a machine without a
// GPU that is SwiftShader, and every WebGL number is then a software
// rasterizer's — informative for the CPU-side cost, useless as a verdict
// on the GPU path. Do not quote a GL row without the renderer beside it.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// playwright is preinstalled globally, not a dependency of this repo, and
// Node's ESM resolver ignores NODE_PATH — so it is required through CJS
// resolution, which honours it. A bare `import ... from 'playwright'`
// throws ERR_MODULE_NOT_FOUND here however NODE_PATH is set.
const { chromium } = createRequire(import.meta.url)('playwright');

const file = process.argv[2] ?? 'bench/pip-draw.html';
const timeout = Number(process.env.BENCH_TIMEOUT_MS ?? 600_000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(m.text());
});

await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__results !== undefined, { timeout });
const results = await page.evaluate(() => window.__results);
const text = await page.evaluate(() => document.getElementById('out')?.textContent ?? '');
await browser.close();

if (errors.length > 0) {
	console.error('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
	process.exit(1);
}
console.log(text || JSON.stringify(results, null, 2));
