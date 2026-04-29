# AutoPilot — The Story

*A week-by-week account of the decisions that built a browser-native data automation engine capable of handling files most cloud tools can't touch — and why each decision was made the way it was.*

---

## Prologue: The Problem Worth Solving

Picture this: a data analyst receives a 2-gigabyte CSV file from a client — forty million rows of sales records. She needs to sort it by date, filter out cancelled orders, join it against a product catalog, and deliver the result. Standard tools fail immediately. Excel crashes beyond about a million rows. Google Sheets refuses to even open the file. Uploading to a cloud processing service means waiting for a slow upload, trusting a third-party server with confidential business data, and paying per-gigabyte fees.

So she opens a terminal, writes a Python script, and forty-five minutes later she has an answer — if she knows Python. Most people don't.

**AutoPilot was built to close that gap.** A visual, drag-and-drop workflow builder that handles arbitrarily large files, runs entirely in the browser, sends zero data to any server, and requires no programming knowledge.

That goal sounds simple. The decisions required to achieve it were anything but.

---

## Week 1 — The First and Most Important Decision: Where Does the Processing Happen?

### Decision: Client-Side Only, No Backend Processing

The very first fork in the road: should data processing happen on a server, or in the user's browser?

**Option A — Server-side processing** is the industry default. User uploads file → server processes it → result downloads back. Every major SaaS tool works this way: Google Sheets, Airtable, various ETL cloud platforms.

The problems with this approach for AutoPilot's goals were severe:
- **Privacy**: payroll data, client lists, financial records — none of these should transit a stranger's server. Server-side processing is a non-starter for sensitive data.
- **Cost**: bandwidth for multi-gigabyte files is expensive. A user processing a 2 GB file daily generates terabytes of transfer per month in fees.
- **Latency**: uploading 2 GB before anything can happen takes minutes even on fast connections.
- **Dependency**: if the server is down, the tool is useless.

**Option B — Client-side processing** keeps everything in the browser. The user's file never leaves their machine. Processing happens on their CPU, using their RAM and disk.

The problems: browsers are not servers. They have memory limits. They're single-threaded by default. They don't have a traditional filesystem. Every one of these constraints had to be solved deliberately — but they *could* be solved, and the privacy and cost advantages made the effort worth it.

**Decision made: client-side only.** Every subsequent design decision flows from this one.

---

## Week 2 — Choosing the Application Framework

### Decision: Next.js over Vite/CRA/SvelteKit

With client-side processing decided, the next question was which framework to build the application shell on.

**Option A — Vite + React** (the modern lightweight choice) was appealing for its speed and simplicity. No server-side rendering, no magic routing, just a React app bundled fast.

**Option B — SvelteKit** was considered for its smaller bundle size and built-in reactivity. Svelte components compile to vanilla JavaScript rather than shipping a framework runtime.

**Option C — Next.js** brings App Router, server components (for the non-processing parts like workflow saving), Turbopack, and a mature ecosystem of tooling.

Why Next.js won: the application has two distinct zones. The data-processing canvas is purely client-side — it must never run on a server because it needs browser APIs (OPFS, Web Workers, FileSystem Access). The workflow management shell (listing workflows, saving them, navigating between them) benefits from server rendering for faster initial load. Next.js's App Router makes this split clean and explicit. You mark components with `"use client"` when they need browser APIs; everything else can render on the server.

Vite would have required manually configuring this split. SvelteKit would have worked, but the node graph library that drives the canvas (XyFlow) is React-only, which would have meant embedding a React island inside a Svelte app — a maintenance burden not worth accepting.

**Decision made: Next.js with App Router.** The `"use client"` directive became the clean boundary between server-rendered shell and client-only canvas.

### Decision: TypeScript — Non-Negotiable

Some projects treat TypeScript as optional. For AutoPilot, it was considered mandatory from day one.

**Why**: the system passes data through many layers — from user input, through form validation, into node configuration objects, into worker job messages, through OPFS chunk metadata, back out as dataset references, into the next node's context. Each handoff is an opportunity for a silent bug: a variable name that's actually undefined, a chunk count that's a string when the code expects a number, a column array that's null when the code assumes it's always populated.

