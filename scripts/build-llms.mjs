// Combine llms-header.txt + every src/**/llms.txt into dist/llms.txt.
//
// This is the one piece of the old esbuild build.ts that isn't a TypeScript
// compile: ts0 handles src/**/*.ts -> dist/**/*.js, and this script assembles
// the machine-readable docs that ship at the site root. Run it after `ts0
// build` (see the "build" npm script); it creates dist/ if needed so it also
// works standalone.
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function collectLlmsTxt(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      files.push(...collectLlmsTxt(full));
    } else if (name === "llms.txt") {
      files.push(full);
    }
  }
  return files.sort();
}

if (!existsSync("dist")) mkdirSync("dist", { recursive: true });

const parts = [];
if (existsSync("llms-header.txt")) {
  parts.push(readFileSync("llms-header.txt", "utf-8").trimEnd());
}
for (const f of collectLlmsTxt("src")) {
  parts.push(readFileSync(f, "utf-8").trimEnd());
}
writeFileSync("dist/llms.txt", parts.join("\n\n") + "\n");

console.log(`Wrote dist/llms.txt (${parts.length} section(s))`);
