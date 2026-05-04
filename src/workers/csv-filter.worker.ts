/**
 * FILE: src/workers/csv-filter.worker.ts
 *
 * PURPOSE:
 *   Filters rows from an input dataset by applying one or more conditions.
 *   Processes one OPFS chunk at a time — never holds the full dataset in memory.
 *   Writes matching rows to a new output dataset in OPFS.
 *
 * WHAT IS FILTERING?
 *   Filtering means keeping only the rows that satisfy a condition (or conditions).
 *   Example: "keep only rows where the 'Age' column is greater than 30".
 *   This is equivalent to the WHERE clause in SQL:
 *     SELECT * FROM table WHERE Age > 30
 *
 * WHAT IS STREAMING CHUNK-BY-CHUNK PROCESSING?
 *   Instead of loading all rows into memory and filtering at once, this worker:
 *     1. Reads one chunk from OPFS (e.g. rows 0–9999).
 *     2. Filters that chunk.
 *     3. Writes matching rows to the output via ChunkedOPFSWriter.
 *     4. Moves to the next chunk.
 *   At any moment, only one input chunk (up to 10 000 rows) is in memory.
 *   This works for datasets of any size.
 *
 * AND vs OR LOGIC:
 *   If logic is "AND", a row passes only if ALL conditions are true.
 *   If logic is "OR", a row passes if ANY condition is true.
 *   This is exposed as a user setting in the CSV Filter node's configuration dialog.
 *
 * OPERATORS SUPPORTED:
 *   equals, not_equals, contains, not_contains, starts_with, ends_with,
 *   greater_than, less_than, greater_than_or_equal, less_than_or_equal,
 *   is_empty, is_not_empty
 *
 * INPUT (from WorkerJobMessage.input):
 *   inputRef    — DatasetRef of the dataset to filter
 *   conditions  — array of FilterCondition objects
 *   logic       — "AND" | "OR" (default "AND")
 *   executionId — current execution's ID
 *   variableName — context key for the output dataset
 *   chunkSize   — rows per output chunk (from performance settings)
 *
 * OUTPUT:
 *   manifest      — DatasetManifest for the filtered output
 *   datasetRef    — DatasetRef for the filtered output
 *   filteredCount — number of rows that passed the filter
 *   totalCount    — total input rows processed
 *
 * USED IN:
 *   src/features/executions/components/csv-filter/executor.ts
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS } from "./_opfs-helpers";

/**
 * FilterOperator
 *
 * WHY THIS EXISTS:
 *   A union type enumerating all valid comparison operators for filter conditions.
 *   Using a union type instead of a plain string prevents invalid operators from
 *   being sent to the worker — TypeScript catches them at compile time.
 *
 * OPERATOR MEANINGS:
 *   equals / not_equals              — exact string equality
 *   contains / not_contains          — substring check (case-sensitive)
 *   starts_with / ends_with          — prefix/suffix check
 *   greater_than / less_than         — numeric comparison (coerces to number)
 *   greater_than_or_equal /
 *   less_than_or_equal               — numeric comparison with equality
 *   is_empty / is_not_empty          — checks if cell is null/undefined/""
 *
 * USED IN:
 *   FilterCondition.operator — the operator field
 *   applyFilter()            — the switch statement dispatches on this type
 */
type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "less_than"
  | "greater_than_or_equal"
  | "less_than_or_equal"
  | "is_empty"
  | "is_not_empty";

/**
 * FilterCondition
 *
 * WHY THIS EXISTS:
 *   Describes one filter rule: "which field, which operator, which comparison value."
 *   The worker receives an array of these from the main thread (from the node's config).
 *
 * FIELD MEANINGS:
 *   field    — the column name to check (e.g. "Age", "Status")
 *   operator — which comparison to apply (e.g. "greater_than")
 *   value    — the right-hand side of the comparison (e.g. "30")
 *              Always a string because form inputs are strings; numeric coercion
 *              happens inside applyFilter() when the operator requires it.
 *
 * USED IN:
 *   applyFilter() — tests one row against one condition
 *   self.onmessage — destructured from input.conditions
 */
interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: string;
}

