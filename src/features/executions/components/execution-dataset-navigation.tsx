"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250] as const;

interface ExecutionDatasetNavigationProps {
  page: number;
  pageSize: number;
  totalPages: number;
  totalRows: number;
  isPending: boolean;
  chunkHint?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export const ExecutionDatasetNavigation = ({
  page,
  pageSize,
  totalPages,
  totalRows,
  isPending,
  chunkHint,
  onPageChange,
  onPageSizeChange,
}: ExecutionDatasetNavigationProps) => {
  const canGoPrevious = !isPending && page > 1;
  const canGoNext = !isPending && totalPages > 0 && page < totalPages;

  return (
    <div className="min-w-0 space-y-2 rounded-md border bg-background/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Page {totalPages === 0 ? 0 : page} of {Math.max(totalPages, 1)}
        </p>
        <p className="text-xs text-muted-foreground">{totalRows} rows total</p>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onPageChange(page - 1)}
          disabled={!canGoPrevious}
        >
          <ChevronLeftIcon className="size-3.5" />
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onPageChange(page + 1)}
          disabled={!canGoNext}
        >
          Next
          <ChevronRightIcon className="size-3.5" />
        </Button>

        <div className="flex w-full flex-wrap items-center gap-1 sm:ml-auto sm:w-auto sm:justify-end">
          {PAGE_SIZE_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={option === pageSize ? "default" : "outline"}
              className={cn(
                "h-7 px-2 text-xs",
                option === pageSize && "shadow-none",
              )}
              onClick={() => onPageSizeChange(option)}
              disabled={isPending}
            >
              {option}
            </Button>
          ))}
        </div>
      </div>

      {chunkHint ? (
        <p className="text-[11px] text-muted-foreground">{chunkHint}</p>
      ) : null}
    </div>
  );
};
