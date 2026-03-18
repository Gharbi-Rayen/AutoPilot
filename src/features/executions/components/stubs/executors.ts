import type { NodeExecutor } from "@/features/executions/components/types";
import { NonRetriableError } from "inngest";
import { FileChannel } from "@/inngest/channels/file";
import { ReadFileExecutor } from "../read-file/executor";
import { PdfExtractTextExecutor } from "../pdf-extract-text/executor";
import { CsvParseExecutor } from "../csv-parse/executor";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const pendingExecutor = (name: string): NodeExecutor => {
  return async ({ data }) => {
    // Keep workflows executable while advanced node logic is being finalized.
    return {
      [`${name}_pending`]: {
        implemented: false,
        node: name,
        data,
      },
    };
  };
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const resolveRecords = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null,
    );
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "records" in value &&
    Array.isArray((value as { records: unknown }).records)
  ) {
    return ((value as { records: unknown[] }).records).filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    );
  }

  return [];
};

const resolveList = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "records" in value &&
    Array.isArray((value as { records: unknown }).records)
  ) {
    return (value as { records: unknown[] }).records;
  }

  return [];
};

type CsvOperator =
  | "eq"
  | "ne"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty";

const applyCsvPredicate = (
  row: Record<string, unknown>,
  field: string,
  operator: CsvOperator,
  expectedValue: unknown,
): boolean => {
  const rawValue = row[field];

  if (operator === "is_empty") {
    return (
      rawValue === undefined ||
      rawValue === null ||
      (typeof rawValue === "string" && rawValue.trim() === "")
    );
  }

  if (operator === "is_not_empty") {
    return !(
      rawValue === undefined ||
      rawValue === null ||
      (typeof rawValue === "string" && rawValue.trim() === "")
    );
  }

  const actual = rawValue ?? "";
  const left = String(actual);
  const right = String(expectedValue ?? "");

  if (operator === "eq") return left === right;
  if (operator === "ne") return left !== right;
  if (operator === "contains") return left.includes(right);
  if (operator === "not_contains") return !left.includes(right);
  if (operator === "starts_with") return left.startsWith(right);
  if (operator === "ends_with") return left.endsWith(right);

  const leftNumber = parseNumber(actual);
  const rightNumber = parseNumber(expectedValue);
  if (leftNumber === null || rightNumber === null) {
    return false;
  }

  if (operator === "gt") return leftNumber > rightNumber;
  if (operator === "gte") return leftNumber >= rightNumber;
  if (operator === "lt") return leftNumber < rightNumber;
  return leftNumber <= rightNumber;
};

const csvEscape = (value: unknown, delimiter: string): string => {
  const text = String(value ?? "");
  const mustQuote =
    text.includes("\n") || text.includes("\r") || text.includes('"') || text.includes(delimiter);

  if (!mustQuote) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
};

const withFileNodeStatus = async <T>(
  nodeId: string,
  publish: Parameters<NodeExecutor>[0]["publish"],
  task: () => Promise<T>,
): Promise<T> => {
  const publishStatus = async (status: "loading" | "error" | "success") =>
    publish(
      FileChannel().status({
        nodeId,
        status,
      }),
    );

  await publishStatus("loading");

  try {
    const result = await task();
    await publishStatus("success");
    return result;
  } catch (error) {
    await publishStatus("error");
    throw error;
  }
};


export { ReadFileExecutor as readFileExecutor };
export { PdfExtractTextExecutor as pdfExtractTextExecutor };
export { CsvParseExecutor as csvParseExecutor };

type WriteFileData = {
  sourceVariable?: string;
  variableName?: string;
  fileName?: string;
  mimeType?: string;
  format?: "auto" | "text" | "json" | "base64";
};

