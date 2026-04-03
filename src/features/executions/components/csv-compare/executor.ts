import { NonRetriableError } from "inngest";
import { DATASET_STORAGE } from "@/config/constants";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  streamContextRows,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvCompareData = {
  leftVariable?: string;
  rightVariable?: string;
  variableName?: string;
  keyField?: string;
  compareFields?: string | string[];
};

const KEY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const parseCommaList = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const stableStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const valuesEqual = (left: unknown, right: unknown): boolean => {
  return stableStringify(left ?? null) === stableStringify(right ?? null);
};

const pushBounded = <T>(target: T[], value: T, limit: number): boolean => {
  if (target.length >= limit) {
    return false;
  }

  target.push(value);
  return true;
};

export const CsvCompareExecutor: NodeExecutor<CsvCompareData> = async ({
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
        "Execution context is missing executionId for csv-compare",
      );
    }

    const variableName = data.variableName?.trim();
    const leftVariable = data.leftVariable?.trim();
    const rightVariable = data.rightVariable?.trim();
    const keyField = data.keyField?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!leftVariable || !rightVariable) {
      throw new NonRetriableError(
        "Both left and right source variables are required",
      );
    }

    if (keyField && !KEY_NAME_PATTERN.test(keyField)) {
      throw new NonRetriableError(
        `keyField '${keyField}' is unsupported. Use a single field name without nesting.`,
      );
    }

    const leftSource = resolveContextValue(context, leftVariable);
    if (leftSource === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Left source variable '${leftVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const rightSource = resolveContextValue(context, rightVariable);
    if (rightSource === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Right source variable '${rightVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const leftInlineRows = extractInlineRows(leftSource);
    const rightInlineRows = extractInlineRows(rightSource);

    const leftRows = isDatasetRef(leftSource)
      ? leftSource.rowCount
      : leftInlineRows.length;
    const rightRows = isDatasetRef(rightSource)
      ? rightSource.rowCount
      : rightInlineRows.length;

    if (leftRows === 0 && rightRows === 0) {
      throw new NonRetriableError(
        "At least one source variable must contain CSV records",
      );
    }

    const requestedFields = Array.isArray(data.compareFields)
      ? data.compareFields
      : parseCommaList(data.compareFields);

    const minRows = Math.min(leftRows, rightRows);
    if (!keyField && minRows > DATASET_STORAGE.COMPARE_MAX_INDEX_ROWS) {
      throw new NonRetriableError(
        "Compare without keyField is blocked for large datasets. Provide keyField or reduce dataset size.",
      );
    }

    if (minRows > DATASET_STORAGE.COMPARE_MAX_INDEX_ROWS) {
      throw new NonRetriableError(
        "Compare blocked because the index side exceeds the safe threshold. Reduce input size or compare in partitions.",
      );
    }

    const output = await step.run("csv-compare", async () => {
      const sampleLimit = DATASET_STORAGE.COMPARE_MAX_DIFF_SAMPLES;
      const added: Array<Record<string, unknown>> = [];
      const removed: Array<Record<string, unknown>> = [];
      const changed: Array<{
        key: string;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
        differences: Array<{ field: string; before: unknown; after: unknown }>;
      }> = [];

      let addedTruncated = false;
      let removedTruncated = false;
      let changedTruncated = false;

      let addedCount = 0;
      let removedCount = 0;
      let changedCount = 0;
      let unchangedCount = 0;

      const compareFieldSet = new Set<string>(requestedFields);
      const buildLeft = leftRows <= rightRows;

      if (keyField) {
        const keyedField = keyField;
        const buildSource = buildLeft ? leftSource : rightSource;
        const probeSource = buildLeft ? rightSource : leftSource;

        const index = new Map<string, Array<Record<string, unknown>>>();

        for await (const row of streamContextRows(buildSource)) {
          const key = String(row[keyedField] ?? "");
          const entries = index.get(key);
          if (entries) {
            entries.push(row);
          } else {
            index.set(key, [row]);
          }
        }

        for await (const probeRow of streamContextRows(probeSource)) {
          const key: string = String(probeRow[keyedField] ?? "");
          const candidates: Array<Record<string, unknown>> =
            index.get(key) ?? [];
          const matched: Record<string, unknown> | undefined =
            candidates.shift();

          if (matched) {
            const leftRow: Record<string, unknown> = buildLeft
              ? matched
              : probeRow;
            const rightRow: Record<string, unknown> = buildLeft
              ? probeRow
              : matched;

            if (requestedFields.length === 0) {
              for (const field of Object.keys(leftRow)) {
                if (field !== keyedField) {
                  compareFieldSet.add(field);
                }
              }
              for (const field of Object.keys(rightRow)) {
                if (field !== keyedField) {
                  compareFieldSet.add(field);
                }
              }
            }

            const compareFields = Array.from(compareFieldSet);
            const differences = compareFields
              .map((field) => ({
                field,
                before: leftRow[field],
                after: rightRow[field],
              }))
              .filter((entry) => !valuesEqual(entry.before, entry.after));

            if (differences.length === 0) {
              unchangedCount += 1;
            } else {
              changedCount += 1;
              if (
                !pushBounded(
                  changed,
                  { key, before: leftRow, after: rightRow, differences },
                  sampleLimit,
                )
              ) {
                changedTruncated = true;
              }
            }

            continue;
          }

          if (buildLeft) {
            addedCount += 1;
            if (!pushBounded(added, probeRow, sampleLimit)) {
              addedTruncated = true;
            }
          } else {
            removedCount += 1;
            if (!pushBounded(removed, probeRow, sampleLimit)) {
              removedTruncated = true;
            }
          }
        }

        for (const rows of index.values()) {
          for (const row of rows) {
            if (buildLeft) {
              removedCount += 1;
              if (!pushBounded(removed, row, sampleLimit)) {
                removedTruncated = true;
              }
            } else {
              addedCount += 1;
              if (!pushBounded(added, row, sampleLimit)) {
                addedTruncated = true;
              }
            }
          }
        }
      } else {
        const buildSource = buildLeft ? leftSource : rightSource;
        const probeSource = buildLeft ? rightSource : leftSource;

        const buildCounts = new Map<
          string,
          { row: Record<string, unknown>; count: number }
        >();

        for await (const row of streamContextRows(buildSource)) {
          const key = stableStringify(row);
          const existing = buildCounts.get(key);
          buildCounts.set(key, {
            row,
            count: (existing?.count ?? 0) + 1,
          });
        }

        for await (const probeRow of streamContextRows(probeSource)) {
          const key = stableStringify(probeRow);
          const existing = buildCounts.get(key);

          if (existing && existing.count > 0) {
            existing.count -= 1;
            unchangedCount += 1;
            continue;
          }

          if (buildLeft) {
            addedCount += 1;
            if (!pushBounded(added, probeRow, sampleLimit)) {
              addedTruncated = true;
            }
          } else {
            removedCount += 1;
            if (!pushBounded(removed, probeRow, sampleLimit)) {
              removedTruncated = true;
            }
          }
        }

        for (const entry of buildCounts.values()) {
          for (let index = 0; index < entry.count; index += 1) {
            if (buildLeft) {
              removedCount += 1;
              if (!pushBounded(removed, entry.row, sampleLimit)) {
                removedTruncated = true;
              }
            } else {
              addedCount += 1;
              if (!pushBounded(added, entry.row, sampleLimit)) {
                addedTruncated = true;
              }
            }
          }
        }
      }

      return {
        keyField: keyField ?? null,
        compareFields: Array.from(compareFieldSet),
        added,
        removed,
        changed,
        addedCount,
        removedCount,
        changedCount,
        unchangedCount,
        samplesTruncated: {
          added: addedTruncated,
          removed: removedTruncated,
          changed: changedTruncated,
        },
      };
    });

    return {
      [variableName]: output,
    };
  });
