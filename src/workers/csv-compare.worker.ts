/**
 * CSV Compare — Browser Web Worker (v2)
 *
 * Produces FIVE separate OPFS datasets:
 *   <variableName>_added       — rows in compareRef not present in baseRef
 *   <variableName>_removed     — rows in baseRef not present in compareRef
 *   <variableName>_changed     — side-by-side diff rows
 *   <variableName>_common      — rows identical in both datasets
 *   <variableName>_schema_diff — column-level schema comparison table
 *
 * Intelligently handles header mismatches (one file parsed without headers).
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetRef } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";
import { readFromOPFS, writeToOPFS } from "./_opfs-helpers";

// ─── helpers ──────────────────────────────────────────────────────────────────

const makeRef = (
  datasetId: string,
  executionId: string,
  variableName: string,
  rowCount: number,
  chunkCount: number,
  byteSize: number,
): DatasetRef => ({
  kind: "dataset",
  datasetId,
  executionId,
  variableName,
  rowCount,
  chunkCount,
  byteSize,
});

const makeManifest = (
  datasetId: string,
  executionId: string,
  variableName: string,
  rowCount: number,
  byteSize: number,
  chunks: unknown[],
) => {
  const now = new Date().toISOString();
  return {
    version: DATASET_MANIFEST_VERSION,
    datasetId,
    executionId,
    variableName,
    createdAt: now,
    updatedAt: now,
    rowCount,
    chunkCount: chunks.length,
    byteSize,
    chunks,
  };
};

// ─── schema normalization ─────────────────────────────────────────────────────

function isNumericKeys(keys: string[]): boolean {
  return keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
}

/**
 * Normalizes compare dataset columns to match base dataset columns.
 * Returns a mapping from compareKey → baseKey and the re-keyed compare rows.
 */
function normalizeSchemas(
  base: DatasetRow[],
  compare: DatasetRow[],
): {
  normalizedCompare: DatasetRow[];
  columnMapping: Record<string, string> | null;
  headerMismatchDetected: boolean;
  schemaAligned: boolean;
  columnsOnlyInBase: string[];
  columnsOnlyInCompare: string[];
  columnsInBoth: string[];
} {
  const empty = {
    normalizedCompare: compare,
    columnMapping: null,
    headerMismatchDetected: false,
    schemaAligned: true,
    columnsOnlyInBase: [] as string[],
    columnsOnlyInCompare: [] as string[],
    columnsInBoth: [] as string[],
  };

  if (base.length === 0 || compare.length === 0) return empty;

  const keysA = Object.keys(base[0]);
  const keysB = Object.keys(compare[0]);

  const setA = new Set(keysA);
  const setB = new Set(keysB);

  const inBoth = keysA.filter((k) => setB.has(k));
  const onlyA = keysA.filter((k) => !setB.has(k));
  const onlyB = keysB.filter((k) => !setA.has(k));

  // Already aligned
  const aligned =
    keysA.length === keysB.length &&
    keysA.every((k, i) => k === keysB[i]);

  if (aligned) {
    return { ...empty, columnsInBoth: inBoth, columnsOnlyInBase: onlyA, columnsOnlyInCompare: onlyB };
  }

  // Build a positional mapping: compareKey -> baseKey
  const bNumeric = isNumericKeys(keysB);
  const aNumeric = isNumericKeys(keysA);
  const headerMismatch = bNumeric !== aNumeric;

  const mapping: Record<string, string> = {};
  const len = Math.min(keysA.length, keysB.length);
  for (let i = 0; i < len; i++) {
    mapping[keysB[i]] = keysA[i];
  }
  // Extra B columns beyond A's length stay as-is
  for (let i = len; i < keysB.length; i++) {
    mapping[keysB[i]] = keysB[i];
  }

  const normalizedCompare = compare.map((row) => {
    const newRow: DatasetRow = {};
    for (const [bKey, aKey] of Object.entries(mapping)) {
      if (bKey in row) newRow[aKey] = row[bKey];
    }
    return newRow;
  });

  // Recompute column sets after normalization
  const normalizedKeysB = keysB.map((k) => mapping[k] ?? k);
  const setNB = new Set(normalizedKeysB);
  const inBothNorm = keysA.filter((k) => setNB.has(k));
  const onlyANorm = keysA.filter((k) => !setNB.has(k));
  const onlyBNorm = normalizedKeysB.filter((k) => !setA.has(k));

  return {
    normalizedCompare,
    columnMapping: mapping,
    headerMismatchDetected: headerMismatch,
    schemaAligned: false,
    columnsInBoth: inBothNorm,
    columnsOnlyInBase: onlyANorm,
    columnsOnlyInCompare: onlyBNorm,
  };
}

