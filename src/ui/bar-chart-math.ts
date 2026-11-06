/** The pure geometry of <bar-chart>: scale, stacks, markers, hit-testing, text. No DOM. */

import { clipToWidth, type MeasureText } from './canvas-text.ts';
import { niceStep } from './perf-graph-math.ts';

/** One stacked series. Array order is the stack order and the legend order. */
export interface BarSeries {
  key: string;
  label?: string;
  /** Any CSS color. Without one, the key picks a stable hue. */
  color?: string;
  /** A quiet neutral fill (free space, a remainder). It takes no hover emphasis. */
  muted?: boolean;
}

/** One horizontal bar. `values` is read by series key. */
export interface BarRow {
  id: string;
  label: string;
  values: Readonly<Record<string, number>>;
  /** The row label becomes a link to this URL. */
  href?: string;
  /** Extra text for the tooltip. */
  detail?: string;
}

export type BarMarkerKind = 'default' | 'warning' | 'critical';

/** A vertical line across every row at `value`. */
export interface BarMarker {
  value: number;
  label: string;
  kind?: BarMarkerKind;
}

export interface BarScale {
  max: number;
  step: number;
  ticks: number[];
}

/** One drawn part of a stacked row. x and width are px from the left of the plot. */
export interface BarSegment {
  key: string;
  value: number;
  share: number;
  x: number;
  width: number;
  /** True when the exact width is below 1px. The segment is still drawn and hit. */
  tiny: boolean;
  /** True for the last drawn segment: the outer end of the stack. */
  end: boolean;
}

/** A row after the stack: its total and the segments that have a value. */
export interface StackedRow {
  total: number;
  segments: BarSegment[];
  /** True when the total runs past the scale end. The segments are cut at the plot edge. */
  overflow: boolean;
}

/** A marker after placement. x is px from the left of the plot. */
export interface PlacedMarker {
  marker: BarMarker;
  x: number;
  /** x is then held at the nearest plot edge. */
  offScale: boolean;
}

/** The vertical layout of the rows, in px of the chart. */
export interface BarRowLayout {
  /** The y of the first row band. */
  top: number;
  rowHeight: number;
  rowGap: number;
  /** The x where the plot starts. */
  plotLeft: number;
  plotWidth: number;
}

/** The result of a hit-test. seriesKey is null when the point is in the row band but on no segment. */
export interface BarHit {
  rowIndex: number;
  seriesKey: string | null;
}

/** The default number of tick intervals the scale aims for. */
export const DEFAULT_MAX_TICKS = 5;

