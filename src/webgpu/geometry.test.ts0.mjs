// src/webgpu/geometry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/webgpu/geometry.ts
function createCube(size = 1) {
  const h = size / 2;
  const p = [
    // +Z
    -h,
    -h,
    h,
    h,
    -h,
    h,
    h,
    h,
    h,
    -h,
    h,
    h,
    // -Z
    h,
    -h,
    -h,
    -h,
    -h,
    -h,
    -h,
    h,
    -h,
    h,
    h,
    -h,
    // +X
    h,
    -h,
    h,
    h,
    -h,
    -h,
    h,
    h,
    -h,
    h,
    h,
    h,
    // -X
    -h,
    -h,
    -h,
    -h,
    -h,
    h,
    -h,
    h,
    h,
    -h,
    h,
    -h,
    // +Y
    -h,
    h,
    h,
    h,
    h,
    h,
    h,
    h,
    -h,
    -h,
    h,
    -h,
    // -Y
    -h,
    -h,
    -h,
    h,
    -h,
    -h,
    h,
    -h,
    h,
    -h,
    -h,
    h
  ];
  const n = [
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    -1,
    0,
    0,
    -1,
    0,
    0,
    -1,
    0,
    0,
    -1,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    -1,
    0,
    0,
    -1,
    0,
    0,
    -1,
    0,
    0,
    -1,
    0,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    -1,
    0,
    0,
    -1,
    0,
    0,
    -1,
    0,
    0,
    -1,
    0
  ];
  const idx = [];
  for (let f = 0; f < 6; f++) {
    const o = f * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  return {
    positions: new Float32Array(p),
    normals: new Float32Array(n),
    indices: new Uint16Array(idx)
  };
}
function createSphere(radius = 1, segments = 24) {
  const rings = segments;
  const sectors = segments;
  const positions = [];
  const normals = [];
  const indices = [];
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
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices)
  };
}
function createCylinder(radiusTop = 0.5, radiusBottom = 0.5, height = 1, segments = 24) {
  const positions = [];
  const normals = [];
  const indices = [];
  const halfH = height / 2;
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
  const topCenter = positions.length / 3;
  positions.push(0, halfH, 0);
  normals.push(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const theta = 2 * Math.PI * i / segments;
    positions.push(radiusTop * Math.cos(theta), halfH, radiusTop * Math.sin(theta));
    normals.push(0, 1, 0);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(topCenter, topCenter + 2 + i, topCenter + 1 + i);
  }
  const botCenter = positions.length / 3;
  positions.push(0, -halfH, 0);
  normals.push(0, -1, 0);
  for (let i = 0; i <= segments; i++) {
    const theta = 2 * Math.PI * i / segments;
    positions.push(radiusBottom * Math.cos(theta), -halfH, radiusBottom * Math.sin(theta));
    normals.push(0, -1, 0);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(botCenter, botCenter + 1 + i, botCenter + 2 + i);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices)
  };
}
function createPlane(width = 20, depth = 20) {
  const hw = width / 2, hd = depth / 2;
  return {
    positions: new Float32Array([
      -hw,
      0,
      -hd,
      hw,
      0,
      -hd,
      hw,
      0,
      hd,
      -hw,
      0,
      hd
    ]),
    normals: new Float32Array([
      0,
      1,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      0,
      1,
      0
    ]),
    indices: new Uint16Array([0, 2, 1, 0, 3, 2])
  };
}
function createBox(width = 1, height = 1, depth = 1) {
  const X = width / 2, Y = height / 2, Z = depth / 2;
  const positions = [];
  const normals = [];
  const indices = [];
  let base = 0;
  const quad = (n, a, b, c, d) => {
    for (const v of [a, b, c, d]) {
      positions.push(v[0], v[1], v[2]);
      normals.push(n[0], n[1], n[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base += 4;
  };
  quad([1, 0, 0], [X, -Y, Z], [X, -Y, -Z], [X, Y, -Z], [X, Y, Z]);
  quad([-1, 0, 0], [-X, -Y, -Z], [-X, -Y, Z], [-X, Y, Z], [-X, Y, -Z]);
  quad([0, 1, 0], [-X, Y, Z], [X, Y, Z], [X, Y, -Z], [-X, Y, -Z]);
  quad([0, -1, 0], [-X, -Y, -Z], [X, -Y, -Z], [X, -Y, Z], [-X, -Y, Z]);
  quad([0, 0, 1], [-X, -Y, Z], [X, -Y, Z], [X, Y, Z], [-X, Y, Z]);
  quad([0, 0, -1], [X, -Y, -Z], [-X, -Y, -Z], [-X, Y, -Z], [X, Y, -Z]);
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices)
  };
}
function createTorus(radius = 1, tube = 0.4, radialSegments = 24, tubularSegments = 48) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments * Math.PI * 2;
      const cv = Math.cos(v), sv = Math.sin(v);
      positions.push((radius + tube * cv) * cu, tube * sv, (radius + tube * cv) * su);
      normals.push(cv * cu, sv, cv * su);
    }
  }
  const stride = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j;
      const b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices)
  };
}
function flipWinding(mesh) {
  const src = mesh.indices;
  const indices = new Uint16Array(src.length);
  for (let t = 0; t < src.length; t += 3) {
    indices[t] = src[t];
    indices[t + 1] = src[t + 2];
    indices[t + 2] = src[t + 1];
  }
  return { positions: mesh.positions, normals: mesh.normals, indices };
}

