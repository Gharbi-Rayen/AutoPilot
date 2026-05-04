/**
 * FILE: src/lib/execution-engine.ts
 *
 * PURPOSE:
 *   This is the core orchestrator that runs a workflow from start to finish.
 *   It replaces server-side job queues (BullMQ, Inngest) with a pure browser
 *   implementation that works entirely offline.
 *
 * WHAT IS A WORKFLOW EXECUTION?
 *   A workflow is a directed graph of nodes (like a flowchart).
 *   Each node does one thing: parse a CSV, filter rows, sort, join, etc.
 *   "Running" the workflow means:
 *     1. Sort the nodes so we know which to run first (parents before children).
 *     2. Run each node's executor function in order.
 *     3. Pass the output of each node into the context, so later nodes can use it.
 *     4. Track status (RUNNING/SUCCESS/FAILED) in IndexedDB for the history view.
 *     5. Broadcast live progress via callbacks so the UI updates in real time.
 *
 * WHAT IS A DIRECTED GRAPH?
 *   A graph where connections (edges) have a direction: from a SOURCE node to a
 *   TARGET node.  An arrow A → B means "A's output feeds into B".
 *   "Directed acyclic graph" (DAG) means there are no cycles — you cannot loop back.
 *
 * WHAT IS TOPOLOGICAL SORT?
 *   In a DAG, topological sort produces an ordering of nodes where every node
 *   appears BEFORE all nodes that depend on it.
 *   Example:  A → B → C   gives the order [A, B, C].
 *   Example:  A → C, B → C   gives [A, B, C] or [B, A, C].
 *   This ensures a node is never executed before its dependencies are ready.
 *
 * WHAT IS EXECUTIONCONTEXT?
 *   A simple JavaScript object (Record<string, unknown>) that acts as a "scratchpad"
 *   shared between all nodes during a run.  Each node's executor can:
 *     - READ from context: get the dataset reference its parent node wrote
 *     - WRITE to context: add its own output so child nodes can find it
 *   Example after CSV_PARSE runs: context["output"] = { kind: "dataset", datasetId: "..." }
 *   The CSV_FILTER node then reads context["output"] to find the data to filter.
 *
 * WHAT IS A DYNAMIC IMPORT?
 *   Normally, import statements are evaluated at startup and all code is loaded upfront.
 *   Dynamic import() is a LAZY import — the module is fetched and loaded only when
 *   that line of code is reached.
 *     const mod = await import("@/features/executions/components/csv-sort/executor");
 *   This means the CSV sort executor code is NOT loaded unless a CSV_SORT node is
 *   actually in the workflow being run.  This keeps the initial page load fast.
 *
 * WHAT IS AN ABORTSIGNAL?
 *   AbortController + AbortSignal is a browser API for cancellation.
 *   The main thread creates an AbortController:
 *     const ctrl = new AbortController();
 *   Then passes ctrl.signal to runWorkflow().
 *   When the user clicks "Cancel":
 *     ctrl.abort();  → signal.aborted becomes true
 *   The execution loop checks signal.aborted before each node and stops if true.
 *
 * WHAT IS A DOMException?
 *   DOMException is the standard browser error class for web API errors.
 *   When an AbortSignal fires, the convention is to throw:
 *     new DOMException("Workflow cancelled", "AbortError")
 *   The name "AbortError" is what distinguishes "intentional cancel" from "real error".
 *
 * USED IN:
 *   src/features/editor/components/editor-header.tsx — "Run" button calls runWorkflow()
 *   src/features/editor/components/editor.tsx         — holds AbortController reference
 */

import { createId } from "@paralleldrive/cuid2";
import type { Edge, Node } from "@xyflow/react";
import { db } from "@/lib/db";
import { NodeType } from "@/types/node-type";
import type { DatasetRef } from "@/types/dataset";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * ExecutionContext
 *
 * WHY THIS EXISTS:
 *   As the workflow runs node by node, each node produces output (a DatasetRef,
 *   an ArrayBuffer, a text result, etc.).  That output needs to be passed to the
 *   next node.  ExecutionContext is the shared "bag of variables" that accumulates
 *   all outputs as execution progresses.
 *
 * WHAT IS Record<string, unknown>?
 *   Record<K, V> is a TypeScript type for an object.
 *   Record<string, unknown> means: "an object where every key is a string and
 *   every value can be any type (unknown)."
 *   "unknown" is safer than "any" because TypeScript requires you to check the
 *   type before using a value — it does not silently allow operations on unknown.
 *
 * HOW IT IS USED:
 *   Initially empty: const context: ExecutionContext = {}
 *   After CSV_PARSE node runs, the executor adds:
 *     { output: DatasetRef, output_manifest: DatasetManifest }
 *   After CSV_FILTER reads from context["output"] and adds its own:
 *     { output: DatasetRef, ..., filtered: DatasetRef, filtered_manifest: ... }
 *
 * USED IN:
 *   runWorkflow()  — created fresh for each run
 *   NodeExecutor   — receives context as a parameter
 *   Every executor — reads from and writes to context
 */
