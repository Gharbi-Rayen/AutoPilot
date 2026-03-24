"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { FileChannel } from "@/inngest/channels/file";
import { inngest } from "@/inngest/client";
import type { UploadFileFormValues } from "./dialog";

export type FileToken = Realtime.Token<typeof FileChannel, ["status"]>;

export async function fetchFileRealTimeToken(): Promise<FileToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: FileChannel(),
    topics: ["status"],
  });
  return token;
}

interface UploadFileActionParams extends UploadFileFormValues {
  file?: File;
}

export async function handleUploadFile(params: UploadFileActionParams) {
  try {
    if (!params.file) {
      return { error: "File is required" };
    }

    const buffer = await params.file.arrayBuffer();

    return {
      success: true,
      fileData: {
        name: params.file.name,
        mimeType: params.file.type,
        size: params.file.size,
        buffer: Buffer.from(buffer),
      },
      variableName: params.variableName,
      maxSizeMB: params.maxSizeMB,
      allowedTypes: params.allowedTypes,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to process file",
    };
  }
}

export async function validateFileUpload(
  file: File,
  maxSizeMB?: number,
  allowedTypes?: string[],
) {
  try {
    // Validate file size
    if (maxSizeMB && maxSizeMB > 0) {
      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      if (file.size > maxSizeBytes) {
        return {
          valid: false,
          error: `File size exceeds ${maxSizeMB}MB limit`,
        };
      }
    }

    // Validate file type
    if (allowedTypes && allowedTypes.length > 0) {
      const isAllowed = allowedTypes.some((type) => {
        if (type.includes("*")) {
          // Handle wildcard MIME types (e.g., image/*)
          const baseType = type.split("/")[0];
          const fileBaseType = file.type.split("/")[0];
          return baseType === fileBaseType;
        }

        // Handle file extensions (e.g., .pdf)
        if (type.startsWith(".")) {
          const extension = `.${file.name.split(".").pop()}`;
          return extension.toLowerCase() === type.toLowerCase();
        }

        // Handle exact MIME type
        return file.type === type;
      });

      if (!isAllowed) {
        return {
          valid: false,
          error: `File type not allowed. Allowed types: ${allowedTypes.join(", ")}`,
        };
      }
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Validation failed",
    };
  }
}
