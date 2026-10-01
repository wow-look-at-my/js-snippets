// Tests for the least-squares fitting module. Every fit is checked against a
// case with a known exact answer, plus a noisy case where the recovered model
// must stay near the generator.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  solveLinear,
  transpose,
  matVec,
  solveLeastSquares,
  residuals,
  rms,
  evalPolynomial,
  fitPolynomial,
  fitLine,
  fitOrthoLine2,
  fitCircle2,
  covariance3,
  symmetricEigen3,
  fitPlane,
  fitOrthoLine3,
} from './least-squares.ts';
import type { Vec2 } from './vec2.ts';
import type { Vec3 } from './vec3.ts';

// Deterministic pseudo-random noise so a failure is always reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('solveLinear solves a square system exactly', () => {
  // 2x + y = 5, x - y = 1 has the solution (2, 1).
  const x = solveLinear([[2, 1], [1, -1]], [5, 1]);
  assert.ok(x);
  assert.ok(Math.abs(x[0] - 2) < 1e-12);
  assert.ok(Math.abs(x[1] - 1) < 1e-12);
});

test('solveLinear pivots, so a zero leading entry is fine', () => {
  const x = solveLinear([[0, 1], [1, 0]], [3, 4]);
  assert.deepEqual(x, [4, 3]);
});

test('solveLinear returns null for a singular matrix', () => {
  assert.equal(solveLinear([[1, 2], [2, 4]], [1, 2]), null);
  assert.equal(solveLinear([[0, 0], [0, 0]], [1, 1]), null);
});

test('solveLinear rejects a non-square matrix or a mismatched b', () => {
  assert.throws(() => solveLinear([[1, 2, 3], [4, 5, 6]], [1, 2]), RangeError);
  assert.throws(() => solveLinear([[1, 0], [0, 1]], [1]), RangeError);
});

test('transpose and matVec', () => {
  assert.deepEqual(transpose([[1, 2, 3], [4, 5, 6]]), [[1, 4], [2, 5], [3, 6]]);
  assert.deepEqual(matVec([[1, 2], [3, 4]], [1, 1]), [3, 7]);
  assert.throws(() => matVec([[1, 2]], [1, 2, 3]), RangeError);
  assert.throws(() => transpose([[1, 2], [3]]), RangeError);
});

test('solveLeastSquares reproduces an exactly-consistent overdetermined system', () => {
  // Three points exactly on y = 2x + 1, fitted as [intercept, slope].
  const a = [[1, 0], [1, 1], [1, 2]];
  const b = [1, 3, 5];
  const x = solveLeastSquares(a, b);
  assert.ok(x);
  assert.ok(Math.abs(x[0] - 1) < 1e-12);
  assert.ok(Math.abs(x[1] - 2) < 1e-12);
  assert.ok(rms(residuals(a, x, b)) < 1e-12);
});

test('solveLeastSquares minimises the residual on an inconsistent system', () => {
  // A single unknown against three conflicting measurements: the least-squares
  // answer is their mean.
  const a = [[1], [1], [1]];
  const x = solveLeastSquares(a, [1, 2, 6]);
  assert.ok(x);
  assert.ok(Math.abs(x[0] - 3) < 1e-12);
});

test('solveLeastSquares returns null on a rank-deficient system, and a ridge rescues it', () => {
  // The second column is a copy of the first, so the normal matrix is singular.
  const a = [[1, 1], [2, 2], [3, 3]];
  const b = [1, 2, 3];
  assert.equal(solveLeastSquares(a, b), null);
  const ridged = solveLeastSquares(a, b, 1e-6);
  assert.ok(ridged);
  // The ridge splits the shared slope between the two identical columns.
  assert.ok(Math.abs(ridged[0] + ridged[1] - 1) < 1e-4);
});

test('rms of an empty residual vector is 0', () => {
  assert.equal(rms([]), 0);
  assert.equal(rms([3, 4]), Math.sqrt(12.5));
});

