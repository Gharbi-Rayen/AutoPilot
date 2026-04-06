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

type CsvColumnStatsData = {
  sourceVariable?: string;
  variableName?: string;
  fields?: string | string[];
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

const collectFieldNames = (rows: Array<Record<string, unknown>>): string[] =>
  Array.from(new Set(rows.flatMap((row) => Object.keys(row))));

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

    const output = await step.run("csv-column-stats", async () => {
      const requestedFields = Array.isArray(data.fields)
        ? data.fields
        : parseCommaList(data.fields);

      const fields =
        requestedFields.length > 0
          ? requestedFields
          : !isDatasetRef(source)
            ? collectFieldNames(inlineRows)
            : source.schema
              ? Object.keys(source.schema)
              : [];

      if (fields.length === 0) {
        throw new NonRetriableError(
          "fields is required when source is a dataset reference",
        );
      }

      const MAX_UNIQUE_VALUES_TRACKED = 10_000;

      const stats = new Map<
        string,
        {
          total: number;
          nonNull: number;
          nullCount: number;
          numericCount: number;
          sum: number;
          min: number | null;
          max: number | null;
          uniqueValues: Set<string>;
          frequencies: Map<string, number>;
          frequencyTableTruncated: boolean;
        }
      >();

      for (const field of fields) {
        stats.set(field, {
          total: sourceRows,
          nonNull: 0,
          nullCount: 0,
          numericCount: 0,
          sum: 0,
          min: null,
          max: null,
          uniqueValues: new Set<string>(),
          frequencies: new Map<string, number>(),
          frequencyTableTruncated: false,
        });
      }

      const useFastPath =
        !isDatasetRef(source) &&
        inlineRows.length > 0 &&
        inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;

      const consumeRow = (row: Record<string, unknown>) => {
        for (const field of fields) {
          const entry = stats.get(field);
          if (!entry) {
            continue;
          }

          const value = row[field];
          const isNullish =
            value === undefined ||
            value === null ||
            (typeof value === "string" && value.trim() === "");

          if (isNullish) {
            entry.nullCount += 1;
            continue;
          }

          entry.nonNull += 1;

          const serialized = String(value);
          
          if (
            entry.uniqueValues.size < MAX_UNIQUE_VALUES_TRACKED ||
            entry.uniqueValues.has(serialized)
          ) {
            entry.uniqueValues.add(serialized);
            entry.frequencies.set(
              serialized,
              (entry.frequencies.get(serialized) || 0) + 1,
            );
          } else {
            entry.frequencyTableTruncated = true;
          }

          const numericValue = parseNumber(value);
          if (numericValue !== null) {
            entry.numericCount += 1;
            entry.sum += numericValue;
            entry.min =
              entry.min === null
                ? numericValue
                : Math.min(entry.min, numericValue);
            entry.max =
              entry.max === null
                ? numericValue
                : Math.max(entry.max, numericValue);
          }
        }
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

      const records = Array.from(stats.entries()).map(([field, entry]) => {
        const topValues = Array.from(entry.frequencies.entries())
          .sort((left, right) => right[1] - left[1])
          .slice(0, 5)
          .map(([value, count]) => ({ value, count }));

        const isTruncated = entry.frequencyTableTruncated;
        const uniqueCountValue = isTruncated
          ? `${MAX_UNIQUE_VALUES_TRACKED}+`
          : String(entry.uniqueValues.size);

        return {
          field,
          total: entry.total,
          nonNull: entry.nonNull,
          nullCount: entry.nullCount,
          uniqueCount: uniqueCountValue,
          numericCount: entry.numericCount,
          min: entry.min,
          max: entry.max,
          sum: entry.numericCount > 0 ? entry.sum : null,
          avg: entry.numericCount > 0 ? entry.sum / entry.numericCount : null,  
          topValues,
          frequencyTableTruncated: isTruncated,
        };
      });

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
      const columns = Object.fromEntries(
        records.map((record) => [record.field, record]),
      );

      return {
        ...datasetRef,
        summary: {
          rowCount: sourceRows,
          fieldCount: fields.length,
          columns,
        },
      };
    });

    return {
      [variableName]: output,
    };
  });
