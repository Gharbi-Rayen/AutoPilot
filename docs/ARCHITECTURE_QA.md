# Architecture Q&A — Complete Question Answers

**Companion to:** `docs/ARCHITECTURE_CRITIQUE.md` and `docs/BULLMQ_WORKER_ARCHITECTURE_CRITIQUE.md`
**Date:** May 31, 2026

This document answers every question embedded in both architecture documents — explicitly asked questions, implied "why/how/what" questions from section headers, and status questions about old bugs. Each answer is self-contained: you do not need to have read the other documents first.

---

## The Kitchen Analogy (Reference Card)

Every answer in this document uses the same set of analogies. Here they are upfront:

| Technical Concept | The Analogy |
|---|---|
| Browser tab | The restaurant dining room (the customer-visible space) |
| Main JavaScript thread | The waiter (coordinates everything; must never be frozen) |
| Web Worker thread | A kitchen cook (does heavy work in the back; cannot talk directly to the customer) |
| OPFS | The pantry (stores large datasets that don't fit on the waiter's tray) |
| IndexedDB | The recipe card box (stores structured metadata — recipes, not ingredients) |
| postMessage | The ticket window between the dining room and the kitchen |
| DatasetRef | A claim ticket ("your order is in pantry bin 47") |
| ExecutionContext | The order board (shared scratchpad all cooks read and update) |
| Worker pool | The kitchen staff roster (one cook per specialty, reused per shift) |

---

## Part 1: Foundational Terms

### Q1: What is a Web Worker?

Imagine a restaurant where there is only one person doing everything — taking orders, cooking meals, washing dishes, and answering the phone. Every time they are cooking, the customers at the tables cannot get anyone's attention. The phone rings, nobody picks up. A new customer walks in, nobody greets them. Everything is frozen until the cooking is done.

JavaScript in a browser works exactly like that by default. It is **single-threaded** — meaning only one thing runs at a time. If you ask JavaScript to sort 10 million rows of spreadsheet data, the entire webpage freezes while it sorts. Clicks do not work. The UI (User Interface — the visual parts of the page that the user interacts with) does not update. The browser looks broken.

A **Web Worker** is a second JavaScript environment running in parallel — a separate background thread (a thread is an independent sequence of instructions running on a CPU). Think of it as hiring a kitchen cook who works in the back room. The cook can do all the heavy work (sorting, parsing files, running calculations) while the waiter — the main thread — stays free to respond to the customer at any time.

Workers and the main thread are genuinely separate. They do not share memory. They cannot directly call each other's functions. The only way they communicate is via `postMessage()` — a message-passing system like a ticket window between the kitchen and the dining room.

**Why it matters for AutoPilot:** Sorting a 400 MB CSV file takes minutes. Without a Web Worker, the entire UI would freeze for those minutes. With a Web Worker, the sort runs in a background cook's thread, and the user can still scroll the page, view other nodes, and watch the progress bar update — because the waiter is still available.

In the codebase: each job type has its own Worker defined in `src/workers/*.worker.ts`. They are managed via `src/lib/worker-manager.ts`.

---

### Q2: What is OPFS (Origin Private File System)?

Your browser can store data — but it is choosy about what kind. Simple text (like your username or theme preference) goes in `localStorage`. Small structured records (like your history or settings) go in `IndexedDB`. But what about a CSV file with 3 million rows? Neither of those is designed for bulk data.

**OPFS — Origin Private File System** is a browser-built-in private hard drive. "Origin" means it belongs exclusively to one website (for example, `app.autopilot.com`) — no other website can see or touch it. "Private" means it is not visible to the user via normal file explorer dialogs. "File System" means it works exactly like files and folders on your computer — you create directories, write files, read files.

Using the kitchen analogy: OPFS is the **pantry**. When a cook (a Web Worker) finishes processing a dataset, they do not carry 3 million rows back through the ticket window to the dining room — that would be overwhelming. Instead, they put the dataset in the pantry (OPFS) and hand back a small claim ticket: "your data is in pantry/bin-47." The next cook uses the claim ticket to retrieve what they need.

**Technically:** OPFS has two APIs. The asynchronous API works in all modern browsers. The synchronous API (`createSyncAccessHandle()`) is faster but only available inside Web Worker threads on Chromium-based browsers (Chrome, Edge). AutoPilot's workers use the sync API for performance. In the codebase: `src/workers/_opfs-helpers.ts` wraps both APIs. Data is stored at the path `autopilot/executions/{executionId}/{datasetId}/chunk-{index}.json`.

---

### Q3: What is IndexedDB?

IndexedDB is a **database built into every modern browser**. Not a remote database on a server — a local one, living on the user's device, inside the browser.

Think of it as the **recipe card box** in the restaurant. The recipe cards do not contain the actual ingredients — they contain structured information: "Dish A takes 12 minutes, uses ingredients X, Y, Z, serves 4 people." Similarly, IndexedDB in AutoPilot stores metadata about executions and datasets — not the raw row data (which lives in OPFS), but descriptions: how many rows a dataset has, what columns it contains, when the run started, whether it succeeded.

IndexedDB works differently from a traditional database like MySQL or PostgreSQL (server-based databases). It is:
- **Local only** — data stays on the device, not sent to a server.
- **Key-value based** — data is stored in "object stores" (like tables) where each record has a key and a value object.
- **Asynchronous** — every read and write returns a Promise (an IOU for a future result) instead of blocking the thread.
- **Limited in size** — browsers enforce storage quotas (limits).

In the codebase: `src/lib/db.ts` wraps IndexedDB using the Dexie library. Tables include `executions`, `executionNodeOutputs`, `datasets`, `workflows`.

---

### Q4: What is Dexie?

IndexedDB is powerful but notoriously awkward to use directly. Its API (Application Programming Interface — the set of functions a library exposes for other code to call) is verbose and uses an older callback-based style instead of modern async/await syntax.

**Dexie** is a JavaScript library — a pre-written toolkit — that wraps IndexedDB and makes it much easier. Instead of writing ten lines of IndexedDB ceremony to read one record, you write `await db.executions.get(id)`. Dexie translates your simple function call into the underlying IndexedDB machinery.

The kitchen analogy: if IndexedDB is the recipe card filing system (complex, with specific procedures for inserting and retrieving cards), Dexie is the fast-lookup index you stick on the front of the cabinet — you just type the dish name and it hands you the card.

In the codebase: `src/lib/db.ts` defines the Dexie database schema. `db.executions`, `db.datasets`, `db.executionNodeOutputs` are the tables. Every read/write in `execution-engine.ts` goes through this Dexie wrapper.

---

### Q5: What is a chunk?

Loading a 400 MB CSV file all at once into browser memory would likely crash the browser or freeze it. Instead, AutoPilot splits large datasets into smaller pieces called **chunks** — like dividing a very long book into chapters.

A **chunk** is a single JSON file stored in OPFS that contains a fixed number of rows. The default is 10,000 rows per chunk (configurable via performance settings). A dataset of 1 million rows would have 100 chunk files. A dataset of 50,000 rows would have 5 chunk files.

**Why this matters:** Nodes (the processing steps in a workflow) read only the chunks they need, one at a time. A filter node processing 1 million rows does not load all 1 million into memory at once — it loads chunk 1 (10,000 rows), processes them, discards them, loads chunk 2, and so on. Peak memory usage stays low regardless of dataset size.

**Technically:** Each chunk file is a JSON array (`JSON.stringify(arrayOfRows)`), stored at a path like `autopilot/executions/run_abc/dataset_xyz/chunk-0.json`, `chunk-1.json`, etc. The `ChunkedOPFSWriter` class in `src/workers/_opfs-helpers.ts` accumulates rows and auto-flushes when `chunkSize` is reached.

---

### Q6: What is a manifest?

After a worker finishes writing a dataset's chunks to the pantry (OPFS), the next node needs to know: "How many chunks are there? What are their file names? How many rows total? What columns exist?" This description is called a **manifest**.

A manifest is a small structured document — like a table of contents for a book. The book's actual pages are in OPFS (the pantry). The table of contents — the manifest — lives in IndexedDB (the recipe card box) where it can be looked up instantly without opening the pantry.

**What a manifest contains:**
- `datasetId` — the unique identifier of this dataset
- `rowCount` — total number of rows across all chunks
- `chunkCount` — how many chunk files exist
- `byteSize` — total size in bytes
- `chunks` — an array describing each chunk file: its name, row start, row end, and byte size
- `schema` — the column types inferred from the data (e.g. `{ age: { type: "number" }, name: { type: "string" } }`)

**Why separate from chunks?** The inspector panel (the history sidebar in the UI) loads instantly because it only reads manifests from IndexedDB — tiny records. It does not touch the actual row data until the user scrolls to view it.

---

### Q7: What is a DatasetRef?

When a CSV sort node finishes, it has produced a sorted dataset — potentially millions of rows stored in OPFS. The next node needs to know where to find it. But passing millions of rows through the ExecutionContext (the shared scratchpad) would be like the cook carrying a thousand plates through the kitchen with their bare hands — chaotic and impractical.

Instead, the sort worker produces a **DatasetRef** — a small claim ticket — and places it in the ExecutionContext. The claim ticket contains only a pointer: "the sorted dataset has ID `abc123`, it is in OPFS under the execution `run_xyz`, it has 65,000 rows in 7 chunks." The next node reads this claim ticket and fetches only the chunks it needs.

**What a DatasetRef looks like in code:**
```typescript
{
  kind: "dataset",
  datasetId: "abc123",
  executionId: "run_xyz",
  variableName: "sorted_customers",
  rowCount: 65000,
  chunkCount: 7,
  byteSize: 42000000
}
```

The `kind: "dataset"` field is how the execution engine recognizes this as a DatasetRef versus other types of values (like a PDF file or a plain text result).

**Why it matters:** Without this pattern, each node would have to either copy millions of rows into the shared ExecutionContext (bloating memory) or know the storage details of every other node. The DatasetRef decouples what a node produces from where it stores it.

---

### Q8: What is an ExecutionContext?

When a workflow runs, each node needs to pass its output to the next node. The **ExecutionContext** is the shared scratchpad that makes this possible — a JavaScript object (essentially a key-value dictionary) that accumulates all node outputs as the workflow progresses.

Using the restaurant analogy: the ExecutionContext is the **order board** hanging in the kitchen. When the CSV parser finishes, it writes "output = claim-ticket-47" on the board. When the CSV filter runs, it looks at the board, reads "output = claim-ticket-47", fetches that dataset from the pantry, filters it, and writes "filtered_output = claim-ticket-88" on the board. Each cook reads what they need and writes what they produced.

**Technically:** `ExecutionContext` is typed as `Record<string, unknown>` in TypeScript — meaning an object where every key is a string and every value can be any type. Nodes typically write DatasetRefs for large datasets and plain values (strings, numbers, arrays) for small outputs. The execution engine merges each node's returned variables into the shared context using `Object.assign(context, newVars)`.

**Important:** The ExecutionContext is in-memory — it exists only during one workflow run and is discarded when the run ends. Persistent storage happens in OPFS and IndexedDB.

---

### Q9: What is an executor?

In AutoPilot's architecture, every node on the visual canvas corresponds to one **executor** — a JavaScript function that knows how to do that node's job.

The CSV Parse node has a `csv-parse/executor.ts`. The PDF Merge node has a `pdf-merge/executor.ts`. The executor for CSV Filter looks at the filter rules configured in the node's dialog, reads the input dataset from OPFS via the DatasetRef in the ExecutionContext, dispatches the filtering work to a Web Worker, and writes the filtered DatasetRef back into the ExecutionContext.

All executors share the same function signature (shape): they receive `(nodeId, nodeData, context, executionId, onProgress)` and return `Promise<ExecutionContext>` — a promise of new variables to add to the shared scratchpad.

The execution engine does not care what an executor does internally — it only cares that the executor takes context in and returns new variables out. This uniformity makes it easy to add new node types: write an executor that follows the signature, register it in the executor registry, done.

---

### Q10: What is topological sort?

A workflow is a graph of nodes connected by arrows. The arrows show which node's output feeds into which node's input. Before running the workflow, the execution engine needs to figure out: in what order should nodes run? The answer is "parents before children" — a node must run after all the nodes it depends on.

**Topological sort** is the algorithm that produces this ordering. The word "topological" comes from graph theory (the mathematical study of networks of nodes and edges). A sort is an ordering. Topological sort = ordering the nodes of a graph such that every node comes after all its predecessors.

**A simple example:**
```
A → B → D
A → C → D
```
Node D depends on both B and C. B and C both depend on A. Valid orderings: [A, B, C, D] or [A, C, B, D]. Invalid: [D, A, B, C] (D before its parents).

**How the execution engine does it:** It uses a DFS (Depth-First Search — an algorithm that follows one path all the way to the end before backtracking) post-order traversal. "Post-order" means a node is added to the result list after all its children are visited. After collecting results this way, reversing the list gives a valid topological order. The code is in `src/lib/execution-engine.ts` in the `sortNodes()` function.

