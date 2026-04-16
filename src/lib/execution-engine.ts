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
import toposort from "toposort";
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

function sortNodes(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return [];
  try {
    const deps: [string, string][] = edges.map((e) => [e.source, e.target]);
    const sorted = toposort.array(
      nodes.map((n) => n.id),
      deps,
    );
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    return sorted.map((id) => nodeById.get(id)!).filter(Boolean);
  } catch {
    return nodes;
  }
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

      // Persist node output as RUNNING
      const outputId = createId();
      await db.executionNodeOutputs.add({
        id: outputId,
        executionId,
        nodeId: node.id,
        nodeType,
        status: "RUNNING",
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

        // Persist success + output
        const datasetRef = Object.values(newVars).find(
          (v): v is DatasetRef =>
            typeof v === "object" && v !== null && (v as DatasetRef).kind === "dataset",
        );

        await db.executionNodeOutputs.update(outputId, {
          status: "SUCCESS",
          variableName: datasetRef?.variableName,
          datasetId: datasetRef?.datasetId,
          inlineOutput: datasetRef ? undefined : newVars,
        });

        // Persist dataset manifest if present
        if (datasetRef) {
          const manifest = (newVars as Record<string, unknown>).manifest;
          if (manifest) {
            await db.datasets.add({
              id: datasetRef.datasetId,
              executionId,
              variableName: datasetRef.variableName,
              // biome-ignore lint/suspicious/noExplicitAny: manifest is typed loosely
              manifest: manifest as any,
            });
          }
        }

        callbacks.onNodeStatusChange(node.id, "success");
      } catch (nodeError) {
        const errorMsg = String(nodeError);
        await db.executionNodeOutputs.update(outputId, {
          status: "FAILED",
          error: errorMsg,
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
