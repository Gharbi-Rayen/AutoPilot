"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDotIcon,
  Loader2Icon,
  MinusCircleIcon,
  PlusCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { NodeStatusLine } from "@/components/node-status-line";
import { Button } from "@/components/ui/button";
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
  useExecutionDatasetMeta,
  useExecutionDatasetPage,
} from "../hooks/use-executions";
import { ExecutionDatasetViewer } from "./execution-dataset-viewer";

// ── types ─────────────────────────────────────────────────────────────────────

export interface CompareResult {
  _compareResult: true;
  isIdentical: boolean;
  summary: string;
  keyField: string | null;
  compareFields: string[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
  changedDiffRowCount: number;
  addedVarName: string | null;
  removedVarName: string | null;
  changedVarName: string | null;
}

type Tab = "added" | "removed" | "changed";

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

// ── CompareChangedTable ───────────────────────────────────────────────────────
// Custom paginated table that renders _before_* columns in green and
// _after_* columns in red, one row per comparison pair.

interface CompareChangedTableProps {
  executionId: string;
  variable: string;
  nodeId: string;
  leftLabel: string;
  rightLabel: string;
}

const stringify = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
};

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
  const pageQuery = useExecutionDatasetPage(
    executionId,
    variable,
    page,
    pageSize,
    nodeId,
    metaQuery.isSuccess,
  );

  const rows = pageQuery.data?.rows ?? [];
  const totalRows = metaQuery.data?.rowCount ?? pageQuery.data?.totalRows ?? 0;
  const totalPages =
    pageQuery.data?.totalPages ??
    (totalRows === 0 ? 0 : Math.ceil(totalRows / pageSize));

  // Discover columns from schema or first rows
  const allColumns = useMemo(() => {
    const schema = metaQuery.data?.schema ?? {};
    const fromSchema = Object.keys(schema);
    if (fromSchema.length > 0) return fromSchema;
    const discovered = new Set<string>();
    for (const row of rows) for (const k of Object.keys(row)) discovered.add(k);
    return Array.from(discovered);
  }, [metaQuery.data?.schema, rows]);

  const beforeCols = useMemo(
    () => allColumns.filter((c) => c.startsWith("_before_")),
    [allColumns],
  );
  const afterCols = useMemo(
    () => allColumns.filter((c) => c.startsWith("_after_")),
    [allColumns],
  );
  const hasDiffKey = allColumns.includes("_diff_key");

  const tokens = buildPageTokens(page, totalPages);

  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  // Keep top mirror width in sync with table scroll width
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setTableScrollWidth(el.scrollWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Sync horizontal scroll between mirror bar and table
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
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load comparison data.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Header info ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {totalRows.toLocaleString()} rows, {metaQuery.data?.chunkCount ?? 0} chunk(s)
        </p>
      </div>

      {/* ── Pagination ── */}
      <div className="space-y-2 rounded-md border border-border bg-background/70 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            Page {totalPages === 0 ? 0 : page} of {Math.max(totalPages, 1)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {totalRows.toLocaleString()} rows total
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button" size="sm" variant="outline"
            className="h-7 px-2 text-xs"
            disabled={page <= 1 || pageQuery.isFetching}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeftIcon className="size-3.5" /> Previous
          </Button>

          {tokens.map((token, i) =>
            token === null ? (
              <span key={`ellipsis-before-${tokens[i + 1]}`} className="flex h-7 w-6 items-center justify-center text-xs text-muted-foreground select-none">…</span>
            ) : (
              <Button
                key={token} type="button" size="sm"
                variant={token === page ? "default" : "outline"}
                className={cn("h-7 min-w-[28px] px-1.5 text-xs tabular-nums", token === page && "pointer-events-none shadow-none")}
                onClick={() => setPage(token)}
                disabled={pageQuery.isFetching}
              >
                {token}
              </Button>
            ),
          )}

          <Button
            type="button" size="sm" variant="outline"
            className="h-7 px-2 text-xs"
            disabled={page >= totalPages || pageQuery.isFetching}
            onClick={() => setPage(page + 1)}
          >
            Next <ChevronRightIcon className="size-3.5" />
          </Button>

          <div className="ml-auto flex items-center gap-1">
            {PAGE_SIZES.map((opt) => (
              <Button
                key={opt} type="button" size="sm"
                variant={opt === pageSize ? "default" : "outline"}
                className={cn("h-7 px-2 text-xs", opt === pageSize && "pointer-events-none shadow-none")}
                onClick={() => { setPageSize(opt); setPage(1); }}
                disabled={pageQuery.isFetching}
              >
                {opt}
              </Button>
            ))}
          </div>
        </div>
        {pageQuery.data?.window && (
          <p className="text-[11px] text-muted-foreground">
            Chunk {pageQuery.data.window.chunkIndex} at offset {pageQuery.data.window.offset}
          </p>
        )}
      </div>

      {/* ── Column group legend ── */}
      <div className="flex items-center gap-4 rounded-md border border-border bg-muted/20 px-3 py-2">
        <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">
          − {totalRows.toLocaleString()} <span className="font-normal">{leftLabel}</span>
        </span>
        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
          + {totalRows.toLocaleString()} <span className="font-normal">{rightLabel}</span>
        </span>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-200/80 border border-amber-400/60" />
          <span className="text-[11px] text-muted-foreground">Changed cell</span>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rounded-md border border-border bg-background/80 overflow-hidden">
        {pageQuery.isFetching && !pageQuery.data ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Loading rows…
          </div>
        ) : rows.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No rows on this page.</p>
        ) : (
          <>
            {/* Mirror scrollbar */}
            <div ref={topRef} className="overflow-x-auto overflow-y-hidden" style={{ height: 12 }}>
              <div style={{ width: tableScrollWidth, height: 1 }} />
            </div>

            <div ref={tableRef} className="overflow-auto max-h-[45vh]">
              <Table className="min-w-max text-xs">
                <TableHeader>
                  {/* ── Group header row ── */}
                  <TableRow>
                    {hasDiffKey && (
                      <TableHead
                        rowSpan={2}
                        className="border-r border-border align-middle text-center text-[10px] font-semibold uppercase tracking-wide bg-muted/40 w-[80px]"
                      >
                        Row
                      </TableHead>
                    )}
                    {beforeCols.length > 0 && (
                      <TableHead
                        colSpan={beforeCols.length}
                        className="border-b border-emerald-300/60 border-r border-r-emerald-300/60 bg-emerald-50/80 text-center text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                      >
                        {leftLabel}
                      </TableHead>
                    )}
                    {afterCols.length > 0 && (
                      <TableHead
                        colSpan={afterCols.length}
                        className="border-b border-red-300/60 bg-red-50/80 text-center text-[11px] font-semibold text-red-600 dark:bg-red-950/30 dark:text-red-400"
                      >
                        {rightLabel}
                      </TableHead>
                    )}
                  </TableRow>

                  {/* ── Column name row ── */}
                  <TableRow>
                    {beforeCols.map((col, i) => (
                      <TableHead
                        key={col}
                        className={cn(
                          "bg-emerald-50/50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 text-[10px] font-medium",
                          i === beforeCols.length - 1 && "border-r border-r-emerald-200/60 dark:border-r-emerald-800/40",
                        )}
                      >
                        {col.slice(8) /* strip _before_ */}
                      </TableHead>
                    ))}
                    {afterCols.map((col) => (
                      <TableHead
                        key={col}
                        className="bg-red-50/50 text-red-600 dark:bg-red-950/20 dark:text-red-400 text-[10px] font-medium"
                      >
                        {col.slice(7) /* strip _after_ */}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.map((row, idx) => {
                    const absoluteIdx =
                      (pageQuery.data?.window?.globalOffset ?? 0) + idx + 1;
                    const changedSet = new Set(
                      String(row._diff_changed ?? "").split(",").filter(Boolean),
                    );

                    return (
                      <TableRow key={absoluteIdx}>
                        {hasDiffKey && (
                          <TableCell className="border-r border-border text-center text-[10px] text-muted-foreground font-mono bg-muted/10 max-w-[100px] truncate" title={String(row._diff_key ?? "")}>
                            {String(row._diff_key ?? absoluteIdx)}
                          </TableCell>
                        )}

                        {beforeCols.map((col, i) => {
                          const fieldName = col.slice(8);
                          const isChanged = changedSet.has(fieldName);
                          const val = stringify(row[col]);
                          return (
                            <TableCell
                              key={col}
                              title={val}
                              className={cn(
                                "max-w-[180px] truncate",
                                i === beforeCols.length - 1 && "border-r border-r-emerald-200/60 dark:border-r-emerald-800/40",
                                isChanged
                                  ? "bg-emerald-50/60 dark:bg-emerald-950/20 font-medium"
                                  : "bg-emerald-50/30 dark:bg-emerald-950/10",
                              )}
                            >
                              {val}
                            </TableCell>
                          );
                        })}

                        {afterCols.map((col) => {
                          const fieldName = col.slice(7);
                          const isChanged = changedSet.has(fieldName);
                          const val = stringify(row[col]);
                          return (
                            <TableCell
                              key={col}
                              title={val}
                              className={cn(
                                "max-w-[180px] truncate",
                                isChanged
                                  ? "bg-red-50/60 dark:bg-red-950/20 font-medium"
                                  : "bg-emerald-50/30 dark:bg-emerald-950/10",
                              )}
                            >
                              {val}
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

const StatPill = ({
  icon, label, count, active, colorClass, bgClass, borderClass, onClick,
}: StatPillProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick || count === 0}
    className={cn(
      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all",
      "disabled:pointer-events-none disabled:opacity-40",
      active
        ? `${bgClass} ${borderClass} shadow-sm`
        : "border-border bg-muted/20 hover:bg-muted/40",
    )}
  >
    <span className={cn("shrink-0", active ? colorClass : "text-muted-foreground")}>{icon}</span>
    <span className="flex flex-col leading-none min-w-0">
      <span className={cn("text-base font-semibold tabular-nums", active ? colorClass : "text-foreground")}>
        {count.toLocaleString()}
      </span>
      <span className="mt-0.5 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
    </span>
  </button>
);

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
  leftLabel = "File 1",
  rightLabel = "File 2",
}: ExecutionCompareViewerProps) => {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (result.addedCount > 0) return "added";
    if (result.removedCount > 0) return "removed";
    return "changed";
  });

  const tabs: { id: Tab; label: string; count: number; icon: React.ReactNode; colorClass: string }[] = [
    { id: "added",   label: "Added",   count: result.addedCount,   icon: <PlusCircleIcon className="size-3.5" />,  colorClass: "text-emerald-600 dark:text-emerald-400" },
    { id: "removed", label: "Removed", count: result.removedCount, icon: <MinusCircleIcon className="size-3.5" />, colorClass: "text-red-500 dark:text-red-400" },
    { id: "changed", label: "Changed", count: result.changedCount, icon: <RefreshCwIcon className="size-3.5" />,   colorClass: "text-amber-600 dark:text-amber-400" },
  ];

  return (
    <div className="space-y-3">
      {/* ── Summary banner ── */}
      {result.isIdentical ? (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200/70 bg-emerald-50/50 px-4 py-3 dark:border-emerald-800/50 dark:bg-emerald-950/30">
          <CircleCheckIcon className="size-4 shrink-0 text-emerald-500" />
          <div>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Datasets are identical</p>
            <p className="mt-0.5 text-[11px] text-emerald-600/70 dark:text-emerald-500/70">
              {result.unchangedCount.toLocaleString()} matching row{result.unchangedCount !== 1 ? "s" : ""}
              {result.keyField && <> · keyed by <span className="font-mono">{result.keyField}</span></>}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <CircleDotIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Datasets differ</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">{leftLabel}</span>{" vs "}
              <span className="font-medium text-foreground">{rightLabel}</span>
              {result.keyField && <> · keyed by <span className="font-mono text-primary">{result.keyField}</span></>}
              {result.compareFields.length > 0 && <> · {result.compareFields.length} field{result.compareFields.length !== 1 ? "s" : ""} compared</>}
            </p>
          </div>
        </div>
      )}

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill
          icon={<PlusCircleIcon className="size-4" />} label="Added" count={result.addedCount}
          active={activeTab === "added" && !result.isIdentical}
          colorClass="text-emerald-600 dark:text-emerald-400"
          bgClass="bg-emerald-50/60 dark:bg-emerald-950/30"
          borderClass="border-emerald-300/70 dark:border-emerald-700/60"
          onClick={result.addedCount > 0 ? () => setActiveTab("added") : undefined}
        />
        <StatPill
          icon={<MinusCircleIcon className="size-4" />} label="Removed" count={result.removedCount}
          active={activeTab === "removed" && !result.isIdentical}
          colorClass="text-red-500 dark:text-red-400"
          bgClass="bg-red-50/60 dark:bg-red-950/30"
          borderClass="border-red-300/70 dark:border-red-700/60"
          onClick={result.removedCount > 0 ? () => setActiveTab("removed") : undefined}
        />
        <StatPill
          icon={<RefreshCwIcon className="size-4" />} label="Changed" count={result.changedCount}
          active={activeTab === "changed" && !result.isIdentical}
          colorClass="text-amber-600 dark:text-amber-400"
          bgClass="bg-amber-50/60 dark:bg-amber-950/30"
          borderClass="border-amber-300/70 dark:border-amber-700/60"
          onClick={result.changedCount > 0 ? () => setActiveTab("changed") : undefined}
        />
        <StatPill
          icon={<CircleCheckIcon className="size-4" />} label="Unchanged" count={result.unchangedCount}
          colorClass="text-muted-foreground" bgClass="bg-muted/20" borderClass="border-border"
        />
      </div>

      {/* ── Tab panel ── */}
      {!result.isIdentical && (
        <div className="rounded-lg border border-border bg-background/50 overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center border-b border-border">
            {tabs.map((tab) => (
              <button
                key={tab.id} type="button"
                disabled={tab.count === 0}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
                  "disabled:pointer-events-none disabled:opacity-35",
                  activeTab === tab.id
                    ? `border-primary ${tab.colorClass}`
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                )}
              >
                <span className={activeTab === tab.id ? tab.colorClass : ""}>{tab.icon}</span>
                <span>{tab.label}</span>
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                  activeTab === tab.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}>
                  {tab.count.toLocaleString()}
                </span>
              </button>
            ))}
            {/* File legend */}
            <div className="ml-auto flex items-center gap-3 px-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="font-bold text-red-500">−</span>{leftLabel}</span>
              <span className="flex items-center gap-1"><span className="font-bold text-emerald-500">+</span>{rightLabel}</span>
            </div>
          </div>

          {/* Tab content */}
          <div className="p-3">
            {activeTab === "added" && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <PlusCircleIcon className="size-3.5 shrink-0" />
                  Rows present in <span className="font-semibold">{rightLabel}</span> but not in <span className="font-semibold">{leftLabel}</span>
                </p>
                {result.addedVarName ? (
                  <ExecutionDatasetViewer executionId={executionId} variable={result.addedVarName} nodeId={nodeId} enabled={true} />
                ) : (
                  <p className="text-[11px] text-muted-foreground px-1">No rows to display.</p>
                )}
              </div>
            )}

            {activeTab === "removed" && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-red-500 dark:text-red-400">
                  <MinusCircleIcon className="size-3.5 shrink-0" />
                  Rows present in <span className="font-semibold">{leftLabel}</span> but not in <span className="font-semibold">{rightLabel}</span>
                </p>
                {result.removedVarName ? (
                  <ExecutionDatasetViewer executionId={executionId} variable={result.removedVarName} nodeId={nodeId} enabled={true} />
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
                  <CompareChangedTable
                    executionId={executionId}
                    variable={result.changedVarName}
                    nodeId={nodeId}
                    leftLabel={leftLabel}
                    rightLabel={rightLabel}
                  />
                ) : (
                  <p className="text-[11px] text-muted-foreground px-1">No differences to display.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
