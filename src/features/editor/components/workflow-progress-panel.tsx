"use client";

import { useQuery } from "@tanstack/react-query";
import type { Node } from "@xyflow/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  Clock3Icon,
  CopyIcon,
  DownloadIcon,
  ExpandIcon,
  Loader2Icon,
  type LucideIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { NodeStatus } from "@/components/react-flow/node-status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ExecutionDatasetViewer } from "@/features/executions/components/execution-dataset-viewer";
import {
  useExecuteWorkflow,
  usePauseExecution,
  useUpdateWorkflow,
} from "@/features/workflows/hooks/use-workflows";
import type { NodeType } from "@/generated/prisma";
import { cn } from "@/lib/utils";
import {
  activeExecutionIdAtom,
  executionStartedAtAtom,
  nodeStatusMapAtom,
  resetWorkflowExecutionStateAtom,
  type WorkflowExecutionState,
  workflowExecutionErrorAtom,
  workflowExecutionResultAtom,
  workflowExecutionStateAtom,
  workflowProgressPanelCollapsedAtom,
} from "@/store/execution-status";
import { useTRPC } from "@/trpc/client";
import { editorAtom } from "../store/atoms";

const workflowStateConfig: Record<
  WorkflowExecutionState,
  {
    label: string;
    className: string;
    icon: LucideIcon;
    iconClassName?: string;
  }
> = {
  idle: {
    label: "Idle",
    className: "bg-muted text-muted-foreground border-muted",
    icon: Clock3Icon,
  },
  running: {
    label: "Running",
    className: "bg-blue-100 text-blue-700 border-blue-200",
    icon: Loader2Icon,
    iconClassName: "animate-spin",
  },
  paused: {
    label: "Paused",
    className: "bg-amber-100 text-amber-700 border-amber-200",
    icon: PauseIcon,
  },
  success: {
    label: "Success",
    className: "bg-green-100 text-green-700 border-green-200",
    icon: CheckCircle2Icon,
  },
  error: {
    label: "Failed",
    className: "bg-red-100 text-red-700 border-red-200",
    icon: AlertTriangleIcon,
  },
};

const nodeStateConfig: Record<
  NodeStatus,
  {
    label: string;
    dotClassName: string;
    rowClassName: string;
    icon: LucideIcon;
    iconClassName?: string;
  }
> = {
  initial: {
    label: "Pending",
    dotClassName: "bg-muted-foreground/40",
    rowClassName: "border-border bg-muted/20",
    icon: Clock3Icon,
  },
  loading: {
    label: "Running",
    dotClassName: "bg-blue-500 animate-pulse",
    rowClassName: "border-primary/30 bg-primary/5",
    icon: Loader2Icon,
    iconClassName: "animate-spin",
  },
  success: {
    label: "Done",
    dotClassName: "bg-green-500",
    rowClassName: "border-emerald-500/30 bg-emerald-500/5",
    icon: CheckCircle2Icon,
  },
  error: {
    label: "Failed",
    dotClassName: "bg-red-500",
    rowClassName: "border-destructive/30 bg-destructive/5",
    icon: AlertTriangleIcon,
  },
};

const TRACE_OUTPUT_VARIABLE_KEYS = [
  "variableName",
  "outputVariable",
  "resultVariable",
  "saveAs",
  "outputKey",
  "targetVariable",
  "storeAs",
] as const;

const humanizeNodeType = (type: string) => {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const getNodeLabel = (node: Node) => {
  if (typeof node.data === "object" && node.data !== null) {
    const data = node.data as Record<string, unknown>;
    if (typeof data.name === "string" && data.name.length > 0) {
      return data.name;
    }
  }

  return humanizeNodeType(String(node.type ?? "Node"));
};

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const isDatasetLikeValue = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.every(
      (item) =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.kind === "dataset" || record.kind === "dataset-summary") {
    return true;
  }

  return Array.isArray(record.records) || Array.isArray(record.preview);
};

