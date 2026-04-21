/**
 * CSV Compare — Browser Web Worker (streaming compare side)
 *
 * Memory model: base dataset is loaded into a Map keyed by row identity.
 * The compare dataset is streamed chunk by chunk. Output rows (added, removed,
 * changed, common) are written incrementally via ChunkedOPFSWriter — never
 * accumulating all diff rows in memory at once.
 *
 * Produces FIVE OPFS datasets:
 *   <variableName>_added       — rows in compareRef not present in baseRef
 *   <variableName>_removed     — rows in baseRef not present in compareRef
 *   <variableName>_changed     — side-by-side diff rows
 *   <variableName>_common      — rows identical in both datasets
 *   <variableName>_schema_diff — column-level schema comparison table
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS, readFromOPFS, writeToOPFS } from "./_opfs-helpers";

// ─── schema normalization ─────────────────────────────────────────────────────

function isNumericKeys(keys: string[]): boolean {
  return keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
}

function normalizeSchemas(baseKeys: string[], compareFirstRow: DatasetRow): {
  mapping: Record<string, string> | null;
  headerMismatchDetected: boolean;
  schemaAligned: boolean;
} {
  const keysB = Object.keys(compareFirstRow);
  const aligned = baseKeys.length === keysB.length && baseKeys.every((k, i) => k === keysB[i]);
  if (aligned) return { mapping: null, headerMismatchDetected: false, schemaAligned: true };

  const bNumeric = isNumericKeys(keysB);
  const aNumeric = isNumericKeys(baseKeys);
  const mapping: Record<string, string> = {};
  const len = Math.min(baseKeys.length, keysB.length);
  for (let i = 0; i < len; i++) mapping[keysB[i]] = baseKeys[i];
  for (let i = len; i < keysB.length; i++) mapping[keysB[i]] = keysB[i];

  return {
    mapping,
    headerMismatchDetected: bNumeric !== aNumeric,
    schemaAligned: false,
  };
}

function applyMapping(row: DatasetRow, mapping: Record<string, string> | null): DatasetRow {
  if (!mapping) return row;
  const out: DatasetRow = {};
  for (const [bKey, aKey] of Object.entries(mapping)) {
    if (bKey in row) out[aKey] = row[bKey];
  }
  return out;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRef(datasetId: string, executionId: string, variableName: string,
  rowCount: number, chunkCount: number, byteSize: number): DatasetRef {
  return { kind: "dataset", datasetId, executionId, variableName, rowCount, chunkCount, byteSize };
}

function makeManifest(datasetId: string, executionId: string, variableName: string,
  rowCount: number, byteSize: number, chunks: unknown[]) {
  const now = new Date().toISOString();
  return {
    version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName,
    createdAt: now, updatedAt: now, rowCount, chunkCount: chunks.length, byteSize, chunks,
  };
}

// ─── worker ───────────────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { baseRef, compareRef, keyField = "", compareFields = "",
    executionId, variableName = "diffData", chunkSize = 10_000 } = input as {
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
    const keyFields = String(keyField || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cmpFields = String(compareFields || "").split(",").map((s) => s.trim()).filter(Boolean);

    // Load base dataset into memory (needed for lookup during compare streaming)
    post({ kind: "progress", jobId, progress: 5, message: "Loading base dataset..." });
    const base = await readFromOPFS(baseRef.executionId, baseRef.datasetId, baseRef.chunkCount);
    const allBaseFields = base.length > 0 ? Object.keys(base[0]) : [];

    const rowKey = (r: DatasetRow): string => {
      if (keyFields.length > 0) return keyFields.map((f) => String(r[f] ?? "")).join("|");
      const sorted = Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]]));
      return JSON.stringify(sorted);
    };

    const baseMap = new Map<string, DatasetRow>();
    for (const r of base) baseMap.set(rowKey(r), r);

    // Detect schema normalization from first compare chunk
    let mapping: Record<string, string> | null = null;
    let headerMismatchDetected = false;
    let schemaAligned = true;

    // Create output writers
    const addedId = createId(); const removedId = createId();
    const changedId = createId(); const commonId = createId();

    const addedWriter  = new ChunkedOPFSWriter(executionId, addedId,  chunkSize);
    const changedWriter = new ChunkedOPFSWriter(executionId, changedId, chunkSize);
    const commonWriter  = new ChunkedOPFSWriter(executionId, commonId,  chunkSize);
    await Promise.all([addedWriter.init(), changedWriter.init(), commonWriter.init()]);

    const matchedBaseKeys = new Set<string>();
    let allCmpFields: string[] = [];
    let mappedCmpFields: string[] = [];
    let fieldsToCompare: string[] = [];
    let totalCompareRows = 0;

    // Stream compare dataset
    post({ kind: "progress", jobId, progress: 20, message: "Comparing datasets..." });
    for (let c = 0; c < compareRef.chunkCount; c++) {
      const rawChunk = await readChunkFromOPFS(compareRef.executionId, compareRef.datasetId, c);
      totalCompareRows += rawChunk.length;

      // Detect schema from first chunk and compute fieldsToCompare once
      if (c === 0 && rawChunk.length > 0) {
        allCmpFields = Object.keys(rawChunk[0]);
        const norm = normalizeSchemas(allBaseFields, rawChunk[0]);
        mapping = norm.mapping;
        headerMismatchDetected = norm.headerMismatchDetected;
        schemaAligned = norm.schemaAligned;
        // Use post-mapping compare field names so intersection with base fields is correct
        mappedCmpFields = mapping ? allCmpFields.map((k) => (mapping as Record<string, string>)[k] ?? k) : allCmpFields;
        const mappedSet = new Set(mappedCmpFields);
        const shared = allBaseFields.filter((f) => mappedSet.has(f));
        fieldsToCompare = cmpFields.length > 0 ? cmpFields.filter((f) => shared.includes(f)) : shared;
      }

      for (const rawRow of rawChunk) {
        const cmpRow = applyMapping(rawRow, mapping);
        const key = rowKey(cmpRow);
        if (!baseMap.has(key)) {
          await addedWriter.write([cmpRow]);
        } else {
          matchedBaseKeys.add(key);
          const baseRow = baseMap.get(key) as DatasetRow;
          const changedFieldsList = fieldsToCompare.filter(
            (f) => String(cmpRow[f] ?? "") !== String(baseRow[f] ?? ""),
          );
          if (changedFieldsList.length > 0) {
            const diffRow: DatasetRow = {};
            if (keyFields.length > 0) diffRow._diff_key = keyFields.map((f) => String(baseRow[f] ?? "")).join("|");
            diffRow._diff_changed = changedFieldsList.join(",");
            for (const f of fieldsToCompare) {
              diffRow[`_before_${f}`] = baseRow[f];
              diffRow[`_after_${f}`] = cmpRow[f];
            }
            await changedWriter.write([diffRow]);
          } else {
            await commonWriter.write([baseRow]);
          }
        }
      }

      const pct = Math.round(20 + ((c + 1) / compareRef.chunkCount) * 55);
      post({ kind: "progress", jobId, progress: pct, message: `Compared ${totalCompareRows.toLocaleString()} rows...` });
    }

    // Collect removed rows (base rows not matched in compare)
    post({ kind: "progress", jobId, progress: 77, message: "Finding removed rows..." });
    const removed: DatasetRow[] = [];
    for (const [key, baseRow] of baseMap) {
      if (!matchedBaseKeys.has(key)) removed.push(baseRow);
    }

    post({ kind: "progress", jobId, progress: 82, message: "Writing results..." });

    const [addedResult, changedResult, commonResult, removedResult] = await Promise.all([
      addedWriter.finish(),
      changedWriter.finish(),
      commonWriter.finish(),
      writeToOPFS(executionId, removedId, removed, chunkSize),
    ]);

    // Schema diff dataset
    const schemaDiffId = createId();
    const allColumns = new Set([...allBaseFields, ...mappedCmpFields]);
    const schemaDiff: DatasetRow[] = Array.from(allColumns).map((col) => ({
      column: col,
      in_base: allBaseFields.includes(col) ? "yes" : "no",
      in_compare: mappedCmpFields.includes(col) ? "yes" : "no",
      mapped_from: mapping
        ? (Object.entries(mapping).find(([, v]) => v === col)?.[0] ?? col)
        : col,
    }));
    const schemaDiffResult = await writeToOPFS(executionId, schemaDiffId, schemaDiff, chunkSize);

    const addedVar   = `${variableName}_added`;
    const removedVar = `${variableName}_removed`;
    const changedVar = `${variableName}_changed`;
    const commonVar  = `${variableName}_common`;
    const schemaDiffVar = `${variableName}_schema_diff`;

    const isIdentical = addedResult.totalRows === 0 && removed.length === 0 && changedResult.totalRows === 0;

    const compareResult = {
      _compareResult: true as const,
      isIdentical, schemaAligned, headerMismatchDetected,
      columnMapping: mapping ?? null,
      keyField: keyFields.length > 0 ? keyFields.join(", ") : null,
      compareFields: cmpFields.length > 0 ? cmpFields : allBaseFields.filter((f) => allCmpFields.includes(f)),
      totalBaseRows: base.length, totalCompareRows,
      addedCount: addedResult.totalRows, removedCount: removed.length,
      changedCount: changedResult.totalRows, commonCount: commonResult.totalRows,
      unchangedCount: commonResult.totalRows,
      columnsInBase: allBaseFields.length, columnsInCompare: mappedCmpFields.length,
      columnsInBoth: allBaseFields.filter((f) => mappedCmpFields.includes(f)).length,
      columnsOnlyInBase: allBaseFields.filter((f) => !mappedCmpFields.includes(f)).length,
      columnsOnlyInCompare: mappedCmpFields.filter((f) => !allBaseFields.includes(f)).length,
      addedVarName: addedResult.totalRows > 0 ? addedVar : null,
      removedVarName: removed.length > 0 ? removedVar : null,
      changedVarName: changedResult.totalRows > 0 ? changedVar : null,
      commonVarName: commonResult.totalRows > 0 ? commonVar : null,
      schemaDiffVarName: schemaDiff.length > 0 ? schemaDiffVar : null,
      summary: isIdentical
        ? `${base.length} matching rows — datasets are identical`
        : `${addedResult.totalRows} added, ${removed.length} removed, ${changedResult.totalRows} changed, ${commonResult.totalRows} common`,
      changedDiffRowCount: changedResult.totalRows,
    };

    post({
      kind: "result", jobId,
      output: {
        compareResult,
        addedRef:     makeRef(addedId,     executionId, addedVar,     addedResult.totalRows,   addedResult.chunks.length,   addedResult.totalBytes),
        removedRef:   makeRef(removedId,   executionId, removedVar,   removed.length,          removedResult.chunks.length, removedResult.totalBytes),
        changedRef:   makeRef(changedId,   executionId, changedVar,   changedResult.totalRows, changedResult.chunks.length, changedResult.totalBytes),
        commonRef:    makeRef(commonId,    executionId, commonVar,    commonResult.totalRows,  commonResult.chunks.length,  commonResult.totalBytes),
        schemaDiffRef: makeRef(schemaDiffId, executionId, schemaDiffVar, schemaDiff.length,   schemaDiffResult.chunks.length, schemaDiffResult.totalBytes),
        addedManifest:     makeManifest(addedId,     executionId, addedVar,     addedResult.totalRows,   addedResult.totalBytes,   addedResult.chunks),
        removedManifest:   makeManifest(removedId,   executionId, removedVar,   removed.length,          removedResult.totalBytes, removedResult.chunks),
        changedManifest:   makeManifest(changedId,   executionId, changedVar,   changedResult.totalRows, changedResult.totalBytes, changedResult.chunks),
        commonManifest:    makeManifest(commonId,    executionId, commonVar,    commonResult.totalRows,  commonResult.totalBytes,  commonResult.chunks),
        schemaDiffManifest: makeManifest(schemaDiffId, executionId, schemaDiffVar, schemaDiff.length,   schemaDiffResult.totalBytes, schemaDiffResult.chunks),
      },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
