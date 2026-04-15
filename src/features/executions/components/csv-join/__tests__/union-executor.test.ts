import {
  BudgetExceededError,
  unionAllRows,
  unionRows,
} from "../union-executor";

describe("Union executor", () => {
  const leftRows = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
    { id: 3, name: "Charlie" },
  ];

  const rightRows = [
    { id: 4, name: "Dave" },
    { id: 2, name: "Bob" }, // Duplicate with left
    { id: 5, name: "Eve" },
  ];

  async function* toAsyncIterable(rows: Array<Record<string, unknown>>) {
    // yield rows individually
    for (const row of rows) {
      yield row;
    }
  }

  describe("unionAllRows", () => {
    it("should preserve all fields and rows unchanged, maintaining order", async () => {
      const generator = unionAllRows(
        toAsyncIterable(leftRows),
        toAsyncIterable(rightRows),
      );
      const results = [];
      for await (const row of generator) {
        results.push(row);
      }
      expect(results).toHaveLength(6);
      expect(results[0]).toEqual({ id: 1, name: "Alice" });
      expect(results[4]).toEqual({ id: 2, name: "Bob" }); // duplicate kept
    });
  });

  describe("unionRows", () => {
    it("should deduplicate identical rows based on properties", async () => {
      const generator = unionRows(
        toAsyncIterable(leftRows),
        toAsyncIterable(rightRows),
      );
      const results = [];
      for await (const row of generator) {
        results.push(row);
      }
      expect(results).toHaveLength(5);
      expect(results).toEqual([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" },
        { id: 4, name: "Dave" },
        { id: 5, name: "Eve" },
      ]);
    });

    it("should throw BudgetExceededError if rows exceed UNION_DEDUP_MAX_ROWS", async () => {
      // Mocking 500,001 rows
      async function* generateLarge() {
        for (let i = 0; i <= 500_000; i++) {
          yield { row: i };
        }
      }

      const generator = unionRows(generateLarge(), toAsyncIterable([]));
      await expect(async () => {
        for await (const _row of generator) {
        }
      }).rejects.toThrow(BudgetExceededError);
    });
  });
});
