/**
 * CSV Compare — Browser Web Worker
 *
 * Produces THREE separate OPFS datasets from two input datasets:
 *   <variableName>_added   — rows in compareRef not present in baseRef
 *   <variableName>_removed — rows in baseRef not present in compareRef
 *   <variableName>_changed — side-by-side diff rows (_before_*, _after_*, _diff_changed, _diff_key)
 *
 * Returns a CompareResult object (compatible with ExecutionCompareViewer) plus the
 * three DatasetRefs and their manifests so the execution engine can persist them all.
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
    // Parse field lists
    const keyFields = String(keyField || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const cmpFields = String(compareFields || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    post({ kind: "progress", jobId, progress: 5, message: "Reading base dataset…" });
    const base = await readFromOPFS(
      baseRef.executionId,
      baseRef.datasetId,
      baseRef.chunkCount,
    );

    post({ kind: "progress", jobId, progress: 25, message: "Reading compare dataset…" });
    const compare = await readFromOPFS(
      compareRef.executionId,
      compareRef.datasetId,
      compareRef.chunkCount,
    );

    post({ kind: "progress", jobId, progress: 45, message: "Comparing rows…" });

    // Row key: use keyFields if provided, otherwise stringify the whole row
    const rowKey = (r: DatasetRow): string => {
      if (keyFields.length > 0) {
        return keyFields.map((f) => String(r[f] ?? "")).join("|");
      }
      return JSON.stringify(r);
    };

    // Determine which fields to compare
    const allBaseFields = base.length > 0 ? Object.keys(base[0]) : [];
    const allCmpFields = compare.length > 0 ? Object.keys(compare[0]) : [];
    const sharedFields = allBaseFields.filter((f) => allCmpFields.includes(f));
    const fieldsToCompare =
      cmpFields.length > 0
        ? cmpFields.filter((f) => sharedFields.includes(f))
        : sharedFields;

    const baseMap = new Map<string, DatasetRow>();
    for (const r of base) baseMap.set(rowKey(r), r);

    const compareMap = new Map<string, DatasetRow>();
    for (const r of compare) compareMap.set(rowKey(r), r);

    const added: DatasetRow[] = [];
    const removed: DatasetRow[] = [];
    const changed: DatasetRow[] = [];

    for (const [key, cmpRow] of compareMap) {
      if (!baseMap.has(key)) {
        added.push(cmpRow);
      } else {
        const baseRow = baseMap.get(key)!;
        const changedFields = fieldsToCompare.filter(
          (f) => String(cmpRow[f] ?? "") !== String(baseRow[f] ?? ""),
        );
        if (changedFields.length > 0) {
          // Build a side-by-side row for CompareChangedTable
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
        }
      }
    }

    for (const [key, baseRow] of baseMap) {
      if (!compareMap.has(key)) removed.push(baseRow);
    }

    const unchangedCount =
      base.length - removed.length - changed.length;

    post({ kind: "progress", jobId, progress: 60, message: "Writing diff datasets…" });

    // Write 3 datasets to OPFS
    const addedId = createId();
    const removedId = createId();
    const changedId = createId();

    const addedVar = `${variableName}_added`;
    const removedVar = `${variableName}_removed`;
    const changedVar = `${variableName}_changed`;

    const [addedResult, removedResult, changedResult] = await Promise.all([
      writeToOPFS(executionId, addedId, added, chunkSize),
      writeToOPFS(executionId, removedId, removed, chunkSize),
      writeToOPFS(executionId, changedId, changed, chunkSize),
    ]);

    post({ kind: "progress", jobId, progress: 90, message: "Building result…" });

    const addedRef = makeRef(addedId, executionId, addedVar, added.length, addedResult.chunks.length, addedResult.totalBytes);
    const removedRef = makeRef(removedId, executionId, removedVar, removed.length, removedResult.chunks.length, removedResult.totalBytes);
    const changedRef = makeRef(changedId, executionId, changedVar, changed.length, changedResult.chunks.length, changedResult.totalBytes);

    const addedManifest = makeManifest(addedId, executionId, addedVar, added.length, addedResult.totalBytes, addedResult.chunks);
    const removedManifest = makeManifest(removedId, executionId, removedVar, removed.length, removedResult.totalBytes, removedResult.chunks);
    const changedManifest = makeManifest(changedId, executionId, changedVar, changed.length, changedResult.totalBytes, changedResult.chunks);

    const isIdentical = added.length === 0 && removed.length === 0 && changed.length === 0;

    // CompareResult shape — matches ExecutionCompareViewer's CompareResult type
    const compareResult = {
      _compareResult: true as const,
      isIdentical,
      summary: isIdentical
        ? `${base.length} matching rows`
        : `${added.length} added, ${removed.length} removed, ${changed.length} changed`,
      keyField: keyFields.length > 0 ? keyFields.join(", ") : null,
      compareFields: fieldsToCompare,
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length,
      unchangedCount: Math.max(0, unchangedCount),
      changedDiffRowCount: changed.length,
      addedVarName: added.length > 0 ? addedVar : null,
      removedVarName: removed.length > 0 ? removedVar : null,
      changedVarName: changed.length > 0 ? changedVar : null,
    };

    post({
      kind: "result",
      jobId,
      output: {
        compareResult,
        addedRef,
        removedRef,
        changedRef,
        addedManifest,
        removedManifest,
        changedManifest,
      },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};

export {};
