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

/**
 * Build the page number tokens to show between Prev / Next.
 *
 * Rules:
 *  - Always show page 1 and page `totalPages`.
 *  - Show a window of ±2 pages around the current page.
 *  - Insert "…" (represented as null) wherever there is a gap.
 */
function buildPageTokens(current: number, total: number): Array<number | null> {
  if (total <= 1) return [];

  const visible = new Set<number>();

  // Anchors
  visible.add(1);
  visible.add(total);

  // Window around current
  for (
    let i = Math.max(1, current - 2);
    i <= Math.min(total, current + 2);
    i++
  ) {
    visible.add(i);
  }

  const sorted = Array.from(visible).sort((a, b) => a - b);

  const tokens: Array<number | null> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      tokens.push(null); // ellipsis gap
    }
    tokens.push(sorted[i]);
  }

  return tokens;
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
  const tokens = buildPageTokens(page, totalPages);

  return (
    <div className="min-w-0 space-y-2 rounded-md border bg-background/70 p-3">
      {/* Row counts */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Page {totalPages === 0 ? 0 : page} of {Math.max(totalPages, 1)}
        </p>
        <p className="text-xs text-muted-foreground">{totalRows} rows total</p>
      </div>

      {/* Navigation row */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {/* ← Previous */}
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

        {/* Page number tokens */}
        {tokens.map((token, i) =>
          token === null ? (
            <span
              key={`ellipsis-before-${tokens[i + 1]}`}
              className="flex h-7 w-6 items-center justify-center text-xs text-muted-foreground select-none"
            >
              …
            </span>
          ) : (
            <Button
              key={token}
              type="button"
              size="sm"
              variant={token === page ? "default" : "outline"}
              className={cn(
                "h-7 min-w-[28px] px-1.5 text-xs tabular-nums",
                token === page && "shadow-none pointer-events-none",
              )}
              onClick={() => onPageChange(token)}
              disabled={isPending}
              aria-current={token === page ? "page" : undefined}
            >
              {token}
            </Button>
          ),
        )}

        {/* Next → */}
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

        {/* Page size selector */}
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
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
