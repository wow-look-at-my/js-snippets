// Both halves of running the APNG encoder off the main thread: the worker-side
// message handler, and the main-thread client that talks to it.
//
// Encoding is CPU-bound for as long as it takes — diffing every pixel of every
// frame, then deflating each one, possibly several times over at effort 'best'.
// On the main thread that is a frozen page, so this module exists to make the
// off-thread path the easy one. There is deliberately NO in-page fallback: if a
// worker cannot be created, `createApngEncoder` throws rather than quietly
// blocking the UI it was written to protect.
//
// A worker script must be same-origin, so the consumer owns a two-line worker
// file of its own and this module supplies the body:
//
//   // apng-worker.js — served from the consumer's own origin
//   import { installApngWorker } from 'https://…/apng/worker.js';
//   installApngWorker();
//
//   // main thread
//   const encoder = createApngEncoder(new URL('./apng-worker.js', import.meta.url));
//   const result = await encoder.encode(w, h, frames, { threshold: 2 }, onProgress);

import { encodeApng, type ApngFrame, type ApngOptions, type ApngResult } from './encoder.ts';

/** The `ApngOptions` that survive a structured clone — no functions. */
export type ApngWorkerOptions = Omit<ApngOptions, 'deflate' | 'onProgress'>;

/** Message posted to the worker to start an encode. */
export interface ApngEncodeRequest {
  type: 'apng:encode';
  id: number;
  width: number;
  height: number;
  frames: { data: Uint8Array; delayMs?: number }[];
  options: ApngWorkerOptions;
}

/** Messages the worker posts back. */
export type ApngWorkerResponse =
  | { type: 'apng:progress'; id: number; done: number; total: number }
  | { type: 'apng:done'; id: number; result: ApngResult }
  | { type: 'apng:error'; id: number; message: string };

// The slice of a worker global this module needs, so nothing here depends on
// whether the ambient lib types describe a window or a worker.
interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  postMessage(message: ApngWorkerResponse, transfer: Transferable[]): void;
}

/**
 * Install the encode handler on the current worker global.
 *
 * Throws when called on a thread that has a `document` — that is the main
 * thread, and running the encoder there is the exact thing this module exists
 * to prevent.
 */
export function installApngWorker(): void {
  const scope = globalThis as unknown as WorkerScope & { document?: unknown };
  if (typeof scope.document !== 'undefined') {
    throw new Error('installApngWorker() must run inside a Worker, not on the main thread');
  }

  scope.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as ApngEncodeRequest | undefined;
    if (!msg || msg.type !== 'apng:encode') return;
    const { id } = msg;

    void (async () => {
      try {
        const result = await encodeApng(msg.width, msg.height, msg.frames, {
          ...msg.options,
          onProgress: (done, total) => {
            scope.postMessage({ type: 'apng:progress', id, done, total }, []);
          },
        });
        scope.postMessage({ type: 'apng:done', id, result }, [result.bytes.buffer]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        scope.postMessage({ type: 'apng:error', id, message }, []);
      }
    })();
  });
}

/** Progress callback: `done` of `total` source frames processed. */
export type ApngProgress = (done: number, total: number) => void;

/** Main-thread handle to an encoder worker. */
export interface ApngEncoder {
  /**
   * Encode one animation. Rejects if the worker fails; never runs the encoder
   * in this thread.
   */
  encode(
    width: number,
    height: number,
    frames: readonly ApngFrame[],
    options?: ApngWorkerOptions,
    onProgress?: ApngProgress,
  ): Promise<ApngResult>;
  /**
   * Kill the worker, rejecting everything in flight. A later `encode` starts a
   * fresh one — this is how a caller abandons a long encode whose inputs just
   * changed.
   */
  terminate(): void;
}

/**
 * Create a main-thread client for a worker running `installApngWorker()`.
 *
 * The worker is spawned lazily on the first `encode` and respawned after
 * `terminate()`. `transferFrames` moves the frame buffers into the worker
 * instead of copying them, which is faster and halves peak memory but leaves
 * the caller's arrays detached — only pass it for frames you are done with.
 */
export function createApngEncoder(
  workerUrl: string | URL,
  { transferFrames = false }: { transferFrames?: boolean } = {},
): ApngEncoder {
  interface Pending {
    resolve: (r: ApngResult) => void;
    reject: (e: Error) => void;
    onProgress?: ApngProgress;
  }
  const pending = new Map<number, Pending>();
  let worker: Worker | null = null;
  let nextId = 1;

  function spawn(): Worker {
    if (worker) return worker;
    const w = new Worker(workerUrl, { type: 'module' });
    w.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data as ApngWorkerResponse | undefined;
      if (!msg) return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      if (msg.type === 'apng:progress') {
        entry.onProgress?.(msg.done, msg.total);
        return;
      }
      pending.delete(msg.id);
      if (msg.type === 'apng:done') entry.resolve(msg.result);
      else entry.reject(new Error(msg.message));
    });
    w.addEventListener('error', (event: ErrorEvent) => {
      const err = new Error(`APNG worker failed: ${event.message || 'unknown error'}`);
      for (const entry of pending.values()) entry.reject(err);
      pending.clear();
    });
    worker = w;
    return w;
  }

  return {
    encode(width, height, frames, options = {}, onProgress) {
      const w = spawn();
      const id = nextId++;
      const payload = frames.map((f) => ({
        data: f.data instanceof Uint8Array
          ? f.data
          : new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.length),
        delayMs: f.delayMs,
      }));
      const request: ApngEncodeRequest = {
        type: 'apng:encode', id, width, height, frames: payload, options,
      };
      return new Promise<ApngResult>((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress });
        const transfer = transferFrames ? payload.map((f) => f.data.buffer) : [];
        w.postMessage(request, transfer);
      });
    },
    terminate() {
      if (worker) {
        worker.terminate();
        worker = null;
      }
      const err = new Error('APNG encode cancelled: the worker was terminated');
      for (const entry of pending.values()) entry.reject(err);
      pending.clear();
    },
  };
}
