# CSV Sort and CSV Pipeline: End-to-End Clarification

Date: 2026-04-09
Author: Copilot investigation

## 1) Direct answer first

Your sort is not stuck. It is running through a valid out-of-core pipeline.

The reason dataset metadata appears late in the execution panel is architectural:

1. Node outputs are accumulated in in-memory execution context while nodes run.
2. The persisted execution output payload is written to the database at workflow completion.
3. The dataset metadata API resolves variables from that persisted execution output.
4. Therefore, until workflow completion, the panel usually cannot resolve dataset variables for metadata queries.

There is also a second UI gate: even after data is available, the panel waits for a manual "Load Dataset" click before fetching table metadata and rows.

## 2) What "metadata" means here (there are multiple kinds)

In this codebase, "metadata" can mean different things:

1. Upload preview metadata
   - Row and column hints generated before execution from preview parse mode.
   - Source: `src/app/api/upload-file/preview-parse/route.ts` and `src/workers/csv-parse.worker.ts` (`mode: "metadata"`).

2. Dataset manifest metadata
   - Actual persisted dataset facts: rowCount, chunkCount, schema, chunk map, byte size.
   - Source: `manifest.json` in dataset storage root, loaded by dataset service.

3. Execution panel run metadata
   - Status, start/end timestamps, duration, errors, node statuses.
   - Source: execution row + realtime node status events.

4. Variable metadata catalog (builder-time UX)
   - Column suggestions in node dialogs (Sort/Join/etc.) based on upstream node config and preview metadata.
   - Source: `src/features/executions/lib/variable-metadata-catalog.ts`.

## 3) End-to-end flow from file to sorted dataset

### 3.1 Before execution (upload + preview)

1. Upload node stores file asset under `.autopilot-data/workflow-file-assets`.
2. Preview parse API can run CSV parser in metadata mode (no full persisted dataset output), returning row and column hints.
3. Those hints are saved in node data and used to suggest fields in downstream dialogs.

### 3.2 Execution start

1. Workflow execute mutation creates execution row as RUNNING and emits `workflows/execute.workflow`.
2. Inngest function loads workflow graph, topo-sorts nodes, and executes node executors in order.
3. Panel starts polling execution status and output summary.

### 3.3 Upload File executor runtime output format

Upload node writes binary payload to execution dataset directory and returns a blob reference object in context:

```json
{
  "type": "blob",
  "fileBlobPath": ".../executionId/file-uuid.bin",
  "name": "input.csv",
  "mimeType": "text/csv",
  "size": 12345,
  "uploadedAt": "..."
}
```

### 3.4 CSV Parse executor runtime output format

CSV parse node enqueues BullMQ parse worker, waits for `csv/parse.complete`, then returns a DatasetRef-like object:

```json
{
  "kind": "dataset",
  "datasetId": "...",
  "executionId": "...",
  "variableName": "parsedCsv",
  "storage": "jsonl",
  "manifestVersion": 1,
  "rowCount": 21839999,
  "chunkCount": 874,
  "byteSize": 0,
  "schema": { "...": "..." },
  "parsedMetadata": {
    "rowCount": 21839999,
    "columnCount": 22,
    "columns": ["..."],
    "delimiter": ","
  }
}
```

### 3.5 CSV Sort executor runtime behavior

Sort node:

1. Resolves source variable from context.
2. Builds comparator from sortField + direction + compareAs + nulls (+ optional schema hints).
3. Chooses strategy:
   - In-memory path for smaller inputs.
   - External sort path for large inputs.
4. Enqueues job to `csv-sort` worker and waits for `csv/sort.complete`.
5. Returns sorted DatasetRef + summary in context.

### 3.6 CSV Sort worker behavior (important details)

For large datasets:

1. Streams source rows from DatasetRef or inline source.
2. Builds sorted run files in temp scope.
3. Merges runs with heap-based k-way merge (`mergeFanIn`, default 8).
4. Streams merged rows to dataset persistence.
5. Emits completion event to resume the executor.

Run format in external sort temp files is sequence + JSON payload per line:

- `<seq>\t<json-row>\n`

Current temp and persisted storage are JSONL-based.

### 3.7 Where files are written on disk

Default roots:

1. Execution datasets: `.autopilot-data/execution-datasets`
2. External sort temp runs: `.autopilot-data/execution-datasets/_tmp/external-sort`
3. Workflow file assets: `.autopilot-data/workflow-file-assets`

Given your workspace path, this resolves under your project directory on C:.

If the workspace is in a synced folder, IO latency can increase significantly.

## 4) What the execution panel shows while running

The panel combines two different channels:

1. Realtime node statuses
   - From `FileChannel` / `ManualTriggerChannel` events (`loading`, `success`, `error`).
   - This is why node status updates are visible during execution.

2. Persisted execution output summary
   - Fetched from `executions.getOneRawOutput`.
   - This payload drives dataset variable discovery in the right-side inspector.

During run, per selected node, behavior is typically:

