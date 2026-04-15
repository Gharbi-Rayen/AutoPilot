# Worker Builder Guide

> How to create a new compute node backed by a BullMQ worker.  
> Follow every section in order. Miss one step and the node will silently time out.

---

## Architecture overview

When a node runs, control passes through five distinct layers in sequence:

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  1. NODE DIALOG (React UI)                                       │
 │     User fills form → saved to Node.data (JSON) in the DB       │
 └────────────────────────────┬────────────────────────────────────┘
                              │ node.data flows through Inngest
 ┌────────────────────────────▼────────────────────────────────────┐
 │  2. EXECUTOR  (runs inside Inngest step, inside Vercel fn)       │
 │     • Reads and validates node.data                              │
 │     • Resolves source variable from workflow context             │
 │     • Registers step.waitForEvent BEFORE enqueuing               │
 │     • step.run("enqueue") → queue.add(jobData, { timeout })      │
 │     • Awaits completion event                                    │
 │     • Returns { [variableName]: result } to update context       │
 └────────────────────────────┬────────────────────────────────────┘
                              │ BullMQ job (Redis)
 ┌────────────────────────────▼────────────────────────────────────┐
 │  3. WORKER  (separate long-running process, NOT Vercel)          │
 │     • Processes job — can run for hours                          │
 │     • Reads source rows via streamContextRows()                  │
 │     • Writes output via datasetService.persistRowsFromStream()   │
 │     • Sends inngest.send("csv/{op}.complete", { result })        │
 └────────────────────────────┬────────────────────────────────────┘
                              │ Inngest event
 ┌────────────────────────────▼────────────────────────────────────┐
 │  4. INNGEST RELAY (optional — only for progress events)          │
 │     • Listens for "csv/{op}.progress"                            │
 │     • Publishes to FileChannel so the UI gets live updates       │
 └─────────────────────────────────────────────────────────────────┘
 ┌─────────────────────────────────────────────────────────────────┐
 │  5. CONTEXT OUTPUT                                               │
 │     • Executor return value is merged into the workflow context  │
 │     • Next nodes can reference the variableName in their dialogs │
 └─────────────────────────────────────────────────────────────────┘
```

**Why workers run separately from Vercel:**  
Vercel serverless functions have a hard 60-second execution limit. A sort on 400 MB takes 5–30 minutes. The executor enqueues a BullMQ job (< 100 ms), returns from the Vercel function, and Inngest parks the workflow. The worker (running on Railway/VPS) does the actual compute and sends a completion event when done.

---

## File structure for a new worker

```
src/
├── workers/
│   └── csv-{op}.worker.ts          ← BullMQ processor (long-running process)
│
├── features/executions/components/
│   └── csv-{op}/
│       ├── executor.ts             ← Inngest step handler (enqueue + wait)
│       └── actions.ts              ← Server actions (usually empty for workers)
│
└── lib/
    └── worker-queue.ts             ← ADD your queue singleton here

