# Execution Inspector Architecture

Audience: senior engineers analyzing and tuning the Workflow Progress bottom panel.

Scope: redesigned bottom panel composed of Trace (left) and Execution Inspector (right), including API/data flow, state model, rendering behavior, and performance constraints for large CSV workloads.

Last updated: 2026-04-03

Revision note: synchronized with the redesigned `WorkflowProgressPanel` implementation (trace selection union model, runner timeline fallback and metrics mapping, 22%-62% split-resizer, collapsible metadata strip, and tabbed inspector output/error flows).

---

## 1. UI Overview

### 1.1 Placement and mounting

The panel is mounted from `src/features/editor/components/editor.tsx` and rendered when the editor has an executable trigger path. It is controlled by global execution atoms and local panel state in `src/features/editor/components/workflow-progress-panel.tsx`.

Top-level behavior:

- Header always visible.
- Body collapses/expands via animated CSS grid row (`0fr` <-> `1fr`).
- Expanded body contains a horizontal split layout.

### 1.2 Redesigned panel structure

The redesign is an Inngest-style split inspector with compact dense rows:

- Left: Trace
  - Runner trace list (timeline rows with bars)
  - Workflow node list (status rows)
- Right: Execution Inspector
  - Step header with status icon
  - Collapsible metadata strip (collapsed by default)
  - Tabs: Output, Error details

Visual/interaction constraints implemented:

- Runner row height: 26px.
- Node row height: 30px.
- Selected row: blue left border + soft blue background.
- Split handle: draggable, constrained to 22%-62% width.

### 1.3 Left panel (Trace)

The left side is two trace domains in one vertical column.

#### A) Runner steps timeline

Data source:

- Primary: `output.__executionMetrics` (only after raw output is loaded).
- Fallback: static synthetic step list (`FALLBACK_RUNNER_STEPS`) so the panel is never empty.

Rendering model:

- A time ruler at the top (`timelineMarkers`) based on `timelineMaxMs`.
- Each step renders:
  - status icon
  - step name
  - bar positioned by:
    - `left = startMs / timelineMaxMs`
    - `width = (endMs - startMs) / timelineMaxMs`

Selection:

- Selecting a runner step sets `traceSelection = { kind: "runner-step", id }`.
- Tab auto-switch:
  - `error` status -> Error details tab
  - other status -> Output tab

#### B) Workflow nodes

Data source:

- `nodes` prop from editor graph, excluding `INITIAL` nodes.
- Node status from `nodeStatusMapAtom`.

Rendering model:

- Dot + label + status text (`Pending/Running/Done/Failed`).
- Compact row with selectable highlight.

Selection:

- Selecting a workflow node sets `traceSelection = { kind: "workflow-node", id }`.
- Tab auto-switch follows node status.

### 1.4 Right panel (Execution Inspector)

Inspector is structured as:

1. Header
   - Status icon from selected trace item status
   - Name from selected step/node
   - "Show details / Hide details" metadata toggle

2. Metadata strip (collapsible)
   - Animated with CSS grid row (`0fr` <-> `1fr`, 250ms).
   - Fields:
     - Status
     - Started
     - Finished
     - Duration
     - Node

3. Tabs
   - Output
   - Error details (with red dot marker)

4. Content area
   - Error tab:
     - error banner
     - stack trace block with line numbers and Copy action
   - Output tab:
     - gated raw-load prompt (for workflow-node payload inspection)
     - dataset viewer for dataset variables
     - JSON output preview with copy/download actions
     - empty state when no payload

### 1.5 Component tree

```text
Editor
  ReactFlow
    Node components
      useNodeStatus (push updates to nodeStatusMapAtom)

  WorkflowProgressPanel
    Header
      state badge
      run/pause button
      execution id
      panel collapse toggle

    Collapsible body
      Split container
        Left Trace panel
          Time ruler
          Runner step rows (gantt bars)
          Workflow node rows

        Splitter handle (drag)

        Right Inspector panel
          Selection header + metadata toggle
          Collapsible metadata strip
          Tabs: Output | Error details
          Tab content
            Error banner + stack trace block
            OR output renderer
              raw-load gate
              dataset viewer
              json preview / empty state
```

---

## 2. Data Flow From Backend To UI

### 2.1 Endpoints used

From `src/features/executions/server/executions-router.ts`:

- `executions.getOne`
- `executions.getOneRawOutput`
- `executions.getDatasetMeta`
- `executions.getDatasetChunk`
- `executions.getDatasetRows`
- `executions.getDatasetPage`
- `executions.downloadDataset`

Mutations from workflow hooks:

- `workflows.update`
- `workflows.execute`
- `workflows.pause`

### 2.2 Fetch timing

1. User clicks Run:

