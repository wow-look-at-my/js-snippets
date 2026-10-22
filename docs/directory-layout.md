# Directory Layout

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
│   ├── vec2.ts, vec3.ts, vec4.ts ← fixed-size vectors, same shape each
│   ├── vecn.ts            ← arbitrary-dimension vectors, for a data-driven
│   │                        dimension. A length mismatch THROWS
│   ├── mat4.ts
│   ├── least-squares.ts   ← linear solve + normal equations, polynomial/line
│   │                        fits, symmetric 3x3 Jacobi eigen, and the
│   │                        ORTHOGONAL-distance fits (2D line, circle, 3D
│   │                        line, plane) built on it
│   ├── cylinder-fit.ts    ← least-squares infinite cylinder (Eberly): closed
│   │                        form per axis + a Hammersley hemisphere sweep, so
│   │                        a SHORT wide cylinder (flat cloud, principal axis
│   │                        perpendicular to the true one) still fits
│   ├── sdf.ts             ← signed-distance primitives + grid bake + soft shadow
│   ├── noise.ts           ← hash → value-noise → fbm (2D + 3D)
│   ├── sampling.ts        ← van der Corput / Hammersley + hemisphere sampling
│   ├── gaussian-kernel.ts ← linear-sampling separable Gaussian kernel builder
│   └── *.test.ts          ← colocated node:test tests (vec2 / vec3 / vec4 /
│                            vecn / mat4 / least-squares / cylinder-fit / sdf /
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
│   ├── upgrade-properties.ts ← custom-element property upgrade, derived
│   │                        from the class's setters (+ colocated test)
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
│   │                        value formatting, plus the STACKED half —
│   │                        SeriesRing, stackedTop/Total/Max, binLast
│   ├── perf-graph-math.test.ts ← colocated node:test tests for the math
│   ├── perf-graph.ts      ← <perf-graph> custom element (canvas-rendered
│   │                        stackable perf HUD; re-exports perf-graph-math).
│   │                        `series` + `pushSeries` switch it to a STACKED
│   │                        AREA: floor pinned at 0, ceiling on the tallest
│   │                        COLUMN, band colors from ui/color.ts
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
├── dag-view-demo.ts       ← <dag-view> section (eight instances: the build graph with every node state, a cycle, LR, a retheme, an active-nodes board with node links, a collapsed group, an expanded group, and empty)
├── perf-graph-demo.ts     ← <perf-graph> section (the full HUD, a compact five-gauge strip, fixed against autoscaled, and empty)
├── fake-data.ts           ← deterministic fake-run generator (pure fn of absolute time) + mulberry32, shared by every section; its `release` lane is the SUB-SPAN fixture (stages with `parentId`, one nested a level deeper, one an instant)
├── page.css               ← page chrome (adopted from main.ts as a text import)
└── assets.d.ts            ← ambient *.css/*.wgsl/*.glsl decls for the nested project's own type-check
docs/testing-boundaries.md ← which modules are node-tested, which are not and why, and what covers the gap. Read it before adding a module that mixes pure and bound code
docs/timeline/zoom-out-never-merges.md ← THE rule for dense instants: N discrete events never render as one contiguous shape; zooming out drops marks, never fuses them. Names the two failures that produced it and where it is enforced
docs/timeline/span-9patch.md ← why spans stay path-drawn while pips are sprited: the 9-patch only wins when every bar is snapped to whole device pixels, which the single global rounding step forbids
docs/timeline/sub-spans.md ← SUB-SPANS: an interval's `parentId` nests it under a same-lane parent; the family packs as ONE block (parent on top, sub-spans attached flush under it in darker shades of the parent's color, nested families recursively). The rules, what a reader gets, and where each half lives
docs/timeline-view.png     ← the README's <timeline-view> picture. Captured from the built showcase by scripts/screenshot-showcase.mjs (playwright + the preinstalled chromium), so it is the REAL component and cannot drift; regenerate after a visual change: just build-showcase && node scripts/screenshot-showcase.mjs
scripts/screenshot-showcase.mjs ← that capture (fails on any page error rather than writing a half-upgraded chart)
.github/workflows/deploy.yml `ste-lint` job ← the org's ASD-STE100 mechanical-subset prose gate, `wow-look-at-my/actions@ste-lint#latest`, over the docs and the llms.txt files this repo serves. Six rules FAIL (hard-wrapped paragraphs, semicolons, sentences over 25 words, should/shall/could/might/would, comma splices, contractions); everything else warns. Run it through the action, never a local re-driver. STILL TO CONVERT (that count is real failures, not an exemption): src/ui/llms.txt — 1805 across 1591 lines, three quarters of them the hard-wrap rule. Add it to the job's `files` input once it passes
scripts/check-dag-view.ts ← browser check for `<dag-view>` on the REAL element: upgrade, actual painted pixels, the cycle/rejected-edge reporting, hover tooltips, click selection, the arrow-key graph walk, the toolbar, and that search highlights rather than filters. The active board must change pixels from frame to frame on an active box and not on an idle one, under reduced motion too, and the rAF loop must stop once no active box is in view. The node links must render on the card and point where the node says. A collapsed group must draw as one node, expand to its members on a click, collapse again on its header, and carry its edges each way. Hovering a node must dim nothing for half a second, dim the rest by two and a half, and ease back on leaving. A plain mouse wheel must leave the graph alone and scroll the page, Ctrl + wheel must zoom, and a trackpad-shaped scroll must pan. It also builds ONE graph the gallery cannot hold: 118 nodes with three edges, the shape a dashboard hands it when a manifest sweep read nothing. Two failures there look identical on screen, a dark box with a couple of stray lines. Every edgeless node became a layer of its own, and the block they packed into was four times wider than tall, so the fit landed under `LOD_LABEL_SCALE` and drew boxes with no text. NONE of this is reachable under `node --test`, and it also writes the reference screenshots. Run: `just build-showcase && NODE_PATH=/opt/node22/lib/node_modules node scripts/check-dag-view.ts`. It is TypeScript, and node strips the types to run it: `ts0 build` type-checks `scripts/` as well as `src/`, so it imports `DagViewElement` as a type and a call this script gets wrong fails the BUILD instead of failing in the browser. The playwright surface it drives is typed locally, because playwright is installed globally (NODE_PATH) rather than depended on here
scripts/check-perf-graph.mjs ← browser check for `<perf-graph>`'s STACKED mode on the REAL element: that `series` upgrades it into a stacked area, that the bands reach the canvas as SEPARATE colors on both the per-sample and the binned path, that a band joining late leaves the others alone, and that a graph with series but no column drawn paints no band. It reads a pixel column from the plot only, between the readout row and the legend row: a legend swatch carries a band's color whether or not that band has data, so a column that includes it proves nothing. The gallery draws only the section its hash names, so it navigates to `#perf-graph`. It also writes the reference screenshot. Run: `just build-showcase && NODE_PATH=/opt/node22/lib/node_modules node scripts/check-perf-graph.mjs`
scripts/check-timeline-bounds.mjs ← browser check for `minTime`/`maxTime` AND sub-spans on the REAL element (drives pointer/wheel input against the built showcase; the math under it is node-tested, these are the element-level properties nothing under `node --test` can reach). The sub-span half sweeps the `#subspans` instance: a sub-span's row lies under its parent's, no stranger sits inside the block, the box paints in the row gap (pixel readback), a sub-span's tooltip names its parent, the empty part of the box hits the parent; it also writes the `timeline-subspans.png` reference screenshot. Run: `just build-showcase && NODE_PATH=/opt/node22/lib/node_modules node scripts/check-timeline-bounds.mjs`
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

Domain organizes modules (`apng/`, `auto-refresh/`, `editor/`, `math/`, `ui/`, `webgpu/`, `webgl2/`). The deployed URL mirrors the `src/` structure without the `src/` prefix: `src/webgpu/sky.ts` → `https://…/webgpu/sky.js`.
