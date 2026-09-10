/**
 * Gallery section: <perf-graph>.
 *
 * Three treatments the happy path hides: the full HUD (label, value,
 * stats row, tick labels, a budget line the autoscale must keep in view),
 * a COMPACT strip of five gauges in one row (the shape a table cell gets,
 * where one text row is all the room there is), and a fixed 0-100 scale
 * next to an autoscaled one fed the same samples, so a scale bug shows as
 * a difference between two pictures. The feed is a pure function of time,
 * so a reload draws the same history.
 */

// SIDE-EFFECT IMPORT — registers <perf-graph>; every other reference below
// is a type position and a type-only import is elided.
import '../src/ui/perf-graph.ts';
import type { PerfGraphElement } from '../src/ui/perf-graph.ts';

const COMPACT = ['cpu', 'ram', 'disk', 'net', 'gpu'];

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
  // Seed a full history so the page never opens on a blank trace.
  let step = 0;
  const feed = (): void => {
    step++;
    full?.push(12 + 8 * Math.sin(step / 9) + (step % 47 === 0 ? 30 : 0));
    const v = sample(0, step);
    fixed?.push(v);
    auto?.push(v);
    COMPACT.forEach((name, i) => graph(`demo-perf-${name}`)?.push(sample(i, step)));
  };
  for (let i = 0; i < 240; i++) feed();
  if (empty) empty.clear();
  setInterval(feed, 250);
}
