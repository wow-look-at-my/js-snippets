// src/math/sdf.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/math/sdf.ts
var SDF_SPHERE = 0;
var SDF_BOX = 1;
var SDF_CYLINDER = 2;
var SDF_TORUS = 3;
function sdSphere(p, params) {
  return Math.hypot(p[0], p[1], p[2]) - params[0];
}
function sdBox(p, params) {
  const qx = Math.abs(p[0]) - params[0];
  const qy = Math.abs(p[1]) - params[1];
  const qz = Math.abs(p[2]) - params[2];
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  const outside = Math.hypot(ox, oy, oz);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return outside + inside;
}
function sdCylinder(p, params) {
  const dx = Math.hypot(p[0], p[2]) - params[0];
  const dy = Math.abs(p[1]) - params[1];
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ox, oy);
}
function sdTorus(p, params) {
  const qx = Math.hypot(p[0], p[2]) - params[0];
  return Math.hypot(qx, p[1]) - params[1];
}
function primitiveSDF(type, p, params) {
  switch (type) {
    case SDF_SPHERE:
      return sdSphere(p, params);
    case SDF_BOX:
      return sdBox(p, params);
    case SDF_CYLINDER:
      return sdCylinder(p, params);
    case SDF_TORUS:
      return sdTorus(p, params);
    default:
      return 1e9;
  }
}
function transformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}
function makeGrid(scene, volMin, volMax, dims) {
  const [nx, ny, nz] = dims;
  const data = new Float32Array(nx * ny * nz);
  const ex = volMax[0] - volMin[0], ey = volMax[1] - volMin[1], ez = volMax[2] - volMin[2];
  for (let z = 0; z < nz; z++) {
    const wz = volMin[2] + (z + 0.5) / nz * ez;
    for (let y = 0; y < ny; y++) {
      const wy = volMin[1] + (y + 0.5) / ny * ey;
      const row = (z * ny + y) * nx;
      for (let x = 0; x < nx; x++) {
        const wx = volMin[0] + (x + 0.5) / nx * ex;
        data[row + x] = scene(wx, wy, wz);
      }
    }
  }
  return { data, dims, volMin, volMax };
}
function loadTexel(grid2, ix, iy, iz) {
  const [nx, ny, nz] = grid2.dims;
  const cx = Math.min(Math.max(ix, 0), nx - 1);
  const cy = Math.min(Math.max(iy, 0), ny - 1);
  const cz = Math.min(Math.max(iz, 0), nz - 1);
  return grid2.data[(cz * ny + cy) * nx + cx];
}
function trilinear(grid2, q) {
  const [nx, ny, nz] = grid2.dims;
  const gx = q[0] * nx - 0.5, gy = q[1] * ny - 0.5, gz = q[2] * nz - 0.5;
  const bx = Math.floor(gx), by = Math.floor(gy), bz = Math.floor(gz);
  const fx = gx - bx, fy = gy - by, fz = gz - bz;
  const c000 = loadTexel(grid2, bx, by, bz);
  const c100 = loadTexel(grid2, bx + 1, by, bz);
  const c010 = loadTexel(grid2, bx, by + 1, bz);
  const c110 = loadTexel(grid2, bx + 1, by + 1, bz);
  const c001 = loadTexel(grid2, bx, by, bz + 1);
  const c101 = loadTexel(grid2, bx + 1, by, bz + 1);
  const c011 = loadTexel(grid2, bx, by + 1, bz + 1);
  const c111 = loadTexel(grid2, bx + 1, by + 1, bz + 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  const x00 = lerp(c000, c100, fx), x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx), x11 = lerp(c011, c111, fx);
  const y0 = lerp(x00, x10, fy), y1 = lerp(x01, x11, fy);
  return lerp(y0, y1, fz);
}
function sampleGrid(grid2, p) {
  const { volMin, volMax } = grid2;
  const ext = [volMax[0] - volMin[0], volMax[1] - volMin[1], volMax[2] - volMin[2]];
  const q = [
    (p[0] - volMin[0]) / ext[0],
    (p[1] - volMin[1]) / ext[1],
    (p[2] - volMin[2]) / ext[2]
  ];
  const inside = q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1 && q[2] >= 0 && q[2] <= 1;
  const cq = [
    Math.min(Math.max(q[0], 0), 1),
    Math.min(Math.max(q[1], 0), 1),
    Math.min(Math.max(q[2], 0), 1)
  ];
  const dIn = trilinear(grid2, cq);
  if (inside) return dIn;
  const dOut = Math.hypot(
    Math.max(volMin[0] - p[0], p[0] - volMax[0], 0),
    Math.max(volMin[1] - p[1], p[1] - volMax[1], 0),
    Math.max(volMin[2] - p[2], p[2] - volMax[2], 0)
  );
  return Math.max(dIn, dOut);
}
function intersectAABB(ro, rd, bmin, bmax) {
  const inv = [1 / rd[0], 1 / rd[1], 1 / rd[2]];
  const t0 = [(bmin[0] - ro[0]) * inv[0], (bmin[1] - ro[1]) * inv[1], (bmin[2] - ro[2]) * inv[2]];
  const t1 = [(bmax[0] - ro[0]) * inv[0], (bmax[1] - ro[1]) * inv[1], (bmax[2] - ro[2]) * inv[2]];
  const ts = [Math.min(t0[0], t1[0]), Math.min(t0[1], t1[1]), Math.min(t0[2], t1[2])];
  const tb = [Math.max(t0[0], t1[0]), Math.max(t0[1], t1[1]), Math.max(t0[2], t1[2])];
  return [Math.max(ts[0], ts[1], ts[2]), Math.min(tb[0], tb[1], tb[2])];
}
function softShadow(sampleFn, ro, rd, opts = {}) {
  const {
    tmin = 0.02,
    tmax = 20,
    k = 16,
    maxSteps = 64,
    minStep = 0.01,
    maxStep = 5,
    eps = 1e-3,
    aabb = null
  } = opts;
  let lo = tmin, hi = tmax;
  if (aabb) {
    const [tn, tf] = intersectAABB(ro, rd, aabb.min, aabb.max);
    const tEnter = Math.max(tn, 0);
    if (tf <= tEnter) return { vis: 1, steps: 0 };
    lo = Math.max(tmin, tEnter);
    hi = Math.min(tmax, tf);
    if (hi <= lo) return { vis: 1, steps: 0 };
  }
  let res = 1;
  let t = lo;
  let steps = 0;
  for (let i = 0; i < maxSteps; i++) {
    if (t >= hi) break;
    const p = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const h = sampleFn(p);
    steps++;
    if (h < eps) {
      res = 0;
      break;
    }
    res = Math.min(res, k * h / t);
    t += Math.min(Math.max(h, minStep), maxStep);
  }
  return { vis: Math.min(Math.max(res, 0), 1), steps };
}