Without TypeScript, these bugs are discovered when a user's workflow silently produces wrong output. With TypeScript, they're caught before the code even compiles.

The choice wasn't TypeScript vs. JavaScript. It was TypeScript vs. spending weeks debugging data corruption bugs in production.

**Decision made: TypeScript everywhere, strict mode enabled.**

### Decision: Biome over ESLint + Prettier

Code quality tooling might seem like a minor decision, but in a project with 30+ files that all need consistent formatting and lint checking, the tooling choice matters for developer speed.

ESLint + Prettier is the industry standard: two separate tools, each with their own configuration files, that often conflict with each other on formatting opinions and require careful version pinning.

**Biome** is a single Rust-based tool that handles both linting and formatting, runs about 25× faster than ESLint, and has zero configuration conflicts because it's one coherent tool.

The trade-off: Biome's rule set is smaller than ESLint's extensive plugin ecosystem. For AutoPilot's needs — consistent formatting, catching unused variables and imports, enforcing code style — Biome's built-in rules were sufficient.

**Decision made: Biome.** Consistency and speed over ecosystem breadth.

---

## Week 3 — Designing the Workflow Model

### Decision: Node-Based Visual Graph over Forms or Code

The interface paradigm was decided early: a **directed acyclic graph (DAG)** of operations connected by arrows on a canvas.

**Option A — Wizard/form based**: user fills out a multi-step form specifying the transformation sequence. Simple to build, but rigid — changing step 3 of a 10-step pipeline means navigating the entire form again. No visual representation of what the pipeline looks like.

**Option B — Code-based DSL**: user writes a pipeline definition in a domain-specific language. Powerful for developers, completely inaccessible to the target audience (non-programmers).

**Option C — Node graph**: user drags operation "blocks" onto a canvas and connects them with arrows. Visually shows data flow. Easy to reconfigure by disconnecting and reconnecting edges. Scales to complex multi-branch pipelines without losing comprehensibility.

The graph model maps directly to the mathematical concept of data pipelines (DAGs) which means the execution engine can derive an execution order from the graph topology using standard algorithms — no manual sequencing needed.

**Decision made: node-based graph.** The visual metaphor of "assembly line" is intuitive for non-programmers, and the mathematical structure gives the execution engine a clean foundation.

### Decision: XyFlow over Building a Canvas from Scratch

Given the node-graph paradigm, the options were: build the canvas interaction layer from scratch, or use a library.

Building from scratch would require implementing: drag-and-drop for nodes, edge connection logic, zoom and pan, edge routing (the curves between nodes), hit-testing (knowing which element a mouse click hits), and selection/copy/paste. That's easily six to eight weeks of work, and it would still be worse than a mature library.

**XyFlow** (formerly React Flow) is a production-quality open-source React library specifically for node graphs. It handles everything listed above, is actively maintained, has TypeScript types, and is used in production by companies like Stripe, Typeform, and others.

The cost: XyFlow is React-only, which locked in the React choice. That constraint was acceptable given React's ecosystem advantages.

**Decision made: XyFlow.** Weeks of canvas work avoided; focus stays on the actual data processing logic.

---

## Week 4 — The Large File Problem

### Decision: OPFS over Every Other Browser Storage Option

This was the most technically critical decision of the entire project. Once the commitment to client-side processing was made, the next question was: **where do large datasets live while they're being processed?**

A 40-million-row CSV file cannot stay in JavaScript memory — the objects representing each row consume 8–16 GB of RAM, which exceeds most machines' available memory for a single browser tab. The data needs to live on disk and be read in manageable pieces.

The browser storage options, evaluated honestly:

**LocalStorage**: 5 MB limit. Synchronous (blocks the UI thread). String-only. Completely unsuitable.

**SessionStorage**: Same as localStorage but lost when the tab closes. Even more unsuitable.

