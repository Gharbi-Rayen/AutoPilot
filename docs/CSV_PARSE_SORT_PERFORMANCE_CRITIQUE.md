# CSV Parse + CSV Sort Performance Diagnosis and Critique

## Scope

This report analyzes why CSV Parse can take around 2 minutes and CSV Sort can take around 4 minutes (and appear stuck), based on current code paths for:

- Parse node executor + parse worker
- Sort node executor + sort worker
- Shared external sort and dataset persistence behavior

This is a static code diagnosis. No production trace timeline was provided for this run.

---

## Executive Summary

### Most likely reasons for long runtime

1. Parse is not a single-pass pipeline: it probes/samples first, then parses again for full processing.
2. Sort on parsed data almost always goes through external sort (temp run files + merge), which is inherently disk-heavy.
3. External sort serializes/deserializes rows repeatedly (`JSON.stringify`/`JSON.parse`) across run and merge phases.
4. Dataset and temp files default to project-relative storage, and this workspace is under OneDrive, which can amplify IO latency.

### Most likely reasons it appears stuck

1. Executors wait only for `*.complete` events, not `*.failed` events. A failed worker can leave the node in loading state until timeout.
2. If using `mprocs.yaml`, worker processes are not started there, so queued jobs may never be consumed. (not using that)

---

## Parse Node and Worker Logic

### Parse executor flow

File: `src/features/executions/components/csv-parse/executor.ts`

- Sets node status to loading.
- Enqueues `csv-parse` job.
- Waits for `csv/parse.complete` using executionId match.
- Returns dataset metadata to context.

Snippet:

```ts
const parseResultPromise = step.waitForEvent("wait-for-csv-parse", {
  event: "csv/parse.complete",
  match: "data.executionId",
  timeout: "30m",
});

await step.run("enqueue-csv-parse", async () => {
  // ... queue.add("parse:${executionId}", payload)
});

const parseResult = await parseResultPromise;
```

### Parse worker flow

File: `src/workers/csv-parse.worker.ts`

Current logic does these stages:

1. Probe pass:
   - Detect delimiter
   - Read sample rows
   - Infer schema
2. Full parse pass:
   - Parse file from `from_line = probeRows.length + 1`
   - Cast/coerce values per schema
   - Append to dataset in chunks
3. Send `csv/parse.complete`

Snippet (two-phase behavior):

```ts
const delimiter = job.data.delimiter || (await detectDelimiter(fileBlobPath));
const probeRows: string[][] = [];

// probe read...

const schema = inferDatasetSchema(rawRecords);

// full read starts after probe rows
const csvParser = parse({
  delimiter,
  columns: hasHeader,
  from_line: probeRows.length + 1,
  cast: (value, context) => {
    // per-cell coercion
  },
});
```

### Parse critique

- The design is robust, but not minimal IO: probe + full parse means additional read overhead.
- `cast` coercion on every value adds CPU cost for wide/high-row files.
- Chunked persistence is safe, but can bottleneck on slow filesystem.
- Executor does not consume `csv/parse.failed`; it only waits for complete.

---

## Sort Node and Worker Logic

### Sort executor flow

File: `src/features/executions/components/csv-sort/executor.ts`

- Resolves source variable.
- Enqueues sort job.
- Waits for `csv/sort.complete` by executionId.
- Writes returned datasetRef + summary to output variable.

Snippet:

```ts
const completionPromise = step.waitForEvent("wait-for-csv-sort", {
  event: "csv/sort.complete",
  match: "data.executionId",
  timeout: "60m",
});

await step.run("enqueue-csv-sort", async () => {
  // ... queue.add("sort", payload)
});

const completion = await completionPromise;
```

### Sort worker flow

File: `src/workers/csv-sort.worker.ts`

- Builds comparator.
- Uses in-memory fast path only when source is inline rows and below threshold.
- Otherwise uses external sort (`externalSortRows`) with temp run files, merge passes, then persists sorted dataset.

Snippet (fast-path gate):

```ts
const useFastPath =
  !isDatasetRef(sourceRef) &&
  inlineRows.length > 0 &&
  inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;
```

Snippet (external sort path):

