# CLAUDE.md — js-snippets

## What This Repo Is

A library of reusable ES modules. Source is TypeScript (`.ts`) and WGSL (`.wgsl`) under `src/`. A build step compiles to JavaScript and deploys to GitHub Pages. **Only `.ts` and `.wgsl` files are committed — `.js` output is never checked in.**

Base URL: `https://wow-look-at-my.github.io/js-snippets`

## Directory Layout

```
src/
├── math/
│   ├── llms.txt           ← docs for math modules
│   ├── vec3.ts
│   └── mat4.ts
├── webgpu/
│   ├── llms.txt           ← docs for webgpu modules
│   ├── hdr-loader.ts
│   ├── mip-generator.ts
│   ├── env-prefilter.ts
│   ├── geometry.ts
│   ├── buffer.ts
│   ├── context.ts
│   ├── sky.ts
│   └── shaders/
│       ├── spd.wgsl
│       ├── sky.wgsl
│       └── prefilter.wgsl
llms-header.txt            ← preamble for combined llms.txt
build.ts                   ← esbuild orchestration (run with ts-node)
package.json
tsconfig.json
wgsl.d.ts                  ← type declarations for .wgsl imports
```

Modules are organized by domain (`math/`, `webgpu/`). The deployed URL mirrors the `src/` structure without the `src/` prefix: `src/webgpu/sky.ts` → `https://…/webgpu/sky.js`.

## Build

```sh
npm ci
npx tsc --noEmit      # type-check only
npx ts-node build.ts  # compile to dist/
```

esbuild handles TypeScript compilation and inlines `.wgsl` files as strings via `--loader:.wgsl=text`. Each `.ts` file under `src/` is a separate entry point — no bundling across modules.

The build also combines `llms-header.txt` + all `src/**/llms.txt` files into `dist/llms.txt`.

`tsconfig.json` is for type-checking only (`tsc --noEmit`), not compilation.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) runs on every push. The `build` job type-checks and compiles. The `deploy` job (master only) uploads `dist/` to GitHub Pages via `actions/deploy-pages`.

## llms.txt — CRITICAL

Each module category has its own `llms.txt` alongside its source files:
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
4. Run `npx tsc --noEmit` to verify types
5. Run `npx ts-node build.ts` to verify the build
6. Commit and push

## Conventions

- All math functions return new values — no mutation
- Mat4 is column-major Float32Array(16), perspective uses WebGPU clip-Z [0,1]
- WebGPU modules assume `rgba32float` textures unless documented otherwise
- WGSL shaders live in `src/<category>/shaders/` alongside the `.ts` that imports them
- Keep modules self-contained — a consumer should only need one import