/** The shared context passed between nodes — maps variable names to values. */
export type ExecutionContext = Record<string, unknown>;

/**
 * NodeExecutor
 *
 * WHY THIS EXISTS:
 *   This is the function signature (type) that every executor must implement.
 *   By defining a shared type, the execution engine can call any executor
 *   without knowing its specific implementation — they all look the same from
 *   the engine's perspective.
 *
 * WHAT IS A FUNCTION TYPE?
 *   A function type describes the shape of a function: its parameters and return type.
 *   Any function that matches this shape can be assigned to a variable of this type.
 *
 * PARAMETER MEANINGS:
 *   nodeId       — the ReactFlow node ID (used to write to executionNodeOutputs in DB)
 *   nodeData     — the node's configuration data (column names, filter rules, etc.)
 *                  This comes from node.data in the ReactFlow node object.
 *   context      — the shared ExecutionContext; read previous outputs, write new ones
 *   executionId  — the current run's ID; used when writing datasets to OPFS/IndexedDB
 *   onProgress   — callback to report progress (0-100) to the UI progress panel
 *
 * RETURNS:
 *   Promise<ExecutionContext> — the new variables this executor produced.
 *   The engine merges these into the running context with Object.assign().
 *
 * USED IN:
 *   executorRegistry — maps NodeType to a function that returns a NodeExecutor
 *   runWorkflow()    — calls each executor with these parameters
 *   Every executor in src/features/executions/components/<node-type>/executor.ts
 */
/** Each node executor receives context and returns new variables to add. */
export type NodeExecutor = (
  nodeId: string,
  nodeData: Record<string, unknown>,
  context: ExecutionContext,
  executionId: string,
  onProgress: (progress: number, message?: string) => void,
) => Promise<ExecutionContext>;

/**
 * NodeStatus
 *
 * WHY THIS EXISTS:
 *   The progress panel in the editor shows a visual status indicator per node.
 *   This union type defines the four possible states a node can be in during execution.
 *
 * VALUES:
 *   "idle"    — not yet reached in this run
 *   "running" — currently executing
 *   "success" — finished without error
 *   "error"   — threw an exception
 *
 * USED IN:
 *   ExecutionCallbacks.onNodeStatusChange — called with one of these values
 *   src/store/execution-status.ts — atoms hold NodeStatus per nodeId
 *   src/features/editor/components/workflow-progress-panel.tsx — reads atom to render icons
 */
export type NodeStatus = "idle" | "running" | "success" | "error";

/**
 * ExecutionCallbacks
 *
 * WHY THIS EXISTS:
 *   runWorkflow() is a pure engine function — it knows nothing about React or Jotai.
 *   To update the UI while running, it calls callback functions provided by the
 *   React layer (the editor component).  Those callbacks in turn update Jotai atoms,
 *   which cause React to re-render the progress panel.
 *
 *   This pattern is called "inversion of control" — the engine does not depend on
 *   React; instead, the UI gives the engine a set of callbacks to call.
 *
 * FIELD MEANINGS:
 *   onExecutionCreated    — called as soon as the execution record is created in IndexedDB,
 *                           so the progress panel can start listening on that executionId
 *   onNodeStatusChange    — called when a node transitions to running/success/error
 *   onWorkflowStatusChange — called when the whole workflow reaches running/success/error
 *   onProgress            — called with (nodeId, 0-100, optional message) during a node's run
 *   onError               — called with a human-readable error string if the workflow fails
 *
 * USED IN:
 *   runWorkflow()  — receives this object as a parameter
 *   src/features/editor/components/editor-header.tsx — provides these callbacks
 */
export interface ExecutionCallbacks {
  onExecutionCreated: (executionId: string) => void;
  onNodeStatusChange: (nodeId: string, status: NodeStatus) => void;
  onWorkflowStatusChange: (status: "running" | "success" | "error") => void;
  onProgress: (nodeId: string, progress: number, message?: string) => void;
  onError: (error: string) => void;
}

