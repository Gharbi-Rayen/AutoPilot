"use client";

import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckCircle2Icon,
  CheckIcon,
  ClipboardIcon,
  ClockIcon,
  Loader2Icon,
  TimerIcon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useSuspenseExecutionSummary } from "../hooks/use-executions";
import { ExecutionDatasetViewer } from "./execution-dataset-viewer";

// ─── Status config ─────────────────────────────────────────────────────────────

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

// ─── Helpers ───────────────────────────────────────────────────────────────────

const NodeOutputCopyButton = ({ content }: { content: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={cn(
        "absolute top-2 right-2 p-1 rounded transition-all duration-150",
        "opacity-0 group-hover:opacity-100",
        "bg-background/90 hover:bg-background border border-border/60",
        "text-muted-foreground hover:text-foreground",
      )}
      aria-label={copied ? "Copied!" : "Copy output"}
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-green-600" />
      ) : (
        <ClipboardIcon className="size-3.5" />
      )}
    </button>
  );
};

interface StatCardProps {
  label: string;
  icon: React.ElementType;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
}

const StatCard = ({ label, icon: Icon, primary, secondary }: StatCardProps) => (
  <Card>
    <CardContent className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 text-muted-foreground shrink-0" />
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground leading-snug">{primary}</div>
        {secondary && (
          <p className="text-xs text-muted-foreground/70 mt-0.5">{secondary}</p>
        )}
      </div>
    </CardContent>
  </Card>
);

// ─── Main component ─────────────────────────────────────────────────────────────

export const ExecutionDetail = ({ executionId }: { executionId: string }) => {
  const { data: execution } = useSuspenseExecutionSummary(executionId);
  const [idCopied, setIdCopied] = useState(false);

  const config = statusConfig[execution.status] ?? statusConfig.FAILED;
  const StatusIcon = config.icon;

  const completedAt = execution.completedAt;
  const durationMs =
    execution.startedAt && completedAt
      ? new Date(completedAt).getTime() - new Date(execution.startedAt).getTime()
      : null;
  const durationSec = durationMs !== null ? Math.round(durationMs / 1000) : null;
  const durationStr =
    durationSec !== null
      ? durationSec < 60
        ? `${durationSec}s`
        : `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
      : null;

  const datasetOutputs = execution.nodeOutputs.filter((n) => n.datasetId);
  const inlineOutputs = execution.nodeOutputs.filter(
    (n) => n.inlineOutput !== undefined && n.inlineOutput !== null,
  );

  return (
    <div className="p-4 md:px-10 md:py-6 h-full">
      <div className="mx-auto max-w-screen-xl w-full flex flex-col gap-y-6">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href="/executions">
              <ArrowLeftIcon className="size-4" />
            </Link>
          </Button>

          <div className="flex flex-col min-w-0">
            <h1 className="text-lg md:text-xl font-semibold">Execution Details</h1>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(executionId);
                setIdCopied(true);
                setTimeout(() => setIdCopied(false), 2000);
              }}
              className={cn(
                "flex items-center gap-1.5 mt-0.5 px-2 py-0.5 rounded-md w-fit",
                "bg-muted hover:bg-muted/80 transition-colors group text-left",
              )}
              aria-label="Copy execution ID"
            >
              <span className="text-xs font-mono text-muted-foreground truncate max-w-[180px] sm:max-w-xs">
                {executionId}
              </span>
              {idCopied ? (
                <CheckIcon className="size-3 text-green-600 shrink-0" />
              ) : (
                <ClipboardIcon className="size-3 text-muted-foreground/50 group-hover:text-muted-foreground shrink-0 transition-colors" />
              )}
            </button>
          </div>

          <Badge
            variant="outline"
            className={cn("gap-1 ml-auto shrink-0 font-medium", config.className)}
          >
            <StatusIcon className={cn("size-3", config.iconClassName)} />
            {config.label}
          </Badge>
        </div>

        {/* ── Stat cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            label="Started"
            icon={CalendarIcon}
            primary={format(new Date(execution.startedAt), "PPpp")}
            secondary={formatDistanceToNow(new Date(execution.startedAt), { addSuffix: true })}
          />
          <StatCard
            label="Finished"
            icon={ClockIcon}
            primary={
              completedAt ? (
                format(new Date(completedAt), "PPpp")
              ) : (
                <span className="text-muted-foreground font-normal">In progress…</span>
              )
            }
            secondary={
              completedAt
                ? formatDistanceToNow(new Date(completedAt), { addSuffix: true })
                : undefined
            }
          />
          <StatCard
            label="Duration"
            icon={TimerIcon}
            primary={
              durationStr ?? (
                <span className="flex items-center gap-1.5 text-muted-foreground font-normal">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Running…
                </span>
              )
            }
            secondary={
              durationMs != null ? `${durationMs.toLocaleString()} ms total` : undefined
            }
          />
        </div>

        {/* ── Error ── */}
        {execution.error && (
          <Card className="border-red-200">
            <CardContent className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-red-700 mb-3">
                Error
              </p>
              <pre className="text-sm text-red-600 whitespace-pre-wrap break-words bg-red-50 p-4 rounded-lg overflow-auto max-h-64 font-mono border border-red-100">
                {execution.error}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* ── Dataset outputs ── */}
        {datasetOutputs.length > 0 && (
          <div className="flex flex-col gap-4">
            {datasetOutputs.map((nodeOutput) => (
              <Card key={nodeOutput.id}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <p className="text-sm font-semibold text-foreground">Dataset Output</p>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                      {nodeOutput.variableName ?? nodeOutput.nodeId}
                    </span>
                  </div>
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

        {/* ── Node outputs (inline JSON) ── */}
        {inlineOutputs.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-semibold text-foreground mb-4">Node Outputs</p>
              <div className="divide-y divide-border">
                {inlineOutputs.map((n) => {
                  const jsonStr = JSON.stringify(n.inlineOutput, null, 2);
                  return (
                    <div key={n.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-semibold font-mono px-2 py-0.5 rounded-md bg-muted text-foreground">
                          {n.variableName ?? n.nodeId}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground">
                          {n.nodeType}
                        </span>
                      </div>
                      <div className="relative group">
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-zinc-50 border border-zinc-200 p-3.5 rounded-lg overflow-x-auto max-h-48">
                          {jsonStr}
                        </pre>
                        <NodeOutputCopyButton content={jsonStr} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
};

// ─── Loading / Error states ─────────────────────────────────────────────────────

export const ExecutionDetailLoading = () => {
  return (
    <div className="flex justify-center items-center h-full flex-1 flex-col gap-y-4">
      <Loader2Icon className="size-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Loading execution…</p>
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
