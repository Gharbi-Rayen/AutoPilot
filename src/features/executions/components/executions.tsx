"use client";

import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle2Icon,
  Clock3Icon,
  Loader2Icon,
  SearchIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  EmptyView,
  EntityContainer,
  EntityPagination,
  ErrorView,
} from "@/components/entity-components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntitySearch } from "@/hooks/use-entity-search";
import { cn } from "@/lib/utils";
import { useRemoveExecution, useSuspenseExecutions } from "../hooks/use-executions";
import { useExecutionsParams } from "../hooks/use-executions-params";

// ─── Status config ─────────────────────────────────────────────────────────────

const statusConfig = {
  CANCELED: {
    label: "Canceled",
    icon: XCircleIcon,
    className: "bg-amber-100 text-amber-700 border-amber-200",
    iconClassName: "",
    accentClass: "border-l-amber-400",
  },
  QUEUED: {
    label: "Queued",
    icon: Clock3Icon,
    className: "bg-amber-100 text-amber-700 border-amber-200",
    iconClassName: "",
    accentClass: "border-l-amber-400",
  },
  RUNNING: {
    label: "Running",
    icon: Loader2Icon,
    className: "bg-blue-100 text-blue-700 border-blue-200",
    iconClassName: "animate-spin",
    accentClass: "border-l-blue-500",
  },
  SUCCESS: {
    label: "Success",
    icon: CheckCircle2Icon,
    className: "bg-green-100 text-green-700 border-green-200",
    iconClassName: "",
    accentClass: "border-l-green-500",
  },
  FAILED: {
    label: "Failed",
    icon: XCircleIcon,
    className: "bg-red-100 text-red-700 border-red-200",
    iconClassName: "",
    accentClass: "border-l-red-500",
  },
} as const;

// ─── Search ────────────────────────────────────────────────────────────────────

export const ExecutionsSearch = () => {
  const [params, setParams] = useExecutionsParams();
  const { searchvalue, onSearchChange } = useEntitySearch({ params, setParams });

  return (
    <div className="relative flex-1 min-w-0 max-w-xs">
      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
      <Input
        type="text"
        value={searchvalue}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search by workflow name..."
        aria-label="Search executions"
        className="pl-9 pr-8 bg-background shadow-none border-border focus-visible:ring-primary/50"
      />
      {searchvalue && (
        <button
          type="button"
          onClick={() => onSearchChange("")}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
};

// ─── Filters popover ───────────────────────────────────────────────────────────

export const ExecutionsFilters = () => {
  const [params, setParams] = useExecutionsParams();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    durationMin: params.durationMin,
    durationMax: params.durationMax,
  });

  const activeCount = [
    Boolean(params.dateFrom),
    Boolean(params.dateTo),
    params.durationMin != null,
    params.durationMax != null,
  ].filter(Boolean).length;

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setDraft({
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        durationMin: params.durationMin,
        durationMax: params.durationMax,
      });
    }
    setOpen(isOpen);
  };

  const handleApply = () => {
    setParams({ ...params, ...draft, page: 1 });
    setOpen(false);
  };

  const handleReset = () => {
    const empty = { dateFrom: "", dateTo: "", durationMin: null, durationMax: null };
    setDraft(empty);
    setParams({ ...params, ...empty, page: 1 });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="relative gap-2 shrink-0">
          <SlidersHorizontalIcon className="size-3.5" />
          Filter
          {activeCount > 0 && (
            <Badge className="absolute -top-1.5 -right-1.5 size-4 flex items-center justify-center p-0 text-[10px]">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-4 space-y-4">
        <p className="text-sm font-semibold">Filters</p>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Date range
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="exec-date-from" className="text-xs">From</Label>
              <Input
                id="exec-date-from"
                type="date"
                value={draft.dateFrom}
                onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exec-date-to" className="text-xs">To</Label>
              <Input
                id="exec-date-to"
                type="date"
                value={draft.dateTo}
                onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Duration (seconds)
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="exec-dur-min" className="text-xs">Min</Label>
              <Input
                id="exec-dur-min"
                type="number"
                min={0}
                placeholder="0"
                value={draft.durationMin ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    durationMin: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exec-dur-max" className="text-xs">Max</Label>
              <Input
                id="exec-dur-max"
                type="number"
                min={0}
                placeholder="∞"
                value={draft.durationMax ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    durationMax: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="flex-1 text-xs text-muted-foreground"
          >
            Reset
          </Button>
          <Button size="sm" onClick={handleApply} className="flex-1 text-xs">
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

// ─── List ──────────────────────────────────────────────────────────────────────

export const ExecutionsList = () => {
  const executions = useSuspenseExecutions();

  if (executions.data.items.length === 0) {
    return <ExecutionsEmpty />;
  }

  return (
    <div className="flex flex-col gap-y-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      {executions.data.items.map((execution) => (
        <ExecutionItem key={execution.id} data={execution} />
      ))}
    </div>
  );
};

// ─── Header ────────────────────────────────────────────────────────────────────

export const ExecutionsHeader = () => {
  return (
    <div className="flex flex-row items-center justify-between gap-x-4">
      <div className="flex flex-col">
        <h1 className="text-lg md:text-xl font-semibold">Execution History</h1>
        <p className="text-xs md:text-sm text-muted-foreground">
          View the history of your workflow executions
        </p>
      </div>
    </div>
  );
};

// ─── Pagination ────────────────────────────────────────────────────────────────

export const ExecutionsPagination = () => {
  const executions = useSuspenseExecutions();
  const [params, setParams] = useExecutionsParams();

  return (
    <EntityPagination
      page={executions.data.page}
      totalPages={executions.data.totalPages}
      disabled={executions.isFetching}
      onPageChange={(page) => setParams({ ...params, page })}
    />
  );
};

// ─── Container ─────────────────────────────────────────────────────────────────

export const ExecutionsContainer = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <EntityContainer
      header={<ExecutionsHeader />}
      search={
        <div className="flex items-center gap-2">
          <ExecutionsSearch />
          <ExecutionsFilters />
        </div>
      }
      pagination={<ExecutionsPagination />}
    >
      {children}
    </EntityContainer>
  );
};