1. If node is loading: "Running ... Waiting for node output..."
2. If node marked success but output not yet available in persisted payload: still waits.
3. After output is present and dataset-like variable is detected:
   - Shows "Dataset ready"
   - Requires clicking "Load Dataset"
   - Then loads metadata and paged rows using dataset TRPC endpoints.

Important: worker stage events like `csv/sort.progress` are emitted, but currently not wired into this panel for stage-by-stage UI.

## 5) Investigation: why metadata appears only after workflow finish

Confirmed root-cause chain:

1. Inngest loop executes nodes and updates in-memory context after each node.
2. Final DB write to `execution.output` happens in `complete-execution` step after all nodes finish.
3. Dataset metadata API (`executions.getDatasetMeta`) resolves variable from `execution.output`.
4. Until output contains that variable, metadata query cannot resolve it.
5. Panel also uses `outputRecord` to compute `selectedDatasetVariable`, so dataset viewer path stays unavailable until output is persisted.

This behavior is expected with current architecture, not a random UI bug.

## 6) Similar CSV nodes: how they compare

### 6.1 Filter, Aggregate, Sort, Column Stats

These generally:

1. Read source from context (inline rows or DatasetRef).
2. Stream or transform rows.
3. Persist output via dataset service.
4. Return DatasetRef-like output with summary.

### 6.2 Deduplicate

Also persists output dataset, but implementation has separate paths for fast inline and large streaming behavior.

### 6.3 Join

Join uses worker-based execution and persists joined rows, but current executor output shape is not the same full DatasetRef contract used by other nodes.
That can affect how easily the execution panel treats it as dataset-like output.

### 6.4 Compare

Compare is analytic output (diff summary + samples), not a dataset persistence output by default.

## 7) About your colleague's critique: what is right, what to calibrate

### 7.1 Correct points

1. JSON parse/stringify overhead is a major cost at large scale.
2. Key precomputation is high impact, especially for numeric/date compare.
3. 50 MB run target is conservative and increases run count/merge work.
4. Key/value separation and binary run formats can materially reduce CPU and IO.

### 7.2 Points that are directionally right but overstated

1. "Prototype only" is too harsh.
   - You already have bounded-memory external path, schema-aware typing, chunked persistence, cancellation hooks, queue orchestration, and progress signals.
2. "Fan-in change is irrelevant" is inaccurate.
   - Fan-in matters, though it is not the only merge-performance lever.
3. Absolute runtime rankings are workload-dependent.
   - DuckDB/GNU sort can be much faster, but end-to-end integration constraints and conversion overhead still matter.

### 7.3 Most practical interpretation

Your current implementation is architecturally correct and operationally usable, but not yet optimized for peak throughput on very large data.

## 8) Recommended fixes for the metadata-delay UX

If your goal is "show dataset metadata before workflow completes", these are the practical options:

1. Incremental output snapshots (most direct)
   - Persist partial `execution.output` after each node completes.
   - Pros: panel can resolve node outputs earlier.
   - Cons: more DB writes; must handle partial-output semantics.

2. Separate node-output index table (cleaner long-term)
   - Persist per-node output references (especially DatasetRef) as execution progresses.
   - Panel reads node outputs from this live table instead of only final output blob.

3. Wire worker progress events to panel
   - Subscribe panel to `csv/sort.progress` and display scan/run/merge/persist stage progress while node runs.
   - This improves user trust even before metadata is queryable.

4. Optional UX tweak
   - Auto-load dataset for selected node when it first becomes available, instead of requiring manual button click.

## 9) Short narrative you can give your colleague

"We ingest file blobs, parse CSV to typed chunked datasets, then sort with in-memory or external merge strategy depending on size. Large sorts generate temp sorted runs and merge them into a persisted dataset manifest. The progress panel shows realtime node states, but dataset metadata in the panel currently depends on final persisted execution output, which is written at workflow completion, so metadata appears late by design. We can change that by persisting per-node outputs incrementally or through a live node-output index."

## 10) File map used for this investigation

- `src/features/workflows/server/routers.ts`
- `src/inngest/functions.ts`
- `src/features/executions/components/upload-file/executor.ts`
- `src/features/executions/components/csv-parse/executor.ts`
- `src/workers/csv-parse.worker.ts`
- `src/features/executions/components/csv-sort/executor.ts`
- `src/workers/csv-sort.worker.ts`
- `src/features/executions/server/datasets/external-sort.ts`
- `src/features/executions/server/datasets/comparator.ts`
- `src/features/executions/server/datasets/dataset-service.ts`
- `src/features/executions/server/datasets/jsonl-storage-adapter.ts`
- `src/features/executions/server/executions-router.ts`
- `src/features/editor/components/workflow-progress-panel.tsx`
- `src/features/executions/components/execution-dataset-viewer.tsx`
- `src/features/executions/server/datasets/context-resolver.ts`
- `src/features/executions/lib/variable-metadata-catalog.ts`
- `src/features/executions/server/workflow-file-assets.ts`
- `src/features/executions/server/datasets/paths.ts`
