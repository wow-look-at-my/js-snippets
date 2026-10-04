// src/math/cylinder-fit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/math/sampling.ts
function radicalInverse2(i) {
  let bits = i >>> 0;
  bits = bits << 16 | bits >>> 16;
  bits = (bits & 1431655765) << 1 | (bits & 2863311530) >>> 1;
  bits = (bits & 858993459) << 2 | (bits & 3435973836) >>> 2;
  bits = (bits & 252645135) << 4 | (bits & 4042322160) >>> 4;
  bits = (bits & 16711935) << 8 | (bits & 4278255360) >>> 8;
  return (bits >>> 0) / 4294967296;
}
function hammersley(i, n) {
  return [i / n, radicalInverse2(i)];
}
function uniformHemisphere(u, v) {
  const z = u;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const phi = 2 * Math.PI * v;
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

// src/math/least-squares.ts
function dims(a) {
  const rows = a.length;
  if (rows === 0) throw new RangeError("matrix has no rows");
  const cols = a[0].length;
  for (const row of a) {
    if (row.length !== cols) throw new RangeError("matrix rows have unequal lengths");
  }
  return [rows, cols];
}
function rms(values) {
  if (values.length === 0) return 0;
  let acc = 0;
  for (const v of values) acc += v * v;
  return Math.sqrt(acc / values.length);
}
function covariance3(points) {
  const n = points.length;
  if (n === 0) throw new RangeError("covariance3: empty point list");
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const p of points) {
    mx += p[0];
    my += p[1];
    mz += p[2];
  }
  mx /= n;
  my /= n;
  mz /= n;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const p of points) {
    const dx = p[0] - mx;
    const dy = p[1] - my;
    const dz = p[2] - mz;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }
  const matrix = [
    [xx / n, xy / n, xz / n],
    [xy / n, yy / n, yz / n],
    [xz / n, yz / n, zz / n]
  ];
  return { mean: [mx, my, mz], matrix };
}
function canonicalSign(v) {
  let index = 0;
  for (let i = 1; i < 3; i++) {
    if (Math.abs(v[i]) > Math.abs(v[index])) index = i;
  }
  return v[index] < 0 ? [-v[0], -v[1], -v[2]] : v;
}
function symmetricEigen3(matrix) {
  const [rows, cols] = dims(matrix);
  if (rows !== 3 || cols !== 3) throw new RangeError(`symmetricEigen3 needs a 3x3 matrix, got ${rows}x${cols}`);
  const a = matrix.map((row) => [...row]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  const pairs = [
    [0, 1],
    [0, 2],
    [1, 2]
  ];
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (const [p, q] of pairs) off += Math.abs(a[p][q]);
    if (off <= 1e-18) break;
    for (const [p, q] of pairs) {
      const apq = a[p][q];
      if (Math.abs(apq) <= 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * apq);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  const values = order.map((i) => a[i][i]);
  const vectors = order.map((i) => canonicalSign([v[0][i], v[1][i], v[2][i]]));
  return { values, vectors };
}
function fitOrthoLine3(points) {
  if (points.length < 2) return null;
  const { mean, matrix } = covariance3(points);
  const { values, vectors } = symmetricEigen3(matrix);
  if (values[2] <= Number.EPSILON) return null;
  const direction = vectors[2];
  const errors = points.map((p) => {
    const dx = p[0] - mean[0];
    const dy = p[1] - mean[1];
    const dz = p[2] - mean[2];
    const along = dx * direction[0] + dy * direction[1] + dz * direction[2];
    return Math.hypot(dx - along * direction[0], dy - along * direction[1], dz - along * direction[2]);
  });
  return { point: mean, direction, rms: rms(errors) };
}

// src/math/cylinder-fit.ts
function project(w, v) {
  const along = v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
  return [v[0] - along * w[0], v[1] - along * w[1], v[2] - along * w[2]];
}
function normalizeOrNull(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 0)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}
function anyOrthogonal(w) {
  const ax = Math.abs(w[0]);
  const ay = Math.abs(w[1]);
  const az = Math.abs(w[2]);
  const axis = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const cross = [
    w[1] * axis[2] - w[2] * axis[1],
    w[2] * axis[0] - w[0] * axis[2],
    w[0] * axis[1] - w[1] * axis[0]
  ];
  return normalizeOrNull(cross) ?? [1, 0, 0];
}
function centroid(points) {
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const p of points) {
    mx += p[0];
    my += p[1];
    mz += p[2];
  }
  const n = points.length;
  return [mx / n, my / n, mz / n];
}
function axisExtent(points, center, axis) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const t = (p[0] - center[0]) * axis[0] + (p[1] - center[1]) * axis[1] + (p[2] - center[2]) * axis[2];
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return [lo, hi];
}
function fitCylinderForAxis(points, direction) {
  if (points.length < 5) return null;
  const w = normalizeOrNull(direction);
  if (!w) return null;
  const mean = centroid(points);
  const n = points.length;
  const projected = [];
  const sqrLengths = [];
  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  const b = [0, 0, 0];
  let averageSqrLength = 0;
  for (const p of points) {
    const y = project(w, [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]]);
    const sqrLen = y[0] * y[0] + y[1] * y[1] + y[2] * y[2];
    projected.push(y);
    sqrLengths.push(sqrLen);
    averageSqrLength += sqrLen;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) a[i][j] += y[i] * y[j];
      b[i] += sqrLen * y[i];
    }
  }
  averageSqrLength /= n;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) a[i][j] /= n;
    b[i] /= n;
  }
  const s = [
    [0, -w[2], w[1]],
    [w[2], 0, -w[0]],
    [-w[1], w[0], 0]
  ];
  const sa = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let acc = 0;
      for (let k = 0; k < 3; k++) acc += s[i][k] * a[k][j];
      sa[i][j] = acc;
    }
  }
  const ahat = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let acc = 0;
      for (let k = 0; k < 3; k++) acc += sa[i][k] * s[k][j];
      ahat[i][j] = -acc;
    }
  }
  let trace = 0;
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) trace += ahat[i][k] * a[k][i];
  }
  if (!(Math.abs(trace) > 0)) return null;
  const offset = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let acc = 0;
    for (let k = 0; k < 3; k++) acc += ahat[i][k] * b[k];
    offset[i] = acc / trace;
  }
  if (!offset.every((v) => Number.isFinite(v))) return null;
  let error = 0;
  let rsqr = 0;
  for (let i = 0; i < n; i++) {
    const y = projected[i];
    const term = sqrLengths[i] - averageSqrLength - 2 * (y[0] * offset[0] + y[1] * offset[1] + y[2] * offset[2]);
    error += term * term;
    rsqr += (offset[0] - y[0]) ** 2 + (offset[1] - y[1]) ** 2 + (offset[2] - y[2]) ** 2;
  }
  error /= n;
  rsqr /= n;
  if (!(rsqr >= 0) || !Number.isFinite(error)) return null;
  const radius = Math.sqrt(rsqr);
  const center = [mean[0] + offset[0], mean[1] + offset[1], mean[2] + offset[2]];
  let radialSq = 0;
  for (let i = 0; i < n; i++) {
    const y = projected[i];
    const d = Math.hypot(y[0] - offset[0], y[1] - offset[1], y[2] - offset[2]) - radius;
    radialSq += d * d;
  }
  const extent = axisExtent(points, center, w);
  return {
    center,
    axis: w,
    radius,
    error,
    rms: Math.sqrt(radialSq / n),
    height: extent[1] - extent[0],
    extent
  };
}
function candidateDirections(points, samples) {
  const out = [];
  const principal = fitOrthoLine3(points);
  if (principal) out.push(principal.direction);
  for (let i = 0; i < samples; i++) {
    const [u, v] = hammersley(i, samples);
    out.push(uniformHemisphere(u, v));
  }
  return out;
}
function refineDirection(points, start, steps, tolerance) {
  let best = start;
  let step = 0.1;
  for (let i = 0; i < steps && step > tolerance; i++) {
    const t1 = anyOrthogonal(best.axis);
    const t2 = [
      best.axis[1] * t1[2] - best.axis[2] * t1[1],
      best.axis[2] * t1[0] - best.axis[0] * t1[2],
      best.axis[0] * t1[1] - best.axis[1] * t1[0]
    ];
    let improved = false;
    for (const tangent of [t1, t2]) {
      for (const sign of [1, -1]) {
        const candidate = [
          best.axis[0] + sign * step * tangent[0],
          best.axis[1] + sign * step * tangent[1],
          best.axis[2] + sign * step * tangent[2]
        ];
        const fit = fitCylinderForAxis(points, candidate);
        if (fit && fit.error < best.error) {
          best = fit;
          improved = true;
        }
      }
    }
    if (!improved) step /= 2;
  }
  return best;
}
function fitCylinder(points, options = {}) {
  if (points.length < 5) return null;
  const samples = options.directionSamples ?? 256;
  const refineSteps = options.refineSteps ?? 64;
  const tolerance = options.tolerance ?? 1e-9;
  const candidates = options.direction ? [options.direction] : candidateDirections(points, samples);
  let best = null;
  for (const direction of candidates) {
    const fit = fitCylinderForAxis(points, direction);
    if (fit && (!best || fit.error < best.error)) best = fit;
  }
  if (!best) return null;
  return refineDirection(points, best, refineSteps, tolerance);
}
function distanceToCylinderSurface(fit, p) {
  const radial = project(fit.axis, [p[0] - fit.center[0], p[1] - fit.center[1], p[2] - fit.center[2]]);
  return Math.hypot(radial[0], radial[1], radial[2]) - fit.radius;
}

