/**
 * CSV Sort — Browser Web Worker (two-pass, streaming output)
 *
 * Pass 1: read OPFS chunks one at a time, extract sort-key strings +
 *         (chunkIdx, rowIdx) into a lightweight index.
 *         Sort-key strings are interned into a pool so low-cardinality fields
 *         (dates, categories) cost O(distinct) not O(rows).
 * Pass 2: sort the index, then read chunks in sorted output order and stream
 *         the result rows to a new OPFS dataset via ChunkedOPFSWriter.
 *
 * Memory: index (~20–60 bytes/row typical) + one cached chunk at a time.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS } from "./_opfs-helpers";

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { inputRef, sortColumns, executionId, variableName, chunkSize = 10_000 } = input as {
    inputRef: DatasetRef;
    sortColumns: { field: string; direction: "asc" | "desc" }[];
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    post({ kind: "progress", jobId, progress: 5, message: "Building sort index..." });

    const capacity = inputRef.rowCount;
    const taChunkIdxs = new Int32Array(capacity);
    const taRowIdxs   = new Int32Array(capacity);

    // Per sort-column interned string pools (low-cardinality fields share strings)
    const colCount = sortColumns.length;
    const stringPools: string[][] = Array.from({ length: colCount }, () => []);
    const stringMaps: Map<string, number>[] = Array.from({ length: colCount }, () => new Map());
    // One Int32Array per sort column storing interned string IDs
    const taKeyIds: Int32Array[] = Array.from({ length: colCount }, () => new Int32Array(capacity));

    let indexLen = 0;

    for (let c = 0; c < inputRef.chunkCount; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      for (let r = 0; r < chunk.length; r++) {
        taChunkIdxs[indexLen] = c;
        taRowIdxs[indexLen]   = r;
        for (let k = 0; k < colCount; k++) {
          const str = String(chunk[r][sortColumns[k].field] ?? "");
          let id = stringMaps[k].get(str);
          if (id === undefined) {
            id = stringPools[k].length;
            stringMaps[k].set(str, id);
            stringPools[k].push(str);
          }
          taKeyIds[k][indexLen] = id;
        }
        indexLen++;
      }
      const pct = Math.round(5 + ((c + 1) / inputRef.chunkCount) * 45);
      post({ kind: "progress", jobId, progress: pct, message: `Indexed ${indexLen.toLocaleString()} rows...` });
    }

    post({ kind: "progress", jobId, progress: 52, message: "Sorting..." });

    const order = new Int32Array(indexLen);
    for (let i = 0; i < indexLen; i++) order[i] = i;

    order.sort((a, b) => {
      for (let k = 0; k < colCount; k++) {
        const pool = stringPools[k];
        const sa = pool[taKeyIds[k][a]];
        const sb = pool[taKeyIds[k][b]];
        if (sa === sb) continue;
        const cmp = sa < sb ? -1 : 1;
        return sortColumns[k].direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });

    post({ kind: "progress", jobId, progress: 58, message: "Writing sorted rows..." });

    const datasetId = createId();
    const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
    await writer.init();

    let cachedChunkIdx = -1;
    let cachedChunk: Awaited<ReturnType<typeof readChunkFromOPFS>> = [];
    const outputBatch: (typeof cachedChunk)[number][] = [];

    for (let i = 0; i < indexLen; i++) {
      const idx = order[i];
      const ci = taChunkIdxs[idx];
      const ri = taRowIdxs[idx];
      if (ci !== cachedChunkIdx) {
        cachedChunkIdx = ci;
        cachedChunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, ci);
      }
      outputBatch.push(cachedChunk[ri]);
      if (outputBatch.length >= chunkSize) {
        await writer.write(outputBatch.splice(0));
        const pct = Math.round(58 + (i / indexLen) * 32);
        post({ kind: "progress", jobId, progress: pct, message: `Written ${i.toLocaleString()} / ${indexLen.toLocaleString()} rows...` });
      }
    }
    if (outputBatch.length > 0) await writer.write(outputBatch);

    const { chunks, totalBytes, totalRows } = await writer.finish();

    const now = new Date().toISOString();
    const manifest = {
      version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName,
      createdAt: now, updatedAt: now, rowCount: totalRows, chunkCount: chunks.length,
      byteSize: totalBytes, schema: inputRef.schema, chunks,
    };
    const datasetRef: DatasetRef = {
      kind: "dataset", datasetId, executionId, variableName,
      rowCount: totalRows, chunkCount: chunks.length, byteSize: totalBytes, schema: inputRef.schema,
    };

    post({ kind: "result", jobId, output: { manifest, datasetRef } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
