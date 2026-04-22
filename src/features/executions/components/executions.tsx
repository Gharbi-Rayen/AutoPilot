"use client";

import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle2Icon,
  CircleDotIcon,
  Clock3Icon,
  Loader2Icon,
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
  EntitySearch,
  ErrorView,
  LoadingView,
} from "@/components/entity-components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useEntitySearch } from "@/hooks/use-entity-search";
import { cn } from "@/lib/utils";
import { useRemoveExecution, useSuspenseExecutions } from "../hooks/use-executions";
import { useExecutionsParams } from "../hooks/use-executions-params";

const statusConfig = {
  CANCELED: {
    label: "Canceled",
    icon: XCircleIcon,
    className: "bg-amber-100 text-amber-700 border-amber-200",
    iconClassName: "",
  },
  QUEUED: {
    label: "Queued",
    icon: Clock3Icon,
    className: "bg-amber-100 text-amber-700 border-amber-200",
    iconClassName: "",
  },
  RUNNING: {
    label: "Running",
    icon: Loader2Icon,
    className: "bg-blue-100 text-blue-700 border-blue-200",
    iconClassName: "animate-spin",
  },
  SUCCESS: {
    label: "Success",
    icon: CheckCircle2Icon,
    className: "bg-green-100 text-green-700 border-green-200",
    iconClassName: "",
  },
  FAILED: {
    label: "Failed",
    icon: XCircleIcon,
    className: "bg-red-100 text-red-700 border-red-200",
    iconClassName: "",
  },
} as const;

export const ExecutionsSearch = () => {
  const [params, setParams] = useExecutionsParams();
  const { searchvalue, onSearchChange } = useEntitySearch({
    params,
    setParams,
  });
  return (
    <EntitySearch
      placeholder="Search by workflow name..."
      value={searchvalue}
      onChange={onSearchChange}
    />
  );
};

export const ExecutionsFilters = () => {
  const [params, setParams] = useExecutionsParams();
  const [open, setOpen] = useState(false);

  const activeCount = [
    Boolean(params.dateFrom),
    Boolean(params.dateTo),
    params.durationMin != null,
    params.durationMax != null,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setParams({ ...params, dateFrom: "", dateTo: "", durationMin: null, durationMax: null, page: 1 });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="relative gap-2">
          <SlidersHorizontalIcon className="size-3.5" />
          Filter
          {activeCount > 0 && (
            <Badge className="absolute -top-1.5 -right-1.5 size-4 flex items-center justify-center p-0 text-[10px]">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Filters</span>
          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-7 gap-1 text-xs text-muted-foreground"
            >
              <XIcon className="size-3" />
              Clear all
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Date range
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="exec-date-from" className="text-xs">From</Label>
              <Input
                id="exec-date-from"
                type="date"
                value={params.dateFrom}
                onChange={(e) =>
                  setParams({ ...params, dateFrom: e.target.value, page: 1 })
                }
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exec-date-to" className="text-xs">To</Label>
              <Input
                id="exec-date-to"
                type="date"
                value={params.dateTo}
                onChange={(e) =>
                  setParams({ ...params, dateTo: e.target.value, page: 1 })
                }
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
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
                value={params.durationMin ?? ""}
                onChange={(e) =>
                  setParams({
                    ...params,
                    durationMin: e.target.value ? Number(e.target.value) : null,
                    page: 1,
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
                value={params.durationMax ?? ""}
                onChange={(e) =>
                  setParams({
                    ...params,
                    durationMax: e.target.value ? Number(e.target.value) : null,
                    page: 1,
                  })
                }
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const ExecutionsList = () => {
  const executions = useSuspenseExecutions();

  if (executions.data.items.length === 0) {
    return <ExecutionsEmpty />;
  }

  return (
    <div className="flex flex-col gap-y-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      {executions.data.items.map((execution) => (
        <ExecutionItem key={execution.id} data={execution} />
      ))}
    </div>
  );
};

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

export const ExecutionsLoading = () => {
  return <LoadingView message="Loading executions..." />;
};

export const ExecutionsError = () => {
  return <ErrorView message="Error loading executions." />;
};

export const ExecutionsEmpty = () => {
  return (
    <EmptyView message="No executions yet. Run a workflow to see its execution history here." />
  );
};

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
      <Card className="p-4 shadow-none hover:shadow-sm cursor-pointer transition-all duration-200 hover:-translate-y-px">
        <CardContent className="flex flex-row items-center gap-4 p-0">
          <div className="flex items-center justify-center size-8 shrink-0">
            <CircleDotIcon className="size-5 text-muted-foreground" />
          </div>

          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-medium truncate">
              {data.workflowName ?? data.workflowId}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {format(new Date(data.startedAt), "yyyy/MM/dd")}
              </span>
            </CardTitle>
            {data.completedAt && (
              <CardDescription className="text-xs">
                Finished{" "}
                {formatDistanceToNow(new Date(data.completedAt), {
                  addSuffix: true,
                })}
              </CardDescription>
            )}
          </div>

          <Badge
            variant="outline"
            className={cn("gap-1 shrink-0", config.className)}
          >
            <StatusIcon className={cn("size-3", config.iconClassName)} />
            {config.label}
          </Badge>

          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
            disabled={remove.isPending}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm("Delete this execution and its data?")) {
                remove.mutate(data.id);
              }
            }}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </CardContent>
      </Card>
    </Link>
  );
};

export const ExecutionsComponent = () => (
  <ExecutionsContainer>
    <ExecutionsList />
  </ExecutionsContainer>
);