**Why it matters:** Without topological sort, the engine might try to run a filter node before the CSV parser that produces the data the filter needs. The topological sort guarantees correct dependency order.

---

### Q11: What is esbuild?

Web Workers need to be JavaScript files served at a URL — the browser fetches them like a webpage. But AutoPilot's workers are written in **TypeScript** (a superset of JavaScript that adds type annotations — a way to declare what type of value each variable holds, so typos are caught at compile time rather than at runtime).

TypeScript must be **compiled** (translated) into plain JavaScript before the browser can run it. **esbuild** is an extremely fast compiler that does this translation. It is written in Go (a compiled programming language known for speed) and can compile thousands of files in under a second.

In AutoPilot's build process:
1. Source files in `src/workers/*.worker.ts` are TypeScript.
2. `npm run prebuild` runs esbuild via `scripts/build-workers.mjs`.
3. esbuild compiles each worker TypeScript file into a standalone `.worker.js` file.
4. These `.js` files are placed in `public/workers/`.
5. The Next.js build copies `public/` files into the deployment output.
6. The browser fetches `/workers/csv-sort.worker.js` when it needs to create a CSV sort worker.

If a worker's TypeScript source file exists but is not included in the esbuild configuration, the compiled `.js` file will not exist — and any attempt to use that worker at runtime will fail with a network error.

---

### Q12: What is postMessage?

Workers and the main thread are deliberately isolated from each other — they cannot call each other's functions or read each other's variables. The only communication channel is **postMessage** — a browser API (Application Programming Interface — the set of functions the browser provides for web pages to use) for passing messages between threads.

Using the kitchen analogy: `postMessage` is the **ticket window** between the dining room (main thread) and the kitchen (Web Worker). The waiter writes a ticket ("sort this dataset by date, ascending") and passes it through the window. The cook reads the ticket, does the work, and passes back a result ticket ("done — your sorted dataset is in pantry bin 47").

**How it works technically:**
- Main thread sends: `worker.postMessage(data, [transferList])`
- Worker receives: `self.onmessage = (event) => { const data = event.data; ... }`
- Worker sends back: `self.postMessage(result)`
- Main thread receives: `worker.onmessage = (event) => { const result = event.data; ... }`

The data sent through `postMessage` is **serialised** (converted to a byte stream that can cross the thread boundary) and **deserialised** (reconstructed) on the other side. This means both sides get their own copy of the data — there is no shared memory.

**Exception — Transferable objects:** Large binary blobs (ArrayBuffers — raw memory blocks) can be *transferred* instead of copied. Transfer is O(1) — instant — because it moves ownership from one thread to the other without copying bytes. The sender loses access after transfer.

---

### Q13: What is an ArrayBuffer?

When you open a PDF or a CSV file in a browser, the raw bytes of that file need to live somewhere in memory before they can be processed. That "somewhere" is an **ArrayBuffer** — a fixed-size block of raw binary memory.

Think of an ArrayBuffer as a plain sealed envelope. You know it contains some bytes, but you cannot read them directly until you open the envelope using a "view" — a TypedArray (like `Uint8Array`, which interprets the bytes as unsigned 8-bit integers) or a higher-level decoder.

**Why AutoPilot uses ArrayBuffers:**
- When a user uploads a CSV file, the browser reads it as an `ArrayBuffer`.
- That buffer is transferred (not copied — see Q12) to the csv-parse Web Worker via `postMessage`.
- The worker uses PapaParse (a CSV parsing library) to decode the buffer into rows.
- After parsing, the buffer is discarded — the rows are written to OPFS.

**The serialisation detail:** When the execution engine saves node outputs to IndexedDB, it must strip out any ArrayBuffers (via the `toSerializable()` helper in `execution-engine.ts`) because ArrayBuffers would bloat the database. The file bytes are only kept in memory during active processing.

---

### Q14: What is a dynamic import?

Normally, when a JavaScript module says `import { executor } from "./csv-sort/executor"`, that import runs at the moment the module is first loaded — all imported code is fetched and compiled upfront, even if it is never used.

**A dynamic import** uses `import()` as a function call instead of a statement. This delays the load until the line of code is actually reached at runtime:

```typescript
// This line only loads csv-sort's code when this node is actually in the workflow
const { executor } = await import("@/features/executions/components/csv-sort/executor");
```

In the execution engine (`src/lib/execution-engine.ts`), every node type is registered with a dynamic import loader. The executor code for CSV sort, PDF merge, and every other node type is loaded lazily — only when a workflow actually contains that node type.

**Why it matters:** AutoPilot has 17 node types. The PDF extraction library (`pdfjs-dist`) alone is ~2 MB compressed. If all executors were imported eagerly at startup, every user would download every library for every node type, even if they only use CSV operations. Dynamic imports keep initial page load fast — the user downloads only the code for the nodes they actually use.

---

### Q15: What is a DAG (Directed Acyclic Graph)?

A **graph** (in mathematics and computer science — not a bar chart) is a set of nodes (boxes, circles) connected by edges (lines, arrows). A **directed** graph means the edges have a direction — the arrow points from A to B, meaning "A connects to B" but not necessarily "B connects to A." An **acyclic** graph means there are no cycles — you cannot follow edges and end up back where you started.

A workflow in AutoPilot is a **DAG** — each node is a processing step (upload file, parse CSV, filter rows), and each edge is a connection showing "this node's output feeds into that node." The edges are directed (A produces data that B consumes) and acyclic (the data cannot loop back — you cannot create a circular dependency where A depends on B which depends on A).

**Why "acyclic" matters:** If cycles were allowed, the topological sort (Q10) would fail — there is no valid "parents before children" ordering if a node is its own ancestor. The execution engine assumes the graph is acyclic (React Flow in the UI prevents cycles from being drawn).

**Practical example:** A workflow with Upload → Parse → Filter → Sort → Export is a DAG with 5 nodes and 4 directed edges (Upload→Parse, Parse→Filter, Filter→Sort, Sort→Export). If the user adds a branch (Filter→Aggregate in parallel with Filter→Sort), it is still a DAG — just with a fork.

---

### Q16: What is a jobId?

Every time AutoPilot dispatches a job to a Web Worker, it needs a way to match the worker's eventual reply to the correct caller. The **jobId** is a unique identifier that serves this purpose — like an order number at a restaurant counter.

When you place an order, you get a number. When your order is ready, the server calls that number. You walk up, claim your food. The number is only for matching — it does not describe the food.

Similarly:
- When `dispatchWorkerJob("csv-sort", input)` is called, a random unique string is generated (`createId()` from the `cuid2` library — a generator of short, collision-resistant, URL-safe IDs).
- This `jobId` is included in the `postMessage` sent to the worker.
- The worker echoes the `jobId` back in every reply (progress updates and the final result).
- The `onmessage` handler in `worker-manager.ts` looks up the `jobId` in the `pendingJobs` Map (a key-value store) to find the `resolve` callback for that specific job.

**Why unique IDs?** Multiple jobs can be in-flight simultaneously across different worker types. Without unique IDs, the manager would not know which reply belongs to which waiting executor.

---

### Q17: What is a Promise?

In JavaScript, some operations take time — reading a file, waiting for a network response, waiting for a worker to finish computing. You do not want your program to freeze while waiting. A **Promise** is JavaScript's built-in solution: an object that represents a future value — an IOU.

**The restaurant counter analogy again:** When you order coffee at a café, the barista hands you a buzzer. You walk away, sit down, check your phone. When the coffee is ready, the buzzer lights up. You go back, pick it up. The buzzer is like a Promise — it represents the coffee that does not exist yet, and it will notify you when it is ready.

In code, a Promise has two possible outcomes:
- It **resolves** (succeeds) with a value: "here is the sorted dataset."
- It **rejects** (fails) with an error: "the worker crashed — here is why."

You handle these outcomes with `await` or `.then()`:
```typescript
const result = await dispatchWorkerJob("csv-sort", input);
// code here runs only after the sort completes
```

If you use `await`, the current function pauses at that line (without freezing the browser — the main thread remains free) until the Promise settles. This is called "asynchronous execution" — work that takes time runs outside the main flow without blocking it.

---

### Q18: What are resolve and reject?

When you create a Promise manually (`new Promise((resolve, reject) => { ... })`), JavaScript gives you two special functions inside the constructor: `resolve` and `reject`. These are the only two ways to settle the Promise — to give it its final answer.

- `resolve(value)` — "The operation succeeded. Here is the result." The Promise transitions from "pending" to "fulfilled."
- `reject(error)` — "Something went wrong. Here is the error." The Promise transitions from "pending" to "rejected."

**Why this matters in the worker manager:** When `dispatchWorkerJob()` creates a Promise, it immediately stores the `resolve` and `reject` functions in the `pendingJobs` Map (keyed by `jobId`). The constructor returns the Promise to the caller, who awaits it. Later — potentially 30 minutes later — the worker sends back a result via `postMessage`. The `onmessage` handler retrieves the stored `resolve` and calls it with the worker's output. This bridges the message-passing world of workers with the Promise-based world of async JavaScript.

Without this pattern (storing resolve/reject externally), there would be no way to settle the Promise from outside the constructor — it would be stuck pending forever.

---

### Q19: What is the pendingJobs Map?

The **pendingJobs Map** is the registry that connects in-flight jobs to their waiting callers. It is a JavaScript `Map` — a data structure that stores key-value pairs (unlike a plain object, Map preserves insertion order and allows any key type).

**Key:** the `jobId` string (a unique identifier generated per job)
**Value:** a `PendingJob` object containing `{ resolve, reject, onProgress }` — the three callbacks needed to settle the job's Promise and report progress

**The lifecycle of a pending job entry:**
1. Created by `dispatchWorkerJob()` when a job is dispatched.
2. `onProgress` called each time the worker sends a progress update.
3. `resolve(output)` called when the worker sends `{ kind: "result" }`.
4. `reject(new Error(...))` called when the worker sends `{ kind: "error" }` or crashes.
5. Deleted from the Map after step 3 or 4 — the job is done.

**Why a Map?** Multiple jobs can be in-flight simultaneously (different worker types, different nodes). The Map allows O(1) lookup of any job by its `jobId`. Using an array would require scanning all entries to find the matching job — O(n).

---

### Q20: What is a discriminated union?

In TypeScript (JavaScript with type annotations), a **discriminated union** is a way of describing a value that can be one of several shapes, where a shared field (the "discriminant") lets you tell which shape you have.

The worker message protocol uses this pattern:
```typescript
type WorkerOutboundMessage =
  | { kind: "progress"; jobId: string; progress: number; message?: string }
  | { kind: "result"; jobId: string; output: unknown }
  | { kind: "error"; jobId: string; error: string };
```

The discriminant is `kind`. When the `onmessage` handler receives a message, it checks `msg.kind`:
- If `"progress"` — TypeScript knows `msg.progress` exists (it is safe to read).
- If `"result"` — TypeScript knows `msg.output` exists.
- If `"error"` — TypeScript knows `msg.error` exists.

Without the discriminant, TypeScript would not know which fields are safe to access — reading `msg.progress` when `msg.kind === "error"` would be a bug. The discriminated union pattern makes this a compile-time error instead of a runtime crash.

**Plain English:** it is a way of saying "this value is one of three very different things, and the `kind` field tells you which one."

---

### Q21: What is V8?

**V8** is the JavaScript engine — the software that actually executes JavaScript code. It is built by Google and is the engine inside Chrome, Edge, Node.js, and therefore inside every Web Worker in AutoPilot.

An engine (in the software sense) is a core processing system — the part that does the actual work. V8 takes your JavaScript code, compiles it to machine code (the raw instructions a CPU understands), and runs it.

**Why V8 matters for AutoPilot:** V8 allocates memory (RAM — Random Access Memory — the fast short-term memory a computer uses for currently-running programs) for JavaScript objects on its **heap** (the region of memory where objects live). Each Web Worker has its own V8 instance and its own heap. The heap has a practical limit — typically around 1.5 GB per thread on desktop machines. If a worker tries to allocate more than that, V8 crashes the worker with an OOM (Out Of Memory) error.

Understanding V8 is important when reasoning about memory-intensive operations like the sequence analyzer's unbounded group Map (Q37 / Q81).

---

### Q22: What is OOM (Out Of Memory)?

**OOM** stands for "Out Of Memory." It happens when a program tries to allocate (reserve) more memory than is available. The operating system — the software that manages hardware resources like RAM — cannot give the program more memory, so it forcibly kills the program (or in the case of a Web Worker, just the worker thread).

**The practical consequence in AutoPilot:** If the sequence analyzer worker creates a Map (a data structure that grows as you add entries) with 5 million entries, and each entry uses ~200 bytes, that is 1 GB of memory. V8's heap limit for that thread is ~1.5 GB. The worker crashes. All pending jobs for that worker are rejected. Any OPFS chunks the worker had written before crashing are orphaned (left behind without a manifest).

