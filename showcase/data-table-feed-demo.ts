/** Gallery section: <data-table variant="feed">, in the <data-table> section. */

// SIDE-EFFECT IMPORT — this is what registers <data-table>, and it must stay.
import '../src/ui/data-table.ts';
import type { ActivityEntry, DataTableElement } from '../src/ui/data-table.ts';
import { mulberry32 } from './fake-data.ts';

/** Kinds that every severity rule claims, plus families that no rule knows. */
const KINDS = [
  'run.started',
  'run.finished',
  'run.skipped',
  'runs.reaped',
  'image.built',
  'image.build_failed',
  'hook.denied',
  'hooks.reloaded',
  'hook.disabled_rejected',
  'reload.unverified',
  'reload.verified',
  'manager.inbox_dropped',
  'manager.leased',
  'lock.stolen',
  'env.unresolved',
  'git.pulled',
  'spool.parked',
  // Families the severity rules have never heard of: they must still get a colour.
  'weather.observed',
  'kettle.boiled',
];

const SUBJECTS = [
  'wow-look-at-my/go-toolchain#412',
  'wow-look-at-my/webhook-runner#128',
  'PazerOP/pr-preview-action#7',
  'wow-look-at-my/js-snippets#58',
];

const SLUG = /[\w.-]+\/[\w.-]+#\d+/g;

/** The message renderer: every repo#number slug becomes a link, the rest stays text. */
function linkify(message: string): Node {
  const out = document.createDocumentFragment();
  let at = 0;
  for (const m of message.matchAll(SLUG)) {
    out.append(message.slice(at, m.index));
    const [repo, num] = m[0].split('#');
    const a = document.createElement('a');
    a.href = `https://github.com/${repo}/pull/${num}`;
    a.textContent = m[0];
    out.append(a);
    at = m.index + m[0].length;
  }
  out.append(message.slice(at));
  return out;
}

export function mountDataTableFeedDemo(now: number): void {
  const feed = document.getElementById('demo-feed') as DataTableElement | null;
  if (!feed) return;

  const rand = mulberry32(0xfeed); // fixed seed: the same page every reload
  const entries: ActivityEntry[] = [];
  for (let i = 0; i < 60; i++) {
    const kind = KINDS[Math.floor(rand() * KINDS.length)] ?? 'run.started';
    const subject = SUBJECTS[Math.floor(rand() * SUBJECTS.length)] ?? SUBJECTS[0]!;
    entries.push({
      time: now - Math.round(rand() * 4 * 3600_000),
      kind,
      message: `${kind.split('.')[0]}: ${subject} — generated locally, no network`,
      // Field VALUES are searchable too: type a run id into the box.
      fields: { subject, run: `r${Math.floor(rand() * 1e6).toString(36)}` },
    });
  }
  entries.sort((a, b) => Number(b.time) - Number(a.time)); // newest first

  feed.entries = entries;
  // Fold the plural spellings, so "hooks.*" and "hook.*" share one family chip.
  feed.familyAliases = { hooks: 'hook', runs: 'run' };
  feed.messageRenderer = (message) => linkify(message);

  // The second instance shows the empty state — the honest one.
  const emptyFeed = document.getElementById('demo-feed-empty') as DataTableElement | null;
  if (emptyFeed) emptyFeed.entries = [];
}
