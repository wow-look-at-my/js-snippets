// Move a `Types:` / `Type:` declaration line into a fenced ts block.
//
//   node scripts/fence-type-blocks.mjs src/webgl2/llms.txt
//
// The semicolons in `{ data: Float32Array; dims: [number, number] }` are
// TypeScript syntax, not prose punctuation: turning them into sentences would
// falsify the documentation. A fence says what the line already is, and
// ste-lint exempts fenced blocks, so the rule stops applying for the right
// reason rather than through an exception.
//
// Only a line that actually declares a type is moved -- `Types: Token,
// TokenType, HiToken` is a plain list of names and stays prose.
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('usage: node scripts/fence-type-blocks.mjs <file>...');
	process.exit(2);
}

const isFence = (l) => /^\s*(?:```|~~~)/.test(l);
const TYPES_RE = /^(\s*)(Types?):\s*(\S.*)$/;
// A declaration, not a bare list of exported type names.
const declares = (body) => /[{=]/.test(body);

let total = 0;
for (const file of files) {
	const lines = readFileSync(file, 'utf8').split('\n');
	const out = [];
	let fenced = false;
	let changed = 0;
	for (const line of lines) {
		if (isFence(line)) fenced = !fenced;
		const m = fenced ? null : TYPES_RE.exec(line);
		if (!m || !declares(m[3])) {
			out.push(line);
			continue;
		}
		changed++;
		// One declaration per line reads better than one long line, and a
		// fence has no wrap rule to satisfy. Split only between declarations
		// at brace depth 0, never inside a type literal.
		const parts = [];
		let depth = 0;
		let current = '';
		for (const ch of m[3]) {
			if (ch === '{' || ch === '<' || ch === '(') depth++;
			if (ch === '}' || ch === '>' || ch === ')') depth = Math.max(0, depth - 1);
			if (depth === 0 && (ch === ';' || ch === '.') && current.trim() !== '') {
				parts.push(current.trim() + ';');
				current = '';
				continue;
			}
			current += ch;
		}
		if (current.trim() !== '') parts.push(current.trim().replace(/[.;]$/, '') + ';');
		out.push(`${m[1]}${m[2]}:`, '', '```ts', ...parts, '```');
	}
	if (changed > 0) writeFileSync(file, out.join('\n').replace(/\n{3,}/g, '\n\n'));
	total += changed;
	console.log(`${file}: ${changed} type block(s) fenced`);
}
console.log(`${total} type block(s) fenced in total`);
