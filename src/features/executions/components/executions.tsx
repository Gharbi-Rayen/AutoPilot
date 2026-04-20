"use client";

import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2Icon,
  CircleDotIcon,
  Clock3Icon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import {
  EmptyView,
  EntityContainer,
  EntityHeader,
  EntityPagination,
  EntitySearch,
  ErrorView,
  LoadingView,
} from "@/components/entity-components";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { useEntitySearch } from "@/hooks/use-entity-search";
import { cn } from "@/lib/utils";
import { useSuspenseExecutions } from "../hooks/use-executions";
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

export const ExecutionsList = () => {
  const executions = useSuspenseExecutions();

  if (executions.data.items.length === 0) {
    return <ExecutionsEmpty />;
  }

  return (
    <div className="flex flex-col gap-y-4">
      {executions.data.items.map((execution) => (
        <ExecutionItem key={execution.id} data={execution} />
      ))}
    </div>
  );
};

export const ExecutionsHeader = () => {
  return (
    <EntityHeader
      title="Execution History"
      description="View the history of your workflow executions"
      newButtonLabel=""
    />
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
      search={<ExecutionsSearch />}
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
  const statusKey = data.status;
  const config = statusConfig[statusKey] ?? statusConfig.FAILED;
  const StatusIcon = config.icon;

  return (
    <Link href={`/executions/detail?id=${data.id}`} prefetch>
      <Card className="p-4 shadow-none hover:shadow cursor-pointer transition-all duration-150">
        <CardContent className="flex flex-row items-center gap-4 p-0">
          {/* Far-left: time ago */}
          <div className="flex flex-col items-center justify-center min-w-[72px] text-center shrink-0">
            <span className="text-xs font-medium text-muted-foreground leading-tight">
              {formatDistanceToNow(new Date(data.startedAt), { addSuffix: false })}
            </span>
            <span className="text-[10px] text-muted-foreground/60">ago</span>
          </div>

          {/* Divider */}
          <div className="w-px h-8 bg-border shrink-0" />

          {/* Icon + title */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex items-center justify-center size-8 shrink-0">
              <CircleDotIcon className="size-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base font-medium truncate">
                {data.workflowName ?? data.workflowId}
              </CardTitle>
              {data.completedAt && (
                <CardDescription className="text-xs">
                  Finished{" "}
                  {formatDistanceToNow(new Date(data.completedAt), { addSuffix: true })}
                </CardDescription>
              )}
            </div>
          </div>

          {/* Status badge */}
          <Badge variant="outline" className={cn("gap-1 shrink-0", config.className)}>
            <StatusIcon className={cn("size-3", config.iconClassName)} />
            {config.label}
          </Badge>
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
