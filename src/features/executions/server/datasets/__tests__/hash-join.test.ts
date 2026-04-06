import { buildMatchKey } from "../hash-join";

describe("buildMatchKey", () => {
  it("should coerce null and undefined to empty strings", () => {
    const row: Record<string, unknown> = {
      a: null,
      b: undefined,
      c: 0,
      d: false,
    };
    const key = buildMatchKey(row, ["a", "b", "c", "d"]);
    expect(key).toBe("0:|0:|1:0|5:false");
  });

  it("should escape separator collisions", () => {
    const row1 = { a: "foo", b: "bar|||baz" };
    const row2 = { a: "foo|||bar", b: "baz" };

    const key1 = buildMatchKey(row1, ["a", "b"]);
    const key2 = buildMatchKey(row2, ["a", "b"]);

    expect(key1).not.toBe(key2);
    expect(key1).toBe("3:foo|10:bar|||baz");
    expect(key2).toBe("10:foo|||bar|3:baz");
  });

  it("should match a number key and an equivalent string key", () => {
    const row1 = { value: 42 };
    const row2 = { value: "42" };

    const key1 = buildMatchKey(row1, ["value"]);
    const key2 = buildMatchKey(row2, ["value"]);

    expect(key1).toBe(key2);
    expect(key1).toBe("2:42");
  });

  it("should not match different string/number keys", () => {
    const row1 = { value: 42 };
    const row2 = { value: "43" };

    const key1 = buildMatchKey(row1, ["value"]);
    const key2 = buildMatchKey(row2, ["value"]);

    expect(key1).not.toBe(key2);
    expect(key1).toBe("2:42");
    expect(key2).toBe("2:43");
  });

  it("should handle case-insensitive matching", () => {
    const row1 = { value: "USA" };
    const row2 = { value: "usa" };

    // Flag false -> no match
    const key1False = buildMatchKey(row1, ["value"], false);
    const key2False = buildMatchKey(row2, ["value"], false);
    expect(key1False).not.toBe(key2False);
    expect(key1False).toBe("3:USA");
    expect(key2False).toBe("3:usa");

    // Flag true -> match
    const key1True = buildMatchKey(row1, ["value"], true);
    const key2True = buildMatchKey(row2, ["value"], true);
    expect(key1True).toBe(key2True);
    expect(key1True).toBe("3:usa");
  });

  it("should handle case-insensitive matching on composite keys", () => {
    const row1 = { id: 1, country: "USA", code: "NY" };
    const row2 = { id: 1, country: "usa", code: "ny" };

    const key1 = buildMatchKey(row1, ["id", "country", "code"], true);
    const key2 = buildMatchKey(row2, ["id", "country", "code"], true);

    expect(key1).toBe(key2);
    expect(key1).toBe("1:1|3:usa|2:ny");
  });
});

import { hashJoinRows } from "../hash-join";

describe("hashJoinRows - semi and anti joins", () => {
  const leftRows = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
    { id: 3, name: "Charlie" },
  ];

  const rightRows = [
    { customer_id: 1, order: "A" },
    { customer_id: 1, order: "B" },
    { customer_id: 3, order: "C" },
  ];

  it("should handle semi join correctly", async () => {
    const generator = hashJoinRows({
      leftRows,
      rightRows,
      leftKeys: ["id"],
      rightKeys: ["customer_id"],
      joinType: "semi",
      buildSide: "right", // Enforced by planner
    });

    const results = [];
    for await (const row of generator) {
      results.push(row);
    }

    // matched rows yield only left columns, exactly once per left row!
    expect(results).toEqual([
      { id: 1, name: "Alice" },
      { id: 3, name: "Charlie" },
    ]);
  });

  it("should handle anti join correctly", async () => {
    const generator = hashJoinRows({
      leftRows,
      rightRows,
      leftKeys: ["id"],
      rightKeys: ["customer_id"],
      joinType: "anti",
      buildSide: "right", // Enforced by planner
    });

    const results = [];
    for await (const row of generator) {
      results.push(row);
    }

    // unmatched rows yield only left columns
    expect(results).toEqual([{ id: 2, name: "Bob" }]);
  });

  describe("natural join", () => {
    const natLeftRows = [
      { id: 1, name: "Alice", age: 30 },
      { id: 2, name: "Bob", age: 40 },
    ];
    const natRightRows = [
      { id: 1, name: "Alice_Right", age: 30, salary: 5000 },
      { id: 3, name: "Charlie", age: 50, salary: 6000 },
    ];

    it("should handle Natural join with 2 shared columns", async () => {
      const generator = hashJoinRows({
        leftRows: natLeftRows,
        rightRows: natRightRows,
        leftKeys: ["id", "age"],
        rightKeys: ["id", "age"],
        joinType: "natural",
        buildSide: "right",
      });

      const results = [];
      for await (const row of generator) {
        results.push(row);
      }
      expect(results).toEqual([
        { id: 1, name: "Alice", age: 30, right_id: 1, right_name: "Alice_Right", right_age: 30, salary: 5000 },
      ]);
    });

    it("should reject Natural join with 0 shared columns", async () => {
      // hashJoinRows is the underlying engine, but we ensure it throws if incorrectly routed 0 keys
      const generator = hashJoinRows({
        leftRows: natLeftRows,
        rightRows: natRightRows,
        leftKeys: [],
        rightKeys: [],
        joinType: "natural",
        buildSide: "right",
      });
      await expect(async () => {
        for await (const _ of generator) {}
      }).rejects.toThrow("Natural Join requires at least one shared column name.");
    });

    it("should handle Natural join with 1 shared column and a collision value", async () => {
      const generator = hashJoinRows({
        leftRows: natLeftRows,
        rightRows: natRightRows,
        leftKeys: ["id"],
        rightKeys: ["id"],
        joinType: "natural",
        buildSide: "right",
      });

      const results = [];
      for await (const row of generator) {
        results.push(row);
      }
      expect(results).toEqual([
        { id: 1, name: "Alice", age: 30, right_id: 1, right_name: "Alice_Right", right_age: 30, salary: 5000 },
      ]);
    });
  });
});
