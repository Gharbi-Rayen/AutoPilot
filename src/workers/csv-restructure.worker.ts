/**
 * CSV Restructure Worker
 *
 * Streams through the input dataset chunk-by-chunk and produces an output
 * dataset with a user-defined column layout:
 *
 *   passthrough — an existing column kept as-is (possibly reordered)
 *   computed     — a new column whose value is derived from other columns
 *                  via a sandboxed JS expression using {{colName}} syntax
 *
 * Columns absent from outputColumns are dropped from the output.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import {
  DATASET_MANIFEST_VERSION,
  type DatasetRef,
  type DatasetRow,
} from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS } from "./_opfs-helpers";

// ── Column types (mirrored from dialog.tsx) ───────────────────────────────────

type OutputColumn =
  | { type: "passthrough"; name: string }
  | { type: "computed"; name: string; expression: string };

// ── Safe Math sandbox ─────────────────────────────────────────────────────────

const SAFE_MATH = Object.freeze({
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  trunc: Math.trunc,
  abs: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  sign: Math.sign,
  hypot: Math.hypot,
  PI: Math.PI,
  E: Math.E,
});

// ── Expression evaluator ──────────────────────────────────────────────────────

function evalExpression(expression: string, row: DatasetRow): string {
  // Extract unique {{colName}} tokens and assign positional param names _c0, _c1, …
  const tokenRe = /\{\{([^}]+)\}\}/g;
  const seen = new Map<string, string>(); // colName → paramName
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(expression)) !== null) {
    const colName = match[1].trim();
    if (!seen.has(colName)) {
      seen.set(colName, `_c${seen.size}`);
    }
  }

  // Replace {{colName}} tokens with their param names in the expression
  let fnBody = expression;
  for (const [colName, paramName] of seen.entries()) {
    fnBody = fnBody.replaceAll(`{{${colName}}}`, paramName);
  }

  const paramNames = [...seen.values()];
  const paramValues = [...seen.keys()].map((colName) => {
    const raw = String(row[colName] ?? "");
    const num = Number(raw);
    return raw.trim() !== "" && Number.isFinite(num) ? num : raw;
  });

  try {
    // biome-ignore lint/security/noFunctionConstructor: intentional sandboxed eval inside a Web Worker
    const fn = new Function(
      ...paramNames,
      "Math",
      `"use strict"; return String(${fnBody});`,
    );
    return fn(...paramValues, SAFE_MATH) as string;
  } catch {
    return "";
  }
}

// ── Row restructuring ─────────────────────────────────────────────────────────

function restructureRow(row: DatasetRow, outputColumns: OutputColumn[]): DatasetRow {
  const result: DatasetRow = {};
  for (const col of outputColumns) {
    if (col.type === "passthrough") {
      result[col.name] = row[col.name] ?? "";
    } else {
      result[col.name] = col.expression ? evalExpression(col.expression, row) : "";
    }
  }
  return result;
}

// ── Worker entry point ────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    inputRef,
    outputColumns,
    executionId,
    variableName,
    chunkSize = 10_000,
  } = input as {
    inputRef: DatasetRef;
    outputColumns: OutputColumn[];
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    const N = inputRef.chunkCount;

    const outputSchema = Object.fromEntries(
      outputColumns.map((col) => [
        col.name,
        inputRef.schema?.[col.name] ?? { type: "string" as const, nullable: true },
      ]),
    );

    // ── Empty dataset fast-path ───────────────────────────────────────────────
    if (N === 0) {
      const datasetId = createId();
      const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
      await writer.init();
      const { chunks } = await writer.finish();
      const now = new Date().toISOString();
      post({
        kind: "result",
        jobId,
        output: {
          manifest: {
            version: DATASET_MANIFEST_VERSION,
            datasetId,
            executionId,
            variableName,
            createdAt: now,
            updatedAt: now,
            rowCount: 0,
            chunkCount: 0,
            byteSize: 0,
            schema: outputSchema,
            chunks,
          },
          datasetRef: {
            kind: "dataset",
            datasetId,
            executionId,
            variableName,
            rowCount: 0,
            chunkCount: 0,
            byteSize: 0,
            schema: outputSchema,
          },
        },
      });
      return;
    }

    // ── Main restructure loop ─────────────────────────────────────────────────
    const datasetId = createId();
    const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
    await writer.init();

    const computedCount = outputColumns.filter((c) => c.type === "computed").length;
    post({
      kind: "progress",
      jobId,
      progress: 5,
      message: `Restructuring columns (${outputColumns.length} output, ${computedCount} computed)…`,
    });

    for (let c = 0; c < N; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      const restructured = chunk.map((row) => restructureRow(row, outputColumns));
      await writer.write(restructured);

      const pct = Math.round(5 + ((c + 1) / N) * 90);
      post({
        kind: "progress",
        jobId,
        progress: pct,
        message: `Chunk ${(c + 1).toLocaleString()} / ${N.toLocaleString()}`,
      });
    }

    const { chunks, totalBytes, totalRows } = await writer.finish();
    const now = new Date().toISOString();

    const manifest = {
      version: DATASET_MANIFEST_VERSION,
      datasetId,
      executionId,
      variableName,
      createdAt: now,
      updatedAt: now,
      rowCount: totalRows,
      chunkCount: chunks.length,
      byteSize: totalBytes,
      schema: outputSchema,
      chunks,
    };

    const datasetRef: DatasetRef = {
      kind: "dataset",
      datasetId,
      executionId,
      variableName,
      rowCount: totalRows,
      chunkCount: chunks.length,
      byteSize: totalBytes,
      schema: outputSchema,
    };

    post({ kind: "result", jobId, output: { manifest, datasetRef } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