// ─── Executor registry ────────────────────────────────────────────────────────

/**
 * executorRegistry
 *
 * WHY THIS EXISTS:
 *   Maps each NodeType to a function that dynamically imports the executor module.
 *   This is the central lookup table: "given a node type, how do I get its executor?"
 *
 * WHY LAZY LOADING (dynamic import)?
 *   A workflow may have 2 nodes out of 20+ possible node types.
 *   If we eagerly imported all executors at startup, the browser would load ALL
 *   executor code (CSV sort, join, aggregate, compare, PDF, etc.) even if the workflow
 *   only uses CSV_PARSE and FILE_EXPORT.
 *   Dynamic imports ensure only the code for the nodes actually in the workflow is loaded.
 *
 * WHAT IS Partial<Record<NodeType, ...>>?
 *   Record<NodeType, fn> would require an entry for EVERY NodeType — including
 *   INITIAL and MANUAL_TRIGGER which have no executors.
 *   Partial<Record<...>> makes all keys optional, so we can omit INITIAL.
 *
 * WHAT IS () => Promise<NodeExecutor>?
 *   Each registry value is a "loader function" — a zero-argument function that,
 *   when called, returns a Promise that resolves to the NodeExecutor function.
 *   This two-step pattern delays the import until the node is actually needed.
 *
 * USED IN:
 *   runWorkflow() — looks up the loader for the current node's type, then calls it
 */
/**
 * Lazy-loaded executor registry.
 * Each entry is a dynamic import that returns the executor function.
 */
const executorRegistry: Partial<Record<NodeType, () => Promise<NodeExecutor>>> = {
  [NodeType.UPLOAD_FILE]: () =>
    import("@/features/executions/components/upload-file/executor").then((m) => m.executor),
  [NodeType.CSV_PARSE]: () =>
    import("@/features/executions/components/csv-parse/executor").then((m) => m.executor),
  [NodeType.CSV_FILTER]: () =>
    import("@/features/executions/components/csv-filter/executor").then((m) => m.executor),
  [NodeType.CSV_SORT]: () =>
    import("@/features/executions/components/csv-sort/executor").then((m) => m.executor),
  [NodeType.CSV_JOIN]: () =>
    import("@/features/executions/components/csv-join/executor").then((m) => m.executor),
  [NodeType.CSV_AGGREGATE]: () =>
    import("@/features/executions/components/csv-aggregate/executor").then((m) => m.executor),
  [NodeType.CSV_DEDUPLICATE]: () =>
    import("@/features/executions/components/csv-deduplicate/executor").then((m) => m.executor),
  [NodeType.CSV_COMPARE]: () =>
    import("@/features/executions/components/csv-compare/executor").then((m) => m.executor),
  [NodeType.CSV_TRANSFORM]: () =>
    import("@/features/executions/components/csv-transform/executor").then((m) => m.executor),
  [NodeType.CSV_COLUMN_TRANSFORM]: () =>
    import("@/features/executions/components/csv-column-transform/executor").then((m) => m.executor),
  [NodeType.CSV_RESTRUCTURE]: () =>
    import("@/features/executions/components/csv-restructure/executor").then((m) => m.executor),
  [NodeType.CSV_CONSECUTIVE_SEQUENCE_ANALYZER]: () =>
    import("@/features/executions/components/csv-consecutive-sequence/executor").then(
      (m) => m.executor,
    ),
  [NodeType.PDF_EXTRACT_TEXT]: () =>
    import("@/features/executions/components/pdf-extract-text/executor").then((m) => m.executor),
  [NodeType.PDF_EXTRACT_TABLES]: () =>
    import("@/features/executions/components/pdf-extract-tables/executor").then((m) => m.executor),
  [NodeType.FILE_EXPORT]: () =>
    import("@/features/executions/components/file-export/executor").then((m) => m.executor),
};

// ─── Topological sort ─────────────────────────────────────────────────────────

