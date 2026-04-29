/**
 * Browser Web Worker Manager
 *
 * Replaces BullMQ + Redis for client-side job dispatch.
 * Each worker type gets its own Web Worker instance (lazy-created).
 * Jobs are dispatched via postMessage and resolved via a Promise map.
 */

import { createId } from "@paralleldrive/cuid2";
import { getPerformanceSettings } from "./performance-settings";

export type WorkerJobType =
  | "csv-parse"
  | "csv-filter"
  | "csv-sort"
  | "csv-join"
  | "csv-aggregate"
  | "csv-deduplicate"
  | "csv-compare"
  | "csv-transform"
  | "csv-column-transform"
  | "csv-restructure"
  | "csv-consecutive-sequence"
  | "pdf-extract-text"
  | "pdf-extract-tables";

export interface WorkerJobMessage<TInput = unknown> {
  jobId: string;
  type: WorkerJobType;
  input: TInput;
}

export type WorkerProgressMessage = {
  kind: "progress";
  jobId: string;
  progress: number;
  message?: string;
};

export type WorkerResultMessage<TOutput = unknown> = {
  kind: "result";
  jobId: string;
  output: TOutput;
};

export type WorkerErrorMessage = {
  kind: "error";
  jobId: string;
  error: string;
};

export type WorkerOutboundMessage<TOutput = unknown> =
  | WorkerProgressMessage
  | WorkerResultMessage<TOutput>
  | WorkerErrorMessage;

type PendingJob<TOutput> = {
  resolve: (value: TOutput) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: number, message?: string) => void;
};

// ─── Worker pool ──────────────────────────────────────────────────────────────

const workerPool = new Map<WorkerJobType, Worker>();
// biome-ignore lint/suspicious/noExplicitAny: generic job map
const pendingJobs = new Map<string, PendingJob<any>>();

function getWorkerUrl(type: WorkerJobType): string {
  const map: Record<WorkerJobType, string> = {
    "csv-parse": "/workers/csv-parse.worker.js",
    "csv-filter": "/workers/csv-filter.worker.js",
    "csv-sort": "/workers/csv-sort.worker.js",
    "csv-join": "/workers/csv-join.worker.js",
    "csv-aggregate": "/workers/csv-aggregate.worker.js",
    "csv-deduplicate": "/workers/csv-deduplicate.worker.js",
    "csv-compare": "/workers/csv-compare.worker.js",
    "csv-transform": "/workers/csv-transform.worker.js",
    "csv-column-transform": "/workers/csv-column-transform.worker.js",
    "csv-restructure": "/workers/csv-restructure.worker.js",
    "csv-consecutive-sequence": "/workers/csv-consecutive-sequence.worker.js",
    "pdf-extract-text": "/workers/pdf-extract-text.worker.js",
    "pdf-extract-tables": "/workers/pdf-extract-tables.worker.js",
  };
  return map[type];
}

function getOrCreateWorker(type: WorkerJobType): Worker {
  const existing = workerPool.get(type);
  if (existing) return existing;

  const worker = new Worker(getWorkerUrl(type), { type: "module" });

  worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
    const msg = event.data;
    const pending = pendingJobs.get(msg.jobId);
    if (!pending) return;

    if (msg.kind === "progress") {
      pending.onProgress?.(msg.progress, msg.message);
    } else if (msg.kind === "result") {
      pendingJobs.delete(msg.jobId);
      pending.resolve(msg.output);
    } else if (msg.kind === "error") {
      pendingJobs.delete(msg.jobId);
      pending.reject(new Error(msg.error));
    }
  };

  worker.onerror = (event) => {
    console.error(`[WorkerManager] Worker ${type} crashed:`, event.message);
    for (const [jobId, pending] of pendingJobs.entries()) {
      pending.reject(new Error(`Worker ${type} crashed: ${event.message ?? "unknown error"}`));
      pendingJobs.delete(jobId);
    }
    workerPool.delete(type);
  };

  workerPool.set(type, worker);
  return worker;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function dispatchWorkerJob<TInput, TOutput>(
  type: WorkerJobType,
  input: TInput,
  onProgress?: (progress: number, message?: string) => void,
  transfer?: Transferable[],
): Promise<TOutput> {
  return new Promise<TOutput>((resolve, reject) => {
    const jobId = createId();
    pendingJobs.set(jobId, { resolve, reject, onProgress });
    const worker = getOrCreateWorker(type);
    // Inject current performance settings so workers can use user-tuned limits
    // without needing to read localStorage (which is unavailable inside workers).
    const perfSettings = getPerformanceSettings();
    const safeInput = Object.fromEntries(
      Object.entries((input as object) ?? {}).filter(([, v]) => v !== undefined),
    );
    const enrichedInput = { ...perfSettings, ...safeInput } as TInput;
    const message: WorkerJobMessage<TInput> = { jobId, type, input: enrichedInput };
    worker.postMessage(message, transfer ?? []);
  });
}

/** Terminate all workers (call on app teardown if needed). */
export function terminateAllWorkers(): void {
  for (const [type, worker] of workerPool.entries()) {
    worker.terminate();
    workerPool.delete(type);
  }
}
