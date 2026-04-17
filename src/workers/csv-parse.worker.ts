/**
 * CSV Parse — Browser Web Worker
 * Parses a CSV File/text, infers schema, writes chunked rows to OPFS.
 */

import Papa from "papaparse";
import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetSchema, DatasetFieldType } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";

// ─── Schema inference ─────────────────────────────────────────────────────────

function inferFieldType(values: unknown[]): DatasetFieldType {
  const sample = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (sample.length === 0) return "null";
  if (sample.every((v) => v === "true" || v === "false")) return "boolean";
  if (sample.every((v) => !Number.isNaN(Number(v)))) return "number";
  if (sample.every((v) => !Number.isNaN(Date.parse(String(v))))) return "date";
  return "string";
}

function inferSchema(rows: DatasetRow[]): DatasetSchema {
  if (rows.length === 0) return {};
  const fields = Object.keys(rows[0]);
  const schema: DatasetSchema = {};
  for (const field of fields) {
    const values = rows.map((r) => r[field]);
    const type = inferFieldType(values);
    const nullable = values.some((v) => v === null || v === undefined || v === "");
    const sampleValues = values
      .filter((v) => v !== null && v !== undefined && v !== "")
      .slice(0, 5)
      .map(String);
    schema[field] = { type, nullable, sampleValues };
  }
  return schema;
}

// ─── OPFS helpers ─────────────────────────────────────────────────────────────

async function writeChunksToOPFS(
  executionId: string,
  datasetId: string,
  rows: DatasetRow[],
  chunkSize = 10_000,
) {
  const opfsRoot = await navigator.storage.getDirectory();
  const autopilot = await opfsRoot.getDirectoryHandle("autopilot", { create: true });
  const executions = await autopilot.getDirectoryHandle("executions", { create: true });
  const execDir = await executions.getDirectoryHandle(executionId, { create: true });
  const datasetDir = await execDir.getDirectoryHandle(datasetId, { create: true });

  const chunks = [];
  let cumulativeRows = 0;
  let totalBytes = 0;
  const now = new Date().toISOString();

  for (let i = 0; i * chunkSize < rows.length || (i === 0 && rows.length === 0); i++) {
    const chunkRows = rows.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunkRows.length === 0) break;

    const fileName = `chunk-${String(i).padStart(6, "0")}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify(chunkRows));
    const fileHandle = await datasetDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(bytes);
    await writable.close();

    cumulativeRows += chunkRows.length;
    totalBytes += bytes.byteLength;

    chunks.push({
      chunkIndex: i,
      fileName,
      rowStart: i * chunkSize,
      rowEnd: i * chunkSize + chunkRows.length - 1,
      rowCount: chunkRows.length,
      cumulativeRowCount: cumulativeRows,
      byteSize: bytes.byteLength,
      createdAt: now,
    });
  }

  return { chunks, totalBytes };
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { fileContent, fileName, executionId, variableName, hasHeader = true, delimiter = "auto", chunkSize = 10_000 } = input as {
    fileContent: string;
    fileName: string;
    executionId: string;
    variableName: string;
    hasHeader?: boolean;
    delimiter?: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    post({ kind: "progress", jobId, progress: 5, message: "Parsing CSV..." });

    const explicitDelimiter = delimiter && delimiter !== "auto" ? delimiter : "";

    let rows: DatasetRow[];
    let parseWarnings: string[] = [];

    if (hasHeader) {
      const parsed = Papa.parse<DatasetRow>(fileContent, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        delimiter: explicitDelimiter,
      });
      rows = parsed.data;
      parseWarnings = parsed.errors.map((e) => e.message);
    } else {
      // No header: parse as arrays, generate col_0, col_1, ... names
      const parsed = Papa.parse<string[]>(fileContent, {
        header: false,
        skipEmptyLines: true,
        dynamicTyping: false,
        delimiter: explicitDelimiter,
      });
      const colCount = parsed.data[0]?.length ?? 0;
      const colNames = Array.from({ length: colCount }, (_, i) => `col_${i}`);
      rows = parsed.data.map((arr) => {
        const row: DatasetRow = {};
        for (let i = 0; i < colNames.length; i++) row[colNames[i]] = arr[i] ?? null;
        return row;
      });
      parseWarnings = parsed.errors.map((e) => e.message);
    }

    post({ kind: "progress", jobId, progress: 40, message: `Parsed ${rows.length} rows` });

    const schema = inferSchema(rows.slice(0, 1000));
    const datasetId = createId();

    post({ kind: "progress", jobId, progress: 50, message: "Writing to storage..." });
    const { chunks, totalBytes } = await writeChunksToOPFS(executionId, datasetId, rows, chunkSize);

    post({ kind: "progress", jobId, progress: 90, message: "Finalizing..." });

    const now = new Date().toISOString();
    const manifest = {
      version: DATASET_MANIFEST_VERSION,
      datasetId,
      executionId,
      variableName,
      createdAt: now,
      updatedAt: now,
      rowCount: rows.length,
      chunkCount: chunks.length,
      byteSize: totalBytes,
      schema,
      chunks,
    };

    post({
      kind: "result",
      jobId,
      output: {
        manifest,
        datasetRef: {
          kind: "dataset",
          datasetId,
          executionId,
          variableName,
          rowCount: rows.length,
          chunkCount: chunks.length,
          byteSize: totalBytes,
          schema,
        },
        warnings: parseWarnings,
        fileName,
      },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};

export {};
