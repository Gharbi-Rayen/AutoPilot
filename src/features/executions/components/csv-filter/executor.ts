import { NonRetriableError } from "inngest";
import { resolveContextSchema } from "@/features/executions/server/datasets/context-resolver";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import {
  availableContextKeys,
  type CsvOperator,
  extractInlineRows,
  resolveContextValue,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvFilterData = {
  sourceVariable?: string;
  variableName?: string;
  field?: string;
  operator?: CsvOperator;
  value?: string;
};

type CsvFilterWorkerResult = {
  datasetRef: {
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
  summary: {
    sourceRows: number;
    matchedRows: number;
    filteredOut: number;
    field: string;
    operator: CsvOperator;
    value?: string;
  };
};

export const CsvFilterExecutor: NodeExecutor<CsvFilterData> = async ({
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
        "Execution context is missing executionId for csv-filter",
      );
    }

    const variableName = data.variableName?.trim();
    const sourceVariable = data.sourceVariable?.trim();
    const field = data.field?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    if (!field) {
      throw new NonRetriableError("Field is required");
    }

    const source = resolveContextValue(context, sourceVariable);
    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${sourceVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const sourceSchema = resolveContextSchema(source);
    const inlineRows = extractInlineRows(source);
    const sourceRows = isDatasetRef(source)
      ? source.rowCount
      : inlineRows.length;

    if (sourceRows === 0) {
      throw new NonRetriableError(
        "Source variable must contain CSV records (array, records payload, or DatasetRef)",
      );
    }

    const operator = data.operator ?? "eq";

    const completionPromise = step.waitForEvent(
      "wait-for-csv-filter-complete",
      {
        event: "csv/filter.complete",
        match: "data.executionId",
        timeout: "60m",
      },
    );

    const { randomUUID } = await import("node:crypto");
    const datasetId = randomUUID();

    await step.run("enqueue-csv-filter", async () => {
      const { getCsvFilterQueue } = await import("@/lib/worker-queue");
      const queue = getCsvFilterQueue();
      await queue.add(
        "filter",
        {
          executionId,
          datasetId,
          nodeId,
          variableName,
          sourceRef: source,
          field,
          operator,
          value: data.value,
          sourceRows,
          sourceSchema,
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
      throw new NonRetriableError(`CSV filter failed: ${failureMessage}`);
    }

    if (!completion || !completion.data?.result) {
      throw new NonRetriableError(
        "Wait for csv filter timed out after 60 minutes",
      );
    }

    const output = completion.data.result as CsvFilterWorkerResult;

    if (!output.datasetRef?.datasetId) {
      throw new NonRetriableError(
        "CSV filter worker returned an invalid dataset reference",
      );
    }

    return {
      [variableName]: {
        ...output.datasetRef,
        summary: output.summary,
      },
    };
  });
