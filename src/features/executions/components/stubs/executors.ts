import { NonRetriableError } from "inngest";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  rgb,
  StandardFonts,
} from "pdf-lib";
import { EXECUTION_LIMITS } from "@/config/constants";
import type { NodeExecutor } from "@/features/executions/components/types";
import {
  resolveContextList,
  resolveContextRecords,
  resolveContextSchema,
} from "@/features/executions/server/datasets/context-resolver";
import {
  mapBatches,
  reduceBatches,
} from "@/features/executions/server/datasets/pipeline";
import {
  applySchemaToRows,
  inferDatasetSchema,
} from "@/features/executions/server/datasets/schema-inference";
import type { DatasetSchema } from "@/features/executions/server/datasets/schema-types";
import { loadWorkflowFileAsset } from "@/features/executions/server/workflow-file-assets";
import { FileChannel } from "@/inngest/channels/file";
import { CsvParseExecutor } from "../csv-parse/executor";
import { PdfExtractTextExecutor } from "../pdf-extract-text/executor";
import { ReadFileExecutor } from "../read-file/executor";

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

const normalizeVariableReference = (reference: string): string => {
  const trimmed = reference.trim();
  if (!trimmed) {
    return "";
  }

  const unwrapped = /^\{\{\s*(.+?)\s*\}\}$/.exec(trimmed)?.[1] ?? trimmed;

  return unwrapped
    .replace(/^context\./, "")
    .replace(/^\$\./, "")
    .trim();
};

const resolveContextValue = (
  context: Record<string, unknown>,
  reference: string | undefined,
): unknown => {
  if (!reference) {
    return undefined;
  }

  const normalized = normalizeVariableReference(reference);
  if (!normalized) {
    return undefined;
  }

  if (Object.hasOwn(context, normalized)) {
    return context[normalized];
  }

  const segments = normalized
    .split(".")
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return undefined;
  }

  let current: unknown = context;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    if (!Object.hasOwn(current as Record<string, unknown>, segment)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
};

const availableContextKeys = (context: Record<string, unknown>): string =>
  Object.keys(context).slice(0, 20).join(", ");

const resolveRecords = async (
  value: unknown,
): Promise<Array<Record<string, unknown>>> => {
  const records = await resolveContextRecords(value);

  if (records.length > EXECUTION_LIMITS.MAX_IN_MEMORY_ROWS) {
    throw new NonRetriableError(
      `Dataset exceeds MAX_IN_MEMORY_ROWS (${EXECUTION_LIMITS.MAX_IN_MEMORY_ROWS}). Use streaming-compatible nodes for this workload.`,
    );
  }

  return records;
};

const resolveList = (value: unknown): Promise<unknown[]> =>
  resolveContextList(value);

const resolveSchema = (value: unknown): DatasetSchema | undefined =>
  resolveContextSchema(value);

const buildSchemaAwareRecordsOutput = (
  rows: Array<Record<string, unknown>>,
  sourceSchema?: DatasetSchema,
) => {
  const schema = sourceSchema ?? inferDatasetSchema(rows);
  const typedRows = applySchemaToRows(rows, schema);

  return {
    records: typedRows,
    rowCount: typedRows.length,
    schema,
  };
};

const EXECUTION_CHUNK_SIZE = EXECUTION_LIMITS.DEFAULT_BATCH_SIZE;

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

  return null;
};

type ResolvedFilePayload = {
  buffer: Buffer;
  name: string;
  mimeType: string;
};

const resolveFilePayload = async (
  source: unknown,
  fallbackName: string,
): Promise<ResolvedFilePayload> => {
  if (Buffer.isBuffer(source)) {
    return {
      buffer: source,
      name: fallbackName,
      mimeType: "application/octet-stream",
    };
  }

  if (typeof source === "object" && source !== null) {
    const sourceObj = source as {
      buffer?: unknown;
      url?: unknown;
      fileRef?: unknown;
      contentBase64?: unknown;
      fileName?: unknown;
      name?: unknown;
      mimeType?: unknown;
    };

    const name =
      (typeof sourceObj.fileName === "string" && sourceObj.fileName.length > 0
        ? sourceObj.fileName
        : undefined) ||
      (typeof sourceObj.name === "string" && sourceObj.name.length > 0
        ? sourceObj.name
        : undefined) ||
      fallbackName;

    const mimeType =
      (typeof sourceObj.mimeType === "string" && sourceObj.mimeType.length > 0
        ? sourceObj.mimeType
        : undefined) || "application/octet-stream";

    const directBuffer = toBuffer(sourceObj.buffer);
    if (directBuffer) {
      return {
        buffer: directBuffer,
        name,
        mimeType,
      };
    }

    if (typeof sourceObj.fileRef === "string" && sourceObj.fileRef.length > 0) {
      const storedFile = await loadWorkflowFileAsset(sourceObj.fileRef);

      return {
        buffer: storedFile.buffer,
        name: storedFile.name || name,
        mimeType: storedFile.mimeType || mimeType,
      };
    }

    if (
      typeof sourceObj.contentBase64 === "string" &&
      sourceObj.contentBase64.length > 0
    ) {
      return {
        buffer: Buffer.from(sourceObj.contentBase64, "base64"),
        name,
        mimeType,
      };
    }

    if (typeof sourceObj.url === "string" && sourceObj.url.length > 0) {
      const response = await fetch(sourceObj.url);
      if (!response.ok) {
        throw new NonRetriableError(
          `Failed to fetch file from URL: ${response.statusText}`,
        );
      }

      const responseBuffer = Buffer.from(await response.arrayBuffer());
      const sourceMimeType =
        typeof sourceObj.mimeType === "string" ? sourceObj.mimeType : undefined;

      return {
        buffer: responseBuffer,
        name,
        mimeType:
          response.headers.get("content-type") || sourceMimeType || mimeType,
      };
    }
  }

  if (typeof source === "string") {
    if (/^https?:\/\//i.test(source)) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new NonRetriableError(
          `Failed to fetch file from URL: ${response.statusText}`,
        );
      }

      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        name: fallbackName,
        mimeType:
          response.headers.get("content-type") || "application/octet-stream",
      };
    }

    return {
      buffer: Buffer.from(source, "utf-8"),
      name: fallbackName,
      mimeType: "text/plain",
    };
  }

  throw new NonRetriableError(
    "Source variable must contain a file-like payload",
  );
};

const collectFieldNames = (rows: Array<Record<string, unknown>>): string[] =>
  Array.from(new Set(rows.flatMap((row) => Object.keys(row))));

const parseCommaList = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return Boolean(value);
};

const parseObjectJson = (
  input: string,
  label: string,
): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(input);
    if (!isPlainObject(parsed)) {
      throw new NonRetriableError(`${label} must resolve to a JSON object`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof NonRetriableError) {
      throw error;
    }

    throw new NonRetriableError(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const resolveFormDataObject = ({
  formData,
  fallbackJson,
}: {
  formData: unknown;
  fallbackJson?: string;
}): Record<string, unknown> => {
  if (isPlainObject(formData)) {
    return formData;
  }

  if (typeof formData === "string" && formData.trim().length > 0) {
    return parseObjectJson(formData, "Form data variable");
  }

  if (fallbackJson && fallbackJson.trim().length > 0) {
    return parseObjectJson(fallbackJson, "Fallback form data JSON");
  }

  return {};
};

const toStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }

  const normalized = String(value ?? "").trim();
  return normalized ? [normalized] : [];
};

const parsePageRanges = (
  ranges: string | undefined,
  totalPages: number,
): number[][] => {
  if (totalPages < 1) {
    return [];
  }

  if (!ranges || ranges.trim().length === 0) {
    return Array.from({ length: totalPages }, (_, index) => [index]);
  }

  const groups: number[][] = [];
  const segments = ranges
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  for (const segment of segments) {
    if (segment.includes("-")) {
      const [startRaw, endRaw] = segment.split("-");
      const start = Number(startRaw);
      const end = Number(endRaw);

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new NonRetriableError(
          `Invalid range '${segment}'. Use format like 1-3 or 5`,
        );
      }

      if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
        throw new NonRetriableError(
          `Range '${segment}' is out of bounds for ${totalPages} page(s)`,
        );
      }

      if (end < start) {
        throw new NonRetriableError(
          `Invalid range '${segment}'. End page must be greater than or equal to start page`,
        );
      }

      groups.push(
        Array.from(
          { length: end - start + 1 },
          (_, offset) => start - 1 + offset,
        ),
      );
      continue;
    }

    const page = Number(segment);
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
      throw new NonRetriableError(
        `Invalid page '${segment}'. Page must be between 1 and ${totalPages}`,
      );
    }

    groups.push([page - 1]);
  }

  return groups;
};

const formatRangeLabel = (pageIndexes: number[]): string => {
  if (pageIndexes.length === 1) {
    return `${pageIndexes[0] + 1}`;
  }

  return `${pageIndexes[0] + 1}-${pageIndexes[pageIndexes.length - 1] + 1}`;
};

