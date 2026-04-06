import { NonRetriableError } from "inngest";
import { UNION_DEDUP_MAX_ROWS } from "@/config/constants";

export class BudgetExceededError extends NonRetriableError {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

// Union All: stream left then right, O(1) memory
export async function* unionAllRows(leftRows: AsyncIterable<Record<string, unknown>>, rightRows: AsyncIterable<Record<string, unknown>>) {
  yield* leftRows;
  yield* rightRows;
}

// Union: deduplicate via row hash Set
export async function* unionRows(leftRows: AsyncIterable<Record<string, unknown>>, rightRows: AsyncIterable<Record<string, unknown>>) {
  const seen = new Set<string>();
  let count = 0;
  for await (const row of unionAllRows(leftRows, rightRows)) {
    if (++count > UNION_DEDUP_MAX_ROWS) {
      throw new BudgetExceededError(
        `Union deduplication exceeded ${UNION_DEDUP_MAX_ROWS} rows. ` +
        `Use CSV Deduplicate node for larger datasets.`
      );
    }
    const hash = JSON.stringify(row);
    if (!seen.has(hash)) {
      seen.add(hash);
      yield row;
    }
  }
}

