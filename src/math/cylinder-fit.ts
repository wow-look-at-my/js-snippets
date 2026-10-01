// Least-squares infinite-cylinder fit to a 3D point cloud (Eberly's
// formulation). Pure math, no DOM/GPU.
//
// The energy is E(C, W, r) = mean( (|P(X - C)|^2 - r^2)^2 ), where P projects
// out the axis direction W. For a FIXED W both C and r have a closed form, so
// the fit reduces to a search over directions alone — that is what makes this
// tractable and what fitCylinderForAxis exposes on its own.
//
// The direction search is a deterministic hemisphere sweep plus a local pattern
// search. W and -W describe the same cylinder, so half the sphere covers every
// case. The sweep is what keeps a short, wide cylinder from converging onto the
// wrong axis: its point cloud is FLAT, so the principal axis of the cloud is
// perpendicular to the true axis, and a purely local search started there
// finds a minimum that fits nothing.

import { hammersley, uniformHemisphere } from './sampling.ts';
import { fitOrthoLine3 } from './least-squares.ts';
import type { Vec3 } from './vec3.ts';

export type CylinderFit = {
  // The axis point closest to the cloud centroid.
  center: Vec3;
  // Unit axis direction.
  axis: Vec3;
  radius: number;
  // Eberly's energy: mean((|P(X-C)|^2 - r^2)^2). Compare two fits with it.
  error: number;
  // Root mean square of the RADIAL residual |P(X-C)| - r, in point units.
  rms: number;
  // Extent along the axis, and the axis interval it spans relative to center.
  height: number;
  extent: [number, number];
};

export type CylinderFitOptions = {
  // Initial axis guess. Given one, the global sweep is skipped and only the
  // local search runs — use it to refine a known axis cheaply.
  direction?: Vec3;
  // Hemisphere directions tried in the global sweep. Default 256.
  directionSamples?: number;
  // Local pattern-search iterations after the sweep. Default 64.
  refineSteps?: number;
  // The local search stops once its angular step falls below this. Default 1e-9.
  tolerance?: number;
};

function project(w: Vec3, v: Vec3): Vec3 {
  const along = v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
  return [v[0] - along * w[0], v[1] - along * w[1], v[2] - along * w[2]];
}

function normalizeOrNull(v: Vec3): Vec3 | null {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 0)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// Any unit vector orthogonal to w. Picking the smallest component of w to cross
// against keeps the result well-conditioned for every input direction.
function anyOrthogonal(w: Vec3): Vec3 {
  const ax = Math.abs(w[0]);
  const ay = Math.abs(w[1]);
  const az = Math.abs(w[2]);
  const axis: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const cross: Vec3 = [
    w[1] * axis[2] - w[2] * axis[1],
    w[2] * axis[0] - w[0] * axis[2],
    w[0] * axis[1] - w[1] * axis[0],
  ];
  return normalizeOrNull(cross) ?? [1, 0, 0];
}

function centroid(points: readonly Vec3[]): Vec3 {
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

function axisExtent(points: readonly Vec3[], center: Vec3, axis: Vec3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const t =
      (p[0] - center[0]) * axis[0] + (p[1] - center[1]) * axis[1] + (p[2] - center[2]) * axis[2];
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return [lo, hi];
}

// The closed-form centre and radius for a GIVEN axis direction, plus the energy
// that direction achieves. Null when the projected cloud is degenerate (every
// point on the axis, or the direction is not a direction), because no radius is
// determined there.
export function fitCylinderForAxis(points: readonly Vec3[], direction: Vec3): CylinderFit | null {
  if (points.length < 5) return null;
  const w = normalizeOrNull(direction);
  if (!w) return null;

  const mean = centroid(points);
  const n = points.length;
  const projected: Vec3[] = [];
  const sqrLengths: number[] = [];

  // A = mean outer(PY, PY), B = mean |PY|^2 PY, both over mean-centred points.
  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b: Vec3 = [0, 0, 0];
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

  // Ahat = -S A S, with S the skew-symmetric cross-product matrix of w. Ahat is
  // the adjugate-like operator that inverts A inside the plane perpendicular to
  // w, where the centre offset lives.
  const s = [
    [0, -w[2], w[1]],
    [w[2], 0, -w[0]],
    [-w[1], w[0], 0],
  ];
  const sa = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
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
    [0, 0, 0],
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

  const offset: Vec3 = [0, 0, 0];
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
    const term =
      sqrLengths[i] - averageSqrLength - 2 * (y[0] * offset[0] + y[1] * offset[1] + y[2] * offset[2]);
    error += term * term;
    rsqr += (offset[0] - y[0]) ** 2 + (offset[1] - y[1]) ** 2 + (offset[2] - y[2]) ** 2;
  }
  error /= n;
  rsqr /= n;
  if (!(rsqr >= 0) || !Number.isFinite(error)) return null;

  const radius = Math.sqrt(rsqr);
  const center: Vec3 = [mean[0] + offset[0], mean[1] + offset[1], mean[2] + offset[2]];
  let radialSq = 0;
  for (let i = 0; i < n; i++) {
    const y = projected[i];
    const d =
      Math.hypot(y[0] - offset[0], y[1] - offset[1], y[2] - offset[2]) - radius;
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
    extent,
  };
}

