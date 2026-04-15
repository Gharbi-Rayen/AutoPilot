import { NonRetriableError } from "inngest";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvDeduplicateData = {
  sourceVariable?: string;
  variableName?: string;
  duplicatesVariableName?: string;
  fields?: string;
  keep?: "first" | "last";
  includeDuplicates?: boolean;
};

type CsvDeduplicateWorkerResult = {
  deduped: {
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
  };
  duplicates?: {
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
  } | null;
};

const parseCommaList = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

export const CsvDeduplicateExecutor: NodeExecutor<CsvDeduplicateData> = async ({
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
        "Execution context is missing executionId for csv-deduplicate",
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

    // Empty fields = compare all columns (handled in the worker by deriving keys from each row)
    const fields = parseCommaList(data.fields?.trim());
    const keep = data.keep || "first";
    const includeDuplicates = data.includeDuplicates ?? false;
    const duplicatesVariableName =
      data.duplicatesVariableName?.trim() || `${variableName}_duplicates`;

    const completionPromise = step.waitForEvent("wait-for-csv-deduplicate", {
      event: "csv/deduplicate.complete",
      match: "data.executionId",
      timeout: "60m",
    });

    await step.run("enqueue-csv-deduplicate", async () => {
      const { getCsvDeduplicateQueue } = await import("@/lib/worker-queue");
      const queue = getCsvDeduplicateQueue();
      await queue.add(
        "deduplicate",
        {
          executionId,
          variableName,
          duplicatesVariableName,
          sourceRef: source,
          sourceRows,
          fields,
          keep,
          includeDuplicates,
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
      throw new NonRetriableError(`CSV deduplicate failed: ${failureMessage}`);
    }

    if (!completion || !completion.data?.result) {
      throw new NonRetriableError(
        "Wait for csv deduplicate timed out after 60 minutes",
      );
    }

    const output = completion.data.result as CsvDeduplicateWorkerResult;

    const result: Record<string, unknown> = {
      [variableName]: output.deduped,
    };

    if (includeDuplicates && output.duplicates) {
      result[duplicatesVariableName] = output.duplicates;
    }

    return result;
  });
