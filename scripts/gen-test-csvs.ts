import fs from "node:fs";
import path from "node:path";
import { faker } from "@faker-js/faker";

const OUTPUT_DIR = "C:/autopilotdata/test-fixtures";
const ROWS = 50_000;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function writeCSV(filePath: string, headers: string[], rows: string[][]): void {
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((v) => (v.includes(",") ? `"${v}"` : v)).join(","),
    ),
  ];
  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
  console.log(`Wrote ${rows.length} rows → ${filePath}`);
}

// ── File 1: customers ──────────────────────────────────────────────────────
// Columns: customer_id, full_name, country, lifetime_value
console.log("Generating customers.csv …");
const customers: string[][] = [];
for (let i = 0; i < ROWS; i++) {
  customers.push([
    String(i + 1),
    faker.person.fullName(),
    faker.location.country(),
    faker.commerce.price({ min: 10, max: 50_000, dec: 2 }),
  ]);
}
writeCSV(
  path.join(OUTPUT_DIR, "customers.csv"),
  ["customer_id", "full_name", "country", "lifetime_value"],
  customers,
);

// ── File 2: transactions ───────────────────────────────────────────────────
// Columns: transaction_id, customer_id, product_category, amount_usd, transaction_date
// Intentional overlap with customers so joins make sense (customer_ids repeat)
console.log("Generating transactions.csv …");
const CATEGORIES = [
  "Electronics",
  "Clothing",
  "Food & Beverage",
  "Home & Garden",
  "Sports",
  "Books",
  "Automotive",
  "Health & Beauty",
];
const transactions: string[][] = [];
for (let i = 0; i < ROWS; i++) {
  const customerId = String((i % ROWS) + 1);
  transactions.push([
    faker.string.uuid(),
    customerId,
    faker.helpers.arrayElement(CATEGORIES),
    faker.commerce.price({ min: 1, max: 5_000, dec: 2 }),
    faker.date
      .between({ from: "2022-01-01", to: "2025-12-31" })
      .toISOString()
      .slice(0, 10),
  ]);
}
writeCSV(
  path.join(OUTPUT_DIR, "transactions.csv"),
  [
    "transaction_id",
    "customer_id",
    "product_category",
    "amount_usd",
    "transaction_date",
  ],
  transactions,
);

console.log("Done.");
