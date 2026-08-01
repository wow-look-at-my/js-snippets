# CLAUDE.md — js-snippets

## What This Repo Is

A library of reusable ES modules. Source is TypeScript (`.ts`) plus WGSL/GLSL shaders (`.wgsl`/`.glsl`) under `src/`. [ts0](https://github.com/wow-look-at-my/ts0) compiles them to JavaScript, which deploys to [buildhost](https://github.com/wow-look-at-my/buildhost) sites. **Only `.ts` and `.wgsl` files are committed — `.js` output is never checked in.**

Base URL: `https://sites.pazer.build/js-snippets/branch/library` (the legacy GitHub Pages site at `https://wow-look-at-my.github.io/js-snippets` was unpublished 2026-07-20 in the org-wide GitHub Pages shutdown — the org Actions artifact quota had already frozen its deploys at 07-15 content; see "Deploy")
Base URL: `https://sites.pazer.build/js-snippets/branch/library` — the canonical consumption URL. The site is public (anonymous reads, `Access-Control-Allow-Origin: *`), and the code-split `chunk-*.js` siblings are served next to the entry modules, so imports resolve relative to it. Consumers import modules at runtime by URL — never vendored copies, never npm. The legacy GitHub Pages site at `https://wow-look-at-my.github.io/js-snippets` was unpublished 2026-07-20 and is permanently dead (fetches fail with a CORS error and no HTTP status) — do NOT import it or reintroduce the `github.io` origin anywhere; downstream consumers' CI fails on any reference. See "Deploy".

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
│   ├── data-table-math.ts ← pure table logic: column value/text resolution,
│   │                        blank-last comparison, stable sort, the
│   │                        asc→desc→unsorted cycle, multi-group facet
│   │                        selection, stored-filter parse/serialize
│   ├── data-table-math.test.ts ← colocated node:test tests for the math
│   ├── data-table.ts      ← <data-table> custom element (declarative
│   │                        filterable/sortable table; re-exports the math)
│   ├── data-table.css     ← its shadow-DOM styles (text import)
│   ├── activity-feed-math.ts ← pure feed logic: severity/family derivation
│   │                        from a dotted kind, query + facet selection
│   ├── activity-feed-math.test.ts ← colocated node:test tests for the math
│   ├── activity-feed.ts   ← <activity-feed> custom element — a THIN WRAPPER
│   │                        over <data-table> (three columns + the kind
│   │                        badge); no table logic of its own
│   ├── activity-feed.css  ← its shadow-DOM styles, passed INTO the inner
│   │                        table via that element's styleText escape hatch
│   ├── markdown.ts        ← markdown -> DOM renderer (re-exports markdown-parse)
│   ├── markdown-parse.ts  ← its pure half: micromark/GFM -> mdast + the
│   │                        sanitizeTree safety transform + safeHref
│   ├── markdown-parse.test.ts ← colocated node:test tests (shape + safety)
│   ├── canvas-text.ts     ← multi-tier canvas text: tier derivation/selection
│   │                        + alpha-fade truncation (FadeTextPainter)
│   ├── canvas-text.test.ts ← colocated node:test tests (the pure fitting half)
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

ts0 also emits TypeScript declarations into `dist/` (default-on for the js library target): every compiled module gets a `.d.ts` sibling next to its `.js` (chunks and `*.test.*` excluded), deployed to the site at the same URL with the extension swapped — nothing new is committed, `dist/` stays gitignored.

`pnpm build` then runs `scripts/build-llms.mjs`, which combines `llms-header.txt` + all `src/**/llms.txt` files into `dist/llms.txt`.

`ui/markdown-parse.ts` is the one module with **runtime dependencies** — `mdast-util-from-markdown` + `micromark-extension-gfm` + `mdast-util-gfm` (and `@types/mdast` for types). They are bundled by the build like any other import, and esbuild code-splits them into a chunk that only the two markdown modules import, so nothing else in the library pays for them (~37 KB gzipped when you do). This is deliberate: a hand-rolled markdown parser silently flattens nested lists, drops tables, and truncates a destination containing parens into a WRONG link — correctness belongs to micromark, and what stays local is only the safety transform.

The package manager is **pnpm**, pinned via `package.json`'s `"packageManager"` field and provisioned by corepack (ships with Node — `corepack enable`), so no global install or third-party CI action is needed. Because ts0 is a git dependency that builds itself on install (its `prepare` runs `ts0`'s own build), pnpm requires its build script to be allowlisted — hence `"pnpm": { "onlyBuiltDependencies": ["ts0", "esbuild"] }` in `package.json` (`esbuild` is allowlisted too, only to silence pnpm's ignored-build-script warning; its binary already comes via optionalDependencies). This works under the pinned pnpm 10; pnpm 11 no longer reads the `pnpm` field in `package.json`, so when bumping the `packageManager` pin to 11+, move the allowlist into `pnpm-workspace.yaml`.

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
- **DOM/fetch/GPU-bound modules are NOT unit-tested under node** — `webgpu/shaders.ts`, `webgpu/canvas.ts`, `webgpu/context.ts`, `webgpu/buffer.ts`, `webgpu/sky.ts`, `webgpu/mip-generator.ts`, `webgpu/env-prefilter.ts`, `webgpu/hdr-loader.ts`, `webgl2/video-texture.ts`, `webgl2/fullscreen.ts` (its `.glsl` import also only resolves under the build's text loader, not `node --test`), `editor/code-editor.ts`, and `auto-refresh/` need a real browser/GPU, so they're left to manual/integration testing. Modules mixing pure + bound code are split: `webgpu/camera.ts` tests `orbitEye`/`dirFromAzEl`/`applyLookDrag` but not the DOM-bound controllers; `webgpu/fly-camera.ts` tests `flyMoveDelta`/`dollyDelta` but not `createFlyController`; `webgl2/program.ts` tests `annotateShaderLog` and `injectChunk`; `webgl2/mesh.ts` tests `chooseIndexArray`; `webgl2/fbo.ts` tests `makePingPong` but not the GL-bound `createFloatFbo`/`createPingPong`; `webgpu/scan.ts` splits its pure half into `webgpu/scan-plan.ts` (planScan level math, tested incl. a plan-driven JS emulation of the WGSL) because scan.ts's own `.wgsl` import cannot load under node — the GPU wrapper (`createScan`) is covered by consumer browser harnesses; `ui/perf-graph.ts` is DOM/canvas-bound (the `<perf-graph>` element), so its logic lives in `ui/perf-graph-math.ts` (ring buffer / stats / range / ticks / binning / formatting), which is its fully node-tested pure half; `ui/timeline-view.ts` (the `<timeline-view>` element — its `.css` text import also only resolves under the build's loader) splits its logic into `ui/timeline-view-math.ts` (scales / zoom / ticks / packing / label fit / hit tests / hues / coverage) the same way; `ui/canvas-text.ts` tests its pure fitting surface (deriveLabelTiers / selectTier / clipToWidth / fitTieredText) but not the canvas-bound `FadeTextPainter`; `ui/markdown.ts` is the DOM walker (createElement/createTextNode) and is not node-tested, with its logic in `ui/markdown-parse.ts` — and because that module's `sanitizeTree` runs BEFORE any node reaches the walker, the safety properties proved there hold for the rendered output too, which is the reason the sanitizing lives in the tree rather than in the renderer.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) runs on every push. The `build` job enables pnpm via corepack, runs `pnpm test` (type-check + `node --test`), then `pnpm build` (ts0 type-checks + compiles, then `dist/llms.txt` is assembled). A failing test fails CI and gates the publish (same job, later step). The `build` job then publishes `dist/` to buildhost sites via `wow-look-at-my/buildhost/.github/actions/buildhost-publish-site@master` (OIDC, project `js-snippets`, `public: 'true'` so consumers keep importing anonymously): `master` → the stable `library` site branch (the canonical base URL), any other branch → `library-<flattened-branch>` so a change is verifiable from a real URL before merge. This replaced the GitHub Pages deploy 2026-07-20 (mirroring webhook-runner#93) after the org's Actions artifact-storage quota froze Pages at its 07-15 content — the Pages site itself was unpublished the same day in the org-wide GitHub Pages shutdown, leaving buildhost as the library's only host; the `library-` prefix keeps the library sites clear of the showcase previews, which publish under the bare flattened branch name. The `showcase` job publishes the timeline demo page to buildhost per branch (see "Showcase" below); it self-gates on chart/showcase paths and succeeds as a no-op otherwise, so it never blocks the org's all-builds aggregation.

Org CI facts that govern this workflow: the org's required `all-builds` merge gate is a **commit status** posted automatically by the required-builds-manager app, which aggregates every build on the SHA itself — no job here needs to be named for it, and NO job or check may ever be named `all-builds` (the buildhost publish actions fail the whole run when anything by that name exists on the SHA; the error says to rename — if a fan-in/aggregator job is ever needed, use a neutral name like `aggregate`). The buildhost-publish-site steps require the calling job to hold `actions: read` + `checks: read` and fail closed without them — deploy.yml grants both at the workflow level and re-grants them in the `showcase` job, because a job-level `permissions:` block REPLACES the workflow-level one (the canonical explanation lives in deploy.yml's comments). Org CI also runs without GitHub Actions artifacts (the exhausted org artifact quota is what froze the old Pages deploy) — never add `actions/upload-artifact` steps; buildhost is the artifact transport.

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
  buildhost via the org composite action
  `wow-look-at-my/buildhost/.github/actions/buildhost-publish-site@master`
  (OIDC — needs job-level `id-token: write`). Branch preview URL:
  `https://sites.pazer.build/js-snippets/branch/<branch>/` with `/` in
  branch names flattened to `-` (e.g. `claude/foo` → `claude-foo`). The
  buildhost project MUST stay `js-snippets` (repo-derived): OIDC
  auto-provisioning only authorizes the repo's own project name, and the
  sites router rejects slash-namespaced names — anything else 404s with
  "project not found".
