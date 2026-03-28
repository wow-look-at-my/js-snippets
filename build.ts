import { build } from 'esbuild';
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function collectEntries(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...collectEntries(full));
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      entries.push(full);
    }
  }
  return entries;
}

function collectLlmsTxt(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      files.push(...collectLlmsTxt(full));
    } else if (name === 'llms.txt') {
      files.push(full);
    }
  }
  return files.sort();
}

const entryPoints = collectEntries('src');

await build({
  entryPoints,
  outdir: 'dist',
  outbase: 'src',
  format: 'esm',
  bundle: true,
  loader: { '.wgsl': 'text' },
});

// Combine llms-header.txt + all src/**/llms.txt into dist/llms.txt
if (!existsSync('dist')) mkdirSync('dist');
const parts: string[] = [];
if (existsSync('llms-header.txt')) {
  parts.push(readFileSync('llms-header.txt', 'utf-8').trimEnd());
}
for (const f of collectLlmsTxt('src')) {
  parts.push(readFileSync(f, 'utf-8').trimEnd());
}
writeFileSync('dist/llms.txt', parts.join('\n\n') + '\n');

console.log(`Built ${entryPoints.length} module(s) → dist/`);
