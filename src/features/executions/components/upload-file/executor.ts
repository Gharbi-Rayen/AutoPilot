import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { FileChannel } from "@/inngest/channels/file";

type UploadFileData = {
  fileName?: string;
  variableName?: string;
  maxSizeMB?: number;
  allowedTypes?: string[];
};

export const UploadFileExecutor: NodeExecutor<UploadFileData> = async ({
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

  try {
    const fileData = await step.run("process-uploaded-file", async () => {
      // The file data comes from the workflow context, which should contain
      // file information uploaded via the workflow UI
      const uploadedFile = context["_uploadedFile"] as any;

      if (!uploadedFile) {
        throw new NonRetriableError(
          "No file uploaded. Please select a file in the Upload File node."
        );
      }

      // Validate file size if specified
      if (data.maxSizeMB && uploadedFile.size) {
        const maxBytes = data.maxSizeMB * 1024 * 1024;
        if (uploadedFile.size > maxBytes) {
          throw new NonRetriableError(
            `File size exceeds maximum allowed (${data.maxSizeMB}MB)`
          );
        }
      }

      // Validate file type if specified
      if (
        data.allowedTypes &&
        data.allowedTypes.length > 0 &&
        uploadedFile.mimeType
      ) {
        const isAllowed = data.allowedTypes.some((type) => {
          if (type.endsWith("/*")) {
            // Handle wildcards like image/*
            const prefix = type.replace("/*", "");
            return uploadedFile.mimeType.startsWith(prefix);
          }
          return uploadedFile.mimeType === type;
        });

        if (!isAllowed) {
          throw new NonRetriableError(
            `File type not allowed. Accepted types: ${data.allowedTypes.join(", ")}`
          );
        }
      }

      return {
        name: uploadedFile.name || data.fileName || "uploaded-file",
        mimeType: uploadedFile.mimeType || "application/octet-stream",
        size: uploadedFile.size || 0,
        buffer: uploadedFile.buffer,
        uploadedAt: new Date().toISOString(),
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
      : new NonRetriableError("Failed to process uploaded file");
  }
};
