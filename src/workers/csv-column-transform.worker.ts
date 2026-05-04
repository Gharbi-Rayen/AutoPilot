/**
 * FILE: src/workers/csv-column-transform.worker.ts
 *
 * PURPOSE:
 *   Applies an ordered stack of operations to specific columns in every row.
 *   Unlike csv-transform (which is conditional), this worker applies its operations
 *   UNCONDITIONALLY to every value in the specified columns.
 *   Streams OPFS chunks one at a time — constant memory regardless of dataset size.
 *
 * WHAT IS A COLUMN TRANSFORM?
 *   A column transform defines operations to apply to specific columns.
 *   Example: for the "Email" column, apply [trim, lowercase].
 *   Every cell in "Email" is trimmed and lowercased — no condition required.
 *
 * WHAT IS AN OPERATION STACK?
 *   Each column can have multiple operations applied in order (a "stack").
 *   The output of each operation is the input of the next.
 *   Example: prepend("Mr. ") → trim() → uppercase()
 *     Input: " alice "
 *     After prepend: "Mr.  alice "
 *     After trim: "Mr. alice"
 *     After uppercase: "MR. ALICE"
 *
 * DIFFERENCE FROM csv-transform:
 *   csv-transform   — conditional (only rows matching a condition are affected)
 *   csv-column-transform — unconditional (every value in the column is transformed)
 *
 * SUPPORTED OPERATIONS:
 *   prepend  — add a string before the cell value
 *   append   — add a string after the cell value
 *   replace  — find a pattern (text or regex) and replace with another string
 *   remove   — find a pattern (text or regex) and delete all occurrences
 *   trim     — strip leading and trailing whitespace
 *   case     — convert to UPPER | lower | Title Case
 *   formula  — evaluate a math expression (v = current numeric value)
 *              example: "v * 1.2" → multiply value by 1.2
 *   set      — replace the entire cell with a fixed value
 *
 * WHAT IS THE "FORMULA" OPERATION?
 *   Allows arbitrary math expressions to be applied to numeric columns.
 *   The expression receives:
 *     v    — the current numeric value of the cell
 *     Math — a sandboxed Math object (see SAFE_MATH) to prevent scope escaping
 *   Example expressions: "v * 1.2", "Math.round(v)", "v + 100"
 *   Non-numeric cells are left unchanged.
 *   Uses `new Function()` for dynamic expression evaluation — sandboxed inside a
 *   Web Worker (no DOM, no secrets accessible via prototype chains).
 *
 * WHAT IS SAFE_MATH?
 *   A frozen object containing only the Math functions that are safe and useful
 *   in formula expressions.  Passing this instead of the global Math prevents
 *   the expression from accessing Worker global state via Math.__proto__ or similar.
 *
 * INPUT (from WorkerJobMessage.input):
 *   inputRef   — DatasetRef of the dataset to transform
 *   transforms — array of ColumnTransform objects (one per column to modify)
 *   executionId — current execution's ID
 *   variableName — context key for the output dataset
 *   chunkSize  — rows per output chunk
 *
 * OUTPUT:
 *   manifest   — DatasetManifest for the transformed output
 *   datasetRef — DatasetRef for the transformed output
 *
 * USED IN:
 *   src/features/executions/components/csv-column-transform/executor.ts
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

/**
 * ColumnOpType
 *
 * WHY THIS EXISTS:
 *   Union type of all valid operation type names.
 *   "Mirror of dialog.tsx" means the same set of types must be defined in both
 *   the UI dialog (which builds the config) and the worker (which executes it).
 *   They are NOT shared via import — this keeps the worker self-contained.
 */
type ColumnOpType =
  | "prepend"
  | "append"
  | "replace"
  | "remove"
  | "trim"
  | "case"
  | "formula"
  | "set";

/**
 * ColumnOp
 *
 * WHY THIS EXISTS:
 *   Describes one operation in a column's operation stack.
 *   Different operation types use different fields — TypeScript allows optional
 *   fields here because not all ops need all properties.
 *
 * FIELD MEANINGS:
 *   type        — which operation to apply
 *   text        — used by prepend / append (the string to add)
 *   setValue    — used by set (the fixed value to write)
 *   find        — used by replace (the pattern to find)
 *   replacement — used by replace (what to replace it with)
 *   pattern     — used by remove (the pattern to delete)
 *   useRegex    — if true, treat find/pattern as a regular expression
 *   caseMode    — used by case: "upper" | "lower" | "title"
 *   expression  — used by formula: the math expression string (e.g. "v * 1.2")
 */
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

/**
 * ColumnTransform
 *
 * WHY THIS EXISTS:
 *   Bundles a column name with its ordered stack of operations.
 *   The worker receives an array of ColumnTransform — one per column to modify.
 *
 * FIELD MEANINGS:
 *   column — the dataset column to apply operations to
 *   ops    — ordered list of operations to apply (first op's output → second op's input)
 *
 * USED IN:
 *   applyTransforms() — iterates transforms, applies each column's ops stack
 *   self.onmessage    — destructured from input.transforms
 */
type ColumnTransform = {
  column: string;
  ops: ColumnOp[];
};

// ── Safe Math sandbox ─────────────────────────────────────────────────────────

/**
 * SAFE_MATH
 *
 * WHY THIS EXISTS:
 *   Formula expressions are evaluated with `new Function(...)` — this creates a
 *   new function from a string at runtime.  If we passed the real `Math` global,
 *   a malicious expression could traverse the prototype chain to access the Worker's
 *   global scope:  Math.__proto__.__proto__  → global object.
 *   By passing a frozen plain object with ONLY the safe Math methods, we prevent
 *   this prototype-chain escape.
 *
 * WHAT IS Object.freeze()?
 *   Object.freeze(obj) makes an object immutable — no properties can be added,
 *   removed, or modified.  This prevents the formula from modifying SAFE_MATH itself.
 *
 * WHAT IS `new Function()`?
 *   new Function("v", "Math", "return v * 1.2") creates a function equivalent to:
 *     function(v, Math) { return v * 1.2; }
 *   The parameters "v" and "Math" are the names available inside the function.
 *   We pass the numeric value as `v` and our SAFE_MATH object as `Math`.
 *
 * USED IN:
 *   applyFormula() — called for each "formula" operation
 */
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
