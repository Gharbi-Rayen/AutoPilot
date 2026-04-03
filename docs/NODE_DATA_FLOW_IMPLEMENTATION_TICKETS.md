# Node Data Flow Implementation Tickets

Date: 2026-04-02
Target: 400 MB CSV workloads on a single-machine worker

## Current Assessment

- Architecturally sound for a production MVP at 400 MB.
- Core scalability patterns are in place: DatasetRef, chunking, backpressure, external sort plan, write safety.
- Main remaining risks are I/O amplification across chained nodes, sort/join edge-case correctness, and multi-run contention.

## Execution Order

1. DONE TKT-001 API split: summary vs full output
2. DONE TKT-004 Prisma dataset metadata schema
3. DONE TKT-005 Dataset storage adapter and JSONL backend
4. DONE TKT-017 Dataset write safety (temp + commit)
5. DONE TKT-018 Schema typing system
6. DONE TKT-006 DatasetRef contract in execution context
7. DONE TKT-002 Dataset APIs (meta/chunk/download)
8. DONE TKT-013 Chunk-based dataset access (+ page adapter)
9. DONE TKT-003 Inspector UI chunked loading and virtualization
10. DONE TKT-014 Backpressure + async iterator pipeline
11. DONE TKT-007 CSV Parse streaming migration
12. DONE TKT-008 Streaming migration: filter/aggregate/column-stats
13. DONE TKT-015 External sort spec (chunk size + merge strategy)
14. DONE TKT-016 Join strategy rules + safeguards
15. DONE TKT-009 Heavy nodes: sort/join/compare production hardening
16. DONE TKT-010 Remove context cloning in non-data executors
17. DONE TKT-011 Runner output slimming and persistence rules
18. DONE TKT-012 Telemetry, limits, and benchmark harness
19. DONE TKT-019 Pipeline fusion for linear chains
20. DONE TKT-020 Storage/type boundary consistency
21. DONE TKT-021 Sparse row/byte offset indexes
22. DONE TKT-022 Anti-buffering guardrails in pipeline
23. DONE TKT-023 Comparator stability and normalization
24. DONE TKT-024 Join cardinality estimation
25. DONE TKT-025 Global resource budget enforcement
26. DONE TKT-026 Dataset lifecycle cleanup policy
27. DONE TKT-027 Execution queue and concurrency limits
28. DONE TKT-028 Binary/columnar format upgrade path

## Tickets

### DONE TKT-001: Split execution API into summary and raw output

Goal:

- Ensure normal execution views never load full output blobs by default.

Edit files:

- src/features/executions/server/executions-router.ts
- src/features/executions/server/prefetch.ts
- src/features/executions/hooks/use-executions.ts
- src/app/(dashboard)/(rest)/executions/[executionId]/page.tsx
- src/features/editor/components/workflow-progress-panel.tsx
- src/features/executions/components/execution-detail.tsx

Tasks:

- Add summary query path excluding large output payloads.
- Keep raw-output query path only for explicit drill-down/download.
- Update prefetch/hooks/pages to use summary path by default.

Acceptance:

- Progress panel no longer fetches full execution output.
- Execution detail can still request full payload explicitly.

Depends on:

- None

Test & Verification:

- Run one completed execution through the summary query and capture response size/fields.
- Open execution detail and trigger raw output fetch explicitly.
- Verify goal reached when default UI and prefetch paths never include full output payload, while explicit raw fetch still works.

---

### DONE TKT-002: Add dataset APIs to executions router

Goal:

- Serve result data without loading one large JSON payload.

Edit files:

- src/features/executions/server/executions-router.ts
- src/features/executions/hooks/use-executions.ts
- src/features/editor/components/workflow-progress-panel.tsx
- src/features/executions/components/execution-detail.tsx

Create files:

- src/features/executions/server/datasets/trpc-inputs.ts

Tasks:

- Add procedures:
- getDatasetMeta(executionId, variable)
- getDatasetChunk(executionId, variable, chunkIndex)
- getDatasetRows(executionId, variable, chunkIndex, offset, limit)
- downloadDataset(executionId, variable, format)
- Add frontend hooks for meta/chunk/rows/download calls.