// src/math/sdf.test.ts
var near = (a, b, tol, msg) => {
  assert.ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} +/-${tol})`);
};
function rigidInvY(pos, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const [px, py, pz] = pos;
  return new Float32Array([
    c,
    0,
    s,
    0,
    0,
    1,
    0,
    0,
    -s,
    0,
    c,
    0,
    -(c * px - s * pz),
    -py,
    -(s * px + c * pz),
    1
  ]);
}
test("sdSphere: sign and known distances", () => {
  near(sdSphere([2, 0, 0], [1, 0, 0, 0]), 1, 1e-9, "sphere outside");
  near(sdSphere([0, 0, 0], [1, 0, 0, 0]), -1, 1e-9, "sphere centre (inside)");
  near(sdSphere([0, 3, 0], [1, 0, 0, 0]), 2, 1e-9, "sphere along +Y");
});
test("sdBox: sign and known distances", () => {
  near(sdBox([2, 0, 0], [1, 1, 1, 0]), 1, 1e-9, "box face");
  near(sdBox([0, 0, 0], [1, 1, 1, 0]), -1, 1e-9, "box centre (inside)");
  near(sdBox([2, 2, 0], [1, 1, 1, 0]), Math.SQRT2, 1e-9, "box edge (diagonal)");
});
test("sdCylinder: sign and known distances", () => {
  near(sdCylinder([2, 0, 0], [1, 2, 0, 0]), 1, 1e-9, "cylinder radial");
  near(sdCylinder([0, 3, 0], [1, 2, 0, 0]), 1, 1e-9, "cylinder cap");
  near(sdCylinder([0, 0, 0], [1, 2, 0, 0]), -1, 1e-9, "cylinder inside");
  near(sdCylinder([2, 3, 0], [1, 2, 0, 0]), Math.SQRT2, 1e-9, "cylinder corner");
});
test("sdTorus: sign and known distances", () => {
  near(sdTorus([2, 0, 0], [2, 0.5, 0, 0]), -0.5, 1e-9, "torus on ring centreline");
  near(sdTorus([3, 0, 0], [2, 0.5, 0, 0]), 0.5, 1e-9, "torus outer");
  near(sdTorus([2, 1, 0], [2, 0.5, 0, 0]), 0.5, 1e-9, "torus above ring");
});
test("primitiveSDF dispatches by type id and falls back far away", () => {
  near(primitiveSDF(SDF_SPHERE, [2, 0, 0], [1, 0, 0, 0]), 1, 1e-9, "dispatch sphere");
  near(primitiveSDF(SDF_BOX, [2, 0, 0], [1, 1, 1, 0]), 1, 1e-9, "dispatch box");
  assert.ok(primitiveSDF(999, [0, 0, 0], [0, 0, 0, 0]) > 1e8, "unknown type returns a huge distance");
});
test("transformPoint applies a column-major affine (inverse-model) transform", () => {
  const pos = [3, 1.2, -2];
  const inv = rigidInvY(pos, 0);
  const local = transformPoint(inv, [pos[0] + 2, pos[1], pos[2]]);
  near(local[0], 2, 1e-6, "translated +X -> local x");
  near(local[1], 0, 1e-6, "translated +X -> local y");
  near(local[2], 0, 1e-6, "translated +X -> local z");
  near(sdSphere(local, [0.7, 0, 0, 0]), 2 - 0.7, 1e-6, "translated sphere distance");
});
test("transformPoint + sdBox: a yawed long box maps world axes to local axes", () => {
  const inv = rigidInvY([0, 0, 0], Math.PI / 2);
  near(sdBox(transformPoint(inv, [0, 0, 2]), [1.5, 0.5, 0.5, 0]), 0.5, 1e-6, "long axis -> world Z");
  near(sdBox(transformPoint(inv, [2, 0, 0]), [1.5, 0.5, 0.5, 0]), 1.5, 1e-6, "short axis -> world X");
});
test("trilinear reconstructs a linear field exactly", () => {
  const dims = [6, 5, 4];
  const volMin = [-1, 0.5, 2], volMax = [2, 3, 4.5];
  const ext = [volMax[0] - volMin[0], volMax[1] - volMin[1], volMax[2] - volMin[2]];
  const A = 1.3, B = -0.7, C = 0.4, D = 2.1;
  const lin = (x, y, z) => A * x + B * y + C * z + D;
  const grid2 = makeGrid(lin, volMin, volMax, dims);
  let maxErr = 0;
  const N = 11;
  for (let iz = 1; iz < N - 1; iz++)
    for (let iy = 1; iy < N - 1; iy++)
      for (let ix = 1; ix < N - 1; ix++) {
        const q = [
          0.5 / dims[0] + ix / (N - 1) * (1 - 1 / dims[0]),
          0.5 / dims[1] + iy / (N - 1) * (1 - 1 / dims[1]),
          0.5 / dims[2] + iz / (N - 1) * (1 - 1 / dims[2])
        ];
        const wx = volMin[0] + q[0] * ext[0];
        const wy = volMin[1] + q[1] * ext[1];
        const wz = volMin[2] + q[2] * ext[2];
        maxErr = Math.max(maxErr, Math.abs(trilinear(grid2, q) - lin(wx, wy, wz)));
      }
  assert.ok(maxErr < 1e-5, `trilinear reproduces a linear field (maxErr ${maxErr})`);
});
var SPHERE_C = [0, 1.2, 0];
var SPHERE_R = 0.8;
var sphereScene = (x, y, z) => sdSphere(transformPoint(rigidInvY(SPHERE_C, 0), [x, y, z]), [SPHERE_R, 0, 0, 0]);
var VOL_MIN = [-1.6, -0.4, -1.6];
var VOL_MAX = [1.6, 2.8, 1.6];
var grid = makeGrid(sphereScene, VOL_MIN, VOL_MAX, [48, 48, 48]);
var voxel = (VOL_MAX[0] - VOL_MIN[0]) / 48;
test("sampleGrid: baked centre matches the analytic sphere", () => {
  near(sampleGrid(grid, SPHERE_C), -SPHERE_R, 2 * voxel, "baked centre ~= -r");
});
test("sampleGrid is continuous across the volume face", () => {
  const faceX = VOL_MAX[0];
  const dIn = sampleGrid(grid, [faceX - 0.5 * voxel, SPHERE_C[1], 0]);
  const dOut = sampleGrid(grid, [faceX + 0.5 * voxel, SPHERE_C[1], 0]);
  assert.ok(Math.abs(dIn - dOut) < 2 * voxel, `continuous across face (${dIn} vs ${dOut})`);
});
test("sampleGrid outside the box is >= distance to the box and grows with range", () => {
  const faceX = VOL_MAX[0];
  const d1 = sampleGrid(grid, [faceX + 0.5, SPHERE_C[1], 0]);
  const d2 = sampleGrid(grid, [faceX + 1.5, SPHERE_C[1], 0]);
  assert.ok(d1 >= 0.5 - 1e-6, `outside value >= distance to box (${d1} >= 0.5)`);
  assert.ok(d2 > d1, `grows moving away from the volume (${d2} > ${d1})`);
});
var UP = [0, 1, 0];
var shadowOpts = { tmin: 0.02, tmax: 6, k: 12, maxSteps: 192, minStep: 0.5 * voxel, maxStep: 0.25, eps: 0.5 * voxel };
var visAt = (x, k = 12) => softShadow((p) => sampleGrid(grid, p), [x, 0, 0], UP, { ...shadowOpts, k }).vis;
test("soft shadow: point under the sphere is occluded, far point is lit", () => {
  assert.ok(visAt(0) < 0.05, `point under sphere is shadowed (vis ${visAt(0)})`);
  assert.ok(visAt(3) > 0.95, `point far from sphere is lit (vis ${visAt(3)})`);
});
test("soft shadow has a real penumbra (some 0 < vis < 1)", () => {
  let saw = false;
  for (let x = 0; x <= 2; x += 0.01) {
    const v = visAt(x);
    if (v > 0.02 && v < 0.98) {
      saw = true;
      break;
    }
  }
  assert.ok(saw, "soft shadow has a penumbra");
});
test("soft shadow visibility is monotone non-decreasing moving out of shadow", () => {
  let prev = -1, mono = true;
  for (let x = 0; x <= 3; x += 0.05) {
    const v = visAt(x);
    if (v < prev - 1e-3) {
      mono = false;
      break;
    }
    prev = v;
  }
  assert.ok(mono, "visibility is monotone non-decreasing");
});
test("soft shadow: baked field reproduces the analytic field (within trilinear tolerance)", () => {
  let maxDiff = 0;
  for (const x of [0, 0.6, 0.85, 1, 1.3, 2]) {
    const vBaked = softShadow((p) => sampleGrid(grid, p), [x, 0, 0], UP, shadowOpts).vis;
    const vExact = softShadow((p) => sphereScene(p[0], p[1], p[2]), [x, 0, 0], UP, shadowOpts).vis;
    maxDiff = Math.max(maxDiff, Math.abs(vBaked - vExact));
  }
  assert.ok(maxDiff < 0.2, `baked vs analytic shadow agree (maxDiff ${maxDiff})`);
});
test("soft shadow: larger k narrows the penumbra (the softness knob works)", () => {
  const penumbraWidth = (k) => {
    let lo = Infinity, hi = -Infinity;
    for (let x = 0; x <= 2; x += 5e-3) {
      const v = visAt(x, k);
      if (v > 0.05 && v < 0.95) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    return hi >= lo ? hi - lo : 0;
  };
  const wSoft = penumbraWidth(6);
  const wSharp = penumbraWidth(48);
  assert.ok(wSoft > 0, `soft k has a measurable penumbra (${wSoft})`);
  assert.ok(wSharp < wSoft, `larger k narrows the penumbra (${wSharp} < ${wSoft})`);
});
test("intersectAABB: a vertical ray through the volume centre hits; a parallel outside ray misses", () => {
  const c = [(VOL_MIN[0] + VOL_MAX[0]) / 2, 0, (VOL_MIN[2] + VOL_MAX[2]) / 2];
  const through = intersectAABB([c[0], VOL_MIN[1] - 1, c[2]], [0, 1, 0], VOL_MIN, VOL_MAX);
  assert.ok(through[1] > Math.max(through[0], 0), "vertical ray through centre hits");
  const beside = intersectAABB([VOL_MAX[0] + 1, 0, c[2]], [0, 1, 0], VOL_MIN, VOL_MAX);
  assert.ok(beside[1] < Math.max(beside[0], 0), "parallel ray outside the box misses");
});
test("soft shadow: AABB-clipped march matches the full march", () => {
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const dirs = [UP, norm([0.5, 0.8, 0.25]), norm([-0.6, 0.7, 0.1])];
  const aabb = { min: VOL_MIN, max: VOL_MAX };
  let maxDiff = 0;
  for (const rd of dirs) {
    for (let x = -2.5; x <= 3; x += 0.1) {
      const ro = [x, 0, 0];
      const vClip = softShadow((p) => sampleGrid(grid, p), ro, rd, { ...shadowOpts, aabb }).vis;
      const vFull = softShadow((p) => sampleGrid(grid, p), ro, rd, shadowOpts).vis;
      maxDiff = Math.max(maxDiff, Math.abs(vClip - vFull));
    }
  }
  assert.ok(maxDiff < 0.02, `AABB-clipped march matches the full march (maxDiff ${maxDiff})`);
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic2RmLnRlc3QudHMiLCAic2RmLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBUZXN0cyBmb3IgdGhlIHB1cmUgc2lnbmVkLWRpc3RhbmNlLWZpZWxkIG1hdGguLm1qcyBvcmFjbGUgYW5kIGFkYXB0ZWQgdG8gdGhpcyBsaWJyYXJ5J3MgQVBJLlxuXG5pbXBvcnQgeyB0ZXN0IH0gZnJvbSAnbm9kZTp0ZXN0JztcbmltcG9ydCBhc3NlcnQgZnJvbSAnbm9kZTphc3NlcnQvc3RyaWN0JztcblxuaW1wb3J0IHtcbiAgc2RTcGhlcmUsIHNkQm94LCBzZEN5bGluZGVyLCBzZFRvcnVzLCBwcmltaXRpdmVTREYsXG4gIFNERl9TUEhFUkUsIFNERl9CT1gsXG4gIHRyYW5zZm9ybVBvaW50LCBtYWtlR3JpZCwgdHJpbGluZWFyLCBzYW1wbGVHcmlkLCBzb2Z0U2hhZG93LCBpbnRlcnNlY3RBQUJCLFxufSBmcm9tICcuL3NkZi50cyc7XG5pbXBvcnQgdHlwZSB7IFNjZW5lU0RGLCBTZGZHcmlkIH0gZnJvbSAnLi9zZGYudHMnO1xuaW1wb3J0IHR5cGUgeyBWZWMzIH0gZnJvbSAnLi92ZWMzLnRzJztcblxuY29uc3QgbmVhciA9IChhOiBudW1iZXIsIGI6IG51bWJlciwgdG9sOiBudW1iZXIsIG1zZzogc3RyaW5nKTogdm9pZCA9PiB7XG4gIGFzc2VydC5vayhNYXRoLmFicyhhIC0gYikgPD0gdG9sLCBgJHttc2d9IChnb3QgJHthfSwgd2FudCAke2J9ICsvLSR7dG9sfSlgKTtcbn07XG5cbi8vIEludmVyc2Ugb2YgYSByaWdpZCBtb2RlbCBUKHBvcykqUnkoeWF3KTogd29ybGQgLT4gbG9jYWwuIE1hdGNoZXMgdGhlXG4vLyBjb2x1bW4tbWFqb3IgY29tcG9zaXRpb24gdGhlIHNoYXJlZCBtYXQ0IGhlbHBlcnMgcHJvZHVjZS5cbmZ1bmN0aW9uIHJpZ2lkSW52WShwb3M6IFZlYzMsIHlhdzogbnVtYmVyKTogRmxvYXQzMkFycmF5IHtcbiAgY29uc3QgYyA9IE1hdGguY29zKHlhdyksIHMgPSBNYXRoLnNpbih5YXcpO1xuICBjb25zdCBbcHgsIHB5LCBwel0gPSBwb3M7XG4gIHJldHVybiBuZXcgRmxvYXQzMkFycmF5KFtcbiAgICBjLCAwLCBzLCAwLFxuICAgIDAsIDEsIDAsIDAsXG4gICAgLXMsIDAsIGMsIDAsXG4gICAgLShjICogcHggLSBzICogcHopLCAtcHksIC0ocyAqIHB4ICsgYyAqIHB6KSwgMSxcbiAgXSk7XG59XG5cbi8vIC0tLS0gQSkgUHJpbWl0aXZlIGRpc3RhbmNlcyAobG9jYWwgZnJhbWUpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdzZFNwaGVyZTogc2lnbiBhbmQga25vd24gZGlzdGFuY2VzJywgKCkgPT4ge1xuICBuZWFyKHNkU3BoZXJlKFsyLCAwLCAwXSwgWzEsIDAsIDAsIDBdKSwgMSwgMWUtOSwgJ3NwaGVyZSBvdXRzaWRlJyk7XG4gIG5lYXIoc2RTcGhlcmUoWzAsIDAsIDBdLCBbMSwgMCwgMCwgMF0pLCAtMSwgMWUtOSwgJ3NwaGVyZSBjZW50cmUgKGluc2lkZSknKTtcbiAgbmVhcihzZFNwaGVyZShbMCwgMywgMF0sIFsxLCAwLCAwLCAwXSksIDIsIDFlLTksICdzcGhlcmUgYWxvbmcgK1knKTtcbn0pO1xuXG50ZXN0KCdzZEJveDogc2lnbiBhbmQga25vd24gZGlzdGFuY2VzJywgKCkgPT4ge1xuICBuZWFyKHNkQm94KFsyLCAwLCAwXSwgWzEsIDEsIDEsIDBdKSwgMSwgMWUtOSwgJ2JveCBmYWNlJyk7XG4gIG5lYXIoc2RCb3goWzAsIDAsIDBdLCBbMSwgMSwgMSwgMF0pLCAtMSwgMWUtOSwgJ2JveCBjZW50cmUgKGluc2lkZSknKTtcbiAgbmVhcihzZEJveChbMiwgMiwgMF0sIFsxLCAxLCAxLCAwXSksIE1hdGguU1FSVDIsIDFlLTksICdib3ggZWRnZSAoZGlhZ29uYWwpJyk7XG59KTtcblxudGVzdCgnc2RDeWxpbmRlcjogc2lnbiBhbmQga25vd24gZGlzdGFuY2VzJywgKCkgPT4ge1xuICBuZWFyKHNkQ3lsaW5kZXIoWzIsIDAsIDBdLCBbMSwgMiwgMCwgMF0pLCAxLCAxZS05LCAnY3lsaW5kZXIgcmFkaWFsJyk7XG4gIG5lYXIoc2RDeWxpbmRlcihbMCwgMywgMF0sIFsxLCAyLCAwLCAwXSksIDEsIDFlLTksICdjeWxpbmRlciBjYXAnKTtcbiAgbmVhcihzZEN5bGluZGVyKFswLCAwLCAwXSwgWzEsIDIsIDAsIDBdKSwgLTEsIDFlLTksICdjeWxpbmRlciBpbnNpZGUnKTtcbiAgbmVhcihzZEN5bGluZGVyKFsyLCAzLCAwXSwgWzEsIDIsIDAsIDBdKSwgTWF0aC5TUVJUMiwgMWUtOSwgJ2N5bGluZGVyIGNvcm5lcicpO1xufSk7XG5cbnRlc3QoJ3NkVG9ydXM6IHNpZ24gYW5kIGtub3duIGRpc3RhbmNlcycsICgpID0+IHtcbiAgbmVhcihzZFRvcnVzKFsyLCAwLCAwXSwgWzIsIDAuNSwgMCwgMF0pLCAtMC41LCAxZS05LCAndG9ydXMgb24gcmluZyBjZW50cmVsaW5lJyk7XG4gIG5lYXIoc2RUb3J1cyhbMywgMCwgMF0sIFsyLCAwLjUsIDAsIDBdKSwgMC41LCAxZS05LCAndG9ydXMgb3V0ZXInKTtcbiAgbmVhcihzZFRvcnVzKFsyLCAxLCAwXSwgWzIsIDAuNSwgMCwgMF0pLCAwLjUsIDFlLTksICd0b3J1cyBhYm92ZSByaW5nJyk7XG59KTtcblxudGVzdCgncHJpbWl0aXZlU0RGIGRpc3BhdGNoZXMgYnkgdHlwZSBpZCBhbmQgZmFsbHMgYmFjayBmYXIgYXdheScsICgpID0+IHtcbiAgbmVhcihwcmltaXRpdmVTREYoU0RGX1NQSEVSRSwgWzIsIDAsIDBdLCBbMSwgMCwgMCwgMF0pLCAxLCAxZS05LCAnZGlzcGF0Y2ggc3BoZXJlJyk7XG4gIG5lYXIocHJpbWl0aXZlU0RGKFNERl9CT1gsIFsyLCAwLCAwXSwgWzEsIDEsIDEsIDBdKSwgMSwgMWUtOSwgJ2Rpc3BhdGNoIGJveCcpO1xuICBhc3NlcnQub2socHJpbWl0aXZlU0RGKDk5OSwgWzAsIDAsIDBdLCBbMCwgMCwgMCwgMF0pID4gMWU4LCAndW5rbm93biB0eXBlIHJldHVybnMgYSBodWdlIGRpc3RhbmNlJyk7XG59KTtcblxuLy8gLS0tLSBCKSBUcmFuc2Zvcm1zOiBjb2x1bW4tbWFqb3IgaW52TW9kZWwgYnJpbmdzIHdvcmxkIC0+IGxvY2FsIC0tLS0tLS0tLS0tXG5cbnRlc3QoJ3RyYW5zZm9ybVBvaW50IGFwcGxpZXMgYSBjb2x1bW4tbWFqb3IgYWZmaW5lIChpbnZlcnNlLW1vZGVsKSB0cmFuc2Zvcm0nLCAoKSA9PiB7XG4gIC8vIEEgdHJhbnNsYXRlZCBzcGhlcmU6IGEgd29ybGQgcG9pbnQgYXQgK1ggZnJvbSB0aGUgY2VudHJlIG1hcHMgdG8gbG9jYWwgK1guXG4gIGNvbnN0IHBvczogVmVjMyA9IFszLCAxLjIsIC0yXTtcbiAgY29uc3QgaW52ID0gcmlnaWRJbnZZKHBvcywgMCk7XG4gIGNvbnN0IGxvY2FsID0gdHJhbnNmb3JtUG9pbnQoaW52LCBbcG9zWzBdICsgMiwgcG9zWzFdLCBwb3NbMl1dKTtcbiAgbmVhcihsb2NhbFswXSwgMiwgMWUtNiwgJ3RyYW5zbGF0ZWQgK1ggLT4gbG9jYWwgeCcpO1xuICBuZWFyKGxvY2FsWzFdLCAwLCAxZS02LCAndHJhbnNsYXRlZCArWCAtPiBsb2NhbCB5Jyk7XG4gIG5lYXIobG9jYWxbMl0sIDAsIDFlLTYsICd0cmFuc2xhdGVkICtYIC0+IGxvY2FsIHonKTtcbiAgbmVhcihzZFNwaGVyZShsb2NhbCwgWzAuNywgMCwgMCwgMF0pLCAyIC0gMC43LCAxZS02LCAndHJhbnNsYXRlZCBzcGhlcmUgZGlzdGFuY2UnKTtcbn0pO1xuXG50ZXN0KCd0cmFuc2Zvcm1Qb2ludCArIHNkQm94OiBhIHlhd2VkIGxvbmcgYm94IG1hcHMgd29ybGQgYXhlcyB0byBsb2NhbCBheGVzJywgKCkgPT4ge1xuICBjb25zdCBpbnYgPSByaWdpZEludlkoWzAsIDAsIDBdLCBNYXRoLlBJIC8gMik7XG4gIG5lYXIoc2RCb3godHJhbnNmb3JtUG9pbnQoaW52LCBbMCwgMCwgMl0pLCBbMS41LCAwLjUsIDAuNSwgMF0pLCAwLjUsIDFlLTYsICdsb25nIGF4aXMgLT4gd29ybGQgWicpO1xuICBuZWFyKHNkQm94KHRyYW5zZm9ybVBvaW50KGludiwgWzIsIDAsIDBdKSwgWzEuNSwgMC41LCAwLjUsIDBdKSwgMS41LCAxZS02LCAnc2hvcnQgYXhpcyAtPiB3b3JsZCBYJyk7XG59KTtcblxuLy8gLS0tLSBDKSBUcmlsaW5lYXIgcmVwcm9kdWNlcyBhIGxpbmVhciBmaWVsZCBleGFjdGx5IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ3RyaWxpbmVhciByZWNvbnN0cnVjdHMgYSBsaW5lYXIgZmllbGQgZXhhY3RseScsICgpID0+IHtcbiAgY29uc3QgZGltczogW251bWJlciwgbnVtYmVyLCBudW1iZXJdID0gWzYsIDUsIDRdO1xuICBjb25zdCB2b2xNaW46IFZlYzMgPSBbLTEsIDAuNSwgMl0sIHZvbE1heDogVmVjMyA9IFsyLCAzLCA0LjVdO1xuICBjb25zdCBleHQgPSBbdm9sTWF4WzBdIC0gdm9sTWluWzBdLCB2b2xNYXhbMV0gLSB2b2xNaW5bMV0sIHZvbE1heFsyXSAtIHZvbE1pblsyXV07XG4gIGNvbnN0IEEgPSAxLjMsIEIgPSAtMC43LCBDID0gMC40LCBEID0gMi4xO1xuICBjb25zdCBsaW46IFNjZW5lU0RGID0gKHgsIHksIHopID0+IEEgKiB4ICsgQiAqIHkgKyBDICogeiArIEQ7XG4gIGNvbnN0IGdyaWQgPSBtYWtlR3JpZChsaW4sIHZvbE1pbiwgdm9sTWF4LCBkaW1zKTtcblxuICAvLyBEZXRlcm1pbmlzdGljIHN3ZWVwIHN0cmljdGx5IGluc2lkZSB0aGUgdGV4ZWwtY2VudHJlIGJhbmQgKG5vIGNsYW1waW5nKS5cbiAgbGV0IG1heEVyciA9IDA7XG4gIGNvbnN0IE4gPSAxMTtcbiAgZm9yIChsZXQgaXogPSAxOyBpeiA8IE4gLSAxOyBpeisrKVxuICAgIGZvciAobGV0IGl5ID0gMTsgaXkgPCBOIC0gMTsgaXkrKylcbiAgICAgIGZvciAobGV0IGl4ID0gMTsgaXggPCBOIC0gMTsgaXgrKykge1xuICAgICAgICBjb25zdCBxOiBWZWMzID0gW1xuICAgICAgICAgIDAuNSAvIGRpbXNbMF0gKyAoaXggLyAoTiAtIDEpKSAqICgxIC0gMSAvIGRpbXNbMF0pLFxuICAgICAgICAgIDAuNSAvIGRpbXNbMV0gKyAoaXkgLyAoTiAtIDEpKSAqICgxIC0gMSAvIGRpbXNbMV0pLFxuICAgICAgICAgIDAuNSAvIGRpbXNbMl0gKyAoaXogLyAoTiAtIDEpKSAqICgxIC0gMSAvIGRpbXNbMl0pLFxuICAgICAgICBdO1xuICAgICAgICBjb25zdCB3eCA9IHZvbE1pblswXSArIHFbMF0gKiBleHRbMF07XG4gICAgICAgIGNvbnN0IHd5ID0gdm9sTWluWzFdICsgcVsxXSAqIGV4dFsxXTtcbiAgICAgICAgY29uc3Qgd3ogPSB2b2xNaW5bMl0gKyBxWzJdICogZXh0WzJdO1xuICAgICAgICBtYXhFcnIgPSBNYXRoLm1heChtYXhFcnIsIE1hdGguYWJzKHRyaWxpbmVhcihncmlkLCBxKSAtIGxpbih3eCwgd3ksIHd6KSkpO1xuICAgICAgfVxuICBhc3NlcnQub2sobWF4RXJyIDwgMWUtNSwgYHRyaWxpbmVhciByZXByb2R1Y2VzIGEgbGluZWFyIGZpZWxkIChtYXhFcnIgJHttYXhFcnJ9KWApO1xufSk7XG5cbi8vIC0tLS0gU2hhcmVkIGJha2VkIHNwaGVyZSBmb3IgdGhlIHNhbXBsaW5nICsgc2hhZG93IHRlc3RzIC0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgU1BIRVJFX0M6IFZlYzMgPSBbMCwgMS4yLCAwXSwgU1BIRVJFX1IgPSAwLjg7XG5jb25zdCBzcGhlcmVTY2VuZTogU2NlbmVTREYgPSAoeCwgeSwgeikgPT5cbiAgc2RTcGhlcmUodHJhbnNmb3JtUG9pbnQocmlnaWRJbnZZKFNQSEVSRV9DLCAwKSwgW3gsIHksIHpdKSwgW1NQSEVSRV9SLCAwLCAwLCAwXSk7XG5jb25zdCBWT0xfTUlOOiBWZWMzID0gWy0xLjYsIC0wLjQsIC0xLjZdLCBWT0xfTUFYOiBWZWMzID0gWzEuNiwgMi44LCAxLjZdO1xuY29uc3QgZ3JpZDogU2RmR3JpZCA9IG1ha2VHcmlkKHNwaGVyZVNjZW5lLCBWT0xfTUlOLCBWT0xfTUFYLCBbNDgsIDQ4LCA0OF0pO1xuY29uc3Qgdm94ZWwgPSAoVk9MX01BWFswXSAtIFZPTF9NSU5bMF0pIC8gNDg7XG5cbi8vIC0tLS0gRCkgc2FtcGxlR3JpZCBvdXRzaWRlIGV4dGVuc2lvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdzYW1wbGVHcmlkOiBiYWtlZCBjZW50cmUgbWF0Y2hlcyB0aGUgYW5hbHl0aWMgc3BoZXJlJywgKCkgPT4ge1xuICBuZWFyKHNhbXBsZUdyaWQoZ3JpZCwgU1BIRVJFX0MpLCAtU1BIRVJFX1IsIDIgKiB2b3hlbCwgJ2Jha2VkIGNlbnRyZSB+PSAtcicpO1xufSk7XG5cbnRlc3QoJ3NhbXBsZUdyaWQgaXMgY29udGludW91cyBhY3Jvc3MgdGhlIHZvbHVtZSBmYWNlJywgKCkgPT4ge1xuICBjb25zdCBmYWNlWCA9IFZPTF9NQVhbMF07XG4gIGNvbnN0IGRJbiA9IHNhbXBsZUdyaWQoZ3JpZCwgW2ZhY2VYIC0gMC41ICogdm94ZWwsIFNQSEVSRV9DWzFdLCAwXSk7XG4gIGNvbnN0IGRPdXQgPSBzYW1wbGVHcmlkKGdyaWQsIFtmYWNlWCArIDAuNSAqIHZveGVsLCBTUEhFUkVfQ1sxXSwgMF0pO1xuICBhc3NlcnQub2soTWF0aC5hYnMoZEluIC0gZE91dCkgPCAyICogdm94ZWwsIGBjb250aW51b3VzIGFjcm9zcyBmYWNlICgke2RJbn0gdnMgJHtkT3V0fSlgKTtcbn0pO1xuXG50ZXN0KCdzYW1wbGVHcmlkIG91dHNpZGUgdGhlIGJveCBpcyA+PSBkaXN0YW5jZSB0byB0aGUgYm94IGFuZCBncm93cyB3aXRoIHJhbmdlJywgKCkgPT4ge1xuICBjb25zdCBmYWNlWCA9IFZPTF9NQVhbMF07XG4gIGNvbnN0IGQxID0gc2FtcGxlR3JpZChncmlkLCBbZmFjZVggKyAwLjUsIFNQSEVSRV9DWzFdLCAwXSk7XG4gIGNvbnN0IGQyID0gc2FtcGxlR3JpZChncmlkLCBbZmFjZVggKyAxLjUsIFNQSEVSRV9DWzFdLCAwXSk7XG4gIGFzc2VydC5vayhkMSA+PSAwLjUgLSAxZS02LCBgb3V0c2lkZSB2YWx1ZSA+PSBkaXN0YW5jZSB0byBib3ggKCR7ZDF9ID49IDAuNSlgKTtcbiAgYXNzZXJ0Lm9rKGQyID4gZDEsIGBncm93cyBtb3ZpbmcgYXdheSBmcm9tIHRoZSB2b2x1bWUgKCR7ZDJ9ID4gJHtkMX0pYCk7XG59KTtcblxuLy8gLS0tLSBFKSBTb2Z0IHNoYWRvd3Mgb24gdGhlIGJha2VkIHNwaGVyZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IFVQOiBWZWMzID0gWzAsIDEsIDBdO1xuY29uc3Qgc2hhZG93T3B0cyA9IHsgdG1pbjogMC4wMiwgdG1heDogNiwgazogMTIsIG1heFN0ZXBzOiAxOTIsIG1pblN0ZXA6IDAuNSAqIHZveGVsLCBtYXhTdGVwOiAwLjI1LCBlcHM6IDAuNSAqIHZveGVsIH07XG5jb25zdCB2aXNBdCA9ICh4OiBudW1iZXIsIGsgPSAxMik6IG51bWJlciA9PlxuICBzb2Z0U2hhZG93KChwKSA9PiBzYW1wbGVHcmlkKGdyaWQsIHApLCBbeCwgMCwgMF0sIFVQLCB7IC4uLnNoYWRvd09wdHMsIGsgfSkudmlzO1xuXG50ZXN0KCdzb2Z0IHNoYWRvdzogcG9pbnQgdW5kZXIgdGhlIHNwaGVyZSBpcyBvY2NsdWRlZCwgZmFyIHBvaW50IGlzIGxpdCcsICgpID0+IHtcbiAgYXNzZXJ0Lm9rKHZpc0F0KDApIDwgMC4wNSwgYHBvaW50IHVuZGVyIHNwaGVyZSBpcyBzaGFkb3dlZCAodmlzICR7dmlzQXQoMCl9KWApO1xuICBhc3NlcnQub2sodmlzQXQoMykgPiAwLjk1LCBgcG9pbnQgZmFyIGZyb20gc3BoZXJlIGlzIGxpdCAodmlzICR7dmlzQXQoMyl9KWApO1xufSk7XG5cbnRlc3QoJ3NvZnQgc2hhZG93IGhhcyBhIHJlYWwgcGVudW1icmEgKHNvbWUgMCA8IHZpcyA8IDEpJywgKCkgPT4ge1xuICBsZXQgc2F3ID0gZmFsc2U7XG4gIGZvciAobGV0IHggPSAwOyB4IDw9IDI7IHggKz0gMC4wMSkge1xuICAgIGNvbnN0IHYgPSB2aXNBdCh4KTtcbiAgICBpZiAodiA+IDAuMDIgJiYgdiA8IDAuOTgpIHsgc2F3ID0gdHJ1ZTsgYnJlYWs7IH1cbiAgfVxuICBhc3NlcnQub2soc2F3LCAnc29mdCBzaGFkb3cgaGFzIGEgcGVudW1icmEnKTtcbn0pO1xuXG50ZXN0KCdzb2Z0IHNoYWRvdyB2aXNpYmlsaXR5IGlzIG1vbm90b25lIG5vbi1kZWNyZWFzaW5nIG1vdmluZyBvdXQgb2Ygc2hhZG93JywgKCkgPT4ge1xuICBsZXQgcHJldiA9IC0xLCBtb25vID0gdHJ1ZTtcbiAgZm9yIChsZXQgeCA9IDA7IHggPD0gMzsgeCArPSAwLjA1KSB7XG4gICAgY29uc3QgdiA9IHZpc0F0KHgpO1xuICAgIGlmICh2IDwgcHJldiAtIDFlLTMpIHsgbW9ubyA9IGZhbHNlOyBicmVhazsgfVxuICAgIHByZXYgPSB2O1xuICB9XG4gIGFzc2VydC5vayhtb25vLCAndmlzaWJpbGl0eSBpcyBtb25vdG9uZSBub24tZGVjcmVhc2luZycpO1xufSk7XG5cbnRlc3QoJ3NvZnQgc2hhZG93OiBiYWtlZCBmaWVsZCByZXByb2R1Y2VzIHRoZSBhbmFseXRpYyBmaWVsZCAod2l0aGluIHRyaWxpbmVhciB0b2xlcmFuY2UpJywgKCkgPT4ge1xuICBsZXQgbWF4RGlmZiA9IDA7XG4gIGZvciAoY29uc3QgeCBvZiBbMC4wLCAwLjYsIDAuODUsIDEuMCwgMS4zLCAyLjBdKSB7XG4gICAgY29uc3QgdkJha2VkID0gc29mdFNoYWRvdygocCkgPT4gc2FtcGxlR3JpZChncmlkLCBwKSwgW3gsIDAsIDBdLCBVUCwgc2hhZG93T3B0cykudmlzO1xuICAgIGNvbnN0IHZFeGFjdCA9IHNvZnRTaGFkb3coKHApID0+IHNwaGVyZVNjZW5lKHBbMF0sIHBbMV0sIHBbMl0pLCBbeCwgMCwgMF0sIFVQLCBzaGFkb3dPcHRzKS52aXM7XG4gICAgbWF4RGlmZiA9IE1hdGgubWF4KG1heERpZmYsIE1hdGguYWJzKHZCYWtlZCAtIHZFeGFjdCkpO1xuICB9XG4gIGFzc2VydC5vayhtYXhEaWZmIDwgMC4yLCBgYmFrZWQgdnMgYW5hbHl0aWMgc2hhZG93IGFncmVlIChtYXhEaWZmICR7bWF4RGlmZn0pYCk7XG59KTtcblxudGVzdCgnc29mdCBzaGFkb3c6IGxhcmdlciBrIG5hcnJvd3MgdGhlIHBlbnVtYnJhICh0aGUgc29mdG5lc3Mga25vYiB3b3JrcyknLCAoKSA9PiB7XG4gIGNvbnN0IHBlbnVtYnJhV2lkdGggPSAoazogbnVtYmVyKTogbnVtYmVyID0+IHtcbiAgICBsZXQgbG8gPSBJbmZpbml0eSwgaGkgPSAtSW5maW5pdHk7XG4gICAgZm9yIChsZXQgeCA9IDA7IHggPD0gMjsgeCArPSAwLjAwNSkge1xuICAgICAgY29uc3QgdiA9IHZpc0F0KHgsIGspO1xuICAgICAgaWYgKHYgPiAwLjA1ICYmIHYgPCAwLjk1KSB7IGxvID0gTWF0aC5taW4obG8sIHgpOyBoaSA9IE1hdGgubWF4KGhpLCB4KTsgfVxuICAgIH1cbiAgICByZXR1cm4gaGkgPj0gbG8gPyBoaSAtIGxvIDogMDtcbiAgfTtcbiAgY29uc3Qgd1NvZnQgPSBwZW51bWJyYVdpZHRoKDYpO1xuICBjb25zdCB3U2hhcnAgPSBwZW51bWJyYVdpZHRoKDQ4KTtcbiAgYXNzZXJ0Lm9rKHdTb2Z0ID4gMCwgYHNvZnQgayBoYXMgYSBtZWFzdXJhYmxlIHBlbnVtYnJhICgke3dTb2Z0fSlgKTtcbiAgYXNzZXJ0Lm9rKHdTaGFycCA8IHdTb2Z0LCBgbGFyZ2VyIGsgbmFycm93cyB0aGUgcGVudW1icmEgKCR7d1NoYXJwfSA8ICR7d1NvZnR9KWApO1xufSk7XG5cbi8vIC0tLS0gRikgaW50ZXJzZWN0QUFCQiBoaXQvbWlzcyArIGNsaXAgZXF1aXZhbGVuY2UgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdpbnRlcnNlY3RBQUJCOiBhIHZlcnRpY2FsIHJheSB0aHJvdWdoIHRoZSB2b2x1bWUgY2VudHJlIGhpdHM7IGEgcGFyYWxsZWwgb3V0c2lkZSByYXkgbWlzc2VzJywgKCkgPT4ge1xuICBjb25zdCBjOiBWZWMzID0gWyhWT0xfTUlOWzBdICsgVk9MX01BWFswXSkgLyAyLCAwLCAoVk9MX01JTlsyXSArIFZPTF9NQVhbMl0pIC8gMl07XG4gIGNvbnN0IHRocm91Z2ggPSBpbnRlcnNlY3RBQUJCKFtjWzBdLCBWT0xfTUlOWzFdIC0gMSwgY1syXV0sIFswLCAxLCAwXSwgVk9MX01JTiwgVk9MX01BWCk7XG4gIGFzc2VydC5vayh0aHJvdWdoWzFdID4gTWF0aC5tYXgodGhyb3VnaFswXSwgMCksICd2ZXJ0aWNhbCByYXkgdGhyb3VnaCBjZW50cmUgaGl0cycpO1xuICBjb25zdCBiZXNpZGUgPSBpbnRlcnNlY3RBQUJCKFtWT0xfTUFYWzBdICsgMSwgMCwgY1syXV0sIFswLCAxLCAwXSwgVk9MX01JTiwgVk9MX01BWCk7XG4gIGFzc2VydC5vayhiZXNpZGVbMV0gPCBNYXRoLm1heChiZXNpZGVbMF0sIDApLCAncGFyYWxsZWwgcmF5IG91dHNpZGUgdGhlIGJveCBtaXNzZXMnKTtcbn0pO1xuXG50ZXN0KCdzb2Z0IHNoYWRvdzogQUFCQi1jbGlwcGVkIG1hcmNoIG1hdGNoZXMgdGhlIGZ1bGwgbWFyY2gnLCAoKSA9PiB7XG4gIGNvbnN0IG5vcm0gPSAodjogVmVjMyk6IFZlYzMgPT4geyBjb25zdCBsID0gTWF0aC5oeXBvdCh2WzBdLCB2WzFdLCB2WzJdKTsgcmV0dXJuIFt2WzBdIC8gbCwgdlsxXSAvIGwsIHZbMl0gLyBsXTsgfTtcbiAgY29uc3QgZGlyczogVmVjM1tdID0gW1VQLCBub3JtKFswLjUsIDAuOCwgMC4yNV0pLCBub3JtKFstMC42LCAwLjcsIDAuMV0pXTtcbiAgY29uc3QgYWFiYiA9IHsgbWluOiBWT0xfTUlOLCBtYXg6IFZPTF9NQVggfTtcbiAgbGV0IG1heERpZmYgPSAwO1xuICBmb3IgKGNvbnN0IHJkIG9mIGRpcnMpIHtcbiAgICBmb3IgKGxldCB4ID0gLTIuNTsgeCA8PSAzOyB4ICs9IDAuMSkge1xuICAgICAgY29uc3Qgcm86IFZlYzMgPSBbeCwgMCwgMF07XG4gICAgICBjb25zdCB2Q2xpcCA9IHNvZnRTaGFkb3coKHApID0+IHNhbXBsZUdyaWQoZ3JpZCwgcCksIHJvLCByZCwgeyAuLi5zaGFkb3dPcHRzLCBhYWJiIH0pLnZpcztcbiAgICAgIGNvbnN0IHZGdWxsID0gc29mdFNoYWRvdygocCkgPT4gc2FtcGxlR3JpZChncmlkLCBwKSwgcm8sIHJkLCBzaGFkb3dPcHRzKS52aXM7XG4gICAgICBtYXhEaWZmID0gTWF0aC5tYXgobWF4RGlmZiwgTWF0aC5hYnModkNsaXAgLSB2RnVsbCkpO1xuICAgIH1cbiAgfVxuICBhc3NlcnQub2sobWF4RGlmZiA8IDAuMDIsIGBBQUJCLWNsaXBwZWQgbWFyY2ggbWF0Y2hlcyB0aGUgZnVsbCBtYXJjaCAobWF4RGlmZiAke21heERpZmZ9KWApO1xufSk7XG4iLCAiLy8gUHVyZSBzaWduZWQtZGlzdGFuY2UtZmllbGQgbWF0aCAtLSBubyBET00sIG5vIFdlYkdQVSwgbm8gQ0ROIGltcG9ydHMuXG5cbmltcG9ydCB0eXBlIHsgVmVjMyB9IGZyb20gJy4vdmVjMy50cyc7XG5cbi8vIC0tIFByaW1pdGl2ZSB0eXBlIGlkcyAtLSBjb252ZW5pZW50IHdoZW4gcGFja2luZyBhIHNjZW5lIGRlc2NyaXB0aW9uLiAtLS0tLS0tLS1cbmV4cG9ydCBjb25zdCBTREZfU1BIRVJFID0gMDtcbmV4cG9ydCBjb25zdCBTREZfQk9YID0gMTtcbmV4cG9ydCBjb25zdCBTREZfQ1lMSU5ERVIgPSAyO1xuZXhwb3J0IGNvbnN0IFNERl9UT1JVUyA9IDM7XG5cbi8qKiBBIDQtY29tcG9uZW50IHBhcmFtcyB2ZWN0b3I7IGVhY2ggcHJpbWl0aXZlIHJlYWRzIHRoZSBjb21wb25lbnRzIGl0IG5lZWRzLiAqL1xuZXhwb3J0IHR5cGUgU2RmUGFyYW1zID0gcmVhZG9ubHkgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl07XG5cbi8vIC0tIFByaW1pdGl2ZSBkaXN0YW5jZSBmdW5jdGlvbnMgKGxvY2FsIHNwYWNlKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGBwYXJhbXNgIGlzIGEgNC12ZWN0b3IuXG5cbi8qKiBTaWduZWQgZGlzdGFuY2UgdG8gYSBzcGhlcmUuIHBhcmFtczogW3JhZGl1c10uICovXG5leHBvcnQgZnVuY3Rpb24gc2RTcGhlcmUocDogVmVjMywgcGFyYW1zOiBTZGZQYXJhbXMpOiBudW1iZXIge1xuICByZXR1cm4gTWF0aC5oeXBvdChwWzBdLCBwWzFdLCBwWzJdKSAtIHBhcmFtc1swXTtcbn1cblxuLyoqIFNpZ25lZCBkaXN0YW5jZSB0byBhbiBheGlzLWFsaWduZWQgYm94LiBwYXJhbXM6IFtoYWxmWCwgaGFsZlksIGhhbGZaXS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZEJveChwOiBWZWMzLCBwYXJhbXM6IFNkZlBhcmFtcyk6IG51bWJlciB7XG4gIGNvbnN0IHF4ID0gTWF0aC5hYnMocFswXSkgLSBwYXJhbXNbMF07XG4gIGNvbnN0IHF5ID0gTWF0aC5hYnMocFsxXSkgLSBwYXJhbXNbMV07XG4gIGNvbnN0IHF6ID0gTWF0aC5hYnMocFsyXSkgLSBwYXJhbXNbMl07XG4gIGNvbnN0IG94ID0gTWF0aC5tYXgocXgsIDApLCBveSA9IE1hdGgubWF4KHF5LCAwKSwgb3ogPSBNYXRoLm1heChxeiwgMCk7XG4gIGNvbnN0IG91dHNpZGUgPSBNYXRoLmh5cG90KG94LCBveSwgb3opO1xuICBjb25zdCBpbnNpZGUgPSBNYXRoLm1pbihNYXRoLm1heChxeCwgTWF0aC5tYXgocXksIHF6KSksIDApO1xuICByZXR1cm4gb3V0c2lkZSArIGluc2lkZTtcbn1cblxuLyoqIFNpZ25lZCBkaXN0YW5jZSB0byBhIFktYXhpcyBjeWxpbmRlci4gcGFyYW1zOiBbcmFkaXVzLCBoYWxmSGVpZ2h0XS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZEN5bGluZGVyKHA6IFZlYzMsIHBhcmFtczogU2RmUGFyYW1zKTogbnVtYmVyIHtcbiAgY29uc3QgZHggPSBNYXRoLmh5cG90KHBbMF0sIHBbMl0pIC0gcGFyYW1zWzBdO1xuICBjb25zdCBkeSA9IE1hdGguYWJzKHBbMV0pIC0gcGFyYW1zWzFdO1xuICBjb25zdCBveCA9IE1hdGgubWF4KGR4LCAwKSwgb3kgPSBNYXRoLm1heChkeSwgMCk7XG4gIHJldHVybiBNYXRoLm1pbihNYXRoLm1heChkeCwgZHkpLCAwKSArIE1hdGguaHlwb3Qob3gsIG95KTtcbn1cblxuLyoqIFNpZ25lZCBkaXN0YW5jZSB0byBhIHRvcnVzIHdob3NlIHJpbmcgbGllcyBpbiB0aGUgWFogcGxhbmUuIHBhcmFtczogW21ham9yUmFkaXVzLCBtaW5vclJhZGl1c10uICovXG5leHBvcnQgZnVuY3Rpb24gc2RUb3J1cyhwOiBWZWMzLCBwYXJhbXM6IFNkZlBhcmFtcyk6IG51bWJlciB7XG4gIGNvbnN0IHF4ID0gTWF0aC5oeXBvdChwWzBdLCBwWzJdKSAtIHBhcmFtc1swXTtcbiAgcmV0dXJuIE1hdGguaHlwb3QocXgsIHBbMV0pIC0gcGFyYW1zWzFdO1xufVxuXG4vKiogRGlzcGF0Y2ggYSBwcmltaXRpdmUgYnkgaXRzIFNERl8qIHR5cGUgaWQuICovXG5leHBvcnQgZnVuY3Rpb24gcHJpbWl0aXZlU0RGKHR5cGU6IG51bWJlciwgcDogVmVjMywgcGFyYW1zOiBTZGZQYXJhbXMpOiBudW1iZXIge1xuICBzd2l0Y2ggKHR5cGUpIHtcbiAgICBjYXNlIFNERl9TUEhFUkU6IHJldHVybiBzZFNwaGVyZShwLCBwYXJhbXMpO1xuICAgIGNhc2UgU0RGX0JPWDogcmV0dXJuIHNkQm94KHAsIHBhcmFtcyk7XG4gICAgY2FzZSBTREZfQ1lMSU5ERVI6IHJldHVybiBzZEN5bGluZGVyKHAsIHBhcmFtcyk7XG4gICAgY2FzZSBTREZfVE9SVVM6IHJldHVybiBzZFRvcnVzKHAsIHBhcmFtcyk7XG4gICAgZGVmYXVsdDogcmV0dXJuIDFlOTtcbiAgfVxufVxuXG4vLyAtLSBUcmFuc2Zvcm1zIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUcmFuc2Zvcm0gYSBwb2ludCBieSBhIGNvbHVtbi1tYWpvciBhZmZpbmUgbWF0NCAodyA9IDEpLiBSZXR1cm5zIGEgbmV3IFZlYzMuICovXG5leHBvcnQgZnVuY3Rpb24gdHJhbnNmb3JtUG9pbnQobTogQXJyYXlMaWtlPG51bWJlcj4sIHA6IFZlYzMpOiBWZWMzIHtcbiAgY29uc3QgeCA9IHBbMF0sIHkgPSBwWzFdLCB6ID0gcFsyXTtcbiAgcmV0dXJuIFtcbiAgICBtWzBdICogeCArIG1bNF0gKiB5ICsgbVs4XSAqIHogKyBtWzEyXSxcbiAgICBtWzFdICogeCArIG1bNV0gKiB5ICsgbVs5XSAqIHogKyBtWzEzXSxcbiAgICBtWzJdICogeCArIG1bNl0gKiB5ICsgbVsxMF0gKiB6ICsgbVsxNF0sXG4gIF07XG59XG5cbi8vIC0tIEJha2VkIGdyaWQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBIGJha2VkIGRlbnNlIFNERiBncmlkOiB2b3hlbC1jZW50cmUsIHdvcmxkLXNwYWNlIGRpc3RhbmNlIHNhbXBsZXMuICovXG5leHBvcnQgaW50ZXJmYWNlIFNkZkdyaWQge1xuICBkYXRhOiBGbG9hdDMyQXJyYXk7XG4gIGRpbXM6IHJlYWRvbmx5IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXTtcbiAgdm9sTWluOiBWZWMzO1xuICB2b2xNYXg6IFZlYzM7XG59XG5cbi8qKiBBIHNjZW5lIGRpc3RhbmNlIGZpZWxkIGFzIGEgcGxhaW4gY2FsbGJhY2s6IHdvcmxkICh4LHkseikgLT4gc2lnbmVkIGRpc3RhbmNlLiAqL1xuZXhwb3J0IHR5cGUgU2NlbmVTREYgPSAoeDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlcikgPT4gbnVtYmVyO1xuXG4vKipcbiAqIEJha2UgYW4gYXJiaXRyYXJ5IHNjZW5lIFNERiBpbnRvIGEgZGVuc2UgZ3JpZCAodm94ZWwtY2VudHJlIHNhbXBsZXMsXG4gKiB3b3JsZC1zcGFjZSBkaXN0YW5jZSkuIGBzY2VuZSh4LHkseilgIHJldHVybnMgdGhlIHNpZ25lZCBkaXN0YW5jZSBhdCBhIHdvcmxkXG4gKiBwb2ludCAtLSBjb21wb3NlIGl0IGZyb20gdGhlIHByaW1pdGl2ZXMgYWJvdmUgKGFuZCBgdHJhbnNmb3JtUG9pbnRgKSBob3dldmVyXG4gKiB5b3UgbGlrZTsgdGhpcyBzdGF5cyBkZW1vLWFnbm9zdGljLiBUaGUgYmFrZSBpcyBhIG9uZS10aW1lIENQVSBjb3N0IGJlZm9yZSB0aGVcbiAqIGZpZWxkIGlzIHVwbG9hZGVkIHRvIGEgM0QgdGV4dHVyZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VHcmlkKFxuICBzY2VuZTogU2NlbmVTREYsXG4gIHZvbE1pbjogVmVjMyxcbiAgdm9sTWF4OiBWZWMzLFxuICBkaW1zOiByZWFkb25seSBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0sXG4pOiBTZGZHcmlkIHtcbiAgY29uc3QgW254LCBueSwgbnpdID0gZGltcztcbiAgY29uc3QgZGF0YSA9IG5ldyBGbG9hdDMyQXJyYXkobnggKiBueSAqIG56KTtcbiAgY29uc3QgZXggPSB2b2xNYXhbMF0gLSB2b2xNaW5bMF0sIGV5ID0gdm9sTWF4WzFdIC0gdm9sTWluWzFdLCBleiA9IHZvbE1heFsyXSAtIHZvbE1pblsyXTtcbiAgZm9yIChsZXQgeiA9IDA7IHogPCBuejsgeisrKSB7XG4gICAgY29uc3Qgd3ogPSB2b2xNaW5bMl0gKyAoeiArIDAuNSkgLyBueiAqIGV6O1xuICAgIGZvciAobGV0IHkgPSAwOyB5IDwgbnk7IHkrKykge1xuICAgICAgY29uc3Qgd3kgPSB2b2xNaW5bMV0gKyAoeSArIDAuNSkgLyBueSAqIGV5O1xuICAgICAgY29uc3Qgcm93ID0gKHogKiBueSArIHkpICogbng7XG4gICAgICBmb3IgKGxldCB4ID0gMDsgeCA8IG54OyB4KyspIHtcbiAgICAgICAgY29uc3Qgd3ggPSB2b2xNaW5bMF0gKyAoeCArIDAuNSkgLyBueCAqIGV4O1xuICAgICAgICBkYXRhW3JvdyArIHhdID0gc2NlbmUod3gsIHd5LCB3eik7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiB7IGRhdGEsIGRpbXMsIHZvbE1pbiwgdm9sTWF4IH07XG59XG5cbmZ1bmN0aW9uIGxvYWRUZXhlbChncmlkOiBTZGZHcmlkLCBpeDogbnVtYmVyLCBpeTogbnVtYmVyLCBpejogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgW254LCBueSwgbnpdID0gZ3JpZC5kaW1zO1xuICBjb25zdCBjeCA9IE1hdGgubWluKE1hdGgubWF4KGl4LCAwKSwgbnggLSAxKTtcbiAgY29uc3QgY3kgPSBNYXRoLm1pbihNYXRoLm1heChpeSwgMCksIG55IC0gMSk7XG4gIGNvbnN0IGN6ID0gTWF0aC5taW4oTWF0aC5tYXgoaXosIDApLCBueiAtIDEpO1xuICByZXR1cm4gZ3JpZC5kYXRhWyhjeiAqIG55ICsgY3kpICogbnggKyBjeF07XG59XG5cbi8qICovXG5leHBvcnQgZnVuY3Rpb24gdHJpbGluZWFyKGdyaWQ6IFNkZkdyaWQsIHE6IFZlYzMpOiBudW1iZXIge1xuICBjb25zdCBbbngsIG55LCBuel0gPSBncmlkLmRpbXM7XG4gIGNvbnN0IGd4ID0gcVswXSAqIG54IC0gMC41LCBneSA9IHFbMV0gKiBueSAtIDAuNSwgZ3ogPSBxWzJdICogbnogLSAwLjU7XG4gIGNvbnN0IGJ4ID0gTWF0aC5mbG9vcihneCksIGJ5ID0gTWF0aC5mbG9vcihneSksIGJ6ID0gTWF0aC5mbG9vcihneik7XG4gIGNvbnN0IGZ4ID0gZ3ggLSBieCwgZnkgPSBneSAtIGJ5LCBmeiA9IGd6IC0gYno7XG4gIGNvbnN0IGMwMDAgPSBsb2FkVGV4ZWwoZ3JpZCwgYngsIGJ5LCBieik7XG4gIGNvbnN0IGMxMDAgPSBsb2FkVGV4ZWwoZ3JpZCwgYnggKyAxLCBieSwgYnopO1xuICBjb25zdCBjMDEwID0gbG9hZFRleGVsKGdyaWQsIGJ4LCBieSArIDEsIGJ6KTtcbiAgY29uc3QgYzExMCA9IGxvYWRUZXhlbChncmlkLCBieCArIDEsIGJ5ICsgMSwgYnopO1xuICBjb25zdCBjMDAxID0gbG9hZFRleGVsKGdyaWQsIGJ4LCBieSwgYnogKyAxKTtcbiAgY29uc3QgYzEwMSA9IGxvYWRUZXhlbChncmlkLCBieCArIDEsIGJ5LCBieiArIDEpO1xuICBjb25zdCBjMDExID0gbG9hZFRleGVsKGdyaWQsIGJ4LCBieSArIDEsIGJ6ICsgMSk7XG4gIGNvbnN0IGMxMTEgPSBsb2FkVGV4ZWwoZ3JpZCwgYnggKyAxLCBieSArIDEsIGJ6ICsgMSk7XG4gIGNvbnN0IGxlcnAgPSAoYTogbnVtYmVyLCBiOiBudW1iZXIsIHQ6IG51bWJlcikgPT4gYSArIChiIC0gYSkgKiB0O1xuICBjb25zdCB4MDAgPSBsZXJwKGMwMDAsIGMxMDAsIGZ4KSwgeDEwID0gbGVycChjMDEwLCBjMTEwLCBmeCk7XG4gIGNvbnN0IHgwMSA9IGxlcnAoYzAwMSwgYzEwMSwgZngpLCB4MTEgPSBsZXJwKGMwMTEsIGMxMTEsIGZ4KTtcbiAgY29uc3QgeTAgPSBsZXJwKHgwMCwgeDEwLCBmeSksIHkxID0gbGVycCh4MDEsIHgxMSwgZnkpO1xuICByZXR1cm4gbGVycCh5MCwgeTEsIGZ6KTtcbn1cblxuLyoqXG4gKiBTYW1wbGUgdGhlIGJha2VkIGZpZWxkIGF0IGEgd29ybGQgcG9pbnQsIHdpdGggdGhlIHNhZmUgb3V0c2lkZSBleHRlbnNpb24uXG4gKiBJbnNpZGUgdGhlIHZvbHVtZSB0aGUgdHJpbGluZWFyIHZhbHVlIGlzIHJldHVybmVkIHZlcmJhdGltIChpdCBtYXkgYmUgbmVnYXRpdmUsXG4gKiBpbnNpZGUgYW4gb2JqZWN0KS4gT3V0c2lkZSwgcmV0dXJucyBtYXgoZWRnZVZhbHVlLCBkaXN0YW5jZVRvQm94KTogY29udGludW91c1xuICogYXQgdGhlIGZhY2UgKGRPdXQgPSAwIHRoZXJlKSBhbmQgbmV2ZXIgc3B1cmlvdXNseSBzbWFsbCwgc28gYSByYXkgbGVhdmluZyB0aGVcbiAqIHZvbHVtZSBpcyBuZXZlciBmYWxzZWx5IHNoYWRvd2VkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FtcGxlR3JpZChncmlkOiBTZGZHcmlkLCBwOiBWZWMzKTogbnVtYmVyIHtcbiAgY29uc3QgeyB2b2xNaW4sIHZvbE1heCB9ID0gZ3JpZDtcbiAgY29uc3QgZXh0OiBWZWMzID0gW3ZvbE1heFswXSAtIHZvbE1pblswXSwgdm9sTWF4WzFdIC0gdm9sTWluWzFdLCB2b2xNYXhbMl0gLSB2b2xNaW5bMl1dO1xuICBjb25zdCBxOiBWZWMzID0gW1xuICAgIChwWzBdIC0gdm9sTWluWzBdKSAvIGV4dFswXSxcbiAgICAocFsxXSAtIHZvbE1pblsxXSkgLyBleHRbMV0sXG4gICAgKHBbMl0gLSB2b2xNaW5bMl0pIC8gZXh0WzJdLFxuICBdO1xuICBjb25zdCBpbnNpZGUgPSBxWzBdID49IDAgJiYgcVswXSA8PSAxICYmIHFbMV0gPj0gMCAmJiBxWzFdIDw9IDEgJiYgcVsyXSA+PSAwICYmIHFbMl0gPD0gMTtcbiAgY29uc3QgY3E6IFZlYzMgPSBbXG4gICAgTWF0aC5taW4oTWF0aC5tYXgocVswXSwgMCksIDEpLFxuICAgIE1hdGgubWluKE1hdGgubWF4KHFbMV0sIDApLCAxKSxcbiAgICBNYXRoLm1pbihNYXRoLm1heChxWzJdLCAwKSwgMSksXG4gIF07XG4gIGNvbnN0IGRJbiA9IHRyaWxpbmVhcihncmlkLCBjcSk7XG4gIGlmIChpbnNpZGUpIHJldHVybiBkSW47XG4gIGNvbnN0IGRPdXQgPSBNYXRoLmh5cG90KFxuICAgIE1hdGgubWF4KHZvbE1pblswXSAtIHBbMF0sIHBbMF0gLSB2b2xNYXhbMF0sIDApLFxuICAgIE1hdGgubWF4KHZvbE1pblsxXSAtIHBbMV0sIHBbMV0gLSB2b2xNYXhbMV0sIDApLFxuICAgIE1hdGgubWF4KHZvbE1pblsyXSAtIHBbMl0sIHBbMl0gLSB2b2xNYXhbMl0sIDApLFxuICApO1xuICByZXR1cm4gTWF0aC5tYXgoZEluLCBkT3V0KTtcbn1cblxuLy8gLS0gUmF5IC8gYm94IGludGVyc2VjdGlvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU2xhYiByYXkvQUFCQiB0ZXN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGludGVyc2VjdEFBQkIocm86IFZlYzMsIHJkOiBWZWMzLCBibWluOiBWZWMzLCBibWF4OiBWZWMzKTogW251bWJlciwgbnVtYmVyXSB7XG4gIGNvbnN0IGludjogVmVjMyA9IFsxIC8gcmRbMF0sIDEgLyByZFsxXSwgMSAvIHJkWzJdXTtcbiAgY29uc3QgdDA6IFZlYzMgPSBbKGJtaW5bMF0gLSByb1swXSkgKiBpbnZbMF0sIChibWluWzFdIC0gcm9bMV0pICogaW52WzFdLCAoYm1pblsyXSAtIHJvWzJdKSAqIGludlsyXV07XG4gIGNvbnN0IHQxOiBWZWMzID0gWyhibWF4WzBdIC0gcm9bMF0pICogaW52WzBdLCAoYm1heFsxXSAtIHJvWzFdKSAqIGludlsxXSwgKGJtYXhbMl0gLSByb1syXSkgKiBpbnZbMl1dO1xuICBjb25zdCB0czogVmVjMyA9IFtNYXRoLm1pbih0MFswXSwgdDFbMF0pLCBNYXRoLm1pbih0MFsxXSwgdDFbMV0pLCBNYXRoLm1pbih0MFsyXSwgdDFbMl0pXTtcbiAgY29uc3QgdGI6IFZlYzMgPSBbTWF0aC5tYXgodDBbMF0sIHQxWzBdKSwgTWF0aC5tYXgodDBbMV0sIHQxWzFdKSwgTWF0aC5tYXgodDBbMl0sIHQxWzJdKV07XG4gIHJldHVybiBbTWF0aC5tYXgodHNbMF0sIHRzWzFdLCB0c1syXSksIE1hdGgubWluKHRiWzBdLCB0YlsxXSwgdGJbMl0pXTtcbn1cblxuLy8gLS0gU29mdCBzaGFkb3cgbWFyY2ggKEluaWdvIFF1aWxleiBjbG9zZXN0LWFwcHJvYWNoIHBlbnVtYnJhKSAtLS0tLS0tLS0tLS0tLVxuXG4vKiogT3B0aW9uYWwgY2xpcCBib3ggZm9yIGBzb2Z0U2hhZG93YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2RmQWFiYiB7XG4gIG1pbjogVmVjMztcbiAgbWF4OiBWZWMzO1xufVxuXG4vKiogT3B0aW9ucyBmb3IgYHNvZnRTaGFkb3dgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTb2Z0U2hhZG93T3B0aW9ucyB7XG4gIC8qKiBTdGFydCBvZiB0aGUgbWFyY2ggKGF2b2lkcyBzZWxmLXNoYWRvdyBhdCB0aGUgc3VyZmFjZSkuICovXG4gIHRtaW4/OiBudW1iZXI7XG4gIC8qKiBFbmQgb2YgdGhlIG1hcmNoLiAqL1xuICB0bWF4PzogbnVtYmVyO1xuICAvKiogUGVudW1icmEgc2hhcnBuZXNzIC0tIGxhcmdlIGsgPSBzaGFycCwgc21hbGwgayA9IHNvZnQuICovXG4gIGs/OiBudW1iZXI7XG4gIC8qKiBNYXhpbXVtIHN0ZXAgY291bnQuICovXG4gIG1heFN0ZXBzPzogbnVtYmVyO1xuICAvKiogTWluaW11bSBhZHZhbmNlIHBlciBzdGVwLiAqL1xuICBtaW5TdGVwPzogbnVtYmVyO1xuICAvKiogTWF4aW11bSBhZHZhbmNlIHBlciBzdGVwLiAqL1xuICBtYXhTdGVwPzogbnVtYmVyO1xuICAvKiogRGlzdGFuY2UgYmVsb3cgd2hpY2ggdGhlIHJheSBpcyBjb25zaWRlcmVkIGZ1bGx5IG9jY2x1ZGVkLiBEZWZhdWx0IDFlLTMuICovXG4gIGVwcz86IG51bWJlcjtcbiAgLyoqIENsaXAgdGhlIG1hcmNoIHRvIHRoaXMgYm94OyBhIHJheSB0aGF0IG1pc3NlcyBpdCByZXR1cm5zIGZ1bGx5IGxpdC4gRGVmYXVsdCBub25lLiAqL1xuICBhYWJiPzogU2RmQWFiYiB8IG51bGw7XG59XG5cbi8qKiBSZXN1bHQgb2YgYSBgc29mdFNoYWRvd2AgbWFyY2guICovXG5leHBvcnQgaW50ZXJmYWNlIFNvZnRTaGFkb3dSZXN1bHQge1xuICAvKiAqL1xuICB2aXM6IG51bWJlcjtcbiAgLyoqIE51bWJlciBvZiBmaWVsZCBzYW1wbGVzIHRha2VuIChmb3IgY29zdCB2aXN1YWxpc2F0aW9uKS4gKi9cbiAgc3RlcHM6IG51bWJlcjtcbn1cblxuLypgc2FtcGxlRm4ocClgIHJldHVybnMgdGhlIHNjZW5lIFNERiBhdCBhIHBvaW50LiByZXMgPSBtaW4ocmVzLCBrKmgvdCk6IHRoZVxuICogY2xvc2VzdCB0aGUgcmF5IHBhc3NlcyB0byB0aGUgc3VyZmFjZSwgc2NhbGVkIGJ5IGssIGlzIHRoZSBwZW51bWJyYS4gSWYgYGFhYmJgXG4gKiBpcyBnaXZlbiwgdGhlIG1hcmNoIGlzIGNsaXBwZWQgdG8gdGhhdCBib3ggYW5kIGEgcmF5IHRoYXQgbWlzc2VzIGl0IHJldHVybnNcbiAqIGZ1bGx5IGxpdCBhdCB6ZXJvIGNvc3QuIFdoZW4gdGhlIGZpZWxkIGhhcyBubyBvY2NsdWRlciBvdXRzaWRlIHRoZSB2b2x1bWUgdGhpc1xuICogaXMgY29ycmVjdG5lc3MtcHJlc2VydmluZywgYW5kIGl0IGtlZXBzIGxhcmdlIHJlY2VpdmVycyBjaGVhcC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzb2Z0U2hhZG93KFxuICBzYW1wbGVGbjogKHA6IFZlYzMpID0+IG51bWJlcixcbiAgcm86IFZlYzMsXG4gIHJkOiBWZWMzLFxuICBvcHRzOiBTb2Z0U2hhZG93T3B0aW9ucyA9IHt9LFxuKTogU29mdFNoYWRvd1Jlc3VsdCB7XG4gIGNvbnN0IHtcbiAgICB0bWluID0gMC4wMiwgdG1heCA9IDIwLCBrID0gMTYsIG1heFN0ZXBzID0gNjQsXG4gICAgbWluU3RlcCA9IDAuMDEsIG1heFN0ZXAgPSA1LCBlcHMgPSAxZS0zLCBhYWJiID0gbnVsbCxcbiAgfSA9IG9wdHM7XG4gIGxldCBsbyA9IHRtaW4sIGhpID0gdG1heDtcbiAgaWYgKGFhYmIpIHtcbiAgICBjb25zdCBbdG4sIHRmXSA9IGludGVyc2VjdEFBQkIocm8sIHJkLCBhYWJiLm1pbiwgYWFiYi5tYXgpO1xuICAgIGNvbnN0IHRFbnRlciA9IE1hdGgubWF4KHRuLCAwKTtcbiAgICBpZiAodGYgPD0gdEVudGVyKSByZXR1cm4geyB2aXM6IDEsIHN0ZXBzOiAwIH07XG4gICAgbG8gPSBNYXRoLm1heCh0bWluLCB0RW50ZXIpO1xuICAgIGhpID0gTWF0aC5taW4odG1heCwgdGYpO1xuICAgIGlmIChoaSA8PSBsbykgcmV0dXJuIHsgdmlzOiAxLCBzdGVwczogMCB9O1xuICB9XG4gIGxldCByZXMgPSAxO1xuICBsZXQgdCA9IGxvO1xuICBsZXQgc3RlcHMgPSAwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IG1heFN0ZXBzOyBpKyspIHtcbiAgICBpZiAodCA+PSBoaSkgYnJlYWs7XG4gICAgY29uc3QgcDogVmVjMyA9IFtyb1swXSArIHJkWzBdICogdCwgcm9bMV0gKyByZFsxXSAqIHQsIHJvWzJdICsgcmRbMl0gKiB0XTtcbiAgICBjb25zdCBoID0gc2FtcGxlRm4ocCk7XG4gICAgc3RlcHMrKztcbiAgICBpZiAoaCA8IGVwcykgeyByZXMgPSAwOyBicmVhazsgfVxuICAgIHJlcyA9IE1hdGgubWluKHJlcywgKGsgKiBoKSAvIHQpO1xuICAgIHQgKz0gTWF0aC5taW4oTWF0aC5tYXgoaCwgbWluU3RlcCksIG1heFN0ZXApO1xuICB9XG4gIHJldHVybiB7IHZpczogTWF0aC5taW4oTWF0aC5tYXgocmVzLCAwKSwgMSksIHN0ZXBzIH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBRUEsU0FBUyxZQUFZO0FBQ3JCLE9BQU8sWUFBWTs7O0FDRVosSUFBTSxhQUFhO0FBQ25CLElBQU0sVUFBVTtBQUNoQixJQUFNLGVBQWU7QUFDckIsSUFBTSxZQUFZO0FBU2xCLFNBQVMsU0FBUyxHQUFTLFFBQTJCO0FBQzNELFNBQU8sS0FBSyxNQUFNLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDO0FBQ2hEO0FBR08sU0FBUyxNQUFNLEdBQVMsUUFBMkI7QUFDeEQsUUFBTSxLQUFLLEtBQUssSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLE9BQU8sQ0FBQztBQUNwQyxRQUFNLEtBQUssS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDO0FBQ3BDLFFBQU0sS0FBSyxLQUFLLElBQUksRUFB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
