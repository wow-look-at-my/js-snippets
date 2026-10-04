/** Gallery section: <activity-feed>. */

// SIDE-EFFECT IMPORT — registers <activity-feed> (and, transitively, <data-table>, which it is built on).
import '../src/ui/activity-feed.ts';
import type { ActivityFeedElement, ActivityEntry } from '../src/ui/activity-feed.ts';
import { mulberry32 } from './fake-data.ts';

/** Kinds spanning every severity rule, plus families no rule knows. */
const KINDS = [
  'run.started',
  'run.finished',
  'run.skipped',
  'image.built',
  'image.build_failed',
  'hook.denied',
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

export function mountActivityFeedDemo(now: number): void {
  const feed = document.getElementById('demo-feed') as ActivityFeedElement | null;
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
      // Field VALUES are searchable too: type a repo slug into the box.
      fields: { subject, run: `r${Math.floor(rand() * 1e6).toString(36)}` },
    });
  }
  entries.sort((a, b) => Number(b.time) - Number(a.time)); // newest first

  feed.entries = entries;
  // Fold the plural spelling producers drift into, so "hooks.*" and "hook.*" share one family chip instead.
  feed.familyAliases = { hooks: 'hook', runs: 'run' };

  // The second instance shows the empty state — the honest one.
  const emptyFeed = document.getElementById('demo-feed-empty') as ActivityFeedElement | null;
  if (emptyFeed) emptyFeed.entries = [];
}