test('evalPolynomial uses ascending coefficient order', () => {
  // 1 + 2x + 3x^2 at x = 2 is 1 + 4 + 12.
  assert.equal(evalPolynomial([1, 2, 3], 2), 17);
  assert.equal(evalPolynomial([], 5), 0);
  assert.equal(evalPolynomial([7], 5), 7);
});

test('fitPolynomial recovers an exact cubic', () => {
  const truth = [2, -3, 0.5, 1];
  const xs = [-3, -2, -1, 0, 1, 2, 3, 4];
  const ys = xs.map((x) => evalPolynomial(truth, x));
  const fit = fitPolynomial(xs, ys, 3);
  assert.ok(fit);
  for (let i = 0; i < truth.length; i++) {
    assert.ok(Math.abs(fit[i] - truth[i]) < 1e-9, `coefficient ${i}: ${fit[i]} vs ${truth[i]}`);
  }
});

test('fitPolynomial stays accurate on x values far from the origin', () => {
  // A raw Vandermonde matrix on x near 1e6 loses the quadratic term. The
  // internal centring is what keeps this case solvable.
  const truth = [5, -2, 0.25];
  const xs = [1e6, 1e6 + 1, 1e6 + 2, 1e6 + 3, 1e6 + 4];
  const ys = xs.map((x) => evalPolynomial(truth, x));
  const fit = fitPolynomial(xs, ys, 2);
  assert.ok(fit);
  // Compare through the model rather than coefficient by coefficient: the
  // constant term at this offset is enormous and carries the round-off.
  for (const x of xs) {
    const predicted = evalPolynomial(fit, x);
    const expected = evalPolynomial(truth, x);
    assert.ok(Math.abs(predicted - expected) < Math.abs(expected) * 1e-6 + 1e-6);
  }
});

test('fitPolynomial of degree 0 is the mean', () => {
  const fit = fitPolynomial([0, 1, 2], [1, 2, 6], 0);
  assert.ok(fit);
  assert.ok(Math.abs(fit[0] - 3) < 1e-12);
});

test('fitPolynomial rejects too few points and a bad degree', () => {
  assert.throws(() => fitPolynomial([0, 1], [0, 1], 2), RangeError);
  assert.throws(() => fitPolynomial([0, 1], [0], 1), RangeError);
  assert.throws(() => fitPolynomial([0, 1], [0, 1], -1), RangeError);
});

test('fitLine recovers a known slope and intercept, with zero rms on exact data', () => {
  const xs = [0, 1, 2, 3, 4];
  const ys = xs.map((x) => 3 * x - 2);
  const fit = fitLine(xs, ys);
  assert.ok(fit);
  assert.ok(Math.abs(fit.slope - 3) < 1e-12);
  assert.ok(Math.abs(fit.intercept + 2) < 1e-12);
  assert.ok(fit.rms < 1e-12);
});

