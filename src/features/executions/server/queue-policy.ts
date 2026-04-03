import { DATASET_STORAGE } from "@/config/constants";
import { NodeType } from "@/generated/prisma";

export type ExecutionResourceProfile = "heavy" | "standard";

const HEAVY_NODE_TYPES = new Set<string>([
  NodeType.CSV_PARSE,
  NodeType.CSV_SORT,
  NodeType.CSV_JOIN,
  NodeType.CSV_COMPARE,
  NodeType.CSV_AGGREGATE,
  NodeType.CSV_COLUMN_STATS,
]);

export const classifyExecutionProfile = (
  nodeTypes: Array<NodeType | string>,
): ExecutionResourceProfile => {
  for (const nodeType of nodeTypes) {
    if (HEAVY_NODE_TYPES.has(String(nodeType))) {
      return "heavy";
    }
  }

  return "standard";
};

export const getExecutionQueuePolicy = () => {
  return {
    maxConcurrentHeavyExecutions:
      DATASET_STORAGE.MAX_CONCURRENT_HEAVY_EXECUTIONS,
    queuePollIntervalMs: DATASET_STORAGE.EXECUTION_QUEUE_POLL_INTERVAL_MS,
    maxQueueWaitMs: DATASET_STORAGE.EXECUTION_QUEUE_MAX_WAIT_MS,
  };
};
