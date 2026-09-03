/**
 * Gallery section: <dag-view>.
 *
 * The graph's layout is node-tested; the ELEMENT is not, because nothing
 * under `node --test` can paint a canvas. So this section exists to put the
 * treatments that are easy to get wrong on screen at once, rather than to
 * show a graph that happens to look tidy.
 *
 * Five instances, each carrying a case a happy-path graph hides:
 *
 *   - the build graph: categories, every node state in the style map, a
 *     long edge that must bend around two layers rather than cut through
 *     them, a label far too long for its box, and a wide fan-out layer.
 *   - the cyclic graph: three mutually-dependent services. A layered
 *     drawing has to break the cycle to draw anything at all, and the
 *     thing being verified here is that the broken edge is still DRAWN,
 *     still points the true way, and is announced in the notice strip.
 *   - the LR graph: the same data with the axes swapped, so an orientation
 *     bug shows up as a difference between two pictures on one page.
 *   - a retheme: the same graph under --dag-* custom properties.
 *   - the empty one: a graph with no data must say so, not look broken.
 */

// SIDE-EFFECT IMPORT — this is what registers <dag-view>, and it must stay.
// Every other use of the class below is a TYPE position, and a type-only
// import is ELIDED at compile time: without this line nothing evaluates the
// module, the element never upgrades, and the section sits on its light-DOM
// "loading…" line forever, with the build green throughout.
import '../src/ui/dag-view.ts';
import type { DagViewElement, DagNode, DagEdge, DagStyleMap } from '../src/ui/dag-view.ts';

/**
 * A build pipeline, hand-written rather than generated: every node here is
 * carrying a specific case, and a random fixture would lose them.
 */
const BUILD_NODES: DagNode[] = [
  { id: 'checkout', label: 'checkout', sublabel: 'actions/checkout', category: 'setup', state: 'done' },
  { id: 'deps', label: 'install deps', sublabel: 'pnpm install', category: 'setup', state: 'done' },
  { id: 'typecheck', label: 'typecheck', sublabel: 'tsc --noEmit', category: 'verify', state: 'done' },
  { id: 'lint', label: 'lint', sublabel: 'eslint', category: 'verify', state: 'done' },
  // A label nobody sized a box for. It must truncate with an ellipsis
  // inside its box, never spill through the side of it.
  {
    id: 'unit',
    label: 'unit tests for absolutely everything in the repository',
    sublabel: 'node --test',
    category: 'verify',
    state: 'failed',
  },
  { id: 'e2e', label: 'e2e', sublabel: 'playwright', category: 'verify', state: 'blocked' },
  { id: 'bundle', label: 'bundle', sublabel: 'esbuild', category: 'build', state: 'done' },
  { id: 'docs', label: 'docs', sublabel: 'typedoc', category: 'build', state: 'pending' },
  { id: 'sign', label: 'sign', sublabel: 'cosign', category: 'release', state: 'pending' },
  { id: 'publish', label: 'publish', sublabel: 'buildhost', category: 'release', state: 'pending' },
  { id: 'announce', label: 'announce', category: 'release', state: 'pending' },
  // A state string no style rule mentions: it must still draw as a normal,
  // readable node in its category color rather than a blank one.
  { id: 'audit', label: 'audit', sublabel: 'unknown state', category: 'verify', state: 'nobody-defined-this' },
  // No category at all: the hue falls back to the id, so the graph stays
  // multi-colored instead of going one flat blue.
  { id: 'cache-warm', label: 'cache warm' },
];

const BUILD_EDGES: DagEdge[] = [
  { from: 'checkout', to: 'deps' },
  { from: 'deps', to: 'typecheck' },
  { from: 'deps', to: 'lint' },
  { from: 'deps', to: 'unit' },
  { from: 'deps', to: 'audit' },
  { from: 'deps', to: 'cache-warm' },
  { from: 'typecheck', to: 'bundle' },
  { from: 'lint', to: 'bundle' },
  { from: 'unit', to: 'e2e' },
  { from: 'bundle', to: 'e2e' },
  { from: 'bundle', to: 'docs' },
  { from: 'bundle', to: 'sign' },
  { from: 'sign', to: 'publish' },
  { from: 'docs', to: 'publish' },
  { from: 'publish', to: 'announce' },
  // THE LONG EDGE: checkout sits on layer 0 and publish four layers below,
  // so this one has to bend around the layers between rather than cut a
  // chord across the drawing.
  { from: 'checkout', to: 'publish', label: 'provenance' },
  // Two edges the graph cannot use. Both must be REPORTED in the notice
  // strip, never silently dropped.
  { from: 'deps', to: 'a-node-that-does-not-exist' },
  { from: 'lint', to: 'lint' },
];

/** Three services that each wait on the next. Somebody has to give. */
const CYCLE_NODES: DagNode[] = [
  { id: 'api', label: 'api', sublabel: 'waits on auth', category: 'service' },
  { id: 'auth', label: 'auth', sublabel: 'waits on session', category: 'service' },
  { id: 'session', label: 'session', sublabel: 'waits on api', category: 'service' },
  { id: 'gateway', label: 'gateway', category: 'edge' },
];

const CYCLE_EDGES: DagEdge[] = [
  { from: 'gateway', to: 'api' },
  { from: 'api', to: 'auth' },
  { from: 'auth', to: 'session' },
  { from: 'session', to: 'api', label: 'the cycle' },
];

/** Extra treatments on top of the built-in states. */
const STYLES: DagStyleMap = {
  blocked: { pattern: 'hatch', emphasis: true },
  failed: { pattern: 'stipple', emphasis: true },
  pending: { pattern: 'outline', dashed: true },
};

function wire(el: DagViewElement | null, nodes: DagNode[], edges: DagEdge[]): void {
  if (el === null) return;
  el.styles = STYLES;
  el.setData({ nodes, edges });
}

export function mountDagViewDemo(): void {
  const main = document.getElementById('demo-dag') as DagViewElement | null;
  wire(main, BUILD_NODES, BUILD_EDGES);
  if (main !== null) {
    main.tooltipFor = (hit) => {
      if (hit.type === 'edge') return null; // fall through to nothing for edges
      const n = hit.node;
      return {
        title: n.label ?? n.id,
        rows: [
          { key: 'step', value: n.id },
          { key: 'runs', value: n.sublabel ?? '—' },
          { key: 'state', value: n.state ?? 'unset' },
        ],
      };
    };
    const readout = document.getElementById('demo-dag-click');
    main.addEventListener('nodeclick', (e) => {
      const detail = (e as CustomEvent<{ node: DagNode }>).detail;
      if (readout !== null) readout.textContent = `nodeclick: ${detail.node.id}`;
    });
    main.addEventListener('layoutchange', (e) => {
      const info = (e as CustomEvent<{ crossings: number; criticalPath: number; nodeCount: number }>).detail;
      const out = document.getElementById('demo-dag-info');
      if (out !== null) {
        out.textContent = `${info.nodeCount} nodes · longest chain ${info.criticalPath} · ${info.crossings} crossings`;
      }
    });
  }

  wire(document.getElementById('demo-dag-cycle') as DagViewElement | null, CYCLE_NODES, CYCLE_EDGES);
  wire(document.getElementById('demo-dag-lr') as DagViewElement | null, BUILD_NODES, BUILD_EDGES);
  wire(document.getElementById('demo-dag-theme') as DagViewElement | null, BUILD_NODES, BUILD_EDGES);
  // The empty one is deliberately given nothing: an empty graph must say so.
  wire(document.getElementById('demo-dag-empty') as DagViewElement | null, [], []);
}
