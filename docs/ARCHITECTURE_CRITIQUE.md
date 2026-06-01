# AutoPilot Architecture Critique — Revised Edition

**Original date:** April 3, 2026
**Revised:** May 31, 2026
**Revision reason:** The architecture migrated from a server-side stack (Inngest, BullMQ, Redis, Vercel serverless) to a fully browser-based, offline-first PWA. Every section of the original document has been updated to reflect the current codebase.
**Scope:** Execution engine, worker pool, OPFS storage, IndexedDB persistence, React Flow editor, PDF and CSV nodes.

---

## A Note on What Changed — Read This First

The original critique, written April 3, 2026, evaluated AutoPilot as a **server-side system**: data was processed on Vercel servers, job queues lived in Redis, and background workers were Node.js processes running somewhere outside the user's browser.

**None of that infrastructure exists anymore.**

AutoPilot is now a **browser-only application**. Every CSV sort, PDF extraction, and data join runs inside the user's own browser tab — no server, no cloud compute, no queue. The user's data never leaves their device.

This is a fundamental architectural shift, not just a refactoring. The original document's weaknesses, recommendations, and grade are substantially wrong for the current system. This revision replaces them entirely.

---

## Executive Summary

AutoPilot is a visual workflow automation tool — think of it as a programmable assembly line for data files. Users drag and connect "nodes" on a canvas (like flowchart boxes), and AutoPilot runs the pipeline from start to finish: parsing CSV files, filtering rows, sorting, joining tables, extracting text from PDFs, merging documents, and exporting results.

The current architecture runs this entire pipeline **inside the user's web browser**. No server is involved in data processing. The browser's built-in threading model (Web Workers) parallelises heavy computation, and the browser's built-in private file system (OPFS) stores large datasets without size limits from a database.

**Overall Assessment:** The architecture is **architecturally sound and production-ready** for single-user, offline-first workloads. It is exceptionally well-suited for privacy-sensitive data processing. The main areas for improvement are browser compatibility, parallel branch execution, memory safety for extreme-cardinality datasets, and test coverage.

**Updated Grade: A− (Excellent design, specific gaps in browser compatibility and parallelism)**

---

## Technology Glossary

*These terms are used throughout this document. Each is defined in more detail the first time it appears in context.*

| Term | Plain-English Meaning |
|------|-----------------------|
| **Web Worker** | A separate JavaScript thread inside the browser — like a background cook in a kitchen — that can do heavy work without freezing the UI |
| **OPFS** (Origin Private File System) | A private file storage area built into the browser, like a personal hard drive that only this website can access |
| **IndexedDB** | A structured database built into the browser, used for metadata like execution records and manifests |
| **Dexie** | A user-friendly JavaScript library that wraps IndexedDB to make it easier to read and write |
| **chunk** | A single JSON file containing a fixed number of rows (e.g. 10,000 rows); large datasets are split into many chunks |
| **manifest** | A metadata document stored in IndexedDB that describes a dataset: row count, column types, which chunk files exist |
| **DatasetRef** | A lightweight "claim ticket" that tells the next node where to find a dataset in OPFS, without copying the data |
| **ExecutionContext** | A shared scratchpad object that all nodes in a workflow read from and write to during a run |
| **executor** | A function that implements one node's behavior (e.g. "filter rows matching a condition") |
| **topological sort** | Ordering workflow nodes so every node runs after all its parent nodes — parents before children |
| **esbuild** | A fast JavaScript bundler that compiles TypeScript worker source files into plain JavaScript files served from `/public/workers/` |
| **postMessage** | The browser API for sending messages between the main UI thread and a Web Worker thread |
| **ArrayBuffer** | A raw block of binary memory in the browser — used to hold file bytes before parsing |
| **dynamic import** | A `import()` call that loads a module lazily, only when it is actually needed |
| **DAG** | Directed Acyclic Graph — a graph of nodes connected by directed edges with no cycles; the data structure that represents a workflow |

---

## 1. The Architectural Pivot — Server → Browser

To understand the current architecture, you need to understand what changed and why.

### The Old Approach (no longer used)

The original AutoPilot ran data processing on **servers**. When a user ran a workflow:

1. The browser sent the workflow definition to a Vercel serverless function (a cloud-hosted piece of code that runs for up to 60 seconds).
2. The serverless function added a "job" to a BullMQ queue (a to-do list for background workers, stored in Redis).
3. A separate Node.js process picked up the job from the queue and did the actual work — sorting rows, filtering data, etc.
4. The result was stored on the server's disk.
5. The browser polled for the result.

