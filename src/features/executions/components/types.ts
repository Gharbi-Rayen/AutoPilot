import type { Realtime } from "@inngest/realtime";
import type { GetStepTools, Inngest } from "inngest";
import type { DatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import type { DatasetSchema } from "@/features/executions/server/datasets/schema-types";

export type workflowContext = Record<string, unknown | DatasetRef>;

export type StepTools = GetStepTools<Inngest.Any>;

export interface NodeExecutorParams<TData = Record<string, unknown>> {
  data: TData;
  nodeId: string;
  executionId?: string;
  context: workflowContext;
  step: StepTools;
  publish: Realtime.PublishFn;
  userId: string;
}

export type NodeExecutor<TData = Record<string, unknown>> = (
  params: NodeExecutorParams<TData>,
) => Promise<workflowContext>;

export interface SchemaAwareDatasetPayload {
  records: Array<Record<string, unknown>>;
  rowCount: number;
  schema?: DatasetSchema;
}
