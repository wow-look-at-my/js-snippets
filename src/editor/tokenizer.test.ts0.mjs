// src/editor/tokenizer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/editor/tokenizer.ts
var OPERATORS = [
  ">>>=",
  "...",
  ">>>",
  "<<=",
  ">>=",
  "**=",
  "&&=",
  "||=",
  "??=",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "=>",
  "**",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<",
  ">>",
  "++",
  "--",
  "->",
  "::",
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "<",
  ">",
  "!",
  "~",
  "&",
  "|",
  "^",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ";",
  ".",
  "?",
  ":",
  "@",
  "#",
  "$"
].sort((a, b) => b.length - a.length);
var isIdStart = (c) => c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c === "_";
var isIdPart = (c) => isIdStart(c) || c >= "0" && c <= "9";
var isDigit = (c) => c >= "0" && c <= "9";
var isHex = (c) => isDigit(c) || c >= "a" && c <= "f" || c >= "A" && c <= "F";
var isSpace = (c) => c === " " || c === "	" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
var isSuffix = (c) => "fFuUlLiIhH".indexOf(c) >= 0;
function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  const push = (type, start) => {
    tokens.push({ type, text: src.slice(start, i), start, end: i });
  };
  while (i < n) {
    const c = src[i];
    const start = i;
    if (isSpace(c)) {
      while (i < n && isSpace(src[i])) i++;
      push("ws", start);
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      push("comment", start);
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i = Math.min(n, i + 2);
      push("comment", start);
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      i = Math.min(n, i + 1);
      push("string", start);
      continue;
    }
    if (isDigit(c) || c === "." && isDigit(src[i + 1])) {
      i++;
      if (src[start] === "0" && (src[i] === "x" || src[i] === "X")) {
        i++;
        while (i < n && isHex(src[i])) i++;
      } else {
        while (i < n && (isDigit(src[i]) || src[i] === ".")) i++;
        if (src[i] === "e" || src[i] === "E") {
          i++;
          if (src[i] === "+" || src[i] === "-") i++;
          while (i < n && isDigit(src[i])) i++;
        }
      }
      while (i < n && isSuffix(src[i])) i++;
      push("number", start);
      continue;
    }
    if (isIdStart(c)) {
      i++;
      while (i < n && isIdPart(src[i])) i++;
      push("ident", start);
      continue;
    }
    let matched = null;
    for (const op of OPERATORS) {
      if (src.startsWith(op, i)) {
        matched = op;
        break;
      }
    }
    i += matched ? matched.length : 1;
    push("punct", start);
  }
  return tokens;
}
var DEFAULT_MEMBER_OPS = [".", "->", "::"];
function classify(tokens, language) {
  const keywords = language.keywords;
  const memberOps = language.memberOps ?? DEFAULT_MEMBER_OPS;
  const detectCalls = language.detectCalls ?? true;
  const isCode = (t) => t.type !== "ws" && t.type !== "comment";
  const prevIdx = new Array(tokens.length).fill(-1);
  const nextIdx = new Array(tokens.length).fill(-1);
  for (let i = 0, last = -1; i < tokens.length; i++) {
    prevIdx[i] = last;
    if (isCode(tokens[i])) last = i;
  }
  for (let i = tokens.length - 1, nxt = -1; i >= 0; i--) {
    nextIdx[i] = nxt;
    if (isCode(tokens[i])) nxt = i;
  }
  const out = new Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let role;
    switch (t.type) {
      case "ident": {
        const p = prevIdx[i] >= 0 ? tokens[prevIdx[i]] : null;
        const nx = nextIdx[i] >= 0 ? tokens[nextIdx[i]] : null;
        if (keywords.has(t.text)) role = "keyword";
        else if (p && p.type === "punct" && memberOps.indexOf(p.text) >= 0) role = "member";
        else if (detectCalls && nx && nx.type === "punct" && nx.text === "(") role = "function";
        else role = "ident";
        break;
      }
      case "number":
        role = "number";
        break;
      case "comment":
        role = "comment";
        break;
      case "string":
        role = "string";
        break;
      case "ws":
        role = "ws";
        break;
      default:
        role = "punct";
        break;
    }
    out[i] = { ...t, role };
  }
  return out;
}
var set = (words) => new Set(words.trim().split(/\s+/));
var CONTROL = `
  return if else for while do switch case default break continue discard
  struct typedef enum union class namespace template public private protected
  using new delete sizeof true false null nullptr this
`;
var CLIKE_KW = set(`
  ${CONTROL}
  const static inline extern register volatile restrict mutable constexpr
  auto void bool char short int long float double signed unsigned wchar_t
  size_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t
  virtual override final operator friend explicit
`);
var GLSL_KW = set(`
  ${CONTROL}
  const uniform varying attribute in out inout flat smooth noperspective
  centroid invariant precision lowp mediump highp layout buffer shared coherent
  volatile readonly writeonly precise subroutine
  void bool int uint float double
  vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4
  dvec2 dvec3 dvec4 mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4
  mat4x2 mat4x3 mat4x4 dmat2 dmat3 dmat4
  sampler1D sampler2D sampler3D samplerCube sampler2DArray samplerCubeArray
  sampler2DShadow samplerCubeShadow isampler2D usampler2D image2D image3D
  atomic_uint gl_Position gl_FragCoord gl_FragColor gl_VertexID gl_InstanceID
`);
var HLSL_KW = set(`
  ${CONTROL}
  const static inline uniform in out inout precise groupshared volatile
  row_major column_major nointerpolation linear centroid noperspective sample
  void bool int uint dword half float double min16float min10float min16int
  min16uint fixed
  float2 float3 float4 float2x2 float3x3 float4x4 float3x4 float4x3 float2x3
  float3x2 float2x4 float4x2 half2 half3 half4 int2 int3 int4 uint2 uint3 uint4
  bool2 bool3 bool4 double2 double3 double4
  Texture1D Texture2D Texture3D TextureCube Texture2DArray TextureCubeArray
  RWTexture2D RWTexture3D SamplerState SamplerComparisonState
  Buffer RWBuffer StructuredBuffer RWStructuredBuffer ByteAddressBuffer
  RWByteAddressBuffer ConstantBuffer cbuffer tbuffer register numthreads
  SV_Position SV_Target SV_TargetIndex SV_DispatchThreadID SV_GroupID
`);
var WGSL_KW = set(`
  fn let var const struct return if else for while loop break continue
  discard switch case default fallthrough type alias enable requires
  override workgroup_size compute vertex fragment
  bool i32 u32 f32 f16 vec2 vec3 vec4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3
  mat3x4 mat4x2 mat4x3 mat4x4 array ptr atomic sampler sampler_comparison
  texture_1d texture_2d texture_2d_array texture_3d texture_cube
  texture_cube_array texture_multisampled_2d texture_storage_1d
  texture_storage_2d texture_storage_2d_array texture_storage_3d
  texture_depth_2d texture_depth_2d_array texture_depth_cube
  texture_depth_cube_array function private workgroup uniform storage
  read write read_write true false
`);
var JS_KW = set(`
  var let const function return if else for while do switch case default
  break continue new delete typeof instanceof in of void this super class
  extends static get set yield async await import export from as
  try catch finally throw debugger with true false null undefined NaN Infinity
`);
var LANGUAGES = {
  clike: { name: "C-like", keywords: CLIKE_KW },
  c: { name: "C", keywords: CLIKE_KW },
  cpp: { name: "C++", keywords: CLIKE_KW },
  "c++": { name: "C++", keywords: CLIKE_KW },
  glsl: { name: "GLSL", keywords: GLSL_KW },
  hlsl: { name: "HLSL", keywords: HLSL_KW },
  wgsl: { name: "WGSL", keywords: WGSL_KW },
  js: { name: "JavaScript", keywords: JS_KW },
  javascript: { name: "JavaScript", keywords: JS_KW },
  ts: { name: "TypeScript", keywords: JS_KW },
  typescript: { name: "TypeScript", keywords: JS_KW }
};
function resolveLanguage(language) {
  if (!language) return LANGUAGES.clike;
  if (typeof language === "string") {
    return LANGUAGES[language.toLowerCase()] ?? LANGUAGES.clike;
  }
  return language;
}

