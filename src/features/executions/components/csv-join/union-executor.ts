import { getPerformanceSettings } from "@/lib/performance-settings";

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

// Union All: stream left then right, O(1) memory
export async function* unionAllRows(
  leftRows: AsyncIterable<Record<string, unknown>>,
  rightRows: AsyncIterable<Record<string, unknown>>,
) {
  yield* leftRows;
  yield* rightRows;
}

// Union: deduplicate via row hash Set
export async function* unionRows(
  leftRows: AsyncIterable<Record<string, unknown>>,
  rightRows: AsyncIterable<Record<string, unknown>>,
) {
  const seen = new Set<string>();
  const maxUnionRows = getPerformanceSettings().maxUnionRows;
  let count = 0;
  for await (const row of unionAllRows(leftRows, rightRows)) {
    if (++count > maxUnionRows) {
      throw new BudgetExceededError(
        `Union deduplication exceeded ${maxUnionRows.toLocaleString()} rows. ` +
          `Increase the limit in Settings → Performance, or use the CSV Deduplicate node.`,
      );
    }
    const hash = JSON.stringify(row);
    if (!seen.has(hash)) {
      seen.add(hash);
      yield row;
    }
  }
}
