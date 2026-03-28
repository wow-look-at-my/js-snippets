// Procedural mesh generators.
// Each returns { positions, normals, indices } as typed arrays.

export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}

export function createCube(size = 1): Mesh {
  const h = size / 2;
  const p = [
    // +Z
    -h,-h, h,  h,-h, h,  h, h, h, -h, h, h,
    // -Z
     h,-h,-h, -h,-h,-h, -h, h,-h,  h, h,-h,
    // +X
     h,-h, h,  h,-h,-h,  h, h,-h,  h, h, h,
    // -X
    -h,-h,-h, -h,-h, h, -h, h, h, -h, h,-h,
    // +Y
    -h, h, h,  h, h, h,  h, h,-h, -h, h,-h,
    // -Y
    -h,-h,-h,  h,-h,-h,  h,-h, h, -h,-h, h,
  ];
  const n = [
    0,0,1, 0,0,1, 0,0,1, 0,0,1,
    0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
    1,0,0, 1,0,0, 1,0,0, 1,0,0,
    -1,0,0, -1,0,0, -1,0,0, -1,0,0,
    0,1,0, 0,1,0, 0,1,0, 0,1,0,
    0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
  ];
  const idx: number[] = [];
  for (let f = 0; f < 6; f++) {
    const o = f * 4;
    idx.push(o, o+1, o+2, o, o+2, o+3);
  }
  return {
    positions: new Float32Array(p),
    normals: new Float32Array(n),
    indices: new Uint16Array(idx),
  };
}

export function createSphere(radius = 1, segments = 24): Mesh {
  const rings = segments;
  const sectors = segments;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const phi = Math.PI * r / rings;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let s = 0; s <= sectors; s++) {
      const theta = 2 * Math.PI * s / sectors;
      const st = Math.sin(theta), ct = Math.cos(theta);
      const nx = ct * sp, ny = cp, nz = st * sp;
      positions.push(radius * nx, radius * ny, radius * nz);
      normals.push(nx, ny, nz);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sectors; s++) {
      const a = r * (sectors + 1) + s;
      const b = a + sectors + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

export function createCylinder(radiusTop = 0.5, radiusBottom = 0.5, height = 1, segments = 24): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const halfH = height / 2;

  // Side
  for (let i = 0; i <= segments; i++) {
    const theta = 2 * Math.PI * i / segments;
    const ct = Math.cos(theta), st = Math.sin(theta);
    const dr = radiusBottom - radiusTop;
    const len = Math.hypot(dr, height) || 1;
    const nx = ct * height / len, nz = st * height / len, ny = dr / len;

    positions.push(radiusTop * ct, halfH, radiusTop * st);
    normals.push(nx, ny, nz);
    positions.push(radiusBottom * ct, -halfH, radiusBottom * st);
    normals.push(nx, ny, nz);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, c, b, b, c, d);
  }

  // Top cap
  const topCenter = positions.length / 3;
  positions.push(0, halfH, 0);
  normals.push(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const theta = 2 * Math.PI * i / segments;
    positions.push(radiusTop * Math.cos(theta), halfH, radiusTop * Math.sin(theta));
    normals.push(0, 1, 0);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(topCenter, topCenter + 1 + i, topCenter + 2 + i);
  }

  // Bottom cap
  const botCenter = positions.length / 3;
  positions.push(0, -halfH, 0);
  normals.push(0, -1, 0);
  for (let i = 0; i <= segments; i++) {
    const theta = 2 * Math.PI * i / segments;
    positions.push(radiusBottom * Math.cos(theta), -halfH, radiusBottom * Math.sin(theta));
    normals.push(0, -1, 0);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(botCenter, botCenter + 2 + i, botCenter + 1 + i);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

export function createPlane(width = 20, depth = 20): Mesh {
  const hw = width / 2, hd = depth / 2;
  return {
    positions: new Float32Array([
      -hw, 0, -hd,  hw, 0, -hd,  hw, 0, hd, -hw, 0, hd,
    ]),
    normals: new Float32Array([
      0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
    ]),
    indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
  };
}
