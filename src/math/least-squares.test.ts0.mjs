// src/math/least-squares.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

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
function solveLinear(a, b) {
  const [rows, cols] = dims(a);
  if (rows !== cols) throw new RangeError(`solveLinear needs a square matrix, got ${rows}x${cols}`);
  if (b.length !== rows) throw new RangeError(`solveLinear: b has ${b.length} entries, want ${rows}`);
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < cols; col++) {
    let pivot = col;
    for (let r = col + 1; r < rows; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) <= Number.EPSILON) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const diag = m[col][col];
    for (let r = col + 1; r < rows; r++) {
      const factor = m[r][col] / diag;
      if (factor === 0) continue;
      for (let c = col; c <= cols; c++) m[r][c] -= factor * m[col][c];
    }
  }
  const x = new Array(cols).fill(0);
  for (let r = cols - 1; r >= 0; r--) {
    let acc = m[r][cols];
    for (let c = r + 1; c < cols; c++) acc -= m[r][c] * x[c];
    x[r] = acc / m[r][r];
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}
function transpose(a) {
  const [rows, cols] = dims(a);
  const out = [];
  for (let c = 0; c < cols; c++) {
    const row = new Array(rows);
    for (let r = 0; r < rows; r++) row[r] = a[r][c];
    out.push(row);
  }
  return out;
}
function matVec(a, x) {
  const [rows, cols] = dims(a);
  if (x.length !== cols) throw new RangeError(`matVec: x has ${x.length} entries, want ${cols}`);
  const out = new Array(rows).fill(0);
  for (let r = 0; r < rows; r++) {
    let acc = 0;
    for (let c = 0; c < cols; c++) acc += a[r][c] * x[c];
    out[r] = acc;
  }
  return out;
}
function solveLeastSquares(a, b, ridge = 0) {
  const [rows, cols] = dims(a);
  if (b.length !== rows) throw new RangeError(`solveLeastSquares: b has ${b.length} entries, want ${rows}`);
  const normal = [];
  for (let i = 0; i < cols; i++) {
    const row = new Array(cols).fill(0);
    for (let j = 0; j < cols; j++) {
      let acc = 0;
      for (let r = 0; r < rows; r++) acc += a[r][i] * a[r][j];
      row[j] = i === j ? acc + ridge : acc;
    }
    normal.push(row);
  }
  const rhs = new Array(cols).fill(0);
  for (let i = 0; i < cols; i++) {
    let acc = 0;
    for (let r = 0; r < rows; r++) acc += a[r][i] * b[r];
    rhs[i] = acc;
  }
  return solveLinear(normal, rhs);
}
function residuals(a, x, b) {
  const predicted = matVec(a, x);
  if (b.length !== predicted.length) {
    throw new RangeError(`residuals: b has ${b.length} entries, want ${predicted.length}`);
  }
  return predicted.map((p, i) => b[i] - p);
}
function rms(values) {
  if (values.length === 0) return 0;
  let acc = 0;
  for (const v of values) acc += v * v;
  return Math.sqrt(acc / values.length);
}
function evalPolynomial(coeffs, x) {
  let acc = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) acc = acc * x + coeffs[i];
  return acc;
}
function fitPolynomial(xs, ys, degree) {
  if (xs.length !== ys.length) {
    throw new RangeError(`fitPolynomial: ${xs.length} x values against ${ys.length} y values`);
  }
  if (!Number.isInteger(degree) || degree < 0) {
    throw new RangeError(`fitPolynomial: degree must be a non-negative integer, got ${degree}`);
  }
  if (xs.length < degree + 1) {
    throw new RangeError(`fitPolynomial: degree ${degree} needs ${degree + 1} points, got ${xs.length}`);
  }
  const center = xs.reduce((s, x) => s + x, 0) / xs.length;
  let spread = 0;
  for (const x of xs) spread = Math.max(spread, Math.abs(x - center));
  const scaleX = spread || 1;
  const vandermonde = xs.map((x) => {
    const t = (x - center) / scaleX;
    const row = new Array(degree + 1);
    let power = 1;
    for (let k = 0; k <= degree; k++) {
      row[k] = power;
      power *= t;
    }
    return row;
  });
  const shifted = solveLeastSquares(vandermonde, ys);
  if (!shifted) return null;
  const out = new Array(degree + 1).fill(0);
  for (let k = 0; k <= degree; k++) {
    if (shifted[k] === 0) continue;
    let binom = 1;
    for (let j = 0; j <= k; j++) {
      const term = binom * Math.pow(-center, k - j) / Math.pow(scaleX, k);
      out[j] += shifted[k] * term;
      binom = binom * (k - j) / (j + 1);
    }
  }
  return out;
}
function fitLine(xs, ys) {
  if (xs.length !== ys.length) {
    throw new RangeError(`fitLine: ${xs.length} x values against ${ys.length} y values`);
  }
  const n = xs.length;
  if (n < 2) throw new RangeError(`fitLine needs at least 2 points, got ${n}`);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    sxx += dx * dx;
    sxy += dx * (ys[i] - meanY);
  }
  if (sxx <= Number.EPSILON) return null;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const errors = ys.map((y, i) => y - (slope * xs[i] + intercept));
  return { slope, intercept, rms: rms(errors) };
}
function eigen2(xx, xy, yy) {
  const half = (xx + yy) / 2;
  const diff = (xx - yy) / 2;
  const root = Math.hypot(diff, xy);
  const large = half + root;
  const small = half - root;
  let major = Math.abs(xy) > Number.EPSILON ? [large - yy, xy] : xx >= yy ? [1, 0] : [0, 1];
  const len = Math.hypot(major[0], major[1]) || 1;
  major = [major[0] / len, major[1] / len];
  const minor = [-major[1], major[0]];
  return { values: [small, large], vectors: [minor, major] };
}
function fitOrthoLine2(points) {
  if (points.length < 2) return null;
  const n = points.length;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p[0];
    my += p[1];
  }
  mx /= n;
  my /= n;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const p of points) {
    const dx = p[0] - mx;
    const dy = p[1] - my;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  if (xx + yy <= Number.EPSILON) return null;
  const { vectors } = eigen2(xx / n, xy / n, yy / n);
  const normal = vectors[0];
  const direction = vectors[1];
  const errors = points.map((p) => normal[0] * (p[0] - mx) + normal[1] * (p[1] - my));
  return { point: [mx, my], direction, rms: rms(errors) };
}
function fitCircle2(points) {
  if (points.length < 3) return null;
  const rows = points.map((p) => [2 * p[0], 2 * p[1], 1]);
  const rhs = points.map((p) => p[0] * p[0] + p[1] * p[1]);
  const solution = solveLeastSquares(rows, rhs);
  if (!solution) return null;
  const [cx, cy, c] = solution;
  const rsqr = c + cx * cx + cy * cy;
  if (!(rsqr > 0)) return null;
  const radius = Math.sqrt(rsqr);
  const errors = points.map((p) => Math.hypot(p[0] - cx, p[1] - cy) - radius);
  return { center: [cx, cy], radius, rms: rms(errors) };
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
function fitPlane(points) {
  if (points.length < 3) return null;
  const { mean, matrix } = covariance3(points);
  const { values, vectors } = symmetricEigen3(matrix);
  if (values[1] <= Number.EPSILON * (values[2] || 1)) return null;
  const normal = vectors[0];
  const errors = points.map(
    (p) => normal[0] * (p[0] - mean[0]) + normal[1] * (p[1] - mean[1]) + normal[2] * (p[2] - mean[2])
  );
  return { point: mean, normal, rms: rms(errors) };
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

// src/math/least-squares.test.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
test("solveLinear solves a square system exactly", () => {
  const x = solveLinear([[2, 1], [1, -1]], [5, 1]);
  assert.ok(x);
  assert.ok(Math.abs(x[0] - 2) < 1e-12);
  assert.ok(Math.abs(x[1] - 1) < 1e-12);
});
test("solveLinear pivots, so a zero leading entry is fine", () => {
  const x = solveLinear([[0, 1], [1, 0]], [3, 4]);
  assert.deepEqual(x, [4, 3]);
});
test("solveLinear returns null for a singular matrix", () => {
  assert.equal(solveLinear([[1, 2], [2, 4]], [1, 2]), null);
  assert.equal(solveLinear([[0, 0], [0, 0]], [1, 1]), null);
});
test("solveLinear rejects a non-square matrix or a mismatched b", () => {
  assert.throws(() => solveLinear([[1, 2, 3], [4, 5, 6]], [1, 2]), RangeError);
  assert.throws(() => solveLinear([[1, 0], [0, 1]], [1]), RangeError);
});
test("transpose and matVec", () => {
  assert.deepEqual(transpose([[1, 2, 3], [4, 5, 6]]), [[1, 4], [2, 5], [3, 6]]);
  assert.deepEqual(matVec([[1, 2], [3, 4]], [1, 1]), [3, 7]);
  assert.throws(() => matVec([[1, 2]], [1, 2, 3]), RangeError);
  assert.throws(() => transpose([[1, 2], [3]]), RangeError);
});
test("solveLeastSquares reproduces an exactly-consistent overdetermined system", () => {
  const a = [[1, 0], [1, 1], [1, 2]];
  const b = [1, 3, 5];
  const x = solveLeastSquares(a, b);
  assert.ok(x);
  assert.ok(Math.abs(x[0] - 1) < 1e-12);
  assert.ok(Math.abs(x[1] - 2) < 1e-12);
  assert.ok(rms(residuals(a, x, b)) < 1e-12);
});
test("solveLeastSquares minimises the residual on an inconsistent system", () => {
  const a = [[1], [1], [1]];
  const x = solveLeastSquares(a, [1, 2, 6]);
  assert.ok(x);
  assert.ok(Math.abs(x[0] - 3) < 1e-12);
});
test("solveLeastSquares returns null on a rank-deficient system, and a ridge rescues it", () => {
  const a = [[1, 1], [2, 2], [3, 3]];
  const b = [1, 2, 3];
  assert.equal(solveLeastSquares(a, b), null);
  const ridged = solveLeastSquares(a, b, 1e-6);
  assert.ok(ridged);
  assert.ok(Math.abs(ridged[0] + ridged[1] - 1) < 1e-4);
});
test("rms of an empty residual vector is 0", () => {
  assert.equal(rms([]), 0);
  assert.equal(rms([3, 4]), Math.sqrt(12.5));
});
test("evalPolynomial uses ascending coefficient order", () => {
  assert.equal(evalPolynomial([1, 2, 3], 2), 17);
  assert.equal(evalPolynomial([], 5), 0);
  assert.equal(evalPolynomial([7], 5), 7);
});
test("fitPolynomial recovers an exact cubic", () => {
  const truth = [2, -3, 0.5, 1];
  const xs = [-3, -2, -1, 0, 1, 2, 3, 4];
  const ys = xs.map((x) => evalPolynomial(truth, x));
  const fit = fitPolynomial(xs, ys, 3);
  assert.ok(fit);
  for (let i = 0; i < truth.length; i++) {
    assert.ok(Math.abs(fit[i] - truth[i]) < 1e-9, `coefficient ${i}: ${fit[i]} vs ${truth[i]}`);
  }
});
test("fitPolynomial stays accurate on x values far from the origin", () => {
  const truth = [5, -2, 0.25];
  const xs = [1e6, 1e6 + 1, 1e6 + 2, 1e6 + 3, 1e6 + 4];
  const ys = xs.map((x) => evalPolynomial(truth, x));
  const fit = fitPolynomial(xs, ys, 2);
  assert.ok(fit);
  for (const x of xs) {
    const predicted = evalPolynomial(fit, x);
    const expected = evalPolynomial(truth, x);
    assert.ok(Math.abs(predicted - expected) < Math.abs(expected) * 1e-6 + 1e-6);
  }
});
test("fitPolynomial of degree 0 is the mean", () => {
  const fit = fitPolynomial([0, 1, 2], [1, 2, 6], 0);
  assert.ok(fit);
  assert.ok(Math.abs(fit[0] - 3) < 1e-12);
});
test("fitPolynomial rejects too few points and a bad degree", () => {
  assert.throws(() => fitPolynomial([0, 1], [0, 1], 2), RangeError);
  assert.throws(() => fitPolynomial([0, 1], [0], 1), RangeError);
  assert.throws(() => fitPolynomial([0, 1], [0, 1], -1), RangeError);
});
test("fitLine recovers a known slope and intercept, with zero rms on exact data", () => {
  const xs = [0, 1, 2, 3, 4];
  const ys = xs.map((x) => 3 * x - 2);
  const fit = fitLine(xs, ys);
  assert.ok(fit);
  assert.ok(Math.abs(fit.slope - 3) < 1e-12);
  assert.ok(Math.abs(fit.intercept + 2) < 1e-12);
  assert.ok(fit.rms < 1e-12);
});
test("fitLine stays near the generator under noise", () => {
  const rand = mulberry32(7);
  const xs = [];
  const ys = [];
  for (let i = 0; i < 400; i++) {
    const x = i / 40;
    xs.push(x);
    ys.push(1.5 * x + 4 + (rand() - 0.5) * 0.2);
  }
  const fit = fitLine(xs, ys);
  assert.ok(fit);
  assert.ok(Math.abs(fit.slope - 1.5) < 0.02, `slope ${fit.slope}`);
  assert.ok(Math.abs(fit.intercept - 4) < 0.05, `intercept ${fit.intercept}`);
  assert.ok(fit.rms < 0.1);
});
test("fitLine returns null for vertical data and rejects mismatched input", () => {
  assert.equal(fitLine([2, 2, 2], [0, 1, 2]), null);
  assert.throws(() => fitLine([0, 1], [0]), RangeError);
  assert.throws(() => fitLine([0], [0]), RangeError);
});
test("fitOrthoLine2 handles the vertical line that fitLine cannot", () => {
  const points = [[2, -1], [2, 0], [2, 1], [2, 5]];
  const fit = fitOrthoLine2(points);
  assert.ok(fit);
  assert.ok(fit.rms < 1e-12);
  assert.ok(Math.abs(Math.abs(fit.direction[1]) - 1) < 1e-12);
  assert.ok(Math.abs(fit.direction[0]) < 1e-12);
  assert.ok(Math.abs(fit.point[0] - 2) < 1e-12);
});
test("fitOrthoLine2 recovers a diagonal line exactly", () => {
  const points = [[0, 0], [1, 1], [2, 2], [3, 3]];
  const fit = fitOrthoLine2(points);
  assert.ok(fit);
  assert.ok(fit.rms < 1e-12);
  const d = fit.direction;
  assert.ok(Math.abs(Math.abs(d[0]) - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(Math.abs(d[1]) - Math.SQRT1_2) < 1e-12);
  assert.ok(d[0] * d[1] > 0);
});
test("fitOrthoLine2 rejects degenerate input", () => {
  assert.equal(fitOrthoLine2([[1, 1]]), null);
  assert.equal(fitOrthoLine2([[1, 1], [1, 1], [1, 1]]), null);
});
test("fitCircle2 recovers a known circle exactly", () => {
  const center = [-3, 4];
  const radius = 2.5;
  const points = [];
  for (let i = 0; i < 12; i++) {
    const t = i / 12 * 2 * Math.PI;
    points.push([center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)]);
  }
  const fit = fitCircle2(points);
  assert.ok(fit);
  assert.ok(Math.abs(fit.center[0] - center[0]) < 1e-10);
  assert.ok(Math.abs(fit.center[1] - center[1]) < 1e-10);
  assert.ok(Math.abs(fit.radius - radius) < 1e-10);
  assert.ok(fit.rms < 1e-10);
});
test("fitCircle2 works from a short arc and reports a real geometric rms", () => {
  const points = [];
  for (let i = 0; i < 8; i++) {
    const t = i / 40 * 2 * Math.PI;
    points.push([10 * Math.cos(t), 10 * Math.sin(t)]);
  }
  const fit = fitCircle2(points);
  assert.ok(fit);
  assert.ok(Math.abs(fit.radius - 10) < 1e-6, `radius ${fit.radius}`);
  assert.ok(fit.rms < 1e-6);
});
test("fitCircle2 rejects fewer than three points and collinear points", () => {
  assert.equal(fitCircle2([[0, 0], [1, 1]]), null);
  assert.equal(fitCircle2([[0, 0], [1, 1], [2, 2], [3, 3]]), null);
});
test("covariance3 reports the mean and a symmetric matrix", () => {
  const points = [[1, 0, 0], [-1, 0, 0], [0, 2, 0], [0, -2, 0]];
  const { mean, matrix } = covariance3(points);
  assert.deepEqual(mean, [0, 0, 0]);
  assert.ok(Math.abs(matrix[0][0] - 0.5) < 1e-12);
  assert.ok(Math.abs(matrix[1][1] - 2) < 1e-12);
  assert.equal(matrix[2][2], 0);
  assert.equal(matrix[0][1], matrix[1][0]);
  assert.throws(() => covariance3([]), RangeError);
});
test("symmetricEigen3 diagonalises a diagonal matrix, ascending", () => {
  const { values, vectors } = symmetricEigen3([[3, 0, 0], [0, 1, 0], [0, 0, 2]]);
  assert.ok(Math.abs(values[0] - 1) < 1e-12);
  assert.ok(Math.abs(values[1] - 2) < 1e-12);
  assert.ok(Math.abs(values[2] - 3) < 1e-12);
  assert.ok(Math.abs(Math.abs(vectors[0][1]) - 1) < 1e-12);
  assert.ok(Math.abs(Math.abs(vectors[1][2]) - 1) < 1e-12);
  assert.ok(Math.abs(Math.abs(vectors[2][0]) - 1) < 1e-12);
});
test("symmetricEigen3 eigenvectors satisfy A v = lambda v and are orthonormal", () => {
  const m = [
    [4, 1, -2],
    [1, 2, 0],
    [-2, 0, 3]
  ];
  const { values, vectors } = symmetricEigen3(m);
  for (let k = 0; k < 3; k++) {
    const v = vectors[k];
    assert.ok(Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-12, "unit length");
    for (let i = 0; i < 3; i++) {
      const av = m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2];
      assert.ok(Math.abs(av - values[k] * v[i]) < 1e-9, `row ${i} of eigenpair ${k}`);
    }
  }
  const pairs = [[0, 1], [0, 2], [1, 2]];
  for (const [i, j] of pairs) {
    const d = vectors[i][0] * vectors[j][0] + vectors[i][1] * vectors[j][1] + vectors[i][2] * vectors[j][2];
    assert.ok(Math.abs(d) < 1e-9, `orthogonality of ${i},${j}`);
  }
  assert.ok(Math.abs(values[0] + values[1] + values[2] - 9) < 1e-9);
  assert.ok(values[0] <= values[1] && values[1] <= values[2]);
});
test("symmetricEigen3 rejects a matrix that is not 3x3", () => {
  assert.throws(() => symmetricEigen3([[1, 0], [0, 1]]), RangeError);
});
test("fitPlane recovers a tilted plane exactly", () => {
  const points = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const x = i - 2;
      const y = j - 2;
      points.push([x, y, 2 * x - y + 3]);
    }
  }
  const fit = fitPlane(points);
  assert.ok(fit);
  assert.ok(fit.rms < 1e-12);
  const expected = [2, -1, -1].map((c) => c / Math.hypot(2, 1, 1));
  const dotAbs = Math.abs(
    fit.normal[0] * expected[0] + fit.normal[1] * expected[1] + fit.normal[2] * expected[2]
  );
  assert.ok(Math.abs(dotAbs - 1) < 1e-9, `normal ${fit.normal}`);
  assert.ok(Math.abs(fit.point[2] - (2 * fit.point[0] - fit.point[1] + 3)) < 1e-9);
});
test("fitPlane stays near the generator under noise", () => {
  const rand = mulberry32(11);
  const points = [];
  for (let i = 0; i < 600; i++) {
    const x = rand() * 10 - 5;
    const y = rand() * 10 - 5;
    points.push([x, y, 0.5 * x + 0.25 * y + 1 + (rand() - 0.5) * 0.05]);
  }
  const fit = fitPlane(points);
  assert.ok(fit);
  const expected = [0.5, 0.25, -1].map((c) => c / Math.hypot(0.5, 0.25, 1));
  const dotAbs = Math.abs(
    fit.normal[0] * expected[0] + fit.normal[1] * expected[1] + fit.normal[2] * expected[2]
  );
  assert.ok(Math.abs(dotAbs - 1) < 1e-3, `normal ${fit.normal}`);
  assert.ok(fit.rms < 0.05);
});
test("fitPlane returns null for collinear points: their normal is arbitrary", () => {
  const points = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3]];
  assert.equal(fitPlane(points), null);
  assert.equal(fitPlane([[0, 0, 0], [1, 0, 0]]), null);
});
test("fitOrthoLine3 recovers a 3D line exactly", () => {
  const direction = [1, 2, -2].map((c) => c / 3);
  const points = [];
  for (let i = -4; i <= 4; i++) {
    points.push([1 + direction[0] * i, -2 + direction[1] * i, 5 + direction[2] * i]);
  }
  const fit = fitOrthoLine3(points);
  assert.ok(fit);
  assert.ok(fit.rms < 1e-12);
  const dotAbs = Math.abs(
    fit.direction[0] * direction[0] + fit.direction[1] * direction[1] + fit.direction[2] * direction[2]
  );
  assert.ok(Math.abs(dotAbs - 1) < 1e-9);
  assert.ok(Math.hypot(fit.point[0] - 1, fit.point[1] + 2, fit.point[2] - 5) < 1e-9);
});
test("fitOrthoLine3 rms is the orthogonal distance, not a vertical residual", () => {
  const points = [[0, 0, 0], [1, 1, 0], [2, 0, 0], [3, -1, 0]];
  const fit = fitOrthoLine3(points);
  assert.ok(fit);
  assert.ok(fit.rms > 0);
  assert.ok(fit.rms <= 1 + 1e-12);
});
test("fitOrthoLine3 rejects degenerate input", () => {
  assert.equal(fitOrthoLine3([[1, 2, 3]]), null);
  assert.equal(fitOrthoLine3([[1, 2, 3], [1, 2, 3]]), null);
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibGVhc3Qtc3F1YXJlcy50ZXN0LnRzIiwgImxlYXN0LXNxdWFyZXMudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFRlc3RzIGZvciB0aGUgbGVhc3Qtc3F1YXJlcyBmaXR0aW5nIG1vZHVsZS5cblxuaW1wb3J0IHsgdGVzdCB9IGZyb20gJ25vZGU6dGVzdCc7XG5pbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0L3N0cmljdCc7XG5cbmltcG9ydCB7XG4gIHNvbHZlTGluZWFyLFxuICB0cmFuc3Bvc2UsXG4gIG1hdFZlYyxcbiAgc29sdmVMZWFzdFNxdWFyZXMsXG4gIHJlc2lkdWFscyxcbiAgcm1zLFxuICBldmFsUG9seW5vbWlhbCxcbiAgZml0UG9seW5vbWlhbCxcbiAgZml0TGluZSxcbiAgZml0T3J0aG9MaW5lMixcbiAgZml0Q2lyY2xlMixcbiAgY292YXJpYW5jZTMsXG4gIHN5bW1ldHJpY0VpZ2VuMyxcbiAgZml0UGxhbmUsXG4gIGZpdE9ydGhvTGluZTMsXG59IGZyb20gJy4vbGVhc3Qtc3F1YXJlcy50cyc7XG5pbXBvcnQgdHlwZSB7IFZlYzIgfSBmcm9tICcuL3ZlYzIudHMnO1xuaW1wb3J0IHR5cGUgeyBWZWMzIH0gZnJvbSAnLi92ZWMzLnRzJztcblxuLy8gRGV0ZXJtaW5pc3RpYyBwc2V1ZG8tcmFuZG9tIG5vaXNlIHNvIGEgZmFpbHVyZSBpcyBhbHdheXMgcmVwcm9kdWNpYmxlLlxuZnVuY3Rpb24gbXVsYmVycnkzMihzZWVkOiBudW1iZXIpOiAoKSA9PiBudW1iZXIge1xuICBsZXQgYSA9IHNlZWQgPj4+IDA7XG4gIHJldHVybiAoKSA9PiB7XG4gICAgYSA9IChhICsgMHg2ZDJiNzlmNSkgPj4+IDA7XG4gICAgbGV0IHQgPSBNYXRoLmltdWwoYSBeIChhID4+PiAxNSksIDEgfCBhKTtcbiAgICB0ID0gKHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgNjEgfCB0KSkgXiB0O1xuICAgIHJldHVybiAoKHQgXiAodCA+Pj4gMTQpKSA+Pj4gMCkgLyA0Mjk0OTY3Mjk2O1xuICB9O1xufVxuXG50ZXN0KCdzb2x2ZUxpbmVhciBzb2x2ZXMgYSBzcXVhcmUgc3lzdGVtIGV4YWN0bHknLCAoKSA9PiB7XG4gIGNvbnN0IHggPSBzb2x2ZUxpbmVhcihbWzIsIDFdLCBbMSwgLTFdXSwgWzUsIDFdKTtcbiAgYXNzZXJ0Lm9rKHgpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoeFswXSAtIDIpIDwgMWUtMTIpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoeFsxXSAtIDEpIDwgMWUtMTIpO1xufSk7XG5cbnRlc3QoJ3NvbHZlTGluZWFyIHBpdm90cywgc28gYSB6ZXJvIGxlYWRpbmcgZW50cnkgaXMgZmluZScsICgpID0+IHtcbiAgY29uc3QgeCA9IHNvbHZlTGluZWFyKFtbMCwgMV0sIFsxLCAwXV0sIFszLCA0XSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoeCwgWzQsIDNdKTtcbn0pO1xuXG50ZXN0KCdzb2x2ZUxpbmVhciByZXR1cm5zIG51bGwgZm9yIGEgc2luZ3VsYXIgbWF0cml4JywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoc29sdmVMaW5lYXIoW1sxLCAyXSwgWzIsIDRdXSwgWzEsIDJdKSwgbnVsbCk7XG4gIGFzc2VydC5lcXVhbChzb2x2ZUxpbmVhcihbWzAsIDBdLCBbMCwgMF1dLCBbMSwgMV0pLCBudWxsKTtcbn0pO1xuXG50ZXN0KCdzb2x2ZUxpbmVhciByZWplY3RzIGEgbm9uLXNxdWFyZSBtYXRyaXggb3IgYSBtaXNtYXRjaGVkIGInLCAoKSA9PiB7XG4gIGFzc2VydC50aHJvd3MoKCkgPT4gc29sdmVMaW5lYXIoW1sxLCAyLCAzXSwgWzQsIDUsIDZdXSwgWzEsIDJdKSwgUmFuZ2VFcnJvcik7XG4gIGFzc2VydC50aHJvd3MoKCkgPT4gc29sdmVMaW5lYXIoW1sxLCAwXSwgWzAsIDFdXSwgWzFdKSwgUmFuZ2VFcnJvcik7XG59KTtcblxudGVzdCgndHJhbnNwb3NlIGFuZCBtYXRWZWMnLCAoKSA9PiB7XG4gIGFzc2VydC5kZWVwRXF1YWwodHJhbnNwb3NlKFtbMSwgMiwgM10sIFs0LCA1LCA2XV0pLCBbWzEsIDRdLCBbMiwgNV0sIFszLCA2XV0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKG1hdFZlYyhbWzEsIDJdLCBbMywgNF1dLCBbMSwgMV0pLCBbMywgN10pO1xuICBhc3NlcnQudGhyb3dzKCgpID0+IG1hdFZlYyhbWzEsIDJdXSwgWzEsIDIsIDNdKSwgUmFuZ2VFcnJvcik7XG4gIGFzc2VydC50aHJvd3MoKCkgPT4gdHJhbnNwb3NlKFtbMSwgMl0sIFszXV0pLCBSYW5nZUVycm9yKTtcbn0pO1xuXG50ZXN0KCdzb2x2ZUxlYXN0U3F1YXJlcyByZXByb2R1Y2VzIGFuIGV4YWN0bHktY29uc2lzdGVudCBvdmVyZGV0ZXJtaW5lZCBzeXN0ZW0nLCAoKSA9PiB7XG4gIGNvbnN0IGEgPSBbWzEsIDBdLCBbMSwgMV0sIFsxLCAyXV07XG4gIGNvbnN0IGIgPSBbMSwgMywgNV07XG4gIGNvbnN0IHggPSBzb2x2ZUxlYXN0U3F1YXJlcyhhLCBiKTtcbiAgYXNzZXJ0Lm9rKHgpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoeFswXSAtIDEpIDwgMWUtMTIpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoeFsxXSAtIDIpIDwgMWUtMTIpO1xuICBhc3NlcnQub2socm1zKHJlc2lkdWFscyhhLCB4LCBiKSkgPCAxZS0xMik7XG59KTtcblxudGVzdCgnc29sdmVMZWFzdFNxdWFyZXMgbWluaW1pc2VzIHRoZSByZXNpZHVhbCBvbiBhbiBpbmNvbnNpc3RlbnQgc3lzdGVtJywgKCkgPT4ge1xuICBjb25zdCBhID0gW1sxXSwgWzFdLCBbMV1dO1xuICBjb25zdCB4ID0gc29sdmVMZWFzdFNxdWFyZXMoYSwgWzEsIDIsIDZdKTtcbiAgYXNzZXJ0Lm9rKHgpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoeFswXSAtIDMpIDwgMWUtMTIpO1xufSk7XG5cbnRlc3QoJ3NvbHZlTGVhc3RTcXVhcmVzIHJldHVybnMgbnVsbCBvbiBhIHJhbmstZGVmaWNpZW50IHN5c3RlbSwgYW5kIGEgcmlkZ2UgcmVzY3VlcyBpdCcsICgpID0+IHtcbiAgLy8gVGhlIHNlY29uZCBjb2x1bW4gaXMgYSBjb3B5IG9mIHRoZSBmaXJzdCwgc28gdGhlIG5vcm1hbCBtYXRyaXggaXMgc2luZ3VsYXIuXG4gIGNvbnN0IGEgPSBbWzEsIDFdLCBbMiwgMl0sIFszLCAzXV07XG4gIGNvbnN0IGIgPSBbMSwgMiwgM107XG4gIGFzc2VydC5lcXVhbChzb2x2ZUxlYXN0U3F1YXJlcyhhLCBiKSwgbnVsbCk7XG4gIGNvbnN0IHJpZGdlZCA9IHNvbHZlTGVhc3RTcXVhcmVzKGEsIGIsIDFlLTYpO1xuICBhc3NlcnQub2socmlkZ2VkKTtcbiAgLy8gVGhlIHJpZGdlIHNwbGl0cyB0aGUgc2hhcmVkIHNsb3BlIGJldHdlZW4gYm90aCBpZGVudGljYWwgY29sdW1ucy5cbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKHJpZGdlZFswXSArIHJpZGdlZFsxXSAtIDEpIDwgMWUtNCk7XG59KTtcblxudGVzdCgncm1zIG9mIGFuIGVtcHR5IHJlc2lkdWFsIHZlY3RvciBpcyAwJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwocm1zKFtdKSwgMCk7XG4gIGFzc2VydC5lcXVhbChybXMoWzMsIDRdKSwgTWF0aC5zcXJ0KDEyLjUpKTtcbn0pO1xuXG50ZXN0KCdldmFsUG9seW5vbWlhbCB1c2VzIGFzY2VuZGluZyBjb2VmZmljaWVudCBvcmRlcicsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKGV2YWxQb2x5bm9taWFsKFsxLCAyLCAzXSwgMiksIDE3KTtcbiAgYXNzZXJ0LmVxdWFsKGV2YWxQb2x5bm9taWFsKFtdLCA1KSwgMCk7XG4gIGFzc2VydC5lcXVhbChldmFsUG9seW5vbWlhbChbN10sIDUpLCA3KTtcbn0pO1xuXG50ZXN0KCdmaXRQb2x5bm9taWFsIHJlY292ZXJzIGFuIGV4YWN0IGN1YmljJywgKCkgPT4ge1xuICBjb25zdCB0cnV0aCA9IFsyLCAtMywgMC41LCAxXTtcbiAgY29uc3QgeHMgPSBbLTMsIC0yLCAtMSwgMCwgMSwgMiwgMywgNF07XG4gIGNvbnN0IHlzID0geHMubWFwKCh4KSA9PiBldmFsUG9seW5vbWlhbCh0cnV0aCwgeCkpO1xuICBjb25zdCBmaXQgPSBmaXRQb2x5bm9taWFsKHhzLCB5cywgMyk7XG4gIGFzc2VydC5vayhmaXQpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHRydXRoLmxlbmd0aDsgaSsrKSB7XG4gICAgYXNzZXJ0Lm9rKE1hdGguYWJzKGZpdFtpXSAtIHRydXRoW2ldKSA8IDFlLTksIGBjb2VmZmljaWVudCAke2l9OiAke2ZpdFtpXX0gdnMgJHt0cnV0aFtpXX1gKTtcbiAgfVxufSk7XG5cbnRlc3QoJ2ZpdFBvbHlub21pYWwgc3RheXMgYWNjdXJhdGUgb24geCB2YWx1ZXMgZmFyIGZyb20gdGhlIG9yaWdpbicsICgpID0+IHtcbiAgLy8gQSByYXcgVmFuZGVybW9uZGUgbWF0cml4IG9uIHggbmVhciAxZTYgbG9zZXMgdGhlIHF1YWRyYXRpYyB0ZXJtLlxuICBjb25zdCB0cnV0aCA9IFs1LCAtMiwgMC4yNV07XG4gIGNvbnN0IHhzID0gWzFlNiwgMWU2ICsgMSwgMWU2ICsgMiwgMWU2ICsgMywgMWU2ICsgNF07XG4gIGNvbnN0IHlzID0geHMubWFwKCh4KSA9PiBldmFsUG9seW5vbWlhbCh0cnV0aCwgeCkpO1xuICBjb25zdCBmaXQgPSBmaXRQb2x5bm9taWFsKHhzLCB5cywgMik7XG4gIGFzc2VydC5vayhmaXQpO1xuICAvLyBDb21wYXJlIHRocm91Z2ggdGhlIG1vZGVsIHJhdGhlciB0aGFuIGNvZWZmaWNpZW50IGJ5IGNvZWZmaWNpZW50OiB0aGVcbiAgLy8gY29uc3RhbnQgdGVybSBhdCB0aGlzIG9mZnNldCBpcyBlbm9ybW91cyBhbmQgY2FycmllcyB0aGUgcm91bmQtb2ZmLlxuICBmb3IgKGNvbnN0IHggb2YgeHMpIHtcbiAgICBjb25zdCBwcmVkaWN0ZWQgPSBldmFsUG9seW5vbWlhbChmaXQsIHgpO1xuICAgIGNvbnN0IGV4cGVjdGVkID0gZXZhbFBvbHlub21pYWwodHJ1dGgsIHgpO1xuICAgIGFzc2VydC5vayhNYXRoLmFicyhwcmVkaWN0ZWQgLSBleHBlY3RlZCkgPCBNYXRoLmFicyhleHBlY3RlZCkgKiAxZS02ICsgMWUtNik7XG4gIH1cbn0pO1xuXG50ZXN0KCdmaXRQb2x5bm9taWFsIG9mIGRlZ3JlZSAwIGlzIHRoZSBtZWFuJywgKCkgPT4ge1xuICBjb25zdCBmaXQgPSBmaXRQb2x5bm9taWFsKFswLCAxLCAyXSwgWzEsIDIsIDZdLCAwKTtcbiAgYXNzZXJ0Lm9rKGZpdCk7XG4gIGFzc2VydC5vayhNYXRoLmFicyhmaXRbMF0gLSAzKSA8IDFlLTEyKTtcbn0pO1xuXG50ZXN0KCdmaXRQb2x5bm9taWFsIHJlamVjdHMgdG9vIGZldyBwb2ludHMgYW5kIGEgYmFkIGRlZ3JlZScsICgpID0+IHtcbiAgYXNzZXJ0LnRocm93cygoKSA9PiBmaXRQb2x5bm9taWFsKFswLCAxXSwgWzAsIDFdLCAyKSwgUmFuZ2VFcnJvcik7XG4gIGFzc2VydC50aHJvd3MoKCkgPT4gZml0UG9seW5vbWlhbChbMCwgMV0sIFswXSwgMSksIFJhbmdlRXJyb3IpO1xuICBhc3NlcnQudGhyb3dzKCgpID0+IGZpdFBvbHlub21pYWwoWzAsIDFdLCBbMCwgMV0sIC0xKSwgUmFuZ2VFcnJvcik7XG59KTtcblxudGVzdCgnZml0TGluZSByZWNvdmVycyBhIGtub3duIHNsb3BlIGFuZCBpbnRlcmNlcHQsIHdpdGggemVybyBybXMgb24gZXhhY3QgZGF0YScsICgpID0+IHtcbiAgY29uc3QgeHMgPSBbMCwgMSwgMiwgMywgNF07XG4gIGNvbnN0IHlzID0geHMubWFwKCh4KSA9PiAzICogeCAtIDIpO1xuICBjb25zdCBmaXQgPSBmaXRMaW5lKHhzLCB5cyk7XG4gIGFzc2VydC5vayhmaXQpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoZml0LnNsb3BlIC0gMykgPCAxZS0xMik7XG4gIGFzc2VydC5vayhNYXRoLmFicyhmaXQuaW50ZXJjZXB0ICsgMikgPCAxZS0xMik7XG4gIGFzc2VydC5vayhmaXQucm1zIDwgMWUtMTIpO1xufSk7XG5cbnRlc3QoJ2ZpdExpbmUgc3RheXMgbmVhciB0aGUgZ2VuZXJhdG9yIHVuZGVyIG5vaXNlJywgKCkgPT4ge1xuICBjb25zdCByYW5kID0gbXVsYmVycnkzMig3KTtcbiAgY29uc3QgeHM6IG51bWJlcltdID0gW107XG4gIGNvbnN0IHlzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDQwMDsgaSsrKSB7XG4gICAgY29uc3QgeCA9IGkgLyA0MDtcbiAgICB4cy5wdXNoKHgpO1xuICAgIHlzLnB1c2goMS41ICogeCArIDQgKyAocmFuZCgpIC0gMC41KSAqIDAuMik7XG4gIH1cbiAgY29uc3QgZml0ID0gZml0TGluZSh4cywgeXMpO1xuICBhc3NlcnQub2soZml0KTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGZpdC5zbG9wZSAtIDEuNSkgPCAwLjAyLCBgc2xvcGUgJHtmaXQuc2xvcGV9YCk7XG4gIGFzc2VydC5vayhNYXRoLmFicyhmaXQuaW50ZXJjZXB0IC0gNCkgPCAwLjA1LCBgaW50ZXJjZXB0ICR7Zml0LmludGVyY2VwdH1gKTtcbiAgYXNzZXJ0Lm9rKGZpdC5ybXMgPCAwLjEpO1xufSk7XG5cbnRlc3QoJ2ZpdExpbmUgcmV0dXJucyBudWxsIGZvciB2ZXJ0aWNhbCBkYXRhIGFuZCByZWplY3RzIG1pc21hdGNoZWQgaW5wdXQnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChmaXRMaW5lKFsyLCAyLCAyXSwgWzAsIDEsIDJdKSwgbnVsbCk7XG4gIGFzc2VydC50aHJvd3MoKCkgPT4gZml0TGluZShbMCwgMV0sIFswXSksIFJhbmdlRXJyb3IpO1xuICBhc3NlcnQudGhyb3dzKCgpID0+IGZpdExpbmUoWzBdLCBbMF0pLCBSYW5nZUVycm9yKTtcbn0pO1xuXG50ZXN0KCdmaXRPcnRob0xpbmUyIGhhbmRsZXMgdGhlIHZlcnRpY2FsIGxpbmUgdGhhdCBmaXRMaW5lIGNhbm5vdCcsICgpID0+IHtcbiAgY29uc3QgcG9pbnRzOiBWZWMyW10gPSBbWzIsIC0xXSwgWzIsIDBdLCBbMiwgMV0sIFsyLCA1XV07XG4gIGNvbnN0IGZpdCA9IGZpdE9ydGhvTGluZTIocG9pbnRzKTtcbiAgYXNzZXJ0Lm9rKGZpdCk7XG4gIGFzc2VydC5vayhmaXQucm1zIDwgMWUtMTIpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoTWF0aC5hYnMoZml0LmRpcmVjdGlvblsxXSkgLSAxKSA8IDFlLTEyKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGZpdC5kaXJlY3Rpb25bMF0pIDwgMWUtMTIpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoZml0LnBvaW50WzBdIC0gMikgPCAxZS0xMik7XG59KTtcblxudGVzdCgnZml0T3J0aG9MaW5lMiByZWNvdmVycyBhIGRpYWdvbmFsIGxpbmUgZXhhY3RseScsICgpID0+IHtcbiAgY29uc3QgcG9pbnRzOiBWZWMyW10gPSBbWzAsIDBdLCBbMSwgMV0sIFsyLCAyXSwgWzMsIDNdXTtcbiAgY29uc3QgZml0ID0gZml0T3J0aG9MaW5lMihwb2ludHMpO1xuICBhc3NlcnQub2soZml0KTtcbiAgYXNzZXJ0Lm9rKGZpdC5ybXMgPCAxZS0xMik7XG4gIGNvbnN0IGQgPSBmaXQuZGlyZWN0aW9uO1xuICBhc3NlcnQub2soTWF0aC5hYnMoTWF0aC5hYnMoZFswXSkgLSBNYXRoLlNRUlQxXzIpIDwgMWUtMTIpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoTWF0aC5hYnMoZFsxXSkgLSBNYXRoLlNRUlQxXzIpIDwgMWUtMTIpO1xuICAvLyBCb3RoIGNvb3JkaW5hdGVzIGNhcnJ5IHRoZSBzYW1lIHNpZ24gb24gYSA0NS1kZWdyZWUgbGluZS5cbiAgYXNzZXJ0Lm9rKGRbMF0gKiBkWzFdID4gMCk7XG59KTtcblxudGVzdCgnZml0T3J0aG9MaW5lMiByZWplY3RzIGRlZ2VuZXJhdGUgaW5wdXQnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChmaXRPcnRob0xpbmUyKFtbMSwgMV1dKSwgbnVsbCk7XG4gIGFzc2VydC5lcXVhbChmaXRPcnRob0xpbmUyKFtbMSwgMV0sIFsxLCAxXSwgWzEsIDFdXSksIG51bGwpO1xufSk7XG5cbnRlc3QoJ2ZpdENpcmNsZTIgcmVjb3ZlcnMgYSBrbm93biBjaXJjbGUgZXhhY3RseScsICgpID0+IHtcbiAgY29uc3QgY2VudGVyOiBWZWMyID0gWy0zLCA0XTtcbiAgY29uc3QgcmFkaXVzID0gMi41O1xuICBjb25zdCBwb2ludHM6IFZlYzJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDEyOyBpKyspIHtcbiAgICBjb25zdCB0ID0gKGkgLyAxMikgKiAyICogTWF0aC5QSTtcbiAgICBwb2ludHMucHVzaChbY2VudGVyWzBdICsgcmFkaXVzICogTWF0aC5jb3ModCksIGNlbnRlclsxXSArIHJhZGl1cyAqIE1hdGguc2luKHQpXSk7XG4gIH1cbiAgY29uc3QgZml0ID0gZml0Q2lyY2xlMihwb2ludHMpO1xuICBhc3NlcnQub2soZml0KTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGZpdC5jZW50ZXJbMF0gLSBjZW50ZXJbMF0pIDwgMWUtMTApO1xuICBhc3NlcnQub2soTWF0aC5hYnMoZml0LmNlbnRlclsxXSAtIGNlbnRlclsxXSkgPCAxZS0xMCk7XG4gIGFzc2VydC5vayhNYXRoLmFicyhmaXQucmFkaXVzIC0gcmFkaXVzKSA8IDFlLTEwKTtcbiAgYXNzZXJ0Lm9rKGZpdC5ybXMgPCAxZS0xMCk7XG59KTtcblxudGVzdCgnZml0Q2lyY2xlMiB3b3JrcyBmcm9tIGEgc2hvcnQgYXJjIGFuZCByZXBvcnRzIGEgcmVhbCBnZW9tZXRyaWMgcm1zJywgKCkgPT4ge1xuICBjb25zdCBwb2ludHM6IFZlYzJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDg7IGkrKykge1xuICAgIGNvbnN0IHQgPSAoaSAvIDQwKSAqIDIgKiBNYXRoLlBJO1xuICAgIHBvaW50cy5wdXNoKFsxMCAqIE1hdGguY29zKHQpLCAxMCAqIE1hdGguc2luKHQpXSk7XG4gIH1cbiAgY29uc3QgZml0ID0gZml0Q2lyY2xlMihwb2ludHMpO1xuICBhc3NlcnQub2soZml0KTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGZpdC5yYWRpdXMgLSAxMCkgPCAxZS02LCBgcmFkaXVzICR7Zml0LnJhZGl1c31gKTtcbiAgYXNzZXJ0Lm9rKGZpdC5ybXMgPCAxZS02KTtcbn0pO1xuXG50ZXN0KCdmaXRDaXJjbGUyIHJlamVjdHMgZmV3ZXIgdGhhbiB0aHJlZSBwb2ludHMgYW5kIGNvbGxpbmVhciBwb2ludHMnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChmaXRDaXJjbGUyKFtbMCwgMF0sIFsxLCAxXV0pLCBudWxsKTtcbiAgYXNzZXJ0LmVxdWFsKGZpdENpcmNsZTIoW1swLCAwXSwgWzEsIDFdLCBbMiwgMl0sIFszLCAzXV0pLCBudWxsKTtcbn0pO1xuXG50ZXN0KCdjb3ZhcmlhbmNlMyByZXBvcnRzIHRoZSBtZWFuIGFuZCBhIHN5bW1ldHJpYyBtYXRyaXgnLCAoKSA9PiB7XG4gIGNvbnN0IHBvaW50czogVmVjM1tdID0gW1sxLCAwLCAwXSwgWy0xLCAwLCAwXSwgWzAsIDIsIDBdLCBbMCwgLTIsIDBdXTtcbiAgY29uc3QgeyBtZWFuLCBtYXRyaXggfSA9IGNvdmFyaWFuY2UzKHBvaW50cyk7XG4gIGFzc2VydC5kZWVwRXF1YWwobWVhbiwgWzAsIDAsIDBdKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKG1hdHJpeFswXVswXSAtIDAuNSkgPCAxZS0xMik7XG4gIGFzc2VydC5vayhNYXRoLmFicyhtYXRyaXhbMV1bMV0gLSAyKSA8IDFlLTEyKTtcbiAgYXNzZXJ0LmVxdWFsKG1hdHJpeFsyXVsyXSwgMCk7XG4gIGFzc2VydC5lcXVhbChtYXRyaXhbMF1bMV0sIG1hdHJpeFsxXVswXSk7XG4gIGFzc2VydC50aHJvd3MoKCkgPT4gY292YXJpYW5jZTMoW10pLCBSYW5nZUVycm9yKTtcbn0pO1xuXG50ZXN0KCdzeW1tZXRyaWNFaWdlbjMgZGlhZ29uYWxpc2VzIGEgZGlhZ29uYWwgbWF0cml4LCBhc2NlbmRpbmcnLCAoKSA9PiB7XG4gIGNvbnN0IHsgdmFsdWVzLCB2ZWN0b3JzIH0gPSBzeW1tZXRyaWNFaWdlbjMoW1szLCAwLCAwXSwgWzAsIDEsIDBdLCBbMCwgMCwgMl1dKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKHZhbHVlc1swXSAtIDEpIDwgMWUtMTIpO1xuICBhc3NlcnQub2soTWF0aC5hYnModmFsdWVzWzFdIC0gMikgPCAxZS0xMik7XG4gIGFzc2VydC5vayhNYXRoLmFicyh2YWx1ZXNbMl0gLSAzKSA8IDFlLTEyKTtcbiAgLy8gVGhlIGVpZ2VudmVjdG9ycyBhcmUgdGhlIGF4ZXMsIGluIHRoZSBzYW1lIG9yZGVyIGFzIHRoZSB2YWx1ZXMuXG4gIGFzc2VydC5vayhNYXRoLmFicyhNYXRoLmFicyh2ZWN0b3JzWzBdWzFdKSAtIDEpIDwgMWUtMTIpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoTWF0aC5hYnModmVjdG9yc1sxXVsyXSkgLSAxKSA8IDFlLTEyKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKE1hdGguYWJzKHZlY3RvcnNbMl1bMF0pIC0gMSkgPCAxZS0xMik7XG59KTtcblxudGVzdCgnc3ltbWV0cmljRWlnZW4zIGVpZ2VudmVjdG9ycyBzYXRpc2Z5IEEgdiA9IGxhbWJkYSB2IGFuZCBhcmUgb3J0aG9ub3JtYWwnLCAoKSA9PiB7XG4gIGNvbnN0IG0gPSBbXG4gICAgWzQsIDEsIC0yXSxcbiAgICBbMSwgMiwgMF0sXG4gICAgWy0yLCAwLCAzXSxcbiAgXTtcbiAgY29uc3QgeyB2YWx1ZXMsIHZlY3RvcnMgfSA9IHN5bW1ldHJpY0VpZ2VuMyhtKTtcbiAgZm9yIChsZXQgayA9IDA7IGsgPCAzOyBrKyspIHtcbiAgICBjb25zdCB2ID0gdmVjdG9yc1trXTtcbiAgICBhc3NlcnQub2soTWF0aC5hYnMoTWF0aC5oeXBvdCh2WzBdLCB2WzFdLCB2WzJdKSAtIDEpIDwgMWUtMTIsICd1bml0IGxlbmd0aCcpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMzsgaSsrKSB7XG4gICAgICBjb25zdCBhdiA9IG1baV1bMF0gKiB2WzBdICsgbVtpXVsxXSAqIHZbMV0gKyBtW2ldWzJdICogdlsyXTtcbiAgICAgIGFzc2VydC5vayhNYXRoLmFicyhhdiAtIHZhbHVlc1trXSAqIHZbaV0pIDwgMWUtOSwgYHJvdyAke2l9IG9mIGVpZ2VucGFpciAke2t9YCk7XG4gICAgfVxuICB9XG4gIGNvbnN0IHBhaXJzOiBbbnVtYmVyLCBudW1iZXJdW10gPSBbWzAsIDFdLCBbMCwgMl0sIFsxLCAyXV07XG4gIGZvciAoY29uc3QgW2ksIGpdIG9mIHBhaXJzKSB7XG4gICAgY29uc3QgZCA9XG4gICAgICB2ZWN0b3JzW2ldWzBdICogdmVjdG9yc1tqXVswXSArIHZlY3RvcnNbaV1bMV0gKiB2ZWN0b3JzW2pdWzFdICsgdmVjdG9yc1tpXVsyXSAqIHZlY3RvcnNbal1bMl07XG4gICAgYXNzZXJ0Lm9rKE1hdGguYWJzKGQpIDwgMWUtOSwgYG9ydGhvZ29uYWxpdHkgb2YgJHtpfSwke2p9YCk7XG4gIH1cbiAgLy8gVGhlIHRyYWNlIGlzIHByZXNlcnZlZC5cbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKHZhbHVlc1swXSArIHZhbHVlc1sxXSArIHZhbHVlc1syXSAtIDkpIDwgMWUtOSk7XG4gIGFzc2VydC5vayh2YWx1ZXNbMF0gPD0gdmFsdWVzWzFdICYmIHZhbHVlc1sxXSA8PSB2YWx1ZXNbMl0pO1xufSk7XG5cbnRlc3QoJ3N5bW1ldHJpY0VpZ2VuMyByZWplY3RzIGEgbWF0cml4IHRoYXQgaXMgbm90IDN4MycsICgpID0+IHtcbiAgYXNzZXJ0LnRocm93cygoKSA9PiBzeW1tZXRyaWNFaWdlbjMoW1sxLCAwXSwgWzAsIDFdXSksIFJhbmdlRXJyb3IpO1xufSk7XG5cbnRlc3QoJ2ZpdFBsYW5lIHJlY292ZXJzIGEgdGlsdGVkIHBsYW5lIGV4YWN0bHknLCAoKSA9PiB7XG4gIGNvbnN0IHBvaW50czogVmVjM1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgNTsgaSsrKSB7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCA1OyBqKyspIHtcbiAgICAgIGNvbnN0IHggPSBpIC0gMjtcbiAgICAgIGNvbnN0IHkgPSBqIC0gMjtcbiAgICAgIHBvaW50cy5wdXNoKFt4LCB5LCAyICogeCAtIHkgKyAzXSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IGZpdCA9IGZpdFBsYW5lKHBvaW50cyk7XG4gIGFzc2VydC5vayhmaXQpO1xuICBhc3NlcnQub2soZml0LnJtcyA8IDFlLTEyKTtcbiAgY29uc3QgZXhwZWN0ZWQgPSBbMiwgLTEsIC0xXS5tYXAoKGMpID0+IGMgLyBNYXRoLmh5cG90KDIsIDEsIDEpKTtcbiAgY29uc3QgZG90QWJzID0gTWF0aC5hYnMoXG4gICAgZml0Lm5vcm1hbFswXSAqIGV4cGVjdGVkWzBdICsgZml0Lm5vcm1hbFsxXSAqIGV4cGVjdGVkWzFdICsgZml0Lm5vcm1hbFsyXSAqIGV4cGVjdGVkWzJdLFxuICApO1xuICBhc3NlcnQub2soTWF0aC5hYnMoZG90QWJzIC0gMSkgPCAxZS05LCBgbm9ybWFsICR7Zml0Lm5vcm1hbH1gKTtcbiAgLy8gVGhlIHBsYW5lIHBhc3NlcyB0aHJvdWdoIHRoZSBjZW50cm9pZCwgc28gdGhlIHBvaW50IHNhdGlzZmllcyB0aGUgZXF1YXRpb24uXG4gIGFzc2VydC5vayhNYXRoLmFicyhmaXQucG9pbnRbMl0gLSAoMiAqIGZpdC5wb2ludFswXSAtIGZpdC5wb2ludFsxXSArIDMpKSA8IDFlLTkpO1xufSk7XG5cbnRlc3QoJ2ZpdFBsYW5lIHN0YXlzIG5lYXIgdGhlIGdlbmVyYXRvciB1bmRlciBub2lzZScsICgpID0+IHtcbiAgY29uc3QgcmFuZCA9IG11bGJlcnJ5MzIoMTEpO1xuICBjb25zdCBwb2ludHM6IFZlYzNbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDYwMDsgaSsrKSB7XG4gICAgY29uc3QgeCA9IHJhbmQoKSAqIDEwIC0gNTtcbiAgICBjb25zdCB5ID0gcmFuZCgpICogMTAgLSA1O1xuICAgIHBvaW50cy5wdXNoKFt4LCB5LCAwLjUgKiB4ICsgMC4yNSAqIHkgKyAxICsgKHJhbmQoKSAtIDAuNSkgKiAwLjA1XSk7XG4gIH1cbiAgY29uc3QgZml0ID0gZml0UGxhbmUocG9pbnRzKTtcbiAgYXNzZXJ0Lm9rKGZpdCk7XG4gIGNvbnN0IGV4cGVjdGVkID0gWzAuNSwgMC4yNSwgLTFdLm1hcCgoYykgPT4gYyAvIE1hdGguaHlwb3QoMC41LCAwLjI1LCAxKSk7XG4gIGNvbnN0IGRvdEFicyA9IE1hdGguYWJzKFxuICAgIGZpdC5ub3JtYWxbMF0gKiBleHBlY3RlZFswXSArIGZpdC5ub3JtYWxbMV0gKiBleHBlY3RlZFsxXSArIGZpdC5ub3JtYWxbMl0gKiBleHBlY3RlZFsyXSxcbiAgKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGRvdEFicyAtIDEpIDwgMWUtMywgYG5vcm1hbCAke2ZpdC5ub3JtYWx9YCk7XG4gIGFzc2VydC5vayhmaXQucm1zIDwgMC4wNSk7XG59KTtcblxudGVzdCgnZml0UGxhbmUgcmV0dXJucyBudWxsIGZvciBjb2xsaW5lYXIgcG9pbnRzOiB0aGVpciBub3JtYWwgaXMgYXJiaXRyYXJ5JywgKCkgPT4ge1xuICBjb25zdCBwb2ludHM6IFZlYzNbXSA9IFtbMCwgMCwgMF0sIFsxLCAxLCAxXSwgWzIsIDIsIDJdLCBbMywgMywgM11dO1xuICBhc3NlcnQuZXF1YWwoZml0UGxhbmUocG9pbnRzKSwgbnVsbCk7XG4gIGFzc2VydC5lcXVhbChmaXRQbGFuZShbWzAsIDAsIDBdLCBbMSwgMCwgMF1dKSwgbnVsbCk7XG59KTtcblxudGVzdCgnZml0T3J0aG9MaW5lMyByZWNvdmVycyBhIDNEIGxpbmUgZXhhY3RseScsICgpID0+IHtcbiAgY29uc3QgZGlyZWN0aW9uID0gWzEsIDIsIC0yXS5tYXAoKGMpID0+IGMgLyAzKTtcbiAgY29uc3QgcG9pbnRzOiBWZWMzW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IC00OyBpIDw9IDQ7IGkrKykge1xuICAgIHBvaW50cy5wdXNoKFsxICsgZGlyZWN0aW9uWzBdICogaSwgLTIgKyBkaXJlY3Rpb25bMV0gKiBpLCA1ICsgZGlyZWN0aW9uWzJdICogaV0pO1xuICB9XG4gIGNvbnN0IGZpdCA9IGZpdE9ydGhvTGluZTMocG9pbnRzKTtcbiAgYXNzZXJ0Lm9rKGZpdCk7XG4gIGFzc2VydC5vayhmaXQucm1zIDwgMWUtMTIpO1xuICBjb25zdCBkb3RBYnMgPSBNYXRoLmFicyhcbiAgICBmaXQuZGlyZWN0aW9uWzBdICogZGlyZWN0aW9uWzBdICsgZml0LmRpcmVjdGlvblsxXSAqIGRpcmVjdGlvblsxXSArIGZpdC5kaXJlY3Rpb25bMl0gKiBkaXJlY3Rpb25bMl0sXG4gICk7XG4gIGFzc2VydC5vayhNYXRoLmFicyhkb3RBYnMgLSAxKSA8IDFlLTkpO1xuICAvLyBUaGUgY2VudHJvaWQgb2YgYSBzeW1tZXRyaWMgc2FtcGxlIGlzIHRoZSBsaW5lJ3Mgb3duIGFuY2hvciBwb2ludC5cbiAgYXNzZXJ0Lm9rKE1hdGguaHlwb3QoZml0LnBvaW50WzBdIC0gMSwgZml0LnBvaW50WzFdICsgMiwgZml0LnBvaW50WzJdIC0gNSkgPCAxZS05KTtcbn0pO1xuXG50ZXN0KCdmaXRPcnRob0xpbmUzIHJtcyBpcyB0aGUgb3J0aG9nb25hbCBkaXN0YW5jZSwgbm90IGEgdmVydGljYWwgcmVzaWR1YWwnLCAoKSA9PiB7XG4gIGNvbnN0IHBvaW50czogVmVjM1tdID0gW1swLCAwLCAwXSwgWzEsIDEsIDBdLCBbMiwgMCwgMF0sIFszLCAtMSwgMF1dO1xuICBjb25zdCBmaXQgPSBmaXRPcnRob0xpbmUzKHBvaW50cyk7XG4gIGFzc2VydC5vayhmaXQpO1xuICBhc3NlcnQub2soZml0LnJtcyA+IDApO1xuICAvLyBFdmVyeSByZXNpZHVhbCBtdXN0IGJlIGF0IG1vc3QgdGhlIGxhcmdlc3Qgb2Zmc2V0LlxuICBhc3NlcnQub2soZml0LnJtcyA8PSAxICsgMWUtMTIpO1xufSk7XG5cbnRlc3QoJ2ZpdE9ydGhvTGluZTMgcmVqZWN0cyBkZWdlbmVyYXRlIGlucHV0JywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoZml0T3J0aG9MaW5lMyhbWzEsIDIsIDNdXSksIG51bGwpO1xuICBhc3NlcnQuZXF1YWwoZml0T3J0aG9MaW5lMyhbWzEsIDIsIDNdLCBbMSwgMiwgM11dKSwgbnVsbCk7XG59KTtcbiIsICIvLyBMZWFzdC1zcXVhcmVzIGZpdHRpbmcuIFB1cmUsIGRlcGVuZGVuY3ktZnJlZSwgbm8gRE9NL0dQVS5cblxuaW1wb3J0IHR5cGUgeyBWZWMyIH0gZnJvbSAnLi92ZWMyLnRzJztcbmltcG9ydCB0eXBlIHsgVmVjMyB9IGZyb20gJy4vdmVjMy50cyc7XG5cbi8vIFJvdy1tYWpvcjogbWF0cml4W3Jvd11bY29sXS4gRXZlcnkgcm93IG11c3QgaGF2ZSB0aGUgc2FtZSBsZW5ndGguXG5leHBvcnQgdHlwZSBNYXRyaXggPSByZWFkb25seSAocmVhZG9ubHkgbnVtYmVyW10pW107XG5cbmV4cG9ydCB0eXBlIExpbmVGaXQyID0geyBzbG9wZTogbnVtYmVyOyBpbnRlcmNlcHQ6IG51bWJlcjsgcm1zOiBudW1iZXIgfTtcbmV4cG9ydCB0eXBlIE9ydGhvTGluZUZpdDIgPSB7IHBvaW50OiBWZWMyOyBkaXJlY3Rpb246IFZlYzI7IHJtczogbnVtYmVyIH07XG5leHBvcnQgdHlwZSBPcnRob0xpbmVGaXQzID0geyBwb2ludDogVmVjMzsgZGlyZWN0aW9uOiBWZWMzOyBybXM6IG51bWJlciB9O1xuZXhwb3J0IHR5cGUgUGxhbmVGaXQgPSB7IHBvaW50OiBWZWMzOyBub3JtYWw6IFZlYzM7IHJtczogbnVtYmVyIH07XG5leHBvcnQgdHlwZSBDaXJjbGVGaXQyID0geyBjZW50ZXI6IFZlYzI7IHJhZGl1czogbnVtYmVyOyBybXM6IG51bWJlciB9O1xuZXhwb3J0IHR5cGUgRWlnZW4zID0geyB2YWx1ZXM6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXTsgdmVjdG9yczogW1ZlYzMsIFZlYzMsIFZlYzNdIH07XG5leHBvcnQgdHlwZSBDb3ZhcmlhbmNlMyA9IHsgbWVhbjogVmVjMzsgbWF0cml4OiBudW1iZXJbXVtdIH07XG5cbmZ1bmN0aW9uIGRpbXMoYTogTWF0cml4KTogW251bWJlciwgbnVtYmVyXSB7XG4gIGNvbnN0IHJvd3MgPSBhLmxlbmd0aDtcbiAgaWYgKHJvd3MgPT09IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdtYXRyaXggaGFzIG5vIHJvd3MnKTtcbiAgY29uc3QgY29scyA9IGFbMF0ubGVuZ3RoO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBhKSB7XG4gICAgaWYgKHJvdy5sZW5ndGggIT09IGNvbHMpIHRocm93IG5ldyBSYW5nZUVycm9yKCdtYXRyaXggcm93cyBoYXZlIHVuZXF1YWwgbGVuZ3RocycpO1xuICB9XG4gIHJldHVybiBbcm93cywgY29sc107XG59XG5cbi8vIEdhdXNzaWFuIGVsaW1pbmF0aW9uIHdpdGggcGFydGlhbCBwaXZvdGluZyBvbiBhIGNvcHkuIFJldHVybnMgbnVsbCB3aGVuIHRoZVxuLy8gbWF0cml4IGlzIHNpbmd1bGFyIHRvIHdvcmtpbmcgcHJlY2lzaW9uLlxuZXhwb3J0IGZ1bmN0aW9uIHNvbHZlTGluZWFyKGE6IE1hdHJpeCwgYjogcmVhZG9ubHkgbnVtYmVyW10pOiBudW1iZXJbXSB8IG51bGwge1xuICBjb25zdCBbcm93cywgY29sc10gPSBkaW1zKGEpO1xuICBpZiAocm93cyAhPT0gY29scykgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYHNvbHZlTGluZWFyIG5lZWRzIGEgc3F1YXJlIG1hdHJpeCwgZ290ICR7cm93c314JHtjb2xzfWApO1xuICBpZiAoYi5sZW5ndGggIT09IHJvd3MpIHRocm93IG5ldyBSYW5nZUVycm9yKGBzb2x2ZUxpbmVhcjogYiBoYXMgJHtiLmxlbmd0aH0gZW50cmllcywgd2FudCAke3Jvd3N9YCk7XG5cbiAgY29uc3QgbSA9IGEubWFwKChyb3csIGkpID0+IFsuLi5yb3csIGJbaV1dKTtcbiAgZm9yIChsZXQgY29sID0gMDsgY29sIDwgY29sczsgY29sKyspIHtcbiAgICBsZXQgcGl2b3QgPSBjb2w7XG4gICAgZm9yIChsZXQgciA9IGNvbCArIDE7IHIgPCByb3dzOyByKyspIHtcbiAgICAgIGlmIChNYXRoLmFicyhtW3JdW2NvbF0pID4gTWF0aC5hYnMobVtwaXZvdF1bY29sXSkpIHBpdm90ID0gcjtcbiAgICB9XG4gICAgaWYgKE1hdGguYWJzKG1bcGl2b3RdW2NvbF0pIDw9IE51bWJlci5FUFNJTE9OKSByZXR1cm4gbnVsbDtcbiAgICBbbVtjb2xdLCBtW3Bpdm90XV0gPSBbbVtwaXZvdF0sIG1bY29sXV07XG4gICAgY29uc3QgZGlhZyA9IG1bY29sXVtjb2xdO1xuICAgIGZvciAobGV0IHIgPSBjb2wgKyAxOyByIDwgcm93czsgcisrKSB7XG4gICAgICBjb25zdCBmYWN0b3IgPSBtW3JdW2NvbF0gLyBkaWFnO1xuICAgICAgaWYgKGZhY3RvciA9PT0gMCkgY29udGludWU7XG4gICAgICBmb3IgKGxldCBjID0gY29sOyBjIDw9IGNvbHM7IGMrKykgbVtyXVtjXSAtPSBmYWN0b3IgKiBtW2NvbF1bY107XG4gICAgfVxuICB9XG5cbiAgY29uc3QgeCA9IG5ldyBBcnJheTxudW1iZXI+KGNvbHMpLmZpbGwoMCk7XG4gIGZvciAobGV0IHIgPSBjb2xzIC0gMTsgciA+PSAwOyByLS0pIHtcbiAgICBsZXQgYWNjID0gbVtyXVtjb2xzXTtcbiAgICBmb3IgKGxldCBjID0gciArIDE7IGMgPCBjb2xzOyBjKyspIGFjYyAtPSBtW3JdW2NdICogeFtjXTtcbiAgICB4W3JdID0gYWNjIC8gbVtyXVtyXTtcbiAgfVxuICByZXR1cm4geC5ldmVyeSgodikgPT4gTnVtYmVyLmlzRmluaXRlKHYpKSA/IHggOiBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdHJhbnNwb3NlKGE6IE1hdHJpeCk6IG51bWJlcltdW10ge1xuICBjb25zdCBbcm93cywgY29sc10gPSBkaW1zKGEpO1xuICBjb25zdCBvdXQ6IG51bWJlcltdW10gPSBbXTtcbiAgZm9yIChsZXQgYyA9IDA7IGMgPCBjb2xzOyBjKyspIHtcbiAgICBjb25zdCByb3cgPSBuZXcgQXJyYXk8bnVtYmVyPihyb3dzKTtcbiAgICBmb3IgKGxldCByID0gMDsgciA8IHJvd3M7IHIrKykgcm93W3JdID0gYVtyXVtjXTtcbiAgICBvdXQucHVzaChyb3cpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXRWZWMoYTogTWF0cml4LCB4OiByZWFkb25seSBudW1iZXJbXSk6IG51bWJlcltdIHtcbiAgY29uc3QgW3Jvd3MsIGNvbHNdID0gZGltcyhhKTtcbiAgaWYgKHgubGVuZ3RoICE9PSBjb2xzKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcihgbWF0VmVjOiB4IGhhcyAke3gubGVuZ3RofSBlbnRyaWVzLCB3YW50ICR7Y29sc31gKTtcbiAgY29uc3Qgb3V0ID0gbmV3IEFycmF5PG51bWJlcj4ocm93cykuZmlsbCgwKTtcbiAgZm9yIChsZXQgciA9IDA7IHIgPCByb3dzOyByKyspIHtcbiAgICBsZXQgYWNjID0gMDtcbiAgICBmb3IgKGxldCBjID0gMDsgYyA8IGNvbHM7IGMrKykgYWNjICs9IGFbcl1bY10gKiB4W2NdO1xuICAgIG91dFtyXSA9IGFjYztcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vLyBTb2x2ZSB0aGUgbm9ybWFsIGVxdWF0aW9ucyAoQV5UIEEgKyByaWRnZSBJKSB4ID0gQV5UIGIuXG5leHBvcnQgZnVuY3Rpb24gc29sdmVMZWFzdFNxdWFyZXMoYTogTWF0cml4LCBiOiByZWFkb25seSBudW1iZXJbXSwgcmlkZ2UgPSAwKTogbnVtYmVyW10gfCBudWxsIHtcbiAgY29uc3QgW3Jvd3MsIGNvbHNdID0gZGltcyhhKTtcbiAgaWYgKGIubGVuZ3RoICE9PSByb3dzKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcihgc29sdmVMZWFzdFNxdWFyZXM6IGIgaGFzICR7Yi5sZW5ndGh9IGVudHJpZXMsIHdhbnQgJHtyb3dzfWApO1xuXG4gIGNvbnN0IG5vcm1hbDogbnVtYmVyW11bXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbHM7IGkrKykge1xuICAgIGNvbnN0IHJvdyA9IG5ldyBBcnJheTxudW1iZXI+KGNvbHMpLmZpbGwoMCk7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBjb2xzOyBqKyspIHtcbiAgICAgIGxldCBhY2MgPSAwO1xuICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCByb3dzOyByKyspIGFjYyArPSBhW3JdW2ldICogYVtyXVtqXTtcbiAgICAgIHJvd1tqXSA9IGkgPT09IGogPyBhY2MgKyByaWRnZSA6IGFjYztcbiAgICB9XG4gICAgbm9ybWFsLnB1c2gocm93KTtcbiAgfVxuICBjb25zdCByaHMgPSBuZXcgQXJyYXk8bnVtYmVyPihjb2xzKS5maWxsKDApO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbHM7IGkrKykge1xuICAgIGxldCBhY2MgPSAwO1xuICAgIGZvciAobGV0IHIgPSAwOyByIDwgcm93czsgcisrKSBhY2MgKz0gYVtyXVtpXSAqIGJbcl07XG4gICAgcmhzW2ldID0gYWNjO1xuICB9XG4gIHJldHVybiBzb2x2ZUxpbmVhcihub3JtYWwsIHJocyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNpZHVhbHMoYTogTWF0cml4LCB4OiByZWFkb25seSBudW1iZXJbXSwgYjogcmVhZG9ubHkgbnVtYmVyW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IHByZWRpY3RlZCA9IG1hdFZlYyhhLCB4KTtcbiAgaWYgKGIubGVuZ3RoICE9PSBwcmVkaWN0ZWQubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYHJlc2lkdWFsczogYiBoYXMgJHtiLmxlbmd0aH0gZW50cmllcywgd2FudCAke3ByZWRpY3RlZC5sZW5ndGh9YCk7XG4gIH1cbiAgcmV0dXJuIHByZWRpY3RlZC5tYXAoKHAsIGkpID0+IGJbaV0gLSBwKTtcbn1cblxuLy8gUm9vdCBtZWFuIHNxdWFyZSBvZiBhIHJlc2lkdWFsIHZlY3Rvci5cbmV4cG9ydCBmdW5jdGlvbiBybXModmFsdWVzOiByZWFkb25seSBudW1iZXJbXSk6IG51bWJlciB7XG4gIGlmICh2YWx1ZXMubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgbGV0IGFjYyA9IDA7XG4gIGZvciAoY29uc3QgdiBvZiB2YWx1ZXMpIGFjYyArPSB2ICogdjtcbiAgcmV0dXJuIE1hdGguc3FydChhY2MgLyB2YWx1ZXMubGVuZ3RoKTtcbn1cblxuLy8gQ29lZmZpY2llbnRzIGluIEFTQ0VORElORyBwb3dlciBvcmRlcjogW2MwLCBjMSwgLi4uXSBtZWFucyBjMCArIGMxIHggKyAuLi5cbmV4cG9ydCBmdW5jdGlvbiBldmFsUG9seW5vbWlhbChjb2VmZnM6IHJlYWRvbmx5IG51bWJlcltdLCB4OiBudW1iZXIpOiBudW1iZXIge1xuICBsZXQgYWNjID0gMDtcbiAgZm9yIChsZXQgaSA9IGNvZWZmcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgYWNjID0gYWNjICogeCArIGNvZWZmc1tpXTtcbiAgcmV0dXJuIGFjYztcbn1cblxuLy8gTGVhc3Qtc3F1YXJlcyBwb2x5bm9taWFsIG9mIHRoZSBnaXZlbiBkZWdyZWUgdGhyb3VnaCAoeHMsIHlzKS4gQ29lZmZpY2llbnRzXG4vLyBjb21lIGJhY2sgaW4gYXNjZW5kaW5nIHBvd2VyIG9yZGVyLiBUaGUgeCB2YWx1ZXMgYXJlIGNlbnRyZWQgYW5kIHNjYWxlZFxuLy8gaW50ZXJuYWxseSwgdGhlbiB0aGUgZml0IGlzIG1hcHBlZCBiYWNrLCBiZWNhdXNlIGEgcmF3IFZhbmRlcm1vbmRlIG1hdHJpeCBvblxuLy8gbGFyZ2UgeCBsb3NlcyB0aGUgaGlnaC1vcmRlciB0ZXJtcyB0byBjb25kaXRpb25pbmcuXG5leHBvcnQgZnVuY3Rpb24gZml0UG9seW5vbWlhbChcbiAgeHM6IHJlYWRvbmx5IG51bWJlcltdLFxuICB5czogcmVhZG9ubHkgbnVtYmVyW10sXG4gIGRlZ3JlZTogbnVtYmVyLFxuKTogbnVtYmVyW10gfCBudWxsIHtcbiAgaWYgKHhzLmxlbmd0aCAhPT0geXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYGZpdFBvbHlub21pYWw6ICR7eHMubGVuZ3RofSB4IHZhbHVlcyBhZ2FpbnN0ICR7eXMubGVuZ3RofSB5IHZhbHVlc2ApO1xuICB9XG4gIGlmICghTnVtYmVyLmlzSW50ZWdlcihkZWdyZWUpIHx8IGRlZ3JlZSA8IDApIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcihgZml0UG9seW5vbWlhbDogZGVncmVlIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlciwgZ290ICR7ZGVncmVlfWApO1xuICB9XG4gIGlmICh4cy5sZW5ndGggPCBkZWdyZWUgKyAxKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYGZpdFBvbHlub21pYWw6IGRlZ3JlZSAke2RlZ3JlZX0gbmVlZHMgJHtkZWdyZWUgKyAxfSBwb2ludHMsIGdvdCAke3hzLmxlbmd0aH1gKTtcbiAgfVxuXG4gIGNvbnN0IGNlbnRlciA9IHhzLnJlZHVjZSgocywgeCkgPT4gcyArIHgsIDApIC8geHMubGVuZ3RoO1xuICBsZXQgc3ByZWFkID0gMDtcbiAgZm9yIChjb25zdCB4IG9mIHhzKSBzcHJlYWQgPSBNYXRoLm1heChzcHJlYWQsIE1hdGguYWJzKHggLSBjZW50ZXIpKTtcbiAgY29uc3Qgc2NhbGVYID0gc3ByZWFkIHx8IDE7XG5cbiAgY29uc3QgdmFuZGVybW9uZGUgPSB4cy5tYXAoKHgpID0+IHtcbiAgICBjb25zdCB0ID0gKHggLSBjZW50ZXIpIC8gc2NhbGVYO1xuICAgIGNvbnN0IHJvdyA9IG5ldyBBcnJheTxudW1iZXI+KGRlZ3JlZSArIDEpO1xuICAgIGxldCBwb3dlciA9IDE7XG4gICAgZm9yIChsZXQgayA9IDA7IGsgPD0gZGVncmVlOyBrKyspIHtcbiAgICAgIHJvd1trXSA9IHBvd2VyO1xuICAgICAgcG93ZXIgKj0gdDtcbiAgICB9XG4gICAgcmV0dXJuIHJvdztcbiAgfSk7XG4gIGNvbnN0IHNoaWZ0ZWQgPSBzb2x2ZUxlYXN0U3F1YXJlcyh2YW5kZXJtb25kZSwgeXMpO1xuICBpZiAoIXNoaWZ0ZWQpIHJldHVybiBudWxsO1xuXG4gIC8vIEV4cGFuZCBzdW1fayBzaGlmdGVkW2tdICogKCh4IC0gY2VudGVyKS9zY2FsZVgpXmsgYmFjayBpbnRvIHBvd2VycyBvZiB4LlxuICBjb25zdCBvdXQgPSBuZXcgQXJyYXk8bnVtYmVyPihkZWdyZWUgKyAxKS5maWxsKDApO1xuICBmb3IgKGxldCBrID0gMDsgayA8PSBkZWdyZWU7IGsrKykge1xuICAgIGlmIChzaGlmdGVkW2tdID09PSAwKSBjb250aW51ZTtcbiAgICAvLyBCaW5vbWlhbCBleHBhbnNpb24gb2YgKHggLSBjZW50ZXIpXmssIGRpdmlkZWQgYnkgc2NhbGVYXmsuXG4gICAgbGV0IGJpbm9tID0gMTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8PSBrOyBqKyspIHtcbiAgICAgIGNvbnN0IHRlcm0gPSBiaW5vbSAqIE1hdGgucG93KC1jZW50ZXIsIGsgLSBqKSAvIE1hdGgucG93KHNjYWxlWCwgayk7XG4gICAgICBvdXRbal0gKz0gc2hpZnRlZFtrXSAqIHRlcm07XG4gICAgICBiaW5vbSA9IChiaW5vbSAqIChrIC0gaikpIC8gKGogKyAxKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLy8gT3JkaW5hcnkgeS1vbi14IGxpbmUgZml0OiBtaW5pbWlzZXMgdGhlIHZlcnRpY2FsIHJlc2lkdWFsLiBWZXJ0aWNhbCBkYXRhIGhhc1xuLy8gbm8gZmluaXRlIHNsb3BlLCBzbyB0aGlzIHJldHVybnMgbnVsbCB0aGVyZSBcdTIwMTQgdXNlIGZpdE9ydGhvTGluZTIgaW5zdGVhZC5cbmV4cG9ydCBmdW5jdGlvbiBmaXRMaW5lKHhzOiByZWFkb25seSBudW1iZXJbXSwgeXM6IHJlYWRvbmx5IG51bWJlcltdKTogTGluZUZpdDIgfCBudWxsIHtcbiAgaWYgKHhzLmxlbmd0aCAhPT0geXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYGZpdExpbmU6ICR7eHMubGVuZ3RofSB4IHZhbHVlcyBhZ2FpbnN0ICR7eXMubGVuZ3RofSB5IHZhbHVlc2ApO1xuICB9XG4gIGNvbnN0IG4gPSB4cy5sZW5ndGg7XG4gIGlmIChuIDwgMikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoYGZpdExpbmUgbmVlZHMgYXQgbGVhc3QgMiBwb2ludHMsIGdvdCAke259YCk7XG5cbiAgY29uc3QgbWVhblggPSB4cy5yZWR1Y2UoKHMsIHgpID0+IHMgKyB4LCAwKSAvIG47XG4gIGNvbnN0IG1lYW5ZID0geXMucmVkdWNlKChzLCB5KSA9PiBzICsgeSwgMCkgLyBuO1xuICBsZXQgc3h4ID0gMDtcbiAgbGV0IHN4eSA9IDA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7XG4gICAgY29uc3QgZHggPSB4c1tpXSAtIG1lYW5YO1xuICAgIHN4eCArPSBkeCAqIGR4O1xuICAgIHN4eSArPSBkeCAqICh5c1tpXSAtIG1lYW5ZKTtcbiAgfVxuICBpZiAoc3h4IDw9IE51bWJlci5FUFNJTE9OKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBzbG9wZSA9IHN4eSAvIHN4eDtcbiAgY29uc3QgaW50ZXJjZXB0ID0gbWVhblkgLSBzbG9wZSAqIG1lYW5YO1xuICBjb25zdCBlcnJvcnMgPSB5cy5tYXAoKHksIGkpID0+IHkgLSAoc2xvcGUgKiB4c1tpXSArIGludGVyY2VwdCkpO1xuICByZXR1cm4geyBzbG9wZSwgaW50ZXJjZXB0LCBybXM6IHJtcyhlcnJvcnMpIH07XG59XG5cbi8vIFN5bW1ldHJpYyAyeDIgZWlnZW4gZGVjb21wb3NpdGlvbiwgdXNlZCBieSB0aGUgb3J0aG9nb25hbCAyRCBmaXRzLiBSZXR1cm5zXG4vLyB0aGUgZWlnZW52YWx1ZXMgYXNjZW5kaW5nIHdpdGggdGhlaXIgdW5pdCBlaWdlbnZlY3RvcnMuXG5mdW5jdGlvbiBlaWdlbjIoeHg6IG51bWJlciwgeHk6IG51bWJlciwgeXk6IG51bWJlcik6IHsgdmFsdWVzOiBbbnVtYmVyLCBudW1iZXJdOyB2ZWN0b3JzOiBbVmVjMiwgVmVjMl0gfSB7XG4gIGNvbnN0IGhhbGYgPSAoeHggKyB5eSkgLyAyO1xuICBjb25zdCBkaWZmID0gKHh4IC0geXkpIC8gMjtcbiAgY29uc3Qgcm9vdCA9IE1hdGguaHlwb3QoZGlmZiwgeHkpO1xuICBjb25zdCBsYXJnZSA9IGhhbGYgKyByb290O1xuICBjb25zdCBzbWFsbCA9IGhhbGYgLSByb290O1xuICAvLyAoeHggLSBsYW1iZGEpIHZ4ICsgeHkgdnkgPSAwIGdpdmVzIHRoaXMgZWlnZW52ZWN0b3IgZm9yIHRoZSBMQVJHRSB2YWx1ZS5cbiAgbGV0IG1ham9yOiBWZWMyID0gTWF0aC5hYnMoeHkpID4gTnVtYmVyLkVQU0lMT04gPyBbbGFyZ2UgLSB5eSwgeHldIDogeHggPj0geXkgPyBbMSwgMF0gOiBbMCwgMV07XG4gIGNvbnN0IGxlbiA9IE1hdGguaHlwb3QobWFqb3JbMF0sIG1ham9yWzFdKSB8fCAxO1xuICBtYWpvciA9IFttYWpvclswXSAvIGxlbiwgbWFqb3JbMV0gLyBsZW5dO1xuICBjb25zdCBtaW5vcjogVmVjMiA9IFstbWFqb3JbMV0sIG1ham9yWzBdXTtcbiAgcmV0dXJuIHsgdmFsdWVzOiBbc21hbGwsIGxhcmdlXSwgdmVjdG9yczogW21pbm9yLCBtYWpvcl0gfTtcbn1cblxuLy8gVG90YWwtbGVhc3Qtc3F1YXJlcyBsaW5lIHRocm91Z2ggMkQgcG9pbnRzOiBtaW5pbWlzZXMgdGhlIFBFUlBFTkRJQ1VMQVJcbi8vIGRpc3RhbmNlLCBzbyBpdCBoYW5kbGVzIGEgdmVydGljYWwgbGluZSBhbmQgZG9lcyBub3QgZmF2b3VyIGVpdGhlciBheGlzLiBUaGVcbi8vIGRpcmVjdGlvbiBpcyB0aGUgcHJpbmNpcGFsIGF4aXMgb2YgdGhlIHBvaW50IGNsb3VkLCBhbmQgdGhlIHBvaW50IGlzIGl0c1xuLy8gY2VudHJvaWQuIEEgYm91bmRlZCBudW1iZXIgb2YgcG9pbnRzLCBvciBjb2luY2lkZW50IHBvaW50cywgaXMgbnVsbC5cbmV4cG9ydCBmdW5jdGlvbiBmaXRPcnRob0xpbmUyKHBvaW50czogcmVhZG9ubHkgVmVjMltdKTogT3J0aG9MaW5lRml0MiB8IG51bGwge1xuICBpZiAocG9pbnRzLmxlbmd0aCA8IDIpIHJldHVybiBudWxsO1xuICBjb25zdCBuID0gcG9pbnRzLmxlbmd0aDtcbiAgbGV0IG14ID0gMDtcbiAgbGV0IG15ID0gMDtcbiAgZm9yIChjb25zdCBwIG9mIHBvaW50cykge1xuICAgIG14ICs9IHBbMF07XG4gICAgbXkgKz0gcFsxXTtcbiAgfVxuICBteCAvPSBuO1xuICBteSAvPSBuO1xuXG4gIGxldCB4eCA9IDA7XG4gIGxldCB4eSA9IDA7XG4gIGxldCB5eSA9IDA7XG4gIGZvciAoY29uc3QgcCBvZiBwb2ludHMpIHtcbiAgICBjb25zdCBkeCA9IHBbMF0gLSBteDtcbiAgICBjb25zdCBkeSA9IHBbMV0gLSBteTtcbiAgICB4eCArPSBkeCAqIGR4O1xuICAgIHh5ICs9IGR4ICogZHk7XG4gICAgeXkgKz0gZHkgKiBkeTtcbiAgfVxuICBpZiAoeHggKyB5eSA8PSBOdW1iZXIuRVBTSUxPTikgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgeyB2ZWN0b3JzIH0gPSBlaWdlbjIoeHggLyBuLCB4eSAvIG4sIHl5IC8gbik7XG4gIGNvbnN0IG5vcm1hbCA9IHZlY3RvcnNbMF07XG4gIGNvbnN0IGRpcmVjdGlvbiA9IHZlY3RvcnNbMV07XG4gIGNvbnN0IGVycm9ycyA9IHBvaW50cy5tYXAoKHApID0+IG5vcm1hbFswXSAqIChwWzBdIC0gbXgpICsgbm9ybWFsWzFdICogKHBbMV0gLSBteSkpO1xuICByZXR1cm4geyBwb2ludDogW214LCBteV0sIGRpcmVjdGlvbiwgcm1zOiBybXMoZXJyb3JzKSB9O1xufVxuXG4vLyBUaGUgcmVwb3J0ZWQgcm1zIGlzIHRoZSB0cnVlIGdlb21ldHJpYyByZXNpZHVhbCwgfHAgLSBjZW50cmV8IC0gcmFkaXVzLCBub3Rcbi8vIHRoZSBhbGdlYnJhaWMgb25lIHRoZSBzb2x2ZSBtaW5pbWlzZXMuIENvbGxpbmVhciBwb2ludHMgaGF2ZSBubyBjaXJjbGU6XG4vLyBudWxsLlxuZXhwb3J0IGZ1bmN0aW9uIGZpdENpcmNsZTIocG9pbnRzOiByZWFkb25seSBWZWMyW10pOiBDaXJjbGVGaXQyIHwgbnVsbCB7XG4gIGlmIChwb2ludHMubGVuZ3RoIDwgMykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHJvd3MgPSBwb2ludHMubWFwKChwKSA9PiBbMiAqIHBbMF0sIDIgKiBwWzFdLCAxXSk7XG4gIGNvbnN0IHJocyA9IHBvaW50cy5tYXAoKHApID0+IHBbMF0gKiBwWzBdICsgcFsxXSAqIHBbMV0pO1xuICBjb25zdCBzb2x1dGlvbiA9IHNvbHZlTGVhc3RTcXVhcmVzKHJvd3MsIHJocyk7XG4gIGlmICghc29sdXRpb24pIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IFtjeCwgY3ksIGNdID0gc29sdXRpb247XG4gIGNvbnN0IHJzcXIgPSBjICsgY3ggKiBjeCArIGN5ICogY3k7XG4gIGlmICghKHJzcXIgPiAwKSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHJhZGl1cyA9IE1hdGguc3FydChyc3FyKTtcbiAgY29uc3QgZXJyb3JzID0gcG9pbnRzLm1hcCgocCkgPT4gTWF0aC5oeXBvdChwWzBdIC0gY3gsIHBbMV0gLSBjeSkgLSByYWRpdXMpO1xuICByZXR1cm4geyBjZW50ZXI6IFtjeCwgY3ldLCByYWRpdXMsIHJtczogcm1zKGVycm9ycykgfTtcbn1cblxuLy8gTWVhbiBhbmQgdGhlIDN4MyBjb3ZhcmlhbmNlIG1hdHJpeCAoZGl2aWRlZCBieSB0aGUgcG9pbnQgY291bnQpIG9mIGEgM0QgcG9pbnRcbi8vIGNsb3VkLiBUaGlzIGlzIHRoZSBpbnB1dCB0byBldmVyeSBvcnRob2dvbmFsIDNEIGZpdCBiZWxvdy5cbmV4cG9ydCBmdW5jdGlvbiBjb3ZhcmlhbmNlMyhwb2ludHM6IHJlYWRvbmx5IFZlYzNbXSk6IENvdmFyaWFuY2UzIHtcbiAgY29uc3QgbiA9IHBvaW50cy5sZW5ndGg7XG4gIGlmIChuID09PSAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignY292YXJpYW5jZTM6IGVtcHR5IHBvaW50IGxpc3QnKTtcbiAgbGV0IG14ID0gMDtcbiAgbGV0IG15ID0gMDtcbiAgbGV0IG16ID0gMDtcbiAgZm9yIChjb25zdCBwIG9mIHBvaW50cykge1xuICAgIG14ICs9IHBbMF07XG4gICAgbXkgKz0gcFsxXTtcbiAgICBteiArPSBwWzJdO1xuICB9XG4gIG14IC89IG47XG4gIG15IC89IG47XG4gIG16IC89IG47XG5cbiAgbGV0IHh4ID0gMDtcbiAgbGV0IHh5ID0gMDtcbiAgbGV0IHh6ID0gMDtcbiAgbGV0IHl5ID0gMDtcbiAgbGV0IHl6ID0gMDtcbiAgbGV0IHp6ID0gMDtcbiAgZm9yIChjb25zdCBwIG9mIHBvaW50cykge1xuICAgIGNvbnN0IGR4ID0gcFswXSAtIG14O1xuICAgIGNvbnN0IGR5ID0gcFsxXSAtIG15O1xuICAgIGNvbnN0IGR6ID0gcFsyXSAtIG16O1xuICAgIHh4ICs9IGR4ICogZHg7XG4gICAgeHkgKz0gZHggKiBkeTtcbiAgICB4eiArPSBkeCAqIGR6O1xuICAgIHl5ICs9IGR5ICogZHk7XG4gICAgeXogKz0gZHkgKiBkejtcbiAgICB6eiArPSBkeiAqIGR6O1xuICB9XG4gIGNvbnN0IG1hdHJpeCA9IFtcbiAgICBbeHggLyBuLCB4eSAvIG4sIHh6IC8gbl0sXG4gICAgW3h5IC8gbiwgeXkgLyBuLCB5eiAvIG5dLFxuICAgIFt4eiAvIG4sIHl6IC8gbiwgenogLyBuXSxcbiAgXTtcbiAgcmV0dXJuIHsgbWVhbjogW214LCBteSwgbXpdLCBtYXRyaXggfTtcbn1cblxuLy8gU2lnbiBjb252ZW50aW9uOiB0aGUgY29tcG9uZW50IG9mIGxhcmdlc3QgbWFnbml0dWRlIGlzIG1hZGUgcG9zaXRpdmUsIHNvIHRoZVxuLy8gc2FtZSBjbG91ZCBhbHdheXMgeWllbGRzIHRoZSBzYW1lIGVpZ2VudmVjdG9ycyBpbnN0ZWFkIG9mIGFuIGFyYml0cmFyeSBmbGlwLlxuZnVuY3Rpb24gY2Fub25pY2FsU2lnbih2OiBWZWMzKTogVmVjMyB7XG4gIGxldCBpbmRleCA9IDA7XG4gIGZvciAobGV0IGkgPSAxOyBpIDwgMzsgaSsrKSB7XG4gICAgaWYgKE1hdGguYWJzKHZbaV0pID4gTWF0aC5hYnModltpbmRleF0pKSBpbmRleCA9IGk7XG4gIH1cbiAgcmV0dXJuIHZbaW5kZXhdIDwgMCA/IFstdlswXSwgLXZbMV0sIC12WzJdXSA6IHY7XG59XG5cbi8vIEN5Y2xpYyBKYWNvYmkgcm90YXRpb25zIG9uIGEgc3ltbWV0cmljIDN4My4gRWlnZW52YWx1ZXMgY29tZSBiYWNrIGFzY2VuZGluZyxcbi8vIHdpdGggdGhlIG1hdGNoaW5nIG9ydGhvbm9ybWFsIGVpZ2VudmVjdG9ycy4gSmFjb2JpIGlzIHVzZWQgcmF0aGVyIHRoYW4gdGhlXG4vLyBjbG9zZWQtZm9ybSBjdWJpYyBiZWNhdXNlIGl0IHN0YXlzIGFjY3VyYXRlIG9uIGEgbmVhci1kZWdlbmVyYXRlIG1hdHJpeCxcbi8vIHdoaWNoIGlzIGV4YWN0bHkgdGhlIGNhc2UgYSBmbGF0IG9yIHJvZC1zaGFwZWQgcG9pbnQgY2xvdWQgcHJvZHVjZXMuXG5leHBvcnQgZnVuY3Rpb24gc3ltbWV0cmljRWlnZW4zKG1hdHJpeDogTWF0cml4KTogRWlnZW4zIHtcbiAgY29uc3QgW3Jvd3MsIGNvbHNdID0gZGltcyhtYXRyaXgpO1xuICBpZiAocm93cyAhPT0gMyB8fCBjb2xzICE9PSAzKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcihgc3ltbWV0cmljRWlnZW4zIG5lZWRzIGEgM3gzIG1hdHJpeCwgZ290ICR7cm93c314JHtjb2xzfWApO1xuXG4gIGNvbnN0IGEgPSBtYXRyaXgubWFwKChyb3cpID0+IFsuLi5yb3ddKTtcbiAgY29uc3QgdiA9IFtcbiAgICBbMSwgMCwgMF0sXG4gICAgWzAsIDEsIDBdLFxuICAgIFswLCAwLCAxXSxcbiAgXTtcbiAgY29uc3QgcGFpcnM6IFtudW1iZXIsIG51bWJlcl1bXSA9IFtcbiAgICBbMCwgMV0sXG4gICAgWzAsIDJdLFxuICAgIFsxLCAyXSxcbiAgXTtcbiAgZm9yIChsZXQgc3dlZXAgPSAwOyBzd2VlcCA8IDMyOyBzd2VlcCsrKSB7XG4gICAgbGV0IG9mZiA9IDA7XG4gICAgZm9yIChjb25zdCBbcCwgcV0gb2YgcGFpcnMpIG9mZiArPSBNYXRoLmFicyhhW3BdW3FdKTtcbiAgICBpZiAob2ZmIDw9IDFlLTE4KSBicmVhaztcbiAgICBmb3IgKGNvbnN0IFtwLCBxXSBvZiBwYWlycykge1xuICAgICAgY29uc3QgYXBxID0gYVtwXVtxXTtcbiAgICAgIGlmIChNYXRoLmFicyhhcHEpIDw9IDFlLTMwMCkgY29udGludWU7XG4gICAgICBjb25zdCB0aGV0YSA9IChhW3FdW3FdIC0gYVtwXVtwXSkgLyAoMiAqIGFwcSk7XG4gICAgICBjb25zdCB0ID0gKHRoZXRhID49IDAgPyAxIDogLTEpIC8gKE1hdGguYWJzKHRoZXRhKSArIE1hdGguc3FydCh0aGV0YSAqIHRoZXRhICsgMSkpO1xuICAgICAgY29uc3QgYyA9IDEgLyBNYXRoLnNxcnQodCAqIHQgKyAxKTtcbiAgICAgIGNvbnN0IHMgPSB0ICogYztcbiAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgMzsgaysrKSB7XG4gICAgICAgIGNvbnN0IGFrcCA9IGFba11bcF07XG4gICAgICAgIGNvbnN0IGFrcSA9IGFba11bcV07XG4gICAgICAgIGFba11bcF0gPSBjICogYWtwIC0gcyAqIGFrcTtcbiAgICAgICAgYVtrXVtxXSA9IHMgKiBha3AgKyBjICogYWtxO1xuICAgICAgfVxuICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCAzOyBrKyspIHtcbiAgICAgICAgY29uc3QgYXBrID0gYVtwXVtrXTtcbiAgICAgICAgY29uc3QgYXFrID0gYVtxXVtrXTtcbiAgICAgICAgYVtwXVtrXSA9IGMgKiBhcGsgLSBzICogYXFrO1xuICAgICAgICBhW3FdW2tdID0gcyAqIGFwayArIGMgKiBhcWs7XG4gICAgICB9XG4gICAgICBmb3IgKGxldCBrID0gMDsgayA8IDM7IGsrKykge1xuICAgICAgICBjb25zdCB2a3AgPSB2W2tdW3BdO1xuICAgICAgICBjb25zdCB2a3EgPSB2W2tdW3FdO1xuICAgICAgICB2W2tdW3BdID0gYyAqIHZrcCAtIHMgKiB2a3E7XG4gICAgICAgIHZba11bcV0gPSBzICogdmtwICsgYyAqIHZrcTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBvcmRlciA9IFswLCAxLCAyXS5zb3J0KChpLCBqKSA9PiBhW2ldW2ldIC0gYVtqXVtqXSk7XG4gIGNvbnN0IHZhbHVlcyA9IG9yZGVyLm1hcCgoaSkgPT4gYVtpXVtpXSkgYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXJdO1xuICBjb25zdCB2ZWN0b3JzID0gb3JkZXIubWFwKChpKSA9PiBjYW5vbmljYWxTaWduKFt2WzBdW2ldLCB2WzFdW2ldLCB2WzJdW2ldXSkpIGFzIFtWZWMzLCBWZWMzLCBWZWMzXTtcbiAgcmV0dXJuIHsgdmFsdWVzLCB2ZWN0b3JzIH07XG59XG5cbi8vIEJlc3QtZml0IHBsYW5lIHRocm91Z2ggM0QgcG9pbnRzOiB0aGUgbm9ybWFsIGlzIHRoZSBlaWdlbnZlY3RvciBvZiB0aGVcbi8vIHNtYWxsZXN0IGNvdmFyaWFuY2UgZWlnZW52YWx1ZSwgYW5kIHRoZSBwbGFuZSBwYXNzZXMgdGhyb3VnaCB0aGUgY2VudHJvaWQuXG4vLyBUaGUgcm1zIGlzIHRoZSBvcnRob2dvbmFsIHBvaW50LXRvLXBsYW5lIGRpc3RhbmNlLlxuZXhwb3J0IGZ1bmN0aW9uIGZpdFBsYW5lKHBvaW50czogcmVhZG9ubHkgVmVjM1tdKTogUGxhbmVGaXQgfCBudWxsIHtcbiAgaWYgKHBvaW50cy5sZW5ndGggPCAzKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgeyBtZWFuLCBtYXRyaXggfSA9IGNvdmFyaWFuY2UzKHBvaW50cyk7XG4gIGNvbnN0IHsgdmFsdWVzLCB2ZWN0b3JzIH0gPSBzeW1tZXRyaWNFaWdlbjMobWF0cml4KTtcbiAgLy8gRGlzdGluY3QgZGlyZWN0aW9ucyBtdXN0IGNhcnJ5IHZhcmlhbmNlLCBvciB0aGUgY2xvdWQgaXMgYSBsaW5lL3BvaW50IGFuZCBpdHMgbm9ybWFsIGlzIGFyYml0cmFyeS5cbiAgaWYgKHZhbHVlc1sxXSA8PSBOdW1iZXIuRVBTSUxPTiAqICh2YWx1ZXNbMl0gfHwgMSkpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IG5vcm1hbCA9IHZlY3RvcnNbMF07XG4gIGNvbnN0IGVycm9ycyA9IHBvaW50cy5tYXAoXG4gICAgKHApID0+IG5vcm1hbFswXSAqIChwWzBdIC0gbWVhblswXSkgKyBub3JtYWxbMV0gKiAocFsxXSAtIG1lYW5bMV0pICsgbm9ybWFsWzJdICogKHBbMl0gLSBtZWFuWzJdKSxcbiAgKTtcbiAgcmV0dXJuIHsgcG9pbnQ6IG1lYW4sIG5vcm1hbCwgcm1zOiBybXMoZXJyb3JzKSB9O1xufVxuXG4vLyBCZXN0LWZpdCBsaW5lIHRocm91Z2ggM0QgcG9pbnRzOiB0aGUgZGlyZWN0aW9uIGlzIHRoZSBlaWdlbnZlY3RvciBvZiB0aGVcbi8vIExBUkdFU1QgY292YXJpYW5jZSBlaWdlbnZhbHVlLiBUaGUgcm1zIGlzIHRoZSBvcnRob2dvbmFsIHBvaW50LXRvLWxpbmVcbi8vIGRpc3RhbmNlLlxuZXhwb3J0IGZ1bmN0aW9uIGZpdE9ydGhvTGluZTMocG9pbnRzOiByZWFkb25seSBWZWMzW10pOiBPcnRob0xpbmVGaXQzIHwgbnVsbCB7XG4gIGlmIChwb2ludHMubGVuZ3RoIDwgMikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHsgbWVhbiwgbWF0cml4IH0gPSBjb3ZhcmlhbmNlMyhwb2ludHMpO1xuICBjb25zdCB7IHZhbHVlcywgdmVjdG9ycyB9ID0gc3ltbWV0cmljRWlnZW4zKG1hdHJpeCk7XG4gIGlmICh2YWx1ZXNbMl0gPD0gTnVtYmVyLkVQU0lMT04pIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGRpcmVjdGlvbiA9IHZlY3RvcnNbMl07XG4gIGNvbnN0IGVycm9ycyA9IHBvaW50cy5tYXAoKHApID0+IHtcbiAgICBjb25zdCBkeCA9IHBbMF0gLSBtZWFuWzBdO1xuICAgIGNvbnN0IGR5ID0gcFsxXSAtIG1lYW5bMV07XG4gICAgY29uc3QgZHogPSBwWzJdIC0gbWVhblsyXTtcbiAgICBjb25zdCBhbG9uZyA9IGR4ICogZGlyZWN0aW9uWzBdICsgZHkgKiBkaXJlY3Rpb25bMV0gKyBkeiAqIGRpcmVjdGlvblsyXTtcbiAgICByZXR1cm4gTWF0aC5oeXBvdChkeCAtIGFsb25nICogZGlyZWN0aW9uWzBdLCBkeSAtIGFsb25nICogZGlyZWN0aW9uWzFdLCBkeiAtIGFsb25nICogZGlyZWN0aW9uWzJdKTtcbiAgfSk7XG4gIHJldHVybiB7IHBvaW50OiBtZWFuLCBkaXJlY3Rpb24sIHJtczogcm1zKGVycm9ycykgfTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFFQSxTQUFTLFlBQVk7QUFDckIsT0FBTyxZQUFZOzs7QUNhbkIsU0FBUyxLQUFLLEdBQTZCO0FBQ3pDLFFBQU0sT0FBTyxFQUFFO0FBQ2YsTUFBSSxTQUFTLEVBQUcsT0FBTSxJQUFJLFdBQVcsb0JBQW9CO0FBQ3pELFFBQU0sT0FBTyxFQUFFLENBQUMsRUFBRTtBQUNsQixhQUFXLE9BQU8sR0FBRztBQUNuQixRQUFJLElBQUksV0FBVyxLQUFNLE9BQU0sSUFBSSxXQUFXLGtDQUFrQztBQUFBLEVBQ2xGO0FBQ0EsU0FBTyxDQUFDLE1BQU0sSUFBSTtBQUNwQjtBQUlPLFNBQVMsWUFBWSxHQUFXLEdBQXVDO0FBQzVFLFFBQU0sQ0FBQyxNQUFNLElBQUksSUFBSSxLQUFLLENBQUM7QUFDM0IsTUFBSSxTQUFTLEtBQU0sT0FBTSxJQUFJLFdBQVcsMENBQTBDLElBQUksSUFBSSxJQUFJLEVBQUU7QUFDaEcsTUFBSSxFQUFFLFdBQVcsS0FBTSxPQUFNLElBQUksV0FBVyxzQkFBc0IsRUFBRSxNQUFNLGtCQUFrQixJQUFJLEVBQUU7QUFFbEcsUUFBTSxJQUFJLEVBQUUsSUFBSSxDQUFDLEtBQUssTUFBTSxDQUFDLEdBQUcsS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQzFDLFdBQVMsTUFBTSxHQUFHLE1BQU0sTUFBTSxPQUFPO0FBQ25DLFFBQUksUUFBUTtBQUNaLGFBQVMsSUFBSSxNQUFNLEdBQUcsSUFBSSxNQUFNLEtBQUs7QUFDbkMsVUFBSSxLQUFLLElBQUksRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLElBQUksS0FBSyxJQUFJLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxFQUFHLFNBQVE7QUFBQSxJQUM3RDtBQUNBLFFBQUksS0FBSyxJQUFJLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxLQUFLLE9BQU8sUUFBUyxRQUFPO0FBQ3RELEtBQUMsRUFBRSxHQUFHLEdBQUcsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsS0FBSyxHQUFHLEVBQUUsR0FBRyxDQUFDO0FBQ3RDLFVBQU0sT0FBTyxFQUFFLEdBQUcsRUFBRSxHQUFHO0FBQ3ZCLGFBQVMsSUFBSSxNQUFNLEdBQUcsSUFBSSxNQUFNLEtBQUs7QUFDbkMsWUFBTSxTQUFTLEVBQUUsQ0FBQyxFQUFFLEdBQUcsSUFBSTtBQUMzQixVQUFJLFdBQVcsRUFBRztBQUNsQixlQUFTLElBQUksS0FBSyxLQUFLLE1BQU0sSUFBSyxHQUFFLENBQUMsRUFBRSxDQUFDLEtBQUssU0FBUyxFQUFFLEdBQUcsRUFBRSxDQUFDO0FBQUEsSUFDaEU7QUFBQSxFQUNGO0FBRUEsUUFBTSxJQUFJLElBQUksTUFBYyxJQUFJLEVBQUUsS0FBSyxDQUFDO0FBQ3hDLFdBQVMsSUFBSSxPQUFPLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFDbEMsUUFBSSxNQUFNLEVBQUUsQ0FBQyxFQUFFLElBQUk7QUFDbkIsYUFBUyxJQUFJLElBQUksR0FBRyxJQUFJLE1BQU0sSUFBSyxRQUFPLEVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUM7QUFDdkQsTUFBRSxDQUFDLElBQUksTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDO0FBQUEsRUFDckI7QUFDQSxTQUFPLEVBQUUsTUFBTSxDQUFDLE1BQU0sT0FBTyxTQUFTLENBQUMsQ0FBQyxJQUFJLElBQUk7QUFDbEQ7QUFFTyxTQUFTLFVBQVUsR0FBdUI7QUFDL0MsUUFBTSxDQUFDLE1BQU0sSUFBSSxJQUFJLEtBQUssQ0FBQztBQUMzQixRQUFNLE1BQWtCLENBQUM7QUFDekIsV0FBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLEtBQUs7QUFDN0IsVUFBTSxNQUFNLElBQUksTUFBYyxJQUFJO0FBQ2xDLGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxJQUFLLEtBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDOUMsUUFBSSxLQUFLLEdBQUc7QUFBQSxFQUNkO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyxPQUFPLEdBQVcsR0FBZ0M7QUFDaEUsUUFBTSxDQUFDLE1BQU0sSUFBSSxJQUFJLEtBQUssQ0FBQztBQUMzQixNQUFJLEVBQUUsV0FBVyxLQUFNLE9BQU0sSUFBSSxXQUFXLGlCQUFpQixFQUFFLE1BQU0sa0JBQWtCLElBQUksRUFBRTtBQUM3RixRQUFNLE1BQU0sSUFBSSxNQUFjLElBQUksRUFBRSxLQUFLLENBQUM7QUFDMUMsV0FBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLEtBQUs7QUFDN0IsUUFBSSxNQUFNO0FBQ1YsYUFBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLElBQUssUUFBTyxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDO0FBQ25ELFFBQUksQ0FBQyxJQUFJO0FBQUEsRUFDWDtBQUNBLFNBQU87QUFDVDtBQUdPLFNBQVMsa0JBQWtCLEdBQVcsR0FBc0IsUUFBUSxHQUFvQjtBQUM3RixRQUFNLENBQUMsTUFBTSxJQUFJLElBQUksS0FBSyxDQUFDO0FBQzNCLE1BQUksRUFBRSxXQUFXLEtBQU0sT0FBTSxJQUFJLFdBQVcsNEJBQTRCLEVBQUUsTUFBTSxrQkFBa0IsSUFBSSxFQUFFO0FBRXhHLFFBQU0sU0FBcUIsQ0FBQztBQUM1QixXQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sS0FBSztBQUM3QixVQUFNLE1BQU0sSUFBSSxNQUFjLElBQUksRUFBRSxLQUFLLENBQUM7QUFDMUMsYUFBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLEtBQUs7QUFDN0IsVUFBSSxNQUFNO0FBQ1YsZUFBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLElBQUssUUFBTyxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQztBQUN0RCxVQUFJLENBQUMsSUFBSSxNQUFNLElBQUksTUFBTSxRQUFRO0FBQUEsSUFDbkM7QUFDQSxXQUFPLEtBQUssR0FBRztBQUFBLEVBQ2pCO0FBQ0EsUUFBTSxNQUFNLElBQUksTUFBYyxJQUFJLEVBQUUsS0FBSyxDQUFDO0FBQzFDLFdBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxLQUFLO0FBQzdCLFFBQUksTUFBTTtBQUNWLGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxJQUFLLFFBQU8sRUFBRSxDQUFDLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUNuRCxRQUFJLENBQUMsSUFBSTtBQUFBLEVBQ1g7QUFDQSxTQUFPLFlBQVksUUFBUSxHQUFHO0FBQ2hDO0FBRU8sU0FBUyxVQUFVLEdBQVcsR0FBc0IsR0FBZ0M7QUFDekYsUUFBTSxZQUFZLE9BQU8sR0FBRyxDQUFDO0FBQzdCLE1BQUksRUFBRSxXQUFXLFVBQVUsUUFBUTtBQUNqQyxVQUFNLElBQUksV0FBVyxvQkFBb0IsRUFBRSxNQUFNLGtCQUFrQixVQUFVLE1BQU0sRUFBRTtBQUFBLEVBQ3ZGO0FBQ0EsU0FBTyxVQUFVLElBQUksQ0FBQyxHQUFHLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQztBQUN6QztBQUdPLFNBQVMsSUFBSSxRQUFtQztBQUNyRCxNQUFJLE9BQU8sV0FBVyxFQUFHLFFBQU87QUFDaEMsTUFBSSxNQUFNO0FBQ1YsYUFBVyxLQUFLLE9BQVEsUUFBTyxJQUFJO0FBQ25DLFNBQU8sS0FBSyxLQUFLLE1BQU0sT0FBTyxNQUFNO0FBQ3RDO0FBR08sU0FBUyxlQUFlLFFBQTJCLEdBQW1CO0FBQzNFLE1BQUksTUFBTTtBQUNWLFdBQVMsSUFBSSxPQUFPLFNBQVMsR0FBRyxLQUFLLEdBQUcsSUFBSyxPQUFNLE1BQU0sSUFBSSxPQUFPLENBQUM7QUFDckUsU0FBTztBQUNUO0FBTU8sU0FBUyxjQUNkLElBQ0EsSUFDQSxRQUNpQjtBQUNqQixNQUFJLEdBQUcsV0FBVyxHQUFHLFFBQVE7QUFDM0IsVUFBTSxJQUFJLFdBQVcsa0JBQWtCLEdBQUcsTUFBTSxxQkFBcUIsR0FBRyxNQUFNLFdBQVc7QUFBQSxFQUMzRjtBQUNBLE1BQUksQ0FBQyxPQUFPLFVBQVUsTUFBTSxLQUFLLFNBQVMsR0FBRztBQUMzQyxVQUFNLElBQUksV0FBVyw2REFBNkQsTUFBTSxFQUFFO0FBQUEsRUFDNUY7QUFDQSxNQUFJLEdBQUcsU0FBUyxTQUFTLEdBQUc7QUFDMUIsVUFBTSxJQUFJLFdBQVcseUJBQXlCLE1BQU0sVUFBVSxTQUFTLENBQUMsZ0JBQWdCLEdBQUcsTUFBTSxFQUFFO0FBQUEsRUFDckc7QUFFQSxRQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxNQUFNLElBQUksR0FBRyxDQUFDLElBQUksR0FBRztBQUNsRCxNQUFJLFNBQVM7QUFDYixhQUFXLEtBQUssR0FBSSxVQUFTLEtBQUssSUFBSSxRQUFRLEtBQUssSUFBSSxJQUFJLE1BQU0sQ0FBQztBQUNsRSxRQUFNLFNBQVMsVUFBVTtBQUV6QixRQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsTUFBTTtBQUNoQyxVQUFNLEtBQUssSUFBSSxVQUFVO0FBQ3pCLFVBQU0sTUFBTSxJQUFJLE1BQWMsU0FBUyxDQUFDO0FBQ3hDLFFBQUksUUFBUTtBQUNaLGFBQVMsSUFBSSxHQUFHLEtBQUssUUFBUSxLQUFLO0FBQ2hDLFVBQUksQ0FBQyxJQUFJO0FBQ1QsZUFBUztBQUFBLElBQ1g7QUFDQSxXQUFPO0FBQUEsRUFDVCxDQUFDO0FBQ0QsUUFBTSxVQUFVLGtCQUFrQixhQUFhLEVBQUU7QUFDakQsTUFBSSxDQUFDLFFBQVMsUUFBTztBQUdyQixRQUFNLE1BQU0sSUFBSSxNQUFjLFNBQVMsQ0FBQyxFQUFFLEtBQUssQ0FBQztBQUNoRCxXQUFTLElBQUksR0FBRyxLQUFLLFFBQVEsS0FBSztBQUNoQyxRQUFJLFFBQVEsQ0FBQyxNQUFNLEVBQUc7QUFFdEIsUUFBSSxRQUFRO0FBQ1osYUFBUyxJQUFJLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFDM0IsWUFBTSxPQUFPLFFBQVEsS0FBSyxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsSUFBSSxLQUFLLElBQUksUUFBUSxDQUFDO0FBQ2xFLFVBQUksQ0FBQyxLQUFLLFFBQVEsQ0FBQyxJQUFJO0FBQ3ZCLGNBQVMsU0FBUyxJQUFJLE1BQU8sSUFBSTtBQUFBLElBQ25DO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUlPLFNBQVMsUUFBUSxJQUF1QixJQUF3QztBQUNyRixNQUFJLEdBQUcsV0FBVyxHQUFHLFFBQVE7QUFDM0IsVUFBTSxJQUFJLFdBQVcsWUFBWSxHQUFHLE1BQU0scUJBQXFCLEdBQUcsTUFBTSxXQUFXO0FBQUEsRUFDckY7QUFDQSxRQUFNLElBQUksR0FBRztBQUNiLE1BQUksSUFBSSxFQUFHLE9BQU0sSUFBSSxXQUFXLHdDQUF3QyxDQUFDLEVBQUU7QUFFM0UsUUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLEdBQUcsTUFBTSxJQUFJLEdBQUcsQ0FBQyxJQUFJO0FBQzlDLFFBQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLENBQUMsSUFBSTtBQUM5QyxNQUFJLE1BQU07QUFDVixNQUFJLE1BQU07QUFDVixXQUFTLElBQUksR0FBRyxJQUFJLEdBQUcsS0FBSztBQUMxQixVQUFNLEtBQUssR0FBRyxDQUFDLElBQUk7QUFDbkIsV0FBTyxLQUFLO0FBQ1osV0FBTyxNQUFNLEdBQUcsQ0FBQyxJQUFJO0FBQUEsRUFDdkI7QUFDQSxNQUFJLE9BQU8sT0FBTyxRQUFTLFFBQU87QUFFbEMsUUFBTSxRQUFRLE1BQU07QUFDcEIsUUFBTSxZQUFZLFFBQVEsUUFBUTtBQUNsQyxRQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxNQUFNLEtBQUssUUFBUSxHQUFHLENBQUMsSUFBSSxVQUFVO0FBQy9ELFNBQU8sRUFBRSxPQUFPLFdBQVcsS0FBSyxJQUFJLE1BQU0sRUFBRTtBQUM5QztBQUlBLFNBQVMsT0FBTyxJQUFZLElBQVksSUFBaUU7QUFDdkcsUUFBTSxRQUFRLEtBQUssTUFBTTtBQUN6QixRQUFNLFFBQVEsS0FBSyxNQUFNO0FBQ3pCLFFBQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxFQUFFO0FBQ2hDLFFBQU0sUUFBUSxPQUFPO0FBQ3JCLFFBQU0sUUFBUSxPQUFPO0FBRXJCLE1BQUksUUFBYyxLQUFLLElBQUksRUFBRSxJQUFJLE9BQU8sVUFBVSxDQUFDLFFBQVEsSUFBSSxFQUFFLElBQUksTUFBTSxLQUFLLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUM7QUFDOUYsUUFBTSxNQUFNLEtBQUssTUFBTSxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQyxLQUFLO0FBQzlDLFVBQVEsQ0FBQyxNQUFNLENBQUMsSUFBSSxLQUFLLE1BQU0sQ0FBQyxJQUFJLEdBQUc7QUFDdkMsUUFBTSxRQUFjLENBQUMsQ0FBQyxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQztBQUN4QyxTQUFPLEVBQUUsUUFBUSxDQUFDLE9BQU8sS0FBSyxHQUFHLFNBQVMsQ0FBQyxPQUFPLEtBQUssRUFBRTtBQUMzRDtBQU1PLFNBQVMsY0FBYyxRQUErQztBQUMzRSxNQUFJLE9BQU8sU0FBUyxFQUFHLFFBQU87QUFDOUIsUUFBTSxJQUFJLE9BQU87QUFDakIsTUFBSSxLQUFLO0FBQ1QsTUFBSSxLQUFLO0FBQ1QsYUFBVyxLQUFLLFFBQVE7QUFDdEIsVUFBTSxFQUFFLENBQUM7QUFDVCxVQUFNLEVBQUUsQ0FBQztBQUFBLEVBQ1g7QUFDQSxRQUFNO0FBQ04sUUFBTTtBQUVOLE1BQUksS0FBSztBQUNULE1BQUksS0FBSztBQUNULE1BQUksS0FBSztBQUNULGFBQVcsS0FBSyxRQUFRO0FBQ3RCLFVBQU0sS0FBSyxFQUFFLENBQUMsSUFBSTtBQUNsQixVQUFNLEtBQUssRUFBRSxDQUFDLElBQUk7QUFDbEIsVUFBTSxLQUFLO0FBQ1gsVUFBTSxLQUFLO0FBQ1gsVUFBTSxLQUFLO0FBQUEsRUFDYjtBQUNBLE1BQUksS0FBSyxNQUFNLE9BQU8sUUFBUyxRQUFPO0FBRXRDLFFBQU0sRUFBRSxRQUFRLElBQUksT0FBTyxLQUFLLEdBQUcsS0FBSyxHQUFHLEtBQUssQ0FBQztBQUNqRCxRQUFNLFNBQVMsUUFBUSxDQUFDO0FBQ3hCLFFBQU0sWUFBWSxRQUFRLENBQUM7QUFDM0IsUUFBTSxTQUFTLE9BQU8sSUFBSSxDQUFDLE1BQU0sT0FBTyxDQUFDLEtBQUssRUFBRSxDQUFDLElBQUksTUFBTSxPQUFPLENBQUMsS0FBSyxFQUFFLENBQUMsSUFBSSxHQUFHO0FBQ2xGLFNBQU8sRUFBRSxPQUFPLENBQUMsSUFBSSxFQUFFLEdBQUcsV0FBVyxLQUFLLElBQUksTUFBTSxFQUFFO0FBQ3hEO0FBS08sU0FBUyxXQUFXLFFBQTRDO0FBQ3JFLE1BQUksT0FBTyxTQUFTLEVBQUcsUUFBTztBQUM5QixRQUFNLE9BQU8sT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDdEQsUUFBTSxNQUFNLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7QUFDdkQsUUFBTSxXQUFXLGtCQUFrQixNQUFNLEdBQUc7QUFDNUMsTUFBSSxDQUFDLFNBQVUsUUFBTztBQUV0QixRQUFNLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSTtBQUNwQixRQUFNLE9BQU8sSUFBSSxLQUFLLEtBQUssS0FBSztBQUNoQyxNQUFJLEVBQUUsT0FBTyxHQUFJLFFBQU87QUFDeEIsUUFBTSxTQUFTLEtBQUssS0FBSyxJQUFJO0FBQzdCLFFBQU0sU0FBUyxPQUFPLElBQUksQ0FBQyxNQUFNLEtBQUssTUFBTSxFQUFFLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsSUFBSSxNQUFNO0FBQzFFLFNBQU8sRUFBRSxRQUFRLENBQUMsSUFBSSxFQUFFLEdBQUcsUUFBUSxLQUFLLElBQUksTUFBTSxFQUFFO0FBQ3REO0FBSU8sU0FBUyxZQUFZLFFBQXNDO0FBQ2hFLFFBQU0sSUFBSSxPQUFPO0FBQ2pCLE1BQUksTUFBTSxFQUFHLE9BQU0sSUFBSSxXQUFXLCtCQUErQjtBQUNqRSxNQUFJLEtBQUs7QUFDVCxNQUFJLEtBQUs7QUFDVCxNQUFJLEtBQUs7QUFDVCxhQUFXLEtBQUssUUFBUTtBQUN0QixVQUFNLEVBQUUsQ0FBQztBQUNULFVBQU0sRUFBRSxDQUFDO0FBQ1QsVUFBTSxFQUFFLENBQUM7QUFBQSxFQUNYO0FBQ0EsUUFBTTtBQUNOLFFBQU07QUFDTixRQUFNO0FBRU4sTUFBSSxLQUFLO0FBQ1QsTUFBSSxLQUFLO0FBQ1QsTUFBSSxLQUFLO0FBQ1QsTUFBSSxLQUFLO0FBQ1QsTUFBSSxLQUFLO0FBQ1QsTUFBSSxLQUFLO0FBQ1QsYUFBVyxLQUFLLFFBQVE7QUFDdEIsVUFBTSxLQUFLLEVBQUUsQ0FBQyxJQUFJO0FBQ2xCLFVBQU0sS0FBSyxFQUFFLENBQUMsSUFBSTtBQUNsQixVQUFNLEtBQUssRUFBRSxDQUFDLElBQUk7QUFDbEIsVUFBTSxLQUFLO0FBQ1gsVUFBTSxLQUFLO0FBQ1gsVUFBTSxLQUFLO0FBQ1gsVUFBTSxLQUFLO0FBQ1gsVUFBTSxLQUFLO0FBQ1gsVUFBTSxLQUFLO0FBQUEsRUFDYjtBQUNBLFFBQU0sU0FBUztBQUFBLElBQ2IsQ0FBQyxLQUFLLEdBQUcsS0FBSyxHQUFHLEtBQUssQ0FBQztBQUFBLElBQ3ZCLENBQUMsS0FBSyxHQUFHLEtBQUssR0FBRyxLQUFLLENBQUM7QUFBQSxJQUN2QixDQUFDLEtBQUssR0FBRyxLQUFLLEdBQUcsS0FBSyxDQUFDO0FBQUEsRUFDekI7QUFDQSxTQUFPLEVBQUUsTUFBTSxDQUFDLElBQUksSUFBSSxFQUFFLEdBQUcsT0FBTztBQUN0QztBQUlBLFNBQVMsY0FBYyxHQUFlO0FBQ3BDLE1BQUksUUFBUTtBQUNaLFdBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLFFBQUksS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksS0FBSyxJQUFJLEVBQUUsS0FBSyxDQUFDLEVBQUcsU0FBUTtBQUFBLEVBQ25EO0FBQ0EsU0FBTyxFQUFFLEtBQUssSUFBSSxJQUFJLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSTtBQUNoRDtBQU1PLFNBQVMsZ0JBQWdCLFFBQXdCO0FBQ3RELFFBQU0sQ0FBQyxNQUFNLElBQUksSUFBSSxLQUFLLE1BQU07QUFDaEMsTUFBSSxTQUFTLEtBQUssU0FBUyxFQUFHLE9BQU0sSUFBSSxXQUFXLDJDQUEyQyxJQUFJLElBQUksSUFBSSxFQUFFO0FBRTVHLFFBQU0sSUFBSSxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxHQUFHLENBQUM7QUFDdEMsUUFBTSxJQUFJO0FBQUEsSUFDUixDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFDUixDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFDUixDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsRUFDVjtBQUNBLFFBQU0sUUFBNEI7QUFBQSxJQUNoQyxDQUFDLEdBQUcsQ0FBQztBQUFBLElBQ0wsQ0FBQyxHQUFHLENBQUM7QUFBQSxJQUNMLENBQUMsR0FBRyxDQUFDO0FBQUEsRUFDUDtBQUNBLFdBQVMsUUFBUSxHQUFHLFFBQVEsSUFBSSxTQUFTO0FBQ3ZDLFFBQUksTUFBTTtBQUNWLGVBQVcsQ0FBQyxHQUFHLENBQUMsS0FBSyxNQUFPLFFBQU8sS0FBSyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUNuRCxRQUFJLE9BQU8sTUFBTztBQUNsQixlQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssT0FBTztBQUMxQixZQUFNLE1BQU0sRUFBRSxDQUFDLEVBQUUsQ0FBQztBQUNsQixVQUFJLEtBQUssSUFBSSxHQUFHLEtBQUssT0FBUTtBQUM3QixZQUFNLFNBQVMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsTUFBTSxJQUFJO0FBQ3pDLFlBQU0sS0FBSyxTQUFTLElBQUksSUFBSSxPQUFPLEtBQUssSUFBSSxLQUFLLElBQUksS0FBSyxLQUFLLFFBQVEsUUFBUSxDQUFDO0FBQ2hGLFlBQU0sSUFBSSxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUksQ0FBQztBQUNqQyxZQUFNLElBQUksSUFBSTtBQUNkLGVBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLGNBQU0sTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDO0FBQ2xCLGNBQU0sTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDO0FBQ2xCLFVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLE1BQU0sSUFBSTtBQUN4QixVQUFFLENBQUMsRUFBRSxDQUFDLElBQUksSUFBSSxNQUFNLElBQUk7QUFBQSxNQUMxQjtBQUNBLGVBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLGNBQU0sTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDO0FBQ2xCLGNBQU0sTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDO0FBQ2xCLFVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLE1BQU0sSUFBSTtBQUN4QixVQUFFLENBQUMsRUFBRSxDQUFDLElBQUksSUFBSSxNQUFNLElBQUk7QUFBQSxNQUMxQjtBQUNBLGVBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLGNBQU0sTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDO0FBQ2xCLGNBQU0sTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDO0FBQ2xCLFVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLE1BQU0sSUFBSTtBQUN4QixVQUFFLENBQUMsRUFBRSxDQUFDLElBQUksSUFBSSxNQUFNLElBQUk7QUFBQSxNQUMxQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsUUFBTSxRQUFRLENBQUMsR0FBRyxHQUFHLENBQUMsRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDeEQsUUFBTSxTQUFTLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3ZDLFFBQU0sVUFBVSxNQUFNLElBQUksQ0FBQyxNQUFNLGNBQWMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFD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UUFBTSxZQUFZLENBQUMsR0FBRyxHQUFHLEVBQUUsRUFBRSxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUM7QUFDN0MsUUFBTSxTQUFpQixDQUFDO0FBQ3hCLFdBQVMsSUFBSSxJQUFJLEtBQUssR0FBRyxLQUFLO0FBQzVCLFdBQU8sS0FBSyxDQUFDLElBQUksVUFBVSxDQUFDLElBQUksR0FBRyxLQUFLLFVBQVUsQ0FBQyxJQUFJLEdBQUcsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUM7QUFBQSxFQUNqRjtBQUNBLFFBQU0sTUFBTSxjQUFjLE1BQU07QUFDaEMsU0FBTyxHQUFHLEdBQUc7QUFDYixTQUFPLEdBQUcsSUFBSSxNQUFNLEtBQUs7QUFDekIsUUFBTSxTQUFTLEtBQUs7QUFBQSxJQUNsQixJQUFJLFVBQVUsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxJQUFJLElBQUksVUFBVSxDQUFDLElBQUksVUFBVSxDQUFDLElBQUksSUFBSSxVQUFVLENBQUMsSUFBSSxVQUFVLENBQUM7QUFBQSxFQUNwRztBQUNBLFNBQU8sR0FBRyxLQUFLLElBQUksU0FBUyxDQUFDLElBQUksSUFBSTtBQUVyQyxTQUFPLEdBQUcsS0FBSyxNQUFNLElBQUksTUFBTSxDQUFDLElBQUksR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSTtBQUNuRixDQUFDO0FBRUQsS0FBSyx5RUFBeUUsTUFBTTtBQUNsRixRQUFNLFNBQWlCLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDO0FBQ25FLFFBQU0sTUFBTSxjQUFjLE1BQU07QUFDaEMsU0FBTyxHQUFHLEdBQUc7QUFDYixTQUFPLEdBQUcsSUFBSSxNQUFNLENBQUM7QUFFckIsU0FBTyxHQUFHLElBQUksT0FBTyxJQUFJLEtBQUs7QUFDaEMsQ0FBQztBQUVELEtBQUssMENBQTBDLE1BQU07QUFDbkQsU0FBTyxNQUFNLGNBQWMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUk7QUFDN0MsU0FBTyxNQUFNLGNBQWMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJO0FBQzFELENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