**The problems with this approach:**
- Vercel functions time out after 60 seconds — a CSV sort of 400 MB takes 5–30 minutes and cannot run there.
- Users' sensitive data (payroll files, customer records) had to be uploaded to a third-party server.
- Running the system required Redis, a queue worker process, and a cloud host — infrastructure costs even with zero users.
- Working offline was impossible.

### The New Approach (current)

The current AutoPilot runs **entirely in the browser**:

1. The user builds and runs the workflow in the browser.
2. The execution engine (`src/lib/execution-engine.ts`) sorts the nodes and calls each one's executor.
3. The executor dispatches the heavy work to a **Web Worker** — a background JavaScript thread running inside the same browser tab.
4. The worker writes results to **OPFS** — the browser's built-in private file system.
5. A **DatasetRef** (a claim ticket: "your data is in OPFS, dataset ID abc123") is passed to the next node.
6. When all nodes are done, the execution record is saved to **IndexedDB** for the history view.

**Benefits of the new approach:**
- No data ever leaves the user's device — strong privacy guarantee.
- No server means no infrastructure cost and no 60-second timeout.
- Works fully offline.
- Each browser tab is isolated — one user's data cannot leak to another.

**Trade-offs:**
- Cannot run on mobile browsers with limited memory.
- No collaboration between users (data is local to one browser).
- Limited to the resources of one machine — no cloud scaling.

This trade-off was an intentional design decision, not an oversight.

### The Kitchen Analogy

Throughout this document, the following analogy is used consistently:

- **The browser tab** = the restaurant dining room (where the customer — the user — interacts)
- **The main JavaScript thread** = the waiter (coordinates everything; must never be frozen)
- **Web Worker threads** = the kitchen cooks (do heavy work out of sight; cannot talk directly to the customer)
- **OPFS** = the pantry (stores large datasets that don't fit on the waiter's tray)
- **IndexedDB** = the recipe card box (stores structured metadata — execution records, manifests)
- **postMessage** = the ticket window between the dining room and kitchen (the only communication path)
- **DatasetRef** = a claim ticket ("your order is ready; it's on shelf 47 in the pantry")
- **ExecutionContext** = the order board (the shared scratchpad all cooks read and update)

---

## 2. Architectural Strengths

### 2.1 Clear Separation of Concerns

**Status: CONFIRMED — still valid**

The codebase is organized into well-defined layers with clear responsibilities:

- **Control Plane** — workflow definitions, execution lifecycle, status tracking (`src/features/workflows/`, `src/lib/execution-engine.ts`)
- **Data Plane** — dataset storage in OPFS, chunk management, manifests (`src/lib/opfs.ts`, `src/types/dataset.ts`)
- **Execution Plane** — node executors, worker pool, OPFS reads/writes (`src/features/executions/`, `src/lib/worker-manager.ts`)
- **Presentation Plane** — React Flow editor, inspector panel, progress panel (`src/features/editor/`)

Each feature in `src/features/` has a consistent internal structure: `components/`, `hooks/`. Each execution node has its own folder containing `executor.ts`, `dialog.tsx`, and `node.tsx` — the logic, the configuration form, and the visual node representation.

**Why this matters:** A new developer can open any single node folder and understand everything that node does without reading the rest of the codebase. Separation of concerns keeps code maintainable as the project grows.

---

### 2.2 Zero-Server Execution Engine

**Status: NEW — this is the most significant architectural strength**

The execution engine (`src/lib/execution-engine.ts`) is a **pure browser implementation** — it imports no server libraries, makes no HTTP calls during execution, and has no external dependencies.

**Current technology stack:**
- **Next.js 15 + React 19** — the UI framework
- **React Flow (@xyflow/react)** — the visual workflow canvas
- **Dexie** — IndexedDB wrapper for execution records and manifests
- **OPFS** — browser built-in file system for dataset chunks
- **esbuild** — compiles TypeScript worker source files into browser-ready JavaScript
- **pdfjs-dist** — PDF text extraction in the browser
- **pdf-lib** — PDF manipulation (merge, split) in the browser
- **PapaParse** — streaming CSV parsing in the browser

No Redis, no BullMQ, no Inngest, no Vercel functions. The "infrastructure" is the user's own browser.

**Why this matters:** The app can be served as a static website (no backend required) and still process multi-gigabyte files. Users with no internet connection can run the full application after first load.

---