```ts
const externalSort = await externalSortRows({
  source: sourceWithProgress,
  compareRows,
  tempManager,
  runTargetBytes: DATASET_STORAGE.EXTERNAL_SORT_RUN_TARGET_BYTES,
  mergeFanIn: DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN,
});

const manifest = await datasetService.persistRowsFromStream({
  rows: sortedWithProgress,
  // ...
});
```

### External sort implementation characteristics

File: `src/features/executions/server/datasets/external-sort.ts`

- Writes each run line as JSON (`JSON.stringify(entry)`).
- Reads runs line-by-line and parses JSON (`JSON.parse(line)`).
- Merges runs and writes merged JSON lines.
- Reads final run and writes final dataset chunks.

Snippet:

```ts
await writeLine(stream, `${JSON.stringify(entry)}\n`);

const parsed = JSON.parse(line) as SortableEntry<T>;
```

### Sort critique

- External sort is correct and scalable, but expensive in wall-clock time because it is multi-pass disk IO.
- Parse output is typically a DatasetRef, so the fast path is often bypassed.
- For medium datasets, external sort may be overkill compared with bounded in-memory sort fallback.
- Executor does not consume `csv/sort.failed`; it only waits for complete.

---

## Why It Can Look Stuck Even When It Is Not

### 1) Waiting only for complete events

Parse and sort executors currently wait only for success events:

- Parse waits for `csv/parse.complete`
- Sort waits for `csv/sort.complete`

If worker fails, executor can remain in loading state until timeout unless failure is explicitly consumed and thrown.

### 2) Worker processes may not be running in some launch modes

File: `mprocs.yaml`

Current `mprocs.yaml` launches:

- next
- inngest
- redis

It does not launch parse/sort/join/sequence workers. In that mode, jobs can queue without being consumed.

Snippet:

```yaml
procs:
  next:
    cmd: ["npm", "run", "dev"]
  inngest:
    cmd: ["npm", "run", "inngest:dev"]
  redis:
    cmd: ["docker", "run", "--rm", "-p", "6379:6379", "redis:7-alpine"]
```

---

## Configuration Factors That Influence Runtime

File: `src/config/constants.ts`

Current defaults:

- `DATASET_CHUNK_SIZE_ROWS = 25,000`
- `DATASET_MAX_INLINE_ROWS = 5,000`
- `DATASET_EXTERNAL_SORT_RUN_TARGET_BYTES = 50MB`
- `DATASET_EXTERNAL_SORT_MAX_FAN_IN = 8`

These defaults are reasonable for safety, but can increase elapsed time on slower disks.

---

## Environment Critique (Important)

Dataset root defaults to a project-relative path:

- `DATASET_STORAGE_ROOT` default: `.autopilot-data/execution-datasets`

In this workspace, project path is under OneDrive. Heavy read/write temp and dataset operations under a synced folder can significantly increase parse and sort time.

---

## Prioritized Recommendations

### P0 - Prevent stuck state

1. In parse/sort executors, wait for both complete and failed events, and fail fast on failed event.
2. Narrow event matching (for example by executionId + datasetId or variableName) to avoid ambiguous event capture in multi-node workflows.

### P0 - Ensure workers always run in dev/prod process model

1. Add parse/sort/join/sequence workers to `mprocs.yaml` if that is a primary launch path.
2. Add startup health checks that verify queue workers are online before execution begins.

### P1 - Reduce sort wall-clock time

1. Add a bounded in-memory path for small DatasetRef sources (for example when rowCount is below configurable threshold).
2. Consider reducing serialization overhead in external sort (more compact row encoding or binary format).

### P1 - Reduce parse wall-clock time

1. Move toward single-pass parse where feasible (schema/sample inference during early stream + continue full stream).
2. Add explicit stage timing metrics (`probe_ms`, `parse_ms`, `persist_ms`, `merge_ms`) to logs and UI.

### P2 - Storage path tuning

1. Set `DATASET_STORAGE_ROOT` to a non-synced local SSD path outside OneDrive.
2. Benchmark with different run target/chunk sizes for your median file size profile.

---

## Bottom Line

The observed 2-minute parse and 4-minute sort are plausible with current architecture on disk-heavy datasets, especially under synced storage. The "stuck" behavior is most strongly explained by executor wait logic that only listens for success events (and by launch modes that may omit worker processes).

---

## Deep Diagnosis Addendum (2026-04-08)

This addendum addresses four requested CSV sort issues using current workspace code and runtime path checks.