// src/math/cylinder-fit.test.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cylinderPoints(center, axis, radius, halfHeight, rings, perRing, jitter = 0, seed = 1) {
  const w = normalize(axis);
  const helper = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize([
    w[1] * helper[2] - w[2] * helper[1],
    w[2] * helper[0] - w[0] * helper[2],
    w[0] * helper[1] - w[1] * helper[0]
  ]);
  const v = normalize([
    w[1] * u[2] - w[2] * u[1],
    w[2] * u[0] - w[0] * u[2],
    w[0] * u[1] - w[1] * u[0]
  ]);
  const rand = mulberry32(seed);
  const points = [];
  for (let i = 0; i < rings; i++) {
    const t = rings === 1 ? 0 : -halfHeight + 2 * halfHeight * i / (rings - 1);
    for (let j = 0; j < perRing; j++) {
      const angle = 2 * Math.PI * (j + i * 0.37) / perRing;
      const r = radius * (1 + (jitter === 0 ? 0 : (rand() - 0.5) * 2 * jitter));
      points.push([
        center[0] + w[0] * t + u[0] * r * Math.cos(angle) + v[0] * r * Math.sin(angle),
        center[1] + w[1] * t + u[1] * r * Math.cos(angle) + v[1] * r * Math.sin(angle),
        center[2] + w[2] * t + u[2] * r * Math.cos(angle) + v[2] * r * Math.sin(angle)
      ]);
    }
  }
  return points;
}
test("fitCylinderForAxis is exact when the axis is already known", () => {
  const center = [1, -2, 3];
  const axis = [0, 0, 1];
  const points = cylinderPoints(center, axis, 2, 5, 6, 12);
  const fit = fitCylinderForAxis(points, axis);
  assert.ok(fit);
  assert.ok(Math.abs(fit.radius - 2) < 1e-9, `radius ${fit.radius}`);
  assert.ok(fit.rms < 1e-9);
  assert.ok(Math.abs(fit.center[0] - 1) < 1e-9);
  assert.ok(Math.abs(fit.center[1] + 2) < 1e-9);
  assert.ok(Math.abs(fit.height - 10) < 1e-9);
});
test("fitCylinderForAxis normalizes the given direction", () => {
  const points = cylinderPoints([0, 0, 0], [0, 0, 1], 1.5, 4, 6, 10);
  const fit = fitCylinderForAxis(points, [0, 0, 7]);
  assert.ok(fit);
  assert.ok(Math.abs(Math.hypot(...fit.axis) - 1) < 1e-12);
  assert.ok(Math.abs(fit.radius - 1.5) < 1e-9);
});
test("fitCylinderForAxis rejects too few points and a zero direction", () => {
  const points = cylinderPoints([0, 0, 0], [0, 0, 1], 1, 1, 6, 10);
  assert.equal(fitCylinderForAxis(points.slice(0, 4), [0, 0, 1]), null);
  assert.equal(fitCylinderForAxis(points, [0, 0, 0]), null);
});
test("fitCylinderForAxis is degenerate for points ON the axis", () => {
  const points = [];
  for (let i = 0; i < 10; i++) points.push([0, 0, i]);
  assert.equal(fitCylinderForAxis(points, [0, 0, 1]), null);
});
test("a wrong axis scores worse than the true one", () => {
  const points = cylinderPoints([0, 0, 0], [0, 0, 1], 2, 6, 8, 12);
  const good = fitCylinderForAxis(points, [0, 0, 1]);
  const bad = fitCylinderForAxis(points, [1, 0, 0]);
  assert.ok(good);
  assert.ok(bad);
  assert.ok(good.error < bad.error, `${good.error} vs ${bad.error}`);
});
test("fitCylinder recovers an axis-aligned cylinder without a hint", () => {
  const center = [-4, 7, 0.5];
  const axis = [0, 1, 0];
  const points = cylinderPoints(center, axis, 3, 8, 8, 16);
  const fit = fitCylinder(points);
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-6, `axis ${fit.axis}`);
  assert.ok(Math.abs(fit.radius - 3) < 1e-6, `radius ${fit.radius}`);
  assert.ok(fit.rms < 1e-6);
  assert.ok(Math.abs(fit.center[0] + 4) < 1e-6);
  assert.ok(Math.abs(fit.center[2] - 0.5) < 1e-6);
  assert.ok(Math.abs(fit.height - 16) < 1e-6);
});
test("fitCylinder recovers an obliquely-oriented cylinder", () => {
  const center = [2, 2, -1];
  const axis = normalize([1, 2, -0.5]);
  const points = cylinderPoints(center, axis, 1.25, 6, 9, 14);
  const fit = fitCylinder(points);
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-6, `axis ${fit.axis}`);
  assert.ok(Math.abs(fit.radius - 1.25) < 1e-6, `radius ${fit.radius}`);
  assert.ok(fit.rms < 1e-6);
  const d = [fit.center[0] - center[0], fit.center[1] - center[1], fit.center[2] - center[2]];
  const along = dot(d, axis);
  const perp = Math.hypot(d[0] - along * axis[0], d[1] - along * axis[1], d[2] - along * axis[2]);
  assert.ok(perp < 1e-6, `centre off-axis by ${perp}`);
});
test("fitCylinder finds the axis of a SHORT wide cylinder, where the cloud is flat", () => {
  const axis = [0, 0, 1];
  const points = cylinderPoints([0, 0, 0], axis, 10, 0.4, 3, 40);
  const fit = fitCylinder(points);
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-4, `axis ${fit.axis}`);
  assert.ok(Math.abs(fit.radius - 10) < 1e-3, `radius ${fit.radius}`);
});
test("fitCylinder stays near the generator under radial noise", () => {
  const axis = normalize([0.3, -1, 0.2]);
  const center = [5, 5, 5];
  const points = cylinderPoints(center, axis, 4, 10, 12, 24, 0.02, 99);
  const fit = fitCylinder(points);
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-3, `axis ${fit.axis}`);
  assert.ok(Math.abs(fit.radius - 4) < 0.05, `radius ${fit.radius}`);
  assert.ok(fit.rms < 0.08, `rms ${fit.rms}`);
});
test("fitCylinder accepts an initial direction and refines it", () => {
  const axis = normalize([1, 1, 1]);
  const points = cylinderPoints([0, 0, 0], axis, 2, 5, 8, 14);
  const hint = normalize([1, 1.3, 0.75]);
  const fit = fitCylinder(points, { direction: hint });
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-6, `axis ${fit.axis}`);
  assert.ok(Math.abs(fit.radius - 2) < 1e-6);
});
test("fitCylinder is deterministic: the same points give the same fit", () => {
  const points = cylinderPoints([1, 2, 3], normalize([0, 1, 2]), 1.75, 4, 7, 11);
  const a = fitCylinder(points);
  const b = fitCylinder(points);
  assert.ok(a && b);
  assert.deepEqual(a, b);
});
test("fitCylinder rejects fewer than 5 points", () => {
  const points = cylinderPoints([0, 0, 0], [0, 0, 1], 1, 1, 2, 2);
  assert.equal(fitCylinder(points), null);
});
test("a coarser sweep with fewer samples still lands on the axis", () => {
  const axis = normalize([2, -1, 3]);
  const points = cylinderPoints([0, 0, 0], axis, 2, 6, 8, 12);
  const fit = fitCylinder(points, { directionSamples: 16 });
  assert.ok(fit);
  assert.ok(Math.abs(Math.abs(dot(fit.axis, axis)) - 1) < 1e-5, `axis ${fit.axis}`);
});
test("distanceToCylinderSurface is signed and ignores the caps", () => {
  const points = cylinderPoints([0, 0, 0], [0, 0, 1], 2, 5, 6, 12);
  const fit = fitCylinder(points, { direction: [0, 0, 1] });
  assert.ok(fit);
  assert.ok(Math.abs(distanceToCylinderSurface(fit, [2, 0, 0])) < 1e-6);
  assert.ok(Math.abs(distanceToCylinderSurface(fit, [1, 0, 0]) + 1) < 1e-6);
  assert.ok(Math.abs(distanceToCylinderSurface(fit, [5, 0, 0]) - 3) < 1e-6);
  assert.ok(Math.abs(distanceToCylinderSurface(fit, [2, 0, 1e3])) < 1e-6);
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiY3lsaW5kZXItZml0LnRlc3QudHMiLCAic2FtcGxpbmcudHMiLCAibGVhc3Qtc3F1YXJlcy50cyIsICJjeWxpbmRlci1maXQudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFRlc3RzIGZvciB0aGUgbGVhc3Qtc3F1YXJlcyBjeWxpbmRlciBmaXQuXG5cbmltcG9ydCB7IHRlc3QgfSBmcm9tICdub2RlOnRlc3QnO1xuaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydC9zdHJpY3QnO1xuXG5pbXBvcnQgeyBmaXRDeWxpbmRlciwgZml0Q3lsaW5kZXJGb3JBeGlzLCBkaXN0YW5jZVRvQ3lsaW5kZXJTdXJmYWNlIH0gZnJvbSAnLi9jeWxpbmRlci1maXQudHMnO1xuaW1wb3J0IHR5cGUgeyBWZWMzIH0gZnJvbSAnLi92ZWMzLnRzJztcblxuZnVuY3Rpb24gbXVsYmVycnkzMihzZWVkOiBudW1iZXIpOiAoKSA9PiBudW1iZXIge1xuICBsZXQgYSA9IHNlZWQgPj4+IDA7XG4gIHJldHVybiAoKSA9PiB7XG4gICAgYSA9IChhICsgMHg2ZDJiNzlmNSkgPj4+IDA7XG4gICAgbGV0IHQgPSBNYXRoLmltdWwoYSBeIChhID4+PiAxNSksIDEgfCBhKTtcbiAgICB0ID0gKHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgNjEgfCB0KSkgXiB0O1xuICAgIHJldHVybiAoKHQgXiAodCA+Pj4gMTQpKSA+Pj4gMCkgLyA0Mjk0OTY3Mjk2O1xuICB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemUodjogVmVjMyk6IFZlYzMge1xuICBjb25zdCBsZW4gPSBNYXRoLmh5cG90KHZbMF0sIHZbMV0sIHZbMl0pO1xuICByZXR1cm4gW3ZbMF0gLyBsZW4sIHZbMV0gLyBsZW4sIHZbMl0gLyBsZW5dO1xufVxuXG5mdW5jdGlvbiBkb3QoYTogVmVjMywgYjogVmVjMyk6IG51bWJlciB7XG4gIHJldHVybiBhWzBdICogYlswXSArIGFbMV0gKiBiWzFdICsgYVsyXSAqIGJbMl07XG59XG5cbi8vIFBvaW50cyBvbiB0aGUgc3VyZmFjZSBvZiBhIGN5bGluZGVyLCB3cmFwcGVkIGFyb3VuZCB0aGUgYXhpcyBhbmQgc3ByZWFkIGFsb25nXG4vLyBpdC4gYGppdHRlcmAgcGVydHVyYnMgdGhlIHJhZGl1cywgaW4gcmFkaXVzIHVuaXRzLlxuZnVuY3Rpb24gY3lsaW5kZXJQb2ludHMoXG4gIGNlbnRlcjogVmVjMyxcbiAgYXhpczogVmVjMyxcbiAgcmFkaXVzOiBudW1iZXIsXG4gIGhhbGZIZWlnaHQ6IG51bWJlcixcbiAgcmluZ3M6IG51bWJlcixcbiAgcGVyUmluZzogbnVtYmVyLFxuICBqaXR0ZXIgPSAwLFxuICBzZWVkID0gMSxcbik6IFZlYzNbXSB7XG4gIGNvbnN0IHcgPSBub3JtYWxpemUoYXhpcyk7XG4gIC8vIEEgYmFzaXMgcGVycGVuZGljdWxhciB0byB0aGUgYXhpcy5cbiAgY29uc3QgaGVscGVyOiBWZWMzID0gTWF0aC5hYnMod1swXSkgPCAwLjkgPyBbMSwgMCwgMF0gOiBbMCwgMSwgMF07XG4gIGNvbnN0IHUgPSBub3JtYWxpemUoW1xuICAgIHdbMV0gKiBoZWxwZXJbMl0gLSB3WzJdICogaGVscGVyWzFdLFxuICAgIHdbMl0gKiBoZWxwZXJbMF0gLSB3WzBdICogaGVscGVyWzJdLFxuICAgIHdbMF0gKiBoZWxwZXJbMV0gLSB3WzFdICogaGVscGVyWzBdLFxuICBdKTtcbiAgY29uc3QgdiA9IG5vcm1hbGl6ZShbXG4gICAgd1sxXSAqIHVbMl0gLSB3WzJdICogdVsxXSxcbiAgICB3WzJdICogdVswXSAtIHdbMF0gKiB1WzJdLFxuICAgIHdbMF0gKiB1WzFdIC0gd1sxXSAqIHVbMF0sXG4gIF0pO1xuICBjb25zdCByYW5kID0gbXVsYmVycnkzMihzZWVkKTtcbiAgY29uc3QgcG9pbnRzOiBWZWMzW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByaW5nczsgaSsrKSB7XG4gICAgY29uc3QgdCA9IHJpbmdzID09PSAxID8gMCA6IC1oYWxmSGVpZ2h0ICsgKDIgKiBoYWxmSGVpZ2h0ICogaSkgLyAocmluZ3MgLSAxKTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IHBlclJpbmc7IGorKykge1xuICAgICAgLy8gT2Zmc2V0IGVhY2ggcmluZyBzbyB0aGUgc2FtcGxlcyBkbyBub3QgbGluZSB1cCBpbnRvIHN0cmFpZ2h0IHNlYW1zLlxuICAgICAgY29uc3QgYW5nbGUgPSAoMiAqIE1hdGguUEkgKiAoaiArIGkgKiAwLjM3KSkgLyBwZXJSaW5nO1xuICAgICAgY29uc3QgciA9IHJhZGl1cyAqICgxICsgKGppdHRlciA9PT0gMCA/IDAgOiAocmFuZCgpIC0gMC41KSAqIDIgKiBqaXR0ZXIpKTtcbiAgICAgIHBvaW50cy5wdXNoKFtcbiAgICAgICAgY2VudGVyWzBdICsgd1swXSAqIHQgKyB1WzBdICogciAqIE1hdGguY29zKGFuZ2xlKSArIHZbMF0gKiByICogTWF0aC5zaW4oYW5nbGUpLFxuICAgICAgICBjZW50ZXJbMV0gKyB3WzFdICogdCArIHVbMV0gKiByICogTWF0aC5jb3MoYW5nbGUpICsgdlsxXSAqIHIgKiBNYXRoLnNpbihhbmdsZSksXG4gICAgICAgIGNlbnRlclsyXSArIHdbMl0gKiB0ICsgdVsyXSAqIHIgKiBNYXRoLmNvcyhhbmdsZSkgKyB2WzJdICogciAqIE1hdGguc2luKGFuZ2xlKSxcbiAgICAgIF0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcG9pbnRzO1xufVxuXG50ZXN0KCdmaXRDeWxpbmRlckZvckF4aXMgaXMgZXhhY3Qgd2hlbiB0aGUgYXhpcyBpcyBhbHJlYWR5IGtub3duJywgKCkgPT4ge1xuICBjb25zdCBjZW50ZXI6IFZlYzMgPSBbMSwgLTIsIDNdO1xuICBjb25zdCBheGlzOiBWZWMzID0gWzAsIDAsIDFdO1xuICBjb25zdCBwb2ludHMgPSBjeWxpbmRlclBvaW50cyhjZW50ZXIsIGF4aXMsIDIsIDUsIDYsIDEyKTtcbiAgY29uc3QgZml0ID0gZml0Q3lsaW5kZXJGb3JBeGlzKHBvaW50cywgYXhpcyk7XG4gIGFzc2VydC5vayhmaXQpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoZml0LnJhZGl1cyAtIDIpIDwgMWUtOSwgYHJhZGl1cyAke2ZpdC5yYWRpdXN9YCk7XG4gIGFzc2VydC5vayhmaXQucm1zIDwgMWUtOSk7XG4gIC8vIFRoZSBjZW50cmUgaXMgdGhlIGF4aXMgcG9pbnQgbmVhcmVzdCB0aGUgY2VudHJvaWQsIHNvIHggYW5kIHkgbXVzdCBtYXRjaCBhbmQgdGhlIGF4aXMgY29vcmRpbmF0ZSBpcyBmcmVlLlxuICBhc3NlcnQub2soTWF0aC5hYnMoZml0LmNlbnRlclswXSAtIDEpIDwgMWUtOSk7XG4gIGFzc2VydC5vayhNYXRoLmFicyhmaXQuY2VudGVyWzFdICsgMikgPCAxZS05KTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGZpdC5oZWlnaHQgLSAxMCkgPCAxZS05KTtcbn0pO1xuXG50ZXN0KCdmaXRDeWxpbmRlckZvckF4aXMgbm9ybWFsaXplcyB0aGUgZ2l2ZW4gZGlyZWN0aW9uJywgKCkgPT4ge1xuICBjb25zdCBwb2ludHMgPSBjeWxpbmRlclBvaW50cyhbMCwgMCwgMF0sIFswLCAwLCAxXSwgMS41LCA0LCA2LCAxMCk7XG4gIGNvbnN0IGZpdCA9IGZpdEN5bGluZGVyRm9yQXhpcyhwb2ludHMsIFswLCAwLCA3XSk7XG4gIGFzc2VydC5vayhmaXQpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoTWF0aC5oeXBvdCguLi5maXQuYXhpcykgLSAxKSA8IDFlLTEyKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGZpdC5yYWRpdXMgLSAxLjUpIDwgMWUtOSk7XG59KTtcblxudGVzdCgnZml0Q3lsaW5kZXJGb3JBeGlzIHJlamVjdHMgdG9vIGZldyBwb2ludHMgYW5kIGEgemVybyBkaXJlY3Rpb24nLCAoKSA9PiB7XG4gIGNvbnN0IHBvaW50cyA9IGN5bGluZGVyUG9pbnRzKFswLCAwLCAwXSwgWzAsIDAsIDFdLCAxLCAxLCA2LCAxMCk7XG4gIGFzc2VydC5lcXVhbChmaXRDeWxpbmRlckZvckF4aXMocG9pbnRzLnNsaWNlKDAsIDQpLCBbMCwgMCwgMV0pLCBudWxsKTtcbiAgYXNzZXJ0LmVxdWFsKGZpdEN5bGluZGVyRm9yQXhpcyhwb2ludHMsIFswLCAwLCAwXSksIG51bGwpO1xufSk7XG5cbnRlc3QoJ2ZpdEN5bGluZGVyRm9yQXhpcyBpcyBkZWdlbmVyYXRlIGZvciBwb2ludHMgT04gdGhlIGF4aXMnLCAoKSA9PiB7XG4gIC8vIEV2ZXJ5IHBvaW50IHByb2plY3RzIHRvIHRoZSBzYW1lIHBsYWNlLCBzbyBubyByYWRpdXMgaXMgZGV0ZXJtaW5lZC5cbiAgY29uc3QgcG9pbnRzOiBWZWMzW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDsgaSsrKSBwb2ludHMucHVzaChbMCwgMCwgaV0pO1xuICBhc3NlcnQuZXF1YWwoZml0Q3lsaW5kZXJGb3JBeGlzKHBvaW50cywgWzAsIDAsIDFdKSwgbnVsbCk7XG59KTtcblxudGVzdCgnYSB3cm9uZyBheGlzIHNjb3JlcyB3b3JzZSB0aGFuIHRoZSB0cnVlIG9uZScsICgpID0+IHtcbiAgY29uc3QgcG9pbnRzID0gY3lsaW5kZXJQb2ludHMoWzAsIDAsIDBdLCBbMCwgMCwgMV0sIDIsIDYsIDgsIDEyKTtcbiAgY29uc3QgZ29vZCA9IGZpdEN5bGluZGVyRm9yQXhpcyhwb2ludHMsIFswLCAwLCAxXSk7XG4gIGNvbnN0IGJhZCA9IGZpdEN5bGluZGVyRm9yQXhpcyhwb2ludHMsIFsxLCAwLCAwXSk7XG4gIGFzc2VydC5vayhnb29kKTtcbiAgYXNzZXJ0Lm9rKGJhZCk7XG4gIGFzc2VydC5vayhnb29kLmVycm9yIDwgYmFkLmVycm9yLCBgJHtnb29kLmVycm9yfSB2cyAke2JhZC5lcnJvcn1gKTtcbn0pO1xuXG50ZXN0KCdmaXRDeWxpbmRlciByZWNvdmVycyBhbiBheGlzLWFsaWduZWQgY3lsaW5kZXIgd2l0aG91dCBhIGhpbnQnLCAoKSA9PiB7XG4gIGNvbnN0IGNlbnRlcjogVmVjMyA9IFstNCwgNywgMC41XTtcbiAgY29uc3QgYXhpczogVmVjMyA9IFswLCAxLCAwXTtcbiAgY29uc3QgcG9pbnRzID0gY3lsaW5kZXJQb2ludHMoY2VudGVyLCBheGlzLCAzLCA4LCA4LCAxNik7XG4gIGNvbnN0IGZpdCA9IGZpdEN5bGluZGVyKHBvaW50cyk7XG4gIGFzc2VydC5vayhmaXQpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoTWF0aC5hYnMoZG90KGZpdC5heGlzLCBheGlzKSkgLSAxKSA8IDFlLTYsIGBheGlzICR7Zml0LmF4aXN9YCk7XG4gIGFzc2VydC5vayhNYXRoLmFicyhmaXQucmFkaXVzIC0gMykgPCAxZS02LCBgcmFkaXVzICR7Zml0LnJhZGl1c31gKTtcbiAgYXNzZXJ0Lm9rKGZpdC5ybXMgPCAxZS02KTtcbiAgLy8gVGhlIGNlbnRyZSBtdXN0IGxpZSBvbiB0aGUgdHJ1ZSBheGlzOiBvbmx5IHRoZSB5IGNvb3JkaW5hdGUgaXMgZnJlZS5cbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGZpdC5jZW50ZXJbMF0gKyA0KSA8IDFlLTYpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoZml0LmNlbnRlclsyXSAtIDAuNSkgPCAxZS02KTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGZpdC5oZWlnaHQgLSAxNikgPCAxZS02KTtcbn0pO1xuXG50ZXN0KCdmaXRDeWxpbmRlciByZWNvdmVycyBhbiBvYmxpcXVlbHktb3JpZW50ZWQgY3lsaW5kZXInLCAoKSA9PiB7XG4gIGNvbnN0IGNlbnRlcjogVmVjMyA9IFsyLCAyLCAtMV07XG4gIGNvbnN0IGF4aXMgPSBub3JtYWxpemUoWzEsIDIsIC0wLjVdKTtcbiAgY29uc3QgcG9pbnRzID0gY3lsaW5kZXJQb2ludHMoY2VudGVyLCBheGlzLCAxLjI1LCA2LCA5LCAxNCk7XG4gIGNvbnN0IGZpdCA9IGZpdEN5bGluZGVyKHBvaW50cyk7XG4gIGFzc2VydC5vayhmaXQpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoTWF0aC5hYnMoZG90KGZpdC5heGlzLCBheGlzKSkgLSAxKSA8IDFlLTYsIGBheGlzICR7Zml0LmF4aXN9YCk7XG4gIGFzc2VydC5vayhNYXRoLmFicyhmaXQucmFkaXVzIC0gMS4yNSkgPCAxZS02LCBgcmFkaXVzICR7Zml0LnJhZGl1c31gKTtcbiAgYXNzZXJ0Lm9rKGZpdC5ybXMgPCAxZS02KTtcbiAgLy8gRGlzdGFuY2UgZnJvbSB0aGUgcmVwb3J0ZWQgY2VudHJlIHRvIHRoZSB0cnVlIGF4aXMgbXVzdCBiZSB6ZXJvLlxuICBjb25zdCBkOiBWZWMzID0gW2ZpdC5jZW50ZXJbMF0gLSBjZW50ZXJbMF0sIGZpdC5jZW50ZXJbMV0gLSBjZW50ZXJbMV0sIGZpdC5jZW50ZXJbMl0gLSBjZW50ZXJbMl1dO1xuICBjb25zdCBhbG9uZyA9IGRvdChkLCBheGlzKTtcbiAgY29uc3QgcGVycCA9IE1hdGguaHlwb3QoZFswXSAtIGFsb25nICogYXhpc1swXSwgZFsxXSAtIGFsb25nICogYXhpc1sxXSwgZFsyXSAtIGFsb25nICogYXhpc1syXSk7XG4gIGFzc2VydC5vayhwZXJwIDwgMWUtNiwgYGNlbnRyZSBvZmYtYXhpcyBieSAke3BlcnB9YCk7XG59KTtcblxudGVzdCgnZml0Q3lsaW5kZXIgZmluZHMgdGhlIGF4aXMgb2YgYSBTSE9SVCB3aWRlIGN5bGluZGVyLCB3aGVyZSB0aGUgY2xvdWQgaXMgZmxhdCcsICgpID0+IHtcbiAgLy8gVGhlIHByaW5jaXBhbCBheGlzIG9mIHRoaXMgY2xvdWQgaXMgUEVSUEVORElDVUxBUiB0byB0aGUgdHJ1ZSBheGlzLlxuICBjb25zdCBheGlzOiBWZWMzID0gWzAsIDAsIDFdO1xuICBjb25zdCBwb2ludHMgPSBjeWxpbmRlclBvaW50cyhbMCwgMCwgMF0sIGF4aXMsIDEwLCAwLjQsIDMsIDQwKTtcbiAgY29uc3QgZml0ID0gZml0Q3lsaW5kZXIocG9pbnRzKTtcbiAgYXNzZXJ0Lm9rKGZpdCk7XG4gIGFzc2VydC5vayhNYXRoLmFicyhNYXRoLmFicyhkb3QoZml0LmF4aXMsIGF4aXMpKSAtIDEpIDwgMWUtNCwgYGF4aXMgJHtmaXQuYXhpc31gKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGZpdC5yYWRpdXMgLSAxMCkgPCAxZS0zLCBgcmFkaXVzICR7Zml0LnJhZGl1c31gKTtcbn0pO1xuXG50ZXN0KCdmaXRDeWxpbmRlciBzdGF5cyBuZWFyIHRoZSBnZW5lcmF0b3IgdW5kZXIgcmFkaWFsIG5vaXNlJywgKCkgPT4ge1xuICBjb25zdCBheGlzID0gbm9ybWFsaXplKFswLjMsIC0xLCAwLjJdKTtcbiAgY29uc3QgY2VudGVyOiBWZWMzID0gWzUsIDUsIDVdO1xuICBjb25zdCBwb2ludHMgPSBjeWxpbmRlclBvaW50cyhjZW50ZXIsIGF4aXMsIDQsIDEwLCAxMiwgMjQsIDAuMDIsIDk5KTtcbiAgY29uc3QgZml0ID0gZml0Q3lsaW5kZXIocG9pbnRzKTtcbiAgYXNzZXJ0Lm9rKGZpdCk7XG4gIGFzc2VydC5vayhNYXRoLmFicyhNYXRoLmFicyhkb3QoZml0LmF4aXMsIGF4aXMpKSAtIDEpIDwgMWUtMywgYGF4aXMgJHtmaXQuYXhpc31gKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGZpdC5yYWRpdXMgLSA0KSA8IDAuMDUsIGByYWRpdXMgJHtmaXQucmFkaXVzfWApO1xuICBhc3NlcnQub2soZml0LnJtcyA8IDAuMDgsIGBybXMgJHtmaXQucm1zfWApO1xufSk7XG5cbnRlc3QoJ2ZpdEN5bGluZGVyIGFjY2VwdHMgYW4gaW5pdGlhbCBkaXJlY3Rpb24gYW5kIHJlZmluZXMgaXQnLCAoKSA9PiB7XG4gIGNvbnN0IGF4aXMgPSBub3JtYWxpemUoWzEsIDEsIDFdKTtcbiAgY29uc3QgcG9pbnRzID0gY3lsaW5kZXJQb2ludHMoWzAsIDAsIDBdLCBheGlzLCAyLCA1LCA4LCAxNCk7XG4gIC8vIEEgaGludCBzZXZlcmFsIGRlZ3JlZXMgb2ZmIHRoZSB0cnV0aCwgd2l0aCB0aGUgZ2xvYmFsIHN3ZWVwIHNraXBwZWQuXG4gIGNvbnN0IGhpbnQgPSBub3JtYWxpemUoWzEsIDEuMywgMC43NV0pO1xuICBjb25zdCBmaXQgPSBmaXRDeWxpbmRlcihwb2ludHMsIHsgZGlyZWN0aW9uOiBoaW50IH0pO1xuICBhc3NlcnQub2soZml0KTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKE1hdGguYWJzKGRvdChmaXQuYXhpcywgYXhpcykpIC0gMSkgPCAxZS02LCBgYXhpcyAke2ZpdC5heGlzfWApO1xuICBhc3NlcnQub2soTWF0aC5hYnMoZml0LnJhZGl1cyAtIDIpIDwgMWUtNik7XG59KTtcblxudGVzdCgnZml0Q3lsaW5kZXIgaXMgZGV0ZXJtaW5pc3RpYzogdGhlIHNhbWUgcG9pbnRzIGdpdmUgdGhlIHNhbWUgZml0JywgKCkgPT4ge1xuICBjb25zdCBwb2ludHMgPSBjeWxpbmRlclBvaW50cyhbMSwgMiwgM10sIG5vcm1hbGl6ZShbMCwgMSwgMl0pLCAxLjc1LCA0LCA3LCAxMSk7XG4gIGNvbnN0IGEgPSBmaXRDeWxpbmRlcihwb2ludHMpO1xuICBjb25zdCBiID0gZml0Q3lsaW5kZXIocG9pbnRzKTtcbiAgYXNzZXJ0Lm9rKGEgJiYgYik7XG4gIGFzc2VydC5kZWVwRXF1YWwoYSwgYik7XG59KTtcblxudGVzdCgnZml0Q3lsaW5kZXIgcmVqZWN0cyBmZXdlciB0aGFuIDUgcG9pbnRzJywgKCkgPT4ge1xuICBjb25zdCBwb2ludHMgPSBjeWxpbmRlclBvaW50cyhbMCwgMCwgMF0sIFswLCAwLCAxXSwgMSwgMSwgMiwgMik7XG4gIGFzc2VydC5lcXVhbChmaXRDeWxpbmRlcihwb2ludHMpLCBudWxsKTtcbn0pO1xuXG50ZXN0KCdhIGNvYXJzZXIgc3dlZXAgd2l0aCBmZXdlciBzYW1wbGVzIHN0aWxsIGxhbmRzIG9uIHRoZSBheGlzJywgKCkgPT4ge1xuICBjb25zdCBheGlzID0gbm9ybWFsaXplKFsyLCAtMSwgM10pO1xuICBjb25zdCBwb2ludHMgPSBjeWxpbmRlclBvaW50cyhbMCwgMCwgMF0sIGF4aXMsIDIsIDYsIDgsIDEyKTtcbiAgY29uc3QgZml0ID0gZml0Q3lsaW5kZXIocG9pbnRzLCB7IGRpcmVjdGlvblNhbXBsZXM6IDE2IH0pO1xuICBhc3NlcnQub2soZml0KTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKE1hdGguYWJzKGRvdChmaXQuYXhpcywgYXhpcykpIC0gMSkgPCAxZS01LCBgYXhpcyAke2ZpdC5heGlzfWApO1xufSk7XG5cbnRlc3QoJ2Rpc3RhbmNlVG9DeWxpbmRlclN1cmZhY2UgaXMgc2lnbmVkIGFuZCBpZ25vcmVzIHRoZSBjYXBzJywgKCkgPT4ge1xuICBjb25zdCBwb2ludHMgPSBjeWxpbmRlclBvaW50cyhbMCwgMCwgMF0sIFswLCAwLCAxXSwgMiwgNSwgNiwgMTIpO1xuICBjb25zdCBmaXQgPSBmaXRDeWxpbmRlcihwb2ludHMsIHsgZGlyZWN0aW9uOiBbMCwgMCwgMV0gfSk7XG4gIGFzc2VydC5vayhmaXQpO1xuICAvLyBPbiB0aGUgc3VyZmFjZSwgaW5zaWRlLCBvdXRzaWRlLlxuICBhc3NlcnQub2soTWF0aC5hYnMoZGlzdGFuY2VUb0N5bGluZGVyU3VyZmFjZShmaXQsIFsyLCAwLCAwXSkpIDwgMWUtNik7XG4gIGFzc2VydC5vayhNYXRoLmFicyhkaXN0YW5jZVRvQ3lsaW5kZXJTdXJmYWNlKGZpdCwgWzEsIDAsIDBdKSArIDEpIDwgMWUtNik7XG4gIGFzc2VydC5vayhNYXRoLmFicyhkaXN0YW5jZVRvQ3lsaW5kZXJTdXJmYWNlKGZpdCwgWzUsIDAsIDBdKSAtIDMpIDwgMWUtNik7XG4gIC8vIEZhciBiZXlvbmQgdGhlIGRhdGEncyBleHRlbnQgYWxvbmcgdGhlIGF4aXMsIHRoZSBkaXN0YW5jZSBpcyB1bmNoYW5nZWQ6IHRoZSBmaXR0ZWQgY3lsaW5kZXIgaXMgaW5maW5pdGUuXG4gIGFzc2VydC5vayhNYXRoLmFicyhkaXN0YW5jZVRvQ3lsaW5kZXJTdXJmYWNlKGZpdCwgWzIsIDAsIDEwMDBdKSkgPCAxZS02KTtcbn0pO1xuIiwgIi8vIExvdy1kaXNjcmVwYW5jeSArIGhlbWlzcGhlcmUgc2FtcGxpbmcuIFB1cmUsIGRldGVybWluaXN0aWMsIG5vIERPTS5cblxuaW1wb3J0IHR5cGUgeyBWZWMzIH0gZnJvbSAnLi92ZWMzLnRzJztcblxuLypgcmFkaWNhbEludmVyc2UyKDApID09PSAwYC4gTWlycm9ycyBgcmFkaWNhbEludmVyc2VgIGluIHByZWZpbHRlci53Z3NsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJhZGljYWxJbnZlcnNlMihpOiBudW1iZXIpOiBudW1iZXIge1xuICBsZXQgYml0cyA9IGkgPj4+IDA7XG4gIGJpdHMgPSAoYml0cyA8PCAxNikgfCAoYml0cyA+Pj4gMTYpO1xuICBiaXRzID0gKChiaXRzICYgMHg1NTU1NTU1NSkgPDwgMSkgfCAoKGJpdHMgJiAweGFhYWFhYWFhKSA+Pj4gMSk7XG4gIGJpdHMgPSAoKGJpdHMgJiAweDMzMzMzMzMzKSA8PCAyKSB8ICgoYml0cyAmIDB4Y2NjY2NjY2MpID4+PiAyKTtcbiAgYml0cyA9ICgoYml0cyAmIDB4MGYwZjBmMGYpIDw8IDQpIHwgKChiaXRzICYgMHhmMGYwZjBmMCkgPj4+IDQpO1xuICBiaXRzID0gKChiaXRzICYgMHgwMGZmMDBmZikgPDwgOCkgfCAoKGJpdHMgJiAweGZmMDBmZjAwKSA+Pj4gOCk7XG4gIHJldHVybiAoYml0cyA+Pj4gMCkgLyA0Mjk0OTY3Mjk2O1xufVxuXG4vKiogVGhlIGktdGggb2YgYG5gIHBvaW50cyBvZiB0aGUgMkQgSGFtbWVyc2xleSBzZXQ6IGBbaSAvIG4sXG4gKiByYWRpY2FsSW52ZXJzZTIoaSldYC4gYGhhbW1lcnNsZXkoLCBuKSA9PT0gWywgXWAuICovXG5leHBvcnQgZnVuY3Rpb24gaGFtbWVyc2xleShpOiBudW1iZXIsIG46IG51bWJlcik6IFtudW1iZXIsIG51bWJlcl0ge1xuICByZXR1cm4gW2kgLyBuLCByYWRpY2FsSW52ZXJzZTIoaSldO1xufVxuXG4vKmB1YCBtYXBzIHRvIGNvcyh0aGV0YSkgKHNvIHRoZSBwb2xlIGlzIGF0IHUgPSAxKSwgYHZgIHRvIHRoZSBhemltdXRoLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVuaWZvcm1IZW1pc3BoZXJlKHU6IG51bWJlciwgdjogbnVtYmVyKTogVmVjMyB7XG4gIGNvbnN0IHogPSB1O1xuICBjb25zdCByID0gTWF0aC5zcXJ0KE1hdGgubWF4KDAsIDEgLSB6ICogeikpO1xuICBjb25zdCBwaGkgPSAyICogTWF0aC5QSSAqIHY7XG4gIHJldHVybiBbciAqIE1hdGguY29zKHBoaSksIHIgKiBNYXRoLnNpbihwaGkpLCB6XTtcbn1cblxuLypgdWAgc2V0cyB0aGUgcmFkaXVzIChyID0gc3FydCh1KSksIGB2YCB0aGUgYXppbXV0aC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3NpbmVIZW1pc3BoZXJlKHU6IG51bWJlciwgdjogbnVtYmVyKTogVmVjMyB7XG4gIGNvbnN0IHIgPSBNYXRoLnNxcnQodSk7XG4gIGNvbnN0IHBoaSA9IDIgKiBNYXRoLlBJICogdjtcbiAgcmV0dXJuIFtyICogTWF0aC5jb3MocGhpKSwgciAqIE1hdGguc2luKHBoaSksIE1hdGguc3FydChNYXRoLm1heCgwLCAxIC0gdSkpXTtcbn1cbiIsICIvLyBMZWFzdC1zcXVhcmVzIGZpdHRpbmcuIFB1cmUsIGRlcGVuZGVuY3ktZnJlZSwgbm8gRE9NL0dQVS5cblxuaW1wb3J0IHR5cGUgeyBWZWMyIH0gZnJvbSAnLi92ZWMyLnRzJztcbmltcG9ydCB0eXBlIHsgVmVjMyB9IGZyb20gJy4vdmVjMy50cyc7XG5cbi8vIFJvdy1tYWpvcjogbWF0cml4W3Jvd11bY29sXS4gRXZlcnkgcm93IG11c3QgaGF2ZSB0aGUgc2FtZSBsZW5ndGguXG5leHBvcnQgdHlwZSBNYXRyaXggPSByZWFkb25seSAocmVhZG9ubHkgbnVtYmVyW10pW107XG5cbmV4cG9ydCB0eXBlIExpbmVGaXQyID0geyBzbG9wZTogbnVtYmVyOyBpbnRlcmNlcHQ6IG51bWJlcjsgcm1zOiBudW1iZXIgfTtcbmV4cG9ydCB0eXBlIE9ydGhvTGluZUZpdDIgPSB7IHBvaW50OiBWZWMyOyBkaXJlY3Rpb246IFZlYzI7IHJtczogbnVtYmVyIH07XG5leHBvcnQgdHlwZSBPcnRob0xpbmVGaXQzID0geyBwb2ludDogVmVjMzsgZGlyZWN0aW9uOiBWZWMzOyBybXM6IG51bWJlciB9O1xuZXhwb3J0IHR5cGUgUGxhbmVGaXQgPSB7IHBvaW50OiBWZWMzOyBub3JtYWw6IFZlYzM7IHJtczogbnVtYmVyIH07XG5leHBvcnQgdHlwZSBDaXJjbGVGaXQyID0geyBjZW50ZXI6IFZlYzI7IHJhZGl1czogbnVtYmVyOyBybXM6IG51bWJlciB9O1xuZXhwb3J0IHR5cGUgRWlnZW4zID0geyB2YWx1ZXM6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXTsgdmVjdG9yczogW1ZlYzMsIFZlYzMsIFZlYzNdIH07XG5leHBvcnQgdHlwZSBDb3ZhcmlhbmNlMyA9IHsgbWVhbjogVmVjMzsgbWF0cml4OiBudW1iZXJbXVtdIH07XG5cbmZ1bmN0aW9uIGRpbXMoYTogTWF0cml4KTogW251bWJlciwgbnVtYmVyXSB7XG4gIGNvbnN0IHJvd3MgPSBhLmxlbmd0aDtcbiAgaWYgKHJvd3MgPT09IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdtYXRyaXggaGFzIG5vIHJvd3MnKTtcbiAgY29uc3QgY29scyA9IGFbMF0ubGVuZ3RoO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBhKSB7XG4gICAgaWYgKHJvdy5sZW5ndGggIT09IGNvbHMpIHRocm93IG5ldyBSYW5nZUVycm9yKCdtYXRyaXggcm93cyBoYXZlIHVuZXF1YWwgbGVuZ3RocycpO1xuICB9XG4gIHJldHVybiBbcm93cywgY29sc107XG59XG5cbi8vIEdhdXNzaWFuIGVsaW1pbmF0aW9uIHdpdGggcGFydGlhbCBwaXZvdGluZyBvbiBhIGNvcHkuIFJldHVybnMgbnVsbCB3aGVuIHRoZVxuLy8gbWF0cml4IGlzIHNpbmd1bGFyIHRvIHdvcmtpbmcgcHJlY2lzaW9uLlxuZXhwb3J0IGZ1bmN0aW9uIHNvbHZlTGluZWFyKGE6IE1hdHJpeCwgYjogcmVhZG9ubHkgbnVtYmVyW10pOiBudW1iZXJbXSB8IG51bGwge1xuICBjb25zdCBbcm93cywgY29sc10gPSBkaW1zKGEpO1xuICBpZiAocm93cyAhPT0gY29scykgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYHNvbHZlTGluZWFyIG5lZWRzIGEgc3F1YXJlIG1hdHJpeCwgZ290ICR7cm93c314JHtjb2xzfWApO1xuICBpZiAoYi5sZW5ndGggIT09IHJvd3MpIHRocm93IG5ldyBSYW5nZUVycm9yKGBzb2x2ZUxpbmVhcjogYiBoYXMgJHtiLmxlbmd0aH0gZW50cmllcywgd2FudCAke3Jvd3N9YCk7XG5cbiAgY29uc3QgbSA9IGEubWFwKChyb3csIGkpID0+IFsuLi5yb3csIGJbaV1dKTtcbiAgZm9yIChsZXQgY29sID0gMDsgY29sIDwgY29sczsgY29sKyspIHtcbiAgICBsZXQgcGl2b3QgPSBjb2w7XG4gICAgZm9yIChsZXQgciA9IGNvbCArIDE7IHIgPCByb3dzOyByKyspIHtcbiAgICAgIGlmIChNYXRoLmFicyhtW3JdW2NvbF0pID4gTWF0aC5hYnMobVtwaXZvdF1bY29sXSkpIHBpdm90ID0gcjtcbiAgICB9XG4gICAgaWYgKE1hdGguYWJzKG1bcGl2b3RdW2NvbF0pIDw9IE51bWJlci5FUFNJTE9OKSByZXR1cm4gbnVsbDtcbiAgICBbbVtjb2xdLCBtW3Bpdm90XV0gPSBbbVtwaXZvdF0sIG1bY29sXV07XG4gICAgY29uc3QgZGlhZyA9IG1bY29sXVtjb2xdO1xuICAgIGZvciAobGV0IHIgPSBjb2wgKyAxOyByIDwgcm93czsgcisrKSB7XG4gICAgICBjb25zdCBmYWN0b3IgPSBtW3JdW2NvbF0gLyBkaWFnO1xuICAgICAgaWYgKGZhY3RvciA9PT0gMCkgY29udGludWU7XG4gICAgICBmb3IgKGxldCBjID0gY29sOyBjIDw9IGNvbHM7IGMrKykgbVtyXVtjXSAtPSBmYWN0b3IgKiBtW2NvbF1bY107XG4gICAgfVxuICB9XG5cbiAgY29uc3QgeCA9IG5ldyBBcnJheTxudW1iZXI+KGNvbHMpLmZpbGwoMCk7XG4gIGZvciAobGV0IHIgPSBjb2xzIC0gMTsgciA+PSAwOyByLS0pIHtcbiAgICBsZXQgYWNjID0gbVtyXVtjb2xzXTtcbiAgICBmb3IgKGxldCBjID0gciArIDE7IGMgPCBjb2xzOyBjKyspIGFjYyAtPSBtW3JdW2NdICogeFtjXTtcbiAgICB4W3JdID0gYWNjIC8gbVtyXVtyXTtcbiAgfVxuICByZXR1cm4geC5ldmVyeSgodikgPT4gTnVtYmVyLmlzRmluaXRlKHYpKSA/IHggOiBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdHJhbnNwb3NlKGE6IE1hdHJpeCk6IG51bWJlcltdW10ge1xuICBjb25zdCBbcm93cywgY29sc10gPSBkaW1zKGEpO1xuICBjb25zdCBvdXQ6IG51bWJlcltdW10gPSBbXTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBjb2xzOyBjKyspIHtcbiAgICBjb25zdCByb3cgPSBuZXcgQXJyYXk8bnVtYmVyPihyb3dzKTtcbiAgICBmb3IgKGxldCByID0gMDsgciA8IHJvd3M7IHIrKykgcm93W3JdID0gYVtyXVtjXTtcbiAgICBvdXQucHVzaChyb3cpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXRWZWMoYTogTWF0cml4LCB4OiByZWFkb25seSBudW1iZXJbXSk6IG51bWJlcltdIHtcbiAgY29uc3QgW3Jvd3MsIGNvbHNdID0gZGltcyhhKTtcbiAgaWYgKHgubGVuZ3RoICE9PSBjb2xzKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcihgbWF0VmVjOiB4IGhhcyAke3gubGVuZ3RofSBlbnRyaWVzLCB3YW50ICR7Y29sc31gKTtcbiAgY29uc3Qgb3V0ID0gbmV3IEFycmF5PG51bWJlcj4ocm93cykuZmlsbCgwKTtcbiAgZm9yIChsZXQgciA9IDA7IHIgPCByb3dzOyByKyspIHtcbiAgICBsZXQgYWNjID0gMDtcbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IGNvbHM7IGMrKykgYWNjICs9IGFbcl1bY10gKiB4W2NdO1xuICAgIG91dFtyXSA9IGFjYztcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vLyBTb2x2ZSB0aGUgbm9ybWFsIGVxdWF0aW9ucyAoQV5UIEEgKyByaWRnZSBJKSB4ID0gQV5UIGIuXG5leHBvcnQgZnVuY3Rpb24gc29sdmVMZWFzdFNxdWFyZXMoYTogTWF0cml4LCBiOiByZWFkb25seSBudW1iZXJbXSwgcmlkZ2UgPSAwKTogbnVtYmVyW10gfCBudWxsIHtcbiAgY29uc3QgW3Jvd3MsIGNvbHNdID0gZGltcyhhKTtcbiAgaWYgKGIubGVuZ3RoICE9PSByb3dzKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcihgc29sdmVMZWFzdFNxdWFyZXM6IGIgaGFzICR7Yi5sZW5ndGh9IGVudHJpZXMsIHdhbnQgJHtyb3dzfWApO1xuXG4gIGNvbnN0IG5vcm1hbDogbnVtYmVyW11bXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbHM7IGkrKykge1xuICAgIGNvbnN0IHJvdyA9IG5ldyBBcnJheTxudW1iZXI+KGNvbHMpLmZpbGwoMCk7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBjb2xzOyBqKyspIHtcbiAgICAgIGxldCBhY2MgPSAwO1xuICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCByb3dzOyByKyspIGFjYyArPSBhW3JdW2ldICogYVtyXVtqXTtcbiAgICAgIHJvd1tqXSA9IGkgPT09IGogPyBhY2MgKyByaWRnZSA6IGFjYztcbiAgICB9XG4gICAgbm9ybWFsLnB1c2gocm93KTtcbiAgfVxuICBjb25zdCByaHMgPSBuZXcgQXJyYXk8bnVtYmVyPihjb2xzKS5maWxsKDApO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbHM7IGkrKykge1xuICAgIGxldCBhY2MgPSAwO1xuICAgIGZvciAobGV0IHIgPSAwOyByIDwgcm93czsgcisrKSBhY2MgKz0gYVtyXVtpXSAqIGJbcl07XG4gICAgcmhzW2ldID0gYWNjO1xuICB9XG4gIHJldHVybiBzb2x2ZUxpbmVhcihub3JtYWwsIHJocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNpZHVhbHMoYTogTWF0cml4LCB4OiByZWFkb25seSBudW1iZXJbXSwgYjogcmVhZG9ubHkgbnVtYmVyW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IHByZWRpY3RlZCA9IG1hdFZlYyhhLCB4KTtcbiAgaWYgKGIubGVuZ3RoICE9PSBwcmVkaWN0ZWQubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYHJlc2lkdWFsczogYiBoYXMgJHtiLmxlbmd0aH0gZW50cmllcywgd2FudCAke3ByZWRpY3RlZC5sZW5ndGh9YCk7XG4gIH1cbiAgcmV0dXJuIHByZWRpY3RlZC5tYXAoKHAsIGkpID0+IGJbaV0gLSBwKTtcbn1cblxuLy8gUm9vdCBtZWFuIHNxdWFyZSBvZiBhIHJlc2lkdWFsIHZlY3Rvci5cbmV4cG9ydCBmdW5jdGlvbiBybXModmFsdWVzOiByZWFkb25seSBudW1iZXJbXSk6IG51bWJlciB7XG4gIGlmICh2YWx1ZXMubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgbGV0IGFjYyA9IDA7XG4gIGZvciAoY29uc3QgdiBvZiB2YWx1ZXMpIGFjYyArPSB2ICogdjtcbiAgcmV0dXJuIE1hdGguc3FydChhY2MgLyB2YWx1ZXMubGVuZ3RoKTtcbn1cblxuLy8gQ29lZmZpY2llbnRzIGluIEFTQ0VORElORyBwb3dlciBvcmRlcjogW2MwLCBjMSwgLi4uXSBtZWFucyBjMCArIGMxIHggKyAuLi5cbmV4cG9ydCBmdW5jdGlvbiBldmFsUG9seW5vbWlhbChjb2VmZnM6IHJlYWRvbmx5IG51bWJlcltdLCB4OiBudW1iZXIpOiBudW1iZXIge1xuICBsZXQgYWNjID0gMDtcbiAgZm9yIChsZXQgaSA9IGNvZWZmcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgYWNjID0gYWNjICogeCArIGNvZWZmc1tpXTtcbiAgcmV0dXJuIGFjYztcbn1cblxuLy8gTGVhc3Qtc3F1YXJlcyBwb2x5bm9taWFsIG9mIHRoZSBnaXZlbiBkZWdyZWUgdGhyb3VnaCAoeHMsIHlzKS4gQ29lZmZpY2llbnRzXG4vLyBjb21lIGJhY2sgaW4gYXNjZW5kaW5nIHBvd2VyIG9yZGVyLiBUaGUgeCB2YWx1ZXMgYXJlIGNlbnRyZWQgYW5kIHNjYWxlZFxuLy8gaW50ZXJuYWxseSwgdGhlbiB0aGUgZml0IGlzIG1hcHBlZCBiYWNrLCBiZWNhdXNlIGEgcmF3IFZhbmRlcm1vbmRlIG1hdHJpeCBvblxuLy8gbGFyZ2UgeCBsb3NlcyB0aGUgaGlnaC1vcmRlciB0ZXJtcyB0byBjb25kaXRpb25pbmcuXG5leHBvcnQgZnVuY3Rpb24gZml0UG9seW5vbWlhbChcbiAgeHM6IHJlYWRvbmx5IG51bWJlcltdLFxuICB5czogcmVhZG9ubHkgbnVtYmVyW10sXG4gIGRlZ3JlZTogbnVtYmVyLFxuKTogbnVtYmVyW10gfCBudWxsIHtcbiAgaWYgKHhzLmxlbmd0aCAhPT0geXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYGZpdFBvbHlub21pYWw6ICR7eHMubGVuZ3RofSB4IHZhbHVlcyBhZ2FpbnN0ICR7eXMubGVuZ3RofSB5IHZhbHVlc2ApO1xuICB9XG4gIGlmICghTnVtYmVyLmlzSW50ZWdlcihkZWdyZWUpIHx8IGRlZ3JlZSA8IDApIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcihgZml0UG9seW5vbWlhbDogZGVncmVlIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlciwgZ290ICR7ZGVncmVlfWApO1xuICB9XG4gIGlmICh4cy5sZW5ndGggPCBkZWdyZWUgKyAxKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYGZpdFBvbHlub21pYWw6IGRlZ3JlZSAke2RlZ3JlZX0gbmVlZHMgJHtkZWdyZWUgKyAxfSBwb2ludHMsIGdvdCAke3hzLmxlbmd0aH1gKTtcbiAgfVxuXG4gIGNvbnN0IGNlbnRlciA9IHhzLnJlZHVjZSgocywgeCkgPT4gcyArIHgsIDApIC8geHMubGVuZ3RoO1xuICBsZXQgc3ByZWFkID0gMDtcbiAgZm9yIChjb25zdCB4IG9mIHhzKSBzcHJlYWQgPSBNYXRoLm1heChzcHJlYWQsIE1hdGguYWJzKHggLSBjZW50ZXIpKTtcbiAgY29uc3Qgc2NhbGVYID0gc3ByZWFkIHx8IDE7XG5cbiAgY29uc3QgdmFuZGVybW9uZGUgPSB4cy5tYXAoKHgpID0+IHtcbiAgICBjb25zdCB0ID0gKHggLSBjZW50ZXIpIC8gc2NhbGVYO1xuICAgIGNvbnN0IHJvdyA9IG5ldyBBcnJheTxudW1iZXI+KGRlZ3JlZSArIDEpO1xuICAgIGxldCBwb3dlciA9IDE7XG4gICAgZm9yIChsZXQgayA9IDA7IGsgPD0gZGVncmVlOyBrKyspIHtcbiAgICAgIHJvd1trXSA9IHBvd2VyO1xuICAgICAgcG93ZXIgKj0gdDtcbiAgICB9XG4gICAgcmV0dXJuIHJvdztcbiAgfSk7XG4gIGNvbnN0IHNoaWZ0ZWQgPSBzb2x2ZUxlYXN0U3F1YXJlcyh2YW5kZXJtb25kZSwgeXMpO1xuICBpZiAoIXNoaWZ0ZWQpIHJldHVybiBudWxsO1xuXG4gIC8vIEV4cGFuZCBzdW1fayBzaGlmdGVkW2tdICogKCh4IC0gY2VudGVyKS9zY2FsZVgpXmsgYmFjayBpbnRvIHBvd2VycyBvZiB4LlxuICBjb25zdCBvdXQgPSBuZXcgQXJyYXk8bnVtYmVyPihkZWdyZWUgKyAxKS5maWxsKDApO1xuICBmb3IgKGxldCBrID0gMDsgayA8PSBkZWdyZWU7IGsrKykge1xuICAgIGlmIChzaGlmdGVkW2tdID09PSAwKSBjb250aW51ZTtcbiAgICAvLyBCaW5vbWlhbCBleHBhbnNpb24gb2YgKHggLSBjZW50ZXIpXmssIGRpdmlkZWQgYnkgc2NhbGVYXmsuXG4gICAgbGV0IGJpbm9tID0gMTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8PSBrOyBqKyspIHtcbiAgICAgIGNvbnN0IHRlcm0gPSBiaW5vbSAqIE1hdGgucG93KC1jZW50ZXIsIGsgLSBqKSAvIE1hdGgucG93KHNjYWxlWCwgayk7XG4gICAgICBvdXRbal0gKz0gc2hpZnRlZFtrXSAqIHRlcm07XG4gICAgICBiaW5vbSA9IChiaW5vbSAqIChrIC0gaikpIC8gKGogKyAxKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLy8gT3JkaW5hcnkgeS1vbi14IGxpbmUgZml0OiBtaW5pbWlzZXMgdGhlIHZlcnRpY2FsIHJlc2lkdWFsLiBWZXJ0aWNhbCBkYXRhIGhhc1xuLy8gbm8gZmluaXRlIHNsb3BlLCBzbyB0aGlzIHJldHVybnMgbnVsbCB0aGVyZSBcdTIwMTQgdXNlIGZpdE9ydGhvTGluZTIgaW5zdGVhZC5cbmV4cG9ydCBmdW5jdGlvbiBmaXRMaW5lKHhzOiByZWFkb25seSBudW1iZXJbXSwgeXM6IHJlYWRvbmx5IG51bWJlcltdKTogTGluZUZpdDIgfCBudWxsIHtcbiAgaWYgKHhzLmxlbmd0aCAhPT0geXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYGZpdExpbmU6ICR7eHMubGVuZ3RofSB4IHZhbHVlcyBhZ2FpbnN0ICR7eXMubGVuZ3RofSB5IHZhbHVlc2ApO1xuICB9XG4gIGNvbnN0IG4gPSB4cy5sZW5ndGg7XG4gIGlmIChuIDwgMikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYGZpdExpbmUgbmVlZHMgYXQgbGVhc3QgMiBwb2ludHMsIGdvdCAke259YCk7XG5cbiAgY29uc3QgbWVhblggPSB4cy5yZWR1Y2UoKHMsIHgpID0+IHMgKyB4LCAwKSAvIG47XG4gIGNvbnN0IG1lYW5ZID0geXMucmVkdWNlKChzLCB5KSA9PiBzICsgeSwgMCkgLyBuO1xuICBsZXQgc3h4ID0gMDtcbiAgbGV0IHN4eSA9IDA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7XG4gICAgY29uc3QgZHggPSB4c1tpXSAtIG1lYW5YO1xuICAgIHN4eCArPSBkeCAqIGR4O1xuICAgIHN4eSArPSBkeCAqICh5c1tpXSAtIG1lYW5ZKTtcbiAgfVxuICBpZiAoc3h4IDw9IE51bWJlci5FUFNJTE9OKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBzbG9wZSA9IHN4eSAvIHN4eDtcbiAgY29uc3QgaW50ZXJjZXB0ID0gbWVhblkgLSBzbG9wZSAqIG1lYW5YO1xuICBjb25zdCBlcnJvcnMgPSB5cy5tYXAoKHksIGkpID0+IHkgLSAoc2xvcGUgKiB4c1tpXSArIGludGVyY2VwdCkpO1xuICByZXR1cm4geyBzbG9wZSwgaW50ZXJjZXB0LCBybXM6IHJtcyhlcnJvcnMpIH07XG59XG5cbi8vIFN5bW1ldHJpYyAyeDIgZWlnZW4gZGVjb21wb3NpdGlvbiwgdXNlZCBieSB0aGUgb3J0aG9nb25hbCAyRCBmaXRzLiBSZXR1cm5zXG4vLyB0aGUgZWlnZW52YWx1ZXMgYXNjZW5kaW5nIHdpdGggdGhlaXIgdW5pdCBlaWdlbnZlY3RvcnMuXG5mdW5jdGlvbiBlaWdlbjIoeHg6IG51bWJlciwgeHk6IG51bWJlciwgeXk6IG51bWJlcik6IHsgdmFsdWVzOiBbbnVtYmVyLCBudW1iZXJdOyB2ZWN0b3JzOiBbVmVjMiwgVmVjMl0gfSB7XG4gIGNvbnN0IGhhbGYgPSAoeHggKyB5eSkgLyAyO1xuICBjb25zdCBkaWZmID0gKHh4IC0geXkpIC8gMjtcbiAgY29uc3Qgcm9vdCA9IE1hdGguaHlwb3QoZGlmZiwgeHkpO1xuICBjb25zdCBsYXJnZSA9IGhhbGYgKyByb290O1xuICBjb25zdCBzbWFsbCA9IGhhbGYgLSByb290O1xuICAvLyAoeHggLSBsYW1iZGEpIHZ4ICsgeHkgdnkgPSAwIGdpdmVzIHRoaXMgZWlnZW52ZWN0b3IgZm9yIHRoZSBMQVJHRSB2YWx1ZS5cbiAgbGV0IG1ham9yOiBWZWMyID0gTWF0aC5hYnMoeHkpID4gTnVtYmVyLkVQU0lMT04gPyBbbGFyZ2UgLSB5eSwgeHldIDogeHggPj0geXkgPyBbMSwgMF0gOiBbMCwgMV07XG4gIGNvbnN0IGxlbiA9IE1hdGguaHlwb3QobWFqb3JbMF0sIG1ham9yWzFdKSB8fCAxO1xuICBtYWpvciA9IFttYWpvclswXSAvIGxlbiwgbWFqb3JbMV0gLyBsZW5dO1xuICBjb25zdCBtaW5vcjogVmVjMiA9IFstbWFqb3JbMV0sIG1ham9yWzBdXTtcbiAgcmV0dXJuIHsgdmFsdWVzOiBbc21hbGwsIGxhcmdlXSwgdmVjdG9yczogW21pbm9yLCBtYWpvcl0gfTtcbn1cblxuLy8gVG90YWwtbGVhc3Qtc3F1YXJlcyBsaW5lIHRocm91Z2ggMkQgcG9pbnRzOiBtaW5pbWlzZXMgdGhlIFBFUlBFTkRJQ1VMQVJcbi8vIGRpc3RhbmNlLCBzbyBpdCBoYW5kbGVzIGEgdmVydGljYWwgbGluZSBhbmQgZG9lcyBub3QgZmF2b3VyIGVpdGhlciBheGlzLiBUaGVcbi8vIGRpcmVjdGlvbiBpcyB0aGUgcHJpbmNpcGFsIGF4aXMgb2YgdGhlIHBvaW50IGNsb3VkLCBhbmQgdGhlIHBvaW50IGlzIGl0c1xuLy8gY2VudHJvaWQuIEEgYm91bmRlZCBudW1iZXIgb2YgcG9pbnRzLCBvciBjb2luY2lkZW50IHBvaW50cywgaXMgbnVsbC5cbmV4cG9ydCBmdW5jdGlvbiBmaXRPcnRob0xpbmUyKHBvaW50czogcmVhZG9ubHkgVmVjMltdKTogT3J0aG9MaW5lRml0MiB8IG51bGwge1xuICBpZiAocG9pbnRzLmxlbmd0aCA8IDIpIHJldHVybiBudWxsO1xuICBjb25zdCBuID0gcG9pbnRzLmxlbmd0aDtcbiAgbGV0IG14ID0gMDtcbiAgbGV0IG15ID0gMDtcbiAgZm9yIChjb25zdCBwIG9mIHBvaW50cykge1xuICAgIG14ICs9IHBbMF07XG4gICAgbXkgKz0gcFsxXTtcbiAgfVxuICBteCAvPSBuO1xuICBteSAvPSBuO1xuXG4gIGxldCB4eCA9IDA7XG4gIGxldCB4eSA9IDA7XG4gIGxldCB5eSA9IDA7XG4gIGZvciAoY29uc3QgcCBvZiBwb2ludHMpIHtcbiAgICBjb25zdCBkeCA9IHBbMF0gLSBteDtcbiAgICBjb25zdCBkeSA9IHBbMV0gLSBteTtcbiAgICB4eCArPSBkeCAqIGR4O1xuICAgIHh5ICs9IGR4ICogZHk7XG4gICAgeXkgKz0gZHkgKiBkeTtcbiAgfVxuICBpZiAoeHggKyB5eSA8PSBOdW1iZXIuRVBTSUxPTikgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgeyB2ZWN0b3JzIH0gPSBlaWdlbjIoeHggLyBuLCB4eSAvIG4sIHl5IC8gbik7XG4gIGNvbnN0IG5vcm1hbCA9IHZlY3RvcnNbMF07XG4gIGNvbnN0IGRpcmVjdGlvbiA9IHZlY3RvcnNbMV07XG4gIGNvbnN0IGVycm9ycyA9IHBvaW50cy5tYXAoKHApID0+IG5vcm1hbFswXSAqIChwWzBdIC0gbXgpICsgbm9ybWFsWzFdICogKHBbMV0gLSBteSkpO1xuICByZXR1cm4geyBwb2ludDogW214LCBteV0sIGRpcmVjdGlvbiwgcm1zOiBybXMoZXJyb3JzKSB9O1xufVxuXG4vLyBUaGUgcmVwb3J0ZWQgcm1zIGlzIHRoZSB0cnVlIGdlb21ldHJpYyByZXNpZHVhbCwgfHAgLSBjZW50cmV8IC0gcmFkaXVzLCBub3Rcbi8vIHRoZSBhbGdlYnJhaWMgb25lIHRoZSBzb2x2ZSBtaW5pbWlzZXMuIENvbGxpbmVhciBwb2ludHMgaGF2ZSBubyBjaXJjbGU6XG4vLyBudWxsLlxuZXhwb3J0IGZ1bmN0aW9uIGZpdENpcmNsZTIocG9pbnRzOiByZWFkb25seSBWZWMyW10pOiBDaXJjbGVGaXQyIHwgbnVsbCB7XG4gIGlmIChwb2ludHMubGVuZ3RoIDwgMykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHJvd3MgPSBwb2ludHMubWFwKChwKSA9PiBbMiAqIHBbMF0sIDIgKiBwWzFdLCAxXSk7XG4gIGNvbnN0IHJocyA9IHBvaW50cy5tYXAoKHApID0+IHBbMF0gKiBwWzBdICsgcFsxXSAqIHBbMV0pO1xuICBjb25zdCBzb2x1dGlvbiA9IHNvbHZlTGVhc3RTcXVhcmVzKHJvd3MsIHJocyk7XG4gIGlmICghc29sdXRpb24pIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IFtjeCwgY3ksIGNdID0gc29sdXRpb247XG4gIGNvbnN0IHJzcXIgPSBjICsgY3ggKiBjeCArIGN5ICogY3k7XG4gIGlmICghKHJzcXIgPiAwKSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHJhZGl1cyA9IE1hdGguc3FydChyc3FyKTtcbiAgY29uc3QgZXJyb3JzID0gcG9pbnRzLm1hcCgocCkgPT4gTWF0aC5oeXBvdChwWzBdIC0gY3gsIHBbMV0gLSBjeSkgLSByYWRpdXMpO1xuICByZXR1cm4geyBjZW50ZXI6IFtjeCwgY3ldLCByYWRpdXMsIHJtczogcm1zKGVycm9ycykgfTtcbn1cblxuLy8gTWVhbiBhbmQgdGhlIDN4MyBjb3ZhcmlhbmNlIG1hdHJpeCAoZGl2aWRlZCBieSB0aGUgcG9pbnQgY291bnQpIG9mIGEgM0QgcG9pbnRcbi8vIGNsb3VkLiBUaGlzIGlzIHRoZSBpbnB1dCB0byBldmVyeSBvcnRob2dvbmFsIDNEIGZpdCBiZWxvdy5cbmV4cG9ydCBmdW5jdGlvbiBjb3ZhcmlhbmNlMyhwb2ludHM6IHJlYWRvbmx5IFZlYzNbXSk6IENvdmFyaWFuY2UzIHtcbiAgY29uc3QgbiA9IHBvaW50cy5sZW5ndGg7XG4gIGlmIChuID09PSAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignY292YXJpYW5jZTM6IGVtcHR5IHBvaW50IGxpc3QnKTtcbiAgbGV0IG14ID0gMDtcbiAgbGV0IG15ID0gMDtcbiAgbGV0IG16ID0gMDtcbiAgZm9yIChjb25zdCBwIG9mIHBvaW50cykge1xuICAgIG14ICs9IHBbMF07XG4gICAgbXkgKz0gcFsxXTtcbiAgICBteiArPSBwWzJdO1xuICB9XG4gIG14IC89IG47XG4gIG15IC89IG47XG4gIG16IC89IG47XG5cbiAgbGV0IHh4ID0gMDtcbiAgbGV0IHh5ID0gMDtcbiAgbGV0IHh6ID0gMDtcbiAgbGV0IHl5ID0gMDtcbiAgbGV0IHl6ID0gMDtcbiAgbGV0IHp6ID0gMDtcbiAgZm9yIChjb25zdCBwIG9mIHBvaW50cykge1xuICAgIGNvbnN0IGR4ID0gcFswXSAtIG14O1xuICAgIGNvbnN0IGR5ID0gcFsxXSAtIG15O1xuICAgIGNvbnN0IGR6ID0gcFsyXSAtIG16O1xuICAgIHh4ICs9IGR4ICogZHg7XG4gICAgeHkgKz0gZHggKiBkeTtcbiAgICB4eiArPSBkeCAqIGR6O1xuICAgIHl5ICs9IGR5ICogZHk7XG4gICAgeXogKz0gZHkgKiBkejtcbiAgICB6eiArPSBkeiAqIGR6O1xuICB9XG4gIGNvbnN0IG1hdHJpeCA9IFtcbiAgICBbeHggLyBuLCB4eSAvIG4sIHh6IC8gbl0sXG4gICAgW3h5IC8gbiwgeXkgLyBuLCB5eiAvIG5dLFxuICAgIFt4eiAvIG4sIHl6IC8gbiwgenogLyBuXSxcbiAgXTtcbiAgcmV0dXJuIHsgbWVhbjogW214LCBteSwgbXpdLCBtYXRyaXggfTtcbn1cblxuLy8gU2lnbiBjb252ZW50aW9uOiB0aGUgY29tcG9uZW50IG9mIGxhcmdlc3QgbWFnbml0dWRlIGlzIG1hZGUgcG9zaXRpdmUsIHNvIHRoZVxuLy8gc2FtZSBjbG91ZCBhbHdheXMgeWllbGRzIHRoZSBzYW1lIGVpZ2VudmVjdG9ycyBpbnN0ZWFkIG9mIGFuIGFyYml0cmFyeSBmbGlwLlxuZnVuY3Rpb24gY2Fub25pY2FsU2lnbih2OiBWZWMzKTogVmVjMyB7XG4gIGxldCBpbmRleCA9IDA7XG4gIGZvciAobGV0IGkgPSAxOyBpIDwgMzsgaSsrKSB7XG4gICAgaWYgKE1hdGguYWJzKHZbaV0pID4gTWF0aC5hYnModltpbmRleF0pKSBpbmRleCA9IGk7XG4gIH1cbiAgcmV0dXJuIHZbaW5kZXhdIDwgMCA/IFstdlswXSwgLXZbMV0sIC12WzJdXSA6IHY7XG59XG5cbi8vIEN5Y2xpYyBKYWNvYmkgcm90YXRpb25zIG9uIGEgc3ltbWV0cmljIDN4My4gRWlnZW52YWx1ZXMgY29tZSBiYWNrIGFzY2VuZGluZyxcbi8vIHdpdGggdGhlIG1hdGNoaW5nIG9ydGhvbm9ybWFsIGVpZ2VudmVjdG9ycy4gSmFjb2JpIGlzIHVzZWQgcmF0aGVyIHRoYW4gdGhlXG4vLyBjbG9zZWQtZm9ybSBjdWJpYyBiZWNhdXNlIGl0IHN0YXlzIGFjY3VyYXRlIG9uIGEgbmVhci1kZWdlbmVyYXRlIG1hdHJpeCxcbi8vIHdoaWNoIGlzIGV4YWN0bHkgdGhlIGNhc2UgYSBmbGF0IG9yIHJvZC1zaGFwZWQgcG9pbnQgY2xvdWQgcHJvZHVjZXMuXG5leHBvcnQgZnVuY3Rpb24gc3ltbWV0cmljRWlnZW4zKG1hdHJpeDogTWF0cml4KTogRWlnZW4zIHtcbiAgY29uc3QgW3Jvd3MsIGNvbHNdID0gZGltcyhtYXRyaXgpO1xuICBpZiAocm93cyAhPT0gMyB8fCBjb2xzICE9PSAzKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcihgc3ltbWV0cmljRWlnZW4zIG5lZWRzIGEgM3gzIG1hdHJpeCwgZ290ICR7cm93c314JHtjb2xzfWApO1xuXG4gIGNvbnN0IGEgPSBtYXRyaXgubWFwKChyb3cpID0+IFsuLi5yb3ddKTtcbiAgY29uc3QgdiA9IFtcbiAgICBbMSwgMCwgMF0sXG4gICAgWzAsIDEsIDBdLFxuICAgIFswLCAwLCAxXSxcbiAgXTtcbiAgY29uc3QgcGFpcnM6IFtudW1iZXIsIG51bWJlcl1bXSA9IFtcbiAgICBbMCwgMV0sXG4gICAgWzAsIDJdLFxuICAgIFsxLCAyXSxcbiAgXTtcbiAgZm9yIChsZXQgc3dlZXAgPSAwOyBzd2VlcCA8IDMyOyBzd2VlcCsrKSB7XG4gICAgbGV0IG9mZiA9IDA7XG4gICAgZm9yIChjb25zdCBbcCwgcV0gb2YgcGFpcnMpIG9mZiArPSBNYXRoLmFicyhhW3BdW3FdKTtcbiAgICBpZiAob2ZmIDw9IDFlLTE4KSBicmVhaztcbiAgICBmb3IgKGNvbnN0IFtwLCBxXSBvZiBwYWlycykge1xuICAgICAgY29uc3QgYXBxID0gYVtwXVtxXTtcbiAgICAgIGlmIChNYXRoLmFicyhhcHEpIDw9IDFlLTMwMCkgY29udGludWU7XG4gICAgICBjb25zdCB0aGV0YSA9IChhW3FdW3FdIC0gYVtwXVtwXSkgLyAoMiAqIGFwcSk7XG4gICAgICBjb25zdCB0ID0gKHRoZXRhID49IDAgPyAxIDogLTEpIC8gKE1hdGguYWJzKHRoZXRhKSArIE1hdGguc3FydCh0aGV0YSAqIHRoZXRhICsgMSkpO1xuICAgICAgY29uc3QgYyA9IDEgLyBNYXRoLnNxcnQodCAqIHQgKyAxKTtcbiAgICAgIGNvbnN0IHMgPSB0ICogYztcbiAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgMzsgaysrKSB7XG4gICAgICAgIGNvbnN0IGFrcCA9IGFba11bcF07XG4gICAgICAgIGNvbnN0IGFrcSA9IGFba11bcV07XG4gICAgICAgIGFba11bcF0gPSBjICogYWtwIC0gcyAqIGFrcTtcbiAgICAgICAgYVtrXVtxXSA9IHMgKiBha3AgKyBjICogYWtxO1xuICAgICAgfVxuICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCAzOyBrKyspIHtcbiAgICAgICAgY29uc3QgYXBrID0gYVtwXVtrXTtcbiAgICAgICAgY29uc3QgYXFrID0gYVtxXVtrXTtcbiAgICAgICAgYVtwXVtrXSA9IGMgKiBhcGsgLSBzICogYXFrO1xuICAgICAgICBhW3FdW2tdID0gcyAqIGFwayArIGMgKiBhcWs7XG4gICAgICB9XG4gICAgICBmb3IgKGxldCBrID0gMDsgayA8IDM7IGsrKykge1xuICAgICAgICBjb25zdCB2a3AgPSB2W2tdW3BdO1xuICAgICAgICBjb25zdCB2a3EgPSB2W2tdW3FdO1xuICAgICAgICB2W2tdW3BdID0gYyAqIHZrcCAtIHMgKiB2a3E7XG4gICAgICAgIHZba11bcV0gPSBzICogdmtwICsgYyAqIHZrcTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBvcmRlciA9IFswLCAxLCAyXS5zb3J0KChpLCBqKSA9PiBhW2ldW2ldIC0gYVtqXVtqXSk7XG4gIGNvbnN0IHZhbHVlcyA9IG9yZGVyLm1hcCgoaSkgPT4gYVtpXVtpXSkgYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXJdO1xuICBjb25zdCB2ZWN0b3JzID0gb3JkZXIubWFwKChpKSA9PiBjYW5vbmljYWxTaWduKFt2WzBdW2ldLCB2WzFdW2ldLCB2WzJdW2ldXSkpIGFzIFtWZWMzLCBWZWMzLCBWZWMzXTtcbiAgcmV0dXJuIHsgdmFsdWVzLCB2ZWN0b3JzIH07XG59XG5cbi8vIEJlc3QtZml0IHBsYW5lIHRocm91Z2ggM0QgcG9pbnRzOiB0aGUgbm9ybWFsIGlzIHRoZSBlaWdlbnZlY3RvciBvZiB0aGVcbi8vIHNtYWxsZXN0IGNvdmFyaWFuY2UgZWlnZW52YWx1ZSwgYW5kIHRoZSBwbGFuZSBwYXNzZXMgdGhyb3VnaCB0aGUgY2VudHJvaWQuXG4vLyBUaGUgcm1zIGlzIHRoZSBvcnRob2dvbmFsIHBvaW50LXRvLXBsYW5lIGRpc3RhbmNlLlxuZXhwb3J0IGZ1bmN0aW9uIGZpdFBsYW5lKHBvaW50czogcmVhZG9ubHkgVmVjM1tdKTogUGxhbmVGaXQgfCBudWxsIHtcbiAgaWYgKHBvaW50cy5sZW5ndGggPCAzKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgeyBtZWFuLCBtYXRyaXggfSA9IGNvdmFyaWFuY2UzKHBvaW50cyk7XG4gIGNvbnN0IHsgdmFsdWVzLCB2ZWN0b3JzIH0gPSBzeW1tZXRyaWNFaWdlbjMobWF0cml4KTtcbiAgLy8gRGlzdGluY3QgZGlyZWN0aW9ucyBtdXN0IGNhcnJ5IHZhcmlhbmNlLCBvciB0aGUgY2xvdWQgaXMgYSBsaW5lL3BvaW50IGFuZCBpdHMgbm9ybWFsIGlzIGFyYml0cmFyeS5cbiAgaWYgKHZhbHVlc1sxXSA8PSBOdW1iZXIuRVBTSUxPTiAqICh2YWx1ZXNbMl0gfHwgMSkpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IG5vcm1hbCA9IHZlY3RvcnNbMF07XG4gIGNvbnN0IGVycm9ycyA9IHBvaW50cy5tYXAoXG4gICAgKHApID0+IG5vcm1hbFswXSAqIChwWzBdIC0gbWVhblswXSkgKyBub3JtYWxbMV0gKiAocFsxXSAtIG1lYW5bMV0pICsgbm9ybWFsWzJdICogKHBbMl0gLSBtZWFuWzJdKSxcbiAgKTtcbiAgcmV0dXJuIHsgcG9pbnQ6IG1lYW4sIG5vcm1hbCwgcm1zOiBybXMoZXJyb3JzKSB9O1xufVxuXG4vLyBCZXN0LWZpdCBsaW5lIHRocm91Z2ggM0QgcG9pbnRzOiB0aGUgZGlyZWN0aW9uIGlzIHRoZSBlaWdlbnZlY3RvciBvZiB0aGVcbi8vIExBUkdFU1QgY292YXJpYW5jZSBlaWdlbnZhbHVlLiBUaGUgcm1zIGlzIHRoZSBvcnRob2dvbmFsIHBvaW50LXRvLWxpbmVcbi8vIGRpc3RhbmNlLlxuZXhwb3J0IGZ1bmN0aW9uIGZpdE9ydGhvTGluZTMocG9pbnRzOiByZWFkb25seSBWZWMzW10pOiBPcnRob0xpbmVGaXQzIHwgbnVsbCB7XG4gIGlmIChwb2ludHMubGVuZ3RoIDwgMikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHsgbWVhbiwgbWF0cml4IH0gPSBjb3ZhcmlhbmNlMyhwb2ludHMpO1xuICBjb25zdCB7IHZhbHVlcywgdmVjdG9ycyB9ID0gc3ltbWV0cmljRWlnZW4zKG1hdHJpeCk7XG4gIGlmICh2YWx1ZXNbMl0gPD0gTnVtYmVyLkVQU0lMT04pIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGRpcmVjdGlvbiA9IHZlY3RvcnNbMl07XG4gIGNvbnN0IGVycm9ycyA9IHBvaW50cy5tYXAoKHApID0+IHtcbiAgICBjb25zdCBkeCA9IHBbMF0gLSBtZWFuWzBdO1xuICAgIGNvbnN0IGR5ID0gcFsxXSAtIG1lYW5bMV07XG4gICAgY29uc3QgZHogPSBwWzJdIC0gbWVhblsyXTtcbiAgICBjb25zdCBhbG9uZyA9IGR4ICogZGlyZWN0aW9uWzBdICsgZHkgKiBkaXJlY3Rpb25bMV0gKyBkeiAqIGRpcmVjdGlvblsyXTtcbiAgICByZXR1cm4gTWF0aC5oeXBvdChkeCAtIGFsb25nICogZGlyZWN0aW9uWzBdLCBkeSAtIGFsb25nICogZGlyZWN0aW9uWzFdLCBkeiAtIGFsb25nICogZGlyZWN0aW9uWzJdKTtcbiAgfSk7XG4gIHJldHVybiB7IHBvaW50OiBtZWFuLCBkaXJlY3Rpb24sIHJtczogcm1zKGVycm9ycykgfTtcbn1cbiIsICIvLyBMZWFzdC1zcXVhcmVzIGluZmluaXRlLWN5bGluZGVyIGZpdCB0byBhIDNEIHBvaW50IGNsb3VkIChFYmVybHkncyBmb3JtdWxhdGlvbikuIFB1cmUgbWF0aCwgbm8gRE9NL0dQVS5cblxuaW1wb3J0IHsgaGFtbWVyc2xleSwgdW5pZm9ybUhlbWlzcGhlcmUgfSBmcm9tICcuL3NhbXBsaW5nLnRzJztcbmltcG9ydCB7IGZpdE9ydGhvTGluZTMgfSBmcm9tICcuL2xlYXN0LXNxdWFyZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBWZWMzIH0gZnJvbSAnLi92ZWMzLnRzJztcblxuZXhwb3J0IHR5cGUgQ3lsaW5kZXJGaXQgPSB7XG4gIC8vIFRoZSBheGlzIHBvaW50IGNsb3Nlc3QgdG8gdGhlIGNsb3VkIGNlbnRyb2lkLlxuICBjZW50ZXI6IFZlYzM7XG4gIC8vIFVuaXQgYXhpcyBkaXJlY3Rpb24uXG4gIGF4aXM6IFZlYzM7XG4gIHJhZGl1czogbnVtYmVyO1xuICAvLyBDb21wYXJlIGZpdHMgd2l0aCBpdC5cbiAgZXJyb3I6IG51bWJlcjtcbiAgLy8gUm9vdCBtZWFuIHNxdWFyZSBvZiB0aGUgUkFESUFMIHJlc2lkdWFsIHxQKFgtQyl8IC0gciwgaW4gcG9pbnQgdW5pdHMuXG4gIHJtczogbnVtYmVyO1xuICAvLyBFeHRlbnQgYWxvbmcgdGhlIGF4aXMsIGFuZCB0aGUgYXhpcyBpbnRlcnZhbCBpdCBzcGFucyByZWxhdGl2ZSB0byBjZW50ZXIuXG4gIGhlaWdodDogbnVtYmVyO1xuICBleHRlbnQ6IFtudW1iZXIsIG51bWJlcl07XG59O1xuXG5leHBvcnQgdHlwZSBDeWxpbmRlckZpdE9wdGlvbnMgPSB7XG4gIC8vIEluaXRpYWwgYXhpcyBndWVzcy5cbiAgZGlyZWN0aW9uPzogVmVjMztcbiAgLy8gSGVtaXNwaGVyZSBkaXJlY3Rpb25zIHRyaWVkIGluIHRoZSBnbG9iYWwgc3dlZXAuXG4gIGRpcmVjdGlvblNhbXBsZXM/OiBudW1iZXI7XG4gIC8vIExvY2FsIHBhdHRlcm4tc2VhcmNoIGl0ZXJhdGlvbnMgYWZ0ZXIgdGhlIHN3ZWVwLlxuICByZWZpbmVTdGVwcz86IG51bWJlcjtcbiAgLy8gVGhlIGxvY2FsIHNlYXJjaCBzdG9wcyBvbmNlIGl0cyBhbmd1bGFyIHN0ZXAgZmFsbHMgYmVsb3cgdGhpcy4gRGVmYXVsdCAxZS05LlxuICB0b2xlcmFuY2U/OiBudW1iZXI7XG59O1xuXG5mdW5jdGlvbiBwcm9qZWN0KHc6IFZlYzMsIHY6IFZlYzMpOiBWZWMzIHtcbiAgY29uc3QgYWxvbmcgPSB2WzBdICogd1swXSArIHZbMV0gKiB3WzFdICsgdlsyXSAqIHdbMl07XG4gIHJldHVybiBbdlswXSAtIGFsb25nICogd1swXSwgdlsxXSAtIGFsb25nICogd1sxXSwgdlsyXSAtIGFsb25nICogd1syXV07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZU9yTnVsbCh2OiBWZWMzKTogVmVjMyB8IG51bGwge1xuICBjb25zdCBsZW4gPSBNYXRoLmh5cG90KHZbMF0sIHZbMV0sIHZbMl0pO1xuICBpZiAoIShsZW4gPiAwKSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBbdlswXSAvIGxlbiwgdlsxXSAvIGxlbiwgdlsyXSAvIGxlbl07XG59XG5cbi8vIEFueSB1bml0IHZlY3RvciBvcnRob2dvbmFsIHRvIHcuIFBpY2tpbmcgdGhlIHNtYWxsZXN0IGNvbXBvbmVudCBvZiB3IHRvIGNyb3NzXG4vLyBhZ2FpbnN0IGtlZXBzIHRoZSByZXN1bHQgd2VsbC1jb25kaXRpb25lZCBmb3IgZXZlcnkgaW5wdXQgZGlyZWN0aW9uLlxuZnVuY3Rpb24gYW55T3J0aG9nb25hbCh3OiBWZWMzKTogVmVjMyB7XG4gIGNvbnN0IGF4ID0gTWF0aC5hYnMod1swXSk7XG4gIGNvbnN0IGF5ID0gTWF0aC5hYnMod1sxXSk7XG4gIGNvbnN0IGF6ID0gTWF0aC5hYnMod1syXSk7XG4gIGNvbnN0IGF4aXM6IFZlYzMgPSBheCA8PSBheSAmJiBheCA8PSBheiA/IFsxLCAwLCAwXSA6IGF5IDw9IGF6ID8gWzAsIDEsIDBdIDogWzAsIDAsIDFdO1xuICBjb25zdCBjcm9zczogVmVjMyA9IFtcbiAgICB3WzFdICogYXhpc1syXSAtIHdbMl0gKiBheGlzWzFdLFxuICAgIHdbMl0gKiBheGlzWzBdIC0gd1swXSAqIGF4aXNbMl0sXG4gICAgd1swXSAqIGF4aXNbMV0gLSB3WzFdICogYXhpc1swXSxcbiAgXTtcbiAgcmV0dXJuIG5vcm1hbGl6ZU9yTnVsbChjcm9zcykgPz8gWzEsIDAsIDBdO1xufVxuXG5mdW5jdGlvbiBjZW50cm9pZChwb2ludHM6IHJlYWRvbmx5IFZlYzNbXSk6IFZlYzMge1xuICBsZXQgbXggPSAwO1xuICBsZXQgbXkgPSAwO1xuICBsZXQgbXogPSAwO1xuICBmb3IgKGNvbnN0IHAgb2YgcG9pbnRzKSB7XG4gICAgbXggKz0gcFswXTtcbiAgICBteSArPSBwWzFdO1xuICAgIG16ICs9IHBbMl07XG4gIH1cbiAgY29uc3QgbiA9IHBvaW50cy5sZW5ndGg7XG4gIHJldHVybiBbbXggLyBuLCBteSAvIG4sIG16IC8gbl07XG59XG5cbmZ1bmN0aW9uIGF4aXNFeHRlbnQocG9pbnRzOiByZWFkb25seSBWZWMzW10sIGNlbnRlcjogVmVjMywgYXhpczogVmVjMyk6IFtudW1iZXIsIG51bWJlcl0ge1xuICBsZXQgbG8gPSBJbmZpbml0eTtcbiAgbGV0IGhpID0gLUluZmluaXR5O1xuICBmb3IgKGNvbnN0IHAgb2YgcG9pbnRzKSB7XG4gICAgY29uc3QgdCA9XG4gICAgICAocFswXSAtIGNlbnRlclswXSkgKiBheGlzWzBdICsgKHBbMV0gLSBjZW50ZXJbMV0pICogYXhpc1sxXSArIChwWzJdIC0gY2VudGVyWzJdKSAqIGF4aXNbMl07XG4gICAgaWYgKHQgPCBsbykgbG8gPSB0O1xuICAgIGlmICh0ID4gaGkpIGhpID0gdDtcbiAgfVxuICByZXR1cm4gW2xvLCBoaV07XG59XG5cbi8vIFRoZSBjbG9zZWQtZm9ybSBjZW50cmUgYW5kIHJhZGl1cyBmb3IgYSBHSVZFTiBheGlzIGRpcmVjdGlvbiwgcGx1cyB0aGUgZW5lcmd5XG4vLyB0aGF0IGRpcmVjdGlvbiBhY2hpZXZlcy4gTnVsbCB3aGVuIHRoZSBwcm9qZWN0ZWQgY2xvdWQgaXMgZGVnZW5lcmF0ZSAoZXZlcnlcbi8vIHBvaW50IG9uIHRoZSBheGlzLCBvciB0aGUgZGlyZWN0aW9uIGlzIG5vdCBhIGRpcmVjdGlvbiksIGJlY2F1c2Ugbm8gcmFkaXVzIGlzXG4vLyBkZXRlcm1pbmVkIHRoZXJlLlxuZXhwb3J0IGZ1bmN0aW9uIGZpdEN5bGluZGVyRm9yQXhpcyhwb2ludHM6IHJlYWRvbmx5IFZlYzNbXSwgZGlyZWN0aW9uOiBWZWMzKTogQ3lsaW5kZXJGaXQgfCBudWxsIHtcbiAgaWYgKHBvaW50cy5sZW5ndGggPCA1KSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdyA9IG5vcm1hbGl6ZU9yTnVsbChkaXJlY3Rpb24pO1xuICBpZiAoIXcpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IG1lYW4gPSBjZW50cm9pZChwb2ludHMpO1xuICBjb25zdCBuID0gcG9pbnRzLmxlbmd0aDtcbiAgY29uc3QgcHJvamVjdGVkOiBWZWMzW10gPSBbXTtcbiAgY29uc3Qgc3FyTGVuZ3RoczogbnVtYmVyW10gPSBbXTtcblxuICBjb25zdCBhID0gW1xuICAgIFswLCAwLCAwXSxcbiAgICBbMCwgMCwgMF0sXG4gICAgWzAsIDAsIDBdLFxuICBdO1xuICBjb25zdCBiOiBWZWMzID0gWzAsIDAsIDBdO1xuICBsZXQgYXZlcmFnZVNxckxlbmd0aCA9IDA7XG5cbiAgZm9yIChjb25zdCBwIG9mIHBvaW50cykge1xuICAgIGNvbnN0IHkgPSBwcm9qZWN0KHcsIFtwWzBdIC0gbWVhblswXSwgcFsxXSAtIG1lYW5bMV0sIHBbMl0gLSBtZWFuWzJdXSk7XG4gICAgY29uc3Qgc3FyTGVuID0geVswXSAqIHlbMF0gKyB5WzFdICogeVsxXSArIHlbMl0gKiB5WzJdO1xuICAgIHByb2plY3RlZC5wdXNoKHkpO1xuICAgIHNxckxlbmd0aHMucHVzaChzcXJMZW4pO1xuICAgIGF2ZXJhZ2VTcXJMZW5ndGggKz0gc3FyTGVuO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMzsgaSsrKSB7XG4gICAgICBmb3IgKGxldCBqID0gMDsgaiA8IDM7IGorKykgYVtpXVtqXSArPSB5W2ldICogeVtqXTtcbiAgICAgIGJbaV0gKz0gc3FyTGVuICogeVtpXTtcbiAgICB9XG4gIH1cbiAgYXZlcmFnZVNxckxlbmd0aCAvPSBuO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDM7IGkrKykge1xuICAgIGZvciAobGV0IGogPSAwOyBqIDwgMzsgaisrKSBhW2ldW2pdIC89IG47XG4gICAgYltpXSAvPSBuO1xuICB9XG5cbiAgLy8gQWhhdCA9IC1TIEEgUywgd2l0aCBTIHRoZSBza2V3LXN5bW1ldHJpYyBjcm9zcy1wcm9kdWN0IG1hdHJpeCBvZiB3LlxuICBjb25zdCBzID0gW1xuICAgIFswLCAtd1syXSwgd1sxXV0sXG4gICAgW3dbMl0sIDAsIC13WzBdXSxcbiAgICBbLXdbMV0sIHdbMF0sIDBdLFxuICBdO1xuICBjb25zdCBzYSA9IFtcbiAgICBbMCwgMCwgMF0sXG4gICAgWzAsIDAsIDBdLFxuICAgIFswLCAwLCAwXSxcbiAgXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAzOyBpKyspIHtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IDM7IGorKykge1xuICAgICAgbGV0IGFjYyA9IDA7XG4gICAgICBmb3IgKGxldCBrID0gMDsgayA8IDM7IGsrKykgYWNjICs9IHNbaV1ba10gKiBhW2tdW2pdO1xuICAgICAgc2FbaV1bal0gPSBhY2M7XG4gICAgfVxuICB9XG4gIGNvbnN0IGFoYXQgPSBbXG4gICAgWzAsIDAsIDBdLFxuICAgIFswLCAwLCAwXSxcbiAgICBbMCwgMCwgMF0sXG4gIF07XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMzsgaSsrKSB7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCAzOyBqKyspIHtcbiAgICAgIGxldCBhY2MgPSAwO1xuICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCAzOyBrKyspIGFjYyArPSBzYVtpXVtrXSAqIHNba11bal07XG4gICAgICBhaGF0W2ldW2pdID0gLWFjYztcbiAgICB9XG4gIH1cblxuICBsZXQgdHJhY2UgPSAwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDM7IGkrKykge1xuICAgIGZvciAobGV0IGsgPSAwOyBrIDwgMzsgaysrKSB0cmFjZSArPSBhaGF0W2ldW2tdICogYVtrXVtpXTtcbiAgfVxuICBpZiAoIShNYXRoLmFicyh0cmFjZSkgPiAwKSkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3Qgb2Zmc2V0OiBWZWMzID0gWzAsIDAsIDBdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDM7IGkrKykge1xuICAgIGxldCBhY2MgPSAwO1xuICAgIGZvciAobGV0IGsgPSAwOyBrIDwgMzsgaysrKSBhY2MgKz0gYWhhdFtpXVtrXSAqIGJba107XG4gICAgb2Zmc2V0W2ldID0gYWNjIC8gdHJhY2U7XG4gIH1cbiAgaWYgKCFvZmZzZXQuZXZlcnkoKHYpID0+IE51bWJlci5pc0Zpbml0ZSh2KSkpIHJldHVybiBudWxsO1xuXG4gIGxldCBlcnJvciA9IDA7XG4gIGxldCByc3FyID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHtcbiAgICBjb25zdCB5ID0gcHJvamVjdGVkW2ldO1xuICAgIGNvbnN0IHRlcm0gPVxuICAgICAgc3FyTGVuZ3Roc1tpXSAtIGF2ZXJhZ2VTcXJMZW5ndGggLSAyICogKHlbMF0gKiBvZmZzZXRbMF0gKyB5WzFdICogb2Zmc2V0WzFdICsgeVsyXSAqIG9mZnNldFsyXSk7XG4gICAgZXJyb3IgKz0gdGVybSAqIHRlcm07XG4gICAgcnNxciArPSAob2Zmc2V0WzBdIC0geVswXSkgKiogMiArIChvZmZzZXRbMV0gLSB5WzFdKSAqKiAyICsgKG9mZnNldFsyXSAtIHlbMl0pICoqIDI7XG4gIH1cbiAgZXJyb3IgLz0gbjtcbiAgcnNxciAvPSBuO1xuICBpZiAoIShyc3FyID49IDApIHx8ICFOdW1iZXIuaXNGaW5pdGUoZXJyb3IpKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCByYWRpdXMgPSBNYXRoLnNxcnQocnNxcik7XG4gIGNvbnN0IGNlbnRlcjogVmVjMyA9IFttZWFuWzBdICsgb2Zmc2V0WzBdLCBtZWFuWzFdICsgb2Zmc2V0WzFdLCBtZWFuWzJdICsgb2Zmc2V0WzJdXTtcbiAgbGV0IHJhZGlhbFNxID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHtcbiAgICBjb25zdCB5ID0gcHJvamVjdGVkW2ldO1xuICAgIGNvbnN0IGQgPVxuICAgICAgTWF0aC5oeXBvdCh5WzBdIC0gb2Zmc2V0WzBdLCB5WzFdIC0gb2Zmc2V0WzFdLCB5WzJdIC0gb2Zmc2V0WzJdKSAtIHJhZGl1cztcbiAgICByYWRpYWxTcSArPSBkICogZDtcbiAgfVxuICBjb25zdCBleHRlbnQgPSBheGlzRXh0ZW50KHBvaW50cywgY2VudGVyLCB3KTtcbiAgcmV0dXJuIHtcbiAgICBjZW50ZXIsXG4gICAgYXhpczogdyxcbiAgICByYWRpdXMsXG4gICAgZXJyb3IsXG4gICAgcm1zOiBNYXRoLnNxcnQocmFkaWFsU3EgLyBuKSxcbiAgICBoZWlnaHQ6IGV4dGVudFsxXSAtIGV4dGVudFswXSxcbiAgICBleHRlbnQsXG4gIH07XG59XG5cbi8vIFRoZSBjYW5kaWRhdGUgZGlyZWN0aW9ucyB0aGUgZ2xvYmFsIHN3ZWVwIHRyaWVzOiBhIEhhbW1lcnNsZXkgaGVtaXNwaGVyZSBzZXRcbi8vIChkZXRlcm1pbmlzdGljLCBsb3ctZGlzY3JlcGFuY3kpIHBsdXMgdGhlIGNsb3VkJ3Mgb3duIHByaW5jaXBhbCBheGlzLCB3aGljaCBpc1xuLy8gdGhlIGV4YWN0IGFuc3dlciBmb3IgYSBsb25nIHRoaW4gY3lsaW5kZXIgYW5kIGxldHMgdGhlIHN3ZWVwIHN0YXkgY29hcnNlLlxuZnVuY3Rpb24gY2FuZGlkYXRlRGlyZWN0aW9ucyhwb2ludHM6IHJlYWRvbmx5IFZlYzNbXSwgc2FtcGxlczogbnVtYmVyKTogVmVjM1tdIHtcbiAgY29uc3Qgb3V0OiBWZWMzW10gPSBbXTtcbiAgY29uc3QgcHJpbmNpcGFsID0gZml0T3J0aG9MaW5lMyhwb2ludHMpO1xuICBpZiAocHJpbmNpcGFsKSBvdXQucHVzaChwcmluY2lwYWwuZGlyZWN0aW9uKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzYW1wbGVzOyBpKyspIHtcbiAgICBjb25zdCBbdSwgdl0gPSBoYW1tZXJzbGV5KGksIHNhbXBsZXMpO1xuICAgIC8vIHUgPSBjb3ModGhldGEpID0gMCBpcyB0aGUgZXF1YXRvciwgd2hpY2ggdW5pZm9ybUhlbWlzcGhlcmUgbWFwcyB0byBhIGRpcmVjdGlvbiBpbiB0aGUgWFkgcGxhbmUuXG4gICAgb3V0LnB1c2godW5pZm9ybUhlbWlzcGhlcmUodSwgdikpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8vIFBhdHRlcm4gc2VhcmNoIG9uIHRoZSB1bml0IHNwaGVyZTogc3RlcCBhbG9uZyBlYWNoIHRhbmdlbnQgYXhpcyBpbiBib3RoXG4vLyBkaXJlY3Rpb25zLCB0YWtlIGFueSBpbXByb3ZlbWVudCwgYW5kIGhhbHZlIHRoZSBzdGVwIHdoZW4gbm9uZSBpcyBmb3VuZC5cbmZ1bmN0aW9uIHJlZmluZURpcmVjdGlvbihcbiAgcG9pbnRzOiByZWFkb25seSBWZWMzW10sXG4gIHN0YXJ0OiBDeWxpbmRlckZpdCxcbiAgc3RlcHM6IG51bWJlcixcbiAgdG9sZXJhbmNlOiBudW1iZXIsXG4pOiBDeWxpbmRlckZpdCB7XG4gIGxldCBiZXN0ID0gc3RhcnQ7XG4gIGxldCBzdGVwID0gMC4xO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHN0ZXBzICYmIHN0ZXAgPiB0b2xlcmFuY2U7IGkrKykge1xuICAgIGNvbnN0IHQxID0gYW55T3J0aG9nb25hbChiZXN0LmF4aXMpO1xuICAgIGNvbnN0IHQyOiBWZWMzID0gW1xuICAgICAgYmVzdC5heGlzWzFdICogdDFbMl0gLSBiZXN0LmF4aXNbMl0gKiB0MVsxXSxcbiAgICAgIGJlc3QuYXhpc1syXSAqIHQxWzBdIC0gYmVzdC5heGlzWzBdICogdDFbMl0sXG4gICAgICBiZXN0LmF4aXNbMF0gKiB0MVsxXSAtIGJlc3QuYXhpc1sxXSAqIHQxWzBdLFxuICAgIF07XG4gICAgbGV0IGltcHJvdmVkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCB0YW5nZW50IG9mIFt0MSwgdDJdKSB7XG4gICAgICBmb3IgKGNvbnN0IHNpZ24gb2YgWzEsIC0xXSkge1xuICAgICAgICBjb25zdCBjYW5kaWRhdGU6IFZlYzMgPSBbXG4gICAgICAgICAgYmVzdC5heGlzWzBdICsgc2lnbiAqIHN0ZXAgKiB0YW5nZW50WzBdLFxuICAgICAgICAgIGJlc3QuYXhpc1sxXSArIHNpZ24gKiBzdGVwICogdGFuZ2VudFsxXSxcbiAgICAgICAgICBiZXN0LmF4aXNbMl0gKyBzaWduICogc3RlcCAqIHRhbmdlbnRbMl0sXG4gICAgICAgIF07XG4gICAgICAgIGNvbnN0IGZpdCA9IGZpdEN5bGluZGVyRm9yQXhpcyhwb2ludHMsIGNhbmRpZGF0ZSk7XG4gICAgICAgIGlmIChmaXQgJiYgZml0LmVycm9yIDwgYmVzdC5lcnJvcikge1xuICAgICAgICAgIGJlc3QgPSBmaXQ7XG4gICAgICAgICAgaW1wcm92ZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmICghaW1wcm92ZWQpIHN0ZXAgLz0gMjtcbiAgfVxuICByZXR1cm4gYmVzdDtcbn1cblxuLy8gRml0IGFuIGluZmluaXRlIGN5bGluZGVyIHRvIHRoZSBwb2ludHMuIE51bGwgd2hlbiB0aGUgY2xvdWQgY2Fubm90IGRldGVybWluZVxuLy8gb25lOiBhIGJvdW5kZWQgbnVtYmVyIG9mIHBvaW50cyAoYSBjeWxpbmRlciBoYXMgYSBmZXcgZGVncmVlcyBvZiBmcmVlZG9tKSxcbi8vIG9yIGV2ZXJ5IGNhbmRpZGF0ZSBheGlzIGRlZ2VuZXJhdGUuXG4vL1xuLy8gVGhlIHJldHVybmVkIGF4aXMgaXMgaW5maW5pdGU7IGhlaWdodCBhbmQgZXh0ZW50IHJlcG9ydCBob3cgZmFyIHRoZSBEQVRBXG4vLyByZWFjaGVzIGFsb25nIGl0LCBzbyBhIGNhbGxlciBkcmF3aW5nIGEgY2FwcGVkIGN5bGluZGVyIGhhcyB0aGUgaW50ZXJ2YWwuXG5leHBvcnQgZnVuY3Rpb24gZml0Q3lsaW5kZXIoXG4gIHBvaW50czogcmVhZG9ubHkgVmVjM1tdLFxuICBvcHRpb25zOiBDeWxpbmRlckZpdE9wdGlvbnMgPSB7fSxcbik6IEN5bGluZGVyRml0IHwgbnVsbCB7XG4gIGlmIChwb2ludHMubGVuZ3RoIDwgNSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHNhbXBsZXMgPSBvcHRpb25zLmRpcmVjdGlvblNhbXBsZXMgPz8gMjU2O1xuICBjb25zdCByZWZpbmVTdGVwcyA9IG9wdGlvbnMucmVmaW5lU3RlcHMgPz8gNjQ7XG4gIGNvbnN0IHRvbGVyYW5jZSA9IG9wdGlvbnMudG9sZXJhbmNlID8/IDFlLTk7XG5cbiAgY29uc3QgY2FuZGlkYXRlcyA9IG9wdGlvbnMuZGlyZWN0aW9uID8gW29wdGlvbnMuZGlyZWN0aW9uXSA6IGNhbmRpZGF0ZURpcmVjdGlvbnMocG9pbnRzLCBzYW1wbGVzKTtcbiAgbGV0IGJlc3Q6IEN5bGluZGVyRml0IHwgbnVsbCA9IG51bGw7XG4gIGZvciAoY29uc3QgZGlyZWN0aW9uIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICBjb25zdCBmaXQgPSBmaXRDeWxpbmRlckZvckF4aXMocG9pbnRzLCBkaXJlY3Rpb24pO1xuICAgIGlmIChmaXQgJiYgKCFiZXN0IHx8IGZpdC5lcnJvciA8IGJlc3QuZXJyb3IpKSBiZXN0ID0gZml0O1xuICB9XG4gIGlmICghYmVzdCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiByZWZpbmVEaXJlY3Rpb24ocG9pbnRzLCBiZXN0LCByZWZpbmVTdGVwcywgdG9sZXJhbmNlKTtcbn1cblxuLy8gU2lnbmVkIGRpc3RhbmNlIGZyb20gYSBwb2ludCB0byB0aGUgZml0dGVkIElORklOSVRFIGN5bGluZGVyJ3Mgc3VyZmFjZTpcbi8vIG5lZ2F0aXZlIGluc2lkZSwgcG9zaXRpdmUgb3V0c2lkZS4gVGhlIGNhcHMgYXJlIG5vdCBjb25zaWRlcmVkLlxuZXhwb3J0IGZ1bmN0aW9uIGRpc3RhbmNlVG9DeWxpbmRlclN1cmZhY2UoZml0OiBDeWxpbmRlckZpdCwgcDogVmVjMyk6IG51bWJlciB7XG4gIGNvbnN0IHJhZGlhbCA9IHByb2plY3QoZml0LmF4aXMsIFtwWzBdIC0gZml0LmNlbnRlclswXSwgcFsxXSAtIGZpdC5jZW50ZXJbMV0sIHBbMl0gLSBmaXQuY2VudGVyWzJdXSk7XG4gIHJldHVybiBNYXRoLmh5cG90KHJhZGlhbFswXSwgcmFkaWFsWzFdLCByYWRpYWxbMl0pIC0gZml0LnJhZGl1cztcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFFQSxTQUFTLFlBQVk7QUFDckIsT0FBTyxZQUFZOzs7QUNFWixTQUFTLGdCQUFnQixHQUFtQjtBQUNqRCxNQUFJLE9BQU8sTUFBTTtBQUNqQixTQUFRLFFBQVEsS0FBTyxTQUFTO0FBQ2hDLFVBQVMsT0FBTyxlQUFlLEtBQU8sT0FBTyxnQkFBZ0I7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O0FBQ2pDLFlBQU0sSUFBSSxJQUFJO0FBQ2QsZUFBUyxJQUFJLEdBQUcsSUFBSSxHQUFHLEtBQUs7QUFDMUIsY0FBTSxNQUFNLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDbEIsY0FBTSxNQUFNLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDbEIsVUFBRSxDQUFDLEVBQUUsQ0FBQyxJQUFJLElBQUksTUFBTSxJQUFJO0FBQ3hCLFVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLE1BQU0sSUFBSTtBQUFBLE1BQzFCO0FBQ0EsZUFBUyxJQUFJLEdBQUcsSUFBSSxHQUFHLEtBQUs7QUFDMUIsY0FBTSxNQUFNLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDbEIsY0FBTSxNQUFNLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDbEIsVUFBRSxDQUFDLEVBQUUsQ0FBQyxJQUFJLElBQUksTUFBTSxJQUFJO0FBQ3hCLFVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLE1BQU0sSUFBSTtBQUFBLE1BQzFCO0FBQ0EsZUFBUyxJQUFJLEdBQUcsSUFBSSxHQUFHLEtBQUs7QUFDMUIsY0FBTSxNQUFNLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDbEIsY0FBTSxNQUFNLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDbEIsVUFBRSxDQUFDLEVBQUUsQ0FBQyxJQUFJLElBQUksTUFBTSxJQUFJO0FBQ3hCLFVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLE1BQU0sSUFBSTtBQUFBLE1BQzFCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLFFBQVEsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sRUFBRSxDQUFDLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUN4RCxRQUFNLFNBQVMsTUFBTSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDdkMsUUFBTSxVQUFVLE1BQU0sSUFBSSxDQUFDLE1BQU0sY0FBYyxDQUFDLEVBQUUsQ0FBQyxF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
