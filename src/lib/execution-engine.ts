/**
 * Client-Side Workflow Execution Engine
 *
 * Replaces Inngest + BullMQ with a pure browser implementation:
 * 1. Topological sort of the node graph
 * 2. Sequential execution of each node's executor function
 * 3. Context (variable map) threaded between nodes
 * 4. Progress broadcast via Jotai atoms (set via provided callbacks)
 *
 * Executors live alongside their node components in
 * src/features/executions/components/<node-type>/executor.ts
 */

import { createId } from "@paralleldrive/cuid2";
import type { Edge, Node } from "@xyflow/react";
import { db } from "@/lib/db";
import { NodeType } from "@/types/node-type";
import type { DatasetRef } from "@/types/dataset";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The shared context passed between nodes — maps variable names to values. */
export type ExecutionContext = Record<string, unknown>;

/** Each node executor receives context and returns new variables to add. */
export type NodeExecutor = (
  nodeId: string,
  nodeData: Record<string, unknown>,
  context: ExecutionContext,
  executionId: string,
  onProgress: (progress: number, message?: string) => void,
) => Promise<ExecutionContext>;

export type NodeStatus = "idle" | "running" | "success" | "error";

export interface ExecutionCallbacks {
  onExecutionCreated: (executionId: string) => void;
  onNodeStatusChange: (nodeId: string, status: NodeStatus) => void;
  onWorkflowStatusChange: (status: "running" | "success" | "error") => void;
  onProgress: (nodeId: string, progress: number, message?: string) => void;
  onError: (error: string) => void;
}

// ─── Executor registry ────────────────────────────────────────────────────────

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
  [NodeType.CSV_COLUMN_STATS]: () =>
    import("@/features/executions/components/csv-column-stats/executor").then((m) => m.executor),
  [NodeType.CSV_COMPARE]: () =>
    import("@/features/executions/components/csv-compare/executor").then((m) => m.executor),
  [NodeType.CSV_TRANSFORM]: () =>
    import("@/features/executions/components/csv-transform/executor").then((m) => m.executor),
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