Acceptance:

- UI can load metadata and chunked rows independently.
- API supports variable selection and chunk-indexed retrieval.

Depends on:

- TKT-001
- TKT-005

Test & Verification:

- Seed an execution with a dataset variable and call getDatasetMeta, getDatasetChunk, getDatasetRows, and downloadDataset.
- Call each endpoint with invalid variable/chunk inputs to confirm safe error handling.
- Verify goal reached when row retrieval works by chunk and offset without requiring the full output blob.

---

### DONE TKT-003: Build chunked dataset viewer in inspector UI

Goal:

- Replace raw JSON rendering with chunked/virtualized dataset browsing.

Edit files:

- src/features/editor/components/workflow-progress-panel.tsx
- src/features/executions/components/execution-detail.tsx

Create files:

- src/features/executions/components/execution-dataset-viewer.tsx
- src/features/executions/components/execution-dataset-navigation.tsx

Tasks:

- Show summary metadata first.
- Fetch rows chunk-by-chunk.
- Render table with stable scrolling and bounded DOM nodes.
- Keep page-like UX in UI resolved via chunk + offset.

Acceptance:

- Inspector does not freeze on large results.
- First render remains fast while rows load incrementally.

Depends on:

- TKT-001
- TKT-002
- TKT-013

Test & Verification:

- Open a large execution in the inspector and confirm metadata renders before row data.
- Scroll through multiple windows and observe chunk navigation requests and bounded rendered row count.
- Verify goal reached when UI remains responsive, does not freeze, and deep navigation loads incrementally.

---

### DONE TKT-004: Add dataset metadata schema in Prisma

Goal:

- Persist dataset metadata and references outside execution output blobs.

Edit files:

- prisma/schema.prisma

Create files:

- prisma/migrations/20260402130000_execution_dataset_storage/migration.sql

Tasks:

- Add dataset metadata model(s).
- Add execution-variable-to-dataset reference model(s).
- Keep execution output for summary/reference payloads, not full row arrays.

Acceptance:

- Prisma schema supports dataset reference lifecycle.
- Migration applies cleanly.

Depends on:

- None

Test & Verification:

- Run prisma migrate dev and prisma generate on a clean database.
- Insert and query dataset metadata plus execution-variable reference rows.
- Verify goal reached when migration applies cleanly and relations support dataset lifecycle operations.

---

### DONE TKT-005: Implement dataset storage adapter (JSONL chunks)

Goal:

- Store large row payloads in chunk files, not execution JSON.

Edit files:

- src/config/constants.ts

Create files:

- src/features/executions/server/datasets/types.ts
- src/features/executions/server/datasets/storage-adapter.ts
- src/features/executions/server/datasets/jsonl-storage-adapter.ts
- src/features/executions/server/datasets/object-storage-adapter.ts
- src/features/executions/server/datasets/dataset-service.ts
- src/features/executions/server/datasets/paths.ts
- src/features/executions/server/datasets/index.ts

Tasks:

- Define adapter interface for write/read/list/stream.
- Implement JSONL chunk writer and reader with manifest.
- Add object-storage adapter scaffold for non-persistent disk deployments.
- Add manifest format version for future binary/columnar evolution.

Acceptance:

- 400 MB input can be persisted as chunked files.
- Service can return dataset metadata and chunk-indexed reads.

Depends on:

- TKT-004

Test & Verification:

- Write a large synthetic dataset through dataset-service and inspect created chunk files plus manifest.
- Read multiple chunks and validate row counts/checksum against source data.
- Verify goal reached when large payloads are persisted and read via chunked JSONL without full-memory materialization.

---

### DONE TKT-006: Introduce DatasetRef contract in workflow context

Goal:

- Pass dataset handles between nodes instead of full record arrays.

Edit files:

- src/features/executions/components/types.ts
- src/inngest/functions.ts
- src/features/executions/components/stubs/executors.ts
- src/features/executions/components/csv-parse/executor.ts

Create files:

- src/features/executions/server/datasets/dataset-ref.ts
- src/features/executions/server/datasets/context-resolver.ts

