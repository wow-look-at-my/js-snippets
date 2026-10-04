// A COLUMNAR WIRE FORMAT for feeding <timeline-view> a lot of events cheaply,
// plus the frame-paced driver that decodes one without blocking the page.

/** How a payload's columns are named and encoded. Supplied by the consumer:
 *  the format is a layout, the names are the consumer's own. */
export interface WireSchema {
    /** a few characters, checked against the payload's first a few bytes. */
    magic: string;
    /** Ascending unsigned values, delta-encoded (row ids). */
    deltaU: readonly string[];
    /** Signed values, zigzag delta-encoded (epoch-ms timestamps). */
    deltaZ: readonly string[];
    /** Plain unsigned values, one uvarint per row (durations, codes). */
    plain: readonly string[];
    /** Booleans, one bit per row. */
    bits: readonly string[];
    /** Strings, dictionary-encoded with one index per row. */
    strings: readonly string[];
}

export interface StringColumn {
    dict: string[];
    /* */
    idx: Int32Array | null;
}

/** One decoded page. Numbers land in typed arrays, strings in dictionaries;
 *  no per-row object exists until {@link rowObject} builds one. */
export interface Columns {
    n: number;
    /** Delta-decoded unsigned columns. */
    u: Record<string, Float64Array>;
    /** Delta-decoded signed columns (epoch ms), same reason. */
    z: Record<string, Float64Array>;
    /** Plain unsigned columns. */
    p: Record<string, Int32Array>;
    /** Bitsets; read with {@link bitAt}. */
    b: Record<string, Uint8Array>;
    /** Dictionary-encoded string columns; read with {@link stringAt}. */
    s: Record<string, StringColumn>;
}

export interface DecodedPage {
    c: Columns;
    /** Newest row id on this page — pass back as the next request's cursor. */
    maxId: number;
    /** Epoch ms: nothing older than this is retained by the producer. */
    retentionStart: number;
    /** Epoch ms: the producer's clock when it answered. */
    now: number;
}

/** A resumable unit of work: yields periodically, returns its result. */
export type Task<T> = Generator<undefined, T, undefined>;

// ---- pacing ---- ONE CHUNK PER FRAME, where a chunk is A FRAME'S WORTH OF WORK — not one step.

/** A frame's worth of decode work. */
export const CHUNK_MS = 4;

/** Rows per generator step. */
export const STEP = 1024;

let frameSeq = 0;
let framePending: Promise<void> | null = null;
// Waiters take frames in turn: N concurrent loads spread over N frames instead of sharing one.
let frameQueue: Promise<void> = Promise.resolve();

function yieldToBrowser(): Promise<void> {
    const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (typeof sched?.yield === 'function') return sched.yield();
    return new Promise<void>((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (): void => {
            ch.port1.close();
            resolve();
        };
        ch.port2.postMessage(0);
    });
}

function afterNextFrame(): Promise<void> {
    if (framePending) return framePending;
    const start = frameSeq;
    framePending = new Promise<void>((resolve) => {
        const wait = (): void => {
            requestAnimationFrame(() => {
                frameSeq++;
                // Resume in a FRESH TASK after the frame's callbacks, and
                // only once the frame counter moved.
                setTimeout(() => {
                    if (frameSeq > start) {
                        framePending = null;
                        resolve();
                    } else {
                        wait();
                    }
                }, 0);
            });
        };
        wait();
    });
    return framePending;
}

/** Waits for a frame to render. A frame is a global TURN — concurrent
 *  loads get different frames rather than sharing one. */
export function nextFrame(): Promise<void> {
    if (typeof requestAnimationFrame !== 'function') {
        return yieldToBrowser(); // node, tests.
    }
    const turn = frameQueue.then(afterNextFrame);
    frameQueue = turn.catch(() => undefined);
    return turn;
}

/**
 * Drives a task to completion at one chunk per frame, a chunk being CHUNK_MS
 * of real work. `onSlice` reports each chunk's measured cost.
 *
 * The frame is claimed BEFORE the work, never after: yielding afterwards
 * leaves seams where a task's last chunk and the next flow's first one both
 * run unwaited.
 */
