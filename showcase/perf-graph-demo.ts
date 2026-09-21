/**
 * Gallery section: <perf-graph>.
 *
 * Three treatments the happy path hides: the full HUD (label, value,
 * stats row, tick labels, a budget line the autoscale must keep in view),
 * a COMPACT strip of five gauges in one row (the shape a table cell gets,
 * where one text row is all the room there is), and a fixed 0-100 scale
 * next to an autoscaled one fed the same samples, so a scale bug shows as
 * a difference between two pictures. Then the STACKED bands: a dead band
 * that must keep its legend slot, a legend too long for the width, a band
 * that joins after the others already have history, the compact shape with
 * no legend at all and more samples than pixels, and a stacked graph with
 * its series set and no column pushed. The feed is a pure function of time,
 * so a reload draws the same history.
 */

// SIDE-EFFECT IMPORT — registers <perf-graph>; every other reference below
// is a type position and a type-only import is elided.
import '../src/ui/perf-graph.ts';
import type { PerfGraphElement } from '../src/ui/perf-graph.ts';

const COMPACT = ['cpu', 'ram', 'disk', 'net', 'gpu'];

/**
 * The stacked bands. 'gosmopolitan' never moves, so a zero-height band has to
 * keep its legend slot and its color; the last two names are long enough to
 * run the legend out of room.
 */
const PROJECTS = ['go-toolchain', 'go-s3-server', 'js-snippets', 'gosmopolitan', 'required-builds-manager'];
/** Joins late, to show a new band starting flat beside five with history. */
const LATE_PROJECT = 'webhook-runner';

/** Deterministic per-project rate at a time step. gosmopolitan stays at 0. */
function projectRate(name: string, index: number, step: number): number {
  if (name === 'gosmopolitan') return 0;
  const t = step / 20;
  return Math.max(0, 6 + 5 * Math.sin(t * 0.5 + index * 1.7) + 3 * Math.sin(t * 2.3 + index));
}

function column(names: readonly string[], step: number): Record<string, number> {
  const out: Record<string, number> = {};
  names.forEach((name, i) => {
    out[name] = projectRate(name, i, step);
  });
  return out;
}

/** Deterministic sample for a metric at a time step (no randomness). */
function sample(i: number, step: number): number {
  const t = step / 20;
  const base = 35 + 25 * Math.sin(t * 0.7 + i) + 10 * Math.sin(t * 3.1 + i * 2);
  const spike = step % (60 + i * 13) === 0 ? 40 : 0;
  return Math.max(0, Math.min(100, base + spike));
}

function graph(id: string): PerfGraphElement | null {
  return document.getElementById(id) as PerfGraphElement | null;
}

export function mountPerfGraphDemo(): void {
  const strip = document.getElementById('demo-perf-strip');
  if (strip) {
    for (const name of COMPACT) {
      const g = document.createElement('perf-graph');
      g.setAttribute('compact', '');
      g.setAttribute('label', name);
      g.setAttribute('unit', '%');
      g.setAttribute('min', '0');
      g.setAttribute('max', '100');
      g.setAttribute('history', '120');
      g.id = `demo-perf-${name}`;
      strip.append(g);
    }
  }
  const full = graph('demo-perf-full');
  const fixed = graph('demo-perf-fixed');
  const auto = graph('demo-perf-auto');
  const empty = graph('demo-perf-empty');
  const stacked = graph('demo-perf-stacked');
  const stackedCompact = graph('demo-perf-stacked-compact');
  const stackedEmpty = graph('demo-perf-stacked-empty');
  let names = PROJECTS;
  const specs = names.map((key) => ({ key }));
  if (stacked) stacked.series = specs;
  if (stackedCompact) stackedCompact.series = specs;
  // Set up with no column pushed: the bands exist and the graph reads empty.
  if (stackedEmpty) stackedEmpty.series = specs;

  // Seed a full history so the page never opens on a blank trace.
  let step = 0;
  const feed = (): void => {
    step++;
    full?.push(12 + 8 * Math.sin(step / 9) + (step % 47 === 0 ? 30 : 0));
    const v = sample(0, step);
    fixed?.push(v);
    auto?.push(v);
    COMPACT.forEach((name, i) => graph(`demo-perf-${name}`)?.push(sample(i, step)));
    const values = column(names, step);
    stacked?.pushSeries(values);
    stackedCompact?.pushSeries(values);
  };
  // The compact one keeps 4000 samples, and seeding it FULL is what puts the
  // binned path on screen: fewer samples than its capacity would leave the
  // trace hugging the right edge instead of spanning the width.
  for (let i = 0; i < 4000; i++) feed();
  if (empty) empty.clear();
  setInterval(feed, 250);

  // A project that appears mid-run: the five already drawn keep their history
  // and their colors, and the newcomer's band begins flat.
  setTimeout(() => {
    names = [...PROJECTS, LATE_PROJECT];
    const grown = names.map((key) => ({ key }));
    if (stacked) stacked.series = grown;
    if (stackedCompact) stackedCompact.series = grown;
  }, 6000);
}
