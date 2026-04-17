import Dexie, { type Table } from "dexie";
import type { NodeType } from "@/types/node-type";
import type { DatasetManifest } from "@/types/dataset";

// ─── Domain types ────────────────────────────────────────────────────────────

export interface WorkflowRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNodeRecord {
  /** cuid2 */
  id: string;
  workflowId: string;
  type: NodeType;
  position: { x: number; y: number };
  /** arbitrary node config (filter field, sort column, etc.) */
  data: Record<string, unknown>;
}

export interface WorkflowConnectionRecord {
  id: string;
  workflowId: string;
  fromNodeId: string;
  toNodeId: string;
  fromOutput: string;
  toInput: string;
}

export type ExecutionStatus =
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELED";

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export type NodeExecutionStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

export interface ExecutionNodeOutputRecord {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: NodeType;
  status: NodeExecutionStatus;
  /** name of the output variable bound to this node's result */
  variableName?: string;
  /** id of the dataset in OPFS (if the output is a large dataset) */
  datasetId?: string;
  /** small inline output (if the result fits in memory) */
  inlineOutput?: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface DatasetRecord {
  id: string;
  executionId: string;
  variableName: string;
  manifest: DatasetManifest;
}

// ─── Database class ───────────────────────────────────────────────────────────

export class AutoPilotDB extends Dexie {
  workflows!: Table<WorkflowRecord, string>;
  workflowNodes!: Table<WorkflowNodeRecord, string>;
  workflowConnections!: Table<WorkflowConnectionRecord, string>;
  executions!: Table<ExecutionRecord, string>;
  executionNodeOutputs!: Table<ExecutionNodeOutputRecord, string>;
  datasets!: Table<DatasetRecord, string>;

  constructor() {
    super("autopilot");

    this.version(1).stores({
      workflows: "id, name, createdAt, updatedAt",
      workflowNodes: "id, workflowId, type",
      workflowConnections: "id, workflowId, fromNodeId, toNodeId",
      executions: "id, workflowId, status, startedAt",
      executionNodeOutputs: "id, executionId, nodeId, status",
      datasets: "id, executionId, variableName",
    });
  }
}

export const db = new AutoPilotDB();