// ─── worker ───────────────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    baseRef,
    compareRef,
    keyField = "",
    compareFields = "",
    executionId,
    variableName = "diffData",
    chunkSize = 10_000,
  } = input as {
    baseRef: DatasetRef;
    compareRef: DatasetRef;
    keyField?: string;
    compareFields?: string;
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    const keyFields = String(keyField || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const cmpFields = String(compareFields || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    post({ kind: "progress", jobId, progress: 5, message: "Reading base dataset…" });
    const base = await readFromOPFS(baseRef.executionId, baseRef.datasetId, baseRef.chunkCount);

    post({ kind: "progress", jobId, progress: 25, message: "Reading compare dataset…" });
    const rawCompare = await readFromOPFS(compareRef.executionId, compareRef.datasetId, compareRef.chunkCount);

    post({ kind: "progress", jobId, progress: 35, message: "Normalizing schemas…" });

    const {
      normalizedCompare: compare,
      columnMapping,
      headerMismatchDetected,
      schemaAligned,
      columnsInBoth,
      columnsOnlyInBase,
      columnsOnlyInCompare,
    } = normalizeSchemas(base, rawCompare);

    post({ kind: "progress", jobId, progress: 45, message: "Comparing rows…" });

    const allBaseFields = base.length > 0 ? Object.keys(base[0]) : [];
    const allCmpFields = compare.length > 0 ? Object.keys(compare[0]) : [];
    const sharedFields = allBaseFields.filter((f) => allCmpFields.includes(f));
    const fieldsToCompare =
      cmpFields.length > 0
        ? cmpFields.filter((f) => sharedFields.includes(f))
        : sharedFields;

    const rowKey = (r: DatasetRow): string => {
      if (keyFields.length > 0) {
        return keyFields.map((f) => String(r[f] ?? "")).join("|");
      }
      // Stable key: sort fields before stringify to handle out-of-order keys
      const sorted = Object.fromEntries(
        Object.keys(r).sort().map((k) => [k, r[k]])
      );
      return JSON.stringify(sorted);
    };

    const baseMap = new Map<string, DatasetRow>();
    for (const r of base) baseMap.set(rowKey(r), r);

    const compareMap = new Map<string, DatasetRow>();
    for (const r of compare) compareMap.set(rowKey(r), r);

    const added: DatasetRow[] = [];
    const removed: DatasetRow[] = [];
    const changed: DatasetRow[] = [];
    const common: DatasetRow[] = [];

    for (const [key, cmpRow] of compareMap) {
      if (!baseMap.has(key)) {
        added.push(cmpRow);
      } else {
        const baseRow = baseMap.get(key)!;
        const changedFields = fieldsToCompare.filter(
          (f) => String(cmpRow[f] ?? "") !== String(baseRow[f] ?? ""),
        );
        if (changedFields.length > 0) {
          const diffRow: DatasetRow = {};
          if (keyFields.length > 0) {
            diffRow._diff_key = keyFields.map((f) => String(baseRow[f] ?? "")).join("|");
          }
          diffRow._diff_changed = changedFields.join(",");
          for (const f of fieldsToCompare) {
            diffRow[`_before_${f}`] = baseRow[f];
            diffRow[`_after_${f}`] = cmpRow[f];
          }
          changed.push(diffRow);
        } else {
          common.push(baseRow);
        }
      }
    }

    for (const [key, baseRow] of baseMap) {
      if (!compareMap.has(key)) removed.push(baseRow);
    }

    // Schema diff dataset: one row per column
    const allColumns = new Set([...allBaseFields, ...allCmpFields]);
    const schemaDiff: DatasetRow[] = Array.from(allColumns).map((col) => ({
      column: col,
      in_base: allBaseFields.includes(col) ? "yes" : "no",
      in_compare: allCmpFields.includes(col) ? "yes" : "no",
      mapped_from: columnMapping
        ? (Object.entries(columnMapping).find(([, v]) => v === col)?.[0] ?? col)
        : col,
    }));

    post({ kind: "progress", jobId, progress: 60, message: "Writing diff datasets…" });

    const addedId = createId();
    const removedId = createId();
    const changedId = createId();
    const commonId = createId();
    const schemaDiffId = createId();

    const addedVar = `${variableName}_added`;
    const removedVar = `${variableName}_removed`;
    const changedVar = `${variableName}_changed`;
    const commonVar = `${variableName}_common`;
    const schemaDiffVar = `${variableName}_schema_diff`;

    const [addedResult, removedResult, changedResult, commonResult, schemaDiffResult] =
      await Promise.all([
        writeToOPFS(executionId, addedId, added, chunkSize),
        writeToOPFS(executionId, removedId, removed, chunkSize),
        writeToOPFS(executionId, changedId, changed, chunkSize),
        writeToOPFS(executionId, commonId, common, chunkSize),
        writeToOPFS(executionId, schemaDiffId, schemaDiff, chunkSize),
      ]);

    post({ kind: "progress", jobId, progress: 90, message: "Building result…" });

    const isIdentical =
      added.length === 0 && removed.length === 0 && changed.length === 0;

    const compareResult = {
      _compareResult: true as const,
      isIdentical,
      schemaAligned,
      headerMismatchDetected,
      columnMapping: columnMapping ?? null,
      keyField: keyFields.length > 0 ? keyFields.join(", ") : null,
      compareFields: fieldsToCompare,
      totalBaseRows: base.length,
      totalCompareRows: rawCompare.length,
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length,
      commonCount: common.length,
      unchangedCount: Math.max(0, common.length),
      columnsInBase: allBaseFields.length,
      columnsInCompare: allCmpFields.length,
      columnsInBoth: columnsInBoth.length,
      columnsOnlyInBase: columnsOnlyInBase.length,
      columnsOnlyInCompare: columnsOnlyInCompare.length,
      addedVarName: added.length > 0 ? addedVar : null,
      removedVarName: removed.length > 0 ? removedVar : null,
      changedVarName: changed.length > 0 ? changedVar : null,
      commonVarName: common.length > 0 ? commonVar : null,
      schemaDiffVarName: schemaDiff.length > 0 ? schemaDiffVar : null,
      summary: isIdentical
        ? `${base.length} matching rows — datasets are identical`
        : `${added.length} added, ${removed.length} removed, ${changed.length} changed, ${common.length} common`,
      // Legacy fields (keep for backward compat with viewer)
      changedDiffRowCount: changed.length,
    };

    const addedRef = makeRef(addedId, executionId, addedVar, added.length, addedResult.chunks.length, addedResult.totalBytes);
    const removedRef = makeRef(removedId, executionId, removedVar, removed.length, removedResult.chunks.length, removedResult.totalBytes);
    const changedRef = makeRef(changedId, executionId, changedVar, changed.length, changedResult.chunks.length, changedResult.totalBytes);
    const commonRef = makeRef(commonId, executionId, commonVar, common.length, commonResult.chunks.length, commonResult.totalBytes);
    const schemaDiffRef = makeRef(schemaDiffId, executionId, schemaDiffVar, schemaDiff.length, schemaDiffResult.chunks.length, schemaDiffResult.totalBytes);

    const addedManifest = makeManifest(addedId, executionId, addedVar, added.length, addedResult.totalBytes, addedResult.chunks);
    const removedManifest = makeManifest(removedId, executionId, removedVar, removed.length, removedResult.totalBytes, removedResult.chunks);
    const changedManifest = makeManifest(changedId, executionId, changedVar, changed.length, changedResult.totalBytes, changedResult.chunks);
    const commonManifest = makeManifest(commonId, executionId, commonVar, common.length, commonResult.totalBytes, commonResult.chunks);
    const schemaDiffManifest = makeManifest(schemaDiffId, executionId, schemaDiffVar, schemaDiff.length, schemaDiffResult.totalBytes, schemaDiffResult.chunks);

    post({
      kind: "result",
      jobId,
      output: {
        compareResult,
        addedRef, removedRef, changedRef, commonRef, schemaDiffRef,
        addedManifest, removedManifest, changedManifest, commonManifest, schemaDiffManifest,
      },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};

export {};
