import { randomUUID } from "node:crypto";
import { NonRetriableError } from "inngest";
import { DATASET_STORAGE, EXECUTION_LIMITS } from "@/config/constants";
import { getExecutor } from "@/features/executions/components/lib/executor-registry";
import {
  buildExecutionOutputSummary,
  persistContextValueIfNeeded,
} from "@/features/executions/server/datasets/context-resolver";
import {
  acquireExecutionSlot,
  releaseExecutionSlot,
} from "@/features/executions/server/execution-queue";
import {
  finishNodeMetricCapture,
  type NodeExecutionMetric,
  startNodeMetricCapture,
  summarizeNodeExecutionMetrics,
} from "@/features/executions/server/metrics/node-execution-metrics";
import { runFusedCsvParseFilterAggregate } from "@/features/executions/server/pipeline/fused-runner";
import {
  type FusionPlannerNode,
  planLinearFusionChains,
} from "@/features/executions/server/pipeline/fusion-planner";
import {
  classifyExecutionProfile,
  type ExecutionResourceProfile,
} from "@/features/executions/server/queue-policy";
import {
  clearExecutionBudget,
  getExecutionBudgetSnapshot,
  initializeExecutionBudget,
} from "@/features/executions/server/resource-budget";
import { NodeType } from "@/generated/prisma";
import prisma from "@/lib/db";
import { FileChannel } from "./channels/file";
import { ManualTriggerChannel } from "./channels/manual-triggers";
import { WhatsAppChannel } from "./channels/whatsapp";
import { inngest } from "./client";
import { topologicalSort } from "./utils";

type ExecutionContext = Record<string, unknown>;

type SortableNode = {
  id: string;
  type: NodeType;
  name: string;
  data: unknown;
};

type WorkflowConnection = {
  fromNodeId: string;
  toNodeId: string;
};

type LargeArrayOutputDetail = {
  path: string;
  length: number;
};

const inferTriggerTypesFromContext = (
  _initialContext: ExecutionContext,
): NodeType[] => {
  return [NodeType.MANUAL_TRIGGER];
};

const collectReachableNodeIds = (
  startNodeIds: string[],
  connections: WorkflowConnection[],
) => {
  const adjacencyMap = new Map<string, string[]>();

  for (const connection of connections) {
    const neighbors = adjacencyMap.get(connection.fromNodeId) ?? [];
    neighbors.push(connection.toNodeId);
    adjacencyMap.set(connection.fromNodeId, neighbors);
  }

  const visited = new Set<string>();
  const queue = [...startNodeIds];

  while (queue.length > 0) {
    const currentNodeId = queue.shift();

    if (!currentNodeId || visited.has(currentNodeId)) {
      continue;
    }

    visited.add(currentNodeId);

    const downstreamNodes = adjacencyMap.get(currentNodeId) ?? [];
    for (const downstreamNodeId of downstreamNodes) {
      if (!visited.has(downstreamNodeId)) {
        queue.push(downstreamNodeId);
      }
    }
  }

  return visited;
};