prisma/
└── schema.prisma                   ← ADD NodeType enum value here
```

You also touch:
- `src/features/executions/components/lib/executor-registry.ts` — register executor
- `src/inngest/functions.ts` — register relay function (if you add progress events)
- `src/app/api/inngest/route.ts` — include relay function in the serve() call
- `ecosystem.config.js` — add worker process for PM2 (production)
- `mprocs.yaml` — add worker for local dev
- `package.json` — add `worker:{op}` script

---

## Step 1 — Add the NodeType to Prisma

**File:** `prisma/schema.prisma`

Add your new type to the `NodeType` enum:

```prisma
enum NodeType {
  // ... existing types ...
  CSV_MY_OPERATION          // ← add here
}
```

Then run:
```bash
npx prisma migrate dev --name add_csv_my_operation_node
npx prisma generate
```

The generated `NodeType` enum at `src/generated/prisma` will include your new value automatically.

---

## Step 2 — Define the node data type

**File:** `src/features/executions/components/csv-{op}/executor.ts` (top of file)

`node.data` is whatever JSON the user saved from the dialog form. Define a TypeScript type that exactly matches the dialog's form fields.

```typescript
// Every field is optional because node.data may be partially filled.
// The executor validates and throws NonRetriableError for missing required fields.
type CsvMyOperationData = {
  sourceVariable?: string;   // which context variable holds the input dataset
  variableName?: string;     // what to name the output variable
  myField?: string;          // any other dialog fields
  myNumber?: number | string; // numbers come as strings from form inputs
};
```

**Rules:**
- All fields `optional` — the executor guards against missing values
- Numbers from form inputs arrive as `string` — parse them explicitly
- Boolean fields from checkboxes arrive as `boolean`

---

## Step 3 — Write the executor

**File:** `src/features/executions/components/csv-{op}/executor.ts`

The executor runs inside Inngest, inside a Vercel function. It must complete within Vercel's timeout (< 60 seconds). It only enqueues a job and waits — it does no real compute.

```typescript
import { NonRetriableError } from "inngest";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvMyOperationData = {
  sourceVariable?: string;
  variableName?: string;
  myField?: string;
};

// Must match what the worker's "completed" event puts in data.result
type CsvMyOperationWorkerResult = {
  datasetRef: {
    kind: "dataset";
    datasetId: string;
    executionId: string;
    variableName: string;
    storage: string;
    manifestVersion: number;
    rowCount: number;
    chunkCount: number;
    byteSize: number;
    schema?: Record<string, unknown>;
  };
  summary: {
    sourceRows: number;
    // ...add operation-specific summary fields
  };
};

export const CsvMyOperationExecutor: NodeExecutor<CsvMyOperationData> = async ({
  data,
  nodeId,
  executionId,
  context,
  publish,
  step,
}) =>
  // withCsvNodeStatus publishes loading → success/error to the UI automatically
  withCsvNodeStatus(nodeId, publish, async () => {
    // ── 1. Guard: executionId ──────────────────────────────────────────────
    if (!executionId) {
      throw new NonRetriableError(
        "Execution context is missing executionId for csv-my-operation",
      );
    }

    // ── 2. Validate required fields from node.data ─────────────────────────
    const variableName = data.variableName?.trim();
    const sourceVariable = data.sourceVariable?.trim();
    const myField = data.myField?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }
    if (!sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }
    if (!myField) {
      throw new NonRetriableError("My field is required");
    }

    // ── 3. Resolve source from workflow context ────────────────────────────
    const source = resolveContextValue(context, sourceVariable);
    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${sourceVariable}' not found in context. Available: ${availableKeys || "(none)"}`,
      );
    }

    // ── 4. Count rows (for validation and worker payload) ──────────────────
    const inlineRows = extractInlineRows(source);
    const sourceRows = isDatasetRef(source)
      ? source.rowCount
      : inlineRows.length;

    if (sourceRows === 0) {
      throw new NonRetriableError(
        "Source variable must contain CSV records (array, DatasetRef, or records payload)",
      );
    }

    // ── 5. Register waitForEvent BEFORE enqueuing ──────────────────────────
    // CRITICAL: the Promise must be created before queue.add() to avoid
    // a race where the worker finishes before Inngest registers the listener.
    const completionPromise = step.waitForEvent(
      "wait-for-csv-my-operation-complete",
      {
        event: "csv/my-operation.complete",
        match: "data.executionId",
        timeout: "60m", // set to match job timeout + 5 min buffer
      },
    );

    const { randomUUID } = await import("node:crypto");
    const datasetId = randomUUID();

    // ── 6. Enqueue the BullMQ job ──────────────────────────────────────────
    await step.run("enqueue-csv-my-operation", async () => {
      const { getCsvMyOperationQueue } = await import("@/lib/worker-queue");
      const queue = getCsvMyOperationQueue();
      await queue.add(
        "my-operation",
        {
          executionId,
          datasetId,
          nodeId,
          variableName,
          sourceRef: source, // pass by value — entire DatasetRef or inline rows
          myField,
          sourceRows,
        },
        {
          jobId: `${executionId}-${datasetId}`,
          timeout: 55 * 60 * 1000, // 55 min — 5 min less than waitForEvent timeout
          removeOnComplete: 50,
          removeOnFail: 20,
        },
      );
    });

    // ── 7. Await completion ────────────────────────────────────────────────
    const completion = await completionPromise;

    // Check for failure payload
    const failureMessage =
      completion?.data?.error ?? completion?.data?.reason;
    if (typeof failureMessage === "string" && failureMessage.length > 0) {
      throw new NonRetriableError(
        `CSV my-operation failed: ${failureMessage}`,
      );
    }

    if (!completion || !completion.data?.result) {
      throw new NonRetriableError(
        "Wait for csv-my-operation timed out after 60 minutes",
      );
    }

    // ── 8. Return result to update workflow context ────────────────────────
    const output = completion.data.result as CsvMyOperationWorkerResult;

    if (!output.datasetRef?.datasetId) {
      throw new NonRetriableError(
        "csv-my-operation worker returned an invalid dataset reference",
      );
    }

    return {
      [variableName]: {
        ...output.datasetRef,
        summary: output.summary,
      },
    };
  });