type PdfTextCell = {
  x: number;
  y: number;
  text: string;
};

const decodePdfText = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

const extractPdfTextCells = (page: unknown): PdfTextCell[] => {
  if (
    typeof page !== "object" ||
    page === null ||
    !Array.isArray((page as { Texts?: unknown }).Texts)
  ) {
    return [];
  }

  const texts = (page as { Texts: unknown[] }).Texts;
  const cells: PdfTextCell[] = [];

  for (const entry of texts) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { x?: unknown }).x !== "number" ||
      typeof (entry as { y?: unknown }).y !== "number" ||
      !Array.isArray((entry as { R?: unknown }).R)
    ) {
      continue;
    }

    const textRuns = (entry as { R: Array<{ T?: unknown }> }).R;
    const text = textRuns
      .map((run) => (typeof run.T === "string" ? decodePdfText(run.T) : ""))
      .join("")
      .trim();

    if (!text) {
      continue;
    }

    cells.push({
      x: (entry as { x: number }).x,
      y: (entry as { y: number }).y,
      text,
    });
  }

  return cells;
};

const extractTablesFromPdfPage = (
  page: unknown,
  pageNumber: number,
): Array<{
  page: number;
  headers: string[];
  rows: string[][];
  rowCount: number;
  columnCount: number;
}> => {
  const cells = extractPdfTextCells(page);
  if (cells.length < 4) {
    return [];
  }

  const rowGroups: Array<{ y: number; cells: PdfTextCell[] }> = [];
  const rowTolerance = 0.75;

  for (const cell of cells) {
    const row = rowGroups.find(
      (group) => Math.abs(group.y - cell.y) <= rowTolerance,
    );
    if (row) {
      row.cells.push(cell);
      row.y = (row.y + cell.y) / 2;
      continue;
    }

    rowGroups.push({
      y: cell.y,
      cells: [cell],
    });
  }

  const orderedRows = rowGroups
    .sort((left, right) => left.y - right.y)
    .map((group) => group.cells.sort((left, right) => left.x - right.x));

  const columnAnchors: number[] = [];
  const columnTolerance = 1.2;

  for (const row of orderedRows.slice(0, 25)) {
    for (const cell of row) {
      const index = columnAnchors.findIndex(
        (anchor) => Math.abs(anchor - cell.x) <= columnTolerance,
      );

      if (index === -1) {
        columnAnchors.push(cell.x);
      } else {
        columnAnchors[index] = (columnAnchors[index] + cell.x) / 2;
      }
    }
  }

  columnAnchors.sort((left, right) => left - right);
  if (columnAnchors.length < 2) {
    return [];
  }

  const rows = orderedRows
    .map((rowCells) => {
      const values = Array.from({ length: columnAnchors.length }, () => "");

      for (const cell of rowCells) {
        let bestIndex = 0;
        let bestDistance = Infinity;

        for (let index = 0; index < columnAnchors.length; index += 1) {
          const distance = Math.abs(columnAnchors[index] - cell.x);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
          }
        }

        values[bestIndex] = values[bestIndex]
          ? `${values[bestIndex]} ${cell.text}`
          : cell.text;
      }

      return values.map((value) => value.trim());
    })
    .filter((row) => row.some((value) => value.length > 0));

  if (rows.length < 2) {
    return [];
  }

  const [firstRow, ...restRows] = rows;
  const headerLike =
    firstRow.every((value) => value.length > 0) &&
    new Set(firstRow).size === firstRow.length;

  const headers = headerLike
    ? firstRow
    : firstRow.map((_, index) => `column_${index + 1}`);
  const dataRows = headerLike ? restRows : rows;

  return [
    {
      page: pageNumber,
      headers,
      rows: dataRows,
      rowCount: dataRows.length,
      columnCount: headers.length,
    },
  ];
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
    text.includes("\n") ||
    text.includes("\r") ||
    text.includes('"') ||
    text.includes(delimiter);

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

    const source = resolveContextValue(context, data.sourceVariable);
    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${data.sourceVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
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
      } else if (
        format === "json" ||
        (format === "auto" && typeof source !== "string")
      ) {
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

type PdfSplitData = {
  pdfVariable?: string;
  variableName?: string;
  ranges?: string;
  pageRanges?: string;
  fileNamePrefix?: string;
  filePrefix?: string;
};

export const pdfSplitExecutor: NodeExecutor<PdfSplitData> = async ({
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

    if (!data.pdfVariable) {
      throw new NonRetriableError("Source PDF variable is required");
    }

    const source = context[data.pdfVariable];
    if (!source) {
      throw new NonRetriableError(
        `PDF variable '${data.pdfVariable}' not found in workflow context`,
      );
    }

    const output = await step.run("pdf-split", async () => {
      const inputFile = await resolveFilePayload(source, "document.pdf");
      const document = await PDFDocument.load(inputFile.buffer, {
        ignoreEncryption: true,
      });

      const totalPages = document.getPageCount();
      const rangeInput = data.pageRanges ?? data.ranges;
      const rangeGroups = parsePageRanges(rangeInput, totalPages);
      const filePrefix =
        data.filePrefix ||
        data.fileNamePrefix ||
        inputFile.name.replace(/\.pdf$/i, "");

      const files: Array<{
        name: string;
        mimeType: string;
        size: number;
        buffer: Buffer;
        pageRange: string;
      }> = [];

      for (const range of rangeGroups) {
        const chunkDoc = await PDFDocument.create();
        const copiedPages = await chunkDoc.copyPages(document, range);
        copiedPages.forEach((page) => {
          chunkDoc.addPage(page);
        });

        const bytes = await chunkDoc.save();
        files.push({
          name: `${filePrefix}_pages_${formatRangeLabel(range)}.pdf`,
          mimeType: "application/pdf",
          size: bytes.length,
          buffer: Buffer.from(bytes),
          pageRange: formatRangeLabel(range),
        });
      }

      return {
        files,
        fileCount: files.length,
        totalPages,
        sourceFileName: inputFile.name,
      };
    });

    return {
      [data.variableName]: output,
    };
  });

type PdfMergeData = {
  pdfVariables?: string[] | string;
  variableName?: string;
  fileName?: string;
};

export const pdfMergeExecutor: NodeExecutor<PdfMergeData> = async ({
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

    const sourceVariables = Array.isArray(data.pdfVariables)
      ? data.pdfVariables
      : parseCommaList(data.pdfVariables);

    if (sourceVariables.length < 2) {
      throw new NonRetriableError(
        "Provide at least two source PDF variables to merge",
      );
    }

    const output = await step.run("pdf-merge", async () => {
      const mergedDoc = await PDFDocument.create();
      const sourceFiles: string[] = [];
      let totalPages = 0;

      for (const variable of sourceVariables) {
        const source = context[variable];
        if (!source) {
          throw new NonRetriableError(
            `PDF variable '${variable}' not found in workflow context`,
          );
        }

        const file = await resolveFilePayload(source, `${variable}.pdf`);
        const sourceDoc = await PDFDocument.load(file.buffer, {
          ignoreEncryption: true,
        });
        const pageIndexes = sourceDoc.getPageIndices();
        const copiedPages = await mergedDoc.copyPages(sourceDoc, pageIndexes);
        copiedPages.forEach((page) => {
          mergedDoc.addPage(page);
        });

        sourceFiles.push(file.name);
        totalPages += pageIndexes.length;
      }

      const bytes = await mergedDoc.save();
      return {
        name: data.fileName || `${data.variableName}.pdf`,
        mimeType: "application/pdf",
        size: bytes.length,
        buffer: Buffer.from(bytes),
        sourceFiles,
        totalPages,
      };
    });

    return {
      [data.variableName]: output,
    };
  });

type PdfFillFormData = {
  pdfVariable?: string;
  formDataVariable?: string;
  variableName?: string;
  flatten?: boolean;
  fileName?: string;
  fallbackFormDataJson?: string;
};

export const pdfFillFormExecutor: NodeExecutor<PdfFillFormData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    const variableName = data.variableName?.trim();
    const pdfVariable = data.pdfVariable?.trim();
    const formDataVariable = data.formDataVariable?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!pdfVariable) {
      throw new NonRetriableError("Source PDF variable is required");
    }

    if (!formDataVariable) {
      throw new NonRetriableError("Form data variable is required");
    }

    const source = resolveContextValue(context, pdfVariable);
    if (!source) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `PDF variable '${pdfVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const formDataValue = resolveContextValue(context, formDataVariable);
    if (
      formDataValue === undefined &&
      (!data.fallbackFormDataJson ||
        data.fallbackFormDataJson.trim().length === 0)
    ) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Form data variable '${formDataVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const output = await step.run("pdf-fill-form", async () => {
      const inputFile = await resolveFilePayload(source, `${variableName}.pdf`);
      const formData = resolveFormDataObject({
        formData: formDataValue,
        fallbackJson: data.fallbackFormDataJson,
      });

      if (Object.keys(formData).length === 0) {
        throw new NonRetriableError(
          "Form data is empty. Provide key/value pairs in formDataVariable or fallbackFormDataJson.",
        );
      }

      const pdfDoc = await PDFDocument.load(inputFile.buffer, {
        ignoreEncryption: true,
      });
      const form = pdfDoc.getForm();
      const availableFields = form.getFields().map((field) => field.getName());

      const updatedFields: string[] = [];
      const skippedFields: Array<{ field: string; reason: string }> = [];

      for (const [fieldName, rawValue] of Object.entries(formData)) {
        let field: ReturnType<typeof form.getField>;
        try {
          field = form.getField(fieldName);
        } catch {
          skippedFields.push({
            field: fieldName,
            reason: "Field not found in PDF form",
          });
          continue;
        }

        try {
          if (field instanceof PDFTextField) {
            field.setText(String(rawValue ?? ""));
            updatedFields.push(fieldName);
            continue;
          }

          if (field instanceof PDFCheckBox) {
            if (toBoolean(rawValue)) {
              field.check();
            } else {
              field.uncheck();
            }
            updatedFields.push(fieldName);
            continue;
          }

          if (field instanceof PDFRadioGroup) {
            const options = toStringList(rawValue);
            if (options.length === 0) {
              skippedFields.push({
                field: fieldName,
                reason: "Value is empty for radio group",
              });
              continue;
            }

            field.select(options[0]);
            updatedFields.push(fieldName);
            continue;
          }

          if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
            const options = toStringList(rawValue);
            if (options.length === 0) {
              skippedFields.push({
                field: fieldName,
                reason: "Value is empty for selection field",
              });
              continue;
            }

            if (options.length > 1) {
              field.select(options);
            } else {
              field.select(options[0]);
            }

            updatedFields.push(fieldName);
            continue;
          }

          skippedFields.push({
            field: fieldName,
            reason: `Unsupported PDF form field type '${field.constructor.name}'`,
          });
        } catch (error) {
          skippedFields.push({
            field: fieldName,
            reason:
              error instanceof Error
                ? error.message
                : "Failed to set PDF form field",
          });
        }
      }

      const flatten = data.flatten ?? true;
      if (flatten) {
        form.flatten();
      }

      const pdfBytes = await pdfDoc.save();

      return {
        name: data.fileName || `${variableName}.pdf`,
        mimeType: "application/pdf",
        size: pdfBytes.length,
        buffer: Buffer.from(pdfBytes),
        summary: {
          flattened: flatten,
          totalInputFields: Object.keys(formData).length,
          updatedFieldCount: updatedFields.length,
          skippedFieldCount: skippedFields.length,
          updatedFields,
          skippedFields,
          availableFieldCount: availableFields.length,
          availableFields,
        },
      };
    });

    return {
      [variableName]: output,
    };
  });

type PdfGenerateData = {
  variableName?: string;
  contentVariable?: string;
  title?: string;
  subtitle?: string;
  fileName?: string;
  statsVariable?: string;
  sectionsVariable?: string;
  tablesVariable?: string;
  footerText?: string;
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

    const content = data.contentVariable
      ? context[data.contentVariable]
      : undefined;
    const stats = data.statsVariable ? context[data.statsVariable] : undefined;
    const sections = data.sectionsVariable
      ? context[data.sectionsVariable]
      : undefined;
    const tables = data.tablesVariable
      ? context[data.tablesVariable]
      : undefined;

    if (
      content === undefined &&
      stats === undefined &&
      sections === undefined &&
      tables === undefined
    ) {
      throw new NonRetriableError(
        "At least one of contentVariable, statsVariable, sectionsVariable, or tablesVariable is required",
      );
    }

    const pdfBufferResult = await step.run("generate-pdf", async () => {
      const pdfDoc = await PDFDocument.create();
      let page = pdfDoc.addPage();
      const baseFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const headingFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const margin = 50;
      const bodySize = 11;
      const bodyLineHeight = bodySize * 1.45;
      const sectionTitleSize = 14;

      const getPageSize = () => page.getSize();
      const maxTextWidth = () => getPageSize().width - margin * 2;
      let y = getPageSize().height - margin;

      const ensureSpace = (requiredHeight: number) => {
        if (y - requiredHeight >= margin) {
          return;
        }

        page = pdfDoc.addPage();
        y = page.getSize().height - margin;
      };

      const drawWrappedText = (
        text: string,
        {
          size = bodySize,
          lineHeight = bodyLineHeight,
          font = baseFont,
        }: {
          size?: number;
          lineHeight?: number;
          font?: typeof baseFont;
        } = {},
      ) => {
        const words = text.split(/\s+/).filter((word) => word.length > 0);
        if (words.length === 0) {
          y -= lineHeight;
          return;
        }

        let line = "";
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          const width = font.widthOfTextAtSize(candidate, size);

          if (width > maxTextWidth() && line) {
            ensureSpace(lineHeight + 4);
            page.drawText(line, {
              x: margin,
              y: y - size,
              size,
              font,
              color: rgb(0, 0, 0),
            });
            y -= lineHeight;
            line = word;
            continue;
          }

          line = candidate;
        }

        if (line) {
          ensureSpace(lineHeight + 4);
          page.drawText(line, {
            x: margin,
            y: y - size,
            size,
            font,
            color: rgb(0, 0, 0),
          });
          y -= lineHeight;
        }
      };

      const drawSectionHeading = (label: string) => {
        ensureSpace(sectionTitleSize * 2);
        page.drawText(label, {
          x: margin,
          y: y - sectionTitleSize,
          size: sectionTitleSize,
          font: headingFont,
          color: rgb(0, 0, 0),
        });
        y -= sectionTitleSize * 1.5;
      };

      if (data.title) {
        ensureSpace(42);
        page.drawText(data.title, {
          x: margin,
          y: y - 24,
          size: 24,
          font: headingFont,
          color: rgb(0.08, 0.08, 0.1),
        });
        y -= 34;
      }

      if (data.subtitle) {
        drawWrappedText(data.subtitle, {
          size: 12,
          lineHeight: 17,
        });
        y -= 4;
      }

      if (stats !== undefined) {
        drawSectionHeading("Summary Stats");

        const statsEntries =
          typeof stats === "object" && stats !== null
            ? Object.entries(stats as Record<string, unknown>)
            : [["value", stats]];

        for (const [key, value] of statsEntries) {
          drawWrappedText(`${key}: ${String(value ?? "")}`);
        }

        y -= 4;
      }

      if (content !== undefined) {
        drawSectionHeading("Content");

        const contentText =
          typeof content === "string"
            ? content
            : JSON.stringify(content, null, 2);
        for (const block of contentText.split(/\n{2,}/)) {
          drawWrappedText(block);
          y -= 2;
        }
      }

      if (sections !== undefined) {
        const sectionList = Array.isArray(sections)
          ? sections
          : typeof sections === "object" && sections !== null
            ? [sections]
            : [];

        if (sectionList.length > 0) {
          drawSectionHeading("Sections");
        }

        sectionList.forEach((section, index) => {
          if (typeof section !== "object" || section === null) {
            drawSectionHeading(`Section ${index + 1}`);
            drawWrappedText(String(section));
            return;
          }

          const sectionObj = section as { title?: unknown; content?: unknown };
          drawSectionHeading(
            typeof sectionObj.title === "string" && sectionObj.title.length > 0
              ? sectionObj.title
              : `Section ${index + 1}`,
          );

          const sectionContent =
            typeof sectionObj.content === "string"
              ? sectionObj.content
              : JSON.stringify(sectionObj.content ?? sectionObj, null, 2);
          drawWrappedText(sectionContent);
          y -= 4;
        });
      }

      if (tables !== undefined) {
        const tableList = Array.isArray(tables) ? tables : [tables];

        if (tableList.length > 0) {
          drawSectionHeading("Tables");
        }

        tableList.forEach((table, tableIndex) => {
          if (typeof table !== "object" || table === null) {
            drawSectionHeading(`Table ${tableIndex + 1}`);
            drawWrappedText(String(table));
            return;
          }

          const tableObj = table as {
            title?: unknown;
            headers?: unknown;
            rows?: unknown;
          };

          drawSectionHeading(
            typeof tableObj.title === "string" && tableObj.title.length > 0
              ? tableObj.title
              : `Table ${tableIndex + 1}`,
          );

          const headers = Array.isArray(tableObj.headers)
            ? tableObj.headers.map((header) => String(header))
            : [];

          const rows = Array.isArray(tableObj.rows) ? tableObj.rows : [];
          const normalizedHeaders =
            headers.length > 0
              ? headers
              : rows.length > 0 &&
                  typeof rows[0] === "object" &&
                  rows[0] !== null &&
                  !Array.isArray(rows[0])
                ? Object.keys(rows[0] as Record<string, unknown>)
                : [];

          if (normalizedHeaders.length > 0) {
            drawWrappedText(normalizedHeaders.join(" | "), {
              size: 10,
              lineHeight: 14,
              font: headingFont,
            });
          }

          rows.slice(0, 300).forEach((row) => {
            const values = Array.isArray(row)
              ? row.map((value) => String(value ?? ""))
              : typeof row === "object" && row !== null
                ? normalizedHeaders.map((header) =>
                    String((row as Record<string, unknown>)[header] ?? ""),
                  )
                : [String(row)];

            drawWrappedText(values.join(" | "), {
              size: 10,
              lineHeight: 14,
            });
          });

          y -= 4;
        });
      }

      if (data.footerText) {
        ensureSpace(24);
        page.drawText(data.footerText, {
          x: margin,
          y: y - 10,
          size: 9,
          font: baseFont,
          color: rgb(0.45, 0.45, 0.45),
        });
      }

      const pdfBytes = await pdfDoc.save();
      return Buffer.from(pdfBytes);
    });

    const pdfBuffer = toBuffer(pdfBufferResult);
    if (!pdfBuffer) {
      throw new NonRetriableError("Failed to generate PDF buffer");
    }

    return {
      [data.variableName]: {
        name: data.fileName || `${data.variableName}.pdf`,
        mimeType: "application/pdf",
        buffer: pdfBuffer,
        size: pdfBuffer.length,
      },
    };
  });

type PdfSignData = {
  pdfVariable?: string;
  certificateVariable?: string;
  certificatePasswordVariable?: string;
  signatureReason?: string;
  signatureLocation?: string;
  fileName?: string;
  variableName?: string;
};

export const pdfSignExecutor: NodeExecutor<PdfSignData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    const variableName = data.variableName?.trim();
    const pdfVariable = data.pdfVariable?.trim();
    const certificateVariable = data.certificateVariable?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!pdfVariable) {
      throw new NonRetriableError("Source PDF variable is required");
    }

    if (!certificateVariable) {
      throw new NonRetriableError("Certificate variable is required");
    }

    const source = resolveContextValue(context, pdfVariable);
    if (!source) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `PDF variable '${pdfVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const certificateSource = resolveContextValue(context, certificateVariable);
    if (!certificateSource) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Certificate variable '${certificateVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const certificatePassword = data.certificatePasswordVariable?.trim()
      ? resolveContextValue(context, data.certificatePasswordVariable)
      : undefined;

    if (
      data.certificatePasswordVariable?.trim() &&
      certificatePassword === undefined
    ) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Certificate password variable '${data.certificatePasswordVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const output = await step.run("pdf-sign", async () => {
      const inputFile = await resolveFilePayload(source, `${variableName}.pdf`);
      const certificateFile = await resolveFilePayload(
        certificateSource,
        `${certificateVariable}.p12`,
      );

      const pdfDoc = await PDFDocument.load(inputFile.buffer, {
        ignoreEncryption: true,
      });

      const pages = pdfDoc.getPages();
      if (pages.length === 0) {
        throw new NonRetriableError("PDF has no pages to sign");
      }

      const targetPage = pages[pages.length - 1];
      const { width, height } = targetPage.getSize();
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const baseFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const signedAt = new Date();
      const stampLines = [
        `Certificate: ${certificateFile.name}`,
        data.signatureReason?.trim()
          ? `Reason: ${data.signatureReason.trim()}`
          : undefined,
        data.signatureLocation?.trim()
          ? `Location: ${data.signatureLocation.trim()}`
          : undefined,
        `Signed at: ${signedAt.toISOString()}`,
      ].filter((line): line is string => Boolean(line));

      const stampPadding = 8;
      const titleHeight = 14;
      const lineHeight = 10;
      const stampWidth = Math.min(300, width - 48);
      const stampHeight = Math.min(
        110,
        stampPadding * 2 + titleHeight + stampLines.length * lineHeight,
      );
      const stampX = Math.max(24, width - stampWidth - 24);
      const stampY = Math.max(24, Math.min(24, height - stampHeight - 24));

      targetPage.drawRectangle({
        x: stampX,
        y: stampY,
        width: stampWidth,
        height: stampHeight,
        color: rgb(0.98, 0.98, 0.98),
        borderColor: rgb(0.2, 0.2, 0.2),
        borderWidth: 1,
      });

      let cursorY = stampY + stampHeight - stampPadding - 10;
      targetPage.drawText("SIGNED (visual stamp)", {
        x: stampX + stampPadding,
        y: cursorY,
        size: 10,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.1),
      });

      cursorY -= titleHeight;
      for (const line of stampLines) {
        targetPage.drawText(line, {
          x: stampX + stampPadding,
          y: cursorY,
          size: 8,
          font: baseFont,
          color: rgb(0.2, 0.2, 0.2),
        });
        cursorY -= lineHeight;
      }

      pdfDoc.setProducer("AutoPilot PDF Sign Node");
      pdfDoc.setCreator("AutoPilot");
      pdfDoc.setModificationDate(signedAt);
      if (data.signatureReason?.trim()) {
        pdfDoc.setSubject(data.signatureReason.trim());
      }

      const pdfBytes = await pdfDoc.save();

      return {
        name: data.fileName || `${variableName}.pdf`,
        mimeType: "application/pdf",
        size: pdfBytes.length,
        buffer: Buffer.from(pdfBytes),
        signature: {
          mode: "visual-stamp",
          certificateFile: certificateFile.name,
          certificatePasswordProvided:
            typeof certificatePassword === "string" &&
            certificatePassword.length > 0,
          reason: data.signatureReason?.trim() || null,
          location: data.signatureLocation?.trim() || null,
          signedAt: signedAt.toISOString(),
        },
      };
    });

    return {
      [variableName]: output,
    };
  });

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

