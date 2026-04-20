"use client";

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDotIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  MinusCircleIcon,
  PlusCircleIcon,
  RefreshCwIcon,
  ShuffleIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { NodeStatusLine } from "@/components/node-status-line";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ExecutionDatasetViewer } from "./execution-dataset-viewer";

// ── types ─────────────────────────────────────────────────────────────────────

export interface CompareResult {
  _compareResult: true;
  isIdentical: boolean;
  // schema info
  schemaAligned?: boolean;
  headerMismatchDetected?: boolean;
  columnMapping?: Record<string, string> | null;
  columnsInBase?: number;
  columnsInCompare?: number;
  columnsInBoth?: number;
  columnsOnlyInBase?: number;
  columnsOnlyInCompare?: number;
  // row counts
  totalBaseRows?: number;
  totalCompareRows?: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  commonCount?: number;
  unchangedCount: number;
  changedDiffRowCount: number;
  // misc
  summary: string;
  keyField: string | null;
  compareFields: string[];
  // variable names
  addedVarName: string | null;
  removedVarName: string | null;
  changedVarName: string | null;
  commonVarName?: string | null;
  schemaDiffVarName?: string | null;
}

type Tab = "added" | "removed" | "changed" | "common";

// ── pagination helpers ────────────────────────────────────────────────────────

function buildPageTokens(current: number, total: number): Array<number | null> {
  if (total <= 1) return [];
  const visible = new Set<number>([1, total]);
  for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) {
    visible.add(i);
  }
  const sorted = Array.from(visible).sort((a, b) => a - b);
  const tokens: Array<number | null> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) tokens.push(null);
    tokens.push(sorted[i]);
  }
  return tokens;
}

const PAGE_SIZES = [25, 50, 100, 250] as const;

const stringify = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
};

// ── CompareChangedTable ───────────────────────────────────────────────────────

interface CompareChangedTableProps {
  executionId: string;
  variable: string;
  nodeId: string;
  leftLabel: string;
  rightLabel: string;
}