export const writeFileExecutor: NodeExecutor<WriteFileData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    if (!data.variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!data.sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    const source = context[data.sourceVariable];
    if (source === undefined) {
      throw new NonRetriableError(
        `Source variable '${data.sourceVariable}' not found in workflow context`,
      );
    }

    const file = await step.run("write-file", async () => {
      const format = data.format ?? "auto";
      let buffer: Buffer;
      let mimeType = data.mimeType || "application/octet-stream";

      if (Buffer.isBuffer(source)) {
        buffer = source;
      } else if (
        typeof source === "object" &&
        source !== null &&
        "buffer" in source &&
        Buffer.isBuffer((source as { buffer: unknown }).buffer)
      ) {
        const sourceFile = source as unknown as {
          buffer: Buffer;
          mimeType?: unknown;
        };
        buffer = sourceFile.buffer;
        if (typeof sourceFile.mimeType === "string" && !data.mimeType) {
          mimeType = sourceFile.mimeType;
        }
      } else if (format === "base64" && typeof source === "string") {
        buffer = Buffer.from(source, "base64");
      } else if (format === "json" || (format === "auto" && typeof source !== "string")) {
        buffer = Buffer.from(JSON.stringify(source), "utf-8");
        if (!data.mimeType) {
          mimeType = "application/json";
        }
      } else {
        buffer = Buffer.from(String(source), "utf-8");
        if (!data.mimeType) {
          mimeType = "text/plain";
        }
      }

      const fileName = data.fileName || `${data.variableName}.txt`;

      return {
        name: fileName,
        mimeType,
        size: buffer.byteLength,
        buffer,
      };
    });

    return {
      [data.variableName]: file,
    };
  });

export const pdfSplitExecutor: NodeExecutor = pendingExecutor("pdf_split");

export const pdfMergeExecutor: NodeExecutor = pendingExecutor("pdf_merge");

export const pdfFillFormExecutor: NodeExecutor = pendingExecutor("pdf_fill_form");

type PdfGenerateData = {
  variableName?: string;
  contentVariable?: string;
  title?: string;
  fileName?: string;
};

export const pdfGenerateExecutor: NodeExecutor<PdfGenerateData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    if (!data.variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!data.contentVariable) {
      throw new NonRetriableError("Content variable is required");
    }

    const content = context[data.contentVariable];
    if (content === undefined) {
      throw new NonRetriableError(
        `Content variable '${data.contentVariable}' not found in workflow context`,
      );
    }

    const textContent = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    const title = data.title;

    const pdfBuffer = await step.run("generate-pdf", async () => {
      const pdfDoc = await PDFDocument.create();
      let page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontSize = 12;
      const margin = 50;
      const lineHeight = fontSize * 1.5;
      const maxLineWidth = width - margin * 2;
      const titleFontSize = 20;

      let y = height - margin;

      if (title) {
        const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        page.drawText(title, {
          x: margin,
          y: y - titleFontSize,
          size: titleFontSize,
          font: titleFont,
          color: rgb(0, 0, 0),
        });
        y -= titleFontSize * 2;
      }

      const words = textContent.split(/\s+/);
      let line = "";
      
      for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        const textWidth = font.widthOfTextAtSize(testLine, fontSize);
        
        if (textWidth > maxLineWidth) {
          // Draw the current line
          page.drawText(line, {
            x: margin,
            y: y - fontSize,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
          });
          
          y -= lineHeight;
          line = word;

          // Check for page break
          if (y < margin + lineHeight) {
            page = pdfDoc.addPage();
            y = height - margin;
          }
        } else {
          line = testLine;
        }
      }
      
      // Draw remaining text
      if (line) {
        page.drawText(line, {
          x: margin,
          y: y - fontSize,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }

      const pdfBytes = await pdfDoc.save();
      return Buffer.from(pdfBytes);
    });

    return {
      [data.variableName]: {
        name: data.fileName || `${data.variableName}.pdf`,
        mimeType: "application/pdf",
        buffer: pdfBuffer,
        size: pdfBuffer.length,
      },
    };
  });