- Save latest graph (`workflows.update`).
- Trigger execution (`workflows.execute`).
- Set `activeExecutionId`.

2. Summary polling starts:

- `getOne` polls every 1s while backend status is `RUNNING`.
- Stops when status is terminal.

3. Raw output is lazy:

- `getOneRawOutput` is disabled until user requests output load.
- Triggered by Output tab flow when selection requires workflow-node payload details.

4. Dataset APIs are lazy:

- Activated only when selected workflow-node output resolves to dataset-like value.
- Query chain:
  - meta
  - page
  - optional download

### 2.3 Status lane vs payload lane

The panel uses two lanes intentionally:

- Status lane (fast control plane)
  - polling summary + realtime node-status updates
- Payload lane (heavy data plane)
  - explicit raw output fetch + dataset page reads

This keeps default panel responsiveness high even when output is large.

### 2.4 Backend -> UI sequence

```text
Runner executes workflow
  -> writes execution status/error/errorStack/output
  -> emits node status events (loading/success/error)

UI:
  getOne polling -> execution metadata cards + panel state
  node status events -> nodeStatusMapAtom -> Trace rows update
  on-demand getOneRawOutput -> selection payload + dataset detection
  on-demand dataset page APIs -> table rows
```

---

## 3. State Management

### 3.1 Global state (Jotai)

From `src/store/execution-status.ts`:

- `workflowExecutionStateAtom`
- `activeExecutionIdAtom`
- `executionStartedAtAtom`
- `nodeStatusMapAtom`
- `workflowExecutionResultAtom`
- `workflowExecutionErrorAtom`
- `workflowProgressPanelCollapsedAtom`

### 3.2 Local panel state

From `WorkflowProgressPanel`:

- `traceSelection: TraceSelection`
- `activeTab: "output" | "error"`
- `isMetadataCollapsed` (default `true`)
- `isRawOutputRequested` (default `false`)
- `splitPercent` (default `38`)
- `isDraggingSplit`
- `copiedState`

### 3.3 Local dataset-viewer state

From `ExecutionDatasetViewer`:

- `page`
- `pageSize`

### 3.4 State transition rules

Execution progress:

- Polling updates execution status/timestamps/error.
- Realtime node status updates `nodeStatusMapAtom` independently.

Selection:

- Selection can target either runner step or workflow node.
- Default auto-selection chooses an error/loading item first, then last available.

Pagination:

- page/pageSize changes produce new query keys and fetches.
- scrolling inside table does not trigger network fetch.

Split resizing:

- mousemove updates `splitPercent` while dragging.
- values are clamped to [22, 62].

### 3.5 Caching strategy

- React Query provides cache keyed by query inputs.
- Global stale time from query client remains active.
- JSONL adapter caches dataset manifests server-side (`manifestCache`).

---

## 4. Execution Inspector Data Model

### 4.1 Selection model

```ts
type TraceSelection =
  | { kind: "runner-step"; id: string }
  | { kind: "workflow-node"; id: string }
  | null;
```

Selection drives:

- inspector header name/status
- metadata Node field
- tab defaulting behavior
- output payload resolution path

### 4.2 Displayed metadata model

Metadata strip displays:

- Status (`getOne.status`)
- Started (`getOne.startedAt`)
- Finished (`getOne.finishedAt`)
- Duration (derived)
- Node (selection identity)

### 4.3 Output payload precedence

Output tab payload source priority:

1. selected runner step payload
2. selected workflow node output value
3. full raw output object
4. empty state

### 4.4 Workflow-node output resolution

For selected workflow nodes:

- Looks up known variable-key fields in node data:
  - `variableName`, `outputVariable`, `resultVariable`, `saveAs`, `outputKey`, `targetVariable`, `storeAs`
- If any key exists in `outputRecord`, use that value.
- Fallback to `outputRecord[node.id]`.

### 4.5 Small JSON vs dataset-backed output

Small output:

- JSON stringified and rendered in inspector pre block.
- Marked large if over 12000 chars or 220 lines.

Dataset-backed output:

- Detected via `kind: dataset`, `kind: dataset-summary`, or records/preview structure.
- Routed to `ExecutionDatasetViewer`.

Important gating:

- Workflow-node output inspection requires raw output load.
- Runner-step output can render from fallback payload without raw output.

---

## 5. Dataset Rendering Pipeline

### 5.1 Load path

```text
selected workflow node
  -> resolve selected dataset variable from output record
  -> useExecutionDatasetMeta(executionId, variable)
  -> useExecutionDatasetPage(executionId, variable, page, pageSize)
  -> render table
```

### 5.2 Backend page resolution

`getDatasetPage` behavior:

- DatasetRef path:
  - `datasetService.getDatasetRowsByPage(...)`
  - resolves chunk window
  - reads across chunk boundaries until page is filled
- Inline path:
  - in-memory slice by page/pageSize

### 5.3 Pseudocode: next page load

```text
onPageChange(nextPage):
  if nextPage < 1: return
  if totalPages > 0 and nextPage > totalPages: return
  setPage(nextPage)

queryKey changes -> getDatasetPage executes
```

### 5.4 Pseudocode: chunk window -> rows -> table

```text
pageResult = getDatasetPage(...)
rows = pageResult.rows
window = pageResult.window
columns = schemaColumns or discovered row keys

for i in [0..rows.length):
  absoluteIndex = (window?.globalOffset or 0) + i + 1
  render row number + one cell per column
```

### 5.5 Virtualization strategy

Current state:

- No row virtualization.
- Page-based rendering only.
- Scroll area is local to the current page.

---

## 6. Performance Characteristics

### 6.1 Performance-sensitive areas

1. Polling pressure

- `getOne` every second while running.

2. Realtime status fanout

- Node status updates can trigger frequent Trace rerenders.

3. Raw-output parsing

- `safeStringify` on large nested payloads can be expensive.

4. Dataset table rendering

- Full current page is rendered synchronously.
- No virtualization/memoized row components.

5. Split drag rerenders

- `splitPercent` updates on mousemove cause frequent panel rerenders while dragging.

### 6.2 Large dataset scaling (100MB-400MB)

What scales well:

- default view remains summary-first
- dataset reads are page-based

What still degrades:

- server-side dataset download currently materializes full rows array before returning
- expensive stringify work when raw payload is large
- table rendering cost rises with pageSize \* columnCount

### 6.3 Trace timeline caveat

Runner timeline is metrics-driven only after raw output is loaded.

Before raw output load:

- fallback synthetic steps are shown
- timing bars are representative UI scaffolding, not actual run metrics

This is deliberate for fast first paint, but it can mislead debugging if not understood.

---

## 7. Failure Handling

### 7.1 Error sources and precedence

Error tab and error banner prioritize:

1. atom-level execution error
2. `getOne.error`
3. raw output query failure message

### 7.2 Node-level vs execution-level failure

- Node rows rely on realtime status events.
- Execution status comes from polling summary.

A mismatch can occur when failure happens after a node already emitted success.

### 7.3 Stack trace handling

- Uses `getOne.errorStack`.
- Splits into trimmed lines.
- Renders line numbers and supports Copy action.

### 7.4 Dataset failure handling

- Metadata failures are surfaced directly in viewer.
- Page-level failure UI is less explicit; current empty-state path can hide fetch failures.

### 7.5 Oversized output behavior

- Memory guard failures from runner are shown in error banner/stack.
- Large output text is truncated for inline preview; optional download available.

---

## 8. Interaction With Runner

### 8.1 Progress propagation

Push channel:

- Node status via realtime events from executors.

Polling channel:

- Execution summary via `getOne` polling.

### 8.2 Refresh granularity

- Trace node status rows: push-driven.
- Execution cards and error stack: poll-driven.
- Dataset rows: explicit page fetch only.

### 8.3 Consistency guarantees

Model is eventually consistent across lanes.

- push and polling events are not transactional together
- UI can transiently show mixed state (for example node done while execution failed)

---

## 9. Rendering Strategy

### 9.1 Collapse/expand animations

Panel-level collapse:

- body uses animated CSS grid row (`0fr` <-> `1fr`)

Metadata collapse:

- metadata strip uses same grid-row animation pattern (250ms)

Chevron affordances:

- panel and metadata chevrons rotate with CSS transitions

### 9.2 Layout density strategy

- compact fixed row heights in Trace
- reduced card-heavy layout in inspector
- metadata defaults collapsed for output-first focus

### 9.3 Heavy render avoidance currently implemented

- lazy raw output fetch
- dataset page rendering instead of full output table
- large output truncation

### 9.4 Remaining heavy render sources

- per-render stringify
- non-virtualized row tables
- high-frequency rerenders during split dragging

---

## 10. Known Bottlenecks

1. Fixed 1s polling regardless of visibility/focus.
2. Per-node status updates can cascade rerenders.
3. Output stringify cost on large objects.
4. No table virtualization.
5. Split drag updates state every mousemove.
6. Dataset page error UI is incomplete.
7. Full dataset download builds in-memory array before response.
8. Runner timeline can be synthetic until raw output is loaded.

---

## 11. Optimization Opportunities

### 11.1 UI and state

- Memoize output stringify results by stable selection key.
- Defer stringify until Output tab is active.
- Throttle split updates with `requestAnimationFrame`.
- Add row memoization for dataset table cells.

