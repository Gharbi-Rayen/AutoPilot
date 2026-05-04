/**
 * FILE: src/workers/csv-restructure.worker.ts
 *
 * PURPOSE:
 *   Rebuilds the column layout of a dataset.  The output has exactly the columns
 *   defined in `outputColumns` — any input column not listed is dropped.
 *   Columns can be:
 *     passthrough — kept from the input as-is (can be reordered)
 *     computed    — a new column derived from other columns via a JS expression
 *                   using {{colName}} template syntax
 *
 * WHAT IS RESTRUCTURING?
 *   Restructuring transforms the SHAPE of the data (which columns exist and in what order),
 *   not the row values.  It is useful for:
 *     - Dropping unneeded columns (reduce file size)
 *     - Reordering columns
 *     - Adding computed columns (e.g. full name = {{first_name}} + " " + {{last_name}})
 *     - Renaming columns (add a computed col with the old name as its expression)
 *
 * WHAT IS THE {{colName}} EXPRESSION SYNTAX?
 *   Users write expressions like:  {{first_name}} + " " + {{last_name}}
 *   The worker extracts column references from {{…}} tokens, assigns them positional
 *   parameter names (_c0, _c1, …), then evaluates the expression using new Function().
 *   Column values are passed as numbers (if numeric) or strings (otherwise).
 *   SAFE_MATH is also available for math expressions (same as csv-column-transform).
 *
 * WHAT IS "PASSTHROUGH"?
 *   A passthrough column is an existing column from the input dataset.
 *   It is included in the output unchanged.  The order in outputColumns
 *   determines the column order in the output.
 *
 * DIFFERENCE FROM csv-column-transform:
 *   csv-column-transform — modifies VALUES within existing columns
 *   csv-restructure      — modifies the SCHEMA (which columns exist, what order, computed cols)
 *
 * INPUT (from WorkerJobMessage.input):
 *   inputRef      — DatasetRef of the dataset to restructure
 *   outputColumns — ordered list of OutputColumn definitions
 *   executionId   — current execution's ID
 *   variableName  — context key for the output dataset
 *   chunkSize     — rows per output chunk
 *
 * OUTPUT:
 *   manifest   — DatasetManifest with the new schema (only outputColumns)
 *   datasetRef — DatasetRef for the restructured output
 *
 * USED IN:
 *   src/features/executions/components/csv-restructure/executor.ts
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

/**
 * OutputColumn
 *
 * WHY THIS EXISTS:
 *   Describes one column in the desired output schema.
 *   There are two kinds of output columns:
 *     - "passthrough" — take an existing column from the input as-is (same name, same values)
 *     - "computed"    — derive a new column by evaluating a JS expression containing {{colName}} tokens
 *   This type is a TypeScript "discriminated union": the `type` field is the discriminant,
 *   meaning TypeScript can tell which branch you're on just by checking `col.type`.
 *
 * FIELD MEANINGS:
 *   type       — "passthrough" | "computed" — which kind of output column this is
 *   name       — the column name in the output dataset
 *   expression — (computed only) JS expression template, e.g. "{{first}} + ' ' + {{last}}"
 *
 * USED IN:
 *   restructureRow() — iterates outputColumns and builds each row
 *   evalExpression() — receives the expression string for computed columns
 *   self.onmessage   — destructured from input.outputColumns
 *   src/features/executions/components/csv-restructure/dialog.tsx — builds this array from form
 */
type OutputColumn =
  | { type: "passthrough"; name: string }
  | { type: "computed"; name: string; expression: string };

// ── Safe Math sandbox ─────────────────────────────────────────────────────────

/**
 * SAFE_MATH
 *
 * WHY THIS EXISTS:
 *   Computed column expressions are evaluated with `new Function()` — a JS built-in that
 *   creates a function from a string at runtime.  If we passed the real global `Math`
 *   object, a crafted expression could escape the sandbox via prototype chain traversal
 *   (e.g. Math.__proto__.__proto__ reaches the Worker global).
 *   SAFE_MATH is a frozen plain object containing ONLY the safe Math methods, so no
 *   prototype-chain escape is possible.
 *
 * WHAT IS Object.freeze()?
 *   Makes an object immutable — no properties can be added, removed, or modified after
 *   freezing.  This prevents a computed expression from modifying SAFE_MATH itself.
 *
 * USED IN:
 *   evalExpression() — passed as the "Math" parameter to new Function() calls
 */
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
  let match = tokenRe.exec(expression);
  while (match !== null) {
    const colName = match[1].trim();
    if (!seen.has(colName)) {
      seen.set(colName, `_c${seen.size}`);
    }
    match = tokenRe.exec(expression);
  }

  // Replace {{colName}} tokens with their param names in the expression.
  // Uses a regex to tolerate optional whitespace inside {{ }} (e.g. {{ price }}).
  let fnBody = expression;
  for (const [colName, paramName] of seen.entries()) {
    const escaped = colName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    fnBody = fnBody.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, "g"), paramName);
  }

  const paramNames = [...seen.values()];
  const paramValues = [...seen.keys()].map((colName) => {
    const raw = String(row[colName] ?? "");
    const num = Number(raw);
    return raw.trim() !== "" && Number.isFinite(num) ? num : raw;
  });

  try {
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
