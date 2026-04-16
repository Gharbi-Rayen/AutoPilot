"use client";

import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useSuspenseExecutionSummary } from "../hooks/use-executions";
import { ExecutionDatasetViewer } from "./execution-dataset-viewer";

const statusConfig = {
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
  CANCELED: {
    label: "Canceled",
    icon: XCircleIcon,
    className: "bg-amber-100 text-amber-700 border-amber-200",
    iconClassName: "",
  },
} as const;

export const ExecutionDetail = ({ executionId }: { executionId: string }) => {
  const { data: execution } = useSuspenseExecutionSummary(executionId);

  const config = statusConfig[execution.status] ?? statusConfig.FAILED;
  const StatusIcon = config.icon;

  const completedAt = execution.completedAt;
  const duration =
    execution.startedAt && completedAt
      ? Math.round(
          (new Date(completedAt).getTime() -
            new Date(execution.startedAt).getTime()) /
            1000,
        )
      : null;

  // Find any dataset output variables across node outputs
  const datasetOutputs = execution.nodeOutputs.filter((n) => n.datasetId);

  return (
    <div className="p-4 md:px-10 md:py-6 h-full">
      <div className="mx-auto max-w-screen-xl w-full flex flex-col gap-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/executions">
              <ArrowLeftIcon className="size-4" />
            </Link>
          </Button>
          <div className="flex flex-col">
            <h1 className="text-lg md:text-xl font-semibold">
              Execution Details
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground font-mono">
              {execution.workflowId}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn("gap-1 ml-auto", config.className)}
          >
            <StatusIcon className={cn("size-3", config.iconClassName)} />
            {config.label}
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Started</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <ClockIcon className="size-4 text-muted-foreground" />
                <span className="text-sm">
                  {format(new Date(execution.startedAt), "PPpp")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatDistanceToNow(new Date(execution.startedAt), {
                  addSuffix: true,
                })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Finished</CardDescription>
            </CardHeader>
            <CardContent>
              {completedAt ? (
                <>
                  <div className="flex items-center gap-2">
                    <ClockIcon className="size-4 text-muted-foreground" />
                    <span className="text-sm">
                      {format(new Date(completedAt), "PPpp")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(completedAt), {
                      addSuffix: true,
                    })}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">In progress...</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Duration</CardDescription>
            </CardHeader>
            <CardContent>
              {duration !== null ? (
                <p className="text-sm">
                  {duration < 60
                    ? `${duration}s`
                    : `${Math.floor(duration / 60)}m ${duration % 60}s`}
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Running...
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {execution.error && (
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="text-base text-red-700">Error</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm text-red-600 whitespace-pre-wrap break-words bg-red-50 p-4 rounded-md overflow-auto max-h-64">
                {execution.error}
              </pre>
            </CardContent>
          </Card>
        )}

        {datasetOutputs.length > 0 && (
          <div className="flex flex-col gap-4">
            {datasetOutputs.map((nodeOutput) => (
              <Card key={nodeOutput.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Dataset Output</CardTitle>
                  <CardDescription className="text-xs">
                    Variable: {nodeOutput.variableName ?? nodeOutput.nodeId}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ExecutionDatasetViewer
                    executionId={executionId}
                    variable={nodeOutput.variableName ?? ""}
                    enabled={Boolean(nodeOutput.variableName)}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {execution.nodeOutputs.some(
          (n) => n.inlineOutput !== undefined && n.inlineOutput !== null,
        ) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Node Outputs</CardTitle>
              <CardDescription>
                Inline outputs produced by each node.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {execution.nodeOutputs
                .filter((n) => n.inlineOutput !== undefined && n.inlineOutput !== null)
                .map((n) => (
                  <div key={n.id} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {n.variableName ?? n.nodeId} ({n.nodeType})
                    </p>
                    <pre className="text-xs whitespace-pre-wrap break-words bg-muted p-3 rounded-md overflow-auto max-h-48">
                      {JSON.stringify(n.inlineOutput, null, 2)}
                    </pre>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export const ExecutionDetailLoading = () => {
  return (
    <div className="flex justify-center items-center h-full flex-1 flex-col gap-y-4">
      <Loader2Icon className="size-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Loading execution...</p>
    </div>
  );
};

export const ExecutionDetailError = () => {
  return (
    <div className="flex justify-center items-center h-full flex-1 flex-col gap-y-4 p-4">
      <XCircleIcon className="size-6 text-destructive" />
      <p className="text-sm text-muted-foreground">
        Failed to load execution details.
      </p>
      <Button variant="outline" asChild>
        <Link href="/executions">Back to executions</Link>
      </Button>
    </div>
  );
};
