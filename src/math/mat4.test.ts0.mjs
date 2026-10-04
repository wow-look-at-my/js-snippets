// src/math/mat4.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/math/vec3.ts
function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// src/math/mat4.ts
function identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = near * far / (near - far);
  return m;
}
function perspectiveGL(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}
function lookAt(eye, center, up) {
  const z = normalize(subtract(eye, center));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0];
  m[1] = y[0];
  m[2] = z[0];
  m[4] = x[1];
  m[5] = y[1];
  m[6] = z[1];
  m[8] = x[2];
  m[9] = y[2];
  m[10] = z[2];
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  m[15] = 1;
  return m;
}
function multiply(a, b) {
  const m = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      m[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
  }
  return m;
}
function translate(m, v) {
  const t = identity();
  t[12] = v[0];
  t[13] = v[1];
  t[14] = v[2];
  return multiply(m, t);
}
function rotateZ(m, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = identity();
  r[0] = c;
  r[1] = s;
  r[4] = -s;
  r[5] = c;
  return multiply(m, r);
}
function scale(m, v) {
  const s = identity();
  s[0] = v[0];
  s[5] = v[1];
  s[10] = v[2];
  return multiply(m, s);
}
function normalMatrix(m) {
  const inv = invert(m);
  if (!inv) return identity();
  const n = identity();
  n[0] = inv[0];
  n[1] = inv[4];
  n[2] = inv[8];
  n[4] = inv[1];
  n[5] = inv[5];
  n[6] = inv[9];
  n[8] = inv[2];
  n[9] = inv[6];
  n[10] = inv[10];
  return n;
}
function normalMatrix3(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[4], a11 = m[5], a12 = m[6];
  const a20 = m[8], a21 = m[9], a22 = m[10];
  const det = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  if (det === 0) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const id = 1 / det;
  return new Float32Array([
    (a11 * a22 - a21 * a12) * id,
    (a20 * a12 - a10 * a22) * id,
    (a10 * a21 - a20 * a11) * id,
    (a21 * a02 - a01 * a22) * id,
    (a00 * a22 - a20 * a02) * id,
    (a20 * a01 - a00 * a21) * id,
    (a01 * a12 - a11 * a02) * id,
    (a10 * a02 - a00 * a12) * id,
    (a00 * a11 - a10 * a01) * id
  ]);
}
function transpose(m) {
  const t = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      t[c * 4 + r] = m[r * 4 + c];
    }
  }
  return t;
}
function invert(m) {
  const inv = new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (Math.abs(det) < 1e-8) return null;
  const invDet = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= invDet;
  return inv;
}

