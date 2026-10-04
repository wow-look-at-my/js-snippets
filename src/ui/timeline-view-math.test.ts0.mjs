// src/ui/timeline-view-math.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/ui/hit-test.ts
function expandHitRect(r, minW) {
  if (r.w >= minW) return r;
  const cx = r.x + r.w / 2;
  return { x: cx - minW / 2, y: r.y, w: minW, h: r.h };
}
function hitTestRects(x, y, rects) {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}
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
function hitTestPolyline(px, py, pts, tol) {
  const t2 = tol * tol;
  for (let i = 1; i < pts.length; i++) {
    if (distSqToSegment(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= t2) return true;
  }
  return false;
}

// src/ui/color.ts
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function categoryHue(category) {
  const g = hashString(category) * 0.61803398875 % 1;
  return Math.floor(g * 360);
}
var TONE_SALT = `${String.fromCharCode(0)}tone`;
function categoryJitter(category) {
  const h = hashString(category + TONE_SALT);
  return {
    dl: ((h & 255) / 255 - 0.5) * 0.1,
    dc: ((h >>> 8 & 255) / 255 - 0.5) * 0.04
  };
}
function categoryColor(hue, opts = {}) {
  const l = opts.lightness ?? 0.62;
  const c = opts.chroma ?? 0.11;
  const a = opts.alpha ?? 1;
  if (opts.mode === "hsl") {
    const s = Math.round(Math.min(1, c / 0.32) * 100);
    const ll = Math.round(l * 88);
    return a >= 1 ? `hsl(${hue}, ${s}%, ${ll}%)` : `hsla(${hue}, ${s}%, ${ll}%, ${round3(a)})`;
  }
  return a >= 1 ? `oklch(${round3(l)} ${round3(c)} ${hue})` : `oklch(${round3(l)} ${round3(c)} ${hue} / ${round3(a)})`;
}
function round3(n) {
  return Math.round(n * 1e3) / 1e3;
}
function parseColor(color) {
  const c = color.trim();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const n = hex.length;
    if (n === 3 || n === 4) {
      const v = hex.split("").map((ch) => parseInt(ch + ch, 16));
      if (v.some(Number.isNaN)) return null;
      return { r: v[0], g: v[1], b: v[2], a: n === 4 ? v[3] / 255 : 1 };
    }
    if (n === 6 || n === 8) {
      const v = [0, 2, 4, 6].slice(0, n / 2).map((i) => parseInt(hex.slice(i, i + 2), 16));
      if (v.some(Number.isNaN)) return null;
      return { r: v[0], g: v[1], b: v[2], a: n === 8 ? v[3] / 255 : 1 };
    }
    return null;
  }
  const fn = c.match(/^(rgba?|hsla?|oklch)\(([^)]+)\)$/i);
  if (!fn) return null;
  const name = fn[1].toLowerCase();
  const parts = fn[2].split(/[\s,/]+/).filter((p) => p !== "");
  if (parts.length < 3) return null;
  const num = (s2) => parseFloat(s2);
  const alpha = parts.length >= 4 ? parts[3].endsWith("%") ? num(parts[3]) / 100 : num(parts[3]) : 1;
  if (Number.isNaN(alpha)) return null;
  if (name.startsWith("rgb")) {
    const [r, g, b] = parts.map(num);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b, a: alpha };
  }
  if (name.startsWith("hsl")) {
    const h = num(parts[0]);
    const s2 = num(parts[1]) / 100;
    const l2 = num(parts[2]) / 100;
    if ([h, s2, l2].some(Number.isNaN)) return null;
    const f = (k) => {
      const kk = (k + h / 30) % 12;
      return l2 - s2 * Math.min(l2, 1 - l2) * Math.max(-1, Math.min(kk - 3, 9 - kk, 1));
    };
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: alpha };
  }
  const L = num(parts[0]);
  const C = num(parts[1]);
  const H = num(parts[2]);
  if ([L, C, H].some(Number.isNaN)) return null;
  const hr = H * Math.PI / 180;
  const aa = C * Math.cos(hr);
  const bb = C * Math.sin(hr);
  const l3 = L + 0.3963377774 * aa + 0.2158037573 * bb;
  const m3 = L - 0.1055613458 * aa - 0.0638541728 * bb;
  const s3 = L - 0.0894841775 * aa - 1.291485548 * bb;
  const l = l3 * l3 * l3;
  const m = m3 * m3 * m3;
  const s = s3 * s3 * s3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ].map((ch) => {
    const cl = Math.max(0, Math.min(1, ch));
    return (cl <= 31308e-7 ? 12.92 * cl : 1.055 * Math.pow(cl, 1 / 2.4) - 0.055) * 255;
  });
  return { r: lin[0], g: lin[1], b: lin[2], a: alpha };
}
function dimColor(color) {
  const p = parseColor(color);
  if (!p) return color;
  const r = Math.max(0, Math.min(255, p.r)) / 255;
  const g = Math.max(0, Math.min(255, p.g)) / 255;
  const b = Math.max(0, Math.min(255, p.b)) / 255;
  const v = Math.max(r, g, b);
  const d = v - Math.min(r, g, b);
  const sat = v === 0 ? 0 : d / v;
  let h = 0;
  if (d !== 0) {
    if (v === r) h = (g - b) / d % 6;
    else if (v === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h + 6) % 6;
  }
  const s2 = sat * 0.5;
  const v2 = v * 0.5;
  const cc = v2 * s2;
  const x = cc * (1 - Math.abs(h % 2 - 1));
  const m0 = v2 - cc;
  const sector = Math.floor(h) % 6;
  const rgb1 = [
    [cc, x, 0],
    [x, cc, 0],
    [0, cc, x],
    [0, x, cc],
    [x, 0, cc],
    [cc, 0, x]
  ][sector];
  const out = rgb1.map((ch) => Math.round((ch + m0) * 255));
  return `rgba(${out[0]}, ${out[1]}, ${out[2]}, ${round3(p.a)})`;
}
function relativeLuminance(r, g, b) {
  const lin = (ch) => {
    const s = Math.max(0, Math.min(255, ch)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function labelHaloColor(fg) {
  const p = parseColor(fg);
  const dark = !p || relativeLuminance(p.r, p.g, p.b) >= Math.sqrt(0.05 * 1.05) - 0.05;
  return dark ? "rgba(0, 0, 0, 0.55)" : "rgba(255, 255, 255, 0.55)";
}

// src/ui/timeline-view-math.ts
function toMs(t) {
  return typeof t === "number" ? t : t.getTime();
}
var MIN_SPAN_MS = 2e3;
var MAX_SPAN_MS = 7 * 864e5;
var DEFAULT_SPAN_REF_MS = 18e4;
var DEFAULT_SPAN_REF_ASPECT = 16 / 9;
function defaultSpanForAspect(hostW, hostH, refSpanMs = DEFAULT_SPAN_REF_MS) {
  let span = refSpanMs;
  if (Number.isFinite(hostW) && hostW > 0 && Number.isFinite(hostH) && hostH > 0) {
    span = refSpanMs * (hostW / hostH) / DEFAULT_SPAN_REF_ASPECT;
  }
  return Math.min(MAX_SPAN_MS, Math.max(MIN_SPAN_MS, span));
}
function timeToX(t, view, width) {
  return (t - view.start) / (view.end - view.start) * width;
}
function xToTime(x, view, width) {
  return view.start + x / width * (view.end - view.start);
}
function panView(view, dt) {
  return { start: view.start + dt, end: view.end + dt };
}
function clampViewToNow(view, now) {
  if (view.end <= now) return view;
  return { start: now - (view.end - view.start), end: now };
}
function clampViewToBounds(view, bounds) {
  const min = bounds.min !== null && Number.isFinite(bounds.min) ? bounds.min : null;
  const max = bounds.max !== null && Number.isFinite(bounds.max) ? bounds.max : null;
  if (min === null && max === null) return view;
  const span = view.end - view.start;
  if (min !== null && max !== null && max - min <= span) return { start: min, end: max };
  let out = view;
  if (max !== null && out.end > max) out = { start: max - span, end: max };
  if (min !== null && out.start < min) out = { start: min, end: min + span };
  return out;
}
function boundedMaxSpan(bounds, maxSpan = MAX_SPAN_MS, minSpan = MIN_SPAN_MS) {
  const { min, max } = bounds;
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return maxSpan;
  return Math.max(minSpan, Math.min(maxSpan, max - min));
}
function zoomView(view, anchor, factor, minSpan = MIN_SPAN_MS, maxSpan = MAX_SPAN_MS) {
  const span = view.end - view.start;
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  let next = span / f;
  if (next < minSpan) next = minSpan;
  else if (next > maxSpan) next = maxSpan;
  const frac = span > 0 ? (anchor - view.start) / span : 0.5;
  const start = anchor - frac * next;
  return { start, end: start + next };
}
function fitSpanView(start, end, pad = 0.05, minSpan = MIN_SPAN_MS) {
  const a = toMs(start);
  const b = toMs(end);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const p = Number.isFinite(pad) && pad > 0 ? pad : pad === 0 ? 0 : 0.05;
  const span = hi - lo;
  if (span * (1 + 2 * p) < minSpan) {
    const mid = (lo + hi) / 2;
    return { start: mid - minSpan / 2, end: mid + minSpan / 2 };
  }
  return { start: lo - span * p, end: hi + span * p };
}
function wheelDeltaToPixels(delta, deltaMode, lineHeight = 16, pageHeight = 800) {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * lineHeight;
  if (deltaMode === 2) return delta * pageHeight;
  return delta;
}
var ZOOM_PX_PER_DOUBLE = 260;
function zoomFactorForWheel(deltaPx) {
  return Math.pow(2, -deltaPx / ZOOM_PX_PER_DOUBLE);
}
function laneOverflows(lanes) {
  return typeof lanes === "boolean" ? lanes : lanes.up || lanes.down;
}
function laneCanTake(lanes, dy) {
  if (typeof lanes === "boolean") return false;
  if (dy > 0) return lanes.down;
  if (dy < 0) return lanes.up;
  return false;
}
function routeWheel(e, lanes) {
  const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode);
  const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode);
  if (e.ctrlKey || e.metaKey) return { zoomPx: dy, panPx: 0, laneScrollPx: 0, consumed: true };
  if (e.shiftKey) {
    const pan = dy || dx;
    return { zoomPx: 0, panPx: pan, laneScrollPx: 0, consumed: pan !== 0 };
  }
  if (!(Math.abs(dx) > Math.abs(dy))) {
    if (laneCanTake(lanes, dy)) return { zoomPx: 0, panPx: 0, laneScrollPx: dy, consumed: true };
    return { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false };
  }
  return { zoomPx: 0, panPx: dx, laneScrollPx: laneOverflows(lanes) ? dy : 0, consumed: true };
}
function classifyWheel(e) {
  if (e.ctrlKey || e.metaKey) return "zoom";
  const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode);
  const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode);
  if (e.shiftKey) return (dy || dx) !== 0 ? "pan" : "passthrough";
  return Math.abs(dx) > Math.abs(dy) ? "pan" : "passthrough";
}
var WHEEL_GESTURE_GAP_MS = 200;
var WHEEL_AXIS_FLIP_RATIO = 2;
var WHEEL_AXIS_FLIP_MIN_PX = 24;
var WheelGestureRouter = class {
  axis = null;
  /** A 'v'-locked gesture's latched target: true = the lane stack. */
  vLane = false;
  lastTs = -Infinity;
  /**
   * Route one event of the stream. `ts` is the event's timestamp in ms
   * on any monotonic clock (e.timeStamp / performance.now()); WheelRoute
   * semantics — `consumed` is the preventDefault contract — are
   * unchanged from routeWheel.
   */
  route(e, lanes, ts) {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return routeWheel(e, lanes);
    const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode);
    const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode);
    if (dx === 0 && dy === 0) return { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false };
    if (this.axis === null || ts - this.lastTs > WHEEL_GESTURE_GAP_MS) {
      this.axis = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (this.axis === "v") this.vLane = laneCanTake(lanes, dy);
    } else if (this.axis === "h" && Math.abs(dy) > WHEEL_AXIS_FLIP_RATIO * Math.abs(dx) && Math.abs(dy) >= WHEEL_AXIS_FLIP_MIN_PX) {
      this.axis = "v";
      this.vLane = laneCanTake(lanes, dy);
    } else if (this.axis === "v" && Math.abs(dx) > WHEEL_AXIS_FLIP_RATIO * Math.abs(dy) && Math.abs(dx) >= WHEEL_AXIS_FLIP_MIN_PX) {
      this.axis = "h";
    }
    this.lastTs = ts;
    if (this.axis === "v") {
      if (this.vLane) return { zoomPx: 0, panPx: 0, laneScrollPx: dy, consumed: true };
      return { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false };
    }
    return { zoomPx: 0, panPx: dx, laneScrollPx: laneOverflows(lanes) ? dy : 0, consumed: true };
  }
};
var FOLLOW_LEAD_FRAC = 0.02;
var FOLLOW_SNAP_DEVICE_PX = 2;
function followAfterGesture(wasFollowing, prevEnd, next, now, isPan, msPerDevicePx) {
  if (isPan && next.end < prevEnd) return false;
  if (wasFollowing) return true;
  return next.end >= now - FOLLOW_SNAP_DEVICE_PX * (Number.isFinite(msPerDevicePx) && msPerDevicePx > 0 ? msPerDevicePx : 0);
}
var FOLLOW_LEAD_TWEEN_MS = 200;
var JUMP_TO_NOW_TWEEN_MS = 250;
function followLeadAt(fromFrac, targetFrac, elapsedMs, tweenMs) {
  if (!(tweenMs > 0) || !(elapsedMs < tweenMs)) return targetFrac;
  if (!(elapsedMs > 0)) return fromFrac;
  const p = elapsedMs / tweenMs;
  return fromFrac + (targetFrac - fromFrac) * p * (2 - p);
}
function gestureLeadFrac(endMs, now, span, maxFrac) {
  if (!(span > 0)) return Math.min(0, maxFrac);
  return Math.min((endMs - now) / span, maxFrac);
}
var STALE_AFTER_DEFAULT_MS = 1e4;
function feedIsStale(now, lastFresh, staleAfterMs) {
  if (lastFresh === null || !Number.isFinite(staleAfterMs) || staleAfterMs <= 0) return false;
  return now - lastFresh > staleAfterMs;
}
function liveEdgeTarget(now, lastFresh, staleAfterMs) {
  return feedIsStale(now, lastFresh, staleAfterMs) ? lastFresh : now;
}
function snapViewToDevicePixels(view, plotWidthCss, dpr) {
  const span = view.end - view.start;
  const msPerDevPx = span / (plotWidthCss * dpr);
  if (!Number.isFinite(msPerDevPx) || msPerDevPx <= 0) return view;
  const start = Math.round(view.start / msPerDevPx) * msPerDevPx;
  return { start, end: start + span };
}
function snapTextOrigin(v, dpr) {
  if (!Number.isFinite(v) || !(dpr > 0)) return v;
  return Math.round(v * dpr) / dpr;
}
function nowLineX(now, view, gutterX, plotWidthCss, dpr) {
  const x = gutterX + timeToX(now, view, plotWidthCss);
  if (!Number.isFinite(x) || !(dpr > 0)) return x;
  return (Math.round(x * dpr) + 0.5) / dpr;
}
var TIME_TICK_STEPS = [
  1,
  2,
  5,
  10,
  20,
  50,
  100,
  200,
  500,
  1e3,
  2e3,
  5e3,
  1e4,
  15e3,
  3e4,
  6e4,
  12e4,
  3e5,
  6e5,
  9e5,
  18e5,
  36e5,
  72e5,
  108e5,
  216e5,
  432e5,
  864e5,
  1728e5,
  6048e5
];
function timeTickStep(span, maxTicks) {
  const max = Math.max(1, maxTicks);
  for (const step of TIME_TICK_STEPS) {
    if (span / step <= max) return step;
  }
  return TIME_TICK_STEPS[TIME_TICK_STEPS.length - 1];
}
function timeTicks(view, maxTicks, tzOffsetMs = 0) {
  const span = view.end - view.start;
  if (!Number.isFinite(span) || span <= 0) return [];
  const step = timeTickStep(span, maxTicks);
  const first = Math.ceil((view.start + tzOffsetMs) / step) * step - tzOffsetMs;
  const ticks = [];
  for (let t = first; t <= view.end; t += step) ticks.push(t);
  return ticks;
}
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function civil(t, tzOffsetMs) {
  const local = t + tzOffsetMs;
  const dayMs = (local % 864e5 + 864e5) % 864e5;
  const days = Math.floor(local / 864e5);
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mo = mp < 10 ? mp + 3 : mp - 9;
  return {
    y: mo <= 2 ? y + 1 : y,
    mo,
    d,
    h: Math.floor(dayMs / 36e5),
    mi: Math.floor(dayMs / 6e4) % 60,
    s: Math.floor(dayMs / 1e3) % 60,
    ms: dayMs % 1e3,
    dayMs
  };
}
function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}
function formatTimeTick(t, step, tzOffsetMs = 0) {
  const c = civil(t, tzOffsetMs);
  if (step < 864e5 && c.dayMs === 0) return `${MONTHS[c.mo - 1]} ${c.d}`;
  if (step < 1e3) return `:${pad2(c.s)}.${String(c.ms).padStart(3, "0")}`;
  if (step < 6e4) return `${pad2(c.h)}:${pad2(c.mi)}:${pad2(c.s)}`;
  if (step < 864e5) return `${pad2(c.h)}:${pad2(c.mi)}`;
  return `${MONTHS[c.mo - 1]} ${c.d}`;
}
function formatTimeFull(t, tzOffsetMs = 0, withMs = false) {
  const c = civil(t, tzOffsetMs);
  const base = `${MONTHS[c.mo - 1]} ${c.d} ${pad2(c.h)}:${pad2(c.mi)}:${pad2(c.s)}`;
  return withMs ? `${base}.${String(c.ms).padStart(3, "0")}` : base;
}
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "\u2014";
  if (ms < 1e3) return `${Math.round(ms)}ms`;
  if (ms < 6e4) return `${(ms / 1e3).toFixed(1)}s`;
  if (ms < 36e5) return `${Math.floor(ms / 6e4)}m ${pad2(Math.round(ms / 1e3) % 60)}s`;
  if (ms < 864e5) return `${Math.floor(ms / 36e5)}h ${pad2(Math.floor(ms / 6e4) % 60)}m`;
  return `${Math.floor(ms / 864e5)}d ${Math.floor(ms / 36e5) % 24}h`;
}
var PACK_MIN_MS = 1;
function packTracks(items) {
  const order = items.map((_, i) => i);
  order.sort((a, b) => {
    const ia = items[a];
    const ib = items[b];
    return ia.start - ib.start || (ia.id < ib.id ? -1 : ia.id > ib.id ? 1 : 0);
  });
  const tracks = new Array(items.length).fill(0);
  const trackEnds = [];
  for (const i of order) {
    const it = items[i];
    const rows = packRows(it);
    const t = lowestFit(trackEnds, it.start, rows);
    const end = packEnd(it);
    for (let k = 0; k < rows; k++) trackEnds[t + k] = end;
    tracks[i] = t;
  }
  return { tracks, trackCount: Math.max(1, trackEnds.length) };
}
function packEnd(it) {
  return Math.max(it.end == null ? Infinity : it.end, it.start + PACK_MIN_MS);
}
function packRows(it) {
  const r = it.rows;
  return r !== void 0 && r > 1 ? Math.floor(r) : 1;
}
function lowestFit(trackEnds, start, rows) {
  let t = 0;
  for (; ; ) {
    let k = 0;
    while (k < rows && !(t + k < trackEnds.length && trackEnds[t + k] > start)) k++;
    if (k === rows) return t;
    t += k + 1;
  }
}
function packVisibleTracks(items, view) {
  const order = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.start <= view.end && packEnd(it) >= view.start) order.push(i);
  }
  order.sort((a, b) => {
    const ia = items[a];
    const ib = items[b];
    return ia.start - ib.start || (ia.id < ib.id ? -1 : ia.id > ib.id ? 1 : 0);
  });
  const tracks = new Array(items.length).fill(-1);
  const trackEnds = [];
  for (const i of order) {
    const it = items[i];
    const rows = packRows(it);
    const t = lowestFit(trackEnds, it.start, rows);
    const end = packEnd(it);
    for (let k = 0; k < rows; k++) trackEnds[t + k] = end;
    tracks[i] = t;
  }
  return { tracks, trackCount: Math.max(1, trackEnds.length) };
}
var TRACK_MEMORY_CAP = 2048;
var TrackAllocator = class {
  /** id → last assigned track. Map insertion order doubles as LRU recency. */
  memory = /* @__PURE__ */ new Map();
  /** ids assigned (visible) by the previous call — their tracks are kept. */
  live = /* @__PURE__ */ new Set();
  /** Double-buffer partner for `live` (swapped per call — no Set churn). */
  liveNext = /* @__PURE__ */ new Set();
  cap;
  // Per-call scratch, reused across calls (assign runs on the element's layout path).
  visScratch = [];
  returningScratch = [];
  freshScratch = [];
  placedScratch = [];
  constructor(memoryCap = TRACK_MEMORY_CAP) {
    this.cap = Math.max(1, Math.floor(memoryCap));
  }
  /** Assign tracks for the items visible in `view` (see the class doc). */
  assign(items, view) {
    const tracks = new Array(items.length).fill(-1);
    const vis = this.visScratch;
    vis.length = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.start <= view.end && packEnd(it) >= view.start) vis.push(i);
    }
    vis.sort((a, b) => {
      const ia = items[a];
      const ib = items[b];
      return ia.start - ib.start || (ia.id < ib.id ? -1 : ia.id > ib.id ? 1 : 0);
    });
    const placed = this.placedScratch;
    let placedUsed = 0;
    const canPlace = (t, s, e, rows) => {
      for (let r = 0; r < rows; r++) {
        if (t + r >= placedUsed) return true;
        const list = placed[t + r];
        for (let k = 0; k < list.length; k += 2) {
          if (s < list[k + 1] && list[k] < e) return false;
        }
      }
      return true;
    };
    const place = (i, t) => {
      tracks[i] = t;
      const rows = packRows(items[i]);
      while (placedUsed < t + rows) {
        const slot = placed[placedUsed] ?? (placed[placedUsed] = []);
        slot.length = 0;
        placedUsed++;
      }
      for (let r = 0; r < rows; r++) placed[t + r].push(items[i].start, packEnd(items[i]));
    };
    const lowestFree = (s, e, rows) => {
      let t = 0;
      while (!canPlace(t, s, e, rows)) t++;
      return t;
    };
    const returning = this.returningScratch;
    const fresh = this.freshScratch;
    returning.length = 0;
    fresh.length = 0;
    for (let vi = 0; vi < vis.length; vi++) {
      const i = vis[vi];
      const it = items[i];
      const kept = this.live.has(it.id) ? this.memory.get(it.id) : void 0;
      if (kept !== void 0 && canPlace(kept, it.start, packEnd(it), packRows(it))) place(i, kept);
      else if (this.memory.has(it.id)) returning.push(i);
      else fresh.push(i);
    }
    for (let ri = 0; ri < returning.length; ri++) {
      const i = returning[ri];
      const it = items[i];
      const end = packEnd(it);
      const rows = packRows(it);
      const remembered = this.memory.get(it.id);
      place(i, canPlace(remembered, it.start, end, rows) ? remembered : lowestFree(it.start, end, rows));
    }
    for (let fi = 0; fi < fresh.length; fi++) {
      const i = fresh[fi];
      const it = items[i];
      place(i, lowestFree(it.start, packEnd(it), packRows(it)));
    }
    const liveNext = this.liveNext;
    liveNext.clear();
    let maxTrack = -1;
    for (let vi = 0; vi < vis.length; vi++) {
      const i = vis[vi];
      const id = items[i].id;
      liveNext.add(id);
      this.memory.delete(id);
      this.memory.set(id, tracks[i]);
      const last = tracks[i] + packRows(items[i]) - 1;
      if (last > maxTrack) maxTrack = last;
    }
    this.liveNext = this.live;
    this.live = liveNext;
    while (this.memory.size > this.cap) {
      const oldest = this.memory.keys().next().value;
      if (oldest === void 0) break;
      this.memory.delete(oldest);
    }
    return { tracks, trackCount: Math.max(1, maxTrack + 1) };
  }
};
function resolveParents(items) {
  const idx = /* @__PURE__ */ new Map();
  for (let i = 0; i < items.length; i++) {
    if (!idx.has(items[i].id)) idx.set(items[i].id, i);
  }
  const parent = new Array(items.length).fill(-1);
  for (let i = 0; i < items.length; i++) {
    const pid = items[i].parentId;
    if (pid == null) continue;
    const p = idx.get(pid);
    if (p === void 0 || p === i) continue;
    const a = items[i].laneId;
    const b = items[p].laneId;
    if (a !== void 0 && b !== void 0 && a !== b) continue;
    parent[i] = p;
  }
  for (let i = 0; i < items.length; i++) {
    let j = parent[i];
    let steps = 0;
    while (j >= 0 && j !== i && steps <= items.length) {
      j = parent[j];
      steps++;
    }
    if (j === i) parent[i] = -1;
  }
  return parent;
}
function packFamily(node) {
  const tops = /* @__PURE__ */ new Map();
  tops.set(node.id, 0);
  let start = node.start;
  let end = node.end == null ? null : node.end;
  let ongoing = end === null;
  const children = node.children;
  if (!children || children.length === 0) return { rows: 1, start, end, tops };
  const subs = new Array(children.length);
  const items = new Array(children.length);
  for (let k = 0; k < children.length; k++) {
    const sub = packFamily(children[k]);
    subs[k] = sub;
    items[k] = { id: children[k].id, start: sub.start, end: sub.end, rows: sub.rows };
    if (sub.start < start) start = sub.start;
    if (sub.end === null) ongoing = true;
    else if (end !== null && sub.end > end) end = sub.end;
  }
  const packed = packTracks(items);
  for (let k = 0; k < children.length; k++) {
    const off = 1 + packed.tracks[k];
    for (const [id, t] of subs[k].tops) tops.set(id, off + t);
  }
  return { rows: 1 + packed.trackCount, start, end: ongoing ? null : end, tops };
}
function laneHeight(trackCount, m, trackHeight = m.trackHeight) {
  const n = Math.max(1, trackCount);
  return m.lanePad * 2 + n * trackHeight + (n - 1) * m.trackGap;
}
function layoutLanes(trackCounts, m, trackHeights) {
  const tops = [];
  const heights = [];
  let y = 0;
  for (let i = 0; i < trackCounts.length; i++) {
    const h = laneHeight(trackCounts[i], m, trackHeights?.[i] ?? m.trackHeight);
    tops.push(y);
    heights.push(h);
    y += h;
  }
  return { tops, heights, totalHeight: y };
}
function trackTop(track, m, trackHeight = m.trackHeight) {
  return m.lanePad + track * (trackHeight + m.trackGap);
}
var FIT_HYSTERESIS_FRAC = 0.1;
function demotionOrder(trackCounts) {
  const order = trackCounts.map((_, i) => i);
  order.sort((a, b) => trackCounts[b] - trackCounts[a] || b - a);
  return order;
}
function computeAutoFit(trackCounts, m, compactTrackHeight, availHeight, prevDemotedCount = 0, hysteresisFrac = FIT_HYSTERESIS_FRAC) {
  const nLanes = trackCounts.length;
  const demoted = new Array(nLanes).fill(false);
  if (nLanes === 0) return { demoted, count: 0 };
  const compact = Math.max(1, Math.min(compactTrackHeight, m.trackHeight));
  const order = demotionOrder(trackCounts);
  const savings = new Array(nLanes);
  let total = 0;
  for (let i = 0; i < nLanes; i++) {
    const hN = laneHeight(trackCounts[i], m);
    total += hN;
    savings[i] = hN - laneHeight(trackCounts[i], m, compact);
  }
  const headAvail = availHeight * (1 - hysteresisFrac);
  let kMin = total <= availHeight ? 0 : nLanes;
  let kHead = total <= headAvail ? 0 : nLanes;
  let running = total;
  for (let k = 1; k <= nLanes && (kMin === nLanes || kHead === nLanes); k++) {
    running -= savings[order[k - 1]];
    if (kMin === nLanes && running <= availHeight) kMin = k;
    if (kHead === nLanes && running <= headAvail) kHead = k;
  }
  const prev = Math.max(0, Math.min(nLanes, Math.floor(prevDemotedCount)));
  const count = prev < kMin ? kMin : prev > kHead ? kHead : prev;
  for (let i = 0; i < count; i++) demoted[order[i]] = true;
  return { demoted, count };
}
var ELLIPSIS = "\u2026";
function fitText(text, availPx, charW, minChars = 2) {
  if (!(charW > 0) || availPx <= 0 || text.length === 0) return "";
  const maxChars = Math.floor(availPx / charW);
  if (text.length <= maxChars) return text;
  if (maxChars - 1 < minChars) return "";
  return text.slice(0, maxChars - 1) + ELLIPSIS;
}
var INSTANT_THRESHOLD_PX = 3;
function isInstantWidth(widthPx, threshold = INSTANT_THRESHOLD_PX) {
  return widthPx < threshold;
}
var MIN_BAR_PX = 2;
function durationWidthPx(startMs, endMs, view, plotWidth) {
  const span = view.end - view.start;
  return span > 0 ? (endMs - startMs) / span * plotWidth : 0;
}
function edgeContinuation(startMs, endMs, view, plotWidth, fadePx) {
  const span = view.end - view.start;
  if (!(span > 0) || !(plotWidth > 0)) return { left: false, right: false };
  const eps = span / plotWidth / 2;
  return {
    left: startMs < view.start - eps && timeToX(endMs, view, plotWidth) >= fadePx,
    right: endMs > view.end + eps && timeToX(startMs, view, plotWidth) <= plotWidth - fadePx
  };
}
var CLUSTER_OVERLAP_FRAC = 0.5;
var CLUSTER_PITCH_PX = 12 * CLUSTER_OVERLAP_FRAC;
function clusterInstants(items, view, plotWidth, pitchPx = CLUSTER_PITCH_PX, instantPx = INSTANT_THRESHOLD_PX) {
  const memberOf = new Array(items.length).fill(-1);
  const clusters = [];
  const span = view.end - view.start;
  if (!(span > 0) || !(plotWidth > 0)) return { clusters, memberOf };
  const msPerPx = span / plotWidth;
  const pitchMs = Math.max(0, pitchPx) * msPerPx;
  const instantMaxMs = instantPx * msPerPx;
  const order = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.end == null || it.end - it.start >= instantMaxMs) continue;
    order.push(i);
  }
  let sorted = true;
  for (let k = 1; k < order.length; k++) {
    const ia = items[order[k - 1]];
    const ib = items[order[k]];
    if (ia.start > ib.start || ia.start === ib.start && ia.id > ib.id) {
      sorted = false;
      break;
    }
  }
  if (!sorted) {
    order.sort((a, b) => {
      const ia = items[a];
      const ib = items[b];
      return ia.start - ib.start || (ia.id < ib.id ? -1 : ia.id > ib.id ? 1 : 0);
    });
  }
  let bucketStart = 0;
  for (let oi = 0; oi <= order.length; oi++) {
    const boundary = oi === order.length || oi > bucketStart && items[order[oi]].start - items[order[oi - 1]].start >= pitchMs;
    if (!boundary) continue;
    const len = oi - bucketStart;
    if (len > 1) {
      const indices = new Array(len);
      for (let k = 0; k < len; k++) {
        const idx = order[bucketStart + k];
        indices[k] = idx;
        memberOf[idx] = clusters.length;
      }
      const marks = [];
      for (let k = 0; k < len; k++) {
        const t = items[indices[k]].start;
        const last = marks[marks.length - 1];
        if (last !== void 0 && t - last.time < pitchMs) continue;
        if (last !== void 0) last.to = k;
        marks.push({ time: t, from: k, to: len });
      }
      clusters.push({
        indices,
        extent: { start: items[indices[0]].start, end: items[indices[len - 1]].start },
        marks
      });
    }
    bucketStart = oi;
  }
  return { clusters, memberOf };
}
var CLUSTER_ZOOM_FILL_FRAC = 0.6;
function clusterZoomView(extent, minSpan = MIN_SPAN_MS, fillFrac = CLUSTER_ZOOM_FILL_FRAC) {
  const dur = Math.max(0, extent.end - extent.start);
  const span = Math.max(fillFrac > 0 ? dur / fillFrac : dur, minSpan);
  const mid = (extent.start + extent.end) / 2;
  return { start: mid - span / 2, end: mid + span / 2 };
}
function clusterMarkerTime(extent, view, marginMs) {
  if (extent.end < view.start || extent.start > view.end) return null;
  const mid = (extent.start + extent.end) / 2;
  let lo = Math.max(extent.start, view.start + marginMs);
  let hi = Math.min(extent.end, view.end - marginMs);
  if (lo > hi) {
    lo = Math.max(extent.start, view.start);
    hi = Math.min(extent.end, view.end);
  }
  return Math.min(Math.max(mid, lo), hi);
}
var MINIMAP_HANDLE_HIT_PX = 8;
var MINIMAP_MIN_WINDOW_PX = 6;
function minimapExtent(earliestStart, latestEnd, now, exhaustedBefore = null, coveredStart = null, minSpanMs = 6e4) {
  let start = Infinity;
  if (earliestStart != null) start = Math.min(start, earliestStart);
  if (coveredStart != null) start = Math.min(start, coveredStart);
  if (exhaustedBefore != null) start = Math.min(start, exhaustedBefore);
  if (!Number.isFinite(start)) return null;
  const end = latestEnd != null && latestEnd > now ? latestEnd : now;
  if (end - start < minSpanMs) start = end - minSpanMs;
  return { start, end };
}
function minimapWindowRect(view, extent, width, minPx = MINIMAP_MIN_WINDOW_PX) {
  if (!(extent.end - extent.start > 0) || !(width > 0)) return { x0: 0, x1: Math.max(0, width) };
  let x0 = timeToX(view.start, extent, width);
  let x1 = timeToX(view.end, extent, width);
  if (x1 - x0 < minPx) {
    const c = (x0 + x1) / 2;
    x0 = c - minPx / 2;
    x1 = c + minPx / 2;
  }
  if (x1 <= 0) return { x0: 0, x1: Math.min(minPx, width) };
  if (x0 >= width) return { x0: Math.max(0, width - minPx), x1: width };
  return { x0: Math.max(0, x0), x1: Math.min(width, x1) };
}
function minimapHitZone(x, rect, hitPx = MINIMAP_HANDLE_HIT_PX) {
  const inReach = Math.min(hitPx, (rect.x1 - rect.x0) / 4);
  const leftHit = x >= rect.x0 - hitPx && x <= rect.x0 + inReach;
  const rightHit = x >= rect.x1 - inReach && x <= rect.x1 + hitPx;
  if (leftHit && rightHit) return x - rect.x0 <= rect.x1 - x ? "left-handle" : "right-handle";
  if (leftHit) return "left-handle";
  if (rightHit) return "right-handle";
  if (x > rect.x0 && x < rect.x1) return "inside";
  return x < rect.x0 ? "before" : "after";
}
function clampWindowToExtent(next, extent) {
  const span = next.end - next.start;
  if (span >= extent.end - extent.start) return { start: extent.end - span, end: extent.end };
  if (next.start < extent.start) return { start: extent.start, end: extent.start + span };
  if (next.end > extent.end) return { start: extent.end - span, end: extent.end };
  return next;
}
function minimapPan(view, dxPx, extent, width) {
  if (!(extent.end - extent.start > 0) || !(width > 0)) return { start: view.start, end: view.end };
  return clampWindowToExtent(panView(view, dxPx * (extent.end - extent.start) / width), extent);
}
function minimapResize(view, edge, xPx, extent, width, minSpan = MIN_SPAN_MS, maxSpan = MAX_SPAN_MS) {
  if (!(extent.end - extent.start > 0) || !(width > 0)) return { start: view.start, end: view.end };
  const t = xToTime(Math.min(Math.max(xPx, 0), width), extent, width);
  if (edge === "left") {
    const start = Math.min(Math.max(t, extent.start, view.end - maxSpan), view.end - minSpan);
    return { start, end: view.end };
  }
  const end = Math.max(Math.min(t, extent.end, view.start + maxSpan), view.start + minSpan);
  return { start: view.start, end };
}
function minimapCenter(view, xPx, extent, width) {
  if (!(extent.end - extent.start > 0) || !(width > 0)) return { start: view.start, end: view.end };
  const span = view.end - view.start;
  const t = xToTime(Math.min(Math.max(xPx, 0), width), extent, width);
  return clampWindowToExtent({ start: t - span / 2, end: t + span / 2 }, extent);
}
function connectorRoute(from, to, samples = 24) {
  const x0 = from.x + from.w;
  const y0 = from.y + from.h / 2;
  const x1 = to.x;
  const y1 = to.y + to.h / 2;
  if (Math.abs(y0 - y1) < 0.5 && x1 >= x0) {
    return [
      { x: x0, y: y0 },
      { x: x1, y: y1 }
    ];
  }
  const c = Math.min(90, Math.max(24, Math.abs(x1 - x0) * 0.5, Math.abs(y1 - y0) * 0.35));
  const pts = [];
  const n = Math.max(2, Math.floor(samples));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x: u * u * u * x0 + 3 * u * u * t * (x0 + c) + 3 * u * t * t * (x1 - c) + t * t * t * x1,
      y: u * u * u * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y1 + t * t * t * y1
    });
  }
  return pts;
}
function segmentAtTime(segments, intervalStart, intervalEnd, t) {
  if (!segments) return null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    const cs = Math.max(toMs(s.start), intervalStart);
    const ce = Math.min(s.end == null ? intervalEnd : toMs(s.end), intervalEnd);
    if (ce < cs) continue;
    if (t >= cs && (t < ce || t === ce && ce === intervalEnd)) {
      return { index: i, kind: s.kind, start: cs, end: ce };
    }
  }
  return null;
}
var DEFAULT_STYLES = {
  "": { pattern: "solid" },
  emphasis: { pattern: "stipple", border: { width: 2, emphasis: true }, glyph: "bang" },
  failed: { pattern: "stipple", border: { width: 2, emphasis: true }, glyph: "bang" },
  dim: { pattern: "solid", dimmed: true },
  queued: { pattern: "solid", dimmed: true },
  hatch: { pattern: "hatch", dimmed: true },
  waiting: { pattern: "hatch", dimmed: true },
  outline: { pattern: "outline" },
  cancelled: { pattern: "outline", border: { width: 1.5, dash: [4, 3] } }
};
function mergeRanges(ranges) {
  const sorted = ranges.filter((r) => r.end > r.start).slice().sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else {
      out.push({ start: r.start, end: r.end });
    }
  }
  return out;
}
function subtractRanges(span, covers) {
  const out = [];
  let cursor = span.start;
  for (const c of covers) {
    if (c.end <= cursor) continue;
    if (c.start >= span.end) break;
    if (c.start > cursor) out.push({ start: cursor, end: Math.min(c.start, span.end) });
    cursor = Math.max(cursor, c.end);
    if (cursor >= span.end) break;
  }
  if (cursor < span.end) out.push({ start: cursor, end: span.end });
  return out;
}
function historyProbe(view, now, coveredEnd, prefetchFrac = 0.15) {
  const span = view.end - view.start;
  let end = Math.min(view.end, now);
  if (coveredEnd !== null && coveredEnd < end) end = coveredEnd;
  const start = view.start - span * prefetchFrac;
  return end > start ? { start, end } : null;
}
var CoverageTracker = class {
  covered = [];
  inflight = null;
  minChunk;
  retryEvery;
  retryAt = -Infinity;
  /** Time before which history is known exhausted (null = unknown). */
  exhaustedBefore = null;
  constructor(opts = {}) {
    this.minChunk = opts.minChunkMs ?? 6e4;
    this.retryEvery = opts.retryMs ?? 2e3;
  }
  /** Mark [start, end] as covered by consumer-supplied data. */
  addCovered(start, end) {
    if (!(end > start)) return;
    this.covered = mergeRanges([...this.covered, { start, end }]);
  }
  /** Sorted disjoint covered ranges (live reference — do not mutate). */
  coveredRanges() {
    return this.covered;
  }
  /** End of the newest covered range (null while nothing is covered). */
  coveredEnd() {
    const last = this.covered[this.covered.length - 1];
    return last ? last.end : null;
  }
  /** The in-flight request, if any. */
  pending() {
    return this.inflight;
  }
  /** True while a failed load is waiting out the fixed retry cadence (nothing
   * in flight, next attempt scheduled). */
  waitingRetry(now) {
    return this.inflight === null && now < this.retryAt;
  }
  /**
   * Uncovered gaps within `span` that could still hold data (gaps entirely
   * before the exhausted boundary are dropped; a gap straddling it is
   * clipped). Use for painting the loading / uncovered affordance.
   */
  uncoveredIn(span) {
    let gaps = subtractRanges(span, this.covered);
    const ex = this.exhaustedBefore;
    if (ex != null) {
      gaps = gaps.filter((g) => g.end > ex).map((g) => g.start < ex ? { start: ex, end: g.end } : g);
    }
    return gaps;
  }
  /**
   * The next range to fetch for the given viewport, or null (fully covered,
   * a request is already in flight, waiting out the retry cadence after a
   * failure, or history is exhausted). The returned range is marked in
   * flight — pass it to settle() when the load resolves or rejects.
   * Requests are widened to minChunkMs (extending into the past) so tiny
   * scroll steps don't spray tiny requests.
   */
  nextRequest(view, now) {
    if (this.inflight || now < this.retryAt) return null;
    const gaps = this.uncoveredIn({ start: view.start, end: view.end });
    if (gaps.length === 0) return null;
    const gap = gaps[gaps.length - 1];
    const req = { start: gap.start, end: gap.end };
    if (req.end - req.start < this.minChunk) req.start = req.end - this.minChunk;
    const ex = this.exhaustedBefore;
    if (ex != null && req.start < ex) req.start = ex;
    if (!(req.end > req.start)) return null;
    this.inflight = req;
    return req;
  }
  /** Resolve/reject the in-flight request (no-op for a stale range). */
  settle(range, result, now = 0) {
    if (!this.inflight || this.inflight.start !== range.start || this.inflight.end !== range.end) return;
    this.inflight = null;
    if (!result.ok) {
      this.retryAt = now + this.retryEvery;
      return;
    }
    this.retryAt = -Infinity;
    this.addCovered(range.start, range.end);
    if (result.exhausted) {
      const first = this.covered[0];
      this.exhaustedBefore = first ? first.start : range.start;
    }
  }
};
var IDLE_FRAME_MS = 1e3 / 30;
var IDLE_BATTERY_FRAME_MS = 100;
function frameBudgetMs(tier) {
  if (tier === "idle") return IDLE_FRAME_MS;
  if (tier === "idle-battery") return IDLE_BATTERY_FRAME_MS;
  return 0;
}
function shouldRender(nowTs, lastRenderTs, budgetMs, rafIntervalMs = 16.7) {
  if (budgetMs <= 0) return true;
  return nowTs - lastRenderTs >= budgetMs - rafIntervalMs / 2;
}
function clockDrawBudgetMs(view, plotWidthCss, dpr, tierBudgetMs) {
  const span = view.end - view.start;
  const wDev = plotWidthCss * dpr;
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(wDev) || wDev <= 0) return tierBudgetMs;
  return Math.max(tierBudgetMs, span / wDev);
}

// src/ui/timeline-view-math.test.ts
var HOUR = 36e5;
var DAY = 864e5;
test("toMs: numbers pass through, Dates convert", () => {
  assert.equal(toMs(1234), 1234);
  assert.equal(toMs(/* @__PURE__ */ new Date(56789)), 56789);
});
test("timeToX/xToTime: endpoints, midpoint, and round-trip", () => {
  const view = { start: 1e3, end: 2e3 };
  assert.equal(timeToX(1e3, view, 500), 0);
  assert.equal(timeToX(2e3, view, 500), 500);
  assert.equal(timeToX(1500, view, 500), 250);
  assert.equal(xToTime(250, view, 500), 1500);
  for (const x of [0, 17.5, 333, 500]) {
    assert.ok(Math.abs(timeToX(xToTime(x, view, 500), view, 500) - x) < 1e-9, `round-trip ${x}`);
  }
});
test("panView: shifts both ends, preserving the span", () => {
  const v = panView({ start: 100, end: 300 }, 50);
  assert.deepEqual(v, { start: 150, end: 350 });
});
test("zoomView: the time under the cursor stays under the cursor", () => {
  const width = 800;
  let seed = 42;
  const rand = () => {
    seed = seed * 1103515245 + 12345 & 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 200; i++) {
    const start = rand() * 1e12;
    const span = MIN_SPAN_MS * 4 + rand() * (MAX_SPAN_MS / 4);
    const view = { start, end: start + span };
    const x = rand() * width;
    const anchor = xToTime(x, view, width);
    const factor = Math.pow(2, rand() * 4 - 2);
    const zoomed = zoomView(view, anchor, factor);
    const xAfter = timeToX(anchor, zoomed, width);
    assert.ok(Math.abs(xAfter - x) < 1e-6 * width, `anchor pixel moved: ${x} -> ${xAfter}`);
  }
});
test("zoomView: factor > 1 shrinks the span by exactly that factor", () => {
  const view = { start: 0, end: 1e5 };
  const z = zoomView(view, 5e4, 2);
  assert.ok(Math.abs(z.end - z.start - 5e4) < 1e-9);
});
test("zoomView: span clamps to [MIN_SPAN_MS, MAX_SPAN_MS] and keeps the anchor fraction", () => {
  const tiny = zoomView({ start: 0, end: MIN_SPAN_MS * 2 }, MIN_SPAN_MS, 1e9);
  assert.equal(tiny.end - tiny.start, MIN_SPAN_MS);
  assert.ok(Math.abs((MIN_SPAN_MS - tiny.start) / (tiny.end - tiny.start) - 0.5) < 1e-9);
  const huge = zoomView({ start: 0, end: DAY }, DAY / 4, 1e-9);
  assert.equal(huge.end - huge.start, MAX_SPAN_MS);
  assert.ok(Math.abs((DAY / 4 - huge.start) / MAX_SPAN_MS - 0.25) < 1e-9);
});
test("zoomView: degenerate factors are ignored", () => {
  const view = { start: 0, end: 1e4 };
  assert.deepEqual(zoomView(view, 5e3, NaN), view);
  assert.deepEqual(zoomView(view, 5e3, 0), view);
  assert.deepEqual(zoomView(view, 5e3, -2), view);
});
test("wheelDeltaToPixels: deltaMode 0 is 1:1, 1 is lines, 2 is pages", () => {
  assert.equal(wheelDeltaToPixels(7.5, 0), 7.5);
  assert.equal(wheelDeltaToPixels(-120, 0), -120);
  assert.equal(wheelDeltaToPixels(3, 1), 48);
  assert.equal(wheelDeltaToPixels(3, 1, 20), 60);
  assert.equal(wheelDeltaToPixels(1, 2), 800);
  assert.equal(wheelDeltaToPixels(-2, 2, 16, 500), -1e3);
  assert.equal(wheelDeltaToPixels(NaN, 0), 0);
});
test("zoomFactorForWheel: exponential, composable, and doubling at the constant", () => {
  assert.equal(zoomFactorForWheel(0), 1);
  assert.equal(zoomFactorForWheel(-ZOOM_PX_PER_DOUBLE), 2);
  assert.equal(zoomFactorForWheel(ZOOM_PX_PER_DOUBLE), 0.5);
  const a = zoomFactorForWheel(-37) * zoomFactorForWheel(-63);
  const b = zoomFactorForWheel(-100);
  assert.ok(Math.abs(a - b) < 1e-12, "factors compose: f(a)*f(b) == f(a+b)");
});
test("defaultSpanForAspect: exactly the 3-min reference at 16:9", () => {
  assert.equal(defaultSpanForAspect(1600, 900), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(1920, 1080), DEFAULT_SPAN_REF_MS);
  assert.equal(DEFAULT_SPAN_REF_MS, 18e4);
});
test("defaultSpanForAspect: scales linearly with the container aspect ratio", () => {
  assert.ok(Math.abs(defaultSpanForAspect(2100, 900) - DEFAULT_SPAN_REF_MS * (21 / 16)) < 1e-6);
  assert.ok(Math.abs(defaultSpanForAspect(900, 900) - DEFAULT_SPAN_REF_MS * (9 / 16)) < 1e-6);
  assert.ok(Math.abs(defaultSpanForAspect(3200, 900) - 2 * defaultSpanForAspect(1600, 900)) < 1e-6);
  assert.equal(defaultSpanForAspect(160, 90), defaultSpanForAspect(3200, 1800));
});
test("defaultSpanForAspect: degenerate/unsized hosts fall back to the 3-min reference", () => {
  assert.equal(defaultSpanForAspect(0, 900), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(1600, 0), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(0, 0), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(-4, 100), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(NaN, 900), DEFAULT_SPAN_REF_MS);
  assert.equal(defaultSpanForAspect(1600, Infinity), DEFAULT_SPAN_REF_MS);
});
test("defaultSpanForAspect: clamps to [MIN_SPAN_MS, MAX_SPAN_MS] at extreme aspects", () => {
  assert.equal(defaultSpanForAspect(1e9, 1), MAX_SPAN_MS);
  assert.equal(defaultSpanForAspect(1, 1e6), MIN_SPAN_MS);
  const wide = defaultSpanForAspect(6e3, 900);
  assert.ok(wide > DEFAULT_SPAN_REF_MS && wide < MAX_SPAN_MS);
});
test("timeTickStep: picks ladder steps across spans from seconds to days", () => {
  assert.equal(timeTickStep(2e3, 8), 500);
  assert.equal(timeTickStep(6e4, 8), 1e4);
  assert.equal(timeTickStep(25 * 6e4, 8), 3e5);
  assert.equal(timeTickStep(6 * HOUR, 8), HOUR);
  assert.equal(timeTickStep(2 * DAY, 8), 6 * HOUR);
  assert.equal(timeTickStep(7 * DAY, 8), DAY);
  assert.equal(timeTickStep(1e12, 8), TIME_TICK_STEPS[TIME_TICK_STEPS.length - 1]);
});
test("timeTicks: aligned to the step, within the view, at most maxTicks + 1", () => {
  for (const span of [2e3, 45e3, 25 * 6e4, 3 * HOUR, 5 * DAY]) {
    const view = { start: 1700000123456, end: 1700000123456 + span };
    const ticks = timeTicks(view, 8);
    const step = timeTickStep(span, 8);
    assert.ok(ticks.length >= 1, `has ticks for span ${span}`);
    assert.ok(ticks.length <= 9, `count ${ticks.length} <= 9 for span ${span}`);
    for (const t of ticks) {
      assert.ok(t >= view.start && t <= view.end, `${t} inside view`);
      assert.equal(t % step, 0, `${t} on the ${step} grid`);
    }
  }
});
test("timeTicks: tzOffset aligns day ticks to local midnight", () => {
  const offset = -5 * HOUR;
  const view = { start: 17e11, end: 17e11 + 4 * DAY };
  const ticks = timeTicks(view, 5, offset);
  assert.ok(ticks.length > 0);
  for (const t of ticks) {
    assert.equal((t + offset) % DAY, 0, `${t} is local midnight`);
  }
});
test("timeTicks: empty/invalid view yields no ticks", () => {
  assert.deepEqual(timeTicks({ start: 5, end: 5 }, 8), []);
  assert.deepEqual(timeTicks({ start: 9, end: 3 }, 8), []);
  assert.deepEqual(timeTicks({ start: NaN, end: 3 }, 8), []);
});
var T = Date.UTC(2021, 0, 2, 3, 4, 5, 678);
test("formatTimeTick: granularity follows the step", () => {
  assert.equal(formatTimeTick(T, 500), ":05.678");
  assert.equal(formatTimeTick(T, 5e3), "03:04:05");
  assert.equal(formatTimeTick(T, 6e4), "03:04");
  assert.equal(formatTimeTick(T, HOUR), "03:04");
  assert.equal(formatTimeTick(T, DAY), "Jan 2");
});
test("formatTimeTick: a local-midnight tick labels as the date", () => {
  const midnight = Date.UTC(2021, 0, 2);
  assert.equal(formatTimeTick(midnight, HOUR), "Jan 2");
  assert.equal(formatTimeTick(Date.UTC(2021, 0, 2, 5), HOUR, -5 * HOUR), "Jan 2");
  assert.equal(formatTimeTick(Date.UTC(2021, 0, 2, 5), HOUR), "05:00");
});
test("formatTimeFull: date + time, optional ms", () => {
  assert.equal(formatTimeFull(T), "Jan 2 03:04:05");
  assert.equal(formatTimeFull(T, 0, true), "Jan 2 03:04:05.678");
  assert.equal(formatTimeFull(T, 3 * HOUR), "Jan 2 06:04:05");
});
test("formatDuration: table", () => {
  const cases = [
    [NaN, "\u2014"],
    [-5, "\u2014"],
    [0, "0ms"],
    [742, "742ms"],
    [1e3, "1.0s"],
    [12340, "12.3s"],
    [83e3, "1m 23s"],
    [605e3, "10m 05s"],
    [2 * HOUR + 14 * 6e4, "2h 14m"],
    [3 * DAY + 4 * HOUR, "3d 4h"]
  ];
  for (const [ms, expected] of cases) {
    assert.equal(formatDuration(ms), expected, `formatDuration(${ms})`);
  }
});
var packOf = (items) => packTracks(items);
test("pack: non-overlapping intervals share track 0", () => {
  const { tracks, trackCount } = packOf([
    { id: "a", start: 0, end: 10 },
    { id: "b", start: 10, end: 20 },
    // touching: end == start reuses the track
    { id: "c", start: 25, end: 30 }
  ]);
  assert.deepEqual(tracks, [0, 0, 0]);
  assert.equal(trackCount, 1);
});
test("pack: an overlap chain stacks first-fit", () => {
  const { tracks, trackCount } = packOf([
    { id: "a", start: 0, end: 100 },
    { id: "b", start: 10, end: 50 },
    { id: "c", start: 20, end: 30 },
    { id: "d", start: 60, end: 90 }
  ]);
  assert.deepEqual(tracks, [0, 1, 2, 1]);
  assert.equal(trackCount, 3);
});
test("pack: ongoing intervals (end null/undefined) block their track forever", () => {
  const { tracks, trackCount } = packOf([
    { id: "a", start: 0, end: null },
    { id: "b", start: 1e6 },
    // far later, but a never ends
    { id: "c", start: 2e6, end: 2000001 }
  ]);
  assert.deepEqual(tracks, [0, 1, 2]);
  assert.equal(trackCount, 3);
});
test("pack: deterministic under input re-ordering (results index-aligned)", () => {
  const items = [
    { id: "a", start: 0, end: 40 },
    { id: "b", start: 10, end: 30 },
    { id: "c", start: 35, end: 60 },
    { id: "d", start: 50, end: null },
    { id: "e", start: 55, end: 58 }
  ];
  const base = packOf(items);
  const byId = new Map(items.map((it, i) => [it.id, base.tracks[i]]));
  const shuffled = [items[3], items[0], items[4], items[2], items[1]];
  const re = packOf(shuffled);
  assert.equal(re.trackCount, base.trackCount);
  shuffled.forEach((it, i) => {
    assert.equal(re.tracks[i], byId.get(it.id), `track for ${it.id} stable under re-sort`);
  });
});
test("pack: equal starts tie-break by id, deterministically", () => {
  const a = packOf([
    { id: "x", start: 5, end: 10 },
    { id: "y", start: 5, end: 10 }
  ]);
  const b = packOf([
    { id: "y", start: 5, end: 10 },
    { id: "x", start: 5, end: 10 }
  ]);
  assert.deepEqual(a.tracks, [0, 1]);
  assert.deepEqual(b.tracks, [1, 0]);
});
test("pack: coincident zero-length instants get their own tracks (never vanish)", () => {
  const { tracks, trackCount } = packOf([
    { id: "i1", start: 100, end: 100 },
    { id: "i2", start: 100, end: 100 },
    { id: "i3", start: 100, end: 100 }
  ]);
  assert.deepEqual([...tracks].sort(), [0, 1, 2]);
  assert.equal(trackCount, 3);
});
test("pack: an instant at a bar start does not share the bar track", () => {
  const { tracks } = packOf([
    { id: "bar", start: 100, end: 500 },
    { id: "pip", start: 100, end: 100 }
  ]);
  assert.notEqual(tracks[0], tracks[1]);
  const after = packOf([
    { id: "bar", start: 100, end: 500 },
    { id: "pip", start: 500, end: 500 }
  ]);
  assert.deepEqual(after.tracks, [0, 0]);
  assert.ok(PACK_MIN_MS >= 1);
});
test("pack: empty input yields one (empty) track", () => {
  assert.deepEqual(packOf([]), { tracks: [], trackCount: 1 });
});
test("layoutLanes: heights grow with track count; tops stack; totals add up", () => {
  const m = { trackHeight: 16, trackGap: 2, lanePad: 4 };
  const { tops, heights, totalHeight } = layoutLanes([1, 3, 1], m);
  assert.deepEqual(heights, [24, 60, 24]);
  assert.deepEqual(tops, [0, 24, 84]);
  assert.equal(totalHeight, 108);
  assert.equal(trackTop(0, m), 4);
  assert.equal(trackTop(2, m), 4 + 2 * 18);
});
test("layoutLanes: a zero/negative track count still yields a one-track lane", () => {
  const m = { trackHeight: 16, trackGap: 2, lanePad: 4 };
  assert.deepEqual(layoutLanes([0], m).heights, [24]);
});
test("layoutLanes/trackTop: per-lane track heights override the metrics (compact lanes)", () => {
  const m = { trackHeight: 18, trackGap: 2, lanePad: 3 };
  const { tops, heights, totalHeight } = layoutLanes([2, 3], m, [4, 18]);
  assert.deepEqual(heights, [16, 64]);
  assert.deepEqual(tops, [0, 16]);
  assert.equal(totalHeight, 80);
  assert.equal(laneHeight(2, m, 4), 16);
  assert.equal(laneHeight(2, m), 44);
  assert.equal(trackTop(1, m, 4), 3 + 4 + 2);
  assert.equal(trackTop(1, m), 3 + 18 + 2);
});
var FIT_M = { trackHeight: 18, trackGap: 2, lanePad: 3 };
test("computeAutoFit: a naturally fitting layout demotes nothing", () => {
  const counts = [1, 2, 1];
  const natural = 24 + 44 + 24;
  for (const avail of [natural, natural + 1, 1e4]) {
    const fit = computeAutoFit(counts, FIT_M, 4, avail, 0);
    assert.deepEqual(fit.demoted, [false, false, false]);
    assert.equal(fit.count, 0);
  }
});
test("demotionOrder: tallest first; equal counts demote the LATER lane first (top keeps detail longest)", () => {
  assert.deepEqual(demotionOrder([2, 5, 3, 5]), [3, 1, 2, 0]);
  assert.deepEqual(demotionOrder([1, 1, 1]), [2, 1, 0]);
  assert.deepEqual(demotionOrder([]), []);
});
test("computeAutoFit: demotes strictly tallest-first and stops at the first fit", () => {
  const counts = [2, 5, 3, 5];
  const one = computeAutoFit(counts, FIT_M, 4, 250, 0);
  assert.deepEqual(one.demoted, [false, false, false, true]);
  assert.equal(one.count, 1, "stops at the first fitting count");
  const two = computeAutoFit(counts, FIT_M, 4, 180, 0);
  assert.deepEqual(two.demoted, [false, true, false, true]);
  assert.equal(two.count, 2);
});
test("computeAutoFit: all-compact fallback when even full demotion overflows (lane scroll takes over)", () => {
  const fit = computeAutoFit([1, 2, 3], FIT_M, 4, 10, 0);
  assert.deepEqual(fit.demoted, [true, true, true]);
  assert.equal(fit.count, 3);
});
test("computeAutoFit: hysteresis \u2014 borderline heights do not flap across jittering evaluations", () => {
  const counts = [4, 1, 1];
  assert.equal(FIT_HYSTERESIS_FRAC, 0.1);
  let count = computeAutoFit(counts, FIT_M, 4, 130, 0).count;
  assert.equal(count, 1);
  for (const avail of [132, 130, 133, 131, 132, 134, 130]) {
    const fit = computeAutoFit(counts, FIT_M, 4, avail, count);
    assert.deepEqual(fit.demoted, [true, false, false], `avail ${avail} must not flap`);
    count = fit.count;
  }
  const promoted = computeAutoFit(counts, FIT_M, 4, 150, count);
  assert.deepEqual(promoted.demoted, [false, false, false]);
  assert.equal(promoted.count, 0);
  let clean = 0;
  for (const avail of [134, 133, 137, 133, 134]) {
    const fit = computeAutoFit(counts, FIT_M, 4, avail, clean);
    assert.equal(fit.count, 0, `avail ${avail} must not demote a fitting layout`);
    clean = fit.count;
  }
});
test("computeAutoFit: stable under pure viewport translation with unchanged overlap", () => {
  const laneA = [
    { id: "a1", start: 0, end: 100 },
    { id: "a2", start: 50, end: 150 },
    { id: "a3", start: 120, end: 300 }
  ];
  const laneB = [{ id: "b1", start: 0, end: 400 }];
  const winA = { start: 40, end: 160 };
  const winB = { start: 60, end: 180 };
  const countsA = [packVisibleTracks(laneA, winA).trackCount, packVisibleTracks(laneB, winA).trackCount];
  const countsB = [packVisibleTracks(laneA, winB).trackCount, packVisibleTracks(laneB, winB).trackCount];
  assert.deepEqual(countsA, countsB);
  const fitA = computeAutoFit(countsA, FIT_M, 4, 50, 0);
  const fitB = computeAutoFit(countsB, FIT_M, 4, 50, fitA.count);
  assert.deepEqual(fitA, fitB);
  assert.deepEqual(fitA.demoted, [true, false]);
});
test("computeAutoFit: the compact height from the CSS prop drives the math (and clamps to the normal height)", () => {
  const counts = [4, 1];
  const at4 = computeAutoFit(counts, FIT_M, 4, 60, 0);
  assert.deepEqual(at4.demoted, [true, false]);
  assert.equal(laneHeight(4, FIT_M, 12), 60);
  const at12 = computeAutoFit(counts, FIT_M, 12, 60, 0);
  assert.deepEqual(at12.demoted, [true, true]);
  const clamped = computeAutoFit(counts, FIT_M, 25, 60, 0);
  assert.equal(clamped.count, 2);
});
test("computeAutoFit: visible-window count changes re-evaluate the fit deterministically", () => {
  const mk = (n, s, e, tag) => Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, start: s, end: e }));
  const lane0 = [...mk(10, 0, 100, "w"), ...mk(2, 200, 300, "x")];
  const lane1 = [...mk(2, 0, 100, "y"), ...mk(12, 200, 300, "z")];
  const early = { start: 0, end: 100 };
  const late = { start: 200, end: 300 };
  const countsEarly = [packVisibleTracks(lane0, early).trackCount, packVisibleTracks(lane1, early).trackCount];
  assert.deepEqual(countsEarly, [10, 2]);
  const fitEarly = computeAutoFit(countsEarly, FIT_M, 4, 120, 0);
  assert.deepEqual(fitEarly.demoted, [true, false]);
  const countsLate = [packVisibleTracks(lane0, late).trackCount, packVisibleTracks(lane1, late).trackCount];
  assert.deepEqual(countsLate, [2, 12]);
  const fitLate = computeAutoFit(countsLate, FIT_M, 4, 120, fitEarly.count);
  assert.deepEqual(fitLate.demoted, [false, true]);
  assert.deepEqual(computeAutoFit(countsLate, FIT_M, 4, 120, fitLate.count), fitLate);
  assert.equal(computeAutoFit(countsLate, FIT_M, 4, 400, fitLate.count).count, 0);
});
test("fitText: fits, truncates with an ellipsis, or suppresses entirely", () => {
  assert.equal(fitText("build", 50, 6), "build");
  assert.equal(fitText("deploy-production", 60, 6), `deploy-pr${ELLIPSIS}`);
  assert.equal(fitText("deploy-production", 60, 6).length, 10);
  assert.equal(fitText("ab", 30, 6), "ab");
  assert.equal(fitText("abcdef", 17, 6), "");
  assert.equal(fitText("abcdef", 0, 6), "");
  assert.equal(fitText("", 100, 6), "");
  assert.equal(fitText("abc", 100, 0), "");
});
test("fitText: never overflows the available width", () => {
  const charW = 7;
  for (const avail of [0, 5, 10, 21, 35, 70, 200]) {
    const out = fitText("a-fairly-long-interval-label", avail, charW);
    assert.ok(out.length * charW <= avail || out === "", `"${out}" fits in ${avail}px`);
  }
});
test("isInstantWidth: threshold behavior", () => {
  assert.equal(isInstantWidth(0), true);
  assert.equal(isInstantWidth(INSTANT_THRESHOLD_PX - 0.01), true);
  assert.equal(isInstantWidth(INSTANT_THRESHOLD_PX), false);
  assert.equal(isInstantWidth(10), false);
  assert.equal(isInstantWidth(4, 6), true);
});
test("expandHitRect: widens a narrow rect around its center, keeps wide rects", () => {
  const narrow = { x: 100, y: 10, w: 1, h: 12 };
  const wide = expandHitRect(narrow, 9);
  assert.deepEqual(wide, { x: 96, y: 10, w: 9, h: 12 });
  const big = { x: 0, y: 0, w: 50, h: 10 };
  assert.equal(expandHitRect(big, 9), big);
});
test("hitTestRects: topmost (last) wins; edges inclusive; miss = -1", () => {
  const rects = [
    { x: 0, y: 0, w: 100, h: 20 },
    { x: 50, y: 0, w: 100, h: 20 }
  ];
  assert.equal(hitTestRects(75, 10, rects), 1);
  assert.equal(hitTestRects(25, 10, rects), 0);
  assert.equal(hitTestRects(0, 0, rects), 0);
  assert.equal(hitTestRects(150, 20, rects), 1);
  assert.equal(hitTestRects(300, 10, rects), -1);
});
test("hit-testing an instant: the expanded rect catches near-misses", () => {
  const visual = { x: 200, y: 40, w: 0.5, h: 14 };
  const hit = expandHitRect(visual, 9);
  assert.equal(hitTestRects(203, 47, [hit]), 0, "3px right of the pip still hits");
  assert.equal(hitTestRects(197, 47, [hit]), 0, "3px left of the pip still hits");
  assert.equal(hitTestRects(206, 47, [hit]), -1, "outside the widened target misses");
});
test("distSqToSegment: interior projection and endpoint clamping", () => {
  assert.equal(distSqToSegment(5, 5, 0, 0, 10, 0), 25);
  assert.equal(distSqToSegment(-3, 4, 0, 0, 10, 0), 25);
  assert.equal(distSqToSegment(13, 4, 0, 0, 10, 0), 25);
  assert.equal(distSqToSegment(4, 4, 4, 4, 4, 4), 0);
});
test("hitTestPolyline: within tolerance of any segment", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 }
  ];
  assert.equal(hitTestPolyline(5, 2, pts, 3), true);
  assert.equal(hitTestPolyline(12, 5, pts, 3), true);
  assert.equal(hitTestPolyline(5, 5, pts, 3), false);
});
test("connectorRoute: straight 2-point segment when rows align going forward", () => {
  const from = { x: 0, y: 10, w: 20, h: 10 };
  const to = { x: 50, y: 10, w: 20, h: 10 };
  assert.deepEqual(connectorRoute(from, to), [
    { x: 20, y: 15 },
    { x: 50, y: 15 }
  ]);
});
test("connectorRoute: forward S-curve \u2014 exact endpoints, monotonic y, mid crossing", () => {
  const from = { x: 0, y: 0, w: 20, h: 10 };
  const to = { x: 60, y: 40, w: 20, h: 10 };
  const pts = connectorRoute(from, to, 24);
  assert.equal(pts.length, 25);
  assert.deepEqual(pts[0], { x: 20, y: 5 });
  assert.deepEqual(pts[pts.length - 1], { x: 60, y: 45 });
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].y >= pts[i - 1].y - 1e-9, "y descends monotonically toward the target");
  }
  assert.ok(Math.abs(pts[12].y - 25) < 1e-9);
});
test("connectorRoute: backward target loops out of the source and into the target", () => {
  const from = { x: 100, y: 0, w: 40, h: 10 };
  const to = { x: 20, y: 40, w: 30, h: 10 };
  const pts = connectorRoute(from, to, 32);
  assert.deepEqual(pts[0], { x: 140, y: 5 });
  assert.deepEqual(pts[pts.length - 1], { x: 20, y: 45 });
  assert.ok(pts[1].x > 140, "exits forward");
  assert.ok(pts[pts.length - 2].x < 20, "enters backward");
  const c = 90;
  for (const p of pts) {
    assert.ok(p.x >= 20 - c - 1e-9 && p.x <= 140 + c + 1e-9);
    assert.ok(p.y >= 5 - 1e-9 && p.y <= 45 + 1e-9);
  }
});
test("hashString: stable published values (FNV-1a)", () => {
  assert.equal(hashString(""), 2166136261);
  assert.equal(hashString("a"), 3826002220);
  assert.equal(hashString("foobar"), 3214735720);
});
test("categoryHue: deterministic, in [0, 360)", () => {
  const names = ["build", "deploy", "test", "lint", "release", "db", "cache", "api"];
  for (const n of names) {
    const h = categoryHue(n);
    assert.equal(h, categoryHue(n), `stable for ${n}`);
    assert.ok(h >= 0 && h < 360 && Number.isInteger(h), `hue ${h} valid for ${n}`);
  }
});
test("categoryHue: stable published values (a color must never drift across sessions)", () => {
  assert.deepEqual(
    ["build", "deploy", "test", "lint", "release", "db"].map(categoryHue),
    [64, 89, 260, 71, 305, 279]
  );
});
test("categoryHue: hues spread roughly uniformly over many category names", () => {
  const sectors = new Array(8).fill(0);
  for (let i = 0; i < 320; i++) sectors[Math.floor(categoryHue(`category-${i}`) / 45)]++;
  for (let s = 0; s < 8; s++) {
    assert.ok(sectors[s] >= 20, `sector ${s} underpopulated (${sectors[s]}/320)`);
  }
});
test("categoryJitter: deterministic, bounded tone offsets", () => {
  for (const n of ["build", "deploy", "a", ""]) {
    const j = categoryJitter(n);
    assert.deepEqual(j, categoryJitter(n), `stable for '${n}'`);
    assert.ok(Math.abs(j.dl) <= 0.05, `|dl| bounded for '${n}'`);
    assert.ok(Math.abs(j.dc) <= 0.02, `|dc| bounded for '${n}'`);
  }
  const a = categoryJitter("deploy");
  const b = categoryJitter("lint");
  assert.ok(Math.abs(a.dl - b.dl) > 0.01, "nearby hues get distinct lightness");
});
test("categoryColor: oklch and hsl forms, with alpha", () => {
  assert.equal(categoryColor(210), "oklch(0.62 0.11 210)");
  assert.equal(categoryColor(210, { alpha: 0.5 }), "oklch(0.62 0.11 210 / 0.5)");
  assert.equal(categoryColor(210, { lightness: 0.7, chroma: 0.2 }), "oklch(0.7 0.2 210)");
  assert.equal(categoryColor(120, { mode: "hsl" }), "hsl(120, 34%, 55%)");
  assert.equal(categoryColor(120, { mode: "hsl", alpha: 0.25 }), "hsla(120, 34%, 55%, 0.25)");
});
test("DEFAULT_STYLES: the required built-in treatments exist and alias", () => {
  assert.deepEqual(DEFAULT_STYLES.failed, DEFAULT_STYLES.emphasis);
  assert.deepEqual(DEFAULT_STYLES.queued, DEFAULT_STYLES.dim);
  assert.deepEqual(DEFAULT_STYLES.waiting, DEFAULT_STYLES.hatch);
  assert.equal(DEFAULT_STYLES.failed.glyph, "bang");
  assert.equal(DEFAULT_STYLES.failed.border?.emphasis, true);
  assert.ok((DEFAULT_STYLES.failed.border?.width ?? 0) >= 2);
  assert.equal(DEFAULT_STYLES.dim.dimmed, true);
  assert.equal(DEFAULT_STYLES.hatch.dimmed, true);
  assert.equal(DEFAULT_STYLES.hatch.pattern, "hatch");
  assert.equal(DEFAULT_STYLES.outline.pattern, "outline");
});
test("DEFAULT_STYLES: 'cancelled' is hollow + dashed, distinct from BOTH failure and success", () => {
  const c = DEFAULT_STYLES.cancelled;
  assert.equal(c.pattern, "outline", "hollow body \u2014 never a solid success-look bar");
  assert.ok((c.border?.dash?.length ?? 0) >= 2, "dashed whole-span border");
  assert.notEqual(c.border?.emphasis, true, "category hue, never the failure emphasis color");
  assert.equal(c.glyph ?? "none", "none", "no failure bang glyph");
  assert.equal(DEFAULT_STYLES.failed.border?.dash, void 0);
});
test("mergeRanges: merges overlaps and touches, drops empties, sorts", () => {
  const merged = mergeRanges([
    { start: 50, end: 60 },
    { start: 0, end: 10 },
    { start: 8, end: 20 },
    { start: 20, end: 30 },
    { start: 99, end: 99 }
  ]);
  assert.deepEqual(merged, [
    { start: 0, end: 30 },
    { start: 50, end: 60 }
  ]);
});
test("subtractRanges: gaps of a span vs a cover list", () => {
  const covers = [
    { start: 10, end: 20 },
    { start: 30, end: 40 }
  ];
  assert.deepEqual(subtractRanges({ start: 0, end: 50 }, covers), [
    { start: 0, end: 10 },
    { start: 20, end: 30 },
    { start: 40, end: 50 }
  ]);
  assert.deepEqual(subtractRanges({ start: 12, end: 18 }, covers), []);
  assert.deepEqual(subtractRanges({ start: 15, end: 35 }, covers), [{ start: 20, end: 30 }]);
});
test("coverage: requests the uncovered past, widened to the min chunk", () => {
  const c = new CoverageTracker({ minChunkMs: 1e3 });
  c.addCovered(1e4, 2e4);
  const req = c.nextRequest({ start: 9700, end: 15e3 }, 0);
  assert.ok(req, "a request is issued");
  assert.equal(req.end, 1e4);
  assert.equal(req.start, 9e3);
});
test("coverage: in-flight requests dedupe; settling covers and re-enables", () => {
  const c = new CoverageTracker({ minChunkMs: 1e3 });
  c.addCovered(1e4, 2e4);
  const view = { start: 5e3, end: 15e3 };
  const req = c.nextRequest(view, 0);
  assert.ok(req);
  assert.equal(c.nextRequest(view, 0), null, "no second request while one is in flight");
  assert.deepEqual(c.pending(), req);
  c.settle(req, { ok: true });
  assert.equal(c.pending(), null);
  assert.equal(c.nextRequest(view, 0), null, "fully covered \u2192 no more requests");
  assert.deepEqual(c.uncoveredIn({ start: 5e3, end: 15e3 }), []);
  const wider = { start: 2e3, end: 15e3 };
  const req2 = c.nextRequest(wider, 0);
  assert.ok(req2, "scrolling further back requests the newly exposed gap");
  assert.equal(req2.end, req.start);
  assert.equal(req2.start, 2e3);
});
test("coverage: a fully covered viewport issues no request", () => {
  const c = new CoverageTracker();
  c.addCovered(0, 1e5);
  assert.equal(c.nextRequest({ start: 1e4, end: 9e4 }, 0), null);
});
test("coverage: rejection retries on a fixed cadence \u2014 constant gap, no cap, no give-up", () => {
  const c = new CoverageTracker({ minChunkMs: 1e3, retryMs: 2e3 });
  c.addCovered(1e4, 2e4);
  const view = { start: 0, end: 15e3 };
  assert.equal(c.waitingRetry(0), false, "no retry pending before any failure");
  let at = 0;
  for (let i = 0; i < 50; i++) {
    const req = c.nextRequest(view, at);
    assert.ok(req, `attempt ${i + 1} is issued (never gives up)`);
    assert.equal(c.waitingRetry(at), false, "in flight is not a retry wait");
    c.settle(req, { ok: false }, at);
    assert.equal(c.nextRequest(view, at + 1999), null, "gated within the cadence window");
    assert.ok(c.waitingRetry(at + 1999), "reports the wait (keeps the frame loop pumping)");
    assert.equal(c.waitingRetry(at + 2e3), false, "wait ends exactly at the cadence boundary");
    at += 2e3;
  }
  const r = c.nextRequest(view, at);
  assert.ok(r, "attempt 51 fires exactly one cadence step after the 50th failure");
  c.settle(r, { ok: true });
  assert.equal(c.waitingRetry(at), false, "success clears the retry wait");
  const r2 = c.nextRequest({ start: -5e3, end: 1e3 }, at);
  assert.ok(r2, "after a success the next gap is requested immediately");
});
test("coverage: exhausted pins the history boundary; nothing below is requested", () => {
  const c = new CoverageTracker({ minChunkMs: 1e3 });
  c.addCovered(1e4, 2e4);
  const req = c.nextRequest({ start: 4e3, end: 15e3 }, 0);
  assert.ok(req);
  c.settle(req, { ok: true, exhausted: true });
  assert.equal(c.exhaustedBefore, req.start);
  assert.equal(c.nextRequest({ start: 0, end: 15e3 }, 10), null, "no requests below the boundary");
  assert.deepEqual(c.uncoveredIn({ start: 0, end: 15e3 }), []);
});
test("coverage: settle with a stale/unknown range is a no-op", () => {
  const c = new CoverageTracker({ minChunkMs: 1e3 });
  c.addCovered(1e4, 2e4);
  const req = c.nextRequest({ start: 0, end: 15e3 }, 0);
  assert.ok(req);
  c.settle({ start: 1, end: 2 }, { ok: true });
  assert.deepEqual(c.pending(), req, "the real in-flight request survives");
});
var wheel = (over) => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over
});
test("routeWheel: deltaX always pans time (consumed), with and without lane overflow", () => {
  for (const lanesOverflow of [false, true]) {
    const r = routeWheel(wheel({ deltaX: -8 }), lanesOverflow);
    assert.deepEqual(r, { zoomPx: 0, panPx: -8, laneScrollPx: 0, consumed: true });
  }
});
test("routeWheel: plain deltaY routes NOTHING \u2014 page scroll wins even over an overflowing lane stack", () => {
  for (const lanesOverflow of [false, true]) {
    assert.deepEqual(routeWheel(wheel({ deltaY: 5 }), lanesOverflow), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
    assert.deepEqual(routeWheel(wheel({ deltaY: -240 }), lanesOverflow), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
  }
});
test("routeWheel: a HORIZONTAL-dominant diagonal pans time; its minor deltaY nudges overflowing lanes", () => {
  assert.deepEqual(routeWheel(wheel({ deltaX: -6, deltaY: 4 }), true), { zoomPx: 0, panPx: -6, laneScrollPx: 4, consumed: true });
  assert.deepEqual(routeWheel(wheel({ deltaX: -6, deltaY: 4 }), false), { zoomPx: 0, panPx: -6, laneScrollPx: 0, consumed: true });
});
test("routeWheel: a VERTICAL-dominant diagonal (ties included) belongs to the page", () => {
  for (const lanesOverflow of [false, true]) {
    assert.deepEqual(routeWheel(wheel({ deltaX: 3, deltaY: -9 }), lanesOverflow), {
      zoomPx: 0,
      panPx: 0,
      laneScrollPx: 0,
      consumed: false
    });
    assert.deepEqual(routeWheel(wheel({ deltaX: 5, deltaY: 5 }), lanesOverflow), {
      zoomPx: 0,
      panPx: 0,
      laneScrollPx: 0,
      consumed: false
    });
    assert.equal(routeWheel(wheel({}), lanesOverflow).consumed, false);
  }
});
test("routeWheel: ctrl/meta+wheel is zoom only (deltaX ignored), always consumed", () => {
  for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
    for (const lanesOverflow of [false, true]) {
      assert.deepEqual(routeWheel(wheel({ deltaX: -6, deltaY: -10, ...mod }), lanesOverflow), {
        zoomPx: -10,
        panPx: 0,
        laneScrollPx: 0,
        consumed: true
      });
      assert.deepEqual(routeWheel(wheel({ deltaY: -10, ...mod }), lanesOverflow), {
        zoomPx: -10,
        panPx: 0,
        laneScrollPx: 0,
        consumed: true
      });
      assert.equal(routeWheel(wheel({ ...mod }), lanesOverflow).consumed, true);
    }
  }
});
test("routeWheel: shift+wheel pans time (vertical delta wins, else horizontal), consumed when nonzero", () => {
  for (const lanesOverflow of [false, true]) {
    assert.deepEqual(routeWheel(wheel({ deltaY: 7, shiftKey: true }), lanesOverflow), {
      zoomPx: 0,
      panPx: 7,
      laneScrollPx: 0,
      consumed: true
    });
    assert.deepEqual(routeWheel(wheel({ deltaX: 3, shiftKey: true }), lanesOverflow), {
      zoomPx: 0,
      panPx: 3,
      laneScrollPx: 0,
      consumed: true
    });
    assert.deepEqual(routeWheel(wheel({ deltaX: 3, deltaY: 7, shiftKey: true }), lanesOverflow), {
      zoomPx: 0,
      panPx: 7,
      laneScrollPx: 0,
      consumed: true
    });
    assert.equal(routeWheel(wheel({ shiftKey: true }), lanesOverflow).consumed, false);
  }
});
test("routeWheel: deltaMode 1 (lines) normalizes to pixels on every path", () => {
  assert.deepEqual(routeWheel(wheel({ deltaX: -2, deltaMode: 1 }), false), { zoomPx: 0, panPx: -32, laneScrollPx: 0, consumed: true });
  assert.deepEqual(routeWheel(wheel({ deltaX: -4, deltaY: 1, deltaMode: 1 }), true), {
    zoomPx: 0,
    panPx: -64,
    laneScrollPx: 16,
    consumed: true
  });
  assert.deepEqual(routeWheel(wheel({ deltaY: 3, deltaMode: 1 }), true), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
  assert.deepEqual(routeWheel(wheel({ deltaY: 3, deltaMode: 1 }), false), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
  assert.deepEqual(routeWheel(wheel({ deltaY: -1, deltaMode: 1, ctrlKey: true }), false), {
    zoomPx: -16,
    panPx: 0,
    laneScrollPx: 0,
    consumed: true
  });
});
test("classifyWheel: spot checks of the three classes", () => {
  assert.equal(classifyWheel(wheel({ ctrlKey: true })), "zoom");
  assert.equal(classifyWheel(wheel({ metaKey: true, deltaY: 4 })), "zoom");
  assert.equal(classifyWheel(wheel({ shiftKey: true, deltaY: 7 })), "pan");
  assert.equal(classifyWheel(wheel({ shiftKey: true, deltaX: 3 })), "pan");
  assert.equal(classifyWheel(wheel({ shiftKey: true })), "passthrough");
  assert.equal(classifyWheel(wheel({ deltaX: -8 })), "pan");
  assert.equal(classifyWheel(wheel({ deltaY: 120 })), "passthrough");
  assert.equal(classifyWheel(wheel({ deltaX: 5, deltaY: 5 })), "passthrough");
  assert.equal(classifyWheel(wheel({})), "passthrough");
  assert.equal(classifyWheel(wheel({ deltaY: 3, deltaMode: 1 })), "passthrough");
  assert.equal(classifyWheel(wheel({ deltaX: -2, deltaMode: 1 })), "pan");
});
test("classifyWheel \u2194 routeWheel invariant: consumed === (class !== passthrough), for ALL inputs and overflow", () => {
  const deltas = [-240, -16, -5, -1, 0, 1, 5, 16, 240, NaN, Infinity];
  const modes = [0, 1, 2];
  const mods = [
    {},
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, shiftKey: true }
  ];
  let checked = 0;
  for (const mod of mods) {
    for (const deltaMode of modes) {
      for (const deltaX of deltas) {
        for (const deltaY of deltas) {
          const e = wheel({ deltaX, deltaY, deltaMode, ...mod });
          const cls = classifyWheel(e);
          for (const lanesOverflow of [false, true]) {
            const route = routeWheel(e, lanesOverflow);
            assert.equal(
              route.consumed,
              cls !== "passthrough",
              `mismatch at dx=${deltaX} dy=${deltaY} mode=${deltaMode} mods=${JSON.stringify(mod)} overflow=${lanesOverflow}: class=${cls}, consumed=${route.consumed}`
            );
            checked++;
          }
          assert.equal(routeWheel(e, false).consumed, routeWheel(e, true).consumed);
        }
      }
    }
  }
  assert.ok(checked >= 6 * 3 * 11 * 11 * 2, `full matrix swept (${checked})`);
});
test("WheelGestureRouter: a FRESH router routes any single event exactly like routeWheel (full matrix)", () => {
  const deltas = [-240, -16, -5, -1, 0, 1, 5, 16, 240, NaN, Infinity];
  const modes = [0, 1, 2];
  const mods = [
    {},
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, shiftKey: true }
  ];
  let checked = 0;
  for (const mod of mods) {
    for (const deltaMode of modes) {
      for (const deltaX of deltas) {
        for (const deltaY of deltas) {
          const e = wheel({ deltaX, deltaY, deltaMode, ...mod });
          for (const lanesOverflow of [false, true]) {
            const fresh = new WheelGestureRouter();
            assert.deepEqual(
              fresh.route(e, lanesOverflow, 1e3),
              routeWheel(e, lanesOverflow),
              `fresh-router mismatch at dx=${deltaX} dy=${deltaY} mode=${deltaMode} mods=${JSON.stringify(mod)} overflow=${lanesOverflow}`
            );
            checked++;
          }
        }
      }
    }
  }
  assert.ok(checked >= 6 * 3 * 11 * 11 * 2, `full matrix swept (${checked})`);
});
test("WheelGestureRouter: h-locked stream consumes its vertical-dominant jitter \u2014 pan is \u03A3dx, the page gets nothing", () => {
  const stream = [
    [-120, 8],
    [-120, 8],
    [-4, 12],
    // vertical-dominant jitter: passthrough as a fresh event, consumed here
    [-120, 8],
    [0, 10],
    // pure-vertical momentum tick inside the gesture: still consumed
    [-120, 8],
    [-4, 12],
    [-120, 8]
  ];
  const r = new WheelGestureRouter();
  let ts = 5e3;
  let pan = 0;
  for (const [deltaX, deltaY] of stream) {
    const route = r.route(wheel({ deltaX, deltaY }), false, ts);
    assert.equal(route.consumed, true, `(${deltaX}, ${deltaY}) at ${ts} must be consumed inside the h gesture`);
    assert.equal(route.zoomPx, 0);
    assert.equal(route.laneScrollPx, 0, "no lane overflow: the minor dy is dropped, never half-forwarded");
    pan += route.panPx;
    ts += 16;
  }
  assert.equal(pan, -120 * 5 - 4 * 2, "pan equals the sum of every event's dx, jitter included");
});
test("WheelGestureRouter: h-locked stream over overflowing lanes \u2014 dy keeps nudging the lane stack, jitter included", () => {
  const r = new WheelGestureRouter();
  let ts = 0;
  let pan = 0;
  let lane = 0;
  for (const [deltaX, deltaY] of [
    [-60, 4],
    [-3, 9],
    // vertical-dominant jitter
    [-60, 4]
  ]) {
    const route = r.route(wheel({ deltaX, deltaY }), true, ts);
    assert.equal(route.consumed, true);
    pan += route.panPx;
    lane += route.laneScrollPx;
    ts += 16;
  }
  assert.equal(pan, -123);
  assert.equal(lane, 17, "the h route's laneScroll behavior applies stream-wide (lanesOverflow ? dy : 0)");
});
test("WheelGestureRouter: v-locked stream passes EVERYTHING through \u2014 horizontal jitter never pans the chart", () => {
  const stream = [
    [0, 120],
    [2, 90],
    [-12, 5],
    // horizontal-dominant jitter: pan as a fresh event, passthrough here
    [0, 120],
    [-14, 6],
    [0, 120]
  ];
  const r = new WheelGestureRouter();
  let ts = 9e3;
  for (const [deltaX, deltaY] of stream) {
    for (const lanesOverflow of [false, true]) {
      assert.deepEqual(r.route(wheel({ deltaX, deltaY }), lanesOverflow, ts), {
        zoomPx: 0,
        panPx: 0,
        laneScrollPx: 0,
        consumed: false
      });
    }
    ts += 16;
  }
});
test("WheelGestureRouter: a gap over WHEEL_GESTURE_GAP_MS ends the gesture \u2014 the next event classifies fresh", () => {
  const r = new WheelGestureRouter();
  assert.equal(r.route(wheel({ deltaX: -120, deltaY: 8 }), false, 1e3).consumed, true);
  assert.equal(r.route(wheel({ deltaX: -120, deltaY: 8 }), false, 1016).consumed, true);
  assert.equal(r.route(wheel({ deltaX: -4, deltaY: 10 }), false, 1316).consumed, false);
  assert.equal(r.route(wheel({ deltaX: -12, deltaY: 5 }), false, 1332).consumed, false);
  assert.equal(r.route(wheel({ deltaX: -12, deltaY: 5 }), false, 1332 + WHEEL_GESTURE_GAP_MS + 1).consumed, true);
  const b = new WheelGestureRouter();
  assert.equal(b.route(wheel({ deltaX: -120, deltaY: 8 }), false, 2e3).consumed, true);
  assert.equal(b.route(wheel({ deltaX: -4, deltaY: 10 }), false, 2e3 + WHEEL_GESTURE_GAP_MS).consumed, true, "ts delta == gap: still locked");
  const c = new WheelGestureRouter();
  assert.equal(c.route(wheel({ deltaX: -120, deltaY: 8 }), false, 2e3).consumed, true);
  assert.equal(c.route(wheel({ deltaX: -4, deltaY: 10 }), false, 2e3 + WHEEL_GESTURE_GAP_MS + 1).consumed, false, "ts delta > gap: fresh");
});
test("WheelGestureRouter: a DECISIVE opposite-axis event re-locks mid-gesture \u2014 proportional jitter never does", () => {
  const r = new WheelGestureRouter();
  assert.equal(r.route(wheel({ deltaX: -12, deltaY: 5 }), false, 1e3).consumed, true, "fresh h-dominant jitter locks h (per-event rule)");
  assert.equal(r.route(wheel({ deltaY: 100 }), false, 1016).consumed, false, "decisive vertical (>2x, >=24px) flips the lock to v");
  assert.equal(r.route(wheel({ deltaY: 100 }), false, 1032).consumed, false, "the page keeps the stream");
  assert.equal(r.route(wheel({ deltaX: -12, deltaY: 5 }), false, 1048).consumed, false, "later jitter is under the floor: no flip back");
  const v = new WheelGestureRouter();
  assert.equal(v.route(wheel({ deltaY: 120 }), false, 2e3).consumed, false);
  assert.deepEqual(v.route(wheel({ deltaX: -120, deltaY: 8 }), false, 2016), {
    zoomPx: 0,
    panPx: -120,
    laneScrollPx: 0,
    consumed: true
  });
  const h = new WheelGestureRouter();
  assert.equal(h.route(wheel({ deltaX: -120, deltaY: 8 }), false, 3e3).consumed, true);
  assert.equal(h.route(wheel({ deltaX: -4, deltaY: 12 }), false, 3016).consumed, true);
  assert.equal(h.route(wheel({ deltaX: -60, deltaY: 100 }), false, 3032).consumed, true);
  assert.equal(h.route(wheel({ deltaX: -4, deltaY: 24 }), false, 3048).consumed, false);
});
test("WheelGestureRouter: modifier events route as routeWheel and neither read nor extend the lock", () => {
  const r = new WheelGestureRouter();
  assert.equal(r.route(wheel({ deltaX: -120, deltaY: 8 }), false, 1e3).consumed, true);
  assert.deepEqual(r.route(wheel({ deltaY: -40, ctrlKey: true }), true, 1016), {
    zoomPx: -40,
    panPx: 0,
    laneScrollPx: 0,
    consumed: true
  });
  assert.deepEqual(r.route(wheel({ deltaX: -4, deltaY: 10 }), false, 1032), {
    zoomPx: 0,
    panPx: -4,
    laneScrollPx: 0,
    consumed: true
  });
  const s = new WheelGestureRouter();
  assert.equal(s.route(wheel({ deltaX: -120, deltaY: 8 }), false, 1e3).consumed, true);
  for (let ts = 1016; ts <= 1250; ts += 16) {
    assert.equal(s.route(wheel({ deltaY: -10, ctrlKey: true }), false, ts).consumed, true);
  }
  assert.equal(s.route(wheel({ deltaX: -4, deltaY: 10 }), false, 1266).consumed, false, "gap since the last UNMODIFIED event: fresh \u2192 v");
  const v = new WheelGestureRouter();
  assert.equal(v.route(wheel({ deltaY: 120 }), false, 3e3).consumed, false);
  assert.deepEqual(v.route(wheel({ deltaY: 7, shiftKey: true }), false, 3016), {
    zoomPx: 0,
    panPx: 7,
    laneScrollPx: 0,
    consumed: true
  });
  assert.equal(v.route(wheel({ deltaX: -12, deltaY: 5 }), false, 3032).consumed, false, "v lock intact across the shift event");
  const z = new WheelGestureRouter();
  assert.equal(z.route(wheel({ deltaY: -40, ctrlKey: true }), false, 4e3).consumed, true);
  assert.equal(z.route(wheel({ deltaX: -4, deltaY: 10 }), false, 4016).consumed, false, "fresh classification (v), not an inherited lock");
});
test("WheelGestureRouter: zero-delta unmodified ticks route nothing and neither start, extend, nor reset a gesture", () => {
  const r = new WheelGestureRouter();
  assert.deepEqual(r.route(wheel({}), false, 1e3), { zoomPx: 0, panPx: 0, laneScrollPx: 0, consumed: false });
  assert.equal(r.route(wheel({ deltaX: -120, deltaY: 8 }), false, 1016).consumed, true);
  assert.equal(r.route(wheel({}), false, 1032).consumed, false);
  assert.equal(r.route(wheel({ deltaX: -4, deltaY: 10 }), false, 1100).consumed, true, "lock intact across the zero tick");
  const s = new WheelGestureRouter();
  assert.equal(s.route(wheel({ deltaX: -120, deltaY: 8 }), false, 2e3).consumed, true);
  assert.equal(s.route(wheel({}), false, 2e3 + 180).consumed, false);
  assert.equal(s.route(wheel({ deltaX: -4, deltaY: 10 }), false, 2e3 + 180 + WHEEL_GESTURE_GAP_MS).consumed, false);
});
test("WheelGestureRouter: deltaMode-normalized classification \u2014 a line-mode stream locks and routes like its pixel equivalent", () => {
  const r = new WheelGestureRouter();
  assert.deepEqual(r.route(wheel({ deltaX: -2, deltaY: 1, deltaMode: 1 }), true, 1e3), {
    zoomPx: 0,
    panPx: -32,
    laneScrollPx: 16,
    consumed: true
  });
  assert.deepEqual(r.route(wheel({ deltaY: 1, deltaMode: 1 }), true, 1016), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 16,
    consumed: true
  });
  assert.equal(r.route(wheel({ deltaY: 2, deltaMode: 1 }), true, 1032).consumed, false);
  const v = new WheelGestureRouter();
  assert.equal(v.route(wheel({ deltaY: 3, deltaMode: 1 }), false, 2e3).consumed, false);
  assert.equal(v.route(wheel({ deltaX: -1, deltaMode: 1 }), false, 2016).consumed, false, "line-mode h jitter inside the v gesture");
});
test("routeWheel: direction-aware lanes \u2014 a vertical wheel scrolls the stack while it has headroom that way", () => {
  assert.deepEqual(routeWheel(wheel({ deltaY: 90 }), { up: false, down: true }), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 90,
    consumed: true
  });
  assert.deepEqual(routeWheel(wheel({ deltaY: -90 }), { up: false, down: true }), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 0,
    consumed: false
  });
  assert.deepEqual(routeWheel(wheel({ deltaY: -90 }), { up: true, down: false }), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: -90,
    consumed: true
  });
  assert.deepEqual(routeWheel(wheel({ deltaY: 90 }), { up: true, down: false }), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 0,
    consumed: false
  });
  for (const dy of [90, -90]) {
    assert.equal(routeWheel(wheel({ deltaY: dy }), { up: false, down: false }).consumed, false);
  }
  assert.deepEqual(routeWheel(wheel({ deltaX: -60, deltaY: 4 }), { up: false, down: true }), {
    zoomPx: 0,
    panPx: -60,
    laneScrollPx: 4,
    consumed: true
  });
  assert.deepEqual(routeWheel(wheel({ deltaX: -60, deltaY: 4 }), { up: false, down: false }), {
    zoomPx: 0,
    panPx: -60,
    laneScrollPx: 0,
    consumed: true
  });
});
test("WheelGestureRouter: a v gesture latches lane-vs-page from scrollability at lock time", () => {
  const r = new WheelGestureRouter();
  let ts = 1e3;
  assert.deepEqual(r.route(wheel({ deltaY: 100 }), { up: false, down: true }, ts), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 100,
    consumed: true
  });
  ts += 16;
  assert.deepEqual(
    r.route(wheel({ deltaY: 100 }), { up: true, down: false }, ts),
    { zoomPx: 0, panPx: 0, laneScrollPx: 100, consumed: true },
    "edge reached mid-gesture: still latched to the stack"
  );
  ts += 16;
  const jitter = r.route(wheel({ deltaX: -12, deltaY: 5 }), { up: true, down: false }, ts);
  assert.equal(jitter.consumed, true, "h jitter under the flip floor stays in the lane gesture");
  assert.equal(jitter.panPx, 0);
  assert.equal(jitter.laneScrollPx, 5);
  ts += WHEEL_GESTURE_GAP_MS + 1;
  assert.deepEqual(r.route(wheel({ deltaY: 100 }), { up: true, down: false }, ts), {
    zoomPx: 0,
    panPx: 0,
    laneScrollPx: 0,
    consumed: false
  });
  ts += 16;
  assert.equal(r.route(wheel({ deltaY: 100 }), { up: true, down: true }, ts).consumed, false);
  ts += WHEEL_GESTURE_GAP_MS + 1;
  assert.equal(r.route(wheel({ deltaY: 100 }), { up: true, down: true }, ts).consumed, true, "fresh gesture takes the now-scrollable stack");
});
test("WheelGestureRouter: a FRESH router equals routeWheel on direction-aware inputs too", () => {
  const scrolls = [
    { up: false, down: false },
    { up: true, down: false },
    { up: false, down: true },
    { up: true, down: true }
  ];
  for (const lanes of scrolls) {
    for (const deltaY of [-90, -1, 0, 1, 90]) {
      for (const deltaX of [0, -4, 120]) {
        const e = wheel({ deltaX, deltaY });
        const fresh = new WheelGestureRouter();
        assert.deepEqual(
          fresh.route(e, lanes, 500),
          routeWheel(e, lanes),
          `dx=${deltaX} dy=${deltaY} lanes=${JSON.stringify(lanes)}`
        );
      }
    }
  }
});
test("nowLineX: rock-steady while follow-now pins the view (the wiggle regression)", () => {
  const span = 15 * 6e4;
  const lead = 0.02;
  const plotW = 990;
  const gutter = 73.4;
  for (const dpr of [1, 1.5, 2, 3]) {
    const xs = /* @__PURE__ */ new Set();
    for (let f = 0; f < 400; f++) {
      const now = 1752e9 + f * 16.7;
      const end = now + span * lead;
      const view = { start: end - span, end };
      xs.add(nowLineX(now, view, gutter, plotW, dpr));
    }
    assert.equal(xs.size, 1, `dpr ${dpr}: expected one constant x, saw ${xs.size}`);
  }
});
test("nowLineX: lands on the half-device-pixel grid (crisp 1px stroke)", () => {
  for (const dpr of [1, 1.5, 2, 3]) {
    const view = { start: 1e6, end: 19e5 };
    const x = nowLineX(14e5, view, 80.25, 987.5, dpr);
    const dev = x * dpr - 0.5;
    assert.ok(Math.abs(dev - Math.round(dev)) < 1e-6, `dpr ${dpr}: ${x} is not on the half-device-px grid`);
  }
});
test("nowLineX: on a parked (static) view the line steps whole device pixels with the clock", () => {
  const view = { start: 0, end: 9e5 };
  const plotW = 900;
  const dpr = 2;
  const msPerDevPx = (view.end - view.start) / (plotW * dpr);
  const x0 = nowLineX(45e4, view, 60, plotW, dpr);
  const x3 = nowLineX(45e4 + 3 * msPerDevPx, view, 60, plotW, dpr);
  assert.ok(Math.abs(x3 - (x0 + 3 / dpr)) < 1e-9, `expected exactly 3 device px of advance, got ${x3 - x0}`);
});
test("nowLineX: degenerate dpr passes the unsnapped x through", () => {
  const view = { start: 0, end: 1e3 };
  assert.equal(nowLineX(500, view, 10, 100, 0), 10 + 50);
  assert.equal(nowLineX(500, view, 10, 100, NaN), 10 + 50);
});
var mppx = (span, plotW = 1e3, dpr = 1) => span / (plotW * dpr);
test("followAfterGesture: a small backward PAN disengages follow (trackpad panning must escape now)", () => {
  const now = 1e9;
  const span = 9e5;
  const end = now + span * FOLLOW_LEAD_FRAC;
  const view = { start: end - span, end };
  const next = panView(view, -1e4);
  assert.equal(followAfterGesture(true, view.end, next, now, true, mppx(span)), false, "backward pan disengages");
  assert.equal(followAfterGesture(true, view.end, next, now, false, mppx(span)), true);
});
test("followAfterGesture: consecutive backward pans stay disengaged", () => {
  const now = 1e9;
  const span = 9e5;
  let view = { start: now + span * FOLLOW_LEAD_FRAC - span, end: now + span * FOLLOW_LEAD_FRAC };
  let following = true;
  for (let i = 0; i < 5; i++) {
    const next = panView(view, -5e3);
    following = followAfterGesture(following, view.end, next, now, true, mppx(span));
    assert.equal(following, false, `step ${i} must not re-engage`);
    view = next;
  }
});
test("followAfterGesture: re-engages at the end stop \u2014 exactly at now, 1 and 2 device px short", () => {
  const now = 1e9;
  const span = 9e5;
  const px = mppx(span);
  const prevEnd = now - span;
  for (const devPx of [0, 1, 2]) {
    const v = { start: now - devPx * px - span, end: now - devPx * px };
    assert.equal(followAfterGesture(false, prevEnd, v, now, true, px), true, `${devPx} device px re-engages`);
  }
  assert.equal(FOLLOW_SNAP_DEVICE_PX, 2);
});
test("followAfterGesture: does NOT re-engage 3+ device px from the stop (near the edge is not at the edge)", () => {
  const now = 1e9;
  const span = 9e5;
  const px = mppx(span);
  const prevEnd = now - span;
  for (const devPx of [3, 4, 10, 200]) {
    const v = { start: now - devPx * px - span, end: now - devPx * px };
    assert.equal(followAfterGesture(false, prevEnd, v, now, true, px), false, `${devPx} device px stays put`);
  }
  const nearFrac = { start: now - span * 1.01, end: now - span * 0.01 };
  assert.equal(followAfterGesture(false, prevEnd, nearFrac, now, true, px), false);
});
test("followAfterGesture: device-pixel conversion \u2014 2 device px is 1 CSS px at dpr 2", () => {
  const now = 1e9;
  const span = 9e5;
  const plotW = 1e3;
  const cssPx = span / plotW;
  const prevEnd = now - span;
  assert.equal(
    followAfterGesture(false, prevEnd, { start: now - 1 * cssPx - span, end: now - 1 * cssPx }, now, true, mppx(span, plotW, 2)),
    true
  );
  assert.equal(
    followAfterGesture(false, prevEnd, { start: now - 1.6 * cssPx - span, end: now - 1.6 * cssPx }, now, true, mppx(span, plotW, 2)),
    false
  );
  assert.equal(
    followAfterGesture(false, prevEnd, { start: now - 2 * cssPx - span, end: now - 2 * cssPx }, now, true, mppx(span, plotW, 1)),
    true
  );
  assert.equal(
    followAfterGesture(false, prevEnd, { start: now - 3 * cssPx - span, end: now - 3 * cssPx }, now, true, mppx(span, plotW, 1)),
    false
  );
});
test("followAfterGesture: a span change is not a pan \u2014 wasFollowing=true stays engaged", () => {
  const now = 1e9;
  const span = 9e5;
  const end = now + span * FOLLOW_LEAD_FRAC;
  const view = { start: end - span, end };
  const zoomed = zoomView(view, end - span / 2, 1.05);
  assert.ok(zoomed.end < view.end);
  assert.ok(zoomed.end < now - FOLLOW_SNAP_DEVICE_PX * mppx(zoomed.end - zoomed.start));
  assert.equal(followAfterGesture(true, view.end, zoomed, now, false, mppx(zoomed.end - zoomed.start)), true);
  assert.equal(followAfterGesture(false, view.end, zoomed, now, false, mppx(zoomed.end - zoomed.start)), false);
});
test("zoom while following: an anchored zoom-in parks with the timestamp under the cursor intact", () => {
  const now = 1e9;
  const span = 9e5;
  const plotW = 1e3;
  const end = now + span * FOLLOW_LEAD_FRAC;
  const view = { start: end - span, end };
  const anchor = view.start + span / 3;
  const zoomed = zoomView(view, anchor, 2);
  assert.ok(Math.abs((anchor - zoomed.start) / (zoomed.end - zoomed.start) - 1 / 3) < 1e-9);
  const zSpan = zoomed.end - zoomed.start;
  assert.equal(followAfterGesture(false, view.end, zoomed, now, false, mppx(zSpan, plotW)), false);
  assert.deepEqual(clampViewToNow(zoomed, now), zoomed);
});
test("zoom while following: follow is re-earned exactly at the snap boundary (both sides)", () => {
  const now = 1e9;
  const span = 9e5;
  const plotW = 1e3;
  const view = { start: now - span, end: now };
  const frac = 1 / 3;
  const anchor = view.start + span * frac;
  const W = plotW;
  const spanFor = (k) => (now - anchor) / (1 - frac + k / W);
  for (const [k, engaged] of [
    [FOLLOW_SNAP_DEVICE_PX, true],
    [FOLLOW_SNAP_DEVICE_PX + 1, false]
  ]) {
    const zoomed = zoomView(view, anchor, span / spanFor(k));
    assert.ok(Math.abs(zoomed.end - (now - k * spanFor(k) / W)) < 1e-6);
    assert.ok(Math.abs((anchor - zoomed.start) / (zoomed.end - zoomed.start) - frac) < 1e-9);
    const zSpan = zoomed.end - zoomed.start;
    assert.equal(
      followAfterGesture(false, view.end, zoomed, now, false, mppx(zSpan, plotW)),
      engaged,
      `${k} device px short of now`
    );
  }
});
test("zoom-out pressing into the end stop re-engages: the stop, not the anchor, wins at the wall", () => {
  const now = 1e9;
  const span = 9e5;
  const plotW = 1e3;
  const end = now + span * FOLLOW_LEAD_FRAC;
  const view = { start: end - span, end };
  const anchor = view.start + span / 3;
  const zoomedOut = zoomView(view, anchor, 1 / 2);
  assert.ok(zoomedOut.end > now);
  const zSpan = zoomedOut.end - zoomedOut.start;
  assert.equal(followAfterGesture(false, view.end, zoomedOut, now, false, mppx(zSpan, plotW)), true);
  const clamped = clampViewToNow(zoomedOut, now);
  assert.equal(clamped.end, now);
  assert.equal(clamped.end - clamped.start, zSpan);
});
test("clampViewToNow: the hard end stop \u2014 end never passes now, span preserved, no-op at/before now", () => {
  const now = 1e9;
  const span = 6e5;
  for (const overshoot of [1, 5e3, span, 40 * span]) {
    const c = clampViewToNow({ start: now - span + overshoot, end: now + overshoot }, now);
    assert.equal(c.end, now, `overshoot ${overshoot} parks at the stop`);
    assert.equal(c.end - c.start, span, "span preserved");
  }
  const before = { start: now - 2 * span, end: now - span };
  assert.deepEqual(clampViewToNow(before, now), before);
  const at = { start: now - span, end: now };
  assert.deepEqual(clampViewToNow(at, now), at);
});
test("clampViewToBounds: each side clamps independently, span preserved", () => {
  const min = 1e9;
  const max = min + 36e5;
  const span = 6e5;
  const v = { start: min - 5 * span, end: min - 4 * span };
  assert.deepEqual(clampViewToBounds(v, { min: null, max: null }), v);
  const back = clampViewToBounds({ start: min - span, end: min }, { min, max: null });
  assert.deepEqual(back, { start: min, end: min + span });
  assert.deepEqual(clampViewToBounds({ start: max, end: max + span }, { min, max: null }), { start: max, end: max + span });
  const fwd = clampViewToBounds({ start: max, end: max + span }, { min: null, max });
  assert.deepEqual(fwd, { start: max - span, end: max });
  assert.deepEqual(clampViewToBounds({ start: min - 99 * span, end: min - 98 * span }, { min: null, max }), {
    start: min - 99 * span,
    end: min - 98 * span
  });
  const inside = { start: min + span, end: min + 2 * span };
  assert.deepEqual(clampViewToBounds(inside, { min, max }), inside);
  assert.deepEqual(clampViewToBounds({ start: max, end: max + span }, { min, max }), { start: max - span, end: max });
  assert.deepEqual(clampViewToBounds({ start: min - span, end: min }, { min, max }), { start: min, end: min + span });
  for (const wide of [max - min + 1, 10 * (max - min)]) {
    assert.deepEqual(clampViewToBounds({ start: min - wide, end: min }, { min, max }), { start: min, end: max });
    assert.deepEqual(clampViewToBounds({ start: max, end: max + wide }, { min, max }), { start: min, end: max });
  }
  assert.deepEqual(clampViewToBounds(v, { min: NaN, max: Infinity }), v);
});
test("boundedMaxSpan: the range when both sides are set, never under the zoom floor", () => {
  const min = 1e9;
  assert.equal(boundedMaxSpan({ min: null, max: null }), MAX_SPAN_MS);
  assert.equal(boundedMaxSpan({ min, max: null }), MAX_SPAN_MS);
  assert.equal(boundedMaxSpan({ min: null, max: min + 1e3 }), MAX_SPAN_MS);
  assert.equal(boundedMaxSpan({ min, max: min + 6e5 }), 6e5);
  assert.equal(boundedMaxSpan({ min, max: min + 30 * MAX_SPAN_MS }), MAX_SPAN_MS);
  assert.equal(boundedMaxSpan({ min, max: min + 1 }), MIN_SPAN_MS);
});
test("clampViewToBounds: a min stop and the live-now stop compose without fighting", () => {
  const min = 1e9;
  const now = min + 72e5;
  const span = 9e5;
  for (const raw of [
    { start: min - 10 * span, end: min - 9 * span },
    { start: now, end: now + span },
    { start: min + span, end: min + 2 * span }
  ]) {
    const c = clampViewToBounds(raw, { min, max: now });
    assert.ok(c.start >= min, "never before the min stop");
    assert.ok(c.end <= now, "never past the now stop");
    assert.equal(c.end - c.start, span, "span preserved \u2014 the range is wider than it");
  }
});
test("clampViewToNow + followAfterGesture: any forward overshoot parks at the stop and reliably re-docks", () => {
  const now = 1e9;
  const span = 9e5;
  const px = mppx(span);
  for (const rawEnd of [now + 1, now + 250 * px, now + span]) {
    const clamped = clampViewToNow({ start: rawEnd - span, end: rawEnd }, now);
    assert.equal(clamped.end, now);
    assert.equal(followAfterGesture(false, now - span, clamped, now, true, px), true);
  }
});
var FRAME_MS = 1e3 / 60;
var easeStepBound = (dist, dt, tween) => Math.abs(dist) * 2 * (dt / tween);
test("gestureLeadFrac: a gesture consumes lead or parks behind now \u2014 never mints lead", () => {
  const now = 1e9;
  const span = 9e5;
  assert.equal(gestureLeadFrac(now, now, span, 0), 0);
  const twoPx = 2 * mppx(span);
  const short = gestureLeadFrac(now - twoPx, now, span, 0);
  assert.ok(short < 0 && short > -0.01, `2 px short seeds slightly negative (${short})`);
  assert.equal(gestureLeadFrac(now + span, now, span, FOLLOW_LEAD_FRAC), FOLLOW_LEAD_FRAC);
  assert.equal(gestureLeadFrac(now + span, now, span, 0), 0);
  assert.equal(gestureLeadFrac(now - 10 * span, now, span, 0), -10);
  assert.equal(gestureLeadFrac(now + 5, now, 0, FOLLOW_LEAD_FRAC), 0);
});
test("followLeadAt: engage starts from the parked end and monotonically approaches the lead \u2014 no overshoot, exact landing", () => {
  const from = 0;
  let prev = from;
  assert.equal(followLeadAt(from, FOLLOW_LEAD_FRAC, 0, FOLLOW_LEAD_TWEEN_MS), from, "frame 0 IS the parked position");
  for (let t = 1; t <= FOLLOW_LEAD_TWEEN_MS + 50; t += 1) {
    const v = followLeadAt(from, FOLLOW_LEAD_FRAC, t, FOLLOW_LEAD_TWEEN_MS);
    assert.ok(v >= prev, `monotone at t=${t}`);
    assert.ok(v <= FOLLOW_LEAD_FRAC, `no overshoot at t=${t}`);
    prev = v;
  }
  assert.equal(followLeadAt(from, FOLLOW_LEAD_FRAC, FOLLOW_LEAD_TWEEN_MS, FOLLOW_LEAD_TWEEN_MS), FOLLOW_LEAD_FRAC, "lands EXACTLY on the lead");
});
test("engage: per-frame view displacement is bounded by the easing step \u2014 never the one-frame lead teleport", () => {
  const span = 9e5;
  const now0 = 1e9;
  const endAt = (t2) => now0 + t2 + span * followLeadAt(0, FOLLOW_LEAD_FRAC, t2, FOLLOW_LEAD_TWEEN_MS);
  assert.equal(endAt(0), now0, "the engaging frame leaves the view where the gesture parked");
  const teleport = span * FOLLOW_LEAD_FRAC;
  const bound = easeStepBound(FOLLOW_LEAD_FRAC * span, FRAME_MS, FOLLOW_LEAD_TWEEN_MS);
  let maxStep = 0;
  for (let t2 = FRAME_MS; t2 <= FOLLOW_LEAD_TWEEN_MS + 3 * FRAME_MS; t2 += FRAME_MS) {
    const step = endAt(t2) - endAt(t2 - FRAME_MS) - FRAME_MS;
    assert.ok(step >= -1e-6, `never moves backward while engaging (t=${t2})`);
    assert.ok(step <= bound + 1e-6, `t=${t2}: easing step ${step} within bound ${bound}`);
    maxStep = Math.max(maxStep, step);
  }
  assert.ok(maxStep < teleport / 4, `max per-frame step ${maxStep}ms is a fraction of the old ${teleport}ms teleport`);
  const t = 10 * FOLLOW_LEAD_TWEEN_MS;
  assert.equal(endAt(t), now0 + t + span * FOLLOW_LEAD_FRAC);
});
test("disengage: a backward wheel sequence consumes the lead \u2014 no frame moves more than the user delta + easing step", () => {
  const span = 9e5;
  const tween = FOLLOW_LEAD_TWEEN_MS;
  let now = 1e9;
  let lead = FOLLOW_LEAD_FRAC;
  let view = { start: now + span * lead - span, end: now + span * lead };
  const deltas = [6e3, 6e3, 6e3, 6e3];
  let glide = null;
  let following = true;
  let tickIdx = 0;
  let t = 0;
  const leadAt = (tt) => glide ? followLeadAt(glide.from, 0, tt - glide.start, tween) : lead;
  for (let frame = 0; frame < 60; frame++) {
    const prevEnd = view.end;
    let userDelta = 0;
    t += FRAME_MS;
    now += FRAME_MS;
    if (following) {
      view = { start: now + span * lead - span, end: now + span * lead };
    } else {
      const ceil = now + span * leadAt(t);
      if (view.end > ceil) view = { start: ceil - span, end: ceil };
    }
    if (frame % 3 === 2 && tickIdx < deltas.length) {
      userDelta = deltas[tickIdx++];
      const next = panView(view, -userDelta);
      if (following) {
        assert.equal(followAfterGesture(true, view.end, next, now, true, mppx(span)), false, "backward pan disengages");
        following = false;
        const residual = Math.max(0, gestureLeadFrac(next.end, now, span, lead));
        glide = { from: residual, start: t };
        view = clampViewToNow(next, now + span * residual);
        assert.equal(view.end, next.end, "the disengaging tick moves EXACTLY the user's own delta \u2014 no lead collapse");
      } else {
        view = clampViewToNow(next, now + span * leadAt(t));
        assert.equal(view.end, next.end, "later backward ticks stay pure user motion");
      }
    }
    const moved = prevEnd - view.end;
    const easing = easeStepBound((glide ? glide.from : lead) * span, FRAME_MS, tween);
    assert.ok(moved >= (following ? -FRAME_MS : 0) - 1e-6, `frame ${frame}: view never jumps FORWARD while disengaging`);
    assert.ok(moved <= userDelta + easing + 1e-6, `frame ${frame}: moved ${moved}ms > user ${userDelta}ms + easing ${easing}ms`);
  }
  assert.equal(following, false);
  assert.ok(view.end <= now, "the lead is fully consumed \u2014 the parked view is back behind now");
});
test("jumpToNow: the pill GLIDES from wherever you are and reaches the followed state exactly", () => {
  const span = 9e5;
  const now0 = 1e9;
  const parkedEnd = now0 - 10 * span;
  const from = gestureLeadFrac(parkedEnd, now0, span, 0);
  assert.equal(from, -10);
  const endAt = (t) => now0 + t + span * followLeadAt(from, FOLLOW_LEAD_FRAC, t, JUMP_TO_NOW_TWEEN_MS);
  assert.equal(endAt(0), parkedEnd, "the jump frame leaves the view where it was \u2014 no teleport");
  let prev = endAt(0);
  let movingFrames = 0;
  for (let t = FRAME_MS; t <= JUMP_TO_NOW_TWEEN_MS + FRAME_MS; t += FRAME_MS) {
    const e = endAt(Math.min(t, JUMP_TO_NOW_TWEEN_MS));
    assert.ok(e >= prev, `glides monotonically forward (t=${t})`);
    if (e - prev > FRAME_MS) movingFrames++;
    prev = e;
  }
  assert.ok(movingFrames >= 8, `the travel is spread over many frames (${movingFrames})`);
  const tEnd = JUMP_TO_NOW_TWEEN_MS;
  assert.equal(endAt(tEnd), now0 + tEnd + span * FOLLOW_LEAD_FRAC, "lands EXACTLY on the followed position (end = now + lead)");
});
test("followLeadAt: reduced motion (non-positive tween) snaps straight to the target", () => {
  for (const tween of [0, -1]) {
    assert.equal(followLeadAt(0, FOLLOW_LEAD_FRAC, 0, tween), FOLLOW_LEAD_FRAC, "engage snaps");
    assert.equal(followLeadAt(FOLLOW_LEAD_FRAC, 0, 0, tween), 0, "disengage snaps");
    assert.equal(followLeadAt(-10, FOLLOW_LEAD_FRAC, 0, tween), FOLLOW_LEAD_FRAC, "jump snaps");
  }
});
test("followLeadAt: steady-state follow is unchanged \u2014 at/after the tween the pin IS now + span * FOLLOW_LEAD_FRAC", () => {
  for (const t of [0, 1, FOLLOW_LEAD_TWEEN_MS / 2, FOLLOW_LEAD_TWEEN_MS, 1e6]) {
    assert.equal(followLeadAt(FOLLOW_LEAD_FRAC, FOLLOW_LEAD_FRAC, t, FOLLOW_LEAD_TWEEN_MS), FOLLOW_LEAD_FRAC);
  }
  assert.equal(followLeadAt(0, FOLLOW_LEAD_FRAC, FOLLOW_LEAD_TWEEN_MS + 1, FOLLOW_LEAD_TWEEN_MS), FOLLOW_LEAD_FRAC);
});
test("feedIsStale: trigger timing \u2014 fresh within the threshold, stale strictly past it", () => {
  const fresh = 1e9;
  assert.equal(feedIsStale(fresh, fresh, STALE_AFTER_DEFAULT_MS), false, "just stamped");
  assert.equal(feedIsStale(fresh + STALE_AFTER_DEFAULT_MS, fresh, STALE_AFTER_DEFAULT_MS), false, "exactly at the threshold");
  assert.equal(feedIsStale(fresh + STALE_AFTER_DEFAULT_MS + 1, fresh, STALE_AFTER_DEFAULT_MS), true, "past the threshold");
  assert.equal(feedIsStale(fresh + 6e4, fresh + 55e3, STALE_AFTER_DEFAULT_MS), false);
});
test("feedIsStale: never-fed charts and disabled thresholds are never stale", () => {
  assert.equal(feedIsStale(1e12, null, STALE_AFTER_DEFAULT_MS), false, "no data ever arrived");
  for (const off of [0, -1, Infinity, NaN]) {
    assert.equal(feedIsStale(1e12, 0, off), false, `threshold ${off} disables staleness`);
  }
});
test("liveEdgeTarget: once stale the edge FREEZES at lastFresh \u2014 an ongoing bar can never render past the last vouched timestamp", () => {
  const fresh = 1e9;
  const after = STALE_AFTER_DEFAULT_MS;
  assert.equal(liveEdgeTarget(fresh + 2e3, fresh, after), fresh + 2e3);
  for (const dead of [after + 1, 6e4, 36e5, 864e5]) {
    assert.equal(liveEdgeTarget(fresh + dead, fresh, after), fresh);
  }
});
test("stale view pinning: a followed view stops scrolling while the feed is dead", () => {
  const fresh = 1e9;
  const span = 9e5;
  const after = STALE_AFTER_DEFAULT_MS;
  const pinned = /* @__PURE__ */ new Set();
  for (let t = after + 1; t < after + 6e4; t += FRAME_MS * 10) {
    pinned.add(liveEdgeTarget(fresh + t, fresh, after) + span * FOLLOW_LEAD_FRAC);
  }
  assert.equal(pinned.size, 1, "the pinned end is one constant value \u2014 the frozen content cannot scroll out of view");
});
test("stale onset: the live edge RETRACTS to lastFresh as a bounded glide, not a one-frame teleport", () => {
  const fresh = 1e9;
  const after = STALE_AFTER_DEFAULT_MS;
  const from = fresh + after;
  let prev = from;
  for (let t = FRAME_MS; t <= JUMP_TO_NOW_TWEEN_MS; t += FRAME_MS) {
    const e = followLeadAt(from, fresh, Math.min(t, JUMP_TO_NOW_TWEEN_MS), JUMP_TO_NOW_TWEEN_MS);
    assert.ok(e <= prev, "retracts monotonically");
    assert.ok(e >= fresh, "never overshoots below the vouched timestamp");
    const step = prev - e;
    assert.ok(step <= after * 2 * FRAME_MS / JUMP_TO_NOW_TWEEN_MS + 1e-6, `bounded step (${step}ms)`);
    prev = e;
  }
  assert.equal(prev, fresh, "lands exactly on lastFresh");
});
test("stale recovery: the edge glides from the frozen point to the LIVE clock and the follow pin composes \u2014 no teleport", () => {
  const fresh = 1e9;
  const span = 9e5;
  const outage = 45e3;
  const recoverAt = fresh + outage;
  const gap = outage;
  let prevEnd = fresh + span * FOLLOW_LEAD_FRAC;
  for (let t = FRAME_MS; ; t += FRAME_MS) {
    const e = Math.min(t, JUMP_TO_NOW_TWEEN_MS);
    const clock = recoverAt + t;
    const edge = followLeadAt(fresh, clock, e, JUMP_TO_NOW_TWEEN_MS);
    const end = edge + span * FOLLOW_LEAD_FRAC;
    const step = end - prevEnd;
    assert.ok(step >= -1e-6, "the view only moves forward during recovery");
    assert.ok(step <= (gap + JUMP_TO_NOW_TWEEN_MS + FRAME_MS) * 2 * FRAME_MS / JUMP_TO_NOW_TWEEN_MS + FRAME_MS + 1e-6, "bounded easing step");
    prevEnd = end;
    if (t >= JUMP_TO_NOW_TWEEN_MS) {
      assert.equal(edge, clock, "the edge lands exactly on the live clock");
      assert.equal(end, clock + span * FOLLOW_LEAD_FRAC, "the followed view is back to steady state");
      break;
    }
  }
});
test("stale transitions: reduced motion snaps the edge (tween 0)", () => {
  const fresh = 1e9;
  assert.equal(followLeadAt(fresh + STALE_AFTER_DEFAULT_MS, fresh, 0, 0), fresh, "onset snaps to lastFresh");
  assert.equal(followLeadAt(fresh, fresh + 45e3, 0, 0), fresh + 45e3, "recovery snaps to the clock");
});
test("snapViewToDevicePixels: relative offsets are exactly stable across fractional translations", () => {
  const plotW = 1e3;
  const span = 6e5;
  const t0 = 175e10;
  const t1 = t0 + 10.4 * span / plotW;
  for (const dpr of [1, 2]) {
    const offsets = /* @__PURE__ */ new Set();
    for (let i = 0; i < 400; i++) {
      const view = { start: t0 - span / 2 + i * 7.13, end: t0 + span / 2 + i * 7.13 };
      const rv = snapViewToDevicePixels(view, plotW, dpr);
      const off = timeToX(t1, rv, plotW) - timeToX(t0, rv, plotW);
      offsets.add(Math.round(off * 1e6) / 1e6);
    }
    assert.equal(offsets.size, 1, `dpr ${dpr}: one exact relative offset across all subpixel phases`);
    assert.ok(Math.abs([...offsets][0] - 10.4) < 1e-6);
  }
});
test("snapViewToDevicePixels: a fixed time keeps a constant subpixel phase (integer device-pixel steps)", () => {
  const plotW = 977;
  const span = 123456;
  const t = 175e10;
  for (const dpr of [1, 2]) {
    const phases = /* @__PURE__ */ new Set();
    for (let i = 0; i < 300; i++) {
      const view = { start: t - span / 3 + i * 0.377, end: t + 2 * span / 3 + i * 0.377 };
      const rv = snapViewToDevicePixels(view, plotW, dpr);
      const xDev = timeToX(t, rv, plotW) * dpr;
      const phase = xDev - Math.floor(xDev);
      phases.add(Math.round(phase * 1e6) / 1e6);
    }
    assert.ok(phases.size <= 2, `dpr ${dpr}: phase is constant (mod float noise), got ${phases.size}`);
    const [a, b] = [...phases];
    if (b !== void 0) assert.ok(Math.abs(a - b) < 1e-3 || Math.abs(Math.abs(a - b) - 1) < 1e-3);
  }
});
test("snapViewToDevicePixels: span preserved; degenerate views returned unchanged", () => {
  const view = { start: 10000004e-1, end: 16000004e-1 };
  const rv = snapViewToDevicePixels(view, 800, 2);
  assert.ok(Math.abs(rv.end - rv.start - 6e5) < 1e-6);
  const bad = { start: 5, end: 5 };
  assert.deepEqual(snapViewToDevicePixels(bad, 800, 1), bad);
});
test("snapTextOrigin: lands on whole device pixels at any dpr, moving at most half a device px", () => {
  assert.equal(snapTextOrigin(10.3, 1), 10);
  assert.equal(snapTextOrigin(10.6, 1), 11);
  assert.equal(snapTextOrigin(10.3, 2), 10.5);
  assert.equal(snapTextOrigin(11.5, 2), 11.5);
  for (const dpr of [1, 2, 3]) {
    for (const v of [0, 3.7, 11.5, 123.49, 999.99]) {
      const snapped = snapTextOrigin(v, dpr);
      const dev = snapped * dpr;
      assert.ok(Math.abs(dev - Math.round(dev)) < 1e-9, `dpr ${dpr}: ${v} \u2192 integer device px`);
      assert.ok(Math.abs(snapped - v) <= 0.5 / dpr + 1e-9, `dpr ${dpr}: ${v} moved \u2264 half a device px`);
      assert.equal(snapTextOrigin(snapped, dpr), snapped, `dpr ${dpr}: idempotent`);
    }
  }
});
test("snapTextOrigin: degenerate inputs pass through", () => {
  assert.ok(Number.isNaN(snapTextOrigin(NaN, 2)));
  assert.equal(snapTextOrigin(5.4, 0), 5.4);
  assert.equal(snapTextOrigin(5.4, -1), 5.4);
  assert.equal(snapTextOrigin(Infinity, 2), Infinity);
});
test("durationWidthPx: translation-invariant \u2014 shape decisions cannot flicker while scrolling", () => {
  const plotW = 1200;
  const span = 9e5;
  const msPerPx = span / plotW;
  const base = 175e10;
  const durations = [0, 1, 100, 0.5 * msPerPx, 2.9 * msPerPx, 3.1 * msPerPx, 10 * msPerPx];
  for (const dur of durations) {
    const decisions = /* @__PURE__ */ new Set();
    for (let i = 0; i < 500; i++) {
      const view = { start: base + i * 0.731, end: base + i * 0.731 + span };
      const w = durationWidthPx(base + span / 2, base + span / 2 + dur, view, plotW);
      decisions.add(isInstantWidth(w));
    }
    assert.equal(decisions.size, 1, `duration ${dur}ms: one representation across all viewport phases`);
  }
});
test("durationWidthPx: zero-duration events are pips at any zoom; real widths clear the threshold", () => {
  const view = { start: 0, end: 6e5 };
  assert.equal(isInstantWidth(durationWidthPx(1e3, 1e3, view, 1e3)), true, "zero duration = pip");
  assert.ok(MIN_BAR_PX >= 2 && MIN_BAR_PX < INSTANT_THRESHOLD_PX);
  const wide = durationWidthPx(0, 3600, view, 1e3);
  assert.equal(isInstantWidth(wide), false);
});
test("edgeContinuation: clipped ends are flagged; fully visible spans are not", () => {
  const view = { start: 6e5, end: 12e5 };
  const inside = edgeContinuation(7e5, 9e5, view, 1e3, 12);
  assert.deepEqual(inside, { left: false, right: false });
  assert.deepEqual(edgeContinuation(1e5, 9e5, view, 1e3, 12), { left: true, right: false });
  assert.deepEqual(edgeContinuation(7e5, 15e5, view, 1e3, 12), { left: false, right: true });
  assert.deepEqual(edgeContinuation(1e5, 15e5, view, 1e3, 12), { left: true, right: true });
});
test("edgeContinuation: an end coinciding with the window edge genuinely starts/ends there \u2014 no fade", () => {
  const view = { start: 6e5, end: 12e5 };
  assert.deepEqual(edgeContinuation(view.start, 9e5, view, 1e3, 12), { left: false, right: false });
  assert.deepEqual(edgeContinuation(7e5, view.end, view, 1e3, 12), { left: false, right: false });
  assert.deepEqual(edgeContinuation(view.start - 299, 9e5, view, 1e3, 12), { left: false, right: false });
  assert.deepEqual(edgeContinuation(7e5, view.end + 299, view, 1e3, 12), { left: false, right: false });
  assert.equal(edgeContinuation(view.start - 601, 9e5, view, 1e3, 12).left, true);
  assert.equal(edgeContinuation(7e5, view.end + 601, view, 1e3, 12).right, true);
});
test("edgeContinuation: a stub not reaching through the fade zone stays a visible stub", () => {
  const view = { start: 6e5, end: 12e5 };
  assert.deepEqual(edgeContinuation(0, view.start + 5 * 600, view, 1e3, 12), { left: false, right: false });
  assert.deepEqual(edgeContinuation(view.end - 5 * 600, 9999999, view, 1e3, 12), { left: false, right: false });
  assert.equal(edgeContinuation(0, view.start + 12 * 600, view, 1e3, 12).left, true);
  assert.equal(edgeContinuation(view.end - 12 * 600, 9999999, view, 1e3, 12).right, true);
});
test("edgeContinuation: an ongoing bar at the live edge never fades (the caller passes endMs = now, inside the view)", () => {
  const now = 115e4;
  const view = { start: 6e5, end: 12e5 };
  assert.deepEqual(edgeContinuation(7e5, now, view, 1e3, 12), { left: false, right: false });
});
test("edgeContinuation: degenerate view or plot width flags nothing", () => {
  assert.deepEqual(edgeContinuation(0, 100, { start: 5, end: 5 }, 1e3, 12), { left: false, right: false });
  assert.deepEqual(edgeContinuation(0, 100, { start: 0, end: 1e3 }, 0, 12), { left: false, right: false });
});
test("packVisibleTracks: a parallelism burst outside the window does not inflate the lane", () => {
  const items = [
    { id: "b1", start: 0, end: 100 },
    { id: "b2", start: 10, end: 90 },
    { id: "b3", start: 20, end: 80 },
    { id: "b4", start: 30, end: 70 },
    // Recent, serial runs.
    { id: "r1", start: 1e3, end: 1100 },
    { id: "r2", start: 1200, end: 1300 }
  ];
  const over = packVisibleTracks(items, { start: 950, end: 1400 });
  assert.equal(over.trackCount, 1, "only the serial runs are visible");
  assert.deepEqual(over.tracks.slice(0, 4), [-1, -1, -1, -1], "burst items are out of view");
  const burst = packVisibleTracks(items, { start: 0, end: 200 });
  assert.equal(burst.trackCount, 4, "looking AT the burst still shows 4 tracks");
});
test("packVisibleTracks: partial overlap counts; empty window collapses to one track", () => {
  const items = [
    { id: "a", start: 0, end: 500 },
    { id: "b", start: 400, end: 900 }
  ];
  assert.equal(packVisibleTracks(items, { start: 420, end: 480 }).trackCount, 2);
  const empty = packVisibleTracks(items, { start: 2e3, end: 3e3 });
  assert.equal(empty.trackCount, 1);
  assert.deepEqual(empty.tracks, [-1, -1]);
});
test("packVisibleTracks: ongoing intervals (end null) intersect every later window", () => {
  const items = [
    { id: "live", start: 100, end: null },
    { id: "x", start: 5e3, end: 6e3 }
  ];
  const r = packVisibleTracks(items, { start: 4e3, end: 7e3 });
  assert.equal(r.trackCount, 2, "the ongoing run still occupies a track");
  assert.notEqual(r.tracks[0], -1);
});
test("packVisibleTracks: assignment is stable while the window slides over an unchanged visible set", () => {
  const items = [
    { id: "a", start: 1e3, end: 2e3 },
    { id: "b", start: 1500, end: 2500 },
    { id: "c", start: 2600, end: 3e3 }
  ];
  const first = packVisibleTracks(items, { start: 900, end: 3100 });
  for (let dt = 0; dt < 80; dt += 7) {
    const r = packVisibleTracks(items, { start: 900 + dt, end: 3100 + dt });
    assert.deepEqual(r.tracks, first.tracks, `slide +${dt} keeps identical assignments`);
    assert.equal(r.trackCount, first.trackCount);
  }
});
test("pack: a multi-row item takes a run of consecutive free tracks and blocks all of them", () => {
  const { tracks, trackCount } = packOf([
    { id: "a", start: 0, end: 100, rows: 3 },
    { id: "b", start: 10, end: 50 },
    { id: "c", start: 150, end: 200 }
  ]);
  assert.deepEqual(tracks, [0, 3, 0]);
  assert.equal(trackCount, 4);
});
test("pack: a multi-row item skips past a busy track inside its candidate run", () => {
  const { tracks, trackCount } = packOf([
    { id: "x", start: 0, end: 100 },
    { id: "y", start: 0, end: 100 },
    { id: "z", start: 0, end: 100 },
    { id: "blk", start: 5, end: 50, rows: 2 }
  ]);
  assert.deepEqual(tracks.slice(0, 3), [0, 1, 2]);
  assert.equal(tracks[3], 3);
  assert.equal(trackCount, 5);
  const gap = packOf([
    { id: "x", start: 0, end: 100 },
    { id: "y", start: 0, end: 4 },
    { id: "z", start: 0, end: 4 },
    { id: "w", start: 0, end: 100 },
    { id: "blk", start: 5, end: 50, rows: 2 }
  ]);
  assert.deepEqual(gap.tracks, [1, 2, 3, 0, 2], "the block reuses the freed middle rows");
  assert.equal(gap.trackCount, 4);
});
test("packVisibleTracks: a multi-row item counts every row it holds", () => {
  const items = [{ id: "fam", start: 0, end: 100, rows: 4 }];
  assert.equal(packVisibleTracks(items, { start: 10, end: 20 }).trackCount, 4);
  assert.equal(packVisibleTracks(items, { start: 500, end: 600 }).trackCount, 1);
});
test("TrackAllocator: multi-row items pack, stick and count like single rows", () => {
  const fam = { id: "fam", start: 0, end: 100, rows: 3 };
  const a = { id: "a", start: 10, end: 60 };
  const b = { id: "b", start: 200, end: 260 };
  const alloc = new TrackAllocator();
  const first = alloc.assign([fam, a, b], { start: 0, end: 300 });
  assert.deepEqual(first.tracks, [0, 3, 0], "the block holds rows 0..2; a sits under it; b reuses row 0 after it");
  assert.equal(first.trackCount, 4);
  const c = { id: "c", start: 20, end: 30 };
  const second = alloc.assign([fam, a, b, c], { start: 0, end: 300 });
  assert.deepEqual(second.tracks, [0, 3, 0, 4], "rows under the block are blocked, not free");
  const later = alloc.assign([fam, a, b, c], { start: 150, end: 300 });
  assert.deepEqual(later.tracks, [-1, -1, 0, -1]);
  assert.equal(later.trackCount, 1);
});
test("resolveParents: same-lane parents nest; missing, cross-lane and self parents leave a root", () => {
  const parent = resolveParents([
    { id: "run", laneId: "ci" },
    { id: "build", laneId: "ci", parentId: "run" },
    { id: "orphan", laneId: "ci", parentId: "nope" },
    { id: "elsewhere", laneId: "deploy", parentId: "run" },
    { id: "me", laneId: "ci", parentId: "me" },
    { id: "unit", laneId: "ci", parentId: "build" }
  ]);
  assert.deepEqual(parent, [-1, 0, -1, -1, -1, 1]);
});
test("resolveParents: a cycle is cut so the result is a forest", () => {
  const parent = resolveParents([
    { id: "a", parentId: "c" },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: "c" }
  ]);
  assert.equal(parent[0], -1, "the lowest-index member of the cycle becomes the root");
  assert.deepEqual(parent.slice(1), [0, 1, 2]);
  for (let i = 0; i < parent.length; i++) {
    let j = i;
    let steps = 0;
    while (parent[j] >= 0) {
      j = parent[j];
      steps++;
      assert.ok(steps <= parent.length, "acyclic");
    }
  }
});
test("packFamily: the root sits on row 0, children first-fit under it, the block is 1 + child rows tall", () => {
  const fam = packFamily({
    id: "run",
    start: 0,
    end: 100,
    children: [
      { id: "build", start: 5, end: 40 },
      { id: "test-a", start: 40, end: 80 },
      { id: "test-b", start: 42, end: 70 },
      // overlaps test-a → second child row
      { id: "promote", start: 85, end: 95 }
    ]
  });
  assert.equal(fam.rows, 3);
  assert.equal(fam.start, 0);
  assert.equal(fam.end, 100);
  assert.equal(fam.tops.get("run"), 0);
  assert.equal(fam.tops.get("build"), 1);
  assert.equal(fam.tops.get("test-a"), 1);
  assert.equal(fam.tops.get("test-b"), 2);
  assert.equal(fam.tops.get("promote"), 1);
});
test("packFamily: a child with no siblings overlapping packs on the row right under its parent", () => {
  const fam = packFamily({ id: "p", start: 0, end: 10, children: [{ id: "c", start: 2, end: 8 }] });
  assert.equal(fam.rows, 2);
  assert.deepEqual([...fam.tops], [["p", 0], ["c", 1]]);
});
test("packFamily: nested families stack \u2014 a grandchild sits under its parent, offset by where that parent packed", () => {
  const fam = packFamily({
    id: "run",
    start: 0,
    end: 100,
    children: [
      { id: "build", start: 0, end: 50 },
      {
        id: "test",
        start: 10,
        end: 90,
        children: [
          { id: "unit", start: 12, end: 40 },
          { id: "e2e", start: 15, end: 85 }
        ]
      }
    ]
  });
  assert.equal(fam.tops.get("build"), 1);
  assert.equal(fam.tops.get("test"), 2);
  assert.equal(fam.tops.get("unit"), 3);
  assert.equal(fam.tops.get("e2e"), 4);
  assert.equal(fam.rows, 5);
});
test("packFamily: the extent is the union, and any ongoing member makes the block ongoing", () => {
  const over = packFamily({ id: "p", start: 10, end: 20, children: [{ id: "c", start: 5, end: 30 }] });
  assert.equal(over.start, 5);
  assert.equal(over.end, 30);
  const live = packFamily({ id: "p", start: 10, end: 20, children: [{ id: "c", start: 12, end: null }] });
  assert.equal(live.end, null);
  const liveRoot = packFamily({ id: "p", start: 10, end: null, children: [{ id: "c", start: 12, end: 15 }] });
  assert.equal(liveRoot.end, null);
});
test("packFamily: instant children (end == start) still get a row each when coincident", () => {
  const fam = packFamily({
    id: "p",
    start: 0,
    end: 10,
    children: [
      { id: "i1", start: 5, end: 5 },
      { id: "i2", start: 5, end: 5 }
    ]
  });
  assert.equal(fam.rows, 3);
  assert.notEqual(fam.tops.get("i1"), fam.tops.get("i2"));
});
test("packFamily + packTracks: a family block keeps unrelated bars out of its rows", () => {
  const fam = packFamily({ id: "run", start: 0, end: 100, children: [{ id: "c", start: 10, end: 90 }] });
  const lane = packTracks([
    { id: "run", start: fam.start, end: fam.end, rows: fam.rows },
    { id: "other", start: 50, end: 60 }
  ]);
  assert.deepEqual(lane.tracks, [0, 2], "the unrelated bar lands under the whole block, never inside it");
  assert.equal(lane.trackCount, 3);
});
var ti = (id, start, end) => ({ id, start, end });
test("TrackAllocator: a fresh allocator reproduces the stateless first-fit packer exactly", () => {
  const items = [ti("a", 0, 10), ti("b", 5, 15), ti("c", 12, 20), ti("d", 14, 25), ti("e", 40, 50)];
  for (const view of [
    { start: 0, end: 30 },
    { start: 13, end: 45 },
    { start: 100, end: 200 }
  ]) {
    assert.deepEqual(new TrackAllocator().assign(items, view), packVisibleTracks(items, view));
  }
});
test("TrackAllocator: visible items keep their rows when membership churn would reflow the stateless packer", () => {
  const items = [ti("a", 0, 10), ti("b", 2, 12), ti("c", 11, 20)];
  const alloc = new TrackAllocator();
  const v1 = alloc.assign(items, { start: 0, end: 15 });
  assert.deepEqual(v1, { tracks: [0, 1, 0], trackCount: 2 }, "first fill is plain first-fit");
  const v2view = { start: 10.5, end: 25 };
  const stateless = packVisibleTracks(items, v2view);
  assert.deepEqual(stateless.tracks, [-1, 0, 1], "the stateless packer reshuffles");
  const v2 = alloc.assign(items, v2view);
  assert.deepEqual(v2.tracks, [-1, 1, 0], "sticky rows: b stays on 1, c stays on 0");
});
test("TrackAllocator: burst-then-shrink \u2014 height recovers without moving surviving rows", () => {
  const items = [
    ti("b1", 0, 10),
    ti("b2", 0, 10),
    ti("b3", 0, 10),
    ti("b4", 0, 10),
    ti("b5", 0, 10),
    ti("n1", 30, 40),
    ti("n2", 35, 45)
  ];
  const alloc = new TrackAllocator();
  const wide = alloc.assign(items, { start: 0, end: 50 });
  assert.deepEqual(wide.tracks, [0, 1, 2, 3, 4, 0, 1], "newcomers fill the freed low tracks");
  assert.equal(wide.trackCount, 5);
  const after = alloc.assign(items, { start: 25, end: 60 });
  assert.deepEqual(after.tracks, [-1, -1, -1, -1, -1, 0, 1]);
  assert.equal(after.trackCount, 2, "height recovered from 5 tracks to 2");
});
test("TrackAllocator: a returning interval gets its old row back when still free", () => {
  const items = [ti("a", 0, 10), ti("b", 0, 10), ti("c", 0, 10)];
  const alloc = new TrackAllocator();
  assert.deepEqual(alloc.assign(items, { start: 0, end: 20 }).tracks, [0, 1, 2]);
  assert.deepEqual(alloc.assign(items, { start: 50, end: 60 }).tracks, [-1, -1, -1]);
  assert.equal(alloc.assign(items, { start: 50, end: 60 }).trackCount, 1);
  assert.deepEqual(alloc.assign(items, { start: 0, end: 20 }).tracks, [0, 1, 2]);
});
test("TrackAllocator: a returning interval whose old row is now taken falls to the lowest free one", () => {
  const alloc = new TrackAllocator();
  const a = ti("a", 0, 10);
  const b = ti("b", 0, 60);
  assert.deepEqual(alloc.assign([a], { start: 0, end: 20 }).tracks, [0]);
  assert.deepEqual(alloc.assign([a, b], { start: 50, end: 60 }).tracks, [-1, 0]);
  assert.deepEqual(alloc.assign([a, b], { start: 0, end: 60 }).tracks, [1, 0]);
});
test("TrackAllocator: a live arrival at now never displaces existing rows (SSE case)", () => {
  const alloc = new TrackAllocator();
  const a = ti("run-a", 0, null);
  const b = ti("run-b", 20, null);
  const view = { start: 0, end: 100 };
  assert.deepEqual(alloc.assign([a, b], view).tracks, [0, 1]);
  const c = ti("run-c", 60, null);
  const r = alloc.assign([a, b, c], view);
  assert.deepEqual(r.tracks, [0, 1, 2]);
  assert.equal(r.trackCount, 3);
});
test("TrackAllocator: visible same-track items never overlap in time (invariant across sliding views)", () => {
  const items = [];
  for (let i = 0; i < 30; i++) {
    const start = i * 37 % 100;
    items.push(ti(`i${String(i).padStart(2, "0")}`, start, start + 5 + i * 13 % 20));
  }
  const foot = (it) => ({ s: it.start, e: Math.max(it.end ?? Infinity, it.start + 1) });
  const alloc = new TrackAllocator();
  for (let t = 0; t <= 80; t += 3.7) {
    const view = { start: t, end: t + 40 };
    const { tracks } = alloc.assign(items, view);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (tracks[i] < 0 || tracks[i] !== tracks[j]) continue;
        const a = foot(items[i]);
        const b = foot(items[j]);
        assert.ok(a.e <= b.s || b.e <= a.s, `view +${t}: ${items[i].id} and ${items[j].id} share track ${tracks[i]} but overlap`);
      }
    }
  }
});
test("TrackAllocator: row memory is LRU-bounded \u2014 an evicted id re-packs as new", () => {
  const items = [ti("p", 0, 10), ti("q", 0, 10), ti("r", 0, 10)];
  const remembered = new TrackAllocator(1);
  remembered.assign(items, { start: 0, end: 20 });
  assert.deepEqual(remembered.assign([ti("r", 0, 10)], { start: 0, end: 20 }).tracks, [2], "r is remembered");
  const evicted = new TrackAllocator(1);
  evicted.assign(items, { start: 0, end: 20 });
  assert.deepEqual(evicted.assign([ti("q", 0, 10)], { start: 0, end: 20 }).tracks, [0], "q was evicted \u2192 packs as new");
});
test("TrackAllocator: cluster-shaped synthetic ids hold their row across frames (one slot per cluster)", () => {
  const bar = ti("a-bar", 90, 200);
  const cluster = ti("cluster:run-a", 150, 150);
  const alloc = new TrackAllocator();
  const v1 = alloc.assign([bar, cluster], { start: 80, end: 220 });
  assert.deepEqual(v1.tracks, [0, 1], "the cluster occupies exactly one slot");
  for (let dt = 5; dt <= 60; dt += 5) {
    const r = alloc.assign([bar, cluster], { start: 80 + dt, end: 220 + dt });
    assert.deepEqual(r.tracks, v1.tracks, `slide +${dt}: neither row hops`);
  }
});
test("TrackAllocator: deterministic \u2014 identical call sequences yield identical assignments", () => {
  const items = [ti("a", 0, 30), ti("b", 10, 40), ti("c", 35, 60), ti("d", 50, null)];
  const views = [
    { start: 0, end: 45 },
    { start: 32, end: 70 },
    { start: 100, end: 140 },
    { start: 0, end: 45 }
  ];
  const one = new TrackAllocator();
  const two = new TrackAllocator();
  for (const view of views) {
    assert.deepEqual(one.assign(items, view), two.assign(items, view));
  }
});
test("TrackAllocator: empty input and empty windows collapse to one track", () => {
  const alloc = new TrackAllocator();
  assert.deepEqual(alloc.assign([], { start: 0, end: 10 }), { tracks: [], trackCount: 1 });
  const r = alloc.assign([ti("a", 100, 110)], { start: 0, end: 10 });
  assert.deepEqual(r, { tracks: [-1], trackCount: 1 });
});
var pip = (id, at) => ({ id, start: at, end: at });
test("clusterInstants: empty and single-instant inputs yield no clusters", () => {
  const view = { start: 0, end: 6e5 };
  assert.deepEqual(clusterInstants([], view, 1e3), { clusters: [], memberOf: [] });
  const one = clusterInstants([pip("a", 1e3)], view, 1e3);
  assert.equal(one.clusters.length, 0, "a lone pip is not a cluster");
  assert.deepEqual(one.memberOf, [-1]);
});
test("clusterInstants: coincident instants merge into ONE cluster (the lane-height bomb becomes one slot)", () => {
  const items = Array.from({ length: 50 }, (_, i) => pip(`s${String(i).padStart(2, "0")}`, 5e3));
  const r = clusterInstants(items, { start: 0, end: 6e5 }, 1e3);
  assert.equal(r.clusters.length, 1);
  assert.equal(r.clusters[0].indices.length, 50);
  assert.deepEqual(r.clusters[0].extent, { start: 5e3, end: 5e3 }, "coincident members: a point extent");
  assert.deepEqual(r.clusters[0].marks, [{ time: 5e3, from: 0, to: 50 }], "one mark: the stack glyph case");
  assert.ok(r.memberOf.every((m) => m === 0));
});
test("clusterInstants: threshold boundary \u2014 a gap just under the pitch merges, at it they stay apart", () => {
  const view = { start: 0, end: 1e5 };
  const pitchMs = CLUSTER_PITCH_PX * 100;
  const under = clusterInstants([pip("a", 1e4), pip("b", 1e4 + pitchMs - 1)], view, 1e3);
  assert.equal(under.clusters.length, 1, "a pixel short of clearing: the pips collide, so they cluster");
  const at = clusterInstants([pip("a", 1e4), pip("b", 1e4 + pitchMs)], view, 1e3);
  assert.equal(at.clusters.length, 0, "exactly at the pitch they both draw");
  assert.deepEqual(at.memberOf, [-1, -1]);
});
test("clusterInstants: a chain runs to the real gap, and every member that clears the pitch keeps its pip", () => {
  const view = { start: 0, end: 1e5 };
  const items = [pip("a", 1e4), pip("b", 10400), pip("c", 10800), pip("d", 11200)];
  const r = clusterInstants(items, view, 1e3);
  assert.equal(r.clusters.length, 1);
  assert.deepEqual(r.clusters[0].indices, [0, 1, 2, 3]);
  assert.deepEqual(r.clusters[0].extent, { start: 1e4, end: 11200 });
  assert.deepEqual(
    r.clusters[0].marks,
    [
      { time: 1e4, from: 0, to: 2 },
      { time: 10800, from: 2, to: 4 }
    ],
    "b and d sit inside the pitch \u2014 dropped, and counted by the pip before them"
  );
  const compact = clusterInstants(items, view, 1e3, 3);
  assert.equal(compact.clusters.length, 0);
  assert.deepEqual(compact.memberOf, [-1, -1, -1, -1]);
});
test("clusterInstants: ZOOMING OUT HALVES THE MARKS \u2014 it never fuses them into one shape", () => {
  const items = Array.from({ length: 4e3 }, (_, i) => pip(`s${String(i).padStart(4, "0")}`, i * 1e3));
  const plotWidth = 1e3;
  let prev = Infinity;
  for (const span of [1e6, 2e6, 4e6, 8e6]) {
    const view = { start: 0, end: span };
    const r = clusterInstants(items, view, plotWidth);
    const msPerPx = span / plotWidth;
    const marks = r.clusters.reduce((n, c) => n + c.marks.length, 0);
    for (const c of r.clusters) {
      for (let k = 1; k < c.marks.length; k++) {
        assert.ok(
          (c.marks[k].time - c.marks[k - 1].time) / msPerPx >= CLUSTER_PITCH_PX - 1e-9,
          `span ${span}: marks ${k - 1}/${k} closer than the pitch`
        );
      }
      let next = 0;
      for (const mk of c.marks) {
        assert.equal(mk.from, next);
        assert.ok(mk.to > mk.from);
        next = mk.to;
      }
      assert.equal(next, c.indices.length);
    }
    if (prev !== Infinity) {
      assert.ok(marks < prev * 0.6, `span ${span}: ${marks} marks vs ${prev} at half the span`);
      assert.ok(marks > prev * 0.4, `span ${span}: ${marks} marks vs ${prev} \u2014 dropped far more than half`);
    }
    prev = marks;
  }
});
test("clusterInstants: a run of marks fills its extent \u2014 no fixed-pitch comb, no single blob", () => {
  const view = { start: -6e5, end: 15e6 };
  const plotWidth = 1300;
  const msPerPx = (view.end - view.start) / plotWidth;
  const r = clusterInstants(
    Array.from({ length: 240 }, (_, i) => pip(`m${String(i).padStart(3, "0")}`, i * 6e4)),
    view,
    plotWidth
  );
  const marks = r.clusters.flatMap((c) => c.marks);
  const dataPx = 240 * 6e4 / msPerPx;
  assert.ok(marks.length <= dataPx / CLUSTER_PITCH_PX + 1, `${marks.length} marks is more than ${dataPx.toFixed(0)}px can separate`);
  const spanPx = (marks[marks.length - 1].time - marks[0].time) / msPerPx;
  assert.ok(spanPx > dataPx * 0.95, `marks cover ${spanPx.toFixed(0)}px of the run's ${dataPx.toFixed(0)}px`);
  const sparse = clusterInstants(
    Array.from({ length: 48 }, (_, i) => pip(`f${String(i).padStart(3, "0")}`, i * 3e5)),
    view,
    plotWidth
  );
  const sparseMarks = sparse.clusters.flatMap((c) => c.marks).length + sparse.memberOf.filter((m) => m < 0).length;
  assert.ok(marks.length > sparseMarks * 2, `${marks.length} marks for 240 events vs ${sparseMarks} for 48`);
});
test("clusterInstants: bars and ongoing intervals never cluster", () => {
  const view = { start: 0, end: 1e5 };
  const items = [
    pip("a", 1e4),
    pip("b", 10100),
    { id: "bar", start: 1e4, end: 1e4 + 300 },
    // exactly the pip threshold → a bar
    { id: "live", start: 10050, end: null }
    // ongoing — will grow into a bar
  ];
  const r = clusterInstants(items, view, 1e3);
  assert.equal(r.clusters.length, 1);
  assert.deepEqual(r.clusters[0].indices, [0, 1], "only the two pips merged");
  assert.equal(r.memberOf[2], -1);
  assert.equal(r.memberOf[3], -1);
});
test("clusterInstants: deterministic under input re-ordering (memberOf aligned to input positions)", () => {
  const view = { start: 0, end: 1e5 };
  const sorted = [pip("a", 1e4), pip("b", 10500), pip("x", 5e4), pip("y", 50200)];
  const shuffled = [sorted[3], sorted[1], sorted[0], sorted[2]];
  const a = clusterInstants(sorted, view, 1e3);
  const b = clusterInstants(shuffled, view, 1e3);
  assert.equal(a.clusters.length, 2);
  assert.equal(b.clusters.length, 2);
  const memberIds = (items, c) => c.indices.map((i) => items[i].id);
  assert.deepEqual(memberIds(sorted, a.clusters[0]), ["a", "b"]);
  assert.deepEqual(memberIds(shuffled, b.clusters[0]), ["a", "b"], "same members, in (start, id) order");
  assert.deepEqual(a.clusters.map((c) => c.extent), b.clusters.map((c) => c.extent));
  assert.equal(b.memberOf[2], 0, "memberOf refers to INPUT positions");
  assert.equal(b.memberOf[0], 1);
});
test("clusterInstants: pure pans never change membership or extents (translation-invariant)", () => {
  const items = [pip("a", 1e4), pip("b", 10800), pip("c", 4e4)];
  const span = 1e5;
  const first = clusterInstants(items, { start: 0, end: span }, 1e3);
  for (let dt = 0; dt <= 3e4; dt += 1234.5) {
    const r = clusterInstants(items, { start: dt, end: dt + span }, 1e3);
    assert.deepEqual(r, first, `pan +${dt} keeps identical clusters`);
  }
});
test("clusterInstants: zooming in progressively splits clusters until each pip stands alone", () => {
  const items = [pip("a", 1e4), pip("b", 10200), pip("c", 11800)];
  const wide = clusterInstants(items, { start: 0, end: 6e5 }, 1e3);
  assert.equal(wide.clusters.length, 1, "wide: everything is one chain");
  assert.equal(wide.clusters[0].indices.length, 3);
  const mid = clusterInstants(items, { start: 0, end: 6e4 }, 1e3);
  assert.equal(mid.clusters.length, 1, "mid: only the close pair still collides");
  assert.deepEqual(mid.clusters[0].indices, [0, 1]);
  assert.equal(mid.memberOf[2], -1);
  const close = clusterInstants(items, { start: 0, end: 1e4 }, 1e3);
  assert.equal(close.clusters.length, 0, "zoomed in: every pip stands at its true timestamp");
});
test("clusterZoomView: pads the member extent and floors at the minimum span; clicking it splits the cluster", () => {
  const extent = { start: 1e4, end: 10400 };
  const v = clusterZoomView(extent);
  assert.equal(v.end - v.start, MIN_SPAN_MS, "a sub-minimum extent floors at MIN_SPAN_MS");
  assert.equal((v.start + v.end) / 2, (extent.start + extent.end) / 2, "centered on the extent");
  const items = [pip("a", 1e4), pip("b", 10400)];
  assert.equal(clusterInstants(items, clusterZoomView(extent), 1e3).clusters.length, 0);
  const big = { start: 0, end: 6e4 };
  const bv = clusterZoomView(big);
  assert.ok(Math.abs((bv.end - bv.start) * CLUSTER_ZOOM_FILL_FRAC - 6e4) < 1e-6);
  const point = clusterZoomView({ start: 5e3, end: 5e3 });
  assert.equal(point.end - point.start, MIN_SPAN_MS);
  assert.equal((point.start + point.end) / 2, 5e3);
});
test("clusterMarkerTime: midpoint while fully visible; slides at a clipped edge; null once nothing is visible", () => {
  const view = { start: 0, end: 1e3 };
  assert.equal(clusterMarkerTime({ start: 100, end: 200 }, view, 10), 150);
  assert.equal(clusterMarkerTime({ start: -500, end: 200 }, view, 10), 10);
  assert.equal(clusterMarkerTime({ start: 800, end: 1500 }, view, 10), 990);
  assert.equal(clusterMarkerTime({ start: -500, end: -100 }, view, 10), null);
  assert.equal(clusterMarkerTime({ start: 1100, end: 1200 }, view, 10), null);
  assert.equal(clusterMarkerTime({ start: 50, end: 50 }, view, 100), 50);
  let prev = null;
  for (let s = -400; s <= 200; s += 10) {
    const t = clusterMarkerTime({ start: 100, end: 200 }, { start: s, end: s + 1e3 }, 10);
    assert.ok(t !== null, `visible at pan ${s}`);
    if (prev !== null) assert.ok(Math.abs(t - prev) <= 10 + 1e-9, `pan step moves the marker \u2264 the pan step`);
    prev = t;
  }
});
test("minimapExtent: spans the earliest known start through max(now, latest end); null with no data", () => {
  assert.equal(minimapExtent(null, null, 1e6), null);
  assert.deepEqual(minimapExtent(5e5, 8e5, 1e6), { start: 5e5, end: 1e6 });
  assert.deepEqual(minimapExtent(5e5, 12e5, 1e6), { start: 5e5, end: 12e5 });
  assert.deepEqual(minimapExtent(5e5, null, 1e6, null, 3e5), { start: 3e5, end: 1e6 });
  assert.deepEqual(minimapExtent(5e5, null, 1e6, 1e5, 3e5), { start: 1e5, end: 1e6 });
  assert.deepEqual(minimapExtent(null, null, 1e6, null, 7e5), { start: 7e5, end: 1e6 });
});
test("minimapExtent: a degenerate/tiny span is padded backward to the minimum", () => {
  assert.deepEqual(minimapExtent(1e6, null, 1e6, null, null, 6e4), { start: 94e4, end: 1e6 });
  assert.deepEqual(minimapExtent(999e3, null, 1e6, null, null, 6e4), { start: 94e4, end: 1e6 });
  assert.deepEqual(minimapExtent(94e4, null, 1e6, null, null, 6e4), { start: 94e4, end: 1e6 });
});
test("minimapWindowRect: maps the view into strip px and crops at the strip edges", () => {
  const extent = { start: 0, end: 1e4 };
  assert.deepEqual(minimapWindowRect({ start: 2e3, end: 6e3 }, extent, 1e3), { x0: 200, x1: 600 });
  assert.deepEqual(minimapWindowRect({ start: -2e3, end: 4e3 }, extent, 1e3), { x0: 0, x1: 400 });
  assert.deepEqual(minimapWindowRect({ start: 8e3, end: 12e3 }, extent, 1e3), { x0: 800, x1: 1e3 });
  assert.deepEqual(minimapWindowRect({ start: 0, end: 1 }, { start: 5, end: 5 }, 1e3), { x0: 0, x1: 1e3 });
  assert.deepEqual(minimapWindowRect({ start: 0, end: 1 }, extent, 0), { x0: 0, x1: 0 });
});
test("minimapWindowRect: a tiny window keeps a minimum visual width; fully outside pins a sliver at the nearer edge", () => {
  const extent = { start: 0, end: 1e6 };
  const r = minimapWindowRect({ start: 5e5, end: 500100 }, extent, 1e3);
  assert.ok(Math.abs(r.x1 - r.x0 - MINIMAP_MIN_WINDOW_PX) < 1e-9, "expanded to the minimum");
  assert.ok(Math.abs((r.x0 + r.x1) / 2 - 500.05) < 1e-6, "centered where the window is");
  assert.deepEqual(minimapWindowRect({ start: -9e5, end: -8e5 }, extent, 1e3), { x0: 0, x1: MINIMAP_MIN_WINDOW_PX });
  assert.deepEqual(minimapWindowRect({ start: 2e6, end: 21e5 }, extent, 1e3), {
    x0: 1e3 - MINIMAP_MIN_WINDOW_PX,
    x1: 1e3
  });
});
test("minimapHitZone: handles win over the middle, zones reach outside the rect, boundaries exact", () => {
  const rect = { x0: 200, x1: 400 };
  const hit = MINIMAP_HANDLE_HIT_PX;
  assert.equal(minimapHitZone(200 - hit, rect), "left-handle");
  assert.equal(minimapHitZone(200 - hit - 0.01, rect), "before");
  assert.equal(minimapHitZone(400 + hit, rect), "right-handle");
  assert.equal(minimapHitZone(400 + hit + 0.01, rect), "after");
  assert.equal(minimapHitZone(200 + hit, rect), "left-handle");
  assert.equal(minimapHitZone(400 - hit, rect), "right-handle");
  assert.equal(minimapHitZone(200 + hit + 0.01, rect), "inside");
  assert.equal(minimapHitZone(300, rect), "inside");
});
test("minimapHitZone: a narrow window keeps a grabbable middle (inside reach shrinks with the window)", () => {
  const rect = { x0: 100, x1: 112 };
  assert.equal(minimapHitZone(106, rect), "inside");
  assert.equal(minimapHitZone(102, rect), "left-handle");
  assert.equal(minimapHitZone(110, rect), "right-handle");
  const tiny = { x0: 100, x1: 104 };
  assert.equal(minimapHitZone(101, tiny), "left-handle");
  assert.equal(minimapHitZone(103, tiny), "right-handle");
  assert.equal(minimapHitZone(102, tiny), "inside");
  assert.equal(minimapHitZone(100, { x0: 100, x1: 100 }), "left-handle");
});
test("minimapPan: pixel deltas pan at the extent scale; clamps at both extent edges", () => {
  const extent = { start: 0, end: 1e4 };
  const view = { start: 2e3, end: 4e3 };
  assert.deepEqual(minimapPan(view, 100, extent, 1e3), { start: 3e3, end: 5e3 });
  assert.deepEqual(minimapPan(view, -100, extent, 1e3), { start: 1e3, end: 3e3 });
  assert.deepEqual(minimapPan(view, -500, extent, 1e3), { start: 0, end: 2e3 });
  assert.deepEqual(minimapPan(view, 900, extent, 1e3), { start: 8e3, end: 1e4 });
  assert.deepEqual(minimapPan({ start: -2e4, end: 0 }, 50, extent, 1e3), { start: -1e4, end: 1e4 });
  assert.deepEqual(minimapPan(view, 100, { start: 5, end: 5 }, 1e3), view);
  assert.deepEqual(minimapPan(view, 100, extent, 0), view);
});
test("minimapResize: each handle drags its edge, clamped to the extent and the span limits", () => {
  const extent = { start: 0, end: 1e5 };
  const view = { start: 4e4, end: 6e4 };
  assert.deepEqual(minimapResize(view, "left", 200, extent, 1e3), { start: 2e4, end: 6e4 });
  assert.deepEqual(minimapResize(view, "right", 800, extent, 1e3), { start: 4e4, end: 8e4 });
  assert.deepEqual(minimapResize(view, "left", -50, extent, 1e3), { start: 0, end: 6e4 });
  assert.deepEqual(minimapResize(view, "right", 1500, extent, 1e3), { start: 4e4, end: 1e5 });
  const wide = { start: 0, end: 30 * 864e5 };
  const atEnd = { start: wide.end - 1e6, end: wide.end };
  assert.deepEqual(minimapResize(atEnd, "left", 0, wide, 1e3), { start: wide.end - MAX_SPAN_MS, end: wide.end });
  assert.deepEqual(minimapResize(view, "left", 200, { start: 5, end: 5 }, 1e3), view);
});
test("minimapResize: dragging a handle past (or into) the other CLAMPS at the min span \u2014 never flips", () => {
  const extent = { start: 0, end: 1e5 };
  const view = { start: 4e4, end: 6e4 };
  assert.deepEqual(minimapResize(view, "left", 900, extent, 1e3), { start: 6e4 - MIN_SPAN_MS, end: 6e4 });
  assert.deepEqual(minimapResize(view, "right", 100, extent, 1e3), { start: 4e4, end: 4e4 + MIN_SPAN_MS });
  const nearStart = { start: 0, end: 1e3 };
  const r = minimapResize(nearStart, "right", 0, extent, 1e3);
  assert.deepEqual(r, { start: 0, end: MIN_SPAN_MS });
});
test("minimapCenter: centers the window at the clicked time at constant span; extent-clamped", () => {
  const extent = { start: 0, end: 1e4 };
  const view = { start: 1e3, end: 3e3 };
  assert.deepEqual(minimapCenter(view, 700, extent, 1e3), { start: 6e3, end: 8e3 });
  assert.deepEqual(minimapCenter(view, 0, extent, 1e3), { start: 0, end: 2e3 });
  assert.deepEqual(minimapCenter(view, 1e3, extent, 1e3), { start: 8e3, end: 1e4 });
  assert.deepEqual(minimapCenter(view, 500, extent, 0), view);
});
test("historyProbe: never reaches past the covered end \u2014 the live edge belongs to the data feed", () => {
  const now0 = 1e9;
  const span = 9e5;
  const coveredEnd = now0;
  for (let frame = 1; frame <= 100; frame++) {
    const now = now0 + frame * 16;
    const end = now + span * FOLLOW_LEAD_FRAC;
    const probe = historyProbe({ start: end - span, end }, now, coveredEnd);
    assert.ok(probe, "the backward window is still probeable");
    assert.ok(probe.end <= coveredEnd, `frame ${frame}: probe must not chase "now" past coverage`);
  }
});
test("historyProbe + CoverageTracker: an idle covered viewport never re-fires (no request storm)", () => {
  const tracker = new CoverageTracker();
  const span = 9e5;
  const now0 = 1e9;
  tracker.addCovered(now0 - 2 * span, now0);
  let requests = 0;
  for (let frame = 0; frame < 1e3; frame++) {
    const now = now0 + frame * 16;
    const end = now + span * FOLLOW_LEAD_FRAC;
    const probe = historyProbe({ start: end - span, end }, now, tracker.coveredEnd());
    if (!probe) continue;
    const req = tracker.nextRequest(probe, now);
    if (req) {
      requests++;
      tracker.settle(req, { ok: true });
    }
  }
  assert.equal(requests, 0, "fully covered viewport issues zero loadRange requests while now advances");
});
test("historyProbe: bootstrap (no coverage) probes up to now, then latches after one settle", () => {
  const tracker = new CoverageTracker();
  const span = 9e5;
  let now = 1e9;
  const probe0 = historyProbe({ start: now - span, end: now }, now, tracker.coveredEnd());
  assert.ok(probe0 && probe0.end === now, "first load may reach now");
  const req = tracker.nextRequest(probe0, now);
  assert.ok(req);
  tracker.settle(req, { ok: true });
  let refires = 0;
  for (let frame = 0; frame < 500; frame++) {
    now += 16;
    const probe = historyProbe({ start: now - span, end: now }, now, tracker.coveredEnd());
    if (!probe) continue;
    const r = tracker.nextRequest(probe, now);
    if (r) {
      refires++;
      tracker.settle(r, { ok: true });
    }
  }
  assert.equal(refires, 0, "the forward sliver between coverage and now is never requested");
});
test("historyProbe: backward gaps are still requested (panning into uncovered history works)", () => {
  const tracker = new CoverageTracker();
  const now = 1e9;
  tracker.addCovered(now - 1e6, now);
  const view = { start: now - 5e6, end: now - 4e6 };
  const probe = historyProbe(view, now, tracker.coveredEnd());
  assert.ok(probe);
  const req = tracker.nextRequest(probe, now);
  assert.ok(req, "backward history is requestable");
  assert.ok(req.end <= now - 4e6 + 1e-6);
});
test("coverage: the fixed cadence still storm-proofs a 60Hz frame loop after a failure", () => {
  const c = new CoverageTracker();
  const view = { start: 0, end: 1e5 };
  const req = c.nextRequest(view, 0);
  assert.ok(req);
  c.settle(req, { ok: false }, 1e3);
  let issued = 0;
  for (let now = 1016; now < 3e3; now += 16) {
    if (c.nextRequest(view, now)) issued++;
  }
  assert.equal(issued, 0, "no request storm within the retry window");
  assert.ok(c.nextRequest(view, 3001), "the retry fires once the cadence elapses");
});
test("frameBudgetMs: interactive renders every frame; idle ~30fps; battery ~10fps", () => {
  assert.equal(frameBudgetMs("interactive"), 0);
  assert.equal(frameBudgetMs("idle"), IDLE_FRAME_MS);
  assert.equal(frameBudgetMs("idle-battery"), IDLE_BATTERY_FRAME_MS);
  assert.ok(IDLE_FRAME_MS > 16.7 && IDLE_FRAME_MS < 34);
  assert.equal(IDLE_BATTERY_FRAME_MS, 100);
});
test("shouldRender: gates a 60Hz rAF stream to the tier budget without aliasing", () => {
  const countAt = (budget) => {
    let rendered = 0;
    let last = -Infinity;
    for (let i = 0; i < 600; i++) {
      const t = i * (1e3 / 60);
      if (shouldRender(t, last, budget)) {
        rendered++;
        last = t;
      }
    }
    return rendered;
  };
  assert.equal(countAt(0), 600, "interactive: every frame");
  const idle = countAt(IDLE_FRAME_MS);
  assert.ok(idle >= 280 && idle <= 320, `idle \u2248 30fps over 10s, got ${idle / 10}/s`);
  const battery = countAt(IDLE_BATTERY_FRAME_MS);
  assert.ok(battery >= 95 && battery <= 105, `battery \u2248 10fps over 10s, got ${battery / 10}/s`);
});
test("clockDrawBudgetMs: normal zooms render at the plain tier budget", () => {
  const view = { start: 0, end: 1e4 };
  assert.equal(clockDrawBudgetMs(view, 900, 1, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs(view, 900, 2, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs(view, 900, 2, IDLE_BATTERY_FRAME_MS), IDLE_BATTERY_FRAME_MS);
});
test("clockDrawBudgetMs: zoomed OUT widens to the exact per-device-pixel period \u2014 no upper cap", () => {
  const view = { start: 0, end: 9e5 };
  assert.equal(clockDrawBudgetMs(view, 900, 1, IDLE_FRAME_MS), 1e3);
  assert.equal(clockDrawBudgetMs(view, 900, 2, IDLE_FRAME_MS), 500);
  assert.equal(clockDrawBudgetMs({ start: 0, end: 7 * 864e5 }, 900, 1, IDLE_FRAME_MS), 7 * 864e5 / 900);
});
test("clockDrawBudgetMs: the tier budget is a hard floor \u2014 never renders faster than the tier", () => {
  for (const span of [1e3, 6e4, 9e5, 36e5, 7 * 864e5]) {
    for (const plotW of [200, 900, 2500]) {
      for (const dpr of [1, 1.5, 2, 3]) {
        for (const budget of [IDLE_FRAME_MS, IDLE_BATTERY_FRAME_MS]) {
          const d = clockDrawBudgetMs({ start: 0, end: span }, plotW, dpr, budget);
          const period = span / (plotW * dpr);
          assert.ok(d >= budget, `span ${span} w ${plotW} dpr ${dpr} budget ${budget}: ${d} < ${budget}`);
          assert.equal(d, Math.max(budget, period));
        }
      }
    }
  }
});
test("clockDrawBudgetMs: monotone in span \u2014 zooming out never speeds up the cadence", () => {
  let prev = 0;
  for (const span of [1e3, 1e4, 6e4, 9e5, 36e5, 864e5]) {
    const d = clockDrawBudgetMs({ start: 0, end: span }, 900, 1, IDLE_FRAME_MS);
    assert.ok(d >= prev, `span ${span}: ${d} < ${prev}`);
    prev = d;
  }
});
test("clockDrawBudgetMs: interactive tier (budget 0) yields the bare px period; degenerate geometry falls back to the tier", () => {
  const view = { start: 0, end: 9e5 };
  assert.equal(clockDrawBudgetMs(view, 900, 1, 0), 1e3);
  assert.equal(clockDrawBudgetMs({ start: 5, end: 5 }, 900, 1, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs({ start: 10, end: 0 }, 900, 1, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs(view, 0, 1, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs(view, 900, NaN, IDLE_FRAME_MS), IDLE_FRAME_MS);
  assert.equal(clockDrawBudgetMs({ start: NaN, end: 1 }, 900, 1, IDLE_FRAME_MS), IDLE_FRAME_MS);
});
test("dimColor: hue preserved, saturation and value halved", () => {
  assert.equal(dimColor("#ff0000"), "rgba(128, 64, 64, 1)");
  assert.equal(dimColor("rgb(0, 255, 0)"), "rgba(64, 128, 64, 1)");
});
test("dimColor: greys halve value without inventing hue or saturation", () => {
  assert.equal(dimColor("#808080"), "rgba(64, 64, 64, 1)");
  assert.equal(dimColor("#ffffff"), "rgba(128, 128, 128, 1)");
  assert.equal(dimColor("#000000"), "rgba(0, 0, 0, 1)");
});
test("dimColor: alpha passes through untouched", () => {
  assert.equal(dimColor("rgba(255, 0, 0, 0.4)"), "rgba(128, 64, 64, 0.4)");
  assert.equal(dimColor("hsla(0, 100%, 50%, 0.25)"), "rgba(128, 64, 64, 0.25)");
  assert.equal(dimColor("#ff000080"), `rgba(128, 64, 64, ${128 / 255 * 1e3 % 1 === 0 ? 128 / 255 : Math.round(128 / 255 * 1e3) / 1e3})`);
});
test("dimColor: hsl and oklch forms parse; unknown forms pass through", () => {
  assert.equal(dimColor("hsl(120, 100%, 25%)"), "rgba(32, 64, 32, 1)");
  const red = dimColor("oklch(0.628 0.258 29.234)");
  const m = red.match(/^rgba\((\d+), (\d+), (\d+), 1\)$/);
  assert.ok(m, `expected rgba() output, got ${red}`);
  assert.ok(Number(m[1]) > Number(m[2]) && Number(m[1]) > Number(m[3]), red);
  assert.match(dimColor("oklch(0.62 0.11 210 / 0.9)"), /^rgba\(\d+, \d+, \d+, 0.9\)$/);
  assert.equal(dimColor("rebeccapurple"), "rebeccapurple");
  assert.equal(dimColor("var(--x)"), "var(--x)");
});
test("dimColor: applying to categoryColor output keeps the category hue family", () => {
  for (const mode of ["oklch", "hsl"]) {
    const base = categoryColor(210, { mode });
    const dimmed = dimColor(base);
    assert.notEqual(dimmed, base);
    assert.match(dimmed, /^rgba\(/);
  }
});
test("labelHaloColor: dark halo under a light foreground", () => {
  assert.equal(labelHaloColor("#e8ecf4"), "rgba(0, 0, 0, 0.55)");
  assert.equal(labelHaloColor("#ffffff"), "rgba(0, 0, 0, 0.55)");
  assert.equal(labelHaloColor("#808080"), "rgba(0, 0, 0, 0.55)");
});
test("labelHaloColor: light halo under a dark foreground (light themes)", () => {
  assert.equal(labelHaloColor("#111318"), "rgba(255, 255, 255, 0.55)");
  assert.equal(labelHaloColor("#000000"), "rgba(255, 255, 255, 0.55)");
  assert.equal(labelHaloColor("#6b6b6b"), "rgba(255, 255, 255, 0.55)");
});
test("labelHaloColor: accepts every parseColor form; alpha in fg is ignored", () => {
  assert.equal(labelHaloColor("rgb(232, 236, 244)"), "rgba(0, 0, 0, 0.55)");
  assert.equal(labelHaloColor("rgba(232, 236, 244, 0.2)"), "rgba(0, 0, 0, 0.55)");
  assert.equal(labelHaloColor("hsl(220, 35%, 93%)"), "rgba(0, 0, 0, 0.55)");
  assert.equal(labelHaloColor("oklch(0.95 0.01 250)"), "rgba(0, 0, 0, 0.55)");
  assert.equal(labelHaloColor("oklch(0.2 0.02 250)"), "rgba(255, 255, 255, 0.55)");
});
test("labelHaloColor: unparseable colors fall back to the dark halo", () => {
  assert.equal(labelHaloColor("var(--my-fg)"), "rgba(0, 0, 0, 0.55)");
  assert.equal(labelHaloColor("papayawhip"), "rgba(0, 0, 0, 0.55)");
});
var SEG_IV = { start: 0, end: 1e5 };
var SEGS = [
  { start: 0, end: 4e4, kind: "queued" },
  { start: 4e4, end: 7e4, kind: "waiting" }
];
test("segmentAtTime: resolves the phase covering t, with index and clamped window", () => {
  assert.deepEqual(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, 1e4), { index: 0, kind: "queued", start: 0, end: 4e4 });
  assert.deepEqual(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, 55e3), { index: 1, kind: "waiting", start: 4e4, end: 7e4 });
});
test("segmentAtTime: base bar (no covering phase) and off-bar times resolve to null", () => {
  assert.equal(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, 85e3), null);
  assert.equal(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, -5), null);
  assert.equal(segmentAtTime([], SEG_IV.start, SEG_IV.end, 10), null);
  assert.equal(segmentAtTime(null, SEG_IV.start, SEG_IV.end, 10), null);
  assert.equal(segmentAtTime(void 0, SEG_IV.start, SEG_IV.end, 10), null);
});
test("segmentAtTime: half-open boundaries \u2014 a shared edge belongs to the incoming phase", () => {
  assert.equal(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, 4e4)?.kind, "waiting");
  assert.equal(segmentAtTime(SEGS, SEG_IV.start, SEG_IV.end, 7e4), null);
});
test("segmentAtTime: overlaps resolve LAST-painted (draw order overpaints)", () => {
  const overlapping = [
    { start: 0, end: 8e4, kind: "dim" },
    { start: 5e4, end: 1e5, kind: "waiting" }
  ];
  assert.equal(segmentAtTime(overlapping, SEG_IV.start, SEG_IV.end, 6e4)?.kind, "waiting");
  assert.equal(segmentAtTime(overlapping, SEG_IV.start, SEG_IV.end, 2e4)?.kind, "dim");
});
test("segmentAtTime: null end runs to the interval end, inclusive at the bar's last instant", () => {
  const tail = [{ start: 9e4, end: null, kind: "outline" }];
  assert.deepEqual(segmentAtTime(tail, SEG_IV.start, SEG_IV.end, 95e3), { index: 0, kind: "outline", start: 9e4, end: 1e5 });
  assert.equal(segmentAtTime(tail, SEG_IV.start, SEG_IV.end, 1e5)?.kind, "outline");
  assert.equal(segmentAtTime(tail, SEG_IV.start, SEG_IV.end, 100001), null);
});
test("segmentAtTime: draw-path clamps \u2014 starts floor to the interval, ends cap to it, outside phases skip", () => {
  const segs = [
    { start: -1e4, end: 2e4, kind: "queued" },
    { start: 6e4, end: 5e5, kind: "waiting" },
    // end caps to the interval
    { start: 15e4, end: 16e4, kind: "dim" }
    // fully outside — never matches
  ];
  assert.deepEqual(segmentAtTime(segs, SEG_IV.start, SEG_IV.end, 5e3), { index: 0, kind: "queued", start: 0, end: 2e4 });
  assert.deepEqual(segmentAtTime(segs, SEG_IV.start, SEG_IV.end, 99e3), { index: 1, kind: "waiting", start: 6e4, end: 1e5 });
  assert.equal(segmentAtTime(segs, SEG_IV.start, SEG_IV.end, 3e4), null);
});
test("segmentAtTime: accepts Date phase bounds (toMs like every API edge)", () => {
  const segs = [{ start: /* @__PURE__ */ new Date(1e4), end: /* @__PURE__ */ new Date(2e4), kind: "waiting" }];
  assert.equal(segmentAtTime(segs, SEG_IV.start, SEG_IV.end, 15e3)?.index, 0);
});
test("fitSpanView: pads the span by the fraction each side (default 0.05)", () => {
  assert.deepEqual(fitSpanView(0, 1e5), { start: -5e3, end: 105e3 });
  assert.deepEqual(fitSpanView(0, 1e5, 0.1), { start: -1e4, end: 11e4 });
  assert.deepEqual(fitSpanView(0, 1e5, 0), { start: 0, end: 1e5 });
  assert.deepEqual(fitSpanView(0, MIN_SPAN_MS, 0), { start: 0, end: MIN_SPAN_MS });
});
test("fitSpanView: short spans and instants center in the minimum window", () => {
  assert.deepEqual(fitSpanView(0, 500), { start: 250 - MIN_SPAN_MS / 2, end: 250 + MIN_SPAN_MS / 2 });
  assert.deepEqual(fitSpanView(5e3, 5e3), { start: 5e3 - MIN_SPAN_MS / 2, end: 5e3 + MIN_SPAN_MS / 2 });
});
test("fitSpanView: order-tolerant, Date-tolerant, junk pad falls back to the default", () => {
  assert.deepEqual(fitSpanView(1e5, 0), fitSpanView(0, 1e5));
  assert.deepEqual(fitSpanView(/* @__PURE__ */ new Date(0), /* @__PURE__ */ new Date(1e5), 0.05), { start: -5e3, end: 105e3 });
  assert.deepEqual(fitSpanView(0, 1e5, -1), fitSpanView(0, 1e5, 0.05));
  assert.deepEqual(fitSpanView(0, 1e5, Number.NaN), fitSpanView(0, 1e5, 0.05));
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidGltZWxpbmUtdmlldy1tYXRoLnRlc3QudHMiLCAiaGl0LXRlc3QudHMiLCAiY29sb3IudHMiLCAidGltZWxpbmUtdmlldy1tYXRoLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBUZXN0cyBmb3IgdGhlIHB1cmUgbWF0aCBoYWxmIG9mIDx0aW1lbGluZS12aWV3PiAodWkvdGltZWxpbmUtdmlldy1tYXRoLnRzKTogc2NhbGVzICsgYW5jaG9yLXByZXNlcnZpbmcgem9vbS5cblxuaW1wb3J0IHsgdGVzdCB9IGZyb20gJ25vZGU6dGVzdCc7XG5pbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0L3N0cmljdCc7XG5cbmltcG9ydCB7XG4gIHRvTXMsXG4gIHRpbWVUb1gsXG4gIHhUb1RpbWUsXG4gIHBhblZpZXcsXG4gIHpvb21WaWV3LFxuICB3aGVlbERlbHRhVG9QaXhlbHMsXG4gIHpvb21GYWN0b3JGb3JXaGVlbCxcbiAgWk9PTV9QWF9QRVJfRE9VQkxFLFxuICBNSU5fU1BBTl9NUyxcbiAgTUFYX1NQQU5fTVMsXG4gIERFRkFVTFRfU1BBTl9SRUZfTVMsXG4gIGRlZmF1bHRTcGFuRm9yQXNwZWN0LFxuICBUSU1FX1RJQ0tfU1RFUFMsXG4gIHRpbWVUaWNrU3RlcCxcbiAgdGltZVRpY2tzLFxuICBmb3JtYXRUaW1lVGljayxcbiAgZm9ybWF0VGltZUZ1bGwsXG4gIGZvcm1hdER1cmF0aW9uLFxuICBwYWNrVHJhY2tzLFxuICBQQUNLX01JTl9NUyxcbiAgbGF5b3V0TGFuZXMsXG4gIHRyYWNrVG9wLFxuICBmaXRUZXh0LFxuICBFTExJUFNJUyxcbiAgSU5TVEFOVF9USFJFU0hPTERfUFgsXG4gIGlzSW5zdGFudFdpZHRoLFxuICBleHBhbmRIaXRSZWN0LFxuICBoaXRUZXN0UmVjdHMsXG4gIGRpc3RTcVRvU2VnbWVudCxcbiAgaGl0VGVzdFBvbHlsaW5lLFxuICBjb25uZWN0b3JSb3V0ZSxcbiAgaGFzaFN0cmluZyxcbiAgY2F0ZWdvcnlIdWUsXG4gIGNhdGVnb3J5Sml0dGVyLFxuICBjYXRlZ29yeUNvbG9yLFxuICBERUZBVUxUX1NUWUxFUyxcbiAgbWVyZ2VSYW5nZXMsXG4gIHN1YnRyYWN0UmFuZ2VzLFxuICBDb3ZlcmFnZVRyYWNrZXIsXG4gIGhpc3RvcnlQcm9iZSxcbiAgcm91dGVXaGVlbCxcbiAgY2xhc3NpZnlXaGVlbCxcbiAgV2hlZWxHZXN0dXJlUm91dGVyLFxuICBXSEVFTF9HRVNUVVJFX0dBUF9NUyxcbiAgZm9sbG93QWZ0ZXJHZXN0dXJlLFxuICBGT0xMT1dfTEVBRF9GUkFDLFxuICBGT0xMT1dfU05BUF9ERVZJQ0VfUFgsXG4gIEZPTExPV19MRUFEX1RXRUVOX01TLFxuICBKVU1QX1RPX05PV19UV0VFTl9NUyxcbiAgZm9sbG93TGVhZEF0LFxuICBnZXN0dXJlTGVhZEZyYWMsXG4gIFNUQUxFX0FGVEVSX0RFRkFVTFRfTVMsXG4gIGZlZWRJc1N0YWxlLFxuICBsaXZlRWRnZVRhcmdldCxcbiAgY2xhbXBWaWV3VG9Ob3csXG4gIGNsYW1wVmlld1RvQm91bmRzLFxuICBib3VuZGVkTWF4U3BhbixcbiAgc25hcFZpZXdUb0RldmljZVBpeGVscyxcbiAgc25hcFRleHRPcmlnaW4sXG4gIG5vd0xpbmVYLFxuICBkdXJhdGlvbldpZHRoUHgsXG4gIGVkZ2VDb250aW51YXRpb24sXG4gIE1JTl9CQVJfUFgsXG4gIHBhY2tWaXNpYmxlVHJhY2tzLFxuICBUcmFja0FsbG9jYXRvcixcbiAgcmVzb2x2ZVBhcmVudHMsXG4gIHBhY2tGYW1pbHksXG4gIGNsdXN0ZXJJbnN0YW50cyxcbiAgY2x1c3Rlclpvb21WaWV3LFxuICBjbHVzdGVyTWFya2VyVGltZSxcbiAgZml0U3BhblZpZXcsXG4gIHNlZ21lbnRBdFRpbWUsXG4gIENMVVNURVJfUElUQ0hfUFgsXG4gIENMVVNURVJfWk9PTV9GSUxMX0ZSQUMsXG4gIG1pbmltYXBFeHRlbnQsXG4gIG1pbmltYXBXaW5kb3dSZWN0LFxuICBtaW5pbWFwSGl0Wm9uZSxcbiAgbWluaW1hcFBhbixcbiAgbWluaW1hcFJlc2l6ZSxcbiAgbWluaW1hcENlbnRlcixcbiAgTUlOSU1BUF9IQU5ETEVfSElUX1BYLFxuICBNSU5JTUFQX01JTl9XSU5ET1dfUFgsXG4gIGxhbmVIZWlnaHQsXG4gIGRlbW90aW9uT3JkZXIsXG4gIGNvbXB1dGVBdXRvRml0LFxuICBGSVRfSFlTVEVSRVNJU19GUkFDLFxuICBmcmFtZUJ1ZGdldE1zLFxuICBzaG91bGRSZW5kZXIsXG4gIGNsb2NrRHJhd0J1ZGdldE1zLFxuICBJRExFX0ZSQU1FX01TLFxuICBJRExFX0JBVFRFUllfRlJBTUVfTVMsXG4gIGRpbUNvbG9yLFxuICBsYWJlbEhhbG9Db2xvcixcbiAgdHlwZSBXaGVlbElucHV0LFxuICB0eXBlIFRpbWVWaWV3LFxuICB0eXBlIFBhY2tJdGVtLFxuICB0eXBlIEhpdFJlY3QsXG4gIHR5cGUgVGltZVJhbmdlLFxuICB0eXBlIExhbmVNZXRyaWNzLFxufSBmcm9tICcuL3RpbWVsaW5lLXZpZXctbWF0aC50cyc7XG5cbmNvbnN0IEhPVVIgPSAzXzYwMF8wMDA7XG5jb25zdCBEQVkgPSA4Nl80MDBfMDAwO1xuXG4vLyAtLSB0b01zIC8gc2NhbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgndG9NczogbnVtYmVycyBwYXNzIHRocm91Z2gsIERhdGVzIGNvbnZlcnQnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbCh0b01zKDEyMzQpLCAxMjM0KTtcbiAgYXNzZXJ0LmVxdWFsKHRvTXMobmV3IERhdGUoNTY3ODkpKSwgNTY3ODkpO1xufSk7XG5cbnRlc3QoJ3RpbWVUb1gveFRvVGltZTogZW5kcG9pbnRzLCBtaWRwb2ludCwgYW5kIHJvdW5kLXRyaXAnLCAoKSA9PiB7XG4gIGNvbnN0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogMTAwMCwgZW5kOiAyMDAwIH07XG4gIGFzc2VydC5lcXVhbCh0aW1lVG9YKDEwMDAsIHZpZXcsIDUwMCksIDApO1xuICBhc3NlcnQuZXF1YWwodGltZVRvWCgyMDAwLCB2aWV3LCA1MDApLCA1MDApO1xuICBhc3NlcnQuZXF1YWwodGltZVRvWCgxNTAwLCB2aWV3LCA1MDApLCAyNTApO1xuICBhc3NlcnQuZXF1YWwoeFRvVGltZSgyNTAsIHZpZXcsIDUwMCksIDE1MDApO1xuICBmb3IgKGNvbnN0IHggb2YgWzAsIDE3LjUsIDMzMywgNTAwXSkge1xuICAgIGFzc2VydC5vayhNYXRoLmFicyh0aW1lVG9YKHhUb1RpbWUoeCwgdmlldywgNTAwKSwgdmlldywgNTAwKSAtIHgpIDwgMWUtOSwgYHJvdW5kLXRyaXAgJHt4fWApO1xuICB9XG59KTtcblxudGVzdCgncGFuVmlldzogc2hpZnRzIGJvdGggZW5kcywgcHJlc2VydmluZyB0aGUgc3BhbicsICgpID0+IHtcbiAgY29uc3QgdiA9IHBhblZpZXcoeyBzdGFydDogMTAwLCBlbmQ6IDMwMCB9LCA1MCk7XG4gIGFzc2VydC5kZWVwRXF1YWwodiwgeyBzdGFydDogMTUwLCBlbmQ6IDM1MCB9KTtcbn0pO1xuXG4vLyAtLSB6b29tVmlldyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ3pvb21WaWV3OiB0aGUgdGltZSB1bmRlciB0aGUgY3Vyc29yIHN0YXlzIHVuZGVyIHRoZSBjdXJzb3InLCAoKSA9PiB7XG4gIGNvbnN0IHdpZHRoID0gODAwO1xuICBsZXQgc2VlZCA9IDQyO1xuICBjb25zdCByYW5kID0gKCk6IG51bWJlciA9PiB7XG4gICAgc2VlZCA9IChzZWVkICogMTEwMzUxNTI0NSArIDEyMzQ1KSAmIDB4N2ZmZmZmZmY7XG4gICAgcmV0dXJuIHNlZWQgLyAweDdmZmZmZmZmO1xuICB9O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDIwMDsgaSsrKSB7XG4gICAgY29uc3Qgc3RhcnQgPSByYW5kKCkgKiAxZTEyO1xuICAgIGNvbnN0IHNwYW4gPSBNSU5fU1BBTl9NUyAqIDQgKyByYW5kKCkgKiAoTUFYX1NQQU5fTVMgLyA0KTtcbiAgICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQsIGVuZDogc3RhcnQgKyBzcGFuIH07XG4gICAgY29uc3QgeCA9IHJhbmQoKSAqIHdpZHRoO1xuICAgIGNvbnN0IGFuY2hvciA9IHhUb1RpbWUoeCwgdmlldywgd2lkdGgpO1xuICAgIGNvbnN0IGZhY3RvciA9IE1hdGgucG93KDIsIHJhbmQoKSAqIDQgLSAyKTsgLy8gMC4yNXggLi4gNHhcbiAgICBjb25zdCB6b29tZWQgPSB6b29tVmlldyh2aWV3LCBhbmNob3IsIGZhY3Rvcik7XG4gICAgY29uc3QgeEFmdGVyID0gdGltZVRvWChhbmNob3IsIHpvb21lZCwgd2lkdGgpO1xuICAgIGFzc2VydC5vayhNYXRoLmFicyh4QWZ0ZXIgLSB4KSA8IDFlLTYgKiB3aWR0aCwgYGFuY2hvciBwaXhlbCBtb3ZlZDogJHt4fSAtPiAke3hBZnRlcn1gKTtcbiAgfVxufSk7XG5cbnRlc3QoJ3pvb21WaWV3OiBmYWN0b3IgPiAxIHNocmlua3MgdGhlIHNwYW4gYnkgZXhhY3RseSB0aGF0IGZhY3RvcicsICgpID0+IHtcbiAgY29uc3QgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiAwLCBlbmQ6IDEwMF8wMDAgfTtcbiAgY29uc3QgeiA9IHpvb21WaWV3KHZpZXcsIDUwXzAwMCwgMik7XG4gIGFzc2VydC5vayhNYXRoLmFicyh6LmVuZCAtIHouc3RhcnQgLSA1MF8wMDApIDwgMWUtOSk7XG59KTtcblxudGVzdCgnem9vbVZpZXc6IHNwYW4gY2xhbXBzIHRvIFtNSU5fU1BBTl9NUywgTUFYX1NQQU5fTVNdIGFuZCBrZWVwcyB0aGUgYW5jaG9yIGZyYWN0aW9uJywgKCkgPT4ge1xuICBjb25zdCB0aW55ID0gem9vbVZpZXcoeyBzdGFydDogMCwgZW5kOiBNSU5fU1BBTl9NUyAqIDIgfSwgTUlOX1NQQU5fTVMsIDFlOSk7XG4gIGFzc2VydC5lcXVhbCh0aW55LmVuZCAtIHRpbnkuc3RhcnQsIE1JTl9TUEFOX01TKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKChNSU5fU1BBTl9NUyAtIHRpbnkuc3RhcnQpIC8gKHRpbnkuZW5kIC0gdGlueS5zdGFydCkgLSAwLjUpIDwgMWUtOSk7XG5cbiAgY29uc3QgaHVnZSA9IHpvb21WaWV3KHsgc3RhcnQ6IDAsIGVuZDogREFZIH0sIERBWSAvIDQsIDFlLTkpO1xuICBhc3NlcnQuZXF1YWwoaHVnZS5lbmQgLSBodWdlLnN0YXJ0LCBNQVhfU1BBTl9NUyk7XG4gIGFzc2VydC5vayhNYXRoLmFicygoREFZIC8gNCAtIGh1Z2Uuc3RhcnQpIC8gTUFYX1NQQU5fTVMgLSAwLjI1KSA8IDFlLTkpO1xufSk7XG5cbnRlc3QoJ3pvb21WaWV3OiBkZWdlbmVyYXRlIGZhY3RvcnMgYXJlIGlnbm9yZWQnLCAoKSA9PiB7XG4gIGNvbnN0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogMCwgZW5kOiAxMF8wMDAgfTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh6b29tVmlldyh2aWV3LCA1XzAwMCwgTmFOKSwgdmlldyk7XG4gIGFzc2VydC5kZWVwRXF1YWwoem9vbVZpZXcodmlldywgNV8wMDAsIDApLCB2aWV3KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh6b29tVmlldyh2aWV3LCA1XzAwMCwgLTIpLCB2aWV3KTtcbn0pO1xuXG4vLyAtLSBXaGVlbCBub3JtYWxpemF0aW9uIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ3doZWVsRGVsdGFUb1BpeGVsczogZGVsdGFNb2RlIDAgaXMgMToxLCAxIGlzIGxpbmVzLCAyIGlzIHBhZ2VzJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwod2hlZWxEZWx0YVRvUGl4ZWxzKDcuNSwgMCksIDcuNSk7XG4gIGFzc2VydC5lcXVhbCh3aGVlbERlbHRhVG9QaXhlbHMoLTEyMCwgMCksIC0xMjApO1xuICBhc3NlcnQuZXF1YWwod2hlZWxEZWx0YVRvUGl4ZWxzKDMsIDEpLCA0OCk7IC8vIEEgZmV3IGxpbmVzIFx1MDBEN1xuICBhc3NlcnQuZXF1YWwod2hlZWxEZWx0YVRvUGl4ZWxzKDMsIDEsIDIwKSwgNjApO1xuICBhc3NlcnQuZXF1YWwod2hlZWxEZWx0YVRvUGl4ZWxzKDEsIDIpLCA4MDApO1xuICBhc3NlcnQuZXF1YWwod2hlZWxEZWx0YVRvUGl4ZWxzKC0yLCAyLCAxNiwgNTAwKSwgLTEwMDApO1xuICBhc3NlcnQuZXF1YWwod2hlZWxEZWx0YVRvUGl4ZWxzKE5hTiwgMCksIDApO1xufSk7XG5cbnRlc3QoJ3pvb21GYWN0b3JGb3JXaGVlbDogZXhwb25lbnRpYWwsIGNvbXBvc2FibGUsIGFuZCBkb3VibGluZyBhdCB0aGUgY29uc3RhbnQnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbCh6b29tRmFjdG9yRm9yV2hlZWwoMCksIDEpO1xuICBhc3NlcnQuZXF1YWwoem9vbUZhY3RvckZvcldoZWVsKC1aT09NX1BYX1BFUl9ET1VCTEUpLCAyKTtcbiAgYXNzZXJ0LmVxdWFsKHpvb21GYWN0b3JGb3JXaGVlbChaT09NX1BYX1BFUl9ET1VCTEUpLCAwLjUpO1xuICBjb25zdCBhID0gem9vbUZhY3RvckZvcldoZWVsKC0zNykgKiB6b29tRmFjdG9yRm9yV2hlZWwoLTYzKTtcbiAgY29uc3QgYiA9IHpvb21GYWN0b3JGb3JXaGVlbCgtMTAwKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGEgLSBiKSA8IDFlLTEyLCAnZmFjdG9ycyBjb21wb3NlOiBmKGEpKmYoYikgPT0gZihhK2IpJyk7XG59KTtcblxuLy8gLS0gRGVmYXVsdCBzcGFuIChhc3BlY3Qtc2NhbGVkIGluaXRpYWwgd2luZG93KSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdkZWZhdWx0U3BhbkZvckFzcGVjdDogZXhhY3RseSB0aGUgMy1taW4gcmVmZXJlbmNlIGF0IDE2OjknLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChkZWZhdWx0U3BhbkZvckFzcGVjdCgxNjAwLCA5MDApLCBERUZBVUxUX1NQQU5fUkVGX01TKTtcbiAgYXNzZXJ0LmVxdWFsKGRlZmF1bHRTcGFuRm9yQXNwZWN0KDE5MjAsIDEwODApLCBERUZBVUxUX1NQQU5fUkVGX01TKTtcbiAgYXNzZXJ0LmVxdWFsKERFRkFVTFRfU1BBTl9SRUZfTVMsIDE4MF8wMDApO1xufSk7XG5cbnRlc3QoJ2RlZmF1bHRTcGFuRm9yQXNwZWN0OiBzY2FsZXMgbGluZWFybHkgd2l0aCB0aGUgY29udGFpbmVyIGFzcGVjdCByYXRpbycsICgpID0+IHtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKGRlZmF1bHRTcGFuRm9yQXNwZWN0KDIxMDAsIDkwMCkgLSBERUZBVUxUX1NQQU5fUkVGX01TICogKDIxIC8gMTYpKSA8IDFlLTYpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoZGVmYXVsdFNwYW5Gb3JBc3BlY3QoOTAwLCA5MDApIC0gREVGQVVMVF9TUEFOX1JFRl9NUyAqICg5IC8gMTYpKSA8IDFlLTYpO1xuICAvLyBMaW5lYXJpdHk6IGRvdWJsaW5nIHRoZSB3aWR0aCBkb3VibGVzIHRoZSBzcGFuIChiZWxvdyB0aGUgY2xhbXApLlxuICBhc3NlcnQub2soTWF0aC5hYnMoZGVmYXVsdFNwYW5Gb3JBc3BlY3QoMzIwMCwgOTAwKSAtIDIgKiBkZWZhdWx0U3BhbkZvckFzcGVjdCgxNjAwLCA5MDApKSA8IDFlLTYpO1xuICAvLyBQdXJlLXNjYWxlIGludmFyaWFuY2U6IG9ubHkgdGhlIFJBVElPIG1hdHRlcnMsIG5vdCB0aGUgYWJzb2x1dGUgc2l6ZS5cbiAgYXNzZXJ0LmVxdWFsKGRlZmF1bHRTcGFuRm9yQXNwZWN0KDE2MCwgOTApLCBkZWZhdWx0U3BhbkZvckFzcGVjdCgzMjAwLCAxODAwKSk7XG59KTtcblxudGVzdCgnZGVmYXVsdFNwYW5Gb3JBc3BlY3Q6IGRlZ2VuZXJhdGUvdW5zaXplZCBob3N0cyBmYWxsIGJhY2sgdG8gdGhlIDMtbWluIHJlZmVyZW5jZScsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKGRlZmF1bHRTcGFuRm9yQXNwZWN0KDAsIDkwMCksIERFRkFVTFRfU1BBTl9SRUZfTVMpO1xuICBhc3NlcnQuZXF1YWwoZGVmYXVsdFNwYW5Gb3JBc3BlY3QoMTYwMCwgMCksIERFRkFVTFRfU1BBTl9SRUZfTVMpO1xuICBhc3NlcnQuZXF1YWwoZGVmYXVsdFNwYW5Gb3JBc3BlY3QoMCwgMCksIERFRkFVTFRfU1BBTl9SRUZfTVMpO1xuICBhc3NlcnQuZXF1YWwoZGVmYXVsdFNwYW5Gb3JBc3BlY3QoLTQsIDEwMCksIERFRkFVTFRfU1BBTl9SRUZfTVMpO1xuICBhc3NlcnQuZXF1YWwoZGVmYXVsdFNwYW5Gb3JBc3BlY3QoTmFOLCA5MDApLCBERUZBVUxUX1NQQU5fUkVGX01TKTtcbiAgYXNzZXJ0LmVxdWFsKGRlZmF1bHRTcGFuRm9yQXNwZWN0KDE2MDAsIEluZmluaXR5KSwgREVGQVVMVF9TUEFOX1JFRl9NUyk7XG59KTtcblxudGVzdCgnZGVmYXVsdFNwYW5Gb3JBc3BlY3Q6IGNsYW1wcyB0byBbTUlOX1NQQU5fTVMsIE1BWF9TUEFOX01TXSBhdCBleHRyZW1lIGFzcGVjdHMnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChkZWZhdWx0U3BhbkZvckFzcGVjdCgxZTksIDEpLCBNQVhfU1BBTl9NUyk7XG4gIGFzc2VydC5lcXVhbChkZWZhdWx0U3BhbkZvckFzcGVjdCgxLCAxZTYpLCBNSU5fU1BBTl9NUyk7XG4gIC8vIEluc2lkZSB0aGUgY2xhbXBzIHN0YXlzIHVuY2xhbXBlZC5cbiAgY29uc3Qgd2lkZSA9IGRlZmF1bHRTcGFuRm9yQXNwZWN0KDYwMDAsIDkwMCk7XG4gIGFzc2VydC5vayh3aWRlID4gREVGQVVMVF9TUEFOX1JFRl9NUyAmJiB3aWRlIDwgTUFYX1NQQU5fTVMpO1xufSk7XG5cbi8vIC0tIFRpbWUgdGlja3MgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgndGltZVRpY2tTdGVwOiBwaWNrcyBsYWRkZXIgc3RlcHMgYWNyb3NzIHNwYW5zIGZyb20gc2Vjb25kcyB0byBkYXlzJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwodGltZVRpY2tTdGVwKDJfMDAwLCA4KSwgNTAwKTsgLy8gMnMgc3BhbiBcdTIxOTIgNTAwbXMgdGlja3NcbiAgYXNzZXJ0LmVxdWFsKHRpbWVUaWNrU3RlcCg2MF8wMDAsIDgpLCAxMF8wMDApOyAvLyAxbWluIFx1MjE5MiAxMHNcbiAgYXNzZXJ0LmVxdWFsKHRpbWVUaWNrU3RlcCgyNSAqIDYwXzAwMCwgOCksIDMwMF8wMDApOyAvLyAyNW1pbiBcdTIxOTIgNW1pblxuICBhc3NlcnQuZXF1YWwodGltZVRpY2tTdGVwKDYgKiBIT1VSLCA4KSwgSE9VUik7IC8vIDZoIFx1MjE5MiAxaFxuICBhc3NlcnQuZXF1YWwodGltZVRpY2tTdGVwKDIgKiBEQVksIDgpLCA2ICogSE9VUik7IC8vIDJkIFx1MjE5MiA2aFxuICBhc3NlcnQuZXF1YWwodGltZVRpY2tTdGVwKDcgKiBEQVksIDgpLCBEQVkpOyAvLyA3ZCBcdTIxOTIgMWRcbiAgYXNzZXJ0LmVxdWFsKHRpbWVUaWNrU3RlcCgxZTEyLCA4KSwgVElNRV9USUNLX1NURVBTW1RJTUVfVElDS19TVEVQUy5sZW5ndGggLSAxXSk7XG59KTtcblxudGVzdCgndGltZVRpY2tzOiBhbGlnbmVkIHRvIHRoZSBzdGVwLCB3aXRoaW4gdGhlIHZpZXcsIGF0IG1vc3QgbWF4VGlja3MgKyAxJywgKCkgPT4ge1xuICBmb3IgKGNvbnN0IHNwYW4gb2YgWzJfMDAwLCA0NV8wMDAsIDI1ICogNjBfMDAwLCAzICogSE9VUiwgNSAqIERBWV0pIHtcbiAgICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDFfNzAwXzAwMF8xMjNfNDU2LCBlbmQ6IDFfNzAwXzAwMF8xMjNfNDU2ICsgc3BhbiB9O1xuICAgIGNvbnN0IHRpY2tzID0gdGltZVRpY2tzKHZpZXcsIDgpO1xuICAgIGNvbnN0IHN0ZXAgPSB0aW1lVGlja1N0ZXAoc3BhbiwgOCk7XG4gICAgYXNzZXJ0Lm9rKHRpY2tzLmxlbmd0aCA+PSAxLCBgaGFzIHRpY2tzIGZvciBzcGFuICR7c3Bhbn1gKTtcbiAgICBhc3NlcnQub2sodGlja3MubGVuZ3RoIDw9IDksIGBjb3VudCAke3RpY2tzLmxlbmd0aH0gPD0gOSBmb3Igc3BhbiAke3NwYW59YCk7XG4gICAgZm9yIChjb25zdCB0IG9mIHRpY2tzKSB7XG4gICAgICBhc3NlcnQub2sodCA+PSB2aWV3LnN0YXJ0ICYmIHQgPD0gdmlldy5lbmQsIGAke3R9IGluc2lkZSB2aWV3YCk7XG4gICAgICBhc3NlcnQuZXF1YWwodCAlIHN0ZXAsIDAsIGAke3R9IG9uIHRoZSAke3N0ZXB9IGdyaWRgKTtcbiAgICB9XG4gIH1cbn0pO1xuXG50ZXN0KCd0aW1lVGlja3M6IHR6T2Zmc2V0IGFsaWducyBkYXkgdGlja3MgdG8gbG9jYWwgbWlkbmlnaHQnLCAoKSA9PiB7XG4gIGNvbnN0IG9mZnNldCA9IC01ICogSE9VUjsgLy8gVVRDLTVcbiAgY29uc3QgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiAxXzcwMF8wMDBfMDAwXzAwMCwgZW5kOiAxXzcwMF8wMDBfMDAwXzAwMCArIDQgKiBEQVkgfTtcbiAgY29uc3QgdGlja3MgPSB0aW1lVGlja3ModmlldywgNSwgb2Zmc2V0KTtcbiAgYXNzZXJ0Lm9rKHRpY2tzLmxlbmd0aCA+IDApO1xuICBmb3IgKGNvbnN0IHQgb2YgdGlja3MpIHtcbiAgICBhc3NlcnQuZXF1YWwoKHQgKyBvZmZzZXQpICUgREFZLCAwLCBgJHt0fSBpcyBsb2NhbCBtaWRuaWdodGApO1xuICB9XG59KTtcblxudGVzdCgndGltZVRpY2tzOiBlbXB0eS9pbnZhbGlkIHZpZXcgeWllbGRzIG5vIHRpY2tzJywgKCkgPT4ge1xuICBhc3NlcnQuZGVlcEVxdWFsKHRpbWVUaWNrcyh7IHN0YXJ0OiA1LCBlbmQ6IDUgfSwgOCksIFtdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh0aW1lVGlja3MoeyBzdGFydDogOSwgZW5kOiAzIH0sIDgpLCBbXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwodGltZVRpY2tzKHsgc3RhcnQ6IE5hTiwgZW5kOiAzIH0sIDgpLCBbXSk7XG59KTtcblxuLy8gLS0gVGljayAvIHRpbWUgZm9ybWF0dGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IFQgPSBEYXRlLlVUQygyMDIxLCAwLCAyLCAzLCA0LCA1LCA2NzgpO1xuXG50ZXN0KCdmb3JtYXRUaW1lVGljazogZ3JhbnVsYXJpdHkgZm9sbG93cyB0aGUgc3RlcCcsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKGZvcm1hdFRpbWVUaWNrKFQsIDUwMCksICc6MDUuNjc4Jyk7XG4gIGFzc2VydC5lcXVhbChmb3JtYXRUaW1lVGljayhULCA1XzAwMCksICcwMzowNDowNScpO1xuICBhc3NlcnQuZXF1YWwoZm9ybWF0VGltZVRpY2soVCwgNjBfMDAwKSwgJzAzOjA0Jyk7XG4gIGFzc2VydC5lcXVhbChmb3JtYXRUaW1lVGljayhULCBIT1VSKSwgJzAzOjA0Jyk7XG4gIGFzc2VydC5lcXVhbChmb3JtYXRUaW1lVGljayhULCBEQVkpLCAnSmFuIDInKTtcbn0pO1xuXG50ZXN0KCdmb3JtYXRUaW1lVGljazogYSBsb2NhbC1taWRuaWdodCB0aWNrIGxhYmVscyBhcyB0aGUgZGF0ZScsICgpID0+IHtcbiAgY29uc3QgbWlkbmlnaHQgPSBEYXRlLlVUQygyMDIxLCAwLCAyKTtcbiAgYXNzZXJ0LmVxdWFsKGZvcm1hdFRpbWVUaWNrKG1pZG5pZ2h0LCBIT1VSKSwgJ0phbiAyJyk7XG4gIGFzc2VydC5lcXVhbChmb3JtYXRUaW1lVGljayhEYXRlLlVUQygyMDIxLCAwLCAyLCA1KSwgSE9VUiwgLTUgKiBIT1VSKSwgJ0phbiAyJyk7XG4gIGFzc2VydC5lcXVhbChmb3JtYXRUaW1lVGljayhEYXRlLlVUQygyMDIxLCAwLCAyLCA1KSwgSE9VUiksICcwNTowMCcpO1xufSk7XG5cbnRlc3QoJ2Zvcm1hdFRpbWVGdWxsOiBkYXRlICsgdGltZSwgb3B0aW9uYWwgbXMnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChmb3JtYXRUaW1lRnVsbChUKSwgJ0phbiAyIDAzOjA0OjA1Jyk7XG4gIGFzc2VydC5lcXVhbChmb3JtYXRUaW1lRnVsbChULCAwLCB0cnVlKSwgJ0phbiAyIDAzOjA0OjA1LjY3OCcpO1xuICBhc3NlcnQuZXF1YWwoZm9ybWF0VGltZUZ1bGwoVCwgMyAqIEhPVVIpLCAnSmFuIDIgMDY6MDQ6MDUnKTtcbn0pO1xuXG50ZXN0KCdmb3JtYXREdXJhdGlvbjogdGFibGUnLCAoKSA9PiB7XG4gIGNvbnN0IGNhc2VzOiBbbnVtYmVyLCBzdHJpbmddW10gPSBbXG4gICAgW05hTiwgJ1x1MjAxNCddLFxuICAgIFstNSwgJ1x1MjAxNCddLFxuICAgIFswLCAnMG1zJ10sXG4gICAgWzc0MiwgJzc0Mm1zJ10sXG4gICAgWzFfMDAwLCAnMS4wcyddLFxuICAgIFsxMl8zNDAsICcxMi4zcyddLFxuICAgIFs4M18wMDAsICcxbSAyM3MnXSxcbiAgICBbNjA1XzAwMCwgJzEwbSAwNXMnXSxcbiAgICBbMiAqIEhPVVIgKyAxNCAqIDYwXzAwMCwgJzJoIDE0bSddLFxuICAgIFszICogREFZICsgNCAqIEhPVVIsICczZCA0aCddLFxuICBdO1xuICBmb3IgKGNvbnN0IFttcywgZXhwZWN0ZWRdIG9mIGNhc2VzKSB7XG4gICAgYXNzZXJ0LmVxdWFsKGZvcm1hdER1cmF0aW9uKG1zKSwgZXhwZWN0ZWQsIGBmb3JtYXREdXJhdGlvbigke21zfSlgKTtcbiAgfVxufSk7XG5cbi8vIC0tIHBhY2tUcmFja3MgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgcGFja09mID0gKGl0ZW1zOiBQYWNrSXRlbVtdKTogeyB0cmFja3M6IG51bWJlcltdOyB0cmFja0NvdW50OiBudW1iZXIgfSA9PiBwYWNrVHJhY2tzKGl0ZW1zKTtcblxudGVzdCgncGFjazogbm9uLW92ZXJsYXBwaW5nIGludGVydmFscyBzaGFyZSB0cmFjayAwJywgKCkgPT4ge1xuICBjb25zdCB7IHRyYWNrcywgdHJhY2tDb3VudCB9ID0gcGFja09mKFtcbiAgICB7IGlkOiAnYScsIHN0YXJ0OiAwLCBlbmQ6IDEwIH0sXG4gICAgeyBpZDogJ2InLCBzdGFydDogMTAsIGVuZDogMjAgfSwgLy8gdG91Y2hpbmc6IGVuZCA9PSBzdGFydCByZXVzZXMgdGhlIHRyYWNrXG4gICAgeyBpZDogJ2MnLCBzdGFydDogMjUsIGVuZDogMzAgfSxcbiAgXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwodHJhY2tzLCBbMCwgMCwgMF0pO1xuICBhc3NlcnQuZXF1YWwodHJhY2tDb3VudCwgMSk7XG59KTtcblxudGVzdCgncGFjazogYW4gb3ZlcmxhcCBjaGFpbiBzdGFja3MgZmlyc3QtZml0JywgKCkgPT4ge1xuICBjb25zdCB7IHRyYWNrcywgdHJhY2tDb3VudCB9ID0gcGFja09mKFtcbiAgICB7IGlkOiAnYScsIHN0YXJ0OiAwLCBlbmQ6IDEwMCB9LFxuICAgIHsgaWQ6ICdiJywgc3RhcnQ6IDEwLCBlbmQ6IDUwIH0sXG4gICAgeyBpZDogJ2MnLCBzdGFydDogMjAsIGVuZDogMzAgfSxcbiAgICB7IGlkOiAnZCcsIHN0YXJ0OiA2MCwgZW5kOiA5MCB9LFxuICBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh0cmFja3MsIFswLCAxLCAyLCAxXSk7XG4gIGFzc2VydC5lcXVhbCh0cmFja0NvdW50LCAzKTtcbn0pO1xuXG50ZXN0KCdwYWNrOiBvbmdvaW5nIGludGVydmFscyAoZW5kIG51bGwvdW5kZWZpbmVkKSBibG9jayB0aGVpciB0cmFjayBmb3JldmVyJywgKCkgPT4ge1xuICBjb25zdCB7IHRyYWNrcywgdHJhY2tDb3VudCB9ID0gcGFja09mKFtcbiAgICB7IGlkOiAnYScsIHN0YXJ0OiAwLCBlbmQ6IG51bGwgfSxcbiAgICB7IGlkOiAnYicsIHN0YXJ0OiAxXzAwMF8wMDAgfSwgLy8gZmFyIGxhdGVyLCBidXQgYSBuZXZlciBlbmRzXG4gICAgeyBpZDogJ2MnLCBzdGFydDogMl8wMDBfMDAwLCBlbmQ6IDJfMDAwXzAwMSB9LFxuICBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh0cmFja3MsIFswLCAxLCAyXSk7XG4gIGFzc2VydC5lcXVhbCh0cmFja0NvdW50LCAzKTtcbn0pO1xuXG50ZXN0KCdwYWNrOiBkZXRlcm1pbmlzdGljIHVuZGVyIGlucHV0IHJlLW9yZGVyaW5nIChyZXN1bHRzIGluZGV4LWFsaWduZWQpJywgKCkgPT4ge1xuICBjb25zdCBpdGVtczogUGFja0l0ZW1bXSA9IFtcbiAgICB7IGlkOiAnYScsIHN0YXJ0OiAwLCBlbmQ6IDQwIH0sXG4gICAgeyBpZDogJ2InLCBzdGFydDogMTAsIGVuZDogMzAgfSxcbiAgICB7IGlkOiAnYycsIHN0YXJ0OiAzNSwgZW5kOiA2MCB9LFxuICAgIHsgaWQ6ICdkJywgc3RhcnQ6IDUwLCBlbmQ6IG51bGwgfSxcbiAgICB7IGlkOiAnZScsIHN0YXJ0OiA1NSwgZW5kOiA1OCB9LFxuICBdO1xuICBjb25zdCBiYXNlID0gcGFja09mKGl0ZW1zKTtcbiAgY29uc3QgYnlJZCA9IG5ldyBNYXAoaXRlbXMubWFwKChpdCwgaSkgPT4gW2l0LmlkLCBiYXNlLnRyYWNrc1tpXV0pKTtcbiAgY29uc3Qgc2h1ZmZsZWQgPSBbaXRlbXNbM10sIGl0ZW1zWzBdLCBpdGVtc1s0XSwgaXRlbXNbMl0sIGl0ZW1zWzFdXTtcbiAgY29uc3QgcmUgPSBwYWNrT2Yoc2h1ZmZsZWQpO1xuICBhc3NlcnQuZXF1YWwocmUudHJhY2tDb3VudCwgYmFzZS50cmFja0NvdW50KTtcbiAgc2h1ZmZsZWQuZm9yRWFjaCgoaXQsIGkpID0+IHtcbiAgICBhc3NlcnQuZXF1YWwocmUudHJhY2tzW2ldLCBieUlkLmdldChpdC5pZCksIGB0cmFjayBmb3IgJHtpdC5pZH0gc3RhYmxlIHVuZGVyIHJlLXNvcnRgKTtcbiAgfSk7XG59KTtcblxudGVzdCgncGFjazogZXF1YWwgc3RhcnRzIHRpZS1icmVhayBieSBpZCwgZGV0ZXJtaW5pc3RpY2FsbHknLCAoKSA9PiB7XG4gIGNvbnN0IGEgPSBwYWNrT2YoW1xuICAgIHsgaWQ6ICd4Jywgc3RhcnQ6IDUsIGVuZDogMTAgfSxcbiAgICB7IGlkOiAneScsIHN0YXJ0OiA1LCBlbmQ6IDEwIH0sXG4gIF0pO1xuICBjb25zdCBiID0gcGFja09mKFtcbiAgICB7IGlkOiAneScsIHN0YXJ0OiA1LCBlbmQ6IDEwIH0sXG4gICAgeyBpZDogJ3gnLCBzdGFydDogNSwgZW5kOiAxMCB9LFxuICBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChhLnRyYWNrcywgWzAsIDFdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChiLnRyYWNrcywgWzEsIDBdKTtcbn0pO1xuXG50ZXN0KCdwYWNrOiBjb2luY2lkZW50IHplcm8tbGVuZ3RoIGluc3RhbnRzIGdldCB0aGVpciBvd24gdHJhY2tzIChuZXZlciB2YW5pc2gpJywgKCkgPT4ge1xuICBjb25zdCB7IHRyYWNrcywgdHJhY2tDb3VudCB9ID0gcGFja09mKFtcbiAgICB7IGlkOiAnaTEnLCBzdGFydDogMTAwLCBlbmQ6IDEwMCB9LFxuICAgIHsgaWQ6ICdpMicsIHN0YXJ0OiAxMDAsIGVuZDogMTAwIH0sXG4gICAgeyBpZDogJ2kzJywgc3RhcnQ6IDEwMCwgZW5kOiAxMDAgfSxcbiAgXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoWy4uLnRyYWNrc10uc29ydCgpLCBbMCwgMSwgMl0pO1xuICBhc3NlcnQuZXF1YWwodHJhY2tDb3VudCwgMyk7XG59KTtcblxudGVzdCgncGFjazogYW4gaW5zdGFudCBhdCBhIGJhciBzdGFydCBkb2VzIG5vdCBzaGFyZSB0aGUgYmFyIHRyYWNrJywgKCkgPT4ge1xuICBjb25zdCB7IHRyYWNrcyB9ID0gcGFja09mKFtcbiAgICB7IGlkOiAnYmFyJywgc3RhcnQ6IDEwMCwgZW5kOiA1MDAgfSxcbiAgICB7IGlkOiAncGlwJywgc3RhcnQ6IDEwMCwgZW5kOiAxMDAgfSxcbiAgXSk7XG4gIGFzc2VydC5ub3RFcXVhbCh0cmFja3NbMF0sIHRyYWNrc1sxXSk7XG4gIC8vIFx1MjAyNmJ1dCBhbiBpbnN0YW50IGF0IHRoZSBiYXIgRU5EIHJldXNlcyBpdCAoYmFyIHJlbGVhc2VkIHRoZSB0cmFjaykuXG4gIGNvbnN0IGFmdGVyID0gcGFja09mKFtcbiAgICB7IGlkOiAnYmFyJywgc3RhcnQ6IDEwMCwgZW5kOiA1MDAgfSxcbiAgICB7IGlkOiAncGlwJywgc3RhcnQ6IDUwMCwgZW5kOiA1MDAgfSxcbiAgXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYWZ0ZXIudHJhY2tzLCBbMCwgMF0pO1xuICBhc3NlcnQub2soUEFDS19NSU5fTVMgPj0gMSk7XG59KTtcblxudGVzdCgncGFjazogZW1wdHkgaW5wdXQgeWllbGRzIG9uZSAoZW1wdHkpIHRyYWNrJywgKCkgPT4ge1xuICBhc3NlcnQuZGVlcEVxdWFsKHBhY2tPZihbXSksIHsgdHJhY2tzOiBbXSwgdHJhY2tDb3VudDogMSB9KTtcbn0pO1xuXG4vLyAtLSBMYW5lIGxheW91dCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdsYXlvdXRMYW5lczogaGVpZ2h0cyBncm93IHdpdGggdHJhY2sgY291bnQ7IHRvcHMgc3RhY2s7IHRvdGFscyBhZGQgdXAnLCAoKSA9PiB7XG4gIGNvbnN0IG0gPSB7IHRyYWNrSGVpZ2h0OiAxNiwgdHJhY2tHYXA6IDIsIGxhbmVQYWQ6IDQgfTtcbiAgY29uc3QgeyB0b3BzLCBoZWlnaHRzLCB0b3RhbEhlaWdodCB9ID0gbGF5b3V0TGFuZXMoWzEsIDMsIDFdLCBtKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChoZWlnaHRzLCBbMjQsIDYwLCAyNF0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKHRvcHMsIFswLCAyNCwgODRdKTtcbiAgYXNzZXJ0LmVxdWFsKHRvdGFsSGVpZ2h0LCAxMDgpO1xuICBhc3NlcnQuZXF1YWwodHJhY2tUb3AoMCwgbSksIDQpO1xuICBhc3NlcnQuZXF1YWwodHJhY2tUb3AoMiwgbSksIDQgKyAyICogMTgpO1xufSk7XG5cbnRlc3QoJ2xheW91dExhbmVzOiBhIHplcm8vbmVnYXRpdmUgdHJhY2sgY291bnQgc3RpbGwgeWllbGRzIGEgb25lLXRyYWNrIGxhbmUnLCAoKSA9PiB7XG4gIGNvbnN0IG0gPSB7IHRyYWNrSGVpZ2h0OiAxNiwgdHJhY2tHYXA6IDIsIGxhbmVQYWQ6IDQgfTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChsYXlvdXRMYW5lcyhbMF0sIG0pLmhlaWdodHMsIFsyNF0pO1xufSk7XG5cbnRlc3QoJ2xheW91dExhbmVzL3RyYWNrVG9wOiBwZXItbGFuZSB0cmFjayBoZWlnaHRzIG92ZXJyaWRlIHRoZSBtZXRyaWNzIChjb21wYWN0IGxhbmVzKScsICgpID0+IHtcbiAgY29uc3QgbTogTGFuZU1ldHJpY3MgPSB7IHRyYWNrSGVpZ2h0OiAxOCwgdHJhY2tHYXA6IDIsIGxhbmVQYWQ6IDMgfTtcbiAgY29uc3QgeyB0b3BzLCBoZWlnaHRzLCB0b3RhbEhlaWdodCB9ID0gbGF5b3V0TGFuZXMoWzIsIDNdLCBtLCBbNCwgMThdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChoZWlnaHRzLCBbMTYsIDY0XSk7XG4gIGFzc2VydC5kZWVwRXF1YWwodG9wcywgWzAsIDE2XSk7XG4gIGFzc2VydC5lcXVhbCh0b3RhbEhlaWdodCwgODApO1xuICBhc3NlcnQuZXF1YWwobGFuZUhlaWdodCgyLCBtLCA0KSwgMTYpO1xuICBhc3NlcnQuZXF1YWwobGFuZUhlaWdodCgyLCBtKSwgNDQpO1xuICAvLyBUcmFjayBvZmZzZXRzIHdpdGhpbiBhIGNvbXBhY3QgbGFuZSBzaHJpbmsgd2l0aCB0aGUgdHJhY2sgaGVpZ2h0LlxuICBhc3NlcnQuZXF1YWwodHJhY2tUb3AoMSwgbSwgNCksIDMgKyA0ICsgMik7XG4gIGFzc2VydC5lcXVhbCh0cmFja1RvcCgxLCBtKSwgMyArIDE4ICsgMik7XG59KTtcblxuLy8gLS0gQXV0by1maXQgKGNvbXBhY3QgbGFuZSBkZW1vdGlvbikgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IEZJVF9NOiBMYW5lTWV0cmljcyA9IHsgdHJhY2tIZWlnaHQ6IDE4LCB0cmFja0dhcDogMiwgbGFuZVBhZDogMyB9O1xuXG50ZXN0KCdjb21wdXRlQXV0b0ZpdDogYSBuYXR1cmFsbHkgZml0dGluZyBsYXlvdXQgZGVtb3RlcyBub3RoaW5nJywgKCkgPT4ge1xuICBjb25zdCBjb3VudHMgPSBbMSwgMiwgMV07XG4gIGNvbnN0IG5hdHVyYWwgPSAyNCArIDQ0ICsgMjQ7XG4gIGZvciAoY29uc3QgYXZhaWwgb2YgW25hdHVyYWwsIG5hdHVyYWwgKyAxLCAxMF8wMDBdKSB7XG4gICAgY29uc3QgZml0ID0gY29tcHV0ZUF1dG9GaXQoY291bnRzLCBGSVRfTSwgNCwgYXZhaWwsIDApO1xuICAgIGFzc2VydC5kZWVwRXF1YWwoZml0LmRlbW90ZWQsIFtmYWxzZSwgZmFsc2UsIGZhbHNlXSk7XG4gICAgYXNzZXJ0LmVxdWFsKGZpdC5jb3VudCwgMCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdkZW1vdGlvbk9yZGVyOiB0YWxsZXN0IGZpcnN0OyBlcXVhbCBjb3VudHMgZGVtb3RlIHRoZSBMQVRFUiBsYW5lIGZpcnN0ICh0b3Aga2VlcHMgZGV0YWlsIGxvbmdlc3QpJywgKCkgPT4ge1xuICBhc3NlcnQuZGVlcEVxdWFsKGRlbW90aW9uT3JkZXIoWzIsIDUsIDMsIDVdKSwgWzMsIDEsIDIsIDBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChkZW1vdGlvbk9yZGVyKFsxLCAxLCAxXSksIFsyLCAxLCAwXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZGVtb3Rpb25PcmRlcihbXSksIFtdKTtcbn0pO1xuXG50ZXN0KCdjb21wdXRlQXV0b0ZpdDogZGVtb3RlcyBzdHJpY3RseSB0YWxsZXN0LWZpcnN0IGFuZCBzdG9wcyBhdCB0aGUgZmlyc3QgZml0JywgKCkgPT4ge1xuICBjb25zdCBjb3VudHMgPSBbMiwgNSwgMywgNV07XG4gIGNvbnN0IG9uZSA9IGNvbXB1dGVBdXRvRml0KGNvdW50cywgRklUX00sIDQsIDI1MCwgMCk7XG4gIGFzc2VydC5kZWVwRXF1YWwob25lLmRlbW90ZWQsIFtmYWxzZSwgZmFsc2UsIGZhbHNlLCB0cnVlXSk7XG4gIGFzc2VydC5lcXVhbChvbmUuY291bnQsIDEsICdzdG9wcyBhdCB0aGUgZmlyc3QgZml0dGluZyBjb3VudCcpO1xuICBjb25zdCB0d28gPSBjb21wdXRlQXV0b0ZpdChjb3VudHMsIEZJVF9NLCA0LCAxODAsIDApO1xuICBhc3NlcnQuZGVlcEVxdWFsKHR3by5kZW1vdGVkLCBbZmFsc2UsIHRydWUsIGZhbHNlLCB0cnVlXSk7XG4gIGFzc2VydC5lcXVhbCh0d28uY291bnQsIDIpO1xufSk7XG5cbnRlc3QoJ2NvbXB1dGVBdXRvRml0OiBhbGwtY29tcGFjdCBmYWxsYmFjayB3aGVuIGV2ZW4gZnVsbCBkZW1vdGlvbiBvdmVyZmxvd3MgKGxhbmUgc2Nyb2xsIHRha2VzIG92ZXIpJywgKCkgPT4ge1xuICBjb25zdCBmaXQgPSBjb21wdXRlQXV0b0ZpdChbMSwgMiwgM10sIEZJVF9NLCA0LCAxMCwgMCk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZml0LmRlbW90ZWQsIFt0cnVlLCB0cnVlLCB0cnVlXSk7XG4gIGFzc2VydC5lcXVhbChmaXQuY291bnQsIDMpO1xufSk7XG5cbnRlc3QoJ2NvbXB1dGVBdXRvRml0OiBoeXN0ZXJlc2lzIFx1MjAxNCBib3JkZXJsaW5lIGhlaWdodHMgZG8gbm90IGZsYXAgYWNyb3NzIGppdHRlcmluZyBldmFsdWF0aW9ucycsICgpID0+IHtcbiAgY29uc3QgY291bnRzID0gWzQsIDEsIDFdO1xuICBhc3NlcnQuZXF1YWwoRklUX0hZU1RFUkVTSVNfRlJBQywgMC4xKTtcbiAgbGV0IGNvdW50ID0gY29tcHV0ZUF1dG9GaXQoY291bnRzLCBGSVRfTSwgNCwgMTMwLCAwKS5jb3VudDtcbiAgYXNzZXJ0LmVxdWFsKGNvdW50LCAxKTtcbiAgZm9yIChjb25zdCBhdmFpbCBvZiBbMTMyLCAxMzAsIDEzMywgMTMxLCAxMzIsIDEzNCwgMTMwXSkge1xuICAgIGNvbnN0IGZpdCA9IGNvbXB1dGVBdXRvRml0KGNvdW50cywgRklUX00sIDQsIGF2YWlsLCBjb3VudCk7XG4gICAgYXNzZXJ0LmRlZXBFcXVhbChmaXQuZGVtb3RlZCwgW3RydWUsIGZhbHNlLCBmYWxzZV0sIGBhdmFpbCAke2F2YWlsfSBtdXN0IG5vdCBmbGFwYCk7XG4gICAgY291bnQgPSBmaXQuY291bnQ7XG4gIH1cbiAgY29uc3QgcHJvbW90ZWQgPSBjb21wdXRlQXV0b0ZpdChjb3VudHMsIEZJVF9NLCA0LCAxNTAsIGNvdW50KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChwcm9tb3RlZC5kZW1vdGVkLCBbZmFsc2UsIGZhbHNlLCBmYWxzZV0pO1xuICBhc3NlcnQuZXF1YWwocHJvbW90ZWQuY291bnQsIDApO1xuICAvLyBBbmQgdGhlIGNsZWFuIHN0YXRlIGlzIGFzIHN0YWJsZSBhY3Jvc3MgdGhlIHNhbWUgaml0dGVyLlxuICBsZXQgY2xlYW4gPSAwO1xuICBmb3IgKGNvbnN0IGF2YWlsIG9mIFsxMzQsIDEzMywgMTM3LCAxMzMsIDEzNF0pIHtcbiAgICBjb25zdCBmaXQgPSBjb21wdXRlQXV0b0ZpdChjb3VudHMsIEZJVF9NLCA0LCBhdmFpbCwgY2xlYW4pO1xuICAgIGFzc2VydC5lcXVhbChmaXQuY291bnQsIDAsIGBhdmFpbCAke2F2YWlsfSBtdXN0IG5vdCBkZW1vdGUgYSBmaXR0aW5nIGxheW91dGApO1xuICAgIGNsZWFuID0gZml0LmNvdW50O1xuICB9XG59KTtcblxudGVzdCgnY29tcHV0ZUF1dG9GaXQ6IHN0YWJsZSB1bmRlciBwdXJlIHZpZXdwb3J0IHRyYW5zbGF0aW9uIHdpdGggdW5jaGFuZ2VkIG92ZXJsYXAnLCAoKSA9PiB7XG4gIC8vIExhbmVzOyBldmVyeSBpdGVtIGludGVyc2VjdHMgYm90aCB0cmFuc2xhdGVkIHdpbmRvd3MsIHNvIHRoZVxuICAvLyB2aXNpYmxlLXdpbmRvdyBwYWNraW5nIFx1MjAxNCBhbmQgdGhlcmVmb3JlIHRoZSBmaXQgXHUyMDE0IG11c3QgYmUgaWRlbnRpY2FsLlxuICBjb25zdCBsYW5lQTogUGFja0l0ZW1bXSA9IFtcbiAgICB7IGlkOiAnYTEnLCBzdGFydDogMCwgZW5kOiAxMDAgfSxcbiAgICB7IGlkOiAnYTInLCBzdGFydDogNTAsIGVuZDogMTUwIH0sXG4gICAgeyBpZDogJ2EzJywgc3RhcnQ6IDEyMCwgZW5kOiAzMDAgfSxcbiAgXTtcbiAgY29uc3QgbGFuZUI6IFBhY2tJdGVtW10gPSBbeyBpZDogJ2IxJywgc3RhcnQ6IDAsIGVuZDogNDAwIH1dO1xuICBjb25zdCB3aW5BOiBUaW1lVmlldyA9IHsgc3RhcnQ6IDQwLCBlbmQ6IDE2MCB9O1xuICBjb25zdCB3aW5COiBUaW1lVmlldyA9IHsgc3RhcnQ6IDYwLCBlbmQ6IDE4MCB9O1xuICBjb25zdCBjb3VudHNBID0gW3BhY2tWaXNpYmxlVHJhY2tzKGxhbmVBLCB3aW5BKS50cmFja0NvdW50LCBwYWNrVmlzaWJsZVRyYWNrcyhsYW5lQiwgd2luQSkudHJhY2tDb3VudF07XG4gIGNvbnN0IGNvdW50c0IgPSBbcGFja1Zpc2libGVUcmFja3MobGFuZUEsIHdpbkIpLnRyYWNrQ291bnQsIHBhY2tWaXNpYmxlVHJhY2tzKGxhbmVCLCB3aW5CKS50cmFja0NvdW50XTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChjb3VudHNBLCBjb3VudHNCKTtcbiAgY29uc3QgZml0QSA9IGNvbXB1dGVBdXRvRml0KGNvdW50c0EsIEZJVF9NLCA0LCA1MCwgMCk7XG4gIGNvbnN0IGZpdEIgPSBjb21wdXRlQXV0b0ZpdChjb3VudHNCLCBGSVRfTSwgNCwgNTAsIGZpdEEuY291bnQpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGZpdEEsIGZpdEIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGZpdEEuZGVtb3RlZCwgW3RydWUsIGZhbHNlXSk7XG59KTtcblxudGVzdCgnY29tcHV0ZUF1dG9GaXQ6IHRoZSBjb21wYWN0IGhlaWdodCBmcm9tIHRoZSBDU1MgcHJvcCBkcml2ZXMgdGhlIG1hdGggKGFuZCBjbGFtcHMgdG8gdGhlIG5vcm1hbCBoZWlnaHQpJywgKCkgPT4ge1xuICBjb25zdCBjb3VudHMgPSBbNCwgMV07XG4gIGNvbnN0IGF0NCA9IGNvbXB1dGVBdXRvRml0KGNvdW50cywgRklUX00sIDQsIDYwLCAwKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChhdDQuZGVtb3RlZCwgW3RydWUsIGZhbHNlXSk7XG4gIGFzc2VydC5lcXVhbChsYW5lSGVpZ2h0KDQsIEZJVF9NLCAxMiksIDYwKTtcbiAgY29uc3QgYXQxMiA9IGNvbXB1dGVBdXRvRml0KGNvdW50cywgRklUX00sIDEyLCA2MCwgMCk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYXQxMi5kZW1vdGVkLCBbdHJ1ZSwgdHJ1ZV0pO1xuICAvLyBjb21wYWN0IGFib3ZlIHRoZSBub3JtYWwgaGVpZ2h0IGNsYW1wcyB0byBpdDogemVybyBzYXZpbmdzLCBzYXR1cmF0ZXMuXG4gIGNvbnN0IGNsYW1wZWQgPSBjb21wdXRlQXV0b0ZpdChjb3VudHMsIEZJVF9NLCAyNSwgNjAsIDApO1xuICBhc3NlcnQuZXF1YWwoY2xhbXBlZC5jb3VudCwgMik7XG59KTtcblxudGVzdCgnY29tcHV0ZUF1dG9GaXQ6IHZpc2libGUtd2luZG93IGNvdW50IGNoYW5nZXMgcmUtZXZhbHVhdGUgdGhlIGZpdCBkZXRlcm1pbmlzdGljYWxseScsICgpID0+IHtcbiAgY29uc3QgbWsgPSAobjogbnVtYmVyLCBzOiBudW1iZXIsIGU6IG51bWJlciwgdGFnOiBzdHJpbmcpOiBQYWNrSXRlbVtdID0+XG4gICAgQXJyYXkuZnJvbSh7IGxlbmd0aDogbiB9LCAoXywgaSkgPT4gKHsgaWQ6IGAke3RhZ30ke2l9YCwgc3RhcnQ6IHMsIGVuZDogZSB9KSk7XG4gIGNvbnN0IGxhbmUwID0gWy4uLm1rKDEwLCAwLCAxMDAsICd3JyksIC4uLm1rKDIsIDIwMCwgMzAwLCAneCcpXTtcbiAgY29uc3QgbGFuZTEgPSBbLi4ubWsoMiwgMCwgMTAwLCAneScpLCAuLi5taygxMiwgMjAwLCAzMDAsICd6JyldO1xuICBjb25zdCBlYXJseTogVGltZVZpZXcgPSB7IHN0YXJ0OiAwLCBlbmQ6IDEwMCB9O1xuICBjb25zdCBsYXRlOiBUaW1lVmlldyA9IHsgc3RhcnQ6IDIwMCwgZW5kOiAzMDAgfTtcbiAgY29uc3QgY291bnRzRWFybHkgPSBbcGFja1Zpc2libGVUcmFja3MobGFuZTAsIGVhcmx5KS50cmFja0NvdW50LCBwYWNrVmlzaWJsZVRyYWNrcyhsYW5lMSwgZWFybHkpLnRyYWNrQ291bnRdO1xuICBhc3NlcnQuZGVlcEVxdWFsKGNvdW50c0Vhcmx5LCBbMTAsIDJdKTtcbiAgY29uc3QgZml0RWFybHkgPSBjb21wdXRlQXV0b0ZpdChjb3VudHNFYXJseSwgRklUX00sIDQsIDEyMCwgMCk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZml0RWFybHkuZGVtb3RlZCwgW3RydWUsIGZhbHNlXSk7XG4gIC8vIFRoZSB3aW5kb3cgc2xpZGVzOiB0aGUgZGVtb3Rpb24gaGFuZHMgb2ZmIHRvIHRoZSBOT1ctdGFsbGVzdCBsYW5lLlxuICBjb25zdCBjb3VudHNMYXRlID0gW3BhY2tWaXNpYmxlVHJhY2tzKGxhbmUwLCBsYXRlKS50cmFja0NvdW50LCBwYWNrVmlzaWJsZVRyYWNrcyhsYW5lMSwgbGF0ZSkudHJhY2tDb3VudF07XG4gIGFzc2VydC5kZWVwRXF1YWwoY291bnRzTGF0ZSwgWzIsIDEyXSk7XG4gIGNvbnN0IGZpdExhdGUgPSBjb21wdXRlQXV0b0ZpdChjb3VudHNMYXRlLCBGSVRfTSwgNCwgMTIwLCBmaXRFYXJseS5jb3VudCk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZml0TGF0ZS5kZW1vdGVkLCBbZmFsc2UsIHRydWVdKTtcbiAgLy8gUmUtZXZhbHVhdGluZyB0aGUgc2FtZSBzdGF0ZSBpcyBhIGZpeGVkIHBvaW50IChkZXRlcm1pbmlzbSkuXG4gIGFzc2VydC5kZWVwRXF1YWwoY29tcHV0ZUF1dG9GaXQoY291bnRzTGF0ZSwgRklUX00sIDQsIDEyMCwgZml0TGF0ZS5jb3VudCksIGZpdExhdGUpO1xuICAvLyBHcm93aW5nIHRoZSBob3N0IHByb21vdGVzIGV2ZXJ5dGhpbmcgb25jZSBoZWFkcm9vbSBpcyByZWFsLlxuICBhc3NlcnQuZXF1YWwoY29tcHV0ZUF1dG9GaXQoY291bnRzTGF0ZSwgRklUX00sIDQsIDQwMCwgZml0TGF0ZS5jb3VudCkuY291bnQsIDApO1xufSk7XG5cbi8vIC0tIGZpdFRleHQgLyBpbnN0YW50cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ2ZpdFRleHQ6IGZpdHMsIHRydW5jYXRlcyB3aXRoIGFuIGVsbGlwc2lzLCBvciBzdXBwcmVzc2VzIGVudGlyZWx5JywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoZml0VGV4dCgnYnVpbGQnLCA1MCwgNiksICdidWlsZCcpOyAvLyBDaGFycyBmaXRcbiAgYXNzZXJ0LmVxdWFsKGZpdFRleHQoJ2RlcGxveS1wcm9kdWN0aW9uJywgNjAsIDYpLCBgZGVwbG95LXByJHtFTExJUFNJU31gKTtcbiAgYXNzZXJ0LmVxdWFsKGZpdFRleHQoJ2RlcGxveS1wcm9kdWN0aW9uJywgNjAsIDYpLmxlbmd0aCwgMTApO1xuICBhc3NlcnQuZXF1YWwoZml0VGV4dCgnYWInLCAzMCwgNiksICdhYicpO1xuICBhc3NlcnQuZXF1YWwoZml0VGV4dCgnYWJjZGVmJywgMTcsIDYpLCAnJyk7IC8vIENoYXJzIG1heCBcdTIxOTIgYmVsb3cgbWluQ2hhcnMrMSBcdTIxOTIgaGlkZVxuICBhc3NlcnQuZXF1YWwoZml0VGV4dCgnYWJjZGVmJywgMCwgNiksICcnKTtcbiAgYXNzZXJ0LmVxdWFsKGZpdFRleHQoJycsIDEwMCwgNiksICcnKTtcbiAgYXNzZXJ0LmVxdWFsKGZpdFRleHQoJ2FiYycsIDEwMCwgMCksICcnKTtcbn0pO1xuXG50ZXN0KCdmaXRUZXh0OiBuZXZlciBvdmVyZmxvd3MgdGhlIGF2YWlsYWJsZSB3aWR0aCcsICgpID0+IHtcbiAgY29uc3QgY2hhclcgPSA3O1xuICBmb3IgKGNvbnN0IGF2YWlsIG9mIFswLCA1LCAxMCwgMjEsIDM1LCA3MCwgMjAwXSkge1xuICAgIGNvbnN0IG91dCA9IGZpdFRleHQoJ2EtZmFpcmx5LWxvbmctaW50ZXJ2YWwtbGFiZWwnLCBhdmFpbCwgY2hhclcpO1xuICAgIGFzc2VydC5vayhvdXQubGVuZ3RoICogY2hhclcgPD0gYXZhaWwgfHwgb3V0ID09PSAnJywgYFwiJHtvdXR9XCIgZml0cyBpbiAke2F2YWlsfXB4YCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdpc0luc3RhbnRXaWR0aDogdGhyZXNob2xkIGJlaGF2aW9yJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoaXNJbnN0YW50V2lkdGgoMCksIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoaXNJbnN0YW50V2lkdGgoSU5TVEFOVF9USFJFU0hPTERfUFggLSAwLjAxKSwgdHJ1ZSk7XG4gIGFzc2VydC5lcXVhbChpc0luc3RhbnRXaWR0aChJTlNUQU5UX1RIUkVTSE9MRF9QWCksIGZhbHNlKTtcbiAgYXNzZXJ0LmVxdWFsKGlzSW5zdGFudFdpZHRoKDEwKSwgZmFsc2UpO1xuICBhc3NlcnQuZXF1YWwoaXNJbnN0YW50V2lkdGgoNCwgNiksIHRydWUpOyAvLyBjdXN0b20gdGhyZXNob2xkXG59KTtcblxuLy8gLS0gSGl0IHRlc3RpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnZXhwYW5kSGl0UmVjdDogd2lkZW5zIGEgbmFycm93IHJlY3QgYXJvdW5kIGl0cyBjZW50ZXIsIGtlZXBzIHdpZGUgcmVjdHMnLCAoKSA9PiB7XG4gIGNvbnN0IG5hcnJvdzogSGl0UmVjdCA9IHsgeDogMTAwLCB5OiAxMCwgdzogMSwgaDogMTIgfTtcbiAgY29uc3Qgd2lkZSA9IGV4cGFuZEhpdFJlY3QobmFycm93LCA5KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh3aWRlLCB7IHg6IDk2LCB5OiAxMCwgdzogOSwgaDogMTIgfSk7XG4gIGNvbnN0IGJpZzogSGl0UmVjdCA9IHsgeDogMCwgeTogMCwgdzogNTAsIGg6IDEwIH07XG4gIGFzc2VydC5lcXVhbChleHBhbmRIaXRSZWN0KGJpZywgOSksIGJpZyk7XG59KTtcblxudGVzdCgnaGl0VGVzdFJlY3RzOiB0b3Btb3N0IChsYXN0KSB3aW5zOyBlZGdlcyBpbmNsdXNpdmU7IG1pc3MgPSAtMScsICgpID0+IHtcbiAgY29uc3QgcmVjdHM6IEhpdFJlY3RbXSA9IFtcbiAgICB7IHg6IDAsIHk6IDAsIHc6IDEwMCwgaDogMjAgfSxcbiAgICB7IHg6IDUwLCB5OiAwLCB3OiAxMDAsIGg6IDIwIH0sXG4gIF07XG4gIGFzc2VydC5lcXVhbChoaXRUZXN0UmVjdHMoNzUsIDEwLCByZWN0cyksIDEpO1xuICBhc3NlcnQuZXF1YWwoaGl0VGVzdFJlY3RzKDI1LCAxMCwgcmVjdHMpLCAwKTtcbiAgYXNzZXJ0LmVxdWFsKGhpdFRlc3RSZWN0cygwLCAwLCByZWN0cyksIDApO1xuICBhc3NlcnQuZXF1YWwoaGl0VGVzdFJlY3RzKDE1MCwgMjAsIHJlY3RzKSwgMSk7XG4gIGFzc2VydC5lcXVhbChoaXRUZXN0UmVjdHMoMzAwLCAxMCwgcmVjdHMpLCAtMSk7XG59KTtcblxudGVzdCgnaGl0LXRlc3RpbmcgYW4gaW5zdGFudDogdGhlIGV4cGFuZGVkIHJlY3QgY2F0Y2hlcyBuZWFyLW1pc3NlcycsICgpID0+IHtcbiAgLy8gQSB6ZXJvLXdpZHRoIGluc3RhbnQgYXQgeD0yMDAgZHJhd24gYXMgYSBwaXA6IHZpc3VhbCB+MXB4LCBoaXQgdGFyZ2V0IDlweC5cbiAgY29uc3QgdmlzdWFsOiBIaXRSZWN0ID0geyB4OiAyMDAsIHk6IDQwLCB3OiAwLjUsIGg6IDE0IH07XG4gIGNvbnN0IGhpdCA9IGV4cGFuZEhpdFJlY3QodmlzdWFsLCA5KTtcbiAgYXNzZXJ0LmVxdWFsKGhpdFRlc3RSZWN0cygyMDMsIDQ3LCBbaGl0XSksIDAsICczcHggcmlnaHQgb2YgdGhlIHBpcCBzdGlsbCBoaXRzJyk7XG4gIGFzc2VydC5lcXVhbChoaXRUZXN0UmVjdHMoMTk3LCA0NywgW2hpdF0pLCAwLCAnM3B4IGxlZnQgb2YgdGhlIHBpcCBzdGlsbCBoaXRzJyk7XG4gIGFzc2VydC5lcXVhbChoaXRUZXN0UmVjdHMoMjA2LCA0NywgW2hpdF0pLCAtMSwgJ291dHNpZGUgdGhlIHdpZGVuZWQgdGFyZ2V0IG1pc3NlcycpO1xufSk7XG5cbnRlc3QoJ2Rpc3RTcVRvU2VnbWVudDogaW50ZXJpb3IgcHJvamVjdGlvbiBhbmQgZW5kcG9pbnQgY2xhbXBpbmcnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChkaXN0U3FUb1NlZ21lbnQoNSwgNSwgMCwgMCwgMTAsIDApLCAyNSk7XG4gIGFzc2VydC5lcXVhbChkaXN0U3FUb1NlZ21lbnQoLTMsIDQsIDAsIDAsIDEwLCAwKSwgMjUpO1xuICBhc3NlcnQuZXF1YWwoZGlzdFNxVG9TZWdtZW50KDEzLCA0LCAwLCAwLCAxMCwgMCksIDI1KTsgLy8gY2xhbXBzIHRvIGVuZHBvaW50IGJcbiAgYXNzZXJ0LmVxdWFsKGRpc3RTcVRvU2VnbWVudCg0LCA0LCA0LCA0LCA0LCA0KSwgMCk7IC8vIGRlZ2VuZXJhdGUgc2VnbWVudFxufSk7XG5cbnRlc3QoJ2hpdFRlc3RQb2x5bGluZTogd2l0aGluIHRvbGVyYW5jZSBvZiBhbnkgc2VnbWVudCcsICgpID0+IHtcbiAgY29uc3QgcHRzID0gW1xuICAgIHsgeDogMCwgeTogMCB9LFxuICAgIHsgeDogMTAsIHk6IDAgfSxcbiAgICB7IHg6IDEwLCB5OiAxMCB9LFxuICBdO1xuICBhc3NlcnQuZXF1YWwoaGl0VGVzdFBvbHlsaW5lKDUsIDIsIHB0cywgMyksIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoaGl0VGVzdFBvbHlsaW5lKDEyLCA1LCBwdHMsIDMpLCB0cnVlKTtcbiAgYXNzZXJ0LmVxdWFsKGhpdFRlc3RQb2x5bGluZSg1LCA1LCBwdHMsIDMpLCBmYWxzZSk7XG59KTtcblxuLy8gLS0gY29ubmVjdG9yUm91dGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdjb25uZWN0b3JSb3V0ZTogc3RyYWlnaHQgMi1wb2ludCBzZWdtZW50IHdoZW4gcm93cyBhbGlnbiBnb2luZyBmb3J3YXJkJywgKCkgPT4ge1xuICBjb25zdCBmcm9tOiBIaXRSZWN0ID0geyB4OiAwLCB5OiAxMCwgdzogMjAsIGg6IDEwIH07XG4gIGNvbnN0IHRvOiBIaXRSZWN0ID0geyB4OiA1MCwgeTogMTAsIHc6IDIwLCBoOiAxMCB9O1xuICBhc3NlcnQuZGVlcEVxdWFsKGNvbm5lY3RvclJvdXRlKGZyb20sIHRvKSwgW1xuICAgIHsgeDogMjAsIHk6IDE1IH0sXG4gICAgeyB4OiA1MCwgeTogMTUgfSxcbiAgXSk7XG59KTtcblxudGVzdCgnY29ubmVjdG9yUm91dGU6IGZvcndhcmQgUy1jdXJ2ZSBcdTIwMTQgZXhhY3QgZW5kcG9pbnRzLCBtb25vdG9uaWMgeSwgbWlkIGNyb3NzaW5nJywgKCkgPT4ge1xuICBjb25zdCBmcm9tOiBIaXRSZWN0ID0geyB4OiAwLCB5OiAwLCB3OiAyMCwgaDogMTAgfTtcbiAgY29uc3QgdG86IEhpdFJlY3QgPSB7IHg6IDYwLCB5OiA0MCwgdzogMjAsIGg6IDEwIH07XG4gIGNvbnN0IHB0cyA9IGNvbm5lY3RvclJvdXRlKGZyb20sIHRvLCAyNCk7XG4gIGFzc2VydC5lcXVhbChwdHMubGVuZ3RoLCAyNSk7XG4gIGFzc2VydC5kZWVwRXF1YWwocHRzWzBdLCB7IHg6IDIwLCB5OiA1IH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKHB0c1twdHMubGVuZ3RoIC0gMV0sIHsgeDogNjAsIHk6IDQ1IH0pO1xuICBmb3IgKGxldCBpID0gMTsgaSA8IHB0cy5sZW5ndGg7IGkrKykge1xuICAgIGFzc2VydC5vayhwdHNbaV0ueSA+PSBwdHNbaSAtIDFdLnkgLSAxZS05LCAneSBkZXNjZW5kcyBtb25vdG9uaWNhbGx5IHRvd2FyZCB0aGUgdGFyZ2V0Jyk7XG4gIH1cbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKHB0c1sxMl0ueSAtIDI1KSA8IDFlLTkpO1xufSk7XG5cbnRlc3QoJ2Nvbm5lY3RvclJvdXRlOiBiYWNrd2FyZCB0YXJnZXQgbG9vcHMgb3V0IG9mIHRoZSBzb3VyY2UgYW5kIGludG8gdGhlIHRhcmdldCcsICgpID0+IHtcbiAgY29uc3QgZnJvbTogSGl0UmVjdCA9IHsgeDogMTAwLCB5OiAwLCB3OiA0MCwgaDogMTAgfTtcbiAgY29uc3QgdG86IEhpdFJlY3QgPSB7IHg6IDIwLCB5OiA0MCwgdzogMzAsIGg6IDEwIH07XG4gIGNvbnN0IHB0cyA9IGNvbm5lY3RvclJvdXRlKGZyb20sIHRvLCAzMik7XG4gIGFzc2VydC5kZWVwRXF1YWwocHRzWzBdLCB7IHg6IDE0MCwgeTogNSB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChwdHNbcHRzLmxlbmd0aCAtIDFdLCB7IHg6IDIwLCB5OiA0NSB9KTtcbiAgLy8gTGVhdmVzIHRoZSBzb3VyY2UgcmlnaHR3YXJkIGFuZCBlbnRlcnMgdGhlIHRhcmdldCBsZWZ0d2FyZC5cbiAgYXNzZXJ0Lm9rKHB0c1sxXS54ID4gMTQwLCAnZXhpdHMgZm9yd2FyZCcpO1xuICBhc3NlcnQub2socHRzW3B0cy5sZW5ndGggLSAyXS54IDwgMjAsICdlbnRlcnMgYmFja3dhcmQnKTtcbiAgLy8gU3RheXMgd2l0aGluIHRoZSBjb250cm9sLWhhbmRsZSBlbnZlbG9wZS5cbiAgY29uc3QgYyA9IDkwO1xuICBmb3IgKGNvbnN0IHAgb2YgcHRzKSB7XG4gICAgYXNzZXJ0Lm9rKHAueCA+PSAyMCAtIGMgLSAxZS05ICYmIHAueCA8PSAxNDAgKyBjICsgMWUtOSk7XG4gICAgYXNzZXJ0Lm9rKHAueSA+PSA1IC0gMWUtOSAmJiBwLnkgPD0gNDUgKyAxZS05KTtcbiAgfVxufSk7XG5cbi8vIC0tIENhdGVnb3J5IGh1ZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnaGFzaFN0cmluZzogc3RhYmxlIHB1Ymxpc2hlZCB2YWx1ZXMgKEZOVi0xYSknLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChoYXNoU3RyaW5nKCcnKSwgMHg4MTFjOWRjNSk7XG4gIGFzc2VydC5lcXVhbChoYXNoU3RyaW5nKCdhJyksIDB4ZTQwYzI5MmMpO1xuICBhc3NlcnQuZXF1YWwoaGFzaFN0cmluZygnZm9vYmFyJyksIDB4YmY5Y2Y5NjgpO1xufSk7XG5cbnRlc3QoJ2NhdGVnb3J5SHVlOiBkZXRlcm1pbmlzdGljLCBpbiBbMCwgMzYwKScsICgpID0+IHtcbiAgY29uc3QgbmFtZXMgPSBbJ2J1aWxkJywgJ2RlcGxveScsICd0ZXN0JywgJ2xpbnQnLCAncmVsZWFzZScsICdkYicsICdjYWNoZScsICdhcGknXTtcbiAgZm9yIChjb25zdCBuIG9mIG5hbWVzKSB7XG4gICAgY29uc3QgaCA9IGNhdGVnb3J5SHVlKG4pO1xuICAgIGFzc2VydC5lcXVhbChoLCBjYXRlZ29yeUh1ZShuKSwgYHN0YWJsZSBmb3IgJHtufWApO1xuICAgIGFzc2VydC5vayhoID49IDAgJiYgaCA8IDM2MCAmJiBOdW1iZXIuaXNJbnRlZ2VyKGgpLCBgaHVlICR7aH0gdmFsaWQgZm9yICR7bn1gKTtcbiAgfVxufSk7XG5cbnRlc3QoJ2NhdGVnb3J5SHVlOiBzdGFibGUgcHVibGlzaGVkIHZhbHVlcyAoYSBjb2xvciBtdXN0IG5ldmVyIGRyaWZ0IGFjcm9zcyBzZXNzaW9ucyknLCAoKSA9PiB7XG4gIC8vIFJlZ3Jlc3Npb24tcGlubmVkOiBpZiBhbnkgb2YgdGhlc2UgbW92ZSwgZXZlcnkgY29uc3VtZXIncyBjb2xvcnMgY2hhbmdlLlxuICBhc3NlcnQuZGVlcEVxdWFsKFxuICAgIFsnYnVpbGQnLCAnZGVwbG95JywgJ3Rlc3QnLCAnbGludCcsICdyZWxlYXNlJywgJ2RiJ10ubWFwKGNhdGVnb3J5SHVlKSxcbiAgICBbNjQsIDg5LCAyNjAsIDcxLCAzMDUsIDI3OV0sXG4gICk7XG59KTtcblxudGVzdCgnY2F0ZWdvcnlIdWU6IGh1ZXMgc3ByZWFkIHJvdWdobHkgdW5pZm9ybWx5IG92ZXIgbWFueSBjYXRlZ29yeSBuYW1lcycsICgpID0+IHtcbiAgY29uc3Qgc2VjdG9ycyA9IG5ldyBBcnJheTxudW1iZXI+KDgpLmZpbGwoMCk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMzIwOyBpKyspIHNlY3RvcnNbTWF0aC5mbG9vcihjYXRlZ29yeUh1ZShgY2F0ZWdvcnktJHtpfWApIC8gNDUpXSsrO1xuICBmb3IgKGxldCBzID0gMDsgcyA8IDg7IHMrKykge1xuICAgIGFzc2VydC5vayhzZWN0b3JzW3NdID49IDIwLCBgc2VjdG9yICR7c30gdW5kZXJwb3B1bGF0ZWQgKCR7c2VjdG9yc1tzXX0vMzIwKWApO1xuICB9XG59KTtcblxudGVzdCgnY2F0ZWdvcnlKaXR0ZXI6IGRldGVybWluaXN0aWMsIGJvdW5kZWQgdG9uZSBvZmZzZXRzJywgKCkgPT4ge1xuICBmb3IgKGNvbnN0IG4gb2YgWydidWlsZCcsICdkZXBsb3knLCAnYScsICcnXSkge1xuICAgIGNvbnN0IGogPSBjYXRlZ29yeUppdHRlcihuKTtcbiAgICBhc3NlcnQuZGVlcEVxdWFsKGosIGNhdGVnb3J5Sml0dGVyKG4pLCBgc3RhYmxlIGZvciAnJHtufSdgKTtcbiAgICBhc3NlcnQub2soTWF0aC5hYnMoai5kbCkgPD0gMC4wNSwgYHxkbHwgYm91bmRlZCBmb3IgJyR7bn0nYCk7XG4gICAgYXNzZXJ0Lm9rKE1hdGguYWJzKGouZGMpIDw9IDAuMDIsIGB8ZGN8IGJvdW5kZWQgZm9yICcke259J2ApO1xuICB9XG4gIC8vIFRoZSBuZWFyLWh1ZSBwYWlyIGZyb20gdGhlIGZpeHR1cmUgc2V0IHNlcGFyYXRlcyBieSB0b25lIGluc3RlYWQuXG4gIGNvbnN0IGEgPSBjYXRlZ29yeUppdHRlcignZGVwbG95Jyk7XG4gIGNvbnN0IGIgPSBjYXRlZ29yeUppdHRlcignbGludCcpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoYS5kbCAtIGIuZGwpID4gMC4wMSwgJ25lYXJieSBodWVzIGdldCBkaXN0aW5jdCBsaWdodG5lc3MnKTtcbn0pO1xuXG50ZXN0KCdjYXRlZ29yeUNvbG9yOiBva2xjaCBhbmQgaHNsIGZvcm1zLCB3aXRoIGFscGhhJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoY2F0ZWdvcnlDb2xvcigyMTApLCAnb2tsY2goMC42MiAwLjExIDIxMCknKTtcbiAgYXNzZXJ0LmVxdWFsKGNhdGVnb3J5Q29sb3IoMjEwLCB7IGFscGhhOiAwLjUgfSksICdva2xjaCgwLjYyIDAuMTEgMjEwIC8gMC41KScpO1xuICBhc3NlcnQuZXF1YWwoY2F0ZWdvcnlDb2xvcigyMTAsIHsgbGlnaHRuZXNzOiAwLjcsIGNocm9tYTogMC4yIH0pLCAnb2tsY2goMC43IDAuMiAyMTApJyk7XG4gIGFzc2VydC5lcXVhbChjYXRlZ29yeUNvbG9yKDEyMCwgeyBtb2RlOiAnaHNsJyB9KSwgJ2hzbCgxMjAsIDM0JSwgNTUlKScpO1xuICBhc3NlcnQuZXF1YWwoY2F0ZWdvcnlDb2xvcigxMjAsIHsgbW9kZTogJ2hzbCcsIGFscGhhOiAwLjI1IH0pLCAnaHNsYSgxMjAsIDM0JSwgNTUlLCAwLjI1KScpO1xufSk7XG5cbnRlc3QoJ0RFRkFVTFRfU1RZTEVTOiB0aGUgcmVxdWlyZWQgYnVpbHQtaW4gdHJlYXRtZW50cyBleGlzdCBhbmQgYWxpYXMnLCAoKSA9PiB7XG4gIGFzc2VydC5kZWVwRXF1YWwoREVGQVVMVF9TVFlMRVMuZmFpbGVkLCBERUZBVUxUX1NUWUxFUy5lbXBoYXNpcyk7XG4gIGFzc2VydC5kZWVwRXF1YWwoREVGQVVMVF9TVFlMRVMucXVldWVkLCBERUZBVUxUX1NUWUxFUy5kaW0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKERFRkFVTFRfU1RZTEVTLndhaXRpbmcsIERFRkFVTFRfU1RZTEVTLmhhdGNoKTtcbiAgYXNzZXJ0LmVxdWFsKERFRkFVTFRfU1RZTEVTLmZhaWxlZC5nbHlwaCwgJ2JhbmcnKTtcbiAgYXNzZXJ0LmVxdWFsKERFRkFVTFRfU1RZTEVTLmZhaWxlZC5ib3JkZXI/LmVtcGhhc2lzLCB0cnVlKTtcbiAgYXNzZXJ0Lm9rKChERUZBVUxUX1NUWUxFUy5mYWlsZWQuYm9yZGVyPy53aWR0aCA/PyAwKSA+PSAyKTtcbiAgLy8gZGltL3F1ZXVlZCBhbmQgaGF0Y2gvd2FpdGluZyBhcmUgRElNTUVEIHJlZ2lvbnM6IHRoZSBlbGVtZW50IHJ1bnMgZXZlcnkgY29sb3IgcGFpbnRlZCBpbnNpZGUgdGhlbSAoZmlsbCwgYm9yZGVyLCBsYWJlbCB0ZXh0KS5cbiAgYXNzZXJ0LmVxdWFsKERFRkFVTFRfU1RZTEVTLmRpbS5kaW1tZWQsIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoREVGQVVMVF9TVFlMRVMuaGF0Y2guZGltbWVkLCB0cnVlKTtcbiAgYXNzZXJ0LmVxdWFsKERFRkFVTFRfU1RZTEVTLmhhdGNoLnBhdHRlcm4sICdoYXRjaCcpO1xuICBhc3NlcnQuZXF1YWwoREVGQVVMVF9TVFlMRVMub3V0bGluZS5wYXR0ZXJuLCAnb3V0bGluZScpO1xufSk7XG5cbnRlc3QoXCJERUZBVUxUX1NUWUxFUzogJ2NhbmNlbGxlZCcgaXMgaG9sbG93ICsgZGFzaGVkLCBkaXN0aW5jdCBmcm9tIEJPVEggZmFpbHVyZSBhbmQgc3VjY2Vzc1wiLCAoKSA9PiB7XG4gIGNvbnN0IGMgPSBERUZBVUxUX1NUWUxFUy5jYW5jZWxsZWQ7XG4gIGFzc2VydC5lcXVhbChjLnBhdHRlcm4sICdvdXRsaW5lJywgJ2hvbGxvdyBib2R5IFx1MjAxNCBuZXZlciBhIHNvbGlkIHN1Y2Nlc3MtbG9vayBiYXInKTtcbiAgYXNzZXJ0Lm9rKChjLmJvcmRlcj8uZGFzaD8ubGVuZ3RoID8/IDApID49IDIsICdkYXNoZWQgd2hvbGUtc3BhbiBib3JkZXInKTtcbiAgYXNzZXJ0Lm5vdEVxdWFsKGMuYm9yZGVyPy5lbXBoYXNpcywgdHJ1ZSwgJ2NhdGVnb3J5IGh1ZSwgbmV2ZXIgdGhlIGZhaWx1cmUgZW1waGFzaXMgY29sb3InKTtcbiAgYXNzZXJ0LmVxdWFsKGMuZ2x5cGggPz8gJ25vbmUnLCAnbm9uZScsICdubyBmYWlsdXJlIGJhbmcgZ2x5cGgnKTtcbiAgLy8gRmFpbHVyZSBrZWVwcyBpdHMgb3duIHVubWlzdGFrYWJsZSBzaWduYXR1cmUuXG4gIGFzc2VydC5lcXVhbChERUZBVUxUX1NUWUxFUy5mYWlsZWQuYm9yZGVyPy5kYXNoLCB1bmRlZmluZWQpO1xufSk7XG5cbi8vIC0tIENvdmVyYWdlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnbWVyZ2VSYW5nZXM6IG1lcmdlcyBvdmVybGFwcyBhbmQgdG91Y2hlcywgZHJvcHMgZW1wdGllcywgc29ydHMnLCAoKSA9PiB7XG4gIGNvbnN0IG1lcmdlZCA9IG1lcmdlUmFuZ2VzKFtcbiAgICB7IHN0YXJ0OiA1MCwgZW5kOiA2MCB9LFxuICAgIHsgc3RhcnQ6IDAsIGVuZDogMTAgfSxcbiAgICB7IHN0YXJ0OiA4LCBlbmQ6IDIwIH0sXG4gICAgeyBzdGFydDogMjAsIGVuZDogMzAgfSxcbiAgICB7IHN0YXJ0OiA5OSwgZW5kOiA5OSB9LFxuICBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChtZXJnZWQsIFtcbiAgICB7IHN0YXJ0OiAwLCBlbmQ6IDMwIH0sXG4gICAgeyBzdGFydDogNTAsIGVuZDogNjAgfSxcbiAgXSk7XG59KTtcblxudGVzdCgnc3VidHJhY3RSYW5nZXM6IGdhcHMgb2YgYSBzcGFuIHZzIGEgY292ZXIgbGlzdCcsICgpID0+IHtcbiAgY29uc3QgY292ZXJzOiBUaW1lUmFuZ2VbXSA9IFtcbiAgICB7IHN0YXJ0OiAxMCwgZW5kOiAyMCB9LFxuICAgIHsgc3RhcnQ6IDMwLCBlbmQ6IDQwIH0sXG4gIF07XG4gIGFzc2VydC5kZWVwRXF1YWwoc3VidHJhY3RSYW5nZXMoeyBzdGFydDogMCwgZW5kOiA1MCB9LCBjb3ZlcnMpLCBbXG4gICAgeyBzdGFydDogMCwgZW5kOiAxMCB9LFxuICAgIHsgc3RhcnQ6IDIwLCBlbmQ6IDMwIH0sXG4gICAgeyBzdGFydDogNDAsIGVuZDogNTAgfSxcbiAgXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoc3VidHJhY3RSYW5nZXMoeyBzdGFydDogMTIsIGVuZDogMTggfSwgY292ZXJzKSwgW10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKHN1YnRyYWN0UmFuZ2VzKHsgc3RhcnQ6IDE1LCBlbmQ6IDM1IH0sIGNvdmVycyksIFt7IHN0YXJ0OiAyMCwgZW5kOiAzMCB9XSk7XG59KTtcblxudGVzdCgnY292ZXJhZ2U6IHJlcXVlc3RzIHRoZSB1bmNvdmVyZWQgcGFzdCwgd2lkZW5lZCB0byB0aGUgbWluIGNodW5rJywgKCkgPT4ge1xuICBjb25zdCBjID0gbmV3IENvdmVyYWdlVHJhY2tlcih7IG1pbkNodW5rTXM6IDFfMDAwIH0pO1xuICBjLmFkZENvdmVyZWQoMTBfMDAwLCAyMF8wMDApO1xuICBjb25zdCByZXEgPSBjLm5leHRSZXF1ZXN0KHsgc3RhcnQ6IDlfNzAwLCBlbmQ6IDE1XzAwMCB9LCAwKTtcbiAgYXNzZXJ0Lm9rKHJlcSwgJ2EgcmVxdWVzdCBpcyBpc3N1ZWQnKTtcbiAgYXNzZXJ0LmVxdWFsKHJlcS5lbmQsIDEwXzAwMCk7XG4gIGFzc2VydC5lcXVhbChyZXEuc3RhcnQsIDlfMDAwKTsgLy8gMzAwbXMgZ2FwIHdpZGVuZWQgdG8gdGhlIDFzIGNodW5rXG59KTtcblxudGVzdCgnY292ZXJhZ2U6IGluLWZsaWdodCByZXF1ZXN0cyBkZWR1cGU7IHNldHRsaW5nIGNvdmVycyBhbmQgcmUtZW5hYmxlcycsICgpID0+IHtcbiAgY29uc3QgYyA9IG5ldyBDb3ZlcmFnZVRyYWNrZXIoeyBtaW5DaHVua01zOiAxXzAwMCB9KTtcbiAgYy5hZGRDb3ZlcmVkKDEwXzAwMCwgMjBfMDAwKTtcbiAgY29uc3QgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiA1XzAwMCwgZW5kOiAxNV8wMDAgfTtcbiAgY29uc3QgcmVxID0gYy5uZXh0UmVxdWVzdCh2aWV3LCAwKTtcbiAgYXNzZXJ0Lm9rKHJlcSk7XG4gIGFzc2VydC5lcXVhbChjLm5leHRSZXF1ZXN0KHZpZXcsIDApLCBudWxsLCAnbm8gc2Vjb25kIHJlcXVlc3Qgd2hpbGUgb25lIGlzIGluIGZsaWdodCcpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGMucGVuZGluZygpLCByZXEpO1xuICBjLnNldHRsZShyZXEsIHsgb2s6IHRydWUgfSk7XG4gIGFzc2VydC5lcXVhbChjLnBlbmRpbmcoKSwgbnVsbCk7XG4gIGFzc2VydC5lcXVhbChjLm5leHRSZXF1ZXN0KHZpZXcsIDApLCBudWxsLCAnZnVsbHkgY292ZXJlZCBcdTIxOTIgbm8gbW9yZSByZXF1ZXN0cycpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGMudW5jb3ZlcmVkSW4oeyBzdGFydDogNV8wMDAsIGVuZDogMTVfMDAwIH0pLCBbXSk7XG4gIGNvbnN0IHdpZGVyOiBUaW1lVmlldyA9IHsgc3RhcnQ6IDJfMDAwLCBlbmQ6IDE1XzAwMCB9O1xuICBjb25zdCByZXEyID0gYy5uZXh0UmVxdWVzdCh3aWRlciwgMCk7XG4gIGFzc2VydC5vayhyZXEyLCAnc2Nyb2xsaW5nIGZ1cnRoZXIgYmFjayByZXF1ZXN0cyB0aGUgbmV3bHkgZXhwb3NlZCBnYXAnKTtcbiAgYXNzZXJ0LmVxdWFsKHJlcTIuZW5kLCByZXEuc3RhcnQpO1xuICBhc3NlcnQuZXF1YWwocmVxMi5zdGFydCwgMl8wMDApO1xufSk7XG5cbnRlc3QoJ2NvdmVyYWdlOiBhIGZ1bGx5IGNvdmVyZWQgdmlld3BvcnQgaXNzdWVzIG5vIHJlcXVlc3QnLCAoKSA9PiB7XG4gIGNvbnN0IGMgPSBuZXcgQ292ZXJhZ2VUcmFja2VyKCk7XG4gIGMuYWRkQ292ZXJlZCgwLCAxMDBfMDAwKTtcbiAgYXNzZXJ0LmVxdWFsKGMubmV4dFJlcXVlc3QoeyBzdGFydDogMTBfMDAwLCBlbmQ6IDkwXzAwMCB9LCAwKSwgbnVsbCk7XG59KTtcblxudGVzdCgnY292ZXJhZ2U6IHJlamVjdGlvbiByZXRyaWVzIG9uIGEgZml4ZWQgY2FkZW5jZSBcdTIwMTQgY29uc3RhbnQgZ2FwLCBubyBjYXAsIG5vIGdpdmUtdXAnLCAoKSA9PiB7XG4gIGNvbnN0IGMgPSBuZXcgQ292ZXJhZ2VUcmFja2VyKHsgbWluQ2h1bmtNczogMV8wMDAsIHJldHJ5TXM6IDJfMDAwIH0pO1xuICBjLmFkZENvdmVyZWQoMTBfMDAwLCAyMF8wMDApO1xuICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDAsIGVuZDogMTVfMDAwIH07XG4gIGFzc2VydC5lcXVhbChjLndhaXRpbmdSZXRyeSgwKSwgZmFsc2UsICdubyByZXRyeSBwZW5kaW5nIGJlZm9yZSBhbnkgZmFpbHVyZScpO1xuICAvLyBNYW55IGNvbnNlY3V0aXZlIGZhaWx1cmVzOiB0aGUgZ2F0ZSByZW9wZW5zIGV4YWN0bHkgMnMgYWZ0ZXIgRVZFUlkgZmFpbHVyZSBcdTIwMTQgdGhlIGRlbGF5IG5ldmVyIGdyb3dzLCBuZXZlciBoaXRzIGEgY2FwLlxuICBsZXQgYXQgPSAwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDUwOyBpKyspIHtcbiAgICBjb25zdCByZXEgPSBjLm5leHRSZXF1ZXN0KHZpZXcsIGF0KTtcbiAgICBhc3NlcnQub2socmVxLCBgYXR0ZW1wdCAke2kgKyAxfSBpcyBpc3N1ZWQgKG5ldmVyIGdpdmVzIHVwKWApO1xuICAgIGFzc2VydC5lcXVhbChjLndhaXRpbmdSZXRyeShhdCksIGZhbHNlLCAnaW4gZmxpZ2h0IGlzIG5vdCBhIHJldHJ5IHdhaXQnKTtcbiAgICBjLnNldHRsZShyZXEsIHsgb2s6IGZhbHNlIH0sIGF0KTtcbiAgICBhc3NlcnQuZXF1YWwoYy5uZXh0UmVxdWVzdCh2aWV3LCBhdCArIDFfOTk5KSwgbnVsbCwgJ2dhdGVkIHdpdGhpbiB0aGUgY2FkZW5jZSB3aW5kb3cnKTtcbiAgICBhc3NlcnQub2soYy53YWl0aW5nUmV0cnkoYXQgKyAxXzk5OSksICdyZXBvcnRzIHRoZSB3YWl0IChrZWVwcyB0aGUgZnJhbWUgbG9vcCBwdW1waW5nKScpO1xuICAgIGFzc2VydC5lcXVhbChjLndhaXRpbmdSZXRyeShhdCArIDJfMDAwKSwgZmFsc2UsICd3YWl0IGVuZHMgZXhhY3RseSBhdCB0aGUgY2FkZW5jZSBib3VuZGFyeScpO1xuICAgIGF0ICs9IDJfMDAwO1xuICB9XG4gIGNvbnN0IHIgPSBjLm5leHRSZXF1ZXN0KHZpZXcsIGF0KTtcbiAgYXNzZXJ0Lm9rKHIsICdhdHRlbXB0IDUxIGZpcmVzIGV4YWN0bHkgb25lIGNhZGVuY2Ugc3RlcCBhZnRlciB0aGUgNTB0aCBmYWlsdXJlJyk7XG4gIGMuc2V0dGxlKHIsIHsgb2s6IHRydWUgfSk7XG4gIGFzc2VydC5lcXVhbChjLndhaXRpbmdSZXRyeShhdCksIGZhbHNlLCAnc3VjY2VzcyBjbGVhcnMgdGhlIHJldHJ5IHdhaXQnKTtcbiAgY29uc3QgcjIgPSBjLm5leHRSZXF1ZXN0KHsgc3RhcnQ6IC01XzAwMCwgZW5kOiAxXzAwMCB9LCBhdCk7XG4gIGFzc2VydC5vayhyMiwgJ2FmdGVyIGEgc3VjY2VzcyB0aGUgbmV4dCBnYXAgaXMgcmVxdWVzdGVkIGltbWVkaWF0ZWx5Jyk7XG59KTtcblxudGVzdCgnY292ZXJhZ2U6IGV4aGF1c3RlZCBwaW5zIHRoZSBoaXN0b3J5IGJvdW5kYXJ5OyBub3RoaW5nIGJlbG93IGlzIHJlcXVlc3RlZCcsICgpID0+IHtcbiAgY29uc3QgYyA9IG5ldyBDb3ZlcmFnZVRyYWNrZXIoeyBtaW5DaHVua01zOiAxXzAwMCB9KTtcbiAgYy5hZGRDb3ZlcmVkKDEwXzAwMCwgMjBfMDAwKTtcbiAgY29uc3QgcmVxID0gYy5uZXh0UmVxdWVzdCh7IHN0YXJ0OiA0XzAwMCwgZW5kOiAxNV8wMDAgfSwgMCk7XG4gIGFzc2VydC5vayhyZXEpO1xuICBjLnNldHRsZShyZXEsIHsgb2s6IHRydWUsIGV4aGF1c3RlZDogdHJ1ZSB9KTtcbiAgYXNzZXJ0LmVxdWFsKGMuZXhoYXVzdGVkQmVmb3JlLCByZXEuc3RhcnQpO1xuICBhc3NlcnQuZXF1YWwoYy5uZXh0UmVxdWVzdCh7IHN0YXJ0OiAwLCBlbmQ6IDE1XzAwMCB9LCAxMCksIG51bGwsICdubyByZXF1ZXN0cyBiZWxvdyB0aGUgYm91bmRhcnknKTtcbiAgLy8gdW5jb3ZlcmVkSW4gY2xpcHMgYXQgdGhlIGJvdW5kYXJ5IHRvbzogbm90aGluZyBcImxvYWRpbmdcIiBiZWZvcmUgaGlzdG9yeS5cbiAgYXNzZXJ0LmRlZXBFcXVhbChjLnVuY292ZXJlZEluKHsgc3RhcnQ6IDAsIGVuZDogMTVfMDAwIH0pLCBbXSk7XG59KTtcblxudGVzdCgnY292ZXJhZ2U6IHNldHRsZSB3aXRoIGEgc3RhbGUvdW5rbm93biByYW5nZSBpcyBhIG5vLW9wJywgKCkgPT4ge1xuICBjb25zdCBjID0gbmV3IENvdmVyYWdlVHJhY2tlcih7IG1pbkNodW5rTXM6IDFfMDAwIH0pO1xuICBjLmFkZENvdmVyZWQoMTBfMDAwLCAyMF8wMDApO1xuICBjb25zdCByZXEgPSBjLm5leHRSZXF1ZXN0KHsgc3RhcnQ6IDAsIGVuZDogMTVfMDAwIH0sIDApO1xuICBhc3NlcnQub2socmVxKTtcbiAgYy5zZXR0bGUoeyBzdGFydDogMSwgZW5kOiAyIH0sIHsgb2s6IHRydWUgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYy5wZW5kaW5nKCksIHJlcSwgJ3RoZSByZWFsIGluLWZsaWdodCByZXF1ZXN0IHN1cnZpdmVzJyk7XG59KTtcblxuLy8gLS0gV2hlZWwgcm91dGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCB3aGVlbCA9IChvdmVyOiBQYXJ0aWFsPFdoZWVsSW5wdXQ+KTogV2hlZWxJbnB1dCA9PiAoe1xuICBkZWx0YVg6IDAsXG4gIGRlbHRhWTogMCxcbiAgZGVsdGFNb2RlOiAwLFxuICBjdHJsS2V5OiBmYWxzZSxcbiAgbWV0YUtleTogZmFsc2UsXG4gIHNoaWZ0S2V5OiBmYWxzZSxcbiAgLi4ub3Zlcixcbn0pO1xuXG4vLyBUaGUgZnVsbCByb3V0aW5nIG1hdHJpeDoge3BsYWluLCBjdHJsLCBtZXRhLCBzaGlmdH0geCB7ZGVsdGFYIG9ubHksIGRlbHRhWVxuLy8gb25seSwgZGlhZ29uYWwgYnkgZG9taW5hbnQgYXhpc30geCB7bGFuZXMgb3ZlcmZsb3csIG5vIG92ZXJmbG93fS5cblxudGVzdCgncm91dGVXaGVlbDogZGVsdGFYIGFsd2F5cyBwYW5zIHRpbWUgKGNvbnN1bWVkKSwgd2l0aCBhbmQgd2l0aG91dCBsYW5lIG92ZXJmbG93JywgKCkgPT4ge1xuICBmb3IgKGNvbnN0IGxhbmVzT3ZlcmZsb3cgb2YgW2ZhbHNlLCB0cnVlXSkge1xuICAgIGNvbnN0IHIgPSByb3V0ZVdoZWVsKHdoZWVsKHsgZGVsdGFYOiAtOCB9KSwgbGFuZXNPdmVyZmxvdyk7XG4gICAgYXNzZXJ0LmRlZXBFcXVhbChyLCB7IHpvb21QeDogMCwgcGFuUHg6IC04LCBsYW5lU2Nyb2xsUHg6IDAsIGNvbnN1bWVkOiB0cnVlIH0pO1xuICB9XG59KTtcblxudGVzdCgncm91dGVXaGVlbDogcGxhaW4gZGVsdGFZIHJvdXRlcyBOT1RISU5HIFx1MjAxNCBwYWdlIHNjcm9sbCB3aW5zIGV2ZW4gb3ZlciBhbiBvdmVyZmxvd2luZyBsYW5lIHN0YWNrJywgKCkgPT4ge1xuICAvLyBUaGUgdmVydGljYWwtc2Nyb2xsIGNvbnRyYWN0OiBhIHZlcnRpY2FsLWRvbWluYW50IG1vZGlmaWVyLWxlc3Mgd2hlZWwgaXNcbiAgLy8gbmV2ZXIgY29uc3VtZWQgQVMgQSBGUkVTSC9JU09MQVRFRCBFVkVOVC5cbiAgZm9yIChjb25zdCBsYW5lc092ZXJmbG93IG9mIFtmYWxzZSwgdHJ1ZV0pIHtcbiAgICBhc3NlcnQuZGVlcEVxdWFsKHJvdXRlV2hlZWwod2hlZWwoeyBkZWx0YVk6IDUgfSksIGxhbmVzT3ZlcmZsb3cpLCB7IHpvb21QeDogMCwgcGFuUHg6IDAsIGxhbmVTY3JvbGxQeDogMCwgY29uc3VtZWQ6IGZhbHNlIH0pO1xuICAgIGFzc2VydC5kZWVwRXF1YWwocm91dGVXaGVlbCh3aGVlbCh7IGRlbHRhWTogLTI0MCB9KSwgbGFuZXNPdmVyZmxvdyksIHsgem9vbVB4OiAwLCBwYW5QeDogMCwgbGFuZVNjcm9sbFB4OiAwLCBjb25zdW1lZDogZmFsc2UgfSk7XG4gIH1cbn0pO1xuXG50ZXN0KCdyb3V0ZVdoZWVsOiBhIEhPUklaT05UQUwtZG9taW5hbnQgZGlhZ29uYWwgcGFucyB0aW1lOyBpdHMgbWlub3IgZGVsdGFZIG51ZGdlcyBvdmVyZmxvd2luZyBsYW5lcycsICgpID0+IHtcbiAgYXNzZXJ0LmRlZXBFcXVhbChyb3V0ZVdoZWVsKHdoZWVsKHsgZGVsdGFYOiAtNiwgZGVsdGFZOiA0IH0pLCB0cnVlKSwgeyB6b29tUHg6IDAsIHBhblB4OiAtNiwgbGFuZVNjcm9sbFB4OiA0LCBjb25zdW1lZDogdHJ1ZSB9KTtcbiAgLy8gTm8gb3ZlcmZsb3c6IGRlbHRhWCBwYW5zIHRpbWUuXG4gIGFzc2VydC5kZWVwRXF1YWwocm91dGVXaGVlbCh3aGVlbCh7IGRlbHRhWDogLTYsIGRlbHRhWTogNCB9KSwgZmFsc2UpLCB7IHpvb21QeDogMCwgcGFuUHg6IC02LCBsYW5lU2Nyb2xsUHg6IDAsIGNvbnN1bWVkOiB0cnVlIH0pO1xufSk7XG5cbnRlc3QoJ3JvdXRlV2hlZWw6IGEgVkVSVElDQUwtZG9taW5hbnQgZGlhZ29uYWwgKHRpZXMgaW5jbHVkZWQpIGJlbG9uZ3MgdG8gdGhlIHBhZ2UnLCAoKSA9PiB7XG4gIGZvciAoY29uc3QgbGFuZXNPdmVyZmxvdyBvZiBbZmFsc2UsIHRydWVdKSB7XG4gICAgLy8gfGR5fCA+IHxkeHw6IHRoZSB3aG9sZSBnZXN0dXJlIGdvZXMgdG8gdGhlIHBhZ2UgXHUyMDE0IHRoZSBtaW5vciBkeCBpc1xuICAgIC8vIG5ldmVyIGhhbGYtYXBwbGllZCBhcyBhIHNpZGV3YXlzIGNoYXJ0IHBhbi5cbiAgICBhc3NlcnQuZGVlcEVxdWFsKHJvdXRlV2hlZWwod2hlZWwoeyBkZWx0YVg6IDMsIGRlbHRhWTogLTkgfSksIGxhbmVzT3ZlcmZsb3cpLCB7XG4gICAgICB6b29tUHg6IDAsXG4gICAgICBwYW5QeDogMCxcbiAgICAgIGxhbmVTY3JvbGxQeDogMCxcbiAgICAgIGNvbnN1bWVkOiBmYWxzZSxcbiAgICB9KTtcbiAgICAvLyBBbiBleGFjdCB0aWUgY291bnRzIGFzIHZlcnRpY2FsOiBvbmx5IGEgaG9yaXpvbnRhbCBnZXN0dXJlIG1heSB0YWtlIHRoZVxuICAgIC8vIGV2ZW50IGF3YXkgZnJvbSBwYWdlIHNjcm9sbGluZy5cbiAgICBhc3NlcnQuZGVlcEVxdWFsKHJvdXRlV2hlZWwod2hlZWwoeyBkZWx0YVg6IDUsIGRlbHRhWTogNSB9KSwgbGFuZXNPdmVyZmxvdyksIHtcbiAgICAgIHpvb21QeDogMCxcbiAgICAgIHBhblB4OiAwLFxuICAgICAgbGFuZVNjcm9sbFB4OiAwLFxuICAgICAgY29uc3VtZWQ6IGZhbHNlLFxuICAgIH0pO1xuICAgIC8vIFplcm8tZGVsdGEgcGxhaW4gdGljazogbm90aGluZyB0byByb3V0ZSwgbm90IGNvbnN1bWVkLlxuICAgIGFzc2VydC5lcXVhbChyb3V0ZVdoZWVsKHdoZWVsKHt9KSwgbGFuZXNPdmVyZmxvdykuY29uc3VtZWQsIGZhbHNlKTtcbiAgfVxufSk7XG5cbnRlc3QoJ3JvdXRlV2hlZWw6IGN0cmwvbWV0YSt3aGVlbCBpcyB6b29tIG9ubHkgKGRlbHRhWCBpZ25vcmVkKSwgYWx3YXlzIGNvbnN1bWVkJywgKCkgPT4ge1xuICBmb3IgKGNvbnN0IG1vZCBvZiBbeyBjdHJsS2V5OiB0cnVlIH0sIHsgbWV0YUtleTogdHJ1ZSB9XSkge1xuICAgIGZvciAoY29uc3QgbGFuZXNPdmVyZmxvdyBvZiBbZmFsc2UsIHRydWVdKSB7XG4gICAgICBhc3NlcnQuZGVlcEVxdWFsKHJvdXRlV2hlZWwod2hlZWwoeyBkZWx0YVg6IC02LCBkZWx0YVk6IC0xMCwgLi4ubW9kIH0pLCBsYW5lc092ZXJmbG93KSwge1xuICAgICAgICB6b29tUHg6IC0xMCxcbiAgICAgICAgcGFuUHg6IDAsXG4gICAgICAgIGxhbmVTY3JvbGxQeDogMCxcbiAgICAgICAgY29uc3VtZWQ6IHRydWUsXG4gICAgICB9KTtcbiAgICAgIGFzc2VydC5kZWVwRXF1YWwocm91dGVXaGVlbCh3aGVlbCh7IGRlbHRhWTogLTEwLCAuLi5tb2QgfSksIGxhbmVzT3ZlcmZsb3cpLCB7XG4gICAgICAgIHpvb21QeDogLTEwLFxuICAgICAgICBwYW5QeDogMCxcbiAgICAgICAgbGFuZVNjcm9sbFB4OiAwLFxuICAgICAgICBjb25zdW1lZDogdHJ1ZSxcbiAgICAgIH0pO1xuICAgICAgLy8gRXZlbiBhIHplcm8tZGVsdGEgdGljayBtaWQtcGluY2ggaXMgY29uc3VtZWQgXHUyMDE0IGEgY3RybC9tZXRhIHN0cmVhbSBtdXN0IG5ldmVyIGxlYWsgYnJvd3NlciBwYWdlLXpvb20uXG4gICAgICBhc3NlcnQuZXF1YWwocm91dGVXaGVlbCh3aGVlbCh7IC4uLm1vZCB9KSwgbGFuZXNPdmVyZmxvdykuY29uc3VtZWQsIHRydWUpO1xuICAgIH1cbiAgfVxufSk7XG5cbnRlc3QoJ3JvdXRlV2hlZWw6IHNoaWZ0K3doZWVsIHBhbnMgdGltZSAodmVydGljYWwgZGVsdGEgd2lucywgZWxzZSBob3Jpem9udGFsKSwgY29uc3VtZWQgd2hlbiBub256ZXJvJywgKCkgPT4ge1xuICBmb3IgKGNvbnN0IGxhbmVzT3ZlcmZsb3cgb2YgW2ZhbHNlLCB0cnVlXSkge1xuICAgIGFzc2VydC5kZWVwRXF1YWwocm91dGVXaGVlbCh3aGVlbCh7IGRlbHRhWTogNywgc2hpZnRLZXk6IHRydWUgfSksIGxhbmVzT3ZlcmZsb3cpLCB7XG4gICAgICB6b29tUHg6IDAsXG4gICAgICBwYW5QeDogNyxcbiAgICAgIGxhbmVTY3JvbGxQeDogMCxcbiAgICAgIGNvbnN1bWVkOiB0cnVlLFxuICAgIH0pO1xuICAgIGFzc2VydC5kZWVwRXF1YWwocm91dGVXaGVlbCh3aGVlbCh7IGRlbHRhWDogMywgc2hpZnRLZXk6IHRydWUgfSksIGxhbmVzT3ZlcmZsb3cpLCB7XG4gICAgICB6b29tUHg6IDAsXG4gICAgICBwYW5QeDogMyxcbiAgICAgIGxhbmVTY3JvbGxQeDogMCxcbiAgICAgIGNvbnN1bWVkOiB0cnVlLFxuICAgIH0pO1xuICAgIGFzc2VydC5kZWVwRXF1YWwocm91dGVXaGVlbCh3aGVlbCh7IGRlbHRhWDogMywgZGVsdGFZOiA3LCBzaGlmdEtleTogdHJ1ZSB9KSwgbGFuZXNPdmVyZmxvdyksIHtcbiAgICAgIHpvb21QeDogMCxcbiAgICAgIHBhblB4OiA3LFxuICAgICAgbGFuZVNjcm9sbFB4OiAwLFxuICAgICAgY29uc3VtZWQ6IHRydWUsXG4gICAgfSk7XG4gICAgYXNzZXJ0LmVxdWFsKHJvdXRlV2hlZWwod2hlZWwoeyBzaGlmdEtleTogdHJ1ZSB9KSwgbGFuZXNPdmVyZmxvdykuY29uc3VtZWQsIGZhbHNlKTtcbiAgfVxufSk7XG5cbnRlc3QoJ3JvdXRlV2hlZWw6IGRlbHRhTW9kZSAxIChsaW5lcykgbm9ybWFsaXplcyB0byBwaXhlbHMgb24gZXZlcnkgcGF0aCcsICgpID0+IHtcbiAgYXNzZXJ0LmRlZXBFcXVhbChyb3V0ZVdoZWVsKHdoZWVsKHsgZGVsdGFYOiAtMiwgZGVsdGFNb2RlOiAxIH0pLCBmYWxzZSksIHsgem9vbVB4OiAwLCBwYW5QeDogLTMyLCBsYW5lU2Nyb2xsUHg6IDAsIGNvbnN1bWVkOiB0cnVlIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKHJvdXRlV2hlZWwod2hlZWwoeyBkZWx0YVg6IC00LCBkZWx0YVk6IDEsIGRlbHRhTW9kZTogMSB9KSwgdHJ1ZSksIHtcbiAgICB6b29tUHg6IDAsXG4gICAgcGFuUHg6IC02NCxcbiAgICBsYW5lU2Nyb2xsUHg6IDE2LFxuICAgIGNvbnN1bWVkOiB0cnVlLFxuICB9KTtcbiAgLy8gRGlzY3JldGUgdmVydGljYWwgd2hlZWw6IGEgcHVyZSBwYXNzdGhyb3VnaCwgb3ZlcmZsb3cgb3Igbm90LlxuICBhc3NlcnQuZGVlcEVxdWFsKHJvdXRlV2hlZWwod2hlZWwoeyBkZWx0YVk6IDMsIGRlbHRhTW9kZTogMSB9KSwgdHJ1ZSksIHsgem9vbVB4OiAwLCBwYW5QeDogMCwgbGFuZVNjcm9sbFB4OiAwLCBjb25zdW1lZDogZmFsc2UgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwocm91dGVXaGVlbCh3aGVlbCh7IGRlbHRhWTogMywgZGVsdGFNb2RlOiAxIH0pLCBmYWxzZSksIHsgem9vbVB4OiAwLCBwYW5QeDogMCwgbGFuZVNjcm9sbFB4OiAwLCBjb25zdW1lZDogZmFsc2UgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwocm91dGVXaGVlbCh3aGVlbCh7IGRlbHRhWTogLTEsIGRlbHRhTW9kZTogMSwgY3RybEtleTogdHJ1ZSB9KSwgZmFsc2UpLCB7XG4gICAgem9vbVB4OiAtMTYsXG4gICAgcGFuUHg6IDAsXG4gICAgbGFuZVNjcm9sbFB4OiAwLFxuICAgIGNvbnN1bWVkOiB0cnVlLFxuICB9KTtcbn0pO1xuXG50ZXN0KCdjbGFzc2lmeVdoZWVsOiBzcG90IGNoZWNrcyBvZiB0aGUgdGhyZWUgY2xhc3NlcycsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKGNsYXNzaWZ5V2hlZWwod2hlZWwoeyBjdHJsS2V5OiB0cnVlIH0pKSwgJ3pvb20nKTsgLy8gZXZlbiB6ZXJvLWRlbHRhIChwaW5jaCBzdHJlYW0pXG4gIGFzc2VydC5lcXVhbChjbGFzc2lmeVdoZWVsKHdoZWVsKHsgbWV0YUtleTogdHJ1ZSwgZGVsdGFZOiA0IH0pKSwgJ3pvb20nKTtcbiAgYXNzZXJ0LmVxdWFsKGNsYXNzaWZ5V2hlZWwod2hlZWwoeyBzaGlmdEtleTogdHJ1ZSwgZGVsdGFZOiA3IH0pKSwgJ3BhbicpO1xuICBhc3NlcnQuZXF1YWwoY2xhc3NpZnlXaGVlbCh3aGVlbCh7IHNoaWZ0S2V5OiB0cnVlLCBkZWx0YVg6IDMgfSkpLCAncGFuJyk7IC8vIEZpcmVmb3ggcHV0cyBzaGlmdC1wYW4gaW4gZGVsdGFYXG4gIGFzc2VydC5lcXVhbChjbGFzc2lmeVdoZWVsKHdoZWVsKHsgc2hpZnRLZXk6IHRydWUgfSkpLCAncGFzc3Rocm91Z2gnKTsgLy8gaW5lcnQgc2hpZnQgdGlja1xuICBhc3NlcnQuZXF1YWwoY2xhc3NpZnlXaGVlbCh3aGVlbCh7IGRlbHRhWDogLTggfSkpLCAncGFuJyk7IC8vIGhvcml6b250YWwtZG9taW5hbnRcbiAgYXNzZXJ0LmVxdWFsKGNsYXNzaWZ5V2hlZWwod2hlZWwoeyBkZWx0YVk6IDEyMCB9KSksICdwYXNzdGhyb3VnaCcpOyAvLyBwbGFpbiB2ZXJ0aWNhbCBcdTIxOTIgdGhlIHBhZ2VcbiAgYXNzZXJ0LmVxdWFsKGNsYXNzaWZ5V2hlZWwod2hlZWwoeyBkZWx0YVg6IDUsIGRlbHRhWTogNSB9KSksICdwYXNzdGhyb3VnaCcpOyAvLyB0aWVzIGFyZSB2ZXJ0aWNhbFxuICBhc3NlcnQuZXF1YWwoY2xhc3NpZnlXaGVlbCh3aGVlbCh7fSkpLCAncGFzc3Rocm91Z2gnKTsgLy8gemVyby1kZWx0YSB1bm1vZGlmaWVkIHRpY2tcbiAgLy8gZGVsdGFNb2RlIG5vcm1hbGl6YXRpb24gaGFwcGVucyBCRUZPUkUgY2xhc3NpZmljYXRpb24uXG4gIGFzc2VydC5lcXVhbChjbGFzc2lmeVdoZWVsKHdoZWVsKHsgZGVsdGFZOiAzLCBkZWx0YU1vZGU6IDEgfSkpLCAncGFzc3Rocm91Z2gnKTtcbiAgYXNzZXJ0LmVxdWFsKGNsYXNzaWZ5V2hlZWwod2hlZWwoeyBkZWx0YVg6IC0yLCBkZWx0YU1vZGU6IDEgfSkpLCAncGFuJyk7XG59KTtcblxudGVzdCgnY2xhc3NpZnlXaGVlbCBcdTIxOTQgcm91dGVXaGVlbCBpbnZhcmlhbnQ6IGNvbnN1bWVkID09PSAoY2xhc3MgIT09IHBhc3N0aHJvdWdoKSwgZm9yIEFMTCBpbnB1dHMgYW5kIG92ZXJmbG93JywgKCkgPT4ge1xuICBjb25zdCBkZWx0YXMgPSBbLTI0MCwgLTE2LCAtNSwgLTEsIDAsIDEsIDUsIDE2LCAyNDAsIE5hTiwgSW5maW5pdHldO1xuICBjb25zdCBtb2RlcyA9IFswLCAxLCAyXTtcbiAgY29uc3QgbW9kcyA9IFtcbiAgICB7fSxcbiAgICB7IGN0cmxLZXk6IHRydWUgfSxcbiAgICB7IG1ldGFLZXk6IHRydWUgfSxcbiAgICB7IHNoaWZ0S2V5OiB0cnVlIH0sXG4gICAgeyBjdHJsS2V5OiB0cnVlLCBzaGlmdEtleTogdHJ1ZSB9LFxuICAgIHsgbWV0YUtleTogdHJ1ZSwgc2hpZnRLZXk6IHRydWUgfSxcbiAgXTtcbiAgbGV0IGNoZWNrZWQgPSAwO1xuICBmb3IgKGNvbnN0IG1vZCBvZiBtb2RzKSB7XG4gICAgZm9yIChjb25zdCBkZWx0YU1vZGUgb2YgbW9kZXMpIHtcbiAgICAgIGZvciAoY29uc3QgZGVsdGFYIG9mIGRlbHRhcykge1xuICAgICAgICBmb3IgKGNvbnN0IGRlbHRhWSBvZiBkZWx0YXMpIHtcbiAgICAgICAgICBjb25zdCBlID0gd2hlZWwoeyBkZWx0YVgsIGRlbHRhWSwgZGVsdGFNb2RlLCAuLi5tb2QgfSk7XG4gICAgICAgICAgY29uc3QgY2xzID0gY2xhc3NpZnlXaGVlbChlKTtcbiAgICAgICAgICBmb3IgKGNvbnN0IGxhbmVzT3ZlcmZsb3cgb2YgW2ZhbHNlLCB0cnVlXSkge1xuICAgICAgICAgICAgY29uc3Qgcm91dGUgPSByb3V0ZVdoZWVsKGUsIGxhbmVzT3ZlcmZsb3cpO1xuICAgICAgICAgICAgYXNzZXJ0LmVxdWFsKFxuICAgICAgICAgICAgICByb3V0ZS5jb25zdW1lZCxcbiAgICAgICAgICAgICAgY2xzICE9PSAncGFzc3Rocm91Z2gnLFxuICAgICAgICAgICAgICBgbWlzbWF0Y2ggYXQgZHg9JHtkZWx0YVh9IGR5PSR7ZGVsdGFZfSBtb2RlPSR7ZGVsdGFNb2RlfSBtb2RzPSR7SlNPTi5zdHJpbmdpZnkobW9kKX0gb3ZlcmZsb3c9JHtsYW5lc092ZXJmbG93fTogY2xhc3M9JHtjbHN9LCBjb25zdW1lZD0ke3JvdXRlLmNvbnN1bWVkfWAsXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgY2hlY2tlZCsrO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBUaGUgY2xhc3MgYWxzbyBuZXZlciBkZXBlbmRzIG9uIG92ZXJmbG93IGJ5IGNvbnN0cnVjdGlvbiAoY2xhc3NpZnlXaGVlbCBoYXMgbm8gb3ZlcmZsb3cgcGFyYW1ldGVyKSBcdTIwMTQuXG4gICAgICAgICAgYXNzZXJ0LmVxdWFsKHJvdXRlV2hlZWwoZSwgZmFsc2UpLmNvbnN1bWVkLCByb3V0ZVdoZWVsKGUsIHRydWUpLmNvbnN1bWVkKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuICBhc3NlcnQub2soY2hlY2tlZCA+PSA2ICogMyAqIDExICogMTEgKiAyLCBgZnVsbCBtYXRyaXggc3dlcHQgKCR7Y2hlY2tlZH0pYCk7XG59KTtcblxuLy8gLS0gV2hlZWwgZ2VzdHVyZSBheGlzIGxvY2sgKHN0cmVhbS1sZXZlbCByb3V0aW5nKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIFdoZWVsR2VzdHVyZVJvdXRlciA9IHRoZSBwZXItZXZlbnQgdGFibGUgYWJvdmUgKyBhIGdlc3R1cmUgYXhpcyBsb2NrXG4vLyBib3VuZGVkIGJ5IFdIRUVMX0dFU1RVUkVfR0FQX01TIG9mIHVubW9kaWZpZWQtd2hlZWwgc2lsZW5jZS4gQWxsIHRlc3RzXG4vLyBkcml2ZSB0aW1lIGV4cGxpY2l0bHkgKHRoZSB0aGlyZCBgcm91dGVgIGFyZ3VtZW50KSBcdTIwMTQgdGhlIHJvdXRlciByZWFkc1xuLy8gbm8gY2xvY2sgb2YgaXRzIG93bi5cblxudGVzdCgnV2hlZWxHZXN0dXJlUm91dGVyOiBhIEZSRVNIIHJvdXRlciByb3V0ZXMgYW55IHNpbmdsZSBldmVudCBleGFjdGx5IGxpa2Ugcm91dGVXaGVlbCAoZnVsbCBtYXRyaXgpJywgKCkgPT4ge1xuICAvLyBUaGUgaXNvbGF0ZWQtZXZlbnQgY29udHJhY3Q6IGdlc3R1cmUgc3RhdGUgb25seSBldmVyIGNoYW5nZXMgd2hhdCBoYXBwZW5zIFdJVEhJTiBhIHN0cmVhbSBcdTIwMTQgdGhlIGZpcnN0IChvciBhIGxvbmUpLlxuICBjb25zdCBkZWx0YXMgPSBbLTI0MCwgLTE2LCAtNSwgLTEsIDAsIDEsIDUsIDE2LCAyNDAsIE5hTiwgSW5maW5pdHldO1xuICBjb25zdCBtb2RlcyA9IFswLCAxLCAyXTtcbiAgY29uc3QgbW9kcyA9IFtcbiAgICB7fSxcbiAgICB7IGN0cmxLZXk6IHRydWUgfSxcbiAgICB7IG1ldGFLZXk6IHRydWUgfSxcbiAgICB7IHNoaWZ0S2V5OiB0cnVlIH0sXG4gICAgeyBjdHJsS2V5OiB0cnVlLCBzaGlmdEtleTogdHJ1ZSB9LFxuICAgIHsgbWV0YUtleTogdHJ1ZSwgc2hpZnRLZXk6IHRydWUgfSxcbiAgXTtcbiAgbGV0IGNoZWNrZWQgPSAwO1xuICBmb3IgKGNvbnN0IG1vZCBvZiBtb2RzKSB7XG4gICAgZm9yIChjb25zdCBkZWx0YU1vZGUgb2YgbW9kZXMpIHtcbiAgICAgIGZvciAoY29uc3QgZGVsdGFYIG9mIGRlbHRhcykge1xuICAgICAgICBmb3IgKGNvbnN0IGRlbHRhWSBvZiBkZWx0YXMpIHtcbiAgICAgICAgICBjb25zdCBlID0gd2hlZWwoeyBkZWx0YVgsIGRlbHRhWSwgZGVsdGFNb2RlLCAuLi5tb2QgfSk7XG4gICAgICAgICAgZm9yIChjb25zdCBsYW5lc092ZXJmbG93IG9mIFtmYWxzZSwgdHJ1ZV0pIHtcbiAgICAgICAgICAgIGNvbnN0IGZyZXNoID0gbmV3IFdoZWVsR2VzdHVyZVJvdXRlcigpO1xuICAgICAgICAgICAgYXNzZXJ0LmRlZXBFcXVhbChcbiAgICAgICAgICAgICAgZnJlc2gucm91dGUoZSwgbGFuZXNPdmVyZmxvdywgMTAwMCksXG4gICAgICAgICAgICAgIHJvdXRlV2hlZWwoZSwgbGFuZXNPdmVyZmxvdyksXG4gICAgICAgICAgICAgIGBmcmVzaC1yb3V0ZXIgbWlzbWF0Y2ggYXQgZHg9JHtkZWx0YVh9IGR5PSR7ZGVsdGFZfSBtb2RlPSR7ZGVsdGFNb2RlfSBtb2RzPSR7SlNPTi5zdHJpbmdpZnkobW9kKX0gb3ZlcmZsb3c9JHtsYW5lc092ZXJmbG93fWAsXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgY2hlY2tlZCsrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuICBhc3NlcnQub2soY2hlY2tlZCA+PSA2ICogMyAqIDExICogMTEgKiAyLCBgZnVsbCBtYXRyaXggc3dlcHQgKCR7Y2hlY2tlZH0pYCk7XG59KTtcblxudGVzdCgnV2hlZWxHZXN0dXJlUm91dGVyOiBoLWxvY2tlZCBzdHJlYW0gY29uc3VtZXMgaXRzIHZlcnRpY2FsLWRvbWluYW50IGppdHRlciBcdTIwMTQgcGFuIGlzIFx1MDNBM2R4LCB0aGUgcGFnZSBnZXRzIG5vdGhpbmcnLCAoKSA9PiB7XG4gIC8vIFRoZSBvcGVyYXRvciBnZXN0dXJlOiBhIG1vc3RseS1ob3Jpem9udGFsIHRyYWNrcGFkIHN3aXBlIHdob3NlIGVkZ2UgL1xuICAvLyBtb21lbnR1bS10YWlsIGV2ZW50cyBhcmUgaW5kaXZpZHVhbGx5IHZlcnRpY2FsLWRvbWluYW50LlxuICBjb25zdCBzdHJlYW06IEFycmF5PFtudW1iZXIsIG51bWJlcl0+ID0gW1xuICAgIFstMTIwLCA4XSxcbiAgICBbLTEyMCwgOF0sXG4gICAgWy00LCAxMl0sIC8vIHZlcnRpY2FsLWRvbWluYW50IGppdHRlcjogcGFzc3Rocm91Z2ggYXMgYSBmcmVzaCBldmVudCwgY29uc3VtZWQgaGVyZVxuICAgIFstMTIwLCA4XSxcbiAgICBbMCwgMTBdLCAvLyBwdXJlLXZlcnRpY2FsIG1vbWVudHVtIHRpY2sgaW5zaWRlIHRoZSBnZXN0dXJlOiBzdGlsbCBjb25zdW1lZFxuICAgIFstMTIwLCA4XSxcbiAgICBbLTQsIDEyXSxcbiAgICBbLTEyMCwgOF0sXG4gIF07XG4gIGNvbnN0IHIgPSBuZXcgV2hlZWxHZXN0dXJlUm91dGVyKCk7XG4gIGxldCB0cyA9IDUwMDA7XG4gIGxldCBwYW4gPSAwO1xuICBmb3IgKGNvbnN0IFtkZWx0YVgsIGRlbHRhWV0gb2Ygc3RyZWFtKSB7XG4gICAgY29uc3Qgcm91dGUgPSByLnJvdXRlKHdoZWVsKHsgZGVsdGFYLCBkZWx0YVkgfSksIGZhbHNlLCB0cyk7XG4gICAgYXNzZXJ0LmVxdWFsKHJvdXRlLmNvbnN1bWVkLCB0cnVlLCBgKCR7ZGVsdGFYfSwgJHtkZWx0YVl9KSBhdCAke3RzfSBtdXN0IGJlIGNvbnN1bWVkIGluc2lkZSB0aGUgaCBnZXN0dXJlYCk7XG4gICAgYXNzZXJ0LmVxdWFsKHJvdXRlLnpvb21QeCwgMCk7XG4gICAgYXNzZXJ0LmVxdWFsKHJvdXRlLmxhbmVTY3JvbGxQeCwgMCwgJ25vIGxhbmUgb3ZlcmZsb3c6IHRoZSBtaW5vciBkeSBpcyBkcm9wcGVkLCBuZXZlciBoYWxmLWZvcndhcmRlZCcpO1xuICAgIHBhbiArPSByb3V0ZS5wYW5QeDtcbiAgICB0cyArPSAxNjtcbiAgfVxuICBhc3NlcnQuZXF1YWwocGFuLCAtMTIwICogNSAtIDQgKiAyLCAncGFuIGVxdWFscyB0aGUgc3VtIG9mIGV2ZXJ5IGV2ZW50XFwncyBkeCwgaml0dGVyIGluY2x1ZGVkJyk7XG59KTtcblxudGVzdCgnV2hlZWxHZXN0dXJlUm91dGVyOiBoLWxvY2tlZCBzdHJlYW0gb3ZlciBvdmVyZmxvd2luZyBsYW5lcyBcdTIwMTQgZHkga2VlcHMgbnVkZ2luZyB0aGUgbGFuZSBzdGFjaywgaml0dGVyIGluY2x1ZGVkJywgKCkgPT4ge1xuICBjb25zdCByID0gbmV3IFdoZWVsR2VzdHVyZVJvdXRlcigpO1xuICBsZXQgdHMgPSAwO1xuICBsZXQgcGFuID0gMDtcbiAgbGV0IGxhbmUgPSAwO1xuICBmb3IgKGNvbnN0IFtkZWx0YVgsIGRlbHRhWV0gb2YgW1xuICAgIFstNjAsIDRdLFxuICAgIFstMywgOV0sIC8vIHZlcnRpY2FsLWRvbWluYW50IGppdHRlclxuICAgIFstNjAsIDRdLFxuICBdIGFzIEFycmF5PFtudW1iZXIsIG51bWJlcl0+KSB7XG4gICAgY29uc3Qgcm91dGUgPSByLnJvdXRlKHdoZWVsKHsgZGVsdGFYLCBkZWx0YVkgfSksIHRydWUsIHRzKTtcbiAgICBhc3NlcnQuZXF1YWwocm91dGUuY29uc3VtZWQsIHRydWUpO1xuICAgIHBhbiArPSByb3V0ZS5wYW5QeDtcbiAgICBsYW5lICs9IHJvdXRlLmxhbmVTY3JvbGxQeDtcbiAgICB0cyArPSAxNjtcbiAgfVxuICBhc3NlcnQuZXF1YWwocGFuLCAtMTIzKTtcbiAgYXNzZXJ0LmVxdWFsKGxhbmUsIDE3LCAndGhlIGggcm91dGVcXCdzIGxhbmVTY3JvbGwgYmVoYXZpb3IgYXBwbGllcyBzdHJlYW0td2lkZSAobGFuZXNPdmVyZmxvdyA/IGR5IDogMCknKTtcbn0pO1xuXG50ZXN0KCdXaGVlbEdlc3R1cmVSb3V0ZXI6IHYtbG9ja2VkIHN0cmVhbSBwYXNzZXMgRVZFUllUSElORyB0aHJvdWdoIFx1MjAxNCBob3Jpem9udGFsIGppdHRlciBuZXZlciBwYW5zIHRoZSBjaGFydCcsICgpID0+IHtcbiAgLy8gVGhlIHN5bW1ldHJpYyBsZWFrOiBhIHBhZ2Ugc2Nyb2xsJ3Mgaml0dGVyeSBtaW5vcml0eSBldmVudHMgYXJlXG4gIC8vIGluZGl2aWR1YWxseSBob3Jpem9udGFsLWRvbWluYW50IGFuZCB1c2VkIHRvIG51ZGdlIHRoZSBjaGFydCBzaWRld2F5cy5cbiAgY29uc3Qgc3RyZWFtOiBBcnJheTxbbnVtYmVyLCBudW1iZXJdPiA9IFtcbiAgICBbMCwgMTIwXSxcbiAgICBbMiwgOTBdLFxuICAgIFstMTIsIDVdLCAvLyBob3Jpem9udGFsLWRvbWluYW50IGppdHRlcjogcGFuIGFzIGEgZnJlc2ggZXZlbnQsIHBhc3N0aHJvdWdoIGhlcmVcbiAgICBbMCwgMTIwXSxcbiAgICBbLTE0LCA2XSxcbiAgICBbMCwgMTIwXSxcbiAgXTtcbiAgY29uc3QgciA9IG5ldyBXaGVlbEdlc3R1cmVSb3V0ZXIoKTtcbiAgbGV0IHRzID0gOTAwMDtcbiAgZm9yIChjb25zdCBbZGVsdGFYLCBkZWx0YVldIG9mIHN0cmVhbSkge1xuICAgIGZvciAoY29uc3QgbGFuZXNPdmVyZmxvdyBvZiBbZmFsc2UsIHRydWVdKSB7XG4gICAgICAvLyBSb3V0aW5nIG11c3Qgbm90IGRlcGVuZCBvbiBvdmVyZmxvdyBlaXRoZXIgd2F5LlxuICAgICAgYXNzZXJ0LmRlZXBFcXVhbChyLnJvdXRlKHdoZWVsKHsgZGVsdGFYLCBkZWx0YVkgfSksIGxhbmVzT3ZlcmZsb3csIHRzKSwge1xuICAgICAgICB6b29tUHg6IDAsXG4gICAgICAgIHBhblB4OiAwLFxuICAgICAgICBsYW5lU2Nyb2xsUHg6IDAsXG4gICAgICAgIGNvbnN1bWVkOiBmYWxzZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICB0cyArPSAxNjtcbiAgfVxufSk7XG5cbnRlc3QoJ1doZWVsR2VzdHVyZVJvdXRlcjogYSBnYXAgb3ZlciBXSEVFTF9HRVNUVVJFX0dBUF9NUyBlbmRzIHRoZSBnZXN0dXJlIFx1MjAxNCB0aGUgbmV4dCBldmVudCBjbGFzc2lmaWVzIGZyZXNoJywgKCkgPT4ge1xuICBjb25zdCByID0gbmV3IFdoZWVsR2VzdHVyZVJvdXRlcigpO1xuICAvLyBoIGdlc3R1cmUuLi5cbiAgYXNzZXJ0LmVxdWFsKHIucm91dGUod2hlZWwoeyBkZWx0YVg6IC0xMjAsIGRlbHRhWTogOCB9KSwgZmFsc2UsIDEwMDApLmNvbnN1bWVkLCB0cnVlKTtcbiAgYXNzZXJ0LmVxdWFsKHIucm91dGUod2hlZWwoeyBkZWx0YVg6IC0xMjAsIGRlbHRhWTogOCB9KSwgZmFsc2UsIDEwMTYpLmNvbnN1bWVkLCB0cnVlKTtcbiAgLy8gLi4ucGF1c2UgMzAwbXMsIHRoZW4gYSB2ZXJ0aWNhbC1kb21pbmFudCBldmVudDogRlJFU0ggXHUyMTkyICd2JyBcdTIxOTIgdGhlIHBhZ2UuXG4gIGFzc2VydC5lcXVhbChyLnJvdXRlKHdoZWVsKHsgZGVsdGFYOiAtNCwgZGVsdGFZOiAxMCB9KSwgZmFsc2UsIDEzMTYpLmNvbnN1bWVkLCBmYWxzZSk7XG4gIC8vIFRoZSBmcmVzaCBldmVudCBsb2NrZWQgJ3YnLlxuICBhc3NlcnQuZXF1YWwoci5yb3V0ZSh3aGVlbCh7IGRlbHRhWDogLTEyLCBkZWx0YVk6IDUgfSksIGZhbHNlLCAxMzMyKS5jb25zdW1lZCwgZmFsc2UpO1xuICAvLyAuLi51bnRpbCBhIHBhdXNlIGZyZWVzIGl0IGFnYWluLlxuICBhc3NlcnQuZXF1YWwoci5yb3V0ZSh3aGVlbCh7IGRlbHRhWDogLTEyLCBkZWx0YVk6IDUgfSksIGZhbHNlLCAxMzMyICsgV0hFRUxfR0VTVFVSRV9HQVBfTVMgKyAxKS5jb25zdW1lZCwgdHJ1ZSk7XG5cbiAgLy8gQm91bmRhcnkgcGluOiBleGFjdGx5IFdIRUVMX0dFU1RVUkVfR0FQX01TIGxhdGVyIGlzIHN0aWxsIHRoZSBzYW1lIGdlc3R1cmU7IG9uZSBtcyBwYXN0IGl0IGlzIGZyZXNoLlxuICBjb25zdCBiID0gbmV3IFdoZWVsR2VzdHVyZVJvdXRlcigpO1xuICBhc3NlcnQuZXF1YWwoYi5yb3V0ZSh3aGVlbCh7IGRlbHRhWDogLTEyMCwgZGVsdGFZOiA4IH0pLCBmYWxzZSwgMjAwMCkuY29uc3VtZWQsIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoYi5yb3V0ZSh3aGVlbCh7IGRlbHRhWDogLTQsIGRlbHRhWTogMTAgfSksIGZhbHNlLCAyMDAwICsgV0hFRUxfR0VTVFVSRV9HQVBfTVMpLmNvbnN1bWVkLCB0cnVlLCAndHMgZGVsdGEgPT0gZ2FwOiBzdGlsbCBsb2NrZWQnKTtcbiAgY29uc3QgYyA9IG5ldyBXaGVlbEdlc3R1cmVSb3V0ZXIoKTtcbiAgYXNzZXJ0LmVxdWFsKGMucm91dGUod2hlZWwoeyBkZWx0YVg6IC0xMjAsIGRlbHRhWTogOCB9KSwgZmFsc2UsIDIwMDApLmNvbnN1bWVkLCB0cnVlKTtcbiAgYXNzZXJ0LmVxdWFsKGMucm91dGUod2hlZWwoeyBkZWx0YVg6IC00LCBkZWx0YVk6IDEwIH0pLCBmYWxzZSwgMjAwMCArIFdIRUVMX0dFU1RVUkVfR0FQX01TICsgMSkuY29uc3VtZWQsIGZhbHNlLCAndHMgZGVsdGEgPiBnYXA6IGZyZXNoJyk7XG59KTtcblxudGVzdCgnV2hlZWxHZXN0dXJlUm91dGVyOiBhIERFQ0lTSVZFIG9wcG9zaXRlLWF4aXMgZXZlbnQgcmUtbG9ja3MgbWlkLWdlc3R1cmUgXHUyMDE0IHByb3BvcnRpb25hbCBqaXR0ZXIgbmV2ZXIgZG9lcycsICgpID0+IHtcbiAgLy8gVGhlIGxvYWQtYmVhcmluZyBjYXNlIChicm93c2VyLXZlcmlmaWVkIG9uIHRob3NlLWNoYXJ0IHNob3djYXNlKTogYSBwYWdlIHNjcm9sbCBjYXJyaWVzIGEgc2Vjb25kIGNoYXJ0IHVuZGVyIHRoZSBjdXJzb3IgbWlkLXN0cmVhbS5cbiAgY29uc3QgciA9IG5ldyBXaGVlbEdlc3R1cmVSb3V0ZXIoKTtcbiAgYXNzZXJ0LmVxdWFsKHIucm91dGUod2hlZWwoeyBkZWx0YVg6IC0xMiwgZGVsdGFZOiA1IH0pLCBmYWxzZSwgMTAwMCkuY29uc3VtZWQsIHRydWUsICdmcmVzaCBoLWRvbWluYW50IGppdHRlciBsb2NrcyBoIChwZXItZXZlbnQgcnVsZSknKTtcbiAgYXNzZXJ0LmVxdWFsKHIucm91dGUod2hlZWwoeyBkZWx0YVk6IDEwMCB9KSwgZmFsc2UsIDEwMTYpLmNvbnN1bWVkLCBmYWxzZSwgJ2RlY2lzaXZlIHZlcnRpY2FsICg+MngsID49MjRweCkgZmxpcHMgdGhlIGxvY2sgdG8gdicpO1xuICBhc3NlcnQuZXF1YWwoci5yb3V0ZSh3aGVlbCh7IGRlbHRhWTogMTAwIH0pLCBmYWxzZSwgMTAzMikuY29uc3VtZWQsIGZhbHNlLCAndGhlIHBhZ2Uga2VlcHMgdGhlIHN0cmVhbScpO1xuICBhc3NlcnQuZXF1YWwoci5yb3V0ZSh3aGVlbCh7IGRlbHRhWDogLTEyLCBkZWx0YVk6IDUgfSksIGZhbHNlLCAxMDQ4KS5jb25zdW1lZCwgZmFsc2UsICdsYXRlciBqaXR0ZXIgaXMgdW5kZXIgdGhlIGZsb29yOiBubyBmbGlwIGJhY2snKTtcblxuICAvLyBTeW1tZXRyaWM6IGEgZGVjaXNpdmUgaG9yaXpvbnRhbCBldmVudCBtaWQtdi1zdHJlYW0gcmVjbGFpbXMgdGhlIGNoYXJ0IHdpdGhvdXQgd2FpdGluZyBvdXQgdGhlIGdhcC5cbiAgY29uc3QgdiA9IG5ldyBXaGVlbEdlc3R1cmVSb3V0ZXIoKTtcbiAgYXNzZXJ0LmVxdWFsKHYucm91dGUod2hlZWwoeyBkZWx0YVk6IDEyMCB9KSwgZmFsc2UsIDIwMDApLmNvbnN1bWVkLCBmYWxzZSk7XG4gIGFzc2VydC5kZWVwRXF1YWwodi5yb3V0ZSh3aGVlbCh7IGRlbHRhWDogLTEyMCwgZGVsdGFZOiA4IH0pLCBmYWxzZSwgMjAxNiksIHtcbiAgICB6b29tUHg6IDAsXG4gICAgcGFuUHg6IC0xMjAsXG4gICAgbGFuZVNjcm9sbFB4OiAwLFxuICAgIGNvbnN1bWVkOiB0cnVlLFxuICB9KTtcblxuICAvLyBUaGUgZmxpcCBuZWVkcyBCT1RIIHRocmVzaG9sZHMgXHUyMDE0IHRoaXMgaXMgd2hhdCBrZWVwcyB0aGUgb3BlcmF0b3IncyBvd24gaml0dGVyIGZyb20gcmUtbGVha2luZzpcbiAgY29uc3QgaCA9IG5ldyBXaGVlbEdlc3R1cmVSb3V0ZXIoKTtcbiAgYXNzZXJ0LmVxdWFsKGgucm91dGUod2hlZWwoeyBkZWx0YVg6IC0xMjAsIGRlbHRhWTogOCB9KSwgZmFsc2UsIDMwMDApLmNvbnN1bWVkLCB0cnVlKTtcbiAgYXNzZXJ0LmVxdWFsKGgucm91dGUod2hlZWwoeyBkZWx0YVg6IC00LCBkZWx0YVk6IDEyIH0pLCBmYWxzZSwgMzAxNikuY29uc3VtZWQsIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoaC5yb3V0ZSh3aGVlbCh7IGRlbHRhWDogLTYwLCBkZWx0YVk6IDEwMCB9KSwgZmFsc2UsIDMwMzIpLmNvbnN1bWVkLCB0cnVlKTtcbiAgLy8gZXhhY3RseSBhdCB0aGUgZmxvb3Igd2l0aCB0aGUgcmF0aW8gXHUyMTkyIGZsaXBzICg+PSBpcyBpbmNsdXNpdmUpLlxuICBhc3NlcnQuZXF1YWwoaC5yb3V0ZSh3aGVlbCh7IGRlbHRhWDogLTQsIGRlbHRhWTogMjQgfSksIGZhbHNlLCAzMDQ4KS5jb25zdW1lZCwgZmFsc2UpO1xufSk7XG5cbnRlc3QoJ1doZWVsR2VzdHVyZVJvdXRlcjogbW9kaWZpZXIgZXZlbnRzIHJvdXRlIGFzIHJvdXRlV2hlZWwgYW5kIG5laXRoZXIgcmVhZCBub3IgZXh0ZW5kIHRoZSBsb2NrJywgKCkgPT4ge1xuICAvLyAoZCkgYSBjdHJsIHpvb20gbWlkLWgtc3RyZWFtOiByb3V0ZXMgZXhhY3RseSBsaWtlIHBlci1ldmVudCByb3V0ZVdoZWVsIChhbHdheXMgY29uc3VtZWQpLCBhbmQgdGhlIGggbG9jayBzdXJ2aXZlcy5cbiAgY29uc3QgciA9IG5ldyBXaGVlbEdlc3R1cmVSb3V0ZXIoKTtcbiAgYXNzZXJ0LmVxdWFsKHIucm91dGUod2hlZWwoeyBkZWx0YVg6IC0xMjAsIGRlbHRhWTogOCB9KSwgZmFsc2UsIDEwMDApLmNvbnN1bWVkLCB0cnVlKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChyLnJvdXRlKHdoZWVsKHsgZGVsdGFZOiAtNDAsIGN0cmxLZXk6IHRydWUgfSksIHRydWUsIDEwMTYpLCB7XG4gICAgem9vbVB4OiAtNDAsXG4gICAgcGFuUHg6IDAsXG4gICAgbGFuZVNjcm9sbFB4OiAwLFxuICAgIGNvbnN1bWVkOiB0cnVlLFxuICB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChyLnJvdXRlKHdoZWVsKHsgZGVsdGFYOiAtNCwgZGVsdGFZOiAxMCB9KSwgZmFsc2UsIDEwMzIpLCB7XG4gICAgem9vbVB4OiAwLFxuICAgIHBhblB4OiAtNCxcbiAgICBsYW5lU2Nyb2xsUHg6IDAsXG4gICAgY29uc3VtZWQ6IHRydWUsXG4gIH0pO1xuXG4gIC8vIC4uLmJ1dCBtb2RpZmllcnMgZG8gbm90IEVYVEVORCB0aGUgZ2VzdHVyZTogYSBwaW5jaCBvdXRsYXN0aW5nIHRoZSBnYXAgaXMgYSByZWFsIHBhdXNlLlxuICBjb25zdCBzID0gbmV3IFdoZWVsR2VzdHVyZVJvdXRlcigpO1xuICBhc3NlcnQuZXF1YWwocy5yb3V0ZSh3aGVlbCh7IGRlbHRhWDogLTEyMCwgZGVsdGFZOiA4IH0pLCBmYWxzZSwgMTAwMCkuY29uc3VtZWQsIHRydWUpO1xuICBmb3IgKGxldCB0cyA9IDEwMTY7IHRzIDw9IDEyNTA7IHRzICs9IDE2KSB7XG4gICAgYXNzZXJ0LmVxdWFsKHMucm91dGUod2hlZWwoeyBkZWx0YVk6IC0xMCwgY3RybEtleTogdHJ1ZSB9KSwgZmFsc2UsIHRzKS5jb25zdW1lZCwgdHJ1ZSk7XG4gIH1cbiAgYXNzZXJ0LmVxdWFsKHMucm91dGUod2hlZWwoeyBkZWx0YVg6IC00LCBkZWx0YVk6IDEwIH0pLCBmYWxzZSwgMTI2NikuY29uc3VtZWQsIGZhbHNlLCAnZ2FwIHNpbmNlIHRoZSBsYXN0IFVOTU9ESUZJRUQgZXZlbnQ6IGZyZXNoIFx1MjE5MiB2Jyk7XG5cbiAgLy8gc2hpZnQtcGFuIG1pZC12LXN0cmVhbSBzdGF5cyBhIGNvbnN1bWVkIHRpbWUgcGFuIHdoaWxlIHRoZSB2IGxvY2sgc3Vydml2ZXMgYXJvdW5kIGl0LlxuICBjb25zdCB2ID0gbmV3IFdoZWVsR2VzdHVyZVJvdXRlcigpO1xuICBhc3NlcnQuZXF1YWwodi5yb3V0ZSh3aGVlbCh7IGRlbHRhWTogMTIwIH0pLCBmYWxzZSwgMzAwMCkuY29uc3VtZWQsIGZhbHNlKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh2LnJvdXRlKHdoZWVsKHsgZGVsdGFZOiA3LCBzaGlmdEtleTogdHJ1ZSB9KSwgZmFsc2UsIDMwMTYpLCB7XG4gICAgem9vbVB4OiAwLFxuICAgIHBhblB4OiA3LFxuICAgIGxhbmVTY3JvbGxQeDogMCxcbiAgICBjb25zdW1lZDogdHJ1ZSxcbiAgfSk7XG4gIGFzc2VydC5lcXVhbCh2LnJvdXRlKHdoZWVsKHsgZGVsdGFYOiAtMTIsIGRlbHRhWTogNSB9KSwgZmFsc2UsIDMwMzIpLmNvbnN1bWVkLCBmYWxzZSwgJ3YgbG9jayBpbnRhY3QgYWNyb3NzIHRoZSBzaGlmdCBldmVudCcpO1xuXG4gIC8vIEFuZCBtb2RpZmllcnMgbmV2ZXIgU1RBUlQgYSBnZXN0dXJlLlxuICBjb25zdCB6ID0gbmV3IFdoZWVsR2VzdHVyZVJvdXRlcigpO1xuICBhc3NlcnQuZXF1YWwoei5yb3V0ZSh3aGVlbCh7IGRlbHRhWTogLTQwLCBjdHJsS2V5OiB0cnVlIH0pLCBmYWxzZSwgNDAwMCkuY29uc3VtZWQsIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoei5yb3V0ZSh3aGVlbCh7IGRlbHRhWDogLTQsIGRlbHRhWTogMTAgfSksIGZhbHNlLCA0MDE2KS5jb25zdW1lZCwgZmFsc2UsICdmcmVzaCBjbGFzc2lmaWNhdGlvbiAodiksIG5vdCBhbiBpbmhlcml0ZWQgbG9jaycpO1xufSk7XG5cbnRlc3QoJ1doZWVsR2VzdHVyZVJvdXRlcjogemVyby1kZWx0YSB1bm1vZGlmaWVkIHRpY2tzIHJvdXRlIG5vdGhpbmcgYW5kIG5laXRoZXIgc3RhcnQsIGV4dGVuZCwgbm9yIHJlc2V0IGEgZ2VzdHVyZScsICgpID0+IHtcbiAgLy8gRnJlc2ggemVybyB0aWNrOiBub3QgY29uc3VtZWQsIG5vIGdlc3R1cmUgYmVndW4uXG4gIGNvbnN0IHIgPSBuZXcgV2hlZWxHZXN0dXJlUm91dGVyKCk7XG4gIGFzc2VydC5kZWVwRXF1YWwoci5yb3V0ZSh3aGVlbCh7fSksIGZhbHNlLCAxMDAwKSwgeyB6b29tUHg6IDAsIHBhblB4OiAwLCBsYW5lU2Nyb2xsUHg6IDAsIGNvbnN1bWVkOiBmYWxzZSB9KTtcblxuICAvLyBaZXJvIHRpY2tzIGluc2lkZSBhbiBoIGdlc3R1cmUgbGVhdmUgdGhlIGxvY2sgaW50YWN0IChubyByZXNldCkuLi5cbiAgYXNzZXJ0LmVxdWFsKHIucm91dGUod2hlZWwoeyBkZWx0YVg6IC0xMjAsIGRlbHRhWTogOCB9KSwgZmFsc2UsIDEwMTYpLmNvbnN1bWVkLCB0cnVlKTtcbiAgYXNzZXJ0LmVxdWFsKHIucm91dGUod2hlZWwoe30pLCBmYWxzZSwgMTAzMikuY29uc3VtZWQsIGZhbHNlKTtcbiAgYXNzZXJ0LmVxdWFsKHIucm91dGUod2hlZWwoeyBkZWx0YVg6IC00LCBkZWx0YVk6IDEwIH0pLCBmYWxzZSwgMTEwMCkuY29uc3VtZWQsIHRydWUsICdsb2NrIGludGFjdCBhY3Jvc3MgdGhlIHplcm8gdGljaycpO1xuXG4gIC8vIC4uLmJ1dCBkbyBub3QgZXh0ZW5kIGl0OiB3aXRoIG9ubHkgemVybyB0aWNrcyBpbnNpZGUgdGhlIGdhcCB3aW5kb3cuXG4gIGNvbnN0IHMgPSBuZXcgV2hlZWxHZXN0dXJlUm91dGVyKCk7XG4gIGFzc2VydC5lcXVhbChzLnJvdXRlKHdoZWVsKHsgZGVsdGFYOiAtMTIwLCBkZWx0YVk6IDggfSksIGZhbHNlLCAyMDAwKS5jb25zdW1lZCwgdHJ1ZSk7XG4gIGFzc2VydC5lcXVhbChzLnJvdXRlKHdoZWVsKHt9KSwgZmFsc2UsIDIwMDAgKyAxODApLmNvbnN1bWVkLCBmYWxzZSk7XG4gIGFzc2VydC5lcXVhbChzLnJvdXRlKHdoZWVsKHsgZGVsdGFYOiAtNCwgZGVsdGFZOiAxMCB9KSwgZmFsc2UsIDIwMDAgKyAxODAgKyBXSEVFTF9HRVNUVVJFX0dBUF9NUykuY29uc3VtZWQsIGZhbHNlKTtcbn0pO1xuXG50ZXN0KCdXaGVlbEdlc3R1cmVSb3V0ZXI6IGRlbHRhTW9kZS1ub3JtYWxpemVkIGNsYXNzaWZpY2F0aW9uIFx1MjAxNCBhIGxpbmUtbW9kZSBzdHJlYW0gbG9ja3MgYW5kIHJvdXRlcyBsaWtlIGl0cyBwaXhlbCBlcXVpdmFsZW50JywgKCkgPT4ge1xuICAvLyAoZSkgY2xhc3NpZmljYXRpb24gYW5kIHJvdXRpbmcgaGFwcGVuIG9uIHdoZWVsRGVsdGFUb1BpeGVscy1ub3JtYWxpemVkIGRlbHRhcy5cbiAgY29uc3QgciA9IG5ldyBXaGVlbEdlc3R1cmVSb3V0ZXIoKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChyLnJvdXRlKHdoZWVsKHsgZGVsdGFYOiAtMiwgZGVsdGFZOiAxLCBkZWx0YU1vZGU6IDEgfSksIHRydWUsIDEwMDApLCB7XG4gICAgem9vbVB4OiAwLFxuICAgIHBhblB4OiAtMzIsXG4gICAgbGFuZVNjcm9sbFB4OiAxNixcbiAgICBjb25zdW1lZDogdHJ1ZSxcbiAgfSk7XG4gIC8vIEEgMS1saW5lIHB1cmUtdmVydGljYWwgdGljayBpbnNpZGUgdGhlIGggZ2VzdHVyZTogY29uc3VtZWQsXG4gIC8vIG5vcm1hbGl6ZWQgdG8gMTZweCBcdTIwMTQgdW5kZXIgdGhlIDI0cHggZmxpcCBmbG9vci5cbiAgYXNzZXJ0LmRlZXBFcXVhbChyLnJvdXRlKHdoZWVsKHsgZGVsdGFZOiAxLCBkZWx0YU1vZGU6IDEgfSksIHRydWUsIDEwMTYpLCB7XG4gICAgem9vbVB4OiAwLFxuICAgIHBhblB4OiAwLFxuICAgIGxhbmVTY3JvbGxQeDogMTYsXG4gICAgY29uc3VtZWQ6IHRydWUsXG4gIH0pO1xuICAvLyBBIDItbGluZSB2ZXJ0aWNhbCB0aWNrIG5vcm1hbGl6ZXMgdG8gMzJweCBcdTIwMTQgb3ZlciB0aGUgZmxvb3IuXG4gIGFzc2VydC5lcXVhbChyLnJvdXRlKHdoZWVsKHsgZGVsdGFZOiAyLCBkZWx0YU1vZGU6IDEgfSksIHRydWUsIDEwMzIpLmNvbnN1bWVkLCBmYWxzZSk7XG4gIC8vIEZyZXNoIGxpbmUtbW9kZSB2ZXJ0aWNhbC1kb21pbmFudCBldmVudCBcdTIxOTIgJ3YnIGxvY2ssIHRoZW4gYSBsaW5lLW1vZGUgaG9yaXpvbnRhbCBqaXR0ZXIgcGFzc2VzIHRocm91Z2guXG4gIGNvbnN0IHYgPSBuZXcgV2hlZWxHZXN0dXJlUm91dGVyKCk7XG4gIGFzc2VydC5lcXVhbCh2LnJvdXRlKHdoZWVsKHsgZGVsdGFZOiAzLCBkZWx0YU1vZGU6IDEgfSksIGZhbHNlLCAyMDAwKS5jb25zdW1lZCwgZmFsc2UpO1xuICBhc3NlcnQuZXF1YWwodi5yb3V0ZSh3aGVlbCh7IGRlbHRhWDogLTEsIGRlbHRhTW9kZTogMSB9KSwgZmFsc2UsIDIwMTYpLmNvbnN1bWVkLCBmYWxzZSwgJ2xpbmUtbW9kZSBoIGppdHRlciBpbnNpZGUgdGhlIHYgZ2VzdHVyZScpO1xufSk7XG5cbi8vIC0tIERpcmVjdGlvbi1hd2FyZSBsYW5lIHNjcm9sbGluZyAodGhlIG5lc3RlZC1zY3JvbGxlciBjb250cmFjdCkgLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBUaGUgTGFuZVNjcm9sbGFibGUgaW5wdXQgZm9ybTogYSB2ZXJ0aWNhbCB3aGVlbCBzY3JvbGxzIGFuIG92ZXJmbG93aW5nIGxhbmVcbi8vIHN0YWNrIElOIFBMQUNFIHdoaWxlIHRoZSBzdGFjayBjYW4gbW92ZSBpbiB0aGUgd2hlZWwncyBkaXJlY3Rpb24sIGFuZFxuLy8gcGFzc2VzIHRvIHRoZSBwYWdlIHRoZSBtb21lbnQgaXQgY2Fubm90IFx1MjAxNCBzbyBhIHRhbGwgbGFuZSBzdGFjayBpcyBmaW5hbGx5XG4vLyB3aGVlbC1zY3JvbGxhYmxlIEFORCB0aGUgcGFnZSBzdGF5cyByZWFjaGFibGUgcGFzdCBpdC4gVGhlIGJvb2xlYW4gZm9ybVxuLy8ga2VlcHMgdGhlIHBpbm5lZCBwYWdlLWFsd2F5cy13aW5zIGJlaGF2aW9yIGJ5dGUtZm9yLWJ5dGUgKGV2ZXJ5IHRlc3QgYWJvdmVcbi8vIHRoaXMgc2VjdGlvbiBydW5zIG9uIGl0LCB1bmNoYW5nZWQpLlxuXG50ZXN0KCdyb3V0ZVdoZWVsOiBkaXJlY3Rpb24tYXdhcmUgbGFuZXMgXHUyMDE0IGEgdmVydGljYWwgd2hlZWwgc2Nyb2xscyB0aGUgc3RhY2sgd2hpbGUgaXQgaGFzIGhlYWRyb29tIHRoYXQgd2F5JywgKCkgPT4ge1xuICAvLyBQYXJrZWQgYXQgdGhlIHRvcCAoaGVhZHJvb20gYmVsb3cpOiB3aGVlbC1kb3duIHNjcm9sbHMgdGhlIHN0YWNrLFxuICAvLyB3aGVlbC11cCBiZWxvbmdzIHRvIHRoZSBwYWdlLlxuICBhc3NlcnQuZGVlcEVxdWFsKHJvdXRlV2hlZWwod2hlZWwoeyBkZWx0YVk6IDkwIH0pLCB7IHVwOiBmYWxzZSwgZG93bjogdHJ1ZSB9KSwge1xuICAgIHpvb21QeDogMCxcbiAgICBwYW5QeDogMCxcbiAgICBsYW5lU2Nyb2xsUHg6IDkwLFxuICAgIGNvbnN1bWVkOiB0cnVlLFxuICB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChyb3V0ZVdoZWVsKHdoZWVsKHsgZGVsdGFZOiAtOTAgfSksIHsgdXA6IGZhbHNlLCBkb3duOiB0cnVlIH0pLCB7XG4gICAgem9vbVB4OiAwLFxuICAgIHBhblB4OiAwLFxuICAgIGxhbmVTY3JvbGxQeDogMCxcbiAgICBjb25zdW1lZDogZmFsc2UsXG4gIH0pO1xuICAvLyBTeW1tZXRyaWMgYXQgdGhlIGJvdHRvbS5cbiAgYXNzZXJ0LmRlZXBFcXVhbChyb3V0ZVdoZWVsKHdoZWVsKHsgZGVsdGFZOiAtOTAgfSksIHsgdXA6IHRydWUsIGRvd246IGZhbHNlIH0pLCB7XG4gICAgem9vbVB4OiAwLFxuICAgIHBhblB4OiAwLFxuICAgIGxhbmVTY3JvbGxQeDogLTkwLFxuICAgIGNvbnN1bWVkOiB0cnVlLFxuICB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChyb3V0ZVdoZWVsKHdoZWVsKHsgZGVsdGFZOiA5MCB9KSwgeyB1cDogdHJ1ZSwgZG93bjogZmFsc2UgfSksIHtcbiAgICB6b29tUHg6IDAsXG4gICAgcGFuUHg6IDAsXG4gICAgbGFuZVNjcm9sbFB4OiAwLFxuICAgIGNvbnN1bWVkOiBmYWxzZSxcbiAgfSk7XG4gIC8vIE5vIGhlYWRyb29tIGF0IGFsbCAoYSBzdGFjayB0aGF0IGZpdHMpOiBpZGVudGljYWwgdG8gdGhlIGJvb2xlYW5cbiAgLy8gZm9ybSBcdTIwMTQgdGhlIHBhZ2Ugb3ducyBldmVyeSB2ZXJ0aWNhbCB3aGVlbC5cbiAgZm9yIChjb25zdCBkeSBvZiBbOTAsIC05MF0pIHtcbiAgICBhc3NlcnQuZXF1YWwocm91dGVXaGVlbCh3aGVlbCh7IGRlbHRhWTogZHkgfSksIHsgdXA6IGZhbHNlLCBkb3duOiBmYWxzZSB9KS5jb25zdW1lZCwgZmFsc2UpO1xuICB9XG4gIC8vIFRoZSBjb25zdW1lZC1ob3Jpem9udGFsIHJvdXRlJ3MgbWlub3ItZHkgbnVkZ2Uga2V5cyBvZmYgT1ZFUkZMT1cgKGVpdGhlclxuICAvLyBkaXJlY3Rpb24pLlxuICBhc3NlcnQuZGVlcEVxdWFsKHJvdXRlV2hlZWwod2hlZWwoeyBkZWx0YVg6IC02MCwgZGVsdGFZOiA0IH0pLCB7IHVwOiBmYWxzZSwgZG93bjogdHJ1ZSB9KSwge1xuICAgIHpvb21QeDogMCxcbiAgICBwYW5QeDogLTYwLFxuICAgIGxhbmVTY3JvbGxQeDogNCxcbiAgICBjb25zdW1lZDogdHJ1ZSxcbiAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwocm91dGVXaGVlbCh3aGVlbCh7IGRlbHRhWDogLTYwLCBkZWx0YVk6IDQgfSksIHsgdXA6IGZhbHNlLCBkb3duOiBmYWxzZSB9KSwge1xuICAgIHpvb21QeDogMCxcbiAgICBwYW5QeDogLTYwLFxuICAgIGxhbmVTY3JvbGxQeDogMCxcbiAgICBjb25zdW1lZDogdHJ1ZSxcbiAgfSk7XG59KTtcblxudGVzdCgnV2hlZWxHZXN0dXJlUm91dGVyOiBhIHYgZ2VzdHVyZSBsYXRjaGVzIGxhbmUtdnMtcGFnZSBmcm9tIHNjcm9sbGFiaWxpdHkgYXQgbG9jayB0aW1lJywgKCkgPT4ge1xuICAvLyBEb3dud2FyZCBoZWFkcm9vbSBhdCBsb2NrIHRpbWU6IHRoZSBXSE9MRSBnZXN0dXJlIGJlbG9uZ3MgdG8gdGhlIHN0YWNrIFx1MjAxNCBpbmNsdWRpbmcgYWZ0ZXIgdGhlIHN0YWNrIHJlcG9ydHMgaXRzIGVkZ2UgbWlkLWdlc3R1cmUuXG4gIGNvbnN0IHIgPSBuZXcgV2hlZWxHZXN0dXJlUm91dGVyKCk7XG4gIGxldCB0cyA9IDEwMDA7XG4gIGFzc2VydC5kZWVwRXF1YWwoci5yb3V0ZSh3aGVlbCh7IGRlbHRhWTogMTAwIH0pLCB7IHVwOiBmYWxzZSwgZG93bjogdHJ1ZSB9LCB0cyksIHtcbiAgICB6b29tUHg6IDAsXG4gICAgcGFuUHg6IDAsXG4gICAgbGFuZVNjcm9sbFB4OiAxMDAsXG4gICAgY29uc3VtZWQ6IHRydWUsXG4gIH0pO1xuICB0cyArPSAxNjtcbiAgYXNzZXJ0LmRlZXBFcXVhbChcbiAgICByLnJvdXRlKHdoZWVsKHsgZGVsdGFZOiAxMDAgfSksIHsgdXA6IHRydWUsIGRvd246IGZhbHNlIH0sIHRzKSxcbiAgICB7IHpvb21QeDogMCwgcGFuUHg6IDAsIGxhbmVTY3JvbGxQeDogMTAwLCBjb25zdW1lZDogdHJ1ZSB9LFxuICAgICdlZGdlIHJlYWNoZWQgbWlkLWdlc3R1cmU6IHN0aWxsIGxhdGNoZWQgdG8gdGhlIHN0YWNrJyxcbiAgKTtcbiAgdHMgKz0gMTY7XG4gIGNvbnN0IGppdHRlciA9IHIucm91dGUod2hlZWwoeyBkZWx0YVg6IC0xMiwgZGVsdGFZOiA1IH0pLCB7IHVwOiB0cnVlLCBkb3duOiBmYWxzZSB9LCB0cyk7XG4gIGFzc2VydC5lcXVhbChqaXR0ZXIuY29uc3VtZWQsIHRydWUsICdoIGppdHRlciB1bmRlciB0aGUgZmxpcCBmbG9vciBzdGF5cyBpbiB0aGUgbGFuZSBnZXN0dXJlJyk7XG4gIGFzc2VydC5lcXVhbChqaXR0ZXIucGFuUHgsIDApO1xuICBhc3NlcnQuZXF1YWwoaml0dGVyLmxhbmVTY3JvbGxQeCwgNSk7XG4gIC8vIEFmdGVyIHRoZSBnZXN0dXJlIGdhcCwgYSBmcmVzaCB3aGVlbC1kb3duIGFnYWluc3QgdGhlIGV4aGF1c3RlZCBzdGFjayBiZWxvbmdzIHRvIHRoZSBwYWdlLlxuICB0cyArPSBXSEVFTF9HRVNUVVJFX0dBUF9NUyArIDE7XG4gIGFzc2VydC5kZWVwRXF1YWwoci5yb3V0ZSh3aGVlbCh7IGRlbHRhWTogMTAwIH0pLCB7IHVwOiB0cnVlLCBkb3duOiBmYWxzZSB9LCB0cyksIHtcbiAgICB6b29tUHg6IDAsXG4gICAgcGFuUHg6IDAsXG4gICAgbGFuZVNjcm9sbFB4OiAwLFxuICAgIGNvbnN1bWVkOiBmYWxzZSxcbiAgfSk7XG4gIC8vIEFuZCBhIHBhZ2UtbGF0Y2hlZCBnZXN0dXJlIG5ldmVyIGdyYWJzIHRoZSBzdGFjayBtaWQtc3RyZWFtLCBldmVuIGlmIGhlYWRyb29tIGFwcGVhcnMgdW5kZXIgaXQgKGEgcmUtbGF5b3V0IG1pZC1zY3JvbGwpLlxuICB0cyArPSAxNjtcbiAgYXNzZXJ0LmVxdWFsKHIucm91dGUod2hlZWwoeyBkZWx0YVk6IDEwMCB9KSwgeyB1cDogdHJ1ZSwgZG93bjogdHJ1ZSB9LCB0cykuY29uc3VtZWQsIGZhbHNlKTtcbiAgdHMgKz0gV0hFRUxfR0VTVFVSRV9HQVBfTVMgKyAxO1xuICBhc3NlcnQuZXF1YWwoci5yb3V0ZSh3aGVlbCh7IGRlbHRhWTogMTAwIH0pLCB7IHVwOiB0cnVlLCBkb3duOiB0cnVlIH0sIHRzKS5jb25zdW1lZCwgdHJ1ZSwgJ2ZyZXNoIGdlc3R1cmUgdGFrZXMgdGhlIG5vdy1zY3JvbGxhYmxlIHN0YWNrJyk7XG59KTtcblxudGVzdCgnV2hlZWxHZXN0dXJlUm91dGVyOiBhIEZSRVNIIHJvdXRlciBlcXVhbHMgcm91dGVXaGVlbCBvbiBkaXJlY3Rpb24tYXdhcmUgaW5wdXRzIHRvbycsICgpID0+IHtcbiAgY29uc3Qgc2Nyb2xscyA9IFtcbiAgICB7IHVwOiBmYWxzZSwgZG93bjogZmFsc2UgfSxcbiAgICB7IHVwOiB0cnVlLCBkb3duOiBmYWxzZSB9LFxuICAgIHsgdXA6IGZhbHNlLCBkb3duOiB0cnVlIH0sXG4gICAgeyB1cDogdHJ1ZSwgZG93bjogdHJ1ZSB9LFxuICBdO1xuICBmb3IgKGNvbnN0IGxhbmVzIG9mIHNjcm9sbHMpIHtcbiAgICBmb3IgKGNvbnN0IGRlbHRhWSBvZiBbLTkwLCAtMSwgMCwgMSwgOTBdKSB7XG4gICAgICBmb3IgKGNvbnN0IGRlbHRhWCBvZiBbMCwgLTQsIDEyMF0pIHtcbiAgICAgICAgY29uc3QgZSA9IHdoZWVsKHsgZGVsdGFYLCBkZWx0YVkgfSk7XG4gICAgICAgIGNvbnN0IGZyZXNoID0gbmV3IFdoZWVsR2VzdHVyZVJvdXRlcigpO1xuICAgICAgICBhc3NlcnQuZGVlcEVxdWFsKFxuICAgICAgICAgIGZyZXNoLnJvdXRlKGUsIGxhbmVzLCA1MDApLFxuICAgICAgICAgIHJvdXRlV2hlZWwoZSwgbGFuZXMpLFxuICAgICAgICAgIGBkeD0ke2RlbHRhWH0gZHk9JHtkZWx0YVl9IGxhbmVzPSR7SlNPTi5zdHJpbmdpZnkobGFuZXMpfWAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICB9XG59KTtcblxuLy8gLS0gTm93LWxpbmUgeCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnbm93TGluZVg6IHJvY2stc3RlYWR5IHdoaWxlIGZvbGxvdy1ub3cgcGlucyB0aGUgdmlldyAodGhlIHdpZ2dsZSByZWdyZXNzaW9uKScsICgpID0+IHtcbiAgLy8gQSBzdGVhZHkgZm9sbG93IHBpbiBob2xkcyBgbm93YCBhdCBhIGZpeGVkIHNwYW4gZnJhY3Rpb24gb2YgdGhlIFJBVyB2aWV3LlxuICBjb25zdCBzcGFuID0gMTUgKiA2MF8wMDA7XG4gIGNvbnN0IGxlYWQgPSAwLjAyO1xuICBjb25zdCBwbG90VyA9IDk5MDtcbiAgY29uc3QgZ3V0dGVyID0gNzMuNDtcbiAgZm9yIChjb25zdCBkcHIgb2YgWzEsIDEuNSwgMiwgM10pIHtcbiAgICBjb25zdCB4cyA9IG5ldyBTZXQ8bnVtYmVyPigpO1xuICAgIGZvciAobGV0IGYgPSAwOyBmIDwgNDAwOyBmKyspIHtcbiAgICAgIGNvbnN0IG5vdyA9IDFfNzUyXzAwMF8wMDBfMDAwICsgZiAqIDE2Ljc7XG4gICAgICBjb25zdCBlbmQgPSBub3cgKyBzcGFuICogbGVhZDtcbiAgICAgIGNvbnN0IHZpZXcgPSB7IHN0YXJ0OiBlbmQgLSBzcGFuLCBlbmQgfTtcbiAgICAgIHhzLmFkZChub3dMaW5lWChub3csIHZpZXcsIGd1dHRlciwgcGxvdFcsIGRwcikpO1xuICAgIH1cbiAgICBhc3NlcnQuZXF1YWwoeHMuc2l6ZSwgMSwgYGRwciAke2Rwcn06IGV4cGVjdGVkIG9uZSBjb25zdGFudCB4LCBzYXcgJHt4cy5zaXplfWApO1xuICB9XG59KTtcblxudGVzdCgnbm93TGluZVg6IGxhbmRzIG9uIHRoZSBoYWxmLWRldmljZS1waXhlbCBncmlkIChjcmlzcCAxcHggc3Ryb2tlKScsICgpID0+IHtcbiAgZm9yIChjb25zdCBkcHIgb2YgWzEsIDEuNSwgMiwgM10pIHtcbiAgICBjb25zdCB2aWV3ID0geyBzdGFydDogMV8wMDBfMDAwLCBlbmQ6IDFfOTAwXzAwMCB9O1xuICAgIGNvbnN0IHggPSBub3dMaW5lWCgxXzQwMF8wMDAsIHZpZXcsIDgwLjI1LCA5ODcuNSwgZHByKTtcbiAgICBjb25zdCBkZXYgPSB4ICogZHByIC0gMC41O1xuICAgIGFzc2VydC5vayhNYXRoLmFicyhkZXYgLSBNYXRoLnJvdW5kKGRldikpIDwgMWUtNiwgYGRwciAke2Rwcn06ICR7eH0gaXMgbm90IG9uIHRoZSBoYWxmLWRldmljZS1weCBncmlkYCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdub3dMaW5lWDogb24gYSBwYXJrZWQgKHN0YXRpYykgdmlldyB0aGUgbGluZSBzdGVwcyB3aG9sZSBkZXZpY2UgcGl4ZWxzIHdpdGggdGhlIGNsb2NrJywgKCkgPT4ge1xuICBjb25zdCB2aWV3ID0geyBzdGFydDogMCwgZW5kOiA5MDBfMDAwIH07XG4gIGNvbnN0IHBsb3RXID0gOTAwO1xuICBjb25zdCBkcHIgPSAyO1xuICBjb25zdCBtc1BlckRldlB4ID0gKHZpZXcuZW5kIC0gdmlldy5zdGFydCkgLyAocGxvdFcgKiBkcHIpO1xuICBjb25zdCB4MCA9IG5vd0xpbmVYKDQ1MF8wMDAsIHZpZXcsIDYwLCBwbG90VywgZHByKTtcbiAgY29uc3QgeDMgPSBub3dMaW5lWCg0NTBfMDAwICsgMyAqIG1zUGVyRGV2UHgsIHZpZXcsIDYwLCBwbG90VywgZHByKTtcbiAgYXNzZXJ0Lm9rKE1hdGguYWJzKHgzIC0gKHgwICsgMyAvIGRwcikpIDwgMWUtOSwgYGV4cGVjdGVkIGV4YWN0bHkgMyBkZXZpY2UgcHggb2YgYWR2YW5jZSwgZ290ICR7eDMgLSB4MH1gKTtcbn0pO1xuXG50ZXN0KCdub3dMaW5lWDogZGVnZW5lcmF0ZSBkcHIgcGFzc2VzIHRoZSB1bnNuYXBwZWQgeCB0aHJvdWdoJywgKCkgPT4ge1xuICBjb25zdCB2aWV3ID0geyBzdGFydDogMCwgZW5kOiAxMDAwIH07XG4gIGFzc2VydC5lcXVhbChub3dMaW5lWCg1MDAsIHZpZXcsIDEwLCAxMDAsIDApLCAxMCArIDUwKTtcbiAgYXNzZXJ0LmVxdWFsKG5vd0xpbmVYKDUwMCwgdmlldywgMTAsIDEwMCwgTmFOKSwgMTAgKyA1MCk7XG59KTtcblxuLy8gLS0gRm9sbG93LW5vdyBydWxlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgbXBweCA9IChzcGFuOiBudW1iZXIsIHBsb3RXID0gMTAwMCwgZHByID0gMSk6IG51bWJlciA9PiBzcGFuIC8gKHBsb3RXICogZHByKTtcblxudGVzdCgnZm9sbG93QWZ0ZXJHZXN0dXJlOiBhIHNtYWxsIGJhY2t3YXJkIFBBTiBkaXNlbmdhZ2VzIGZvbGxvdyAodHJhY2twYWQgcGFubmluZyBtdXN0IGVzY2FwZSBub3cpJywgKCkgPT4ge1xuICBjb25zdCBub3cgPSAxXzAwMF8wMDBfMDAwO1xuICBjb25zdCBzcGFuID0gOTAwXzAwMDtcbiAgLy8gUGlubmVkIHZpZXc6IGVuZCA9IG5vdyArIGxlYWQuXG4gIGNvbnN0IGVuZCA9IG5vdyArIHNwYW4gKiBGT0xMT1dfTEVBRF9GUkFDO1xuICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IGVuZCAtIHNwYW4sIGVuZCB9O1xuICAvLyBPbmUgdHJhY2twYWQgd2hlZWwgc3RlcCBwYW5zIH4xMHMuXG4gIGNvbnN0IG5leHQgPSBwYW5WaWV3KHZpZXcsIC0xMF8wMDApO1xuICBhc3NlcnQuZXF1YWwoZm9sbG93QWZ0ZXJHZXN0dXJlKHRydWUsIHZpZXcuZW5kLCBuZXh0LCBub3csIHRydWUsIG1wcHgoc3BhbikpLCBmYWxzZSwgJ2JhY2t3YXJkIHBhbiBkaXNlbmdhZ2VzJyk7XG4gIC8vIFRoZSBzYW1lIHNoaWZ0IGFzIGEgTk9OLXBhbiB3aGlsZSBhbHJlYWR5IGZvbGxvd2luZyBzdGF5cyBwaW5uZWQuXG4gIGFzc2VydC5lcXVhbChmb2xsb3dBZnRlckdlc3R1cmUodHJ1ZSwgdmlldy5lbmQsIG5leHQsIG5vdywgZmFsc2UsIG1wcHgoc3BhbikpLCB0cnVlKTtcbn0pO1xuXG50ZXN0KCdmb2xsb3dBZnRlckdlc3R1cmU6IGNvbnNlY3V0aXZlIGJhY2t3YXJkIHBhbnMgc3RheSBkaXNlbmdhZ2VkJywgKCkgPT4ge1xuICBjb25zdCBub3cgPSAxXzAwMF8wMDBfMDAwO1xuICBjb25zdCBzcGFuID0gOTAwXzAwMDtcbiAgbGV0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogbm93ICsgc3BhbiAqIEZPTExPV19MRUFEX0ZSQUMgLSBzcGFuLCBlbmQ6IG5vdyArIHNwYW4gKiBGT0xMT1dfTEVBRF9GUkFDIH07XG4gIGxldCBmb2xsb3dpbmcgPSB0cnVlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDU7IGkrKykge1xuICAgIGNvbnN0IG5leHQgPSBwYW5WaWV3KHZpZXcsIC01XzAwMCk7XG4gICAgZm9sbG93aW5nID0gZm9sbG93QWZ0ZXJHZXN0dXJlKGZvbGxvd2luZywgdmlldy5lbmQsIG5leHQsIG5vdywgdHJ1ZSwgbXBweChzcGFuKSk7XG4gICAgYXNzZXJ0LmVxdWFsKGZvbGxvd2luZywgZmFsc2UsIGBzdGVwICR7aX0gbXVzdCBub3QgcmUtZW5nYWdlYCk7XG4gICAgdmlldyA9IG5leHQ7XG4gIH1cbn0pO1xuXG50ZXN0KCdmb2xsb3dBZnRlckdlc3R1cmU6IHJlLWVuZ2FnZXMgYXQgdGhlIGVuZCBzdG9wIFx1MjAxNCBleGFjdGx5IGF0IG5vdywgMSBhbmQgMiBkZXZpY2UgcHggc2hvcnQnLCAoKSA9PiB7XG4gIGNvbnN0IG5vdyA9IDFfMDAwXzAwMF8wMDA7XG4gIGNvbnN0IHNwYW4gPSA5MDBfMDAwO1xuICBjb25zdCBweCA9IG1wcHgoc3Bhbik7XG4gIGNvbnN0IHByZXZFbmQgPSBub3cgLSBzcGFuOyAvLyBwYXJrZWQgd2VsbCBpbiB0aGUgcGFzdCwgcGFubmluZyBmb3J3YXJkXG4gIGZvciAoY29uc3QgZGV2UHggb2YgWzAsIDEsIDJdKSB7XG4gICAgY29uc3QgdjogVGltZVZpZXcgPSB7IHN0YXJ0OiBub3cgLSBkZXZQeCAqIHB4IC0gc3BhbiwgZW5kOiBub3cgLSBkZXZQeCAqIHB4IH07XG4gICAgYXNzZXJ0LmVxdWFsKGZvbGxvd0FmdGVyR2VzdHVyZShmYWxzZSwgcHJldkVuZCwgdiwgbm93LCB0cnVlLCBweCksIHRydWUsIGAke2RldlB4fSBkZXZpY2UgcHggcmUtZW5nYWdlc2ApO1xuICB9XG4gIGFzc2VydC5lcXVhbChGT0xMT1dfU05BUF9ERVZJQ0VfUFgsIDIpO1xufSk7XG5cbnRlc3QoJ2ZvbGxvd0FmdGVyR2VzdHVyZTogZG9lcyBOT1QgcmUtZW5nYWdlIDMrIGRldmljZSBweCBmcm9tIHRoZSBzdG9wIChuZWFyIHRoZSBlZGdlIGlzIG5vdCBhdCB0aGUgZWRnZSknLCAoKSA9PiB7XG4gIGNvbnN0IG5vdyA9IDFfMDAwXzAwMF8wMDA7XG4gIGNvbnN0IHNwYW4gPSA5MDBfMDAwO1xuICBjb25zdCBweCA9IG1wcHgoc3Bhbik7XG4gIGNvbnN0IHByZXZFbmQgPSBub3cgLSBzcGFuO1xuICBmb3IgKGNvbnN0IGRldlB4IG9mIFszLCA0LCAxMCwgMjAwXSkge1xuICAgIGNvbnN0IHY6IFRpbWVWaWV3ID0geyBzdGFydDogbm93IC0gZGV2UHggKiBweCAtIHNwYW4sIGVuZDogbm93IC0gZGV2UHggKiBweCB9O1xuICAgIGFzc2VydC5lcXVhbChmb2xsb3dBZnRlckdlc3R1cmUoZmFsc2UsIHByZXZFbmQsIHYsIG5vdywgdHJ1ZSwgcHgpLCBmYWxzZSwgYCR7ZGV2UHh9IGRldmljZSBweCBzdGF5cyBwdXRgKTtcbiAgfVxuICBjb25zdCBuZWFyRnJhYzogVGltZVZpZXcgPSB7IHN0YXJ0OiBub3cgLSBzcGFuICogMS4wMSwgZW5kOiBub3cgLSBzcGFuICogMC4wMSB9O1xuICBhc3NlcnQuZXF1YWwoZm9sbG93QWZ0ZXJHZXN0dXJlKGZhbHNlLCBwcmV2RW5kLCBuZWFyRnJhYywgbm93LCB0cnVlLCBweCksIGZhbHNlKTtcbn0pO1xuXG50ZXN0KCdmb2xsb3dBZnRlckdlc3R1cmU6IGRldmljZS1waXhlbCBjb252ZXJzaW9uIFx1MjAxNCAyIGRldmljZSBweCBpcyAxIENTUyBweCBhdCBkcHIgMicsICgpID0+IHtcbiAgY29uc3Qgbm93ID0gMV8wMDBfMDAwXzAwMDtcbiAgY29uc3Qgc3BhbiA9IDkwMF8wMDA7XG4gIGNvbnN0IHBsb3RXID0gMTAwMDtcbiAgY29uc3QgY3NzUHggPSBzcGFuIC8gcGxvdFc7IC8vIG1zIHBlciBDU1MgcHhcbiAgY29uc3QgcHJldkVuZCA9IG5vdyAtIHNwYW47XG4gIGFzc2VydC5lcXVhbChcbiAgICBmb2xsb3dBZnRlckdlc3R1cmUoZmFsc2UsIHByZXZFbmQsIHsgc3RhcnQ6IG5vdyAtIDEgKiBjc3NQeCAtIHNwYW4sIGVuZDogbm93IC0gMSAqIGNzc1B4IH0sIG5vdywgdHJ1ZSwgbXBweChzcGFuLCBwbG90VywgMikpLFxuICAgIHRydWUsXG4gICk7XG4gIGFzc2VydC5lcXVhbChcbiAgICBmb2xsb3dBZnRlckdlc3R1cmUoZmFsc2UsIHByZXZFbmQsIHsgc3RhcnQ6IG5vdyAtIDEuNiAqIGNzc1B4IC0gc3BhbiwgZW5kOiBub3cgLSAxLjYgKiBjc3NQeCB9LCBub3csIHRydWUsIG1wcHgoc3BhbiwgcGxvdFcsIDIpKSxcbiAgICBmYWxzZSxcbiAgKTtcbiAgYXNzZXJ0LmVxdWFsKFxuICAgIGZvbGxvd0FmdGVyR2VzdHVyZShmYWxzZSwgcHJldkVuZCwgeyBzdGFydDogbm93IC0gMiAqIGNzc1B4IC0gc3BhbiwgZW5kOiBub3cgLSAyICogY3NzUHggfSwgbm93LCB0cnVlLCBtcHB4KHNwYW4sIHBsb3RXLCAxKSksXG4gICAgdHJ1ZSxcbiAgKTtcbiAgYXNzZXJ0LmVxdWFsKFxuICAgIGZvbGxvd0FmdGVyR2VzdHVyZShmYWxzZSwgcHJldkVuZCwgeyBzdGFydDogbm93IC0gMyAqIGNzc1B4IC0gc3BhbiwgZW5kOiBub3cgLSAzICogY3NzUHggfSwgbm93LCB0cnVlLCBtcHB4KHNwYW4sIHBsb3RXLCAxKSksXG4gICAgZmFsc2UsXG4gICk7XG59KTtcblxudGVzdCgnZm9sbG93QWZ0ZXJHZXN0dXJlOiBhIHNwYW4gY2hhbmdlIGlzIG5vdCBhIHBhbiBcdTIwMTQgd2FzRm9sbG93aW5nPXRydWUgc3RheXMgZW5nYWdlZCcsICgpID0+IHtcbiAgY29uc3Qgbm93ID0gMV8wMDBfMDAwXzAwMDtcbiAgY29uc3Qgc3BhbiA9IDkwMF8wMDA7XG4gIGNvbnN0IGVuZCA9IG5vdyArIHNwYW4gKiBGT0xMT1dfTEVBRF9GUkFDO1xuICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IGVuZCAtIHNwYW4sIGVuZCB9O1xuICBjb25zdCB6b29tZWQgPSB6b29tVmlldyh2aWV3LCBlbmQgLSBzcGFuIC8gMiwgMS4wNSk7IC8vIGFuY2hvciBtaWQtc2NyZWVuOiBlbmQgbW92ZXMgYmFjayBhIGJpdFxuICBhc3NlcnQub2soem9vbWVkLmVuZCA8IHZpZXcuZW5kKTtcbiAgLy8gVGhlIHJhdyBlbmQgbGFuZHMgd2VsbCBvdXRzaWRlIHRoZSAyLWRldmljZS1weCB6b25lIFx1MjAxNCBhIHdhc0ZvbGxvd2luZyBjYWxsZXIgc3Vydml2ZXMgYW55d2F5LlxuICBhc3NlcnQub2soem9vbWVkLmVuZCA8IG5vdyAtIEZPTExPV19TTkFQX0RFVklDRV9QWCAqIG1wcHgoem9vbWVkLmVuZCAtIHpvb21lZC5zdGFydCkpO1xuICBhc3NlcnQuZXF1YWwoZm9sbG93QWZ0ZXJHZXN0dXJlKHRydWUsIHZpZXcuZW5kLCB6b29tZWQsIG5vdywgZmFsc2UsIG1wcHgoem9vbWVkLmVuZCAtIHpvb21lZC5zdGFydCkpLCB0cnVlKTtcbiAgLy8gVGhlIHNhbWUgem9vbSB3aGlsZSBOT1QgZm9sbG93aW5nIGRvZXMgbm90IGdyYWIgdGhlIHBpbi5cbiAgYXNzZXJ0LmVxdWFsKGZvbGxvd0FmdGVyR2VzdHVyZShmYWxzZSwgdmlldy5lbmQsIHpvb21lZCwgbm93LCBmYWxzZSwgbXBweCh6b29tZWQuZW5kIC0gem9vbWVkLnN0YXJ0KSksIGZhbHNlKTtcbn0pO1xuXG4vL1xuLy8gVGhlIGVsZW1lbnQgYXBwbGllcyBhIHpvb20gZ2VzdHVyZSBhcyB6b29tVmlldyh2aWV3LCBhbmNob3IsIGYpIGFuZCBcdTIwMTRcbi8vIGJlY2F1c2UgYSB6b29tIG5ldmVyIGluaGVyaXRzIHRoZSBwaW4gXHUyMDE0IHJvdXRlcyBpdCB0aHJvdWdoXG4vLyBmb2xsb3dBZnRlckdlc3R1cmUoZmFsc2UsIC4uLikgKyBjbGFtcFZpZXdUb05vdy4gVGhlc2UgdGVzdHMgcGluIHRoYXRcbi8vIGNvbXBvc2l0aW9uOiB0aGUgdGltZXN0YW1wIHVuZGVyIHRoZSBjdXJzb3Igc3RheXMgdW5kZXIgdGhlIGN1cnNvcixcbi8vIGFuZCBmb2xsb3cgaXMgcmUtZWFybmVkIGV4YWN0bHkgYXQgdGhlIHNuYXAgYm91bmRhcnkuXG5cbnRlc3QoJ3pvb20gd2hpbGUgZm9sbG93aW5nOiBhbiBhbmNob3JlZCB6b29tLWluIHBhcmtzIHdpdGggdGhlIHRpbWVzdGFtcCB1bmRlciB0aGUgY3Vyc29yIGludGFjdCcsICgpID0+IHtcbiAgY29uc3Qgbm93ID0gMV8wMDBfMDAwXzAwMDtcbiAgY29uc3Qgc3BhbiA9IDkwMF8wMDA7XG4gIGNvbnN0IHBsb3RXID0gMTAwMDtcbiAgLy8gU3RlYWR5LXN0YXRlIHBpbm5lZCB2aWV3OiBlbmQgPSBub3cgKyBsZWFkLlxuICBjb25zdCBlbmQgPSBub3cgKyBzcGFuICogRk9MTE9XX0xFQURfRlJBQztcbiAgY29uc3QgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiBlbmQgLSBzcGFuLCBlbmQgfTtcbiAgLy8gQ3Vyc29yIGEgdGhpcmQgb2YgdGhlIHBsb3QgZnJvbSB0aGUgbGVmdC5cbiAgY29uc3QgYW5jaG9yID0gdmlldy5zdGFydCArIHNwYW4gLyAzO1xuICBjb25zdCB6b29tZWQgPSB6b29tVmlldyh2aWV3LCBhbmNob3IsIDIpO1xuICAvLyBUaGUgYW5jaG9yIGludmFyaWFudCBhY3Jvc3MgdGhlIHpvb20gYXBwbGljYXRpb24gaXRzZWxmLlxuICBhc3NlcnQub2soTWF0aC5hYnMoKGFuY2hvciAtIHpvb21lZC5zdGFydCkgLyAoem9vbWVkLmVuZCAtIHpvb21lZC5zdGFydCkgLSAxIC8gMykgPCAxZS05KTtcbiAgLy8gQSB6b29tIGlzIHBhc3NlZCB3YXNGb2xsb3dpbmc9ZmFsc2UgXHUyMTkyIHRoZSBzbmFwIHJ1bGUgZGVjaWRlczogdGhlIGVuZCBsZWZ0IHRoZSB6b25lLCBzbyB0aGUgdmlldyBwYXJrc1x1MjAyNlxuICBjb25zdCB6U3BhbiA9IHpvb21lZC5lbmQgLSB6b29tZWQuc3RhcnQ7XG4gIGFzc2VydC5lcXVhbChmb2xsb3dBZnRlckdlc3R1cmUoZmFsc2UsIHZpZXcuZW5kLCB6b29tZWQsIG5vdywgZmFsc2UsIG1wcHgoelNwYW4sIHBsb3RXKSksIGZhbHNlKTtcbiAgLy8gXHUyMDI2YW5kIHRoZSBwYXJrZWQgYXBwbGljYXRpb24gKHRoZSBkaXNlbmdhZ2VkIGJyYW5jaCBjbGFtcHMgYXQgbm93IG9uY2UgdGhlIGxlYWQgaXMgY29uc3VtZWQpIGRvZXMgbm90IG1vdmUgaXQuXG4gIGFzc2VydC5kZWVwRXF1YWwoY2xhbXBWaWV3VG9Ob3coem9vbWVkLCBub3cpLCB6b29tZWQpO1xufSk7XG5cbnRlc3QoJ3pvb20gd2hpbGUgZm9sbG93aW5nOiBmb2xsb3cgaXMgcmUtZWFybmVkIGV4YWN0bHkgYXQgdGhlIHNuYXAgYm91bmRhcnkgKGJvdGggc2lkZXMpJywgKCkgPT4ge1xuICBjb25zdCBub3cgPSAxXzAwMF8wMDBfMDAwO1xuICBjb25zdCBzcGFuID0gOTAwXzAwMDtcbiAgY29uc3QgcGxvdFcgPSAxMDAwO1xuICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IG5vdyAtIHNwYW4sIGVuZDogbm93IH07XG4gIGNvbnN0IGZyYWMgPSAxIC8gMztcbiAgY29uc3QgYW5jaG9yID0gdmlldy5zdGFydCArIHNwYW4gKiBmcmFjO1xuICAvLyBTb2x2ZSB0aGUgem9vbSBmYWN0b3IgdGhhdCBsYW5kcyB0aGUgcmlnaHQgZWRnZSBleGFjdGx5IGsgZGV2aWNlIHB4IHNob3J0IG9mIG5vdyBcdTIwMTQgbWVhc3VyZWQgYXQgdGhlIFpPT01FRCBzcGFuJ3Mgc2NhbGUuXG4gIGNvbnN0IFcgPSBwbG90VztcbiAgY29uc3Qgc3BhbkZvciA9IChrOiBudW1iZXIpID0+IChub3cgLSBhbmNob3IpIC8gKDEgLSBmcmFjICsgayAvIFcpO1xuICBmb3IgKGNvbnN0IFtrLCBlbmdhZ2VkXSBvZiBbXG4gICAgW0ZPTExPV19TTkFQX0RFVklDRV9QWCwgdHJ1ZV0sXG4gICAgW0ZPTExPV19TTkFQX0RFVklDRV9QWCArIDEsIGZhbHNlXSxcbiAgXSBhcyBjb25zdCkge1xuICAgIGNvbnN0IHpvb21lZCA9IHpvb21WaWV3KHZpZXcsIGFuY2hvciwgc3BhbiAvIHNwYW5Gb3IoaykpO1xuICAgIGFzc2VydC5vayhNYXRoLmFicyh6b29tZWQuZW5kIC0gKG5vdyAtIChrICogc3BhbkZvcihrKSkgLyBXKSkgPCAxZS02KTtcbiAgICAvLyBUaGUgYW5jaG9yIGhlbGQgZXZlbiBmb3IgdGhpcyBoYWlyJ3Mtd2lkdGggem9vbVx1MjAyNlxuICAgIGFzc2VydC5vayhNYXRoLmFicygoYW5jaG9yIC0gem9vbWVkLnN0YXJ0KSAvICh6b29tZWQuZW5kIC0gem9vbWVkLnN0YXJ0KSAtIGZyYWMpIDwgMWUtOSk7XG4gICAgLy8gXHUyMDI2YW5kIHRoZSBzbmFwIHJ1bGUgYWxvbmUgZGVjaWRlcyB3aGV0aGVyIGZvbGxvdyByZS1lbmdhZ2VzLlxuICAgIGNvbnN0IHpTcGFuID0gem9vbWVkLmVuZCAtIHpvb21lZC5zdGFydDtcbiAgICBhc3NlcnQuZXF1YWwoXG4gICAgICBmb2xsb3dBZnRlckdlc3R1cmUoZmFsc2UsIHZpZXcuZW5kLCB6b29tZWQsIG5vdywgZmFsc2UsIG1wcHgoelNwYW4sIHBsb3RXKSksXG4gICAgICBlbmdhZ2VkLFxuICAgICAgYCR7a30gZGV2aWNlIHB4IHNob3J0IG9mIG5vd2AsXG4gICAgKTtcbiAgfVxufSk7XG5cbnRlc3QoJ3pvb20tb3V0IHByZXNzaW5nIGludG8gdGhlIGVuZCBzdG9wIHJlLWVuZ2FnZXM6IHRoZSBzdG9wLCBub3QgdGhlIGFuY2hvciwgd2lucyBhdCB0aGUgd2FsbCcsICgpID0+IHtcbiAgY29uc3Qgbm93ID0gMV8wMDBfMDAwXzAwMDtcbiAgY29uc3Qgc3BhbiA9IDkwMF8wMDA7XG4gIGNvbnN0IHBsb3RXID0gMTAwMDtcbiAgY29uc3QgZW5kID0gbm93ICsgc3BhbiAqIEZPTExPV19MRUFEX0ZSQUM7XG4gIGNvbnN0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogZW5kIC0gc3BhbiwgZW5kIH07XG4gIGNvbnN0IGFuY2hvciA9IHZpZXcuc3RhcnQgKyBzcGFuIC8gMztcbiAgY29uc3Qgem9vbWVkT3V0ID0gem9vbVZpZXcodmlldywgYW5jaG9yLCAxIC8gMik7XG4gIC8vIFByZXNlcnZpbmcgdGhlIGFuY2hvciBvbiBhIHpvb20tb3V0IGF0IHRoZSBsaXZlIGVkZ2Ugd291bGQgc2hvdyB0aGUgZnV0dXJlIFx1MjAxNCB0aGUgcmF3IGVuZCBvdmVyc2hvb3RzIG5vd1x1MjAyNlxuICBhc3NlcnQub2soem9vbWVkT3V0LmVuZCA+IG5vdyk7XG4gIC8vIFx1MjAyNnNvIHRoZSBvbmUtc2lkZWQgc25hcCBydWxlIHJlLWVuZ2FnZXMgZm9sbG93LlxuICBjb25zdCB6U3BhbiA9IHpvb21lZE91dC5lbmQgLSB6b29tZWRPdXQuc3RhcnQ7XG4gIGFzc2VydC5lcXVhbChmb2xsb3dBZnRlckdlc3R1cmUoZmFsc2UsIHZpZXcuZW5kLCB6b29tZWRPdXQsIG5vdywgZmFsc2UsIG1wcHgoelNwYW4sIHBsb3RXKSksIHRydWUpO1xuICAvLyBUaGUgcGFya2VkLW1vZGUgZXF1aXZhbGVudDogdGhlIGNsYW1wIHJpZ2h0LWFuY2hvcnMgdGhlIHNhbWUgdmlldy5cbiAgY29uc3QgY2xhbXBlZCA9IGNsYW1wVmlld1RvTm93KHpvb21lZE91dCwgbm93KTtcbiAgYXNzZXJ0LmVxdWFsKGNsYW1wZWQuZW5kLCBub3cpO1xuICBhc3NlcnQuZXF1YWwoY2xhbXBlZC5lbmQgLSBjbGFtcGVkLnN0YXJ0LCB6U3Bhbik7XG59KTtcblxudGVzdCgnY2xhbXBWaWV3VG9Ob3c6IHRoZSBoYXJkIGVuZCBzdG9wIFx1MjAxNCBlbmQgbmV2ZXIgcGFzc2VzIG5vdywgc3BhbiBwcmVzZXJ2ZWQsIG5vLW9wIGF0L2JlZm9yZSBub3cnLCAoKSA9PiB7XG4gIGNvbnN0IG5vdyA9IDFfMDAwXzAwMF8wMDA7XG4gIGNvbnN0IHNwYW4gPSA2MDBfMDAwO1xuICBmb3IgKGNvbnN0IG92ZXJzaG9vdCBvZiBbMSwgNV8wMDAsIHNwYW4sIDQwICogc3Bhbl0pIHtcbiAgICBjb25zdCBjID0gY2xhbXBWaWV3VG9Ob3coeyBzdGFydDogbm93IC0gc3BhbiArIG92ZXJzaG9vdCwgZW5kOiBub3cgKyBvdmVyc2hvb3QgfSwgbm93KTtcbiAgICBhc3NlcnQuZXF1YWwoYy5lbmQsIG5vdywgYG92ZXJzaG9vdCAke292ZXJzaG9vdH0gcGFya3MgYXQgdGhlIHN0b3BgKTtcbiAgICBhc3NlcnQuZXF1YWwoYy5lbmQgLSBjLnN0YXJ0LCBzcGFuLCAnc3BhbiBwcmVzZXJ2ZWQnKTtcbiAgfVxuICBjb25zdCBiZWZvcmU6IFRpbWVWaWV3ID0geyBzdGFydDogbm93IC0gMiAqIHNwYW4sIGVuZDogbm93IC0gc3BhbiB9O1xuICBhc3NlcnQuZGVlcEVxdWFsKGNsYW1wVmlld1RvTm93KGJlZm9yZSwgbm93KSwgYmVmb3JlKTtcbiAgY29uc3QgYXQ6IFRpbWVWaWV3ID0geyBzdGFydDogbm93IC0gc3BhbiwgZW5kOiBub3cgfTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChjbGFtcFZpZXdUb05vdyhhdCwgbm93KSwgYXQpO1xufSk7XG5cbnRlc3QoJ2NsYW1wVmlld1RvQm91bmRzOiBlYWNoIHNpZGUgY2xhbXBzIGluZGVwZW5kZW50bHksIHNwYW4gcHJlc2VydmVkJywgKCkgPT4ge1xuICBjb25zdCBtaW4gPSAxXzAwMF8wMDBfMDAwO1xuICBjb25zdCBtYXggPSBtaW4gKyAzXzYwMF8wMDA7XG4gIGNvbnN0IHNwYW4gPSA2MDBfMDAwO1xuICAvLyBVbmJvdW5kZWQgb24gYm90aCBzaWRlczogaWRlbnRpdHksIHdoYXRldmVyIHRoZSB2aWV3LlxuICBjb25zdCB2OiBUaW1lVmlldyA9IHsgc3RhcnQ6IG1pbiAtIDUgKiBzcGFuLCBlbmQ6IG1pbiAtIDQgKiBzcGFuIH07XG4gIGFzc2VydC5kZWVwRXF1YWwoY2xhbXBWaWV3VG9Cb3VuZHModiwgeyBtaW46IG51bGwsIG1heDogbnVsbCB9KSwgdik7XG4gIC8vIG1pbiBhbG9uZTogYSB2aWV3IGJlZm9yZSBpdCBzaGlmdHMgZm9yd2FyZC5cbiAgY29uc3QgYmFjayA9IGNsYW1wVmlld1RvQm91bmRzKHsgc3RhcnQ6IG1pbiAtIHNwYW4sIGVuZDogbWluIH0sIHsgbWluLCBtYXg6IG51bGwgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYmFjaywgeyBzdGFydDogbWluLCBlbmQ6IG1pbiArIHNwYW4gfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoY2xhbXBWaWV3VG9Cb3VuZHMoeyBzdGFydDogbWF4LCBlbmQ6IG1heCArIHNwYW4gfSwgeyBtaW4sIG1heDogbnVsbCB9KSwgeyBzdGFydDogbWF4LCBlbmQ6IG1heCArIHNwYW4gfSk7XG4gIC8vIG1heCBhbG9uZTogYSB2aWV3IHBhc3QgaXQgc2hpZnRzIGJhY2sgb3ZlciBhbiB1bmxpbWl0ZWQgcGFzdC5cbiAgY29uc3QgZndkID0gY2xhbXBWaWV3VG9Cb3VuZHMoeyBzdGFydDogbWF4LCBlbmQ6IG1heCArIHNwYW4gfSwgeyBtaW46IG51bGwsIG1heCB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChmd2QsIHsgc3RhcnQ6IG1heCAtIHNwYW4sIGVuZDogbWF4IH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGNsYW1wVmlld1RvQm91bmRzKHsgc3RhcnQ6IG1pbiAtIDk5ICogc3BhbiwgZW5kOiBtaW4gLSA5OCAqIHNwYW4gfSwgeyBtaW46IG51bGwsIG1heCB9KSwge1xuICAgIHN0YXJ0OiBtaW4gLSA5OSAqIHNwYW4sXG4gICAgZW5kOiBtaW4gLSA5OCAqIHNwYW4sXG4gIH0pO1xuICAvLyBCb3RoOiBpbnNpZGUgaXMgdW50b3VjaGVkLCBlaXRoZXIgb3ZlcnNob290IHBhcmtzIGF0IGl0cyBvd24gc3RvcC5cbiAgY29uc3QgaW5zaWRlOiBUaW1lVmlldyA9IHsgc3RhcnQ6IG1pbiArIHNwYW4sIGVuZDogbWluICsgMiAqIHNwYW4gfTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChjbGFtcFZpZXdUb0JvdW5kcyhpbnNpZGUsIHsgbWluLCBtYXggfSksIGluc2lkZSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoY2xhbXBWaWV3VG9Cb3VuZHMoeyBzdGFydDogbWF4LCBlbmQ6IG1heCArIHNwYW4gfSwgeyBtaW4sIG1heCB9KSwgeyBzdGFydDogbWF4IC0gc3BhbiwgZW5kOiBtYXggfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoY2xhbXBWaWV3VG9Cb3VuZHMoeyBzdGFydDogbWluIC0gc3BhbiwgZW5kOiBtaW4gfSwgeyBtaW4sIG1heCB9KSwgeyBzdGFydDogbWluLCBlbmQ6IG1pbiArIHNwYW4gfSk7XG4gIC8vIEEgc3BhbiB3aWRlciB0aGFuIHRoZSByYW5nZSBjYW5ub3Qga2VlcCBib3RoIHN0b3BzOiBpdCBjb2xsYXBzZXMgb250b1xuICAvLyB0aGUgcmFuZ2UgZXhhY3RseSwgZnJvbSBlaXRoZXIgZGlyZWN0aW9uLlxuICBmb3IgKGNvbnN0IHdpZGUgb2YgW21heCAtIG1pbiArIDEsIDEwICogKG1heCAtIG1pbildKSB7XG4gICAgYXNzZXJ0LmRlZXBFcXVhbChjbGFtcFZpZXdUb0JvdW5kcyh7IHN0YXJ0OiBtaW4gLSB3aWRlLCBlbmQ6IG1pbiB9LCB7IG1pbiwgbWF4IH0pLCB7IHN0YXJ0OiBtaW4sIGVuZDogbWF4IH0pO1xuICAgIGFzc2VydC5kZWVwRXF1YWwoY2xhbXBWaWV3VG9Cb3VuZHMoeyBzdGFydDogbWF4LCBlbmQ6IG1heCArIHdpZGUgfSwgeyBtaW4sIG1heCB9KSwgeyBzdGFydDogbWluLCBlbmQ6IG1heCB9KTtcbiAgfVxuICAvLyBOb24tZmluaXRlIHNpZGVzIHJlYWQgYXMgdW5ib3VuZGVkLCBuZXZlciBhcyBOYU4gYXJpdGhtZXRpYy5cbiAgYXNzZXJ0LmRlZXBFcXVhbChjbGFtcFZpZXdUb0JvdW5kcyh2LCB7IG1pbjogTmFOLCBtYXg6IEluZmluaXR5IH0pLCB2KTtcbn0pO1xuXG50ZXN0KCdib3VuZGVkTWF4U3BhbjogdGhlIHJhbmdlIHdoZW4gYm90aCBzaWRlcyBhcmUgc2V0LCBuZXZlciB1bmRlciB0aGUgem9vbSBmbG9vcicsICgpID0+IHtcbiAgY29uc3QgbWluID0gMV8wMDBfMDAwXzAwMDtcbiAgYXNzZXJ0LmVxdWFsKGJvdW5kZWRNYXhTcGFuKHsgbWluOiBudWxsLCBtYXg6IG51bGwgfSksIE1BWF9TUEFOX01TKTtcbiAgYXNzZXJ0LmVxdWFsKGJvdW5kZWRNYXhTcGFuKHsgbWluLCBtYXg6IG51bGwgfSksIE1BWF9TUEFOX01TKTtcbiAgYXNzZXJ0LmVxdWFsKGJvdW5kZWRNYXhTcGFuKHsgbWluOiBudWxsLCBtYXg6IG1pbiArIDEwMDAgfSksIE1BWF9TUEFOX01TKTtcbiAgYXNzZXJ0LmVxdWFsKGJvdW5kZWRNYXhTcGFuKHsgbWluLCBtYXg6IG1pbiArIDYwMF8wMDAgfSksIDYwMF8wMDApO1xuICAvLyBBIHJhbmdlIHdpZGVyIHRoYW4gdGhlIGhhcmQgY2VpbGluZyBzdGlsbCBzdG9wcyBhdCB0aGUgY2VpbGluZy5cbiAgYXNzZXJ0LmVxdWFsKGJvdW5kZWRNYXhTcGFuKHsgbWluLCBtYXg6IG1pbiArIDMwICogTUFYX1NQQU5fTVMgfSksIE1BWF9TUEFOX01TKTtcbiAgYXNzZXJ0LmVxdWFsKGJvdW5kZWRNYXhTcGFuKHsgbWluLCBtYXg6IG1pbiArIDEgfSksIE1JTl9TUEFOX01TKTtcbn0pO1xuXG50ZXN0KCdjbGFtcFZpZXdUb0JvdW5kczogYSBtaW4gc3RvcCBhbmQgdGhlIGxpdmUtbm93IHN0b3AgY29tcG9zZSB3aXRob3V0IGZpZ2h0aW5nJywgKCkgPT4ge1xuICAvLyBUaGUgZWxlbWVudCBjbGFtcHMgZXZlcnkgZ2VzdHVyZSB0aHJvdWdoIGJvdGggYXQgb25jZSBcdTIwMTQgbWluIGZyb20gdGhlIGNvbmZpZ3VyZWQgYm91bmQuXG4gIGNvbnN0IG1pbiA9IDFfMDAwXzAwMF8wMDA7XG4gIGNvbnN0IG5vdyA9IG1pbiArIDdfMjAwXzAwMDtcbiAgY29uc3Qgc3BhbiA9IDkwMF8wMDA7XG4gIGZvciAoY29uc3QgcmF3IG9mIFtcbiAgICB7IHN0YXJ0OiBtaW4gLSAxMCAqIHNwYW4sIGVuZDogbWluIC0gOSAqIHNwYW4gfSxcbiAgICB7IHN0YXJ0OiBub3csIGVuZDogbm93ICsgc3BhbiB9LFxuICAgIHsgc3RhcnQ6IG1pbiArIHNwYW4sIGVuZDogbWluICsgMiAqIHNwYW4gfSxcbiAgXSkge1xuICAgIGNvbnN0IGMgPSBjbGFtcFZpZXdUb0JvdW5kcyhyYXcsIHsgbWluLCBtYXg6IG5vdyB9KTtcbiAgICBhc3NlcnQub2soYy5zdGFydCA+PSBtaW4sICduZXZlciBiZWZvcmUgdGhlIG1pbiBzdG9wJyk7XG4gICAgYXNzZXJ0Lm9rKGMuZW5kIDw9IG5vdywgJ25ldmVyIHBhc3QgdGhlIG5vdyBzdG9wJyk7XG4gICAgYXNzZXJ0LmVxdWFsKGMuZW5kIC0gYy5zdGFydCwgc3BhbiwgJ3NwYW4gcHJlc2VydmVkIFx1MjAxNCB0aGUgcmFuZ2UgaXMgd2lkZXIgdGhhbiBpdCcpO1xuICB9XG59KTtcblxudGVzdCgnY2xhbXBWaWV3VG9Ob3cgKyBmb2xsb3dBZnRlckdlc3R1cmU6IGFueSBmb3J3YXJkIG92ZXJzaG9vdCBwYXJrcyBhdCB0aGUgc3RvcCBhbmQgcmVsaWFibHkgcmUtZG9ja3MnLCAoKSA9PiB7XG4gIGNvbnN0IG5vdyA9IDFfMDAwXzAwMF8wMDA7XG4gIGNvbnN0IHNwYW4gPSA5MDBfMDAwO1xuICBjb25zdCBweCA9IG1wcHgoc3Bhbik7XG4gIGZvciAoY29uc3QgcmF3RW5kIG9mIFtub3cgKyAxLCBub3cgKyAyNTAgKiBweCwgbm93ICsgc3Bhbl0pIHtcbiAgICBjb25zdCBjbGFtcGVkID0gY2xhbXBWaWV3VG9Ob3coeyBzdGFydDogcmF3RW5kIC0gc3BhbiwgZW5kOiByYXdFbmQgfSwgbm93KTtcbiAgICBhc3NlcnQuZXF1YWwoY2xhbXBlZC5lbmQsIG5vdyk7XG4gICAgYXNzZXJ0LmVxdWFsKGZvbGxvd0FmdGVyR2VzdHVyZShmYWxzZSwgbm93IC0gc3BhbiwgY2xhbXBlZCwgbm93LCB0cnVlLCBweCksIHRydWUpO1xuICB9XG59KTtcblxuLy8gLS0gRm9sbG93LWxlYWQgZWFzaW5nIChlbmdhZ2UvZGlzZW5nYWdlL2p1bXAgZ2xpZGUsIG5ldmVyIHRlbGVwb3J0KSAtLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgRlJBTUVfTVMgPSAxMDAwIC8gNjA7XG4vKiogTWF4IHBlci1mcmFtZSBsZWFkIGNoYW5nZSB0aGUgZWFzZU91dFF1YWQgdHdlZW4gY2FuIHByb2R1Y2UgKGl0cyBzbG9wZSBwZWFrcyBhdCB0PTApLiAqL1xuY29uc3QgZWFzZVN0ZXBCb3VuZCA9IChkaXN0OiBudW1iZXIsIGR0OiBudW1iZXIsIHR3ZWVuOiBudW1iZXIpOiBudW1iZXIgPT4gTWF0aC5hYnMoZGlzdCkgKiAyICogKGR0IC8gdHdlZW4pO1xuXG50ZXN0KCdnZXN0dXJlTGVhZEZyYWM6IGEgZ2VzdHVyZSBjb25zdW1lcyBsZWFkIG9yIHBhcmtzIGJlaGluZCBub3cgXHUyMDE0IG5ldmVyIG1pbnRzIGxlYWQnLCAoKSA9PiB7XG4gIGNvbnN0IG5vdyA9IDFfMDAwXzAwMF8wMDA7XG4gIGNvbnN0IHNwYW4gPSA5MDBfMDAwO1xuICAvLyBQYXJrZWQgZXhhY3RseSBhdCB0aGUgc3RvcDogemVybyBsZWFkLlxuICBhc3NlcnQuZXF1YWwoZ2VzdHVyZUxlYWRGcmFjKG5vdywgbm93LCBzcGFuLCAwKSwgMCk7XG4gIGNvbnN0IHR3b1B4ID0gMiAqIG1wcHgoc3Bhbik7XG4gIGNvbnN0IHNob3J0ID0gZ2VzdHVyZUxlYWRGcmFjKG5vdyAtIHR3b1B4LCBub3csIHNwYW4sIDApO1xuICBhc3NlcnQub2soc2hvcnQgPCAwICYmIHNob3J0ID4gLTAuMDEsIGAyIHB4IHNob3J0IHNlZWRzIHNsaWdodGx5IG5lZ2F0aXZlICgke3Nob3J0fSlgKTtcbiAgLy8gQSByYXcgb3ZlcnNob290IHBhc3QgdGhlIGNlaWxpbmcgaXMgY2FwcGVkIGF0IHRoZSBsZWFkIGFscmVhZHkgaGVsZC5cbiAgYXNzZXJ0LmVxdWFsKGdlc3R1cmVMZWFkRnJhYyhub3cgKyBzcGFuLCBub3csIHNwYW4sIEZPTExPV19MRUFEX0ZSQUMpLCBGT0xMT1dfTEVBRF9GUkFDKTtcbiAgYXNzZXJ0LmVxdWFsKGdlc3R1cmVMZWFkRnJhYyhub3cgKyBzcGFuLCBub3csIHNwYW4sIDApLCAwKTtcbiAgLy8gRGVlcCBpbiB0aGUgcGFzdCAoanVtcC10by1ub3cgc2VlZCk6IGRlZXBseSBuZWdhdGl2ZSwgdW5jYXBwZWQgYmVsb3cuXG4gIGFzc2VydC5lcXVhbChnZXN0dXJlTGVhZEZyYWMobm93IC0gMTAgKiBzcGFuLCBub3csIHNwYW4sIDApLCAtMTApO1xuICAvLyBEZWdlbmVyYXRlIHNwYW4gbmV2ZXIgeWllbGRzIGEgcG9zaXRpdmUgbGVhZC5cbiAgYXNzZXJ0LmVxdWFsKGdlc3R1cmVMZWFkRnJhYyhub3cgKyA1LCBub3csIDAsIEZPTExPV19MRUFEX0ZSQUMpLCAwKTtcbn0pO1xuXG50ZXN0KCdmb2xsb3dMZWFkQXQ6IGVuZ2FnZSBzdGFydHMgZnJvbSB0aGUgcGFya2VkIGVuZCBhbmQgbW9ub3RvbmljYWxseSBhcHByb2FjaGVzIHRoZSBsZWFkIFx1MjAxNCBubyBvdmVyc2hvb3QsIGV4YWN0IGxhbmRpbmcnLCAoKSA9PiB7XG4gIGNvbnN0IGZyb20gPSAwOyAvLyB0aGUgcXVhbGlmeWluZyBnZXN0dXJlIHBhcmtlZCBhdCBlbmQgPSBub3dcbiAgbGV0IHByZXYgPSBmcm9tO1xuICBhc3NlcnQuZXF1YWwoZm9sbG93TGVhZEF0KGZyb20sIEZPTExPV19MRUFEX0ZSQUMsIDAsIEZPTExPV19MRUFEX1RXRUVOX01TKSwgZnJvbSwgJ2ZyYW1lIDAgSVMgdGhlIHBhcmtlZCBwb3NpdGlvbicpO1xuICBmb3IgKGxldCB0ID0gMTsgdCA8PSBGT0xMT1dfTEVBRF9UV0VFTl9NUyArIDUwOyB0ICs9IDEpIHtcbiAgICBjb25zdCB2ID0gZm9sbG93TGVhZEF0KGZyb20sIEZPTExPV19MRUFEX0ZSQUMsIHQsIEZPTExPV19MRUFEX1RXRUVOX01TKTtcbiAgICBhc3NlcnQub2sodiA+PSBwcmV2LCBgbW9ub3RvbmUgYXQgdD0ke3R9YCk7XG4gICAgYXNzZXJ0Lm9rKHYgPD0gRk9MTE9XX0xFQURfRlJBQywgYG5vIG92ZXJzaG9vdCBhdCB0PSR7dH1gKTtcbiAgICBwcmV2ID0gdjtcbiAgfVxuICBhc3NlcnQuZXF1YWwoZm9sbG93TGVhZEF0KGZyb20sIEZPTExPV19MRUFEX0ZSQUMsIEZPTExPV19MRUFEX1RXRUVOX01TLCBGT0xMT1dfTEVBRF9UV0VFTl9NUyksIEZPTExPV19MRUFEX0ZSQUMsICdsYW5kcyBFWEFDVExZIG9uIHRoZSBsZWFkJyk7XG59KTtcblxudGVzdCgnZW5nYWdlOiBwZXItZnJhbWUgdmlldyBkaXNwbGFjZW1lbnQgaXMgYm91bmRlZCBieSB0aGUgZWFzaW5nIHN0ZXAgXHUyMDE0IG5ldmVyIHRoZSBvbmUtZnJhbWUgbGVhZCB0ZWxlcG9ydCcsICgpID0+IHtcbiAgY29uc3Qgc3BhbiA9IDkwMF8wMDA7XG4gIGNvbnN0IG5vdzAgPSAxXzAwMF8wMDBfMDAwO1xuICAvLyBUaGUgZWxlbWVudCdzIHBlci10aWNrIHBpbiB3aGlsZSBmb2xsb3dpbmc6IGVuZCA9IG5vdyArIHNwYW4gKiBsZWFkKHQpLlxuICBjb25zdCBlbmRBdCA9ICh0OiBudW1iZXIpOiBudW1iZXIgPT4gbm93MCArIHQgKyBzcGFuICogZm9sbG93TGVhZEF0KDAsIEZPTExPV19MRUFEX0ZSQUMsIHQsIEZPTExPV19MRUFEX1RXRUVOX01TKTtcbiAgYXNzZXJ0LmVxdWFsKGVuZEF0KDApLCBub3cwLCAndGhlIGVuZ2FnaW5nIGZyYW1lIGxlYXZlcyB0aGUgdmlldyB3aGVyZSB0aGUgZ2VzdHVyZSBwYXJrZWQnKTtcbiAgY29uc3QgdGVsZXBvcnQgPSBzcGFuICogRk9MTE9XX0xFQURfRlJBQzsgLy8gd2hhdCB0aGUgaW5zdGFudCBhc3NpZ25tZW50IHVzZWQgdG8gbW92ZSBpbiBPTkUgZnJhbWVcbiAgY29uc3QgYm91bmQgPSBlYXNlU3RlcEJvdW5kKEZPTExPV19MRUFEX0ZSQUMgKiBzcGFuLCBGUkFNRV9NUywgRk9MTE9XX0xFQURfVFdFRU5fTVMpO1xuICBsZXQgbWF4U3RlcCA9IDA7XG4gIGZvciAobGV0IHQgPSBGUkFNRV9NUzsgdCA8PSBGT0xMT1dfTEVBRF9UV0VFTl9NUyArIDMgKiBGUkFNRV9NUzsgdCArPSBGUkFNRV9NUykge1xuICAgIGNvbnN0IHN0ZXAgPSBlbmRBdCh0KSAtIGVuZEF0KHQgLSBGUkFNRV9NUykgLSBGUkFNRV9NUzsgLy8gbWludXMgdGhlIG5hdHVyYWwgZm9sbG93IGRyaWZ0IChub3cgYWR2YW5jZWQpXG4gICAgYXNzZXJ0Lm9rKHN0ZXAgPj0gLTFlLTYsIGBuZXZlciBtb3ZlcyBiYWNrd2FyZCB3aGlsZSBlbmdhZ2luZyAodD0ke3R9KWApO1xuICAgIGFzc2VydC5vayhzdGVwIDw9IGJvdW5kICsgMWUtNiwgYHQ9JHt0fTogZWFzaW5nIHN0ZXAgJHtzdGVwfSB3aXRoaW4gYm91bmQgJHtib3VuZH1gKTtcbiAgICBtYXhTdGVwID0gTWF0aC5tYXgobWF4U3RlcCwgc3RlcCk7XG4gIH1cbiAgYXNzZXJ0Lm9rKG1heFN0ZXAgPCB0ZWxlcG9ydCAvIDQsIGBtYXggcGVyLWZyYW1lIHN0ZXAgJHttYXhTdGVwfW1zIGlzIGEgZnJhY3Rpb24gb2YgdGhlIG9sZCAke3RlbGVwb3J0fW1zIHRlbGVwb3J0YCk7XG4gIC8vIFN0ZWFkeSBzdGF0ZSBhZnRlciB0aGUgdHdlZW46IHRoZSBwaW4gaXMgRVhBQ1RMWSB0aGUgZW5kID0gbm93ICsgc3BhbiAqIEZPTExPV19MRUFEX0ZSQUMuXG4gIGNvbnN0IHQgPSAxMCAqIEZPTExPV19MRUFEX1RXRUVOX01TO1xuICBhc3NlcnQuZXF1YWwoZW5kQXQodCksIG5vdzAgKyB0ICsgc3BhbiAqIEZPTExPV19MRUFEX0ZSQUMpO1xufSk7XG5cbnRlc3QoJ2Rpc2VuZ2FnZTogYSBiYWNrd2FyZCB3aGVlbCBzZXF1ZW5jZSBjb25zdW1lcyB0aGUgbGVhZCBcdTIwMTQgbm8gZnJhbWUgbW92ZXMgbW9yZSB0aGFuIHRoZSB1c2VyIGRlbHRhICsgZWFzaW5nIHN0ZXAnLCAoKSA9PiB7XG4gIGNvbnN0IHNwYW4gPSA5MDBfMDAwO1xuICBjb25zdCB0d2VlbiA9IEZPTExPV19MRUFEX1RXRUVOX01TO1xuICBsZXQgbm93ID0gMV8wMDBfMDAwXzAwMDtcbiAgLy8gU3RlYWR5IGZvbGxvdy5cbiAgbGV0IGxlYWQgPSBGT0xMT1dfTEVBRF9GUkFDO1xuICBsZXQgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiBub3cgKyBzcGFuICogbGVhZCAtIHNwYW4sIGVuZDogbm93ICsgc3BhbiAqIGxlYWQgfTtcbiAgY29uc3QgZGVsdGFzID0gWzZfMDAwLCA2XzAwMCwgNl8wMDAsIDZfMDAwXTtcbiAgbGV0IGdsaWRlOiB7IGZyb206IG51bWJlcjsgc3RhcnQ6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIGxldCBmb2xsb3dpbmcgPSB0cnVlO1xuICBsZXQgdGlja0lkeCA9IDA7XG4gIGxldCB0ID0gMDtcbiAgY29uc3QgbGVhZEF0ID0gKHR0OiBudW1iZXIpOiBudW1iZXIgPT4gKGdsaWRlID8gZm9sbG93TGVhZEF0KGdsaWRlLmZyb20sIDAsIHR0IC0gZ2xpZGUuc3RhcnQsIHR3ZWVuKSA6IGxlYWQpO1xuICBmb3IgKGxldCBmcmFtZSA9IDA7IGZyYW1lIDwgNjA7IGZyYW1lKyspIHtcbiAgICBjb25zdCBwcmV2RW5kID0gdmlldy5lbmQ7XG4gICAgbGV0IHVzZXJEZWx0YSA9IDA7XG4gICAgdCArPSBGUkFNRV9NUztcbiAgICBub3cgKz0gRlJBTUVfTVM7XG4gICAgLy8gVGhlIGVsZW1lbnQncyBwZXItZnJhbWUgc3RlcDogcGluIHdoaWxlIGZvbGxvd2luZywgZGVjYXkgd2hlbiBub3QuXG4gICAgaWYgKGZvbGxvd2luZykge1xuICAgICAgdmlldyA9IHsgc3RhcnQ6IG5vdyArIHNwYW4gKiBsZWFkIC0gc3BhbiwgZW5kOiBub3cgKyBzcGFuICogbGVhZCB9O1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBjZWlsID0gbm93ICsgc3BhbiAqIGxlYWRBdCh0KTtcbiAgICAgIGlmICh2aWV3LmVuZCA+IGNlaWwpIHZpZXcgPSB7IHN0YXJ0OiBjZWlsIC0gc3BhbiwgZW5kOiBjZWlsIH07XG4gICAgfVxuICAgIGlmIChmcmFtZSAlIDMgPT09IDIgJiYgdGlja0lkeCA8IGRlbHRhcy5sZW5ndGgpIHtcbiAgICAgIHVzZXJEZWx0YSA9IGRlbHRhc1t0aWNrSWR4KytdO1xuICAgICAgY29uc3QgbmV4dCA9IHBhblZpZXcodmlldywgLXVzZXJEZWx0YSk7XG4gICAgICBpZiAoZm9sbG93aW5nKSB7XG4gICAgICAgIGFzc2VydC5lcXVhbChmb2xsb3dBZnRlckdlc3R1cmUodHJ1ZSwgdmlldy5lbmQsIG5leHQsIG5vdywgdHJ1ZSwgbXBweChzcGFuKSksIGZhbHNlLCAnYmFja3dhcmQgcGFuIGRpc2VuZ2FnZXMnKTtcbiAgICAgICAgZm9sbG93aW5nID0gZmFsc2U7XG4gICAgICAgIGNvbnN0IHJlc2lkdWFsID0gTWF0aC5tYXgoMCwgZ2VzdHVyZUxlYWRGcmFjKG5leHQuZW5kLCBub3csIHNwYW4sIGxlYWQpKTtcbiAgICAgICAgZ2xpZGUgPSB7IGZyb206IHJlc2lkdWFsLCBzdGFydDogdCB9O1xuICAgICAgICB2aWV3ID0gY2xhbXBWaWV3VG9Ob3cobmV4dCwgbm93ICsgc3BhbiAqIHJlc2lkdWFsKTtcbiAgICAgICAgYXNzZXJ0LmVxdWFsKHZpZXcuZW5kLCBuZXh0LmVuZCwgXCJ0aGUgZGlzZW5nYWdpbmcgdGljayBtb3ZlcyBFWEFDVExZIHRoZSB1c2VyJ3Mgb3duIGRlbHRhIFx1MjAxNCBubyBsZWFkIGNvbGxhcHNlXCIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmlldyA9IGNsYW1wVmlld1RvTm93KG5leHQsIG5vdyArIHNwYW4gKiBsZWFkQXQodCkpO1xuICAgICAgICBhc3NlcnQuZXF1YWwodmlldy5lbmQsIG5leHQuZW5kLCAnbGF0ZXIgYmFja3dhcmQgdGlja3Mgc3RheSBwdXJlIHVzZXIgbW90aW9uJyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG1vdmVkID0gcHJldkVuZCAtIHZpZXcuZW5kOyAvLyBiYWNrd2FyZCBkaXNwbGFjZW1lbnQgdGhpcyBmcmFtZVxuICAgIGNvbnN0IGVhc2luZyA9IGVhc2VTdGVwQm91bmQoKGdsaWRlID8gZ2xpZGUuZnJvbSA6IGxlYWQpICogc3BhbiwgRlJBTUVfTVMsIHR3ZWVuKTtcbiAgICAvLyBGb3J3YXJkIG1vdGlvbiBpcyBvbmx5IGV2ZXIgdGhlIG5hdHVyYWwgZm9sbG93IGRyaWZ0IChub3cgYWR2YW5jaW5nIHdoaWxlIHN0aWxsIHBpbm5lZCkuXG4gICAgYXNzZXJ0Lm9rKG1vdmVkID49IChmb2xsb3dpbmcgPyAtRlJBTUVfTVMgOiAwKSAtIDFlLTYsIGBmcmFtZSAke2ZyYW1lfTogdmlldyBuZXZlciBqdW1wcyBGT1JXQVJEIHdoaWxlIGRpc2VuZ2FnaW5nYCk7XG4gICAgYXNzZXJ0Lm9rKG1vdmVkIDw9IHVzZXJEZWx0YSArIGVhc2luZyArIDFlLTYsIGBmcmFtZSAke2ZyYW1lfTogbW92ZWQgJHttb3ZlZH1tcyA+IHVzZXIgJHt1c2VyRGVsdGF9bXMgKyBlYXNpbmcgJHtlYXNpbmd9bXNgKTtcbiAgfVxuICBhc3NlcnQuZXF1YWwoZm9sbG93aW5nLCBmYWxzZSk7XG4gIGFzc2VydC5vayh2aWV3LmVuZCA8PSBub3csICd0aGUgbGVhZCBpcyBmdWxseSBjb25zdW1lZCBcdTIwMTQgdGhlIHBhcmtlZCB2aWV3IGlzIGJhY2sgYmVoaW5kIG5vdycpO1xufSk7XG5cbnRlc3QoJ2p1bXBUb05vdzogdGhlIHBpbGwgR0xJREVTIGZyb20gd2hlcmV2ZXIgeW91IGFyZSBhbmQgcmVhY2hlcyB0aGUgZm9sbG93ZWQgc3RhdGUgZXhhY3RseScsICgpID0+IHtcbiAgY29uc3Qgc3BhbiA9IDkwMF8wMDA7XG4gIGNvbnN0IG5vdzAgPSAxXzAwMF8wMDBfMDAwO1xuICBjb25zdCBwYXJrZWRFbmQgPSBub3cwIC0gMTAgKiBzcGFuOyAvLyBkZWVwIGluIHRoZSBwYXN0XG4gIGNvbnN0IGZyb20gPSBnZXN0dXJlTGVhZEZyYWMocGFya2VkRW5kLCBub3cwLCBzcGFuLCAwKTtcbiAgYXNzZXJ0LmVxdWFsKGZyb20sIC0xMCk7XG4gIGNvbnN0IGVuZEF0ID0gKHQ6IG51bWJlcik6IG51bWJlciA9PiBub3cwICsgdCArIHNwYW4gKiBmb2xsb3dMZWFkQXQoZnJvbSwgRk9MTE9XX0xFQURfRlJBQywgdCwgSlVNUF9UT19OT1dfVFdFRU5fTVMpO1xuICBhc3NlcnQuZXF1YWwoZW5kQXQoMCksIHBhcmtlZEVuZCwgJ3RoZSBqdW1wIGZyYW1lIGxlYXZlcyB0aGUgdmlldyB3aGVyZSBpdCB3YXMgXHUyMDE0IG5vIHRlbGVwb3J0Jyk7XG4gIGxldCBwcmV2ID0gZW5kQXQoMCk7XG4gIGxldCBtb3ZpbmdGcmFtZXMgPSAwO1xuICBmb3IgKGxldCB0ID0gRlJBTUVfTVM7IHQgPD0gSlVNUF9UT19OT1dfVFdFRU5fTVMgKyBGUkFNRV9NUzsgdCArPSBGUkFNRV9NUykge1xuICAgIGNvbnN0IGUgPSBlbmRBdChNYXRoLm1pbih0LCBKVU1QX1RPX05PV19UV0VFTl9NUykpO1xuICAgIGFzc2VydC5vayhlID49IHByZXYsIGBnbGlkZXMgbW9ub3RvbmljYWxseSBmb3J3YXJkICh0PSR7dH0pYCk7XG4gICAgaWYgKGUgLSBwcmV2ID4gRlJBTUVfTVMpIG1vdmluZ0ZyYW1lcysrO1xuICAgIHByZXYgPSBlO1xuICB9XG4gIGFzc2VydC5vayhtb3ZpbmdGcmFtZXMgPj0gOCwgYHRoZSB0cmF2ZWwgaXMgc3ByZWFkIG92ZXIgbWFueSBmcmFtZXMgKCR7bW92aW5nRnJhbWVzfSlgKTtcbiAgY29uc3QgdEVuZCA9IEpVTVBfVE9fTk9XX1RXRUVOX01TO1xuICBhc3NlcnQuZXF1YWwoZW5kQXQodEVuZCksIG5vdzAgKyB0RW5kICsgc3BhbiAqIEZPTExPV19MRUFEX0ZSQUMsICdsYW5kcyBFWEFDVExZIG9uIHRoZSBmb2xsb3dlZCBwb3NpdGlvbiAoZW5kID0gbm93ICsgbGVhZCknKTtcbn0pO1xuXG50ZXN0KCdmb2xsb3dMZWFkQXQ6IHJlZHVjZWQgbW90aW9uIChub24tcG9zaXRpdmUgdHdlZW4pIHNuYXBzIHN0cmFpZ2h0IHRvIHRoZSB0YXJnZXQnLCAoKSA9PiB7XG4gIGZvciAoY29uc3QgdHdlZW4gb2YgWzAsIC0xXSkge1xuICAgIGFzc2VydC5lcXVhbChmb2xsb3dMZWFkQXQoMCwgRk9MTE9XX0xFQURfRlJBQywgMCwgdHdlZW4pLCBGT0xMT1dfTEVBRF9GUkFDLCAnZW5nYWdlIHNuYXBzJyk7XG4gICAgYXNzZXJ0LmVxdWFsKGZvbGxvd0xlYWRBdChGT0xMT1dfTEVBRF9GUkFDLCAwLCAwLCB0d2VlbiksIDAsICdkaXNlbmdhZ2Ugc25hcHMnKTtcbiAgICBhc3NlcnQuZXF1YWwoZm9sbG93TGVhZEF0KC0xMCwgRk9MTE9XX0xFQURfRlJBQywgMCwgdHdlZW4pLCBGT0xMT1dfTEVBRF9GUkFDLCAnanVtcCBzbmFwcycpO1xuICB9XG59KTtcblxudGVzdCgnZm9sbG93TGVhZEF0OiBzdGVhZHktc3RhdGUgZm9sbG93IGlzIHVuY2hhbmdlZCBcdTIwMTQgYXQvYWZ0ZXIgdGhlIHR3ZWVuIHRoZSBwaW4gSVMgbm93ICsgc3BhbiAqIEZPTExPV19MRUFEX0ZSQUMnLCAoKSA9PiB7XG4gIC8vIGZyb20gPT0gdGFyZ2V0IChubyB0cmFuc2l0aW9uIGluIGZsaWdodCk6IGV2ZXJ5IGVsYXBzZWQgdmFsdWUgaXMgdGhlIGxlYWQuXG4gIGZvciAoY29uc3QgdCBvZiBbMCwgMSwgRk9MTE9XX0xFQURfVFdFRU5fTVMgLyAyLCBGT0xMT1dfTEVBRF9UV0VFTl9NUywgMWU2XSkge1xuICAgIGFzc2VydC5lcXVhbChmb2xsb3dMZWFkQXQoRk9MTE9XX0xFQURfRlJBQywgRk9MTE9XX0xFQURfRlJBQywgdCwgRk9MTE9XX0xFQURfVFdFRU5fTVMpLCBGT0xMT1dfTEVBRF9GUkFDKTtcbiAgfVxuICAvLyBBbmQgYSBmaW5pc2hlZCB0cmFuc2l0aW9uIHBhcmtzIGV4YWN0bHkgb24gdGhlIGNvbnN0YW50LlxuICBhc3NlcnQuZXF1YWwoZm9sbG93TGVhZEF0KDAsIEZPTExPV19MRUFEX0ZSQUMsIEZPTExPV19MRUFEX1RXRUVOX01TICsgMSwgRk9MTE9XX0xFQURfVFdFRU5fTVMpLCBGT0xMT1dfTEVBRF9GUkFDKTtcbn0pO1xuXG4vLyAtLSBGZWVkIHN0YWxlbmVzcyAoYSBkZWFkIGZlZWQgbXVzdCBiZSBpbXBvc3NpYmxlIHRvIG1pc3JlYWQpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ2ZlZWRJc1N0YWxlOiB0cmlnZ2VyIHRpbWluZyBcdTIwMTQgZnJlc2ggd2l0aGluIHRoZSB0aHJlc2hvbGQsIHN0YWxlIHN0cmljdGx5IHBhc3QgaXQnLCAoKSA9PiB7XG4gIGNvbnN0IGZyZXNoID0gMV8wMDBfMDAwXzAwMDtcbiAgYXNzZXJ0LmVxdWFsKGZlZWRJc1N0YWxlKGZyZXNoLCBmcmVzaCwgU1RBTEVfQUZURVJfREVGQVVMVF9NUyksIGZhbHNlLCAnanVzdCBzdGFtcGVkJyk7XG4gIGFzc2VydC5lcXVhbChmZWVkSXNTdGFsZShmcmVzaCArIFNUQUxFX0FGVEVSX0RFRkFVTFRfTVMsIGZyZXNoLCBTVEFMRV9BRlRFUl9ERUZBVUxUX01TKSwgZmFsc2UsICdleGFjdGx5IGF0IHRoZSB0aHJlc2hvbGQnKTtcbiAgYXNzZXJ0LmVxdWFsKGZlZWRJc1N0YWxlKGZyZXNoICsgU1RBTEVfQUZURVJfREVGQVVMVF9NUyArIDEsIGZyZXNoLCBTVEFMRV9BRlRFUl9ERUZBVUxUX01TKSwgdHJ1ZSwgJ3Bhc3QgdGhlIHRocmVzaG9sZCcpO1xuICAvLyBBIHJlLXN0YW1wIHJlc2V0cyB0aGUgY2xvY2suXG4gIGFzc2VydC5lcXVhbChmZWVkSXNTdGFsZShmcmVzaCArIDYwXzAwMCwgZnJlc2ggKyA1NV8wMDAsIFNUQUxFX0FGVEVSX0RFRkFVTFRfTVMpLCBmYWxzZSk7XG59KTtcblxudGVzdCgnZmVlZElzU3RhbGU6IG5ldmVyLWZlZCBjaGFydHMgYW5kIGRpc2FibGVkIHRocmVzaG9sZHMgYXJlIG5ldmVyIHN0YWxlJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoZmVlZElzU3RhbGUoMWUxMiwgbnVsbCwgU1RBTEVfQUZURVJfREVGQVVMVF9NUyksIGZhbHNlLCAnbm8gZGF0YSBldmVyIGFycml2ZWQnKTtcbiAgZm9yIChjb25zdCBvZmYgb2YgWzAsIC0xLCBJbmZpbml0eSwgTmFOXSkge1xuICAgIGFzc2VydC5lcXVhbChmZWVkSXNTdGFsZSgxZTEyLCAwLCBvZmYpLCBmYWxzZSwgYHRocmVzaG9sZCAke29mZn0gZGlzYWJsZXMgc3RhbGVuZXNzYCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdsaXZlRWRnZVRhcmdldDogb25jZSBzdGFsZSB0aGUgZWRnZSBGUkVFWkVTIGF0IGxhc3RGcmVzaCBcdTIwMTQgYW4gb25nb2luZyBiYXIgY2FuIG5ldmVyIHJlbmRlciBwYXN0IHRoZSBsYXN0IHZvdWNoZWQgdGltZXN0YW1wJywgKCkgPT4ge1xuICBjb25zdCBmcmVzaCA9IDFfMDAwXzAwMF8wMDA7XG4gIGNvbnN0IGFmdGVyID0gU1RBTEVfQUZURVJfREVGQVVMVF9NUztcbiAgLy8gV2hpbGUgZnJlc2ggdGhlIGVkZ2UgSVMgdGhlIGNsb2NrIChiYXJzIGFkdmFuY2Ugc21vb3RobHkpLlxuICBhc3NlcnQuZXF1YWwobGl2ZUVkZ2VUYXJnZXQoZnJlc2ggKyAyXzAwMCwgZnJlc2gsIGFmdGVyKSwgZnJlc2ggKyAyXzAwMCk7XG4gIC8vIE9uY2Ugc3RhbGUsIG5vIG1hdHRlciBob3cgbG9uZyB0aGUgZmVlZCBzdGF5cyBkZWFkLCB0aGUgZWRnZSAoPSB0aGUgcmlnaHRcbiAgLy8gZW5kIG9mIGV2ZXJ5IGVuZD1udWxsIGJhcikgaXMgcGlubmVkIGF0IGxhc3RGcmVzaC5cbiAgZm9yIChjb25zdCBkZWFkIG9mIFthZnRlciArIDEsIDYwXzAwMCwgM182MDBfMDAwLCA4Nl80MDBfMDAwXSkge1xuICAgIGFzc2VydC5lcXVhbChsaXZlRWRnZVRhcmdldChmcmVzaCArIGRlYWQsIGZyZXNoLCBhZnRlciksIGZyZXNoKTtcbiAgfVxufSk7XG5cbnRlc3QoJ3N0YWxlIHZpZXcgcGlubmluZzogYSBmb2xsb3dlZCB2aWV3IHN0b3BzIHNjcm9sbGluZyB3aGlsZSB0aGUgZmVlZCBpcyBkZWFkJywgKCkgPT4ge1xuICBjb25zdCBmcmVzaCA9IDFfMDAwXzAwMF8wMDA7XG4gIGNvbnN0IHNwYW4gPSA5MDBfMDAwO1xuICBjb25zdCBhZnRlciA9IFNUQUxFX0FGVEVSX0RFRkFVTFRfTVM7XG4gIC8vIFRoZSBlbGVtZW50J3MgZm9sbG93IHBpbjogZW5kID0gbGl2ZUVkZ2UgKyBzcGFuICogbGVhZC5cbiAgY29uc3QgcGlubmVkID0gbmV3IFNldDxudW1iZXI+KCk7XG4gIGZvciAobGV0IHQgPSBhZnRlciArIDE7IHQgPCBhZnRlciArIDYwXzAwMDsgdCArPSBGUkFNRV9NUyAqIDEwKSB7XG4gICAgcGlubmVkLmFkZChsaXZlRWRnZVRhcmdldChmcmVzaCArIHQsIGZyZXNoLCBhZnRlcikgKyBzcGFuICogRk9MTE9XX0xFQURfRlJBQyk7XG4gIH1cbiAgYXNzZXJ0LmVxdWFsKHBpbm5lZC5zaXplLCAxLCAndGhlIHBpbm5lZCBlbmQgaXMgb25lIGNvbnN0YW50IHZhbHVlIFx1MjAxNCB0aGUgZnJvemVuIGNvbnRlbnQgY2Fubm90IHNjcm9sbCBvdXQgb2YgdmlldycpO1xufSk7XG5cbnRlc3QoJ3N0YWxlIG9uc2V0OiB0aGUgbGl2ZSBlZGdlIFJFVFJBQ1RTIHRvIGxhc3RGcmVzaCBhcyBhIGJvdW5kZWQgZ2xpZGUsIG5vdCBhIG9uZS1mcmFtZSB0ZWxlcG9ydCcsICgpID0+IHtcbiAgY29uc3QgZnJlc2ggPSAxXzAwMF8wMDBfMDAwO1xuICBjb25zdCBhZnRlciA9IFNUQUxFX0FGVEVSX0RFRkFVTFRfTVM7XG4gIGNvbnN0IGZyb20gPSBmcmVzaCArIGFmdGVyOyAvLyB3aGVyZSB0aGUgZWRnZSBoYWQgZXh0cmFwb2xhdGVkIHRvIHdoZW4gc3RhbGVuZXNzIHdhcyBkZXRlY3RlZFxuICBsZXQgcHJldiA9IGZyb207XG4gIGZvciAobGV0IHQgPSBGUkFNRV9NUzsgdCA8PSBKVU1QX1RPX05PV19UV0VFTl9NUzsgdCArPSBGUkFNRV9NUykge1xuICAgIGNvbnN0IGUgPSBmb2xsb3dMZWFkQXQoZnJvbSwgZnJlc2gsIE1hdGgubWluKHQsIEpVTVBfVE9fTk9XX1RXRUVOX01TKSwgSlVNUF9UT19OT1dfVFdFRU5fTVMpO1xuICAgIGFzc2VydC5vayhlIDw9IHByZXYsICdyZXRyYWN0cyBtb25vdG9uaWNhbGx5Jyk7XG4gICAgYXNzZXJ0Lm9rKGUgPj0gZnJlc2gsICduZXZlciBvdmVyc2hvb3RzIGJlbG93IHRoZSB2b3VjaGVkIHRpbWVzdGFtcCcpO1xuICAgIGNvbnN0IHN0ZXAgPSBwcmV2IC0gZTtcbiAgICBhc3NlcnQub2soc3RlcCA8PSAoYWZ0ZXIgKiAyICogRlJBTUVfTVMpIC8gSlVNUF9UT19OT1dfVFdFRU5fTVMgKyAxZS02LCBgYm91bmRlZCBzdGVwICgke3N0ZXB9bXMpYCk7XG4gICAgcHJldiA9IGU7XG4gIH1cbiAgYXNzZXJ0LmVxdWFsKHByZXYsIGZyZXNoLCAnbGFuZHMgZXhhY3RseSBvbiBsYXN0RnJlc2gnKTtcbn0pO1xuXG50ZXN0KCdzdGFsZSByZWNvdmVyeTogdGhlIGVkZ2UgZ2xpZGVzIGZyb20gdGhlIGZyb3plbiBwb2ludCB0byB0aGUgTElWRSBjbG9jayBhbmQgdGhlIGZvbGxvdyBwaW4gY29tcG9zZXMgXHUyMDE0IG5vIHRlbGVwb3J0JywgKCkgPT4ge1xuICBjb25zdCBmcmVzaCA9IDFfMDAwXzAwMF8wMDA7XG4gIGNvbnN0IHNwYW4gPSA5MDBfMDAwO1xuICBjb25zdCBvdXRhZ2UgPSA0NV8wMDA7IC8vIHRoZSBmZWVkIHdhcyBkZWFkIDQ1czsgbWFya0ZyZXNoIGFycml2ZXMgbm93XG4gIGNvbnN0IHJlY292ZXJBdCA9IGZyZXNoICsgb3V0YWdlO1xuICBjb25zdCBnYXAgPSBvdXRhZ2U7IC8vIGRpc3RhbmNlIHRoZSBlZGdlIG11c3QgdHJhdmVsIChmcm96ZW4gYXQgZnJlc2gsIGNsb2NrIGF0IHJlY292ZXJBdClcbiAgbGV0IHByZXZFbmQgPSBmcmVzaCArIHNwYW4gKiBGT0xMT1dfTEVBRF9GUkFDOyAvLyB0aGUgZnJvemVuIGZvbGxvd2VkIHZpZXdcbiAgZm9yIChsZXQgdCA9IEZSQU1FX01TOyA7IHQgKz0gRlJBTUVfTVMpIHtcbiAgICBjb25zdCBlID0gTWF0aC5taW4odCwgSlVNUF9UT19OT1dfVFdFRU5fTVMpO1xuICAgIGNvbnN0IGNsb2NrID0gcmVjb3ZlckF0ICsgdDsgLy8gcmVhbCBub3cga2VlcHMgYWR2YW5jaW5nIGR1cmluZyB0aGUgZ2xpZGVcbiAgICBjb25zdCBlZGdlID0gZm9sbG93TGVhZEF0KGZyZXNoLCBjbG9jaywgZSwgSlVNUF9UT19OT1dfVFdFRU5fTVMpO1xuICAgIGNvbnN0IGVuZCA9IGVkZ2UgKyBzcGFuICogRk9MTE9XX0xFQURfRlJBQzsgLy8gdGhlIGVsZW1lbnQncyBmb2xsb3cgcGluXG4gICAgY29uc3Qgc3RlcCA9IGVuZCAtIHByZXZFbmQ7XG4gICAgYXNzZXJ0Lm9rKHN0ZXAgPj0gLTFlLTYsICd0aGUgdmlldyBvbmx5IG1vdmVzIGZvcndhcmQgZHVyaW5nIHJlY292ZXJ5Jyk7XG4gICAgYXNzZXJ0Lm9rKHN0ZXAgPD0gKChnYXAgKyBKVU1QX1RPX05PV19UV0VFTl9NUyArIEZSQU1FX01TKSAqIDIgKiBGUkFNRV9NUykgLyBKVU1QX1RPX05PV19UV0VFTl9NUyArIEZSQU1FX01TICsgMWUtNiwgJ2JvdW5kZWQgZWFzaW5nIHN0ZXAnKTtcbiAgICBwcmV2RW5kID0gZW5kO1xuICAgIGlmICh0ID49IEpVTVBfVE9fTk9XX1RXRUVOX01TKSB7XG4gICAgICBhc3NlcnQuZXF1YWwoZWRnZSwgY2xvY2ssICd0aGUgZWRnZSBsYW5kcyBleGFjdGx5IG9uIHRoZSBsaXZlIGNsb2NrJyk7XG4gICAgICBhc3NlcnQuZXF1YWwoZW5kLCBjbG9jayArIHNwYW4gKiBGT0xMT1dfTEVBRF9GUkFDLCAndGhlIGZvbGxvd2VkIHZpZXcgaXMgYmFjayB0byBzdGVhZHkgc3RhdGUnKTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxufSk7XG5cbnRlc3QoJ3N0YWxlIHRyYW5zaXRpb25zOiByZWR1Y2VkIG1vdGlvbiBzbmFwcyB0aGUgZWRnZSAodHdlZW4gMCknLCAoKSA9PiB7XG4gIGNvbnN0IGZyZXNoID0gMV8wMDBfMDAwXzAwMDtcbiAgYXNzZXJ0LmVxdWFsKGZvbGxvd0xlYWRBdChmcmVzaCArIFNUQUxFX0FGVEVSX0RFRkFVTFRfTVMsIGZyZXNoLCAwLCAwKSwgZnJlc2gsICdvbnNldCBzbmFwcyB0byBsYXN0RnJlc2gnKTtcbiAgYXNzZXJ0LmVxdWFsKGZvbGxvd0xlYWRBdChmcmVzaCwgZnJlc2ggKyA0NV8wMDAsIDAsIDApLCBmcmVzaCArIDQ1XzAwMCwgJ3JlY292ZXJ5IHNuYXBzIHRvIHRoZSBjbG9jaycpO1xufSk7XG5cbi8vIC0tIFdob2xlLXBpeGVsIHNjcm9sbGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnc25hcFZpZXdUb0RldmljZVBpeGVsczogcmVsYXRpdmUgb2Zmc2V0cyBhcmUgZXhhY3RseSBzdGFibGUgYWNyb3NzIGZyYWN0aW9uYWwgdHJhbnNsYXRpb25zJywgKCkgPT4ge1xuICBjb25zdCBwbG90VyA9IDEwMDA7XG4gIGNvbnN0IHNwYW4gPSA2MDBfMDAwO1xuICBjb25zdCB0MCA9IDFfNzUwXzAwMF8wMDBfMDAwO1xuICBjb25zdCB0MSA9IHQwICsgKDEwLjQgKiBzcGFuKSAvIHBsb3RXO1xuICBmb3IgKGNvbnN0IGRwciBvZiBbMSwgMl0pIHtcbiAgICBjb25zdCBvZmZzZXRzID0gbmV3IFNldDxudW1iZXI+KCk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCA0MDA7IGkrKykge1xuICAgICAgY29uc3QgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiB0MCAtIHNwYW4gLyAyICsgaSAqIDcuMTMsIGVuZDogdDAgKyBzcGFuIC8gMiArIGkgKiA3LjEzIH07XG4gICAgICBjb25zdCBydiA9IHNuYXBWaWV3VG9EZXZpY2VQaXhlbHModmlldywgcGxvdFcsIGRwcik7XG4gICAgICBjb25zdCBvZmYgPSB0aW1lVG9YKHQxLCBydiwgcGxvdFcpIC0gdGltZVRvWCh0MCwgcnYsIHBsb3RXKTtcbiAgICAgIG9mZnNldHMuYWRkKE1hdGgucm91bmQob2ZmICogMWU2KSAvIDFlNik7XG4gICAgfVxuICAgIGFzc2VydC5lcXVhbChvZmZzZXRzLnNpemUsIDEsIGBkcHIgJHtkcHJ9OiBvbmUgZXhhY3QgcmVsYXRpdmUgb2Zmc2V0IGFjcm9zcyBhbGwgc3VicGl4ZWwgcGhhc2VzYCk7XG4gICAgYXNzZXJ0Lm9rKE1hdGguYWJzKFsuLi5vZmZzZXRzXVswXSAtIDEwLjQpIDwgMWUtNik7XG4gIH1cbn0pO1xuXG50ZXN0KCdzbmFwVmlld1RvRGV2aWNlUGl4ZWxzOiBhIGZpeGVkIHRpbWUga2VlcHMgYSBjb25zdGFudCBzdWJwaXhlbCBwaGFzZSAoaW50ZWdlciBkZXZpY2UtcGl4ZWwgc3RlcHMpJywgKCkgPT4ge1xuICBjb25zdCBwbG90VyA9IDk3NzsgLy8gZGVsaWJlcmF0ZWx5IG9kZFxuICBjb25zdCBzcGFuID0gMTIzXzQ1NjtcbiAgY29uc3QgdCA9IDFfNzUwXzAwMF8wMDBfMDAwO1xuICBmb3IgKGNvbnN0IGRwciBvZiBbMSwgMl0pIHtcbiAgICBjb25zdCBwaGFzZXMgPSBuZXcgU2V0PG51bWJlcj4oKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IDMwMDsgaSsrKSB7XG4gICAgICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IHQgLSBzcGFuIC8gMyArIGkgKiAwLjM3NywgZW5kOiB0ICsgKDIgKiBzcGFuKSAvIDMgKyBpICogMC4zNzcgfTtcbiAgICAgIGNvbnN0IHJ2ID0gc25hcFZpZXdUb0RldmljZVBpeGVscyh2aWV3LCBwbG90VywgZHByKTtcbiAgICAgIGNvbnN0IHhEZXYgPSB0aW1lVG9YKHQsIHJ2LCBwbG90VykgKiBkcHI7XG4gICAgICBjb25zdCBwaGFzZSA9IHhEZXYgLSBNYXRoLmZsb29yKHhEZXYpO1xuICAgICAgcGhhc2VzLmFkZChNYXRoLnJvdW5kKHBoYXNlICogMWU2KSAvIDFlNik7XG4gICAgfVxuICAgIGFzc2VydC5vayhwaGFzZXMuc2l6ZSA8PSAyLCBgZHByICR7ZHByfTogcGhhc2UgaXMgY29uc3RhbnQgKG1vZCBmbG9hdCBub2lzZSksIGdvdCAke3BoYXNlcy5zaXplfWApO1xuICAgIGNvbnN0IFthLCBiXSA9IFsuLi5waGFzZXNdO1xuICAgIGlmIChiICE9PSB1bmRlZmluZWQpIGFzc2VydC5vayhNYXRoLmFicyhhIC0gYikgPCAxZS0zIHx8IE1hdGguYWJzKE1hdGguYWJzKGEgLSBiKSAtIDEpIDwgMWUtMyk7XG4gIH1cbn0pO1xuXG50ZXN0KCdzbmFwVmlld1RvRGV2aWNlUGl4ZWxzOiBzcGFuIHByZXNlcnZlZDsgZGVnZW5lcmF0ZSB2aWV3cyByZXR1cm5lZCB1bmNoYW5nZWQnLCAoKSA9PiB7XG4gIGNvbnN0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogMV8wMDBfMDAwLjQsIGVuZDogMV82MDBfMDAwLjQgfTtcbiAgY29uc3QgcnYgPSBzbmFwVmlld1RvRGV2aWNlUGl4ZWxzKHZpZXcsIDgwMCwgMik7XG4gIGFzc2VydC5vayhNYXRoLmFicyhydi5lbmQgLSBydi5zdGFydCAtIDYwMF8wMDApIDwgMWUtNik7XG4gIGNvbnN0IGJhZDogVGltZVZpZXcgPSB7IHN0YXJ0OiA1LCBlbmQ6IDUgfTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChzbmFwVmlld1RvRGV2aWNlUGl4ZWxzKGJhZCwgODAwLCAxKSwgYmFkKTtcbn0pO1xuXG50ZXN0KCdzbmFwVGV4dE9yaWdpbjogbGFuZHMgb24gd2hvbGUgZGV2aWNlIHBpeGVscyBhdCBhbnkgZHByLCBtb3ZpbmcgYXQgbW9zdCBoYWxmIGEgZGV2aWNlIHB4JywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoc25hcFRleHRPcmlnaW4oMTAuMywgMSksIDEwKTtcbiAgYXNzZXJ0LmVxdWFsKHNuYXBUZXh0T3JpZ2luKDEwLjYsIDEpLCAxMSk7XG4gIGFzc2VydC5lcXVhbChzbmFwVGV4dE9yaWdpbigxMC4zLCAyKSwgMTAuNSk7XG4gIGFzc2VydC5lcXVhbChzbmFwVGV4dE9yaWdpbigxMS41LCAyKSwgMTEuNSk7IC8vIGFscmVhZHkgb24gdGhlIGdyaWRcbiAgZm9yIChjb25zdCBkcHIgb2YgWzEsIDIsIDNdKSB7XG4gICAgZm9yIChjb25zdCB2IG9mIFswLCAzLjcsIDExLjUsIDEyMy40OSwgOTk5Ljk5XSkge1xuICAgICAgY29uc3Qgc25hcHBlZCA9IHNuYXBUZXh0T3JpZ2luKHYsIGRwcik7XG4gICAgICBjb25zdCBkZXYgPSBzbmFwcGVkICogZHByO1xuICAgICAgYXNzZXJ0Lm9rKE1hdGguYWJzKGRldiAtIE1hdGgucm91bmQoZGV2KSkgPCAxZS05LCBgZHByICR7ZHByfTogJHt2fSBcdTIxOTIgaW50ZWdlciBkZXZpY2UgcHhgKTtcbiAgICAgIGFzc2VydC5vayhNYXRoLmFicyhzbmFwcGVkIC0gdikgPD0gMC41IC8gZHByICsgMWUtOSwgYGRwciAke2Rwcn06ICR7dn0gbW92ZWQgXHUyMjY0IGhhbGYgYSBkZXZpY2UgcHhgKTtcbiAgICAgIGFzc2VydC5lcXVhbChzbmFwVGV4dE9yaWdpbihzbmFwcGVkLCBkcHIpLCBzbmFwcGVkLCBgZHByICR7ZHByfTogaWRlbXBvdGVudGApO1xuICAgIH1cbiAgfVxufSk7XG5cbnRlc3QoJ3NuYXBUZXh0T3JpZ2luOiBkZWdlbmVyYXRlIGlucHV0cyBwYXNzIHRocm91Z2gnLCAoKSA9PiB7XG4gIGFzc2VydC5vayhOdW1iZXIuaXNOYU4oc25hcFRleHRPcmlnaW4oTmFOLCAyKSkpO1xuICBhc3NlcnQuZXF1YWwoc25hcFRleHRPcmlnaW4oNS40LCAwKSwgNS40KTtcbiAgYXNzZXJ0LmVxdWFsKHNuYXBUZXh0T3JpZ2luKDUuNCwgLTEpLCA1LjQpO1xuICBhc3NlcnQuZXF1YWwoc25hcFRleHRPcmlnaW4oSW5maW5pdHksIDIpLCBJbmZpbml0eSk7XG59KTtcblxuLy8gLS0gQmFyL3BpcCBzdGFiaWxpdHkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnZHVyYXRpb25XaWR0aFB4OiB0cmFuc2xhdGlvbi1pbnZhcmlhbnQgXHUyMDE0IHNoYXBlIGRlY2lzaW9ucyBjYW5ub3QgZmxpY2tlciB3aGlsZSBzY3JvbGxpbmcnLCAoKSA9PiB7XG4gIGNvbnN0IHBsb3RXID0gMTIwMDtcbiAgY29uc3Qgc3BhbiA9IDkwMF8wMDA7XG4gIGNvbnN0IG1zUGVyUHggPSBzcGFuIC8gcGxvdFc7XG4gIGNvbnN0IGJhc2UgPSAxXzc1MF8wMDBfMDAwXzAwMDtcbiAgLy8gQSBzcHJlYWQgb2Ygc3ViLXNlY29uZC10by1zZWNvbmRzIGR1cmF0aW9ucyBhcm91bmQgdGhlIHBpcCB0aHJlc2hvbGQuXG4gIGNvbnN0IGR1cmF0aW9ucyA9IFswLCAxLCAxMDAsIDAuNSAqIG1zUGVyUHgsIDIuOSAqIG1zUGVyUHgsIDMuMSAqIG1zUGVyUHgsIDEwICogbXNQZXJQeF07XG4gIGZvciAoY29uc3QgZHVyIG9mIGR1cmF0aW9ucykge1xuICAgIGNvbnN0IGRlY2lzaW9ucyA9IG5ldyBTZXQ8Ym9vbGVhbj4oKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IDUwMDsgaSsrKSB7XG4gICAgICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IGJhc2UgKyBpICogMC43MzEsIGVuZDogYmFzZSArIGkgKiAwLjczMSArIHNwYW4gfTtcbiAgICAgIGNvbnN0IHcgPSBkdXJhdGlvbldpZHRoUHgoYmFzZSArIHNwYW4gLyAyLCBiYXNlICsgc3BhbiAvIDIgKyBkdXIsIHZpZXcsIHBsb3RXKTtcbiAgICAgIGRlY2lzaW9ucy5hZGQoaXNJbnN0YW50V2lkdGgodykpO1xuICAgIH1cbiAgICBhc3NlcnQuZXF1YWwoZGVjaXNpb25zLnNpemUsIDEsIGBkdXJhdGlvbiAke2R1cn1tczogb25lIHJlcHJlc2VudGF0aW9uIGFjcm9zcyBhbGwgdmlld3BvcnQgcGhhc2VzYCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdkdXJhdGlvbldpZHRoUHg6IHplcm8tZHVyYXRpb24gZXZlbnRzIGFyZSBwaXBzIGF0IGFueSB6b29tOyByZWFsIHdpZHRocyBjbGVhciB0aGUgdGhyZXNob2xkJywgKCkgPT4ge1xuICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDAsIGVuZDogNjAwXzAwMCB9O1xuICBhc3NlcnQuZXF1YWwoaXNJbnN0YW50V2lkdGgoZHVyYXRpb25XaWR0aFB4KDFfMDAwLCAxXzAwMCwgdmlldywgMTAwMCkpLCB0cnVlLCAnemVybyBkdXJhdGlvbiA9IHBpcCcpO1xuICAvLyAycHggdHJ1ZSB3aWR0aDogYmVsb3cgdGhlIHBpcCB0aHJlc2hvbGQgXHUyMDE0IGJ1dCBNSU5fQkFSX1BYIGV4aXN0cyBzbyBhIGJhciB0aGF0IHBhc3NlcyB0aGUgdGhyZXNob2xkIGlzIG5ldmVyIHJlbmRlcmVkIHRoaW5uZXIuXG4gIGFzc2VydC5vayhNSU5fQkFSX1BYID49IDIgJiYgTUlOX0JBUl9QWCA8IElOU1RBTlRfVEhSRVNIT0xEX1BYKTtcbiAgY29uc3Qgd2lkZSA9IGR1cmF0aW9uV2lkdGhQeCgwLCAzXzYwMCwgdmlldywgMTAwMCk7IC8vIDZweFxuICBhc3NlcnQuZXF1YWwoaXNJbnN0YW50V2lkdGgod2lkZSksIGZhbHNlKTtcbn0pO1xuXG4vLyAtLSBFZGdlIGNvbnRpbnVhdGlvbiAodGhlIGNsaXBwZWQtc3BhbiBmYWRlKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdlZGdlQ29udGludWF0aW9uOiBjbGlwcGVkIGVuZHMgYXJlIGZsYWdnZWQ7IGZ1bGx5IHZpc2libGUgc3BhbnMgYXJlIG5vdCcsICgpID0+IHtcbiAgLy8gMTAwMHB4IHBsb3Qgb3ZlciA2MDBzIFx1MjE5MiA2MDBtcyBwZXIgcHguXG4gIGNvbnN0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogNjAwXzAwMCwgZW5kOiAxXzIwMF8wMDAgfTtcbiAgY29uc3QgaW5zaWRlID0gZWRnZUNvbnRpbnVhdGlvbig3MDBfMDAwLCA5MDBfMDAwLCB2aWV3LCAxMDAwLCAxMik7XG4gIGFzc2VydC5kZWVwRXF1YWwoaW5zaWRlLCB7IGxlZnQ6IGZhbHNlLCByaWdodDogZmFsc2UgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZWRnZUNvbnRpbnVhdGlvbigxMDBfMDAwLCA5MDBfMDAwLCB2aWV3LCAxMDAwLCAxMiksIHsgbGVmdDogdHJ1ZSwgcmlnaHQ6IGZhbHNlIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGVkZ2VDb250aW51YXRpb24oNzAwXzAwMCwgMV81MDBfMDAwLCB2aWV3LCAxMDAwLCAxMiksIHsgbGVmdDogZmFsc2UsIHJpZ2h0OiB0cnVlIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGVkZ2VDb250aW51YXRpb24oMTAwXzAwMCwgMV81MDBfMDAwLCB2aWV3LCAxMDAwLCAxMiksIHsgbGVmdDogdHJ1ZSwgcmlnaHQ6IHRydWUgfSk7XG59KTtcblxudGVzdCgnZWRnZUNvbnRpbnVhdGlvbjogYW4gZW5kIGNvaW5jaWRpbmcgd2l0aCB0aGUgd2luZG93IGVkZ2UgZ2VudWluZWx5IHN0YXJ0cy9lbmRzIHRoZXJlIFx1MjAxNCBubyBmYWRlJywgKCkgPT4ge1xuICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDYwMF8wMDAsIGVuZDogMV8yMDBfMDAwIH07XG4gIGFzc2VydC5kZWVwRXF1YWwoZWRnZUNvbnRpbnVhdGlvbih2aWV3LnN0YXJ0LCA5MDBfMDAwLCB2aWV3LCAxMDAwLCAxMiksIHsgbGVmdDogZmFsc2UsIHJpZ2h0OiBmYWxzZSB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChlZGdlQ29udGludWF0aW9uKDcwMF8wMDAsIHZpZXcuZW5kLCB2aWV3LCAxMDAwLCAxMiksIHsgbGVmdDogZmFsc2UsIHJpZ2h0OiBmYWxzZSB9KTtcbiAgLy8gXHUyMDI2aW5jbHVkaW5nIHN1Yi1oYWxmLXBpeGVsIG92ZXJoYW5nczogdGhlIGRldmljZS1waXhlbCB2aWV3IHNuYXAgY2FuIHNoaWZ0IGFuIGV4YWN0IGVkZ2UgYnkgdXAgdG8gYSBwaXhlbC5cbiAgYXNzZXJ0LmRlZXBFcXVhbChlZGdlQ29udGludWF0aW9uKHZpZXcuc3RhcnQgLSAyOTksIDkwMF8wMDAsIHZpZXcsIDEwMDAsIDEyKSwgeyBsZWZ0OiBmYWxzZSwgcmlnaHQ6IGZhbHNlIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGVkZ2VDb250aW51YXRpb24oNzAwXzAwMCwgdmlldy5lbmQgKyAyOTksIHZpZXcsIDEwMDAsIDEyKSwgeyBsZWZ0OiBmYWxzZSwgcmlnaHQ6IGZhbHNlIH0pO1xuICAvLyBBIHJlYWwgb3ZlcmhhbmcgcGFzdCB0aGUgc2xhY2sgZmFkZXMuXG4gIGFzc2VydC5lcXVhbChlZGdlQ29udGludWF0aW9uKHZpZXcuc3RhcnQgLSA2MDEsIDkwMF8wMDAsIHZpZXcsIDEwMDAsIDEyKS5sZWZ0LCB0cnVlKTtcbiAgYXNzZXJ0LmVxdWFsKGVkZ2VDb250aW51YXRpb24oNzAwXzAwMCwgdmlldy5lbmQgKyA2MDEsIHZpZXcsIDEwMDAsIDEyKS5yaWdodCwgdHJ1ZSk7XG59KTtcblxudGVzdCgnZWRnZUNvbnRpbnVhdGlvbjogYSBzdHViIG5vdCByZWFjaGluZyB0aHJvdWdoIHRoZSBmYWRlIHpvbmUgc3RheXMgYSB2aXNpYmxlIHN0dWInLCAoKSA9PiB7XG4gIGNvbnN0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogNjAwXzAwMCwgZW5kOiAxXzIwMF8wMDAgfTsgLy8gNjAwbXMgcGVyIHB4XG4gIC8vIENvbnRpbnVlcyBmYXIgbGVmdCBidXQgb25seSA1cHggcG9rZSBpbiAoPCAxMnB4IHpvbmUpOiBmYWRpbmcgaXQgd291bGQgZXJhc2UgaXQgZW50aXJlbHkgXHUyMDE0IG5vIGZhZGUuXG4gIGFzc2VydC5kZWVwRXF1YWwoZWRnZUNvbnRpbnVhdGlvbigwLCB2aWV3LnN0YXJ0ICsgNSAqIDYwMCwgdmlldywgMTAwMCwgMTIpLCB7IGxlZnQ6IGZhbHNlLCByaWdodDogZmFsc2UgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZWRnZUNvbnRpbnVhdGlvbih2aWV3LmVuZCAtIDUgKiA2MDAsIDlfOTk5Xzk5OSwgdmlldywgMTAwMCwgMTIpLCB7IGxlZnQ6IGZhbHNlLCByaWdodDogZmFsc2UgfSk7XG4gIC8vIFJlYWNoaW5nIGV4YWN0bHkgdGhyb3VnaCB0aGUgem9uZSBxdWFsaWZpZXMuXG4gIGFzc2VydC5lcXVhbChlZGdlQ29udGludWF0aW9uKDAsIHZpZXcuc3RhcnQgKyAxMiAqIDYwMCwgdmlldywgMTAwMCwgMTIpLmxlZnQsIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoZWRnZUNvbnRpbnVhdGlvbih2aWV3LmVuZCAtIDEyICogNjAwLCA5Xzk5OV85OTksIHZpZXcsIDEwMDAsIDEyKS5yaWdodCwgdHJ1ZSk7XG59KTtcblxudGVzdCgnZWRnZUNvbnRpbnVhdGlvbjogYW4gb25nb2luZyBiYXIgYXQgdGhlIGxpdmUgZWRnZSBuZXZlciBmYWRlcyAodGhlIGNhbGxlciBwYXNzZXMgZW5kTXMgPSBub3csIGluc2lkZSB0aGUgdmlldyknLCAoKSA9PiB7XG4gIGNvbnN0IG5vdyA9IDFfMTUwXzAwMDtcbiAgY29uc3QgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiA2MDBfMDAwLCBlbmQ6IDFfMjAwXzAwMCB9OyAvLyBmb2xsb3cgbGVhZCBrZWVwcyBub3cgPCB2aWV3LmVuZFxuICBhc3NlcnQuZGVlcEVxdWFsKGVkZ2VDb250aW51YXRpb24oNzAwXzAwMCwgbm93LCB2aWV3LCAxMDAwLCAxMiksIHsgbGVmdDogZmFsc2UsIHJpZ2h0OiBmYWxzZSB9KTtcbn0pO1xuXG50ZXN0KCdlZGdlQ29udGludWF0aW9uOiBkZWdlbmVyYXRlIHZpZXcgb3IgcGxvdCB3aWR0aCBmbGFncyBub3RoaW5nJywgKCkgPT4ge1xuICBhc3NlcnQuZGVlcEVxdWFsKGVkZ2VDb250aW51YXRpb24oMCwgMTAwLCB7IHN0YXJ0OiA1LCBlbmQ6IDUgfSwgMTAwMCwgMTIpLCB7IGxlZnQ6IGZhbHNlLCByaWdodDogZmFsc2UgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZWRnZUNvbnRpbnVhdGlvbigwLCAxMDAsIHsgc3RhcnQ6IDAsIGVuZDogMTAwMCB9LCAwLCAxMiksIHsgbGVmdDogZmFsc2UsIHJpZ2h0OiBmYWxzZSB9KTtcbn0pO1xuXG4vLyAtLSBWaXNpYmxlLXdpbmRvdyBwYWNraW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ3BhY2tWaXNpYmxlVHJhY2tzOiBhIHBhcmFsbGVsaXNtIGJ1cnN0IG91dHNpZGUgdGhlIHdpbmRvdyBkb2VzIG5vdCBpbmZsYXRlIHRoZSBsYW5lJywgKCkgPT4ge1xuICBjb25zdCBpdGVtczogUGFja0l0ZW1bXSA9IFtcbiAgICB7IGlkOiAnYjEnLCBzdGFydDogMCwgZW5kOiAxMDAgfSxcbiAgICB7IGlkOiAnYjInLCBzdGFydDogMTAsIGVuZDogOTAgfSxcbiAgICB7IGlkOiAnYjMnLCBzdGFydDogMjAsIGVuZDogODAgfSxcbiAgICB7IGlkOiAnYjQnLCBzdGFydDogMzAsIGVuZDogNzAgfSxcbiAgICAvLyBSZWNlbnQsIHNlcmlhbCBydW5zLlxuICAgIHsgaWQ6ICdyMScsIHN0YXJ0OiAxXzAwMCwgZW5kOiAxXzEwMCB9LFxuICAgIHsgaWQ6ICdyMicsIHN0YXJ0OiAxXzIwMCwgZW5kOiAxXzMwMCB9LFxuICBdO1xuICBjb25zdCBvdmVyID0gcGFja1Zpc2libGVUcmFja3MoaXRlbXMsIHsgc3RhcnQ6IDk1MCwgZW5kOiAxXzQwMCB9KTtcbiAgYXNzZXJ0LmVxdWFsKG92ZXIudHJhY2tDb3VudCwgMSwgJ29ubHkgdGhlIHNlcmlhbCBydW5zIGFyZSB2aXNpYmxlJyk7XG4gIGFzc2VydC5kZWVwRXF1YWwob3Zlci50cmFja3Muc2xpY2UoMCwgNCksIFstMSwgLTEsIC0xLCAtMV0sICdidXJzdCBpdGVtcyBhcmUgb3V0IG9mIHZpZXcnKTtcbiAgY29uc3QgYnVyc3QgPSBwYWNrVmlzaWJsZVRyYWNrcyhpdGVtcywgeyBzdGFydDogMCwgZW5kOiAyMDAgfSk7XG4gIGFzc2VydC5lcXVhbChidXJzdC50cmFja0NvdW50LCA0LCAnbG9va2luZyBBVCB0aGUgYnVyc3Qgc3RpbGwgc2hvd3MgNCB0cmFja3MnKTtcbn0pO1xuXG50ZXN0KCdwYWNrVmlzaWJsZVRyYWNrczogcGFydGlhbCBvdmVybGFwIGNvdW50czsgZW1wdHkgd2luZG93IGNvbGxhcHNlcyB0byBvbmUgdHJhY2snLCAoKSA9PiB7XG4gIGNvbnN0IGl0ZW1zOiBQYWNrSXRlbVtdID0gW1xuICAgIHsgaWQ6ICdhJywgc3RhcnQ6IDAsIGVuZDogNTAwIH0sXG4gICAgeyBpZDogJ2InLCBzdGFydDogNDAwLCBlbmQ6IDkwMCB9LFxuICBdO1xuICAvLyBXaW5kb3cgY2xpcHMgYm90aCwgdGhleSBvdmVybGFwIGVhY2ggb3RoZXIgXHUyMTkyIG11bHRpcGxlIHRyYWNrcy5cbiAgYXNzZXJ0LmVxdWFsKHBhY2tWaXNpYmxlVHJhY2tzKGl0ZW1zLCB7IHN0YXJ0OiA0MjAsIGVuZDogNDgwIH0pLnRyYWNrQ291bnQsIDIpO1xuICBjb25zdCBlbXB0eSA9IHBhY2tWaXNpYmxlVHJhY2tzKGl0ZW1zLCB7IHN0YXJ0OiAyXzAwMCwgZW5kOiAzXzAwMCB9KTtcbiAgYXNzZXJ0LmVxdWFsKGVtcHR5LnRyYWNrQ291bnQsIDEpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGVtcHR5LnRyYWNrcywgWy0xLCAtMV0pO1xufSk7XG5cbnRlc3QoJ3BhY2tWaXNpYmxlVHJhY2tzOiBvbmdvaW5nIGludGVydmFscyAoZW5kIG51bGwpIGludGVyc2VjdCBldmVyeSBsYXRlciB3aW5kb3cnLCAoKSA9PiB7XG4gIGNvbnN0IGl0ZW1zOiBQYWNrSXRlbVtdID0gW1xuICAgIHsgaWQ6ICdsaXZlJywgc3RhcnQ6IDEwMCwgZW5kOiBudWxsIH0sXG4gICAgeyBpZDogJ3gnLCBzdGFydDogNV8wMDAsIGVuZDogNl8wMDAgfSxcbiAgXTtcbiAgY29uc3QgciA9IHBhY2tWaXNpYmxlVHJhY2tzKGl0ZW1zLCB7IHN0YXJ0OiA0XzAwMCwgZW5kOiA3XzAwMCB9KTtcbiAgYXNzZXJ0LmVxdWFsKHIudHJhY2tDb3VudCwgMiwgJ3RoZSBvbmdvaW5nIHJ1biBzdGlsbCBvY2N1cGllcyBhIHRyYWNrJyk7XG4gIGFzc2VydC5ub3RFcXVhbChyLnRyYWNrc1swXSwgLTEpO1xufSk7XG5cbnRlc3QoJ3BhY2tWaXNpYmxlVHJhY2tzOiBhc3NpZ25tZW50IGlzIHN0YWJsZSB3aGlsZSB0aGUgd2luZG93IHNsaWRlcyBvdmVyIGFuIHVuY2hhbmdlZCB2aXNpYmxlIHNldCcsICgpID0+IHtcbiAgY29uc3QgaXRlbXM6IFBhY2tJdGVtW10gPSBbXG4gICAgeyBpZDogJ2EnLCBzdGFydDogMV8wMDAsIGVuZDogMl8wMDAgfSxcbiAgICB7IGlkOiAnYicsIHN0YXJ0OiAxXzUwMCwgZW5kOiAyXzUwMCB9LFxuICAgIHsgaWQ6ICdjJywgc3RhcnQ6IDJfNjAwLCBlbmQ6IDNfMDAwIH0sXG4gIF07XG4gIGNvbnN0IGZpcnN0ID0gcGFja1Zpc2libGVUcmFja3MoaXRlbXMsIHsgc3RhcnQ6IDkwMCwgZW5kOiAzXzEwMCB9KTtcbiAgZm9yIChsZXQgZHQgPSAwOyBkdCA8IDgwOyBkdCArPSA3KSB7XG4gICAgLy8gQWxsIHNsaWRlcyBrZWVwIHRoZSBzYW1lIGl0ZW1zIHZpc2libGUuXG4gICAgY29uc3QgciA9IHBhY2tWaXNpYmxlVHJhY2tzKGl0ZW1zLCB7IHN0YXJ0OiA5MDAgKyBkdCwgZW5kOiAzXzEwMCArIGR0IH0pO1xuICAgIGFzc2VydC5kZWVwRXF1YWwoci50cmFja3MsIGZpcnN0LnRyYWNrcywgYHNsaWRlICske2R0fSBrZWVwcyBpZGVudGljYWwgYXNzaWdubWVudHNgKTtcbiAgICBhc3NlcnQuZXF1YWwoci50cmFja0NvdW50LCBmaXJzdC50cmFja0NvdW50KTtcbiAgfVxufSk7XG5cbi8vIC0tIE11bHRpLXJvdyBpdGVtcyAoc3ViLXNwYW4gZmFtaWxpZXMgYXJlIG9uZSBwYWNrIGl0ZW0gYHJvd3NgIHRhbGwpIC0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ3BhY2s6IGEgbXVsdGktcm93IGl0ZW0gdGFrZXMgYSBydW4gb2YgY29uc2VjdXRpdmUgZnJlZSB0cmFja3MgYW5kIGJsb2NrcyBhbGwgb2YgdGhlbScsICgpID0+IHtcbiAgY29uc3QgeyB0cmFja3MsIHRyYWNrQ291bnQgfSA9IHBhY2tPZihbXG4gICAgeyBpZDogJ2EnLCBzdGFydDogMCwgZW5kOiAxMDAsIHJvd3M6IDMgfSxcbiAgICB7IGlkOiAnYicsIHN0YXJ0OiAxMCwgZW5kOiA1MCB9LFxuICAgIHsgaWQ6ICdjJywgc3RhcnQ6IDE1MCwgZW5kOiAyMDAgfSxcbiAgXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwodHJhY2tzLCBbMCwgMywgMF0pO1xuICBhc3NlcnQuZXF1YWwodHJhY2tDb3VudCwgNCk7XG59KTtcblxudGVzdCgncGFjazogYSBtdWx0aS1yb3cgaXRlbSBza2lwcyBwYXN0IGEgYnVzeSB0cmFjayBpbnNpZGUgaXRzIGNhbmRpZGF0ZSBydW4nLCAoKSA9PiB7XG4gIGNvbnN0IHsgdHJhY2tzLCB0cmFja0NvdW50IH0gPSBwYWNrT2YoW1xuICAgIHsgaWQ6ICd4Jywgc3RhcnQ6IDAsIGVuZDogMTAwIH0sXG4gICAgeyBpZDogJ3knLCBzdGFydDogMCwgZW5kOiAxMDAgfSxcbiAgICB7IGlkOiAneicsIHN0YXJ0OiAwLCBlbmQ6IDEwMCB9LFxuICAgIHsgaWQ6ICdibGsnLCBzdGFydDogNSwgZW5kOiA1MCwgcm93czogMiB9LFxuICBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh0cmFja3Muc2xpY2UoMCwgMyksIFswLCAxLCAyXSk7XG4gIGFzc2VydC5lcXVhbCh0cmFja3NbM10sIDMpO1xuICBhc3NlcnQuZXF1YWwodHJhY2tDb3VudCwgNSk7XG4gIGNvbnN0IGdhcCA9IHBhY2tPZihbXG4gICAgeyBpZDogJ3gnLCBzdGFydDogMCwgZW5kOiAxMDAgfSxcbiAgICB7IGlkOiAneScsIHN0YXJ0OiAwLCBlbmQ6IDQgfSxcbiAgICB7IGlkOiAneicsIHN0YXJ0OiAwLCBlbmQ6IDQgfSxcbiAgICB7IGlkOiAndycsIHN0YXJ0OiAwLCBlbmQ6IDEwMCB9LFxuICAgIHsgaWQ6ICdibGsnLCBzdGFydDogNSwgZW5kOiA1MCwgcm93czogMiB9LFxuICBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChnYXAudHJhY2tzLCBbMSwgMiwgMywgMCwgMl0sICd0aGUgYmxvY2sgcmV1c2VzIHRoZSBmcmVlZCBtaWRkbGUgcm93cycpO1xuICBhc3NlcnQuZXF1YWwoZ2FwLnRyYWNrQ291bnQsIDQpO1xufSk7XG5cbnRlc3QoJ3BhY2tWaXNpYmxlVHJhY2tzOiBhIG11bHRpLXJvdyBpdGVtIGNvdW50cyBldmVyeSByb3cgaXQgaG9sZHMnLCAoKSA9PiB7XG4gIGNvbnN0IGl0ZW1zOiBQYWNrSXRlbVtdID0gW3sgaWQ6ICdmYW0nLCBzdGFydDogMCwgZW5kOiAxMDAsIHJvd3M6IDQgfV07XG4gIGFzc2VydC5lcXVhbChwYWNrVmlzaWJsZVRyYWNrcyhpdGVtcywgeyBzdGFydDogMTAsIGVuZDogMjAgfSkudHJhY2tDb3VudCwgNCk7XG4gIGFzc2VydC5lcXVhbChwYWNrVmlzaWJsZVRyYWNrcyhpdGVtcywgeyBzdGFydDogNTAwLCBlbmQ6IDYwMCB9KS50cmFja0NvdW50LCAxKTtcbn0pO1xuXG50ZXN0KCdUcmFja0FsbG9jYXRvcjogbXVsdGktcm93IGl0ZW1zIHBhY2ssIHN0aWNrIGFuZCBjb3VudCBsaWtlIHNpbmdsZSByb3dzJywgKCkgPT4ge1xuICBjb25zdCBmYW06IFBhY2tJdGVtID0geyBpZDogJ2ZhbScsIHN0YXJ0OiAwLCBlbmQ6IDEwMCwgcm93czogMyB9O1xuICBjb25zdCBhOiBQYWNrSXRlbSA9IHsgaWQ6ICdhJywgc3RhcnQ6IDEwLCBlbmQ6IDYwIH07XG4gIGNvbnN0IGI6IFBhY2tJdGVtID0geyBpZDogJ2InLCBzdGFydDogMjAwLCBlbmQ6IDI2MCB9O1xuICBjb25zdCBhbGxvYyA9IG5ldyBUcmFja0FsbG9jYXRvcigpO1xuICBjb25zdCBmaXJzdCA9IGFsbG9jLmFzc2lnbihbZmFtLCBhLCBiXSwgeyBzdGFydDogMCwgZW5kOiAzMDAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZmlyc3QudHJhY2tzLCBbMCwgMywgMF0sICd0aGUgYmxvY2sgaG9sZHMgcm93cyAwLi4yOyBhIHNpdHMgdW5kZXIgaXQ7IGIgcmV1c2VzIHJvdyAwIGFmdGVyIGl0Jyk7XG4gIGFzc2VydC5lcXVhbChmaXJzdC50cmFja0NvdW50LCA0KTtcbiAgLy8gQSBuZXdjb21lciB0aGF0IG92ZXJsYXBzIHRoZSBibG9jayBtdXN0IGNsZWFyIGl0cyB3aG9sZSBydW4gXHUyMDE0IGV2ZW4gdGhlIHJvd3MgdGhlIGJsb2NrIGhvbGRzLlxuICBjb25zdCBjOiBQYWNrSXRlbSA9IHsgaWQ6ICdjJywgc3RhcnQ6IDIwLCBlbmQ6IDMwIH07XG4gIGNvbnN0IHNlY29uZCA9IGFsbG9jLmFzc2lnbihbZmFtLCBhLCBiLCBjXSwgeyBzdGFydDogMCwgZW5kOiAzMDAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoc2Vjb25kLnRyYWNrcywgWzAsIDMsIDAsIDRdLCAncm93cyB1bmRlciB0aGUgYmxvY2sgYXJlIGJsb2NrZWQsIG5vdCBmcmVlJyk7XG4gIC8vIFRoZSBibG9jayBzY3JvbGxzIG91dDogdGhlIGxhbmUgc2hyaW5rcyBhbmQgYSBrZWVwcyBpdHMgcm93LlxuICBjb25zdCBsYXRlciA9IGFsbG9jLmFzc2lnbihbZmFtLCBhLCBiLCBjXSwgeyBzdGFydDogMTUwLCBlbmQ6IDMwMCB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChsYXRlci50cmFja3MsIFstMSwgLTEsIDAsIC0xXSk7XG4gIGFzc2VydC5lcXVhbChsYXRlci50cmFja0NvdW50LCAxKTtcbn0pO1xuXG4vLyAtLSByZXNvbHZlUGFyZW50cyAvIHBhY2tGYW1pbHkgKHN1Yi1zcGFucykgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdyZXNvbHZlUGFyZW50czogc2FtZS1sYW5lIHBhcmVudHMgbmVzdDsgbWlzc2luZywgY3Jvc3MtbGFuZSBhbmQgc2VsZiBwYXJlbnRzIGxlYXZlIGEgcm9vdCcsICgpID0+IHtcbiAgY29uc3QgcGFyZW50ID0gcmVzb2x2ZVBhcmVudHMoW1xuICAgIHsgaWQ6ICdydW4nLCBsYW5lSWQ6ICdjaScgfSxcbiAgICB7IGlkOiAnYnVpbGQnLCBsYW5lSWQ6ICdjaScsIHBhcmVudElkOiAncnVuJyB9LFxuICAgIHsgaWQ6ICdvcnBoYW4nLCBsYW5lSWQ6ICdjaScsIHBhcmVudElkOiAnbm9wZScgfSxcbiAgICB7IGlkOiAnZWxzZXdoZXJlJywgbGFuZUlkOiAnZGVwbG95JywgcGFyZW50SWQ6ICdydW4nIH0sXG4gICAgeyBpZDogJ21lJywgbGFuZUlkOiAnY2knLCBwYXJlbnRJZDogJ21lJyB9LFxuICAgIHsgaWQ6ICd1bml0JywgbGFuZUlkOiAnY2knLCBwYXJlbnRJZDogJ2J1aWxkJyB9LFxuICBdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChwYXJlbnQsIFstMSwgMCwgLTEsIC0xLCAtMSwgMV0pO1xufSk7XG5cbnRlc3QoJ3Jlc29sdmVQYXJlbnRzOiBhIGN5Y2xlIGlzIGN1dCBzbyB0aGUgcmVzdWx0IGlzIGEgZm9yZXN0JywgKCkgPT4ge1xuICBjb25zdCBwYXJlbnQgPSByZXNvbHZlUGFyZW50cyhbXG4gICAgeyBpZDogJ2EnLCBwYXJlbnRJZDogJ2MnIH0sXG4gICAgeyBpZDogJ2InLCBwYXJlbnRJZDogJ2EnIH0sXG4gICAgeyBpZDogJ2MnLCBwYXJlbnRJZDogJ2InIH0sXG4gICAgeyBpZDogJ2QnLCBwYXJlbnRJZDogJ2MnIH0sXG4gIF0pO1xuICBhc3NlcnQuZXF1YWwocGFyZW50WzBdLCAtMSwgJ3RoZSBsb3dlc3QtaW5kZXggbWVtYmVyIG9mIHRoZSBjeWNsZSBiZWNvbWVzIHRoZSByb290Jyk7XG4gIGFzc2VydC5kZWVwRXF1YWwocGFyZW50LnNsaWNlKDEpLCBbMCwgMSwgMl0pO1xuICAvLyBObyBhbmNlc3RvciB3YWxrIGxvb3BzIGZvcmV2ZXIuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFyZW50Lmxlbmd0aDsgaSsrKSB7XG4gICAgbGV0IGogPSBpO1xuICAgIGxldCBzdGVwcyA9IDA7XG4gICAgd2hpbGUgKHBhcmVudFtqXSA+PSAwKSB7XG4gICAgICBqID0gcGFyZW50W2pdO1xuICAgICAgc3RlcHMrKztcbiAgICAgIGFzc2VydC5vayhzdGVwcyA8PSBwYXJlbnQubGVuZ3RoLCAnYWN5Y2xpYycpO1xuICAgIH1cbiAgfVxufSk7XG5cbnRlc3QoJ3BhY2tGYW1pbHk6IHRoZSByb290IHNpdHMgb24gcm93IDAsIGNoaWxkcmVuIGZpcnN0LWZpdCB1bmRlciBpdCwgdGhlIGJsb2NrIGlzIDEgKyBjaGlsZCByb3dzIHRhbGwnLCAoKSA9PiB7XG4gIGNvbnN0IGZhbSA9IHBhY2tGYW1pbHkoe1xuICAgIGlkOiAncnVuJyxcbiAgICBzdGFydDogMCxcbiAgICBlbmQ6IDEwMCxcbiAgICBjaGlsZHJlbjogW1xuICAgICAgeyBpZDogJ2J1aWxkJywgc3RhcnQ6IDUsIGVuZDogNDAgfSxcbiAgICAgIHsgaWQ6ICd0ZXN0LWEnLCBzdGFydDogNDAsIGVuZDogODAgfSxcbiAgICAgIHsgaWQ6ICd0ZXN0LWInLCBzdGFydDogNDIsIGVuZDogNzAgfSwgLy8gb3ZlcmxhcHMgdGVzdC1hIFx1MjE5MiBzZWNvbmQgY2hpbGQgcm93XG4gICAgICB7IGlkOiAncHJvbW90ZScsIHN0YXJ0OiA4NSwgZW5kOiA5NSB9LFxuICAgIF0sXG4gIH0pO1xuICBhc3NlcnQuZXF1YWwoZmFtLnJvd3MsIDMpO1xuICBhc3NlcnQuZXF1YWwoZmFtLnN0YXJ0LCAwKTtcbiAgYXNzZXJ0LmVxdWFsKGZhbS5lbmQsIDEwMCk7XG4gIGFzc2VydC5lcXVhbChmYW0udG9wcy5nZXQoJ3J1bicpLCAwKTtcbiAgYXNzZXJ0LmVxdWFsKGZhbS50b3BzLmdldCgnYnVpbGQnKSwgMSk7XG4gIGFzc2VydC5lcXVhbChmYW0udG9wcy5nZXQoJ3Rlc3QtYScpLCAxKTtcbiAgYXNzZXJ0LmVxdWFsKGZhbS50b3BzLmdldCgndGVzdC1iJyksIDIpO1xuICBhc3NlcnQuZXF1YWwoZmFtLnRvcHMuZ2V0KCdwcm9tb3RlJyksIDEpO1xufSk7XG5cbnRlc3QoJ3BhY2tGYW1pbHk6IGEgY2hpbGQgd2l0aCBubyBzaWJsaW5ncyBvdmVybGFwcGluZyBwYWNrcyBvbiB0aGUgcm93IHJpZ2h0IHVuZGVyIGl0cyBwYXJlbnQnLCAoKSA9PiB7XG4gIGNvbnN0IGZhbSA9IHBhY2tGYW1pbHkoeyBpZDogJ3AnLCBzdGFydDogMCwgZW5kOiAxMCwgY2hpbGRyZW46IFt7IGlkOiAnYycsIHN0YXJ0OiAyLCBlbmQ6IDggfV0gfSk7XG4gIGFzc2VydC5lcXVhbChmYW0ucm93cywgMik7XG4gIGFzc2VydC5kZWVwRXF1YWwoWy4uLmZhbS50b3BzXSwgW1sncCcsIDBdLCBbJ2MnLCAxXV0pO1xufSk7XG5cbnRlc3QoJ3BhY2tGYW1pbHk6IG5lc3RlZCBmYW1pbGllcyBzdGFjayBcdTIwMTQgYSBncmFuZGNoaWxkIHNpdHMgdW5kZXIgaXRzIHBhcmVudCwgb2Zmc2V0IGJ5IHdoZXJlIHRoYXQgcGFyZW50IHBhY2tlZCcsICgpID0+IHtcbiAgY29uc3QgZmFtID0gcGFja0ZhbWlseSh7XG4gICAgaWQ6ICdydW4nLFxuICAgIHN0YXJ0OiAwLFxuICAgIGVuZDogMTAwLFxuICAgIGNoaWxkcmVuOiBbXG4gICAgICB7IGlkOiAnYnVpbGQnLCBzdGFydDogMCwgZW5kOiA1MCB9LFxuICAgICAge1xuICAgICAgICBpZDogJ3Rlc3QnLFxuICAgICAgICBzdGFydDogMTAsXG4gICAgICAgIGVuZDogOTAsXG4gICAgICAgIGNoaWxkcmVuOiBbXG4gICAgICAgICAgeyBpZDogJ3VuaXQnLCBzdGFydDogMTIsIGVuZDogNDAgfSxcbiAgICAgICAgICB7IGlkOiAnZTJlJywgc3RhcnQ6IDE1LCBlbmQ6IDg1IH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIF0sXG4gIH0pO1xuICBhc3NlcnQuZXF1YWwoZmFtLnRvcHMuZ2V0KCdidWlsZCcpLCAxKTtcbiAgYXNzZXJ0LmVxdWFsKGZhbS50b3BzLmdldCgndGVzdCcpLCAyKTtcbiAgYXNzZXJ0LmVxdWFsKGZhbS50b3BzLmdldCgndW5pdCcpLCAzKTtcbiAgYXNzZXJ0LmVxdWFsKGZhbS50b3BzLmdldCgnZTJlJyksIDQpO1xuICBhc3NlcnQuZXF1YWwoZmFtLnJvd3MsIDUpO1xufSk7XG5cbnRlc3QoJ3BhY2tGYW1pbHk6IHRoZSBleHRlbnQgaXMgdGhlIHVuaW9uLCBhbmQgYW55IG9uZ29pbmcgbWVtYmVyIG1ha2VzIHRoZSBibG9jayBvbmdvaW5nJywgKCkgPT4ge1xuICBjb25zdCBvdmVyID0gcGFja0ZhbWlseSh7IGlkOiAncCcsIHN0YXJ0OiAxMCwgZW5kOiAyMCwgY2hpbGRyZW46IFt7IGlkOiAnYycsIHN0YXJ0OiA1LCBlbmQ6IDMwIH1dIH0pO1xuICBhc3NlcnQuZXF1YWwob3Zlci5zdGFydCwgNSk7XG4gIGFzc2VydC5lcXVhbChvdmVyLmVuZCwgMzApO1xuICBjb25zdCBsaXZlID0gcGFja0ZhbWlseSh7IGlkOiAncCcsIHN0YXJ0OiAxMCwgZW5kOiAyMCwgY2hpbGRyZW46IFt7IGlkOiAnYycsIHN0YXJ0OiAxMiwgZW5kOiBudWxsIH1dIH0pO1xuICBhc3NlcnQuZXF1YWwobGl2ZS5lbmQsIG51bGwpO1xuICBjb25zdCBsaXZlUm9vdCA9IHBhY2tGYW1pbHkoeyBpZDogJ3AnLCBzdGFydDogMTAsIGVuZDogbnVsbCwgY2hpbGRyZW46IFt7IGlkOiAnYycsIHN0YXJ0OiAxMiwgZW5kOiAxNSB9XSB9KTtcbiAgYXNzZXJ0LmVxdWFsKGxpdmVSb290LmVuZCwgbnVsbCk7XG59KTtcblxudGVzdCgncGFja0ZhbWlseTogaW5zdGFudCBjaGlsZHJlbiAoZW5kID09IHN0YXJ0KSBzdGlsbCBnZXQgYSByb3cgZWFjaCB3aGVuIGNvaW5jaWRlbnQnLCAoKSA9PiB7XG4gIGNvbnN0IGZhbSA9IHBhY2tGYW1pbHkoe1xuICAgIGlkOiAncCcsXG4gICAgc3RhcnQ6IDAsXG4gICAgZW5kOiAxMCxcbiAgICBjaGlsZHJlbjogW1xuICAgICAgeyBpZDogJ2kxJywgc3RhcnQ6IDUsIGVuZDogNSB9LFxuICAgICAgeyBpZDogJ2kyJywgc3RhcnQ6IDUsIGVuZDogNSB9LFxuICAgIF0sXG4gIH0pO1xuICBhc3NlcnQuZXF1YWwoZmFtLnJvd3MsIDMpO1xuICBhc3NlcnQubm90RXF1YWwoZmFtLnRvcHMuZ2V0KCdpMScpLCBmYW0udG9wcy5nZXQoJ2kyJykpO1xufSk7XG5cbnRlc3QoJ3BhY2tGYW1pbHkgKyBwYWNrVHJhY2tzOiBhIGZhbWlseSBibG9jayBrZWVwcyB1bnJlbGF0ZWQgYmFycyBvdXQgb2YgaXRzIHJvd3MnLCAoKSA9PiB7XG4gIGNvbnN0IGZhbSA9IHBhY2tGYW1pbHkoeyBpZDogJ3J1bicsIHN0YXJ0OiAwLCBlbmQ6IDEwMCwgY2hpbGRyZW46IFt7IGlkOiAnYycsIHN0YXJ0OiAxMCwgZW5kOiA5MCB9XSB9KTtcbiAgY29uc3QgbGFuZSA9IHBhY2tUcmFja3MoW1xuICAgIHsgaWQ6ICdydW4nLCBzdGFydDogZmFtLnN0YXJ0LCBlbmQ6IGZhbS5lbmQsIHJvd3M6IGZhbS5yb3dzIH0sXG4gICAgeyBpZDogJ290aGVyJywgc3RhcnQ6IDUwLCBlbmQ6IDYwIH0sXG4gIF0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGxhbmUudHJhY2tzLCBbMCwgMl0sICd0aGUgdW5yZWxhdGVkIGJhciBsYW5kcyB1bmRlciB0aGUgd2hvbGUgYmxvY2ssIG5ldmVyIGluc2lkZSBpdCcpO1xuICBhc3NlcnQuZXF1YWwobGFuZS50cmFja0NvdW50LCAzKTtcbn0pO1xuXG4vLyAtLSBUcmFja0FsbG9jYXRvciAoc3RpY2t5IHJvd3MpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHRpID0gKGlkOiBzdHJpbmcsIHN0YXJ0OiBudW1iZXIsIGVuZDogbnVtYmVyIHwgbnVsbCk6IFBhY2tJdGVtID0+ICh7IGlkLCBzdGFydCwgZW5kIH0pO1xuXG50ZXN0KCdUcmFja0FsbG9jYXRvcjogYSBmcmVzaCBhbGxvY2F0b3IgcmVwcm9kdWNlcyB0aGUgc3RhdGVsZXNzIGZpcnN0LWZpdCBwYWNrZXIgZXhhY3RseScsICgpID0+IHtcbiAgY29uc3QgaXRlbXMgPSBbdGkoJ2EnLCAwLCAxMCksIHRpKCdiJywgNSwgMTUpLCB0aSgnYycsIDEyLCAyMCksIHRpKCdkJywgMTQsIDI1KSwgdGkoJ2UnLCA0MCwgNTApXTtcbiAgZm9yIChjb25zdCB2aWV3IG9mIFtcbiAgICB7IHN0YXJ0OiAwLCBlbmQ6IDMwIH0sXG4gICAgeyBzdGFydDogMTMsIGVuZDogNDUgfSxcbiAgICB7IHN0YXJ0OiAxMDAsIGVuZDogMjAwIH0sXG4gIF0pIHtcbiAgICBhc3NlcnQuZGVlcEVxdWFsKG5ldyBUcmFja0FsbG9jYXRvcigpLmFzc2lnbihpdGVtcywgdmlldyksIHBhY2tWaXNpYmxlVHJhY2tzKGl0ZW1zLCB2aWV3KSk7XG4gIH1cbn0pO1xuXG50ZXN0KCdUcmFja0FsbG9jYXRvcjogdmlzaWJsZSBpdGVtcyBrZWVwIHRoZWlyIHJvd3Mgd2hlbiBtZW1iZXJzaGlwIGNodXJuIHdvdWxkIHJlZmxvdyB0aGUgc3RhdGVsZXNzIHBhY2tlcicsICgpID0+IHtcbiAgY29uc3QgaXRlbXMgPSBbdGkoJ2EnLCAwLCAxMCksIHRpKCdiJywgMiwgMTIpLCB0aSgnYycsIDExLCAyMCldO1xuICBjb25zdCBhbGxvYyA9IG5ldyBUcmFja0FsbG9jYXRvcigpO1xuICBjb25zdCB2MSA9IGFsbG9jLmFzc2lnbihpdGVtcywgeyBzdGFydDogMCwgZW5kOiAxNSB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh2MSwgeyB0cmFja3M6IFswLCAxLCAwXSwgdHJhY2tDb3VudDogMiB9LCAnZmlyc3QgZmlsbCBpcyBwbGFpbiBmaXJzdC1maXQnKTtcbiAgY29uc3QgdjJ2aWV3ID0geyBzdGFydDogMTAuNSwgZW5kOiAyNSB9O1xuICBjb25zdCBzdGF0ZWxlc3MgPSBwYWNrVmlzaWJsZVRyYWNrcyhpdGVtcywgdjJ2aWV3KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChzdGF0ZWxlc3MudHJhY2tzLCBbLTEsIDAsIDFdLCAndGhlIHN0YXRlbGVzcyBwYWNrZXIgcmVzaHVmZmxlcycpO1xuICBjb25zdCB2MiA9IGFsbG9jLmFzc2lnbihpdGVtcywgdjJ2aWV3KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh2Mi50cmFja3MsIFstMSwgMSwgMF0sICdzdGlja3kgcm93czogYiBzdGF5cyBvbiAxLCBjIHN0YXlzIG9uIDAnKTtcbn0pO1xuXG50ZXN0KCdUcmFja0FsbG9jYXRvcjogYnVyc3QtdGhlbi1zaHJpbmsgXHUyMDE0IGhlaWdodCByZWNvdmVycyB3aXRob3V0IG1vdmluZyBzdXJ2aXZpbmcgcm93cycsICgpID0+IHtcbiAgY29uc3QgaXRlbXMgPSBbXG4gICAgdGkoJ2IxJywgMCwgMTApLFxuICAgIHRpKCdiMicsIDAsIDEwKSxcbiAgICB0aSgnYjMnLCAwLCAxMCksXG4gICAgdGkoJ2I0JywgMCwgMTApLFxuICAgIHRpKCdiNScsIDAsIDEwKSxcbiAgICB0aSgnbjEnLCAzMCwgNDApLFxuICAgIHRpKCduMicsIDM1LCA0NSksXG4gIF07XG4gIGNvbnN0IGFsbG9jID0gbmV3IFRyYWNrQWxsb2NhdG9yKCk7XG4gIGNvbnN0IHdpZGUgPSBhbGxvYy5hc3NpZ24oaXRlbXMsIHsgc3RhcnQ6IDAsIGVuZDogNTAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwod2lkZS50cmFja3MsIFswLCAxLCAyLCAzLCA0LCAwLCAxXSwgJ25ld2NvbWVycyBmaWxsIHRoZSBmcmVlZCBsb3cgdHJhY2tzJyk7XG4gIGFzc2VydC5lcXVhbCh3aWRlLnRyYWNrQ291bnQsIDUpO1xuICAvLyBUaGUgYnVyc3Qgc2Nyb2xscyBvZmY6IHRoZSBsYW5lIHNocmlua3MgdG8gYm90aCB2aXNpYmxlIHJvd3MsIGFuZCBuZWl0aGVyIHN1cnZpdm9yIG1vdmVzLlxuICBjb25zdCBhZnRlciA9IGFsbG9jLmFzc2lnbihpdGVtcywgeyBzdGFydDogMjUsIGVuZDogNjAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYWZ0ZXIudHJhY2tzLCBbLTEsIC0xLCAtMSwgLTEsIC0xLCAwLCAxXSk7XG4gIGFzc2VydC5lcXVhbChhZnRlci50cmFja0NvdW50LCAyLCAnaGVpZ2h0IHJlY292ZXJlZCBmcm9tIDUgdHJhY2tzIHRvIDInKTtcbn0pO1xuXG50ZXN0KCdUcmFja0FsbG9jYXRvcjogYSByZXR1cm5pbmcgaW50ZXJ2YWwgZ2V0cyBpdHMgb2xkIHJvdyBiYWNrIHdoZW4gc3RpbGwgZnJlZScsICgpID0+IHtcbiAgY29uc3QgaXRlbXMgPSBbdGkoJ2EnLCAwLCAxMCksIHRpKCdiJywgMCwgMTApLCB0aSgnYycsIDAsIDEwKV07XG4gIGNvbnN0IGFsbG9jID0gbmV3IFRyYWNrQWxsb2NhdG9yKCk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYWxsb2MuYXNzaWduKGl0ZW1zLCB7IHN0YXJ0OiAwLCBlbmQ6IDIwIH0pLnRyYWNrcywgWzAsIDEsIDJdKTtcbiAgLy8gU2Nyb2xsIGF3YXkgKG5vdGhpbmcgdmlzaWJsZSksIHRoZW4gY29tZSBiYWNrOiBldmVyeSByb3cgaXMgcmVzdG9yZWQuXG4gIGFzc2VydC5kZWVwRXF1YWwoYWxsb2MuYXNzaWduKGl0ZW1zLCB7IHN0YXJ0OiA1MCwgZW5kOiA2MCB9KS50cmFja3MsIFstMSwgLTEsIC0xXSk7XG4gIGFzc2VydC5lcXVhbChhbGxvYy5hc3NpZ24oaXRlbXMsIHsgc3RhcnQ6IDUwLCBlbmQ6IDYwIH0pLnRyYWNrQ291bnQsIDEpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGFsbG9jLmFzc2lnbihpdGVtcywgeyBzdGFydDogMCwgZW5kOiAyMCB9KS50cmFja3MsIFswLCAxLCAyXSk7XG59KTtcblxudGVzdCgnVHJhY2tBbGxvY2F0b3I6IGEgcmV0dXJuaW5nIGludGVydmFsIHdob3NlIG9sZCByb3cgaXMgbm93IHRha2VuIGZhbGxzIHRvIHRoZSBsb3dlc3QgZnJlZSBvbmUnLCAoKSA9PiB7XG4gIGNvbnN0IGFsbG9jID0gbmV3IFRyYWNrQWxsb2NhdG9yKCk7XG4gIGNvbnN0IGEgPSB0aSgnYScsIDAsIDEwKTtcbiAgY29uc3QgYiA9IHRpKCdiJywgMCwgNjApO1xuICBhc3NlcnQuZGVlcEVxdWFsKGFsbG9jLmFzc2lnbihbYV0sIHsgc3RhcnQ6IDAsIGVuZDogMjAgfSkudHJhY2tzLCBbMF0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGFsbG9jLmFzc2lnbihbYSwgYl0sIHsgc3RhcnQ6IDUwLCBlbmQ6IDYwIH0pLnRyYWNrcywgWy0xLCAwXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYWxsb2MuYXNzaWduKFthLCBiXSwgeyBzdGFydDogMCwgZW5kOiA2MCB9KS50cmFja3MsIFsxLCAwXSk7XG59KTtcblxudGVzdCgnVHJhY2tBbGxvY2F0b3I6IGEgbGl2ZSBhcnJpdmFsIGF0IG5vdyBuZXZlciBkaXNwbGFjZXMgZXhpc3Rpbmcgcm93cyAoU1NFIGNhc2UpJywgKCkgPT4ge1xuICBjb25zdCBhbGxvYyA9IG5ldyBUcmFja0FsbG9jYXRvcigpO1xuICBjb25zdCBhID0gdGkoJ3J1bi1hJywgMCwgbnVsbCk7IC8vIG9uZ29pbmdcbiAgY29uc3QgYiA9IHRpKCdydW4tYicsIDIwLCBudWxsKTsgLy8gb25nb2luZ1xuICBjb25zdCB2aWV3ID0geyBzdGFydDogMCwgZW5kOiAxMDAgfTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChhbGxvYy5hc3NpZ24oW2EsIGJdLCB2aWV3KS50cmFja3MsIFswLCAxXSk7XG4gIC8vIEEgYnJhbmQtbmV3IHJ1bm5pbmcgaW50ZXJ2YWwgYXBwZWFycyBhdCBcIm5vd1wiOiBpdCBzdGFja3Mgb24gdG9wIFx1MjAxNCB0aGUgcm93cyBhbHJlYWR5IG9uIHNjcmVlbiBkbyBub3QgbW92ZS5cbiAgY29uc3QgYyA9IHRpKCdydW4tYycsIDYwLCBudWxsKTtcbiAgY29uc3QgciA9IGFsbG9jLmFzc2lnbihbYSwgYiwgY10sIHZpZXcpO1xuICBhc3NlcnQuZGVlcEVxdWFsKHIudHJhY2tzLCBbMCwgMSwgMl0pO1xuICBhc3NlcnQuZXF1YWwoci50cmFja0NvdW50LCAzKTtcbn0pO1xuXG50ZXN0KCdUcmFja0FsbG9jYXRvcjogdmlzaWJsZSBzYW1lLXRyYWNrIGl0ZW1zIG5ldmVyIG92ZXJsYXAgaW4gdGltZSAoaW52YXJpYW50IGFjcm9zcyBzbGlkaW5nIHZpZXdzKScsICgpID0+IHtcbiAgLy8gRGV0ZXJtaW5pc3RpYyBwc2V1ZG8tcmFuZG9tLWlzaCBzZXQ6IHN0YWdnZXJlZCBzdGFydHMgYW5kIGR1cmF0aW9ucy5cbiAgY29uc3QgaXRlbXM6IFBhY2tJdGVtW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAzMDsgaSsrKSB7XG4gICAgY29uc3Qgc3RhcnQgPSAoaSAqIDM3KSAlIDEwMDtcbiAgICBpdGVtcy5wdXNoKHRpKGBpJHtTdHJpbmcoaSkucGFkU3RhcnQoMiwgJzAnKX1gLCBzdGFydCwgc3RhcnQgKyA1ICsgKChpICogMTMpICUgMjApKSk7XG4gIH1cbiAgY29uc3QgZm9vdCA9IChpdDogUGFja0l0ZW0pOiB7IHM6IG51bWJlcjsgZTogbnVtYmVyIH0gPT4gKHsgczogaXQuc3RhcnQsIGU6IE1hdGgubWF4KGl0LmVuZCA/PyBJbmZpbml0eSwgaXQuc3RhcnQgKyAxKSB9KTtcbiAgY29uc3QgYWxsb2MgPSBuZXcgVHJhY2tBbGxvY2F0b3IoKTtcbiAgZm9yIChsZXQgdCA9IDA7IHQgPD0gODA7IHQgKz0gMy43KSB7XG4gICAgY29uc3QgdmlldyA9IHsgc3RhcnQ6IHQsIGVuZDogdCArIDQwIH07XG4gICAgY29uc3QgeyB0cmFja3MgfSA9IGFsbG9jLmFzc2lnbihpdGVtcywgdmlldyk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkrKykge1xuICAgICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgaXRlbXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgaWYgKHRyYWNrc1tpXSA8IDAgfHwgdHJhY2tzW2ldICE9PSB0cmFja3Nbal0pIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBhID0gZm9vdChpdGVtc1tpXSk7XG4gICAgICAgIGNvbnN0IGIgPSBmb290KGl0ZW1zW2pdKTtcbiAgICAgICAgYXNzZXJ0Lm9rKGEuZSA8PSBiLnMgfHwgYi5lIDw9IGEucywgYHZpZXcgKyR7dH06ICR7aXRlbXNbaV0uaWR9IGFuZCAke2l0ZW1zW2pdLmlkfSBzaGFyZSB0cmFjayAke3RyYWNrc1tpXX0gYnV0IG92ZXJsYXBgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn0pO1xuXG50ZXN0KCdUcmFja0FsbG9jYXRvcjogcm93IG1lbW9yeSBpcyBMUlUtYm91bmRlZCBcdTIwMTQgYW4gZXZpY3RlZCBpZCByZS1wYWNrcyBhcyBuZXcnLCAoKSA9PiB7XG4gIGNvbnN0IGl0ZW1zID0gW3RpKCdwJywgMCwgMTApLCB0aSgncScsIDAsIDEwKSwgdGkoJ3InLCAwLCAxMCldO1xuICBjb25zdCByZW1lbWJlcmVkID0gbmV3IFRyYWNrQWxsb2NhdG9yKDEpOyAvLyBrZWVwcyBvbmx5IHRoZSBtb3N0IHJlY2VudCBpZCAocilcbiAgcmVtZW1iZXJlZC5hc3NpZ24oaXRlbXMsIHsgc3RhcnQ6IDAsIGVuZDogMjAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwocmVtZW1iZXJlZC5hc3NpZ24oW3RpKCdyJywgMCwgMTApXSwgeyBzdGFydDogMCwgZW5kOiAyMCB9KS50cmFja3MsIFsyXSwgJ3IgaXMgcmVtZW1iZXJlZCcpO1xuICBjb25zdCBldmljdGVkID0gbmV3IFRyYWNrQWxsb2NhdG9yKDEpO1xuICBldmljdGVkLmFzc2lnbihpdGVtcywgeyBzdGFydDogMCwgZW5kOiAyMCB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChldmljdGVkLmFzc2lnbihbdGkoJ3EnLCAwLCAxMCldLCB7IHN0YXJ0OiAwLCBlbmQ6IDIwIH0pLnRyYWNrcywgWzBdLCAncSB3YXMgZXZpY3RlZCBcdTIxOTIgcGFja3MgYXMgbmV3Jyk7XG59KTtcblxudGVzdCgnVHJhY2tBbGxvY2F0b3I6IGNsdXN0ZXItc2hhcGVkIHN5bnRoZXRpYyBpZHMgaG9sZCB0aGVpciByb3cgYWNyb3NzIGZyYW1lcyAob25lIHNsb3QgcGVyIGNsdXN0ZXIpJywgKCkgPT4ge1xuICAvLyBUaGUgZWxlbWVudCBwYWNrcyBhIFx1MDBEN04gY2x1c3RlciBhcyBPTkUgaXRlbSB3aG9zZSBpZCBkZXJpdmVzIGZyb20gaXRzIGZpcnN0IG1lbWJlciBcdTIwMTQgYXMgbG9uZyBhcyB0aGF0IGlkIGlzIHN0YWJsZS5cbiAgY29uc3QgYmFyID0gdGkoJ2EtYmFyJywgOTAsIDIwMCk7XG4gIGNvbnN0IGNsdXN0ZXIgPSB0aSgnY2x1c3RlcjpydW4tYScsIDE1MCwgMTUwKTsgLy8gaW5zdGFudCBmb290cHJpbnRcbiAgY29uc3QgYWxsb2MgPSBuZXcgVHJhY2tBbGxvY2F0b3IoKTtcbiAgY29uc3QgdjEgPSBhbGxvYy5hc3NpZ24oW2JhciwgY2x1c3Rlcl0sIHsgc3RhcnQ6IDgwLCBlbmQ6IDIyMCB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbCh2MS50cmFja3MsIFswLCAxXSwgJ3RoZSBjbHVzdGVyIG9jY3VwaWVzIGV4YWN0bHkgb25lIHNsb3QnKTtcbiAgZm9yIChsZXQgZHQgPSA1OyBkdCA8PSA2MDsgZHQgKz0gNSkge1xuICAgIGNvbnN0IHIgPSBhbGxvYy5hc3NpZ24oW2JhciwgY2x1c3Rlcl0sIHsgc3RhcnQ6IDgwICsgZHQsIGVuZDogMjIwICsgZHQgfSk7XG4gICAgYXNzZXJ0LmRlZXBFcXVhbChyLnRyYWNrcywgdjEudHJhY2tzLCBgc2xpZGUgKyR7ZHR9OiBuZWl0aGVyIHJvdyBob3BzYCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdUcmFja0FsbG9jYXRvcjogZGV0ZXJtaW5pc3RpYyBcdTIwMTQgaWRlbnRpY2FsIGNhbGwgc2VxdWVuY2VzIHlpZWxkIGlkZW50aWNhbCBhc3NpZ25tZW50cycsICgpID0+IHtcbiAgY29uc3QgaXRlbXMgPSBbdGkoJ2EnLCAwLCAzMCksIHRpKCdiJywgMTAsIDQwKSwgdGkoJ2MnLCAzNSwgNjApLCB0aSgnZCcsIDUwLCBudWxsKV07XG4gIGNvbnN0IHZpZXdzID0gW1xuICAgIHsgc3RhcnQ6IDAsIGVuZDogNDUgfSxcbiAgICB7IHN0YXJ0OiAzMiwgZW5kOiA3MCB9LFxuICAgIHsgc3RhcnQ6IDEwMCwgZW5kOiAxNDAgfSxcbiAgICB7IHN0YXJ0OiAwLCBlbmQ6IDQ1IH0sXG4gIF07XG4gIGNvbnN0IG9uZSA9IG5ldyBUcmFja0FsbG9jYXRvcigpO1xuICBjb25zdCB0d28gPSBuZXcgVHJhY2tBbGxvY2F0b3IoKTtcbiAgZm9yIChjb25zdCB2aWV3IG9mIHZpZXdzKSB7XG4gICAgYXNzZXJ0LmRlZXBFcXVhbChvbmUuYXNzaWduKGl0ZW1zLCB2aWV3KSwgdHdvLmFzc2lnbihpdGVtcywgdmlldykpO1xuICB9XG59KTtcblxudGVzdCgnVHJhY2tBbGxvY2F0b3I6IGVtcHR5IGlucHV0IGFuZCBlbXB0eSB3aW5kb3dzIGNvbGxhcHNlIHRvIG9uZSB0cmFjaycsICgpID0+IHtcbiAgY29uc3QgYWxsb2MgPSBuZXcgVHJhY2tBbGxvY2F0b3IoKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChhbGxvYy5hc3NpZ24oW10sIHsgc3RhcnQ6IDAsIGVuZDogMTAgfSksIHsgdHJhY2tzOiBbXSwgdHJhY2tDb3VudDogMSB9KTtcbiAgY29uc3QgciA9IGFsbG9jLmFzc2lnbihbdGkoJ2EnLCAxMDAsIDExMCldLCB7IHN0YXJ0OiAwLCBlbmQ6IDEwIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKHIsIHsgdHJhY2tzOiBbLTFdLCB0cmFja0NvdW50OiAxIH0pO1xufSk7XG5cbi8vIC0tIEluc3RhbnQgY2x1c3RlcmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBBIHplcm8tZHVyYXRpb24gaW5zdGFudCAodGhlIHNraXBwZWQtcnVuIHNoYXBlOiBzdGFydGVkID09IGZpbmlzaGVkKS5cbmNvbnN0IHBpcCA9IChpZDogc3RyaW5nLCBhdDogbnVtYmVyKTogUGFja0l0ZW0gPT4gKHsgaWQsIHN0YXJ0OiBhdCwgZW5kOiBhdCB9KTtcblxudGVzdCgnY2x1c3Rlckluc3RhbnRzOiBlbXB0eSBhbmQgc2luZ2xlLWluc3RhbnQgaW5wdXRzIHlpZWxkIG5vIGNsdXN0ZXJzJywgKCkgPT4ge1xuICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDAsIGVuZDogNjAwXzAwMCB9O1xuICBhc3NlcnQuZGVlcEVxdWFsKGNsdXN0ZXJJbnN0YW50cyhbXSwgdmlldywgMTAwMCksIHsgY2x1c3RlcnM6IFtdLCBtZW1iZXJPZjogW10gfSk7XG4gIGNvbnN0IG9uZSA9IGNsdXN0ZXJJbnN0YW50cyhbcGlwKCdhJywgMV8wMDApXSwgdmlldywgMTAwMCk7XG4gIGFzc2VydC5lcXVhbChvbmUuY2x1c3RlcnMubGVuZ3RoLCAwLCAnYSBsb25lIHBpcCBpcyBub3QgYSBjbHVzdGVyJyk7XG4gIGFzc2VydC5kZWVwRXF1YWwob25lLm1lbWJlck9mLCBbLTFdKTtcbn0pO1xuXG50ZXN0KCdjbHVzdGVySW5zdGFudHM6IGNvaW5jaWRlbnQgaW5zdGFudHMgbWVyZ2UgaW50byBPTkUgY2x1c3RlciAodGhlIGxhbmUtaGVpZ2h0IGJvbWIgYmVjb21lcyBvbmUgc2xvdCknLCAoKSA9PiB7XG4gIGNvbnN0IGl0ZW1zID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogNTAgfSwgKF8sIGkpID0+IHBpcChgcyR7U3RyaW5nKGkpLnBhZFN0YXJ0KDIsICcwJyl9YCwgNV8wMDApKTtcbiAgY29uc3QgciA9IGNsdXN0ZXJJbnN0YW50cyhpdGVtcywgeyBzdGFydDogMCwgZW5kOiA2MDBfMDAwIH0sIDEwMDApO1xuICBhc3NlcnQuZXF1YWwoci5jbHVzdGVycy5sZW5ndGgsIDEpO1xuICBhc3NlcnQuZXF1YWwoci5jbHVzdGVyc1swXS5pbmRpY2VzLmxlbmd0aCwgNTApO1xuICBhc3NlcnQuZGVlcEVxdWFsKHIuY2x1c3RlcnNbMF0uZXh0ZW50LCB7IHN0YXJ0OiA1XzAwMCwgZW5kOiA1XzAwMCB9LCAnY29pbmNpZGVudCBtZW1iZXJzOiBhIHBvaW50IGV4dGVudCcpO1xuICBhc3NlcnQuZGVlcEVxdWFsKHIuY2x1c3RlcnNbMF0ubWFya3MsIFt7IHRpbWU6IDVfMDAwLCBmcm9tOiAwLCB0bzogNTAgfV0sICdvbmUgbWFyazogdGhlIHN0YWNrIGdseXBoIGNhc2UnKTtcbiAgYXNzZXJ0Lm9rKHIubWVtYmVyT2YuZXZlcnkoKG0pID0+IG0gPT09IDApKTtcbn0pO1xuXG50ZXN0KCdjbHVzdGVySW5zdGFudHM6IHRocmVzaG9sZCBib3VuZGFyeSBcdTIwMTQgYSBnYXAganVzdCB1bmRlciB0aGUgcGl0Y2ggbWVyZ2VzLCBhdCBpdCB0aGV5IHN0YXkgYXBhcnQnLCAoKSA9PiB7XG4gIGNvbnN0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogMCwgZW5kOiAxMDBfMDAwIH07XG4gIGNvbnN0IHBpdGNoTXMgPSBDTFVTVEVSX1BJVENIX1BYICogMTAwO1xuICBjb25zdCB1bmRlciA9IGNsdXN0ZXJJbnN0YW50cyhbcGlwKCdhJywgMTBfMDAwKSwgcGlwKCdiJywgMTBfMDAwICsgcGl0Y2hNcyAtIDEpXSwgdmlldywgMTAwMCk7XG4gIGFzc2VydC5lcXVhbCh1bmRlci5jbHVzdGVycy5sZW5ndGgsIDEsICdhIHBpeGVsIHNob3J0IG9mIGNsZWFyaW5nOiB0aGUgcGlwcyBjb2xsaWRlLCBzbyB0aGV5IGNsdXN0ZXInKTtcbiAgY29uc3QgYXQgPSBjbHVzdGVySW5zdGFudHMoW3BpcCgnYScsIDEwXzAwMCksIHBpcCgnYicsIDEwXzAwMCArIHBpdGNoTXMpXSwgdmlldywgMTAwMCk7XG4gIGFzc2VydC5lcXVhbChhdC5jbHVzdGVycy5sZW5ndGgsIDAsICdleGFjdGx5IGF0IHRoZSBwaXRjaCB0aGV5IGJvdGggZHJhdycpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGF0Lm1lbWJlck9mLCBbLTEsIC0xXSk7XG59KTtcblxudGVzdCgnY2x1c3Rlckluc3RhbnRzOiBhIGNoYWluIHJ1bnMgdG8gdGhlIHJlYWwgZ2FwLCBhbmQgZXZlcnkgbWVtYmVyIHRoYXQgY2xlYXJzIHRoZSBwaXRjaCBrZWVwcyBpdHMgcGlwJywgKCkgPT4ge1xuICAvLyA0cHggYXBhcnQgYXQgdGhlIGRlZmF1bHQgNnB4IHBpdGNoOiBhbGwgb2YgdGhlbSBjaGFpbiwgYW5kIHRoZSB0aGlubmluZyBrZWVwcyBldmVyeSBvdGhlciBvbmUgXHUyMDE0IGVhY2ggYXQgaXRzIG93biB0cnVlIHRpbWVzdGFtcC5cbiAgY29uc3QgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiAwLCBlbmQ6IDEwMF8wMDAgfTsgLy8gMTAwbXMvcHhcbiAgY29uc3QgaXRlbXMgPSBbcGlwKCdhJywgMTBfMDAwKSwgcGlwKCdiJywgMTBfNDAwKSwgcGlwKCdjJywgMTBfODAwKSwgcGlwKCdkJywgMTFfMjAwKV07XG4gIGNvbnN0IHIgPSBjbHVzdGVySW5zdGFudHMoaXRlbXMsIHZpZXcsIDEwMDApO1xuICBhc3NlcnQuZXF1YWwoci5jbHVzdGVycy5sZW5ndGgsIDEpO1xuICBhc3NlcnQuZGVlcEVxdWFsKHIuY2x1c3RlcnNbMF0uaW5kaWNlcywgWzAsIDEsIDIsIDNdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChyLmNsdXN0ZXJzWzBdLmV4dGVudCwgeyBzdGFydDogMTBfMDAwLCBlbmQ6IDExXzIwMCB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChcbiAgICByLmNsdXN0ZXJzWzBdLm1hcmtzLFxuICAgIFtcbiAgICAgIHsgdGltZTogMTBfMDAwLCBmcm9tOiAwLCB0bzogMiB9LFxuICAgICAgeyB0aW1lOiAxMF84MDAsIGZyb206IDIsIHRvOiA0IH0sXG4gICAgXSxcbiAgICAnYiBhbmQgZCBzaXQgaW5zaWRlIHRoZSBwaXRjaCBcdTIwMTQgZHJvcHBlZCwgYW5kIGNvdW50ZWQgYnkgdGhlIHBpcCBiZWZvcmUgdGhlbScsXG4gICk7XG4gIC8vIEEgY29tcGFjdCBsYW5lIGRyYXdzIHNtYWxsZXIgZG90cyBhdCBhIHRpZ2h0ZXIgcGl0Y2gsIHNvIG1vcmUgZml0LlxuICBjb25zdCBjb21wYWN0ID0gY2x1c3Rlckluc3RhbnRzKGl0ZW1zLCB2aWV3LCAxMDAwLCAzKTtcbiAgYXNzZXJ0LmVxdWFsKGNvbXBhY3QuY2x1c3RlcnMubGVuZ3RoLCAwKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChjb21wYWN0Lm1lbWJlck9mLCBbLTEsIC0xLCAtMSwgLTFdKTtcbn0pO1xuXG50ZXN0KCdjbHVzdGVySW5zdGFudHM6IFpPT01JTkcgT1VUIEhBTFZFUyBUSEUgTUFSS1MgXHUyMDE0IGl0IG5ldmVyIGZ1c2VzIHRoZW0gaW50byBvbmUgc2hhcGUnLCAoKSA9PiB7XG4gIC8vIFRIRSBydWxlIChkb2NzL3RpbWVsaW5lL3pvb20tb3V0LW5ldmVyLW1lcmdlcy5tZCkuXG4gIGNvbnN0IGl0ZW1zID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogNDAwMCB9LCAoXywgaSkgPT4gcGlwKGBzJHtTdHJpbmcoaSkucGFkU3RhcnQoNCwgJzAnKX1gLCBpICogMV8wMDApKTtcbiAgY29uc3QgcGxvdFdpZHRoID0gMTAwMDtcbiAgbGV0IHByZXYgPSBJbmZpbml0eTtcbiAgZm9yIChjb25zdCBzcGFuIG9mIFsxXzAwMF8wMDAsIDJfMDAwXzAwMCwgNF8wMDBfMDAwLCA4XzAwMF8wMDBdKSB7XG4gICAgY29uc3QgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiAwLCBlbmQ6IHNwYW4gfTtcbiAgICBjb25zdCByID0gY2x1c3Rlckluc3RhbnRzKGl0ZW1zLCB2aWV3LCBwbG90V2lkdGgpO1xuICAgIGNvbnN0IG1zUGVyUHggPSBzcGFuIC8gcGxvdFdpZHRoO1xuICAgIGNvbnN0IG1hcmtzID0gci5jbHVzdGVycy5yZWR1Y2UoKG4sIGMpID0+IG4gKyBjLm1hcmtzLmxlbmd0aCwgMCk7XG4gICAgLy8gRXZlcnkgZHJhd24gbWFyayBjbGVhcnMgdGhlIG9uZSBieSBhIHdob2xlIG1hcmsgKyBpdHMgZ2FwLCBzbyB0aGUgdGlja3NcbiAgICAvLyB0aGUgZWxlbWVudCBkcmF3cyBjYW4gbmV2ZXIgdG91Y2gsIGxldCBhbG9uZSBtZXJnZS5cbiAgICBmb3IgKGNvbnN0IGMgb2Ygci5jbHVzdGVycykge1xuICAgICAgZm9yIChsZXQgayA9IDE7IGsgPCBjLm1hcmtzLmxlbmd0aDsgaysrKSB7XG4gICAgICAgIGFzc2VydC5vayhcbiAgICAgICAgICAoYy5tYXJrc1trXS50aW1lIC0gYy5tYXJrc1trIC0gMV0udGltZSkgLyBtc1BlclB4ID49IENMVVNURVJfUElUQ0hfUFggLSAxZS05LFxuICAgICAgICAgIGBzcGFuICR7c3Bhbn06IG1hcmtzICR7ayAtIDF9LyR7a30gY2xvc2VyIHRoYW4gdGhlIHBpdGNoYCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vIE1hcmtzIGNvdmVyIGV2ZXJ5IG1lbWJlciBleGFjdGx5IG9uY2UsIGluIG9yZGVyIFx1MjAxNCBub3RoaW5nIGlzIGxvc3QgZnJvbSB0aGUgdG9vbHRpcCBjb3VudHMgYnkgYmVpbmcgZHJvcHBlZC5cbiAgICAgIGxldCBuZXh0ID0gMDtcbiAgICAgIGZvciAoY29uc3QgbWsgb2YgYy5tYXJrcykge1xuICAgICAgICBhc3NlcnQuZXF1YWwobWsuZnJvbSwgbmV4dCk7XG4gICAgICAgIGFzc2VydC5vayhtay50byA+IG1rLmZyb20pO1xuICAgICAgICBuZXh0ID0gbWsudG87XG4gICAgICB9XG4gICAgICBhc3NlcnQuZXF1YWwobmV4dCwgYy5pbmRpY2VzLmxlbmd0aCk7XG4gICAgfVxuICAgIC8vIEVhY2ggMnggem9vbS1vdXQgcm91Z2hseSBoYWx2ZXMgdGhlIG1hcmtzIChuZXZlciBtZXJnZXMgdGhlbSkuXG4gICAgaWYgKHByZXYgIT09IEluZmluaXR5KSB7XG4gICAgICBhc3NlcnQub2sobWFya3MgPCBwcmV2ICogMC42LCBgc3BhbiAke3NwYW59OiAke21hcmtzfSBtYXJrcyB2cyAke3ByZXZ9IGF0IGhhbGYgdGhlIHNwYW5gKTtcbiAgICAgIGFzc2VydC5vayhtYXJrcyA+IHByZXYgKiAwLjQsIGBzcGFuICR7c3Bhbn06ICR7bWFya3N9IG1hcmtzIHZzICR7cHJldn0gXHUyMDE0IGRyb3BwZWQgZmFyIG1vcmUgdGhhbiBoYWxmYCk7XG4gICAgfVxuICAgIHByZXYgPSBtYXJrcztcbiAgfVxufSk7XG5cbnRlc3QoJ2NsdXN0ZXJJbnN0YW50czogYSBydW4gb2YgbWFya3MgZmlsbHMgaXRzIGV4dGVudCBcdTIwMTQgbm8gZml4ZWQtcGl0Y2ggY29tYiwgbm8gc2luZ2xlIGJsb2InLCAoKSA9PiB7XG4gIC8vIFRoZSBmYWlsdXJlIHRoaXMgcmVwbGFjZWQ6IGEgMjRweCB3aWR0aCBjYXAgY2hvcHBlZCBhbnkgZGVuc2UgcnVuIGludG8gZXF1YWwgZ3JvdXBzLCBvbmUgZ2x5cGggZWFjaC5cbiAgY29uc3QgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiAtNjAwXzAwMCwgZW5kOiAxNV8wMDBfMDAwIH07XG4gIGNvbnN0IHBsb3RXaWR0aCA9IDEzMDA7XG4gIGNvbnN0IG1zUGVyUHggPSAodmlldy5lbmQgLSB2aWV3LnN0YXJ0KSAvIHBsb3RXaWR0aDtcbiAgY29uc3QgciA9IGNsdXN0ZXJJbnN0YW50cyhcbiAgICBBcnJheS5mcm9tKHsgbGVuZ3RoOiAyNDAgfSwgKF8sIGkpID0+IHBpcChgbSR7U3RyaW5nKGkpLnBhZFN0YXJ0KDMsICcwJyl9YCwgaSAqIDYwXzAwMCkpLFxuICAgIHZpZXcsXG4gICAgcGxvdFdpZHRoLFxuICApO1xuICBjb25zdCBtYXJrcyA9IHIuY2x1c3RlcnMuZmxhdE1hcCgoYykgPT4gYy5tYXJrcyk7XG4gIGNvbnN0IGRhdGFQeCA9ICgyNDAgKiA2MF8wMDApIC8gbXNQZXJQeDtcbiAgLy8gTWFya3Mgc3RvcCBhdCB3aGF0IHRoZSB3aWR0aCBjYW4gaG9sZCwgYW5kIGZpbGwgaXQuXG4gIGFzc2VydC5vayhtYXJrcy5sZW5ndGggPD0gZGF0YVB4IC8gQ0xVU1RFUl9QSVRDSF9QWCArIDEsIGAke21hcmtzLmxlbmd0aH0gbWFya3MgaXMgbW9yZSB0aGFuICR7ZGF0YVB4LnRvRml4ZWQoMCl9cHggY2FuIHNlcGFyYXRlYCk7XG4gIGNvbnN0IHNwYW5QeCA9IChtYXJrc1ttYXJrcy5sZW5ndGggLSAxXS50aW1lIC0gbWFya3NbMF0udGltZSkgLyBtc1BlclB4O1xuICBhc3NlcnQub2soc3BhblB4ID4gZGF0YVB4ICogMC45NSwgYG1hcmtzIGNvdmVyICR7c3BhblB4LnRvRml4ZWQoMCl9cHggb2YgdGhlIHJ1bidzICR7ZGF0YVB4LnRvRml4ZWQoMCl9cHhgKTtcbiAgLy8gVGhlIHNhbWUgd2luZG93IHdpdGggYSBmaWZ0aCBhcyBtYW55IGV2ZW50cyBkcmF3cyBhIGZpZnRoIGFzIG1hbnkgbWFya3NcbiAgLy8gXHUyMDE0IHRoZSBmaXhlZC1waXRjaCBjb21iIGRyZXcgYm90aCBpZGVudGljYWxseS5cbiAgY29uc3Qgc3BhcnNlID0gY2x1c3Rlckluc3RhbnRzKFxuICAgIEFycmF5LmZyb20oeyBsZW5ndGg6IDQ4IH0sIChfLCBpKSA9PiBwaXAoYGYke1N0cmluZyhpKS5wYWRTdGFydCgzLCAnMCcpfWAsIGkgKiAzMDBfMDAwKSksXG4gICAgdmlldyxcbiAgICBwbG90V2lkdGgsXG4gICk7XG4gIGNvbnN0IHNwYXJzZU1hcmtzID0gc3BhcnNlLmNsdXN0ZXJzLmZsYXRNYXAoKGMpID0+IGMubWFya3MpLmxlbmd0aCArIHNwYXJzZS5tZW1iZXJPZi5maWx0ZXIoKG0pID0+IG0gPCAwKS5sZW5ndGg7XG4gIGFzc2VydC5vayhtYXJrcy5sZW5ndGggPiBzcGFyc2VNYXJrcyAqIDIsIGAke21hcmtzLmxlbmd0aH0gbWFya3MgZm9yIDI0MCBldmVudHMgdnMgJHtzcGFyc2VNYXJrc30gZm9yIDQ4YCk7XG59KTtcblxudGVzdCgnY2x1c3Rlckluc3RhbnRzOiBiYXJzIGFuZCBvbmdvaW5nIGludGVydmFscyBuZXZlciBjbHVzdGVyJywgKCkgPT4ge1xuICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDAsIGVuZDogMTAwXzAwMCB9OyAvLyAxMDBtcy9weCBcdTIxOTIgaW5zdGFudHMgYXJlIDwgMzAwbXNcbiAgY29uc3QgaXRlbXM6IFBhY2tJdGVtW10gPSBbXG4gICAgcGlwKCdhJywgMTBfMDAwKSxcbiAgICBwaXAoJ2InLCAxMF8xMDApLFxuICAgIHsgaWQ6ICdiYXInLCBzdGFydDogMTBfMDAwLCBlbmQ6IDEwXzAwMCArIDMwMCB9LCAvLyBleGFjdGx5IHRoZSBwaXAgdGhyZXNob2xkIFx1MjE5MiBhIGJhclxuICAgIHsgaWQ6ICdsaXZlJywgc3RhcnQ6IDEwXzA1MCwgZW5kOiBudWxsIH0sIC8vIG9uZ29pbmcgXHUyMDE0IHdpbGwgZ3JvdyBpbnRvIGEgYmFyXG4gIF07XG4gIGNvbnN0IHIgPSBjbHVzdGVySW5zdGFudHMoaXRlbXMsIHZpZXcsIDEwMDApO1xuICBhc3NlcnQuZXF1YWwoci5jbHVzdGVycy5sZW5ndGgsIDEpO1xuICBhc3NlcnQuZGVlcEVxdWFsKHIuY2x1c3RlcnNbMF0uaW5kaWNlcywgWzAsIDFdLCAnb25seSB0aGUgdHdvIHBpcHMgbWVyZ2VkJyk7XG4gIGFzc2VydC5lcXVhbChyLm1lbWJlck9mWzJdLCAtMSk7XG4gIGFzc2VydC5lcXVhbChyLm1lbWJlck9mWzNdLCAtMSk7XG59KTtcblxudGVzdCgnY2x1c3Rlckluc3RhbnRzOiBkZXRlcm1pbmlzdGljIHVuZGVyIGlucHV0IHJlLW9yZGVyaW5nIChtZW1iZXJPZiBhbGlnbmVkIHRvIGlucHV0IHBvc2l0aW9ucyknLCAoKSA9PiB7XG4gIGNvbnN0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogMCwgZW5kOiAxMDBfMDAwIH07XG4gIGNvbnN0IHNvcnRlZCA9IFtwaXAoJ2EnLCAxMF8wMDApLCBwaXAoJ2InLCAxMF81MDApLCBwaXAoJ3gnLCA1MF8wMDApLCBwaXAoJ3knLCA1MF8yMDApXTtcbiAgY29uc3Qgc2h1ZmZsZWQgPSBbc29ydGVkWzNdLCBzb3J0ZWRbMV0sIHNvcnRlZFswXSwgc29ydGVkWzJdXTtcbiAgY29uc3QgYSA9IGNsdXN0ZXJJbnN0YW50cyhzb3J0ZWQsIHZpZXcsIDEwMDApO1xuICBjb25zdCBiID0gY2x1c3Rlckluc3RhbnRzKHNodWZmbGVkLCB2aWV3LCAxMDAwKTtcbiAgYXNzZXJ0LmVxdWFsKGEuY2x1c3RlcnMubGVuZ3RoLCAyKTtcbiAgYXNzZXJ0LmVxdWFsKGIuY2x1c3RlcnMubGVuZ3RoLCAyKTtcbiAgY29uc3QgbWVtYmVySWRzID0gKGl0ZW1zOiBQYWNrSXRlbVtdLCBjOiB7IGluZGljZXM6IG51bWJlcltdIH0pOiBzdHJpbmdbXSA9PiBjLmluZGljZXMubWFwKChpKSA9PiBpdGVtc1tpXS5pZCk7XG4gIGFzc2VydC5kZWVwRXF1YWwobWVtYmVySWRzKHNvcnRlZCwgYS5jbHVzdGVyc1swXSksIFsnYScsICdiJ10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKG1lbWJlcklkcyhzaHVmZmxlZCwgYi5jbHVzdGVyc1swXSksIFsnYScsICdiJ10sICdzYW1lIG1lbWJlcnMsIGluIChzdGFydCwgaWQpIG9yZGVyJyk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYS5jbHVzdGVycy5tYXAoKGMpID0+IGMuZXh0ZW50KSwgYi5jbHVzdGVycy5tYXAoKGMpID0+IGMuZXh0ZW50KSk7XG4gIGFzc2VydC5lcXVhbChiLm1lbWJlck9mWzJdLCAwLCAnbWVtYmVyT2YgcmVmZXJzIHRvIElOUFVUIHBvc2l0aW9ucycpO1xuICBhc3NlcnQuZXF1YWwoYi5tZW1iZXJPZlswXSwgMSk7XG59KTtcblxudGVzdCgnY2x1c3Rlckluc3RhbnRzOiBwdXJlIHBhbnMgbmV2ZXIgY2hhbmdlIG1lbWJlcnNoaXAgb3IgZXh0ZW50cyAodHJhbnNsYXRpb24taW52YXJpYW50KScsICgpID0+IHtcbiAgY29uc3QgaXRlbXMgPSBbcGlwKCdhJywgMTBfMDAwKSwgcGlwKCdiJywgMTBfODAwKSwgcGlwKCdjJywgNDBfMDAwKV07XG4gIGNvbnN0IHNwYW4gPSAxMDBfMDAwO1xuICBjb25zdCBmaXJzdCA9IGNsdXN0ZXJJbnN0YW50cyhpdGVtcywgeyBzdGFydDogMCwgZW5kOiBzcGFuIH0sIDEwMDApO1xuICBmb3IgKGxldCBkdCA9IDA7IGR0IDw9IDMwXzAwMDsgZHQgKz0gMV8yMzQuNSkge1xuICAgIGNvbnN0IHIgPSBjbHVzdGVySW5zdGFudHMoaXRlbXMsIHsgc3RhcnQ6IGR0LCBlbmQ6IGR0ICsgc3BhbiB9LCAxMDAwKTtcbiAgICBhc3NlcnQuZGVlcEVxdWFsKHIsIGZpcnN0LCBgcGFuICske2R0fSBrZWVwcyBpZGVudGljYWwgY2x1c3RlcnNgKTtcbiAgfVxufSk7XG5cbnRlc3QoJ2NsdXN0ZXJJbnN0YW50czogem9vbWluZyBpbiBwcm9ncmVzc2l2ZWx5IHNwbGl0cyBjbHVzdGVycyB1bnRpbCBlYWNoIHBpcCBzdGFuZHMgYWxvbmUnLCAoKSA9PiB7XG4gIC8vIEdhcHM6IGFcdTIxOTRiIDIwMG1zLCBiXHUyMTk0YyAxXzYwMG1zLlxuICBjb25zdCBpdGVtcyA9IFtwaXAoJ2EnLCAxMF8wMDApLCBwaXAoJ2InLCAxMF8yMDApLCBwaXAoJ2MnLCAxMV84MDApXTtcbiAgY29uc3Qgd2lkZSA9IGNsdXN0ZXJJbnN0YW50cyhpdGVtcywgeyBzdGFydDogMCwgZW5kOiA2MDBfMDAwIH0sIDEwMDApOyAvLyA2MDBtcy9weCBcdTIxOTIgcGl0Y2ggM182MDBtc1xuICBhc3NlcnQuZXF1YWwod2lkZS5jbHVzdGVycy5sZW5ndGgsIDEsICd3aWRlOiBldmVyeXRoaW5nIGlzIG9uZSBjaGFpbicpO1xuICBhc3NlcnQuZXF1YWwod2lkZS5jbHVzdGVyc1swXS5pbmRpY2VzLmxlbmd0aCwgMyk7XG4gIGNvbnN0IG1pZCA9IGNsdXN0ZXJJbnN0YW50cyhpdGVtcywgeyBzdGFydDogMCwgZW5kOiA2MF8wMDAgfSwgMTAwMCk7IC8vIDYwbXMvcHggXHUyMTkyIHBpdGNoIDM2MG1zXG4gIGFzc2VydC5lcXVhbChtaWQuY2x1c3RlcnMubGVuZ3RoLCAxLCAnbWlkOiBvbmx5IHRoZSBjbG9zZSBwYWlyIHN0aWxsIGNvbGxpZGVzJyk7XG4gIGFzc2VydC5kZWVwRXF1YWwobWlkLmNsdXN0ZXJzWzBdLmluZGljZXMsIFswLCAxXSk7XG4gIGFzc2VydC5lcXVhbChtaWQubWVtYmVyT2ZbMl0sIC0xKTtcbiAgY29uc3QgY2xvc2UgPSBjbHVzdGVySW5zdGFudHMoaXRlbXMsIHsgc3RhcnQ6IDAsIGVuZDogMTBfMDAwIH0sIDEwMDApOyAvLyAxMG1zL3B4IFx1MjE5MiBwaXRjaCA2MG1zXG4gIGFzc2VydC5lcXVhbChjbG9zZS5jbHVzdGVycy5sZW5ndGgsIDAsICd6b29tZWQgaW46IGV2ZXJ5IHBpcCBzdGFuZHMgYXQgaXRzIHRydWUgdGltZXN0YW1wJyk7XG59KTtcblxudGVzdCgnY2x1c3Rlclpvb21WaWV3OiBwYWRzIHRoZSBtZW1iZXIgZXh0ZW50IGFuZCBmbG9vcnMgYXQgdGhlIG1pbmltdW0gc3BhbjsgY2xpY2tpbmcgaXQgc3BsaXRzIHRoZSBjbHVzdGVyJywgKCkgPT4ge1xuICBjb25zdCBleHRlbnQgPSB7IHN0YXJ0OiAxMF8wMDAsIGVuZDogMTBfNDAwIH07XG4gIGNvbnN0IHYgPSBjbHVzdGVyWm9vbVZpZXcoZXh0ZW50KTtcbiAgYXNzZXJ0LmVxdWFsKHYuZW5kIC0gdi5zdGFydCwgTUlOX1NQQU5fTVMsICdhIHN1Yi1taW5pbXVtIGV4dGVudCBmbG9vcnMgYXQgTUlOX1NQQU5fTVMnKTtcbiAgYXNzZXJ0LmVxdWFsKCh2LnN0YXJ0ICsgdi5lbmQpIC8gMiwgKGV4dGVudC5zdGFydCArIGV4dGVudC5lbmQpIC8gMiwgJ2NlbnRlcmVkIG9uIHRoZSBleHRlbnQnKTtcbiAgLy8gVGhlIHpvb20gaXMgZGVlcCBlbm91Z2ggdGhhdCB0aGUgbWVtYmVycyBzZXBhcmF0ZSBcdTIxOTIgbm8gY2x1c3RlciBsZWZ0LlxuICBjb25zdCBpdGVtcyA9IFtwaXAoJ2EnLCAxMF8wMDApLCBwaXAoJ2InLCAxMF80MDApXTtcbiAgYXNzZXJ0LmVxdWFsKGNsdXN0ZXJJbnN0YW50cyhpdGVtcywgY2x1c3Rlclpvb21WaWV3KGV4dGVudCksIDEwMDApLmNsdXN0ZXJzLmxlbmd0aCwgMCk7XG4gIC8vIEEgd2lkZSBleHRlbnQgZmlsbHMgQ0xVU1RFUl9aT09NX0ZJTExfRlJBQyBvZiB0aGUgd2luZG93LlxuICBjb25zdCBiaWcgPSB7IHN0YXJ0OiAwLCBlbmQ6IDYwXzAwMCB9O1xuICBjb25zdCBidiA9IGNsdXN0ZXJab29tVmlldyhiaWcpO1xuICBhc3NlcnQub2soTWF0aC5hYnMoKGJ2LmVuZCAtIGJ2LnN0YXJ0KSAqIENMVVNURVJfWk9PTV9GSUxMX0ZSQUMgLSA2MF8wMDApIDwgMWUtNik7XG4gIC8vIEZ1bGx5IGNvaW5jaWRlbnQgbWVtYmVycyBmbG9vciBhdCB0aGUgbWluaW11bSBzcGFuICh0aGV5IGNhbiBuZXZlciBzcGxpdCkuXG4gIGNvbnN0IHBvaW50ID0gY2x1c3Rlclpvb21WaWV3KHsgc3RhcnQ6IDVfMDAwLCBlbmQ6IDVfMDAwIH0pO1xuICBhc3NlcnQuZXF1YWwocG9pbnQuZW5kIC0gcG9pbnQuc3RhcnQsIE1JTl9TUEFOX01TKTtcbiAgYXNzZXJ0LmVxdWFsKChwb2ludC5zdGFydCArIHBvaW50LmVuZCkgLyAyLCA1XzAwMCk7XG59KTtcblxudGVzdCgnY2x1c3Rlck1hcmtlclRpbWU6IG1pZHBvaW50IHdoaWxlIGZ1bGx5IHZpc2libGU7IHNsaWRlcyBhdCBhIGNsaXBwZWQgZWRnZTsgbnVsbCBvbmNlIG5vdGhpbmcgaXMgdmlzaWJsZScsICgpID0+IHtcbiAgY29uc3QgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiAwLCBlbmQ6IDFfMDAwIH07XG4gIC8vIEZ1bGx5IHZpc2libGU6IHRoZSBtaWRwb2ludCwgc3RhYmxlLlxuICBhc3NlcnQuZXF1YWwoY2x1c3Rlck1hcmtlclRpbWUoeyBzdGFydDogMTAwLCBlbmQ6IDIwMCB9LCB2aWV3LCAxMCksIDE1MCk7XG4gIC8vIFN0cmFkZGxpbmcgdGhlIGxlZnQgZWRnZTogc2xpZCB0byB0aGUgaW5zZXQgd2luZG93IGVkZ2UsIG9uLXNjcmVlbi5cbiAgYXNzZXJ0LmVxdWFsKGNsdXN0ZXJNYXJrZXJUaW1lKHsgc3RhcnQ6IC01MDAsIGVuZDogMjAwIH0sIHZpZXcsIDEwKSwgMTApO1xuICAvLyBTdHJhZGRsaW5nIHRoZSByaWdodCBlZGdlOiBzeW1tZXRyaWMuXG4gIGFzc2VydC5lcXVhbChjbHVzdGVyTWFya2VyVGltZSh7IHN0YXJ0OiA4MDAsIGVuZDogMV81MDAgfSwgdmlldywgMTApLCA5OTApO1xuICAvLyBFbnRpcmVseSBvdXRzaWRlOiBubyBtYXJrZXIuXG4gIGFzc2VydC5lcXVhbChjbHVzdGVyTWFya2VyVGltZSh7IHN0YXJ0OiAtNTAwLCBlbmQ6IC0xMDAgfSwgdmlldywgMTApLCBudWxsKTtcbiAgYXNzZXJ0LmVxdWFsKGNsdXN0ZXJNYXJrZXJUaW1lKHsgc3RhcnQ6IDFfMTAwLCBlbmQ6IDFfMjAwIH0sIHZpZXcsIDEwKSwgbnVsbCk7XG4gIC8vIEEgcG9pbnQgZXh0ZW50IG5lYXIgdGhlIGVkZ2U6IG1hcmdpbnMgY3Jvc3MgXHUyMTkyIGNsYW1wZWQgaW50byB0aGUgZXh0ZW50LlxuICBhc3NlcnQuZXF1YWwoY2x1c3Rlck1hcmtlclRpbWUoeyBzdGFydDogNTAsIGVuZDogNTAgfSwgdmlldywgMTAwKSwgNTApO1xuICAvLyBDb250aW51aXR5IHdoaWxlIHBhbm5pbmc6IHRoZSBtYXJrZXIgbmV2ZXIganVtcHMsIHJpZGluZyB0aGUgZXh0ZW50J3MgbGFzdCB2aXNpYmxlIHNsaXZlciBhbGwgdGhlIHdheSBvdXQuXG4gIGxldCBwcmV2ID0gbnVsbCBhcyBudW1iZXIgfCBudWxsO1xuICBmb3IgKGxldCBzID0gLTQwMDsgcyA8PSAyMDA7IHMgKz0gMTApIHtcbiAgICBjb25zdCB0ID0gY2x1c3Rlck1hcmtlclRpbWUoeyBzdGFydDogMTAwLCBlbmQ6IDIwMCB9LCB7IHN0YXJ0OiBzLCBlbmQ6IHMgKyAxXzAwMCB9LCAxMCk7XG4gICAgYXNzZXJ0Lm9rKHQgIT09IG51bGwsIGB2aXNpYmxlIGF0IHBhbiAke3N9YCk7XG4gICAgaWYgKHByZXYgIT09IG51bGwpIGFzc2VydC5vayhNYXRoLmFicyh0IC0gcHJldikgPD0gMTAgKyAxZS05LCBgcGFuIHN0ZXAgbW92ZXMgdGhlIG1hcmtlciBcdTIyNjQgdGhlIHBhbiBzdGVwYCk7XG4gICAgcHJldiA9IHQ7XG4gIH1cbn0pO1xuXG4vLyAtLSBNaW5pbWFwIHN0cmlwIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ21pbmltYXBFeHRlbnQ6IHNwYW5zIHRoZSBlYXJsaWVzdCBrbm93biBzdGFydCB0aHJvdWdoIG1heChub3csIGxhdGVzdCBlbmQpOyBudWxsIHdpdGggbm8gZGF0YScsICgpID0+IHtcbiAgLy8gTm8gc3RhcnQga25vd2xlZGdlIG9mIGFueSBraW5kIFx1MjE5MiBubyBleHRlbnQgKHRoZSBzdHJpcCBoaWRlcykuXG4gIGFzc2VydC5lcXVhbChtaW5pbWFwRXh0ZW50KG51bGwsIG51bGwsIDFfMDAwXzAwMCksIG51bGwpO1xuICAvLyBQbGFpbiBkYXRhOiBlYXJsaWVzdCBpbnRlcnZhbCBcdTIxOTIgbm93IChub3cgcGFzdCB0aGUgbGF0ZXN0IGVuZCkuXG4gIGFzc2VydC5kZWVwRXF1YWwobWluaW1hcEV4dGVudCg1MDBfMDAwLCA4MDBfMDAwLCAxXzAwMF8wMDApLCB7IHN0YXJ0OiA1MDBfMDAwLCBlbmQ6IDFfMDAwXzAwMCB9KTtcbiAgLy8gQSBsYXRlc3QgZW5kIHBhc3Qgbm93IChmdXR1cmUtZGF0ZWQgdGVybWluYWwpIGV4dGVuZHMgdGhlIGVuZC5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwRXh0ZW50KDUwMF8wMDAsIDFfMjAwXzAwMCwgMV8wMDBfMDAwKSwgeyBzdGFydDogNTAwXzAwMCwgZW5kOiAxXzIwMF8wMDAgfSk7XG4gIC8vIENvdmVyYWdlIGtub3dsZWRnZSB3aWRlbnMgdGhlIHN0YXJ0LlxuICBhc3NlcnQuZGVlcEVxdWFsKG1pbmltYXBFeHRlbnQoNTAwXzAwMCwgbnVsbCwgMV8wMDBfMDAwLCBudWxsLCAzMDBfMDAwKSwgeyBzdGFydDogMzAwXzAwMCwgZW5kOiAxXzAwMF8wMDAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwobWluaW1hcEV4dGVudCg1MDBfMDAwLCBudWxsLCAxXzAwMF8wMDAsIDEwMF8wMDAsIDMwMF8wMDApLCB7IHN0YXJ0OiAxMDBfMDAwLCBlbmQ6IDFfMDAwXzAwMCB9KTtcbiAgLy8gQ292ZXJhZ2UgYWxvbmUgKG5vIGludGVydmFscykgaXMgc3RpbGwgYW4gZXh0ZW50LlxuICBhc3NlcnQuZGVlcEVxdWFsKG1pbmltYXBFeHRlbnQobnVsbCwgbnVsbCwgMV8wMDBfMDAwLCBudWxsLCA3MDBfMDAwKSwgeyBzdGFydDogNzAwXzAwMCwgZW5kOiAxXzAwMF8wMDAgfSk7XG59KTtcblxudGVzdCgnbWluaW1hcEV4dGVudDogYSBkZWdlbmVyYXRlL3Rpbnkgc3BhbiBpcyBwYWRkZWQgYmFja3dhcmQgdG8gdGhlIG1pbmltdW0nLCAoKSA9PiB7XG4gIC8vIEEgc2luZ2xlIGluc3RhbnQgYXQgXCJub3dcIjogcGFkIGJhY2t3YXJkIHNvIHRoZSBzdHJpcCBoYXMgYSByZWFsIGRvbWFpbi5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwRXh0ZW50KDFfMDAwXzAwMCwgbnVsbCwgMV8wMDBfMDAwLCBudWxsLCBudWxsLCA2MF8wMDApLCB7IHN0YXJ0OiA5NDBfMDAwLCBlbmQ6IDFfMDAwXzAwMCB9KTtcbiAgLy8gVW5kZXIgdGhlIHBhZDogd2lkZW5lZCB0byBleGFjdGx5IHRoZSBwYWQsIGVuZCBhbmNob3JlZC5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwRXh0ZW50KDk5OV8wMDAsIG51bGwsIDFfMDAwXzAwMCwgbnVsbCwgbnVsbCwgNjBfMDAwKSwgeyBzdGFydDogOTQwXzAwMCwgZW5kOiAxXzAwMF8wMDAgfSk7XG4gIC8vIEF0L2Fib3ZlIHRoZSBwYWQ6IHVudG91Y2hlZC5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwRXh0ZW50KDk0MF8wMDAsIG51bGwsIDFfMDAwXzAwMCwgbnVsbCwgbnVsbCwgNjBfMDAwKSwgeyBzdGFydDogOTQwXzAwMCwgZW5kOiAxXzAwMF8wMDAgfSk7XG59KTtcblxudGVzdCgnbWluaW1hcFdpbmRvd1JlY3Q6IG1hcHMgdGhlIHZpZXcgaW50byBzdHJpcCBweCBhbmQgY3JvcHMgYXQgdGhlIHN0cmlwIGVkZ2VzJywgKCkgPT4ge1xuICBjb25zdCBleHRlbnQ6IFRpbWVWaWV3ID0geyBzdGFydDogMCwgZW5kOiAxMF8wMDAgfTtcbiAgLy8gSW50ZXJpb3Igd2luZG93OiBleGFjdCBsaW5lYXIgbWFwcGluZy5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwV2luZG93UmVjdCh7IHN0YXJ0OiAyXzAwMCwgZW5kOiA2XzAwMCB9LCBleHRlbnQsIDFfMDAwKSwgeyB4MDogMjAwLCB4MTogNjAwIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKG1pbmltYXBXaW5kb3dSZWN0KHsgc3RhcnQ6IC0yXzAwMCwgZW5kOiA0XzAwMCB9LCBleHRlbnQsIDFfMDAwKSwgeyB4MDogMCwgeDE6IDQwMCB9KTtcbiAgLy8gU3ltbWV0cmljIGF0IHRoZSBsaXZlIGVuZC5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwV2luZG93UmVjdCh7IHN0YXJ0OiA4XzAwMCwgZW5kOiAxMl8wMDAgfSwgZXh0ZW50LCAxXzAwMCksIHsgeDA6IDgwMCwgeDE6IDFfMDAwIH0pO1xuICAvLyBEZWdlbmVyYXRlIGV4dGVudC93aWR0aDogdGhlIHdob2xlIHN0cmlwLlxuICBhc3NlcnQuZGVlcEVxdWFsKG1pbmltYXBXaW5kb3dSZWN0KHsgc3RhcnQ6IDAsIGVuZDogMSB9LCB7IHN0YXJ0OiA1LCBlbmQ6IDUgfSwgMV8wMDApLCB7IHgwOiAwLCB4MTogMV8wMDAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwobWluaW1hcFdpbmRvd1JlY3QoeyBzdGFydDogMCwgZW5kOiAxIH0sIGV4dGVudCwgMCksIHsgeDA6IDAsIHgxOiAwIH0pO1xufSk7XG5cbnRlc3QoJ21pbmltYXBXaW5kb3dSZWN0OiBhIHRpbnkgd2luZG93IGtlZXBzIGEgbWluaW11bSB2aXN1YWwgd2lkdGg7IGZ1bGx5IG91dHNpZGUgcGlucyBhIHNsaXZlciBhdCB0aGUgbmVhcmVyIGVkZ2UnLCAoKSA9PiB7XG4gIGNvbnN0IGV4dGVudDogVGltZVZpZXcgPSB7IHN0YXJ0OiAwLCBlbmQ6IDFfMDAwXzAwMCB9O1xuICAvLyBBIDEwLW1pbiB3aW5kb3cgb24gYSB3ZWVrLWxvbmcgZXh0ZW50IG1hcHMgdW5kZXIgYSBwaXhlbCBcdTIwMTQgZXhwYW5kZWQgYXJvdW5kIGl0cyBjZW50ZXIgdG8gTUlOSU1BUF9NSU5fV0lORE9XX1BYLlxuICBjb25zdCByID0gbWluaW1hcFdpbmRvd1JlY3QoeyBzdGFydDogNTAwXzAwMCwgZW5kOiA1MDBfMTAwIH0sIGV4dGVudCwgMV8wMDApO1xuICBhc3NlcnQub2soTWF0aC5hYnMoci54MSAtIHIueDAgLSBNSU5JTUFQX01JTl9XSU5ET1dfUFgpIDwgMWUtOSwgJ2V4cGFuZGVkIHRvIHRoZSBtaW5pbXVtJyk7XG4gIGFzc2VydC5vayhNYXRoLmFicygoci54MCArIHIueDEpIC8gMiAtIDUwMC4wNSkgPCAxZS02LCAnY2VudGVyZWQgd2hlcmUgdGhlIHdpbmRvdyBpcycpO1xuICAvLyBFbnRpcmVseSBiZWZvcmUgdGhlIGV4dGVudDogYSBzbGl2ZXIgcGlubmVkIGF0IHRoZSBsZWZ0IGVkZ2UuXG4gIGFzc2VydC5kZWVwRXF1YWwobWluaW1hcFdpbmRvd1JlY3QoeyBzdGFydDogLTkwMF8wMDAsIGVuZDogLTgwMF8wMDAgfSwgZXh0ZW50LCAxXzAwMCksIHsgeDA6IDAsIHgxOiBNSU5JTUFQX01JTl9XSU5ET1dfUFggfSk7XG4gIC8vIEVudGlyZWx5IGFmdGVyOiBwaW5uZWQgcmlnaHQuXG4gIGFzc2VydC5kZWVwRXF1YWwobWluaW1hcFdpbmRvd1JlY3QoeyBzdGFydDogMl8wMDBfMDAwLCBlbmQ6IDJfMTAwXzAwMCB9LCBleHRlbnQsIDFfMDAwKSwge1xuICAgIHgwOiAxXzAwMCAtIE1JTklNQVBfTUlOX1dJTkRPV19QWCxcbiAgICB4MTogMV8wMDAsXG4gIH0pO1xufSk7XG5cbnRlc3QoJ21pbmltYXBIaXRab25lOiBoYW5kbGVzIHdpbiBvdmVyIHRoZSBtaWRkbGUsIHpvbmVzIHJlYWNoIG91dHNpZGUgdGhlIHJlY3QsIGJvdW5kYXJpZXMgZXhhY3QnLCAoKSA9PiB7XG4gIGNvbnN0IHJlY3QgPSB7IHgwOiAyMDAsIHgxOiA0MDAgfTtcbiAgY29uc3QgaGl0ID0gTUlOSU1BUF9IQU5ETEVfSElUX1BYO1xuICAvLyBPdXRzaWRlIHJlYWNoOiBleGFjdGx5IGhpdFB4IGF3YXkgaXMgc3RpbGwgdGhlIGhhbmRsZTsgcGFzdCBpcyBub3QuXG4gIGFzc2VydC5lcXVhbChtaW5pbWFwSGl0Wm9uZSgyMDAgLSBoaXQsIHJlY3QpLCAnbGVmdC1oYW5kbGUnKTtcbiAgYXNzZXJ0LmVxdWFsKG1pbmltYXBIaXRab25lKDIwMCAtIGhpdCAtIDAuMDEsIHJlY3QpLCAnYmVmb3JlJyk7XG4gIGFzc2VydC5lcXVhbChtaW5pbWFwSGl0Wm9uZSg0MDAgKyBoaXQsIHJlY3QpLCAncmlnaHQtaGFuZGxlJyk7XG4gIGFzc2VydC5lcXVhbChtaW5pbWFwSGl0Wm9uZSg0MDAgKyBoaXQgKyAwLjAxLCByZWN0KSwgJ2FmdGVyJyk7XG4gIC8vIEluc2lkZSByZWFjaDogaGl0UHggaW50byBhIFdJREUgd2luZG93IHN0aWxsIGdyYWJzIHRoZSBoYW5kbGVcdTIwMjZcbiAgYXNzZXJ0LmVxdWFsKG1pbmltYXBIaXRab25lKDIwMCArIGhpdCwgcmVjdCksICdsZWZ0LWhhbmRsZScpO1xuICBhc3NlcnQuZXF1YWwobWluaW1hcEhpdFpvbmUoNDAwIC0gaGl0LCByZWN0KSwgJ3JpZ2h0LWhhbmRsZScpO1xuICAvLyBcdTIwMjZhbmQgcGFzdCBpdCBpcyB0aGUgZ3JhYmJhYmxlIG1pZGRsZS5cbiAgYXNzZXJ0LmVxdWFsKG1pbmltYXBIaXRab25lKDIwMCArIGhpdCArIDAuMDEsIHJlY3QpLCAnaW5zaWRlJyk7XG4gIGFzc2VydC5lcXVhbChtaW5pbWFwSGl0Wm9uZSgzMDAsIHJlY3QpLCAnaW5zaWRlJyk7XG59KTtcblxudGVzdCgnbWluaW1hcEhpdFpvbmU6IGEgbmFycm93IHdpbmRvdyBrZWVwcyBhIGdyYWJiYWJsZSBtaWRkbGUgKGluc2lkZSByZWFjaCBzaHJpbmtzIHdpdGggdGhlIHdpbmRvdyknLCAoKSA9PiB7XG4gIC8vIDEycHggd2luZG93OiBpbnNpZGUgcmVhY2ggc2hyaW5rcyB0byB3aWR0aC80ID0gM3B4LlxuICBjb25zdCByZWN0ID0geyB4MDogMTAwLCB4MTogMTEyIH07XG4gIGFzc2VydC5lcXVhbChtaW5pbWFwSGl0Wm9uZSgxMDYsIHJlY3QpLCAnaW5zaWRlJyk7XG4gIGFzc2VydC5lcXVhbChtaW5pbWFwSGl0Wm9uZSgxMDIsIHJlY3QpLCAnbGVmdC1oYW5kbGUnKTtcbiAgYXNzZXJ0LmVxdWFsKG1pbmltYXBIaXRab25lKDExMCwgcmVjdCksICdyaWdodC1oYW5kbGUnKTtcbiAgLy8gVGhlIHdpZHRoLzQgcnVsZSBrZWVwcyBib3RoIGhhbmRsZSB6b25lcyBkaXNqb2ludCBvbiBBTlkgbm9uemVyby13aWR0aCB3aW5kb3cuXG4gIGNvbnN0IHRpbnkgPSB7IHgwOiAxMDAsIHgxOiAxMDQgfTtcbiAgYXNzZXJ0LmVxdWFsKG1pbmltYXBIaXRab25lKDEwMSwgdGlueSksICdsZWZ0LWhhbmRsZScpO1xuICBhc3NlcnQuZXF1YWwobWluaW1hcEhpdFpvbmUoMTAzLCB0aW55KSwgJ3JpZ2h0LWhhbmRsZScpO1xuICBhc3NlcnQuZXF1YWwobWluaW1hcEhpdFpvbmUoMTAyLCB0aW55KSwgJ2luc2lkZScpO1xuICAvLyBaZXJvLXdpZHRoIHJlY3QgKG5vdCBwcm9kdWNpYmxlIGJ5IG1pbmltYXBXaW5kb3dSZWN0LCBidXQgdG90YWwpOiB0aGUgZXhhY3QgZWRnZSBpcyB0aGUgb3ZlcmxhcC5cbiAgYXNzZXJ0LmVxdWFsKG1pbmltYXBIaXRab25lKDEwMCwgeyB4MDogMTAwLCB4MTogMTAwIH0pLCAnbGVmdC1oYW5kbGUnKTtcbn0pO1xuXG50ZXN0KCdtaW5pbWFwUGFuOiBwaXhlbCBkZWx0YXMgcGFuIGF0IHRoZSBleHRlbnQgc2NhbGU7IGNsYW1wcyBhdCBib3RoIGV4dGVudCBlZGdlcycsICgpID0+IHtcbiAgY29uc3QgZXh0ZW50OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDAsIGVuZDogMTBfMDAwIH07XG4gIGNvbnN0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogMl8wMDAsIGVuZDogNF8wMDAgfTtcbiAgLy8gKzEwMHB4IG9uIGEgMTAwMHB4IHN0cmlwID0gKzEwJSBvZiB0aGUgZXh0ZW50ID0gKzEwMDBtcy5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwUGFuKHZpZXcsIDEwMCwgZXh0ZW50LCAxXzAwMCksIHsgc3RhcnQ6IDNfMDAwLCBlbmQ6IDVfMDAwIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKG1pbmltYXBQYW4odmlldywgLTEwMCwgZXh0ZW50LCAxXzAwMCksIHsgc3RhcnQ6IDFfMDAwLCBlbmQ6IDNfMDAwIH0pO1xuICAvLyBDbGFtcGVkIGF0IHRoZSBleHRlbnQgc3RhcnQgKHNwYW4gcHJlc2VydmVkKVx1MjAyNlxuICBhc3NlcnQuZGVlcEVxdWFsKG1pbmltYXBQYW4odmlldywgLTUwMCwgZXh0ZW50LCAxXzAwMCksIHsgc3RhcnQ6IDAsIGVuZDogMl8wMDAgfSk7XG4gIC8vIFx1MjAyNmFuZCBhdCB0aGUgbGl2ZSBlbmQuXG4gIGFzc2VydC5kZWVwRXF1YWwobWluaW1hcFBhbih2aWV3LCA5MDAsIGV4dGVudCwgMV8wMDApLCB7IHN0YXJ0OiA4XzAwMCwgZW5kOiAxMF8wMDAgfSk7XG4gIC8vIEEgd2luZG93IHdpZGVyIHRoYW4gdGhlIHdob2xlIGV4dGVudCBwaW5zIHRvIHRoZSBsaXZlIGVuZC5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwUGFuKHsgc3RhcnQ6IC0yMF8wMDAsIGVuZDogMCB9LCA1MCwgZXh0ZW50LCAxXzAwMCksIHsgc3RhcnQ6IC0xMF8wMDAsIGVuZDogMTBfMDAwIH0pO1xuICAvLyBEZWdlbmVyYXRlIGlucHV0czogdW5jaGFuZ2VkIChmcmVzaCBvYmplY3QsIHNhbWUgdmFsdWVzKS5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwUGFuKHZpZXcsIDEwMCwgeyBzdGFydDogNSwgZW5kOiA1IH0sIDFfMDAwKSwgdmlldyk7XG4gIGFzc2VydC5kZWVwRXF1YWwobWluaW1hcFBhbih2aWV3LCAxMDAsIGV4dGVudCwgMCksIHZpZXcpO1xufSk7XG5cbnRlc3QoJ21pbmltYXBSZXNpemU6IGVhY2ggaGFuZGxlIGRyYWdzIGl0cyBlZGdlLCBjbGFtcGVkIHRvIHRoZSBleHRlbnQgYW5kIHRoZSBzcGFuIGxpbWl0cycsICgpID0+IHtcbiAgY29uc3QgZXh0ZW50OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDAsIGVuZDogMTAwXzAwMCB9O1xuICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDQwXzAwMCwgZW5kOiA2MF8wMDAgfTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwUmVzaXplKHZpZXcsICdsZWZ0JywgMjAwLCBleHRlbnQsIDFfMDAwKSwgeyBzdGFydDogMjBfMDAwLCBlbmQ6IDYwXzAwMCB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwUmVzaXplKHZpZXcsICdyaWdodCcsIDgwMCwgZXh0ZW50LCAxXzAwMCksIHsgc3RhcnQ6IDQwXzAwMCwgZW5kOiA4MF8wMDAgfSk7XG4gIC8vIFBvaW50ZXIgcGFzdCB0aGUgc3RyaXAgZW5kcyBjbGFtcHMgdG8gdGhlIGV4dGVudCBlZGdlcy5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwUmVzaXplKHZpZXcsICdsZWZ0JywgLTUwLCBleHRlbnQsIDFfMDAwKSwgeyBzdGFydDogMCwgZW5kOiA2MF8wMDAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwobWluaW1hcFJlc2l6ZSh2aWV3LCAncmlnaHQnLCAxXzUwMCwgZXh0ZW50LCAxXzAwMCksIHsgc3RhcnQ6IDQwXzAwMCwgZW5kOiAxMDBfMDAwIH0pO1xuICAvLyBUaGUgc3BhbiBjZWlsaW5nIGhvbGRzOiBhIGh1Z2UgZXh0ZW50IGNhbid0IHN0cmV0Y2ggYSB3aW5kb3cgcGFzdCBNQVhfU1BBTl9NUy5cbiAgY29uc3Qgd2lkZTogVGltZVZpZXcgPSB7IHN0YXJ0OiAwLCBlbmQ6IDMwICogODZfNDAwXzAwMCB9O1xuICBjb25zdCBhdEVuZDogVGltZVZpZXcgPSB7IHN0YXJ0OiB3aWRlLmVuZCAtIDFfMDAwXzAwMCwgZW5kOiB3aWRlLmVuZCB9O1xuICBhc3NlcnQuZGVlcEVxdWFsKG1pbmltYXBSZXNpemUoYXRFbmQsICdsZWZ0JywgMCwgd2lkZSwgMV8wMDApLCB7IHN0YXJ0OiB3aWRlLmVuZCAtIE1BWF9TUEFOX01TLCBlbmQ6IHdpZGUuZW5kIH0pO1xuICAvLyBEZWdlbmVyYXRlIGV4dGVudC93aWR0aDogdW5jaGFuZ2VkLlxuICBhc3NlcnQuZGVlcEVxdWFsKG1pbmltYXBSZXNpemUodmlldywgJ2xlZnQnLCAyMDAsIHsgc3RhcnQ6IDUsIGVuZDogNSB9LCAxXzAwMCksIHZpZXcpO1xufSk7XG5cbnRlc3QoJ21pbmltYXBSZXNpemU6IGRyYWdnaW5nIGEgaGFuZGxlIHBhc3QgKG9yIGludG8pIHRoZSBvdGhlciBDTEFNUFMgYXQgdGhlIG1pbiBzcGFuIFx1MjAxNCBuZXZlciBmbGlwcycsICgpID0+IHtcbiAgY29uc3QgZXh0ZW50OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDAsIGVuZDogMTAwXzAwMCB9O1xuICBjb25zdCB2aWV3OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDQwXzAwMCwgZW5kOiA2MF8wMDAgfTtcbiAgLy8gTGVmdCBoYW5kbGUgZHJhZ2dlZCB3YXkgcGFzdCB0aGUgcmlnaHQgZWRnZTogcGFya3MgYXQgZW5kIC0gTUlOX1NQQU5fTVMuXG4gIGFzc2VydC5kZWVwRXF1YWwobWluaW1hcFJlc2l6ZSh2aWV3LCAnbGVmdCcsIDkwMCwgZXh0ZW50LCAxXzAwMCksIHsgc3RhcnQ6IDYwXzAwMCAtIE1JTl9TUEFOX01TLCBlbmQ6IDYwXzAwMCB9KTtcbiAgLy8gUmlnaHQgaGFuZGxlIGRyYWdnZWQgd2F5IHBhc3QgdGhlIGxlZnQgZWRnZTogcGFya3MgYXQgc3RhcnQgKyBNSU5fU1BBTl9NUy5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwUmVzaXplKHZpZXcsICdyaWdodCcsIDEwMCwgZXh0ZW50LCAxXzAwMCksIHsgc3RhcnQ6IDQwXzAwMCwgZW5kOiA0MF8wMDAgKyBNSU5fU1BBTl9NUyB9KTtcbiAgLy8gVGhlIG1pbi1zcGFuIGZsb29yIHdpbnMgb3ZlciB0aGUgZXh0ZW50IGNsYW1wIG5lYXIgdGhlIGV4dGVudCdzIGVuZHMuXG4gIGNvbnN0IG5lYXJTdGFydDogVGltZVZpZXcgPSB7IHN0YXJ0OiAwLCBlbmQ6IDFfMDAwIH07XG4gIGNvbnN0IHIgPSBtaW5pbWFwUmVzaXplKG5lYXJTdGFydCwgJ3JpZ2h0JywgMCwgZXh0ZW50LCAxXzAwMCk7XG4gIGFzc2VydC5kZWVwRXF1YWwociwgeyBzdGFydDogMCwgZW5kOiBNSU5fU1BBTl9NUyB9KTtcbn0pO1xuXG50ZXN0KCdtaW5pbWFwQ2VudGVyOiBjZW50ZXJzIHRoZSB3aW5kb3cgYXQgdGhlIGNsaWNrZWQgdGltZSBhdCBjb25zdGFudCBzcGFuOyBleHRlbnQtY2xhbXBlZCcsICgpID0+IHtcbiAgY29uc3QgZXh0ZW50OiBUaW1lVmlldyA9IHsgc3RhcnQ6IDAsIGVuZDogMTBfMDAwIH07XG4gIGNvbnN0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogMV8wMDAsIGVuZDogM18wMDAgfTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwQ2VudGVyKHZpZXcsIDcwMCwgZXh0ZW50LCAxXzAwMCksIHsgc3RhcnQ6IDZfMDAwLCBlbmQ6IDhfMDAwIH0pO1xuICAvLyBOZWFyIHRoZSBlZGdlcyB0aGUgd2luZG93IHNsaWRlcyBpbnNpZGUgaW5zdGVhZCBvZiBoYW5naW5nIG91dC5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwQ2VudGVyKHZpZXcsIDAsIGV4dGVudCwgMV8wMDApLCB7IHN0YXJ0OiAwLCBlbmQ6IDJfMDAwIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKG1pbmltYXBDZW50ZXIodmlldywgMV8wMDAsIGV4dGVudCwgMV8wMDApLCB7IHN0YXJ0OiA4XzAwMCwgZW5kOiAxMF8wMDAgfSk7XG4gIC8vIERlZ2VuZXJhdGU6IHVuY2hhbmdlZC5cbiAgYXNzZXJ0LmRlZXBFcXVhbChtaW5pbWFwQ2VudGVyKHZpZXcsIDUwMCwgZXh0ZW50LCAwKSwgdmlldyk7XG59KTtcblxuLy8gLS0gaGlzdG9yeVByb2JlICh0aGUgcmVxdWVzdC1mbG9vZCByZWdyZXNzaW9uKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdoaXN0b3J5UHJvYmU6IG5ldmVyIHJlYWNoZXMgcGFzdCB0aGUgY292ZXJlZCBlbmQgXHUyMDE0IHRoZSBsaXZlIGVkZ2UgYmVsb25ncyB0byB0aGUgZGF0YSBmZWVkJywgKCkgPT4ge1xuICBjb25zdCBub3cwID0gMV8wMDBfMDAwXzAwMDtcbiAgY29uc3Qgc3BhbiA9IDkwMF8wMDA7XG4gIGNvbnN0IGNvdmVyZWRFbmQgPSBub3cwOyAvLyBjb25zdW1lciBjb3ZlcmVkIHVwIHRvIGl0cyBsYXN0IHBvbGxcbiAgLy8gRm9sbG93IG1vZGU6IHRoZSB2aWV3J3MgZW5kIHJpZGVzIGFoZWFkIG9mIG5vdzsgXCJub3dcIiBrZWVwcyBhZHZhbmNpbmcuXG4gIGZvciAobGV0IGZyYW1lID0gMTsgZnJhbWUgPD0gMTAwOyBmcmFtZSsrKSB7XG4gICAgY29uc3Qgbm93ID0gbm93MCArIGZyYW1lICogMTY7XG4gICAgY29uc3QgZW5kID0gbm93ICsgc3BhbiAqIEZPTExPV19MRUFEX0ZSQUM7XG4gICAgY29uc3QgcHJvYmUgPSBoaXN0b3J5UHJvYmUoeyBzdGFydDogZW5kIC0gc3BhbiwgZW5kIH0sIG5vdywgY292ZXJlZEVuZCk7XG4gICAgYXNzZXJ0Lm9rKHByb2JlLCAndGhlIGJhY2t3YXJkIHdpbmRvdyBpcyBzdGlsbCBwcm9iZWFibGUnKTtcbiAgICBhc3NlcnQub2socHJvYmUuZW5kIDw9IGNvdmVyZWRFbmQsIGBmcmFtZSAke2ZyYW1lfTogcHJvYmUgbXVzdCBub3QgY2hhc2UgXCJub3dcIiBwYXN0IGNvdmVyYWdlYCk7XG4gIH1cbn0pO1xuXG50ZXN0KCdoaXN0b3J5UHJvYmUgKyBDb3ZlcmFnZVRyYWNrZXI6IGFuIGlkbGUgY292ZXJlZCB2aWV3cG9ydCBuZXZlciByZS1maXJlcyAobm8gcmVxdWVzdCBzdG9ybSknLCAoKSA9PiB7XG4gIGNvbnN0IHRyYWNrZXIgPSBuZXcgQ292ZXJhZ2VUcmFja2VyKCk7XG4gIGNvbnN0IHNwYW4gPSA5MDBfMDAwO1xuICBjb25zdCBub3cwID0gMV8wMDBfMDAwXzAwMDtcbiAgdHJhY2tlci5hZGRDb3ZlcmVkKG5vdzAgLSAyICogc3Bhbiwgbm93MCk7IC8vIHBvbGwgc2VlZGVkIGNvdmVyYWdlXG4gIGxldCByZXF1ZXN0cyA9IDA7XG4gIGZvciAobGV0IGZyYW1lID0gMDsgZnJhbWUgPCAxXzAwMDsgZnJhbWUrKykge1xuICAgIGNvbnN0IG5vdyA9IG5vdzAgKyBmcmFtZSAqIDE2O1xuICAgIGNvbnN0IGVuZCA9IG5vdyArIHNwYW4gKiBGT0xMT1dfTEVBRF9GUkFDO1xuICAgIGNvbnN0IHByb2JlID0gaGlzdG9yeVByb2JlKHsgc3RhcnQ6IGVuZCAtIHNwYW4sIGVuZCB9LCBub3csIHRyYWNrZXIuY292ZXJlZEVuZCgpKTtcbiAgICBpZiAoIXByb2JlKSBjb250aW51ZTtcbiAgICBjb25zdCByZXEgPSB0cmFja2VyLm5leHRSZXF1ZXN0KHByb2JlLCBub3cpO1xuICAgIGlmIChyZXEpIHtcbiAgICAgIHJlcXVlc3RzKys7XG4gICAgICB0cmFja2VyLnNldHRsZShyZXEsIHsgb2s6IHRydWUgfSk7IC8vIGNvdmVyZWQgXHUyMDE0IG11c3QgTEFUQ0hcbiAgICB9XG4gIH1cbiAgYXNzZXJ0LmVxdWFsKHJlcXVlc3RzLCAwLCAnZnVsbHkgY292ZXJlZCB2aWV3cG9ydCBpc3N1ZXMgemVybyBsb2FkUmFuZ2UgcmVxdWVzdHMgd2hpbGUgbm93IGFkdmFuY2VzJyk7XG59KTtcblxudGVzdCgnaGlzdG9yeVByb2JlOiBib290c3RyYXAgKG5vIGNvdmVyYWdlKSBwcm9iZXMgdXAgdG8gbm93LCB0aGVuIGxhdGNoZXMgYWZ0ZXIgb25lIHNldHRsZScsICgpID0+IHtcbiAgY29uc3QgdHJhY2tlciA9IG5ldyBDb3ZlcmFnZVRyYWNrZXIoKTtcbiAgY29uc3Qgc3BhbiA9IDkwMF8wMDA7XG4gIGxldCBub3cgPSAxXzAwMF8wMDBfMDAwO1xuICBjb25zdCBwcm9iZTAgPSBoaXN0b3J5UHJvYmUoeyBzdGFydDogbm93IC0gc3BhbiwgZW5kOiBub3cgfSwgbm93LCB0cmFja2VyLmNvdmVyZWRFbmQoKSk7XG4gIGFzc2VydC5vayhwcm9iZTAgJiYgcHJvYmUwLmVuZCA9PT0gbm93LCAnZmlyc3QgbG9hZCBtYXkgcmVhY2ggbm93Jyk7XG4gIGNvbnN0IHJlcSA9IHRyYWNrZXIubmV4dFJlcXVlc3QocHJvYmUwLCBub3cpO1xuICBhc3NlcnQub2socmVxKTtcbiAgdHJhY2tlci5zZXR0bGUocmVxLCB7IG9rOiB0cnVlIH0pO1xuICAvLyBGcmFtZXMga2VlcCBjb21pbmcsIG5vdyBrZWVwcyBhZHZhbmNpbmcgXHUyMDE0IGJ1dCBjb3ZlcmFnZSBub3cgZW5kcyBhdCB0aGUgc2V0dGxlZCBlZGdlLlxuICBsZXQgcmVmaXJlcyA9IDA7XG4gIGZvciAobGV0IGZyYW1lID0gMDsgZnJhbWUgPCA1MDA7IGZyYW1lKyspIHtcbiAgICBub3cgKz0gMTY7XG4gICAgY29uc3QgcHJvYmUgPSBoaXN0b3J5UHJvYmUoeyBzdGFydDogbm93IC0gc3BhbiwgZW5kOiBub3cgfSwgbm93LCB0cmFja2VyLmNvdmVyZWRFbmQoKSk7XG4gICAgaWYgKCFwcm9iZSkgY29udGludWU7XG4gICAgY29uc3QgciA9IHRyYWNrZXIubmV4dFJlcXVlc3QocHJvYmUsIG5vdyk7XG4gICAgaWYgKHIpIHtcbiAgICAgIHJlZmlyZXMrKztcbiAgICAgIHRyYWNrZXIuc2V0dGxlKHIsIHsgb2s6IHRydWUgfSk7XG4gICAgfVxuICB9XG4gIGFzc2VydC5lcXVhbChyZWZpcmVzLCAwLCAndGhlIGZvcndhcmQgc2xpdmVyIGJldHdlZW4gY292ZXJhZ2UgYW5kIG5vdyBpcyBuZXZlciByZXF1ZXN0ZWQnKTtcbn0pO1xuXG50ZXN0KCdoaXN0b3J5UHJvYmU6IGJhY2t3YXJkIGdhcHMgYXJlIHN0aWxsIHJlcXVlc3RlZCAocGFubmluZyBpbnRvIHVuY292ZXJlZCBoaXN0b3J5IHdvcmtzKScsICgpID0+IHtcbiAgY29uc3QgdHJhY2tlciA9IG5ldyBDb3ZlcmFnZVRyYWNrZXIoKTtcbiAgY29uc3Qgbm93ID0gMV8wMDBfMDAwXzAwMDtcbiAgdHJhY2tlci5hZGRDb3ZlcmVkKG5vdyAtIDFfMDAwXzAwMCwgbm93KTtcbiAgLy8gVmlld3BvcnQgcGFubmVkIGRlZXAgaW50byB0aGUgdW5jb3ZlcmVkIHBhc3QuXG4gIGNvbnN0IHZpZXc6IFRpbWVWaWV3ID0geyBzdGFydDogbm93IC0gNV8wMDBfMDAwLCBlbmQ6IG5vdyAtIDRfMDAwXzAwMCB9O1xuICBjb25zdCBwcm9iZSA9IGhpc3RvcnlQcm9iZSh2aWV3LCBub3csIHRyYWNrZXIuY292ZXJlZEVuZCgpKTtcbiAgYXNzZXJ0Lm9rKHByb2JlKTtcbiAgY29uc3QgcmVxID0gdHJhY2tlci5uZXh0UmVxdWVzdChwcm9iZSwgbm93KTtcbiAgYXNzZXJ0Lm9rKHJlcSwgJ2JhY2t3YXJkIGhpc3RvcnkgaXMgcmVxdWVzdGFibGUnKTtcbiAgYXNzZXJ0Lm9rKHJlcS5lbmQgPD0gbm93IC0gNF8wMDBfMDAwICsgMWUtNik7XG59KTtcblxudGVzdCgnY292ZXJhZ2U6IHRoZSBmaXhlZCBjYWRlbmNlIHN0aWxsIHN0b3JtLXByb29mcyBhIDYwSHogZnJhbWUgbG9vcCBhZnRlciBhIGZhaWx1cmUnLCAoKSA9PiB7XG4gIGNvbnN0IGMgPSBuZXcgQ292ZXJhZ2VUcmFja2VyKCk7IC8vIGRlZmF1bHQ6IGZpeGVkIDJzIHJldHJ5IGNhZGVuY2VcbiAgY29uc3QgdmlldzogVGltZVZpZXcgPSB7IHN0YXJ0OiAwLCBlbmQ6IDEwMF8wMDAgfTtcbiAgY29uc3QgcmVxID0gYy5uZXh0UmVxdWVzdCh2aWV3LCAwKTtcbiAgYXNzZXJ0Lm9rKHJlcSk7XG4gIGMuc2V0dGxlKHJlcSwgeyBvazogZmFsc2UgfSwgMV8wMDApO1xuICAvLyBBIGZyYW1lIGxvb3AgcHJvYmluZyBldmVyeSAxNm1zIGlzc3VlcyBOT1RISU5HIGluc2lkZSB0aGUgd2luZG93IFx1MjAxNCB0aGUgY2FkZW5jZSBnYXRlIChub3QgYmFja29mZiBncm93dGgpLlxuICBsZXQgaXNzdWVkID0gMDtcbiAgZm9yIChsZXQgbm93ID0gMV8wMTY7IG5vdyA8IDNfMDAwOyBub3cgKz0gMTYpIHtcbiAgICBpZiAoYy5uZXh0UmVxdWVzdCh2aWV3LCBub3cpKSBpc3N1ZWQrKztcbiAgfVxuICBhc3NlcnQuZXF1YWwoaXNzdWVkLCAwLCAnbm8gcmVxdWVzdCBzdG9ybSB3aXRoaW4gdGhlIHJldHJ5IHdpbmRvdycpO1xuICBhc3NlcnQub2soYy5uZXh0UmVxdWVzdCh2aWV3LCAzXzAwMSksICd0aGUgcmV0cnkgZmlyZXMgb25jZSB0aGUgY2FkZW5jZSBlbGFwc2VzJyk7XG59KTtcblxuLy8gLS0gUmVuZGVyIHBhY2luZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnZnJhbWVCdWRnZXRNczogaW50ZXJhY3RpdmUgcmVuZGVycyBldmVyeSBmcmFtZTsgaWRsZSB+MzBmcHM7IGJhdHRlcnkgfjEwZnBzJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoZnJhbWVCdWRnZXRNcygnaW50ZXJhY3RpdmUnKSwgMCk7XG4gIGFzc2VydC5lcXVhbChmcmFtZUJ1ZGdldE1zKCdpZGxlJyksIElETEVfRlJBTUVfTVMpO1xuICBhc3NlcnQuZXF1YWwoZnJhbWVCdWRnZXRNcygnaWRsZS1iYXR0ZXJ5JyksIElETEVfQkFUVEVSWV9GUkFNRV9NUyk7XG4gIGFzc2VydC5vayhJRExFX0ZSQU1FX01TID4gMTYuNyAmJiBJRExFX0ZSQU1FX01TIDwgMzQpO1xuICBhc3NlcnQuZXF1YWwoSURMRV9CQVRURVJZX0ZSQU1FX01TLCAxMDApO1xufSk7XG5cbnRlc3QoJ3Nob3VsZFJlbmRlcjogZ2F0ZXMgYSA2MEh6IHJBRiBzdHJlYW0gdG8gdGhlIHRpZXIgYnVkZ2V0IHdpdGhvdXQgYWxpYXNpbmcnLCAoKSA9PiB7XG4gIGNvbnN0IGNvdW50QXQgPSAoYnVkZ2V0OiBudW1iZXIpOiBudW1iZXIgPT4ge1xuICAgIGxldCByZW5kZXJlZCA9IDA7XG4gICAgbGV0IGxhc3QgPSAtSW5maW5pdHk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCA2MDA7IGkrKykge1xuICAgICAgY29uc3QgdCA9IGkgKiAoMTAwMCAvIDYwKTtcbiAgICAgIGlmIChzaG91bGRSZW5kZXIodCwgbGFzdCwgYnVkZ2V0KSkge1xuICAgICAgICByZW5kZXJlZCsrO1xuICAgICAgICBsYXN0ID0gdDtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlbmRlcmVkO1xuICB9O1xuICBhc3NlcnQuZXF1YWwoY291bnRBdCgwKSwgNjAwLCAnaW50ZXJhY3RpdmU6IGV2ZXJ5IGZyYW1lJyk7XG4gIGNvbnN0IGlkbGUgPSBjb3VudEF0KElETEVfRlJBTUVfTVMpO1xuICBhc3NlcnQub2soaWRsZSA+PSAyODAgJiYgaWRsZSA8PSAzMjAsIGBpZGxlIFx1MjI0OCAzMGZwcyBvdmVyIDEwcywgZ290ICR7aWRsZSAvIDEwfS9zYCk7XG4gIGNvbnN0IGJhdHRlcnkgPSBjb3VudEF0KElETEVfQkFUVEVSWV9GUkFNRV9NUyk7XG4gIGFzc2VydC5vayhiYXR0ZXJ5ID49IDk1ICYmIGJhdHRlcnkgPD0gMTA1LCBgYmF0dGVyeSBcdTIyNDggMTBmcHMgb3ZlciAxMHMsIGdvdCAke2JhdHRlcnkgLyAxMH0vc2ApO1xufSk7XG5cbnRlc3QoJ2Nsb2NrRHJhd0J1ZGdldE1zOiBub3JtYWwgem9vbXMgcmVuZGVyIGF0IHRoZSBwbGFpbiB0aWVyIGJ1ZGdldCcsICgpID0+IHtcbiAgY29uc3QgdmlldyA9IHsgc3RhcnQ6IDAsIGVuZDogMTBfMDAwIH07XG4gIGFzc2VydC5lcXVhbChjbG9ja0RyYXdCdWRnZXRNcyh2aWV3LCA5MDAsIDEsIElETEVfRlJBTUVfTVMpLCBJRExFX0ZSQU1FX01TKTtcbiAgYXNzZXJ0LmVxdWFsKGNsb2NrRHJhd0J1ZGdldE1zKHZpZXcsIDkwMCwgMiwgSURMRV9GUkFNRV9NUyksIElETEVfRlJBTUVfTVMpO1xuICBhc3NlcnQuZXF1YWwoY2xvY2tEcmF3QnVkZ2V0TXModmlldywgOTAwLCAyLCBJRExFX0JBVFRFUllfRlJBTUVfTVMpLCBJRExFX0JBVFRFUllfRlJBTUVfTVMpO1xufSk7XG5cbnRlc3QoJ2Nsb2NrRHJhd0J1ZGdldE1zOiB6b29tZWQgT1VUIHdpZGVucyB0byB0aGUgZXhhY3QgcGVyLWRldmljZS1waXhlbCBwZXJpb2QgXHUyMDE0IG5vIHVwcGVyIGNhcCcsICgpID0+IHtcbiAgY29uc3QgdmlldyA9IHsgc3RhcnQ6IDAsIGVuZDogOTAwXzAwMCB9O1xuICBhc3NlcnQuZXF1YWwoY2xvY2tEcmF3QnVkZ2V0TXModmlldywgOTAwLCAxLCBJRExFX0ZSQU1FX01TKSwgMTAwMCk7XG4gIGFzc2VydC5lcXVhbChjbG9ja0RyYXdCdWRnZXRNcyh2aWV3LCA5MDAsIDIsIElETEVfRlJBTUVfTVMpLCA1MDApO1xuICAvLyBBIHdlZWstbG9uZyBzcGFuIGFkdmFuY2VzIGEgcGl4ZWwgZXZlcnkgZmV3IG1pbnV0ZXMuXG4gIGFzc2VydC5lcXVhbChjbG9ja0RyYXdCdWRnZXRNcyh7IHN0YXJ0OiAwLCBlbmQ6IDcgKiA4Nl80MDBfMDAwIH0sIDkwMCwgMSwgSURMRV9GUkFNRV9NUyksICg3ICogODZfNDAwXzAwMCkgLyA5MDApO1xufSk7XG5cbnRlc3QoJ2Nsb2NrRHJhd0J1ZGdldE1zOiB0aGUgdGllciBidWRnZXQgaXMgYSBoYXJkIGZsb29yIFx1MjAxNCBuZXZlciByZW5kZXJzIGZhc3RlciB0aGFuIHRoZSB0aWVyJywgKCkgPT4ge1xuICAvLyBUaGUgY2VpbGluZyBjb25zdHJhaW50LCBzdHJ1Y3R1cmFsbHkgbWF4KCk6IHN3ZWVwIHNwYW5zL3dpZHRocy9kcHJzL1xuICAvLyBidWRnZXRzIFx1MjAxNCBldmVyeSByZXN1bHQgaXMgPj0gdGhlIHRpZXIgYnVkZ2V0LCBhbmQgZXF1YWxzIGl0IGV4YWN0bHlcbiAgLy8gd2hlbiB0aGUgcGVyLXBpeGVsIHBlcmlvZCBmaXRzIGluc2lkZSBpdC5cbiAgZm9yIChjb25zdCBzcGFuIG9mIFsxXzAwMCwgNjBfMDAwLCA5MDBfMDAwLCAzXzYwMF8wMDAsIDcgKiA4Nl80MDBfMDAwXSkge1xuICAgIGZvciAoY29uc3QgcGxvdFcgb2YgWzIwMCwgOTAwLCAyNTAwXSkge1xuICAgICAgZm9yIChjb25zdCBkcHIgb2YgWzEsIDEuNSwgMiwgM10pIHtcbiAgICAgICAgZm9yIChjb25zdCBidWRnZXQgb2YgW0lETEVfRlJBTUVfTVMsIElETEVfQkFUVEVSWV9GUkFNRV9NU10pIHtcbiAgICAgICAgICBjb25zdCBkID0gY2xvY2tEcmF3QnVkZ2V0TXMoeyBzdGFydDogMCwgZW5kOiBzcGFuIH0sIHBsb3RXLCBkcHIsIGJ1ZGdldCk7XG4gICAgICAgICAgY29uc3QgcGVyaW9kID0gc3BhbiAvIChwbG90VyAqIGRwcik7XG4gICAgICAgICAgYXNzZXJ0Lm9rKGQgPj0gYnVkZ2V0LCBgc3BhbiAke3NwYW59IHcgJHtwbG90V30gZHByICR7ZHByfSBidWRnZXQgJHtidWRnZXR9OiAke2R9IDwgJHtidWRnZXR9YCk7XG4gICAgICAgICAgYXNzZXJ0LmVxdWFsKGQsIE1hdGgubWF4KGJ1ZGdldCwgcGVyaW9kKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn0pO1xuXG50ZXN0KCdjbG9ja0RyYXdCdWRnZXRNczogbW9ub3RvbmUgaW4gc3BhbiBcdTIwMTQgem9vbWluZyBvdXQgbmV2ZXIgc3BlZWRzIHVwIHRoZSBjYWRlbmNlJywgKCkgPT4ge1xuICBsZXQgcHJldiA9IDA7XG4gIGZvciAoY29uc3Qgc3BhbiBvZiBbMV8wMDAsIDEwXzAwMCwgNjBfMDAwLCA5MDBfMDAwLCAzXzYwMF8wMDAsIDg2XzQwMF8wMDBdKSB7XG4gICAgY29uc3QgZCA9IGNsb2NrRHJhd0J1ZGdldE1zKHsgc3RhcnQ6IDAsIGVuZDogc3BhbiB9LCA5MDAsIDEsIElETEVfRlJBTUVfTVMpO1xuICAgIGFzc2VydC5vayhkID49IHByZXYsIGBzcGFuICR7c3Bhbn06ICR7ZH0gPCAke3ByZXZ9YCk7XG4gICAgcHJldiA9IGQ7XG4gIH1cbn0pO1xuXG50ZXN0KCdjbG9ja0RyYXdCdWRnZXRNczogaW50ZXJhY3RpdmUgdGllciAoYnVkZ2V0IDApIHlpZWxkcyB0aGUgYmFyZSBweCBwZXJpb2Q7IGRlZ2VuZXJhdGUgZ2VvbWV0cnkgZmFsbHMgYmFjayB0byB0aGUgdGllcicsICgpID0+IHtcbiAgY29uc3QgdmlldyA9IHsgc3RhcnQ6IDAsIGVuZDogOTAwXzAwMCB9O1xuICAvLyBtaW4oZGlzcGxheSByYXRlLCBweCByYXRlKSB3aXRoIGFuIHVuY2FwcGVkIGludGVyYWN0aXZlIHRpZXIgaXMgdGhlIHB4IHJhdGUgXHUyMDE0IDEwMDBtcyBwZXIgZGV2aWNlIHBpeGVsIGhlcmUuXG4gIGFzc2VydC5lcXVhbChjbG9ja0RyYXdCdWRnZXRNcyh2aWV3LCA5MDAsIDEsIDApLCAxMDAwKTtcbiAgLy8gRGVnZW5lcmF0ZSBpbnB1dHM6IHBsYWluIHRpZXIgcGFjaW5nLCBuZXZlciBhIGJvZ3VzIHRocm90dGxlLlxuICBhc3NlcnQuZXF1YWwoY2xvY2tEcmF3QnVkZ2V0TXMoeyBzdGFydDogNSwgZW5kOiA1IH0sIDkwMCwgMSwgSURMRV9GUkFNRV9NUyksIElETEVfRlJBTUVfTVMpO1xuICBhc3NlcnQuZXF1YWwoY2xvY2tEcmF3QnVkZ2V0TXMoeyBzdGFydDogMTAsIGVuZDogMCB9LCA5MDAsIDEsIElETEVfRlJBTUVfTVMpLCBJRExFX0ZSQU1FX01TKTtcbiAgYXNzZXJ0LmVxdWFsKGNsb2NrRHJhd0J1ZGdldE1zKHZpZXcsIDAsIDEsIElETEVfRlJBTUVfTVMpLCBJRExFX0ZSQU1FX01TKTtcbiAgYXNzZXJ0LmVxdWFsKGNsb2NrRHJhd0J1ZGdldE1zKHZpZXcsIDkwMCwgTmFOLCBJRExFX0ZSQU1FX01TKSwgSURMRV9GUkFNRV9NUyk7XG4gIGFzc2VydC5lcXVhbChjbG9ja0RyYXdCdWRnZXRNcyh7IHN0YXJ0OiBOYU4sIGVuZDogMSB9LCA5MDAsIDEsIElETEVfRlJBTUVfTVMpLCBJRExFX0ZSQU1FX01TKTtcbn0pO1xuXG4vLyAtLSBkaW1Db2xvciAodGhlIHVuaWZvcm0gZGltIHRyYW5zZm9ybSkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdkaW1Db2xvcjogaHVlIHByZXNlcnZlZCwgc2F0dXJhdGlvbiBhbmQgdmFsdWUgaGFsdmVkJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoZGltQ29sb3IoJyNmZjAwMDAnKSwgJ3JnYmEoMTI4LCA2NCwgNjQsIDEpJyk7XG4gIC8vIFB1cmUgZ3JlZW4gc3RheXMgZ3JlZW4tZG9taW5hbnQgYXQgaGFsZiBzdHJlbmd0aC5cbiAgYXNzZXJ0LmVxdWFsKGRpbUNvbG9yKCdyZ2IoMCwgMjU1LCAwKScpLCAncmdiYSg2NCwgMTI4LCA2NCwgMSknKTtcbn0pO1xuXG50ZXN0KCdkaW1Db2xvcjogZ3JleXMgaGFsdmUgdmFsdWUgd2l0aG91dCBpbnZlbnRpbmcgaHVlIG9yIHNhdHVyYXRpb24nLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChkaW1Db2xvcignIzgwODA4MCcpLCAncmdiYSg2NCwgNjQsIDY0LCAxKScpO1xuICBhc3NlcnQuZXF1YWwoZGltQ29sb3IoJyNmZmZmZmYnKSwgJ3JnYmEoMTI4LCAxMjgsIDEyOCwgMSknKTtcbiAgYXNzZXJ0LmVxdWFsKGRpbUNvbG9yKCcjMDAwMDAwJyksICdyZ2JhKDAsIDAsIDAsIDEpJyk7XG59KTtcblxudGVzdCgnZGltQ29sb3I6IGFscGhhIHBhc3NlcyB0aHJvdWdoIHVudG91Y2hlZCcsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKGRpbUNvbG9yKCdyZ2JhKDI1NSwgMCwgMCwgMC40KScpLCAncmdiYSgxMjgsIDY0LCA2NCwgMC40KScpO1xuICBhc3NlcnQuZXF1YWwoZGltQ29sb3IoJ2hzbGEoMCwgMTAwJSwgNTAlLCAwLjI1KScpLCAncmdiYSgxMjgsIDY0LCA2NCwgMC4yNSknKTtcbiAgYXNzZXJ0LmVxdWFsKGRpbUNvbG9yKCcjZmYwMDAwODAnKSwgYHJnYmEoMTI4LCA2NCwgNjQsICR7MTI4IC8gMjU1ICogMTAwMCAlIDEgPT09IDAgPyAxMjggLyAyNTUgOiBNYXRoLnJvdW5kKCgxMjggLyAyNTUpICogMTAwMCkgLyAxMDAwfSlgKTtcbn0pO1xuXG50ZXN0KCdkaW1Db2xvcjogaHNsIGFuZCBva2xjaCBmb3JtcyBwYXJzZTsgdW5rbm93biBmb3JtcyBwYXNzIHRocm91Z2gnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChkaW1Db2xvcignaHNsKDEyMCwgMTAwJSwgMjUlKScpLCAncmdiYSgzMiwgNjQsIDMyLCAxKScpO1xuICAvLyBva2xjaCBwdXJlLXJlZC1pc2ggaW5wdXQgY29udmVydHMgYW5kIHN0YXlzIHJlZC1kb21pbmFudC5cbiAgY29uc3QgcmVkID0gZGltQ29sb3IoJ29rbGNoKDAuNjI4IDAuMjU4IDI5LjIzNCknKTtcbiAgY29uc3QgbSA9IHJlZC5tYXRjaCgvXnJnYmFcXCgoXFxkKyksIChcXGQrKSwgKFxcZCspLCAxXFwpJC8pO1xuICBhc3NlcnQub2sobSwgYGV4cGVjdGVkIHJnYmEoKSBvdXRwdXQsIGdvdCAke3JlZH1gKTtcbiAgYXNzZXJ0Lm9rKE51bWJlcihtWzFdKSA+IE51bWJlcihtWzJdKSAmJiBOdW1iZXIobVsxXSkgPiBOdW1iZXIobVszXSksIHJlZCk7XG4gIC8vIG9rbGNoIHdpdGggYWxwaGEga2VlcHMgaXQuXG4gIGFzc2VydC5tYXRjaChkaW1Db2xvcignb2tsY2goMC42MiAwLjExIDIxMCAvIDAuOSknKSwgL15yZ2JhXFwoXFxkKywgXFxkKywgXFxkKywgMC45XFwpJC8pO1xuICAvLyBVbnN1cHBvcnRlZCBmb3JtcyByZXR1cm4gdW5jaGFuZ2VkIChuYW1lZCBjb2xvcnMsIHZhcigpIHJlZmVyZW5jZXMpLlxuICBhc3NlcnQuZXF1YWwoZGltQ29sb3IoJ3JlYmVjY2FwdXJwbGUnKSwgJ3JlYmVjY2FwdXJwbGUnKTtcbiAgYXNzZXJ0LmVxdWFsKGRpbUNvbG9yKCd2YXIoLS14KScpLCAndmFyKC0teCknKTtcbn0pO1xuXG50ZXN0KCdkaW1Db2xvcjogYXBwbHlpbmcgdG8gY2F0ZWdvcnlDb2xvciBvdXRwdXQga2VlcHMgdGhlIGNhdGVnb3J5IGh1ZSBmYW1pbHknLCAoKSA9PiB7XG4gIC8vIFRoZSBlbGVtZW50IGZlZWRzIHJlc29sdmVkIGNhdGVnb3J5IGNvbG9ycyB0aHJvdWdoIGRpbUNvbG9yIGZvclxuICAvLyBkaW1tZWQgcmVnaW9ucyBcdTIwMTQgYm90aCBjb2xvciBtb2RlcyBtdXN0IHJvdW5kLXRyaXAuXG4gIGZvciAoY29uc3QgbW9kZSBvZiBbJ29rbGNoJywgJ2hzbCddIGFzIGNvbnN0KSB7XG4gICAgY29uc3QgYmFzZSA9IGNhdGVnb3J5Q29sb3IoMjEwLCB7IG1vZGUgfSk7XG4gICAgY29uc3QgZGltbWVkID0gZGltQ29sb3IoYmFzZSk7XG4gICAgYXNzZXJ0Lm5vdEVxdWFsKGRpbW1lZCwgYmFzZSk7XG4gICAgYXNzZXJ0Lm1hdGNoKGRpbW1lZCwgL15yZ2JhXFwoLyk7XG4gIH1cbn0pO1xuXG4vLyAtLSBsYWJlbEhhbG9Db2xvciAoZ3VhcmFudGVlZCBsYWJlbCBsZWdpYmlsaXR5KSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdsYWJlbEhhbG9Db2xvcjogZGFyayBoYWxvIHVuZGVyIGEgbGlnaHQgZm9yZWdyb3VuZCcsICgpID0+IHtcbiAgLy8gVGhlIGRlZmF1bHQgZGFyay10aGVtZSBmZyBcdTIwMTQgbGFiZWxzIGFyZSBuZWFyLXdoaXRlLCBzbyB0aGUgcmltIGlzIGRhcmsuXG4gIGFzc2VydC5lcXVhbChsYWJlbEhhbG9Db2xvcignI2U4ZWNmNCcpLCAncmdiYSgwLCAwLCAwLCAwLjU1KScpO1xuICBhc3NlcnQuZXF1YWwobGFiZWxIYWxvQ29sb3IoJyNmZmZmZmYnKSwgJ3JnYmEoMCwgMCwgMCwgMC41NSknKTtcbiAgYXNzZXJ0LmVxdWFsKGxhYmVsSGFsb0NvbG9yKCcjODA4MDgwJyksICdyZ2JhKDAsIDAsIDAsIDAuNTUpJyk7XG59KTtcblxudGVzdCgnbGFiZWxIYWxvQ29sb3I6IGxpZ2h0IGhhbG8gdW5kZXIgYSBkYXJrIGZvcmVncm91bmQgKGxpZ2h0IHRoZW1lcyknLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChsYWJlbEhhbG9Db2xvcignIzExMTMxOCcpLCAncmdiYSgyNTUsIDI1NSwgMjU1LCAwLjU1KScpO1xuICBhc3NlcnQuZXF1YWwobGFiZWxIYWxvQ29sb3IoJyMwMDAwMDAnKSwgJ3JnYmEoMjU1LCAyNTUsIDI1NSwgMC41NSknKTtcbiAgYXNzZXJ0LmVxdWFsKGxhYmVsSGFsb0NvbG9yKCcjNmI2YjZiJyksICdyZ2JhKDI1NSwgMjU1LCAyNTUsIDAuNTUpJyk7XG59KTtcblxudGVzdCgnbGFiZWxIYWxvQ29sb3I6IGFjY2VwdHMgZXZlcnkgcGFyc2VDb2xvciBmb3JtOyBhbHBoYSBpbiBmZyBpcyBpZ25vcmVkJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwobGFiZWxIYWxvQ29sb3IoJ3JnYigyMzIsIDIzNiwgMjQ0KScpLCAncmdiYSgwLCAwLCAwLCAwLjU1KScpO1xuICBhc3NlcnQuZXF1YWwobGFiZWxIYWxvQ29sb3IoJ3JnYmEoMjMyLCAyMzYsIDI0NCwgMC4yKScpLCAncmdiYSgwLCAwLCAwLCAwLjU1KScpO1xuICBhc3NlcnQuZXF1YWwobGFiZWxIYWxvQ29sb3IoJ2hzbCgyMjAsIDM1JSwgOTMlKScpLCAncmdiYSgwLCAwLCAwLCAwLjU1KScpO1xuICBhc3NlcnQuZXF1YWwobGFiZWxIYWxvQ29sb3IoJ29rbGNoKDAuOTUgMC4wMSAyNTApJyksICdyZ2JhKDAsIDAsIDAsIDAuNTUpJyk7XG4gIGFzc2VydC5lcXVhbChsYWJlbEhhbG9Db2xvcignb2tsY2goMC4yIDAuMDIgMjUwKScpLCAncmdiYSgyNTUsIDI1NSwgMjU1LCAwLjU1KScpO1xufSk7XG5cbnRlc3QoJ2xhYmVsSGFsb0NvbG9yOiB1bnBhcnNlYWJsZSBjb2xvcnMgZmFsbCBiYWNrIHRvIHRoZSBkYXJrIGhhbG8nLCAoKSA9PiB7XG4gIC8vIFRoZSBkYXJrIGRlZmF1bHQgdGhlbWUncyBzaGFwZSBcdTIwMTQgYSB2YXIoKS9uYW1lZCBmZyBrZWVwcyBhIHNhbmUgcmltLlxuICBhc3NlcnQuZXF1YWwobGFiZWxIYWxvQ29sb3IoJ3ZhcigtLW15LWZnKScpLCAncmdiYSgwLCAwLCAwLCAwLjU1KScpO1xuICBhc3NlcnQuZXF1YWwobGFiZWxIYWxvQ29sb3IoJ3BhcGF5YXdoaXAnKSwgJ3JnYmEoMCwgMCwgMCwgMC41NSknKTtcbn0pO1xuXG4vLyAtLSBzZWdtZW50QXRUaW1lIChob3ZlcmVkLXBoYXNlIGhpdCByZWZpbmVtZW50KSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBUaGUgd2ViaG9vay1ydW5uZXIgc2hhcGU6IGEgZGltIHF1ZXVlIGxlYWQtaW4sIGEgaGF0Y2hlZCB3YWl0LCB0aGVuIHRoZSB1bnNlZ21lbnRlZCBiYXNlIGJhciB0byB0aGUgZW5kLlxuY29uc3QgU0VHX0lWID0geyBzdGFydDogMCwgZW5kOiAxMDBfMDAwIH07XG5jb25zdCBTRUdTID0gW1xuICB7IHN0YXJ0OiAwLCBlbmQ6IDQwXzAwMCwga2luZDogJ3F1ZXVlZCcgfSxcbiAgeyBzdGFydDogNDBfMDAwLCBlbmQ6IDcwXzAwMCwga2luZDogJ3dhaXRpbmcnIH0sXG5dO1xuXG50ZXN0KCdzZWdtZW50QXRUaW1lOiByZXNvbHZlcyB0aGUgcGhhc2UgY292ZXJpbmcgdCwgd2l0aCBpbmRleCBhbmQgY2xhbXBlZCB3aW5kb3cnLCAoKSA9PiB7XG4gIGFzc2VydC5kZWVwRXF1YWwoc2VnbWVudEF0VGltZShTRUdTLCBTRUdfSVYuc3RhcnQsIFNFR19JVi5lbmQsIDEwXzAwMCksIHsgaW5kZXg6IDAsIGtpbmQ6ICdxdWV1ZWQnLCBzdGFydDogMCwgZW5kOiA0MF8wMDAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoc2VnbWVudEF0VGltZShTRUdTLCBTRUdfSVYuc3RhcnQsIFNFR19JVi5lbmQsIDU1XzAwMCksIHsgaW5kZXg6IDEsIGtpbmQ6ICd3YWl0aW5nJywgc3RhcnQ6IDQwXzAwMCwgZW5kOiA3MF8wMDAgfSk7XG59KTtcblxudGVzdCgnc2VnbWVudEF0VGltZTogYmFzZSBiYXIgKG5vIGNvdmVyaW5nIHBoYXNlKSBhbmQgb2ZmLWJhciB0aW1lcyByZXNvbHZlIHRvIG51bGwnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChzZWdtZW50QXRUaW1lKFNFR1MsIFNFR19JVi5zdGFydCwgU0VHX0lWLmVuZCwgODVfMDAwKSwgbnVsbCk7IC8vIHBhc3QgdGhlIGxhc3QgcGhhc2VcbiAgYXNzZXJ0LmVxdWFsKHNlZ21lbnRBdFRpbWUoU0VHUywgU0VHX0lWLnN0YXJ0LCBTRUdfSVYuZW5kLCAtNSksIG51bGwpO1xuICBhc3NlcnQuZXF1YWwoc2VnbWVudEF0VGltZShbXSwgU0VHX0lWLnN0YXJ0LCBTRUdfSVYuZW5kLCAxMCksIG51bGwpO1xuICBhc3NlcnQuZXF1YWwoc2VnbWVudEF0VGltZShudWxsLCBTRUdfSVYuc3RhcnQsIFNFR19JVi5lbmQsIDEwKSwgbnVsbCk7XG4gIGFzc2VydC5lcXVhbChzZWdtZW50QXRUaW1lKHVuZGVmaW5lZCwgU0VHX0lWLnN0YXJ0LCBTRUdfSVYuZW5kLCAxMCksIG51bGwpO1xufSk7XG5cbnRlc3QoJ3NlZ21lbnRBdFRpbWU6IGhhbGYtb3BlbiBib3VuZGFyaWVzIFx1MjAxNCBhIHNoYXJlZCBlZGdlIGJlbG9uZ3MgdG8gdGhlIGluY29taW5nIHBoYXNlJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoc2VnbWVudEF0VGltZShTRUdTLCBTRUdfSVYuc3RhcnQsIFNFR19JVi5lbmQsIDQwXzAwMCk/LmtpbmQsICd3YWl0aW5nJyk7XG4gIC8vIFRoZSBsYXN0IHBoYXNlJ3MgdHJhaWxpbmcgZWRnZSBpcyBleGNsdXNpdmUgdG9vIChiYXNlIGJhciBiZXlvbmQgaXQpLlxuICBhc3NlcnQuZXF1YWwoc2VnbWVudEF0VGltZShTRUdTLCBTRUdfSVYuc3RhcnQsIFNFR19JVi5lbmQsIDcwXzAwMCksIG51bGwpO1xufSk7XG5cbnRlc3QoJ3NlZ21lbnRBdFRpbWU6IG92ZXJsYXBzIHJlc29sdmUgTEFTVC1wYWludGVkIChkcmF3IG9yZGVyIG92ZXJwYWludHMpJywgKCkgPT4ge1xuICBjb25zdCBvdmVybGFwcGluZyA9IFtcbiAgICB7IHN0YXJ0OiAwLCBlbmQ6IDgwXzAwMCwga2luZDogJ2RpbScgfSxcbiAgICB7IHN0YXJ0OiA1MF8wMDAsIGVuZDogMTAwXzAwMCwga2luZDogJ3dhaXRpbmcnIH0sXG4gIF07XG4gIGFzc2VydC5lcXVhbChzZWdtZW50QXRUaW1lKG92ZXJsYXBwaW5nLCBTRUdfSVYuc3RhcnQsIFNFR19JVi5lbmQsIDYwXzAwMCk/LmtpbmQsICd3YWl0aW5nJyk7XG4gIGFzc2VydC5lcXVhbChzZWdtZW50QXRUaW1lKG92ZXJsYXBwaW5nLCBTRUdfSVYuc3RhcnQsIFNFR19JVi5lbmQsIDIwXzAwMCk/LmtpbmQsICdkaW0nKTtcbn0pO1xuXG50ZXN0KCdzZWdtZW50QXRUaW1lOiBudWxsIGVuZCBydW5zIHRvIHRoZSBpbnRlcnZhbCBlbmQsIGluY2x1c2l2ZSBhdCB0aGUgYmFyXFwncyBsYXN0IGluc3RhbnQnLCAoKSA9PiB7XG4gIGNvbnN0IHRhaWwgPSBbeyBzdGFydDogOTBfMDAwLCBlbmQ6IG51bGwsIGtpbmQ6ICdvdXRsaW5lJyB9XTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChzZWdtZW50QXRUaW1lKHRhaWwsIFNFR19JVi5zdGFydCwgU0VHX0lWLmVuZCwgOTVfMDAwKSwgeyBpbmRleDogMCwga2luZDogJ291dGxpbmUnLCBzdGFydDogOTBfMDAwLCBlbmQ6IDEwMF8wMDAgfSk7XG4gIC8vIHQgZXhhY3RseSBhdCB0aGUgaW50ZXJ2YWwgZW5kIHN0aWxsIGhpdHMgdGhlIHNlZ21lbnQgZW5kaW5nIHRoZXJlLlxuICBhc3NlcnQuZXF1YWwoc2VnbWVudEF0VGltZSh0YWlsLCBTRUdfSVYuc3RhcnQsIFNFR19JVi5lbmQsIDEwMF8wMDApPy5raW5kLCAnb3V0bGluZScpO1xuICBhc3NlcnQuZXF1YWwoc2VnbWVudEF0VGltZSh0YWlsLCBTRUdfSVYuc3RhcnQsIFNFR19JVi5lbmQsIDEwMF8wMDEpLCBudWxsKTtcbn0pO1xuXG50ZXN0KCdzZWdtZW50QXRUaW1lOiBkcmF3LXBhdGggY2xhbXBzIFx1MjAxNCBzdGFydHMgZmxvb3IgdG8gdGhlIGludGVydmFsLCBlbmRzIGNhcCB0byBpdCwgb3V0c2lkZSBwaGFzZXMgc2tpcCcsICgpID0+IHtcbiAgY29uc3Qgc2VncyA9IFtcbiAgICB7IHN0YXJ0OiAtMTBfMDAwLCBlbmQ6IDIwXzAwMCwga2luZDogJ3F1ZXVlZCcgfSxcbiAgICB7IHN0YXJ0OiA2MF8wMDAsIGVuZDogNTAwXzAwMCwga2luZDogJ3dhaXRpbmcnIH0sIC8vIGVuZCBjYXBzIHRvIHRoZSBpbnRlcnZhbFxuICAgIHsgc3RhcnQ6IDE1MF8wMDAsIGVuZDogMTYwXzAwMCwga2luZDogJ2RpbScgfSwgLy8gZnVsbHkgb3V0c2lkZSBcdTIwMTQgbmV2ZXIgbWF0Y2hlc1xuICBdO1xuICBhc3NlcnQuZGVlcEVxdWFsKHNlZ21lbnRBdFRpbWUoc2VncywgU0VHX0lWLnN0YXJ0LCBTRUdfSVYuZW5kLCA1XzAwMCksIHsgaW5kZXg6IDAsIGtpbmQ6ICdxdWV1ZWQnLCBzdGFydDogMCwgZW5kOiAyMF8wMDAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoc2VnbWVudEF0VGltZShzZWdzLCBTRUdfSVYuc3RhcnQsIFNFR19JVi5lbmQsIDk5XzAwMCksIHsgaW5kZXg6IDEsIGtpbmQ6ICd3YWl0aW5nJywgc3RhcnQ6IDYwXzAwMCwgZW5kOiAxMDBfMDAwIH0pO1xuICBhc3NlcnQuZXF1YWwoc2VnbWVudEF0VGltZShzZWdzLCBTRUdfSVYuc3RhcnQsIFNFR19JVi5lbmQsIDMwXzAwMCksIG51bGwpO1xufSk7XG5cbnRlc3QoJ3NlZ21lbnRBdFRpbWU6IGFjY2VwdHMgRGF0ZSBwaGFzZSBib3VuZHMgKHRvTXMgbGlrZSBldmVyeSBBUEkgZWRnZSknLCAoKSA9PiB7XG4gIGNvbnN0IHNlZ3MgPSBbeyBzdGFydDogbmV3IERhdGUoMTBfMDAwKSwgZW5kOiBuZXcgRGF0ZSgyMF8wMDApLCBraW5kOiAnd2FpdGluZycgfV07XG4gIGFzc2VydC5lcXVhbChzZWdtZW50QXRUaW1lKHNlZ3MsIFNFR19JVi5zdGFydCwgU0VHX0lWLmVuZCwgMTVfMDAwKT8uaW5kZXgsIDApO1xufSk7XG5cbi8vIC0tIGZpdFNwYW5WaWV3IChzaW5nbGUtc3BhbiBmdWxsLXdpZHRoIGZpdCkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ2ZpdFNwYW5WaWV3OiBwYWRzIHRoZSBzcGFuIGJ5IHRoZSBmcmFjdGlvbiBlYWNoIHNpZGUgKGRlZmF1bHQgMC4wNSknLCAoKSA9PiB7XG4gIGFzc2VydC5kZWVwRXF1YWwoZml0U3BhblZpZXcoMCwgMTAwXzAwMCksIHsgc3RhcnQ6IC01XzAwMCwgZW5kOiAxMDVfMDAwIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGZpdFNwYW5WaWV3KDAsIDEwMF8wMDAsIDAuMSksIHsgc3RhcnQ6IC0xMF8wMDAsIGVuZDogMTEwXzAwMCB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChmaXRTcGFuVmlldygwLCAxMDBfMDAwLCAwKSwgeyBzdGFydDogMCwgZW5kOiAxMDBfMDAwIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGZpdFNwYW5WaWV3KDAsIE1JTl9TUEFOX01TLCAwKSwgeyBzdGFydDogMCwgZW5kOiBNSU5fU1BBTl9NUyB9KTtcbn0pO1xuXG50ZXN0KCdmaXRTcGFuVmlldzogc2hvcnQgc3BhbnMgYW5kIGluc3RhbnRzIGNlbnRlciBpbiB0aGUgbWluaW11bSB3aW5kb3cnLCAoKSA9PiB7XG4gIC8vIDUwMG1zIHBhZGRlZCAoNTUwbXMpIGlzIHVuZGVyIE1JTl9TUEFOX01TIFx1MjAxNCBjZW50ZXIsIG5ldmVyIGxlZnQtYW5jaG9yLlxuICBhc3NlcnQuZGVlcEVxdWFsKGZpdFNwYW5WaWV3KDAsIDUwMCksIHsgc3RhcnQ6IDI1MCAtIE1JTl9TUEFOX01TIC8gMiwgZW5kOiAyNTAgKyBNSU5fU1BBTl9NUyAvIDIgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZml0U3BhblZpZXcoNV8wMDAsIDVfMDAwKSwgeyBzdGFydDogNV8wMDAgLSBNSU5fU1BBTl9NUyAvIDIsIGVuZDogNV8wMDAgKyBNSU5fU1BBTl9NUyAvIDIgfSk7XG59KTtcblxudGVzdCgnZml0U3BhblZpZXc6IG9yZGVyLXRvbGVyYW50LCBEYXRlLXRvbGVyYW50LCBqdW5rIHBhZCBmYWxscyBiYWNrIHRvIHRoZSBkZWZhdWx0JywgKCkgPT4ge1xuICBhc3NlcnQuZGVlcEVxdWFsKGZpdFNwYW5WaWV3KDEwMF8wMDAsIDApLCBmaXRTcGFuVmlldygwLCAxMDBfMDAwKSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZml0U3BhblZpZXcobmV3IERhdGUoMCksIG5ldyBEYXRlKDEwMF8wMDApLCAwLjA1KSwgeyBzdGFydDogLTVfMDAwLCBlbmQ6IDEwNV8wMDAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZml0U3BhblZpZXcoMCwgMTAwXzAwMCwgLTEpLCBmaXRTcGFuVmlldygwLCAxMDBfMDAwLCAwLjA1KSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZml0U3BhblZpZXcoMCwgMTAwXzAwMCwgTnVtYmVyLk5hTiksIGZpdFNwYW5WaWV3KDAsIDEwMF8wMDAsIDAuMDUpKTtcbn0pO1xuIiwgIi8qKiBQb2ludGVyIGhpdC10ZXN0aW5nIHByaW1pdGl2ZXMgZm9yIGNhbnZhcy1wYWludGVkIGNvbXBvbmVudHMuICovXG5cbi8qKiBBbiBheGlzLWFsaWduZWQgaGl0IHJlY3RhbmdsZSAoQ1NTIHB4KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSGl0UmVjdCB7XG4gIHg6IG51bWJlcjtcbiAgeTogbnVtYmVyO1xuICB3OiBudW1iZXI7XG4gIGg6IG51bWJlcjtcbn1cblxuLyoqIFdpZGVuIGEgKHBvc3NpYmx5IGhhaXJsaW5lKSByZWN0IHRvIGF0IGxlYXN0IGBtaW5XYCBweCBhcm91bmQgaXRzIGNlbnRlclxuICogXHUyMDE0IGluc3RhbnRzIGdldCBhIGhpdCB0YXJnZXQgYSBmZXcgcHggbGFyZ2VyIHRoYW4gdGhlaXIgdmlzdWFsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4cGFuZEhpdFJlY3QocjogSGl0UmVjdCwgbWluVzogbnVtYmVyKTogSGl0UmVjdCB7XG4gIGlmIChyLncgPj0gbWluVykgcmV0dXJuIHI7XG4gIGNvbnN0IGN4ID0gci54ICsgci53IC8gMjtcbiAgcmV0dXJuIHsgeDogY3ggLSBtaW5XIC8gMiwgeTogci55LCB3OiBtaW5XLCBoOiByLmggfTtcbn1cblxuLypFZGdlcyBhcmUgaW5jbHVzaXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGhpdFRlc3RSZWN0cyh4OiBudW1iZXIsIHk6IG51bWJlciwgcmVjdHM6IHJlYWRvbmx5IEhpdFJlY3RbXSk6IG51bWJlciB7XG4gIGZvciAobGV0IGkgPSByZWN0cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGNvbnN0IHIgPSByZWN0c1tpXTtcbiAgICBpZiAoeCA+PSByLnggJiYgeCA8PSByLnggKyByLncgJiYgeSA+PSByLnkgJiYgeSA8PSByLnkgKyByLmgpIHJldHVybiBpO1xuICB9XG4gIHJldHVybiAtMTtcbn1cblxuLyoqIFNxdWFyZWQgZGlzdGFuY2UgZnJvbSBwb2ludCBwIHRvIHNlZ21lbnQgYWIuICovXG5leHBvcnQgZnVuY3Rpb24gZGlzdFNxVG9TZWdtZW50KHB4OiBudW1iZXIsIHB5OiBudW1iZXIsIGF4OiBudW1iZXIsIGF5OiBudW1iZXIsIGJ4OiBudW1iZXIsIGJ5OiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCBkeCA9IGJ4IC0gYXg7XG4gIGNvbnN0IGR5ID0gYnkgLSBheTtcbiAgY29uc3QgbGVuMiA9IGR4ICogZHggKyBkeSAqIGR5O1xuICBsZXQgdCA9IGxlbjIgPiAwID8gKChweCAtIGF4KSAqIGR4ICsgKHB5IC0gYXkpICogZHkpIC8gbGVuMiA6IDA7XG4gIGlmICh0IDwgMCkgdCA9IDA7XG4gIGVsc2UgaWYgKHQgPiAxKSB0ID0gMTtcbiAgY29uc3QgcXggPSBheCArIHQgKiBkeCAtIHB4O1xuICBjb25zdCBxeSA9IGF5ICsgdCAqIGR5IC0gcHk7XG4gIHJldHVybiBxeCAqIHF4ICsgcXkgKiBxeTtcbn1cblxuLyoqIFRydWUgd2hlbiB0aGUgcG9pbnQgaXMgd2l0aGluIGB0b2xgIHB4IG9mIHRoZSBwb2x5bGluZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoaXRUZXN0UG9seWxpbmUocHg6IG51bWJlciwgcHk6IG51bWJlciwgcHRzOiByZWFkb25seSB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH1bXSwgdG9sOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdDIgPSB0b2wgKiB0b2w7XG4gIGZvciAobGV0IGkgPSAxOyBpIDwgcHRzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGRpc3RTcVRvU2VnbWVudChweCwgcHksIHB0c1tpIC0gMV0ueCwgcHRzW2kgLSAxXS55LCBwdHNbaV0ueCwgcHRzW2ldLnkpIDw9IHQyKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG4iLCAiLyoqIERldGVybWluaXN0aWMgY2F0ZWdvcnkgY29sb3JzLCB0aGUgdW5pZm9ybSBkaW0gdHJhbnNmb3JtLiAqL1xuXG4vKiogRk5WLTFhIDMyLWJpdCBoYXNoIChzdGFibGUgYWNyb3NzIHNlc3Npb25zL3BsYXRmb3JtcykuICovXG5leHBvcnQgZnVuY3Rpb24gaGFzaFN0cmluZyhzOiBzdHJpbmcpOiBudW1iZXIge1xuICBsZXQgaCA9IDB4ODExYzlkYzU7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcy5sZW5ndGg7IGkrKykge1xuICAgIGggXj0gcy5jaGFyQ29kZUF0KGkpO1xuICAgIGggPSBNYXRoLmltdWwoaCwgMHgwMTAwMDE5Myk7XG4gIH1cbiAgcmV0dXJuIGggPj4+IDA7XG59XG5cbi8qKiBTdGFibGUgY2F0ZWdvcnkgXHUyMTkyIGh1ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYXRlZ29yeUh1ZShjYXRlZ29yeTogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3QgZyA9IChoYXNoU3RyaW5nKGNhdGVnb3J5KSAqIDAuNjE4MDMzOTg4NzUpICUgMTtcbiAgcmV0dXJuIE1hdGguZmxvb3IoZyAqIDM2MCk7XG59XG5cbi8qKiBUaGUgc2FsdCBjYXRlZ29yeUppdHRlciBoYXNoZXMgYWZ0ZXIgdGhlIGNhdGVnb3J5IG5hbWUuICovXG5jb25zdCBUT05FX1NBTFQgPSBgJHtTdHJpbmcuZnJvbUNoYXJDb2RlKDApfXRvbmVgO1xuXG4vKiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhdGVnb3J5Sml0dGVyKGNhdGVnb3J5OiBzdHJpbmcpOiB7IGRsOiBudW1iZXI7IGRjOiBudW1iZXIgfSB7XG4gIGNvbnN0IGggPSBoYXNoU3RyaW5nKGNhdGVnb3J5ICsgVE9ORV9TQUxUKTtcbiAgcmV0dXJuIHtcbiAgICBkbDogKChoICYgMHhmZikgLyAyNTUgLSAwLjUpICogMC4xLFxuICAgIGRjOiAoKChoID4+PiA4KSAmIDB4ZmYpIC8gMjU1IC0gMC41KSAqIDAuMDQsXG4gIH07XG59XG5cbi8qKiBPcHRpb25zIGZvciBjYXRlZ29yeUNvbG9yLiAqL1xuZXhwb3J0IGludGVyZmFjZSBDYXRlZ29yeUNvbG9yT3B0aW9ucyB7XG4gIC8qKiAnb2tsY2gnIChwZXJjZXB0dWFsbHkgZXZlbiBsaWdodG5lc3MgXHUyMDE0IHByZWZlcnJlZCkgb3IgJ2hzbCcgZmFsbGJhY2suICovXG4gIG1vZGU/OiAnb2tsY2gnIHwgJ2hzbCc7XG4gIC8qICovXG4gIGxpZ2h0bmVzcz86IG51bWJlcjtcbiAgLyogKi9cbiAgY2hyb21hPzogbnVtYmVyO1xuICAvKiAqL1xuICBhbHBoYT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBDU1MgY29sb3IgZm9yIGEgY2F0ZWdvcnkgaHVlLiBva2xjaCBrZWVwcyBwZXJjZWl2ZWQgbGlnaHRuZXNzIGV2ZW4gYWNyb3NzXG4gKiBodWVzIChsYWJlbCB0ZXh0IHN0YXlzIHJlYWRhYmxlIG9uIGV2ZXJ5IGNhdGVnb3J5KTsgdGhlIGhzbCBmYWxsYmFja1xuICogYXBwcm94aW1hdGVzIGl0IGZvciBlbmdpbmVzIHdpdGhvdXQgb2tsY2ggc3VwcG9ydC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhdGVnb3J5Q29sb3IoaHVlOiBudW1iZXIsIG9wdHM6IENhdGVnb3J5Q29sb3JPcHRpb25zID0ge30pOiBzdHJpbmcge1xuICBjb25zdCBsID0gb3B0cy5saWdodG5lc3MgPz8gMC42MjtcbiAgY29uc3QgYyA9IG9wdHMuY2hyb21hID8/IDAuMTE7XG4gIGNvbnN0IGEgPSBvcHRzLmFscGhhID8/IDE7XG4gIGlmIChvcHRzLm1vZGUgPT09ICdoc2wnKSB7XG4gICAgY29uc3QgcyA9IE1hdGgucm91bmQoTWF0aC5taW4oMSwgYyAvIDAuMzIpICogMTAwKTtcbiAgICBjb25zdCBsbCA9IE1hdGgucm91bmQobCAqIDg4KTtcbiAgICByZXR1cm4gYSA+PSAxID8gYGhzbCgke2h1ZX0sICR7c30lLCAke2xsfSUpYCA6IGBoc2xhKCR7aHVlfSwgJHtzfSUsICR7bGx9JSwgJHtyb3VuZDMoYSl9KWA7XG4gIH1cbiAgcmV0dXJuIGEgPj0gMSA/IGBva2xjaCgke3JvdW5kMyhsKX0gJHtyb3VuZDMoYyl9ICR7aHVlfSlgIDogYG9rbGNoKCR7cm91bmQzKGwpfSAke3JvdW5kMyhjKX0gJHtodWV9IC8gJHtyb3VuZDMoYSl9KWA7XG59XG5cbmZ1bmN0aW9uIHJvdW5kMyhuOiBudW1iZXIpOiBudW1iZXIge1xuICByZXR1cm4gTWF0aC5yb3VuZChuICogMTAwMCkgLyAxMDAwO1xufVxuXG4vLyAtLSBEaW0gdHJhbnNmb3JtIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyogKi9cbmZ1bmN0aW9uIHBhcnNlQ29sb3IoY29sb3I6IHN0cmluZyk6IHsgcjogbnVtYmVyOyBnOiBudW1iZXI7IGI6IG51bWJlcjsgYTogbnVtYmVyIH0gfCBudWxsIHtcbiAgY29uc3QgYyA9IGNvbG9yLnRyaW0oKTtcbiAgaWYgKGMuc3RhcnRzV2l0aCgnIycpKSB7XG4gICAgY29uc3QgaGV4ID0gYy5zbGljZSgxKTtcbiAgICBjb25zdCBuID0gaGV4Lmxlbmd0aDtcbiAgICBpZiAobiA9PT0gMyB8fCBuID09PSA0KSB7XG4gICAgICBjb25zdCB2ID0gaGV4LnNwbGl0KCcnKS5tYXAoKGNoKSA9PiBwYXJzZUludChjaCArIGNoLCAxNikpO1xuICAgICAgaWYgKHYuc29tZShOdW1iZXIuaXNOYU4pKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IHI6IHZbMF0sIGc6IHZbMV0sIGI6IHZbMl0sIGE6IG4gPT09IDQgPyB2WzNdIC8gMjU1IDogMSB9O1xuICAgIH1cbiAgICBpZiAobiA9PT0gNiB8fCBuID09PSA4KSB7XG4gICAgICBjb25zdCB2ID0gWzAsIDIsIDQsIDZdLnNsaWNlKDAsIG4gLyAyKS5tYXAoKGkpID0+IHBhcnNlSW50KGhleC5zbGljZShpLCBpICsgMiksIDE2KSk7XG4gICAgICBpZiAodi5zb21lKE51bWJlci5pc05hTikpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgcjogdlswXSwgZzogdlsxXSwgYjogdlsyXSwgYTogbiA9PT0gOCA/IHZbM10gLyAyNTUgOiAxIH07XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGNvbnN0IGZuID0gYy5tYXRjaCgvXihyZ2JhP3xoc2xhP3xva2xjaClcXCgoW14pXSspXFwpJC9pKTtcbiAgaWYgKCFmbikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG5hbWUgPSBmblsxXS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCBwYXJ0cyA9IGZuWzJdLnNwbGl0KC9bXFxzLC9dKy8pLmZpbHRlcigocCkgPT4gcCAhPT0gJycpO1xuICBpZiAocGFydHMubGVuZ3RoIDwgMykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG51bSA9IChzOiBzdHJpbmcpOiBudW1iZXIgPT4gcGFyc2VGbG9hdChzKTtcbiAgY29uc3QgYWxwaGEgPSBwYXJ0cy5sZW5ndGggPj0gNCA/IChwYXJ0c1szXS5lbmRzV2l0aCgnJScpID8gbnVtKHBhcnRzWzNdKSAvIDEwMCA6IG51bShwYXJ0c1szXSkpIDogMTtcbiAgaWYgKE51bWJlci5pc05hTihhbHBoYSkpIHJldHVybiBudWxsO1xuICBpZiAobmFtZS5zdGFydHNXaXRoKCdyZ2InKSkge1xuICAgIGNvbnN0IFtyLCBnLCBiXSA9IHBhcnRzLm1hcChudW0pO1xuICAgIGlmIChbciwgZywgYl0uc29tZShOdW1iZXIuaXNOYU4pKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4geyByLCBnLCBiLCBhOiBhbHBoYSB9O1xuICB9XG4gIGlmIChuYW1lLnN0YXJ0c1dpdGgoJ2hzbCcpKSB7XG4gICAgY29uc3QgaCA9IG51bShwYXJ0c1swXSk7XG4gICAgY29uc3QgcyA9IG51bShwYXJ0c1sxXSkgLyAxMDA7XG4gICAgY29uc3QgbCA9IG51bShwYXJ0c1syXSkgLyAxMDA7XG4gICAgaWYgKFtoLCBzLCBsXS5zb21lKE51bWJlci5pc05hTikpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGYgPSAoazogbnVtYmVyKTogbnVtYmVyID0+IHtcbiAgICAgIGNvbnN0IGtrID0gKGsgKyBoIC8gMzApICUgMTI7XG4gICAgICByZXR1cm4gbCAtIHMgKiBNYXRoLm1pbihsLCAxIC0gbCkgKiBNYXRoLm1heCgtMSwgTWF0aC5taW4oa2sgLSAzLCA5IC0ga2ssIDEpKTtcbiAgICB9O1xuICAgIHJldHVybiB7IHI6IGYoMCkgKiAyNTUsIGc6IGYoOCkgKiAyNTUsIGI6IGYoNCkgKiAyNTUsIGE6IGFscGhhIH07XG4gIH1cbiAgLy8gb2tsY2goTCBDIEggWy8gYV0pIFx1MjE5MiBzUkdCIChCalx1MDBGNnJuIE90dG9zc29uJ3MgT0tMYWIgY29uc3RhbnRzKS5cbiAgY29uc3QgTCA9IG51bShwYXJ0c1swXSk7XG4gIGNvbnN0IEMgPSBudW0ocGFydHNbMV0pO1xuICBjb25zdCBIID0gbnVtKHBhcnRzWzJdKTtcbiAgaWYgKFtMLCBDLCBIXS5zb21lKE51bWJlci5pc05hTikpIHJldHVybiBudWxsO1xuICBjb25zdCBociA9IChIICogTWF0aC5QSSkgLyAxODA7XG4gIGNvbnN0IGFhID0gQyAqIE1hdGguY29zKGhyKTtcbiAgY29uc3QgYmIgPSBDICogTWF0aC5zaW4oaHIpO1xuICBjb25zdCBsMyA9IEwgKyAwLjM5NjMzNzc3NzQgKiBhYSArIDAuMjE1ODAzNzU3MyAqIGJiO1xuICBjb25zdCBtMyA9IEwgLSAwLjEwNTU2MTM0NTggKiBhYSAtIDAuMDYzODU0MTcyOCAqIGJiO1xuICBjb25zdCBzMyA9IEwgLSAwLjA4OTQ4NDE3NzUgKiBhYSAtIDEuMjkxNDg1NTQ4ICogYmI7XG4gIGNvbnN0IGwgPSBsMyAqIGwzICogbDM7XG4gIGNvbnN0IG0gPSBtMyAqIG0zICogbTM7XG4gIGNvbnN0IHMgPSBzMyAqIHMzICogczM7XG4gIGNvbnN0IGxpbiA9IFtcbiAgICA0LjA3Njc0MTY2MjEgKiBsIC0gMy4zMDc3MTE1OTEzICogbSArIDAuMjMwOTY5OTI5MiAqIHMsXG4gICAgLTEuMjY4NDM4MDA0NiAqIGwgKyAyLjYwOTc1NzQwMTEgKiBtIC0gMC4zNDEzMTkzOTY1ICogcyxcbiAgICAtMC4wMDQxOTYwODYzICogbCAtIDAuNzAzNDE4NjE0NyAqIG0gKyAxLjcwNzYxNDcwMTAgKiBzLFxuICBdLm1hcCgoY2gpID0+IHtcbiAgICBjb25zdCBjbCA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEsIGNoKSk7XG4gICAgcmV0dXJuIChjbCA8PSAwLjAwMzEzMDggPyAxMi45MiAqIGNsIDogMS4wNTUgKiBNYXRoLnBvdyhjbCwgMSAvIDIuNCkgLSAwLjA1NSkgKiAyNTU7XG4gIH0pO1xuICByZXR1cm4geyByOiBsaW5bMF0sIGc6IGxpblsxXSwgYjogbGluWzJdLCBhOiBhbHBoYSB9O1xufVxuXG4vKkFwcGxpZWQgdG8gRVZFUlkgY29sb3IgcGFpbnRlZCBpbnNpZGUgYSBkaW1tZWQgcmVnaW9uIChmaWxsLCBoYXRjaGluZyxcbiAqIGJvcmRlciwgbGFiZWwgdGV4dCksIHNvIHJlbGF0aXZlIHRleHQtdnMtZmlsbCBjb250cmFzdCBpcyBwcmVzZXJ2ZWQgd2hpbGVcbiAqIHRoZSB3aG9sZSBzZWN0aW9uIHJlY2VkZXMuIEFjY2VwdHMgI2hleCwgcmdiKCkvcmdiYSgpLCBoc2woKS9oc2xhKCksIGFuZFxuICogb2tsY2goKSBjb2xvciBmb3JtczsgYW55dGhpbmcgZWxzZSAobmFtZWQgY29sb3JzLCB2YXIoKSByZWZlcmVuY2VzKSBpc1xuICogcmV0dXJuZWQgdW5jaGFuZ2VkIFx1MjAxNCB0aGUgY2FsbGVyIGtlZXBzIGEgc2FuZSBjb2xvciBlaXRoZXIgd2F5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpbUNvbG9yKGNvbG9yOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBwID0gcGFyc2VDb2xvcihjb2xvcik7XG4gIGlmICghcCkgcmV0dXJuIGNvbG9yO1xuICBjb25zdCByID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMjU1LCBwLnIpKSAvIDI1NTtcbiAgY29uc3QgZyA9IE1hdGgubWF4KDAsIE1hdGgubWluKDI1NSwgcC5nKSkgLyAyNTU7XG4gIGNvbnN0IGIgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigyNTUsIHAuYikpIC8gMjU1O1xuICBjb25zdCB2ID0gTWF0aC5tYXgociwgZywgYik7XG4gIGNvbnN0IGQgPSB2IC0gTWF0aC5taW4ociwgZywgYik7XG4gIGNvbnN0IHNhdCA9IHYgPT09IDAgPyAwIDogZCAvIHY7XG4gIGxldCBoID0gMDtcbiAgaWYgKGQgIT09IDApIHtcbiAgICBpZiAodiA9PT0gcikgaCA9ICgoZyAtIGIpIC8gZCkgJSA2O1xuICAgIGVsc2UgaWYgKHYgPT09IGcpIGggPSAoYiAtIHIpIC8gZCArIDI7XG4gICAgZWxzZSBoID0gKHIgLSBnKSAvIGQgKyA0O1xuICAgIGggPSAoaCArIDYpICUgNjtcbiAgfVxuICBjb25zdCBzMiA9IHNhdCAqIDAuNTtcbiAgY29uc3QgdjIgPSB2ICogMC41O1xuICBjb25zdCBjYyA9IHYyICogczI7XG4gIGNvbnN0IHggPSBjYyAqICgxIC0gTWF0aC5hYnMoKGggJSAyKSAtIDEpKTtcbiAgY29uc3QgbTAgPSB2MiAtIGNjO1xuICBjb25zdCBzZWN0b3IgPSBNYXRoLmZsb29yKGgpICUgNjtcbiAgY29uc3QgcmdiMSA9IFtcbiAgICBbY2MsIHgsIDBdLFxuICAgIFt4LCBjYywgMF0sXG4gICAgWzAsIGNjLCB4XSxcbiAgICBbMCwgeCwgY2NdLFxuICAgIFt4LCAwLCBjY10sXG4gICAgW2NjLCAwLCB4XSxcbiAgXVtzZWN0b3JdO1xuICBjb25zdCBvdXQgPSByZ2IxLm1hcCgoY2gpID0+IE1hdGgucm91bmQoKGNoICsgbTApICogMjU1KSk7XG4gIHJldHVybiBgcmdiYSgke291dFswXX0sICR7b3V0WzFdfSwgJHtvdXRbMl19LCAke3JvdW5kMyhwLmEpfSlgO1xufVxuXG4vLyAtLSBMYWJlbCBsZWdpYmlsaXR5IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qICovXG5mdW5jdGlvbiByZWxhdGl2ZUx1bWluYW5jZShyOiBudW1iZXIsIGc6IG51bWJlciwgYjogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgbGluID0gKGNoOiBudW1iZXIpOiBudW1iZXIgPT4ge1xuICAgIGNvbnN0IHMgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigyNTUsIGNoKSkgLyAyNTU7XG4gICAgcmV0dXJuIHMgPD0gMC4wNDA0NSA/IHMgLyAxMi45MiA6IE1hdGgucG93KChzICsgMC4wNTUpIC8gMS4wNTUsIDIuNCk7XG4gIH07XG4gIHJldHVybiAwLjIxMjYgKiBsaW4ocikgKyAwLjcxNTIgKiBsaW4oZykgKyAwLjA3MjIgKiBsaW4oYik7XG59XG5cbi8qKiBIYWxvIGNvbG9yIGZvciBjYW52YXMgbGFiZWwgdGV4dDogdGhlIHRyYW5zbHVjZW50IGNvdW50ZXItY29sb3IgcmltXG4gKiAoYHN0cm9rZVRleHRgIHVuZGVyIHRoZSBmaWxsKSB0aGF0IGd1YXJhbnRlZXMgbGFiZWwgbGVnaWJpbGl0eSBvdmVyIEFOWVxuICogc3VyZmFjZSBcdTIwMTQgc29saWQgZmlsbHMsIGRpbW1lZC9oYXRjaGVkIHNlZ21lbnRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxhYmVsSGFsb0NvbG9yKGZnOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBwID0gcGFyc2VDb2xvcihmZyk7XG4gIGNvbnN0IGRhcmsgPSAhcCB8fCByZWxhdGl2ZUx1bWluYW5jZShwLnIsIHAuZywgcC5iKSA+PSBNYXRoLnNxcnQoMC4wNSAqIDEuMDUpIC0gMC4wNTtcbiAgcmV0dXJuIGRhcmsgPyAncmdiYSgwLCAwLCAwLCAwLjU1KScgOiAncmdiYSgyNTUsIDI1NSwgMjU1LCAwLjU1KSc7XG59XG4iLCAiLy8gUHVyZSBtYXRoIGZvciB0aGUgPHRpbWVsaW5lLXZpZXc+IGVsZW1lbnQ6IHRpbWU8LT5waXhlbCBzY2FsZXMsIGFuIGFuY2hvci1wcmVzZXJ2aW5nIHpvb20uXG5cbmltcG9ydCB0eXBlIHsgSGl0UmVjdCB9IGZyb20gJy4vaGl0LXRlc3QudHMnO1xuXG4vLyAtLSBEYXRhIG1vZGVsIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQSBzd2ltbGFuZTogb25lIGxhYmVsZWQgaG9yaXpvbnRhbCBiYW5kIG9mIHRoZSB0aW1lbGluZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVGltZWxpbmVMYW5lIHtcbiAgLyoqIFVuaXF1ZSBsYW5lIGlkIFx1MjAxNCBpbnRlcnZhbHMgcmVmZXJlbmNlIGl0IHZpYSBgbGFuZUlkYC4gKi9cbiAgaWQ6IHN0cmluZztcbiAgLyoqIFRleHQgZHJhd24gaW4gdGhlIGxlZnQgZ3V0dGVyIChlbGxpcHNpemVkOyBmdWxsIHRleHQgdmlhIHRvb2x0aXApLiAqL1xuICBsYWJlbDogc3RyaW5nO1xuICAvKiogT3B0aW9uYWwgZ3JvdXBpbmcga2V5IFx1MjAxNCB0aGUgZGVmYXVsdCBjb2xvciBjYXRlZ29yeSBmb3IgaW50ZXJ2YWxzIHRoYXQgc2V0IG5vbmUuICovXG4gIGdyb3VwPzogc3RyaW5nO1xufVxuXG4vKiogQSBwaGFzZSB3aXRoaW4gYW4gaW50ZXJ2YWwsIHJlbmRlcmVkIGFzIGEgc3ViLXNwYW4gb2YgdGhlIGJhci4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVGltZWxpbmVTZWdtZW50IHtcbiAgLyoqIFBoYXNlIHN0YXJ0IChtcyBzaW5jZSBlcG9jaCwgb3IgYSBEYXRlKS4gQ2xhbXBlZCBpbnRvIHRoZSBwYXJlbnQgaW50ZXJ2YWwuICovXG4gIHN0YXJ0OiBudW1iZXIgfCBEYXRlO1xuICAvKiogUGhhc2UgZW5kOyBudWxsL3VuZGVmaW5lZCA9IHJ1bnMgdG8gdGhlIHBhcmVudCBpbnRlcnZhbCdzIGVuZC4gKi9cbiAgZW5kPzogbnVtYmVyIHwgRGF0ZSB8IG51bGw7XG4gIC8qKiBTdHlsZS1tYXAga2V5IGZvciB0aGlzIHBoYXNlIChlLmcuIGEgYnVpbHQtaW4gbGlrZSAnZGltJyBvciAnaGF0Y2gnKS4gKi9cbiAga2luZDogc3RyaW5nO1xufVxuXG4vKiogT25lIGJhciBvbiBhIGxhbmU6IFtzdGFydCwgZW5kXSBvbiB0aGUgc2hhcmVkIHRpbWUgYXhpcy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVGltZWxpbmVJbnRlcnZhbCB7XG4gIC8qKiBVbmlxdWUgaW50ZXJ2YWwgaWQgXHUyMDE0IGNvbm5lY3RvcnMgcmVmZXJlbmNlIGl0LCBtZXJnZURhdGEgZGVkdXBlcyBvbiBpdC4gKi9cbiAgaWQ6IHN0cmluZztcbiAgLyoqIFRoZSBsYW5lIHRoaXMgaW50ZXJ2YWwgYmVsb25ncyB0by4gKi9cbiAgbGFuZUlkOiBzdHJpbmc7XG4gIC8qKiBTdGFydCB0aW1lIChtcyBzaW5jZSBlcG9jaCwgb3IgYSBEYXRlKS4gKi9cbiAgc3RhcnQ6IG51bWJlciB8IERhdGU7XG4gIC8qKiBFbmQgdGltZTsgbnVsbC91bmRlZmluZWQgPSBvbmdvaW5nIChyZW5kZXJzIHRvIHRoZSBsaXZlIFwibm93XCIgZWRnZSkuICovXG4gIGVuZD86IG51bWJlciB8IERhdGUgfCBudWxsO1xuICAvKiogVGV4dCBkcmF3biBpbnNpZGUgdGhlIGJhciB3aGVuIGl0IGZpdHMgKG5ldmVyIG92ZXJmbG93cyB0aGUgYmFyKS4gKi9cbiAgbGFiZWw/OiBzdHJpbmc7XG4gIC8qKiBPcmRlcmVkIGxhYmVsIGZhbGxiYWNrcywgZnVsbGVzdCBcdTIxOTIgbW9zdCBjb21wYWN0OyB0aGUgd2lkZXN0IHRoYXQgZml0cyBkcmF3cy4gKi9cbiAgbGFiZWxUaWVycz86IHN0cmluZ1tdO1xuICAvKiogQ29sb3Iga2V5OiBzYW1lIGNhdGVnb3J5ID0gc2FtZSBodWUuIERlZmF1bHRzIHRvIGxhbmUuZ3JvdXAsIHRoZW4gbGFuZUlkLiAqL1xuICBjYXRlZ29yeT86IHN0cmluZztcbiAgLyoqIFN0eWxlLW1hcCBrZXk6IHJlbmRlcmluZyB0cmVhdG1lbnQgKGUuZy4gJ2ZhaWxlZCcsICdkaW0nLCAnaGF0Y2gnKS4gKi9cbiAgc3RhdGU/OiBzdHJpbmc7XG4gIC8qKiBQaGFzZXMgd2l0aGluIHRoZSBiYXIsIGVhY2ggc3R5bGVkIHZpYSBpdHMgYGtpbmRgLiAqL1xuICBzZWdtZW50cz86IFRpbWVsaW5lU2VnbWVudFtdO1xuICAvKiogVGhlIGludGVydmFsIHRoaXMgaXMgYSBTVUItU1BBTiBvZi4gKi9cbiAgcGFyZW50SWQ/OiBzdHJpbmcgfCBudWxsO1xuICAvKiogT3BhcXVlIGNvbnN1bWVyIHBheWxvYWQgXHUyMDE0IGVjaG9lZCBiYWNrIGluIGV2ZW50cyBhbmQgdG9vbHRpcCBjYWxsYmFja3MuICovXG4gIGRhdGE/OiB1bmtub3duO1xufVxuXG4vKiogQSBsaW5lIGJldHdlZW4gaW50ZXJ2YWxzIChlLmcuIGEgaGFuZG9mZiBvciBkZXBlbmRlbmN5IG9mIHRoZSBjb25zdW1lcidzIGNob29zaW5nKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVGltZWxpbmVDb25uZWN0b3Ige1xuICBmcm9tSW50ZXJ2YWxJZDogc3RyaW5nO1xuICB0b0ludGVydmFsSWQ6IHN0cmluZztcbiAgLyoqIENvbnN1bWVyLWRlZmluZWQga2luZCBcdTIwMTQgZWNob2VkIGluIGV2ZW50cy90b29sdGlwcy4gKi9cbiAga2luZD86IHN0cmluZztcbiAgLyoqIFRvb2x0aXAgdGV4dCBmb3IgdGhlIGNvbm5lY3Rvci4gKi9cbiAgbGFiZWw/OiBzdHJpbmc7XG59XG5cbi8qKiBBIHZlcnRpY2FsIHRpbWUgbWFya2VyIGFjcm9zcyBhbGwgbGFuZXMuICovXG5leHBvcnQgaW50ZXJmYWNlIFRpbWVsaW5lTWFya2VyIHtcbiAgdGltZTogbnVtYmVyIHwgRGF0ZTtcbiAgbGFiZWw/OiBzdHJpbmc7XG4gIC8qKiAnZW1waGFzaXMnIHJlbmRlcnMgaW4gdGhlIGVtcGhhc2lzIGNvbG9yOyBhbnl0aGluZyBlbHNlIGlzIG11dGVkLiAqL1xuICBraW5kPzogc3RyaW5nO1xufVxuXG4vKiogQWNjZXB0IG1zLXNpbmNlLWVwb2NoIG9yIERhdGUgYW55d2hlcmUgYSB0aW1lIGVudGVycyB0aGUgQVBJLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvTXModDogbnVtYmVyIHwgRGF0ZSk6IG51bWJlciB7XG4gIHJldHVybiB0eXBlb2YgdCA9PT0gJ251bWJlcicgPyB0IDogdC5nZXRUaW1lKCk7XG59XG5cbi8vIC0tIFZpZXdwb3J0IC8gc2NhbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEEgdmlzaWJsZSB0aW1lIHdpbmRvdyBbc3RhcnQsIGVuZF0gaW4gbXMgc2luY2UgZXBvY2guICovXG5leHBvcnQgaW50ZXJmYWNlIFRpbWVWaWV3IHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbi8qICovXG5leHBvcnQgY29uc3QgTUlOX1NQQU5fTVMgPSAyXzAwMDtcbmV4cG9ydCBjb25zdCBNQVhfU1BBTl9NUyA9IDcgKiA4Nl80MDBfMDAwO1xuXG4vKiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfU1BBTl9SRUZfTVMgPSAxODBfMDAwO1xuXG4vKiogVGhlIGNvbnRhaW5lciBhc3BlY3QgcmF0aW8gREVGQVVMVF9TUEFOX1JFRl9NUyBpcyBjYWxpYnJhdGVkIGF0LiAqL1xuY29uc3QgREVGQVVMVF9TUEFOX1JFRl9BU1BFQ1QgPSAxNiAvIDk7XG5cbi8qICovXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFNwYW5Gb3JBc3BlY3QoaG9zdFc6IG51bWJlciwgaG9zdEg6IG51bWJlciwgcmVmU3Bhbk1zID0gREVGQVVMVF9TUEFOX1JFRl9NUyk6IG51bWJlciB7XG4gIGxldCBzcGFuID0gcmVmU3Bhbk1zO1xuICBpZiAoTnVtYmVyLmlzRmluaXRlKGhvc3RXKSAmJiBob3N0VyA+IDAgJiYgTnVtYmVyLmlzRmluaXRlKGhvc3RIKSAmJiBob3N0SCA+IDApIHtcbiAgICBzcGFuID0gKHJlZlNwYW5NcyAqIChob3N0VyAvIGhvc3RIKSkgLyBERUZBVUxUX1NQQU5fUkVGX0FTUEVDVDtcbiAgfVxuICByZXR1cm4gTWF0aC5taW4oTUFYX1NQQU5fTVMsIE1hdGgubWF4KE1JTl9TUEFOX01TLCBzcGFuKSk7XG59XG5cbi8qICovXG5leHBvcnQgZnVuY3Rpb24gdGltZVRvWCh0OiBudW1iZXIsIHZpZXc6IFRpbWVWaWV3LCB3aWR0aDogbnVtYmVyKTogbnVtYmVyIHtcbiAgcmV0dXJuICgodCAtIHZpZXcuc3RhcnQpIC8gKHZpZXcuZW5kIC0gdmlldy5zdGFydCkpICogd2lkdGg7XG59XG5cbi8qKiB4IFx1MjE5MiB0aW1lIGZvciB0aGUgdmlldyAoaW52ZXJzZSBvZiB0aW1lVG9YKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB4VG9UaW1lKHg6IG51bWJlciwgdmlldzogVGltZVZpZXcsIHdpZHRoOiBudW1iZXIpOiBudW1iZXIge1xuICByZXR1cm4gdmlldy5zdGFydCArICh4IC8gd2lkdGgpICogKHZpZXcuZW5kIC0gdmlldy5zdGFydCk7XG59XG5cbi8qKiBTaGlmdCB0aGUgdmlldyBieSBkdCBtcyAocG9zaXRpdmUgPSBsYXRlcikuICovXG5leHBvcnQgZnVuY3Rpb24gcGFuVmlldyh2aWV3OiBUaW1lVmlldywgZHQ6IG51bWJlcik6IFRpbWVWaWV3IHtcbiAgcmV0dXJuIHsgc3RhcnQ6IHZpZXcuc3RhcnQgKyBkdCwgZW5kOiB2aWV3LmVuZCArIGR0IH07XG59XG5cbi8qKiBUaGUgaGFyZCByaWdodCBlbmQgc3RvcCBmb3IgdXNlci1kcml2ZW4gdmlld3M6IHRoZSByaWdodCBlZGdlIG5ldmVyIHBhc3Nlc1xuICogYG5vd2AgKHNwYW4gcHJlc2VydmVkOyB2aWV3cyBhbHJlYWR5IGF0L2JlZm9yZSBub3cgY29tZSBiYWNrIHVuY2hhbmdlZCkuICovXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBWaWV3VG9Ob3codmlldzogVGltZVZpZXcsIG5vdzogbnVtYmVyKTogVGltZVZpZXcge1xuICBpZiAodmlldy5lbmQgPD0gbm93KSByZXR1cm4gdmlldztcbiAgcmV0dXJuIHsgc3RhcnQ6IG5vdyAtICh2aWV3LmVuZCAtIHZpZXcuc3RhcnQpLCBlbmQ6IG5vdyB9O1xufVxuXG4vKiogU3RhdGljIHNjcm9sbCBib3VuZHM6IHRoZSBlYXJsaWVzdCB0aW1lIHRoZSB2aWV3IG1heSBzdGFydCBhdCBhbmQgdGhlXG4gKiBsYXRlc3QgaXQgbWF5IGVuZCBhdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVGltZUJvdW5kcyB7XG4gIG1pbjogbnVtYmVyIHwgbnVsbDtcbiAgbWF4OiBudW1iZXIgfCBudWxsO1xufVxuXG4vKipcbiAqIENsYW1wIGEgdmlldyBpbnRvIGBib3VuZHNgLCBwcmVzZXJ2aW5nIGl0cyBzcGFuOiBhIHZpZXcgcGFzdCBgbWF4YFxuICogc2hpZnRzIGJhY2ssIG9uZSBiZWZvcmUgYG1pbmAgc2hpZnRzIGZvcndhcmQuIEEgc3BhbiBXSURFUiB0aGFuIHRoZVxuICogYm91bmRlZCByYW5nZSBjYW5ub3QgcHJlc2VydmUgYm90aCBzdG9wcywgc28gaXQgY29sbGFwc2VzIHRvIGV4YWN0bHlcbiAqIFttaW4sIG1heF0gXHUyMDE0IHdoaWNoIGlzIHdoYXQgYSB6b29tLW91dCBhZ2FpbnN0IGEgc2hvcnQgc3RhdGljIHdpbmRvd1xuICogc2hvdWxkIGxhbmQgb24uIE51bGwgYW5kIG5vbi1maW5pdGUgc2lkZXMgYXJlIGlnbm9yZWQsIHNvIGFuIHVuYm91bmRlZFxuICogdmlldyBjb21lcyBiYWNrIHVudG91Y2hlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsYW1wVmlld1RvQm91bmRzKHZpZXc6IFRpbWVWaWV3LCBib3VuZHM6IFRpbWVCb3VuZHMpOiBUaW1lVmlldyB7XG4gIGNvbnN0IG1pbiA9IGJvdW5kcy5taW4gIT09IG51bGwgJiYgTnVtYmVyLmlzRmluaXRlKGJvdW5kcy5taW4pID8gYm91bmRzLm1pbiA6IG51bGw7XG4gIGNvbnN0IG1heCA9IGJvdW5kcy5tYXggIT09IG51bGwgJiYgTnVtYmVyLmlzRmluaXRlKGJvdW5kcy5tYXgpID8gYm91bmRzLm1heCA6IG51bGw7XG4gIGlmIChtaW4gPT09IG51bGwgJiYgbWF4ID09PSBudWxsKSByZXR1cm4gdmlldztcbiAgY29uc3Qgc3BhbiA9IHZpZXcuZW5kIC0gdmlldy5zdGFydDtcbiAgaWYgKG1pbiAhPT0gbnVsbCAmJiBtYXggIT09IG51bGwgJiYgbWF4IC0gbWluIDw9IHNwYW4pIHJldHVybiB7IHN0YXJ0OiBtaW4sIGVuZDogbWF4IH07XG4gIGxldCBvdXQgPSB2aWV3O1xuICBpZiAobWF4ICE9PSBudWxsICYmIG91dC5lbmQgPiBtYXgpIG91dCA9IHsgc3RhcnQ6IG1heCAtIHNwYW4sIGVuZDogbWF4IH07XG4gIGlmIChtaW4gIT09IG51bGwgJiYgb3V0LnN0YXJ0IDwgbWluKSBvdXQgPSB7IHN0YXJ0OiBtaW4sIGVuZDogbWluICsgc3BhbiB9O1xuICByZXR1cm4gb3V0O1xufVxuXG4vKiogVGhlIHdpZGVzdCBzcGFuIGBib3VuZHNgIGNhbiBzaG93LCBmb3IgYSB6b29tIGNsYW1wOiB0aGUgZGlzdGFuY2UgYmV0d2VlbiBmaW5pdGUgc3RvcHMsIGVsc2UgYG1heFNwYW5gLiBOZXZlciBiZWxvdyBgbWluU3BhbmAgXHUyMDE0IGEgYm91bmRlZCByYW5nZSBuYXJyb3dlciB0aGFuIHRoZSBoYXJkIHpvb20gZmxvb3Igc3RpbGwgem9vbXMgdG8gdGhlIGZsb29yLCBhbmQgY2xhbXBWaWV3VG9Cb3VuZHMgdGhlbiBwYXJrcyB0aGF0XG4gKiB3aW5kb3cgb3ZlciB0aGUgcmFuZ2UuICovXG5leHBvcnQgZnVuY3Rpb24gYm91bmRlZE1heFNwYW4oYm91bmRzOiBUaW1lQm91bmRzLCBtYXhTcGFuID0gTUFYX1NQQU5fTVMsIG1pblNwYW4gPSBNSU5fU1BBTl9NUyk6IG51bWJlciB7XG4gIGNvbnN0IHsgbWluLCBtYXggfSA9IGJvdW5kcztcbiAgaWYgKG1pbiA9PT0gbnVsbCB8fCBtYXggPT09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShtaW4pIHx8ICFOdW1iZXIuaXNGaW5pdGUobWF4KSkgcmV0dXJuIG1heFNwYW47XG4gIHJldHVybiBNYXRoLm1heChtaW5TcGFuLCBNYXRoLm1pbihtYXhTcGFuLCBtYXggLSBtaW4pKTtcbn1cblxuLyoqXG4gKiBab29tIHRoZSB2aWV3IGJ5IGBmYWN0b3JgICg+IDEgem9vbXMgaW4pIGtlZXBpbmcgYGFuY2hvcmAgYXQgdGhlIHNhbWVcbiAqIG9uLXNjcmVlbiBmcmFjdGlvbiBcdTIwMTQgdGhlIHRpbWUgdW5kZXIgdGhlIGN1cnNvciBzdGF5cyB1bmRlciB0aGUgY3Vyc29yLlxuICogVGhlIHNwYW4gaXMgY2xhbXBlZCB0byBbbWluU3BhbiwgbWF4U3Bhbl07IGNsYW1waW5nIHByZXNlcnZlcyB0aGUgYW5jaG9yXG4gKiBmcmFjdGlvbiwgc28gdGhlIGludmFyaWFudCBob2xkcyBldmVuIGF0IHRoZSBjbGFtcC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHpvb21WaWV3KFxuICB2aWV3OiBUaW1lVmlldyxcbiAgYW5jaG9yOiBudW1iZXIsXG4gIGZhY3RvcjogbnVtYmVyLFxuICBtaW5TcGFuID0gTUlOX1NQQU5fTVMsXG4gIG1heFNwYW4gPSBNQVhfU1BBTl9NUyxcbik6IFRpbWVWaWV3IHtcbiAgY29uc3Qgc3BhbiA9IHZpZXcuZW5kIC0gdmlldy5zdGFydDtcbiAgY29uc3QgZiA9IE51bWJlci5pc0Zpbml0ZShmYWN0b3IpICYmIGZhY3RvciA+IDAgPyBmYWN0b3IgOiAxO1xuICBsZXQgbmV4dCA9IHNwYW4gLyBmO1xuICBpZiAobmV4dCA8IG1pblNwYW4pIG5leHQgPSBtaW5TcGFuO1xuICBlbHNlIGlmIChuZXh0ID4gbWF4U3BhbikgbmV4dCA9IG1heFNwYW47XG4gIGNvbnN0IGZyYWMgPSBzcGFuID4gMCA/IChhbmNob3IgLSB2aWV3LnN0YXJ0KSAvIHNwYW4gOiAwLjU7XG4gIGNvbnN0IHN0YXJ0ID0gYW5jaG9yIC0gZnJhYyAqIG5leHQ7XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQ6IHN0YXJ0ICsgbmV4dCB9O1xufVxuXG4vKipcbiAqIFRoZSB2aWV3IHRoYXQgcmVuZGVycyBPTkUgc3BhbiBmdWxsLXdpZHRoOiBbc3RhcnQsIGVuZF0gcGx1cyBgcGFkYFxuICogZnJhY3Rpb24gb2YgdGhlIHNwYW4gb24gZWFjaCBzaWRlLiBTcGFucyB3aG9zZSBwYWRkZWQgd2luZG93IHdvdWxkIGZhbGxcbiAqIHVuZGVyIGBtaW5TcGFuYCAoaW5zdGFudHMsIHN1Yi1zZWNvbmQgcnVucykgY2VudGVyIGluIGEgYG1pblNwYW5gXG4gKiB3aW5kb3cgaW5zdGVhZCBcdTIwMTQgbmV2ZXIgbGVmdC1hbmNob3JlZCBieSBhIGxhdGVyIHNwYW4gY2xhbXAuIE9yZGVyLSBhbmRcbiAqIE5hTi10b2xlcmFudCBsaWtlIHNldFZpZXdwb3J0IChjYWxsZXJzIHN0aWxsIGNsYW1wIHRocm91Z2ggaXQpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZml0U3BhblZpZXcoc3RhcnQ6IG51bWJlciB8IERhdGUsIGVuZDogbnVtYmVyIHwgRGF0ZSwgcGFkID0gMC4wNSwgbWluU3BhbiA9IE1JTl9TUEFOX01TKTogVGltZVZpZXcge1xuICBjb25zdCBhID0gdG9NcyhzdGFydCk7XG4gIGNvbnN0IGIgPSB0b01zKGVuZCk7XG4gIGNvbnN0IGxvID0gTWF0aC5taW4oYSwgYik7XG4gIGNvbnN0IGhpID0gTWF0aC5tYXgoYSwgYik7XG4gIGNvbnN0IHAgPSBOdW1iZXIuaXNGaW5pdGUocGFkKSAmJiBwYWQgPiAwID8gcGFkIDogcGFkID09PSAwID8gMCA6IDAuMDU7XG4gIGNvbnN0IHNwYW4gPSBoaSAtIGxvO1xuICBpZiAoc3BhbiAqICgxICsgMiAqIHApIDwgbWluU3Bhbikge1xuICAgIGNvbnN0IG1pZCA9IChsbyArIGhpKSAvIDI7XG4gICAgcmV0dXJuIHsgc3RhcnQ6IG1pZCAtIG1pblNwYW4gLyAyLCBlbmQ6IG1pZCArIG1pblNwYW4gLyAyIH07XG4gIH1cbiAgcmV0dXJuIHsgc3RhcnQ6IGxvIC0gc3BhbiAqIHAsIGVuZDogaGkgKyBzcGFuICogcCB9O1xufVxuXG4vKiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdoZWVsRGVsdGFUb1BpeGVscyhkZWx0YTogbnVtYmVyLCBkZWx0YU1vZGU6IG51bWJlciwgbGluZUhlaWdodCA9IDE2LCBwYWdlSGVpZ2h0ID0gODAwKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoZGVsdGEpKSByZXR1cm4gMDtcbiAgaWYgKGRlbHRhTW9kZSA9PT0gMSkgcmV0dXJuIGRlbHRhICogbGluZUhlaWdodDtcbiAgaWYgKGRlbHRhTW9kZSA9PT0gMikgcmV0dXJuIGRlbHRhICogcGFnZUhlaWdodDtcbiAgcmV0dXJuIGRlbHRhO1xufVxuXG4vKiogUGl4ZWxzIG9mIHpvb20gd2hlZWwgcGVyIGRvdWJsaW5nIG9mIHRoZSBzY2FsZS4gKi9cbmV4cG9ydCBjb25zdCBaT09NX1BYX1BFUl9ET1VCTEUgPSAyNjA7XG5cbi8qKiBDb250aW51b3VzIGV4cG9uZW50aWFsIHpvb20gZmFjdG9yIGZvciBhIHdoZWVsIGRlbHRhIGluIHBpeGVsczogbmVnYXRpdmVcbiAqIChzY3JvbGwgdXAgLyBwaW5jaCBvdXQpIHpvb21zIGluLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHpvb21GYWN0b3JGb3JXaGVlbChkZWx0YVB4OiBudW1iZXIpOiBudW1iZXIge1xuICByZXR1cm4gTWF0aC5wb3coMiwgLWRlbHRhUHggLyBaT09NX1BYX1BFUl9ET1VCTEUpO1xufVxuXG4vKiogVGhlIHBhcnRzIG9mIGEgV2hlZWxFdmVudCB0aGUgZ2VzdHVyZSByb3V0ZXIgcmVhZHMuICovXG5leHBvcnQgaW50ZXJmYWNlIFdoZWVsSW5wdXQge1xuICBkZWx0YVg6IG51bWJlcjtcbiAgZGVsdGFZOiBudW1iZXI7XG4gIGRlbHRhTW9kZTogbnVtYmVyO1xuICBjdHJsS2V5OiBib29sZWFuO1xuICBtZXRhS2V5OiBib29sZWFuO1xuICBzaGlmdEtleTogYm9vbGVhbjtcbn1cblxuLyoqIFdoZXJlIGEgd2hlZWwgZ2VzdHVyZSdzIGVuZXJneSBnb2VzIChhbGwgZGVsdGFNb2RlLW5vcm1hbGl6ZWQgcGl4ZWxzKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgV2hlZWxSb3V0ZSB7XG4gIC8qKiBab29tIChjdHJsL21ldGEgKyB3aGVlbCksIGZyb20gdGhlIHZlcnRpY2FsIGRlbHRhLiAqL1xuICB6b29tUHg6IG51bWJlcjtcbiAgLyoqIEhvcml6b250YWwgdGltZSBwYW4uICovXG4gIHBhblB4OiBudW1iZXI7XG4gIC8qKiBWZXJ0aWNhbCBsYW5lLXN0YWNrIHNjcm9sbC4gKi9cbiAgbGFuZVNjcm9sbFB4OiBudW1iZXI7XG4gIC8qKiBGYWxzZSA9IHRoZSBjaGFydCB0YWtlcyBOT1RISU5HIGZyb20gdGhpcyBldmVudCBcdTIwMTQgdGhlIGNhbGxlciBtdXN0IG5vdCBwcmV2ZW50RGVmYXVsdC4gKi9cbiAgY29uc3VtZWQ6IGJvb2xlYW47XG59XG5cbi8qKiBEaXJlY3Rpb24tYXdhcmUgbGFuZS1zdGFjayBzY3JvbGxhYmlsaXR5OiB3aGV0aGVyIHRoZSBzdGFjayBjYW4gbW92ZSB1cFxuICogKHRvd2FyZCBlYXJsaWVyIGxhbmVzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBMYW5lU2Nyb2xsYWJsZSB7XG4gIHVwOiBib29sZWFuO1xuICBkb3duOiBib29sZWFuO1xufVxuXG4vKiogcm91dGVXaGVlbC9XaGVlbEdlc3R1cmVSb3V0ZXIncyBsYW5lLXN0YWNrIGlucHV0OiB0aGUgYm9vbGVhbi4gKi9cbmV4cG9ydCB0eXBlIExhbmVTY3JvbGxJbnB1dCA9IGJvb2xlYW4gfCBMYW5lU2Nyb2xsYWJsZTtcblxuLyoqIFdoZXRoZXIgdGhlIHN0YWNrIG92ZXJmbG93cyBhdCBhbGwgXHUyMDE0IGdhdGVzIHRoZSBtaW5vci1keSBudWRnZSBpbnNpZGUgYVxuICogY29uc3VtZWQgaG9yaXpvbnRhbCBnZXN0dXJlIChjbGFtcGluZyBvd25zIHRoZSBlZGdlcyB0aGVyZSkuICovXG5mdW5jdGlvbiBsYW5lT3ZlcmZsb3dzKGxhbmVzOiBMYW5lU2Nyb2xsSW5wdXQpOiBib29sZWFuIHtcbiAgcmV0dXJuIHR5cGVvZiBsYW5lcyA9PT0gJ2Jvb2xlYW4nID8gbGFuZXMgOiBsYW5lcy51cCB8fCBsYW5lcy5kb3duO1xufVxuXG4vKiogV2hldGhlciB0aGUgc3RhY2sgY2FuIHRha2UgYSB2ZXJ0aWNhbCBkZWx0YTogbW92ZXMgaW4gZHkncyBkaXJlY3Rpb24gd2l0aFxuICogaGVhZHJvb20uICovXG5mdW5jdGlvbiBsYW5lQ2FuVGFrZShsYW5lczogTGFuZVNjcm9sbElucHV0LCBkeTogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICh0eXBlb2YgbGFuZXMgPT09ICdib29sZWFuJykgcmV0dXJuIGZhbHNlO1xuICBpZiAoZHkgPiAwKSByZXR1cm4gbGFuZXMuZG93bjtcbiAgaWYgKGR5IDwgMCkgcmV0dXJuIGxhbmVzLnVwO1xuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBSb3V0ZSBhIHdoZWVsL3RyYWNrcGFkIGdlc3R1cmU6IGN0cmwvbWV0YSt3aGVlbCB6b29tcyAoYWx3YXlzIGNvbnN1bWVkIFx1MjAxNFxuICogYSBwaW5jaCBzdHJlYW0gbXVzdCBuZXZlciBsZWFrIGJyb3dzZXIgcGFnZS16b29tLCBldmVuIG9uIGEgemVyby1kZWx0YVxuICogdGljayk7IHNoaWZ0K3doZWVsIHBhbnMgdGltZSAoYSB2ZXJ0aWNhbCB3aGVlbCBwYW5zIGhvcml6b250YWxseSk7XG4gKiBvdGhlcndpc2UgdGhlIERPTUlOQU5UIGF4aXMgZGVjaWRlcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiByb3V0ZVdoZWVsKGU6IFdoZWVsSW5wdXQsIGxhbmVzOiBMYW5lU2Nyb2xsSW5wdXQpOiBXaGVlbFJvdXRlIHtcbiAgY29uc3QgZHggPSB3aGVlbERlbHRhVG9QaXhlbHMoZS5kZWx0YVgsIGUuZGVsdGFNb2RlKTtcbiAgY29uc3QgZHkgPSB3aGVlbERlbHRhVG9QaXhlbHMoZS5kZWx0YVksIGUuZGVsdGFNb2RlKTtcbiAgaWYgKGUuY3RybEtleSB8fCBlLm1ldGFLZXkpIHJldHVybiB7IHpvb21QeDogZHksIHBhblB4OiAwLCBsYW5lU2Nyb2xsUHg6IDAsIGNvbnN1bWVkOiB0cnVlIH07XG4gIGlmIChlLnNoaWZ0S2V5KSB7XG4gICAgY29uc3QgcGFuID0gZHkgfHwgZHg7XG4gICAgcmV0dXJuIHsgem9vbVB4OiAwLCBwYW5QeDogcGFuLCBsYW5lU2Nyb2xsUHg6IDAsIGNvbnN1bWVkOiBwYW4gIT09IDAgfTtcbiAgfVxuICBpZiAoIShNYXRoLmFicyhkeCkgPiBNYXRoLmFicyhkeSkpKSB7XG4gICAgaWYgKGxhbmVDYW5UYWtlKGxhbmVzLCBkeSkpIHJldHVybiB7IHpvb21QeDogMCwgcGFuUHg6IDAsIGxhbmVTY3JvbGxQeDogZHksIGNvbnN1bWVkOiB0cnVlIH07XG4gICAgcmV0dXJuIHsgem9vbVB4OiAwLCBwYW5QeDogMCwgbGFuZVNjcm9sbFB4OiAwLCBjb25zdW1lZDogZmFsc2UgfTtcbiAgfVxuICByZXR1cm4geyB6b29tUHg6IDAsIHBhblB4OiBkeCwgbGFuZVNjcm9sbFB4OiBsYW5lT3ZlcmZsb3dzKGxhbmVzKSA/IGR5IDogMCwgY29uc3VtZWQ6IHRydWUgfTtcbn1cblxuLyoqIFRob3NlIHdoZWVsLXJvdXRpbmcgb3V0Y29tZXMsIHdpdGhvdXQgbWFnbml0dWRlcyAoc2VlIGNsYXNzaWZ5V2hlZWwpLiAqL1xuZXhwb3J0IHR5cGUgV2hlZWxDbGFzcyA9ICd6b29tJyB8ICdwYW4nIHwgJ3Bhc3N0aHJvdWdoJztcblxuLyoqIGNsYXNzaWZ5V2hlZWwoZSk6IHRoZSByb3V0aW5nIGRlY2lzaW9uIHdpdGhvdXQgbWFnbml0dWRlcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGFzc2lmeVdoZWVsKGU6IFdoZWVsSW5wdXQpOiBXaGVlbENsYXNzIHtcbiAgaWYgKGUuY3RybEtleSB8fCBlLm1ldGFLZXkpIHJldHVybiAnem9vbSc7XG4gIGNvbnN0IGR4ID0gd2hlZWxEZWx0YVRvUGl4ZWxzKGUuZGVsdGFYLCBlLmRlbHRhTW9kZSk7XG4gIGNvbnN0IGR5ID0gd2hlZWxEZWx0YVRvUGl4ZWxzKGUuZGVsdGFZLCBlLmRlbHRhTW9kZSk7XG4gIGlmIChlLnNoaWZ0S2V5KSByZXR1cm4gKGR5IHx8IGR4KSAhPT0gMCA/ICdwYW4nIDogJ3Bhc3N0aHJvdWdoJztcbiAgcmV0dXJuIE1hdGguYWJzKGR4KSA+IE1hdGguYWJzKGR5KSA/ICdwYW4nIDogJ3Bhc3N0aHJvdWdoJztcbn1cblxuLyoqIE1pbGxpc2Vjb25kcyBvZiB1bm1vZGlmaWVkLXdoZWVsIHNpbGVuY2UgdGhhdCBlbmRzIGEgZ2VzdHVyZS4gKi9cbmV4cG9ydCBjb25zdCBXSEVFTF9HRVNUVVJFX0dBUF9NUyA9IDIwMDtcblxuLyoqIE1pZC1nZXN0dXJlIGRlY2lzaXZlLWZsaXAgcmUtbG9jayB0aHJlc2hvbGRzOiB0aGUgb3Bwb3NpdGUgYXhpcyBtdXN0IGJlYXQgdGhlIGxvY2tlZCBheGlzIGJ5IE1PUkUgdGhhbiB0aGUgcmF0aW8gQU5EIGNhcnJ5LiAqL1xuZXhwb3J0IGNvbnN0IFdIRUVMX0FYSVNfRkxJUF9SQVRJTyA9IDI7XG5leHBvcnQgY29uc3QgV0hFRUxfQVhJU19GTElQX01JTl9QWCA9IDI0O1xuXG4vKiogU3RyZWFtLWxldmVsIHdoZWVsIHJvdXRlcjogcm91dGVXaGVlbCdzIHBlci1ldmVudCB0YWJsZSBwbHVzIGEgR0VTVFVSRSBBWElTXG4gKiBMT0NLLiAqL1xuZXhwb3J0IGNsYXNzIFdoZWVsR2VzdHVyZVJvdXRlciB7XG4gIHByaXZhdGUgYXhpczogJ2gnIHwgJ3YnIHwgbnVsbCA9IG51bGw7XG4gIC8qKiBBICd2Jy1sb2NrZWQgZ2VzdHVyZSdzIGxhdGNoZWQgdGFyZ2V0OiB0cnVlID0gdGhlIGxhbmUgc3RhY2suICovXG4gIHByaXZhdGUgdkxhbmUgPSBmYWxzZTtcbiAgcHJpdmF0ZSBsYXN0VHMgPSAtSW5maW5pdHk7XG5cbiAgLyoqXG4gICAqIFJvdXRlIG9uZSBldmVudCBvZiB0aGUgc3RyZWFtLiBgdHNgIGlzIHRoZSBldmVudCdzIHRpbWVzdGFtcCBpbiBtc1xuICAgKiBvbiBhbnkgbW9ub3RvbmljIGNsb2NrIChlLnRpbWVTdGFtcCAvIHBlcmZvcm1hbmNlLm5vdygpKTsgV2hlZWxSb3V0ZVxuICAgKiBzZW1hbnRpY3MgXHUyMDE0IGBjb25zdW1lZGAgaXMgdGhlIHByZXZlbnREZWZhdWx0IGNvbnRyYWN0IFx1MjAxNCBhcmVcbiAgICogdW5jaGFuZ2VkIGZyb20gcm91dGVXaGVlbC5cbiAgICovXG4gIHJvdXRlKGU6IFdoZWVsSW5wdXQsIGxhbmVzOiBMYW5lU2Nyb2xsSW5wdXQsIHRzOiBudW1iZXIpOiBXaGVlbFJvdXRlIHtcbiAgICBpZiAoZS5jdHJsS2V5IHx8IGUubWV0YUtleSB8fCBlLnNoaWZ0S2V5KSByZXR1cm4gcm91dGVXaGVlbChlLCBsYW5lcyk7XG4gICAgY29uc3QgZHggPSB3aGVlbERlbHRhVG9QaXhlbHMoZS5kZWx0YVgsIGUuZGVsdGFNb2RlKTtcbiAgICBjb25zdCBkeSA9IHdoZWVsRGVsdGFUb1BpeGVscyhlLmRlbHRhWSwgZS5kZWx0YU1vZGUpO1xuICAgIGlmIChkeCA9PT0gMCAmJiBkeSA9PT0gMCkgcmV0dXJuIHsgem9vbVB4OiAwLCBwYW5QeDogMCwgbGFuZVNjcm9sbFB4OiAwLCBjb25zdW1lZDogZmFsc2UgfTtcbiAgICBpZiAodGhpcy5heGlzID09PSBudWxsIHx8IHRzIC0gdGhpcy5sYXN0VHMgPiBXSEVFTF9HRVNUVVJFX0dBUF9NUykge1xuICAgICAgLy8gRnJlc2ggZ2VzdHVyZTogdGhlIHBlci1ldmVudCBkb21pbmFudC1heGlzIHJ1bGUgbG9ja3MgdGhlIHN0cmVhbS5cbiAgICAgIHRoaXMuYXhpcyA9IE1hdGguYWJzKGR4KSA+IE1hdGguYWJzKGR5KSA/ICdoJyA6ICd2JztcbiAgICAgIGlmICh0aGlzLmF4aXMgPT09ICd2JykgdGhpcy52TGFuZSA9IGxhbmVDYW5UYWtlKGxhbmVzLCBkeSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmF4aXMgPT09ICdoJyAmJiBNYXRoLmFicyhkeSkgPiBXSEVFTF9BWElTX0ZMSVBfUkFUSU8gKiBNYXRoLmFicyhkeCkgJiYgTWF0aC5hYnMoZHkpID49IFdIRUVMX0FYSVNfRkxJUF9NSU5fUFgpIHtcbiAgICAgIHRoaXMuYXhpcyA9ICd2JztcbiAgICAgIHRoaXMudkxhbmUgPSBsYW5lQ2FuVGFrZShsYW5lcywgZHkpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5heGlzID09PSAndicgJiYgTWF0aC5hYnMoZHgpID4gV0hFRUxfQVhJU19GTElQX1JBVElPICogTWF0aC5hYnMoZHkpICYmIE1hdGguYWJzKGR4KSA+PSBXSEVFTF9BWElTX0ZMSVBfTUlOX1BYKSB7XG4gICAgICB0aGlzLmF4aXMgPSAnaCc7XG4gICAgfVxuICAgIHRoaXMubGFzdFRzID0gdHM7XG4gICAgaWYgKHRoaXMuYXhpcyA9PT0gJ3YnKSB7XG4gICAgICBpZiAodGhpcy52TGFuZSkgcmV0dXJuIHsgem9vbVB4OiAwLCBwYW5QeDogMCwgbGFuZVNjcm9sbFB4OiBkeSwgY29uc3VtZWQ6IHRydWUgfTtcbiAgICAgIHJldHVybiB7IHpvb21QeDogMCwgcGFuUHg6IDAsIGxhbmVTY3JvbGxQeDogMCwgY29uc3VtZWQ6IGZhbHNlIH07XG4gICAgfVxuICAgIHJldHVybiB7IHpvb21QeDogMCwgcGFuUHg6IGR4LCBsYW5lU2Nyb2xsUHg6IGxhbmVPdmVyZmxvd3MobGFuZXMpID8gZHkgOiAwLCBjb25zdW1lZDogdHJ1ZSB9O1xuICB9XG59XG5cbi8vIC0tIEZvbGxvdy1ub3cgcnVsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEZyYWN0aW9uIG9mIHRoZSBzcGFuIFwibm93XCIgc2l0cyBpbiBmcm9tIHRoZSByaWdodCBlZGdlIHdoaWxlIGZvbGxvd2luZy4gKi9cbmV4cG9ydCBjb25zdCBGT0xMT1dfTEVBRF9GUkFDID0gMC4wMjtcbi8qICovXG5leHBvcnQgY29uc3QgRk9MTE9XX1NOQVBfREVWSUNFX1BYID0gMjtcblxuLyoqIFdoZXRoZXIgZm9sbG93LW5vdyBpcyBlbmdhZ2VkIGFmdGVyIGEgdXNlci1kcml2ZW4gdmlld3BvcnQgY2hhbmdlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvbGxvd0FmdGVyR2VzdHVyZShcbiAgd2FzRm9sbG93aW5nOiBib29sZWFuLFxuICBwcmV2RW5kOiBudW1iZXIsXG4gIG5leHQ6IFRpbWVWaWV3LFxuICBub3c6IG51bWJlcixcbiAgaXNQYW46IGJvb2xlYW4sXG4gIG1zUGVyRGV2aWNlUHg6IG51bWJlcixcbik6IGJvb2xlYW4ge1xuICBpZiAoaXNQYW4gJiYgbmV4dC5lbmQgPCBwcmV2RW5kKSByZXR1cm4gZmFsc2U7XG4gIGlmICh3YXNGb2xsb3dpbmcpIHJldHVybiB0cnVlO1xuICByZXR1cm4gbmV4dC5lbmQgPj0gbm93IC0gRk9MTE9XX1NOQVBfREVWSUNFX1BYICogKE51bWJlci5pc0Zpbml0ZShtc1BlckRldmljZVB4KSAmJiBtc1BlckRldmljZVB4ID4gMCA/IG1zUGVyRGV2aWNlUHggOiAwKTtcbn1cblxuLy8gLS0gRm9sbG93LWxlYWQgZWFzaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogRHVyYXRpb24gb2YgdGhlIGZvbGxvdy1sZWFkIGVhc2UgKG1zKTogZW5nYWdpbmcgZm9sbG93IHJhbXBzIHRoZSBsZWFkIGluIGZyb20gd2hlcmUgdGhlIGdlc3R1cmUgcGFya2VkLiAqL1xuZXhwb3J0IGNvbnN0IEZPTExPV19MRUFEX1RXRUVOX01TID0gMjAwO1xuLyoqIER1cmF0aW9uIG9mIHRoZSBqdW1wLXRvLW5vdyBnbGlkZSAobXMpOiBmYXN0LCBkZWxpYmVyYXRlIFx1MjAxNCBidXQgY29udGludW91cy4gKi9cbmV4cG9ydCBjb25zdCBKVU1QX1RPX05PV19UV0VFTl9NUyA9IDI1MDtcblxuLyoqIFRoZSBlYXNlZCBmb2xsb3cgbGVhZCBgZWxhcHNlZE1zYCBpbnRvIGEgZ2xpZGUgZnJvbSBgZnJvbUZyYWNgIHRvd2FyZFxuICogYHRhcmdldEZyYWNgIG92ZXIgYHR3ZWVuTXNgLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvbGxvd0xlYWRBdChmcm9tRnJhYzogbnVtYmVyLCB0YXJnZXRGcmFjOiBudW1iZXIsIGVsYXBzZWRNczogbnVtYmVyLCB0d2Vlbk1zOiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoISh0d2Vlbk1zID4gMCkgfHwgIShlbGFwc2VkTXMgPCB0d2Vlbk1zKSkgcmV0dXJuIHRhcmdldEZyYWM7XG4gIGlmICghKGVsYXBzZWRNcyA+IDApKSByZXR1cm4gZnJvbUZyYWM7XG4gIGNvbnN0IHAgPSBlbGFwc2VkTXMgLyB0d2Vlbk1zO1xuICByZXR1cm4gZnJvbUZyYWMgKyAodGFyZ2V0RnJhYyAtIGZyb21GcmFjKSAqIHAgKiAoMiAtIHApO1xufVxuXG4vKiogVGhlIGxlYWQgZnJhY3Rpb24gYSB1c2VyIGdlc3R1cmUgbGVnaXRpbWF0ZWx5IGhvbGRzOiBpdHMgb3duIGVuZCByZWxhdGl2ZVxuICogdG8gYG5vd2AuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VzdHVyZUxlYWRGcmFjKGVuZE1zOiBudW1iZXIsIG5vdzogbnVtYmVyLCBzcGFuOiBudW1iZXIsIG1heEZyYWM6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghKHNwYW4gPiAwKSkgcmV0dXJuIE1hdGgubWluKDAsIG1heEZyYWMpO1xuICByZXR1cm4gTWF0aC5taW4oKGVuZE1zIC0gbm93KSAvIHNwYW4sIG1heEZyYWMpO1xufVxuXG4vLyAtLSBGZWVkIHN0YWxlbmVzcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIERlZmF1bHQgbXMgd2l0aG91dCBmcmVzaCBkYXRhIGJlZm9yZSBhIGxpdmUgY2hhcnQgZGVjbGFyZXMgaXRzIGZlZWQgU1RBTEUgKHRoZSBlbGVtZW50J3MgYHN0YWxlQWZ0ZXJNc2ApLiAqL1xuZXhwb3J0IGNvbnN0IFNUQUxFX0FGVEVSX0RFRkFVTFRfTVMgPSAxMF8wMDA7XG5cbi8qKiBXaGV0aGVyIHRoZSBsaXZlIGZlZWQgaXMgc3RhbGU6IGZyZXNoIGRhdGEgbGFzdCBhcnJpdmVkIGF0IGBsYXN0RnJlc2hgXG4gKiAobnVsbCA9IG5vIGRhdGEgaGFzIEVWRVIgYXJyaXZlZCBcdTIwMTQgYW4gZW1wdHkgY2hhcnQgaXMgbmV2ZXIgc3RhbGUpIGFuZFxuICogbW9yZSB0aGFuIGBzdGFsZUFmdGVyTXNgIGhhcyBzaW5jZSBwYXNzZWQuICovXG5leHBvcnQgZnVuY3Rpb24gZmVlZElzU3RhbGUobm93OiBudW1iZXIsIGxhc3RGcmVzaDogbnVtYmVyIHwgbnVsbCwgc3RhbGVBZnRlck1zOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKGxhc3RGcmVzaCA9PT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKHN0YWxlQWZ0ZXJNcykgfHwgc3RhbGVBZnRlck1zIDw9IDApIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIG5vdyAtIGxhc3RGcmVzaCA+IHN0YWxlQWZ0ZXJNcztcbn1cblxuLyoqIFRoZSBMSVZFIEVER0UgZXZlcnkgbGl2ZSBzZW1hbnRpYyBhZHZhbmNlcyB0byBcdTIwMTQgb25nb2luZyAoZW5kID0gbnVsbCkgYmFyXG4gKiBlbmRzLCB0aGUgbm93IGxpbmUsIHRoZSBmb2xsb3ctbW9kZSBwaW4sIGFuZCB0aGUgdXNlci12aWV3IGZvcndhcmQgY2xhbXAuICovXG5leHBvcnQgZnVuY3Rpb24gbGl2ZUVkZ2VUYXJnZXQobm93OiBudW1iZXIsIGxhc3RGcmVzaDogbnVtYmVyIHwgbnVsbCwgc3RhbGVBZnRlck1zOiBudW1iZXIpOiBudW1iZXIge1xuICByZXR1cm4gZmVlZElzU3RhbGUobm93LCBsYXN0RnJlc2gsIHN0YWxlQWZ0ZXJNcykgPyAobGFzdEZyZXNoIGFzIG51bWJlcikgOiBub3c7XG59XG5cbi8vIC0tIFdob2xlLXBpeGVsIHNjcm9sbGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFNuYXAgYSB2aWV3J3MgT1JJR0lOIHRvIHRoZSBkZXZpY2UtcGl4ZWwgZ3JpZCwgc3BhbiBwcmVzZXJ2ZWQ6IHdpdGggdGhlXG4gKiBzbmFwcGVkIHZpZXcsIGFueSBmaXhlZCB0aW1lJ3MgeCBrZWVwcyBhIGNvbnN0YW50IHN1YnBpeGVsIHBoYXNlLCBzbyBhXG4gKiBtb3Zpbmcgdmlld3BvcnQgdHJhbnNsYXRlcyB0aGUgd2hvbGUgc2NlbmUgaW4gV0hPTEUgZGV2aWNlLXBpeGVsIHN0ZXBzIGFuZFxuICogYmFycyBrZWVwIGV4YWN0IHJlbGF0aXZlIG9mZnNldHMuIFRoaXMgaXMgdGhlIHBsYWNlIHJvdW5kaW5nIG1heSB0b3VjaFxuICogdGltZVx1MjE5MnguICovXG5leHBvcnQgZnVuY3Rpb24gc25hcFZpZXdUb0RldmljZVBpeGVscyh2aWV3OiBUaW1lVmlldywgcGxvdFdpZHRoQ3NzOiBudW1iZXIsIGRwcjogbnVtYmVyKTogVGltZVZpZXcge1xuICBjb25zdCBzcGFuID0gdmlldy5lbmQgLSB2aWV3LnN0YXJ0O1xuICBjb25zdCBtc1BlckRldlB4ID0gc3BhbiAvIChwbG90V2lkdGhDc3MgKiBkcHIpO1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShtc1BlckRldlB4KSB8fCBtc1BlckRldlB4IDw9IDApIHJldHVybiB2aWV3O1xuICBjb25zdCBzdGFydCA9IE1hdGgucm91bmQodmlldy5zdGFydCAvIG1zUGVyRGV2UHgpICogbXNQZXJEZXZQeDtcbiAgcmV0dXJuIHsgc3RhcnQsIGVuZDogc3RhcnQgKyBzcGFuIH07XG59XG5cbi8qKiBTbmFwIGEgQ1NTLXB4IGNvb3JkaW5hdGUgdG8gdGhlIG5lYXJlc3QgV0hPTEUgZGV2aWNlIHBpeGVsIFx1MjAxNCBmb3IgVEVYVFxuICogZHJhdyBvcmlnaW5zIG9ubHkuICovXG5leHBvcnQgZnVuY3Rpb24gc25hcFRleHRPcmlnaW4odjogbnVtYmVyLCBkcHI6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHYpIHx8ICEoZHByID4gMCkpIHJldHVybiB2O1xuICByZXR1cm4gTWF0aC5yb3VuZCh2ICogZHByKSAvIGRwcjtcbn1cblxuLyoqIFRoZSBub3cgbGluZSdzIHggKENTUyBweCwgYGd1dHRlclhgIG9mZnNldCBpbmNsdWRlZCksIHNuYXBwZWQgdG8gdGhlXG4gKiBkZXZpY2UtcGl4ZWwgZ3JpZCArIGhhbGYgYSBkZXZpY2UgcHggKGEgY3Jpc3AgMXB4IHN0cm9rZSkuICovXG5leHBvcnQgZnVuY3Rpb24gbm93TGluZVgobm93OiBudW1iZXIsIHZpZXc6IFRpbWVWaWV3LCBndXR0ZXJYOiBudW1iZXIsIHBsb3RXaWR0aENzczogbnVtYmVyLCBkcHI6IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IHggPSBndXR0ZXJYICsgdGltZVRvWChub3csIHZpZXcsIHBsb3RXaWR0aENzcyk7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHgpIHx8ICEoZHByID4gMCkpIHJldHVybiB4O1xuICByZXR1cm4gKE1hdGgucm91bmQoeCAqIGRwcikgKyAwLjUpIC8gZHByO1xufVxuXG4vLyAtLSBUaW1lIHRpY2tzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qICovXG5leHBvcnQgY29uc3QgVElNRV9USUNLX1NURVBTOiByZWFkb25seSBudW1iZXJbXSA9IFtcbiAgMSwgMiwgNSwgMTAsIDIwLCA1MCwgMTAwLCAyMDAsIDUwMCxcbiAgMV8wMDAsIDJfMDAwLCA1XzAwMCwgMTBfMDAwLCAxNV8wMDAsIDMwXzAwMCxcbiAgNjBfMDAwLCAxMjBfMDAwLCAzMDBfMDAwLCA2MDBfMDAwLCA5MDBfMDAwLCAxXzgwMF8wMDAsXG4gIDNfNjAwXzAwMCwgN18yMDBfMDAwLCAxMF84MDBfMDAwLCAyMV82MDBfMDAwLCA0M18yMDBfMDAwLFxuICA4Nl80MDBfMDAwLCAxNzJfODAwXzAwMCwgNjA0XzgwMF8wMDAsXG5dO1xuXG4vKipcbiAqIFRoZSBzbWFsbGVzdCBsYWRkZXIgc3RlcCBzcGxpdHRpbmcgYHNwYW5gIG1zIGludG8gYXQgbW9zdCBgbWF4VGlja3NgXG4gKiBpbnRlcnZhbHMgKHRoZSBsYXJnZXN0IHN0ZXAgaXMgcmV0dXJuZWQgd2hlbiBldmVuIGl0IGlzIHRvbyBmaW5lKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRpbWVUaWNrU3RlcChzcGFuOiBudW1iZXIsIG1heFRpY2tzOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCBtYXggPSBNYXRoLm1heCgxLCBtYXhUaWNrcyk7XG4gIGZvciAoY29uc3Qgc3RlcCBvZiBUSU1FX1RJQ0tfU1RFUFMpIHtcbiAgICBpZiAoc3BhbiAvIHN0ZXAgPD0gbWF4KSByZXR1cm4gc3RlcDtcbiAgfVxuICByZXR1cm4gVElNRV9USUNLX1NURVBTW1RJTUVfVElDS19TVEVQUy5sZW5ndGggLSAxXTtcbn1cblxuLyoqXG4gKiBUaWNrIHRpbWVzIHdpdGhpbiB0aGUgdmlldyBvbiB0aGUgbGFkZGVyIHN0ZXAgZm9yIGBtYXhUaWNrc2AsIGFsaWduZWQgc29cbiAqIHRpY2tzIGxhbmQgb24gcm91bmQgTE9DQUwgdGltZXMgKHBhc3MgdGhlIHpvbmUncyBVVEMgb2Zmc2V0IGluIG1zIFx1MjAxNFxuICogYC1uZXcgRGF0ZSgpLmdldFRpbWV6b25lT2Zmc2V0KCkgKiA2MDAwMGAgXHUyMDE0IHNvIGhvdXIvZGF5IHN0ZXBzIGFsaWduIHRvXG4gKiBsb2NhbCBtaWRuaWdodDsgZml4ZWQtb2Zmc2V0IGFsaWdubWVudCwgRFNUIHNoaWZ0cyBhcmUgbm90IGNoYXNlZCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0aW1lVGlja3ModmlldzogVGltZVZpZXcsIG1heFRpY2tzOiBudW1iZXIsIHR6T2Zmc2V0TXMgPSAwKTogbnVtYmVyW10ge1xuICBjb25zdCBzcGFuID0gdmlldy5lbmQgLSB2aWV3LnN0YXJ0O1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShzcGFuKSB8fCBzcGFuIDw9IDApIHJldHVybiBbXTtcbiAgY29uc3Qgc3RlcCA9IHRpbWVUaWNrU3RlcChzcGFuLCBtYXhUaWNrcyk7XG4gIGNvbnN0IGZpcnN0ID0gTWF0aC5jZWlsKCh2aWV3LnN0YXJ0ICsgdHpPZmZzZXRNcykgLyBzdGVwKSAqIHN0ZXAgLSB0ek9mZnNldE1zO1xuICBjb25zdCB0aWNrczogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgdCA9IGZpcnN0OyB0IDw9IHZpZXcuZW5kOyB0ICs9IHN0ZXApIHRpY2tzLnB1c2godCk7XG4gIHJldHVybiB0aWNrcztcbn1cblxuLyoqIENpdmlsIGRhdGUgcGFydHMgZm9yIGEgVVRDLXNoaWZ0ZWQgdGltZXN0YW1wIChwdXJlLCBEYXRlLWZyZWUpLiAqL1xuaW50ZXJmYWNlIENpdmlsIHtcbiAgeTogbnVtYmVyO1xuICBtbzogbnVtYmVyO1xuICBkOiBudW1iZXI7XG4gIGg6IG51bWJlcjtcbiAgbWk6IG51bWJlcjtcbiAgczogbnVtYmVyO1xuICBtczogbnVtYmVyO1xuICBkYXlNczogbnVtYmVyOyAvLyBtcyBzaW5jZSBsb2NhbCBtaWRuaWdodFxufVxuXG5jb25zdCBNT05USFMgPSBbJ0phbicsICdGZWInLCAnTWFyJywgJ0FwcicsICdNYXknLCAnSnVuJywgJ0p1bCcsICdBdWcnLCAnU2VwJywgJ09jdCcsICdOb3YnLCAnRGVjJ107XG5cbmZ1bmN0aW9uIGNpdmlsKHQ6IG51bWJlciwgdHpPZmZzZXRNczogbnVtYmVyKTogQ2l2aWwge1xuICBjb25zdCBsb2NhbCA9IHQgKyB0ek9mZnNldE1zO1xuICBjb25zdCBkYXlNcyA9ICgobG9jYWwgJSA4Nl80MDBfMDAwKSArIDg2XzQwMF8wMDApICUgODZfNDAwXzAwMDtcbiAgY29uc3QgZGF5cyA9IE1hdGguZmxvb3IobG9jYWwgLyA4Nl80MDBfMDAwKTtcbiAgLy8gSG93YXJkIEhpbm5hbnQncyBjaXZpbF9mcm9tX2RheXMuXG4gIGNvbnN0IHogPSBkYXlzICsgNzE5XzQ2ODtcbiAgY29uc3QgZXJhID0gTWF0aC5mbG9vcih6IC8gMTQ2XzA5Nyk7XG4gIGNvbnN0IGRvZSA9IHogLSBlcmEgKiAxNDZfMDk3O1xuICBjb25zdCB5b2UgPSBNYXRoLmZsb29yKChkb2UgLSBNYXRoLmZsb29yKGRvZSAvIDFfNDYwKSArIE1hdGguZmxvb3IoZG9lIC8gMzZfNTI0KSAtIE1hdGguZmxvb3IoZG9lIC8gMTQ2XzA5NikpIC8gMzY1KTtcbiAgY29uc3QgeSA9IHlvZSArIGVyYSAqIDQwMDtcbiAgY29uc3QgZG95ID0gZG9lIC0gKDM2NSAqIHlvZSArIE1hdGguZmxvb3IoeW9lIC8gNCkgLSBNYXRoLmZsb29yKHlvZSAvIDEwMCkpO1xuICBjb25zdCBtcCA9IE1hdGguZmxvb3IoKDUgKiBkb3kgKyAyKSAvIDE1Myk7XG4gIGNvbnN0IGQgPSBkb3kgLSBNYXRoLmZsb29yKCgxNTMgKiBtcCArIDIpIC8gNSkgKyAxO1xuICBjb25zdCBtbyA9IG1wIDwgMTAgPyBtcCArIDMgOiBtcCAtIDk7XG4gIHJldHVybiB7XG4gICAgeTogbW8gPD0gMiA/IHkgKyAxIDogeSxcbiAgICBtbyxcbiAgICBkLFxuICAgIGg6IE1hdGguZmxvb3IoZGF5TXMgLyAzXzYwMF8wMDApLFxuICAgIG1pOiBNYXRoLmZsb29yKGRheU1zIC8gNjBfMDAwKSAlIDYwLFxuICAgIHM6IE1hdGguZmxvb3IoZGF5TXMgLyAxXzAwMCkgJSA2MCxcbiAgICBtczogZGF5TXMgJSAxXzAwMCxcbiAgICBkYXlNcyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcGFkMihuOiBudW1iZXIpOiBzdHJpbmcge1xuICByZXR1cm4gbiA8IDEwID8gYDAke259YCA6IFN0cmluZyhuKTtcbn1cblxuLyoqIFRpY2sgbGFiZWwgd2l0aCBncmFudWxhcml0eSBtYXRjaGVkIHRvIHRoZSBzdGVwOiBzdWItc2Vjb25kIHN0ZXBzIHNob3dcbiAqIGA6U1MubW1tYCwgc2Vjb25kIHN0ZXBzIGBISDpNTTpTU2AsIG1pbnV0ZS9ob3VyIHN0ZXBzIGBISDpNTWAsIGFuZCBkYXkrXG4gKiBzdGVwcyBgTW9uIERgLiBUaW1lcyBhcmUgcmVuZGVyZWQgaW4gdGhlIHpvbmUgZ2l2ZW4gYnkgYHR6T2Zmc2V0TXNgXG4gKiAoc2VlIHRpbWVUaWNrcykuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0VGltZVRpY2sodDogbnVtYmVyLCBzdGVwOiBudW1iZXIsIHR6T2Zmc2V0TXMgPSAwKTogc3RyaW5nIHtcbiAgY29uc3QgYyA9IGNpdmlsKHQsIHR6T2Zmc2V0TXMpO1xuICBpZiAoc3RlcCA8IDg2XzQwMF8wMDAgJiYgYy5kYXlNcyA9PT0gMCkgcmV0dXJuIGAke01PTlRIU1tjLm1vIC0gMV19ICR7Yy5kfWA7XG4gIGlmIChzdGVwIDwgMV8wMDApIHJldHVybiBgOiR7cGFkMihjLnMpfS4ke1N0cmluZyhjLm1zKS5wYWRTdGFydCgzLCAnMCcpfWA7XG4gIGlmIChzdGVwIDwgNjBfMDAwKSByZXR1cm4gYCR7cGFkMihjLmgpfToke3BhZDIoYy5taSl9OiR7cGFkMihjLnMpfWA7XG4gIGlmIChzdGVwIDwgODZfNDAwXzAwMCkgcmV0dXJuIGAke3BhZDIoYy5oKX06JHtwYWQyKGMubWkpfWA7XG4gIHJldHVybiBgJHtNT05USFNbYy5tbyAtIDFdfSAke2MuZH1gO1xufVxuXG4vKiogRnVsbCB0aW1lc3RhbXAgZm9yIHRvb2x0aXBzL3JlYWRvdXRzOiBgTW9uIEQgSEg6TU06U1NgICgrIGAubW1tYCB3aGVuIHdpdGhNcykuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0VGltZUZ1bGwodDogbnVtYmVyLCB0ek9mZnNldE1zID0gMCwgd2l0aE1zID0gZmFsc2UpOiBzdHJpbmcge1xuICBjb25zdCBjID0gY2l2aWwodCwgdHpPZmZzZXRNcyk7XG4gIGNvbnN0IGJhc2UgPSBgJHtNT05USFNbYy5tbyAtIDFdfSAke2MuZH0gJHtwYWQyKGMuaCl9OiR7cGFkMihjLm1pKX06JHtwYWQyKGMucyl9YDtcbiAgcmV0dXJuIHdpdGhNcyA/IGAke2Jhc2V9LiR7U3RyaW5nKGMubXMpLnBhZFN0YXJ0KDMsICcwJyl9YCA6IGJhc2U7XG59XG5cbi8qKlxuICogQ29tcGFjdCBodW1hbiBkdXJhdGlvbjogJ1x1MjAxNCcgZm9yIG5vbi1maW5pdGUvbmVnYXRpdmUsIHRoZW4gMG1zIFx1MjE5MiAnMG1zJyxcbiAqIHN1Yi1zZWNvbmQgXHUyMTkyICdObXMnLCBzdWItbWludXRlIFx1MjE5MiAnTi5OcycsIHN1Yi1ob3VyIFx1MjE5MiAnTm0gTk5zJyxcbiAqIHN1Yi1kYXkgXHUyMTkyICdOaCBOTm0nLCBlbHNlICdOZCBOaCcuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXREdXJhdGlvbihtczogbnVtYmVyKTogc3RyaW5nIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUobXMpIHx8IG1zIDwgMCkgcmV0dXJuICdcdTIwMTQnO1xuICBpZiAobXMgPCAxXzAwMCkgcmV0dXJuIGAke01hdGgucm91bmQobXMpfW1zYDtcbiAgaWYgKG1zIDwgNjBfMDAwKSByZXR1cm4gYCR7KG1zIC8gMV8wMDApLnRvRml4ZWQoMSl9c2A7XG4gIGlmIChtcyA8IDNfNjAwXzAwMCkgcmV0dXJuIGAke01hdGguZmxvb3IobXMgLyA2MF8wMDApfW0gJHtwYWQyKE1hdGgucm91bmQobXMgLyAxXzAwMCkgJSA2MCl9c2A7XG4gIGlmIChtcyA8IDg2XzQwMF8wMDApIHJldHVybiBgJHtNYXRoLmZsb29yKG1zIC8gM182MDBfMDAwKX1oICR7cGFkMihNYXRoLmZsb29yKG1zIC8gNjBfMDAwKSAlIDYwKX1tYDtcbiAgcmV0dXJuIGAke01hdGguZmxvb3IobXMgLyA4Nl80MDBfMDAwKX1kICR7TWF0aC5mbG9vcihtcyAvIDNfNjAwXzAwMCkgJSAyNH1oYDtcbn1cblxuLy8gLS0gU3ViLXRyYWNrIHBhY2tpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEVmZmVjdGl2ZSBtaW5pbXVtIGludGVydmFsIGZvb3RwcmludCB1c2VkIGJ5IHBhY2tpbmcsIHNvIGNvaW5jaWRlbnQgemVyby1sZW5ndGggaW50ZXJ2YWxzIHN0YWNrLiAqL1xuZXhwb3J0IGNvbnN0IFBBQ0tfTUlOX01TID0gMTtcblxuLyoqIFRoZSBzbGljZSBvZiBhbiBpbnRlcnZhbCB0aGF0IHBhY2tpbmcgbmVlZHMuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhY2tJdGVtIHtcbiAgaWQ6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbiAgLyoqIG51bGwvdW5kZWZpbmVkID0gb25nb2luZyAoYmxvY2tzIGl0cyB0cmFjayBmb3JldmVyKS4gKi9cbiAgZW5kPzogbnVtYmVyIHwgbnVsbDtcbiAgcm93cz86IG51bWJlcjtcbn1cblxuLyoqIEdyZWVkeSBmaXJzdC1maXQgaW50ZXJ2YWwgcGFja2luZyBmb3Igb25lIGxhbmU6IHJldHVybnMgYHRyYWNrc1tpXWAgPSB0aGVcbiAqIHN1Yi10cmFjayAocm93IHdpdGhpbiB0aGUgbGFuZSkgZm9yIGl0ZW1zW2ldLCBwbHVzIHRoZSB0cmFjayBjb3VudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYWNrVHJhY2tzKGl0ZW1zOiByZWFkb25seSBQYWNrSXRlbVtdKTogeyB0cmFja3M6IG51bWJlcltdOyB0cmFja0NvdW50OiBudW1iZXIgfSB7XG4gIGNvbnN0IG9yZGVyID0gaXRlbXMubWFwKChfLCBpKSA9PiBpKTtcbiAgb3JkZXIuc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IGlhID0gaXRlbXNbYV07XG4gICAgY29uc3QgaWIgPSBpdGVtc1tiXTtcbiAgICByZXR1cm4gaWEuc3RhcnQgLSBpYi5zdGFydCB8fCAoaWEuaWQgPCBpYi5pZCA/IC0xIDogaWEuaWQgPiBpYi5pZCA/IDEgOiAwKTtcbiAgfSk7XG4gIGNvbnN0IHRyYWNrcyA9IG5ldyBBcnJheTxudW1iZXI+KGl0ZW1zLmxlbmd0aCkuZmlsbCgwKTtcbiAgY29uc3QgdHJhY2tFbmRzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGkgb2Ygb3JkZXIpIHtcbiAgICBjb25zdCBpdCA9IGl0ZW1zW2ldO1xuICAgIGNvbnN0IHJvd3MgPSBwYWNrUm93cyhpdCk7XG4gICAgY29uc3QgdCA9IGxvd2VzdEZpdCh0cmFja0VuZHMsIGl0LnN0YXJ0LCByb3dzKTtcbiAgICBjb25zdCBlbmQgPSBwYWNrRW5kKGl0KTtcbiAgICBmb3IgKGxldCBrID0gMDsgayA8IHJvd3M7IGsrKykgdHJhY2tFbmRzW3QgKyBrXSA9IGVuZDtcbiAgICB0cmFja3NbaV0gPSB0O1xuICB9XG4gIHJldHVybiB7IHRyYWNrcywgdHJhY2tDb3VudDogTWF0aC5tYXgoMSwgdHJhY2tFbmRzLmxlbmd0aCkgfTtcbn1cblxuLyoqIEVmZmVjdGl2ZSBwYWNraW5nIGZvb3RwcmludCBlbmQ6IG9uZ29pbmcgYmxvY2tzIGZvcmV2ZXIsIGluc3RhbnRzIG9jY3VweSBQQUNLX01JTl9NUy4gKi9cbmZ1bmN0aW9uIHBhY2tFbmQoaXQ6IFBhY2tJdGVtKTogbnVtYmVyIHtcbiAgcmV0dXJuIE1hdGgubWF4KGl0LmVuZCA9PSBudWxsID8gSW5maW5pdHkgOiBpdC5lbmQsIGl0LnN0YXJ0ICsgUEFDS19NSU5fTVMpO1xufVxuXG5mdW5jdGlvbiBwYWNrUm93cyhpdDogUGFja0l0ZW0pOiBudW1iZXIge1xuICBjb25zdCByID0gaXQucm93cztcbiAgcmV0dXJuIHIgIT09IHVuZGVmaW5lZCAmJiByID4gMSA/IE1hdGguZmxvb3IocikgOiAxO1xufVxuXG4vKipcbiAqIFRoZSBsb3dlc3QgdHJhY2sgdCBzdWNoIHRoYXQgdHJhY2tzIHQgLi4gdCtyb3dzLTEgYXJlIGFsbCBmcmVlIGF0XG4gKiBgc3RhcnRgIChhIHRyYWNrIHBhc3QgdGhlIGVuZCBvZiBgdHJhY2tFbmRzYCBpcyBmcmVlKS4gQSBidXN5IHRyYWNrXG4gKiBpbnNpZGUgYSBjYW5kaWRhdGUgcnVuIG1vdmVzIHRoZSBjYW5kaWRhdGUgcGFzdCB0aGF0IHRyYWNrLlxuICovXG5mdW5jdGlvbiBsb3dlc3RGaXQodHJhY2tFbmRzOiByZWFkb25seSBudW1iZXJbXSwgc3RhcnQ6IG51bWJlciwgcm93czogbnVtYmVyKTogbnVtYmVyIHtcbiAgbGV0IHQgPSAwO1xuICBmb3IgKDs7KSB7XG4gICAgbGV0IGsgPSAwO1xuICAgIHdoaWxlIChrIDwgcm93cyAmJiAhKHQgKyBrIDwgdHJhY2tFbmRzLmxlbmd0aCAmJiB0cmFja0VuZHNbdCArIGtdID4gc3RhcnQpKSBrKys7XG4gICAgaWYgKGsgPT09IHJvd3MpIHJldHVybiB0O1xuICAgIHQgKz0gayArIDE7XG4gIH1cbn1cblxuLyoqIHBhY2tUcmFja3Mgb3ZlciBvbmx5IHRoZSBpdGVtcyB0aGF0IGludGVyc2VjdCBgdmlld2AgKGEgcGFydGlhbGx5IHZpc2libGVcbiAqIGludGVydmFsIGNvdW50czsgYW4gb25nb2luZyBvbmUgXHUyMDE0IGVuZCBudWxsIFx1MjAxNCBpbnRlcnNlY3RzIGV2ZXJ5IHdpbmRvd1xuICogYXQvYWZ0ZXIgaXRzIHN0YXJ0KS4gU2FtZSBkZXRlcm1pbmlzdGljIChzdGFydCwgaWQpIG9yZGVyaW5nIGFuZCBmaXJzdC1maXRcbiAqIHJldXNlIGFzIHBhY2tUcmFja3MsIGV2YWx1YXRlZCBvdmVyIHRoZSB2aXNpYmxlIHN1YnNldCBvbmx5IFx1MjAxNCBzbyBvbmVcbiAqIGhpc3RvcmljYWwgcGFyYWxsZWxpc20gYnVyc3Qgc3RvcHMgcGFkZGluZyBpdHMgbGFuZSB0aGUgbW9tZW50IGl0IHNjcm9sbHNcbiAqIG91dCBvZiB2aWV3LiBBc3NpZ25tZW50IGlzIGEgcHVyZSBmdW5jdGlvbiBvZiB0aGUgdmlzaWJsZSBTRVQ6IHdoaWxlIHRoZVxuICogd2luZG93IHNsaWRlcyBvdmVyIHVuY2hhbmdlZCBvdmVybGFwLCBub3RoaW5nIGhvcHMgdHJhY2tzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhY2tWaXNpYmxlVHJhY2tzKGl0ZW1zOiByZWFkb25seSBQYWNrSXRlbVtdLCB2aWV3OiBUaW1lVmlldyk6IHsgdHJhY2tzOiBudW1iZXJbXTsgdHJhY2tDb3VudDogbnVtYmVyIH0ge1xuICBjb25zdCBvcmRlcjogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGl0ID0gaXRlbXNbaV07XG4gICAgaWYgKGl0LnN0YXJ0IDw9IHZpZXcuZW5kICYmIHBhY2tFbmQoaXQpID49IHZpZXcuc3RhcnQpIG9yZGVyLnB1c2goaSk7XG4gIH1cbiAgb3JkZXIuc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IGlhID0gaXRlbXNbYV07XG4gICAgY29uc3QgaWIgPSBpdGVtc1tiXTtcbiAgICByZXR1cm4gaWEuc3RhcnQgLSBpYi5zdGFydCB8fCAoaWEuaWQgPCBpYi5pZCA/IC0xIDogaWEuaWQgPiBpYi5pZCA/IDEgOiAwKTtcbiAgfSk7XG4gIGNvbnN0IHRyYWNrcyA9IG5ldyBBcnJheTxudW1iZXI+KGl0ZW1zLmxlbmd0aCkuZmlsbCgtMSk7XG4gIGNvbnN0IHRyYWNrRW5kczogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChjb25zdCBpIG9mIG9yZGVyKSB7XG4gICAgY29uc3QgaXQgPSBpdGVtc1tpXTtcbiAgICBjb25zdCByb3dzID0gcGFja1Jvd3MoaXQpO1xuICAgIGNvbnN0IHQgPSBsb3dlc3RGaXQodHJhY2tFbmRzLCBpdC5zdGFydCwgcm93cyk7XG4gICAgY29uc3QgZW5kID0gcGFja0VuZChpdCk7XG4gICAgZm9yIChsZXQgayA9IDA7IGsgPCByb3dzOyBrKyspIHRyYWNrRW5kc1t0ICsga10gPSBlbmQ7XG4gICAgdHJhY2tzW2ldID0gdDtcbiAgfVxuICByZXR1cm4geyB0cmFja3MsIHRyYWNrQ291bnQ6IE1hdGgubWF4KDEsIHRyYWNrRW5kcy5sZW5ndGgpIH07XG59XG5cbi8qKiBCb3VuZCBvbiByZW1lbWJlcmVkIGlkIFx1MjE5MiB0cmFjayBhc3NpZ25tZW50cyBwZXIgVHJhY2tBbGxvY2F0b3IgKExSVSBldmljdGlvbiBiZXlvbmQgaXQpLiAqL1xuZXhwb3J0IGNvbnN0IFRSQUNLX01FTU9SWV9DQVAgPSAyMDQ4O1xuXG4vKiogU1RJQ0tZIHN1Yi10cmFjayBhbGxvY2F0aW9uIGZvciBvbmUgbGFuZSBcdTIwMTQgdGhlIFNUQVRFRlVMIGNvdW50ZXJwYXJ0IG9mXG4gKiBwYWNrVmlzaWJsZVRyYWNrcywgYnVpbHQgc28gcm93cyBzdG9wIHNoaWZ0aW5nIHVuZGVyIHRoZSB2aWV3ZXIgYXMgdGhlXG4gKiB2aXNpYmxlIG1lbWJlcnNoaXAgY2h1cm5zIChwYW5uaW5nLCBsaXZlIHVwZGF0ZXMpOlxuICpcbiAqIC0gQW4gaXRlbSBhc3NpZ25lZCBpbiB0aGUgY2FsbCBhbmQgc3RpbGwgdmlzaWJsZSBLRUVQUyBpdHNcbiAqICAgdHJhY2sgdW5jb25kaXRpb25hbGx5IChyZS12ZXJpZmllZCBhZ2FpbnN0IHRoZSBvdGhlciBrZWVwZXJzLCBzb1xuICogICBldmVuIGFuIGl0ZW0gd2hvc2UgdGltZXMgd2VyZSBsaXZlLWVkaXRlZCBjYW4gbmV2ZXIgY3JlYXRlIGFcbiAqICAgc2FtZS10cmFjayBvdmVybGFwKS5cbiAqIC0gQW4gaXRlbSBSRVRVUk5JTkcgYWZ0ZXIgc2Nyb2xsaW5nIG91dCBnZXRzIGl0cyByZW1lbWJlcmVkIHRyYWNrIGJhY2tcbiAqICAgd2hlbiBubyB2aXNpYmxlIG9jY3VwYW50IGNvbmZsaWN0cyBcdTIwMTQgYmVzdC1lZmZvcnQgcm93IG1lbW9yeSwgYm91bmRlZFxuICogICBieSBhbiBMUlUgY2FwIChgbWVtb3J5Q2FwYCwgZGVmYXVsdCBUUkFDS19NRU1PUllfQ0FQKS4gKi9cbmV4cG9ydCBjbGFzcyBUcmFja0FsbG9jYXRvciB7XG4gIC8qKiBpZCBcdTIxOTIgbGFzdCBhc3NpZ25lZCB0cmFjay4gTWFwIGluc2VydGlvbiBvcmRlciBkb3VibGVzIGFzIExSVSByZWNlbmN5LiAqL1xuICBwcml2YXRlIG1lbW9yeSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gIC8qKiBpZHMgYXNzaWduZWQgKHZpc2libGUpIGJ5IHRoZSBwcmV2aW91cyBjYWxsIFx1MjAxNCB0aGVpciB0cmFja3MgYXJlIGtlcHQuICovXG4gIHByaXZhdGUgbGl2ZSA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAvKiogRG91YmxlLWJ1ZmZlciBwYXJ0bmVyIGZvciBgbGl2ZWAgKHN3YXBwZWQgcGVyIGNhbGwgXHUyMDE0IG5vIFNldCBjaHVybikuICovXG4gIHByaXZhdGUgbGl2ZU5leHQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSBjYXA6IG51bWJlcjtcbiAgLy8gUGVyLWNhbGwgc2NyYXRjaCwgcmV1c2VkIGFjcm9zcyBjYWxscyAoYXNzaWduIHJ1bnMgb24gdGhlIGVsZW1lbnQncyBsYXlvdXQgcGF0aCkuXG4gIHByaXZhdGUgdmlzU2NyYXRjaDogbnVtYmVyW10gPSBbXTtcbiAgcHJpdmF0ZSByZXR1cm5pbmdTY3JhdGNoOiBudW1iZXJbXSA9IFtdO1xuICBwcml2YXRlIGZyZXNoU2NyYXRjaDogbnVtYmVyW10gPSBbXTtcbiAgcHJpdmF0ZSBwbGFjZWRTY3JhdGNoOiBudW1iZXJbXVtdID0gW107XG5cbiAgY29uc3RydWN0b3IobWVtb3J5Q2FwID0gVFJBQ0tfTUVNT1JZX0NBUCkge1xuICAgIHRoaXMuY2FwID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihtZW1vcnlDYXApKTtcbiAgfVxuXG4gIC8qKiBBc3NpZ24gdHJhY2tzIGZvciB0aGUgaXRlbXMgdmlzaWJsZSBpbiBgdmlld2AgKHNlZSB0aGUgY2xhc3MgZG9jKS4gKi9cbiAgYXNzaWduKGl0ZW1zOiByZWFkb25seSBQYWNrSXRlbVtdLCB2aWV3OiBUaW1lVmlldyk6IHsgdHJhY2tzOiBudW1iZXJbXTsgdHJhY2tDb3VudDogbnVtYmVyIH0ge1xuICAgIGNvbnN0IHRyYWNrcyA9IG5ldyBBcnJheTxudW1iZXI+KGl0ZW1zLmxlbmd0aCkuZmlsbCgtMSk7XG4gICAgY29uc3QgdmlzID0gdGhpcy52aXNTY3JhdGNoO1xuICAgIHZpcy5sZW5ndGggPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaXRlbXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGl0ID0gaXRlbXNbaV07XG4gICAgICBpZiAoaXQuc3RhcnQgPD0gdmlldy5lbmQgJiYgcGFja0VuZChpdCkgPj0gdmlldy5zdGFydCkgdmlzLnB1c2goaSk7XG4gICAgfVxuICAgIHZpcy5zb3J0KChhLCBiKSA9PiB7XG4gICAgICBjb25zdCBpYSA9IGl0ZW1zW2FdO1xuICAgICAgY29uc3QgaWIgPSBpdGVtc1tiXTtcbiAgICAgIHJldHVybiBpYS5zdGFydCAtIGliLnN0YXJ0IHx8IChpYS5pZCA8IGliLmlkID8gLTEgOiBpYS5pZCA+IGliLmlkID8gMSA6IDApO1xuICAgIH0pO1xuICAgIC8vIFBlci10cmFjayBmb290cHJpbnRzIHBsYWNlZCBUSElTIGNhbGwgXHUyMDE0IHRoZSBvbmx5IGNvbmZsaWN0IGF1dGhvcml0eS5cbiAgICBjb25zdCBwbGFjZWQgPSB0aGlzLnBsYWNlZFNjcmF0Y2g7XG4gICAgbGV0IHBsYWNlZFVzZWQgPSAwO1xuICAgIC8vIEEgbXVsdGktcm93IGl0ZW0gKGEgc3ViLXNwYW4gZmFtaWx5KSBtdXN0IGZpdCBvbiBFVkVSWSByb3cgb2YgaXRzIHJ1bi5cbiAgICBjb25zdCBjYW5QbGFjZSA9ICh0OiBudW1iZXIsIHM6IG51bWJlciwgZTogbnVtYmVyLCByb3dzOiBudW1iZXIpOiBib29sZWFuID0+IHtcbiAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgcm93czsgcisrKSB7XG4gICAgICAgIGlmICh0ICsgciA+PSBwbGFjZWRVc2VkKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgY29uc3QgbGlzdCA9IHBsYWNlZFt0ICsgcl07XG4gICAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgbGlzdC5sZW5ndGg7IGsgKz0gMikge1xuICAgICAgICAgIGlmIChzIDwgbGlzdFtrICsgMV0gJiYgbGlzdFtrXSA8IGUpIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfTtcbiAgICBjb25zdCBwbGFjZSA9IChpOiBudW1iZXIsIHQ6IG51bWJlcik6IHZvaWQgPT4ge1xuICAgICAgdHJhY2tzW2ldID0gdDtcbiAgICAgIGNvbnN0IHJvd3MgPSBwYWNrUm93cyhpdGVtc1tpXSk7XG4gICAgICB3aGlsZSAocGxhY2VkVXNlZCA8IHQgKyByb3dzKSB7XG4gICAgICAgIGNvbnN0IHNsb3QgPSBwbGFjZWRbcGxhY2VkVXNlZF0gPz8gKHBsYWNlZFtwbGFjZWRVc2VkXSA9IFtdKTtcbiAgICAgICAgc2xvdC5sZW5ndGggPSAwO1xuICAgICAgICBwbGFjZWRVc2VkKys7XG4gICAgICB9XG4gICAgICBmb3IgKGxldCByID0gMDsgciA8IHJvd3M7IHIrKykgcGxhY2VkW3QgKyByXS5wdXNoKGl0ZW1zW2ldLnN0YXJ0LCBwYWNrRW5kKGl0ZW1zW2ldKSk7XG4gICAgfTtcbiAgICBjb25zdCBsb3dlc3RGcmVlID0gKHM6IG51bWJlciwgZTogbnVtYmVyLCByb3dzOiBudW1iZXIpOiBudW1iZXIgPT4ge1xuICAgICAgbGV0IHQgPSAwO1xuICAgICAgd2hpbGUgKCFjYW5QbGFjZSh0LCBzLCBlLCByb3dzKSkgdCsrO1xuICAgICAgcmV0dXJuIHQ7XG4gICAgfTtcbiAgICBjb25zdCByZXR1cm5pbmcgPSB0aGlzLnJldHVybmluZ1NjcmF0Y2g7XG4gICAgY29uc3QgZnJlc2ggPSB0aGlzLmZyZXNoU2NyYXRjaDtcbiAgICByZXR1cm5pbmcubGVuZ3RoID0gMDtcbiAgICBmcmVzaC5sZW5ndGggPSAwO1xuICAgIGZvciAobGV0IHZpID0gMDsgdmkgPCB2aXMubGVuZ3RoOyB2aSsrKSB7XG4gICAgICBjb25zdCBpID0gdmlzW3ZpXTtcbiAgICAgIGNvbnN0IGl0ID0gaXRlbXNbaV07XG4gICAgICBjb25zdCBrZXB0ID0gdGhpcy5saXZlLmhhcyhpdC5pZCkgPyB0aGlzLm1lbW9yeS5nZXQoaXQuaWQpIDogdW5kZWZpbmVkO1xuICAgICAgaWYgKGtlcHQgIT09IHVuZGVmaW5lZCAmJiBjYW5QbGFjZShrZXB0LCBpdC5zdGFydCwgcGFja0VuZChpdCksIHBhY2tSb3dzKGl0KSkpIHBsYWNlKGksIGtlcHQpO1xuICAgICAgZWxzZSBpZiAodGhpcy5tZW1vcnkuaGFzKGl0LmlkKSkgcmV0dXJuaW5nLnB1c2goaSk7XG4gICAgICBlbHNlIGZyZXNoLnB1c2goaSk7XG4gICAgfVxuICAgIGZvciAobGV0IHJpID0gMDsgcmkgPCByZXR1cm5pbmcubGVuZ3RoOyByaSsrKSB7XG4gICAgICBjb25zdCBpID0gcmV0dXJuaW5nW3JpXTtcbiAgICAgIGNvbnN0IGl0ID0gaXRlbXNbaV07XG4gICAgICBjb25zdCBlbmQgPSBwYWNrRW5kKGl0KTtcbiAgICAgIGNvbnN0IHJvd3MgPSBwYWNrUm93cyhpdCk7XG4gICAgICBjb25zdCByZW1lbWJlcmVkID0gdGhpcy5tZW1vcnkuZ2V0KGl0LmlkKSBhcyBudW1iZXI7XG4gICAgICBwbGFjZShpLCBjYW5QbGFjZShyZW1lbWJlcmVkLCBpdC5zdGFydCwgZW5kLCByb3dzKSA/IHJlbWVtYmVyZWQgOiBsb3dlc3RGcmVlKGl0LnN0YXJ0LCBlbmQsIHJvd3MpKTtcbiAgICB9XG4gICAgZm9yIChsZXQgZmkgPSAwOyBmaSA8IGZyZXNoLmxlbmd0aDsgZmkrKykge1xuICAgICAgY29uc3QgaSA9IGZyZXNoW2ZpXTtcbiAgICAgIGNvbnN0IGl0ID0gaXRlbXNbaV07XG4gICAgICBwbGFjZShpLCBsb3dlc3RGcmVlKGl0LnN0YXJ0LCBwYWNrRW5kKGl0KSwgcGFja1Jvd3MoaXQpKSk7XG4gICAgfVxuICAgIC8vIFJlbWVtYmVyIGV2ZXJ5IHZpc2libGUgYXNzaWdubWVudCAocmVmcmVzaGluZyBMUlUgcmVjZW5jeSksIHRoZW4gcHJ1bmUgdGhlIG9sZGVzdCBiZXlvbmQgdGhlIGNhcC5cbiAgICBjb25zdCBsaXZlTmV4dCA9IHRoaXMubGl2ZU5leHQ7XG4gICAgbGl2ZU5leHQuY2xlYXIoKTtcbiAgICBsZXQgbWF4VHJhY2sgPSAtMTtcbiAgICBmb3IgKGxldCB2aSA9IDA7IHZpIDwgdmlzLmxlbmd0aDsgdmkrKykge1xuICAgICAgY29uc3QgaSA9IHZpc1t2aV07XG4gICAgICBjb25zdCBpZCA9IGl0ZW1zW2ldLmlkO1xuICAgICAgbGl2ZU5leHQuYWRkKGlkKTtcbiAgICAgIHRoaXMubWVtb3J5LmRlbGV0ZShpZCk7XG4gICAgICB0aGlzLm1lbW9yeS5zZXQoaWQsIHRyYWNrc1tpXSk7XG4gICAgICBjb25zdCBsYXN0ID0gdHJhY2tzW2ldICsgcGFja1Jvd3MoaXRlbXNbaV0pIC0gMTtcbiAgICAgIGlmIChsYXN0ID4gbWF4VHJhY2spIG1heFRyYWNrID0gbGFzdDtcbiAgICB9XG4gICAgdGhpcy5saXZlTmV4dCA9IHRoaXMubGl2ZTtcbiAgICB0aGlzLmxpdmUgPSBsaXZlTmV4dDtcbiAgICB3aGlsZSAodGhpcy5tZW1vcnkuc2l6ZSA+IHRoaXMuY2FwKSB7XG4gICAgICBjb25zdCBvbGRlc3QgPSB0aGlzLm1lbW9yeS5rZXlzKCkubmV4dCgpLnZhbHVlO1xuICAgICAgaWYgKG9sZGVzdCA9PT0gdW5kZWZpbmVkKSBicmVhaztcbiAgICAgIHRoaXMubWVtb3J5LmRlbGV0ZShvbGRlc3QpO1xuICAgIH1cbiAgICByZXR1cm4geyB0cmFja3MsIHRyYWNrQ291bnQ6IE1hdGgubWF4KDEsIG1heFRyYWNrICsgMSkgfTtcbiAgfVxufVxuXG4vLyAtLSBTdWItc3BhbnMgKGZhbWlsaWVzKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBzbGljZSBvZiBhbiBpbnRlcnZhbCB0aGF0IHBhcmVudCByZXNvbHV0aW9uIHJlYWRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQYXJlbnRJdGVtIHtcbiAgaWQ6IHN0cmluZztcbiAgcGFyZW50SWQ/OiBzdHJpbmcgfCBudWxsO1xuICBsYW5lSWQ/OiBzdHJpbmc7XG59XG5cbi8qIEFuIGl0ZW0gbmVzdHMgb25seSB1bmRlciBhIHBhcmVudCB0aGF0IGV4aXN0cyBpbiBgaXRlbXNgLCBpcyBub3QgaXRzZWxmLFxuICogYW5kIHNpdHMgaW4gdGhlIHNhbWUgbGFuZS4gQSBwYXJlbnQgY3ljbGUgaXMgY3V0IGF0IHRoZSBsb3dlc3QtaW5kZXhcbiAqIG1lbWJlciwgc28gdGhlIHJlc3VsdCBpcyBhbHdheXMgYSBmb3Jlc3QuIERldGVybWluaXN0aWM6IHRpZXMgcmVzb2x2ZVxuICogYnkgaW5wdXQgcG9zaXRpb24uICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVBhcmVudHMoaXRlbXM6IHJlYWRvbmx5IFBhcmVudEl0ZW1bXSk6IG51bWJlcltdIHtcbiAgY29uc3QgaWR4ID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkrKykge1xuICAgIGlmICghaWR4LmhhcyhpdGVtc1tpXS5pZCkpIGlkeC5zZXQoaXRlbXNbaV0uaWQsIGkpO1xuICB9XG4gIGNvbnN0IHBhcmVudCA9IG5ldyBBcnJheTxudW1iZXI+KGl0ZW1zLmxlbmd0aCkuZmlsbCgtMSk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaXRlbXMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBwaWQgPSBpdGVtc1tpXS5wYXJlbnRJZDtcbiAgICBpZiAocGlkID09IG51bGwpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHAgPSBpZHguZ2V0KHBpZCk7XG4gICAgaWYgKHAgPT09IHVuZGVmaW5lZCB8fCBwID09PSBpKSBjb250aW51ZTtcbiAgICBjb25zdCBhID0gaXRlbXNbaV0ubGFuZUlkO1xuICAgIGNvbnN0IGIgPSBpdGVtc1twXS5sYW5lSWQ7XG4gICAgaWYgKGEgIT09IHVuZGVmaW5lZCAmJiBiICE9PSB1bmRlZmluZWQgJiYgYSAhPT0gYikgY29udGludWU7XG4gICAgcGFyZW50W2ldID0gcDtcbiAgfVxuICBmb3IgKGxldCBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSsrKSB7XG4gICAgbGV0IGogPSBwYXJlbnRbaV07XG4gICAgbGV0IHN0ZXBzID0gMDtcbiAgICB3aGlsZSAoaiA+PSAwICYmIGogIT09IGkgJiYgc3RlcHMgPD0gaXRlbXMubGVuZ3RoKSB7XG4gICAgICBqID0gcGFyZW50W2pdO1xuICAgICAgc3RlcHMrKztcbiAgICB9XG4gICAgaWYgKGogPT09IGkpIHBhcmVudFtpXSA9IC0xO1xuICB9XG4gIHJldHVybiBwYXJlbnQ7XG59XG5cbi8qKiBBIHBhY2sgaXRlbSB3aXRoIGl0cyBzdWItc3BhbnMsIGZvciBwYWNrRmFtaWx5LiAqL1xuZXhwb3J0IGludGVyZmFjZSBQYWNrTm9kZSBleHRlbmRzIFBhY2tJdGVtIHtcbiAgY2hpbGRyZW4/OiByZWFkb25seSBQYWNrTm9kZVtdIHwgbnVsbDtcbn1cblxuLyoqIHBhY2tGYW1pbHkncyByZXN1bHQ6IHRoZSBibG9jaydzIHJvd3MgYW5kIGV4dGVudCwgcGx1cyBlYWNoIG1lbWJlcidzIHJvdyBvZmZzZXQgZnJvbSB0aGUgdG9wLiAqL1xuZXhwb3J0IGludGVyZmFjZSBGYW1pbHlMYXlvdXQge1xuICByb3dzOiBudW1iZXI7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIC8qKiBudWxsIHdoaWxlIHRoZSByb290IG9yIGFueSBkZXNjZW5kYW50IGlzIG9uZ29pbmcuICovXG4gIGVuZDogbnVtYmVyIHwgbnVsbDtcbiAgdG9wczogTWFwPHN0cmluZywgbnVtYmVyPjtcbn1cblxuLyogVGhlIGV4dGVudCBpcyB0aGUgdW5pb24gb2YgZXZlcnkgbWVtYmVyLCBzbyBhIGNoaWxkIHRoYXQgb3ZlcnJ1bnMgaXRzXG4gKiBwYXJlbnQgc3RpbGwgaGFzIHRoZSBibG9jayBjb3ZlciBpdC4gVGhlIGJsb2NrIGlzIHdoYXQgdGhlIGxhbmUgcGFja2VyXG4gKiBzZWVzOiBvbmUgUGFja0l0ZW0gd2l0aCBgcm93c2Agc2V0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhY2tGYW1pbHkobm9kZTogUGFja05vZGUpOiBGYW1pbHlMYXlvdXQge1xuICBjb25zdCB0b3BzID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgdG9wcy5zZXQobm9kZS5pZCwgMCk7XG4gIGxldCBzdGFydCA9IG5vZGUuc3RhcnQ7XG4gIGxldCBlbmQ6IG51bWJlciB8IG51bGwgPSBub2RlLmVuZCA9PSBudWxsID8gbnVsbCA6IG5vZGUuZW5kO1xuICBsZXQgb25nb2luZyA9IGVuZCA9PT0gbnVsbDtcbiAgY29uc3QgY2hpbGRyZW4gPSBub2RlLmNoaWxkcmVuO1xuICBpZiAoIWNoaWxkcmVuIHx8IGNoaWxkcmVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgcm93czogMSwgc3RhcnQsIGVuZCwgdG9wcyB9O1xuICBjb25zdCBzdWJzOiBGYW1pbHlMYXlvdXRbXSA9IG5ldyBBcnJheShjaGlsZHJlbi5sZW5ndGgpO1xuICBjb25zdCBpdGVtczogUGFja0l0ZW1bXSA9IG5ldyBBcnJheShjaGlsZHJlbi5sZW5ndGgpO1xuICBmb3IgKGxldCBrID0gMDsgayA8IGNoaWxkcmVuLmxlbmd0aDsgaysrKSB7XG4gICAgY29uc3Qgc3ViID0gcGFja0ZhbWlseShjaGlsZHJlbltrXSk7XG4gICAgc3Vic1trXSA9IHN1YjtcbiAgICBpdGVtc1trXSA9IHsgaWQ6IGNoaWxkcmVuW2tdLmlkLCBzdGFydDogc3ViLnN0YXJ0LCBlbmQ6IHN1Yi5lbmQsIHJvd3M6IHN1Yi5yb3dzIH07XG4gICAgaWYgKHN1Yi5zdGFydCA8IHN0YXJ0KSBzdGFydCA9IHN1Yi5zdGFydDtcbiAgICBpZiAoc3ViLmVuZCA9PT0gbnVsbCkgb25nb2luZyA9IHRydWU7XG4gICAgZWxzZSBpZiAoZW5kICE9PSBudWxsICYmIHN1Yi5lbmQgPiBlbmQpIGVuZCA9IHN1Yi5lbmQ7XG4gIH1cbiAgY29uc3QgcGFja2VkID0gcGFja1RyYWNrcyhpdGVtcyk7XG4gIGZvciAobGV0IGsgPSAwOyBrIDwgY2hpbGRyZW4ubGVuZ3RoOyBrKyspIHtcbiAgICBjb25zdCBvZmYgPSAxICsgcGFja2VkLnRyYWNrc1trXTtcbiAgICBmb3IgKGNvbnN0IFtpZCwgdF0gb2Ygc3Vic1trXS50b3BzKSB0b3BzLnNldChpZCwgb2ZmICsgdCk7XG4gIH1cbiAgcmV0dXJuIHsgcm93czogMSArIHBhY2tlZC50cmFja0NvdW50LCBzdGFydCwgZW5kOiBvbmdvaW5nID8gbnVsbCA6IGVuZCwgdG9wcyB9O1xufVxuXG4vLyAtLSBMYW5lIGxheW91dCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVmVydGljYWwgbWV0cmljcyBmb3IgbGFuZSBsYXlvdXQgKENTUyBweCkuICovXG5leHBvcnQgaW50ZXJmYWNlIExhbmVNZXRyaWNzIHtcbiAgLyoqIEhlaWdodCBvZiBvbmUgc3ViLXRyYWNrJ3MgYmFyIHJvdy4gKi9cbiAgdHJhY2tIZWlnaHQ6IG51bWJlcjtcbiAgLyoqIFZlcnRpY2FsIGdhcCBiZXR3ZWVuIHN1Yi10cmFja3Mgd2l0aGluIGEgbGFuZS4gKi9cbiAgdHJhY2tHYXA6IG51bWJlcjtcbiAgLyoqIFBhZGRpbmcgYWJvdmUgdGhlIGZpcnN0IGFuZCBiZWxvdyB0aGUgbGFzdCB0cmFjayBvZiBlYWNoIGxhbmUuICovXG4gIGxhbmVQYWQ6IG51bWJlcjtcbn1cblxuLyoqIENvbXB1dGVkIHZlcnRpY2FsIGV4dGVudHMgb2YgZWFjaCBsYW5lLCBpbiBzdGFja2VkIG9yZGVyLiAqL1xuZXhwb3J0IGludGVyZmFjZSBMYW5lTGF5b3V0IHtcbiAgLyogKi9cbiAgdG9wczogbnVtYmVyW107XG4gIC8qKiBIZWlnaHQgb2YgZWFjaCBsYW5lLiAqL1xuICBoZWlnaHRzOiBudW1iZXJbXTtcbiAgLyoqIFN1bSBvZiBhbGwgbGFuZSBoZWlnaHRzLiAqL1xuICB0b3RhbEhlaWdodDogbnVtYmVyO1xufVxuXG4vKiogSGVpZ2h0IG9mIG9uZSBsYW5lIGdpdmVuIGl0cyB0cmFjayBjb3VudCwgYXQgYHRyYWNrSGVpZ2h0YCBweCBwZXIgdHJhY2sgKGRlZmF1bHRzIHRvIHRoZSBtZXRyaWNzJyBub3JtYWwgaGVpZ2h0KS4gRnJhY3Rpb25hbCBjb3VudHMgYXJlIGFsbG93ZWQgXHUyMDE0IHRoZXkgZHJpdmUgdGhlXG4gKiBsYW5lLWhlaWdodCB0d2Vlbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsYW5lSGVpZ2h0KHRyYWNrQ291bnQ6IG51bWJlciwgbTogTGFuZU1ldHJpY3MsIHRyYWNrSGVpZ2h0ID0gbS50cmFja0hlaWdodCk6IG51bWJlciB7XG4gIGNvbnN0IG4gPSBNYXRoLm1heCgxLCB0cmFja0NvdW50KTtcbiAgcmV0dXJuIG0ubGFuZVBhZCAqIDIgKyBuICogdHJhY2tIZWlnaHQgKyAobiAtIDEpICogbS50cmFja0dhcDtcbn1cblxuLyoqXG4gKiBTdGFjayBsYW5lcyB2ZXJ0aWNhbGx5OiBsYW5lIGhlaWdodCBncm93cyB3aXRoIGl0cyBwYWNrZWQgdHJhY2sgY291bnQuXG4gKiBgdHJhY2tIZWlnaHRzW2ldYCwgd2hlbiBnaXZlbiwgb3ZlcnJpZGVzIHRoZSBtZXRyaWNzJyB0cmFjayBoZWlnaHQgZm9yXG4gKiBsYW5lIGkgXHUyMDE0IGhvdyBhdXRvLWZpdCByZW5kZXJzIGRlbW90ZWQgbGFuZXMgYXQgdGhlIGNvbXBhY3QgaGVpZ2h0IChhbmRcbiAqIGhvdyBoZWlnaHQgY2hhbmdlcyB0d2VlbjogZnJhY3Rpb25hbCBwZXItbGFuZSBoZWlnaHRzIGFyZSBmaW5lKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxheW91dExhbmVzKHRyYWNrQ291bnRzOiByZWFkb25seSBudW1iZXJbXSwgbTogTGFuZU1ldHJpY3MsIHRyYWNrSGVpZ2h0cz86IHJlYWRvbmx5IG51bWJlcltdKTogTGFuZUxheW91dCB7XG4gIGNvbnN0IHRvcHM6IG51bWJlcltdID0gW107XG4gIGNvbnN0IGhlaWdodHM6IG51bWJlcltdID0gW107XG4gIGxldCB5ID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0cmFja0NvdW50cy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGggPSBsYW5lSGVpZ2h0KHRyYWNrQ291bnRzW2ldLCBtLCB0cmFja0hlaWdodHM/LltpXSA/PyBtLnRyYWNrSGVpZ2h0KTtcbiAgICB0b3BzLnB1c2goeSk7XG4gICAgaGVpZ2h0cy5wdXNoKGgpO1xuICAgIHkgKz0gaDtcbiAgfVxuICByZXR1cm4geyB0b3BzLCBoZWlnaHRzLCB0b3RhbEhlaWdodDogeSB9O1xufVxuXG4vKiogeSBvZmZzZXQgb2YgYSBzdWItdHJhY2sncyB0b3Agd2l0aGluIGl0cyBsYW5lIChwZXItbGFuZSBgdHJhY2tIZWlnaHRgIG92ZXJyaWRlcyB0aGUgbWV0cmljcycpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRyYWNrVG9wKHRyYWNrOiBudW1iZXIsIG06IExhbmVNZXRyaWNzLCB0cmFja0hlaWdodCA9IG0udHJhY2tIZWlnaHQpOiBudW1iZXIge1xuICByZXR1cm4gbS5sYW5lUGFkICsgdHJhY2sgKiAodHJhY2tIZWlnaHQgKyBtLnRyYWNrR2FwKTtcbn1cblxuLy8gLS0gQXV0by1maXQgKGNvbXBhY3QgbGFuZXMpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEhlYWRyb29tIGh5c3RlcmVzaXMgZm9yIGF1dG8tZml0OiBhIGRlbW90ZWQgbGFuZSBvbmx5IHJlLXByb21vdGVzIHdoZW4gdGhlIHJlc3VsdGluZyBsYXlvdXQgd291bGQgZml0IHdpdGggdGhpcyBmcmFjdGlvbi4gKi9cbmV4cG9ydCBjb25zdCBGSVRfSFlTVEVSRVNJU19GUkFDID0gMC4xO1xuXG4vKiogUmVzdWx0IG9mIGNvbXB1dGVBdXRvRml0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBGaXRSZXN1bHQge1xuICAvKiogUGVyIGxhbmUgKGlucHV0IG9yZGVyKTogdHJ1ZSA9IHJlbmRlciBBTEwgb2YgdGhhdCBsYW5lJ3MgdHJhY2tzIGF0IHRoZSBjb21wYWN0IGhlaWdodC4gKi9cbiAgZGVtb3RlZDogYm9vbGVhbltdO1xuICAvKiogTnVtYmVyIG9mIGRlbW90ZWQgbGFuZXMgXHUyMDE0IHRoZSBoeXN0ZXJlc2lzIHN0YXRlLiBGZWVkIGl0IGJhY2sgYXMgYHByZXZEZW1vdGVkQ291bnRgIG9uIHRoZSBuZXh0IGV2YWx1YXRpb24uICovXG4gIGNvdW50OiBudW1iZXI7XG59XG5cbi8qKiBUaGUgb3JkZXIgbGFuZXMgYXJlIGRlbW90ZWQgdG8gY29tcGFjdCBpbjogYnkgdmlzaWJsZSB0cmFjayBjb3VudFxuICogREVTQ0VORElORyAodGhlIHRhbGxlc3QgLyBtb3N0IHBhcmFsbGVsIGxhbmUgZmlyc3QgXHUyMDE0IG9uZSBjb21wYWN0IHRhbGxcbiAqIGxhbmUgcmVjb3ZlcnMgdGhlIG1vc3QgaGVpZ2h0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZW1vdGlvbk9yZGVyKHRyYWNrQ291bnRzOiByZWFkb25seSBudW1iZXJbXSk6IG51bWJlcltdIHtcbiAgY29uc3Qgb3JkZXIgPSB0cmFja0NvdW50cy5tYXAoKF8sIGkpID0+IGkpO1xuICBvcmRlci5zb3J0KChhLCBiKSA9PiB0cmFja0NvdW50c1tiXSAtIHRyYWNrQ291bnRzW2FdIHx8IGIgLSBhKTtcbiAgcmV0dXJuIG9yZGVyO1xufVxuXG4vKiogQXV0by1maXQ6IGRlY2lkZSB3aGljaCBsYW5lcyByZW5kZXIgYXQgdGhlIGNvbXBhY3QgdHJhY2sgaGVpZ2h0IHNvIHRoZSBsYW5lIHN0YWNrIGZpdHMgYGF2YWlsSGVpZ2h0YCAodGhlIGhvc3QncyBwbG90IGhlaWdodCkuIEV2YWx1YXRlIHdpdGggdGhlIE5BVFVSQUwgbGF5b3V0IChldmVyeSBsYW5lIGF0IHRoZSBub3JtYWwgdHJhY2sgaGVpZ2h0KTsgd2hpbGUgaXQgb3ZlcmZsb3dzLCBkZW1vdGUgbGFuZXMgb25lIGF0IGEgdGltZSBpbiBkZW1vdGlvbk9yZGVyKCkgdW50aWwgdGhlIHRvdGFsIGZpdHMgb3IgZXZlcnkgbGFuZSBpcyBjb21wYWN0IChpZiBhbGwtY29tcGFjdCBzdGlsbCBvdmVyZmxvd3MsIHRoZSBjYWxsZXIncyB2ZXJ0aWNhbCBsYW5lIHNjcm9sbGluZyB0YWtlcyBvdmVyKS4gRGVtb3Rpb24gYXBwbGllcyB0byBhIHdob2xlIGxhbmUgXHUyMDE0IGFsbCBvZiBpdHMgdHJhY2tzIGdvIGNvbXBhY3QgdG9nZXRoZXIuIERldGVybWluaXN0aWMgYW5kIG9zY2lsbGF0aW9uLWZyZWU6IHRoZSByZXN1bHQgaXMgYSBwdXJlIGZ1bmN0aW9uIG9mICh0cmFjayBjb3VudHMsIG1ldHJpY3MsIGhlaWdodHMsIHByZXZEZW1vdGVkQ291bnQpLiBCZXR3ZWVuIGJvdGggdGhyZXNob2xkcyB0aGUgZGVtb3Rpb24gQ09VTlQgaXMga2VwdDsgdGhlIGRlbW90aW9uIFNFVCBpcyBhbHdheXMgcmUtZGVyaXZlZCBmcm9tIHRoZSBDVVJSRU5UIGNvdW50cywgc29cbiAqYSBsYW5lIHdob3NlIHBhcmFsbGVsaXNtIGxlZnQgdGhlIHdpbmRvdyBoYW5kcyBpdHMgZGVtb3Rpb24gdG8gdGhlIG5vdy10YWxsZXN0IGxhbmUgZGV0ZXJtaW5pc3RpY2FsbHkuIGBjb21wYWN0VHJhY2tIZWlnaHRgIGlzIGNsYW1wZWQgdG8gYXQgbW9zdCB0aGUgbm9ybWFsIHRyYWNrIGhlaWdodC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlQXV0b0ZpdChcbiAgdHJhY2tDb3VudHM6IHJlYWRvbmx5IG51bWJlcltdLFxuICBtOiBMYW5lTWV0cmljcyxcbiAgY29tcGFjdFRyYWNrSGVpZ2h0OiBudW1iZXIsXG4gIGF2YWlsSGVpZ2h0OiBudW1iZXIsXG4gIHByZXZEZW1vdGVkQ291bnQgPSAwLFxuICBoeXN0ZXJlc2lzRnJhYyA9IEZJVF9IWVNURVJFU0lTX0ZSQUMsXG4pOiBGaXRSZXN1bHQge1xuICBjb25zdCBuTGFuZXMgPSB0cmFja0NvdW50cy5sZW5ndGg7XG4gIGNvbnN0IGRlbW90ZWQgPSBuZXcgQXJyYXk8Ym9vbGVhbj4obkxhbmVzKS5maWxsKGZhbHNlKTtcbiAgaWYgKG5MYW5lcyA9PT0gMCkgcmV0dXJuIHsgZGVtb3RlZCwgY291bnQ6IDAgfTtcbiAgY29uc3QgY29tcGFjdCA9IE1hdGgubWF4KDEsIE1hdGgubWluKGNvbXBhY3RUcmFja0hlaWdodCwgbS50cmFja0hlaWdodCkpO1xuICBjb25zdCBvcmRlciA9IGRlbW90aW9uT3JkZXIodHJhY2tDb3VudHMpO1xuICBjb25zdCBzYXZpbmdzID0gbmV3IEFycmF5PG51bWJlcj4obkxhbmVzKTtcbiAgbGV0IHRvdGFsID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBuTGFuZXM7IGkrKykge1xuICAgIGNvbnN0IGhOID0gbGFuZUhlaWdodCh0cmFja0NvdW50c1tpXSwgbSk7XG4gICAgdG90YWwgKz0gaE47XG4gICAgc2F2aW5nc1tpXSA9IGhOIC0gbGFuZUhlaWdodCh0cmFja0NvdW50c1tpXSwgbSwgY29tcGFjdCk7XG4gIH1cbiAgLy8ga01pbjogZmV3ZXN0IGRlbW90aW9ucyAoaW4gb3JkZXIpIHRoYXQgZml0IGF2YWlsSGVpZ2h0LiBrSGVhZDogZmV3ZXN0IHRoYXQgZml0IHdpdGggaGVhZHJvb20gKD49IGtNaW4pLlxuICBjb25zdCBoZWFkQXZhaWwgPSBhdmFpbEhlaWdodCAqICgxIC0gaHlzdGVyZXNpc0ZyYWMpO1xuICBsZXQga01pbiA9IHRvdGFsIDw9IGF2YWlsSGVpZ2h0ID8gMCA6IG5MYW5lcztcbiAgbGV0IGtIZWFkID0gdG90YWwgPD0gaGVhZEF2YWlsID8gMCA6IG5MYW5lcztcbiAgbGV0IHJ1bm5pbmcgPSB0b3RhbDtcbiAgZm9yIChsZXQgayA9IDE7IGsgPD0gbkxhbmVzICYmIChrTWluID09PSBuTGFuZXMgfHwga0hlYWQgPT09IG5MYW5lcyk7IGsrKykge1xuICAgIHJ1bm5pbmcgLT0gc2F2aW5nc1tvcmRlcltrIC0gMV1dO1xuICAgIGlmIChrTWluID09PSBuTGFuZXMgJiYgcnVubmluZyA8PSBhdmFpbEhlaWdodCkga01pbiA9IGs7XG4gICAgaWYgKGtIZWFkID09PSBuTGFuZXMgJiYgcnVubmluZyA8PSBoZWFkQXZhaWwpIGtIZWFkID0gaztcbiAgfVxuICAvLyBIeXN0ZXJlc2lzIG9uIHRoZSBjb3VudDogZGVtb3RlIGltbWVkaWF0ZWx5IHdoZW4gb3ZlcmZsb3dpbmcsIHByb21vdGUgb25seSBhcyBmYXIgYXMga2VlcHMgdGhlIGhlYWRyb29tLlxuICBjb25zdCBwcmV2ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obkxhbmVzLCBNYXRoLmZsb29yKHByZXZEZW1vdGVkQ291bnQpKSk7XG4gIGNvbnN0IGNvdW50ID0gcHJldiA8IGtNaW4gPyBrTWluIDogcHJldiA+IGtIZWFkID8ga0hlYWQgOiBwcmV2O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIGRlbW90ZWRbb3JkZXJbaV1dID0gdHJ1ZTtcbiAgcmV0dXJuIHsgZGVtb3RlZCwgY291bnQgfTtcbn1cblxuLy8gLS0gTGFiZWxzIC8gaW5zdGFudHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogRWxsaXBzaXMgdXNlZCBieSBmaXRUZXh0LiAqL1xuZXhwb3J0IGNvbnN0IEVMTElQU0lTID0gJ1x1MjAyNic7XG5cbi8qKlxuICogRml0IGB0ZXh0YCBpbnRvIGBhdmFpbFB4YCBnaXZlbiBhIChtb25vc3BhY2UpIGNoYXJhY3RlciB3aWR0aDogcmV0dXJucyB0aGVcbiAqIHRleHQgdW5jaGFuZ2VkIHdoZW4gaXQgZml0cywgYW4gYGFiY1x1MjAyNmAgdHJ1bmNhdGlvbiB3aGVuIGF0IGxlYXN0IGBtaW5DaGFyc2BcbiAqIGNoYXJhY3RlcnMgKyB0aGUgZWxsaXBzaXMgZml0LCBlbHNlICcnIChzdXBwcmVzcyB0aGUgbGFiZWwgZW50aXJlbHkgXHUyMDE0XG4gKiBuZXZlciBsZXQgaXQgc3BpbGwgaW50byBhIG5laWdoYm9yaW5nIGJhcikuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaXRUZXh0KHRleHQ6IHN0cmluZywgYXZhaWxQeDogbnVtYmVyLCBjaGFyVzogbnVtYmVyLCBtaW5DaGFycyA9IDIpOiBzdHJpbmcge1xuICBpZiAoIShjaGFyVyA+IDApIHx8IGF2YWlsUHggPD0gMCB8fCB0ZXh0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuICcnO1xuICBjb25zdCBtYXhDaGFycyA9IE1hdGguZmxvb3IoYXZhaWxQeCAvIGNoYXJXKTtcbiAgaWYgKHRleHQubGVuZ3RoIDw9IG1heENoYXJzKSByZXR1cm4gdGV4dDtcbiAgaWYgKG1heENoYXJzIC0gMSA8IG1pbkNoYXJzKSByZXR1cm4gJyc7XG4gIHJldHVybiB0ZXh0LnNsaWNlKDAsIG1heENoYXJzIC0gMSkgKyBFTExJUFNJUztcbn1cblxuLyoqIEJlbG93IHRoaXMgcmVuZGVyZWQgd2lkdGggKENTUyBweCkgYW4gaW50ZXJ2YWwgZHJhd3MgYXMgYW4gaW5zdGFudCBwaXAsIG5vdCBhIGJhci4gKi9cbmV4cG9ydCBjb25zdCBJTlNUQU5UX1RIUkVTSE9MRF9QWCA9IDM7XG5cbi8qKiBUcnVlIHdoZW4gYSBiYXIgb2YgYHdpZHRoUHhgIHNob3VsZCByZW5kZXIgYXMgYW4gaW5zdGFudCBwaXAvZGlhbW9uZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0luc3RhbnRXaWR0aCh3aWR0aFB4OiBudW1iZXIsIHRocmVzaG9sZCA9IElOU1RBTlRfVEhSRVNIT0xEX1BYKTogYm9vbGVhbiB7XG4gIHJldHVybiB3aWR0aFB4IDwgdGhyZXNob2xkO1xufVxuXG4vKiogTWluaW11bSByZW5kZXJlZCB3aWR0aCAoQ1NTIHB4KSBmb3IgYSByZWFsLWR1cmF0aW9uIGJhciBcdTIwMTQgY2xhbXBlZCB1cCwgbmV2ZXIgZGVtb3RlZCB0byBhIHBpcC4gKi9cbmV4cG9ydCBjb25zdCBNSU5fQkFSX1BYID0gMjtcblxuLyoqIFJlbmRlcmVkIHdpZHRoIG9mIFtzdGFydE1zLCBlbmRNc10gbWFwcGVkIHRocm91Z2ggdGhlIHZpZXcncyBzY2FsZSxcbiAqIGNvbXB1dGVkIGZyb20gdGhlIERVUkFUSU9OIGFsb25lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGR1cmF0aW9uV2lkdGhQeChzdGFydE1zOiBudW1iZXIsIGVuZE1zOiBudW1iZXIsIHZpZXc6IFRpbWVWaWV3LCBwbG90V2lkdGg6IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IHNwYW4gPSB2aWV3LmVuZCAtIHZpZXcuc3RhcnQ7XG4gIHJldHVybiBzcGFuID4gMCA/ICgoZW5kTXMgLSBzdGFydE1zKSAvIHNwYW4pICogcGxvdFdpZHRoIDogMDtcbn1cblxuLyoqIFdoaWNoIGVuZHMgb2YgW3N0YXJ0TXMsIGVuZE1zXSBhcmUgQ0xJUFBFRCBieSB0aGUgdmlldyBcdTIwMTQgdGhlIGludGVydmFsJ3NcbiAqIHRydWUgZXh0ZW50IGNvbnRpbnVlcyBvZmYtc2NyZWVuIHBhc3QgdGhhdCBlZGdlLiBEcml2ZXMgdGhlIGVsZW1lbnQnc1xuICogZWRnZS1jb250aW51YXRpb24gc2hhZG93LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVkZ2VDb250aW51YXRpb24oXG4gIHN0YXJ0TXM6IG51bWJlcixcbiAgZW5kTXM6IG51bWJlcixcbiAgdmlldzogVGltZVZpZXcsXG4gIHBsb3RXaWR0aDogbnVtYmVyLFxuICBmYWRlUHg6IG51bWJlcixcbik6IHsgbGVmdDogYm9vbGVhbjsgcmlnaHQ6IGJvb2xlYW4gfSB7XG4gIGNvbnN0IHNwYW4gPSB2aWV3LmVuZCAtIHZpZXcuc3RhcnQ7XG4gIGlmICghKHNwYW4gPiAwKSB8fCAhKHBsb3RXaWR0aCA+IDApKSByZXR1cm4geyBsZWZ0OiBmYWxzZSwgcmlnaHQ6IGZhbHNlIH07XG4gIGNvbnN0IGVwcyA9IHNwYW4gLyBwbG90V2lkdGggLyAyOyAvLyBoYWxmIGEgQ1NTIHB4LCBpbiBtc1xuICByZXR1cm4ge1xuICAgIGxlZnQ6IHN0YXJ0TXMgPCB2aWV3LnN0YXJ0IC0gZXBzICYmIHRpbWVUb1goZW5kTXMsIHZpZXcsIHBsb3RXaWR0aCkgPj0gZmFkZVB4LFxuICAgIHJpZ2h0OiBlbmRNcyA+IHZpZXcuZW5kICsgZXBzICYmIHRpbWVUb1goc3RhcnRNcywgdmlldywgcGxvdFdpZHRoKSA8PSBwbG90V2lkdGggLSBmYWRlUHgsXG4gIH07XG59XG5cbi8vIC0tIEluc3RhbnQgY2x1c3RlcmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qICovXG5leHBvcnQgY29uc3QgQ0xVU1RFUl9PVkVSTEFQX0ZSQUMgPSAwLjU7XG5cbi8qKiBGbG9vciBvbiB0aGF0IHBpdGNoLCBpbiBDU1MgcHguICovXG5leHBvcnQgY29uc3QgQ0xVU1RFUl9NSU5fUElUQ0hfUFggPSAzO1xuXG4vKiogRGVmYXVsdCBjZW50cmUtdG8tY2VudHJlIGRpc3RhbmNlIGJlbG93IHdoaWNoIGluc3RhbnRzIGNhbm5vdCBib3RoIGJlIGRyYXduOiBoYWxmIGEgZnVsbC1zaXplIHBpcC4gKi9cbmV4cG9ydCBjb25zdCBDTFVTVEVSX1BJVENIX1BYID0gMTIgKiBDTFVTVEVSX09WRVJMQVBfRlJBQztcblxuLyoqIEEgY2x1c3RlciB1cCB0byB0aGlzIHdpZGUgKENTUyBweCkgaXMgUE9JTlQtTElLRTogaXRzIG1lbWJlcnMgZG8gc2l0IGF0IG9uZSBzcG90LCBzbyBpdCBkcmF3cyBhcyB0aGUgXHUwMEQ3TiBzdGFjayBnbHlwaC4gKi9cbmV4cG9ydCBjb25zdCBDTFVTVEVSX1NUQUNLX01BWF9QWCA9IDEyO1xuXG4vKiogT25lIGRyYXduIG1hcmsgb2YgYSBzcHJlYWQgY2x1c3RlciBcdTIwMTQgdGhlIHVuaXQgaXQgZHJhd3MsIGhpdC10ZXN0cyBhbmRcbiAqIHpvb21zIGJ5LiAqL1xuZXhwb3J0IGludGVyZmFjZSBDbHVzdGVyTWFyayB7XG4gIC8qKiBUaGUgZHJhd24gbWVtYmVyJ3MgdGltZXN0YW1wIFx1MjAxNCBuZXZlciBhIG1pZHBvaW50LCBuZXZlciBzbmFwcGVkLiAqL1xuICB0aW1lOiBudW1iZXI7XG4gIC8qKiBIYWxmLW9wZW4gcmFuZ2UgaW50byB0aGUgY2x1c3RlcidzIGBpbmRpY2VzYDogdGhpcyBtYXJrJ3MgbWVtYmVyIGFuZCB0aGUgb25lcyBpdCBzdGFuZHMgZm9yLiAqL1xuICBmcm9tOiBudW1iZXI7XG4gIHRvOiBudW1iZXI7XG59XG5cbi8qKiBBIGdyb3VwIG9mIHZpc3VhbGx5LW92ZXJsYXBwaW5nIGluc3RhbnQgbWFya2VycyAoc2VlIGNsdXN0ZXJJbnN0YW50cykuICovXG5leHBvcnQgaW50ZXJmYWNlIEluc3RhbnRDbHVzdGVyIHtcbiAgLyoqIEluZGljZXMgaW50byB0aGUgaW5wdXQgYXJyYXksIGluIChzdGFydCwgaWQpIG9yZGVyLiAqL1xuICBpbmRpY2VzOiBudW1iZXJbXTtcbiAgLyoqIE1lbWJlciBzdGFydC10aW1lIGV4dGVudCBbZmlyc3QsIGxhc3RdIChlcXVhbCBlbmRzIHdoZW4gZXZlcnkgbWVtYmVyIGlzIGNvaW5jaWRlbnQpIFx1MjAxNCB0aGUgY2xpY2stdG8tem9vbSB0YXJnZXQgKGNsdXN0ZXJab29tVmlldykuICovXG4gIGV4dGVudDogVGltZVJhbmdlO1xuICAvKiogVGhlIG1lbWJlcnMgVEhJTk5FRCB0byBhIGRyYXdhYmxlIHBpdGNoLCBpbiB0aW1lIG9yZGVyLCB0b2dldGhlciBjb3ZlcmluZyBldmVyeSBtZW1iZXIgZXhhY3RseSBvbmNlLiAqL1xuICBtYXJrczogQ2x1c3Rlck1hcmtbXTtcbn1cblxuLyoqIFNDQUxFLUFXQVJFIGNsdXN0ZXJpbmcgb2YgaW5zdGFudCBtYXJrZXJzOiBhIGdyZWVkeSB0cmFuc2l0aXZlIHN3ZWVwIGluIHRpbWUgb3JkZXIgbWVyZ2VzIGluc3RhbnRzIHdob3NlIGNlbnRlcnMgc2l0IHdpdGhpbiBgcGl0Y2hQeGAgQ1NTIHB4IG9mIHRoZWlyIG5laWdoYm9yIGF0IHRoZSB2aWV3J3Mgc2NhbGUgXHUyMDE0IGV4YWN0bHkgdGhlIG9uZXMgd2hvc2UgcGlwcyB3b3VsZCBvdmVyZHJhdyBlYWNoIG90aGVyIFx1MjAxNCBhbmQgem9vbWluZyBpbiBwcm9ncmVzc2l2ZWx5IHNwbGl0cyBldmVyeSBjbHVzdGVyIHVudGlsIGVhY2ggcGlwIHN0YW5kcyBhdCBpdHMgdHJ1ZSB0aW1lc3RhbXAuIFRoZSBjaGFpbiBpcyBtYXhpbWFsOiBpdCBicmVha3Mgb25seSBhdCBhIHJlYWwgZ2FwIGluIHRoZSBkYXRhLCBuZXZlciBhdCBhIHdpZHRoIGNhcCwgc28gYSBjbHVzdGVyIGlzIFwib25lIHZpc3VhbGx5IGNvbnRpbnVvdXMgcnVuIG9mIGluc3RhbnRzXCIgYW5kIG5vdGhpbmcgYWJvdXQgaXQgZGVwZW5kcyBvbiB3aGVyZSB0aGUgc3dlZXAgc3RhcnRlZC4gQSBydW4gdGhhdCBzcGFucyByZWFsIHRpbWUgaXMgbm90IGNvbXBhY3RlZCB0byBhIHBvaW50IFx1MjAxNCBpdCBjYXJyaWVzIGBtYXJrc2A6IGl0cyBtZW1iZXJzIFRISU5ORUQgdG8gYHBpdGNoUHhgLCBlYWNoIGF0IGl0cyBvd24gdHJ1ZSB0aW1lc3RhbXBcbiAqYW5kIGVhY2ggZHJhd24gYXMgdGhlIHBpcCBpdCBhbHdheXMgd2FzLiBNYXJrcyBhcmUgZHJvcHBlZCwgbmV2ZXIgbWVyZ2VkIGFuZCBuZXZlciByZWRyYXduIGFzIHNvbWUgb3RoZXIgZ2x5cGgsIHNvIGhvd2V2ZXIgZmFyIG91dCB5b3Ugem9vbSB0aGUgcnVuIHN0YXlzIGEgcm93IG9mIHNlcGFyYXRlZCBwaXBzIChoYWx2ZSB0aGUgd2lkdGgsIGhhbHZlIHRoZSBwaXBzKSBhbmQgY2FuIG5ldmVyIGZ1c2UgaW50byBvbmUgc2hhcGUuIFRoZSBydWxlIGFuZCBib3RoIHdheXMgdGhpcyBoYXMgYmVlbiBnb3Qgd3Jvbmc6IGRvY3MvdGltZWxpbmUvem9vbS1vdXQtbmV2ZXItbWVyZ2VzLm1kLiBPbmx5IGluc3RhbnRzIHBhcnRpY2lwYXRlOiBhbiBpdGVtIG11c3QgYmUgdGVybWluYWwgKGVuZCAhPSBudWxsIFx1MjAxNCBhbiBvbmdvaW5nIGludGVydmFsIHdpbGwgZ3JvdyBpbnRvIGEgYmFyKSB3aXRoIGEgZHVyYXRpb24gbWFwcGluZyB1bmRlciBgaW5zdGFudFB4YCAodGhlIHBpcCB0aHJlc2hvbGQpIGF0IHRoaXMgc2NhbGUuIE1lbWJlcnNoaXAgZGVwZW5kcyBvbmx5IG9uIHRpbWUgREVMVEFTIGFuZCB0aGUgc2NhbGUgXHUyMDE0IG5ldmVyIG9uIHRoZSB2aWV3cG9ydCdzIHBvc2l0aW9uIFx1MjAxNCBzbyBhIHB1cmUgcGFuIGNhbiBuZXZlciBjaGFuZ2UgY2x1c3RlcnMgKG5vIGppdHRlciksIGFuZCBpdGVtc1xuICpiZXlvbmQgdGhlIHZpZXcgc3RpbGwgY2x1c3Rlciwgc28gYSBncm91cCBzY3JvbGxzIGludG8gdmlldyBhbHJlYWR5IGZvcm1lZC4gRGV0ZXJtaW5pc3RpYyB1bmRlciBpbnB1dCByZS1vcmRlcmluZzogdGhlIHN3ZWVwIHJ1bnMgaW4gKHN0YXJ0LCBpZCkgb3JkZXIgYW5kIGluZGljZXMgcmVmZXIgdG8gaW5wdXQgcG9zaXRpb25zLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsdXN0ZXJJbnN0YW50cyhcbiAgaXRlbXM6IHJlYWRvbmx5IFBhY2tJdGVtW10sXG4gIHZpZXc6IFRpbWVWaWV3LFxuICBwbG90V2lkdGg6IG51bWJlcixcbiAgcGl0Y2hQeCA9IENMVVNURVJfUElUQ0hfUFgsXG4gIGluc3RhbnRQeCA9IElOU1RBTlRfVEhSRVNIT0xEX1BYLFxuKTogeyBjbHVzdGVyczogSW5zdGFudENsdXN0ZXJbXTsgbWVtYmVyT2Y6IG51bWJlcltdIH0ge1xuICBjb25zdCBtZW1iZXJPZiA9IG5ldyBBcnJheTxudW1iZXI+KGl0ZW1zLmxlbmd0aCkuZmlsbCgtMSk7XG4gIGNvbnN0IGNsdXN0ZXJzOiBJbnN0YW50Q2x1c3RlcltdID0gW107XG4gIGNvbnN0IHNwYW4gPSB2aWV3LmVuZCAtIHZpZXcuc3RhcnQ7XG4gIGlmICghKHNwYW4gPiAwKSB8fCAhKHBsb3RXaWR0aCA+IDApKSByZXR1cm4geyBjbHVzdGVycywgbWVtYmVyT2YgfTtcbiAgY29uc3QgbXNQZXJQeCA9IHNwYW4gLyBwbG90V2lkdGg7XG4gIGNvbnN0IHBpdGNoTXMgPSBNYXRoLm1heCgwLCBwaXRjaFB4KSAqIG1zUGVyUHg7XG4gIGNvbnN0IGluc3RhbnRNYXhNcyA9IGluc3RhbnRQeCAqIG1zUGVyUHg7XG4gIGNvbnN0IG9yZGVyOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgaXQgPSBpdGVtc1tpXTtcbiAgICBpZiAoaXQuZW5kID09IG51bGwgfHwgaXQuZW5kIC0gaXQuc3RhcnQgPj0gaW5zdGFudE1heE1zKSBjb250aW51ZTtcbiAgICBvcmRlci5wdXNoKGkpO1xuICB9XG4gIC8vIFRoZSBlbGVtZW50IGZlZWRzIChzdGFydCwgaWQpLXNvcnRlZCBsYW5lIGFycmF5cy5cbiAgbGV0IHNvcnRlZCA9IHRydWU7XG4gIGZvciAobGV0IGsgPSAxOyBrIDwgb3JkZXIubGVuZ3RoOyBrKyspIHtcbiAgICBjb25zdCBpYSA9IGl0ZW1zW29yZGVyW2sgLSAxXV07XG4gICAgY29uc3QgaWIgPSBpdGVtc1tvcmRlcltrXV07XG4gICAgaWYgKGlhLnN0YXJ0ID4gaWIuc3RhcnQgfHwgKGlhLnN0YXJ0ID09PSBpYi5zdGFydCAmJiBpYS5pZCA+IGliLmlkKSkge1xuICAgICAgc29ydGVkID0gZmFsc2U7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKCFzb3J0ZWQpIHtcbiAgICBvcmRlci5zb3J0KChhLCBiKSA9PiB7XG4gICAgICBjb25zdCBpYSA9IGl0ZW1zW2FdO1xuICAgICAgY29uc3QgaWIgPSBpdGVtc1tiXTtcbiAgICAgIHJldHVybiBpYS5zdGFydCAtIGliLnN0YXJ0IHx8IChpYS5pZCA8IGliLmlkID8gLTEgOiBpYS5pZCA+IGliLmlkID8gMSA6IDApO1xuICAgIH0pO1xuICB9XG4gIC8vIEdyZWVkeSB0cmFuc2l0aXZlIHN3ZWVwIG92ZXIgYG9yZGVyYCBhcyBpbmRleCByYW5nZXMgKG5vIHBlci1idWNrZXQgYXJyYXkgY2h1cm4gXHUyMDE0IHRoaXMgcnVucyBvbiB0aGUgbGF5b3V0IGhvdCBwYXRoKS5cbiAgbGV0IGJ1Y2tldFN0YXJ0ID0gMDtcbiAgZm9yIChsZXQgb2kgPSAwOyBvaSA8PSBvcmRlci5sZW5ndGg7IG9pKyspIHtcbiAgICBjb25zdCBib3VuZGFyeSA9IG9pID09PSBvcmRlci5sZW5ndGggfHwgKG9pID4gYnVja2V0U3RhcnQgJiYgaXRlbXNbb3JkZXJbb2ldXS5zdGFydCAtIGl0ZW1zW29yZGVyW29pIC0gMV1dLnN0YXJ0ID49IHBpdGNoTXMpO1xuICAgIGlmICghYm91bmRhcnkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGxlbiA9IG9pIC0gYnVja2V0U3RhcnQ7XG4gICAgaWYgKGxlbiA+IDEpIHtcbiAgICAgIGNvbnN0IGluZGljZXMgPSBuZXcgQXJyYXk8bnVtYmVyPihsZW4pO1xuICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBsZW47IGsrKykge1xuICAgICAgICBjb25zdCBpZHggPSBvcmRlcltidWNrZXRTdGFydCArIGtdO1xuICAgICAgICBpbmRpY2VzW2tdID0gaWR4O1xuICAgICAgICBtZW1iZXJPZltpZHhdID0gY2x1c3RlcnMubGVuZ3RoO1xuICAgICAgfVxuICAgICAgLy8gVEhJTiB0byB0aGUgZHJhd2FibGUgcGl0Y2g6IGtlZXAgYSBtZW1iZXIgb25seSBvbmNlIGl0IGNsZWFycyB0aGUgbGFzdCBrZXB0IG9uZSBieSBhIHdob2xlIG1hcmsgcGx1cyBpdHMgZ2FwLlxuICAgICAgY29uc3QgbWFya3M6IENsdXN0ZXJNYXJrW10gPSBbXTtcbiAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgbGVuOyBrKyspIHtcbiAgICAgICAgY29uc3QgdCA9IGl0ZW1zW2luZGljZXNba11dLnN0YXJ0O1xuICAgICAgICBjb25zdCBsYXN0ID0gbWFya3NbbWFya3MubGVuZ3RoIC0gMV07XG4gICAgICAgIGlmIChsYXN0ICE9PSB1bmRlZmluZWQgJiYgdCAtIGxhc3QudGltZSA8IHBpdGNoTXMpIGNvbnRpbnVlO1xuICAgICAgICBpZiAobGFzdCAhPT0gdW5kZWZpbmVkKSBsYXN0LnRvID0gaztcbiAgICAgICAgbWFya3MucHVzaCh7IHRpbWU6IHQsIGZyb206IGssIHRvOiBsZW4gfSk7XG4gICAgICB9XG4gICAgICBjbHVzdGVycy5wdXNoKHtcbiAgICAgICAgaW5kaWNlcyxcbiAgICAgICAgZXh0ZW50OiB7IHN0YXJ0OiBpdGVtc1tpbmRpY2VzWzBdXS5zdGFydCwgZW5kOiBpdGVtc1tpbmRpY2VzW2xlbiAtIDFdXS5zdGFydCB9LFxuICAgICAgICBtYXJrcyxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBidWNrZXRTdGFydCA9IG9pO1xuICB9XG4gIHJldHVybiB7IGNsdXN0ZXJzLCBtZW1iZXJPZiB9O1xufVxuXG4vKiogRnJhY3Rpb24gb2YgdGhlIHpvb21lZCB3aW5kb3cgYSBjbGlja2VkIGNsdXN0ZXIncyBtZW1iZXIgZXh0ZW50IG9jY3VwaWVzIChjZW50ZXJlZCkuICovXG5leHBvcnQgY29uc3QgQ0xVU1RFUl9aT09NX0ZJTExfRlJBQyA9IDAuNjtcblxuLyoqIFRoZSB2aWV3IGEgY2x1c3RlciBjbGljayB6b29tcyB0bzogdGhlIG1lbWJlciBleHRlbnQgY2VudGVyZWQsIGZpbGxpbmdcbiAqIENMVVNURVJfWk9PTV9GSUxMX0ZSQUMgb2YgdGhlIHdpbmRvdywgbmV2ZXIgbmFycm93ZXIgdGhhbiBgbWluU3BhbmAgXHUyMDE0XG4gKiBkZWVwIGVub3VnaCB0aGF0IHRoZSBtZW1iZXJzIHNlcGFyYXRlIHBhc3QgdGhlIGpvaW4gdGhyZXNob2xkIGFuZCB0aGVcbiAqIGNsdXN0ZXIgU1BMSVRTLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsdXN0ZXJab29tVmlldyhleHRlbnQ6IFRpbWVSYW5nZSwgbWluU3BhbiA9IE1JTl9TUEFOX01TLCBmaWxsRnJhYyA9IENMVVNURVJfWk9PTV9GSUxMX0ZSQUMpOiBUaW1lVmlldyB7XG4gIGNvbnN0IGR1ciA9IE1hdGgubWF4KDAsIGV4dGVudC5lbmQgLSBleHRlbnQuc3RhcnQpO1xuICBjb25zdCBzcGFuID0gTWF0aC5tYXgoZmlsbEZyYWMgPiAwID8gZHVyIC8gZmlsbEZyYWMgOiBkdXIsIG1pblNwYW4pO1xuICBjb25zdCBtaWQgPSAoZXh0ZW50LnN0YXJ0ICsgZXh0ZW50LmVuZCkgLyAyO1xuICByZXR1cm4geyBzdGFydDogbWlkIC0gc3BhbiAvIDIsIGVuZDogbWlkICsgc3BhbiAvIDIgfTtcbn1cblxuLyoqIFdoZXJlIGEgY2x1c3RlcidzIG1hcmtlciBzaXRzLCBpbiBUSU1FOiB0aGUgZXh0ZW50IG1pZHBvaW50IHdoaWxlIHRoYXQgZml0c1xuICogdGhlIHdpbmRvdywgc2xpZCBhbG9uZyB0aGUgdmlzaWJsZSBzbGljZSBvZiB0aGUgZXh0ZW50IHdoZW4gdGhlIHdpbmRvd1xuICogY2xpcHMgaXQgKHRoZSBzdGlja3ktbGFiZWwgcGF0dGVybiBcdTIwMTQgYSB0cmFuc2l0aXZlIGNoYWluIHN0cmFkZGxpbmcgYVxuICogdmlld3BvcnQgZWRnZSBrZWVwcyBhbiBvbi1zY3JlZW4gbWFya2VyIGluc3RlYWQgb2YgaGlkaW5nIGl0cyBtZW1iZXJzJ1xuICogZXZpZGVuY2UpLCBhbmQgbnVsbCBvbmNlIG5vIHBhcnQgb2YgdGhlIGV4dGVudCBpcyB2aXNpYmxlLiBgbWFyZ2luTXNgXG4gKiBpbnNldHMgdGhlIHNsaWQgbWFya2VyIGZyb20gdGhlIHdpbmRvdyBlZGdlcyAocGFzcyB0aGUgbWFya2VyIHJhZGl1cyBpbiBtcylcbiAqIHNvIGl0IHN0YXlzIGZ1bGx5IHZpc2libGUuICovXG5leHBvcnQgZnVuY3Rpb24gY2x1c3Rlck1hcmtlclRpbWUoZXh0ZW50OiBUaW1lUmFuZ2UsIHZpZXc6IFRpbWVWaWV3LCBtYXJnaW5NczogbnVtYmVyKTogbnVtYmVyIHwgbnVsbCB7XG4gIGlmIChleHRlbnQuZW5kIDwgdmlldy5zdGFydCB8fCBleHRlbnQuc3RhcnQgPiB2aWV3LmVuZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG1pZCA9IChleHRlbnQuc3RhcnQgKyBleHRlbnQuZW5kKSAvIDI7XG4gIGxldCBsbyA9IE1hdGgubWF4KGV4dGVudC5zdGFydCwgdmlldy5zdGFydCArIG1hcmdpbk1zKTtcbiAgbGV0IGhpID0gTWF0aC5taW4oZXh0ZW50LmVuZCwgdmlldy5lbmQgLSBtYXJnaW5Ncyk7XG4gIGlmIChsbyA+IGhpKSB7XG4gICAgLy8gTWFyZ2lucyBjYW4gY3Jvc3Mgb24gYSB0aW55IHdpbmRvdywgYSBuZWFyLXBvaW50IGV4dGVudC5cbiAgICBsbyA9IE1hdGgubWF4KGV4dGVudC5zdGFydCwgdmlldy5zdGFydCk7XG4gICAgaGkgPSBNYXRoLm1pbihleHRlbnQuZW5kLCB2aWV3LmVuZCk7XG4gIH1cbiAgcmV0dXJuIE1hdGgubWluKE1hdGgubWF4KG1pZCwgbG8pLCBoaSk7XG59XG5cbi8vIC0tIE1pbmltYXAgc3RyaXAgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBIYWxmLXdpZHRoIChDU1MgcHgpIG9mIGEgbWluaW1hcCBoYW5kbGUncyBoaXQgem9uZSBcdTIwMTQgZ2VuZXJvdXNseSBwYXN0IHRoZSBkcmF3biBiYXIuICovXG5leHBvcnQgY29uc3QgTUlOSU1BUF9IQU5ETEVfSElUX1BYID0gODtcbi8qKiBNaW5pbXVtIGRyYXduIHdpZHRoIChDU1MgcHgpIG9mIHRoZSBtaW5pbWFwJ3Mgd2luZG93IHJlY3QgXHUyMDE0IGEgMTAtbWluIHdpbmRvdyBvbiBhIHdlZWstbG9uZyBleHRlbnQgc3RheXMgdmlzaWJsZSBhbmQgZ3JhYmJhYmxlLiAqL1xuZXhwb3J0IGNvbnN0IE1JTklNQVBfTUlOX1dJTkRPV19QWCA9IDY7XG5cbi8qKiBUaGUgbWluaW1hcCB3aW5kb3cgcmVjdCdzIGhvcml6b250YWwgZXh0ZW50LCBpbiBzdHJpcCBweC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWluaW1hcFdpbmRvd1JlY3Qge1xuICB4MDogbnVtYmVyO1xuICB4MTogbnVtYmVyO1xufVxuXG4vKiogV2hhdCBhIHN0cmlwIHggY29vcmRpbmF0ZSBsYW5kcyBvbiAoc2VlIG1pbmltYXBIaXRab25lKS4gKi9cbmV4cG9ydCB0eXBlIE1pbmltYXBab25lID0gJ2xlZnQtaGFuZGxlJyB8ICdyaWdodC1oYW5kbGUnIHwgJ2luc2lkZScgfCAnYmVmb3JlJyB8ICdhZnRlcic7XG5cbi8qKlxuICogVGhlIHN0cmlwJ3MgZGF0YSBleHRlbnQsIGZyb20gd2hhdCB0aGUgZWxlbWVudCBrbm93czogdGhlIGVhcmxpZXN0XG4gKiBsb2FkZWQgaW50ZXJ2YWwgc3RhcnQgXHUyMDE0IHdpZGVuZWQgYnkgY292ZXJhZ2Uga25vd2xlZGdlIHdoZXJlIGl0IGhlbHBzXG4gKiAodGhlIGZpcnN0IGNvdmVyZWQgdGltZSBhbmQgdGhlIGV4aGF1c3RlZC1oaXN0b3J5IGJvdW5kYXJ5IGJvdGggY291bnQ6XG4gKiBsb2FkZWQtYnV0LWVtcHR5IGhpc3RvcnkgYW5kIHRoZSBrbm93biBzdGFydCBvZiB0aW1lIGFyZSBwYXJ0IG9mIHRoZVxuICogb3ZlcnZpZXcpIFx1MjAxNCB0aHJvdWdoIG1heChub3csIHRoZSBsYXRlc3QgaW50ZXJ2YWwgZW5kKS4gTnVsbCB3aGVuIG5vXG4gKiBzdGFydCBpcyBrbm93biBhdCBhbGwgKG5vdGhpbmcgbG9hZGVkIFx1MjAxNCB0aGUgc3RyaXAgaGlkZXMpLiBBXG4gKiBkZWdlbmVyYXRlL3RpbnkgZXh0ZW50IGlzIHBhZGRlZCBiYWNrd2FyZCB0byBgbWluU3Bhbk1zYCBzbyB0aGUgc3RyaXBcbiAqIG5ldmVyIGRpdmlkZXMgYnkgemVybyBhbmQgYSBzaW5nbGUgaW5zdGFudCBzdGlsbCByZWFkcyBhcyBhIHJlZ2lvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1pbmltYXBFeHRlbnQoXG4gIGVhcmxpZXN0U3RhcnQ6IG51bWJlciB8IG51bGwsXG4gIGxhdGVzdEVuZDogbnVtYmVyIHwgbnVsbCxcbiAgbm93OiBudW1iZXIsXG4gIGV4aGF1c3RlZEJlZm9yZTogbnVtYmVyIHwgbnVsbCA9IG51bGwsXG4gIGNvdmVyZWRTdGFydDogbnVtYmVyIHwgbnVsbCA9IG51bGwsXG4gIG1pblNwYW5NcyA9IDYwXzAwMCxcbik6IFRpbWVWaWV3IHwgbnVsbCB7XG4gIGxldCBzdGFydCA9IEluZmluaXR5O1xuICBpZiAoZWFybGllc3RTdGFydCAhPSBudWxsKSBzdGFydCA9IE1hdGgubWluKHN0YXJ0LCBlYXJsaWVzdFN0YXJ0KTtcbiAgaWYgKGNvdmVyZWRTdGFydCAhPSBudWxsKSBzdGFydCA9IE1hdGgubWluKHN0YXJ0LCBjb3ZlcmVkU3RhcnQpO1xuICBpZiAoZXhoYXVzdGVkQmVmb3JlICE9IG51bGwpIHN0YXJ0ID0gTWF0aC5taW4oc3RhcnQsIGV4aGF1c3RlZEJlZm9yZSk7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHN0YXJ0KSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGVuZCA9IGxhdGVzdEVuZCAhPSBudWxsICYmIGxhdGVzdEVuZCA+IG5vdyA/IGxhdGVzdEVuZCA6IG5vdztcbiAgaWYgKGVuZCAtIHN0YXJ0IDwgbWluU3Bhbk1zKSBzdGFydCA9IGVuZCAtIG1pblNwYW5NcztcbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG4vKipcbiAqIE1hcCB0aGUgdmlld3BvcnQgaW50byBzdHJpcCBweDogdGhlIHdpbmRvdyByZWN0LCBDUk9QUEVEIHRvIHRoZSBzdHJpcFxuICogKGEgdmlldyBoYW5naW5nIHBhc3QgdGhlIGV4dGVudCBzaG93cyB0cnVuY2F0ZWQgYXQgdGhlIHN0cmlwIGVkZ2UgXHUyMDE0XG4gKiBuZXZlciBzbGlkIHRvIGEgbHlpbmcgcG9zaXRpb24pLCB3aXRoIGEgbWluaW11bSB2aXN1YWwgd2lkdGggYXBwbGllZFxuICogYXJvdW5kIHRoZSBjZW50ZXIgQkVGT1JFIGNyb3BwaW5nIChhIHRpbnkgd2luZG93IG9uIGEgaHVnZSBleHRlbnRcbiAqIHN0YXlzIHZpc2libGUpOyBhIHZpZXcgZW50aXJlbHkgb3V0c2lkZSB0aGUgZXh0ZW50IHBpbnMgYSBtaW5pbXVtXG4gKiBzbGl2ZXIgYXQgdGhlIG5lYXJlciBzdHJpcCBlZGdlLiBEZWdlbmVyYXRlIGV4dGVudC93aWR0aCB5aWVsZHMgdGhlXG4gKiBmdWxsIHN0cmlwLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWluaW1hcFdpbmRvd1JlY3QoXG4gIHZpZXc6IFRpbWVWaWV3LFxuICBleHRlbnQ6IFRpbWVWaWV3LFxuICB3aWR0aDogbnVtYmVyLFxuICBtaW5QeCA9IE1JTklNQVBfTUlOX1dJTkRPV19QWCxcbik6IE1pbmltYXBXaW5kb3dSZWN0IHtcbiAgaWYgKCEoZXh0ZW50LmVuZCAtIGV4dGVudC5zdGFydCA+IDApIHx8ICEod2lkdGggPiAwKSkgcmV0dXJuIHsgeDA6IDAsIHgxOiBNYXRoLm1heCgwLCB3aWR0aCkgfTtcbiAgbGV0IHgwID0gdGltZVRvWCh2aWV3LnN0YXJ0LCBleHRlbnQsIHdpZHRoKTtcbiAgbGV0IHgxID0gdGltZVRvWCh2aWV3LmVuZCwgZXh0ZW50LCB3aWR0aCk7XG4gIGlmICh4MSAtIHgwIDwgbWluUHgpIHtcbiAgICBjb25zdCBjID0gKHgwICsgeDEpIC8gMjtcbiAgICB4MCA9IGMgLSBtaW5QeCAvIDI7XG4gICAgeDEgPSBjICsgbWluUHggLyAyO1xuICB9XG4gIGlmICh4MSA8PSAwKSByZXR1cm4geyB4MDogMCwgeDE6IE1hdGgubWluKG1pblB4LCB3aWR0aCkgfTtcbiAgaWYgKHgwID49IHdpZHRoKSByZXR1cm4geyB4MDogTWF0aC5tYXgoMCwgd2lkdGggLSBtaW5QeCksIHgxOiB3aWR0aCB9O1xuICByZXR1cm4geyB4MDogTWF0aC5tYXgoMCwgeDApLCB4MTogTWF0aC5taW4od2lkdGgsIHgxKSB9O1xufVxuXG4vKipcbiAqIEhpdC10ZXN0IGEgc3RyaXAgeCBhZ2FpbnN0IHRoZSB3aW5kb3cgcmVjdC4gSGFuZGxlcyB3aW4gb3ZlciB0aGVcbiAqIG1pZGRsZSBhbmQgdGhlaXIgem9uZXMgcmVhY2ggYGhpdFB4YCBPVVRTSURFIHRoZSByZWN0IChnZW5lcm91cyBncmFiXG4gKiB0YXJnZXRzKSBidXQgb25seSBtaW4oaGl0UHgsIHdpbmRvd1dpZHRoLzQpIElOU0lERSBpdCBcdTIwMTQgYSBuYXJyb3dcbiAqIHdpbmRvdyBrZWVwcyBhIGdyYWJiYWJsZSBtaWRkbGUgaW5zdGVhZCBvZiB0aGUgaGFuZGxlIHpvbmVzIHN3YWxsb3dpbmdcbiAqIGl0LiBXaGVuIGJvdGggaGFuZGxlIHpvbmVzIGNvdmVyIHggKHRpbnkgd2luZG93KSwgdGhlIG5lYXJlciBoYW5kbGVcbiAqIHdpbnMgKHRpZXMgZ28gbGVmdCkuIE91dHNpZGUgZXZlcnl0aGluZzogJ2JlZm9yZScvJ2FmdGVyJyBcdTIwMTQgdGhlXG4gKiBjbGljay10by1jZW50ZXIgem9uZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtaW5pbWFwSGl0Wm9uZSh4OiBudW1iZXIsIHJlY3Q6IE1pbmltYXBXaW5kb3dSZWN0LCBoaXRQeCA9IE1JTklNQVBfSEFORExFX0hJVF9QWCk6IE1pbmltYXBab25lIHtcbiAgY29uc3QgaW5SZWFjaCA9IE1hdGgubWluKGhpdFB4LCAocmVjdC54MSAtIHJlY3QueDApIC8gNCk7XG4gIGNvbnN0IGxlZnRIaXQgPSB4ID49IHJlY3QueDAgLSBoaXRQeCAmJiB4IDw9IHJlY3QueDAgKyBpblJlYWNoO1xuICBjb25zdCByaWdodEhpdCA9IHggPj0gcmVjdC54MSAtIGluUmVhY2ggJiYgeCA8PSByZWN0LngxICsgaGl0UHg7XG4gIGlmIChsZWZ0SGl0ICYmIHJpZ2h0SGl0KSByZXR1cm4geCAtIHJlY3QueDAgPD0gcmVjdC54MSAtIHggPyAnbGVmdC1oYW5kbGUnIDogJ3JpZ2h0LWhhbmRsZSc7XG4gIGlmIChsZWZ0SGl0KSByZXR1cm4gJ2xlZnQtaGFuZGxlJztcbiAgaWYgKHJpZ2h0SGl0KSByZXR1cm4gJ3JpZ2h0LWhhbmRsZSc7XG4gIGlmICh4ID4gcmVjdC54MCAmJiB4IDwgcmVjdC54MSkgcmV0dXJuICdpbnNpZGUnO1xuICByZXR1cm4geCA8IHJlY3QueDAgPyAnYmVmb3JlJyA6ICdhZnRlcic7XG59XG5cbi8qKiBTbGlkZSBhIHdpbmRvdyBmdWxseSBpbnNpZGUgdGhlIGV4dGVudCAoc3BhbiBwcmVzZXJ2ZWQ7IHdpZGVyLXRoYW4tZXh0ZW50IHBpbnMgdG8gdGhlIGxpdmUgZW5kKS4gKi9cbmZ1bmN0aW9uIGNsYW1wV2luZG93VG9FeHRlbnQobmV4dDogVGltZVZpZXcsIGV4dGVudDogVGltZVZpZXcpOiBUaW1lVmlldyB7XG4gIGNvbnN0IHNwYW4gPSBuZXh0LmVuZCAtIG5leHQuc3RhcnQ7XG4gIGlmIChzcGFuID49IGV4dGVudC5lbmQgLSBleHRlbnQuc3RhcnQpIHJldHVybiB7IHN0YXJ0OiBleHRlbnQuZW5kIC0gc3BhbiwgZW5kOiBleHRlbnQuZW5kIH07XG4gIGlmIChuZXh0LnN0YXJ0IDwgZXh0ZW50LnN0YXJ0KSByZXR1cm4geyBzdGFydDogZXh0ZW50LnN0YXJ0LCBlbmQ6IGV4dGVudC5zdGFydCArIHNwYW4gfTtcbiAgaWYgKG5leHQuZW5kID4gZXh0ZW50LmVuZCkgcmV0dXJuIHsgc3RhcnQ6IGV4dGVudC5lbmQgLSBzcGFuLCBlbmQ6IGV4dGVudC5lbmQgfTtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbi8qKiBHcmFiLXRoZS1taWRkbGU6IHBhbiB0aGUgd2luZG93IGJ5IGEgcG9pbnRlciBkZWx0YSBpbiBzdHJpcCBweCwgc3BhbiBwcmVzZXJ2ZWQsIGNsYW1wZWQgaW5zaWRlIHRoZSBleHRlbnQgYXQgYm90aCBlbmRzIChhIHdpbmRvdyB3aWRlciB0aGFuIHRoZSB3aG9sZSBleHRlbnQgcGlucyB0byB0aGUgZXh0ZW50J3MgbGl2ZSBlbmQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1pbmltYXBQYW4odmlldzogVGltZVZpZXcsIGR4UHg6IG51bWJlciwgZXh0ZW50OiBUaW1lVmlldywgd2lkdGg6IG51bWJlcik6IFRpbWVWaWV3IHtcbiAgaWYgKCEoZXh0ZW50LmVuZCAtIGV4dGVudC5zdGFydCA+IDApIHx8ICEod2lkdGggPiAwKSkgcmV0dXJuIHsgc3RhcnQ6IHZpZXcuc3RhcnQsIGVuZDogdmlldy5lbmQgfTtcbiAgcmV0dXJuIGNsYW1wV2luZG93VG9FeHRlbnQocGFuVmlldyh2aWV3LCAoZHhQeCAqIChleHRlbnQuZW5kIC0gZXh0ZW50LnN0YXJ0KSkgLyB3aWR0aCksIGV4dGVudCk7XG59XG5cbi8qKlxuICogRHJhZyBvbmUgd2luZG93IGVkZ2UgdG8gdGhlIHN0cmlwIHguIFRoZSBkcmFnZ2VkIGVkZ2UgaXMgY2xhbXBlZCB0b1xuICogdGhlIGV4dGVudCBhbmQgdG8gW21pblNwYW4sIG1heFNwYW5dIGFnYWluc3QgdGhlIGZpeGVkIG9wcG9zaXRlIGVkZ2UgXHUyMDE0XG4gKiBkcmFnZ2luZyBhIGhhbmRsZSBwYXN0IChvciBpbnRvKSB0aGUgb3RoZXIgQ0xBTVBTIGF0IHRoZSBtaW5pbXVtIHNwYW4sXG4gKiBpdCBuZXZlciBmbGlwcyB3aGljaCBlZGdlIGlzIHdoaWNoIG1pZC1kcmFnLiBUaGUgbWluLXNwYW4gZmxvb3Igd2luc1xuICogb3ZlciB0aGUgZXh0ZW50IGNsYW1wICh0aGUgd2luZG93IG11c3Qgc3RheSBhIHZhbGlkIHZpZXcgZXZlbiBpbnNpZGVcbiAqIGEgdGlueSBleHRlbnQpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWluaW1hcFJlc2l6ZShcbiAgdmlldzogVGltZVZpZXcsXG4gIGVkZ2U6ICdsZWZ0JyB8ICdyaWdodCcsXG4gIHhQeDogbnVtYmVyLFxuICBleHRlbnQ6IFRpbWVWaWV3LFxuICB3aWR0aDogbnVtYmVyLFxuICBtaW5TcGFuID0gTUlOX1NQQU5fTVMsXG4gIG1heFNwYW4gPSBNQVhfU1BBTl9NUyxcbik6IFRpbWVWaWV3IHtcbiAgaWYgKCEoZXh0ZW50LmVuZCAtIGV4dGVudC5zdGFydCA+IDApIHx8ICEod2lkdGggPiAwKSkgcmV0dXJuIHsgc3RhcnQ6IHZpZXcuc3RhcnQsIGVuZDogdmlldy5lbmQgfTtcbiAgY29uc3QgdCA9IHhUb1RpbWUoTWF0aC5taW4oTWF0aC5tYXgoeFB4LCAwKSwgd2lkdGgpLCBleHRlbnQsIHdpZHRoKTtcbiAgaWYgKGVkZ2UgPT09ICdsZWZ0Jykge1xuICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oTWF0aC5tYXgodCwgZXh0ZW50LnN0YXJ0LCB2aWV3LmVuZCAtIG1heFNwYW4pLCB2aWV3LmVuZCAtIG1pblNwYW4pO1xuICAgIHJldHVybiB7IHN0YXJ0LCBlbmQ6IHZpZXcuZW5kIH07XG4gIH1cbiAgY29uc3QgZW5kID0gTWF0aC5tYXgoTWF0aC5taW4odCwgZXh0ZW50LmVuZCwgdmlldy5zdGFydCArIG1heFNwYW4pLCB2aWV3LnN0YXJ0ICsgbWluU3Bhbik7XG4gIHJldHVybiB7IHN0YXJ0OiB2aWV3LnN0YXJ0LCBlbmQgfTtcbn1cblxuLyoqIENsaWNrIG91dHNpZGUgdGhlIHdpbmRvdzogcmUtY2VudGVyIGl0IGF0IHRoZSBjbGlja2VkIHRpbWUsIHNwYW4gcHJlc2VydmVkLCBleHRlbnQtY2xhbXBlZCBsaWtlIGEgcGFuLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1pbmltYXBDZW50ZXIodmlldzogVGltZVZpZXcsIHhQeDogbnVtYmVyLCBleHRlbnQ6IFRpbWVWaWV3LCB3aWR0aDogbnVtYmVyKTogVGltZVZpZXcge1xuICBpZiAoIShleHRlbnQuZW5kIC0gZXh0ZW50LnN0YXJ0ID4gMCkgfHwgISh3aWR0aCA+IDApKSByZXR1cm4geyBzdGFydDogdmlldy5zdGFydCwgZW5kOiB2aWV3LmVuZCB9O1xuICBjb25zdCBzcGFuID0gdmlldy5lbmQgLSB2aWV3LnN0YXJ0O1xuICBjb25zdCB0ID0geFRvVGltZShNYXRoLm1pbihNYXRoLm1heCh4UHgsIDApLCB3aWR0aCksIGV4dGVudCwgd2lkdGgpO1xuICByZXR1cm4gY2xhbXBXaW5kb3dUb0V4dGVudCh7IHN0YXJ0OiB0IC0gc3BhbiAvIDIsIGVuZDogdCArIHNwYW4gLyAyIH0sIGV4dGVudCk7XG59XG5cbi8vIC0tIEhpdCB0ZXN0aW5nICguL2hpdC10ZXN0LnRzKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgeyBleHBhbmRIaXRSZWN0LCBoaXRUZXN0UmVjdHMsIGRpc3RTcVRvU2VnbWVudCwgaGl0VGVzdFBvbHlsaW5lIH0gZnJvbSAnLi9oaXQtdGVzdC50cyc7XG5leHBvcnQgdHlwZSB7IEhpdFJlY3QgfSBmcm9tICcuL2hpdC10ZXN0LnRzJztcblxuLyoqXG4gKiBSb3V0ZSBmb3IgYSBjb25uZWN0b3IgZnJvbSB0aGUgcmlnaHQtY2VudGVyIG9mIGBmcm9tYCB0byB0aGUgbGVmdC1jZW50ZXJcbiAqIG9mIGB0b2A6IGEgc2FtcGxlZCBjdWJpYyBiZXppZXIgd2l0aCBob3Jpem9udGFsIGNvbnRyb2wgaGFuZGxlcywgc28gdGhlXG4gKiBsaW5lIGxlYXZlcyB0aGUgc291cmNlIHJpZ2h0d2FyZCBhbmQgZW50ZXJzIHRoZSB0YXJnZXQgbGVmdHdhcmQgXHUyMDE0IGFcbiAqIGdlbnRsZSBTLWN1cnZlIGZvciBmb3J3YXJkIHRhcmdldHMsIGEgcmVhZGFibGUgbG9vcC1iYWNrIGZvciB0YXJnZXRzIHRoYXRcbiAqIHN0YXJ0IGVhcmxpZXIuIEFsaWduZWQgc2FtZS1yb3cgZm9yd2FyZCB0YXJnZXRzIGdldCBhIHBsYWluIDItcG9pbnRcbiAqIHNlZ21lbnQuIFJldHVybnMgYHNhbXBsZXMgKyAxYCBwb2ludHMgKHBvbHlsaW5lOiBkcmF3IGl0LCBoaXQtdGVzdCBpdFxuICogd2l0aCBoaXRUZXN0UG9seWxpbmUpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29ubmVjdG9yUm91dGUoZnJvbTogSGl0UmVjdCwgdG86IEhpdFJlY3QsIHNhbXBsZXMgPSAyNCk6IHsgeDogbnVtYmVyOyB5OiBudW1iZXIgfVtdIHtcbiAgY29uc3QgeDAgPSBmcm9tLnggKyBmcm9tLnc7XG4gIGNvbnN0IHkwID0gZnJvbS55ICsgZnJvbS5oIC8gMjtcbiAgY29uc3QgeDEgPSB0by54O1xuICBjb25zdCB5MSA9IHRvLnkgKyB0by5oIC8gMjtcbiAgaWYgKE1hdGguYWJzKHkwIC0geTEpIDwgMC41ICYmIHgxID49IHgwKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHsgeDogeDAsIHk6IHkwIH0sXG4gICAgICB7IHg6IHgxLCB5OiB5MSB9LFxuICAgIF07XG4gIH1cbiAgY29uc3QgYyA9IE1hdGgubWluKDkwLCBNYXRoLm1heCgyNCwgTWF0aC5hYnMoeDEgLSB4MCkgKiAwLjUsIE1hdGguYWJzKHkxIC0geTApICogMC4zNSkpO1xuICBjb25zdCBwdHM6IHsgeDogbnVtYmVyOyB5OiBudW1iZXIgfVtdID0gW107XG4gIGNvbnN0IG4gPSBNYXRoLm1heCgyLCBNYXRoLmZsb29yKHNhbXBsZXMpKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbjsgaSsrKSB7XG4gICAgY29uc3QgdCA9IGkgLyBuO1xuICAgIGNvbnN0IHUgPSAxIC0gdDtcbiAgICBwdHMucHVzaCh7XG4gICAgICB4OiB1ICogdSAqIHUgKiB4MCArIDMgKiB1ICogdSAqIHQgKiAoeDAgKyBjKSArIDMgKiB1ICogdCAqIHQgKiAoeDEgLSBjKSArIHQgKiB0ICogdCAqIHgxLFxuICAgICAgeTogdSAqIHUgKiB1ICogeTAgKyAzICogdSAqIHUgKiB0ICogeTAgKyAzICogdSAqIHQgKiB0ICogeTEgKyB0ICogdCAqIHQgKiB5MSxcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gcHRzO1xufVxuXG4vKiogVGhlIGNsYW1wZWQgcGhhc2Ugd2luZG93IGBzZWdtZW50QXRUaW1lYCByZXNvbHZlZCwgd2l0aCBpdHMgYXJyYXkgaW5kZXguICovXG5leHBvcnQgaW50ZXJmYWNlIFNlZ21lbnRIaXQge1xuICAvKiogSW5kZXggaW50byB0aGUgaW50ZXJ2YWwncyBgc2VnbWVudHNgIGFycmF5LiAqL1xuICBpbmRleDogbnVtYmVyO1xuICAvKiogVGhlIHNlZ21lbnQncyBga2luZGAgKHN0eWxlLW1hcCBrZXkgXHUyMDE0IHRoZSBsZWdlbmQvdG9vbHRpcCB2b2NhYnVsYXJ5KS4gKi9cbiAga2luZDogc3RyaW5nO1xuICAvKiogUGhhc2Ugc3RhcnQsIGNsYW1wZWQgaW50byB0aGUgaW50ZXJ2YWwgKG1zKS4gKi9cbiAgc3RhcnQ6IG51bWJlcjtcbiAgLyoqIFBoYXNlIGVuZCAobnVsbCBlbmQgcmVzb2x2ZXMgdG8gYGludGVydmFsRW5kYCksIGNsYW1wZWQgKG1zKS4gKi9cbiAgZW5kOiBudW1iZXI7XG59XG5cbi8qKiBUaGUgc2VnbWVudCBQQUlOVEVEIGF0IHRpbWUgYHRgIGluc2lkZSBhbiBpbnRlcnZhbCdzIGJhcjogdGhlIExBU1QgYXJyYXlcbiAqIGVudHJ5IGNvdmVyaW5nIHQgKHNlZ21lbnRzIGRyYXcgaW4gb3JkZXIgXHUyMDE0IGxhdGVyIG92ZXJwYWludHMgZWFybGllciksXG4gKiB3aXRoIHRoZSBkcmF3IHBhdGgncyBjbGFtcHMgKHN0YXJ0IGZsb29yZWQgdG8gYGludGVydmFsU3RhcnRgLCBudWxsL2xhdGVcbiAqIGVuZCBjYXBwZWQgdG8gYGludGVydmFsRW5kYCBcdTIwMTQgcGFzcyB0aGUgZWZmZWN0aXZlIGVuZDogYGVuZCA/PyBub3dgKS5cbiAqIENvdmVyYWdlIGlzIGhhbGYtb3BlbiBbc3RhcnQsIGVuZCkgc28gc2hhcmVkIHBoYXNlIGJvdW5kYXJpZXMgcmVzb2x2ZSB0b1xuICogdGhlIGluY29taW5nIHBoYXNlLCBFWENFUFQgdCBhdCB0aGUgaW50ZXJ2YWwncyBvd24gZW5kIHN0aWxsIGhpdHMgYSBzZWdtZW50XG4gKiBlbmRpbmcgdGhlcmUgKHRoZSBiYXIncyBsYXN0IHBpeGVsIG11c3QgcmVzb2x2ZSkuICovXG5leHBvcnQgZnVuY3Rpb24gc2VnbWVudEF0VGltZShcbiAgc2VnbWVudHM6IHJlYWRvbmx5IFRpbWVsaW5lU2VnbWVudFtdIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgaW50ZXJ2YWxTdGFydDogbnVtYmVyLFxuICBpbnRlcnZhbEVuZDogbnVtYmVyLFxuICB0OiBudW1iZXIsXG4pOiBTZWdtZW50SGl0IHwgbnVsbCB7XG4gIGlmICghc2VnbWVudHMpIHJldHVybiBudWxsO1xuICBmb3IgKGxldCBpID0gc2VnbWVudHMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICBjb25zdCBzID0gc2VnbWVudHNbaV07XG4gICAgY29uc3QgY3MgPSBNYXRoLm1heCh0b01zKHMuc3RhcnQpLCBpbnRlcnZhbFN0YXJ0KTtcbiAgICBjb25zdCBjZSA9IE1hdGgubWluKHMuZW5kID09IG51bGwgPyBpbnRlcnZhbEVuZCA6IHRvTXMocy5lbmQpLCBpbnRlcnZhbEVuZCk7XG4gICAgaWYgKGNlIDwgY3MpIGNvbnRpbnVlO1xuICAgIGlmICh0ID49IGNzICYmICh0IDwgY2UgfHwgKHQgPT09IGNlICYmIGNlID09PSBpbnRlcnZhbEVuZCkpKSB7XG4gICAgICByZXR1cm4geyBpbmRleDogaSwga2luZDogcy5raW5kLCBzdGFydDogY3MsIGVuZDogY2UgfTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8vIC0tIENhdGVnb3J5IGNvbG9yICguL2NvbG9yLnRzKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB7XG4gIGhhc2hTdHJpbmcsXG4gIGNhdGVnb3J5SHVlLFxuICBjYXRlZ29yeUppdHRlcixcbiAgY2F0ZWdvcnlDb2xvcixcbiAgZGltQ29sb3IsXG4gIGxhYmVsSGFsb0NvbG9yLFxufSBmcm9tICcuL2NvbG9yLnRzJztcbmV4cG9ydCB0eXBlIHsgQ2F0ZWdvcnlDb2xvck9wdGlvbnMgfSBmcm9tICcuL2NvbG9yLnRzJztcblxuLy8gLS0gU3R5bGUgbWFwIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEZpbGwgcGF0dGVybiBmb3IgYW4gaW50ZXJ2YWwgc3RhdGUgLyBzZWdtZW50IGtpbmQuICovXG5leHBvcnQgdHlwZSBTdHlsZVBhdHRlcm4gPSAnc29saWQnIHwgJ2hhdGNoJyB8ICdzdGlwcGxlJyB8ICdvdXRsaW5lJztcblxuLyoqIFJlbmRlcmluZyB0cmVhdG1lbnQgZm9yIG9uZSBpbnRlcnZhbCBgc3RhdGVgIG9yIHNlZ21lbnQgYGtpbmRgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBJbnRlcnZhbFN0eWxlIHtcbiAgcGF0dGVybj86IFN0eWxlUGF0dGVybjtcbiAgLyogKi9cbiAgYWxwaGFTY2FsZT86IG51bWJlcjtcbiAgLyogKi9cbiAgc2F0dXJhdGlvblNjYWxlPzogbnVtYmVyO1xuICAvKiAqL1xuICBsaWdodG5lc3NTY2FsZT86IG51bWJlcjtcbiAgLyoqIEJvcmRlciB0cmVhdG1lbnQ7IGBlbXBoYXNpczogdHJ1ZWAgdXNlcyB0aGUgdGhlbWUgZW1waGFzaXMgY29sb3IuICovXG4gIGJvcmRlcj86IHsgd2lkdGg/OiBudW1iZXI7IGRhc2g/OiBudW1iZXJbXTsgZW1waGFzaXM/OiBib29sZWFuIH07XG4gIC8qKiBDb3JuZXIgZ2x5cGg6ICdiYW5nJyBpcyB0aGUgdW5taXNzYWJsZSBmYWlsdXJlIG1hcmsuICovXG4gIGdseXBoPzogJ25vbmUnIHwgJ2JhbmcnIHwgJ2RvdCc7XG4gIC8qICovXG4gIGRpbW1lZD86IGJvb2xlYW47XG59XG5cbi8qKiBOYW1lZCBzdHlsZSBtYXA6IGludGVydmFsIGBzdGF0ZWAgLyBzZWdtZW50IGBraW5kYCBcdTIxOTIgdHJlYXRtZW50LiAqL1xuZXhwb3J0IHR5cGUgU3R5bGVNYXAgPSBSZWNvcmQ8c3RyaW5nLCBJbnRlcnZhbFN0eWxlPjtcblxuLyogKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1NUWUxFUzogU3R5bGVNYXAgPSB7XG4gICcnOiB7IHBhdHRlcm46ICdzb2xpZCcgfSxcbiAgZW1waGFzaXM6IHsgcGF0dGVybjogJ3N0aXBwbGUnLCBib3JkZXI6IHsgd2lkdGg6IDIsIGVtcGhhc2lzOiB0cnVlIH0sIGdseXBoOiAnYmFuZycgfSxcbiAgZmFpbGVkOiB7IHBhdHRlcm46ICdzdGlwcGxlJywgYm9yZGVyOiB7IHdpZHRoOiAyLCBlbXBoYXNpczogdHJ1ZSB9LCBnbHlwaDogJ2JhbmcnIH0sXG4gIGRpbTogeyBwYXR0ZXJuOiAnc29saWQnLCBkaW1tZWQ6IHRydWUgfSxcbiAgcXVldWVkOiB7IHBhdHRlcm46ICdzb2xpZCcsIGRpbW1lZDogdHJ1ZSB9LFxuICBoYXRjaDogeyBwYXR0ZXJuOiAnaGF0Y2gnLCBkaW1tZWQ6IHRydWUgfSxcbiAgd2FpdGluZzogeyBwYXR0ZXJuOiAnaGF0Y2gnLCBkaW1tZWQ6IHRydWUgfSxcbiAgb3V0bGluZTogeyBwYXR0ZXJuOiAnb3V0bGluZScgfSxcbiAgY2FuY2VsbGVkOiB7IHBhdHRlcm46ICdvdXRsaW5lJywgYm9yZGVyOiB7IHdpZHRoOiAxLjUsIGRhc2g6IFs0LCAzXSB9IH0sXG59O1xuXG4vLyAtLSBDb3ZlcmFnZSAvIGFzeW5jIGhpc3RvcnkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBIGhhbGYtb3Blbi1pc2ggdGltZSByYW5nZSBbc3RhcnQsIGVuZF0gdXNlZCBieSBjb3ZlcmFnZSBib29ra2VlcGluZy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVGltZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbi8qKiBNZXJnZSBvdmVybGFwcGluZy90b3VjaGluZyByYW5nZXMgaW50byBhIHNvcnRlZCBkaXNqb2ludCBsaXN0IChuZXcgYXJyYXkpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlUmFuZ2VzKHJhbmdlczogcmVhZG9ubHkgVGltZVJhbmdlW10pOiBUaW1lUmFuZ2VbXSB7XG4gIGNvbnN0IHNvcnRlZCA9IHJhbmdlc1xuICAgIC5maWx0ZXIoKHIpID0+IHIuZW5kID4gci5zdGFydClcbiAgICAuc2xpY2UoKVxuICAgIC5zb3J0KChhLCBiKSA9PiBhLnN0YXJ0IC0gYi5zdGFydCk7XG4gIGNvbnN0IG91dDogVGltZVJhbmdlW10gPSBbXTtcbiAgZm9yIChjb25zdCByIG9mIHNvcnRlZCkge1xuICAgIGNvbnN0IGxhc3QgPSBvdXRbb3V0Lmxlbmd0aCAtIDFdO1xuICAgIGlmIChsYXN0ICYmIHIuc3RhcnQgPD0gbGFzdC5lbmQpIHtcbiAgICAgIGlmIChyLmVuZCA+IGxhc3QuZW5kKSBsYXN0LmVuZCA9IHIuZW5kO1xuICAgIH0gZWxzZSB7XG4gICAgICBvdXQucHVzaCh7IHN0YXJ0OiByLnN0YXJ0LCBlbmQ6IHIuZW5kIH0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKiogU3VidHJhY3QgYSBzb3J0ZWQgZGlzam9pbnQgY292ZXIgbGlzdCBmcm9tIGBzcGFuYCwgcmV0dXJuaW5nIHRoZSBnYXBzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1YnRyYWN0UmFuZ2VzKHNwYW46IFRpbWVSYW5nZSwgY292ZXJzOiByZWFkb25seSBUaW1lUmFuZ2VbXSk6IFRpbWVSYW5nZVtdIHtcbiAgY29uc3Qgb3V0OiBUaW1lUmFuZ2VbXSA9IFtdO1xuICBsZXQgY3Vyc29yID0gc3Bhbi5zdGFydDtcbiAgZm9yIChjb25zdCBjIG9mIGNvdmVycykge1xuICAgIGlmIChjLmVuZCA8PSBjdXJzb3IpIGNvbnRpbnVlO1xuICAgIGlmIChjLnN0YXJ0ID49IHNwYW4uZW5kKSBicmVhaztcbiAgICBpZiAoYy5zdGFydCA+IGN1cnNvcikgb3V0LnB1c2goeyBzdGFydDogY3Vyc29yLCBlbmQ6IE1hdGgubWluKGMuc3RhcnQsIHNwYW4uZW5kKSB9KTtcbiAgICBjdXJzb3IgPSBNYXRoLm1heChjdXJzb3IsIGMuZW5kKTtcbiAgICBpZiAoY3Vyc29yID49IHNwYW4uZW5kKSBicmVhaztcbiAgfVxuICBpZiAoY3Vyc29yIDwgc3Bhbi5lbmQpIG91dC5wdXNoKHsgc3RhcnQ6IGN1cnNvciwgZW5kOiBzcGFuLmVuZCB9KTtcbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFRoZSByYW5nZSBhIGNvbnN1bWVyIG1heSBhc2sgYGxvYWRSYW5nZWAgYWJvdXQgZm9yIHRoaXMgdmlld3BvcnQ6IHRoZVxuICogdmlzaWJsZSB3aW5kb3cgcGx1cyBhIGxpdHRsZSBiYWNrd2FyZCBwcmVmZXRjaCwgY2xhbXBlZCB0byBgbm93YCBBTkQgdG8gdGhlXG4gKiBjb3ZlcmVkIGVuZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoaXN0b3J5UHJvYmUodmlldzogVGltZVZpZXcsIG5vdzogbnVtYmVyLCBjb3ZlcmVkRW5kOiBudW1iZXIgfCBudWxsLCBwcmVmZXRjaEZyYWMgPSAwLjE1KTogVGltZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IHNwYW4gPSB2aWV3LmVuZCAtIHZpZXcuc3RhcnQ7XG4gIGxldCBlbmQgPSBNYXRoLm1pbih2aWV3LmVuZCwgbm93KTtcbiAgaWYgKGNvdmVyZWRFbmQgIT09IG51bGwgJiYgY292ZXJlZEVuZCA8IGVuZCkgZW5kID0gY292ZXJlZEVuZDtcbiAgY29uc3Qgc3RhcnQgPSB2aWV3LnN0YXJ0IC0gc3BhbiAqIHByZWZldGNoRnJhYztcbiAgcmV0dXJuIGVuZCA+IHN0YXJ0ID8geyBzdGFydCwgZW5kIH0gOiBudWxsO1xufVxuXG4vKiogT3B0aW9ucyBmb3IgQ292ZXJhZ2VUcmFja2VyLiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb3ZlcmFnZU9wdGlvbnMge1xuICAvKiAqL1xuICBtaW5DaHVua01zPzogbnVtYmVyO1xuICAvKiAqL1xuICByZXRyeU1zPzogbnVtYmVyO1xufVxuXG4vKiogQm9va2tlZXBpbmcgZm9yIGBsb2FkUmFuZ2VgLXN0eWxlIGFzeW5jIGhpc3RvcnkgbG9hZGluZy4gVHJhY2tzIHdoaWNoIHRpbWUgcmFuZ2VzIGFyZVxuICogY292ZXJlZCBieSBkYXRhIHRoZSBjb25zdW1lciBoYXMgc3VwcGxpZWQsIHdoaWNoIHJlcXVlc3QgaXMgaW4gZmxpZ2h0IChvbmUgYXQgYSB0aW1lXG4gKiBcdTIwMTQgbm8gcmVxdWVzdCBzdG9ybXMpLCB0aGUgZXhoYXVzdGVkLWhpc3RvcnkgYm91bmRhcnksIGFuZCB0aGUgZml4ZWQgcmV0cnkgY2FkZW5jZVxuICogZm9yIHJlamVjdGVkIGxvYWRzLiBjb25zdCBuZXh0ID0gdHJhY2tlci5uZXh0UmVxdWVzdCh2aWV3LCBub3cpOyAvLyByYW5nZSB0byBmZXRjaCwgb3JcbiAqIG51bGwgLi4uY2FsbCBsb2FkUmFuZ2UobmV4dCkuLi4gLy8gdHJhY2tlciBtYXJrZWQgaXQgaW4gZmxpZ2h0IHRyYWNrZXIuc2V0dGxlKG5leHQsIHtcbiAqIG9rOiB0cnVlIH0pOyAvLyBcdTIxOTIgY292ZXJlZCB0cmFja2VyLnNldHRsZShuZXh0LCB7IG9rOiB0cnVlLCBleGhhdXN0ZWQ6IHRydWUgfSk7IC8vXG4gKiBcdTIxOTIgaGlzdG9yeSBlbmRzIGhlcmUgdHJhY2tlci5zZXR0bGUobmV4dCwgeyBvazogZmFsc2UgfSk7IC8vIFx1MjE5MiByZXRyaWVkIH5yZXRyeU1zXG4gKiBsYXRlciwgZm9yZXZlciAqL1xuZXhwb3J0IGNsYXNzIENvdmVyYWdlVHJhY2tlciB7XG4gIHByaXZhdGUgY292ZXJlZDogVGltZVJhbmdlW10gPSBbXTtcbiAgcHJpdmF0ZSBpbmZsaWdodDogVGltZVJhbmdlIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgbWluQ2h1bms6IG51bWJlcjtcbiAgcHJpdmF0ZSByZXRyeUV2ZXJ5OiBudW1iZXI7XG4gIHByaXZhdGUgcmV0cnlBdCA9IC1JbmZpbml0eTtcbiAgLyoqIFRpbWUgYmVmb3JlIHdoaWNoIGhpc3RvcnkgaXMga25vd24gZXhoYXVzdGVkIChudWxsID0gdW5rbm93bikuICovXG4gIGV4aGF1c3RlZEJlZm9yZTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3Iob3B0czogQ292ZXJhZ2VPcHRpb25zID0ge30pIHtcbiAgICB0aGlzLm1pbkNodW5rID0gb3B0cy5taW5DaHVua01zID8/IDYwXzAwMDtcbiAgICB0aGlzLnJldHJ5RXZlcnkgPSBvcHRzLnJldHJ5TXMgPz8gMl8wMDA7XG4gIH1cblxuICAvKiogTWFyayBbc3RhcnQsIGVuZF0gYXMgY292ZXJlZCBieSBjb25zdW1lci1zdXBwbGllZCBkYXRhLiAqL1xuICBhZGRDb3ZlcmVkKHN0YXJ0OiBudW1iZXIsIGVuZDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKCEoZW5kID4gc3RhcnQpKSByZXR1cm47XG4gICAgdGhpcy5jb3ZlcmVkID0gbWVyZ2VSYW5nZXMoWy4uLnRoaXMuY292ZXJlZCwgeyBzdGFydCwgZW5kIH1dKTtcbiAgfVxuXG4gIC8qKiBTb3J0ZWQgZGlzam9pbnQgY292ZXJlZCByYW5nZXMgKGxpdmUgcmVmZXJlbmNlIFx1MjAxNCBkbyBub3QgbXV0YXRlKS4gKi9cbiAgY292ZXJlZFJhbmdlcygpOiByZWFkb25seSBUaW1lUmFuZ2VbXSB7XG4gICAgcmV0dXJuIHRoaXMuY292ZXJlZDtcbiAgfVxuXG4gIC8qKiBFbmQgb2YgdGhlIG5ld2VzdCBjb3ZlcmVkIHJhbmdlIChudWxsIHdoaWxlIG5vdGhpbmcgaXMgY292ZXJlZCkuICovXG4gIGNvdmVyZWRFbmQoKTogbnVtYmVyIHwgbnVsbCB7XG4gICAgY29uc3QgbGFzdCA9IHRoaXMuY292ZXJlZFt0aGlzLmNvdmVyZWQubGVuZ3RoIC0gMV07XG4gICAgcmV0dXJuIGxhc3QgPyBsYXN0LmVuZCA6IG51bGw7XG4gIH1cblxuICAvKiogVGhlIGluLWZsaWdodCByZXF1ZXN0LCBpZiBhbnkuICovXG4gIHBlbmRpbmcoKTogVGltZVJhbmdlIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMuaW5mbGlnaHQ7XG4gIH1cblxuICAvKiogVHJ1ZSB3aGlsZSBhIGZhaWxlZCBsb2FkIGlzIHdhaXRpbmcgb3V0IHRoZSBmaXhlZCByZXRyeSBjYWRlbmNlIChub3RoaW5nXG4gICAqIGluIGZsaWdodCwgbmV4dCBhdHRlbXB0IHNjaGVkdWxlZCkuICovXG4gIHdhaXRpbmdSZXRyeShub3c6IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLmluZmxpZ2h0ID09PSBudWxsICYmIG5vdyA8IHRoaXMucmV0cnlBdDtcbiAgfVxuXG4gIC8qKlxuICAgKiBVbmNvdmVyZWQgZ2FwcyB3aXRoaW4gYHNwYW5gIHRoYXQgY291bGQgc3RpbGwgaG9sZCBkYXRhIChnYXBzIGVudGlyZWx5XG4gICAqIGJlZm9yZSB0aGUgZXhoYXVzdGVkIGJvdW5kYXJ5IGFyZSBkcm9wcGVkOyBhIGdhcCBzdHJhZGRsaW5nIGl0IGlzXG4gICAqIGNsaXBwZWQpLiBVc2UgZm9yIHBhaW50aW5nIHRoZSBsb2FkaW5nIC8gdW5jb3ZlcmVkIGFmZm9yZGFuY2UuXG4gICAqL1xuICB1bmNvdmVyZWRJbihzcGFuOiBUaW1lUmFuZ2UpOiBUaW1lUmFuZ2VbXSB7XG4gICAgbGV0IGdhcHMgPSBzdWJ0cmFjdFJhbmdlcyhzcGFuLCB0aGlzLmNvdmVyZWQpO1xuICAgIGNvbnN0IGV4ID0gdGhpcy5leGhhdXN0ZWRCZWZvcmU7XG4gICAgaWYgKGV4ICE9IG51bGwpIHtcbiAgICAgIGdhcHMgPSBnYXBzLmZpbHRlcigoZykgPT4gZy5lbmQgPiBleCkubWFwKChnKSA9PiAoZy5zdGFydCA8IGV4ID8geyBzdGFydDogZXgsIGVuZDogZy5lbmQgfSA6IGcpKTtcbiAgICB9XG4gICAgcmV0dXJuIGdhcHM7XG4gIH1cblxuICAvKipcbiAgICogVGhlIG5leHQgcmFuZ2UgdG8gZmV0Y2ggZm9yIHRoZSBnaXZlbiB2aWV3cG9ydCwgb3IgbnVsbCAoZnVsbHkgY292ZXJlZCxcbiAgICogYSByZXF1ZXN0IGlzIGFscmVhZHkgaW4gZmxpZ2h0LCB3YWl0aW5nIG91dCB0aGUgcmV0cnkgY2FkZW5jZSBhZnRlciBhXG4gICAqIGZhaWx1cmUsIG9yIGhpc3RvcnkgaXMgZXhoYXVzdGVkKS4gVGhlIHJldHVybmVkIHJhbmdlIGlzIG1hcmtlZCBpblxuICAgKiBmbGlnaHQgXHUyMDE0IHBhc3MgaXQgdG8gc2V0dGxlKCkgd2hlbiB0aGUgbG9hZCByZXNvbHZlcyBvciByZWplY3RzLlxuICAgKiBSZXF1ZXN0cyBhcmUgd2lkZW5lZCB0byBtaW5DaHVua01zIChleHRlbmRpbmcgaW50byB0aGUgcGFzdCkgc28gdGlueVxuICAgKiBzY3JvbGwgc3RlcHMgZG9uJ3Qgc3ByYXkgdGlueSByZXF1ZXN0cy5cbiAgICovXG4gIG5leHRSZXF1ZXN0KHZpZXc6IFRpbWVWaWV3LCBub3c6IG51bWJlcik6IFRpbWVSYW5nZSB8IG51bGwge1xuICAgIGlmICh0aGlzLmluZmxpZ2h0IHx8IG5vdyA8IHRoaXMucmV0cnlBdCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZ2FwcyA9IHRoaXMudW5jb3ZlcmVkSW4oeyBzdGFydDogdmlldy5zdGFydCwgZW5kOiB2aWV3LmVuZCB9KTtcbiAgICBpZiAoZ2Fwcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGdhcCA9IGdhcHNbZ2Fwcy5sZW5ndGggLSAxXTsgLy8gbmV3ZXN0IGdhcCBmaXJzdCBcdTIwMTQgZmlsbCB0b3dhcmQgdGhlIHBhc3RcbiAgICBjb25zdCByZXE6IFRpbWVSYW5nZSA9IHsgc3RhcnQ6IGdhcC5zdGFydCwgZW5kOiBnYXAuZW5kIH07XG4gICAgaWYgKHJlcS5lbmQgLSByZXEuc3RhcnQgPCB0aGlzLm1pbkNodW5rKSByZXEuc3RhcnQgPSByZXEuZW5kIC0gdGhpcy5taW5DaHVuaztcbiAgICBjb25zdCBleCA9IHRoaXMuZXhoYXVzdGVkQmVmb3JlO1xuICAgIGlmIChleCAhPSBudWxsICYmIHJlcS5zdGFydCA8IGV4KSByZXEuc3RhcnQgPSBleDtcbiAgICBpZiAoIShyZXEuZW5kID4gcmVxLnN0YXJ0KSkgcmV0dXJuIG51bGw7XG4gICAgdGhpcy5pbmZsaWdodCA9IHJlcTtcbiAgICByZXR1cm4gcmVxO1xuICB9XG5cbiAgLyoqIFJlc29sdmUvcmVqZWN0IHRoZSBpbi1mbGlnaHQgcmVxdWVzdCAobm8tb3AgZm9yIGEgc3RhbGUgcmFuZ2UpLiAqL1xuICBzZXR0bGUocmFuZ2U6IFRpbWVSYW5nZSwgcmVzdWx0OiB7IG9rOiBib29sZWFuOyBleGhhdXN0ZWQ/OiBib29sZWFuIH0sIG5vdyA9IDApOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuaW5mbGlnaHQgfHwgdGhpcy5pbmZsaWdodC5zdGFydCAhPT0gcmFuZ2Uuc3RhcnQgfHwgdGhpcy5pbmZsaWdodC5lbmQgIT09IHJhbmdlLmVuZCkgcmV0dXJuO1xuICAgIHRoaXMuaW5mbGlnaHQgPSBudWxsO1xuICAgIGlmICghcmVzdWx0Lm9rKSB7XG4gICAgICAvLyBGaXhlZCBjYWRlbmNlLCBmb3JldmVyOiB0aGUgbmV4dCBhdHRlbXB0IGlzIGFsd2F5cyBleGFjdGx5IHJldHJ5RXZlcnkgYXdheSBcdTIwMTQgbm8gZ3Jvd3RoLCBubyBhdHRlbXB0IGNhcC5cbiAgICAgIHRoaXMucmV0cnlBdCA9IG5vdyArIHRoaXMucmV0cnlFdmVyeTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5yZXRyeUF0ID0gLUluZmluaXR5O1xuICAgIHRoaXMuYWRkQ292ZXJlZChyYW5nZS5zdGFydCwgcmFuZ2UuZW5kKTtcbiAgICBpZiAocmVzdWx0LmV4aGF1c3RlZCkge1xuICAgICAgY29uc3QgZmlyc3QgPSB0aGlzLmNvdmVyZWRbMF07XG4gICAgICB0aGlzLmV4aGF1c3RlZEJlZm9yZSA9IGZpcnN0ID8gZmlyc3Quc3RhcnQgOiByYW5nZS5zdGFydDtcbiAgICB9XG4gIH1cbn1cblxuLy8gLS0gUmVuZGVyIHBhY2luZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFJlbmRlciB0aWVyczogZnVsbCByYXRlIHdoaWxlIGludGVyYWN0aW5nLCB0aHJvdHRsZWQgaWRsZSwgY2hlYXBlciBzdGlsbCBvbiBiYXR0ZXJ5LiAqL1xuZXhwb3J0IHR5cGUgUmVuZGVyVGllciA9ICdpbnRlcmFjdGl2ZScgfCAnaWRsZScgfCAnaWRsZS1iYXR0ZXJ5JztcblxuLyoqIElkbGUgZnJhbWUgYnVkZ2V0OiB+MzBmcHMgd2hpbGUgbm90aGluZyBpcyBiZWluZyBpbnRlcmFjdGVkIHdpdGguICovXG5leHBvcnQgY29uc3QgSURMRV9GUkFNRV9NUyA9IDEwMDAgLyAzMDtcbi8qKiBJZGxlLW9uLWJhdHRlcnkgZnJhbWUgYnVkZ2V0OiB+MTBmcHMuICovXG5leHBvcnQgY29uc3QgSURMRV9CQVRURVJZX0ZSQU1FX01TID0gMTAwO1xuLyoqIEZ1bGwtcmF0ZSBncmFjZSB3aW5kb3cgYWZ0ZXIgdGhlIGxhc3QgaW5wdXQgXHUyMDE0IGludGVyYWN0aW9uIG5ldmVyIGZlZWxzIHRocm90dGxlZC4gKi9cbmV4cG9ydCBjb25zdCBJTlRFUkFDVF9HUkFDRV9NUyA9IDUwMDtcblxuLyogKi9cbmV4cG9ydCBmdW5jdGlvbiBmcmFtZUJ1ZGdldE1zKHRpZXI6IFJlbmRlclRpZXIpOiBudW1iZXIge1xuICBpZiAodGllciA9PT0gJ2lkbGUnKSByZXR1cm4gSURMRV9GUkFNRV9NUztcbiAgaWYgKHRpZXIgPT09ICdpZGxlLWJhdHRlcnknKSByZXR1cm4gSURMRV9CQVRURVJZX0ZSQU1FX01TO1xuICByZXR1cm4gMDtcbn1cblxuLyoqIEZyYW1lIGdhdGUgZm9yIGEgckFGIGxvb3A6IHJlbmRlciB3aGVuIHRoZSB0aWVyJ3MgYnVkZ2V0IGhhcyBlbGFwc2VkIHNpbmNlXG4gKiB0aGUgbGFzdCBSRU5ERVJFRCBmcmFtZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaG91bGRSZW5kZXIobm93VHM6IG51bWJlciwgbGFzdFJlbmRlclRzOiBudW1iZXIsIGJ1ZGdldE1zOiBudW1iZXIsIHJhZkludGVydmFsTXMgPSAxNi43KTogYm9vbGVhbiB7XG4gIGlmIChidWRnZXRNcyA8PSAwKSByZXR1cm4gdHJ1ZTtcbiAgcmV0dXJuIG5vd1RzIC0gbGFzdFJlbmRlclRzID49IGJ1ZGdldE1zIC0gcmFmSW50ZXJ2YWxNcyAvIDI7XG59XG5cbi8qKiBEcmF3IGJ1ZGdldCAobXMgcGVyIHJlbmRlcmVkIGZyYW1lKSB3aGlsZSB0aGUgT05MWSBtb3Rpb24gb24gc2NyZWVuIGlzXG4gKiBDTE9DSy1kcml2ZW4gXHUyMDE0IHRoZSBmb2xsb3ctbm93IHNjcm9sbCBhbmQgb25nb2luZy1iYXIgZ3Jvd3RoLiBUaGUgc2NlbmVcbiAqIHRoZW4gdHJhbnNsYXRlcyBleGFjdGx5IG9uZSB3aG9sZSBERVZJQ0UgcGl4ZWwgcGVyIHNwYW4gLyAocGxvdFdpZHRoQ3NzICpcbiAqIGRwcikgbXMsIHNvIHJlZHJhd2luZyBhbnkgZmFzdGVyIHByb2R1Y2VzIHBpeGVsLWlkZW50aWNhbCBmcmFtZXMuICovXG5leHBvcnQgZnVuY3Rpb24gY2xvY2tEcmF3QnVkZ2V0TXModmlldzogVGltZVZpZXcsIHBsb3RXaWR0aENzczogbnVtYmVyLCBkcHI6IG51bWJlciwgdGllckJ1ZGdldE1zOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCBzcGFuID0gdmlldy5lbmQgLSB2aWV3LnN0YXJ0O1xuICBjb25zdCB3RGV2ID0gcGxvdFdpZHRoQ3NzICogZHByO1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShzcGFuKSB8fCBzcGFuIDw9IDAgfHwgIU51bWJlci5pc0Zpbml0ZSh3RGV2KSB8fCB3RGV2IDw9IDApIHJldHVybiB0aWVyQnVkZ2V0TXM7XG4gIHJldHVybiBNYXRoLm1heCh0aWVyQnVkZ2V0TXMsIHNwYW4gLyB3RGV2KTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFFQSxTQUFTLFlBQVk7QUFDckIsT0FBTyxZQUFZOzs7QUNTWixTQUFTLGNBQWMsR0FBWSxNQUF1QjtBQUMvRCxNQUFJLEVBQUUsS0FBSyxLQUFNLFFBQU87QUFDeEIsUUFBTSxLQUFLLEVBQUUsSUFBSSxFQUFFLElBQUk7QUFDdkIsU0FBTyxFQUFFLEdBQUcsS0FBSyxPQUFPLEdBQUcsR0FBRyxFQUFFLEdBQUcsR0FBRyxNQUFNLEdBQUcsRUFBRSxFQUFFO0FBQ3JEO0FBR08sU0FBUyxhQUFhLEdBQVcsR0FBVyxPQUFtQztBQUNwRixXQUFTLElBQUksTUFBTSxTQUFTLEdBQUcsS0FBSyxHQUFHLEtBQUs7QUFDMUMsVUFBTSxJQUFJLE1BQU0sQ0FBQztBQUNqQixRQUFJLEtBQUssRUFBRSxLQUFLLEtBQUssRUFBRSxJQUFJLEVBQUUsS0FBSyxLQUFLLEVBQUUsS0FBSyxLQUFLLEVBQUUsSUFBSSxFQUFFLEVBQUcsUUFBTztBQUFBLEVBQ3ZFO0FBQ0EsU0FBTztBQUNUO0FBR08sU0FBUyxnQkFBZ0IsSUFBWSxJQUFZLElBQVksSUFBWSxJQUFZLElBQW9CO0FBQzlHLFFBQU0sS0FBSyxLQUFLO0FBQ2hCLFFBQU0sS0FBSyxLQUFLO0FBQ2hCLFFBQU0sT0FBTyxLQUFLLEtBQUssS0FBSztBQUM1QixNQUFJLElBQUksT0FBTyxNQUFNLEtBQUssTUFBTSxNQUFNLEtBQUssTUFBTSxNQUFNLE9BQU87QUFDOUQsTUFBSSxJQUFJLEVBQUcsS0FBSTtBQUFBLFdBQ04sSUFBSSxFQUFHLEtBQUk7QUFDcEIsUUFBTSxLQUFLLEtBQUssSUFBSSxLQUFLO0FBQ3pCLFFBQU0sS0FBSyxLQUFLLElBQUksS0FBSztBQUN6QixTQUFPLEtBQUssS0FBSyxLQUFLO0FBQ3hCO0FBR08sU0FBUyxnQkFBZ0IsSUFBWSxJQUFZLEtBQTBDLEtBQXNCO0FBQ3RILFFBQU0sS0FBSyxNQUFNO0FBQ2pCLFdBQVMsSUFBSSxHQUFHLElBQUksSUFBSSxRQUFRLEtBQUs7QUFDbkMsUUFBSSxnQkFBZ0IsSUFBSSxJQUFJLElBQUksSUFBSSxDQUFDLEVBQUUsR0FBRyxJQUFJLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLEVBQUUsR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDLEtBQUssR0FBSSxRQUFPO0FBQUEsRUFDNUY7QUFDQSxTQUFPO0FBQ1Q7OztBQzVDTyxTQUFTLFdBQVcsR0FBbUI7QUFDNUMsTUFBSSxJQUFJO0FBQ1IsV0FBUyxJQUFJLEdBQUcsSUFBSSxFQUFFLFFBQVEsS0FBSztBQUNqQyxTQUFLLEVBQUUsV0FBVyxDQUFDO0FBQ25CLFFBQUksS0FBSyxLQUFLLEdBQUcsUUFBVTtBQUFBLEVBQzdCO0FBQ0EsU0FBTyxNQUFNO0FBQ2Y7QUFHTyxTQUFTLFlBQVksVUFBMEI7QUFDcEQsUUFBTSxJQUFLLFdBQVcsUUFBUSxJQUFJLGdCQUFpQjtBQUNuRCxTQUFPLEtBQUssTUFBTSxJQUFJLEdBQUc7QUFDM0I7QUFHQSxJQUFNLFlBQVksR0FBRyxPQUFPLGFBQWEsQ0FBQyxDQUFDO0FBR3BDLFNBQVMsZUFBZSxVQUE4QztBQUMzRSxRQUFNLElBQUksV0FBVyxXQUFXLFNBQVM7QUFDekMsU0FBTztBQUFBLElBQ0wsTUFBTSxJQUFJLE9BQVEsTUFBTSxPQUFPO0FBQUEsSUFDL0IsTUFBTyxNQUFNLElBQUssT0FBUSxNQUFNLE9BQU87QUFBQSxFQUN6QztBQUNGO0FBbUJPLFNBQVMsY0FBYyxLQUFhLE9BQTZCLENBQUMsR0FBVztBQUNsRixRQUFNLElBQUksS0FBSyxhQUFhO0FBQzVCLFFBQU0sSUFBSSxLQUFLLFVBQVU7QUFDekIsUUFBTSxJQUFJLEtBQUssU0FBUztBQUN4QixNQUFJLEtBQUssU0FBUyxPQUFPO0FBQ3ZCLFVBQU0sSUFBSSxLQUFLLE1BQU0sS0FBSyxJQUFJLEdBQUcsSUFBSSxJQUFJLElBQUksR0FBRztBQUNoRCxVQUFNLEtBQUssS0FBSyxNQUFNLElBQUksRUFBRTtBQUM1QixXQUFPLEtBQUssSUFBSSxPQUFPLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLFFBQVEsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLE1BQU0sT0FBTyxDQUFDLENBQUM7QUFBQSxFQUN6RjtBQUNBLFNBQU8sS0FBSyxJQUFJLFNBQVMsT0FBTyxDQUFDLENBQUMsSUFBSSxPQUFPLENBQUMsQ0FBQyxJQUFJLEdBQUcsTUFBTSxTQUFTLE9BQU8sQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLENBQUMsSUFBSSxHQUFHLE1BQU0sT0FBTyxDQUFDLENBQUM7QUFDbkg7QUFFQSxTQUFTLE9BQU8sR0FBbUI7QUFDakMsU0FBTyxLQUFLLE1BQU0sSUFBSSxHQUFJLElBQUk7QUFDaEM7QUFLQSxTQUFTLFdBQVcsT0FBc0U7QUFDeEYsUUFBTSxJQUFJLE1BQU0sS0FBSztBQUNyQixNQUFJLEVBQUUsV0FBVyxHQUFHLEdBQUc7QUFDckIsVUFBTSxNQUFNLEVBQUUsTUFBTSxDQUFDO0FBQ3JCLFVBQU0sSUFBSSxJQUFJO0FBQ2QsUUFBSSxNQUFNLEtBQUssTUFBTSxHQUFHO0FBQ3RCLFlBQU0sSUFBSSxJQUFJLE1BQU0sRUFBRSxFQUFFLElBQUksQ0FBQyxPQUFPLFNBQVMsS0FBSyxJQUFJLEVBQUUsQ0FBQztBQUN6RCxVQUFJLEVBQUUsS0FBSyxPQUFPLEtBQUssRUFBRyxRQUFPO0FBQ2pDLGFBQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHLE1BQU0sSUFBSSxFQUFFLENBQUMsSUFBSSxNQUFNLEVBQUU7QUFBQSxJQUNsRTtBQUNBLFFBQUksTUFBTSxLQUFLLE1BQU0sR0FBRztBQUN0QixZQUFNLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDLEVBQUUsTUFBTSxHQUFHLElBQUksQ0FBQyxFQUFFLElBQUksQ0FBQyxNQUFNLFNBQVMsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBQ25GLFVBQUksRUFBRSxLQUFLLE9BQU8sS0FBSyxFQUFHLFFBQU87QUFDakMsYUFBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsTUFBTSxJQUFJLEVBQUUsQ0FBQyxJQUFJLE1BQU0sRUFBRTtBQUFBLElBQ2xFO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFDQSxRQUFNLEtBQUssRUFBRSxNQUFNLG1DQUFtQztBQUN0RCxNQUFJLENBQUMsR0FBSSxRQUFPO0FBQ2hCLFFBQU0sT0FBTyxHQUFHLENBQUMsRUFBRSxZQUFZO0FBQy9CLFFBQU0sUUFBUSxHQUFHLENBQUMsRUFBRSxNQUFNLFNBQVMsRUFBRSxPQUFPLENBQUMsTUFBTSxNQUFNLEVBQUU7QUFDM0QsTUFBSSxNQUFNLFNBQVMsRUFBRyxRQUFPO0FBQzdCLFFBQU0sTUFBTSxDQUFDQSxPQUFzQixXQUFXQSxFQUFDO0FBQy9DLFFBQU0sUUFBUSxNQUFNLFVBQVUsSUFBSyxNQUFNLENBQUMsRUFBRSxTQUFTLEdBQUcsSUFBSSxJQUFJLE1BQU0sQ0FBQyxDQUFDLElBQUksTUFBTSxJQUFJLE1BQU0sQ0FBQyxDQUFDLElBQUs7QUFDbkcsTUFBSSxPQUFPLE1BQU0sS0FBSyxFQUFHLFFBQU87QUFDaEMsTUFBSSxLQUFLLFdBQVcsS0FBSyxHQUFHO0FBQzFCLFVBQU0sQ0FBQyxHQUFHLEdBQUcsQ0FBQyxJQUFJLE1BQU0sSUFBSSxHQUFHO0FBQy9CLFFBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLEtBQUssT0FBTyxLQUFLLEVBQUcsUUFBTztBQUN6QyxXQUFPLEVBQUUsR0FBRyxHQUFHLEdBQUcsR0FBRyxNQUFNO0FBQUEsRUFDN0I7QUFDQSxNQUFJLEtBQUssV0FBVyxLQUFLLEdBQUc7QUFDMUIsVUFBTSxJQUFJLElBQUksTUFBTSxDQUFDLENBQUM7QUFDdEIsVUFBTUEsS0FBSSxJQUFJLE1BQU0sQ0FBQyxDQUFDLElBQUk7QUFDMUIsVUFBTUMsS0FBSSxJQUFJLE1BQU0sQ0FBQyxDQUFDLElBQUk7QUFDMUIsUUFBSSxDQUFDLEdBQUdELElBQUdDLEVBQUMsRUFBRSxLQUFLLE9BQU8sS0FBSyxFQUFHLFFBQU87QUFDekMsVUFBTSxJQUFJLENBQUMsTUFBc0I7QUFDL0IsWUFBTSxNQUFNLElBQUksSUFBSSxNQUFNO0FBQzFCLGFBQU9BLEtBQUlELEtBQUksS0FBSyxJQUFJQyxJQUFHLElBQUlBLEVBQUMsSUFBSSxLQUFLLElBQUksSUFBSSxLQUFLLElBQUksS0FBSyxHQUFHLElBQUksSUFBSSxDQUFDLENBQUM7QUFBQSxJQUM5RTtBQUNBLFdBQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFJLEtBQUssR0FBRyxFQUFFLENBQUMsSUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFDLElBQUksS0FBSyxHQUFHLE1BQU07QUFBQSxFQUNqRTtBQUVBLFFBQU0sSUFBSSxJQUFJLE1BQU0sQ0FBQyxDQUFDO0FBQ3RCLFFBQU0sSUFBSSxJQUFJLE1BQU0sQ0FBQyxDQUFDO0FBQ3RCLFFBQU0sSUFBSSxJQUFJLE1BQU0sQ0FBQyxDQUFDO0FBQ3RCLE1BQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLEtBQUssT0FBTyxLQUFLLEVBQUcsUUFBTztBQUN6QyxRQUFNLEtBQU0sSUFBSSxLQUFLLEtBQU07QUFDM0IsUUFBTSxLQUFLLElBQUksS0FBSyxJQUFJLEVBQUU7QUFDMUIsUUFBTSxLQUFLLElBQUksS0FBSyxJQUFJLEVBQUU7QUFDMUIsUUFBTSxLQUFLLElBQUksZUFBZSxLQUFLLGVBQWU7QUFDbEQsUUFBTSxLQUFLLElBQUksZUFBZSxLQUFLLGVBQWU7QUFDbEQsUUFBTSxLQUFLLElBQUksZUFBZSxLQUFLLGNBQWM7QUFDakQsUUFBTSxJQUFJLEtBQUssS0FBSztBQUNwQixRQUFNLElBQUksS0FBSyxLQUFLO0FBQ3BCLFFBQU0sSUFBSSxLQUFLLEtBQUs7QUFDcEIsUUFBTSxNQUFNO0FBQUEsSUFDVixlQUFlLElBQUksZUFBZSxJQUFJLGVBQWU7QUFBQSxJQUNyRCxnQkFBZ0IsSUFBSSxlQUFlLElBQUksZUFBZTtBQUFBLElBQ3RELGdCQUFnQixJQUFJLGVBQWUsSUFBSSxjQUFlO0FBQUEsRUFDeEQsRUFBRSxJQUFJLENBQUMsT0FBTztBQUNaLFVBQU0sS0FBSyxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksR0FBRyxFQUFFLENBQUM7QUFDdEMsWUFBUSxNQUFNLFdBQVksUUFBUSxLQUFLLFFBQVEsS0FBSyxJQUFJLElBQUksSUFBSSxHQUFHLElBQUksU0FBUztBQUFBLEVBQ2xGLENBQUM7QUFDRCxTQUFPLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsR0FBRyxNQUFNO0FBQ3JEO0FBT08sU0FBUyxTQUFTLE9BQXVCO0FBQzlDLFFBQU0sSUFBSSxXQUFXLEtBQUs7QUFDMUIsTUFBSSxDQUFDLEVBQUcsUUFBTztBQUNmLFFBQU0sSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksS0FBSyxFQUFFLENBQUMsQ0FBQyxJQUFJO0FBQzVDLFFBQU0sSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksS0FBSyxFQUFFLENBQUMsQ0FBQyxJQUFJO0FBQzVDLFFBQU0sSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksS0FBSyxFQUFFLENBQUMsQ0FBQyxJQUFJO0FBQzVDLFFBQU0sSUFBSSxLQUFLLElBQUksR0FBRyxHQUFHLENBQUM7QUFDMUIsUUFBTSxJQUFJLElBQUksS0FBSyxJQUFJLEdBQUcsR0FBRyxDQUFDO0FBQzlCLFFBQU0sTUFBTSxNQUFNLElBQUksSUFBSSxJQUFJO0FBQzlCLE1BQUksSUFBSTtBQUNSLE1BQUksTUFBTSxHQUFHO0FBQ1gsUUFBSSxNQUFNLEVBQUcsTUFBTSxJQUFJLEtBQUssSUFBSztBQUFBLGFBQ3hCLE1BQU0sRUFBRyxNQUFLLElBQUksS0FBSyxJQUFJO0FBQUEsUUFDL0IsTUFBSyxJQUFJLEtBQUssSUFBSTtBQUN2QixTQUFLLElBQUksS0FBSztBQUFBLEVBQ2hCO0FBQ0EsUUFBTSxLQUFLLE1BQU07QUFDakIsUUFBTSxLQUFLLElBQUk7QUFDZixRQUFNLEtBQUssS0FBSztBQUNoQixRQUFNLElBQUksTUFBTSxJQUFJLEtBQUssSUFBSyxJQUFJLElBQUssQ0FBQztBQUN4QyxRQUFNLEtBQUssS0FBSztBQUNoQixRQUFNLFNBQVMsS0FBSyxNQUFNLENBQUMsSUFBSTtBQUMvQixRQUFNLE9BQU87QUFBQSxJQUNYLENBQUMsSUFBSSxHQUFHLENBQUM7QUFBQSxJQUNULENBQUMsR0FBRyxJQUFJLENBQUM7QUFBQSxJQUNULENBQUMsR0FBRyxJQUFJLENBQUM7QUFBQSxJQUNULENBQUMsR0FBRyxHQUFHLEVBQUU7QUFBQSxJQUNULENBQUMsR0FBRyxHQUFHLEVBQUU7QUFBQSxJQUNULENBQUMsSUFBSSxHQUFHLENBQUM7QUFBQSxFQUNYLEVBQUUsTUFBTTtBQUNSLFFBQU0sTUFBTSxLQUFLLElBQUksQ0FBQyxPQUFPLEtBQUssT0FBTyxLQUFLLE1BQU0sR0FBRyxDQUFDO0FBQ3hELFNBQU8sUUFBUSxJQUFJLENBQUMsQ0FBQyxLQUFLLElBQUksQ0FBQyxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUMsS0FBSyxPQUFPLEVBQUUsQ0FBQyxDQUFDO0FBQzdEO0FBS0EsU0FBUyxrQkFBa0IsR0FBVyxHQUFXLEdBQW1CO0FBQ2xFLFFBQU0sTUFBTSxDQUFDLE9BQXVCO0FBQ2xDLFVBQU0sSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksS0FBSyxFQUFFLENBQUMsSUFBSTtBQUMzQyxXQUFPLEtBQUssVUFBVSxJQUFJLFFBQVEsS0FBSyxLQUFLLElBQUksU0FBUyxPQUFPLEdBQUc7QUFBQSxFQUNyRTtBQUNBLFNBQU8sU0FBUyxJQUFJLENBQUMsSUFBSSxTQUFTLElBQUksQ0FBQyxJQUFJLFNBQVMsSUFBSSxDQUFDO0FBQzNEO0FBS08sU0FBUyxlQUFlLElBQW9CO0FBQ2pELFFBQU0sSUFBSSxXQUFXLEVBQUU7QUFDdkIsUUFBTSxPQUFPLENBQUMsS0FBSyxrQkFBa0IsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLENBQUMsS0FBSyxLQUFLLEtBQUssT0FBTyxJQUFJLElBQUk7QUFDaEYsU0FBTyxPQUFPLHdCQUF3QjtBQUN4Qzs7O0FDdEhPLFNBQVMsS0FBSyxHQUEwQjtBQUM3QyxTQUFPLE9BQU8sTUFBTSxXQUFXLElBQUksRUFBRSxRQUFRO0FBQy9DO0FBV08sSUFBTSxjQUFjO0FBQ3BCLElBQU0sY0FBYyxJQUFJO0FBR3hCLElBQU0sc0JBQXNCO0FBR25DLElBQU0sMEJBQTBCLEtBQUs7QUFHOUIsU0FBUyxxQkFBcUIsT0FBZSxPQUFlLFlBQVkscUJBQTZCO0FBQzFHLE1BQUksT0FBTztBQUNYLE1BQUksT0FBTyxTQUFTLEtBQUssS0FBSyxRQUFRLEtBQUssT0FBTyxTQUFTLEtBQUssS0FBSyxRQUFRLEdBQUc7QUFDOUUsV0FBUSxhQUFhLFFBQVEsU0FBVTtBQUFBLEVBQ3pDO0FBQ0EsU0FBTyxLQUFLLElBQUksYUFBYSxLQUFLLElBQUksYUFBYSxJQUFJLENBQUM7QUFDMUQ7QUFHTyxTQUFTLFFBQVEsR0FBVyxNQUFnQixPQUF1QjtBQUN4RSxVQUFTLElBQUksS0FBSyxVQUFVLEtBQUssTUFBTSxLQUFLLFNBQVU7QUFDeEQ7QUFHTyxTQUFTLFFBQVEsR0FBVyxNQUFnQixPQUF1QjtBQUN4RSxTQUFPLEtBQUssUUFBUyxJQUFJLFNBQVUsS0FBSyxNQUFNLEtBQUs7QUFDckQ7QUFHTyxTQUFTLFFBQVEsTUFBZ0IsSUFBc0I7QUFDNUQsU0FBTyxFQUFFLE9BQU8sS0FBSyxRQUFRLElBQUksS0FBSyxLQUFLLE1BQU0sR0FBRztBQUN0RDtBQUlPLFNBQVMsZUFBZSxNQUFnQixLQUF1QjtBQUNwRSxNQUFJLEtBQUssT0FBTyxJQUFLLFFBQU87QUFDNUIsU0FBTyxFQUFFLE9BQU8sT0FBTyxLQUFLLE1BQU0sS0FBSyxRQUFRLEtBQUssSUFBSTtBQUMxRDtBQWlCTyxTQUFTLGtCQUFrQixNQUFnQixRQUE4QjtBQUM5RSxRQUFNLE1BQU0sT0FBTyxRQUFRLFFBQVEsT0FBTyxTQUFTLE9BQU8sR0FBRyxJQUFJLE9BQU8sTUFBTTtBQUM5RSxRQUFNLE1BQU0sT0FBTyxRQUFRLFFBQVEsT0FBTyxTQUFTLE9BQU8sR0FBRyxJQUFJLE9BQU8sTUFBTTtBQUM5RSxNQUFJLFFBQVEsUUFBUSxRQUFRLEtBQU0sUUFBTztBQUN6QyxRQUFNLE9BQU8sS0FBSyxNQUFNLEtBQUs7QUFDN0IsTUFBSSxRQUFRLFFBQVEsUUFBUSxRQUFRLE1BQU0sT0FBTyxLQUFNLFFBQU8sRUFBRSxPQUFPLEtBQUssS0FBSyxJQUFJO0FBQ3JGLE1BQUksTUFBTTtBQUNWLE1BQUksUUFBUSxRQUFRLElBQUksTUFBTSxJQUFLLE9BQU0sRUFBRSxPQUFPLE1BQU0sTUFBTSxLQUFLLElBQUk7QUFDdkUsTUFBSSxRQUFRLFFBQVEsSUFBSSxRQUFRLElBQUssT0FBTSxFQUFFLE9BQU8sS0FBSyxLQUFLLE1BQU0sS0FBSztBQUN6RSxTQUFPO0FBQ1Q7QUFJTyxTQUFTLGVBQWUsUUFBb0IsVUFBVSxhQUFhLFVBQVUsYUFBcUI7QUFDdkcsUUFBTSxFQUFFLEtBQUssSUFBSSxJQUFJO0FBQ3JCLE1BQUksUUFBUSxRQUFRLFFBQVEsUUFBUSxDQUFDLE9BQU8sU0FBUyxHQUFHLEtBQUssQ0FBQyxPQUFPLFNBQVMsR0FBRyxFQUFHLFFBQU87QUFDM0YsU0FBTyxLQUFLLElBQUksU0FBUyxLQUFLLElBQUksU0FBUyxNQUFNLEdBQUcsQ0FBQztBQUN2RDtBQVFPLFNBQVMsU0FDZCxNQUNBLFFBQ0EsUUFDQSxVQUFVLGFBQ1YsVUFBVSxhQUNBO0FBQ1YsUUFBTSxPQUFPLEtBQUssTUFBTSxLQUFLO0FBQzdCLFFBQU0sSUFBSSxPQUFPLFNBQVMsTUFBTSxLQUFLLFNBQVMsSUFBSSxTQUFTO0FBQzNELE1BQUksT0FBTyxPQUFPO0FBQ2xCLE1BQUksT0FBTyxRQUFTLFFBQU87QUFBQSxXQUNsQixPQUFPLFFBQVMsUUFBTztBQUNoQyxRQUFNLE9BQU8sT0FBTyxLQUFLLFNBQVMsS0FBSyxTQUFTLE9BQU87QUFDdkQsUUFBTSxRQUFRLFNBQVMsT0FBTztBQUM5QixTQUFPLEVBQUUsT0FBTyxLQUFLLFFBQVEsS0FBSztBQUNwQztBQVNPLFNBQVMsWUFBWSxPQUFzQixLQUFvQixNQUFNLE1BQU0sVUFBVSxhQUF1QjtBQUNqSCxRQUFNLElBQUksS0FBSyxLQUFLO0FBQ3BCLFFBQU0sSUFBSSxLQUFLLEdBQUc7QUFDbEIsUUFBTSxLQUFLLEtBQUssSUFBSSxHQUFHLENBQUM7QUFDeEIsUUFBTSxLQUFLLEtBQUssSUFBSSxHQUFHLENBQUM7QUFDeEIsUUFBTSxJQUFJLE9BQU8sU0FBUyxHQUFHLEtBQUssTUFBTSxJQUFJLE1BQU0sUUFBUSxJQUFJLElBQUk7QUFDbEUsUUFBTSxPQUFPLEtBQUs7QUFDbEIsTUFBSSxRQUFRLElBQUksSUFBSSxLQUFLLFNBQVM7QUFDaEMsVUFBTSxPQUFPLEtBQUssTUFBTTtBQUN4QixXQUFPLEVBQUUsT0FBTyxNQUFNLFVBQVUsR0FBRyxLQUFLLE1BQU0sVUFBVSxFQUFFO0FBQUEsRUFDNUQ7QUFDQSxTQUFPLEVBQUUsT0FBTyxLQUFLLE9BQU8sR0FBRyxLQUFLLEtBQUssT0FBTyxFQUFFO0FBQ3BEO0FBR08sU0FBUyxtQkFBbUIsT0FBZSxXQUFtQixhQUFhLElBQUksYUFBYSxLQUFhO0FBQzlHLE1BQUksQ0FBQyxPQUFPLFNBQVMsS0FBSyxFQUFHLFFBQU87QUFDcEMsTUFBSSxjQUFjLEVBQUcsUUFBTyxRQUFRO0FBQ3BDLE1BQUksY0FBYyxFQUFHLFFBQU8sUUFBUTtBQUNwQyxTQUFPO0FBQ1Q7QUFHTyxJQUFNLHFCQUFxQjtBQUkzQixTQUFTLG1CQUFtQixTQUF5QjtBQUMxRCxTQUFPLEtBQUssSUFBSSxHQUFHLENBQUMsVUFBVSxrQkFBa0I7QUFDbEQ7QUFvQ0EsU0FBUyxjQUFjLE9BQWlDO0FBQ3RELFNBQU8sT0FBTyxVQUFVLFlBQVksUUFBUSxNQUFNLE1BQU0sTUFBTTtBQUNoRTtBQUlBLFNBQVMsWUFBWSxPQUF3QixJQUFxQjtBQUNoRSxNQUFJLE9BQU8sVUFBVSxVQUFXLFFBQU87QUFDdkMsTUFBSSxLQUFLLEVBQUcsUUFBTyxNQUFNO0FBQ3pCLE1BQUksS0FBSyxFQUFHLFFBQU8sTUFBTTtBQUN6QixTQUFPO0FBQ1Q7QUFNTyxTQUFTLFdBQVcsR0FBZSxPQUFvQztBQUM1RSxRQUFNLEtBQUssbUJBQW1CLEVBQUUsUUFBUSxFQUFFLFNBQVM7QUFDbkQsUUFBTSxLQUFLLG1CQUFtQixFQUFFLFFBQVEsRUFBRSxTQUFTO0FBQ25ELE1BQUksRUFBRSxXQUFXLEVBQUUsUUFBUyxRQUFPLEVBQUUsUUFBUSxJQUFJLE9BQU8sR0FBRyxjQUFjLEdBQUcsVUFBVSxLQUFLO0FBQzNGLE1BQUksRUFBRSxVQUFVO0FBQ2QsVUFBTSxNQUFNLE1BQU07QUFDbEIsV0FBTyxFQUFFLFFBQVEsR0FBRyxPQUFPLEtBQUssY0FBYyxHQUFHLFVBQVUsUUFBUSxFQUFFO0FBQUEsRUFDdkU7QUFDQSxNQUFJLEVBQUUsS0FBSyxJQUFJLEVBQUUsSUFBSSxLQUFLLElBQUksRUFBRSxJQUFJO0FBQ2xDLFFBQUksWUFBWSxPQUFPLEVBQUUsRUFBRyxRQUFPLEVBQUUsUUFBUSxHQUFHLE9BQU8sR0FBRyxjQUFjLElBQUksVUFBVSxLQUFLO0FBQzNGLFdBQU8sRUFBRSxRQUFRLEdBQUcsT0FBTyxHQUFHLGNBQWMsR0FBRyxVQUFVLE1BQU07QUFBQSxFQUNqRTtBQUNBLFNBQU8sRUFBRSxRQUFRLEdBQUcsT0FBTyxJQUFJLGNBQWMsY0FBYyxLQUFLLElBQUksS0FBSyxHQUFHLFVBQVUsS0FBSztBQUM3RjtBQU1PLFNBQVMsY0FBYyxHQUEyQjtBQUN2RCxNQUFJLEVBQUUsV0FBVyxFQUFFLFFBQVMsUUFBTztBQUNuQyxRQUFNLEtBQUssbUJBQW1CLEVBQUUsUUFBUSxFQUFFLFNBQVM7QUFDbkQsUUFBTSxLQUFLLG1CQUFtQixFQUFFLFFBQVEsRUFBRSxTQUFTO0FBQ25ELE1BQUksRUFBRSxTQUFVLFNBQVEsTUFBTSxRQUFRLElBQUksUUFBUTtBQUNsRCxTQUFPLEtBQUssSUFBSSxFQUFFLElBQUksS0FBSyxJQUFJLEVBQUUsSUFBSSxRQUFRO0FBQy9DO0FBR08sSUFBTSx1QkFBdUI7QUFHN0IsSUFBTSx3QkFBd0I7QUFDOUIsSUFBTSx5QkFBeUI7QUFJL0IsSUFBTSxxQkFBTixNQUF5QjtBQUFBLEVBQ3RCLE9BQXlCO0FBQUE7QUFBQSxFQUV6QixRQUFRO0FBQUEsRUFDUixTQUFTO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFRakIsTUFBTSxHQUFlLE9BQXdCLElBQXdCO0FBQ25FLFFBQUksRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLFNBQVUsUUFBTyxXQUFXLEdBQUcsS0FBSztBQUNwRSxVQUFNLEtBQUssbUJBQW1CLEVBQUUsUUFBUSxFQUFFLFNBQVM7QUFDbkQsVUFBTSxLQUFLLG1CQUFtQixFQUFFLFFBQVEsRUFBRSxTQUFTO0FBQ25ELFFBQUksT0FBTyxLQUFLLE9BQU8sRUFBRyxRQUFPLEVBQUUsUUFBUSxHQUFHLE9BQU8sR0FBRyxjQUFjLEdBQUcsVUFBVSxNQUFNO0FBQ3pGLFFBQUksS0FBSyxTQUFTLFFBQVEsS0FBSyxLQUFLLFNBQVMsc0JBQXNCO0FBRWpFLFdBQUssT0FBTyxLQUFLLElBQUksRUFBRSxJQUFJLEtBQUssSUFBSSxFQUFFLElBQUksTUFBTTtBQUNoRCxVQUFJLEtBQUssU0FBUyxJQUFLLE1BQUssUUFBUSxZQUFZLE9BQU8sRUFBRTtBQUFBLElBQzNELFdBQVcsS0FBSyxTQUFTLE9BQU8sS0FBSyxJQUFJLEVBQUUsSUFBSSx3QkFBd0IsS0FBSyxJQUFJLEVBQUUsS0FBSyxLQUFLLElBQUksRUFBRSxLQUFLLHdCQUF3QjtBQUM3SCxXQUFLLE9BQU87QUFDWixXQUFLLFFBQVEsWUFBWSxPQUFPLEVBQUU7QUFBQSxJQUNwQyxXQUFXLEtBQUssU0FBUyxPQUFPLEtBQUssSUFBSSxFQUFFLElBQUksd0JBQXdCLEtBQUssSUFBSSxFQUFFLEtBQUssS0FBSyxJQUFJLEVBQUUsS0FBSyx3QkFBd0I7QUFDN0gsV0FBSyxPQUFPO0FBQUEsSUFDZDtBQUNBLFNBQUssU0FBUztBQUNkLFFBQUksS0FBSyxTQUFTLEtBQUs7QUFDckIsVUFBSSxLQUFLLE1BQU8sUUFBTyxFQUFFLFFBQVEsR0FBRyxPQUFPLEdBQUcsY0FBYyxJQUFJLFVBQVUsS0FBSztBQUMvRSxhQUFPLEVBQUUsUUFBUSxHQUFHLE9BQU8sR0FBRyxjQUFjLEdBQUcsVUFBVSxNQUFNO0FBQUEsSUFDakU7QUFDQSxXQUFPLEVBQUUsUUFBUSxHQUFHLE9BQU8sSUFBSSxjQUFjLGNBQWMsS0FBSyxJQUFJLEtBQUssR0FBRyxVQUFVLEtBQUs7QUFBQSxFQUM3RjtBQUNGO0FBS08sSUFBTSxtQkFBbUI7QUFFekIsSUFBTSx3QkFBd0I7QUFHOUIsU0FBUyxtQkFDZCxjQUNBLFNBQ0EsTUFDQSxLQUNBLE9BQ0EsZUFDUztBQUNULE1BQUksU0FBUyxLQUFLLE1BQU0sUUFBUyxRQUFPO0FBQ3hDLE1BQUksYUFBYyxRQUFPO0FBQ3pCLFNBQU8sS0FBSyxPQUFPLE1BQU0seUJBQXlCLE9BQU8sU0FBUyxhQUFhLEtBQUssZ0JBQWdCLElBQUksZ0JBQWdCO0FBQzFIO0FBS08sSUFBTSx1QkFBdUI7QUFFN0IsSUFBTSx1QkFBdUI7QUFJN0IsU0FBUyxhQUFhLFVBQWtCLFlBQW9CLFdBQW1CLFNBQXlCO0FBQzdHLE1BQUksRUFBRSxVQUFVLE1BQU0sRUFBRSxZQUFZLFNBQVUsUUFBTztBQUNyRCxNQUFJLEVBQUUsWUFBWSxHQUFJLFFBQU87QUFDN0IsUUFBTSxJQUFJLFlBQVk7QUFDdEIsU0FBTyxZQUFZLGFBQWEsWUFBWSxLQUFLLElBQUk7QUFDdkQ7QUFJTyxTQUFTLGdCQUFnQixPQUFlLEtBQWEsTUFBYyxTQUF5QjtBQUNqRyxNQUFJLEVBQUUsT0FBTyxHQUFJLFFBQU8sS0FBSyxJQUFJLEdBQUcsT0FBTztBQUMzQyxTQUFPLEtBQUssS0FBSyxRQUFRLE9BQU8sTUFBTSxPQUFPO0FBQy9DO0FBS08sSUFBTSx5QkFBeUI7QUFLL0IsU0FBUyxZQUFZLEtBQWEsV0FBMEIsY0FBK0I7QUFDaEcsTUFBSSxjQUFjLFFBQVEsQ0FBQyxPQUFPLFNBQVMsWUFBWSxLQUFLLGdCQUFnQixFQUFHLFFBQU87QUFDdEYsU0FBTyxNQUFNLFlBQVk7QUFDM0I7QUFJTyxTQUFTLGVBQWUsS0FBYSxXQUEwQixjQUE4QjtBQUNsRyxTQUFPLFlBQVksS0FBSyxXQUFXLFlBQVksSUFBSyxZQUF1QjtBQUM3RTtBQVNPLFNBQVMsdUJBQXVCLE1BQWdCLGNBQXNCLEtBQXVCO0FBQ2xHLFFBQU0sT0FBTyxLQUFLLE1BQU0sS0FBSztBQUM3QixRQUFNLGFBQWEsUUFBUSxlQUFlO0FBQzFDLE1BQUksQ0FBQyxPQUFPLFNBQVMsVUFBVSxLQUFLLGNBQWMsRUFBRyxRQUFPO0FBQzVELFFBQU0sUUFBUSxLQUFLLE1BQU0sS0FBSyxRQUFRLFVBQVUsSUFBSTtBQUNwRCxTQUFPLEVBQUUsT0FBTyxLQUFLLFFBQVEsS0FBSztBQUNwQztBQUlPLFNBQVMsZUFBZSxHQUFXLEtBQXFCO0FBQzdELE1BQUksQ0FBQyxPQUFPLFNBQVMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxHQUFJLFFBQU87QUFDOUMsU0FBTyxLQUFLLE1BQU0sSUFBSSxHQUFHLElBQUk7QUFDL0I7QUFJTyxTQUFTLFNBQVMsS0FBYSxNQUFnQixTQUFpQixjQUFzQixLQUFxQjtBQUNoSCxRQUFNLElBQUksVUFBVSxRQUFRLEtBQUssTUFBTSxZQUFZO0FBQ25ELE1BQUksQ0FBQyxPQUFPLFNBQVMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxHQUFJLFFBQU87QUFDOUMsVUFBUSxLQUFLLE1BQU0sSUFBSSxHQUFHLElBQUksT0FBTztBQUN2QztBQUtPLElBQU0sa0JBQXFDO0FBQUEsRUFDaEQ7QUFBQSxFQUFHO0FBQUEsRUFBRztBQUFBLEVBQUc7QUFBQSxFQUFJO0FBQUEsRUFBSTtBQUFBLEVBQUk7QUFBQSxFQUFLO0FBQUEsRUFBSztBQUFBLEVBQy9CO0FBQUEsRUFBTztBQUFBLEVBQU87QUFBQSxFQUFPO0FBQUEsRUFBUTtBQUFBLEVBQVE7QUFBQSxFQUNyQztBQUFBLEVBQVE7QUFBQSxFQUFTO0FBQUEsRUFBUztBQUFBLEVBQVM7QUFBQSxFQUFTO0FBQUEsRUFDNUM7QUFBQSxFQUFXO0FBQUEsRUFBVztBQUFBLEVBQVk7QUFBQSxFQUFZO0FBQUEsRUFDOUM7QUFBQSxFQUFZO0FBQUEsRUFBYTtBQUMzQjtBQU1PLFNBQVMsYUFBYSxNQUFjLFVBQTBCO0FBQ25FLFFBQU0sTUFBTSxLQUFLLElBQUksR0FBRyxRQUFRO0FBQ2hDLGFBQVcsUUFBUSxpQkFBaUI7QUFDbEMsUUFBSSxPQUFPLFFBQVEsSUFBSyxRQUFPO0FBQUEsRUFDakM7QUFDQSxTQUFPLGdCQUFnQixnQkFBZ0IsU0FBUyxDQUFDO0FBQ25EO0FBUU8sU0FBUyxVQUFVLE1BQWdCLFVBQWtCLGFBQWEsR0FBYTtBQUNwRixRQUFNLE9BQU8sS0FBSyxNQUFNLEtBQUs7QUFDN0IsTUFBSSxDQUFDLE9BQU8sU0FBUyxJQUFJLEtBQUssUUFBUSxFQUFHLFFBQU8sQ0FBQztBQUNqRCxRQUFNLE9BQU8sYUFBYSxNQUFNLFFBQVE7QUFDeEMsUUFBTSxRQUFRLEtBQUssTUFBTSxLQUFLLFFBQVEsY0FBYyxJQUFJLElBQUksT0FBTztBQUNuRSxRQUFNLFFBQWtCLENBQUM7QUFDekIsV0FBUyxJQUFJLE9BQU8sS0FBSyxLQUFLLEtBQUssS0FBSyxLQUFNLE9BQU0sS0FBSyxDQUFDO0FBQzFELFNBQU87QUFDVDtBQWNBLElBQU0sU0FBUyxDQUFDLE9BQU8sT0FBTyxPQUFPLE9BQU8sT0FBTyxPQUFPLE9BQU8sT0FBTyxPQUFPLE9BQU8sT0FBTyxLQUFLO0FBRWxHLFNBQVMsTUFBTSxHQUFXLFlBQTJCO0FBQ25ELFFBQU0sUUFBUSxJQUFJO0FBQ2xCLFFBQU0sU0FBVSxRQUFRLFFBQWMsU0FBYztBQUNwRCxRQUFNLE9BQU8sS0FBSyxNQUFNLFFBQVEsS0FBVTtBQUUxQyxRQUFNLElBQUksT0FBTztBQUNqQixRQUFNLE1BQU0sS0FBSyxNQUFNLElBQUksTUFBTztBQUNsQyxRQUFNLE1BQU0sSUFBSSxNQUFNO0FBQ3RCLFFBQU0sTUFBTSxLQUFLLE9BQU8sTUFBTSxLQUFLLE1BQU0sTUFBTSxJQUFLLElBQUksS0FBSyxNQUFNLE1BQU0sS0FBTSxJQUFJLEtBQUssTUFBTSxNQUFNLE1BQU8sS0FBSyxHQUFHO0FBQ25ILFFBQU0sSUFBSSxNQUFNLE1BQU07QUFDdEIsUUFBTSxNQUFNLE9BQU8sTUFBTSxNQUFNLEtBQUssTUFBTSxNQUFNLENBQUMsSUFBSSxLQUFLLE1BQU0sTUFBTSxHQUFHO0FBQ3pFLFFBQU0sS0FBSyxLQUFLLE9BQU8sSUFBSSxNQUFNLEtBQUssR0FBRztBQUN6QyxRQUFNLElBQUksTUFBTSxLQUFLLE9BQU8sTUFBTSxLQUFLLEtBQUssQ0FBQyxJQUFJO0FBQ2pELFFBQU0sS0FBSyxLQUFLLEtBQUssS0FBSyxJQUFJLEtBQUs7QUFDbkMsU0FBTztBQUFBLElBQ0wsR0FBRyxNQUFNLElBQUksSUFBSSxJQUFJO0FBQUEsSUFDckI7QUFBQSxJQUNBO0FBQUEsSUFDQSxHQUFHLEtBQUssTUFBTSxRQUFRLElBQVM7QUFBQSxJQUMvQixJQUFJLEtBQUssTUFBTSxRQUFRLEdBQU0sSUFBSTtBQUFBLElBQ2pDLEdBQUcsS0FBSyxNQUFNLFFBQVEsR0FBSyxJQUFJO0FBQUEsSUFDL0IsSUFBSSxRQUFRO0FBQUEsSUFDWjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsS0FBSyxHQUFtQjtBQUMvQixTQUFPLElBQUksS0FBSyxJQUFJLENBQUMsS0FBSyxPQUFPLENBQUM7QUFDcEM7QUFNTyxTQUFTLGVBQWUsR0FBVyxNQUFjLGFBQWEsR0FBVztBQUM5RSxRQUFNLElBQUksTUFBTSxHQUFHLFVBQVU7QUFDN0IsTUFBSSxPQUFPLFNBQWMsRUFBRSxVQUFVLEVBQUcsUUFBTyxHQUFHLE9BQU8sRUFBRSxLQUFLLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUN6RSxNQUFJLE9BQU8sSUFBTyxRQUFPLElBQUksS0FBSyxFQUFFLENBQUMsQ0FBQyxJQUFJLE9BQU8sRUFBRSxFQUFFLEVBQUUsU0FBUyxHQUFHLEdBQUcsQ0FBQztBQUN2RSxNQUFJLE9BQU8sSUFBUSxRQUFPLEdBQUcsS0FBSyxFQUFFLENBQUMsQ0FBQyxJQUFJLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQyxDQUFDO0FBQ2pFLE1BQUksT0FBTyxNQUFZLFFBQU8sR0FBRyxLQUFLLEVBQUUsQ0FBQyxDQUFDLElBQUksS0FBSyxFQUFFLEVBQUUsQ0FBQztBQUN4RCxTQUFPLEdBQUcsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO0FBQ25DO0FBR08sU0FBUyxlQUFlLEdBQVcsYUFBYSxHQUFHLFNBQVMsT0FBZTtBQUNoRixRQUFNLElBQUksTUFBTSxHQUFHLFVBQVU7QUFDN0IsUUFBTSxPQUFPLEdBQUcsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksS0FBSyxFQUFFLENBQUMsQ0FBQyxJQUFJLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQyxDQUFDO0FBQy9FLFNBQU8sU0FBUyxHQUFHLElBQUksSUFBSSxPQUFPLEVBQUUsRUFBRSxFQUFFLFNBQVMsR0FBRyxHQUFHLENBQUMsS0FBSztBQUMvRDtBQU9PLFNBQVMsZUFBZSxJQUFvQjtBQUNqRCxNQUFJLENBQUMsT0FBTyxTQUFTLEVBQUUsS0FBSyxLQUFLLEVBQUcsUUFBTztBQUMzQyxNQUFJLEtBQUssSUFBTyxRQUFPLEdBQUcsS0FBSyxNQUFNLEVBQUUsQ0FBQztBQUN4QyxNQUFJLEtBQUssSUFBUSxRQUFPLElBQUksS0FBSyxLQUFPLFFBQVEsQ0FBQyxDQUFDO0FBQ2xELE1BQUksS0FBSyxLQUFXLFFBQU8sR0FBRyxLQUFLLE1BQU0sS0FBSyxHQUFNLENBQUMsS0FBSyxLQUFLLEtBQUssTUFBTSxLQUFLLEdBQUssSUFBSSxFQUFFLENBQUM7QUFDM0YsTUFBSSxLQUFLLE1BQVksUUFBTyxHQUFHLEtBQUssTUFBTSxLQUFLLElBQVMsQ0FBQyxLQUFLLEtBQUssS0FBSyxNQUFNLEtBQUssR0FBTSxJQUFJLEVBQUUsQ0FBQztBQUNoRyxTQUFPLEdBQUcsS0FBSyxNQUFNLEtBQUssS0FBVSxDQUFDLEtBQUssS0FBSyxNQUFNLEtBQUssSUFBUyxJQUFJLEVBQUU7QUFDM0U7QUFLTyxJQUFNLGNBQWM7QUFhcEIsU0FBUyxXQUFXLE9BQXNFO0FBQy9GLFFBQU0sUUFBUSxNQUFNLElBQUksQ0FBQyxHQUFHLE1BQU0sQ0FBQztBQUNuQyxRQUFNLEtBQUssQ0FBQyxHQUFHLE1BQU07QUFDbkIsVUFBTSxLQUFLLE1BQU0sQ0FBQztBQUNsQixVQUFNLEtBQUssTUFBTSxDQUFDO0FBQ2xCLFdBQU8sR0FBRyxRQUFRLEdBQUcsVUFBVSxHQUFHLEtBQUssR0FBRyxLQUFLLEtBQUssR0FBRyxLQUFLLEdBQUcsS0FBSyxJQUFJO0FBQUEsRUFDMUUsQ0FBQztBQUNELFFBQU0sU0FBUyxJQUFJLE1BQWMsTUFBTSxNQUFNLEVBQUUsS0FBSyxDQUFDO0FBQ3JELFFBQU0sWUFBc0IsQ0FBQztBQUM3QixhQUFXLEtBQUssT0FBTztBQUNyQixVQUFNLEtBQUssTUFBTSxDQUFDO0FBQ2xCLFVBQU0sT0FBTyxTQUFTLEVBQUU7QUFDeEIsVUFBTSxJQUFJLFVBQVUsV0FBVyxHQUFHLE9BQU8sSUFBSTtBQUM3QyxVQUFNLE1BQU0sUUFBUSxFQUFFO0FBQ3RCLGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxJQUFLLFdBQVUsSUFBSSxDQUFDLElBQUk7QUFDbEQsV0FBTyxDQUFDLElBQUk7QUFBQSxFQUNkO0FBQ0EsU0FBTyxFQUFFLFFBQVEsWUFBWSxLQUFLLElBQUksR0FBRyxVQUFVLE1BQU0sRUFBRTtBQUM3RDtBQUdBLFNBQVMsUUFBUSxJQUFzQjtBQUNyQyxTQUFPLEtBQUssSUFBSSxHQUFHLE9BQU8sT0FBTyxXQUFXLEdBQUcsS0FBSyxHQUFHLFFBQVEsV0FBVztBQUM1RTtBQUVBLFNBQVMsU0FBUyxJQUFzQjtBQUN0QyxRQUFNLElBQUksR0FBRztBQUNiLFNBQU8sTUFBTSxVQUFhLElBQUksSUFBSSxLQUFLLE1BQU0sQ0FBQyxJQUFJO0FBQ3BEO0FBT0EsU0FBUyxVQUFVLFdBQThCLE9BQWUsTUFBc0I7QUFDcEYsTUFBSSxJQUFJO0FBQ1IsYUFBUztBQUNQLFFBQUksSUFBSTtBQUNSLFdBQU8sSUFBSSxRQUFRLEVBQUUsSUFBSSxJQUFJLFVBQVUsVUFBVSxVQUFVLElBQUksQ0FBQyxJQUFJLE9BQVE7QUFDNUUsUUFBSSxNQUFNLEtBQU0sUUFBTztBQUN2QixTQUFLLElBQUk7QUFBQSxFQUNYO0FBQ0Y7QUFTTyxTQUFTLGtCQUFrQixPQUE0QixNQUEwRDtBQUN0SCxRQUFNLFFBQWtCLENBQUM7QUFDekIsV0FBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSztBQUNyQyxVQUFNLEtBQUssTUFBTSxDQUFDO0FBQ2xCLFFBQUksR0FBRyxTQUFTLEtBQUssT0FBTyxRQUFRLEVBQUUsS0FBSyxLQUFLLE1BQU8sT0FBTSxLQUFLLENBQUM7QUFBQSxFQUNyRTtBQUNBLFFBQU0sS0FBSyxDQUFDLEdBQUcsTUFBTTtBQUNuQixVQUFNLEtBQUssTUFBTSxDQUFDO0FBQ2xCLFVBQU0sS0FBSyxNQUFNLENBQUM7QUFDbEIsV0FBTyxHQUFHLFFBQVEsR0FBRyxVQUFVLEdBQUcsS0FBSyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRyxLQUFLLElBQUk7QUFBQSxFQUMxRSxDQUFDO0FBQ0QsUUFBTSxTQUFTLElBQUksTUFBYyxNQUFNLE1BQU0sRUFBRSxLQUFLLEVBQUU7QUFDdEQsUUFBTSxZQUFzQixDQUFDO0FBQzdCLGFBQVcsS0FBSyxPQUFPO0FBQ3JCLFVBQU0sS0FBSyxNQUFNLENBQUM7QUFDbEIsVUFBTSxPQUFPLFNBQVMsRUFBRTtBQUN4QixVQUFNLElBQUksVUFBVSxXQUFXLEdBQUcsT0FBTyxJQUFJO0FBQzdDLFVBQU0sTUFBTSxRQUFRLEVBQUU7QUFDdEIsYUFBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLElBQUssV0FBVSxJQUFJLENBQUMsSUFBSTtBQUNsRCxXQUFPLENBQUMsSUFBSTtBQUFBLEVBQ2Q7QUFDQSxTQUFPLEVBQUUsUUFBUSxZQUFZLEtBQUssSUFBSSxHQUFHLFVBQVUsTUFBTSxFQUFFO0FBQzdEO0FBR08sSUFBTSxtQkFBbUI7QUFhekIsSUFBTSxpQkFBTixNQUFxQjtBQUFBO0FBQUEsRUFFbEIsU0FBUyxvQkFBSSxJQUFvQjtBQUFBO0FBQUEsRUFFakMsT0FBTyxvQkFBSSxJQUFZO0FBQUE7QUFBQSxFQUV2QixXQUFXLG9CQUFJLElBQVk7QUFBQSxFQUMzQjtBQUFBO0FBQUEsRUFFQSxhQUF1QixDQUFDO0FBQUEsRUFDeEIsbUJBQTZCLENBQUM7QUFBQSxFQUM5QixlQUF5QixDQUFDO0FBQUEsRUFDMUIsZ0JBQTRCLENBQUM7QUFBQSxFQUVyQyxZQUFZLFlBQVksa0JBQWtCO0FBQ3hDLFNBQUssTUFBTSxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sU0FBUyxDQUFDO0FBQUEsRUFDOUM7QUFBQTtBQUFBLEVBR0EsT0FBTyxPQUE0QixNQUEwRDtBQUMzRixVQUFNLFNBQVMsSUFBSSxNQUFjLE1BQU0sTUFBTSxFQUFFLEtBQUssRUFBRTtBQUN0RCxVQUFNLE1BQU0sS0FBSztBQUNqQixRQUFJLFNBQVM7QUFDYixhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLO0FBQ3JDLFlBQU0sS0FBSyxNQUFNLENBQUM7QUFDbEIsVUFBSSxHQUFHLFNBQVMsS0FBSyxPQUFPLFFBQVEsRUFBRSxLQUFLLEtBQUssTUFBTyxLQUFJLEtBQUssQ0FBQztBQUFBLElBQ25FO0FBQ0EsUUFBSSxLQUFLLENBQUMsR0FBRyxNQUFNO0FBQ2pCLFlBQU0sS0FBSyxNQUFNLENBQUM7QUFDbEIsWUFBTSxLQUFLLE1BQU0sQ0FBQztBQUNsQixhQUFPLEdBQUcsUUFBUSxHQUFHLFVBQVUsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLEtBQUssSUFBSTtBQUFBLElBQzFFLENBQUM7QUFFRCxVQUFNLFNBQVMsS0FBSztBQUNwQixRQUFJLGFBQWE7QUFFakIsVUFBTSxXQUFXLENBQUMsR0FBVyxHQUFXLEdBQVcsU0FBMEI7QUFDM0UsZUFBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLEtBQUs7QUFDN0IsWUFBSSxJQUFJLEtBQUssV0FBWSxRQUFPO0FBQ2hDLGNBQU0sT0FBTyxPQUFPLElBQUksQ0FBQztBQUN6QixpQkFBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLFFBQVEsS0FBSyxHQUFHO0FBQ3ZDLGNBQUksSUFBSSxLQUFLLElBQUksQ0FBQyxLQUFLLEtBQUssQ0FBQyxJQUFJLEVBQUcsUUFBTztBQUFBLFFBQzdDO0FBQUEsTUFDRjtBQUNBLGFBQU87QUFBQSxJQUNUO0FBQ0EsVUFBTSxRQUFRLENBQUMsR0FBVyxNQUFvQjtBQUM1QyxhQUFPLENBQUMsSUFBSTtBQUNaLFlBQU0sT0FBTyxTQUFTLE1BQU0sQ0FBQyxDQUFDO0FBQzlCLGFBQU8sYUFBYSxJQUFJLE1BQU07QUFDNUIsY0FBTSxPQUFPLE9BQU8sVUFBVSxNQUFNLE9BQU8sVUFBVSxJQUFJLENBQUM7QUFDMUQsYUFBSyxTQUFTO0FBQ2Q7QUFBQSxNQUNGO0FBQ0EsZUFBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLElBQUssUUFBTyxJQUFJLENBQUMsRUFBRSxLQUFLLE1BQU0sQ0FBQyxFQUFFLE9BQU8sUUFBUSxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQUEsSUFDckY7QUFDQSxVQUFNLGFBQWEsQ0FBQyxHQUFXLEdBQVcsU0FBeUI7QUFDakUsVUFBSSxJQUFJO0FBQ1IsYUFBTyxDQUFDLFNBQVMsR0FBRyxHQUFHLEdBQUcsSUFBSSxFQUFHO0FBQ2pDLGFBQU87QUFBQSxJQUNUO0FBQ0EsVUFBTSxZQUFZLEtBQUs7QUFDdkIsVUFBTSxRQUFRLEtBQUs7QUFDbkIsY0FBVSxTQUFTO0FBQ25CLFVBQU0sU0FBUztBQUNmLGFBQVMsS0FBSyxHQUFHLEtBQUssSUFBSSxRQUFRLE1BQU07QUFDdEMsWUFBTSxJQUFJLElBQUksRUFBRTtBQUNoQixZQUFNLEtBQUssTUFBTSxDQUFDO0FBQ2xCLFlBQU0sT0FBTyxLQUFLLEtBQUssSUFBSSxHQUFHLEVBQUUsSUFBSSxLQUFLLE9BQU8sSUFBSSxHQUFHLEVBQUUsSUFBSTtBQUM3RCxVQUFJLFNBQVMsVUFBYSxTQUFTLE1BQU0sR0FBRyxPQUFPLFFBQVEsRUFBRSxHQUFHLFNBQVMsRUFBRSxDQUFDLEVBQUcsT0FBTSxHQUFHLElBQUk7QUFBQSxlQUNuRixLQUFLLE9BQU8sSUFBSSxHQUFHLEVBQUUsRUFBRyxXQUFVLEtBQUssQ0FBQztBQUFBLFVBQzVDLE9BQU0sS0FBSyxDQUFDO0FBQUEsSUFDbkI7QUFDQSxhQUFTLEtBQUssR0FBRyxLQUFLLFVBQVUsUUFBUSxNQUFNO0FBQzVDLFlBQU0sSUFBSSxVQUFVLEVBQUU7QUFDdEIsWUFBTSxLQUFLLE1BQU0sQ0FBQztBQUNsQixZQUFNLE1BQU0sUUFBUSxFQUFFO0FBQ3RCLFlBQU0sT0FBTyxTQUFTLEVBQUU7QUFDeEIsWUFBTSxhQUFhLEtBQUssT0FBTyxJQUFJLEdBQUcsRUFBRTtBQUN4QyxZQUFNLEdBQUcsU0FBUyxZQUFZLEdBQUcsT0FBTyxLQUFLLElBQUksSUFBSSxhQUFhLFdBQVcsR0FBRyxPQUFPLEtBQUssSUFBSSxDQUFDO0FBQUEsSUFDbkc7QUFDQSxhQUFTLEtBQUssR0FBRyxLQUFLLE1BQU0sUUFBUSxNQUFNO0FBQ3hDLFlBQU0sSUFBSSxNQUFNLEVBQUU7QUFDbEIsWUFBTSxLQUFLLE1BQU0sQ0FBQztBQUNsQixZQUFNLEdBQUcsV0FBVyxHQUFHLE9BQU8sUUFBUSxFQUFFLEdBQUcsU0FBUyxFQUFFLENBQUMsQ0FBQztBQUFBLElBQzFEO0FBRUEsVUFBTSxXQUFXLEtBQUs7QUFDdEIsYUFBUyxNQUFNO0FBQ2YsUUFBSSxXQUFXO0FBQ2YsYUFBUyxLQUFLLEdBQUcsS0FBSyxJQUFJLFFBQVEsTUFBTTtBQUN0QyxZQUFNLElBQUksSUFBSSxFQUFFO0FBQ2hCLFlBQU0sS0FBSyxNQUFNLENBQUMsRUFBRTtBQUNwQixlQUFTLElBQUksRUFBRTtBQUNmLFdBQUssT0FBTyxPQUFPLEVBQUU7QUFDckIsV0FBSyxPQUFPLElBQUksSUFBSSxPQUFPLENBQUMsQ0FBQztBQUM3QixZQUFNLE9BQU8sT0FBTyxDQUFDLElBQUksU0FBUyxNQUFNLENBQUMsQ0FBQyxJQUFJO0FBQzlDLFVBQUksT0FBTyxTQUFVLFlBQVc7QUFBQSxJQUNsQztBQUNBLFNBQUssV0FBVyxLQUFLO0FBQ3JCLFNBQUssT0FBTztBQUNaLFdBQU8sS0FBSyxPQUFPLE9BQU8sS0FBSyxLQUFLO0FBQ2xDLFlBQU0sU0FBUyxLQUFLLE9BQU8sS0FBSyxFQUFFLEtBQUssRUFBRTtBQUN6QyxVQUFJLFdBQVcsT0FBVztBQUMxQixXQUFLLE9BQU8sT0FBTyxNQUFNO0FBQUEsSUFDM0I7QUFDQSxXQUFPLEVBQUUsUUFBUSxZQUFZLEtBQUssSUFBSSxHQUFHLFdBQVcsQ0FBQyxFQUFFO0FBQUEsRUFDekQ7QUFDRjtBQWVPLFNBQVMsZUFBZSxPQUF3QztBQUNyRSxRQUFNLE1BQU0sb0JBQUksSUFBb0I7QUFDcEMsV0FBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSztBQUNyQyxRQUFJLENBQUMsSUFBSSxJQUFJLE1BQU0sQ0FBQyxFQUFFLEVBQUUsRUFBRyxLQUFJLElBQUksTUFBTSxDQUFDLEVBQUUsSUFBSSxDQUFDO0FBQUEsRUFDbkQ7QUFDQSxRQUFNLFNBQVMsSUFBSSxNQUFjLE1BQU0sTUFBTSxFQUFFLEtBQUssRUFBRTtBQUN0RCxXQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLO0FBQ3JDLFVBQU0sTUFBTSxNQUFNLENBQUMsRUFBRTtBQUNyQixRQUFJLE9BQU8sS0FBTTtBQUNqQixVQUFNLElBQUksSUFBSSxJQUFJLEdBQUc7QUFDckIsUUFBSSxNQUFNLFVBQWEsTUFBTSxFQUFHO0FBQ2hDLFVBQU0sSUFBSSxNQUFNLENBQUMsRUFBRTtBQUNuQixVQUFNLElBQUksTUFBTSxDQUFDLEVBQUU7QUFDbkIsUUFBSSxNQUFNLFVBQWEsTUFBTSxVQUFhLE1BQU0sRUFBRztBQUNuRCxXQUFPLENBQUMsSUFBSTtBQUFBLEVBQ2Q7QUFDQSxXQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLO0FBQ3JDLFFBQUksSUFBSSxPQUFPLENBQUM7QUFDaEIsUUFBSSxRQUFRO0FBQ1osV0FBTyxLQUFLLEtBQUssTUFBTSxLQUFLLFNBQVMsTUFBTSxRQUFRO0FBQ2pELFVBQUksT0FBTyxDQUFDO0FBQ1o7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLEVBQUcsUUFBTyxDQUFDLElBQUk7QUFBQSxFQUMzQjtBQUNBLFNBQU87QUFDVDtBQW1CTyxTQUFTLFdBQVcsTUFBOEI7QUFDdkQsUUFBTSxPQUFPLG9CQUFJLElBQW9CO0FBQ3JDLE9BQUssSUFBSSxLQUFLLElBQUksQ0FBQztBQUNuQixNQUFJLFFBQVEsS0FBSztBQUNqQixNQUFJLE1BQXFCLEtBQUssT0FBTyxPQUFPLE9BQU8sS0FBSztBQUN4RCxNQUFJLFVBQVUsUUFBUTtBQUN0QixRQUFNLFdBQVcsS0FBSztBQUN0QixNQUFJLENBQUMsWUFBWSxTQUFTLFdBQVcsRUFBRyxRQUFPLEVBQUUsTUFBTSxHQUFHLE9BQU8sS0FBSyxLQUFLO0FBQzNFLFFBQU0sT0FBdUIsSUFBSSxNQUFNLFNBQVMsTUFBTTtBQUN0RCxRQUFNLFFBQW9CLElBQUksTUFBTSxTQUFTLE1BQU07QUFDbkQsV0FBUyxJQUFJLEdBQUcsSUFBSSxTQUFTLFFBQVEsS0FBSztBQUN4QyxVQUFNLE1BQU0sV0FBVyxTQUFTLENBQUMsQ0FBQztBQUNsQyxTQUFLLENBQUMsSUFBSTtBQUNWLFVBQU0sQ0FBQyxJQUFJLEVBQUUsSUFBSSxTQUFTLENBQUMsRUFBRSxJQUFJLE9BQU8sSUFBSSxPQUFPLEtBQUssSUFBSSxLQUFLLE1BQU0sSUFBSSxLQUFLO0FBQ2hGLFFBQUksSUFBSSxRQUFRLE1BQU8sU0FBUSxJQUFJO0FBQ25DLFFBQUksSUFBSSxRQUFRLEtBQU0sV0FBVTtBQUFBLGFBQ3ZCLFFBQVEsUUFBUSxJQUFJLE1BQU0sSUFBSyxPQUFNLElBQUk7QUFBQSxFQUNwRDtBQUNBLFFBQU0sU0FBUyxXQUFXLEtBQUs7QUFDL0IsV0FBUyxJQUFJLEdBQUcsSUFBSSxTQUFTLFFBQVEsS0FBSztBQUN4QyxVQUFNLE1BQU0sSUFBSSxPQUFPLE9BQU8sQ0FBQztBQUMvQixlQUFXLENBQUMsSUFBSSxDQUFDLEtBQUssS0FBSyxDQUFDLEVBQUUsS0FBTSxNQUFLLElBQUksSUFBSSxNQUFNLENBQUM7QUFBQSxFQUMxRDtBQUNBLFNBQU8sRUFBRSxNQUFNLElBQUksT0FBTyxZQUFZLE9BQU8sS0FBSyxVQUFVLE9BQU8sS0FBSyxLQUFLO0FBQy9FO0FBMEJPLFNBQVMsV0FBVyxZQUFvQixHQUFnQixjQUFjLEVBQUUsYUFBcUI7QUFDbEcsUUFBTSxJQUFJLEtBQUssSUFBSSxHQUFHLFVBQVU7QUFDaEMsU0FBTyxFQUFFLFVBQVUsSUFBSSxJQUFJLGVBQWUsSUFBSSxLQUFLLEVBQUU7QUFDdkQ7QUFRTyxTQUFTLFlBQVksYUFBZ0MsR0FBZ0IsY0FBOEM7QUFDeEgsUUFBTSxPQUFpQixDQUFDO0FBQ3hCLFFBQU0sVUFBb0IsQ0FBQztBQUMzQixNQUFJLElBQUk7QUFDUixXQUFTLElBQUksR0FBRyxJQUFJLFlBQVksUUFBUSxLQUFLO0FBQzNDLFVBQU0sSUFBSSxXQUFXLFlBQVksQ0FBQyxHQUFHLEdBQUcsZUFBZSxDQUFDLEtBQUssRUFBRSxXQUFXO0FBQzFFLFNBQUssS0FBSyxDQUFDO0FBQ1gsWUFBUSxLQUFLLENBQUM7QUFDZCxTQUFLO0FBQUEsRUFDUDtBQUNBLFNBQU8sRUFBRSxNQUFNLFNBQVMsYUFBYSxFQUFFO0FBQ3pDO0FBR08sU0FBUyxTQUFTLE9BQWUsR0FBZ0IsY0FBYyxFQUFFLGFBQXFCO0FBQzNGLFNBQU8sRUFBRSxVQUFVLFNBQVMsY0FBYyxFQUFFO0FBQzlDO0FBS08sSUFBTSxzQkFBc0I7QUFhNUIsU0FBUyxjQUFjLGFBQTBDO0FBQ3RFLFFBQU0sUUFBUSxZQUFZLElBQUksQ0FBQyxHQUFHLE1BQU0sQ0FBQztBQUN6QyxRQUFNLEtBQUssQ0FBQyxHQUFHLE1BQU0sWUFBWSxDQUFDLElBQUksWUFBWSxDQUFDLEtBQUssSUFBSSxDQUFDO0FBQzdELFNBQU87QUFDVDtBQUlPLFNBQVMsZUFDZCxhQUNBLEdBQ0Esb0JBQ0EsYUFDQSxtQkFBbUIsR0FDbkIsaUJBQWlCLHFCQUNOO0FBQ1gsUUFBTSxTQUFTLFlBQVk7QUFDM0IsUUFBTSxVQUFVLElBQUksTUFBZSxNQUFNLEVBQUUsS0FBSyxLQUFLO0FBQ3JELE1BQUksV0FBVyxFQUFHLFFBQU8sRUFBRSxTQUFTLE9BQU8sRUFBRTtBQUM3QyxRQUFNLFVBQVUsS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLG9CQUFvQixFQUFFLFdBQVcsQ0FBQztBQUN2RSxRQUFNLFFBQVEsY0FBYyxXQUFXO0FBQ3ZDLFFBQU0sVUFBVSxJQUFJLE1BQWMsTUFBTTtBQUN4QyxNQUFJLFFBQVE7QUFDWixXQUFTLElBQUksR0FBRyxJQUFJLFFBQVEsS0FBSztBQUMvQixVQUFNLEtBQUssV0FBVyxZQUFZLENBQUMsR0FBRyxDQUFDO0FBQ3ZDLGFBQVM7QUFDVCxZQUFRLENBQUMsSUFBSSxLQUFLLFdBQVcsWUFBWSxDQUFDLEdBQUcsR0FBRyxPQUFPO0FBQUEsRUFDekQ7QUFFQSxRQUFNLFlBQVksZUFBZSxJQUFJO0FBQ3JDLE1BQUksT0FBTyxTQUFTLGNBQWMsSUFBSTtBQUN0QyxNQUFJLFFBQVEsU0FBUyxZQUFZLElBQUk7QUFDckMsTUFBSSxVQUFVO0FBQ2QsV0FBUyxJQUFJLEdBQUcsS0FBSyxXQUFXLFNBQVMsVUFBVSxVQUFVLFNBQVMsS0FBSztBQUN6RSxlQUFXLFFBQVEsTUFBTSxJQUFJLENBQUMsQ0FBQztBQUMvQixRQUFJLFNBQVMsVUFBVSxXQUFXLFlBQWEsUUFBTztBQUN0RCxRQUFJLFVBQVUsVUFBVSxXQUFXLFVBQVcsU0FBUTtBQUFBLEVBQ3hEO0FBRUEsUUFBTSxPQUFPLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSSxRQUFRLEtBQUssTUFBTSxnQkFBZ0IsQ0FBQyxDQUFDO0FBQ3ZFLFFBQU0sUUFBUSxPQUFPLE9BQU8sT0FBTyxPQUFPLFFBQVEsUUFBUTtBQUMxRCxXQUFTLElBQUksR0FBRyxJQUFJLE9BQU8sSUFBSyxTQUFRLE1BQU0sQ0FBQyxDQUFDLElBQUk7QUFDcEQsU0FBTyxFQUFFLFNBQVMsTUFBTTtBQUMxQjtBQUtPLElBQU0sV0FBVztBQVFqQixTQUFTLFFBQVEsTUFBYyxTQUFpQixPQUFlLFdBQVcsR0FBVztBQUMxRixNQUFJLEVBQUUsUUFBUSxNQUFNLFdBQVcsS0FBSyxLQUFLLFdBQVcsRUFBRyxRQUFPO0FBQzlELFFBQU0sV0FBVyxLQUFLLE1BQU0sVUFBVSxLQUFLO0FBQzNDLE1BQUksS0FBSyxVQUFVLFNBQVUsUUFBTztBQUNwQyxNQUFJLFdBQVcsSUFBSSxTQUFVLFFBQU87QUFDcEMsU0FBTyxLQUFLLE1BQU0sR0FBRyxXQUFXLENBQUMsSUFBSTtBQUN2QztBQUdPLElBQU0sdUJBQXVCO0FBRzdCLFNBQVMsZUFBZSxTQUFpQixZQUFZLHNCQUErQjtBQUN6RixTQUFPLFVBQVU7QUFDbkI7QUFHTyxJQUFNLGFBQWE7QUFJbkIsU0FBUyxnQkFBZ0IsU0FBaUIsT0FBZSxNQUFnQixXQUEyQjtBQUN6RyxRQUFNLE9BQU8sS0FBSyxNQUFNLEtBQUs7QUFDN0IsU0FBTyxPQUFPLEtBQU0sUUFBUSxXQUFXLE9BQVEsWUFBWTtBQUM3RDtBQUtPLFNBQVMsaUJBQ2QsU0FDQSxPQUNBLE1BQ0EsV0FDQSxRQUNtQztBQUNuQyxRQUFNLE9BQU8sS0FBSyxNQUFNLEtBQUs7QUFDN0IsTUFBSSxFQUFFLE9BQU8sTUFBTSxFQUFFLFlBQVksR0FBSSxRQUFPLEVBQUUsTUFBTSxPQUFPLE9BQU8sTUFBTTtBQUN4RSxRQUFNLE1BQU0sT0FBTyxZQUFZO0FBQy9CLFNBQU87QUFBQSxJQUNMLE1BQU0sVUFBVSxLQUFLLFFBQVEsT0FBTyxRQUFRLE9BQU8sTUFBTSxTQUFTLEtBQUs7QUFBQSxJQUN2RSxPQUFPLFFBQVEsS0FBSyxNQUFNLE9BQU8sUUFBUSxTQUFTLE1BQU0sU0FBUyxLQUFLLFlBQVk7QUFBQSxFQUNwRjtBQUNGO0FBS08sSUFBTSx1QkFBdUI7QUFNN0IsSUFBTSxtQkFBbUIsS0FBSztBQTRCOUIsU0FBUyxnQkFDZCxPQUNBLE1BQ0EsV0FDQSxVQUFVLGtCQUNWLFlBQVksc0JBQ3dDO0FBQ3BELFFBQU0sV0FBVyxJQUFJLE1BQWMsTUFBTSxNQUFNLEVBQUUsS0FBSyxFQUFFO0FBQ3hELFFBQU0sV0FBNkIsQ0FBQztBQUNwQyxRQUFNLE9BQU8sS0FBSyxNQUFNLEtBQUs7QUFDN0IsTUFBSSxFQUFFLE9BQU8sTUFBTSxFQUFFLFlBQVksR0FBSSxRQUFPLEVBQUUsVUFBVSxTQUFTO0FBQ2pFLFFBQU0sVUFBVSxPQUFPO0FBQ3ZCLFFBQU0sVUFBVSxLQUFLLElBQUksR0FBRyxPQUFPLElBQUk7QUFDdkMsUUFBTSxlQUFlLFlBQVk7QUFDakMsUUFBTSxRQUFrQixDQUFDO0FBQ3pCLFdBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUs7QUFDckMsVUFBTSxLQUFLLE1BQU0sQ0FBQztBQUNsQixRQUFJLEdBQUcsT0FBTyxRQUFRLEdBQUcsTUFBTSxHQUFHLFNBQVMsYUFBYztBQUN6RCxVQUFNLEtBQUssQ0FBQztBQUFBLEVBQ2Q7QUFFQSxNQUFJLFNBQVM7QUFDYixXQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLO0FBQ3JDLFVBQU0sS0FBSyxNQUFNLE1BQU0sSUFBSSxDQUFDLENBQUM7QUFDN0IsVUFBTSxLQUFLLE1BQU0sTUFBTSxDQUFDLENBQUM7QUFDekIsUUFBSSxHQUFHLFFBQVEsR0FBRyxTQUFVLEdBQUcsVUFBVSxHQUFHLFNBQVMsR0FBRyxLQUFLLEdBQUcsSUFBSztBQUNuRSxlQUFTO0FBQ1Q7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNBLE1BQUksQ0FBQyxRQUFRO0FBQ1gsVUFBTSxLQUFLLENBQUMsR0FBRyxNQUFNO0FBQ25CLFlBQU0sS0FBSyxNQUFNLENBQUM7QUFDbEIsWUFBTSxLQUFLLE1BQU0sQ0FBQztBQUNsQixhQUFPLEdBQUcsUUFBUSxHQUFHLFVBQVUsR0FBRyxLQUFLLEdBQUcsS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLEtBQUssSUFBSTtBQUFBLElBQzFFLENBQUM7QUFBQSxFQUNIO0FBRUEsTUFBSSxjQUFjO0FBQ2xCLFdBQVMsS0FBSyxHQUFHLE1BQU0sTUFBTSxRQUFRLE1BQU07QUFDekMsVUFBTSxXQUFXLE9BQU8sTUFBTSxVQUFXLEtBQUssZUFBZSxNQUFNLE1BQU0sRUFBRSxDQUFDLEVBQUUsUUFBUSxNQUFNLE1BQU0sS0FBSyxDQUFDLENBQUMsRUFBRSxTQUFTO0FBQ3BILFFBQUksQ0FBQyxTQUFVO0FBQ2YsVUFBTSxNQUFNLEtBQUs7QUFDakIsUUFBSSxNQUFNLEdBQUc7QUFDWCxZQUFNLFVBQVUsSUFBSSxNQUFjLEdBQUc7QUFDckMsZUFBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLEtBQUs7QUFDNUIsY0FBTSxNQUFNLE1BQU0sY0FBYyxDQUFDO0FBQ2pDLGdCQUFRLENBQUMsSUFBSTtBQUNiLGlCQUFTLEdBQUcsSUFBSSxTQUFTO0FBQUEsTUFDM0I7QUFFQSxZQUFNLFFBQXVCLENBQUM7QUFDOUIsZUFBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLEtBQUs7QUFDNUIsY0FBTSxJQUFJLE1BQU0sUUFBUSxDQUFDLENBQUMsRUFBRTtBQUM1QixjQUFNLE9BQU8sTUFBTSxNQUFNLFNBQVMsQ0FBQztBQUNuQyxZQUFJLFNBQVMsVUFBYSxJQUFJLEtBQUssT0FBTyxRQUFTO0FBQ25ELFlBQUksU0FBUyxPQUFXLE1BQUssS0FBSztBQUNsQyxjQUFNLEtBQUssRUFBRSxNQUFNLEdBQUcsTUFBTSxHQUFHLElBQUksSUFBSSxDQUFDO0FBQUEsTUFDMUM7QUFDQSxlQUFTLEtBQUs7QUFBQSxRQUNaO0FBQUEsUUFDQSxRQUFRLEVBQUUsT0FBTyxNQUFNLFFBQVEsQ0FBQyxDQUFDLEVBQUUsT0FBTyxLQUFLLE1BQU0sUUFBUSxNQUFNLENBQUMsQ0FBQyxFQUFFLE1BQU07QUFBQSxRQUM3RTtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0g7QUFDQSxrQkFBYztBQUFBLEVBQ2hCO0FBQ0EsU0FBTyxFQUFFLFVBQVUsU0FBUztBQUM5QjtBQUdPLElBQU0seUJBQXlCO0FBTS9CLFNBQVMsZ0JBQWdCLFFBQW1CLFVBQVUsYUFBYSxXQUFXLHdCQUFrQztBQUNySCxRQUFNLE1BQU0sS0FBSyxJQUFJLEdBQUcsT0FBTyxNQUFNLE9BQU8sS0FBSztBQUNqRCxRQUFNLE9BQU8sS0FBSyxJQUFJLFdBQVcsSUFBSSxNQUFNLFdBQVcsS0FBSyxPQUFPO0FBQ2xFLFFBQU0sT0FBTyxPQUFPLFFBQVEsT0FBTyxPQUFPO0FBQzFDLFNBQU8sRUFBRSxPQUFPLE1BQU0sT0FBTyxHQUFHLEtBQUssTUFBTSxPQUFPLEVBQUU7QUFDdEQ7QUFTTyxTQUFTLGtCQUFrQixRQUFtQixNQUFnQixVQUFpQztBQUNwRyxNQUFJLE9BQU8sTUFBTSxLQUFLLFNBQVMsT0FBTyxRQUFRLEtBQUssSUFBSyxRQUFPO0FBQy9ELFFBQU0sT0FBTyxPQUFPLFFBQVEsT0FBTyxPQUFPO0FBQzFDLE1BQUksS0FBSyxLQUFLLElBQUksT0FBTyxPQUFPLEtBQUssUUFBUSxRQUFRO0FBQ3JELE1BQUksS0FBSyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssTUFBTSxRQUFRO0FBQ2pELE1BQUksS0FBSyxJQUFJO0FBRVgsU0FBSyxLQUFLLElBQUksT0FBTyxPQUFPLEtBQUssS0FBSztBQUN0QyxTQUFLLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxHQUFHO0FBQUEsRUFDcEM7QUFDQSxTQUFPLEtBQUssSUFBSSxLQUFLLElBQUksS0FBSyxFQUFFLEdBQUcsRUFBRTtBQUN2QztBQUtPLElBQU0sd0JBQXdCO0FBRTlCLElBQU0sd0JBQXdCO0FBcUI5QixTQUFTLGNBQ2QsZUFDQSxXQUNBLEtBQ0Esa0JBQWlDLE1BQ2pDLGVBQThCLE1BQzlCLFlBQVksS0FDSztBQUNqQixNQUFJLFFBQVE7QUFDWixNQUFJLGlCQUFpQixLQUFNLFNBQVEsS0FBSyxJQUFJLE9BQU8sYUFBYTtBQUNoRSxNQUFJLGdCQUFnQixLQUFNLFNBQVEsS0FBSyxJQUFJLE9BQU8sWUFBWTtBQUM5RCxNQUFJLG1CQUFtQixLQUFNLFNBQVEsS0FBSyxJQUFJLE9BQU8sZUFBZTtBQUNwRSxNQUFJLENBQUMsT0FBTyxTQUFTLEtBQUssRUFBRyxRQUFPO0FBQ3BDLFFBQU0sTUFBTSxhQUFhLFFBQVEsWUFBWSxNQUFNLFlBQVk7QUFDL0QsTUFBSSxNQUFNLFFBQVEsVUFBVyxTQUFRLE1BQU07QUFDM0MsU0FBTyxFQUFFLE9BQU8sSUFBSTtBQUN0QjtBQVdPLFNBQVMsa0JBQ2QsTUFDQSxRQUNBLE9BQ0EsUUFBUSx1QkFDVztBQUNuQixNQUFJLEVBQUUsT0FBTyxNQUFNLE9BQU8sUUFBUSxNQUFNLEVBQUUsUUFBUSxHQUFJLFFBQU8sRUFBRSxJQUFJLEdBQUcsSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLLEVBQUU7QUFDN0YsTUFBSSxLQUFLLFFBQVEsS0FBSyxPQUFPLFFBQVEsS0FBSztBQUMxQyxNQUFJLEtBQUssUUFBUSxLQUFLLEtBQUssUUFBUSxLQUFLO0FBQ3hDLE1BQUksS0FBSyxLQUFLLE9BQU87QUFDbkIsVUFBTSxLQUFLLEtBQUssTUFBTTtBQUN0QixTQUFLLElBQUksUUFBUTtBQUNqQixTQUFLLElBQUksUUFBUTtBQUFBLEVBQ25CO0FBQ0EsTUFBSSxNQUFNLEVBQUcsUUFBTyxFQUFFLElBQUksR0FBRyxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssRUFBRTtBQUN4RCxNQUFJLE1BQU0sTUFBTyxRQUFPLEVBQUUsSUFBSSxLQUFLLElBQUksR0FBRyxRQUFRLEtBQUssR0FBRyxJQUFJLE1BQU07QUFDcEUsU0FBTyxFQUFFLElBQUksS0FBSyxJQUFJLEdBQUcsRUFBRSxHQUFHLElBQUksS0FBSyxJQUFJLE9BQU8sRUFBRSxFQUFFO0FBQ3hEO0FBV08sU0FBUyxlQUFlLEdBQVcsTUFBeUIsUUFBUSx1QkFBb0M7QUFDN0csUUFBTSxVQUFVLEtBQUssSUFBSSxRQUFRLEtBQUssS0FBSyxLQUFLLE1BQU0sQ0FBQztBQUN2RCxRQUFNLFVBQVUsS0FBSyxLQUFLLEtBQUssU0FBUyxLQUFLLEtBQUssS0FBSztBQUN2RCxRQUFNLFdBQVcsS0FBSyxLQUFLLEtBQUssV0FBVyxLQUFLLEtBQUssS0FBSztBQUMxRCxNQUFJLFdBQVcsU0FBVSxRQUFPLElBQUksS0FBSyxNQUFNLEtBQUssS0FBSyxJQUFJLGdCQUFnQjtBQUM3RSxNQUFJLFFBQVMsUUFBTztBQUNwQixNQUFJLFNBQVUsUUFBTztBQUNyQixNQUFJLElBQUksS0FBSyxNQUFNLElBQUksS0FBSyxHQUFJLFFBQU87QUFDdkMsU0FBTyxJQUFJLEtBQUssS0FBSyxXQUFXO0FBQ2xDO0FBR0EsU0FBUyxvQkFBb0IsTUFBZ0IsUUFBNEI7QUFDdkUsUUFBTSxPQUFPLEtBQUssTUFBTSxLQUFLO0FBQzdCLE1BQUksUUFBUSxPQUFPLE1BQU0sT0FBTyxNQUFPLFFBQU8sRUFBRSxPQUFPLE9BQU8sTUFBTSxNQUFNLEtBQUssT0FBTyxJQUFJO0FBQzFGLE1BQUksS0FBSyxRQUFRLE9BQU8sTUFBTyxRQUFPLEVBQUUsT0FBTyxPQUFPLE9BQU8sS0FBSyxPQUFPLFFBQVEsS0FBSztBQUN0RixNQUFJLEtBQUssTUFBTSxPQUFPLElBQUssUUFBTyxFQUFFLE9BQU8sT0FBTyxNQUFNLE1BQU0sS0FBSyxPQUFPLElBQUk7QUFDOUUsU0FBTztBQUNUO0FBR08sU0FBUyxXQUFXLE1BQWdCLE1BQWMsUUFBa0IsT0FBeUI7QUFDbEcsTUFBSSxFQUFFLE9BQU8sTUFBTSxPQUFPLFFBQVEsTUFBTSxFQUFFLFFBQVEsR0FBSSxRQUFPLEVBQUUsT0FBTyxLQUFLLE9BQU8sS0FBSyxLQUFLLElBQUk7QUFDaEcsU0FBTyxvQkFBb0IsUUFBUSxNQUFPLFFBQVEsT0FBTyxNQUFNLE9BQU8sU0FBVSxLQUFLLEdBQUcsTUFBTTtBQUNoRztBQVVPLFNBQVMsY0FDZCxNQUNBLE1BQ0EsS0FDQSxRQUNBLE9BQ0EsVUFBVSxhQUNWLFVBQVUsYUFDQTtBQUNWLE1BQUksRUFBRSxPQUFPLE1BQU0sT0FBTyxRQUFRLE1BQU0sRUFBRSxRQUFRLEdBQUksUUFBTyxFQUFFLE9BQU8sS0FBSyxPQUFPLEtBQUssS0FBSyxJQUFJO0FBQ2hHLFFBQU0sSUFBSSxRQUFRLEtBQUssSUFBSSxLQUFLLElBQUksS0FBSyxDQUFDLEdBQUcsS0FBSyxHQUFHLFFBQVEsS0FBSztBQUNsRSxNQUFJLFNBQVMsUUFBUTtBQUNuQixVQUFNLFFBQVEsS0FBSyxJQUFJLEtBQUssSUFBSSxHQUFHLE9BQU8sT0FBTyxLQUFLLE1BQU0sT0FBTyxHQUFHLEtBQUssTUFBTSxPQUFPO0FBQ3hGLFdBQU8sRUFBRSxPQUFPLEtBQUssS0FBSyxJQUFJO0FBQUEsRUFDaEM7QUFDQSxRQUFNLE1BQU0sS0FBSyxJQUFJLEtBQUssSUFBSSxHQUFHLE9BQU8sS0FBSyxLQUFLLFFBQVEsT0FBTyxHQUFHLEtBQUssUUFBUSxPQUFPO0FBQ3hGLFNBQU8sRUFBRSxPQUFPLEtBQUssT0FBTyxJQUFJO0FBQ2xDO0FBR08sU0FBUyxjQUFjLE1BQWdCLEtBQWEsUUFBa0IsT0FBeUI7QUFDcEcsTUFBSSxFQUFFLE9BQU8sTUFBTSxPQUFPLFFBQVEsTUFBTSxFQUFFLFFBQVEsR0FBSSxRQUFPLEVBQUUsT0FBTyxLQUFLLE9BQU8sS0FBSyxLQUFLLElBQUk7QUFDaEcsUUFBTSxPQUFPLEtBQUssTUFBTSxLQUFLO0FBQzdCLFFBQU0sSUFBSSxRQUFRLEtBQUssSUFBSSxLQUFLLElBQUksS0FBSyxDQUFDLEdBQUcsS0FBSyxHQUFHLFFBQVEsS0FBSztBQUNsRSxTQUFPLG9CQUFvQixFQUFFLE9BQU8sSUFBSSxPQUFPLEdBQUcsS0FBSyxJQUFJLE9BQU8sRUFBRSxHQUFHLE1BQU07QUFDL0U7QUFnQk8sU0FBUyxlQUFlLE1BQWUsSUFBYSxVQUFVLElBQWdDO0FBQ25HLFFBQU0sS0FBSyxLQUFLLElBQUksS0FBSztBQUN6QixRQUFNLEtBQUssS0FBSyxJQUFJLEtBQUssSUFBSTtBQUM3QixRQUFNLEtBQUssR0FBRztBQUNkLFFBQU0sS0FBSyxHQUFHLElBQUksR0FBRyxJQUFJO0FBQ3pCLE1BQUksS0FBSyxJQUFJLEtBQUssRUFBRSxJQUFJLE9BQU8sTUFBTSxJQUFJO0FBQ3ZDLFdBQU87QUFBQSxNQUNMLEVBQUUsR0FBRyxJQUFJLEdBQUcsR0FBRztBQUFBLE1BQ2YsRUFBRSxHQUFHLElBQUksR0FBRyxHQUFHO0FBQUEsSUFDakI7QUFBQSxFQUNGO0FBQ0EsUUFBTSxJQUFJLEtBQUssSUFBSSxJQUFJLEtBQUssSUFBSSxJQUFJLEtBQUssSUFBSSxLQUFLLEVBQUUsSUFBSSxLQUFLLEtBQUssSUFBSSxLQUFLLEVBQUUsSUFBSSxJQUFJLENBQUM7QUFDdEYsUUFBTSxNQUFrQyxDQUFDO0FBQ3pDLFFBQU0sSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sT0FBTyxDQUFDO0FBQ3pDLFdBQVMsSUFBSSxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQzNCLFVBQU0sSUFBSSxJQUFJO0FBQ2QsVUFBTSxJQUFJLElBQUk7QUFDZCxRQUFJLEtBQUs7QUFBQSxNQUNQLEdBQUcsSUFBSSxJQUFJLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxLQUFLLEtBQUssS0FBSyxJQUFJLElBQUksSUFBSSxLQUFLLEtBQUssS0FBSyxJQUFJLElBQUksSUFBSTtBQUFBLE1BQ3RGLEdBQUcsSUFBSSxJQUFJLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxJQUFJLEtBQUssSUFBSSxJQUFJLElBQUksSUFBSSxLQUFLLElBQUksSUFBSSxJQUFJO0FBQUEsSUFDNUUsQ0FBQztBQUFBLEVBQ0g7QUFDQSxTQUFPO0FBQ1Q7QUFxQk8sU0FBUyxjQUNkLFVBQ0EsZUFDQSxhQUNBLEdBQ21CO0FBQ25CLE1BQUksQ0FBQyxTQUFVLFFBQU87QUFDdEIsV0FBUyxJQUFJLFNBQVMsU0FBUyxHQUFHLEtBQUssR0FBRyxLQUFLO0FBQzdDLFVBQU0sSUFBSSxTQUFTLENBQUM7QUFDcEIsVUFBTSxLQUFLLEtBQUssSUFBSSxLQUFLLEVBQUUsS0FBSyxHQUFHLGFBQWE7QUFDaEQsVUFBTSxLQUFLLEtBQUssSUFBSSxFQUFFLE9BQU8sT0FBTyxjQUFjLEtBQUssRUFBRSxHQUFHLEdBQUcsV0FBVztBQUMxRSxRQUFJLEtBQUssR0FBSTtBQUNiLFFBQUksS0FBSyxPQUFPLElBQUksTUFBTyxNQUFNLE1BQU0sT0FBTyxjQUFlO0FBQzNELGFBQU8sRUFBRSxPQUFPLEdBQUcsTUFBTSxFQUFFLE1BQU0sT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLElBQ3REO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQXdDTyxJQUFNLGlCQUEyQjtBQUFBLEVBQ3RDLElBQUksRUFBRSxTQUFTLFFBQVE7QUFBQSxFQUN2QixVQUFVLEVBQUUsU0FBUyxXQUFXLFFBQVEsRUFBRSxPQUFPLEdBQUcsVUFBVSxLQUFLLEdBQUcsT0FBTyxPQUFPO0FBQUEsRUFDcEYsUUFBUSxFQUFFLFNBQVMsV0FBVyxRQUFRLEVBQUUsT0FBTyxHQUFHLFVBQVUsS0FBSyxHQUFHLE9BQU8sT0FBTztBQUFBLEVBQ2xGLEtBQUssRUFBRSxTQUFTLFNBQVMsUUFBUSxLQUFLO0FBQUEsRUFDdEMsUUFBUSxFQUFFLFNBQVMsU0FBUyxRQUFRLEtBQUs7QUFBQSxFQUN6QyxPQUFPLEVBQUUsU0FBUyxTQUFTLFFBQVEsS0FBSztBQUFBLEVBQ3hDLFNBQVMsRUFBRSxTQUFTLFNBQVMsUUFBUSxLQUFLO0FBQUEsRUFDMUMsU0FBUyxFQUFFLFNBQVMsVUFBVTtBQUFBLEVBQzlCLFdBQVcsRUFBRSxTQUFTLFdBQVcsUUFBUSxFQUFFLE9BQU8sS0FBSyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRTtBQUN4RTtBQVdPLFNBQVMsWUFBWSxRQUEyQztBQUNyRSxRQUFNLFNBQVMsT0FDWixPQUFPLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQzdCLE1BQU0sRUFDTixLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsUUFBUSxFQUFFLEtBQUs7QUFDbkMsUUFBTSxNQUFtQixDQUFDO0FBQzFCLGFBQVcsS0FBSyxRQUFRO0FBQ3RCLFVBQU0sT0FBTyxJQUFJLElBQUksU0FBUyxDQUFDO0FBQy9CLFFBQUksUUFBUSxFQUFFLFNBQVMsS0FBSyxLQUFLO0FBQy9CLFVBQUksRUFBRSxNQUFNLEtBQUssSUFBSyxNQUFLLE1BQU0sRUFBRTtBQUFBLElBQ3JDLE9BQU87QUFDTCxVQUFJLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxLQUFLLEVBQUUsSUFBSSxDQUFDO0FBQUEsSUFDekM7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBR08sU0FBUyxlQUFlLE1BQWlCLFFBQTJDO0FBQ3pGLFFBQU0sTUFBbUIsQ0FBQztBQUMxQixNQUFJLFNBQVMsS0FBSztBQUNsQixhQUFXLEtBQUssUUFBUTtBQUN0QixRQUFJLEVBQUUsT0FBTyxPQUFRO0FBQ3JCLFFBQUksRUFBRSxTQUFTLEtBQUssSUFBSztBQUN6QixRQUFJLEVBQUUsUUFBUSxPQUFRLEtBQUksS0FBSyxFQUFFLE9BQU8sUUFBUSxLQUFLLEtBQUssSUFBSSxFQUFFLE9BQU8sS0FBSyxHQUFHLEVBQUUsQ0FBQztBQUNsRixhQUFTLEtBQUssSUFBSSxRQUFRLEVBQUUsR0FBRztBQUMvQixRQUFJLFVBQVUsS0FBSyxJQUFLO0FBQUEsRUFDMUI7QUFDQSxNQUFJLFNBQVMsS0FBSyxJQUFLLEtBQUksS0FBSyxFQUFFLE9BQU8sUUFBUSxLQUFLLEtBQUssSUFBSSxDQUFDO0FBQ2hFLFNBQU87QUFDVDtBQUtPLFNBQVMsYUFBYSxNQUFnQixLQUFhLFlBQTJCLGVBQWUsTUFBd0I7QUFDMUgsUUFBTSxPQUFPLEtBQUssTUFBTSxLQUFLO0FBQzdCLE1BQUksTUFBTSxLQUFLLElBQUksS0FBSyxLQUFLLEdBQUc7QUFDaEMsTUFBSSxlQUFlLFFBQVEsYUFBYSxJQUFLLE9BQU07QUFDbkQsUUFBTSxRQUFRLEtBQUssUUFBUSxPQUFPO0FBQ2xDLFNBQU8sTUFBTSxRQUFRLEVBQUUsT0FBTyxJQUFJLElBQUk7QUFDeEM7QUFrQk8sSUFBTSxrQkFBTixNQUFzQjtBQUFBLEVBQ25CLFVBQXVCLENBQUM7QUFBQSxFQUN4QixXQUE2QjtBQUFBLEVBQzdCO0FBQUEsRUFDQTtBQUFBLEVBQ0EsVUFBVTtBQUFBO0FBQUEsRUFFbEIsa0JBQWlDO0FBQUEsRUFFakMsWUFBWSxPQUF3QixDQUFDLEdBQUc7QUFDdEMsU0FBSyxXQUFXLEtBQUssY0FBYztBQUNuQyxTQUFLLGFBQWEsS0FBSyxXQUFXO0FBQUEsRUFDcEM7QUFBQTtBQUFBLEVBR0EsV0FBVyxPQUFlLEtBQW1CO0FBQzNDLFFBQUksRUFBRSxNQUFNLE9BQVE7QUFDcEIsU0FBSyxVQUFVLFlBQVksQ0FBQyxHQUFHLEtBQUssU0FBUyxFQUFFLE9BQU8sSUFBSSxDQUFDLENBQUM7QUFBQSxFQUM5RDtBQUFBO0FBQUEsRUFHQSxnQkFBc0M7QUFDcEMsV0FBTyxLQUFLO0FBQUEsRUFDZDtBQUFBO0FBQUEsRUFHQSxhQUE0QjtBQUMxQixVQUFNLE9BQU8sS0FBSyxRQUFRLEtBQUssUUFBUSxTQUFTLENBQUM7QUFDakQsV0FBTyxPQUFPLEtBQUssTUFBTTtBQUFBLEVBQzNCO0FBQUE7QUFBQSxFQUdBLFVBQTRCO0FBQzFCLFdBQU8sS0FBSztBQUFBLEVBQ2Q7QUFBQTtBQUFBO0FBQUEsRUFJQSxhQUFhLEtBQXNCO0FBQ2pDLFdBQU8sS0FBSyxhQUFhLFFBQVEsTUFBTSxLQUFLO0FBQUEsRUFDOUM7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFPQSxZQUFZLE1BQThCO0FBQ3hDLFFBQUksT0FBTyxlQUFlLE1BQU0sS0FBSyxPQUFPO0FBQzVDLFVBQU0sS0FBSyxLQUFLO0FBQ2hCLFFBQUksTUFBTSxNQUFNO0FBQ2QsYUFBTyxLQUFLLE9BQU8sQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLEVBQUUsSUFBSSxDQUFDLE1BQU8sRUFBRSxRQUFRLEtBQUssRUFBRSxPQUFPLElBQUksS0FBSyxFQUFFLElBQUksSUFBSSxDQUFFO0FBQUEsSUFDakc7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQVVBLFlBQVksTUFBZ0IsS0FBK0I7QUFDekQsUUFBSSxLQUFLLFlBQVksTUFBTSxLQUFLLFFBQVMsUUFBTztBQUNoRCxVQUFNLE9BQU8sS0FBSyxZQUFZLEVBQUUsT0FBTyxLQUFLLE9BQU8sS0FBSyxLQUFLLElBQUksQ0FBQztBQUNsRSxRQUFJLEtBQUssV0FBVyxFQUFHLFFBQU87QUFDOUIsVUFBTSxNQUFNLEtBQUssS0FBSyxTQUFTLENBQUM7QUFDaEMsVUFBTSxNQUFpQixFQUFFLE9BQU8sSUFBSSxPQUFPLEtBQUssSUFBSSxJQUFJO0FBQ3hELFFBQUksSUFBSSxNQUFNLElBQUksUUFBUSxLQUFLLFNBQVUsS0FBSSxRQUFRLElBQUksTUFBTSxLQUFLO0FBQ3BFLFVBQU0sS0FBSyxLQUFLO0FBQ2hCLFFBQUksTUFBTSxRQUFRLElBQUksUUFBUSxHQUFJLEtBQUksUUFBUTtBQUM5QyxRQUFJLEVBQUUsSUFBSSxNQUFNLElBQUksT0FBUSxRQUFPO0FBQ25DLFNBQUssV0FBVztBQUNoQixXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUEsRUFHQSxPQUFPLE9BQWtCLFFBQThDLE1BQU0sR0FBUztBQUNwRixRQUFJLENBQUMsS0FBSyxZQUFZLEtBQUssU0FBUyxVQUFVLE1BQU0sU0FBUyxLQUFLLFNBQVMsUUFBUSxNQUFNLElBQUs7QUFDOUYsU0FBSyxXQUFXO0FBQ2hCLFFBQUksQ0FBQyxPQUFPLElBQUk7QUFFZCxXQUFLLFVBQVUsTUFBTSxLQUFLO0FBQzFCO0FBQUEsSUFDRjtBQUNBLFNBQUssVUFBVTtBQUNmLFNBQUssV0FBVyxNQUFNLE9BQU8sTUFBTSxHQUFHO0FBQ3RDLFFBQUksT0FBTyxXQUFXO0FBQ3BCLFlBQU0sUUFBUSxLQUFLLFFBQVEsQ0FBQztBQUM1QixXQUFLLGtCQUFrQixRQUFRLE1BQU0sUUFBUSxNQUFNO0FBQUEsSUFDckQ7QUFBQSxFQUNGO0FBQ0Y7QUFRTyxJQUFNLGdCQUFnQixNQUFPO0FBRTdCLElBQU0sd0JBQXdCO0FBSzlCLFNBQVMsY0FBYyxNQUEwQjtBQUN0RCxNQUFJLFNBQVMsT0FBUSxRQUFPO0FBQzVCLE1BQUksU0FBUyxlQUFnQixRQUFPO0FBQ3BDLFNBQU87QUFDVDtBQUlPLFNBQVMsYUFBYSxPQUFlLGNBQXNCLFVBQWtCLGdCQUFnQixNQUFlO0FBQ2pILE1BQUksWUFBWSxFQUFHLFFBQU87QUFDMUIsU0FBTyxRQUFRLGdCQUFnQixXQUFXLGdCQUFnQjtBQUM1RDtBQU1PLFNBQVMsa0JBQWtCLE1BQWdCLGNBQXNCLEtBQWEsY0FBOEI7QUFDakgsUUFBTSxPQUFPLEtBQUssTUFBTSxLQUFLO0FBQzdCLFFBQU0sT0FBTyxlQUFlO0FBQzVCLE1BQUksQ0FBQyxPQUFPLFNBQVMsSUFBSSxLQUFLLFFBQVEsS0FBSyxDQUFDLE9BQU8sU0FBUyxJQUFJLEtBQUssUUFBUSxFQUFHLFFBQU87QUFDdkYsU0FBTyxLQUFLLElBQUksY0FBYyxPQUFPLElBQUk7QUFDM0M7OztBSHIvQ0EsSUFBTSxPQUFPO0FBQ2IsSUFBTSxNQUFNO0FBSVosS0FBSyw2Q0FBNkMsTUFBTTtBQUN0RCxTQUFPLE1BQU0sS0FBSyxJQUFJLEdBQUcsSUFBSTtBQUM3QixTQUFPLE1BQU0sS0FBSyxvQkFBSSxLQUFLLEtBQUssQ0FBQyxHQUFHLEtBQUs7QUFDM0MsQ0FBQztBQUVELEtBQUssd0RBQXdELE1BQU07QUFDakUsUUFBTSxPQUFpQixFQUFFLE9BQU8sS0FBTSxLQUFLLElBQUs7QUFDaEQsU0FBTyxNQUFNLFFBQVEsS0FBTSxNQUFNLEdBQUcsR0FBRyxDQUFDO0FBQ3hDLFNBQU8sTUFBTSxRQUFRLEtBQU0sTUFBTSxHQUFHLEdBQUcsR0FBRztBQUMxQyxTQUFPLE1BQU0sUUFBUSxNQUFNLE1BQU0sR0FBRyxHQUFHLEdBQUc7QUFDMUMsU0FBTyxNQUFNLFFBQVEsS0FBSyxNQUFNLEdBQUcsR0FBRyxJQUFJO0FBQzFDLGFBQVcsS0FBSyxDQUFDLEdBQUcsTUFBTSxLQUFLLEdBQUcsR0FBRztBQUNuQyxXQUFPLEdBQUcsS0FBSyxJQUFJLFFBQVEsUUFBUSxHQUFHLE1BQU0sR0FBRyxHQUFHLE1BQU0sR0FBRyxJQUFJLENBQUMsSUFBSSxNQUFNLGNBQWMsQ0FBQyxFQUFFO0FBQUEsRUFDN0Y7QUFDRixDQUFDO0FBRUQsS0FBSyxrREFBa0QsTUFBTTtBQUMzRCxRQUFNLElBQUksUUFBUSxFQUFFLE9BQU8sS0FBSyxLQUFLLElBQUksR0FBRyxFQUFFO0FBQzlDLFNBQU8sVUFBVSxHQUFHLEVBQUUsT0FBTyxLQUFLLEtBQUssSUFBSSxDQUFDO0FBQzlDLENBQUM7QUFJRCxLQUFLLDhEQUE4RCxNQUFNO0FBQ3ZFLFFBQU0sUUFBUTtBQUNkLE1BQUksT0FBTztBQUNYLFFBQU0sT0FBTyxNQUFjO0FBQ3pCLFdBQVEsT0FBTyxhQUFhLFFBQVM7QUFDckMsV0FBTyxPQUFPO0FBQUEsRUFDaEI7QUFDQSxXQUFTLElBQUksR0FBRyxJQUFJLEtBQUssS0FBSztBQUM1QixVQUFNLFFBQVEsS0FBSyxJQUFJO0FBQ3ZCLFVBQU0sT0FBTyxjQUFjLElBQUksS0FBSyxLQUFLLGNBQWM7QUFDdkQsVUFBTSxPQUFpQixFQUFFLE9BQU8sS0FBSyxRQUFRLEtBQUs7QUFDbEQsVUFBTSxJQUFJLEtBQUssSUFBSTtBQUNuQixVQUFNLFNBQVMsUUFBUSxHQUFHLE1BQU0sS0FBSztBQUNyQyxVQUFNLFNBQVMsS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLElBQUksQ0FBQztBQUN6QyxVQUFNLFNBQVMsU0FBUyxNQUFNLFFBQVEsTUFBTTtBQUM1QyxVQUFNLFNBQVMsUUFBUSxRQUFRLFFBQVEsS0FBSztBQUM1QyxXQUFPLEdBQUcsS0FBSyxJQUFJLFNBQVMsQ0FBQyxJQUFJLE9BQU8sT0FBTyx1QkFBdUIsQ0FBQyxPQUFPLE1BQU0sRUFBRTtBQUFBLEVBQ3hGO0FBQ0YsQ0FBQztBQUVELEtBQUssZ0VBQWdFLE1BQU07QUFDekUsUUFBTSxPQUFpQixFQUFFLE9BQU8sR0FBRyxLQUFLLElBQVE7QUFDaEQsUUFBTSxJQUFJLFNBQVMsTUFBTSxLQUFRLENBQUM7QUFDbEMsU0FBTyxHQUFHLEtBQUssSUFBSSxFQUFFLE1BQU0sRUFBRSxRQUFRLEdBQU0sSUFBSSxJQUFJO0FBQ3JELENBQUM7QUFFRCxLQUFLLHFGQUFxRixNQUFNO0FBQzlGLFFBQU0sT0FBTyxTQUFTLEVBQUUsT0FBTyxHQUFHLEtBQUssY0FBYyxFQUFFLEdBQUcsYUFBYSxHQUFHO0FBQzFFLFNBQU8sTUFBTSxLQUFLLE1BQU0sS0FBSyxPQUFPLFdBQVc7QUFDL0MsU0FBTyxHQUFHLEtBQUssS0FBSyxjQUFjLEtBQUssVUFBVSxLQUFLLE1BQU0sS0FBSyxTQUFTLEdBQUcsSUFBSSxJQUFJO0FBRXJGLFFBQU0sT0FBTyxTQUFTLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBSSxHQUFHLE1BQU0sR0FBRyxJQUFJO0FBQzNELFNBQU8sTUFBTSxLQUFLLE1BQU0sS0FBSyxPQUFPLFdBQVc7QUFDL0MsU0FBTyxHQUFHLEtBQUssS0FBSyxNQUFNLElBQUksS0FBSyxTQUFTLGNBQWMsSUFBSSxJQUFJLElBQUk7QUFDeEUsQ0FBQztBQUVELEtBQUssNENBQTRDLE1BQU07QUFDckQsUUFBTSxPQUFpQixFQUFFLE9BQU8sR0FBRyxLQUFLLElBQU87QUFDL0MsU0FBTyxVQUFVLFNBQVMsTUFBTSxLQUFPLEdBQUcsR0FBRyxJQUFJO0FBQ2pELFNBQU8sVUFBVSxTQUFTLE1BQU0sS0FBTyxDQUFDLEdBQUcsSUFBSTtBQUMvQyxTQUFPLFVBQVUsU0FBUyxNQUFNLEtBQU8sRUFBRSxHQUFHLElBQUk7QUFDbEQsQ0FBQztBQUlELEtBQUssa0VBQWtFLE1BQU07QUFDM0UsU0FBTyxNQUFNLG1CQUFtQixLQUFLLENBQUMsR0FBRyxHQUFHO0FBQzVDLFNBQU8sTUFBTSxtQkFBbUIsTUFBTSxDQUFDLEdBQUcsSUFBSTtBQUM5QyxTQUFPLE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxHQUFHLEVBQUU7QUFDekMsU0FBTyxNQUFNLG1CQUFtQixHQUFHLEdBQUcsRUFBRSxHQUFHLEVBQUU7QUFDN0MsU0FBTyxNQUFNLG1CQUFtQixHQUFHLENBQUMsR0FBRyxHQUFHO0FBQzFDLFNBQU8sTUFBTSxtQkFBbUIsSUFBSSxHQUFHLElBQUksR0FBRyxHQUFHLElBQUs7QUFDdEQsU0FBTyxNQUFNLG1CQUFtQixLQUFLLENBQUMsR0FBRyxDQUFDO0FBQzVDLENBQUM7QUFFRCxLQUFLLDZFQUE2RSxNQUFNO0FBQ3RGLFNBQU8sTUFBTSxtQkFBbUIsQ0FBQyxHQUFHLENBQUM7QUFDckMsU0FBTyxNQUFNLG1CQUFtQixDQUFDLGtCQUFrQixHQUFHLENBQUM7QUFDdkQsU0FBTyxNQUFNLG1CQUFtQixrQkFBa0IsR0FBRyxHQUFHO0FBQ3hELFFBQU0sSUFBSSxtQkFBbUIsR0FBRyxJQUFJLG1CQUFtQixHQUFHO0FBQzFELFFBQU0sSUFBSSxtQkFBbUIsSUFBSTtBQUNqQyxTQUFPLEdBQUcsS0FBSyxJQUFJLElBQUksQ0FBQyxJQUFJLE9BQU8sc0NBQXNDO0FBQzNFLENBQUM7QUFJRCxLQUFLLDZEQUE2RCxNQUFNO0FBQ3RFLFNBQU8sTUFBTSxxQkFBcUIsTUFBTSxHQUFHLEdBQUcsbUJBQW1CO0FBQ2pFLFNBQU8sTUFBTSxxQkFBcUIsTUFBTSxJQUFJLEdBQUcsbUJBQW1CO0FBQ2xFLFNBQU8sTUFBTSxxQkFBcUIsSUFBTztBQUMzQyxDQUFDO0FBRUQsS0FBSyx5RUFBeUUsTUFBTTtBQUNsRixTQUFPLEdBQUcsS0FBSyxJQUFJLHFCQUFxQixNQUFNLEdBQUcsSUFBSSx1QkFBdUIsS0FBSyxHQUFHLElBQUksSUFBSTtBQUM1RixTQUFPLEdBQUcsS0FBSyxJQUFJLHFCQUFxQixLQUFLLEdBQUcsSUFBSSx1QkFBdUIsSUFBSSxHQUFHLElBQUksSUFBSTtBQUUxRixTQUFPLEdBQUcsS0FBSyxJQUFJLHFCQUFxQixNQUFNLEdBQUcsSUFBSSxJQUFJLHFCQUFxQixNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUk7QUFFaEcsU0FBTyxNQUFNLHFCQUFxQixLQUFLLEVBQUUsR0FBRyxxQkFBcUIsTUFBTSxJQUFJLENBQUM7QUFDOUUsQ0FBQztBQUVELEtBQUssbUZBQW1GLE1BQU07QUFDNUYsU0FBTyxNQUFNLHFCQUFxQixHQUFHLEdBQUcsR0FBRyxtQkFBbUI7QUFDOUQsU0FBTyxNQUFNLHFCQUFxQixNQUFNLENBQUMsR0FBRyxtQkFBbUI7QUFDL0QsU0FBTyxNQUFNLHFCQUFxQixHQUFHLENBQUMsR0FBRyxtQkFBbUI7QUFDNUQsU0FBTyxNQUFNLHFCQUFxQixJQUFJLEdBQUcsR0FBRyxtQkFBbUI7QUFDL0QsU0FBTyxNQUFNLHFCQUFxQixLQUFLLEdBQUcsR0FBRyxtQkFBbUI7QUFDaEUsU0FBTyxNQUFNLHFCQUFxQixNQUFNLFFBQVEsR0FBRyxtQkFBbUI7QUFDeEUsQ0FBQztBQUVELEtBQUssaUZBQWlGLE1BQU07QUFDMUYsU0FBTyxNQUFNLHFCQUFxQixLQUFLLENBQUMsR0FBRyxXQUFXO0FBQ3RELFNBQU8sTUFBTSxxQkFBcUIsR0FBRyxHQUFHLEdBQUcsV0FBVztBQUV0RCxRQUFNLE9BQU8scUJBQXFCLEtBQU0sR0FBRztBQUMzQyxTQUFPLEdBQUcsT0FBTyx1QkFBdUIsT0FBTyxXQUFXO0FBQzVELENBQUM7QUFJRCxLQUFLLHNFQUFzRSxNQUFNO0FBQy9FLFNBQU8sTUFBTSxhQUFhLEtBQU8sQ0FBQyxHQUFHLEdBQUc7QUFDeEMsU0FBTyxNQUFNLGFBQWEsS0FBUSxDQUFDLEdBQUcsR0FBTTtBQUM1QyxTQUFPLE1BQU0sYUFBYSxLQUFLLEtBQVEsQ0FBQyxHQUFHLEdBQU87QUFDbEQsU0FBTyxNQUFNLGFBQWEsSUFBSSxNQUFNLENBQUMsR0FBRyxJQUFJO0FBQzVDLFNBQU8sTUFBTSxhQUFhLElBQUksS0FBSyxDQUFDLEdBQUcsSUFBSSxJQUFJO0FBQy9DLFNBQU8sTUFBTSxhQUFhLElBQUksS0FBSyxDQUFDLEdBQUcsR0FBRztBQUMxQyxTQUFPLE1BQU0sYUFBYSxNQUFNLENBQUMsR0FBRyxnQkFBZ0IsZ0JBQWdCLFNBQVMsQ0FBQyxDQUFDO0FBQ2pGLENBQUM7QUFFRCxLQUFLLHlFQUF5RSxNQUFNO0FBQ2xGLGFBQVcsUUFBUSxDQUFDLEtBQU8sTUFBUSxLQUFLLEtBQVEsSUFBSSxNQUFNLElBQUksR0FBRyxHQUFHO0FBQ2xFLFVBQU0sT0FBaUIsRUFBRSxPQUFPLGVBQW1CLEtBQUssZ0JBQW9CLEtBQUs7QUFDakYsVUFBTSxRQUFRLFVBQVUsTUFBTSxDQUFDO0FBQy9CLFVBQU0sT0FBTyxhQUFhLE1BQU0sQ0FBQztBQUNqQyxXQUFPLEdBQUcsTUFBTSxVQUFVLEdBQUcsc0JBQXNCLElBQUksRUFBRTtBQUN6RCxXQUFPLEdBQUcsTUFBTSxVQUFVLEdBQUcsU0FBUyxNQUFNLE1BQU0sa0JBQWtCLElBQUksRUFBRTtBQUMxRSxlQUFXLEtBQUssT0FBTztBQUNyQixhQUFPLEdBQUcsS0FBSyxLQUFLLFNBQVMsS0FBSyxLQUFLLEtBQUssR0FBRyxDQUFDLGNBQWM7QUFDOUQsYUFBTyxNQUFNLElBQUksTUFBTSxHQUFHLEdBQUcsQ0FBQyxXQUFXLElBQUksT0FBTztBQUFBLElBQ3REO0FBQUEsRUFDRjtBQUNGLENBQUM7QUFFRCxLQUFLLDBEQUEwRCxNQUFNO0FBQ25FLFFBQU0sU0FBUyxLQUFLO0FBQ3BCLFFBQU0sT0FBaUIsRUFBRSxPQUFPLE9BQW1CLEtBQUssUUFBb0IsSUFBSSxJQUFJO0FBQ3BGLFFBQU0sUUFBUSxVQUFVLE1BQU0sR0FBRyxNQUFNO0FBQ3ZDLFNBQU8sR0FBRyxNQUFNLFNBQVMsQ0FBQztBQUMxQixhQUFXLEtBQUssT0FBTztBQUNyQixXQUFPLE9BQU8sSUFBSSxVQUFVLEtBQUssR0FBRyxHQUFHLENBQUMsb0JBQW9CO0FBQUEsRUFDOUQ7QUFDRixDQUFDO0FBRUQsS0FBSyxpREFBaUQsTUFBTTtBQUMxRCxTQUFPLFVBQVUsVUFBVSxFQUFFLE9BQU8sR0FBRyxLQUFLLEVBQUUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZELFNBQU8sVUFBVSxVQUFVLEVBQUUsT0FBTyxHQUFHLEtBQUssRUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDdkQsU0FBTyxVQUFVLFVBQVUsRUFBRSxPQUFPLEtBQUssS0FBSyxFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUMzRCxDQUFDO0FBSUQsSUFBTSxJQUFJLEtBQUssSUFBSSxNQUFNLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHO0FBRTNDLEtBQUssZ0RBQWdELE1BQU07QUFDekQsU0FBTyxNQUFNLGVBQWUsR0FBRyxHQUFHLEdBQUcsU0FBUztBQUM5QyxTQUFPLE1BQU0sZUFBZSxHQUFHLEdBQUssR0FBRyxVQUFVO0FBQ2pELFNBQU8sTUFBTSxlQUFlLEdBQUcsR0FBTSxHQUFHLE9BQU87QUFDL0MsU0FBTyxNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsT0FBTztBQUM3QyxTQUFPLE1BQU0sZUFBZSxHQUFHLEdBQUcsR0FBRyxPQUFPO0FBQzlDLENBQUM7QUFFRCxLQUFLLDREQUE0RCxNQUFNO0FBQ3JFLFFBQU0sV0FBVyxLQUFLLElBQUksTUFBTSxHQUFHLENBQUM7QUFDcEMsU0FBTyxNQUFNLGVBQWUsVUFBVSxJQUFJLEdBQUcsT0FBTztBQUNwRCxTQUFPLE1BQU0sZUFBZSxLQUFLLElBQUksTUFBTSxHQUFHLEdBQUcsQ0FBQyxHQUFHLE1BQU0sS0FBSyxJQUFJLEdBQUcsT0FBTztBQUM5RSxTQUFPLE1BQU0sZUFBZSxLQUFLLElBQUksTUFBTSxHQUFHLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxPQUFPO0FBQ3JFLENBQUM7QUFFRCxLQUFLLDRDQUE0QyxNQUFNO0FBQ3JELFNBQU8sTUFBTSxlQUFlLENBQUMsR0FBRyxnQkFBZ0I7QUFDaEQsU0FBTyxNQUFNLGVBQWUsR0FBRyxHQUFHLElBQUksR0FBRyxvQkFBb0I7QUFDN0QsU0FBTyxNQUFNLGVBQWUsR0FBRyxJQUFJLElBQUksR0FBRyxnQkFBZ0I7QUFDNUQsQ0FBQztBQUVELEtBQUsseUJBQXlCLE1BQU07QUFDbEMsUUFBTSxRQUE0QjtBQUFBLElBQ2hDLENBQUMsS0FBSyxRQUFHO0FBQUEsSUFDVCxDQUFDLElBQUksUUFBRztBQUFBLElBQ1IsQ0FBQyxHQUFHLEtBQUs7QUFBQSxJQUNULENBQUMsS0FBSyxPQUFPO0FBQUEsSUFDYixDQUFDLEtBQU8sTUFBTTtBQUFBLElBQ2QsQ0FBQyxPQUFRLE9BQU87QUFBQSxJQUNoQixDQUFDLE1BQVEsUUFBUTtBQUFBLElBQ2pCLENBQUMsT0FBUyxTQUFTO0FBQUEsSUFDbkIsQ0FBQyxJQUFJLE9BQU8sS0FBSyxLQUFRLFFBQVE7QUFBQSxJQUNqQyxDQUFDLElBQUksTUFBTSxJQUFJLE1BQU0sT0FBTztBQUFBLEVBQzlCO0FBQ0EsYUFBVyxDQUFDLElBQUksUUFBUSxLQUFLLE9BQU87QUFDbEMsV0FBTyxNQUFNLGVBQWUsRUFBRSxHQUFHLFVBQVUsa0JBQWtCLEVBQUUsR0FBRztBQUFBLEVBQ3BFO0FBQ0YsQ0FBQztBQUlELElBQU0sU0FBUyxDQUFDLFVBQWdFLFdBQVcsS0FBSztBQUVoRyxLQUFLLGlEQUFpRCxNQUFNO0FBQzFELFFBQU0sRUFBRSxRQUFRLFdBQVcsSUFBSSxPQUFPO0FBQUEsSUFDcEMsRUFBRSxJQUFJLEtBQUssT0FBTyxHQUFHLEtBQUssR0FBRztBQUFBLElBQzdCLEVBQUUsSUFBSSxLQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQTtBQUFBLElBQzlCLEVBQUUsSUFBSSxLQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQSxFQUNoQyxDQUFDO0FBQ0QsU0FBTyxVQUFVLFFBQVEsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ2xDLFNBQU8sTUFBTSxZQUFZLENBQUM7QUFDNUIsQ0FBQztBQUVELEtBQUssMkNBQTJDLE1BQU07QUFDcEQsUUFBTSxFQUFFLFFBQVEsV0FBVyxJQUFJLE9BQU87QUFBQSxJQUNwQyxFQUFFLElBQUksS0FBSyxPQUFPLEdBQUcsS0FBSyxJQUFJO0FBQUEsSUFDOUIsRUFBRSxJQUFJLEtBQUssT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLElBQzlCLEVBQUUsSUFBSSxLQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQSxJQUM5QixFQUFFLElBQUksS0FBSyxPQUFPLElBQUksS0FBSyxHQUFHO0FBQUEsRUFDaEMsQ0FBQztBQUNELFNBQU8sVUFBVSxRQUFRLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ3JDLFNBQU8sTUFBTSxZQUFZLENBQUM7QUFDNUIsQ0FBQztBQUVELEtBQUssMEVBQTBFLE1BQU07QUFDbkYsUUFBTSxFQUFFLFFBQVEsV0FBVyxJQUFJLE9BQU87QUFBQSxJQUNwQyxFQUFFLElBQUksS0FBSyxPQUFPLEdBQUcsS0FBSyxLQUFLO0FBQUEsSUFDL0IsRUFBRSxJQUFJLEtBQUssT0FBTyxJQUFVO0FBQUE7QUFBQSxJQUM1QixFQUFFLElBQUksS0FBSyxPQUFPLEtBQVcsS0FBSyxRQUFVO0FBQUEsRUFDOUMsQ0FBQztBQUNELFNBQU8sVUFBVSxRQUFRLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUNsQyxTQUFPLE1BQU0sWUFBWSxDQUFDO0FBQzVCLENBQUM7QUFFRCxLQUFLLHVFQUF1RSxNQUFNO0FBQ2hGLFFBQU0sUUFBb0I7QUFBQSxJQUN4QixFQUFFLElBQUksS0FBSyxPQUFPLEdBQUcsS0FBSyxHQUFHO0FBQUEsSUFDN0IsRUFBRSxJQUFJLEtBQUssT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLElBQzlCLEVBQUUsSUFBSSxLQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQSxJQUM5QixFQUFFLElBQUksS0FBSyxPQUFPLElBQUksS0FBSyxLQUFLO0FBQUEsSUFDaEMsRUFBRSxJQUFJLEtBQUssT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLEVBQ2hDO0FBQ0EsUUFBTSxPQUFPLE9BQU8sS0FBSztBQUN6QixRQUFNLE9BQU8sSUFBSSxJQUFJLE1BQU0sSUFBSSxDQUFDLElBQUksTUFBTSxDQUFDLEdBQUcsSUFBSSxLQUFLLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNsRSxRQUFNLFdBQVcsQ0FBQyxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQztBQUNsRSxRQUFNLEtBQUssT0FBTyxRQUFRO0FBQzFCLFNBQU8sTUFBTSxHQUFHLFlBQVksS0FBSyxVQUFVO0FBQzNDLFdBQVMsUUFBUSxDQUFDLElBQUksTUFBTTtBQUMxQixXQUFPLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxLQUFLLElBQUksR0FBRyxFQUFFLEdBQUcsYUFBYSxHQUFHLEVBQUUsdUJBQXVCO0FBQUEsRUFDdkYsQ0FBQztBQUNILENBQUM7QUFFRCxLQUFLLHlEQUF5RCxNQUFNO0FBQ2xFLFFBQU0sSUFBSSxPQUFPO0FBQUEsSUFDZixFQUFFLElBQUksS0FBSyxPQUFPLEdBQUcsS0FBSyxHQUFHO0FBQUEsSUFDN0IsRUFBRSxJQUFJLEtBQUssT0FBTyxHQUFHLEtBQUssR0FBRztBQUFBLEVBQy9CLENBQUM7QUFDRCxRQUFNLElBQUksT0FBTztBQUFBLElBQ2YsRUFBRSxJQUFJLEtBQUssT0FBTyxHQUFHLEtBQUssR0FBRztBQUFBLElBQzdCLEVBQUUsSUFBSSxLQUFLLE9BQU8sR0FBRyxLQUFLLEdBQUc7QUFBQSxFQUMvQixDQUFDO0FBQ0QsU0FBTyxVQUFVLEVBQUUsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ2pDLFNBQU8sVUFBVSxFQUFFLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNuQyxDQUFDO0FBRUQsS0FBSyw2RUFBNkUsTUFBTTtBQUN0RixRQUFNLEVBQUUsUUFBUSxXQUFXLElBQUksT0FBTztBQUFBLElBQ3BDLEVBQUUsSUFBSSxNQUFNLE9BQU8sS0FBSyxLQUFLLElBQUk7QUFBQSxJQUNqQyxFQUFFLElBQUksTUFBTSxPQUFPLEtBQUssS0FBSyxJQUFJO0FBQUEsSUFDakMsRUFBRSxJQUFJLE1BQU0sT0FBTyxLQUFLLEtBQUssSUFBSTtBQUFBLEVBQ25DLENBQUM7QUFDRCxTQUFPLFVBQVUsQ0FBQyxHQUFHLE1BQU0sRUFBRSxLQUFLLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQzlDLFNBQU8sTUFBTSxZQUFZLENBQUM7QUFDNUIsQ0FBQztBQUVELEtBQUssZ0VBQWdFLE1BQU07QUFDekUsUUFBTSxFQUFFLE9BQU8sSUFBSSxPQUFPO0FBQUEsSUFDeEIsRUFBRSxJQUFJLE9BQU8sT0FBTyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQ2xDLEVBQUUsSUFBSSxPQUFPLE9BQU8sS0FBSyxLQUFLLElBQUk7QUFBQSxFQUNwQyxDQUFDO0FBQ0QsU0FBTyxTQUFTLE9BQU8sQ0FBQyxHQUFHLE9BQU8sQ0FBQyxDQUFDO0FBRXBDLFFBQU0sUUFBUSxPQUFPO0FBQUEsSUFDbkIsRUFBRSxJQUFJLE9BQU8sT0FBTyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQ2xDLEVBQUUsSUFBSSxPQUFPLE9BQU8sS0FBSyxLQUFLLElBQUk7QUFBQSxFQUNwQyxDQUFDO0FBQ0QsU0FBTyxVQUFVLE1BQU0sUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3JDLFNBQU8sR0FBRyxlQUFlLENBQUM7QUFDNUIsQ0FBQztBQUVELEtBQUssOENBQThDLE1BQU07QUFDdkQsU0FBTyxVQUFVLE9BQU8sQ0FBQyxDQUFDLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxZQUFZLEVBQUUsQ0FBQztBQUM1RCxDQUFDO0FBSUQsS0FBSyx5RUFBeUUsTUFBTTtBQUNsRixRQUFNLElBQUksRUFBRSxhQUFhLElBQUksVUFBVSxHQUFHLFNBQVMsRUFBRTtBQUNyRCxRQUFNLEVBQUUsTUFBTSxTQUFTLFlBQVksSUFBSSxZQUFZLENBQUMsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDO0FBQy9ELFNBQU8sVUFBVSxTQUFTLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUN0QyxTQUFPLFVBQVUsTUFBTSxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUM7QUFDbEMsU0FBTyxNQUFNLGFBQWEsR0FBRztBQUM3QixTQUFPLE1BQU0sU0FBUyxHQUFHLENBQUMsR0FBRyxDQUFDO0FBQzlCLFNBQU8sTUFBTSxTQUFTLEdBQUcsQ0FBQyxHQUFHLElBQUksSUFBSSxFQUFFO0FBQ3pDLENBQUM7QUFFRCxLQUFLLDBFQUEwRSxNQUFNO0FBQ25GLFFBQU0sSUFBSSxFQUFFLGFBQWEsSUFBSSxVQUFVLEdBQUcsU0FBUyxFQUFFO0FBQ3JELFNBQU8sVUFBVSxZQUFZLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxTQUFTLENBQUMsRUFBRSxDQUFDO0FBQ3BELENBQUM7QUFFRCxLQUFLLHFGQUFxRixNQUFNO0FBQzlGLFFBQU0sSUFBaUIsRUFBRSxhQUFhLElBQUksVUFBVSxHQUFHLFNBQVMsRUFBRTtBQUNsRSxRQUFNLEVBQUUsTUFBTSxTQUFTLFlBQVksSUFBSSxZQUFZLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBQ3JFLFNBQU8sVUFBVSxTQUFTLENBQUMsSUFBSSxFQUFFLENBQUM7QUFDbEMsU0FBTyxVQUFVLE1BQU0sQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUM5QixTQUFPLE1BQU0sYUFBYSxFQUFFO0FBQzVCLFNBQU8sTUFBTSxXQUFXLEdBQUcsR0FBRyxDQUFDLEdBQUcsRUFBRTtBQUNwQyxTQUFPLE1BQU0sV0FBVyxHQUFHLENBQUMsR0FBRyxFQUFFO0FBRWpDLFNBQU8sTUFBTSxTQUFTLEdBQUcsR0FBRyxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUM7QUFDekMsU0FBTyxNQUFNLFNBQVMsR0FBRyxDQUFDLEdBQUcsSUFBSSxLQUFLLENBQUM7QUFDekMsQ0FBQztBQUlELElBQU0sUUFBcUIsRUFBRSxhQUFhLElBQUksVUFBVSxHQUFHLFNBQVMsRUFBRTtBQUV0RSxLQUFLLDhEQUE4RCxNQUFNO0FBQ3ZFLFFBQU0sU0FBUyxDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQ3ZCLFFBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsYUFBVyxTQUFTLENBQUMsU0FBUyxVQUFVLEdBQUcsR0FBTSxHQUFHO0FBQ2xELFVBQU0sTUFBTSxlQUFlLFFBQVEsT0FBTyxHQUFHLE9BQU8sQ0FBQztBQUNyRCxXQUFPLFVBQVUsSUFBSSxTQUFTLENBQUMsT0FBTyxPQUFPLEtBQUssQ0FBQztBQUNuRCxXQUFPLE1BQU0sSUFBSSxPQUFPLENBQUM7QUFBQSxFQUMzQjtBQUNGLENBQUM7QUFFRCxLQUFLLHFHQUFxRyxNQUFNO0FBQzlHLFNBQU8sVUFBVSxjQUFjLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDLENBQUM7QUFDMUQsU0FBTyxVQUFVLGNBQWMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ3BELFNBQU8sVUFBVSxjQUFjLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUN4QyxDQUFDO0FBRUQsS0FBSyw2RUFBNkUsTUFBTTtBQUN0RixRQUFNLFNBQVMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDO0FBQzFCLFFBQU0sTUFBTSxlQUFlLFFBQVEsT0FBTyxHQUFHLEtBQUssQ0FBQztBQUNuRCxTQUFPLFVBQVUsSUFBSSxTQUFTLENBQUMsT0FBTyxPQUFPLE9BQU8sSUFBSSxDQUFDO0FBQ3pELFNBQU8sTUFBTSxJQUFJLE9BQU8sR0FBRyxrQ0FBa0M7QUFDN0QsUUFBTSxNQUFNLGVBQWUsUUFBUSxPQUFPLEdBQUcsS0FBSyxDQUFDO0FBQ25ELFNBQU8sVUFBVSxJQUFJLFNBQVMsQ0FBQyxPQUFPLE1BQU0sT0FBTyxJQUFJLENBQUM7QUFDeEQsU0FBTyxNQUFNLElBQUksT0FBTyxDQUFDO0FBQzNCLENBQUM7QUFFRCxLQUFLLG1HQUFtRyxNQUFNO0FBQzVHLFFBQU0sTUFBTSxlQUFlLENBQUMsR0FBRyxHQUFHLENBQUMsR0FBRyxPQUFPLEdBQUcsSUFBSSxDQUFDO0FBQ3JELFNBQU8sVUFBVSxJQUFJLFNBQVMsQ0FBQyxNQUFNLE1BQU0sSUFBSSxDQUFDO0FBQ2hELFNBQU8sTUFBTSxJQUFJLE9BQU8sQ0FBQztBQUMzQixDQUFDO0FBRUQsS0FBSyxpR0FBNEYsTUFBTTtBQUNyRyxRQUFNLFNBQVMsQ0FBQyxHQUFHLEdBQUcsQ0FBQztBQUN2QixTQUFPLE1BQU0scUJBQXFCLEdBQUc7QUFDckMsTUFBSSxRQUFRLGVBQWUsUUFBUSxPQUFPLEdBQUcsS0FBSyxDQUFDLEVBQUU7QUFDckQsU0FBTyxNQUFNLE9BQU8sQ0FBQztBQUNyQixhQUFXLFNBQVMsQ0FBQyxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUc7QUFDdkQsVUFBTSxNQUFNLGVBQWUsUUFBUSxPQUFPLEdBQUcsT0FBTyxLQUFLO0FBQ3pELFdBQU8sVUFBVSxJQUFJLFNBQVMsQ0FBQyxNQUFNLE9BQU8sS0FBSyxHQUFHLFNBQVMsS0FBSyxnQkFBZ0I7QUFDbEYsWUFBUSxJQUFJO0FBQUEsRUFDZDtBQUNBLFFBQU0sV0FBVyxlQUFlLFFBQVEsT0FBTyxHQUFHLEtBQUssS0FBSztBQUM1RCxTQUFPLFVBQVUsU0FBUyxTQUFTLENBQUMsT0FBTyxPQUFPLEtBQUssQ0FBQztBQUN4RCxTQUFPLE1BQU0sU0FBUyxPQUFPLENBQUM7QUFFOUIsTUFBSSxRQUFRO0FBQ1osYUFBVyxTQUFTLENBQUMsS0FBSyxLQUFLLEtBQUssS0FBSyxHQUFHLEdBQUc7QUFDN0MsVUFBTSxNQUFNLGVBQWUsUUFBUSxPQUFPLEdBQUcsT0FBTyxLQUFLO0FBQ3pELFdBQU8sTUFBTSxJQUFJLE9BQU8sR0FBRyxTQUFTLEtBQUssbUNBQW1DO0FBQzVFLFlBQVEsSUFBSTtBQUFBLEVBQ2Q7QUFDRixDQUFDO0FBRUQsS0FBSyxpRkFBaUYsTUFBTTtBQUcxRixRQUFNLFFBQW9CO0FBQUEsSUFDeEIsRUFBRSxJQUFJLE1BQU0sT0FBTyxHQUFHLEtBQUssSUFBSTtBQUFBLElBQy9CLEVBQUUsSUFBSSxNQUFNLE9BQU8sSUFBSSxLQUFLLElBQUk7QUFBQSxJQUNoQyxFQUFFLElBQUksTUFBTSxPQUFPLEtBQUssS0FBSyxJQUFJO0FBQUEsRUFDbkM7QUFDQSxRQUFNLFFBQW9CLENBQUMsRUFBRSxJQUFJLE1BQU0sT0FBTyxHQUFHLEtBQUssSUFBSSxDQUFDO0FBQzNELFFBQU0sT0FBaUIsRUFBRSxPQUFPLElBQUksS0FBSyxJQUFJO0FBQzdDLFFBQU0sT0FBaUIsRUFBRSxPQUFPLElBQUksS0FBSyxJQUFJO0FBQzdDLFFBQU0sVUFBVSxDQUFDLGtCQUFrQixPQUFPLElBQUksRUFBRSxZQUFZLGtCQUFrQixPQUFPLElBQUksRUFBRSxVQUFVO0FBQ3JHLFFBQU0sVUFBVSxDQUFDLGtCQUFrQixPQUFPLElBQUksRUFBRSxZQUFZLGtCQUFrQixPQUFPLElBQUksRUFBRSxVQUFVO0FBQ3JHLFNBQU8sVUFBVSxTQUFTLE9BQU87QUFDakMsUUFBTSxPQUFPLGVBQWUsU0FBUyxPQUFPLEdBQUcsSUFBSSxDQUFDO0FBQ3BELFFBQU0sT0FBTyxlQUFlLFNBQVMsT0FBTyxHQUFHLElBQUksS0FBSyxLQUFLO0FBQzdELFNBQU8sVUFBVSxNQUFNLElBQUk7QUFDM0IsU0FBTyxVQUFVLEtBQUssU0FBUyxDQUFDLE1BQU0sS0FBSyxDQUFDO0FBQzlDLENBQUM7QUFFRCxLQUFLLDBHQUEwRyxNQUFNO0FBQ25ILFFBQU0sU0FBUyxDQUFDLEdBQUcsQ0FBQztBQUNwQixRQUFNLE1BQU0sZUFBZSxRQUFRLE9BQU8sR0FBRyxJQUFJLENBQUM7QUFDbEQsU0FBTyxVQUFVLElBQUksU0FBUyxDQUFDLE1BQU0sS0FBSyxDQUFDO0FBQzNDLFNBQU8sTUFBTSxXQUFXLEdBQUcsT0FBTyxFQUFFLEdBQUcsRUFBRTtBQUN6QyxRQUFNLE9BQU8sZUFBZSxRQUFRLE9BQU8sSUFBSSxJQUFJLENBQUM7QUFDcEQsU0FBTyxVQUFVLEtBQUssU0FBUyxDQUFDLE1BQU0sSUFBSSxDQUFDO0FBRTNDLFFBQU0sVUFBVSxlQUFlLFFBQVEsT0FBTyxJQUFJLElBQUksQ0FBQztBQUN2RCxTQUFPLE1BQU0sUUFBUSxPQUFPLENBQUM7QUFDL0IsQ0FBQztBQUVELEtBQUssc0ZBQXNGLE1BQU07QUFDL0YsUUFBTSxLQUFLLENBQUMsR0FBVyxHQUFXLEdBQVcsUUFDM0MsTUFBTSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsQ0FBQyxHQUFHLE9BQU8sRUFBRSxJQUFJLEdBQUcsR0FBRyxHQUFHLENBQUMsSUFBSSxPQUFPLEdBQUcsS0FBSyxFQUFFLEVBQUU7QUFDOUUsUUFBTSxRQUFRLENBQUMsR0FBRyxHQUFHLElBQUksR0FBRyxLQUFLLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxLQUFLLEtBQUssR0FBRyxDQUFDO0FBQzlELFFBQU0sUUFBUSxDQUFDLEdBQUcsR0FBRyxHQUFHLEdBQUcsS0FBSyxHQUFHLEdBQUcsR0FBRyxHQUFHLElBQUksS0FBSyxLQUFLLEdBQUcsQ0FBQztBQUM5RCxRQUFNLFFBQWtCLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBSTtBQUM3QyxRQUFNLE9BQWlCLEVBQUUsT0FBTyxLQUFLLEtBQUssSUFBSTtBQUM5QyxRQUFNLGNBQWMsQ0FBQyxrQkFBa0IsT0FBTyxLQUFLLEVBQUUsWUFBWSxrQkFBa0IsT0FBTyxLQUFLLEVBQUUsVUFBVTtBQUMzRyxTQUFPLFVBQVUsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3JDLFFBQU0sV0FBVyxlQUFlLGFBQWEsT0FBTyxHQUFHLEtBQUssQ0FBQztBQUM3RCxTQUFPLFVBQVUsU0FBUyxTQUFTLENBQUMsTUFBTSxLQUFLLENBQUM7QUFFaEQsUUFBTSxhQUFhLENBQUMsa0JBQWtCLE9BQU8sSUFBSSxFQUFFLFlBQVksa0JBQWtCLE9BQU8sSUFBSSxFQUFFLFVBQVU7QUFDeEcsU0FBTyxVQUFVLFlBQVksQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUNwQyxRQUFNLFVBQVUsZUFBZSxZQUFZLE9BQU8sR0FBRyxLQUFLLFNBQVMsS0FBSztBQUN4RSxTQUFPLFVBQVUsUUFBUSxTQUFTLENBQUMsT0FBTyxJQUFJLENBQUM7QUFFL0MsU0FBTyxVQUFVLGVBQWUsWUFBWSxPQUFPLEdBQUcsS0FBSyxRQUFRLEtBQUssR0FBRyxPQUFPO0FBRWxGLFNBQU8sTUFBTSxlQUFlLFlBQVksT0FBTyxHQUFHLEtBQUssUUFBUSxLQUFLLEVBQUUsT0FBTyxDQUFDO0FBQ2hGLENBQUM7QUFJRCxLQUFLLHFFQUFxRSxNQUFNO0FBQzlFLFNBQU8sTUFBTSxRQUFRLFNBQVMsSUFBSSxDQUFDLEdBQUcsT0FBTztBQUM3QyxTQUFPLE1BQU0sUUFBUSxxQkFBcUIsSUFBSSxDQUFDLEdBQUcsWUFBWSxRQUFRLEVBQUU7QUFDeEUsU0FBTyxNQUFNLFFBQVEscUJBQXFCLElBQUksQ0FBQyxFQUFFLFFBQVEsRUFBRTtBQUMzRCxTQUFPLE1BQU0sUUFBUSxNQUFNLElBQUksQ0FBQyxHQUFHLElBQUk7QUFDdkMsU0FBTyxNQUFNLFFBQVEsVUFBVSxJQUFJLENBQUMsR0FBRyxFQUFFO0FBQ3pDLFNBQU8sTUFBTSxRQUFRLFVBQVUsR0FBRyxDQUFDLEdBQUcsRUFBRTtBQUN4QyxTQUFPLE1BQU0sUUFBUSxJQUFJLEtBQUssQ0FBQyxHQUFHLEVBQUU7QUFDcEMsU0FBTyxNQUFNLFFBQVEsT0FBTyxLQUFLLENBQUMsR0FBRyxFQUFFO0FBQ3pDLENBQUM7QUFFRCxLQUFLLGdEQUFnRCxNQUFNO0FBQ3pELFFBQU0sUUFBUTtBQUNkLGFBQVcsU0FBUyxDQUFDLEdBQUcsR0FBRyxJQUFJLElBQUksSUFBSSxJQUFJLEdBQUcsR0FBRztBQUMvQyxVQUFNLE1BQU0sUUFBUSxnQ0FBZ0MsT0FBTyxLQUFLO0FBQ2hFLFdBQU8sR0FBRyxJQUFJLFNBQVMsU0FBUyxTQUFTLFFBQVEsSUFBSSxJQUFJLEdBQUcsYUFBYSxLQUFLLElBQUk7QUFBQSxFQUNwRjtBQUNGLENBQUM7QUFFRCxLQUFLLHNDQUFzQyxNQUFNO0FBQy9DLFNBQU8sTUFBTSxlQUFlLENBQUMsR0FBRyxJQUFJO0FBQ3BDLFNBQU8sTUFBTSxlQUFlLHVCQUF1QixJQUFJLEdBQUcsSUFBSTtBQUM5RCxTQUFPLE1BQU0sZUFBZSxvQkFBb0IsR0FBRyxLQUFLO0FBQ3hELFNBQU8sTUFBTSxlQUFlLEVBQUUsR0FBRyxLQUFLO0FBQ3RDLFNBQU8sTUFBTSxlQUFlLEdBQUcsQ0FBQyxHQUFHLElBQUk7QUFDekMsQ0FBQztBQUlELEtBQUssMkVBQTJFLE1BQU07QUFDcEYsUUFBTSxTQUFrQixFQUFFLEdBQUcsS0FBSyxHQUFHLElBQUksR0FBRyxHQUFHLEdBQUcsR0FBRztBQUNyRCxRQUFNLE9BQU8sY0FBYyxRQUFRLENBQUM7QUFDcEMsU0FBTyxVQUFVLE1BQU0sRUFBRSxHQUFHLElBQUksR0FBRyxJQUFJLEdBQUcsR0FBRyxHQUFHLEdBQUcsQ0FBQztBQUNwRCxRQUFNLE1BQWUsRUFBRSxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsSUFBSSxHQUFHLEdBQUc7QUFDaEQsU0FBTyxNQUFNLGNBQWMsS0FBSyxDQUFDLEdBQUcsR0FBRztBQUN6QyxDQUFDO0FBRUQsS0FBSyxpRUFBaUUsTUFBTTtBQUMxRSxRQUFNLFFBQW1CO0FBQUEsSUFDdkIsRUFBRSxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsS0FBSyxHQUFHLEdBQUc7QUFBQSxJQUM1QixFQUFFLEdBQUcsSUFBSSxHQUFHLEdBQUcsR0FBRyxLQUFLLEdBQUcsR0FBRztBQUFBLEVBQy9CO0FBQ0EsU0FBTyxNQUFNLGFBQWEsSUFBSSxJQUFJLEtBQUssR0FBRyxDQUFDO0FBQzNDLFNBQU8sTUFBTSxhQUFhLElBQUksSUFBSSxLQUFLLEdBQUcsQ0FBQztBQUMzQyxTQUFPLE1BQU0sYUFBYSxHQUFHLEdBQUcsS0FBSyxHQUFHLENBQUM7QUFDekMsU0FBTyxNQUFNLGFBQWEsS0FBSyxJQUFJLEtBQUssR0FBRyxDQUFDO0FBQzVDLFNBQU8sTUFBTSxhQUFhLEtBQUssSUFBSSxLQUFLLEdBQUcsRUFBRTtBQUMvQyxDQUFDO0FBRUQsS0FBSyxpRUFBaUUsTUFBTTtBQUUxRSxRQUFNLFNBQWtCLEVBQUUsR0FBRyxLQUFLLEdBQUcsSUFBSSxHQUFHLEtBQUssR0FBRyxHQUFHO0FBQ3ZELFFBQU0sTUFBTSxjQUFjLFFBQVEsQ0FBQztBQUNuQyxTQUFPLE1BQU0sYUFBYSxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLGlDQUFpQztBQUMvRSxTQUFPLE1BQU0sYUFBYSxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLGdDQUFnQztBQUM5RSxTQUFPLE1BQU0sYUFBYSxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLG1DQUFtQztBQUNwRixDQUFDO0FBRUQsS0FBSyw4REFBOEQsTUFBTTtBQUN2RSxTQUFPLE1BQU0sZ0JBQWdCLEdBQUcsR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRTtBQUNuRCxTQUFPLE1BQU0sZ0JBQWdCLElBQUksR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRTtBQUNwRCxTQUFPLE1BQU0sZ0JBQWdCLElBQUksR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRTtBQUNwRCxTQUFPLE1BQU0sZ0JBQWdCLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQztBQUNuRCxDQUFDO0FBRUQsS0FBSyxvREFBb0QsTUFBTTtBQUM3RCxRQUFNLE1BQU07QUFBQSxJQUNWLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRTtBQUFBLElBQ2IsRUFBRSxHQUFHLElBQUksR0FBRyxFQUFFO0FBQUEsSUFDZCxFQUFFLEdBQUcsSUFBSSxHQUFHLEdBQUc7QUFBQSxFQUNqQjtBQUNBLFNBQU8sTUFBTSxnQkFBZ0IsR0FBRyxHQUFHLEtBQUssQ0FBQyxHQUFHLElBQUk7QUFDaEQsU0FBTyxNQUFNLGdCQUFnQixJQUFJLEdBQUcsS0FBSyxDQUFDLEdBQUcsSUFBSTtBQUNqRCxTQUFPLE1BQU0sZ0JBQWdCLEdBQUcsR0FBRyxLQUFLLENBQUMsR0FBRyxLQUFLO0FBQ25ELENBQUM7QUFJRCxLQUFLLDBFQUEwRSxNQUFNO0FBQ25GLFFBQU0sT0FBZ0IsRUFBRSxHQUFHLEdBQUcsR0FBRyxJQUFJLEdBQUcsSUFBSSxHQUFHLEdBQUc7QUFDbEQsUUFBTSxLQUFjLEVBQUUsR0FBRyxJQUFJLEdBQUcsSUFBSSxHQUFHLElBQUksR0FBRyxHQUFHO0FBQ2pELFNBQU8sVUFBVSxlQUFlLE1BQU0sRUFBRSxHQUFHO0FBQUEsSUFDekMsRUFBRSxHQUFHLElBQUksR0FBRyxHQUFHO0FBQUEsSUFDZixFQUFFLEdBQUcsSUFBSSxHQUFHLEdBQUc7QUFBQSxFQUNqQixDQUFDO0FBQ0gsQ0FBQztBQUVELEtBQUsscUZBQWdGLE1BQU07QUFDekYsUUFBTSxPQUFnQixFQUFFLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxJQUFJLEdBQUcsR0FBRztBQUNqRCxRQUFNLEtBQWMsRUFBRSxHQUFHLElBQUksR0FBRyxJQUFJLEdBQUcsSUFBSSxHQUFHLEdBQUc7QUFDakQsUUFBTSxNQUFNLGVBQWUsTUFBTSxJQUFJLEVBQUU7QUFDdkMsU0FBTyxNQUFNLElBQUksUUFBUSxFQUFFO0FBQzNCLFNBQU8sVUFBVSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQztBQUN4QyxTQUFPLFVBQVUsSUFBSSxJQUFJLFNBQVMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDO0FBQ3RELFdBQVMsSUFBSSxHQUFHLElBQUksSUFBSSxRQUFRLEtBQUs7QUFDbkMsV0FBTyxHQUFHLElBQUksQ0FBQyxFQUFFLEtBQUssSUFBSSxJQUFJLENBQUMsRUFBRSxJQUFJLE1BQU0sNENBQTRDO0FBQUEsRUFDekY7QUFDQSxTQUFPLEdBQUcsS0FBSyxJQUFJLElBQUksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLElBQUk7QUFDM0MsQ0FBQztBQUVELEtBQUssK0VBQStFLE1BQU07QUFDeEYsUUFBTSxPQUFnQixFQUFFLEdBQUcsS0FBSyxHQUFHLEdBQUcsR0FBRyxJQUFJLEdBQUcsR0FBRztBQUNuRCxRQUFNLEtBQWMsRUFBRSxHQUFHLElBQUksR0FBRyxJQUFJLEdBQUcsSUFBSSxHQUFHLEdBQUc7QUFDakQsUUFBTSxNQUFNLGVBQWUsTUFBTSxJQUFJLEVBQUU7QUFDdkMsU0FBTyxVQUFVLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxLQUFLLEdBQUcsRUFBRSxDQUFDO0FBQ3pDLFNBQU8sVUFBVSxJQUFJLElBQUksU0FBUyxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksR0FBRyxHQUFHLENBQUM7QUFFdEQsU0FBTyxHQUFHLElBQUksQ0FBQyxFQUFFLElBQUksS0FBSyxlQUFlO0FBQ3pDLFNBQU8sR0FBRyxJQUFJLElBQUksU0FBUyxDQUFDLEVBQUUsSUFBSSxJQUFJLGlCQUFpQjtBQUV2RCxRQUFNLElBQUk7QUFDVixhQUFXLEtBQUssS0FBSztBQUNuQixXQUFPLEdBQUcsRUFBRSxLQUFLLEtBQUssSUFBSSxRQUFRLEVBQUUsS0FBSyxNQUFNLElBQUksSUFBSTtBQUN2RCxXQUFPLEdBQUcsRUFBRSxLQUFLLElBQUksUUFBUSxFQUFFLEtBQUssS0FBSyxJQUFJO0FBQUEsRUFDL0M7QUFDRixDQUFDO0FBSUQsS0FBSyxnREFBZ0QsTUFBTTtBQUN6RCxTQUFPLE1BQU0sV0FBVyxFQUFFLEdBQUcsVUFBVTtBQUN2QyxTQUFPLE1BQU0sV0FBVyxHQUFHLEdBQUcsVUFBVTtBQUN4QyxTQUFPLE1BQU0sV0FBVyxRQUFRLEdBQUcsVUFBVTtBQUMvQyxDQUFDO0FBRUQsS0FBSywyQ0FBMkMsTUFBTTtBQUNwRCxRQUFNLFFBQVEsQ0FBQyxTQUFTLFVBQVUsUUFBUSxRQUFRLFdBQVcsTUFBTSxTQUFTLEtBQUs7QUFDakYsYUFBVyxLQUFLLE9BQU87QUFDckIsVUFBTSxJQUFJLFlBQVksQ0FBQztBQUN2QixXQUFPLE1BQU0sR0FBRyxZQUFZLENBQUMsR0FBRyxjQUFjLENBQUMsRUFBRTtBQUNqRCxXQUFPLEdBQUcsS0FBSyxLQUFLLElBQUksT0FBTyxPQUFPLFVBQVUsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxjQUFjLENBQUMsRUFBRTtBQUFBLEVBQy9FO0FBQ0YsQ0FBQztBQUVELEtBQUssbUZBQW1GLE1BQU07QUFFNUYsU0FBTztBQUFBLElBQ0wsQ0FBQyxTQUFTLFVBQVUsUUFBUSxRQUFRLFdBQVcsSUFBSSxFQUFFLElBQUksV0FBVztBQUFBLElBQ3BFLENBQUMsSUFBSSxJQUFJLEtBQUssSUFBSSxLQUFLLEdBQUc7QUFBQSxFQUM1QjtBQUNGLENBQUM7QUFFRCxLQUFLLHVFQUF1RSxNQUFNO0FBQ2hGLFFBQU0sVUFBVSxJQUFJLE1BQWMsQ0FBQyxFQUFFLEtBQUssQ0FBQztBQUMzQyxXQUFTLElBQUksR0FBRyxJQUFJLEtBQUssSUFBSyxTQUFRLEtBQUssTUFBTSxZQUFZLFlBQVksQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDO0FBQ25GLFdBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLFdBQU8sR0FBRyxRQUFRLENBQUMsS0FBSyxJQUFJLFVBQVUsQ0FBQyxvQkFBb0IsUUFBUSxDQUFDLENBQUMsT0FBTztBQUFBLEVBQzlFO0FBQ0YsQ0FBQztBQUVELEtBQUssdURBQXVELE1BQU07QUFDaEUsYUFBVyxLQUFLLENBQUMsU0FBUyxVQUFVLEtBQUssRUFBRSxHQUFHO0FBQzVDLFVBQU0sSUFBSSxlQUFlLENBQUM7QUFDMUIsV0FBTyxVQUFVLEdBQUcsZUFBZSxDQUFDLEdBQUcsZUFBZSxDQUFDLEdBQUc7QUFDMUQsV0FBTyxHQUFHLEtBQUssSUFBSSxFQUFFLEVBQUUsS0FBSyxNQUFNLHFCQUFxQixDQUFDLEdBQUc7QUFDM0QsV0FBTyxHQUFHLEtBQUssSUFBSSxFQUFFLEVBQUUsS0FBSyxNQUFNLHFCQUFxQixDQUFDLEdBQUc7QUFBQSxFQUM3RDtBQUVBLFFBQU0sSUFBSSxlQUFlLFFBQVE7QUFDakMsUUFBTSxJQUFJLGVBQWUsTUFBTTtBQUMvQixTQUFPLEdBQUcsS0FBSyxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsSUFBSSxNQUFNLG9DQUFvQztBQUM5RSxDQUFDO0FBRUQsS0FBSyxrREFBa0QsTUFBTTtBQUMzRCxTQUFPLE1BQU0sY0FBYyxHQUFHLEdBQUcsc0JBQXNCO0FBQ3ZELFNBQU8sTUFBTSxjQUFjLEtBQUssRUFBRSxPQUFPLElBQUksQ0FBQyxHQUFHLDRCQUE0QjtBQUM3RSxTQUFPLE1BQU0sY0FBYyxLQUFLLEVBQUUsV0FBVyxLQUFLLFFBQVEsSUFBSSxDQUFDLEdBQUcsb0JBQW9CO0FBQ3RGLFNBQU8sTUFBTSxjQUFjLEtBQUssRUFBRSxNQUFNLE1BQU0sQ0FBQyxHQUFHLG9CQUFvQjtBQUN0RSxTQUFPLE1BQU0sY0FBYyxLQUFLLEVBQUUsTUFBTSxPQUFPLE9BQU8sS0FBSyxDQUFDLEdBQUcsMkJBQTJCO0FBQzVGLENBQUM7QUFFRCxLQUFLLG9FQUFvRSxNQUFNO0FBQzdFLFNBQU8sVUFBVSxlQUFlLFFBQVEsZUFBZSxRQUFRO0FBQy9ELFNBQU8sVUFBVSxlQUFlLFFBQVEsZUFBZSxHQUFHO0FBQzFELFNBQU8sVUFBVSxlQUFlLFNBQVMsZUFBZSxLQUFLO0FBQzdELFNBQU8sTUFBTSxlQUFlLE9BQU8sT0FBTyxNQUFNO0FBQ2hELFNBQU8sTUFBTSxlQUFlLE9BQU8sUUFBUSxVQUFVLElBQUk7QUFDekQsU0FBTyxJQUFJLGVBQWUsT0FBTyxRQUFRLFNBQVMsTUFBTSxDQUFDO0FBRXpELFNBQU8sTUFBTSxlQUFlLElBQUksUUFBUSxJQUFJO0FBQzVDLFNBQU8sTUFBTSxlQUFlLE1BQU0sUUFBUSxJQUFJO0FBQzlDLFNBQU8sTUFBTSxlQUFlLE1BQU0sU0FBUyxPQUFPO0FBQ2xELFNBQU8sTUFBTSxlQUFlLFFBQVEsU0FBUyxTQUFTO0FBQ3hELENBQUM7QUFFRCxLQUFLLDBGQUEwRixNQUFNO0FBQ25HLFFBQU0sSUFBSSxlQUFlO0FBQ3pCLFNBQU8sTUFBTSxFQUFFLFNBQVMsV0FBVyxtREFBOEM7QUFDakYsU0FBTyxJQUFJLEVBQUUsUUFBUSxNQUFNLFVBQVUsTUFBTSxHQUFHLDBCQUEwQjtBQUN4RSxTQUFPLFNBQVMsRUFBRSxRQUFRLFVBQVUsTUFBTSxnREFBZ0Q7QUFDMUYsU0FBTyxNQUFNLEVBQUUsU0FBUyxRQUFRLFFBQVEsdUJBQXVCO0FBRS9ELFNBQU8sTUFBTSxlQUFlLE9BQU8sUUFBUSxNQUFNLE1BQVM7QUFDNUQsQ0FBQztBQUlELEtBQUssa0VBQWtFLE1BQU07QUFDM0UsUUFBTSxTQUFTLFlBQVk7QUFBQSxJQUN6QixFQUFFLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQSxJQUNyQixFQUFFLE9BQU8sR0FBRyxLQUFLLEdBQUc7QUFBQSxJQUNwQixFQUFFLE9BQU8sR0FBRyxLQUFLLEdBQUc7QUFBQSxJQUNwQixFQUFFLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQSxJQUNyQixFQUFFLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQSxFQUN2QixDQUFDO0FBQ0QsU0FBTyxVQUFVLFFBQVE7QUFBQSxJQUN2QixFQUFFLE9BQU8sR0FBRyxLQUFLLEdBQUc7QUFBQSxJQUNwQixFQUFFLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQSxFQUN2QixDQUFDO0FBQ0gsQ0FBQztBQUVELEtBQUssa0RBQWtELE1BQU07QUFDM0QsUUFBTSxTQUFzQjtBQUFBLElBQzFCLEVBQUUsT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLElBQ3JCLEVBQUUsT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLEVBQ3ZCO0FBQ0EsU0FBTyxVQUFVLGVBQWUsRUFBRSxPQUFPLEdBQUcsS0FBSyxHQUFHLEdBQUcsTUFBTSxHQUFHO0FBQUEsSUFDOUQsRUFBRSxPQUFPLEdBQUcsS0FBSyxHQUFHO0FBQUEsSUFDcEIsRUFBRSxPQUFPLElBQUksS0FBSyxHQUFHO0FBQUEsSUFDckIsRUFBRSxPQUFPLElBQUksS0FBSyxHQUFHO0FBQUEsRUFDdkIsQ0FBQztBQUNELFNBQU8sVUFBVSxlQUFlLEVBQUUsT0FBTyxJQUFJLEtBQUssR0FBRyxHQUFHLE1BQU0sR0FBRyxDQUFDLENBQUM7QUFDbkUsU0FBTyxVQUFVLGVBQWUsRUFBRSxPQUFPLElBQUksS0FBSyxHQUFHLEdBQUcsTUFBTSxHQUFHLENBQUMsRUFBRSxPQUFPLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQztBQUMzRixDQUFDO0FBRUQsS0FBSyxtRUFBbUUsTUFBTTtBQUM1RSxRQUFNLElBQUksSUFBSSxnQkFBZ0IsRUFBRSxZQUFZLElBQU0sQ0FBQztBQUNuRCxJQUFFLFdBQVcsS0FBUSxHQUFNO0FBQzNCLFFBQU0sTUFBTSxFQUFFLFlBQVksRUFBRSxPQUFPLE1BQU8sS0FBSyxLQUFPLEdBQUcsQ0FBQztBQUMxRCxTQUFPLEdBQUcsS0FBSyxxQkFBcUI7QUFDcEMsU0FBTyxNQUFNLElBQUksS0FBSyxHQUFNO0FBQzVCLFNBQU8sTUFBTSxJQUFJLE9BQU8sR0FBSztBQUMvQixDQUFDO0FBRUQsS0FBSyx1RUFBdUUsTUFBTTtBQUNoRixRQUFNLElBQUksSUFBSSxnQkFBZ0IsRUFBRSxZQUFZLElBQU0sQ0FBQztBQUNuRCxJQUFFLFdBQVcsS0FBUSxHQUFNO0FBQzNCLFFBQU0sT0FBaUIsRUFBRSxPQUFPLEtBQU8sS0FBSyxLQUFPO0FBQ25ELFFBQU0sTUFBTSxFQUFFLFlBQVksTUFBTSxDQUFDO0FBQ2pDLFNBQU8sR0FBRyxHQUFHO0FBQ2IsU0FBTyxNQUFNLEVBQUUsWUFBWSxNQUFNLENBQUMsR0FBRyxNQUFNLDBDQUEwQztBQUNyRixTQUFPLFVBQVUsRUFBRSxRQUFRLEdBQUcsR0FBRztBQUNqQyxJQUFFLE9BQU8sS0FBSyxFQUFFLElBQUksS0FBSyxDQUFDO0FBQzFCLFNBQU8sTUFBTSxFQUFFLFFBQVEsR0FBRyxJQUFJO0FBQzlCLFNBQU8sTUFBTSxFQUFFLFlBQVksTUFBTSxDQUFDLEdBQUcsTUFBTSx1Q0FBa0M7QUFDN0UsU0FBTyxVQUFVLEVBQUUsWUFBWSxFQUFFLE9BQU8sS0FBTyxLQUFLLEtBQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNqRSxRQUFNLFFBQWtCLEVBQUUsT0FBTyxLQUFPLEtBQUssS0FBTztBQUNwRCxRQUFNLE9BQU8sRUFBRSxZQUFZLE9BQU8sQ0FBQztBQUNuQyxTQUFPLEdBQUcsTUFBTSx1REFBdUQ7QUFDdkUsU0FBTyxNQUFNLEtBQUssS0FBSyxJQUFJLEtBQUs7QUFDaEMsU0FBTyxNQUFNLEtBQUssT0FBTyxHQUFLO0FBQ2hDLENBQUM7QUFFRCxLQUFLLHdEQUF3RCxNQUFNO0FBQ2pFLFFBQU0sSUFBSSxJQUFJLGdCQUFnQjtBQUM5QixJQUFFLFdBQVcsR0FBRyxHQUFPO0FBQ3ZCLFNBQU8sTUFBTSxFQUFFLFlBQVksRUFBRSxPQUFPLEtBQVEsS0FBSyxJQUFPLEdBQUcsQ0FBQyxHQUFHLElBQUk7QUFDckUsQ0FBQztBQUVELEtBQUssMEZBQXFGLE1BQU07QUFDOUYsUUFBTSxJQUFJLElBQUksZ0JBQWdCLEVBQUUsWUFBWSxLQUFPLFNBQVMsSUFBTSxDQUFDO0FBQ25FLElBQUUsV0FBVyxLQUFRLEdBQU07QUFDM0IsUUFBTSxPQUFpQixFQUFFLE9BQU8sR0FBRyxLQUFLLEtBQU87QUFDL0MsU0FBTyxNQUFNLEVBQUUsYUFBYSxDQUFDLEdBQUcsT0FBTyxxQ0FBcUM7QUFFNUUsTUFBSSxLQUFLO0FBQ1QsV0FBUyxJQUFJLEdBQUcsSUFBSSxJQUFJLEtBQUs7QUFDM0IsVUFBTSxNQUFNLEVBQUUsWUFBWSxNQUFNLEVBQUU7QUFDbEMsV0FBTyxHQUFHLEtBQUssV0FBVyxJQUFJLENBQUMsNkJBQTZCO0FBQzVELFdBQU8sTUFBTSxFQUFFLGFBQWEsRUFBRSxHQUFHLE9BQU8sK0JBQStCO0FBQ3ZFLE1BQUUsT0FBTyxLQUFLLEVBQUUsSUFBSSxNQUFNLEdBQUcsRUFBRTtBQUMvQixXQUFPLE1BQU0sRUFBRSxZQUFZLE1BQU0sS0FBSyxJQUFLLEdBQUcsTUFBTSxpQ0FBaUM7QUFDckYsV0FBTyxHQUFHLEVBQUUsYUFBYSxLQUFLLElBQUssR0FBRyxpREFBaUQ7QUFDdkYsV0FBTyxNQUFNLEVBQUUsYUFBYSxLQUFLLEdBQUssR0FBRyxPQUFPLDJDQUEyQztBQUMzRixVQUFNO0FBQUEsRUFDUjtBQUNBLFFBQU0sSUFBSSxFQUFFLFlBQVksTUFBTSxFQUFFO0FBQ2hDLFNBQU8sR0FBRyxHQUFHLGtFQUFrRTtBQUMvRSxJQUFFLE9BQU8sR0FBRyxFQUFFLElBQUksS0FBSyxDQUFDO0FBQ3hCLFNBQU8sTUFBTSxFQUFFLGFBQWEsRUFBRSxHQUFHLE9BQU8sK0JBQStCO0FBQ3ZFLFFBQU0sS0FBSyxFQUFFLFlBQVksRUFBRSxPQUFPLE1BQVEsS0FBSyxJQUFNLEdBQUcsRUFBRTtBQUMxRCxTQUFPLEdBQUcsSUFBSSx1REFBdUQ7QUFDdkUsQ0FBQztBQUVELEtBQUssNkVBQTZFLE1BQU07QUFDdEYsUUFBTSxJQUFJLElBQUksZ0JBQWdCLEVBQUUsWUFBWSxJQUFNLENBQUM7QUFDbkQsSUFBRSxXQUFXLEtBQVEsR0FBTTtBQUMzQixRQUFNLE1BQU0sRUFBRSxZQUFZLEVBQUUsT0FBTyxLQUFPLEtBQUssS0FBTyxHQUFHLENBQUM7QUFDMUQsU0FBTyxHQUFHLEdBQUc7QUFDYixJQUFFLE9BQU8sS0FBSyxFQUFFLElBQUksTUFBTSxXQUFXLEtBQUssQ0FBQztBQUMzQyxTQUFPLE1BQU0sRUFBRSxpQkFBaUIsSUFBSSxLQUFLO0FBQ3pDLFNBQU8sTUFBTSxFQUFFLFlBQVksRUFBRSxPQUFPLEdBQUcsS0FBSyxLQUFPLEdBQUcsRUFBRSxHQUFHLE1BQU0sZ0NBQWdDO0FBRWpHLFNBQU8sVUFBVSxFQUFFLFlBQVksRUFBRSxPQUFPLEdBQUcsS0FBSyxLQUFPLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDL0QsQ0FBQztBQUVELEtBQUssMERBQTBELE1BQU07QUFDbkUsUUFBTSxJQUFJLElBQUksZ0JBQWdCLEVBQUUsWUFBWSxJQUFNLENBQUM7QUFDbkQsSUFBRSxXQUFXLEtBQVEsR0FBTTtBQUMzQixRQUFNLE1BQU0sRUFBRSxZQUFZLEVBQUUsT0FBTyxHQUFHLEtBQUssS0FBTyxHQUFHLENBQUM7QUFDdEQsU0FBTyxHQUFHLEdBQUc7QUFDYixJQUFFLE9BQU8sRUFBRSxPQUFPLEdBQUcsS0FBSyxFQUFFLEdBQUcsRUFBRSxJQUFJLEtBQUssQ0FBQztBQUMzQyxTQUFPLFVBQVUsRUFBRSxRQUFRLEdBQUcsS0FBSyxxQ0FBcUM7QUFDMUUsQ0FBQztBQUlELElBQU0sUUFBUSxDQUFDLFVBQTJDO0FBQUEsRUFDeEQsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsV0FBVztBQUFBLEVBQ1gsU0FBUztBQUFBLEVBQ1QsU0FBUztBQUFBLEVBQ1QsVUFBVTtBQUFBLEVBQ1YsR0FBRztBQUNMO0FBS0EsS0FBSyxrRkFBa0YsTUFBTTtBQUMzRixhQUFXLGlCQUFpQixDQUFDLE9BQU8sSUFBSSxHQUFHO0FBQ3pDLFVBQU0sSUFBSSxXQUFXLE1BQU0sRUFBRSxRQUFRLEdBQUcsQ0FBQyxHQUFHLGFBQWE7QUFDekQsV0FBTyxVQUFVLEdBQUcsRUFBRSxRQUFRLEdBQUcsT0FBTyxJQUFJLGNBQWMsR0FBRyxVQUFVLEtBQUssQ0FBQztBQUFBLEVBQy9FO0FBQ0YsQ0FBQztBQUVELEtBQUssdUdBQWtHLE1BQU07QUFHM0csYUFBVyxpQkFBaUIsQ0FBQyxPQUFPLElBQUksR0FBRztBQUN6QyxXQUFPLFVBQVUsV0FBVyxNQUFNLEVBQUUsUUFBUSxFQUFFLENBQUMsR0FBRyxhQUFhLEdBQUcsRUFBRSxRQUFRLEdBQUcsT0FBTyxHQUFHLGNBQWMsR0FBRyxVQUFVLE1BQU0sQ0FBQztBQUMzSCxXQUFPLFVBQVUsV0FBVyxNQUFNLEVBQUUsUUFBUSxLQUFLLENBQUMsR0FBRyxhQUFhLEdBQUcsRUFBRSxRQUFRLEdBQUcsT0FBTyxHQUFHLGNBQWMsR0FBRyxVQUFVLE1BQU0sQ0FBQztBQUFBLEVBQ2hJO0FBQ0YsQ0FBQztBQUVELEtBQUssbUdBQW1HLE1BQU07QUFDNUcsU0FBTyxVQUFVLFdBQVcsTUFBTSxFQUFFLFFBQVEsSUFBSSxRQUFRLEVBQUUsQ0FBQyxHQUFHLElBQUksR0FBRyxFQUFFLFFBQVEsR0FBRyxPQUFPLElBQUksY0FBYyxHQUFHLFVBQVUsS0FBSyxDQUFDO0FBRTlILFNBQU8sVUFBVSxXQUFXLE1BQU0sRUFBRSxRQUFRLElBQUksUUFBUSxFQUFFLENBQUMsR0FBRyxLQUFLLEdBQUcsRUFBRSxRQUFRLEdBQUcsT0FBTyxJQUFJLGNBQWMsR0FBRyxVQUFVLEtBQUssQ0FBQztBQUNqSSxDQUFDO0FBRUQsS0FBSyxnRkFBZ0YsTUFBTTtBQUN6RixhQUFXLGlCQUFpQixDQUFDLE9BQU8sSUFBSSxHQUFHO0FBR3pDLFdBQU8sVUFBVSxXQUFXLE1BQU0sRUFBRSxRQUFRLEdBQUcsUUFBUSxHQUFHLENBQUMsR0FBRyxhQUFhLEdBQUc7QUFBQSxNQUM1RSxRQUFRO0FBQUEsTUFDUixPQUFPO0FBQUEsTUFDUCxjQUFjO0FBQUEsTUFDZCxVQUFVO0FBQUEsSUFDWixDQUFDO0FBR0QsV0FBTyxVQUFVLFdBQVcsTUFBTSxFQUFFLFFBQVEsR0FBRyxRQUFRLEVBQUUsQ0FBQyxHQUFHLGFBQWEsR0FBRztBQUFBLE1BQzNFLFFBQVE7QUFBQSxNQUNSLE9BQU87QUFBQSxNQUNQLGNBQWM7QUFBQSxNQUNkLFVBQVU7QUFBQSxJQUNaLENBQUM7QUFFRCxXQUFPLE1BQU0sV0FBVyxNQUFNLENBQUMsQ0FBQyxHQUFHLGFBQWEsRUFBRSxVQUFVLEtBQUs7QUFBQSxFQUNuRTtBQUNGLENBQUM7QUFFRCxLQUFLLDhFQUE4RSxNQUFNO0FBQ3ZGLGFBQVcsT0FBTyxDQUFDLEVBQUUsU0FBUyxLQUFLLEdBQUcsRUFBRSxTQUFTLEtBQUssQ0FBQyxHQUFHO0FBQ3hELGVBQVcsaUJBQWlCLENBQUMsT0FBTyxJQUFJLEdBQUc7QUFDekMsYUFBTyxVQUFVLFdBQVcsTUFBTSxFQUFFLFFBQVEsSUFBSSxRQUFRLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxhQUFhLEdBQUc7QUFBQSxRQUN0RixRQUFRO0FBQUEsUUFDUixPQUFPO0FBQUEsUUFDUCxjQUFjO0FBQUEsUUFDZCxVQUFVO0FBQUEsTUFDWixDQUFDO0FBQ0QsYUFBTyxVQUFVLFdBQVcsTUFBTSxFQUFFLFFBQVEsS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLGFBQWEsR0FBRztBQUFBLFFBQzFFLFFBQVE7QUFBQSxRQUNSLE9BQU87QUFBQSxRQUNQLGNBQWM7QUFBQSxRQUNkLFVBQVU7QUFBQSxNQUNaLENBQUM7QUFFRCxhQUFPLE1BQU0sV0FBVyxNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxhQUFhLEVBQUUsVUFBVSxJQUFJO0FBQUEsSUFDMUU7QUFBQSxFQUNGO0FBQ0YsQ0FBQztBQUVELEtBQUssbUdBQW1HLE1BQU07QUFDNUcsYUFBVyxpQkFBaUIsQ0FBQyxPQUFPLElBQUksR0FBRztBQUN6QyxXQUFPLFVBQVUsV0FBVyxNQUFNLEVBQUUsUUFBUSxHQUFHLFVBQVUsS0FBSyxDQUFDLEdBQUcsYUFBYSxHQUFHO0FBQUEsTUFDaEYsUUFBUTtBQUFBLE1BQ1IsT0FBTztBQUFBLE1BQ1AsY0FBYztBQUFBLE1BQ2QsVUFBVTtBQUFBLElBQ1osQ0FBQztBQUNELFdBQU8sVUFBVSxXQUFXLE1BQU0sRUFBRSxRQUFRLEdBQUcsVUFBVSxLQUFLLENBQUMsR0FBRyxhQUFhLEdBQUc7QUFBQSxNQUNoRixRQUFRO0FBQUEsTUFDUixPQUFPO0FBQUEsTUFDUCxjQUFjO0FBQUEsTUFDZCxVQUFVO0FBQUEsSUFDWixDQUFDO0FBQ0QsV0FBTyxVQUFVLFdBQVcsTUFBTSxFQUFFLFFBQVEsR0FBRyxRQUFRLEdBQUcsVUFBVSxLQUFLLENBQUMsR0FBRyxhQUFhLEdBQUc7QUFBQSxNQUMzRixRQUFRO0FBQUEsTUFDUixPQUFPO0FBQUEsTUFDUCxjQUFjO0FBQUEsTUFDZCxVQUFVO0FBQUEsSUFDWixDQUFDO0FBQ0QsV0FBTyxNQUFNLFdBQVcsTUFBTSxFQUFFLFVBQVUsS0FBSyxDQUFDLEdBQUcsYUFBYSxFQUFFLFVBQVUsS0FBSztBQUFBLEVBQ25GO0FBQ0YsQ0FBQztBQUVELEtBQUssc0VBQXNFLE1BQU07QUFDL0UsU0FBTyxVQUFVLFdBQVcsTUFBTSxFQUFFLFFBQVEsSUFBSSxXQUFXLEVBQUUsQ0FBQyxHQUFHLEtBQUssR0FBRyxFQUFFLFFBQVEsR0FBRyxPQUFPLEtBQUssY0FBYyxHQUFHLFVBQVUsS0FBSyxDQUFDO0FBQ25JLFNBQU8sVUFBVSxXQUFXLE1BQU0sRUFBRSxRQUFRLElBQUksUUFBUSxHQUFHLFdBQVcsRUFBRSxDQUFDLEdBQUcsSUFBSSxHQUFHO0FBQUEsSUFDakYsUUFBUTtBQUFBLElBQ1IsT0FBTztBQUFBLElBQ1AsY0FBYztBQUFBLElBQ2QsVUFBVTtBQUFBLEVBQ1osQ0FBQztBQUVELFNBQU8sVUFBVSxXQUFXLE1BQU0sRUFBRSxRQUFRLEdBQUcsV0FBVyxFQUFFLENBQUMsR0FBRyxJQUFJLEdBQUcsRUFBRSxRQUFRLEdBQUcsT0FBTyxHQUFHLGNBQWMsR0FBRyxVQUFVLE1BQU0sQ0FBQztBQUNoSSxTQUFPLFVBQVUsV0FBVyxNQUFNLEVBQUUsUUFBUSxHQUFHLFdBQVcsRUFBRSxDQUFDLEdBQUcsS0FBSyxHQUFHLEVBQUUsUUFBUSxHQUFHLE9BQU8sR0FBRyxjQUFjLEdBQUcsVUFBVSxNQUFNLENBQUM7QUFDakksU0FBTyxVQUFVLFdBQVcsTUFBTSxFQUFFLFFBQVEsSUFBSSxXQUFXLEdBQUcsU0FBUyxLQUFLLENBQUMsR0FBRyxLQUFLLEdBQUc7QUFBQSxJQUN0RixRQUFRO0FBQUEsSUFDUixPQUFPO0FBQUEsSUFDUCxjQUFjO0FBQUEsSUFDZCxVQUFVO0FBQUEsRUFDWixDQUFDO0FBQ0gsQ0FBQztBQUVELEtBQUssbURBQW1ELE1BQU07QUFDNUQsU0FBTyxNQUFNLGNBQWMsTUFBTSxFQUFFLFNBQVMsS0FBSyxDQUFDLENBQUMsR0FBRyxNQUFNO0FBQzVELFNBQU8sTUFBTSxjQUFjLE1BQU0sRUFBRSxTQUFTLE1BQU0sUUFBUSxFQUFFLENBQUMsQ0FBQyxHQUFHLE1BQU07QUFDdkUsU0FBTyxNQUFNLGNBQWMsTUFBTSxFQUFFLFVBQVUsTUFBTSxRQUFRLEVBQUUsQ0FBQyxDQUFDLEdBQUcsS0FBSztBQUN2RSxTQUFPLE1BQU0sY0FBYyxNQUFNLEVBQUUsVUFBVSxNQUFNLFFBQVEsRUFBRSxDQUFDLENBQUMsR0FBRyxLQUFLO0FBQ3ZFLFNBQU8sTUFBTSxjQUFjLE1BQU0sRUFBRSxVQUFVLEtBQUssQ0FBQyxDQUFDLEdBQUcsYUFBYTtBQUNwRSxTQUFPLE1BQU0sY0FBYyxNQUFNLEVBQUUsUUFBUSxHQUFHLENBQUMsQ0FBQyxHQUFHLEtBQUs7QUFDeEQsU0FBTyxNQUFNLGNBQWMsTUFBTSxFQUFFLFFBQVEsSUFBSSxDQUFDLENBQUMsR0FBRyxhQUFhO0FBQ2pFLFNBQU8sTUFBTSxjQUFjLE1BQU0sRUFBRSxRQUFRLEdBQUcsUUFBUSxFQUFFLENBQUMsQ0FBQyxHQUFHLGFBQWE7QUFDMUUsU0FBTyxNQUFNLGNBQWMsTUFBTSxDQUFDLENBQUMsQ0FBQyxHQUFHLGFBQWE7QUFFcEQsU0FBTyxNQUFNLGNBQWMsTUFBTSxFQUFFLFFBQVEsR0FBRyxXQUFXLEVBQUUsQ0FBQyxDQUFDLEdBQUcsYUFBYTtBQUM3RSxTQUFPLE1BQU0sY0FBYyxNQUFNLEVBQUUsUUFBUSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUMsR0FBRyxLQUFLO0FBQ3hFLENBQUM7QUFFRCxLQUFLLGdIQUEyRyxNQUFNO0FBQ3BILFFBQU0sU0FBUyxDQUFDLE1BQU0sS0FBSyxJQUFJLElBQUksR0FBRyxHQUFHLEdBQUcsSUFBSSxLQUFLLEtBQUssUUFBUTtBQUNsRSxRQUFNLFFBQVEsQ0FBQyxHQUFHLEdBQUcsQ0FBQztBQUN0QixRQUFNLE9BQU87QUFBQSxJQUNYLENBQUM7QUFBQSxJQUNELEVBQUUsU0FBUyxLQUFLO0FBQUEsSUFDaEIsRUFBRSxTQUFTLEtBQUs7QUFBQSxJQUNoQixFQUFFLFVBQVUsS0FBSztBQUFBLElBQ2pCLEVBQUUsU0FBUyxNQUFNLFVBQVUsS0FBSztBQUFBLElBQ2hDLEVBQUUsU0FBUyxNQUFNLFVBQVUsS0FBSztBQUFBLEVBQ2xDO0FBQ0EsTUFBSSxVQUFVO0FBQ2QsYUFBVyxPQUFPLE1BQU07QUFDdEIsZUFBVyxhQUFhLE9BQU87QUFDN0IsaUJBQVcsVUFBVSxRQUFRO0FBQzNCLG1CQUFXLFVBQVUsUUFBUTtBQUMzQixnQkFBTSxJQUFJLE1BQU0sRUFBRSxRQUFRLFFBQVEsV0FBVyxHQUFHLElBQUksQ0FBQztBQUNyRCxnQkFBTSxNQUFNLGNBQWMsQ0FBQztBQUMzQixxQkFBVyxpQkFBaUIsQ0FBQyxPQUFPLElBQUksR0FBRztBQUN6QyxrQkFBTSxRQUFRLFdBQVcsR0FBRyxhQUFhO0FBQ3pDLG1CQUFPO0FBQUEsY0FDTCxNQUFNO0FBQUEsY0FDTixRQUFRO0FBQUEsY0FDUixrQkFBa0IsTUFBTSxPQUFPLE1BQU0sU0FBUyxTQUFTLFNBQVMsS0FBSyxVQUFVLEdBQUcsQ0FBQyxhQUFhLGFBQWEsV0FBVyxHQUFHLGNBQWMsTUFBTSxRQUFRO0FBQUEsWUFDeko7QUFDQTtBQUFBLFVBQ0Y7QUFFQSxpQkFBTyxNQUFNLFdBQVcsR0FBRyxLQUFLLEVBQUUsVUFBVSxXQUFXLEdBQUcsSUFBSSxFQUFFLFFBQVE7QUFBQSxRQUMxRTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNBLFNBQU8sR0FBRyxXQUFXLElBQUksSUFBSSxLQUFLLEtBQUssR0FBRyxzQkFBc0IsT0FBTyxHQUFHO0FBQzVFLENBQUM7QUFTRCxLQUFLLG9HQUFvRyxNQUFNO0FBRTdHLFFBQU0sU0FBUyxDQUFDLE1BQU0sS0FBSyxJQUFJLElBQUksR0FBRyxHQUFHLEdBQUcsSUFBSSxLQUFLLEtBQUssUUFBUTtBQUNsRSxRQUFNLFFBQVEsQ0FBQyxHQUFHLEdBQUcsQ0FBQztBQUN0QixRQUFNLE9BQU87QUFBQSxJQUNYLENBQUM7QUFBQSxJQUNELEVBQUUsU0FBUyxLQUFLO0FBQUEsSUFDaEIsRUFBRSxTQUFTLEtBQUs7QUFBQSxJQUNoQixFQUFFLFVBQVUsS0FBSztBQUFBLElBQ2pCLEVBQUUsU0FBUyxNQUFNLFVBQVUsS0FBSztBQUFBLElBQ2hDLEVBQUUsU0FBUyxNQUFNLFVBQVUsS0FBSztBQUFBLEVBQ2xDO0FBQ0EsTUFBSSxVQUFVO0FBQ2QsYUFBVyxPQUFPLE1BQU07QUFDdEIsZUFBVyxhQUFhLE9BQU87QUFDN0IsaUJBQVcsVUFBVSxRQUFRO0FBQzNCLG1CQUFXLFVBQVUsUUFBUTtBQUMzQixnQkFBTSxJQUFJLE1BQU0sRUFBRSxRQUFRLFFBQVEsV0FBVyxHQUFHLElBQUksQ0FBQztBQUNyRCxxQkFBVyxpQkFBaUIsQ0FBQyxPQUFPLElBQUksR0FBRztBQUN6QyxrQkFBTSxRQUFRLElBQUksbUJBQW1CO0FBQ3JDLG1CQUFPO0FBQUEsY0FDTCxNQUFNLE1BQU0sR0FBRyxlQUFlLEdBQUk7QUFBQSxjQUNsQyxXQUFXLEdBQUcsYUFBYTtBQUFBLGNBQzNCLCtCQUErQixNQUFNLE9BQU8sTUFBTSxTQUFTLFNBQVMsU0FBUyxLQUFLLFVBQVUsR0FBRyxDQUFDLGFBQWEsYUFBYTtBQUFBLFlBQzVIO0FBQ0E7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNBLFNBQU8sR0FBRyxXQUFXLElBQUksSUFBSSxLQUFLLEtBQUssR0FBRyxzQkFBc0IsT0FBTyxHQUFHO0FBQzVFLENBQUM7QUFFRCxLQUFLLDJIQUFpSCxNQUFNO0FBRzFILFFBQU0sU0FBa0M7QUFBQSxJQUN0QyxDQUFDLE1BQU0sQ0FBQztBQUFBLElBQ1IsQ0FBQyxNQUFNLENBQUM7QUFBQSxJQUNSLENBQUMsSUFBSSxFQUFFO0FBQUE7QUFBQSxJQUNQLENBQUMsTUFBTSxDQUFDO0FBQUEsSUFDUixDQUFDLEdBQUcsRUFBRTtBQUFBO0FBQUEsSUFDTixDQUFDLE1BQU0sQ0FBQztBQUFBLElBQ1IsQ0FBQyxJQUFJLEVBQUU7QUFBQSxJQUNQLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDVjtBQUNBLFFBQU0sSUFBSSxJQUFJLG1CQUFtQjtBQUNqQyxNQUFJLEtBQUs7QUFDVCxNQUFJLE1BQU07QUFDVixhQUFXLENBQUMsUUFBUSxNQUFNLEtBQUssUUFBUTtBQUNyQyxVQUFNLFFBQVEsRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLE9BQU8sQ0FBQyxHQUFHLE9BQU8sRUFBRTtBQUMxRCxXQUFPLE1BQU0sTUFBTSxVQUFVLE1BQU0sSUFBSSxNQUFNLEtBQUssTUFBTSxRQUFRLEVBQUUsd0NBQXdDO0FBQzFHLFdBQU8sTUFBTSxNQUFNLFFBQVEsQ0FBQztBQUM1QixXQUFPLE1BQU0sTUFBTSxjQUFjLEdBQUcsaUVBQWlFO0FBQ3JHLFdBQU8sTUFBTTtBQUNiLFVBQU07QUFBQSxFQUNSO0FBQ0EsU0FBTyxNQUFNLEtBQUssT0FBTyxJQUFJLElBQUksR0FBRyx5REFBMEQ7QUFDaEcsQ0FBQztBQUVELEtBQUssc0hBQWlILE1BQU07QUFDMUgsUUFBTSxJQUFJLElBQUksbUJBQW1CO0FBQ2pDLE1BQUksS0FBSztBQUNULE1BQUksTUFBTTtBQUNWLE1BQUksT0FBTztBQUNYLGFBQVcsQ0FBQyxRQUFRLE1BQU0sS0FBSztBQUFBLElBQzdCLENBQUMsS0FBSyxDQUFDO0FBQUEsSUFDUCxDQUFDLElBQUksQ0FBQztBQUFBO0FBQUEsSUFDTixDQUFDLEtBQUssQ0FBQztBQUFBLEVBQ1QsR0FBOEI7QUFDNUIsVUFBTSxRQUFRLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxPQUFPLENBQUMsR0FBRyxNQUFNLEVBQUU7QUFDekQsV0FBTyxNQUFNLE1BQU0sVUFBVSxJQUFJO0FBQ2pDLFdBQU8sTUFBTTtBQUNiLFlBQVEsTUFBTTtBQUNkLFVBQU07QUFBQSxFQUNSO0FBQ0EsU0FBTyxNQUFNLEtBQUssSUFBSTtBQUN0QixTQUFPLE1BQU0sTUFBTSxJQUFJLGdGQUFpRjtBQUMxRyxDQUFDO0FBRUQsS0FBSywrR0FBMEcsTUFBTTtBQUduSCxRQUFNLFNBQWtDO0FBQUEsSUFDdEMsQ0FBQyxHQUFHLEdBQUc7QUFBQSxJQUNQLENBQUMsR0FBRyxFQUFFO0FBQUEsSUFDTixDQUFDLEtBQUssQ0FBQztBQUFBO0FBQUEsSUFDUCxDQUFDLEdBQUcsR0FBRztBQUFBLElBQ1AsQ0FBQyxLQUFLLENBQUM7QUFBQSxJQUNQLENBQUMsR0FBRyxHQUFHO0FBQUEsRUFDVDtBQUNBLFFBQU0sSUFBSSxJQUFJLG1CQUFtQjtBQUNqQyxNQUFJLEtBQUs7QUFDVCxhQUFXLENBQUMsUUFBUSxNQUFNLEtBQUssUUFBUTtBQUNyQyxlQUFXLGlCQUFpQixDQUFDLE9BQU8sSUFBSSxHQUFHO0FBRXpDLGFBQU8sVUFBVSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsT0FBTyxDQUFDLEdBQUcsZUFBZSxFQUFFLEdBQUc7QUFBQSxRQUN0RSxRQUFRO0FBQUEsUUFDUixPQUFPO0FBQUEsUUFDUCxjQUFjO0FBQUEsUUFDZCxVQUFVO0FBQUEsTUFDWixDQUFDO0FBQUEsSUFDSDtBQUNBLFVBQU07QUFBQSxFQUNSO0FBQ0YsQ0FBQztBQUVELEtBQUssK0dBQTBHLE1BQU07QUFDbkgsUUFBTSxJQUFJLElBQUksbUJBQW1CO0FBRWpDLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsTUFBTSxRQUFRLEVBQUUsQ0FBQyxHQUFHLE9BQU8sR0FBSSxFQUFFLFVBQVUsSUFBSTtBQUNwRixTQUFPLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLE1BQU0sUUFBUSxFQUFFLENBQUMsR0FBRyxPQUFPLElBQUksRUFBRSxVQUFVLElBQUk7QUFFcEYsU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxJQUFJLFFBQVEsR0FBRyxDQUFDLEdBQUcsT0FBTyxJQUFJLEVBQUUsVUFBVSxLQUFLO0FBRXBGLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsS0FBSyxRQUFRLEVBQUUsQ0FBQyxHQUFHLE9BQU8sSUFBSSxFQUFFLFVBQVUsS0FBSztBQUVwRixTQUFPLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLEtBQUssUUFBUSxFQUFFLENBQUMsR0FBRyxPQUFPLE9BQU8sdUJBQXVCLENBQUMsRUFBRSxVQUFVLElBQUk7QUFHOUcsUUFBTSxJQUFJLElBQUksbUJBQW1CO0FBQ2pDLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsTUFBTSxRQUFRLEVBQUUsQ0FBQyxHQUFHLE9BQU8sR0FBSSxFQUFFLFVBQVUsSUFBSTtBQUNwRixTQUFPLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLElBQUksUUFBUSxHQUFHLENBQUMsR0FBRyxPQUFPLE1BQU8sb0JBQW9CLEVBQUUsVUFBVSxNQUFNLCtCQUErQjtBQUMzSSxRQUFNLElBQUksSUFBSSxtQkFBbUI7QUFDakMsU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxNQUFNLFFBQVEsRUFBRSxDQUFDLEdBQUcsT0FBTyxHQUFJLEVBQUUsVUFBVSxJQUFJO0FBQ3BGLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsSUFBSSxRQUFRLEdBQUcsQ0FBQyxHQUFHLE9BQU8sTUFBTyx1QkFBdUIsQ0FBQyxFQUFFLFVBQVUsT0FBTyx1QkFBdUI7QUFDMUksQ0FBQztBQUVELEtBQUssaUhBQTRHLE1BQU07QUFFckgsUUFBTSxJQUFJLElBQUksbUJBQW1CO0FBQ2pDLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsS0FBSyxRQUFRLEVBQUUsQ0FBQyxHQUFHLE9BQU8sR0FBSSxFQUFFLFVBQVUsTUFBTSxrREFBa0Q7QUFDdkksU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxJQUFJLENBQUMsR0FBRyxPQUFPLElBQUksRUFBRSxVQUFVLE9BQU8scURBQXFEO0FBQ2hJLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsSUFBSSxDQUFDLEdBQUcsT0FBTyxJQUFJLEVBQUUsVUFBVSxPQUFPLDJCQUEyQjtBQUN0RyxTQUFPLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLEtBQUssUUFBUSxFQUFFLENBQUMsR0FBRyxPQUFPLElBQUksRUFBRSxVQUFVLE9BQU8sK0NBQStDO0FBR3JJLFFBQU0sSUFBSSxJQUFJLG1CQUFtQjtBQUNqQyxTQUFPLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLElBQUksQ0FBQyxHQUFHLE9BQU8sR0FBSSxFQUFFLFVBQVUsS0FBSztBQUN6RSxTQUFPLFVBQVUsRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLE1BQU0sUUFBUSxFQUFFLENBQUMsR0FBRyxPQUFPLElBQUksR0FBRztBQUFBLElBQ3pFLFFBQVE7QUFBQSxJQUNSLE9BQU87QUFBQSxJQUNQLGNBQWM7QUFBQSxJQUNkLFVBQVU7QUFBQSxFQUNaLENBQUM7QUFHRCxRQUFNLElBQUksSUFBSSxtQkFBbUI7QUFDakMsU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxNQUFNLFFBQVEsRUFBRSxDQUFDLEdBQUcsT0FBTyxHQUFJLEVBQUUsVUFBVSxJQUFJO0FBQ3BGLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsSUFBSSxRQUFRLEdBQUcsQ0FBQyxHQUFHLE9BQU8sSUFBSSxFQUFFLFVBQVUsSUFBSTtBQUNuRixTQUFPLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLEtBQUssUUFBUSxJQUFJLENBQUMsR0FBRyxPQUFPLElBQUksRUFBRSxVQUFVLElBQUk7QUFFckYsU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxJQUFJLFFBQVEsR0FBRyxDQUFDLEdBQUcsT0FBTyxJQUFJLEVBQUUsVUFBVSxLQUFLO0FBQ3RGLENBQUM7QUFFRCxLQUFLLGdHQUFnRyxNQUFNO0FBRXpHLFFBQU0sSUFBSSxJQUFJLG1CQUFtQjtBQUNqQyxTQUFPLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLE1BQU0sUUFBUSxFQUFFLENBQUMsR0FBRyxPQUFPLEdBQUksRUFBRSxVQUFVLElBQUk7QUFDcEYsU0FBTyxVQUFVLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxLQUFLLFNBQVMsS0FBSyxDQUFDLEdBQUcsTUFBTSxJQUFJLEdBQUc7QUFBQSxJQUMzRSxRQUFRO0FBQUEsSUFDUixPQUFPO0FBQUEsSUFDUCxjQUFjO0FBQUEsSUFDZCxVQUFVO0FBQUEsRUFDWixDQUFDO0FBQ0QsU0FBTyxVQUFVLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxJQUFJLFFBQVEsR0FBRyxDQUFDLEdBQUcsT0FBTyxJQUFJLEdBQUc7QUFBQSxJQUN4RSxRQUFRO0FBQUEsSUFDUixPQUFPO0FBQUEsSUFDUCxjQUFjO0FBQUEsSUFDZCxVQUFVO0FBQUEsRUFDWixDQUFDO0FBR0QsUUFBTSxJQUFJLElBQUksbUJBQW1CO0FBQ2pDLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsTUFBTSxRQUFRLEVBQUUsQ0FBQyxHQUFHLE9BQU8sR0FBSSxFQUFFLFVBQVUsSUFBSTtBQUNwRixXQUFTLEtBQUssTUFBTSxNQUFNLE1BQU0sTUFBTSxJQUFJO0FBQ3hDLFdBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsS0FBSyxTQUFTLEtBQUssQ0FBQyxHQUFHLE9BQU8sRUFBRSxFQUFFLFVBQVUsSUFBSTtBQUFBLEVBQ3ZGO0FBQ0EsU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxJQUFJLFFBQVEsR0FBRyxDQUFDLEdBQUcsT0FBTyxJQUFJLEVBQUUsVUFBVSxPQUFPLHFEQUFnRDtBQUd0SSxRQUFNLElBQUksSUFBSSxtQkFBbUI7QUFDakMsU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxJQUFJLENBQUMsR0FBRyxPQUFPLEdBQUksRUFBRSxVQUFVLEtBQUs7QUFDekUsU0FBTyxVQUFVLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxHQUFHLFVBQVUsS0FBSyxDQUFDLEdBQUcsT0FBTyxJQUFJLEdBQUc7QUFBQSxJQUMzRSxRQUFRO0FBQUEsSUFDUixPQUFPO0FBQUEsSUFDUCxjQUFjO0FBQUEsSUFDZCxVQUFVO0FBQUEsRUFDWixDQUFDO0FBQ0QsU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxLQUFLLFFBQVEsRUFBRSxDQUFDLEdBQUcsT0FBTyxJQUFJLEVBQUUsVUFBVSxPQUFPLHNDQUFzQztBQUc1SCxRQUFNLElBQUksSUFBSSxtQkFBbUI7QUFDakMsU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxLQUFLLFNBQVMsS0FBSyxDQUFDLEdBQUcsT0FBTyxHQUFJLEVBQUUsVUFBVSxJQUFJO0FBQ3ZGLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsSUFBSSxRQUFRLEdBQUcsQ0FBQyxHQUFHLE9BQU8sSUFBSSxFQUFFLFVBQVUsT0FBTyxpREFBaUQ7QUFDekksQ0FBQztBQUVELEtBQUssZ0hBQWdILE1BQU07QUFFekgsUUFBTSxJQUFJLElBQUksbUJBQW1CO0FBQ2pDLFNBQU8sVUFBVSxFQUFFLE1BQU0sTUFBTSxDQUFDLENBQUMsR0FBRyxPQUFPLEdBQUksR0FBRyxFQUFFLFFBQVEsR0FBRyxPQUFPLEdBQUcsY0FBYyxHQUFHLFVBQVUsTUFBTSxDQUFDO0FBRzNHLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsTUFBTSxRQUFRLEVBQUUsQ0FBQyxHQUFHLE9BQU8sSUFBSSxFQUFFLFVBQVUsSUFBSTtBQUNwRixTQUFPLE1BQU0sRUFBRSxNQUFNLE1BQU0sQ0FBQyxDQUFDLEdBQUcsT0FBTyxJQUFJLEVBQUUsVUFBVSxLQUFLO0FBQzVELFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsSUFBSSxRQUFRLEdBQUcsQ0FBQyxHQUFHLE9BQU8sSUFBSSxFQUFFLFVBQVUsTUFBTSxrQ0FBa0M7QUFHdkgsUUFBTSxJQUFJLElBQUksbUJBQW1CO0FBQ2pDLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsTUFBTSxRQUFRLEVBQUUsQ0FBQyxHQUFHLE9BQU8sR0FBSSxFQUFFLFVBQVUsSUFBSTtBQUNwRixTQUFPLE1BQU0sRUFBRSxNQUFNLE1BQU0sQ0FBQyxDQUFDLEdBQUcsT0FBTyxNQUFPLEdBQUcsRUFBRSxVQUFVLEtBQUs7QUFDbEUsU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxJQUFJLFFBQVEsR0FBRyxDQUFDLEdBQUcsT0FBTyxNQUFPLE1BQU0sb0JBQW9CLEVBQUUsVUFBVSxLQUFLO0FBQ25ILENBQUM7QUFFRCxLQUFLLGdJQUEySCxNQUFNO0FBRXBJLFFBQU0sSUFBSSxJQUFJLG1CQUFtQjtBQUNqQyxTQUFPLFVBQVUsRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLElBQUksUUFBUSxHQUFHLFdBQVcsRUFBRSxDQUFDLEdBQUcsTUFBTSxHQUFJLEdBQUc7QUFBQSxJQUNwRixRQUFRO0FBQUEsSUFDUixPQUFPO0FBQUEsSUFDUCxjQUFjO0FBQUEsSUFDZCxVQUFVO0FBQUEsRUFDWixDQUFDO0FBR0QsU0FBTyxVQUFVLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxHQUFHLFdBQVcsRUFBRSxDQUFDLEdBQUcsTUFBTSxJQUFJLEdBQUc7QUFBQSxJQUN4RSxRQUFRO0FBQUEsSUFDUixPQUFPO0FBQUEsSUFDUCxjQUFjO0FBQUEsSUFDZCxVQUFVO0FBQUEsRUFDWixDQUFDO0FBRUQsU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxHQUFHLFdBQVcsRUFBRSxDQUFDLEdBQUcsTUFBTSxJQUFJLEVBQUUsVUFBVSxLQUFLO0FBRXBGLFFBQU0sSUFBSSxJQUFJLG1CQUFtQjtBQUNqQyxTQUFPLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLEdBQUcsV0FBVyxFQUFFLENBQUMsR0FBRyxPQUFPLEdBQUksRUFBRSxVQUFVLEtBQUs7QUFDckYsU0FBTyxNQUFNLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxJQUFJLFdBQVcsRUFBRSxDQUFDLEdBQUcsT0FBTyxJQUFJLEVBQUUsVUFBVSxPQUFPLHlDQUF5QztBQUNuSSxDQUFDO0FBV0QsS0FBSyw4R0FBeUcsTUFBTTtBQUdsSCxTQUFPLFVBQVUsV0FBVyxNQUFNLEVBQUUsUUFBUSxHQUFHLENBQUMsR0FBRyxFQUFFLElBQUksT0FBTyxNQUFNLEtBQUssQ0FBQyxHQUFHO0FBQUEsSUFDN0UsUUFBUTtBQUFBLElBQ1IsT0FBTztBQUFBLElBQ1AsY0FBYztBQUFBLElBQ2QsVUFBVTtBQUFBLEVBQ1osQ0FBQztBQUNELFNBQU8sVUFBVSxXQUFXLE1BQU0sRUFBRSxRQUFRLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxPQUFPLE1BQU0sS0FBSyxDQUFDLEdBQUc7QUFBQSxJQUM5RSxRQUFRO0FBQUEsSUFDUixPQUFPO0FBQUEsSUFDUCxjQUFjO0FBQUEsSUFDZCxVQUFVO0FBQUEsRUFDWixDQUFDO0FBRUQsU0FBTyxVQUFVLFdBQVcsTUFBTSxFQUFFLFFBQVEsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLE1BQU0sTUFBTSxNQUFNLENBQUMsR0FBRztBQUFBLElBQzlFLFFBQVE7QUFBQSxJQUNSLE9BQU87QUFBQSxJQUNQLGNBQWM7QUFBQSxJQUNkLFVBQVU7QUFBQSxFQUNaLENBQUM7QUFDRCxTQUFPLFVBQVUsV0FBVyxNQUFNLEVBQUUsUUFBUSxHQUFHLENBQUMsR0FBRyxFQUFFLElBQUksTUFBTSxNQUFNLE1BQU0sQ0FBQyxHQUFHO0FBQUEsSUFDN0UsUUFBUTtBQUFBLElBQ1IsT0FBTztBQUFBLElBQ1AsY0FBYztBQUFBLElBQ2QsVUFBVTtBQUFBLEVBQ1osQ0FBQztBQUdELGFBQVcsTUFBTSxDQUFDLElBQUksR0FBRyxHQUFHO0FBQzFCLFdBQU8sTUFBTSxXQUFXLE1BQU0sRUFBRSxRQUFRLEdBQUcsQ0FBQyxHQUFHLEVBQUUsSUFBSSxPQUFPLE1BQU0sTUFBTSxDQUFDLEVBQUUsVUFBVSxLQUFLO0FBQUEsRUFDNUY7QUFHQSxTQUFPLFVBQVUsV0FBVyxNQUFNLEVBQUUsUUFBUSxLQUFLLFFBQVEsRUFBRSxDQUFDLEdBQUcsRUFBRSxJQUFJLE9BQU8sTUFBTSxLQUFLLENBQUMsR0FBRztBQUFBLElBQ3pGLFFBQVE7QUFBQSxJQUNSLE9BQU87QUFBQSxJQUNQLGNBQWM7QUFBQSxJQUNkLFVBQVU7QUFBQSxFQUNaLENBQUM7QUFDRCxTQUFPLFVBQVUsV0FBVyxNQUFNLEVBQUUsUUFBUSxLQUFLLFFBQVEsRUFBRSxDQUFDLEdBQUcsRUFBRSxJQUFJLE9BQU8sTUFBTSxNQUFNLENBQUMsR0FBRztBQUFBLElBQzFGLFFBQVE7QUFBQSxJQUNSLE9BQU87QUFBQSxJQUNQLGNBQWM7QUFBQSxJQUNkLFVBQVU7QUFBQSxFQUNaLENBQUM7QUFDSCxDQUFDO0FBRUQsS0FBSyx3RkFBd0YsTUFBTTtBQUVqRyxRQUFNLElBQUksSUFBSSxtQkFBbUI7QUFDakMsTUFBSSxLQUFLO0FBQ1QsU0FBTyxVQUFVLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxJQUFJLENBQUMsR0FBRyxFQUFFLElBQUksT0FBTyxNQUFNLEtBQUssR0FBRyxFQUFFLEdBQUc7QUFBQSxJQUMvRSxRQUFRO0FBQUEsSUFDUixPQUFPO0FBQUEsSUFDUCxjQUFjO0FBQUEsSUFDZCxVQUFVO0FBQUEsRUFDWixDQUFDO0FBQ0QsUUFBTTtBQUNOLFNBQU87QUFBQSxJQUNMLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxJQUFJLENBQUMsR0FBRyxFQUFFLElBQUksTUFBTSxNQUFNLE1BQU0sR0FBRyxFQUFFO0FBQUEsSUFDN0QsRUFBRSxRQUFRLEdBQUcsT0FBTyxHQUFHLGNBQWMsS0FBSyxVQUFVLEtBQUs7QUFBQSxJQUN6RDtBQUFBLEVBQ0Y7QUFDQSxRQUFNO0FBQ04sUUFBTSxTQUFTLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxLQUFLLFFBQVEsRUFBRSxDQUFDLEdBQUcsRUFBRSxJQUFJLE1BQU0sTUFBTSxNQUFNLEdBQUcsRUFBRTtBQUN2RixTQUFPLE1BQU0sT0FBTyxVQUFVLE1BQU0seURBQXlEO0FBQzdGLFNBQU8sTUFBTSxPQUFPLE9BQU8sQ0FBQztBQUM1QixTQUFPLE1BQU0sT0FBTyxjQUFjLENBQUM7QUFFbkMsUUFBTSx1QkFBdUI7QUFDN0IsU0FBTyxVQUFVLEVBQUUsTUFBTSxNQUFNLEVBQUUsUUFBUSxJQUFJLENBQUMsR0FBRyxFQUFFLElBQUksTUFBTSxNQUFNLE1BQU0sR0FBRyxFQUFFLEdBQUc7QUFBQSxJQUMvRSxRQUFRO0FBQUEsSUFDUixPQUFPO0FBQUEsSUFDUCxjQUFjO0FBQUEsSUFDZCxVQUFVO0FBQUEsRUFDWixDQUFDO0FBRUQsUUFBTTtBQUNOLFNBQU8sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLFFBQVEsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLE1BQU0sTUFBTSxLQUFLLEdBQUcsRUFBRSxFQUFFLFVBQVUsS0FBSztBQUMxRixRQUFNLHVCQUF1QjtBQUM3QixTQUFPLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxRQUFRLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxNQUFNLE1BQU0sS0FBSyxHQUFHLEVBQUUsRUFBRSxVQUFVLE1BQU0sOENBQThDO0FBQzNJLENBQUM7QUFFRCxLQUFLLHNGQUFzRixNQUFNO0FBQy9GLFFBQU0sVUFBVTtBQUFBLElBQ2QsRUFBRSxJQUFJLE9BQU8sTUFBTSxNQUFNO0FBQUEsSUFDekIsRUFBRSxJQUFJLE1BQU0sTUFBTSxNQUFNO0FBQUEsSUFDeEIsRUFBRSxJQUFJLE9BQU8sTUFBTSxLQUFLO0FBQUEsSUFDeEIsRUFBRSxJQUFJLE1BQU0sTUFBTSxLQUFLO0FBQUEsRUFDekI7QUFDQSxhQUFXLFNBQVMsU0FBUztBQUMzQixlQUFXLFVBQVUsQ0FBQyxLQUFLLElBQUksR0FBRyxHQUFHLEVBQUUsR0FBRztBQUN4QyxpQkFBVyxVQUFVLENBQUMsR0FBRyxJQUFJLEdBQUcsR0FBRztBQUNqQyxjQUFNLElBQUksTUFBTSxFQUFFLFFBQVEsT0FBTyxDQUFDO0FBQ2xDLGNBQU0sUUFBUSxJQUFJLG1CQUFtQjtBQUNyQyxlQUFPO0FBQUEsVUFDTCxNQUFNLE1BQU0sR0FBRyxPQUFPLEdBQUc7QUFBQSxVQUN6QixXQUFXLEdBQUcsS0FBSztBQUFBLFVBQ25CLE1BQU0sTUFBTSxPQUFPLE1BQU0sVUFBVSxLQUFLLFVBQVUsS0FBSyxDQUFDO0FBQUEsUUFDMUQ7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDO0FBSUQsS0FBSyxnRkFBZ0YsTUFBTTtBQUV6RixRQUFNLE9BQU8sS0FBSztBQUNsQixRQUFNLE9BQU87QUFDYixRQUFNLFFBQVE7QUFDZCxRQUFNLFNBQVM7QUFDZixhQUFXLE9BQU8sQ0FBQyxHQUFHLEtBQUssR0FBRyxDQUFDLEdBQUc7QUFDaEMsVUFBTSxLQUFLLG9CQUFJLElBQVk7QUFDM0IsYUFBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLEtBQUs7QUFDNUIsWUFBTSxNQUFNLFNBQW9CLElBQUk7QUFDcEMsWUFBTSxNQUFNLE1BQU0sT0FBTztBQUN6QixZQUFNLE9BQU8sRUFBRSxPQUFPLE1BQU0sTUFBTSxJQUFJO0FBQ3RDLFNBQUcsSUFBSSxTQUFTLEtBQUssTUFBTSxRQUFRLE9BQU8sR0FBRyxDQUFDO0FBQUEsSUFDaEQ7QUFDQSxXQUFPLE1BQU0sR0FBRyxNQUFNLEdBQUcsT0FBTyxHQUFHLGtDQUFrQyxHQUFHLElBQUksRUFBRTtBQUFBLEVBQ2hGO0FBQ0YsQ0FBQztBQUVELEtBQUssb0VBQW9FLE1BQU07QUFDN0UsYUFBVyxPQUFPLENBQUMsR0FBRyxLQUFLLEdBQUcsQ0FBQyxHQUFHO0FBQ2hDLFVBQU0sT0FBTyxFQUFFLE9BQU8sS0FBVyxLQUFLLEtBQVU7QUFDaEQsVUFBTSxJQUFJLFNBQVMsTUFBVyxNQUFNLE9BQU8sT0FBTyxHQUFHO0FBQ3JELFVBQU0sTUFBTSxJQUFJLE1BQU07QUFDdEIsV0FBTyxHQUFHLEtBQUssSUFBSSxNQUFNLEtBQUssTUFBTSxHQUFHLENBQUMsSUFBSSxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMsb0NBQW9DO0FBQUEsRUFDeEc7QUFDRixDQUFDO0FBRUQsS0FBSyx5RkFBeUYsTUFBTTtBQUNsRyxRQUFNLE9BQU8sRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFRO0FBQ3RDLFFBQU0sUUFBUTtBQUNkLFFBQU0sTUFBTTtBQUNaLFFBQU0sY0FBYyxLQUFLLE1BQU0sS0FBSyxVQUFVLFFBQVE7QUFDdEQsUUFBTSxLQUFLLFNBQVMsTUFBUyxNQUFNLElBQUksT0FBTyxHQUFHO0FBQ2pELFFBQU0sS0FBSyxTQUFTLE9BQVUsSUFBSSxZQUFZLE1BQU0sSUFBSSxPQUFPLEdBQUc7QUFDbEUsU0FBTyxHQUFHLEtBQUssSUFBSSxNQUFNLEtBQUssSUFBSSxJQUFJLElBQUksTUFBTSxnREFBZ0QsS0FBSyxFQUFFLEVBQUU7QUFDM0csQ0FBQztBQUVELEtBQUssMkRBQTJELE1BQU07QUFDcEUsUUFBTSxPQUFPLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBSztBQUNuQyxTQUFPLE1BQU0sU0FBUyxLQUFLLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxLQUFLLEVBQUU7QUFDckQsU0FBTyxNQUFNLFNBQVMsS0FBSyxNQUFNLElBQUksS0FBSyxHQUFHLEdBQUcsS0FBSyxFQUFFO0FBQ3pELENBQUM7QUFJRCxJQUFNLE9BQU8sQ0FBQyxNQUFjLFFBQVEsS0FBTSxNQUFNLE1BQWMsUUFBUSxRQUFRO0FBRTlFLEtBQUssaUdBQWlHLE1BQU07QUFDMUcsUUFBTSxNQUFNO0FBQ1osUUFBTSxPQUFPO0FBRWIsUUFBTSxNQUFNLE1BQU0sT0FBTztBQUN6QixRQUFNLE9BQWlCLEVBQUUsT0FBTyxNQUFNLE1BQU0sSUFBSTtBQUVoRCxRQUFNLE9BQU8sUUFBUSxNQUFNLElBQU87QUFDbEMsU0FBTyxNQUFNLG1CQUFtQixNQUFNLEtBQUssS0FBSyxNQUFNLEtBQUssTUFBTSxLQUFLLElBQUksQ0FBQyxHQUFHLE9BQU8seUJBQXlCO0FBRTlHLFNBQU8sTUFBTSxtQkFBbUIsTUFBTSxLQUFLLEtBQUssTUFBTSxLQUFLLE9BQU8sS0FBSyxJQUFJLENBQUMsR0FBRyxJQUFJO0FBQ3JGLENBQUM7QUFFRCxLQUFLLGlFQUFpRSxNQUFNO0FBQzFFLFFBQU0sTUFBTTtBQUNaLFFBQU0sT0FBTztBQUNiLE1BQUksT0FBaUIsRUFBRSxPQUFPLE1BQU0sT0FBTyxtQkFBbUIsTUFBTSxLQUFLLE1BQU0sT0FBTyxpQkFBaUI7QUFDdkcsTUFBSSxZQUFZO0FBQ2hCLFdBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLFVBQU0sT0FBTyxRQUFRLE1BQU0sSUFBTTtBQUNqQyxnQkFBWSxtQkFBbUIsV0FBVyxLQUFLLEtBQUssTUFBTSxLQUFLLE1BQU0sS0FBSyxJQUFJLENBQUM7QUFDL0UsV0FBTyxNQUFNLFdBQVcsT0FBTyxRQUFRLENBQUMscUJBQXFCO0FBQzdELFdBQU87QUFBQSxFQUNUO0FBQ0YsQ0FBQztBQUVELEtBQUssaUdBQTRGLE1BQU07QUFDckcsUUFBTSxNQUFNO0FBQ1osUUFBTSxPQUFPO0FBQ2IsUUFBTSxLQUFLLEtBQUssSUFBSTtBQUNwQixRQUFNLFVBQVUsTUFBTTtBQUN0QixhQUFXLFNBQVMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHO0FBQzdCLFVBQU0sSUFBYyxFQUFFLE9BQU8sTUFBTSxRQUFRLEtBQUssTUFBTSxLQUFLLE1BQU0sUUFBUSxHQUFHO0FBQzVFLFdBQU8sTUFBTSxtQkFBbUIsT0FBTyxTQUFTLEdBQUcsS0FBSyxNQUFNLEVBQUUsR0FBRyxNQUFNLEdBQUcsS0FBSyx1QkFBdUI7QUFBQSxFQUMxRztBQUNBLFNBQU8sTUFBTSx1QkFBdUIsQ0FBQztBQUN2QyxDQUFDO0FBRUQsS0FBSyx3R0FBd0csTUFBTTtBQUNqSCxRQUFNLE1BQU07QUFDWixRQUFNLE9BQU87QUFDYixRQUFNLEtBQUssS0FBSyxJQUFJO0FBQ3BCLFFBQU0sVUFBVSxNQUFNO0FBQ3RCLGFBQVcsU0FBUyxDQUFDLEdBQUcsR0FBRyxJQUFJLEdBQUcsR0FBRztBQUNuQyxVQUFNLElBQWMsRUFBRSxPQUFPLE1BQU0sUUFBUSxLQUFLLE1BQU0sS0FBSyxNQUFNLFFBQVEsR0FBRztBQUM1RSxXQUFPLE1BQU0sbUJBQW1CLE9BQU8sU0FBUyxHQUFHLEtBQUssTUFBTSxFQUFFLEdBQUcsT0FBTyxHQUFHLEtBQUssc0JBQXNCO0FBQUEsRUFDMUc7QUFDQSxRQUFNLFdBQXFCLEVBQUUsT0FBTyxNQUFNLE9BQU8sTUFBTSxLQUFLLE1BQU0sT0FBTyxLQUFLO0FBQzlFLFNBQU8sTUFBTSxtQkFBbUIsT0FBTyxTQUFTLFVBQVUsS0FBSyxNQUFNLEVBQUUsR0FBRyxLQUFLO0FBQ2pGLENBQUM7QUFFRCxLQUFLLHVGQUFrRixNQUFNO0FBQzNGLFFBQU0sTUFBTTtBQUNaLFFBQU0sT0FBTztBQUNiLFFBQU0sUUFBUTtBQUNkLFFBQU0sUUFBUSxPQUFPO0FBQ3JCLFFBQU0sVUFBVSxNQUFNO0FBQ3RCLFNBQU87QUFBQSxJQUNMLG1CQUFtQixPQUFPLFNBQVMsRUFBRSxPQUFPLE1BQU0sSUFBSSxRQUFRLE1BQU0sS0FBSyxNQUFNLElBQUksTUFBTSxHQUFHLEtBQUssTUFBTSxLQUFLLE1BQU0sT0FBTyxDQUFDLENBQUM7QUFBQSxJQUMzSDtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQUEsSUFDTCxtQkFBbUIsT0FBTyxTQUFTLEVBQUUsT0FBTyxNQUFNLE1BQU0sUUFBUSxNQUFNLEtBQUssTUFBTSxNQUFNLE1BQU0sR0FBRyxLQUFLLE1BQU0sS0FBSyxNQUFNLE9BQU8sQ0FBQyxDQUFDO0FBQUEsSUFDL0g7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUFBLElBQ0wsbUJBQW1CLE9BQU8sU0FBUyxFQUFFLE9BQU8sTUFBTSxJQUFJLFFBQVEsTUFBTSxLQUFLLE1BQU0sSUFBSSxNQUFNLEdBQUcsS0FBSyxNQUFNLEtBQUssTUFBTSxPQUFPLENBQUMsQ0FBQztBQUFBLElBQzNIO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFBQSxJQUNMLG1CQUFtQixPQUFPLFNBQVMsRUFBRSxPQUFPLE1BQU0sSUFBSSxRQUFRLE1BQU0sS0FBSyxNQUFNLElBQUksTUFBTSxHQUFHLEtBQUssTUFBTSxLQUFLLE1BQU0sT0FBTyxDQUFDLENBQUM7QUFBQSxJQUMzSDtBQUFBLEVBQ0Y7QUFDRixDQUFDO0FBRUQsS0FBSyx5RkFBb0YsTUFBTTtBQUM3RixRQUFNLE1BQU07QUFDWixRQUFNLE9BQU87QUFDYixRQUFNLE1BQU0sTUFBTSxPQUFPO0FBQ3pCLFFBQU0sT0FBaUIsRUFBRSxPQUFPLE1BQU0sTUFBTSxJQUFJO0FBQ2hELFFBQU0sU0FBUyxTQUFTLE1BQU0sTUFBTSxPQUFPLEdBQUcsSUFBSTtBQUNsRCxTQUFPLEdBQUcsT0FBTyxNQUFNLEtBQUssR0FBRztBQUUvQixTQUFPLEdBQUcsT0FBTyxNQUFNLE1BQU0sd0JBQXdCLEtBQUssT0FBTyxNQUFNLE9BQU8sS0FBSyxDQUFDO0FBQ3BGLFNBQU8sTUFBTSxtQkFBbUIsTUFBTSxLQUFLLEtBQUssUUFBUSxLQUFLLE9BQU8sS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLENBQUMsR0FBRyxJQUFJO0FBRTFHLFNBQU8sTUFBTSxtQkFBbUIsT0FBTyxLQUFLLEtBQUssUUFBUSxLQUFLLE9BQU8sS0FBSyxPQUFPLE1BQU0sT0FBTyxLQUFLLENBQUMsR0FBRyxLQUFLO0FBQzlHLENBQUM7QUFTRCxLQUFLLDhGQUE4RixNQUFNO0FBQ3ZHLFFBQU0sTUFBTTtBQUNaLFFBQU0sT0FBTztBQUNiLFFBQU0sUUFBUTtBQUVkLFFBQU0sTUFBTSxNQUFNLE9BQU87QUFDekIsUUFBTSxPQUFpQixFQUFFLE9BQU8sTUFBTSxNQUFNLElBQUk7QUFFaEQsUUFBTSxTQUFTLEtBQUssUUFBUSxPQUFPO0FBQ25DLFFBQU0sU0FBUyxTQUFTLE1BQU0sUUFBUSxDQUFDO0FBRXZDLFNBQU8sR0FBRyxLQUFLLEtBQUssU0FBUyxPQUFPLFVBQVUsT0FBTyxNQUFNLE9BQU8sU0FBUyxJQUFJLENBQUMsSUFBSSxJQUFJO0FBRXhGLFFBQU0sUUFBUSxPQUFPLE1BQU0sT0FBTztBQUNsQyxTQUFPLE1BQU0sbUJBQW1CLE9BQU8sS0FBSyxLQUFLLFFBQVEsS0FBSyxPQUFPLEtBQUssT0FBTyxLQUFLLENBQUMsR0FBRyxLQUFLO0FBRS9GLFNBQU8sVUFBVSxlQUFlLFFBQVEsR0FBRyxHQUFHLE1BQU07QUFDdEQsQ0FBQztBQUVELEtBQUssdUZBQXVGLE1BQU07QUFDaEcsUUFBTSxNQUFNO0FBQ1osUUFBTSxPQUFPO0FBQ2IsUUFBTSxRQUFRO0FBQ2QsUUFBTSxPQUFpQixFQUFFLE9BQU8sTUFBTSxNQUFNLEtBQUssSUFBSTtBQUNyRCxRQUFNLE9BQU8sSUFBSTtBQUNqQixRQUFNLFNBQVMsS0FBSyxRQUFRLE9BQU87QUFFbkMsUUFBTSxJQUFJO0FBQ1YsUUFBTSxVQUFVLENBQUMsT0FBZSxNQUFNLFdBQVcsSUFBSSxPQUFPLElBQUk7QUFDaEUsYUFBVyxDQUFDLEdBQUcsT0FBTyxLQUFLO0FBQUEsSUFDekIsQ0FBQyx1QkFBdUIsSUFBSTtBQUFBLElBQzVCLENBQUMsd0JBQXdCLEdBQUcsS0FBSztBQUFBLEVBQ25DLEdBQVk7QUFDVixVQUFNLFNBQVMsU0FBUyxNQUFNLFFBQVEsT0FBTyxRQUFRLENBQUMsQ0FBQztBQUN2RCxXQUFPLEdBQUcsS0FBSyxJQUFJLE9BQU8sT0FBTyxNQUFPLElBQUksUUFBUSxDQUFDLElBQUssRUFBRSxJQUFJLElBQUk7QUFFcEUsV0FBTyxHQUFHLEtBQUssS0FBSyxTQUFTLE9BQU8sVUFBVSxPQUFPLE1BQU0sT0FBTyxTQUFTLElBQUksSUFBSSxJQUFJO0FBRXZGLFVBQU0sUUFBUSxPQUFPLE1BQU0sT0FBTztBQUNsQyxXQUFPO0FBQUEsTUFDTCxtQkFBbUIsT0FBTyxLQUFLLEtBQUssUUFBUSxLQUFLLE9BQU8sS0FBSyxPQUFPLEtBQUssQ0FBQztBQUFBLE1BQzFFO0FBQUEsTUFDQSxHQUFHLENBQUM7QUFBQSxJQUNOO0FBQUEsRUFDRjtBQUNGLENBQUM7QUFFRCxLQUFLLDhGQUE4RixNQUFNO0FBQ3ZHLFFBQU0sTUFBTTtBQUNaLFFBQU0sT0FBTztBQUNiLFFBQU0sUUFBUTtBQUNkLFFBQU0sTUFBTSxNQUFNLE9BQU87QUFDekIsUUFBTSxPQUFpQixFQUFFLE9BQU8sTUFBTSxNQUFNLElBQUk7QUFDaEQsUUFBTSxTQUFTLEtBQUssUUFBUSxPQUFPO0FBQ25DLFFBQU0sWUFBWSxTQUFTLE1BQU0sUUFBUSxJQUFJLENBQUM7QUFFOUMsU0FBTyxHQUFHLFVBQVUsTUFBTSxHQUFHO0FBRTdCLFFBQU0sUUFBUSxVQUFVLE1BQU0sVUFBVTtBQUN4QyxTQUFPLE1BQU0sbUJBQW1CLE9BQU8sS0FBSyxLQUFLLFdBQVcsS0FBSyxPQUFPLEtBQUssT0FBTyxLQUFLLENBQUMsR0FBRyxJQUFJO0FBRWpHLFFBQU0sVUFBVSxlQUFlLFdBQVcsR0FBRztBQUM3QyxTQUFPLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDN0IsU0FBTyxNQUFNLFFBQVEsTUFBTSxRQUFRLE9BQU8sS0FBSztBQUNqRCxDQUFDO0FBRUQsS0FBSyxzR0FBaUcsTUFBTTtBQUMxRyxRQUFNLE1BQU07QUFDWixRQUFNLE9BQU87QUFDYixhQUFXLGFBQWEsQ0FBQyxHQUFHLEtBQU8sTUFBTSxLQUFLLElBQUksR0FBRztBQUNuRCxVQUFNLElBQUksZUFBZSxFQUFFLE9BQU8sTUFBTSxPQUFPLFdBQVcsS0FBSyxNQUFNLFVBQVUsR0FBRyxHQUFHO0FBQ3JGLFdBQU8sTUFBTSxFQUFFLEtBQUssS0FBSyxhQUFhLFNBQVMsb0JBQW9CO0FBQ25FLFdBQU8sTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLE1BQU0sZ0JBQWdCO0FBQUEsRUFDdEQ7QUFDQSxRQUFNLFNBQW1CLEVBQUUsT0FBTyxNQUFNLElBQUksTUFBTSxLQUFLLE1BQU0sS0FBSztBQUNsRSxTQUFPLFVBQVUsZUFBZSxRQUFRLEdBQUcsR0FBRyxNQUFNO0FBQ3BELFFBQU0sS0FBZSxFQUFFLE9BQU8sTUFBTSxNQUFNLEtBQUssSUFBSTtBQUNuRCxTQUFPLFVBQVUsZUFBZSxJQUFJLEdBQUcsR0FBRyxFQUFFO0FBQzlDLENBQUM7QUFFRCxLQUFLLHFFQUFxRSxNQUFNO0FBQzlFLFFBQU0sTUFBTTtBQUNaLFFBQU0sTUFBTSxNQUFNO0FBQ2xCLFFBQU0sT0FBTztBQUViLFFBQU0sSUFBYyxFQUFFLE9BQU8sTUFBTSxJQUFJLE1BQU0sS0FBSyxNQUFNLElBQUksS0FBSztBQUNqRSxTQUFPLFVBQVUsa0JBQWtCLEdBQUcsRUFBRSxLQUFLLE1BQU0sS0FBSyxLQUFLLENBQUMsR0FBRyxDQUFDO0FBRWxFLFFBQU0sT0FBTyxrQkFBa0IsRUFBRSxPQUFPLE1BQU0sTUFBTSxLQUFLLElBQUksR0FBRyxFQUFFLEtBQUssS0FBSyxLQUFLLENBQUM7QUFDbEYsU0FBTyxVQUFVLE1BQU0sRUFBRSxPQUFPLEtBQUssS0FBSyxNQUFNLEtBQUssQ0FBQztBQUN0RCxTQUFPLFVBQVUsa0JBQWtCLEVBQUUsT0FBTyxLQUFLLEtBQUssTUFBTSxLQUFLLEdBQUcsRUFBRSxLQUFLLEtBQUssS0FBSyxDQUFDLEdBQUcsRUFBRSxPQUFPLEtBQUssS0FBSyxNQUFNLEtBQUssQ0FBQztBQUV4SCxRQUFNLE1BQU0sa0JBQWtCLEVBQUUsT0FBTyxLQUFLLEtBQUssTUFBTSxLQUFLLEdBQUcsRUFBRSxLQUFLLE1BQU0sSUFBSSxDQUFDO0FBQ2pGLFNBQU8sVUFBVSxLQUFLLEVBQUUsT0FBTyxNQUFNLE1BQU0sS0FBSyxJQUFJLENBQUM7QUFDckQsU0FBTyxVQUFVLGtCQUFrQixFQUFFLE9BQU8sTUFBTSxLQUFLLE1BQU0sS0FBSyxNQUFNLEtBQUssS0FBSyxHQUFHLEVBQUUsS0FBSyxNQUFNLElBQUksQ0FBQyxHQUFHO0FBQUEsSUFDeEcsT0FBTyxNQUFNLEtBQUs7QUFBQSxJQUNsQixLQUFLLE1BQU0sS0FBSztBQUFBLEVBQ2xCLENBQUM7QUFFRCxRQUFNLFNBQW1CLEVBQUUsT0FBTyxNQUFNLE1BQU0sS0FBSyxNQUFNLElBQUksS0FBSztBQUNsRSxTQUFPLFVBQVUsa0JBQWtCLFFBQVEsRUFBRSxLQUFLLElBQUksQ0FBQyxHQUFHLE1BQU07QUFDaEUsU0FBTyxVQUFVLGtCQUFrQixFQUFFLE9BQU8sS0FBSyxLQUFLLE1BQU0sS0FBSyxHQUFHLEVBQUUsS0FBSyxJQUFJLENBQUMsR0FBRyxFQUFFLE9BQU8sTUFBTSxNQUFNLEtBQUssSUFBSSxDQUFDO0FBQ2xILFNBQU8sVUFBVSxrQkFBa0IsRUFBRSxPQUFPLE1BQU0sTUFBTSxLQUFLLElBQUksR0FBRyxFQUFFLEtBQUssSUFBSSxDQUFDLEdBQUcsRUFBRSxPQUFPLEtBQUssS0FBSyxNQUFNLEtBQUssQ0FBQztBQUdsSCxhQUFXLFFBQVEsQ0FBQyxNQUFNLE1BQU0sR0FBRyxNQUFNLE1BQU0sSUFBSSxHQUFHO0FBQ3BELFdBQU8sVUFBVSxrQkFBa0IsRUFBRSxPQUFPLE1BQU0sTUFBTSxLQUFLLElBQUksR0FBRyxFQUFFLEtBQUssSUFBSSxDQUFDLEdBQUcsRUFBRSxPQUFPLEtBQUssS0FBSyxJQUFJLENBQUM7QUFDM0csV0FBTyxVQUFVLGtCQUFrQixFQUFFLE9BQU8sS0FBSyxLQUFLLE1BQU0sS0FBSyxHQUFHLEVBQUUsS0FBSyxJQUFJLENBQUMsR0FBRyxFQUFFLE9BQU8sS0FBSyxLQUFLLElBQUksQ0FBQztBQUFBLEVBQzdHO0FBRUEsU0FBTyxVQUFVLGtCQUFrQixHQUFHLEVBQUUsS0FBSyxLQUFLLEtBQUssU0FBUyxDQUFDLEdBQUcsQ0FBQztBQUN2RSxDQUFDO0FBRUQsS0FBSyxpRkFBaUYsTUFBTTtBQUMxRixRQUFNLE1BQU07QUFDWixTQUFPLE1BQU0sZUFBZSxFQUFFLEtBQUssTUFBTSxLQUFLLEtBQUssQ0FBQyxHQUFHLFdBQVc7QUFDbEUsU0FBTyxNQUFNLGVBQWUsRUFBRSxLQUFLLEtBQUssS0FBSyxDQUFDLEdBQUcsV0FBVztBQUM1RCxTQUFPLE1BQU0sZUFBZSxFQUFFLEtBQUssTUFBTSxLQUFLLE1BQU0sSUFBSyxDQUFDLEdBQUcsV0FBVztBQUN4RSxTQUFPLE1BQU0sZUFBZSxFQUFFLEtBQUssS0FBSyxNQUFNLElBQVEsQ0FBQyxHQUFHLEdBQU87QUFFakUsU0FBTyxNQUFNLGVBQWUsRUFBRSxLQUFLLEtBQUssTUFBTSxLQUFLLFlBQVksQ0FBQyxHQUFHLFdBQVc7QUFDOUUsU0FBTyxNQUFNLGVBQWUsRUFBRSxLQUFLLEtBQUssTUFBTSxFQUFFLENBQUMsR0FBRyxXQUFXO0FBQ2pFLENBQUM7QUFFRCxLQUFLLGdGQUFnRixNQUFNO0FBRXpGLFFBQU0sTUFBTTtBQUNaLFFBQU0sTUFBTSxNQUFNO0FBQ2xCLFFBQU0sT0FBTztBQUNiLGFBQVcsT0FBTztBQUFBLElBQ2hCLEVBQUUsT0FBTyxNQUFNLEtBQUssTUFBTSxLQUFLLE1BQU0sSUFBSSxLQUFLO0FBQUEsSUFDOUMsRUFBRSxPQUFPLEtBQUssS0FBSyxNQUFNLEtBQUs7QUFBQSxJQUM5QixFQUFFLE9BQU8sTUFBTSxNQUFNLEtBQUssTUFBTSxJQUFJLEtBQUs7QUFBQSxFQUMzQyxHQUFHO0FBQ0QsVUFBTSxJQUFJLGtCQUFrQixLQUFLLEVBQUUsS0FBSyxLQUFLLElBQUksQ0FBQztBQUNsRCxXQUFPLEdBQUcsRUFBRSxTQUFTLEtBQUssMkJBQTJCO0FBQ3JELFdBQU8sR0FBRyxFQUFFLE9BQU8sS0FBSyx5QkFBeUI7QUFDakQsV0FBTyxNQUFNLEVBQUUsTUFBTSxFQUFFLE9BQU8sTUFBTSxrREFBNkM7QUFBQSxFQUNuRjtBQUNGLENBQUM7QUFFRCxLQUFLLHNHQUFzRyxNQUFNO0FBQy9HLFFBQU0sTUFBTTtBQUNaLFFBQU0sT0FBTztBQUNiLFFBQU0sS0FBSyxLQUFLLElBQUk7QUFDcEIsYUFBVyxVQUFVLENBQUMsTUFBTSxHQUFHLE1BQU0sTUFBTSxJQUFJLE1BQU0sSUFBSSxHQUFHO0FBQzFELFVBQU0sVUFBVSxlQUFlLEVBQUUsT0FBTyxTQUFTLE1BQU0sS0FBSyxPQUFPLEdBQUcsR0FBRztBQUN6RSxXQUFPLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDN0IsV0FBTyxNQUFNLG1CQUFtQixPQUFPLE1BQU0sTUFBTSxTQUFTLEtBQUssTUFBTSxFQUFFLEdBQUcsSUFBSTtBQUFBLEVBQ2xGO0FBQ0YsQ0FBQztBQUlELElBQU0sV0FBVyxNQUFPO0FBRXhCLElBQU0sZ0JBQWdCLENBQUMsTUFBYyxJQUFZLFVBQTBCLEtBQUssSUFBSSxJQUFJLElBQUksS0FBSyxLQUFLO0FBRXRHLEtBQUssd0ZBQW1GLE1BQU07QUFDNUYsUUFBTSxNQUFNO0FBQ1osUUFBTSxPQUFPO0FBRWIsU0FBTyxNQUFNLGdCQUFnQixLQUFLLEtBQUssTUFBTSxDQUFDLEdBQUcsQ0FBQztBQUNsRCxRQUFNLFFBQVEsSUFBSSxLQUFLLElBQUk7QUFDM0IsUUFBTSxRQUFRLGdCQUFnQixNQUFNLE9BQU8sS0FBSyxNQUFNLENBQUM7QUFDdkQsU0FBTyxHQUFHLFFBQVEsS0FBSyxRQUFRLE9BQU8sdUNBQXVDLEtBQUssR0FBRztBQUVyRixTQUFPLE1BQU0sZ0JBQWdCLE1BQU0sTUFBTSxLQUFLLE1BQU0sZ0JBQWdCLEdBQUcsZ0JBQWdCO0FBQ3ZGLFNBQU8sTUFBTSxnQkFBZ0IsTUFBTSxNQUFNLEtBQUssTUFBTSxDQUFDLEdBQUcsQ0FBQztBQUV6RCxTQUFPLE1BQU0sZ0JBQWdCLE1BQU0sS0FBSyxNQUFNLEtBQUssTUFBTSxDQUFDLEdBQUcsR0FBRztBQUVoRSxTQUFPLE1BQU0sZ0JBQWdCLE1BQU0sR0FBRyxLQUFLLEdBQUcsZ0JBQWdCLEdBQUcsQ0FBQztBQUNwRSxDQUFDO0FBRUQsS0FBSyw0SEFBdUgsTUFBTTtBQUNoSSxRQUFNLE9BQU87QUFDYixNQUFJLE9BQU87QUFDWCxTQUFPLE1BQU0sYUFBYSxNQUFNLGtCQUFrQixHQUFHLG9CQUFvQixHQUFHLE1BQU0sZ0NBQWdDO0FBQ2xILFdBQVMsSUFBSSxHQUFHLEtBQUssdUJBQXVCLElBQUksS0FBSyxHQUFHO0FBQ3RELFVBQU0sSUFBSSxhQUFhLE1BQU0sa0JBQWtCLEdBQUcsb0JBQW9CO0FBQ3RFLFdBQU8sR0FBRyxLQUFLLE1BQU0saUJBQWlCLENBQUMsRUFBRTtBQUN6QyxXQUFPLEdBQUcsS0FBSyxrQkFBa0IscUJBQXFCLENBQUMsRUFBRTtBQUN6RCxXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU8sTUFBTSxhQUFhLE1BQU0sa0JBQWtCLHNCQUFzQixvQkFBb0IsR0FBRyxrQkFBa0IsMkJBQTJCO0FBQzlJLENBQUM7QUFFRCxLQUFLLDhHQUF5RyxNQUFNO0FBQ2xILFFBQU0sT0FBTztBQUNiLFFBQU0sT0FBTztBQUViLFFBQU0sUUFBUSxDQUFDQyxPQUFzQixPQUFPQSxLQUFJLE9BQU8sYUFBYSxHQUFHLGtCQUFrQkEsSUFBRyxvQkFBb0I7QUFDaEgsU0FBTyxNQUFNLE1BQU0sQ0FBQyxHQUFHLE1BQU0sNkRBQTZEO0FBQzFGLFFBQU0sV0FBVyxPQUFPO0FBQ3hCLFFBQU0sUUFBUSxjQUFjLG1CQUFtQixNQUFNLFVBQVUsb0JBQW9CO0FBQ25GLE1BQUksVUFBVTtBQUNkLFdBQVNBLEtBQUksVUFBVUEsTUFBSyx1QkFBdUIsSUFBSSxVQUFVQSxNQUFLLFVBQVU7QUFDOUUsVUFBTSxPQUFPLE1BQU1BLEVBQUMsSUFBSSxNQUFNQSxLQUFJLFFBQVEsSUFBSTtBQUM5QyxXQUFPLEdBQUcsUUFBUSxPQUFPLDBDQUEwQ0EsRUFBQyxHQUFHO0FBQ3ZFLFdBQU8sR0FBRyxRQUFRLFFBQVEsTUFBTSxLQUFLQSxFQUFDLGlCQUFpQixJQUFJLGlCQUFpQixLQUFLLEVBQUU7QUFDbkYsY0FBVSxLQUFLLElBQUksU0FBUyxJQUFJO0FBQUEsRUFDbEM7QUFDQSxTQUFPLEdBQUcsVUFBVSxXQUFXLEdBQUcsc0JBQXNCLE9BQU8sK0JBQStCLFFBQVEsYUFBYTtBQUVuSCxRQUFNLElBQUksS0FBSztBQUNmLFNBQU8sTUFBTSxNQUFNLENBQUMsR0FBRyxPQUFPLElBQUksT0FBTyxnQkFBZ0I7QUFDM0QsQ0FBQztBQUVELEtBQUssdUhBQWtILE1BQU07QUFDM0gsUUFBTSxPQUFPO0FBQ2IsUUFBTSxRQUFRO0FBQ2QsTUFBSSxNQUFNO0FBRVYsTUFBSSxPQUFPO0FBQ1gsTUFBSSxPQUFpQixFQUFFLE9BQU8sTUFBTSxPQUFPLE9BQU8sTUFBTSxLQUFLLE1BQU0sT0FBTyxLQUFLO0FBQy9FLFFBQU0sU0FBUyxDQUFDLEtBQU8sS0FBTyxLQUFPLEdBQUs7QUFDMUMsTUFBSSxRQUFnRDtBQUNwRCxNQUFJLFlBQVk7QUFDaEIsTUFBSSxVQUFVO0FBQ2QsTUFBSSxJQUFJO0FBQ1IsUUFBTSxTQUFTLENBQUMsT0FBd0IsUUFBUSxhQUFhLE1BQU0sTUFBTSxHQUFHLEtBQUssTUFBTSxPQUFPLEtBQUssSUFBSTtBQUN2RyxXQUFTLFFBQVEsR0FBRyxRQUFRLElBQUksU0FBUztBQUN2QyxVQUFNLFVBQVUsS0FBSztBQUNyQixRQUFJLFlBQVk7QUFDaEIsU0FBSztBQUNMLFdBQU87QUFFUCxRQUFJLFdBQVc7QUFDYixhQUFPLEVBQUUsT0FBTyxNQUFNLE9BQU8sT0FBTyxNQUFNLEtBQUssTUFBTSxPQUFPLEtBQUs7QUFBQSxJQUNuRSxPQUFPO0FBQ0wsWUFBTSxPQUFPLE1BQU0sT0FBTyxPQUFPLENBQUM7QUFDbEMsVUFBSSxLQUFLLE1BQU0sS0FBTSxRQUFPLEVBQUUsT0FBTyxPQUFPLE1BQU0sS0FBSyxLQUFLO0FBQUEsSUFDOUQ7QUFDQSxRQUFJLFFBQVEsTUFBTSxLQUFLLFVBQVUsT0FBTyxRQUFRO0FBQzlDLGtCQUFZLE9BQU8sU0FBUztBQUM1QixZQUFNLE9BQU8sUUFBUSxNQUFNLENBQUMsU0FBUztBQUNyQyxVQUFJLFdBQVc7QUFDYixlQUFPLE1BQU0sbUJBQW1CLE1BQU0sS0FBSyxLQUFLLE1BQU0sS0FBSyxNQUFNLEtBQUssSUFBSSxDQUFDLEdBQUcsT0FBTyx5QkFBeUI7QUFDOUcsb0JBQVk7QUFDWixjQUFNLFdBQVcsS0FBSyxJQUFJLEdBQUcsZ0JBQWdCLEtBQUssS0FBSyxLQUFLLE1BQU0sSUFBSSxDQUFDO0FBQ3ZFLGdCQUFRLEVBQUUsTUFBTSxVQUFVLE9BQU8sRUFBRTtBQUNuQyxlQUFPLGVBQWUsTUFBTSxNQUFNLE9BQU8sUUFBUTtBQUNqRCxlQUFPLE1BQU0sS0FBSyxLQUFLLEtBQUssS0FBSyxpRkFBNEU7QUFBQSxNQUMvRyxPQUFPO0FBQ0wsZUFBTyxlQUFlLE1BQU0sTUFBTSxPQUFPLE9BQU8sQ0FBQyxDQUFDO0FBQ2xELGVBQU8sTUFBTSxLQUFLLEtBQUssS0FBSyxLQUFLLDRDQUE0QztBQUFBLE1BQy9FO0FBQUEsSUFDRjtBQUNBLFVBQU0sUUFBUSxVQUFVLEtBQUs7QUFDN0IsVUFBTSxTQUFTLGVBQWUsUUFBUSxNQUFNLE9BQU8sUUFBUSxNQUFNLFVBQVUsS0FBSztBQUVoRixXQUFPLEdBQUcsVUFBVSxZQUFZLENBQUMsV0FBVyxLQUFLLE1BQU0sU0FBUyxLQUFLLDhDQUE4QztBQUNuSCxXQUFPLEdBQUcsU0FBUyxZQUFZLFNBQVMsTUFBTSxTQUFTLEtBQUssV0FBVyxLQUFLLGFBQWEsU0FBUyxlQUFlLE1BQU0sSUFBSTtBQUFBLEVBQzdIO0FBQ0EsU0FBTyxNQUFNLFdBQVcsS0FBSztBQUM3QixTQUFPLEdBQUcsS0FBSyxPQUFPLEtBQUssc0VBQWlFO0FBQzlGLENBQUM7QUFFRCxLQUFLLDJGQUEyRixNQUFNO0FBQ3BHLFFBQU0sT0FBTztBQUNiLFFBQU0sT0FBTztBQUNiLFFBQU0sWUFBWSxPQUFPLEtBQUs7QUFDOUIsUUFBTSxPQUFPLGdCQUFnQixXQUFXLE1BQU0sTUFBTSxDQUFDO0FBQ3JELFNBQU8sTUFBTSxNQUFNLEdBQUc7QUFDdEIsUUFBTSxRQUFRLENBQUMsTUFBc0IsT0FBTyxJQUFJLE9BQU8sYUFBYSxNQUFNLGtCQUFrQixHQUFHLG9CQUFvQjtBQUNuSCxTQUFPLE1BQU0sTUFBTSxDQUFDLEdBQUcsV0FBVyxnRUFBMkQ7QUFDN0YsTUFBSSxPQUFPLE1BQU0sQ0FBQztBQUNsQixNQUFJLGVBQWU7QUFDbkIsV0FBUyxJQUFJLFVBQVUsS0FBSyx1QkFBdUIsVUFBVSxLQUFLLFVBQVU7QUFDMUUsVUFBTSxJQUFJLE1BQU0sS0FBSyxJQUFJLEdBQUcsb0JBQW9CLENBQUM7QUFDakQsV0FBTyxHQUFHLEtBQUssTUFBTSxtQ0FBbUMsQ0FBQyxHQUFHO0FBQzVELFFBQUksSUFBSSxPQUFPLFNBQVU7QUFDekIsV0FBTztBQUFBLEVBQ1Q7QUFDQSxTQUFPLEdBQUcsZ0JBQWdCLEdBQUcsMENBQTBDLFlBQVksR0FBRztBQUN0RixRQUFNLE9BQU87QUFDYixTQUFPLE1BQU0sTUFBTSxJQUFJLEdBQUcsT0FBTyxPQUFPLE9BQU8sa0JBQWtCLDJEQUEyRDtBQUM5SCxDQUFDO0FBRUQsS0FBSyxrRkFBa0YsTUFBTTtBQUMzRixhQUFXLFNBQVMsQ0FBQyxHQUFHLEVBQUUsR0FBRztBQUMzQixXQUFPLE1BQU0sYUFBYSxHQUFHLGtCQUFrQixHQUFHLEtBQUssR0FBRyxrQkFBa0IsY0FBYztBQUMxRixXQUFPLE1BQU0sYUFBYSxrQkFBa0IsR0FBRyxHQUFHLEtBQUssR0FBRyxHQUFHLGlCQUFpQjtBQUM5RSxXQUFPLE1BQU0sYUFBYSxLQUFLLGtCQUFrQixHQUFHLEtBQUssR0FBRyxrQkFBa0IsWUFBWTtBQUFBLEVBQzVGO0FBQ0YsQ0FBQztBQUVELEtBQUsscUhBQWdILE1BQU07QUFFekgsYUFBVyxLQUFLLENBQUMsR0FBRyxHQUFHLHVCQUF1QixHQUFHLHNCQUFzQixHQUFHLEdBQUc7QUFDM0UsV0FBTyxNQUFNLGFBQWEsa0JBQWtCLGtCQUFrQixHQUFHLG9CQUFvQixHQUFHLGdCQUFnQjtBQUFBLEVBQzFHO0FBRUEsU0FBTyxNQUFNLGFBQWEsR0FBRyxrQkFBa0IsdUJBQXVCLEdBQUcsb0JBQW9CLEdBQUcsZ0JBQWdCO0FBQ2xILENBQUM7QUFJRCxLQUFLLHlGQUFvRixNQUFNO0FBQzdGLFFBQU0sUUFBUTtBQUNkLFNBQU8sTUFBTSxZQUFZLE9BQU8sT0FBTyxzQkFBc0IsR0FBRyxPQUFPLGNBQWM7QUFDckYsU0FBTyxNQUFNLFlBQVksUUFBUSx3QkFBd0IsT0FBTyxzQkFBc0IsR0FBRyxPQUFPLDBCQUEwQjtBQUMxSCxTQUFPLE1BQU0sWUFBWSxRQUFRLHlCQUF5QixHQUFHLE9BQU8sc0JBQXNCLEdBQUcsTUFBTSxvQkFBb0I7QUFFdkgsU0FBTyxNQUFNLFlBQVksUUFBUSxLQUFRLFFBQVEsTUFBUSxzQkFBc0IsR0FBRyxLQUFLO0FBQ3pGLENBQUM7QUFFRCxLQUFLLHlFQUF5RSxNQUFNO0FBQ2xGLFNBQU8sTUFBTSxZQUFZLE1BQU0sTUFBTSxzQkFBc0IsR0FBRyxPQUFPLHNCQUFzQjtBQUMzRixhQUFXLE9BQU8sQ0FBQyxHQUFHLElBQUksVUFBVSxHQUFHLEdBQUc7QUFDeEMsV0FBTyxNQUFNLFlBQVksTUFBTSxHQUFHLEdBQUcsR0FBRyxPQUFPLGFBQWEsR0FBRyxxQkFBcUI7QUFBQSxFQUN0RjtBQUNGLENBQUM7QUFFRCxLQUFLLG1JQUE4SCxNQUFNO0FBQ3ZJLFFBQU0sUUFBUTtBQUNkLFFBQU0sUUFBUTtBQUVkLFNBQU8sTUFBTSxlQUFlLFFBQVEsS0FBTyxPQUFPLEtBQUssR0FBRyxRQUFRLEdBQUs7QUFHdkUsYUFBVyxRQUFRLENBQUMsUUFBUSxHQUFHLEtBQVEsTUFBVyxLQUFVLEdBQUc7QUFDN0QsV0FBTyxNQUFNLGVBQWUsUUFBUSxNQUFNLE9BQU8sS0FBSyxHQUFHLEtBQUs7QUFBQSxFQUNoRTtBQUNGLENBQUM7QUFFRCxLQUFLLDhFQUE4RSxNQUFNO0FBQ3ZGLFFBQU0sUUFBUTtBQUNkLFFBQU0sT0FBTztBQUNiLFFBQU0sUUFBUTtBQUVkLFFBQU0sU0FBUyxvQkFBSSxJQUFZO0FBQy9CLFdBQVMsSUFBSSxRQUFRLEdBQUcsSUFBSSxRQUFRLEtBQVEsS0FBSyxXQUFXLElBQUk7QUFDOUQsV0FBTyxJQUFJLGVBQWUsUUFBUSxHQUFHLE9BQU8sS0FBSyxJQUFJLE9BQU8sZ0JBQWdCO0FBQUEsRUFDOUU7QUFDQSxTQUFPLE1BQU0sT0FBTyxNQUFNLEdBQUcsMEZBQXFGO0FBQ3BILENBQUM7QUFFRCxLQUFLLGlHQUFpRyxNQUFNO0FBQzFHLFFBQU0sUUFBUTtBQUNkLFFBQU0sUUFBUTtBQUNkLFFBQU0sT0FBTyxRQUFRO0FBQ3JCLE1BQUksT0FBTztBQUNYLFdBQVMsSUFBSSxVQUFVLEtBQUssc0JBQXNCLEtBQUssVUFBVTtBQUMvRCxVQUFNLElBQUksYUFBYSxNQUFNLE9BQU8sS0FBSyxJQUFJLEdBQUcsb0JBQW9CLEdBQUcsb0JBQW9CO0FBQzNGLFdBQU8sR0FBRyxLQUFLLE1BQU0sd0JBQXdCO0FBQzdDLFdBQU8sR0FBRyxLQUFLLE9BQU8sOENBQThDO0FBQ3BFLFVBQU0sT0FBTyxPQUFPO0FBQ3BCLFdBQU8sR0FBRyxRQUFTLFFBQVEsSUFBSSxXQUFZLHVCQUF1QixNQUFNLGlCQUFpQixJQUFJLEtBQUs7QUFDbEcsV0FBTztBQUFBLEVBQ1Q7QUFDQSxTQUFPLE1BQU0sTUFBTSxPQUFPLDRCQUE0QjtBQUN4RCxDQUFDO0FBRUQsS0FBSywwSEFBcUgsTUFBTTtBQUM5SCxRQUFNLFFBQVE7QUFDZCxRQUFNLE9BQU87QUFDYixRQUFNLFNBQVM7QUFDZixRQUFNLFlBQVksUUFBUTtBQUMxQixRQUFNLE1BQU07QUFDWixNQUFJLFVBQVUsUUFBUSxPQUFPO0FBQzdCLFdBQVMsSUFBSSxZQUFZLEtBQUssVUFBVTtBQUN0QyxVQUFNLElBQUksS0FBSyxJQUFJLEdBQUcsb0JBQW9CO0FBQzFDLFVBQU0sUUFBUSxZQUFZO0FBQzFCLFVBQU0sT0FBTyxhQUFhLE9BQU8sT0FBTyxHQUFHLG9CQUFvQjtBQUMvRCxVQUFNLE1BQU0sT0FBTyxPQUFPO0FBQzFCLFVBQU0sT0FBTyxNQUFNO0FBQ25CLFdBQU8sR0FBRyxRQUFRLE9BQU8sNkNBQTZDO0FBQ3RFLFdBQU8sR0FBRyxTQUFVLE1BQU0sdUJBQXVCLFlBQVksSUFBSSxXQUFZLHVCQUF1QixXQUFXLE1BQU0scUJBQXFCO0FBQzFJLGNBQVU7QUFDVixRQUFJLEtBQUssc0JBQXNCO0FBQzdCLGFBQU8sTUFBTSxNQUFNLE9BQU8sMENBQTBDO0FBQ3BFLGFBQU8sTUFBTSxLQUFLLFFBQVEsT0FBTyxrQkFBa0IsMkNBQTJDO0FBQzlGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDO0FBRUQsS0FBSyw4REFBOEQsTUFBTTtBQUN2RSxRQUFNLFFBQVE7QUFDZCxTQUFPLE1BQU0sYUFBYSxRQUFRLHdCQUF3QixPQUFPLEdBQUcsQ0FBQyxHQUFHLE9BQU8sMEJBQTBCO0FBQ3pHLFNBQU8sTUFBTSxhQUFhLE9BQU8sUUFBUSxNQUFRLEdBQUcsQ0FBQyxHQUFHLFFBQVEsTUFBUSw2QkFBNkI7QUFDdkcsQ0FBQztBQUlELEtBQUssOEZBQThGLE1BQU07QUFDdkcsUUFBTSxRQUFRO0FBQ2QsUUFBTSxPQUFPO0FBQ2IsUUFBTSxLQUFLO0FBQ1gsUUFBTSxLQUFLLEtBQU0sT0FBTyxPQUFRO0FBQ2hDLGFBQVcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxHQUFHO0FBQ3hCLFVBQU0sVUFBVSxvQkFBSSxJQUFZO0FBQ2hDLGFBQVMsSUFBSSxHQUFHLElBQUksS0FBSyxLQUFLO0FBQzVCLFlBQU0sT0FBaUIsRUFBRSxPQUFPLEtBQUssT0FBTyxJQUFJLElBQUksTUFBTSxLQUFLLEtBQUssT0FBTyxJQUFJLElBQUksS0FBSztBQUN4RixZQUFNLEtBQUssdUJBQXVCLE1BQU0sT0FBTyxHQUFHO0FBQ2xELFlBQU0sTUFBTSxRQUFRLElBQUksSUFBSSxLQUFLLElBQUksUUFBUSxJQUFJLElBQUksS0FBSztBQUMxRCxjQUFRLElBQUksS0FBSyxNQUFNLE1BQU0sR0FBRyxJQUFJLEdBQUc7QUFBQSxJQUN6QztBQUNBLFdBQU8sTUFBTSxRQUFRLE1BQU0sR0FBRyxPQUFPLEdBQUcsd0RBQXdEO0FBQ2hHLFdBQU8sR0FBRyxLQUFLLElBQUksQ0FBQyxHQUFHLE9BQU8sRUFBRSxDQUFDLElBQUksSUFBSSxJQUFJLElBQUk7QUFBQSxFQUNuRDtBQUNGLENBQUM7QUFFRCxLQUFLLHFHQUFxRyxNQUFNO0FBQzlHLFFBQU0sUUFBUTtBQUNkLFFBQU0sT0FBTztBQUNiLFFBQU0sSUFBSTtBQUNWLGFBQVcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxHQUFHO0FBQ3hCLFVBQU0sU0FBUyxvQkFBSSxJQUFZO0FBQy9CLGFBQVMsSUFBSSxHQUFHLElBQUksS0FBSyxLQUFLO0FBQzVCLFlBQU0sT0FBaUIsRUFBRSxPQUFPLElBQUksT0FBTyxJQUFJLElBQUksT0FBTyxLQUFLLElBQUssSUFBSSxPQUFRLElBQUksSUFBSSxNQUFNO0FBQzlGLFlBQU0sS0FBSyx1QkFBdUIsTUFBTSxPQUFPLEdBQUc7QUFDbEQsWUFBTSxPQUFPLFFBQVEsR0FBRyxJQUFJLEtBQUssSUFBSTtBQUNyQyxZQUFNLFFBQVEsT0FBTyxLQUFLLE1BQU0sSUFBSTtBQUNwQyxhQUFPLElBQUksS0FBSyxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUc7QUFBQSxJQUMxQztBQUNBLFdBQU8sR0FBRyxPQUFPLFFBQVEsR0FBRyxPQUFPLEdBQUcsOENBQThDLE9BQU8sSUFBSSxFQUFFO0FBQ2pHLFVBQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsTUFBTTtBQUN6QixRQUFJLE1BQU0sT0FBVyxRQUFPLEdBQUcsS0FBSyxJQUFJLElBQUksQ0FBQyxJQUFJLFFBQVEsS0FBSyxJQUFJLEtBQUssSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSTtBQUFBLEVBQy9GO0FBQ0YsQ0FBQztBQUVELEtBQUssK0VBQStFLE1BQU07QUFDeEYsUUFBTSxPQUFpQixFQUFFLE9BQU8sYUFBYSxLQUFLLFlBQVk7QUFDOUQsUUFBTSxLQUFLLHVCQUF1QixNQUFNLEtBQUssQ0FBQztBQUM5QyxTQUFPLEdBQUcsS0FBSyxJQUFJLEdBQUcsTUFBTSxHQUFHLFFBQVEsR0FBTyxJQUFJLElBQUk7QUFDdEQsUUFBTSxNQUFnQixFQUFFLE9BQU8sR0FBRyxLQUFLLEVBQUU7QUFDekMsU0FBTyxVQUFVLHVCQUF1QixLQUFLLEtBQUssQ0FBQyxHQUFHLEdBQUc7QUFDM0QsQ0FBQztBQUVELEtBQUssNEZBQTRGLE1BQU07QUFDckcsU0FBTyxNQUFNLGVBQWUsTUFBTSxDQUFDLEdBQUcsRUFBRTtBQUN4QyxTQUFPLE1BQU0sZUFBZSxNQUFNLENBQUMsR0FBRyxFQUFFO0FBQ3hDLFNBQU8sTUFBTSxlQUFlLE1BQU0sQ0FBQyxHQUFHLElBQUk7QUFDMUMsU0FBTyxNQUFNLGVBQWUsTUFBTSxDQUFDLEdBQUcsSUFBSTtBQUMxQyxhQUFXLE9BQU8sQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHO0FBQzNCLGVBQVcsS0FBSyxDQUFDLEdBQUcsS0FBSyxNQUFNLFFBQVEsTUFBTSxHQUFHO0FBQzlDLFlBQU0sVUFBVSxlQUFlLEdBQUcsR0FBRztBQUNyQyxZQUFNLE1BQU0sVUFBVTtBQUN0QixhQUFPLEdBQUcsS0FBSyxJQUFJLE1BQU0sS0FBSyxNQUFNLEdBQUcsQ0FBQyxJQUFJLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQywyQkFBc0I7QUFDeEYsYUFBTyxHQUFHLEtBQUssSUFBSSxVQUFVLENBQUMsS0FBSyxNQUFNLE1BQU0sTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLGdDQUEyQjtBQUNoRyxhQUFPLE1BQU0sZUFBZSxTQUFTLEdBQUcsR0FBRyxTQUFTLE9BQU8sR0FBRyxjQUFjO0FBQUEsSUFDOUU7QUFBQSxFQUNGO0FBQ0YsQ0FBQztBQUVELEtBQUssa0RBQWtELE1BQU07QUFDM0QsU0FBTyxHQUFHLE9BQU8sTUFBTSxlQUFlLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDOUMsU0FBTyxNQUFNLGVBQWUsS0FBSyxDQUFDLEdBQUcsR0FBRztBQUN4QyxTQUFPLE1BQU0sZUFBZSxLQUFLLEVBQUUsR0FBRyxHQUFHO0FBQ3pDLFNBQU8sTUFBTSxlQUFlLFVBQVUsQ0FBQyxHQUFHLFFBQVE7QUFDcEQsQ0FBQztBQUlELEtBQUssZ0dBQTJGLE1BQU07QUFDcEcsUUFBTSxRQUFRO0FBQ2QsUUFBTSxPQUFPO0FBQ2IsUUFBTSxVQUFVLE9BQU87QUFDdkIsUUFBTSxPQUFPO0FBRWIsUUFBTSxZQUFZLENBQUMsR0FBRyxHQUFHLEtBQUssTUFBTSxTQUFTLE1BQU0sU0FBUyxNQUFNLFNBQVMsS0FBSyxPQUFPO0FBQ3ZGLGFBQVcsT0FBTyxXQUFXO0FBQzNCLFVBQU0sWUFBWSxvQkFBSSxJQUFhO0FBQ25DLGFBQVMsSUFBSSxHQUFHLElBQUksS0FBSyxLQUFLO0FBQzVCLFlBQU0sT0FBaUIsRUFBRSxPQUFPLE9BQU8sSUFBSSxPQUFPLEtBQUssT0FBTyxJQUFJLFFBQVEsS0FBSztBQUMvRSxZQUFNLElBQUksZ0JBQWdCLE9BQU8sT0FBTyxHQUFHLE9BQU8sT0FBTyxJQUFJLEtBQUssTUFBTSxLQUFLO0FBQzdFLGdCQUFVLElBQUksZUFBZSxDQUFDLENBQUM7QUFBQSxJQUNqQztBQUNBLFdBQU8sTUFBTSxVQUFVLE1BQU0sR0FBRyxZQUFZLEdBQUcsbURBQW1EO0FBQUEsRUFDcEc7QUFDRixDQUFDO0FBRUQsS0FBSywrRkFBK0YsTUFBTTtBQUN4RyxRQUFNLE9BQWlCLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBUTtBQUNoRCxTQUFPLE1BQU0sZUFBZSxnQkFBZ0IsS0FBTyxLQUFPLE1BQU0sR0FBSSxDQUFDLEdBQUcsTUFBTSxxQkFBcUI7QUFFbkcsU0FBTyxHQUFHLGNBQWMsS0FBSyxhQUFhLG9CQUFvQjtBQUM5RCxRQUFNLE9BQU8sZ0JBQWdCLEdBQUcsTUFBTyxNQUFNLEdBQUk7QUFDakQsU0FBTyxNQUFNLGVBQWUsSUFBSSxHQUFHLEtBQUs7QUFDMUMsQ0FBQztBQUlELEtBQUssMkVBQTJFLE1BQU07QUFFcEYsUUFBTSxPQUFpQixFQUFFLE9BQU8sS0FBUyxLQUFLLEtBQVU7QUFDeEQsUUFBTSxTQUFTLGlCQUFpQixLQUFTLEtBQVMsTUFBTSxLQUFNLEVBQUU7QUFDaEUsU0FBTyxVQUFVLFFBQVEsRUFBRSxNQUFNLE9BQU8sT0FBTyxNQUFNLENBQUM7QUFDdEQsU0FBTyxVQUFVLGlCQUFpQixLQUFTLEtBQVMsTUFBTSxLQUFNLEVBQUUsR0FBRyxFQUFFLE1BQU0sTUFBTSxPQUFPLE1BQU0sQ0FBQztBQUNqRyxTQUFPLFVBQVUsaUJBQWlCLEtBQVMsTUFBVyxNQUFNLEtBQU0sRUFBRSxHQUFHLEVBQUUsTUFBTSxPQUFPLE9BQU8sS0FBSyxDQUFDO0FBQ25HLFNBQU8sVUFBVSxpQkFBaUIsS0FBUyxNQUFXLE1BQU0sS0FBTSxFQUFFLEdBQUcsRUFBRSxNQUFNLE1BQU0sT0FBTyxLQUFLLENBQUM7QUFDcEcsQ0FBQztBQUVELEtBQUssdUdBQWtHLE1BQU07QUFDM0csUUFBTSxPQUFpQixFQUFFLE9BQU8sS0FBUyxLQUFLLEtBQVU7QUFDeEQsU0FBTyxVQUFVLGlCQUFpQixLQUFLLE9BQU8sS0FBUyxNQUFNLEtBQU0sRUFBRSxHQUFHLEVBQUUsTUFBTSxPQUFPLE9BQU8sTUFBTSxDQUFDO0FBQ3JHLFNBQU8sVUFBVSxpQkFBaUIsS0FBUyxLQUFLLEtBQUssTUFBTSxLQUFNLEVBQUUsR0FBRyxFQUFFLE1BQU0sT0FBTyxPQUFPLE1BQU0sQ0FBQztBQUVuRyxTQUFPLFVBQVUsaUJBQWlCLEtBQUssUUFBUSxLQUFLLEtBQVMsTUFBTSxLQUFNLEVBQUUsR0FBRyxFQUFFLE1BQU0sT0FBTyxPQUFPLE1BQU0sQ0FBQztBQUMzRyxTQUFPLFVBQVUsaUJBQWlCLEtBQVMsS0FBSyxNQUFNLEtBQUssTUFBTSxLQUFNLEVBQUUsR0FBRyxFQUFFLE1BQU0sT0FBTyxPQUFPLE1BQU0sQ0FBQztBQUV6RyxTQUFPLE1BQU0saUJBQWlCLEtBQUssUUFBUSxLQUFLLEtBQVMsTUFBTSxLQUFNLEVBQUUsRUFBRSxNQUFNLElBQUk7QUFDbkYsU0FBTyxNQUFNLGlCQUFpQixLQUFTLEtBQUssTUFBTSxLQUFLLE1BQU0sS0FBTSxFQUFFLEVBQUUsT0FBTyxJQUFJO0FBQ3BGLENBQUM7QUFFRCxLQUFLLG9GQUFvRixNQUFNO0FBQzdGLFFBQU0sT0FBaUIsRUFBRSxPQUFPLEtBQVMsS0FBSyxLQUFVO0FBRXhELFNBQU8sVUFBVSxpQkFBaUIsR0FBRyxLQUFLLFFBQVEsSUFBSSxLQUFLLE1BQU0sS0FBTSxFQUFFLEdBQUcsRUFBRSxNQUFNLE9BQU8sT0FBTyxNQUFNLENBQUM7QUFDekcsU0FBTyxVQUFVLGlCQUFpQixLQUFLLE1BQU0sSUFBSSxLQUFLLFNBQVcsTUFBTSxLQUFNLEVBQUUsR0FBRyxFQUFFLE1BQU0sT0FBTyxPQUFPLE1BQU0sQ0FBQztBQUUvRyxTQUFPLE1BQU0saUJBQWlCLEdBQUcsS0FBSyxRQUFRLEtBQUssS0FBSyxNQUFNLEtBQU0sRUFBRSxFQUFFLE1BQU0sSUFBSTtBQUNsRixTQUFPLE1BQU0saUJBQWlCLEtBQUssTUFBTSxLQUFLLEtBQUssU0FBVyxNQUFNLEtBQU0sRUFBRSxFQUFFLE9BQU8sSUFBSTtBQUMzRixDQUFDO0FBRUQsS0FBSyxrSEFBa0gsTUFBTTtBQUMzSCxRQUFNLE1BQU07QUFDWixRQUFNLE9BQWlCLEVBQUUsT0FBTyxLQUFTLEtBQUssS0FBVTtBQUN4RCxTQUFPLFVBQVUsaUJBQWlCLEtBQVMsS0FBSyxNQUFNLEtBQU0sRUFBRSxHQUFHLEVBQUUsTUFBTSxPQUFPLE9BQU8sTUFBTSxDQUFDO0FBQ2hHLENBQUM7QUFFRCxLQUFLLGlFQUFpRSxNQUFNO0FBQzFFLFNBQU8sVUFBVSxpQkFBaUIsR0FBRyxLQUFLLEVBQUUsT0FBTyxHQUFHLEtBQUssRUFBRSxHQUFHLEtBQU0sRUFBRSxHQUFHLEVBQUUsTUFBTSxPQUFPLE9BQU8sTUFBTSxDQUFDO0FBQ3hHLFNBQU8sVUFBVSxpQkFBaUIsR0FBRyxLQUFLLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBSyxHQUFHLEdBQUcsRUFBRSxHQUFHLEVBQUUsTUFBTSxPQUFPLE9BQU8sTUFBTSxDQUFDO0FBQzFHLENBQUM7QUFJRCxLQUFLLHVGQUF1RixNQUFNO0FBQ2hHLFFBQU0sUUFBb0I7QUFBQSxJQUN4QixFQUFFLElBQUksTUFBTSxPQUFPLEdBQUcsS0FBSyxJQUFJO0FBQUEsSUFDL0IsRUFBRSxJQUFJLE1BQU0sT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLElBQy9CLEVBQUUsSUFBSSxNQUFNLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQSxJQUMvQixFQUFFLElBQUksTUFBTSxPQUFPLElBQUksS0FBSyxHQUFHO0FBQUE7QUFBQSxJQUUvQixFQUFFLElBQUksTUFBTSxPQUFPLEtBQU8sS0FBSyxLQUFNO0FBQUEsSUFDckMsRUFBRSxJQUFJLE1BQU0sT0FBTyxNQUFPLEtBQUssS0FBTTtBQUFBLEVBQ3ZDO0FBQ0EsUUFBTSxPQUFPLGtCQUFrQixPQUFPLEVBQUUsT0FBTyxLQUFLLEtBQUssS0FBTSxDQUFDO0FBQ2hFLFNBQU8sTUFBTSxLQUFLLFlBQVksR0FBRyxrQ0FBa0M7QUFDbkUsU0FBTyxVQUFVLEtBQUssT0FBTyxNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxJQUFJLElBQUksRUFBRSxHQUFHLDZCQUE2QjtBQUN6RixRQUFNLFFBQVEsa0JBQWtCLE9BQU8sRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFJLENBQUM7QUFDN0QsU0FBTyxNQUFNLE1BQU0sWUFBWSxHQUFHLDJDQUEyQztBQUMvRSxDQUFDO0FBRUQsS0FBSyxrRkFBa0YsTUFBTTtBQUMzRixRQUFNLFFBQW9CO0FBQUEsSUFDeEIsRUFBRSxJQUFJLEtBQUssT0FBTyxHQUFHLEtBQUssSUFBSTtBQUFBLElBQzlCLEVBQUUsSUFBSSxLQUFLLE9BQU8sS0FBSyxLQUFLLElBQUk7QUFBQSxFQUNsQztBQUVBLFNBQU8sTUFBTSxrQkFBa0IsT0FBTyxFQUFFLE9BQU8sS0FBSyxLQUFLLElBQUksQ0FBQyxFQUFFLFlBQVksQ0FBQztBQUM3RSxRQUFNLFFBQVEsa0JBQWtCLE9BQU8sRUFBRSxPQUFPLEtBQU8sS0FBSyxJQUFNLENBQUM7QUFDbkUsU0FBTyxNQUFNLE1BQU0sWUFBWSxDQUFDO0FBQ2hDLFNBQU8sVUFBVSxNQUFNLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUN6QyxDQUFDO0FBRUQsS0FBSyxnRkFBZ0YsTUFBTTtBQUN6RixRQUFNLFFBQW9CO0FBQUEsSUFDeEIsRUFBRSxJQUFJLFFBQVEsT0FBTyxLQUFLLEtBQUssS0FBSztBQUFBLElBQ3BDLEVBQUUsSUFBSSxLQUFLLE9BQU8sS0FBTyxLQUFLLElBQU07QUFBQSxFQUN0QztBQUNBLFFBQU0sSUFBSSxrQkFBa0IsT0FBTyxFQUFFLE9BQU8sS0FBTyxLQUFLLElBQU0sQ0FBQztBQUMvRCxTQUFPLE1BQU0sRUFBRSxZQUFZLEdBQUcsd0NBQXdDO0FBQ3RFLFNBQU8sU0FBUyxFQUFFLE9BQU8sQ0FBQyxHQUFHLEVBQUU7QUFDakMsQ0FBQztBQUVELEtBQUssaUdBQWlHLE1BQU07QUFDMUcsUUFBTSxRQUFvQjtBQUFBLElBQ3hCLEVBQUUsSUFBSSxLQUFLLE9BQU8sS0FBTyxLQUFLLElBQU07QUFBQSxJQUNwQyxFQUFFLElBQUksS0FBSyxPQUFPLE1BQU8sS0FBSyxLQUFNO0FBQUEsSUFDcEMsRUFBRSxJQUFJLEtBQUssT0FBTyxNQUFPLEtBQUssSUFBTTtBQUFBLEVBQ3RDO0FBQ0EsUUFBTSxRQUFRLGtCQUFrQixPQUFPLEVBQUUsT0FBTyxLQUFLLEtBQUssS0FBTSxDQUFDO0FBQ2pFLFdBQVMsS0FBSyxHQUFHLEtBQUssSUFBSSxNQUFNLEdBQUc7QUFFakMsVUFBTSxJQUFJLGtCQUFrQixPQUFPLEVBQUUsT0FBTyxNQUFNLElBQUksS0FBSyxPQUFRLEdBQUcsQ0FBQztBQUN2RSxXQUFPLFVBQVUsRUFBRSxRQUFRLE1BQU0sUUFBUSxVQUFVLEVBQUUsOEJBQThCO0FBQ25GLFdBQU8sTUFBTSxFQUFFLFlBQVksTUFBTSxVQUFVO0FBQUEsRUFDN0M7QUFDRixDQUFDO0FBSUQsS0FBSyx3RkFBd0YsTUFBTTtBQUNqRyxRQUFNLEVBQUUsUUFBUSxXQUFXLElBQUksT0FBTztBQUFBLElBQ3BDLEVBQUUsSUFBSSxLQUFLLE9BQU8sR0FBRyxLQUFLLEtBQUssTUFBTSxFQUFFO0FBQUEsSUFDdkMsRUFBRSxJQUFJLEtBQUssT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLElBQzlCLEVBQUUsSUFBSSxLQUFLLE9BQU8sS0FBSyxLQUFLLElBQUk7QUFBQSxFQUNsQyxDQUFDO0FBQ0QsU0FBTyxVQUFVLFFBQVEsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ2xDLFNBQU8sTUFBTSxZQUFZLENBQUM7QUFDNUIsQ0FBQztBQUVELEtBQUssMkVBQTJFLE1BQU07QUFDcEYsUUFBTSxFQUFFLFFBQVEsV0FBVyxJQUFJLE9BQU87QUFBQSxJQUNwQyxFQUFFLElBQUksS0FBSyxPQUFPLEdBQUcsS0FBSyxJQUFJO0FBQUEsSUFDOUIsRUFBRSxJQUFJLEtBQUssT0FBTyxHQUFHLEtBQUssSUFBSTtBQUFBLElBQzlCLEVBQUUsSUFBSSxLQUFLLE9BQU8sR0FBRyxLQUFLLElBQUk7QUFBQSxJQUM5QixFQUFFLElBQUksT0FBTyxPQUFPLEdBQUcsS0FBSyxJQUFJLE1BQU0sRUFBRTtBQUFBLEVBQzFDLENBQUM7QUFDRCxTQUFPLFVBQVUsT0FBTyxNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUM5QyxTQUFPLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQztBQUN6QixTQUFPLE1BQU0sWUFBWSxDQUFDO0FBQzFCLFFBQU0sTUFBTSxPQUFPO0FBQUEsSUFDakIsRUFBRSxJQUFJLEtBQUssT0FBTyxHQUFHLEtBQUssSUFBSTtBQUFBLElBQzlCLEVBQUUsSUFBSSxLQUFLLE9BQU8sR0FBRyxLQUFLLEVBQUU7QUFBQSxJQUM1QixFQUFFLElBQUksS0FBSyxPQUFPLEdBQUcsS0FBSyxFQUFFO0FBQUEsSUFDNUIsRUFBRSxJQUFJLEtBQUssT0FBTyxHQUFHLEtBQUssSUFBSTtBQUFBLElBQzlCLEVBQUUsSUFBSSxPQUFPLE9BQU8sR0FBRyxLQUFLLElBQUksTUFBTSxFQUFFO0FBQUEsRUFDMUMsQ0FBQztBQUNELFNBQU8sVUFBVSxJQUFJLFFBQVEsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyx3Q0FBd0M7QUFDdEYsU0FBTyxNQUFNLElBQUksWUFBWSxDQUFDO0FBQ2hDLENBQUM7QUFFRCxLQUFLLGlFQUFpRSxNQUFNO0FBQzFFLFFBQU0sUUFBb0IsQ0FBQyxFQUFFLElBQUksT0FBTyxPQUFPLEdBQUcsS0FBSyxLQUFLLE1BQU0sRUFBRSxDQUFDO0FBQ3JFLFNBQU8sTUFBTSxrQkFBa0IsT0FBTyxFQUFFLE9BQU8sSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUFFLFlBQVksQ0FBQztBQUMzRSxTQUFPLE1BQU0sa0JBQWtCLE9BQU8sRUFBRSxPQUFPLEtBQUssS0FBSyxJQUFJLENBQUMsRUFBRSxZQUFZLENBQUM7QUFDL0UsQ0FBQztBQUVELEtBQUssMEVBQTBFLE1BQU07QUFDbkYsUUFBTSxNQUFnQixFQUFFLElBQUksT0FBTyxPQUFPLEdBQUcsS0FBSyxLQUFLLE1BQU0sRUFBRTtBQUMvRCxRQUFNLElBQWMsRUFBRSxJQUFJLEtBQUssT0FBTyxJQUFJLEtBQUssR0FBRztBQUNsRCxRQUFNLElBQWMsRUFBRSxJQUFJLEtBQUssT0FBTyxLQUFLLEtBQUssSUFBSTtBQUNwRCxRQUFNLFFBQVEsSUFBSSxlQUFlO0FBQ2pDLFFBQU0sUUFBUSxNQUFNLE9BQU8sQ0FBQyxLQUFLLEdBQUcsQ0FBQyxHQUFHLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBSSxDQUFDO0FBQzlELFNBQU8sVUFBVSxNQUFNLFFBQVEsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLHFFQUFxRTtBQUMvRyxTQUFPLE1BQU0sTUFBTSxZQUFZLENBQUM7QUFFaEMsUUFBTSxJQUFjLEVBQUUsSUFBSSxLQUFLLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFDbEQsUUFBTSxTQUFTLE1BQU0sT0FBTyxDQUFDLEtBQUssR0FBRyxHQUFHLENBQUMsR0FBRyxFQUFFLE9BQU8sR0FBRyxLQUFLLElBQUksQ0FBQztBQUNsRSxTQUFPLFVBQVUsT0FBTyxRQUFRLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxHQUFHLDRDQUE0QztBQUUxRixRQUFNLFFBQVEsTUFBTSxPQUFPLENBQUMsS0FBSyxHQUFHLEdBQUcsQ0FBQyxHQUFHLEVBQUUsT0FBTyxLQUFLLEtBQUssSUFBSSxDQUFDO0FBQ25FLFNBQU8sVUFBVSxNQUFNLFFBQVEsQ0FBQyxJQUFJLElBQUksR0FBRyxFQUFFLENBQUM7QUFDOUMsU0FBTyxNQUFNLE1BQU0sWUFBWSxDQUFDO0FBQ2xDLENBQUM7QUFJRCxLQUFLLDZGQUE2RixNQUFNO0FBQ3RHLFFBQU0sU0FBUyxlQUFlO0FBQUEsSUFDNUIsRUFBRSxJQUFJLE9BQU8sUUFBUSxLQUFLO0FBQUEsSUFDMUIsRUFBRSxJQUFJLFNBQVMsUUFBUSxNQUFNLFVBQVUsTUFBTTtBQUFBLElBQzdDLEVBQUUsSUFBSSxVQUFVLFFBQVEsTUFBTSxVQUFVLE9BQU87QUFBQSxJQUMvQyxFQUFFLElBQUksYUFBYSxRQUFRLFVBQVUsVUFBVSxNQUFNO0FBQUEsSUFDckQsRUFBRSxJQUFJLE1BQU0sUUFBUSxNQUFNLFVBQVUsS0FBSztBQUFBLElBQ3pDLEVBQUUsSUFBSSxRQUFRLFFBQVEsTUFBTSxVQUFVLFFBQVE7QUFBQSxFQUNoRCxDQUFDO0FBQ0QsU0FBTyxVQUFVLFFBQVEsQ0FBQyxJQUFJLEdBQUcsSUFBSSxJQUFJLElBQUksQ0FBQyxDQUFDO0FBQ2pELENBQUM7QUFFRCxLQUFLLDREQUE0RCxNQUFNO0FBQ3JFLFFBQU0sU0FBUyxlQUFlO0FBQUEsSUFDNUIsRUFBRSxJQUFJLEtBQUssVUFBVSxJQUFJO0FBQUEsSUFDekIsRUFBRSxJQUFJLEtBQUssVUFBVSxJQUFJO0FBQUEsSUFDekIsRUFBRSxJQUFJLEtBQUssVUFBVSxJQUFJO0FBQUEsSUFDekIsRUFBRSxJQUFJLEtBQUssVUFBVSxJQUFJO0FBQUEsRUFDM0IsQ0FBQztBQUNELFNBQU8sTUFBTSxPQUFPLENBQUMsR0FBRyxJQUFJLHVEQUF1RDtBQUNuRixTQUFPLFVBQVUsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUM7QUFFM0MsV0FBUyxJQUFJLEdBQUcsSUFBSSxPQUFPLFFBQVEsS0FBSztBQUN0QyxRQUFJLElBQUk7QUFDUixRQUFJLFFBQVE7QUFDWixXQUFPLE9BQU8sQ0FBQyxLQUFLLEdBQUc7QUFDckIsVUFBSSxPQUFPLENBQUM7QUFDWjtBQUNBLGFBQU8sR0FBRyxTQUFTLE9BQU8sUUFBUSxTQUFTO0FBQUEsSUFDN0M7QUFBQSxFQUNGO0FBQ0YsQ0FBQztBQUVELEtBQUsscUdBQXFHLE1BQU07QUFDOUcsUUFBTSxNQUFNLFdBQVc7QUFBQSxJQUNyQixJQUFJO0FBQUEsSUFDSixPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxVQUFVO0FBQUEsTUFDUixFQUFFLElBQUksU0FBUyxPQUFPLEdBQUcsS0FBSyxHQUFHO0FBQUEsTUFDakMsRUFBRSxJQUFJLFVBQVUsT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLE1BQ25DLEVBQUUsSUFBSSxVQUFVLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQTtBQUFBLE1BQ25DLEVBQUUsSUFBSSxXQUFXLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQSxJQUN0QztBQUFBLEVBQ0YsQ0FBQztBQUNELFNBQU8sTUFBTSxJQUFJLE1BQU0sQ0FBQztBQUN4QixTQUFPLE1BQU0sSUFBSSxPQUFPLENBQUM7QUFDekIsU0FBTyxNQUFNLElBQUksS0FBSyxHQUFHO0FBQ3pCLFNBQU8sTUFBTSxJQUFJLEtBQUssSUFBSSxLQUFLLEdBQUcsQ0FBQztBQUNuQyxTQUFPLE1BQU0sSUFBSSxLQUFLLElBQUksT0FBTyxHQUFHLENBQUM7QUFDckMsU0FBTyxNQUFNLElBQUksS0FBSyxJQUFJLFFBQVEsR0FBRyxDQUFDO0FBQ3RDLFNBQU8sTUFBTSxJQUFJLEtBQUssSUFBSSxRQUFRLEdBQUcsQ0FBQztBQUN0QyxTQUFPLE1BQU0sSUFBSSxLQUFLLElBQUksU0FBUyxHQUFHLENBQUM7QUFDekMsQ0FBQztBQUVELEtBQUssNEZBQTRGLE1BQU07QUFDckcsUUFBTSxNQUFNLFdBQVcsRUFBRSxJQUFJLEtBQUssT0FBTyxHQUFHLEtBQUssSUFBSSxVQUFVLENBQUMsRUFBRSxJQUFJLEtBQUssT0FBTyxHQUFHLEtBQUssRUFBRSxDQUFDLEVBQUUsQ0FBQztBQUNoRyxTQUFPLE1BQU0sSUFBSSxNQUFNLENBQUM7QUFDeEIsU0FBTyxVQUFVLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0FBQ3RELENBQUM7QUFFRCxLQUFLLG1IQUE4RyxNQUFNO0FBQ3ZILFFBQU0sTUFBTSxXQUFXO0FBQUEsSUFDckIsSUFBSTtBQUFBLElBQ0osT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsVUFBVTtBQUFBLE1BQ1IsRUFBRSxJQUFJLFNBQVMsT0FBTyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ2pDO0FBQUEsUUFDRSxJQUFJO0FBQUEsUUFDSixPQUFPO0FBQUEsUUFDUCxLQUFLO0FBQUEsUUFDTCxVQUFVO0FBQUEsVUFDUixFQUFFLElBQUksUUFBUSxPQUFPLElBQUksS0FBSyxHQUFHO0FBQUEsVUFDakMsRUFBRSxJQUFJLE9BQU8sT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLFFBQ2xDO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGLENBQUM7QUFDRCxTQUFPLE1BQU0sSUFBSSxLQUFLLElBQUksT0FBTyxHQUFHLENBQUM7QUFDckMsU0FBTyxNQUFNLElBQUksS0FBSyxJQUFJLE1BQU0sR0FBRyxDQUFDO0FBQ3BDLFNBQU8sTUFBTSxJQUFJLEtBQUssSUFBSSxNQUFNLEdBQUcsQ0FBQztBQUNwQyxTQUFPLE1BQU0sSUFBSSxLQUFLLElBQUksS0FBSyxHQUFHLENBQUM7QUFDbkMsU0FBTyxNQUFNLElBQUksTUFBTSxDQUFDO0FBQzFCLENBQUM7QUFFRCxLQUFLLHVGQUF1RixNQUFNO0FBQ2hHLFFBQU0sT0FBTyxXQUFXLEVBQUUsSUFBSSxLQUFLLE9BQU8sSUFBSSxLQUFLLElBQUksVUFBVSxDQUFDLEVBQUUsSUFBSSxLQUFLLE9BQU8sR0FBRyxLQUFLLEdBQUcsQ0FBQyxFQUFFLENBQUM7QUFDbkcsU0FBTyxNQUFNLEtBQUssT0FBTyxDQUFDO0FBQzFCLFNBQU8sTUFBTSxLQUFLLEtBQUssRUFBRTtBQUN6QixRQUFNLE9BQU8sV0FBVyxFQUFFLElBQUksS0FBSyxPQUFPLElBQUksS0FBSyxJQUFJLFVBQVUsQ0FBQyxFQUFFLElBQUksS0FBSyxPQUFPLElBQUksS0FBSyxLQUFLLENBQUMsRUFBRSxDQUFDO0FBQ3RHLFNBQU8sTUFBTSxLQUFLLEtBQUssSUFBSTtBQUMzQixRQUFNLFdBQVcsV0FBVyxFQUFFLElBQUksS0FBSyxPQUFPLElBQUksS0FBSyxNQUFNLFVBQVUsQ0FBQyxFQUFFLElBQUksS0FBSyxPQUFPLElBQUksS0FBSyxHQUFHLENBQUMsRUFBRSxDQUFDO0FBQzFHLFNBQU8sTUFBTSxTQUFTLEtBQUssSUFBSTtBQUNqQyxDQUFDO0FBRUQsS0FBSyxvRkFBb0YsTUFBTTtBQUM3RixRQUFNLE1BQU0sV0FBVztBQUFBLElBQ3JCLElBQUk7QUFBQSxJQUNKLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLFVBQVU7QUFBQSxNQUNSLEVBQUUsSUFBSSxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUU7QUFBQSxNQUM3QixFQUFFLElBQUksTUFBTSxPQUFPLEdBQUcsS0FBSyxFQUFFO0FBQUEsSUFDL0I7QUFBQSxFQUNGLENBQUM7QUFDRCxTQUFPLE1BQU0sSUFBSSxNQUFNLENBQUM7QUFDeEIsU0FBTyxTQUFTLElBQUksS0FBSyxJQUFJLElBQUksR0FBRyxJQUFJLEtBQUssSUFBSSxJQUFJLENBQUM7QUFDeEQsQ0FBQztBQUVELEtBQUssZ0ZBQWdGLE1BQU07QUFDekYsUUFBTSxNQUFNLFdBQVcsRUFBRSxJQUFJLE9BQU8sT0FBTyxHQUFHLEtBQUssS0FBSyxVQUFVLENBQUMsRUFBRSxJQUFJLEtBQUssT0FBTyxJQUFJLEtBQUssR0FBRyxDQUFDLEVBQUUsQ0FBQztBQUNyRyxRQUFNLE9BQU8sV0FBVztBQUFBLElBQ3RCLEVBQUUsSUFBSSxPQUFPLE9BQU8sSUFBSSxPQUFPLEtBQUssSUFBSSxLQUFLLE1BQU0sSUFBSSxLQUFLO0FBQUEsSUFDNUQsRUFBRSxJQUFJLFNBQVMsT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLEVBQ3BDLENBQUM7QUFDRCxTQUFPLFVBQVUsS0FBSyxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsZ0VBQWdFO0FBQ3RHLFNBQU8sTUFBTSxLQUFLLFlBQVksQ0FBQztBQUNqQyxDQUFDO0FBSUQsSUFBTSxLQUFLLENBQUMsSUFBWSxPQUFlLFNBQWtDLEVBQUUsSUFBSSxPQUFPLElBQUk7QUFFMUYsS0FBSyx1RkFBdUYsTUFBTTtBQUNoRyxRQUFNLFFBQVEsQ0FBQyxHQUFHLEtBQUssR0FBRyxFQUFFLEdBQUcsR0FBRyxLQUFLLEdBQUcsRUFBRSxHQUFHLEdBQUcsS0FBSyxJQUFJLEVBQUUsR0FBRyxHQUFHLEtBQUssSUFBSSxFQUFFLEdBQUcsR0FBRyxLQUFLLElBQUksRUFBRSxDQUFDO0FBQ2hHLGFBQVcsUUFBUTtBQUFBLElBQ2pCLEVBQUUsT0FBTyxHQUFHLEtBQUssR0FBRztBQUFBLElBQ3BCLEVBQUUsT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLElBQ3JCLEVBQUUsT0FBTyxLQUFLLEtBQUssSUFBSTtBQUFBLEVBQ3pCLEdBQUc7QUFDRCxXQUFPLFVBQVUsSUFBSSxlQUFlLEVBQUUsT0FBTyxPQUFPLElBQUksR0FBRyxrQkFBa0IsT0FBTyxJQUFJLENBQUM7QUFBQSxFQUMzRjtBQUNGLENBQUM7QUFFRCxLQUFLLHlHQUF5RyxNQUFNO0FBQ2xILFFBQU0sUUFBUSxDQUFDLEdBQUcsS0FBSyxHQUFHLEVBQUUsR0FBRyxHQUFHLEtBQUssR0FBRyxFQUFFLEdBQUcsR0FBRyxLQUFLLElBQUksRUFBRSxDQUFDO0FBQzlELFFBQU0sUUFBUSxJQUFJLGVBQWU7QUFDakMsUUFBTSxLQUFLLE1BQU0sT0FBTyxPQUFPLEVBQUUsT0FBTyxHQUFHLEtBQUssR0FBRyxDQUFDO0FBQ3BELFNBQU8sVUFBVSxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsWUFBWSxFQUFFLEdBQUcsK0JBQStCO0FBQzFGLFFBQU0sU0FBUyxFQUFFLE9BQU8sTUFBTSxLQUFLLEdBQUc7QUFDdEMsUUFBTSxZQUFZLGtCQUFrQixPQUFPLE1BQU07QUFDakQsU0FBTyxVQUFVLFVBQVUsUUFBUSxDQUFDLElBQUksR0FBRyxDQUFDLEdBQUcsaUNBQWlDO0FBQ2hGLFFBQU0sS0FBSyxNQUFNLE9BQU8sT0FBTyxNQUFNO0FBQ3JDLFNBQU8sVUFBVSxHQUFHLFFBQVEsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxHQUFHLHlDQUF5QztBQUNuRixDQUFDO0FBRUQsS0FBSywwRkFBcUYsTUFBTTtBQUM5RixRQUFNLFFBQVE7QUFBQSxJQUNaLEdBQUcsTUFBTSxHQUFHLEVBQUU7QUFBQSxJQUNkLEdBQUcsTUFBTSxHQUFHLEVBQUU7QUFBQSxJQUNkLEdBQUcsTUFBTSxHQUFHLEVBQUU7QUFBQSxJQUNkLEdBQUcsTUFBTSxHQUFHLEVBQUU7QUFBQSxJQUNkLEdBQUcsTUFBTSxHQUFHLEVBQUU7QUFBQSxJQUNkLEdBQUcsTUFBTSxJQUFJLEVBQUU7QUFBQSxJQUNmLEdBQUcsTUFBTSxJQUFJLEVBQUU7QUFBQSxFQUNqQjtBQUNBLFFBQU0sUUFBUSxJQUFJLGVBQWU7QUFDakMsUUFBTSxPQUFPLE1BQU0sT0FBTyxPQUFPLEVBQUUsT0FBTyxHQUFHLEtBQUssR0FBRyxDQUFDO0FBQ3RELFNBQU8sVUFBVSxLQUFLLFFBQVEsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLEdBQUcscUNBQXFDO0FBQzFGLFNBQU8sTUFBTSxLQUFLLFlBQVksQ0FBQztBQUUvQixRQUFNLFFBQVEsTUFBTSxPQUFPLE9BQU8sRUFBRSxPQUFPLElBQUksS0FBSyxHQUFHLENBQUM7QUFDeEQsU0FBTyxVQUFVLE1BQU0sUUFBUSxDQUFDLElBQUksSUFBSSxJQUFJLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQztBQUN6RCxTQUFPLE1BQU0sTUFBTSxZQUFZLEdBQUcscUNBQXFDO0FBQ3pFLENBQUM7QUFFRCxLQUFLLDhFQUE4RSxNQUFNO0FBQ3ZGLFFBQU0sUUFBUSxDQUFDLEdBQUcsS0FBSyxHQUFHLEVBQUUsR0FBRyxHQUFHLEtBQUssR0FBRyxFQUFFLEdBQUcsR0FBRyxLQUFLLEdBQUcsRUFBRSxDQUFDO0FBQzdELFFBQU0sUUFBUSxJQUFJLGVBQWU7QUFDakMsU0FBTyxVQUFVLE1BQU0sT0FBTyxPQUFPLEVBQUUsT0FBTyxHQUFHLEtBQUssR0FBRyxDQUFDLEVBQUUsUUFBUSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUM7QUFFN0UsU0FBTyxVQUFVLE1BQU0sT0FBTyxPQUFPLEVBQUUsT0FBTyxJQUFJLEtBQUssR0FBRyxDQUFDLEVBQUUsUUFBUSxDQUFDLElBQUksSUFBSSxFQUFFLENBQUM7QUFDakYsU0FBTyxNQUFNLE1BQU0sT0FBTyxPQUFPLEVBQUUsT0FBTyxJQUFJLEtBQUssR0FBRyxDQUFDLEVBQUUsWUFBWSxDQUFDO0FBQ3RFLFNBQU8sVUFBVSxNQUFNLE9BQU8sT0FBTyxFQUFFLE9BQU8sR0FBRyxLQUFLLEdBQUcsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQy9FLENBQUM7QUFFRCxLQUFLLGdHQUFnRyxNQUFNO0FBQ3pHLFFBQU0sUUFBUSxJQUFJLGVBQWU7QUFDakMsUUFBTSxJQUFJLEdBQUcsS0FBSyxHQUFHLEVBQUU7QUFDdkIsUUFBTSxJQUFJLEdBQUcsS0FBSyxHQUFHLEVBQUU7QUFDdkIsU0FBTyxVQUFVLE1BQU0sT0FBTyxDQUFDLENBQUMsR0FBRyxFQUFFLE9BQU8sR0FBRyxLQUFLLEdBQUcsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDckUsU0FBTyxVQUFVLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsT0FBTyxJQUFJLEtBQUssR0FBRyxDQUFDLEVBQUUsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQzdFLFNBQU8sVUFBVSxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLE9BQU8sR0FBRyxLQUFLLEdBQUcsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUM3RSxDQUFDO0FBRUQsS0FBSyxrRkFBa0YsTUFBTTtBQUMzRixRQUFNLFFBQVEsSUFBSSxlQUFlO0FBQ2pDLFFBQU0sSUFBSSxHQUFHLFNBQVMsR0FBRyxJQUFJO0FBQzdCLFFBQU0sSUFBSSxHQUFHLFNBQVMsSUFBSSxJQUFJO0FBQzlCLFFBQU0sT0FBTyxFQUFFLE9BQU8sR0FBRyxLQUFLLElBQUk7QUFDbEMsU0FBTyxVQUFVLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUksRUFBRSxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUM7QUFFMUQsUUFBTSxJQUFJLEdBQUcsU0FBUyxJQUFJLElBQUk7QUFDOUIsUUFBTSxJQUFJLE1BQU0sT0FBTyxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsSUFBSTtBQUN0QyxTQUFPLFVBQVUsRUFBRSxRQUFRLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUNwQyxTQUFPLE1BQU0sRUFBRSxZQUFZLENBQUM7QUFDOUIsQ0FBQztBQUVELEtBQUssbUdBQW1HLE1BQU07QUFFNUcsUUFBTSxRQUFvQixDQUFDO0FBQzNCLFdBQVMsSUFBSSxHQUFHLElBQUksSUFBSSxLQUFLO0FBQzNCLFVBQU0sUUFBUyxJQUFJLEtBQU07QUFDekIsVUFBTSxLQUFLLEdBQUcsSUFBSSxPQUFPLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRyxDQUFDLElBQUksT0FBTyxRQUFRLElBQU0sSUFBSSxLQUFNLEVBQUcsQ0FBQztBQUFBLEVBQ3JGO0FBQ0EsUUFBTSxPQUFPLENBQUMsUUFBNEMsRUFBRSxHQUFHLEdBQUcsT0FBTyxHQUFHLEtBQUssSUFBSSxHQUFHLE9BQU8sVUFBVSxHQUFHLFFBQVEsQ0FBQyxFQUFFO0FBQ3ZILFFBQU0sUUFBUSxJQUFJLGVBQWU7QUFDakMsV0FBUyxJQUFJLEdBQUcsS0FBSyxJQUFJLEtBQUssS0FBSztBQUNqQyxVQUFNLE9BQU8sRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFJLEdBQUc7QUFDckMsVUFBTSxFQUFFLE9BQU8sSUFBSSxNQUFNLE9BQU8sT0FBTyxJQUFJO0FBQzNDLGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUs7QUFDckMsZUFBUyxJQUFJLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLO0FBQ3pDLFlBQUksT0FBTyxDQUFDLElBQUksS0FBSyxPQUFPLENBQUMsTUFBTSxPQUFPLENBQUMsRUFBRztBQUM5QyxjQUFNLElBQUksS0FBSyxNQUFNLENBQUMsQ0FBQztBQUN2QixjQUFNLElBQUksS0FBSyxNQUFNLENBQUMsQ0FBQztBQUN2QixlQUFPLEdBQUcsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxHQUFHLFNBQVMsQ0FBQyxLQUFLLE1BQU0sQ0FBQyxFQUFFLEVBQUUsUUFBUSxNQUFNLENBQUMsRUFBRSxFQUFFLGdCQUFnQixPQUFPLENBQUMsQ0FBQyxjQUFjO0FBQUEsTUFDMUg7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7QUFFRCxLQUFLLGtGQUE2RSxNQUFNO0FBQ3RGLFFBQU0sUUFBUSxDQUFDLEdBQUcsS0FBSyxHQUFHLEVBQUUsR0FBRyxHQUFHLEtBQUssR0FBRyxFQUFFLEdBQUcsR0FBRyxLQUFLLEdBQUcsRUFBRSxDQUFDO0FBQzdELFFBQU0sYUFBYSxJQUFJLGVBQWUsQ0FBQztBQUN2QyxhQUFXLE9BQU8sT0FBTyxFQUFFLE9BQU8sR0FBRyxLQUFLLEdBQUcsQ0FBQztBQUM5QyxTQUFPLFVBQVUsV0FBVyxPQUFPLENBQUMsR0FBRyxLQUFLLEdBQUcsRUFBRSxDQUFDLEdBQUcsRUFBRSxPQUFPLEdBQUcsS0FBSyxHQUFHLENBQUMsRUFBRSxRQUFRLENBQUMsQ0FBQyxHQUFHLGlCQUFpQjtBQUMxRyxRQUFNLFVBQVUsSUFBSSxlQUFlLENBQUM7QUFDcEMsVUFBUSxPQUFPLE9BQU8sRUFBRSxPQUFPLEdBQUcsS0FBSyxHQUFHLENBQUM7QUFDM0MsU0FBTyxVQUFVLFFBQVEsT0FBTyxDQUFDLEdBQUcsS0FBSyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUUsT0FBTyxHQUFHLEtBQUssR0FBRyxDQUFDLEVBQUUsUUFBUSxDQUFDLENBQUMsR0FBRyxtQ0FBOEI7QUFDdEgsQ0FBQztBQUVELEtBQUssb0dBQW9HLE1BQU07QUFFN0csUUFBTSxNQUFNLEdBQUcsU0FBUyxJQUFJLEdBQUc7QUFDL0IsUUFBTSxVQUFVLEdBQUcsaUJBQWlCLEtBQUssR0FBRztBQUM1QyxRQUFNLFFBQVEsSUFBSSxlQUFlO0FBQ2pDLFFBQU0sS0FBSyxNQUFNLE9BQU8sQ0FBQyxLQUFLLE9BQU8sR0FBRyxFQUFFLE9BQU8sSUFBSSxLQUFLLElBQUksQ0FBQztBQUMvRCxTQUFPLFVBQVUsR0FBRyxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsdUNBQXVDO0FBQzNFLFdBQVMsS0FBSyxHQUFHLE1BQU0sSUFBSSxNQUFNLEdBQUc7QUFDbEMsVUFBTSxJQUFJLE1BQU0sT0FBTyxDQUFDLEtBQUssT0FBTyxHQUFHLEVBQUUsT0FBTyxLQUFLLElBQUksS0FBSyxNQUFNLEdBQUcsQ0FBQztBQUN4RSxXQUFPLFVBQVUsRUFBRSxRQUFRLEdBQUcsUUFBUSxVQUFVLEVBQUUsb0JBQW9CO0FBQUEsRUFDeEU7QUFDRixDQUFDO0FBRUQsS0FBSyw2RkFBd0YsTUFBTTtBQUNqRyxRQUFNLFFBQVEsQ0FBQyxHQUFHLEtBQUssR0FBRyxFQUFFLEdBQUcsR0FBRyxLQUFLLElBQUksRUFBRSxHQUFHLEdBQUcsS0FBSyxJQUFJLEVBQUUsR0FBRyxHQUFHLEtBQUssSUFBSSxJQUFJLENBQUM7QUFDbEYsUUFBTSxRQUFRO0FBQUEsSUFDWixFQUFFLE9BQU8sR0FBRyxLQUFLLEdBQUc7QUFBQSxJQUNwQixFQUFFLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFBQSxJQUNyQixFQUFFLE9BQU8sS0FBSyxLQUFLLElBQUk7QUFBQSxJQUN2QixFQUFFLE9BQU8sR0FBRyxLQUFLLEdBQUc7QUFBQSxFQUN0QjtBQUNBLFFBQU0sTUFBTSxJQUFJLGVBQWU7QUFDL0IsUUFBTSxNQUFNLElBQUksZUFBZTtBQUMvQixhQUFXLFFBQVEsT0FBTztBQUN4QixXQUFPLFVBQVUsSUFBSSxPQUFPLE9BQU8sSUFBSSxHQUFHLElBQUksT0FBTyxPQUFPLElBQUksQ0FBQztBQUFBLEVBQ25FO0FBQ0YsQ0FBQztBQUVELEtBQUssdUVBQXVFLE1BQU07QUFDaEYsUUFBTSxRQUFRLElBQUksZUFBZTtBQUNqQyxTQUFPLFVBQVUsTUFBTSxPQUFPLENBQUMsR0FBRyxFQUFFLE9BQU8sR0FBRyxLQUFLLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsWUFBWSxFQUFFLENBQUM7QUFDdkYsUUFBTSxJQUFJLE1BQU0sT0FBTyxDQUFDLEdBQUcsS0FBSyxLQUFLLEdBQUcsQ0FBQyxHQUFHLEVBQUUsT0FBTyxHQUFHLEtBQUssR0FBRyxDQUFDO0FBQ2pFLFNBQU8sVUFBVSxHQUFHLEVBQUUsUUFBUSxDQUFDLEVBQUUsR0FBRyxZQUFZLEVBQUUsQ0FBQztBQUNyRCxDQUFDO0FBS0QsSUFBTSxNQUFNLENBQUMsSUFBWSxRQUEwQixFQUFFLElBQUksT0FBTyxJQUFJLEtBQUssR0FBRztBQUU1RSxLQUFLLHNFQUFzRSxNQUFNO0FBQy9FLFFBQU0sT0FBaUIsRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFRO0FBQ2hELFNBQU8sVUFBVSxnQkFBZ0IsQ0FBQyxHQUFHLE1BQU0sR0FBSSxHQUFHLEVBQUUsVUFBVSxDQUFDLEdBQUcsVUFBVSxDQUFDLEVBQUUsQ0FBQztBQUNoRixRQUFNLE1BQU0sZ0JBQWdCLENBQUMsSUFBSSxLQUFLLEdBQUssQ0FBQyxHQUFHLE1BQU0sR0FBSTtBQUN6RCxTQUFPLE1BQU0sSUFBSSxTQUFTLFFBQVEsR0FBRyw2QkFBNkI7QUFDbEUsU0FBTyxVQUFVLElBQUksVUFBVSxDQUFDLEVBQUUsQ0FBQztBQUNyQyxDQUFDO0FBRUQsS0FBSyx1R0FBdUcsTUFBTTtBQUNoSCxRQUFNLFFBQVEsTUFBTSxLQUFLLEVBQUUsUUFBUSxHQUFHLEdBQUcsQ0FBQyxHQUFHLE1BQU0sSUFBSSxJQUFJLE9BQU8sQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHLENBQUMsSUFBSSxHQUFLLENBQUM7QUFDL0YsUUFBTSxJQUFJLGdCQUFnQixPQUFPLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBUSxHQUFHLEdBQUk7QUFDakUsU0FBTyxNQUFNLEVBQUUsU0FBUyxRQUFRLENBQUM7QUFDakMsU0FBTyxNQUFNLEVBQUUsU0FBUyxDQUFDLEVBQUUsUUFBUSxRQUFRLEVBQUU7QUFDN0MsU0FBTyxVQUFVLEVBQUUsU0FBUyxDQUFDLEVBQUUsUUFBUSxFQUFFLE9BQU8sS0FBTyxLQUFLLElBQU0sR0FBRyxvQ0FBb0M7QUFDekcsU0FBTyxVQUFVLEVBQUUsU0FBUyxDQUFDLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxLQUFPLE1BQU0sR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLGdDQUFnQztBQUMxRyxTQUFPLEdBQUcsRUFBRSxTQUFTLE1BQU0sQ0FBQyxNQUFNLE1BQU0sQ0FBQyxDQUFDO0FBQzVDLENBQUM7QUFFRCxLQUFLLHVHQUFrRyxNQUFNO0FBQzNHLFFBQU0sT0FBaUIsRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFRO0FBQ2hELFFBQU0sVUFBVSxtQkFBbUI7QUFDbkMsUUFBTSxRQUFRLGdCQUFnQixDQUFDLElBQUksS0FBSyxHQUFNLEdBQUcsSUFBSSxLQUFLLE1BQVMsVUFBVSxDQUFDLENBQUMsR0FBRyxNQUFNLEdBQUk7QUFDNUYsU0FBTyxNQUFNLE1BQU0sU0FBUyxRQUFRLEdBQUcsOERBQThEO0FBQ3JHLFFBQU0sS0FBSyxnQkFBZ0IsQ0FBQyxJQUFJLEtBQUssR0FBTSxHQUFHLElBQUksS0FBSyxNQUFTLE9BQU8sQ0FBQyxHQUFHLE1BQU0sR0FBSTtBQUNyRixTQUFPLE1BQU0sR0FBRyxTQUFTLFFBQVEsR0FBRyxxQ0FBcUM7QUFDekUsU0FBTyxVQUFVLEdBQUcsVUFBVSxDQUFDLElBQUksRUFBRSxDQUFDO0FBQ3hDLENBQUM7QUFFRCxLQUFLLHVHQUF1RyxNQUFNO0FBRWhILFFBQU0sT0FBaUIsRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFRO0FBQ2hELFFBQU0sUUFBUSxDQUFDLElBQUksS0FBSyxHQUFNLEdBQUcsSUFBSSxLQUFLLEtBQU0sR0FBRyxJQUFJLEtBQUssS0FBTSxHQUFHLElBQUksS0FBSyxLQUFNLENBQUM7QUFDckYsUUFBTSxJQUFJLGdCQUFnQixPQUFPLE1BQU0sR0FBSTtBQUMzQyxTQUFPLE1BQU0sRUFBRSxTQUFTLFFBQVEsQ0FBQztBQUNqQyxTQUFPLFVBQVUsRUFBRSxTQUFTLENBQUMsRUFBRSxTQUFTLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ3BELFNBQU8sVUFBVSxFQUFFLFNBQVMsQ0FBQyxFQUFFLFFBQVEsRUFBRSxPQUFPLEtBQVEsS0FBSyxNQUFPLENBQUM7QUFDckUsU0FBTztBQUFBLElBQ0wsRUFBRSxTQUFTLENBQUMsRUFBRTtBQUFBLElBQ2Q7QUFBQSxNQUNFLEVBQUUsTUFBTSxLQUFRLE1BQU0sR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUMvQixFQUFFLE1BQU0sT0FBUSxNQUFNLEdBQUcsSUFBSSxFQUFFO0FBQUEsSUFDakM7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUVBLFFBQU0sVUFBVSxnQkFBZ0IsT0FBTyxNQUFNLEtBQU0sQ0FBQztBQUNwRCxTQUFPLE1BQU0sUUFBUSxTQUFTLFFBQVEsQ0FBQztBQUN2QyxTQUFPLFVBQVUsUUFBUSxVQUFVLENBQUMsSUFBSSxJQUFJLElBQUksRUFBRSxDQUFDO0FBQ3JELENBQUM7QUFFRCxLQUFLLDJGQUFzRixNQUFNO0FBRS9GLFFBQU0sUUFBUSxNQUFNLEtBQUssRUFBRSxRQUFRLElBQUssR0FBRyxDQUFDLEdBQUcsTUFBTSxJQUFJLElBQUksT0FBTyxDQUFDLEVBQUUsU0FBUyxHQUFHLEdBQUcsQ0FBQyxJQUFJLElBQUksR0FBSyxDQUFDO0FBQ3JHLFFBQU0sWUFBWTtBQUNsQixNQUFJLE9BQU87QUFDWCxhQUFXLFFBQVEsQ0FBQyxLQUFXLEtBQVcsS0FBVyxHQUFTLEdBQUc7QUFDL0QsVUFBTSxPQUFpQixFQUFFLE9BQU8sR0FBRyxLQUFLLEtBQUs7QUFDN0MsVUFBTSxJQUFJLGdCQUFnQixPQUFPLE1BQU0sU0FBUztBQUNoRCxVQUFNLFVBQVUsT0FBTztBQUN2QixVQUFNLFFBQVEsRUFBRSxTQUFTLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxFQUFFLE1BQU0sUUFBUSxDQUFDO0FBRy9ELGVBQVcsS0FBSyxFQUFFLFVBQVU7QUFDMUIsZUFBUyxJQUFJLEdBQUcsSUFBSSxFQUFFLE1BQU0sUUFBUSxLQUFLO0FBQ3ZDLGVBQU87QUFBQSxXQUNKLEVBQUUsTUFBTSxDQUFDLEVBQUUsT0FBTyxFQUFFLE1BQU0sSUFBSSxDQUFDLEVBQUUsUUFBUSxXQUFXLG1CQUFtQjtBQUFBLFVBQ3hFLFFBQVEsSUFBSSxXQUFXLElBQUksQ0FBQyxJQUFJLENBQUM7QUFBQSxRQUNuQztBQUFBLE1BQ0Y7QUFFQSxVQUFJLE9BQU87QUFDWCxpQkFBVyxNQUFNLEVBQUUsT0FBTztBQUN4QixlQUFPLE1BQU0sR0FBRyxNQUFNLElBQUk7QUFDMUIsZUFBTyxHQUFHLEdBQUcsS0FBSyxHQUFHLElBQUk7QUFDekIsZUFBTyxHQUFHO0FBQUEsTUFDWjtBQUNBLGFBQU8sTUFBTSxNQUFNLEVBQUUsUUFBUSxNQUFNO0FBQUEsSUFDckM7QUFFQSxRQUFJLFNBQVMsVUFBVTtBQUNyQixhQUFPLEdBQUcsUUFBUSxPQUFPLEtBQUssUUFBUSxJQUFJLEtBQUssS0FBSyxhQUFhLElBQUksbUJBQW1CO0FBQ3hGLGFBQU8sR0FBRyxRQUFRLE9BQU8sS0FBSyxRQUFRLElBQUksS0FBSyxLQUFLLGFBQWEsSUFBSSxvQ0FBK0I7QUFBQSxJQUN0RztBQUNBLFdBQU87QUFBQSxFQUNUO0FBQ0YsQ0FBQztBQUVELEtBQUssK0ZBQTBGLE1BQU07QUFFbkcsUUFBTSxPQUFpQixFQUFFLE9BQU8sTUFBVSxLQUFLLEtBQVc7QUFDMUQsUUFBTSxZQUFZO0FBQ2xCLFFBQU0sV0FBVyxLQUFLLE1BQU0sS0FBSyxTQUFTO0FBQzFDLFFBQU0sSUFBSTtBQUFBLElBQ1IsTUFBTSxLQUFLLEVBQUUsUUFBUSxJQUFJLEdBQUcsQ0FBQyxHQUFHLE1BQU0sSUFBSSxJQUFJLE9BQU8sQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHLENBQUMsSUFBSSxJQUFJLEdBQU0sQ0FBQztBQUFBLElBQ3ZGO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFDQSxRQUFNLFFBQVEsRUFBRSxTQUFTLFFBQVEsQ0FBQyxNQUFNLEVBQUUsS0FBSztBQUMvQyxRQUFNLFNBQVUsTUFBTSxNQUFVO0FBRWhDLFNBQU8sR0FBRyxNQUFNLFVBQVUsU0FBUyxtQkFBbUIsR0FBRyxHQUFHLE1BQU0sTUFBTSx1QkFBdUIsT0FBTyxRQUFRLENBQUMsQ0FBQyxpQkFBaUI7QUFDakksUUFBTSxVQUFVLE1BQU0sTUFBTSxTQUFTLENBQUMsRUFBRSxPQUFPLE1BQU0sQ0FBQyxFQUFFLFFBQVE7QUFDaEUsU0FBTyxHQUFHLFNBQVMsU0FBUyxNQUFNLGVBQWUsT0FBTyxRQUFRLENBQUMsQ0FBQyxtQkFBbUIsT0FBTyxRQUFRLENBQUMsQ0FBQyxJQUFJO0FBRzFHLFFBQU0sU0FBUztBQUFBLElBQ2IsTUFBTSxLQUFLLEVBQUUsUUFBUSxHQUFHLEdBQUcsQ0FBQyxHQUFHLE1BQU0sSUFBSSxJQUFJLE9BQU8sQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHLENBQUMsSUFBSSxJQUFJLEdBQU8sQ0FBQztBQUFBLElBQ3ZGO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFDQSxRQUFNLGNBQWMsT0FBTyxTQUFTLFFBQVEsQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLFNBQVMsT0FBTyxTQUFTLE9BQU8sQ0FBQyxNQUFNLElBQUksQ0FBQyxFQUFFO0FBQzFHLFNBQU8sR0FBRyxNQUFNLFNBQVMsY0FBYyxHQUFHLEdBQUcsTUFBTSxNQUFNLDRCQUE0QixXQUFXLFNBQVM7QUFDM0csQ0FBQztBQUVELEtBQUssNkRBQTZELE1BQU07QUFDdEUsUUFBTSxPQUFpQixFQUFFLE9BQU8sR0FBRyxLQUFLLElBQVE7QUFDaEQsUUFBTSxRQUFvQjtBQUFBLElBQ3hCLElBQUksS0FBSyxHQUFNO0FBQUEsSUFDZixJQUFJLEtBQUssS0FBTTtBQUFBLElBQ2YsRUFBRSxJQUFJLE9BQU8sT0FBTyxLQUFRLEtBQUssTUFBUyxJQUFJO0FBQUE7QUFBQSxJQUM5QyxFQUFFLElBQUksUUFBUSxPQUFPLE9BQVEsS0FBSyxLQUFLO0FBQUE7QUFBQSxFQUN6QztBQUNBLFFBQU0sSUFBSSxnQkFBZ0IsT0FBTyxNQUFNLEdBQUk7QUFDM0MsU0FBTyxNQUFNLEVBQUUsU0FBUyxRQUFRLENBQUM7QUFDakMsU0FBTyxVQUFVLEVBQUUsU0FBUyxDQUFDLEVBQUUsU0FBUyxDQUFDLEdBQUcsQ0FBQyxHQUFHLDBCQUEwQjtBQUMxRSxTQUFPLE1BQU0sRUFBRSxTQUFTLENBQUMsR0FBRyxFQUFFO0FBQzlCLFNBQU8sTUFBTSxFQUFFLFNBQVMsQ0FBQyxHQUFHLEVBQUU7QUFDaEMsQ0FBQztBQUVELEtBQUssZ0dBQWdHLE1BQU07QUFDekcsUUFBTSxPQUFpQixFQUFFLE9BQU8sR0FBRyxLQUFLLElBQVE7QUFDaEQsUUFBTSxTQUFTLENBQUMsSUFBSSxLQUFLLEdBQU0sR0FBRyxJQUFJLEtBQUssS0FBTSxHQUFHLElBQUksS0FBSyxHQUFNLEdBQUcsSUFBSSxLQUFLLEtBQU0sQ0FBQztBQUN0RixRQUFNLFdBQVcsQ0FBQyxPQUFPLENBQUMsR0FBRyxPQUFPLENBQUMsR0FBRyxPQUFPLENBQUMsR0FBRyxPQUFPLENBQUMsQ0FBQztBQUM1RCxRQUFNLElBQUksZ0JBQWdCLFFBQVEsTUFBTSxHQUFJO0FBQzVDLFFBQU0sSUFBSSxnQkFBZ0IsVUFBVSxNQUFNLEdBQUk7QUFDOUMsU0FBTyxNQUFNLEVBQUUsU0FBUyxRQUFRLENBQUM7QUFDakMsU0FBTyxNQUFNLEVBQUUsU0FBUyxRQUFRLENBQUM7QUFDakMsUUFBTSxZQUFZLENBQUMsT0FBbUIsTUFBdUMsRUFBRSxRQUFRLElBQUksQ0FBQyxNQUFNLE1BQU0sQ0FBQyxFQUFFLEVBQUU7QUFDN0csU0FBTyxVQUFVLFVBQVUsUUFBUSxFQUFFLFNBQVMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEdBQUcsQ0FBQztBQUM3RCxTQUFPLFVBQVUsVUFBVSxVQUFVLEVBQUUsU0FBUyxDQUFDLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxHQUFHLG9DQUFvQztBQUNyRyxTQUFPLFVBQVUsRUFBRSxTQUFTLElBQUksQ0FBQyxNQUFNLEVBQUUsTUFBTSxHQUFHLEVBQUUsU0FBUyxJQUFJLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQztBQUNqRixTQUFPLE1BQU0sRUFBRSxTQUFTLENBQUMsR0FBRyxHQUFHLG9DQUFvQztBQUNuRSxTQUFPLE1BQU0sRUFBRSxTQUFTLENBQUMsR0FBRyxDQUFDO0FBQy9CLENBQUM7QUFFRCxLQUFLLHlGQUF5RixNQUFNO0FBQ2xHLFFBQU0sUUFBUSxDQUFDLElBQUksS0FBSyxHQUFNLEdBQUcsSUFBSSxLQUFLLEtBQU0sR0FBRyxJQUFJLEtBQUssR0FBTSxDQUFDO0FBQ25FLFFBQU0sT0FBTztBQUNiLFFBQU0sUUFBUSxnQkFBZ0IsT0FBTyxFQUFFLE9BQU8sR0FBRyxLQUFLLEtBQUssR0FBRyxHQUFJO0FBQ2xFLFdBQVMsS0FBSyxHQUFHLE1BQU0sS0FBUSxNQUFNLFFBQVM7QUFDNUMsVUFBTSxJQUFJLGdCQUFnQixPQUFPLEVBQUUsT0FBTyxJQUFJLEtBQUssS0FBSyxLQUFLLEdBQUcsR0FBSTtBQUNwRSxXQUFPLFVBQVUsR0FBRyxPQUFPLFFBQVEsRUFBRSwyQkFBMkI7QUFBQSxFQUNsRTtBQUNGLENBQUM7QUFFRCxLQUFLLHlGQUF5RixNQUFNO0FBRWxHLFFBQU0sUUFBUSxDQUFDLElBQUksS0FBSyxHQUFNLEdBQUcsSUFBSSxLQUFLLEtBQU0sR0FBRyxJQUFJLEtBQUssS0FBTSxDQUFDO0FBQ25FLFFBQU0sT0FBTyxnQkFBZ0IsT0FBTyxFQUFFLE9BQU8sR0FBRyxLQUFLLElBQVEsR0FBRyxHQUFJO0FBQ3BFLFNBQU8sTUFBTSxLQUFLLFNBQVMsUUFBUSxHQUFHLCtCQUErQjtBQUNyRSxTQUFPLE1BQU0sS0FBSyxTQUFTLENBQUMsRUFBRSxRQUFRLFFBQVEsQ0FBQztBQUMvQyxRQUFNLE1BQU0sZ0JBQWdCLE9BQU8sRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFPLEdBQUcsR0FBSTtBQUNsRSxTQUFPLE1BQU0sSUFBSSxTQUFTLFFBQVEsR0FBRyx5Q0FBeUM7QUFDOUUsU0FBTyxVQUFVLElBQUksU0FBUyxDQUFDLEVBQUUsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ2hELFNBQU8sTUFBTSxJQUFJLFNBQVMsQ0FBQyxHQUFHLEVBQUU7QUFDaEMsUUFBTSxRQUFRLGdCQUFnQixPQUFPLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBTyxHQUFHLEdBQUk7QUFDcEUsU0FBTyxNQUFNLE1BQU0sU0FBUyxRQUFRLEdBQUcsbURBQW1EO0FBQzVGLENBQUM7QUFFRCxLQUFLLDBHQUEwRyxNQUFNO0FBQ25ILFFBQU0sU0FBUyxFQUFFLE9BQU8sS0FBUSxLQUFLLE1BQU87QUFDNUMsUUFBTSxJQUFJLGdCQUFnQixNQUFNO0FBQ2hDLFNBQU8sTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLGFBQWEsNENBQTRDO0FBQ3ZGLFNBQU8sT0FBTyxFQUFFLFFBQVEsRUFBRSxPQUFPLElBQUksT0FBTyxRQUFRLE9BQU8sT0FBTyxHQUFHLHdCQUF3QjtBQUU3RixRQUFNLFFBQVEsQ0FBQyxJQUFJLEtBQUssR0FBTSxHQUFHLElBQUksS0FBSyxLQUFNLENBQUM7QUFDakQsU0FBTyxNQUFNLGdCQUFnQixPQUFPLGdCQUFnQixNQUFNLEdBQUcsR0FBSSxFQUFFLFNBQVMsUUFBUSxDQUFDO0FBRXJGLFFBQU0sTUFBTSxFQUFFLE9BQU8sR0FBRyxLQUFLLElBQU87QUFDcEMsUUFBTSxLQUFLLGdCQUFnQixHQUFHO0FBQzlCLFNBQU8sR0FBRyxLQUFLLEtBQUssR0FBRyxNQUFNLEdBQUcsU0FBUyx5QkFBeUIsR0FBTSxJQUFJLElBQUk7QUFFaEYsUUFBTSxRQUFRLGdCQUFnQixFQUFFLE9BQU8sS0FBTyxLQUFLLElBQU0sQ0FBQztBQUMxRCxTQUFPLE1BQU0sTUFBTSxNQUFNLE1BQU0sT0FBTyxXQUFXO0FBQ2pELFNBQU8sT0FBTyxNQUFNLFFBQVEsTUFBTSxPQUFPLEdBQUcsR0FBSztBQUNuRCxDQUFDO0FBRUQsS0FBSywyR0FBMkcsTUFBTTtBQUNwSCxRQUFNLE9BQWlCLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBTTtBQUU5QyxTQUFPLE1BQU0sa0JBQWtCLEVBQUUsT0FBTyxLQUFLLEtBQUssSUFBSSxHQUFHLE1BQU0sRUFBRSxHQUFHLEdBQUc7QUFFdkUsU0FBTyxNQUFNLGtCQUFrQixFQUFFLE9BQU8sTUFBTSxLQUFLLElBQUksR0FBRyxNQUFNLEVBQUUsR0FBRyxFQUFFO0FBRXZFLFNBQU8sTUFBTSxrQkFBa0IsRUFBRSxPQUFPLEtBQUssS0FBSyxLQUFNLEdBQUcsTUFBTSxFQUFFLEdBQUcsR0FBRztBQUV6RSxTQUFPLE1BQU0sa0JBQWtCLEVBQUUsT0FBTyxNQUFNLEtBQUssS0FBSyxHQUFHLE1BQU0sRUFBRSxHQUFHLElBQUk7QUFDMUUsU0FBTyxNQUFNLGtCQUFrQixFQUFFLE9BQU8sTUFBTyxLQUFLLEtBQU0sR0FBRyxNQUFNLEVBQUUsR0FBRyxJQUFJO0FBRTVFLFNBQU8sTUFBTSxrQkFBa0IsRUFBRSxPQUFPLElBQUksS0FBSyxHQUFHLEdBQUcsTUFBTSxHQUFHLEdBQUcsRUFBRTtBQUVyRSxNQUFJLE9BQU87QUFDWCxXQUFTLElBQUksTUFBTSxLQUFLLEtBQUssS0FBSyxJQUFJO0FBQ3BDLFVBQU0sSUFBSSxrQkFBa0IsRUFBRSxPQUFPLEtBQUssS0FBSyxJQUFJLEdBQUcsRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFJLElBQU0sR0FBRyxFQUFFO0FBQ3RGLFdBQU8sR0FBRyxNQUFNLE1BQU0sa0JBQWtCLENBQUMsRUFBRTtBQUMzQyxRQUFJLFNBQVMsS0FBTSxRQUFPLEdBQUcsS0FBSyxJQUFJLElBQUksSUFBSSxLQUFLLEtBQUssTUFBTSwrQ0FBMEM7QUFDeEcsV0FBTztBQUFBLEVBQ1Q7QUFDRixDQUFDO0FBSUQsS0FBSyxpR0FBaUcsTUFBTTtBQUUxRyxTQUFPLE1BQU0sY0FBYyxNQUFNLE1BQU0sR0FBUyxHQUFHLElBQUk7QUFFdkQsU0FBTyxVQUFVLGNBQWMsS0FBUyxLQUFTLEdBQVMsR0FBRyxFQUFFLE9BQU8sS0FBUyxLQUFLLElBQVUsQ0FBQztBQUUvRixTQUFPLFVBQVUsY0FBYyxLQUFTLE1BQVcsR0FBUyxHQUFHLEVBQUUsT0FBTyxLQUFTLEtBQUssS0FBVSxDQUFDO0FBRWpHLFNBQU8sVUFBVSxjQUFjLEtBQVMsTUFBTSxLQUFXLE1BQU0sR0FBTyxHQUFHLEVBQUUsT0FBTyxLQUFTLEtBQUssSUFBVSxDQUFDO0FBQzNHLFNBQU8sVUFBVSxjQUFjLEtBQVMsTUFBTSxLQUFXLEtBQVMsR0FBTyxHQUFHLEVBQUUsT0FBTyxLQUFTLEtBQUssSUFBVSxDQUFDO0FBRTlHLFNBQU8sVUFBVSxjQUFjLE1BQU0sTUFBTSxLQUFXLE1BQU0sR0FBTyxHQUFHLEVBQUUsT0FBTyxLQUFTLEtBQUssSUFBVSxDQUFDO0FBQzFHLENBQUM7QUFFRCxLQUFLLDJFQUEyRSxNQUFNO0FBRXBGLFNBQU8sVUFBVSxjQUFjLEtBQVcsTUFBTSxLQUFXLE1BQU0sTUFBTSxHQUFNLEdBQUcsRUFBRSxPQUFPLE1BQVMsS0FBSyxJQUFVLENBQUM7QUFFbEgsU0FBTyxVQUFVLGNBQWMsT0FBUyxNQUFNLEtBQVcsTUFBTSxNQUFNLEdBQU0sR0FBRyxFQUFFLE9BQU8sTUFBUyxLQUFLLElBQVUsQ0FBQztBQUVoSCxTQUFPLFVBQVUsY0FBYyxNQUFTLE1BQU0sS0FBVyxNQUFNLE1BQU0sR0FBTSxHQUFHLEVBQUUsT0FBTyxNQUFTLEtBQUssSUFBVSxDQUFDO0FBQ2xILENBQUM7QUFFRCxLQUFLLCtFQUErRSxNQUFNO0FBQ3hGLFFBQU0sU0FBbUIsRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFPO0FBRWpELFNBQU8sVUFBVSxrQkFBa0IsRUFBRSxPQUFPLEtBQU8sS0FBSyxJQUFNLEdBQUcsUUFBUSxHQUFLLEdBQUcsRUFBRSxJQUFJLEtBQUssSUFBSSxJQUFJLENBQUM7QUFDckcsU0FBTyxVQUFVLGtCQUFrQixFQUFFLE9BQU8sTUFBUSxLQUFLLElBQU0sR0FBRyxRQUFRLEdBQUssR0FBRyxFQUFFLElBQUksR0FBRyxJQUFJLElBQUksQ0FBQztBQUVwRyxTQUFPLFVBQVUsa0JBQWtCLEVBQUUsT0FBTyxLQUFPLEtBQUssS0FBTyxHQUFHLFFBQVEsR0FBSyxHQUFHLEVBQUUsSUFBSSxLQUFLLElBQUksSUFBTSxDQUFDO0FBRXhHLFNBQU8sVUFBVSxrQkFBa0IsRUFBRSxPQUFPLEdBQUcsS0FBSyxFQUFFLEdBQUcsRUFBRSxPQUFPLEdBQUcsS0FBSyxFQUFFLEdBQUcsR0FBSyxHQUFHLEVBQUUsSUFBSSxHQUFHLElBQUksSUFBTSxDQUFDO0FBQzNHLFNBQU8sVUFBVSxrQkFBa0IsRUFBRSxPQUFPLEdBQUcsS0FBSyxFQUFFLEdBQUcsUUFBUSxDQUFDLEdBQUcsRUFBRSxJQUFJLEdBQUcsSUFBSSxFQUFFLENBQUM7QUFDdkYsQ0FBQztBQUVELEtBQUssaUhBQWlILE1BQU07QUFDMUgsUUFBTSxTQUFtQixFQUFFLE9BQU8sR0FBRyxLQUFLLElBQVU7QUFFcEQsUUFBTSxJQUFJLGtCQUFrQixFQUFFLE9BQU8sS0FBUyxLQUFLLE9BQVEsR0FBRyxRQUFRLEdBQUs7QUFDM0UsU0FBTyxHQUFHLEtBQUssSUFBSSxFQUFFLEtBQUssRUFBRSxLQUFLLHFCQUFxQixJQUFJLE1BQU0seUJBQXlCO0FBQ3pGLFNBQU8sR0FBRyxLQUFLLEtBQUssRUFBRSxLQUFLLEVBQUUsTUFBTSxJQUFJLE1BQU0sSUFBSSxNQUFNLDhCQUE4QjtBQUVyRixTQUFPLFVBQVUsa0JBQWtCLEVBQUUsT0FBTyxNQUFVLEtBQUssS0FBUyxHQUFHLFFBQVEsR0FBSyxHQUFHLEVBQUUsSUFBSSxHQUFHLElBQUksc0JBQXNCLENBQUM7QUFFM0gsU0FBTyxVQUFVLGtCQUFrQixFQUFFLE9BQU8sS0FBVyxLQUFLLEtBQVUsR0FBRyxRQUFRLEdBQUssR0FBRztBQUFBLElBQ3ZGLElBQUksTUFBUTtBQUFBLElBQ1osSUFBSTtBQUFBLEVBQ04sQ0FBQztBQUNILENBQUM7QUFFRCxLQUFLLCtGQUErRixNQUFNO0FBQ3hHLFFBQU0sT0FBTyxFQUFFLElBQUksS0FBSyxJQUFJLElBQUk7QUFDaEMsUUFBTSxNQUFNO0FBRVosU0FBTyxNQUFNLGVBQWUsTUFBTSxLQUFLLElBQUksR0FBRyxhQUFhO0FBQzNELFNBQU8sTUFBTSxlQUFlLE1BQU0sTUFBTSxNQUFNLElBQUksR0FBRyxRQUFRO0FBQzdELFNBQU8sTUFBTSxlQUFlLE1BQU0sS0FBSyxJQUFJLEdBQUcsY0FBYztBQUM1RCxTQUFPLE1BQU0sZUFBZSxNQUFNLE1BQU0sTUFBTSxJQUFJLEdBQUcsT0FBTztBQUU1RCxTQUFPLE1BQU0sZUFBZSxNQUFNLEtBQUssSUFBSSxHQUFHLGFBQWE7QUFDM0QsU0FBTyxNQUFNLGVBQWUsTUFBTSxLQUFLLElBQUksR0FBRyxjQUFjO0FBRTVELFNBQU8sTUFBTSxlQUFlLE1BQU0sTUFBTSxNQUFNLElBQUksR0FBRyxRQUFRO0FBQzdELFNBQU8sTUFBTSxlQUFlLEtBQUssSUFBSSxHQUFHLFFBQVE7QUFDbEQsQ0FBQztBQUVELEtBQUssbUdBQW1HLE1BQU07QUFFNUcsUUFBTSxPQUFPLEVBQUUsSUFBSSxLQUFLLElBQUksSUFBSTtBQUNoQyxTQUFPLE1BQU0sZUFBZSxLQUFLLElBQUksR0FBRyxRQUFRO0FBQ2hELFNBQU8sTUFBTSxlQUFlLEtBQUssSUFBSSxHQUFHLGFBQWE7QUFDckQsU0FBTyxNQUFNLGVBQWUsS0FBSyxJQUFJLEdBQUcsY0FBYztBQUV0RCxRQUFNLE9BQU8sRUFBRSxJQUFJLEtBQUssSUFBSSxJQUFJO0FBQ2hDLFNBQU8sTUFBTSxlQUFlLEtBQUssSUFBSSxHQUFHLGFBQWE7QUFDckQsU0FBTyxNQUFNLGVBQWUsS0FBSyxJQUFJLEdBQUcsY0FBYztBQUN0RCxTQUFPLE1BQU0sZUFBZSxLQUFLLElBQUksR0FBRyxRQUFRO0FBRWhELFNBQU8sTUFBTSxlQUFlLEtBQUssRUFBRSxJQUFJLEtBQUssSUFBSSxJQUFJLENBQUMsR0FBRyxhQUFhO0FBQ3ZFLENBQUM7QUFFRCxLQUFLLGlGQUFpRixNQUFNO0FBQzFGLFFBQU0sU0FBbUIsRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFPO0FBQ2pELFFBQU0sT0FBaUIsRUFBRSxPQUFPLEtBQU8sS0FBSyxJQUFNO0FBRWxELFNBQU8sVUFBVSxXQUFXLE1BQU0sS0FBSyxRQUFRLEdBQUssR0FBRyxFQUFFLE9BQU8sS0FBTyxLQUFLLElBQU0sQ0FBQztBQUNuRixTQUFPLFVBQVUsV0FBVyxNQUFNLE1BQU0sUUFBUSxHQUFLLEdBQUcsRUFBRSxPQUFPLEtBQU8sS0FBSyxJQUFNLENBQUM7QUFFcEYsU0FBTyxVQUFVLFdBQVcsTUFBTSxNQUFNLFFBQVEsR0FBSyxHQUFHLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBTSxDQUFDO0FBRWhGLFNBQU8sVUFBVSxXQUFXLE1BQU0sS0FBSyxRQUFRLEdBQUssR0FBRyxFQUFFLE9BQU8sS0FBTyxLQUFLLElBQU8sQ0FBQztBQUVwRixTQUFPLFVBQVUsV0FBVyxFQUFFLE9BQU8sTUFBUyxLQUFLLEVBQUUsR0FBRyxJQUFJLFFBQVEsR0FBSyxHQUFHLEVBQUUsT0FBTyxNQUFTLEtBQUssSUFBTyxDQUFDO0FBRTNHLFNBQU8sVUFBVSxXQUFXLE1BQU0sS0FBSyxFQUFFLE9BQU8sR0FBRyxLQUFLLEVBQUUsR0FBRyxHQUFLLEdBQUcsSUFBSTtBQUN6RSxTQUFPLFVBQVUsV0FBVyxNQUFNLEtBQUssUUFBUSxDQUFDLEdBQUcsSUFBSTtBQUN6RCxDQUFDO0FBRUQsS0FBSyx3RkFBd0YsTUFBTTtBQUNqRyxRQUFNLFNBQW1CLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBUTtBQUNsRCxRQUFNLE9BQWlCLEVBQUUsT0FBTyxLQUFRLEtBQUssSUFBTztBQUNwRCxTQUFPLFVBQVUsY0FBYyxNQUFNLFFBQVEsS0FBSyxRQUFRLEdBQUssR0FBRyxFQUFFLE9BQU8sS0FBUSxLQUFLLElBQU8sQ0FBQztBQUNoRyxTQUFPLFVBQVUsY0FBYyxNQUFNLFNBQVMsS0FBSyxRQUFRLEdBQUssR0FBRyxFQUFFLE9BQU8sS0FBUSxLQUFLLElBQU8sQ0FBQztBQUVqRyxTQUFPLFVBQVUsY0FBYyxNQUFNLFFBQVEsS0FBSyxRQUFRLEdBQUssR0FBRyxFQUFFLE9BQU8sR0FBRyxLQUFLLElBQU8sQ0FBQztBQUMzRixTQUFPLFVBQVUsY0FBYyxNQUFNLFNBQVMsTUFBTyxRQUFRLEdBQUssR0FBRyxFQUFFLE9BQU8sS0FBUSxLQUFLLElBQVEsQ0FBQztBQUVwRyxRQUFNLE9BQWlCLEVBQUUsT0FBTyxHQUFHLEtBQUssS0FBSyxNQUFXO0FBQ3hELFFBQU0sUUFBa0IsRUFBRSxPQUFPLEtBQUssTUFBTSxLQUFXLEtBQUssS0FBSyxJQUFJO0FBQ3JFLFNBQU8sVUFBVSxjQUFjLE9BQU8sUUFBUSxHQUFHLE1BQU0sR0FBSyxHQUFHLEVBQUUsT0FBTyxLQUFLLE1BQU0sYUFBYSxLQUFLLEtBQUssSUFBSSxDQUFDO0FBRS9HLFNBQU8sVUFBVSxjQUFjLE1BQU0sUUFBUSxLQUFLLEVBQUUsT0FBTyxHQUFHLEtBQUssRUFBRSxHQUFHLEdBQUssR0FBRyxJQUFJO0FBQ3RGLENBQUM7QUFFRCxLQUFLLHVHQUFrRyxNQUFNO0FBQzNHLFFBQU0sU0FBbUIsRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFRO0FBQ2xELFFBQU0sT0FBaUIsRUFBRSxPQUFPLEtBQVEsS0FBSyxJQUFPO0FBRXBELFNBQU8sVUFBVSxjQUFjLE1BQU0sUUFBUSxLQUFLLFFBQVEsR0FBSyxHQUFHLEVBQUUsT0FBTyxNQUFTLGFBQWEsS0FBSyxJQUFPLENBQUM7QUFFOUcsU0FBTyxVQUFVLGNBQWMsTUFBTSxTQUFTLEtBQUssUUFBUSxHQUFLLEdBQUcsRUFBRSxPQUFPLEtBQVEsS0FBSyxNQUFTLFlBQVksQ0FBQztBQUUvRyxRQUFNLFlBQXNCLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBTTtBQUNuRCxRQUFNLElBQUksY0FBYyxXQUFXLFNBQVMsR0FBRyxRQUFRLEdBQUs7QUFDNUQsU0FBTyxVQUFVLEdBQUcsRUFBRSxPQUFPLEdBQUcsS0FBSyxZQUFZLENBQUM7QUFDcEQsQ0FBQztBQUVELEtBQUssMEZBQTBGLE1BQU07QUFDbkcsUUFBTSxTQUFtQixFQUFFLE9BQU8sR0FBRyxLQUFLLElBQU87QUFDakQsUUFBTSxPQUFpQixFQUFFLE9BQU8sS0FBTyxLQUFLLElBQU07QUFDbEQsU0FBTyxVQUFVLGNBQWMsTUFBTSxLQUFLLFFBQVEsR0FBSyxHQUFHLEVBQUUsT0FBTyxLQUFPLEtBQUssSUFBTSxDQUFDO0FBRXRGLFNBQU8sVUFBVSxjQUFjLE1BQU0sR0FBRyxRQUFRLEdBQUssR0FBRyxFQUFFLE9BQU8sR0FBRyxLQUFLLElBQU0sQ0FBQztBQUNoRixTQUFPLFVBQVUsY0FBYyxNQUFNLEtBQU8sUUFBUSxHQUFLLEdBQUcsRUFBRSxPQUFPLEtBQU8sS0FBSyxJQUFPLENBQUM7QUFFekYsU0FBTyxVQUFVLGNBQWMsTUFBTSxLQUFLLFFBQVEsQ0FBQyxHQUFHLElBQUk7QUFDNUQsQ0FBQztBQUlELEtBQUssa0dBQTZGLE1BQU07QUFDdEcsUUFBTSxPQUFPO0FBQ2IsUUFBTSxPQUFPO0FBQ2IsUUFBTSxhQUFhO0FBRW5CLFdBQVMsUUFBUSxHQUFHLFNBQVMsS0FBSyxTQUFTO0FBQ3pDLFVBQU0sTUFBTSxPQUFPLFFBQVE7QUFDM0IsVUFBTSxNQUFNLE1BQU0sT0FBTztBQUN6QixVQUFNLFFBQVEsYUFBYSxFQUFFLE9BQU8sTUFBTSxNQUFNLElBQUksR0FBRyxLQUFLLFVBQVU7QUFDdEUsV0FBTyxHQUFHLE9BQU8sd0NBQXdDO0FBQ3pELFdBQU8sR0FBRyxNQUFNLE9BQU8sWUFBWSxTQUFTLEtBQUssNENBQTRDO0FBQUEsRUFDL0Y7QUFDRixDQUFDO0FBRUQsS0FBSyw4RkFBOEYsTUFBTTtBQUN2RyxRQUFNLFVBQVUsSUFBSSxnQkFBZ0I7QUFDcEMsUUFBTSxPQUFPO0FBQ2IsUUFBTSxPQUFPO0FBQ2IsVUFBUSxXQUFXLE9BQU8sSUFBSSxNQUFNLElBQUk7QUFDeEMsTUFBSSxXQUFXO0FBQ2YsV0FBUyxRQUFRLEdBQUcsUUFBUSxLQUFPLFNBQVM7QUFDMUMsVUFBTSxNQUFNLE9BQU8sUUFBUTtBQUMzQixVQUFNLE1BQU0sTUFBTSxPQUFPO0FBQ3pCLFVBQU0sUUFBUSxhQUFhLEVBQUUsT0FBTyxNQUFNLE1BQU0sSUFBSSxHQUFHLEtBQUssUUFBUSxXQUFXLENBQUM7QUFDaEYsUUFBSSxDQUFDLE1BQU87QUFDWixVQUFNLE1BQU0sUUFBUSxZQUFZLE9BQU8sR0FBRztBQUMxQyxRQUFJLEtBQUs7QUFDUDtBQUNBLGNBQVEsT0FBTyxLQUFLLEVBQUUsSUFBSSxLQUFLLENBQUM7QUFBQSxJQUNsQztBQUFBLEVBQ0Y7QUFDQSxTQUFPLE1BQU0sVUFBVSxHQUFHLDBFQUEwRTtBQUN0RyxDQUFDO0FBRUQsS0FBSyx5RkFBeUYsTUFBTTtBQUNsRyxRQUFNLFVBQVUsSUFBSSxnQkFBZ0I7QUFDcEMsUUFBTSxPQUFPO0FBQ2IsTUFBSSxNQUFNO0FBQ1YsUUFBTSxTQUFTLGFBQWEsRUFBRSxPQUFPLE1BQU0sTUFBTSxLQUFLLElBQUksR0FBRyxLQUFLLFFBQVEsV0FBVyxDQUFDO0FBQ3RGLFNBQU8sR0FBRyxVQUFVLE9BQU8sUUFBUSxLQUFLLDBCQUEwQjtBQUNsRSxRQUFNLE1BQU0sUUFBUSxZQUFZLFFBQVEsR0FBRztBQUMzQyxTQUFPLEdBQUcsR0FBRztBQUNiLFVBQVEsT0FBTyxLQUFLLEVBQUUsSUFBSSxLQUFLLENBQUM7QUFFaEMsTUFBSSxVQUFVO0FBQ2QsV0FBUyxRQUFRLEdBQUcsUUFBUSxLQUFLLFNBQVM7QUFDeEMsV0FBTztBQUNQLFVBQU0sUUFBUSxhQUFhLEVBQUUsT0FBTyxNQUFNLE1BQU0sS0FBSyxJQUFJLEdBQUcsS0FBSyxRQUFRLFdBQVcsQ0FBQztBQUNyRixRQUFJLENBQUMsTUFBTztBQUNaLFVBQU0sSUFBSSxRQUFRLFlBQVksT0FBTyxHQUFHO0FBQ3hDLFFBQUksR0FBRztBQUNMO0FBQ0EsY0FBUSxPQUFPLEdBQUcsRUFBRSxJQUFJLEtBQUssQ0FBQztBQUFBLElBQ2hDO0FBQUEsRUFDRjtBQUNBLFNBQU8sTUFBTSxTQUFTLEdBQUcsZ0VBQWdFO0FBQzNGLENBQUM7QUFFRCxLQUFLLDBGQUEwRixNQUFNO0FBQ25HLFFBQU0sVUFBVSxJQUFJLGdCQUFnQjtBQUNwQyxRQUFNLE1BQU07QUFDWixVQUFRLFdBQVcsTUFBTSxLQUFXLEdBQUc7QUFFdkMsUUFBTSxPQUFpQixFQUFFLE9BQU8sTUFBTSxLQUFXLEtBQUssTUFBTSxJQUFVO0FBQ3RFLFFBQU0sUUFBUSxhQUFhLE1BQU0sS0FBSyxRQUFRLFdBQVcsQ0FBQztBQUMxRCxTQUFPLEdBQUcsS0FBSztBQUNmLFFBQU0sTUFBTSxRQUFRLFlBQVksT0FBTyxHQUFHO0FBQzFDLFNBQU8sR0FBRyxLQUFLLGlDQUFpQztBQUNoRCxTQUFPLEdBQUcsSUFBSSxPQUFPLE1BQU0sTUFBWSxJQUFJO0FBQzdDLENBQUM7QUFFRCxLQUFLLG9GQUFvRixNQUFNO0FBQzdGLFFBQU0sSUFBSSxJQUFJLGdCQUFnQjtBQUM5QixRQUFNLE9BQWlCLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBUTtBQUNoRCxRQUFNLE1BQU0sRUFBRSxZQUFZLE1BQU0sQ0FBQztBQUNqQyxTQUFPLEdBQUcsR0FBRztBQUNiLElBQUUsT0FBTyxLQUFLLEVBQUUsSUFBSSxNQUFNLEdBQUcsR0FBSztBQUVsQyxNQUFJLFNBQVM7QUFDYixXQUFTLE1BQU0sTUFBTyxNQUFNLEtBQU8sT0FBTyxJQUFJO0FBQzVDLFFBQUksRUFBRSxZQUFZLE1BQU0sR0FBRyxFQUFHO0FBQUEsRUFDaEM7QUFDQSxTQUFPLE1BQU0sUUFBUSxHQUFHLDBDQUEwQztBQUNsRSxTQUFPLEdBQUcsRUFBRSxZQUFZLE1BQU0sSUFBSyxHQUFHLDBDQUEwQztBQUNsRixDQUFDO0FBSUQsS0FBSywrRUFBK0UsTUFBTTtBQUN4RixTQUFPLE1BQU0sY0FBYyxhQUFhLEdBQUcsQ0FBQztBQUM1QyxTQUFPLE1BQU0sY0FBYyxNQUFNLEdBQUcsYUFBYTtBQUNqRCxTQUFPLE1BQU0sY0FBYyxjQUFjLEdBQUcscUJBQXFCO0FBQ2pFLFNBQU8sR0FBRyxnQkFBZ0IsUUFBUSxnQkFBZ0IsRUFBRTtBQUNwRCxTQUFPLE1BQU0sdUJBQXVCLEdBQUc7QUFDekMsQ0FBQztBQUVELEtBQUssNkVBQTZFLE1BQU07QUFDdEYsUUFBTSxVQUFVLENBQUMsV0FBMkI7QUFDMUMsUUFBSSxXQUFXO0FBQ2YsUUFBSSxPQUFPO0FBQ1gsYUFBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLEtBQUs7QUFDNUIsWUFBTSxJQUFJLEtBQUssTUFBTztBQUN0QixVQUFJLGFBQWEsR0FBRyxNQUFNLE1BQU0sR0FBRztBQUNqQztBQUNBLGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTyxNQUFNLFFBQVEsQ0FBQyxHQUFHLEtBQUssMEJBQTBCO0FBQ3hELFFBQU0sT0FBTyxRQUFRLGFBQWE7QUFDbEMsU0FBTyxHQUFHLFFBQVEsT0FBTyxRQUFRLEtBQUssbUNBQThCLE9BQU8sRUFBRSxJQUFJO0FBQ2pGLFFBQU0sVUFBVSxRQUFRLHFCQUFxQjtBQUM3QyxTQUFPLEdBQUcsV0FBVyxNQUFNLFdBQVcsS0FBSyxzQ0FBaUMsVUFBVSxFQUFFLElBQUk7QUFDOUYsQ0FBQztBQUVELEtBQUssbUVBQW1FLE1BQU07QUFDNUUsUUFBTSxPQUFPLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBTztBQUNyQyxTQUFPLE1BQU0sa0JBQWtCLE1BQU0sS0FBSyxHQUFHLGFBQWEsR0FBRyxhQUFhO0FBQzFFLFNBQU8sTUFBTSxrQkFBa0IsTUFBTSxLQUFLLEdBQUcsYUFBYSxHQUFHLGFBQWE7QUFDMUUsU0FBTyxNQUFNLGtCQUFrQixNQUFNLEtBQUssR0FBRyxxQkFBcUIsR0FBRyxxQkFBcUI7QUFDNUYsQ0FBQztBQUVELEtBQUssaUdBQTRGLE1BQU07QUFDckcsUUFBTSxPQUFPLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBUTtBQUN0QyxTQUFPLE1BQU0sa0JBQWtCLE1BQU0sS0FBSyxHQUFHLGFBQWEsR0FBRyxHQUFJO0FBQ2pFLFNBQU8sTUFBTSxrQkFBa0IsTUFBTSxLQUFLLEdBQUcsYUFBYSxHQUFHLEdBQUc7QUFFaEUsU0FBTyxNQUFNLGtCQUFrQixFQUFFLE9BQU8sR0FBRyxLQUFLLElBQUksTUFBVyxHQUFHLEtBQUssR0FBRyxhQUFhLEdBQUksSUFBSSxRQUFjLEdBQUc7QUFDbEgsQ0FBQztBQUVELEtBQUssZ0dBQTJGLE1BQU07QUFJcEcsYUFBVyxRQUFRLENBQUMsS0FBTyxLQUFRLEtBQVMsTUFBVyxJQUFJLEtBQVUsR0FBRztBQUN0RSxlQUFXLFNBQVMsQ0FBQyxLQUFLLEtBQUssSUFBSSxHQUFHO0FBQ3BDLGlCQUFXLE9BQU8sQ0FBQyxHQUFHLEtBQUssR0FBRyxDQUFDLEdBQUc7QUFDaEMsbUJBQVcsVUFBVSxDQUFDLGVBQWUscUJBQXFCLEdBQUc7QUFDM0QsZ0JBQU0sSUFBSSxrQkFBa0IsRUFBRSxPQUFPLEdBQUcsS0FBSyxLQUFLLEdBQUcsT0FBTyxLQUFLLE1BQU07QUFDdkUsZ0JBQU0sU0FBUyxRQUFRLFFBQVE7QUFDL0IsaUJBQU8sR0FBRyxLQUFLLFFBQVEsUUFBUSxJQUFJLE1BQU0sS0FBSyxRQUFRLEdBQUcsV0FBVyxNQUFNLEtBQUssQ0FBQyxNQUFNLE1BQU0sRUFBRTtBQUM5RixpQkFBTyxNQUFNLEdBQUcsS0FBSyxJQUFJLFFBQVEsTUFBTSxDQUFDO0FBQUEsUUFDMUM7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDO0FBRUQsS0FBSyxzRkFBaUYsTUFBTTtBQUMxRixNQUFJLE9BQU87QUFDWCxhQUFXLFFBQVEsQ0FBQyxLQUFPLEtBQVEsS0FBUSxLQUFTLE1BQVcsS0FBVSxHQUFHO0FBQzFFLFVBQU0sSUFBSSxrQkFBa0IsRUFBRSxPQUFPLEdBQUcsS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLGFBQWE7QUFDMUUsV0FBTyxHQUFHLEtBQUssTUFBTSxRQUFRLElBQUksS0FBSyxDQUFDLE1BQU0sSUFBSSxFQUFFO0FBQ25ELFdBQU87QUFBQSxFQUNUO0FBQ0YsQ0FBQztBQUVELEtBQUssd0hBQXdILE1BQU07QUFDakksUUFBTSxPQUFPLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBUTtBQUV0QyxTQUFPLE1BQU0sa0JBQWtCLE1BQU0sS0FBSyxHQUFHLENBQUMsR0FBRyxHQUFJO0FBRXJELFNBQU8sTUFBTSxrQkFBa0IsRUFBRSxPQUFPLEdBQUcsS0FBSyxFQUFFLEdBQUcsS0FBSyxHQUFHLGFBQWEsR0FBRyxhQUFhO0FBQzFGLFNBQU8sTUFBTSxrQkFBa0IsRUFBRSxPQUFPLElBQUksS0FBSyxFQUFFLEdBQUcsS0FBSyxHQUFHLGFBQWEsR0FBRyxhQUFhO0FBQzNGLFNBQU8sTUFBTSxrQkFBa0IsTUFBTSxHQUFHLEdBQUcsYUFBYSxHQUFHLGFBQWE7QUFDeEUsU0FBTyxNQUFNLGtCQUFrQixNQUFNLEtBQUssS0FBSyxhQUFhLEdBQUcsYUFBYTtBQUM1RSxTQUFPLE1BQU0sa0JBQWtCLEVBQUUsT0FBTyxLQUFLLEtBQUssRUFBRSxHQUFHLEtBQUssR0FBRyxhQUFhLEdBQUcsYUFBYTtBQUM5RixDQUFDO0FBSUQsS0FBSyx3REFBd0QsTUFBTTtBQUNqRSxTQUFPLE1BQU0sU0FBUyxTQUFTLEdBQUcsc0JBQXNCO0FBRXhELFNBQU8sTUFBTSxTQUFTLGdCQUFnQixHQUFHLHNCQUFzQjtBQUNqRSxDQUFDO0FBRUQsS0FBSyxtRUFBbUUsTUFBTTtBQUM1RSxTQUFPLE1BQU0sU0FBUyxTQUFTLEdBQUcscUJBQXFCO0FBQ3ZELFNBQU8sTUFBTSxTQUFTLFNBQVMsR0FBRyx3QkFBd0I7QUFDMUQsU0FBTyxNQUFNLFNBQVMsU0FBUyxHQUFHLGtCQUFrQjtBQUN0RCxDQUFDO0FBRUQsS0FBSyw0Q0FBNEMsTUFBTTtBQUNyRCxTQUFPLE1BQU0sU0FBUyxzQkFBc0IsR0FBRyx3QkFBd0I7QUFDdkUsU0FBTyxNQUFNLFNBQVMsMEJBQTBCLEdBQUcseUJBQXlCO0FBQzVFLFNBQU8sTUFBTSxTQUFTLFdBQVcsR0FBRyxxQkFBcUIsTUFBTSxNQUFNLE1BQU8sTUFBTSxJQUFJLE1BQU0sTUFBTSxLQUFLLE1BQU8sTUFBTSxNQUFPLEdBQUksSUFBSSxHQUFJLEdBQUc7QUFDNUksQ0FBQztBQUVELEtBQUssbUVBQW1FLE1BQU07QUFDNUUsU0FBTyxNQUFNLFNBQVMscUJBQXFCLEdBQUcscUJBQXFCO0FBRW5FLFFBQU0sTUFBTSxTQUFTLDJCQUEyQjtBQUNoRCxRQUFNLElBQUksSUFBSSxNQUFNLGtDQUFrQztBQUN0RCxTQUFPLEdBQUcsR0FBRywrQkFBK0IsR0FBRyxFQUFFO0FBQ2pELFNBQU8sR0FBRyxPQUFPLEVBQUUsQ0FBQyxDQUFDLElBQUksT0FBTyxFQUFFLENBQUMsQ0FBQyxLQUFLLE9BQU8sRUFBRSxDQUFDLENBQUMsSUFBSSxPQUFPLEVBQUUsQ0FBQyxDQUFDLEdBQUcsR0FBRztBQUV6RSxTQUFPLE1BQU0sU0FBUyw0QkFBNEIsR0FBRyw4QkFBOEI7QUFFbkYsU0FBTyxNQUFNLFNBQVMsZUFBZSxHQUFHLGVBQWU7QUFDdkQsU0FBTyxNQUFNLFNBQVMsVUFBVSxHQUFHLFVBQVU7QUFDL0MsQ0FBQztBQUVELEtBQUssNEVBQTRFLE1BQU07QUFHckYsYUFBVyxRQUFRLENBQUMsU0FBUyxLQUFLLEdBQVk7QUFDNUMsVUFBTSxPQUFPLGNBQWMsS0FBSyxFQUFFLEtBQUssQ0FBQztBQUN4QyxVQUFNLFNBQVMsU0FBUyxJQUFJO0FBQzVCLFdBQU8sU0FBUyxRQUFRLElBQUk7QUFDNUIsV0FBTyxNQUFNLFFBQVEsU0FBUztBQUFBLEVBQ2hDO0FBQ0YsQ0FBQztBQUlELEtBQUssc0RBQXNELE1BQU07QUFFL0QsU0FBTyxNQUFNLGVBQWUsU0FBUyxHQUFHLHFCQUFxQjtBQUM3RCxTQUFPLE1BQU0sZUFBZSxTQUFTLEdBQUcscUJBQXFCO0FBQzdELFNBQU8sTUFBTSxlQUFlLFNBQVMsR0FBRyxxQkFBcUI7QUFDL0QsQ0FBQztBQUVELEtBQUsscUVBQXFFLE1BQU07QUFDOUUsU0FBTyxNQUFNLGVBQWUsU0FBUyxHQUFHLDJCQUEyQjtBQUNuRSxTQUFPLE1BQU0sZUFBZSxTQUFTLEdBQUcsMkJBQTJCO0FBQ25FLFNBQU8sTUFBTSxlQUFlLFNBQVMsR0FBRywyQkFBMkI7QUFDckUsQ0FBQztBQUVELEtBQUsseUVBQXlFLE1BQU07QUFDbEYsU0FBTyxNQUFNLGVBQWUsb0JBQW9CLEdBQUcscUJBQXFCO0FBQ3hFLFNBQU8sTUFBTSxlQUFlLDBCQUEwQixHQUFHLHFCQUFxQjtBQUM5RSxTQUFPLE1BQU0sZUFBZSxvQkFBb0IsR0FBRyxxQkFBcUI7QUFDeEUsU0FBTyxNQUFNLGVBQWUsc0JBQXNCLEdBQUcscUJBQXFCO0FBQzFFLFNBQU8sTUFBTSxlQUFlLHFCQUFxQixHQUFHLDJCQUEyQjtBQUNqRixDQUFDO0FBRUQsS0FBSyxpRUFBaUUsTUFBTTtBQUUxRSxTQUFPLE1BQU0sZUFBZSxjQUFjLEdBQUcscUJBQXFCO0FBQ2xFLFNBQU8sTUFBTSxlQUFlLFlBQVksR0FBRyxxQkFBcUI7QUFDbEUsQ0FBQztBQUtELElBQU0sU0FBUyxFQUFFLE9BQU8sR0FBRyxLQUFLLElBQVE7QUFDeEMsSUFBTSxPQUFPO0FBQUEsRUFDWCxFQUFFLE9BQU8sR0FBRyxLQUFLLEtBQVEsTUFBTSxTQUFTO0FBQUEsRUFDeEMsRUFBRSxPQUFPLEtBQVEsS0FBSyxLQUFRLE1BQU0sVUFBVTtBQUNoRDtBQUVBLEtBQUssK0VBQStFLE1BQU07QUFDeEYsU0FBTyxVQUFVLGNBQWMsTUFBTSxPQUFPLE9BQU8sT0FBTyxLQUFLLEdBQU0sR0FBRyxFQUFFLE9BQU8sR0FBRyxNQUFNLFVBQVUsT0FBTyxHQUFHLEtBQUssSUFBTyxDQUFDO0FBQzNILFNBQU8sVUFBVSxjQUFjLE1BQU0sT0FBTyxPQUFPLE9BQU8sS0FBSyxJQUFNLEdBQUcsRUFBRSxPQUFPLEdBQUcsTUFBTSxXQUFXLE9BQU8sS0FBUSxLQUFLLElBQU8sQ0FBQztBQUNuSSxDQUFDO0FBRUQsS0FBSyxpRkFBaUYsTUFBTTtBQUMxRixTQUFPLE1BQU0sY0FBYyxNQUFNLE9BQU8sT0FBTyxPQUFPLEtBQUssSUFBTSxHQUFHLElBQUk7QUFDeEUsU0FBTyxNQUFNLGNBQWMsTUFBTSxPQUFPLE9BQU8sT0FBTyxLQUFLLEVBQUUsR0FBRyxJQUFJO0FBQ3BFLFNBQU8sTUFBTSxjQUFjLENBQUMsR0FBRyxPQUFPLE9BQU8sT0FBTyxLQUFLLEVBQUUsR0FBRyxJQUFJO0FBQ2xFLFNBQU8sTUFBTSxjQUFjLE1BQU0sT0FBTyxPQUFPLE9BQU8sS0FBSyxFQUFFLEdBQUcsSUFBSTtBQUNwRSxTQUFPLE1BQU0sY0FBYyxRQUFXLE9BQU8sT0FBTyxPQUFPLEtBQUssRUFBRSxHQUFHLElBQUk7QUFDM0UsQ0FBQztBQUVELEtBQUssMEZBQXFGLE1BQU07QUFDOUYsU0FBTyxNQUFNLGNBQWMsTUFBTSxPQUFPLE9BQU8sT0FBTyxLQUFLLEdBQU0sR0FBRyxNQUFNLFNBQVM7QUFFbkYsU0FBTyxNQUFNLGNBQWMsTUFBTSxPQUFPLE9BQU8sT0FBTyxLQUFLLEdBQU0sR0FBRyxJQUFJO0FBQzFFLENBQUM7QUFFRCxLQUFLLHdFQUF3RSxNQUFNO0FBQ2pGLFFBQU0sY0FBYztBQUFBLElBQ2xCLEVBQUUsT0FBTyxHQUFHLEtBQUssS0FBUSxNQUFNLE1BQU07QUFBQSxJQUNyQyxFQUFFLE9BQU8sS0FBUSxLQUFLLEtBQVMsTUFBTSxVQUFVO0FBQUEsRUFDakQ7QUFDQSxTQUFPLE1BQU0sY0FBYyxhQUFhLE9BQU8sT0FBTyxPQUFPLEtBQUssR0FBTSxHQUFHLE1BQU0sU0FBUztBQUMxRixTQUFPLE1BQU0sY0FBYyxhQUFhLE9BQU8sT0FBTyxPQUFPLEtBQUssR0FBTSxHQUFHLE1BQU0sS0FBSztBQUN4RixDQUFDO0FBRUQsS0FBSyx5RkFBMEYsTUFBTTtBQUNuRyxRQUFNLE9BQU8sQ0FBQyxFQUFFLE9BQU8sS0FBUSxLQUFLLE1BQU0sTUFBTSxVQUFVLENBQUM7QUFDM0QsU0FBTyxVQUFVLGNBQWMsTUFBTSxPQUFPLE9BQU8sT0FBTyxLQUFLLElBQU0sR0FBRyxFQUFFLE9BQU8sR0FBRyxNQUFNLFdBQVcsT0FBTyxLQUFRLEtBQUssSUFBUSxDQUFDO0FBRWxJLFNBQU8sTUFBTSxjQUFjLE1BQU0sT0FBTyxPQUFPLE9BQU8sS0FBSyxHQUFPLEdBQUcsTUFBTSxTQUFTO0FBQ3BGLFNBQU8sTUFBTSxjQUFjLE1BQU0sT0FBTyxPQUFPLE9BQU8sS0FBSyxNQUFPLEdBQUcsSUFBSTtBQUMzRSxDQUFDO0FBRUQsS0FBSyw0R0FBdUcsTUFBTTtBQUNoSCxRQUFNLE9BQU87QUFBQSxJQUNYLEVBQUUsT0FBTyxNQUFTLEtBQUssS0FBUSxNQUFNLFNBQVM7QUFBQSxJQUM5QyxFQUFFLE9BQU8sS0FBUSxLQUFLLEtBQVMsTUFBTSxVQUFVO0FBQUE7QUFBQSxJQUMvQyxFQUFFLE9BQU8sTUFBUyxLQUFLLE1BQVMsTUFBTSxNQUFNO0FBQUE7QUFBQSxFQUM5QztBQUNBLFNBQU8sVUFBVSxjQUFjLE1BQU0sT0FBTyxPQUFPLE9BQU8sS0FBSyxHQUFLLEdBQUcsRUFBRSxPQUFPLEdBQUcsTUFBTSxVQUFVLE9BQU8sR0FBRyxLQUFLLElBQU8sQ0FBQztBQUMxSCxTQUFPLFVBQVUsY0FBYyxNQUFNLE9BQU8sT0FBTyxPQUFPLEtBQUssSUFBTSxHQUFHLEVBQUUsT0FBTyxHQUFHLE1BQU0sV0FBVyxPQUFPLEtBQVEsS0FBSyxJQUFRLENBQUM7QUFDbEksU0FBTyxNQUFNLGNBQWMsTUFBTSxPQUFPLE9BQU8sT0FBTyxLQUFLLEdBQU0sR0FBRyxJQUFJO0FBQzFFLENBQUM7QUFFRCxLQUFLLHVFQUF1RSxNQUFNO0FBQ2hGLFFBQU0sT0FBTyxDQUFDLEVBQUUsT0FBTyxvQkFBSSxLQUFLLEdBQU0sR0FBRyxLQUFLLG9CQUFJLEtBQUssR0FBTSxHQUFHLE1BQU0sVUFBVSxDQUFDO0FBQ2pGLFNBQU8sTUFBTSxjQUFjLE1BQU0sT0FBTyxPQUFPLE9BQU8sS0FBSyxJQUFNLEdBQUcsT0FBTyxDQUFDO0FBQzlFLENBQUM7QUFJRCxLQUFLLHVFQUF1RSxNQUFNO0FBQ2hGLFNBQU8sVUFBVSxZQUFZLEdBQUcsR0FBTyxHQUFHLEVBQUUsT0FBTyxNQUFRLEtBQUssTUFBUSxDQUFDO0FBQ3pFLFNBQU8sVUFBVSxZQUFZLEdBQUcsS0FBUyxHQUFHLEdBQUcsRUFBRSxPQUFPLE1BQVMsS0FBSyxLQUFRLENBQUM7QUFDL0UsU0FBTyxVQUFVLFlBQVksR0FBRyxLQUFTLENBQUMsR0FBRyxFQUFFLE9BQU8sR0FBRyxLQUFLLElBQVEsQ0FBQztBQUN2RSxTQUFPLFVBQVUsWUFBWSxHQUFHLGFBQWEsQ0FBQyxHQUFHLEVBQUUsT0FBTyxHQUFHLEtBQUssWUFBWSxDQUFDO0FBQ2pGLENBQUM7QUFFRCxLQUFLLHNFQUFzRSxNQUFNO0FBRS9FLFNBQU8sVUFBVSxZQUFZLEdBQUcsR0FBRyxHQUFHLEVBQUUsT0FBTyxNQUFNLGNBQWMsR0FBRyxLQUFLLE1BQU0sY0FBYyxFQUFFLENBQUM7QUFDbEcsU0FBTyxVQUFVLFlBQVksS0FBTyxHQUFLLEdBQUcsRUFBRSxPQUFPLE1BQVEsY0FBYyxHQUFHLEtBQUssTUFBUSxjQUFjLEVBQUUsQ0FBQztBQUM5RyxDQUFDO0FBRUQsS0FBSyxrRkFBa0YsTUFBTTtBQUMzRixTQUFPLFVBQVUsWUFBWSxLQUFTLENBQUMsR0FBRyxZQUFZLEdBQUcsR0FBTyxDQUFDO0FBQ2pFLFNBQU8sVUFBVSxZQUFZLG9CQUFJLEtBQUssQ0FBQyxHQUFHLG9CQUFJLEtBQUssR0FBTyxHQUFHLElBQUksR0FBRyxFQUFFLE9BQU8sTUFBUSxLQUFLLE1BQVEsQ0FBQztBQUNuRyxTQUFPLFVBQVUsWUFBWSxHQUFHLEtBQVMsRUFBRSxHQUFHLFlBQVksR0FBRyxLQUFTLElBQUksQ0FBQztBQUMzRSxTQUFPLFVBQVUsWUFBWSxHQUFHLEtBQVMsT0FBTyxHQUFHLEdBQUcsWUFBWSxHQUFHLEtBQVMsSUFBSSxDQUFDO0FBQ3JGLENBQUM7IiwKICAibmFtZXMiOiBbInMiLCAibCIsICJ0Il0KfQo=
