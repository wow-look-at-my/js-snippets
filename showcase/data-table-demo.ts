/** Gallery section: <data-table>. */

// SIDE-EFFECT IMPORT — this is what registers <data-table>, and it must stay.
import '../src/ui/data-table.ts';
import type { DataTableElement, FacetGroup, TableColumn } from '../src/ui/data-table.ts';
import { mulberry32 } from './fake-data.ts';

interface DemoRun extends Record<string, unknown> {
  id: string;
  hook: string;
  status: string;
  /** Milliseconds, or null for a run that never produced one. */
  ms: number | null;
  queued: number;
}

const HOOKS = ['pr-minder', 'required-builds', 'gha-runner', 'pr-describe', 'license-block'];
const STATUSES = ['success', 'success', 'success', 'failure', 'skipped', 'running', 'timeout'];

/** A deterministic fixture: the same page every reload, so a visual
 * regression is a real change and never the generator reshuffling. */
function makeRows(n: number, now: number): DemoRun[] {
  const rand = mulberry32(0xda7a); // fixed seed
  const rows: DemoRun[] = [];
  for (let i = 0; i < n; i++) {
    const status = STATUSES[Math.floor(rand() * STATUSES.length)] ?? 'success';
    // Skipped runs did no work and running ones have not finished: both legitimately have NO duration.
    const ms = status === 'skipped' || status === 'running' ? null : Math.round(10 + rand() * 90_000);
    rows.push({
      id: `run-${(i + 1).toString().padStart(3, '0')}-${Math.floor(rand() * 1e6).toString(36)}`,
      hook: HOOKS[Math.floor(rand() * HOOKS.length)] ?? 'pr-minder',
      status,
      ms,
      queued: now - Math.round(rand() * 6 * 3600_000),
    });
  }
  return rows.sort((a, b) => b.queued - a.queued); // newest first, like a real producer
}

/** "1.2s" / "900ms" / "—". The point of the value-vs-text split: this
 * string sorts wrongly ("10s" before "9s") and the number sorts right. */
function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString();
}

const COLUMNS: TableColumn<DemoRun>[] = [
  { key: 'queued', label: 'Queued', value: (r) => r.queued, render: (r) => fmtTime(r.queued) },
  {
    key: 'hook',
    label: 'Hook',
    render: (r) => Object.assign(document.createElement('code'), { textContent: r.hook }),
  },
  {
    key: 'status',
    label: 'Status',
    render: (r) => {
      const span = document.createElement('span');
      span.className = `demo-status ${r.status}`;
      span.textContent = r.status;
      return span;
    },
  },
  // value sorts (number), render displays ("1.2s"), text searches the string
  // the reader can see.
  {
    key: 'ms',
    label: 'Duration',
    align: 'end',
    value: (r) => r.ms,
    text: (r) => fmtMs(r.ms),
    render: (r) => fmtMs(r.ms),
  },
  { key: 'id', label: 'Run ID', className: 'demo-id' },
];

const FACETS: FacetGroup<DemoRun>[] = [
  {
    key: 'status',
    label: 'run(s)',
    of: (r) => r.status,
    // A closed vocabulary gets a pinned order so the chip row does not reshuffle as counts change under a filter.
    order: ['failure', 'timeout', 'running', 'success', 'skipped'],
    chipClass: (b) => `demo-chip-${b}`,
  },
  { key: 'hook', label: 'run(s)', of: (r) => r.hook },
];

/**
 * Cell styling, passed INTO the shadow root. This is the styleText hatch's
 * whole reason for existing: the status span below is created by THIS file
 * but lives inside the component's shadow root, where no page stylesheet
 * can reach it. The colours themselves still come from the page, because
 * custom properties do inherit through the boundary.
 */
const DEMO_TABLE_CSS = `
.demo-status { font-weight: 500; }
.demo-status.success { color: var(--success); }
.demo-status.failure, .demo-status.timeout { color: var(--failure); }
.demo-status.running { color: var(--running); }
.demo-status.skipped { color: var(--skipped); }
.demo-id { font-family: var(--table-mono); color: var(--table-muted); }
.demo-chip-failure, .demo-chip-timeout { color: var(--failure); }
.demo-chip-running { color: var(--running); }
.demo-chip-success { color: var(--success); }
.demo-chip-skipped { color: var(--skipped); }
`;

export function mountDataTableDemo(now: number): void {
  const rows = makeRows(120, now);

  const full = document.getElementById('demo-table') as DataTableElement<DemoRun> | null;
  if (full) {
    full.columns = COLUMNS;
    full.styleText = DEMO_TABLE_CSS;
    full.facets = FACETS;
    full.rows = rows;
    full.rowId = (r) => r.id;
    // Expandable detail: click (or Enter) a row to reveal it. One row's
    // detail is deliberately ASYNC so the placeholder-then-paint path is on
    // screen too — a detail that has to be fetched is the common case, and
    // it is the one that looks broken if the component gets it wrong.
    full.detailFor = (r) => {
      const box = document.createElement('div');
      box.className = 'demo-detail';
      box.textContent = `${r.id} · ${r.hook} · ${r.status} · ${fmtMs(r.ms)}`;
      if (!r.status.startsWith('f')) return box;
      return new Promise<Node>((resolve) => setTimeout(() => resolve(box), 400));
    };
    // Adding this listener is ALSO what makes rows keyboard-reachable —
    // try tabbing into the body and pressing Enter.
    full.addEventListener('row-click', (e) => {
      const detail = (e as CustomEvent<{ row: DemoRun; id: string | null }>).detail;
      const out = document.getElementById('demo-table-click');
      if (out) out.textContent = `row-click → ${detail.id} (${detail.row.hook}, ${detail.row.status})`;
    });
  }

  // The minimal case: no query box, no chips, no row listener.
  const plain = document.getElementById('demo-table-plain') as DataTableElement<DemoRun> | null;
  if (plain) {
    plain.columns = COLUMNS.slice(0, 3);
    plain.styleText = DEMO_TABLE_CSS;
    plain.rows = rows.slice(0, 6);
  }

  // The filtered-empty state, which is NOT the same as having no data.
  const empty = document.getElementById('demo-table-empty') as DataTableElement<DemoRun> | null;
  if (empty) {
    empty.columns = COLUMNS.slice(0, 4);
    empty.styleText = DEMO_TABLE_CSS;
    empty.rows = rows.slice(0, 20);
    empty.filter = { query: 'no-such-run-anywhere', hidden: {}, sort: null };
  }
}
