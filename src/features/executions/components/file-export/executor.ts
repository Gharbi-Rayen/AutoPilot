/**
 * File Export — Client Executor
 * Downloads a dataset (DatasetRef) to the user's disk via showSaveFilePicker.
 */

import type { NodeExecutor } from "@/lib/execution-engine";
import { isDatasetRef } from "@/types/dataset";
import { readDataset } from "@/lib/opfs";
import { db } from "@/lib/db";

export const executor: NodeExecutor = async (_nodeId, nodeData, context, _executionId, onProgress) => {
  const { inputVariable, format = "csv", fileName = "export" } = nodeData as {
    inputVariable?: string;
    format?: "csv" | "json";
    fileName?: string;
  };

  const datasetRef = inputVariable
    ? context[inputVariable]
    : Object.values(context).find((v) => isDatasetRef(v));

  if (!isDatasetRef(datasetRef)) throw new Error("File Export: no dataset found in context.");

  onProgress(10, "Reading dataset...");

  const datasetRecord = await db.datasets.get(datasetRef.datasetId);
  if (!datasetRecord) throw new Error("File Export: dataset manifest not found in IndexedDB.");

  const rows = await readDataset(datasetRef.executionId, datasetRef.datasetId, datasetRecord.manifest);

  onProgress(60, `Preparing ${format.toUpperCase()} export...`);

  let content: string;
  let mimeType: string;
  let ext: string;

  if (format === "csv") {
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const csvLines = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((h) => {
            const v = row[h];
            if (v === null || v === undefined) return "";
            const str = String(v);
            return str.includes(",") || str.includes('"') || str.includes("\n")
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          })
          .join(","),
      ),
    ];
    content = csvLines.join("\n");
    mimeType = "text/csv";
    ext = "csv";
  } else {
    content = JSON.stringify(rows, null, 2);
    mimeType = "application/json";
    ext = "json";
  }

  onProgress(80, "Opening save dialog...");

  const blob = new Blob([content], { type: mimeType });

  // Use File System Access API if available, otherwise fall back to anchor download
  if ("showSaveFilePicker" in window) {
    try {
      type SaveFilePickerWindow = Window & {
        showSaveFilePicker: (opts: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
      };
      const handle = await (window as SaveFilePickerWindow).showSaveFilePicker({
        suggestedName: `${fileName}.${ext}`,
        types: [
          {
            description: format === "csv" ? "CSV file" : "JSON file",
            accept: { [mimeType]: [`.${ext}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (err) {
      // User cancelled — not an error
      if ((err as Error).name !== "AbortError") throw err;
    }
  } else {
    // Fallback: trigger browser download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  onProgress(100, "Export complete");
  return { exportedFileName: `${fileName}.${ext}`, rowCount: rows.length };
};
