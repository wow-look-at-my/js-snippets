# What is unit-tested under node, and what is not

`pnpm test` type-checks the project. It then runs every `*.test.ts` file under Node's own test runner. Node has no DOM. It has no canvas, no GPU, and no text loader for a `.css` or `.wgsl` import. A whole class of module here is out of reach of that runner.

The rule this repo follows is simple. **Split the module. Do not fake the environment.** A module that mixes pure logic with a bound surface gets its logic moved into a sibling module. The sibling is named `-math`, `-logic` or `-parse`. It is tested in full. The bound half goes to a browser harness or to manual testing. Nothing here mocks a canvas, a GPU device or a popup. A fake environment tests the fake.

One consequence is worth stating plainly. **A green `pnpm test` says nothing about whether an element renders.** The browser harnesses at the bottom of this file are the checks that do.

## Not node-tested at all: they need a real browser or GPU

These modules are left to manual and integration testing.

- `webgpu/shaders.ts`, `webgpu/canvas.ts`, `webgpu/context.ts`, `webgpu/buffer.ts`
- `webgpu/sky.ts`, `webgpu/mip-generator.ts`, `webgpu/env-prefilter.ts`, `webgpu/hdr-loader.ts`
- `webgl2/video-texture.ts`
- `webgl2/fullscreen.ts`. Its `.glsl` import also resolves only under the build's text loader.
- `editor/code-editor.ts`
- `auto-refresh/`

## Split modules: the pure half is tested, the bound half is not

- `webgpu/camera.ts` tests `orbitEye`, `dirFromAzEl` and `applyLookDrag`. The DOM-bound controllers are not tested.
- `webgpu/fly-camera.ts` tests `flyMoveDelta` and `dollyDelta`. `createFlyController` is not tested.
- `webgl2/program.ts` tests `annotateShaderLog` and `injectChunk`.
- `webgl2/mesh.ts` tests `chooseIndexArray`.
- `webgl2/fbo.ts` tests `makePingPong`. The GL-bound `createFloatFbo` and `createPingPong` are not tested.
- `webgpu/scan.ts` keeps its pure half in `webgpu/scan-plan.ts`. That module holds the `planScan` level math. Its tests include a plan-driven JS emulation of the WGSL. The split exists because `scan.ts` imports a `.wgsl` file. That file cannot load under node. Consumer browser harnesses cover the GPU wrapper `createScan`.
- `ui/perf-graph.ts` is the DOM and canvas-bound `<perf-graph>` element. Its logic lives in `ui/perf-graph-math.ts`. That module covers the ring buffer, the stats, the range, the ticks, the binning and the formatting. It is node-tested in full.
- `ui/timeline-view.ts` is the `<timeline-view>` element. Its `.css` text import also resolves only under the build's loader. Its logic lives in `ui/timeline-view-math.ts`. That module covers the scales, the zoom, the ticks, the packing, the label fit, the hit tests, the hues and the coverage bookkeeping.
- `ui/combobox.ts` is the `<combo-box>` element and the select-fallback popup. It is DOM-bound. Its `.css` text import resolves only under the build's loader. Its logic lives in `ui/combobox-logic.ts`. That module covers the activation gating, the enabled-option navigation, the type-ahead and the popup placement.
- `ui/canvas-text.ts` tests its pure fitting surface: `deriveLabelTiers`, `selectTier`, `clipToWidth` and `fitTieredText`. The canvas-bound `FadeTextPainter` is not tested.
- `ui/timeline-wire.ts` is pure and node-tested in full. It is bytes in and columns out. Its frame-paced driver falls back to a plain yield off-browser. The tests therefore cover the codec and the driver's completion contract, not real frames.
- `ui/data-table.ts` is the `<data-table>` element. `ui/activity-feed.ts` is a thin wrapper over it. Both are DOM-bound and not node-tested. Their logic lives in `ui/data-table-math.ts` and `ui/activity-feed-math.ts`. The first covers the comparison, the stable sort, the sort cycle, the multi-group facet selection and the stored-filter parsing. The second covers the severity and family derivation, the query and the facet selection. Note that the HOST filters a group declared `local: false`. `selectRows` therefore never sees it.
- `ui/markdown.ts` is the DOM walker over `createElement` and `createTextNode`. It is not node-tested. Its logic lives in `ui/markdown-parse.ts`. That module's `sanitizeTree` runs BEFORE any node reaches the walker. The safety properties proved there therefore hold for the rendered output too. That is the reason the sanitizing lives in the tree rather than in the renderer.
- `apng/worker.ts` constructs the worker and owns the message protocol. It is Worker and DOM-bound. It is not node-tested. Everything it runs is pure and node-tested in full: `apng/png.ts`, `apng/diff.ts`, `apng/palette.ts` and `apng/encoder.ts`. The encoder's oracle is a decoder written in its own test file. `apng/raster.ts` splits the same way. `fitRect` and `clampSize` are tested. The OffscreenCanvas draw is not.
- `ui/dag-view.ts` is the `<dag-view>` element. Its `.css` text import likewise resolves only under the build's loader. Its whole layout pipeline lives in `ui/dag-view-math.ts`. That module covers the graph normalization, the cycle breaking, the layering and the crossing reduction. It also covers the coordinates, the routing, the viewport, the culling, the hit tests and the reachability. Its tests include the invariants that decide whether the picture is right at all. No box overlaps another in its layer. A straight chain draws straight. Every edge points down the page. A zoom holds the world point under the cursor. A cycle-reversed edge is still routed from its true source.
- `ui/color.ts` and `ui/hit-test.ts` are the pure primitives the canvas-painted components share. Their coverage lives in `ui/timeline-view-math.test.ts`. That file imports them through this module's re-exports.

## What covers the gap

- **`showcase/`** is the component gallery. Every DOM-bound `src/ui/` component has a section there. The gallery publishes per branch. A rendering change is therefore verifiable from a real URL before it merges. See the Showcase section of CLAUDE.md.
- **`scripts/check-dag-view.ts`** drives `<dag-view>` in a real Chromium. Node strips its types and runs it. `ts0 build` type-checks `scripts/` too. The file imports `DagViewElement` as a type, so a call it gets wrong fails the build. It checks that the element upgrades and that the canvas paints anything at all. It checks that the cycle and rejected-edge reporting reaches the notice strip. It checks the hover tooltip, the click selection, the arrow-key graph walk and the toolbar. It checks that search highlights rather than filters. It also writes the reference screenshots.
- **`scripts/check-timeline-bounds.mjs`** does the same for `<timeline-view>`'s `minTime` and `maxTime`. Those are element-level properties that no node test can reach.
- **`scripts/screenshot-showcase.mjs`** captures the README's `<timeline-view>` picture from the real component, so the image cannot drift.

Add a line here when you add a module that mixes pure and bound code. Split it the same way. Note the gap rather than forcing a fake.