/**
 * sortNodes()
 *
 * WHY THIS EXISTS:
 *   ReactFlow gives us nodes and edges in arbitrary order — not in execution order.
 *   Before running, we must order them so that every node runs AFTER all its parents.
 *   This function performs a depth-first search (DFS) topological sort to produce
 *   a valid execution order.
 *
 * HOW DFS POST-ORDER TOPOLOGICAL SORT WORKS:
 *   DFS means: starting from a root node, follow one branch all the way to the end
 *   before backtracking.  "Post-order" means we add a node to the result AFTER
 *   visiting all its children.  Then we REVERSE the result.
 *   Reversing post-order gives topological order: parents before children.
 *
 *   Example graph:
 *     A → B → D
 *     A → C → D
 *   DFS from A:
 *     Visit A → Visit B → Visit D (leaf) → push D → push B → push C → push D (already visited) → push A
 *     result = [D, B, C, A]
 *     reversed = [A, C, B, D]  ← valid topological order
 *
 * WHAT IS hasParent Set?
 *   A Set<string> tracking which node IDs have at least one incoming edge.
 *   Root nodes (no parents) are not in this set.
 *   The DFS starts from root nodes only — starting from mid-graph would miss root subtrees.
 *
 * WHAT IS the nodeById Map?
 *   Maps node ID (string) to the full Node object.
 *   After sorting, we need to reconstruct the Node array in sorted order.
 *   We sort by ID, then map each ID back to its Node via this map.
 *
 * WHY ITERATE CHILDREN IN REVERSE?
 *   The final result is reversed after DFS.  By pushing children in reverse order
 *   during DFS, after the final reversal the "first child" in the original order
 *   appears first.  This makes branch order predictable and deterministic.
 *
 * ERROR HANDLING:
 *   If the sort throws (e.g. a cycle in the graph), we fall back to the original
 *   unsorted order rather than crashing.  An unsorted order may produce incorrect
 *   results, but it is better than an uncaught exception.
 *
 * CALLED FROM:
 *   runWorkflow() — called once to get the node execution order before the main loop
 */
/**
 * DFS post-order topological sort. Compared to `toposort`'s BFS-like ordering,
 * this ensures each pipeline branch is processed depth-first before the next
 * branch starts (e.g. upload1→parse1 fully before upload2→parse2).
 */
function sortNodes(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return [];
  try {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const children = new Map<string, string[]>();
    const hasParent = new Set<string>();

    for (const n of nodes) children.set(n.id, []);
    for (const e of edges) {
      if (nodeById.has(e.source) && nodeById.has(e.target)) {
        children.get(e.source)?.push(e.target);
        hasParent.add(e.target);
      }
    }

    const visited = new Set<string>();
    const result: string[] = [];

    const dfs = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const kids = children.get(id) ?? [];
      // Iterate in reverse so the first child wins when result is reversed.
      for (let i = kids.length - 1; i >= 0; i--) dfs(kids[i]);
      result.push(id);
    };

    for (const n of nodes) {
      if (!hasParent.has(n.id)) dfs(n.id);
    }

    result.reverse();
    return result.map((id) => nodeById.get(id)!).filter(Boolean);
  } catch {
    return nodes;
  }
}

// ─── Serialization helpers ────────────────────────────────────────────────────

/**
 * toSerializable()
 *
 * WHY THIS EXISTS:
 *   The ExecutionContext may contain ArrayBuffer objects (e.g. the raw bytes of an
 *   uploaded PDF).  IndexedDB CAN store ArrayBuffers, but they are large and
 *   should not be stored as part of the inline output record — they would bloat
 *   the database.  This function strips ArrayBuffers (and TypedArray views like
 *   Uint8Array, Float32Array…) from an object before saving it.
 *
 * WHAT IS AN ArrayBuffer?
 *   An ArrayBuffer is a fixed-size block of raw binary memory — like a byte array.
 *   It cannot be read directly; you use a "view" (TypedArray) on top of it.
 *   Example:
 *     const buf = new ArrayBuffer(8);          // 8 bytes of memory
 *     const view = new Uint8Array(buf);        // view as 8 unsigned integers
 *     view[0] = 255;                           // write to byte 0
 *
 * WHAT IS ArrayBuffer.isView()?
 *   Returns true if the value is a TypedArray (Uint8Array, Int16Array, Float64Array, etc.)
 *   or DataView — any view backed by an ArrayBuffer.
 *
 * HOW RECURSION WORKS HERE:
 *   toSerializable is called on each value.
 *   If the value is an object, it recursively calls toSerializable on each field.
 *   If the value is an ArrayBuffer or TypedArray view, it returns undefined.
 *   The Object.fromEntries + filter removes keys with undefined values.
 *
 * CALLED FROM:
 *   runWorkflow() — when building the inlineOutput to store in IndexedDB
 */
/**
 * Recursively strips ArrayBuffer (and TypedArray) values so the result is safe
 * to store in IndexedDB as inline output. The live execution context still
 * carries the original buffers for downstream nodes.
 */
