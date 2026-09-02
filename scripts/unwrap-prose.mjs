// Unwrap hard-wrapped prose to one line per block, the shape ste-lint's
// hardWrap rule wants.
//
// A wrap is one author's guess at one reader's window, frozen into the file:
// it turns a two-word change into a diff that reads as a rewrite. ste-lint
// fails on it, and this does the mechanical half of the fix.
//
//   node scripts/unwrap-prose.mjs src/math/llms.txt        # rewrites in place
//   node scripts/unwrap-prose.mjs --check src/**/llms.txt  # report only
//
// ste-lint reads a run of adjacent lines as ONE block, so the fix is not just
// "join everything": two distinct items sitting next to each other still read
// as one wrapped paragraph, and joining them makes an unreadable run-on line.
// The llms.txt files carry four shapes, and each needs its own answer:
//
//   PROSE          consecutive lines at one indent  -> joined into one line
//   BARE LABEL     `Exports:` with nothing after it -> its children are items
//   ENTRY          a signature or `name — meaning`  -> one list item, with
//                                                      deeper lines joined on
//   INDENTED CODE  `const x = ...`, `import ...`    -> fenced, never joined
//
// Fenced code, headings, tables, blockquotes and HTML comments pass through
// untouched: ste-lint exempts them, and reflowing code would corrupt it.
//
// Read the diff. The shapes above are heuristics over a hand-written file,
// not a grammar, so re-run ste-lint after and read what it still reports.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const check = args[0] === '--check';
const files = check ? args.slice(1) : args;
if (files.length === 0) {
	console.error('usage: node scripts/unwrap-prose.mjs [--check] <file>...');
	process.exit(2);
}

const isFence = (l) => /^\s*(?:```|~~~)/.test(l);
const isHeading = (l) => /^\s{0,3}#{1,6}\s/.test(l);
const isSkippable = (l) => isHeading(l) || /^\s*[>|]/.test(l) || /^\s*<!--/.test(l);
const isList = (l) => /^\s*(?:[-*+]|\d+\.)\s+/.test(l);
const indentOf = (l) => /^\s*/.exec(l)[0].length;
// `Exports:` / `Types:` with nothing after the colon: a header for the
// indented items below it, not a sentence they continue.
const isBareLabel = (l) => /^\s*[A-Z][A-Za-z0-9 /_<>-]{0,40}:\s*$/.test(l);
// `Exports: create, add, ...` — a label that carries its own content.
const isLabel = (l) => /^\s*[A-Z][A-Za-z0-9 /_-]{0,30}:(\s|$)/.test(l);
// An entry under a label: `language — built-in name`, `value: string — text`,
// `tokenize(src) → Token[]`, `focus()`. Each is a sibling, never wrapped prose.
const isEntry = (l) =>
	/^\s+\S[^—]{0,44}\s+—\s/.test(l) ||
	/^\s+[A-Za-z_$][\w.$]*\s*\(.*\)\s*(?:→|->|:|$)/.test(l) ||
	/^\s+[A-Za-z_$][\w.$]*\s*:\s*\S+\s*(?:→|--|$)/.test(l);
// A line of real code sitting in the prose, indented rather than fenced.
// A bare `=>` is NOT enough: prose says "`scene(x,y,z) => distance`" and a
// type line says "SceneSDF = (x,y,z) => number". Only a statement opener
// counts.
const isCode = (l) => /^\s+(?:import|const|let|var|return|function|await)\b/.test(l) || /^\s+<\/?[a-z][\w-]*[ >]/.test(l);

function unwrap(source) {
	const lines = source.split('\n');
	const out = [];
	let fenced = false;
	let buf = null; // the logical line being built
	let bufIndent = 0;
	let bufIsList = false;
	let bufIsBareLabel = false;
	let codeRun = null; // consecutive indented code lines, fenced together

	const flushCode = () => {
		if (codeRun === null) return;
		out.push('```js', ...codeRun.map((l) => l.replace(/^\s{0,2}/, '')), '```');
		codeRun = null;
	};
	const flush = () => {
		if (buf === null) return;
		const prev = out[out.length - 1];
		// A new item straight after another still reads as one block. A list
		// item or a heading breaks the block by itself; anything else needs
		// the blank line.
		if (prev !== undefined && prev.trim() !== '' && !bufIsList && !isList(prev) && !isSkippable(prev)) out.push('');
		out.push(buf);
		buf = null;
		bufIsBareLabel = false;
	};

	for (const line of lines) {
		if (isFence(line)) {
			flush();
			flushCode();
			fenced = !fenced;
			out.push(line);
			continue;
		}
		if (fenced) {
			out.push(line);
			continue;
		}
		if (line.trim() === '' || isSkippable(line)) {
			flush();
			flushCode();
			out.push(line);
			continue;
		}
		if (isCode(line)) {
			flush();
			(codeRun ??= []).push(line.replace(/\s+$/, ''));
			continue;
		}
		flushCode();

		const indent = indentOf(line);
		const entry = isEntry(line);
		const opensItem = isList(line) || isLabel(line) || entry || (bufIsBareLabel && indent > bufIndent);
		if (buf !== null && !opensItem && indent >= bufIndent) {
			buf += ' ' + line.trim();
			continue;
		}
		flush();
		// An entry becomes a real list item: that is what makes ste-lint treat
		// it as its own block, and it is what it already was on screen.
		buf = entry ? line.replace(/^(\s*)/, '$1- ').replace(/\s+$/, '') : line.replace(/\s+$/, '');
		bufIndent = indent;
		bufIsList = isList(buf);
		bufIsBareLabel = isBareLabel(line);
	}
	flush();
	flushCode();

	// Never leave two blank lines where the source had one.
	return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

let changed = 0;
for (const file of files) {
	const before = readFileSync(file, 'utf8');
	const after = unwrap(before);
	if (before === after) continue;
	changed++;
	if (check) console.log(`would rewrite ${file}`);
	else writeFileSync(file, after);
}
console.log(check ? `${changed} file(s) would change` : `${changed} file(s) rewritten`);
