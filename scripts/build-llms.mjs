// Combine llms-header.txt + every src/**/llms.txt into dist/llms.txt.
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
