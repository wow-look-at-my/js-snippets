// src/ui/dag-view-math.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/ui/color.ts
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
var TONE_SALT = `${String.fromCharCode(0)}tone`;

// src/ui/hit-test.ts
function distSqToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

// src/ui/dag-view-math.ts
function buildGraph(nodes, edges) {
  const index = /* @__PURE__ */ new Map();
  const kept = [];
  for (const n of nodes) {
    if (index.has(n.id)) continue;
    index.set(n.id, kept.length);
    kept.push(n);
  }
  const out = kept.map(() => []);
  const inc = kept.map(() => []);
  const accepted = [];
  const rejected = [];
  const seen = /* @__PURE__ */ new Set();
  for (const e of edges) {
    const f = index.get(e.from);
    const t = index.get(e.to);
    if (f === void 0) {
      rejected.push({ edge: e, reason: "unknown-from" });
      continue;
    }
    if (t === void 0) {
      rejected.push({ edge: e, reason: "unknown-to" });
      continue;
    }
    if (f === t) {
      rejected.push({ edge: e, reason: "self-loop" });
      continue;
    }
    const key = `${f}>${t}`;
    if (seen.has(key)) {
      rejected.push({ edge: e, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    out[f].push(t);
    inc[t].push(f);
    accepted.push({ from: f, to: t, edge: e });
  }
  return { nodes: kept, edges: accepted, index, out, in: inc, rejected };
}
function breakCycles(graph) {
  const n = graph.nodes.length;
  const reversed = [];
  const reversedSet = /* @__PURE__ */ new Set();
  const edgeAt = /* @__PURE__ */ new Map();
  graph.edges.forEach((e, i) => edgeAt.set(`${e.from}>${e.to}`, i));
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const mark = new Uint8Array(n);
  for (let root = 0; root < n; root++) {
    if (mark[root] !== WHITE) continue;
    const stack = [{ node: root, next: 0 }];
    mark[root] = GREY;
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const succ = graph.out[top.node];
      if (top.next >= succ.length) {
        mark[top.node] = BLACK;
        stack.pop();
        continue;
      }
      const next = succ[top.next++];
      if (mark[next] === GREY) {
        const ei = edgeAt.get(`${top.node}>${next}`);
        if (ei !== void 0 && !reversedSet.has(ei)) {
          reversedSet.add(ei);
          reversed.push(ei);
        }
        continue;
      }
      if (mark[next] === BLACK) continue;
      mark[next] = GREY;
      stack.push({ node: next, next: 0 });
    }
  }
  const out = graph.nodes.map(() => []);
  const inc = graph.nodes.map(() => []);
  graph.edges.forEach((e, i) => {
    const [f, t] = reversedSet.has(i) ? [e.to, e.from] : [e.from, e.to];
    out[f].push(t);
    inc[t].push(f);
  });
  return { reversed, out, in: inc };
}
function assignLayers(graph, acyclic, opts = {}) {
  const n = graph.nodes.length;
  const layers = new Array(n).fill(0);
  const ignoredPins = [];
  const order = topoOrder(acyclic.out, n);
  for (const v of order) {
    let base = 0;
    for (const dep of acyclic.in[v]) base = Math.max(base, layers[dep] + 1);
    const pin = graph.nodes[v].layer;
    if (pin !== void 0 && Number.isFinite(pin)) {
      const wanted = Math.max(0, Math.floor(pin));
      if (wanted >= base) base = wanted;
      else ignoredPins.push(graph.nodes[v].id);
    }
    layers[v] = base;
  }
  let maxLayer = 0;
  for (const l of layers) maxLayer = Math.max(maxLayer, l);
  if (opts.align === "sinks") {
    for (let i = order.length - 1; i >= 0; i--) {
      const v = order[i];
      if (graph.nodes[v].layer !== void 0) continue;
      let limit = maxLayer;
      for (const dependent of acyclic.out[v]) limit = Math.min(limit, layers[dependent] - 1);
      layers[v] = Math.max(layers[v], limit);
    }
  }
  return { layers, maxLayer, ignoredPins };
}
var DEFAULT_MAX_LAYER_WIDTH = 14;
function wrapWideLayers(layout, max = DEFAULT_MAX_LAYER_WIDTH) {
  if (max <= 0) return layout;
  const members = [];
  for (let i = 0; i <= layout.maxLayer; i++) members.push([]);
  layout.layers.forEach((l, v) => members[l].push(v));
  const layers = layout.layers.slice();
  let next = 0;
  let maxLayer = 0;
  for (const row of members) {
    const rows = row.length === 0 ? 1 : Math.ceil(row.length / max);
    const per = row.length === 0 ? 0 : Math.ceil(row.length / rows);
    row.forEach((v, i) => {
      layers[v] = next + Math.floor(i / per);
    });
    maxLayer = Math.max(maxLayer, next + rows - 1);
    next += rows;
  }
  return { layers, maxLayer, ignoredPins: layout.ignoredPins };
}
function topoOrder(out, n) {
  const indeg = new Int32Array(n);
  for (let v = 0; v < n; v++) for (const w of out[v]) indeg[w]++;
  const frontier = [];
  for (let v = 0; v < n; v++) if (indeg[v] === 0) frontier.push(v);
  const order = [];
  const done = new Uint8Array(n);
  while (frontier.length > 0) {
    frontier.sort((a, b) => a - b);
    const v = frontier.shift();
    order.push(v);
    done[v] = 1;
    for (const w of out[v]) {
      if (--indeg[w] === 0) frontier.push(w);
    }
  }
  for (let v = 0; v < n; v++) if (!done[v]) order.push(v);
  return order;
}
function slotIdentity(s) {
  return s.node >= 0 ? `n${s.node}` : `d${s.edge}@${s.layer}`;
}
function insertDummies(graph, acyclic, layout) {
  const layers = [];
  for (let l = 0; l <= layout.maxLayer; l++) layers.push([]);
  graph.nodes.forEach((_, v) => {
    layers[layout.layers[v]].push({ node: v, edge: -1, layer: layout.layers[v] });
  });
  const succ = /* @__PURE__ */ new Map();
  const pred = /* @__PURE__ */ new Map();
  const chains = /* @__PURE__ */ new Map();
  const link = (a, b) => {
    const o = succ.get(a);
    if (o) o.push(b);
    else succ.set(a, [b]);
    const i = pred.get(b);
    if (i) i.push(a);
    else pred.set(b, [a]);
  };
  const reversedSet = new Set(acyclic.reversed);
  graph.edges.forEach((e, ei) => {
    const [f, t] = reversedSet.has(ei) ? [e.to, e.from] : [e.from, e.to];
    const lf = layout.layers[f];
    const lt = layout.layers[t];
    let prev = `n${f}`;
    const chain = [];
    for (let l = lf + 1; l < lt; l++) {
      const slot = { node: -1, edge: ei, layer: l };
      layers[l].push(slot);
      const id = slotIdentity(slot);
      chain.push(id);
      link(prev, id);
      prev = id;
    }
    link(prev, `n${t}`);
    chains.set(ei, chain);
  });
  return { layers, succ, pred, chains };
}
var ORDER_SWEEPS = 16;
function orderLayers(proper, sweeps = ORDER_SWEEPS) {
  const { layers, succ, pred } = proper;
  let best = layers.map((l) => l.slice());
  let bestCrossings = countCrossings(proper);
  const positionsIn = (layer) => {
    const m = /* @__PURE__ */ new Map();
    layers[layer].forEach((s, i) => m.set(slotIdentity(s), i));
    return m;
  };
  for (let s = 0; s < sweeps; s++) {
    const down = s % 2 === 0;
    const range = down ? Array.from({ length: layers.length - 1 }, (_, i) => i + 1) : Array.from({ length: layers.length - 1 }, (_, i) => layers.length - 2 - i);
    for (const l of range) {
      const fixedPos = positionsIn(down ? l - 1 : l + 1);
      const adj = down ? pred : succ;
      const withIdx = layers[l].map((slot, i) => {
        const ps = (adj.get(slotIdentity(slot)) ?? []).map((k) => fixedPos.get(k)).filter((p) => p !== void 0).sort((a, b) => a - b);
        if (ps.length === 0) return { slot, i, m: -1 };
        const mid = ps.length >> 1;
        return { slot, i, m: ps.length % 2 === 1 ? ps[mid] : (ps[mid - 1] + ps[mid]) / 2 };
      });
      withIdx.sort((a, b) => {
        if (a.m < 0 || b.m < 0) return a.i - b.i;
        return a.m !== b.m ? a.m - b.m : a.i - b.i;
      });
      layers[l] = withIdx.map((w) => w.slot);
    }
    transpose(proper);
    const c = countCrossings(proper);
    if (c <= bestCrossings) {
      bestCrossings = c;
      best = layers.map((x) => x.slice());
    }
  }
  for (let l = 0; l < layers.length; l++) layers[l] = best[l];
  return bestCrossings;
}
function transpose(proper) {
  let improved = true;
  let guard = 0;
  while (improved && guard++ < TRANSPOSE_PASS_CAP) {
    improved = false;
    for (let l = 0; l < proper.layers.length; l++) {
      const row = proper.layers[l];
      for (let i = 0; i + 1 < row.length; i++) {
        const before = localCrossings(proper, l);
        const tmp = row[i];
        row[i] = row[i + 1];
        row[i + 1] = tmp;
        if (localCrossings(proper, l) < before) {
          improved = true;
        } else {
          row[i + 1] = row[i];
          row[i] = tmp;
        }
      }
    }
  }
}
var TRANSPOSE_PASS_CAP = 64;
function localCrossings(proper, layer) {
  let c = 0;
  if (layer > 0) c += crossingsBetween(proper, layer - 1);
  if (layer + 1 < proper.layers.length) c += crossingsBetween(proper, layer);
  return c;
}
function countCrossings(proper) {
  let c = 0;
  for (let l = 0; l + 1 < proper.layers.length; l++) c += crossingsBetween(proper, l);
  return c;
}
function crossingsBetween(proper, l) {
  const upper = proper.layers[l];
  const lower = proper.layers[l + 1];
  const lowerPos = /* @__PURE__ */ new Map();
  lower.forEach((s, i) => lowerPos.set(slotIdentity(s), i));
  const pairs = [];
  upper.forEach((s, i) => {
    for (const k of proper.succ.get(slotIdentity(s)) ?? []) {
      const v = lowerPos.get(k);
      if (v !== void 0) pairs.push({ u: i, v });
    }
  });
  let c = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const a = pairs[i];
      const b = pairs[j];
      if ((a.u - b.u) * (a.v - b.v) < 0) c++;
    }
  }
  return c;
}
var DEFAULT_GAP = 24;
var DEFAULT_LAYER_GAP = 56;
var DEFAULT_DUMMY_WIDTH = 12;
var DEFAULT_COORD_PASSES = 12;
var DEFAULT_ROUTE_GAP = 10;
function fitToDesired(desired, gap) {
  const n = desired.length;
  if (n === 0) return [];
  const prefix = new Array(n).fill(0);
  for (let i = 1; i < n; i++) prefix[i] = prefix[i - 1] + (gap[i] ?? 0);
  const target = desired.map((d, i) => d - prefix[i]);
  const blockValues = [];
  const blockCount = [];
  const median = (v) => {
    const m = v.length >> 1;
    return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  for (const t of target) {
    blockValues.push([t]);
    blockCount.push(1);
    while (blockValues.length > 1) {
      const b = blockValues.length - 1;
      if (median(blockValues[b - 1]) <= median(blockValues[b])) break;
      const merged = [];
      let i = 0;
      let j = 0;
      const left = blockValues[b - 1];
      const right = blockValues[b];
      while (i < left.length || j < right.length) {
        if (j >= right.length || i < left.length && left[i] <= right[j]) merged.push(left[i++]);
        else merged.push(right[j++]);
      }
      blockValues.splice(b - 1, 2, merged);
      blockCount.splice(b - 1, 2, blockCount[b - 1] + blockCount[b]);
    }
  }
  const out = new Array(n);
  let at = 0;
  for (let b = 0; b < blockValues.length; b++) {
    const v = median(blockValues[b]);
    for (let k = 0; k < blockCount[b]; k++) out[at + k] = v + prefix[at + k];
    at += blockCount[b];
  }
  return out;
}
function assignCoordinates(proper, sizes, opts = {}) {
  const gap = opts.gap ?? DEFAULT_GAP;
  const routeGap = opts.routeGap ?? DEFAULT_ROUTE_GAP;
  const layerGap = opts.layerGap ?? DEFAULT_LAYER_GAP;
  const dummyW = opts.dummyWidth ?? DEFAULT_DUMMY_WIDTH;
  const passes = opts.passes ?? DEFAULT_COORD_PASSES;
  const rows = proper.layers;
  const cSizeOf = (s) => s.node >= 0 ? sizes[s.node].w : dummyW;
  const lSizeOf = (s) => s.node >= 0 ? sizes[s.node].h : 0;
  const gapBetween = (a, b) => a.node < 0 && b.node < 0 ? routeGap : gap;
  const gapsFor = (row) => row.map((s, i) => i === 0 ? 0 : cSizeOf(row[i - 1]) / 2 + gapBetween(row[i - 1], s) + cSizeOf(s) / 2);
  const layerStart = [];
  const layerThick = [];
  let cursor = 0;
  for (const row of rows) {
    let thick = 0;
    for (const s of row) thick = Math.max(thick, lSizeOf(s));
    layerStart.push(cursor);
    layerThick.push(thick);
    cursor += thick + layerGap;
  }
  const layerExtent = Math.max(0, cursor - layerGap);
  const centers = rows.map((row) => {
    const gaps = gapsFor(row);
    const out = [];
    let x = 0;
    for (let i = 0; i < row.length; i++) {
      x = i === 0 ? cSizeOf(row[0]) / 2 : x + gaps[i];
      out.push(x);
    }
    return out;
  });
  const neighbourMedian = (l, i, up) => {
    const s = rows[l][i];
    const keys = (up ? proper.pred : proper.succ).get(slotIdentity(s)) ?? [];
    if (keys.length === 0) return null;
    const target = up ? l - 1 : l + 1;
    if (target < 0 || target >= rows.length) return null;
    const posByIdentity = /* @__PURE__ */ new Map();
    rows[target].forEach((t, ti) => posByIdentity.set(slotIdentity(t), ti));
    const cs = keys.map((k) => posByIdentity.get(k)).filter((p) => p !== void 0).map((p) => centers[target][p]).sort((a, b) => a - b);
    if (cs.length === 0) return null;
    const m = cs.length >> 1;
    return cs.length % 2 === 1 ? cs[m] : (cs[m - 1] + cs[m]) / 2;
  };
  const separate = (l) => {
    centers[l] = fitToDesired(centers[l], gapsFor(rows[l]));
  };
  const anchored = (s) => {
    const key = slotIdentity(s);
    return (proper.pred.get(key)?.length ?? 0) > 0 || (proper.succ.get(key)?.length ?? 0) > 0;
  };
  const compact = (l) => {
    const row = rows[l];
    for (let i = 1; i < row.length; i++) {
      if (anchored(row[i])) continue;
      const min = centers[l][i - 1] + cSizeOf(row[i - 1]) / 2 + gapBetween(row[i - 1], row[i]) + cSizeOf(row[i]) / 2;
      if (centers[l][i] > min) centers[l][i] = min;
    }
    let first = 0;
    while (first < row.length && !anchored(row[first])) first++;
    if (first === 0 || first >= row.length) return;
    for (let i = first - 1; i >= 0; i--) {
      const max = centers[l][i + 1] - cSizeOf(row[i + 1]) / 2 - gapBetween(row[i], row[i + 1]) - cSizeOf(row[i]) / 2;
      if (centers[l][i] < max) centers[l][i] = max;
    }
  };
  const wireLength = () => {
    let sum = 0;
    rows.forEach((row, l) => {
      if (l + 1 >= rows.length) return;
      const posByIdentity = /* @__PURE__ */ new Map();
      rows[l + 1].forEach((t, ti) => posByIdentity.set(slotIdentity(t), ti));
      row.forEach((s, i) => {
        for (const key of proper.succ.get(slotIdentity(s)) ?? []) {
          const ti = posByIdentity.get(key);
          if (ti !== void 0) sum += Math.abs(centers[l][i] - centers[l + 1][ti]);
        }
      });
    });
    return sum;
  };
  const blockOf = /* @__PURE__ */ new Map();
  const blockMembers = [];
  for (const chain of proper.chains.values()) {
    const dummies = chain.filter((id) => id.startsWith("d"));
    if (dummies.length < 2) continue;
    const b = blockMembers.length;
    blockMembers.push(dummies);
    for (const id of dummies) blockOf.set(id, b);
  }
  const slotAt = /* @__PURE__ */ new Map();
  rows.forEach((row, l) => row.forEach((s, i) => slotAt.set(slotIdentity(s), { l, i })));
  const alignBlocks = (desiredByRow) => {
    for (const members of blockMembers) {
      const wants = [];
      for (const id of members) {
        const at = slotAt.get(id);
        if (at !== void 0) wants.push(desiredByRow[at.l][at.i]);
      }
      if (wants.length === 0) continue;
      wants.sort((a, b) => a - b);
      const m = wants.length >> 1;
      const v = wants.length % 2 === 1 ? wants[m] : (wants[m - 1] + wants[m]) / 2;
      for (const id of members) {
        const at = slotAt.get(id);
        if (at !== void 0) desiredByRow[at.l][at.i] = v;
      }
    }
  };
  let best = centers.map((row) => row.slice());
  let bestScore = wireLength();
  for (let p = 0; p < passes; p++) {
    const up = p % 2 === 0;
    const order = up ? Array.from({ length: rows.length }, (_, i) => i) : Array.from({ length: rows.length }, (_, i) => rows.length - 1 - i);
    const desiredByRow = rows.map(
      (row, l) => row.map((_, i) => neighbourMedian(l, i, up) ?? neighbourMedian(l, i, !up) ?? centers[l][i])
    );
    alignBlocks(desiredByRow);
    for (const l of order) centers[l] = fitToDesired(desiredByRow[l], gapsFor(rows[l]));
    const score = wireLength();
    if (score < bestScore) {
      bestScore = score;
      best = centers.map((row) => row.slice());
    }
  }
  centers.splice(0, centers.length, ...best.map((row) => row.slice()));
  for (let l = 0; l < rows.length; l++) {
    compact(l);
    separate(l);
  }
  let minC = Infinity;
  let maxC = -Infinity;
  rows.forEach((row, l) => {
    row.forEach((s, i) => {
      minC = Math.min(minC, centers[l][i] - cSizeOf(s) / 2);
      maxC = Math.max(maxC, centers[l][i] + cSizeOf(s) / 2);
    });
  });
  if (!Number.isFinite(minC)) {
    minC = 0;
    maxC = 0;
  }
  const placements = rows.map(
    (row, l) => row.map((s, i) => ({
      c: centers[l][i] - minC,
      // A dummy has no thickness, so it sits on the layer's mid-line and the routed polyline bends there.
      l: s.node >= 0 ? layerStart[l] : layerStart[l] + layerThick[l] / 2,
      cSize: cSizeOf(s),
      lSize: lSizeOf(s)
    }))
  );
  return { placements, crossExtent: Math.max(0, maxC - minC), layerExtent };
}
function layoutDag(nodes, edges, opts = {}) {
  const probe = buildGraph(nodes, edges);
  const degree = new Array(probe.nodes.length).fill(0);
  for (const e of probe.edges) {
    degree[e.from]++;
    degree[e.to]++;
  }
  const parts = componentsOf(probe, degree);
  if (parts.wired.length > 1 || parts.loose.length > 0) return layoutBlocks(probe, parts, opts);
  return layoutConnected(nodes, edges, opts);
}
function componentsOf(graph, degree) {
  const near = graph.nodes.map(() => []);
  for (const e of graph.edges) {
    near[e.from].push(e.to);
    near[e.to].push(e.from);
  }
  const seen = new Array(graph.nodes.length).fill(false);
  const wired = [];
  const loose = [];
  for (let v = 0; v < graph.nodes.length; v++) {
    if (seen[v]) continue;
    if (degree[v] === 0 && graph.nodes[v].layer === void 0) {
      seen[v] = true;
      loose.push(v);
      continue;
    }
    const stack = [v];
    const members = [];
    seen[v] = true;
    while (stack.length > 0) {
      const u = stack.pop();
      members.push(u);
      for (const w of near[u]) {
        if (seen[w]) continue;
        seen[w] = true;
        stack.push(w);
      }
    }
    members.sort((a, b) => a - b);
    wired.push(members);
  }
  wired.sort((a, b) => b.length - a.length || a[0] - b[0]);
  return { wired, loose };
}
function translateLayout(layout, dx, dy) {
  return {
    ...layout,
    nodes: layout.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
    edges: layout.edges.map((e) => ({
      ...e,
      points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
    }))
  };
}
function layoutBlocks(probe, parts, opts) {
  const orientation = opts.orientation ?? "TB";
  const sizeOf = opts.sizeOf ?? ((n) => measureNode(n));
  const gap = opts.gap ?? DEFAULT_GAP;
  const layerGap = opts.layerGap ?? DEFAULT_LAYER_GAP;
  const inputEdges = probe.edges.map((e) => e.edge);
  const blocks = parts.wired.map((members) => {
    const keep = new Set(members);
    const sub = members.map((i) => probe.nodes[i]);
    const subEdges = probe.edges.filter((e) => keep.has(e.from) && keep.has(e.to)).map((e) => e.edge);
    return layoutConnected(sub, subEdges, opts);
  });
  const looseNodes = parts.loose.map((i) => probe.nodes[i]);
  const looseSizes = looseNodes.map((n, i) => sizeOf(n, i));
  const looseArea = looseSizes.reduce((s, z) => s + (z.w + gap) * (z.h + gap), 0);
  const graphArea = blocks.reduce((s, b) => s + (b.width + gap) * (b.height + gap), 0);
  const target = Math.max(
    blocks.reduce((m, b) => Math.max(m, b.width), 0),
    Math.sqrt(Math.max(1, graphArea + looseArea) * 1.7)
  );
  const looseBlock = [];
  {
    let cursor = 0;
    let lineStart = 0;
    let lineThick = 0;
    looseNodes.forEach((n, i) => {
      const size = looseSizes[i];
      if (cursor > 0 && cursor + size.w > target) {
        lineStart += lineThick + gap;
        cursor = 0;
        lineThick = 0;
      }
      looseBlock.push({ node: n, index: -1, layer: -1, x: cursor, y: lineStart, w: size.w, h: size.h });
      cursor += size.w + gap;
      lineThick = Math.max(lineThick, size.h);
    });
  }
  const looseW = looseBlock.reduce((m, p) => Math.max(m, p.x + p.w), 0);
  const looseH = looseBlock.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  const shelved = [];
  let x = 0;
  let y = 0;
  let rowThick = 0;
  let width = 0;
  for (const b of blocks) {
    if (x > 0 && x + b.width > target) {
      y += rowThick + layerGap;
      x = 0;
      rowThick = 0;
    }
    shelved.push(translateLayout(b, x, y));
    x += b.width + layerGap;
    width = Math.max(width, x - layerGap);
    rowThick = Math.max(rowThick, b.height);
  }
  const afterWired = blocks.length === 0 ? 0 : y + rowThick;
  const looseY = blocks.length === 0 ? 0 : afterWired + layerGap;
  for (const p of looseBlock) p.y += looseY;
  const allNodes = [...shelved.flatMap((b) => b.nodes), ...looseBlock];
  const byId = /* @__PURE__ */ new Map();
  allNodes.forEach((p, i) => byId.set(p.node.id, i));
  const byEdge = /* @__PURE__ */ new Map();
  inputEdges.forEach((e, i) => byEdge.set(e, i));
  const cycleEdges = [];
  const edges = [];
  let nodeOffset = 0;
  for (const b of shelved) {
    for (const e of b.edges) {
      if (e.reversed) cycleEdges.push(edges.length);
      edges.push({ ...e, index: byEdge.get(e.edge) ?? edges.length, from: e.from + nodeOffset, to: e.to + nodeOffset });
    }
    nodeOffset += b.nodes.length;
  }
  const layoutOut = {
    nodes: allNodes,
    edges,
    byId,
    width: Math.max(width, looseW),
    height: Math.max(afterWired, looseBlock.length === 0 ? 0 : looseY + looseH),
    orientation,
    crossings: shelved.reduce((s, b) => s + b.crossings, 0),
    cycleEdges,
    rejected: probe.rejected,
    ignoredPins: shelved.flatMap((b) => b.ignoredPins)
  };
  return layoutOut;
}
function layoutConnected(nodes, edges, opts = {}) {
  const orientation = opts.orientation ?? "TB";
  const graph = buildGraph(nodes, edges);
  const acyclic = breakCycles(graph);
  const layered = wrapWideLayers(assignLayers(graph, acyclic, opts), opts.maxLayerWidth);
  const proper = insertDummies(graph, acyclic, layered);
  const crossings = orderLayers(proper, opts.sweeps);
  const sizeOf = opts.sizeOf ?? ((n) => measureNode(n));
  const sizes = graph.nodes.map((n, i) => sizeOf(n, i));
  const layoutSizes = orientation === "TB" ? sizes : sizes.map((s) => ({ w: s.h, h: s.w }));
  const coords = assignCoordinates(proper, layoutSizes, opts);
  const placed = new Array(graph.nodes.length);
  const slotPos = /* @__PURE__ */ new Map();
  proper.layers.forEach((row, l) => {
    row.forEach((s, i) => {
      const p = coords.placements[l][i];
      slotPos.set(slotIdentity(s), p);
      if (s.node < 0) return;
      const size = sizes[s.node];
      placed[s.node] = {
        node: graph.nodes[s.node],
        index: s.node,
        layer: l,
        x: orientation === "TB" ? p.c - size.w / 2 : p.l,
        y: orientation === "TB" ? p.l : p.c - size.h / 2,
        w: size.w,
        h: size.h
      };
    });
  });
  const byId = /* @__PURE__ */ new Map();
  placed.forEach((p, i) => byId.set(p.node.id, i));
  const reversedSet = new Set(acyclic.reversed);
  const cycleEdges = [];
  const routed = graph.edges.map((e, ei) => {
    const reversed = reversedSet.has(ei);
    if (reversed) cycleEdges.push(ei);
    const chain = (proper.chains.get(ei) ?? []).map((id) => slotPos.get(id));
    const bends = chain.filter((p) => p !== void 0).map((p) => orientation === "TB" ? { x: p.c, y: p.l } : { x: p.l, y: p.c });
    const a = placed[e.from];
    const b = placed[e.to];
    const start = anchorPoint(a, orientation, reversed ? "in" : "out");
    const end = anchorPoint(b, orientation, reversed ? "out" : "in");
    const mids = reversed ? bends.slice().reverse() : bends;
    return { edge: e.edge, index: ei, from: e.from, to: e.to, points: [start, ...mids, end], reversed };
  });
  return {
    nodes: placed,
    edges: routed,
    byId,
    width: orientation === "TB" ? coords.crossExtent : coords.layerExtent,
    height: orientation === "TB" ? coords.layerExtent : coords.crossExtent,
    orientation,
    crossings,
    cycleEdges,
    rejected: graph.rejected,
    ignoredPins: layered.ignoredPins
  };
}
function anchorPoint(n, orientation, side) {
  if (orientation === "TB") {
    return { x: n.x + n.w / 2, y: side === "out" ? n.y + n.h : n.y };
  }
  return { x: side === "out" ? n.x + n.w : n.x, y: n.y + n.h / 2 };
}
var DEFAULT_NODE_MAX_W = 240;
var DEFAULT_NODE_MIN_W = 72;
function measureNode(node, opts = {}) {
  const charW = opts.charW ?? 6.2;
  const padX = opts.padX ?? 10;
  const padY = opts.padY ?? 7;
  const lineH = opts.lineH ?? 15;
  const subLineH = opts.subLineH ?? 13;
  const maxW = opts.maxW ?? DEFAULT_NODE_MAX_W;
  const minW = opts.minW ?? DEFAULT_NODE_MIN_W;
  const label = node.label ?? node.id;
  const sub = node.sublabel ?? "";
  const textW = Math.max(label.length * charW, sub.length * charW * 0.88);
  const w = Math.max(minW, Math.min(maxW, Math.ceil(textW + padX * 2)));
  const h = padY * 2 + lineH + (sub !== "" ? subLineH : 0);
  return { w, h };
}
var MIN_SCALE = 0.05;
var MAX_SCALE = 4;
var ZOOM_PX_PER_DOUBLE = 260;
function worldToScreen(p, v) {
  return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y };
}
function screenToWorld(p, v) {
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}
function panViewport(v, dx, dy) {
  return { x: v.x + dx, y: v.y + dy, scale: v.scale };
}
function zoomViewportAt(v, anchorX, anchorY, factor, minScale = MIN_SCALE, maxScale = MAX_SCALE) {
  const next = Math.min(maxScale, Math.max(minScale, v.scale * factor));
  if (next === v.scale) return v;
  const w = screenToWorld({ x: anchorX, y: anchorY }, v);
  return { x: anchorX - w.x * next, y: anchorY - w.y * next, scale: next };
}
function zoomFactorForWheel(deltaPx) {
  return Math.pow(2, -deltaPx / ZOOM_PX_PER_DOUBLE);
}
function fitViewport(rect, vw, vh, pad = 24, minScale = MIN_SCALE, maxScale = MAX_SCALE) {
  const availW = Math.max(1, vw - pad * 2);
  const availH = Math.max(1, vh - pad * 2);
  const w = Math.max(1e-6, rect.w);
  const h = Math.max(1e-6, rect.h);
  const scale = Math.min(maxScale, Math.max(minScale, Math.min(availW / w, availH / h)));
  return {
    x: (vw - rect.w * scale) / 2 - rect.x * scale,
    y: (vh - rect.h * scale) / 2 - rect.y * scale,
    scale
  };
}
function layoutBounds(layout) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of layout.nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  for (const e of layout.edges) {
    for (const p of e.points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function clampViewport(v, bounds, vw, vh, margin = 60) {
  const w = bounds.w * v.scale;
  const h = bounds.h * v.scale;
  const left = bounds.x * v.scale + v.x;
  const top = bounds.y * v.scale + v.y;
  const minLeft = margin - w;
  const maxLeft = vw - margin;
  const minTop = margin - h;
  const maxTop = vh - margin;
  const nx = v.x + (Math.min(maxLeft, Math.max(minLeft, left)) - left);
  const ny = v.y + (Math.min(maxTop, Math.max(minTop, top)) - top);
  return { x: nx, y: ny, scale: v.scale };
}
function visibleWorldRect(v, vw, vh) {
  const a = screenToWorld({ x: 0, y: 0 }, v);
  const b = screenToWorld({ x: vw, y: vh }, v);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}
function rectsOverlap(a, b) {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}
function visibleNodes(layout, view) {
  const out = [];
  layout.nodes.forEach((n, i) => {
    if (rectsOverlap({ x: n.x, y: n.y, w: n.w, h: n.h }, view)) out.push(i);
  });
  return out;
}
function visibleEdges(layout, view) {
  const out = [];
  layout.edges.forEach((e, i) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of e.points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    if (rectsOverlap({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, view)) out.push(i);
  });
  return out;
}
function hitTestNodes(layout, wx, wy) {
  for (let i = layout.nodes.length - 1; i >= 0; i--) {
    const n = layout.nodes[i];
    if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return i;
  }
  return -1;
}
function hitTestEdges(layout, wx, wy, tol) {
  let best = -1;
  let bestD = tol * tol;
  layout.edges.forEach((e, i) => {
    for (let k = 1; k < e.points.length; k++) {
      const d = distSqToSegment(wx, wy, e.points[k - 1].x, e.points[k - 1].y, e.points[k].x, e.points[k].y);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
  });
  return best;
}
function nodeRect(n) {
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}
function neighbourhood(layout, index) {
  const n = layout.nodes.length;
  const outAdj = Array.from({ length: n }, () => []);
  const inAdj = Array.from({ length: n }, () => []);
  const edgeOut = Array.from({ length: n }, () => []);
  const edgeIn = Array.from({ length: n }, () => []);
  layout.edges.forEach((e, i) => {
    outAdj[e.from].push(e.to);
    inAdj[e.to].push(e.from);
    edgeOut[e.from].push(i);
    edgeIn[e.to].push(i);
  });
  const walk = (start, adj, edgeAdj, edges2) => {
    const seen = /* @__PURE__ */ new Set();
    const stack = [start];
    while (stack.length > 0) {
      const v = stack.pop();
      adj[v].forEach((w, k) => {
        edges2.add(edgeAdj[v][k]);
        if (seen.has(w) || w === start) return;
        seen.add(w);
        stack.push(w);
      });
    }
    return seen;
  };
  const edges = /* @__PURE__ */ new Set();
  const ancestors = walk(index, inAdj, edgeIn, edges);
  const descendants = walk(index, outAdj, edgeOut, edges);
  return { ancestors, descendants, edges };
}
function criticalPathLength(layout) {
  let max = 0;
  for (const n of layout.nodes) max = Math.max(max, n.layer < 0 ? 1 : n.layer + 1);
  return max;
}
function nodeHue(node) {
  const key = node.category ?? node.id;
  return Math.floor(hashString(key) * 0.61803398875 % 1 * 360);
}

// src/ui/dag-view-math.test.ts
var CHAIN_NODES = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
var CHAIN_EDGES = [
  { from: "a", to: "b" },
  { from: "b", to: "c" },
  { from: "c", to: "d" },
  { from: "a", to: "d" }
];
function ids(nodes) {
  return nodes.map((n) => n.id);
}
function nodesFrom(names) {
  return names.map((id) => ({ id }));
}
function layerMap(layout) {
  const out = {};
  for (const n of layout.nodes) out[n.node.id] = n.layer;
  return out;
}
test("buildGraph: indexes nodes and both adjacency directions", () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  assert.equal(g.nodes.length, 4);
  assert.equal(g.edges.length, 4);
  assert.equal(g.index.get("c"), 2);
  assert.deepEqual(g.out[0], [1, 3], "a points at b and d");
  assert.deepEqual(g.in[3], [2, 0], "d is pointed at by c and a");
  assert.deepEqual(g.rejected, []);
});
test("buildGraph: a repeated node id keeps its first occurrence", () => {
  const g = buildGraph([{ id: "a", label: "first" }, { id: "a", label: "second" }], []);
  assert.equal(g.nodes.length, 1);
  assert.equal(g.nodes[0].label, "first");
});
test("buildGraph: every unusable edge is REPORTED, never silently dropped", () => {
  const g = buildGraph(nodesFrom(["a", "b"]), [
    { from: "a", to: "b" },
    { from: "ghost", to: "b" },
    { from: "a", to: "ghost" },
    { from: "a", to: "a" },
    { from: "a", to: "b" }
  ]);
  assert.equal(g.edges.length, 1, "only the one real edge is drawn");
  assert.deepEqual(
    g.rejected.map((r) => r.reason),
    ["unknown-from", "unknown-to", "self-loop", "duplicate"]
  );
  assert.deepEqual(g.rejected[0].edge, { from: "ghost", to: "b" });
});
test("buildGraph: a duplicate is judged on endpoints, not on its label", () => {
  const g = buildGraph(nodesFrom(["a", "b"]), [
    { from: "a", to: "b", label: "needs" },
    { from: "a", to: "b", label: "also needs" }
  ]);
  assert.equal(g.edges.length, 1);
  assert.equal(g.rejected.length, 1);
  assert.equal(g.rejected[0].reason, "duplicate");
});
function hasCycle(out) {
  const n = out.length;
  const mark = new Uint8Array(n);
  const onStack = new Uint8Array(n);
  const visit = (v) => {
    mark[v] = 1;
    onStack[v] = 1;
    for (const w of out[v]) {
      if (onStack[w]) return true;
      if (!mark[w] && visit(w)) return true;
    }
    onStack[v] = 0;
    return false;
  };
  for (let v = 0; v < n; v++) if (!mark[v] && visit(v)) return true;
  return false;
}
test("breakCycles: an acyclic graph is left completely alone", () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const c = breakCycles(g);
  assert.deepEqual(c.reversed, []);
  assert.deepEqual(c.out, g.out);
  assert.deepEqual(c.in, g.in);
});
test("breakCycles: a cycle is broken, and the cut edge is NAMED", () => {
  const g = buildGraph(nodesFrom(["a", "b", "c"]), [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "a" }
  ]);
  const c = breakCycles(g);
  assert.equal(c.reversed.length, 1, "one cut is enough for a 3-cycle");
  assert.equal(hasCycle(c.out), false);
  const cut = g.edges[c.reversed[0]];
  assert.deepEqual({ from: cut.edge.from, to: cut.edge.to }, { from: "c", to: "a" });
});
test("breakCycles: two independent cycles each get cut", () => {
  const g = buildGraph(nodesFrom(["a", "b", "x", "y"]), [
    { from: "a", to: "b" },
    { from: "b", to: "a" },
    { from: "x", to: "y" },
    { from: "y", to: "x" }
  ]);
  const c = breakCycles(g);
  assert.equal(c.reversed.length, 2);
  assert.equal(hasCycle(c.out), false);
});
test("breakCycles: a long chain does not overflow the stack", () => {
  const n = 2e4;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
  const c = breakCycles(buildGraph(nodes, edges));
  assert.deepEqual(c.reversed, []);
});
test("topoOrder: every edge points forward in the order", () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const order = topoOrder(g.out, g.nodes.length);
  const pos = new Map(order.map((v, i) => [v, i]));
  for (const e of g.edges) {
    assert.ok(pos.get(e.from) < pos.get(e.to), `${e.edge.from} before ${e.edge.to}`);
  }
});
test("topoOrder: ties break on index, so the order is identical every run", () => {
  const g = buildGraph(nodesFrom(["c", "a", "b"]), []);
  assert.deepEqual(topoOrder(g.out, 3), [0, 1, 2]);
});
test("topoOrder: a node inside a cycle is appended, never lost", () => {
  const out = [[1], [0], []];
  const order = topoOrder(out, 3);
  assert.equal(order.length, 3);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2]);
});
test("assignLayers: a node sits one past the deepest thing it needs", () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const l = assignLayers(g, breakCycles(g));
  assert.deepEqual([...l.layers], [0, 1, 2, 3]);
  assert.equal(l.maxLayer, 3);
});
test("assignLayers: independent roots all start at layer 0", () => {
  const g = buildGraph(nodesFrom(["a", "b", "c"]), [{ from: "a", to: "c" }, { from: "b", to: "c" }]);
  const l = assignLayers(g, breakCycles(g));
  assert.deepEqual([...l.layers], [0, 0, 1]);
});
test("assignLayers: a layer pin can push a node down", () => {
  const g = buildGraph([{ id: "a" }, { id: "b", layer: 4 }], [{ from: "a", to: "b" }]);
  const l = assignLayers(g, breakCycles(g));
  assert.deepEqual([...l.layers], [0, 4]);
  assert.deepEqual(l.ignoredPins, []);
});
test("assignLayers: a pin that contradicts an edge is overruled AND reported", () => {
  const g = buildGraph([{ id: "a" }, { id: "b", layer: 0 }], [{ from: "a", to: "b" }]);
  const l = assignLayers(g, breakCycles(g));
  assert.deepEqual([...l.layers], [0, 1]);
  assert.deepEqual(l.ignoredPins, ["b"]);
});
test("assignLayers: align 'sinks' bottom-aligns the leaves", () => {
  const g = buildGraph(nodesFrom(["a", "b", "c", "d"]), [
    { from: "a", to: "b" },
    { from: "b", to: "d" },
    { from: "a", to: "c" }
  ]);
  const acyclic = breakCycles(g);
  assert.deepEqual([...assignLayers(g, acyclic).layers], [0, 1, 1, 2]);
  assert.deepEqual([...assignLayers(g, acyclic, { align: "sinks" }).layers], [0, 1, 2, 2]);
});
test("assignLayers: every edge still points strictly downward after cycle breaking", () => {
  const g = buildGraph(nodesFrom(["a", "b", "c"]), [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "a" }
  ]);
  const acyclic = breakCycles(g);
  const l = assignLayers(g, acyclic);
  acyclic.out.forEach((succ, v) => {
    for (const w of succ) assert.ok(l.layers[w] > l.layers[v], "no edge is flat or backwards");
  });
});
test("wrapWideLayers: a layer too wide to read is split into consecutive rows", () => {
  const g = buildGraph(nodesFrom(Array.from({ length: 30 }, (_, i) => `n${i}`)), []);
  const wrapped = wrapWideLayers(assignLayers(g, breakCycles(g)), 14);
  const counts = /* @__PURE__ */ new Map();
  for (const l of wrapped.layers) counts.set(l, (counts.get(l) ?? 0) + 1);
  assert.equal(counts.size, 3, "30 nodes at a cap of 14 need three rows");
  for (const [layer, n] of counts) assert.ok(n <= 14, `layer ${layer} holds ${n}`);
  assert.deepEqual([...counts.values()], [10, 10, 10]);
  assert.equal(wrapped.maxLayer, 2);
});
test("wrapWideLayers: splitting a layer keeps every edge pointing forward", () => {
  const names = Array.from({ length: 40 }, (_, i) => `n${i}`);
  const edges = [];
  for (let i = 0; i < 20; i++) edges.push({ from: `n${i}`, to: `n${i + 20}` });
  const g = buildGraph(nodesFrom(names), edges);
  const acyclic = breakCycles(g);
  const wrapped = wrapWideLayers(assignLayers(g, acyclic), 6);
  acyclic.out.forEach((succ, v) => {
    for (const w of succ) {
      assert.ok(wrapped.layers[w] > wrapped.layers[v], `n${v} -> n${w} still points down`);
    }
  });
});
test("wrapWideLayers: a cap of 0 leaves the layering exactly as it was", () => {
  const g = buildGraph(nodesFrom(Array.from({ length: 30 }, (_, i) => `n${i}`)), []);
  const before = assignLayers(g, breakCycles(g));
  assert.deepEqual([...wrapWideLayers(before, 0).layers], [...before.layers]);
});
test("layoutDag: a fleet of mostly-unconnected nodes does not draw as one long line", () => {
  const nodes = nodesFrom(Array.from({ length: 118 }, (_, i) => `r${i}`));
  const edges = [];
  for (let i = 0; i < 45 && edges.length < 53; i++) {
    for (const t of [i + 3, i + 7]) {
      if (t < 45 && edges.length < 53) edges.push({ from: `r${i}`, to: `r${t}` });
    }
  }
  const layout = layoutDag(nodes, edges);
  assert.ok(
    layout.width / layout.height < 4,
    `aspect ${(layout.width / layout.height).toFixed(1)} is still unreadable`
  );
  assert.equal(layout.nodes.length, 118, "no node is lost");
  assert.ok(layout.width > 0 && layout.height > 0);
});
test("wrapWideLayers: a layer too wide to read is broken into rows", () => {
  const fan = nodesFrom(["root", ...Array.from({ length: 90 }, (_, i) => `leaf${i}`)]);
  const fanEdges = Array.from({ length: 90 }, (_, i) => ({ from: "root", to: `leaf${i}` }));
  const g = buildGraph(fan, fanEdges);
  const before = assignLayers(g, breakCycles(g));
  const after = wrapWideLayers(before, 14);
  const count = (layers) => {
    const m = /* @__PURE__ */ new Map();
    for (const l of layers) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  assert.equal(Math.max(...count(before.layers).values()), 90, "the control really is one wide layer");
  assert.ok(Math.max(...count(after.layers).values()) <= 14, "no row is left over the limit");
  assert.equal(after.layers.length, 91, "wrapping never loses a node");
});
test("fitToDesired: desires that already fit are left exactly alone", () => {
  const got = fitToDesired([0, 50, 100], [0, 30, 30]);
  assert.deepEqual(got, [0, 50, 100]);
});
test("fitToDesired: a collision settles on the median, never by pushing right", () => {
  const got = fitToDesired([100, 100, 100], [0, 10, 10]);
  assert.deepEqual(got, [90, 100, 110], "the block centres on what its members wanted");
  const span = got[got.length - 1] - got[0];
  assert.equal(span, 20, "the row is exactly as wide as the gaps demand");
});
test("fitToDesired: the order and the minimum gaps always hold", () => {
  const desired = [500, 10, 480, 20, 300];
  const gaps = [0, 40, 40, 40, 40];
  const got = fitToDesired(desired, gaps);
  for (let i = 1; i < got.length; i++) {
    assert.ok(got[i] - got[i - 1] >= gaps[i] - 1e-9, `slot ${i} keeps its gap`);
  }
});
test("fitToDesired: it beats pull-then-shove on the total distance from the desires", () => {
  const desired = [100, 100, 100, 100];
  const gaps = [0, 30, 30, 30];
  const shove = [];
  for (let i = 0; i < desired.length; i++) {
    shove.push(i === 0 ? desired[i] : Math.max(desired[i], shove[i - 1] + gaps[i]));
  }
  const cost = (xs) => xs.reduce((s, x, i) => s + Math.abs(x - desired[i]), 0);
  assert.ok(cost(fitToDesired(desired, gaps)) < cost(shove), "the projection is closer to what was asked for");
});
test("layoutDag: an edgeless node is packed into the block, not left floating", () => {
  const names = ["dep", "user", ...Array.from({ length: 8 }, (_, i) => `lone${i}`)];
  const layout = layoutDag(nodesFrom(names), [{ from: "dep", to: "user" }]);
  const block = layout.nodes.filter((n) => n.layer < 0);
  assert.equal(block.length, 8, "every edgeless node is in the block");
  const rows = /* @__PURE__ */ new Map();
  for (const n of block) rows.set(n.y, [...rows.get(n.y) ?? [], n]);
  for (const row of rows.values()) {
    const line = [...row].sort((a, b) => a.x - b.x);
    for (let i = 1; i < line.length; i++) {
      const gap = line[i].x - (line[i - 1].x + line[i - 1].w);
      assert.ok(
        gap <= DEFAULT_GAP + 1e-6,
        `${line[i].node.id} sits ${gap.toFixed(0)} from ${line[i - 1].node.id}, over the ${DEFAULT_GAP} gap`
      );
    }
  }
  const wired = layout.nodes.filter((n) => n.layer >= 0);
  const lowest = Math.max(...wired.map((n) => n.y + n.h));
  assert.ok(Math.min(...block.map((n) => n.y)) >= lowest, "the block clears the drawing");
});
test("insertDummies: a long edge gets one bend point per layer it crosses", () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const acyclic = breakCycles(g);
  const layered = assignLayers(g, acyclic);
  const proper = insertDummies(g, acyclic, layered);
  const longEdge = g.edges.findIndex((e) => e.edge.from === "a" && e.edge.to === "d");
  assert.equal((proper.chains.get(longEdge) ?? []).length, 2);
  const shortEdge = g.edges.findIndex((e) => e.edge.from === "a" && e.edge.to === "b");
  assert.deepEqual(proper.chains.get(shortEdge), []);
});
test("insertDummies: every layer link spans exactly one layer", () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const acyclic = breakCycles(g);
  const layered = assignLayers(g, acyclic);
  const proper = insertDummies(g, acyclic, layered);
  const layerOf = /* @__PURE__ */ new Map();
  proper.layers.forEach((row, l) => row.forEach((s) => layerOf.set(slotIdentity(s), l)));
  for (const [from, tos] of proper.succ) {
    for (const to of tos) {
      assert.equal(
        layerOf.get(to) - layerOf.get(from),
        1,
        `${from} -> ${to} spans one layer`
      );
    }
  }
});
test("insertDummies: slot identity survives reordering its layer", () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  const row = proper.layers[1];
  const before = row.map(slotIdentity);
  row.reverse();
  assert.deepEqual(row.map(slotIdentity), [...before].reverse());
  assert.ok(proper.succ.has(before[0]) || proper.pred.has(before[0]));
});
test("crossingsBetween: the textbook single crossing", () => {
  const g = buildGraph(nodesFrom(["a", "b", "x", "y"]), [
    { from: "a", to: "y" },
    { from: "b", to: "x" }
  ]);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  proper.layers[0] = [
    { node: 0, edge: -1, layer: 0 },
    { node: 1, edge: -1, layer: 0 }
  ];
  proper.layers[1] = [
    { node: 2, edge: -1, layer: 1 },
    { node: 3, edge: -1, layer: 1 }
  ];
  assert.equal(crossingsBetween(proper, 0), 1);
  proper.layers[1].reverse();
  assert.equal(crossingsBetween(proper, 0), 0);
});
test("countCrossings: parallel edges never cross", () => {
  const g = buildGraph(nodesFrom(["a", "b", "x", "y"]), [
    { from: "a", to: "x" },
    { from: "b", to: "y" }
  ]);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  assert.equal(countCrossings(proper), 0);
});
test("orderLayers: never returns a worse arrangement than it started with", () => {
  const names = Array.from({ length: 8 }, (_, i) => `u${i}`).concat(
    Array.from({ length: 8 }, (_, i) => `d${i}`)
  );
  const edges = [];
  for (let i = 0; i < 8; i++) edges.push({ from: `u${i}`, to: `d${i * 5 % 8}` });
  const g = buildGraph(nodesFrom(names), edges);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  const before = countCrossings(proper);
  const after = orderLayers(proper);
  assert.ok(after <= before, `${after} <= ${before}`);
  assert.equal(after, countCrossings(proper), "the reported count matches the arrangement it left behind");
});
test("orderLayers: identical input gives an identical arrangement", () => {
  const build = () => {
    const names = ["a", "b", "c", "d", "e", "f"];
    const g = buildGraph(nodesFrom(names), [
      { from: "a", to: "e" },
      { from: "b", to: "d" },
      { from: "c", to: "f" },
      { from: "a", to: "f" }
    ]);
    const acyclic = breakCycles(g);
    const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
    orderLayers(proper);
    return proper.layers.map((row) => row.map((s) => s.node));
  };
  assert.deepEqual(build(), build());
});
test("assignCoordinates: boxes in a layer never overlap", () => {
  const names = ["r", "a", "b", "c", "d"];
  const g = buildGraph(nodesFrom(names), names.slice(1).map((id) => ({ from: "r", to: id })));
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  orderLayers(proper);
  const sizes = g.nodes.map((_, i) => ({ w: 40 + i * 20, h: 30 }));
  const coords = assignCoordinates(proper, sizes);
  for (const row of coords.placements) {
    const sorted = [...row].sort((x, y) => x.c - y.c);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].c - sorted[i].cSize / 2 - (sorted[i - 1].c + sorted[i - 1].cSize / 2);
      assert.ok(gap >= DEFAULT_GAP - 1e-6, `gap ${gap} >= ${DEFAULT_GAP}`);
    }
  }
});
test("assignCoordinates: a straight chain draws as a straight line", () => {
  const g = buildGraph(CHAIN_NODES.slice(0, 3), [
    { from: "a", to: "b" },
    { from: "b", to: "c" }
  ]);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  orderLayers(proper);
  const coords = assignCoordinates(proper, g.nodes.map(() => ({ w: 100, h: 30 })));
  const centers = coords.placements.map((row) => row[0].c);
  assert.equal(centers.length, 3);
  for (const c of centers) assert.ok(Math.abs(c - centers[0]) < 1e-6, "every node shares one center");
});
test("assignCoordinates: layers are stacked, and the drawing starts at 0", () => {
  const g = buildGraph(CHAIN_NODES, CHAIN_EDGES);
  const acyclic = breakCycles(g);
  const proper = insertDummies(g, acyclic, assignLayers(g, acyclic));
  orderLayers(proper);
  const coords = assignCoordinates(proper, g.nodes.map(() => ({ w: 80, h: 30 })), { layerGap: 40 });
  const nodeRows = coords.placements.map((row, l) => ({ l, row }));
  for (let i = 1; i < nodeRows.length; i++) {
    const prev = Math.max(...nodeRows[i - 1].row.map((p) => p.l + p.lSize));
    const next = Math.min(...nodeRows[i].row.map((p) => p.l));
    assert.ok(next >= prev, "no layer reaches back into the one above it");
  }
  const minC = Math.min(...coords.placements.flat().map((p) => p.c - p.cSize / 2));
  assert.ok(Math.abs(minC) < 1e-6, "left edge is 0");
});
test("layoutDag: every edge points down the page", () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  for (const e of layout.edges) {
    const from = layout.nodes[e.from];
    const to = layout.nodes[e.to];
    assert.ok(to.layer > from.layer, `${e.edge.from} -> ${e.edge.to} goes downward`);
  }
});
test("layoutDag: the same input produces byte-identical geometry", () => {
  const a = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const b = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  assert.deepEqual(
    a.nodes.map((n) => [n.node.id, n.x, n.y, n.w, n.h]),
    b.nodes.map((n) => [n.node.id, n.x, n.y, n.w, n.h])
  );
  assert.deepEqual(a.edges.map((e) => e.points), b.edges.map((e) => e.points));
});
test("layoutDag: an empty graph is a valid, empty layout", () => {
  const layout = layoutDag([], []);
  assert.deepEqual(ids(layout.nodes.map((n) => n.node)), []);
  assert.deepEqual([...layout.edges], []);
  assert.equal(layout.width, 0);
  assert.deepEqual(layoutBounds(layout), { x: 0, y: 0, w: 0, h: 0 });
});
test("layoutDag: a graph with no edges at all still lays out", () => {
  const layout = layoutDag(nodesFrom(["a", "b", "c"]), []);
  assert.equal(layout.nodes.length, 3);
  assert.deepEqual(Object.values(layerMap(layout)), [-1, -1, -1]);
  assert.equal(layout.crossings, 0);
  assert.ok(layout.width > 0 && layout.height > 0, "the block still occupies the drawing");
});
test("layoutDag: disconnected components all get placed", () => {
  const layout = layoutDag(nodesFrom(["a", "b", "x", "y"]), [
    { from: "a", to: "b" },
    { from: "x", to: "y" }
  ]);
  assert.equal(layout.nodes.length, 4);
  assert.deepEqual(layerMap(layout), { a: 0, b: 1, x: 0, y: 1 });
});
test("layoutDag: a long edge gets bend points, a short one does not", () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const long = layout.edges.find((e) => e.edge.from === "a" && e.edge.to === "d");
  const short = layout.edges.find((e) => e.edge.from === "a" && e.edge.to === "b");
  assert.ok(long !== void 0 && short !== void 0);
  assert.equal(short.points.length, 2, "a one-layer edge is a straight segment");
  assert.equal(long.points.length, 4, "a three-layer edge bends twice");
});
test("layoutDag: an edge meets the faces of its boxes, not their centers", () => {
  const layout = layoutDag(CHAIN_NODES.slice(0, 2), [{ from: "a", to: "b" }]);
  const e = layout.edges[0];
  const a = layout.nodes[e.from];
  const b = layout.nodes[e.to];
  assert.equal(e.points[0].y, a.y + a.h, "leaves the bottom face");
  assert.equal(e.points[e.points.length - 1].y, b.y, "arrives at the top face");
});
test("layoutDag: 'LR' swaps the axes and keeps the direction", () => {
  const tb = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const lr = layoutDag(CHAIN_NODES, CHAIN_EDGES, { orientation: "LR" });
  assert.equal(lr.orientation, "LR");
  assert.ok(tb.height > tb.width || tb.nodes.length === 0);
  assert.ok(lr.width > lr.height);
  for (const e of lr.edges) {
    const from = lr.nodes[e.from];
    const to = lr.nodes[e.to];
    assert.ok(to.x > from.x, "edges run left to right");
  }
  const e0 = lr.edges[0];
  const a = lr.nodes[e0.from];
  assert.equal(e0.points[0].x, a.x + a.w, "leaves the right face");
});
test("layoutDag: a cycle is drawn AND reported, never quietly straightened", () => {
  const layout = layoutDag(nodesFrom(["a", "b", "c"]), [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "a" }
  ]);
  assert.equal(layout.edges.length, 3, "the cycle edge is still drawn");
  assert.equal(layout.cycleEdges.length, 1);
  const cut = layout.edges[layout.cycleEdges[0]];
  assert.equal(cut.reversed, true);
  assert.deepEqual({ from: cut.edge.from, to: cut.edge.to }, { from: "c", to: "a" });
});
test("layoutDag: a reversed edge is still routed from its TRUE source", () => {
  const layout = layoutDag(nodesFrom(["a", "b"]), [
    { from: "a", to: "b" },
    { from: "b", to: "a" }
  ]);
  const back = layout.edges.find((e) => e.edge.from === "b" && e.edge.to === "a");
  assert.ok(back !== void 0);
  assert.equal(back.reversed, true);
  const b = layout.nodes[layout.byId.get("b")];
  const a = layout.nodes[layout.byId.get("a")];
  assert.equal(back.points[0].y, b.y, "leaves b upward");
  assert.equal(back.points[back.points.length - 1].y, a.y + a.h, "arrives under a");
});
test("layoutDag: rejected edges and overruled pins reach the caller", () => {
  const layout = layoutDag([{ id: "a" }, { id: "b", layer: 0 }], [
    { from: "a", to: "b" },
    { from: "a", to: "nope" }
  ]);
  assert.deepEqual(layout.rejected.map((r) => r.reason), ["unknown-to"]);
  assert.deepEqual(layout.ignoredPins, ["b"]);
});
test("layoutDag: byId resolves every node", () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  for (const n of layout.nodes) {
    assert.equal(layout.byId.get(n.node.id), layout.nodes.indexOf(n));
  }
});
test("layoutDag: a custom sizeOf drives the geometry", () => {
  const layout = layoutDag(nodesFrom(["a", "b"]), [{ from: "a", to: "b" }], {
    sizeOf: () => ({ w: 200, h: 50 })
  });
  for (const n of layout.nodes) assert.deepEqual([n.w, n.h], [200, 50]);
});
test("layoutDag: no two boxes on the same layer overlap", () => {
  const names = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const edges = [];
  for (let i = 1; i < 12; i++) edges.push({ from: `n${Math.floor((i - 1) / 3)}`, to: `n${i}` });
  const layout = layoutDag(nodesFrom(names), edges);
  const byLayer = /* @__PURE__ */ new Map();
  for (const n of layout.nodes) {
    const row = byLayer.get(n.layer) ?? [];
    row.push(n);
    byLayer.set(n.layer, row);
  }
  for (const row of byLayer.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      assert.ok(row[i].x >= row[i - 1].x + row[i - 1].w, `${row[i].node.id} clears ${row[i - 1].node.id}`);
    }
  }
});
test("criticalPathLength: the longest dependency chain, in nodes", () => {
  assert.equal(criticalPathLength(layoutDag(CHAIN_NODES, CHAIN_EDGES)), 4);
  assert.equal(criticalPathLength(layoutDag(nodesFrom(["a", "b"]), [])), 1);
  assert.equal(criticalPathLength(layoutDag([], [])), 0);
});
test("anchorPoint: the mid-point of the facing edge, per orientation", () => {
  const n = { node: { id: "a" }, index: 0, layer: 0, x: 10, y: 20, w: 100, h: 40 };
  assert.deepEqual(anchorPoint(n, "TB", "out"), { x: 60, y: 60 });
  assert.deepEqual(anchorPoint(n, "TB", "in"), { x: 60, y: 20 });
  assert.deepEqual(anchorPoint(n, "LR", "out"), { x: 110, y: 40 });
  assert.deepEqual(anchorPoint(n, "LR", "in"), { x: 10, y: 40 });
});
test("measureNode: width tracks the longer of label and sublabel", () => {
  const short = measureNode({ id: "a", label: "hi" });
  const long = measureNode({ id: "a", label: "hi", sublabel: "a much longer second line here" });
  assert.ok(long.w > short.w);
  assert.ok(long.h > short.h, "the sublabel earns its own line");
});
test("measureNode: one enormous title cannot set the whole layout", () => {
  const huge = measureNode({ id: "a", label: "x".repeat(500) });
  assert.equal(huge.w, DEFAULT_NODE_MAX_W);
});
test("measureNode: a one-character node is still a clickable target", () => {
  assert.equal(measureNode({ id: "x" }).w, DEFAULT_NODE_MIN_W);
});
test("measureNode: the id stands in for a missing label", () => {
  assert.deepEqual(measureNode({ id: "some-identifier" }), measureNode({ id: "q", label: "some-identifier" }));
});
var V = { x: 30, y: -20, scale: 2 };
test("worldToScreen / screenToWorld are inverses", () => {
  const p = { x: 12.5, y: -7.25 };
  const back = screenToWorld(worldToScreen(p, V), V);
  assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
});
test("panViewport: shifts in screen space and leaves the scale alone", () => {
  assert.deepEqual(panViewport(V, 10, -5), { x: 40, y: -25, scale: 2 });
});
test("zoomViewportAt: the world point under the anchor does not move", () => {
  for (const factor of [0.5, 1.37, 2, 0.13]) {
    const before = screenToWorld({ x: 200, y: 140 }, V);
    const next = zoomViewportAt(V, 200, 140, factor);
    const after = screenToWorld({ x: 200, y: 140 }, next);
    assert.ok(Math.abs(after.x - before.x) < 1e-6, `x held at factor ${factor}`);
    assert.ok(Math.abs(after.y - before.y) < 1e-6, `y held at factor ${factor}`);
  }
});
test("zoomViewportAt: clamps, and a clamped zoom is a no-op rather than a drift", () => {
  const maxed = zoomViewportAt({ x: 0, y: 0, scale: MAX_SCALE }, 50, 50, 4);
  assert.equal(maxed.scale, MAX_SCALE);
  assert.deepEqual(maxed, { x: 0, y: 0, scale: MAX_SCALE }, "no pan sneaks in at the clamp");
  assert.equal(zoomViewportAt({ x: 0, y: 0, scale: MIN_SCALE }, 50, 50, 0.1).scale, MIN_SCALE);
});
test("zoomFactorForWheel: scroll up zooms in, and the rate is a clean doubling", () => {
  assert.ok(zoomFactorForWheel(-260) > 1);
  assert.ok(zoomFactorForWheel(260) < 1);
  assert.ok(Math.abs(zoomFactorForWheel(-260) - 2) < 1e-9);
  assert.equal(zoomFactorForWheel(0), 1);
});
test("fitViewport: centers the rect in the box", () => {
  const v = fitViewport({ x: 0, y: 0, w: 100, h: 100 }, 400, 200, 20);
  assert.equal(v.scale, 1.6, "the tighter axis wins");
  const tl = worldToScreen({ x: 0, y: 0 }, v);
  const br = worldToScreen({ x: 100, y: 100 }, v);
  assert.ok(Math.abs((tl.x + br.x) / 2 - 200) < 1e-6, "horizontally centered");
  assert.ok(Math.abs((tl.y + br.y) / 2 - 100) < 1e-6, "vertically centered");
});
test("fitViewport: a degenerate rect still yields a usable viewport", () => {
  const v = fitViewport({ x: 0, y: 0, w: 0, h: 0 }, 400, 300);
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
  assert.ok(v.scale > 0 && v.scale <= MAX_SCALE);
});
test("fitViewport: obeys the scale clamps on a huge graph", () => {
  const v = fitViewport({ x: 0, y: 0, w: 1e5, h: 1e5 }, 400, 300);
  assert.equal(v.scale, MIN_SCALE);
});
test("clampViewport: a pan that keeps content on screen is untouched", () => {
  const bounds = { x: 0, y: 0, w: 500, h: 400 };
  const v = { x: 10, y: 10, scale: 1 };
  assert.deepEqual(clampViewport(v, bounds, 800, 600, 60), v);
});
test("clampViewport: content flicked into the void is pulled back to the margin", () => {
  const bounds = { x: 0, y: 0, w: 500, h: 400 };
  const far = clampViewport({ x: 99999, y: -99999, scale: 1 }, bounds, 800, 600, 60);
  assert.equal(far.x, 740, "left edge stops at width - margin");
  assert.equal(far.y, 60 - 400, "bottom edge stops at the margin");
  assert.equal(far.scale, 1, "clamping never changes the zoom");
});
test("visibleWorldRect: the world box a viewport shows", () => {
  const r = visibleWorldRect({ x: 0, y: 0, scale: 2 }, 400, 200);
  assert.deepEqual(r, { x: 0, y: 0, w: 200, h: 100 });
});
test("rectsOverlap: touching counts, separated does not", () => {
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 5, h: 5 }), true);
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 5, h: 5 }), false);
});
test("visibleNodes / visibleEdges: off-screen content is culled, on-screen kept", () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const all = layoutBounds(layout);
  assert.equal(visibleNodes(layout, all).length, layout.nodes.length);
  assert.equal(visibleEdges(layout, all).length, layout.edges.length);
  const far = { x: 1e6, y: 1e6, w: 10, h: 10 };
  assert.deepEqual(visibleNodes(layout, far), []);
  assert.deepEqual(visibleEdges(layout, far), []);
});
test("visibleEdges: a long edge crossing the view is kept even with both ends outside", () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const long = layout.edges.findIndex((e) => e.edge.from === "a" && e.edge.to === "d");
  const pts = layout.edges[long].points;
  const mid = pts[Math.floor(pts.length / 2)];
  const sliver = { x: mid.x - 2, y: mid.y - 2, w: 4, h: 4 };
  assert.ok(visibleEdges(layout, sliver).includes(long));
});
test("hitTestNodes: inside hits, outside misses, edges are inclusive", () => {
  const layout = layoutDag(CHAIN_NODES, CHAIN_EDGES);
  const n = layout.nodes[0];
  assert.equal(hitTestNodes(layout, n.x + n.w / 2, n.y + n.h / 2), 0);
  assert.equal(hitTestNodes(layout, n.x, n.y), 0, "the top-left corner counts");
  assert.equal(hitTestNodes(layout, -1e3, -1e3), -1);
});
test("hitTestEdges: the NEAREST edge wins, not the first one within tolerance", () => {
  const layout = layoutDag(nodesFrom(["a", "b", "t"]), [
    { from: "a", to: "t" },
    { from: "b", to: "t" }
  ]);
  const midOf = (i) => {
    const p = layout.edges[i].points;
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  };
  const m0 = midOf(0);
  const m1 = midOf(1);
  assert.equal(hitTestEdges(layout, m0.x, m0.y, 6), 0);
  const wide = Math.hypot(m1.x - m0.x, m1.y - m0.y) + 10;
  assert.equal(hitTestEdges(layout, m1.x, m1.y, wide), 1);
  assert.equal(hitTestEdges(layout, m0.x, m0.y + 1e5, 6), -1, "beyond tolerance is a miss");
});
test("nodeRect: a placed node as a hit rectangle", () => {
  const layout = layoutDag(nodesFrom(["a"]), []);
  const n = layout.nodes[0];
  assert.deepEqual(nodeRect(n), { x: n.x, y: n.y, w: n.w, h: n.h });
});
test("neighbourhood: everything up-stream and down-stream, transitively", () => {
  const layout = layoutDag(nodesFrom(["a", "b", "c", "d", "e"]), [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
    { from: "b", to: "e" }
  ]);
  const idx = (id) => layout.byId.get(id);
  const n = neighbourhood(layout, idx("c"));
  assert.deepEqual([...n.ancestors].map((i) => layout.nodes[i].node.id).sort(), ["a", "b"]);
  assert.deepEqual([...n.descendants].map((i) => layout.nodes[i].node.id).sort(), ["d"]);
  assert.equal(n.ancestors.has(idx("e")), false, "a sibling branch is not a dependency");
});
test("neighbourhood: an isolated node has an empty neighbourhood", () => {
  const layout = layoutDag(nodesFrom(["a", "b"]), []);
  const n = neighbourhood(layout, 0);
  assert.equal(n.ancestors.size, 0);
  assert.equal(n.descendants.size, 0);
  assert.equal(n.edges.size, 0);
});
test("neighbourhood: the edge set holds the connecting edges and nothing else", () => {
  const layout = layoutDag(nodesFrom(["a", "b", "c", "x", "y"]), [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "x", to: "y" }
  ]);
  const n = neighbourhood(layout, layout.byId.get("b"));
  assert.deepEqual(
    [...n.edges].map((i) => `${layout.edges[i].edge.from}->${layout.edges[i].edge.to}`).sort(),
    ["a->b", "b->c"],
    "the unrelated component contributes nothing"
  );
});
test("neighbourhood: follows the TRUE direction of a cycle-reversed edge", () => {
  const layout = layoutDag(nodesFrom(["a", "b", "c"]), [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "a" }
  ]);
  assert.equal(layout.cycleEdges.length, 1);
  const n = neighbourhood(layout, layout.byId.get("a"));
  assert.equal(n.ancestors.size, 2);
  assert.equal(n.descendants.size, 2);
});
test("nodeHue: stable, in range, and driven by category when there is one", () => {
  const a = { id: "x", category: "build" };
  const b = { id: "y", category: "build" };
  assert.equal(nodeHue(a), nodeHue(b), "one category, one hue");
  assert.notEqual(nodeHue(a), nodeHue({ id: "x", category: "deploy" }));
  for (const id of ["a", "b", "zzz", ""]) {
    const h = nodeHue({ id });
    assert.ok(h >= 0 && h < 360, `${h} in range`);
    assert.equal(h, nodeHue({ id }), "stable");
  }
});
test("nodeHue: an uncategorized graph is still multi-colored", () => {
  const hues = new Set(["a", "b", "c", "d", "e"].map((id) => nodeHue({ id })));
  assert.ok(hues.size >= 4, `${hues.size} distinct hues from 5 ids`);
});
test("layoutDag: a 200-node graph lays out with no overlaps and no lost nodes", () => {
  const n = 200;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, category: `c${i % 7}` }));
  const edges = [];
  for (let i = 1; i < n; i++) {
    edges.push({ from: `n${Math.floor(i / 3)}`, to: `n${i}` });
    if (i % 11 === 0) edges.push({ from: `n${i % 17}`, to: `n${i}` });
  }
  const layout = layoutDag(nodes, edges);
  assert.equal(layout.nodes.length, n, "every node is placed");
  assert.equal(layout.edges.length + layout.rejected.length, edges.length, "every edge is drawn or reported");
  for (const e of layout.edges) {
    if (e.reversed) continue;
    assert.ok(layout.nodes[e.to].layer > layout.nodes[e.from].layer);
  }
  assert.ok(layout.width > 0 && layout.height > 0);
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiZGFnLXZpZXctbWF0aC50ZXN0LnRzIiwgImNvbG9yLnRzIiwgImhpdC10ZXN0LnRzIiwgImRhZy12aWV3LW1hdGgudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IHRlc3QgfSBmcm9tICdub2RlOnRlc3QnO1xuaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydC9zdHJpY3QnO1xuXG5pbXBvcnQge1xuICBidWlsZEdyYXBoLFxuICBicmVha0N5Y2xlcyxcbiAgYXNzaWduTGF5ZXJzLFxuICB0b3BvT3JkZXIsXG4gIGluc2VydER1bW1pZXMsXG4gIG9yZGVyTGF5ZXJzLFxuICBjb3VudENyb3NzaW5ncyxcbiAgY3Jvc3NpbmdzQmV0d2VlbixcbiAgYXNzaWduQ29vcmRpbmF0ZXMsXG4gIHNsb3RJZGVudGl0eSxcbiAgbGF5b3V0RGFnLFxuICB3cmFwV2lkZUxheWVycyxcbiAgYW5jaG9yUG9pbnQsXG4gIG1lYXN1cmVOb2RlLFxuICB3b3JsZFRvU2NyZWVuLFxuICBzY3JlZW5Ub1dvcmxkLFxuICBwYW5WaWV3cG9ydCxcbiAgem9vbVZpZXdwb3J0QXQsXG4gIHpvb21GYWN0b3JGb3JXaGVlbCxcbiAgZml0Vmlld3BvcnQsXG4gIGxheW91dEJvdW5kcyxcbiAgY2xhbXBWaWV3cG9ydCxcbiAgdmlzaWJsZVdvcmxkUmVjdCxcbiAgcmVjdHNPdmVybGFwLFxuICB2aXNpYmxlTm9kZXMsXG4gIHZpc2libGVFZGdlcyxcbiAgaGl0VGVzdE5vZGVzLFxuICBoaXRUZXN0RWRnZXMsXG4gIG5vZGVSZWN0LFxuICBuZWlnaGJvdXJob29kLFxuICBjcml0aWNhbFBhdGhMZW5ndGgsXG4gIG5vZGVIdWUsXG4gIE1JTl9TQ0FMRSxcbiAgTUFYX1NDQUxFLFxuICBERUZBVUxUX0dBUCxcbiAgZml0VG9EZXNpcmVkLFxuICBERUZBVUxUX05PREVfTUFYX1csXG4gIERFRkFVTFRfTk9ERV9NSU5fVyxcbn0gZnJvbSAnLi9kYWctdmlldy1tYXRoLnRzJztcbmltcG9ydCB0eXBlIHsgRGFnTm9kZSwgRGFnRWRnZSwgRGFnTGF5b3V0LCBEYWdWaWV3cG9ydCB9IGZyb20gJy4vZGFnLXZpZXctbWF0aC50cyc7XG5cbi8vIC0tIEZpeHR1cmVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogbjAgLT4gbjEgLT4gbjIgLT4gbjMsIHBsdXMgYSBsb25nIGVkZ2UgbjAgLT4gbjMgdGhhdCBtdXN0IGJlbmQuICovXG5jb25zdCBDSEFJTl9OT0RFUzogRGFnTm9kZVtdID0gW3sgaWQ6ICdhJyB9LCB7IGlkOiAnYicgfSwgeyBpZDogJ2MnIH0sIHsgaWQ6ICdkJyB9XTtcbmNvbnN0IENIQUlOX0VER0VTOiBEYWdFZGdlW10gPSBbXG4gIHsgZnJvbTogJ2EnLCB0bzogJ2InIH0sXG4gIHsgZnJvbTogJ2InLCB0bzogJ2MnIH0sXG4gIHsgZnJvbTogJ2MnLCB0bzogJ2QnIH0sXG4gIHsgZnJvbTogJ2EnLCB0bzogJ2QnIH0sXG5dO1xuXG5mdW5jdGlvbiBpZHMobm9kZXM6IHJlYWRvbmx5IHsgaWQ6IHN0cmluZyB9W10pOiBzdHJpbmdbXSB7XG4gIHJldHVybiBub2Rlcy5tYXAoKG4pID0+IG4uaWQpO1xufVxuXG5mdW5jdGlvbiBub2Rlc0Zyb20obmFtZXM6IHN0cmluZ1tdKTogRGFnTm9kZVtdIHtcbiAgcmV0dXJuIG5hbWVzLm1hcCgoaWQpID0+ICh7IGlkIH0pKTtcbn1cblxuLyoqIExheWVyIG9mIGV2ZXJ5IG5vZGUsIGtleWVkIGJ5IGlkIFx1MjAxNCB0aGUgc2hhcGUgbW9zdCBhc3NlcnRpb25zIHdhbnQuICovXG5mdW5jdGlvbiBsYXllck1hcChsYXlvdXQ6IERhZ0xheW91dCk6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4ge1xuICBjb25zdCBvdXQ6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgZm9yIChjb25zdCBuIG9mIGxheW91dC5ub2Rlcykgb3V0W24ubm9kZS5pZF0gPSBuLmxheWVyO1xuICByZXR1cm4gb3V0O1xufVxuXG4vLyAtLSBidWlsZEdyYXBoIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnYnVpbGRHcmFwaDogaW5kZXhlcyBub2RlcyBhbmQgYm90aCBhZGphY2VuY3kgZGlyZWN0aW9ucycsICgpID0+IHtcbiAgY29uc3QgZyA9IGJ1aWxkR3JhcGgoQ0hBSU5fTk9ERVMsIENIQUlOX0VER0VTKTtcbiAgYXNzZXJ0LmVxdWFsKGcubm9kZXMubGVuZ3RoLCA0KTtcbiAgYXNzZXJ0LmVxdWFsKGcuZWRnZXMubGVuZ3RoLCA0KTtcbiAgYXNzZXJ0LmVxdWFsKGcuaW5kZXguZ2V0KCdjJyksIDIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGcub3V0WzBdLCBbMSwgM10sICdhIHBvaW50cyBhdCBiIGFuZCBkJyk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZy5pblszXSwgWzIsIDBdLCAnZCBpcyBwb2ludGVkIGF0IGJ5IGMgYW5kIGEnKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChnLnJlamVjdGVkLCBbXSk7XG59KTtcblxudGVzdCgnYnVpbGRHcmFwaDogYSByZXBlYXRlZCBub2RlIGlkIGtlZXBzIGl0cyBmaXJzdCBvY2N1cnJlbmNlJywgKCkgPT4ge1xuICBjb25zdCBnID0gYnVpbGRHcmFwaChbeyBpZDogJ2EnLCBsYWJlbDogJ2ZpcnN0JyB9LCB7IGlkOiAnYScsIGxhYmVsOiAnc2Vjb25kJyB9XSwgW10pO1xuICBhc3NlcnQuZXF1YWwoZy5ub2Rlcy5sZW5ndGgsIDEpO1xuICBhc3NlcnQuZXF1YWwoZy5ub2Rlc1swXS5sYWJlbCwgJ2ZpcnN0Jyk7XG59KTtcblxudGVzdCgnYnVpbGRHcmFwaDogZXZlcnkgdW51c2FibGUgZWRnZSBpcyBSRVBPUlRFRCwgbmV2ZXIgc2lsZW50bHkgZHJvcHBlZCcsICgpID0+IHtcbiAgY29uc3QgZyA9IGJ1aWxkR3JhcGgobm9kZXNGcm9tKFsnYScsICdiJ10pLCBbXG4gICAgeyBmcm9tOiAnYScsIHRvOiAnYicgfSxcbiAgICB7IGZyb206ICdnaG9zdCcsIHRvOiAnYicgfSxcbiAgICB7IGZyb206ICdhJywgdG86ICdnaG9zdCcgfSxcbiAgICB7IGZyb206ICdhJywgdG86ICdhJyB9LFxuICAgIHsgZnJvbTogJ2EnLCB0bzogJ2InIH0sXG4gIF0pO1xuICBhc3NlcnQuZXF1YWwoZy5lZGdlcy5sZW5ndGgsIDEsICdvbmx5IHRoZSBvbmUgcmVhbCBlZGdlIGlzIGRyYXduJyk7XG4gIGFzc2VydC5kZWVwRXF1YWwoXG4gICAgZy5yZWplY3RlZC5tYXAoKHIpID0+IHIucmVhc29uKSxcbiAgICBbJ3Vua25vd24tZnJvbScsICd1bmtub3duLXRvJywgJ3NlbGYtbG9vcCcsICdkdXBsaWNhdGUnXSxcbiAgKTtcbiAgLy8gVGhlIGVkZ2Ugb2JqZWN0IGNvbWVzIGJhY2ssIHNvIGEgY29uc3VtZXIgY2FuIG5hbWUgd2hhdCBpdCBsb3N0LlxuICBhc3NlcnQuZGVlcEVxdWFsKGcucmVqZWN0ZWRbMF0uZWRnZSwgeyBmcm9tOiAnZ2hvc3QnLCB0bzogJ2InIH0pO1xufSk7XG5cbnRlc3QoJ2J1aWxkR3JhcGg6IGEgZHVwbGljYXRlIGlzIGp1ZGdlZCBvbiBlbmRwb2ludHMsIG5vdCBvbiBpdHMgbGFiZWwnLCAoKSA9PiB7XG4gIGNvbnN0IGcgPSBidWlsZEdyYXBoKG5vZGVzRnJvbShbJ2EnLCAnYiddKSwgW1xuICAgIHsgZnJvbTogJ2EnLCB0bzogJ2InLCBsYWJlbDogJ25lZWRzJyB9LFxuICAgIHsgZnJvbTogJ2EnLCB0bzogJ2InLCBsYWJlbDogJ2Fsc28gbmVlZHMnIH0sXG4gIF0pO1xuICBhc3NlcnQuZXF1YWwoZy5lZGdlcy5sZW5ndGgsIDEpO1xuICBhc3NlcnQuZXF1YWwoZy5yZWplY3RlZC5sZW5ndGgsIDEpO1xuICBhc3NlcnQuZXF1YWwoZy5yZWplY3RlZFswXS5yZWFzb24sICdkdXBsaWNhdGUnKTtcbn0pO1xuXG4vLyAtLSBicmVha0N5Y2xlcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdhbGtzIGBvdXRgIGxvb2tpbmcgZm9yIGFueSBjeWNsZSBcdTIwMTQgdGhlIG9yYWNsZSBmb3IgYnJlYWtDeWNsZXMuICovXG5mdW5jdGlvbiBoYXNDeWNsZShvdXQ6IHJlYWRvbmx5IChyZWFkb25seSBudW1iZXJbXSlbXSk6IGJvb2xlYW4ge1xuICBjb25zdCBuID0gb3V0Lmxlbmd0aDtcbiAgY29uc3QgbWFyayA9IG5ldyBVaW50OEFycmF5KG4pO1xuICBjb25zdCBvblN0YWNrID0gbmV3IFVpbnQ4QXJyYXkobik7XG4gIGNvbnN0IHZpc2l0ID0gKHY6IG51bWJlcik6IGJvb2xlYW4gPT4ge1xuICAgIG1hcmtbdl0gPSAxO1xuICAgIG9uU3RhY2tbdl0gPSAxO1xuICAgIGZvciAoY29uc3QgdyBvZiBvdXRbdl0pIHtcbiAgICAgIGlmIChvblN0YWNrW3ddKSByZXR1cm4gdHJ1ZTtcbiAgICAgIGlmICghbWFya1t3XSAmJiB2aXNpdCh3KSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIG9uU3RhY2tbdl0gPSAwO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfTtcbiAgZm9yIChsZXQgdiA9IDA7IHYgPCBuOyB2KyspIGlmICghbWFya1t2XSAmJiB2aXNpdCh2KSkgcmV0dXJuIHRydWU7XG4gIHJldHVybiBmYWxzZTtcbn1cblxudGVzdCgnYnJlYWtDeWNsZXM6IGFuIGFjeWNsaWMgZ3JhcGggaXMgbGVmdCBjb21wbGV0ZWx5IGFsb25lJywgKCkgPT4ge1xuICBjb25zdCBnID0gYnVpbGRHcmFwaChDSEFJTl9OT0RFUywgQ0hBSU5fRURHRVMpO1xuICBjb25zdCBjID0gYnJlYWtDeWNsZXMoZyk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYy5yZXZlcnNlZCwgW10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGMub3V0LCBnLm91dCk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYy5pbiwgZy5pbik7XG59KTtcblxudGVzdCgnYnJlYWtDeWNsZXM6IGEgY3ljbGUgaXMgYnJva2VuLCBhbmQgdGhlIGN1dCBlZGdlIGlzIE5BTUVEJywgKCkgPT4ge1xuICBjb25zdCBnID0gYnVpbGRHcmFwaChub2Rlc0Zyb20oWydhJywgJ2InLCAnYyddKSwgW1xuICAgIHsgZnJvbTogJ2EnLCB0bzogJ2InIH0sXG4gICAgeyBmcm9tOiAnYicsIHRvOiAnYycgfSxcbiAgICB7IGZyb206ICdjJywgdG86ICdhJyB9LFxuICBdKTtcbiAgY29uc3QgYyA9IGJyZWFrQ3ljbGVzKGcpO1xuICBhc3NlcnQuZXF1YWwoYy5yZXZlcnNlZC5sZW5ndGgsIDEsICdvbmUgY3V0IGlzIGVub3VnaCBmb3IgYSAzLWN5Y2xlJyk7XG4gIGFzc2VydC5lcXVhbChoYXNDeWNsZShjLm91dCksIGZhbHNlKTtcbiAgLy8gVGhlIHJlcG9ydGVkIGluZGV4IHBvaW50cyBhdCBhIHJlYWwgaW5wdXQgZWRnZSwgc28gdGhlIGVsZW1lbnQgY2FuIGRyYXcgZXhhY3RseSB0aGUgbGluZSB0aGF0IGNsb3NlcyB0aGUgbG9vcC5cbiAgY29uc3QgY3V0ID0gZy5lZGdlc1tjLnJldmVyc2VkWzBdXTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh7IGZyb206IGN1dC5lZGdlLmZyb20sIHRvOiBjdXQuZWRnZS50byB9LCB7IGZyb206ICdjJywgdG86ICdhJyB9KTtcbn0pO1xuXG50ZXN0KCdicmVha0N5Y2xlczogdHdvIGluZGVwZW5kZW50IGN5Y2xlcyBlYWNoIGdldCBjdXQnLCAoKSA9PiB7XG4gIGNvbnN0IGcgPSBidWlsZEdyYXBoKG5vZGVzRnJvbShbJ2EnLCAnYicsICd4JywgJ3knXSksIFtcbiAgICB7IGZyb206ICdhJywgdG86ICdiJyB9LFxuICAgIHsgZnJvbTogJ2InLCB0bzogJ2EnIH0sXG4gICAgeyBmcm9tOiAneCcsIHRvOiAneScgfSxcbiAgICB7IGZyb206ICd5JywgdG86ICd4JyB9LFxuICBdKTtcbiAgY29uc3QgYyA9IGJyZWFrQ3ljbGVzKGcpO1xuICBhc3NlcnQuZXF1YWwoYy5yZXZlcnNlZC5sZW5ndGgsIDIpO1xuICBhc3NlcnQuZXF1YWwoaGFzQ3ljbGUoYy5vdXQpLCBmYWxzZSk7XG59KTtcblxudGVzdCgnYnJlYWtDeWNsZXM6IGEgbG9uZyBjaGFpbiBkb2VzIG5vdCBvdmVyZmxvdyB0aGUgc3RhY2snLCAoKSA9PiB7XG4gIC8vIFJlY3Vyc2lvbiBoZXJlIHdvdWxkIGRpZSBvbiBhIGdyYXBoIHRoYXQgaXMgb3RoZXJ3aXNlIHRyaXZpYWwuXG4gIGNvbnN0IG4gPSAyMDAwMDtcbiAgY29uc3Qgbm9kZXMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiBuIH0sIChfLCBpKSA9PiAoeyBpZDogYG4ke2l9YCB9KSk7XG4gIGNvbnN0IGVkZ2VzID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogbiAtIDEgfSwgKF8sIGkpID0+ICh7IGZyb206IGBuJHtpfWAsIHRvOiBgbiR7aSArIDF9YCB9KSk7XG4gIGNvbnN0IGMgPSBicmVha0N5Y2xlcyhidWlsZEdyYXBoKG5vZGVzLCBlZGdlcykpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGMucmV2ZXJzZWQsIFtdKTtcbn0pO1xuXG4vLyAtLSB0b3BvT3JkZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgndG9wb09yZGVyOiBldmVyeSBlZGdlIHBvaW50cyBmb3J3YXJkIGluIHRoZSBvcmRlcicsICgpID0+IHtcbiAgY29uc3QgZyA9IGJ1aWxkR3JhcGgoQ0hBSU5fTk9ERVMsIENIQUlOX0VER0VTKTtcbiAgY29uc3Qgb3JkZXIgPSB0b3BvT3JkZXIoZy5vdXQsIGcubm9kZXMubGVuZ3RoKTtcbiAgY29uc3QgcG9zID0gbmV3IE1hcChvcmRlci5tYXAoKHYsIGkpID0+IFt2LCBpXSkpO1xuICBmb3IgKGNvbnN0IGUgb2YgZy5lZGdlcykge1xuICAgIGFzc2VydC5vaygocG9zLmdldChlLmZyb20pIGFzIG51bWJlcikgPCAocG9zLmdldChlLnRvKSBhcyBudW1iZXIpLCBgJHtlLmVkZ2UuZnJvbX0gYmVmb3JlICR7ZS5lZGdlLnRvfWApO1xuICB9XG59KTtcblxudGVzdCgndG9wb09yZGVyOiB0aWVzIGJyZWFrIG9uIGluZGV4LCBzbyB0aGUgb3JkZXIgaXMgaWRlbnRpY2FsIGV2ZXJ5IHJ1bicsICgpID0+IHtcbiAgY29uc3QgZyA9IGJ1aWxkR3JhcGgobm9kZXNGcm9tKFsnYycsICdhJywgJ2InXSksIFtdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh0b3BvT3JkZXIoZy5vdXQsIDMpLCBbMCwgMSwgMl0pO1xufSk7XG5cbnRlc3QoJ3RvcG9PcmRlcjogYSBub2RlIGluc2lkZSBhIGN5Y2xlIGlzIGFwcGVuZGVkLCBuZXZlciBsb3N0JywgKCkgPT4ge1xuICAvLyBMb3NpbmcgYSBub2RlIGlzIG5vdCBhbiBhY2NlcHRhYmxlIHdheSB0byByZXBvcnQgYSBjeWNsZS5cbiAgY29uc3Qgb3V0ID0gW1sxXSwgWzBdLCBbXV07XG4gIGNvbnN0IG9yZGVyID0gdG9wb09yZGVyKG91dCwgMyk7XG4gIGFzc2VydC5lcXVhbChvcmRlci5sZW5ndGgsIDMpO1xuICBhc3NlcnQuZGVlcEVxdWFsKFsuLi5vcmRlcl0uc29ydCgoYSwgYikgPT4gYSAtIGIpLCBbMCwgMSwgMl0pO1xufSk7XG5cbi8vIC0tIGFzc2lnbkxheWVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdhc3NpZ25MYXllcnM6IGEgbm9kZSBzaXRzIG9uZSBwYXN0IHRoZSBkZWVwZXN0IHRoaW5nIGl0IG5lZWRzJywgKCkgPT4ge1xuICBjb25zdCBnID0gYnVpbGRHcmFwaChDSEFJTl9OT0RFUywgQ0hBSU5fRURHRVMpO1xuICBjb25zdCBsID0gYXNzaWduTGF5ZXJzKGcsIGJyZWFrQ3ljbGVzKGcpKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChbLi4ubC5sYXllcnNdLCBbMCwgMSwgMiwgM10pO1xuICBhc3NlcnQuZXF1YWwobC5tYXhMYXllciwgMyk7XG59KTtcblxudGVzdCgnYXNzaWduTGF5ZXJzOiBpbmRlcGVuZGVudCByb290cyBhbGwgc3RhcnQgYXQgbGF5ZXIgMCcsICgpID0+IHtcbiAgY29uc3QgZyA9IGJ1aWxkR3JhcGgobm9kZXNGcm9tKFsnYScsICdiJywgJ2MnXSksIFt7IGZyb206ICdhJywgdG86ICdjJyB9LCB7IGZyb206ICdiJywgdG86ICdjJyB9XSk7XG4gIGNvbnN0IGwgPSBhc3NpZ25MYXllcnMoZywgYnJlYWtDeWNsZXMoZykpO1xuICBhc3NlcnQuZGVlcEVxdWFsKFsuLi5sLmxheWVyc10sIFswLCAwLCAxXSk7XG59KTtcblxudGVzdCgnYXNzaWduTGF5ZXJzOiBhIGxheWVyIHBpbiBjYW4gcHVzaCBhIG5vZGUgZG93bicsICgpID0+IHtcbiAgY29uc3QgZyA9IGJ1aWxkR3JhcGgoW3sgaWQ6ICdhJyB9LCB7IGlkOiAnYicsIGxheWVyOiA0IH1dLCBbeyBmcm9tOiAnYScsIHRvOiAnYicgfV0pO1xuICBjb25zdCBsID0gYXNzaWduTGF5ZXJzKGcsIGJyZWFrQ3ljbGVzKGcpKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChbLi4ubC5sYXllcnNdLCBbMCwgNF0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGwuaWdub3JlZFBpbnMsIFtdKTtcbn0pO1xuXG50ZXN0KCdhc3NpZ25MYXllcnM6IGEgcGluIHRoYXQgY29udHJhZGljdHMgYW4gZWRnZSBpcyBvdmVycnVsZWQgQU5EIHJlcG9ydGVkJywgKCkgPT4ge1xuICAvLyBUaGUgaGludCBpcyBhIHByZWZlcmVuY2U7IHRoZSBlZGdlIGlzIGEgZmFjdC4gQSBzaWxlbnRseSBob25vdXJlZCBwaW4gd291bGQgZHJhdyBiIGFib3ZlIGl0cyBvd24gZGVwZW5kZW5jeS5cbiAgY29uc3QgZyA9IGJ1aWxkR3JhcGgoW3sgaWQ6ICdhJyB9LCB7IGlkOiAnYicsIGxheWVyOiAwIH1dLCBbeyBmcm9tOiAnYScsIHRvOiAnYicgfV0pO1xuICBjb25zdCBsID0gYXNzaWduTGF5ZXJzKGcsIGJyZWFrQ3ljbGVzKGcpKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChbLi4ubC5sYXllcnNdLCBbMCwgMV0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGwuaWdub3JlZFBpbnMsIFsnYiddKTtcbn0pO1xuXG50ZXN0KFwiYXNzaWduTGF5ZXJzOiBhbGlnbiAnc2lua3MnIGJvdHRvbS1hbGlnbnMgdGhlIGxlYXZlc1wiLCAoKSA9PiB7XG4gIC8vIGEgLT4gYiAtPiBkLCBhIC0+IGMgLT4gLi4uIG5vdGhpbmcuXG4gIGNvbnN0IGcgPSBidWlsZEdyYXBoKG5vZGVzRnJvbShbJ2EnLCAnYicsICdjJywgJ2QnXSksIFtcbiAgICB7IGZyb206ICdhJywgdG86ICdiJyB9LFxuICAgIHsgZnJvbTogJ2InLCB0bzogJ2QnIH0sXG4gICAgeyBmcm9tOiAnYScsIHRvOiAnYycgfSxcbiAgXSk7XG4gIGNvbnN0IGFjeWNsaWMgPSBicmVha0N5Y2xlcyhnKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChbLi4uYXNzaWduTGF5ZXJzKGcsIGFjeWNsaWMpLmxheWVyc10sIFswLCAxLCAxLCAyXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoWy4uLmFzc2lnbkxheWVycyhnLCBhY3ljbGljLCB7IGFsaWduOiAnc2lua3MnIH0pLmxheWVyc10sIFswLCAxLCAyLCAyXSk7XG59KTtcblxudGVzdCgnYXNzaWduTGF5ZXJzOiBldmVyeSBlZGdlIHN0aWxsIHBvaW50cyBzdHJpY3RseSBkb3dud2FyZCBhZnRlciBjeWNsZSBicmVha2luZycsICgpID0+IHtcbiAgY29uc3QgZyA9IGJ1aWxkR3JhcGgobm9kZXNGcm9tKFsnYScsICdiJywgJ2MnXSksIFtcbiAgICB7IGZyb206ICdhJywgdG86ICdiJyB9LFxuICAgIHsgZnJvbTogJ2InLCB0bzogJ2MnIH0sXG4gICAgeyBmcm9tOiAnYycsIHRvOiAnYScgfSxcbiAgXSk7XG4gIGNvbnN0IGFjeWNsaWMgPSBicmVha0N5Y2xlcyhnKTtcbiAgY29uc3QgbCA9IGFzc2lnbkxheWVycyhnLCBhY3ljbGljKTtcbiAgYWN5Y2xpYy5vdXQuZm9yRWFjaCgoc3VjYywgdikgPT4ge1xuICAgIGZvciAoY29uc3QgdyBvZiBzdWNjKSBhc3NlcnQub2sobC5sYXllcnNbd10gPiBsLmxheWVyc1t2XSwgJ25vIGVkZ2UgaXMgZmxhdCBvciBiYWNrd2FyZHMnKTtcbiAgfSk7XG59KTtcblxuLy8gLS0gd3JhcFdpZGVMYXllcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ3dyYXBXaWRlTGF5ZXJzOiBhIGxheWVyIHRvbyB3aWRlIHRvIHJlYWQgaXMgc3BsaXQgaW50byBjb25zZWN1dGl2ZSByb3dzJywgKCkgPT4ge1xuICBjb25zdCBnID0gYnVpbGRHcmFwaChub2Rlc0Zyb20oQXJyYXkuZnJvbSh7IGxlbmd0aDogMzAgfSwgKF8sIGkpID0+IGBuJHtpfWApKSwgW10pO1xuICBjb25zdCB3cmFwcGVkID0gd3JhcFdpZGVMYXllcnMoYXNzaWduTGF5ZXJzKGcsIGJyZWFrQ3ljbGVzKGcpKSwgMTQpO1xuICBjb25zdCBjb3VudHMgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpO1xuICBmb3IgKGNvbnN0IGwgb2Ygd3JhcHBlZC5sYXllcnMpIGNvdW50cy5zZXQobCwgKGNvdW50cy5nZXQobCkgPz8gMCkgKyAxKTtcbiAgYXNzZXJ0LmVxdWFsKGNvdW50cy5zaXplLCAzLCAnMzAgbm9kZXMgYXQgYSBjYXAgb2YgMTQgbmVlZCB0aHJlZSByb3dzJyk7XG4gIGZvciAoY29uc3QgW2xheWVyLCBuXSBvZiBjb3VudHMpIGFzc2VydC5vayhuIDw9IDE0LCBgbGF5ZXIgJHtsYXllcn0gaG9sZHMgJHtufWApO1xuICBhc3NlcnQuZGVlcEVxdWFsKFsuLi5jb3VudHMudmFsdWVzKCldLCBbMTAsIDEwLCAxMF0pO1xuICBhc3NlcnQuZXF1YWwod3JhcHBlZC5tYXhMYXllciwgMik7XG59KTtcblxudGVzdCgnd3JhcFdpZGVMYXllcnM6IHNwbGl0dGluZyBhIGxheWVyIGtlZXBzIGV2ZXJ5IGVkZ2UgcG9pbnRpbmcgZm9yd2FyZCcsICgpID0+IHtcbiAgLy8gVGhlIHByb3BlcnR5IHRoYXQgbWFrZXMgdGhpcyBzYWZlOiBsb25nZXN0LXBhdGggbGF5ZXJpbmcgbmV2ZXIgcHV0cyBhbiBlZGdlJ3MgZW5kcyBvbiBvbmUgbGF5ZXIuXG4gIGNvbnN0IG5hbWVzID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogNDAgfSwgKF8sIGkpID0+IGBuJHtpfWApO1xuICBjb25zdCBlZGdlczogRGFnRWRnZVtdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMjA7IGkrKykgZWRnZXMucHVzaCh7IGZyb206IGBuJHtpfWAsIHRvOiBgbiR7aSArIDIwfWAgfSk7XG4gIGNvbnN0IGcgPSBidWlsZEdyYXBoKG5vZGVzRnJvbShuYW1lcyksIGVkZ2VzKTtcbiAgY29uc3QgYWN5Y2xpYyA9IGJyZWFrQ3ljbGVzKGcpO1xuICBjb25zdCB3cmFwcGVkID0gd3JhcFdpZGVMYXllcnMoYXNzaWduTGF5ZXJzKGcsIGFjeWNsaWMpLCA2KTtcbiAgYWN5Y2xpYy5vdXQuZm9yRWFjaCgoc3VjYywgdikgPT4ge1xuICAgIGZvciAoY29uc3QgdyBvZiBzdWNjKSB7XG4gICAgICBhc3NlcnQub2sod3JhcHBlZC5sYXllcnNbd10gPiB3cmFwcGVkLmxheWVyc1t2XSwgYG4ke3Z9IC0+IG4ke3d9IHN0aWxsIHBvaW50cyBkb3duYCk7XG4gICAgfVxuICB9KTtcbn0pO1xuXG50ZXN0KCd3cmFwV2lkZUxheWVyczogYSBjYXAgb2YgMCBsZWF2ZXMgdGhlIGxheWVyaW5nIGV4YWN0bHkgYXMgaXQgd2FzJywgKCkgPT4ge1xuICBjb25zdCBnID0gYnVpbGRHcmFwaChub2Rlc0Zyb20oQXJyYXkuZnJvbSh7IGxlbmd0aDogMzAgfSwgKF8sIGkpID0+IGBuJHtpfWApKSwgW10pO1xuICBjb25zdCBiZWZvcmUgPSBhc3NpZ25MYXllcnMoZywgYnJlYWtDeWNsZXMoZykpO1xuICBhc3NlcnQuZGVlcEVxdWFsKFsuLi53cmFwV2lkZUxheWVycyhiZWZvcmUsIDApLmxheWVyc10sIFsuLi5iZWZvcmUubGF5ZXJzXSk7XG59KTtcblxudGVzdCgnbGF5b3V0RGFnOiBhIGZsZWV0IG9mIG1vc3RseS11bmNvbm5lY3RlZCBub2RlcyBkb2VzIG5vdCBkcmF3IGFzIG9uZSBsb25nIGxpbmUnLCAoKSA9PiB7XG4gIGNvbnN0IG5vZGVzID0gbm9kZXNGcm9tKEFycmF5LmZyb20oeyBsZW5ndGg6IDExOCB9LCAoXywgaSkgPT4gYHIke2l9YCkpO1xuICBjb25zdCBlZGdlczogRGFnRWRnZVtdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgNDUgJiYgZWRnZXMubGVuZ3RoIDwgNTM7IGkrKykge1xuICAgIGZvciAoY29uc3QgdCBvZiBbaSArIDMsIGkgKyA3XSkge1xuICAgICAgaWYgKHQgPCA0NSAmJiBlZGdlcy5sZW5ndGggPCA1MykgZWRnZXMucHVzaCh7IGZyb206IGByJHtpfWAsIHRvOiBgciR7dH1gIH0pO1xuICAgIH1cbiAgfVxuICBjb25zdCBsYXlvdXQgPSBsYXlvdXREYWcobm9kZXMsIGVkZ2VzKTtcbiAgYXNzZXJ0Lm9rKFxuICAgIGxheW91dC53aWR0aCAvIGxheW91dC5oZWlnaHQgPCA0LFxuICAgIGBhc3BlY3QgJHsobGF5b3V0LndpZHRoIC8gbGF5b3V0LmhlaWdodCkudG9GaXhlZCgxKX0gaXMgc3RpbGwgdW5yZWFkYWJsZWAsXG4gICk7XG4gIGFzc2VydC5lcXVhbChsYXlvdXQubm9kZXMubGVuZ3RoLCAxMTgsICdubyBub2RlIGlzIGxvc3QnKTtcblxuICAvLyBUaGUgbmVnYXRpdmUgY29udHJvbCBpcyB0aGUgU0hBUEUgdGhpcyBmaXh0dXJlIHVzZWQgdG8gZHJhdyBhcy5cbiAgYXNzZXJ0Lm9rKGxheW91dC53aWR0aCA+IDAgJiYgbGF5b3V0LmhlaWdodCA+IDApO1xufSk7XG5cbnRlc3QoJ3dyYXBXaWRlTGF5ZXJzOiBhIGxheWVyIHRvbyB3aWRlIHRvIHJlYWQgaXMgYnJva2VuIGludG8gcm93cycsICgpID0+IHtcbiAgLy8gS2VwdCBhdCB0aGUgbGF5ZXJpbmcgbGV2ZWwgb24gcHVycG9zZS5cbiAgY29uc3QgZmFuID0gbm9kZXNGcm9tKFsncm9vdCcsIC4uLkFycmF5LmZyb20oeyBsZW5ndGg6IDkwIH0sIChfLCBpKSA9PiBgbGVhZiR7aX1gKV0pO1xuICBjb25zdCBmYW5FZGdlczogRGFnRWRnZVtdID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogOTAgfSwgKF8sIGkpID0+ICh7IGZyb206ICdyb290JywgdG86IGBsZWFmJHtpfWAgfSkpO1xuICBjb25zdCBnID0gYnVpbGRHcmFwaChmYW4sIGZhbkVkZ2VzKTtcbiAgY29uc3QgYmVmb3JlID0gYXNzaWduTGF5ZXJzKGcsIGJyZWFrQ3ljbGVzKGcpKTtcbiAgY29uc3QgYWZ0ZXIgPSB3cmFwV2lkZUxheWVycyhiZWZvcmUsIDE0KTtcblxuICBjb25zdCBjb3VudCA9IChsYXllcnM6IHJlYWRvbmx5IG51bWJlcltdKTogTWFwPG51bWJlciwgbnVtYmVyPiA9PiB7XG4gICAgY29uc3QgbSA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KCk7XG4gICAgZm9yIChjb25zdCBsIG9mIGxheWVycykgbS5zZXQobCwgKG0uZ2V0KGwpID8/IDApICsgMSk7XG4gICAgcmV0dXJuIG07XG4gIH07XG4gIGFzc2VydC5lcXVhbChNYXRoLm1heCguLi5jb3VudChiZWZvcmUubGF5ZXJzKS52YWx1ZXMoKSksIDkwLCAndGhlIGNvbnRyb2wgcmVhbGx5IGlzIG9uZSB3aWRlIGxheWVyJyk7XG4gIGFzc2VydC5vayhNYXRoLm1heCguLi5jb3VudChhZnRlci5sYXllcnMpLnZhbHVlcygpKSA8PSAxNCwgJ25vIHJvdyBpcyBsZWZ0IG92ZXIgdGhlIGxpbWl0Jyk7XG4gIGFzc2VydC5lcXVhbChhZnRlci5sYXllcnMubGVuZ3RoLCA5MSwgJ3dyYXBwaW5nIG5ldmVyIGxvc2VzIGEgbm9kZScpO1xufSk7XG5cbnRlc3QoJ2ZpdFRvRGVzaXJlZDogZGVzaXJlcyB0aGF0IGFscmVhZHkgZml0IGFyZSBsZWZ0IGV4YWN0bHkgYWxvbmUnLCAoKSA9PiB7XG4gIGNvbnN0IGdvdCA9IGZpdFRvRGVzaXJlZChbMCwgNTAsIDEwMF0sIFswLCAzMCwgMzBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChnb3QsIFswLCA1MCwgMTAwXSk7XG59KTtcblxudGVzdCgnZml0VG9EZXNpcmVkOiBhIGNvbGxpc2lvbiBzZXR0bGVzIG9uIHRoZSBtZWRpYW4sIG5ldmVyIGJ5IHB1c2hpbmcgcmlnaHQnLCAoKSA9PiB7XG4gIC8vIFRoZSB3aG9sZSBkZWZlY3QgdGhpcyByZXBsYWNlZDogcHVsbGluZyB0byBhIG1lZGlhbiBhbmQgdGhlbiBzaG92aW5nIG92ZXJsYXBzIGFwYXJ0IGNhbiBvbmx5IEFERCBzcGFjZS5cbiAgY29uc3QgZ290ID0gZml0VG9EZXNpcmVkKFsxMDAsIDEwMCwgMTAwXSwgWzAsIDEwLCAxMF0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGdvdCwgWzkwLCAxMDAsIDExMF0sICd0aGUgYmxvY2sgY2VudHJlcyBvbiB3aGF0IGl0cyBtZW1iZXJzIHdhbnRlZCcpO1xuICBjb25zdCBzcGFuID0gZ290W2dvdC5sZW5ndGggLSAxXSAtIGdvdFswXTtcbiAgYXNzZXJ0LmVxdWFsKHNwYW4sIDIwLCAndGhlIHJvdyBpcyBleGFjdGx5IGFzIHdpZGUgYXMgdGhlIGdhcHMgZGVtYW5kJyk7XG59KTtcblxudGVzdCgnZml0VG9EZXNpcmVkOiB0aGUgb3JkZXIgYW5kIHRoZSBtaW5pbXVtIGdhcHMgYWx3YXlzIGhvbGQnLCAoKSA9PiB7XG4gIGNvbnN0IGRlc2lyZWQgPSBbNTAwLCAxMCwgNDgwLCAyMCwgMzAwXTtcbiAgY29uc3QgZ2FwcyA9IFswLCA0MCwgNDAsIDQwLCA0MF07XG4gIGNvbnN0IGdvdCA9IGZpdFRvRGVzaXJlZChkZXNpcmVkLCBnYXBzKTtcbiAgZm9yIChsZXQgaSA9IDE7IGkgPCBnb3QubGVuZ3RoOyBpKyspIHtcbiAgICBhc3NlcnQub2soZ290W2ldIC0gZ290W2kgLSAxXSA+PSBnYXBzW2ldIC0gMWUtOSwgYHNsb3QgJHtpfSBrZWVwcyBpdHMgZ2FwYCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdmaXRUb0Rlc2lyZWQ6IGl0IGJlYXRzIHB1bGwtdGhlbi1zaG92ZSBvbiB0aGUgdG90YWwgZGlzdGFuY2UgZnJvbSB0aGUgZGVzaXJlcycsICgpID0+IHtcbiAgY29uc3QgZGVzaXJlZCA9IFsxMDAsIDEwMCwgMTAwLCAxMDBdO1xuICBjb25zdCBnYXBzID0gWzAsIDMwLCAzMCwgMzBdO1xuICBjb25zdCBzaG92ZTogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBkZXNpcmVkLmxlbmd0aDsgaSsrKSB7XG4gICAgc2hvdmUucHVzaChpID09PSAwID8gZGVzaXJlZFtpXSA6IE1hdGgubWF4KGRlc2lyZWRbaV0sIHNob3ZlW2kgLSAxXSArIGdhcHNbaV0pKTtcbiAgfVxuICBjb25zdCBjb3N0ID0gKHhzOiByZWFkb25seSBudW1iZXJbXSk6IG51bWJlciA9PiB4cy5yZWR1Y2UoKHMsIHgsIGkpID0+IHMgKyBNYXRoLmFicyh4IC0gZGVzaXJlZFtpXSksIDApO1xuICBhc3NlcnQub2soY29zdChmaXRUb0Rlc2lyZWQoZGVzaXJlZCwgZ2FwcykpIDwgY29zdChzaG92ZSksICd0aGUgcHJvamVjdGlvbiBpcyBjbG9zZXIgdG8gd2hhdCB3YXMgYXNrZWQgZm9yJyk7XG59KTtcblxudGVzdCgnbGF5b3V0RGFnOiBhbiBlZGdlbGVzcyBub2RlIGlzIHBhY2tlZCBpbnRvIHRoZSBibG9jaywgbm90IGxlZnQgZmxvYXRpbmcnLCAoKSA9PiB7XG4gIC8vIFRoZSBkZWZlY3Q6IG5vdGhpbmcgZW5mb3JjZWQgYSBNQVhJTVVNIGRpc3RhbmNlLlxuICBjb25zdCBuYW1lcyA9IFsnZGVwJywgJ3VzZXInLCAuLi5BcnJheS5mcm9tKHsgbGVuZ3RoOiA4IH0sIChfLCBpKSA9PiBgbG9uZSR7aX1gKV07XG4gIGNvbnN0IGxheW91dCA9IGxheW91dERhZyhub2Rlc0Zyb20obmFtZXMpLCBbeyBmcm9tOiAnZGVwJywgdG86ICd1c2VyJyB9XSk7XG4gIGNvbnN0IGJsb2NrID0gbGF5b3V0Lm5vZGVzLmZpbHRlcigobikgPT4gbi5sYXllciA8IDApO1xuICBhc3NlcnQuZXF1YWwoYmxvY2subGVuZ3RoLCA4LCAnZXZlcnkgZWRnZWxlc3Mgbm9kZSBpcyBpbiB0aGUgYmxvY2snKTtcblxuICBjb25zdCByb3dzID0gbmV3IE1hcDxudW1iZXIsIHR5cGVvZiBibG9jaz4oKTtcbiAgZm9yIChjb25zdCBuIG9mIGJsb2NrKSByb3dzLnNldChuLnksIFsuLi4ocm93cy5nZXQobi55KSA/PyBbXSksIG5dKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cy52YWx1ZXMoKSkge1xuICAgIGNvbnN0IGxpbmUgPSBbLi4ucm93XS5zb3J0KChhLCBiKSA9PiBhLnggLSBiLngpO1xuICAgIGZvciAobGV0IGkgPSAxOyBpIDwgbGluZS5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgZ2FwID0gbGluZVtpXS54IC0gKGxpbmVbaSAtIDFdLnggKyBsaW5lW2kgLSAxXS53KTtcbiAgICAgIGFzc2VydC5vayhcbiAgICAgICAgZ2FwIDw9IERFRkFVTFRfR0FQICsgMWUtNixcbiAgICAgICAgYCR7bGluZVtpXS5ub2RlLmlkfSBzaXRzICR7Z2FwLnRvRml4ZWQoMCl9IGZyb20gJHtsaW5lW2kgLSAxXS5ub2RlLmlkfSwgb3ZlciB0aGUgJHtERUZBVUxUX0dBUH0gZ2FwYCxcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgLy8gQW5kIHRoZSBibG9jayBpcyBCRVNJREUgdGhlIGdyYXBoLCBuZXZlciBvbiB0b3Agb2YgaXQuXG4gIGNvbnN0IHdpcmVkID0gbGF5b3V0Lm5vZGVzLmZpbHRlcigobikgPT4gbi5sYXllciA+PSAwKTtcbiAgY29uc3QgbG93ZXN0ID0gTWF0aC5tYXgoLi4ud2lyZWQubWFwKChuKSA9PiBuLnkgKyBuLmgpKTtcbiAgYXNzZXJ0Lm9rKE1hdGgubWluKC4uLmJsb2NrLm1hcCgobikgPT4gbi55KSkgPj0gbG93ZXN0LCAndGhlIGJsb2NrIGNsZWFycyB0aGUgZHJhd2luZycpO1xufSk7XG5cbi8vIC0tIGluc2VydER1bW1pZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdpbnNlcnREdW1taWVzOiBhIGxvbmcgZWRnZSBnZXRzIG9uZSBiZW5kIHBvaW50IHBlciBsYXllciBpdCBjcm9zc2VzJywgKCkgPT4ge1xuICBjb25zdCBnID0gYnVpbGRHcmFwaChDSEFJTl9OT0RFUywgQ0hBSU5fRURHRVMpO1xuICBjb25zdCBhY3ljbGljID0gYnJlYWtDeWNsZXMoZyk7XG4gIGNvbnN0IGxheWVyZWQgPSBhc3NpZ25MYXllcnMoZywgYWN5Y2xpYyk7XG4gIGNvbnN0IHByb3BlciA9IGluc2VydER1bW1pZXMoZywgYWN5Y2xpYywgbGF5ZXJlZCk7XG4gIGNvbnN0IGxvbmdFZGdlID0gZy5lZGdlcy5maW5kSW5kZXgoKGUpID0+IGUuZWRnZS5mcm9tID09PSAnYScgJiYgZS5lZGdlLnRvID09PSAnZCcpO1xuICBhc3NlcnQuZXF1YWwoKHByb3Blci5jaGFpbnMuZ2V0KGxvbmdFZGdlKSA/PyBbXSkubGVuZ3RoLCAyKTtcbiAgLy8gSXRzIHNob3J0IG5laWdoYm91cnMgbmVlZCBubyBiZW5kIGF0IGFsbC5cbiAgY29uc3Qgc2hvcnRFZGdlID0gZy5lZGdlcy5maW5kSW5kZXgoKGUpID0+IGUuZWRnZS5mcm9tID09PSAnYScgJiYgZS5lZGdlLnRvID09PSAnYicpO1xuICBhc3NlcnQuZGVlcEVxdWFsKHByb3Blci5jaGFpbnMuZ2V0KHNob3J0RWRnZSksIFtdKTtcbn0pO1xuXG50ZXN0KCdpbnNlcnREdW1taWVzOiBldmVyeSBsYXllciBsaW5rIHNwYW5zIGV4YWN0bHkgb25lIGxheWVyJywgKCkgPT4ge1xuICBjb25zdCBnID0gYnVpbGRHcmFwaChDSEFJTl9OT0RFUywgQ0hBSU5fRURHRVMpO1xuICBjb25zdCBhY3ljbGljID0gYnJlYWtDeWNsZXMoZyk7XG4gIGNvbnN0IGxheWVyZWQgPSBhc3NpZ25MYXllcnMoZywgYWN5Y2xpYyk7XG4gIGNvbnN0IHByb3BlciA9IGluc2VydER1bW1pZXMoZywgYWN5Y2xpYywgbGF5ZXJlZCk7XG4gIGNvbnN0IGxheWVyT2YgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICBwcm9wZXIubGF5ZXJzLmZvckVhY2goKHJvdywgbCkgPT4gcm93LmZvckVhY2goKHMpID0+IGxheWVyT2Yuc2V0KHNsb3RJZGVudGl0eShzKSwgbCkpKTtcbiAgZm9yIChjb25zdCBbZnJvbSwgdG9zXSBvZiBwcm9wZXIuc3VjYykge1xuICAgIGZvciAoY29uc3QgdG8gb2YgdG9zKSB7XG4gICAgICBhc3NlcnQuZXF1YWwoXG4gICAgICAgIChsYXllck9mLmdldCh0bykgYXMgbnVtYmVyKSAtIChsYXllck9mLmdldChmcm9tKSBhcyBudW1iZXIpLFxuICAgICAgICAxLFxuICAgICAgICBgJHtmcm9tfSAtPiAke3RvfSBzcGFucyBvbmUgbGF5ZXJgLFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn0pO1xuXG50ZXN0KCdpbnNlcnREdW1taWVzOiBzbG90IGlkZW50aXR5IHN1cnZpdmVzIHJlb3JkZXJpbmcgaXRzIGxheWVyJywgKCkgPT4ge1xuICAvLyBUaGlzIGlzIHRoZSB3aG9sZSByZWFzb24gaWRlbnRpdGllcyBleGlzdCBpbnN0ZWFkIG9mIHBvc2l0aW9ucy5cbiAgY29uc3QgZyA9IGJ1aWxkR3JhcGgoQ0hBSU5fTk9ERVMsIENIQUlOX0VER0VTKTtcbiAgY29uc3QgYWN5Y2xpYyA9IGJyZWFrQ3ljbGVzKGcpO1xuICBjb25zdCBwcm9wZXIgPSBpbnNlcnREdW1taWVzKGcsIGFjeWNsaWMsIGFzc2lnbkxheWVycyhnLCBhY3ljbGljKSk7XG4gIGNvbnN0IHJvdyA9IHByb3Blci5sYXllcnNbMV07XG4gIGNvbnN0IGJlZm9yZSA9IHJvdy5tYXAoc2xvdElkZW50aXR5KTtcbiAgcm93LnJldmVyc2UoKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChyb3cubWFwKHNsb3RJZGVudGl0eSksIFsuLi5iZWZvcmVdLnJldmVyc2UoKSk7XG4gIC8vIC4uLmFuZCB0aGUgYWRqYWNlbmN5IHN0aWxsIHJlc29sdmVzLCBiZWNhdXNlIGl0IG5ldmVyIG1lbnRpb25lZCBhIHBvc2l0aW9uLlxuICBhc3NlcnQub2socHJvcGVyLnN1Y2MuaGFzKGJlZm9yZVswXSkgfHwgcHJvcGVyLnByZWQuaGFzKGJlZm9yZVswXSkpO1xufSk7XG5cbi8vIC0tIENyb3NzaW5ncyBhbmQgb3JkZXJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdjcm9zc2luZ3NCZXR3ZWVuOiB0aGUgdGV4dGJvb2sgc2luZ2xlIGNyb3NzaW5nJywgKCkgPT4ge1xuICAvLyBhIC0+IHkgYW5kIGIgLT4geCwgZHJhd24gYSxiIG92ZXIgeCx5OiBleGFjdGx5IG9uZSBjcm9zc2luZy5cbiAgY29uc3QgZyA9IGJ1aWxkR3JhcGgobm9kZXNGcm9tKFsnYScsICdiJywgJ3gnLCAneSddKSwgW1xuICAgIHsgZnJvbTogJ2EnLCB0bzogJ3knIH0sXG4gICAgeyBmcm9tOiAnYicsIHRvOiAneCcgfSxcbiAgXSk7XG4gIGNvbnN0IGFjeWNsaWMgPSBicmVha0N5Y2xlcyhnKTtcbiAgY29uc3QgcHJvcGVyID0gaW5zZXJ0RHVtbWllcyhnLCBhY3ljbGljLCBhc3NpZ25MYXllcnMoZywgYWN5Y2xpYykpO1xuICAvLyBGb3JjZSB0aGUgYmFkIG9yZGVyIHNvIHRoZSBjb3VudCBpcyBhYm91dCBnZW9tZXRyeSwgbm90IGFib3V0IGxheW91dCBsdWNrLlxuICBwcm9wZXIubGF5ZXJzWzBdID0gW1xuICAgIHsgbm9kZTogMCwgZWRnZTogLTEsIGxheWVyOiAwIH0sXG4gICAgeyBub2RlOiAxLCBlZGdlOiAtMSwgbGF5ZXI6IDAgfSxcbiAgXTtcbiAgcHJvcGVyLmxheWVyc1sxXSA9IFtcbiAgICB7IG5vZGU6IDIsIGVkZ2U6IC0xLCBsYXllcjogMSB9LFxuICAgIHsgbm9kZTogMywgZWRnZTogLTEsIGxheWVyOiAxIH0sXG4gIF07XG4gIGFzc2VydC5lcXVhbChjcm9zc2luZ3NCZXR3ZWVuKHByb3BlciwgMCksIDEpO1xuICAvLyBTd2FwIHRoZSBsb3dlciBsYXllciBhbmQgdGhlIGNyb3NzaW5nIGlzIGdvbmUuXG4gIHByb3Blci5sYXllcnNbMV0ucmV2ZXJzZSgpO1xuICBhc3NlcnQuZXF1YWwoY3Jvc3NpbmdzQmV0d2Vlbihwcm9wZXIsIDApLCAwKTtcbn0pO1xuXG50ZXN0KCdjb3VudENyb3NzaW5nczogcGFyYWxsZWwgZWRnZXMgbmV2ZXIgY3Jvc3MnLCAoKSA9PiB7XG4gIGNvbnN0IGcgPSBidWlsZEdyYXBoKG5vZGVzRnJvbShbJ2EnLCAnYicsICd4JywgJ3knXSksIFtcbiAgICB7IGZyb206ICdhJywgdG86ICd4JyB9LFxuICAgIHsgZnJvbTogJ2InLCB0bzogJ3knIH0sXG4gIF0pO1xuICBjb25zdCBhY3ljbGljID0gYnJlYWtDeWNsZXMoZyk7XG4gIGNvbnN0IHByb3BlciA9IGluc2VydER1bW1pZXMoZywgYWN5Y2xpYywgYXNzaWduTGF5ZXJzKGcsIGFjeWNsaWMpKTtcbiAgYXNzZXJ0LmVxdWFsKGNvdW50Q3Jvc3NpbmdzKHByb3BlciksIDApO1xufSk7XG5cbnRlc3QoJ29yZGVyTGF5ZXJzOiBuZXZlciByZXR1cm5zIGEgd29yc2UgYXJyYW5nZW1lbnQgdGhhbiBpdCBzdGFydGVkIHdpdGgnLCAoKSA9PiB7XG4gIC8vIFRoZSBoZXVyaXN0aWMgbWF5IGZhaWwgdG8gZmluZCB0aGUgb3B0aW11bTsgaXQgbXVzdCBuZXZlciBtYWtlIHRoaW5nc1xuICAvLyB3b3JzZSwgYmVjYXVzZSBpdCBrZWVwcyB0aGUgYmVzdCBhcnJhbmdlbWVudCBpdCBoYXMgc2Vlbi5cbiAgY29uc3QgbmFtZXMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiA4IH0sIChfLCBpKSA9PiBgdSR7aX1gKS5jb25jYXQoXG4gICAgQXJyYXkuZnJvbSh7IGxlbmd0aDogOCB9LCAoXywgaSkgPT4gYGQke2l9YCksXG4gICk7XG4gIGNvbnN0IGVkZ2VzOiBEYWdFZGdlW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA4OyBpKyspIGVkZ2VzLnB1c2goeyBmcm9tOiBgdSR7aX1gLCB0bzogYGQkeyhpICogNSkgJSA4fWAgfSk7XG4gIGNvbnN0IGcgPSBidWlsZEdyYXBoKG5vZGVzRnJvbShuYW1lcyksIGVkZ2VzKTtcbiAgY29uc3QgYWN5Y2xpYyA9IGJyZWFrQ3ljbGVzKGcpO1xuICBjb25zdCBwcm9wZXIgPSBpbnNlcnREdW1taWVzKGcsIGFjeWNsaWMsIGFzc2lnbkxheWVycyhnLCBhY3ljbGljKSk7XG4gIGNvbnN0IGJlZm9yZSA9IGNvdW50Q3Jvc3NpbmdzKHByb3Blcik7XG4gIGNvbnN0IGFmdGVyID0gb3JkZXJMYXllcnMocHJvcGVyKTtcbiAgYXNzZXJ0Lm9rKGFmdGVyIDw9IGJlZm9yZSwgYCR7YWZ0ZXJ9IDw9ICR7YmVmb3JlfWApO1xuICBhc3NlcnQuZXF1YWwoYWZ0ZXIsIGNvdW50Q3Jvc3NpbmdzKHByb3BlciksICd0aGUgcmVwb3J0ZWQgY291bnQgbWF0Y2hlcyB0aGUgYXJyYW5nZW1lbnQgaXQgbGVmdCBiZWhpbmQnKTtcbn0pO1xuXG50ZXN0KCdvcmRlckxheWVyczogaWRlbnRpY2FsIGlucHV0IGdpdmVzIGFuIGlkZW50aWNhbCBhcnJhbmdlbWVudCcsICgpID0+IHtcbiAgY29uc3QgYnVpbGQgPSAoKTogbnVtYmVyW11bXSA9PiB7XG4gICAgY29uc3QgbmFtZXMgPSBbJ2EnLCAnYicsICdjJywgJ2QnLCAnZScsICdmJ107XG4gICAgY29uc3QgZyA9IGJ1aWxkR3JhcGgobm9kZXNGcm9tKG5hbWVzKSwgW1xuICAgICAgeyBmcm9tOiAnYScsIHRvOiAnZScgfSxcbiAgICAgIHsgZnJvbTogJ2InLCB0bzogJ2QnIH0sXG4gICAgICB7IGZyb206ICdjJywgdG86ICdmJyB9LFxuICAgICAgeyBmcm9tOiAnYScsIHRvOiAnZicgfSxcbiAgICBdKTtcbiAgICBjb25zdCBhY3ljbGljID0gYnJlYWtDeWNsZXMoZyk7XG4gICAgY29uc3QgcHJvcGVyID0gaW5zZXJ0RHVtbWllcyhnLCBhY3ljbGljLCBhc3NpZ25MYXllcnMoZywgYWN5Y2xpYykpO1xuICAgIG9yZGVyTGF5ZXJzKHByb3Blcik7XG4gICAgcmV0dXJuIHByb3Blci5sYXllcnMubWFwKChyb3cpID0+IHJvdy5tYXAoKHMpID0+IHMubm9kZSkpO1xuICB9O1xuICBhc3NlcnQuZGVlcEVxdWFsKGJ1aWxkKCksIGJ1aWxkKCkpO1xufSk7XG5cbi8vIC0tIGFzc2lnbkNvb3JkaW5hdGVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdhc3NpZ25Db29yZGluYXRlczogYm94ZXMgaW4gYSBsYXllciBuZXZlciBvdmVybGFwJywgKCkgPT4ge1xuICAvLyBCb3hlcyBkcmF3biBvbiB0b3Agb2YgZWFjaCBvdGhlciBpcyB3b3JzZSB0aGFuIGFueSBjcm9va2VkbmVzcy5cbiAgY29uc3QgbmFtZXMgPSBbJ3InLCAnYScsICdiJywgJ2MnLCAnZCddO1xuICBjb25zdCBnID0gYnVpbGRHcmFwaChub2Rlc0Zyb20obmFtZXMpLCBuYW1lcy5zbGljZSgxKS5tYXAoKGlkKSA9PiAoeyBmcm9tOiAncicsIHRvOiBpZCB9KSkpO1xuICBjb25zdCBhY3ljbGljID0gYnJlYWtDeWNsZXMoZyk7XG4gIGNvbnN0IHByb3BlciA9IGluc2VydER1bW1pZXMoZywgYWN5Y2xpYywgYXNzaWduTGF5ZXJzKGcsIGFjeWNsaWMpKTtcbiAgb3JkZXJMYXllcnMocHJvcGVyKTtcbiAgY29uc3Qgc2l6ZXMgPSBnLm5vZGVzLm1hcCgoXywgaSkgPT4gKHsgdzogNDAgKyBpICogMjAsIGg6IDMwIH0pKTtcbiAgY29uc3QgY29vcmRzID0gYXNzaWduQ29vcmRpbmF0ZXMocHJvcGVyLCBzaXplcyk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGNvb3Jkcy5wbGFjZW1lbnRzKSB7XG4gICAgY29uc3Qgc29ydGVkID0gWy4uLnJvd10uc29ydCgoeCwgeSkgPT4geC5jIC0geS5jKTtcbiAgICBmb3IgKGxldCBpID0gMTsgaSA8IHNvcnRlZC5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgZ2FwID0gc29ydGVkW2ldLmMgLSBzb3J0ZWRbaV0uY1NpemUgLyAyIC0gKHNvcnRlZFtpIC0gMV0uYyArIHNvcnRlZFtpIC0gMV0uY1NpemUgLyAyKTtcbiAgICAgIGFzc2VydC5vayhnYXAgPj0gREVGQVVMVF9HQVAgLSAxZS02LCBgZ2FwICR7Z2FwfSA+PSAke0RFRkFVTFRfR0FQfWApO1xuICAgIH1cbiAgfVxufSk7XG5cbnRlc3QoJ2Fzc2lnbkNvb3JkaW5hdGVzOiBhIHN0cmFpZ2h0IGNoYWluIGRyYXdzIGFzIGEgc3RyYWlnaHQgbGluZScsICgpID0+IHtcbiAgLy8gVGhlIHN0YWlyY2FzZSB0aGlzIHByZXZlbnRzIGlzIHRoZSBtb3N0IG9idmlvdXMgbGF5b3V0IGRlZmVjdC5cbiAgY29uc3QgZyA9IGJ1aWxkR3JhcGgoQ0hBSU5fTk9ERVMuc2xpY2UoMCwgMyksIFtcbiAgICB7IGZyb206ICdhJywgdG86ICdiJyB9LFxuICAgIHsgZnJvbTogJ2InLCB0bzogJ2MnIH0sXG4gIF0pO1xuICBjb25zdCBhY3ljbGljID0gYnJlYWtDeWNsZXMoZyk7XG4gIGNvbnN0IHByb3BlciA9IGluc2VydER1bW1pZXMoZywgYWN5Y2xpYywgYXNzaWduTGF5ZXJzKGcsIGFjeWNsaWMpKTtcbiAgb3JkZXJMYXllcnMocHJvcGVyKTtcbiAgY29uc3QgY29vcmRzID0gYXNzaWduQ29vcmRpbmF0ZXMocHJvcGVyLCBnLm5vZGVzLm1hcCgoKSA9PiAoeyB3OiAxMDAsIGg6IDMwIH0pKSk7XG4gIGNvbnN0IGNlbnRlcnMgPSBjb29yZHMucGxhY2VtZW50cy5tYXAoKHJvdykgPT4gcm93WzBdLmMpO1xuICBhc3NlcnQuZXF1YWwoY2VudGVycy5sZW5ndGgsIDMpO1xuICBmb3IgKGNvbnN0IGMgb2YgY2VudGVycykgYXNzZXJ0Lm9rKE1hdGguYWJzKGMgLSBjZW50ZXJzWzBdKSA8IDFlLTYsICdldmVyeSBub2RlIHNoYXJlcyBvbmUgY2VudGVyJyk7XG59KTtcblxudGVzdCgnYXNzaWduQ29vcmRpbmF0ZXM6IGxheWVycyBhcmUgc3RhY2tlZCwgYW5kIHRoZSBkcmF3aW5nIHN0YXJ0cyBhdCAwJywgKCkgPT4ge1xuICBjb25zdCBnID0gYnVpbGRHcmFwaChDSEFJTl9OT0RFUywgQ0hBSU5fRURHRVMpO1xuICBjb25zdCBhY3ljbGljID0gYnJlYWtDeWNsZXMoZyk7XG4gIGNvbnN0IHByb3BlciA9IGluc2VydER1bW1pZXMoZywgYWN5Y2xpYywgYXNzaWduTGF5ZXJzKGcsIGFjeWNsaWMpKTtcbiAgb3JkZXJMYXllcnMocHJvcGVyKTtcbiAgY29uc3QgY29vcmRzID0gYXNzaWduQ29vcmRpbmF0ZXMocHJvcGVyLCBnLm5vZGVzLm1hcCgoKSA9PiAoeyB3OiA4MCwgaDogMzAgfSkpLCB7IGxheWVyR2FwOiA0MCB9KTtcbiAgY29uc3Qgbm9kZVJvd3MgPSBjb29yZHMucGxhY2VtZW50cy5tYXAoKHJvdywgbCkgPT4gKHsgbCwgcm93IH0pKTtcbiAgZm9yIChsZXQgaSA9IDE7IGkgPCBub2RlUm93cy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHByZXYgPSBNYXRoLm1heCguLi5ub2RlUm93c1tpIC0gMV0ucm93Lm1hcCgocCkgPT4gcC5sICsgcC5sU2l6ZSkpO1xuICAgIGNvbnN0IG5leHQgPSBNYXRoLm1pbiguLi5ub2RlUm93c1tpXS5yb3cubWFwKChwKSA9PiBwLmwpKTtcbiAgICBhc3NlcnQub2sobmV4dCA+PSBwcmV2LCAnbm8gbGF5ZXIgcmVhY2hlcyBiYWNrIGludG8gdGhlIG9uZSBhYm92ZSBpdCcpO1xuICB9XG4gIGNvbnN0IG1pbkMgPSBNYXRoLm1pbiguLi5jb29yZHMucGxhY2VtZW50cy5mbGF0KCkubWFwKChwKSA9PiBwLmMgLSBwLmNTaXplIC8gMikpO1xuICBhc3NlcnQub2soTWF0aC5hYnMobWluQykgPCAxZS02LCAnbGVmdCBlZGdlIGlzIDAnKTtcbn0pO1xuXG4vLyAtLSBsYXlvdXREYWcgKGVuZCB0byBlbmQpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ2xheW91dERhZzogZXZlcnkgZWRnZSBwb2ludHMgZG93biB0aGUgcGFnZScsICgpID0+IHtcbiAgY29uc3QgbGF5b3V0ID0gbGF5b3V0RGFnKENIQUlOX05PREVTLCBDSEFJTl9FREdFUyk7XG4gIGZvciAoY29uc3QgZSBvZiBsYXlvdXQuZWRnZXMpIHtcbiAgICBjb25zdCBmcm9tID0gbGF5b3V0Lm5vZGVzW2UuZnJvbV07XG4gICAgY29uc3QgdG8gPSBsYXlvdXQubm9kZXNbZS50b107XG4gICAgYXNzZXJ0Lm9rKHRvLmxheWVyID4gZnJvbS5sYXllciwgYCR7ZS5lZGdlLmZyb219IC0+ICR7ZS5lZGdlLnRvfSBnb2VzIGRvd253YXJkYCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdsYXlvdXREYWc6IHRoZSBzYW1lIGlucHV0IHByb2R1Y2VzIGJ5dGUtaWRlbnRpY2FsIGdlb21ldHJ5JywgKCkgPT4ge1xuICAvLyBBIGdyYXBoIHRoYXQgcmVzaHVmZmxlcyBvbiByZWZyZXNoIGNhbm5vdCBiZSBjb21wYXJlZCB0byB3aGF0IHlvdSBzYXcuXG4gIGNvbnN0IGEgPSBsYXlvdXREYWcoQ0hBSU5fTk9ERVMsIENIQUlOX0VER0VTKTtcbiAgY29uc3QgYiA9IGxheW91dERhZyhDSEFJTl9OT0RFUywgQ0hBSU5fRURHRVMpO1xuICBhc3NlcnQuZGVlcEVxdWFsKFxuICAgIGEubm9kZXMubWFwKChuKSA9PiBbbi5ub2RlLmlkLCBuLngsIG4ueSwgbi53LCBuLmhdKSxcbiAgICBiLm5vZGVzLm1hcCgobikgPT4gW24ubm9kZS5pZCwgbi54LCBuLnksIG4udywgbi5oXSksXG4gICk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYS5lZGdlcy5tYXAoKGUpID0+IGUucG9pbnRzKSwgYi5lZGdlcy5tYXAoKGUpID0+IGUucG9pbnRzKSk7XG59KTtcblxudGVzdCgnbGF5b3V0RGFnOiBhbiBlbXB0eSBncmFwaCBpcyBhIHZhbGlkLCBlbXB0eSBsYXlvdXQnLCAoKSA9PiB7XG4gIGNvbnN0IGxheW91dCA9IGxheW91dERhZyhbXSwgW10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGlkcyhsYXlvdXQubm9kZXMubWFwKChuKSA9PiBuLm5vZGUpKSwgW10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKFsuLi5sYXlvdXQuZWRnZXNdLCBbXSk7XG4gIGFzc2VydC5lcXVhbChsYXlvdXQud2lkdGgsIDApO1xuICBhc3NlcnQuZGVlcEVxdWFsKGxheW91dEJvdW5kcyhsYXlvdXQpLCB7IHg6IDAsIHk6IDAsIHc6IDAsIGg6IDAgfSk7XG59KTtcblxudGVzdCgnbGF5b3V0RGFnOiBhIGdyYXBoIHdpdGggbm8gZWRnZXMgYXQgYWxsIHN0aWxsIGxheXMgb3V0JywgKCkgPT4ge1xuICBjb25zdCBsYXlvdXQgPSBsYXlvdXREYWcobm9kZXNGcm9tKFsnYScsICdiJywgJ2MnXSksIFtdKTtcbiAgYXNzZXJ0LmVxdWFsKGxheW91dC5ub2Rlcy5sZW5ndGgsIDMpO1xuICAvLyBBbiBlZGdlbGVzcyBub2RlIGlzIHNldCBhcyBhIGJsb2NrIHJhdGhlciB0aGFuIGxheWVyZWQuXG4gIGFzc2VydC5kZWVwRXF1YWwoT2JqZWN0LnZhbHVlcyhsYXllck1hcChsYXlvdXQpKSwgWy0xLCAtMSwgLTFdKTtcbiAgYXNzZXJ0LmVxdWFsKGxheW91dC5jcm9zc2luZ3MsIDApO1xuICBhc3NlcnQub2sobGF5b3V0LndpZHRoID4gMCAmJiBsYXlvdXQuaGVpZ2h0ID4gMCwgJ3RoZSBibG9jayBzdGlsbCBvY2N1cGllcyB0aGUgZHJhd2luZycpO1xufSk7XG5cbnRlc3QoJ2xheW91dERhZzogZGlzY29ubmVjdGVkIGNvbXBvbmVudHMgYWxsIGdldCBwbGFjZWQnLCAoKSA9PiB7XG4gIGNvbnN0IGxheW91dCA9IGxheW91dERhZyhub2Rlc0Zyb20oWydhJywgJ2InLCAneCcsICd5J10pLCBbXG4gICAgeyBmcm9tOiAnYScsIHRvOiAnYicgfSxcbiAgICB7IGZyb206ICd4JywgdG86ICd5JyB9LFxuICBdKTtcbiAgYXNzZXJ0LmVxdWFsKGxheW91dC5ub2Rlcy5sZW5ndGgsIDQpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGxheWVyTWFwKGxheW91dCksIHsgYTogMCwgYjogMSwgeDogMCwgeTogMSB9KTtcbn0pO1xuXG50ZXN0KCdsYXlvdXREYWc6IGEgbG9uZyBlZGdlIGdldHMgYmVuZCBwb2ludHMsIGEgc2hvcnQgb25lIGRvZXMgbm90JywgKCkgPT4ge1xuICBjb25zdCBsYXlvdXQgPSBsYXlvdXREYWcoQ0hBSU5fTk9ERVMsIENIQUlOX0VER0VTKTtcbiAgY29uc3QgbG9uZyA9IGxheW91dC5lZGdlcy5maW5kKChlKSA9PiBlLmVkZ2UuZnJvbSA9PT0gJ2EnICYmIGUuZWRnZS50byA9PT0gJ2QnKTtcbiAgY29uc3Qgc2hvcnQgPSBsYXlvdXQuZWRnZXMuZmluZCgoZSkgPT4gZS5lZGdlLmZyb20gPT09ICdhJyAmJiBlLmVkZ2UudG8gPT09ICdiJyk7XG4gIGFzc2VydC5vayhsb25nICE9PSB1bmRlZmluZWQgJiYgc2hvcnQgIT09IHVuZGVmaW5lZCk7XG4gIGFzc2VydC5lcXVhbChzaG9ydC5wb2ludHMubGVuZ3RoLCAyLCAnYSBvbmUtbGF5ZXIgZWRnZSBpcyBhIHN0cmFpZ2h0IHNlZ21lbnQnKTtcbiAgYXNzZXJ0LmVxdWFsKGxvbmcucG9pbnRzLmxlbmd0aCwgNCwgJ2EgdGhyZWUtbGF5ZXIgZWRnZSBiZW5kcyB0d2ljZScpO1xufSk7XG5cbnRlc3QoJ2xheW91dERhZzogYW4gZWRnZSBtZWV0cyB0aGUgZmFjZXMgb2YgaXRzIGJveGVzLCBub3QgdGhlaXIgY2VudGVycycsICgpID0+IHtcbiAgLy8gQW4gYXJyb3doZWFkIGF0IGEgYm94IGNlbnRlciBpcyBhbiBhcnJvd2hlYWQgbm9ib2R5IGNhbiBzZWUuXG4gIGNvbnN0IGxheW91dCA9IGxheW91dERhZyhDSEFJTl9OT0RFUy5zbGljZSgwLCAyKSwgW3sgZnJvbTogJ2EnLCB0bzogJ2InIH1dKTtcbiAgY29uc3QgZSA9IGxheW91dC5lZGdlc1swXTtcbiAgY29uc3QgYSA9IGxheW91dC5ub2Rlc1tlLmZyb21dO1xuICBjb25zdCBiID0gbGF5b3V0Lm5vZGVzW2UudG9dO1xuICBhc3NlcnQuZXF1YWwoZS5wb2ludHNbMF0ueSwgYS55ICsgYS5oLCAnbGVhdmVzIHRoZSBib3R0b20gZmFjZScpO1xuICBhc3NlcnQuZXF1YWwoZS5wb2ludHNbZS5wb2ludHMubGVuZ3RoIC0gMV0ueSwgYi55LCAnYXJyaXZlcyBhdCB0aGUgdG9wIGZhY2UnKTtcbn0pO1xuXG50ZXN0KFwibGF5b3V0RGFnOiAnTFInIHN3YXBzIHRoZSBheGVzIGFuZCBrZWVwcyB0aGUgZGlyZWN0aW9uXCIsICgpID0+IHtcbiAgY29uc3QgdGIgPSBsYXlvdXREYWcoQ0hBSU5fTk9ERVMsIENIQUlOX0VER0VTKTtcbiAgY29uc3QgbHIgPSBsYXlvdXREYWcoQ0hBSU5fTk9ERVMsIENIQUlOX0VER0VTLCB7IG9yaWVudGF0aW9uOiAnTFInIH0pO1xuICBhc3NlcnQuZXF1YWwobHIub3JpZW50YXRpb24sICdMUicpO1xuICBhc3NlcnQub2sodGIuaGVpZ2h0ID4gdGIud2lkdGggfHwgdGIubm9kZXMubGVuZ3RoID09PSAwKTtcbiAgYXNzZXJ0Lm9rKGxyLndpZHRoID4gbHIuaGVpZ2h0KTtcbiAgZm9yIChjb25zdCBlIG9mIGxyLmVkZ2VzKSB7XG4gICAgY29uc3QgZnJvbSA9IGxyLm5vZGVzW2UuZnJvbV07XG4gICAgY29uc3QgdG8gPSBsci5ub2Rlc1tlLnRvXTtcbiAgICBhc3NlcnQub2sodG8ueCA+IGZyb20ueCwgJ2VkZ2VzIHJ1biBsZWZ0IHRvIHJpZ2h0Jyk7XG4gIH1cbiAgY29uc3QgZTAgPSBsci5lZGdlc1swXTtcbiAgY29uc3QgYSA9IGxyLm5vZGVzW2UwLmZyb21dO1xuICBhc3NlcnQuZXF1YWwoZTAucG9pbnRzWzBdLngsIGEueCArIGEudywgJ2xlYXZlcyB0aGUgcmlnaHQgZmFjZScpO1xufSk7XG5cbnRlc3QoJ2xheW91dERhZzogYSBjeWNsZSBpcyBkcmF3biBBTkQgcmVwb3J0ZWQsIG5ldmVyIHF1aWV0bHkgc3RyYWlnaHRlbmVkJywgKCkgPT4ge1xuICBjb25zdCBsYXlvdXQgPSBsYXlvdXREYWcobm9kZXNGcm9tKFsnYScsICdiJywgJ2MnXSksIFtcbiAgICB7IGZyb206ICdhJywgdG86ICdiJyB9LFxuICAgIHsgZnJvbTogJ2InLCB0bzogJ2MnIH0sXG4gICAgeyBmcm9tOiAnYycsIHRvOiAnYScgfSxcbiAgXSk7XG4gIGFzc2VydC5lcXVhbChsYXlvdXQuZWRnZXMubGVuZ3RoLCAzLCAndGhlIGN5Y2xlIGVkZ2UgaXMgc3RpbGwgZHJhd24nKTtcbiAgYXNzZXJ0LmVxdWFsKGxheW91dC5jeWNsZUVkZ2VzLmxlbmd0aCwgMSk7XG4gIGNvbnN0IGN1dCA9IGxheW91dC5lZGdlc1tsYXlvdXQuY3ljbGVFZGdlc1swXV07XG4gIGFzc2VydC5lcXVhbChjdXQucmV2ZXJzZWQsIHRydWUpO1xuICBhc3NlcnQuZGVlcEVxdWFsKHsgZnJvbTogY3V0LmVkZ2UuZnJvbSwgdG86IGN1dC5lZGdlLnRvIH0sIHsgZnJvbTogJ2MnLCB0bzogJ2EnIH0pO1xufSk7XG5cbnRlc3QoJ2xheW91dERhZzogYSByZXZlcnNlZCBlZGdlIGlzIHN0aWxsIHJvdXRlZCBmcm9tIGl0cyBUUlVFIHNvdXJjZScsICgpID0+IHtcbiAgLy8gYHBvaW50c2AgYWx3YXlzIHJ1bnMgc291cmNlIC0+IHRhcmdldCwgc28gYW4gYXJyb3doZWFkIGF0IHRoZSBsYXN0XG4gIC8vIHBvaW50IGFsd2F5cyBtZWFucyB3aGF0IGl0IHNheXMsIGN5Y2xlIG9yIG5vdC5cbiAgY29uc3QgbGF5b3V0ID0gbGF5b3V0RGFnKG5vZGVzRnJvbShbJ2EnLCAnYiddKSwgW1xuICAgIHsgZnJvbTogJ2EnLCB0bzogJ2InIH0sXG4gICAgeyBmcm9tOiAnYicsIHRvOiAnYScgfSxcbiAgXSk7XG4gIGNvbnN0IGJhY2sgPSBsYXlvdXQuZWRnZXMuZmluZCgoZSkgPT4gZS5lZGdlLmZyb20gPT09ICdiJyAmJiBlLmVkZ2UudG8gPT09ICdhJyk7XG4gIGFzc2VydC5vayhiYWNrICE9PSB1bmRlZmluZWQpO1xuICBhc3NlcnQuZXF1YWwoYmFjay5yZXZlcnNlZCwgdHJ1ZSk7XG4gIGNvbnN0IGIgPSBsYXlvdXQubm9kZXNbbGF5b3V0LmJ5SWQuZ2V0KCdiJykgYXMgbnVtYmVyXTtcbiAgY29uc3QgYSA9IGxheW91dC5ub2Rlc1tsYXlvdXQuYnlJZC5nZXQoJ2EnKSBhcyBudW1iZXJdO1xuICBhc3NlcnQuZXF1YWwoYmFjay5wb2ludHNbMF0ueSwgYi55LCAnbGVhdmVzIGIgdXB3YXJkJyk7XG4gIGFzc2VydC5lcXVhbChiYWNrLnBvaW50c1tiYWNrLnBvaW50cy5sZW5ndGggLSAxXS55LCBhLnkgKyBhLmgsICdhcnJpdmVzIHVuZGVyIGEnKTtcbn0pO1xuXG50ZXN0KCdsYXlvdXREYWc6IHJlamVjdGVkIGVkZ2VzIGFuZCBvdmVycnVsZWQgcGlucyByZWFjaCB0aGUgY2FsbGVyJywgKCkgPT4ge1xuICBjb25zdCBsYXlvdXQgPSBsYXlvdXREYWcoW3sgaWQ6ICdhJyB9LCB7IGlkOiAnYicsIGxheWVyOiAwIH1dLCBbXG4gICAgeyBmcm9tOiAnYScsIHRvOiAnYicgfSxcbiAgICB7IGZyb206ICdhJywgdG86ICdub3BlJyB9LFxuICBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChsYXlvdXQucmVqZWN0ZWQubWFwKChyKSA9PiByLnJlYXNvbiksIFsndW5rbm93bi10byddKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChsYXlvdXQuaWdub3JlZFBpbnMsIFsnYiddKTtcbn0pO1xuXG50ZXN0KCdsYXlvdXREYWc6IGJ5SWQgcmVzb2x2ZXMgZXZlcnkgbm9kZScsICgpID0+IHtcbiAgY29uc3QgbGF5b3V0ID0gbGF5b3V0RGFnKENIQUlOX05PREVTLCBDSEFJTl9FREdFUyk7XG4gIGZvciAoY29uc3QgbiBvZiBsYXlvdXQubm9kZXMpIHtcbiAgICBhc3NlcnQuZXF1YWwobGF5b3V0LmJ5SWQuZ2V0KG4ubm9kZS5pZCksIGxheW91dC5ub2Rlcy5pbmRleE9mKG4pKTtcbiAgfVxufSk7XG5cbnRlc3QoJ2xheW91dERhZzogYSBjdXN0b20gc2l6ZU9mIGRyaXZlcyB0aGUgZ2VvbWV0cnknLCAoKSA9PiB7XG4gIGNvbnN0IGxheW91dCA9IGxheW91dERhZyhub2Rlc0Zyb20oWydhJywgJ2InXSksIFt7IGZyb206ICdhJywgdG86ICdiJyB9XSwge1xuICAgIHNpemVPZjogKCkgPT4gKHsgdzogMjAwLCBoOiA1MCB9KSxcbiAgfSk7XG4gIGZvciAoY29uc3QgbiBvZiBsYXlvdXQubm9kZXMpIGFzc2VydC5kZWVwRXF1YWwoW24udywgbi5oXSwgWzIwMCwgNTBdKTtcbn0pO1xuXG50ZXN0KCdsYXlvdXREYWc6IG5vIHR3byBib3hlcyBvbiB0aGUgc2FtZSBsYXllciBvdmVybGFwJywgKCkgPT4ge1xuICBjb25zdCBuYW1lcyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDEyIH0sIChfLCBpKSA9PiBgbiR7aX1gKTtcbiAgY29uc3QgZWRnZXM6IERhZ0VkZ2VbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMTsgaSA8IDEyOyBpKyspIGVkZ2VzLnB1c2goeyBmcm9tOiBgbiR7TWF0aC5mbG9vcigoaSAtIDEpIC8gMyl9YCwgdG86IGBuJHtpfWAgfSk7XG4gIGNvbnN0IGxheW91dCA9IGxheW91dERhZyhub2Rlc0Zyb20obmFtZXMpLCBlZGdlcyk7XG4gIGNvbnN0IGJ5TGF5ZXIgPSBuZXcgTWFwPG51bWJlciwgdHlwZW9mIGxheW91dC5ub2Rlc1tudW1iZXJdW10+KCk7XG4gIGZvciAoY29uc3QgbiBvZiBsYXlvdXQubm9kZXMpIHtcbiAgICBjb25zdCByb3cgPSBieUxheWVyLmdldChuLmxheWVyKSA/PyBbXTtcbiAgICByb3cucHVzaChuKTtcbiAgICBieUxheWVyLnNldChuLmxheWVyLCByb3cpO1xuICB9XG4gIGZvciAoY29uc3Qgcm93IG9mIGJ5TGF5ZXIudmFsdWVzKCkpIHtcbiAgICByb3cuc29ydCgoYSwgYikgPT4gYS54IC0gYi54KTtcbiAgICBmb3IgKGxldCBpID0gMTsgaSA8IHJvdy5sZW5ndGg7IGkrKykge1xuICAgICAgYXNzZXJ0Lm9rKHJvd1tpXS54ID49IHJvd1tpIC0gMV0ueCArIHJvd1tpIC0gMV0udywgYCR7cm93W2ldLm5vZGUuaWR9IGNsZWFycyAke3Jvd1tpIC0gMV0ubm9kZS5pZH1gKTtcbiAgICB9XG4gIH1cbn0pO1xuXG50ZXN0KCdjcml0aWNhbFBhdGhMZW5ndGg6IHRoZSBsb25nZXN0IGRlcGVuZGVuY3kgY2hhaW4sIGluIG5vZGVzJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoY3JpdGljYWxQYXRoTGVuZ3RoKGxheW91dERhZyhDSEFJTl9OT0RFUywgQ0hBSU5fRURHRVMpKSwgNCk7XG4gIGFzc2VydC5lcXVhbChjcml0aWNhbFBhdGhMZW5ndGgobGF5b3V0RGFnKG5vZGVzRnJvbShbJ2EnLCAnYiddKSwgW10pKSwgMSk7XG4gIGFzc2VydC5lcXVhbChjcml0aWNhbFBhdGhMZW5ndGgobGF5b3V0RGFnKFtdLCBbXSkpLCAwKTtcbn0pO1xuXG4vLyAtLSBhbmNob3JQb2ludCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnYW5jaG9yUG9pbnQ6IHRoZSBtaWQtcG9pbnQgb2YgdGhlIGZhY2luZyBlZGdlLCBwZXIgb3JpZW50YXRpb24nLCAoKSA9PiB7XG4gIGNvbnN0IG4gPSB7IG5vZGU6IHsgaWQ6ICdhJyB9LCBpbmRleDogMCwgbGF5ZXI6IDAsIHg6IDEwLCB5OiAyMCwgdzogMTAwLCBoOiA0MCB9O1xuICBhc3NlcnQuZGVlcEVxdWFsKGFuY2hvclBvaW50KG4sICdUQicsICdvdXQnKSwgeyB4OiA2MCwgeTogNjAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYW5jaG9yUG9pbnQobiwgJ1RCJywgJ2luJyksIHsgeDogNjAsIHk6IDIwIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGFuY2hvclBvaW50KG4sICdMUicsICdvdXQnKSwgeyB4OiAxMTAsIHk6IDQwIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGFuY2hvclBvaW50KG4sICdMUicsICdpbicpLCB7IHg6IDEwLCB5OiA0MCB9KTtcbn0pO1xuXG4vLyAtLSBtZWFzdXJlTm9kZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnbWVhc3VyZU5vZGU6IHdpZHRoIHRyYWNrcyB0aGUgbG9uZ2VyIG9mIGxhYmVsIGFuZCBzdWJsYWJlbCcsICgpID0+IHtcbiAgY29uc3Qgc2hvcnQgPSBtZWFzdXJlTm9kZSh7IGlkOiAnYScsIGxhYmVsOiAnaGknIH0pO1xuICBjb25zdCBsb25nID0gbWVhc3VyZU5vZGUoeyBpZDogJ2EnLCBsYWJlbDogJ2hpJywgc3VibGFiZWw6ICdhIG11Y2ggbG9uZ2VyIHNlY29uZCBsaW5lIGhlcmUnIH0pO1xuICBhc3NlcnQub2sobG9uZy53ID4gc2hvcnQudyk7XG4gIGFzc2VydC5vayhsb25nLmggPiBzaG9ydC5oLCAndGhlIHN1YmxhYmVsIGVhcm5zIGl0cyBvd24gbGluZScpO1xufSk7XG5cbnRlc3QoJ21lYXN1cmVOb2RlOiBvbmUgZW5vcm1vdXMgdGl0bGUgY2Fubm90IHNldCB0aGUgd2hvbGUgbGF5b3V0JywgKCkgPT4ge1xuICBjb25zdCBodWdlID0gbWVhc3VyZU5vZGUoeyBpZDogJ2EnLCBsYWJlbDogJ3gnLnJlcGVhdCg1MDApIH0pO1xuICBhc3NlcnQuZXF1YWwoaHVnZS53LCBERUZBVUxUX05PREVfTUFYX1cpO1xufSk7XG5cbnRlc3QoJ21lYXN1cmVOb2RlOiBhIG9uZS1jaGFyYWN0ZXIgbm9kZSBpcyBzdGlsbCBhIGNsaWNrYWJsZSB0YXJnZXQnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChtZWFzdXJlTm9kZSh7IGlkOiAneCcgfSkudywgREVGQVVMVF9OT0RFX01JTl9XKTtcbn0pO1xuXG50ZXN0KCdtZWFzdXJlTm9kZTogdGhlIGlkIHN0YW5kcyBpbiBmb3IgYSBtaXNzaW5nIGxhYmVsJywgKCkgPT4ge1xuICBhc3NlcnQuZGVlcEVxdWFsKG1lYXN1cmVOb2RlKHsgaWQ6ICdzb21lLWlkZW50aWZpZXInIH0pLCBtZWFzdXJlTm9kZSh7IGlkOiAncScsIGxhYmVsOiAnc29tZS1pZGVudGlmaWVyJyB9KSk7XG59KTtcblxuLy8gLS0gVmlld3BvcnQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IFY6IERhZ1ZpZXdwb3J0ID0geyB4OiAzMCwgeTogLTIwLCBzY2FsZTogMiB9O1xuXG50ZXN0KCd3b3JsZFRvU2NyZWVuIC8gc2NyZWVuVG9Xb3JsZCBhcmUgaW52ZXJzZXMnLCAoKSA9PiB7XG4gIGNvbnN0IHAgPSB7IHg6IDEyLjUsIHk6IC03LjI1IH07XG4gIGNvbnN0IGJhY2sgPSBzY3JlZW5Ub1dvcmxkKHdvcmxkVG9TY3JlZW4ocCwgViksIFYpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoYmFjay54IC0gcC54KSA8IDFlLTkgJiYgTWF0aC5hYnMoYmFjay55IC0gcC55KSA8IDFlLTkpO1xufSk7XG5cbnRlc3QoJ3BhblZpZXdwb3J0OiBzaGlmdHMgaW4gc2NyZWVuIHNwYWNlIGFuZCBsZWF2ZXMgdGhlIHNjYWxlIGFsb25lJywgKCkgPT4ge1xuICBhc3NlcnQuZGVlcEVxdWFsKHBhblZpZXdwb3J0KFYsIDEwLCAtNSksIHsgeDogNDAsIHk6IC0yNSwgc2NhbGU6IDIgfSk7XG59KTtcblxudGVzdCgnem9vbVZpZXdwb3J0QXQ6IHRoZSB3b3JsZCBwb2ludCB1bmRlciB0aGUgYW5jaG9yIGRvZXMgbm90IG1vdmUnLCAoKSA9PiB7XG4gIC8vIEFueXRoaW5nIGVsc2UgbWFrZXMgdGhlIHJlYWRlciBjaGFzZSB0aGUgbm9kZSB0aGV5IHpvb21lZCB0b3dhcmQuXG4gIGZvciAoY29uc3QgZmFjdG9yIG9mIFswLjUsIDEuMzcsIDIsIDAuMTNdKSB7XG4gICAgY29uc3QgYmVmb3JlID0gc2NyZWVuVG9Xb3JsZCh7IHg6IDIwMCwgeTogMTQwIH0sIFYpO1xuICAgIGNvbnN0IG5leHQgPSB6b29tVmlld3BvcnRBdChWLCAyMDAsIDE0MCwgZmFjdG9yKTtcbiAgICBjb25zdCBhZnRlciA9IHNjcmVlblRvV29ybGQoeyB4OiAyMDAsIHk6IDE0MCB9LCBuZXh0KTtcbiAgICBhc3NlcnQub2soTWF0aC5hYnMoYWZ0ZXIueCAtIGJlZm9yZS54KSA8IDFlLTYsIGB4IGhlbGQgYXQgZmFjdG9yICR7ZmFjdG9yfWApO1xuICAgIGFzc2VydC5vayhNYXRoLmFicyhhZnRlci55IC0gYmVmb3JlLnkpIDwgMWUtNiwgYHkgaGVsZCBhdCBmYWN0b3IgJHtmYWN0b3J9YCk7XG4gIH1cbn0pO1xuXG50ZXN0KCd6b29tVmlld3BvcnRBdDogY2xhbXBzLCBhbmQgYSBjbGFtcGVkIHpvb20gaXMgYSBuby1vcCByYXRoZXIgdGhhbiBhIGRyaWZ0JywgKCkgPT4ge1xuICBjb25zdCBtYXhlZCA9IHpvb21WaWV3cG9ydEF0KHsgeDogMCwgeTogMCwgc2NhbGU6IE1BWF9TQ0FMRSB9LCA1MCwgNTAsIDQpO1xuICBhc3NlcnQuZXF1YWwobWF4ZWQuc2NhbGUsIE1BWF9TQ0FMRSk7XG4gIGFzc2VydC5kZWVwRXF1YWwobWF4ZWQsIHsgeDogMCwgeTogMCwgc2NhbGU6IE1BWF9TQ0FMRSB9LCAnbm8gcGFuIHNuZWFrcyBpbiBhdCB0aGUgY2xhbXAnKTtcbiAgYXNzZXJ0LmVxdWFsKHpvb21WaWV3cG9ydEF0KHsgeDogMCwgeTogMCwgc2NhbGU6IE1JTl9TQ0FMRSB9LCA1MCwgNTAsIDAuMSkuc2NhbGUsIE1JTl9TQ0FMRSk7XG59KTtcblxudGVzdCgnem9vbUZhY3RvckZvcldoZWVsOiBzY3JvbGwgdXAgem9vbXMgaW4sIGFuZCB0aGUgcmF0ZSBpcyBhIGNsZWFuIGRvdWJsaW5nJywgKCkgPT4ge1xuICBhc3NlcnQub2soem9vbUZhY3RvckZvcldoZWVsKC0yNjApID4gMSk7XG4gIGFzc2VydC5vayh6b29tRmFjdG9yRm9yV2hlZWwoMjYwKSA8IDEpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoem9vbUZhY3RvckZvcldoZWVsKC0yNjApIC0gMikgPCAxZS05KTtcbiAgYXNzZXJ0LmVxdWFsKHpvb21GYWN0b3JGb3JXaGVlbCgwKSwgMSk7XG59KTtcblxudGVzdCgnZml0Vmlld3BvcnQ6IGNlbnRlcnMgdGhlIHJlY3QgaW4gdGhlIGJveCcsICgpID0+IHtcbiAgY29uc3QgdiA9IGZpdFZpZXdwb3J0KHsgeDogMCwgeTogMCwgdzogMTAwLCBoOiAxMDAgfSwgNDAwLCAyMDAsIDIwKTtcbiAgYXNzZXJ0LmVxdWFsKHYuc2NhbGUsIDEuNiwgJ3RoZSB0aWdodGVyIGF4aXMgd2lucycpO1xuICBjb25zdCB0bCA9IHdvcmxkVG9TY3JlZW4oeyB4OiAwLCB5OiAwIH0sIHYpO1xuICBjb25zdCBiciA9IHdvcmxkVG9TY3JlZW4oeyB4OiAxMDAsIHk6IDEwMCB9LCB2KTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKCh0bC54ICsgYnIueCkgLyAyIC0gMjAwKSA8IDFlLTYsICdob3Jpem9udGFsbHkgY2VudGVyZWQnKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKCh0bC55ICsgYnIueSkgLyAyIC0gMTAwKSA8IDFlLTYsICd2ZXJ0aWNhbGx5IGNlbnRlcmVkJyk7XG59KTtcblxudGVzdCgnZml0Vmlld3BvcnQ6IGEgZGVnZW5lcmF0ZSByZWN0IHN0aWxsIHlpZWxkcyBhIHVzYWJsZSB2aWV3cG9ydCcsICgpID0+IHtcbiAgY29uc3QgdiA9IGZpdFZpZXdwb3J0KHsgeDogMCwgeTogMCwgdzogMCwgaDogMCB9LCA0MDAsIDMwMCk7XG4gIGFzc2VydC5vayhOdW1iZXIuaXNGaW5pdGUodi54KSAmJiBOdW1iZXIuaXNGaW5pdGUodi55KSk7XG4gIGFzc2VydC5vayh2LnNjYWxlID4gMCAmJiB2LnNjYWxlIDw9IE1BWF9TQ0FMRSk7XG59KTtcblxudGVzdCgnZml0Vmlld3BvcnQ6IG9iZXlzIHRoZSBzY2FsZSBjbGFtcHMgb24gYSBodWdlIGdyYXBoJywgKCkgPT4ge1xuICBjb25zdCB2ID0gZml0Vmlld3BvcnQoeyB4OiAwLCB5OiAwLCB3OiAxMDAwMDAsIGg6IDEwMDAwMCB9LCA0MDAsIDMwMCk7XG4gIGFzc2VydC5lcXVhbCh2LnNjYWxlLCBNSU5fU0NBTEUpO1xufSk7XG5cbnRlc3QoJ2NsYW1wVmlld3BvcnQ6IGEgcGFuIHRoYXQga2VlcHMgY29udGVudCBvbiBzY3JlZW4gaXMgdW50b3VjaGVkJywgKCkgPT4ge1xuICBjb25zdCBib3VuZHMgPSB7IHg6IDAsIHk6IDAsIHc6IDUwMCwgaDogNDAwIH07XG4gIGNvbnN0IHYgPSB7IHg6IDEwLCB5OiAxMCwgc2NhbGU6IDEgfTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChjbGFtcFZpZXdwb3J0KHYsIGJvdW5kcywgODAwLCA2MDAsIDYwKSwgdik7XG59KTtcblxudGVzdCgnY2xhbXBWaWV3cG9ydDogY29udGVudCBmbGlja2VkIGludG8gdGhlIHZvaWQgaXMgcHVsbGVkIGJhY2sgdG8gdGhlIG1hcmdpbicsICgpID0+IHtcbiAgY29uc3QgYm91bmRzID0geyB4OiAwLCB5OiAwLCB3OiA1MDAsIGg6IDQwMCB9O1xuICBjb25zdCBmYXIgPSBjbGFtcFZpZXdwb3J0KHsgeDogOTk5OTksIHk6IC05OTk5OSwgc2NhbGU6IDEgfSwgYm91bmRzLCA4MDAsIDYwMCwgNjApO1xuICBhc3NlcnQuZXF1YWwoZmFyLngsIDc0MCwgJ2xlZnQgZWRnZSBzdG9wcyBhdCB3aWR0aCAtIG1hcmdpbicpO1xuICBhc3NlcnQuZXF1YWwoZmFyLnksIDYwIC0gNDAwLCAnYm90dG9tIGVkZ2Ugc3RvcHMgYXQgdGhlIG1hcmdpbicpO1xuICBhc3NlcnQuZXF1YWwoZmFyLnNjYWxlLCAxLCAnY2xhbXBpbmcgbmV2ZXIgY2hhbmdlcyB0aGUgem9vbScpO1xufSk7XG5cbi8vIC0tIEN1bGxpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCd2aXNpYmxlV29ybGRSZWN0OiB0aGUgd29ybGQgYm94IGEgdmlld3BvcnQgc2hvd3MnLCAoKSA9PiB7XG4gIGNvbnN0IHIgPSB2aXNpYmxlV29ybGRSZWN0KHsgeDogMCwgeTogMCwgc2NhbGU6IDIgfSwgNDAwLCAyMDApO1xuICBhc3NlcnQuZGVlcEVxdWFsKHIsIHsgeDogMCwgeTogMCwgdzogMjAwLCBoOiAxMDAgfSk7XG59KTtcblxudGVzdCgncmVjdHNPdmVybGFwOiB0b3VjaGluZyBjb3VudHMsIHNlcGFyYXRlZCBkb2VzIG5vdCcsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKHJlY3RzT3ZlcmxhcCh7IHg6IDAsIHk6IDAsIHc6IDEwLCBoOiAxMCB9LCB7IHg6IDEwLCB5OiAxMCwgdzogNSwgaDogNSB9KSwgdHJ1ZSk7XG4gIGFzc2VydC5lcXVhbChyZWN0c092ZXJsYXAoeyB4OiAwLCB5OiAwLCB3OiAxMCwgaDogMTAgfSwgeyB4OiAxMSwgeTogMCwgdzogNSwgaDogNSB9KSwgZmFsc2UpO1xufSk7XG5cbnRlc3QoJ3Zpc2libGVOb2RlcyAvIHZpc2libGVFZGdlczogb2ZmLXNjcmVlbiBjb250ZW50IGlzIGN1bGxlZCwgb24tc2NyZWVuIGtlcHQnLCAoKSA9PiB7XG4gIGNvbnN0IGxheW91dCA9IGxheW91dERhZyhDSEFJTl9OT0RFUywgQ0hBSU5fRURHRVMpO1xuICBjb25zdCBhbGwgPSBsYXlvdXRCb3VuZHMobGF5b3V0KTtcbiAgYXNzZXJ0LmVxdWFsKHZpc2libGVOb2RlcyhsYXlvdXQsIGFsbCkubGVuZ3RoLCBsYXlvdXQubm9kZXMubGVuZ3RoKTtcbiAgYXNzZXJ0LmVxdWFsKHZpc2libGVFZGdlcyhsYXlvdXQsIGFsbCkubGVuZ3RoLCBsYXlvdXQuZWRnZXMubGVuZ3RoKTtcbiAgY29uc3QgZmFyID0geyB4OiAxZTYsIHk6IDFlNiwgdzogMTAsIGg6IDEwIH07XG4gIGFzc2VydC5kZWVwRXF1YWwodmlzaWJsZU5vZGVzKGxheW91dCwgZmFyKSwgW10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKHZpc2libGVFZGdlcyhsYXlvdXQsIGZhciksIFtdKTtcbn0pO1xuXG50ZXN0KCd2aXNpYmxlRWRnZXM6IGEgbG9uZyBlZGdlIGNyb3NzaW5nIHRoZSB2aWV3IGlzIGtlcHQgZXZlbiB3aXRoIGJvdGggZW5kcyBvdXRzaWRlJywgKCkgPT4ge1xuICBjb25zdCBsYXlvdXQgPSBsYXlvdXREYWcoQ0hBSU5fTk9ERVMsIENIQUlOX0VER0VTKTtcbiAgY29uc3QgbG9uZyA9IGxheW91dC5lZGdlcy5maW5kSW5kZXgoKGUpID0+IGUuZWRnZS5mcm9tID09PSAnYScgJiYgZS5lZGdlLnRvID09PSAnZCcpO1xuICBjb25zdCBwdHMgPSBsYXlvdXQuZWRnZXNbbG9uZ10ucG9pbnRzO1xuICBjb25zdCBtaWQgPSBwdHNbTWF0aC5mbG9vcihwdHMubGVuZ3RoIC8gMildO1xuICBjb25zdCBzbGl2ZXIgPSB7IHg6IG1pZC54IC0gMiwgeTogbWlkLnkgLSAyLCB3OiA0LCBoOiA0IH07XG4gIGFzc2VydC5vayh2aXNpYmxlRWRnZXMobGF5b3V0LCBzbGl2ZXIpLmluY2x1ZGVzKGxvbmcpKTtcbn0pO1xuXG4vLyAtLSBIaXQgdGVzdHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnaGl0VGVzdE5vZGVzOiBpbnNpZGUgaGl0cywgb3V0c2lkZSBtaXNzZXMsIGVkZ2VzIGFyZSBpbmNsdXNpdmUnLCAoKSA9PiB7XG4gIGNvbnN0IGxheW91dCA9IGxheW91dERhZyhDSEFJTl9OT0RFUywgQ0hBSU5fRURHRVMpO1xuICBjb25zdCBuID0gbGF5b3V0Lm5vZGVzWzBdO1xuICBhc3NlcnQuZXF1YWwoaGl0VGVzdE5vZGVzKGxheW91dCwgbi54ICsgbi53IC8gMiwgbi55ICsgbi5oIC8gMiksIDApO1xuICBhc3NlcnQuZXF1YWwoaGl0VGVzdE5vZGVzKGxheW91dCwgbi54LCBuLnkpLCAwLCAndGhlIHRvcC1sZWZ0IGNvcm5lciBjb3VudHMnKTtcbiAgYXNzZXJ0LmVxdWFsKGhpdFRlc3ROb2RlcyhsYXlvdXQsIC0xMDAwLCAtMTAwMCksIC0xKTtcbn0pO1xuXG50ZXN0KCdoaXRUZXN0RWRnZXM6IHRoZSBORUFSRVNUIGVkZ2Ugd2lucywgbm90IHRoZSBmaXJzdCBvbmUgd2l0aGluIHRvbGVyYW5jZScsICgpID0+IHtcbiAgLy8gV2l0aCBzZXZlcmFsIGxpbmVzIGNvbnZlcmdpbmcgb24gYSBib3gsIFwidGhlIEkgYW0gcG9pbnRpbmcgYXRcIiBpcyB0aGVcbiAgLy8gY2xvc2VzdCBvbmUgLS0gYW5kIHRoZSBhbnN3ZXIgbXVzdCBub3QgZGVwZW5kIG9uIGVkZ2Ugb3JkZXIuXG4gIGNvbnN0IGxheW91dCA9IGxheW91dERhZyhub2Rlc0Zyb20oWydhJywgJ2InLCAndCddKSwgW1xuICAgIHsgZnJvbTogJ2EnLCB0bzogJ3QnIH0sXG4gICAgeyBmcm9tOiAnYicsIHRvOiAndCcgfSxcbiAgXSk7XG4gIGNvbnN0IG1pZE9mID0gKGk6IG51bWJlcik6IHsgeDogbnVtYmVyOyB5OiBudW1iZXIgfSA9PiB7XG4gICAgY29uc3QgcCA9IGxheW91dC5lZGdlc1tpXS5wb2ludHM7XG4gICAgcmV0dXJuIHsgeDogKHBbMF0ueCArIHBbMV0ueCkgLyAyLCB5OiAocFswXS55ICsgcFsxXS55KSAvIDIgfTtcbiAgfTtcbiAgY29uc3QgbTAgPSBtaWRPZigwKTtcbiAgY29uc3QgbTEgPSBtaWRPZigxKTtcbiAgYXNzZXJ0LmVxdWFsKGhpdFRlc3RFZGdlcyhsYXlvdXQsIG0wLngsIG0wLnksIDYpLCAwKTtcbiAgLy8gU2l0dGluZyBvbiB0aGUgU0VDT05EIGVkZ2UgbXVzdCByZXR1cm4gdGhlIHNlY29uZCBlZGdlLlxuICBjb25zdCB3aWRlID0gTWF0aC5oeXBvdChtMS54IC0gbTAueCwgbTEueSAtIG0wLnkpICsgMTA7XG4gIGFzc2VydC5lcXVhbChoaXRUZXN0RWRnZXMobGF5b3V0LCBtMS54LCBtMS55LCB3aWRlKSwgMSk7XG4gIGFzc2VydC5lcXVhbChoaXRUZXN0RWRnZXMobGF5b3V0LCBtMC54LCBtMC55ICsgMTAwMDAwLCA2KSwgLTEsICdiZXlvbmQgdG9sZXJhbmNlIGlzIGEgbWlzcycpO1xufSk7XG5cbnRlc3QoJ25vZGVSZWN0OiBhIHBsYWNlZCBub2RlIGFzIGEgaGl0IHJlY3RhbmdsZScsICgpID0+IHtcbiAgY29uc3QgbGF5b3V0ID0gbGF5b3V0RGFnKG5vZGVzRnJvbShbJ2EnXSksIFtdKTtcbiAgY29uc3QgbiA9IGxheW91dC5ub2Rlc1swXTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChub2RlUmVjdChuKSwgeyB4OiBuLngsIHk6IG4ueSwgdzogbi53LCBoOiBuLmggfSk7XG59KTtcblxuLy8gLS0gUmVhY2hhYmlsaXR5IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ25laWdoYm91cmhvb2Q6IGV2ZXJ5dGhpbmcgdXAtc3RyZWFtIGFuZCBkb3duLXN0cmVhbSwgdHJhbnNpdGl2ZWx5JywgKCkgPT4ge1xuICAvLyAgIGEgLT4gYiAtPiBjIC0+IGQsIGFuZCBhIHNpZGUgYnJhbmNoIGIgLT4gZS5cbiAgY29uc3QgbGF5b3V0ID0gbGF5b3V0RGFnKG5vZGVzRnJvbShbJ2EnLCAnYicsICdjJywgJ2QnLCAnZSddKSwgW1xuICAgIHsgZnJvbTogJ2EnLCB0bzogJ2InIH0sXG4gICAgeyBmcm9tOiAnYicsIHRvOiAnYycgfSxcbiAgICB7IGZyb206ICdjJywgdG86ICdkJyB9LFxuICAgIHsgZnJvbTogJ2InLCB0bzogJ2UnIH0sXG4gIF0pO1xuICBjb25zdCBpZHggPSAoaWQ6IHN0cmluZyk6IG51bWJlciA9PiBsYXlvdXQuYnlJZC5nZXQoaWQpIGFzIG51bWJlcjtcbiAgY29uc3QgbiA9IG5laWdoYm91cmhvb2QobGF5b3V0LCBpZHgoJ2MnKSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoWy4uLm4uYW5jZXN0b3JzXS5tYXAoKGkpID0+IGxheW91dC5ub2Rlc1tpXS5ub2RlLmlkKS5zb3J0KCksIFsnYScsICdiJ10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKFsuLi5uLmRlc2NlbmRhbnRzXS5tYXAoKGkpID0+IGxheW91dC5ub2Rlc1tpXS5ub2RlLmlkKS5zb3J0KCksIFsnZCddKTtcbiAgYXNzZXJ0LmVxdWFsKG4uYW5jZXN0b3JzLmhhcyhpZHgoJ2UnKSksIGZhbHNlLCAnYSBzaWJsaW5nIGJyYW5jaCBpcyBub3QgYSBkZXBlbmRlbmN5Jyk7XG59KTtcblxudGVzdCgnbmVpZ2hib3VyaG9vZDogYW4gaXNvbGF0ZWQgbm9kZSBoYXMgYW4gZW1wdHkgbmVpZ2hib3VyaG9vZCcsICgpID0+IHtcbiAgY29uc3QgbGF5b3V0ID0gbGF5b3V0RGFnKG5vZGVzRnJvbShbJ2EnLCAnYiddKSwgW10pO1xuICBjb25zdCBuID0gbmVpZ2hib3VyaG9vZChsYXlvdXQsIDApO1xuICBhc3NlcnQuZXF1YWwobi5hbmNlc3RvcnMuc2l6ZSwgMCk7XG4gIGFzc2VydC5lcXVhbChuLmRlc2NlbmRhbnRzLnNpemUsIDApO1xuICBhc3NlcnQuZXF1YWwobi5lZGdlcy5zaXplLCAwKTtcbn0pO1xuXG50ZXN0KCduZWlnaGJvdXJob29kOiB0aGUgZWRnZSBzZXQgaG9sZHMgdGhlIGNvbm5lY3RpbmcgZWRnZXMgYW5kIG5vdGhpbmcgZWxzZScsICgpID0+IHtcbiAgY29uc3QgbGF5b3V0ID0gbGF5b3V0RGFnKG5vZGVzRnJvbShbJ2EnLCAnYicsICdjJywgJ3gnLCAneSddKSwgW1xuICAgIHsgZnJvbTogJ2EnLCB0bzogJ2InIH0sXG4gICAgeyBmcm9tOiAnYicsIHRvOiAnYycgfSxcbiAgICB7IGZyb206ICd4JywgdG86ICd5JyB9LFxuICBdKTtcbiAgY29uc3QgbiA9IG5laWdoYm91cmhvb2QobGF5b3V0LCBsYXlvdXQuYnlJZC5nZXQoJ2InKSBhcyBudW1iZXIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKFxuICAgIFsuLi5uLmVkZ2VzXS5tYXAoKGkpID0+IGAke2xheW91dC5lZGdlc1tpXS5lZGdlLmZyb219LT4ke2xheW91dC5lZGdlc1tpXS5lZGdlLnRvfWApLnNvcnQoKSxcbiAgICBbJ2EtPmInLCAnYi0+YyddLFxuICAgICd0aGUgdW5yZWxhdGVkIGNvbXBvbmVudCBjb250cmlidXRlcyBub3RoaW5nJyxcbiAgKTtcbn0pO1xuXG50ZXN0KCduZWlnaGJvdXJob29kOiBmb2xsb3dzIHRoZSBUUlVFIGRpcmVjdGlvbiBvZiBhIGN5Y2xlLXJldmVyc2VkIGVkZ2UnLCAoKSA9PiB7XG4gIC8vIFRoZSBoaWdobGlnaHQgaGFzIHRvIHJlZmxlY3QgdGhlIGRlcGVuZGVuY2llcywgbm90IHRoZSBkcmF3aW5nLlxuICBjb25zdCBsYXlvdXQgPSBsYXlvdXREYWcobm9kZXNGcm9tKFsnYScsICdiJywgJ2MnXSksIFtcbiAgICB7IGZyb206ICdhJywgdG86ICdiJyB9LFxuICAgIHsgZnJvbTogJ2InLCB0bzogJ2MnIH0sXG4gICAgeyBmcm9tOiAnYycsIHRvOiAnYScgfSxcbiAgXSk7XG4gIGFzc2VydC5lcXVhbChsYXlvdXQuY3ljbGVFZGdlcy5sZW5ndGgsIDEpO1xuICBjb25zdCBuID0gbmVpZ2hib3VyaG9vZChsYXlvdXQsIGxheW91dC5ieUlkLmdldCgnYScpIGFzIG51bWJlcik7XG4gIC8vIEV2ZXJ5IG5vZGUgaW4gYSBjeWNsZSBkZXBlbmRzIG9uIGV2ZXJ5IG90aGVyLCBib3RoIHdheXMgcm91bmQuXG4gIGFzc2VydC5lcXVhbChuLmFuY2VzdG9ycy5zaXplLCAyKTtcbiAgYXNzZXJ0LmVxdWFsKG4uZGVzY2VuZGFudHMuc2l6ZSwgMik7XG59KTtcblxuLy8gLS0gSHVlcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ25vZGVIdWU6IHN0YWJsZSwgaW4gcmFuZ2UsIGFuZCBkcml2ZW4gYnkgY2F0ZWdvcnkgd2hlbiB0aGVyZSBpcyBvbmUnLCAoKSA9PiB7XG4gIGNvbnN0IGEgPSB7IGlkOiAneCcsIGNhdGVnb3J5OiAnYnVpbGQnIH07XG4gIGNvbnN0IGIgPSB7IGlkOiAneScsIGNhdGVnb3J5OiAnYnVpbGQnIH07XG4gIGFzc2VydC5lcXVhbChub2RlSHVlKGEpLCBub2RlSHVlKGIpLCAnb25lIGNhdGVnb3J5LCBvbmUgaHVlJyk7XG4gIGFzc2VydC5ub3RFcXVhbChub2RlSHVlKGEpLCBub2RlSHVlKHsgaWQ6ICd4JywgY2F0ZWdvcnk6ICdkZXBsb3knIH0pKTtcbiAgZm9yIChjb25zdCBpZCBvZiBbJ2EnLCAnYicsICd6enonLCAnJ10pIHtcbiAgICBjb25zdCBoID0gbm9kZUh1ZSh7IGlkIH0pO1xuICAgIGFzc2VydC5vayhoID49IDAgJiYgaCA8IDM2MCwgYCR7aH0gaW4gcmFuZ2VgKTtcbiAgICBhc3NlcnQuZXF1YWwoaCwgbm9kZUh1ZSh7IGlkIH0pLCAnc3RhYmxlJyk7XG4gIH1cbn0pO1xuXG50ZXN0KCdub2RlSHVlOiBhbiB1bmNhdGVnb3JpemVkIGdyYXBoIGlzIHN0aWxsIG11bHRpLWNvbG9yZWQnLCAoKSA9PiB7XG4gIC8vIEZhbGxpbmcgYmFjayB0byB0aGUgaWQgYmVhdHMgb25lIHdhbGwgb2YgdGhlIHNhbWUgYmx1ZS5cbiAgY29uc3QgaHVlcyA9IG5ldyBTZXQoWydhJywgJ2InLCAnYycsICdkJywgJ2UnXS5tYXAoKGlkKSA9PiBub2RlSHVlKHsgaWQgfSkpKTtcbiAgYXNzZXJ0Lm9rKGh1ZXMuc2l6ZSA+PSA0LCBgJHtodWVzLnNpemV9IGRpc3RpbmN0IGh1ZXMgZnJvbSA1IGlkc2ApO1xufSk7XG5cbi8vIC0tIEEgbGFyZ2VyIGdyYXBoLCBhcyBhIHNtb2tlIHRlc3QgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdsYXlvdXREYWc6IGEgMjAwLW5vZGUgZ3JhcGggbGF5cyBvdXQgd2l0aCBubyBvdmVybGFwcyBhbmQgbm8gbG9zdCBub2RlcycsICgpID0+IHtcbiAgY29uc3QgbiA9IDIwMDtcbiAgY29uc3Qgbm9kZXMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiBuIH0sIChfLCBpKSA9PiAoeyBpZDogYG4ke2l9YCwgY2F0ZWdvcnk6IGBjJHtpICUgN31gIH0pKTtcbiAgY29uc3QgZWRnZXM6IERhZ0VkZ2VbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMTsgaSA8IG47IGkrKykge1xuICAgIGVkZ2VzLnB1c2goeyBmcm9tOiBgbiR7TWF0aC5mbG9vcihpIC8gMyl9YCwgdG86IGBuJHtpfWAgfSk7XG4gICAgaWYgKGkgJSAxMSA9PT0gMCkgZWRnZXMucHVzaCh7IGZyb206IGBuJHtpICUgMTd9YCwgdG86IGBuJHtpfWAgfSk7XG4gIH1cbiAgY29uc3QgbGF5b3V0ID0gbGF5b3V0RGFnKG5vZGVzLCBlZGdlcyk7XG4gIGFzc2VydC5lcXVhbChsYXlvdXQubm9kZXMubGVuZ3RoLCBuLCAnZXZlcnkgbm9kZSBpcyBwbGFjZWQnKTtcbiAgYXNzZXJ0LmVxdWFsKGxheW91dC5lZGdlcy5sZW5ndGggKyBsYXlvdXQucmVqZWN0ZWQubGVuZ3RoLCBlZGdlcy5sZW5ndGgsICdldmVyeSBlZGdlIGlzIGRyYXduIG9yIHJlcG9ydGVkJyk7XG4gIGZvciAoY29uc3QgZSBvZiBsYXlvdXQuZWRnZXMpIHtcbiAgICBpZiAoZS5yZXZlcnNlZCkgY29udGludWU7XG4gICAgYXNzZXJ0Lm9rKGxheW91dC5ub2Rlc1tlLnRvXS5sYXllciA+IGxheW91dC5ub2Rlc1tlLmZyb21dLmxheWVyKTtcbiAgfVxuICBhc3NlcnQub2sobGF5b3V0LndpZHRoID4gMCAmJiBsYXlvdXQuaGVpZ2h0ID4gMCk7XG59KTtcbiIsICIvKiogRGV0ZXJtaW5pc3RpYyBjYXRlZ29yeSBjb2xvcnMsIHRoZSB1bmlmb3JtIGRpbSB0cmFuc2Zvcm0uICovXG5cbi8qKiBGTlYtMWEgMzItYml0IGhhc2ggKHN0YWJsZSBhY3Jvc3Mgc2Vzc2lvbnMvcGxhdGZvcm1zKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoYXNoU3RyaW5nKHM6IHN0cmluZyk6IG51bWJlciB7XG4gIGxldCBoID0gMHg4MTFjOWRjNTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzLmxlbmd0aDsgaSsrKSB7XG4gICAgaCBePSBzLmNoYXJDb2RlQXQoaSk7XG4gICAgaCA9IE1hdGguaW11bChoLCAweDAxMDAwMTkzKTtcbiAgfVxuICByZXR1cm4gaCA+Pj4gMDtcbn1cblxuLyoqIFN0YWJsZSBjYXRlZ29yeSBcdTIxOTIgaHVlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhdGVnb3J5SHVlKGNhdGVnb3J5OiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCBnID0gKGhhc2hTdHJpbmcoY2F0ZWdvcnkpICogMC42MTgwMzM5ODg3NSkgJSAxO1xuICByZXR1cm4gTWF0aC5mbG9vcihnICogMzYwKTtcbn1cblxuLyoqIFRoZSBzYWx0IGNhdGVnb3J5Sml0dGVyIGhhc2hlcyBhZnRlciB0aGUgY2F0ZWdvcnkgbmFtZS4gKi9cbmNvbnN0IFRPTkVfU0FMVCA9IGAke1N0cmluZy5mcm9tQ2hhckNvZGUoMCl9dG9uZWA7XG5cbi8qICovXG5leHBvcnQgZnVuY3Rpb24gY2F0ZWdvcnlKaXR0ZXIoY2F0ZWdvcnk6IHN0cmluZyk6IHsgZGw6IG51bWJlcjsgZGM6IG51bWJlciB9IHtcbiAgY29uc3QgaCA9IGhhc2hTdHJpbmcoY2F0ZWdvcnkgKyBUT05FX1NBTFQpO1xuICByZXR1cm4ge1xuICAgIGRsOiAoKGggJiAweGZmKSAvIDI1NSAtIDAuNSkgKiAwLjEsXG4gICAgZGM6ICgoKGggPj4+IDgpICYgMHhmZikgLyAyNTUgLSAwLjUpICogMC4wNCxcbiAgfTtcbn1cblxuLyoqIE9wdGlvbnMgZm9yIGNhdGVnb3J5Q29sb3IuICovXG5leHBvcnQgaW50ZXJmYWNlIENhdGVnb3J5Q29sb3JPcHRpb25zIHtcbiAgLyoqICdva2xjaCcgKHBlcmNlcHR1YWxseSBldmVuIGxpZ2h0bmVzcyBcdTIwMTQgcHJlZmVycmVkKSBvciAnaHNsJyBmYWxsYmFjay4gKi9cbiAgbW9kZT86ICdva2xjaCcgfCAnaHNsJztcbiAgLyogKi9cbiAgbGlnaHRuZXNzPzogbnVtYmVyO1xuICAvKiAqL1xuICBjaHJvbWE/OiBudW1iZXI7XG4gIC8qICovXG4gIGFscGhhPzogbnVtYmVyO1xufVxuXG4vKipcbiAqIENTUyBjb2xvciBmb3IgYSBjYXRlZ29yeSBodWUuIG9rbGNoIGtlZXBzIHBlcmNlaXZlZCBsaWdodG5lc3MgZXZlbiBhY3Jvc3NcbiAqIGh1ZXMgKGxhYmVsIHRleHQgc3RheXMgcmVhZGFibGUgb24gZXZlcnkgY2F0ZWdvcnkpOyB0aGUgaHNsIGZhbGxiYWNrXG4gKiBhcHByb3hpbWF0ZXMgaXQgZm9yIGVuZ2luZXMgd2l0aG91dCBva2xjaCBzdXBwb3J0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2F0ZWdvcnlDb2xvcihodWU6IG51bWJlciwgb3B0czogQ2F0ZWdvcnlDb2xvck9wdGlvbnMgPSB7fSk6IHN0cmluZyB7XG4gIGNvbnN0IGwgPSBvcHRzLmxpZ2h0bmVzcyA/PyAwLjYyO1xuICBjb25zdCBjID0gb3B0cy5jaHJvbWEgPz8gMC4xMTtcbiAgY29uc3QgYSA9IG9wdHMuYWxwaGEgPz8gMTtcbiAgaWYgKG9wdHMubW9kZSA9PT0gJ2hzbCcpIHtcbiAgICBjb25zdCBzID0gTWF0aC5yb3VuZChNYXRoLm1pbigxLCBjIC8gMC4zMikgKiAxMDApO1xuICAgIGNvbnN0IGxsID0gTWF0aC5yb3VuZChsICogODgpO1xuICAgIHJldHVybiBhID49IDEgPyBgaHNsKCR7aHVlfSwgJHtzfSUsICR7bGx9JSlgIDogYGhzbGEoJHtodWV9LCAke3N9JSwgJHtsbH0lLCAke3JvdW5kMyhhKX0pYDtcbiAgfVxuICByZXR1cm4gYSA+PSAxID8gYG9rbGNoKCR7cm91bmQzKGwpfSAke3JvdW5kMyhjKX0gJHtodWV9KWAgOiBgb2tsY2goJHtyb3VuZDMobCl9ICR7cm91bmQzKGMpfSAke2h1ZX0gLyAke3JvdW5kMyhhKX0pYDtcbn1cblxuZnVuY3Rpb24gcm91bmQzKG46IG51bWJlcik6IG51bWJlciB7XG4gIHJldHVybiBNYXRoLnJvdW5kKG4gKiAxMDAwKSAvIDEwMDA7XG59XG5cbi8vIC0tIERpbSB0cmFuc2Zvcm0gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiAqL1xuZnVuY3Rpb24gcGFyc2VDb2xvcihjb2xvcjogc3RyaW5nKTogeyByOiBudW1iZXI7IGc6IG51bWJlcjsgYjogbnVtYmVyOyBhOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBjID0gY29sb3IudHJpbSgpO1xuICBpZiAoYy5zdGFydHNXaXRoKCcjJykpIHtcbiAgICBjb25zdCBoZXggPSBjLnNsaWNlKDEpO1xuICAgIGNvbnN0IG4gPSBoZXgubGVuZ3RoO1xuICAgIGlmIChuID09PSAzIHx8IG4gPT09IDQpIHtcbiAgICAgIGNvbnN0IHYgPSBoZXguc3BsaXQoJycpLm1hcCgoY2gpID0+IHBhcnNlSW50KGNoICsgY2gsIDE2KSk7XG4gICAgICBpZiAodi5zb21lKE51bWJlci5pc05hTikpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgcjogdlswXSwgZzogdlsxXSwgYjogdlsyXSwgYTogbiA9PT0gNCA/IHZbM10gLyAyNTUgOiAxIH07XG4gICAgfVxuICAgIGlmIChuID09PSA2IHx8IG4gPT09IDgpIHtcbiAgICAgIGNvbnN0IHYgPSBbMCwgMiwgNCwgNl0uc2xpY2UoMCwgbiAvIDIpLm1hcCgoaSkgPT4gcGFyc2VJbnQoaGV4LnNsaWNlKGksIGkgKyAyKSwgMTYpKTtcbiAgICAgIGlmICh2LnNvbWUoTnVtYmVyLmlzTmFOKSkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyByOiB2WzBdLCBnOiB2WzFdLCBiOiB2WzJdLCBhOiBuID09PSA4ID8gdlszXSAvIDI1NSA6IDEgfTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgY29uc3QgZm4gPSBjLm1hdGNoKC9eKHJnYmE/fGhzbGE/fG9rbGNoKVxcKChbXildKylcXCkkL2kpO1xuICBpZiAoIWZuKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgbmFtZSA9IGZuWzFdLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IHBhcnRzID0gZm5bMl0uc3BsaXQoL1tcXHMsL10rLykuZmlsdGVyKChwKSA9PiBwICE9PSAnJyk7XG4gIGlmIChwYXJ0cy5sZW5ndGggPCAzKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgbnVtID0gKHM6IHN0cmluZyk6IG51bWJlciA9PiBwYXJzZUZsb2F0KHMpO1xuICBjb25zdCBhbHBoYSA9IHBhcnRzLmxlbmd0aCA+PSA0ID8gKHBhcnRzWzNdLmVuZHNXaXRoKCclJykgPyBudW0ocGFydHNbM10pIC8gMTAwIDogbnVtKHBhcnRzWzNdKSkgOiAxO1xuICBpZiAoTnVtYmVyLmlzTmFOKGFscGhhKSkgcmV0dXJuIG51bGw7XG4gIGlmIChuYW1lLnN0YXJ0c1dpdGgoJ3JnYicpKSB7XG4gICAgY29uc3QgW3IsIGcsIGJdID0gcGFydHMubWFwKG51bSk7XG4gICAgaWYgKFtyLCBnLCBiXS5zb21lKE51bWJlci5pc05hTikpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7IHIsIGcsIGIsIGE6IGFscGhhIH07XG4gIH1cbiAgaWYgKG5hbWUuc3RhcnRzV2l0aCgnaHNsJykpIHtcbiAgICBjb25zdCBoID0gbnVtKHBhcnRzWzBdKTtcbiAgICBjb25zdCBzID0gbnVtKHBhcnRzWzFdKSAvIDEwMDtcbiAgICBjb25zdCBsID0gbnVtKHBhcnRzWzJdKSAvIDEwMDtcbiAgICBpZiAoW2gsIHMsIGxdLnNvbWUoTnVtYmVyLmlzTmFOKSkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZiA9IChrOiBudW1iZXIpOiBudW1iZXIgPT4ge1xuICAgICAgY29uc3Qga2sgPSAoayArIGggLyAzMCkgJSAxMjtcbiAgICAgIHJldHVybiBsIC0gcyAqIE1hdGgubWluKGwsIDEgLSBsKSAqIE1hdGgubWF4KC0xLCBNYXRoLm1pbihrayAtIDMsIDkgLSBraywgMSkpO1xuICAgIH07XG4gICAgcmV0dXJuIHsgcjogZigwKSAqIDI1NSwgZzogZig4KSAqIDI1NSwgYjogZig0KSAqIDI1NSwgYTogYWxwaGEgfTtcbiAgfVxuICAvLyBva2xjaChMIEMgSCBbLyBhXSkgXHUyMTkyIHNSR0IgKEJqXHUwMEY2cm4gT3R0b3Nzb24ncyBPS0xhYiBjb25zdGFudHMpLlxuICBjb25zdCBMID0gbnVtKHBhcnRzWzBdKTtcbiAgY29uc3QgQyA9IG51bShwYXJ0c1sxXSk7XG4gIGNvbnN0IEggPSBudW0ocGFydHNbMl0pO1xuICBpZiAoW0wsIEMsIEhdLnNvbWUoTnVtYmVyLmlzTmFOKSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGhyID0gKEggKiBNYXRoLlBJKSAvIDE4MDtcbiAgY29uc3QgYWEgPSBDICogTWF0aC5jb3MoaHIpO1xuICBjb25zdCBiYiA9IEMgKiBNYXRoLnNpbihocik7XG4gIGNvbnN0IGwzID0gTCArIDAuMzk2MzM3Nzc3NCAqIGFhICsgMC4yMTU4MDM3NTczICogYmI7XG4gIGNvbnN0IG0zID0gTCAtIDAuMTA1NTYxMzQ1OCAqIGFhIC0gMC4wNjM4NTQxNzI4ICogYmI7XG4gIGNvbnN0IHMzID0gTCAtIDAuMDg5NDg0MTc3NSAqIGFhIC0gMS4yOTE0ODU1NDggKiBiYjtcbiAgY29uc3QgbCA9IGwzICogbDMgKiBsMztcbiAgY29uc3QgbSA9IG0zICogbTMgKiBtMztcbiAgY29uc3QgcyA9IHMzICogczMgKiBzMztcbiAgY29uc3QgbGluID0gW1xuICAgIDQuMDc2NzQxNjYyMSAqIGwgLSAzLjMwNzcxMTU5MTMgKiBtICsgMC4yMzA5Njk5MjkyICogcyxcbiAgICAtMS4yNjg0MzgwMDQ2ICogbCArIDIuNjA5NzU3NDAxMSAqIG0gLSAwLjM0MTMxOTM5NjUgKiBzLFxuICAgIC0wLjAwNDE5NjA4NjMgKiBsIC0gMC43MDM0MTg2MTQ3ICogbSArIDEuNzA3NjE0NzAxMCAqIHMsXG4gIF0ubWFwKChjaCkgPT4ge1xuICAgIGNvbnN0IGNsID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMSwgY2gpKTtcbiAgICByZXR1cm4gKGNsIDw9IDAuMDAzMTMwOCA/IDEyLjkyICogY2wgOiAxLjA1NSAqIE1hdGgucG93KGNsLCAxIC8gMi40KSAtIDAuMDU1KSAqIDI1NTtcbiAgfSk7XG4gIHJldHVybiB7IHI6IGxpblswXSwgZzogbGluWzFdLCBiOiBsaW5bMl0sIGE6IGFscGhhIH07XG59XG5cbi8qQXBwbGllZCB0byBFVkVSWSBjb2xvciBwYWludGVkIGluc2lkZSBhIGRpbW1lZCByZWdpb24gKGZpbGwsIGhhdGNoaW5nLFxuICogYm9yZGVyLCBsYWJlbCB0ZXh0KSwgc28gcmVsYXRpdmUgdGV4dC12cy1maWxsIGNvbnRyYXN0IGlzIHByZXNlcnZlZCB3aGlsZVxuICogdGhlIHdob2xlIHNlY3Rpb24gcmVjZWRlcy4gQWNjZXB0cyAjaGV4LCByZ2IoKS9yZ2JhKCksIGhzbCgpL2hzbGEoKSwgYW5kXG4gKiBva2xjaCgpIGNvbG9yIGZvcm1zOyBhbnl0aGluZyBlbHNlIChuYW1lZCBjb2xvcnMsIHZhcigpIHJlZmVyZW5jZXMpIGlzXG4gKiByZXR1cm5lZCB1bmNoYW5nZWQgXHUyMDE0IHRoZSBjYWxsZXIga2VlcHMgYSBzYW5lIGNvbG9yIGVpdGhlciB3YXkuICovXG5leHBvcnQgZnVuY3Rpb24gZGltQ29sb3IoY29sb3I6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHAgPSBwYXJzZUNvbG9yKGNvbG9yKTtcbiAgaWYgKCFwKSByZXR1cm4gY29sb3I7XG4gIGNvbnN0IHIgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigyNTUsIHAucikpIC8gMjU1O1xuICBjb25zdCBnID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMjU1LCBwLmcpKSAvIDI1NTtcbiAgY29uc3QgYiA9IE1hdGgubWF4KDAsIE1hdGgubWluKDI1NSwgcC5iKSkgLyAyNTU7XG4gIGNvbnN0IHYgPSBNYXRoLm1heChyLCBnLCBiKTtcbiAgY29uc3QgZCA9IHYgLSBNYXRoLm1pbihyLCBnLCBiKTtcbiAgY29uc3Qgc2F0ID0gdiA9PT0gMCA/IDAgOiBkIC8gdjtcbiAgbGV0IGggPSAwO1xuICBpZiAoZCAhPT0gMCkge1xuICAgIGlmICh2ID09PSByKSBoID0gKChnIC0gYikgLyBkKSAlIDY7XG4gICAgZWxzZSBpZiAodiA9PT0gZykgaCA9IChiIC0gcikgLyBkICsgMjtcbiAgICBlbHNlIGggPSAociAtIGcpIC8gZCArIDQ7XG4gICAgaCA9IChoICsgNikgJSA2O1xuICB9XG4gIGNvbnN0IHMyID0gc2F0ICogMC41O1xuICBjb25zdCB2MiA9IHYgKiAwLjU7XG4gIGNvbnN0IGNjID0gdjIgKiBzMjtcbiAgY29uc3QgeCA9IGNjICogKDEgLSBNYXRoLmFicygoaCAlIDIpIC0gMSkpO1xuICBjb25zdCBtMCA9IHYyIC0gY2M7XG4gIGNvbnN0IHNlY3RvciA9IE1hdGguZmxvb3IoaCkgJSA2O1xuICBjb25zdCByZ2IxID0gW1xuICAgIFtjYywgeCwgMF0sXG4gICAgW3gsIGNjLCAwXSxcbiAgICBbMCwgY2MsIHhdLFxuICAgIFswLCB4LCBjY10sXG4gICAgW3gsIDAsIGNjXSxcbiAgICBbY2MsIDAsIHhdLFxuICBdW3NlY3Rvcl07XG4gIGNvbnN0IG91dCA9IHJnYjEubWFwKChjaCkgPT4gTWF0aC5yb3VuZCgoY2ggKyBtMCkgKiAyNTUpKTtcbiAgcmV0dXJuIGByZ2JhKCR7b3V0WzBdfSwgJHtvdXRbMV19LCAke291dFsyXX0sICR7cm91bmQzKHAuYSl9KWA7XG59XG5cbi8vIC0tIExhYmVsIGxlZ2liaWxpdHkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyogKi9cbmZ1bmN0aW9uIHJlbGF0aXZlTHVtaW5hbmNlKHI6IG51bWJlciwgZzogbnVtYmVyLCBiOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCBsaW4gPSAoY2g6IG51bWJlcik6IG51bWJlciA9PiB7XG4gICAgY29uc3QgcyA9IE1hdGgubWF4KDAsIE1hdGgubWluKDI1NSwgY2gpKSAvIDI1NTtcbiAgICByZXR1cm4gcyA8PSAwLjA0MDQ1ID8gcyAvIDEyLjkyIDogTWF0aC5wb3coKHMgKyAwLjA1NSkgLyAxLjA1NSwgMi40KTtcbiAgfTtcbiAgcmV0dXJuIDAuMjEyNiAqIGxpbihyKSArIDAuNzE1MiAqIGxpbihnKSArIDAuMDcyMiAqIGxpbihiKTtcbn1cblxuLyoqIEhhbG8gY29sb3IgZm9yIGNhbnZhcyBsYWJlbCB0ZXh0OiB0aGUgdHJhbnNsdWNlbnQgY291bnRlci1jb2xvciByaW1cbiAqIChgc3Ryb2tlVGV4dGAgdW5kZXIgdGhlIGZpbGwpIHRoYXQgZ3VhcmFudGVlcyBsYWJlbCBsZWdpYmlsaXR5IG92ZXIgQU5ZXG4gKiBzdXJmYWNlIFx1MjAxNCBzb2xpZCBmaWxscywgZGltbWVkL2hhdGNoZWQgc2VnbWVudHMuICovXG5leHBvcnQgZnVuY3Rpb24gbGFiZWxIYWxvQ29sb3IoZmc6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHAgPSBwYXJzZUNvbG9yKGZnKTtcbiAgY29uc3QgZGFyayA9ICFwIHx8IHJlbGF0aXZlTHVtaW5hbmNlKHAuciwgcC5nLCBwLmIpID49IE1hdGguc3FydCgwLjA1ICogMS4wNSkgLSAwLjA1O1xuICByZXR1cm4gZGFyayA/ICdyZ2JhKDAsIDAsIDAsIDAuNTUpJyA6ICdyZ2JhKDI1NSwgMjU1LCAyNTUsIDAuNTUpJztcbn1cbiIsICIvKiogUG9pbnRlciBoaXQtdGVzdGluZyBwcmltaXRpdmVzIGZvciBjYW52YXMtcGFpbnRlZCBjb21wb25lbnRzLiAqL1xuXG4vKiogQW4gYXhpcy1hbGlnbmVkIGhpdCByZWN0YW5nbGUgKENTUyBweCkuICovXG5leHBvcnQgaW50ZXJmYWNlIEhpdFJlY3Qge1xuICB4OiBudW1iZXI7XG4gIHk6IG51bWJlcjtcbiAgdzogbnVtYmVyO1xuICBoOiBudW1iZXI7XG59XG5cbi8qKiBXaWRlbiBhIChwb3NzaWJseSBoYWlybGluZSkgcmVjdCB0byBhdCBsZWFzdCBgbWluV2AgcHggYXJvdW5kIGl0cyBjZW50ZXJcbiAqIFx1MjAxNCBpbnN0YW50cyBnZXQgYSBoaXQgdGFyZ2V0IGEgZmV3IHB4IGxhcmdlciB0aGFuIHRoZWlyIHZpc3VhbC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRIaXRSZWN0KHI6IEhpdFJlY3QsIG1pblc6IG51bWJlcik6IEhpdFJlY3Qge1xuICBpZiAoci53ID49IG1pblcpIHJldHVybiByO1xuICBjb25zdCBjeCA9IHIueCArIHIudyAvIDI7XG4gIHJldHVybiB7IHg6IGN4IC0gbWluVyAvIDIsIHk6IHIueSwgdzogbWluVywgaDogci5oIH07XG59XG5cbi8qRWRnZXMgYXJlIGluY2x1c2l2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoaXRUZXN0UmVjdHMoeDogbnVtYmVyLCB5OiBudW1iZXIsIHJlY3RzOiByZWFkb25seSBIaXRSZWN0W10pOiBudW1iZXIge1xuICBmb3IgKGxldCBpID0gcmVjdHMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICBjb25zdCByID0gcmVjdHNbaV07XG4gICAgaWYgKHggPj0gci54ICYmIHggPD0gci54ICsgci53ICYmIHkgPj0gci55ICYmIHkgPD0gci55ICsgci5oKSByZXR1cm4gaTtcbiAgfVxuICByZXR1cm4gLTE7XG59XG5cbi8qKiBTcXVhcmVkIGRpc3RhbmNlIGZyb20gcG9pbnQgcCB0byBzZWdtZW50IGFiLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc3RTcVRvU2VnbWVudChweDogbnVtYmVyLCBweTogbnVtYmVyLCBheDogbnVtYmVyLCBheTogbnVtYmVyLCBieDogbnVtYmVyLCBieTogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgZHggPSBieCAtIGF4O1xuICBjb25zdCBkeSA9IGJ5IC0gYXk7XG4gIGNvbnN0IGxlbjIgPSBkeCAqIGR4ICsgZHkgKiBkeTtcbiAgbGV0IHQgPSBsZW4yID4gMCA/ICgocHggLSBheCkgKiBkeCArIChweSAtIGF5KSAqIGR5KSAvIGxlbjIgOiAwO1xuICBpZiAodCA8IDApIHQgPSAwO1xuICBlbHNlIGlmICh0ID4gMSkgdCA9IDE7XG4gIGNvbnN0IHF4ID0gYXggKyB0ICogZHggLSBweDtcbiAgY29uc3QgcXkgPSBheSArIHQgKiBkeSAtIHB5O1xuICByZXR1cm4gcXggKiBxeCArIHF5ICogcXk7XG59XG5cbi8qKiBUcnVlIHdoZW4gdGhlIHBvaW50IGlzIHdpdGhpbiBgdG9sYCBweCBvZiB0aGUgcG9seWxpbmUuICovXG5leHBvcnQgZnVuY3Rpb24gaGl0VGVzdFBvbHlsaW5lKHB4OiBudW1iZXIsIHB5OiBudW1iZXIsIHB0czogcmVhZG9ubHkgeyB4OiBudW1iZXI7IHk6IG51bWJlciB9W10sIHRvbDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHQyID0gdG9sICogdG9sO1xuICBmb3IgKGxldCBpID0gMTsgaSA8IHB0cy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChkaXN0U3FUb1NlZ21lbnQocHgsIHB5LCBwdHNbaSAtIDFdLngsIHB0c1tpIC0gMV0ueSwgcHRzW2ldLngsIHB0c1tpXS55KSA8PSB0MikgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuIiwgIi8vIFB1cmUgbWF0aCBmb3IgdGhlIDxkYWctdmlldz4gZWxlbWVudDogZ3JhcGggbm9ybWFsaXphdGlvbiwgY3ljbGUgYnJlYWtpbmcgKHJlcG9ydGVkLCBuZXZlciBzaWxlbnRseSBkcm9wcGVkKSwgbGF5ZXIgYXNzaWdubWVudC5cblxuaW1wb3J0IHsgaGFzaFN0cmluZyB9IGZyb20gJy4vY29sb3IudHMnO1xuaW1wb3J0IHsgZGlzdFNxVG9TZWdtZW50IH0gZnJvbSAnLi9oaXQtdGVzdC50cyc7XG5pbXBvcnQgdHlwZSB7IEhpdFJlY3QgfSBmcm9tICcuL2hpdC10ZXN0LnRzJztcblxuLy8gLS0gRGF0YSBtb2RlbCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIE9uZSB2ZXJ0ZXguIGBpZGAgaXMgdGhlIGlkZW50aXR5IHVzZWQgYnkgZXZlcnkgZWRnZSBhbmQgZXZlcnkgbG9va3VwLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEYWdOb2RlIHtcbiAgaWQ6IHN0cmluZztcbiAgLyoqIFByaW1hcnkgbGluZSBvZiB0ZXh0LiBGYWxscyBiYWNrIHRvIHRoZSBpZCB3aGVuIGFic2VudC4gKi9cbiAgbGFiZWw/OiBzdHJpbmc7XG4gIC8qKiBTZWNvbmQgbGluZSwgZHJhd24gc21hbGxlciAoYSByZXBvIG5hbWUgdW5kZXIgYSBQUiB0aXRsZSwgYSB2ZXJzaW9uKS4gKi9cbiAgc3VibGFiZWw/OiBzdHJpbmc7XG4gIC8qKiBDb2xvciBmYW1pbHkuIE5vZGVzIHNoYXJpbmcgYSBjYXRlZ29yeSBzaGFyZSBhIGh1ZSAoc2VlIC4vY29sb3IudHMpLiAqL1xuICBjYXRlZ29yeT86IHN0cmluZztcbiAgLyoqIFN0eWxlLW1hcCBrZXk6IHBpY2tzIHRoZSBmaWxsIHBhdHRlcm4gYW5kIGJvcmRlciB0cmVhdG1lbnQuICovXG4gIHN0YXRlPzogc3RyaW5nO1xuICAvKiogUGlucyB0aGUgbm9kZSB0byBhIGxheWVyLiAqL1xuICBsYXllcj86IG51bWJlcjtcbiAgLyoqIENvbnN1bWVyIHBheWxvYWQsIHBhc3NlZCBiYWNrIHVudG91Y2hlZCBvbiBldmVyeSBldmVudCBhbmQgY2FsbGJhY2suICovXG4gIG1ldGE/OiB1bmtub3duO1xufVxuXG4vKiogT25lIGRpcmVjdGVkIGVkZ2UsIHJlYWQgYXMgXCJgdG9gIGRlcGVuZHMgb24gYGZyb21gXCIsIHNvIGBmcm9tYCBpcyBkcmF3blxuICogQUJPVkUgYHRvYCAob3IgbGVmdCBvZiBpdCBpbiAnTFInKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGFnRWRnZSB7XG4gIGZyb206IHN0cmluZztcbiAgdG86IHN0cmluZztcbiAgbGFiZWw/OiBzdHJpbmc7XG4gIC8qKiBTdHlsZS1tYXAga2V5IGZvciB0aGUgbGluZSB0cmVhdG1lbnQuICovXG4gIHN0YXRlPzogc3RyaW5nO1xuICBtZXRhPzogdW5rbm93bjtcbn1cblxuLyoqIFdoaWNoIHdheSB0aGUgbGF5ZXJzIHN0YWNrLiAqL1xuZXhwb3J0IHR5cGUgRGFnT3JpZW50YXRpb24gPSAnVEInIHwgJ0xSJztcblxuLy8gLS0gTm9ybWFsaXphdGlvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQW4gaW5wdXQgZWRnZSB0aGUgZ3JhcGggY291bGQgbm90IHVzZSwgYW5kIHRoZSByZWFzb24uICovXG5leHBvcnQgaW50ZXJmYWNlIFJlamVjdGVkRWRnZSB7XG4gIGVkZ2U6IERhZ0VkZ2U7XG4gIHJlYXNvbjogJ3Vua25vd24tZnJvbScgfCAndW5rbm93bi10bycgfCAnc2VsZi1sb29wJyB8ICdkdXBsaWNhdGUnO1xufVxuXG4vKiogVGhlIHZhbGlkYXRlZCBncmFwaDogZGVuc2UgaW5kaWNlcywgYWRqYWNlbmN5LCBhbmQgd2hhdCB3YXMgdGhyb3duIG91dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGFnR3JhcGgge1xuICBub2RlczogcmVhZG9ubHkgRGFnTm9kZVtdO1xuICAvKiogRXZlcnkgYWNjZXB0ZWQgZWRnZSwgYXMgaW5kZXggcGFpcnMgaW50byBgbm9kZXNgLiAqL1xuICBlZGdlczogcmVhZG9ubHkgeyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGVkZ2U6IERhZ0VkZ2UgfVtdO1xuICAvKiogaWQgLT4gaW5kZXguICovXG4gIGluZGV4OiBSZWFkb25seU1hcDxzdHJpbmcsIG51bWJlcj47XG4gIC8qKiBQZXIgbm9kZSwgdGhlIGluZGljZXMgaXQgcG9pbnRzIEFUIChpdHMgZGVwZW5kZW50cykuICovXG4gIG91dDogcmVhZG9ubHkgKHJlYWRvbmx5IG51bWJlcltdKVtdO1xuICAvKiogUGVyIG5vZGUsIHRoZSBpbmRpY2VzIHBvaW50aW5nIGF0IElUIChpdHMgZGVwZW5kZW5jaWVzKS4gKi9cbiAgaW46IHJlYWRvbmx5IChyZWFkb25seSBudW1iZXJbXSlbXTtcbiAgLyoqIElucHV0IGVkZ2VzIHRoYXQgYXJlIG5vdCBpbiB0aGUgZ3JhcGguICovXG4gIHJlamVjdGVkOiByZWFkb25seSBSZWplY3RlZEVkZ2VbXTtcbn1cblxuLyoqIFZhbGlkYXRlIGFuZCBpbmRleCB0aGUgaW5wdXQuIEEgZHVwbGljYXRlIGVkZ2UgKHNhbWUgZnJvbS90bywgd2hhdGV2ZXJcbiAqIGl0cyBsYWJlbCkgaXMga2VwdCBvbmNlIC0tIGEgY291cGxlIG9mIGxpbmVzIGJldHdlZW4gdGhlIHNhbWUgcGFpciBzYXlcbiAqIG5vdGhpbmcgYSByZWFkZXIgY2FuIGFjdCBvbiAtLSBhbmQgYSBub2RlIGlkIHRoYXQgcmVwZWF0cyBrZWVwcyBpdHNcbiAqIEZJUlNUIG9jY3VycmVuY2UsIHNvIGFuIGlkIGlzIGEgc3RhYmxlIGlkZW50aXR5IGZvciB0aGUgd2hvbGUgcmVuZGVyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkR3JhcGgobm9kZXM6IHJlYWRvbmx5IERhZ05vZGVbXSwgZWRnZXM6IHJlYWRvbmx5IERhZ0VkZ2VbXSk6IERhZ0dyYXBoIHtcbiAgY29uc3QgaW5kZXggPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICBjb25zdCBrZXB0OiBEYWdOb2RlW10gPSBbXTtcbiAgZm9yIChjb25zdCBuIG9mIG5vZGVzKSB7XG4gICAgaWYgKGluZGV4LmhhcyhuLmlkKSkgY29udGludWU7XG4gICAgaW5kZXguc2V0KG4uaWQsIGtlcHQubGVuZ3RoKTtcbiAgICBrZXB0LnB1c2gobik7XG4gIH1cbiAgY29uc3Qgb3V0OiBudW1iZXJbXVtdID0ga2VwdC5tYXAoKCkgPT4gW10pO1xuICBjb25zdCBpbmM6IG51bWJlcltdW10gPSBrZXB0Lm1hcCgoKSA9PiBbXSk7XG4gIGNvbnN0IGFjY2VwdGVkOiB7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgZWRnZTogRGFnRWRnZSB9W10gPSBbXTtcbiAgY29uc3QgcmVqZWN0ZWQ6IFJlamVjdGVkRWRnZVtdID0gW107XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBlIG9mIGVkZ2VzKSB7XG4gICAgY29uc3QgZiA9IGluZGV4LmdldChlLmZyb20pO1xuICAgIGNvbnN0IHQgPSBpbmRleC5nZXQoZS50byk7XG4gICAgaWYgKGYgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVqZWN0ZWQucHVzaCh7IGVkZ2U6IGUsIHJlYXNvbjogJ3Vua25vd24tZnJvbScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVqZWN0ZWQucHVzaCh7IGVkZ2U6IGUsIHJlYXNvbjogJ3Vua25vd24tdG8nIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChmID09PSB0KSB7XG4gICAgICByZWplY3RlZC5wdXNoKHsgZWRnZTogZSwgcmVhc29uOiAnc2VsZi1sb29wJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBrZXkgPSBgJHtmfT4ke3R9YDtcbiAgICBpZiAoc2Vlbi5oYXMoa2V5KSkge1xuICAgICAgcmVqZWN0ZWQucHVzaCh7IGVkZ2U6IGUsIHJlYXNvbjogJ2R1cGxpY2F0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgc2Vlbi5hZGQoa2V5KTtcbiAgICBvdXRbZl0ucHVzaCh0KTtcbiAgICBpbmNbdF0ucHVzaChmKTtcbiAgICBhY2NlcHRlZC5wdXNoKHsgZnJvbTogZiwgdG86IHQsIGVkZ2U6IGUgfSk7XG4gIH1cbiAgcmV0dXJuIHsgbm9kZXM6IGtlcHQsIGVkZ2VzOiBhY2NlcHRlZCwgaW5kZXgsIG91dCwgaW46IGluYywgcmVqZWN0ZWQgfTtcbn1cblxuLy8gLS0gQ3ljbGUgYnJlYWtpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGljaCBhY2NlcHRlZCBlZGdlcyB3ZXJlIHJldmVyc2VkIHRvIG1ha2UgdGhlIGdyYXBoIGFjeWNsaWMuICovXG5leHBvcnQgaW50ZXJmYWNlIEN5Y2xlUmVzdWx0IHtcbiAgLyoqIEluZGljZXMgaW50byBgZ3JhcGguZWRnZXNgIG9mIHRoZSBlZGdlcyB0aGUgbGF5b3V0IHJldmVyc2VkLiAqL1xuICByZXZlcnNlZDogcmVhZG9ubHkgbnVtYmVyW107XG4gIC8qKiBBZGphY2VuY3kgd2l0aCB0aG9zZSBlZGdlcyBmbGlwcGVkIC0tIGFjeWNsaWMgYnkgY29uc3RydWN0aW9uLiAqL1xuICBvdXQ6IHJlYWRvbmx5IChyZWFkb25seSBudW1iZXJbXSlbXTtcbiAgaW46IHJlYWRvbmx5IChyZWFkb25seSBudW1iZXJbXSlbXTtcbn1cblxuLyoqXG4gKiBSZXZlcnNlIHRoZSBtaW5pbXVtLWlzaCBzZXQgb2YgZWRnZXMgdGhhdCBtYWtlcyB0aGUgZ3JhcGggYWN5Y2xpYywgYnlcbiAqIGRlcHRoLWZpcnN0IHNlYXJjaCBmcm9tIGV2ZXJ5IG5vZGUgaW4gaW5wdXQgb3JkZXI6IGFuIGVkZ2UgYmFjayB0byBhIG5vZGVcbiAqIHN0aWxsIG9uIHRoZSBzdGFjayBjbG9zZXMgYSBjeWNsZSwgc28gdGhhdCBlZGdlIGlzIHRoZSBvbmUgcmV2ZXJzZWQuXG4gKlxuICogVGhlIHJldmVyc2VkIHNldCBpcyBSRVRVUk5FRCwgbm90IHN3YWxsb3dlZC4gQSBjaXJjdWxhciBkZXBlbmRlbmN5IGlzIHRoZVxuICogc2luZ2xlIG1vc3QgaW1wb3J0YW50IHRoaW5nIGEgZGVwZW5kZW5jeSBncmFwaCBjYW4gdGVsbCB5b3UsIGFuZCBhIGxheW91dFxuICogdGhhdCBxdWlldGx5IHN0cmFpZ2h0ZW5lZCBpdCBvdXQgd291bGQgYmUgaGlkaW5nIGV4YWN0bHkgdGhlIGZhY3QgdGhlXG4gKiByZWFkZXIgb3BlbmVkIHRoZSBncmFwaCB0byBmaW5kLiBgPGRhZy12aWV3PmAgZHJhd3MgdGhlc2UgZWRnZXMgaW4gdGhlXG4gKiBlbXBoYXNpcyBjb2xvciB3aXRoIHRoZSBhcnJvdyBzdGlsbCBwb2ludGluZyB0aGUgdHJ1ZSB3YXkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBicmVha0N5Y2xlcyhncmFwaDogRGFnR3JhcGgpOiBDeWNsZVJlc3VsdCB7XG4gIGNvbnN0IG4gPSBncmFwaC5ub2Rlcy5sZW5ndGg7XG4gIGNvbnN0IHJldmVyc2VkOiBudW1iZXJbXSA9IFtdO1xuICBjb25zdCByZXZlcnNlZFNldCA9IG5ldyBTZXQ8bnVtYmVyPigpO1xuICAvLyBFZGdlIGluZGV4IGJ5IChmcm9tLCB0bykgc28gdGhlIERGUyBjYW4gbmFtZSB0aGUgZWRnZSBpdCBpcyBjdXR0aW5nLlxuICBjb25zdCBlZGdlQXQgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICBncmFwaC5lZGdlcy5mb3JFYWNoKChlLCBpKSA9PiBlZGdlQXQuc2V0KGAke2UuZnJvbX0+JHtlLnRvfWAsIGkpKTtcblxuICBjb25zdCBXSElURSA9IDA7XG4gIGNvbnN0IEdSRVkgPSAxO1xuICBjb25zdCBCTEFDSyA9IDI7XG4gIGNvbnN0IG1hcmsgPSBuZXcgVWludDhBcnJheShuKTtcbiAgLy8gRXhwbGljaXQgc3RhY2s6IGEgZGVlcCBjaGFpbiBvZiBkZXBlbmRlbmNpZXMgaXMgYSBwZXJmZWN0bHkgb3JkaW5hcnlcbiAgLy8gZ3JhcGgsIGFuZCByZWN1cnNpb24gd291bGQgYmxvdyB1cCBvbiBvbmUuXG4gIGZvciAobGV0IHJvb3QgPSAwOyByb290IDwgbjsgcm9vdCsrKSB7XG4gICAgaWYgKG1hcmtbcm9vdF0gIT09IFdISVRFKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFjazogeyBub2RlOiBudW1iZXI7IG5leHQ6IG51bWJlciB9W10gPSBbeyBub2RlOiByb290LCBuZXh0OiAwIH1dO1xuICAgIG1hcmtbcm9vdF0gPSBHUkVZO1xuICAgIHdoaWxlIChzdGFjay5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCB0b3AgPSBzdGFja1tzdGFjay5sZW5ndGggLSAxXTtcbiAgICAgIGNvbnN0IHN1Y2MgPSBncmFwaC5vdXRbdG9wLm5vZGVdO1xuICAgICAgaWYgKHRvcC5uZXh0ID49IHN1Y2MubGVuZ3RoKSB7XG4gICAgICAgIG1hcmtbdG9wLm5vZGVdID0gQkxBQ0s7XG4gICAgICAgIHN0YWNrLnBvcCgpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG5leHQgPSBzdWNjW3RvcC5uZXh0KytdO1xuICAgICAgaWYgKG1hcmtbbmV4dF0gPT09IEdSRVkpIHtcbiAgICAgICAgY29uc3QgZWkgPSBlZGdlQXQuZ2V0KGAke3RvcC5ub2RlfT4ke25leHR9YCk7XG4gICAgICAgIGlmIChlaSAhPT0gdW5kZWZpbmVkICYmICFyZXZlcnNlZFNldC5oYXMoZWkpKSB7XG4gICAgICAgICAgcmV2ZXJzZWRTZXQuYWRkKGVpKTtcbiAgICAgICAgICByZXZlcnNlZC5wdXNoKGVpKTtcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChtYXJrW25leHRdID09PSBCTEFDSykgY29udGludWU7XG4gICAgICBtYXJrW25leHRdID0gR1JFWTtcbiAgICAgIHN0YWNrLnB1c2goeyBub2RlOiBuZXh0LCBuZXh0OiAwIH0pO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IG91dDogbnVtYmVyW11bXSA9IGdyYXBoLm5vZGVzLm1hcCgoKSA9PiBbXSk7XG4gIGNvbnN0IGluYzogbnVtYmVyW11bXSA9IGdyYXBoLm5vZGVzLm1hcCgoKSA9PiBbXSk7XG4gIGdyYXBoLmVkZ2VzLmZvckVhY2goKGUsIGkpID0+IHtcbiAgICBjb25zdCBbZiwgdF0gPSByZXZlcnNlZFNldC5oYXMoaSkgPyBbZS50bywgZS5mcm9tXSA6IFtlLmZyb20sIGUudG9dO1xuICAgIG91dFtmXS5wdXNoKHQpO1xuICAgIGluY1t0XS5wdXNoKGYpO1xuICB9KTtcbiAgcmV0dXJuIHsgcmV2ZXJzZWQsIG91dCwgaW46IGluYyB9O1xufVxuXG4vLyAtLSBMYXllciBhc3NpZ25tZW50IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogUGVyLW5vZGUgbGF5ZXIgcGx1cyB0aGUgcGlucyB0aGUgZWRnZSBkaXJlY3Rpb25zIG92ZXJydWxlZC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTGF5ZXJSZXN1bHQge1xuICAvKiAqL1xuICBsYXllcnM6IHJlYWRvbmx5IG51bWJlcltdO1xuICAvKiogSGlnaGVzdCBsYXllciBpbmRleCBpbiB1c2UuICovXG4gIG1heExheWVyOiBudW1iZXI7XG4gIC8qKiBJZHMgd2hvc2UgYGxheWVyYCBoaW50IHdhcyBkcm9wcGVkIGJlY2F1c2UgYW4gZWRnZSBjb250cmFkaWN0ZWQgaXQuICovXG4gIGlnbm9yZWRQaW5zOiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxuLyoqIE9wdGlvbnMgZm9yIGFzc2lnbkxheWVycy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTGF5ZXJPcHRpb25zIHtcbiAgLyoqICdzb3VyY2VzJyBwdXRzIGV2ZXJ5IG5vZGUgYXMgRUFSTFkgYXMgaXRzIGRlcGVuZGVuY2llcyBhbGxvdy4gKi9cbiAgYWxpZ24/OiAnc291cmNlcycgfCAnc2lua3MnO1xufVxuXG4vKipcbiAqIExvbmdlc3QtcGF0aCBsYXllcmluZyBvdmVyIHRoZSBhY3ljbGljIGFkamFjZW5jeTogYSBub2RlJ3MgbGF5ZXIgaXMgb25lXG4gKiBwYXN0IHRoZSBkZWVwZXN0IG9mIGl0cyBkZXBlbmRlbmNpZXMsIHNvIG5vIGVkZ2UgZXZlciBwb2ludHMgYmFja3dhcmRzIG9yXG4gKiBzdGF5cyBpbnNpZGUgb25lIGxheWVyLlxuICpcbiAqIEEgbm9kZSdzIGBsYXllcmAgaGludCBjYW4gb25seSBwdXNoIGl0IERPV04sIG5ldmVyIHVwIHBhc3QgYSBkZXBlbmRlbmN5LlxuICogVGhlIGhpbnQgaXMgYSBwcmVzZW50YXRpb24gcHJlZmVyZW5jZTsgdGhlIGVkZ2UgaXMgYSBmYWN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzaWduTGF5ZXJzKGdyYXBoOiBEYWdHcmFwaCwgYWN5Y2xpYzogQ3ljbGVSZXN1bHQsIG9wdHM6IExheWVyT3B0aW9ucyA9IHt9KTogTGF5ZXJSZXN1bHQge1xuICBjb25zdCBuID0gZ3JhcGgubm9kZXMubGVuZ3RoO1xuICBjb25zdCBsYXllcnMgPSBuZXcgQXJyYXk8bnVtYmVyPihuKS5maWxsKDApO1xuICBjb25zdCBpZ25vcmVkUGluczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgb3JkZXIgPSB0b3BvT3JkZXIoYWN5Y2xpYy5vdXQsIG4pO1xuICBmb3IgKGNvbnN0IHYgb2Ygb3JkZXIpIHtcbiAgICBsZXQgYmFzZSA9IDA7XG4gICAgZm9yIChjb25zdCBkZXAgb2YgYWN5Y2xpYy5pblt2XSkgYmFzZSA9IE1hdGgubWF4KGJhc2UsIGxheWVyc1tkZXBdICsgMSk7XG4gICAgY29uc3QgcGluID0gZ3JhcGgubm9kZXNbdl0ubGF5ZXI7XG4gICAgaWYgKHBpbiAhPT0gdW5kZWZpbmVkICYmIE51bWJlci5pc0Zpbml0ZShwaW4pKSB7XG4gICAgICBjb25zdCB3YW50ZWQgPSBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHBpbikpO1xuICAgICAgaWYgKHdhbnRlZCA+PSBiYXNlKSBiYXNlID0gd2FudGVkO1xuICAgICAgZWxzZSBpZ25vcmVkUGlucy5wdXNoKGdyYXBoLm5vZGVzW3ZdLmlkKTtcbiAgICB9XG4gICAgbGF5ZXJzW3ZdID0gYmFzZTtcbiAgfVxuXG4gIGxldCBtYXhMYXllciA9IDA7XG4gIGZvciAoY29uc3QgbCBvZiBsYXllcnMpIG1heExheWVyID0gTWF0aC5tYXgobWF4TGF5ZXIsIGwpO1xuXG4gIGlmIChvcHRzLmFsaWduID09PSAnc2lua3MnKSB7XG4gICAgLy8gV2FsayB0aGUgdG9wb2xvZ2ljYWwgb3JkZXIgYmFja3dhcmRzIGFuZCBwdWxsIGVhY2ggbm9kZSBkb3duIHRvIGFib3ZlXG4gICAgLy8gaXRzIGVhcmxpZXN0IGRlcGVuZGVudC4gQSBub2RlIHdpdGggbm8gZGVwZW5kZW50cyBsYW5kcyBvbiB0aGUgbGFzdFxuICAgIC8vIGxheWVyLCB3aGljaCBpcyB3aGF0IGJvdHRvbS1hbGlnbmluZyBtZWFucy5cbiAgICBmb3IgKGxldCBpID0gb3JkZXIubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IHYgPSBvcmRlcltpXTtcbiAgICAgIGlmIChncmFwaC5ub2Rlc1t2XS5sYXllciAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICAgIGxldCBsaW1pdCA9IG1heExheWVyO1xuICAgICAgZm9yIChjb25zdCBkZXBlbmRlbnQgb2YgYWN5Y2xpYy5vdXRbdl0pIGxpbWl0ID0gTWF0aC5taW4obGltaXQsIGxheWVyc1tkZXBlbmRlbnRdIC0gMSk7XG4gICAgICBsYXllcnNbdl0gPSBNYXRoLm1heChsYXllcnNbdl0sIGxpbWl0KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4geyBsYXllcnMsIG1heExheWVyLCBpZ25vcmVkUGlucyB9O1xufVxuXG4vKiogTm9kZXMgcGVyIHJvdyBiZWZvcmUgYSBsYXllciB3cmFwcyBvbnRvIGFub3RoZXIgcm93LiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfTUFYX0xBWUVSX1dJRFRIID0gMTQ7XG5cbi8qKiBCcmVhayBhIGxheWVyIHRoYXQgaXMgdG9vIHdpZGUgdG8gcmVhZCBpbnRvIGNvbnNlY3V0aXZlIHJvd3MuIFRoZSBncmFwaCBpc1xuICpub3QgZW1wdHkgYW5kIGl0IGlzIG5vdCBicm9rZW4uIEl0IGlzIHVucmVhZGFibGUsIHdoaWNoIHRoZSByZWFkZXIgY2Fubm90XG4gKnRlbGwgYXBhcnQuICovXG5leHBvcnQgZnVuY3Rpb24gd3JhcFdpZGVMYXllcnMobGF5b3V0OiBMYXllclJlc3VsdCwgbWF4ID0gREVGQVVMVF9NQVhfTEFZRVJfV0lEVEgpOiBMYXllclJlc3VsdCB7XG4gIGlmIChtYXggPD0gMCkgcmV0dXJuIGxheW91dDtcbiAgY29uc3QgbWVtYmVyczogbnVtYmVyW11bXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8PSBsYXlvdXQubWF4TGF5ZXI7IGkrKykgbWVtYmVycy5wdXNoKFtdKTtcbiAgbGF5b3V0LmxheWVycy5mb3JFYWNoKChsLCB2KSA9PiBtZW1iZXJzW2xdLnB1c2godikpO1xuXG4gIGNvbnN0IGxheWVycyA9IGxheW91dC5sYXllcnMuc2xpY2UoKTtcbiAgbGV0IG5leHQgPSAwO1xuICBsZXQgbWF4TGF5ZXIgPSAwO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBtZW1iZXJzKSB7XG4gICAgLy8gQW4gZW1wdHkgbGF5ZXIgc3RpbGwgY29uc3VtZXMgaXRzIGluZGV4LCBzbyBhIHBpbm5lZCBub2RlIHRoYXQgbmFtZWQgYSBmYXIgbGF5ZXIga2VlcHMgdGhlIGdhcCBpdCBhc2tlZCBmb3IuXG4gICAgY29uc3Qgcm93cyA9IHJvdy5sZW5ndGggPT09IDAgPyAxIDogTWF0aC5jZWlsKHJvdy5sZW5ndGggLyBtYXgpO1xuICAgIC8vIFdpZGVuIHRvIHRoZSBmbGF0dGVzdCBzcGxpdCByYXRoZXIgdGhhbiBmaWxsaW5nIGV2ZXJ5IHJvdyB0byBgbWF4YCBhbmQgbGVhdmluZyBhIHJlbWFpbmRlciBvZiBvbmUuXG4gICAgY29uc3QgcGVyID0gcm93Lmxlbmd0aCA9PT0gMCA/IDAgOiBNYXRoLmNlaWwocm93Lmxlbmd0aCAvIHJvd3MpO1xuICAgIHJvdy5mb3JFYWNoKCh2LCBpKSA9PiB7XG4gICAgICBsYXllcnNbdl0gPSBuZXh0ICsgTWF0aC5mbG9vcihpIC8gcGVyKTtcbiAgICB9KTtcbiAgICBtYXhMYXllciA9IE1hdGgubWF4KG1heExheWVyLCBuZXh0ICsgcm93cyAtIDEpO1xuICAgIG5leHQgKz0gcm93cztcbiAgfVxuICByZXR1cm4geyBsYXllcnMsIG1heExheWVyLCBpZ25vcmVkUGluczogbGF5b3V0Lmlnbm9yZWRQaW5zIH07XG59XG5cbi8qKlxuICogS2FobiB0b3BvbG9naWNhbCBvcmRlciBvdmVyIGFuIGFkamFjZW5jeSBsaXN0LCB0aWVzIGJyb2tlbiBieSBub2RlIGluZGV4XG4gKiBzbyB0aGUgcmVzdWx0IGlzIHRoZSBzYW1lIG9uIGV2ZXJ5IHJ1bi4gQSBncmFwaCB3aXRoIGEgY3ljbGUgbGVmdCBpbiBpdFxuICogd291bGQgc3RyYW5kIG5vZGVzOyB0aGV5IGFyZSBhcHBlbmRlZCBpbiBpbmRleCBvcmRlciByYXRoZXIgdGhhbiBkcm9wcGVkLFxuICogYmVjYXVzZSBsb3NpbmcgYSBub2RlIGlzIG5ldmVyIGFuIGFjY2VwdGFibGUgd2F5IHRvIHJlcG9ydCBhIGN5Y2xlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9wb09yZGVyKG91dDogcmVhZG9ubHkgKHJlYWRvbmx5IG51bWJlcltdKVtdLCBuOiBudW1iZXIpOiBudW1iZXJbXSB7XG4gIGNvbnN0IGluZGVnID0gbmV3IEludDMyQXJyYXkobik7XG4gIGZvciAobGV0IHYgPSAwOyB2IDwgbjsgdisrKSBmb3IgKGNvbnN0IHcgb2Ygb3V0W3ZdKSBpbmRlZ1t3XSsrO1xuICAvLyBBIGJpbmFyeSBoZWFwIHdpbGwgYmUgZmFzdGVyLlxuICBjb25zdCBmcm9udGllcjogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgdiA9IDA7IHYgPCBuOyB2KyspIGlmIChpbmRlZ1t2XSA9PT0gMCkgZnJvbnRpZXIucHVzaCh2KTtcbiAgY29uc3Qgb3JkZXI6IG51bWJlcltdID0gW107XG4gIGNvbnN0IGRvbmUgPSBuZXcgVWludDhBcnJheShuKTtcbiAgd2hpbGUgKGZyb250aWVyLmxlbmd0aCA+IDApIHtcbiAgICBmcm9udGllci5zb3J0KChhLCBiKSA9PiBhIC0gYik7XG4gICAgY29uc3QgdiA9IGZyb250aWVyLnNoaWZ0KCkgYXMgbnVtYmVyO1xuICAgIG9yZGVyLnB1c2godik7XG4gICAgZG9uZVt2XSA9IDE7XG4gICAgZm9yIChjb25zdCB3IG9mIG91dFt2XSkge1xuICAgICAgaWYgKC0taW5kZWdbd10gPT09IDApIGZyb250aWVyLnB1c2godyk7XG4gICAgfVxuICB9XG4gIGZvciAobGV0IHYgPSAwOyB2IDwgbjsgdisrKSBpZiAoIWRvbmVbdl0pIG9yZGVyLnB1c2godik7XG4gIHJldHVybiBvcmRlcjtcbn1cblxuLy8gLS0gRHVtbXkgbm9kZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEEgc2xvdCBpbiBhIGxheWVyOiBlaXRoZXIgYSByZWFsIG5vZGUgKGBub2RlYCBpcyBpdHMgaW5kZXgpIG9yIGEgYmVuZFxuICogcG9pbnQgc3RhbmRpbmcgaW4gZm9yIG9uZSBsb25nIGVkZ2UgY3Jvc3NpbmcgdGhpcyBsYXllci5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMYXllclNsb3Qge1xuICAvKiAqL1xuICBub2RlOiBudW1iZXI7XG4gIC8qICovXG4gIGVkZ2U6IG51bWJlcjtcbiAgbGF5ZXI6IG51bWJlcjtcbn1cblxuLyoqIExheWVycyB3aXRoIHRoZWlyIGxvbmcgZWRnZXMgYnJva2VuIGludG8gcGVyLWxheWVyIGJlbmQgcG9pbnRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQcm9wZXJMYXllcmluZyB7XG4gIC8qKiBTbG90cyBwZXIgbGF5ZXIsIGluIHRoZSBvcmRlciB0aGV5IHdpbGwgYmUgZHJhd24gYWNyb3NzIHRoZSBsYXllci4gKi9cbiAgbGF5ZXJzOiBMYXllclNsb3RbXVtdO1xuICAvKiogU3VjY2Vzc29ycyBvbmUgbGF5ZXIgZG93biwga2V5ZWQgYW5kIHZhbHVlZCBieSBzbG90IElERU5USVRZLiAqL1xuICBzdWNjOiBNYXA8c3RyaW5nLCBzdHJpbmdbXT47XG4gIC8qKiBQcmVkZWNlc3NvcnMgb25lIGxheWVyIHVwLCBsaWtld2lzZSBieSBpZGVudGl0eS4gKi9cbiAgcHJlZDogTWFwPHN0cmluZywgc3RyaW5nW10+O1xuICAvKiogUGVyIGVkZ2UgaW5kZXgsIGl0cyBiZW5kIHBvaW50cycgaWRlbnRpdGllcywgc291cmNlIHRvIHRhcmdldC4gKi9cbiAgY2hhaW5zOiBNYXA8bnVtYmVyLCBzdHJpbmdbXT47XG59XG5cbi8qKiBBIHNsb3QncyBpZGVudGl0eTogc3RhYmxlIHVuZGVyIGFueSByZW9yZGVyaW5nIG9mIGl0cyBsYXllci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzbG90SWRlbnRpdHkoczogTGF5ZXJTbG90KTogc3RyaW5nIHtcbiAgcmV0dXJuIHMubm9kZSA+PSAwID8gYG4ke3Mubm9kZX1gIDogYGQke3MuZWRnZX1AJHtzLmxheWVyfWA7XG59XG5cbi8qKiBTcGxpdCBldmVyeSBlZGdlIHRoYXQgc3BhbnMgbW9yZSB0aGFuIG9uZSBsYXllciBpbnRvIGEgY2hhaW4gb2ZcbiAqIHNpbmdsZS1sYXllciBzZWdtZW50cyB0aHJvdWdoIGR1bW15IHNsb3RzLiBUaGlzIGlzIHdoYXQgbWFrZXMgbG9uZyBlZGdlc1xuICogYmVoYXZlLiBXaXRoIHRoZSBkdW1taWVzLCBhIGxvbmcgZWRnZSBvY2N1cGllcyByZWFsIHdpZHRoIGluIGV2ZXJ5IGxheWVyXG4gKiBpdCBjcm9zc2VzLCBnZXRzIG9yZGVyZWQgbGlrZSBhbnl0aGluZyBlbHNlLCBhbmQgY29tZXMgb3V0IGFzIGEgcm91dGVkXG4gKiBwb2x5bGluZSBpbnN0ZWFkIG9mIGEgY2hvcmQgYWNyb3NzIHRoZSBkcmF3aW5nLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluc2VydER1bW1pZXMoZ3JhcGg6IERhZ0dyYXBoLCBhY3ljbGljOiBDeWNsZVJlc3VsdCwgbGF5b3V0OiBMYXllclJlc3VsdCk6IFByb3BlckxheWVyaW5nIHtcbiAgY29uc3QgbGF5ZXJzOiBMYXllclNsb3RbXVtdID0gW107XG4gIGZvciAobGV0IGwgPSAwOyBsIDw9IGxheW91dC5tYXhMYXllcjsgbCsrKSBsYXllcnMucHVzaChbXSk7XG4gIGdyYXBoLm5vZGVzLmZvckVhY2goKF8sIHYpID0+IHtcbiAgICBsYXllcnNbbGF5b3V0LmxheWVyc1t2XV0ucHVzaCh7IG5vZGU6IHYsIGVkZ2U6IC0xLCBsYXllcjogbGF5b3V0LmxheWVyc1t2XSB9KTtcbiAgfSk7XG5cbiAgY29uc3Qgc3VjYyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmdbXT4oKTtcbiAgY29uc3QgcHJlZCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmdbXT4oKTtcbiAgY29uc3QgY2hhaW5zID0gbmV3IE1hcDxudW1iZXIsIHN0cmluZ1tdPigpO1xuICBjb25zdCBsaW5rID0gKGE6IHN0cmluZywgYjogc3RyaW5nKTogdm9pZCA9PiB7XG4gICAgY29uc3QgbyA9IHN1Y2MuZ2V0KGEpO1xuICAgIGlmIChvKSBvLnB1c2goYik7XG4gICAgZWxzZSBzdWNjLnNldChhLCBbYl0pO1xuICAgIGNvbnN0IGkgPSBwcmVkLmdldChiKTtcbiAgICBpZiAoaSkgaS5wdXNoKGEpO1xuICAgIGVsc2UgcHJlZC5zZXQoYiwgW2FdKTtcbiAgfTtcblxuICBjb25zdCByZXZlcnNlZFNldCA9IG5ldyBTZXQoYWN5Y2xpYy5yZXZlcnNlZCk7XG4gIGdyYXBoLmVkZ2VzLmZvckVhY2goKGUsIGVpKSA9PiB7XG4gICAgY29uc3QgW2YsIHRdID0gcmV2ZXJzZWRTZXQuaGFzKGVpKSA/IFtlLnRvLCBlLmZyb21dIDogW2UuZnJvbSwgZS50b107XG4gICAgY29uc3QgbGYgPSBsYXlvdXQubGF5ZXJzW2ZdO1xuICAgIGNvbnN0IGx0ID0gbGF5b3V0LmxheWVyc1t0XTtcbiAgICBsZXQgcHJldiA9IGBuJHtmfWA7XG4gICAgY29uc3QgY2hhaW46IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChsZXQgbCA9IGxmICsgMTsgbCA8IGx0OyBsKyspIHtcbiAgICAgIGNvbnN0IHNsb3Q6IExheWVyU2xvdCA9IHsgbm9kZTogLTEsIGVkZ2U6IGVpLCBsYXllcjogbCB9O1xuICAgICAgbGF5ZXJzW2xdLnB1c2goc2xvdCk7XG4gICAgICBjb25zdCBpZCA9IHNsb3RJZGVudGl0eShzbG90KTtcbiAgICAgIGNoYWluLnB1c2goaWQpO1xuICAgICAgbGluayhwcmV2LCBpZCk7XG4gICAgICBwcmV2ID0gaWQ7XG4gICAgfVxuICAgIGxpbmsocHJldiwgYG4ke3R9YCk7XG4gICAgY2hhaW5zLnNldChlaSwgY2hhaW4pO1xuICB9KTtcblxuICByZXR1cm4geyBsYXllcnMsIHN1Y2MsIHByZWQsIGNoYWlucyB9O1xufVxuXG4vLyAtLSBPcmRlcmluZyAoY3Jvc3NpbmcgcmVkdWN0aW9uKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3dlZXBzIG9mIHRoZSBtZWRpYW4gaGV1cmlzdGljIHJ1biBiZWZvcmUgdGhlIHRyYW5zcG9zZSBwYXNzIGdpdmVzIHVwLiAqL1xuZXhwb3J0IGNvbnN0IE9SREVSX1NXRUVQUyA9IDE2O1xuXG4vKipcbiAqIFJlb3JkZXIgdGhlIHNsb3RzIGluc2lkZSBlYWNoIGxheWVyIHRvIHJlZHVjZSBlZGdlIGNyb3NzaW5nczogdGhlXG4gKiB3ZWlnaHRlZC1tZWRpYW4gaGV1cmlzdGljLCBzd2VwdCBkb3duIGFuZCB1cCBhbHRlcm5hdGVseSwgd2l0aCBhblxuICogYWRqYWNlbnQtdHJhbnNwb3NlIHBhc3MgYWZ0ZXIgZWFjaCBzd2VlcCB0aGF0IHN3YXBzIG5laWdoYm91cnMgd2hlbmV2ZXJcbiAqIHRoZSBzd2FwIHJlbW92ZXMgY3Jvc3NpbmdzLlxuICpcbiAqIENyb3NzaW5nIG1pbmltaXphdGlvbiBpcyBOUC1oYXJkLCBzbyB0aGlzIGlzIGEgaGV1cmlzdGljIGFuZCBpdCBpc1xuICogc3VwcG9zZWQgdG8gYmUuIFdoYXQgaXQgbXVzdCBiZSBpcyBtb25vdG9uZSBhbmQgZGV0ZXJtaW5pc3RpYzogdGhlIGJlc3RcbiAqIG9yZGVyaW5nIHNlZW4gc28gZmFyIGlzIGtlcHQsIGEgc3dlZXAgdGhhdCBtYWtlcyB0aGluZ3Mgd29yc2UgaXNcbiAqIGRpc2NhcmRlZCwgYW5kIGV2ZXJ5IHRpZSBicmVha3Mgb24gdGhlIHNsb3QncyBjdXJyZW50IHBvc2l0aW9uLiBNdXRhdGVzXG4gKiBgcHJvcGVyLmxheWVyc2AgaW4gcGxhY2UgYW5kIHJldHVybnMgdGhlIGNyb3NzaW5nIGNvdW50IGl0IHNldHRsZWQgb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcmRlckxheWVycyhwcm9wZXI6IFByb3BlckxheWVyaW5nLCBzd2VlcHMgPSBPUkRFUl9TV0VFUFMpOiBudW1iZXIge1xuICBjb25zdCB7IGxheWVycywgc3VjYywgcHJlZCB9ID0gcHJvcGVyO1xuICBsZXQgYmVzdCA9IGxheWVycy5tYXAoKGwpID0+IGwuc2xpY2UoKSk7XG4gIGxldCBiZXN0Q3Jvc3NpbmdzID0gY291bnRDcm9zc2luZ3MocHJvcGVyKTtcblxuICAvLyBaZXJvIGNyb3NzaW5ncyBpcyBOT1QgYSByZWFzb24gdG8gc2tpcCB0aGUgc3dlZXBzLiBpbnNlcnREdW1taWVzIGFwcGVuZHNcbiAgLy8gZXZlcnkgYmVuZCBwb2ludCB0byB0aGUgRU5EIG9mIGl0cyBsYXllci5cblxuICBjb25zdCBwb3NpdGlvbnNJbiA9IChsYXllcjogbnVtYmVyKTogTWFwPHN0cmluZywgbnVtYmVyPiA9PiB7XG4gICAgY29uc3QgbSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gICAgbGF5ZXJzW2xheWVyXS5mb3JFYWNoKChzLCBpKSA9PiBtLnNldChzbG90SWRlbnRpdHkocyksIGkpKTtcbiAgICByZXR1cm4gbTtcbiAgfTtcblxuICBmb3IgKGxldCBzID0gMDsgcyA8IHN3ZWVwczsgcysrKSB7XG4gICAgY29uc3QgZG93biA9IHMgJSAyID09PSAwO1xuICAgIGNvbnN0IHJhbmdlID0gZG93blxuICAgICAgPyBBcnJheS5mcm9tKHsgbGVuZ3RoOiBsYXllcnMubGVuZ3RoIC0gMSB9LCAoXywgaSkgPT4gaSArIDEpXG4gICAgICA6IEFycmF5LmZyb20oeyBsZW5ndGg6IGxheWVycy5sZW5ndGggLSAxIH0sIChfLCBpKSA9PiBsYXllcnMubGVuZ3RoIC0gMiAtIGkpO1xuICAgIGZvciAoY29uc3QgbCBvZiByYW5nZSkge1xuICAgICAgY29uc3QgZml4ZWRQb3MgPSBwb3NpdGlvbnNJbihkb3duID8gbCAtIDEgOiBsICsgMSk7XG4gICAgICBjb25zdCBhZGogPSBkb3duID8gcHJlZCA6IHN1Y2M7XG4gICAgICBjb25zdCB3aXRoSWR4ID0gbGF5ZXJzW2xdLm1hcCgoc2xvdCwgaSkgPT4ge1xuICAgICAgICBjb25zdCBwcyA9IChhZGouZ2V0KHNsb3RJZGVudGl0eShzbG90KSkgPz8gW10pXG4gICAgICAgICAgLm1hcCgoaykgPT4gZml4ZWRQb3MuZ2V0KGspKVxuICAgICAgICAgIC5maWx0ZXIoKHApOiBwIGlzIG51bWJlciA9PiBwICE9PSB1bmRlZmluZWQpXG4gICAgICAgICAgLnNvcnQoKGEsIGIpID0+IGEgLSBiKTtcbiAgICAgICAgaWYgKHBzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgc2xvdCwgaSwgbTogLTEgfTtcbiAgICAgICAgY29uc3QgbWlkID0gcHMubGVuZ3RoID4+IDE7XG4gICAgICAgIHJldHVybiB7IHNsb3QsIGksIG06IHBzLmxlbmd0aCAlIDIgPT09IDEgPyBwc1ttaWRdIDogKHBzW21pZCAtIDFdICsgcHNbbWlkXSkgLyAyIH07XG4gICAgICB9KTtcbiAgICAgIHdpdGhJZHguc29ydCgoYSwgYikgPT4ge1xuICAgICAgICBpZiAoYS5tIDwgMCB8fCBiLm0gPCAwKSByZXR1cm4gYS5pIC0gYi5pO1xuICAgICAgICByZXR1cm4gYS5tICE9PSBiLm0gPyBhLm0gLSBiLm0gOiBhLmkgLSBiLmk7XG4gICAgICB9KTtcbiAgICAgIGxheWVyc1tsXSA9IHdpdGhJZHgubWFwKCh3KSA9PiB3LnNsb3QpO1xuICAgIH1cbiAgICB0cmFuc3Bvc2UocHJvcGVyKTtcbiAgICBjb25zdCBjID0gY291bnRDcm9zc2luZ3MocHJvcGVyKTtcbiAgICAvLyBBIFRJRSBpcyBhY2NlcHRlZCwgbm90IGFuIGltcHJvdmVtZW50LlxuICAgIGlmIChjIDw9IGJlc3RDcm9zc2luZ3MpIHtcbiAgICAgIGJlc3RDcm9zc2luZ3MgPSBjO1xuICAgICAgYmVzdCA9IGxheWVycy5tYXAoKHgpID0+IHguc2xpY2UoKSk7XG4gICAgfVxuICB9XG4gIGZvciAobGV0IGwgPSAwOyBsIDwgbGF5ZXJzLmxlbmd0aDsgbCsrKSBsYXllcnNbbF0gPSBiZXN0W2xdO1xuICByZXR1cm4gYmVzdENyb3NzaW5ncztcbn1cblxuLyoqIEFkamFjZW50LWV4Y2hhbmdlIHBhc3M6IHN3YXAgbmVpZ2hib3VyaW5nIHNsb3RzIHdoZW5ldmVyIHRoZSBzd2FwXG4gKiBzdHJpY3RseSByZWR1Y2VzIHRoZSBjcm9zc2luZ3MgYmV0d2VlbiB0aGlzIGxheWVyIGFuZCBpdHMgbmVpZ2hib3Vycy4gUnVuc1xuICogdW50aWwgYSBmdWxsIHBhc3MgY2hhbmdlcyBub3RoaW5nLCBvciB0aGUgZ3VhcmQgdHJpcHMgLS0gYSBoZXVyaXN0aWMgdGhhdFxuICogY2Fubm90IHRlcm1pbmF0ZSB3b3VsZCBoYW5nIHRoZSBsYXlvdXQsIGFuZCB0aGUgZ3VhcmQgaXMgd2hhdCBtYWtlcyB0aGF0XG4gKiBpbXBvc3NpYmxlIHJhdGhlciB0aGFuIHVubGlrZWx5LiAqL1xuZnVuY3Rpb24gdHJhbnNwb3NlKHByb3BlcjogUHJvcGVyTGF5ZXJpbmcpOiB2b2lkIHtcbiAgbGV0IGltcHJvdmVkID0gdHJ1ZTtcbiAgbGV0IGd1YXJkID0gMDtcbiAgd2hpbGUgKGltcHJvdmVkICYmIGd1YXJkKysgPCBUUkFOU1BPU0VfUEFTU19DQVApIHtcbiAgICBpbXByb3ZlZCA9IGZhbHNlO1xuICAgIGZvciAobGV0IGwgPSAwOyBsIDwgcHJvcGVyLmxheWVycy5sZW5ndGg7IGwrKykge1xuICAgICAgY29uc3Qgcm93ID0gcHJvcGVyLmxheWVyc1tsXTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpICsgMSA8IHJvdy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBiZWZvcmUgPSBsb2NhbENyb3NzaW5ncyhwcm9wZXIsIGwpO1xuICAgICAgICBjb25zdCB0bXAgPSByb3dbaV07XG4gICAgICAgIHJvd1tpXSA9IHJvd1tpICsgMV07XG4gICAgICAgIHJvd1tpICsgMV0gPSB0bXA7XG4gICAgICAgIGlmIChsb2NhbENyb3NzaW5ncyhwcm9wZXIsIGwpIDwgYmVmb3JlKSB7XG4gICAgICAgICAgaW1wcm92ZWQgPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJvd1tpICsgMV0gPSByb3dbaV07XG4gICAgICAgICAgcm93W2ldID0gdG1wO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbi8qKiBGdWxsIHRyYW5zcG9zZSBwYXNzZXMgYmVmb3JlIHRoZSBleGNoYW5nZSBsb29wIHN0b3BzIChzZWUgdHJhbnNwb3NlKS4gKi9cbmNvbnN0IFRSQU5TUE9TRV9QQVNTX0NBUCA9IDY0O1xuXG4vKiogQ3Jvc3NpbmdzIGJldHdlZW4gYGxheWVyYCBhbmQgaXRzIGltbWVkaWF0ZSBuZWlnaGJvdXJzIG9ubHkuICovXG5mdW5jdGlvbiBsb2NhbENyb3NzaW5ncyhwcm9wZXI6IFByb3BlckxheWVyaW5nLCBsYXllcjogbnVtYmVyKTogbnVtYmVyIHtcbiAgbGV0IGMgPSAwO1xuICBpZiAobGF5ZXIgPiAwKSBjICs9IGNyb3NzaW5nc0JldHdlZW4ocHJvcGVyLCBsYXllciAtIDEpO1xuICBpZiAobGF5ZXIgKyAxIDwgcHJvcGVyLmxheWVycy5sZW5ndGgpIGMgKz0gY3Jvc3NpbmdzQmV0d2Vlbihwcm9wZXIsIGxheWVyKTtcbiAgcmV0dXJuIGM7XG59XG5cbi8qKiBUb3RhbCBjcm9zc2luZ3MgYWNyb3NzIGV2ZXJ5IGFkamFjZW50IGxheWVyIHBhaXIuICovXG5leHBvcnQgZnVuY3Rpb24gY291bnRDcm9zc2luZ3MocHJvcGVyOiBQcm9wZXJMYXllcmluZyk6IG51bWJlciB7XG4gIGxldCBjID0gMDtcbiAgZm9yIChsZXQgbCA9IDA7IGwgKyAxIDwgcHJvcGVyLmxheWVycy5sZW5ndGg7IGwrKykgYyArPSBjcm9zc2luZ3NCZXR3ZWVuKHByb3BlciwgbCk7XG4gIHJldHVybiBjO1xufVxuXG4vKiogQ3Jvc3NpbmdzIGJldHdlZW4gbGF5ZXIgYGxgIGFuZCBgbCArIDFgLCBjb3VudGVkIGJ5IHRoZSBwYWlyIHJ1bGU6IGVkZ2VzXG4gKiBjcm9zcyBleGFjdGx5IHdoZW4gdGhlaXIgZW5kcG9pbnRzIGFyZSBpbiBvcHBvc2l0ZSBvcmRlciBvbiBib3RoIGxheWVycy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcm9zc2luZ3NCZXR3ZWVuKHByb3BlcjogUHJvcGVyTGF5ZXJpbmcsIGw6IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IHVwcGVyID0gcHJvcGVyLmxheWVyc1tsXTtcbiAgY29uc3QgbG93ZXIgPSBwcm9wZXIubGF5ZXJzW2wgKyAxXTtcbiAgY29uc3QgbG93ZXJQb3MgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICBsb3dlci5mb3JFYWNoKChzLCBpKSA9PiBsb3dlclBvcy5zZXQoc2xvdElkZW50aXR5KHMpLCBpKSk7XG4gIGNvbnN0IHBhaXJzOiB7IHU6IG51bWJlcjsgdjogbnVtYmVyIH1bXSA9IFtdO1xuICB1cHBlci5mb3JFYWNoKChzLCBpKSA9PiB7XG4gICAgZm9yIChjb25zdCBrIG9mIHByb3Blci5zdWNjLmdldChzbG90SWRlbnRpdHkocykpID8/IFtdKSB7XG4gICAgICBjb25zdCB2ID0gbG93ZXJQb3MuZ2V0KGspO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCkgcGFpcnMucHVzaCh7IHU6IGksIHYgfSk7XG4gICAgfVxuICB9KTtcbiAgbGV0IGMgPSAwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhaXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgcGFpcnMubGVuZ3RoOyBqKyspIHtcbiAgICAgIGNvbnN0IGEgPSBwYWlyc1tpXTtcbiAgICAgIGNvbnN0IGIgPSBwYWlyc1tqXTtcbiAgICAgIGlmICgoYS51IC0gYi51KSAqIChhLnYgLSBiLnYpIDwgMCkgYysrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gYztcbn1cblxuLy8gLS0gQ29vcmRpbmF0ZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBCb3ggc2l6ZSBvZiBhIG5vZGUgaW4gbGF5b3V0IHVuaXRzIChDU1MgcHggYmVmb3JlIHRoZSB2aWV3cG9ydCBzY2FsZSkuICovXG5leHBvcnQgaW50ZXJmYWNlIE5vZGVTaXplIHtcbiAgdzogbnVtYmVyO1xuICBoOiBudW1iZXI7XG59XG5cbi8qKiBTcGFjaW5nIGtub2JzIGZvciBhc3NpZ25Db29yZGluYXRlcy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29vcmRPcHRpb25zIHtcbiAgLyoqIEdhcCBiZXR3ZWVuIGFkamFjZW50IGJveGVzIHdpdGhpbiBhIGxheWVyLiAqL1xuICBnYXA/OiBudW1iZXI7XG4gIC8qKiBHYXAgYmV0d2VlbiBhZGphY2VudCBlZGdlIHJvdXRpbmcgc2xvdHMuIFNlZSBERUZBVUxUX1JPVVRFX0dBUC4gKi9cbiAgcm91dGVHYXA/OiBudW1iZXI7XG4gIC8qKiBHYXAgYmV0d2VlbiBsYXllcnMsIG1lYXN1cmVkIGJldHdlZW4gZmFjaW5nIGVkZ2VzLiAqL1xuICBsYXllckdhcD86IG51bWJlcjtcbiAgLyoqIENyb3NzLWF4aXMgd2lkdGggcmVzZXJ2ZWQgZm9yIGEgZHVtbXkgKGFuIGVkZ2UgcGFzc2luZyB0aHJvdWdoKS4gKi9cbiAgZHVtbXlXaWR0aD86IG51bWJlcjtcbiAgLyoqIFN0cmFpZ2h0ZW5pbmcgcGFzc2VzLiBNb3JlIGlzIHN0cmFpZ2h0ZXIgYW5kIHNsb3dlci4gKi9cbiAgcGFzc2VzPzogbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9HQVAgPSAyNDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0xBWUVSX0dBUCA9IDU2O1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfRFVNTVlfV0lEVEggPSAxMjtcbi8qKiBTdHJhaWdodGVuaW5nIHBhc3Nlcy4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX0NPT1JEX1BBU1NFUyA9IDEyO1xuXG4vKiogRWRnZSByb3V0aW5nIHNsb3RzIHNpZGUgYnkgc2lkZSBuZWVkIGVub3VnaCByb29tIHRvIHJlYWQgYXMgYSBjb3VwbGUgb2YgbGluZXMgYW5kIG5vIG1vcmUuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9ST1VURV9HQVAgPSAxMDtcblxuLyoqIFB1dCBlYWNoIHNsb3QgYXMgY2xvc2UgYXMgaXQgY2FuIGdldCB0byB3aGVyZSBpdCBXQU5UUyB0byBiZSwga2VlcGluZyB0aGUgcm93J3Mgb3JkZXIgYW5kIGEgbWluaW11bSBnYXAgYmV0d2VlbiBuZWlnaGJvdXJzLiBUaGlzIGlzIHRoZSB3aG9sZSBkaWZmZXJlbmNlIGJldHdlZW4gYSBkcmF3aW5nIHRoYXQgcmVhZHMgYW5kIHRoZSBzdHJpcCB0aGlzIHJlcGxhY2VkLiBNaW5pbWl6aW5nIHRoZSB0b3RhbCBkaXN0YW5jZSBmcm9tIHRoZSBkZXNpcmVkIHBvc2l0aW9ucyBjYW5ub3QgZG8gdGhhdC4gV2hlcmUgdGhlIGRlc2lyZXMgYWxyZWFkeSBmaXQsIHRoZXkgYXJlIHVzZWQgdW5jaGFuZ2VkLiBXaGVyZSB0aGV5IGNvbGxpZGUsIHRoZSBibG9jayB0aGF0IGZvcm1zXG4gKnNpdHMgYXQgaXRzIG1lbWJlcnMnIG1lZGlhbiwgd2hpY2ggaXMgdGhlIHBvc2l0aW9uIHRoYXQgbWluaW1pemVzIHRoZSBzdW0gb2YgYWJzb2x1dGUgZXJyb3JzLiBTbyBhIHJvdyBpcyBuZXZlciB3aWRlciB0aGFuIHdoYXQgaXRzIG93biBub2RlcyBhc2tlZCBmb3IuIFRoZSBjb25zdHJhaW50IHhbaV0gLSB4W2ktMV0gPj0gZ2FwW2ldIGJlY29tZXMgYSBwbGFpbiBcIm5vdCBkZWNyZWFzaW5nXCIgb25jZSBlYWNoIHBvc2l0aW9uIGlzIHNoaWZ0ZWQgYnkgdGhlIGdhcHMgYmVmb3JlIGl0LCB3aGljaCBpcyB0aGUgc3RhbmRhcmQgaXNvdG9uaWMgcmVncmVzc2lvbiB0aGF0IHBvb2wtYWRqYWNlbnQtdmlvbGF0b3JzIHNvbHZlcyBleGFjdGx5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpdFRvRGVzaXJlZChkZXNpcmVkOiByZWFkb25seSBudW1iZXJbXSwgZ2FwOiByZWFkb25seSBudW1iZXJbXSk6IG51bWJlcltdIHtcbiAgY29uc3QgbiA9IGRlc2lyZWQubGVuZ3RoO1xuICBpZiAobiA9PT0gMCkgcmV0dXJuIFtdO1xuXG4gIC8vIFNoaWZ0IG91dCB0aGUgZ2Fwcywgc28gdGhlIG9ubHkgcmVtYWluaW5nIGNvbnN0cmFpbnQgaXMgbW9ub3RvbmljaXR5LlxuICBjb25zdCBwcmVmaXggPSBuZXcgQXJyYXk8bnVtYmVyPihuKS5maWxsKDApO1xuICBmb3IgKGxldCBpID0gMTsgaSA8IG47IGkrKykgcHJlZml4W2ldID0gcHJlZml4W2kgLSAxXSArIChnYXBbaV0gPz8gMCk7XG4gIGNvbnN0IHRhcmdldCA9IGRlc2lyZWQubWFwKChkLCBpKSA9PiBkIC0gcHJlZml4W2ldKTtcblxuICAvLyBFYWNoIGJsb2NrIGtlZXBzIGl0cyBtZW1iZXJzJyB2YWx1ZXMgc29ydGVkLCBzbyBpdHMgbWVkaWFuIGlzIGEgbG9va3VwLlxuICBjb25zdCBibG9ja1ZhbHVlczogbnVtYmVyW11bXSA9IFtdO1xuICBjb25zdCBibG9ja0NvdW50OiBudW1iZXJbXSA9IFtdO1xuICBjb25zdCBtZWRpYW4gPSAodjogcmVhZG9ubHkgbnVtYmVyW10pOiBudW1iZXIgPT4ge1xuICAgIGNvbnN0IG0gPSB2Lmxlbmd0aCA+PiAxO1xuICAgIHJldHVybiB2Lmxlbmd0aCAlIDIgPT09IDEgPyB2W21dIDogKHZbbSAtIDFdICsgdlttXSkgLyAyO1xuICB9O1xuXG4gIGZvciAoY29uc3QgdCBvZiB0YXJnZXQpIHtcbiAgICBibG9ja1ZhbHVlcy5wdXNoKFt0XSk7XG4gICAgYmxvY2tDb3VudC5wdXNoKDEpO1xuICAgIC8vIEEgYmxvY2sgdGhhdCB3YW50cyB0byBzaXQgbGVmdCBvZiB0aGUgb25lIGJlZm9yZSBpdCBjYW5ub3Q6IG1lcmdlIHRoZW1cbiAgICAvLyBhbmQgbGV0IHRoZSBwYWlyIHNoYXJlIG9uZSBwb3NpdGlvbi5cbiAgICB3aGlsZSAoYmxvY2tWYWx1ZXMubGVuZ3RoID4gMSkge1xuICAgICAgY29uc3QgYiA9IGJsb2NrVmFsdWVzLmxlbmd0aCAtIDE7XG4gICAgICBpZiAobWVkaWFuKGJsb2NrVmFsdWVzW2IgLSAxXSkgPD0gbWVkaWFuKGJsb2NrVmFsdWVzW2JdKSkgYnJlYWs7XG4gICAgICBjb25zdCBtZXJnZWQ6IG51bWJlcltdID0gW107XG4gICAgICBsZXQgaSA9IDA7XG4gICAgICBsZXQgaiA9IDA7XG4gICAgICBjb25zdCBsZWZ0ID0gYmxvY2tWYWx1ZXNbYiAtIDFdO1xuICAgICAgY29uc3QgcmlnaHQgPSBibG9ja1ZhbHVlc1tiXTtcbiAgICAgIHdoaWxlIChpIDwgbGVmdC5sZW5ndGggfHwgaiA8IHJpZ2h0Lmxlbmd0aCkge1xuICAgICAgICBpZiAoaiA+PSByaWdodC5sZW5ndGggfHwgKGkgPCBsZWZ0Lmxlbmd0aCAmJiBsZWZ0W2ldIDw9IHJpZ2h0W2pdKSkgbWVyZ2VkLnB1c2gobGVmdFtpKytdKTtcbiAgICAgICAgZWxzZSBtZXJnZWQucHVzaChyaWdodFtqKytdKTtcbiAgICAgIH1cbiAgICAgIGJsb2NrVmFsdWVzLnNwbGljZShiIC0gMSwgMiwgbWVyZ2VkKTtcbiAgICAgIGJsb2NrQ291bnQuc3BsaWNlKGIgLSAxLCAyLCBibG9ja0NvdW50W2IgLSAxXSArIGJsb2NrQ291bnRbYl0pO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IG91dCA9IG5ldyBBcnJheTxudW1iZXI+KG4pO1xuICBsZXQgYXQgPSAwO1xuICBmb3IgKGxldCBiID0gMDsgYiA8IGJsb2NrVmFsdWVzLmxlbmd0aDsgYisrKSB7XG4gICAgY29uc3QgdiA9IG1lZGlhbihibG9ja1ZhbHVlc1tiXSk7XG4gICAgZm9yIChsZXQgayA9IDA7IGsgPCBibG9ja0NvdW50W2JdOyBrKyspIG91dFthdCArIGtdID0gdiArIHByZWZpeFthdCArIGtdO1xuICAgIGF0ICs9IGJsb2NrQ291bnRbYl07XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIEEgbGFpZC1vdXQgc2xvdDogaXRzIGNyb3NzLWF4aXMgY2VudGVyIGFuZCBpdHMgZXh0ZW50IGFsb25nIHRoZSBsYXllciBheGlzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTbG90UGxhY2VtZW50IHtcbiAgLyoqIENlbnRlciBvbiB0aGUgY3Jvc3MgYXhpcyAoeCBpbiAnVEInLCB5IGluICdMUicpLiAqL1xuICBjOiBudW1iZXI7XG4gIC8qKiBTdGFydCBvbiB0aGUgbGF5ZXIgYXhpcyAoeSBpbiAnVEInLCB4IGluICdMUicpLiAqL1xuICBsOiBudW1iZXI7XG4gIC8qKiBTaXplIG9uIHRoZSBjcm9zcyBheGlzLiAqL1xuICBjU2l6ZTogbnVtYmVyO1xuICAvKiogU2l6ZSBvbiB0aGUgbGF5ZXIgYXhpcy4gKi9cbiAgbFNpemU6IG51bWJlcjtcbn1cblxuLyoqIEV2ZXJ5IHNsb3QgcGxhY2VkLCBwbHVzIHRoZSBkcmF3aW5nJ3Mgb3duIGV4dGVudC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29vcmRSZXN1bHQge1xuICAvKiogUGxhY2VtZW50IHBlciBsYXllciwgcGFyYWxsZWwgdG8gYHByb3Blci5sYXllcnNgLiAqL1xuICBwbGFjZW1lbnRzOiBTbG90UGxhY2VtZW50W11bXTtcbiAgLyoqIFRvdGFsIGNyb3NzLWF4aXMgZXh0ZW50IG9mIHRoZSBkcmF3aW5nLiAqL1xuICBjcm9zc0V4dGVudDogbnVtYmVyO1xuICAvKiogVG90YWwgbGF5ZXItYXhpcyBleHRlbnQgb2YgdGhlIGRyYXdpbmcuICovXG4gIGxheWVyRXh0ZW50OiBudW1iZXI7XG59XG5cbi8qKiBHaXZlIGV2ZXJ5IHNsb3QgYSBjcm9zcy1heGlzIGNlbnRlci4gVGhlIGZpcnN0IHBhc3MgcGFja3MgZWFjaCBsYXllciBsZWZ0IHRvIHJpZ2h0IGF0IHRoZSBtaW5pbXVtIGdhcCwgd2hpY2ggaXMgY29ycmVjdCBhbmQgdWdseTogYSBjaGFpbiBvZiBzaW5nbGUgbm9kZXMgY29tZXMgb3V0IGFzIGEgc3RhaXJjYXNlLiBUaGUgc3RyYWlnaHRlbmluZyBwYXNzZXMgdGhlbiByZXBlYXRlZGx5IHB1bGwgZWFjaCBzbG90IHRvd2FyZCB0aGUgbWVkaWFuIG9mIGl0cyBuZWlnaGJvdXJzIGluIHRoZSBhZGphY2VudCBsYXllciBhbmQgcmUtc2VwYXJhdGUgYW55IG92ZXJsYXAgdGhlIHB1bGwgY3JlYXRlZCwgYWx0ZXJuYXRpbmcgZGlyZWN0aW9uLiBUaGF0IGlzIHRoZSBwcmlvcml0eSBtZXRob2QgcmF0aGVyIHRoYW4gZnVsbCBCcmFuZGVzLUtvcGYsIGFuZCB0aGUgcHJvcGVydHkgaXQgYnV5cyBpcyB0aGUgb25lIHRoYXQgbWF0dGVycyB0byBhIHJlYWRlcjogYSBzdHJhaWdodCBkZXBlbmRlbmN5IGNoYWluIGRyYXdzIGFzIGEgc3RyYWlnaHQgbGluZSwgYW5kIGEgbG9uZyBlZGdlJ3MgYmVuZCBwb2ludHMgbGluZSB1cFxuICp3aXRoIGVhY2ggb3RoZXIgaW5zdGVhZCBvZiB6aWctemFnZ2luZy4gVGhlIHNlcGFyYXRpb24gc3RlcCBydW5zIEFGVEVSIGV2ZXJ5IHB1bGwsIG5ldmVyIGFzIGEgZmluYWwgdGlkeS11cDogYSBsYXlvdXQgdGhhdCByZXNvbHZlcyBvdmVybGFwcyBvbmNlIGF0IHRoZSBlbmQgY2FuIHN0aWxsIGhhbmQgYmFjayBvdmVybGFwcGluZyBib3hlcywgYW5kIGJveGVzIGRyYXduIG9uIHRvcCBvZiBlYWNoIG90aGVyIGlzIHdvcnNlIHRoYW4gYW55IGFtb3VudCBvZiBjcm9va2VkbmVzcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NpZ25Db29yZGluYXRlcyhcbiAgcHJvcGVyOiBQcm9wZXJMYXllcmluZyxcbiAgc2l6ZXM6IHJlYWRvbmx5IE5vZGVTaXplW10sXG4gIG9wdHM6IENvb3JkT3B0aW9ucyA9IHt9LFxuKTogQ29vcmRSZXN1bHQge1xuICBjb25zdCBnYXAgPSBvcHRzLmdhcCA/PyBERUZBVUxUX0dBUDtcbiAgY29uc3Qgcm91dGVHYXAgPSBvcHRzLnJvdXRlR2FwID8/IERFRkFVTFRfUk9VVEVfR0FQO1xuICBjb25zdCBsYXllckdhcCA9IG9wdHMubGF5ZXJHYXAgPz8gREVGQVVMVF9MQVlFUl9HQVA7XG4gIGNvbnN0IGR1bW15VyA9IG9wdHMuZHVtbXlXaWR0aCA/PyBERUZBVUxUX0RVTU1ZX1dJRFRIO1xuICBjb25zdCBwYXNzZXMgPSBvcHRzLnBhc3NlcyA/PyBERUZBVUxUX0NPT1JEX1BBU1NFUztcbiAgY29uc3Qgcm93cyA9IHByb3Blci5sYXllcnM7XG5cbiAgY29uc3QgY1NpemVPZiA9IChzOiBMYXllclNsb3QpOiBudW1iZXIgPT4gKHMubm9kZSA+PSAwID8gc2l6ZXNbcy5ub2RlXS53IDogZHVtbXlXKTtcbiAgY29uc3QgbFNpemVPZiA9IChzOiBMYXllclNsb3QpOiBudW1iZXIgPT4gKHMubm9kZSA+PSAwID8gc2l6ZXNbcy5ub2RlXS5oIDogMCk7XG5cbiAgLy8gQSBib3ggYWdhaW5zdCBhbnl0aGluZyBuZWVkcyB0aGUgZnVsbCBnYXAuXG4gIGNvbnN0IGdhcEJldHdlZW4gPSAoYTogTGF5ZXJTbG90LCBiOiBMYXllclNsb3QpOiBudW1iZXIgPT4gKGEubm9kZSA8IDAgJiYgYi5ub2RlIDwgMCA/IHJvdXRlR2FwIDogZ2FwKTtcblxuICAvLyBNaW5pbXVtIGNlbnRlci10by1jZW50ZXIgZGlzdGFuY2UgZm9yIGVhY2ggc2xvdCBmcm9tIHRoZSBvbmUgYmVmb3JlIGl0LlxuICBjb25zdCBnYXBzRm9yID0gKHJvdzogcmVhZG9ubHkgTGF5ZXJTbG90W10pOiBudW1iZXJbXSA9PlxuICAgIHJvdy5tYXAoKHMsIGkpID0+IChpID09PSAwID8gMCA6IGNTaXplT2Yocm93W2kgLSAxXSkgLyAyICsgZ2FwQmV0d2Vlbihyb3dbaSAtIDFdLCBzKSArIGNTaXplT2YocykgLyAyKSk7XG5cbiAgLy8gTGF5ZXItYXhpcyBvZmZzZXRzOiBlYWNoIGxheWVyIGlzIGFzIHRhbGwgYXMgaXRzIHRhbGxlc3QgYm94LlxuICBjb25zdCBsYXllclN0YXJ0OiBudW1iZXJbXSA9IFtdO1xuICBjb25zdCBsYXllclRoaWNrOiBudW1iZXJbXSA9IFtdO1xuICBsZXQgY3Vyc29yID0gMDtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGxldCB0aGljayA9IDA7XG4gICAgZm9yIChjb25zdCBzIG9mIHJvdykgdGhpY2sgPSBNYXRoLm1heCh0aGljaywgbFNpemVPZihzKSk7XG4gICAgbGF5ZXJTdGFydC5wdXNoKGN1cnNvcik7XG4gICAgbGF5ZXJUaGljay5wdXNoKHRoaWNrKTtcbiAgICBjdXJzb3IgKz0gdGhpY2sgKyBsYXllckdhcDtcbiAgfVxuICBjb25zdCBsYXllckV4dGVudCA9IE1hdGgubWF4KDAsIGN1cnNvciAtIGxheWVyR2FwKTtcblxuICAvLyBJbml0aWFsIHBhY2tpbmcuXG4gIGNvbnN0IGNlbnRlcnM6IG51bWJlcltdW10gPSByb3dzLm1hcCgocm93KSA9PiB7XG4gICAgY29uc3QgZ2FwcyA9IGdhcHNGb3Iocm93KTtcbiAgICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gICAgbGV0IHggPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcm93Lmxlbmd0aDsgaSsrKSB7XG4gICAgICB4ID0gaSA9PT0gMCA/IGNTaXplT2Yocm93WzBdKSAvIDIgOiB4ICsgZ2Fwc1tpXTtcbiAgICAgIG91dC5wdXNoKHgpO1xuICAgIH1cbiAgICByZXR1cm4gb3V0O1xuICB9KTtcblxuICBjb25zdCBuZWlnaGJvdXJNZWRpYW4gPSAobDogbnVtYmVyLCBpOiBudW1iZXIsIHVwOiBib29sZWFuKTogbnVtYmVyIHwgbnVsbCA9PiB7XG4gICAgY29uc3QgcyA9IHJvd3NbbF1baV07XG4gICAgY29uc3Qga2V5cyA9ICh1cCA/IHByb3Blci5wcmVkIDogcHJvcGVyLnN1Y2MpLmdldChzbG90SWRlbnRpdHkocykpID8/IFtdO1xuICAgIGlmIChrZXlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgdGFyZ2V0ID0gdXAgPyBsIC0gMSA6IGwgKyAxO1xuICAgIGlmICh0YXJnZXQgPCAwIHx8IHRhcmdldCA+PSByb3dzLmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgcG9zQnlJZGVudGl0eSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gICAgcm93c1t0YXJnZXRdLmZvckVhY2goKHQsIHRpKSA9PiBwb3NCeUlkZW50aXR5LnNldChzbG90SWRlbnRpdHkodCksIHRpKSk7XG4gICAgY29uc3QgY3MgPSBrZXlzXG4gICAgICAubWFwKChrKSA9PiBwb3NCeUlkZW50aXR5LmdldChrKSlcbiAgICAgIC5maWx0ZXIoKHApOiBwIGlzIG51bWJlciA9PiBwICE9PSB1bmRlZmluZWQpXG4gICAgICAubWFwKChwKSA9PiBjZW50ZXJzW3RhcmdldF1bcF0pXG4gICAgICAuc29ydCgoYSwgYikgPT4gYSAtIGIpO1xuICAgIGlmIChjcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG0gPSBjcy5sZW5ndGggPj4gMTtcbiAgICByZXR1cm4gY3MubGVuZ3RoICUgMiA9PT0gMSA/IGNzW21dIDogKGNzW20gLSAxXSArIGNzW21dKSAvIDI7XG4gIH07XG5cbiAgY29uc3Qgc2VwYXJhdGUgPSAobDogbnVtYmVyKTogdm9pZCA9PiB7XG4gICAgY2VudGVyc1tsXSA9IGZpdFRvRGVzaXJlZChjZW50ZXJzW2xdLCBnYXBzRm9yKHJvd3NbbF0pKTtcbiAgfTtcblxuICAvLyBBIHNsb3Qgd2l0aCBhbiBlZGdlIGF0IGVpdGhlciBlbmQgaGFzIGEgcmVhc29uIHRvIHNpdCB3aGVyZSB0aGVcbiAgLy8gc3RyYWlnaHRlbmluZyBwdXQgaXQuIE9uZSB3aXRoIG5vIGVkZ2UgYXQgYWxsIGhhcyBub25lLlxuICBjb25zdCBhbmNob3JlZCA9IChzOiBMYXllclNsb3QpOiBib29sZWFuID0+IHtcbiAgICBjb25zdCBrZXkgPSBzbG90SWRlbnRpdHkocyk7XG4gICAgcmV0dXJuIChwcm9wZXIucHJlZC5nZXQoa2V5KT8ubGVuZ3RoID8/IDApID4gMCB8fCAocHJvcGVyLnN1Y2MuZ2V0KGtleSk/Lmxlbmd0aCA/PyAwKSA+IDA7XG4gIH07XG5cbiAgLyoqXG4gICAqIENsb3NlIHRoZSBzbGFjayB0aGUgc3RyYWlnaHRlbmluZyBvcGVucyB1cC5cbiAgICpcbiAgICogc2VwYXJhdGUoKSBlbmZvcmNlcyBhIE1JTklNVU0gZGlzdGFuY2UgYW5kIG5vdGhpbmcgZW5mb3JjZXMgYSBtYXhpbXVtLFxuICAgKiBzbyBhIG5vZGUgcHVsbGVkIHRvd2FyZCBhIGZhci1vZmYgbmVpZ2hib3VyJ3MgbWVkaWFuIGxlYXZlcyBhIGhvbGUgd2hlcmVcbiAgICogaXQgdXNlZCB0byBiZSwgYW5kIGFuIHVuYW5jaG9yZWQgbm9kZSBrZWVwcyB3aGF0ZXZlciBwb3NpdGlvbiB0aGVcbiAgICogaW5pdGlhbCBwYWNraW5nIGdhdmUgaXQuIE9uIGEgZ3JhcGggd2hvc2Ugbm9kZXMgYXJlIG1vc3RseSB1bmNvbm5lY3RlZFxuICAgKiB0aGF0IHJlYWRzIGFzIGJveGVzIGh1ZGRsZWQgYXQgYm90aCBlbmRzIG9mIGEgcm93IHdpdGggYSB2b2lkIGJldHdlZW5cbiAgICogdGhlbSwgd2hpY2ggaXMgbm90IGEgZmFjdCBhYm91dCB0aGUgZGVwZW5kZW5jaWVzLlxuICAgKlxuICAgKiBPbmx5IHVuYW5jaG9yZWQgc2xvdHMgbW92ZSwgYW5kIG9ubHkgdXAgYWdhaW5zdCBhIG5laWdoYm91ciwgc28gbm9cbiAgICogYWxpZ25tZW50IHRoZSBzdHJhaWdodGVuaW5nIGVhcm5lZCBpcyB1bmRvbmUuXG4gICAqL1xuICBjb25zdCBjb21wYWN0ID0gKGw6IG51bWJlcik6IHZvaWQgPT4ge1xuICAgIGNvbnN0IHJvdyA9IHJvd3NbbF07XG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPCByb3cubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChhbmNob3JlZChyb3dbaV0pKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IG1pbiA9IGNlbnRlcnNbbF1baSAtIDFdICsgY1NpemVPZihyb3dbaSAtIDFdKSAvIDIgKyBnYXBCZXR3ZWVuKHJvd1tpIC0gMV0sIHJvd1tpXSkgKyBjU2l6ZU9mKHJvd1tpXSkgLyAyO1xuICAgICAgaWYgKGNlbnRlcnNbbF1baV0gPiBtaW4pIGNlbnRlcnNbbF1baV0gPSBtaW47XG4gICAgfVxuICAgIC8vIEEgcm93IHRoYXQgT1BFTlMgd2l0aCB1bmFuY2hvcmVkIHNsb3RzIGNhbm5vdCBjbG9zZSBpdHMgZ2FwIGJ5IG1vdmluZyBsZWZ0IC0tIHRoZXJlIGlzIG5vdGhpbmcgdG8gaXRzIGxlZnQuXG4gICAgbGV0IGZpcnN0ID0gMDtcbiAgICB3aGlsZSAoZmlyc3QgPCByb3cubGVuZ3RoICYmICFhbmNob3JlZChyb3dbZmlyc3RdKSkgZmlyc3QrKztcbiAgICBpZiAoZmlyc3QgPT09IDAgfHwgZmlyc3QgPj0gcm93Lmxlbmd0aCkgcmV0dXJuO1xuICAgIGZvciAobGV0IGkgPSBmaXJzdCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBtYXggPSBjZW50ZXJzW2xdW2kgKyAxXSAtIGNTaXplT2Yocm93W2kgKyAxXSkgLyAyIC0gZ2FwQmV0d2Vlbihyb3dbaV0sIHJvd1tpICsgMV0pIC0gY1NpemVPZihyb3dbaV0pIC8gMjtcbiAgICAgIGlmIChjZW50ZXJzW2xdW2ldIDwgbWF4KSBjZW50ZXJzW2xdW2ldID0gbWF4O1xuICAgIH1cbiAgfTtcblxuICAvKiogVG90YWwgY3Jvc3MtYXhpcyBkaXN0YW5jZSB0aGUgZWRnZXMgdHJhdmVsLCB3aGljaCBpcyB0aGUgdGhpbmcgYVxuICAgKiByZWFkZXIgZXhwZXJpZW5jZXMgYXMgYSB0YW5nbGUuIE9ubHkgdGhlIGNyb3NzIGF4aXMgbW92ZXMgaGVyZSwgc28gdGhpc1xuICAgKiBpcyB0aGUgd2hvbGUgZGlmZmVyZW5jZSBiZXR3ZWVuIGNhbmRpZGF0ZSBwbGFjZW1lbnRzLiAqL1xuICBjb25zdCB3aXJlTGVuZ3RoID0gKCk6IG51bWJlciA9PiB7XG4gICAgbGV0IHN1bSA9IDA7XG4gICAgcm93cy5mb3JFYWNoKChyb3csIGwpID0+IHtcbiAgICAgIGlmIChsICsgMSA+PSByb3dzLmxlbmd0aCkgcmV0dXJuO1xuICAgICAgY29uc3QgcG9zQnlJZGVudGl0eSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gICAgICByb3dzW2wgKyAxXS5mb3JFYWNoKCh0LCB0aSkgPT4gcG9zQnlJZGVudGl0eS5zZXQoc2xvdElkZW50aXR5KHQpLCB0aSkpO1xuICAgICAgcm93LmZvckVhY2goKHMsIGkpID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgcHJvcGVyLnN1Y2MuZ2V0KHNsb3RJZGVudGl0eShzKSkgPz8gW10pIHtcbiAgICAgICAgICBjb25zdCB0aSA9IHBvc0J5SWRlbnRpdHkuZ2V0KGtleSk7XG4gICAgICAgICAgaWYgKHRpICE9PSB1bmRlZmluZWQpIHN1bSArPSBNYXRoLmFicyhjZW50ZXJzW2xdW2ldIC0gY2VudGVyc1tsICsgMV1bdGldKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHN1bTtcbiAgfTtcblxuICAvKiogRXZlcnkgcm91dGluZyBzbG90IG9mIG9uZSBsb25nIGVkZ2UgaXMgb25lIGJsb2NrLCBhbmQgYSBibG9jayBtb3ZlcyBhcyBhIHVuaXQuICovXG4gIGNvbnN0IGJsb2NrT2YgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICBjb25zdCBibG9ja01lbWJlcnM6IHN0cmluZ1tdW10gPSBbXTtcbiAgZm9yIChjb25zdCBjaGFpbiBvZiBwcm9wZXIuY2hhaW5zLnZhbHVlcygpKSB7XG4gICAgY29uc3QgZHVtbWllcyA9IGNoYWluLmZpbHRlcigoaWQpID0+IGlkLnN0YXJ0c1dpdGgoJ2QnKSk7XG4gICAgaWYgKGR1bW1pZXMubGVuZ3RoIDwgMikgY29udGludWU7XG4gICAgY29uc3QgYiA9IGJsb2NrTWVtYmVycy5sZW5ndGg7XG4gICAgYmxvY2tNZW1iZXJzLnB1c2goZHVtbWllcyk7XG4gICAgZm9yIChjb25zdCBpZCBvZiBkdW1taWVzKSBibG9ja09mLnNldChpZCwgYik7XG4gIH1cblxuICAvKiogV2hlcmUgZWFjaCBzbG90IHNpdHMsIGluZGV4ZWQgdGhlIHNhbWUgd2F5IHRoZSByb3dzIGFyZS4gKi9cbiAgY29uc3Qgc2xvdEF0ID0gbmV3IE1hcDxzdHJpbmcsIHsgbDogbnVtYmVyOyBpOiBudW1iZXIgfT4oKTtcbiAgcm93cy5mb3JFYWNoKChyb3csIGwpID0+IHJvdy5mb3JFYWNoKChzLCBpKSA9PiBzbG90QXQuc2V0KHNsb3RJZGVudGl0eShzKSwgeyBsLCBpIH0pKSk7XG5cbiAgLy8gT25lIHBvc2l0aW9uIHBlciBibG9jazogdGhlIG1lZGlhbiBvZiB3aGF0IGl0cyBzbG90cyB3YW50ZWQsIHdoaWNoIGlzXG4gIC8vIHRoZSB2YWx1ZSBtaW5pbWl6aW5nIHRoZSB0b3RhbCBkaXN0YW5jZSBmcm9tIGFsbCBvZiB0aGVtLlxuICBjb25zdCBhbGlnbkJsb2NrcyA9IChkZXNpcmVkQnlSb3c6IG51bWJlcltdW10pOiB2b2lkID0+IHtcbiAgICBmb3IgKGNvbnN0IG1lbWJlcnMgb2YgYmxvY2tNZW1iZXJzKSB7XG4gICAgICBjb25zdCB3YW50czogbnVtYmVyW10gPSBbXTtcbiAgICAgIGZvciAoY29uc3QgaWQgb2YgbWVtYmVycykge1xuICAgICAgICBjb25zdCBhdCA9IHNsb3RBdC5nZXQoaWQpO1xuICAgICAgICBpZiAoYXQgIT09IHVuZGVmaW5lZCkgd2FudHMucHVzaChkZXNpcmVkQnlSb3dbYXQubF1bYXQuaV0pO1xuICAgICAgfVxuICAgICAgaWYgKHdhbnRzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICB3YW50cy5zb3J0KChhLCBiKSA9PiBhIC0gYik7XG4gICAgICBjb25zdCBtID0gd2FudHMubGVuZ3RoID4+IDE7XG4gICAgICBjb25zdCB2ID0gd2FudHMubGVuZ3RoICUgMiA9PT0gMSA/IHdhbnRzW21dIDogKHdhbnRzW20gLSAxXSArIHdhbnRzW21dKSAvIDI7XG4gICAgICBmb3IgKGNvbnN0IGlkIG9mIG1lbWJlcnMpIHtcbiAgICAgICAgY29uc3QgYXQgPSBzbG90QXQuZ2V0KGlkKTtcbiAgICAgICAgaWYgKGF0ICE9PSB1bmRlZmluZWQpIGRlc2lyZWRCeVJvd1thdC5sXVthdC5pXSA9IHY7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIC8vIEEgc3dlZXAgaXMgYSBndWVzcywgbm90IGFuIGltcHJvdmVtZW50OiB0aGUgdXAgcGFzcy5cbiAgbGV0IGJlc3QgPSBjZW50ZXJzLm1hcCgocm93KSA9PiByb3cuc2xpY2UoKSk7XG4gIGxldCBiZXN0U2NvcmUgPSB3aXJlTGVuZ3RoKCk7XG4gIGZvciAobGV0IHAgPSAwOyBwIDwgcGFzc2VzOyBwKyspIHtcbiAgICBjb25zdCB1cCA9IHAgJSAyID09PSAwO1xuICAgIGNvbnN0IG9yZGVyID0gdXBcbiAgICAgID8gQXJyYXkuZnJvbSh7IGxlbmd0aDogcm93cy5sZW5ndGggfSwgKF8sIGkpID0+IGkpXG4gICAgICA6IEFycmF5LmZyb20oeyBsZW5ndGg6IHJvd3MubGVuZ3RoIH0sIChfLCBpKSA9PiByb3dzLmxlbmd0aCAtIDEgLSBpKTtcbiAgICAvLyBBIHNsb3Qgd2l0aCBub3RoaW5nIGluIHRoZSBzd2VwdCBkaXJlY3Rpb24gc3RpbGwgaGFzIGEgcmVhc29uIHRvIHNpdFxuICAgIC8vIHNvbWV3aGVyZTogdGhlIG90aGVyIHNpZGUuXG4gICAgY29uc3QgZGVzaXJlZEJ5Um93ID0gcm93cy5tYXAoKHJvdywgbCkgPT5cbiAgICAgIHJvdy5tYXAoKF8sIGkpID0+IG5laWdoYm91ck1lZGlhbihsLCBpLCB1cCkgPz8gbmVpZ2hib3VyTWVkaWFuKGwsIGksICF1cCkgPz8gY2VudGVyc1tsXVtpXSksXG4gICAgKTtcbiAgICBhbGlnbkJsb2NrcyhkZXNpcmVkQnlSb3cpO1xuICAgIGZvciAoY29uc3QgbCBvZiBvcmRlcikgY2VudGVyc1tsXSA9IGZpdFRvRGVzaXJlZChkZXNpcmVkQnlSb3dbbF0sIGdhcHNGb3Iocm93c1tsXSkpO1xuICAgIGNvbnN0IHNjb3JlID0gd2lyZUxlbmd0aCgpO1xuICAgIGlmIChzY29yZSA8IGJlc3RTY29yZSkge1xuICAgICAgYmVzdFNjb3JlID0gc2NvcmU7XG4gICAgICBiZXN0ID0gY2VudGVycy5tYXAoKHJvdykgPT4gcm93LnNsaWNlKCkpO1xuICAgIH1cbiAgfVxuICBjZW50ZXJzLnNwbGljZSgwLCBjZW50ZXJzLmxlbmd0aCwgLi4uYmVzdC5tYXAoKHJvdykgPT4gcm93LnNsaWNlKCkpKTtcblxuICAvLyBBZnRlciB0aGUgbGFzdCBwdWxsLCBuZXZlciBiZXR3ZWVuIHNvbWUgb2YgdGhlbTogY29tcGFjdGluZyBtaWQtcnVuXG4gIC8vIHdvdWxkIGJlIHVuZG9uZSBieSB0aGUgbmV4dCBwYXNzLlxuICBmb3IgKGxldCBsID0gMDsgbCA8IHJvd3MubGVuZ3RoOyBsKyspIHtcbiAgICBjb21wYWN0KGwpO1xuICAgIHNlcGFyYXRlKGwpO1xuICB9XG5cbiAgbGV0IG1pbkMgPSBJbmZpbml0eTtcbiAgbGV0IG1heEMgPSAtSW5maW5pdHk7XG4gIHJvd3MuZm9yRWFjaCgocm93LCBsKSA9PiB7XG4gICAgcm93LmZvckVhY2goKHMsIGkpID0+IHtcbiAgICAgIG1pbkMgPSBNYXRoLm1pbihtaW5DLCBjZW50ZXJzW2xdW2ldIC0gY1NpemVPZihzKSAvIDIpO1xuICAgICAgbWF4QyA9IE1hdGgubWF4KG1heEMsIGNlbnRlcnNbbF1baV0gKyBjU2l6ZU9mKHMpIC8gMik7XG4gICAgfSk7XG4gIH0pO1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShtaW5DKSkge1xuICAgIG1pbkMgPSAwO1xuICAgIG1heEMgPSAwO1xuICB9XG5cbiAgY29uc3QgcGxhY2VtZW50czogU2xvdFBsYWNlbWVudFtdW10gPSByb3dzLm1hcCgocm93LCBsKSA9PlxuICAgIHJvdy5tYXAoKHMsIGkpID0+ICh7XG4gICAgICBjOiBjZW50ZXJzW2xdW2ldIC0gbWluQyxcbiAgICAgIC8vIEEgZHVtbXkgaGFzIG5vIHRoaWNrbmVzcywgc28gaXQgc2l0cyBvbiB0aGUgbGF5ZXIncyBtaWQtbGluZSBhbmQgdGhlIHJvdXRlZCBwb2x5bGluZSBiZW5kcyB0aGVyZS5cbiAgICAgIGw6IHMubm9kZSA+PSAwID8gbGF5ZXJTdGFydFtsXSA6IGxheWVyU3RhcnRbbF0gKyBsYXllclRoaWNrW2xdIC8gMixcbiAgICAgIGNTaXplOiBjU2l6ZU9mKHMpLFxuICAgICAgbFNpemU6IGxTaXplT2YocyksXG4gICAgfSkpLFxuICApO1xuXG4gIHJldHVybiB7IHBsYWNlbWVudHMsIGNyb3NzRXh0ZW50OiBNYXRoLm1heCgwLCBtYXhDIC0gbWluQyksIGxheWVyRXh0ZW50IH07XG59XG5cbi8vIC0tIFRoZSB3aG9sZSBsYXlvdXQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBIHBsYWNlZCBub2RlLCBpbiBsYXlvdXQgY29vcmRpbmF0ZXMgKENTUyBweCwgcHJlLXZpZXdwb3J0KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGxhY2VkTm9kZSB7XG4gIG5vZGU6IERhZ05vZGU7XG4gIC8qKiBJbmRleCBpbnRvIHRoZSBpbnB1dCBub2RlIGxpc3QuICovXG4gIGluZGV4OiBudW1iZXI7XG4gIGxheWVyOiBudW1iZXI7XG4gIHg6IG51bWJlcjtcbiAgeTogbnVtYmVyO1xuICB3OiBudW1iZXI7XG4gIGg6IG51bWJlcjtcbn1cblxuLyoqIEEgcm91dGVkIGVkZ2UsIGluIHRoZSBzYW1lIGNvb3JkaW5hdGVzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQbGFjZWRFZGdlIHtcbiAgZWRnZTogRGFnRWRnZTtcbiAgLyoqIEluZGV4IGludG8gZ3JhcGguZWRnZXMuICovXG4gIGluZGV4OiBudW1iZXI7XG4gIGZyb206IG51bWJlcjtcbiAgdG86IG51bWJlcjtcbiAgLyoqIFNvdXJjZSB0byB0YXJnZXQsIGluY2x1ZGluZyB0aGUgYmVuZCBwb2ludHMuIEF0IGxlYXN0IHBvaW50cy4gKi9cbiAgcG9pbnRzOiByZWFkb25seSB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH1bXTtcbiAgLyoqIFRydWUgd2hlbiBjeWNsZS1icmVha2luZyByZXZlcnNlZCB0aGlzIGVkZ2UuICovXG4gIHJldmVyc2VkOiBib29sZWFuO1xufVxuXG4vKiogRXZlcnl0aGluZyB0aGUgcmVuZGVyZXIgbmVlZHMsIGFuZCBub3RoaW5nIGl0IGhhcyB0byByZWNvbXB1dGUgcGVyIGZyYW1lLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEYWdMYXlvdXQge1xuICBub2RlczogcmVhZG9ubHkgUGxhY2VkTm9kZVtdO1xuICBlZGdlczogcmVhZG9ubHkgUGxhY2VkRWRnZVtdO1xuICAvKiogTm9kZSBpZCAtPiBpbmRleCBpbnRvIGBub2Rlc2AuICovXG4gIGJ5SWQ6IFJlYWRvbmx5TWFwPHN0cmluZywgbnVtYmVyPjtcbiAgd2lkdGg6IG51bWJlcjtcbiAgaGVpZ2h0OiBudW1iZXI7XG4gIG9yaWVudGF0aW9uOiBEYWdPcmllbnRhdGlvbjtcbiAgLyoqIENyb3NzaW5ncyB0aGUgb3JkZXJpbmcgcGFzcyBzZXR0bGVkIG9uIC0tIGEgbGF5b3V0LXF1YWxpdHkgcmVhZG91dC4gKi9cbiAgY3Jvc3NpbmdzOiBudW1iZXI7XG4gIC8qKiBFZGdlcyByZXZlcnNlZCB0byBicmVhayBhIGN5Y2xlLCBhcyBpbmRpY2VzIGludG8gYGVkZ2VzYC4gKi9cbiAgY3ljbGVFZGdlczogcmVhZG9ubHkgbnVtYmVyW107XG4gIC8qKiBJbnB1dCBlZGdlcyBub3QgZHJhd24gYXQgYWxsLCB3aXRoIHRoZSByZWFzb24gKHNlZSBEYWdHcmFwaC5yZWplY3RlZCkuICovXG4gIHJlamVjdGVkOiByZWFkb25seSBSZWplY3RlZEVkZ2VbXTtcbiAgLyoqIElkcyB3aG9zZSBgbGF5ZXJgIGhpbnQgYW4gZWRnZSBvdmVycnVsZWQuICovXG4gIGlnbm9yZWRQaW5zOiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxuLyoqIE9wdGlvbnMgZm9yIGxheW91dERhZy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGFnTGF5b3V0T3B0aW9ucyBleHRlbmRzIENvb3JkT3B0aW9ucywgTGF5ZXJPcHRpb25zIHtcbiAgb3JpZW50YXRpb24/OiBEYWdPcmllbnRhdGlvbjtcbiAgLyoqIE1lYXN1cmVzIGEgbm9kZS4gRGVmYXVsdHMgdG8gbWVhc3VyZU5vZGUgd2l0aCBpdHMgb3duIGRlZmF1bHRzLiAqL1xuICBzaXplT2Y/OiAobm9kZTogRGFnTm9kZSwgaW5kZXg6IG51bWJlcikgPT4gTm9kZVNpemU7XG4gIC8qKiBPcmRlcmluZyBzd2VlcHMgKHNlZSBPUkRFUl9TV0VFUFMpLiAqL1xuICBzd2VlcHM/OiBudW1iZXI7XG4gIC8qKiBOb2RlcyBwZXIgcm93IGJlZm9yZSBhIGxheWVyIHdyYXBzLiBTZWUgd3JhcFdpZGVMYXllcnMuICovXG4gIG1heExheWVyV2lkdGg/OiBudW1iZXI7XG59XG5cbi8qKlxuICogVGhlIHdob2xlIHBpcGVsaW5lLCBmcm9tIHJhdyBub2RlcyBhbmQgZWRnZXMgdG8gcGxhY2VkIGJveGVzIGFuZCByb3V0ZWRcbiAqIHBvbHlsaW5lcy4gRXZlcnkgaW50ZXJtZWRpYXRlIHN0YWdlIGlzIGV4cG9ydGVkIGFib3ZlOyB0aGlzIGlzIHRoZVxuICogb3JkaW5hcnkgcGF0aC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxheW91dERhZyhcbiAgbm9kZXM6IHJlYWRvbmx5IERhZ05vZGVbXSxcbiAgZWRnZXM6IHJlYWRvbmx5IERhZ0VkZ2VbXSxcbiAgb3B0czogRGFnTGF5b3V0T3B0aW9ucyA9IHt9LFxuKTogRGFnTGF5b3V0IHtcbiAgY29uc3QgcHJvYmUgPSBidWlsZEdyYXBoKG5vZGVzLCBlZGdlcyk7XG4gIGNvbnN0IGRlZ3JlZSA9IG5ldyBBcnJheTxudW1iZXI+KHByb2JlLm5vZGVzLmxlbmd0aCkuZmlsbCgwKTtcbiAgZm9yIChjb25zdCBlIG9mIHByb2JlLmVkZ2VzKSB7XG4gICAgZGVncmVlW2UuZnJvbV0rKztcbiAgICBkZWdyZWVbZS50b10rKztcbiAgfVxuICAvLyBBIG5vZGUgd2l0aCBubyBlZGdlIGlzIG5vdCBwYXJ0IG9mIHRoZSBkZXBlbmRlbmN5IHN0cnVjdHVyZSwgYW5kIHB1dHRpbmcgaXQgaW4gYSBsYXllciBzYXlzIGl0IGlzLlxuICBjb25zdCBwYXJ0cyA9IGNvbXBvbmVudHNPZihwcm9iZSwgZGVncmVlKTtcbiAgaWYgKHBhcnRzLndpcmVkLmxlbmd0aCA+IDEgfHwgcGFydHMubG9vc2UubGVuZ3RoID4gMCkgcmV0dXJuIGxheW91dEJsb2Nrcyhwcm9iZSwgcGFydHMsIG9wdHMpO1xuICByZXR1cm4gbGF5b3V0Q29ubmVjdGVkKG5vZGVzLCBlZGdlcywgb3B0cyk7XG59XG5cbi8qKiBUaGUgd2lyZWQgY29tcG9uZW50cywgbGFyZ2VzdCBmaXJzdCwgYW5kIHRoZSBlZGdlbGVzcyBub2RlcyBvbiB0aGVpciBvd24uICovXG5pbnRlcmZhY2UgR3JhcGhQYXJ0cyB7XG4gIHdpcmVkOiBudW1iZXJbXVtdO1xuICBsb29zZTogbnVtYmVyW107XG59XG5cbi8qKiBTcGxpdCBpbnRvIHBpZWNlcyB0aGF0IHNoYXJlIG5vIGVkZ2UuICovXG5mdW5jdGlvbiBjb21wb25lbnRzT2YoZ3JhcGg6IERhZ0dyYXBoLCBkZWdyZWU6IHJlYWRvbmx5IG51bWJlcltdKTogR3JhcGhQYXJ0cyB7XG4gIGNvbnN0IG5lYXIgPSBncmFwaC5ub2Rlcy5tYXAoKCk6IG51bWJlcltdID0+IFtdKTtcbiAgZm9yIChjb25zdCBlIG9mIGdyYXBoLmVkZ2VzKSB7XG4gICAgbmVhcltlLmZyb21dLnB1c2goZS50byk7XG4gICAgbmVhcltlLnRvXS5wdXNoKGUuZnJvbSk7XG4gIH1cbiAgY29uc3Qgc2VlbiA9IG5ldyBBcnJheTxib29sZWFuPihncmFwaC5ub2Rlcy5sZW5ndGgpLmZpbGwoZmFsc2UpO1xuICBjb25zdCB3aXJlZDogbnVtYmVyW11bXSA9IFtdO1xuICBjb25zdCBsb29zZTogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgdiA9IDA7IHYgPCBncmFwaC5ub2Rlcy5sZW5ndGg7IHYrKykge1xuICAgIGlmIChzZWVuW3ZdKSBjb250aW51ZTtcbiAgICAvLyBBIHBpbm5lZCBub2RlIG5hbWVkIGl0cyBvd24gbGF5ZXIsIHNvIGl0IHN0YXlzIGluIHRoZSBsYXllcmVkIHBhcnRcbiAgICAvLyBldmVuIHdpdGggbm8gZWRnZSB0byBob2xkIGl0IHRoZXJlLlxuICAgIGlmIChkZWdyZWVbdl0gPT09IDAgJiYgZ3JhcGgubm9kZXNbdl0ubGF5ZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgc2Vlblt2XSA9IHRydWU7XG4gICAgICBsb29zZS5wdXNoKHYpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHN0YWNrID0gW3ZdO1xuICAgIGNvbnN0IG1lbWJlcnM6IG51bWJlcltdID0gW107XG4gICAgc2Vlblt2XSA9IHRydWU7XG4gICAgd2hpbGUgKHN0YWNrLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHUgPSBzdGFjay5wb3AoKSBhcyBudW1iZXI7XG4gICAgICBtZW1iZXJzLnB1c2godSk7XG4gICAgICBmb3IgKGNvbnN0IHcgb2YgbmVhclt1XSkge1xuICAgICAgICBpZiAoc2Vlblt3XSkgY29udGludWU7XG4gICAgICAgIHNlZW5bd10gPSB0cnVlO1xuICAgICAgICBzdGFjay5wdXNoKHcpO1xuICAgICAgfVxuICAgIH1cbiAgICBtZW1iZXJzLnNvcnQoKGEsIGIpID0+IGEgLSBiKTtcbiAgICB3aXJlZC5wdXNoKG1lbWJlcnMpO1xuICB9XG4gIHdpcmVkLnNvcnQoKGEsIGIpID0+IGIubGVuZ3RoIC0gYS5sZW5ndGggfHwgYVswXSAtIGJbMF0pO1xuICByZXR1cm4geyB3aXJlZCwgbG9vc2UgfTtcbn1cblxuLyoqIFNoaWZ0cyBhIGZpbmlzaGVkIGxheW91dCwgYm94ZXMgYW5kIHJvdXRlZCBwb2ludHMgYWxpa2UuICovXG5mdW5jdGlvbiB0cmFuc2xhdGVMYXlvdXQobGF5b3V0OiBEYWdMYXlvdXQsIGR4OiBudW1iZXIsIGR5OiBudW1iZXIpOiBEYWdMYXlvdXQge1xuICByZXR1cm4ge1xuICAgIC4uLmxheW91dCxcbiAgICBub2RlczogbGF5b3V0Lm5vZGVzLm1hcCgobikgPT4gKHsgLi4ubiwgeDogbi54ICsgZHgsIHk6IG4ueSArIGR5IH0pKSxcbiAgICBlZGdlczogbGF5b3V0LmVkZ2VzLm1hcCgoZSkgPT4gKHtcbiAgICAgIC4uLmUsXG4gICAgICBwb2ludHM6IGUucG9pbnRzLm1hcCgocCkgPT4gKHsgeDogcC54ICsgZHgsIHk6IHAueSArIGR5IH0pKSxcbiAgICB9KSksXG4gIH07XG59XG5cbi8qKlxuICogTGF5IGV2ZXJ5IHBpZWNlIG91dCBvbiBpdHMgb3duLCB0aGVuIHNldCB0aGUgcGllY2VzIHNpZGUgYnkgc2lkZS5cbiAqXG4gKiBTaGVsZiBwYWNraW5nLCB3aWRlc3Qgcm93IGZpcnN0LCBhZ2FpbnN0IGEgdGFyZ2V0IHdpZHRoIHRha2VuIGZyb20gdGhlXG4gKiB0b3RhbCBhcmVhLiBBIHBpZWNlIGtlZXBzIGl0cyBvd24gaW50ZXJuYWwgZHJhd2luZyBleGFjdGx5LCBzbyBub3RoaW5nIHRoZVxuICogbGF5ZXJpbmcgZWFybmVkIGlzIGRpc3R1cmJlZCAtLSBvbmx5IHdoZXJlIHRoZSBwaWVjZSBTSVRTIGNoYW5nZXMuXG4gKi9cbmZ1bmN0aW9uIGxheW91dEJsb2Nrcyhwcm9iZTogRGFnR3JhcGgsIHBhcnRzOiBHcmFwaFBhcnRzLCBvcHRzOiBEYWdMYXlvdXRPcHRpb25zKTogRGFnTGF5b3V0IHtcbiAgY29uc3Qgb3JpZW50YXRpb24gPSBvcHRzLm9yaWVudGF0aW9uID8/ICdUQic7XG4gIGNvbnN0IHNpemVPZiA9IG9wdHMuc2l6ZU9mID8/ICgobjogRGFnTm9kZSk6IE5vZGVTaXplID0+IG1lYXN1cmVOb2RlKG4pKTtcbiAgY29uc3QgZ2FwID0gb3B0cy5nYXAgPz8gREVGQVVMVF9HQVA7XG4gIGNvbnN0IGxheWVyR2FwID0gb3B0cy5sYXllckdhcCA/PyBERUZBVUxUX0xBWUVSX0dBUDtcblxuICBjb25zdCBpbnB1dEVkZ2VzID0gcHJvYmUuZWRnZXMubWFwKChlKSA9PiBlLmVkZ2UpO1xuICBjb25zdCBibG9ja3MgPSBwYXJ0cy53aXJlZC5tYXAoKG1lbWJlcnMpID0+IHtcbiAgICBjb25zdCBrZWVwID0gbmV3IFNldChtZW1iZXJzKTtcbiAgICBjb25zdCBzdWIgPSBtZW1iZXJzLm1hcCgoaSkgPT4gcHJvYmUubm9kZXNbaV0pO1xuICAgIGNvbnN0IHN1YkVkZ2VzID0gcHJvYmUuZWRnZXMuZmlsdGVyKChlKSA9PiBrZWVwLmhhcyhlLmZyb20pICYmIGtlZXAuaGFzKGUudG8pKS5tYXAoKGUpID0+IGUuZWRnZSk7XG4gICAgcmV0dXJuIGxheW91dENvbm5lY3RlZChzdWIsIHN1YkVkZ2VzLCBvcHRzKTtcbiAgfSk7XG5cbiAgLy8gVGhlIGVkZ2VsZXNzIG5vZGVzIGFyZSBvbmUgYmxvY2sgb2YgdGhlaXIgb3duLCBwYWNrZWQgYXMgYSBncmlkIHJhdGhlciB0aGFuIGEgbGluZS5cbiAgY29uc3QgbG9vc2VOb2RlcyA9IHBhcnRzLmxvb3NlLm1hcCgoaSkgPT4gcHJvYmUubm9kZXNbaV0pO1xuICBjb25zdCBsb29zZVNpemVzID0gbG9vc2VOb2Rlcy5tYXAoKG4sIGkpID0+IHNpemVPZihuLCBpKSk7XG4gIGNvbnN0IGxvb3NlQXJlYSA9IGxvb3NlU2l6ZXMucmVkdWNlKChzLCB6KSA9PiBzICsgKHoudyArIGdhcCkgKiAoei5oICsgZ2FwKSwgMCk7XG4gIGNvbnN0IGdyYXBoQXJlYSA9IGJsb2Nrcy5yZWR1Y2UoKHMsIGIpID0+IHMgKyAoYi53aWR0aCArIGdhcCkgKiAoYi5oZWlnaHQgKyBnYXApLCAwKTtcbiAgLy8gQSBsYW5kc2NhcGUgdGFyZ2V0LCBiZWNhdXNlIGEgcmVhZGVyJ3Mgd2luZG93IGlzIHdpZGVyIHRoYW4gaXQgaXMgdGFsbC5cbiAgY29uc3QgdGFyZ2V0ID0gTWF0aC5tYXgoXG4gICAgYmxvY2tzLnJlZHVjZSgobSwgYikgPT4gTWF0aC5tYXgobSwgYi53aWR0aCksIDApLFxuICAgIE1hdGguc3FydChNYXRoLm1heCgxLCBncmFwaEFyZWEgKyBsb29zZUFyZWEpICogMS43KSxcbiAgKTtcblxuICBjb25zdCBsb29zZUJsb2NrOiBQbGFjZWROb2RlW10gPSBbXTtcbiAge1xuICAgIGxldCBjdXJzb3IgPSAwO1xuICAgIGxldCBsaW5lU3RhcnQgPSAwO1xuICAgIGxldCBsaW5lVGhpY2sgPSAwO1xuICAgIGxvb3NlTm9kZXMuZm9yRWFjaCgobiwgaSkgPT4ge1xuICAgICAgY29uc3Qgc2l6ZSA9IGxvb3NlU2l6ZXNbaV07XG4gICAgICBpZiAoY3Vyc29yID4gMCAmJiBjdXJzb3IgKyBzaXplLncgPiB0YXJnZXQpIHtcbiAgICAgICAgbGluZVN0YXJ0ICs9IGxpbmVUaGljayArIGdhcDtcbiAgICAgICAgY3Vyc29yID0gMDtcbiAgICAgICAgbGluZVRoaWNrID0gMDtcbiAgICAgIH1cbiAgICAgIGxvb3NlQmxvY2sucHVzaCh7IG5vZGU6IG4sIGluZGV4OiAtMSwgbGF5ZXI6IC0xLCB4OiBjdXJzb3IsIHk6IGxpbmVTdGFydCwgdzogc2l6ZS53LCBoOiBzaXplLmggfSk7XG4gICAgICBjdXJzb3IgKz0gc2l6ZS53ICsgZ2FwO1xuICAgICAgbGluZVRoaWNrID0gTWF0aC5tYXgobGluZVRoaWNrLCBzaXplLmgpO1xuICAgIH0pO1xuICB9XG4gIGNvbnN0IGxvb3NlVyA9IGxvb3NlQmxvY2sucmVkdWNlKChtLCBwKSA9PiBNYXRoLm1heChtLCBwLnggKyBwLncpLCAwKTtcbiAgY29uc3QgbG9vc2VIID0gbG9vc2VCbG9jay5yZWR1Y2UoKG0sIHApID0+IE1hdGgubWF4KG0sIHAueSArIHAuaCksIDApO1xuXG4gIC8vIFNoZWxmIHRoZSB3aXJlZCBibG9ja3MsIHRoZW4gdGhlIGVkZ2VsZXNzIGJsb2NrIGxhc3Qgc28gaXQgcmVhZHMgYXMgYW4gYXBwZW5kaXggcmF0aGVyIHRoYW4gYXMgcGFydC5cbiAgY29uc3Qgc2hlbHZlZDogRGFnTGF5b3V0W10gPSBbXTtcbiAgbGV0IHggPSAwO1xuICBsZXQgeSA9IDA7XG4gIGxldCByb3dUaGljayA9IDA7XG4gIGxldCB3aWR0aCA9IDA7XG4gIGZvciAoY29uc3QgYiBvZiBibG9ja3MpIHtcbiAgICBpZiAoeCA+IDAgJiYgeCArIGIud2lkdGggPiB0YXJnZXQpIHtcbiAgICAgIHkgKz0gcm93VGhpY2sgKyBsYXllckdhcDtcbiAgICAgIHggPSAwO1xuICAgICAgcm93VGhpY2sgPSAwO1xuICAgIH1cbiAgICBzaGVsdmVkLnB1c2godHJhbnNsYXRlTGF5b3V0KGIsIHgsIHkpKTtcbiAgICB4ICs9IGIud2lkdGggKyBsYXllckdhcDtcbiAgICB3aWR0aCA9IE1hdGgubWF4KHdpZHRoLCB4IC0gbGF5ZXJHYXApO1xuICAgIHJvd1RoaWNrID0gTWF0aC5tYXgocm93VGhpY2ssIGIuaGVpZ2h0KTtcbiAgfVxuICBjb25zdCBhZnRlcldpcmVkID0gYmxvY2tzLmxlbmd0aCA9PT0gMCA/IDAgOiB5ICsgcm93VGhpY2s7XG4gIGNvbnN0IGxvb3NlWSA9IGJsb2Nrcy5sZW5ndGggPT09IDAgPyAwIDogYWZ0ZXJXaXJlZCArIGxheWVyR2FwO1xuICBmb3IgKGNvbnN0IHAgb2YgbG9vc2VCbG9jaykgcC55ICs9IGxvb3NlWTtcblxuICBjb25zdCBhbGxOb2RlcyA9IFsuLi5zaGVsdmVkLmZsYXRNYXAoKGIpID0+IGIubm9kZXMpLCAuLi5sb29zZUJsb2NrXTtcbiAgY29uc3QgYnlJZCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gIGFsbE5vZGVzLmZvckVhY2goKHAsIGkpID0+IGJ5SWQuc2V0KHAubm9kZS5pZCwgaSkpO1xuICBjb25zdCBieUVkZ2UgPSBuZXcgTWFwPERhZ0VkZ2UsIG51bWJlcj4oKTtcbiAgaW5wdXRFZGdlcy5mb3JFYWNoKChlLCBpKSA9PiBieUVkZ2Uuc2V0KGUsIGkpKTtcblxuICAvLyBFYWNoIGJsb2NrIG51bWJlcmVkIGl0cyBvd24gbm9kZXMgZnJvbSB6ZXJvLlxuICBjb25zdCBjeWNsZUVkZ2VzOiBudW1iZXJbXSA9IFtdO1xuICBjb25zdCBlZGdlczogUGxhY2VkRWRnZVtdID0gW107XG4gIGxldCBub2RlT2Zmc2V0ID0gMDtcbiAgZm9yIChjb25zdCBiIG9mIHNoZWx2ZWQpIHtcbiAgICBmb3IgKGNvbnN0IGUgb2YgYi5lZGdlcykge1xuICAgICAgaWYgKGUucmV2ZXJzZWQpIGN5Y2xlRWRnZXMucHVzaChlZGdlcy5sZW5ndGgpO1xuICAgICAgZWRnZXMucHVzaCh7IC4uLmUsIGluZGV4OiBieUVkZ2UuZ2V0KGUuZWRnZSkgPz8gZWRnZXMubGVuZ3RoLCBmcm9tOiBlLmZyb20gKyBub2RlT2Zmc2V0LCB0bzogZS50byArIG5vZGVPZmZzZXQgfSk7XG4gICAgfVxuICAgIG5vZGVPZmZzZXQgKz0gYi5ub2Rlcy5sZW5ndGg7XG4gIH1cblxuICBjb25zdCBsYXlvdXRPdXQ6IERhZ0xheW91dCA9IHtcbiAgICBub2RlczogYWxsTm9kZXMsXG4gICAgZWRnZXMsXG4gICAgYnlJZCxcbiAgICB3aWR0aDogTWF0aC5tYXgod2lkdGgsIGxvb3NlVyksXG4gICAgaGVpZ2h0OiBNYXRoLm1heChhZnRlcldpcmVkLCBsb29zZUJsb2NrLmxlbmd0aCA9PT0gMCA/IDAgOiBsb29zZVkgKyBsb29zZUgpLFxuICAgIG9yaWVudGF0aW9uLFxuICAgIGNyb3NzaW5nczogc2hlbHZlZC5yZWR1Y2UoKHMsIGIpID0+IHMgKyBiLmNyb3NzaW5ncywgMCksXG4gICAgY3ljbGVFZGdlcyxcbiAgICByZWplY3RlZDogcHJvYmUucmVqZWN0ZWQsXG4gICAgaWdub3JlZFBpbnM6IHNoZWx2ZWQuZmxhdE1hcCgoYikgPT4gYi5pZ25vcmVkUGlucyksXG4gIH07XG4gIHJldHVybiBsYXlvdXRPdXQ7XG59XG5cbmZ1bmN0aW9uIGxheW91dENvbm5lY3RlZChcbiAgbm9kZXM6IHJlYWRvbmx5IERhZ05vZGVbXSxcbiAgZWRnZXM6IHJlYWRvbmx5IERhZ0VkZ2VbXSxcbiAgb3B0czogRGFnTGF5b3V0T3B0aW9ucyA9IHt9LFxuKTogRGFnTGF5b3V0IHtcbiAgY29uc3Qgb3JpZW50YXRpb24gPSBvcHRzLm9yaWVudGF0aW9uID8/ICdUQic7XG4gIGNvbnN0IGdyYXBoID0gYnVpbGRHcmFwaChub2RlcywgZWRnZXMpO1xuICBjb25zdCBhY3ljbGljID0gYnJlYWtDeWNsZXMoZ3JhcGgpO1xuICBjb25zdCBsYXllcmVkID0gd3JhcFdpZGVMYXllcnMoYXNzaWduTGF5ZXJzKGdyYXBoLCBhY3ljbGljLCBvcHRzKSwgb3B0cy5tYXhMYXllcldpZHRoKTtcbiAgY29uc3QgcHJvcGVyID0gaW5zZXJ0RHVtbWllcyhncmFwaCwgYWN5Y2xpYywgbGF5ZXJlZCk7XG4gIGNvbnN0IGNyb3NzaW5ncyA9IG9yZGVyTGF5ZXJzKHByb3Blciwgb3B0cy5zd2VlcHMpO1xuICBjb25zdCBzaXplT2YgPSBvcHRzLnNpemVPZiA/PyAoKG46IERhZ05vZGUpOiBOb2RlU2l6ZSA9PiBtZWFzdXJlTm9kZShuKSk7XG4gIGNvbnN0IHNpemVzID0gZ3JhcGgubm9kZXMubWFwKChuLCBpKSA9PiBzaXplT2YobiwgaSkpO1xuICAvLyBJbiAnTFInIHRoZSBsYXllciBheGlzIGlzIHggYW5kIHRoZSBjcm9zcyBheGlzIGlzIHkuXG4gIGNvbnN0IGxheW91dFNpemVzOiBOb2RlU2l6ZVtdID0gb3JpZW50YXRpb24gPT09ICdUQicgPyBzaXplcyA6IHNpemVzLm1hcCgocykgPT4gKHsgdzogcy5oLCBoOiBzLncgfSkpO1xuICBjb25zdCBjb29yZHMgPSBhc3NpZ25Db29yZGluYXRlcyhwcm9wZXIsIGxheW91dFNpemVzLCBvcHRzKTtcblxuICBjb25zdCBwbGFjZWQ6IFBsYWNlZE5vZGVbXSA9IG5ldyBBcnJheShncmFwaC5ub2Rlcy5sZW5ndGgpO1xuICBjb25zdCBzbG90UG9zID0gbmV3IE1hcDxzdHJpbmcsIHsgYzogbnVtYmVyOyBsOiBudW1iZXI7IGNTaXplOiBudW1iZXI7IGxTaXplOiBudW1iZXIgfT4oKTtcbiAgcHJvcGVyLmxheWVycy5mb3JFYWNoKChyb3csIGwpID0+IHtcbiAgICByb3cuZm9yRWFjaCgocywgaSkgPT4ge1xuICAgICAgY29uc3QgcCA9IGNvb3Jkcy5wbGFjZW1lbnRzW2xdW2ldO1xuICAgICAgc2xvdFBvcy5zZXQoc2xvdElkZW50aXR5KHMpLCBwKTtcbiAgICAgIGlmIChzLm5vZGUgPCAwKSByZXR1cm47XG4gICAgICBjb25zdCBzaXplID0gc2l6ZXNbcy5ub2RlXTtcbiAgICAgIHBsYWNlZFtzLm5vZGVdID0ge1xuICAgICAgICBub2RlOiBncmFwaC5ub2Rlc1tzLm5vZGVdLFxuICAgICAgICBpbmRleDogcy5ub2RlLFxuICAgICAgICBsYXllcjogbCxcbiAgICAgICAgeDogb3JpZW50YXRpb24gPT09ICdUQicgPyBwLmMgLSBzaXplLncgLyAyIDogcC5sLFxuICAgICAgICB5OiBvcmllbnRhdGlvbiA9PT0gJ1RCJyA/IHAubCA6IHAuYyAtIHNpemUuaCAvIDIsXG4gICAgICAgIHc6IHNpemUudyxcbiAgICAgICAgaDogc2l6ZS5oLFxuICAgICAgfTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgY29uc3QgYnlJZCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gIHBsYWNlZC5mb3JFYWNoKChwLCBpKSA9PiBieUlkLnNldChwLm5vZGUuaWQsIGkpKTtcblxuICBjb25zdCByZXZlcnNlZFNldCA9IG5ldyBTZXQoYWN5Y2xpYy5yZXZlcnNlZCk7XG4gIGNvbnN0IGN5Y2xlRWRnZXM6IG51bWJlcltdID0gW107XG4gIGNvbnN0IHJvdXRlZDogUGxhY2VkRWRnZVtdID0gZ3JhcGguZWRnZXMubWFwKChlLCBlaSkgPT4ge1xuICAgIGNvbnN0IHJldmVyc2VkID0gcmV2ZXJzZWRTZXQuaGFzKGVpKTtcbiAgICBpZiAocmV2ZXJzZWQpIGN5Y2xlRWRnZXMucHVzaChlaSk7XG4gICAgLy8gVGhlIGNoYWluIHdhcyBidWlsdCBhbG9uZyB0aGUgQUNZQ0xJQyBkaXJlY3Rpb24uXG4gICAgY29uc3QgY2hhaW4gPSAocHJvcGVyLmNoYWlucy5nZXQoZWkpID8/IFtdKS5tYXAoKGlkKSA9PiBzbG90UG9zLmdldChpZCkpO1xuICAgIGNvbnN0IGJlbmRzID0gY2hhaW5cbiAgICAgIC5maWx0ZXIoKHApOiBwIGlzIFNsb3RQbGFjZW1lbnQgPT4gcCAhPT0gdW5kZWZpbmVkKVxuICAgICAgLm1hcCgocCkgPT4gKG9yaWVudGF0aW9uID09PSAnVEInID8geyB4OiBwLmMsIHk6IHAubCB9IDogeyB4OiBwLmwsIHk6IHAuYyB9KSk7XG4gICAgY29uc3QgYSA9IHBsYWNlZFtlLmZyb21dO1xuICAgIGNvbnN0IGIgPSBwbGFjZWRbZS50b107XG4gICAgY29uc3Qgc3RhcnQgPSBhbmNob3JQb2ludChhLCBvcmllbnRhdGlvbiwgcmV2ZXJzZWQgPyAnaW4nIDogJ291dCcpO1xuICAgIGNvbnN0IGVuZCA9IGFuY2hvclBvaW50KGIsIG9yaWVudGF0aW9uLCByZXZlcnNlZCA/ICdvdXQnIDogJ2luJyk7XG4gICAgY29uc3QgbWlkcyA9IHJldmVyc2VkID8gYmVuZHMuc2xpY2UoKS5yZXZlcnNlKCkgOiBiZW5kcztcbiAgICByZXR1cm4geyBlZGdlOiBlLmVkZ2UsIGluZGV4OiBlaSwgZnJvbTogZS5mcm9tLCB0bzogZS50bywgcG9pbnRzOiBbc3RhcnQsIC4uLm1pZHMsIGVuZF0sIHJldmVyc2VkIH07XG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgbm9kZXM6IHBsYWNlZCxcbiAgICBlZGdlczogcm91dGVkLFxuICAgIGJ5SWQsXG4gICAgd2lkdGg6IG9yaWVudGF0aW9uID09PSAnVEInID8gY29vcmRzLmNyb3NzRXh0ZW50IDogY29vcmRzLmxheWVyRXh0ZW50LFxuICAgIGhlaWdodDogb3JpZW50YXRpb24gPT09ICdUQicgPyBjb29yZHMubGF5ZXJFeHRlbnQgOiBjb29yZHMuY3Jvc3NFeHRlbnQsXG4gICAgb3JpZW50YXRpb24sXG4gICAgY3Jvc3NpbmdzLFxuICAgIGN5Y2xlRWRnZXMsXG4gICAgcmVqZWN0ZWQ6IGdyYXBoLnJlamVjdGVkLFxuICAgIGlnbm9yZWRQaW5zOiBsYXllcmVkLmlnbm9yZWRQaW5zLFxuICB9O1xufVxuXG4vKipcbiAqIFdoZXJlIGFuIGVkZ2UgbWVldHMgYSBib3g6IHRoZSBtaWRkbGUgb2YgdGhlIGZhY2UgcG9pbnRpbmcgYWxvbmcgdGhlXG4gKiBsYXllciBheGlzLiBBdHRhY2hpbmcgdG8gdGhlIGZhY2UgcmF0aGVyIHRoYW4gdGhlIGNlbnRlciBpcyB3aGF0IHN0b3BzXG4gKiBldmVyeSBhcnJvd2hlYWQgZnJvbSBkaXNhcHBlYXJpbmcgdW5kZXIgdGhlIGJveCBpdCBwb2ludHMgYXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhbmNob3JQb2ludChuOiBQbGFjZWROb2RlLCBvcmllbnRhdGlvbjogRGFnT3JpZW50YXRpb24sIHNpZGU6ICdpbicgfCAnb3V0Jyk6IHsgeDogbnVtYmVyOyB5OiBudW1iZXIgfSB7XG4gIGlmIChvcmllbnRhdGlvbiA9PT0gJ1RCJykge1xuICAgIHJldHVybiB7IHg6IG4ueCArIG4udyAvIDIsIHk6IHNpZGUgPT09ICdvdXQnID8gbi55ICsgbi5oIDogbi55IH07XG4gIH1cbiAgcmV0dXJuIHsgeDogc2lkZSA9PT0gJ291dCcgPyBuLnggKyBuLncgOiBuLngsIHk6IG4ueSArIG4uaCAvIDIgfTtcbn1cblxuLy8gLS0gTm9kZSBtZWFzdXJlbWVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIE9wdGlvbnMgZm9yIG1lYXN1cmVOb2RlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBNZWFzdXJlT3B0aW9ucyB7XG4gIC8qKiBBdmVyYWdlIGdseXBoIGFkdmFuY2UgZm9yIHRoZSBsYWJlbCBmb250LCBDU1MgcHguICovXG4gIGNoYXJXPzogbnVtYmVyO1xuICAvKiogSG9yaXpvbnRhbCBwYWRkaW5nIGluc2lkZSB0aGUgYm94LCBwZXIgc2lkZS4gKi9cbiAgcGFkWD86IG51bWJlcjtcbiAgLyoqIFZlcnRpY2FsIHBhZGRpbmcgaW5zaWRlIHRoZSBib3gsIHBlciBzaWRlLiAqL1xuICBwYWRZPzogbnVtYmVyO1xuICAvKiogTGFiZWwgbGluZSBoZWlnaHQuICovXG4gIGxpbmVIPzogbnVtYmVyO1xuICAvKiAqL1xuICBzdWJMaW5lSD86IG51bWJlcjtcbiAgLyoqIENsYW1wIG9uIHRoZSBib3ggd2lkdGgsIHNvIG9uZSBsb25nIHRpdGxlIGNhbm5vdCBzZXQgdGhlIHdob2xlIGxheW91dC4gKi9cbiAgbWF4Vz86IG51bWJlcjtcbiAgLyoqIEZsb29yIG9uIHRoZSBib3ggd2lkdGgsIHNvIGEgb25lLWNoYXJhY3RlciBub2RlIGlzIHN0aWxsIGEgdGFyZ2V0LiAqL1xuICBtaW5XPzogbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9OT0RFX01BWF9XID0gMjQwO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfTk9ERV9NSU5fVyA9IDcyO1xuXG4vKipcbiAqIEEgZGVmYXVsdCBib3ggc2l6ZSBmcm9tIGEgbm9kZSdzIHRleHQuIFJvdWdoIGJ5IGNvbnN0cnVjdGlvbjogaXQgd29ya3Mgb2ZmXG4gKiBhbiBhdmVyYWdlIGdseXBoIGFkdmFuY2UgcmF0aGVyIHRoYW4gYSByZWFsIHRleHQgbWVhc3VyZW1lbnQsIGJlY2F1c2UgdGhlXG4gKiBsYXlvdXQgcnVucyBiZWZvcmUgYW55dGhpbmcgaGFzIGEgY2FudmFzIGNvbnRleHQuIGA8ZGFnLXZpZXc+YCBwYXNzZXMgaXRzXG4gKiBvd24gbWVhc3VyZWQgYGNoYXJXYCBmcm9tIHRoZSBsaXZlIGZvbnQsIHdoaWNoIGlzIHdoYXQgbWFrZXMgdGhlIGVzdGltYXRlXG4gKiB0cmFjayB0aGUgYWN0dWFsIHJlbmRlcmluZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lYXN1cmVOb2RlKG5vZGU6IERhZ05vZGUsIG9wdHM6IE1lYXN1cmVPcHRpb25zID0ge30pOiBOb2RlU2l6ZSB7XG4gIGNvbnN0IGNoYXJXID0gb3B0cy5jaGFyVyA/PyA2LjI7XG4gIGNvbnN0IHBhZFggPSBvcHRzLnBhZFggPz8gMTA7XG4gIGNvbnN0IHBhZFkgPSBvcHRzLnBhZFkgPz8gNztcbiAgY29uc3QgbGluZUggPSBvcHRzLmxpbmVIID8/IDE1O1xuICBjb25zdCBzdWJMaW5lSCA9IG9wdHMuc3ViTGluZUggPz8gMTM7XG4gIGNvbnN0IG1heFcgPSBvcHRzLm1heFcgPz8gREVGQVVMVF9OT0RFX01BWF9XO1xuICBjb25zdCBtaW5XID0gb3B0cy5taW5XID8/IERFRkFVTFRfTk9ERV9NSU5fVztcbiAgY29uc3QgbGFiZWwgPSBub2RlLmxhYmVsID8/IG5vZGUuaWQ7XG4gIGNvbnN0IHN1YiA9IG5vZGUuc3VibGFiZWwgPz8gJyc7XG4gIGNvbnN0IHRleHRXID0gTWF0aC5tYXgobGFiZWwubGVuZ3RoICogY2hhclcsIHN1Yi5sZW5ndGggKiBjaGFyVyAqIDAuODgpO1xuICBjb25zdCB3ID0gTWF0aC5tYXgobWluVywgTWF0aC5taW4obWF4VywgTWF0aC5jZWlsKHRleHRXICsgcGFkWCAqIDIpKSk7XG4gIGNvbnN0IGggPSBwYWRZICogMiArIGxpbmVIICsgKHN1YiAhPT0gJycgPyBzdWJMaW5lSCA6IDApO1xuICByZXR1cm4geyB3LCBoIH07XG59XG5cbi8vIC0tIFZpZXdwb3J0IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogUGFuIGFuZCB6b29tOiB3b3JsZCAobGF5b3V0KSBjb29yZGluYXRlcyB0byBzY3JlZW4gKENTUyBweCkuICovXG5leHBvcnQgaW50ZXJmYWNlIERhZ1ZpZXdwb3J0IHtcbiAgLyogKi9cbiAgeDogbnVtYmVyO1xuICAvKiAqL1xuICB5OiBudW1iZXI7XG4gIHNjYWxlOiBudW1iZXI7XG59XG5cbi8qKiBIYXJkIHpvb20gY2xhbXBzLiBCZWxvdyBNSU4gYSBub2RlIGlzIGEgc211ZGdlOyBhYm92ZSBNQVggaXQgaXMgd2FsbHBhcGVyLiAqL1xuZXhwb3J0IGNvbnN0IE1JTl9TQ0FMRSA9IDAuMDU7XG5leHBvcnQgY29uc3QgTUFYX1NDQUxFID0gNDtcblxuLyoqIFBpeGVscyBvZiB3aGVlbCB0cmF2ZWwgcGVyIGRvdWJsaW5nIG9mIHRoZSBzY2FsZS4gKi9cbmV4cG9ydCBjb25zdCBaT09NX1BYX1BFUl9ET1VCTEUgPSAyNjA7XG5cbmV4cG9ydCBmdW5jdGlvbiB3b3JsZFRvU2NyZWVuKHA6IHsgeDogbnVtYmVyOyB5OiBudW1iZXIgfSwgdjogRGFnVmlld3BvcnQpOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0ge1xuICByZXR1cm4geyB4OiBwLnggKiB2LnNjYWxlICsgdi54LCB5OiBwLnkgKiB2LnNjYWxlICsgdi55IH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzY3JlZW5Ub1dvcmxkKHA6IHsgeDogbnVtYmVyOyB5OiBudW1iZXIgfSwgdjogRGFnVmlld3BvcnQpOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0ge1xuICByZXR1cm4geyB4OiAocC54IC0gdi54KSAvIHYuc2NhbGUsIHk6IChwLnkgLSB2LnkpIC8gdi5zY2FsZSB9O1xufVxuXG4vKiogU2hpZnQgdGhlIHZpZXdwb3J0IGJ5IGEgc2NyZWVuLXNwYWNlIGRlbHRhLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhblZpZXdwb3J0KHY6IERhZ1ZpZXdwb3J0LCBkeDogbnVtYmVyLCBkeTogbnVtYmVyKTogRGFnVmlld3BvcnQge1xuICByZXR1cm4geyB4OiB2LnggKyBkeCwgeTogdi55ICsgZHksIHNjYWxlOiB2LnNjYWxlIH07XG59XG5cbi8qKlxuICogWm9vbSBhYm91dCBhIHNjcmVlbiBhbmNob3I6IHRoZSB3b3JsZCBwb2ludCB1bmRlciB0aGUgYW5jaG9yIHN0YXlzIHVuZGVyXG4gKiBpdC4gQW55dGhpbmcgZWxzZSBtYWtlcyB0aGUgY29udGVudCBzbGlkZSBvdXQgZnJvbSB1bmRlciB0aGUgY3Vyc29yLCBhbmRcbiAqIGEgcmVhZGVyIHdobyB6b29tcyB0b3dhcmQgYSBub2RlIGFuZCB3YXRjaGVzIGl0IGxlYXZlIGhhcyB0byBjaGFzZSBpdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHpvb21WaWV3cG9ydEF0KFxuICB2OiBEYWdWaWV3cG9ydCxcbiAgYW5jaG9yWDogbnVtYmVyLFxuICBhbmNob3JZOiBudW1iZXIsXG4gIGZhY3RvcjogbnVtYmVyLFxuICBtaW5TY2FsZSA9IE1JTl9TQ0FMRSxcbiAgbWF4U2NhbGUgPSBNQVhfU0NBTEUsXG4pOiBEYWdWaWV3cG9ydCB7XG4gIGNvbnN0IG5leHQgPSBNYXRoLm1pbihtYXhTY2FsZSwgTWF0aC5tYXgobWluU2NhbGUsIHYuc2NhbGUgKiBmYWN0b3IpKTtcbiAgaWYgKG5leHQgPT09IHYuc2NhbGUpIHJldHVybiB2O1xuICBjb25zdCB3ID0gc2NyZWVuVG9Xb3JsZCh7IHg6IGFuY2hvclgsIHk6IGFuY2hvclkgfSwgdik7XG4gIHJldHVybiB7IHg6IGFuY2hvclggLSB3LnggKiBuZXh0LCB5OiBhbmNob3JZIC0gdy55ICogbmV4dCwgc2NhbGU6IG5leHQgfTtcbn1cblxuLyoqIFNjYWxlIGZhY3RvciBmb3IgYGRlbHRhUHhgIG9mIHpvb20gd2hlZWwgdHJhdmVsIChuZWdhdGl2ZSA9IHpvb20gaW4pLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHpvb21GYWN0b3JGb3JXaGVlbChkZWx0YVB4OiBudW1iZXIpOiBudW1iZXIge1xuICByZXR1cm4gTWF0aC5wb3coMiwgLWRlbHRhUHggLyBaT09NX1BYX1BFUl9ET1VCTEUpO1xufVxuXG4vKiogQSByZWN0YW5nbGUgaW4gd29ybGQgY29vcmRpbmF0ZXMuICovXG5leHBvcnQgaW50ZXJmYWNlIFdvcmxkUmVjdCB7XG4gIHg6IG51bWJlcjtcbiAgeTogbnVtYmVyO1xuICB3OiBudW1iZXI7XG4gIGg6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBUaGUgdmlld3BvcnQgdGhhdCBmaXRzIGByZWN0YCBpbnNpZGUgYSBgdndgIHggYHZoYCBib3ggd2l0aCBgcGFkYCBzY3JlZW5cbiAqIHB4IG9mIG1hcmdpbiwgY2VudGVyZWQuIEEgZGVnZW5lcmF0ZSByZWN0IChhIHNpbmdsZSBub2RlLCBhbiBlbXB0eSBncmFwaClcbiAqIHN0aWxsIHlpZWxkcyBhIHVzYWJsZSB2aWV3cG9ydCByYXRoZXIgdGhhbiBhbiBpbmZpbml0ZSBvciB6ZXJvIHNjYWxlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZml0Vmlld3BvcnQoXG4gIHJlY3Q6IFdvcmxkUmVjdCxcbiAgdnc6IG51bWJlcixcbiAgdmg6IG51bWJlcixcbiAgcGFkID0gMjQsXG4gIG1pblNjYWxlID0gTUlOX1NDQUxFLFxuICBtYXhTY2FsZSA9IE1BWF9TQ0FMRSxcbik6IERhZ1ZpZXdwb3J0IHtcbiAgY29uc3QgYXZhaWxXID0gTWF0aC5tYXgoMSwgdncgLSBwYWQgKiAyKTtcbiAgY29uc3QgYXZhaWxIID0gTWF0aC5tYXgoMSwgdmggLSBwYWQgKiAyKTtcbiAgY29uc3QgdyA9IE1hdGgubWF4KDFlLTYsIHJlY3Qudyk7XG4gIGNvbnN0IGggPSBNYXRoLm1heCgxZS02LCByZWN0LmgpO1xuICBjb25zdCBzY2FsZSA9IE1hdGgubWluKG1heFNjYWxlLCBNYXRoLm1heChtaW5TY2FsZSwgTWF0aC5taW4oYXZhaWxXIC8gdywgYXZhaWxIIC8gaCkpKTtcbiAgcmV0dXJuIHtcbiAgICB4OiAodncgLSByZWN0LncgKiBzY2FsZSkgLyAyIC0gcmVjdC54ICogc2NhbGUsXG4gICAgeTogKHZoIC0gcmVjdC5oICogc2NhbGUpIC8gMiAtIHJlY3QueSAqIHNjYWxlLFxuICAgIHNjYWxlLFxuICB9O1xufVxuXG4vKiogQm91bmRpbmcgYm94IG9mIHRoZSBwbGFjZWQgbm9kZXMsIGluY2x1ZGluZyB0aGVpciBlZGdlcycgYmVuZCBwb2ludHMuICovXG5leHBvcnQgZnVuY3Rpb24gbGF5b3V0Qm91bmRzKGxheW91dDogRGFnTGF5b3V0KTogV29ybGRSZWN0IHtcbiAgbGV0IHgwID0gSW5maW5pdHk7XG4gIGxldCB5MCA9IEluZmluaXR5O1xuICBsZXQgeDEgPSAtSW5maW5pdHk7XG4gIGxldCB5MSA9IC1JbmZpbml0eTtcbiAgZm9yIChjb25zdCBuIG9mIGxheW91dC5ub2Rlcykge1xuICAgIHgwID0gTWF0aC5taW4oeDAsIG4ueCk7XG4gICAgeTAgPSBNYXRoLm1pbih5MCwgbi55KTtcbiAgICB4MSA9IE1hdGgubWF4KHgxLCBuLnggKyBuLncpO1xuICAgIHkxID0gTWF0aC5tYXgoeTEsIG4ueSArIG4uaCk7XG4gIH1cbiAgZm9yIChjb25zdCBlIG9mIGxheW91dC5lZGdlcykge1xuICAgIGZvciAoY29uc3QgcCBvZiBlLnBvaW50cykge1xuICAgICAgeDAgPSBNYXRoLm1pbih4MCwgcC54KTtcbiAgICAgIHkwID0gTWF0aC5taW4oeTAsIHAueSk7XG4gICAgICB4MSA9IE1hdGgubWF4KHgxLCBwLngpO1xuICAgICAgeTEgPSBNYXRoLm1heCh5MSwgcC55KTtcbiAgICB9XG4gIH1cbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoeDApKSByZXR1cm4geyB4OiAwLCB5OiAwLCB3OiAwLCBoOiAwIH07XG4gIHJldHVybiB7IHg6IHgwLCB5OiB5MCwgdzogeDEgLSB4MCwgaDogeTEgLSB5MCB9O1xufVxuXG4vKipcbiAqIEtlZXAgYXQgbGVhc3QgYG1hcmdpbmAgc2NyZWVuIHB4IG9mIHRoZSBkcmF3aW5nIG9uIHNjcmVlbi4gQSBncmFwaCBpc1xuICogcGFubmFibGUgaW4gZXZlcnkgZGlyZWN0aW9uLCBzbyB0aGlzIGlzIGEgbGVhc2ggcmF0aGVyIHRoYW4gYSBmZW5jZTogaXRcbiAqIHN0b3BzIHRoZSBjb250ZW50IGJlaW5nIGZsaWNrZWQgaW50byB0aGUgdm9pZCwgYW5kIG5ldmVyIGJsb2NrcyBhIHBhblxuICogdGhhdCBrZWVwcyBzb21ldGhpbmcgdmlzaWJsZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsYW1wVmlld3BvcnQodjogRGFnVmlld3BvcnQsIGJvdW5kczogV29ybGRSZWN0LCB2dzogbnVtYmVyLCB2aDogbnVtYmVyLCBtYXJnaW4gPSA2MCk6IERhZ1ZpZXdwb3J0IHtcbiAgY29uc3QgdyA9IGJvdW5kcy53ICogdi5zY2FsZTtcbiAgY29uc3QgaCA9IGJvdW5kcy5oICogdi5zY2FsZTtcbiAgY29uc3QgbGVmdCA9IGJvdW5kcy54ICogdi5zY2FsZSArIHYueDtcbiAgY29uc3QgdG9wID0gYm91bmRzLnkgKiB2LnNjYWxlICsgdi55O1xuICBjb25zdCBtaW5MZWZ0ID0gbWFyZ2luIC0gdztcbiAgY29uc3QgbWF4TGVmdCA9IHZ3IC0gbWFyZ2luO1xuICBjb25zdCBtaW5Ub3AgPSBtYXJnaW4gLSBoO1xuICBjb25zdCBtYXhUb3AgPSB2aCAtIG1hcmdpbjtcbiAgY29uc3QgbnggPSB2LnggKyAoTWF0aC5taW4obWF4TGVmdCwgTWF0aC5tYXgobWluTGVmdCwgbGVmdCkpIC0gbGVmdCk7XG4gIGNvbnN0IG55ID0gdi55ICsgKE1hdGgubWluKG1heFRvcCwgTWF0aC5tYXgobWluVG9wLCB0b3ApKSAtIHRvcCk7XG4gIHJldHVybiB7IHg6IG54LCB5OiBueSwgc2NhbGU6IHYuc2NhbGUgfTtcbn1cblxuLy8gLS0gQ3VsbGluZyBhbmQgaGl0IHRlc3RzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgd29ybGQgcmVjdGFuZ2xlIGEgYHZ3YCB4IGB2aGAgdmlld3BvcnQgY3VycmVudGx5IHNob3dzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZpc2libGVXb3JsZFJlY3QodjogRGFnVmlld3BvcnQsIHZ3OiBudW1iZXIsIHZoOiBudW1iZXIpOiBXb3JsZFJlY3Qge1xuICBjb25zdCBhID0gc2NyZWVuVG9Xb3JsZCh7IHg6IDAsIHk6IDAgfSwgdik7XG4gIGNvbnN0IGIgPSBzY3JlZW5Ub1dvcmxkKHsgeDogdncsIHk6IHZoIH0sIHYpO1xuICByZXR1cm4geyB4OiBhLngsIHk6IGEueSwgdzogYi54IC0gYS54LCBoOiBiLnkgLSBhLnkgfTtcbn1cblxuLyoqIFRydWUgd2hlbiBib3RoIHdvcmxkIHJlY3RhbmdsZXMgb3ZlcmxhcCBhdCBhbGwuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjdHNPdmVybGFwKGE6IFdvcmxkUmVjdCwgYjogV29ybGRSZWN0KTogYm9vbGVhbiB7XG4gIHJldHVybiBhLnggPD0gYi54ICsgYi53ICYmIGIueCA8PSBhLnggKyBhLncgJiYgYS55IDw9IGIueSArIGIuaCAmJiBiLnkgPD0gYS55ICsgYS5oO1xufVxuXG4vKiogSW5kaWNlcyBvZiB0aGUgbm9kZXMgaW50ZXJzZWN0aW5nIGB2aWV3YCwgaW4gbGF5b3V0IG9yZGVyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZpc2libGVOb2RlcyhsYXlvdXQ6IERhZ0xheW91dCwgdmlldzogV29ybGRSZWN0KTogbnVtYmVyW10ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGxheW91dC5ub2Rlcy5mb3JFYWNoKChuLCBpKSA9PiB7XG4gICAgaWYgKHJlY3RzT3ZlcmxhcCh7IHg6IG4ueCwgeTogbi55LCB3OiBuLncsIGg6IG4uaCB9LCB2aWV3KSkgb3V0LnB1c2goaSk7XG4gIH0pO1xuICByZXR1cm4gb3V0O1xufVxuXG4vKiogSW5kaWNlcyBvZiB0aGUgZWRnZXMgd2hvc2UgcG9seWxpbmUgYm91bmRpbmcgYm94IGludGVyc2VjdHMgYHZpZXdgLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZpc2libGVFZGdlcyhsYXlvdXQ6IERhZ0xheW91dCwgdmlldzogV29ybGRSZWN0KTogbnVtYmVyW10ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGxheW91dC5lZGdlcy5mb3JFYWNoKChlLCBpKSA9PiB7XG4gICAgbGV0IHgwID0gSW5maW5pdHk7XG4gICAgbGV0IHkwID0gSW5maW5pdHk7XG4gICAgbGV0IHgxID0gLUluZmluaXR5O1xuICAgIGxldCB5MSA9IC1JbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IHAgb2YgZS5wb2ludHMpIHtcbiAgICAgIHgwID0gTWF0aC5taW4oeDAsIHAueCk7XG4gICAgICB5MCA9IE1hdGgubWluKHkwLCBwLnkpO1xuICAgICAgeDEgPSBNYXRoLm1heCh4MSwgcC54KTtcbiAgICAgIHkxID0gTWF0aC5tYXgoeTEsIHAueSk7XG4gICAgfVxuICAgIGlmIChyZWN0c092ZXJsYXAoeyB4OiB4MCwgeTogeTAsIHc6IHgxIC0geDAsIGg6IHkxIC0geTAgfSwgdmlldykpIG91dC5wdXNoKGkpO1xuICB9KTtcbiAgcmV0dXJuIG91dDtcbn1cblxuLypMYXRlciBub2RlcyB3aW4uICovXG5leHBvcnQgZnVuY3Rpb24gaGl0VGVzdE5vZGVzKGxheW91dDogRGFnTGF5b3V0LCB3eDogbnVtYmVyLCB3eTogbnVtYmVyKTogbnVtYmVyIHtcbiAgZm9yIChsZXQgaSA9IGxheW91dC5ub2Rlcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGNvbnN0IG4gPSBsYXlvdXQubm9kZXNbaV07XG4gICAgaWYgKHd4ID49IG4ueCAmJiB3eCA8PSBuLnggKyBuLncgJiYgd3kgPj0gbi55ICYmIHd5IDw9IG4ueSArIG4uaCkgcmV0dXJuIGk7XG4gIH1cbiAgcmV0dXJuIC0xO1xufVxuXG4vKlRoZSBuZWFyZXN0IGVkZ2Ugd2lucywgbm90IHRoZSBmaXJzdDogd2l0aCBzZXZlcmFsIGxpbmVzIGNvbnZlcmdpbmcgb24gb25lXG4gKiBib3gsIFwidGhlIG9uZSBJIGFtIHBvaW50aW5nIGF0XCIgaXMgdGhlIGNsb3Nlc3Qgb25lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGhpdFRlc3RFZGdlcyhsYXlvdXQ6IERhZ0xheW91dCwgd3g6IG51bWJlciwgd3k6IG51bWJlciwgdG9sOiBudW1iZXIpOiBudW1iZXIge1xuICBsZXQgYmVzdCA9IC0xO1xuICBsZXQgYmVzdEQgPSB0b2wgKiB0b2w7XG4gIGxheW91dC5lZGdlcy5mb3JFYWNoKChlLCBpKSA9PiB7XG4gICAgZm9yIChsZXQgayA9IDE7IGsgPCBlLnBvaW50cy5sZW5ndGg7IGsrKykge1xuICAgICAgY29uc3QgZCA9IGRpc3RTcVRvU2VnbWVudCh3eCwgd3ksIGUucG9pbnRzW2sgLSAxXS54LCBlLnBvaW50c1trIC0gMV0ueSwgZS5wb2ludHNba10ueCwgZS5wb2ludHNba10ueSk7XG4gICAgICBpZiAoZCA8PSBiZXN0RCkge1xuICAgICAgICBiZXN0RCA9IGQ7XG4gICAgICAgIGJlc3QgPSBpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG4gIHJldHVybiBiZXN0O1xufVxuXG4vKiogQSBwbGFjZWQgbm9kZSBhcyBhIGhpdCByZWN0YW5nbGUsIGZvciB0aGUgc2hhcmVkIGhpdC10ZXN0IGhlbHBlcnMuICovXG5leHBvcnQgZnVuY3Rpb24gbm9kZVJlY3QobjogUGxhY2VkTm9kZSk6IEhpdFJlY3Qge1xuICByZXR1cm4geyB4OiBuLngsIHk6IG4ueSwgdzogbi53LCBoOiBuLmggfTtcbn1cblxuLy8gLS0gUmVhY2hhYmlsaXR5IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgZGVwZW5kZW5jeSBuZWlnaGJvdXJob29kIG9mIG9uZSBub2RlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBOZWlnaGJvdXJob29kIHtcbiAgLyoqIEV2ZXJ5dGhpbmcgdGhlIG5vZGUgZGVwZW5kcyBvbiwgdHJhbnNpdGl2ZWx5IChpdHNlbGYgZXhjbHVkZWQpLiAqL1xuICBhbmNlc3RvcnM6IFJlYWRvbmx5U2V0PG51bWJlcj47XG4gIC8qKiBFdmVyeXRoaW5nIHRoYXQgZGVwZW5kcyBvbiB0aGUgbm9kZSwgdHJhbnNpdGl2ZWx5IChpdHNlbGYgZXhjbHVkZWQpLiAqL1xuICBkZXNjZW5kYW50czogUmVhZG9ubHlTZXQ8bnVtYmVyPjtcbiAgLyoqIEVkZ2UgaW5kaWNlcyBvbiBhIHBhdGggaW50byBvciBvdXQgb2YgdGhlIG5vZGUuICovXG4gIGVkZ2VzOiBSZWFkb25seVNldDxudW1iZXI+O1xufVxuXG4vKiogRXZlcnl0aGluZyB1cC1zdHJlYW0gYW5kIGRvd24tc3RyZWFtIG9mIGEgbm9kZSwgcGx1cyB0aGUgZWRnZXNcbiAqIGNvbm5lY3RpbmcgdGhlbS4gVGhpcyBpcyB3aGF0IHRoZSBob3ZlciBoaWdobGlnaHQgcGFpbnRzOiBcIndoYXQgZG9lcyB0aGlzXG4gKiBuZWVkLCBhbmQgd2hhdCBicmVha3MgaWYgaXQgbW92ZXNcIiBpcyB0aGUgcXVlc3Rpb24gYSBkZXBlbmRlbmN5IGdyYXBoXG4gKiBleGlzdHMgdG8gYW5zd2VyLCBhbmQgb24gYSBncmFwaCBwYXN0IGEgZmV3IG5vZGVzIGl0IGNhbm5vdCBiZSBhbnN3ZXJlZFxuICogYnkgZm9sbG93aW5nIGxpbmVzIHdpdGggeW91ciBleWVzLiBUcmF2ZXJzYWwgZm9sbG93cyB0aGUgVFJVRSBlZGdlXG4gKiBkaXJlY3Rpb24sIGluY2x1ZGluZyBlZGdlcyB0aGF0IGN5Y2xlLWJyZWFraW5nIHJldmVyc2VkIGZvciBsYXlvdXQgLS0gdGhlXG4gKiBoaWdobGlnaHQgaGFzIHRvIHJlZmxlY3QgdGhlIGRlcGVuZGVuY2llcywgbm90IHRoZSBkcmF3aW5nLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5laWdoYm91cmhvb2QobGF5b3V0OiBEYWdMYXlvdXQsIGluZGV4OiBudW1iZXIpOiBOZWlnaGJvdXJob29kIHtcbiAgY29uc3QgbiA9IGxheW91dC5ub2Rlcy5sZW5ndGg7XG4gIGNvbnN0IG91dEFkajogbnVtYmVyW11bXSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IG4gfSwgKCkgPT4gW10pO1xuICBjb25zdCBpbkFkajogbnVtYmVyW11bXSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IG4gfSwgKCkgPT4gW10pO1xuICBjb25zdCBlZGdlT3V0OiBudW1iZXJbXVtdID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogbiB9LCAoKSA9PiBbXSk7XG4gIGNvbnN0IGVkZ2VJbjogbnVtYmVyW11bXSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IG4gfSwgKCkgPT4gW10pO1xuICBsYXlvdXQuZWRnZXMuZm9yRWFjaCgoZSwgaSkgPT4ge1xuICAgIG91dEFkaltlLmZyb21dLnB1c2goZS50byk7XG4gICAgaW5BZGpbZS50b10ucHVzaChlLmZyb20pO1xuICAgIGVkZ2VPdXRbZS5mcm9tXS5wdXNoKGkpO1xuICAgIGVkZ2VJbltlLnRvXS5wdXNoKGkpO1xuICB9KTtcblxuICBjb25zdCB3YWxrID0gKHN0YXJ0OiBudW1iZXIsIGFkajogbnVtYmVyW11bXSwgZWRnZUFkajogbnVtYmVyW11bXSwgZWRnZXM6IFNldDxudW1iZXI+KTogU2V0PG51bWJlcj4gPT4ge1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0PG51bWJlcj4oKTtcbiAgICBjb25zdCBzdGFjayA9IFtzdGFydF07XG4gICAgd2hpbGUgKHN0YWNrLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHYgPSBzdGFjay5wb3AoKSBhcyBudW1iZXI7XG4gICAgICBhZGpbdl0uZm9yRWFjaCgodywgaykgPT4ge1xuICAgICAgICBlZGdlcy5hZGQoZWRnZUFkalt2XVtrXSk7XG4gICAgICAgIGlmIChzZWVuLmhhcyh3KSB8fCB3ID09PSBzdGFydCkgcmV0dXJuO1xuICAgICAgICBzZWVuLmFkZCh3KTtcbiAgICAgICAgc3RhY2sucHVzaCh3KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gc2VlbjtcbiAgfTtcblxuICBjb25zdCBlZGdlcyA9IG5ldyBTZXQ8bnVtYmVyPigpO1xuICBjb25zdCBhbmNlc3RvcnMgPSB3YWxrKGluZGV4LCBpbkFkaiwgZWRnZUluLCBlZGdlcyk7XG4gIGNvbnN0IGRlc2NlbmRhbnRzID0gd2FsayhpbmRleCwgb3V0QWRqLCBlZGdlT3V0LCBlZGdlcyk7XG4gIHJldHVybiB7IGFuY2VzdG9ycywgZGVzY2VuZGFudHMsIGVkZ2VzIH07XG59XG5cbi8qKiBMb25nZXN0IGRlcGVuZGVuY3kgY2hhaW4gaW4gdGhlIGxheW91dCwgaW4gbm9kZXMuICovXG5leHBvcnQgZnVuY3Rpb24gY3JpdGljYWxQYXRoTGVuZ3RoKGxheW91dDogRGFnTGF5b3V0KTogbnVtYmVyIHtcbiAgbGV0IG1heCA9IDA7XG4gIC8vIEFuIGVkZ2VsZXNzIG5vZGUgaXMgbm90IGluIHRoZSBsYXllcmluZyBhbmQgY2FycmllcyBubyBsYXllciwgYnV0IGl0IGlzIHN0aWxsIGEgY2hhaW4gb2Ygb25lLlxuICBmb3IgKGNvbnN0IG4gb2YgbGF5b3V0Lm5vZGVzKSBtYXggPSBNYXRoLm1heChtYXgsIG4ubGF5ZXIgPCAwID8gMSA6IG4ubGF5ZXIgKyAxKTtcbiAgcmV0dXJuIG1heDtcbn1cblxuLy8gLS0gR3JvdXBpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTdGFibGUgaHVlIGZvciBhIG5vZGU6IGl0cyBgY2F0ZWdvcnlgLCBlbHNlIGl0cyBvd24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gbm9kZUh1ZShub2RlOiBEYWdOb2RlKTogbnVtYmVyIHtcbiAgY29uc3Qga2V5ID0gbm9kZS5jYXRlZ29yeSA/PyBub2RlLmlkO1xuICByZXR1cm4gTWF0aC5mbG9vcigoKGhhc2hTdHJpbmcoa2V5KSAqIDAuNjE4MDMzOTg4NzUpICUgMSkgKiAzNjApO1xufVxuXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQUEsU0FBUyxZQUFZO0FBQ3JCLE9BQU8sWUFBWTs7O0FDRVosU0FBUyxXQUFXLEdBQW1CO0FBQzVDLE1BQUksSUFBSTtBQUNSLFdBQVMsSUFBSSxHQUFHLElBQUksRUFBRSxRQUFRLEtBQUs7QUFDakMsU0FBSyxF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