export async function runSliced<T>(task: Task<T>, onSlice?: (ms: number) => void): Promise<T> {
    for (;;) {
        await nextFrame();
        const t0 = performance.now();
        let r: IteratorResult<undefined, T>;
        do {
            r = task.next();
        } while (!r.done && performance.now() - t0 < CHUNK_MS);
        onSlice?.(performance.now() - t0);
        if (r.done) return r.value;
    }
}

/** Runs a task straight through, for callers not on a frame budget. */
export function drain<T>(task: Task<T>): T {
    let r = task.next();
    while (!r.done) r = task.next();
    return r.value;
}

// ---- reading ----

class WireReader {
    private p = 0;
    private dec = new TextDecoder();
    private b: Uint8Array;

    // An explicit field, not a `private b: Uint8Array` parameter property:
    // node runs this module's tests by STRIPPING types.
    constructor(b: Uint8Array) {
        this.b = b;
    }

    uvarint(): number {
        let x = 0, s = 0;
        for (;;) {
            const c = this.b[this.p++];
            if (c === undefined) throw new Error('timeline-wire: truncated varint');
            if (c < 0x80) return x + c * 2 ** s;
            x += (c & 0x7f) * 2 ** s;
            s += 7;
        }
    }

    varint(): number { // zigzag
        const u = this.uvarint();
        return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
    }

    // Bulk readers.
    uvarints(out: Int32Array | Float64Array, from: number, to: number): void {
        const b = this.b;
        let p = this.p;
        for (let i = from; i < to; i++) {
            const c0 = b[p++];
            if (c0 < 0x80) {
                out[i] = c0;
                continue;
            }
            let x = c0 & 0x7f, sh = 7;
            for (;;) {
                const c = b[p++];
                if (c === undefined) throw new Error('timeline-wire: truncated varint');
                if (c < 0x80) {
                    x += c * 2 ** sh;
                    break;
                }
                x += (c & 0x7f) * 2 ** sh;
                sh += 7;
            }
            out[i] = x;
        }
        this.p = p;
    }

    // Running sums of zigzag deltas, straight into the output column. The
    // accumulator is the value already written, so a range resumes exactly
    // where the last one stopped.
    varintSums(out: Float64Array, from: number, to: number): void {
        const b = this.b;
        let p = this.p, acc = from === 0 ? 0 : out[from - 1];
        for (let i = from; i < to; i++) {
            let u = b[p++];
            if (u >= 0x80) {
                u &= 0x7f;
                let sh = 7;
                for (;;) {
                    const c = b[p++];
                    if (c === undefined) throw new Error('timeline-wire: truncated varint');
                    if (c < 0x80) {
                        u += c * 2 ** sh;
                        break;
                    }
                    u += (c & 0x7f) * 2 ** sh;
                    sh += 7;
                }
            }
            acc += u % 2 === 0 ? u / 2 : -(u + 1) / 2;
            out[i] = acc;
        }
        this.p = p;
    }

    // Running sums of unsigned deltas (ids), same resumption rule.
    uvarintSums(out: Float64Array, from: number, to: number): void {
        const b = this.b;
        let p = this.p, acc = from === 0 ? 0 : out[from - 1];
        for (let i = from; i < to; i++) {
            const c0 = b[p++];
            if (c0 < 0x80) {
                out[i] = acc += c0;
                continue;
            }
            let x = c0 & 0x7f, sh = 7;
            for (;;) {
                const c = b[p++];
                if (c === undefined) throw new Error('timeline-wire: truncated varint');
                if (c < 0x80) {
                    x += c * 2 ** sh;
                    break;
                }
                x += (c & 0x7f) * 2 ** sh;
                sh += 7;
            }
            out[i] = acc += x;
        }
        this.p = p;
    }

    bytes(n: number): Uint8Array {
        if (this.p + n > this.b.length) throw new Error('timeline-wire: truncated payload');
        const out = this.b.subarray(this.p, this.p + n);
        this.p += n;
        return out;
    }

    str(): string {
        return this.dec.decode(this.bytes(this.uvarint()));
    }

    // A dictionary can be large (unique ids per row), so reading one is
    // chunked like everything else.
    *dictChunked(): Task<string[]> {
        const n = this.uvarint();
        const out = new Array<string>(n);
        for (let i = 0; i < n; ) {
            const to = Math.min(i + STEP, n);
            for (; i < to; i++) out[i] = this.str();
            yield;
        }
        return out;
    }