// src/math/mat4.test.ts
var close = (a, b, tol = 1e-5) => Math.abs(a - b) <= tol;
function assertMatClose(a, b, tol = 1e-5, msg = "") {
  assert.equal(a.length, b.length, `length ${msg}`);
  for (let i = 0; i < a.length; i++) {
    assert.ok(close(a[i], b[i], tol), `${msg} index ${i}: ${a[i]} != ${b[i]}`);
  }
}
function apply(m, p) {
  const [x, y, z, w] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w
  ];
}
test("identity is the column-major 4x4 identity", () => {
  assertMatClose(
    identity(),
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    0,
    "identity"
  );
});
test("multiply by identity is a no-op on either side", () => {
  const m = scale(translate(identity(), [1, 2, 3]), [2, 3, 4]);
  assertMatClose(multiply(m, identity()), m, 1e-6, "m*I");
  assertMatClose(multiply(identity(), m), m, 1e-6, "I*m");
});
test("multiply is associative", () => {
  const a = translate(identity(), [1, 0, -2]);
  const b = rotateZ(identity(), 0.5);
  const c = scale(identity(), [2, 0.5, 3]);
  assertMatClose(multiply(multiply(a, b), c), multiply(a, multiply(b, c)), 1e-5, "(ab)c == a(bc)");
});
test("perspective uses WebGPU clip-Z: -near -> 0, -far -> 1 after divide", () => {
  const near = 0.5, far = 100;
  const m = perspective(Math.PI / 3, 1.5, near, far);
  const cn = apply(m, [0, 0, -near, 1]);
  assert.ok(close(cn[3], near, 1e-5), `w at near = ${cn[3]}`);
  assert.ok(close(cn[2] / cn[3], 0, 1e-5), `ndc-z at near = ${cn[2] / cn[3]}`);
  const cf = apply(m, [0, 0, -far, 1]);
  assert.ok(close(cf[3], far, 1e-4), `w at far = ${cf[3]}`);
  assert.ok(close(cf[2] / cf[3], 1, 1e-5), `ndc-z at far = ${cf[2] / cf[3]}`);
});
test("perspectiveGL uses OpenGL clip-Z: -near -> -1, -far -> +1 after divide", () => {
  const near = 0.5, far = 100;
  const m = perspectiveGL(Math.PI / 3, 1.5, near, far);
  const cn = apply(m, [0, 0, -near, 1]);
  assert.ok(close(cn[2] / cn[3], -1, 1e-5), `ndc-z at near = ${cn[2] / cn[3]}`);
  const cf = apply(m, [0, 0, -far, 1]);
  assert.ok(close(cf[2] / cf[3], 1, 1e-5), `ndc-z at far = ${cf[2] / cf[3]}`);
});
test("perspective sets the standard projection entries (aspect, fov, w = -z)", () => {
  const m = perspective(Math.PI / 2, 2, 1, 10);
  assert.ok(close(m[5], 1, 1e-6), `m[5] = ${m[5]}`);
  assert.ok(close(m[0], 0.5, 1e-6), `m[0] = ${m[0]}`);
  assert.equal(m[11], -1);
});
test("lookAt places the eye at the origin of view space", () => {
  const eye = [0, 0, 5];
  const center = [0, 0, 0];
  const up = [0, 1, 0];
  const v = lookAt(eye, center, up);
  const e = apply(v, [eye[0], eye[1], eye[2], 1]);
  assert.ok(close(e[0], 0) && close(e[1], 0) && close(e[2], 0), `eye -> ${e.slice(0, 3)}`);
  const c = apply(v, [center[0], center[1], center[2], 1]);
  assert.ok(c[2] < 0, `center view-z should be negative, got ${c[2]}`);
});
test("invert round-trips: m * inv(m) == identity", () => {
  const m = scale(rotateZ(translate(identity(), [2, -3, 1]), 0.7), [1.5, 2, 0.5]);
  const inv = invert(m);
  assert.ok(inv, "invert returned null for an invertible matrix");
  assertMatClose(multiply(m, inv), identity(), 1e-4, "m * inv == I");
  assertMatClose(multiply(inv, m), identity(), 1e-4, "inv * m == I");
});
test("invert returns null for a singular matrix", () => {
  const m = scale(identity(), [1, 1, 0]);
  assert.equal(invert(m), null);
});
test("transpose matches a hand-computed transpose", () => {
  const m = new Float32Array([
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15
  ]);
  const t = transpose(m);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      assert.equal(t[c * 4 + r], m[r * 4 + c], `t(${r},${c})`);
    }
  }
});
test("transpose is an involution: transpose(transpose(m)) == m", () => {
  const m = scale(rotateZ(translate(identity(), [1, 2, 3]), 0.3), [2, 3, 4]);
  assertMatClose(transpose(transpose(m)), m, 0, "TT == I");
});
test("rotateZ rotates +X toward +Y by 90 degrees", () => {
  const m = rotateZ(identity(), Math.PI / 2);
  const x = apply(m, [1, 0, 0, 1]);
  assert.ok(close(x[0], 0, 1e-6) && close(x[1], 1, 1e-6) && close(x[2], 0, 1e-6), `Rz(90)*X -> ${x.slice(0, 3)}`);
  const y = apply(m, [0, 1, 0, 1]);
  assert.ok(close(y[0], -1, 1e-6) && close(y[1], 0, 1e-6), `Rz(90)*Y -> ${y.slice(0, 3)}`);
});
test("normalMatrix embeds the inverse-transpose of the upper 3x3 in a 4x4", () => {
  const r = rotateZ(identity(), 0.9);
  const nm = normalMatrix(r);
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
    assert.ok(close(nm[i], r[i], 1e-5), `normalMatrix index ${i}: ${nm[i]} != ${r[i]}`);
  }
});
test("normalMatrix returns identity on a singular matrix", () => {
  const m = scale(identity(), [1, 1, 0]);
  assertMatClose(normalMatrix(m), identity(), 0, "normalMatrix singular");
});
test("normalMatrix3 equals the inverse-transpose of the upper 3x3 for a non-uniform scale", () => {
  const sx = 2, sy = 4, sz = 0.5;
  const m = scale(identity(), [sx, sy, sz]);
  const n3 = normalMatrix3(m);
  assert.equal(n3.length, 9);
  assertMatClose(
    n3,
    [1 / sx, 0, 0, 0, 1 / sy, 0, 0, 0, 1 / sz],
    1e-5,
    "normalMatrix3 non-uniform scale"
  );
});
test("normalMatrix3 matches the 3x3 block of normalMatrix for a rigid+scale transform", () => {
  const m = scale(rotateZ(translate(identity(), [1, 2, 3]), 0.6), [1.5, 0.5, 2]);
  const n3 = normalMatrix3(m);
  const n4 = normalMatrix(m);
  const block = [n4[0], n4[1], n4[2], n4[4], n4[5], n4[6], n4[8], n4[9], n4[10]];
  assertMatClose(n3, block, 1e-4, "normalMatrix3 vs normalMatrix block");
});
test("normalMatrix3 returns the column-major identity 3x3 on a singular matrix", () => {
  const m = scale(identity(), [1, 1, 0]);
  assertMatClose(
    normalMatrix3(m),
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    0,
    "normalMatrix3 singular -> identity"
  );
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWF0NC50ZXN0LnRzIiwgInZlYzMudHMiLCAibWF0NC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gVGVzdHMgZm9yIHRoZSBjb2x1bW4tbWFqb3IgRmxvYXQzMkFycmF5KDE2KSBtYXQ0IHV0aWxpdGllcy5cblxuaW1wb3J0IHsgdGVzdCB9IGZyb20gJ25vZGU6dGVzdCc7XG5pbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0L3N0cmljdCc7XG5cbmltcG9ydCB7XG4gIGlkZW50aXR5LCBtdWx0aXBseSwgcGVyc3BlY3RpdmUsIHBlcnNwZWN0aXZlR0wsIGxvb2tBdCwgaW52ZXJ0LFxuICBub3JtYWxNYXRyaXgsIG5vcm1hbE1hdHJpeDMsIHRyYW5zcG9zZSwgcm90YXRlWiwgc2NhbGUsIHRyYW5zbGF0ZSxcbn0gZnJvbSAnLi9tYXQ0LnRzJztcbmltcG9ydCB0eXBlIHsgTWF0NCB9IGZyb20gJy4vbWF0NC50cyc7XG5pbXBvcnQgdHlwZSB7IFZlYzMgfSBmcm9tICcuL3ZlYzMudHMnO1xuXG5jb25zdCBjbG9zZSA9IChhOiBudW1iZXIsIGI6IG51bWJlciwgdG9sID0gMWUtNSk6IGJvb2xlYW4gPT4gTWF0aC5hYnMoYSAtIGIpIDw9IHRvbDtcblxuZnVuY3Rpb24gYXNzZXJ0TWF0Q2xvc2UoYTogQXJyYXlMaWtlPG51bWJlcj4sIGI6IEFycmF5TGlrZTxudW1iZXI+LCB0b2wgPSAxZS01LCBtc2cgPSAnJyk6IHZvaWQge1xuICBhc3NlcnQuZXF1YWwoYS5sZW5ndGgsIGIubGVuZ3RoLCBgbGVuZ3RoICR7bXNnfWApO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGEubGVuZ3RoOyBpKyspIHtcbiAgICBhc3NlcnQub2soY2xvc2UoYVtpXSwgYltpXSwgdG9sKSwgYCR7bXNnfSBpbmRleCAke2l9OiAke2FbaV19ICE9ICR7YltpXX1gKTtcbiAgfVxufVxuXG4vLyBBcHBseSBhIGNvbHVtbi1tYWpvciBtYXQ0IHRvIGEgaG9tb2dlbmVvdXMgcG9pbnQgKHcgPSAxKS4gUmV0dXJucyBbeCx5LHosd10uXG5mdW5jdGlvbiBhcHBseShtOiBNYXQ0LCBwOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSk6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgY29uc3QgW3gsIHksIHosIHddID0gcDtcbiAgcmV0dXJuIFtcbiAgICBtWzBdICogeCArIG1bNF0gKiB5ICsgbVs4XSAqIHogKyBtWzEyXSAqIHcsXG4gICAgbVsxXSAqIHggKyBtWzVdICogeSArIG1bOV0gKiB6ICsgbVsxM10gKiB3LFxuICAgIG1bMl0gKiB4ICsgbVs2XSAqIHkgKyBtWzEwXSAqIHogKyBtWzE0XSAqIHcsXG4gICAgbVszXSAqIHggKyBtWzddICogeSArIG1bMTFdICogeiArIG1bMTVdICogdyxcbiAgXTtcbn1cblxudGVzdCgnaWRlbnRpdHkgaXMgdGhlIGNvbHVtbi1tYWpvciA0eDQgaWRlbnRpdHknLCAoKSA9PiB7XG4gIGFzc2VydE1hdENsb3NlKFxuICAgIGlkZW50aXR5KCksXG4gICAgWzEsIDAsIDAsIDAsIDAsIDEsIDAsIDAsIDAsIDAsIDEsIDAsIDAsIDAsIDAsIDFdLFxuICAgIDAsXG4gICAgJ2lkZW50aXR5JyxcbiAgKTtcbn0pO1xuXG50ZXN0KCdtdWx0aXBseSBieSBpZGVudGl0eSBpcyBhIG5vLW9wIG9uIGVpdGhlciBzaWRlJywgKCkgPT4ge1xuICBjb25zdCBtID0gc2NhbGUodHJhbnNsYXRlKGlkZW50aXR5KCksIFsxLCAyLCAzXSksIFsyLCAzLCA0XSk7XG4gIGFzc2VydE1hdENsb3NlKG11bHRpcGx5KG0sIGlkZW50aXR5KCkpLCBtLCAxZS02LCAnbSpJJyk7XG4gIGFzc2VydE1hdENsb3NlKG11bHRpcGx5KGlkZW50aXR5KCksIG0pLCBtLCAxZS02LCAnSSptJyk7XG59KTtcblxudGVzdCgnbXVsdGlwbHkgaXMgYXNzb2NpYXRpdmUnLCAoKSA9PiB7XG4gIGNvbnN0IGEgPSB0cmFuc2xhdGUoaWRlbnRpdHkoKSwgWzEsIDAsIC0yXSk7XG4gIGNvbnN0IGIgPSByb3RhdGVaKGlkZW50aXR5KCksIDAuNSk7XG4gIGNvbnN0IGMgPSBzY2FsZShpZGVudGl0eSgpLCBbMiwgMC41LCAzXSk7XG4gIGFzc2VydE1hdENsb3NlKG11bHRpcGx5KG11bHRpcGx5KGEsIGIpLCBjKSwgbXVsdGlwbHkoYSwgbXVsdGlwbHkoYiwgYykpLCAxZS01LCAnKGFiKWMgPT0gYShiYyknKTtcbn0pO1xuXG50ZXN0KCdwZXJzcGVjdGl2ZSB1c2VzIFdlYkdQVSBjbGlwLVo6IC1uZWFyIC0+IDAsIC1mYXIgLT4gMSBhZnRlciBkaXZpZGUnLCAoKSA9PiB7XG4gIGNvbnN0IG5lYXIgPSAwLjUsIGZhciA9IDEwMDtcbiAgY29uc3QgbSA9IHBlcnNwZWN0aXZlKE1hdGguUEkgLyAzLCAxLjUsIG5lYXIsIGZhcik7XG4gIC8vIEEgcG9pbnQgb24gdGhlIC1aIGF4aXMgYXQgeiA9IC1uZWFyLlxuICBjb25zdCBjbiA9IGFwcGx5KG0sIFswLCAwLCAtbmVhciwgMV0pO1xuICBhc3NlcnQub2soY2xvc2UoY25bM10sIG5lYXIsIDFlLTUpLCBgdyBhdCBuZWFyID0gJHtjblszXX1gKTtcbiAgYXNzZXJ0Lm9rKGNsb3NlKGNuWzJdIC8gY25bM10sIDAsIDFlLTUpLCBgbmRjLXogYXQgbmVhciA9ICR7Y25bMl0gLyBjblszXX1gKTtcbiAgY29uc3QgY2YgPSBhcHBseShtLCBbMCwgMCwgLWZhciwgMV0pO1xuICBhc3NlcnQub2soY2xvc2UoY2ZbM10sIGZhciwgMWUtNCksIGB3IGF0IGZhciA9ICR7Y2ZbM119YCk7XG4gIGFzc2VydC5vayhjbG9zZShjZlsyXSAvIGNmWzNdLCAxLCAxZS01KSwgYG5kYy16IGF0IGZhciA9ICR7Y2ZbMl0gLyBjZlszXX1gKTtcbn0pO1xuXG50ZXN0KCdwZXJzcGVjdGl2ZUdMIHVzZXMgT3BlbkdMIGNsaXAtWjogLW5lYXIgLT4gLTEsIC1mYXIgLT4gKzEgYWZ0ZXIgZGl2aWRlJywgKCkgPT4ge1xuICBjb25zdCBuZWFyID0gMC41LCBmYXIgPSAxMDA7XG4gIGNvbnN0IG0gPSBwZXJzcGVjdGl2ZUdMKE1hdGguUEkgLyAzLCAxLjUsIG5lYXIsIGZhcik7XG4gIGNvbnN0IGNuID0gYXBwbHkobSwgWzAsIDAsIC1uZWFyLCAxXSk7XG4gIGFzc2VydC5vayhjbG9zZShjblsyXSAvIGNuWzNdLCAtMSwgMWUtNSksIGBuZGMteiBhdCBuZWFyID0gJHtjblsyXSAvIGNuWzNdfWApO1xuICBjb25zdCBjZiA9IGFwcGx5KG0sIFswLCAwLCAtZmFyLCAxXSk7XG4gIGFzc2VydC5vayhjbG9zZShjZlsyXSAvIGNmWzNdLCAxLCAxZS01KSwgYG5kYy16IGF0IGZhciA9ICR7Y2ZbMl0gLyBjZlszXX1gKTtcbn0pO1xuXG50ZXN0KCdwZXJzcGVjdGl2ZSBzZXRzIHRoZSBzdGFuZGFyZCBwcm9qZWN0aW9uIGVudHJpZXMgKGFzcGVjdCwgZm92LCB3ID0gLXopJywgKCkgPT4ge1xuICBjb25zdCBtID0gcGVyc3BlY3RpdmUoTWF0aC5QSSAvIDIsIDIsIDEsIDEwKTtcbiAgYXNzZXJ0Lm9rKGNsb3NlKG1bNV0sIDEsIDFlLTYpLCBgbVs1XSA9ICR7bVs1XX1gKTtcbiAgYXNzZXJ0Lm9rKGNsb3NlKG1bMF0sIDAuNSwgMWUtNiksIGBtWzBdID0gJHttWzBdfWApO1xuICBhc3NlcnQuZXF1YWwobVsxMV0sIC0xKTtcbn0pO1xuXG50ZXN0KCdsb29rQXQgcGxhY2VzIHRoZSBleWUgYXQgdGhlIG9yaWdpbiBvZiB2aWV3IHNwYWNlJywgKCkgPT4ge1xuICBjb25zdCBleWU6IFZlYzMgPSBbMCwgMCwgNV07XG4gIGNvbnN0IGNlbnRlcjogVmVjMyA9IFswLCAwLCAwXTtcbiAgY29uc3QgdXA6IFZlYzMgPSBbMCwgMSwgMF07XG4gIGNvbnN0IHYgPSBsb29rQXQoZXllLCBjZW50ZXIsIHVwKTtcbiAgLy8gVGhlIGV5ZSBtYXBzIHRvIHRoZSB2aWV3LXNwYWNlIG9yaWdpbi5cbiAgY29uc3QgZSA9IGFwcGx5KHYsIFtleWVbMF0sIGV5ZVsxXSwgZXllWzJdLCAxXSk7XG4gIGFzc2VydC5vayhjbG9zZShlWzBdLCAwKSAmJiBjbG9zZShlWzFdLCAwKSAmJiBjbG9zZShlWzJdLCAwKSwgYGV5ZSAtPiAke2Uuc2xpY2UoMCwgMyl9YCk7XG4gIC8vIFRoZSBjZW50ZXIgaXMgaW4gZnJvbnQgb2YgdGhlIGNhbWVyYTogLVogaW4gdmlldyBzcGFjZSAobG9va2luZyBkb3duIC1aKS5cbiAgY29uc3QgYyA9IGFwcGx5KHYsIFtjZW50ZXJbMF0sIGNlbnRlclsxXSwgY2VudGVyWzJdLCAxXSk7XG4gIGFzc2VydC5vayhjWzJdIDwgMCwgYGNlbnRlciB2aWV3LXogc2hvdWxkIGJlIG5lZ2F0aXZlLCBnb3QgJHtjWzJdfWApO1xufSk7XG5cbnRlc3QoJ2ludmVydCByb3VuZC10cmlwczogbSAqIGludihtKSA9PSBpZGVudGl0eScsICgpID0+IHtcbiAgY29uc3QgbSA9IHNjYWxlKHJvdGF0ZVoodHJhbnNsYXRlKGlkZW50aXR5KCksIFsyLCAtMywgMV0pLCAwLjcpLCBbMS41LCAyLCAwLjVdKTtcbiAgY29uc3QgaW52ID0gaW52ZXJ0KG0pO1xuICBhc3NlcnQub2soaW52LCAnaW52ZXJ0IHJldHVybmVkIG51bGwgZm9yIGFuIGludmVydGlibGUgbWF0cml4Jyk7XG4gIGFzc2VydE1hdENsb3NlKG11bHRpcGx5KG0sIGludiEpLCBpZGVudGl0eSgpLCAxZS00LCAnbSAqIGludiA9PSBJJyk7XG4gIGFzc2VydE1hdENsb3NlKG11bHRpcGx5KGludiEsIG0pLCBpZGVudGl0eSgpLCAxZS00LCAnaW52ICogbSA9PSBJJyk7XG59KTtcblxudGVzdCgnaW52ZXJ0IHJldHVybnMgbnVsbCBmb3IgYSBzaW5ndWxhciBtYXRyaXgnLCAoKSA9PiB7XG4gIC8vIEEgbWF0cml4IHdpdGggYSB6ZXJvIHNjYWxlIG9uIFogaXMgbm9uLWludmVydGlibGUuXG4gIGNvbnN0IG0gPSBzY2FsZShpZGVudGl0eSgpLCBbMSwgMSwgMF0pO1xuICBhc3NlcnQuZXF1YWwoaW52ZXJ0KG0pLCBudWxsKTtcbn0pO1xuXG50ZXN0KCd0cmFuc3Bvc2UgbWF0Y2hlcyBhIGhhbmQtY29tcHV0ZWQgdHJhbnNwb3NlJywgKCkgPT4ge1xuICAvLyBDb2x1bW4tbWFqb3I6IG1bYyo0ICsgcl0uIEJ1aWxkIGEgbWF0cml4IHdpdGggZGlzdGluY3QgZW50cmllcy5cbiAgY29uc3QgbSA9IG5ldyBGbG9hdDMyQXJyYXkoW1xuICAgIDAsIDEsIDIsIDMsXG4gICAgNCwgNSwgNiwgNyxcbiAgICA4LCA5LCAxMCwgMTEsXG4gICAgMTIsIDEzLCAxNCwgMTUsXG4gIF0pO1xuICBjb25zdCB0ID0gdHJhbnNwb3NlKG0pO1xuICAvLyBFbGVtZW50IChyLGMpIG9mIHQgZXF1YWxzIGVsZW1lbnQgKGMscikgb2YgbS5cbiAgZm9yIChsZXQgYyA9IDA7IGMgPCA0OyBjKyspIHtcbiAgICBmb3IgKGxldCByID0gMDsgciA8IDQ7IHIrKykge1xuICAgICAgYXNzZXJ0LmVxdWFsKHRbYyAqIDQgKyByXSwgbVtyICogNCArIGNdLCBgdCgke3J9LCR7Y30pYCk7XG4gICAgfVxuICB9XG59KTtcblxudGVzdCgndHJhbnNwb3NlIGlzIGFuIGludm9sdXRpb246IHRyYW5zcG9zZSh0cmFuc3Bvc2UobSkpID09IG0nLCAoKSA9PiB7XG4gIGNvbnN0IG0gPSBzY2FsZShyb3RhdGVaKHRyYW5zbGF0ZShpZGVudGl0eSgpLCBbMSwgMiwgM10pLCAwLjMpLCBbMiwgMywgNF0pO1xuICBhc3NlcnRNYXRDbG9zZSh0cmFuc3Bvc2UodHJhbnNwb3NlKG0pKSwgbSwgMCwgJ1RUID09IEknKTtcbn0pO1xuXG50ZXN0KCdyb3RhdGVaIHJvdGF0ZXMgK1ggdG93YXJkICtZIGJ5IDkwIGRlZ3JlZXMnLCAoKSA9PiB7XG4gIGNvbnN0IG0gPSByb3RhdGVaKGlkZW50aXR5KCksIE1hdGguUEkgLyAyKTtcbiAgY29uc3QgeCA9IGFwcGx5KG0sIFsxLCAwLCAwLCAxXSk7XG4gIGFzc2VydC5vayhjbG9zZSh4WzBdLCAwLCAxZS02KSAmJiBjbG9zZSh4WzFdLCAxLCAxZS02KSAmJiBjbG9zZSh4WzJdLCAwLCAxZS02KSwgYFJ6KDkwKSpYIC0+ICR7eC5zbGljZSgwLCAzKX1gKTtcbiAgY29uc3QgeSA9IGFwcGx5KG0sIFswLCAxLCAwLCAxXSk7XG4gIGFzc2VydC5vayhjbG9zZSh5WzBdLCAtMSwgMWUtNikgJiYgY2xvc2UoeVsxXSwgMCwgMWUtNiksIGBSeig5MCkqWSAtPiAke3kuc2xpY2UoMCwgMyl9YCk7XG59KTtcblxudGVzdCgnbm9ybWFsTWF0cml4IGVtYmVkcyB0aGUgaW52ZXJzZS10cmFuc3Bvc2Ugb2YgdGhlIHVwcGVyIDN4MyBpbiBhIDR4NCcsICgpID0+IHtcbiAgLy8gUHVyZSByb3RhdGlvbjogdGhlIG5vcm1hbCBtYXRyaXggZXF1YWxzIHRoZSByb3RhdGlvbiBpdHNlbGYgKG9ydGhvbm9ybWFsKS5cbiAgY29uc3QgciA9IHJvdGF0ZVooaWRlbnRpdHkoKSwgMC45KTtcbiAgY29uc3Qgbm0gPSBub3JtYWxNYXRyaXgocik7XG4gIC8vIFVwcGVyLWxlZnQgM3gzIG9mIG5tIHNob3VsZCBlcXVhbCB1cHBlci1sZWZ0IDN4MyBvZiByLlxuICBmb3IgKGNvbnN0IGkgb2YgWzAsIDEsIDIsIDQsIDUsIDYsIDgsIDksIDEwXSkge1xuICAgIGFzc2VydC5vayhjbG9zZShubVtpXSwgcltpXSwgMWUtNSksIGBub3JtYWxNYXRyaXggaW5kZXggJHtpfTogJHtubVtpXX0gIT0gJHtyW2ldfWApO1xuICB9XG59KTtcblxudGVzdCgnbm9ybWFsTWF0cml4IHJldHVybnMgaWRlbnRpdHkgb24gYSBzaW5ndWxhciBtYXRyaXgnLCAoKSA9PiB7XG4gIGNvbnN0IG0gPSBzY2FsZShpZGVudGl0eSgpLCBbMSwgMSwgMF0pO1xuICBhc3NlcnRNYXRDbG9zZShub3JtYWxNYXRyaXgobSksIGlkZW50aXR5KCksIDAsICdub3JtYWxNYXRyaXggc2luZ3VsYXInKTtcbn0pO1xuXG50ZXN0KCdub3JtYWxNYXRyaXgzIGVxdWFscyB0aGUgaW52ZXJzZS10cmFuc3Bvc2Ugb2YgdGhlIHVwcGVyIDN4MyBmb3IgYSBub24tdW5pZm9ybSBzY2FsZScsICgpID0+IHtcbiAgLy8gRm9yIGEgcHVyZSBub24tdW5pZm9ybSBzY2FsZSBkaWFnKHN4LHN5LHN6KS5cbiAgY29uc3Qgc3ggPSAyLCBzeSA9IDQsIHN6ID0gMC41O1xuICBjb25zdCBtID0gc2NhbGUoaWRlbnRpdHkoKSwgW3N4LCBzeSwgc3pdKTtcbiAgY29uc3QgbjMgPSBub3JtYWxNYXRyaXgzKG0pO1xuICBhc3NlcnQuZXF1YWwobjMubGVuZ3RoLCA5KTtcbiAgYXNzZXJ0TWF0Q2xvc2UoXG4gICAgbjMsXG4gICAgWzEgLyBzeCwgMCwgMCwgMCwgMSAvIHN5LCAwLCAwLCAwLCAxIC8gc3pdLFxuICAgIDFlLTUsXG4gICAgJ25vcm1hbE1hdHJpeDMgbm9uLXVuaWZvcm0gc2NhbGUnLFxuICApO1xufSk7XG5cbnRlc3QoJ25vcm1hbE1hdHJpeDMgbWF0Y2hlcyB0aGUgM3gzIGJsb2NrIG9mIG5vcm1hbE1hdHJpeCBmb3IgYSByaWdpZCtzY2FsZSB0cmFuc2Zvcm0nLCAoKSA9PiB7XG4gIGNvbnN0IG0gPSBzY2FsZShyb3RhdGVaKHRyYW5zbGF0ZShpZGVudGl0eSgpLCBbMSwgMiwgM10pLCAwLjYpLCBbMS41LCAwLjUsIDJdKTtcbiAgY29uc3QgbjMgPSBub3JtYWxNYXRyaXgzKG0pO1xuICBjb25zdCBuNCA9IG5vcm1hbE1hdHJpeChtKTtcbiAgY29uc3QgYmxvY2sgPSBbbjRbMF0sIG40WzFdLCBuNFsyXSwgbjRbNF0sIG40WzVdLCBuNFs2XSwgbjRbOF0sIG40WzldLCBuNFsxMF1dO1xuICBhc3NlcnRNYXRDbG9zZShuMywgYmxvY2ssIDFlLTQsICdub3JtYWxNYXRyaXgzIHZzIG5vcm1hbE1hdHJpeCBibG9jaycpO1xufSk7XG5cbnRlc3QoJ25vcm1hbE1hdHJpeDMgcmV0dXJucyB0aGUgY29sdW1uLW1ham9yIGlkZW50aXR5IDN4MyBvbiBhIHNpbmd1bGFyIG1hdHJpeCcsICgpID0+IHtcbiAgY29uc3QgbSA9IHNjYWxlKGlkZW50aXR5KCksIFsxLCAxLCAwXSk7XG4gIGFzc2VydE1hdENsb3NlKFxuICAgIG5vcm1hbE1hdHJpeDMobSksXG4gICAgWzEsIDAsIDAsIDAsIDEsIDAsIDAsIDAsIDFdLFxuICAgIDAsXG4gICAgJ25vcm1hbE1hdHJpeDMgc2luZ3VsYXIgLT4gaWRlbnRpdHknLFxuICApO1xufSk7XG4iLCAiLy8gTWluaW1hbCB2ZWMzIHV0aWxpdGllcyBcdTIwMTQgYWxsIGZ1bmN0aW9ucyByZXR1cm4gbmV3IGFycmF5cywgbm8gbXV0YXRpb24uXG5cbmV4cG9ydCB0eXBlIFZlYzMgPSBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl07XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGUoeCA9IDAsIHkgPSAwLCB6ID0gMCk6IFZlYzMge1xuICByZXR1cm4gW3gsIHksIHpdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkKGE6IFZlYzMsIGI6IFZlYzMpOiBWZWMzIHtcbiAgcmV0dXJuIFthWzBdICsgYlswXSwgYVsxXSArIGJbMV0sIGFbMl0gKyBiWzJdXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHN1YnRyYWN0KGE6IFZlYzMsIGI6IFZlYzMpOiBWZWMzIHtcbiAgcmV0dXJuIFthWzBdIC0gYlswXSwgYVsxXSAtIGJbMV0sIGFbMl0gLSBiWzJdXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNjYWxlKHY6IFZlYzMsIHM6IG51bWJlcik6IFZlYzMge1xuICByZXR1cm4gW3ZbMF0gKiBzLCB2WzFdICogcywgdlsyXSAqIHNdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZG90KGE6IFZlYzMsIGI6IFZlYzMpOiBudW1iZXIge1xuICByZXR1cm4gYVswXSAqIGJbMF0gKyBhWzFdICogYlsxXSArIGFbMl0gKiBiWzJdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3Jvc3MoYTogVmVjMywgYjogVmVjMyk6IFZlYzMge1xuICByZXR1cm4gW1xuICAgIGFbMV0gKiBiWzJdIC0gYVsyXSAqIGJbMV0sXG4gICAgYVsyXSAqIGJbMF0gLSBhWzBdICogYlsyXSxcbiAgICBhWzBdICogYlsxXSAtIGFbMV0gKiBiWzBdLFxuICBdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbGVuZ3RoKHY6IFZlYzMpOiBudW1iZXIge1xuICByZXR1cm4gTWF0aC5oeXBvdCh2WzBdLCB2WzFdLCB2WzJdKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZSh2OiBWZWMzKTogVmVjMyB7XG4gIGNvbnN0IGxlbiA9IE1hdGguaHlwb3QodlswXSwgdlsxXSwgdlsyXSkgfHwgMTtcbiAgcmV0dXJuIFt2WzBdIC8gbGVuLCB2WzFdIC8gbGVuLCB2WzJdIC8gbGVuXTtcbn1cbiIsICIvLyBNaW5pbWFsIG1hdDQgdXRpbGl0aWVzIFx1MjAxNCBjb2x1bW4tbWFqb3IgRmxvYXQzMkFycmF5KDE2KS4gQWxsIGZ1bmN0aW9ucyByZXR1cm4gbmV3IGFycmF5cywgbm8gbXV0YXRpb24uXG5cbmltcG9ydCB7IHN1YnRyYWN0LCBjcm9zcywgbm9ybWFsaXplLCBkb3QgfSBmcm9tICcuL3ZlYzMudHMnO1xuaW1wb3J0IHR5cGUgeyBWZWMzIH0gZnJvbSAnLi92ZWMzLnRzJztcblxuZXhwb3J0IHR5cGUgTWF0NCA9IEZsb2F0MzJBcnJheTtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZSgpOiBNYXQ0IHtcbiAgcmV0dXJuIG5ldyBGbG9hdDMyQXJyYXkoMTYpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaWRlbnRpdHkoKTogTWF0NCB7XG4gIGNvbnN0IG0gPSBuZXcgRmxvYXQzMkFycmF5KDE2KTtcbiAgbVswXSA9IG1bNV0gPSBtWzEwXSA9IG1bMTVdID0gMTtcbiAgcmV0dXJuIG07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwZXJzcGVjdGl2ZShmb3ZZOiBudW1iZXIsIGFzcGVjdDogbnVtYmVyLCBuZWFyOiBudW1iZXIsIGZhcjogbnVtYmVyKTogTWF0NCB7XG4gIGNvbnN0IGYgPSAxIC8gTWF0aC50YW4oZm92WSAvIDIpO1xuICBjb25zdCBtID0gbmV3IEZsb2F0MzJBcnJheSgxNik7XG4gIG1bMF0gPSBmIC8gYXNwZWN0O1xuICBtWzVdID0gZjtcbiAgbVsxMF0gPSBmYXIgLyAobmVhciAtIGZhcik7XG4gIG1bMTFdID0gLTE7XG4gIG1bMTRdID0gbmVhciAqIGZhciAvIChuZWFyIC0gZmFyKTtcbiAgcmV0dXJuIG07XG59XG5cbi8qICovXG5leHBvcnQgZnVuY3Rpb24gcGVyc3BlY3RpdmVHTChmb3ZZOiBudW1iZXIsIGFzcGVjdDogbnVtYmVyLCBuZWFyOiBudW1iZXIsIGZhcjogbnVtYmVyKTogTWF0NCB7XG4gIGNvbnN0IGYgPSAxIC8gTWF0aC50YW4oZm92WSAvIDIpO1xuICBjb25zdCBuZiA9IDEgLyAobmVhciAtIGZhcik7XG4gIGNvbnN0IG0gPSBuZXcgRmxvYXQzMkFycmF5KDE2KTtcbiAgbVswXSA9IGYgLyBhc3BlY3Q7XG4gIG1bNV0gPSBmO1xuICBtWzEwXSA9IChmYXIgKyBuZWFyKSAqIG5mO1xuICBtWzExXSA9IC0xO1xuICBtWzE0XSA9IDIgKiBmYXIgKiBuZWFyICogbmY7XG4gIHJldHVybiBtO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbG9va0F0KGV5ZTogVmVjMywgY2VudGVyOiBWZWMzLCB1cDogVmVjMyk6IE1hdDQge1xuICBjb25zdCB6ID0gbm9ybWFsaXplKHN1YnRyYWN0KGV5ZSwgY2VudGVyKSk7XG4gIGNvbnN0IHggPSBub3JtYWxpemUoY3Jvc3ModXAsIHopKTtcbiAgY29uc3QgeSA9IGNyb3NzKHosIHgpO1xuICBjb25zdCBtID0gbmV3IEZsb2F0MzJBcnJheSgxNik7XG4gIG1bMF0gPSB4WzBdOyBtWzFdID0geVswXTsgbVsyXSAgPSB6WzBdO1xuICBtWzRdID0geFsxXTsgbVs1XSA9IHlbMV07IG1bNl0gID0gelsxXTtcbiAgbVs4XSA9IHhbMl07IG1bOV0gPSB5WzJdOyBtWzEwXSA9IHpbMl07XG4gIG1bMTJdID0gLWRvdCh4LCBleWUpO1xuICBtWzEzXSA9IC1kb3QoeSwgZXllKTtcbiAgbVsxNF0gPSAtZG90KHosIGV5ZSk7XG4gIG1bMTVdID0gMTtcbiAgcmV0dXJuIG07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtdWx0aXBseShhOiBNYXQ0LCBiOiBNYXQ0KTogTWF0NCB7XG4gIGNvbnN0IG0gPSBuZXcgRmxvYXQzMkFycmF5KDE2KTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0OyBpKyspIHtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IDQ7IGorKykge1xuICAgICAgbVtqICogNCArIGldID1cbiAgICAgICAgYVtpXSAqIGJbaiAqIDRdICsgYVs0ICsgaV0gKiBiW2ogKiA0ICsgMV0gK1xuICAgICAgICBhWzggKyBpXSAqIGJbaiAqIDQgKyAyXSArIGFbMTIgKyBpXSAqIGJbaiAqIDQgKyAzXTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0cmFuc2xhdGUobTogTWF0NCwgdjogVmVjMyk6IE1hdDQge1xuICBjb25zdCB0ID0gaWRlbnRpdHkoKTtcbiAgdFsxMl0gPSB2WzBdOyB0WzEzXSA9IHZbMV07IHRbMTRdID0gdlsyXTtcbiAgcmV0dXJuIG11bHRpcGx5KG0sIHQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcm90YXRlWChtOiBNYXQ0LCBhbmdsZTogbnVtYmVyKTogTWF0NCB7XG4gIGNvbnN0IGMgPSBNYXRoLmNvcyhhbmdsZSksIHMgPSBNYXRoLnNpbihhbmdsZSk7XG4gIGNvbnN0IHIgPSBpZGVudGl0eSgpO1xuICByWzVdID0gYzsgcls2XSA9IHM7IHJbOV0gPSAtczsgclsxMF0gPSBjO1xuICByZXR1cm4gbXVsdGlwbHkobSwgcik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByb3RhdGVZKG06IE1hdDQsIGFuZ2xlOiBudW1iZXIpOiBNYXQ0IHtcbiAgY29uc3QgYyA9IE1hdGguY29zKGFuZ2xlKSwgcyA9IE1hdGguc2luKGFuZ2xlKTtcbiAgY29uc3QgciA9IGlkZW50aXR5KCk7XG4gIHJbMF0gPSBjOyByWzJdID0gLXM7IHJbOF0gPSBzOyByWzEwXSA9IGM7XG4gIHJldHVybiBtdWx0aXBseShtLCByKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJvdGF0ZVoobTogTWF0NCwgYW5nbGU6IG51bWJlcik6IE1hdDQge1xuICBjb25zdCBjID0gTWF0aC5jb3MoYW5nbGUpLCBzID0gTWF0aC5zaW4oYW5nbGUpO1xuICBjb25zdCByID0gaWRlbnRpdHkoKTtcbiAgclswXSA9IGM7IHJbMV0gPSBzOyByWzRdID0gLXM7IHJbNV0gPSBjO1xuICByZXR1cm4gbXVsdGlwbHkobSwgcik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzY2FsZShtOiBNYXQ0LCB2OiBWZWMzKTogTWF0NCB7XG4gIGNvbnN0IHMgPSBpZGVudGl0eSgpO1xuICBzWzBdID0gdlswXTsgc1s1XSA9IHZbMV07IHNbMTBdID0gdlsyXTtcbiAgcmV0dXJuIG11bHRpcGx5KG0sIHMpO1xufVxuXG4vKiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZmxlY3RZKG06IE1hdDQpOiBNYXQ0IHtcbiAgY29uc3QgciA9IG5ldyBGbG9hdDMyQXJyYXkobSk7XG4gIHJbMV0gPSAtclsxXTsgcls0XSA9IC1yWzRdOyByWzZdID0gLXJbNl07XG4gIHJbN10gPSAtcls3XTsgcls5XSA9IC1yWzldOyByWzEzXSA9IC1yWzEzXTtcbiAgcmV0dXJuIHI7XG59XG5cbi8qICovXG5leHBvcnQgZnVuY3Rpb24gcmVmbGVjdFoobTogTWF0NCk6IE1hdDQge1xuICBjb25zdCByID0gbmV3IEZsb2F0MzJBcnJheShtKTtcbiAgclsyXSA9IC1yWzJdOyByWzZdID0gLXJbNl07IHJbOF0gPSAtcls4XTtcbiAgcls5XSA9IC1yWzldOyByWzExXSA9IC1yWzExXTsgclsxNF0gPSAtclsxNF07XG4gIHJldHVybiByO1xufVxuXG4vKiogVHJhbnNwb3NlLW9mLWludmVyc2Ugb2YgdGhlIHVwcGVyIDN4MywgZW1iZWRkZWQgaW4gYSA0eDQgKGZvciB0cmFuc2Zvcm1pbmcgbm9ybWFscykuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsTWF0cml4KG06IE1hdDQpOiBNYXQ0IHtcbiAgY29uc3QgaW52ID0gaW52ZXJ0KG0pO1xuICBpZiAoIWludikgcmV0dXJuIGlkZW50aXR5KCk7XG4gIGNvbnN0IG4gPSBpZGVudGl0eSgpO1xuICBuWzBdID0gaW52WzBdOyBuWzFdID0gaW52WzRdOyBuWzJdICA9IGludls4XTtcbiAgbls0XSA9IGludlsxXTsgbls1XSA9IGludls1XTsgbls2XSAgPSBpbnZbOV07XG4gIG5bOF0gPSBpbnZbMl07IG5bOV0gPSBpbnZbNl07IG5bMTBdID0gaW52WzEwXTtcbiAgcmV0dXJuIG47XG59XG5cbi8qKlxuICogVHJhbnNwb3NlLW9mLWludmVyc2Ugb2YgdGhlIHVwcGVyLWxlZnQgM3gzIG9mIGBtYCwgcmV0dXJuZWQgYXMgYSBjb2x1bW4tbWFqb3JcbiAqIGBGbG9hdDMyQXJyYXkoOSlgICh0aGUgR0xTTC9XR1NMIGBtYXQzeDNgIG5vcm1hbC1tYXRyaXggZm9ybSkuIFVzZSB0aGlzIGZvciBhXG4gKiBXZWJHTC9XZWJHUFUgc2hhZGVyIHRoYXQgd2FudHMgYSBgbWF0M2Agbm9ybWFsIG1hdHJpeDsgYG5vcm1hbE1hdHJpeGAgYWJvdmVcbiAqIHJldHVybnMgdGhlIHNhbWUgdHJhbnNmb3JtIGVtYmVkZGVkIGluIGEgNHg0IGluc3RlYWQuIFJldHVybnMgdGhlIGlkZW50aXR5IDN4M1xuICogaWYgdGhlIHVwcGVyIDN4MyBpcyBzaW5ndWxhciAobWF0Y2hpbmcgYG5vcm1hbE1hdHJpeGAncyBpZGVudGl0eSBmYWxsYmFjaykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxNYXRyaXgzKG06IE1hdDQpOiBGbG9hdDMyQXJyYXkge1xuICBjb25zdCBhMDAgPSBtWzBdLCBhMDEgPSBtWzFdLCBhMDIgPSBtWzJdO1xuICBjb25zdCBhMTAgPSBtWzRdLCBhMTEgPSBtWzVdLCBhMTIgPSBtWzZdO1xuICBjb25zdCBhMjAgPSBtWzhdLCBhMjEgPSBtWzldLCBhMjIgPSBtWzEwXTtcblxuICBjb25zdCBkZXQgPVxuICAgIGEwMCAqIChhMTEgKiBhMjIgLSBhMTIgKiBhMjEpIC1cbiAgICBhMDEgKiAoYTEwICogYTIyIC0gYTEyICogYTIwKSArXG4gICAgYTAyICogKGExMCAqIGEyMSAtIGExMSAqIGEyMCk7XG4gIGlmIChkZXQgPT09IDApIHJldHVybiBuZXcgRmxvYXQzMkFycmF5KFsxLCAwLCAwLCAwLCAxLCAwLCAwLCAwLCAxXSk7XG4gIGNvbnN0IGlkID0gMSAvIGRldDtcblxuICByZXR1cm4gbmV3IEZsb2F0MzJBcnJheShbXG4gICAgKGExMSAqIGEyMiAtIGEyMSAqIGExMikgKiBpZCxcbiAgICAoYTIwICogYTEyIC0gYTEwICogYTIyKSAqIGlkLFxuICAgIChhMTAgKiBhMjEgLSBhMjAgKiBhMTEpICogaWQsXG4gICAgKGEyMSAqIGEwMiAtIGEwMSAqIGEyMikgKiBpZCxcbiAgICAoYTAwICogYTIyIC0gYTIwICogYTAyKSAqIGlkLFxuICAgIChhMjAgKiBhMDEgLSBhMDAgKiBhMjEpICogaWQsXG4gICAgKGEwMSAqIGExMiAtIGExMSAqIGEwMikgKiBpZCxcbiAgICAoYTEwICogYTAyIC0gYTAwICogYTEyKSAqIGlkLFxuICAgIChhMDAgKiBhMTEgLSBhMTAgKiBhMDEpICogaWQsXG4gIF0pO1xufVxuXG4vKiogVHJhbnNwb3NlIG9mIGEgNHg0IG1hdHJpeC4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0cmFuc3Bvc2UobTogTWF0NCk6IE1hdDQge1xuICBjb25zdCB0ID0gbmV3IEZsb2F0MzJBcnJheSgxNik7XG4gIGZvciAobGV0IGMgPSAwOyBjIDwgNDsgYysrKSB7XG4gICAgZm9yIChsZXQgciA9IDA7IHIgPCA0OyByKyspIHtcbiAgICAgIHRbYyAqIDQgKyByXSA9IG1bciAqIDQgKyBjXTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHQ7XG59XG5cbi8qKiBJbnZlcnQgYSBnZW5lcmFsIDR4NCBtYXRyaXguIFJldHVybnMgbnVsbCBpZiBzaW5ndWxhci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbnZlcnQobTogTWF0NCk6IE1hdDQgfCBudWxsIHtcbiAgY29uc3QgaW52ID0gbmV3IEZsb2F0MzJBcnJheSgxNik7XG4gIGludlswXSAgPSAgbVs1XSptWzEwXSptWzE1XSAtIG1bNV0qbVsxMV0qbVsxNF0gLSBtWzldKm1bNl0qbVsxNV0gKyBtWzldKm1bN10qbVsxNF0gKyBtWzEzXSptWzZdKm1bMTFdIC0gbVsxM10qbVs3XSptWzEwXTtcbiAgaW52WzRdICA9IC1tWzRdKm1bMTBdKm1bMTVdICsgbVs0XSptWzExXSptWzE0XSArIG1bOF0qbVs2XSptWzE1XSAtIG1bOF0qbVs3XSptWzE0XSAtIG1bMTJdKm1bNl0qbVsxMV0gKyBtWzEyXSptWzddKm1bMTBdO1xuICBpbnZbOF0gID0gIG1bNF0qbVs5XSptWzE1XSAgLSBtWzRdKm1bMTFdKm1bMTNdIC0gbVs4XSptWzVdKm1bMTVdICsgbVs4XSptWzddKm1bMTNdICsgbVsxMl0qbVs1XSptWzExXSAtIG1bMTJdKm1bN10qbVs5XTtcbiAgaW52WzEyXSA9IC1tWzRdKm1bOV0qbVsxNF0gICsgbVs0XSptWzEwXSptWzEzXSArIG1bOF0qbVs1XSptWzE0XSAtIG1bOF0qbVs2XSptWzEzXSAtIG1bMTJdKm1bNV0qbVsxMF0gKyBtWzEyXSptWzZdKm1bOV07XG4gIGludlsxXSAgPSAtbVsxXSptWzEwXSptWzE1XSArIG1bMV0qbVsxMV0qbVsxNF0gKyBtWzldKm1bMl0qbVsxNV0gLSBtWzldKm1bM10qbVsxNF0gLSBtWzEzXSptWzJdKm1bMTFdICsgbVsxM10qbVszXSptWzEwXTtcbiAgaW52WzVdICA9ICBtWzBdKm1bMTBdKm1bMTVdIC0gbVswXSptWzExXSptWzE0XSAtIG1bOF0qbVsyXSptWzE1XSArIG1bOF0qbVszXSptWzE0XSArIG1bMTJdKm1bMl0qbVsxMV0gLSBtWzEyXSptWzNdKm1bMTBdO1xuICBpbnZbOV0gID0gLW1bMF0qbVs5XSptWzE1XSAgKyBtWzBdKm1bMTFdKm1bMTNdICsgbVs4XSptWzFdKm1bMTVdIC0gbVs4XSptWzNdKm1bMTNdIC0gbVsxMl0qbVsxXSptWzExXSArIG1bMTJdKm1bM10qbVs5XTtcbiAgaW52WzEzXSA9ICBtWzBdKm1bOV0qbVsxNF0gIC0gbVswXSptWzEwXSptWzEzXSAtIG1bOF0qbVsxXSptWzE0XSArIG1bOF0qbVsyXSptWzEzXSArIG1bMTJdKm1bMV0qbVsxMF0gLSBtWzEyXSptWzJdKm1bOV07XG4gIGludlsyXSAgPSAgbVsxXSptWzZdKm1bMTVdICAtIG1bMV0qbVs3XSptWzE0XSAgLSBtWzVdKm1bMl0qbVsxNV0gKyBtWzVdKm1bM10qbVsxNF0gKyBtWzEzXSptWzJdKm1bN10gIC0gbVsxM10qbVszXSptWzZdO1xuICBpbnZbNl0gID0gLW1bMF0qbVs2XSptWzE1XSAgKyBtWzBdKm1bN10qbVsxNF0gICsgbVs0XSptWzJdKm1bMTVdIC0gbVs0XSptWzNdKm1bMTRdIC0gbVsxMl0qbVsyXSptWzddICArIG1bMTJdKm1bM10qbVs2XTtcbiAgaW52WzEwXSA9ICBtWzBdKm1bNV0qbVsxNV0gIC0gbVswXSptWzddKm1bMTNdICAtIG1bNF0qbVsxXSptWzE1XSArIG1bNF0qbVszXSptWzEzXSArIG1bMTJdKm1bMV0qbVs3XSAgLSBtWzEyXSptWzNdKm1bNV07XG4gIGludlsxNF0gPSAtbVswXSptWzVdKm1bMTRdICArIG1bMF0qbVs2XSptWzEzXSAgKyBtWzRdKm1bMV0qbVsxNF0gLSBtWzRdKm1bMl0qbVsxM10gLSBtWzEyXSptWzFdKm1bNl0gICsgbVsxMl0qbVsyXSptWzVdO1xuICBpbnZbM10gID0gLW1bMV0qbVs2XSptWzExXSAgKyBtWzFdKm1bN10qbVsxMF0gICsgbVs1XSptWzJdKm1bMTFdIC0gbVs1XSptWzNdKm1bMTBdIC0gbVs5XSptWzJdKm1bN10gICArIG1bOV0qbVszXSptWzZdO1xuICBpbnZbN10gID0gIG1bMF0qbVs2XSptWzExXSAgLSBtWzBdKm1bN10qbVsxMF0gIC0gbVs0XSptWzJdKm1bMTFdICsgbVs0XSptWzNdKm1bMTBdICsgbVs4XSptWzJdKm1bN10gICAtIG1bOF0qbVszXSptWzZdO1xuICBpbnZbMTFdID0gLW1bMF0qbVs1XSptWzExXSAgKyBtWzBdKm1bN10qbVs5XSAgICsgbVs0XSptWzFdKm1bMTFdIC0gbVs0XSptWzNdKm1bOV0gIC0gbVs4XSptWzFdKm1bN10gICArIG1bOF0qbVszXSptWzVdO1xuICBpbnZbMTVdID0gIG1bMF0qbVs1XSptWzEwXSAgLSBtWzBdKm1bNl0qbVs5XSAgIC0gbVs0XSptWzFdKm1bMTBdICsgbVs0XSptWzJdKm1bOV0gICsgbVs4XSptWzFdKm1bNl0gICAtIG1bOF0qbVsyXSptWzVdO1xuXG4gIGNvbnN0IGRldCA9IG1bMF0qaW52WzBdICsgbVsxXSppbnZbNF0gKyBtWzJdKmludls4XSArIG1bM10qaW52WzEyXTtcbiAgaWYgKE1hdGguYWJzKGRldCkgPCAxZS04KSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW52RGV0ID0gMSAvIGRldDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAxNjsgaSsrKSBpbnZbaV0gKj0gaW52RGV0O1xuICByZXR1cm4gaW52O1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUVBLFNBQVMsWUFBWTtBQUNyQixPQUFPLFlBQVk7OztBQ1NaLFNBQVMsU0FBUyxHQUFTLEdBQWU7QUFDL0MsU0FBTyxDQUFDLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQy9DO0FBTU8sU0FBUyxJQUFJLEdBQVMsR0FBaUI7QUFDNUMsU0FBTyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUM7QUFDL0M7QUFFTyxTQUFTLE1BQU0sR0FBUyxHQUFlO0FBQzVDLFNBQU87QUFBQSxJQUNMLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUFBLElBQ3hCLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUFBLElBQ3hCLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUFBLEVBQzFCO0FBQ0Y7QUFNTyxTQUFTLFVBQVUsR0FBZTtBQUN2QyxRQUFNLE1BQU0sS0FBSyxNQUFNLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLEtBQUs7QUFDNUMsU0FBTyxDQUFDLEVBQUUsQ0FBQyxJQUFJLEtBQUssRUFBRSxDQUFDLElBQUksS0FBSyxFQUFFLENBQUMsSUFBSSxHQUFHO0FBQzVDOzs7QUM1Qk8sU0FBUyxXQUFpQjtBQUMvQixRQUFNLElBQUksSUFBSSxhQUFhLEVBQUU7QUFDN0IsSUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLElBQUk7QUFDOUIsU0FBTztBQUNUO0FBRU8sU0FBUyxZQUFZLE1BQWMsUUFBZ0IsTUFBYyxLQUFtQjtBQUN6RixRQUFNLElBQUksSUFBSSxLQUFLLElBQUksT0FBTyxDQUFDO0FBQy9CLFFBQU0sSUFBSSxJQUFJLGFBQWEsRUFBRTtBQUM3QixJQUFFLENBQUMsSUFBSSxJQUFJO0FBQ1gsSUFBRSxDQUFDLElBQUk7QUFDUCxJQUFFLEVBQUUsSUFBSSxPQUFPLE9BQU87QUFDdEIsSUFBRSxFQUFFLElBQUk7QUFDUixJQUFFLEVBQUUsSUFBSSxPQUFPLE9BQU8sT0FBTztBQUM3QixTQUFPO0FBQ1Q7QUFHTyxTQUFTLGNBQWMsTUFBYyxRQUFnQixNQUFjLEtBQW1CO0FBQzNGLFFBQU0sSUFBSSxJQUFJLEtBQUssSUFBSSxPQUFPLENBQUM7QUFDL0IsUUFBTSxLQUFLLEtBQUssT0FBTztBQUN2QixRQUFNLElBQUksSUFBSSxhQUFhLEVBQUU7QUFDN0IsSUFBRSxDQUFDLElBQUksSUFBSTtBQUNYLElBQUUsQ0FBQyxJQUFJO0FBQ1AsSUFBRSxFQUFFLEtBQUssTUFBTSxRQUFRO0FBQ3ZCLElBQUUsRUFBRSxJQUFJO0FBQ1IsSUFBRSxFQUFFLElBQUksSUFBSSxNQUFNLE9BQU87QUFDekIsU0FBTztBQUNUO0FBRU8sU0FBUyxPQUFPLEtBQVcsUUFBYyxJQUFnQjtBQUM5RCxRQUFNLElBQUksVUFBVSxTQUFTLEtBQUssTUFBTSxDQUFDO0FBQ3pDLFFBQU0sSUFBSSxVQUFVLE1BQU0sSUFBSSxDQUFDLENBQUM7QUFDaEMsUUFBTSxJQUFJLE1BQU0sR0FBRyxDQUFDO0FBQ3BCLFFBQU0sSUFBSSxJQUFJLGFBQWEsRUFBRTtBQUM3QixJQUFFLENBQUMsSUFBSSxFQUFFLENBQUM7QUFBRyxJQUFFLENBQUMsSUFBSSxFQUFFLENBQUM7QUFBRyxJQUFFLENBQUMsSUFBSyxFQUFFLENBQUM7QUFDckMsSUFBRSxDQUFDLElBQUksRUFBRSxDQUFDO0FBQUcsSUFBRSxDQUFDLElBQUksRUFBRSxDQUFDO0FBQUcsSUFBRSxDQUFDLElBQUssRUFBRSxDQUFDO0FBQ3JDLElBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUFHLElBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUFHLElBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUNyQyxJQUFFLEVBQUUsSUFBSSxDQUFDLElBQUksR0FBRyxHQUFHO0FBQ25CLElBQUUsRUFBRSxJQUFJLENBQUMsSUFBSSxHQUFHLEdBQUc7QUFDbkIsSUFBRSxFQUFFLElBQUksQ0FBQyxJQUFJLEdBQUcsR0FBRztBQUNuQixJQUFFLEVBQUUsSUFBSTtBQUNSLFNBQU87QUFDVDtBQUVPLFNBQVMsU0FBUyxHQUFTLEdBQWU7QUFDL0MsUUFBTSxJQUFJLElBQUksYUFBYSxFQUFFO0FBQzdCLFdBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLGFBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLFFBQUUsSUFBSSxJQUFJLENBQUMsSUFDVCxFQUFFLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxJQUFJLElBQUksQ0FBQyxJQUN4QyxFQUFFLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxJQUFJLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLEVBQUUsSUFBSSxJQUFJLENBQUM7QUFBQSxJQUNyRDtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFTyxTQUFTLFVBQVUsR0FBUyxHQUFlO0FBQ2hELFFBQU0sSUFBSSxTQUFTO0FBQ25CLElBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUFHLElBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUFHLElBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUN2QyxTQUFPLFNBQVMsR0FBRyxDQUFDO0FBQ3RCO0FBZ0JPLFNBQVMsUUFBUSxHQUFTLE9BQXFCO0FBQ3BELFFBQU0sSUFBSSxLQUFLLElBQUksS0FBSyxHQUFHLElBQUksS0FBSyxJQUFJLEtBQUs7QUFDN0MsUUFBTSxJQUFJLFNBQVM7QUFDbkIsSUFBRSxDQUFDLElBQUk7QUFBRyxJQUFFLENBQUMsSUFBSTtBQUFHLElBQUUsQ0FBQyxJQUFJLENBQUM7QUFBRyxJQUFFLENBQUMsSUFBSTtBQUN0QyxTQUFPLFNBQVMsR0FBRyxDQUFDO0FBQ3RCO0FBRU8sU0FBUyxNQUFNLEdBQVMsR0FBZTtBQUM1QyxRQUFNLElBQUksU0FBUztBQUNuQixJQUFFLENBQUMsSUFBSSxFQUFFLENBQUM7QUFBRyxJQUFFLENBQUMsSUFBSSxFQUFFLENBQUM7QUFBRyxJQUFFLEVBQUUsSUFBSSxFQUFFLENBQUM7QUFDckMsU0FBTyxTQUFTLEdBQUcsQ0FBQztBQUN0QjtBQW1CTyxTQUFTLGFBQWEsR0FBZTtBQUMxQyxRQUFNLE1BQU0sT0FBTyxDQUFDO0FBQ3BCLE1BQUksQ0FBQyxJQUFLLFFBQU8sU0FBUztBQUMxQixRQUFNLElBQUksU0FBUztBQUNuQixJQUFFLENBQUMsSUFBSSxJQUFJLENBQUM7QUFBRyxJQUFFLENBQUMsSUFBSSxJQUFJLENBQUM7QUFBRyxJQUFFLENBQUMsSUFBSyxJQUFJLENBQUM7QUFDM0MsSUFBRSxDQUFDLElBQUksSUFBSSxDQUFDO0FBQUcsSUFBRSxDQUFDLElBQUksSUFBSSxDQUFDO0FBQUcsSUFBRSxDQUFDLElBQUssSUFBSSxDQUFDO0FBQzNDLElBQUUsQ0FBQyxJQUFJLElBQUksQ0FBQztBQUFHLElBQUUsQ0FBQyxJQUFJLElBQUksQ0FBQztBQUFHLElBQUUsRUFBRSxJQUFJLElBQUksRUFBRTtBQUM1QyxTQUFPO0FBQ1Q7QUFTTyxTQUFTLGNBQWMsR0FBdUI7QUFDbkQsUUFBTSxNQUFNLEVBQUUsQ0FBQyxHQUFHLE1BQU0sRUFBRSxDQUFDLEdBQUcsTUFBTSxFQUFFLENBQUM7QUFDdkMsUUFBTSxNQUFNLEVBQUUsQ0FBQyxHQUFHLE1BQU0sRUFBRSxDQUFDLEdBQUcsTUFBTSxFQUFFLENBQUM7QUFDdkMsUUFBTSxNQUFNLEVBQUUsQ0FBQyxHQUFHLE1BQU0sRUFBRSxDQUFDLEdBQUcsTUFBTSxFQUFFLEVBQUU7QUFFeEMsUUFBTSxNQUNKLE9BQU8sTUFBTSxNQUFNLE1BQU0sT0FDekIsT0FBTyxNQUFNLE1BQU0sTUFBTSxPQUN6QixPQUFPLE1BQU0sTUFBTSxNQUFNO0FBQzNCLE1BQUksUUFBUSxFQUFHLFFBQU8sSUFBSSxhQUFhLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUNsRSxRQUFNLEtBQUssSUFBSTtBQUVmLFNBQU8sSUFBSSxhQUFhO0FBQUEsS0FDckIsTUFBTSxNQUFNLE1BQU0sT0FBTztBQUFBLEtBQ3pCLE1BQU0sTUFBTSxNQUFNLE9BQU87QUFBQSxLQUN6QixNQUFNLE1BQU0sTUFBTSxPQUFPO0FBQUEsS0FDekIsTUFBTSxNQUFNLE1BQU0sT0FBTztBQUFBLEtBQ3pCLE1BQU0sTUFBTSxNQUFNLE9BQU87QUFBQSxLQUN6QixNQUFNLE1BQU0sTUFBTSxPQUFPO0FBQUEsS0FDekIsTUFBTSxNQUFNLE1BQU0sT0FBTztBQUFBLEtBQ3pCLE1BQU0sTUFBTSxNQUFNLE9BQU87QUFBQSxLQUN6QixNQUFNLE1BQU0sTUFBTSxPQUFPO0FBQUEsRUFDNUIsQ0FBQztBQUNIO0FBR08sU0FBUyxVQUFVLEdBQWU7QUFDdkMsUUFBTSxJQUFJLElBQUksYUFBYSxFQUFFO0FBQzdCLFdBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLGFBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLFFBQUUsSUFBSSxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxDQUFDO0FBQUEsSUFDNUI7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBR08sU0FBUyxPQUFPLEdBQXNCO0FBQzNDLFFBQU0sTUFBTSxJQUFJLGFBQWEsRUFBRTtBQUMvQixNQUFJLENBQUMsSUFBTSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLEVBQUUsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLEVBQUUsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUU7QUFDdkgsTUFBSSxDQUFDLElBQUssQ0FBQyxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLEVBQUUsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLEVBQUUsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUU7QUFDdkgsTUFBSSxDQUFDLElBQU0sRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUssRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDO0FBQ3RILE1BQUksRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUssRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDO0FBQ3RILE1BQUksQ0FBQyxJQUFLLENBQUMsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFO0FBQ3ZILE1BQUksQ0FBQyxJQUFNLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsRUFBRSxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsRUFBRSxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRTtBQUN2SCxNQUFJLENBQUMsSUFBSyxDQUFDLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFLLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsRUFBRSxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsRUFBRSxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQztBQUN0SCxNQUFJLEVBQUUsSUFBSyxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSyxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLEVBQUUsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLEVBQUUsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUM7QUFDdEgsTUFBSSxDQUFDLElBQU0sRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUssRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUssRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUssRUFBRSxFQUFFLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDO0FBQ3RILE1BQUksQ0FBQyxJQUFLLENBQUMsRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUssRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUssRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDLElBQUssRUFBRSxFQUFFLElBQUUsRUFBRSxDQUFDLElBQUUsRUFBRSxDQUFDO0FBQ3RILE1BQUksRUFBRSxJQUFLLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFLLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFLLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsRUFBRSxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFLLEVBQUUsRUFBRSxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQztBQUN0SCxNQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFLLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFLLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsRUFBRSxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFLLEVBQUUsRUFBRSxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQztBQUN0SCxNQUFJLENBQUMsSUFBSyxDQUFDLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFLLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFLLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFNLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQyxJQUFFLEVBQUUsQ0FBQztBQUNySCxNQUFJLENBQUMsSUFBTSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSyxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSyxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBTSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUM7QUFDckgsTUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSyxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBTSxFQUFFLENBQUMsSUFBRSxFQUFFLENBQUMsSUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsSUFBRSxFQUFF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
