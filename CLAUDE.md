# CLAUDE.md — js-snippets

## What This Repo Is

A library of reusable ES modules. Source is TypeScript (`.ts`) and WGSL (`.wgsl`) under `src/`. [ts0](https://github.com/wow-look-at-my/ts0) compiles them to JavaScript, which deploys to GitHub Pages. **Only `.ts` and `.wgsl` files are committed — `.js` output is never checked in.**

Base URL: `https://wow-look-at-my.github.io/js-snippets`

## Directory Layout

```
src/
├── auto-refresh/
│   ├── llms.txt           ← docs for auto-refresh modules
│   └── auto-refresh.ts
├── editor/
│   ├── llms.txt           ← docs for editor modules
│   ├── tokenizer.ts       ← byte-preserving C-like tokenizer + syntax classifier
│   ├── tokenizer.test.ts  ← colocated node:test tests for the tokenizer
│   └── code-editor.ts     ← <code-editor> custom element (re-exports tokenizer)
├── math/
│   ├── llms.txt           ← docs for math modules
│   ├── vec3.ts
│   ├── mat4.ts
│   ├── sdf.ts             ← signed-distance primitives + grid bake + soft shadow
│   ├── noise.ts           ← hash → value-noise → fbm (2D + 3D)
│   ├── sampling.ts        ← van der Corput / Hammersley + hemisphere sampling
│   ├── gaussian-kernel.ts ← linear-sampling separable Gaussian kernel builder
│   └── *.test.ts          ← colocated node:test tests (vec3 / mat4 / sdf /
│                            noise / sampling / gaussian-kernel)
├── webgpu/
│   ├── llms.txt           ← docs for webgpu modules
│   ├── hdr-loader.ts
│   ├── mip-generator.ts
│   ├── env-prefilter.ts
│   ├── geometry.ts
│   ├── buffer.ts
│   ├── context.ts
│   ├── sky.ts
│   ├── shaders.ts         ← loadShader / loadShaders (fetch shader text)
│   ├── canvas.ts          ← resizeCanvasToDisplay (HiDPI backing-store sizing)
│   ├── camera.ts          ← orbit + look cameras (orbitEye / dirFromAzEl /
│   │                        applyLookDrag / controllers)
│   ├── *.test.ts          ← colocated node:test tests (geometry / camera)
│   └── shaders/
│       ├── spd.wgsl
│       ├── sky.wgsl
│       └── prefilter.wgsl
llms-header.txt            ← preamble for combined llms.txt
ts0.json                   ← ts0 config (js library target, .wgsl text loader)
scripts/build-llms.mjs     ← assembles dist/llms.txt after the ts0 build
package.json
tsconfig.json              ← editor/IDE only (ts0 generates its own for the build)
wgsl.d.ts                  ← ambient *.wgsl decl + @webgpu/types reference
```

Modules are organized by domain (`auto-refresh/`, `editor/`, `math/`, `webgpu/`). The deployed URL mirrors the `src/` structure without the `src/` prefix: `src/webgpu/sky.ts` → `https://…/webgpu/sky.js`.

## Build

```sh
pnpm install
pnpm build      # ts0 build (type-check + compile src/ -> dist/) + assemble dist/llms.txt
```

The build is [ts0](https://github.com/wow-look-at-my/ts0)'s **js library target**, selected because `ts0.json`'s `entry` is the `src/` *directory*. ts0 type-checks (`tsc --noEmit`) and then compiles every `.ts` under `src/` to a parallel `.js` under `dist/`, preserving structure (`src/webgpu/sky.ts` → `dist/webgpu/sky.js`). Each file is its own esbuild entry point. Code shared between modules (e.g. `vec3`, imported by `mat4`) is deduplicated into a `dist/chunk-*.js` and imported — never copied into each output; non-shared local imports and `.wgsl` shaders stay inlined. A consumer still imports a single URL — the browser fetches any shared chunk transitively. WGSL is imported as text via the `loaders: { ".wgsl": "text" }` field in `ts0.json`.

`pnpm build` then runs `scripts/build-llms.mjs`, which combines `llms-header.txt` + all `src/**/llms.txt` files into `dist/llms.txt`.

The package manager is **pnpm**, pinned via `package.json`'s `"packageManager"` field and provisioned by corepack (ships with Node — `corepack enable`), so no global install or third-party CI action is needed. Because ts0 is a git dependency that builds itself on install (its `prepare` runs `ts0`'s own build), pnpm requires its build script to be allowlisted — hence `"pnpm": { "onlyBuiltDependencies": ["ts0", "esbuild"] }` in `package.json` (`esbuild` is allowlisted too, only to silence pnpm's ignored-build-script warning; its binary already comes via optionalDependencies).

ts0 is a devDependency installed from git, pinned to a **branch** (never a commit): `package.json` references `wow-look-at-my/ts0#<branch>`. **No lockfile is committed** (`package-lock.json` and `pnpm-lock.yaml` are gitignored) so nothing freezes ts0 to a SHA — `pnpm install` resolves the branch to its current HEAD every time, and ts0's `prepare` script builds the `ts0` binary on install. `tsconfig.json` is **not** used by the build — ts0 generates its own type-check config (bundler resolution). The committed `tsconfig.json` exists only so editors/IDEs match CI; keep the two in sync. `@types/node` is a devDependency so the `node:test`/`node:assert` imports in the test files type-check (see Testing).

## Testing

```sh
pnpm test       # ts0 test: type-check the whole project, then run node --test
```

`pnpm test` runs ts0's **test** command, which type-checks the project (sources **and** tests) and then runs every `*.test.ts` under Node's built-in test runner (`node --experimental-strip-types --test`). Tests therefore run straight off the `.ts` source — there is no separate build step before testing.

Conventions:

- **Tests are colocated** next to the module they cover as `src/<category>/<name>.test.ts` (e.g. `src/math/mat4.test.ts`). The default ts0 test glob is `**/*.test.ts`.
- **The js-library build SKIPS `*.test.*`**, so tests never pollute `dist/` (verify with `find dist -name '*.test.js'` — it must be empty).
- Each test file uses `import { test } from 'node:test'` + `import assert from 'node:assert/strict'`, imports the **source** module directly with the `.ts` extension (e.g. `import { … } from './mat4.ts'`), and uses `import type { … }` for type-only symbols — Node's strip-types loader elides `import type` but would fail to import a type as a value at runtime.
- Source modules import sibling modules with the `.ts` extension on **value** imports (e.g. `import { lookAt } from '../math/mat4.ts'`) and `import type` for type-only ones. Both esbuild (the build) and Node's runtime ESM resolver accept this; an extensionless **value** import resolves under esbuild but NOT under `node --test`, so keep the extension.
- Pure/algorithmic modules are unit-tested here; several tests are ports of the proven `smoke.mjs` oracles from the `scratch` repo (`sdf` from distance-field-shadows, `gaussian-kernel` from local-contrast).
- **DOM/fetch/GPU-bound modules are NOT unit-tested under node** — `webgpu/shaders.ts`, `webgpu/canvas.ts`, `webgpu/context.ts`, `webgpu/buffer.ts`, `webgpu/sky.ts`, `webgpu/mip-generator.ts`, `webgpu/env-prefilter.ts`, `webgpu/hdr-loader.ts`, `editor/code-editor.ts`, and `auto-refresh/` need a real browser/GPU, so they're left to manual/integration testing. `webgpu/camera.ts` is split: the pure helpers (`orbitEye`/`dirFromAzEl`/`applyLookDrag`) are tested; `createOrbitController` and `createLookController` are DOM-bound and are not.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) runs on every push. The `build` job enables pnpm via corepack, runs `pnpm test` (type-check + `node --test`), then `pnpm build` (ts0 type-checks + compiles, then `dist/llms.txt` is assembled). A failing test fails CI. The `deploy` job (master only) `needs` the `build` job, so tests gate deploy too; it uploads `dist/` to GitHub Pages via `actions/deploy-pages`.

## llms.txt — CRITICAL

Each module category has its own `llms.txt` alongside its source files:
- `src/auto-refresh/llms.txt` — documents the auto-refresh modules
- `src/editor/llms.txt` — documents the editor modules
- `src/math/llms.txt` — documents the math modules
- `src/webgpu/llms.txt` — documents the webgpu modules
- `llms-header.txt` — preamble (repo description, base URL, usage example)

The build combines these into a single `dist/llms.txt` deployed to the site root.

**These files MUST be kept in sync with the actual modules at ALL times.**

When you add, remove, rename, or change the API of any module:
1. Update the `llms.txt` in that module's folder
2. This is not optional — it is part of completing the task

If you are reading any `llms.txt` and notice ANY inaccuracy, missing module, wrong function signature, stale description, or other inconsistency — **fix it immediately**, even if you didn't cause the problem. Seeing a problem and not fixing it is the same as introducing it yourself.

## Adding a New Module

1. Create `src/<category>/<name>.ts` (and `shaders/<name>.wgsl` if needed)
2. **Update `src/<category>/llms.txt`** with the new module's path, exports, and description
3. If it's a new category, create a new `src/<category>/llms.txt`
4. **Add a colocated `src/<category>/<name>.test.ts`** (`node:test`) covering the module's pure surface — import the source with the `.ts` extension, `import type` for type-only symbols (see Testing). DOM/fetch/GPU-bound modules can skip node unit tests; note the gap rather than forcing a fake.
5. Run `pnpm test` (type-check + tests) and `pnpm build` (type-check + compile) to verify both
6. Commit and push

## Conventions

- All math functions return new values — no mutation
- Mat4 is column-major Float32Array(16), perspective uses WebGPU clip-Z [0,1]
- WebGPU modules assume `rgba32float` textures unless documented otherwise
- WGSL shaders live in `src/<category>/shaders/` alongside the `.ts` that imports them
- Keep modules self-contained — a consumer should only need one import