OOM crashes have no meaningful error message — you see "worker crashed" rather than "worker ran out of memory for its group Map." This is why the architecture documents recommend adding explicit cardinality checks (limits on how many unique values a Map can grow to) with helpful error messages before the OOM would occur.

---

### Q23: What is a heap (in memory terms)?

When a program runs, the operating system gives it memory in two main regions:
- The **stack** — a fixed-size region for function calls and local variables. Fast, but small (usually 1–8 MB). Variables disappear when their function returns.
- The **heap** — a large, flexible region where objects live for as long as they are needed, regardless of which function created them.

In JavaScript/V8, every object you create (`{}`, `[]`, `new Map()`) is allocated on the heap. The **garbage collector** (a background process in V8 that automatically frees memory no longer referenced by your code) periodically scans the heap and reclaims space from objects that nothing is pointing to anymore.

**Why the heap matters here:** A `Map<string, RunState>` with 5 million entries lives on the heap. If the garbage collector cannot keep up (because the Map is still referenced — still actively being used), the heap grows until it hits V8's limit and the worker OOM crashes (Q22).

Workers have their own heap — one per worker thread. An OOM in the csv-sort worker's heap does not affect the csv-filter worker's heap. But if five workers are all memory-heavy simultaneously and they share a machine with 16 GB of RAM, all five can compete for the same underlying physical memory.

---

## Part 2: Architecture Questions

### Q24: Why did AutoPilot move from server-side processing to browser-only?

The fundamental reason is the **60-second timeout wall** on Vercel serverless functions (Vercel — a cloud hosting platform; serverless functions — cloud-hosted pieces of code that run on demand but are killed if they take too long).

Sorting a 400 MB CSV file takes 5–30 minutes. Vercel kills any function that runs longer than 60 seconds. The original solution was to offload the work to BullMQ workers (Node.js processes running on a separate server, pulling jobs from a Redis queue). But this required maintaining Redis (a fast in-memory database used as a queue), a queue worker deployment, and a cloud host — infrastructure that costs money even with zero users.

The browser-only architecture eliminates the timeout problem entirely — **Web Workers have no time limit**. A sort can run for an hour without any external service killing it. And it eliminates the infrastructure cost — the user's own browser IS the compute. There is no server to run.

Additionally, many AutoPilot users process sensitive files (payroll data, HR records, financial reports). The server-side approach required uploading those files to a third-party cloud. The browser-only approach means the data never leaves the user's device — a meaningful privacy guarantee that was impossible with the server architecture.

---

### Q25: What problems did the old server-side architecture create?

Five distinct problems:

**1. The 60-second timeout wall.** Vercel serverless functions cannot run longer than 60 seconds. Heavy CSV/PDF operations take minutes. The only workaround was a complex two-layer system: Inngest (a background job orchestration service) would `step.waitForEvent` (pause the workflow step and wait for a completion signal), while a BullMQ worker (a Node.js process picking jobs from a Redis queue) did the actual computation. This two-layer complexity introduced its own bugs (see Q59–Q71).

**2. Redis connection proliferation.** Every time a node's executor ran inside an Inngest step, it created a `new Queue()` — which opened a new TCP connection (a network connection) to Redis. Under real traffic, this created hundreds of short-lived connections, thrashing Redis's connection table. Redis is not designed to handle hundreds of rapidly-created and destroyed connections.

**3. Timeout synchronization bugs.** Inngest waited 60 minutes for a BullMQ job to complete. BullMQ had no timeout. If a job got stuck, BullMQ never marked it failed. Inngest would abort after 60 minutes. The BullMQ job kept running. When the lock expired, BullMQ would re-queue the job. Two copies of the same job would run simultaneously, corrupting each other's output.

**4. Data privacy problems.** Users had to upload sensitive files to Vercel's cloud to process them. Even with encryption, this is a trust boundary — the data leaves the user's device.

**5. Infrastructure cost.** Running Redis, a BullMQ worker process, and Vercel functions costs money at every scale. With zero users, the bill is non-zero.

---

### Q26: What are the trade-offs of the current browser-only approach?

Every design decision involves trade-offs. Here are the explicit ones for the browser-only architecture:

**What you gain:**
- **Data privacy** — files never leave the user's device.
- **No timeout** — jobs run as long as they need to.
- **No infrastructure cost** — the user's browser is the compute.
- **Offline capability** — works with no internet connection after first load.
- **Simpler deployment** — ship a static site, no server configuration.