**IndexedDB (raw)**: No practical size limit. But it's a key-value store designed for structured data objects, not sequential file I/O. Reading 1,000 chunks in order from IndexedDB means 1,000 separate async lookups. It's also significantly slower than file I/O for large binary or text blobs because every value gets serialized and deserialized through the structured clone algorithm.

**Blob URLs / in-memory Blobs**: Fast to read, but not persistent. Lost when the tab closes. Cannot store data across workflow steps without keeping everything in memory.

**File System Access API (user-visible files)**: Allows reading/writing actual files from the user's filesystem — but requires a file picker dialog for every write operation. Cannot be used programmatically without user interaction.

**Origin Private File System (OPFS)**: A newer browser API that gives each web origin (domain) its own private, sandboxed filesystem. Key properties:
- **No hard storage limit** — constrained only by the user's available disk space
- **True file I/O semantics** — read and write actual files, not database records
- **Sequential access optimized** — the browser engine treats OPFS files like native filesystem files, enabling OS-level buffering and read-ahead
- **Fully programmatic** — no user permission dialogs after initial setup
- **Persistent** — survives browser restarts, tab closes, and navigation
- **Scoped** — AutoPilot's OPFS files are completely invisible to other websites

The benchmark that made the decision clear: reading 1,000 chunks of 10,000 rows each from IndexedDB takes approximately 8–12 seconds. Reading the same data from OPFS takes under 2 seconds. For a sort operation that reads the entire dataset twice (once in Phase 1, once in Phase 2), this difference compounds into minutes.

**Decision made: OPFS as the primary data store for all datasets.** IndexedDB is used only for small metadata objects (workflow definitions, execution records, dataset manifests — kilobytes, not gigabytes).

### Decision: Fixed-Size Chunks of 10,000 Rows (Default) over Variable-Size or Whole-File

Once OPFS was chosen, the next question: how to divide datasets into chunks?

**Option A — One file per dataset**: write the entire dataset as a single large JSON file. Simple to reason about. But reading only rows 50,000–60,000 requires reading the entire file (potentially gigabytes) and seeking to the right position in the parsed array. Not viable.

**Option B — Variable-size chunks**: split based on byte size rather than row count. Consistent chunk sizes on disk. But row counts per chunk would vary, making merge-sort Phase 2 cursor arithmetic unpredictable.

**Option C — Fixed row count per chunk (10,000 rows default)**: every chunk except possibly the last contains exactly the same number of rows. This makes chunk arithmetic trivial: "rows 50,000–60,000 are in chunk number 5" — no seeking, no scanning.

The default of 10,000 was chosen empirically: it's large enough to make I/O efficient (not too many tiny files), small enough to fit comfortably in memory while being processed (even at 400 bytes/row, 10,000 rows = 4 MB). The user can tune this from 5,000 to 50,000 rows via performance presets.

**Decision made: fixed 10,000-row chunks, user-tunable.** Predictable arithmetic enables the merge-sort algorithm to work correctly.

---

## Week 5 — Solving the Sorting Problem

### Decision: Two-Phase External Merge Sort over In-Memory Sort

The sort node was the hardest algorithmic problem in the project.

**Option A — Load everything into memory, call `Array.sort()`**: this is what every naive implementation does. It works for small files. For a 40-million-row file, the JavaScript objects representing each row consume approximately 8–16 GB of RAM — more than most machines have available for a single browser tab. The tab crashes.

**Option B — Stream through the file and hope for partial sorting**: not a real sort algorithm. Produces wrong results.

**Option C — Two-phase external merge sort**: a classical algorithm designed specifically for datasets larger than available memory. Requires only a fraction of the data to be in memory at any point.

The decision for Option C was not hard once Option A was ruled out — external merge sort is the standard solution for this exact problem, used by database engines and operating system sort utilities for decades.

The algorithm, in plain terms:

**Phase 1 — Create sorted runs**: Read 64 chunks at once (640,000 rows), sort them in memory using JavaScript's native sort, write them back to OPFS as a "sorted run". Repeat until all input chunks have been converted into sorted runs. The result: ~16 sorted runs (for 1,000 input chunks), each internally ordered.

