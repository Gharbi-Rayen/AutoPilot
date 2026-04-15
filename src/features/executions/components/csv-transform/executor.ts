import { NonRetriableError } from "inngest";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";
import type {
  TransformAction,
  TransformOperator,
  TransformRule,
} from "@/workers/csv-transform.worker";

type CsvTransformData = {
  sourceVariable?: string;
  variableName?: string;
  rules?: TransformRule[];
  matchMode?: "all" | "any";
  caseSensitive?: boolean;
};

type CsvTransformWorkerResult = {
  kind: "dataset";
  datasetId: string;
  executionId: string;
  variableName: string;
  storage: string;
  manifestVersion: number;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: Record<string, unknown>;
  summary: {
    inputRows: number;
    outputRows: number;
    deletedRows: number;
    modifiedRows: number;
  };
};

export { TransformOperator, TransformAction, TransformRule };

export const CsvTransformExecutor: NodeExecutor<CsvTransformData> = async ({
  data,
  nodeId,
  executionId,
  context,
  publish,
  step,
}) =>
  withCsvNodeStatus(nodeId, publish, async () => {
    if (!executionId) {
      throw new NonRetriableError(
        "Execution context is missing executionId for csv-transform",
      );
    }

    const variableName = data.variableName?.trim();
    const sourceVariable = data.sourceVariable?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    const rules = data.rules ?? [];
    if (rules.length === 0) {
      throw new NonRetriableError("At least one transform rule is required");
    }

    for (const rule of rules) {
      if (!rule.column?.trim()) {
        throw new NonRetriableError("Each rule must specify a column");
      }
      if (!rule.operator) {
        throw new NonRetriableError("Each rule must specify an operator");
      }
      if (!rule.action) {
        throw new NonRetriableError("Each rule must specify an action");
      }
    }

    const source = resolveContextValue(context, sourceVariable);
    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${sourceVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const inlineRows = extractInlineRows(source);
    const sourceRows = isDatasetRef(source)
      ? source.rowCount
      : inlineRows.length;

    if (sourceRows === 0) {
      throw new NonRetriableError(
        "Source variable must contain CSV records (array, records payload, or DatasetRef)",
      );
    }

    const completionPromise = step.waitForEvent("wait-for-csv-transform", {
      event: "csv/transform.complete",
      match: "data.executionId",
      timeout: "60m",
    });

    const { randomUUID } = await import("node:crypto");
    const datasetId = randomUUID();

    await step.run("enqueue-csv-transform", async () => {
      const { getCsvTransformQueue } = await import("@/lib/worker-queue");
      const queue = getCsvTransformQueue();
      await queue.add(
        "transform",
        {
          executionId,
          datasetId,
          variableName,
          sourceRef: source,
          rules,
          matchMode: data.matchMode ?? "all",
          caseSensitive: data.caseSensitive ?? false,
        },
        {
          jobId: `${executionId}-${datasetId}`,
          removeOnComplete: 50,
          removeOnFail: 20,
        },
      );
    });

    const completion = await completionPromise;
    const failureMessage = completion?.data?.error ?? completion?.data?.reason;

    if (typeof failureMessage === "string" && failureMessage.length > 0) {
      throw new NonRetriableError(`CSV transform failed: ${failureMessage}`);
    }

    if (!completion || !completion.data?.result) {
      throw new NonRetriableError(
        "Wait for csv transform timed out after 60 minutes",
      );
    }

    const output = completion.data.result as CsvTransformWorkerResult;

    return { [variableName]: output };
  });
