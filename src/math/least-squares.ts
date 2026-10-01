// Least-squares fitting. Pure, dependency-free, no DOM/GPU.
//
// Two families live here. The LINEAR solvers minimise the residual of A x = b
// in the vertical sense: each row is one equation and the unknowns are linear.
// The GEOMETRIC fits minimise the ORTHOGONAL distance to a line, a plane or a
// circle, which is a different quantity and the one that makes sense when both
// coordinates carry error. A y-on-x line fit tips over as the line turns
// vertical. An orthogonal fit does not.
//
// A singular system returns null rather than a vector of NaN or Infinity: the
// caller decides what an unconstrained fit means.

import type { Vec2 } from './vec2.ts';
import type { Vec3 } from './vec3.ts';

// Row-major: matrix[row][col]. Every row must have the same length.
export type Matrix = readonly (readonly number[])[];

export type LineFit2 = { slope: number; intercept: number; rms: number };
export type OrthoLineFit2 = { point: Vec2; direction: Vec2; rms: number };
export type OrthoLineFit3 = { point: Vec3; direction: Vec3; rms: number };
export type PlaneFit = { point: Vec3; normal: Vec3; rms: number };
export type CircleFit2 = { center: Vec2; radius: number; rms: number };
export type Eigen3 = { values: [number, number, number]; vectors: [Vec3, Vec3, Vec3] };
export type Covariance3 = { mean: Vec3; matrix: number[][] };

function dims(a: Matrix): [number, number] {
  const rows = a.length;
  if (rows === 0) throw new RangeError('matrix has no rows');
  const cols = a[0].length;
  for (const row of a) {
    if (row.length !== cols) throw new RangeError('matrix rows have unequal lengths');
  }
  return [rows, cols];
}

// Gaussian elimination with partial pivoting on a copy. Returns null when the
// matrix is singular to working precision.
export function solveLinear(a: Matrix, b: readonly number[]): number[] | null {
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

  const x = new Array<number>(cols).fill(0);
  for (let r = cols - 1; r >= 0; r--) {
    let acc = m[r][cols];
    for (let c = r + 1; c < cols; c++) acc -= m[r][c] * x[c];
    x[r] = acc / m[r][r];
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

export function transpose(a: Matrix): number[][] {
  const [rows, cols] = dims(a);
  const out: number[][] = [];
  for (let c = 0; c < cols; c++) {
    const row = new Array<number>(rows);
    for (let r = 0; r < rows; r++) row[r] = a[r][c];
    out.push(row);
  }
  return out;
}

export function matVec(a: Matrix, x: readonly number[]): number[] {
  const [rows, cols] = dims(a);
  if (x.length !== cols) throw new RangeError(`matVec: x has ${x.length} entries, want ${cols}`);
  const out = new Array<number>(rows).fill(0);
  for (let r = 0; r < rows; r++) {
    let acc = 0;
    for (let c = 0; c < cols; c++) acc += a[r][c] * x[c];
    out[r] = acc;
  }
  return out;
}

// Solve the normal equations (A^T A + ridge I) x = A^T b. The ridge term is
// Tikhonov regularisation: it is 0 by default, and a small positive value makes
// a rank-deficient or ill-conditioned system solvable at the cost of bias.
export function solveLeastSquares(a: Matrix, b: readonly number[], ridge = 0): number[] | null {
  const [rows, cols] = dims(a);
  if (b.length !== rows) throw new RangeError(`solveLeastSquares: b has ${b.length} entries, want ${rows}`);

  const normal: number[][] = [];
  for (let i = 0; i < cols; i++) {
    const row = new Array<number>(cols).fill(0);
    for (let j = 0; j < cols; j++) {
      let acc = 0;
      for (let r = 0; r < rows; r++) acc += a[r][i] * a[r][j];
      row[j] = i === j ? acc + ridge : acc;
    }
    normal.push(row);
  }
  const rhs = new Array<number>(cols).fill(0);
  for (let i = 0; i < cols; i++) {
    let acc = 0;
    for (let r = 0; r < rows; r++) acc += a[r][i] * b[r];
    rhs[i] = acc;
  }
  return solveLinear(normal, rhs);
}

export function residuals(a: Matrix, x: readonly number[], b: readonly number[]): number[] {
  const predicted = matVec(a, x);
  if (b.length !== predicted.length) {
    throw new RangeError(`residuals: b has ${b.length} entries, want ${predicted.length}`);
  }
  return predicted.map((p, i) => b[i] - p);
}

// Root mean square of a residual vector. An empty vector has no mean, so 0.
export function rms(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let acc = 0;
  for (const v of values) acc += v * v;
  return Math.sqrt(acc / values.length);
}

// Coefficients in ASCENDING power order: [c0, c1, ...] means c0 + c1 x + ...
export function evalPolynomial(coeffs: readonly number[], x: number): number {
  let acc = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) acc = acc * x + coeffs[i];
  return acc;
}

// Least-squares polynomial of the given degree through (xs, ys). Coefficients
// come back in ascending power order. The x values are centred and scaled
// internally, then the fit is mapped back, because a raw Vandermonde matrix on
// large x loses the high-order terms to conditioning.
export function fitPolynomial(
  xs: readonly number[],
  ys: readonly number[],
  degree: number,
): number[] | null {
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
    const row = new Array<number>(degree + 1);
    let power = 1;
    for (let k = 0; k <= degree; k++) {
      row[k] = power;
      power *= t;
    }
    return row;
  });
  const shifted = solveLeastSquares(vandermonde, ys);
  if (!shifted) return null;

  // Expand sum_k shifted[k] * ((x - center)/scaleX)^k back into powers of x.
  const out = new Array<number>(degree + 1).fill(0);
  for (let k = 0; k <= degree; k++) {
    if (shifted[k] === 0) continue;
    // Binomial expansion of (x - center)^k, divided by scaleX^k.
    let binom = 1;
    for (let j = 0; j <= k; j++) {
      const term = binom * Math.pow(-center, k - j) / Math.pow(scaleX, k);
      out[j] += shifted[k] * term;
      binom = (binom * (k - j)) / (j + 1);
    }
  }
  return out;
}

