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

## Building

```sh
npm install
npm run build   # ts0 build (type-check + compile src/ -> dist/) + assemble dist/llms.txt
```

[ts0](https://github.com/wow-look-at-my/ts0)'s "js" library target compiles every `.ts` under `src/` to a parallel `.js` under `dist/`, preserving structure (`src/webgpu/sky.ts` → `dist/webgpu/sky.js`). Code shared between modules (e.g. `vec3`, used by `mat4`) is deduplicated into a chunk and imported — never copied into both — so you still import a single URL and the browser fetches any shared chunk transitively. WGSL shaders are imported as strings via the `loaders: { ".wgsl": "text" }` field in `ts0.json`. `ts0 build` type-checks first (`tsc --noEmit`), so there is no separate type-check step.

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
