# Web Worker Architecture Assessment

> **Original title:** BullMQ Worker Architecture Assessment
> **Original date:** 2026-04-12
> **Revised title:** Web Worker Architecture Assessment
> **Revised:** 2026-05-31
> **Reason for revision:** BullMQ, Redis, and Inngest no longer exist in the codebase. The architecture migrated from server-side Node.js job queues to browser-native Web Workers. Every issue in the original document has been re-evaluated against the current implementation.
> **Scope:** Worker pool (`src/lib/worker-manager.ts`), all 15 worker job types (`src/workers/`), the execution engine (`src/lib/execution-engine.ts`), and OPFS storage (`src/workers/_opfs-helpers.ts`).

---

## Before Anything Else — What Is a Web Worker?

The entire document revolves around Web Workers, so let us start here.

**JavaScript is single-threaded.** That means only one thing can run at a time in a browser tab. If you ask JavaScript to sort 10 million rows of data, the browser cannot do anything else while it is sorting — the UI freezes, clicks do not register, the page appears broken. This is called "blocking the main thread."

**A Web Worker is a background thread.** Think of it like this: the browser tab is a restaurant. The main thread is the waiter — the only person the customer (the user) talks to. The waiter must always be available to respond immediately. If the waiter has to cook every dish themselves, the customer waits and waits with no feedback.

Web Workers are the kitchen cooks. They work in the back room, doing all the heavy cooking, completely out of sight. The waiter hands a ticket (a job message) through the ticket window (postMessage), the cook does the work, and hands back a claim ticket (the result). The waiter and the customer never freeze — they can keep talking while the cook is busy.

Web Workers:
- **CAN** run any JavaScript computation: sorting, parsing, writing to OPFS, reading files.
- **CANNOT** access the DOM (HTML elements), localStorage, or React.
- **COMMUNICATE ONLY** via `postMessage()` — there is no shared memory between the waiter and the cook.

---

## What Happened to the Old Architecture?

The original document evaluated an architecture that used:
- **BullMQ** — a job queue (like a to-do list stored in Redis) for scheduling work.
- **Redis** — an in-memory database (extremely fast key-value storage) that held the queue.
- **Inngest** — a managed background job service that orchestrated multi-step workflows on external servers.
- **Server-side Node.js worker processes** — separate programs running on a server that picked jobs from BullMQ and did the actual CSV/PDF processing.
- **Local filesystem** (`C:/autopilotdata`) — where datasets were stored on the server's disk.

**None of this exists in the current codebase.**

The architecture has been replaced entirely with a browser-native stack:
- **Web Workers** replace BullMQ workers — they are browser threads, not server processes.
- **OPFS** replaces the local filesystem — it is a browser-native private file system.
- **postMessage** replaces the BullMQ job queue — messages are passed directly between the main thread and the worker thread with no intermediary.
- **The execution engine** (`src/lib/execution-engine.ts`) replaces Inngest — it is a pure JavaScript function running in the browser.
- **Redis is completely gone** — there is no in-memory database, no queue, no connection management.

---

## Status of Every Original Issue

The original document identified 15 issues. Here is the current status of each:

