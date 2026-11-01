// A CanvasRenderingContext2D stand-in that writes SVG markup, so the
// dag-view's own draw() renders as vectors.

type Paint = string | SvgGradient | SvgPattern;
type Matrix = [number, number, number, number, number, number];

export class SvgGradient {
	readonly stops: [number, string][] = [];
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
	constructor(x0: number, y0: number, x1: number, y1: number) {
		this.x0 = x0;
		this.y0 = y0;
		this.x1 = x1;
		this.y1 = y1;
	}

	addColorStop(offset: number, color: string): void {
		this.stops.push([offset, color]);
	}
}

/** A tile that the context defines one time per id, in device pixels at the origin. */
export class SvgPattern {
	readonly id: string;
	readonly def: string;
	constructor(id: string, def: string) {
		this.id = id;
		this.def = def;
	}
}

interface State {
	fillStyle: Paint;
	strokeStyle: Paint;
	globalAlpha: number;
	lineWidth: number;
	lineDash: number[];
	lineJoin: CanvasLineJoin;
	lineCap: CanvasLineCap;
	font: string;
	textBaseline: CanvasTextBaseline;
	textAlign: CanvasTextAlign;
	m: Matrix;
	clip: string | null;
}

function esc(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

function n(v: number): string {
	return String(Math.round(v * 100) / 100);
}

const ANCHOR: Partial<Record<CanvasTextAlign, string>> = { left: 'start', start: 'start', center: 'middle', right: 'end', end: 'end' };

export class SvgContext {
	private s: State = SvgContext.fresh();
	private stack: State[] = [];
	private d: string[] = [];
	private cx = 0;
	private cy = 0;
	private out: string[] = [];
	private defs: string[] = [];
	private defined = new Set<string>();
	private nextId = 0;
	/** The fill key of the last element, when it was a fillRect: the next equal fillRect joins its path. */
	private rectKey: string | null = null;

	private readonly measure: CanvasRenderingContext2D;
	constructor(measure: CanvasRenderingContext2D) {
		this.measure = measure;
	}

	private static fresh(): State {
		return {
			fillStyle: '#000',
			strokeStyle: '#000',
			globalAlpha: 1,
			lineWidth: 1,
			lineDash: [],
			lineJoin: 'miter',
			lineCap: 'butt',
			font: '10px sans-serif',
			textBaseline: 'alphabetic',
			textAlign: 'start',
			m: [1, 0, 0, 1, 0, 0],
			clip: null,
		};
	}

	begin(): void {
		this.s = SvgContext.fresh();
		this.stack = [];
		this.d = [];
		this.out = [];
		this.defs = [];
		this.defined.clear();
		this.nextId = 0;
		this.rectKey = null;
	}

	/** The frame as SVG children: the defs, then every element in paint order. */
	markup(): string {
		return `<defs>${this.defs.join('')}</defs>${this.out.join('')}`;
	}

	get elementCount(): number {
		return this.out.length;
	}

	// -- State --------------------------------------------------------------------

	get fillStyle(): Paint {
		return this.s.fillStyle;
	}
	set fillStyle(v: Paint) {
		this.s.fillStyle = v;
	}
	get strokeStyle(): Paint {
		return this.s.strokeStyle;
	}
	set strokeStyle(v: Paint) {
		this.s.strokeStyle = v;
	}
	get globalAlpha(): number {
		return this.s.globalAlpha;
	}
	set globalAlpha(v: number) {
		if (Number.isFinite(v) && v >= 0 && v <= 1) this.s.globalAlpha = v;
	}
	get lineWidth(): number {
		return this.s.lineWidth;
	}
	set lineWidth(v: number) {
		if (Number.isFinite(v) && v > 0) this.s.lineWidth = v;
	}
	get lineJoin(): CanvasLineJoin {
		return this.s.lineJoin;
	}
	set lineJoin(v: CanvasLineJoin) {
		this.s.lineJoin = v;
	}
	get lineCap(): CanvasLineCap {
		return this.s.lineCap;
	}
	set lineCap(v: CanvasLineCap) {
		this.s.lineCap = v;
	}
	get font(): string {
		return this.s.font;
	}
	set font(v: string) {
		this.s.font = v;
	}
	get textBaseline(): CanvasTextBaseline {
		return this.s.textBaseline;
	}
	set textBaseline(v: CanvasTextBaseline) {
		this.s.textBaseline = v;
	}
	get textAlign(): CanvasTextAlign {
		return this.s.textAlign;
	}
	set textAlign(v: CanvasTextAlign) {
		this.s.textAlign = v;
	}

	setLineDash(v: number[]): void {
		this.s.lineDash = [...v];
	}

	save(): void {
		this.stack.push({ ...this.s, lineDash: [...this.s.lineDash], m: [...this.s.m] as Matrix });
	}

	restore(): void {
		const top = this.stack.pop();
		if (top !== undefined) this.s = top;
	}

	// -- Transforms: draw() only scales uniformly and translates. ----------------

	setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
		this.s.m = SvgContext.check([a, b, c, d, e, f]);
	}

	transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
		const [A, , , D, E, F] = this.s.m;
		SvgContext.check([a, b, c, d, e, f]);
		this.s.m = [A * a, 0, 0, D * d, A * e + E, D * f + F];
	}

	translate(x: number, y: number): void {
		this.transform(1, 0, 0, 1, x, y);
	}

	private static check(m: Matrix): Matrix {
		if (m[1] !== 0 || m[2] !== 0 || m[0] !== m[3]) throw new Error(`svg-context: only uniform scale and translate, got ${m.join(',')}`);
		return m;
	}

	private px(x: number, y: number): [number, number] {
		const [a, , , d, e, f] = this.s.m;
		return [a * x + e, d * y + f];
	}

	private get k(): number {
		return this.s.m[0];
	}

	// -- Paths, in device coordinates -------------------------------------------

	beginPath(): void {
		this.d = [];
	}

	moveTo(x: number, y: number): void {
		[this.cx, this.cy] = this.px(x, y);
		this.d.push(`M${n(this.cx)} ${n(this.cy)}`);
	}

	lineTo(x: number, y: number): void {
		[this.cx, this.cy] = this.px(x, y);
		this.d.push(`L${n(this.cx)} ${n(this.cy)}`);
	}

	closePath(): void {
		this.d.push('Z');
	}

	/** The canvas arcTo: a line to the first tangent point, then a circular arc to the second. */
	arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
		const [p1x, p1y] = this.px(x1, y1);
		const [p2x, p2y] = this.px(x2, y2);
		const rr = r * this.k;
		const ax = this.cx - p1x;
		const ay = this.cy - p1y;
		const bx = p2x - p1x;
		const by = p2y - p1y;
		const la = Math.hypot(ax, ay);
		const lb = Math.hypot(bx, by);
		const cross = ax * by - ay * bx;
		if (this.d.length === 0 || rr === 0 || la === 0 || lb === 0 || Math.abs(cross) < 1e-9) {
			this.lineTo(x1, y1);
			return;
		}
		const cos = (ax * bx + ay * by) / (la * lb);
		const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
		const dist = rr / Math.tan(theta / 2);
		const t1x = p1x + (ax / la) * dist;
		const t1y = p1y + (ay / la) * dist;
		const t2x = p1x + (bx / lb) * dist;
		const t2y = p1y + (by / lb) * dist;
		// The turn from (p0 -> p1) to (p1 -> p2) in y-down coordinates: a positive cross is clockwise.
		const turn = -ax * by + ay * bx;
		this.d.push(`L${n(t1x)} ${n(t1y)}A${n(rr)} ${n(rr)} 0 0 ${turn > 0 ? 1 : 0} ${n(t2x)} ${n(t2y)}`);
		this.cx = t2x;
		this.cy = t2y;
	}

	clip(): void {
		const id = `c${this.nextId++}`;
		const parent = this.s.clip !== null ? ` clip-path="url(#${this.s.clip})"` : '';
		this.defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"${parent}><path d="${this.d.join('')}"/></clipPath>`);
		this.s.clip = id;
		this.rectKey = null;
	}

	// -- Paint -------------------------------------------------------------------

	private paint(p: Paint): string {
		if (typeof p === 'string') return esc(p);
		if (p instanceof SvgPattern) {
			if (!this.defined.has(p.id)) {
				this.defined.add(p.id);
				this.defs.push(p.def);
			}
			return `url(#${p.id})`;
		}
		const id = `g${this.nextId++}`;
		const [x0, y0] = this.px(p.x0, p.y0);
		const [x1, y1] = this.px(p.x1, p.y1);
		const stops = p.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${esc(c)}"/>`).join('');
		this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x0)}" y1="${n(y0)}" x2="${n(x1)}" y2="${n(y1)}">${stops}</linearGradient>`);
		return `url(#${id})`;
	}

	private common(): string {
		const a = this.s.globalAlpha < 1 ? ` opacity="${n(this.s.globalAlpha)}"` : '';
		const c = this.s.clip !== null ? ` clip-path="url(#${this.s.clip})"` : '';
		return a + c;
	}

	private strokeAttrs(): string {
		const k = this.k;
		const dash = this.s.lineDash.length > 0 ? ` stroke-dasharray="${this.s.lineDash.map((v) => n(v * k)).join(' ')}"` : '';
		return (
			` fill="none" stroke="${this.paint(this.s.strokeStyle)}" stroke-width="${n(this.s.lineWidth * k)}"` +
			` stroke-linejoin="${this.s.lineJoin}" stroke-linecap="${this.s.lineCap}"${dash}`
		);
	}

	fill(): void {
		if (this.d.length === 0) return;
		this.rectKey = null;
		this.out.push(`<path d="${this.d.join('')}" fill="${this.paint(this.s.fillStyle)}"${this.common()}/>`);
	}

	stroke(): void {
		if (this.d.length === 0) return;
		this.rectKey = null;
		this.out.push(`<path d="${this.d.join('')}"${this.strokeAttrs()}${this.common()}/>`);
	}

	fillRect(x: number, y: number, w: number, h: number): void {
		const [x0, y0] = this.px(x, y);
		const rect = `M${n(x0)} ${n(y0)}h${n(w * this.k)}v${n(h * this.k)}h${n(-w * this.k)}Z`;
		const key = typeof this.s.fillStyle === 'string' ? `${this.s.fillStyle}|${this.common()}` : null;
		// A run of same-paint rects (the background grid) is one path, not one element per dot.
		if (key !== null && key === this.rectKey) {
			const last = this.out.length - 1;
			this.out[last] = this.out[last].replace('" fill=', `${rect}" fill=`);
			return;
		}
		this.out.push(`<path d="${rect}" fill="${this.paint(this.s.fillStyle)}"${this.common()}/>`);
		this.rectKey = key;
	}

	strokeRect(x: number, y: number, w: number, h: number): void {
		const [x0, y0] = this.px(x, y);
		this.rectKey = null;
		this.out.push(`<path d="M${n(x0)} ${n(y0)}h${n(w * this.k)}v${n(h * this.k)}h${n(-w * this.k)}Z"${this.strokeAttrs()}${this.common()}/>`);
	}

	createLinearGradient(x0: number, y0: number, x1: number, y1: number): SvgGradient {
		return new SvgGradient(x0, y0, x1, y1);
	}

	createPattern(): never {
		throw new Error('svg-context: createPattern takes a raster tile; give the element a vector SvgPattern instead');
	}

	// -- Text ----------------------------------------------------------------------

	measureText(text: string): TextMetrics {
		this.measure.font = this.s.font;
		this.measure.textBaseline = this.s.textBaseline;
		return this.measure.measureText(text);
	}

	/** The font with its px size scaled by the transform, so no element carries a transform of its own. */
	private scaledFont(): string {
		const k = this.k;
		if (k === 1) return this.s.font;
		return this.s.font.replace(/(\d*\.?\d+)px/, (_, v: string) => `${n(Number(v) * k)}px`);
	}

	/**
	 * SVG baselines do not land where canvas baselines do. The canvas measures its own: under the
	 * current textBaseline, alphabeticBaseline is the offset to the alphabetic line. The text goes on that line.
	 */
	private text(text: string, x: number, y: number, paint: string): void {
		const [px, py] = this.px(x, y);
		this.measure.font = this.scaledFont();
		this.measure.textBaseline = this.s.textBaseline;
		const ay = py - this.measure.measureText(text).alphabeticBaseline;
		const anchor = ANCHOR[this.s.textAlign] ?? 'start';
		this.rectKey = null;
		this.out.push(
			`<text x="${n(px)}" y="${n(ay)}" style="font:${esc(this.scaledFont())};white-space:pre" text-anchor="${anchor}"${paint}${this.common()}>${esc(text)}</text>`,
		);
	}

	fillText(text: string, x: number, y: number): void {
		this.text(text, x, y, ` fill="${this.paint(this.s.fillStyle)}"`);
	}

	strokeText(text: string, x: number, y: number): void {
		const k = this.k;
		this.text(
			text,
			x,
			y,
			` fill="none" stroke="${this.paint(this.s.strokeStyle)}" stroke-width="${n(this.s.lineWidth * k)}" stroke-linejoin="${this.s.lineJoin}"`,
		);
	}
}

/** The dag-view's 8px hatch and stipple tiles, drawn as vectors with the same geometry as its canvas tiles. */
export function vectorPattern(kind: 'hatch' | 'stipple', color: string, id: string): SvgPattern {
	const c = esc(color);
	const body =
		kind === 'hatch'
			? `<path d="M-2 10L10 -2M6 10L14 -2" stroke="${c}" stroke-width="2" fill="none"/>`
			: `<circle cx="2" cy="2" r="1.2" fill="${c}"/><circle cx="6" cy="6" r="1.2" fill="${c}"/>`;
	return new SvgPattern(id, `<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="8">${body}</pattern>`);
}
