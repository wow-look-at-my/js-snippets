// Gallery wiring. This file owns the <timeline-view> section (the live,
// clock-driven one) and mounts the rest from their own modules, so no
// single file becomes the place every component's demo accretes.
//
// WHY THE GALLERY EXISTS: these components are DOM-bound and therefore NOT
// node-tested — their pure halves are, but nothing under `node --test` ever
// renders one. This page is where they are actually exercised, and it
// publishes per branch, so a change is verifiable from a real URL before it
// merges. A new component in src/ui/ gets a section here; that is the
// contract, not a nicety (see CLAUDE.md, "Showcase").
//
// Two <timeline-view> instances fed by the deterministic fake generator in
// ./fake-data.ts. The page adds NOTHING interactive of its own —
// pan/zoom/hover/click/fullscreen are the component's — it only feeds data
// on the real advancing clock and prunes so a day-long tab stays lean.
//
// Feature-detection: everything here targets the component API on THIS
// branch's ../src/ui. Post-#39 extras (the legend's consumer rows, the
// built-in 'cancelled' style) are detected at runtime, so the same page
// builds and runs before and after that PR lands — the new visuals simply
// light up once the bundled component has them.

import {
  DEFAULT_STYLES,
  TimelineViewElement,
  formatDuration,
  toMs,
  type StyleMap,
  type TimelineHit,
} from '../src/ui/timeline-view.ts';
import { LANES, batchForRange, type RunPlan } from './fake-data.ts';
import { mountActivityFeedDemo } from './activity-feed-demo.ts';
import { mountDataTableDemo } from './data-table-demo.ts';
import PAGE_CSS from './page.css';

// Adopt the page stylesheet (imported as text — see the note in index.html).
document.head.append(Object.assign(document.createElement('style'), { textContent: PAGE_CSS }));

// The static sections. Both take `now` so their fixtures are stamped once,
// from one clock, instead of drifting between sections on a slow load.
// Mounted BEFORE the timeline's live feed starts: they are one-shot, and a
// component that never upgrades must not take the rest of the page with it.
{
  const now = Date.now();
  mountDataTableDemo(now);
  mountActivityFeedDemo(now);
}

const SEC = 1_000;
const MIN = 60_000;

/** Live merge window: pruned/reset span kept in memory while following. */
const KEEP_MS = 30 * MIN;
/** History pre-rolled at boot (older loads lazily via loadRange). */
const PREROLL_MS = 20 * MIN;
/** Lazy history exists this far back, then the end-of-history boundary shows. */
const FLOOR_MS = 3 * 60 * MIN;
const TICK_MS = 1 * SEC;
const PRUNE_EVERY_MS = 5 * MIN;

const main = document.getElementById('main') as TimelineViewElement;
const mini = document.getElementById('mini') as TimelineViewElement;
const els: TimelineViewElement[] = [main, mini];

// -- Styles: consumer style-map keys on top of the built-ins ---------------------

const styles: StyleMap = {
  // A consumer-defined terminal treatment: like 'failed' but with a dashed
  // emphasis border, used by the fan-out and retry lanes' timed-out runs.
  timeout: { pattern: 'stipple', border: { width: 2, emphasis: true, dash: [5, 3] }, glyph: 'bang' },
};
if (!('cancelled' in DEFAULT_STYLES)) {
  // Pre-#39 components have no built-in 'cancelled' treatment — register a
  // matching consumer style so the canary lane reads the same either way.
  styles['cancelled'] = { pattern: 'outline', border: { width: 1.5, dash: [4, 3] } };
}
for (const el of els) el.styles = styles;

// -- Legend: consumer rows for the glyphs the FEED composes into labels ----------

const LEGEND = [
  { glyph: '⧗', text: 'queued in a concurrency group — "⧗ model-gateway · 3rd" = third in line' },
  { glyph: '⏳2', text: 'this run holds the slot/lock that 2 queued runs are waiting on' },
];
for (const el of els) {
  if ('legendEntries' in el) {
    (el as unknown as { legendEntries: typeof LEGEND }).legendEntries = LEGEND;
  }
}