// ─── Loading skeleton ──────────────────────────────────────────────────────────

export const ExecutionsLoading = () => {
  return (
    <div className="flex flex-col gap-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-l-4 border-l-zinc-200 bg-card p-4"
        >
          <div className="flex items-center gap-4">
            <Skeleton className="size-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-2 min-w-0">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full shrink-0" />
            <Skeleton className="size-7 rounded-md shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
};

export const ExecutionsError = () => {
  return <ErrorView message="Error loading executions." />;
};

export const ExecutionsEmpty = () => {
  return (
    <EmptyView message="No executions yet. Run a workflow to see its execution history here." />
  );
};

// ─── Execution item ────────────────────────────────────────────────────────────

type ExecutionItemData = {
  id: string;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "CANCELED";
  startedAt: string;
  completedAt?: string;
  error?: string;
  workflowId: string;
  workflowName?: string;
};

const ExecutionItem = ({ data }: { data: ExecutionItemData }) => {
  const config = statusConfig[data.status] ?? statusConfig.FAILED;
  const StatusIcon = config.icon;
  const remove = useRemoveExecution();

  return (
    <Link href={`/executions/detail?id=${data.id}`} prefetch>
      <Card
        className={cn(
          "border-l-4 px-4 py-3 shadow-none cursor-pointer",
          "transition-all duration-150 hover:shadow-sm hover:bg-muted/30 group",
          config.accentClass,
        )}
      >
        <CardContent className="flex flex-row items-center gap-4 p-0">
          <div className="flex items-center justify-center size-8 shrink-0">
            <StatusIcon
              className={cn("size-4.5", config.iconClassName,
                data.status === "SUCCESS" && "text-green-600",
                data.status === "FAILED" && "text-red-500",
                data.status === "RUNNING" && "text-blue-500",
                data.status === "CANCELED" && "text-amber-500",
              )}
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground truncate leading-snug">
              {data.workflowName ?? data.workflowId}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {format(new Date(data.startedAt), "MMM d, yyyy · HH:mm")}
              {data.completedAt && (
                <span className="text-muted-foreground/60 ml-2">
                  · finished {formatDistanceToNow(new Date(data.completedAt), { addSuffix: true })}
                </span>
              )}
            </p>
          </div>

          <Badge
            variant="outline"
            className={cn("gap-1 shrink-0 text-xs font-medium", config.className)}
          >
            <StatusIcon className={cn("size-3", config.iconClassName)} />
            {config.label}
          </Badge>

          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            disabled={remove.isPending}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm("Delete this execution and its data?")) {
                remove.mutate(data.id);
              }
            }}
            aria-label="Delete execution"
          >
            {remove.isPending ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <Trash2Icon className="size-3.5" />
            )}
          </Button>
        </CardContent>
      </Card>
    </Link>
  );
};

// ─── Page composition ──────────────────────────────────────────────────────────

export const ExecutionsComponent = () => (
  <ExecutionsContainer>
    <ExecutionsList />
  </ExecutionsContainer>
);
