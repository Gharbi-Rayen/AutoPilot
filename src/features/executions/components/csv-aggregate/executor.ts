import { NonRetriableError } from "inngest";
import { DATASET_STORAGE } from "@/config/constants";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import {
  applySchemaToRows,
  inferDatasetSchema,
} from "@/features/executions/server/datasets/schema-inference";
import {
  availableContextKeys,
  extractInlineRows,
  parseNumber,
  resolveContextValue,
  streamContextRows,
  toDatasetRefOutput,
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

    const output = await step.run("csv-aggregate", async () => {
      if (operation !== "count" && !targetField) {
        throw new NonRetriableError(
          "targetField is required for sum/avg/min/max operations",
        );
      }

      const buckets = new Map<
        string,
        {
          count: number;
          numericCount: number;
          sum: number;
          min: number | null;
          max: number | null;
        }
      >();

      const useFastPath =
        !isDatasetRef(source) &&
        inlineRows.length > 0 &&
        inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;

      const consumeRow = (row: Record<string, unknown>) => {
        const key = String(row[groupBy] ?? "");
        const bucket = buckets.get(key) || {
          count: 0,
          numericCount: 0,
          sum: 0,
          min: null,
          max: null,
        };

        bucket.count += 1;

        if (operation !== "count" && targetField) {
          const numberValue = parseNumber(row[targetField]);
          if (numberValue !== null) {
            bucket.numericCount += 1;
            bucket.sum += numberValue;
            bucket.min =
              bucket.min === null
                ? numberValue
                : Math.min(bucket.min, numberValue);
            bucket.max =
              bucket.max === null
                ? numberValue
                : Math.max(bucket.max, numberValue);
          }
        }

        buckets.set(key, bucket);
      };

      if (useFastPath) {
        for (const row of inlineRows) {
          consumeRow(row);
        }
      } else {
        for await (const row of streamContextRows(source)) {
          consumeRow(row);
        }
      }

      const records = Array.from(buckets.entries()).map(
        ([groupKey, bucket]) => {
          const result: Record<string, unknown> = {
            [groupBy]: groupKey,
            count: bucket.count,
            numericCount: bucket.numericCount,
          };

          if (operation === "count") {
            result.value = bucket.count;
            return result;
          }

          if (bucket.numericCount === 0) {
            result.value = null;
            return result;
          }

          if (operation === "sum") {
            result.value = bucket.sum;
            return result;
          }

          if (operation === "avg") {
            result.value = bucket.sum / bucket.numericCount;
            return result;
          }

          if (operation === "min") {
            result.value = bucket.min;
            return result;
          }

          result.value = bucket.max;
          return result;
        },
      );

      const schema = inferDatasetSchema(records);
      const typedRecords = applySchemaToRows(records, schema);

      const manifest = await datasetService.persistRowsFromStream({
        executionId,
        variableName,
        rows: typedRecords,
        chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
        schema,
      });

      const datasetRef = toDatasetRefOutput(manifest);

      return {
        ...datasetRef,
        summary: {
          sourceRows,
          groupCount: records.length,
          operation,
          targetField: targetField ?? null,
        },
      };
    });

    return {
      [variableName]: output,
    };
  });
