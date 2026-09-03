# What is unit-tested under node, and what is not

`pnpm test` type-checks the project and runs every `*.test.ts` under Node's
built-in runner. Node has no DOM, no canvas, no GPU and no `fetch`-backed
text loader, so a whole class of module in this repo cannot be covered by
it at all.

The rule this repo follows is: **split the module, do not fake the
environment.** A module that mixes pure logic with a bound surface gets its
logic extracted into a sibling `-math` / `-logic` / `-parse` module, which
is then tested exhaustively, and the bound half is left to a browser
harness or to manual testing. Nothing here mocks a canvas, a GPU device or
a `<select>` popup — a fake environment tests the fake.

The consequence is worth stating plainly: **a green `pnpm test` says
nothing about whether any element renders.** For the components that have
one, the browser harness is the check that does (see the bottom of this
file).

## Not node-tested at all: they need a real browser or GPU

`webgpu/shaders.ts`, `webgpu/canvas.ts`, `webgpu/context.ts`,
`webgpu/buffer.ts`, `webgpu/sky.ts`, `webgpu/mip-generator.ts`,
`webgpu/env-prefilter.ts`, `webgpu/hdr-loader.ts`,
`webgl2/video-texture.ts`, `webgl2/fullscreen.ts` (its `.glsl` import also
only resolves under the build's text loader, not `node --test`),
`editor/code-editor.ts`, and `auto-refresh/`. These are left to
manual/integration testing.

## Split modules: the pure half is tested, the bound half is not

- `webgpu/camera.ts` tests `orbitEye`/`dirFromAzEl`/`applyLookDrag` but not the DOM-bound controllers.
- `webgpu/fly-camera.ts` tests `flyMoveDelta`/`dollyDelta` but not `createFlyController`.
- `webgl2/program.ts` tests `annotateShaderLog` and `injectChunk`.
- `webgl2/mesh.ts` tests `chooseIndexArray`.
- `webgl2/fbo.ts` tests `makePingPong` but not the GL-bound `createFloatFbo`/`createPingPong`.
- `webgpu/scan.ts` splits its pure half into `webgpu/scan-plan.ts` (planScan level math, tested incl. a plan-driven JS emulation of the WGSL) because scan.ts's own `.wgsl` import cannot load under node — the GPU wrapper (`createScan`) is covered by consumer browser harnesses.
- `ui/perf-graph.ts` is DOM/canvas-bound (the `<perf-graph>` element), so its logic lives in `ui/perf-graph-math.ts` (ring buffer / stats / range / ticks / binning / formatting), which is its fully node-tested pure half.
- `ui/timeline-view.ts` (the `<timeline-view>` element — its `.css` text import also only resolves under the build's loader) splits its logic into `ui/timeline-view-math.ts` (scales / zoom / ticks / packing / label fit / hit tests / hues / coverage) the same way.
- `ui/combobox.ts` (the `<combo-box>` element / select-fallback popup — DOM-bound, and its `.css` text import likewise only resolves under the build's loader) splits its logic into `ui/combobox-logic.ts` (activation gating / enabled-option navigation / type-ahead / popup placement), which is its fully node-tested pure half.
- `ui/canvas-text.ts` tests its pure fitting surface (deriveLabelTiers / selectTier / clipToWidth / fitTieredText) but not the canvas-bound `FadeTextPainter`.
- `ui/timeline-wire.ts` is pure and FULLY node-tested (it is bytes in, columns out) — its frame-paced driver degrades to a plain yield off-browser, so the tests cover the codec and the driver's completion contract, not real frames.
- `ui/data-table.ts` (the `<data-table>` element — its `.css` text import also only resolves under the build's loader) and `ui/activity-feed.ts` (a thin wrapper over it) are DOM-bound and not node-tested, with their logic in `ui/data-table-math.ts` (comparison / stable sort / the sort cycle / multi-group facet selection / stored-filter parsing) and `ui/activity-feed-math.ts` (severity + family derivation, query and facet selection) respectively — note that a group declared `local: false` is filtered by the HOST, so `selectRows` deliberately never sees it.
- `ui/markdown.ts` is the DOM walker (createElement/createTextNode) and is not node-tested, with its logic in `ui/markdown-parse.ts` — and because that module's `sanitizeTree` runs BEFORE any node reaches the walker, the safety properties proved there hold for the rendered output too, which is the reason the sanitizing lives in the tree rather than in the renderer.
- `apng/worker.ts` is Worker/DOM-bound (it constructs the worker and owns the message protocol) and is not node-tested, while everything it runs — `apng/png.ts`, `apng/diff.ts`, `apng/palette.ts`, `apng/encoder.ts` — is pure and fully node-tested, and `apng/raster.ts` splits the same way (fitRect/clampSize tested, the OffscreenCanvas draw not), the encoder against a decoder written in its own test file.
- `ui/dag-view.ts` (the `<dag-view>` element — its `.css` text import likewise only resolves under the build's loader) splits the same way, with its whole layout pipeline in `ui/dag-view-math.ts` (graph normalization / cycle breaking / layering / crossing reduction / coordinates / routing / viewport / culling / hit tests / reachability) — fully node-tested, including the invariants that decide whether the picture is right at all: no box overlaps another in its layer, a straight chain draws straight, every edge points down the page, a zoom holds the world point under the cursor, and a cycle-reversed edge is still routed from its true source.
- `ui/color.ts` and `ui/hit-test.ts` are the pure primitives the canvas-painted components share; their coverage lives in `ui/timeline-view-math.test.ts`, which still imports them through that module's re-exports.

## What covers the gap

- **`showcase/`** — the component gallery. Every DOM-bound `src/ui/` component has a section, published per branch, so a rendering change is verifiable from a real URL before it merges. See the Showcase section of CLAUDE.md.
- **`scripts/check-dag-view.mjs`** — a real Chromium driving `<dag-view>`: that the element upgrades, that the canvas paints anything at all, that the cycle and rejected-edge reporting reaches the notice strip, that a hover shows a tooltip, that a click selects, that the arrow keys walk the edges, that the toolbar moves the viewport, and that search highlights rather than filters. It also writes the reference screenshots.
- **`scripts/check-timeline-bounds.mjs`** — the same idea for `<timeline-view>`'s `minTime`/`maxTime`, which are element-level properties nothing under `node --test` can reach.
- **`scripts/screenshot-showcase.mjs`** — captures the README's `<timeline-view>` picture from the real component, so the image cannot drift.

When you add a module that mixes pure and bound code, split it the same way
and add a line here. Note the gap rather than forcing a fake.
