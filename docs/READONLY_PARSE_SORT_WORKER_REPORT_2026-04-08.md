# Read-Only Parse and Sort Worker Report

Date: 2026-04-08
Scope: CSV Parse and CSV Sort execution flow, output visibility, cancellation behavior, queue behavior, worker lifecycle, and storage path behavior.

## Executive Summary

You have multiple independent issues that combine into the exact behavior you described:

1. Parse and sort outputs can appear missing even when some nodes already succeeded.
2. Sort cancellation is not end-to-end, so jobs continue after pause/cancel.
3. Heavy queue slot release is not guaranteed on pause/fail paths, so small jobs can wait a long time.
4. External sort has a run serialization mismatch that can produce empty/invalid merged runs.
5. Storage root is relative to process cwd, so data stays under workspace (currently OneDrive-backed by default).

This is fixable with a deterministic job contract:

- Node enqueues with correlation id.
- Worker processes data and persists output to C:/autopilotdata.
- Worker emits success/failure with same correlation id.
- Orchestrator stores partial outputs even on failure.
- Cancel triggers a cancellation token that workers actively honor.
- Slot release is guaranteed in finally paths.

## Current Structure (What Exists Today)

### 1) Orchestration Layer (Inngest)

- Workflow executor loops through nodes and invokes each node executor.
  - src/inngest/functions.ts
- Output summary is persisted only on SUCCESS path.
  - src/inngest/functions.ts:594
  - src/inngest/functions.ts:630
- Fail path updates execution status/error, but does not persist partial context output.
  - src/inngest/functions.ts:651
  - src/inngest/functions.ts:659

### 2) Queue/Concurrency Layer (Redis)

- Heavy execution slots are managed in Redis sets/lists.
  - src/features/executions/server/redis-queue.ts:26
  - src/features/executions/server/redis-queue.ts:72
  - src/features/executions/server/redis-queue.ts:146

### 3) Parse and Sort Executors

- Parse waits for csv/parse.complete matching only executionId.
  - src/features/executions/components/csv-parse/executor.ts:88
- Sort waits for csv/sort.complete matching only executionId.
  - src/features/executions/components/csv-sort/executor.ts:103

### 4) Parse and Sort Workers

- Parse worker sends complete/failed and includes executionId/datasetId/variableName.
  - src/workers/csv-parse.worker.ts:631
  - src/workers/csv-parse.worker.ts:680
- Sort worker sends complete/failed and includes executionId/datasetId/variableName.
  - src/workers/csv-sort.worker.ts:391
  - src/workers/csv-sort.worker.ts:429
- Parse has cancellation primitives, but wired mainly for preview parse API.
  - src/features/executions/server/csv-parse-cancel.ts
  - src/app/api/upload-file/preview-parse/route.ts:227
- Sort has no cancellation primitive.
  - no csv-sort cancel helper found in src

### 5) Storage Path

- Dataset storage root defaults to relative .autopilot-data/execution-datasets.
  - src/config/constants.ts:49
- Root is resolved from process.cwd().
  - src/features/executions/server/datasets/paths.ts:6

## Issue 1: Parse Shows No Output

### Root Cause A: Partial output is not persisted on failure

If parse succeeded but sort fails later, execution output may still be empty or missing parse variable because fail path does not save partial context.

Evidence:

- Success path persists output summary.
  - src/inngest/functions.ts:594
  - src/inngest/functions.ts:630
- Failure path only writes status/error.
  - src/inngest/functions.ts:651
  - src/inngest/functions.ts:659

Fix:

- In fail path, persist a truncated partial output summary from current context as output.
- Add explicit fields:
  - \_\_failedAtNode
  - \_\_partialOutput true
  - \_\_failureReason

### Root Cause B: Event correlation is too broad

Both parse and sort executors wait on event match data.executionId only. If multiple nodes of the same type exist in one workflow run, one node can consume another node event.

Evidence:

- Parse wait matcher.
  - src/features/executions/components/csv-parse/executor.ts:88
- Sort wait matcher.
  - src/features/executions/components/csv-sort/executor.ts:103

Fix:

- Correlate by executionId plus datasetId (or nodeId plus variableName).
- Include correlationId in queue payload and in completion event.
- Validate completion payload against expected datasetId before accepting.

### Root Cause C: Delimiter auto-detect mismatch with UI claim

UI says auto detect supports comma, semicolon, tab, pipe, colon, but worker detector checks only comma and pipe.

Evidence:

- UI text.
  - src/features/executions/components/csv-parse/dialog.tsx:125
  - src/features/executions/components/csv-parse/dialog.tsx:126
- Worker candidates.
  - src/workers/csv-parse.worker.ts:557

Fix:

- Align worker delimiter candidates with UI:
  - comma, semicolon, tab, pipe, colon
- Add detector scoring by consistency per sampled line, not just global delimiter count.

## Issue 2: Sort No Output, Very Slow, Keeps Running After Cancel, Inngest Loops

### Root Cause A: Pause does not cancel running sort worker

Pause updates DB status to FAILED and removes execution dataset directory, but does not cancel/stop active sort job in BullMQ.

Evidence:

- Pause path sets status FAILED.
  - src/features/workflows/server/routers.ts:142
- Pause path removes execution directory.
  - src/features/workflows/server/routers.ts:154

Fix:

- Add sort cancellation primitive like parse preview uses:
  - requestCsvSortCancellation
  - isCsvSortCancellationRequested