### 11.2 Data flow

- Adaptive polling (fast while active changes, slower while idle/queued).
- Dedicated endpoint for selected trace item payload.
- Optional endpoint for runner-step timeline payload independent of full raw output.

### 11.3 Dataset path

- Add explicit page-error state in viewer body.
- Add prefetch for next page after successful load.
- Add server-side projection (column subset) for wide tables.
- Stream dataset download directly from adapter to avoid giant in-memory arrays.

### 11.4 Realtime lane

- Centralize node-status subscription to avoid duplicated per-node filtering work.

---

## 12. End-to-End Example

Scenario: user runs workflow, inspects failure, then opens dataset output.

### 12.1 Sequence diagram

```text
User                    Panel/UI                         API/Runner
 |                        |                                  |
 | click Run              |                                  |
 |----------------------->| update workflow                  |
 |                        | execute workflow                 |
 |                        |--------------------------------->| create execution
 |                        | set activeExecutionId            |
 |                        | start getOne polling             |
 |                        |<---------------------------------| status=RUNNING
 |                        |                                  |
 |                        |<---------------------------------| node status events
 |                        | Trace node rows update           |
 |                        |                                  |
 | select failing step    | traceSelection=runner-step       |
 |----------------------->| activeTab=error                  |
 |                        | render banner + stack trace      |
 |                        |                                  |
 | select workflow node   | traceSelection=workflow-node     |
 |----------------------->| Output tab requires raw load     |
 | click Load output      | getOneRawOutput                  |
 |----------------------->|--------------------------------->| return output JSON
 |                        | detect DatasetRef variable       |
 |                        | getDatasetMeta + getDatasetPage  |
 |                        |--------------------------------->| page rows
 |                        | render paged table               |
```

### 12.2 Timing considerations

- Status freshness target while running: about 1s on summary lane.
- Node status can appear earlier than summary polling updates.
- First dataset render cost = raw output fetch + metadata + first page fetch.
- Deep page fetch cost depends on chunk index and adapter read strategy.

---

## 13. Contracts and Interfaces

### 13.1 Trace models (frontend)

```ts
type TraceStatus = "initial" | "loading" | "success" | "error";

type TraceSelection =
  | { kind: "runner-step"; id: string }
  | { kind: "workflow-node"; id: string }
  | null;

interface RunnerTraceStep {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  status: TraceStatus;
  payload?: unknown;
}

interface WorkflowTraceNode {
  id: string;
  label: string;
  status: TraceStatus;
  variableKeys: string[];
}
```

### 13.2 Execution summary response (`executions.getOne`)

```ts
{
  id: string;
  workflowId: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  error: string | null;
  errorStack: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  inngestEventId: string;
  workflow: {
    id: string;
    name: string;
  }
  queueState: "QUEUED" | "RUNNING" | null;
}
```

### 13.3 Raw output response (`executions.getOneRawOutput`)

```ts
{
  id: string;
  status: string;
  output: unknown; // may include __executionMetrics and node outputs
}
```

### 13.4 DatasetRef contract

```ts
{
  kind: "dataset";
  datasetId: string;
  executionId: string;
  variableName: string;
  storage: "jsonl" | "object-storage" | "columnar";
  manifestVersion: number;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: DatasetSchema;
}
```

### 13.5 Dataset endpoint envelopes

`getDatasetMeta`:

```ts
{
  kind: "dataset-ref" | "inline";
  variable: string;
  datasetId: string;
  executionId: string;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: DatasetSchema;
}
```

`getDatasetPage`:

```ts
{
  kind: "dataset-ref" | "inline";
  variable: string;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  window: {
    chunkIndex: number;
    offset: number;
    limit: number;
    globalOffset: number;
  } | null;
  rows: Array<Record<string, unknown>>;
}
```

`downloadDataset`:

```ts
// jsonl
{
  format: "jsonl";
  variable: string;
  fileName: string;
  mimeType: "application/x-ndjson";
  content: string;
}

// json
{
  format: "json";
  variable: string;
  fileName: string;
  mimeType: "application/json";
  data: Array<Record<string, unknown>>;
}
```

---

## Practical Debug Checklist

1. Confirm selection kind (`runner-step` vs `workflow-node`).
2. Confirm whether raw output was requested (affects payload availability and runner metrics fidelity).
3. Confirm polling lane (`getOne`) and push lane (node status events) are both healthy.
4. Confirm dataset variable detection and meta/page query enable conditions.
5. Inspect stack trace and error precedence when status mismatches appear.

This redesigned architecture is optimized for dense observability and output-first debugging while still protecting default render cost. The key tradeoff is lane separation: excellent first-load responsiveness, but additional coordination complexity across summary, realtime status, and on-demand payload layers.
