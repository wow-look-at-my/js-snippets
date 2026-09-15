// Arbitrary-dimension vector utilities — all functions return new arrays, no
// mutation. Use these when the dimension is data-driven (a feature vector, a
// polynomial coefficient list, a least-squares row). For a fixed 2/3/4
// dimension prefer vec2/vec3/vec4: those are monomorphic and faster.
//
// Every binary operation REQUIRES equal lengths and throws otherwise. A silent
// shortest-wins or zero-fill turns a wiring mistake into a plausible number.

export type VecN = number[];

function requireSameLength(a: readonly number[], b: readonly number[], op: string): void {
  if (a.length !== b.length) {
    throw new RangeError(`vecn.${op}: length mismatch (${a.length} vs ${b.length})`);
  }
}

export function create(n: number, fill = 0): VecN {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`vecn.create: n must be a non-negative integer, got ${n}`);
  }
  return new Array<number>(n).fill(fill);
}

export function clone(v: readonly number[]): VecN {
  return v.slice();
}

export function add(a: readonly number[], b: readonly number[]): VecN {
  requireSameLength(a, b, 'add');
  return a.map((x, i) => x + b[i]);
}

export function subtract(a: readonly number[], b: readonly number[]): VecN {
  requireSameLength(a, b, 'subtract');
  return a.map((x, i) => x - b[i]);
}

export function multiply(a: readonly number[], b: readonly number[]): VecN {
  requireSameLength(a, b, 'multiply');
  return a.map((x, i) => x * b[i]);
}

export function scale(v: readonly number[], s: number): VecN {
  return v.map((x) => x * s);
}

export function negate(v: readonly number[]): VecN {
  return v.map((x) => -x);
}

export function dot(a: readonly number[], b: readonly number[]): number {
  requireSameLength(a, b, 'dot');
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function length(v: readonly number[]): number {
  return Math.hypot(...v);
}

export function lengthSq(v: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return sum;
}

export function distance(a: readonly number[], b: readonly number[]): number {
  requireSameLength(a, b, 'distance');
  return Math.hypot(...a.map((x, i) => x - b[i]));
}

// A zero vector stays zero: the length falls back to 1, so no component is NaN.
export function normalize(v: readonly number[]): VecN {
  const len = Math.hypot(...v) || 1;
  return v.map((x) => x / len);
}

export function lerp(a: readonly number[], b: readonly number[], t: number): VecN {
  requireSameLength(a, b, 'lerp');
  return a.map((x, i) => x + (b[i] - x) * t);
}

export function sum(v: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < v.length; i++) total += v[i];
  return total;
}

// The componentwise mean of a list of equal-length vectors. An empty list has
// no mean, so it throws.
export function mean(vectors: readonly (readonly number[])[]): VecN {
  if (vectors.length === 0) throw new RangeError('vecn.mean: empty list has no mean');
  const out = create(vectors[0].length);
  for (const v of vectors) {
    requireSameLength(out, v, 'mean');
    for (let i = 0; i < out.length; i++) out[i] += v[i];
  }
  return out.map((x) => x / vectors.length);
}
