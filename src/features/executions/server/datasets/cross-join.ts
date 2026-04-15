import { DATASET_STORAGE } from "@/config/constants";
import type { AsyncOrSyncIterable } from "./async-batch-iterator";
import { toAsyncIterable } from "./async-batch-iterator";
import { BudgetExceededError } from "./cardinality-estimator";
import { type OutputColumnSpec, projectRow } from "./project-row";

interface CrossJoinOptions {
  leftRows: AsyncOrSyncIterable<Record<string, unknown>>;
  rightRows: AsyncOrSyncIterable<Record<string, unknown>>;
  outputColumns?: OutputColumnSpec[];
}

const mergeRows = (
  leftRow: Record<string, unknown>,
  rightRow: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...leftRow };

  for (const [field, value] of Object.entries(rightRow)) {
    if (Object.hasOwn(merged, field)) {
      merged[`right_${field}`] = value;
    } else {
      merged[field] = value;
    }
  }

  return merged;
};

export const crossJoinRows = async function* ({
  leftRows,
  rightRows,
  outputColumns,
}: CrossJoinOptions): AsyncGenerator<Record<string, unknown>, void, void> {
  const CROSS_JOIN_MAX_RIGHT_ROWS = DATASET_STORAGE.CROSS_JOIN_MAX_RIGHT_ROWS;
  let rightCount = 0;
  const rightMaterialized: Array<Record<string, unknown>> = [];
  const rightIterable = await toAsyncIterable(rightRows);

  for await (const row of rightIterable) {
    if (++rightCount > CROSS_JOIN_MAX_RIGHT_ROWS) {
      throw new BudgetExceededError(
        `Cross Join right side exceeded ${CROSS_JOIN_MAX_RIGHT_ROWS} rows. ` +
          `Reduce the right dataset before using Cross Join.`,
      );
    }
    rightMaterialized.push(row);
  }

  const leftIterable = await toAsyncIterable(leftRows);
  for await (const leftRow of leftIterable) {
    for (const rightRow of rightMaterialized) {
      yield projectRow(mergeRows(leftRow, rightRow), outputColumns);
    }
  }
};