- On pause:
  - set cancellation token
  - stop waiting/delayed jobs immediately
  - mark active jobs cancel-requested
  - do not delete data directory until worker acknowledges stop or timeout cleanup path handles it

### Root Cause B: Cleanup races with active sort reads/writes

Deleting execution dataset directory while sort is still active causes ENOENT failures and unstable behavior.

Runtime evidence observed:

- Recent sort failure included missing chunk file under .autopilot-data path while processing.

Fix:

- Two-phase cancel:
  - Phase 1: signal cancel and wait worker terminal state
  - Phase 2: cleanup files after terminal ack
- Never hard-delete active execution storage path without worker stop confirmation.

### Root Cause C: Heavy slot release can be skipped when pause pre-sets FAILED

In fail handler, release logic is inside block that only runs if DB status is RUNNING. If status is already FAILED by pause, release may be skipped.

Evidence:

- Early return when status is not RUNNING.
  - src/inngest/functions.ts:651
- Slot release exists later in same block.
  - src/inngest/functions.ts:682

Fix:

- Move releaseExecutionSlot and clearExecutionBudget into a finally path that always executes for terminal states.
- Make release idempotent and safe to call repeatedly.

### Root Cause D: Stale heavy lock causes small-file long waits

Runtime snapshot in this session showed:

- heavyRunningCount: 1
- heavyQueuedCount: 0
- no active csv-sort jobs

This is a stale lock symptom. It causes new heavy runs to wait even when no real active job exists.

Fix:

- Add a periodic lock sweeper tied to execution status heartbeat.
- If execution is terminal in DB but still in heavy running set, evict stale lock.
- Keep dev purge, but do not rely on startup-only purge.

### Root Cause E: External sort merge serialization mismatch

Initial runs are written as seq TAB row JSON, and reader expects TAB format. But merge writes JSON object line without TAB, so later reads can skip merged rows.

Evidence:

- Reader expects tab separator.
  - src/features/executions/server/datasets/external-sort.ts:92
- Merge writes plain JSON object string.
  - src/features/executions/server/datasets/external-sort.ts:156

Fix:

- Make merge write use same wire format as reader/writer:
  - seq TAB row JSON
- Add regression test:
  - multi-pass merge where runCount > mergeFanIn
  - assert stable row count and order

### Root Cause F: Long CPU blocks can stall BullMQ lock renewal

Large in-memory sort can block event loop long enough to lose lock and get stalled job errors.

Evidence:

- In-memory path can materialize full dataset into array and sort.
  - src/workers/csv-sort.worker.ts:165
  - src/workers/csv-sort.worker.ts:166
- Recent failed jobs showed stalled errors.

Fix:

- Force external sort for large datasets (already partially done with 5M threshold).
- Add hard max for in-memory mode (for example 1M or dynamic by memory headroom).
- Consider running heavy sort in dedicated child process with larger heap and heartbeat.

### Root Cause G: Worker process model is split between scripts and mprocs

mprocs starts next/inngest/redis, but not parse/sort workers. This can produce queueed jobs without consumers depending on startup path.

Evidence:

- mprocs excludes parse/sort workers.
  - mprocs.yaml
- npm dev:all includes parse/sort workers.
  - package.json

Fix:

- Standardize one startup profile for local and production-like development.
- Either:
  - include workers in mprocs
  - or retire mprocs and use dev:all consistently

## Robust Target Design (Matches Your Desired Model)

Desired model in plain terms:

1. Node receives data reference.
2. Node enqueues job with strong correlation id.
3. Worker processes data using high resources within configured guardrails.
4. Worker persists output to C:/autopilotdata.
5. Worker emits terminal event (success/failure/canceled) with same correlation id.
6. Orchestrator stores node result and moves to next node.
7. Worker returns to idle or dedicated child process exits after job.

### Implementation notes

- Storage: set DATASET_STORAGE_ROOT to C:/autopilotdata.
- Correlation id: executionId + nodeId + datasetId.
- Cancellation token: per job in Redis, polled in worker loops.
- File cleanup: only after terminal ack.
- Slot release: always in finally.
- Partial outputs: persist on failed and canceled runs.

## Recommended Fix Plan

### Phase 1 (Stability first)

1. Fix external-sort merge wire format mismatch.
2. Guarantee slot release in finally path.
3. Implement sort cancellation token and pause integration.
4. Stop deleting active execution directory before worker terminal ack.

### Phase 2 (Correct output visibility)

1. Persist partial output summary on FAIL/PAUSE.
2. Tighten event correlation from execution-only to per-node/per-dataset.
3. Validate completion payload identity before accepting.

### Phase 3 (Performance and resource control)

1. Force external sort for very large datasets.
2. Add dedicated child process mode for heavy sort jobs.
3. Add queue wait metrics and separate queue wait vs run time in UI.

### Phase 4 (Operational consistency)

1. Standardize startup profile so required workers always run.
2. Add stale lock sweeper.
3. Pin storage to C:/autopilotdata in env and document migration.

## Acceptance Criteria

1. Parse output remains visible even if downstream node fails.
2. Cancel during sort stops worker within bounded time and no further progress events continue.
3. No stale heavy locks remain after terminal state.
4. Small sort jobs start quickly when no true heavy run exists.
5. Large sort jobs use external strategy and complete without stalled lock failures.
6. Data is persisted under C:/autopilotdata and cleanup is deterministic.

## Final Notes

This report is read-only and does not change runtime behavior. It provides the structural fixes needed to make the system deterministic, fast, and aligned with your worker lifecycle requirement.
