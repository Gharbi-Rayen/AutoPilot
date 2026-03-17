import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { FileChannel } from "@/inngest/channels/file";

type ReadFileData = {
  fileVariable?: string;
  variableName?: string;
  encoding?: string;
};

export const ReadFileExecutor: NodeExecutor<ReadFileData> = async ({
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

  if (!data.fileVariable) {
    await updateStatePublish("error");
    throw new NonRetriableError("Source file variable is required");
  }

  const encoding = data.encoding || "utf-8";

  try {
    const fileData = await step.run("read-file", async () => {
      const fileObj = context[data.fileVariable as string];
      
      if (!fileObj) {
        throw new NonRetriableError(
          `File variable '${data.fileVariable}' not found in workflow context`
        );
      }

      const file = fileObj as any;
      
      if (!file.buffer && !file.url) {
        throw new NonRetriableError(
          "File object must have a buffer or URL"
        );
      }

      let content: string;
      
      if (file.buffer) {
        content = Buffer.isBuffer(file.buffer)
          ? file.buffer.toString(encoding as BufferEncoding)
          : file.buffer;
      } else if (file.url) {
        const response = await fetch(file.url);
        if (!response.ok) {
          throw new NonRetriableError(
            `Failed to fetch file from URL: ${response.statusText}`
          );
        }
        content = await response.text();
      } else {
        throw new NonRetriableError("Cannot read file: no buffer or URL");
      }

      return {
        content,
        fileName: file.name,
        mimeType: file.mimeType,
        size: file.size,
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
      : new NonRetriableError("Failed to read file");
  }
};