```

### Inngest timeout values

| Inngest `waitForEvent` timeout | BullMQ job `timeout` |
|---|---|
| `"30m"` | `25 * 60 * 1000` |
| `"60m"` | `55 * 60 * 1000` |
| `"120m"` | `115 * 60 * 1000` |

Always set the job timeout **5 minutes less** than the Inngest wait. This guarantees the worker has time to signal failure before Inngest gives up and times out silently.

---

## Step 4 — Write the worker

**File:** `src/workers/csv-{op}.worker.ts`

The worker runs as a separate Node.js process. It has no timeout — it can run for hours.

```typescript
import { type Job, UnrecoverableError, Worker } from "bullmq";
import Redis from "ioredis";
import { DATASET_STORAGE } from "@/config/constants";
import { streamContextRows } from "@/features/executions/components/csv-shared/executor-utils";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import type { DatasetSchema } from "@/features/executions/server/datasets/schema-types";
import { inngest } from "@/inngest/client";

// ── Constants ──────────────────────────────────────────────────────────────
const HEAVY_CONCURRENCY = 2;          // how many jobs run in parallel
const QUEUE_NAME = "csv-my-operation";
const WORKER_VERSION = "csv-my-operation@2026-04-13-v1";

// ── Job payload — must match what the executor puts in queue.add() ─────────
export interface CsvMyOperationJobData {
  executionId: string;
  datasetId: string;
  nodeId: string;
  variableName: string;
  sourceRef: unknown;       // DatasetRef or inline rows
  myField: string;
  sourceRows: number;
  sourceSchema?: DatasetSchema;
}

// ── Job result — must match what the executor expects in completion.data.result
export interface CsvMyOperationJobResult {
  datasetRef: {
    kind: "dataset";
    datasetId: string;
    executionId: string;
    variableName: string;
    storage: string;
    manifestVersion: number;
    rowCount: number;
    chunkCount: number;
    byteSize: number;
    schema?: DatasetSchema;
  };
  summary: {
    sourceRows: number;
    outputRows: number;
    // add any operation-specific fields
  };
}

// ── Redis connection — one per worker process, persistent ──────────────────
const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);

workerConnection.on("connect", () => {
  console.log(`[csv-my-operation] Redis connected`);
});

workerConnection.on("error", (err) => {
  console.error(`[csv-my-operation] Redis error:`, err.message);
});

