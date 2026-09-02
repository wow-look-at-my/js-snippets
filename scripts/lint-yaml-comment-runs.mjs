// Local mirror of the org's yaml-comment-block gate
// (wow-look-at-my/actions@yaml-comment-block#latest, pulled in by
// go-toolchain's common checks): at most ONE comment-only line in a row in
// a workflow file. Prose that needs a paragraph belongs in CLAUDE.md, not
// in the YAML.
//
// It exists so a comment edit is checked before the push rather than by a
// CI round trip.
//
//   node scripts/lint-yaml-comment-runs.mjs [files...]   # default: .github/workflows/*.yml
import { readFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.length > 0
	? args
	: readdirSync('.github/workflows').filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`);

let bad = 0;
for (const file of files) {
	const lines = readFileSync(file, 'utf8').split('\n');
	let run = 0;
	const flush = (end) => {
		if (run > 1) {
			console.error(`${file}: ${run} comment lines in a row (lines ${end - run + 1}-${end}) — the limit is 1.`);
			bad++;
		}
		run = 0;
	};
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*#/.test(lines[i])) run++;
		else flush(i);
	}
	flush(lines.length);
}

if (bad > 0) {
	console.error(`${bad} comment block(s) too long, across ${files.length} scanned file(s)`);
	process.exit(1);
}
console.log(`ok — no comment run over 1 line in ${files.length} file(s)`);