### Issue 1 - Fast-path gate logic for DatasetRef

#### Root cause

- The old gate (`!isDatasetRef(sourceRef)`) is no longer the current code path. The worker now includes a DatasetRef fast path.
- However, the threshold is hardcoded (`5_000_000`) and not configurable through env/constants.
- There is no explicit decision telemetry (no single log/progress field that explains _why_ a job chose external sort), so regressions can look like logic bugs.

#### Affected files and references

- `src/workers/csv-sort.worker.ts:27`
- `src/workers/csv-sort.worker.ts:28`
- `src/workers/csv-sort.worker.ts:154`
- `src/workers/csv-sort.worker.ts:155`
- `src/workers/csv-sort.worker.ts:156`
- `src/features/executions/components/csv-sort/executor.ts:87`
- `src/features/executions/components/csv-sort/executor.ts:122`

#### Concrete fix

1. Move DatasetRef in-memory threshold to config (env-backed), e.g. `DATASET_SORT_DATASETREF_IN_MEMORY_MAX_ROWS`.
2. Compute the fast-path row count from DatasetRef manifest metadata (`sourceRef.rowCount`) at decision time, not only from queued payload.
3. Emit a structured decision event before sorting:
   - `strategy_decision = in-memory|external`
   - `reason = datasetref_below_threshold | inline_below_threshold | over_threshold`
   - `sourceRows`, `threshold`, `isDatasetRef`
4. Keep a secondary byte-size guard (manifest byte size) so huge wide rows do not blow memory even when row count is small.

### Issue 2 - OneDrive ENOENT during external sort

#### Root cause

- `DATASET_STORAGE_ROOT` is unset, so dataset root resolves under workspace CWD.
- Workspace CWD is inside OneDrive, so external sort temp files are under a synced folder.
- External sort temp files are created under `_tmp/external-sort/<scope>` beneath dataset root.
- ENOENT in external sort is not specially handled; it bubbles up and fails the job.

#### Affected paths and references

- Runtime resolved root (observed):
  - `C:\Users\gghar\OneDrive\Bureau\AutoPilot\autopilot\.autopilot-data\execution-datasets`
  - `C:\Users\gghar\OneDrive\Bureau\AutoPilot\autopilot\.autopilot-data\execution-datasets\_tmp\external-sort`
- Code references:
  - `src/config/constants.ts:49`
  - `src/features/executions/server/datasets/paths.ts:6`
  - `src/features/executions/server/datasets/temp-file-manager.ts:22`
  - `src/workers/csv-sort.worker.ts:277`
  - `src/features/executions/server/datasets/external-sort.ts:79`
  - `src/features/executions/server/datasets/external-sort.ts:319`
  - `src/workers/csv-sort.worker.ts:411`

#### ENOENT behavior in worker

- External sort read failure (`createReadStream` path missing) throws.
- `externalSortRows` catches, runs temp cleanup, then rethrows.
- Worker does not implement ENOENT-specific recovery in `sortRows`; failure goes to BullMQ `failed` flow.
- Retry behavior depends on job attempts. Current enqueue call does not set attempts explicitly.

#### Concrete fix (beyond only setting env)

1. Set `DATASET_STORAGE_ROOT` to a non-synced local path (for example `C:\autopilotdata`).
2. Add a dedicated temp-root setting for external sort (for example `DATASET_EXTERNAL_SORT_TEMP_ROOT`) and keep it off cloud-synced folders.
3. Add startup guardrail: if resolved dataset/temp root contains `\\OneDrive\\`, fail fast with a clear configuration error (allow override only via explicit flag).
4. Add explicit ENOENT classification in sort worker:
   - mark as storage-path failure
   - emit terminal failure event immediately with actionable message
   - avoid ambiguous long waits.

### Issue 3 - Silent failure / no output visibility

#### Root cause diagnosis

- (a) Executor waits only on `csv/sort.complete`, not directly on `csv/sort.failed`.
  - It can still fail correctly _if_ worker emits `csv/sort.complete` with error payload.
  - If completion event is missed/not emitted, executor waits until timeout.
- (b) Silent partial/empty success is currently possible in multi-run merge due format mismatch:
  - reader expects `seq<TAB>json` lines
  - merge writes plain JSON entry lines
  - malformed lines are skipped without throwing
