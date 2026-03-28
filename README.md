# js-snippets

Reusable ES modules served via GitHub Pages. Source is TypeScript + WGSL, compiled to plain JavaScript by esbuild. Import directly by URL — no bundler or package manager needed.

**Base URL:** `https://wow-look-at-my.github.io/js-snippets`

## Usage

```js
import { loadHDR } from 'https://wow-look-at-my.github.io/js-snippets/webgpu/hdr-loader.js';
import * as mat4 from 'https://wow-look-at-my.github.io/js-snippets/math/mat4.js';
```

## Modules

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
npm ci
npx tsc --noEmit      # type-check
npx ts-node build.ts  # compile to dist/
```

Each `.ts` file under `src/` is a separate entry point. WGSL shaders are inlined as strings via esbuild's `--loader:.wgsl=text`.

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