**What you give up:**
- **Collaboration** — two users cannot share a workflow run in real time. Each user's data is isolated to their own browser.
- **Mobile support** — mobile browsers have very limited RAM (~1–2 GB total for all apps). Large datasets will OOM-crash on mobile.
- **Cloud-scale compute** — a server with 64 GB of RAM and 32 CPU cores can process far more than a laptop browser.
- **Cross-device access** — a workflow run on one computer cannot be viewed on another (data is local to that browser's OPFS and IndexedDB).

These trade-offs are deliberately chosen. AutoPilot targets single-user, privacy-sensitive data processing on desktop browsers. For that use case, the gains outweigh the losses.

---

### Q27: What is "separation of concerns" and why does it make code better?

"Separation of concerns" is a software design principle: each part of the code should have one clearly defined job, and parts should not do each other's jobs.

Imagine a kitchen where the chef also handles billing, takes reservations, and cleans tables. They are overwhelmed, everything is slow, and a mistake in one area causes problems everywhere. Now imagine separate staff: a chef, a cashier, a host, and cleaning staff. Each knows their job. When the cashier system breaks, the kitchen keeps cooking.

AutoPilot's codebase divides responsibility into four "planes":
- **Control Plane** (`src/features/workflows/`, `src/lib/execution-engine.ts`) — knows what nodes exist and in what order to run them. It does not know how to sort rows.
- **Data Plane** (`src/lib/opfs.ts`, `src/types/dataset.ts`) — knows how to store and retrieve datasets. It does not know about workflow logic.
- **Execution Plane** (`src/features/executions/`, `src/lib/worker-manager.ts`) — knows how to run each specific node's computation. It does not know about the UI.
- **Presentation Plane** (`src/features/editor/`) — knows how to show the workflow canvas and progress. It does not do any data processing.

**Why it matters practically:** When a new developer joins, they can open any single node's folder and understand everything about that node without reading the rest of the codebase. When a bug appears in CSV sorting, the developer knows to look in the execution plane — not in the UI or the data storage layer. New features are added in one place without rippling changes everywhere.

---

### Q28: What does "zero-server execution engine" mean in practice?

It means the entire data processing pipeline — parsing CSV files, sorting rows, joining datasets, extracting PDF text — happens inside the user's browser, with no server involved.

More concretely: `src/lib/execution-engine.ts` is a 636-line JavaScript file. It imports no server-side libraries. It makes no HTTP requests during execution. When you call `runWorkflow()`, it:
1. Reads the workflow definition from memory (already loaded in the browser).
2. Sorts nodes using an in-memory algorithm.
3. Calls each executor function (also loaded in the browser).
4. Each executor sends work to a Web Worker (another browser thread).
5. Workers read from and write to OPFS (browser private file system).
6. Results are saved to IndexedDB (browser database).

Not a single byte of user data is sent over the network during execution. The user could disconnect their internet after loading the page and the workflow would run to completion.

---

### Q29: What is an external merge sort and how does it handle files larger than RAM?

**The problem it solves:** You have 400 million rows in a CSV file. You want to sort them by date. Loading all 400 million rows into memory at once would require roughly 80 GB of RAM — far beyond what any browser has. A normal sort (loading everything, sorting in memory) is impossible.

**External merge sort** is the solution databases and operating systems use for this exact problem. "External" means the data lives on external storage (disk — or in AutoPilot's case, OPFS) rather than fully in memory. It works in two phases:

**Phase 1 — Creating sorted runs:** Read a manageable chunk at a time (64 chunks × 10,000 rows = 640,000 rows, using ~128 MB of RAM). Sort those rows in memory. Write the sorted group back to OPFS as a "sorted run" (a sequential block of pre-sorted rows). Repeat until all input has been processed. If the dataset has 6,400 chunks, you create 100 sorted runs.

**Phase 2 — K-way merge:** Now you have 100 sorted runs. Each run is already in order internally. You need to merge them into one fully sorted output. Keep only one chunk loaded per run (1 run × 10,000 rows each = 1,000,000 rows in memory, ~20 MB). Use a min-heap (Q30) to find the globally smallest row across all runs in O(log K) time. Write it to the output. Advance the cursor for that run. Repeat until all runs are exhausted.

**Peak memory:** Phase 1 uses ~128 MB. Phase 2 uses ~20 MB. The 400 MB dataset never lives fully in memory at any point.

---

### Q30: What is a min-heap and why is it used in the merge phase?

A **min-heap** is a data structure (a way of organizing data in memory for efficient operations) where the smallest element is always at the top, like a tournament bracket where the winner is always visible.

Imagine you have 100 stacks of cards. Each stack is already sorted (smallest on top). You want to merge them into one fully sorted sequence. You could look at the top card of all 100 stacks and pick the smallest — but that means comparing 100 values every time you pick one card. With 10 million total rows, that is 1 billion comparisons.

A min-heap is smarter. It maintains a special tree structure where each parent is smaller than both its children. The root (the very top of the tree) is always the smallest element in the heap. Operations:
- **Push** (add an element): place it at the bottom, "bubble up" until it is larger than its parent. Cost: O(log n) — very fast.
- **Pop** (remove the smallest): swap root with last element, remove last, "bubble down" the root until it is smaller than both its children. Cost: O(log n).

For the merge phase: the heap holds one entry per sorted run: (current top row from run, run index). Pop the smallest row, write it to output, push the next row from that run. Cost: O(log K) per output row, where K is the number of runs. For 100 runs: 7 comparisons per row instead of 100. For 10 million rows: 70 million comparisons instead of 1 billion — a 14× speedup.

---

### Q31: What is a K-way merge and how is it faster than comparing runs one-by-one?

**K-way merge** means merging K sorted sequences simultaneously. "K" is just the variable name for the count of sequences — in the sort worker's case, K is the number of sorted runs (could be 10, 50, or 100).

**Naive approach (comparing one-by-one):** Look at the top of each of the K runs. Find the minimum by comparing all K values. This takes K-1 comparisons per output row. For K=100 and 10 million rows: 990 million comparisons.

**Min-heap approach:** Maintain a heap of (row, run-index) pairs. The heap always exposes the minimum at the top. Pop takes O(log K) instead of O(K). For K=100: log₂(100) ≈ 7 comparisons per output row instead of 99. For 10 million rows: 70 million comparisons — 14× faster.

The benefit grows with K. For K=1000 runs, naive would be 999 comparisons per row; heap would be log₂(1000) ≈ 10 comparisons per row — a 100× speedup. The min-heap is what makes the sort worker practical for large datasets.

---

### Q32: What is a grace hash join and why is it needed for large datasets?

A **join** combines rows from two datasets based on a matching key. Example: join a "customers" table with an "orders" table on the customer ID — for each order, find the customer's name and city.

**Simple hash join (works for small-to-medium data):**
1. Load the smaller (right) dataset into a Map: `{ customerID → [rows with that ID] }`.
2. Stream the left dataset row by row.
3. For each left row, look up its key in the Map — O(1) lookup.
4. Emit joined output.

**Problem:** If the right dataset has 5 million rows, the Map holds 5 million entries — potentially 1 GB of RAM. Browser workers have a ~1.5 GB limit.

**Grace hash join (solves the large-data problem):**
1. Use a hash function (a formula that converts a value into a number) to assign every row from BOTH datasets into K buckets. Rows with the same key always land in the same bucket (because the hash of the same key is always the same number).
2. Process one bucket pair at a time: load right-bucket-i into a Map (it has approximately `total_right_rows / K` rows — much smaller). Join it with left-bucket-i.
3. Repeat for all K buckets.

Peak memory drops from O(right total) to O(right total / K). With K=10 buckets and 5 million right rows: each bucket has 500,000 rows — about 100 MB — well within limits.

The csv-join worker chooses between simple hash join (right dataset ≤ 500,000 rows, the `PARTITION_THRESHOLD`) and grace hash join (right dataset > 500,000 rows) automatically.

---

### Q33: What is a djb2 hash function and why does it assign rows to buckets?

A **hash function** is a formula that takes an input (any string or value) and produces a fixed-size number. Two important properties: (1) the same input always produces the same number, (2) similar inputs produce very different numbers (this is "uniform distribution" — the numbers spread evenly across the possible range).

**djb2** is a specific, simple, fast hash function for strings. Named after Daniel J. Bernstein (the "djb" in the name — his initials). The algorithm:
1. Start with the number 5381.
2. For each character in the string: multiply the running total by 33 and add the character's ASCII code (ASCII — American Standard Code for Information Interchange — a numeric encoding of each character: 'A' = 65, 'a' = 97, etc.).
3. Force the result to a 32-bit integer using `| 0` (a bitwise OR with zero, which truncates to 32 bits — preventing JavaScript's floating-point numbers from growing arbitrarily large).

The result is a number in the range of a 32-bit integer. To assign a row to bucket #i (out of K buckets): `bucketIndex = Math.abs(djb2(rowKey)) % K`.

**Why djb2 works for the join:** As long as the same key always hashes to the same bucket, the join logic is correct. Rows with matching keys (left CustomerID "42" and right CustomerID "42") will always land in the same bucket because `djb2("42")` is always the same number. They will be joined in their shared bucket.

---

### Q34: What is the DatasetRef claim-ticket pattern and why was it created?

Before the DatasetRef pattern, the system stored actual row data in the `ExecutionContext` (the shared scratchpad). A CSV parse node would put all 2 million parsed rows directly into the context object, which the filter node would read. The entire dataset lived in memory, was passed between nodes, and was included in every IndexedDB write. This caused:
- Memory exhaustion on large datasets.
- Slow IndexedDB writes (writing megabytes of JSON on every node completion).
- Context bloat (the context object was enormous, slow to copy and merge).

The **DatasetRef pattern** separates the pointer from the data:
- Workers write data to OPFS (permanent private file storage).
- Workers return a small DatasetRef (a claim ticket with just the ID and metadata) into the context.
- The context stays tiny — a few kilobytes regardless of dataset size.
- The next node fetches only the chunks it needs, one at a time, from OPFS.

This is the same principle a library uses: instead of carrying every book you might want to read, you carry a library card (a tiny identifier) and fetch specific books when you need them.

---

### Q35: What is lazy executor loading and what does it save?

**Lazy loading** means "load only when needed, not upfront." The opposite — **eager loading** — means loading everything at startup.

In the executor registry (`src/lib/execution-engine.ts`), every node type is mapped to a dynamic import loader — a function that, when called, fetches and loads the executor module:

```typescript
[NodeType.PDF_MERGE]: () =>
  import("@/features/executions/components/pdf-merge/executor").then((m) => m.executor)
```

This function is only called when the execution engine encounters a PDF_MERGE node in the current workflow. If the user's workflow has no PDF nodes, the PDF executor is never loaded — and neither is `pdf-lib` (the PDF manipulation library, ~500 KB) or `pdfjs-dist` (the PDF parsing library, ~2 MB).

**What it saves:** If all 17 executors were eagerly imported at startup:
- Every user downloads all libraries (~5–10 MB of JavaScript).
- Even CSV-only users download PDF libraries they will never use.
- Initial page load is slower.

With lazy loading, each user downloads only the libraries for node types they actually use. A pure CSV workflow loads PapaParse (CSV parsing) but not pdfjs-dist. A PDF workflow loads pdfjs-dist but perhaps not the CSV join library.

---

### Q36: What does "sequential node execution" mean and what is wrong with it?

**Sequential** means one after another, in a line. The execution engine runs nodes in this pattern:

```
run node 1 → wait for completion → run node 2 → wait → run node 3 → wait → ...
```

This is correct when nodes depend on each other (node 2 needs node 1's output). But many workflows have **independent branches** — groups of nodes that do not depend on each other at all:

```
Upload File
├─→ Extract Text from PDF → Analyze Sentiment
└─→ Extract Tables from PDF → Filter → Aggregate
```

The "Extract Text" branch and the "Extract Tables" branch both start from the same uploaded file. They do not use each other's outputs. They could run simultaneously — in parallel — both dispatching their Web Workers at the same time. If each branch takes 5 minutes, parallel execution finishes in 5 minutes. Sequential execution takes 10 minutes.

The current execution engine uses a single `for` loop that `await`s each node before proceeding to the next. It cannot dispatch two branches concurrently. The fix would require identifying independent subgraphs after topological sort and using `Promise.all()` (a JavaScript function that runs multiple Promises concurrently and waits for all to complete) to execute them in parallel.

---

### Q37: What is "high-cardinality grouping" and why does it cause crashes?

**Cardinality** means the number of distinct values. High-cardinality grouping means grouping rows by a column that has many unique values.

Example: imagine grouping a dataset of 10 million customer transactions by customer ID. If there are 5 million distinct customers, you have 5 million groups — high cardinality. If there are only 10 product categories and you group by category, you have 10 groups — low cardinality.

In the consecutive sequence analyzer worker (`src/workers/csv-consecutive-sequence.worker.ts`), the code maintains a Map with one entry per unique group key:

```typescript
const runMap = new Map<string, RunState>();
```

Each `RunState` object stores the start value, end value, length, and previous value of the current sequence for that group. For 10 groups this is fine (10 Map entries, trivial memory). For 5 million distinct customer IDs, this is 5 million Map entries.

`RunState` has 4 numbers. Each JavaScript number is 8 bytes. But a Map entry has overhead: the V8 engine (Q21) stores the key string, the object reference, and internal bookkeeping. A realistic estimate is ~200 bytes per entry. At 5 million entries: 1 GB of heap memory (Q23). The worker's V8 instance crashes with OOM (Q22) before completion.

The user sees: "Node failed." No indication that the problem is memory, or that the dataset has too many groups.

---

### Q38: What is the worker pool stall problem when two nodes use the same job type?

The worker pool holds **one Worker thread per job type**. There is one csv-sort worker, one csv-filter worker, one csv-join worker, etc.

Web Worker threads process messages **serially** — one at a time. If two messages arrive while the worker is busy, the second message waits in the worker's internal message queue until the first job is completely finished.

**The stall scenario:** A workflow contains two Sort nodes — "Sort Customers by ID" and "Sort Orders by Date." Both are independent of each other. The execution engine (running sequentially — Q36) dispatches "Sort Customers" first. The csv-sort worker starts. The engine `await`s the first sort to finish, then dispatches "Sort Orders." (Or, if parallel execution were implemented, both would dispatch to the same worker thread simultaneously — the second would queue behind the first anyway.)

In either case, the two sorts run one after the other inside the csv-sort worker thread. There is no way to parallelize them without creating a second csv-sort worker instance. The current architecture does not support multiple worker instances per type.

---

### Q39: Why do performance settings not sync instantly across browser tabs?

**localStorage** (the browser's key-value store for small amounts of persistent data per website) is shared across all tabs of the same website. If the user changes the chunk size setting in Tab A, the value in localStorage updates immediately. Any other tab that reads localStorage will see the new value.

**But there is a timing subtlety:** The performance settings are read at the moment a job is dispatched — specifically, inside `dispatchWorkerJob()`, which calls `getPerformanceSettings()`, which reads localStorage. A job that is already running inside a worker received its settings when it was dispatched. Changing localStorage while that job is running does not affect the running job — the settings were already baked into the `postMessage` input payload.

**The real risk:** If Tab B is running a workflow with conservative settings (chunkSize = 10,000), and Tab A changes settings to aggressive values (chunkSize = 50,000), Tab B's next job will use the aggressive settings — even though the user did not intentionally change Tab B's settings. This could cause an OOM (Q22) in a constrained environment where the user is intentionally running with conservative settings in one tab.

This is rated Low severity because most users do not use AutoPilot in multiple tabs simultaneously.

---

### Q40: What are browser storage quotas and what happens when they are exceeded?

Browsers limit how much disk space a website can use for local storage (localStorage, IndexedDB, OPFS combined). This limit is called the **storage quota**. The quota is not a fixed number — it depends on the browser, the available free disk space on the device, and sometimes the specific browser version. A rough rule: most browsers allow approximately 60% of available free disk space.

If AutoPilot fills the quota:
- The next attempt to write to OPFS throws an error.
- The worker receives the error and sends `{ kind: "error" }` back to the main thread.
- The execution engine marks the node as FAILED.
- The user sees "Node failed" with no indication that the problem is disk space.

AutoPilot does not currently check available quota before starting an execution. The browser provides an API for this:

```javascript
const { usage, quota } = await navigator.storage.estimate();
```

`usage` is how many bytes are currently used. `quota` is the total available. If estimated workflow output would exceed `(quota - usage) × 0.8`, the engine should warn the user before starting.

---

### Q41: What is the OPFS browser compatibility problem?

OPFS has two modes of operation:

**Async mode** (works in all modern browsers including Firefox and Safari): reads and writes return Promises. The code must `await` every file operation. Slower, but universally supported.

**Sync mode** (`createSyncAccessHandle()` — works only inside Web Workers on Chromium-based browsers: Chrome, Edge, Opera): reads and writes are synchronous (instant, no `await` needed). Much faster — especially for sequential reads of many small chunks.

AutoPilot's OPFS helpers use the sync API for performance. On Firefox or Safari, `createSyncAccessHandle()` either does not exist or behaves differently. Workers that call it on these browsers will throw a TypeError (a JavaScript error indicating an operation was attempted on the wrong type of value) and crash.

**The user experience on Firefox/Safari:** certain node types (especially those with heavy chunk I/O like sort and join) may fail silently with "Node failed" immediately. The error is not explained to the user.

**The recommended fix:** Add a feature detection check on app load — check if `FileSystemFileHandle.prototype.createSyncAccessHandle` is defined. If not, show a browser compatibility warning. Long-term: implement an async fallback path in the OPFS helpers.

---

### Q42: Why is "no server-side fallback" a design decision and not a weakness?

This question deserves a direct answer: it depends entirely on what the product is trying to accomplish.

For a product that prioritizes **privacy, offline capability, and zero infrastructure cost**, no server is a feature — not a bug. The user's files never touch a server. No data breach is possible at the server level (because there is no server). The app works on an airplane with no WiFi. Hosting cost is zero beyond serving a static HTML/CSS/JavaScript bundle.

The original critique document listed "no distributed execution" as a weakness because it was evaluating AutoPilot against the standards of an enterprise data platform (multi-user, cloud-scale, collaborative). Against those standards, yes — you cannot scale a browser tab.

But the current AutoPilot is not trying to be an enterprise platform. It is trying to be a private, local data automation tool. For that goal, the absence of a server is architecturally correct. Adding a server would undermine the primary value proposition (privacy) and add infrastructure burden.

**If collaboration becomes a requirement in the future:** the right approach is an opt-in cloud sync layer that syncs workflow definitions and execution history — not a replacement of the browser execution engine.

---

### Q43: What are the five layers data travels through during a workflow run?

When a user runs a CSV sort node, the data moves through these five layers in sequence:

**Layer 1 — Executor** (`src/features/executions/components/csv-sort/executor.ts`): Reads the DatasetRef from ExecutionContext (finds out where the input data is). Calls `dispatchWorkerJob("csv-sort", { inputRef, sortColumns, ... })`.

**Layer 2 — Worker Manager** (`src/lib/worker-manager.ts`): Generates a `jobId`. Reads performance settings from localStorage. Merges settings into the input. Calls `worker.postMessage({ jobId, type: "csv-sort", input })`. Returns a Promise to the executor.

**Layer 3 — Web Worker thread** (`public/workers/csv-sort.worker.js`): Receives the message. Reads input chunks from OPFS one by one. Sorts them using external merge sort. Writes sorted output chunks to OPFS. Calls `self.postMessage({ kind: "result", jobId, output: { manifest, datasetRef } })`.

**Layer 4 — Worker Manager (back on main thread)**: Receives the result message. Looks up the `jobId` in `pendingJobs`. Calls `resolve(output)` — the executor's Promise settles.

**Layer 5 — Execution Engine** (`src/lib/execution-engine.ts`): Receives the DatasetRef from the resolved Promise. Merges it into ExecutionContext via `Object.assign`. Saves the manifest to IndexedDB via Dexie. Proceeds to the next node.

---

### Q44: What format are chunk files stored in and what are the trade-offs?

Chunk files are stored as **JSON arrays** — specifically, each file contains the result of `JSON.stringify(arrayOfRows)`. This is sometimes called "JSON array format" to distinguish it from JSONL (JSON Lines — where each line is a separate JSON object with no wrapping array). The original critique document incorrectly called the format "JSONL"; the revised version corrects this.

**Example chunk file:**
```json
[
  {"name": "Alice", "age": 30, "city": "Paris"},
  {"name": "Bob", "age": 25, "city": "Lyon"}
]
```

**Trade-offs:**

| Pro | Con |
|-----|-----|
| Human-readable — DevTools can open and inspect chunk files | Higher CPU overhead — every number is stored as text characters, not binary |
| No external dependencies — any browser can parse JSON | No columnar compression — "Paris" repeated 1,000 times takes 1,000 × 6 bytes |
| Easily debuggable — copy a chunk URL and paste in browser | No predicate pushdown — cannot skip irrelevant rows without reading the full chunk |
| Simple to write and read — `JSON.parse` / `JSON.stringify` | Larger disk footprint than binary formats |

**Long-term option:** Apache Arrow IPC format is a binary columnar format (data stored column-by-column rather than row-by-row). Reading only the "age" column from Arrow would skip all other columns. Arrow would reduce chunk read time by 3–5× for numeric-heavy datasets. This is an optimization, not a current need.

---

### Q45: Why are manifests stored in IndexedDB separately from chunk data in OPFS?

Two different access patterns call for two different storage systems.

**IndexedDB** (the recipe card box) is designed for small, structured, frequently-queried records. Querying "list all executions from the last 7 days" takes milliseconds because IndexedDB stores records in B-tree indexes (a data structure that keeps records sorted for fast range lookups). A manifest record is ~5 KB — trivially small.

**OPFS** (the pantry) is designed for large, sequential file I/O. Reading 10,000 rows from a chunk file is a file read, not a database query. OPFS is optimized for this access pattern. A chunk file might be 2 MB — too large to store efficiently in IndexedDB without performance degradation.

**The practical consequence:** The execution history UI loads instantly because it only reads manifests from IndexedDB. The actual row data is in OPFS and is only fetched when the user scrolls to view it in the dataset viewer. If manifests were stored in OPFS, listing past executions would require opening and parsing raw files — slow and awkward.

The pattern is: **metadata in IndexedDB, bulk data in OPFS.** This is the correct split for each system's strengths.

---

### Q46: How does real-time progress work inside a browser with no server?

In the old server-side architecture, progress updates required server-sent events (SSE — a server-to-browser push mechanism) or WebSockets (a bidirectional network connection). Both need a server.

In the browser-only architecture, progress uses a simpler and more direct path:

1. The execution engine passes an `onProgress` callback (a function to call with progress updates) into each executor.
2. The executor passes this callback into `dispatchWorkerJob()`.
3. `dispatchWorkerJob()` stores it in the `pendingJobs` Map entry for that job's `jobId`.
4. While running, the worker sends `self.postMessage({ kind: "progress", jobId, progress: 45, message: "Sorted 4,500,000 of 10,000,000 rows..." })`.
5. The `onmessage` handler in `worker-manager.ts` receives this, looks up the `jobId`, finds the stored `onProgress` callback, and calls it.
6. This triggers a Jotai atom update (Jotai — a state management library for React; atoms — small pieces of reactive state) in the UI.
7. React re-renders the progress bar for that node.

The entire chain runs within the browser — no network request, no polling, no server. The data flow is: Worker thread → postMessage → main thread onmessage → callback → Jotai atom → React render.

---

### Q47: What gaps remain in the dataset viewer (inspector panel)?

The inspector panel shows the output of each node after a run. The current implementation correctly loads data in pages (one OPFS chunk at a time — preventing browser freeze on large datasets). But several features that would make it genuinely useful for data exploration are missing:

- **No column-level filter or sort** — users cannot click a column header to sort the viewer by that column, or enter a filter expression to show only matching rows. They must add a Sort or Filter node to the workflow to do this.
- **No CSV/Excel export from the viewer** — to download the result of a node, users must add a File Export node to the workflow. There is no "Download as CSV" button in the inspector directly.
- **No inline editing** — the viewer is read-only. Users cannot correct a value in a cell and save it.

These are UX gaps, not architectural problems. They can be added to the inspector panel independently of the execution engine.

---

### Q48: Why does the app not require user login or authentication?

**Authentication** (the process of verifying who a user is — usually via username/password or OAuth — a protocol that lets users log in via a third party like Google or GitHub) requires a server. The server stores user identities, validates credentials, and issues session tokens (short-lived strings that prove the user is authenticated).

AutoPilot has no server that stores user data. There is nothing to authenticate access to. The app runs entirely on the user's machine, and the data is stored in the user's own browser. The user is always themselves — there is no account system that needs to verify identity.

Adding authentication "just in case" would:
- Require a server to store user credentials (violating the zero-server principle).
- Create a new attack surface (if the authentication server is compromised, accounts are stolen).
- Add friction for users (sign-up flow, password reset, email verification).

**If multi-user or cloud sync features are added in the future**, authentication would be needed specifically for those features — to verify who should have access to shared workflows or cloud-stored execution history. But it would remain unnecessary for local-only processing.

---

### Q49: How do Web Workers naturally sandbox potentially dangerous code?

**Sandboxing** means restricting what code can do — preventing it from accessing things it should not. Web Workers are sandboxed by the browser's security model.

By design, Web Workers:
- **Cannot access the DOM** (Document Object Model — the structured representation of the HTML page; `document`, `window`, HTML elements). A worker cannot read or modify what is displayed on the page.
- **Cannot access `localStorage` or `sessionStorage`** (browser key-value stores accessible from the main thread).
- **Cannot make same-origin network requests** that bypass Content Security Policy (a browser security mechanism that restricts which resources a page can load).
- **Cannot execute child processes** — there is no equivalent of `exec()` or `child_process.spawn()` in a browser worker.

This is why the original "Code node" security concern is resolved: a node that ran arbitrary user-provided JavaScript inside the main thread could access `window`, `document`, `localStorage`, and more — a serious security risk. A Code node running inside a Web Worker would be restricted to the worker's sandbox. The current codebase has removed the Code node entirely from the executor registry, but the sandbox would have mitigated the risk even if it were present.

---

### Q50: How does OPFS prevent one user's data from leaking to another website?

**OPFS is origin-private.** An "origin" is the combination of protocol + domain + port: `https://app.autopilot.com` is one origin; `https://evil.com` is a different origin; `http://app.autopilot.com` (HTTP instead of HTTPS) is a different origin even though the domain is the same.

Each origin has its own isolated OPFS namespace. A file written by `https://app.autopilot.com` to OPFS is accessible only to JavaScript running on `https://app.autopilot.com`. `https://evil.com` has its own OPFS namespace — completely separate — and cannot read files from `https://app.autopilot.com`'s namespace.

This is enforced by the browser at the OS level. There is no API call that a website can make to access another website's OPFS data. The browser's JavaScript engine refuses such requests.

**Additionally:** OPFS data is stored locally on the user's disk. It does not leave the device unless the user explicitly exports a file. AutoPilot's servers cannot access OPFS — the servers only host the static application files (HTML, CSS, JavaScript). They have no mechanism to reach into the user's browser storage.

---

### Q51: What visibility does the current system give into running and past executions?

**During a run:**
- The UI shows a progress panel with the status of each node: idle → running → success/error.
- Each running node shows a progress bar (0–100%) sourced from `WorkerProgressMessage` objects sent by workers via `postMessage`.
- Progress messages include an optional text description (e.g. "Phase 1: creating sorted runs, chunk 45/100").

**After a run (history view):**
- Every execution is stored as a record in IndexedDB with: start time, completion time, total status (SUCCESS/FAILED), and error message if it failed.
- Every node output is stored with: status, duration in milliseconds, which variable it produced, and the DatasetRef if it produced a dataset.
- Users can browse past runs, see per-node timing, and open the dataset viewer to inspect node outputs.

**Via DevTools (browser developer tools — opened with F12 or Ctrl+Shift+I):**
- Application → IndexedDB → AutoPilot database: browse all execution records, node outputs, and dataset manifests.
- Application → Storage → Origin Private File System: navigate the OPFS directory tree, see chunk files, and verify they exist.
- Console: worker crash messages appear as `[WorkerManager] Worker csv-sort crashed: ...`.

---

### Q52: What observability is missing compared to what a server-based system would have?

**Missing: crash reporting.** If the app throws an unhandled error (Q22, worker OOM crash, or a bug in executor code), nothing records it outside the user's browser. The developer cannot proactively discover crashes — they must wait for a user to file a support ticket. A server-based system would have Sentry (an error-tracking service that captures and categorizes errors with stack traces) or a similar tool.

**Missing: performance regression tracking.** There is no automated benchmark suite that runs on every code change and alerts if sorting became 20% slower. In a server-based system, CI (Continuous Integration — automated checks that run on every code commit) could include performance benchmarks.

**Missing: structured error codes.** All error messages are plain strings. There is no error taxonomy (classification system) that would let users search documentation for "error code E4032."

**Missing: log aggregation.** `console.error()` calls in workers disappear when the browser tab closes. A server-based system would send logs to a centralized service (Datadog, Papertrail, CloudWatch) for permanent storage and alerting.

**The recommended partial fix:** Sentry's browser SDK can capture uncaught errors and Promise rejections in the browser without sending user data — if configured to strip row content before transmission via the `beforeSend` hook.

---

### Q53: What is the current state of automated testing in the project?

**There is no automated test suite.** No `__tests__` directories exist. No `.test.ts` files exist. No test runner (Vitest, Jest, Playwright) is configured in `package.json` for production tests.

Every change to the execution engine, worker logic, or executor code is validated only by manually running a workflow and visually checking the output. This is error-prone and slow.

**The practical risk:** A developer fixes a bug in the CSV sort comparator for strings. Accidentally, this change breaks sorting for negative numbers (a common edge case in comparators). Without tests, this regression is invisible until a user reports it — potentially weeks after the commit.

---

### Q54: What types of tests should be added and why each one?

**Unit tests (using Vitest — a fast, TypeScript-native test runner):** Test individual functions in isolation. The external sort algorithm, the min-heap implementation, the grace hash join partitioning function, and the djb2 hash function can all be tested by calling them directly with known inputs and checking the output.

Example: call the sort worker's comparator function with `compareRows({ age: 25 }, { age: 30 }, [{ field: "age", direction: "asc" }])` and assert it returns a negative number (indicating the first row should come first).

**Integration tests for executors:** Provide a real ArrayBuffer (a CSV file's bytes), run it through the full executor chain (csv-parse → csv-filter), and assert that the output DatasetRef points to a dataset in OPFS with the correct rows and schema.

**Property-based tests (using fast-check — a library that generates random inputs and checks that properties always hold):** For sorting, the property is "the output is always in sorted order, regardless of input." fast-check generates thousands of random datasets and verifies the property holds for all of them. This catches edge cases no human test writer would think to test (empty datasets, all-identical values, datasets with nulls, very long strings, Unicode characters in sort keys).

**Target:** 80% code coverage for executor and worker logic. Code coverage means the percentage of code lines that are exercised by at least one test.

---

### Q55: What are the highest-priority items to fix and why?

**1. OPFS browser compatibility layer (High impact, Medium effort):** Firefox and Safari users may encounter silent failures with no explanation. This affects a large percentage of non-Chrome users. It is high priority because it determines who can use the product at all.

**2. Aggregation and sequence analyzer group Map cardinality cap (High impact, Medium effort):** Without this, users processing large grouped datasets will see "node failed" with no actionable explanation. A 5-line change adding a size check with a helpful error message would significantly improve the user experience.

**3. Automatic OPFS cleanup after execution failure (Medium impact, Low effort):** This is the easiest high-value fix — one function call added in `runWorkflow()`'s catch block. Prevents the disk quota exhaustion problem from accumulating silently.

Items 1 and 2 can be done in parallel by two developers. Item 3 can be done in a few hours by any developer.

---

### Q56: What is the scalability roadmap in plain terms?

**Phase 1 — Robustness (next 1–3 months):** Fix the things that break silently today. Add the browser compatibility warning. Add the storage quota guard. Cap the group Map. Auto-clean orphaned chunks. Add unit tests so future changes don't introduce regressions invisibly.

**Phase 2 — Performance (3–6 months):** Fix the things that work but slowly. Implement parallel branch execution (run independent workflow branches simultaneously). Add queue-depth visibility to the UI for the worker stall problem. Investigate Arrow IPC as a faster chunk format.

**Phase 3 — Optional cloud layer (6–12 months):** Add an opt-in cloud sync feature for users who want to access workflows from multiple devices. This is additive — offline-first execution remains the default and is not replaced. Cloud sync would synchronize workflow definitions and execution history metadata (not raw user data, unless the user explicitly opts in to cloud storage).

---

### Q57: Why was the architecture grade raised from B+ to A−?

The original B+ grade reflected a server-side architecture with these significant open problems:
- BullMQ connection leaks causing Redis exhaustion under load.
- Zombie jobs corrupting output (Inngest timeout + BullMQ no timeout = double-execution).
- Credential secrets stored as plaintext in the database.
- Code node with no sandboxing allowing arbitrary system command execution.
- Worker deployment completely undefined (workers could not run on Vercel).
- Sequence analyzer could OOM-kill all five worker queues simultaneously.

All of these problems were eliminated by the architectural pivot to browser-only. The new architecture's open problems are:
- OPFS browser compatibility (an engineering gap, not a design flaw).
- Group Map cardinality (a missing size check, not a fundamental problem).
- Sequential execution (a known limitation with a clear fix path).
- No test coverage (a process gap, not an architectural problem).

These remaining issues are real but smaller in scope and lower in danger. None of them corrupts data, leaks credentials, or allows arbitrary code execution. They cause slow runs or failed nodes with unclear error messages — bad UX, but not catastrophic.

The A− reflects: the core design is excellent (clean separation, powerful algorithms, strong privacy, zero infrastructure); the gaps are fixable engineering tasks rather than fundamental architectural mistakes.

---

## Part 3: Worker Architecture Questions

### Q58: Is the Redis connection proliferation issue still a problem?

**No. Fully resolved.**

In the old architecture, every time a node's executor ran inside an Inngest `step.run()`, it called `new Queue("csv-sort", { connection: new Redis(...) })`. Each `new Queue()` opened a fresh TCP connection (a network connection) to Redis (a fast in-memory database used as a queue). Under real traffic, dozens of these connections were opened and closed rapidly, exhausting Redis's connection table (the list of clients it maintains).

In the current architecture, **Redis does not exist**. There is no queue to open connections to. There is no TCP connection. The worker pool in `src/lib/worker-manager.ts` reuses one Web Worker thread per job type — no connection management needed. The overhead of dispatching a job is a `postMessage()` call, which is an in-process operation (inside the same OS process — the browser) with zero network overhead.

---

### Q59: Is the Inngest–BullMQ timeout incoherence issue still a problem?

**No. Fully resolved.**

The original issue was a timing mismatch: Inngest (the workflow orchestration service) would wait up to 60 minutes for a BullMQ (job queue) job to complete. But BullMQ had no configured timeout on the job itself. If the job got stuck in an infinite loop, BullMQ never marked it failed. After 60 minutes, Inngest aborted the workflow. The BullMQ job kept running indefinitely. When the BullMQ lock eventually expired, the job was re-queued — and a second copy ran while the zombie first copy was still running. Both wrote to the same output dataset, corrupting it.

In the current architecture, **Inngest and BullMQ do not exist**. Web Workers have no external timeout service watching over them. A sort worker running for 60 minutes is simply running for 60 minutes — no external system aborts it. If a worker genuinely gets stuck in an infinite loop, the user can click Cancel (which currently stops dispatching new nodes — the in-flight worker is a separate problem, see Q84). There is no zombie job, no re-queue, no double-execution.

---

### Q60: Is the dual complete/failed event pattern still a problem?

**No. Fully resolved.**

In the old architecture, when a BullMQ job failed, the worker sent two Inngest events: one `csv/sort.failed` event (which was never listened to by any handler — dead noise on the event bus) and one `csv/sort.complete` event with `{ failed: true }` in its payload (the one the executor's `waitForEvent` actually listened to). This pattern was fragile and wasteful.

In the current architecture, there is **no Inngest event bus**. Workers communicate directly with the main thread via `postMessage`. The message protocol has exactly three possible reply types: `kind: "progress"`, `kind: "result"`, and `kind: "error"`. On failure, the worker sends `{ kind: "error", jobId, error: "description" }` — one message, one handler, no dead events.

---

### Q61: Is the csv-join failure asymmetry bug still present?

**No. Fully resolved.**

This was a critical active bug: when a CSV join job failed, the join worker sent only a `csv/join.failed` Inngest event — but the executor's `waitForEvent()` was only listening for `csv/join.complete`. On a join failure, the executor hung for the full 60-minute Inngest timeout before the user saw any error.

The current csv-join worker (`src/workers/csv-join.worker.ts`) uses the same failure path as all other workers:
```typescript
} catch (err) {
  post({ kind: "error", jobId, error: String(err) });
}
```
The `onmessage` handler in `worker-manager.ts` receives this, finds the pending job by `jobId`, and calls `reject(new Error(msg.error))`. The executor's Promise rejects immediately. The execution engine marks the node FAILED immediately. The user sees the error within seconds, not 60 minutes later.

---

### Q62: Is the memory budget in process memory issue still a problem?

**Transformed — same concern, different form.**

The original issue: the `resourceBudgets` Map (which tracked how much memory each execution had consumed) lived in the Next.js server process heap (RAM — Random Access Memory). When the serverless function had a cold start (the first request after the server had been idle — serverless platforms spin down servers when not in use, then spin them back up "cold"), the Map was empty. An execution that had consumed 3.8 GB of a 4 GB budget would, after a cold start, appear to have consumed 0 GB — allowing another 4 GB allocation, potentially causing double the expected memory usage.

The current architecture has no `resourceBudgets` Map and no server process. However, the analogous concern exists at the browser level: **V8's heap limit per worker thread (~1.5 GB) is the effective budget, and it has no enforcement mechanism inside the code.** The worker does not know it is approaching the limit until V8 kills it. This is the root cause of the sequence analyzer OOM problem (Q37/Q81). It is a transformed version of the same concern: memory budget with no proactive enforcement.

---

### Q63: Is the worker deployment undefined issue still a problem?

**No. Fully resolved.**

The original issue was severe: BullMQ workers were long-running Node.js processes. Vercel (the cloud hosting platform) does not support long-running processes. There was no Dockerfile, no Railway/Fly.io service definition, no PM2 configuration (PM2 — a process manager for Node.js applications). If the app were deployed to Vercel without separately deploying the worker processes somewhere else, every CSV/PDF operation would hang silently for the Inngest timeout before failing. Developers had not defined where the workers would run in production.

In the current architecture, **Web Workers run inside the user's browser**. They are compiled JavaScript files (`public/workers/*.worker.js`) served as static assets alongside the rest of the app. Deployment is automatic — `npm run build` compiles the workers, and the built output is deployed as a static site. No separate hosting decision is needed. The only "deployment" concern is ensuring the compiled worker files exist in `public/workers/` — which is now a build-time check (see Q77).

---

### Q64: Is the local filesystem sharing problem still present?

**No. Fully resolved — by design.**

The original issue: datasets were written to `C:/autopilotdata` on the server's local disk. If multiple worker instances ran on different machines (horizontal scaling — running more copies of a service to handle more load), they could not share that filesystem. A job dispatched to worker instance A would write its output to machine A's disk; a job on worker instance B could not read it.

In the current architecture, datasets are written to **OPFS — the browser's private file system**. OPFS is per-browser, per-origin. There is no multi-machine scenario. One user, one browser, one OPFS namespace. The "sharing" problem is irrelevant — the design is explicitly single-user, single-browser.

---

### Q65: Are all workers crashing together (OOM kills all queues) still a risk?

**Transformed — isolated crash instead of all-queues crash.**

The original issue: all five BullMQ worker types (csv-parse, csv-sort, csv-filter, csv-join, csv-consecutive-sequence) ran in a **single Node.js process**. If a sort job on a 400 MB dataset spiked memory usage to 2 GB, and simultaneously a sequence analyzer job on a high-cardinality dataset used another 1.5 GB, the combined 3.5 GB could exceed the machine's available RAM. The OS would OOM-kill the entire Node.js process — eliminating all five queues at once. All in-flight jobs from all five worker types would be lost.

In the current architecture, each Web Worker type is a **separate OS thread** with its own V8 instance and its own heap. An OOM crash in the csv-sort thread kills only the csv-sort thread. The csv-filter thread, csv-join thread, and all other threads continue running unaffected.

However: all worker threads run within the same browser process (the Chrome/Edge process for that tab). If the combined memory usage of all workers together exhausts the machine's physical RAM, the OS may kill the entire browser process — equivalent to the old problem. This is a less likely scenario (browser processes usually get killed before individual workers), but it is not impossible for very large, simultaneous multi-worker runs.

---

### Q66: Is the sequence analyzer unbounded group Map still a problem?

**Yes. Confirmed still present.**

This is the one issue that transferred directly from the old architecture to the new one. The `runMap` in `src/workers/csv-consecutive-sequence.worker.ts`:

```typescript
const runMap = new Map<string, RunState>();
```

Has no size limit. For datasets with millions of unique group keys, this Map grows until V8's heap limit is hit and the worker crashes. The only change between old and new: in the old architecture, the crash killed the entire worker process and all five queues. In the new architecture, only the consecutive-sequence worker thread crashes — other workers continue.

The problem remains: users processing high-cardinality grouped datasets see "node failed" with no indication that the cause is memory. The fix remains the same: add a size check, throw a descriptive error before the OOM occurs.

---

### Q67: Is the mprocs.yaml missing workers issue still relevant?

**No. Fully resolved — the concept no longer applies.**

The original issue: `mprocs.yaml` (a configuration file for running multiple processes in development) only listed one of five BullMQ workers. Developers starting their environment with `mprocs` would be missing four worker processes. Operations requiring those workers would silently hang for the Inngest timeout.

In the current architecture, `mprocs.yaml` may still exist for running Next.js dev server alongside other tools. But **there are no separate worker processes to start**. Web Workers are browser threads — they start automatically when the worker JavaScript file is loaded. Developers run `npm run dev` to start Next.js, and the workers start themselves on demand when the first job is dispatched. No process manager, no separate terminal windows, no risk of forgetting to start a worker.

---

### Q68: Is the `tsx watch` restart-orphans problem still relevant?

**No. Fully resolved.**

The original issue: worker scripts were run with `tsx watch` (a TypeScript execution tool with hot-reload — automatic restart on file changes). Every time a developer saved a source file, `tsx watch` restarted the worker process. If a sort job was in-flight when the restart happened, the BullMQ job lock expired (BullMQ marks jobs as "stalled" and re-queues them if the lock expires), the job was re-queued, and a new copy started from scratch. Partial OPFS writes from the interrupted job were left as orphaned chunks.

In the current architecture, Web Workers are **compiled static files** served from `public/workers/`. They are not run with `tsx watch` in production. In development, `npm run dev` uses Next.js's development server — it does not watch and restart worker files automatically. If a developer changes a worker source file, they must run `npm run prebuild` to recompile it, then reload the browser. There is no hot-reload risk for in-flight worker jobs.

---

### Q69: Is the "no BullMQ dashboard" issue still a concern?

**Transformed — no queue dashboard exists, but the nature of the problem changed.**

The original issue: there was no BullMQ dashboard (a web UI like Bull Board or Arena that shows job queue depth, in-progress jobs, failed jobs, and job retry history). Operators were blind to the state of the job queue.

In the current architecture, there is no queue — so there is no queue dashboard. But the equivalent concern is: **developers have no centralized visibility into worker failures and performance**. The available tools are browser DevTools (only visible to whoever has that specific browser tab open) and the execution history UI (which shows past run status per node).

What is missing: crash reporting to a server (so developers know about failures without users reporting them), queue depth metrics (how many jobs are waiting in each worker's message queue), and log aggregation (storing `console.error` output somewhere permanent). This is a real gap, just expressed differently in the browser context.

---

### Q70: Is the home-built slot semaphore still wasting Redis operations?

**No. Fully resolved.**

The original issue: `MAX_CONCURRENT_HEAVY_EXECUTIONS: 2` was enforced via a home-built Redis FIFO queue with poll-based slot acquisition every 150 ms. Under 100 concurrent workflow requests, this created 666 Redis operations per second for slot management alone — wasteful and scaling poorly.

In the current architecture, **Redis does not exist**. There is no slot semaphore. The worker pool naturally limits concurrency per job type: there is one worker thread per job type, and it processes messages serially. This is implicit concurrency limiting — no polling, no Redis operations, zero overhead.

The limitation is that this implicit limiting has no user-visible queue depth. Users cannot see "there are 3 jobs waiting for the csv-sort worker." This is a UX gap but not a performance problem.

---

### Q71: Are progress events still fire-and-forget under external rate limits?

**Transformed — the risk is now internal, not external.**

The original issue: progress events were sent via Inngest's event bus. Inngest rate-limited how many events could be sent per second. Under high load, progress events were silently dropped (the code used `.catch(() => {})` to swallow send errors). Users would see a frozen progress bar even when a job was still running.

In the current architecture, progress events travel via `postMessage()` — no external service, no rate limiting, no network. As long as the worker thread and main thread are both alive and communicating, every progress event arrives. There is no external rate limit to hit.

The transformed risk: if the **worker itself crashes** (OOM, unhandled exception) while a progress update is being sent, the update is lost — the worker is gone. The main thread receives `worker.onerror`, rejects all pending jobs, and the progress bar stops updating. This is much less common than Inngest rate limiting under load, and the failure is obvious (the node fails) rather than silent (a frozen progress bar on a still-running job).

---

### Q72: What are the three key data structures that coordinate all worker activity?

All three live in `src/lib/worker-manager.ts` as module-level constants — they persist for the lifetime of the page.

**1. `workerPool: Map<WorkerJobType, Worker>`**
The roster of active cooks. Maps each job type string (e.g. `"csv-sort"`) to its live `Worker` object (a browser thread). When `getOrCreateWorker("csv-sort")` is called:
- If `workerPool.get("csv-sort")` returns a Worker, return it immediately (reuse the existing cook).
- If it returns `undefined`, create `new Worker("/workers/csv-sort.worker.js", { type: "module" })`, set up its event handlers, store it in the map, return it.

**2. `pendingJobs: Map<string, PendingJob>`**
The claim ticket registry. Maps `jobId` strings to `{ resolve, reject, onProgress }` objects — the callbacks needed to settle each in-flight job's Promise. Created in `dispatchWorkerJob()`, deleted when a job receives `kind: "result"` or `kind: "error"`.

**3. `getWorkerUrl()` (function, not a Map, but serves as a lookup)**
Maps each `WorkerJobType` to the URL of its compiled `.worker.js` file in `/public/workers/`. This is what `new Worker(url)` uses to fetch the worker script. If a URL points to a file that does not exist, the worker creation fails with a network error.

---

### Q73: What is the message protocol and what are the three kinds of replies a worker can send?

The protocol is a **discriminated union** — a set of message shapes that share a `kind` field. The `kind` field tells the receiver exactly what shape the message is and therefore which other fields exist.

**Main thread → Worker (one type: job dispatch):**
```
WorkerJobMessage {
  jobId: string      — the unique order number for this job
  type: WorkerJobType — which cook to address ("csv-sort", "pdf-merge", etc.)
  input: object      — all parameters the job needs, plus performance settings
}
```

**Worker → Main thread (three possible reply types):**

`kind: "progress"` — "I am still working; here is my current progress percentage."
Fields: `{ kind, jobId, progress: 0-100, message?: string }`
The `onmessage` handler calls `pending.onProgress(msg.progress, msg.message)`. Does NOT delete the pending job (more updates may follow).

`kind: "result"` — "I finished successfully; here is my output."
Fields: `{ kind, jobId, output: TOutput }`
The `onmessage` handler calls `pending.resolve(msg.output)`. Deletes the pending job entry.

`kind: "error"` — "I failed; here is why."
Fields: `{ kind, jobId, error: string }`
The `onmessage` handler calls `pending.reject(new Error(msg.error))`. Deletes the pending job entry.

Note: Error objects cannot be serialized across threads. That is why the error field is a `string` — the worker converts any thrown error to a string with `String(err)` before sending it.

---

### Q74: Walk me through exactly what happens, step by step, when a CSV sort job is dispatched.

Starting from the moment an executor calls `await dispatchWorkerJob("csv-sort", input)`:

**Step 1:** `dispatchWorkerJob()` creates a `new Promise<SortOutput>`. Inside the Promise constructor, `resolve` and `reject` functions are captured.

**Step 2:** `createId()` generates a unique `jobId` string (e.g., `"cm9fqb3ap0001..."` — a cuid2 string, collision-resistant and URL-safe).

**Step 3:** `pendingJobs.set(jobId, { resolve, reject, onProgress })` stores the callbacks.

**Step 4:** `getOrCreateWorker("csv-sort")` is called. If the csv-sort worker already exists in `workerPool`, it is returned. If not, `new Worker("/workers/csv-sort.worker.js", { type: "module" })` creates it, its `onmessage` and `onerror` handlers are attached, and it is stored in `workerPool`.

**Step 5:** `getPerformanceSettings()` reads `localStorage` on the main thread. Workers cannot access localStorage, so performance settings (chunkSize, maxUnionRows, etc.) are read here.

**Step 6:** Settings are merged into the input: `{ ...perfSettings, ...safeInput }`. Keys with `undefined` values are stripped (undefined cannot be serialized by `postMessage`).

**Step 7:** `worker.postMessage({ jobId, type: "csv-sort", input: enrichedInput }, [])` sends the job to the worker. The second argument is the transfer list (empty here — the input object is copied, not transferred).

**Step 8:** The Promise is returned to the executor. The executor's `await` suspends. The main thread's event loop is free.

**Step 9 (in the worker thread):** `self.onmessage` fires. The worker reads `inputRef` (the DatasetRef), fetches OPFS chunks, performs the external merge sort, writes sorted chunks to a new OPFS dataset, then calls `self.postMessage({ kind: "result", jobId, output: { manifest, datasetRef } })`.

**Step 10 (back on main thread):** `worker.onmessage` fires. The handler reads `msg.kind === "result"`, looks up `pendingJobs.get(msg.jobId)`, calls `pending.resolve(msg.output)`. The executor's `await dispatchWorkerJob(...)` resumes with the output. `pendingJobs.delete(msg.jobId)` removes the entry.

---

### Q75: What is the missing compiled worker files bug and why does it cause a silent failure?

`WorkerJobType` in `worker-manager.ts` lists 15 job type strings. The `getWorkerUrl()` function maps all 15 to `.worker.js` file paths in `/public/workers/`. The build process compiles TypeScript source files from `src/workers/` into those JavaScript files. But **not all source files are included in the esbuild build step**.

Specifically, `pdf-merge.worker.ts` and `pdf-split.worker.ts` exist as source files in `src/workers/`, and their executors (`pdf-merge/executor.ts`, `pdf-split/executor.ts`) are registered in the execution engine. But the esbuild build script does not compile them. The compiled files `/public/workers/pdf-merge.worker.js` and `/public/workers/pdf-split.worker.js` do not exist on the server.

**Why it is silent:** When a user adds a PDF Merge node and runs the workflow, `getOrCreateWorker("pdf-merge")` calls:
```javascript
new Worker("/workers/pdf-merge.worker.js", { type: "module" })
```
The browser tries to fetch this URL. The server returns a 404 (HTTP status code meaning "file not found"). The Worker constructor fails. The `worker.onerror` handler fires with message: "Failed to fetch." `worker-manager.ts` rejects all pending jobs for this worker. The execution engine receives the rejection and marks the node FAILED.

The user sees: "Node failed" — with no indication that the software itself is broken, rather than their input being wrong.

---

### Q76: How would a user experience this bug and what would they see?

1. User drags a "PDF Merge" node onto the canvas.
2. Connects two PDF file upload nodes to it.
3. Clicks "Run."
4. The workflow starts. Upload nodes complete (green checkmarks). The PDF Merge node shows "running" briefly.
5. PDF Merge node turns red. "Node failed."
6. The error message (visible in the node output panel or browser console) says something like: "Worker pdf-merge crashed: Failed to fetch" or "Worker pdf-merge crashed: undefined."
7. The user tries different PDF files. Same result. They try reloading. Same result.
8. They cannot tell: is the file too large? Is the PDF format incompatible? Is there a bug in the software? The error message gives no clue.

This is the worst kind of bug: a software infrastructure failure that surfaces as a user error.

---

### Q77: How do we fix the missing compiled workers permanently?

**Step 1 — Immediate fix:** Add `pdf-merge.worker.ts` and `pdf-split.worker.ts` to the esbuild input file list in the build script (likely `scripts/build-workers.mjs` or `package.json`'s `prebuild` script). Run the build. Verify the compiled files appear in `public/workers/`.

**Step 2 — Preventive fix:** Add a build-time check after compilation that fails the build if any registered worker type is missing its compiled file:

```javascript
const EXPECTED_WORKERS = [
  "csv-parse", "csv-filter", "csv-sort", "csv-join", "csv-aggregate",
  "csv-deduplicate", "csv-compare", "csv-transform", "csv-column-transform",
  "csv-restructure", "csv-consecutive-sequence",
  "pdf-extract-text", "pdf-extract-tables", "pdf-merge", "pdf-split"
];
for (const type of EXPECTED_WORKERS) {
  const filePath = `public/workers/${type}.worker.js`;
  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: Missing compiled worker: ${filePath}`);
    process.exit(1); // fail the build
  }
}
```

This turns a silent runtime failure into a loud build-time failure — caught by CI (Continuous Integration — automated checks that run on every code commit) before the broken code reaches production.

---

### Q78: Why does having two CSV Sort nodes in one workflow cause a hidden stall?

The root cause is two architectural facts combining:

**Fact 1:** The worker pool stores one Worker instance per job type. There is exactly one csv-sort thread. There will never be a second csv-sort thread running simultaneously.

**Fact 2:** Web Workers process messages serially. The worker's `self.onmessage` handler runs one message at a time. When message 1 is being processed (a sort that takes 20 minutes), message 2 waits in the worker's internal message queue. It cannot start until message 1's handler returns.

**What happens in a workflow with two Sort nodes:**
1. The execution engine runs Sort-A. The executor calls `dispatchWorkerJob("csv-sort", inputA)`. `pendingJobs` gets entry `{ jobId: "job-A", resolve: resolveA }`. Worker receives the message and starts sorting.
2. The execution engine `await`s Sort-A. (In the current sequential model, it does not even reach Sort-B until Sort-A is done.)
3. Sort-A finishes. Execution engine moves to Sort-B. `dispatchWorkerJob("csv-sort", inputB)`. Worker receives message 2. Starts sorting.

In the *current* sequential engine, the two sorts always run in sequence anyway — the second one is only dispatched after the first resolves. The stall is a future concern: if parallel branch execution is implemented (two branches dispatching their sorts simultaneously), both messages would arrive in the worker's queue while it is busy — and the second would wait.

Either way, users do not see any indication that a sort job is queued rather than running. The status shows "running" the moment the executor dispatches — regardless of whether the worker has started the actual work.

---

### Q79: How can we detect the stall today without fixing anything?

Add a `console.warn` in `dispatchWorkerJob()` that fires when a new job is dispatched for a worker type that already has a pending job:

```typescript
// Check if this worker type already has a pending job
const hasPending = [...pendingJobs.values()].some(
  (p) => p.workerType === type // requires storing workerType in PendingJob
);
if (hasPending) {
  console.warn(
    `[WorkerManager] "${type}" already has a pending job. New job will queue behind it.`
  );
}
```

This requires adding `workerType: WorkerJobType` to the `PendingJob` type definition. The warning appears in the browser console (F12 → Console tab). It does not fix the stall or improve the user experience, but it makes the behavior observable to developers diagnosing slow workflows.

---

### Q80: What is the full fix for the worker queue stall?

**Option A (minimal — an hour of work):** Add the `console.warn` above (Q79). Document the limitation in code comments. Accept the stall as a known limitation and advise users not to put two identical heavy job types in one workflow.

**Option B (complete — days of work):** Introduce a `"queued"` status in the execution engine alongside the existing `"idle"`, `"running"`, `"success"`, and `"error"` statuses. When `dispatchWorkerJob()` detects that the target worker type already has a pending job, it stores the new job in a per-type queue (an array) rather than sending it immediately. The UI shows a clock icon for queued nodes. When the current job finishes and the `resolve` callback fires, the manager checks the queue, dequeues the next job, sends it to the worker, and updates the status from `"queued"` to `"running"`.

This requires:
- Adding `"queued"` to `NodeStatus` in `execution-engine.ts`.
- A per-type deferred job array in `worker-manager.ts`.
- A UI component update in the progress panel to render the queued state.

Option B is the correct long-term fix and matches how real job queues work — making the implicit queue explicit and visible.

---

### Q81: Why does the runMap grow dangerously large on some datasets?

The consecutive sequence analyzer (`src/workers/csv-consecutive-sequence.worker.ts`) processes data in one streaming pass through the OPFS chunks. As it reads rows, it maintains state for every active group — "what is the current sequence in progress for this group key?"

The `runMap` stores one `RunState` per unique group key currently being tracked. The map entries are never evicted — they accumulate until the end of the dataset. For a dataset grouped by customer ID:
- 1,000 customers → 1,000 Map entries → ~200 KB. Fine.
- 100,000 customers → 100,000 entries → ~20 MB. Fine.
- 5,000,000 customers → 5,000,000 entries → ~1 GB. Worker OOM crash.

The Map grows unboundedly because there is no mechanism to flush completed group states to OPFS and evict them from memory. Once a group key is added to `runMap`, it stays there until the worker finishes. For a dataset with many distinct groups, this is effectively loading the entire "state per group" into RAM simultaneously.

---

### Q82: Why is this called "CONFIRMED" rather than "RESOLVED" compared to the old architecture?

In the old architecture, the same problem existed in the server-side BullMQ workers. The difference was in the blast radius: a crash in the old system killed the entire Node.js process hosting all five BullMQ worker queues — one OOM in the sequence analyzer would simultaneously kill the csv-sort queue, the csv-filter queue, the csv-join queue, and the csv-parse queue. All in-flight jobs across all job types would be lost.

In the current architecture, each Web Worker type is a separate OS thread. A crash in the csv-consecutive-sequence thread kills only that thread. The csv-sort thread, csv-filter thread, and all other threads continue running unaffected. The blast radius has shrunk significantly.

But the underlying memory problem — the unbounded runMap — is the same. The data structures and access patterns are identical. "CONFIRMED" means: same root cause, smaller impact, not yet fixed.

---

### Q83: What is the proposed fix and what are the two options?

**Option 1 — Hard stop with a descriptive error (easier, immediate value):**
Inside the chunk processing loop, check `runMap.size` after every addition:

```typescript
if (runMap.size > MAX_GROUP_KEYS) {
  throw new Error(
    `Analysis stopped: dataset has more than ${MAX_GROUP_KEYS.toLocaleString()} ` +
    `unique groups. Consider pre-filtering rows to reduce distinct values in the grouping column.`
  );
}
```

`MAX_GROUP_KEYS` defaults to 500,000 (overridable via performance settings). This throws before the OOM crash, producing a clear, actionable error message. The cost: datasets that would have worked at 500,001 groups now fail. The benefit: datasets that would have crashed silently now fail with an explanation.

**Option 2 — Spill to OPFS (harder, correct solution):**
When `runMap.size` exceeds the threshold, flush all completed sequences (groups where the sequence has been broken) from the Map to OPFS as partial result rows. Evict those entries from the Map, freeing heap memory. Continue streaming. At the end, merge the partial results from OPFS with the remaining in-memory Map entries.

This is conceptually similar to how the external sort handles data that exceeds memory: write sorted runs to OPFS, merge them at the end. Option 2 requires significant new code and testing. Option 1 is the pragmatic immediate fix.

---

### Q84: Why doesn't clicking Cancel actually stop the currently-running worker immediately?

The execution engine's cancel mechanism works by checking an `AbortSignal` (a browser API object whose `aborted` property becomes `true` when `controller.abort()` is called) at the top of the node loop:

```typescript
// From execution-engine.ts
if (signal?.aborted) {
  throw new DOMException("Workflow cancelled", "AbortError");
}
```

This check happens **before each node starts**. It does not happen **during** a node's execution. The execution engine calls `await executor(...)` and suspends — waiting for the Promise to settle. While suspended, it cannot check the AbortSignal.

The running worker is a completely separate thread. It has no reference to the AbortSignal. The main thread has no way to interrupt the worker mid-computation — `postMessage()` cannot send a "stop" signal that the worker is designed to receive and honor (because the worker code does not listen for such a signal).

The result: Cancel registers immediately (the signal is set), but the currently-running job completes before the cancellation takes effect. Only when the job finishes and the executor's Promise resolves does the next iteration of the node loop run the AbortSignal check and stop.

---

### Q85: What happens step by step after the user clicks Cancel (the full sequence)?

1. User clicks Cancel. The UI calls `controller.abort()`.
2. `signal.aborted` becomes `true`.
3. The execution engine is currently suspended at `await executor(...)` for the running node (e.g., csv-sort). It cannot check the signal while suspended.
4. The csv-sort worker continues sorting. It may take 20 more minutes.
5. The csv-sort worker finishes. It sends `self.postMessage({ kind: "result", jobId, output })`.
6. The main thread's `onmessage` handler fires. It finds the pending job, calls `resolve(output)`.
7. The executor's `await dispatchWorkerJob(...)` resolves. The executor continues — it merges the result into ExecutionContext, the manifest is saved to IndexedDB.
8. `executor()` returns `newVars`. The execution engine receives the returned variables.
9. `Object.assign(context, newVars)` runs — the result is merged into context even though we are "cancelled."
10. The loop's next iteration runs: `if (signal?.aborted)` — yes, it is aborted. `throw new DOMException("Workflow cancelled", "AbortError")`.
11. The outer catch block handles the AbortError: marks the execution as FAILED/Cancelled in IndexedDB, calls `callbacks.onWorkflowStatusChange("error")`.
12. The user sees the workflow marked as cancelled.

The sort worker ran 20 minutes past the Cancel click. Its output was even briefly merged into context before the abort was detected. Wasted CPU and memory, but no correctness issue — subsequent nodes do not run.

---

### Q86: How would we properly propagate the cancel signal to in-flight workers?

The fix requires three additions:

**1. Track which job is in-flight per worker type.** Add an `inFlightJobs: Map<WorkerJobType, string>` (mapping job type to the currently-executing jobId) in `worker-manager.ts`. When a job starts executing in the worker, record it. When it resolves/rejects, remove it.

**2. Add an abort handler in the execution engine.** When `signal` is provided and the execution loop starts a node, attach a one-time `signal.addEventListener("abort", ...)` handler. If abort fires while a node is executing, the handler calls `abortInFlightWorkers()`.

**3. `abortInFlightWorkers()`:** For each entry in `inFlightJobs`, call `worker.terminate()` (immediately kills the worker thread), remove the worker from `workerPool` (the pool's lazy-creation will reinitialize it next time), and reject the pending job's Promise with a cancellation error.

After termination, the rejected Promise propagates to the executor, which throws. The execution engine's outer catch block handles it as a cancellation. The OPFS chunks written before termination are orphaned — auto-cleanup (Q89) should also be triggered here.

---

### Q87: What are orphaned OPFS chunks and how do they appear?

An "orphaned" OPFS chunk is a chunk file in OPFS that no IndexedDB manifest claims. It is data that was written but never registered — like items left in the pantry with no entry in the recipe card box.

**How they appear:** When a worker crashes or is terminated mid-computation:
1. The worker has written 3 of 10 planned chunk files to OPFS.
2. The worker crashes (OOM) or is terminated (Cancel fix).
3. The `worker.onerror` handler fires. The pending job is rejected. The execution engine marks the node as FAILED.
4. The 3 chunk files remain in OPFS. They have no manifest — no IndexedDB record links them to any execution or dataset.
5. `cleanupOrphanedOPFSData()` in `src/lib/opfs.ts` would find and delete them by comparing OPFS directories against IndexedDB records.
6. But `cleanupOrphanedOPFSData()` is only called when the user manually clicks "Clean Storage" in the Settings page.

The files sit in OPFS, invisible to the user, consuming disk quota indefinitely.

---

### Q88: What symptom does a user see when orphaned chunks eventually fill the storage quota?

The user runs a new workflow. A node writes its output chunks to OPFS. At some point during the write, the OPFS quota (Q40) is exhausted. The OPFS write API throws a `DOMException: QuotaExceededError`.

The worker's error handler catches this, sends `{ kind: "error", jobId, error: "QuotaExceededError: ..." }`. The execution engine marks the node as FAILED. The user sees "Node failed."

The error message might say "QuotaExceededError" or a browser-specific variant, but the user has no reason to connect this to orphaned chunks from previous failed runs. They might try smaller files, different node configurations, or give up entirely.

**The fix:** Automatically call `cleanupOrphanedOPFSData()` after any execution failure, so orphaned chunks never accumulate to the point of exhausting the quota.

---

### Q89: What is the short-term fix vs the long-term fix for orphaned chunks?

**Short-term fix (immediate, ~1 hour of work):**
In `runWorkflow()` (`src/lib/execution-engine.ts`), in the outer `catch` block after any node failure, add:

```typescript
cleanupOrphanedOPFSData().catch(() => {}); // fire and forget
```

Import `cleanupOrphanedOPFSData` from `src/lib/opfs.ts`. This runs the cleanup asynchronously (without blocking the error handling path) after every failed execution. Orphaned chunks are deleted automatically. No user action required.

**Long-term fix (better, ~1–2 days of work):**
Before a node starts writing to OPFS, create a "pending" marker in IndexedDB — a dataset record with status `"in-progress"`. If the run fails, the cleanup function looks for `"in-progress"` dataset records with no corresponding `"SUCCESS"` execution and deletes them.

This is more robust: even if the browser is closed mid-write (the short-term fix's `cleanupOrphanedOPFSData()` would not run in that case — the page is gone), the `"in-progress"` marker persists in IndexedDB and the cleanup runs on the next app open. It also handles the case where the cleanup function itself crashes partway through.

---

### Q90: Wait — does changing settings in Tab B actually update Tab A immediately?

**The short answer: it depends on what "update" means.**

**For reads — yes, immediately.** `localStorage` is shared across all tabs of the same origin. If Tab B sets `localStorage.setItem("autopilot-perf-chunkSize", "50000")`, and Tab A calls `localStorage.getItem("autopilot-perf-chunkSize")` a millisecond later, Tab A reads `"50000"`. There is no delay, no sync required — they share the same underlying storage.

**For jobs already dispatched — no.** Performance settings are read by `dispatchWorkerJob()` at the moment the job is dispatched. The settings are merged into the input payload and sent to the worker via `postMessage`. After the `postMessage` call, the job is running inside the worker with those baked-in settings. Changing `localStorage` after the job starts does not change anything — the worker received its copy of the settings via structured clone (a deep copy mechanism used by `postMessage`) and has no further connection to `localStorage`.

**For the next job dispatched — yes, immediately.** The next call to `dispatchWorkerJob()` in Tab A will call `getPerformanceSettings()` again, read the new `localStorage` value set by Tab B, and use it.

**The real risk:** It is not about tabs "not syncing" — they sync too well. If Tab B increases chunkSize to 50,000 while Tab A is about to dispatch a job, Tab A's next job will use the aggressive settings from Tab B, even though the user only intended to change Tab B's settings. In a memory-constrained environment, this could cause an OOM in Tab A.

The fix is a note in the settings UI: "Performance changes apply to the next workflow run" — setting correct expectations, even if the underlying behavior is technically correct.

---

### Q91: What is the real risk of the cross-tab settings situation?

The real risk is **unexpected settings inheritance**, not a synchronization failure.

Scenario: A developer is testing a heavy workflow in Tab A with conservative settings (chunkSize = 5,000, maxUnionRows = 100,000) to avoid OOM on a dataset with tight memory. In Tab B, they change settings to Maximum (chunkSize = 50,000, maxUnionRows = 500,000) to speed up a small workflow. They return to Tab A, click Run. Tab A's next job dispatches with chunkSize = 50,000 — 10× more aggressive than intended. The heavy workflow OOM-crashes.

This is an unlikely but confusing scenario. Most users do not run AutoPilot in multiple tabs. And even if they do, the vast majority of workflows do not run near the memory limit. The Low severity rating reflects: low probability × moderate impact = low overall risk.

---

### Q92: What happens if a user clicks "Run" on three different workflows simultaneously?

All three `runWorkflow()` calls execute concurrently in the browser's event loop (the mechanism that coordinates JavaScript's single main thread by interleaving multiple asynchronous operations — none of them block the thread because they `await` worker results, not synchronously compute).

Each run dispatches jobs to the shared worker pool. If all three dispatch a csv-sort job at the same moment:
- All three `postMessage()` calls arrive in the csv-sort worker's message queue in rapid succession.
- The csv-sort worker processes them one at a time: sort-A, then sort-B, then sort-C.
- Run 2 and Run 3 appear to be "running" (the UI shows them as in-progress because the executors have been called and are awaiting their Promises), but the actual sort has not started for them.
- Sort-B starts only when Sort-A finishes. Sort-C starts only when Sort-B finishes.

The user sees three workflows showing "running" simultaneously, but the total time is the sum of all three sorts rather than the maximum of the three. No error — just unexpected slowness and no explanation.

---

### Q93: Why is this rated "Low" severity rather than "High"?

Three reasons:

**1. Uncommon scenario.** Most users run one workflow at a time. The case of three simultaneous runs is an edge case that requires deliberate action (clicking Run three times quickly on different workflows).

**2. No correctness issue.** All three workflows eventually complete with correct results. The only problem is that runs 2 and 3 take longer than expected.

**3. No user data is at risk.** The stall is confusing but harmless. It eventually resolves on its own without any user intervention.

Compare to the Critical bug (missing compiled workers, Q75): that one completely prevents a feature from working at all, with a misleading error message, for any user who uses PDF Merge or PDF Split. That is a much higher severity.

---

### Q94: What observability does the browser architecture provide today?

**Built into the app (visible to all users):**
- Execution history list: every past run with status (SUCCESS/FAILED), start time, and duration.
- Per-node status and duration in the execution detail view.
- Live progress bars per node during a run.
- Error messages in the node output panel when a node fails.

**Available to developers via browser DevTools (F12):**
- Console tab: worker crash messages (`[WorkerManager] Worker csv-sort crashed: ...`), any `console.log` output.
- Application → IndexedDB: full access to execution records, node output records, dataset manifests. Can inspect any field of any record.
- Application → Storage → Origin Private File System: directory tree of all OPFS files. Can see exactly which chunk files exist for each dataset.
- Network tab: can observe which worker files were fetched, and whether any returned 404.
- Performance tab: can profile CPU and memory usage during a workflow run.

---

### Q95: What is a "dead-letter queue" and why is its absence a problem?

A **dead-letter queue** (also called a DLQ) is a secondary queue that receives jobs that have permanently failed — jobs that exceeded their retry limit or failed with a non-retryable error. It is a "holding area" for failed work that needs human investigation.

In the old BullMQ architecture, jobs that failed too many times would move to BullMQ's built-in failed set — a dead-letter queue. An operator could look at the failed set, see why each job failed (with the error message and stack trace), and decide whether to retry, fix the data, or discard.

In the current architecture, failed jobs are rejected Promises. Their failure information is stored as an `error` string in the `executionNodeOutputs` IndexedDB record. This serves as a basic dead-letter mechanism — you can query IndexedDB for all FAILED node records and see their error messages.

**What is missing compared to a real DLQ:**
- No retry mechanism — failed nodes do not automatically retry.
- No aggregate view of all failures across all users (since data is local to each browser).
- No alerting — a developer cannot be notified when a certain error type occurs more than N times.
- No permanent log after the browser data is cleared — if the user clears their browser data, all failure history is gone.

The absence of a DLQ is a lower-severity concern in the browser architecture because the scale is different: one user, one machine, failures visible to that user directly. In a server architecture serving thousands of users, a DLQ is essential to avoid being blind to systemic failures.

---

**Document Version:** 1.0
**Created:** May 31, 2026
**Covers:** All questions from `docs/ARCHITECTURE_CRITIQUE.md` and `docs/BULLMQ_WORKER_ARCHITECTURE_CRITIQUE.md`
