/**
 * FILE: src/lib/worker-manager.ts
 *
 * PURPOSE:
 *   This file is the bridge between the main UI thread and the Web Worker threads
 *   that do heavy data processing.  It manages a pool of workers (one per job type),
 *   dispatches jobs to them, and returns Promises that resolve when the worker finishes.
 *
 * WHAT IS A WEB WORKER?
 *   JavaScript normally runs in a single thread — there is only one "runner" executing
 *   code at a time.  If you run a slow operation (e.g. sorting 10 million rows) on
 *   the main thread, the entire UI freezes while it works because no other code can run.
 *
 *   A Web Worker is a separate JavaScript thread that runs in parallel to the main thread.
 *   Workers CAN:
 *     - Run any JavaScript/TypeScript computation
 *     - Use fetch(), OPFS, IndexedDB, crypto, etc.
 *   Workers CANNOT:
 *     - Access the DOM (document, window, HTML elements)
 *     - Access localStorage or sessionStorage
 *     - Use React or any UI library directly
 *
 *   Workers communicate with the main thread ONLY via messages:
 *     Main thread → Worker:  worker.postMessage(data)
 *     Worker → Main thread:  self.postMessage(data)  (inside the worker)
 *     Main thread receives:  worker.onmessage = (event) => { ... }
 *
 * WHAT IS postMessage?
 *   postMessage() is the function used to send data between the main thread and a worker.
 *   The data is SERIALISED (converted to a byte stream), sent across the thread boundary,
 *   and DESERIALISED on the other side.  This means the two threads do NOT share the same
 *   object in memory — each gets its own copy.
 *
 *   EXCEPTION: Transferable objects (like ArrayBuffer) can be TRANSFERRED instead of copied.
 *   Transferring moves ownership to the receiving thread instantly — no copy is made.
 *   The sending thread can no longer access the data after transferring it.
 *
 * WHAT IS THE PROTOCOL USED HERE?
 *   Every job sent to a worker has a unique jobId (a cuid2 string).
 *   The worker echoes back that jobId in every response message.
 *   This lets the manager match responses to the correct Promise.
 *
 *   There are 3 kinds of messages a worker can send back:
 *     kind: "progress" — the job is still running; here is a % complete
 *     kind: "result"   — the job finished; here is the output
 *     kind: "error"    — the job failed; here is the error message
 *
 * WHAT IS A WORKER POOL?
 *   Instead of creating a new Worker every time a job is dispatched, we keep one Worker
 *   alive per job type.  The first dispatch for "csv-sort" creates the csv-sort worker.
 *   All subsequent "csv-sort" jobs reuse that same worker.
 *   This avoids the ~50-200 ms startup cost of spawning a new OS thread each time.
 *
 * HOW PERFORMANCE SETTINGS ARE INJECTED:
 *   Workers run in a separate global scope — they cannot call localStorage.getItem().
 *   To give workers the user's performance settings (chunkSize, maxUnionRows…),
 *   the main thread reads localStorage, then merges those settings into every job's
 *   input payload before calling postMessage.  The worker reads these values from
 *   the job input object it receives.
 *
 * USED IN:
 *   src/features/executions/executors/* — every executor calls dispatchWorkerJob()
 *   src/app/layout.tsx (or app teardown) — terminateAllWorkers() may be called on unmount
 */

import { createId } from "@paralleldrive/cuid2";
import { getPerformanceSettings } from "./performance-settings";

/**
 * WorkerJobType
 *
 * WHY THIS EXISTS:
 *   This union type enumerates all valid job type strings that can be dispatched
 *   to a worker.  Each string corresponds to one worker file in /public/workers/.
 *   Using a union type instead of plain string prevents typos at compile time:
 *     dispatchWorkerJob("csv-parse", ...)  ← valid
 *     dispatchWorkerJob("csv_parse", ...)  ← TypeScript compile error
 *
 * WHAT IS A UNION TYPE?
 *   A union type is written as TypeA | TypeB | TypeC.
 *   It means "this value must be one of these exact options."
 *   TypeScript checks assignments at compile time, so a typo is caught immediately.
 *
 * USED IN:
 *   dispatchWorkerJob()   — first parameter
 *   getOrCreateWorker()   — key into workerPool Map
 *   getWorkerUrl()        — key into the URL lookup map
 *   WorkerJobMessage      — .type field
 */
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

