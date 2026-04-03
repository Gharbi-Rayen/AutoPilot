import { NonRetriableError } from "inngest";
import { DATASET_STORAGE } from "@/config/constants";
import { resolveContextSchema } from "@/features/executions/server/datasets/context-resolver";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import {
  applyCsvPredicate,
  availableContextKeys,
  type CsvOperator,
  extractInlineRows,
  resolveContextValue,
  streamContextRows,
  toDatasetRefOutput,
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

    const output = await step.run("csv-filter", async () => {
      let matchedRows = 0;
      const useFastPath =
        !isDatasetRef(source) &&
        inlineRows.length > 0 &&
        inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;

      const filteredRows = async function* () {
        if (useFastPath) {
          for (const row of inlineRows) {
            if (applyCsvPredicate(row, field, operator, data.value)) {
              matchedRows += 1;
              yield row;
            }
          }
          return;
        }

        for await (const row of streamContextRows(source)) {
          if (applyCsvPredicate(row, field, operator, data.value)) {
            matchedRows += 1;
            yield row;
          }
        }
      };

      const manifest = await datasetService.persistRowsFromStream({
        executionId,
        variableName,
        rows: filteredRows(),
        chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
        schema: sourceSchema,
      });

      const datasetRef = toDatasetRefOutput(manifest);

      return {
        ...datasetRef,
        summary: {
          sourceRows,
          matchedRows,
          filteredOut: Math.max(sourceRows - matchedRows, 0),
          field,
          operator,
        },
      };
    });

    return {
      [variableName]: output,
    };
  });