function toSerializable(val: unknown): unknown {
  if (val instanceof ArrayBuffer || ArrayBuffer.isView(val)) return undefined;
  if (typeof val !== "object" || val === null) return val;
  if (Array.isArray(val)) return val.map(toSerializable);
  return Object.fromEntries(
    Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => [k, toSerializable(v)])
      .filter(([, v]) => v !== undefined),
  );
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * runWorkflow()
 *
 * WHY THIS EXISTS:
 *   This is the single entry point to run a workflow.  It orchestrates the complete
 *   execution lifecycle: create the DB record, sort nodes, run each node's executor,
 *   update DB on success/failure, fire callbacks throughout so the UI stays live.
 *
 * STEP-BY-STEP EXECUTION:
 *   1.  Generate a unique executionId (cuid2).
 *   2.  Write an ExecutionRecord with status "RUNNING" to IndexedDB.
 *   3.  Call onExecutionCreated so the UI subscribes to this executionId.
 *   4.  Call onWorkflowStatusChange("running") so the progress panel activates.
 *   5.  Create an empty ExecutionContext.
 *   6.  Topologically sort the nodes via sortNodes().
 *   7.  Loop over sorted nodes:
 *       a. Check AbortSignal — if aborted, throw DOMException("AbortError").
 *       b. Skip INITIAL (start node) silently; skip MANUAL_TRIGGER after marking success.
 *       c. Look up the executor loader from executorRegistry.
 *       d. Create an ExecutionNodeOutputRecord with status "RUNNING" in IndexedDB.
 *       e. Await the executor — it runs the heavy computation (in a worker or inline).
 *       f. Merge the executor's returned variables into context with Object.assign().
 *       g. Extract any DatasetRefs from the output; record the primary one.
 *       h. Build an inlineOutput (non-dataset values) for storage in IndexedDB.
 *       i. Update the ExecutionNodeOutputRecord to "SUCCESS".
 *       j. For each DatasetRef, write the manifest to the datasets IndexedDB table.
 *       k. Call onNodeStatusChange(nodeId, "success").
 *       l. If a node throws, update the record to "FAILED" and re-throw to stop the workflow.
 *   8.  After all nodes succeed, update the ExecutionRecord to "SUCCESS".
 *   9.  On any error, update to "FAILED".  If it was an AbortError (cancel), record "Cancelled".
 *  10.  Return the executionId.
 *
 * WHAT IS Object.assign(target, source)?
 *   Copies all enumerable own properties from source into target.
 *   This is used to merge each node's new variables into the shared context object.
 *   context = {}
 *   Object.assign(context, { output: ref })  → context = { output: ref }
 *   Object.assign(context, { filtered: ref2 }) → context = { output: ref, filtered: ref2 }
 *
 * WHAT IS the DatasetRef extraction logic?
 *   After an executor returns newVars, we look for all values that are DatasetRefs.
 *   (DatasetRefs have .kind === "dataset".)
 *   The first one found is the "primary" ref — stored in the node output record.
 *   ALL refs are iterated to save their manifests (e.g. CSV_COMPARE produces 5 refs).
 *
 * PARAMETERS:
 *   workflowId — the ID of the workflow definition being run
 *   nodes      — the workflow's ReactFlow node array
 *   edges      — the workflow's ReactFlow edge array
 *   callbacks  — UI callbacks (see ExecutionCallbacks)
 *   signal     — optional AbortSignal to support cancellation
 *
 * RETURNS:
 *   Promise<string> — the executionId created for this run
 *
 * CALLED FROM:
 *   src/features/editor/components/editor-header.tsx — "Run" button handler
 */
/**
 * Run a workflow to completion.
 *
 * @returns The execution ID created for this run.
 */