/**
 * WorkerJobMessage<TInput>
 *
 * WHY THIS EXISTS:
 *   This is the shape of the message sent FROM the main thread TO a worker.
 *   The worker's onmessage handler receives an event where event.data matches
 *   this interface.
 *
 * WHAT IS a generic type parameter <TInput>?
 *   The angle bracket syntax <TInput> means "this interface works with any type
 *   for the input field — the caller decides what type."
 *   Example:
 *     WorkerJobMessage<{ filePath: string }>
 *   means: this message has jobId and type as usual, plus input: { filePath: string }.
 *   The generic makes the interface reusable for all job types.
 *
 * FIELD MEANINGS:
 *   jobId — unique identifier for this specific job instance (cuid2 string)
 *           used to match the worker's response back to the correct Promise
 *   type  — which kind of job this is (e.g. "csv-sort")
 *   input — the job-specific parameters (file path, sort columns, filters, etc.)
 *
 * USED IN:
 *   dispatchWorkerJob() — creates one of these before calling worker.postMessage()
 *   Every worker's onmessage handler — receives one of these as event.data
 */
export interface WorkerJobMessage<TInput = unknown> {
  jobId: string;
  type: WorkerJobType;
  input: TInput;
}

/**
 * WorkerProgressMessage
 *
 * WHY THIS EXISTS:
 *   Long-running workers (sort, join, parse) report progress back to the main thread
 *   so the UI can show a progress bar.  This is a discrete message type for that.
 *
 * FIELD MEANINGS:
 *   kind     — always "progress" so the manager knows which message type this is
 *   jobId    — which job is reporting progress (matches the jobId sent in the job)
 *   progress — a number from 0 to 100 representing % complete
 *   message  — optional human-readable status string (e.g. "Phase 1: sorting runs")
 *
 * USED IN:
 *   getOrCreateWorker() — the onmessage handler calls pending.onProgress() when kind is "progress"
 *   WorkerOutboundMessage — included as one variant
 */
export type WorkerProgressMessage = {
  kind: "progress";
  jobId: string;
  progress: number;
  message?: string;
};

/**
 * WorkerResultMessage<TOutput>
 *
 * WHY THIS EXISTS:
 *   When a worker successfully finishes its job, it sends back a result message.
 *   This is the "success" message type.
 *
 * FIELD MEANINGS:
 *   kind   — always "result" so the manager knows this is a successful completion
 *   jobId  — which job completed
 *   output — the job's output (e.g. a DatasetManifest, a boolean, an array)
 *            type is generic <TOutput> — callers choose what type to expect
 *
 * USED IN:
 *   getOrCreateWorker() — the onmessage handler calls pending.resolve(msg.output) when kind is "result"
 *   WorkerOutboundMessage — included as one variant
 */
export type WorkerResultMessage<TOutput = unknown> = {
  kind: "result";
  jobId: string;
  output: TOutput;
};

/**
 * WorkerErrorMessage
 *
 * WHY THIS EXISTS:
 *   When a worker fails (e.g. a file is not found, a calculation overflows),
 *   it sends back an error message.  This lets the main thread reject the
 *   Promise and show an error to the user.
 *
 * FIELD MEANINGS:
 *   kind  — always "error"
 *   jobId — which job failed
 *   error — a human-readable description of what went wrong (string, not Error object,
 *           because Error objects cannot always be serialised across threads)
 *
 * USED IN:
 *   getOrCreateWorker() — the onmessage handler calls pending.reject(new Error(msg.error))
 *   WorkerOutboundMessage — included as one variant
 */
export type WorkerErrorMessage = {
  kind: "error";
  jobId: string;
  error: string;
};

/**
 * WorkerOutboundMessage<TOutput>
 *
 * WHY THIS EXISTS:
 *   This is a union of the three possible message shapes a worker can send back.
 *   By typing worker.onmessage with this union, TypeScript forces the handler to
 *   check msg.kind before accessing kind-specific fields.
 *
 * WHAT IS A DISCRIMINATED UNION?
 *   Each variant has a shared field (kind) with a unique literal value.
 *   TypeScript uses that literal to narrow the type:
 *     if (msg.kind === "result") {
 *       msg.output  // ← TypeScript knows this field exists here
 *     }
 *   Without the discriminant, TypeScript would not know which fields are safe to access.
 *
 * USED IN:
 *   getOrCreateWorker() — worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => ...
 */
export type WorkerOutboundMessage<TOutput = unknown> =
  | WorkerProgressMessage
  | WorkerResultMessage<TOutput>
  | WorkerErrorMessage;

