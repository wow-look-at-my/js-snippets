// Fake, local, infinite run feed for the <timeline-view> showcase.
//
// Every run is a PURE FUNCTION OF ABSOLUTE TIME: each lane repeats a fixed
// period, and the k-th cycle's shape (jitter, durations, outcome, labels)
// comes from a PRNG seeded on (lane, k). The same (lane, k) always yields the
// same run, so the live ticker, the lazy `loadRange` history loader, and a
// post-hiccup resync all agree byte-for-byte — the feed can be regenerated
// for any time range, at any time, forever. No network, no state.
//
// The lane roster is arranged so every visual treatment of the chart is on
// screen somewhere at the default ~15-minute span:
//   builds   — queued dim lead-ins, mid-run declared waits, successes+failures
//   gateway  — concurrency-group waits: hatched ⧗ "group · Nth" queuers and a
//              ⏳N holder label, overlapping bars (sub-track packing)
//   canary   — cancelled runs with kill tails of cycling sizes (incl. sub-4px)
//   nightly  — one ~40-minute ongoing span that crosses the viewport edges
//   skips    — bursts of zero-duration instants (cluster → split on zoom)
//              plus a lone probe pip on its own category hue
//   fanout   — periodic 5-9-wide bursts exercising lane packing, with a
//              'timeout' consumer style and the odd failure
//   retry    — timeout → retry chains linked by connectors

import type {
  TimelineConnector,
  TimelineInterval,
  TimelineLane,
  TimelineMarker,
  TimelineSegment,
} from '../src/ui/timeline-view-math.ts';

export type Rand = () => number;