/** A value as the chart reads it. */
export function cleanValue(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** The sum of the row values for the given series. Keys that no series names do not count. */
export function rowTotal(row: BarRow, series: readonly BarSeries[]): number {
  let total = 0;
  for (const s of series) total += cleanValue(row.values[s.key]);
  return total;
}

/** Remove the float noise that a multiple of a decimal step picks up. */
function tidy(n: number): number {
  return Number(n.toPrecision(12));
}

/**The x scale. A finite `fixedMax` above a value of zero is the end as given. */
export function barScale(totals: readonly number[], fixedMax: number | null = null, maxTicks: number = DEFAULT_MAX_TICKS): BarScale {
  let max: number;
  let step: number;
  if (fixedMax != null && Number.isFinite(fixedMax) && fixedMax > 0) {
    max = fixedMax;
    step = niceStep(max, maxTicks);
  } else {
    let dataMax = 0;
    for (const t of totals) dataMax = Math.max(dataMax, cleanValue(t));
    if (dataMax === 0) dataMax = 1;
    step = niceStep(dataMax, maxTicks);
    max = tidy(Math.ceil(tidy(dataMax / step)) * step);
  }
  const ticks: number[] = [];
  const last = Math.floor(tidy(max / step));
  for (let i = 0; i <= last; i++) ticks.push(tidy(i * step));
  return { max, step, ticks };
}

/** The x of a value on the scale, not clamped. */
export function scaleX(value: number, scaleMax: number, plotWidth: number): number {
  if (!(scaleMax > 0)) return 0;
  return (value / scaleMax) * plotWidth;
}

/**
 * Stack one row into segments, in series order. A series with no value adds
 * no segment. The segment widths add up to the scaled total, cut at the plot
 * width when the total runs past the scale end.
 */
export function stackRow(row: BarRow, series: readonly BarSeries[], scaleMax: number, plotWidth: number): StackedRow {
  const width = Math.max(0, plotWidth);
  const total = rowTotal(row, series);
  const segments: BarSegment[] = [];
  let sum = 0;
  for (const s of series) {
    const value = cleanValue(row.values[s.key]);
    if (value === 0) continue;
    const x0 = Math.min(scaleX(sum, scaleMax, width), width);
    sum += value;
    const x1 = Math.min(scaleX(sum, scaleMax, width), width);
    segments.push({ key: s.key, value, share: shareOf(value, total), x: x0, width: x1 - x0, tiny: x1 - x0 < 1, end: false });
  }
  if (segments.length > 0) segments[segments.length - 1].end = true;
  return { total, segments, overflow: scaleMax > 0 && total > scaleMax };
}

/** The rectangle to paint for a segment. A segment that is not the end gives
 * up `gap` px on its right, so the background shows between it and the next
 * one. */
export function segmentRect(seg: BarSegment, gap: number): { x: number; width: number } {
  const trimmed = seg.end ? seg.width : seg.width - gap;
  return { x: seg.x, width: Math.max(1, trimmed) };
}

/** Place each marker on the plot. */
export function placeMarkers(markers: readonly BarMarker[], scaleMax: number, plotWidth: number): PlacedMarker[] {
  const width = Math.max(0, plotWidth);
  return markers.map((marker) => {
    const v = marker.value;
    if (!Number.isFinite(v)) return { marker, x: 0, offScale: true };
    if (v < 0) return { marker, x: 0, offScale: true };
    if (v > scaleMax) return { marker, x: width, offScale: true };
    return { marker, x: scaleX(v, scaleMax, width), offScale: false };
  });
}

/** The y of the top of row `index`. */
export function rowY(index: number, layout: BarRowLayout): number {
  return layout.top + index * (layout.rowHeight + layout.rowGap);
}

/**
 * Find the row and the segment under a point. The whole row band, gap
 * included, belongs to the row, so a thin bar is easy to hover. A point left
 * of the plot, or past the last segment, hits the row with no series.
 */
export function hitTestBars(x: number, y: number, layout: BarRowLayout, rows: readonly StackedRow[]): BarHit | null {
  const pitch = layout.rowHeight + layout.rowGap;
  if (!(pitch > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const rel = y - layout.top;
  if (rel < 0) return null;
  const rowIndex = Math.floor(rel / pitch);
  if (rowIndex >= rows.length) return null;
  const px = x - layout.plotLeft;
  let seriesKey: string | null = null;
  if (px >= 0) {
    for (const seg of rows[rowIndex].segments) {
      // A tiny segment gets the same 1px it is painted with.
      const right = seg.x + Math.max(1, seg.width);
      if (px >= seg.x && px < right) {
        seriesKey = seg.key;
        break;
      }
    }
  }
  return { rowIndex, seriesKey };
}

export function shareOf(value: number, total: number): number {
  const v = cleanValue(value);
  const t = cleanValue(total);
  return t > 0 ? Math.min(1, v / t) : 0;
}

/** A share as a percent. */
export function formatShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  if (share >= 1) return '100%';
  if (share < 0.01) return '<1%';
  if (share > 0.99) return '>99%';
  return `${Math.round(share * 100)}%`;
}

const COMPACT_UNITS = ['', 'k', 'M', 'B', 'T'];

/** Up to `decimals` decimals, with trailing zeros removed. */
function trimFixed(n: number, decimals: number): string {
  const s = n.toFixed(decimals);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/**The default number format. Not finite: an em dash. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  let a = Math.abs(value);
  if (a < 1000) {
    const s = trimFixed(a, 2);
    if (s !== '1000') return s === '0' ? '0' : sign + s;
  }
  let unit = 0;
  while (a >= 1000 && unit < COMPACT_UNITS.length - 1) {
    a /= 1000;
    unit++;
  }
  let s = a < 10 ? trimFixed(a, 1) : Math.round(a).toString();
  if (Number(s) >= 1000 && unit < COMPACT_UNITS.length - 1) {
    unit++;
    s = trimFixed(Number(s) / 1000, 1);
  }
  return sign + s + COMPACT_UNITS[unit];
}

/** The text, cut with an ellipsis when its width would pass `availPx`. '' when not even the ellipsis fits. */
export function ellipsize(text: string, availPx: number, measure: MeasureText): string {
  if (measure(text) <= availPx) return text;
  const room = availPx - measure('…');
  if (room <= 0) return '';
  return clipToWidth(text, room, measure).trimEnd() + '…';
}

/** The width of the label gutter: the widest label plus padding, held between `min` and a share of the host. */
export function gutterWidth(hostWidth: number, widestLabelPx: number, min = 48, maxShare = 0.35, pad = 10): number {
  const cap = Math.max(min, Math.floor(Math.max(0, hostWidth) * maxShare));
  return Math.min(cap, Math.max(min, Math.ceil(widestLabelPx + pad)));
}

/** A short text that names each row and its total, for the aria-label. */
export function summarize(rows: readonly BarRow[], series: readonly BarSeries[], format: (v: number) => string): string {
  if (rows.length === 0) return 'Bar chart, no data';
  const parts = rows.map((r) => `${r.label} ${format(rowTotal(r, series))}`);
  return `Bar chart, ${rows.length} row${rows.length === 1 ? '' : 's'}: ${parts.join('; ')}`;
}
