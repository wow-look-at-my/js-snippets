// Summarize a captured ste-lint run: findings per rule, and per file.
//
// ste-lint reports everything in ONE ::error:: workflow command with %0A for
// newlines, which is unreadable at thousands of findings. This decodes that
// and counts, so the shape of the work is visible before any of it is done.
//
//   node scripts/run-ste-lint.mjs > /tmp/ste.raw 2>&1
//   node scripts/ste-lint-summary.mjs /tmp/ste.raw
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.argv[2] ?? '/dev/stdin', 'utf8');
const text = raw.replace(/%0A/g, '\n').replace(/%25/g, '%').replace(/%3A/g, ':');

// Findings arrive in sections; a section header is a line ending in ':' that
// names no file, and every finding line under it starts with a path.
const perRule = new Map();
const perFile = new Map();
let rule = '(none)';
for (const line of text.split('\n')) {
	const m = /^([^\s:]+\.(?:md|txt)):(\d+):/.exec(line);
	if (!m) {
		const h = line.replace(/^::error::/, '').trim();
		if (h.endsWith(':') && h.length > 3) rule = h.replace(/\s*\(.*$/, '').replace(/:$/, '');
		continue;
	}
	perRule.set(rule, (perRule.get(rule) ?? 0) + 1);
	perFile.set(m[1], (perFile.get(m[1]) ?? 0) + 1);
}

const show = (title, map) => {
	console.log(`\n${title}`);
	for (const [k, v] of [...map].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
};
show('by rule', perRule);
show('by file', perFile);
console.log(`\ntotal findings parsed: ${[...perFile.values()].reduce((a, b) => a + b, 0)}`);
