// Radiance RGBE (.hdr) parser
// Returns { width, height, data: Float32Array } with 4 floats per pixel (RGBA).

export interface HdrImage {
  width: number;
  height: number;
  data: Float32Array;
}

export async function loadHDR(url: string): Promise<HdrImage> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed to load HDR: ' + url);
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);

  let pos = 0;

  function readLine(): string {
    let line = '';
    while (pos < bytes.length) {
      const ch = bytes[pos++];
      if (ch === 10) return line; // \n
      if (ch !== 13) line += String.fromCharCode(ch); // skip \r
    }
    return line;
  }

  // Validate magic
  const magic = readLine();
  if (!magic.startsWith('#?RADIANCE') && !magic.startsWith('#?RGBE')) {
    throw new Error('Not a Radiance HDR file');
  }

  // Skip header until empty line
  while (true) {
    const line = readLine();
    if (line === '') break;
  }

  // Resolution line: "-Y height +X width"
  const resLine = readLine();
  const resMatch = resLine.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!resMatch) throw new Error('Unsupported HDR resolution format: ' + resLine);
  const height = parseInt(resMatch[1]);
  const width = parseInt(resMatch[2]);

  const data = new Float32Array(width * height * 4);

  function rgbeToFloat(r: number, g: number, b: number, e: number, out: Float32Array, offset: number): void {
    if (e === 0) {
      out[offset] = out[offset + 1] = out[offset + 2] = 0;
    } else {
      const scale = Math.pow(2, e - 128 - 8);
      out[offset]     = r * scale;
      out[offset + 1] = g * scale;
      out[offset + 2] = b * scale;
    }
    out[offset + 3] = 1;
  }

  // Decode scanlines (new-style RLE)
  for (let y = 0; y < height; y++) {
    // Check for new-style RLE marker
    if (bytes[pos] === 2 && bytes[pos + 1] === 2 &&
      bytes[pos + 2] === ((width >> 8) & 0xFF) &&
      bytes[pos + 3] === (width & 0xFF)) {
      pos += 4;

      // RLE: each channel separately
      const scanline = new Uint8Array(width * 4);
      for (let ch = 0; ch < 4; ch++) {
        let col = 0;
        while (col < width) {
          const code = bytes[pos++];
          if (code > 128) {
            // Run
            const count = code - 128;
            const val = bytes[pos++];
            for (let i = 0; i < count; i++) {
              scanline[(col + i) * 4 + ch] = val;
            }
            col += count;
          } else {
            // Literal
            for (let i = 0; i < code; i++) {
              scanline[(col + i) * 4 + ch] = bytes[pos++];
            }
            col += code;
          }
        }
      }

      for (let x = 0; x < width; x++) {
        const si = x * 4;
        rgbeToFloat(scanline[si], scanline[si + 1], scanline[si + 2], scanline[si + 3],
                    data, (y * width + x) * 4);
      }
    } else {
      // Uncompressed or old-style RLE
      for (let x = 0; x < width; x++) {
        rgbeToFloat(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3],
                    data, (y * width + x) * 4);
        pos += 4;
      }
    }
  }

  return { width, height, data };
}