Tasks:

- Add typed DatasetRef shape.
- Update context merge and output persistence to prefer references.
- Add resolver utilities for mixed legacy/raw/reference values.

Acceptance:

- Large variables in context are DatasetRef values.
- Execution output stores references and summaries, not full arrays.

Depends on:

- TKT-004
- TKT-005
- TKT-018

Test & Verification:

- Execute a workflow producing a large dataset and inspect per-node context payload shape.
- Run a mixed legacy case where upstream data is inline array and downstream resolves it through context-resolver.
- Verify goal reached when large variables are DatasetRef in context/persistence and legacy compatibility still works.

---

### DONE TKT-007: Migrate CSV Parse to true streaming write path

Goal:

- Parse CSV input stream directly into dataset chunks.

Edit files:

- src/features/executions/components/csv-parse/executor.ts
- src/features/executions/components/lib/executor-registry.ts

Tasks:

- Replace full csvText-to-records materialization for large inputs.
- Write rows in batches through dataset service.
- Return DatasetRef as node output.

Acceptance:

- Large parse path does not allocate full record arrays.
- Parse returns DatasetRef with rowCount and typed schema.

Depends on:

- TKT-005
- TKT-006
- TKT-014

Test & Verification:

- Run csv-parse on a 400 MB file while sampling process memory over time.
- Validate returned node output includes DatasetRef, rowCount, and inferred schema.
- Verify goal reached when parse path streams to chunks and avoids full-record-array allocation.

---

### DONE TKT-008: Migrate streaming-friendly CSV nodes

Goal:

- Move filter/aggregate/column-stats from in-memory arrays to batch-stream processing.

Edit files:

- src/features/executions/components/stubs/executors.ts

Create files:

- src/features/executions/components/csv-filter/executor.ts
- src/features/executions/components/csv-aggregate/executor.ts
- src/features/executions/components/csv-column-stats/executor.ts

Edit files (routing):

- src/features/executions/components/lib/executor-registry.ts

Tasks:

- Implement async-batch iterators for each node.
- Keep small dataset fast path threshold.
- Emit DatasetRef plus computed summaries.

Acceptance:

- Filter/aggregate/column-stats run without full dataset materialization.
- Registry points to dedicated executors (not stubs) for migrated nodes.

Depends on:

- TKT-006
- TKT-007
- TKT-014

Test & Verification:

- Compare filter/aggregate/column-stats results against fixed golden fixtures.
- Run large-input workflows and ensure memory remains bounded during processing.
- Verify goal reached when migrated nodes use dedicated executors and no longer require full in-memory materialization.

---

### DONE TKT-009: Harden heavy nodes (sort/join/compare)

Goal:

- Prevent memory blowups on heavy transforms.

Edit files:

- src/features/executions/components/stubs/executors.ts
- src/config/constants.ts

Create files:

- src/features/executions/components/csv-sort/executor.ts
- src/features/executions/components/csv-join/executor.ts
- src/features/executions/components/csv-compare/executor.ts

Edit files (routing):

- src/features/executions/components/lib/executor-registry.ts

Tasks:

- Sort implementation follows TKT-015 and TKT-023.
- Join implementation follows TKT-016 and TKT-024.
- Compare adds indexed/chunk-aware path with explicit limits.

Acceptance:

- Heavy nodes either complete in bounded memory or fail fast with clear message.

Depends on:

- TKT-005
- TKT-006
- TKT-015
- TKT-016
- TKT-023
- TKT-024

Test & Verification:

- Run sort, join, and compare on high-volume fixtures and track peak memory plus failure modes.
- Exercise guarded cases (oversized join, unsupported key shape) to confirm fast actionable failures.
- Verify goal reached when heavy nodes either complete within budgets or fail predictably without worker instability.

---

### DONE TKT-010: Remove unnecessary context cloning in executors

Goal:

- Stop duplicating context objects on node returns.

Edit files:

- src/features/executions/components/code/executor.ts
- src/features/executions/components/discord/executor.ts
- src/features/executions/components/email/executor.ts
- src/features/executions/components/http-request/executor.ts
- src/features/executions/components/slack/executor.ts
- src/features/executions/components/telegram/executor.ts
- src/features/executions/components/whatsapp/executor.ts

