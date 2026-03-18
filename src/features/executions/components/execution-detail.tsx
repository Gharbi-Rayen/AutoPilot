"use client";

import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  ClockIcon,
  DownloadIcon,
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
import { useSuspenseExecution } from "../hooks/use-executions";

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
} as const;

type FileOutput = {
  name: string;
  mimeType: string;
  buffer: { type: "Buffer"; data: number[] };
};

const isFileOutput = (value: unknown): value is FileOutput => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.name === "string" &&
    typeof candidate.mimeType === "string" &&
    typeof candidate.buffer === "object" &&
    candidate.buffer !== null &&
    (candidate.buffer as { type: string }).type === "Buffer" &&
    Array.isArray((candidate.buffer as { data: unknown }).data)
  );
};

const FileDownloadCard = ({
  label,
  file,
}: { label: string; file: FileOutput }) => {
  const handleDownload = () => {
    const { data } = file.buffer;
    const blob = new Blob([new Uint8Array(data)], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium truncate" title={label}>
          {label}
        </CardTitle>
        <CardDescription className="text-xs truncate" title={file.name}>
          {file.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={handleDownload}
        >
          <DownloadIcon className="size-3.5" />
          Download
        </Button>
      </CardContent>
    </Card>
  );
};

const ExecutionOutputFiles = ({
  output,
}: { output: Record<string, unknown> }) => {
  if (!output || typeof output !== "object") return null;

  const fileEntries = Object.entries(output).filter(([_, value]) =>
    isFileOutput(value),
  );

  if (fileEntries.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Generated Files</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fileEntries.map(([key, file]) => (
          <FileDownloadCard
            key={key}
            label={key}
            file={file as FileOutput}
          />
        ))}
      </div>
    </div>
  );
};

export const ExecutionDetail = ({ executionId }: { executionId: string }) => {
  const { data: execution } = useSuspenseExecution(executionId);
  const config = statusConfig[execution.status];
  const StatusIcon = config.icon;

  const duration =
    execution.startedAt && execution.finishedAt
      ? Math.round(
          (new Date(execution.finishedAt).getTime() -
            new Date(execution.startedAt).getTime()) /
            1000,
        )
      : null;

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
            <p className="text-xs md:text-sm text-muted-foreground">
              {execution.workflow.name}
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
              {execution.finishedAt ? (
                <>
                  <div className="flex items-center gap-2">
                    <ClockIcon className="size-4 text-muted-foreground" />
                    <span className="text-sm">
                      {format(new Date(execution.finishedAt), "PPpp")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(execution.finishedAt), {
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
              {execution.errorStack && (
                <details className="mt-2">
                  <summary className="text-xs text-muted-foreground cursor-pointer">
                    Stack trace
                  </summary>
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words bg-muted p-4 rounded-md mt-2 overflow-auto max-h-64">
                    {execution.errorStack}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        )}

        {execution.output && (
          <ExecutionOutputFiles
            output={execution.output as Record<string, unknown>}
          />
        )}

        {execution.output && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Output</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm whitespace-pre-wrap break-words bg-muted p-4 rounded-md overflow-auto max-h-96">
                {JSON.stringify(execution.output, null, 2)}
              </pre>
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
