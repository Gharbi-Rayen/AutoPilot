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

describe("hashJoinRows - full_exclusive join", () => {
  const leftRows = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
    { id: 3, name: "Charlie" },
  ];

  const rightRows = [
    { customer_id: 1, order: "A" },
    { customer_id: 3, order: "C" },
    { customer_id: 4, order: "D" },
  ];

  it("should return only rows with no match on either side", async () => {
    const generator = hashJoinRows({
      leftRows,
      rightRows,
      leftKeys: ["id"],
      rightKeys: ["customer_id"],
      joinType: "full_exclusive",
      buildSide: "right",
    });

    const results = [];
    for await (const row of generator) {
      results.push(row);
    }

    // Bob (id=2) has no right match; customer_id=4 has no left match
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 2, name: "Bob" }),
        expect.objectContaining({ customer_id: 4, order: "D" }),
      ]),
    );
    // Alice and Charlie matched — should NOT appear
    expect(results.some((r) => r.id === 1 || r.id === 3)).toBe(false);
    expect(results.length).toBe(2);
  });
});
