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

  const fileUrl = Handlebars.compile(data.fileUrl)(context);
  const fileName = data.fileName || "downloaded-file";

  try {
    const fileData = await step.run("download-file", async () => {
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new NonRetriableError(
          `Failed to download file: ${response.statusText}`,
        );
      }

      const buffer = await response.arrayBuffer();
      const mimeType =
        response.headers.get("content-type") || "application/octet-stream";

      return {
        name: fileName,
        mimeType,
        size: buffer.byteLength,
        url: fileUrl,
        buffer: Buffer.from(buffer),
      };
    });

    await updateStatePublish("success");

    return {
      [data.variableName]: fileData,
    };
  } catch (error) {
    await updateStatePublish("error");
    throw error instanceof Error
      ? new NonRetriableError(error.message)
      : new NonRetriableError("Failed to download file");
  }
};
