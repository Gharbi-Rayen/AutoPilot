import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { FileChannel } from "@/inngest/channels/file";

type PdfExtractTextData = {
  pdfVariable?: string;
  variableName?: string;
  includeMetadata?: boolean;
};

type PdfParseModule = {
  PDFParse: new (options: {
    data: Buffer;
    CanvasFactory?: unknown;
  }) => {
    getText: () => Promise<{
      text: string;
      total?: number;
      pages?: Array<unknown>;
    }>;
    getInfo: () => Promise<{
      total?: number;
      info?: Record<string, unknown>;
    }>;
    destroy: () => Promise<void>;
  };
};

type PdfWorkerModule = {
  CanvasFactory?: unknown;
};

type PdfInputPayload = {
  buffer?: unknown;
  url?: unknown;
  name?: unknown;
  fileName?: unknown;
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

  if (typeof value === "string") {
    return Buffer.from(value, "utf-8");
  }

  return null;
};

const toPdfInputPayload = (value: unknown): PdfInputPayload | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as PdfInputPayload;
};

export const PdfExtractTextExecutor: NodeExecutor<PdfExtractTextData> = async ({
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

  if (!data.pdfVariable) {
    await updateStatePublish("error");
    throw new NonRetriableError("Source PDF variable is required");
  }

  try {
    const extractedData = await step.run("extract-pdf-text", async () => {
      const pdfObj = context[data.pdfVariable as string];

      if (!pdfObj) {
        throw new NonRetriableError(
          `PDF variable '${data.pdfVariable}' not found in workflow context`,
        );
      }

      const pdf = toPdfInputPayload(pdfObj);
      if (!pdf) {
        throw new NonRetriableError("PDF input payload is invalid");
      }

      if (!pdf.buffer && !pdf.url) {
        throw new NonRetriableError("PDF object must have a buffer or URL");
      }

      let buffer: Buffer;

      if (pdf.buffer) {
        const normalizedBuffer = toBuffer(pdf.buffer);
        if (!normalizedBuffer) {
          throw new NonRetriableError("Unsupported PDF buffer format");
        }
        buffer = normalizedBuffer;
      } else if (typeof pdf.url === "string" && pdf.url.length > 0) {
        const response = await fetch(pdf.url);
        if (!response.ok) {
          throw new NonRetriableError(
            `Failed to fetch PDF from URL: ${response.statusText}`,
          );
        }
        buffer = Buffer.from(await response.arrayBuffer());
      } else {
        throw new NonRetriableError("Cannot extract text: no buffer or URL");
      }

      const { CanvasFactory } = (await import(
        "pdf-parse/worker"
      )) as PdfWorkerModule;
      const { PDFParse } = (await import("pdf-parse")) as PdfParseModule;

      const parser = new PDFParse({
        data: buffer,
        CanvasFactory,
      });

      try {
        const [textResult, infoResult] = await Promise.all([
          parser.getText(),
          data.includeMetadata ? parser.getInfo() : Promise.resolve(undefined),
        ]);

        const result: Record<string, unknown> = {
          text: textResult.text,
          pages: textResult.total ?? textResult.pages?.length,
          fileName:
            (typeof pdf.fileName === "string" && pdf.fileName.length > 0
              ? pdf.fileName
              : undefined) ||
            (typeof pdf.name === "string" && pdf.name.length > 0
              ? pdf.name
              : undefined) ||
            "document.pdf",
        };

        if (data.includeMetadata && infoResult) {
          result.metadata = infoResult.info;
          result.info = infoResult.info;
        }

        return result;
      } finally {
        await parser.destroy();
      }
    });

    await updateStatePublish("success");

    return {
      [data.variableName]: extractedData,
    };
  } catch (error) {
    await updateStatePublish("error");
    throw error instanceof Error
      ? new NonRetriableError(error.message)
      : new NonRetriableError("Failed to extract PDF text");
  }
};
