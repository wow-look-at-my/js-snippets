import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateShaderLog, injectChunk } from './program.ts';

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

const CHUNK = ['float ripple(float t) {', '  return sin(t);', '}'].join('\n');

test('injectChunk inserts immediately after the #version line, before precision lines', () => {
  const src = ['#version 300 es', 'precision highp float;', 'void main() {}'].join('\n');
  const out = injectChunk(src, CHUNK);
  assert.equal(
    out,
    ['#version 300 es', 'float ripple(float t) {', '  return sin(t);', '}', 'precision highp float;', 'void main() {}'].join('\n'),
  );
});

test('injectChunk prepends when there is no #version line', () => {
  const src = 'precision mediump float;\nvoid main() {}';
  assert.equal(injectChunk(src, CHUNK), CHUNK + '\n' + src);
});

test('injectChunk handles a #version-only source without trailing newline', () => {
  const out = injectChunk('#version 300 es', CHUNK);
  assert.equal(out, '#version 300 es\n' + CHUNK + '\n');
});

test('injectChunk does not double the newline for a chunk with a trailing newline', () => {
  const src = '#version 300 es\nvoid main() {}';
  assert.equal(injectChunk(src, CHUNK + '\n'), '#version 300 es\n' + CHUNK + '\nvoid main() {}');
});

test('injectChunk is idempotent', () => {
  const src = '#version 300 es\nvoid main() {}';
  const once = injectChunk(src, CHUNK);
  assert.equal(injectChunk(once, CHUNK), once);
  assert.equal(injectChunk(once, CHUNK + '\n'), once, 'trailing-newline variant also detected');
});

test('injectChunk with an empty chunk returns the source unchanged', () => {
  const src = '#version 300 es\nvoid main() {}';
  assert.equal(injectChunk(src, ''), src);
});

test('injectChunk tolerates whitespace around # and version', () => {
  const src = '\t# version 300 es\nvoid main() {}';
  assert.equal(injectChunk(src, CHUNK), '\t# version 300 es\n' + CHUNK + '\nvoid main() {}');
});

test('injectChunk keeps a CRLF version line intact', () => {
  const src = '#version 300 es\r\nvoid main() {}';
  assert.equal(injectChunk(src, CHUNK), '#version 300 es\r\n' + CHUNK + '\nvoid main() {}');
});

test('injectChunk does not treat a later #version-looking line as the first line', () => {
  const src = '// header\n#version 300 es\nvoid main() {}';
  assert.equal(injectChunk(src, CHUNK), CHUNK + '\n' + src, 'only a first-line directive counts');
});