type PdfExtractTablesData = {
  pdfVariable?: string;
  variableName?: string;
};

export const pdfExtractTablesExecutor: NodeExecutor<
  PdfExtractTablesData
> = async ({ data, nodeId, context, publish, step }) =>
  withFileNodeStatus(nodeId, publish, async () => {
    if (!data.variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!data.pdfVariable) {
      throw new NonRetriableError("Source PDF variable is required");
    }

    const source = context[data.pdfVariable];
    if (!source) {
      throw new NonRetriableError(
        `PDF variable '${data.pdfVariable}' not found in workflow context`,
      );
    }

    const output = await step.run("pdf-extract-tables", async () => {
      const payload = await resolveFilePayload(source, "document.pdf");
      const module = await import("pdf2json");
      const PdfParserCtor =
        (module as { default?: unknown; PDFParser?: unknown }).default ||
        (module as { default?: unknown; PDFParser?: unknown }).PDFParser;

      if (typeof PdfParserCtor !== "function") {
        throw new NonRetriableError("Unable to initialize pdf2json parser");
      }

      const parser = new (
        PdfParserCtor as new () => {
          on: (event: string, listener: (payload: unknown) => void) => void;
          parseBuffer: (buffer: Buffer) => void;
        }
      )();

      const parsedOutput = await new Promise<unknown>((resolve, reject) => {
        parser.on("pdfParser_dataError", (err) => {
          reject(
            new NonRetriableError(
              typeof err === "object" && err !== null
                ? JSON.stringify(err)
                : "Failed to parse PDF",
            ),
          );
        });

        parser.on("pdfParser_dataReady", (pdfData) => resolve(pdfData));
        parser.parseBuffer(payload.buffer);
      });

      const normalized =
        typeof parsedOutput === "object" &&
        parsedOutput !== null &&
        "Pages" in parsedOutput
          ? parsedOutput
          : typeof parsedOutput === "object" &&
              parsedOutput !== null &&
              "formImage" in parsedOutput
            ? (parsedOutput as { formImage: unknown }).formImage
            : parsedOutput;

      const pages =
        typeof normalized === "object" &&
        normalized !== null &&
        Array.isArray((normalized as { Pages?: unknown }).Pages)
          ? ((normalized as { Pages: unknown[] }).Pages ?? [])
          : [];

      const tables = pages.flatMap((page, index) =>
        extractTablesFromPdfPage(page, index + 1),
      );

      return {
        tables,
        tableCount: tables.length,
        pageCount: pages.length,
        sourceFileName: payload.name,
      };
    });

    return {
      [data.variableName]: output,
    };
  });

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
      const rows = await resolveRecords(source);
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

    const source = resolveContextValue(context, data.sourceVariable);
    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${data.sourceVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const sourceSchema = resolveSchema(source);
    const rows = await resolveRecords(source);
    if (rows.length === 0) {
      throw new NonRetriableError(
        "Source variable must contain CSV records (array or object with records/data array)",
      );
    }

    const operator = data.operator ?? "eq";

    const filtered = await step.run("csv-filter", async () => {
      const result = await mapBatches({
        source: rows,
        batchSize: EXECUTION_CHUNK_SIZE,
        mapBatch: (batch) => {
          return batch.filter((row) =>
            applyCsvPredicate(row, data.field as string, operator, data.value),
          );
        },
      });

      return buildSchemaAwareRecordsOutput(result, sourceSchema);
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

    const source = resolveContextValue(context, sourceVariable);
    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${sourceVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const rows = await resolveRecords(source);
    if (rows.length === 0) {
      throw new NonRetriableError(
        `Source variable '${sourceVariable}' must contain CSV records (array or object with records/data array)`,
      );
    }

    const operation = data.operation ?? "count";

    const aggregated = await step.run("csv-aggregate", async () => {
      if (operation !== "count" && !targetField) {
        throw new NonRetriableError(
          "targetField is required for sum/avg/min/max operations",
        );
      }

      const buckets = new Map<
        string,
        {
          count: number;
          numericCount: number;
          sum: number;
          min: number | null;
          max: number | null;
        }
      >();

      await reduceBatches({
        source: rows,
        batchSize: EXECUTION_CHUNK_SIZE,
        initialState: buckets,
        reduceBatch: (state, batch) => {
          for (const row of batch) {
            const key = String(row[groupBy] ?? "");
            const bucket = state.get(key) || {
              count: 0,
              numericCount: 0,
              sum: 0,
              min: null,
              max: null,
            };

            bucket.count += 1;

            if (operation !== "count" && targetField) {
              const numberValue = parseNumber(row[targetField]);
              if (numberValue !== null) {
                bucket.numericCount += 1;
                bucket.sum += numberValue;
                bucket.min =
                  bucket.min === null
                    ? numberValue
                    : Math.min(bucket.min, numberValue);
                bucket.max =
                  bucket.max === null
                    ? numberValue
                    : Math.max(bucket.max, numberValue);
              }
            }

            state.set(key, bucket);
          }

          return state;
        },
      });

      const records = Array.from(buckets.entries()).map(
        ([groupKey, bucket]) => {
          const base: Record<string, unknown> = {
            [groupBy]: groupKey,
            count: bucket.count,
            numericCount: bucket.numericCount,
          };

          if (operation === "count") {
            base.value = bucket.count;
            return base;
          }

          if (bucket.numericCount === 0) {
            base.value = null;
            return base;
          }

          if (operation === "sum") {
            base.value = bucket.sum;
            return base;
          }

          if (operation === "avg") {
            base.value = bucket.sum / bucket.numericCount;
            return base;
          }

          if (operation === "min") {
            base.value = bucket.min;
            return base;
          }

          base.value = bucket.max;
          return base;
        },
      );

      return buildSchemaAwareRecordsOutput(records);
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
  joinType?:
    | "inner"
    | "left"
    | "right"
    | "full"
    | "left_exclusive"
    | "right_exclusive";
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
      throw new NonRetriableError(
        "Both left and right source variables are required",
      );
    }

    if (!leftKey || !rightKey) {
      throw new NonRetriableError("Both leftKey and rightKey are required");
    }

    const leftSource = resolveContextValue(context, leftVariable);
    if (leftSource === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Left source variable '${leftVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const rightSource = resolveContextValue(context, rightVariable);
    if (rightSource === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Right source variable '${rightVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const leftRows = await resolveRecords(leftSource);
    const rightRows = await resolveRecords(rightSource);

    if (leftRows.length === 0 || rightRows.length === 0) {
      throw new NonRetriableError(
        "Both source variables must contain CSV records",
      );
    }

    const joinType = data.joinType ?? "inner";

    const joined = await step.run("csv-join", async () => {
      const rightIndex = new Map<string, Record<string, unknown>[]>();
      const matchedRightRows = new Set<Record<string, unknown>>();

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
      const leftFields = collectFieldNames(leftRows);
      const rightFields = collectFieldNames(rightRows);

      const mergeRows = (
        leftRow: Record<string, unknown>,
        rightRow: Record<string, unknown>,
      ): Record<string, unknown> => {
        const merged: Record<string, unknown> = { ...leftRow };
        for (const [field, value] of Object.entries(rightRow)) {
          if (Object.hasOwn(merged, field) && field !== rightKey) {
            merged[`right_${field}`] = value;
          } else {
            merged[field] = value;
          }
        }
        return merged;
      };

      const withRightNulls = (
        leftRow: Record<string, unknown>,
      ): Record<string, unknown> => {
        const merged: Record<string, unknown> = { ...leftRow };

        for (const field of rightFields) {
          if (Object.hasOwn(merged, field) && field !== rightKey) {
            merged[`right_${field}`] = null;
          } else if (!Object.hasOwn(merged, field)) {
            merged[field] = null;
          }
        }

        return merged;
      };

      const withLeftNulls = (
        rightRow: Record<string, unknown>,
      ): Record<string, unknown> => {
        const merged: Record<string, unknown> = {};

        for (const field of leftFields) {
          merged[field] = null;
        }

        for (const [field, value] of Object.entries(rightRow)) {
          if (Object.hasOwn(merged, field) && field !== rightKey) {
            merged[`right_${field}`] = value;
          } else {
            merged[field] = value;
          }
        }

        return merged;
      };

      for (const leftRow of leftRows) {
        const leftKeyValue = String(leftRow[leftKey] ?? "");
        const matches = rightIndex.get(leftKeyValue) ?? [];

        if (matches.length === 0) {
          if (joinType === "left" || joinType === "full") {
            records.push(withRightNulls(leftRow));
          } else if (joinType === "left_exclusive") {
            records.push(withRightNulls(leftRow));
          }
          continue;
        }

        if (joinType === "left_exclusive") {
          continue;
        }

        for (const rightRow of matches) {
          matchedRightRows.add(rightRow);
          records.push(mergeRows(leftRow, rightRow));
        }
      }

      if (
        joinType === "right" ||
        joinType === "full" ||
        joinType === "right_exclusive"
      ) {
        for (const rightRow of rightRows) {
          if (matchedRightRows.has(rightRow)) {
            continue;
          }

          if (joinType === "right" || joinType === "full") {
            records.push(withLeftNulls(rightRow));
          } else if (joinType === "right_exclusive") {
            records.push(withLeftNulls(rightRow));
          }
        }
      }

      return buildSchemaAwareRecordsOutput(records);
    });

    return {
      [variableName]: joined,
    };
  });

type CsvSortData = {
  sourceVariable?: string;
  variableName?: string;
  sortField?: string;
  direction?: "asc" | "desc";
  compareAs?: "string" | "number" | "date";
  nulls?: "first" | "last";
};

export const csvSortExecutor: NodeExecutor<CsvSortData> = async ({
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

    if (!data.sortField) {
      throw new NonRetriableError("Sort field is required");
    }

    const source = resolveContextValue(context, data.sourceVariable);
    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${data.sourceVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const sourceSchema = resolveSchema(source);
    const rows = await resolveRecords(source);
    if (rows.length === 0) {
      throw new NonRetriableError(
        "Source variable must contain CSV records (array or object with records/data array)",
      );
    }

    const output = await step.run("csv-sort", async () => {
      const direction = data.direction ?? "asc";
      const compareAs = data.compareAs ?? "string";
      const nulls = data.nulls ?? "last";

      const sorted = rows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
          const leftValue = left.row[data.sortField as string];
          const rightValue = right.row[data.sortField as string];

          const leftIsNull =
            leftValue === undefined ||
            leftValue === null ||
            (typeof leftValue === "string" && leftValue.trim() === "");
          const rightIsNull =
            rightValue === undefined ||
            rightValue === null ||
            (typeof rightValue === "string" && rightValue.trim() === "");

          if (leftIsNull || rightIsNull) {
            if (leftIsNull && rightIsNull) {
              return left.index - right.index;
            }

            const nullOrder = nulls === "first" ? -1 : 1;
            return leftIsNull ? nullOrder : -nullOrder;
          }

          let result = 0;

          if (compareAs === "number") {
            const leftNumber = parseNumber(leftValue);
            const rightNumber = parseNumber(rightValue);
            if (leftNumber !== null && rightNumber !== null) {
              result = leftNumber - rightNumber;
            }
          } else if (compareAs === "date") {
            const leftDate = new Date(String(leftValue)).getTime();
            const rightDate = new Date(String(rightValue)).getTime();
            if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
              result = leftDate - rightDate;
            }
          }

          if (result === 0) {
            result = String(leftValue).localeCompare(
              String(rightValue),
              undefined,
              {
                sensitivity: "base",
                numeric: compareAs !== "string",
              },
            );
          }

          if (result === 0) {
            return left.index - right.index;
          }

          return direction === "desc" ? -result : result;
        })
        .map((entry) => entry.row);

      return buildSchemaAwareRecordsOutput(sorted, sourceSchema);
    });

    return {
      [data.variableName]: output,
    };
  });

type CsvDeduplicateData = {
  sourceVariable?: string;
  variableName?: string;
  fields?: string | string[];
  keep?: "first" | "last";
  includeDuplicates?: boolean;
};

export const csvDeduplicateExecutor: NodeExecutor<CsvDeduplicateData> = async ({
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

    const source = resolveContextValue(context, data.sourceVariable);
    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${data.sourceVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const sourceSchema = resolveSchema(source);
    const rows = await resolveRecords(source);
    if (rows.length === 0) {
      throw new NonRetriableError(
        "Source variable must contain CSV records (array or object with records/data array)",
      );
    }

    const output = await step.run("csv-deduplicate", async () => {
      const keep = data.keep ?? "first";
      const selectedFields = Array.isArray(data.fields)
        ? data.fields
        : parseCommaList(data.fields);

      const buildKey = (row: Record<string, unknown>) => {
        if (selectedFields.length === 0) {
          return JSON.stringify(row);
        }

        return JSON.stringify(
          Object.fromEntries(
            selectedFields.map((field) => [field, row[field] ?? null]),
          ),
        );
      };

      const duplicates: Array<Record<string, unknown>> = [];
      let records: Array<Record<string, unknown>> = [];

      if (keep === "first") {
        const seenKeys = new Set<string>();
        for (const row of rows) {
          const key = buildKey(row);
          if (seenKeys.has(key)) {
            duplicates.push(row);
            continue;
          }

          seenKeys.add(key);
          records.push(row);
        }
      } else {
        const latestByKey = new Map<
          string,
          { row: Record<string, unknown>; index: number }
        >();

        rows.forEach((row, index) => {
          latestByKey.set(buildKey(row), { row, index });
        });

        records = Array.from(latestByKey.values())
          .sort((left, right) => left.index - right.index)
          .map((entry) => entry.row);

        const keptIndexByKey = new Map(
          Array.from(latestByKey.entries()).map(([key, value]) => [
            key,
            value.index,
          ]),
        );

        rows.forEach((row, index) => {
          const key = buildKey(row);
          if (keptIndexByKey.get(key) !== index) {
            duplicates.push(row);
          }
        });
      }

      return {
        ...buildSchemaAwareRecordsOutput(records, sourceSchema),
        removedCount: rows.length - records.length,
        ...(data.includeDuplicates ? { duplicates } : {}),
      };
    });

    return {
      [data.variableName]: output,
    };
  });

type CsvColumnStatsData = {
  sourceVariable?: string;
  variableName?: string;
  fields?: string | string[];
};

export const csvColumnStatsExecutor: NodeExecutor<CsvColumnStatsData> = async ({
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

    const source = resolveContextValue(context, data.sourceVariable);
    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${data.sourceVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const rows = await resolveRecords(source);
    if (rows.length === 0) {
      throw new NonRetriableError(
        "Source variable must contain CSV records (array or object with records/data array)",
      );
    }

    const output = await step.run("csv-column-stats", async () => {
      const requestedFields = Array.isArray(data.fields)
        ? data.fields
        : parseCommaList(data.fields);
      const fields =
        requestedFields.length > 0 ? requestedFields : collectFieldNames(rows);

      const stats = new Map<
        string,
        {
          total: number;
          nonNull: number;
          nullCount: number;
          numericCount: number;
          sum: number;
          min: number | null;
          max: number | null;
          uniqueValues: Set<string>;
          frequencies: Map<string, number>;
        }
      >();

      for (const field of fields) {
        stats.set(field, {
          total: rows.length,
          nonNull: 0,
          nullCount: 0,
          numericCount: 0,
          sum: 0,
          min: null,
          max: null,
          uniqueValues: new Set<string>(),
          frequencies: new Map<string, number>(),
        });
      }

      await reduceBatches({
        source: rows,
        batchSize: EXECUTION_CHUNK_SIZE,
        initialState: stats,
        reduceBatch: (state, batch) => {
          for (const row of batch) {
            for (const field of fields) {
              const entry = state.get(field);
              if (!entry) {
                continue;
              }

              const value = row[field];
              const isNullish =
                value === undefined ||
                value === null ||
                (typeof value === "string" && value.trim() === "");

              if (isNullish) {
                entry.nullCount += 1;
                continue;
              }

              entry.nonNull += 1;

              const serialized = String(value);
              entry.uniqueValues.add(serialized);
              entry.frequencies.set(
                serialized,
                (entry.frequencies.get(serialized) || 0) + 1,
              );

              const numericValue = parseNumber(value);
              if (numericValue !== null) {
                entry.numericCount += 1;
                entry.sum += numericValue;
                entry.min =
                  entry.min === null
                    ? numericValue
                    : Math.min(entry.min, numericValue);
                entry.max =
                  entry.max === null
                    ? numericValue
                    : Math.max(entry.max, numericValue);
              }
            }
          }

          return state;
        },
      });

      const columns = Object.fromEntries(
        Array.from(stats.entries()).map(([field, entry]) => {
          const topValues = Array.from(entry.frequencies.entries())
            .sort((left, right) => right[1] - left[1])
            .slice(0, 5)
            .map(([value, count]) => ({ value, count }));

          return [
            field,
            {
              total: entry.total,
              nonNull: entry.nonNull,
              nullCount: entry.nullCount,
              uniqueCount: entry.uniqueValues.size,
              numericCount: entry.numericCount,
              min: entry.min,
              max: entry.max,
              sum: entry.numericCount > 0 ? entry.sum : null,
              avg:
                entry.numericCount > 0 ? entry.sum / entry.numericCount : null,
              topValues,
            },
          ];
        }),
      );

      return {
        columns,
        fieldCount: fields.length,
        rowCount: rows.length,
      };
    });

    return {
      [data.variableName]: output,
    };
  });

type CsvCompareData = {
  leftVariable?: string;
  rightVariable?: string;
  variableName?: string;
  keyField?: string;
  compareFields?: string | string[];
};

export const csvCompareExecutor: NodeExecutor<CsvCompareData> = async ({
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

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!leftVariable || !rightVariable) {
      throw new NonRetriableError(
        "Both left and right source variables are required",
      );
    }

    const leftSource = resolveContextValue(context, leftVariable);
    const rightSource = resolveContextValue(context, rightVariable);

    if (leftSource === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Left source variable '${leftVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    if (rightSource === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Right source variable '${rightVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const leftRows = await resolveRecords(leftSource);
    const rightRows = await resolveRecords(rightSource);

    if (leftRows.length === 0 && rightRows.length === 0) {
      throw new NonRetriableError(
        "At least one source variable must contain CSV records",
      );
    }

    const output = await step.run("csv-compare", async () => {
      const keyField = data.keyField?.trim();
      const requestedFields = Array.isArray(data.compareFields)
        ? data.compareFields
        : parseCommaList(data.compareFields);

      const compareFields =
        requestedFields.length > 0
          ? requestedFields
          : Array.from(
              new Set([
                ...collectFieldNames(leftRows),
                ...collectFieldNames(rightRows),
              ]),
            ).filter((field) => field !== keyField);

      const added: Array<Record<string, unknown>> = [];
      const removed: Array<Record<string, unknown>> = [];
      const changed: Array<{
        key: string;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
        differences: Array<{ field: string; before: unknown; after: unknown }>;
      }> = [];
      let unchangedCount = 0;

      if (keyField) {
        const leftIndex = new Map<string, Array<Record<string, unknown>>>();
        const rightIndex = new Map<string, Array<Record<string, unknown>>>();

        for (const row of leftRows) {
          const key = String(row[keyField] ?? "");
          leftIndex.set(key, [...(leftIndex.get(key) || []), row]);
        }

        for (const row of rightRows) {
          const key = String(row[keyField] ?? "");
          rightIndex.set(key, [...(rightIndex.get(key) || []), row]);
        }

        const allKeys = Array.from(
          new Set([...leftIndex.keys(), ...rightIndex.keys()]),
        );

        for (const key of allKeys) {
          const leftGroup = leftIndex.get(key) || [];
          const rightGroup = rightIndex.get(key) || [];
          const maxLength = Math.max(leftGroup.length, rightGroup.length);

          for (let index = 0; index < maxLength; index += 1) {
            const leftRow = leftGroup[index];
            const rightRow = rightGroup[index];

            if (!leftRow && rightRow) {
              added.push(rightRow);
              continue;
            }

            if (leftRow && !rightRow) {
              removed.push(leftRow);
              continue;
            }

            if (!leftRow || !rightRow) {
              continue;
            }

            const differences = compareFields
              .map((field) => ({
                field,
                before: leftRow[field],
                after: rightRow[field],
              }))
              .filter(
                (entry) =>
                  JSON.stringify(entry.before ?? null) !==
                  JSON.stringify(entry.after ?? null),
              );

            if (differences.length === 0) {
              unchangedCount += 1;
            } else {
              changed.push({
                key,
                before: leftRow,
                after: rightRow,
                differences,
              });
            }
          }
        }
      } else {
        const toKey = (row: Record<string, unknown>) => JSON.stringify(row);
        const leftCounts = new Map<
          string,
          { row: Record<string, unknown>; count: number }
        >();
        const rightCounts = new Map<
          string,
          { row: Record<string, unknown>; count: number }
        >();

        for (const row of leftRows) {
          const key = toKey(row);
          const current = leftCounts.get(key);
          leftCounts.set(key, {
            row,
            count: (current?.count || 0) + 1,
          });
        }

        for (const row of rightRows) {
          const key = toKey(row);
          const current = rightCounts.get(key);
          rightCounts.set(key, {
            row,
            count: (current?.count || 0) + 1,
          });
        }

        const allKeys = Array.from(
          new Set([...leftCounts.keys(), ...rightCounts.keys()]),
        );

        for (const key of allKeys) {
          const leftEntry = leftCounts.get(key);
          const rightEntry = rightCounts.get(key);
          const leftCount = leftEntry?.count || 0;
          const rightCount = rightEntry?.count || 0;
          const unchanged = Math.min(leftCount, rightCount);
          unchangedCount += unchanged;

          if (rightCount > leftCount && rightEntry) {
            for (let index = 0; index < rightCount - leftCount; index += 1) {
              added.push(rightEntry.row);
            }
          }

          if (leftCount > rightCount && leftEntry) {
            for (let index = 0; index < leftCount - rightCount; index += 1) {
              removed.push(leftEntry.row);
            }
          }
        }
      }

      return {
        keyField: keyField || null,
        compareFields,
        added,
        removed,
        changed,
        addedCount: added.length,
        removedCount: removed.length,
        changedCount: changed.length,
        unchangedCount,
      };
    });

    return {
      [variableName]: output,
    };
  });

// Spreadsheet Nodes
export const readExcelExecutor: NodeExecutor = pendingExecutor("read_excel");

export const writeExcelExecutor: NodeExecutor = pendingExecutor("write_excel");

export const appendRowExecutor: NodeExecutor = pendingExecutor("append_row");

export const sheetTransformExecutor: NodeExecutor =
  pendingExecutor("sheet_transform");

// PowerPoint Nodes
export const createPresentationExecutor: NodeExecutor = pendingExecutor(
  "create_presentation",
);

export const addSlideExecutor: NodeExecutor = pendingExecutor("add_slide");

export const fillTemplateExecutor: NodeExecutor =
  pendingExecutor("fill_template");

// Image Processing Nodes
export const resizeImageExecutor: NodeExecutor =
  pendingExecutor("resize_image");

export const cropImageExecutor: NodeExecutor = pendingExecutor("crop_image");

export const convertImageExecutor: NodeExecutor =
  pendingExecutor("convert_image");

export const ocrImageExecutor: NodeExecutor = pendingExecutor("ocr_image");

// Data Transformation Nodes
type JsonTransformOperation =
  | "identity"
  | "pick"
  | "omit"
  | "flatten"
  | "stringify"
  | "parse"
  | "keys"
  | "values"
  | "entries"
  | "set"
  | "delete";

type JsonTransformData = {
  sourceVariable?: string;
  variableName?: string;
  operation?: JsonTransformOperation;
  fields?: string | string[];
  path?: string;
  value?: unknown;
  valueVariable?: string;
};

const splitPath = (path: string): string[] =>
  path
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const getPathValue = (value: unknown, path: string): unknown => {
  const segments = splitPath(path);
  if (segments.length === 0) {
    return value;
  }

  let current: unknown = value;
  for (const segment of segments) {
    if (!isPlainObject(current) && !Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
};

const setPathValue = (
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) => {
  const segments = splitPath(path);
  if (segments.length === 0) {
    return;
  }

  let current: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextValue = current[segment];

    if (!isPlainObject(nextValue)) {
      current[segment] = {};
    }

    current = current[segment] as Record<string, unknown>;
  }

  const leaf = segments[segments.length - 1];
  current[leaf] = value;
};

const deletePathValue = (target: Record<string, unknown>, path: string) => {
  const segments = splitPath(path);
  if (segments.length === 0) {
    return;
  }

  let current: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextValue = current[segment];

    if (!isPlainObject(nextValue)) {
      return;
    }

    current = nextValue;
  }

  const leaf = segments[segments.length - 1];
  delete current[leaf];
};

const flattenObject = (
  value: Record<string, unknown>,
  prefix = "",
  output: Record<string, unknown> = {},
): Record<string, unknown> => {
  for (const [key, child] of Object.entries(value)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;

    if (isPlainObject(child)) {
      flattenObject(child, nextPath, output);
      continue;
    }

    output[nextPath] = child;
  }

  return output;
};

const cloneValue = (value: unknown): unknown => {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  if (typeof value === "undefined") {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
};

export const jsonTransformExecutor: NodeExecutor<JsonTransformData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    const variableName = data.variableName?.trim() || "jsonTransformResult";
    const sourceReference = data.sourceVariable?.trim();
    const operation = data.operation ?? "identity";
    const fieldPaths =
      Array.isArray(data.fields) && data.fields.length > 0
        ? data.fields
            .map((field) => String(field).trim())
            .filter((field) => field.length > 0)
        : parseCommaList(
            typeof data.fields === "string" ? data.fields : undefined,
          );

    const source = sourceReference
      ? resolveContextValue(context, sourceReference)
      : undefined;

    if (sourceReference && source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${sourceReference}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const transformed = await step.run("json-transform", async () => {
      const input = sourceReference ? source : context;

      if (operation === "identity") {
        return cloneValue(input);
      }

      if (operation === "stringify") {
        return JSON.stringify(input, null, 2);
      }

      if (operation === "parse") {
        if (Buffer.isBuffer(input)) {
          return JSON.parse(input.toString("utf-8"));
        }

        if (typeof input !== "string") {
          throw new NonRetriableError(
            "JSON parse operation requires a string or buffer source",
          );
        }

        return JSON.parse(input);
      }

      if (!isPlainObject(input)) {
        throw new NonRetriableError(
          `JSON transform operation '${operation}' requires an object source`,
        );
      }

      if (operation === "keys") {
        return Object.keys(input);
      }

      if (operation === "values") {
        return Object.values(input);
      }

      if (operation === "entries") {
        return Object.entries(input).map(([key, value]) => ({ key, value }));
      }

      if (operation === "flatten") {
        return flattenObject(input);
      }

      if (operation === "pick") {
        if (fieldPaths.length === 0) {
          throw new NonRetriableError(
            "JSON pick operation requires at least one field path",
          );
        }

        const result: Record<string, unknown> = {};
        for (const path of fieldPaths) {
          const value = getPathValue(input, path);
          if (value !== undefined) {
            setPathValue(result, path, value);
          }
        }

        return result;
      }

      if (operation === "omit") {
        if (fieldPaths.length === 0) {
          throw new NonRetriableError(
            "JSON omit operation requires at least one field path",
          );
        }

        const result = cloneValue(input);
        if (!isPlainObject(result)) {
          throw new NonRetriableError(
            "Unable to clone object for omit operation",
          );
        }

        for (const path of fieldPaths) {
          deletePathValue(result, path);
        }

        return result;
      }

      if (operation === "set") {
        const path = data.path?.trim();
        if (!path) {
          throw new NonRetriableError(
            "JSON set operation requires a target path",
          );
        }

        const result = cloneValue(input);
        if (!isPlainObject(result)) {
          throw new NonRetriableError(
            "Unable to clone object for set operation",
          );
        }

        const valueToSet = data.valueVariable?.trim()
          ? resolveContextValue(context, data.valueVariable)
          : data.value;

        setPathValue(result, path, valueToSet);
        return result;
      }

      if (operation === "delete") {
        const path = data.path?.trim();
        if (!path) {
          throw new NonRetriableError(
            "JSON delete operation requires a target path",
          );
        }

        const result = cloneValue(input);
        if (!isPlainObject(result)) {
          throw new NonRetriableError(
            "Unable to clone object for delete operation",
          );
        }

        deletePathValue(result, path);
        return result;
      }

      throw new NonRetriableError(
        `Unsupported JSON transform operation '${operation}'`,
      );
    });

    return {
      [variableName]: transformed,
      [`${variableName}_meta`]: {
        operation,
        sourceVariable: sourceReference || null,
        fieldCount: fieldPaths.length,
        path: data.path?.trim() || null,
      },
    };
  });

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
    const sourceSchema = resolveSchema(source);
    const rows = await resolveRecords(source);
    if (rows.length === 0) {
      throw new NonRetriableError("Source variable must contain records");
    }

    const operator = data.operator ?? "eq";

    const filtered = await step.run("filter-data", async () => {
      const records = rows.filter((row) =>
        applyCsvPredicate(row, data.field as string, operator, data.value),
      );

      return buildSchemaAwareRecordsOutput(records, sourceSchema);
    });

    return {
      [data.variableName]: filtered,
    };
  });

type LoopData = {
  sourceVariable?: string;
  variableName?: string;
  offset?: number | string;
  limit?: number | string;
  mapField?: string;
  unique?: boolean;
  flatten?: boolean;
};

export const loopExecutor: NodeExecutor<LoopData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    const variableName = data.variableName?.trim() || "loopResult";
    const sourceReference = data.sourceVariable?.trim();

    let source = sourceReference
      ? resolveContextValue(context, sourceReference)
      : undefined;

    if (sourceReference && source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${sourceReference}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    if (source === undefined) {
      source = Object.values(context).find(
        (value) =>
          Array.isArray(value) ||
          (isPlainObject(value) && Array.isArray(value.records)),
      );
    }

    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `No list source found for loop node. Provide sourceVariable. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const output = await step.run("loop-data", async () => {
      const list = await resolveList(source);

      if (list.length > EXECUTION_LIMITS.MAX_IN_MEMORY_ROWS) {
        throw new NonRetriableError(
          `Loop source exceeds MAX_IN_MEMORY_ROWS (${EXECUTION_LIMITS.MAX_IN_MEMORY_ROWS}).`,
        );
      }

      const parsedOffset = parseNumber(data.offset);
      const parsedLimit = parseNumber(data.limit);

      const offset = Math.max(0, Math.floor(parsedOffset ?? 0));
      const limit =
        parsedLimit === null ? null : Math.max(0, Math.floor(parsedLimit));

      let records =
        limit === null
          ? list.slice(offset)
          : list.slice(offset, offset + limit);

      if (data.flatten) {
        records = records.flatMap((item) =>
          Array.isArray(item) ? item : [item],
        );
      }

      const mapField = data.mapField?.trim();
      if (mapField) {
        records = records.map((item) => {
          if (!isPlainObject(item)) {
            return undefined;
          }

          return getPathValue(item, mapField);
        });
      }

      if (data.unique) {
        const seen = new Set<string>();
        records = records.filter((item) => {
          const key = JSON.stringify(item);
          if (seen.has(key)) {
            return false;
          }

          seen.add(key);
          return true;
        });
      }

      return {
        records,
        sourceCount: list.length,
        rowCount: records.length,
        offset,
        limit,
      };
    });

    return {
      [variableName]: output.records,
      [`${variableName}_meta`]: {
        sourceVariable: sourceReference || null,
        sourceCount: output.sourceCount,
        rowCount: output.rowCount,
        offset: output.offset,
        limit: output.limit,
        mapField: data.mapField?.trim() || null,
        unique: Boolean(data.unique),
        flatten: Boolean(data.flatten),
      },
    };
  });

type ConditionOperator =
  | CsvOperator
  | "exists"
  | "not_exists"
  | "is_true"
  | "is_false"
  | "regex";

type ConditionData = {
  sourceVariable?: string;
  field?: string;
  operator?: ConditionOperator;
  value?: unknown;
  compareVariable?: string;
  variableName?: string;
  negate?: boolean;
};

const isEmptyValue = (value: unknown): boolean => {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
};

const evaluateConditionOperator = (
  operator: ConditionOperator,
  leftValue: unknown,
  rightValue: unknown,
): boolean => {
  if (operator === "exists") {
    return !isEmptyValue(leftValue);
  }

  if (operator === "not_exists") {
    return isEmptyValue(leftValue);
  }

  if (operator === "is_true") {
    return toBoolean(leftValue);
  }

  if (operator === "is_false") {
    return !toBoolean(leftValue);
  }

  if (operator === "regex") {
    if (typeof rightValue !== "string" || rightValue.trim().length === 0) {
      return false;
    }

    try {
      const regex = new RegExp(rightValue);
      return regex.test(String(leftValue ?? ""));
    } catch {
      return false;
    }
  }

  return applyCsvPredicate(
    {
      value: leftValue,
    },
    "value",
    operator,
    rightValue,
  );
};

export const conditionExecutor: NodeExecutor<ConditionData> = async ({
  data,
  nodeId,
  context,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    const variableName = data.variableName?.trim() || "conditionResult";
    const operator = data.operator ?? "eq";
    const sourceReference = data.sourceVariable?.trim();
    const fieldPath = data.field?.trim();

    const source = sourceReference
      ? resolveContextValue(context, sourceReference)
      : context;

    if (sourceReference && source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${sourceReference}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const leftValue = fieldPath
      ? sourceReference
        ? getPathValue(source, fieldPath)
        : resolveContextValue(context, fieldPath)
      : source;

    const rightValue = data.compareVariable?.trim()
      ? resolveContextValue(context, data.compareVariable)
      : data.value;

    if (data.compareVariable?.trim() && rightValue === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Comparison variable '${data.compareVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const output = await step.run("condition-check", async () => {
      const passed = evaluateConditionOperator(operator, leftValue, rightValue);
      const finalResult = data.negate ? !passed : passed;

      return {
        passed: finalResult,
        operator,
        negate: Boolean(data.negate),
      };
    });

    return {
      [variableName]: output.passed,
      [`${variableName}_meta`]: {
        sourceVariable: sourceReference || null,
        field: fieldPath || null,
        operator: output.operator,
        negate: output.negate,
        leftType: leftValue === null ? "null" : typeof leftValue,
        rightType: rightValue === null ? "null" : typeof rightValue,
      },
    };
  });

type DelayData = {
  variableName?: string;
  duration?: string;
  delayMs?: number | string;
  durationMs?: number | string;
  milliseconds?: number | string;
  seconds?: number | string;
  minutes?: number | string;
  maxDelayMs?: number | string;
};

const parseDurationToMs = (duration: string): number | null => {
  const trimmed = duration.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const match =
    /^(-?\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes)?$/.exec(
      trimmed,
    );

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }

  const unit = match[2] ?? "ms";
  if (["ms"].includes(unit)) {
    return amount;
  }

  if (["s", "sec", "secs", "second", "seconds"].includes(unit)) {
    return amount * 1000;
  }

  if (["m", "min", "mins", "minute", "minutes"].includes(unit)) {
    return amount * 60 * 1000;
  }

  return null;
};

export const delayExecutor: NodeExecutor<DelayData> = async ({
  data,
  nodeId,
  publish,
  step,
}) =>
  withFileNodeStatus(nodeId, publish, async () => {
    const variableName = data.variableName?.trim() || "delayResult";

    const durationFromText =
      typeof data.duration === "string"
        ? parseDurationToMs(data.duration)
        : null;
    const durationFromMs =
      parseNumber(data.delayMs) ??
      parseNumber(data.durationMs) ??
      parseNumber(data.milliseconds);
    const durationFromSeconds = parseNumber(data.seconds);
    const durationFromMinutes = parseNumber(data.minutes);

    const rawDurationMs =
      durationFromText ??
      durationFromMs ??
      (durationFromSeconds !== null ? durationFromSeconds * 1000 : null) ??
      (durationFromMinutes !== null ? durationFromMinutes * 60 * 1000 : null) ??
      0;

    const delayMs = Math.max(0, Math.floor(rawDurationMs));
    const maxDelayRaw = parseNumber(data.maxDelayMs);
    const maxDelayMs =
      maxDelayRaw === null
        ? 5 * 60 * 1000
        : Math.max(0, Math.floor(maxDelayRaw));

    if (delayMs > maxDelayMs) {
      throw new NonRetriableError(
        `Delay of ${delayMs}ms exceeds maxDelayMs (${maxDelayMs}ms).`,
      );
    }

    const output = await step.run("delay-execution", async () => {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }

      return {
        delayedMs: delayMs,
        resumedAt: new Date().toISOString(),
        skipped: delayMs === 0,
      };
    });

    return {
      [variableName]: output,
    };
  });

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
      throw new NonRetriableError(
        "Both left and right source variables are required",
      );
    }

    const leftSource = context[data.leftVariable];
    const rightSource = context[data.rightVariable];

    const strategy = data.strategy ?? "concat";

    const output = await step.run("merge-data", async () => {
      if (strategy === "concat") {
        const left = await resolveList(leftSource);
        const right = await resolveList(rightSource);

        return {
          records: [...left, ...right],
          rowCount: left.length + right.length,
          strategy,
        };
      }

      if (strategy === "zip") {
        const left = await resolveList(leftSource);
        const right = await resolveList(rightSource);
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

      const leftRecords = await resolveRecords(leftSource);
      const rightRecords = await resolveRecords(rightSource);

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
    const list = await resolveList(source);
    if (list.length === 0) {
      throw new NonRetriableError(
        "Source variable must contain an array or records list",
      );
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

export const googleDriveExecutor: NodeExecutor =
  pendingExecutor("google_drive");

export const dropboxExecutor: NodeExecutor = pendingExecutor("dropbox");

export const localStorageExecutor: NodeExecutor =
  pendingExecutor("local_storage");
