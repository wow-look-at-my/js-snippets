/**
 * Byte-preserving tokenizer + syntax classifier for C-like source.
 *
 * Pure and DOM-free, so it can run in a browser, a worker, or Node. Every byte
 * of the input is preserved (whitespace and comments included) and each token
 * carries its `start`/`end` offsets, so the source can be re-rendered span by
 * span without ever drifting out of sync with the text — which is exactly what
 * the `<code-editor>` element relies on to keep a native caret aligned over the
 * highlighted glyphs.
 *
 * Handles HLSL / GLSL / WGSL / C / C++ / JavaScript well enough for editor
 * highlighting: line + block comments, `"`/`'`/`` ` `` strings, decimal/hex
 * numbers with exponents and type suffixes, and a greedy longest-operator
 * match. It is deliberately not a full parser — it never tracks scopes,
 * preprocessor state, or template-literal interpolation.
 */

// -- Tokens ------------------------------------------------------------------

export type TokenType =
  | 'ws'
  | 'comment'
  | 'number'
  | 'ident'
  | 'string'
  | 'punct';

export interface Token {
  type: TokenType;
  /** The exact source text of this token (never normalized). */
  text: string;
  /** Inclusive start offset into the source string. */
  start: number;
  /** Exclusive end offset into the source string. */
  end: number;
}

// Operators / punctuation. Sorted longest-first at load so the greedy match
// never returns a short token where a longer one applies (e.g. `<<=` before
// `<<` before `<`). Authoring order here is irrelevant — the sort fixes it.
const OPERATORS: string[] = [
  // 3+ char (mostly JS, harmless elsewhere)
  '>>>=', '...', '>>>', '<<=', '>>=', '**=', '&&=', '||=', '??=',
  // 2 char
  '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '=>', '**',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '<<', '>>', '++', '--', '->', '::',
  // 1 char
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '~', '&', '|', '^',
  '(', ')', '[', ']', '{', '}', ',', ';', '.', '?', ':', '@', '#', '$',
].sort((a, b) => b.length - a.length);

const isIdStart = (c: string): boolean =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdPart = (c: string): boolean => isIdStart(c) || (c >= '0' && c <= '9');
const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isHex = (c: string): boolean =>
  isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
const isSpace = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
const isSuffix = (c: string): boolean => 'fFuUlLiIhH'.indexOf(c) >= 0;

/**
 * Split `src` into a flat list of tokens. The concatenation of every token's
 * `text` is exactly `src` — nothing is dropped, merged, or rewritten.
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const n = src.length;
  let i = 0;

  const push = (type: TokenType, start: number): void => {
    tokens.push({ type, text: src.slice(start, i), start, end: i });
  };

  while (i < n) {
    const c = src[i];
    const start = i;

    // Whitespace run
    if (isSpace(c)) {
      while (i < n && isSpace(src[i])) i++;
      push('ws', start);
      continue;
    }

    // Line comment
    if (c === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      push('comment', start);
      continue;
    }

    // Block comment
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      push('comment', start);
      continue;
    }

    // String / char / template literal (no interpolation parsing)
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      i = Math.min(n, i + 1);
      push('string', start);
      continue;
    }

    // Number (decimal / hex, exponent, type suffixes)
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      i++;
      if (src[start] === '0' && (src[i] === 'x' || src[i] === 'X')) {
        i++;
        while (i < n && isHex(src[i])) i++;
      } else {
        while (i < n && (isDigit(src[i]) || src[i] === '.')) i++;
        if (src[i] === 'e' || src[i] === 'E') {
          i++;
          if (src[i] === '+' || src[i] === '-') i++;
          while (i < n && isDigit(src[i])) i++;
        }
      }
      while (i < n && isSuffix(src[i])) i++;
      push('number', start);
      continue;
    }

    // Identifier / keyword
    if (isIdStart(c)) {
      i++;
      while (i < n && isIdPart(src[i])) i++;
      push('ident', start);
      continue;
    }

    // Operator / punctuation (greedy longest match). An unknown byte falls
    // through as a single-char punct so the loop can never stall.
    let matched: string | null = null;
    for (const op of OPERATORS) {
      if (src.startsWith(op, i)) {
        matched = op;
        break;
      }
    }
    i += matched ? matched.length : 1;
    push('punct', start);
  }

  return tokens;
}

// -- Syntax classification ---------------------------------------------------

export type TokenRole =
  | 'ws'
  | 'comment'
  | 'number'
  | 'string'
  | 'punct'
  | 'keyword'
  | 'function'
  | 'member'
  | 'ident';

export interface HiToken extends Token {
  /** The highlight role this token plays in context. */
  role: TokenRole;
}