export const pdfSignExecutor: NodeExecutor = pendingExecutor("pdf_sign");

type ConvertFileData = {
  sourceVariable?: string;
  variableName?: string;
  targetFormat?: "text" | "json" | "base64";
};

export const convertFileExecutor: NodeExecutor<ConvertFileData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    if (!data.variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!data.sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    const source = context[data.sourceVariable];
    if (!source) {
      throw new NonRetriableError(
        `Source variable '${data.sourceVariable}' not found in workflow context`,
      );
    }

    const targetFormat = data.targetFormat ?? "text";

    const converted = await step.run("convert-file", async () => {
      let inputBuffer: Buffer;
      let baseName = "converted-file";

      if (Buffer.isBuffer(source)) {
        inputBuffer = source;
      } else if (
        typeof source === "object" &&
        source !== null &&
        "buffer" in source &&
        Buffer.isBuffer((source as { buffer: unknown }).buffer)
      ) {
        const sourceFile = source as unknown as {
          buffer: Buffer;
          name?: unknown;
        };
        inputBuffer = sourceFile.buffer;
        if (typeof sourceFile.name === "string") {
          baseName = sourceFile.name;
        }
      } else if (typeof source === "string") {
        inputBuffer = Buffer.from(source, "utf-8");
      } else {
        inputBuffer = Buffer.from(JSON.stringify(source), "utf-8");
      }

      if (targetFormat === "base64") {
        return {
          base64: inputBuffer.toString("base64"),
          fileName: `${baseName}.b64.txt`,
          mimeType: "text/plain",
        };
      }

      if (targetFormat === "json") {
        const text = inputBuffer.toString("utf-8");
        const parsed = JSON.parse(text);

        return {
          json: parsed,
          fileName: `${baseName}.json`,
          mimeType: "application/json",
        };
      }

      return {
        text: inputBuffer.toString("utf-8"),
        fileName: `${baseName}.txt`,
        mimeType: "text/plain",
      };
    });

    return {
      [data.variableName]: converted,
    };
  });

export const pdfExtractTablesExecutor: NodeExecutor = pendingExecutor("pdf_extract_tables");

// CSV Processing Nodes
type CsvGenerateData = {
  sourceVariable?: string;
  variableName?: string;
  delimiter?: string;
  includeHeader?: boolean;
};

export const csvGenerateExecutor: NodeExecutor<CsvGenerateData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    if (!data.variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!data.sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    const source = context[data.sourceVariable];
    if (source === undefined) {
      throw new NonRetriableError(
        `Source variable '${data.sourceVariable}' not found in workflow context`,
      );
    }

    const delimiter = data.delimiter || ",";
    const includeHeader = data.includeHeader ?? true;

    const output = await step.run("csv-generate", async () => {
      const rows = resolveRecords(source);
      if (rows.length === 0) {
        throw new NonRetriableError("Source data must be an array of records");
      }

      const headers = Array.from(
        new Set(rows.flatMap((row) => Object.keys(row))),
      );

      const lines: string[] = [];
      if (includeHeader) {
        lines.push(headers.map((h) => csvEscape(h, delimiter)).join(delimiter));
      }

      for (const row of rows) {
        lines.push(
          headers
            .map((header) => csvEscape(row[header], delimiter))
            .join(delimiter),
        );
      }

      const csvText = lines.join("\n");
      const buffer = Buffer.from(csvText, "utf-8");

      return {
        content: csvText,
        rowCount: rows.length,
        headers,
        name: `${data.variableName}.csv`,
        mimeType: "text/csv",
        size: buffer.byteLength,
        buffer,
      };
    });

    return {
      [data.variableName]: output,
    };
  });

type CsvFilterData = {
  sourceVariable?: string;
  variableName?: string;
  field?: string;
  operator?: CsvOperator;
  value?: string;
};

