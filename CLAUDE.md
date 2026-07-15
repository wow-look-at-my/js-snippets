# CLAUDE.md — js-snippets

## What This Repo Is

A library of reusable ES modules. Source is TypeScript (`.ts`) plus WGSL/GLSL shaders (`.wgsl`/`.glsl`) under `src/`. [ts0](https://github.com/wow-look-at-my/ts0) compiles them to JavaScript, which deploys to GitHub Pages. **Only `.ts` and `.wgsl` files are committed — `.js` output is never checked in.**

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
├── ui/
│   ├── llms.txt           ← docs for ui modules
│   ├── perf-graph-math.ts ← pure graph math: SampleRing ring buffer, stats,
│   │                        autoRange + 1-2-5 niceTicks, min-max binning,
│   │                        value formatting
│   ├── perf-graph-math.test.ts ← colocated node:test tests for the math
│   ├── perf-graph.ts      ← <perf-graph> custom element (canvas-rendered
│   │                        stackable perf HUD; re-exports perf-graph-math)
│   ├── timeline-view-math.ts ← pure timeline math: time scales + anchored
│   │                        zoom, time tick ladder, sub-track packing,
│   │                        label fit, hit tests, category hues,
│   │                        CoverageTracker (async history)
│   ├── timeline-view-math.test.ts ← colocated node:test tests for the math
│   ├── timeline-view.ts   ← <timeline-view> custom element (canvas swimlane
│   │                        timeline; re-exports timeline-view-math)
│   └── timeline-view.css  ← its shadow-DOM styles (text import, adopted
│                            constructable stylesheet)
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
│   ├── fly-camera.ts      ← first-person fly camera on camera.ts (WASD flight,
│   │                        wheel/pinch dolly; pure flyMoveDelta / dollyDelta)
│   ├── scan.ts            ← GPU exclusive prefix scan (Blelloch) over a u32
│   │                        region of one storage buffer (element-offset
│   │                        src/dst/scratch; createScan/prepare/encode)
│   ├── scan-plan.ts       ← pure planScan level math (no .wgsl import so it
│   │                        node-tests; re-exported by scan.ts)
│   ├── *.test.ts          ← colocated node:test tests (geometry / camera /
│   │                        fly-camera / scan)
│   └── shaders/
│       ├── spd.wgsl
│       ├── sky.wgsl
│       ├── prefilter.wgsl
│       └── scan.wgsl
├── webgl2/
│   ├── llms.txt           ← docs for webgl2 modules
│   ├── program.ts         ← shader compile + link (annotateShaderLog errors)
│   │                        + injectChunk (GLSL chunk after #version)
│   ├── mesh.ts            ← VAO from typed arrays (+ chooseIndexArray)
│   ├── fbo.ts             ← float FBO (RGBA16F) with EXT_color_buffer_float
│   │                        check + ping-pong pair (createPingPong)
│   ├── video-texture.ts   ← HTMLVideoElement-tracking texture (sRGB or raw)
│   ├── fullscreen.ts      ← fullscreen-triangle pass (gl_VertexID, no VBO)
│   ├── *.test.ts          ← colocated node:test tests (program / mesh / fbo)
│   └── shaders/
│       └── fullscreen.vert.glsl
showcase/                  ← timeline-view demo page (its own nested ts0 project — NOT part of the library build; see "Showcase")
├── ts0.json               ← single-HTML-file target (entry index.html → dist/index.html; esbuild loader override for the .css text import)
├── index.html             ← page shell (title bar + two <timeline-view>s)
├── main.ts                ← wiring: styles/legend/tooltip + the live feed
├── fake-data.ts           ← deterministic fake-run generator (pure fn of absolute time)
├── page.css               ← page chrome (adopted from main.ts as a text import)
└── assets.d.ts            ← ambient *.css/*.wgsl/*.glsl decls for the nested project's own type-check
llms-header.txt            ← preamble for combined llms.txt
ts0.json                   ← ts0 config (js library target, .wgsl/.glsl text loaders)
scripts/build-llms.mjs     ← assembles dist/llms.txt after the ts0 build
package.json
tsconfig.json              ← editor/IDE only (ts0 generates its own for the build)
wgsl.d.ts                  ← ambient *.wgsl decl + @webgpu/types reference
glsl.d.ts                  ← ambient *.glsl decl (text imports, mirrors wgsl.d.ts)
css.d.ts                   ← ambient *.css decl (text imports, mirrors glsl.d.ts)
```

Modules are organized by domain (`auto-refresh/`, `editor/`, `math/`, `ui/`, `webgpu/`, `webgl2/`). The deployed URL mirrors the `src/` structure without the `src/` prefix: `src/webgpu/sky.ts` → `https://…/webgpu/sky.js`.

## Build

```sh
pnpm install
pnpm build      # ts0 build (type-check + compile src/ -> dist/) + assemble dist/llms.txt
```

The build is [ts0](https://github.com/wow-look-at-my/ts0)'s **js library target**, selected because `ts0.json`'s `entry` is the `src/` *directory*. ts0 type-checks (`tsc --noEmit`) and then compiles every `.ts` under `src/` to a parallel `.js` under `dist/`, preserving structure (`src/webgpu/sky.ts` → `dist/webgpu/sky.js`). Each file is its own esbuild entry point. Code shared between modules (e.g. `vec3`, imported by `mat4`) is deduplicated into a `dist/chunk-*.js` and imported — never copied into each output; non-shared local imports and `.wgsl`/`.glsl` shaders stay inlined. A consumer still imports a single URL — the browser fetches any shared chunk transitively. Shaders — and component stylesheets — are imported as text via the `loaders: { ".wgsl": "text", ".glsl": "text", ".css": "text" }` field in `ts0.json` (ambient decls in `wgsl.d.ts` / `glsl.d.ts` / `css.d.ts`).

ts0 also emits TypeScript declarations into `dist/` (default-on for the js library target): every compiled module gets a `.d.ts` sibling next to its `.js` (chunks and `*.test.*` excluded), deployed to Pages at the same URL with the extension swapped — nothing new is committed, `dist/` stays gitignored.

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
- **DOM/fetch/GPU-bound modules are NOT unit-tested under node** — `webgpu/shaders.ts`, `webgpu/canvas.ts`, `webgpu/context.ts`, `webgpu/buffer.ts`, `webgpu/sky.ts`, `webgpu/mip-generator.ts`, `webgpu/env-prefilter.ts`, `webgpu/hdr-loader.ts`, `webgl2/video-texture.ts`, `webgl2/fullscreen.ts` (its `.glsl` import also only resolves under the build's text loader, not `node --test`), `editor/code-editor.ts`, and `auto-refresh/` need a real browser/GPU, so they're left to manual/integration testing. Modules mixing pure + bound code are split: `webgpu/camera.ts` tests `orbitEye`/`dirFromAzEl`/`applyLookDrag` but not the DOM-bound controllers; `webgpu/fly-camera.ts` tests `flyMoveDelta`/`dollyDelta` but not `createFlyController`; `webgl2/program.ts` tests `annotateShaderLog` and `injectChunk`; `webgl2/mesh.ts` tests `chooseIndexArray`; `webgl2/fbo.ts` tests `makePingPong` but not the GL-bound `createFloatFbo`/`createPingPong`; `webgpu/scan.ts` splits its pure half into `webgpu/scan-plan.ts` (planScan level math, tested incl. a plan-driven JS emulation of the WGSL) because scan.ts's own `.wgsl` import cannot load under node — the GPU wrapper (`createScan`) is covered by consumer browser harnesses; `ui/perf-graph.ts` is DOM/canvas-bound (the `<perf-graph>` element), so its logic lives in `ui/perf-graph-math.ts` (ring buffer / stats / range / ticks / binning / formatting), which is its fully node-tested pure half; `ui/timeline-view.ts` (the `<timeline-view>` element — its `.css` text import also only resolves under the build's loader) splits its logic into `ui/timeline-view-math.ts` (scales / zoom / ticks / packing / label fit / hit tests / hues / coverage) the same way.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) runs on every push. The `build` job enables pnpm via corepack, runs `pnpm test` (type-check + `node --test`), then `pnpm build` (ts0 type-checks + compiles, then `dist/llms.txt` is assembled). A failing test fails CI. The `deploy` job (master only) `needs` the `build` job, so tests gate deploy too; it uploads `dist/` to GitHub Pages via `actions/deploy-pages`. The `showcase` job publishes the timeline demo page to buildhost per branch (see "Showcase" below); it self-gates on chart/showcase paths and succeeds as a no-op otherwise, so it never blocks the org's all-builds aggregation.

## Showcase (`showcase/`)

A live demo page for `<timeline-view>`: ONE self-contained HTML file whose
fake, local, infinite feed keeps every visual treatment of the chart on
screen — queued lead-ins, declared-wait hatching with ⧗/⏳ labels, failures,
timeouts (a consumer style-map key), cancelled runs with kill tails of
cycling sizes, instant-pip bursts, a viewport-crossing long span, packing
bursts, markers, connectors, lazy backward history with an end-of-history
boundary, plus a second compact instance demoing `--timeline-*` retheming and
auto-fit. No network: data is generated deterministically as a pure function
of absolute time (`fake-data.ts`), so live ticks, lazy history, and resyncs
always agree, and the demo never runs dry.

- **Build**: `pnpm build:showcase` → `showcase/dist/index.html` (gitignored via
  the root `dist/` pattern). `showcase/ts0.json` selects ts0's single-HTML
  target (`entry: index.html`); the component and page code are bundled and
  inlined from THIS branch's `../src/ui/`, so every branch previews its own
  chart. The `esbuild.loader` override (not `loaders`) is what makes the
  component's `.css` text import work under the HTML target — and it replaces
  the loader map of build-html's `<link>` stylesheet pass, which is why
  `page.css` is imported/adopted from `main.ts` instead of `<link>`ed.
- **Isolation**: `showcase/ts0.json` makes it a nested ts0 project, so the
  root build/type-check/test skip it entirely (library `dist/` is
  byte-identical with or without `showcase/`). Do not add `*.test.ts` here.
- **CI**: the `showcase` job in deploy.yml publishes `showcase/dist/` to
  buildhost (project `timeline-showcase`) via the org composite action
  `wow-look-at-my/buildhost/.github/actions/buildhost-publish-site@master`
  (OIDC — needs job-level `id-token: write`). Branch preview URL:
  `https://sites.pazer.build/timeline-showcase/branch/<branch>/` with `/`
  in branch names flattened to `-` (e.g. `claude/foo` → `claude-foo`).
- **Path gate**: the job publishes only when the branch's diff vs
  origin/master touches `src/ui/`, `showcase/`, or deploy.yml itself
  (master pushes always publish). The gate is in-job (a TypeScript-action
  step), NEVER a workflow-level paths filter — the same workflow runs the
  library build.
- **Post-#39 note**: the page feature-detects newer component API
  (`legendEntries`, the built-in `cancelled` style) so it builds against any
  branch's `src/ui`; rendering-side features (minimap, fullscreen, skip
  clustering, kill-tail scrims, edge fades) light up automatically once the
  bundled component has them.

## llms.txt — CRITICAL

Each module category has its own `llms.txt` alongside its source files:
- `src/auto-refresh/llms.txt` — documents the auto-refresh modules
- `src/editor/llms.txt` — documents the editor modules
- `src/math/llms.txt` — documents the math modules
- `src/ui/llms.txt` — documents the ui modules
- `src/webgpu/llms.txt` — documents the webgpu modules
- `src/webgl2/llms.txt` — documents the webgl2 modules
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
- Shaders (WGSL and GLSL) live in `src/<category>/shaders/` alongside the `.ts` that imports them; both import as text (`ts0.json` loaders, ambient decls in `wgsl.d.ts`/`glsl.d.ts`)
- Keep modules self-contained — a consumer should only need one import
