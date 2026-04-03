# Node Data Flow Architecture

Audience: senior engineers and performance-focused maintainers.

Last updated: 2026-04-03

## 1. Purpose and Scope

This document describes the current Node Data Flow architecture used for large CSV-centric workflows, with emphasis on:

- Correctness under high row counts
- Memory and disk safety boundaries
- Predictable failure modes
- Performance bottleneck attribution and optimization paths

In scope:

- Workflow runtime orchestration
- DatasetRef-based data plane
- Dataset storage and read/write lifecycle
- Streaming and heavy operators (sort/join/compare)
- API/UI retrieval model for large outputs
- Guardrails and observability

Out of scope:

- Credential subsystem internals
- Non data-intensive node business logic
- Distributed execution design (current runtime is single-worker process)

---

## 2. System Context and Plane Separation

The system is intentionally split into control plane and data plane responsibilities.

- Control plane:
  - Workflow graph definition (nodes/connections)
  - Execution lifecycle state (RUNNING/SUCCESS/FAILED)
  - Queueing and concurrency policy
  - Node status signaling to UI
- Data plane:
  - Row storage (chunked datasets on disk)
  - Dataset metadata (manifest + chunk index)
  - Row retrieval APIs (chunk/offset/page/stream)

High-level architecture:

```text
+---------------------+        +--------------------------+
| Editor / UI         |        | tRPC execution APIs      |
| - Progress panel    |<------>| - summary / raw / data   |
| - Dataset viewer    |        +-------------+------------+
+----------+----------+                      |
           |                                 v
           |                        +--------+---------+
           |                        | Inngest runner    |
           |                        | - topo execution  |
           |                        | - node dispatch   |
           |                        | - queue lease     |
           |                        +--------+---------+
           |                                 |
           |                                 v
           |                        +--------+---------+
           |                        | Dataset service   |
           |                        | - adapter facade  |
           |                        | - page/chunk read |
           |                        +--------+---------+
           |                                 |
           |                                 v
           |                        +--------+---------+
           |                        | Storage adapter   |
           |                        | (JSONL default)   |
           |                        +--------+---------+
           |                                 |
           |                                 v
           |                        +--------+---------+
           +----------------------->| Filesystem        |
                                    | .autopilot-data/* |
                                    +-------------------+
```

Key design boundary:

- Workflow context carries handles (DatasetRef) for large data.
- Row payloads are persisted and fetched through dataset APIs.

---

## 3. Execution Runtime Model

### 3.1 Scheduling and ordering

Runtime order:

1. Load workflow graph
2. Topologically sort nodes
3. Resolve reachable subgraph from active trigger type
4. Acquire queue slot for profile (heavy or standard)
5. Execute nodes sequentially in topological order
6. Persist summary output + metrics + resource budget
7. Release queue lease and clear budgets

Execution is currently single-threaded at graph step level (no branch parallelism).

### 3.2 Fusion fast path

A linear chain can be fused when strict structure and variable alignment hold:

- csv-parse -> csv-filter -> csv-aggregate
- Single in/out edges for middle nodes
- Source variable bindings exactly aligned

Fusion removes intermediate dataset materialization for parse/filter outputs and writes only final aggregate dataset.

Fusion planner constraints are intentionally strict to preserve semantic safety.

### 3.3 Runner-level output leak guard

After node execution and before context merge, runner recursively scans output object samples to detect oversized in-memory arrays. If found, execution fails fast with path details.

This catches accidental return of raw arrays even if nested in object structures.

---

## 4. Node Data Contracts and Context Semantics

### 4.1 DatasetRef contract

Large row sets are represented as:

```json
{
  "kind": "dataset",
  "datasetId": "...",
  "executionId": "...",
  "variableName": "...",
  "storage": "jsonl|object-storage|columnar",
  "manifestVersion": 1,
  "rowCount": 383268,
  "chunkCount": 384,
  "byteSize": 123456789,
  "schema": { "field": { "type": "number", "nullable": true } }
}
```