// ── Core processing function ───────────────────────────────────────────────
const processJob = async (
  job: Job<CsvMyOperationJobData, CsvMyOperationJobResult>,
): Promise<CsvMyOperationJobResult> => {
  const {
    executionId,
    datasetId,
    variableName,
    sourceRef,
    myField,
    sourceRows,
    sourceSchema,
  } = job.data;

  console.log(`[csv-my-operation] job ${job.id} started`, {
    executionId,
    sourceRows,
    myField,
  });

  // ── Validate ─────────────────────────────────────────────────────────────
  // Use UnrecoverableError for validation failures — BullMQ will not retry these.
  if (!myField || myField.trim().length === 0) {
    throw new UnrecoverableError("myField is required");
  }

  // ── Process rows ──────────────────────────────────────────────────────────
  // streamContextRows handles both DatasetRef (reads from disk) and inline rows.
  let outputRows = 0;

  const processedRows = (async function* () {
    for await (const row of streamContextRows(sourceRef)) {
      // ── YOUR TRANSFORMATION LOGIC HERE ──
      const transformedRow = {
        ...row,
        my_computed_field: String(row[myField] ?? "").toUpperCase(),
      };

      outputRows++;

      // Update progress every 500k rows (prevents Redis lock expiry on huge datasets)
      if (outputRows % 500_000 === 0) {
        await job.updateProgress({
          rowsProcessed: outputRows,
          sourceRows,
        });
      }

      yield transformedRow;
    }
  })();

  // ── Persist output to disk ────────────────────────────────────────────────
  const manifest = await datasetService.persistRowsFromStream({
    executionId,
    datasetId,
    variableName,
    rows: processedRows,
    chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
    schema: sourceSchema,
  });

  console.log(`[csv-my-operation] job ${job.id} done — ${manifest.rowCount} rows`);

  return {
    datasetRef: {
      kind: "dataset",
      datasetId: manifest.datasetId,
      executionId: manifest.executionId,
      variableName: manifest.variableName,
      storage: manifest.storage,
      manifestVersion: manifest.version,
      rowCount: manifest.rowCount,
      chunkCount: manifest.chunkCount,
      byteSize: manifest.byteSize,
      schema: manifest.schema,
    },
    summary: {
      sourceRows,
      outputRows: manifest.rowCount,
    },
  };
};

// ── Worker instance ────────────────────────────────────────────────────────
const worker = new Worker<CsvMyOperationJobData, CsvMyOperationJobResult>(
  QUEUE_NAME,
  processJob,
  {
    connection: workerConnection,
    concurrency: HEAVY_CONCURRENCY,
    stalledInterval: 30_000,    // check for stalled jobs every 30s
    maxStalledCount: 1,         // re-queue once, then fail permanently
    lockDuration: 60_000,       // job lock lasts 60s (renewed while active)
    settings: {
      backoffStrategy: (attemptsMade) =>
        Math.min(1000 * 2 ** attemptsMade, 30_000),
    },
  },
);

// ── Completed handler — MUST send "csv/{op}.complete" ─────────────────────
worker.on("completed", async (job, result) => {
  console.log(
    `[csv-my-operation] COMPLETED job ${job.id} — ${result.datasetRef.rowCount} rows`,
  );
  try {
    await inngest.send({
      name: "csv/my-operation.complete",
      data: {
        executionId: job.data.executionId,
        datasetId: result.datasetRef.datasetId,
        nodeId: job.data.nodeId,
        variableName: job.data.variableName,
        result, // executor reads this as completion.data.result
      },
    });
  } catch (err) {
    console.error(`[csv-my-operation] Failed to signal Inngest:`, err);
  }
});