// src/webgpu/geometry.test.ts
function vertexCount(m) {
  assert.equal(m.positions.length % 3, 0, "positions length divisible by 3");
  assert.equal(m.normals.length % 3, 0, "normals length divisible by 3");
  assert.equal(m.positions.length, m.normals.length, "positions and normals same length");
  return m.positions.length / 3;
}
function assertIndicesInRange(m) {
  const vc = vertexCount(m);
  assert.equal(m.indices.length % 3, 0, "indices form whole triangles");
  assert.ok(m.indices.length > 0, "has at least one triangle");
  for (let i = 0; i < m.indices.length; i++) {
    assert.ok(m.indices[i] < vc, `index ${m.indices[i]} >= vertexCount ${vc}`);
    assert.ok(m.indices[i] >= 0, `index ${m.indices[i]} is negative`);
  }
}
function assertNormalsUnit(m, tol = 1e-3) {
  const vc = vertexCount(m);
  for (let i = 0; i < vc; i++) {
    const x = m.normals[i * 3], y = m.normals[i * 3 + 1], z = m.normals[i * 3 + 2];
    const l = Math.hypot(x, y, z);
    assert.ok(Math.abs(l - 1) < tol, `normal ${i} length ${l}`);
  }
}
function bounds(m) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], m.positions[i + a]);
      max[a] = Math.max(max[a], m.positions[i + a]);
    }
  }
  return { min, max };
}
test("createCube: structural invariants and bounds", () => {
  const m = createCube(2);
  assert.equal(vertexCount(m), 24);
  assert.equal(m.indices.length, 36);
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  const b = bounds(m);
  for (let a = 0; a < 3; a++) {
    assert.ok(Math.abs(b.min[a] + 1) < 1e-6, `min[${a}] ~ -1`);
    assert.ok(Math.abs(b.max[a] - 1) < 1e-6, `max[${a}] ~ +1`);
  }
});
test("createBox: independent extents per axis, bounds match half-extents", () => {
  const m = createBox(2, 4, 6);
  assert.equal(vertexCount(m), 24);
  assert.equal(m.indices.length, 36);
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  const b = bounds(m);
  const half = [1, 2, 3];
  for (let a = 0; a < 3; a++) {
    assert.ok(Math.abs(b.min[a] + half[a]) < 1e-6, `min[${a}] ~ ${-half[a]}`);
    assert.ok(Math.abs(b.max[a] - half[a]) < 1e-6, `max[${a}] ~ ${half[a]}`);
  }
});
test("createSphere: structural invariants and radius bound", () => {
  const segments = 16;
  const radius = 1.5;
  const m = createSphere(radius, segments);
  assert.equal(vertexCount(m), (segments + 1) * (segments + 1));
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  for (let i = 0; i < m.positions.length; i += 3) {
    const r = Math.hypot(m.positions[i], m.positions[i + 1], m.positions[i + 2]);
    assert.ok(Math.abs(r - radius) < 1e-4, `vertex radius ${r} != ${radius}`);
  }
});
test("createCylinder: structural invariants, radius and height bounds", () => {
  const segments = 20;
  const m = createCylinder(0.5, 0.5, 2, segments);
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  const b = bounds(m);
  assert.ok(Math.abs(b.min[1] + 1) < 1e-6, `min y ~ -1: ${b.min[1]}`);
  assert.ok(Math.abs(b.max[1] - 1) < 1e-6, `max y ~ +1: ${b.max[1]}`);
  for (const a of [0, 2]) {
    assert.ok(b.max[a] <= 0.5 + 1e-6, `extent[${a}] within radius`);
    assert.ok(b.min[a] >= -0.5 - 1e-6, `extent[${a}] within radius`);
  }
});
test("createPlane: a single quad in the XZ plane", () => {
  const m = createPlane(20, 10);
  assert.equal(vertexCount(m), 4);
  assert.equal(m.indices.length, 6);
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  for (let i = 0; i < m.positions.length; i += 3) {
    assert.equal(m.positions[i + 1], 0, "plane vertex on y=0");
  }
  const b = bounds(m);
  assert.ok(Math.abs(b.max[0] - 10) < 1e-6 && Math.abs(b.min[0] + 10) < 1e-6, "width bounds");
  assert.ok(Math.abs(b.max[2] - 5) < 1e-6 && Math.abs(b.min[2] + 5) < 1e-6, "depth bounds");
});
test("createTorus: structural invariants and bounds", () => {
  const radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 16;
  const m = createTorus(radius, tube, radialSegments, tubularSegments);
  assert.equal(vertexCount(m), (tubularSegments + 1) * (radialSegments + 1));
  assertIndicesInRange(m);
  assertNormalsUnit(m);
  const b = bounds(m);
  const outer = radius + tube;
  assert.ok(b.max[0] <= outer + 1e-5 && b.max[2] <= outer + 1e-5, "within outer radius");
  assert.ok(Math.abs(b.max[1] - tube) < 1e-5, `max y ~ tube: ${b.max[1]}`);
  assert.ok(Math.abs(b.min[1] + tube) < 1e-5, `min y ~ -tube: ${b.min[1]}`);
});
function windingDots(m) {
  const dots = [];
  const P = m.positions, N = m.normals, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const i0 = I[t] * 3, i1 = I[t + 1] * 3, i2 = I[t + 2] * 3;
    const e1x = P[i1] - P[i0], e1y = P[i1 + 1] - P[i0 + 1], e1z = P[i1 + 2] - P[i0 + 2];
    const e2x = P[i2] - P[i0], e2y = P[i2 + 1] - P[i0 + 1], e2z = P[i2 + 2] - P[i0 + 2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    if (Math.hypot(cx, cy, cz) < 1e-9) continue;
    const nx = (N[i0] + N[i1] + N[i2]) / 3;
    const ny = (N[i0 + 1] + N[i1 + 1] + N[i2 + 1]) / 3;
    const nz = (N[i0 + 2] + N[i1 + 2] + N[i2 + 2]) / 3;
    dots.push({ tri: t / 3, dot: cx * nx + cy * ny + cz * nz });
  }
  return dots;
}
function windingCases() {
  return [
    ["createCube", createCube(2)],
    ["createBox", createBox(2, 4, 6)],
    ["createSphere", createSphere(1.5, 16)],
    ["createCylinder equal radii", createCylinder(0.5, 0.5, 2, 20)],
    ["createCylinder unequal radii", createCylinder(0.2, 0.7, 1.5, 16)],
    ["createCylinder cone (radiusTop 0)", createCylinder(0, 0.5, 1, 16)],
    ["createPlane", createPlane(20, 10)],
    ["createTorus", createTorus(1, 0.4, 12, 16)]
  ];
}
test("winding: every generator emits CCW-from-outside triangles", () => {
  for (const [label, m] of windingCases()) {
    const dots = windingDots(m);
    assert.ok(dots.length > 0, `${label}: has non-degenerate triangles`);
    for (const { tri, dot } of dots) {
      assert.ok(dot > 0, `${label}: triangle ${tri} winds CW (dot ${dot})`);
    }
  }
});
test("flipWinding: output winds CW everywhere (fails the CCW oracle)", () => {
  for (const [label, m] of windingCases()) {
    const dots = windingDots(flipWinding(m));
    assert.ok(dots.length > 0, `${label}: flipped mesh has non-degenerate triangles`);
    for (const { tri, dot } of dots) {
      assert.ok(dot < 0, `${label}: flipped triangle ${tri} still CCW (dot ${dot})`);
    }
  }
});
test("flipWinding: (a,b,c) -> (a,c,b), no mutation, arrays pass through, double flip round-trips", () => {
  const m = createCube(1);
  const before = Array.from(m.indices);
  const flipped = flipWinding(m);
  assert.equal(flipped.positions, m.positions, "positions array passed through");
  assert.equal(flipped.normals, m.normals, "normals array passed through");
  assert.notEqual(flipped.indices, m.indices, "indices are a new array");
  assert.deepEqual(Array.from(m.indices), before, "input indices unmutated");
  for (let t = 0; t < m.indices.length; t += 3) {
    assert.equal(flipped.indices[t], m.indices[t], `tri ${t / 3} keeps vertex 0`);
    assert.equal(flipped.indices[t + 1], m.indices[t + 2], `tri ${t / 3} vertex 1 <- 2`);
    assert.equal(flipped.indices[t + 2], m.indices[t + 1], `tri ${t / 3} vertex 2 <- 1`);
  }
  const twice = flipWinding(flipped);
  assert.deepEqual(Array.from(twice.indices), before, "double flip round-trips");
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiZ2VvbWV0cnkudGVzdC50cyIsICJnZW9tZXRyeS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gVGVzdHMgZm9yIHRoZSBwcm9jZWR1cmFsIG1lc2ggZ2VuZXJhdG9ycy5cblxuaW1wb3J0IHsgdGVzdCB9IGZyb20gJ25vZGU6dGVzdCc7XG5pbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0L3N0cmljdCc7XG5cbmltcG9ydCB7XG4gIGNyZWF0ZUN1YmUsIGNyZWF0ZVNwaGVyZSwgY3JlYXRlQ3lsaW5kZXIsIGNyZWF0ZVBsYW5lLCBjcmVhdGVCb3gsIGNyZWF0ZVRvcnVzLFxuICBmbGlwV2luZGluZyxcbn0gZnJvbSAnLi9nZW9tZXRyeS50cyc7XG5pbXBvcnQgdHlwZSB7IE1lc2ggfSBmcm9tICcuL2dlb21ldHJ5LnRzJztcblxuZnVuY3Rpb24gdmVydGV4Q291bnQobTogTWVzaCk6IG51bWJlciB7XG4gIGFzc2VydC5lcXVhbChtLnBvc2l0aW9ucy5sZW5ndGggJSAzLCAwLCAncG9zaXRpb25zIGxlbmd0aCBkaXZpc2libGUgYnkgMycpO1xuICBhc3NlcnQuZXF1YWwobS5ub3JtYWxzLmxlbmd0aCAlIDMsIDAsICdub3JtYWxzIGxlbmd0aCBkaXZpc2libGUgYnkgMycpO1xuICBhc3NlcnQuZXF1YWwobS5wb3NpdGlvbnMubGVuZ3RoLCBtLm5vcm1hbHMubGVuZ3RoLCAncG9zaXRpb25zIGFuZCBub3JtYWxzIHNhbWUgbGVuZ3RoJyk7XG4gIHJldHVybiBtLnBvc2l0aW9ucy5sZW5ndGggLyAzO1xufVxuXG5mdW5jdGlvbiBhc3NlcnRJbmRpY2VzSW5SYW5nZShtOiBNZXNoKTogdm9pZCB7XG4gIGNvbnN0IHZjID0gdmVydGV4Q291bnQobSk7XG4gIGFzc2VydC5lcXVhbChtLmluZGljZXMubGVuZ3RoICUgMywgMCwgJ2luZGljZXMgZm9ybSB3aG9sZSB0cmlhbmdsZXMnKTtcbiAgYXNzZXJ0Lm9rKG0uaW5kaWNlcy5sZW5ndGggPiAwLCAnaGFzIGF0IGxlYXN0IG9uZSB0cmlhbmdsZScpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IG0uaW5kaWNlcy5sZW5ndGg7IGkrKykge1xuICAgIGFzc2VydC5vayhtLmluZGljZXNbaV0gPCB2YywgYGluZGV4ICR7bS5pbmRpY2VzW2ldfSA+PSB2ZXJ0ZXhDb3VudCAke3ZjfWApO1xuICAgIGFzc2VydC5vayhtLmluZGljZXNbaV0gPj0gMCwgYGluZGV4ICR7bS5pbmRpY2VzW2ldfSBpcyBuZWdhdGl2ZWApO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFzc2VydE5vcm1hbHNVbml0KG06IE1lc2gsIHRvbCA9IDFlLTMpOiB2b2lkIHtcbiAgY29uc3QgdmMgPSB2ZXJ0ZXhDb3VudChtKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB2YzsgaSsrKSB7XG4gICAgY29uc3QgeCA9IG0ubm9ybWFsc1tpICogM10sIHkgPSBtLm5vcm1hbHNbaSAqIDMgKyAxXSwgeiA9IG0ubm9ybWFsc1tpICogMyArIDJdO1xuICAgIGNvbnN0IGwgPSBNYXRoLmh5cG90KHgsIHksIHopO1xuICAgIGFzc2VydC5vayhNYXRoLmFicyhsIC0gMSkgPCB0b2wsIGBub3JtYWwgJHtpfSBsZW5ndGggJHtsfWApO1xuICB9XG59XG5cbmZ1bmN0aW9uIGJvdW5kcyhtOiBNZXNoKTogeyBtaW46IG51bWJlcltdOyBtYXg6IG51bWJlcltdIH0ge1xuICBjb25zdCBtaW4gPSBbSW5maW5pdHksIEluZmluaXR5LCBJbmZpbml0eV07XG4gIGNvbnN0IG1heCA9IFstSW5maW5pdHksIC1JbmZpbml0eSwgLUluZmluaXR5XTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBtLnBvc2l0aW9ucy5sZW5ndGg7IGkgKz0gMykge1xuICAgIGZvciAobGV0IGEgPSAwOyBhIDwgMzsgYSsrKSB7XG4gICAgICBtaW5bYV0gPSBNYXRoLm1pbihtaW5bYV0sIG0ucG9zaXRpb25zW2kgKyBhXSk7XG4gICAgICBtYXhbYV0gPSBNYXRoLm1heChtYXhbYV0sIG0ucG9zaXRpb25zW2kgKyBhXSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IG1pbiwgbWF4IH07XG59XG5cbnRlc3QoJ2NyZWF0ZUN1YmU6IHN0cnVjdHVyYWwgaW52YXJpYW50cyBhbmQgYm91bmRzJywgKCkgPT4ge1xuICBjb25zdCBtID0gY3JlYXRlQ3ViZSgyKTtcbiAgYXNzZXJ0LmVxdWFsKHZlcnRleENvdW50KG0pLCAyNCk7XG4gIGFzc2VydC5lcXVhbChtLmluZGljZXMubGVuZ3RoLCAzNik7XG4gIGFzc2VydEluZGljZXNJblJhbmdlKG0pO1xuICBhc3NlcnROb3JtYWxzVW5pdChtKTtcbiAgY29uc3QgYiA9IGJvdW5kcyhtKTtcbiAgZm9yIChsZXQgYSA9IDA7IGEgPCAzOyBhKyspIHtcbiAgICBhc3NlcnQub2soTWF0aC5hYnMoYi5taW5bYV0gKyAxKSA8IDFlLTYsIGBtaW5bJHthfV0gfiAtMWApO1xuICAgIGFzc2VydC5vayhNYXRoLmFicyhiLm1heFthXSAtIDEpIDwgMWUtNiwgYG1heFske2F9XSB+ICsxYCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdjcmVhdGVCb3g6IGluZGVwZW5kZW50IGV4dGVudHMgcGVyIGF4aXMsIGJvdW5kcyBtYXRjaCBoYWxmLWV4dGVudHMnLCAoKSA9PiB7XG4gIGNvbnN0IG0gPSBjcmVhdGVCb3goMiwgNCwgNik7XG4gIGFzc2VydC5lcXVhbCh2ZXJ0ZXhDb3VudChtKSwgMjQpO1xuICBhc3NlcnQuZXF1YWwobS5pbmRpY2VzLmxlbmd0aCwgMzYpO1xuICBhc3NlcnRJbmRpY2VzSW5SYW5nZShtKTtcbiAgYXNzZXJ0Tm9ybWFsc1VuaXQobSk7XG4gIGNvbnN0IGIgPSBib3VuZHMobSk7XG4gIGNvbnN0IGhhbGYgPSBbMSwgMiwgM107XG4gIGZvciAobGV0IGEgPSAwOyBhIDwgMzsgYSsrKSB7XG4gICAgYXNzZXJ0Lm9rKE1hdGguYWJzKGIubWluW2FdICsgaGFsZlthXSkgPCAxZS02LCBgbWluWyR7YX1dIH4gJHstaGFsZlthXX1gKTtcbiAgICBhc3NlcnQub2soTWF0aC5hYnMoYi5tYXhbYV0gLSBoYWxmW2FdKSA8IDFlLTYsIGBtYXhbJHthfV0gfiAke2hhbGZbYV19YCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdjcmVhdGVTcGhlcmU6IHN0cnVjdHVyYWwgaW52YXJpYW50cyBhbmQgcmFkaXVzIGJvdW5kJywgKCkgPT4ge1xuICBjb25zdCBzZWdtZW50cyA9IDE2O1xuICBjb25zdCByYWRpdXMgPSAxLjU7XG4gIGNvbnN0IG0gPSBjcmVhdGVTcGhlcmUocmFkaXVzLCBzZWdtZW50cyk7XG4gIGFzc2VydC5lcXVhbCh2ZXJ0ZXhDb3VudChtKSwgKHNlZ21lbnRzICsgMSkgKiAoc2VnbWVudHMgKyAxKSk7XG4gIGFzc2VydEluZGljZXNJblJhbmdlKG0pO1xuICBhc3NlcnROb3JtYWxzVW5pdChtKTtcbiAgLy8gRXZlcnkgdmVydGV4IHNpdHMgb24gdGhlIHNwaGVyZSBvZiB0aGUgZ2l2ZW4gcmFkaXVzLlxuICBmb3IgKGxldCBpID0gMDsgaSA8IG0ucG9zaXRpb25zLmxlbmd0aDsgaSArPSAzKSB7XG4gICAgY29uc3QgciA9IE1hdGguaHlwb3QobS5wb3NpdGlvbnNbaV0sIG0ucG9zaXRpb25zW2kgKyAxXSwgbS5wb3NpdGlvbnNbaSArIDJdKTtcbiAgICBhc3NlcnQub2soTWF0aC5hYnMociAtIHJhZGl1cykgPCAxZS00LCBgdmVydGV4IHJhZGl1cyAke3J9ICE9ICR7cmFkaXVzfWApO1xuICB9XG59KTtcblxudGVzdCgnY3JlYXRlQ3lsaW5kZXI6IHN0cnVjdHVyYWwgaW52YXJpYW50cywgcmFkaXVzIGFuZCBoZWlnaHQgYm91bmRzJywgKCkgPT4ge1xuICBjb25zdCBzZWdtZW50cyA9IDIwO1xuICBjb25zdCBtID0gY3JlYXRlQ3lsaW5kZXIoMC41LCAwLjUsIDIsIHNlZ21lbnRzKTtcbiAgYXNzZXJ0SW5kaWNlc0luUmFuZ2UobSk7XG4gIGFzc2VydE5vcm1hbHNVbml0KG0pO1xuICBjb25zdCBiID0gYm91bmRzKG0pO1xuICBhc3NlcnQub2soTWF0aC5hYnMoYi5taW5bMV0gKyAxKSA8IDFlLTYsIGBtaW4geSB+IC0xOiAke2IubWluWzFdfWApO1xuICBhc3NlcnQub2soTWF0aC5hYnMoYi5tYXhbMV0gLSAxKSA8IDFlLTYsIGBtYXggeSB+ICsxOiAke2IubWF4WzFdfWApO1xuICBmb3IgKGNvbnN0IGEgb2YgWzAsIDJdKSB7XG4gICAgYXNzZXJ0Lm9rKGIubWF4W2FdIDw9IDAuNSArIDFlLTYsIGBleHRlbnRbJHthfV0gd2l0aGluIHJhZGl1c2ApO1xuICAgIGFzc2VydC5vayhiLm1pblthXSA+PSAtMC41IC0gMWUtNiwgYGV4dGVudFske2F9XSB3aXRoaW4gcmFkaXVzYCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdjcmVhdGVQbGFuZTogYSBzaW5nbGUgcXVhZCBpbiB0aGUgWFogcGxhbmUnLCAoKSA9PiB7XG4gIGNvbnN0IG0gPSBjcmVhdGVQbGFuZSgyMCwgMTApO1xuICBhc3NlcnQuZXF1YWwodmVydGV4Q291bnQobSksIDQpO1xuICBhc3NlcnQuZXF1YWwobS5pbmRpY2VzLmxlbmd0aCwgNik7XG4gIGFzc2VydEluZGljZXNJblJhbmdlKG0pO1xuICBhc3NlcnROb3JtYWxzVW5pdChtKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBtLnBvc2l0aW9ucy5sZW5ndGg7IGkgKz0gMykge1xuICAgIGFzc2VydC5lcXVhbChtLnBvc2l0aW9uc1tpICsgMV0sIDAsICdwbGFuZSB2ZXJ0ZXggb24geT0wJyk7XG4gIH1cbiAgY29uc3QgYiA9IGJvdW5kcyhtKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGIubWF4WzBdIC0gMTApIDwgMWUtNiAmJiBNYXRoLmFicyhiLm1pblswXSArIDEwKSA8IDFlLTYsICd3aWR0aCBib3VuZHMnKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGIubWF4WzJdIC0gNSkgPCAxZS02ICYmIE1hdGguYWJzKGIubWluWzJdICsgNSkgPCAxZS02LCAnZGVwdGggYm91bmRzJyk7XG59KTtcblxudGVzdCgnY3JlYXRlVG9ydXM6IHN0cnVjdHVyYWwgaW52YXJpYW50cyBhbmQgYm91bmRzJywgKCkgPT4ge1xuICBjb25zdCByYWRpdXMgPSAxLCB0dWJlID0gMC40LCByYWRpYWxTZWdtZW50cyA9IDEyLCB0dWJ1bGFyU2VnbWVudHMgPSAxNjtcbiAgY29uc3QgbSA9IGNyZWF0ZVRvcnVzKHJhZGl1cywgdHViZSwgcmFkaWFsU2VnbWVudHMsIHR1YnVsYXJTZWdtZW50cyk7XG4gIGFzc2VydC5lcXVhbCh2ZXJ0ZXhDb3VudChtKSwgKHR1YnVsYXJTZWdtZW50cyArIDEpICogKHJhZGlhbFNlZ21lbnRzICsgMSkpO1xuICBhc3NlcnRJbmRpY2VzSW5SYW5nZShtKTtcbiAgYXNzZXJ0Tm9ybWFsc1VuaXQobSk7XG4gIGNvbnN0IGIgPSBib3VuZHMobSk7XG4gIC8vIE91dGVyIHJhZGl1cyA9IHJhZGl1cyArIHR1YmUgaW4gdGhlIFhaIHBsYW5lOyB0aGUgdHViZSByZWFjaGVzICsvLXR1YmUgaW4gWS5cbiAgY29uc3Qgb3V0ZXIgPSByYWRpdXMgKyB0dWJlO1xuICBhc3NlcnQub2soYi5tYXhbMF0gPD0gb3V0ZXIgKyAxZS01ICYmIGIubWF4WzJdIDw9IG91dGVyICsgMWUtNSwgJ3dpdGhpbiBvdXRlciByYWRpdXMnKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGIubWF4WzFdIC0gdHViZSkgPCAxZS01LCBgbWF4IHkgfiB0dWJlOiAke2IubWF4WzFdfWApO1xuICBhc3NlcnQub2soTWF0aC5hYnMoYi5taW5bMV0gKyB0dWJlKSA8IDFlLTUsIGBtaW4geSB+IC10dWJlOiAke2IubWluWzFdfWApO1xufSk7XG5cbi8vIFdpbmRpbmcgb3JhY2xlOiBmb3IgZWFjaCBub24tZGVnZW5lcmF0ZSB0cmlhbmdsZSwgdGhlIGdlb21ldHJpYyBub3JtYWxcbi8vIGNyb3NzKHAxIC0gcDAsIHAyIC0gcDApIG11c3QgYWdyZWUgd2l0aCB0aGUgYXZlcmFnZSBvZiB0aG9zZSBzdG9yZWQgdmVydGV4XG4vLyBub3JtYWxzIChkb3QgPiAwKSBcdTIwMTQgaS5lLiB0aGUgdHJpYW5nbGUgaXMgY291bnRlci1jbG9ja3dpc2Ugdmlld2VkIGZyb21cbi8vIG91dHNpZGUsIGZyb250LWZhY2luZyB1bmRlciBXZWJHUFUncyBkZWZhdWx0IGZyb250RmFjZTogJ2NjdycuIFplcm8tYXJlYVxuLy8gdHJpYW5nbGVzIChlLmcuIHNwaGVyZSBwb2xlIHJvd3MsIGEgY29uZSdzIGFwZXggcm93KSBhcmUgc2tpcHBlZC5cbmZ1bmN0aW9uIHdpbmRpbmdEb3RzKG06IE1lc2gpOiB7IHRyaTogbnVtYmVyOyBkb3Q6IG51bWJlciB9W10ge1xuICBjb25zdCBkb3RzOiB7IHRyaTogbnVtYmVyOyBkb3Q6IG51bWJlciB9W10gPSBbXTtcbiAgY29uc3QgUCA9IG0ucG9zaXRpb25zLCBOID0gbS5ub3JtYWxzLCBJID0gbS5pbmRpY2VzO1xuICBmb3IgKGxldCB0ID0gMDsgdCA8IEkubGVuZ3RoOyB0ICs9IDMpIHtcbiAgICBjb25zdCBpMCA9IElbdF0gKiAzLCBpMSA9IElbdCArIDFdICogMywgaTIgPSBJW3QgKyAyXSAqIDM7XG4gICAgY29uc3QgZTF4ID0gUFtpMV0gLSBQW2kwXSwgZTF5ID0gUFtpMSArIDFdIC0gUFtpMCArIDFdLCBlMXogPSBQW2kxICsgMl0gLSBQW2kwICsgMl07XG4gICAgY29uc3QgZTJ4ID0gUFtpMl0gLSBQW2kwXSwgZTJ5ID0gUFtpMiArIDFdIC0gUFtpMCArIDFdLCBlMnogPSBQW2kyICsgMl0gLSBQW2kwICsgMl07XG4gICAgY29uc3QgY3ggPSBlMXkgKiBlMnogLSBlMXogKiBlMnk7XG4gICAgY29uc3QgY3kgPSBlMXogKiBlMnggLSBlMXggKiBlMno7XG4gICAgY29uc3QgY3ogPSBlMXggKiBlMnkgLSBlMXkgKiBlMng7XG4gICAgaWYgKE1hdGguaHlwb3QoY3gsIGN5LCBjeikgPCAxZS05KSBjb250aW51ZTsgLy8gemVyby1hcmVhIHRyaWFuZ2xlXG4gICAgY29uc3QgbnggPSAoTltpMF0gKyBOW2kxXSArIE5baTJdKSAvIDM7XG4gICAgY29uc3QgbnkgPSAoTltpMCArIDFdICsgTltpMSArIDFdICsgTltpMiArIDFdKSAvIDM7XG4gICAgY29uc3QgbnogPSAoTltpMCArIDJdICsgTltpMSArIDJdICsgTltpMiArIDJdKSAvIDM7XG4gICAgZG90cy5wdXNoKHsgdHJpOiB0IC8gMywgZG90OiBjeCAqIG54ICsgY3kgKiBueSArIGN6ICogbnogfSk7XG4gIH1cbiAgcmV0dXJuIGRvdHM7XG59XG5cbmZ1bmN0aW9uIHdpbmRpbmdDYXNlcygpOiBbc3RyaW5nLCBNZXNoXVtdIHtcbiAgcmV0dXJuIFtcbiAgICBbJ2NyZWF0ZUN1YmUnLCBjcmVhdGVDdWJlKDIpXSxcbiAgICBbJ2NyZWF0ZUJveCcsIGNyZWF0ZUJveCgyLCA0LCA2KV0sXG4gICAgWydjcmVhdGVTcGhlcmUnLCBjcmVhdGVTcGhlcmUoMS41LCAxNildLFxuICAgIFsnY3JlYXRlQ3lsaW5kZXIgZXF1YWwgcmFkaWknLCBjcmVhdGVDeWxpbmRlcigwLjUsIDAuNSwgMiwgMjApXSxcbiAgICBbJ2NyZWF0ZUN5bGluZGVyIHVuZXF1YWwgcmFkaWknLCBjcmVhdGVDeWxpbmRlcigwLjIsIDAuNywgMS41LCAxNildLFxuICAgIFsnY3JlYXRlQ3lsaW5kZXIgY29uZSAocmFkaXVzVG9wIDApJywgY3JlYXRlQ3lsaW5kZXIoMCwgMC41LCAxLCAxNildLFxuICAgIFsnY3JlYXRlUGxhbmUnLCBjcmVhdGVQbGFuZSgyMCwgMTApXSxcbiAgICBbJ2NyZWF0ZVRvcnVzJywgY3JlYXRlVG9ydXMoMSwgMC40LCAxMiwgMTYpXSxcbiAgXTtcbn1cblxudGVzdCgnd2luZGluZzogZXZlcnkgZ2VuZXJhdG9yIGVtaXRzIENDVy1mcm9tLW91dHNpZGUgdHJpYW5nbGVzJywgKCkgPT4ge1xuICBmb3IgKGNvbnN0IFtsYWJlbCwgbV0gb2Ygd2luZGluZ0Nhc2VzKCkpIHtcbiAgICBjb25zdCBkb3RzID0gd2luZGluZ0RvdHMobSk7XG4gICAgYXNzZXJ0Lm9rKGRvdHMubGVuZ3RoID4gMCwgYCR7bGFiZWx9OiBoYXMgbm9uLWRlZ2VuZXJhdGUgdHJpYW5nbGVzYCk7XG4gICAgZm9yIChjb25zdCB7IHRyaSwgZG90IH0gb2YgZG90cykge1xuICAgICAgYXNzZXJ0Lm9rKGRvdCA+IDAsIGAke2xhYmVsfTogdHJpYW5nbGUgJHt0cml9IHdpbmRzIENXIChkb3QgJHtkb3R9KWApO1xuICAgIH1cbiAgfVxufSk7XG5cbnRlc3QoJ2ZsaXBXaW5kaW5nOiBvdXRwdXQgd2luZHMgQ1cgZXZlcnl3aGVyZSAoZmFpbHMgdGhlIENDVyBvcmFjbGUpJywgKCkgPT4ge1xuICBmb3IgKGNvbnN0IFtsYWJlbCwgbV0gb2Ygd2luZGluZ0Nhc2VzKCkpIHtcbiAgICBjb25zdCBkb3RzID0gd2luZGluZ0RvdHMoZmxpcFdpbmRpbmcobSkpO1xuICAgIGFzc2VydC5vayhkb3RzLmxlbmd0aCA+IDAsIGAke2xhYmVsfTogZmxpcHBlZCBtZXNoIGhhcyBub24tZGVnZW5lcmF0ZSB0cmlhbmdsZXNgKTtcbiAgICBmb3IgKGNvbnN0IHsgdHJpLCBkb3QgfSBvZiBkb3RzKSB7XG4gICAgICBhc3NlcnQub2soZG90IDwgMCwgYCR7bGFiZWx9OiBmbGlwcGVkIHRyaWFuZ2xlICR7dHJpfSBzdGlsbCBDQ1cgKGRvdCAke2RvdH0pYCk7XG4gICAgfVxuICB9XG59KTtcblxudGVzdCgnZmxpcFdpbmRpbmc6IChhLGIsYykgLT4gKGEsYyxiKSwgbm8gbXV0YXRpb24sIGFycmF5cyBwYXNzIHRocm91Z2gsIGRvdWJsZSBmbGlwIHJvdW5kLXRyaXBzJywgKCkgPT4ge1xuICBjb25zdCBtID0gY3JlYXRlQ3ViZSgxKTtcbiAgY29uc3QgYmVmb3JlID0gQXJyYXkuZnJvbShtLmluZGljZXMpO1xuICBjb25zdCBmbGlwcGVkID0gZmxpcFdpbmRpbmcobSk7XG4gIC8vIFBvc2l0aW9ucy9ub3JtYWxzIGFyZSB0aGUgU0FNRSBhcnJheXM7IGluZGljZXMgYXJlIGEgTkVXIGFycmF5LlxuICBhc3NlcnQuZXF1YWwoZmxpcHBlZC5wb3NpdGlvbnMsIG0ucG9zaXRpb25zLCAncG9zaXRpb25zIGFycmF5IHBhc3NlZCB0aHJvdWdoJyk7XG4gIGFzc2VydC5lcXVhbChmbGlwcGVkLm5vcm1hbHMsIG0ubm9ybWFscywgJ25vcm1hbHMgYXJyYXkgcGFzc2VkIHRocm91Z2gnKTtcbiAgYXNzZXJ0Lm5vdEVxdWFsKGZsaXBwZWQuaW5kaWNlcywgbS5pbmRpY2VzLCAnaW5kaWNlcyBhcmUgYSBuZXcgYXJyYXknKTtcbiAgLy8gSW5wdXQgdW50b3VjaGVkLlxuICBhc3NlcnQuZGVlcEVxdWFsKEFycmF5LmZyb20obS5pbmRpY2VzKSwgYmVmb3JlLCAnaW5wdXQgaW5kaWNlcyB1bm11dGF0ZWQnKTtcbiAgLy8gRWFjaCB0cmlhbmdsZSAoYSwgYiwgYykgYmVjYW1lIChhLCBjLCBiKS5cbiAgZm9yIChsZXQgdCA9IDA7IHQgPCBtLmluZGljZXMubGVuZ3RoOyB0ICs9IDMpIHtcbiAgICBhc3NlcnQuZXF1YWwoZmxpcHBlZC5pbmRpY2VzW3RdLCBtLmluZGljZXNbdF0sIGB0cmkgJHt0IC8gM30ga2VlcHMgdmVydGV4IDBgKTtcbiAgICBhc3NlcnQuZXF1YWwoZmxpcHBlZC5pbmRpY2VzW3QgKyAxXSwgbS5pbmRpY2VzW3QgKyAyXSwgYHRyaSAke3QgLyAzfSB2ZXJ0ZXggMSA8LSAyYCk7XG4gICAgYXNzZXJ0LmVxdWFsKGZsaXBwZWQuaW5kaWNlc1t0ICsgMl0sIG0uaW5kaWNlc1t0ICsgMV0sIGB0cmkgJHt0IC8gM30gdmVydGV4IDIgPC0gMWApO1xuICB9XG4gIC8vIEZsaXBwaW5nIHR3aWNlIHJlc3RvcmVzIHRoZSBpbmRleCBvcmRlciBleGFjdGx5LlxuICBjb25zdCB0d2ljZSA9IGZsaXBXaW5kaW5nKGZsaXBwZWQpO1xuICBhc3NlcnQuZGVlcEVxdWFsKEFycmF5LmZyb20odHdpY2UuaW5kaWNlcyksIGJlZm9yZSwgJ2RvdWJsZSBmbGlwIHJvdW5kLXRyaXBzJyk7XG59KTtcbiIsICIvLyBQcm9jZWR1cmFsIG1lc2ggZ2VuZXJhdG9ycy4gRWFjaCByZXR1cm5zIHsgcG9zaXRpb25zLCBub3JtYWxzLCBpbmRpY2VzIH0gYXNcbi8vIHR5cGVkIGFycmF5cy5cblxuZXhwb3J0IGludGVyZmFjZSBNZXNoIHtcbiAgcG9zaXRpb25zOiBGbG9hdDMyQXJyYXk7XG4gIG5vcm1hbHM6IEZsb2F0MzJBcnJheTtcbiAgaW5kaWNlczogVWludDE2QXJyYXk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDdWJlKHNpemUgPSAxKTogTWVzaCB7XG4gIGNvbnN0IGggPSBzaXplIC8gMjtcbiAgY29uc3QgcCA9IFtcbiAgICAvLyArWlxuICAgIC1oLC1oLCBoLCAgaCwtaCwgaCwgIGgsIGgsIGgsIC1oLCBoLCBoLFxuICAgIC8vIC1aXG4gICAgIGgsLWgsLWgsIC1oLC1oLC1oLCAtaCwgaCwtaCwgIGgsIGgsLWgsXG4gICAgLy8gK1hcbiAgICAgaCwtaCwgaCwgIGgsLWgsLWgsICBoLCBoLC1oLCAgaCwgaCwgaCxcbiAgICAvLyAtWFxuICAgIC1oLC1oLC1oLCAtaCwtaCwgaCwgLWgsIGgsIGgsIC1oLCBoLC1oLFxuICAgIC8vICtZXG4gICAgLWgsIGgsIGgsICBoLCBoLCBoLCAgaCwgaCwtaCwgLWgsIGgsLWgsXG4gICAgLy8gLVlcbiAgICAtaCwtaCwtaCwgIGgsLWgsLWgsICBoLC1oLCBoLCAtaCwtaCwgaCxcbiAgXTtcbiAgY29uc3QgbiA9IFtcbiAgICAwLDAsMSwgMCwwLDEsIDAsMCwxLCAwLDAsMSxcbiAgICAwLDAsLTEsIDAsMCwtMSwgMCwwLC0xLCAwLDAsLTEsXG4gICAgMSwwLDAsIDEsMCwwLCAxLDAsMCwgMSwwLDAsXG4gICAgLTEsMCwwLCAtMSwwLDAsIC0xLDAsMCwgLTEsMCwwLFxuICAgIDAsMSwwLCAwLDEsMCwgMCwxLDAsIDAsMSwwLFxuICAgIDAsLTEsMCwgMCwtMSwwLCAwLC0xLDAsIDAsLTEsMCxcbiAgXTtcbiAgY29uc3QgaWR4OiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBmID0gMDsgZiA8IDY7IGYrKykge1xuICAgIGNvbnN0IG8gPSBmICogNDtcbiAgICBpZHgucHVzaChvLCBvKzEsIG8rMiwgbywgbysyLCBvKzMpO1xuICB9XG4gIHJldHVybiB7XG4gICAgcG9zaXRpb25zOiBuZXcgRmxvYXQzMkFycmF5KHApLFxuICAgIG5vcm1hbHM6IG5ldyBGbG9hdDMyQXJyYXkobiksXG4gICAgaW5kaWNlczogbmV3IFVpbnQxNkFycmF5KGlkeCksXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTcGhlcmUocmFkaXVzID0gMSwgc2VnbWVudHMgPSAyNCk6IE1lc2gge1xuICBjb25zdCByaW5ncyA9IHNlZ21lbnRzO1xuICBjb25zdCBzZWN0b3JzID0gc2VnbWVudHM7XG4gIGNvbnN0IHBvc2l0aW9uczogbnVtYmVyW10gPSBbXTtcbiAgY29uc3Qgbm9ybWFsczogbnVtYmVyW10gPSBbXTtcbiAgY29uc3QgaW5kaWNlczogbnVtYmVyW10gPSBbXTtcblxuICBmb3IgKGxldCByID0gMDsgciA8PSByaW5nczsgcisrKSB7XG4gICAgY29uc3QgcGhpID0gTWF0aC5QSSAqIHIgLyByaW5ncztcbiAgICBjb25zdCBzcCA9IE1hdGguc2luKHBoaSksIGNwID0gTWF0aC5jb3MocGhpKTtcbiAgICBmb3IgKGxldCBzID0gMDsgcyA8PSBzZWN0b3JzOyBzKyspIHtcbiAgICAgIGNvbnN0IHRoZXRhID0gMiAqIE1hdGguUEkgKiBzIC8gc2VjdG9ycztcbiAgICAgIGNvbnN0IHN0ID0gTWF0aC5zaW4odGhldGEpLCBjdCA9IE1hdGguY29zKHRoZXRhKTtcbiAgICAgIGNvbnN0IG54ID0gY3QgKiBzcCwgbnkgPSBjcCwgbnogPSBzdCAqIHNwO1xuICAgICAgcG9zaXRpb25zLnB1c2gocmFkaXVzICogbngsIHJhZGl1cyAqIG55LCByYWRpdXMgKiBueik7XG4gICAgICBub3JtYWxzLnB1c2gobngsIG55LCBueik7XG4gICAgfVxuICB9XG5cbiAgZm9yIChsZXQgciA9IDA7IHIgPCByaW5nczsgcisrKSB7XG4gICAgZm9yIChsZXQgcyA9IDA7IHMgPCBzZWN0b3JzOyBzKyspIHtcbiAgICAgIGNvbnN0IGEgPSByICogKHNlY3RvcnMgKyAxKSArIHM7XG4gICAgICBjb25zdCBiID0gYSArIHNlY3RvcnMgKyAxO1xuICAgICAgaW5kaWNlcy5wdXNoKGEsIGEgKyAxLCBiLCBhICsgMSwgYiArIDEsIGIpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcG9zaXRpb25zOiBuZXcgRmxvYXQzMkFycmF5KHBvc2l0aW9ucyksXG4gICAgbm9ybWFsczogbmV3IEZsb2F0MzJBcnJheShub3JtYWxzKSxcbiAgICBpbmRpY2VzOiBuZXcgVWludDE2QXJyYXkoaW5kaWNlcyksXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDeWxpbmRlcihyYWRpdXNUb3AgPSAwLjUsIHJhZGl1c0JvdHRvbSA9IDAuNSwgaGVpZ2h0ID0gMSwgc2VnbWVudHMgPSAyNCk6IE1lc2gge1xuICBjb25zdCBwb3NpdGlvbnM6IG51bWJlcltdID0gW107XG4gIGNvbnN0IG5vcm1hbHM6IG51bWJlcltdID0gW107XG4gIGNvbnN0IGluZGljZXM6IG51bWJlcltdID0gW107XG4gIGNvbnN0IGhhbGZIID0gaGVpZ2h0IC8gMjtcblxuICAvLyBTaWRlXG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IHNlZ21lbnRzOyBpKyspIHtcbiAgICBjb25zdCB0aGV0YSA9IDIgKiBNYXRoLlBJICogaSAvIHNlZ21lbnRzO1xuICAgIGNvbnN0IGN0ID0gTWF0aC5jb3ModGhldGEpLCBzdCA9IE1hdGguc2luKHRoZXRhKTtcbiAgICBjb25zdCBkciA9IHJhZGl1c0JvdHRvbSAtIHJhZGl1c1RvcDtcbiAgICBjb25zdCBsZW4gPSBNYXRoLmh5cG90KGRyLCBoZWlnaHQpIHx8IDE7XG4gICAgY29uc3QgbnggPSBjdCAqIGhlaWdodCAvIGxlbiwgbnogPSBzdCAqIGhlaWdodCAvIGxlbiwgbnkgPSBkciAvIGxlbjtcblxuICAgIHBvc2l0aW9ucy5wdXNoKHJhZGl1c1RvcCAqIGN0LCBoYWxmSCwgcmFkaXVzVG9wICogc3QpO1xuICAgIG5vcm1hbHMucHVzaChueCwgbnksIG56KTtcbiAgICBwb3NpdGlvbnMucHVzaChyYWRpdXNCb3R0b20gKiBjdCwgLWhhbGZILCByYWRpdXNCb3R0b20gKiBzdCk7XG4gICAgbm9ybWFscy5wdXNoKG54LCBueSwgbnopO1xuICB9XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHM7IGkrKykge1xuICAgIGNvbnN0IGEgPSBpICogMiwgYiA9IGEgKyAxLCBjID0gYSArIDIsIGQgPSBhICsgMztcbiAgICBpbmRpY2VzLnB1c2goYSwgYywgYiwgYiwgYywgZCk7XG4gIH1cblxuICAvLyBUb3AgY2FwXG4gIGNvbnN0IHRvcENlbnRlciA9IHBvc2l0aW9ucy5sZW5ndGggLyAzO1xuICBwb3NpdGlvbnMucHVzaCgwLCBoYWxmSCwgMCk7XG4gIG5vcm1hbHMucHVzaCgwLCAxLCAwKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gc2VnbWVudHM7IGkrKykge1xuICAgIGNvbnN0IHRoZXRhID0gMiAqIE1hdGguUEkgKiBpIC8gc2VnbWVudHM7XG4gICAgcG9zaXRpb25zLnB1c2gocmFkaXVzVG9wICogTWF0aC5jb3ModGhldGEpLCBoYWxmSCwgcmFkaXVzVG9wICogTWF0aC5zaW4odGhldGEpKTtcbiAgICBub3JtYWxzLnB1c2goMCwgMSwgMCk7XG4gIH1cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50czsgaSsrKSB7XG4gICAgaW5kaWNlcy5wdXNoKHRvcENlbnRlciwgdG9wQ2VudGVyICsgMiArIGksIHRvcENlbnRlciArIDEgKyBpKTtcbiAgfVxuXG4gIC8vIEJvdHRvbSBjYXBcbiAgY29uc3QgYm90Q2VudGVyID0gcG9zaXRpb25zLmxlbmd0aCAvIDM7XG4gIHBvc2l0aW9ucy5wdXNoKDAsIC1oYWxmSCwgMCk7XG4gIG5vcm1hbHMucHVzaCgwLCAtMSwgMCk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IHNlZ21lbnRzOyBpKyspIHtcbiAgICBjb25zdCB0aGV0YSA9IDIgKiBNYXRoLlBJICogaSAvIHNlZ21lbnRzO1xuICAgIHBvc2l0aW9ucy5wdXNoKHJhZGl1c0JvdHRvbSAqIE1hdGguY29zKHRoZXRhKSwgLWhhbGZILCByYWRpdXNCb3R0b20gKiBNYXRoLnNpbih0aGV0YSkpO1xuICAgIG5vcm1hbHMucHVzaCgwLCAtMSwgMCk7XG4gIH1cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50czsgaSsrKSB7XG4gICAgaW5kaWNlcy5wdXNoKGJvdENlbnRlciwgYm90Q2VudGVyICsgMSArIGksIGJvdENlbnRlciArIDIgKyBpKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcG9zaXRpb25zOiBuZXcgRmxvYXQzMkFycmF5KHBvc2l0aW9ucyksXG4gICAgbm9ybWFsczogbmV3IEZsb2F0MzJBcnJheShub3JtYWxzKSxcbiAgICBpbmRpY2VzOiBuZXcgVWludDE2QXJyYXkoaW5kaWNlcyksXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVQbGFuZSh3aWR0aCA9IDIwLCBkZXB0aCA9IDIwKTogTWVzaCB7XG4gIGNvbnN0IGh3ID0gd2lkdGggLyAyLCBoZCA9IGRlcHRoIC8gMjtcbiAgcmV0dXJuIHtcbiAgICBwb3NpdGlvbnM6IG5ldyBGbG9hdDMyQXJyYXkoW1xuICAgICAgLWh3LCAwLCAtaGQsICBodywgMCwgLWhkLCAgaHcsIDAsIGhkLCAtaHcsIDAsIGhkLFxuICAgIF0pLFxuICAgIG5vcm1hbHM6IG5ldyBGbG9hdDMyQXJyYXkoW1xuICAgICAgMCwgMSwgMCwgIDAsIDEsIDAsICAwLCAxLCAwLCAgMCwgMSwgMCxcbiAgICBdKSxcbiAgICBpbmRpY2VzOiBuZXcgVWludDE2QXJyYXkoWzAsIDIsIDEsIDAsIDMsIDJdKSxcbiAgfTtcbn1cblxuLyoqXG4gKiBBeGlzLWFsaWduZWQgYm94IGNlbnRyZWQgYXQgdGhlIG9yaWdpbiB3aXRoIGluZGVwZW5kZW50IGZ1bGwgZXh0ZW50cyBwZXIgYXhpcy5cbiAqIChgY3JlYXRlQ3ViZWAgaXMgdGhlIHVuaWZvcm0tc2l6ZSBzcGVjaWFsIGNhc2UuKVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQm94KHdpZHRoID0gMSwgaGVpZ2h0ID0gMSwgZGVwdGggPSAxKTogTWVzaCB7XG4gIGNvbnN0IFggPSB3aWR0aCAvIDIsIFkgPSBoZWlnaHQgLyAyLCBaID0gZGVwdGggLyAyO1xuICBjb25zdCBwb3NpdGlvbnM6IG51bWJlcltdID0gW107XG4gIGNvbnN0IG5vcm1hbHM6IG51bWJlcltdID0gW107XG4gIGNvbnN0IGluZGljZXM6IG51bWJlcltdID0gW107XG4gIGxldCBiYXNlID0gMDtcbiAgY29uc3QgcXVhZCA9IChuOiBudW1iZXJbXSwgYTogbnVtYmVyW10sIGI6IG51bWJlcltdLCBjOiBudW1iZXJbXSwgZDogbnVtYmVyW10pID0+IHtcbiAgICBmb3IgKGNvbnN0IHYgb2YgW2EsIGIsIGMsIGRdKSB7IHBvc2l0aW9ucy5wdXNoKHZbMF0sIHZbMV0sIHZbMl0pOyBub3JtYWxzLnB1c2goblswXSwgblsxXSwgblsyXSk7IH1cbiAgICBpbmRpY2VzLnB1c2goYmFzZSwgYmFzZSArIDEsIGJhc2UgKyAyLCBiYXNlLCBiYXNlICsgMiwgYmFzZSArIDMpO1xuICAgIGJhc2UgKz0gNDtcbiAgfTtcbiAgcXVhZChbMSwgMCwgMF0sIFtYLCAtWSwgWl0sIFtYLCAtWSwgLVpdLCBbWCwgWSwgLVpdLCBbWCwgWSwgWl0pOyAgICAgIC8vICtYXG4gIHF1YWQoWy0xLCAwLCAwXSwgWy1YLCAtWSwgLVpdLCBbLVgsIC1ZLCBaXSwgWy1YLCBZLCBaXSwgWy1YLCBZLCAtWl0pOyAvLyAtWFxuICBxdWFkKFswLCAxLCAwXSwgWy1YLCBZLCBaXSwgW1gsIFksIFpdLCBbWCwgWSwgLVpdLCBbLVgsIFksIC1aXSk7ICAgICAgLy8gK1lcbiAgcXVhZChbMCwgLTEsIDBdLCBbLVgsIC1ZLCAtWl0sIFtYLCAtWSwgLVpdLCBbWCwgLVksIFpdLCBbLVgsIC1ZLCBaXSk7IC8vIC1ZXG4gIHF1YWQoWzAsIDAsIDFdLCBbLVgsIC1ZLCBaXSwgW1gsIC1ZLCBaXSwgW1gsIFksIFpdLCBbLVgsIFksIFpdKTsgICAgICAvLyArWlxuICBxdWFkKFswLCAwLCAtMV0sIFtYLCAtWSwgLVpdLCBbLVgsIC1ZLCAtWl0sIFstWCwgWSwgLVpdLCBbWCwgWSwgLVpdKTsgLy8gLVpcbiAgcmV0dXJuIHtcbiAgICBwb3NpdGlvbnM6IG5ldyBGbG9hdDMyQXJyYXkocG9zaXRpb25zKSxcbiAgICBub3JtYWxzOiBuZXcgRmxvYXQzMkFycmF5KG5vcm1hbHMpLFxuICAgIGluZGljZXM6IG5ldyBVaW50MTZBcnJheShpbmRpY2VzKSxcbiAgfTtcbn1cblxuLyoqXG4gKiBUb3J1cyB3aXRoIGl0cyByaW5nIGluIHRoZSBYWiBwbGFuZTogYHJhZGl1c2AgaXMgdGhlIG1ham9yIChyaW5nKSByYWRpdXMgYW5kXG4gKiBgdHViZWAgdGhlIG1pbm9yICh0dWJlIGNyb3NzLXNlY3Rpb24pIHJhZGl1cy4gYHJhZGlhbFNlZ21lbnRzYCBzdWJkaXZpZGVzIHRoZVxuICogdHViZTsgYHR1YnVsYXJTZWdtZW50c2Agc3ViZGl2aWRlcyB0aGUgcmluZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVRvcnVzKHJhZGl1cyA9IDEsIHR1YmUgPSAwLjQsIHJhZGlhbFNlZ21lbnRzID0gMjQsIHR1YnVsYXJTZWdtZW50cyA9IDQ4KTogTWVzaCB7XG4gIGNvbnN0IHBvc2l0aW9uczogbnVtYmVyW10gPSBbXTtcbiAgY29uc3Qgbm9ybWFsczogbnVtYmVyW10gPSBbXTtcbiAgY29uc3QgaW5kaWNlczogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gdHVidWxhclNlZ21lbnRzOyBpKyspIHtcbiAgICBjb25zdCB1ID0gKGkgLyB0dWJ1bGFyU2VnbWVudHMpICogTWF0aC5QSSAqIDI7XG4gICAgY29uc3QgY3UgPSBNYXRoLmNvcyh1KSwgc3UgPSBNYXRoLnNpbih1KTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8PSByYWRpYWxTZWdtZW50czsgaisrKSB7XG4gICAgICBjb25zdCB2ID0gKGogLyByYWRpYWxTZWdtZW50cykgKiBNYXRoLlBJICogMjtcbiAgICAgIGNvbnN0IGN2ID0gTWF0aC5jb3ModiksIHN2ID0gTWF0aC5zaW4odik7XG4gICAgICBwb3NpdGlvbnMucHVzaCgocmFkaXVzICsgdHViZSAqIGN2KSAqIGN1LCB0dWJlICogc3YsIChyYWRpdXMgKyB0dWJlICogY3YpICogc3UpO1xuICAgICAgbm9ybWFscy5wdXNoKGN2ICogY3UsIHN2LCBjdiAqIHN1KTtcbiAgICB9XG4gIH1cbiAgY29uc3Qgc3RyaWRlID0gcmFkaWFsU2VnbWVudHMgKyAxO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHR1YnVsYXJTZWdtZW50czsgaSsrKSB7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCByYWRpYWxTZWdtZW50czsgaisrKSB7XG4gICAgICBjb25zdCBhID0gaSAqIHN0cmlkZSArIGo7XG4gICAgICBjb25zdCBiID0gYSArIHN0cmlkZTtcbiAgICAgIGluZGljZXMucHVzaChhLCBhICsgMSwgYiwgYSArIDEsIGIgKyAxLCBiKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBwb3NpdGlvbnM6IG5ldyBGbG9hdDMyQXJyYXkocG9zaXRpb25zKSxcbiAgICBub3JtYWxzOiBuZXcgRmxvYXQzMkFycmF5KG5vcm1hbHMpLFxuICAgIGluZGljZXM6IG5ldyBVaW50MTZBcnJheShpbmRpY2VzKSxcbiAgfTtcbn1cblxuLyoqIFJldHVybnMgYSBuZXcgbWVzaCB3aXRoIGV2ZXJ5IHRyaWFuZ2xlJ3Mgd2luZGluZyByZXZlcnNlZDogKGEsIGIsIGMpIFx1MjE5MlxuICogKGEsIGMsIGIpLCBzbyBmcm9udCBmYWNlcyBiZWNvbWUgYmFjayBmYWNlcy4gVGhlIGlucHV0IGlzIG5vdCBtdXRhdGVkIFx1MjAxNFxuICogcG9zaXRpb25zL25vcm1hbHMgYXJlIHBhc3NlZCB0aHJvdWdoIGFzIHRoZSBzYW1lIGFycmF5cyBhbmQgb25seSBhIG5ld1xuICogaW5kZXggYXJyYXkgaXMgYWxsb2NhdGVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZsaXBXaW5kaW5nKG1lc2g6IE1lc2gpOiBNZXNoIHtcbiAgY29uc3Qgc3JjID0gbWVzaC5pbmRpY2VzO1xuICBjb25zdCBpbmRpY2VzID0gbmV3IFVpbnQxNkFycmF5KHNyYy5sZW5ndGgpO1xuICBmb3IgKGxldCB0ID0gMDsgdCA8IHNyYy5sZW5ndGg7IHQgKz0gMykge1xuICAgIGluZGljZXNbdF0gPSBzcmNbdF07XG4gICAgaW5kaWNlc1t0ICsgMV0gPSBzcmNbdCArIDJdO1xuICAgIGluZGljZXNbdCArIDJdID0gc3JjW3QgKyAxXTtcbiAgfVxuICByZXR1cm4geyBwb3NpdGlvbnM6IG1lc2gucG9zaXRpb25zLCBub3JtYWxzOiBtZXNoLm5vcm1hbHMsIGluZGljZXMgfTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFFQSxTQUFTLFlBQVk7QUFDckIsT0FBTyxZQUFZOzs7QUNNWixTQUFTLFdBQVcsT0FBTyxHQUFTO0FBQ3pDLFFBQU0sSUFBSSxPQUFPO0FBQ2pCLFFBQU0sSUFBSTtBQUFBO0FBQUEsSUFFUixDQUFDO0FBQUEsSUFBRSxDQUFDO0FBQUEsSUFBRztBQUFBLElBQUk7QUFBQSxJQUFFLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFBSTtBQUFBLElBQUc7QUFBQSxJQUFHO0FBQUEsSUFBRyxDQUFDO0FBQUEsSUFBRztBQUFBLElBQUc7QUFBQTtBQUFBLElBRXBDO0FBQUEsSUFBRSxDQUFDO0FBQUEsSUFBRSxDQUFDO0FBQUEsSUFBRyxDQUFDO0FBQUEsSUFBRSxDQUFDO0FBQUEsSUFBRSxDQUFDO0FBQUEsSUFBRyxDQUFDO0FBQUEsSUFBRztBQUFBLElBQUUsQ0FBQztBQUFBLElBQUk7QUFBQSxJQUFHO0FBQUEsSUFBRSxDQUFDO0FBQUE7QUFBQSxJQUVwQztBQUFBLElBQUUsQ0FBQztBQUFBLElBQUc7QUFBQSxJQUFJO0FBQUEsSUFBRSxDQUFDO0FBQUEsSUFBRSxDQUFDO0FBQUEsSUFBSTtBQUFBLElBQUc7QUFBQSxJQUFFLENBQUM7QUFBQSxJQUFJO0FBQUEsSUFBRztBQUFBLElBQUc7QUFBQTtBQUFBLElBRXJDLENBQUM7QUFBQSxJQUFFLENBQUM7QUFBQSxJQUFFLENBQUM7QUFBQSxJQUFHLENBQUM7QUFBQSxJQUFFLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFBRyxDQUFDO0FBQUEsSUFBRztBQUFBLElBQUc7QUFBQSxJQUFHLENBQUM7QUFBQSxJQUFHO0FBQUEsSUFBRSxDQUFDO0FBQUE7QUFBQSxJQUVyQyxDQUFDO0FBQUEsSUFBRztBQUFBLElBQUc7QUFBQSxJQUFJO0FBQUEsSUFBRztBQUFBLElBQUc7QUFBQSxJQUFJO0FBQUEsSUFBRztBQUFBLElBQUUsQ0FBQztBQUFBLElBQUcsQ0FBQztBQUFBLElBQUc7QUFBQSxJQUFFLENBQUM7QUFBQTtBQUFBLElBRXJDLENBQUM7QUFBQSxJQUFFLENBQUM7QUFBQSxJQUFFLENBQUM7QUFBQSxJQUFJO0FBQUEsSUFBRSxDQUFDO0FBQUEsSUFBRSxDQUFDO0FBQUEsSUFBSTtBQUFBLElBQUUsQ0FBQztBQUFBLElBQUc7QUFBQSxJQUFHLENBQUM7QUFBQSxJQUFFLENBQUM7QUFBQSxJQUFHO0FBQUEsRUFDdkM7QUFDQSxRQUFNLElBQUk7QUFBQSxJQUNSO0FBQUEsSUFBRTtBQUFBLElBQUU7QUFBQSxJQUFHO0FBQUEsSUFBRTtBQUFBLElBQUU7QUFBQSxJQUFHO0FBQUEsSUFBRTtBQUFBLElBQUU7QUFBQSxJQUFHO0FBQUEsSUFBRTtBQUFBLElBQUU7QUFBQSxJQUN6QjtBQUFBLElBQUU7QUFBQSxJQUFFO0FBQUEsSUFBSTtBQUFBLElBQUU7QUFBQSxJQUFFO0FBQUEsSUFBSTtBQUFBLElBQUU7QUFBQSxJQUFFO0FBQUEsSUFBSTtBQUFBLElBQUU7QUFBQSxJQUFFO0FBQUEsSUFDNUI7QUFBQSxJQUFFO0FBQUEsSUFBRTtBQUFBLElBQUc7QUFBQSxJQUFFO0FBQUEsSUFBRTtBQUFBLElBQUc7QUFBQSxJQUFFO0FBQUEsSUFBRTtBQUFBLElBQUc7QUFBQSxJQUFFO0FB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
