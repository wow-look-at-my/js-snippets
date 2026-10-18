/** Gallery section: <dag-view>. */

// SIDE-EFFECT IMPORT — this is what registers <dag-view>, and it must stay.
import '../src/ui/dag-view.ts';
import type { DagViewElement, DagNode, DagEdge, DagStyleMap, DagGroup } from '../src/ui/dag-view.ts';

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
  // A blocked node that says WHY: a long multi-line reason and a link. The tooltip and the selected-node panel must show all of it.
  {
    id: 'e2e',
    label: 'e2e',
    sublabel: 'playwright',
    category: 'verify',
    state: 'blocked',
    detail:
      'Blocked: the browser image has no Chromium for this architecture, so playwright cannot start from this branch.\n' +
      'Retry: when the runner image ships the arm64 browser bundle.\n' +
      'Note: the fix belongs in the base image, not in this pipeline.',
    href: '#dag-view',
  },
  { id: 'bundle', label: 'bundle', sublabel: 'esbuild', category: 'build', state: 'done' },
  { id: 'docs', label: 'docs', sublabel: 'typedoc', category: 'build', state: 'pending' },
  { id: 'sign', label: 'sign', sublabel: 'cosign', category: 'release', state: 'pending' },
  { id: 'publish', label: 'publish', sublabel: 'buildhost', category: 'release', state: 'pending' },
  { id: 'announce', label: 'announce', category: 'release', state: 'pending' },
  // A state string no style rule mentions: it must still draw as a normal.
  { id: 'audit', label: 'audit', sublabel: 'unknown state', category: 'verify', state: 'nobody-defined-this' },
  // No category at all: the hue falls back to the id, so the graph stays multi-colored instead of going one flat blue.
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
  { from: 'checkout', to: 'publish', label: 'provenance' },
  // Edges the graph cannot use. Both must be REPORTED in the notice strip, never silently dropped.
  { from: 'deps', to: 'a-node-that-does-not-exist' },
  { from: 'lint', to: 'lint' },
];

/** Services that each wait on the next. Somebody has to give. */
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

/**
 * A CI-fix board: PR threads, some with work running now. `working` and
 * `waiting-ci` are marked active by their style entries, `pr-41` by its
 * own field, and the rest are not active at all. The sheen must sweep only
 * the running boxes, each at its own offset, under every pattern.
 */
const ACTIVE_NODES: DagNode[] = [
  // Named links: an external one opens a new tab, a relative one stays here. The unsafe one must never render.
  {
    id: 'pr-12',
    label: 'fix flaky cache key',
    sublabel: 'go-s3-server',
    category: 'go-s3-server',
    state: 'working',
    href: '#dag-view',
    links: [
      { label: 'PR wow-look-at-my/go-s3-server#12', href: 'https://github.com/wow-look-at-my/go-s3-server/pull/12' },
      { label: 'worker run', href: '#run=demo-run-12' },
      { label: 'blocked by PR wow-look-at-my/webhooks#27', href: 'https://github.com/wow-look-at-my/webhooks/pull/27' },
      { label: 'never rendered', href: 'javascript:alert(1)' },
    ],
  },
  { id: 'pr-19', label: 'bump toolchain', sublabel: 'gosmopolitan', category: 'gosmopolitan', state: 'waiting-ci' },
  { id: 'pr-27', label: 'schema drift', sublabel: 'webhooks', category: 'webhooks', state: 'blocked' },
  { id: 'pr-33', label: 'wrap long labels', sublabel: 'js-snippets', category: 'js-snippets', state: 'waiting-ci' },
  { id: 'pr-41', label: 'retry on 502', sublabel: 'buildhost', category: 'buildhost', state: 'pending', active: true },
  { id: 'pr-45', label: 'green, idle', sublabel: 'slopfix', category: 'slopfix', state: 'fixed' },
];

const ACTIVE_EDGES: DagEdge[] = [
  { from: 'pr-12', to: 'pr-27', label: 'blocked-by' },
  { from: 'pr-19', to: 'pr-33' },
  { from: 'pr-33', to: 'pr-41' },
  { from: 'pr-45', to: 'pr-41' },
];

const ACTIVE_STYLES: DagStyleMap = {
  working: { pattern: 'solid', active: true },
  'waiting-ci': { pattern: 'outline', active: true },
  blocked: { pattern: 'hatch', emphasis: true },
  pending: { pattern: 'outline', dashed: true },
  fixed: { pattern: 'solid', dim: true },
};

/**Expanded, the members lay out in a box of their own and the edges reach
 * the members they name. */
const GROUP_NODES: DagNode[] = [
  { id: 'base-fix', label: 'fix the base branch', sublabel: 'webhooks', category: 'webhooks', state: 'working' },
  ...Array.from({ length: 12 }, (_, idx): DagNode => ({
    id: `pending-${idx + 1}`,
    label: `pending PR #${101 + idx}`,
    sublabel: ['slopfix', 'buildhost', 'webhooks', 'js-snippets'][idx % 4],
    category: ['slopfix', 'buildhost', 'webhooks', 'js-snippets'][idx % 4],
    state: 'pending',
    group: 'pending',
  })),
  { id: 'release', label: 'release train', sublabel: 'buildhost', category: 'buildhost', state: 'blocked' },
];

const GROUP_EDGES: DagEdge[] = [
  { from: 'base-fix', to: 'pending-2', label: 'unblocks' },
  { from: 'base-fix', to: 'pending-7' },
  { from: 'pending-4', to: 'release' },
  { from: 'pending-2', to: 'pending-3' },
];

const groupsFor = (collapsed: boolean): DagGroup[] => [{ id: 'pending', label: '12 pending PRs', collapsed }];

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
          ...(n.detail !== undefined ? [{ key: 'why', value: n.detail }] : []),
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
  const active = document.getElementById('demo-dag-active') as DagViewElement | null;
  if (active !== null) {
    active.styles = ACTIVE_STYLES;
    active.setData({ nodes: ACTIVE_NODES, edges: ACTIVE_EDGES });
  }
  for (const [id, collapsed] of [
    ['demo-dag-group-closed', true],
    ['demo-dag-group-open', false],
  ] as const) {
    const el = document.getElementById(id) as DagViewElement | null;
    if (el === null) continue;
    el.styles = STYLES;
    el.setData({ nodes: GROUP_NODES, edges: GROUP_EDGES, groups: groupsFor(collapsed) });
  }
  // The empty one is deliberately given nothing: an empty graph must say so.
  wire(document.getElementById('demo-dag-empty') as DagViewElement | null, [], []);
}