### 2.3 External Sort and Grace Hash Join

**Status: CONFIRMED STRENGTH — upgraded to "production-grade for single-browser"**

Two of the most sophisticated algorithms in the codebase handle the two most memory-intensive operations:

#### External Merge Sort (`src/workers/csv-sort.worker.ts`)

Sorting a dataset that is larger than the browser's available RAM requires an **external sort** — an algorithm that never loads the full dataset at once.

**How it works (two phases):**

*Phase 1 — Creating sorted runs:* Read 64 chunks at a time (640,000 rows by default, ~128 MB), sort them in memory, write the sorted group back to OPFS as a "run" (a contiguous block of pre-sorted rows). Repeat until all input chunks have been processed. If the dataset has 6,400 chunks, you create 100 sorted runs.

*Phase 2 — K-way merge:* Keep one chunk loaded per run. Use a **min-heap** (a tree data structure where the smallest element is always at the top, like a tournament bracket) to find the globally smallest row across all runs in O(log K) time — far faster than comparing all runs one-by-one. Pop the smallest row, write it to the output, advance that run's cursor. Repeat until all runs are exhausted.

**Memory model:** Phase 2 typically uses only 5–10 MB of RAM regardless of the input dataset size, because only one chunk per run is loaded at a time.

#### Grace Hash Join (`src/workers/csv-join.worker.ts`)

Joining two large datasets on a key column requires a **hash join**. The simple version loads the entire right-side dataset into a Map (a key-value lookup table). For a right dataset of 2 million rows, that Map could use 400 MB of RAM — too much.

The **grace hash join** solves this:

1. Use a hash function (djb2 — a simple formula: for each character, multiply the running total by 33 and add the character code) to assign every row from both datasets to one of K buckets. Rows with the same key always land in the same bucket.
2. Process one bucket pair at a time. The right bucket for bucket #i has approximately right_total / K rows — much smaller than the full dataset.
3. Join each bucket pair with a standard in-memory hash join.

The boundary (PARTITION_THRESHOLD) is 500,000 rows. Smaller right datasets use a simple in-memory join; larger ones use grace hash join automatically.

**Why this matters:** These two algorithms enable AutoPilot to process datasets far larger than the browser's RAM, without the user configuring anything. The algorithms are the same ones used by database engines like PostgreSQL.

---

### 2.4 DatasetRef Pattern — The Claim Ticket System

**Status: CONFIRMED STRENGTH — same design, updated context**

When a node finishes processing a dataset, it does not put the data directly into the ExecutionContext (the shared scratchpad). Instead, it writes the data to OPFS and places a **DatasetRef** — a claim ticket — in the context.

```typescript
// What a DatasetRef looks like
{
  kind: "dataset",
  datasetId: "abc123",
  executionId: "run_xyz",
  variableName: "filtered_customers",
  rowCount: 65000,
  chunkCount: 7,
  byteSize: 42000000
}
```

The next node reads this claim ticket from the context and uses `readChunkFromOPFS()` to fetch only the chunks it needs, one at a time.

**Benefits:**
- The ExecutionContext stays tiny (references only, no bulk data).
- Two nodes that produce datasets do not interfere with each other's storage.
- Nodes can process datasets larger than RAM by streaming chunks.

**Current concern — manual cleanup:** When an execution finishes (successfully or not), the OPFS chunks it wrote remain on disk until the user manually triggers cleanup from the Settings page (`cleanupOrphanedOPFSData()` in `src/lib/opfs.ts`). The function compares OPFS directories against IndexedDB records and deletes any unregistered datasets. But it is not called automatically after failures.

**Recommendation:** Call `cleanupOrphanedOPFSData()` automatically in `runWorkflow()` after any execution failure. This prevents orphaned chunks from accumulating silently.

---

### 2.5 Lazy Executor Loading

**Status: NEW — a significant performance optimization**

The executor registry in `src/lib/execution-engine.ts` maps each node type to a **dynamic import** — a function that loads the executor module only when that node is actually in the workflow being run.

```typescript
// Only loads the CSV sort executor if the workflow has a CSV_SORT node
[NodeType.CSV_SORT]: () =>
  import("@/features/executions/components/csv-sort/executor").then((m) => m.executor)
```

If a workflow has only CSV_PARSE and FILE_EXPORT nodes, the browser never loads the CSV sort, join, PDF extraction, or any other executor code. This keeps the initial page load fast and reduces memory usage.

