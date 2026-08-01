/**
 * Gallery section: <activity-feed>.
 *
 * The fixture's job is to prove the thing the component actually claims:
 * COLOR IS DERIVED, NEVER ENUMERATED. So the kinds below are deliberately
 * a mix of ones the severity rules clearly claim (`*.failed` → bad,
 * `*.skipped` → skip, `*.built` → good) and ones NO rule mentions
 * (`weather.observed`, `kettle.boiled`) — those still get a severity
 * (info) and a stable family hue the first time they appear, which is the
 * whole argument against a stylesheet that lists known kinds.
 *
 * It also demonstrates that the feed is a <data-table> underneath: the
 * chips, the counts, the "showing N of M" readout and the two empty states
 * are that component's, and nothing about tables is implemented twice.
 */

// SIDE-EFFECT IMPORT — registers <activity-feed> (and, transitively,
// <data-table>, which it is built on). Both names below are used only in
// type positions, and a type-only import is elided, so without this line
// the element never upgrades. See data-table-demo.ts for the full note.
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
  // Families the severity rules have never heard of: they must still get a
  // colour and a chip the first time they show up.
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
  // Fold the plural spelling producers drift into, so "hooks.*" and
  // "hook.*" share one family chip instead of splitting the colour.
  feed.familyAliases = { hooks: 'hook', runs: 'run' };

  // The second instance shows the empty state — the honest one: a feed with
  // nothing in it says so, and does not look like a broken component.
  const emptyFeed = document.getElementById('demo-feed-empty') as ActivityFeedElement | null;
  if (emptyFeed) emptyFeed.entries = [];
}
