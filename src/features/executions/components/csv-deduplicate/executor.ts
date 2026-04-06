import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { NonRetriableError } from "inngest";
import { DATASET_STORAGE } from "@/config/constants";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import {
  applySchemaToRows,
  inferDatasetSchema,
} from "@/features/executions/server/datasets/schema-inference";
import type { DatasetSchema } from "@/features/executions/server/datasets/schema-types";
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

type CsvDeduplicateData = {
  sourceVariable?: string;
  variableName?: string;
  fields?: string;
  keep?: "first" | "last";
  includeDuplicates?: boolean;
};

const parseCommaList = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const buildDedupeKey = (row: Record<string, unknown>, fields: string[]): string => {
  return fields
    .map((field) => {
      const val = String(row[field] ?? "");
      return `${val.length}:${val}`;
    })
    .join("|");
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
    const sourceRows = isDatasetRef(source) ? source.rowCount : inlineRows.length;

    if (sourceRows === 0) {
      throw new NonRetriableError(
        "Source variable must contain CSV records (array, records payload, or DatasetRef)",
      );
    }

    const output = await step.run("csv-deduplicate", async () => {
      const fieldsStr = data.fields?.trim();
      const fields = parseCommaList(fieldsStr);

      if (fields.length === 0) {
        throw new NonRetriableError(
          "At least one field is required to deduplicate by",
        );
      }

      const keep = data.keep || "first";
      // To implement 'last', we would either have to read backwards, 
      // or record the latest row seen per key, which means storing the row in memory.
      // But keeping in memory is too large for large data...
      // For now, let's implement naive first/last logic based on branching.
      // Wait, let's handle "last" strictly:
      
      const useFastPath =
        !isDatasetRef(source) &&
        inlineRows.length > 0 &&
        inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;

      let finalRecords: Record<string, unknown>[] = [];
      let schema: DatasetSchema = {};

      if (useFastPath) {
        const seen = new Set<string>();
        // For inline rows, 'last' can be done by traversing backwards.
        const rows = keep === "last" ? [...inlineRows].reverse() : inlineRows;
        
        for (const row of rows) {
          const key = buildDedupeKey(row, fields);
          if (!seen.has(key)) {
            seen.add(key);
            finalRecords.push(row);
          }
        }
        
        if (keep === "last") {
          finalRecords.reverse();
        }

        schema = inferDatasetSchema(finalRecords);
        finalRecords = applySchemaToRows(finalRecords, schema);

      } else {
        // Slow path: temp file persistence
        const tempManager = new TempFileManager({ executionId });
        try {
          const tempPath = await tempManager.createTempFilePath("dedupe-out");
          const outStream = createWriteStream(tempPath);
          const writeLine = async (line: string) => {
            if (!outStream.write(line)) {
              await once(outStream, "drain");
            }
          };

          let deduplicatedRowsCount = 0;
          let schemaTracker: Record<string, unknown>[] = [];

          if (keep === "first") {
            // First loop through all rows.
            // We can't easily hold millions of keys in memory safely.
            const seen = new Set<string>(); // Could grow big, but maybe manageable for typical datasets
            for await (const row of streamContextRows(source)) {
              const key = buildDedupeKey(row, fields);
              if (!seen.has(key)) {
                seen.add(key);
                await writeLine(JSON.stringify(row) + "\n");
                deduplicatedRowsCount++;
                if (schemaTracker.length < 500) {
                  schemaTracker.push(row);
                }
              }
            }
          } else {
            // If it's 'last', it's harder with streaming. We can read all keys and record the last index, then read again yielding those at that index?
            // Actually, keep='last' in large sets: write all to a file, read backwards? Or store index in map.
            // Map<Key, number> is bounded by unique values.
            const lastSeenIndex = new Map<string, number>();
            let idx = 0;
            for await (const row of streamContextRows(source)) {
              const key = buildDedupeKey(row, fields);
              lastSeenIndex.set(key, idx);
              idx++;
            }
            
            // Now read again and keep only the ones that match last index
            let secondIdx = 0;
            for await (const row of streamContextRows(source)) {
              const key = buildDedupeKey(row, fields);
              if (lastSeenIndex.get(key) === secondIdx) {
                await writeLine(JSON.stringify(row) + "\n");
                deduplicatedRowsCount++;
                if (schemaTracker.length < 500) {
                  schemaTracker.push(row);
                }
              }
              secondIdx++;
            }
          }
          
          outStream.end();
          await once(outStream, "close");
          schema = inferDatasetSchema(schemaTracker);

          // Next, rewrite to minio
          const sourceStream = createReadStream(tempPath);
          const manifest = await datasetService.persistRowsFromStream({
            executionId,
            variableName,
            rows: sourceStream,
            chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
            schema,
          });
          
          const datasetRef = toDatasetRefOutput(manifest);
          return {
            ...datasetRef,
            summary: {
              rowCount: deduplicatedRowsCount,
              fieldCount: Object.keys(schema).length,
              columns: {},
            },
          };
        } finally {
          await tempManager.cleanup();
        }
      }

      // Inline final records return
      const manifest = await datasetService.persistRowsFromStream({
        executionId,
        variableName,
        rows: finalRecords,
        chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
        schema,
      });

      const datasetRef = toDatasetRefOutput(manifest);
      return {
        ...datasetRef,
        summary: {
          rowCount: finalRecords.length,
          fieldCount: Object.keys(schema).length,
          columns: {},
        },
      };
    });

    return {
      [variableName]: output,
    };
  });
