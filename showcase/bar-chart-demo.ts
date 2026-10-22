/** Gallery section: <bar-chart>. */

// SIDE-EFFECT IMPORT — registers <bar-chart>.
import '../src/ui/bar-chart.ts';
import type { BarChartElement, BarRowClickDetail } from '../src/ui/bar-chart.ts';

const GB = 1e9;

function bytes(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)} TB`;
  if (v >= GB) return `${(v / GB).toFixed(v >= 10 * GB ? 0 : 1)} GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)} MB`;
  return `${v} B`;
}

function chart(id: string): BarChartElement | null {
  return document.getElementById(id) as BarChartElement | null;
}

export function mountBarChartDemo(): void {
  const disk = chart('demo-bar-disk');
  if (disk) {
    const size = 500 * GB;
    disk.format = bytes;
    disk.max = size;
    disk.series = [
      { key: 'run', label: 'run files', color: '#4f8cff' },
      { key: 'other', label: 'other data', color: '#a78bfa' },
      { key: 'free', label: 'free', muted: true },
    ];
    disk.rows = [{ id: 'data', label: '/data', values: { run: 182 * GB, other: 241 * GB, free: 77 * GB }, detail: 'ext4 on /dev/nvme1n1' }];
    disk.markers = [{ value: size * 0.9, label: '10% free floor', kind: 'warning' }];
  }

  // Bytes per CI run: long labels, a zero row, a row with a missing key, and a label link.
  const runs = chart('demo-bar-runs');
  const clicked = document.getElementById('demo-bar-clicked');
  if (runs) {
    runs.format = bytes;
    runs.series = [
      { key: 'live', label: 'live', color: '#34d399' },
      { key: 'kept', label: 'kept after end', color: '#fbbf24' },
    ];
    runs.rows = [
      { id: 'r1', label: 'gosmopolitan #4812 cosmo-ci / test (windows-latest)', values: { live: 12.4 * GB, kept: 3.1 * GB }, detail: 'started 14:02\nstill running' },
      { id: 'r2', label: 'buildhost #2290 ci', values: { live: 2.2 * GB, kept: 0.4 * GB }, href: '#bar-chart' },
      { id: 'r3', label: 'js-snippets #918 deploy', values: { live: 0, kept: 0 } },
      { id: 'r4', label: 'webhook-runner #77 (no "kept" key)', values: { live: 5.6 * GB } },
      { id: 'r5', label: 'a tiny run beside a huge one', values: { live: 0.02 * GB, kept: 9.9 * GB } },
      { id: 'r6', label: 'junk values (NaN, -3)', values: { live: Number.NaN, kept: -3 } },
    ];
    runs.addEventListener('row-click', (e) => {
      const detail = (e as CustomEvent<BarRowClickDetail>).detail;
      if (clicked) clicked.textContent = `row-click: ${detail.row.label}`;
    });
  }

  // No color on any series: each takes the hash colour of its key.
  const hashed = chart('demo-bar-hashed');
  if (hashed) {
    hashed.series = [{ key: 'go-toolchain' }, { key: 'go-s3-server' }, { key: 'required-builds-manager' }];
    hashed.rows = [
      { id: 'mon', label: 'Monday', values: { 'go-toolchain': 41, 'go-s3-server': 12, 'required-builds-manager': 7 } },
      { id: 'tue', label: 'Tuesday', values: { 'go-toolchain': 18, 'go-s3-server': 30, 'required-builds-manager': 2 } },
      { id: 'wed', label: 'Wednesday', values: { 'go-toolchain': 1200, 'go-s3-server': 340, 'required-builds-manager': 15 } },
    ];
  }

  const beyond = chart('demo-bar-beyond');
  if (beyond) {
    beyond.max = 100;
    beyond.format = (v) => `${Math.round(v)}%`;
    beyond.series = [{ key: 'used', label: 'used', color: '#f87171' }];
    beyond.rows = [
      { id: 'a', label: 'within', values: { used: 64 } },
      { id: 'b', label: 'past max', values: { used: 130 } },
    ];
    beyond.markers = [
      { value: 80, label: 'alert', kind: 'critical' },
      { value: 150, label: 'quota' },
      { value: -10, label: 'below zero' },
    ];
  }

  // The empty one: no rows at all, and its own empty text.
  const empty = chart('demo-bar-empty');
  if (empty) empty.series = [{ key: 'live' }, { key: 'kept' }];
}
