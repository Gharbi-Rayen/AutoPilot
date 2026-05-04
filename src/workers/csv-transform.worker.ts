/**
 * FILE: src/workers/csv-transform.worker.ts
 *
 * PURPOSE:
 *   Applies conditional transformation rules to rows.  Each rule has a condition
 *   (if this cell matches...) and an action (then do this to the row/cell).
 *   Unlike csv-column-transform which applies operations unconditionally to columns,
 *   csv-transform applies actions ONLY to rows that match the condition.
 *   Processes OPFS chunks one at a time — never loads the full dataset into memory.
 *
 * WHAT IS A CONDITIONAL TRANSFORM?
 *   Example rule: "IF the 'Status' column EQUALS 'pending' THEN replace it with 'active'"
 *   Another: "IF 'Email' IS EMPTY THEN DELETE THE ROW"
 *   Rules can be stacked:
 *     matchMode "all" — ALL rules must match for the row to be transformed (AND logic)
 *     matchMode "any" — the row is processed if ANY rule matches (OR logic)
 *                       each matching rule's action is applied independently
 *
 * DIFFERENCE FROM csv-column-transform:
 *   csv-transform   — row-level, conditional: only rows matching a condition are affected
 *   csv-column-transform — column-level, unconditional: EVERY value in the column is changed
 *
 * SUPPORTED ACTIONS:
 *   replace_value — replace the matching cell's value with a new string
 *   clear_cell    — set the matching cell to "" (empty string)
 *   delete_row    — remove the row entirely from the output
 *   set_value     — set a different (target) column's value (cross-column update)
 *
 * SUPPORTED OPERATORS:
 *   eq / ne                     — equals / not equals (exact string match)
 *   contains / not_contains     — substring check
 *   starts_with / ends_with     — prefix/suffix check
 *   is_empty / is_not_empty     — check if cell is blank
 *   regex                       — test a regular expression against the cell value
 *   gt / gte / lt / lte         — numeric greater-than / less-than comparisons
 *
 * INPUT (from WorkerJobMessage.input):
 *   inputRef      — DatasetRef of the dataset to transform
 *   rules         — array of TransformRule objects
 *   matchMode     — "all" | "any" (default "all")
 *   caseSensitive — whether string operators are case-sensitive (default false)
 *   executionId   — current execution's ID
 *   variableName  — context key for the output dataset
 *   chunkSize     — rows per output chunk
 *
 * OUTPUT:
 *   manifest         — DatasetManifest for the transformed output
 *   datasetRef       — DatasetRef for the transformed output
 *   transformedCount — number of rows in the output (may be less if rows were deleted)
 *   totalCount       — total input rows processed
 *
 * USED IN:
 *   src/features/executions/components/csv-transform/executor.ts
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS } from "./_opfs-helpers";

/**
 * TransformOperator
 *
 * WHY THIS EXISTS:
 *   Union type of all valid operators for rule conditions.
 *   Used as the type for TransformRule.operator.
 */
type TransformOperator =
  | "eq" | "ne" | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "is_empty" | "is_not_empty" | "regex" | "gt" | "gte" | "lt" | "lte";

/**
 * TransformAction
 *
 * WHY THIS EXISTS:
 *   Union type of all valid actions that can be applied when a rule matches.
 */
type TransformAction = "replace_value" | "clear_cell" | "delete_row" | "set_value";

/**
 * TransformRule
 *
 * WHY THIS EXISTS:
 *   Describes one conditional transformation: check a cell, then act on the row.
 *
 * FIELD MEANINGS:
 *   column       — which column to check the condition against
 *   operator     — which comparison operator to use
 *   searchValue  — value to compare against (the right-hand side)
 *   action       — what to do if the condition matches
 *   replacement  — new value for replace_value and set_value actions
 *   targetColumn — for set_value: which column to write to (defaults to rule.column)
 *
 * USED IN:
 *   testRule()   — checks the condition
 *   applyAction() — applies the action
 *   processRow()  — orchestrates condition check and action
 */
interface TransformRule {
  column: string;
  operator: TransformOperator;
  searchValue?: string;
  action: TransformAction;
  replacement?: string;
  targetColumn?: string;
}

/**
 * testRule()
 *
 * WHY THIS EXISTS:
 *   Tests whether a single row satisfies a single TransformRule's condition.
 *   Returns true if the condition matches (and the action should be considered).
 *
 * WHAT IS CASE-SENSITIVE MATCHING?
 *   If caseSensitive is false, both the cell value and search value are lowercased
 *   before comparison — so "ALICE" matches "alice".
 *   Exception: the "regex" operator ignores caseSensitive and uses the pattern as-is.
 *   (Users can add the (?i) flag inside the regex if they want case-insensitive regex.)
 *
 * WHAT IS new RegExp()?
 *   new RegExp(pattern) constructs a regular expression object from a string pattern.
 *   .test(string) returns true if the string matches the pattern.
 *   Wrapped in try/catch because an invalid pattern (e.g. unmatched bracket) throws.
 *
 * CALLED FROM:
 *   processRow() — called once per rule per row
 */