const scrollAreaEnhancementClassName =
  "[scrollbar-gutter:stable] [&_[data-slot=scroll-area-scrollbar]]:w-3 [&_[data-slot=scroll-area-scrollbar]]:bg-muted/40 [&_[data-slot=scroll-area-thumb]]:bg-muted-foreground/60 [&_[data-slot=scroll-area-thumb]]:hover:bg-muted-foreground/80";

const formatDateTime = (value: Date | string | number | null | undefined) => {
  if (!value) {
    return "-";
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "-";
  }

  return parsedDate.toLocaleString();
};

const getDurationLabel = ({
  startedAt,
  finishedAt,
  isRunning,
}: {
  startedAt: Date | null;
  finishedAt: Date | null;
  isRunning: boolean;
}) => {
  if (!startedAt) {
    return "-";
  }

  const end = finishedAt ?? (isRunning ? new Date() : null);
  if (!end) {
    return "-";
  }

  const durationMs = Math.max(end.getTime() - startedAt.getTime(), 0);
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)} s`;
  }

  return `${(durationMs / 60_000).toFixed(1)} min`;
};

export const WorkflowProgressPanel = ({
  nodes,
  workflowId,
}: {
  nodes: Node[];
  workflowId: string;
}) => {
  const trpc = useTRPC();
  const editor = useAtomValue(editorAtom);
  const saveWorkflow = useUpdateWorkflow();
  const executeWorkflow = useExecuteWorkflow();
  const pauseExecution = usePauseExecution();

  const [isCollapsed, setIsCollapsed] = useAtom(
    workflowProgressPanelCollapsedAtom,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isRawDataDialogOpen, setIsRawDataDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRawOutputRequested, setIsRawOutputRequested] = useState(false);

  const executionState = useAtomValue(workflowExecutionStateAtom);
  const activeExecutionId = useAtomValue(activeExecutionIdAtom);
  const executionStartedAt = useAtomValue(executionStartedAtAtom);
  const nodeStatusMap = useAtomValue(nodeStatusMapAtom);
  const executionError = useAtomValue(workflowExecutionErrorAtom);
  const executionResult = useAtomValue(workflowExecutionResultAtom);

  const setActiveExecutionId = useSetAtom(activeExecutionIdAtom);
  const setExecutionStartedAt = useSetAtom(executionStartedAtAtom);
  const resetWorkflowExecutionState = useSetAtom(
    resetWorkflowExecutionStateAtom,
  );
  const setExecutionState = useSetAtom(workflowExecutionStateAtom);
  const setExecutionResult = useSetAtom(workflowExecutionResultAtom);
  const setExecutionError = useSetAtom(workflowExecutionErrorAtom);

  const handleRunWorkflow = async () => {
    if (!editor) {
      return;
    }

    resetWorkflowExecutionState();
    setIsCollapsed(false);
    setExecutionState("running");
    setExecutionStartedAt(Date.now());

    const latestNodes = editor.getNodes().map((node) => ({
      id: node.id,
      type: node.type as NodeType,
      position: node.position,
      data: node.data as Record<string, unknown> | undefined,
    }));

    const latestEdges = editor.getEdges().map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    }));

    try {
      await saveWorkflow.mutateAsync({
        id: workflowId,
        nodes: latestNodes,
        edges: latestEdges,
      });

      const workflowExecution = await executeWorkflow.mutateAsync({
        id: workflowId,
      });

      setActiveExecutionId(workflowExecution.executionId);
    } catch (error) {
      setExecutionState("error");
      setExecutionError(
        error instanceof Error ? error.message : "Failed to execute workflow.",
      );
    }
  };

  const handlePauseWorkflow = async () => {
    if (!activeExecutionId) {
      return;
    }

    try {
      await pauseExecution.mutateAsync({ executionId: activeExecutionId });
      setExecutionState("paused");
      setExecutionError("Paused by user.");
    } catch (error) {
      setExecutionError(
        error instanceof Error ? error.message : "Failed to pause workflow.",
      );
    }
  };

  const executionQuery = useQuery({
    ...trpc.executions.getOne.queryOptions({ id: activeExecutionId ?? "" }),
    enabled: Boolean(activeExecutionId),
    retry: false,
    refetchInterval: (query) => {
      const currentExecution = query.state.data;
      if (!currentExecution) {
        return 1000;
      }

      return currentExecution.status === "RUNNING" ? 1000 : false;
    },
  });

  const executionRawOutputQuery = useQuery({
    ...trpc.executions.getOneRawOutput.queryOptions({
      id: activeExecutionId ?? "",
    }),
    enabled: Boolean(activeExecutionId) && isRawOutputRequested,
    retry: false,
  });

  useEffect(() => {
    if (!activeExecutionId) {
      setExecutionResult(null);
      return;
    }

    setIsRawOutputRequested(false);
    setExecutionResult(null);
  }, [activeExecutionId, setExecutionResult]);

  useEffect(() => {
    const currentExecution = executionQuery.data;

    if (!currentExecution) {
      return;
    }

    if (currentExecution.startedAt) {
      setExecutionStartedAt(new Date(currentExecution.startedAt).getTime());
    }

    if (currentExecution.status === "RUNNING") {
      setExecutionState("running");
      setExecutionError(null);
      return;
    }

    if (currentExecution.status === "SUCCESS") {
      setExecutionState("success");
      setExecutionError(null);
      return;
    }

    if (
      currentExecution.status === "FAILED" &&
      currentExecution.error?.toLowerCase().includes("paused")
    ) {
      setExecutionState("paused");
      setExecutionError(currentExecution.error);
      return;
    }

    setExecutionState("error");
    setExecutionError(currentExecution.error ?? "Workflow execution failed.");
  }, [
    executionQuery.data,
    setExecutionError,
    setExecutionStartedAt,
    setExecutionState,
  ]);

  useEffect(() => {
    if (!isRawOutputRequested) {
      return;
    }

    setExecutionResult(executionRawOutputQuery.data?.output ?? null);
  }, [executionRawOutputQuery.data, isRawOutputRequested, setExecutionResult]);

  const trackedNodes = useMemo(() => {
    return nodes
      .filter((node) => node.type !== "INITIAL")
      .map((node) => {
        const status = nodeStatusMap[node.id] ?? "initial";
        const nodeData =
          typeof node.data === "object" && node.data !== null
            ? (node.data as Record<string, unknown>)
            : {};
        const variableKeys = TRACE_OUTPUT_VARIABLE_KEYS.map(
          (key) => nodeData[key],
        ).filter(
          (key): key is string => typeof key === "string" && key.length > 0,
        );

        return {
          id: node.id,
          label: getNodeLabel(node),
          status,
          rawNode: node,
          variableKeys,
        };
      });
  }, [nodes, nodeStatusMap]);

  useEffect(() => {
    if (trackedNodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }

    if (
      selectedNodeId &&
      trackedNodes.some((node) => node.id === selectedNodeId)
    ) {
      return;
    }

    const preferredNode =
      trackedNodes.find((node) => node.status === "loading") ??
      trackedNodes.find((node) => node.status === "error") ??
      trackedNodes[trackedNodes.length - 1];

    setSelectedNodeId(preferredNode.id);
  }, [trackedNodes, selectedNodeId]);

  const runningNodes = trackedNodes.filter((node) => node.status === "loading");
  const selectedTraceNode = trackedNodes.find(
    (node) => node.id === selectedNodeId,
  );
  const totalNodes = trackedNodes.length;
  const completedCount = trackedNodes.filter(
    (node) => node.status === "success" || node.status === "error",
  ).length;

  const currentlyHappening =
    runningNodes.length > 0
      ? runningNodes.map((node) => node.label).join(", ")
      : executionState === "running" &&
          completedCount === totalNodes &&
          totalNodes > 0
        ? "Finalizing execution..."
        : executionState === "running"
          ? "Waiting for next node..."
          : executionState === "paused"
            ? "Workflow paused by user."
            : executionState === "success"
              ? "Workflow execution completed."
              : executionState === "error"
                ? "Workflow execution failed."
                : "Waiting for workflow execution.";

  const stateConfig = workflowStateConfig[executionState];
  const StateIcon = stateConfig.icon;

  const outputPreview =
    executionResult ?? executionRawOutputQuery.data?.output ?? null;
  const outputRecord =
    typeof outputPreview === "object" && outputPreview !== null
      ? (outputPreview as Record<string, unknown>)
      : null;

  const selectedNodeOutput = useMemo(() => {
    if (!selectedTraceNode || !outputRecord) {
      return null;
    }

    for (const variableKey of selectedTraceNode.variableKeys) {
      if (variableKey in outputRecord) {
        return outputRecord[variableKey];
      }
    }

    if (selectedTraceNode.id in outputRecord) {
      return outputRecord[selectedTraceNode.id];
    }

    return null;
  }, [outputRecord, selectedTraceNode]);

  const selectedDatasetVariable = useMemo(() => {
    if (!selectedTraceNode || !outputRecord) {
      return null;
    }

    for (const variableKey of selectedTraceNode.variableKeys) {
      if (isDatasetLikeValue(outputRecord[variableKey])) {
        return variableKey;
      }
    }

    return null;
  }, [outputRecord, selectedTraceNode]);

  const effectiveError =
    executionError ??
    executionQuery.data?.error ??
    (executionRawOutputQuery.isError
      ? "Failed to load raw execution output."
      : null);

  const inspectorPayload =
    effectiveError ?? selectedNodeOutput ?? outputPreview ?? null;
  const inspectorPayloadText = inspectorPayload
    ? safeStringify(inspectorPayload)
    : "";
  const isInspectorPayloadLarge =
    inspectorPayloadText.length > 6000 ||
    inspectorPayloadText.split("\n").length > 140;
  const inspectorPayloadPreview = isInspectorPayloadLarge
    ? `${inspectorPayloadText.slice(0, 420)}\n\n... (output truncated)`
    : inspectorPayloadText;

  const startedAt = executionQuery.data?.startedAt
    ? new Date(executionQuery.data.startedAt)
    : executionStartedAt
      ? new Date(executionStartedAt)
      : null;
  const finishedAt = executionQuery.data?.finishedAt
    ? new Date(executionQuery.data.finishedAt)
    : null;
  const durationLabel = getDurationLabel({
    startedAt,
    finishedAt,
    isRunning: executionState === "running",
  });

  const executionSummaryRows = [
    {
      label: "Backend Status",
      value: executionQuery.data?.status ?? "PENDING",
    },
    {
      label: "Started",
      value: formatDateTime(startedAt),
    },
    {
      label: "Finished",
      value: formatDateTime(finishedAt),
    },
    {
      label: "Duration",
      value: durationLabel,
    },
  ];

  const isRunning = executionState === "running";
  const isActionPending =
    saveWorkflow.isPending ||
    executeWorkflow.isPending ||
    pauseExecution.isPending;

  const handleCopyPayload = async () => {
    if (!inspectorPayloadText) {
      return;
    }

    await navigator.clipboard.writeText(inspectorPayloadText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadRawData = () => {
    if (!inspectorPayloadText) {
      return;
    }

    const blob = new Blob([inspectorPayloadText], {
      type: "application/json;charset=utf-8",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    anchor.href = downloadUrl;
    anchor.download = `workflow-raw-data-${timestamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(downloadUrl);
  };

  const handleLoadRawOutput = () => {
    if (!activeExecutionId) {
      return;
    }

    setIsRawOutputRequested(true);
  };

  const inspectorScrollAreaClassName = cn(
    "h-full min-h-0 rounded-lg border bg-muted/10 p-3",
    scrollAreaEnhancementClassName,
  );

  return (
    <div
      className={cn(
        "h-full w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex flex-col",
        !isCollapsed && "pt-2",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-semibold truncate">Workflow Progress</p>
          <Badge
            variant="outline"
            className={cn("gap-1", stateConfig.className)}
          >
            <StateIcon className={cn("size-3", stateConfig.iconClassName)} />
            {stateConfig.label}
          </Badge>
        </div>

        <Badge variant="secondary" className="hidden sm:inline-flex">
          {completedCount}/{totalNodes} nodes
        </Badge>

        <Button
          variant={isRunning ? "destructive" : "default"}
          size="sm"
          disabled={isActionPending || (!isRunning && !editor)}
          onClick={isRunning ? handlePauseWorkflow : handleRunWorkflow}
        >
          {isRunning ? (
            <PauseIcon className="size-3.5" />
          ) : isActionPending ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
          {isRunning ? "Pause" : "Run"}
        </Button>

        {activeExecutionId && (
          <p className="order-last w-full text-right text-xs text-muted-foreground truncate sm:order-none sm:w-auto sm:ml-auto sm:max-w-[16rem]">
            Execution: {activeExecutionId}
          </p>
        )}

        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => setIsCollapsed((previous) => !previous)}
        >
          {isCollapsed ? (
            <ChevronUpIcon className="size-4" />
          ) : (
            <ChevronDownIcon className="size-4" />
          )}
        </Button>
      </div>

      {!isCollapsed && (
        <div className="flex-1 min-h-0 grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-[minmax(280px,0.95fr)_minmax(360px,1.05fr)]">
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Node Trace</CardTitle>
              <CardDescription className="text-xs">
                Click a node to inspect its run output.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 pt-0 flex flex-col gap-3">
              <div className="rounded-xl border bg-card/80 px-3 py-2.5 shadow-sm">
                <p className="text-xs text-muted-foreground">
                  {currentlyHappening}
                </p>
              </div>

              <ScrollArea
                className={cn(
                  "h-full min-h-0 pr-2",
                  scrollAreaEnhancementClassName,
                )}
              >
                <div className="space-y-2">
                  {trackedNodes.length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                      No executable nodes connected to the selected trigger.
                    </div>
                  ) : (
                    trackedNodes.map((node) => {
                      const config = nodeStateConfig[node.status];
                      const StatusIcon = config.icon;
                      const isSelected = selectedNodeId === node.id;

                      return (
                        <button
                          type="button"
                          key={node.id}
                          onClick={() => setSelectedNodeId(node.id)}
                          className={cn(
                            "w-full rounded-xl border p-3 text-left transition-all shadow-[0_1px_1px_rgba(0,0,0,0.04)] hover:-translate-y-[1px] hover:shadow-sm",
                            config.rowClassName,
                            isSelected &&
                              "border-primary/60 bg-primary/10 ring-1 ring-primary/30",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                config.dotClassName,
                              )}
                            />
                            <p className="truncate text-sm font-medium">
                              {node.label}
                            </p>
                            <Badge
                              variant="secondary"
                              className="ml-auto text-[11px]"
                            >
                              {config.label}
                            </Badge>
                          </div>

                          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <StatusIcon
                              className={cn("size-3.5", config.iconClassName)}
                            />
                            <span className="truncate">
                              Node {node.id.slice(0, 10)}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Execution Inspector</CardTitle>
              <CardDescription className="text-xs">
                Metadata and output for the selected trace node.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 pt-0 flex flex-col">
              <ScrollArea className={inspectorScrollAreaClassName}>
                <div className="grid grid-cols-2 gap-2">
                  {executionSummaryRows.map((row) => (
                    <div
                      key={row.label}
                      className="rounded-md border bg-background px-3 py-2"
                    >
                      <p className="text-[11px] text-muted-foreground">
                        {row.label}
                      </p>
                      <p className="mt-1 text-xs font-medium">{row.value}</p>
                    </div>
                  ))}
                </div>

                <Separator className="my-3" />

                <div className="rounded-md border bg-background/80 p-3 text-xs">
                  <p className="mb-1 font-medium">Selected Trace Node</p>
                  <p className="text-muted-foreground truncate">
                    {selectedTraceNode
                      ? `${selectedTraceNode.label} (${selectedTraceNode.id.slice(0, 10)})`
                      : "No node selected."}
                  </p>
                </div>

                <div className="mt-3 rounded-md border bg-background/80 p-3 text-xs">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="font-medium">Step Output</p>

                    {!effectiveError &&
                      inspectorPayloadText &&
                      !isInspectorPayloadLarge && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={handleCopyPayload}
                          >
                            <CopyIcon className="size-3.5" />
                            {copied ? "Copied" : "Copy"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setIsRawDataDialogOpen(true)}
                          >
                            <ExpandIcon className="size-3.5" />
                            Expand
                          </Button>
                        </div>
                      )}
                  </div>

                  {selectedDatasetVariable && (
                    <div className="mb-3 rounded-md border border-dashed bg-muted/20 p-3">
                      <p className="font-medium">Dataset Details</p>
                      <p className="text-muted-foreground mt-1">
                        Variable: {selectedDatasetVariable}
                      </p>

                      {activeExecutionId && (
                        <ExecutionDatasetViewer
                          executionId={activeExecutionId}
                          variable={selectedDatasetVariable}
                          enabled={isRawOutputRequested}
                          className="mt-3"
                        />
                      )}
                    </div>
                  )}

                  {effectiveError ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
                      {effectiveError}
                    </div>
                  ) : executionRawOutputQuery.isFetching ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2Icon className="size-4 animate-spin" />
                      <span>Loading raw output...</span>
                    </div>
                  ) : !isRawOutputRequested && activeExecutionId ? (
                    <div className="rounded-md border border-dashed bg-muted/30 p-3">
                      <p className="text-muted-foreground">
                        Raw output is not loaded by default.
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-3 h-8"
                        onClick={handleLoadRawOutput}
                      >
                        <DownloadIcon className="size-3.5" />
                        Load raw output
                      </Button>
                    </div>
                  ) : !inspectorPayloadText ? (
                    <p className="text-muted-foreground">
                      No data for this node yet.
                    </p>
                  ) : isInspectorPayloadLarge ? (
                    <div className="rounded-md border border-dashed bg-muted/30 p-3">
                      <p className="text-muted-foreground">
                        Raw output is large and has been truncated for
                        performance.
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-3 h-8"
                        onClick={handleDownloadRawData}
                      >
                        <DownloadIcon className="size-3.5" />
                        Download raw data
                      </Button>
                    </div>
                  ) : (
                    <pre className="max-h-[260px] overflow-auto rounded-md border bg-muted/20 p-3 whitespace-pre-wrap break-words text-xs">
                      {inspectorPayloadPreview}
                    </pre>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={isRawDataDialogOpen} onOpenChange={setIsRawDataDialogOpen}>
        <DialogContent className="max-w-4xl h-[80vh] p-0 flex flex-col">
          <DialogHeader className="px-5 pt-5 pb-2">
            <DialogTitle>Raw Step Output</DialogTitle>
            <DialogDescription>
              Full payload for the selected trace node.
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 pb-4 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCopyPayload}>
              <CopyIcon className="size-3.5" />
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownloadRawData}
            >
              <DownloadIcon className="size-3.5" />
              Download raw data
            </Button>
          </div>

          <div className="min-h-0 flex-1 px-5 pb-5">
            <ScrollArea
              className={cn(
                "h-full rounded-md border bg-muted/20 p-3",
                scrollAreaEnhancementClassName,
              )}
            >
              <pre className="text-xs whitespace-pre-wrap break-words">
                {inspectorPayloadText || "No data"}
              </pre>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