- (c) UI binding is not the primary blocker for this case.
  - Sort output variable lookup path is present.
  - Main visibility loss is backend: failed executions do not persist output summary, and failure cleanup removes execution dataset directory.

#### Affected files and references

- Executor wait and timeout:
  - `src/features/executions/components/csv-sort/executor.ts:101`
  - `src/features/executions/components/csv-sort/executor.ts:102`
  - `src/features/executions/components/csv-sort/executor.ts:146`
- Worker failure event bridging:
  - `src/workers/csv-sort.worker.ts:424`
  - `src/workers/csv-sort.worker.ts:429`
- Failure output persistence gap:
  - `src/inngest/functions.ts:627`
  - `src/inngest/functions.ts:630`
  - `src/inngest/functions.ts:658`
  - `src/inngest/functions.ts:671`
- UI output binding path (present):
  - `src/features/editor/components/workflow-progress-panel.tsx:302`
  - `src/features/editor/components/workflow-progress-panel.tsx:929`
  - `src/features/editor/components/workflow-progress-panel.tsx:947`

#### Concrete fix

1. In executor, race/wait for both `csv/sort.complete` and `csv/sort.failed`; fail immediately on failed event.
2. Persist a failure output summary on FAILED path (including per-node error and partial context metadata).
3. Do not delete execution dataset directory immediately in the same fail block; delay cleanup until worker terminal acknowledgment or TTL cleanup.
4. Add explicit `executionId + datasetId` event matching (not executionId only) to prevent cross-node event ambiguity.

### Issue 4 - Sort correctness and partial output safety

#### Root cause

- External sort merge serialization is inconsistent:
  - run writer outputs `seq<TAB>row`
  - merge writer outputs `JSON.stringify(selectedEntry)`
  - run reader silently skips lines without a tab separator.
- No integrity assertion that output row count equals input row count.
- No post-sort correctness validation (sortedness/coverage checks).

#### Affected files and references

- `src/features/executions/server/datasets/external-sort.ts:58`
- `src/features/executions/server/datasets/external-sort.ts:92`
- `src/features/executions/server/datasets/external-sort.ts:93`
- `src/features/executions/server/datasets/external-sort.ts:156`
- `src/features/executions/server/datasets/dataset-service.ts:176`
- `src/features/executions/server/datasets/dataset-service.ts:198`
- `src/features/executions/server/datasets/jsonl-storage-adapter.ts:301`
- `src/features/executions/server/datasets/write-transaction.ts:44`

#### Atomicity vs partial writes

- Final dataset visibility is atomic at commit (`rename(tempDirectory, finalDirectory)`).
- During write, chunks are incremental in temp directory; on failure, abort removes temp directory.
- So the storage layer avoids exposing half-written final datasets, but it does not guarantee semantic correctness of the rows that were successfully committed.

#### Concrete fix

1. Fix merge writer format to match run reader (`seq<TAB>json-row`), or centralize line serialization/deserialization in one shared function.
2. Enforce invariants before commit in sort worker:
   - `manifest.rowCount === sourceRows`
   - optional sampled order validation for monotonic comparator output.
3. If invariant fails, throw unrecoverable error and abort write transaction.
4. Add metrics to completion payload:
   - `rowsScanned`, `rowsWritten`, `runCount`, `mergePasses`, `integrityCheckPassed`.

## Updated Conclusion

- The originally reported fast-path gate bug has been partially addressed in current code, but it still lacks configurable thresholds and robust decision observability.
- OneDrive-backed storage remains an active failure amplifier for external sort temp IO and must be treated as a hard configuration problem, not only a performance tuning issue.
- Output invisibility is primarily caused by failure-path output persistence/cleanup behavior, with a secondary risk from event-handling assumptions.
- External sort correctness currently lacks critical integrity checks, and merge serialization mismatch is a concrete data-loss/corruption risk in multi-run scenarios.

---

## Contradiction Resolution (Direct Answers)

### 1) 3000-row / 11-minute contradiction: exact fast-path logic and failure conditions

Current DatasetRef fast-path decision in worker is:

```ts
const useFastPath =
  (isDatasetRef(sourceRef) && sourceRows <= datasetRefFastPathThreshold) ||
  (!isDatasetRef(sourceRef) &&
    inlineRows.length > 0 &&
    inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS);
```

Relevant references:

- `src/workers/csv-sort.worker.ts:154`
- `src/workers/csv-sort.worker.ts:160`
- `src/workers/csv-sort.worker.ts:27`
- `src/workers/csv-sort.worker.ts:28`
- `src/features/executions/components/csv-sort/executor.ts:87`
- `src/features/executions/components/csv-sort/executor.ts:122`

Trace for a true 3000-row DatasetRef under current code:

1. Executor computes `sourceRows` from `source.rowCount`.
2. Executor enqueues that `sourceRows` in sort job payload.
3. Worker checks `isDatasetRef(sourceRef)` and `sourceRows <= 5,000,000`.
4. If both are true, worker uses in-memory branch.

Runtime evidence from current queue confirms small jobs use in-memory strategy:

- Completed job id `4`: `sourceRows=2000`, `strategy=in-memory`, `rowCount=2000`, `attempts=0`, `attemptsMade=1`.

Therefore, the 3000-row / 11-minute run is contradictory with current code unless one of these conditions failed at runtime:

- `isDatasetRef(sourceRef)` was false (malformed/non-DatasetRef payload), or
- `sourceRows` in queued payload was not actually 3000 (wrong/stale source variable metadata), or
- the running sort worker process was older than current file contents.

### 2) Row-drop estimate for serialization mismatch in a 3000-row single-merge-pass sort

Mismatch path:

- Reader expects `seq<TAB>json` and silently skips lines without tab.
  - `src/features/executions/server/datasets/external-sort.ts:92`
  - `src/features/executions/server/datasets/external-sort.ts:93`
- Merge writer outputs plain `JSON.stringify(selectedEntry)`.
  - `src/features/executions/server/datasets/external-sort.ts:156`

If a 3000-row run performs at least one merge pass (`group.length > 1` in merge), expected silent drop is effectively all merged rows:

- Estimated dropped rows: about 3000 / 3000 (100%).
- Result shape: likely empty final output, not partially correct.

Important nuance for your actual 3000-row, 144KB file under default run target 50MB:

- It should normally produce one initial run (no merge pass), so this specific mismatch may not be triggered in that specific run.
- If no merge pass occurs, this mismatch is not the cause of that run's slowness.

### 3) ENOENT handling on 21M-row sort and retry behavior

On ENOENT mid-merge/read:

1. Read path throws.
2. `externalSortRows` cleans temp files and rethrows.

- `src/features/executions/server/datasets/external-sort.ts:318`
- `src/features/executions/server/datasets/external-sort.ts:319`

3. Worker marks job failed; there is no checkpoint resume mechanism.

Actual recovery mode today:

- No resume from last completed run file.
- No partial checkpoint restart.
- No automatic retry from scratch for current sort enqueue.

Retry count configured on sort enqueue call:

- Enqueue call does not set attempts options.
  - `src/features/executions/components/csv-sort/executor.ts:122`
- Live queue evidence shows `attempts=0`, `attemptsMade=1` on failed 21M jobs.

So the practical behavior is abort with no automatic recovery.

### 4) Minimum changes to make 3000-row sort correct and visible in <5s

Only required correctness/routing changes, in order:

1. Fix external merge line format to match reader contract.

- File: `src/features/executions/server/datasets/external-sort.ts:156`
- Change: write merged lines as `seq<TAB>json-row`, not plain JSON object.

2. Make malformed run-line parsing fail hard (not silent skip) during sort.

- File: `src/features/executions/server/datasets/external-sort.ts:93`
- Change: replace silent `continue` on malformed lines with explicit throw to prevent silent data loss.

3. Make small DatasetRef routing deterministic at worker decision point.

- Files: `src/workers/csv-sort.worker.ts:154`, `src/workers/csv-sort.worker.ts:160`
- Change: keep DatasetRef fast path, but derive decision from validated DatasetRef row metadata before external sort path; hard-fail if metadata is invalid rather than silently routing external.

4. Make executor terminal wait unambiguous so output state is visible immediately on failure.

- File: `src/features/executions/components/csv-sort/executor.ts:101`
- Change: wait for both `csv/sort.complete` and `csv/sort.failed` and match on `executionId + datasetId` to avoid long waits and wrong-event capture.

This set is the minimum to guarantee:

- correct row retention/order contract,
- deterministic small-file in-memory routing,
- immediate visible terminal state in UI.