### 4.2 Context persistence rules

When a node returns rows inline:

- If row count <= MAX_INLINE_DATASET_ROWS: keep inline
- If row count > MAX_INLINE_DATASET_ROWS: persist to dataset storage and replace with DatasetRef

Output persistence path:

- Context is normalized per key via persistContextValueIfNeeded
- Final execution output stores summarized values for large inline datasets:
  - kind: dataset-summary
  - rowCount
  - schema
  - preview rows

### 4.3 Logical rows vs in-memory rows

A critical correctness rule now enforced:

- Logical row count (for metrics/reporting) may include DatasetRef.rowCount
- In-memory guardrails apply only to materialized arrays/records in process memory

This prevents false positives where large persisted datasets were incorrectly treated as in-memory arrays.

---

## 5. Dataset Storage Architecture

### 5.1 Adapter facade

DatasetService abstracts storage through DatasetStorageAdapter.

Current adapters:

- jsonl: production default
- object-storage: currently delegated to JSONL adapter semantics (storage tag differs)
- columnar: prototype mode wrapper over JSONL adapter (feature-flag gated)

### 5.2 Write lifecycle and atomicity

Write flow uses temp directory and atomic commit:

```text
beginWrite -> <execution>/<dataset>.tmp
appendRows -> chunk-000000.jsonl, chunk-000001.jsonl, ...
write manifest.json in temp
commit -> rename .tmp to final dataset directory
```

Properties:

- No partial dataset exposure before commit
- Stale temp directories cleaned at startup
- Disk budget reservations and releases are explicit at chunk write boundaries

### 5.3 Manifest and chunk index

Manifest includes:

- dataset identity and storage format
- rowCount/chunkCount/byteSize
- optional schema
- chunk metadata list:
  - rowStart/rowEnd/cumulativeRowCount
  - byteSize
  - sparse offset anchors

Chunk index normalization ensures deterministic ordering and cumulative boundaries.

### 5.4 Sparse offset index

Each chunk stores row->byte anchors at fixed stride. Reads use nearest anchor + forward scan.

Benefit:

- Deep offset reads avoid scanning from file start
- Improves in-chunk page reads for high offsets

Tradeoff:

- Slight metadata overhead per chunk
- More complexity in read path

---

## 6. Streaming and Pipeline Engine

Core utilities:

- toAsyncIterable: normalizes sync/async sources
- batchAsyncIterator: bounded batching with cancellation
- mapBatches/mapBatchesStream/reduceBatches: structured streaming helpers

Backpressure model:

- Producer yields batches
- Consumer awaits each batch processing before next pull
- Pipeline memory reservation/release wraps batch lifetime

Guardrails:

- Max buffered batches
- Max buffered rows
- Max pipeline memory bytes (global execution budget)

Pseudocode:

```text
for batch in batchAsyncIterator(source, batchSize):
  reservePipelineMemory(estimate(batch))
  try:
    out = mapOrReduce(batch)
    assertBufferGuards()
    emit(out)
  finally:
    releasePipelineMemory(estimate(batch))
```

This keeps pressure propagation explicit and prevents silent collect-all patterns.

---

## 7. CSV Node Execution Strategies

### 7.1 Parse

- Input sources: string, buffer, URL, content fields
- Delimiter detection with fallback
- TXT single-column fallback
- Schema inferred from sample rows then applied to stream
- Persists directly to dataset chunks

### 7.2 Filter

- Fast path for small inline datasets
- Stream path for DatasetRef or large source
- Emits DatasetRef with summary (matched/filtered counts)

### 7.3 Aggregate

- Group-by map accumulation in memory
- Stream input rows
- Supports count/sum/avg/min/max
- Emits aggregated dataset + operation summary

### 7.4 Column stats

