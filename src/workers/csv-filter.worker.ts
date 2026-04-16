/**
 * CSV Filter — Browser Web Worker
 * Filters rows by field/operator/value, writes result to OPFS.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetRef } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";

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

async function readDatasetFromOPFS(executionId: string, datasetId: string, chunkCount: number): Promise<DatasetRow[]> {
  const opfsRoot = await navigator.storage.getDirectory();
  const dir = await opfsRoot
    .getDirectoryHandle("autopilot", { create: false })
    .then((a) => a.getDirectoryHandle("executions", { create: false }))
    .then((e) => e.getDirectoryHandle(executionId, { create: false }))
    .then((ex) => ex.getDirectoryHandle(datasetId, { create: false }));

  const rows: DatasetRow[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const fileName = `chunk-${String(i).padStart(6, "0")}.json`;
    const fh = await dir.getFileHandle(fileName);
    const file = await fh.getFile();
    const parsed = JSON.parse(await file.text()) as DatasetRow[];
    rows.push(...parsed);
  }
  return rows;
}

async function writeToOPFS(executionId: string, datasetId: string, rows: DatasetRow[], chunkSize = 10_000) {
  const opfsRoot = await navigator.storage.getDirectory();
  const dir = await opfsRoot
    .getDirectoryHandle("autopilot", { create: true })
    .then((a) => a.getDirectoryHandle("executions", { create: true }))
    .then((e) => e.getDirectoryHandle(executionId, { create: true }))
    .then((ex) => ex.getDirectoryHandle(datasetId, { create: true }));

  const chunks = [];
  let cumulativeRows = 0;
  let totalBytes = 0;
  const now = new Date().toISOString();

  for (let i = 0; i * chunkSize < rows.length || (i === 0 && rows.length === 0); i++) {
    const chunkRows = rows.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunkRows.length === 0) break;
    const fileName = `chunk-${String(i).padStart(6, "0")}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify(chunkRows));
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
    cumulativeRows += chunkRows.length;
    totalBytes += bytes.byteLength;
    chunks.push({ chunkIndex: i, fileName, rowStart: i * chunkSize, rowEnd: i * chunkSize + chunkRows.length - 1, rowCount: chunkRows.length, cumulativeRowCount: cumulativeRows, byteSize: bytes.byteLength, createdAt: now });
  }
  return { chunks, totalBytes };
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
    post({ kind: "progress", jobId, progress: 10, message: "Reading dataset..." });
    const rows = await readDatasetFromOPFS(inputRef.executionId, inputRef.datasetId, inputRef.chunkCount);

    post({ kind: "progress", jobId, progress: 40, message: "Filtering..." });
    const filtered = rows.filter((row) =>
      logic === "AND"
        ? conditions.every((c) => applyFilter(row, c))
        : conditions.some((c) => applyFilter(row, c)),
    );

    post({ kind: "progress", jobId, progress: 70, message: "Writing result..." });
    const datasetId = createId();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, filtered, chunkSize);

    const now = new Date().toISOString();
    const manifest = { version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName, createdAt: now, updatedAt: now, rowCount: filtered.length, chunkCount: chunks.length, byteSize: totalBytes, schema: inputRef.schema, chunks };
    const datasetRef: DatasetRef = { kind: "dataset", datasetId, executionId, variableName, rowCount: filtered.length, chunkCount: chunks.length, byteSize: totalBytes, schema: inputRef.schema };

    post({ kind: "result", jobId, output: { manifest, datasetRef, filteredCount: filtered.length, totalCount: rows.length } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};

export {};