const resolveExecutionNodes = ({
  sortedNodes,
  connections,
  initialContext,
}: {
  sortedNodes: SortableNode[];
  connections: WorkflowConnection[];
  initialContext: ExecutionContext;
}) => {
  const startTriggerTypes = inferTriggerTypesFromContext(initialContext);
  const startNodeIds = sortedNodes
    .filter((node) => startTriggerTypes.includes(node.type))
    .map((node) => node.id);

  if (startNodeIds.length === 0) {
    return sortedNodes;
  }

  const reachableNodeIds = collectReachableNodeIds(startNodeIds, connections);
  const executionNodes = sortedNodes.filter((node) =>
    reachableNodeIds.has(node.id),
  );

  return executionNodes.length > 0 ? executionNodes : sortedNodes;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isDatasetReferenceLike = (value: Record<string, unknown>) => {
  return (
    value.kind === "dataset" &&
    typeof value.datasetId === "string" &&
    typeof value.executionId === "string"
  );
};

const collectLargeArrayOutputs = ({
  value,
  path,
  maxRows,
  output,
  visited,
}: {
  value: unknown;
  path: string;
  maxRows: number;
  output: LargeArrayOutputDetail[];
  visited: WeakSet<object>;
}) => {
  if (output.length >= 5) {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > maxRows) {
      output.push({
        path,
        length: value.length,
      });
      return;
    }

    // Scan a small sample of children to keep guard overhead bounded.
    const sampleSize = Math.min(value.length, 25);
    for (let index = 0; index < sampleSize; index += 1) {
      collectLargeArrayOutputs({
        value: value[index],
        path: `${path}[${index}]`,
        maxRows,
        output,
        visited,
      });

      if (output.length >= 5) {
        return;
      }
    }

    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (isDatasetReferenceLike(value)) {
    return;
  }

  if (visited.has(value)) {
    return;
  }

  visited.add(value);

  for (const [key, child] of Object.entries(value)) {
    collectLargeArrayOutputs({
      value: child,
      path: `${path}.${key}`,
      maxRows,
      output,
      visited,
    });

    if (output.length >= 5) {
      return;
    }
  }
};

const assertNoLargeArrayOutput = ({
  nodeId,
  nodeType,
  output,
}: {
  nodeId: string;
  nodeType: string;
  output: unknown;
}) => {
  const maxRows = DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;
  const largeOutputs: LargeArrayOutputDetail[] = [];

  collectLargeArrayOutputs({
    value: output,
    path: "output",
    maxRows,
    output: largeOutputs,
    visited: new WeakSet<object>(),
  });

  if (largeOutputs.length === 0) {
    return;
  }

  const details = largeOutputs
    .slice(0, 3)
    .map((entry) => `${entry.path}: ${entry.length} rows`)
    .join(", ");

  throw new NonRetriableError(
    `Node '${nodeId}' (${nodeType}) returned large in-memory array output(s) [${details}]. Large arrays must be persisted as DatasetRef instead of being returned directly.`,
  );
};

export const executeWorkflow = inngest.createFunction(
  {
    id: "execute/workflow",
    retries: 0, // remove in production
  },
  {
    event: "workflows/execute.workflow",
    channels: [ManualTriggerChannel(), WhatsAppChannel(), FileChannel()],
  },
  async ({ event, step, publish }) => {
    console.log("[Inngest] executeWorkflow triggered with event:", {
      name: event.name,
      workflowId: event.data.workflowId,
      hasInitialData: !!event.data.initialData,
    });

    const workflowId = event.data.workflowId;

    if (!workflowId) {
      throw new NonRetriableError("No workflow ID provided");
    }

    const initialContext =
      (event.data.initialData as Record<string, unknown> | undefined) ?? {};

    // 1. Get or Create Execution Record
    const executionId = await step.run("get-or-create-execution", async () => {
      // If passed from manual trigger, use that ID
      if (
        event.data.executionId &&
        typeof event.data.executionId === "string"
      ) {
        return event.data.executionId;
      }

      // Check if already exists by Inngest Event ID (idempotency)
      if (event.id) {
        const existing = await prisma.execution.findUnique({
          where: { inngestEventId: event.id },
          select: { id: true },
        });

        if (existing) {
          return existing.id;
        }
      }

      // Create new execution record
      const newExecution = await prisma.execution.create({
        data: {
          workflowId,
          status: "RUNNING",
          inngestEventId: event.id ?? randomUUID(),
          startedAt: new Date(),
        },
        select: { id: true },
      });

      return newExecution.id;
    });

    initializeExecutionBudget(executionId);

    // Fetch the workflow directly without wrapping in a step.run
    // This prevents massive workflow properties (e.g. 5MB base64 JSON in node data)
    // from being serialized and passed continuously through the Inngest HTTP pipeline,
    // which caused Next.js 4MB body size limits to slice the JSON and crash with "Unexpected end of JSON input".
    console.log("[Inngest] Fetching workflow:", workflowId);

    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      include: {
        nodes: true,
        connections: true,
      },
    });

    if (!workflow) {
      console.error("[Inngest] Workflow not found:", workflowId);
      throw new NonRetriableError(`Workflow not found: ${workflowId}`);
    }

    console.log("[Inngest] Workflow found:", {
      id: workflow.id,
      name: workflow.name,
      nodeCount: workflow.nodes.length,
      connectionCount: workflow.connections.length,
    });

    const workflowData = {
      userId: workflow.userId,
      connections: workflow.connections,
      sortedNodes: topologicalSort(workflow.nodes, workflow.connections),
    };

    const executionNodes = resolveExecutionNodes({
      sortedNodes: workflowData.sortedNodes,
      connections: workflowData.connections,
      initialContext,
    }).map((node) => {
      const cleanData = isRecord(node.data)
        ? { ...node.data }
        : (node.data as Record<string, unknown>) || {};

      for (const key of Object.keys(cleanData)) {
        const val = cleanData[key];
        if (typeof val === "string" && val.length > 10_000) {
          delete cleanData[key];
        }
      }

      return { ...node, data: cleanData };
    });

    // Strip unneeded nodes from closure to prevent Inngest from serializing huge workflow blobs
    delete (workflow as any).nodes;
    delete (workflowData as any).sortedNodes;

    const totalPayloadSize = JSON.stringify(executionNodes).length;
    console.log(
      `[Inngest] executionNodes payload: ${(totalPayloadSize / 1024).toFixed(1)}KB`,
    );
    if (totalPayloadSize > 500_000) {
      throw new Error(
        `[Inngest] executionNodes payload too large (${totalPayloadSize} bytes). ` +
          `A node contains an inline blob that was not scrubbed. Check node data fields.`,
      );
    }

    const executionProfileFromEvent =
      event.data.executionProfile === "heavy" ||
      event.data.executionProfile === "standard"
        ? (event.data.executionProfile as ExecutionResourceProfile)
        : null;

    const executionProfile =
      executionProfileFromEvent ??
      classifyExecutionProfile(executionNodes.map((node) => node.type));

    // Resolve the workflow owner for credential ownership checks
    const ownerId = await step.run("find-user-id", async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: workflowData.userId },
        select: { id: true },
      });
      return user.id;
    });

    let context: ExecutionContext = initialContext;
    const nodeMetrics: NodeExecutionMetric[] = [];
    console.log("[Inngest] Initial context keys:", Object.keys(context));

    try {
      await step.run("acquire-execution-slot", async () => {
        await acquireExecutionSlot({
          executionId,
          profile: executionProfile,
        });
      });

      //execute each node

      console.log("[Inngest] Executing", executionNodes.length, "nodes");

      const fusionPlans = planLinearFusionChains({
        nodes: executionNodes.map((node) => ({
          id: node.id,
          type: node.type,
          data: node.data,
        })),
        connections: workflowData.connections.map((connection) => ({
          fromNodeId: connection.fromNodeId,
          toNodeId: connection.toNodeId,
        })),
      });

      const fusionPlansByStartIndex = new Map(
        fusionPlans.map((plan) => [plan.startIndex, plan] as const),
      );

      const executionNodesById = new Map<string, FusionPlannerNode>(
        executionNodes.map((node) => [
          node.id,
          {
            id: node.id,
            type: node.type,
            data: node.data,
          },
        ]),
      );

      if (fusionPlans.length > 0) {
        console.log(
          "[Inngest] Fusion plans detected:",
          fusionPlans.map((plan) => plan.nodeIds.join(" -> ")),
        );
      }

      for (
        let nodeIndex = 0;
        nodeIndex < executionNodes.length;
        nodeIndex += 1
      ) {
        const node = executionNodes[nodeIndex];
        if (!node) {
          continue;
        }

        const executionState = await step.run(
          `check-execution-${node.id}`,
          async () => {
            return prisma.execution.findUnique({
              where: { id: executionId },
              select: { status: true, error: true },
            });
          },
        );
        const fusionPlan = fusionPlansByStartIndex.get(nodeIndex);
        if (fusionPlan) {
          console.log("[Inngest] Executing fused chain:", fusionPlan.nodeIds);

          const fusionInput = context;
          const metricCapture = startNodeMetricCapture();

          const fusedResult = await runFusedCsvParseFilterAggregate({
            plan: fusionPlan,
            executionId,
            context,
            step,
            publish,
            nodesById: executionNodesById,
          });

          for (const fusedNodeOutput of fusedResult.nodeOutputs) {
            const outputEntries = Object.entries(fusedNodeOutput.output);
            const normalizedOutputEntries = await Promise.all(
              outputEntries.map(async ([key, value]) => {
                const normalizedValue = await persistContextValueIfNeeded({
                  executionId,
                  variableName: key,
                  value,
                });

                return [key, normalizedValue] as const;
              }),
            );

            const normalizedOutput = Object.fromEntries(
              normalizedOutputEntries,
            ) as ExecutionContext;

            context = {
              ...context,
              ...normalizedOutput,
            };

            console.log(
              "[Inngest] Node completed (fused):",
              fusedNodeOutput.nodeId,
            );
          }

          nodeMetrics.push(
            finishNodeMetricCapture({
              capture: metricCapture,
              nodeId: fusionPlan.nodeIds.join("->"),
              nodeType: "FUSED_CSV_PARSE_FILTER_AGGREGATE",
              input: fusionInput,
              output: context,
            }),
          );

          nodeIndex = fusionPlan.endIndex;
          continue;
        }

        if (!executionState) {
          throw new NonRetriableError("Execution record no longer exists.");
        }

        if (executionState.status !== "RUNNING") {
          throw new NonRetriableError(
            executionState.error ?? "Execution paused by user.",
          );
        }

        console.log("[Inngest] Executing node:", {
          id: node.id,
          type: node.type,
          name: node.name,
        });

        const executor = getExecutor(node.type as NodeType);
        const metricCapture = startNodeMetricCapture();
        const output = await executor({
          data: node.data as Record<string, unknown>,
          nodeId: node.id,
          executionId,
          context,
          step,
          publish,
          userId: ownerId,
        });

        assertNoLargeArrayOutput({
          nodeId: node.id,
          nodeType: String(node.type),
          output,
        });

        nodeMetrics.push(
          finishNodeMetricCapture({
            capture: metricCapture,
            nodeId: node.id,
            nodeType: String(node.type),
            input: context,
            output,
          }),
        );

        const outputEntries = Object.entries(output);
        const normalizedOutputEntries = await Promise.all(
          outputEntries.map(async ([key, value]) => {
            const normalizedValue = await persistContextValueIfNeeded({
              executionId,
              variableName: key,
              value,
            });

            return [key, normalizedValue] as const;
          }),
        );

        const normalizedOutput = Object.fromEntries(
          normalizedOutputEntries,
        ) as ExecutionContext;

        context = {
          ...context,
          ...normalizedOutput,
        };

        console.log("[Inngest] Node completed:", node.id);
      }

      // Mark execution as SUCCESS
      await step.run("complete-execution", async () => {
        const outputSummary = buildExecutionOutputSummary(context);
        const resourceBudget = getExecutionBudgetSnapshot(executionId);
        const executionPerformance = summarizeNodeExecutionMetrics(nodeMetrics);
        const outputWithMetrics: Record<string, unknown> = {
          ...outputSummary,
          __executionMetrics: nodeMetrics,
          __executionPerformance: executionPerformance,
          __resourceBudget: resourceBudget,
        };

        const outputSizeBytes = Buffer.byteLength(
          JSON.stringify(outputWithMetrics),
        );

        const persistedOutput =
          outputSizeBytes > EXECUTION_LIMITS.MAX_EXECUTION_OUTPUT_BYTES
            ? {
                __outputLimit: {
                  truncated: true,
                  maxBytes: EXECUTION_LIMITS.MAX_EXECUTION_OUTPUT_BYTES,
                  actualBytes: outputSizeBytes,
                  message:
                    "Execution output exceeded the configured size limit and was truncated.",
                },
                __executionMetrics: nodeMetrics,
                __executionPerformance: executionPerformance,
                __resourceBudget: resourceBudget,
              }
            : outputWithMetrics;

        await prisma.execution.update({
          where: { id: executionId },
          data: {
            status: "SUCCESS",
            finishedAt: new Date(),
            // @ts-expect-error: persistedOutput is a JSON-serializable object stored in the Json output field.
            output: persistedOutput,
          },
        });

        await releaseExecutionSlot(executionId);
        clearExecutionBudget(executionId);
      });
    } catch (error) {
      console.error("[Inngest] Workflow execution failed:", {
        workflowId,
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Mark execution as FAILED
      await step.run("fail-execution", async () => {
        const currentExecution = await prisma.execution.findUnique({
          where: { id: executionId },
          select: { status: true },
        });

        if (!currentExecution || currentExecution.status !== "RUNNING") {
          return;
        }

        await prisma.execution.update({
          where: { id: executionId },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
          },
        });

        // Clean up any heavy dataset files generated before failure to save disk space
        const { getExecutionDatasetsDirectory } = await import(
          "@/features/executions/server/datasets/paths"
        );
        const { rm } = await import("node:fs/promises");
        try {
          await rm(getExecutionDatasetsDirectory(executionId), {
            recursive: true,
            force: true,
          });
        } catch (cleanupError) {
          console.warn(
            "[Inngest] Failed to cleanup execution directory on failure:",
            cleanupError,
          );
        }

        await releaseExecutionSlot(executionId);
        clearExecutionBudget(executionId);
      });

      throw error; // Re-throw to allow Inngest retries if configured (though retries=0 currently)
    }

    return {
      workflowId,
      result: context,
    };
  },
);
