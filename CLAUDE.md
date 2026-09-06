# CLAUDE.md — js-snippets

## What This Repo Is

A library of reusable ES modules. Source is TypeScript (`.ts`) plus WGSL/GLSL shaders (`.wgsl`/`.glsl`) under `src/`. [ts0](https://github.com/wow-look-at-my/ts0) compiles them to JavaScript, which deploys to [buildhost](https://github.com/wow-look-at-my/buildhost) sites. **Only `.ts` and `.wgsl` files are committed — `.js` output is never checked in.**

Base URL: `https://sites.pazer.build/js-snippets/branch/library` — the canonical consumption URL. The site is public (anonymous reads, `Access-Control-Allow-Origin: *`), and the code-split `chunk-*.js` siblings are served next to the entry modules, so imports resolve relative to it. Consumers import modules at runtime by URL — never vendored copies, never npm. The legacy GitHub Pages site at `https://wow-look-at-my.github.io/js-snippets` was unpublished 2026-07-20 and is permanently dead (fetches fail with a CORS error and no HTTP status) — do NOT import it or reintroduce the `github.io` origin anywhere. Downstream consumers' CI fails on any reference. See "Deploy".

## Directory Layout

```
src/
├── apng/
│   ├── llms.txt           ← docs for apng modules
│   ├── png.ts             ← PNG primitives: CRC-32, chunk framing, row filters
│   ├── diff.ts            ← dirty rects, threshold, the OVER/SOURCE payloads
│   ├── palette.ts         ← exact (never lossy) <=256-colour palette detection
│   ├── encoder.ts         ← the size-optimising APNG encoder itself
│   ├── raster.ts          ← pure fit maths + OffscreenCanvas draw, so a
│   │                        consumer can hand the worker ImageBitmaps
│   ├── worker.ts          ← the off-main-thread halves: worker body + client
│   └── *.test.ts          ← colocated node:test tests (png / diff / palette /
│                            raster / encoder — the encoder's oracle is a
│                            decoder)
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
│   ├── color.ts           ← shared canvas colour primitives: category hue
│   │                        hashing + jitter, oklch/hsl category colour, the
│   │                        uniform dim transform, the label halo
│   ├── hit-test.ts        ← shared pointer hit shapes: HitRect, rect and
│   │                        polyline tests, distSqToSegment
│   ├── dag-view-math.ts   ← pure layered (Sugiyama) DAG layout: cycle
│   │                        breaking, layering, crossing reduction,
│   │                        coordinates, routing, viewport, hit tests,
│   │                        reachability
│   ├── dag-view-math.test.ts ← colocated node:test tests for the layout
│   ├── dag-view.ts        ← <dag-view> custom element (canvas pan/zoom
│   │                        dependency graph; re-exports dag-view-math)
│   ├── dag-view.css       ← its shadow-DOM styles (text import)
│   ├── markdown.ts        ← markdown -> DOM renderer (re-exports markdown-parse)
│   ├── markdown-parse.ts  ← its pure half: micromark/GFM -> mdast + the
│   │                        sanitizeTree safety transform + safeHref
│   ├── markdown-parse.test.ts ← colocated node:test tests (shape + safety)
│   ├── canvas-text.ts     ← multi-tier canvas text: tier derivation/selection
│   │                        + alpha-fade truncation (FadeTextPainter)
│   ├── canvas-text.test.ts ← colocated node:test tests (the pure fitting half)
│   ├── combobox-logic.ts  ← pure combobox logic: UA/force activation gate,
│   │                        enabled-option navigation, type-ahead matching,
│   │                        popup placement math
│   ├── combobox-logic.test.ts ← colocated node:test tests for the logic
│   ├── combobox.ts        ← <combo-box> + installSelectFallback: in-page
│   │                        popup replacement for broken native <select>
│   │                        dropdowns (re-exports combobox-logic)
│   ├── combobox.css       ← its injected stylesheet (text import; --cb-*
│   │                        custom-property theming)
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
│   ├── timeline-view.css  ← its shadow-DOM styles (text import, adopted
│   │                        constructable stylesheet)
│   ├── timeline-wire.ts   ← columnar WIRE FORMAT for feeding the chart a big
│   │                        feed cheaply (schema-driven decode: the caller
│   │                        names its own columns) + the one-chunk-per-frame
│   │                        driver (runSliced/nextFrame). Decodes a LAYOUT,
│   │                        never a vocabulary
│   └── timeline-wire.test.ts ← colocated node:test tests; decodes the GOLDEN
│                            payload timelinewire/ (the Go encoder) writes
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
timelinewire/              ← the ENCODER half of ui/timeline-wire, in Go. A NESTED go module (github.com/wow-look-at-my/js-snippets/timelinewire) so the repo root stays TypeScript and a Go producer pulls only this
├── go.mod
├── wire.go                ← Schema/Page/Encode: the same schema-driven layout, encoding side
├── decode.go              ← Decode: the inverse, so a Go producer reads its own payload instead of writing a second reader
├── wire_test.go           ← asserts the encoder still emits testdata/golden-v1.b64 (`go test -update ./...` rewrites it)
├── decode_test.go         ← decodes that same fixture + round-trip + corruption rejection
└── testdata/golden-v1.b64 ← THE contract: written here, decoded by src/ui/timeline-wire.test.ts
RELEASES: every master push that changes `timelinewire/` cuts the next `timelinewire/vX.Y.Z` tag (deploy.yml's `go` job). A Go consumer runs `go get github.com/wow-look-at-my/js-snippets/timelinewire@latest` and pins a RELEASE -- a pseudoversion copies a commit sha that says nothing and rots when the branch it came from is deleted.
showcase/                  ← the COMPONENT GALLERY: one section per DOM-bound ui/ component, published per branch. Its own nested ts0 project — NOT part of the library build; see "Showcase"
├── ts0.json               ← single-HTML-file target (entry index.html → dist/index.html; esbuild loader override for the .css text import)
├── index.html             ← page shell: header + table of contents + one <section> per component
├── main.ts                ← gallery entry: adopts page.css, mounts the static sections, owns the live <timeline-view> feed
├── data-table-demo.ts     ← <data-table> section (three instances: full / minimal / filtered-to-nothing)
├── activity-feed-demo.ts  ← <activity-feed> section (kinds the severity rules know, and kinds they do not)
├── dag-view-demo.ts       ← <dag-view> section (five instances: the build graph with every node state, a cycle, LR, a retheme, and empty)
├── fake-data.ts           ← deterministic fake-run generator (pure fn of absolute time) + mulberry32, shared by every section
├── page.css               ← page chrome (adopted from main.ts as a text import)
└── assets.d.ts            ← ambient *.css/*.wgsl/*.glsl decls for the nested project's own type-check
docs/testing-boundaries.md ← which modules are node-tested, which are not and why, and what covers the gap. Read it before adding a module that mixes pure and bound code
docs/timeline/zoom-out-never-merges.md ← THE rule for dense instants: N discrete events never render as one contiguous shape; zooming out drops marks, never fuses them. Names the two failures that produced it and where it is enforced
docs/timeline/span-9patch.md ← why spans stay path-drawn while pips are sprited: the 9-patch only wins when every bar is snapped to whole device pixels, which the single global rounding step forbids
docs/timeline-view.png     ← the README's <timeline-view> picture. Captured from the built showcase by scripts/screenshot-showcase.mjs (playwright + the preinstalled chromium), so it is the REAL component and cannot drift; regenerate after a visual change: pnpm build:showcase && node scripts/screenshot-showcase.mjs
scripts/screenshot-showcase.mjs ← that capture (fails on any page error rather than writing a half-upgraded chart)
.github/workflows/deploy.yml `ste-lint` job ← the org's ASD-STE100 mechanical-subset prose gate, `wow-look-at-my/actions@ste-lint#latest`, over the docs and the llms.txt files this repo serves. Six rules FAIL (hard-wrapped paragraphs, semicolons, sentences over 25 words, should/shall/could/might/would, comma splices, contractions); everything else warns. Run it through the action, never a local re-driver. STILL TO CONVERT (that count is real failures, not an exemption): src/ui/llms.txt — 1805 across 1591 lines, three quarters of them the hard-wrap rule. Add it to the job's `files` input once it passes
scripts/check-dag-view.ts ← browser check for `<dag-view>` on the REAL element: upgrade, actual painted pixels, the cycle/rejected-edge reporting, hover tooltips, click selection, the arrow-key graph walk, the toolbar, and that search highlights rather than filters. NONE of this is reachable under `node --test`, and it also writes the reference screenshots. Run: `pnpm build:showcase && NODE_PATH=/opt/node22/lib/node_modules node scripts/check-dag-view.ts`. It is TypeScript, and node strips the types to run it: `ts0 build` type-checks `scripts/` as well as `src/`, so it imports `DagViewElement` as a type and a call this script gets wrong fails the BUILD instead of failing in the browser. The playwright surface it drives is typed locally, because playwright is installed globally (NODE_PATH) rather than depended on here
scripts/check-timeline-bounds.mjs ← browser check for `minTime`/`maxTime` on the REAL element (drives pointer/wheel input against the built showcase; the math under it is node-tested, these are the element-level properties nothing under `node --test` can reach). Run: `pnpm build:showcase && NODE_PATH=/opt/node22/lib/node_modules node scripts/check-timeline-bounds.mjs`
bench/bench-gl.html        ← how many instant pips one frame can draw and still hold 30fps, per draw method: canvas2d path (batched / one each), canvas2d sprite blit, GL instanced quads, GL vert+index 4v/6i, GL path 12v/30i (the diamond as triangles, no texture), and spans path vs 9-patch. Run: `NODE_PATH=/opt/node22/lib/node_modules node scripts/run-bench.mjs bench/bench-gl.html`. It prints the GL renderer — a GPU-less runner falls back to SwiftShader and every GL row is then a software rasterizer's, so never quote one without it. On an M1 the ordering is GL quads >800k > sprite blit 30k > canvas2d path 4.6k markers/frame; the software numbers invert that, which is why no drawing decision may be made from a SwiftShader run. That M1 run predates the per-method size caps and the per-round ramp deadline, so its GL rows are FLOORS (they pressed against a shared 1M cap, and one resolved at 120fps without ever converging) — re-run before quoting a GL ceiling. For the span rows only the sub-pixel 9-patch variants mean anything; see docs/timeline/span-9patch.md
llms-header.txt            ← preamble for combined llms.txt
ts0.json                   ← ts0 config (js library target, .wgsl/.glsl text loaders)
scripts/build-llms.mjs     ← assembles dist/llms.txt after the ts0 build
package.json
tsconfig.json              ← editor/IDE only (ts0 generates its own for the build)
wgsl.d.ts                  ← ambient *.wgsl decl + @webgpu/types reference
glsl.d.ts                  ← ambient *.glsl decl (text imports, mirrors wgsl.d.ts)
css.d.ts                   ← ambient *.css decl (text imports, mirrors glsl.d.ts)
```

Modules are organized by domain (`apng/`, `auto-refresh/`, `editor/`, `math/`, `ui/`, `webgpu/`, `webgl2/`). The deployed URL mirrors the `src/` structure without the `src/` prefix: `src/webgpu/sky.ts` → `https://…/webgpu/sky.js`.

## Build

```sh
pnpm install
pnpm build      # ts0 build (type-check + compile src/ -> dist/) + assemble dist/llms.txt
```

The build is [ts0](https://github.com/wow-look-at-my/ts0)'s **js library target**. `ts0.json`'s `entry` is the `src/` *directory*, and that setting selects the target. ts0 type-checks the project with `tsc --noEmit`. It then compiles every `.ts` under `src/` to a parallel `.js` under `dist/`, preserving structure (`src/webgpu/sky.ts` → `dist/webgpu/sky.js`). Each file is its own esbuild entry point. Code shared between modules (e.g. `vec3`, imported by `mat4`) is deduplicated into a `dist/chunk-*.js` and imported — never copied into each output. Non-shared local imports and `.wgsl`/`.glsl` shaders stay inlined. A consumer still imports a single URL. The browser fetches any shared chunk transitively. Shaders and component stylesheets are imported as text via the `loaders: { ".wgsl": "text", ".glsl": "text", ".css": "text" }` field in `ts0.json` (ambient decls in `wgsl.d.ts` / `glsl.d.ts` / `css.d.ts`).

ts0 also emits TypeScript declarations into `dist/` (default-on for the js library target). Every compiled module gets a `.d.ts` sibling next to its `.js` (chunks and `*.test.*` excluded). Each sibling deploys to the site at the same URL with the extension swapped. Nothing new is committed, and `dist/` stays gitignored.

`pnpm build` then runs `scripts/build-llms.mjs`, which combines `llms-header.txt` + all `src/**/llms.txt` files into `dist/llms.txt`.

`ui/markdown-parse.ts` is the one module with **runtime dependencies** — `mdast-util-from-markdown` + `micromark-extension-gfm` + `mdast-util-gfm` (and `@types/mdast` for types). The build bundles them like any other import. Esbuild code-splits them into a chunk that only the markdown modules import, so nothing else in the library pays for them (~37 KB gzipped for a consumer that does). This is deliberate. A hand-rolled markdown parser silently flattens nested lists, drops tables, and truncates a destination containing parens into a WRONG link. Correctness belongs to micromark, and what stays local is only the safety transform.

The package manager is **pnpm**, pinned via `package.json`'s `"packageManager"` field. Corepack provisions it (ships with Node — `corepack enable`). So no global install or third-party CI action is needed. ts0 is a git dependency that builds itself on install (its `prepare` runs `ts0`'s own build). Because of that, pnpm requires its build script to be allowlisted. Hence `"pnpm": { "onlyBuiltDependencies": ["ts0", "esbuild"] }` in `package.json` (`esbuild` is allowlisted too, only to silence pnpm's ignored-build-script warning. Its binary already comes via optionalDependencies). This works under the pinned pnpm 10. A newer major pnpm release no longer reads the `pnpm` field in `package.json`. So when bumping the `packageManager` pin past that release, move the allowlist into `pnpm-workspace.yaml`.

ts0 is a devDependency installed from git, pinned to a **branch** (never a commit): `package.json` references `wow-look-at-my/ts0#<branch>`. **No lockfile is committed** (`package-lock.json` and `pnpm-lock.yaml` are gitignored). Nothing freezes ts0 to a SHA. `pnpm install` resolves the branch to its current HEAD every time. ts0's `prepare` script then builds the `ts0` binary on install. `tsconfig.json` is **not** used by the build — ts0 generates its own type-check config (bundler resolution). The committed `tsconfig.json` exists only so editors/IDEs match CI. Keep the two in sync. `@types/node` is a devDependency so the `node:test`/`node:assert` imports in the test files type-check (see Testing).

## Testing

```sh
pnpm test       # ts0 test: type-check the whole project, then run node --test
```

`pnpm test` runs ts0's **test** command, which type-checks the project (sources **and** tests) and then runs every `*.test.ts` under Node's built-in test runner (`node --experimental-strip-types --test`). Tests therefore run straight off the `.ts` source — there is no separate build step before testing.

Conventions:

- **Tests are colocated** next to the module they cover as `src/<category>/<name>.test.ts` (e.g. `src/math/mat4.test.ts`). The default ts0 test glob is `**/*.test.ts`.
- **The js-library build SKIPS `*.test.*`**, so tests never pollute `dist/` (verify with `find dist -name '*.test.js'` — it must be empty).
- Each test file uses `import { test } from 'node:test'` + `import assert from 'node:assert/strict'`, and imports the **source** module directly with the `.ts` extension (e.g. `import { … } from './mat4.ts'`). It uses `import type { … }` for type-only symbols. Node's strip-types loader elides `import type` but fails to import a type as a value at runtime.
- Source modules import sibling modules with the `.ts` extension on **value** imports (e.g. `import { lookAt } from '../math/mat4.ts'`) and `import type` for type-only ones. Both esbuild (the build) and Node's runtime ESM resolver accept this. An extensionless **value** import resolves under esbuild but NOT under `node --test`, so keep the extension.
- Pure/algorithmic modules are unit-tested here. Several tests are ports of the proven `smoke.mjs` oracles from the `scratch` repo (`sdf` from distance-field-shadows, `gaussian-kernel` from local-contrast).
- **DOM/fetch/GPU-bound modules are NOT unit-tested under node.** The rule is to SPLIT the module, never to fake the environment. The logic moves to a sibling `-math`/`-logic`/`-parse` module and is tested exhaustively. The bound half is left to a browser harness. Which module is on which side of that line, and what covers the gap, is in `docs/testing-boundaries.md` (the `showcase/` gallery, `scripts/check-dag-view.ts`, `scripts/check-timeline-bounds.mjs`).

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) runs on every push. The `build` job enables pnpm via corepack, runs `pnpm test` (type-check + `node --test`), then `pnpm build` (ts0 type-checks + compiles, then `dist/llms.txt` is assembled). A failing test fails CI and gates the publish (same job, later step). The `build` job then publishes `dist/` to buildhost sites via `wow-look-at-my/buildhost/.github/actions/buildhost-publish-site@master` (OIDC, project `js-snippets`, `public: 'true'` so consumers keep importing anonymously). `master` publishes to the stable `library` site branch (the canonical base URL). Any other branch publishes to `library-<flattened-branch>`. So a change is verifiable from a real URL before merge. This replaced the GitHub Pages deploy on 2026-07-20 (mirroring webhook-runner#93). The org's Actions artifact-storage quota had frozen Pages at its 07-15 content. The Pages site itself was unpublished the same day, in the org-wide GitHub Pages shutdown, leaving buildhost as the library's only host. The `library-` prefix keeps the library sites clear of the showcase previews, which publish under the bare flattened branch name. The `showcase` job publishes the component gallery to buildhost per branch (see "Showcase" below). It self-gates on `src/ui/`+`showcase/` paths, watched WHOLE since every UI component has a gallery section. It succeeds as a no-op otherwise, so it never blocks the org's all-builds aggregation.

Org CI facts govern this workflow. The org's required `all-builds` merge gate is a **commit status**. The required-builds-manager app posts it automatically, and it aggregates every build on the SHA itself. No job here needs a name for it. NO job or check may ever be named `all-builds`. The buildhost publish actions fail the whole run when anything by that name exists on the SHA. The error tells you to rename it. If a fan-in/aggregator job is ever needed, use a neutral name like `aggregate`. The buildhost-publish-site steps require the calling job to hold `actions: read` + `checks: read`. They fail closed without them. deploy.yml grants both at the workflow level. It re-grants them in the `showcase` job too, because a job-level `permissions:` block REPLACES the workflow-level one. That, and the rest of this paragraph, is why those grants are there. Deploy.yml's own comments cannot say so, because go-toolchain's common checks include `yaml-comment-block`. That check fails the build on more than ONE comment-only line in a row in a workflow file. So workflow prose belongs here, not in the YAML. Org CI also runs without GitHub Actions artifacts, because the exhausted org artifact quota is what froze the old Pages deploy. Never add `actions/upload-artifact` steps. Buildhost is the artifact transport.

## Showcase (`showcase/`) — the component gallery

**WHAT IT IS FOR.** Every DOM-bound component in `src/ui/` is deliberately NOT node-tested (see "Testing"). The pure half is unit-tested. The ELEMENT is not, because nothing under `node --test` can render one. The gallery is where they are actually exercised — ONE self-contained HTML file, published per branch. So a change is verifiable from a real URL before it merges. It is not a marketing page. It is not a timeline demo that grew. It is the only place a rendering regression can be caught at all.

**ADDING A UI COMPONENT MEANS ADDING A SECTION HERE.** That is the contract, not a nicety. A section's job is to put the treatments that are EASY TO GET WRONG on screen at once — the states a happy-path instance hides. Existing sections show the pattern. Blank cells must sort last in both directions. A display string can sort differently from its real value. A filter-hides-everything empty state must not read as "no data". A component can have no listener wired (bar hidden, rows out of the tab order). Some kinds appear that no severity rule has ever heard of.

**A type-only import registers nothing.** A demo that references a component only as a TYPE (`el as DataTableElement`) has its import ELIDED. So the module never evaluates. The element never upgrades. The section sits on its light-DOM "loading…" line, with the build green throughout. Every demo module therefore carries an explicit side-effect import (`import '../src/ui/data-table.ts';`) next to its `import type`. This is exactly the class of failure the gallery exists to surface. And it is invisible to `pnpm build`.

Sections, in page order:

- **`<timeline-view>`** — the live one: a fake, local, infinite feed keeping every visual treatment of the chart on screen (queued lead-ins, declared-wait hatching with ⧗/⏳ labels, failures, timeouts as a consumer style-map key, cancelled runs with kill tails of cycling sizes, instant-pip bursts, a viewport-crossing long span, packing bursts, markers, connectors, lazy backward history with an end-of-history boundary). A second compact instance demos `--timeline-*` retheming and auto-fit. The STATIC-BOUNDS instances add two more: `#floor` (`minTime` only, on the same live feed, so a hard left stop and a clock-following right edge are visibly independent), and `#static` (both bounds, its own one-shot closed window — no now line, no pill, no follow, and bars still running at the end stop exactly at it). Data is generated deterministically as a pure function of absolute time (`fake-data.ts`). So live ticks, lazy history, and resyncs always agree. The demo never runs dry.
- **`<data-table>`** (`data-table-demo.ts`) — the instances are full (query + chip groups + sorting + keyboard-reachable rows), minimal, and filtered-to-nothing. Fixed-seed fixture. So a visual change is a real change and never the generator reshuffling.
- **`<activity-feed>`** (`activity-feed-demo.ts`) — a `<data-table>` underneath. The fixture mixes kinds the severity rules claim with kinds no rule mentions, which is the derived-not-enumerated claim made visible.
- **`<dag-view>`** (`dag-view-demo.ts`) — the instances cover a set of cases. A build graph carries every node state in the style map, plus a state no rule mentions. It adds a node with no category, and a label far too long for its box. It adds a long edge that must bend around several layers. It adds edges the graph cannot draw — an unknown target and a self-loop — which the notice strip must name. Then a three-service CYCLE follows. That is the case a layered drawing cannot render without breaking something. What is checked there is that the broken edge is still drawn, still points the true way, and is announced. Then the same graph appears in `LR`. So an axis bug shows up as a difference between the pictures on one page. A `--dag-*` retheme follows. Then an empty one. The fixture is hand-written, not generated. Every node carries a specific case, and a random one loses them.

No network anywhere: every fixture is generated locally.

- **Build**: `pnpm build:showcase` → `showcase/dist/index.html` (gitignored via the root `dist/` pattern). `showcase/ts0.json` selects ts0's single-HTML target (`entry: index.html`). The component and page code are bundled and inlined from THIS branch's `../src/ui/`, so every branch previews its own chart. The `esbuild.loader` override (not `loaders`) is what makes the component's `.css` text import work under the HTML target. It replaces the loader map of build-html's `<link>` stylesheet pass. That is why `page.css` is imported/adopted from `main.ts` instead of `<link>`ed.
- **Isolation**: `showcase/ts0.json` makes it a nested ts0 project, so the root build/type-check/test skip it entirely (library `dist/` is byte-identical with or without `showcase/`). Do not add `*.test.ts` here.
- **CI**: the `showcase` job in deploy.yml publishes `showcase/dist/` to buildhost via the org composite action `wow-look-at-my/buildhost/.github/actions/buildhost-publish-site@master` (OIDC — needs job-level `id-token: write`). Branch preview URL: `https://sites.pazer.build/js-snippets/branch/<branch>/` with `/` in branch names flattened to `-` (e.g. `claude/foo` → `claude-foo`). The buildhost project MUST stay `js-snippets` (repo-derived). OIDC auto-provisioning only authorizes the repo's own project name. The sites router also rejects slash-namespaced names. Anything else 404s with "project not found".
- **Path gate**: the job publishes only when the branch's diff vs origin/master touches `src/ui/`, `showcase/`, or deploy.yml itself (master pushes always publish). The gate is in-job (a TypeScript-action step), NEVER a workflow-level paths filter — the same workflow runs the library build.
- **Access — private by operator decision (2026-07-15)**: the preview is token-gated (`Authorization: Bearer …` or `?token=…`) because the repo is private. So buildhost's OIDC-auto-provisioned `js-snippets` project, and its sites, are private too. The operator has explicitly ruled it stays that way ("do not make it public, i like it the way it is"). Do NOT add `public: 'true'` to the showcase job's buildhost-publish-site step in deploy.yml — that is not a missing fix. It is a rejected option.
- **Post-#39 note**: the page feature-detects newer component API (`legendEntries`, the built-in `cancelled` style) so it builds against any branch's `src/ui`. Rendering-side features (minimap, fullscreen, skip clustering, kill-tail scrims, edge fades) light up automatically once the bundled component has them.

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

You may be reading any `llms.txt` and notice ANY inaccuracy, missing module, wrong function signature, stale description, or other inconsistency. **Fix it immediately**, even if you did not cause the problem. Seeing a problem and not fixing it is the same as introducing it yourself.

## Adding a New Module

1. Create `src/<category>/<name>.ts` (and `shaders/<name>.wgsl` if needed)
2. **Update `src/<category>/llms.txt`** with the new module's path, exports, and description
3. If it is a new category, create a new `src/<category>/llms.txt`
4. **Add a colocated `src/<category>/<name>.test.ts`** (`node:test`) covering the module's pure surface — import the source with the `.ts` extension, `import type` for type-only symbols (see Testing). DOM/fetch/GPU-bound modules can skip node unit tests. Note the gap rather than forcing a fake.
5. Run `pnpm test` (type-check + tests) and `pnpm build` (type-check + compile) to verify both
6. Commit and push

## Conventions

- All math functions return new values — no mutation
- Mat4 is column-major Float32Array(16), perspective uses WebGPU clip-Z [0,1]
- WebGPU modules assume `rgba32float` textures unless documented otherwise
- All `webgpu/geometry.ts` generators wind triangles CCW viewed from outside (front-facing under WebGPU's default `frontFace: 'ccw'`. Oracle in `geometry.test.ts`) — use `flipWinding(mesh)` for interiors or geometry drawn under a mirror transform, and a mirrored (determinant < 0) draw pass needs the opposite `frontFace`
- Shaders (WGSL and GLSL) live in `src/<category>/shaders/` alongside the `.ts` that imports them. Both import as text (`ts0.json` loaders, ambient decls in `wgsl.d.ts`/`glsl.d.ts`)
- Keep modules self-contained — a consumer must only need one import
- **No TypeScript parameter properties** (`constructor(private x: T)`) anywhere under `src/`: `pnpm test` runs the `.ts` through node's STRIP-ONLY type removal, which rejects any syntax that emits code. Declare the field and assign it.
- `ui/timeline-wire.ts` (decoder) and `timelinewire/` (Go encoder) are the halves of ONE format, and they live together here. A producer imports the package instead of restating the layout, which is how it used to drift. They are held in step by ONE fixture, `timelinewire/testdata/golden-v1.b64`. The Go test asserts the encoder still emits it. The TS test decodes it. Changing the layout is a NEW VERSION (new magic, new media type) with its own fixture, never an edit to that one.