// Ordinary y-on-x line fit: minimises the vertical residual. Vertical data has
// no finite slope, so this returns null there — use fitOrthoLine2 instead.
export function fitLine(xs: readonly number[], ys: readonly number[]): LineFit2 | null {
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

// Symmetric 2x2 eigen decomposition, used by the orthogonal 2D fits. Returns
// the eigenvalues ascending with their unit eigenvectors.
function eigen2(xx: number, xy: number, yy: number): { values: [number, number]; vectors: [Vec2, Vec2] } {
  const half = (xx + yy) / 2;
  const diff = (xx - yy) / 2;
  const root = Math.hypot(diff, xy);
  const large = half + root;
  const small = half - root;
  // (xx - lambda) vx + xy vy = 0 gives this eigenvector for the LARGE value.
  let major: Vec2 = Math.abs(xy) > Number.EPSILON ? [large - yy, xy] : xx >= yy ? [1, 0] : [0, 1];
  const len = Math.hypot(major[0], major[1]) || 1;
  major = [major[0] / len, major[1] / len];
  const minor: Vec2 = [-major[1], major[0]];
  return { values: [small, large], vectors: [minor, major] };
}

// Total-least-squares line through 2D points: minimises the PERPENDICULAR
// distance, so it handles a vertical line and does not favour either axis. The
// direction is the principal axis of the point cloud, and the point is its
// centroid. Fewer than 2 points, or coincident points, is null.
export function fitOrthoLine2(points: readonly Vec2[]): OrthoLineFit2 | null {
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

// Algebraic (Kasa) circle fit: x^2 + y^2 = 2 a x + 2 b y + c is LINEAR in
// (a, b, c), so one least-squares solve gives the centre and radius. The
// reported rms is the true geometric residual, |p - centre| - radius, not the
// algebraic one the solve minimises. Collinear points have no circle: null.
export function fitCircle2(points: readonly Vec2[]): CircleFit2 | null {
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

// Mean and the 3x3 covariance matrix (divided by the point count) of a 3D point
// cloud. This is the input to every orthogonal 3D fit below.
export function covariance3(points: readonly Vec3[]): Covariance3 {
  const n = points.length;
  if (n === 0) throw new RangeError('covariance3: empty point list');
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
    [xz / n, yz / n, zz / n],
  ];
  return { mean: [mx, my, mz], matrix };
}

// Sign convention: the component of largest magnitude is made positive, so the
// same cloud always yields the same eigenvectors instead of an arbitrary flip.
function canonicalSign(v: Vec3): Vec3 {
  let index = 0;
  for (let i = 1; i < 3; i++) {
    if (Math.abs(v[i]) > Math.abs(v[index])) index = i;
  }
  return v[index] < 0 ? [-v[0], -v[1], -v[2]] : v;
}

// Cyclic Jacobi rotations on a symmetric 3x3. Eigenvalues come back ascending,
// with the matching orthonormal eigenvectors. Jacobi is used rather than the
// closed-form cubic because it stays accurate on a near-degenerate matrix,
// which is exactly the case a flat or rod-shaped point cloud produces.
export function symmetricEigen3(matrix: Matrix): Eigen3 {
  const [rows, cols] = dims(matrix);
  if (rows !== 3 || cols !== 3) throw new RangeError(`symmetricEigen3 needs a 3x3 matrix, got ${rows}x${cols}`);

  const a = matrix.map((row) => [...row]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const pairs: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 2],
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
  const values = order.map((i) => a[i][i]) as [number, number, number];
  const vectors = order.map((i) => canonicalSign([v[0][i], v[1][i], v[2][i]])) as [Vec3, Vec3, Vec3];
  return { values, vectors };
}

// Best-fit plane through 3D points: the normal is the eigenvector of the
// smallest covariance eigenvalue, and the plane passes through the centroid.
// The rms is the orthogonal point-to-plane distance.
export function fitPlane(points: readonly Vec3[]): PlaneFit | null {
  if (points.length < 3) return null;
  const { mean, matrix } = covariance3(points);
  const { values, vectors } = symmetricEigen3(matrix);
  // Two distinct directions must carry variance, or the cloud is a line/point
  // and its normal is arbitrary.
  if (values[1] <= Number.EPSILON * (values[2] || 1)) return null;

  const normal = vectors[0];
  const errors = points.map(
    (p) => normal[0] * (p[0] - mean[0]) + normal[1] * (p[1] - mean[1]) + normal[2] * (p[2] - mean[2]),
  );
  return { point: mean, normal, rms: rms(errors) };
}

// Best-fit line through 3D points: the direction is the eigenvector of the
// LARGEST covariance eigenvalue. The rms is the orthogonal point-to-line
// distance.
export function fitOrthoLine3(points: readonly Vec3[]): OrthoLineFit3 | null {
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
