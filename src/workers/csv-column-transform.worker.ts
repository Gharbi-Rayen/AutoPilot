/**
 * CSV Column Transform Worker
 *
 * Streams through the input dataset chunk-by-chunk and applies an ordered
 * stack of operations to specified columns.  Operations run in declaration
 * order on each row; the result is written to a new OPFS dataset.
 *
 * Supported operations per column (stacked, applied top-to-bottom):
 *   prepend   — prepend a fixed string before the value
 *   append    — append a fixed string after the value
 *   replace   — find-and-replace (plain text or regex, global)
 *   remove    — delete all occurrences of a pattern (plain text or regex)
 *   trim      — strip leading/trailing whitespace
 *   case      — UPPERCASE | lowercase | Title Case
 *   formula   — evaluate a math expression; v = current numeric value
 *   set       — overwrite with a fixed value
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import {
  DATASET_MANIFEST_VERSION,
  type DatasetRef,
  type DatasetRow,
} from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS } from "./_opfs-helpers";

// ── Op types (mirror of dialog.tsx, kept local to the worker) ────────────────

type ColumnOpType =
  | "prepend"
  | "append"
  | "replace"
  | "remove"
  | "trim"
  | "case"
  | "formula"
  | "set";

type ColumnOp = {
  type: ColumnOpType;
  text?: string;
  setValue?: string;
  find?: string;
  replacement?: string;
  pattern?: string;
  useRegex?: boolean;
  caseMode?: "upper" | "lower" | "title";
  expression?: string;
};

type ColumnTransform = {
  column: string;
  ops: ColumnOp[];
};

// ── Safe Math sandbox ─────────────────────────────────────────────────────────
// Exposed to formula expressions instead of the global Math to prevent any
// access to the Worker's global scope through prototype chains.

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

function applyFormula(expression: string, rawValue: unknown): unknown {
  const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!Number.isFinite(num)) return rawValue; // non-numeric → keep as-is
  try {
    // biome-ignore lint/security/noFunctionConstructor: intentional sandboxed eval inside a Web Worker; global scope is not accessible via the restricted Math object
    const fn = new Function("v", "Math", `"use strict"; return (${expression});`);
    const result = fn(num, SAFE_MATH);
    return typeof result === "number" && Number.isFinite(result) ? result : rawValue;
  } catch {
    return rawValue; // invalid expression → keep original value
  }
}

// ── Regex builder ─────────────────────────────────────────────────────────────

function buildGlobalRegex(pattern: string, useRegex: boolean): RegExp | null {
  if (!pattern) return null;
  if (useRegex) {
    try {
      return new RegExp(pattern, "g");
    } catch {
      return null; // invalid regex pattern → skip the operation
    }
  }
  // Escape all special regex characters so the string is matched literally
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "g");
}

// ── Title-case helper ─────────────────────────────────────────────────────────

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ── Single-cell operation ─────────────────────────────────────────────────────

function applyOp(val: unknown, op: ColumnOp): unknown {
  switch (op.type) {
    case "prepend":
      return String(op.text ?? "") + String(val ?? "");

    case "append":
      return String(val ?? "") + String(op.text ?? "");

    case "replace": {
      const re = buildGlobalRegex(op.find ?? "", op.useRegex ?? false);
      return re ? String(val ?? "").replace(re, op.replacement ?? "") : String(val ?? "");
    }

    case "remove": {
      const re = buildGlobalRegex(op.pattern ?? "", op.useRegex ?? false);
      return re ? String(val ?? "").replace(re, "") : String(val ?? "");
    }

    case "trim":
      return String(val ?? "").trim();

    case "case": {
      const s = String(val ?? "");
      if (op.caseMode === "upper") return s.toUpperCase();
      if (op.caseMode === "lower") return s.toLowerCase();
      if (op.caseMode === "title") return toTitleCase(s);
      return s;
    }

    case "formula":
      return applyFormula(op.expression ?? "v", val);

    case "set":
      return op.setValue ?? "";

    default:
      return val;
  }
}

// ── Apply all transforms to a single row ──────────────────────────────────────

function applyTransforms(row: DatasetRow, transforms: ColumnTransform[]): DatasetRow {
  // Shallow-copy so the original chunk is not mutated
  const result: DatasetRow = { ...row };
  for (const { column, ops } of transforms) {
    if (!(column in result)) continue; // column not present in this row → skip
    let val: unknown = result[column];
    for (const op of ops) val = applyOp(val, op);
    result[column] = val;
  }
  return result;
}

// ── Worker entry point ────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    inputRef,
    transforms,
    executionId,
    variableName,
    chunkSize = 10_000,
  } = input as {
    inputRef: DatasetRef;
    transforms: ColumnTransform[];
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    const N = inputRef.chunkCount;

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
            schema: inputRef.schema,
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
            schema: inputRef.schema,
          },
        },
      });
      return;
    }

    // ── Main transform loop ───────────────────────────────────────────────────
    const datasetId = createId();
    const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
    await writer.init();

    post({
      kind: "progress",
      jobId,
      progress: 5,
      message: `Applying ${transforms.length} column transform${transforms.length !== 1 ? "s" : ""}…`,
    });

    for (let c = 0; c < N; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      const transformed = chunk.map((row) => applyTransforms(row, transforms));
      await writer.write(transformed);

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
      schema: inputRef.schema,
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
      schema: inputRef.schema,
    };

    post({ kind: "result", jobId, output: { manifest, datasetRef } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