const CompareChangedTable = ({
  executionId,
  variable,
  nodeId,
  leftLabel,
  rightLabel,
}: CompareChangedTableProps) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const tableRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const metaQuery = useExecutionDatasetMeta(executionId, variable, nodeId, true);
  const pageQuery = useExecutionDatasetPage(executionId, variable, page, pageSize, nodeId, metaQuery.isSuccess);

  const rows = pageQuery.data?.rows ?? [];
  const totalRows = metaQuery.data?.rowCount ?? pageQuery.data?.totalRows ?? 0;
  const totalPages = pageQuery.data?.totalPages ?? (totalRows === 0 ? 0 : Math.ceil(totalRows / pageSize));

  const allColumns = useMemo(() => {
    const schema = metaQuery.data?.schema ?? {};
    const fromSchema = Object.keys(schema);
    if (fromSchema.length > 0) return fromSchema;
    const discovered = new Set<string>();
    for (const row of rows) for (const k of Object.keys(row)) discovered.add(k);
    return Array.from(discovered);
  }, [metaQuery.data?.schema, rows]);

  const beforeCols = useMemo(() => allColumns.filter((c) => c.startsWith("_before_")), [allColumns]);
  const afterCols = useMemo(() => allColumns.filter((c) => c.startsWith("_after_")), [allColumns]);
  const hasDiffKey = allColumns.includes("_diff_key");
  const tokens = buildPageTokens(page, totalPages);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setTableScrollWidth(el.scrollWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const table = tableRef.current;
    const top = topRef.current;
    if (!table || !top) return;
    const fromTable = () => { top.scrollLeft = table.scrollLeft; };
    const fromTop = () => { table.scrollLeft = top.scrollLeft; };
    table.addEventListener("scroll", fromTable);
    top.addEventListener("scroll", fromTop);
    return () => {
      table.removeEventListener("scroll", fromTable);
      top.removeEventListener("scroll", fromTop);
    };
  }, []);

  if (metaQuery.isFetching && !metaQuery.data) {
    return <NodeStatusLine text="Loading…" className="border-none bg-transparent" />;
  }
  if (metaQuery.isError) {
    return <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Failed to load comparison data.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md border border-border bg-background/70 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">Page {totalPages === 0 ? 0 : page} of {Math.max(totalPages, 1)}</span>
          <span className="text-[11px] text-muted-foreground">{totalRows.toLocaleString()} rows total</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page <= 1 || pageQuery.isFetching} onClick={() => setPage(page - 1)}>
            <ChevronLeftIcon className="size-3.5" /> Previous
          </Button>
          {tokens.map((token, i) =>
            token === null ? (
              <span key={`ellipsis-before-${tokens[i + 1] ?? i}`} className="flex h-7 w-6 items-center justify-center text-xs text-muted-foreground select-none">…</span>
            ) : (
              <Button key={token} type="button" size="sm" variant={token === page ? "default" : "outline"} className={cn("h-7 min-w-[28px] px-1.5 text-xs tabular-nums", token === page && "pointer-events-none shadow-none")} onClick={() => setPage(token)} disabled={pageQuery.isFetching}>{token}</Button>
            ),
          )}
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page >= totalPages || pageQuery.isFetching} onClick={() => setPage(page + 1)}>
            Next <ChevronRightIcon className="size-3.5" />
          </Button>
          <div className="ml-auto flex items-center gap-1">
            {PAGE_SIZES.map((opt) => (
              <Button key={opt} type="button" size="sm" variant={opt === pageSize ? "default" : "outline"} className={cn("h-7 px-2 text-xs", opt === pageSize && "pointer-events-none shadow-none")} onClick={() => { setPageSize(opt); setPage(1); }} disabled={pageQuery.isFetching}>{opt}</Button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 rounded-md border border-border bg-muted/20 px-3 py-2">
        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">− <span className="font-normal">{leftLabel}</span></span>
        <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">+ <span className="font-normal">{rightLabel}</span></span>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-200/80 border border-amber-400/60" />
          <span className="text-[11px] text-muted-foreground">Changed cell</span>
        </div>
      </div>

      <div className="rounded-md border border-border bg-background/80 overflow-hidden">
        {pageQuery.isFetching && !pageQuery.data ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Loading rows…</div>
        ) : rows.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No rows on this page.</p>
        ) : (
          <>
            <div ref={topRef} className="overflow-x-auto overflow-y-hidden" style={{ height: 12 }}>
              <div style={{ width: tableScrollWidth, height: 1 }} />
            </div>
            <div ref={tableRef} className="overflow-auto max-h-[45vh]">
              <Table className="min-w-max text-xs">
                <TableHeader>
                  <TableRow>
                    {hasDiffKey && <TableHead rowSpan={2} className="border-r border-border align-middle text-center text-[10px] font-semibold uppercase tracking-wide bg-muted/40 w-[80px]">Row</TableHead>}
                    {beforeCols.length > 0 && <TableHead colSpan={beforeCols.length} className="border-b border-emerald-300/60 border-r border-r-emerald-300/60 bg-emerald-50/80 text-center text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">{leftLabel}</TableHead>}
                    {afterCols.length > 0 && <TableHead colSpan={afterCols.length} className="border-b border-red-300/60 bg-red-50/80 text-center text-[11px] font-semibold text-red-600 dark:bg-red-950/30 dark:text-red-400">{rightLabel}</TableHead>}
                  </TableRow>
                  <TableRow>
                    {beforeCols.map((col, i) => (
                      <TableHead key={col} className={cn("bg-emerald-50/50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 text-[10px] font-medium", i === beforeCols.length - 1 && "border-r border-r-emerald-200/60 dark:border-r-emerald-800/40")}>
                        {col.slice(8)}
                      </TableHead>
                    ))}
                    {afterCols.map((col) => (
                      <TableHead key={col} className="bg-red-50/50 text-red-600 dark:bg-red-950/20 dark:text-red-400 text-[10px] font-medium">{col.slice(7)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, idx) => {
                    const absoluteIdx = (page - 1) * pageSize + idx + 1;
                    const changedSet = new Set(String(row._diff_changed ?? "").split(",").filter(Boolean));
                    return (
                      <TableRow key={absoluteIdx}>
                        {hasDiffKey && <TableCell className="border-r border-border text-center text-[10px] text-muted-foreground font-mono bg-muted/10 max-w-[100px] truncate" title={String(row._diff_key ?? "")}>{String(row._diff_key ?? absoluteIdx)}</TableCell>}
                        {beforeCols.map((col, i) => {
                          const fieldName = col.slice(8);
                          const isChanged = changedSet.has(fieldName);
                          const val = stringify(row[col]);
                          return <TableCell key={col} title={val} className={cn("max-w-[180px] truncate", i === beforeCols.length - 1 && "border-r border-r-emerald-200/60 dark:border-r-emerald-800/40", isChanged ? "bg-emerald-50/60 dark:bg-emerald-950/20 font-medium" : "bg-emerald-50/30 dark:bg-emerald-950/10")}>{val}</TableCell>;
                        })}
                        {afterCols.map((col) => {
                          const fieldName = col.slice(7);
                          const isChanged = changedSet.has(fieldName);
                          const val = stringify(row[col]);
                          return <TableCell key={col} title={val} className={cn("max-w-[180px] truncate", isChanged ? "bg-red-50/60 dark:bg-red-950/20 font-medium" : "bg-red-50/30 dark:bg-red-950/10")}>{val}</TableCell>;
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
    </div>
  );
};

// ── StatPill ──────────────────────────────────────────────────────────────────

interface StatPillProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  active?: boolean;
  colorClass: string;
  bgClass: string;
  borderClass: string;
  onClick?: () => void;
}

const StatPill = ({ icon, label, count, active, colorClass, bgClass, borderClass, onClick }: StatPillProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick || count === 0}
    className={cn(
      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all",
      "disabled:pointer-events-none disabled:opacity-40",
      active ? `${bgClass} ${borderClass} shadow-sm` : "border-border bg-muted/20 hover:bg-muted/40",
    )}
  >
    <span className={cn("shrink-0", active ? colorClass : "text-muted-foreground")}>{icon}</span>
    <span className="flex flex-col leading-none min-w-0">
      <span className={cn("text-base font-semibold tabular-nums", active ? colorClass : "text-foreground")}>{count.toLocaleString()}</span>
      <span className="mt-0.5 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
    </span>
  </button>
);

// ── InfoGrid ──────────────────────────────────────────────────────────────────

const InfoRow = ({ label, value, muted }: { label: string; value: string | number; muted?: boolean }) => (
  <div className="flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-0">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    <span className={cn("text-[11px] font-medium tabular-nums", muted && "text-muted-foreground")}>{typeof value === "number" ? value.toLocaleString() : value}</span>
  </div>
);

// ── ExportLink ────────────────────────────────────────────────────────────────

interface ExportLinkProps {
  label: string;
  varName: string | null | undefined;
  executionId: string;
  nodeId: string;
  icon?: React.ReactNode;
}

const ExportLink = ({ label, varName, executionId, nodeId, icon }: ExportLinkProps) => {
  const [open, setOpen] = useState(false);
  const meta = useExecutionDatasetMeta(executionId, varName ?? "", nodeId, Boolean(varName));

  const disabled = !varName || !meta.data;
  const totalRows = meta.data?.rowCount ?? 0;
  const columns = meta.data?.schema ? Object.keys(meta.data.schema) : [];

  if (disabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5
          text-xs font-medium text-foreground hover:bg-muted/60 hover:border-primary/50
          transition-all duration-150 cursor-pointer group"
      >
        {icon ?? <FileTextIcon className="size-3.5 text-muted-foreground group-hover:text-primary transition-colors" />}
        <span>{label}</span>
        <DownloadIcon className="size-3 text-muted-foreground group-hover:text-primary transition-colors ml-0.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Export — {label}</DialogTitle>
            <DialogDescription>
              {totalRows.toLocaleString()} rows · {columns.length} columns
            </DialogDescription>
          </DialogHeader>
          <InlineExportPanel
            executionId={executionId}
            variable={varName ?? ""}
            nodeId={nodeId}
            totalRows={totalRows}
            columns={columns}
            onClose={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

// ── InlineExportPanel ─────────────────────────────────────────────────────────

type ExportFormat = "csv" | "xlsx" | "txt";

const toCsvString = (rows: Record<string, unknown>[], cols: string[], delimiter: string) => {
  const escapeCell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (s.includes('"') || s.includes(delimiter) || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = cols.map(escapeCell).join(delimiter);
  const body = rows.map((r) => cols.map((c) => escapeCell(r[c])).join(delimiter)).join("\n");
  return `${header}\n${body}`;
};

const triggerDownload = (content: string | ArrayBuffer, mime: string, name: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

interface InlineExportPanelProps {
  executionId: string;
  variable: string;
  nodeId: string;
  totalRows: number;
  columns: string[];
  onClose: () => void;
}

const InlineExportPanel = ({ executionId, variable, nodeId, totalRows, columns, onClose }: InlineExportPanelProps) => {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [fileName, setFileName] = useState(variable);
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);

  const dlQuery = useExecutionDatasetDownload(executionId, variable, "json", nodeId, false);

  const handleExport = async () => {
    setExporting(true);
    setDone(false);
    try {
      const result = await dlQuery.refetch();
      const rows = (result.data?.data ?? []) as Record<string, unknown>[];
      const cols = columns.length > 0 ? columns : (rows[0] ? Object.keys(rows[0]) : []);
      const safe = fileName.replace(/[^\w\-. ]/g, "_") || variable;

      if (format === "csv" || format === "txt") {
        const delim = format === "txt" ? "\t" : ",";
        const content = toCsvString(rows, cols, delim);
        const mime = format === "csv" ? "text/csv;charset=utf-8;" : "text/plain;charset=utf-8;";
        triggerDownload(content, mime, `${safe}.${format}`);
      } else {
        const mod = await import("xlsx");
        const ws = mod.utils.json_to_sheet(rows, { header: cols });
        const wb = mod.utils.book_new();
        mod.utils.book_append_sheet(wb, ws, "Sheet1");
        const buf = mod.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
        triggerDownload(buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${safe}.xlsx`);
      }
      setDone(true);
    } catch {
      // ignore
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="grid grid-cols-3 gap-2">
        {(["csv", "xlsx", "txt"] as ExportFormat[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFormat(f)}
            className={cn(
              "rounded-md border px-3 py-2 text-xs font-medium transition-all",
              format === f ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/20 hover:bg-muted/40",
            )}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="export-filename" className="text-xs font-medium text-muted-foreground">File name</label>
        <input
          id="export-filename"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary transition-colors"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{totalRows.toLocaleString()} rows · {columns.length} columns</span>
        {done && <span className="text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2Icon className="size-3.5" /> Downloaded</span>}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button type="button" className="flex-1" onClick={handleExport} disabled={exporting}>
          {exporting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          <DownloadIcon className="mr-2 size-4" /> Export
        </Button>
      </div>
    </div>
  );
};

// ── ExecutionCompareViewer ────────────────────────────────────────────────────

interface ExecutionCompareViewerProps {
  result: CompareResult;
  executionId: string;
  nodeId: string;
  leftLabel?: string;
  rightLabel?: string;
}

export const ExecutionCompareViewer = ({
  result,
  executionId,
  nodeId,
  leftLabel = "File A",
  rightLabel = "File B",
}: ExecutionCompareViewerProps) => {
  const commonCount = result.commonCount ?? result.unchangedCount;
  const hasCommon = commonCount > 0 && Boolean(result.commonVarName);

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (result.addedCount > 0) return "added";
    if (result.removedCount > 0) return "removed";
    if (result.changedCount > 0) return "changed";
    return "common";
  });

  const tabs: { id: Tab; label: string; count: number; icon: React.ReactNode; colorClass: string }[] = [
    { id: "added",   label: "Added",    count: result.addedCount,   icon: <PlusCircleIcon className="size-3.5" />,  colorClass: "text-emerald-600 dark:text-emerald-400" },
    { id: "removed", label: "Removed",  count: result.removedCount, icon: <MinusCircleIcon className="size-3.5" />, colorClass: "text-red-500 dark:text-red-400" },
    { id: "changed", label: "Changed",  count: result.changedCount, icon: <RefreshCwIcon className="size-3.5" />,   colorClass: "text-amber-600 dark:text-amber-400" },
    { id: "common",  label: "Common",   count: commonCount,          icon: <CircleCheckIcon className="size-3.5" />, colorClass: "text-blue-500 dark:text-blue-400" },
  ];

  const headerMismatch = result.headerMismatchDetected ?? false;
  const schemaAligned = result.schemaAligned ?? true;

  return (
    <div className="space-y-4">

      {/* ── Report header ── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Comparison Report</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            <span className="font-medium">{leftLabel}</span> vs <span className="font-medium">{rightLabel}</span>
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-xs",
            result.isIdentical
              ? "border-emerald-300/70 bg-emerald-50/60 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-400"
              : "border-amber-300/70 bg-amber-50/60 text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-400",
          )}
        >
          {result.isIdentical ? "Identical" : "Differences found"}
        </Badge>
      </div>

      {/* ── Schema / header-mismatch notice ── */}
      {headerMismatch && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200/70 bg-amber-50/50 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/30">
          <ShuffleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Header mismatch auto-resolved</p>
            <p className="mt-0.5 text-[11px] text-amber-600/80 dark:text-amber-500/80">
              One file appears to have been parsed without headers. Columns were aligned by position for comparison.
            </p>
          </div>
        </div>
      )}

      {!schemaAligned && !headerMismatch && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold text-foreground">Column names differ</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Columns were matched by position. Download the schema diff for details.</p>
          </div>
        </div>
      )}

      {/* ── Info grid ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-muted/10 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">{leftLabel}</p>
          <InfoRow label="Rows" value={result.totalBaseRows ?? "—"} />
          <InfoRow label="Columns" value={result.columnsInBase ?? "—"} />
        </div>
        <div className="rounded-lg border border-border bg-muted/10 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">{rightLabel}</p>
          <InfoRow label="Rows" value={result.totalCompareRows ?? "—"} />
          <InfoRow label="Columns" value={result.columnsInCompare ?? "—"} />
        </div>
      </div>

      {/* ── Column stats (when schema info available) ── */}
      {(result.columnsInBoth !== undefined) && (
        <div className="rounded-lg border border-border bg-muted/10 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Schema</p>
          <div className="flex flex-wrap gap-3">
            <span className="text-[11px]"><span className="font-semibold tabular-nums">{result.columnsInBoth}</span> <span className="text-muted-foreground">shared</span></span>
            {(result.columnsOnlyInBase ?? 0) > 0 && (
              <span className="text-[11px]"><span className="font-semibold tabular-nums text-amber-600">{result.columnsOnlyInBase}</span> <span className="text-muted-foreground">only in {leftLabel}</span></span>
            )}
            {(result.columnsOnlyInCompare ?? 0) > 0 && (
              <span className="text-[11px]"><span className="font-semibold tabular-nums text-amber-600">{result.columnsOnlyInCompare}</span> <span className="text-muted-foreground">only in {rightLabel}</span></span>
            )}
            {result.keyField && (
              <span className="text-[11px] text-muted-foreground">keyed by <span className="font-mono text-primary">{result.keyField}</span></span>
            )}
          </div>
        </div>
      )}

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill
          icon={<PlusCircleIcon className="size-4" />} label="Added" count={result.addedCount}
          active={activeTab === "added"} colorClass="text-emerald-600 dark:text-emerald-400"
          bgClass="bg-emerald-50/60 dark:bg-emerald-950/30" borderClass="border-emerald-300/70 dark:border-emerald-700/60"
          onClick={result.addedCount > 0 ? () => setActiveTab("added") : undefined}
        />
        <StatPill
          icon={<MinusCircleIcon className="size-4" />} label="Removed" count={result.removedCount}
          active={activeTab === "removed"} colorClass="text-red-500 dark:text-red-400"
          bgClass="bg-red-50/60 dark:bg-red-950/30" borderClass="border-red-300/70 dark:border-red-700/60"
          onClick={result.removedCount > 0 ? () => setActiveTab("removed") : undefined}
        />
        <StatPill
          icon={<RefreshCwIcon className="size-4" />} label="Changed" count={result.changedCount}
          active={activeTab === "changed"} colorClass="text-amber-600 dark:text-amber-400"
          bgClass="bg-amber-50/60 dark:bg-amber-950/30" borderClass="border-amber-300/70 dark:border-amber-700/60"
          onClick={result.changedCount > 0 ? () => setActiveTab("changed") : undefined}
        />
        <StatPill
          icon={<CircleCheckIcon className="size-4" />} label="Common" count={commonCount}
          active={activeTab === "common"} colorClass="text-blue-500 dark:text-blue-400"
          bgClass="bg-blue-50/60 dark:bg-blue-950/30" borderClass="border-blue-300/70 dark:border-blue-700/60"
          onClick={hasCommon ? () => setActiveTab("common") : undefined}
        />
      </div>

      {/* ── Identical banner ── */}
      {result.isIdentical && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200/70 bg-emerald-50/50 px-4 py-3 dark:border-emerald-800/50 dark:bg-emerald-950/30">
          <CircleCheckIcon className="size-4 shrink-0 text-emerald-500" />
          <div>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Datasets are identical</p>
            <p className="mt-0.5 text-[11px] text-emerald-600/70 dark:text-emerald-500/70">
              {commonCount.toLocaleString()} matching row{commonCount !== 1 ? "s" : ""}
              {headerMismatch && " (after schema auto-alignment)"}
            </p>
          </div>
        </div>
      )}

      {/* ── Tab panel ── */}
      <div className="rounded-lg border border-border bg-background/50 overflow-hidden">
        <div className="flex items-center border-b border-border overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id} type="button"
              disabled={tab.count === 0}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors shrink-0",
                "disabled:pointer-events-none disabled:opacity-35",
                activeTab === tab.id
                  ? `border-primary ${tab.colorClass}`
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              <span className={activeTab === tab.id ? tab.colorClass : ""}>{tab.icon}</span>
              <span>{tab.label}</span>
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums", activeTab === tab.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                {tab.count.toLocaleString()}
              </span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3 px-4 text-[10px] text-muted-foreground shrink-0">
            <span className="flex items-center gap-1"><span className="font-bold text-red-500">−</span>{leftLabel}</span>
            <span className="flex items-center gap-1"><span className="font-bold text-emerald-500">+</span>{rightLabel}</span>
          </div>
        </div>

        <div className="p-3">
          {activeTab === "added" && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <PlusCircleIcon className="size-3.5 shrink-0" />
                Rows in <span className="font-semibold">{rightLabel}</span> not found in <span className="font-semibold">{leftLabel}</span>
              </p>
              {result.addedVarName ? (
                <ExecutionDatasetViewer executionId={executionId} variable={result.addedVarName} nodeId={nodeId} enabled />
              ) : (
                <p className="text-[11px] text-muted-foreground px-1">No rows to display.</p>
              )}
            </div>
          )}

          {activeTab === "removed" && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-red-500 dark:text-red-400">
                <MinusCircleIcon className="size-3.5 shrink-0" />
                Rows in <span className="font-semibold">{leftLabel}</span> not found in <span className="font-semibold">{rightLabel}</span>
              </p>
              {result.removedVarName ? (
                <ExecutionDatasetViewer executionId={executionId} variable={result.removedVarName} nodeId={nodeId} enabled />
              ) : (
                <p className="text-[11px] text-muted-foreground px-1">No rows to display.</p>
              )}
            </div>
          )}

          {activeTab === "changed" && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <RefreshCwIcon className="size-3.5 shrink-0" />
                Rows with differing values — both files shown side by side, changed cells highlighted
              </p>
              {result.changedVarName ? (
                <CompareChangedTable executionId={executionId} variable={result.changedVarName} nodeId={nodeId} leftLabel={leftLabel} rightLabel={rightLabel} />
              ) : (
                <p className="text-[11px] text-muted-foreground px-1">No differences to display.</p>
              )}
            </div>
          )}

          {activeTab === "common" && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-blue-500 dark:text-blue-400">
                <CircleCheckIcon className="size-3.5 shrink-0" />
                Rows identical in both <span className="font-semibold">{leftLabel}</span> and <span className="font-semibold">{rightLabel}</span>
              </p>
              {result.commonVarName ? (
                <ExecutionDatasetViewer executionId={executionId} variable={result.commonVarName} nodeId={nodeId} enabled />
              ) : (
                <p className="text-[11px] text-muted-foreground px-1">No common rows to display.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Export section ── */}
      <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <DownloadIcon className="size-4 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Download results</p>
        </div>
        <p className="text-[11px] text-muted-foreground">Click any file to configure and export it.</p>
        <div className="flex flex-wrap gap-2">
          <ExportLink
            label="common_rows.csv"
            varName={result.commonVarName}
            executionId={executionId}
            nodeId={nodeId}
            icon={<CircleCheckIcon className="size-3.5 text-blue-500" />}
          />
          <ExportLink
            label="added_rows.csv"
            varName={result.addedVarName}
            executionId={executionId}
            nodeId={nodeId}
            icon={<PlusCircleIcon className="size-3.5 text-emerald-600" />}
          />
          <ExportLink
            label="removed_rows.csv"
            varName={result.removedVarName}
            executionId={executionId}
            nodeId={nodeId}
            icon={<MinusCircleIcon className="size-3.5 text-red-500" />}
          />
          <ExportLink
            label="changed_rows.csv"
            varName={result.changedVarName}
            executionId={executionId}
            nodeId={nodeId}
            icon={<RefreshCwIcon className="size-3.5 text-amber-600" />}
          />
          <ExportLink
            label="schema_diff.csv"
            varName={result.schemaDiffVarName}
            executionId={executionId}
            nodeId={nodeId}
            icon={<CircleDotIcon className="size-3.5 text-muted-foreground" />}
          />
        </div>
      </div>

    </div>
  );
};
