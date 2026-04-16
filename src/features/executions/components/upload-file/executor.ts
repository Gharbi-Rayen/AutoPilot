/**
 * Upload File — Client Executor
 *
 * Reads a file previously stored in OPFS by the node's dialog (via File System Access API).
 * Node data shape: { fileId: string; fileName: string; variableName: string }
 */

import type { NodeExecutor } from "@/lib/execution-engine";

export const executor: NodeExecutor = async (
  _nodeId,
  nodeData,
  _context,
  _executionId,
  onProgress,
) => {
  const { fileId, fileName, variableName = "uploadedFile" } = nodeData as {
    fileId?: string;
    fileName?: string;
    variableName?: string;
  };

  if (!fileId) throw new Error("Upload File: no fileId configured. Select a file in the node.");
  if (!fileName) throw new Error("Upload File: no fileName found.");

  onProgress(10, "Reading file from storage...");

  // File was stored in OPFS at autopilot/uploads/<fileId>
  const opfsRoot = await navigator.storage.getDirectory();
  const uploadsDir = await opfsRoot
    .getDirectoryHandle("autopilot", { create: true })
    .then((a) => a.getDirectoryHandle("uploads", { create: true }));

  const fh = await uploadsDir.getFileHandle(fileId);
  const file = await fh.getFile();
  const buffer = await file.arrayBuffer();

  onProgress(80, `Loaded ${fileName} (${(buffer.byteLength / 1024).toFixed(1)} KB)`);

  // Store in execution context as raw buffer + metadata
  // The next node (e.g. csv-parse) will consume this
  const mimeType = file.type || "application/octet-stream";
  onProgress(100, "File ready");

  return {
    [variableName]: {
      kind: "file",
      fileId,
      fileName,
      mimeType,
      byteSize: buffer.byteLength,
      buffer,
    },
  };
};