**Phase 2 — Merge the runs**: Use a binary min-heap (a data structure that always keeps the smallest element at the top) to merge all 16 runs simultaneously. Pull the smallest row from the top of the heap, write it to the output, advance the run that produced that row, push its next row into the heap. Repeat until the heap is empty.

Why a min-heap for Phase 2 instead of a naive "scan all run tops and pick the minimum"?

Scanning all run tops to find the minimum is O(K) per row (where K = number of runs). With 40 million output rows and 16 runs, that's 40M × 16 = 640 million comparisons. A heap reduces this to O(log K) per row — 40M × log(16) = 40M × 4 = 160 million comparisons. Four times fewer operations, measurably faster.

Peak memory during the entire sort: under 200,000 rows at any moment, for a 40-million-row input file. This is the key advantage of external merge sort.

**Decision made: two-phase external merge sort with a min-heap for Phase 2.** The memory profile is bounded regardless of input size.

### Decision: The forceFlush() Fix

During development, the sort produced correct results for small files and silently wrong results for large files. The bug took significant debugging to find.

The `ChunkedOPFSWriter` maintains an internal buffer. It flushes complete chunks (of exactly 10,000 rows) and holds partial chunks in the buffer. In Phase 1, when Run N had a non-round number of rows (say 637,000 — not a multiple of 10,000), the last partial chunk (7,000 rows) stayed in the writer's buffer and was prepended to Run N+1's data on the next write call.

This meant chunks on disk contained rows from two different sorted runs, mixed together. The chunk index metadata (`runChunkStart`, `runChunkCount`) was calculated assuming clean boundaries and was now wrong. Phase 2 merged from corrupted indices, producing unsorted output.

The fix: add a `forceFlush()` method that flushes whatever remains in the buffer unconditionally, and call it between runs in Phase 1.

**Decision: explicit forceFlush() call at run boundaries** rather than assuming the writer's auto-flush handles edge cases. Making the flush explicit at the call site makes the contract clear: "after this call, the writer's buffer is empty."

---

## Week 6 — Web Workers: Keeping the Browser Responsive

### Decision: One Worker Per Operation Type over a Thread Pool

JavaScript is single-threaded. If the CSV sort runs on the main thread, the UI freezes completely for however long the sort takes. For 40 million rows, that's minutes of a completely unresponsive page.