/**
 * PendingJob<TOutput> (private type)
 *
 * WHY THIS EXISTS:
 *   When dispatchWorkerJob() creates a Promise, it needs to store the Promise's
 *   resolve/reject functions somewhere so the onmessage handler can call them
 *   later when the worker responds.
 *   A PendingJob is that storage — it holds the callbacks until the job completes.
 *
 * WHAT IS resolve / reject?
 *   When you create a Promise manually:
 *     new Promise((resolve, reject) => { ... })
 *   The resolve and reject functions are the only way to settle the Promise.
 *   resolve(value) makes the Promise succeed with that value.
 *   reject(error) makes the Promise fail with that error.
 *   By storing these outside the Promise constructor, other code can settle it later.
 *
 * FIELD MEANINGS:
 *   resolve    — call this with the output when the job succeeds
 *   reject     — call this with an Error when the job fails
 *   onProgress — optional callback to call on each progress update (used to update UI)
 *
 * USED IN:
 *   pendingJobs Map — values are PendingJob instances
 *   getOrCreateWorker() → worker.onmessage — retrieves PendingJob to settle the Promise
 */
type PendingJob<TOutput> = {
  resolve: (value: TOutput) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: number, message?: string) => void;
};

// ─── Worker pool ──────────────────────────────────────────────────────────────

/**
 * workerPool
 *
 * WHY THIS EXISTS:
 *   Stores one Worker instance per WorkerJobType (lazy-initialized on first use).
 *   Reusing workers avoids the startup overhead of spawning a new OS thread on
 *   every job dispatch.
 *
 * WHAT IS a Map?
 *   A Map is a JavaScript data structure that stores key-value pairs.
 *   Unlike a plain object ({ }), Maps allow any type as keys, maintain insertion order,
 *   and have O(1) get/set/has/delete operations.
 *     map.set("csv-sort", worker)   → stores
 *     map.get("csv-sort")           → retrieves
 *     map.has("csv-sort")           → checks existence
 *     map.delete("csv-sort")        → removes
 *
 * USED IN:
 *   getOrCreateWorker() — checks if a worker exists, creates if not
 *   terminateAllWorkers() — iterates all workers and calls .terminate()
 *   worker.onerror handler — removes crashed worker so a fresh one is created next time
 */
const workerPool = new Map<WorkerJobType, Worker>();

/**
 * pendingJobs
 *
 * WHY THIS EXISTS:
 *   When a job is dispatched, its Promise resolve/reject callbacks are stored here
 *   keyed by jobId.  When the worker sends back a response, the onmessage handler
 *   looks up the jobId in this Map and calls the appropriate callback.
 *
 * WHY noExplicitAny?
 *   Different job types return different output shapes (TOutput is generic).
 *   Since this Map must hold pending jobs for ALL job types, we use `any` here.
 *   The type safety is enforced at the call site of dispatchWorkerJob<TInput, TOutput>().
 *
 * USED IN:
 *   dispatchWorkerJob()   — adds a new PendingJob entry
 *   worker.onmessage      — looks up, calls, and deletes entries
 *   worker.onerror        — rejects all pending jobs when a worker crashes
 */
// biome-ignore lint/suspicious/noExplicitAny: generic job map
const pendingJobs = new Map<string, PendingJob<any>>();

/**
 * getWorkerUrl()
 *
 * WHY THIS EXISTS:
 *   Maps a WorkerJobType string to the URL of the compiled worker script in /public/workers/.
 *   The worker scripts are compiled by esbuild (scripts/build-workers.mjs) from TypeScript
 *   source files in src/workers/ into plain JavaScript files in public/workers/.
 *
 * WHY ARE WORKERS IN /public/?
 *   When the Next.js static export runs, files in /public/ are copied to the output
 *   directory as-is.  A Worker needs a URL pointing to a real .js file that the browser
 *   can fetch.  Placing them in /public/workers/ makes them available at /workers/filename.js.
 *
 * WHAT IS a Record<K, V>?
 *   Record<K, V> is a TypeScript utility type for an object where:
 *     - every key is of type K
 *     - every value is of type V
 *   Record<WorkerJobType, string> means: an object with one string value for every
 *   possible WorkerJobType.  TypeScript will error if any job type is missing from the map.
 *
 * CALLED FROM:
 *   getOrCreateWorker() — used to construct the Worker with new Worker(url, ...)
 */
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

