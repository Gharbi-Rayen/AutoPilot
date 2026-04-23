/**
 * CSV Compare — Browser Web Worker (streaming compare side)
 *
 * Memory model:
 *   - Small base (≤ PARTITION_THRESHOLD rows): load base into a Map, stream compare.
 *   - Large base (> PARTITION_THRESHOLD rows): grace hash compare — partition both
 *     datasets into K OPFS temp files by hash(rowKey) % K, then process each
 *     partition pair independently (peak memory ≈ 1/K of full base).
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
import { ChunkedOPFSWriter, readChunkFromOPFS, readFromOPFS } from "./_opfs-helpers";

const PARTITION_THRESHOLD = 500_000;

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

// ─── hashing ──────────────────────────────────────────────────────────────────

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

function partIdx(key: string, K: number): number {
  return Math.abs(djb2(key)) % K;
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

    const rowKey = (r: DatasetRow): string => {
      if (keyFields.length > 0) return keyFields.map((f) => String(r[f] ?? "")).join("|");
      const sorted = Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]]));
      return JSON.stringify(sorted);
    };

    // ── Schema detection from first chunks ──────────────────────────────────
    post({ kind: "progress", jobId, progress: 3, message: "Detecting schema..." });

    const baseChunk0 = baseRef.chunkCount > 0
      ? await readChunkFromOPFS(baseRef.executionId, baseRef.datasetId, 0)
      : [];
    const allBaseFields = baseChunk0.length > 0 ? Object.keys(baseChunk0[0]) : [];

    const cmpChunk0 = compareRef.chunkCount > 0
      ? await readChunkFromOPFS(compareRef.executionId, compareRef.datasetId, 0)
      : [];

    let mapping: Record<string, string> | null = null;
    let headerMismatchDetected = false;
    let schemaAligned = true;
    let allCmpFields: string[] = [];
    let mappedCmpFields: string[] = [];
    let fieldsToCompare: string[] = [];

    if (cmpChunk0.length > 0) {
      allCmpFields = Object.keys(cmpChunk0[0]);
      const norm = normalizeSchemas(allBaseFields, cmpChunk0[0]);
      mapping = norm.mapping;
      headerMismatchDetected = norm.headerMismatchDetected;
      schemaAligned = norm.schemaAligned;
      mappedCmpFields = mapping ? allCmpFields.map((k) => (mapping as Record<string, string>)[k] ?? k) : allCmpFields;
      const mappedSet = new Set(mappedCmpFields);
      const shared = allBaseFields.filter((f) => mappedSet.has(f));
      fieldsToCompare = cmpFields.length > 0 ? cmpFields.filter((f) => shared.includes(f)) : shared;
    }

    const totalBaseRows = baseRef.rowCount;
    let totalCompareRows = 0;

    // ── Output writers ───────────────────────────────────────────────────────
    const addedId = createId(); const removedId = createId();
    const changedId = createId(); const commonId = createId();

    const addedWriter  = new ChunkedOPFSWriter(executionId, addedId,  chunkSize);
    const removedWriter = new ChunkedOPFSWriter(executionId, removedId, chunkSize);
    const changedWriter = new ChunkedOPFSWriter(executionId, changedId, chunkSize);
    const commonWriter  = new ChunkedOPFSWriter(executionId, commonId,  chunkSize);
    await Promise.all([addedWriter.init(), removedWriter.init(), changedWriter.init(), commonWriter.init()]);

    // ── Inline diff helper ───────────────────────────────────────────────────
    async function processPair(baseRow: DatasetRow, cmpRow: DatasetRow): Promise<void> {
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

    const K = Math.max(1, Math.ceil(Math.max(baseRef.rowCount, compareRef.rowCount) / PARTITION_THRESHOLD));

    if (K === 1) {
      // ── Small datasets: load base into Map, stream compare ───────────────
      post({ kind: "progress", jobId, progress: 5, message: "Loading base dataset..." });
      const base = await readFromOPFS(baseRef.executionId, baseRef.datasetId, baseRef.chunkCount);
      const baseMap = new Map<string, DatasetRow>();
      for (const r of base) baseMap.set(rowKey(r), r);

      const matchedBaseKeys = new Set<string>();

      post({ kind: "progress", jobId, progress: 20, message: "Comparing datasets..." });
      for (let c = 0; c < compareRef.chunkCount; c++) {
        const rawChunk = await readChunkFromOPFS(compareRef.executionId, compareRef.datasetId, c);
        totalCompareRows += rawChunk.length;
        for (const rawRow of rawChunk) {
          const cmpRow = applyMapping(rawRow, mapping);
          const key = rowKey(cmpRow);
          if (!baseMap.has(key)) {
            await addedWriter.write([cmpRow]);
          } else {
            matchedBaseKeys.add(key);
            await processPair(baseMap.get(key) as DatasetRow, cmpRow);
          }
        }
        const pct = Math.round(20 + ((c + 1) / compareRef.chunkCount) * 55);
        post({ kind: "progress", jobId, progress: pct, message: `Compared ${totalCompareRows.toLocaleString()} rows...` });
      }

      post({ kind: "progress", jobId, progress: 77, message: "Finding removed rows..." });
      for (const [key, baseRow] of baseMap) {
        if (!matchedBaseKeys.has(key)) await removedWriter.write([baseRow]);
      }

    } else {
      // ── Large datasets: grace hash compare ───────────────────────────────
      post({ kind: "progress", jobId, progress: 5, message: `Partitioning into ${K} buckets...` });

      // Phase 1: partition base
      const basePartIds = Array.from({ length: K }, () => createId());
      const basePartWriters = basePartIds.map((id) => new ChunkedOPFSWriter(executionId, id, chunkSize));
      await Promise.all(basePartWriters.map((w) => w.init()));

      for (let c = 0; c < baseRef.chunkCount; c++) {
        const chunk = await readChunkFromOPFS(baseRef.executionId, baseRef.datasetId, c);
        const buckets: DatasetRow[][] = Array.from({ length: K }, () => []);
        for (const row of chunk) buckets[partIdx(rowKey(row), K)].push(row);
        for (let i = 0; i < K; i++) {
          if (buckets[i].length) await basePartWriters[i].write(buckets[i]);
        }
        const pct = Math.round(5 + ((c + 1) / baseRef.chunkCount) * 15);
        post({ kind: "progress", jobId, progress: pct, message: `Partitioning base... ${(c + 1).toLocaleString()} / ${baseRef.chunkCount} chunks` });
      }
      const basePartMeta = await Promise.all(basePartWriters.map((w) => w.finish()));

      // Phase 2: partition compare
      const cmpPartIds = Array.from({ length: K }, () => createId());
      const cmpPartWriters = cmpPartIds.map((id) => new ChunkedOPFSWriter(executionId, id, chunkSize));
      await Promise.all(cmpPartWriters.map((w) => w.init()));

      for (let c = 0; c < compareRef.chunkCount; c++) {
        const rawChunk = await readChunkFromOPFS(compareRef.executionId, compareRef.datasetId, c);
        totalCompareRows += rawChunk.length;
        const buckets: DatasetRow[][] = Array.from({ length: K }, () => []);
        for (const rawRow of rawChunk) {
          const cmpRow = applyMapping(rawRow, mapping);
          buckets[partIdx(rowKey(cmpRow), K)].push(rawRow);
        }
        for (let i = 0; i < K; i++) {
          if (buckets[i].length) await cmpPartWriters[i].write(buckets[i]);
        }
        const pct = Math.round(20 + ((c + 1) / compareRef.chunkCount) * 20);
        post({ kind: "progress", jobId, progress: pct, message: `Partitioning compare... ${(c + 1).toLocaleString()} / ${compareRef.chunkCount} chunks` });
      }
      const cmpPartMeta = await Promise.all(cmpPartWriters.map((w) => w.finish()));

      // Phase 3: compare each partition pair
      for (let i = 0; i < K; i++) {
        const basePartChunks = basePartMeta[i].chunks.length;
        const basePartMap = new Map<string, DatasetRow>();
        for (let ci = 0; ci < basePartChunks; ci++) {
          const chunk = await readChunkFromOPFS(executionId, basePartIds[i], ci);
          for (const row of chunk) basePartMap.set(rowKey(row), row);
        }
        const matchedBaseKeys = new Set<string>();

        const cmpPartChunks = cmpPartMeta[i].chunks.length;
        for (let ci = 0; ci < cmpPartChunks; ci++) {
          const rawChunk = await readChunkFromOPFS(executionId, cmpPartIds[i], ci);
          for (const rawRow of rawChunk) {
            const cmpRow = applyMapping(rawRow, mapping);
            const key = rowKey(cmpRow);
            if (!basePartMap.has(key)) {
              await addedWriter.write([cmpRow]);
            } else {
              matchedBaseKeys.add(key);
              await processPair(basePartMap.get(key) as DatasetRow, cmpRow);
            }
          }
        }

        for (const [key, baseRow] of basePartMap) {
          if (!matchedBaseKeys.has(key)) await removedWriter.write([baseRow]);
        }

        const pct = Math.round(40 + ((i + 1) / K) * 45);
        post({ kind: "progress", jobId, progress: pct, message: `Comparing partition ${i + 1} / ${K}...` });
      }
    }

    post({ kind: "progress", jobId, progress: 87, message: "Writing results..." });

    const [addedResult, removedResult, changedResult, commonResult] = await Promise.all([
      addedWriter.finish(),
      removedWriter.finish(),
      changedWriter.finish(),
      commonWriter.finish(),
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
    const schemaDiffWriter = new ChunkedOPFSWriter(executionId, schemaDiffId, chunkSize);
    await schemaDiffWriter.init();
    await schemaDiffWriter.write(schemaDiff);
    const schemaDiffResult = await schemaDiffWriter.finish();

    const addedVar   = `${variableName}_added`;
    const removedVar = `${variableName}_removed`;
    const changedVar = `${variableName}_changed`;
    const commonVar  = `${variableName}_common`;
    const schemaDiffVar = `${variableName}_schema_diff`;

    const isIdentical = addedResult.totalRows === 0 && removedResult.totalRows === 0 && changedResult.totalRows === 0;

    const compareResult = {
      _compareResult: true as const,
      isIdentical, schemaAligned, headerMismatchDetected,
      columnMapping: mapping ?? null,
      keyField: keyFields.length > 0 ? keyFields.join(", ") : null,
      compareFields: cmpFields.length > 0 ? cmpFields : allBaseFields.filter((f) => allCmpFields.includes(f)),
      totalBaseRows, totalCompareRows,
      addedCount: addedResult.totalRows, removedCount: removedResult.totalRows,
      changedCount: changedResult.totalRows, commonCount: commonResult.totalRows,
      unchangedCount: commonResult.totalRows,
      columnsInBase: allBaseFields.length, columnsInCompare: mappedCmpFields.length,
      columnsInBoth: allBaseFields.filter((f) => mappedCmpFields.includes(f)).length,
      columnsOnlyInBase: allBaseFields.filter((f) => !mappedCmpFields.includes(f)).length,
      columnsOnlyInCompare: mappedCmpFields.filter((f) => !allBaseFields.includes(f)).length,
      addedVarName: addedResult.totalRows > 0 ? addedVar : null,
      removedVarName: removedResult.totalRows > 0 ? removedVar : null,
      changedVarName: changedResult.totalRows > 0 ? changedVar : null,
      commonVarName: commonResult.totalRows > 0 ? commonVar : null,
      schemaDiffVarName: schemaDiff.length > 0 ? schemaDiffVar : null,
      summary: isIdentical
        ? `${totalBaseRows} matching rows — datasets are identical`
        : `${addedResult.totalRows} added, ${removedResult.totalRows} removed, ${changedResult.totalRows} changed, ${commonResult.totalRows} common`,
      changedDiffRowCount: changedResult.totalRows,
    };

    post({
      kind: "result", jobId,
      output: {
        compareResult,
        addedRef:     makeRef(addedId,     executionId, addedVar,     addedResult.totalRows,     addedResult.chunks.length,     addedResult.totalBytes),
        removedRef:   makeRef(removedId,   executionId, removedVar,   removedResult.totalRows,   removedResult.chunks.length,   removedResult.totalBytes),
        changedRef:   makeRef(changedId,   executionId, changedVar,   changedResult.totalRows,   changedResult.chunks.length,   changedResult.totalBytes),
        commonRef:    makeRef(commonId,    executionId, commonVar,    commonResult.totalRows,    commonResult.chunks.length,    commonResult.totalBytes),
        schemaDiffRef: makeRef(schemaDiffId, executionId, schemaDiffVar, schemaDiff.length,     schemaDiffResult.chunks.length, schemaDiffResult.totalBytes),
        addedManifest:      makeManifest(addedId,     executionId, addedVar,     addedResult.totalRows,     addedResult.totalBytes,     addedResult.chunks),
        removedManifest:    makeManifest(removedId,   executionId, removedVar,   removedResult.totalRows,   removedResult.totalBytes,   removedResult.chunks),
        changedManifest:    makeManifest(changedId,   executionId, changedVar,   changedResult.totalRows,   changedResult.totalBytes,   changedResult.chunks),
        commonManifest:     makeManifest(commonId,    executionId, commonVar,    commonResult.totalRows,    commonResult.totalBytes,    commonResult.chunks),
        schemaDiffManifest: makeManifest(schemaDiffId, executionId, schemaDiffVar, schemaDiff.length,      schemaDiffResult.totalBytes, schemaDiffResult.chunks),
      },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
