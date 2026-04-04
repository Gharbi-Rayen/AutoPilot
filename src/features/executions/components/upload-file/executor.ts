import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { loadWorkflowFileAsset } from "@/features/executions/server/workflow-file-assets";
import { FileChannel } from "@/inngest/channels/file";

type UploadFileData = {
  fileName?: string;
  variableName?: string;
  maxSizeMB?: number;
  allowedTypes?: string[] | string;
  file?: {
    name: string;
    mimeType: string;
    size: number;
    fileRef?: string;
    contentBase64?: string;
    lastModified?: number;
  };
};

type UploadedFilePayload = {
  name?: unknown;
  mimeType?: unknown;
  size?: unknown;
  buffer?: unknown;
};

const toUploadedFilePayload = (value: unknown): UploadedFilePayload | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as UploadedFilePayload;
};

const toBuffer = (value: unknown): Buffer | null => {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data);
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return Buffer.from(value as number[]);
  }

  if (typeof value === "string") {
    return Buffer.from(value, "utf-8");
  }

  return null;
};

export const UploadFileExecutor: NodeExecutor<UploadFileData> = async ({
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

  if (!executionId) {
    await updateStatePublish("error");
    throw new NonRetriableError(
      "Execution context is missing executionId for file upload",
    );
  }

  const variableName = data.variableName;

  try {
    const persistedData = await step.run(
      "process-and-persist-uploaded-file",
      async () => {
        // The file data comes from the workflow context, which should contain
        // file information uploaded via the workflow UI
        const hasPersistedFileRef =
          !!data.file &&
          typeof data.file.fileRef === "string" &&
          data.file.fileRef.length > 0;

        const hasPersistedBase64 =
          !!data.file &&
          typeof data.file.contentBase64 === "string" &&
          data.file.contentBase64.length > 0;

        const uploadedFile =
          hasPersistedFileRef && data.file
            ? (() => {
                return loadWorkflowFileAsset(data.file.fileRef as string).then(
                  (storedFile) => ({
                    name: storedFile.name,
                    mimeType: storedFile.mimeType,
                    size: storedFile.size,
                    buffer: storedFile.buffer,
                  }),
                );
              })()
            : hasPersistedBase64 && data.file
              ? {
                  name: data.file.name,
                  mimeType: data.file.mimeType,
                  size: data.file.size,
                  buffer: Buffer.from(
                    data.file.contentBase64 as string,
                    "base64",
                  ),
                }
              : toUploadedFilePayload(context._uploadedFile);

        const resolvedUploadedFile = await uploadedFile;

        if (data.file && !hasPersistedFileRef && !hasPersistedBase64) {
          throw new NonRetriableError(
            "Upload File node has invalid saved file data. Re-open node settings, select the file again, save workflow, then execute.",
          );
        }

        const allowedTypes = Array.isArray(data.allowedTypes)
          ? data.allowedTypes
          : data.allowedTypes
            ? data.allowedTypes
                .split(",")
                .map((type) => type.trim())
                .filter(Boolean)
            : [];

        if (!resolvedUploadedFile) {
          throw new NonRetriableError(
            "No file uploaded. Please select a file in the Upload File node.",
          );
        }

        const fileBuffer = toBuffer(resolvedUploadedFile.buffer);
        if (!fileBuffer) {
          throw new NonRetriableError(
            "Uploaded file payload is missing binary content.",
          );
        }

        const uploadedFileSize =
          typeof resolvedUploadedFile.size === "number" &&
          Number.isFinite(resolvedUploadedFile.size)
            ? resolvedUploadedFile.size
            : undefined;

        // Validate file size if specified
        if (data.maxSizeMB && uploadedFileSize !== undefined) {
          const maxBytes = data.maxSizeMB * 1024 * 1024;
          if (uploadedFileSize > maxBytes) {
            throw new NonRetriableError(
              `File size exceeds maximum allowed (${data.maxSizeMB}MB)`,
            );
          }
        }

        // Validate file type if specified
        if (allowedTypes.length > 0 && resolvedUploadedFile.mimeType) {
          const fileName = String(
            resolvedUploadedFile.name || "",
          ).toLowerCase();
          const mimeType = String(
            resolvedUploadedFile.mimeType || "",
          ).toLowerCase();

          const isAllowed = allowedTypes.some((rawType) => {
            const type = rawType.toLowerCase();

            if (type.startsWith(".")) {
              return fileName.endsWith(type);
            }

            if (type.endsWith("/*")) {
              // Handle wildcards like image/*
              const prefix = type.replace("/*", "");
              return mimeType.startsWith(prefix);
            }

            return mimeType === type;
          });

          if (!isAllowed) {
            throw new NonRetriableError(
              `File type not allowed. Accepted types: ${allowedTypes.join(", ")}`,
            );
          }
        }

        const name =
          (typeof resolvedUploadedFile.name === "string" &&
          resolvedUploadedFile.name.length > 0
            ? resolvedUploadedFile.name
            : data.fileName) || "uploaded-file";
        const mimeType =
          typeof resolvedUploadedFile.mimeType === "string" &&
          resolvedUploadedFile.mimeType.length > 0
            ? resolvedUploadedFile.mimeType
            : "application/octet-stream";
        const size = uploadedFileSize ?? 0;
        const uploadedAt = new Date().toISOString();

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
        await writeFile(fileBlobPath, fileBuffer);

        return {
          type: "blob",
          fileBlobPath,
          name,
          mimeType,
          size,
          uploadedAt,
        };
      },
    );

    await updateStatePublish("success");

    return {
      [variableName]: persistedData,
    };
  } catch (error) {
    await updateStatePublish("error");
    throw error instanceof Error
      ? new NonRetriableError(error.message)
      : new NonRetriableError("Failed to process uploaded file");
  }
};