| Original Issue | Current Status | Explanation |
|---|---|---|
| Redis connection proliferation (new Queue per call) | **RESOLVED** | No Redis at all. The worker pool reuses one thread per job type with zero connection overhead. |
| Inngest–BullMQ timeout incoherence | **RESOLVED** | No external timeout exists. Web Workers run until they finish — the browser never times them out. |
| Dual complete/failed event pattern | **RESOLVED** | No event bus. Workers send `postMessage({ kind: "error" })` directly — one message, one path. |
| csv-join failure asymmetry (active bug) | **RESOLVED** | The join worker sends `{ kind: "error", jobId, error }` on failure, which the worker manager handles uniformly with all other workers. |
| Memory budget in process memory (resets on cold start) | **TRANSFORMED** | No process memory budget exists. The risk has shifted: the V8 JavaScript engine has a per-thread heap limit (~1–1.5 GB), and there is no enforcement mechanism to prevent individual workers from approaching it. |
| Worker deployment undefined | **RESOLVED** | Workers are compiled JavaScript files in `/public/workers/`. They are served with the static site and run inside the user's browser — no separate hosting decision needed. |
| Local filesystem cannot be shared across hosts | **RESOLVED** | OPFS is per-browser, per-origin. There is no shared filesystem to manage. |
| All workers sharing one Node.js process (OOM kills all queues) | **TRANSFORMED** | All workers share one browser tab's V8 heap. An OOM crash in one worker terminates that worker's thread but does not kill others (each worker is a separate OS thread). However, the overall browser tab can still OOM under combined memory pressure from all workers. |
| Sequence analyzer unbounded group Map | **CONFIRMED — still present** | `runMap` in `csv-consecutive-sequence.worker.ts` still has no size limit or spill-to-disk strategy. |
| mprocs.yaml missing 4 of 5 workers | **RESOLVED** | mprocs.yaml is a dev-only configuration tool. Production workers are compiled static files — no process manager needed. |
| `tsx watch` restarts orphan in-flight jobs | **RESOLVED** | Workers are pre-compiled JavaScript bundles. There is no hot-reload mechanism in production. |
| No BullMQ dashboard | **TRANSFORMED** | No queue dashboard equivalent. The browser's DevTools (Application → IndexedDB, Application → Storage → OPFS) is the only visibility tool. No queue depth metrics or dead-letter handling exists. |
| Home-built slot semaphore (666+ Redis ops/sec) | **RESOLVED** | No slot management exists. The worker pool handles concurrency naturally — each job type has one thread that processes messages serially. |
| Progress events fire-and-forget under Inngest rate limiting | **TRANSFORMED** | Progress events are sent via `postMessage()` — they are not rate-limited by an external service. However, if a worker crashes while sending a progress update, the update is lost silently. |

---

## Technology Glossary

| Term | Plain-English Meaning |
|------|-----------------------|
| **Web Worker** | A background JavaScript thread — the kitchen cook; does heavy work without freezing the UI |
| **postMessage** | The ticket window — the only way for the main thread and a worker to communicate |
| **jobId** | A unique identifier for one specific job, used to match the worker's reply to the correct Promise |
| **Promise** | A JavaScript object that represents a value that will be available later (like an IOU) |
| **resolve / reject** | The two ways to settle a Promise: `resolve(value)` means "here is the result," `reject(error)` means "something went wrong" |
| **pendingJobs Map** | A key-value store (Map) that holds the resolve/reject callbacks for every in-flight job, keyed by jobId |
| **worker pool** | A roster of worker threads — one per job type, lazy-created on first use, reused forever |
| **OPFS** | Origin Private File System — browser-native file storage, like a private hard drive for this website only |
| **DatasetRef** | A claim ticket pointing to where a dataset lives in OPFS |
| **esbuild** | The build tool that compiles TypeScript worker files into plain JavaScript files in `/public/workers/` |
| **discriminated union** | A TypeScript pattern where a shared `kind` field tells TypeScript which variant of a type you have |
| **V8** | The JavaScript engine inside Chrome/Node.js that executes JavaScript; has a per-thread memory limit |
| **OOM** | Out Of Memory — when a program tries to allocate more memory than available; the OS kills the process (or thread) |
| **heap** | The region of memory where JavaScript objects live; grows as you create more objects |

---

## 1. How the Worker Pool Works (The Core Architecture)

This section explains the complete machinery in `src/lib/worker-manager.ts` from first principles.

### 1.1 The Three Maps

Three global data structures coordinate all worker activity:

**`workerPool: Map<WorkerJobType, Worker>`**
Stores one active Worker thread per job type. If `workerPool.get("csv-sort")` returns a Worker, that thread is alive and ready to receive messages. If it returns `undefined`, the worker for that type has not been created yet (or crashed).

*Why one per type?* Creating a new Worker has a startup cost (~50–200 ms) — the browser must spawn an OS thread, compile the worker script, and initialize the JavaScript engine inside it. Reusing one thread per type eliminates this cost after the first job.