**Web Workers** run JavaScript in background threads. They cannot touch the DOM (the page's visual elements), but they can access OPFS, do computation, and send messages back to the main thread.

The design question: how to structure the workers?

**Option A — One generic worker that handles all operation types**: receives a message saying "do a sort" or "do a filter", routes internally to the right code. Simpler deployment (one file). But workers share global state — if the sort operation has a bug that corrupts a global variable, the filter operation in the same worker is now affected.

**Option B — A fixed-size thread pool** (e.g., 4 workers, any job goes to an available worker): balances load across available CPU cores. But requires scheduling logic, and a crashing worker takes other job types with it.

**Option C — One dedicated worker per operation type**: `csv-sort.worker.ts`, `csv-filter.worker.ts`, etc. Each is completely isolated. A crash in the sort worker doesn't affect the filter worker. Each worker's code only contains what it needs.

The isolation benefit was decisive. In a complex system where each worker type does something fundamentally different (k-way merge sort vs. hash-join vs. regex-based filtering), keeping them separate keeps each file comprehensible and independently testable.

**Decision made: one dedicated worker per operation type.** 12 workers, each under 300 lines of focused code.

### Decision: Job-Level Message Protocol over RPC or Shared Memory

Workers communicate with the main thread via `postMessage`. The design of those messages matters.

**Option A — Simple request/response**: main thread sends a message, worker sends back one response when done. Problem: no progress updates. The user sees the UI frozen with no indication that work is happening.

**Option B — SharedArrayBuffer + Atomics** (shared memory): the fastest possible communication, but requires Cross-Origin Isolation headers on the server, which complicates deployment significantly.

**Option C — Structured message protocol with job IDs**: each job gets a unique ID. The worker can send multiple messages for one job: progress updates (`kind: "progress"`) with percentage and status text, then a final result (`kind: "result"`) or error (`kind: "error"`). The main thread routes each message to the correct job's callbacks by matching the job ID.

This design gives users real-time progress ("Sorting chunk 450 / 1000 — 45%") without shared memory complexity. The job ID system means multiple operations can run concurrently (sort + filter simultaneously, each with their own progress stream) without messages getting crossed.

**Decision made: structured job-ID-based message protocol.** Real-time progress at the cost of some message serialization overhead — a trade-off clearly worth making for user experience.

---

## Week 7 — The Execution Engine

### Decision: Depth-First Topological Sort over Breadth-First

The execution engine must convert a node graph into an ordered list where every node appears before the nodes that depend on it. This is topological sorting.

Two common approaches:

**Kahn's algorithm (BFS-based)**: start with all nodes that have no dependencies, process them, remove their edges, find the new "no dependency" nodes, repeat. Produces a level-order traversal — all depth-1 nodes, then all depth-2 nodes, etc.

**DFS post-order**: traverse depth-first, adding each node to the output list *after* all its descendants have been visited.

For a workflow with two parallel pipelines (`Upload A → Parse A → Filter A → Export A` and `Upload B → Parse B → Filter B → Export B`):

Kahn's/BFS order: `Upload A, Upload B, Parse A, Parse B, Filter A, Filter B, Export A, Export B`

DFS order: `Upload A, Parse A, Filter A, Export A, Upload B, Parse B, Filter B, Export B`

The DFS order processes one complete pipeline before starting the next. This is better for memory: the first pipeline's OPFS datasets can be deleted before the second pipeline even starts. With BFS ordering, both pipelines' intermediate datasets exist in OPFS simultaneously, doubling the disk usage peak.

**Decision made: DFS post-order topological sort.** Better memory locality for multi-pipeline workflows.

### Decision: Lazy Executor Loading over Importing Everything at Startup

The executor registry stores each node type's executor function as a lazy import:

```typescript
[NodeType.CSV_SORT]: () =>
  import("./csv-sort/executor").then(m => m.executor),
```

The alternative would be importing all executors at the top of `execution-engine.ts`. Simple, but it means the initial JavaScript bundle includes code for every node type — PDF signing, consecutive sequence analysis, CSV joining — whether or not the user's workflow uses any of those.

With lazy loading, the browser only downloads an executor's code when that node type appears in a workflow being executed. A user who only ever uses parse + filter + export never downloads the sort, join, or PDF executor code.

**Decision made: lazy executor loading via dynamic imports.** Faster initial page load; users pay only for the features they actually use.

---

## Week 8 — The Variable System

### Decision: Compute Metadata On-The-Fly from the Graph over Storing it in a Database

Every node dialog needs to know what columns are available from upstream — so the user can pick "sort by this column" without typing column names blind.

**Option A — Run the upstream nodes to produce actual output, then read the schema**: accurate, but requires executing the pipeline every time the user opens a dialog. For a multi-minute workflow, this is completely unusable.

**Option B — Store column metadata in the database every time a workflow is saved**: always available without computation. But it can get out of sync — the user changes an upstream node's configuration without saving, opens a downstream dialog, and sees stale column information.

**Option C — Derive column metadata on-the-fly by analyzing the node graph**: read each node's stored configuration, apply transformation rules specific to each node type (CSV_FILTER preserves all columns, CSV_AGGREGATE changes them, CSV_RESTRUCTURE defines them from scratch), and build a complete metadata map. Fast (pure in-memory computation), always reflects the current unsaved state, no staleness possible.

The analysis function (`buildVariableMetadataCatalog`) runs in milliseconds because it only reads small configuration objects — not actual data. It's called on every render, wrapped in `useMemo` so it only recomputes when the node graph changes.

**Decision made: on-the-fly metadata derivation.** Zero staleness, zero database calls, always reflects the current UI state.

### Decision: `{{colName}}` Template Syntax for Column References in Expressions

The CSV Restructure node lets users write expressions for computed columns like `{{price}} * {{qty}} * 1.1`. The choice of syntax was deliberate.

**Option A — Direct column names as identifiers** (`price * qty * 1.1`): looks clean. Falls apart immediately for column names with spaces (`First Name * multiplier` is syntactically ambiguous) or special characters. Also ambiguous with built-in math identifiers.

**Option B — `row["colName"]`** (JavaScript object access): unambiguous, handles any column name. But ugly, verbose, and requires users to know JavaScript object syntax. "Not for programmers" was a core goal.

**Option C — `{{colName}}` template syntax**: consistent with how AutoPilot already references workflow variables in other contexts. Works for any column name regardless of spaces or special characters. Looks clean. Clear and explicit — `{{col}}` visually signals "this is a reference, not a literal."

In the worker, `{{colName}}` tokens are extracted using a regex, mapped to positional parameters (`_c0`, `_c1`...), and evaluated inside a sandboxed `new Function(...)` with only a restricted `Math` object exposed — no access to the global scope, no network calls, no filesystem access from within an expression.

**Decision made: `{{colName}}` syntax.** Consistent with existing conventions, handles all column name formats, visually distinct from literals.

---

## Week 9 — The Database Layer

### Decision: Dexie over Raw IndexedDB

IndexedDB is the browser's built-in database. It's powerful, has decent storage capacity, and persists reliably. But its API is one of the most painful to use in the entire browser platform — everything is callback-based, transactions are fragile, and even simple lookups require four or five nested callbacks.

**Dexie** wraps IndexedDB in a clean promise-based API that makes it feel like a modern async database. `await db.workflows.get(id)` instead of `request.onsuccess = function(event) { store.get(id).onsuccess = function(event2) { ... } }`.

The alternatives:
- **PouchDB**: adds CouchDB sync capabilities not needed here. Heavier.
- **RxDB**: adds reactive query subscriptions. More than needed.
- **localForage**: simple key-value only, no queries or indexes.
- **Raw IndexedDB**: correct but developer-hostile.

Dexie gives full IndexedDB power (indexes, transactions, compound queries) with a clean API. It was the straightforward choice.

**Decision made: Dexie.** Developer experience without sacrificing capability.

### Decision: IndexedDB for Metadata, OPFS for Data — Not Both in the Same Store

An alternative design would put everything in IndexedDB — metadata and chunk data both stored as IndexedDB records. Or put everything in OPFS — even workflow configuration and execution history stored as JSON files in OPFS directories.

The two-store approach was chosen because each storage type is optimal for its use case:

IndexedDB's strengths: **keyed lookups**, **indexes**, **transactions**. Perfect for "get all executions for workflow X" or "find the dataset with this ID". Metadata queries are exactly what IndexedDB is designed for.

OPFS's strengths: **sequential I/O**, **large files**, **file-like semantics**. Perfect for writing and reading 4,000 chunk files sequentially during a sort operation. These are not queries — they're sequential reads by index.

Mixing them would mean either using OPFS for metadata (no indexes, awkward queries) or IndexedDB for chunk data (slow sequential I/O, poor performance for large datasets). Keeping them separate keeps each store used for what it does best.

**Decision made: IndexedDB for small structured metadata, OPFS for large dataset chunks.** Each storage mechanism used for what it's designed for.

---

## Week 10 — Performance Tuning

### Decision: User-Exposed Presets over Fixed Hardcoded Values

The chunk size (rows per OPFS chunk) and the maximum rows for in-memory operations (joins, deduplication) directly affect both performance and memory usage. What's optimal for a MacBook Pro with 32 GB of RAM is wrong for a 4 GB Chromebook.

**Option A — Hardcode the values**: simple, no configuration UI needed. But the values that work safely on low-end machines are frustratingly slow on high-end machines. Values optimized for performance would crash low-end machines.

**Option B — Auto-detect based on `navigator.deviceMemory`**: the browser exposes a rough estimate of device RAM (2, 4, 8, or 16+ GB). Could auto-tune. But `deviceMemory` is intentionally imprecise (privacy reasons), and RAM is not the only constraint (available swap space, competing processes, browser memory management all matter). Auto-detection would frequently be wrong.

**Option C — User-exposed presets with clear labels**: three options — Balanced (4 GB machines), Performance (8 GB), Maximum (16+ GB). The user picks based on their own knowledge of their hardware. They can try Performance, see if it causes problems, and drop to Balanced.

This puts trust in the user's judgment about their own machine, which is more reliable than guessing. The UI for selecting presets is a single setting — not a complex configuration form.

**Decision made: three named presets, user-selected.** Hardware-awareness without unreliable auto-detection.

### Decision: Inject Performance Settings Into Every Worker Job

Workers run in separate threads and cannot access the main thread's localStorage (the storage where performance settings are saved). Two options:

**Option A — Have each worker read its own copy of the settings** using a Worker-compatible storage API: OPFS could work, but reading settings from OPFS inside every worker on every job startup adds latency and complexity.

**Option B — Read settings once in the main thread, inject them into every worker job payload**: the `WorkerManager` reads `getPerformanceSettings()` from localStorage before dispatching any job, merges the settings into the job's input payload, and the worker reads them from its received message.

Option B means settings are always available to workers with zero additional I/O, and the settings reflect the value at the moment the job was dispatched — consistent for the lifetime of a single job.

**Decision made: main thread reads and injects settings into job payloads.** Zero worker-side storage access; settings available immediately.

---

## Week 11 — PDF Processing

### Decision: PDF.js for Extraction, pdf-lib for Generation — Not a Single Unified Library

PDF processing has two completely different requirements: reading/extracting content from existing PDFs, and creating/modifying PDFs programmatically.

**PDF.js** (by Mozilla) is the industry-standard browser-based PDF renderer. It powers Firefox's built-in PDF viewer and has been battle-tested for over a decade on millions of PDFs across every conceivable document format variant. For extraction tasks (reading text, rendering pages, identifying text positions), PDF.js is unmatched.

**pdf-lib** is a pure JavaScript library for creating and modifying PDFs programmatically — adding pages, filling form fields, merging documents, adding signatures. It's not a renderer; it works at the PDF specification level.

The alternative would be finding a single library that does everything. No such library exists with comparable quality for both use cases. Using PDF.js for everything would mean fighting its rendering-focused API for programmatic creation tasks. Using pdf-lib for everything would mean building a text-extraction renderer from scratch.

**Decision made: PDF.js for read operations, pdf-lib for write operations.** Best tool for each specific task rather than a compromise solution for both.

---

## Week 12 — The Smart Variable Name System

### Decision: BFS Graph Traversal for Name Derivation over Manual Input Only

Every output node needs a variable name — the identifier downstream nodes use to reference the data. In a 12-node workflow, that's 12 names to manually type.

The insight: the best name for a sort node's output is usually derivable from context. If the input data came from `customers.csv` and the operation is a sort, the output should be called `customers_sorted`. The information needed for this suggestion already exists in the graph: the upstream filename and the current node's type.

**Option A — Leave it fully manual**: users type whatever they want. Results in `output1`, `output2`, `output3` — meaningless names that obscure the pipeline logic.

**Option B — Fixed naming based on node position**: `node_1_output`, `node_2_output`. Unambiguous but still meaningless.

**Option C — Derive names by tracing the graph backwards**: from the current node, walk backwards through edges (BFS traversal) to find the nearest `UPLOAD_FILE` ancestor. Read its stored filename. Strip the extension, sanitize to a valid identifier, append the node-type suffix. Check for collisions with existing variable names. Auto-increment if taken.

For a join node with two source pipelines, find both `UPLOAD_FILE` ancestors and combine their names: `customers_orders_joined`.

The BFS traversal is fast — it reads only node configuration objects, not actual data — and runs on every render without noticeable cost.

**Decision made: BFS-based name derivation with user override.** The `auto` badge makes it clear when the field is auto-managed vs. user-controlled; typing anything immediately switches to manual control.

---

## Epilogue: The Decisions That Defined the System

Looking back across the weeks, the decisions that had the most impact were:

**Client-side only** — this single decision shaped every subsequent architectural choice. It ruled out server-side databases, required OPFS, demanded Web Workers, and made TypeScript non-negotiable.

**OPFS over IndexedDB for chunk storage** — without this, the entire large-file story falls apart. IndexedDB's sequential I/O performance would have made sorting and joining multi-gigabyte files too slow to be practical.

**Two-phase external merge sort** — there was no shortcut here. "Just load more memory" is not an answer when the target is files of any size. The algorithm's bounded memory profile (under 200,000 rows in memory regardless of input size) is the reason the sort node works.

**One worker per operation type** — isolation was worth the cost of 12 separate files. When the sort worker has a bug, the filter worker doesn't crash. When the deduplication worker is updated, the join worker doesn't need to be tested.

**On-the-fly metadata derivation** — the alternative (storing metadata in a database and keeping it in sync) introduces an entire class of consistency bugs. Pure computation from current state is always correct.

Every other decision built on these five.

---

## The Stack, and Why Each Choice Beat Its Alternatives

| What | Chosen | Over | Because |
|------|--------|------|---------|
| Processing location | Browser (client-only) | Server | Privacy, zero cost, zero latency for upload |
| App framework | Next.js | Vite, SvelteKit | App Router `"use client"` split; XyFlow requires React |
| Type system | TypeScript strict | Plain JavaScript | Multi-layer data passing — silent bugs are unacceptable |
| Code quality | Biome | ESLint + Prettier | Single tool, 25× faster, zero config conflicts |
| Canvas | XyFlow | Custom canvas | Weeks of work avoided; production-quality node/edge interactions |
| Large file storage | OPFS | IndexedDB, localStorage | Only option with true file-level sequential I/O and no size limit |
| Sort algorithm | Two-phase external merge sort | In-memory `Array.sort()` | Bounded memory profile — works for any file size |
| Threading | One worker per operation type | Single generic worker | Isolation; a crashing sort worker doesn't kill the filter worker |
| Execution order | DFS topological sort | BFS (Kahn's algorithm) | Better memory locality — one pipeline finishes before the next starts |
| Executor loading | Lazy dynamic imports | Static imports | Users only download code for the node types they actually use |
| Metadata storage | Dexie (IndexedDB) | Raw IndexedDB | Clean async API without sacrificing query capability |
| Chunk data storage | OPFS | IndexedDB for chunks | Sequential read speed; IndexedDB is 4–6× slower for large sequential access |
| Performance tuning | Three named user presets | Hardcoded values or auto-detect | Users know their own hardware; `deviceMemory` API is intentionally imprecise |
| PDF reading | PDF.js | pdf-lib, custom | Mozilla's decade-tested renderer handles every real-world PDF edge case |
| PDF writing | pdf-lib | PDF.js | pdf-lib is designed for programmatic creation; PDF.js is a renderer only |
| Column expression syntax | `{{colName}}` | Direct identifiers, `row["name"]` | Handles spaces/special chars; consistent with existing template convention |
| Variable name suggestions | BFS graph traversal | Manual input only | Derives meaningful names from available context; zero user effort |

---

## The Numbers

- **29 node types** — CSV, PDF, structural
- **12 Web Workers** — one per operation type
- **0 servers** — involved in any data processing
- **~200,000 rows peak memory** — while sorting a 40-million-row file
- **10,000 rows per chunk** — the default OPFS storage granularity (user-tunable from 5,000 to 50,000)
- **6 database tables** — workflows, nodes, connections, executions, outputs, datasets
- **2 storage systems** — OPFS for data, IndexedDB for metadata

---

*AutoPilot's story is ultimately a story about constraints. Browser constraints forced every interesting decision: the memory limit led to chunking, chunking led to OPFS, OPFS's sequential access led to external merge sort, single-threaded JavaScript led to Web Workers. None of these were arbitrary choices — each was the direct answer to a specific constraint. Understanding the constraint makes the decision obvious. The craft is in knowing which constraint to address first.*