**Why this matters:** AutoPilot has 17 registered node types. Eagerly importing all executors at startup would load the entire pdfjs-dist library (PDF parsing, ~2 MB compressed) even for users who only work with CSV files.

---

## 3. Current Architectural Weaknesses

### 3.1 Sequential Node Execution (No Branch-Level Parallelism)

**Status: CONFIRMED — still present, different context**

The execution engine runs nodes one after another in a sequential for-loop:

```typescript
// From src/lib/execution-engine.ts (lines 499–606)
for (const node of sortedNodes) {
  // ... check abort signal ...
  const executor = await loadExecutor();
  const newVars = await executor(node.id, node.data, context, executionId, onProgress);
  Object.assign(context, newVars);
}
```

**What this means in practice:** Consider a workflow where two independent branches run from the same starting node:

```
Upload File
├─→ Extract Text → Summarize Text
└─→ Extract Tables → Filter Rows → Aggregate
```

The "Extract Text" branch and the "Extract Tables" branch do not depend on each other — they could run simultaneously. But the current engine runs them one after the other: Extract Text finishes, then Extract Tables starts, even though both could run in separate Web Worker threads concurrently.

**Impact:** Total execution time equals the sum of all node durations. A workflow with two 5-minute branches takes 10 minutes instead of 5 minutes.

**Recommendation:**
- Identify independent subgraphs (branches with no shared dependencies) after the topological sort.
- Group them into sets of nodes that can run concurrently using `Promise.all()`.
- Each branch dispatches its own worker jobs; OPFS handles concurrent writes safely (different dataset IDs, different file paths).
- This is browser-native parallelism — no external infrastructure needed.

---

### 3.2 In-Memory Accumulation for High-Cardinality Grouping

**Status: TRANSFORMED — same risk, browser context**

The **consecutive sequence analyzer** (`src/workers/csv-consecutive-sequence.worker.ts`) holds one entry per distinct group key in a Map:

```typescript
// From csv-consecutive-sequence.worker.ts (lines 63–64)
type RunState = { start: number; end: number; length: number; prevVal: number };
const runMap = new Map<string, RunState>();
```

For a dataset with 5 million unique group keys (e.g. one sequence per customer ID in a large customer dataset), this Map holds 5 million RunState objects in the Web Worker thread's heap memory. With no eviction strategy and no spill-to-disk mechanism, the worker will crash when V8's (the JavaScript engine) memory limit for that thread is reached — typically around 1.5 GB.

When a worker crashes, its OPFS output for that execution is left as orphaned chunks (see 2.4 concern above).

The **csv-aggregate** worker has a similar pattern — one accumulator entry per distinct group key.

**Impact:** Users processing datasets with many distinct groups (customer-level aggregation, per-transaction grouping) will see silent worker crashes that appear as node failures.

**Recommendation:**
- Add a `MAX_GROUP_CARDINALITY` constant (e.g. 500,000 unique keys).
- If the Map grows beyond this threshold, flush accumulated results to OPFS and continue from there (spill-to-disk pattern, similar to how the sort worker handles large data).
- At minimum, throw a clear error: "This dataset has more than 500,000 unique groups. Consider pre-filtering before aggregating."

---

### 3.3 Worker Pool Stall on Duplicate Job Types

**Status: NEW — not present in the old architecture**

The worker pool holds exactly one Worker thread per job type. The first time "csv-sort" is dispatched, the pool creates a worker and stores it. Every subsequent "csv-sort" dispatch reuses the same thread.

**The problem:** Web Workers process messages serially — one at a time, in the order they arrive. If two nodes in the same workflow both dispatch "csv-sort" jobs, the second job's postMessage is queued in the same thread behind the first. The second sort cannot start until the first is fully complete.

```
Workflow:
  SortByDate (csv-sort) ──→ FilterResult
  SortByAmount (csv-sort) ──→ FilterResult2

Actual execution:
  SortByDate runs ... (30 minutes for 400 MB dataset)
  [second sort job sits waiting in the thread's message queue the whole time]
  SortByDate finishes
  SortByAmount runs ... (another 30 minutes)
  Total: 60 minutes instead of 30
```

There is no user-visible indication that the second job is queued, not running. The progress bar may appear frozen.

**Impact:** Any workflow with two nodes of the same heavy type (sort + sort, join + join) runs them sequentially without the user knowing why.

**Recommendation:**
- Option A: In the execution engine, detect when the same worker type appears twice and add an explanatory log or UI note.
- Option B: Implement a per-worker job queue inside `worker-manager.ts` — a deferred array of pending jobs that the worker picks up one at a time, with a "queued" status sent back to the UI.
- Option A is a one-hour fix; Option B requires a new internal protocol.