- Stream row scan over selected fields
- Tracks null/non-null/numeric/frequency/unique counts
- Emits dataset of column statistics + summary map

Design note:

- Aggregation and column stats still maintain accumulator maps in memory; cardinality of groups or unique values can dominate memory for wide/high-cardinality inputs.

---

## 8. Heavy Operations: Sort, Join, Compare

### 8.1 Sort: external merge sort

Two strategy modes:

- In-memory stable sort for small inline source
- External sort for larger datasets

External sort phases:

1. Run generation (sorted temporary runs)
2. K-way merge with bounded fan-in
3. Stream merged rows to dataset persistence

Pseudocode:

```text
runs = []
for row in source:
  append row to currentRun until runTargetBytes
  sort currentRun stably by comparator
  write run file
while len(runs) > 1:
  merge groups of fanIn runs into new runs
  delete consumed runs
stream final run rows -> datasetService.persistRowsFromStream
```

External-sort tradeoff:

- Larger fan-in reduces merge levels but shrinks per-run buffers
- Too-large fan-in can hurt throughput due to random read seek overhead

### 8.2 Join: planned hash join with estimator

Join pipeline:

1. Validate key shape
2. Estimate key cardinality/skew from samples
3. Plan strategy and build side
4. Execute guarded hash join

Planner safeguards:

- Reject large-large joins unless explicit allowPartitionedLargeJoin
- Reject if min side exceeds safe build threshold
- Reject high-risk fanout/skew cases

Hash join behavior:

- Materialize build side in memory
- Probe stream against hash index
- Supports inner/left/right/full/left_exclusive/right_exclusive
- Caps matches per key to avoid explosive fanout

### 8.3 Compare

- Keyed compare mode (hash index on smaller side)
- Unkeyed compare mode by stable row serialization
- Hard upper bound for index side
- Diff sample truncation to bounded number of examples

---

## 9. API and UI Data Access Path

### 9.1 API surface

tRPC execution endpoints separate summary and raw flows:

- getOne: execution summary + queue state
- getOneRawOutput: explicit raw output fetch
- getDatasetMeta
- getDatasetChunk
- getDatasetRows
- getDatasetPage
- downloadDataset

Input bounds enforce safe page/limit ranges (up to 5000 per request by default).

### 9.2 Dataset page resolution

DatasetService.getDatasetRowsByPage:

1. Load manifest
2. Resolve page -> chunk window via cumulative chunk index
3. Iterate chunk reads until pageSize rows collected

Pseudocode:

```text
window = resolveChunkWindowByPage(chunks, page, pageSize)
rows = []
while remaining > 0 and chunkIndex < chunkCount:
  part = readRows(chunkIndex, offset, remaining)
  rows += part
  remaining -= len(part)
  chunkIndex += 1
  offset = 0
return rows + window metadata
```

### 9.3 UI consumption

Progress and detail views:

- Load summary eagerly
- Load raw output only on user action
- Detect dataset-like variables and use dataset viewer
- Render paginated rows with chunk hint and page-size controls

This keeps the default UI path responsive for large outputs.

---

## 10. Guardrails and Resource Governance

### 10.1 Core limits

Current defaults:

| Domain                      | Key                             | Default |
| --------------------------- | ------------------------------- | ------: |
| Runtime memory              | MAX_IN_MEMORY_ROWS              | 200,000 |
| Inline promotion            | MAX_INLINE_DATASET_ROWS         |   5,000 |
| Output payload              | MAX_EXECUTION_OUTPUT_BYTES      |    2 MB |
| Chunking                    | DEFAULT_CHUNK_SIZE_ROWS         |   1,000 |
| Chunk read page             | MAX_CHUNK_READ_ROWS             |   5,000 |
| Pipeline rows buffered      | MAX_PIPELINE_BUFFERED_ROWS      | 200,000 |
| Pipeline memory             | MAX_PIPELINE_MEMORY_BYTES       |  256 MB |
| Disk budget                 | MAX_TOTAL_DISK_USAGE_BYTES      |    4 GB |
| Temp files                  | MAX_TOTAL_TEMP_FILES            |     400 |
| Heavy execution concurrency | MAX_CONCURRENT_HEAVY_EXECUTIONS |       1 |

