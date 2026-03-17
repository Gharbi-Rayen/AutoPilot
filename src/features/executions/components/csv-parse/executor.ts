import { NonRetriableError } from "inngest";
import { parse } from "csv-parse/sync";
import type { NodeExecutor } from "@/features/executions/components/types";
import { FileChannel } from "@/inngest/channels/file";

type CsvParseData = {
  csvVariable?: string;
  variableName?: string;
  hasHeader?: boolean;
  delimiter?: string;
};

export const CsvParseExecutor: NodeExecutor<CsvParseData> = async ({
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

  if (!data.csvVariable) {
    await updateStatePublish("error");
    throw new NonRetriableError("Source CSV variable is required");
  }

  const hasHeader = data.hasHeader ?? true;
  const delimiter = data.delimiter || ",";

  try {
    const parsedData = await step.run("parse-csv", async () => {
      const csvObj = context[data.csvVariable as string];

      if (!csvObj) {
        throw new NonRetriableError(
          `CSV variable '${data.csvVariable}' not found in workflow context`
        );
      }

      const csv = csvObj as any;

      if (!csv.buffer && !csv.url && typeof csv !== "string") {
        throw new NonRetriableError(
          "CSV object must have a buffer, URL, or be a string"
        );
      }

      let csvText: string;

      if (typeof csv === "string") {
        csvText = csv;
      } else if (csv.buffer) {
        csvText = Buffer.isBuffer(csv.buffer)
          ? csv.buffer.toString("utf-8")
          : csv.buffer;
      } else if (csv.url) {
        const response = await fetch(csv.url);
        if (!response.ok) {
          throw new NonRetriableError(
            `Failed to fetch CSV from URL: ${response.statusText}`
          );
        }
        csvText = await response.text();
      } else if (csv.content) {
        csvText = csv.content;
      } else {
        throw new NonRetriableError("Cannot parse CSV: no content found");
      }

      const records = parse(csvText, {
        columns: hasHeader,
        delimiter,
        trim: true,
        skip_empty_lines: true,
      });

      return {
        records,
        rowCount: Array.isArray(records) ? records.length : 0,
        fileName: csv.fileName || csv.name || "data.csv",
      };
    });

    await updateStatePublish("success");

    return {
      [data.variableName]: parsedData,
    };
  } catch (error) {
    await updateStatePublish("error");
    throw error instanceof Error
      ? new NonRetriableError(error.message)
      : new NonRetriableError("Failed to parse CSV");
  }
};