**`pendingJobs: Map<string, PendingJob>`**
Stores the resolve/reject callbacks for every job that has been dispatched but not yet completed. Keys are jobIds.

When you call `await dispatchWorkerJob("csv-sort", input)`, JavaScript creates a Promise and immediately needs somewhere to store the resolve and reject functions so the worker's onmessage handler can call them later. `pendingJobs` is that storage.

**`getWorkerUrl(): Record<WorkerJobType, string>`**
Maps each job type string to its compiled worker file URL:
```
"csv-sort" → "/workers/csv-sort.worker.js"
"pdf-merge" → "/workers/pdf-merge.worker.js"
...
```
These files are compiled by esbuild before the app is built and served as static files.

### 1.2 The Message Protocol

Every message between the main thread and a worker follows a strict protocol. This is called a **discriminated union** — each message has a `kind` field that uniquely identifies its type:

**Main thread → Worker (job dispatch):**
```
WorkerJobMessage {
  jobId: "abc123"       // unique identifier for this specific job
  type: "csv-sort"      // which kind of job
  input: { ... }        // job-specific parameters + performance settings
}
```

**Worker → Main thread (three possible replies):**
```
kind: "progress"   → { kind, jobId, progress: 0-100, message? }
kind: "result"     → { kind, jobId, output: { manifest, datasetRef, ... } }
kind: "error"      → { kind, jobId, error: "Something went wrong" }
```

