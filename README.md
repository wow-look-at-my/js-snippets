# js-snippets

Reusable ES modules served via GitHub Pages. Source is TypeScript + WGSL, compiled to plain JavaScript by [ts0](https://github.com/wow-look-at-my/ts0). Import directly by URL — no bundler or package manager needed.

**Base URL:** `https://wow-look-at-my.github.io/js-snippets`

## Usage

```js
import { loadHDR } from 'https://wow-look-at-my.github.io/js-snippets/webgpu/hdr-loader.js';
import * as mat4 from 'https://wow-look-at-my.github.io/js-snippets/math/mat4.js';
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
| `ui/timeline-view.js` | `<timeline-view>` — canvas-rendered realtime swimlane timeline custom element. Labeled lanes of interval bars on a shared time axis, with sub-track packing sized by the parallelism visible in the current window (height changes tween); stable category → hue coloring plus a state/kind style map (emphasis, dim, hatch, stipple, outline); instant diamond pips for zero-duration intervals (translation-stable bar/pip decision, whole-device-pixel scrolling); phase segments within bars; connectors and time markers; follow-now with a jump-to-live pill (backward pans disengage, forward pans re-dock); trackpad-first pan/zoom (deltaX pans time, anchored ctrl+wheel, pinch, drag, keyboard); async BACKWARD history via a `loadRange` callback with visible uncovered regions and an end-of-history boundary; adaptive idle render pacing (~30fps, ~10fps on battery); built-in tooltip; `--timeline-*` theming. Re-exports `timeline-view-math`. |
| `ui/timeline-view-math.js` | The timeline's pure math: time↔px scales and anchor-preserving zoom, wheel normalization + `routeWheel` gesture routing, the `followAfterGesture` follow rule, `snapViewToDevicePixels`, the time tick ladder + formatters, `packTracks` / `packVisibleTracks` / `layoutLanes`, `fitText`, duration-based instant-width helpers, hit testing and connector routing, `categoryHue` / `categoryColor` hashing, `CoverageTracker` + `historyProbe` for async history, render-pacing tiers. DOM-free, node-tested. |

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

The build also emits a TypeScript declaration sibling for every module — `dist/webgpu/sky.js` gets `dist/webgpu/sky.d.ts` — and deploys carry them to Pages at the same URL with the extension swapped (`https://…/js-snippets/ui/timeline-view.d.ts` next to `…/ui/timeline-view.js`), so consumers can fetch types alongside the code. Shared chunks and tests get no declarations.

## Deploy

CI runs on every push (`.github/workflows/deploy.yml`). Pushes to `master` deploy `dist/` to GitHub Pages automatically.

## LLM Documentation

Machine-readable docs are available at:

```
https://wow-look-at-my.github.io/js-snippets/llms.txt
```

This file is auto-generated from `llms-header.txt` and per-category `llms.txt` files in `src/`.

## License

See repository for license details.
