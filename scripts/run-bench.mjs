// Run a bench/*.html page in the preinstalled chromium and print its results.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// playwright is preinstalled globally, not a dependency of this repo.
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

// A page may take options in its query string (bench-gl.html?warmup=0).
const [path, query] = file.split('?');
const url = pathToFileURL(resolve(path)).href + (query ? `?${query}` : '');
await page.goto(url, { waitUntil: 'domcontentloaded' });
// (fn, arg, options) — the options object MUST go third.
await page.waitForFunction(() => window.__results !== undefined, undefined, { timeout });
const results = await page.evaluate(() => window.__results);
const text = await page.evaluate(() => document.getElementById('out')?.textContent ?? '');
await browser.close();

if (errors.length > 0) {
	console.error('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
	process.exit(1);
}
console.log(text || JSON.stringify(results, null, 2));