export async function runWorkflow(
  workflowId: string,
  nodes: Node[],
  edges: Edge[],
  callbacks: ExecutionCallbacks,
  signal?: AbortSignal,
): Promise<string> {
  const executionId = createId();

  // Persist execution record as RUNNING
  await db.executions.add({
    id: executionId,
    workflowId,
    status: "RUNNING",
    startedAt: new Date().toISOString(),
  });

  // Notify immediately so the panel can activate its DB query before nodes start
  callbacks.onExecutionCreated(executionId);
  callbacks.onWorkflowStatusChange("running");

  const context: ExecutionContext = {};
  const sortedNodes = sortNodes(nodes, edges);

  try {
    for (const node of sortedNodes) {
      if (signal?.aborted) {
        throw new DOMException("Workflow cancelled", "AbortError");
      }

      const nodeType = node.type as NodeType;

      // Skip structural/trigger nodes — mark trigger as "success" so the panel
      // shows it with a green checkmark and includes it in the completed count.
      if (nodeType === NodeType.INITIAL || nodeType === NodeType.MANUAL_TRIGGER) {
        if (nodeType === NodeType.MANUAL_TRIGGER) {
          callbacks.onNodeStatusChange(node.id, "success");
        }
        continue;
      }

      const loadExecutor = executorRegistry[nodeType];
      if (!loadExecutor) {
        // No executor registered — skip with a warning
        console.warn(`[ExecutionEngine] No executor for node type: ${nodeType}`);
        continue;
      }

      callbacks.onNodeStatusChange(node.id, "running");

      const nodeStartedAt = new Date().toISOString();

      // Persist node output as RUNNING
      const outputId = createId();
      await db.executionNodeOutputs.add({
        id: outputId,
        executionId,
        nodeId: node.id,
        nodeType,
        status: "RUNNING",
        startedAt: nodeStartedAt,
      });

      try {
        const executor = await loadExecutor();
        const newVars = await executor(
          node.id,
          (node.data as Record<string, unknown>) ?? {},
          context,
          executionId,
          (progress, message) => callbacks.onProgress(node.id, progress, message),
        );

        // Merge new variables into context
        Object.assign(context, newVars);

        // Collect ALL DatasetRefs from the output (nodes like CSV Compare emit several)
        const allDatasetRefs = Object.values(newVars).filter(
          (v): v is DatasetRef =>
            typeof v === "object" && v !== null && (v as DatasetRef).kind === "dataset",
        );
        const primaryRef = allDatasetRefs[0];

        // Build inline output: non-DatasetRef, non-manifest vars (e.g. CompareResult)
        const inlineVars = Object.fromEntries(
          Object.entries(newVars as Record<string, unknown>).filter(
            ([k, v]) =>
              !(typeof v === "object" && v !== null && (v as DatasetRef).kind === "dataset") &&
              !k.endsWith("_manifest"),
          ),
        );
        const hasInline = Object.keys(inlineVars).length > 0;

        const nodeFinishedAt = new Date().toISOString();
        const durationMs = new Date(nodeFinishedAt).getTime() - new Date(nodeStartedAt).getTime();

        await db.executionNodeOutputs.update(outputId, {
          status: "SUCCESS",
          variableName: primaryRef?.variableName,
          datasetId: primaryRef?.datasetId,
          inlineOutput: hasInline ? toSerializable(inlineVars) : undefined,
          finishedAt: nodeFinishedAt,
          durationMs,
        });

        // Persist manifests for ALL datasets emitted by this node
        for (const ref of allDatasetRefs) {
          const manifest = (newVars as Record<string, unknown>)[`${ref.variableName}_manifest`];
          if (manifest) {
            await db.datasets.add({
              id: ref.datasetId,
              executionId,
              variableName: ref.variableName,
              // biome-ignore lint/suspicious/noExplicitAny: manifest is typed loosely
              manifest: manifest as any,
            });
          }
        }

        callbacks.onNodeStatusChange(node.id, "success");
      } catch (nodeError) {
        const nodeFailedAt = new Date().toISOString();
        const errorMsg = String(nodeError);
        await db.executionNodeOutputs.update(outputId, {
          status: "FAILED",
          error: errorMsg,
          finishedAt: nodeFailedAt,
          durationMs: new Date(nodeFailedAt).getTime() - new Date(nodeStartedAt).getTime(),
        });
        callbacks.onNodeStatusChange(node.id, "error");
        throw nodeError; // bubble up to stop the workflow
      }
    }

    // All nodes succeeded
    await db.executions.update(executionId, {
      status: "SUCCESS",
      completedAt: new Date().toISOString(),
    });
    callbacks.onWorkflowStatusChange("success");
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      await db.executions.update(executionId, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        error: "Cancelled",
      });
      callbacks.onWorkflowStatusChange("error");
      return executionId;
    }
    const errorMsg = String(err);
    await db.executions.update(executionId, {
      status: "FAILED",
      completedAt: new Date().toISOString(),
      error: errorMsg,
    });
    callbacks.onWorkflowStatusChange("error");
    callbacks.onError(errorMsg);
  }

  return executionId;
}
