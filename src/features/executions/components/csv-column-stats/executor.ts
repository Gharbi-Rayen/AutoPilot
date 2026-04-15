import { NonRetriableError } from "inngest";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvColumnStatsData = {
  sourceVariable?: string;
  variableName?: string;
  fields?: string | string[];
};

type CsvColumnStatsWorkerResult = {
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
    rowCount: number;
    fieldCount: number;
    columns: Record<string, unknown>;
  };
};

const parseCommaList = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

export const CsvColumnStatsExecutor: NodeExecutor<CsvColumnStatsData> = async ({
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
        "Execution context is missing executionId for csv-column-stats",
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

    const requestedFields = Array.isArray(data.fields)
      ? data.fields
      : parseCommaList(data.fields);

    const completionPromise = step.waitForEvent("wait-for-csv-column-stats", {
      event: "csv/column-stats.complete",
      match: "data.executionId",
      timeout: "60m",
    });

    await step.run("enqueue-csv-column-stats", async () => {
      const { getCsvColumnStatsQueue } = await import("@/lib/worker-queue");
      const queue = getCsvColumnStatsQueue();
      await queue.add(
        "column-stats",
        {
          executionId,
          variableName,
          sourceRef: source,
          sourceRows,
          fields: requestedFields,
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
      throw new NonRetriableError(`CSV column stats failed: ${failureMessage}`);
    }

    if (!completion || !completion.data?.result) {
      throw new NonRetriableError(
        "Wait for csv column stats timed out after 60 minutes",
      );
    }

    const output = completion.data.result as CsvColumnStatsWorkerResult;

    return {
      [variableName]: output,
    };
  });
