// Minimal vec2 utilities — all functions return new arrays, no mutation.

export type Vec2 = [number, number];

export function create(x = 0, y = 0): Vec2 {
  return [x, y];
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}

export function subtract(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function scale(v: Vec2, s: number): Vec2 {
  return [v[0] * s, v[1] * s];
}

export function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

// The z component of the 3D cross product: positive when b is counter-clockwise
// from a. It is also the signed area of the parallelogram the two vectors span.
export function cross(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

// Rotate a quarter turn counter-clockwise. perp(v) is orthogonal to v. The x
// component subtracts instead of negating, because -0 is not deep-equal to 0
// and a caller comparing perp([1, 0]) against [0, 1] must not fail.
export function perp(v: Vec2): Vec2 {
  return [0 - v[1], v[0]];
}

export function length(v: Vec2): number {
  return Math.hypot(v[0], v[1]);
}

export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / len, v[1] / len];
}