    expectMagic(want: string): void {
        const got = String.fromCharCode(...this.bytes(4));
        if (got !== want) throw new Error(`timeline-wire: bad magic ${JSON.stringify(got)}`);
    }

    atEnd(): boolean {
        return this.p === this.b.length;
    }
}

/* */
function* chunked(n: number, work: (from: number, to: number) => void): Task<void> {
    for (let i = 0; i < n; ) {
        const to = Math.min(i + STEP, n);
        work(i, to);
        i = to;
        yield;
    }
}

/**
 * Decodes a payload into columns, yielding between chunks so a big page never
 * blocks a frame. Drive it with {@link runSliced}.
 *
 * Throws on bad magic, a truncated payload, or trailing bytes — a payload that
 * does not decode exactly is not a payload that decoded.
 */
export function* decodePageGen(buf: Uint8Array, schema: WireSchema): Task<DecodedPage> {
    const r = new WireReader(buf);
    r.expectMagic(schema.magic);
    const maxId = r.uvarint();
    const retentionStart = r.varint();
    const now = r.varint();
    const n = r.uvarint();

    const c: Columns = { n, u: {}, z: {}, p: {}, b: {}, s: {} };

    for (const name of schema.deltaU) {
        const out = new Float64Array(n);
        yield* chunked(n, (from, to) => r.uvarintSums(out, from, to));
        c.u[name] = out;
    }
    for (const name of schema.deltaZ) {
        const out = new Float64Array(n);
        yield* chunked(n, (from, to) => r.varintSums(out, from, to));
        c.z[name] = out;
    }
    for (const name of schema.plain) {
        const out = new Int32Array(n);
        yield* chunked(n, (from, to) => r.uvarints(out, from, to));
        c.p[name] = out;
    }
    for (const name of schema.bits) {
        c.b[name] = r.bytes((n + 7) >> 3);
    }
    for (const name of schema.strings) {
        const dict = yield* r.dictChunked();
        if (dict.length === 1) {
            c.s[name] = { dict, idx: null }; // column unused in this window
            continue;
        }
        const idx = new Int32Array(n);
        yield* chunked(n, (from, to) => r.uvarints(idx, from, to));
        c.s[name] = { dict, idx };
    }
    if (!r.atEnd()) throw new Error('timeline-wire: trailing bytes in payload');
    return { c, maxId, retentionStart, now };
}

/** Decodes a payload in one go. For tests and small pages; the chart uses
 *  {@link decodePageGen} under {@link runSliced}. */
export function decodePage(buf: Uint8Array, schema: WireSchema): DecodedPage {
    return drain(decodePageGen(buf, schema));
}

// ---- reading one row ----

/** Reads a string column at one row, honoring the unused-column encoding. */
export function stringAt(c: Columns, name: string, i: number): string {
    const col = c.s[name];
    if (!col) return '';
    return col.idx === null ? (col.dict[0] ?? '') : (col.dict[col.idx[i]] ?? '');
}

/** Reads a bitset column at one row. */
export function bitAt(c: Columns, name: string, i: number): boolean {
    const bits = c.b[name];
    return bits ? (bits[i >> 3] & (1 << (i & 7))) !== 0 : false;
}

/* */
export function rowOfId(c: Columns, idColumn: string, id: number): number {
    const ids = c.u[idColumn];
    if (!ids) return -1;
    let lo = 0, hi = c.n - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = ids[mid];
        if (v === id) return mid;
        if (v < id) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

/** Materializes one row as a flat object — every column, keyed by name. Call
 *  it once per tooltip, never per row. */
export function rowObject(c: Columns, i: number): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const [name, col] of Object.entries(c.u)) out[name] = col[i];
    for (const [name, col] of Object.entries(c.z)) out[name] = col[i];
    for (const [name, col] of Object.entries(c.p)) out[name] = col[i];
    for (const name of Object.keys(c.b)) out[name] = bitAt(c, name, i);
    for (const name of Object.keys(c.s)) out[name] = stringAt(c, name, i);
    return out;
}