// ── Failed handler — MUST send "csv/{op}.complete" with failed:true ───────
// Sending only a ".failed" event means the executor's waitForEvent never
// resolves and the workflow hangs for the full timeout before erroring.
worker.on("failed", async (job, err) => {
  const isUnrecoverable = err instanceof UnrecoverableError;
  const isFinalAttempt =
    isUnrecoverable ||
    (job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 3));

  console.error(
    `[csv-my-operation] FAILED job ${job?.id} (attempt ${job?.attemptsMade}):`,
    err?.message,
  );

  if (isFinalAttempt && job) {
    const reason = err?.message ?? "csv-my-operation worker failed";

    // This is the event the executor's waitForEvent is listening for.
    // Without it, the executor hangs until the 60-minute timeout.
    try {
      await inngest.send({
        name: "csv/my-operation.complete",
        data: {
          executionId: job.data.executionId,
          error: reason,
          failed: true,
        },
      });
    } catch (signalErr) {
      console.error(`[csv-my-operation] Failed to signal failure:`, signalErr);
    }
  }
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
// Waits for in-flight jobs to finish before exiting.
// PM2 and Railway send SIGTERM before force-killing with SIGKILL.
const shutdown = async (signal: string) => {
  console.log(`[csv-my-operation] ${signal} — draining worker...`);
  await worker.close(); // waits for active jobs to complete
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Startup log ───────────────────────────────────────────────────────────
console.log(
  `[csv-my-operation] boot`,
  JSON.stringify({
    version: WORKER_VERSION,
    queue: QUEUE_NAME,
    concurrency: HEAVY_CONCURRENCY,
  }),
);
```

---

## Step 5 — Add the queue singleton

**File:** `src/lib/worker-queue.ts`

Add two lines — one connection, one exported getter:

```typescript
// At the bottom, alongside the other queue definitions:
let _myOperationQueue: Queue | undefined;
export const getCsvMyOperationQueue = (): Queue =>
  (_myOperationQueue ??= makeQueue("csv-my-operation"));
```

This ensures executors reuse a single Redis connection per queue across Inngest step invocations. Never create `new Queue()` or `new Redis()` inside `step.run()`.

---

## Step 6 — Register the executor

**File:** `src/features/executions/components/lib/executor-registry.ts`

```typescript
import { CsvMyOperationExecutor } from "../csv-my-operation/executor";

// Inside executorRegistry:
[NodeType.CSV_MY_OPERATION]: CsvMyOperationExecutor,
```

---

## Step 7 — Register the progress relay (if your worker emits progress)

Only needed if your worker calls `inngest.send({ name: "csv/my-operation.progress", ... })`.

**File:** `src/inngest/functions.ts`

```typescript
export const relayCsvMyOperationProgress = inngest.createFunction(
  { id: "relay/csv-my-operation-progress", retries: 0 },
  { event: "csv/my-operation.progress", channels: [FileChannel()] },
  async ({ event, publish }) => {
    const data = event.data as Record<string, unknown>;
    const executionId = typeof data.executionId === "string" ? data.executionId : null;
    const nodeId = typeof data.nodeId === "string" ? data.nodeId : null;
    const stage = typeof data.stage === "string" ? data.stage : null;

    if (!executionId || !nodeId || !stage) return { forwarded: false };

    await publish(
      FileChannel().progress({
        executionId,
        nodeId,
        stage,
        sourceRows: typeof data.sourceRows === "number" ? data.sourceRows : undefined,
        rowsScanned: typeof data.rowsScanned === "number" ? data.rowsScanned : undefined,
        rowsWritten: typeof data.rowsWritten === "number" ? data.rowsWritten : undefined,
        elapsedMs: typeof data.elapsedMs === "number" ? data.elapsedMs : undefined,
      }),
    );

    return { forwarded: true };
  },
);
```

**File:** `src/app/api/inngest/route.ts`

```typescript
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    executeWorkflow,
    relayCsvSortProgress,
    relayCsvFilterProgress,
    relayCsvMyOperationProgress, // ← add here
    cleanupRedisQueue,
  ],
});
```

---

## Step 8 — Register the worker process

**File:** `package.json`

```json
"worker:my-operation": "cross-env DATASET_STORAGE_ROOT=C:/autopilotdata tsx src/workers/csv-my-operation.worker.ts"
```

**File:** `mprocs.yaml`

```yaml
worker-my-operation:
  cwd: .
  cmd: ["npm", "run", "worker:my-operation"]