---

### 3.4 Performance Settings Not Synced Across Browser Tabs

**Status: NEW**

The performance settings (chunk size, maximum union rows, memory limit per worker) are stored in `localStorage` and read by `dispatchWorkerJob()` at dispatch time.

**The problem:** `localStorage` is shared across tabs for the same website. If the user has AutoPilot open in two browser tabs and changes the chunk size in Tab A, Tab B still reads the old value for its next job dispatch. The `storage` event (a browser event that fires when another tab changes `localStorage`) exists but is not listened to in `worker-manager.ts`.

**Impact:** Low in practice — most users use one tab. A potential source of confusing behavior for power users running workflows in multiple tabs simultaneously.

**Recommendation:** In `worker-manager.ts`, add a `window.addEventListener("storage", ...)` handler that invalidates the in-memory performance settings cache when another tab changes it.

---

### 3.5 Browser Storage Quota Limits

**Status: NEW**

OPFS and IndexedDB are subject to **browser storage quotas** — limits set by the browser on how much disk space a website can use. In most browsers, this is approximately 60% of available free disk space, but the exact limit varies.

AutoPilot does not check available quota before starting an execution. A workflow that produces large intermediate datasets (parse → sort → join, each creating its own OPFS chunks) could exhaust the quota silently. The resulting OPFS write failure would appear as a generic node error with no explanation.

**The browser provides a quota API:**
```javascript
const { usage, quota } = await navigator.storage.estimate();
// usage: bytes currently used
// quota: bytes available
```

**Impact:** Users with nearly-full disks or browsers with restrictive quota policies will see cryptic errors.

**Recommendation:**
- Before starting a workflow execution, call `navigator.storage.estimate()`.
- Estimate the expected output size (sum of input dataset sizes × 2 as a conservative multiplier).
- If estimated output > (quota − usage) × 0.8, show a warning: "You may not have enough browser storage to complete this workflow. Consider freeing up disk space or cleaning old executions."

---

### 3.6 OPFS Browser Compatibility

**Status: NEW — a real production constraint**

The OPFS API has two modes:
- **Async mode** (`FileSystemDirectoryHandle.getFileHandle()`) — works in all modern browsers including Firefox and Safari.
- **Sync mode** (`createSyncAccessHandle()`) — significantly faster for sequential reads/writes, but **only available inside Web Workers on Chromium-based browsers** (Chrome, Edge, Opera). Firefox and Safari support it with limitations or not at all as of May 2026.

The OPFS helper functions in `src/workers/_opfs-helpers.ts` use the sync API where possible for performance. On Firefox and Safari, some workers may fail or fall back to slower async operations.

**Impact:** Users on Firefox or Safari may encounter errors or significantly slower execution for large datasets.

**Recommendation:**
- Add a browser compatibility check on app first load. If `FileSystemFileHandle.prototype.createSyncAccessHandle` is not available, display a notice: "AutoPilot performs best in Chrome or Edge. Some features may be slower or unavailable in this browser."
- Longer term: implement an async fallback path in the OPFS helpers for non-Chromium browsers.

---

### 3.7 No Server-Side Fallback or Cloud Sync (Design Trade-Off, Not a Bug)

**Status: TRANSFORMED — from "weakness" to "intentional design decision"**

The old critique listed "lack of distributed execution" as a weakness. In the current architecture, there is no distributed execution by design — and this is the correct decision for the intended use case.

**The trade-off, explicitly:**

| What you gain | What you give up |
|---------------|-----------------|
| Full data privacy (data never leaves the device) | No collaboration between users |
| No infrastructure cost or maintenance | No processing on mobile devices with limited RAM |
| Works offline | No cloud backup of workflow results |
| Instant execution start (no queue wait) | Cannot process files larger than the browser can handle |

For a single-user data automation tool targeting sensitive datasets (payroll, HR records, financial data), the privacy guarantee outweighs the collaboration limitation. If multi-user collaboration is a future requirement, the correct approach is an **opt-in cloud sync layer** — not replacing the browser execution engine, but adding an optional server-assisted mode alongside it.

---

## 4. Data Flow Architecture

### 4.1 The Five-Layer Data Path

When a user runs a CSV sort node, the data travels through five layers:

```
1. Executor (csv-sort/executor.ts)
   → reads DatasetRef from ExecutionContext
   → calls dispatchWorkerJob("csv-sort", { inputRef, sortColumns, ... })

2. Worker Manager (worker-manager.ts)
   → generates jobId
   → reads performance settings from localStorage
   → merges settings into input
   → worker.postMessage({ jobId, type: "csv-sort", input })

3. Web Worker thread (csv-sort.worker.js — running in background thread)
   → receives the message
   → reads input chunks from OPFS one-by-one
   → performs external merge sort
   → writes sorted output chunks to OPFS
   → self.postMessage({ kind: "result", jobId, output: { manifest, datasetRef } })

4. Worker Manager (back on main thread)
   → receives result message
   → looks up jobId in pendingJobs Map
   → calls resolve(output) — the executor's Promise resolves

5. Execution Engine (back in execution-engine.ts)
   → receives the DatasetRef from the resolved Promise
   → merges it into ExecutionContext
   → persists the manifest to IndexedDB
   → proceeds to the next node
```

Using the kitchen analogy: the executor writes a ticket (job message), passes it through the ticket window (postMessage), the cook processes the order (sorts in the worker), hands back a claim ticket (DatasetRef), and the waiter updates the order board (ExecutionContext) and the recipe card box (IndexedDB manifest).

---

### 4.2 JSON Chunk Format

*Correction from the original document: datasets are stored as JSON arrays, not JSONL (newline-delimited JSON). Each chunk file contains `JSON.stringify(arrayOfRows)` — a single JSON array.*

**Chunk file path:**
```
OPFS: autopilot/executions/{executionId}/{datasetId}/chunk-{index}.json
```

**Example chunk file contents:**
```json
[
  {"name": "Alice", "age": 30, "city": "Paris"},
  {"name": "Bob", "age": 25, "city": "Lyon"},
  ...
  (up to chunkSize rows, default 10,000)
]
```

**Pros:** Human-readable, easily debuggable via DevTools (Application → Storage → OPFS), no external dependencies.

**Cons:** Higher CPU overhead (JSON parsing per row), no columnar compression (integers and floats stored as text), no predicate pushdown (cannot skip irrelevant rows without reading the whole chunk first).

**Long-term recommendation:** Investigate a binary columnar format (e.g. Apache Arrow IPC) as an opt-in for analytical workloads. Arrow would reduce chunk read time by 3–5× for numeric data. This is an optimization, not a requirement.

---

### 4.3 Manifest and Chunk Split

The metadata and the data are stored separately:

- **IndexedDB** (via Dexie) stores the **manifest** — the table of contents. A manifest describes one dataset: how many rows, how many chunks, which chunk files exist, what column types were inferred, when it was created. Manifests are tiny (a few kilobytes) and fast to query.

- **OPFS** stores the **chunk files** — the actual row data. Chunk files can be megabytes each.

This split is why the execution history view loads instantly (it only reads manifests from IndexedDB) while the data preview loads the actual chunks on demand as the user scrolls.

---

## 5. UI Architecture

### 5.1 React Flow + Callback-Based Progress

**Status: CONFIRMED, updated**

React Flow handles the visual canvas — rendering nodes, edges, and allowing drag-and-drop editing. This integration remains strong.

**Real-time progress** during execution uses a callback pattern: the `onProgress` callback is passed all the way down from the UI into `runWorkflow()`, into each executor, and into `dispatchWorkerJob()`. Workers send `WorkerProgressMessage` objects via postMessage with a `progress` field (0–100) and an optional descriptive `message`. The UI receives these and updates progress bars per node.

This is self-contained — no WebSockets, no server-sent events, no polling. The progress information flows entirely within the browser tab.

**Remaining issues:**
- Large workflows (100+ nodes) may have rendering performance issues in React Flow.
- No workflow versioning — users cannot roll back to a previous version of a workflow.
- No collaborative editing — one user at a time.

---

### 5.2 Dataset Viewer in the Inspector Panel

**Status: CONFIRMED IMPROVEMENT, some gaps remain**

The inspector panel (the right-side panel that shows node output after a run) loads data in pages — fetching one OPFS chunk at a time rather than loading the entire dataset at once. This prevents the browser from freezing on large datasets.

**Remaining gaps:**
- No column-level filter or sort in the dataset viewer.
- No "Export to CSV" button in the inspector (users must download the file separately via File Export node).
- No inline editing of values in the viewer.

---

## 6. Security in a Browser-Only Application

### 6.1 No Authentication Required (By Design)