/**
 * applyFilter()
 *
 * WHY THIS EXISTS:
 *   Tests a single row against a single FilterCondition and returns true if the row
 *   matches (should be kept) or false if it doesn't.
 *
 * HOW CELL VALUES ARE NORMALISED:
 *   Raw cell values can be string, number, null, or undefined.
 *   All are converted to a string via String(raw) before comparison.
 *   null and undefined become "" (empty string), which is then handled by is_empty.
 *
 * WHY NUMBER() FOR NUMERIC OPERATORS?
 *   The filter value (from the form) is always a string like "30".
 *   Number("30") converts it to 30 for numeric comparison.
 *   This allows comparing any column as a number, regardless of its schema type.
 *
 * PARAMETERS:
 *   row       — the current row being tested
 *   condition — the filter rule to apply
 *
 * RETURNS:
 *   boolean — true if the row passes the condition (should be kept)
 *
 * CALLED FROM:
 *   self.onmessage — inside chunk.filter() with logic AND/OR
 */
function applyFilter(row: DatasetRow, condition: FilterCondition): boolean {
  const raw = row[condition.field];
  const cell = raw === null || raw === undefined ? "" : String(raw);
  const val = condition.value ?? "";
  switch (condition.operator) {
    case "equals": return cell === val;
    case "not_equals": return cell !== val;
    case "contains": return cell.includes(val);
    case "not_contains": return !cell.includes(val);
    case "starts_with": return cell.startsWith(val);
    case "ends_with": return cell.endsWith(val);
    case "greater_than": return Number(cell) > Number(val);
    case "less_than": return Number(cell) < Number(val);
    case "greater_than_or_equal": return Number(cell) >= Number(val);
    case "less_than_or_equal": return Number(cell) <= Number(val);
    case "is_empty": return cell === "";
    case "is_not_empty": return cell !== "";
    default: return true;
  }
}

/**
 * self.onmessage — worker entry point
 *
 * ALGORITHM:
 *   1. Create a new datasetId for the output.
 *   2. Initialize ChunkedOPFSWriter for the output dataset.
 *   3. For each chunk in the input dataset:
 *      a. Read the chunk from OPFS.
 *      b. Filter rows using Array.filter():
 *         - "AND": conditions.every(cond => applyFilter(row, cond))
 *         - "OR":  conditions.some(cond => applyFilter(row, cond))
 *      c. Write matching rows to the output via writer.write().
 *      d. Report progress (10% + proportional 80% of the way through).
 *   4. Finalize the writer (flush remaining buffer, get chunk metadata).
 *   5. Send the result.
 *
 * WHAT IS Array.filter()?
 *   Returns a new array containing only the elements for which the callback returns true.
 *   Non-destructive: the original array is unchanged.
 *
 * WHAT IS Array.every()?
 *   Returns true if the callback returns true for EVERY element (AND logic).
 *
 * WHAT IS Array.some()?
 *   Returns true if the callback returns true for AT LEAST ONE element (OR logic).
 */
self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { inputRef, conditions, logic = "AND", executionId, variableName, chunkSize = 10_000 } = input as {
    inputRef: DatasetRef;
    conditions: FilterCondition[];
    logic?: "AND" | "OR";
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    const datasetId = createId();
    const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
    await writer.init();

    let totalInputRows = 0;

    for (let c = 0; c < inputRef.chunkCount; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      totalInputRows += chunk.length;

      const filtered = chunk.filter((row) =>
        logic === "AND"
          ? conditions.every((cond) => applyFilter(row, cond))
          : conditions.some((cond) => applyFilter(row, cond)),
      );
      await writer.write(filtered);

      const pct = Math.round(10 + ((c + 1) / inputRef.chunkCount) * 80);
      post({ kind: "progress", jobId, progress: pct, message: `Filtered ${totalInputRows.toLocaleString()} rows...` });
    }

    post({ kind: "progress", jobId, progress: 93, message: "Writing..." });
    const { chunks, totalBytes, totalRows } = await writer.finish();

    const now = new Date().toISOString();
    const manifest = {
      version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName,
      createdAt: now, updatedAt: now, rowCount: totalRows, chunkCount: chunks.length,
      byteSize: totalBytes, schema: inputRef.schema, chunks,
    };
    const datasetRef: DatasetRef = {
      kind: "dataset", datasetId, executionId, variableName,
      rowCount: totalRows, chunkCount: chunks.length, byteSize: totalBytes, schema: inputRef.schema,
    };

    post({ kind: "result", jobId, output: { manifest, datasetRef, filteredCount: totalRows, totalCount: totalInputRows } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