### 10.2 Queueing policy

- Workflows classified by node type into heavy or standard profile
- Heavy runs acquire queue slot with polling and timeout
- Queue state persisted in filesystem JSON for visibility

### 10.3 Safety behavior

Guardrails fail fast with user-readable errors when:

- In-memory arrays exceed threshold
- Buffering limits exceeded
- Global disk/temp/pipeline memory budgets exceeded
- Join planner rejects unsafe shapes
- Compare index size exceeds safe threshold

---

## 11. Observability and Performance Attribution

### 11.1 Per-node metrics

Captured per node:

- durationMs
- rowsIn / rowsOut
- bytesIn / bytesOut
- cpuTimeMs
- gcPauseMs
- diskIOMs (derived)
- memory RSS start/end/peak

### 11.2 Execution-level performance summary

Runner now persists execution aggregate summary:

- totals across nodes
- bottleneck share (cpu/disk/gc) + dominant classifier
- by-node-type aggregates
- top slow nodes

Persisted output sections:

- \_\_executionMetrics
- \_\_executionPerformance
- \_\_resourceBudget

If output exceeds max size, payload is truncated but performance summary and metrics remain persisted.

### 11.3 Benchmark harness

scripts/bench/execution-400mb-benchmark.ts profiles 100/250/400MB with:

- write/read durations
- CPU and GC pauses
- derived diskIOMs
- peak RSS
- chunk count

This is the baseline for regression detection.

---

## 12. Failure Modes and Recovery

### 12.1 Common failure classes

- Input contract failures:
  - Missing source variable
  - Missing required fields (groupBy, sortField, join keys)
- Resource failures:
  - Memory/disk/temp budget exceeded
  - queue wait timeout
- Algorithmic safety failures:
  - join skew/fanout rejection
  - compare index side too large
  - oversized in-memory node output leak
- Data parse failures:
  - invalid JSONL line in chunk
  - malformed CSV row handling errors

### 12.2 Recovery guarantees

- Dataset writes are atomic at directory rename boundary
- Aborted writes clean temp directories
- Startup cleanup removes stale temp transactions
- Dataset cleanup policy removes stale/orphan execution datasets by TTL

### 12.3 Data-loss and integrity considerations

- JSONL chunk files include row order and row boundaries
- Manifest versioning supports forward format evolution
- Current design does not yet enforce cryptographic checksum verification in read path

---

## 13. Tradeoffs, Limitations, and Technical Debt

### 13.1 Strategic tradeoffs

| Decision                     | Benefit                                   | Cost                                                           |
| ---------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| Filesystem JSONL default     | Simple, transparent, low integration cost | Higher CPU/IO than binary columnar formats                     |
| DatasetRef in context        | Bounded execution payloads                | More indirection and API complexity                            |
| Strict join planner rejects  | Protects worker from blowups              | Some large joins require explicit user override or pre-shaping |
| Sequential node runtime      | Simpler semantics and debugging           | No branch-level parallel speedup                               |
| Fusion only for strict chain | Safe optimization with low risk           | Limited optimization coverage                                  |

### 13.2 Current limitations

- No distributed or multi-worker partitioned join/sort execution
- Hash join still materializes build side in memory (bounded but local)
- Aggregation and unique-frequency maps can still be memory-heavy for extreme cardinality
- Queue state uses filesystem JSON, not transactional shared store
- Prisma dataset models exist but are not active in current runtime path

### 13.3 Known architecture divergence

Prisma schema includes ExecutionDataset\* models, but runtime dataset metadata and chunks are currently managed in filesystem manifests and directories. This is an intentional/temporary divergence that should be resolved by either:

- fully adopting DB metadata indexing, or
- removing unused DB models to prevent architectural ambiguity

---

## 14. Optimization Roadmap and Experiments

This section is ordered by impact-to-effort for current architecture.

### 14.1 Immediate (high ROI)

1. Expand fusion patterns

- Add parse->filter->sort and parse->filter->column-stats where safe
- Keep strict structural checks

Expected impact:

- Reduced intermediate dataset writes
- Lower diskIOMs and latency in linear pipelines

2. Adaptive external sort tuning

- Tune runTargetBytes and mergeFanIn using measured device profile
- Goal: maximize sequential throughput while limiting random seek amplification

Expected impact:

- Faster sort wall-clock on HDD/NAS-like media

3. Join prefilter and key normalization hints

- Add optional pre-aggregation/dedupe hints before join
- Surface estimator findings in UI (risk + expected fanout)

Expected impact:

- Fewer rejected runs and safer user guidance

### 14.2 Medium-term

4. Partitioned hash join execution mode

- Implement grace-style partitioning for large-large joins
- Spill partitions and process partition pairs incrementally

Expected impact:

- Converts current reject-only large-large regime into bounded executable path

5. Columnar adapter real implementation

- Keep DatasetRef/API contract stable
- Introduce true columnar storage backend with typed vectors

Expected impact:

- Improved scan and aggregation performance
- Reduced storage and IO footprint

6. Better metric fidelity

- Distinguish read IO vs write IO
- Track adapter-level throughput and per-stage bytes/sec
- Add queue wait duration and lease hold time to execution summary

Expected impact:

- Faster root-cause identification for regressions

### 14.3 Risk register for roadmap

| Risk                                        | Probability | Impact | Mitigation                                                            |
| ------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------- |
| More fusion paths break semantics           | Medium      | High   | Keep conservative eligibility + golden test fixtures                  |
| Partitioned join complexity introduces bugs | Medium      | High   | Feature-flag rollout, deterministic fixture suite, fail-safe fallback |
| Columnar migration parity issues            | Medium      | Medium | Shadow benchmarks and output checksums before default switch          |
| Metric overhead affects hot path            | Low         | Medium | Sampling and optional high-resolution mode only in debug              |

### 14.4 Recommended performance test matrix

- Single heavy run per operator type:
  - parse, filter, aggregate, sort, join, compare
- Mixed chains:
  - parse->filter->aggregate
  - parse->sort->join
  - parse->filter->column-stats
- Contention scenarios:
  - 2-3 heavy workflows with queue cap at 1
- Storage scenarios:
  - JSONL baseline
  - object-storage adapter mode
  - columnar prototype mode

For each scenario collect:

- total duration
- \_\_executionPerformance totals and bottleneck shares
- \_\_resourceBudget peak values
- row count parity and output checksum parity

---

## Appendix A: End-to-End Sequence (Current)

```text
UI Run -> executeWorkflow event
  -> runner loads workflow graph and sorts nodes
  -> classifyExecutionProfile and acquire queue lease
  -> for each node in topo order:
       - optional fusion chain dispatch
       - execute node
       - assertNoLargeArrayOutput
       - capture metric
       - persistContextValueIfNeeded (inline->DatasetRef promotion)
       - merge into context
  -> buildExecutionOutputSummary
  -> summarizeNodeExecutionMetrics
  -> persist execution output (+ metrics/perf/resource budget)
  -> release queue lease and clear budget
```

## Appendix B: Decision Notes From External References

- External merge sort fan-in and pass count require balancing transfer efficiency against seek amplification; a single giant fan-in is not always fastest on spinning or seek-limited storage.
- Hash join is memory-sensitive to build side size and key skew; planning build side and pre-checking cardinality/skew reduces catastrophic fanout paths.

These align with current implementation choices:

- bounded fan-in external sort + temp run lifecycle
- join estimator + planner gate + per-key match cap