The current application does not have user login, server-side sessions, or credential management for data processing. It is a **local-only tool** — there is no account to log into for running workflows.

**This is the correct design** for an offline-first application. Authentication creates a server dependency, requires credential storage, and introduces session management complexity. Since data never leaves the browser, there is nothing to authenticate access to — you are always running the app as yourself, on your own machine.

*Note: If cloud sync or collaboration features are added in the future, authentication would be required for those features only — not for local execution.*

---

### 6.2 Web Worker Sandboxing

Web Workers are naturally sandboxed:
- Workers **cannot access the DOM** (HTML elements, document, window).
- Workers **cannot access localStorage or sessionStorage** (which is why performance settings are injected into every job message — the worker cannot read them directly).
- Workers **cannot execute system commands** or access the filesystem outside OPFS.

The original critique identified the "Code node" (a node that executes arbitrary user-provided JavaScript) as a critical security risk. Checking the current executor registry in `src/lib/execution-engine.ts`, **there is no Code node registered** — it has been removed from the execution engine. The security risk no longer exists.

---

### 6.3 OPFS Data Isolation

OPFS is **origin-private** — only the website that created the data can read it. If a user processes a sensitive payroll file in AutoPilot at `app.example.com`, no other website can access that data. The data is also invisible to other browser tabs on different origins.