- **Path gate**: the job publishes only when the branch's diff vs
  origin/master touches `src/ui/`, `showcase/`, or deploy.yml itself
  (master pushes always publish). The gate is in-job (a TypeScript-action
  step), NEVER a workflow-level paths filter — the same workflow runs the
  library build.
- **Access — private by operator decision (2026-07-15)**: the preview is
  token-gated (`Authorization: Bearer …` or `?token=…`) because the repo is
  private, so buildhost's OIDC-auto-provisioned `js-snippets` project — and
  its sites — is private too. The operator has explicitly ruled it stays
  that way ("do not make it public, i like it the way it is"). Do NOT add
  `public: 'true'` to the showcase job's buildhost-publish-site step in
  deploy.yml — that is not a missing fix, it is a rejected option.
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
- All `webgpu/geometry.ts` generators wind triangles CCW viewed from outside (front-facing under WebGPU's default `frontFace: 'ccw'`; oracle in `geometry.test.ts`) — use `flipWinding(mesh)` for interiors or geometry drawn under a mirror transform, and a mirrored (determinant < 0) draw pass needs the opposite `frontFace`
- Shaders (WGSL and GLSL) live in `src/<category>/shaders/` alongside the `.ts` that imports them; both import as text (`ts0.json` loaders, ambient decls in `wgsl.d.ts`/`glsl.d.ts`)
- Keep modules self-contained — a consumer should only need one import
