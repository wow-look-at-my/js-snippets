# js-snippets

Reusable ES modules served via [buildhost](https://github.com/wow-look-at-my/buildhost) sites. Source is TypeScript + WGSL, compiled to plain JavaScript by [ts0](https://github.com/wow-look-at-my/ts0). Import directly by URL — no bundler or package manager needed.

**Base URL:** `https://sites.pazer.build/js-snippets/branch/library`

## Usage

```js
import { loadHDR } from 'https://sites.pazer.build/js-snippets/branch/library/webgpu/hdr-loader.js';
import * as mat4 from 'https://sites.pazer.build/js-snippets/branch/library/math/mat4.js';
```

## Modules

### Editor

| Module | Description |
|--------|-------------|
| `editor/code-editor.js` | Tiny dependency-free syntax-highlighting code editor as a `<code-editor>` custom element. The highlighted token spans *are* the editable content, so the native caret never drifts. Self-contained themeable styles; ~18 KB, no deps. Also exports `highlightToHTML` / `highlightToFragment` for read-only highlighting. |
| `editor/tokenizer.js` | Byte-preserving tokenizer + syntax classifier for C-like source (HLSL/GLSL/WGSL/C/C++/JS). Pure, DOM-free. `tokenize`, `classify`, `LANGUAGES`, `resolveLanguage`. |

### Math

| Module | Description |
|--------|-------------|
| `math/vec3.js` | Minimal vec3 utilities. All functions return new arrays, no mutation. |
| `math/mat4.js` | Column-major `Float32Array(16)` mat4 utilities. Perspective uses WebGPU clip-Z `[0,1]`. |

### UI

| Module | Description |
|--------|-------------|
| `ui/perf-graph.js` | `<perf-graph>` — compact, stackable, canvas-rendered performance graph custom element. Push-based sampling, label/current/avg/min/max readout drawn as canvas text, autoscale or fixed range with nice gridlines, dashed budget guide line, min-max downsampling when samples outnumber pixels, `--perf-graph-*` CSS-custom-property theming. Re-exports `perf-graph-math`. |
| `ui/perf-graph-math.js` | The graph's pure math: `SampleRing` float32 ring buffer, `computeStats`, `autoRange` / `niceStep` / `niceTicks`, `binMinMax`, `formatValue`. DOM-free, allocation-free hot paths. |
| `ui/timeline-view.js` | `<timeline-view>` — canvas-rendered realtime swimlane timeline custom element. Labeled lanes of interval bars on a shared time axis, with sub-track packing sized by the parallelism visible in the current window (height changes tween) and auto-fit that demotes the tallest lanes to compact 4px tracks when the stack would overflow the host (hysteretic, observable via `fitState`/`fitchange`, opt-out `no-auto-fit`); stable category → hue coloring plus a state/kind style map (emphasis, dim, hatch, stipple, outline); instant diamond pips for zero-duration intervals (translation-stable bar/pip decision, whole-device-pixel scrolling); phase segments within bars; connectors and time markers; follow-now with a jump-to-live pill (backward pans disengage; the viewport hard-stops at now and re-docks within 2 device px of the stop); trackpad-first pan/zoom (horizontal-dominant wheel pans time, vertical-dominant wheel is left to the page, anchored ctrl+wheel zoom, pinch, drag, keyboard); async BACKWARD history via a `loadRange` callback with visible uncovered regions and an end-of-history boundary; adaptive idle render pacing (~30fps, ~10fps on battery — a ceiling: clock-driven motion renders at min(tier fps, device px/sec) via even rAF frame-skipping, and a parked chart draws zero frames); built-in tooltip; `--timeline-*` theming. Re-exports `timeline-view-math`. |
| `ui/timeline-view-math.js` | The timeline's pure math: time↔px scales and anchor-preserving zoom, wheel normalization + `routeWheel` gesture routing, the `followAfterGesture` follow rule + `clampViewToNow` end stop, `snapViewToDevicePixels` + the `nowLineX` raw-view now-line snap, the `clockDrawBudgetMs` per-device-pixel draw budget, the time tick ladder + formatters, `packTracks` / `packVisibleTracks` / `layoutLanes`, `computeAutoFit` compact-lane demotion, `fitText`, duration-based instant-width helpers, hit testing and connector routing, `categoryHue` / `categoryColor` hashing, `CoverageTracker` + `historyProbe` for async history, render-pacing tiers. DOM-free, node-tested. |

### WebGPU

| Module | Description |
|--------|-------------|
| `webgpu/hdr-loader.js` | Parses Radiance RGBE (`.hdr`) files with RLE support. Returns `rgba32float` pixel data. |
| `webgpu/mip-generator.js` | AMD Single Pass Downsampler — generates a full mip chain in two compute dispatches. |
| `webgpu/env-prefilter.js` | IBL environment map prefiltering with GGX importance sampling for PBR split-sum. |
| `webgpu/geometry.js` | Procedural mesh generators: cube, sphere, cylinder, plane. |
| `webgpu/buffer.js` | GPU buffer creation helper with `mappedAtCreation`. |
| `webgpu/context.js` | WebGPU device + canvas context initialization. |
| `webgpu/sky.js` | Equirectangular HDRI sky renderer with Reinhard tonemapping. |
| `webgpu/shaders.js` | `loadShader` / `loadShaders` — fetch shader source text (WGSL or GLSL; backend-agnostic). |
| `webgpu/canvas.js` | `resizeCanvasToDisplay` — HiDPI backing-store sizing (backend-agnostic). |
| `webgpu/camera.js` | Orbit + first-person look cameras: pure `orbitEye`/`dirFromAzEl`/`applyLookDrag` plus DOM-bound drag controllers (backend-agnostic). |
| `webgpu/fly-camera.js` | First-person fly ("noclip") camera on top of `camera.js`: WASD flight, wheel + pinch dolly; pure `flyMoveDelta`/`dollyDelta` (backend-agnostic). |

### WebGL2

| Module | Description |
|--------|-------------|
| `webgl2/program.js` | Shader compile + program link with source-annotated error logs (`annotateShaderLog`); `injectChunk` splices a shared GLSL chunk in after the `#version` line. |
| `webgl2/mesh.js` | VAO from typed arrays: one buffer per attribute, optional index buffer with automatic 16/32-bit sizing. |
| `webgl2/fbo.js` | Float-color framebuffer (RGBA16F default) with the `EXT_color_buffer_float` and completeness checks; `createPingPong` pairs two for iterative feedback passes. |
| `webgl2/video-texture.js` | Texture tracking an `HTMLVideoElement` (sRGB or raw), using `requestVideoFrameCallback` when available. |
| `webgl2/fullscreen.js` | Fullscreen-triangle pass from `gl_VertexID` — no vertex buffer; ships the `#version 300 es` vertex shader. |

## Building

```sh
pnpm install
pnpm build      # ts0 build (type-check + compile src/ -> dist/) + assemble dist/llms.txt
```

[ts0](https://github.com/wow-look-at-my/ts0)'s "js" library target compiles every `.ts` under `src/` to a parallel `.js` under `dist/`, preserving structure (`src/webgpu/sky.ts` → `dist/webgpu/sky.js`). Code shared between modules (e.g. `vec3`, used by `mat4`) is deduplicated into a chunk and imported — never copied into both — so you still import a single URL and the browser fetches any shared chunk transitively. WGSL shaders are imported as strings via the `loaders: { ".wgsl": "text" }` field in `ts0.json`. `ts0 build` type-checks first (`tsc --noEmit`), so there is no separate type-check step.

The build also emits a TypeScript declaration sibling for every module — `dist/webgpu/sky.js` gets `dist/webgpu/sky.d.ts` — and deploys carry them to the site at the same URL with the extension swapped (`https://…/js-snippets/ui/timeline-view.d.ts` next to `…/ui/timeline-view.js`), so consumers can fetch types alongside the code. Shared chunks and tests get no declarations.

## Deploy

CI runs on every push (`.github/workflows/deploy.yml`). Every push publishes `dist/` to buildhost sites: `master` → the stable `library` site (the base URL above), any other branch → `library-<branch>` for pre-merge verification.

The legacy GitHub Pages site was unpublished 2026-07-20 in the org-wide GitHub Pages shutdown; buildhost is the only host.

Branches that touch the timeline chart (`src/ui/`) or `showcase/` also publish a live single-file demo of `<timeline-view>` (fake local data, every visual looping) to buildhost: `https://sites.pazer.build/js-snippets/branch/<branch>/` (`/` in branch names flattened to `-`). The preview is private/token-gated by operator decision — do not add `public: 'true'` to the publish step. Build it locally with `pnpm build:showcase` → `showcase/dist/index.html`.

## LLM Documentation

Machine-readable docs are available at:

```
https://sites.pazer.build/js-snippets/branch/library/llms.txt
```

This file is auto-generated from `llms-header.txt` and per-category `llms.txt` files in `src/`.

## License

See repository for license details.