test('fitLine stays near the generator under noise', () => {
  const rand = mulberry32(7);
  const xs: number[] = [];
  const ys: number[] = [];
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

test('fitLine returns null for vertical data and rejects mismatched input', () => {
  assert.equal(fitLine([2, 2, 2], [0, 1, 2]), null);
  assert.throws(() => fitLine([0, 1], [0]), RangeError);
  assert.throws(() => fitLine([0], [0]), RangeError);
});

test('fitOrthoLine2 handles the vertical line that fitLine cannot', () => {
  const points: Vec2[] = [[2, -1], [2, 0], [2, 1], [2, 5]];
  const fit = fitOrthoLine2(points);
  assert.ok(fit);
  assert.ok(fit.rms < 1e-12);
  // The direction is the y axis (either sign) and the point is on x = 2.
  assert.ok(Math.abs(Math.abs(fit.direction[1]) - 1) < 1e-12);
  assert.ok(Math.abs(fit.direction[0]) < 1e-12);
  assert.ok(Math.abs(fit.point[0] - 2) < 1e-12);
});

test('fitOrthoLine2 recovers a diagonal line exactly', () => {
  const points: Vec2[] = [[0, 0], [1, 1], [2, 2], [3, 3]];
  const fit = fitOrthoLine2(points);
  assert.ok(fit);
  assert.ok(fit.rms < 1e-12);
  const d = fit.direction;
  assert.ok(Math.abs(Math.abs(d[0]) - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(Math.abs(d[1]) - Math.SQRT1_2) < 1e-12);
  // Both coordinates carry the same sign on a 45-degree line.
  assert.ok(d[0] * d[1] > 0);
});

test('fitOrthoLine2 rejects degenerate input', () => {
  assert.equal(fitOrthoLine2([[1, 1]]), null);
  assert.equal(fitOrthoLine2([[1, 1], [1, 1], [1, 1]]), null);
});

test('fitCircle2 recovers a known circle exactly', () => {
  const center: Vec2 = [-3, 4];
  const radius = 2.5;
  const points: Vec2[] = [];
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * 2 * Math.PI;
    points.push([center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)]);
  }
  const fit = fitCircle2(points);
  assert.ok(fit);
  assert.ok(Math.abs(fit.center[0] - center[0]) < 1e-10);
  assert.ok(Math.abs(fit.center[1] - center[1]) < 1e-10);
  assert.ok(Math.abs(fit.radius - radius) < 1e-10);
  assert.ok(fit.rms < 1e-10);
});

test('fitCircle2 works from a short arc and reports a real geometric rms', () => {
  const points: Vec2[] = [];
  for (let i = 0; i < 8; i++) {
    const t = (i / 40) * 2 * Math.PI;
    points.push([10 * Math.cos(t), 10 * Math.sin(t)]);
  }
  const fit = fitCircle2(points);
  assert.ok(fit);
  assert.ok(Math.abs(fit.radius - 10) < 1e-6, `radius ${fit.radius}`);
  assert.ok(fit.rms < 1e-6);
});

test('fitCircle2 rejects fewer than three points and collinear points', () => {
  assert.equal(fitCircle2([[0, 0], [1, 1]]), null);
  assert.equal(fitCircle2([[0, 0], [1, 1], [2, 2], [3, 3]]), null);
});

test('covariance3 reports the mean and a symmetric matrix', () => {
  const points: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 2, 0], [0, -2, 0]];
  const { mean, matrix } = covariance3(points);
  assert.deepEqual(mean, [0, 0, 0]);
  assert.ok(Math.abs(matrix[0][0] - 0.5) < 1e-12);
  assert.ok(Math.abs(matrix[1][1] - 2) < 1e-12);
  assert.equal(matrix[2][2], 0);
  assert.equal(matrix[0][1], matrix[1][0]);
  assert.throws(() => covariance3([]), RangeError);
});

test('symmetricEigen3 diagonalises a diagonal matrix, ascending', () => {
  const { values, vectors } = symmetricEigen3([[3, 0, 0], [0, 1, 0], [0, 0, 2]]);
  assert.ok(Math.abs(values[0] - 1) < 1e-12);
  assert.ok(Math.abs(values[1] - 2) < 1e-12);
  assert.ok(Math.abs(values[2] - 3) < 1e-12);
  // The eigenvectors are the axes, in the same order as the values.
  assert.ok(Math.abs(Math.abs(vectors[0][1]) - 1) < 1e-12);
  assert.ok(Math.abs(Math.abs(vectors[1][2]) - 1) < 1e-12);
  assert.ok(Math.abs(Math.abs(vectors[2][0]) - 1) < 1e-12);
});

test('symmetricEigen3 eigenvectors satisfy A v = lambda v and are orthonormal', () => {
  const m = [
    [4, 1, -2],
    [1, 2, 0],
    [-2, 0, 3],
  ];
  const { values, vectors } = symmetricEigen3(m);
  for (let k = 0; k < 3; k++) {
    const v = vectors[k];
    assert.ok(Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-12, 'unit length');
    for (let i = 0; i < 3; i++) {
      const av = m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2];
      assert.ok(Math.abs(av - values[k] * v[i]) < 1e-9, `row ${i} of eigenpair ${k}`);
    }
  }
  const pairs: [number, number][] = [[0, 1], [0, 2], [1, 2]];
  for (const [i, j] of pairs) {
    const d =
      vectors[i][0] * vectors[j][0] + vectors[i][1] * vectors[j][1] + vectors[i][2] * vectors[j][2];
    assert.ok(Math.abs(d) < 1e-9, `orthogonality of ${i},${j}`);
  }
  // The trace is preserved.
  assert.ok(Math.abs(values[0] + values[1] + values[2] - 9) < 1e-9);
  assert.ok(values[0] <= values[1] && values[1] <= values[2]);
});

