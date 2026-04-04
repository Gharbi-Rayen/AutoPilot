import Handlebars from "handlebars";
import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { FileChannel } from "@/inngest/channels/file";

type DownloadFileData = {
  fileUrl?: string;
  variableName?: string;
  fileName?: string;
};

export const DownloadFileExecutor: NodeExecutor<DownloadFileData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  executionId,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    return await publish(
      FileChannel().status({
        nodeId,
        status: state,
      }),
    );
  };

  await updateStatePublish("loading");

  if (!data.variableName) {
    await updateStatePublish("error");
    throw new NonRetriableError("Variable name is required");
  }

  if (!data.fileUrl) {
    await updateStatePublish("error");
    throw new NonRetriableError("File URL is required");
  }

  if (!executionId) {
    await updateStatePublish("error");
    throw new NonRetriableError("Execution context is missing executionId");
  }

  const fileUrl = Handlebars.compile(data.fileUrl)(context);
  const _fileName = data.fileName || "downloaded-file";
  const variableName = data.variableName;

  try {
    const fileData = await step.run("download-file-and-persist", async () => {
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new NonRetriableError(
          `Failed to download file: ${response.statusText}`,
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const _mimeType =
        response.headers.get("content-type") || "application/octet-stream";

      // Write raw buffer directly to disk to avoid 3GB+ JSON serialization arrays for 500MB buffers
      const { getExecutionDatasetsDirectory, ensureDirectory } = await import(
        "@/features/executions/server/datasets/paths"
      );
      const { join } = await import("node:path");
      const { writeFile } = await import("node:fs/promises");
      const { randomUUID } = await import("node:crypto");

      const fileId = `file-${randomUUID()}`;
      const executionDir = getExecutionDatasetsDirectory(executionId);
      await ensureDirectory(executionDir);

      const fileBlobPath = join(executionDir, `${fileId}.bin`);
      await writeFile(fileBlobPath, buffer);

      return {
        type: "blob",
        fileBlobPath,
      };
    });

    await updateStatePublish("success");

    return {
      [variableName]: fileData,
    };
  } catch (error) {
    await updateStatePublish("error");
    throw error instanceof Error
      ? new NonRetriableError(error.message)
      : new NonRetriableError("Failed to download file");
  }
};