export interface LanguageDef {
  /** Display name (informational). */
  name: string;
  /** Reserved words coloured as keywords/types. */
  keywords: ReadonlySet<string>;
  /**
   * Punctuation that turns the following identifier into a `member` access.
   * Defaults to `['.', '->', '::']`.
   */
  memberOps?: readonly string[];
  /**
   * When true (default), an identifier immediately followed by `(` is coloured
   * as a `function` call.
   */
  detectCalls?: boolean;
}

const DEFAULT_MEMBER_OPS = ['.', '->', '::'];

/**
 * Assign a highlight `role` to every token, using neighbouring code tokens for
 * context: `a.x` reads `x` as a member, `f(x)` reads `f` as a call, and any
 * word in the language's keyword set is a keyword. Returns a fresh array; the
 * input tokens are not mutated.
 */
export function classify(tokens: Token[], language: LanguageDef): HiToken[] {
  const keywords = language.keywords;
  const memberOps = language.memberOps ?? DEFAULT_MEMBER_OPS;
  const detectCalls = language.detectCalls ?? true;

  const isCode = (t: Token): boolean => t.type !== 'ws' && t.type !== 'comment';

  // Nearest preceding / following *code* token (skipping ws + comments).
  const prevIdx = new Array<number>(tokens.length).fill(-1);
  const nextIdx = new Array<number>(tokens.length).fill(-1);
  for (let i = 0, last = -1; i < tokens.length; i++) {
    prevIdx[i] = last;
    if (isCode(tokens[i])) last = i;
  }
  for (let i = tokens.length - 1, nxt = -1; i >= 0; i--) {
    nextIdx[i] = nxt;
    if (isCode(tokens[i])) nxt = i;
  }

  const out: HiToken[] = new Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let role: TokenRole;
    switch (t.type) {
      case 'ident': {
        const p = prevIdx[i] >= 0 ? tokens[prevIdx[i]] : null;
        const nx = nextIdx[i] >= 0 ? tokens[nextIdx[i]] : null;
        if (keywords.has(t.text)) role = 'keyword';
        else if (p && p.type === 'punct' && memberOps.indexOf(p.text) >= 0) role = 'member';
        else if (detectCalls && nx && nx.type === 'punct' && nx.text === '(') role = 'function';
        else role = 'ident';
        break;
      }
      case 'number': role = 'number'; break;
      case 'comment': role = 'comment'; break;
      case 'string': role = 'string'; break;
      case 'ws': role = 'ws'; break;
      default: role = 'punct'; break;
    }
    out[i] = { ...t, role };
  }
  return out;
}

// -- Built-in languages ------------------------------------------------------

const set = (words: string): ReadonlySet<string> =>
  new Set(words.trim().split(/\s+/));

const CONTROL = `
  return if else for while do switch case default break continue discard
  struct typedef enum union class namespace template public private protected
  using new delete sizeof true false null nullptr this
`;

const CLIKE_KW = set(`
  ${CONTROL}
  const static inline extern register volatile restrict mutable constexpr
  auto void bool char short int long float double signed unsigned wchar_t
  size_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t
  virtual override final operator friend explicit
`);

const GLSL_KW = set(`
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

const HLSL_KW = set(`
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

const WGSL_KW = set(`
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

const JS_KW = set(`
  var let const function return if else for while do switch case default
  break continue new delete typeof instanceof in of void this super class
  extends static get set yield async await import export from as
  try catch finally throw debugger with true false null undefined NaN Infinity
`);

/** Built-in language presets, keyed by name and common aliases. */
export const LANGUAGES: Record<string, LanguageDef> = {
  clike: { name: 'C-like', keywords: CLIKE_KW },
  c: { name: 'C', keywords: CLIKE_KW },
  cpp: { name: 'C++', keywords: CLIKE_KW },
  'c++': { name: 'C++', keywords: CLIKE_KW },
  glsl: { name: 'GLSL', keywords: GLSL_KW },
  hlsl: { name: 'HLSL', keywords: HLSL_KW },
  wgsl: { name: 'WGSL', keywords: WGSL_KW },
  js: { name: 'JavaScript', keywords: JS_KW },
  javascript: { name: 'JavaScript', keywords: JS_KW },
  ts: { name: 'TypeScript', keywords: JS_KW },
  typescript: { name: 'TypeScript', keywords: JS_KW },
};

/**
 * Resolve a language argument into a `LanguageDef`. Accepts a built-in name
 * (case-insensitive), a custom `LanguageDef`, or `undefined`/unknown (falls
 * back to the generic C-like preset).
 */
export function resolveLanguage(language?: string | LanguageDef): LanguageDef {
  if (!language) return LANGUAGES.clike;
  if (typeof language === 'string') {
    return LANGUAGES[language.toLowerCase()] ?? LANGUAGES.clike;
  }
  return language;
}
