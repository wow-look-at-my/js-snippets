// Run a bench/*.html page in the preinstalled chromium and print its results.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// playwright is preinstalled globally here, not a dependency of this repo. A CI job that brings its own Chrome installs playwright-core.
const req = createRequire(import.meta.url);
let pw;
try {
	pw = req('playwright');
} catch {
	pw = req('playwright-core');
}
const { chromium } = pw;

const file = process.argv[2] ?? 'bench/pip-draw.html';
const timeout = Number(process.env.BENCH_TIMEOUT_MS ?? 600_000);
// BENCH_CHROME names a Chrome binary, BENCH_CHROME_ARGS its flags. BENCH_REQUIRE_GPU=1 fails a run that a software renderer drew.
const requireGpu = process.env.BENCH_REQUIRE_GPU === '1';

const browser = await chromium.launch({
	executablePath: process.env.BENCH_CHROME || undefined,
	args: (process.env.BENCH_CHROME_ARGS ?? '').split(' ').filter(Boolean),
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
if (requireGpu) {
	// The feature list says what runs on the GPU. The renderer check at the end is what fails the run.
	const probe = await browser.newPage();
	try {
		await probe.goto('chrome://gpu');
		await probe.waitForTimeout(1500);
		const status = await probe.evaluate(() => document.querySelector('info-view')?.shadowRoot?.textContent ?? '');
		console.log(status.match(/Graphics Feature Status[\s\S]*?(?=Driver Bug Workarounds|Version Information)/)?.[0]?.replace(/\n\s*\n/g, '\n') ?? 'chrome://gpu: no feature status');
	} catch (e) {
		console.error(`chrome://gpu did not load, so the feature list is missing: ${e.message.split('\n')[0]}`);
	}
	await probe.close();
}
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
const renderer = String(results?.renderer ?? '');
if (requireGpu && (renderer === '' || /swiftshader|llvmpipe|software/i.test(renderer))) {
	console.error(`::error::Chrome drew on "${renderer || 'an unknown renderer'}", not a GPU. These are software numbers.`);
	process.exit(1);
}