// The candidate directions the global sweep tries: a Hammersley hemisphere set
// (deterministic, low-discrepancy) plus the cloud's own principal axis, which is
// the exact answer for a long thin cylinder and lets the sweep stay coarse.
function candidateDirections(points: readonly Vec3[], samples: number): Vec3[] {
  const out: Vec3[] = [];
  const principal = fitOrthoLine3(points);
  if (principal) out.push(principal.direction);
  for (let i = 0; i < samples; i++) {
    const [u, v] = hammersley(i, samples);
    // u = cos(theta) = 0 is the equator, which uniformHemisphere maps to a
    // direction in the XY plane. Every hemisphere direction is reachable.
    out.push(uniformHemisphere(u, v));
  }
  return out;
}

// Pattern search on the unit sphere: step along each tangent axis in both
// directions, take any improvement, and halve the step when none is found.
function refineDirection(
  points: readonly Vec3[],
  start: CylinderFit,
  steps: number,
  tolerance: number,
): CylinderFit {
  let best = start;
  let step = 0.1;
  for (let i = 0; i < steps && step > tolerance; i++) {
    const t1 = anyOrthogonal(best.axis);
    const t2: Vec3 = [
      best.axis[1] * t1[2] - best.axis[2] * t1[1],
      best.axis[2] * t1[0] - best.axis[0] * t1[2],
      best.axis[0] * t1[1] - best.axis[1] * t1[0],
    ];
    let improved = false;
    for (const tangent of [t1, t2]) {
      for (const sign of [1, -1]) {
        const candidate: Vec3 = [
          best.axis[0] + sign * step * tangent[0],
          best.axis[1] + sign * step * tangent[1],
          best.axis[2] + sign * step * tangent[2],
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

// Fit an infinite cylinder to the points. Null when the cloud cannot determine
// one: fewer than 5 points (a cylinder has 5 degrees of freedom), or every
// candidate axis degenerate.
//
// The returned axis is infinite; height and extent report how far the DATA
// reaches along it, so a caller drawing a capped cylinder has the interval.
export function fitCylinder(
  points: readonly Vec3[],
  options: CylinderFitOptions = {},
): CylinderFit | null {
  if (points.length < 5) return null;
  const samples = options.directionSamples ?? 256;
  const refineSteps = options.refineSteps ?? 64;
  const tolerance = options.tolerance ?? 1e-9;

  const candidates = options.direction ? [options.direction] : candidateDirections(points, samples);
  let best: CylinderFit | null = null;
  for (const direction of candidates) {
    const fit = fitCylinderForAxis(points, direction);
    if (fit && (!best || fit.error < best.error)) best = fit;
  }
  if (!best) return null;
  return refineDirection(points, best, refineSteps, tolerance);
}

// Signed distance from a point to the fitted INFINITE cylinder's surface:
// negative inside, positive outside. The caps are not considered.
export function distanceToCylinderSurface(fit: CylinderFit, p: Vec3): number {
  const radial = project(fit.axis, [p[0] - fit.center[0], p[1] - fit.center[1], p[2] - fit.center[2]]);
  return Math.hypot(radial[0], radial[1], radial[2]) - fit.radius;
}
