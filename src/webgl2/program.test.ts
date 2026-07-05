import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateShaderLog } from './program.ts';

const SOURCE = ['#version 300 es', 'precision highp float;', 'out vec4 fragColor;', 'void main() {', '  fragColor = vec4(1.0)', '}'].join('\n');

test('annotateShaderLog quotes the referenced source line with a marker', () => {
  const log = "ERROR: 0:5: ';' : syntax error";
  const out = annotateShaderLog(SOURCE, log);
  assert.ok(out.includes("ERROR: 0:5: ';' : syntax error"), 'keeps the original log line');
  assert.ok(out.includes('>    5 |   fragColor = vec4(1.0)'), 'marks line 5');
  assert.ok(out.includes('     4 | void main() {'), 'includes context before');
  assert.ok(out.includes('     6 | }'), 'includes context after');
});

test('annotateShaderLog respects contextLines', () => {
  const log = 'ERROR: 0:5: bad';
  const out = annotateShaderLog(SOURCE, log, 0);
  assert.ok(out.includes('>    5 |'), 'has the offending line');
  assert.ok(!out.includes('   4 |'), 'no context before with contextLines=0');
  assert.ok(!out.includes('   6 |'), 'no context after with contextLines=0');
});

test('annotateShaderLog clamps context at the source boundaries', () => {
  const out = annotateShaderLog(SOURCE, 'ERROR: 0:1: bad', 3);
  assert.ok(out.includes('>    1 | #version 300 es'));
  assert.ok(!out.includes('   0 |'), 'no line 0');
  const outEnd = annotateShaderLog(SOURCE, 'ERROR: 0:6: bad', 3);
  assert.ok(outEnd.includes('>    6 | }'));
  assert.ok(!outEnd.includes('   7 |'), 'no line past the end');
});

test('annotateShaderLog handles multiple errors and passthrough lines', () => {
  const log = ['ERROR: 0:2: first', 'some driver preamble without numbers', 'WARNING: 0:4: second', ''].join('\n');
  const out = annotateShaderLog(SOURCE, log);
  assert.ok(out.includes('>    2 | precision highp float;'));
  assert.ok(out.includes('>    4 | void main() {'));
  assert.ok(out.includes('some driver preamble without numbers'), 'unparseable lines kept verbatim');
  assert.ok(!out.endsWith('\n'), 'blank log lines dropped');
});

test('annotateShaderLog ignores out-of-range line references', () => {
  const out = annotateShaderLog(SOURCE, 'ERROR: 0:99: beyond the end');
  assert.equal(out, 'ERROR: 0:99: beyond the end');
});