/** Integer mix of (seed, k) — the per-cycle PRNG seed. */
function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b1, 0x85ebca77) ^ Math.imul(b ^ 0x165667b1, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h = Math.imul(h ^ (h >>> 13), 0xcaf649a9);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Tiny deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cycle index 0 anchor — keeps k small so integer hashing stays well mixed. */
const EPOCH0 = Date.UTC(2026, 0, 1);

const SEC = 1_000;
const MIN = 60_000;

interface Phase {
  start: number;
  end: number;
  kind: string; // style-map key: 'queued' | 'waiting' | 'outline' | …
}

/** A fully decided run: the plan never changes, only its snapshot-at-now does. */
export interface RunPlan {
  id: string;
  laneId: string;
  start: number;
  /** Final end. Instants have end === start. */
  end: number;
  /** Terminal style key ('' success, 'failed', 'timeout', 'cancelled'). */
  finalState: string;
  /** Label once finished. */
  label: string;
  /** Label while ongoing: first entry with now < until wins (else `label`). */
  liveLabels?: [until: number, label: string][];
  /** Ordered phases within [start, end]; gaps render as the base style. */
  phases?: Phase[];
  category?: string;
  instant?: boolean;
  /** Long human-readable failure detail for the tooltip. */
  tooltipError?: string;
}

type PlanConnector = TimelineConnector & { visibleFrom: number };

interface CycleOut {
  plans: RunPlan[];
  connectors?: PlanConnector[];
}

interface LaneSpec {
  lane: TimelineLane;
  period: number;
  /** No run of cycle k extends past base + maxSpan (enumeration margin). */
  maxSpan: number;
  seed: number;
  cycle: (base: number, k: number, rnd: Rand) => CycleOut;
}

const between = (rnd: Rand, lo: number, hi: number): number => lo + rnd() * (hi - lo);

// -- Lane cycle generators -----------------------------------------------------

const builds: LaneSpec = {
  lane: { id: 'builds', label: 'ci · build-matrix' },
  period: 100 * SEC,
  maxSpan: 110 * SEC,
  seed: 0xb111d5,
  cycle: (base, k, rnd) => {
    const start = base + between(rnd, 0, 12 * SEC);
    const queue = between(rnd, 4 * SEC, 14 * SEC);
    const run = between(rnd, 40 * SEC, 75 * SEC);
    const end = start + queue + run;
    const phases: Phase[] = [{ start, end: start + queue, kind: 'queued' }];
    if (k % 4 === 1) {
      // A declared mid-run wait (the hatched "sleeping: settle window" phase).
      const w0 = start + queue + run * 0.35;
      phases.push({ start: w0, end: w0 + between(rnd, 10 * SEC, 18 * SEC), kind: 'waiting' });
    }
    const failed = rnd() < 0.22;
    return {
      plans: [
        {
          id: `builds:${k}`,
          laneId: 'builds',
          start,
          end,
          finalState: failed ? 'failed' : '',
          label: `build #${4200 + k}`,
          phases,
          tooltipError: failed
            ? `Error: job "test (ubuntu-latest, node22)" exited 1 — FAIL src/ui/timeline-view-math.test.ts: packVisibleTracks stacked 7 overlapping intervals onto 6 tracks (expected 7); see the run log for the full diff`
            : undefined,
        },
      ],
    };
  },
};

const gateway: LaneSpec = {
  lane: { id: 'gateway', label: 'model-gateway' },
  period: 150 * SEC,
  maxSpan: 210 * SEC,
  seed: 0x6a7e,
  cycle: (base, k, rnd) => {
    const plans: RunPlan[] = [];
    const hasThird = k % 3 === 0;
    const pr = 100 + ((k * 3) % 890); // pretty, cycling PR numbers (ids stay k-unique)
    const aStart = base + between(rnd, 0, 8 * SEC);
    const aEnd = aStart + between(rnd, 75 * SEC, 105 * SEC);
    plans.push({
      id: `gateway:${k}:a`,
      laneId: 'gateway',
      start: aStart,
      end: aEnd,
      finalState: '',
      label: `describe webhooks#${pr}`,
      liveLabels: [[Infinity, `describe webhooks#${pr} · ⏳${hasThird ? 2 : 1}`]],
    });
    const bStart = aStart + 8 * SEC;
    const bEnd = aEnd + between(rnd, 30 * SEC, 55 * SEC);
    const bFailed = rnd() < 0.15;
    plans.push({
      id: `gateway:${k}:b`,
      laneId: 'gateway',
      start: bStart,
      end: bEnd,
      finalState: bFailed ? 'failed' : '',
      label: `resolve webhooks#${pr + 1}`,
      liveLabels: [
        [aEnd, `resolve webhooks#${pr + 1} · ⧗ model-gateway · 2nd`],
        [Infinity, `resolve webhooks#${pr + 1}${hasThird ? ' · ⏳1' : ''}`],
      ],
      phases: [{ start: bStart, end: aEnd, kind: 'waiting' }],
      tooltipError: bFailed
        ? `Error: merge conflict resolution gave up — resolve edit no longer matched HEAD after 3 restarts (src/state.ts churned mid-run); a human must take over`
        : undefined,
    });
    if (hasThird) {
      const cStart = aStart + 20 * SEC;
      const cEnd = bEnd + between(rnd, 25 * SEC, 40 * SEC);
      plans.push({
        id: `gateway:${k}:c`,
        laneId: 'gateway',
        start: cStart,
        end: cEnd,
        finalState: '',
        label: `describe webhooks#${pr + 2}`,
        liveLabels: [[bEnd, `describe webhooks#${pr + 2} · ⧗ model-gateway · 3rd`], [Infinity, `describe webhooks#${pr + 2}`]],
        phases: [{ start: cStart, end: bEnd, kind: 'waiting' }],
      });
    }
    return { plans };
  },
};

// Kill-tail sizes cycle so some tails are sub-4px at the default span
// (scrim-only terminal cuts) and some are wide enough to read.
const CANARY_TAILS = [1.2 * SEC, 3 * SEC, 10 * SEC, 26 * SEC];

const canary: LaneSpec = {
  lane: { id: 'canary', label: 'canary · kill-switch' },
  period: 160 * SEC,
  maxSpan: 130 * SEC,
  seed: 0xca9a2b,
  cycle: (base, k, rnd) => {
    const start = base + between(rnd, 0, 10 * SEC);
    const body = between(rnd, 55 * SEC, 90 * SEC);
    const cancelAt = start + body * between(rnd, 0.55, 0.8);
    const end = cancelAt + CANARY_TAILS[k % CANARY_TAILS.length];
    return {
      plans: [
        {
          id: `canary:${k}`,
          laneId: 'canary',
          start,
          end,
          finalState: 'cancelled',
          label: `canary #${(k % 97) + 1}`,
          liveLabels: [
            [cancelAt, `canary #${(k % 97) + 1}`],
            [Infinity, `canary #${(k % 97) + 1} · cancelling…`],
          ],
          phases: [{ start: cancelAt, end, kind: 'outline' }],
          tooltipError: `cancelled: lock "deploy:prod" stolen by run ${(hash2(k, 7) % 100000).toString(36)} — newest event wins; the displaced evaluation was stale`,
        },
      ],
    };
  },
};

const nightly: LaneSpec = {
  lane: { id: 'nightly', label: 'nightly · fleet-sweep' },
  period: 45 * MIN,
  maxSpan: 42 * MIN,
  seed: 0x9169711,
  cycle: (base, k, rnd) => {
    const start = base + between(rnd, 0, 2 * MIN);
    const end = start + 40 * MIN;
    // Alternate quiet work (base style) with hatched declared waits.
    const phases: Phase[] = [];
    let t = start + between(rnd, 3 * MIN, 5 * MIN);
    while (t < end - 2 * MIN) {
      const pause = between(rnd, 45 * SEC, 75 * SEC);
      phases.push({ start: t, end: Math.min(t + pause, end), kind: 'waiting' });
      t += pause + between(rnd, 4 * MIN, 6 * MIN);
    }
    return {
      plans: [
        {
          id: `nightly:${k}`,
          laneId: 'nightly',
          start,
          end,
          finalState: '',
          label: `fleet sweep · shard ${(k % 24) + 1}/24`,
          phases,
        },
      ],
    };
  },
};

const skips: LaneSpec = {
  lane: { id: 'skips', label: 'webhooks · skip_if' },
  period: 90 * SEC,
  maxSpan: 80 * SEC,
  seed: 0x5c1b5,
  cycle: (base, k, rnd) => {
    const plans: RunPlan[] = [];
    // A burst of provably-ignorable deliveries, dropped before a container
    // boots — several instants within a few seconds (clusters at wide zoom).
    const n = 4 + Math.floor(rnd() * 9);
    let t = base + between(rnd, 0, 6 * SEC);
    for (let j = 0; j < n; j++) {
      t += between(rnd, 0.3 * SEC, 2.2 * SEC);
      plans.push({
        id: `skips:${k}:${j}`,
        laneId: 'skips',
        start: t,
        end: t,
        finalState: '',
        label: `skipped: skip_if[${j % 3}]`,
        instant: true,
      });
    }
    // A lone probe pip between bursts, on its own category hue.
    const p = base + 45 * SEC + between(rnd, 0, 8 * SEC);
    plans.push({
      id: `skips:${k}:probe`,
      laneId: 'skips',
      start: p,
      end: p,
      finalState: '',
      label: 'health probe',
      category: 'probe',
      instant: true,
    });
    return { plans };
  },
};

const fanout: LaneSpec = {
  lane: { id: 'fanout', label: 'batch · fan-out' },
  period: 200 * SEC,
  maxSpan: 120 * SEC,
  seed: 0xfa9007,
  cycle: (base, k, rnd) => {
    const plans: RunPlan[] = [];
    const n = 4 + Math.floor(rnd() * 3);
    const s0 = base + between(rnd, 0, 8 * SEC);
    for (let j = 0; j < n; j++) {
      const start = s0 + j * 2.8 * SEC + between(rnd, 0, 1.5 * SEC);
      const dur = between(rnd, 22 * SEC, 55 * SEC);
      const timedOut = j === 2;
      const failed = !timedOut && rnd() < 0.15;
      const end = start + (timedOut ? Math.min(dur, 30 * SEC) : dur);
      plans.push({
        id: `fanout:${k}:${j}`,
        laneId: 'fanout',
        start,
        end,
        finalState: timedOut ? 'timeout' : failed ? 'failed' : '',
        label: `shard ${j + 1}/${n}`,
        tooltipError: timedOut
          ? `timed out after 30s (no output) — the map-reduce part kept streaming tokens but wrote none to stdout; idle watchdog killed the container (docker kill whr-run-${(hash2(k, j) % 1e6).toString(36)})`
          : failed
            ? `Error: shard input chunk ${j + 1} failed schema validation: unexpected key "retry_cooldown" (removed by operator directive — attempts are count-capped, never time-parked)`
            : undefined,
      });
    }
    return { plans };
  },
};

const retry: LaneSpec = {
  lane: { id: 'retry', label: 'deploy · retry-chain' },
  period: 170 * SEC,
  maxSpan: 160 * SEC,
  seed: 0x9e7291,
  cycle: (base, k, rnd) => {
    const plans: RunPlan[] = [];
    const connectors: PlanConnector[] = [];
    const longError = `Error: TTFT deadline exceeded (600s) waiting on ai-gateway/v1/chat/completions — no tokens for 120s mid-stream; retried with fixed cadence 3×, giving up. descfail:webhooks#${300 + k} attempt kept the marker until a new commit; see the run log for the full traceback.`;
    const a1s = base + between(rnd, 0, 10 * SEC);
    const a1e = a1s + between(rnd, 26 * SEC, 34 * SEC);
    plans.push({
      id: `retry:${k}:1`,
      laneId: 'retry',
      start: a1s,
      end: a1e,
      finalState: 'timeout',
      label: `deploy staging · try 1`,
      tooltipError: longError,
    });
    const a2s = a1e + between(rnd, 4 * SEC, 7 * SEC);
    const a2Failed = rnd() < 0.2;
    const a2e = a2s + between(rnd, 30 * SEC, 45 * SEC);
    plans.push({
      id: `retry:${k}:2`,
      laneId: 'retry',
      start: a2s,
      end: a2e,
      finalState: a2Failed ? 'failed' : '',
      label: `deploy staging · try 2`,
      tooltipError: a2Failed ? `Error: health check never went green — /healthz answered 503 for 40s after cutover, rolled back` : undefined,
    });
    connectors.push({
      fromIntervalId: `retry:${k}:1`,
      toIntervalId: `retry:${k}:2`,
      kind: 'retry',
      label: 'retry after timeout',
      visibleFrom: a2s,
    });
    if (a2Failed) {
      const a3s = a2e + between(rnd, 4 * SEC, 7 * SEC);
      plans.push({
        id: `retry:${k}:3`,
        laneId: 'retry',
        start: a3s,
        end: a3s + between(rnd, 25 * SEC, 35 * SEC),
        finalState: '',
        label: `deploy staging · try 3`,
      });
      connectors.push({
        fromIntervalId: `retry:${k}:2`,
        toIntervalId: `retry:${k}:3`,
        kind: 'retry',
        label: 'retry after failed health check',
        visibleFrom: a3s,
      });
    }
    return { plans, connectors };
  },
};

const LANE_SPECS: LaneSpec[] = [builds, gateway, canary, nightly, skips, fanout, retry];

/** The lane roster, in display order. */
export const LANES: TimelineLane[] = LANE_SPECS.map((s) => s.lane);

// -- Snapshots -------------------------------------------------------------------

/** Clip a decided plan to `now`: not-yet-started → null, running → ongoing form. */
export function snapshotRun(run: RunPlan, now: number): TimelineInterval | null {
  if (run.start > now) return null;
  const done = run.end <= now;
  let segments: TimelineSegment[] | undefined;
  if (run.phases?.length) {
    const segs: TimelineSegment[] = [];
    for (const p of run.phases) {
      if (!done && p.start > now) break; // future phase — not yet
      if (!done && p.end > now) {
        segs.push({ start: p.start, end: null, kind: p.kind }); // active phase, open
        break;
      }
      segs.push({ start: p.start, end: p.end, kind: p.kind });
    }
    if (segs.length) segments = segs;
  }
  const live = run.liveLabels?.find(([until]) => now < until)?.[1];
  return {
    id: run.id,
    laneId: run.laneId,
    start: run.start,
    end: done ? run.end : null,
    label: done ? run.label : (live ?? run.label),
    category: run.category,
    state: done ? run.finalState : '',
    segments,
    data: run,
  };
}

export interface FakeBatch {
  intervals: TimelineInterval[];
  connectors: TimelineConnector[];
  markers: TimelineMarker[];
}

/**
 * Everything intersecting [t0, t1], snapshot-clipped at `now`. Deterministic:
 * overlapping calls re-yield identical ids/objects, which mergeData dedupes.
 */
export function batchForRange(t0: number, t1: number, now: number): FakeBatch {
  const intervals: TimelineInterval[] = [];
  const connectors: TimelineConnector[] = [];
  const hi = Math.min(t1, now);
  for (const spec of LANE_SPECS) {
    const k0 = Math.ceil((t0 - EPOCH0 - spec.maxSpan) / spec.period);
    const k1 = Math.floor((hi - EPOCH0) / spec.period);
    for (let k = k0; k <= k1; k++) {
      const out = spec.cycle(EPOCH0 + k * spec.period, k, mulberry32(hash2(spec.seed, k)));
      for (const plan of out.plans) {
        if (plan.start > hi || plan.end < t0) continue;
        const iv = snapshotRun(plan, now);
        if (iv) intervals.push(iv);
      }
      for (const c of out.connectors ?? []) {
        if (c.visibleFrom > now) continue;
        connectors.push({
          fromIntervalId: c.fromIntervalId,
          toIntervalId: c.toIntervalId,
          kind: c.kind,
          label: c.label,
        });
      }
    }
  }
  return { intervals, connectors, markers: markersForRange(t0, t1, now) };
}

/** Deterministic vertical markers: a deploy every 5 min, a drill every 15. */
export function markersForRange(t0: number, t1: number, now: number): TimelineMarker[] {
  const out: TimelineMarker[] = [];
  const step = 5 * MIN;
  const hi = Math.min(t1, now);
  for (let m = Math.ceil(t0 / step) * step; m <= hi; m += step) {
    if (m % (15 * MIN) === 0) {
      out.push({ time: m, label: 'incident drill', kind: 'emphasis' });
    } else {
      out.push({ time: m, label: `deploy v2.${30 + (Math.floor(m / step) % 40)}` });
    }
  }
  return out;
}