export const csvFilterExecutor: NodeExecutor<CsvFilterData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    if (!data.variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!data.sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    if (!data.field) {
      throw new NonRetriableError("Field is required");
    }

    const source = context[data.sourceVariable];
    const rows = resolveRecords(source);
    if (rows.length === 0) {
      throw new NonRetriableError("Source variable must contain CSV records");
    }

    const operator = data.operator ?? "eq";

    const filtered = await step.run("csv-filter", async () => {
      const result = rows.filter((row) =>
        applyCsvPredicate(row, data.field as string, operator, data.value),
      );

      return {
        records: result,
        rowCount: result.length,
      };
    });

    return {
      [data.variableName]: filtered,
    };
  });

type CsvAggregateData = {
  sourceVariable?: string;
  variableName?: string;
  groupBy?: string;
  operation?: "count" | "sum" | "avg" | "min" | "max";
  targetField?: string;
};

export const csvAggregateExecutor: NodeExecutor<CsvAggregateData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    const variableName = data.variableName?.trim();
    const sourceVariable = data.sourceVariable?.trim();
    const groupBy = data.groupBy?.trim();
    const targetField = data.targetField?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    if (!groupBy) {
      throw new NonRetriableError("Group by field is required");
    }

    if (!Object.hasOwn(context, sourceVariable)) {
      const availableKeys = Object.keys(context).slice(0, 20).join(", ");
      throw new NonRetriableError(
        `Source variable '${sourceVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const source = context[sourceVariable];
    const rows = resolveRecords(source);
    if (rows.length === 0) {
      throw new NonRetriableError(
        `Source variable '${sourceVariable}' must contain CSV records (array or object with records array)`,
      );
    }

    const operation = data.operation ?? "count";

    const aggregated = await step.run("csv-aggregate", async () => {
      const groups = new Map<string, Record<string, unknown>[]>();

      for (const row of rows) {
        const key = String(row[data.groupBy as string] ?? "");
        const list = groups.get(key);
        if (list) {
          list.push(row);
        } else {
          groups.set(key, [row]);
        }
      }

      const records = Array.from(groups.entries()).map(([groupKey, groupRows]) => {
        const base: Record<string, unknown> = {
          [groupBy]: groupKey,
          count: groupRows.length,
        };

        if (operation === "count") {
          base.value = groupRows.length;
          return base;
        }

        if (!targetField) {
          throw new NonRetriableError(
            "targetField is required for sum/avg/min/max operations",
          );
        }

        const numbers = groupRows
          .map((row) => parseNumber(row[targetField]))
          .filter((n): n is number => n !== null);

        if (numbers.length === 0) {
          base.value = null;
          return base;
        }

        if (operation === "sum") {
          base.value = numbers.reduce((acc, n) => acc + n, 0);
          return base;
        }

        if (operation === "avg") {
          const total = numbers.reduce((acc, n) => acc + n, 0);
          base.value = total / numbers.length;
          return base;
        }

        if (operation === "min") {
          base.value = Math.min(...numbers);
          return base;
        }

        base.value = Math.max(...numbers);
        return base;
      });

      return {
        records,
        rowCount: records.length,
      };
    });

    return {
      [variableName]: aggregated,
    };
  });

type CsvJoinData = {
  leftVariable?: string;
  rightVariable?: string;
  leftKey?: string;
  rightKey?: string;
  variableName?: string;
  joinType?: "inner" | "left";
};

export const csvJoinExecutor: NodeExecutor<CsvJoinData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    const variableName = data.variableName?.trim();
    const leftVariable = data.leftVariable?.trim();
    const rightVariable = data.rightVariable?.trim();
    const leftKey = data.leftKey?.trim();
    const rightKey = data.rightKey?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!leftVariable || !rightVariable) {
      throw new NonRetriableError("Both left and right source variables are required");
    }

    if (!leftKey || !rightKey) {
      throw new NonRetriableError("Both leftKey and rightKey are required");
    }

    if (!Object.hasOwn(context, leftVariable)) {
      const availableKeys = Object.keys(context).slice(0, 20).join(", ");
      throw new NonRetriableError(
        `Left source variable '${leftVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    if (!Object.hasOwn(context, rightVariable)) {
      const availableKeys = Object.keys(context).slice(0, 20).join(", ");
      throw new NonRetriableError(
        `Right source variable '${rightVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const leftRows = resolveRecords(context[leftVariable]);
    const rightRows = resolveRecords(context[rightVariable]);

    if (leftRows.length === 0 || rightRows.length === 0) {
      throw new NonRetriableError("Both source variables must contain CSV records");
    }

    const joinType = data.joinType ?? "inner";

    const joined = await step.run("csv-join", async () => {
      const rightIndex = new Map<string, Record<string, unknown>[]>();
      for (const row of rightRows) {
        const key = String(row[rightKey] ?? "");
        const entries = rightIndex.get(key);
        if (entries) {
          entries.push(row);
        } else {
          rightIndex.set(key, [row]);
        }
      }

      const records: Record<string, unknown>[] = [];

      for (const leftRow of leftRows) {
        const leftKeyValue = String(leftRow[leftKey] ?? "");
        const matches = rightIndex.get(leftKeyValue) ?? [];

        if (matches.length === 0) {
          if (joinType === "left") {
            records.push({ ...leftRow });
          }
          continue;
        }

        for (const rightRow of matches) {
          records.push({
            ...leftRow,
            ...rightRow,
          });
        }
      }

      return {
        records,
        rowCount: records.length,
      };
    });

    return {
      [variableName]: joined,
    };
  });

// Spreadsheet Nodes
export const readExcelExecutor: NodeExecutor = pendingExecutor("read_excel");

export const writeExcelExecutor: NodeExecutor = pendingExecutor("write_excel");

export const appendRowExecutor: NodeExecutor = pendingExecutor("append_row");

export const sheetTransformExecutor: NodeExecutor = pendingExecutor("sheet_transform");

// PowerPoint Nodes
export const createPresentationExecutor: NodeExecutor = pendingExecutor("create_presentation");

export const addSlideExecutor: NodeExecutor = pendingExecutor("add_slide");

export const fillTemplateExecutor: NodeExecutor = pendingExecutor("fill_template");

// Image Processing Nodes
export const resizeImageExecutor: NodeExecutor = pendingExecutor("resize_image");

export const cropImageExecutor: NodeExecutor = pendingExecutor("crop_image");

export const convertImageExecutor: NodeExecutor = pendingExecutor("convert_image");

export const ocrImageExecutor: NodeExecutor = pendingExecutor("ocr_image");

// Data Transformation Nodes
export const jsonTransformExecutor: NodeExecutor = pendingExecutor("json_transform");

type FilterData = {
  sourceVariable?: string;
  variableName?: string;
  field?: string;
  operator?: CsvOperator;
  value?: string;
};

export const filterExecutor: NodeExecutor<FilterData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    if (!data.variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!data.sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    if (!data.field) {
      throw new NonRetriableError("Field is required");
    }

    const source = context[data.sourceVariable];
    const rows = resolveRecords(source);
    if (rows.length === 0) {
      throw new NonRetriableError("Source variable must contain records");
    }

    const operator = data.operator ?? "eq";

    const filtered = await step.run("filter-data", async () => {
      const records = rows.filter((row) =>
        applyCsvPredicate(row, data.field as string, operator, data.value),
      );

      return {
        records,
        rowCount: records.length,
      };
    });

    return {
      [data.variableName]: filtered,
    };
  });

export const loopExecutor: NodeExecutor = pendingExecutor("loop");

export const conditionExecutor: NodeExecutor = pendingExecutor("condition");

export const delayExecutor: NodeExecutor = pendingExecutor("delay");

type MergeData = {
  leftVariable?: string;
  rightVariable?: string;
  variableName?: string;
  strategy?: "concat" | "zip" | "by_key";
  leftKey?: string;
  rightKey?: string;
};

export const mergeExecutor: NodeExecutor<MergeData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    if (!data.variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!data.leftVariable || !data.rightVariable) {
      throw new NonRetriableError("Both left and right source variables are required");
    }

    const leftSource = context[data.leftVariable];
    const rightSource = context[data.rightVariable];

    const strategy = data.strategy ?? "concat";

    const output = await step.run("merge-data", async () => {
      if (strategy === "concat") {
        const left = resolveList(leftSource);
        const right = resolveList(rightSource);

        return {
          records: [...left, ...right],
          rowCount: left.length + right.length,
          strategy,
        };
      }

      if (strategy === "zip") {
        const left = resolveList(leftSource);
        const right = resolveList(rightSource);
        const length = Math.min(left.length, right.length);

        const records = Array.from({ length }, (_, index) => ({
          left: left[index],
          right: right[index],
        }));

        return {
          records,
          rowCount: records.length,
          strategy,
        };
      }

      if (!data.leftKey || !data.rightKey) {
        throw new NonRetriableError(
          "leftKey and rightKey are required when strategy is by_key",
        );
      }

      const leftRecords = resolveRecords(leftSource);
      const rightRecords = resolveRecords(rightSource);

      if (leftRecords.length === 0 || rightRecords.length === 0) {
        throw new NonRetriableError(
          "Both source variables must contain records when strategy is by_key",
        );
      }

      const rightIndex = new Map<string, Record<string, unknown>[]>();
      for (const row of rightRecords) {
        const key = String(row[data.rightKey] ?? "");
        const list = rightIndex.get(key);
        if (list) {
          list.push(row);
        } else {
          rightIndex.set(key, [row]);
        }
      }

      const records: Record<string, unknown>[] = [];

      for (const leftRow of leftRecords) {
        const leftKeyValue = String(leftRow[data.leftKey] ?? "");
        const matches = rightIndex.get(leftKeyValue) ?? [];
        for (const rightRow of matches) {
          records.push({
            ...leftRow,
            ...rightRow,
          });
        }
      }

      return {
        records,
        rowCount: records.length,
        strategy,
      };
    });

    return {
      [data.variableName]: output,
    };
  });

type SplitData = {
  sourceVariable?: string;
  variablePrefix?: string;
  chunkSize?: number;
};

export const splitExecutor: NodeExecutor<SplitData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    if (!data.sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    const variablePrefix = data.variablePrefix || "split";
    const chunkSize = data.chunkSize ?? 100;

    if (!Number.isFinite(chunkSize) || chunkSize < 1) {
      throw new NonRetriableError("chunkSize must be a number greater than 0");
    }

    const source = context[data.sourceVariable];
    const list = resolveList(source);
    if (list.length === 0) {
      throw new NonRetriableError("Source variable must contain an array or records list");
    }

    const output = await step.run("split-data", async () => {
      const chunks: unknown[][] = [];

      for (let i = 0; i < list.length; i += chunkSize) {
        chunks.push(list.slice(i, i + chunkSize));
      }

      const result: Record<string, unknown> = {
        [`${variablePrefix}_meta`]: {
          sourceCount: list.length,
          chunkSize,
          chunkCount: chunks.length,
        },
      };

      chunks.forEach((chunk, index) => {
        result[`${variablePrefix}_${index + 1}`] = chunk;
      });

      return result;
    });

    return output;
  });

// Storage Nodes
export const s3UploadExecutor: NodeExecutor = pendingExecutor("s3_upload");

export const s3DownloadExecutor: NodeExecutor = pendingExecutor("s3_download");

export const googleDriveExecutor: NodeExecutor = pendingExecutor("google_drive");

export const dropboxExecutor: NodeExecutor = pendingExecutor("dropbox");

export const localStorageExecutor: NodeExecutor = pendingExecutor("local_storage");