Tasks:

- Return only new output keys from executors.
- Keep context merge centralized in runner only.

Acceptance:

- Executors no longer return spread context payloads.
- Downstream template/variable behavior remains unchanged.

Depends on:

- None

Test & Verification:

- Run each non-data executor and inspect returned payload keys.
- Execute a chained workflow with templates referencing prior context variables.
- Verify goal reached when executors return only new outputs and downstream variable resolution remains unchanged.

---

### DONE TKT-011: Slim runner persistence and execution output

Goal:

- Persist execution metadata and DatasetRefs instead of full variable payloads.

Edit files:

- src/inngest/functions.ts
- src/features/executions/server/executions-router.ts

Tasks:

- Add output sanitization before persistence.
- Persist reference-safe summary in execution output.
- Keep explicit raw data retrieval through dataset APIs only.

Acceptance:

- execution output remains small and stable for large runs.
- Existing status/error flows remain intact.

Depends on:

- TKT-001
- TKT-006

Test & Verification:

- Run a large workflow and inspect persisted execution output JSON size/shape.
- Retrieve the same variable through dataset APIs to confirm full data is still accessible.
- Verify goal reached when execution output remains compact and status/error behavior is unchanged.

---

### DONE TKT-012: Add telemetry, limits, and benchmark harness

Goal:

- Make performance measurable and regressions visible.

Edit files:

- src/config/constants.ts
- src/inngest/functions.ts
- src/features/executions/components/csv-parse/executor.ts
- src/features/executions/components/stubs/executors.ts
- package.json

Create files:

- src/features/executions/server/metrics/node-execution-metrics.ts
- scripts/bench/execution-400mb-benchmark.ts
- docs/NODE_DATA_FLOW_BENCHMARKS.md

Tasks:

- Track per-node rows in/out, bytes in/out, duration, and memory peak.
- Track GC pause time and disk I/O time versus CPU time.
- Add limits:
- MAX_IN_MEMORY_ROWS
- DEFAULT_BATCH_SIZE
- MAX_EXECUTION_OUTPUT_BYTES
- Add benchmark command and reporting doc.

Acceptance:

- Team can run repeatable 100 MB, 250 MB, and 400 MB benchmarks.
- Metrics identify whether slowdowns are CPU, GC, or disk bound.
- Limits are enforced with user-facing messages.

Depends on:

- TKT-005
- TKT-006

Test & Verification:

- Run benchmark script for 100 MB, 250 MB, and 400 MB datasets and save reports.
- Confirm emitted metrics include rows, bytes, duration, memory peak, GC pause, disk I/O time, and CPU time.
- Verify goal reached when limits trigger clear user-facing failures and benchmark outputs are repeatable.

---

### DONE TKT-013: Chunk-based dataset access (+ page adapter)

Goal:

- Eliminate O(n) deep-page scans on JSONL datasets.

Edit files:

- src/features/executions/server/executions-router.ts
- src/features/executions/server/datasets/dataset-service.ts
- src/features/executions/server/datasets/jsonl-storage-adapter.ts
- src/features/executions/server/datasets/types.ts

Create files:

- src/features/executions/server/datasets/chunk-index.ts

Tasks:

- Add chunk index metadata (chunk row ranges and cumulative rows).
- Implement O(1) chunk lookup by chunkIndex.
- Provide page/pageSize compatibility adapter mapped to chunk + offset.

Acceptance:

- Accessing chunk N does not scan earlier chunks line-by-line.
- High page numbers do not degrade linearly with dataset size.

Depends on:

- TKT-002
- TKT-005

Test & Verification:

- Query deep chunk indices and high page numbers repeatedly and capture response time.
- Compare returned windows between page adapter and direct chunk+offset paths.
- Verify goal reached when deep access stays near-constant-time and does not perform linear pre-scan.

---

### DONE TKT-014: Backpressure + async iterator pipeline

Goal:

- Keep memory stable when parse, transform, and write speeds differ.

Edit files:

