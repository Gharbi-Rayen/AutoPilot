"use client";

import { CheckIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NodeStatusLine } from "@/components/node-status-line";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  useExecutionDatasetDownload,
  useExecutionDatasetMeta,
  useExecutionDatasetPage,
} from "../hooks/use-executions";
import { ExecutionDatasetNavigation } from "./execution-dataset-navigation";

// ── cell helpers ──────────────────────────────────────────────────────────────

const stringifyCell = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

// ── export helpers ────────────────────────────────────────────────────────────

type ExportFormat = "csv" | "xlsx" | "txt";

/** Convert the raw delimiter string the user typed into the actual character(s). */
const parseDelimiter = (raw: string, fallback: string): string => {
  if (!raw.trim()) return fallback;
  // Support common escape sequences
  return raw.replace(/\\t/g, "\t").replace(/\\n/g, "\n");
};

const toCsvString = (
  rows: Record<string, unknown>[],
  cols: string[],
  delimiter = ",",
): string => {
  const csvEscape = (val: unknown): string => {
    const s = val === null || val === undefined ? "" : String(val);
    if (
      s.includes(delimiter) ||
      s.includes('"') ||
      s.includes("\n") ||
      s.includes("\r")
    ) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    cols.map((c) => csvEscape(c)).join(delimiter),
    ...rows.map((row) => cols.map((c) => csvEscape(row[c])).join(delimiter)),
  ];
  return lines.join("\n");
};

const toTxtString = (
  rows: Record<string, unknown>[],
  cols: string[],
  delimiter = "\t",
): string => {
  const clean = (val: unknown) =>
    (val === null || val === undefined ? "" : String(val)).replace(
      /[\n\r]/g,
      " ",
    );
  const lines = [
    cols.join(delimiter),
    ...rows.map((row) => cols.map((c) => clean(row[c])).join(delimiter)),
  ];
  return lines.join("\n");
};

const triggerDownload = (
  content: string | ArrayBuffer,
  name: string,
  mime: string,
): void => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── ExportDatasetDialog ───────────────────────────────────────────────────────

interface ExportDatasetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  executionId: string;
  variable: string;
  nodeId?: string;
  totalRows: number;
  columns: string[];
}

