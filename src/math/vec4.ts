// Minimal vec4 utilities — all functions return new arrays, no mutation.

import type { Vec3 } from './vec3.ts';

export type Vec4 = [number, number, number, number];

export function create(x = 0, y = 0, z = 0, w = 0): Vec4 {
  return [x, y, z, w];
}

export function add(a: Vec4, b: Vec4): Vec4 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
}

export function subtract(a: Vec4, b: Vec4): Vec4 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
}

export function scale(v: Vec4, s: number): Vec4 {
  return [v[0] * s, v[1] * s, v[2] * s, v[3] * s];
}

export function dot(a: Vec4, b: Vec4): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function length(v: Vec4): number {
  return Math.hypot(v[0], v[1], v[2], v[3]);
}

export function normalize(v: Vec4): Vec4 {
  const len = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len, v[3] / len];
}

export function fromVec3(v: Vec3, w = 1): Vec4 {
  return [v[0], v[1], v[2], w];
}

// Drop w. This is a truncation, never a perspective divide.
export function toVec3(v: Vec4): Vec3 {
  return [v[0], v[1], v[2]];
}

// Divide by w to leave homogeneous space. w = 0 is a direction, not a point, so
// the components pass through unchanged.
export function project(v: Vec4): Vec3 {
  const w = v[3] || 1;
  return [v[0] / w, v[1] / w, v[2] / w];
}
