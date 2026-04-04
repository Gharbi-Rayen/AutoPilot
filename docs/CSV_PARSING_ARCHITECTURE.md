# CSV Parsing Architecture & Data Flow

This document outlines the end-to-end lifecycle of parsing a CSV file, how data is serialized, and how it is passed from node to node within the workflow execution engine. This guide is specifically designed to review the system's scalability, performance characteristics, and memory management constraints.

---

## 1. File Upload Phase (\`Upload File\` Node)

To ensure the pipeline can handle massive files (e.g., gigabytes of CSV data) without running out of RAM, the `Upload File` node relies on direct-to-disk streaming operations.

### Data Flow

1. **Frontend to Backend:** The user uploads a file, which is securely transferred to the backend (via presigned URLs, base64 strings, or direct FormData pending the exact frontend implementation).
2. **Buffer Extraction:** The `UploadFileExecutor` (`src/features/executions/components/upload-file/executor.ts`) intercepts the uploaded payload payload.
3. **Disk Persistence:** Instead of passing 100MB+ binary buffers in memory directly to the next node—which would instantly cause Node.js V8 out-of-memory errors—the buffer is automatically flushed directly to a `.bin` file inside the local execution directory: `.autopilot-data/execution-datasets/{executionId}/file-UUID.bin`.
4. **Node Output:** The node outputs a lightweight file pointer (e.g., `{ type: "blob", fileBlobPath: "/path/...", ... }`) instead of the giant buffer.

---

## 2. CSV Parsing Phase (\`Csv Parse\` Node)

The core logic resides in `src/features/executions/components/csv-parse/executor.ts`. It reads the pointer provided by the previous node, completely avoiding loading the entire file into memory.

### Streaming & Parsing

- **Streaming Reader:** The executor utilizes Node's `fs/promises` or streams (via `csv-parse` module) to read the `.bin` file lazily.
- **Auto-detection:** It dynamically infers the delimiter by sampling the first 25 lines and counting token intersections.
- **Batch Yielding:** The `csv-parse` module yields records via an `AsyncIterable`.

### Schema Inference & Strong Typing

1. **Schema Probing:** The parser holds the first `100` rows (`CSV_SCHEMA_SAMPLE_ROWS`) in a probe buffer.
2. **Inference:** Once 100 rows are collected, it calls `inferDatasetSchema()` to determine whether columns contain standard `strings`, `numbers`, `booleans`, or `dates`.
3. **Coercion:** It strictly coerces all subsequent parsed rows into these strongly typed formats, ensuring that downstream nodes (like Math, Filters, or Aggregates) don't crash from unexpected `string` representations of numbers.

### Chunked Disk Storage (The "Dataset" Service)

As the iterator runs, the executor **never** aggregates millions of parsed rows into a single `[]` array.

- Processed rows enter a `pendingRows` array limit.
- Once the limit hits `CSV_WRITE_BATCH_SIZE` (default 1000), `flushPendingRows()` pushes the batch to the `DatasetService`.
- `jsonl-storage-adapter.ts` receives the batch, stringifies it, tracks disk usage limits (`reserveDiskUsage`), and appends the lines incrementally to `chunk-0.jsonl`, `chunk-1.jsonl` on disk.
- Memory usage remains flat at exactly `~1000 rows` worth of RAM regardless of whether the CSV has 1,000 or 10,000,000 rows.

---

## 3. Node-to-Node Data Transfer (The Execution Context)

How does a 4GB parsed CSV get transferred to the next step (e.g., `Csv Filter` or `LLM Prompt`)?

### The \`DatasetRef\` Paradigm

When the `Csv Parse` node finishes, it generates a **Dataset Manifest**. The output returned to Inngest is a `DatasetRef` (Dataset Reference) object:

```typescript
{
  kind: "dataset",
  datasetId: "UUID",
  executionId: "UUID",
  variableName: "csv_output",
  rowCount: 1000000,
  chunkCount: 10,
  schema: { ... }
}
```

### Inngest \`functions.ts\` Pipeline

1. The execution context maintains a mapping of all variables.
2. When the node completes, `functions.ts` runs a rigorous check: `assertNoLargeArrayOutput`. If any node developer accidentally attempts to return a 50MB raw `[]` array into the workflow context, the workflow strictly errors out.
3. The `DatasetRef` dictionary is injected into the overall workflow state container (`context`).
4. **Network Performance:** Next.js and Inngest pass a lightweight state graph (`< 5KB`) back and forth between execution steps, bypassing HTTP payload crashes (which previously caused your 3-minute stalling loop due to hitting Next.js's 4MB limit).

### Downstream Consumption

When downstream nodes execute (e.g., `Csv Filter`), they invoke `datasetService.getDatasetRowsByPage( executionId, datasetId, page, limit )`.

- The `jsonl` storage adapter dynamically seeks the correct chunk file.
- It uses Byte-Offset Anchors (`offsetAnchors`) pre-computed during the parsing phase to perform `O(1)` file stream skipping (seeking).
- Reading rows 5,000,000 to 5,000,100 is blazing fast and requires virtually zero memory parsing overhead.

---

## 4. Scalability & System Safeguards (Review Points)

### **A. CPU Concurrency (Redis Heavy Queue)**

CSV parsing is heavily CPU-bound (string splitting, schema coercion). If 10 instances ran concurrently, the Node.js event loop would stall.

- **Queue Profile:** `Csv Parse` is flagged as a `"heavy"` `ExecutionResourceProfile`.
- **Deadlock Protection:** The `redis-queue.ts` engine enforces a localized limitation `maxConcurrentHeavyExecutions = 2`. All subsequent parse requests wait in a Redis FIFO list (`executions:heavy:queue`).

### **B. Total Disk Constraints**

- Configured `MAX_TOTAL_DISK_USAGE_BYTES` (default 4GB).
- As chunks are written, `reserveDiskUsage()` locks byte allocation globally per-execution.
- Prevents rogue infinite workflows from permanently filling up the actual hosting server's drive.

### **C. Orphan & Memory Teardowns**

As updated in the recent patching system:

- Pausing a workflow immediately runs `fs.rm(..., { force: true })` sweeping the entire local execution folder.
- Server resets trigger `cleanupExecutionDatasets` inside of `inngest/cleanup-scheduled.ts` to catch any zombie chunks, effectively garbage collecting aborted instances over time.

---

### Conclusion for Production

This architecture safely scales to enterprise datasets perfectly. The transition from binary `UploadFile` -> stream chunking -> schema coercion -> localized chunk files -> lightweight `DatasetRef` context maps represents an optimal data-engineering pattern typical of systems like Apache Arrow/Airflow, compacted intelligently designed for a TypeScript runner.