- src/features/executions/components/csv-parse/executor.ts
- src/features/executions/components/stubs/executors.ts
- src/features/executions/server/datasets/dataset-service.ts

Create files:

- src/features/executions/server/datasets/async-batch-iterator.ts
- src/features/executions/server/datasets/pipeline.ts

Tasks:

- Standardize pull-based processing with async generators.
- Add bounded buffering and await-driven backpressure.
- Add cancellation/error propagation across pipeline stages.

Acceptance:

- No unbounded queue growth during slow writes.
- Large pipelines stay memory-bounded under load.

Depends on:

- TKT-005
- TKT-006

Test & Verification:

- Simulate slow downstream writes and confirm producer pace is naturally throttled.
- Force cancellation and injected errors mid-pipeline and confirm propagation/cleanup behavior.
- Verify goal reached when buffering stays bounded and memory does not climb unbounded under backpressure.

---

### DONE TKT-015: External sort spec (chunk size + merge strategy)

Goal:

- Make large dataset sorting deterministic, bounded, and recoverable.

Edit files:

- src/config/constants.ts
- src/features/executions/components/csv-sort/executor.ts

Create files:

- src/features/executions/server/datasets/external-sort.ts
- src/features/executions/server/datasets/temp-file-manager.ts

Tasks:

- Define fixed sort run size (for example 50 MB target).
- Implement k-way merge with capped fan-in (for example max 8 runs).
- Add temp file lifecycle manager (create/track/cleanup success and failure).

Acceptance:

- Large sort no longer depends on full in-memory arrays.
- Temp files are cleaned up reliably after completion or failure.

Depends on:

- TKT-014
- TKT-017

Test & Verification:

- Sort datasets larger than memory budget and validate output ordering against a trusted reference sort.
- Crash or abort mid-sort and verify temp run files are cleaned on failure and on restart.
- Verify goal reached when sort uses bounded run/merge strategy and always leaves a clean temp-file state.

---

### DONE TKT-016: Join strategy rules + safeguards

Goal:

- Prevent hangs/crashes on large-large joins and unsupported shapes.

Edit files:

- src/config/constants.ts
- src/features/executions/components/csv-join/executor.ts

Create files:

- src/features/executions/server/datasets/join-planner.ts
- src/features/executions/server/datasets/hash-join.ts

Tasks:

- Add explicit planner rules:
- small + large: hash join
- large + large: reject or require partitioned strategy flag
- unsupported key shape: fail fast with actionable error
- Add thresholds for input sizes and key-cardinality risk.

Acceptance:

- Two large joins fail fast or use an explicit supported path.
- Join behavior is deterministic and documented.

Depends on:

- TKT-014
- TKT-018

Test & Verification:

- Run join matrix cases: small+large, large+large without flag, large+large with approved strategy.
- Test unsupported key shapes and verify actionable fail-fast error text.
- Verify goal reached when planner chooses deterministic paths and blocks unsafe joins predictably.

---

### DONE TKT-017: Dataset write safety (temp + commit)

Goal:

- Avoid corrupted datasets after process crash or interrupted write.

Edit files:

- src/features/executions/server/datasets/dataset-service.ts
- src/features/executions/server/datasets/jsonl-storage-adapter.ts
- src/features/executions/server/datasets/paths.ts

Create files:

- src/features/executions/server/datasets/write-transaction.ts

Tasks:

- Write chunks into temporary dataset state (.tmp).
- Commit by atomic finalize/rename when manifest is complete.
- Add startup cleanup for stale temp datasets.

Acceptance:

- Partially written datasets are never exposed as complete.
- Recovery path handles interrupted writes safely.

Depends on:

- TKT-005

Test & Verification:

- Interrupt a write before commit and restart service to test stale temp cleanup.
- Confirm incomplete datasets are not discoverable via metadata/list endpoints.
- Verify goal reached when only atomically finalized datasets become visible as complete.

---

### DONE TKT-018: Schema typing system

Goal:

- Preserve field types to avoid repeated parsing and improve node performance.

Edit files:

- src/features/executions/components/types.ts
- src/features/executions/components/csv-parse/executor.ts
- src/features/executions/components/stubs/executors.ts
- src/features/executions/server/datasets/dataset-ref.ts

Create files:

- src/features/executions/server/datasets/schema-types.ts
- src/features/executions/server/datasets/schema-inference.ts

Tasks:

- Define typed schema map (field -> type).
- Infer and persist schema during parse.
- Reuse schema in downstream nodes to avoid repeated type detection.

Acceptance:

- DatasetRef includes typed schema metadata.
- Downstream nodes process typed values without re-inferring all fields.

Depends on:

- TKT-005

Test & Verification:

- Parse mixed-type CSV fixtures and assert inferred schema map correctness.
- Validate downstream nodes consume typed values without re-inferring all columns each time.
- Verify goal reached when DatasetRef schema is populated and typed processing is consistent across nodes.

---

### DONE TKT-019: Pipeline fusion for linear chains

Goal:

- Reduce intermediate disk I/O for simple streaming-compatible node chains.

Edit files:

- src/inngest/functions.ts
- src/features/executions/components/lib/executor-registry.ts

Create files:

- src/features/executions/server/pipeline/fusion-planner.ts
- src/features/executions/server/pipeline/fused-runner.ts

Tasks:

- Detect simple chains such as parse -> filter -> aggregate.
- Pass batches directly between compatible nodes without writing intermediate datasets.
- Fallback to materialized DatasetRef path when fusion is unsafe.

Acceptance:

- Compatible chains avoid unnecessary write/read cycles.
- End-to-end latency drops measurably on linear pipelines.

Depends on:

- TKT-007
- TKT-008
- TKT-014

Test & Verification:

- Execute compatible linear chains with fusion enabled and compare with fusion disabled.
- Record intermediate dataset writes to ensure fused runs reduce write/read cycles.
- Verify goal reached when fused and materialized outputs match and fused path lowers latency.

---

### DONE TKT-020: Storage/type boundary consistency

Goal:

- Eliminate schema mismatch bugs between stored values and typed schema.

Edit files:

- src/features/executions/components/csv-parse/executor.ts
- src/features/executions/server/datasets/jsonl-storage-adapter.ts
- src/features/executions/server/datasets/dataset-service.ts
- src/features/executions/server/datasets/schema-types.ts

Create files:

- src/features/executions/server/datasets/read-boundary.ts

Tasks:

- Define one strict type rule:
- persist canonical typed values matching schema, or
- parse at read boundary only while storage stays raw.
- Apply the same rule across filter/sort/join/compare.

Acceptance:

- Numeric/date comparisons are consistent across nodes.
- Sort/join outcomes do not vary due to inconsistent parsing.

Depends on:

- TKT-005
- TKT-018

Test & Verification:

- Build fixtures with numeric/date/string edge values and run filter/sort/join/compare.
- Validate equality/ordering outcomes are identical across repeated runs and node combinations.
- Verify goal reached when one storage/type policy is consistently enforced at boundaries.

---

### DONE TKT-021: Sparse row/byte offset indexes

Goal:

- Avoid linear scans inside chunks for row-window reads.

Edit files:

- src/features/executions/server/datasets/jsonl-storage-adapter.ts
- src/features/executions/server/datasets/chunk-index.ts
- src/features/executions/server/datasets/dataset-service.ts

Create files:

- src/features/executions/server/datasets/chunk-offset-index.ts

Tasks:

- Record sparse offsets (for example every 100 rows) per chunk.
- Track row and byte anchors for fast seek within chunk.
- Use offset index in getDatasetRows(chunkIndex, offset, limit).

Acceptance:

- Row-window reads do not degrade linearly with offset inside chunk.
- Chunk reads remain responsive for deep offsets.

Depends on:

- TKT-013

Test & Verification:

- Request row windows at high offsets within the same chunk and compare latency versus low offsets.
- Validate returned rows against a baseline full scan for correctness.
- Verify goal reached when deep in-chunk offsets stay responsive due to sparse index anchors.

---

### DONE TKT-022: Anti-buffering guardrails in pipeline

Goal:

- Prevent accidental batch accumulation that breaks backpressure.