export const ExportDatasetDialog = ({
  open,
  onOpenChange,
  executionId,
  variable,
  nodeId,
  totalRows,
  columns,
}: ExportDatasetDialogProps) => {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [delimiter, setDelimiter] = useState(",");
  const [fileName, setFileName] = useState(variable);
  const [segmented, setSegmented] = useState(false);
  const [segmentMode, setSegmentMode] = useState<"count" | "rows">("count");
  const [chunkCount, setChunkCount] = useState(3);
  const [rowsPerSegment, setRowsPerSegment] = useState(50_000);
  const [exporting, setExporting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [done, setDone] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleFormatChange = (fmt: ExportFormat) => {
    setFormat(fmt);
    // Reset delimiter to the sensible default for each format
    if (fmt === "csv") setDelimiter(",");
    else if (fmt === "txt") setDelimiter("\\t");
  };

  const allRowsQuery = useExecutionDatasetDownload(
    executionId,
    variable,
    "json",
    nodeId,
    false,
  );

  useEffect(() => {
    if (!open) return;
    setFormat("csv");
    setDelimiter(",");
    setFileName(variable);
    setSegmented(false);
    setSegmentMode("count");
    setChunkCount(3);
    setRowsPerSegment(50_000);
    setExporting(false);
    setFeedback("");
    setDone(false);
    setHasError(false);
  }, [open, variable]);

  const buildContent = async (
    rows: Record<string, unknown>[],
    cols: string[],
    fmt: ExportFormat,
  ): Promise<string | ArrayBuffer> => {
    const resolvedDelimiter = parseDelimiter(
      delimiter,
      fmt === "txt" ? "\t" : ",",
    );
    if (fmt === "csv") return toCsvString(rows, cols, resolvedDelimiter);
    if (fmt === "txt") return toTxtString(rows, cols, resolvedDelimiter);
    const mod = await import("xlsx");
    const ws = mod.utils.json_to_sheet(rows, { header: cols });
    const wb = mod.utils.book_new();
    mod.utils.book_append_sheet(wb, ws, "Sheet1");
    return mod.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  };

  const getMime = (fmt: ExportFormat) => {
    if (fmt === "csv") return "text/csv;charset=utf-8;";
    if (fmt === "xlsx")
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return "text/plain;charset=utf-8;";
  };

  const handleExport = async () => {
    const rawName = (fileName.trim() || variable).replace(/[<>:"/\\|?*]/g, "_");
    const ext = format === "xlsx" ? "xlsx" : format;
    const mime = getMime(format);

    setExporting(true);
    setHasError(false);
    setDone(false);
    setFeedback("Fetching dataset rows…");

    try {
      const res = await allRowsQuery.refetch();
      if (!res.data) throw new Error("No payload returned");

      let allRows: Record<string, unknown>[];
      allRows = res.data.data as Record<string, unknown>[];

      const cols =
        columns.length > 0
          ? columns
          : allRows.length > 0
            ? Object.keys(allRows[0])
            : [];

      if (segmented && allRows.length > 0) {
        const n = segmentMode === "count"
          ? Math.min(Math.max(2, chunkCount), allRows.length)
          : Math.max(1, Math.ceil(allRows.length / Math.max(1, rowsPerSegment)));
        const chunkSize = Math.ceil(allRows.length / n);

        setFeedback(`Segmenting into ${n} files…`);
        await sleep(150);

        const chunks: Record<string, unknown>[][] = [];
        for (let i = 0; i < allRows.length; i += chunkSize) {
          chunks.push(allRows.slice(i, i + chunkSize));
        }

        for (let i = 0; i < chunks.length; i++) {
          setFeedback(`Packaging file ${i + 1} of ${chunks.length}…`);
          await sleep(60);
          const content = await buildContent(chunks[i], cols, format);
          triggerDownload(content, `${rawName}_${i + 1}.${ext}`, mime);
          await sleep(280);
        }
      } else {
        const fmtLabel =
          format === "xlsx" ? "Excel (.xlsx)" : format.toUpperCase();
        setFeedback(`Preparing ${fmtLabel} file…`);
        await sleep(80);
        const content = await buildContent(allRows, cols, format);
        setFeedback("Starting download…");
        await sleep(80);
        triggerDownload(content, `${rawName}.${ext}`, mime);
      }

      setFeedback("Export complete!");
      setDone(true);
      await sleep(1500);
      onOpenChange(false);
    } catch (err) {
      console.error("Dataset export failed", err);
      setFeedback("Export failed. Please try again.");
      setHasError(true);
    } finally {
      setExporting(false);
    }
  };

  const formatOptions: { key: ExportFormat; label: string; ext: string }[] = [
    { key: "csv", label: "CSV", ext: ".csv" },
    { key: "xlsx", label: "Excel", ext: ".xlsx" },
    { key: "txt", label: "TXT", ext: ".txt" },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!exporting) onOpenChange(val);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Dataset</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Format picker */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Format
            </p>
            <div className="grid grid-cols-3 gap-2">
              {formatOptions.map(({ key, label, ext }) => (
                <button
                  key={key}
                  type="button"
                  disabled={exporting}
                  onClick={() => handleFormatChange(key)}
                  className={cn(
                    "flex flex-col items-center rounded-lg border px-3 py-2.5 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                    format === key
                      ? "border-primary bg-primary/8 text-primary shadow-sm"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  <span className="font-semibold">{label}</span>
                  <span className="mt-0.5 text-[10px] opacity-60">{ext}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Delimiter — only relevant for CSV / TXT */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-200",
              format !== "xlsx"
                ? "max-h-20 opacity-100"
                : "max-h-0 opacity-0 pointer-events-none",
            )}
          >
            <div className="space-y-1.5">
              <Label
                htmlFor="export-delimiter"
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Delimiter
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="export-delimiter"
                  value={delimiter}
                  onChange={(e) => setDelimiter(e.target.value)}
                  disabled={exporting}
                  placeholder={format === "txt" ? "\\t" : ","}
                  className="h-8 w-24 font-mono text-sm"
                  maxLength={10}
                />
                <span className="text-xs text-muted-foreground">
                  Use{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                    \t
                  </code>{" "}
                  for tab
                </span>
              </div>
            </div>
          </div>

          {/* File name */}
          <div className="space-y-1.5">
            <Label
              htmlFor="export-file-name"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              File name
            </Label>
            <Input
              id="export-file-name"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder={variable}
              disabled={exporting}
              className="h-8 text-sm"
            />
          </div>

          {/* Size info + segment toggle */}
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3.5">
            <p className="text-xs text-muted-foreground">
              Your file is{" "}
              <span className="font-semibold text-foreground">
                {totalRows.toLocaleString()} rows &times; {columns.length} col
                {columns.length !== 1 ? "s" : ""}
              </span>
            </p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm leading-tight">
                Download in segments?
              </span>
              <Switch
                checked={segmented}
                onCheckedChange={setSegmented}
                disabled={exporting}
                className="data-[state=unchecked]:bg-zinc-300 dark:data-[state=unchecked]:bg-zinc-600"
              />
            </div>
          </div>

          {/* Segment options — animated reveal */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-200",
              segmented
                ? "max-h-40 opacity-100"
                : "max-h-0 opacity-0 pointer-events-none",
            )}
          >
            <div className="space-y-3 pb-0.5">
              {/* Mode toggle */}
              <div className="flex gap-1 rounded-md border p-0.5 w-fit">
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => setSegmentMode("count")}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
                    segmentMode === "count"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  # files
                </button>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => setSegmentMode("rows")}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
                    segmentMode === "rows"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  rows / file
                </button>
              </div>

              {/* Input + live preview */}
              {segmentMode === "count" ? (
                <div className="flex items-center gap-3">
                  <div className="space-y-1">
                    <Label
                      htmlFor="export-chunk-count"
                      className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      Number of files
                    </Label>
                    <Input
                      id="export-chunk-count"
                      type="number"
                      min={2}
                      max={100}
                      value={chunkCount}
                      onChange={(e) =>
                        setChunkCount(
                          Math.max(2, Math.min(100, Number.parseInt(e.target.value, 10) || 2)),
                        )
                      }
                      disabled={exporting}
                      className="h-8 w-24 text-sm"
                    />
                  </div>
                  {totalRows > 0 && (
                    <span className="mt-5 text-xs text-muted-foreground">
                      → ~{Math.ceil(totalRows / Math.min(chunkCount, totalRows)).toLocaleString()} rows each
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="space-y-1">
                    <Label
                      htmlFor="export-rows-per-segment"
                      className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      Rows per file
                    </Label>
                    <Input
                      id="export-rows-per-segment"
                      type="number"
                      min={1}
                      value={rowsPerSegment}
                      onChange={(e) =>
                        setRowsPerSegment(Math.max(1, Number.parseInt(e.target.value, 10) || 1))
                      }
                      disabled={exporting}
                      className="h-8 w-28 text-sm"
                    />
                  </div>
                  {totalRows > 0 && (
                    <span className="mt-5 text-xs text-muted-foreground">
                      → {Math.max(1, Math.ceil(totalRows / Math.max(1, rowsPerSegment))).toLocaleString()} files
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Feedback banner */}
          {feedback && (
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition-colors",
                done
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : hasError
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted/60 text-muted-foreground",
              )}
            >
              {done ? (
                <CheckIcon className="size-4 shrink-0" />
              ) : hasError ? (
                <span className="shrink-0 font-bold leading-none">!</span>
              ) : (
                <Loader2Icon className="size-4 shrink-0 animate-spin" />
              )}
              <span>{feedback}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={exporting || !fileName.trim()}
            onClick={handleExport}
          >
            {exporting ? (
              <>
                <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <DownloadIcon className="mr-1.5 size-3.5" />
                Export
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── ExecutionDatasetViewer ────────────────────────────────────────────────────

interface ExecutionDatasetViewerProps {
  executionId: string;
  variable: string;
  nodeId?: string;
  enabled: boolean;
  className?: string;
}

export const ExecutionDatasetViewer = ({
  executionId,
  variable,
  nodeId,
  enabled,
  className,
}: ExecutionDatasetViewerProps) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [exportOpen, setExportOpen] = useState(false);

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  const datasetIdentity = `${executionId}:${variable}`;

  useEffect(() => {
    if (!datasetIdentity) {
      return;
    }
    setPage(1);
  }, [datasetIdentity]);

  useEffect(() => {
    const table = tableScrollRef.current;
    const top = topScrollRef.current;
    if (!table || !top) return;

    const syncFromTable = () => { top.scrollLeft = table.scrollLeft; };
    const syncFromTop = () => { table.scrollLeft = top.scrollLeft; };

    table.addEventListener("scroll", syncFromTable);
    top.addEventListener("scroll", syncFromTop);
    return () => {
      table.removeEventListener("scroll", syncFromTable);
      top.removeEventListener("scroll", syncFromTop);
    };
  }, []);

  useEffect(() => {
    const table = tableScrollRef.current;
    if (!table) return;
    const observer = new ResizeObserver(() => {
      setTableScrollWidth(table.scrollWidth);
    });
    observer.observe(table);
    return () => observer.disconnect();
  }, []);

  const datasetMetaQuery = useExecutionDatasetMeta(
    executionId,
    variable,
    nodeId,
    enabled,
  );

  const datasetPageQuery = useExecutionDatasetPage(
    executionId,
    variable,
    page,
    pageSize,
    nodeId,
    enabled && datasetMetaQuery.isSuccess,
  );

  const rows = datasetPageQuery.data?.rows ?? [];
  const totalRows =
    datasetMetaQuery.data?.rowCount ?? datasetPageQuery.data?.totalRows ?? 0;
  const totalPages =
    datasetPageQuery.data?.totalPages ??
    (totalRows === 0 ? 0 : Math.ceil(totalRows / pageSize));

  const columns = useMemo(() => {
    const schemaColumns = Object.keys(datasetMetaQuery.data?.schema ?? {});
    if (schemaColumns.length > 0) {
      return schemaColumns;
    }

    if (rows.length === 0) {
      return [];
    }

    const discovered = new Set<string>();

    for (const row of rows) {
      for (const key of Object.keys(row)) {
        discovered.add(key);
      }
    }

    return Array.from(discovered);
  }, [datasetMetaQuery.data?.schema, rows]);

  const chunkHint: string | undefined = undefined;

  if (!enabled) {
    return null;
  }

  if (datasetMetaQuery.isFetching && !datasetMetaQuery.data) {
    return <NodeStatusLine text="Loading dataset…" className={className} />;
  }

  if (datasetMetaQuery.isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load dataset metadata.
      </div>
    );
  }

  return (
    <div className={cn("min-w-0 w-full", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {totalRows} rows, {datasetMetaQuery.data?.chunkCount ?? 0} chunk(s)
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => setExportOpen(true)}
        >
          <DownloadIcon className="size-3.5" />
          Export
        </Button>
      </div>

      <ExecutionDatasetNavigation
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        totalRows={totalRows}
        isPending={datasetPageQuery.isFetching}
        chunkHint={chunkHint}
        onPageChange={(nextPage) => {
          if (nextPage < 1) {
            return;
          }

          if (totalPages > 0 && nextPage > totalPages) {
            return;
          }

          setPage(nextPage);
        }}
        onPageSizeChange={(nextPageSize) => {
          if (nextPageSize === pageSize) {
            return;
          }

          setPageSize(nextPageSize);
          setPage(1);
        }}
      />

      <div className="mt-3 rounded-md border bg-background/80 p-2">
        {datasetPageQuery.isFetching && !datasetPageQuery.data ? (
          <NodeStatusLine
            text="Loading rows…"
            className="border-none bg-transparent"
          />
        ) : rows.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">
            No rows on this page.
          </p>
        ) : (
          <>
            {/* Top scrollbar mirror */}
            <div
              ref={topScrollRef}
              className="overflow-x-auto overflow-y-hidden"
              style={{ height: 12 }}
            >
              <div style={{ width: tableScrollWidth, height: 1 }} />
            </div>

            <div ref={tableScrollRef} className="overflow-auto max-h-[40vh]">
              <Table className="min-w-max">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70px]">#</TableHead>
                    {columns.map((column) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => {
                    const absoluteIndex =
                      (page - 1) * pageSize + index + 1;

                    return (
                      <TableRow key={absoluteIndex}>
                        <TableCell className="text-muted-foreground">
                          {absoluteIndex}
                        </TableCell>
                        {columns.map((column) => {
                          const renderedValue = stringifyCell(row[column]);
                          return (
                            <TableCell
                              key={`${absoluteIndex}-${column}`}
                              className="max-w-[220px] truncate"
                              title={renderedValue}
                            >
                              {renderedValue}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      <ExportDatasetDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        executionId={executionId}
        variable={variable}
        nodeId={nodeId}
        totalRows={totalRows}
        columns={columns}
      />
    </div>
  );
};