// -- Tooltip: multi-line detail, incl. long wrapped error lines ------------------

function tooltipFor(hit: TimelineHit): string | Node | null {
  if (hit.type === 'interval') {
    const iv = hit.interval;
    const run = iv.data as RunPlan | undefined;
    const box = document.createElement('div');
    const add = (text: string): void => {
      const d = document.createElement('div');
      d.textContent = text;
      box.append(d);
    };
    const start = toMs(iv.start);
    const end = iv.end == null ? null : toMs(iv.end);
    add(iv.label || iv.id);
    add(`lane: ${hit.lane.label}`);
    if (end === start) {
      add(`instant · ${new Date(start).toLocaleTimeString()}`);
    } else {
      const status = end == null ? 'running' : run?.finalState ? run.finalState : 'success';
      add(`${status} · started ${new Date(start).toLocaleTimeString()} · ${formatDuration((end ?? Date.now()) - start)}`);
    }
    if (run?.tooltipError && (end != null || run.finalState === 'cancelled')) add(run.tooltipError);
    return box;
  }
  if (hit.type === 'connector') return hit.connector.label ?? hit.connector.kind ?? 'connector';
  if (hit.type === 'marker') return hit.marker.label ?? null;
  return `${hit.lane.label} — synthetic demo feed`;
}
for (const el of els) el.tooltipFor = tooltipFor;

// -- The feed ---------------------------------------------------------------------

const boot = Date.now();
const floor = boot - FLOOR_MS;
let lastTick = boot;

function feed(el: TimelineViewElement, t0: number, now: number, reset: boolean): void {
  const b = batchForRange(t0, now, now);
  const payload = {
    lanes: LANES,
    intervals: b.intervals,
    connectors: b.connectors,
    markers: b.markers,
    coverage: { start: t0, end: now },
  };
  if (reset) el.setData(payload);
  else el.mergeData(payload);
}

// Boot: pre-roll recent history so the default view is already populated.
for (const el of els) feed(el, boot - PREROLL_MS, boot, true);

// Live tick: re-snapshot every run overlapping the recent window. Plans are
// pure functions of absolute time, so a throttled/late tick (hidden tab)
// self-heals — the next merge re-emits every affected run in final form.
setInterval(() => {
  const now = Date.now();
  const t0 = Math.max(lastTick - 5 * SEC, now - KEEP_MS);
  for (const el of els) feed(el, t0, now, false);
  lastTick = now;
}, TICK_MS);

// Lazy backward history: generated on demand, deterministic, with a hard
// floor so the component's end-of-history boundary has something to show.
for (const el of els) {
  el.loadRange = async (start, end) => {
    if (end <= floor) return { exhausted: true };
    // A believable fetch delay so the uncovered-region treatment is visible.
    await new Promise((r) => setTimeout(r, 120));
    const s = Math.max(start, floor);
    const now = Date.now();
    const b = batchForRange(s, end, now);
    el.mergeData({
      intervals: b.intervals,
      connectors: b.connectors,
      markers: b.markers,
      coverage: { start: s, end },
    });
    return start <= floor ? { exhausted: true } : undefined;
  };
}

// Prune: while following, periodically reset to the recent window so the
// merged set can't grow without bound in a long-lived tab. History the user
// pans back to simply re-loads through loadRange — same bytes, same ids.
setInterval(() => {
  const now = Date.now();
  for (const el of els) {
    if (el.followNow) feed(el, now - KEEP_MS, now, true);
  }
}, PRUNE_EVERY_MS);

// Hidden-tab recovery: timers throttle while hidden, so on return do one
// full resync (the documented stale-recovery path) when following, else a
// plain catch-up merge.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  for (const el of els) {
    if (el.followNow) feed(el, now - KEEP_MS, now, true);
    else feed(el, Math.max(lastTick - 5 * SEC, now - KEEP_MS), now, false);
  }
  lastTick = now;
});