function testRule(row: DatasetRow, rule: TransformRule, caseSensitive: boolean): boolean {
  const raw = row[rule.column];
  let cell = raw == null ? "" : String(raw);
  let search = rule.searchValue ?? "";
  if (!caseSensitive && rule.operator !== "regex") {
    cell = cell.toLowerCase();
    search = search.toLowerCase();
  }
  switch (rule.operator) {
    case "eq": return cell === search;
    case "ne": return cell !== search;
    case "contains": return cell.includes(search);
    case "not_contains": return !cell.includes(search);
    case "starts_with": return cell.startsWith(search);
    case "ends_with": return cell.endsWith(search);
    case "is_empty": return cell === "";
    case "is_not_empty": return cell !== "";
    case "regex": try { return new RegExp(rule.searchValue ?? "").test(String(raw ?? "")); } catch { return false; }
    case "gt": return Number(raw) > Number(rule.searchValue);
    case "gte": return Number(raw) >= Number(rule.searchValue);
    case "lt": return Number(raw) < Number(rule.searchValue);
    case "lte": return Number(raw) <= Number(rule.searchValue);
    default: return false;
  }
}

/**
 * applyAction()
 *
 * WHY THIS EXISTS:
 *   Applies one rule's action to a row (AFTER the condition has been confirmed to match).
 *   Returns a modified copy of the row (spread via `{ ...row }`).
 *   The "delete_row" action is NOT handled here — it is handled in processRow()
 *   by returning null (which signals the caller to discard the row).
 *
 * WHY `{ ...row }` SPREAD?
 *   `{ ...row }` creates a shallow copy of the row object.
 *   Without this, modifying `next[rule.column]` would mutate the original chunk array.
 *   The original chunk data should stay unchanged so the same row can be processed
 *   by multiple rules in sequence without each rule "seeing" the previous rule's changes
 *   when using matchMode "any".
 *
 * CALLED FROM:
 *   processRow() — called for each matching rule
 */
function applyAction(row: DatasetRow, rule: TransformRule): DatasetRow {
  const next = { ...row };
  switch (rule.action) {
    case "replace_value": next[rule.column] = rule.replacement ?? ""; break;
    case "clear_cell": next[rule.column] = ""; break;
    case "set_value": next[rule.targetColumn ?? rule.column] = rule.replacement ?? ""; break;
  }
  return next;
}

/**
 * processRow()
 *
 * WHY THIS EXISTS:
 *   Orchestrates condition testing and action application for one row against all rules.
 *   Returns the (possibly modified) row, or null if the row should be deleted.
 *
 * "ALL" MODE:
 *   All rules must match.  If they do, apply every rule's action in sequence.
 *   If any rule is "delete_row", the whole row is deleted.
 *
 * "ANY" MODE:
 *   Each rule is tested independently.  For each rule that matches:
 *     - If action is "delete_row" → return null immediately.
 *     - Otherwise → apply the action to the running result.
 *   Rules that don't match are skipped.
 *
 * RETURNS:
 *   DatasetRow — the transformed row to include in output
 *   null       — means "delete this row" (not included in output)
 *
 * CALLED FROM:
 *   self.onmessage — called for each row in each chunk
 */
function processRow(
  row: DatasetRow,
  rules: TransformRule[],
  matchMode: "all" | "any",
  caseSensitive: boolean,
): DatasetRow | null {
  if (matchMode === "all") {
    if (!rules.every((r) => testRule(row, r, caseSensitive))) return row;
    let result = row;
    for (const r of rules) {
      if (r.action === "delete_row") return null;
      result = applyAction(result, r);
    }
    return result;
  }
  // "any": apply each matching rule independently; delete_row from any match removes row
  let result = row;
  for (const r of rules) {
    if (!testRule(row, r, caseSensitive)) continue;
    if (r.action === "delete_row") return null;
    result = applyAction(result, r);
  }
  return result;
}

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    inputRef,
    rules = [],
    matchMode = "all",
    caseSensitive = false,
    executionId,
    variableName,
    chunkSize = 10_000,
  } = input as {
    inputRef: DatasetRef;
    rules: TransformRule[];
    matchMode?: "all" | "any";
    caseSensitive?: boolean;
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
      const transformed: DatasetRow[] = [];
      for (const row of chunk) {
        const out = processRow(row, rules, matchMode, caseSensitive);
        if (out !== null) transformed.push(out);
      }
      await writer.write(transformed);
      const pct = Math.round(10 + ((c + 1) / inputRef.chunkCount) * 80);
      post({ kind: "progress", jobId, progress: pct, message: `Transformed ${totalInputRows.toLocaleString()} rows...` });
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

    post({ kind: "result", jobId, output: { manifest, datasetRef, transformedCount: totalRows, totalCount: totalInputRows } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
