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
          `PDF variable '${data.pdfVariable}' not found in workflow context`
        );
      }

      const pdf = pdfObj as any;

      if (!pdf.buffer && !pdf.url) {
        throw new NonRetriableError(
          "PDF object must have a buffer or URL"
        );
      }

      let buffer: Buffer;

      if (pdf.buffer) {
        buffer = Buffer.isBuffer(pdf.buffer)
          ? pdf.buffer
          : Buffer.from(pdf.buffer);
      } else if (pdf.url) {
        const response = await fetch(pdf.url);
        if (!response.ok) {
          throw new NonRetriableError(
            `Failed to fetch PDF from URL: ${response.statusText}`
          );
        }
        buffer = Buffer.from(await response.arrayBuffer());
      } else {
        throw new NonRetriableError("Cannot extract text: no buffer or URL");
      }

      const { CanvasFactory } = (await import("pdf-parse/worker")) as PdfWorkerModule;
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
          fileName: pdf.name || "document.pdf",
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