Edit files:

- src/features/executions/server/datasets/pipeline.ts
- src/features/executions/server/datasets/async-batch-iterator.ts
- src/config/constants.ts

Create files:

- src/features/executions/server/pipeline/guards.ts

Tasks:

- Add runtime guard for max buffered batches.
- Expose safe pipeline helpers that discourage collect-all patterns.
- Emit explicit errors when buffering threshold is exceeded.

Acceptance:

- Pipeline fails fast if buffering grows beyond budget.
- Backpressure remains effective under slow downstream stages.

Depends on:

- TKT-014
- TKT-025

Test & Verification:

- Introduce an intentional collect-all misuse in a test pipeline and confirm guard failure.
- Run normal streaming pipelines to ensure guards do not trigger false positives.
- Verify goal reached when unsafe buffering fails fast and safe pipelines remain bounded.

---

### DONE TKT-023: Comparator stability and normalization

Goal:

- Guarantee deterministic external sort correctness across run generation and merge.

Edit files:

- src/features/executions/components/csv-sort/executor.ts
- src/features/executions/server/datasets/external-sort.ts
- src/features/executions/server/datasets/schema-types.ts

Create files:

- src/features/executions/server/datasets/comparator.ts

Tasks:

- Define stable comparator contract and null policy.
- Normalize typed values before comparison.
- Reuse one comparator implementation in run generation and merge.

Acceptance:

- External sort output is stable and deterministic.
- Merge stage preserves global ordering correctness.

Depends on:

- TKT-015
- TKT-020

Test & Verification:

- Sort datasets containing nulls, mixed casing, ties, and typed values across multiple runs.
- Validate that run generation and merge stages use the same comparator semantics.
- Verify goal reached when output ordering is stable and deterministic in every run.

---

### DONE TKT-024: Join cardinality estimation

Goal:

- Prevent memory spikes from low-cardinality or skewed join keys.

Edit files:

- src/features/executions/server/datasets/join-planner.ts
- src/features/executions/components/csv-join/executor.ts
- src/features/executions/server/datasets/hash-join.ts

Create files:

- src/features/executions/server/datasets/cardinality-estimator.ts

Tasks:

- Sample first N rows from both sides.
- Estimate key uniqueness and skew risk.
- Use estimates to choose plan or reject with actionable guidance.

Acceptance:

- Planner detects high-risk joins before full execution.
- Large skew joins no longer surprise-crash memory.

Depends on:

- TKT-016
- TKT-020

Test & Verification:

- Generate low-cardinality/skewed key datasets and validate planner decisions before full join.
- Confirm high-risk joins are rejected or rerouted with actionable guidance.
- Verify goal reached when join memory surprises are prevented by pre-execution estimation.

---

### DONE TKT-025: Global resource budget enforcement

Goal:

- Enforce workflow-level budgets across all stages, not per-node only.

Edit files:

- src/config/constants.ts
- src/inngest/functions.ts
- src/features/executions/server/datasets/dataset-service.ts
- src/features/executions/server/datasets/pipeline.ts

Create files:

- src/features/executions/server/resource-budget.ts

Tasks:

- Add global budgets:
- MAX_TOTAL_DISK_USAGE
- MAX_TOTAL_TEMP_FILES
- MAX_PIPELINE_MEMORY
- Track cumulative usage and stop execution before overload.

Acceptance:

- Multi-stage workflows cannot exceed configured global budgets.
- Budget failures return clear user-facing messages.

Depends on:

- TKT-012
- TKT-017

Test & Verification:

- Configure deliberately low budgets and run workflows that exceed each budget type.
- Confirm execution stops before overload and exposes clear user-facing failure reasons.
- Verify goal reached when cumulative workflow usage cannot surpass configured global caps.

---

### DONE TKT-026: Dataset lifecycle cleanup policy

Goal:

- Prevent dataset accumulation and disk exhaustion over time.

Edit files:

- src/features/executions/server/datasets/dataset-service.ts
- src/features/executions/server/datasets/paths.ts
- src/features/executions/server/executions-router.ts

Create files:

- src/features/executions/server/datasets/cleanup.ts

