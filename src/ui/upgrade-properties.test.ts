import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upgradeProperties } from './upgrade-properties.ts';

class Widget {
  log: string[] = [];
  private _a = '';
  private _b = '';
  get a(): string { return this._a; }
  set a(v: string) { this._a = v; this.log.push(`a=${v}`); }
  get b(): string { return this._b; }
  set b(v: string) { this._b = v; this.log.push(`b=${v}`); }
  get readOnly(): number { return 1; }
}

/** An instance whose props were set before the class existed, as an un-upgraded element. */
function preUpgrade(props: Record<string, unknown>): Widget {
  const w = new Widget();
  for (const [k, v] of Object.entries(props)) Object.defineProperty(w, k, { value: v, writable: true, configurable: true, enumerable: true });
  return w;
}

test('every shadowing own property goes through its setter, in declaration order', () => {
  const w = preUpgrade({ b: 'B', a: 'A' });
  upgradeProperties(w, Widget.prototype);
  assert.deepEqual(w.log, ['a=A', 'b=B']);
  assert.equal(Object.prototype.hasOwnProperty.call(w, 'a'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(w, 'b'), false);
  assert.equal(w.a, 'A');
});

test('a property with no own shadow is left alone', () => {
  const w = preUpgrade({ a: 'A' });
  upgradeProperties(w, Widget.prototype);
  assert.deepEqual(w.log, ['a=A']);
});

test('a getter-only accessor is never touched', () => {
  const w = preUpgrade({ readOnly: 7 });
  upgradeProperties(w, Widget.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(w, 'readOnly'), true);
  assert.deepEqual(w.log, []);
});
