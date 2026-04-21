/**
 * CSV Parse — Browser Web Worker (streaming)
 * Accepts a transferred ArrayBuffer, parses via PapaParse step callback,
 * flushes rows to OPFS in chunks of chunkSize — never holds all rows in memory.
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

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    fileBuffer,
    fileName,
    mimeType = "text/csv",
    executionId,
    variableName,
    hasHeader = true,
    delimiter = "auto",
    chunkSize = 10_000,
  } = input as {
    fileBuffer: ArrayBuffer;
    fileName: string;
    mimeType?: string;
    executionId: string;
    variableName: string;
    hasHeader?: boolean;
    delimiter?: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    post({ kind: "progress", jobId, progress: 5, message: "Preparing parser..." });

    const datasetId = createId();

    // Pre-create OPFS directory tree before parsing begins
    const opfsRoot = await navigator.storage.getDirectory();
    const datasetDir = await opfsRoot
      .getDirectoryHandle("autopilot", { create: true })
      .then((a) => a.getDirectoryHandle("executions", { create: true }))
      .then((e) => e.getDirectoryHandle(executionId, { create: true }))
      .then((ex) => ex.getDirectoryHandle(datasetId, { create: true }));

    const blob = new Blob([fileBuffer], { type: mimeType });
    const blobSize = blob.size;

    let rowBuffer: DatasetRow[] = [];
    let chunkIndex = 0;
    let totalRows = 0;
    let totalBytes = 0;
    const chunks: {
      chunkIndex: number;
      fileName: string;
      rowStart: number;
      rowEnd: number;
      rowCount: number;
      cumulativeRowCount: number;
      byteSize: number;
      createdAt: string;
    }[] = [];
    const schemaSample: DatasetRow[] = [];
    const parseWarnings: string[] = [];
    const createdAt = new Date().toISOString();

    const explicitDelimiter = delimiter !== "auto" ? delimiter : "";

    async function flushChunk(rows: DatasetRow[]) {
      const fn = `chunk-${String(chunkIndex).padStart(6, "0")}.json`;
      const bytes = new TextEncoder().encode(JSON.stringify(rows));
      const fh = await datasetDir.getFileHandle(fn, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      chunks.push({
        chunkIndex,
        fileName: fn,
        rowStart: totalRows,
        rowEnd: totalRows + rows.length - 1,
        rowCount: rows.length,
        cumulativeRowCount: totalRows + rows.length,
        byteSize: bytes.byteLength,
        createdAt,
      });
      totalBytes += bytes.byteLength;
      totalRows += rows.length;
      chunkIndex++;
    }

    await new Promise<void>((resolve, reject) => {
      if (hasHeader) {
        Papa.parse<DatasetRow>(blob, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          delimiter: explicitDelimiter,
          step: (result, parser) => {
            if (result.errors.length) {
              parseWarnings.push(...result.errors.map((e) => e.message));
            }
            const row = result.data as DatasetRow;
            rowBuffer.push(row);
            if (schemaSample.length < 1000) schemaSample.push(row);

            if (rowBuffer.length >= chunkSize) {
              parser.pause();
              const toFlush = rowBuffer;
              rowBuffer = [];
              const progress = Math.min(85, 10 + Math.round(((result.meta as { cursor?: number }).cursor ?? 0) / blobSize * 75));
              post({ kind: "progress", jobId, progress, message: `Parsed ${(totalRows + toFlush.length).toLocaleString()} rows...` });
              flushChunk(toFlush).then(() => parser.resume()).catch(reject);
            }
          },
          complete: async () => {
            try {
              if (rowBuffer.length > 0) await flushChunk(rowBuffer);
              rowBuffer = [];
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          error: reject,
        });
      } else {
        // No header: parse as arrays, generate col_0, col_1, … column names from first row
        let colNames: string[] | null = null;
        Papa.parse<string[]>(blob, {
          header: false,
          skipEmptyLines: true,
          dynamicTyping: false,
          delimiter: explicitDelimiter,
          step: (result, parser) => {
            if (result.errors.length) {
              parseWarnings.push(...result.errors.map((e) => e.message));
            }
            const arr = result.data as string[];
            if (!colNames) {
              colNames = Array.from({ length: arr.length }, (_, i) => `col_${i}`);
            }
            const row: DatasetRow = {};
            for (let i = 0; i < colNames.length; i++) row[colNames[i]] = arr[i] ?? null;
            rowBuffer.push(row);
            if (schemaSample.length < 1000) schemaSample.push(row);

            if (rowBuffer.length >= chunkSize) {
              parser.pause();
              const toFlush = rowBuffer;
              rowBuffer = [];
              const progress = Math.min(85, 10 + Math.round(((result.meta as { cursor?: number }).cursor ?? 0) / blobSize * 75));
              post({ kind: "progress", jobId, progress, message: `Parsed ${(totalRows + toFlush.length).toLocaleString()} rows...` });
              flushChunk(toFlush).then(() => parser.resume()).catch(reject);
            }
          },
          complete: async () => {
            try {
              if (rowBuffer.length > 0) await flushChunk(rowBuffer);
              rowBuffer = [];
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          error: reject,
        });
      }
    });

    post({ kind: "progress", jobId, progress: 90, message: "Finalizing..." });

    const schema = inferSchema(schemaSample);
    const manifest = {
      version: DATASET_MANIFEST_VERSION,
      datasetId,
      executionId,
      variableName,
      createdAt,
      updatedAt: createdAt,
      rowCount: totalRows,
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
          rowCount: totalRows,
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
