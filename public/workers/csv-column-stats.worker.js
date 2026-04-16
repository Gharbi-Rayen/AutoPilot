// src/workers/_opfs-helpers.ts
async function readFromOPFS(executionId, datasetId, chunkCount) {
  const opfsRoot = await navigator.storage.getDirectory();
  const dir = await opfsRoot.getDirectoryHandle("autopilot", { create: false }).then((a) => a.getDirectoryHandle("executions", { create: false })).then((e) => e.getDirectoryHandle(executionId, { create: false })).then((ex) => ex.getDirectoryHandle(datasetId, { create: false }));
  const rows = [];
  for (let i = 0; i < chunkCount; i++) {
    const fh = await dir.getFileHandle(
      `chunk-${String(i).padStart(6, "0")}.json`
    );
    rows.push(...JSON.parse(await (await fh.getFile()).text()));
  }
  return rows;
}

// src/workers/csv-column-stats.worker.ts
self.onmessage = async (event) => {
  const { jobId, input } = event.data;
  const { inputRef } = input;
  const post = (msg) => self.postMessage(msg);
  try {
    post({ kind: "progress", jobId, progress: 10, message: "Reading..." });
    const rows = await readFromOPFS(inputRef.executionId, inputRef.datasetId, inputRef.chunkCount);
    post({ kind: "progress", jobId, progress: 50, message: "Computing stats..." });
    if (rows.length === 0) {
      post({ kind: "result", jobId, output: { stats: [] } });
      return;
    }
    const fields = Object.keys(rows[0]);
    const stats = fields.map((field) => {
      const vals = rows.map((r) => r[field]);
      const nonNull = vals.filter((v) => v !== null && v !== void 0 && v !== "");
      const nums = nonNull.map(Number).filter((n) => !Number.isNaN(n));
      const unique = new Set(vals.map(String));
      const schemaType = inputRef.schema?.[field]?.type ?? "string";
      const stat = {
        field,
        type: schemaType,
        count: vals.length,
        nullCount: vals.length - nonNull.length,
        uniqueCount: unique.size,
        sampleValues: [...new Set(nonNull.slice(0, 5).map(String))]
      };
      if (nums.length > 0) {
        stat.min = Math.min(...nums);
        stat.max = Math.max(...nums);
        stat.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      } else if (nonNull.length > 0) {
        const sorted = nonNull.map(String).sort();
        stat.min = sorted[0];
        stat.max = sorted[sorted.length - 1];
      }
      return stat;
    });
    post({ kind: "result", jobId, output: { stats, rowCount: rows.length } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
