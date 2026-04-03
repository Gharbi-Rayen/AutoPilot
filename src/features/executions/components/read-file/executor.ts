import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { FileChannel } from "@/inngest/channels/file";

type ReadFileData = {
  fileVariable?: string;
  variableName?: string;
  encoding?: string;
};

type ReadableFilePayload = {
  buffer?: unknown;
  url?: unknown;
  name?: unknown;
  mimeType?: unknown;
  size?: unknown;
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

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  return null;
};

const toReadableFilePayload = (value: unknown): ReadableFilePayload | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as ReadableFilePayload;
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
          `File variable '${data.fileVariable}' not found in workflow context`,
        );
      }

      const file = toReadableFilePayload(fileObj);
      if (!file) {
        throw new NonRetriableError("File input payload is invalid");
      }

      if (!file.buffer && !file.url) {
        throw new NonRetriableError("File object must have a buffer or URL");
      }

      let content: string;

      if (file.buffer !== undefined) {
        if (typeof file.buffer === "string") {
          content = file.buffer;
        } else {
          const normalizedBuffer = toBuffer(file.buffer);
          if (!normalizedBuffer) {
            throw new NonRetriableError("Unsupported file buffer format");
          }

          content = normalizedBuffer.toString(encoding as BufferEncoding);
        }
      } else if (typeof file.url === "string" && file.url.length > 0) {
        const response = await fetch(file.url);
        if (!response.ok) {
          throw new NonRetriableError(
            `Failed to fetch file from URL: ${response.statusText}`,
          );
        }
        content = await response.text();
      } else {
        throw new NonRetriableError("Cannot read file: no buffer or URL");
      }

      return {
        content,
        fileName: typeof file.name === "string" ? file.name : undefined,
        mimeType: typeof file.mimeType === "string" ? file.mimeType : undefined,
        size:
          typeof file.size === "number" && Number.isFinite(file.size)
            ? file.size
            : undefined,
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
