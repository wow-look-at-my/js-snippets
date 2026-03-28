import { build } from 'esbuild';
import { readdirSync, statSync } from 'node:fs';
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

const entryPoints = collectEntries('src');

await build({
  entryPoints,
  outdir: 'dist',
  outbase: 'src',
  format: 'esm',
  bundle: true,
  loader: { '.wgsl': 'text' },
});

console.log(`Built ${entryPoints.length} module(s) → dist/`);
