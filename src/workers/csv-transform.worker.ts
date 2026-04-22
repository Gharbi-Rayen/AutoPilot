/**
 * CSV Transform — Browser Web Worker (streaming)
 * Applies conditional find-and-replace rules to each row.
 * Processes OPFS chunks one at a time — never loads the full dataset into memory.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS } from "./_opfs-helpers";

type TransformOperator =
  | "eq" | "ne" | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "is_empty" | "is_not_empty" | "regex" | "gt" | "gte" | "lt" | "lte";

type TransformAction = "replace_value" | "clear_cell" | "delete_row" | "set_value";

interface TransformRule {
  column: string;
  operator: TransformOperator;
  searchValue?: string;
  action: TransformAction;
  replacement?: string;
  targetColumn?: string;
}

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

function applyAction(row: DatasetRow, rule: TransformRule): DatasetRow {
  const next = { ...row };
  switch (rule.action) {
    case "replace_value": next[rule.column] = rule.replacement ?? ""; break;
    case "clear_cell": next[rule.column] = ""; break;
    case "set_value": next[rule.targetColumn ?? rule.column] = rule.replacement ?? ""; break;
  }
  return next;
}

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
