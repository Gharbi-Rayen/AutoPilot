# Node Data Flow Answers And Upgrade Plan

Date: 2026-04-02

Implementation ticket backlog: docs/NODE_DATA_FLOW_IMPLEMENTATION_TICKETS.md

## Answers To Your Questions

1. How is each node handling data internally: full memory or chunked?

- Current behavior is mostly full-memory per dataset.
- CSV Parse reads the full file content into memory first, then builds a full `records` array.
- Some CSV nodes use chunked loops (batch size 1000), but this only chunks iteration. The full source array is already loaded in memory before chunking starts.
- Net effect: chunking reduces loop pressure, but does not provide true streaming memory behavior.

2. What kind of operations is each node doing?

- CSV Filter: predicate-based row filtering (`eq`, `contains`, `gt`, etc.).
- CSV Sort: full in-memory sort with type-aware compare (`string`, `number`, `date`) and null ordering.
- CSV Aggregate: group-by + metrics (`count`, `sum`, `avg`, `min`, `max`).
- CSV Join: hash-index style join with multiple join types (`inner`, `left`, `right`, `full`, exclusives).
- CSV Compare: dataset diffing (added, removed, changed, unchanged) with optional key-field matching.
- CSV Column Stats: per-column frequency maps, unique counts, and numeric summaries.
- Conclusion: it is more than simple filter/sort; several nodes are compute-heavy transformations.

3. Is there any parallelism across nodes?

- Workflow node execution is sequential.
- The execution engine processes nodes one-by-one in topological order.
- There is no branch-level parallel execution in the current runner.
- UI real-time status updates do not mean backend parallel execution.

4. What is the data size per node?

- A node usually receives the full referenced dataset from context, not a pre-paginated subset.
- If the source variable has 40,000+ rows, that node processes that full set.
- Execution context is merged across steps and persisted at completion, which increases memory/storage pressure for large runs.
- Your exported sample indicates this clearly (`rowCount: 65000`).

5. How is the panel rendering processed results?

- Execution result fetch is a full `getOne` payload, including full output JSON.
- There is no backend pagination for execution output rows today.
- Progress panel truncates large payload display for UI performance and allows raw-data download.
- That truncation is display-only; the underlying payload remains full-size.

## Architecture And Design Context (for critique)

### Scope and target

- Target workload: up to 400 MB CSV input.
- Execution model: single-machine worker, not distributed compute.
- Goal: predictable memory behavior, acceptable latency, no UI freezes.

### Runtime context in this codebase

- Processing runs server-side in Node via workflow executors.
- UI is a consumer of execution metadata and sampled/paged result data.
- Current runner executes nodes sequentially in topological order.

### Current architecture shape

- Control plane: workflows, nodes, executions, status.
- Data plane: currently mixed into execution context/output JSON (too heavy).
- Execution plane: node transforms on in-memory arrays.
- Presentation plane: inspector panel currently receives large payloads.

### Constraints

- Keep architecture simple for MVP.
- Must support small-dataset fast path.
- Must be deployable in environments where local disk may be ephemeral.

### Non-goals

- No cluster scheduler.
- No distributed shuffle.
- No Spark-like orchestration.

## Critique Of The Current Plan For 400 MB

### What is correct

- DatasetRef direction is correct.
- UI pagination and virtualization are required.
- Streaming-friendly node migration order is correct.

### What still risks failure at 400 MB

1. DB chunk storage as default for raw row payloads.
2. Row-by-row transformation style instead of batch iterators.
3. Heavy nodes (sort/join) without strict safeguards and specialized algorithms.

### Why those three matter most

- DB chunk writes create excessive insert and serialization overhead.
- Per-row JS object churn increases CPU and GC cost.
- Sort/join can exceed memory quickly even with references if algorithms are naive.

## Improved 400 MB Architecture

### Core principle

- Nodes transform datasets stored outside context.
- Context carries references and metadata only.

### Data contract

```json
{
  "kind": "dataset",
  "datasetId": "ds_xxx",
  "rowCount": 65000,
  "schema": ["code_serie"],
  "storage": "jsonl",
  "chunkCount": 12,
  "bytes": 418381234
}
```

### Storage decision (updated)

- Default for 400 MB target: file-based chunk storage.
- Format for MVP: JSONL chunk files.
- Optional phase-up: Parquet adapter for faster analytical scans.
- Keep storage adapter abstraction:
  - local disk adapter for dev/single-host
  - object storage adapter for serverless/ephemeral disk deploys

Suggested chunk profile:

- target chunk size: 8-32 MB
- row batch size: 500-2000 rows
- compressed chunk option: gzip/zstd (optional)

### Processing model (updated)

- Always parse and transform in streaming batches.
- Never materialize full dataset arrays for large inputs.
- Keep small-dataset fast path for developer speed.

Budget constants:

- `MAX_IN_MEMORY_ROWS = 5000`
- `DEFAULT_BATCH_SIZE = 1000`
- `MAX_PREVIEW_ROWS = 50`
- `MAX_EXECUTION_OUTPUT_BYTES = 2_000_000`

### Node strategy by class

Streaming-friendly nodes:

- parse, filter, aggregate, column-stats

Semi-heavy nodes:

- compare with keyed chunk indexes

Heavy nodes with explicit algorithms:

- sort: external sort (run generation + k-way merge)
- join: guarded hash join with spill/partition strategy

### UI contract (updated)

- `getOne` must be summary-only.
- Full datasets fetched only through paged dataset endpoints.
- Inspector uses metadata + sample first, then on-demand pages.

## Updated Implementation Plan

### Priority order by impact

1. Remove full dataset payload from UI responses.
2. Remove full arrays from execution output/context.
3. Ship file-based dataset storage and DatasetRef contract.
4. Migrate streaming nodes.
5. Add heavy-node external algorithms and safety gates.

## Workstream A: UI decoupling first

Timeline: 1-2 days

- Replace inspector dependency on full output JSON.
- Add execution summary response with variable metadata only.
- Add dataset paging endpoints and virtualized table in panel.

Acceptance criteria:

- Browser never parses full large result blobs by default.
- First inspector render stays fast on 400 MB runs.

## Workstream B: Dataset storage foundation

Timeline: 2-4 days

- Build dataset storage adapter interface.
- Implement JSONL file adapter with chunk manifest.
- Add object storage adapter interface stub for future deploys.
- Persist only DatasetRef in execution output.

Acceptance criteria:

- 400 MB dataset persists as chunk files with retrievable metadata/pages.
- No multi-million-row payload in execution output JSON.

## Workstream C: Streaming node migration

Timeline: 4-6 days

- Migrate parse, filter, aggregate, column-stats to batch-stream mode.
- Keep fast path for small datasets under threshold.
- Add strict memory and payload budgets.

Acceptance criteria:

- No full-array materialization for migrated nodes on large inputs.
- Stable memory profile during parse/filter/aggregate flows.

## Workstream D: Heavy-node hardening

Timeline: 3-5 days

- Implement external sort pipeline.
- Implement guarded join strategy.
- Add guardrails:
  - hard limit or warning when both join sides are large
  - force external mode for large sorts

Acceptance criteria:

- Large sort/join do not crash worker memory.
- User receives clear warnings/fail-fast messages when limits are hit.

## Workstream E: Observability and SLOs

Timeline: 2-3 days (parallelizable)

- Per-node metrics:
  - rows in/out
  - bytes in/out
  - duration
  - peak memory estimate
- Add dashboard/report for top bottleneck nodes.
- Add regression benchmark suite for 100 MB, 250 MB, 400 MB.

Acceptance criteria:

- Bottlenecks are measurable and comparable per release.
- Regressions are caught before rollout.

## API And Contract Changes (updated)

### Execution summary response

- Keep status/timing/errors.
- Return variable metadata and DatasetRefs.
- Include optional sample rows only (for example first 50 rows).

Example:

```json
{
  "telecomParsed": {
    "kind": "dataset",
    "datasetId": "ds_telecom_01",
    "rowCount": 3250000,
    "schema": ["date", "revenue", "active_users"],
    "storage": "jsonl",
    "chunkCount": 48,
    "bytes": 418381234
  }
}
```

### Dataset APIs

- `getExecutionDatasetMeta(executionId, variable)`
- `getExecutionDatasetChunk(executionId, variable, chunkIndex)`
- `getExecutionDatasetRows(executionId, variable, chunkIndex, offset, limit)`
- `streamExecutionDataset(executionId, variable)`
- `downloadExecutionDataset(executionId, variable, format)`

## Rollout Strategy

### Feature flags

- Flag A: summary-only execution output API.
- Flag B: dataset-ref context mode.
- Flag C: streaming node path for selected node types.
- Flag D: external sort/join enforcement.

### Compatibility

- Read legacy executions with inline arrays.
- Translate legacy payloads into UI sample view where possible.

### Deployment model note

- If deployment has persistent local disk: use file adapter directly.
- If deployment is serverless/ephemeral disk: route storage adapter to object storage.

## Updated 10-Day Delivery Plan

Day 1-2

- Ship summary-only inspector path.
- Add chunk-based dataset API and virtualized UI table.

Day 3-4

- Implement dataset adapter and JSONL chunk manifest.
- Store DatasetRef in execution output.

Day 5-6

- Migrate parse/filter to streaming batch mode.

Day 7-8

- Migrate aggregate/column-stats.
- Add memory budgets and fail-fast limits.

Day 9-10

- Add external sort scaffold and join safeguards.
- Add benchmark suite and telemetry dashboard.

## Success Criteria (updated for 400 MB)

- UI never downloads full large datasets by default.
- Execution context/output stores DatasetRefs for large variables.
- Parse/filter/aggregate stay stable on 400 MB inputs.
- Sort and join either complete in external mode or fail fast with clear guidance.
- Target capacity supports roughly 1M-5M rows depending on row width.

## Additional Hardening (Post-critique)

- Add pipeline fusion for simple linear chains to avoid unnecessary intermediate writes.
- Enforce storage/type boundary consistency so schema and stored values never diverge.
- Add sparse row/byte offset indexes for fast row-window reads inside large chunks.
- Add anti-buffering guards so backpressure cannot be bypassed accidentally.
- Add comparator stability rules for sort and cardinality estimation for join planning.
- Add global resource budgets, dataset lifecycle cleanup policy, and execution concurrency limits.
- Keep a binary/columnar internal format upgrade path after JSONL MVP stabilization.