Tasks:

- Add TTL policy for completed-execution datasets.
- Add execution-scoped ownership metadata.
- Add manual cleanup endpoint and startup cleanup pass.

Acceptance:

- Old datasets are cleaned automatically.
- Active datasets remain protected from premature deletion.

Depends on:

- TKT-017
- TKT-025

Test & Verification:

- Create datasets with different ages and ownership states, then run cleanup job.
- Validate manual cleanup endpoint behavior for stale versus active datasets.
- Verify goal reached when stale data is removed automatically and active datasets remain protected.

---

### DONE TKT-027: Execution queue and concurrency limits

Goal:

- Prevent CPU/disk contention under multiple heavy runs.

Edit files:

- src/features/workflows/server/routers.ts
- src/inngest/functions.ts
- src/config/constants.ts

Create files:

- src/features/executions/server/execution-queue.ts
- src/features/executions/server/queue-policy.ts

Tasks:

- Define queue policy and max concurrent heavy executions.
- Classify workflows by expected resource profile.
- Surface queued/running status to execution views.

Acceptance:

- Multiple 400 MB jobs do not thrash the worker.
- Queueing behavior is visible and predictable.

Depends on:

- TKT-025

Test & Verification:

- Start concurrent heavy workflows above max limit and observe queue admission/running counts.
- Confirm queued, running, and completed states are surfaced in execution views.
- Verify goal reached when concurrency caps prevent worker thrash while preserving predictable throughput.

---

### DONE TKT-028: Binary/columnar format upgrade path

Goal:

- Provide a clear CPU-optimization path beyond JSONL for future scale.

Edit files:

- src/features/executions/server/datasets/storage-adapter.ts
- src/features/executions/server/datasets/dataset-service.ts
- src/config/constants.ts

Create files:

- src/features/executions/server/datasets/columnar-storage-adapter.ts
- docs/NODE_DATA_FORMAT_EVOLUTION.md

Tasks:

- Add adapter capability flags and format negotiation.
- Prototype columnar/binary adapter behind feature flag.
- Define migration and benchmark plan from JSONL to columnar format.

Acceptance:

- Engine can benchmark JSONL versus columnar path without API changes.
- Future format migration does not require node-level contract changes.

Depends on:

- TKT-005
- TKT-012

Test & Verification:

- Run identical workloads with JSONL and columnar adapter flag toggled.
- Verify storage negotiation selects expected adapter without changing API contracts.
- Verify goal reached when format benchmarking is possible and migration path is documented and reversible.

## Parallelization Notes

Can run in parallel after TKT-001:

- TKT-004 and TKT-010

Can run in parallel after TKT-005:

- TKT-017 and TKT-018

Can run in parallel after TKT-014:

- TKT-015 and TKT-016

Can run in parallel after TKT-006/TKT-007:

- TKT-008 and TKT-012

Should remain sequential:

- TKT-007 before TKT-008
- TKT-006 before TKT-011
- TKT-002 before TKT-013
- TKT-017 before TKT-015
- TKT-015 and TKT-016 before TKT-009
- TKT-020 before TKT-023 and TKT-024
- TKT-025 before TKT-026 and TKT-027

## Definition of Done For The Epic

- Default UI paths never fetch full dataset payloads.
- Large execution variables are persisted as DatasetRef, not inline arrays.
- Dataset retrieval is chunk-indexed and offset-indexed (no linear deep-page scans).
- Streaming-friendly nodes process in batches with bounded memory.
- Pipeline uses explicit backpressure and anti-buffering guardrails.
- Heavy nodes have explicit sort/join specs and fail-safe limits.
- Sort comparator behavior is stable and consistent across all stages.
- Join planner uses cardinality estimation to avoid high-skew failures.
- Global resource budgets are enforced across whole workflow runs.
- Dataset writes are crash-safe via temp + commit lifecycle.
- Dataset lifecycle cleanup prevents unbounded disk growth.
- Queue/concurrency policy prevents multi-run contention collapse.
- Dataset schema preserves field types for downstream execution.
- 400 MB benchmark runs are reproducible and within acceptable latency.