The `onmessage` handler in `getOrCreateWorker()` reads the `kind` field and routes accordingly:
- `"progress"` → calls the `onProgress` callback (updates the UI progress bar).
- `"result"` → calls `resolve(output)` (the executor's awaited Promise resolves).
- `"error"` → calls `reject(new Error(msg.error))` (the executor's Promise rejects, the node fails).

After `"result"` or `"error"`, the PendingJob entry is deleted from the map — it is done.

### 1.3 Dispatching a Job — Step by Step

When a CSV sort executor calls `dispatchWorkerJob("csv-sort", { inputRef, sortColumns })`:

1. A new Promise is created. Its `resolve` and `reject` functions are stored.
2. A `jobId` is generated (a random unique string using cuid2).
3. `{ resolve, reject, onProgress }` are stored in `pendingJobs.set(jobId, ...)`.
4. The worker for "csv-sort" is retrieved (or created if first use).
5. `getPerformanceSettings()` reads `localStorage` on the main thread (workers cannot access localStorage).
6. Performance settings (chunkSize, maxUnionRows) are merged into the input.
7. `worker.postMessage({ jobId, type: "csv-sort", input: enrichedInput })` is called.
8. The executor's `await dispatchWorkerJob(...)` suspends — it is waiting for the Promise.

Meanwhile, the worker thread receives the message via `self.onmessage`, does the sort (potentially for 30 minutes), and then calls `self.postMessage({ kind: "result", jobId, output })`. The main thread's `onmessage` handler fires, looks up `jobId` in `pendingJobs`, finds the `resolve` callback, calls `resolve(output)`, and the executor's Promise resolves. Execution continues to the next node.

---

## 2. CRITICAL: Missing Compiled Worker Files

**Status: CRITICAL BUG — discovered during this review**

The `WorkerJobType` union in `worker-manager.ts` defines **15 job types**. The `getWorkerUrl()` function maps all 15 to compiled JavaScript files in `/public/workers/`.

However, **not all 15 compiled files exist.**

The executor registry in `execution-engine.ts` registers `PDF_MERGE` and `PDF_SPLIT` as valid node types. Their executors call `dispatchWorkerJob("pdf-merge", ...)` and `dispatchWorkerJob("pdf-split", ...)`. When those executors run, `getOrCreateWorker()` calls:
```javascript
new Worker("/workers/pdf-merge.worker.js", { type: "module" })
```

If `/workers/pdf-merge.worker.js` does not exist on the server, the browser throws a network error. The `worker.onerror` handler fires, rejects all pending jobs for that worker, and the execution engine marks the node as FAILED with a message like "Worker pdf-merge crashed: network error."

**The user experience:** They add a PDF Merge node, run the workflow, and see "Node failed" with no useful error message. They cannot tell if their input data was wrong or if the software itself is broken.

**Root cause:** The esbuild worker build script (`scripts/generate-sw-manifest.mjs` or equivalent) does not compile all source files in `src/workers/`. The `pdf-merge.worker.ts` and `pdf-split.worker.ts` source files exist but are not included in the build.

**How to verify:** List the files in `/public/workers/` and compare against the 15 entries in `WorkerJobType`. Any missing file is a broken node type.

**Fix (Immediate):**
1. Add `pdf-merge.worker.ts` and `pdf-split.worker.ts` to the esbuild input file list.
2. Add a build-time check: after building, verify that every `WorkerJobType` entry has a corresponding `.worker.js` file. If any is missing, fail the build with a clear error message.

```javascript
// Example build-time check (add to build script)
const EXPECTED_WORKERS = [
  "csv-parse", "csv-filter", "csv-sort", "csv-join", "csv-aggregate",
  "csv-deduplicate", "csv-compare", "csv-transform", "csv-column-transform",
  "csv-restructure", "csv-consecutive-sequence",
  "pdf-extract-text", "pdf-extract-tables", "pdf-merge", "pdf-split"
];
for (const type of EXPECTED_WORKERS) {
  const path = `public/workers/${type}.worker.js`;
  if (!fs.existsSync(path)) {
    throw new Error(`Missing compiled worker: ${path}`);
  }
}
```

---

## 3. HIGH: Worker Queue Stall on Duplicate Job Types

**Status: NEW — silent failure mode unique to the Web Worker architecture**

The worker pool holds **one Worker instance per job type.** Web Workers process incoming `postMessage` calls **serially** — one at a time, in the order received.

This creates a hidden problem: if two nodes in the same workflow both use the same worker type (e.g. two CSV Sort nodes), the second node's job is queued inside the worker's message buffer behind the first. The second sort cannot begin until the first sort is completely finished.

**Example:** Consider a workflow that sorts two datasets before joining them:

```
Upload Customers (CSV) → Sort by CustomerID → Join Result
Upload Orders (CSV)    → Sort by CustomerID ↗
```

Both "Sort" nodes dispatch to the "csv-sort" worker. Execution order:
1. Sort Customers dispatches its job. The csv-sort worker starts sorting.
2. Sort Orders dispatches its job. It is sent to the **same** csv-sort worker thread, which is busy.
3. The Sort Orders job waits silently in the worker's internal message queue.
4. Sort Customers finishes (say, 20 minutes for 400 MB).
5. **Only now** does Sort Orders begin (another 20 minutes).
6. Total time: 40 minutes, instead of 20 minutes if they had run concurrently.

**There is no user-visible indication of this.** The Sort Orders node shows "running" the moment its executor dispatches the job — but the worker has not actually started it yet.

**Why this happens:** The `pendingJobs` Map correctly stores both jobs as pending. Both resolve callbacks are registered. But the worker's event loop is a queue: message 1 is processed, then message 2, then message 3. There is no parallel processing within one worker thread.

**How to detect it now:** Add a `console.warn` in `getOrCreateWorker()` when a second job is dispatched to a worker that already has a pending job. That at least makes the stall visible in browser DevTools.

**Full fix:**
Implement a "queued" status in the execution engine. When a job is dispatched to a worker that already has a pending job of the same type, set the node's status to "queued" (a new NodeStatus value). The UI shows a clock icon instead of a spinner. When the first job finishes and the worker processes the second, the status transitions to "running." This requires:
- A new `"queued"` value in `NodeStatus`.
- Tracking in `worker-manager.ts` of which job types currently have in-flight jobs.
- A UI component update to render the queued state.

---

## 4. HIGH: Sequence Analyzer Unbounded Group Map

**Status: CONFIRMED — unchanged from original critique, still present**

The consecutive sequence analyzer worker holds one `RunState` object in a Map for every distinct group key it encounters:

```typescript
// From src/workers/csv-consecutive-sequence.worker.ts (line 64)
const runMap = new Map<string, RunState>();
```

`RunState` is a small object — just four numbers: `{ start, end, length, prevVal }`. For a dataset grouped by a single ID column:
- 100,000 unique IDs → ~100,000 Map entries → roughly 10–20 MB. Fine.
- 5,000,000 unique IDs → ~5,000,000 Map entries → roughly 500–1,000 MB. Worker crashes.

When the worker crashes (V8 OOM — out of memory), the `worker.onerror` handler fires in `worker-manager.ts`. All pending jobs for that worker are rejected. The OPFS chunks the worker wrote before crashing are left behind as orphaned data (see Section 5).

**The user experience:** They run a sequence analysis on a large customer dataset. The node shows "running" for a while, then fails with "Worker csv-consecutive-sequence crashed." No indication that the dataset had too many groups.

**Why "confirm" instead of "resolve"?** The old critique flagged the same problem in the server-side architecture (where it could kill the entire worker process and all five queues). In the browser architecture, the crash is isolated to one worker thread — other workers are unaffected. But the fundamental memory risk is unchanged.

**Fix:**

Add a group count threshold check during processing:

```typescript
const MAX_GROUP_KEYS = 500_000; // configurable via performance settings

// Inside the chunk processing loop:
if (runMap.size > MAX_GROUP_KEYS) {
  throw new Error(
    `Analysis stopped: dataset has more than ${MAX_GROUP_KEYS.toLocaleString()} unique groups. ` +
    `Consider pre-filtering rows before running sequence analysis.`
  );
}
```

A hard stop with a clear error message is better than a silent OOM crash. A spill-to-OPFS strategy (flushing the Map to disk and continuing) is better still, but significantly more complex.

---

## 5. MEDIUM: No Execution Abort of In-Flight Workers

**Status: NEW — unique to the browser architecture**

The execution engine supports cancellation via `AbortSignal` — a browser API for signalling that an operation should stop. When the user clicks "Cancel" on a running workflow:

```typescript
// From execution-engine.ts (lines 500–502)
if (signal?.aborted) {
  throw new DOMException("Workflow cancelled", "AbortError");
}
```

This check runs **before** each node starts. So if the user cancels during node 3 of a 10-node workflow, nodes 4–10 never start. ✓

**The problem:** The check does not run while a node is in the middle of executing. If node 3 has dispatched a CSV sort job that will take 20 minutes, and the user clicks Cancel while the sort is running, the engine cannot interrupt the sort. The sort worker has no mechanism to receive the abort signal.

**What actually happens:**
1. User clicks Cancel.
2. `controller.abort()` is called. `signal.aborted` becomes true.
3. The execution engine is suspended — it is `await`-ing the sort executor's Promise.
4. When the sort worker finishes (20 minutes later), it sends `{ kind: "result" }`.
5. The onmessage handler fires, finds the jobId in `pendingJobs`, calls `resolve(output)`.
6. The executor's Promise resolves. The executor returns `newVars`.
7. `Object.assign(context, newVars)` runs.
8. **Now** the abort check runs before the next node. The DOMException is thrown. The workflow stops.

Result: Cancel works, but only after the currently-running worker finishes. A 20-minute sort job runs to completion even after the user clicks Cancel. CPU and memory are wasted.

**Fix:**
Track which `jobId` is currently in-flight per worker type. When the AbortSignal fires, call `worker.terminate()` for each worker with an in-flight job, then remove it from `workerPool`. The pending Promise is rejected automatically because the worker is gone. The execution engine catches the rejection, marks the node as FAILED, and stops.

Note: After `worker.terminate()`, the worker is destroyed. The next job dispatched for that type will create a fresh worker (the pool's lazy-creation handles this automatically). The OPFS chunks written before termination are orphaned — auto-cleanup (see Section 6) is needed alongside this fix.

---

## 6. MEDIUM: Orphaned OPFS Chunks After Worker Crash or Cancellation

**Status: NEW — a consequence of the browser storage model**

When a worker writes output to OPFS and then crashes (or is terminated before completion), the chunks it already wrote remain in OPFS forever — they are not linked to any manifest in IndexedDB, and no execution record claims them. These are **orphaned chunks**.

The `cleanupOrphanedOPFSData()` function in `src/lib/opfs.ts` can find and delete orphaned chunks: it compares OPFS directories against IndexedDB records and deletes anything not in the database. But this function must be called manually by the user from the Settings page.

**In practice:** A user who runs many large workflows and encounters occasional failures will slowly accumulate hundreds of megabytes of orphaned chunk files. Eventually, their OPFS quota fills up. The next workflow fails with an OPFS write error. They have no idea why — they just see "node failed."

**Fix (short-term):** In `runWorkflow()`, after catching any execution error:

```typescript
// After the catch block in runWorkflow():
try {
  await cleanupOrphanedOPFSData(); // fire and forget — non-blocking
} catch {
  // cleanup failure should not surface to the user
}
```

**Fix (long-term):** Before each node writes to OPFS, create a manifest "placeholder" in IndexedDB that marks the dataset as "in-progress." If the run fails, the cleanup function knows that "in-progress" datasets with no corresponding "SUCCESS" execution record are orphaned and should be deleted.

---

## 7. LOW: Performance Settings Not Synced Across Browser Tabs

**Status: NEW**

`dispatchWorkerJob()` calls `getPerformanceSettings()` before every job dispatch. `getPerformanceSettings()` reads from `localStorage`. Workers cannot access `localStorage` themselves (workers have no access to the main thread's `localStorage`), so the main thread reads the settings and injects them into the job's input payload.

**The problem:** If the user has two AutoPilot browser tabs open:
- Tab A runs a workflow with `chunkSize = 10,000` (default "Balanced" preset).
- The user goes to Tab B and changes performance settings to `chunkSize = 50,000` ("Maximum" preset).
- Tab A starts its next job. `getPerformanceSettings()` reads `localStorage`. In modern browsers, `localStorage` is shared between tabs of the same origin — Tab A now sees `chunkSize = 50,000` immediately.

*Wait — so settings do sync?*

They sync for **reads** — yes. But Tab A's next job will use the new settings. This is actually correct behavior. The issue is the reverse: Tab B changing settings to something unexpected may cause Tab A's next job to run with aggressive memory settings, potentially causing an OOM in a constrained environment.

**More precisely:** If the user changes settings in Tab B **while** Tab A has a job in-flight, the in-flight job already injected the old settings into its input payload via `postMessage`. The worker is already running with the old chunk size. The new settings only affect the next job. This is correct.

The actual risk is very low and only affects users with multiple tabs open simultaneously. No immediate fix is required; a note in the performance settings UI ("Changes apply to the next workflow run") is sufficient.

---

## 8. LOW: No Concurrent Execution Limit

**Status: NEW**

The execution engine has no global limit on how many workflows can run simultaneously. A user who clicks "Run" on three different workflows in rapid succession will have three concurrent `runWorkflow()` calls active at the same time.

Each concurrent run dispatches jobs to the shared worker pool. If all three runs dispatch a "csv-sort" job, the csv-sort worker receives three messages in quick succession. It processes them serially — run 1's sort, then run 2's, then run 3's. From the user's perspective, runs 2 and 3 appear to "hang" until run 1 finishes, with no explanation.

This is an edge case with low real-world impact (most users do not run multiple workflows simultaneously), but the silent stall is confusing.

**Fix:** Add an optional `MAX_CONCURRENT_EXECUTIONS = 2` setting. When a third run is attempted, show a "Queued" indicator in the UI instead of immediately showing "Running." This sets correct expectations.

---

## 9. Observability — Still Near Zero

**Status: CONFIRMED and TRANSFORMED**

The original critique said "Near Zero observability." In the browser architecture, observability is different — not better or worse, just different in character.

### What exists

**Browser DevTools** is the primary observability tool:
- **Application → IndexedDB:** View all execution records, node output records, and dataset manifests. You can see exactly when each node ran, how long it took, and whether it succeeded.
- **Application → Storage → Origin Private File System:** Navigate the OPFS directory tree. See exactly which chunk files exist for each execution's datasets.
- **Console:** Worker errors appear in the browser console as `[WorkerManager] Worker csv-sort crashed: ...`

**Execution history UI:** The built-in history view reads from IndexedDB and shows past runs with per-node status and duration.

### What is missing

- **No crash reporting:** If a worker crashes with an OOM or unhandled exception, and the user does not have DevTools open, the crash is invisible to the developer.
- **No queue depth metrics:** There is no way to see "there are 3 jobs queued for the csv-sort worker" without reading the `pendingJobs` Map in DevTools.
- **No dead-letter queue:** Failed jobs are rejected Promises. There is no durable record of "this job failed for this reason" beyond the node output record in IndexedDB.
- **No structured log aggregation:** `console.error` calls disappear when the tab is closed.

**Recommendation:** Integrate Sentry's browser SDK. Configure it to capture unhandled errors and worker crashes. **Critically:** configure the Sentry `beforeSend` hook to strip any value that might contain user data (row content, file contents) before transmission. Only metadata (error messages, stack traces, execution IDs) should be sent to Sentry.

---

## 10. Revised Severity Matrix

| Issue | Severity | Description |
|---|---|---|
| Missing compiled workers (pdf-merge, pdf-split) | **Critical** | Jobs fail with a network error at runtime; the user cannot use PDF Merge or PDF Split nodes |
| Worker queue stall on duplicate job types | **High** | Two sort/join/parse nodes in one workflow silently stall the second job with no user feedback |
| Sequence analyzer unbounded group Map | **High** | OOM crash on datasets with many distinct groups; worker fails with no meaningful error |
| No execution abort of in-flight workers | **Medium** | Clicking Cancel does not stop the running worker; CPU and memory are wasted for the remainder of the job |
| Orphaned OPFS chunks after worker crash | **Medium** | Failed runs leave data on disk that is never cleaned up; eventually fills OPFS quota |
| No concurrent execution limit | **Low** | Multiple simultaneous runs silently stall each other with no queue feedback |
| Performance settings sync edge case | **Low** | Multi-tab edge case; settings changes in one tab affect the next job in another tab |

---

## 11. Corrected Remediation Path

Listed in priority order. Each item is self-contained — later items do not depend on earlier ones.

---

**1. IMMEDIATE: Fix missing compiled workers**

Audit `/public/workers/` against the 15 entries in `WorkerJobType`. Add any missing source files to the esbuild build step. Add a post-build verification check that fails the build if any expected `.worker.js` file is absent.

*Files to add to build:* `src/workers/pdf-merge.worker.ts`, `src/workers/pdf-split.worker.ts` (and any others found missing).

---

**2. IMMEDIATE: Document the single-job-at-a-time worker limitation**

Add a comment to `getOrCreateWorker()` explaining that workers process messages serially. If two nodes in the same workflow dispatch the same job type, the second job waits for the first.

At minimum, add a `console.warn` when a new job is dispatched for a type that already has a pending job:

```typescript
// In dispatchWorkerJob(), before worker.postMessage():
const hasPendingForType = [...pendingJobs.values()].some(
  (p) => p.type === type // requires storing type in PendingJob
);
if (hasPendingForType) {
  console.warn(`[WorkerManager] Job type "${type}" already has a pending job. New job will be queued.`);
}
```

---

**3. SHORT-TERM: Cap group Map cardinality with a clear error**

In `csv-consecutive-sequence.worker.ts` and `csv-aggregate.worker.ts`, add a size check inside the chunk processing loop. If the Map exceeds `MAX_GROUP_KEYS` (default 500,000, overridable via performance settings), throw a descriptive error:

```
"Dataset has more than 500,000 unique groups. Pre-filter rows or reduce grouping columns."
```

This is significantly better than a silent OOM crash.

---

**4. SHORT-TERM: Propagate abort signal to in-flight workers**

When the execution engine receives an AbortError:
1. Track which `jobId` is in-flight per `WorkerJobType`.
2. Call `worker.terminate()` for each worker with an in-flight job.
3. Remove the terminated workers from `workerPool` (the pool's lazy-creation will reinitialize them on the next use).
4. The rejected Promises cascade into execution failure naturally.

Requires: storing `{ jobId, workerType }` pairs when dispatching, and looking them up on abort.

---

**5. SHORT-TERM: Auto-trigger OPFS cleanup after execution failure**

In `runWorkflow()`, in the `catch` block after a node fails, add:

```typescript
// Non-blocking; does not affect the error path
cleanupOrphanedOPFSData().catch(() => {});
```

Import `cleanupOrphanedOPFSData` from `src/lib/opfs.ts`. This ensures every failed run cleans up after itself without requiring user action.

---

**6. MEDIUM-TERM: Add storage quota pre-execution check**

Before `runWorkflow()` starts the node loop, call:

```typescript
const { usage, quota } = await navigator.storage.estimate();
const estimatedOutput = /* sum of input DatasetRef byteSizes × 2 */;
if (estimatedOutput > (quota - usage) * 0.8) {
  callbacks.onError("Insufficient browser storage. Clean up old executions in Settings.");
  return executionId;
}
```

---

**7. MEDIUM-TERM: Add structured execution log viewer in Settings**

A browser-local view (reading from IndexedDB) that shows all past executions with:
- Which nodes ran, in what order, for how long.
- Any errors with full error strings.
- Total dataset bytes written to OPFS.

This replaces the "BullMQ dashboard" recommendation from the original critique with something appropriate for a browser-only application. No server required — all data is already in IndexedDB.

---

**8. LONG-TERM: Browser compatibility layer for OPFS sync API**

The synchronous OPFS API (`createSyncAccessHandle()`) used in workers is Chromium-only. Add a feature detection check on app load and display a warning for Firefox/Safari users. Implement an async fallback path in `_opfs-helpers.ts` for non-Chromium browsers.

---

## 12. Final Comparison: Old Architecture vs. New Architecture

| Concern | Old Architecture (BullMQ/Inngest/Redis) | New Architecture (Web Workers/OPFS) |
|---|---|---|
| **Data privacy** | Data uploaded to servers | Data never leaves the user's device |
| **Timeout risk** | 60-second Vercel limit killed long jobs | No timeout — workers run until done |
| **Deployment complexity** | Redis + BullMQ workers + Inngest + Vercel | Static site + browser — zero infrastructure |
| **Failure isolation** | One crashed worker killed all five queues | One crashed worker thread; others unaffected |
| **Queue visibility** | BullMQ dashboard (Bull Board) could show queue depth | DevTools only; no built-in queue view |
| **Horizontal scaling** | Theoretically possible (multiple worker processes) | Not applicable — single browser tab |
| **Memory limits** | Server RAM (~8–32 GB typical) | Browser V8 heap (~1.5 GB per worker thread) |
| **Offline capability** | None — requires internet + server | Full offline support after first load |
| **Connection management** | Redis connections per executor call (critical bug) | No connections — postMessage is zero-cost |
| **Timeout synchronization** | Inngest 60 min + BullMQ no timeout = zombie jobs | No external orchestration — no synchronization issue |

The new architecture eliminates the most dangerous classes of bugs (zombie jobs, Redis connection leaks, Inngest/BullMQ timeout incoherence, worker deployment mismatches) while introducing a smaller and more manageable set of issues (missing compiled files, worker queue stalls, unbounded group Maps). The trade-offs are appropriate for the use case.

---

**Document Version:** 2.0 (full rewrite)
**Last Updated:** May 31, 2026
**Reason for rewrite:** Architecture migrated from server-side BullMQ/Inngest/Redis to browser-native Web Workers and OPFS