OPFS data **does not leave the device** — it is stored on the user's local disk, encrypted by the OS file system, and inaccessible to AutoPilot's servers (because AutoPilot has no servers accessing the user's machine).

---

## 7. Observability and Debugging

### 7.1 What Exists

The current system has the following built-in visibility:

- **IndexedDB execution records:** Every execution is recorded in IndexedDB with status, start time, completion time, and error message. Every node output has its own record with duration in milliseconds. Viewable via browser DevTools → Application → IndexedDB → AutoPilot database.
- **Per-node duration:** `durationMs` is recorded for every node, giving attribution ("which node was the bottleneck?").
- **Worker progress messages:** During execution, the UI shows a live progress percentage per node, sourced from `WorkerProgressMessage` objects sent by the worker.
- **OPFS data inspection:** Browser DevTools → Application → Storage → Origin Private File System shows all chunk files. This is the "poor man's queue dashboard" equivalent.

### 7.2 What Is Missing

- **No crash reporting to a server:** If the application throws an uncaught error or a worker crashes, no external service receives the error. The developer cannot proactively discover crashes — users must report them.
- **No performance regression tracking:** There is no benchmark suite that runs automatically to detect if a code change made sorting 20% slower.
- **No structured error codes:** Error messages are plain strings. Users cannot search for error codes in documentation.
- **No log aggregation:** `console.error()` calls in workers disappear after the browser tab is closed.

**Recommendation:** Integrate an error-tracking service (Sentry's browser SDK, for example) that captures uncaught errors and unhandled Promise rejections in the browser, without sending user data. Configure it to strip any values that might contain row data before transmission.

---

## 8. Testing

### 8.1 Current Coverage

**Status: CONFIRMED WEAKNESS**

No automated test suite exists for the execution engine or worker logic. No `__tests__` directories or `.test.ts` files are present in the project.

**Impact:** Every change to a worker algorithm is tested only by manually running a workflow and eyeballing the output. A regression in csv-sort (e.g. a bug that silently produces an incorrect sort order for negative numbers) would not be caught until a user reports it.

### 8.2 Recommendations

1. **Unit tests for worker logic:** Workers are plain JavaScript functions — they can be unit-tested without a browser. Use Vitest (a fast test runner compatible with TypeScript) to test sorting algorithms, hash join logic, and sequence detection against known inputs and expected outputs.

2. **Integration tests for executors:** Test each executor end-to-end: provide an ArrayBuffer input, run the executor, read the OPFS output, assert the rows match the expected result.

3. **Property-based tests for data transformations:** Use `fast-check` (a property-based testing library) to generate random CSV data and assert that properties hold — e.g. "the output of csv-sort is always in sorted order regardless of input."

4. **Target:** 80% coverage for executor and worker code (the highest-risk paths). UI tests are secondary.

---

## 9. Technical Debt Inventory

### High Priority

1. **OPFS browser compatibility layer** — The sync API used in workers is Chromium-only. Firefox and Safari users may encounter failures with no explanation.
   - Impact: High (users on non-Chrome browsers cannot use the app reliably)
   - Effort: Medium (1–2 weeks to implement async fallback path)
   - Risk: Low (additive change, does not affect Chromium users)

2. **Aggregation and sequence analyzer group Map cardinality cap** — The `runMap` in `csv-consecutive-sequence.worker.ts` and the accumulator in `csv-aggregate.worker.ts` grow without bound.
   - Impact: High (OOM crash on high-cardinality datasets, silently drops data)
   - Effort: Medium (3–5 days to implement spill-to-OPFS strategy)
   - Risk: Low (additive change with a fallback path)

3. **Automatic OPFS cleanup after execution failure** — Orphaned chunks accumulate silently.
   - Impact: Medium (disk quota exhaustion for users with many failed runs)
   - Effort: Low (1 day — one function call added in `runWorkflow()`)
   - Risk: Very Low

### Medium Priority

1. **Workflow-level parallel branch execution** — Independent branches run sequentially.
   - Impact: Medium (missed 2× or better speedup on parallel workflows)
   - Effort: High (2–3 weeks, complex concurrency and context isolation)
   - Risk: High (subtle concurrency bugs possible)

2. **Storage quota pre-execution check** — `navigator.storage.estimate()` not called.
   - Impact: Medium (cryptic errors when quota is exhausted)
   - Effort: Low (1 day)
   - Risk: Very Low

3. **Automated test suite** — No unit or integration tests.
   - Impact: High (regression risk on every code change)
   - Effort: High (ongoing investment)
   - Risk: Low (additive)

### Low Priority

1. **Cross-tab performance settings sync** — `storage` event not listened to.
   - Impact: Low (only affects users with multiple tabs open)
   - Effort: Very Low (a few hours)
   - Risk: Very Low

2. **Binary chunk format** — JSON arrays are larger and slower than columnar formats.
   - Impact: Low for current dataset sizes (meaningfully better only beyond 1M rows)
   - Effort: High (requires all workers to be updated)
   - Risk: Medium (data format migration required)

---

## 10. Scalability Roadmap

### Phase 1: Robustness (Next 1–3 Months)

- Add OPFS browser compatibility check and warning for non-Chromium browsers.
- Implement storage quota guard with pre-execution warning.
- Add cardinality cap to aggregation and sequence analyzer workers with spill-to-OPFS.
- Auto-trigger OPFS cleanup after execution failures.
- Add unit test suite for workers and executors (Vitest).

### Phase 2: Performance (3–6 Months)

- Implement branch-level parallel execution using `Promise.all()` for independent subgraphs.
- Add per-worker job queue visualization in the UI (show "queued" status for the second sort node).
- Investigate Arrow IPC as a binary chunk format for analytical workloads.

### Phase 3: Optional Cloud Layer (6–12 Months)

- Design an opt-in cloud sync layer for users who want to access their workflows from multiple devices.
- This should be additive — offline-first execution remains the default.
- Cloud sync would sync workflow definitions and execution history, not raw data (data stays local unless the user explicitly chooses to upload it).

---

## 11. Conclusion and Updated Grade

The architectural pivot from server-side to browser-only represents a **bold and correct engineering decision** for AutoPilot's use case. Processing sensitive data files locally — without any server involvement — is a meaningful privacy guarantee that no server-based competitor can match at the same price point (zero infrastructure cost).

**What the architecture gets right:**
- Clean separation of concerns at every layer.
- Sophisticated algorithms (external sort, grace hash join) that handle data larger than RAM.
- DatasetRef claim-ticket pattern elegantly solves context bloat.
- Lazy executor loading keeps startup fast regardless of how many node types exist.
- Zero-server execution gives users full data sovereignty.

**What needs improvement:**
- Browser compatibility for the synchronous OPFS API (Chromium-only).
- Memory safety for high-cardinality grouping operations.
- Parallel branch execution (sequential-only is a meaningful performance gap).
- Automated test coverage (currently zero).
- Storage quota handling (silent failures possible).

**Original grade (April 2026): B+ (Good, with room for improvement)**

**Revised grade (May 2026): A− (Excellent design, specific gaps in browser compatibility and parallelism)**

The upward revision reflects the elimination of the server-side architectural risks (BullMQ connection leaks, zombie jobs, Inngest timeout incoherence, credential plaintext storage, Code node sandbox escape) in exchange for a simpler, more secure, and more private system. The remaining gaps are real but well-scoped and fixable without architectural changes.

---

**Document Version:** 2.0 (full rewrite)
**Last Updated:** May 31, 2026
**Reason for rewrite:** Architecture migrated from server-side Inngest/BullMQ/Vercel to browser-only PWA
