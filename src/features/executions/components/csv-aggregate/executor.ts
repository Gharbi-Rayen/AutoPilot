import { NonRetriableError } from "inngest";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvAggregateData = {
  sourceVariable?: string;
  variableName?: string;
  groupBy?: string;
  operation?: "count" | "sum" | "avg" | "min" | "max";
  targetField?: string;
};

type CsvAggregateWorkerResult = {
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
    sourceRows: number;
    groupCount: number;
    operation: "count" | "sum" | "avg" | "min" | "max";
    targetField: string | null;
  };
};

export const CsvAggregateExecutor: NodeExecutor<CsvAggregateData> = async ({
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
        "Execution context is missing executionId for csv-aggregate",
      );
    }

    const variableName = data.variableName?.trim();
    const sourceVariable = data.sourceVariable?.trim();
    const groupBy = data.groupBy?.trim();
    const targetField = data.targetField?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    if (!groupBy) {
      throw new NonRetriableError("Group by field is required");
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

    const operation = data.operation ?? "count";

    if (operation !== "count" && !targetField) {
      throw new NonRetriableError(
        "targetField is required for sum/avg/min/max operations",
      );
    }

    const completionPromise = step.waitForEvent("wait-for-csv-aggregate", {
      event: "csv/aggregate.complete",
      match: "data.executionId",
      timeout: "60m",
    });

    await step.run("enqueue-csv-aggregate", async () => {
      const { getCsvAggregateQueue } = await import("@/lib/worker-queue");
      const queue = getCsvAggregateQueue();
      await queue.add(
        "aggregate",
        {
          executionId,
          variableName,
          sourceRef: source,
          sourceRows,
          groupBy,
          operation,
          targetField,
        },
        {
          jobId: `${executionId}-${variableName}`,
          removeOnComplete: 50,
          removeOnFail: 20,
        },
      );
    });

    const completion = await completionPromise;
    const failureMessage = completion?.data?.error ?? completion?.data?.reason;

    if (typeof failureMessage === "string" && failureMessage.length > 0) {
      throw new NonRetriableError(`CSV aggregate failed: ${failureMessage}`);
    }

    if (!completion || !completion.data?.result) {
      throw new NonRetriableError(
        "Wait for csv aggregate timed out after 60 minutes",
      );
    }

    const output = completion.data.result as CsvAggregateWorkerResult;

    return {
      [variableName]: output,
    };
  });
