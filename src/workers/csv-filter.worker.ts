/**
 * CSV Filter — Browser Web Worker (streaming)
 * Processes OPFS chunks one at a time — never loads the full dataset into memory.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS } from "./_opfs-helpers";

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

interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: string;
}

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
