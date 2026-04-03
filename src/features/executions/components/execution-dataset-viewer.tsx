"use client";

import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useExecutionDatasetDownload,
  useExecutionDatasetMeta,
  useExecutionDatasetPage,
} from "../hooks/use-executions";
import { ExecutionDatasetNavigation } from "./execution-dataset-navigation";

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

interface ExecutionDatasetViewerProps {
  executionId: string;
  variable: string;
  enabled: boolean;
  className?: string;
}

export const ExecutionDatasetViewer = ({
  executionId,
  variable,
  enabled,
  className,
}: ExecutionDatasetViewerProps) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const datasetIdentity = `${executionId}:${variable}`;

  useEffect(() => {
    if (!datasetIdentity) {
      return;
    }

    setPage(1);
  }, [datasetIdentity]);

  const datasetMetaQuery = useExecutionDatasetMeta(
    executionId,
    variable,
    enabled,
  );

  const datasetPageQuery = useExecutionDatasetPage(
    executionId,
    variable,
    page,
    pageSize,
    enabled && datasetMetaQuery.isSuccess,
  );

  const datasetDownloadQuery = useExecutionDatasetDownload(
    executionId,
    variable,
    "jsonl",
    false,
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

  const handleDownloadDataset = async () => {
    const response = await datasetDownloadQuery.refetch();
    const payload = response.data;

    if (!payload) {
      return;
    }

    const rawContent =
      payload.format === "jsonl"
        ? payload.content
        : JSON.stringify(payload.data, null, 2);

    const blob = new Blob([rawContent], {
      type: payload.mimeType,
    });

    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = downloadUrl;
    anchor.download = payload.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(downloadUrl);
  };

  const chunkHint = datasetPageQuery.data?.window
    ? `Chunk ${datasetPageQuery.data.window.chunkIndex} at offset ${datasetPageQuery.data.window.offset}`
    : undefined;

  if (!enabled) {
    return null;
  }

  if (datasetMetaQuery.isFetching && !datasetMetaQuery.data) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2Icon className="size-4 animate-spin" />
          Loading dataset metadata...
        </div>
      </div>
    );
  }

  if (datasetMetaQuery.isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load dataset metadata.
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {totalRows} rows, {datasetMetaQuery.data?.chunkCount ?? 0} chunk(s)
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={handleDownloadDataset}
          disabled={datasetDownloadQuery.isFetching}
        >
          {datasetDownloadQuery.isFetching ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <DownloadIcon className="size-3.5" />
          )}
          Download dataset
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
          <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading rows...
          </div>
        ) : rows.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">
            No rows on this page.
          </p>
        ) : (
          <ScrollArea className="max-h-[260px]">
            <Table>
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
                    (datasetPageQuery.data?.window?.globalOffset ?? 0) +
                    index +
                    1;

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
          </ScrollArea>
        )}
      </div>
    </div>
  );
};
