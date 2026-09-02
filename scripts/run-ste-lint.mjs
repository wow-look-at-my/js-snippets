// Run the org's ste-lint action locally, against the same files CI checks.
//
// ste-lint (wow-look-at-my/actions@ste-lint#latest) is a GitHub Action, not a
// CLI: it reads its inputs from INPUT_* and writes findings as workflow
// commands. This drives the action's own bundle with those variables set, so
// a local run and the CI job apply the identical rules -- no second
// implementation of the checks to drift.
//
//   node scripts/run-ste-lint.mjs               # the files CI checks
//   node scripts/run-ste-lint.mjs 'docs/**/*.md'
//
// It clones the action's own tag on first use (cached under the scratch dir
// named by STE_LINT_DIR, default ./.ste-lint), then executes dist/index.js.
// Exits non-zero when the action does.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// The same set the CI job checks: the docs tree, every category's llms.txt,
// and the preamble they are assembled with.
const DEFAULT_FILES = 'docs/**/*.md src/**/llms.txt llms-header.txt';

const files = process.argv.slice(2).join(' ') || DEFAULT_FILES;
const dir = resolve(process.env.STE_LINT_DIR ?? '.ste-lint');
const ref = process.env.STE_LINT_REF ?? 'ste-lint#latest';

if (!existsSync(resolve(dir, 'dist/index.js'))) {
	mkdirSync(dir, { recursive: true });
	console.error(`ste-lint: fetching ${ref} into ${dir}`);
	execFileSync('git', ['clone', '--depth', '1', '--branch', ref, 'https://github.com/wow-look-at-my/actions', dir], {
		stdio: ['ignore', 'ignore', 'inherit'],
	});
}

const res = spawnSync(process.execPath, [resolve(dir, 'dist/index.js')], {
	stdio: 'inherit',
	env: { ...process.env, INPUT_FILES: files },
});
process.exit(res.status ?? 1);