// src/editor/tokenizer.test.ts
var roundTrips = (src) => tokenize(src).map((t) => t.text).join("") === src;
var SAMPLES = [
  "",
  "int x = 42;",
  "float v = 3.14e-2f;",
  "// a line comment\nint y = 0x1F;",
  "/* block\n   comment */ return v;",
  'const char* s = "hello \\"world\\"";',
  "char c = '\\n';",
  "a >>= b; c <<= d; e ||= f;",
  "obj.member->ptr::scope[idx](arg1, arg2);",
  "vec3 n = normalize(cross(a, b));",
  "`template ${ignored}`",
  "fn main() { let x: f32 = 1.0; }"
];
test("tokenize round-trips: concatenating token text reproduces the input", () => {
  for (const src of SAMPLES) {
    assert.ok(roundTrips(src), `round-trip failed for: ${JSON.stringify(src)}`);
  }
});
test("tokenize offsets are contiguous and cover the whole source", () => {
  const src = "int x = f(a.b);";
  const toks = tokenize(src);
  let pos = 0;
  for (const t of toks) {
    assert.equal(t.start, pos, "token start follows previous end");
    assert.equal(t.text, src.slice(t.start, t.end), "text matches its slice");
    pos = t.end;
  }
  assert.equal(pos, src.length, "tokens cover the full source");
});
test("tokenize classifies basic token types", () => {
  const toks = tokenize('x = 12 + "s"; // c');
  const types = toks.filter((t) => t.type !== "ws").map((t) => t.type);
  assert.ok(types.includes("ident"), "has ident");
  assert.ok(types.includes("number"), "has number");
  assert.ok(types.includes("string"), "has string");
  assert.ok(types.includes("punct"), "has punct");
  assert.ok(types.includes("comment"), "has comment");
});
test("tokenize greedily matches the longest operator", () => {
  const toks = tokenize("a >>>= b").filter((t) => t.type === "punct");
  assert.equal(toks[0].text, ">>>=", "longest operator matched");
});
function rolesFor(src, lang = "clike") {
  const hi = classify(tokenize(src), resolveLanguage(lang));
  const m = /* @__PURE__ */ new Map();
  for (const t of hi) {
    if (t.type === "ident") m.set(t.text, t.role);
  }
  return m;
}
test("classify marks keywords, function calls, and member accesses", () => {
  const roles = rolesFor("return obj.field + call(x);");
  assert.equal(roles.get("return"), "keyword", "return is a keyword");
  assert.equal(roles.get("field"), "member", "obj.field -> member");
  assert.equal(roles.get("call"), "function", "call( -> function");
  assert.equal(roles.get("obj"), "ident", "plain identifier");
  assert.equal(roles.get("x"), "ident", "argument identifier");
});
test("classify assigns number / string / comment roles", () => {
  const hi = classify(tokenize('int n = 5; /* c */ char* s = "t";'), resolveLanguage("clike"));
  const byType = (want) => hi.find((t) => t.type === want)?.role;
  assert.equal(byType("number"), "number");
  assert.equal(byType("string"), "string");
  assert.equal(byType("comment"), "comment");
});
test("classify recognises member access through -> and ::", () => {
  const roles = rolesFor("ptr->m1; Type::m2;", "cpp");
  assert.equal(roles.get("m1"), "member", "-> member");
  assert.equal(roles.get("m2"), "member", ":: member");
});
test("classify uses the language keyword set (WGSL fn/let)", () => {
  const roles = rolesFor("fn main() { let x = 1; }", "wgsl");
  assert.equal(roles.get("fn"), "keyword", "fn is a WGSL keyword");
  assert.equal(roles.get("let"), "keyword", "let is a WGSL keyword");
  assert.equal(roles.get("main"), "function", "main( -> function");
});
test("resolveLanguage falls back to the C-like preset on unknown / missing input", () => {
  assert.equal(resolveLanguage(void 0), LANGUAGES.clike);
  assert.equal(resolveLanguage("not-a-language"), LANGUAGES.clike);
  assert.equal(resolveLanguage("WGSL"), LANGUAGES.wgsl);
  assert.equal(resolveLanguage("glsl"), LANGUAGES.glsl);
});
test("resolveLanguage passes a custom LanguageDef through unchanged", () => {
  const custom = { name: "X", keywords: /* @__PURE__ */ new Set(["foo"]) };
  assert.equal(resolveLanguage(custom), custom);
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidG9rZW5pemVyLnRlc3QudHMiLCAidG9rZW5pemVyLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBUZXN0cyBmb3IgdGhlIGJ5dGUtcHJlc2VydmluZyB0b2tlbml6ZXIgKyBzeW50YXggY2xhc3NpZmllci5cblxuaW1wb3J0IHsgdGVzdCB9IGZyb20gJ25vZGU6dGVzdCc7XG5pbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0L3N0cmljdCc7XG5cbmltcG9ydCB7IHRva2VuaXplLCBjbGFzc2lmeSwgcmVzb2x2ZUxhbmd1YWdlLCBMQU5HVUFHRVMgfSBmcm9tICcuL3Rva2VuaXplci50cyc7XG5pbXBvcnQgdHlwZSB7IFRva2VuUm9sZSB9IGZyb20gJy4vdG9rZW5pemVyLnRzJztcblxuY29uc3Qgcm91bmRUcmlwcyA9IChzcmM6IHN0cmluZyk6IGJvb2xlYW4gPT5cbiAgdG9rZW5pemUoc3JjKS5tYXAoKHQpID0+IHQudGV4dCkuam9pbignJykgPT09IHNyYztcblxuY29uc3QgU0FNUExFUzogc3RyaW5nW10gPSBbXG4gICcnLFxuICAnaW50IHggPSA0MjsnLFxuICAnZmxvYXQgdiA9IDMuMTRlLTJmOycsXG4gICcvLyBhIGxpbmUgY29tbWVudFxcbmludCB5ID0gMHgxRjsnLFxuICAnLyogYmxvY2tcXG4gICBjb21tZW50ICovIHJldHVybiB2OycsXG4gICdjb25zdCBjaGFyKiBzID0gXCJoZWxsbyBcXFxcXCJ3b3JsZFxcXFxcIlwiOycsXG4gIFwiY2hhciBjID0gJ1xcXFxuJztcIixcbiAgJ2EgPj49IGI7IGMgPDw9IGQ7IGUgfHw9IGY7JyxcbiAgJ29iai5tZW1iZXItPnB0cjo6c2NvcGVbaWR4XShhcmcxLCBhcmcyKTsnLFxuICAndmVjMyBuID0gbm9ybWFsaXplKGNyb3NzKGEsIGIpKTsnLFxuICAnYHRlbXBsYXRlICR7aWdub3JlZH1gJyxcbiAgJ2ZuIG1haW4oKSB7IGxldCB4OiBmMzIgPSAxLjA7IH0nLFxuXTtcblxudGVzdCgndG9rZW5pemUgcm91bmQtdHJpcHM6IGNvbmNhdGVuYXRpbmcgdG9rZW4gdGV4dCByZXByb2R1Y2VzIHRoZSBpbnB1dCcsICgpID0+IHtcbiAgZm9yIChjb25zdCBzcmMgb2YgU0FNUExFUykge1xuICAgIGFzc2VydC5vayhyb3VuZFRyaXBzKHNyYyksIGByb3VuZC10cmlwIGZhaWxlZCBmb3I6ICR7SlNPTi5zdHJpbmdpZnkoc3JjKX1gKTtcbiAgfVxufSk7XG5cbnRlc3QoJ3Rva2VuaXplIG9mZnNldHMgYXJlIGNvbnRpZ3VvdXMgYW5kIGNvdmVyIHRoZSB3aG9sZSBzb3VyY2UnLCAoKSA9PiB7XG4gIGNvbnN0IHNyYyA9ICdpbnQgeCA9IGYoYS5iKTsnO1xuICBjb25zdCB0b2tzID0gdG9rZW5pemUoc3JjKTtcbiAgbGV0IHBvcyA9IDA7XG4gIGZvciAoY29uc3QgdCBvZiB0b2tzKSB7XG4gICAgYXNzZXJ0LmVxdWFsKHQuc3RhcnQsIHBvcywgJ3Rva2VuIHN0YXJ0IGZvbGxvd3MgcHJldmlvdXMgZW5kJyk7XG4gICAgYXNzZXJ0LmVxdWFsKHQudGV4dCwgc3JjLnNsaWNlKHQuc3RhcnQsIHQuZW5kKSwgJ3RleHQgbWF0Y2hlcyBpdHMgc2xpY2UnKTtcbiAgICBwb3MgPSB0LmVuZDtcbiAgfVxuICBhc3NlcnQuZXF1YWwocG9zLCBzcmMubGVuZ3RoLCAndG9rZW5zIGNvdmVyIHRoZSBmdWxsIHNvdXJjZScpO1xufSk7XG5cbnRlc3QoJ3Rva2VuaXplIGNsYXNzaWZpZXMgYmFzaWMgdG9rZW4gdHlwZXMnLCAoKSA9PiB7XG4gIGNvbnN0IHRva3MgPSB0b2tlbml6ZSgneCA9IDEyICsgXCJzXCI7IC8vIGMnKTtcbiAgY29uc3QgdHlwZXMgPSB0b2tzLmZpbHRlcigodCkgPT4gdC50eXBlICE9PSAnd3MnKS5tYXAoKHQpID0+IHQudHlwZSk7XG4gIGFzc2VydC5vayh0eXBlcy5pbmNsdWRlcygnaWRlbnQnKSwgJ2hhcyBpZGVudCcpO1xuICBhc3NlcnQub2sodHlwZXMuaW5jbHVkZXMoJ251bWJlcicpLCAnaGFzIG51bWJlcicpO1xuICBhc3NlcnQub2sodHlwZXMuaW5jbHVkZXMoJ3N0cmluZycpLCAnaGFzIHN0cmluZycpO1xuICBhc3NlcnQub2sodHlwZXMuaW5jbHVkZXMoJ3B1bmN0JyksICdoYXMgcHVuY3QnKTtcbiAgYXNzZXJ0Lm9rKHR5cGVzLmluY2x1ZGVzKCdjb21tZW50JyksICdoYXMgY29tbWVudCcpO1xufSk7XG5cbnRlc3QoJ3Rva2VuaXplIGdyZWVkaWx5IG1hdGNoZXMgdGhlIGxvbmdlc3Qgb3BlcmF0b3InLCAoKSA9PiB7XG4gIGNvbnN0IHRva3MgPSB0b2tlbml6ZSgnYSA+Pj49IGInKS5maWx0ZXIoKHQpID0+IHQudHlwZSA9PT0gJ3B1bmN0Jyk7XG4gIGFzc2VydC5lcXVhbCh0b2tzWzBdLnRleHQsICc+Pj49JywgJ2xvbmdlc3Qgb3BlcmF0b3IgbWF0Y2hlZCcpO1xufSk7XG5cbmZ1bmN0aW9uIHJvbGVzRm9yKHNyYzogc3RyaW5nLCBsYW5nID0gJ2NsaWtlJyk6IE1hcDxzdHJpbmcsIFRva2VuUm9sZT4ge1xuICBjb25zdCBoaSA9IGNsYXNzaWZ5KHRva2VuaXplKHNyYyksIHJlc29sdmVMYW5ndWFnZShsYW5nKSk7XG4gIGNvbnN0IG0gPSBuZXcgTWFwPHN0cmluZywgVG9rZW5Sb2xlPigpO1xuICBmb3IgKGNvbnN0IHQgb2YgaGkpIHtcbiAgICBpZiAodC50eXBlID09PSAnaWRlbnQnKSBtLnNldCh0LnRleHQsIHQucm9sZSk7XG4gIH1cbiAgcmV0dXJuIG07XG59XG5cbnRlc3QoJ2NsYXNzaWZ5IG1hcmtzIGtleXdvcmRzLCBmdW5jdGlvbiBjYWxscywgYW5kIG1lbWJlciBhY2Nlc3NlcycsICgpID0+IHtcbiAgY29uc3Qgcm9sZXMgPSByb2xlc0ZvcigncmV0dXJuIG9iai5maWVsZCArIGNhbGwoeCk7Jyk7XG4gIGFzc2VydC5lcXVhbChyb2xlcy5nZXQoJ3JldHVybicpLCAna2V5d29yZCcsICdyZXR1cm4gaXMgYSBrZXl3b3JkJyk7XG4gIGFzc2VydC5lcXVhbChyb2xlcy5nZXQoJ2ZpZWxkJyksICdtZW1iZXInLCAnb2JqLmZpZWxkIC0+IG1lbWJlcicpO1xuICBhc3NlcnQuZXF1YWwocm9sZXMuZ2V0KCdjYWxsJyksICdmdW5jdGlvbicsICdjYWxsKCAtPiBmdW5jdGlvbicpO1xuICBhc3NlcnQuZXF1YWwocm9sZXMuZ2V0KCdvYmonKSwgJ2lkZW50JywgJ3BsYWluIGlkZW50aWZpZXInKTtcbiAgYXNzZXJ0LmVxdWFsKHJvbGVzLmdldCgneCcpLCAnaWRlbnQnLCAnYXJndW1lbnQgaWRlbnRpZmllcicpO1xufSk7XG5cbnRlc3QoJ2NsYXNzaWZ5IGFzc2lnbnMgbnVtYmVyIC8gc3RyaW5nIC8gY29tbWVudCByb2xlcycsICgpID0+IHtcbiAgY29uc3QgaGkgPSBjbGFzc2lmeSh0b2tlbml6ZSgnaW50IG4gPSA1OyAvKiBjICovIGNoYXIqIHMgPSBcInRcIjsnKSwgcmVzb2x2ZUxhbmd1YWdlKCdjbGlrZScpKTtcbiAgY29uc3QgYnlUeXBlID0gKHdhbnQ6IHN0cmluZyk6IFRva2VuUm9sZSB8IHVuZGVmaW5lZCA9PiBoaS5maW5kKCh0KSA9PiB0LnR5cGUgPT09IHdhbnQpPy5yb2xlO1xuICBhc3NlcnQuZXF1YWwoYnlUeXBlKCdudW1iZXInKSwgJ251bWJlcicpO1xuICBhc3NlcnQuZXF1YWwoYnlUeXBlKCdzdHJpbmcnKSwgJ3N0cmluZycpO1xuICBhc3NlcnQuZXF1YWwoYnlUeXBlKCdjb21tZW50JyksICdjb21tZW50Jyk7XG59KTtcblxudGVzdCgnY2xhc3NpZnkgcmVjb2duaXNlcyBtZW1iZXIgYWNjZXNzIHRocm91Z2ggLT4gYW5kIDo6JywgKCkgPT4ge1xuICBjb25zdCByb2xlcyA9IHJvbGVzRm9yKCdwdHItPm0xOyBUeXBlOjptMjsnLCAnY3BwJyk7XG4gIGFzc2VydC5lcXVhbChyb2xlcy5nZXQoJ20xJyksICdtZW1iZXInLCAnLT4gbWVtYmVyJyk7XG4gIGFzc2VydC5lcXVhbChyb2xlcy5nZXQoJ20yJyksICdtZW1iZXInLCAnOjogbWVtYmVyJyk7XG59KTtcblxudGVzdCgnY2xhc3NpZnkgdXNlcyB0aGUgbGFuZ3VhZ2Uga2V5d29yZCBzZXQgKFdHU0wgZm4vbGV0KScsICgpID0+IHtcbiAgY29uc3Qgcm9sZXMgPSByb2xlc0ZvcignZm4gbWFpbigpIHsgbGV0IHggPSAxOyB9JywgJ3dnc2wnKTtcbiAgYXNzZXJ0LmVxdWFsKHJvbGVzLmdldCgnZm4nKSwgJ2tleXdvcmQnLCAnZm4gaXMgYSBXR1NMIGtleXdvcmQnKTtcbiAgYXNzZXJ0LmVxdWFsKHJvbGVzLmdldCgnbGV0JyksICdrZXl3b3JkJywgJ2xldCBpcyBhIFdHU0wga2V5d29yZCcpO1xuICAvLyBtYWluIGlzIGZvbGxvd2VkIGJ5ICcoJyBzbyBpdCByZWFkcyBhcyBhIGZ1bmN0aW9uIGNhbGwuXG4gIGFzc2VydC5lcXVhbChyb2xlcy5nZXQoJ21haW4nKSwgJ2Z1bmN0aW9uJywgJ21haW4oIC0+IGZ1bmN0aW9uJyk7XG59KTtcblxudGVzdCgncmVzb2x2ZUxhbmd1YWdlIGZhbGxzIGJhY2sgdG8gdGhlIEMtbGlrZSBwcmVzZXQgb24gdW5rbm93biAvIG1pc3NpbmcgaW5wdXQnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChyZXNvbHZlTGFuZ3VhZ2UodW5kZWZpbmVkKSwgTEFOR1VBR0VTLmNsaWtlKTtcbiAgYXNzZXJ0LmVxdWFsKHJlc29sdmVMYW5ndWFnZSgnbm90LWEtbGFuZ3VhZ2UnKSwgTEFOR1VBR0VTLmNsaWtlKTtcbiAgLy8gS25vd24gbmFtZXMgcmVzb2x2ZSB0byB0aGVpciBwcmVzZXQgKGNhc2UtaW5zZW5zaXRpdmUpLlxuICBhc3NlcnQuZXF1YWwocmVzb2x2ZUxhbmd1YWdlKCdXR1NMJyksIExBTkdVQUdFUy53Z3NsKTtcbiAgYXNzZXJ0LmVxdWFsKHJlc29sdmVMYW5ndWFnZSgnZ2xzbCcpLCBMQU5HVUFHRVMuZ2xzbCk7XG59KTtcblxudGVzdCgncmVzb2x2ZUxhbmd1YWdlIHBhc3NlcyBhIGN1c3RvbSBMYW5ndWFnZURlZiB0aHJvdWdoIHVuY2hhbmdlZCcsICgpID0+IHtcbiAgY29uc3QgY3VzdG9tID0geyBuYW1lOiAnWCcsIGtleXdvcmRzOiBuZXcgU2V0KFsnZm9vJ10pIH07XG4gIGFzc2VydC5lcXVhbChyZXNvbHZlTGFuZ3VhZ2UoY3VzdG9tKSwgY3VzdG9tKTtcbn0pO1xuIiwgIi8qKiBCeXRlLXByZXNlcnZpbmcgdG9rZW5pemVyICsgc3ludGF4IGNsYXNzaWZpZXIgZm9yIEMtbGlrZSBzb3VyY2UuICovXG5cbi8vIC0tIFRva2VucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVG9rZW5UeXBlID1cbiAgfCAnd3MnXG4gIHwgJ2NvbW1lbnQnXG4gIHwgJ251bWJlcidcbiAgfCAnaWRlbnQnXG4gIHwgJ3N0cmluZydcbiAgfCAncHVuY3QnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFRva2VuIHtcbiAgdHlwZTogVG9rZW5UeXBlO1xuICAvKiogVGhlIGV4YWN0IHNvdXJjZSB0ZXh0IG9mIHRoaXMgdG9rZW4gKG5ldmVyIG5vcm1hbGl6ZWQpLiAqL1xuICB0ZXh0OiBzdHJpbmc7XG4gIC8qKiBJbmNsdXNpdmUgc3RhcnQgb2Zmc2V0IGludG8gdGhlIHNvdXJjZSBzdHJpbmcuICovXG4gIHN0YXJ0OiBudW1iZXI7XG4gIC8qKiBFeGNsdXNpdmUgZW5kIG9mZnNldCBpbnRvIHRoZSBzb3VyY2Ugc3RyaW5nLiAqL1xuICBlbmQ6IG51bWJlcjtcbn1cblxuLy8gT3BlcmF0b3JzIC8gcHVuY3R1YXRpb24uIFNvcnRlZCBsb25nZXN0LWZpcnN0IGF0IGxvYWQgc28gdGhlIGdyZWVkeSBtYXRjaFxuLy8gbmV2ZXIgcmV0dXJucyBhIHNob3J0IHRva2VuIHdoZXJlIGEgbG9uZ2VyIG9uZSBhcHBsaWVzIChlLmcuIGA8PD1gIGJlZm9yZVxuLy8gYDw8YCBiZWZvcmUgYDxgKS4gQXV0aG9yaW5nIG9yZGVyIGhlcmUgaXMgaXJyZWxldmFudCBcdTIwMTQgdGhlIHNvcnQgZml4ZXMgaXQuXG5jb25zdCBPUEVSQVRPUlM6IHN0cmluZ1tdID0gW1xuICAnPj4+PScsICcuLi4nLCAnPj4+JywgJzw8PScsICc+Pj0nLCAnKio9JywgJyYmPScsICd8fD0nLCAnPz89JyxcbiAgJz09JywgJyE9JywgJzw9JywgJz49JywgJyYmJywgJ3x8JywgJz8/JywgJz8uJywgJz0+JywgJyoqJyxcbiAgJys9JywgJy09JywgJyo9JywgJy89JywgJyU9JywgJyY9JywgJ3w9JywgJ149JyxcbiAgJzw8JywgJz4+JywgJysrJywgJy0tJywgJy0+JywgJzo6JyxcbiAgJysnLCAnLScsICcqJywgJy8nLCAnJScsICc9JywgJzwnLCAnPicsICchJywgJ34nLCAnJicsICd8JywgJ14nLFxuICAnKCcsICcpJywgJ1snLCAnXScsICd7JywgJ30nLCAnLCcsICc7JywgJy4nLCAnPycsICc6JywgJ0AnLCAnIycsICckJyxcbl0uc29ydCgoYSwgYikgPT4gYi5sZW5ndGggLSBhLmxlbmd0aCk7XG5cbmNvbnN0IGlzSWRTdGFydCA9IChjOiBzdHJpbmcpOiBib29sZWFuID0+XG4gIChjID49ICdhJyAmJiBjIDw9ICd6JykgfHwgKGMgPj0gJ0EnICYmIGMgPD0gJ1onKSB8fCBjID09PSAnXyc7XG5jb25zdCBpc0lkUGFydCA9IChjOiBzdHJpbmcpOiBib29sZWFuID0+IGlzSWRTdGFydChjKSB8fCAoYyA+PSAnMCcgJiYgYyA8PSAnOScpO1xuY29uc3QgaXNEaWdpdCA9IChjOiBzdHJpbmcpOiBib29sZWFuID0+IGMgPj0gJzAnICYmIGMgPD0gJzknO1xuY29uc3QgaXNIZXggPSAoYzogc3RyaW5nKTogYm9vbGVhbiA9PlxuICBpc0RpZ2l0KGMpIHx8IChjID49ICdhJyAmJiBjIDw9ICdmJykgfHwgKGMgPj0gJ0EnICYmIGMgPD0gJ0YnKTtcbmNvbnN0IGlzU3BhY2UgPSAoYzogc3RyaW5nKTogYm9vbGVhbiA9PlxuICBjID09PSAnICcgfHwgYyA9PT0gJ1xcdCcgfHwgYyA9PT0gJ1xcbicgfHwgYyA9PT0gJ1xccicgfHwgYyA9PT0gJ1xcZicgfHwgYyA9PT0gJ1xcdic7XG5jb25zdCBpc1N1ZmZpeCA9IChjOiBzdHJpbmcpOiBib29sZWFuID0+ICdmRnVVbExpSWhIJy5pbmRleE9mKGMpID49IDA7XG5cbi8qKlxuICogU3BsaXQgYHNyY2AgaW50byBhIGZsYXQgbGlzdCBvZiB0b2tlbnMuIFRoZSBjb25jYXRlbmF0aW9uIG9mIGV2ZXJ5IHRva2VuJ3NcbiAqIGB0ZXh0YCBpcyBleGFjdGx5IGBzcmNgIFx1MjAxNCBub3RoaW5nIGlzIGRyb3BwZWQsIG1lcmdlZCwgb3IgcmV3cml0dGVuLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9rZW5pemUoc3JjOiBzdHJpbmcpOiBUb2tlbltdIHtcbiAgY29uc3QgdG9rZW5zOiBUb2tlbltdID0gW107XG4gIGNvbnN0IG4gPSBzcmMubGVuZ3RoO1xuICBsZXQgaSA9IDA7XG5cbiAgY29uc3QgcHVzaCA9ICh0eXBlOiBUb2tlblR5cGUsIHN0YXJ0OiBudW1iZXIpOiB2b2lkID0+IHtcbiAgICB0b2tlbnMucHVzaCh7IHR5cGUsIHRleHQ6IHNyYy5zbGljZShzdGFydCwgaSksIHN0YXJ0LCBlbmQ6IGkgfSk7XG4gIH07XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IHNyY1tpXTtcbiAgICBjb25zdCBzdGFydCA9IGk7XG5cbiAgICAvLyBXaGl0ZXNwYWNlIHJ1blxuICAgIGlmIChpc1NwYWNlKGMpKSB7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgaXNTcGFjZShzcmNbaV0pKSBpKys7XG4gICAgICBwdXNoKCd3cycsIHN0YXJ0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIExpbmUgY29tbWVudFxuICAgIGlmIChjID09PSAnLycgJiYgc3JjW2kgKyAxXSA9PT0gJy8nKSB7XG4gICAgICBpICs9IDI7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgc3JjW2ldICE9PSAnXFxuJykgaSsrO1xuICAgICAgcHVzaCgnY29tbWVudCcsIHN0YXJ0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIEJsb2NrIGNvbW1lbnRcbiAgICBpZiAoYyA9PT0gJy8nICYmIHNyY1tpICsgMV0gPT09ICcqJykge1xuICAgICAgaSArPSAyO1xuICAgICAgd2hpbGUgKGkgPCBuICYmICEoc3JjW2ldID09PSAnKicgJiYgc3JjW2kgKyAxXSA9PT0gJy8nKSkgaSsrO1xuICAgICAgaSA9IE1hdGgubWluKG4sIGkgKyAyKTtcbiAgICAgIHB1c2goJ2NvbW1lbnQnLCBzdGFydCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBTdHJpbmcgLyBjaGFyIC8gdGVtcGxhdGUgbGl0ZXJhbCAobm8gaW50ZXJwb2xhdGlvbiBwYXJzaW5nKVxuICAgIGlmIChjID09PSAnXCInIHx8IGMgPT09IFwiJ1wiIHx8IGMgPT09ICdgJykge1xuICAgICAgY29uc3QgcSA9IGM7XG4gICAgICBpKys7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgc3JjW2ldICE9PSBxKSB7XG4gICAgICAgIGlmIChzcmNbaV0gPT09ICdcXFxcJykgaSsrO1xuICAgICAgICBpKys7XG4gICAgICB9XG4gICAgICBpID0gTWF0aC5taW4obiwgaSArIDEpO1xuICAgICAgcHVzaCgnc3RyaW5nJywgc3RhcnQpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gTnVtYmVyIChkZWNpbWFsIC8gaGV4LCBleHBvbmVudCwgdHlwZSBzdWZmaXhlcylcbiAgICBpZiAoaXNEaWdpdChjKSB8fCAoYyA9PT0gJy4nICYmIGlzRGlnaXQoc3JjW2kgKyAxXSkpKSB7XG4gICAgICBpKys7XG4gICAgICBpZiAoc3JjW3N0YXJ0XSA9PT0gJzAnICYmIChzcmNbaV0gPT09ICd4JyB8fCBzcmNbaV0gPT09ICdYJykpIHtcbiAgICAgICAgaSsrO1xuICAgICAgICB3aGlsZSAoaSA8IG4gJiYgaXNIZXgoc3JjW2ldKSkgaSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgd2hpbGUgKGkgPCBuICYmIChpc0RpZ2l0KHNyY1tpXSkgfHwgc3JjW2ldID09PSAnLicpKSBpKys7XG4gICAgICAgIGlmIChzcmNbaV0gPT09ICdlJyB8fCBzcmNbaV0gPT09ICdFJykge1xuICAgICAgICAgIGkrKztcbiAgICAgICAgICBpZiAoc3JjW2ldID09PSAnKycgfHwgc3JjW2ldID09PSAnLScpIGkrKztcbiAgICAgICAgICB3aGlsZSAoaSA8IG4gJiYgaXNEaWdpdChzcmNbaV0pKSBpKys7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHdoaWxlIChpIDwgbiAmJiBpc1N1ZmZpeChzcmNbaV0pKSBpKys7XG4gICAgICBwdXNoKCdudW1iZXInLCBzdGFydCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBJZGVudGlmaWVyIC8ga2V5d29yZFxuICAgIGlmIChpc0lkU3RhcnQoYykpIHtcbiAgICAgIGkrKztcbiAgICAgIHdoaWxlIChpIDwgbiAmJiBpc0lkUGFydChzcmNbaV0pKSBpKys7XG4gICAgICBwdXNoKCdpZGVudCcsIHN0YXJ0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIE9wZXJhdG9yIC8gcHVuY3R1YXRpb24gKGdyZWVkeSBsb25nZXN0IG1hdGNoKS5cbiAgICBsZXQgbWF0Y2hlZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgZm9yIChjb25zdCBvcCBvZiBPUEVSQVRPUlMpIHtcbiAgICAgIGlmIChzcmMuc3RhcnRzV2l0aChvcCwgaSkpIHtcbiAgICAgICAgbWF0Y2hlZCA9IG9wO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaSArPSBtYXRjaGVkID8gbWF0Y2hlZC5sZW5ndGggOiAxO1xuICAgIHB1c2goJ3B1bmN0Jywgc3RhcnQpO1xuICB9XG5cbiAgcmV0dXJuIHRva2Vucztcbn1cblxuLy8gLS0gU3ludGF4IGNsYXNzaWZpY2F0aW9uIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUb2tlblJvbGUgPVxuICB8ICd3cydcbiAgfCAnY29tbWVudCdcbiAgfCAnbnVtYmVyJ1xuICB8ICdzdHJpbmcnXG4gIHwgJ3B1bmN0J1xuICB8ICdrZXl3b3JkJ1xuICB8ICdmdW5jdGlvbidcbiAgfCAnbWVtYmVyJ1xuICB8ICdpZGVudCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSGlUb2tlbiBleHRlbmRzIFRva2VuIHtcbiAgLyoqIFRoZSBoaWdobGlnaHQgcm9sZSB0aGlzIHRva2VuIHBsYXlzIGluIGNvbnRleHQuICovXG4gIHJvbGU6IFRva2VuUm9sZTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBMYW5ndWFnZURlZiB7XG4gIC8qKiBEaXNwbGF5IG5hbWUgKGluZm9ybWF0aW9uYWwpLiAqL1xuICBuYW1lOiBzdHJpbmc7XG4gIC8qKiBSZXNlcnZlZCB3b3JkcyBjb2xvdXJlZCBhcyBrZXl3b3Jkcy90eXBlcy4gKi9cbiAga2V5d29yZHM6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKiBQdW5jdHVhdGlvbiB0aGF0IHR1cm5zIHRoZSBmb2xsb3dpbmcgaWRlbnRpZmllciBpbnRvIGEgYG1lbWJlcmAgYWNjZXNzLiBEZWZhdWx0cyB0byBgWycuJywgJy0+JywgJzo6J11gLiAqL1xuICBtZW1iZXJPcHM/OiByZWFkb25seSBzdHJpbmdbXTtcbiAgLyoqIFdoZW4gdHJ1ZSAoZGVmYXVsdCksIGFuIGlkZW50aWZpZXIgaW1tZWRpYXRlbHkgZm9sbG93ZWQgYnkgYChgIGlzIGNvbG91cmVkIGFzIGEgYGZ1bmN0aW9uYCBjYWxsLiAqL1xuICBkZXRlY3RDYWxscz86IGJvb2xlYW47XG59XG5cbmNvbnN0IERFRkFVTFRfTUVNQkVSX09QUyA9IFsnLicsICctPicsICc6OiddO1xuXG4vKipcbiAqIEFzc2lnbiBhIGhpZ2hsaWdodCBgcm9sZWAgdG8gZXZlcnkgdG9rZW4sIHVzaW5nIG5laWdoYm91cmluZyBjb2RlIHRva2VucyBmb3JcbiAqIGNvbnRleHQ6IGBhLnhgIHJlYWRzIGB4YCBhcyBhIG1lbWJlciwgYGYoeClgIHJlYWRzIGBmYCBhcyBhIGNhbGwsIGFuZCBhbnlcbiAqIHdvcmQgaW4gdGhlIGxhbmd1YWdlJ3Mga2V5d29yZCBzZXQgaXMgYSBrZXl3b3JkLiBSZXR1cm5zIGEgZnJlc2ggYXJyYXk7IHRoZVxuICogaW5wdXQgdG9rZW5zIGFyZSBub3QgbXV0YXRlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsYXNzaWZ5KHRva2VuczogVG9rZW5bXSwgbGFuZ3VhZ2U6IExhbmd1YWdlRGVmKTogSGlUb2tlbltdIHtcbiAgY29uc3Qga2V5d29yZHMgPSBsYW5ndWFnZS5rZXl3b3JkcztcbiAgY29uc3QgbWVtYmVyT3BzID0gbGFuZ3VhZ2UubWVtYmVyT3BzID8/IERFRkFVTFRfTUVNQkVSX09QUztcbiAgY29uc3QgZGV0ZWN0Q2FsbHMgPSBsYW5ndWFnZS5kZXRlY3RDYWxscyA/PyB0cnVlO1xuXG4gIGNvbnN0IGlzQ29kZSA9ICh0OiBUb2tlbik6IGJvb2xlYW4gPT4gdC50eXBlICE9PSAnd3MnICYmIHQudHlwZSAhPT0gJ2NvbW1lbnQnO1xuXG4gIC8vIE5lYXJlc3QgcHJlY2VkaW5nIC8gZm9sbG93aW5nICpjb2RlKiB0b2tlbiAoc2tpcHBpbmcgd3MgKyBjb21tZW50cykuXG4gIGNvbnN0IHByZXZJZHggPSBuZXcgQXJyYXk8bnVtYmVyPih0b2tlbnMubGVuZ3RoKS5maWxsKC0xKTtcbiAgY29uc3QgbmV4dElkeCA9IG5ldyBBcnJheTxudW1iZXI+KHRva2Vucy5sZW5ndGgpLmZpbGwoLTEpO1xuICBmb3IgKGxldCBpID0gMCwgbGFzdCA9IC0xOyBpIDwgdG9rZW5zLmxlbmd0aDsgaSsrKSB7XG4gICAgcHJldklkeFtpXSA9IGxhc3Q7XG4gICAgaWYgKGlzQ29kZSh0b2tlbnNbaV0pKSBsYXN0ID0gaTtcbiAgfVxuICBmb3IgKGxldCBpID0gdG9rZW5zLmxlbmd0aCAtIDEsIG54dCA9IC0xOyBpID49IDA7IGktLSkge1xuICAgIG5leHRJZHhbaV0gPSBueHQ7XG4gICAgaWYgKGlzQ29kZSh0b2tlbnNbaV0pKSBueHQgPSBpO1xuICB9XG5cbiAgY29uc3Qgb3V0OiBIaVRva2VuW10gPSBuZXcgQXJyYXkodG9rZW5zLmxlbmd0aCk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdG9rZW5zLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdCA9IHRva2Vuc1tpXTtcbiAgICBsZXQgcm9sZTogVG9rZW5Sb2xlO1xuICAgIHN3aXRjaCAodC50eXBlKSB7XG4gICAgICBjYXNlICdpZGVudCc6IHtcbiAgICAgICAgY29uc3QgcCA9IHByZXZJZHhbaV0gPj0gMCA/IHRva2Vuc1twcmV2SWR4W2ldXSA6IG51bGw7XG4gICAgICAgIGNvbnN0IG54ID0gbmV4dElkeFtpXSA+PSAwID8gdG9rZW5zW25leHRJZHhbaV1dIDogbnVsbDtcbiAgICAgICAgaWYgKGtleXdvcmRzLmhhcyh0LnRleHQpKSByb2xlID0gJ2tleXdvcmQnO1xuICAgICAgICBlbHNlIGlmIChwICYmIHAudHlwZSA9PT0gJ3B1bmN0JyAmJiBtZW1iZXJPcHMuaW5kZXhPZihwLnRleHQpID49IDApIHJvbGUgPSAnbWVtYmVyJztcbiAgICAgICAgZWxzZSBpZiAoZGV0ZWN0Q2FsbHMgJiYgbnggJiYgbngudHlwZSA9PT0gJ3B1bmN0JyAmJiBueC50ZXh0ID09PSAnKCcpIHJvbGUgPSAnZnVuY3Rpb24nO1xuICAgICAgICBlbHNlIHJvbGUgPSAnaWRlbnQnO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ251bWJlcic6IHJvbGUgPSAnbnVtYmVyJzsgYnJlYWs7XG4gICAgICBjYXNlICdjb21tZW50Jzogcm9sZSA9ICdjb21tZW50JzsgYnJlYWs7XG4gICAgICBjYXNlICdzdHJpbmcnOiByb2xlID0gJ3N0cmluZyc7IGJyZWFrO1xuICAgICAgY2FzZSAnd3MnOiByb2xlID0gJ3dzJzsgYnJlYWs7XG4gICAgICBkZWZhdWx0OiByb2xlID0gJ3B1bmN0JzsgYnJlYWs7XG4gICAgfVxuICAgIG91dFtpXSA9IHsgLi4udCwgcm9sZSB9O1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8vIC0tIEJ1aWx0LWluIGxhbmd1YWdlcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3Qgc2V0ID0gKHdvcmRzOiBzdHJpbmcpOiBSZWFkb25seVNldDxzdHJpbmc+ID0+XG4gIG5ldyBTZXQod29yZHMudHJpbSgpLnNwbGl0KC9cXHMrLykpO1xuXG5jb25zdCBDT05UUk9MID0gYFxuICByZXR1cm4gaWYgZWxzZSBmb3Igd2hpbGUgZG8gc3dpdGNoIGNhc2UgZGVmYXVsdCBicmVhayBjb250aW51ZSBkaXNjYXJkXG4gIHN0cnVjdCB0eXBlZGVmIGVudW0gdW5pb24gY2xhc3MgbmFtZXNwYWNlIHRlbXBsYXRlIHB1YmxpYyBwcml2YXRlIHByb3RlY3RlZFxuICB1c2luZyBuZXcgZGVsZXRlIHNpemVvZiB0cnVlIGZhbHNlIG51bGwgbnVsbHB0ciB0aGlzXG5gO1xuXG5jb25zdCBDTElLRV9LVyA9IHNldChgXG4gICR7Q09OVFJPTH1cbiAgY29uc3Qgc3RhdGljIGlubGluZSBleHRlcm4gcmVnaXN0ZXIgdm9sYXRpbGUgcmVzdHJpY3QgbXV0YWJsZSBjb25zdGV4cHJcbiAgYXV0byB2b2lkIGJvb2wgY2hhciBzaG9ydCBpbnQgbG9uZyBmbG9hdCBkb3VibGUgc2lnbmVkIHVuc2lnbmVkIHdjaGFyX3RcbiAgc2l6ZV90IGludDhfdCBpbnQxNl90IGludDMyX3QgaW50NjRfdCB1aW50OF90IHVpbnQxNl90IHVpbnQzMl90IHVpbnQ2NF90XG4gIHZpcnR1YWwgb3ZlcnJpZGUgZmluYWwgb3BlcmF0b3IgZnJpZW5kIGV4cGxpY2l0XG5gKTtcblxuY29uc3QgR0xTTF9LVyA9IHNldChgXG4gICR7Q09OVFJPTH1cbiAgY29uc3QgdW5pZm9ybSB2YXJ5aW5nIGF0dHJpYnV0ZSBpbiBvdXQgaW5vdXQgZmxhdCBzbW9vdGggbm9wZXJzcGVjdGl2ZVxuICBjZW50cm9pZCBpbnZhcmlhbnQgcHJlY2lzaW9uIGxvd3AgbWVkaXVtcCBoaWdocCBsYXlvdXQgYnVmZmVyIHNoYXJlZCBjb2hlcmVudFxuICB2b2xhdGlsZSByZWFkb25seSB3cml0ZW9ubHkgcHJlY2lzZSBzdWJyb3V0aW5lXG4gIHZvaWQgYm9vbCBpbnQgdWludCBmbG9hdCBkb3VibGVcbiAgdmVjMiB2ZWMzIHZlYzQgaXZlYzIgaXZlYzMgaXZlYzQgdXZlYzIgdXZlYzMgdXZlYzQgYnZlYzIgYnZlYzMgYnZlYzRcbiAgZHZlYzIgZHZlYzMgZHZlYzQgbWF0MiBtYXQzIG1hdDQgbWF0MngyIG1hdDJ4MyBtYXQyeDQgbWF0M3gyIG1hdDN4MyBtYXQzeDRcbiAgbWF0NHgyIG1hdDR4MyBtYXQ0eDQgZG1hdDIgZG1hdDMgZG1hdDRcbiAgc2FtcGxlcjFEIHNhbXBsZXIyRCBzYW1wbGVyM0Qgc2FtcGxlckN1YmUgc2FtcGxlcjJEQXJyYXkgc2FtcGxlckN1YmVBcnJheVxuICBzYW1wbGVyMkRTaGFkb3cgc2FtcGxlckN1YmVTaGFkb3cgaXNhbXBsZXIyRCB1c2FtcGxlcjJEIGltYWdlMkQgaW1hZ2UzRFxuICBhdG9taWNfdWludCBnbF9Qb3NpdGlvbiBnbF9GcmFnQ29vcmQgZ2xfRnJhZ0NvbG9yIGdsX1ZlcnRleElEIGdsX0luc3RhbmNlSURcbmApO1xuXG5jb25zdCBITFNMX0tXID0gc2V0KGBcbiAgJHtDT05UUk9MfVxuICBjb25zdCBzdGF0aWMgaW5saW5lIHVuaWZvcm0gaW4gb3V0IGlub3V0IHByZWNpc2UgZ3JvdXBzaGFyZWQgdm9sYXRpbGVcbiAgcm93X21ham9yIGNvbHVtbl9tYWpvciBub2ludGVycG9sYXRpb24gbGluZWFyIGNlbnRyb2lkIG5vcGVyc3BlY3RpdmUgc2FtcGxlXG4gIHZvaWQgYm9vbCBpbnQgdWludCBkd29yZCBoYWxmIGZsb2F0IGRvdWJsZSBtaW4xNmZsb2F0IG1pbjEwZmxvYXQgbWluMTZpbnRcbiAgbWluMTZ1aW50IGZpeGVkXG4gIGZsb2F0MiBmbG9hdDMgZmxvYXQ0IGZsb2F0MngyIGZsb2F0M3gzIGZsb2F0NHg0IGZsb2F0M3g0IGZsb2F0NHgzIGZsb2F0MngzXG4gIGZsb2F0M3gyIGZsb2F0Mng0IGZsb2F0NHgyIGhhbGYyIGhhbGYzIGhhbGY0IGludDIgaW50MyBpbnQ0IHVpbnQyIHVpbnQzIHVpbnQ0XG4gIGJvb2wyIGJvb2wzIGJvb2w0IGRvdWJsZTIgZG91YmxlMyBkb3VibGU0XG4gIFRleHR1cmUxRCBUZXh0dXJlMkQgVGV4dHVyZTNEIFRleHR1cmVDdWJlIFRleHR1cmUyREFycmF5IFRleHR1cmVDdWJlQXJyYXlcbiAgUldUZXh0dXJlMkQgUldUZXh0dXJlM0QgU2FtcGxlclN0YXRlIFNhbXBsZXJDb21wYXJpc29uU3RhdGVcbiAgQnVmZmVyIFJXQnVmZmVyIFN0cnVjdHVyZWRCdWZmZXIgUldTdHJ1Y3R1cmVkQnVmZmVyIEJ5dGVBZGRyZXNzQnVmZmVyXG4gIFJXQnl0ZUFkZHJlc3NCdWZmZXIgQ29uc3RhbnRCdWZmZXIgY2J1ZmZlciB0YnVmZmVyIHJlZ2lzdGVyIG51bXRocmVhZHNcbiAgU1ZfUG9zaXRpb24gU1ZfVGFyZ2V0IFNWX1RhcmdldEluZGV4IFNWX0Rpc3BhdGNoVGhyZWFkSUQgU1ZfR3JvdXBJRFxuYCk7XG5cbmNvbnN0IFdHU0xfS1cgPSBzZXQoYFxuICBmbiBsZXQgdmFyIGNvbnN0IHN0cnVjdCByZXR1cm4gaWYgZWxzZSBmb3Igd2hpbGUgbG9vcCBicmVhayBjb250aW51ZVxuICBkaXNjYXJkIHN3aXRjaCBjYXNlIGRlZmF1bHQgZmFsbHRocm91Z2ggdHlwZSBhbGlhcyBlbmFibGUgcmVxdWlyZXNcbiAgb3ZlcnJpZGUgd29ya2dyb3VwX3NpemUgY29tcHV0ZSB2ZXJ0ZXggZnJhZ21lbnRcbiAgYm9vbCBpMzIgdTMyIGYzMiBmMTYgdmVjMiB2ZWMzIHZlYzQgbWF0MngyIG1hdDJ4MyBtYXQyeDQgbWF0M3gyIG1hdDN4M1xuICBtYXQzeDQgbWF0NHgyIG1hdDR4MyBtYXQ0eDQgYXJyYXkgcHRyIGF0b21pYyBzYW1wbGVyIHNhbXBsZXJfY29tcGFyaXNvblxuICB0ZXh0dXJlXzFkIHRleHR1cmVfMmQgdGV4dHVyZV8yZF9hcnJheSB0ZXh0dXJlXzNkIHRleHR1cmVfY3ViZVxuICB0ZXh0dXJlX2N1YmVfYXJyYXkgdGV4dHVyZV9tdWx0aXNhbXBsZWRfMmQgdGV4dHVyZV9zdG9yYWdlXzFkXG4gIHRleHR1cmVfc3RvcmFnZV8yZCB0ZXh0dXJlX3N0b3JhZ2VfMmRfYXJyYXkgdGV4dHVyZV9zdG9yYWdlXzNkXG4gIHRleHR1cmVfZGVwdGhfMmQgdGV4dHVyZV9kZXB0aF8yZF9hcnJheSB0ZXh0dXJlX2RlcHRoX2N1YmVcbiAgdGV4dHVyZV9kZXB0aF9jdWJlX2FycmF5IGZ1bmN0aW9uIHByaXZhdGUgd29ya2dyb3VwIHVuaWZvcm0gc3RvcmFnZVxuICByZWFkIHdyaXRlIHJlYWRfd3JpdGUgdHJ1ZSBmYWxzZVxuYCk7XG5cbmNvbnN0IEpTX0tXID0gc2V0KGBcbiAgdmFyIGxldCBjb25zdCBmdW5jdGlvbiByZXR1cm4gaWYgZWxzZSBmb3Igd2hpbGUgZG8gc3dpdGNoIGNhc2UgZGVmYXVsdFxuICBicmVhayBjb250aW51ZSBuZXcgZGVsZXRlIHR5cGVvZiBpbnN0YW5jZW9mIGluIG9mIHZvaWQgdGhpcyBzdXBlciBjbGFzc1xuICBleHRlbmRzIHN0YXRpYyBnZXQgc2V0IHlpZWxkIGFzeW5jIGF3YWl0IGltcG9ydCBleHBvcnQgZnJvbSBhc1xuICB0cnkgY2F0Y2ggZmluYWxseSB0aHJvdyBkZWJ1Z2dlciB3aXRoIHRydWUgZmFsc2UgbnVsbCB1bmRlZmluZWQgTmFOIEluZmluaXR5XG5gKTtcblxuLyoqIEJ1aWx0LWluIGxhbmd1YWdlIHByZXNldHMsIGtleWVkIGJ5IG5hbWUgYW5kIGNvbW1vbiBhbGlhc2VzLiAqL1xuZXhwb3J0IGNvbnN0IExBTkdVQUdFUzogUmVjb3JkPHN0cmluZywgTGFuZ3VhZ2VEZWY+ID0ge1xuICBjbGlrZTogeyBuYW1lOiAnQy1saWtlJywga2V5d29yZHM6IENMSUtFX0tXIH0sXG4gIGM6IHsgbmFtZTogJ0MnLCBrZXl3b3JkczogQ0xJS0VfS1cgfSxcbiAgY3BwOiB7IG5hbWU6ICdDKysnLCBrZXl3b3JkczogQ0xJS0VfS1cgfSxcbiAgJ2MrKyc6IHsgbmFtZTogJ0MrKycsIGtleXdvcmRzOiBDTElLRV9LVyB9LFxuICBnbHNsOiB7IG5hbWU6ICdHTFNMJywga2V5d29yZHM6IEdMU0xfS1cgfSxcbiAgaGxzbDogeyBuYW1lOiAnSExTTCcsIGtleXdvcmRzOiBITFNMX0tXIH0sXG4gIHdnc2w6IHsgbmFtZTogJ1dHU0wnLCBrZXl3b3JkczogV0dTTF9LVyB9LFxuICBqczogeyBuYW1lOiAnSmF2YVNjcmlwdCcsIGtleXdvcmRzOiBKU19LVyB9LFxuICBqYXZhc2NyaXB0OiB7IG5hbWU6ICdKYXZhU2NyaXB0Jywga2V5d29yZHM6IEpTX0tXIH0sXG4gIHRzOiB7IG5hbWU6ICdUeXBlU2NyaXB0Jywga2V5d29yZHM6IEpTX0tXIH0sXG4gIHR5cGVzY3JpcHQ6IHsgbmFtZTogJ1R5cGVTY3JpcHQnLCBrZXl3b3JkczogSlNfS1cgfSxcbn07XG5cbi8qKlxuICogUmVzb2x2ZSBhIGxhbmd1YWdlIGFyZ3VtZW50IGludG8gYSBgTGFuZ3VhZ2VEZWZgLiBBY2NlcHRzIGEgYnVpbHQtaW4gbmFtZVxuICogKGNhc2UtaW5zZW5zaXRpdmUpLCBhIGN1c3RvbSBgTGFuZ3VhZ2VEZWZgLCBvciBgdW5kZWZpbmVkYC91bmtub3duIChmYWxsc1xuICogYmFjayB0byB0aGUgZ2VuZXJpYyBDLWxpa2UgcHJlc2V0KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVMYW5ndWFnZShsYW5ndWFnZT86IHN0cmluZyB8IExhbmd1YWdlRGVmKTogTGFuZ3VhZ2VEZWYge1xuICBpZiAoIWxhbmd1YWdlKSByZXR1cm4gTEFOR1VBR0VTLmNsaWtlO1xuICBpZiAodHlwZW9mIGxhbmd1YWdlID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBMQU5HVUFHRVNbbGFuZ3VhZ2UudG9Mb3dlckNhc2UoKV0gPz8gTEFOR1VBR0VT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
