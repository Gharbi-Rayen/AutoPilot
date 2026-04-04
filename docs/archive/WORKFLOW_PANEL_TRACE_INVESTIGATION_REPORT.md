# Workflow Panel Trace Investigation Report

Date: 2026-04-03
Owner: Execution + Editor UI

## 1. Summary

The panel behavior issues came from two separate layers:

1. UI trace ordering and scrolling behavior (frontend).
2. Execution failure in `UPLOAD_FILE` output size guard (backend runtime).

The workflow did not reach CSV Parse because execution stopped earlier at Upload File with a non-retriable error. This was not a trace-only visualization problem.

## 2. Symptoms Observed

- Trace rows appeared in an order that did not match actual execution order.
- Workflow failed before reaching parse-related nodes.
- Nodes section at the bottom did not reliably scroll in constrained panel layouts.
- Collapsed panel header was not full-width.

## 3. Root Causes

### 3.1 Trace order mismatch

Backend execution order is topological:

- `src/inngest/utils.ts`
  - `topologicalSort(...)` uses graph connections and returns node order used by runtime.
- `src/inngest/functions.ts`
  - runtime executes `executionNodes` derived from topological ordering.

Frontend previously rendered trace nodes from editor node list order, which is not guaranteed to match backend topological execution sequence.

Impact:

- Live statuses were correct per node ID, but visual order was inconsistent with actual run order.

### 3.2 Workflow failure before parse node

Failure is caused by output guard in runtime:

- `src/inngest/functions.ts`
  - `assertNoLargeArrayOutput(...)` throws `NonRetriableError` when large arrays are found in node output.

Upload node returns payload containing file buffer data:

- `src/features/executions/components/upload-file/executor.ts`
  - output includes buffer content under upload variable.

In your run, error message explicitly reports:

- `output.temp.buffer.data: 383268 rows`

That exceeds inline-safe limits and causes hard stop before downstream nodes (including CSV Parse) can run.

Impact:

- Workflow termination at Upload File is expected with current guard behavior.

### 3.3 Nodes section not reliably scrollable

The nodes block used a max-height strategy in a nested flex layout, which could fail to create an independent scroll region depending on container constraints.

Impact:

- Node rows were clipped in some panel sizes without expected scrolling behavior.

### 3.4 Collapsed header width behavior

Collapsed panel container was intentionally constrained to centered fixed max width in editor layout styles.

Impact:

- Collapsed header did not span full editor width.

### 3.5 Repeated `executeWorkflow triggered` logs

Observed repeated `/api/inngest?...stepId=step` calls with HTTP 206 are consistent with step-based engine progression/re-entry, not necessarily duplicate full workflow starts.

Impact:

- Log volume can look like repeated starts, but root functional failure still comes from large inline output guard.

## 4. Changes Applied

### 4.1 Trace ordering fixed to match execution graph

Updated panel to topologically sort nodes using edges before building trace rows.

- `src/features/editor/components/workflow-progress-panel.tsx`
  - added `sortNodesByExecutionOrder(...)`
  - switched `workflowNodes` derivation to use sorted node list
  - panel now accepts `edges` prop

### 4.2 Nodes section scrolling hardened

Updated nodes area to fixed-height flex container + explicit independent vertical scrolling.

- `src/features/editor/components/workflow-progress-panel.tsx`
  - nodes block uses fixed `h-[156px]` and `overflow-y-auto`

### 4.3 Collapsed header full width

Changed editor collapsed container class from centered fixed-width pill to full-width collapsed bar.

- `src/features/editor/components/editor.tsx`
  - collapsed class now uses full-width `inset-x-0`

### 4.4 Prop wiring update

Passed `edges` to panel so UI can compute topological order locally.

- `src/features/editor/components/editor.tsx`
  - `<WorkflowProgressPanel nodes={nodes} edges={edges} workflowId={workflowId} />`

## 5. Remaining Backend Action (Not yet changed here)

To prevent Upload File from killing runs on large payloads, normalize file output to a reference form before returning from node execution:

- Store file bytes externally and return metadata + reference.
- Avoid returning raw huge arrays in output context.
- Keep runtime guard enabled (recommended).

Without this backend normalization, workflows with large in-memory file arrays will continue to fail before downstream parse nodes.

## 6. Validation Status

- Updated panel/editor files compile with no reported TypeScript diagnostics.
- Modified files pass Biome checks.
- Failure cause in logs aligns with runtime guard and executor output shape.