test('symmetricEigen3 rejects a matrix that is not 3x3', () => {
  assert.throws(() => symmetricEigen3([[1, 0], [0, 1]]), RangeError);
});

test('fitPlane recovers a tilted plane exactly', () => {
  // The plane z = 2x - y + 3 has the normal (2, -1, -1) up to scale and sign.
  const points: Vec3[] = [];
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
    fit.normal[0] * expected[0] + fit.normal[1] * expected[1] + fit.normal[2] * expected[2],
  );
  assert.ok(Math.abs(dotAbs - 1) < 1e-9, `normal ${fit.normal}`);
  // The plane passes through the centroid, so the point satisfies the equation.
  assert.ok(Math.abs(fit.point[2] - (2 * fit.point[0] - fit.point[1] + 3)) < 1e-9);
});

test('fitPlane stays near the generator under noise', () => {
  const rand = mulberry32(11);
  const points: Vec3[] = [];
  for (let i = 0; i < 600; i++) {
    const x = rand() * 10 - 5;
    const y = rand() * 10 - 5;
    points.push([x, y, 0.5 * x + 0.25 * y + 1 + (rand() - 0.5) * 0.05]);
  }
  const fit = fitPlane(points);
  assert.ok(fit);
  const expected = [0.5, 0.25, -1].map((c) => c / Math.hypot(0.5, 0.25, 1));
  const dotAbs = Math.abs(
    fit.normal[0] * expected[0] + fit.normal[1] * expected[1] + fit.normal[2] * expected[2],
  );
  assert.ok(Math.abs(dotAbs - 1) < 1e-3, `normal ${fit.normal}`);
  assert.ok(fit.rms < 0.05);
});

test('fitPlane returns null for collinear points: their normal is arbitrary', () => {
  const points: Vec3[] = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3]];
  assert.equal(fitPlane(points), null);
  assert.equal(fitPlane([[0, 0, 0], [1, 0, 0]]), null);
});

test('fitOrthoLine3 recovers a 3D line exactly', () => {
  const direction = [1, 2, -2].map((c) => c / 3);
  const points: Vec3[] = [];
  for (let i = -4; i <= 4; i++) {
    points.push([1 + direction[0] * i, -2 + direction[1] * i, 5 + direction[2] * i]);
  }
  const fit = fitOrthoLine3(points);
  assert.ok(fit);
  assert.ok(fit.rms < 1e-12);
  const dotAbs = Math.abs(
    fit.direction[0] * direction[0] + fit.direction[1] * direction[1] + fit.direction[2] * direction[2],
  );
  assert.ok(Math.abs(dotAbs - 1) < 1e-9);
  // The centroid of a symmetric sample is the line's own anchor point.
  assert.ok(Math.hypot(fit.point[0] - 1, fit.point[1] + 2, fit.point[2] - 5) < 1e-9);
});

test('fitOrthoLine3 rms is the orthogonal distance, not a vertical residual', () => {
  // Two points off the x axis by exactly 1 in +y and -y, and two on it.
  const points: Vec3[] = [[0, 0, 0], [1, 1, 0], [2, 0, 0], [3, -1, 0]];
  const fit = fitOrthoLine3(points);
  assert.ok(fit);
  assert.ok(fit.rms > 0);
  // Every residual must be at most the largest offset.
  assert.ok(fit.rms <= 1 + 1e-12);
});

test('fitOrthoLine3 rejects degenerate input', () => {
  assert.equal(fitOrthoLine3([[1, 2, 3]]), null);
  assert.equal(fitOrthoLine3([[1, 2, 3], [1, 2, 3]]), null);
});