```

**File:** `ecosystem.config.js` (production PM2 config)

```javascript
{
  ...workerBase,
  name: "worker-my-operation",
  script: "./src/workers/csv-my-operation.worker.ts",
  node_args: "--max-old-space-size=512",  // adjust based on memory needs
}
```

Memory guidelines per worker type:

| Work pattern | Suggested `--max-old-space-size` |
|---|---|
| Pure streaming (no buffering) | `512` |
| Hash join / build-side in memory | `1024` |
| In-memory sort | `2048` |
| Group-state accumulation (many keys) | `1024` |

---

## Output format reference

Every executor must return `{ [variableName]: value }` where value is one of:

### A — DatasetRef (for large outputs stored on disk)

Use this when the output is a CSV dataset (many rows). The rest of the pipeline uses `streamContextRows()` to read it back.

```typescript
return {
  [variableName]: {
    kind: "dataset" as const,
    datasetId: manifest.datasetId,
    executionId: manifest.executionId,
    variableName: manifest.variableName,
    storage: manifest.storage,            // "jsonl"
    manifestVersion: manifest.version,
    rowCount: manifest.rowCount,
    chunkCount: manifest.chunkCount,
    byteSize: manifest.byteSize,
    schema: manifest.schema,
    summary: { /* operation-specific */ },
  },
};
```

The helper `toDatasetRefOutput(manifest)` in `executor-utils.ts` builds the core fields automatically.

### B — Inline records (for small outputs, < 5000 rows)

Use this for analysis results or aggregation outputs that fit in memory. Downstream nodes read these as plain arrays.

```typescript
return {
  [variableName]: {
    kind: "dataset-summary",
    records: [
      { col1: "value", col2: 42 },
      // ...
    ],
    schema: {
      col1: { type: "string", nullable: false },
      col2: { type: "number", nullable: false },
    },
    metadata: { /* anything useful */ },
  },
};
```

### C — Scalar or pass-through (non-CSV outputs)

For nodes that produce a single value, a status flag, or pass the input through unchanged:

```typescript
return {
  [variableName]: {
    status: "ok",
    count: 42,
    // any JSON-serializable value
  },
};
```

**Never return a raw array at the top level.** Any array with more than `DATASET_STORAGE.MAX_INLINE_DATASET_ROWS` (default 5000) rows will be rejected by `assertNoLargeArrayOutput` in `functions.ts` with a `NonRetriableError`.

---

## Inngest event naming conventions

| Event | Sender | Shape |
|---|---|---|
| `csv/{op}.complete` | Worker `completed` handler | `{ executionId, datasetId, nodeId, variableName, result }` |
| `csv/{op}.complete` | Worker `failed` handler | `{ executionId, error, failed: true }` |
| `csv/{op}.progress` | Worker hot path (fire-and-forget) | `{ executionId, nodeId, stage, sourceRows?, rowsScanned?, rowsWritten?, elapsedMs? }` |

The executor's `waitForEvent` only listens for `csv/{op}.complete`. Sending only `csv/{op}.failed` on failure means the executor hangs until timeout.

---

## Error handling rules

| Situation | Correct action |
|---|---|
| Bad node config (missing field, wrong type) | `throw new NonRetriableError(...)` in executor — retrying won't help |
| Source variable not found in context | `throw new NonRetriableError(...)` in executor |
| Transient failure (network, Redis) | `throw new Error(...)` in worker — BullMQ will retry |
| Data integrity failure (malformed rows) | `throw new UnrecoverableError(...)` in worker — do not retry |
| Worker fatal error on final attempt | Send `csv/{op}.complete` with `{ failed: true, error: msg }` |
| `waitForEvent` result has `.data.error` | `throw new NonRetriableError(...)` in executor |
| `waitForEvent` returns null (timed out) | `throw new NonRetriableError("timed out")` in executor |

---

## Integration checklist

Use this before marking a new worker as done.

**Executor**
- [ ] Reads every required field from `data`, throws `NonRetriableError` on missing/invalid
- [ ] Resolves source variable with `resolveContextValue`, throws with available keys on miss
- [ ] Checks `sourceRows === 0` and throws `NonRetriableError`
- [ ] `step.waitForEvent` is called **before** `step.run("enqueue-...")`
- [ ] `queue.add()` uses `getCsv{Op}Queue()` from `worker-queue.ts` (not `new Queue()`)
- [ ] `queue.add()` passes a `timeout` option (BullMQ timeout = Inngest timeout − 5 min)
- [ ] `queue.add()` passes a `jobId` of `${executionId}-${datasetId}` (idempotent re-runs)
- [ ] Failure check: reads `completion?.data?.error ?? completion?.data?.reason`
- [ ] Timeout check: `if (!completion || !completion.data?.result)`
- [ ] Wrapped in `withCsvNodeStatus` (publishes loading/error/success UI state)

**Worker**
- [ ] `CsvMyOperationJobData` interface matches executor's `queue.add()` payload exactly
- [ ] `CsvMyOperationJobResult` interface matches executor's `completion.data.result` cast
- [ ] Uses `streamContextRows(sourceRef)` for input — handles both `DatasetRef` and inline
- [ ] Calls `datasetService.persistRowsFromStream(...)` for output
- [ ] `completed` handler sends `csv/{op}.complete` with `result` in data
- [ ] `failed` handler sends `csv/{op}.complete` with `failed: true, error: msg` on final attempt
- [ ] `failed` handler checks `isFinalAttempt` before sending (don't signal on intermediate retries)
- [ ] `Worker` constructor has `stalledInterval`, `maxStalledCount`, `lockDuration`
- [ ] `process.on("SIGTERM")` and `process.on("SIGINT")` call `worker.close()`
- [ ] Uses `UnrecoverableError` for data-integrity failures (no retry), `Error` for transient failures

**Registration**
- [ ] `NodeType.CSV_MY_OPERATION` added to `prisma/schema.prisma` enum
- [ ] `npx prisma migrate dev` run and committed
- [ ] `executor-registry.ts` imports and registers the executor
- [ ] `worker-queue.ts` exports `getCsvMyOperationQueue()`
- [ ] `package.json` has `"worker:my-operation"` script
- [ ] `mprocs.yaml` has `worker-my-operation` process
- [ ] `ecosystem.config.js` has the worker with appropriate memory limit
- [ ] If progress events: relay function registered in `functions.ts` and `route.ts`

**Testing**
- [ ] Start all services: `mprocs` (or `npm run dev:all`)
- [ ] Create a workflow with the new node, run it with a small CSV (< 100 rows)
- [ ] Check worker stdout for boot log and job start/complete logs
- [ ] Check Inngest Dev Server UI (localhost:8288) that `csv/my-operation.complete` event arrived
- [ ] Run with a large CSV (> 100k rows) to test the DatasetRef path
- [ ] Force a failure (pass invalid myField) — confirm workflow errors in < 5 seconds, not 60 minutes
- [ ] Restart the worker mid-job — confirm the job is re-queued and eventually completes

---

## Changing an existing node to use a worker

If a node currently uses `step.run()` directly (no BullMQ) and takes too long:

1. Create the worker file (Step 4 above) — the computation moves here
2. Replace the `step.run()` content in the executor with enqueue + waitForEvent (Step 3)
3. The node's `data` type and dialog are **unchanged** — only the execution path changes
4. Add the queue singleton (Step 5)
5. Register the worker process (Step 8)
6. Test that existing workflow configurations still work without any node re-configuration

The user never sees this change — their workflow and node settings remain identical.
