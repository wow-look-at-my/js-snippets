// Tests for the byte-preserving tokenizer + syntax classifier.
//
// The defining contract is byte-preservation: concatenating every token's
// `text` must reproduce the input exactly. We assert that round-trip for a
// range of C-like snippets (comments, strings, numbers, operators), that
// classify assigns the expected roles (keyword / function / member / number /
// string), and that resolveLanguage falls back to the C-like preset on unknown
// or missing input.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, classify, resolveLanguage, LANGUAGES } from './tokenizer.ts';
import type { TokenRole } from './tokenizer.ts';

const roundTrips = (src: string): boolean =>
  tokenize(src).map((t) => t.text).join('') === src;

const SAMPLES: string[] = [
  '',
  'int x = 42;',
  'float v = 3.14e-2f;',
  '// a line comment\nint y = 0x1F;',
  '/* block\n   comment */ return v;',
  'const char* s = "hello \\"world\\"";',
  "char c = '\\n';",
  'a >>= b; c <<= d; e ||= f;',
  'obj.member->ptr::scope[idx](arg1, arg2);',
  'vec3 n = normalize(cross(a, b));',
  '`template ${ignored}`',
  'fn main() { let x: f32 = 1.0; }',
];

test('tokenize round-trips: concatenating token text reproduces the input', () => {
  for (const src of SAMPLES) {
    assert.ok(roundTrips(src), `round-trip failed for: ${JSON.stringify(src)}`);
  }
});

test('tokenize offsets are contiguous and cover the whole source', () => {
  const src = 'int x = f(a.b);';
  const toks = tokenize(src);
  let pos = 0;
  for (const t of toks) {
    assert.equal(t.start, pos, 'token start follows previous end');
    assert.equal(t.text, src.slice(t.start, t.end), 'text matches its slice');
    pos = t.end;
  }
  assert.equal(pos, src.length, 'tokens cover the full source');
});

test('tokenize classifies basic token types', () => {
  const toks = tokenize('x = 12 + "s"; // c');
  const types = toks.filter((t) => t.type !== 'ws').map((t) => t.type);
  assert.ok(types.includes('ident'), 'has ident');
  assert.ok(types.includes('number'), 'has number');
  assert.ok(types.includes('string'), 'has string');
  assert.ok(types.includes('punct'), 'has punct');
  assert.ok(types.includes('comment'), 'has comment');
});

test('tokenize greedily matches the longest operator', () => {
  const toks = tokenize('a >>>= b').filter((t) => t.type === 'punct');
  assert.equal(toks[0].text, '>>>=', 'longest operator matched');
});

function rolesFor(src: string, lang = 'clike'): Map<string, TokenRole> {
  const hi = classify(tokenize(src), resolveLanguage(lang));
  const m = new Map<string, TokenRole>();
  for (const t of hi) {
    if (t.type === 'ident') m.set(t.text, t.role);
  }
  return m;
}

test('classify marks keywords, function calls, and member accesses', () => {
  const roles = rolesFor('return obj.field + call(x);');
  assert.equal(roles.get('return'), 'keyword', 'return is a keyword');
  assert.equal(roles.get('field'), 'member', 'obj.field -> member');
  assert.equal(roles.get('call'), 'function', 'call( -> function');
  assert.equal(roles.get('obj'), 'ident', 'plain identifier');
  assert.equal(roles.get('x'), 'ident', 'argument identifier');
});

test('classify assigns number / string / comment roles', () => {
  const hi = classify(tokenize('int n = 5; /* c */ char* s = "t";'), resolveLanguage('clike'));
  const byType = (want: string): TokenRole | undefined => hi.find((t) => t.type === want)?.role;
  assert.equal(byType('number'), 'number');
  assert.equal(byType('string'), 'string');
  assert.equal(byType('comment'), 'comment');
});

test('classify recognises member access through -> and ::', () => {
  const roles = rolesFor('ptr->m1; Type::m2;', 'cpp');
  assert.equal(roles.get('m1'), 'member', '-> member');
  assert.equal(roles.get('m2'), 'member', ':: member');
});

test('classify uses the language keyword set (WGSL fn/let)', () => {
  const roles = rolesFor('fn main() { let x = 1; }', 'wgsl');
  assert.equal(roles.get('fn'), 'keyword', 'fn is a WGSL keyword');
  assert.equal(roles.get('let'), 'keyword', 'let is a WGSL keyword');
  // main is followed by '(' so it reads as a function call.
  assert.equal(roles.get('main'), 'function', 'main( -> function');
});

test('resolveLanguage falls back to the C-like preset on unknown / missing input', () => {
  assert.equal(resolveLanguage(undefined), LANGUAGES.clike);
  assert.equal(resolveLanguage('not-a-language'), LANGUAGES.clike);
  // Known names resolve to their preset (case-insensitive).
  assert.equal(resolveLanguage('WGSL'), LANGUAGES.wgsl);
  assert.equal(resolveLanguage('glsl'), LANGUAGES.glsl);
});

test('resolveLanguage passes a custom LanguageDef through unchanged', () => {
  const custom = { name: 'X', keywords: new Set(['foo']) };
  assert.equal(resolveLanguage(custom), custom);
});
