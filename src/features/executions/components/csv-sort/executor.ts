import { NonRetriableError } from "inngest";
import { DATASET_STORAGE } from "@/config/constants";
import { createRowComparator } from "@/features/executions/server/datasets/comparator";
import { resolveContextSchema } from "@/features/executions/server/datasets/context-resolver";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import { externalSortRows } from "@/features/executions/server/datasets/external-sort";
import {
  applySchemaToRows,
  inferDatasetSchema,
} from "@/features/executions/server/datasets/schema-inference";
import { TempFileManager } from "@/features/executions/server/datasets/temp-file-manager";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  streamContextRows,
  toDatasetRefOutput,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvSortData = {
  sourceVariable?: string;
  variableName?: string;
  sortField?: string;
  direction?: "asc" | "desc";
  compareAs?: "string" | "number" | "date";
  nulls?: "first" | "last";
};

export const CsvSortExecutor: NodeExecutor<CsvSortData> = async ({
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
        "Execution context is missing executionId for csv-sort",
      );
    }

    const variableName = data.variableName?.trim();
    const sourceVariable = data.sourceVariable?.trim();
    const sortField = data.sortField?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    if (!sortField) {
      throw new NonRetriableError("Sort field is required");
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

    const direction = data.direction ?? "asc";
    const compareAs = data.compareAs ?? "string";
    const nulls = data.nulls ?? "last";
    const compareRows = createRowComparator({
      field: sortField,
      direction,
      compareAs,
      nulls,
      schema: sourceSchema,
    });

    const output = await step.run("csv-sort", async () => {
      const useFastPath =
        !isDatasetRef(source) &&
        inlineRows.length > 0 &&
        inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;

      if (useFastPath) {
        const sorted = inlineRows
          .map((row, index) => ({ row, index }))
          .sort((left, right) => {
            const rowComparison = compareRows(left.row, right.row);
            if (rowComparison !== 0) {
              return rowComparison;
            }

            return left.index - right.index;
          })
          .map((entry) => entry.row);

        const schema = sourceSchema ?? inferDatasetSchema(sorted);
        const typedRows = applySchemaToRows(sorted, schema);

        const manifest = await datasetService.persistRowsFromStream({
          executionId,
          variableName,
          rows: typedRows,
          chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
          schema,
        });

        return {
          ...toDatasetRefOutput(manifest),
          summary: {
            sourceRows,
            strategy: "in-memory",
            sortField,
            direction,
            compareAs,
            nulls,
          },
        };
      }

      const tempManager = new TempFileManager({
        scope: `csv-sort-${executionId}-${nodeId}`,
        executionId,
      });

      const externalSort = await externalSortRows({
        source: streamContextRows(source),
        compareRows,
        tempManager,
        runTargetBytes: DATASET_STORAGE.EXTERNAL_SORT_RUN_TARGET_BYTES,
        mergeFanIn: DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN,
      });

      const manifest = await datasetService.persistRowsFromStream({
        executionId,
        variableName,
        rows: externalSort.rows,
        chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
        schema: sourceSchema,
      });

      return {
        ...toDatasetRefOutput(manifest),
        summary: {
          sourceRows,
          strategy: "external",
          sortField,
          direction,
          compareAs,
          nulls,
          runCount: externalSort.runCount,
          mergeFanIn: DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN,
        },
      };
    });

    return {
      [variableName]: output,
    };
  });