/**
 * getOrCreateWorker()
 *
 * WHY THIS EXISTS:
 *   Implements the lazy-initialization pattern for the worker pool.
 *   On first call for a given type, it:
 *     1. Creates a new Worker from the compiled .js file with { type: "module" }.
 *     2. Sets up the onmessage handler to route responses to the correct Promise.
 *     3. Sets up the onerror handler to reject all pending jobs if the worker crashes.
 *     4. Stores the worker in workerPool for reuse.
 *   On subsequent calls, returns the existing worker immediately.
 *
 * WHAT IS { type: "module" }?
 *   Modern workers support ES module syntax (import/export).
 *   Passing { type: "module" } tells the browser to load the worker script as an
 *   ES module rather than as a classic script (which uses importScripts()).
 *   This is required because esbuild compiles the workers as ES modules.
 *
 * HOW THE onmessage HANDLER WORKS:
 *   Every message from the worker has a jobId.
 *   The handler looks up that jobId in pendingJobs to find the resolve/reject callbacks.
 *   If kind is "progress" → calls onProgress callback (updates UI progress bar).
 *   If kind is "result"   → calls resolve(output) → the awaited Promise resolves.
 *   If kind is "error"    → calls reject(new Error(msg)) → the awaited Promise rejects.
 *   After result or error, the PendingJob is deleted from the map (it's done).
 *
 * HOW THE onerror HANDLER WORKS:
 *   If the worker itself crashes (unhandled exception, not a job-level error),
 *   ALL pending jobs for that worker are rejected.
 *   The crashed worker is removed from the pool so a fresh one is created next time.
 *
 * CALLED FROM:
 *   dispatchWorkerJob() — to get the worker that should receive the job message
 */
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

/**
 * dispatchWorkerJob()
 *
 * WHY THIS EXISTS:
 *   This is the single public function that all executors call to run a heavy
 *   computation in a background worker.  It hides all the complexity of:
 *     - Worker lifecycle (lazy creation, pooling)
 *     - Job ID generation and tracking
 *     - Promise wrapping of the message-based protocol
 *     - Performance settings injection
 *
 * WHAT IT DOES STEP BY STEP:
 *   1. Creates a new Promise<TOutput>.
 *   2. Generates a unique jobId (via cuid2).
 *   3. Stores { resolve, reject, onProgress } in pendingJobs keyed by jobId.
 *   4. Gets (or creates) the worker for this job type.
 *   5. Reads the user's performance settings from localStorage (main thread can do this).
 *   6. Merges performance settings into the input object so workers receive them.
 *   7. Builds a WorkerJobMessage and calls worker.postMessage(message, transferList).
 *   8. Returns the Promise — the caller awaits it.
 *   The Promise resolves/rejects when the worker sends back a "result"/"error" message.
 *
 * WHAT IS a Transferable[]?
 *   Some objects (like ArrayBuffer) can be transferred to the worker instead of copied.
 *   Transferring is O(1) — the main thread hands ownership to the worker instantly.
 *   After transfer, the main thread can no longer access the object.
 *   Example: transferring a 100 MB ArrayBuffer takes microseconds vs ~100ms to copy.
 *   The caller passes the objects to transfer in the `transfer` array.
 *
 * HOW PERFORMANCE SETTINGS ARE INJECTED:
 *   Workers cannot read localStorage.  So this function:
 *   1. Calls getPerformanceSettings() (reads localStorage on main thread).
 *   2. Spreads those settings into the input before postMessage.
 *   Workers then read e.g. input.chunkSize instead of calling localStorage.
 *
 * WHAT IS Object.fromEntries(Object.entries(...).filter(...))?
 *   This removes any keys with undefined values from the input object.
 *   Undefined values cannot be serialised by the structured clone algorithm
 *   (used internally by postMessage) — they would be silently dropped.
 *   Filtering them out explicitly prevents hard-to-debug missing-key issues.
 *
 * PARAMETERS:
 *   type       — which worker job type to dispatch
 *   input      — job-specific input data
 *   onProgress — optional callback called with (percentage, message) on progress updates
 *   transfer   — optional list of Transferable objects to move to the worker
 *
 * RETURNS:
 *   Promise<TOutput> — resolves with the worker's output when the job completes
 *
 * CALLED FROM:
 *   src/features/executions/executors/csv-parse/executor.ts
 *   src/features/executions/executors/csv-sort/executor.ts
 *   src/features/executions/executors/csv-filter/executor.ts
 *   (and every other executor that dispatches a worker job)
 */
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

/**
 * terminateAllWorkers()
 *
 * WHY THIS EXISTS:
 *   Calling worker.terminate() kills the worker OS thread and frees its memory.
 *   This should be called when the app is unmounting or when the user logs out
 *   to prevent orphaned threads from continuing to consume CPU and RAM.
 *
 * WHAT HAPPENS TO PENDING JOBS?
 *   Any pending jobs at the time of termination are silently abandoned —
 *   their Promises will never resolve or reject.  This is acceptable because
 *   terminateAllWorkers() is only called during app teardown, at which point
 *   the UI is also being torn down and no one is awaiting those Promises.
 *
 * CALLED FROM:
 *   src/app/layout.tsx or app teardown — on component unmount
 */
/** Terminate all workers (call on app teardown if needed). */
export function terminateAllWorkers(): void {
  for (const [type, worker] of workerPool.entries()) {
    worker.terminate();
    workerPool.delete(type);
  }
}
