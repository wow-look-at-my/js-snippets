// Turn prose semicolons into sentences, which is what ste-lint asks for:
// "STE bans the semicolon -- use a period and start a new sentence".
//
//   node scripts/split-semicolons.mjs src/ui/llms.txt   # rewrites in place
//
// A semicolon inside CODE is not prose punctuation and must survive: a
// TypeScript type literal (`{ a: number; b: string }`), an inline code span,
// an HTML style attribute, a fenced block. Those are skipped, and ste-lint
// exempts fenced blocks anyway. Everything else becomes ". " with the next
// word capitalised.
//
// Review the diff. This changes prose, and a semicolon joining a fragment
// that cannot stand alone as a sentence needs a human rewrite instead --
// re-run ste-lint after, then read what it still reports.
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('usage: node scripts/split-semicolons.mjs <file>...');
	process.exit(2);
}

const isFence = (l) => /^\s*(?:```|~~~)/.test(l);
// A line carrying code that legitimately uses semicolons as syntax.
const looksLikeCode = (l) => /=>|<\/?[a-z]+[ >]|style="|\bfunction\b|^\s*(?:const|let|var|import|return)\b/.test(l);

/** Split `text` on backticks so odd-indexed parts are inline code spans. */
function mapProse(line, fn) {
	return line
		.split('`')
		.map((part, i) => (i % 2 === 1 ? part : fn(part)))
		.join('`');
}

/** Depth of {} or <> nesting at each index, so type literals are skipped. */
function bracketDepths(text) {
	const depths = new Array(text.length).fill(0);
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '{' || c === '<') depth++;
		depths[i] = depth;
		if (c === '}' || c === '>') depth = Math.max(0, depth - 1);
	}
	return depths;
}

function splitSemicolons(text) {
	const depths = bracketDepths(text);
	let out = '';
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== ';' || depths[i] > 0 || text[i + 1] !== ' ') {
			out += text[i];
			continue;
		}
		// Capitalise the first letter of what the semicolon was joining.
		const rest = text.slice(i + 2);
		const m = /^([^\p{L}]*)(\p{L})/u.exec(rest);
		if (!m) {
			out += text[i];
			continue;
		}
		out += '. ' + m[1] + m[2].toUpperCase();
		i += 1 + m[0].length;
	}
	return out;
}

let total = 0;
for (const file of files) {
	const lines = readFileSync(file, 'utf8').split('\n');
	let fenced = false;
	let changed = 0;
	const out = lines.map((line) => {
		if (isFence(line)) {
			fenced = !fenced;
			return line;
		}
		if (fenced || looksLikeCode(line)) return line;
		const next = mapProse(line, splitSemicolons);
		if (next !== line) changed++;
		return next;
	});
	if (changed > 0) writeFileSync(file, out.join('\n'));
	total += changed;
	console.log(`${file}: ${changed} line(s) changed`);
}
console.log(`${total} line(s) changed in total`);
