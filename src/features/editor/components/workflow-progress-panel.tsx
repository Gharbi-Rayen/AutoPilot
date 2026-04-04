"use client";

import { useQuery } from "@tanstack/react-query";
import type { Edge, Node } from "@xyflow/react";
import stableStringify from "fast-json-stable-stringify";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Clock3Icon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  Maximize2Icon,
  PauseIcon,
  PlayIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toposort from "toposort";
import type { NodeStatus } from "@/components/react-flow/node-status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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

type TraceStatus = NodeStatus;
type InspectorTab = "output" | "error";

interface RunnerTraceStep {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  status: TraceStatus;
  payload?: unknown;
}

interface WorkflowTraceNode {
  id: string;
  label: string;
  status: TraceStatus;
  variableKeys: string[];
}

type TraceSelection =
  | {
      kind: "runner-step";
      id: string;
    }
  | {
      kind: "workflow-node";
      id: string;
    }
  | null;

const workflowStateConfig: Record<
  WorkflowExecutionState,
  {
    label: string;
    className: string;
  }
> = {
  idle: {
    label: "Idle",
    className: "bg-muted text-muted-foreground border-muted",
  },
  running: {
    label: "Running",
    className: "bg-blue-100 text-blue-700 border-blue-200",
  },
  paused: {
    label: "Paused",
    className: "bg-amber-100 text-amber-700 border-amber-200",
  },
  success: {
    label: "Success",
    className: "bg-green-100 text-green-700 border-green-200",
  },
  error: {
    label: "Failed",
    className: "bg-red-100 text-red-700 border-red-200",
  },
};

const traceStatusConfig: Record<
  TraceStatus,
  {
    label: string;
    dotClassName: string;
    textClassName: string;
    barClassName: string;
  }
> = {
  initial: {
    label: "Pending",
    dotClassName: "bg-zinc-400",
    textClassName: "text-zinc-500",
    barClassName: "bg-zinc-400",
  },
  loading: {
    label: "Running",
    dotClassName: "bg-amber-500",
    textClassName: "text-amber-700",
    barClassName: "bg-amber-500",
  },
  success: {
    label: "Done",
    dotClassName: "bg-emerald-500",
    textClassName: "text-emerald-600",
    barClassName: "bg-emerald-500",
  },
  error: {
    label: "Failed",
    dotClassName: "bg-red-500",
    textClassName: "text-red-600",
    barClassName: "bg-red-500",
  },
};

const FALLBACK_TIMELINE_MAX_MS = 9200;

const FALLBACK_RUNNER_STEPS: RunnerTraceStep[] = [
  {
    id: "s1",
    name: "get-workflow",
    startMs: 0,
    endMs: 400,
    status: "success",
    payload: { stepId: "s1", operation: "get-workflow" },
  },
  {
    id: "s2",
    name: "prepare-workflow",
    startMs: 400,
    endMs: 1400,
    status: "success",
    payload: { stepId: "s2", operation: "prepare-workflow" },
  },
  {
    id: "s3",
    name: "finalize-context",
    startMs: 1400,
    endMs: 1800,
    status: "success",
    payload: { stepId: "s3", operation: "finalize-context" },
  },
  {
    id: "s4",
    name: "chunk-input",
    startMs: 1800,
    endMs: 2300,
    status: "success",
    payload: { stepId: "s4", operation: "chunk-input" },
  },
  {
    id: "s5",
    name: "publish-node-1",
    startMs: 2300,
    endMs: 2700,
    status: "success",
    payload: { stepId: "s5", operation: "publish-node-1" },
  },
  {
    id: "s6",
    name: "map-outputs",
    startMs: 2700,
    endMs: 3000,
    status: "success",
    payload: { stepId: "s6", operation: "map-outputs" },
  },
  {
    id: "s7",
    name: "publish-node-2",
    startMs: 3000,
    endMs: 3600,
    status: "success",
    payload: { stepId: "s7", operation: "publish-node-2" },
  },
  {
    id: "s8",
    name: "chunk-results",
    startMs: 3600,
    endMs: 4100,
    status: "success",
    payload: { stepId: "s8", operation: "chunk-results" },
  },
  {
    id: "s9",
    name: "publish-metrics",
    startMs: 4100,
    endMs: 4500,
    status: "success",
    payload: { stepId: "s9", operation: "publish-metrics" },
  },
  {
    id: "s10",
    name: "process-dataset",
    startMs: 4500,
    endMs: 5700,
    status: "success",
    payload: { stepId: "s10", operation: "process-dataset" },
  },
  {
    id: "s11",
    name: "publish-status",
    startMs: 5700,
    endMs: 6000,
    status: "success",
    payload: { stepId: "s11", operation: "publish-status" },
  },
  {
    id: "s12",
    name: "fail-execution",
    startMs: 6000,
    endMs: 6600,
    status: "error",
    payload: { stepId: "s12", operation: "fail-execution" },
  },
  {
    id: "s13",
    name: "finalize",
    startMs: 6600,
    endMs: 7800,
    status: "error",
    payload: { stepId: "s13", operation: "finalize" },
  },
];

const FALLBACK_SYNTHETIC_STEP_DURATION_MS = 420;
const FALLBACK_SYNTHETIC_STEP_GAP_MS = 110;
const RUNNER_STEP_REVEAL_DELAY_MS = 120;

const PANEL_ANIMATION_CSS = `
  @keyframes workflow-trace-row-in {
    0% {
      opacity: 0;
      transform: translateX(-10px);
    }

    100% {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @keyframes workflow-trace-bar-grow {
    from {
      transform: scaleX(0);
    }

    to {
      transform: scaleX(1);
    }
  }

  @keyframes workflow-trace-bar-shimmer {
    0% {
      background-position: 200% 0;
    }

    100% {
      background-position: -200% 0;
    }
  }

  @keyframes workflow-node-dot-pulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }

    50% {
      transform: scale(1.32);
      opacity: 0.7;
    }
  }
`;

const TRACE_OUTPUT_VARIABLE_KEYS = [
  "variableName",
  "outputVariable",
  "resultVariable",
  "saveAs",
  "outputKey",
  "targetVariable",
  "storeAs",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toTraceStatus = (value: unknown): TraceStatus => {
  if (
    value === "initial" ||
    value === "loading" ||
    value === "success" ||
    value === "error"
  ) {
    return value;
  }

  return "initial";
};

const isSettledTraceStatus = (status: TraceStatus) => {
  return status === "success" || status === "error";
};

const humanizeNodeType = (type: string) => {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const getNodeLabel = (node: Node): string => {
  if (typeof node.data === "object" && node.data !== null) {
    const data = node.data as Record<string, unknown>;
    if (typeof data.name === "string" && data.name.length > 0) {
      return data.name;
    }
  }

  return humanizeNodeType(String(node.type ?? "Node"));
};

const sortNodesByExecutionOrder = (
  nodes: Node[],
  edges: Pick<Edge, "source" | "target">[],
): Node[] => {
  if (edges.length === 0) {
    return nodes;
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edgePairs: [string, string][] = edges
    .filter(
      (edge): edge is Pick<Edge, "source" | "target"> =>
        nodeMap.has(edge.source) && nodeMap.has(edge.target),
    )
    .map((edge) => [edge.source, edge.target]);

  if (edgePairs.length === 0) {
    return nodes;
  }

  try {
    const sortedNodeIds = [...new Set(toposort(edgePairs))];
    const connectedNodeIds = new Set(sortedNodeIds);

    const sortedNodes = sortedNodeIds
      .map((id) => nodeMap.get(id))
      .filter((node): node is Node => Boolean(node));

    const isolatedNodes = nodes.filter(
      (node) => !connectedNodeIds.has(node.id),
    );

    return [...sortedNodes, ...isolatedNodes];
  } catch {
    return nodes;
  }
};

const formatTimeLabel = (milliseconds: number): string => {
  if (milliseconds <= 0) {
    return "0s";
  }

  return `${(milliseconds / 1000).toFixed(1)}s`;
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

const TraceStatusIcon = ({
  status,
  size = 16,
}: {
  status: TraceStatus;
  size?: number;
}) => {
  const colorMap: Record<TraceStatus, string> = {
    success: "text-emerald-500",
    loading: "text-amber-500",
    error: "text-red-500",
    initial: "text-zinc-400",
  };

  if (status === "success") {
    return (
      <CheckCircle2Icon
        className={cn("shrink-0", colorMap[status])}
        size={size}
      />
    );
  }

  if (status === "error") {
    return (
      <XCircleIcon className={cn("shrink-0", colorMap[status])} size={size} />
    );
  }

  if (status === "loading") {
    return (
      <Loader2Icon
        className={cn("shrink-0 animate-spin", colorMap[status])}
        size={size}
      />
    );
  }

  return (
    <Clock3Icon className={cn("shrink-0", colorMap[status])} size={size} />
  );
};

export const WorkflowProgressPanel = ({
  nodes,
  edges,
  workflowId,
}: {
  nodes: Node[];
  edges: Edge[];
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
  const [traceSelection, setTraceSelection] = useState<TraceSelection>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("error");
  const [isMetadataCollapsed, setIsMetadataCollapsed] = useState(true);
  const [isOutputExpanded, setIsOutputExpanded] = useState(false);

  const [splitPercent, setSplitPercent] = useState(38);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [copiedState, setCopiedState] = useState<"output" | "error" | null>(
    null,
  );
  const [revealedRunnerStepIds, setRevealedRunnerStepIds] = useState<string[]>(
    [],
  );
  const [settledRunnerStepIds, setSettledRunnerStepIds] = useState<string[]>(
    [],
  );

  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const splitDraggingRef = useRef(false);
  const runnerRevealTimersRef = useRef<number[]>([]);
  const runnerRevealKeyRef = useRef("");
  const lastSavedSignatureRef = useRef<string | null>(null);

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

  const clearRunnerRevealTimers = useCallback(() => {
    for (const timerId of runnerRevealTimersRef.current) {
      window.clearTimeout(timerId);
    }

    runnerRevealTimersRef.current = [];
  }, []);

  const handleRunWorkflow = async () => {
    if (!editor) {
      return;
    }

    clearRunnerRevealTimers();
    runnerRevealKeyRef.current = "";
    setTraceSelection(null);
    setActiveTab("output");
    setRevealedRunnerStepIds([]);
    setSettledRunnerStepIds([]);

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

    const graphSignature = stableStringify({
      nodes: latestNodes,
      edges: latestEdges,
    });

    try {
      if (graphSignature !== lastSavedSignatureRef.current) {
        await saveWorkflow.mutateAsync({
          id: workflowId,
          nodes: latestNodes,
          edges: latestEdges,
        });
        lastSavedSignatureRef.current = graphSignature;
      }

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
    enabled: Boolean(activeExecutionId),
    retry: false,
  });

  useEffect(() => {
    if (!activeExecutionId) {
      setExecutionResult(null);
      return;
    }

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
    setExecutionResult(executionRawOutputQuery.data?.output ?? null);
  }, [executionRawOutputQuery.data, setExecutionResult]);
  const stateConfig = workflowStateConfig[executionState];

  const outputPreview =
    executionResult ?? executionRawOutputQuery.data?.output ?? null;
  const outputRecord =
    typeof outputPreview === "object" && outputPreview !== null
      ? (outputPreview as Record<string, unknown>)
      : null;

  const orderedNodes = useMemo(() => {
    return sortNodesByExecutionOrder(nodes, edges);
  }, [edges, nodes]);

  const workflowNodes = useMemo<WorkflowTraceNode[]>(() => {
    return orderedNodes
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
          variableKeys,
        };
      });
  }, [nodeStatusMap, orderedNodes]);

  const runnerMetrics = useMemo(() => {
    return Array.isArray(outputRecord?.__executionMetrics)
      ? outputRecord.__executionMetrics.filter(isRecord)
      : [];
  }, [outputRecord]);

  const hasRunnerMetrics = runnerMetrics.length > 0;

  const runnerSteps = useMemo<RunnerTraceStep[]>(() => {
    if (runnerMetrics.length > 0) {
      let cursor = 0;

      const mappedSteps = runnerMetrics.map((metric, index) => {
        const durationCandidate =
          typeof metric.durationMs === "number" &&
          Number.isFinite(metric.durationMs)
            ? metric.durationMs
            : 180;
        const durationMs = Math.max(durationCandidate, 80);
        const startMs = cursor;
        const endMs = startMs + durationMs;
        cursor = endMs;

        const metricNodeId =
          typeof metric.nodeId === "string"
            ? metric.nodeId
            : `metric-${index + 1}`;
        const metricNodeType =
          typeof metric.nodeType === "string"
            ? humanizeNodeType(metric.nodeType)
            : `Step ${index + 1}`;

        let status = toTraceStatus(
          metric.status ?? nodeStatusMap[metricNodeId],
        );
        if (status === "initial") {
          if (
            executionState === "running" &&
            index === runnerMetrics.length - 1
          ) {
            status = "loading";
          } else {
            status = "success";
          }
        }

        return {
          id: `metric-step-${index + 1}-${metricNodeId}`,
          name: metricNodeType,
          startMs,
          endMs,
          status,
          payload: metric,
        } satisfies RunnerTraceStep;
      });

      if (
        executionState === "error" &&
        mappedSteps.length > 0 &&
        !mappedSteps.some((step) => step.status === "error")
      ) {
        const lastStepIndex = mappedSteps.length - 1;
        mappedSteps[lastStepIndex] = {
          ...mappedSteps[lastStepIndex],
          status: "error",
        };
      }

      return mappedSteps;
    }

    if (workflowNodes.length > 0) {
      const firstLoadingIndex = workflowNodes.findIndex(
        (node) => node.status === "loading",
      );
      const firstInitialIndex = workflowNodes.findIndex(
        (node) => node.status === "initial",
      );
      const inferredActiveIndex =
        firstLoadingIndex >= 0 ? firstLoadingIndex : firstInitialIndex;

      return workflowNodes.map((node, index) => {
        let status = node.status;
        if (
          executionState === "running" &&
          status === "initial" &&
          inferredActiveIndex === index
        ) {
          status = "loading";
        }

        const startMs =
          index *
          (FALLBACK_SYNTHETIC_STEP_DURATION_MS +
            FALLBACK_SYNTHETIC_STEP_GAP_MS);
        const endMs = startMs + FALLBACK_SYNTHETIC_STEP_DURATION_MS;

        return {
          id: `node-trace-${node.id}`,
          name: node.label,
          startMs,
          endMs,
          status,
          payload: {
            nodeId: node.id,
            nodeLabel: node.label,
            source: "node-status-map",
          },
        } satisfies RunnerTraceStep;
      });
    }

    return FALLBACK_RUNNER_STEPS.map((step, index) => {
      let status: TraceStatus = "initial";

      if (executionState === "running") {
        status = index === 0 ? "loading" : "initial";
      } else if (executionState === "success") {
        status = "success";
      } else if (executionState === "error") {
        status = step.status;
      } else if (executionState === "paused") {
        status = index === 0 ? "loading" : "initial";
      }

      return {
        ...step,
        status,
      };
    });
  }, [executionState, nodeStatusMap, runnerMetrics, workflowNodes]);

  const timelineMaxMs = useMemo(() => {
    const maxStepEnd = runnerSteps.reduce(
      (maxValue, step) => Math.max(maxValue, step.endMs),
      0,
    );

    return Math.max(FALLBACK_TIMELINE_MAX_MS, maxStepEnd, 1);
  }, [runnerSteps]);

  const timelineMarkers = useMemo(() => {
    const markersCount = 4;

    return Array.from({ length: markersCount + 1 }, (_, index) =>
      Math.round((timelineMaxMs / markersCount) * index),
    );
  }, [timelineMaxMs]);

  const totalNodes = workflowNodes.length;
  const completedCount = workflowNodes.filter(
    (node) => node.status === "success" || node.status === "error",
  ).length;

  const selectedRunnerStep =
    traceSelection?.kind === "runner-step"
      ? (runnerSteps.find((step) => step.id === traceSelection.id) ?? null)
      : null;

  const selectedWorkflowNode =
    traceSelection?.kind === "workflow-node"
      ? (workflowNodes.find((node) => node.id === traceSelection.id) ?? null)
      : null;

  const selectedNodeOutput = useMemo(() => {
    if (!selectedWorkflowNode || !outputRecord) {
      return null;
    }

    for (const variableKey of selectedWorkflowNode.variableKeys) {
      if (variableKey in outputRecord) {
        return outputRecord[variableKey];
      }
    }

    if (selectedWorkflowNode.id in outputRecord) {
      return outputRecord[selectedWorkflowNode.id];
    }

    return null;
  }, [outputRecord, selectedWorkflowNode]);

  const selectedDatasetVariable = useMemo(() => {
    if (!selectedWorkflowNode || !outputRecord) {
      return null;
    }

    for (const variableKey of selectedWorkflowNode.variableKeys) {
      if (isDatasetLikeValue(outputRecord[variableKey])) {
        return variableKey;
      }
    }

    return null;
  }, [outputRecord, selectedWorkflowNode]);

  const selectedOutputPayload =
    selectedRunnerStep?.payload ?? selectedNodeOutput ?? outputPreview ?? null;

  const outputPayloadText = selectedOutputPayload
    ? safeStringify(selectedOutputPayload)
    : "";

  const isOutputTooLargeToRender = outputPayloadText.length > 500000;
  const isOutputPayloadLarge =
    outputPayloadText.length > 24000 ||
    outputPayloadText.split("\n").length > 400;

  const outputPayloadPreview = isOutputPayloadLarge
    ? `${outputPayloadText.slice(0, 1200)}\n\n... (output truncated)`
    : outputPayloadText;

  const effectiveError =
    executionError ??
    executionQuery.data?.error ??
    (executionRawOutputQuery.isError
      ? "Failed to load raw execution output."
      : null);

  const stackTraceText = executionQuery.data?.errorStack ?? "";
  const stackTraceLines = useMemo(() => {
    return stackTraceText
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
  }, [stackTraceText]);

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

  const selectedIdentity = selectedWorkflowNode
    ? `${selectedWorkflowNode.label} (${selectedWorkflowNode.id.slice(0, 10)})`
    : selectedRunnerStep
      ? `${selectedRunnerStep.name} (${selectedRunnerStep.id})`
      : "-";

  const metadataEntries = [
    {
      label: "Status",
      value: executionQuery.data?.status ?? "PENDING",
      danger: (executionQuery.data?.status ?? "PENDING") === "FAILED",
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
    {
      label: "Node",
      value: selectedIdentity,
      mono: true,
    },
  ];

  const isRunning = executionState === "running";
  const isActionPending =
    saveWorkflow.isPending ||
    executeWorkflow.isPending ||
    pauseExecution.isPending;

  const handleCopy = async (value: string, target: "output" | "error") => {
    if (!value) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopiedState(target);
    window.setTimeout(() => setCopiedState(null), 1800);
  };

  const handleDownloadOutput = () => {
    if (!outputPayloadText) {
      return;
    }

    const blob = new Blob([outputPayloadText], {
      type: "application/json;charset=utf-8",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    anchor.href = downloadUrl;
    anchor.download = `workflow-output-${timestamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(downloadUrl);
  };

  const handleSelectRunnerStep = (step: RunnerTraceStep) => {
    setTraceSelection({
      kind: "runner-step",
      id: step.id,
    });
    setActiveTab(step.status === "error" ? "error" : "output");
  };

  const handleSelectWorkflowNode = (node: WorkflowTraceNode) => {
    setTraceSelection({
      kind: "workflow-node",
      id: node.id,
    });
    setActiveTab(node.status === "error" ? "error" : "output");
  };

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!splitDraggingRef.current || !splitContainerRef.current) {
        return;
      }

      const rect = splitContainerRef.current.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const relative = ((event.clientX - rect.left) / rect.width) * 100;
      const nextValue = Math.min(Math.max(relative, 22), 62);
      setSplitPercent(nextValue);
    };

    const onMouseUp = () => {
      splitDraggingRef.current = false;
      setIsDraggingSplit(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearRunnerRevealTimers();
    };
  }, [clearRunnerRevealTimers]);

  useEffect(() => {
    const nextStepIds = runnerSteps.map((step) => step.id);
    const nextStepKey = nextStepIds.join("::");
    const isRevealMode = executionState === "running" && !hasRunnerMetrics;

    if (isRevealMode && runnerRevealKeyRef.current === nextStepKey) {
      return;
    }

    runnerRevealKeyRef.current = nextStepKey;

    if (nextStepIds.length === 0) {
      clearRunnerRevealTimers();
      setRevealedRunnerStepIds([]);
      return;
    }

    if (executionState !== "running" || hasRunnerMetrics) {
      clearRunnerRevealTimers();
      setRevealedRunnerStepIds(nextStepIds);
      return;
    }

    clearRunnerRevealTimers();
    setRevealedRunnerStepIds([]);

    nextStepIds.forEach((stepId, index) => {
      const timerId = window.setTimeout(() => {
        setRevealedRunnerStepIds((previous) => {
          if (previous.includes(stepId)) {
            return previous;
          }

          return [...previous, stepId];
        });
      }, index * RUNNER_STEP_REVEAL_DELAY_MS);

      runnerRevealTimersRef.current.push(timerId);
    });

    return () => {
      clearRunnerRevealTimers();
    };
  }, [clearRunnerRevealTimers, executionState, hasRunnerMetrics, runnerSteps]);

  useEffect(() => {
    if (!activeExecutionId) {
      setSettledRunnerStepIds([]);
      return;
    }

    setSettledRunnerStepIds((previous) => {
      const settledNow = runnerSteps
        .filter((step) => isSettledTraceStatus(step.status))
        .map((step) => step.id);

      if (settledNow.length === 0) {
        return previous.length > 0 ? [] : previous;
      }

      const previousSet = new Set(previous);
      let changed = false;

      for (const stepId of settledNow) {
        if (!previousSet.has(stepId)) {
          previousSet.add(stepId);
          changed = true;
        }
      }

      if (!changed && previous.length === previousSet.size) {
        return previous;
      }

      return Array.from(previousSet);
    });
  }, [activeExecutionId, runnerSteps]);

  const revealedRunnerStepIdSet = useMemo(() => {
    return new Set(revealedRunnerStepIds);
  }, [revealedRunnerStepIds]);

  const settledRunnerStepIdSet = useMemo(() => {
    return new Set(settledRunnerStepIds);
  }, [settledRunnerStepIds]);

  const activeSyntheticRunnerStepId = useMemo(() => {
    if (executionState !== "running" || hasRunnerMetrics) {
      return null;
    }

    return (
      runnerSteps.find((step) => step.status === "loading")?.id ??
      runnerSteps.find((step) => step.status === "initial")?.id ??
      runnerSteps[0]?.id ??
      null
    );
  }, [executionState, hasRunnerMetrics, runnerSteps]);

  useEffect(() => {
    const hasValidRunnerSelection =
      traceSelection?.kind === "runner-step" &&
      runnerSteps.some((step) => step.id === traceSelection.id);
    const hasValidNodeSelection =
      traceSelection?.kind === "workflow-node" &&
      workflowNodes.some((node) => node.id === traceSelection.id);

    if (hasValidRunnerSelection || hasValidNodeSelection) {
      return;
    }

    const preferredRunner =
      runnerSteps.find((step) => step.status === "error") ??
      runnerSteps.find((step) => step.status === "loading") ??
      (executionState === "running"
        ? runnerSteps.find((step) => step.status === "initial")
        : null) ??
      runnerSteps[runnerSteps.length - 1];

    if (preferredRunner) {
      setTraceSelection({
        kind: "runner-step",
        id: preferredRunner.id,
      });
      setActiveTab(preferredRunner.status === "error" ? "error" : "output");
      return;
    }

    const preferredNode =
      workflowNodes.find((node) => node.status === "error") ??
      workflowNodes.find((node) => node.status === "loading") ??
      workflowNodes[workflowNodes.length - 1];

    if (preferredNode) {
      setTraceSelection({
        kind: "workflow-node",
        id: preferredNode.id,
      });
      setActiveTab(preferredNode.status === "error" ? "error" : "output");
    }
  }, [executionState, runnerSteps, traceSelection, workflowNodes]);

  const inspectorHeaderName =
    selectedRunnerStep?.name ?? selectedWorkflowNode?.label ?? "Select a step";
  const inspectorHeaderStatus: TraceStatus =
    selectedRunnerStep?.status ?? selectedWorkflowNode?.status ?? "initial";

  const requiresRawOutputForSelection =
    traceSelection?.kind === "workflow-node";

  return (
    <>
      <style>{PANEL_ANIMATION_CSS}</style>

      <div
        className={cn(
          "overflow-hidden bg-background transition-all duration-300 ease-out",
          isCollapsed
            ? "rounded-none border-0"
            : "rounded-xl border border-border",
        )}
      >
        <div
          className={cn(
            "flex items-center bg-muted/40 transition-[padding,gap] duration-300",
            isCollapsed
              ? "gap-1.5 px-3 py-1.5"
              : "flex-wrap gap-2 border-b border-border px-3 py-2.5",
          )}
        >
          <span
            className={cn(
              "font-medium text-foreground",
              isCollapsed ? "text-[13px]" : "text-sm",
            )}
          >
            {isCollapsed ? "Workflow" : "Workflow Progress"}
          </span>

          <Badge
            variant="outline"
            className={cn(
              "text-[11px] transition-all",
              stateConfig.className,
              isCollapsed && "px-2",
            )}
          >
            {stateConfig.label}
          </Badge>

          {!isCollapsed && (
            <Badge variant="secondary" className="text-[11px]">
              {completedCount}/{totalNodes} nodes
            </Badge>
          )}

          <Button
            size="sm"
            variant={isRunning ? "destructive" : "default"}
            disabled={isActionPending || (!isRunning && !editor)}
            className={cn(
              "gap-1.5 text-xs",
              isCollapsed ? "h-7 px-2.5" : "h-8 px-3",
            )}
            onClick={(event) => {
              event.stopPropagation();
              void (isRunning ? handlePauseWorkflow() : handleRunWorkflow());
            }}
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

          <div className="ml-auto flex min-w-0 items-center gap-2">
            {activeExecutionId && (
              <span
                className={cn(
                  "truncate font-mono text-[11px] text-muted-foreground transition-[max-width] duration-300",
                  isCollapsed ? "max-w-[86px]" : "max-w-[220px]",
                )}
              >
                {isCollapsed
                  ? `${activeExecutionId.slice(0, 8)}...`
                  : `Execution: ${activeExecutionId}`}
              </span>
            )}

            {isCollapsed && (
              <ChevronDownIcon
                className="size-4 -rotate-180 text-muted-foreground"
                aria-hidden
              />
            )}
          </div>
        </div>

        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{
            gridTemplateRows: isCollapsed ? "0fr" : "1fr",
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              ref={splitContainerRef}
              className={cn(
                "flex h-[460px] min-h-0",
                isDraggingSplit && "select-none",
              )}
            >
              <div
                className="min-w-[220px] border-r border-border"
                style={{ width: `${splitPercent}%` }}
              >
                <div className="border-b border-border bg-muted/40 px-2.5 py-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Trace
                  </span>

                  <div className="mt-1 flex pl-[128px] pr-2">
                    {timelineMarkers.map((markerMs) => (
                      <span
                        key={markerMs}
                        className="flex-1 font-mono text-[10px] text-muted-foreground"
                      >
                        {formatTimeLabel(markerMs)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex h-[calc(100%-38px)] flex-col overflow-hidden">
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {runnerSteps.map((step) => {
                      const isVisibleStep =
                        executionState !== "running" ||
                        hasRunnerMetrics ||
                        revealedRunnerStepIdSet.has(step.id);

                      if (!isVisibleStep) {
                        return null;
                      }

                      const isSyntheticRunningStep =
                        activeSyntheticRunnerStepId === step.id;
                      const visualStatus: TraceStatus =
                        isSyntheticRunningStep && step.status === "initial"
                          ? "loading"
                          : step.status;
                      const statusConfig = traceStatusConfig[visualStatus];
                      const isSelected =
                        traceSelection?.kind === "runner-step" &&
                        traceSelection.id === step.id;
                      const isRunningStep = visualStatus === "loading";
                      const isSettledStep = settledRunnerStepIdSet.has(step.id);

                      const leftPercent = (step.startMs / timelineMaxMs) * 100;
                      const widthPercent = Math.max(
                        ((step.endMs - step.startMs) / timelineMaxMs) * 100,
                        1.8,
                      );
                      const runningWidthPercent = Math.max(
                        widthPercent * 0.55,
                        1.8,
                      );

                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() =>
                            handleSelectRunnerStep({
                              ...step,
                              status: visualStatus,
                            })
                          }
                          className={cn(
                            "flex h-[26px] w-full items-center gap-1.5 px-2 pr-2 text-left transition-colors",
                            isSelected
                              ? "border-l-2 border-l-blue-500 bg-blue-500/10 pl-1.5"
                              : "border-l-2 border-l-transparent hover:bg-accent/50",
                          )}
                          style={
                            executionState === "running" && !hasRunnerMetrics
                              ? {
                                  animation:
                                    "workflow-trace-row-in 220ms ease both",
                                }
                              : undefined
                          }
                        >
                          <TraceStatusIcon status={visualStatus} size={14} />

                          <span
                            className={cn(
                              "w-[94px] shrink-0 truncate text-[11px]",
                              isSelected
                                ? "font-medium text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {step.name}
                          </span>

                          <div className="relative h-[11px] flex-1">
                            {isRunningStep ? (
                              <div
                                className="absolute top-0 h-full rounded-[2px]"
                                style={{
                                  left: `${leftPercent}%`,
                                  width: `${runningWidthPercent}%`,
                                  backgroundImage:
                                    "linear-gradient(90deg, rgba(245, 158, 11, 0.75) 25%, rgba(255, 255, 255, 0.55) 50%, rgba(245, 158, 11, 0.75) 75%)",
                                  backgroundSize: "200% 100%",
                                  animation:
                                    "workflow-trace-bar-shimmer 1.1s linear infinite",
                                }}
                              />
                            ) : (
                              <div
                                className={cn(
                                  "absolute top-0 h-full rounded-[2px]",
                                  statusConfig.barClassName,
                                  isSelected ? "opacity-100" : "opacity-70",
                                )}
                                style={{
                                  left: `${leftPercent}%`,
                                  width: `${widthPercent}%`,
                                  transformOrigin: "left center",
                                  animation: isSettledStep
                                    ? "workflow-trace-bar-grow 360ms ease both"
                                    : undefined,
                                }}
                              />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex h-[156px] min-h-[156px] flex-col border-t border-border bg-muted/30">
                    <div className="shrink-0 px-2.5 py-1">
                      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        Nodes
                      </span>
                    </div>

                    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
                      {workflowNodes.map((node) => {
                        const statusConfig = traceStatusConfig[node.status];
                        const isSelected =
                          traceSelection?.kind === "workflow-node" &&
                          traceSelection.id === node.id;

                        return (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => handleSelectWorkflowNode(node)}
                            className={cn(
                              "flex h-[30px] w-full items-center gap-2 px-2 text-left transition-colors",
                              isSelected
                                ? "border-l-2 border-l-blue-500 bg-blue-500/10 pl-1.5"
                                : "border-l-2 border-l-transparent hover:bg-accent/50",
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                statusConfig.dotClassName,
                              )}
                              style={
                                node.status === "loading"
                                  ? {
                                      animation:
                                        "workflow-node-dot-pulse 1s ease-in-out infinite",
                                    }
                                  : undefined
                              }
                            />

                            <span
                              className={cn(
                                "flex-1 truncate text-[12px] text-foreground",
                                isSelected && "font-medium",
                              )}
                            >
                              {node.label}
                            </span>

                            <span
                              className={cn(
                                "shrink-0 text-[11px] transition-colors duration-300",
                                statusConfig.textClassName,
                              )}
                            >
                              {statusConfig.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                aria-label="Resize trace and inspector panels"
                className={cn(
                  "w-1 border-0 p-0 cursor-col-resize bg-transparent transition-colors hover:bg-blue-400/45",
                  isDraggingSplit && "bg-blue-500/60",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  splitDraggingRef.current = true;
                  setIsDraggingSplit(true);
                }}
              />

              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <TraceStatusIcon status={inspectorHeaderStatus} size={16} />
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {inspectorHeaderName}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setIsMetadataCollapsed((previous) => !previous)
                    }
                    className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-3 transition-transform duration-200",
                        isMetadataCollapsed && "-rotate-90",
                      )}
                    />
                    {isMetadataCollapsed ? "Show details" : "Hide details"}
                  </button>
                </div>

                <div
                  className="grid transition-[grid-template-rows] duration-[250ms] ease-out"
                  style={{
                    gridTemplateRows: isMetadataCollapsed ? "0fr" : "1fr",
                  }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="flex flex-wrap border-b border-border bg-muted/30">
                      {metadataEntries.map((entry, index) => (
                        <div
                          key={entry.label}
                          className={cn(
                            "min-w-[120px] flex-1 px-3 py-2",
                            index < metadataEntries.length - 1 &&
                              "border-r border-border",
                          )}
                        >
                          <div className="mb-1 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                            {entry.label}
                          </div>
                          <div
                            className={cn(
                              "truncate text-[12px] font-medium text-foreground",
                              entry.danger && "text-red-600",
                              entry.mono && "font-mono text-[11px]",
                            )}
                            title={entry.value}
                          >
                            {entry.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center border-b border-border px-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab("output")}
                    className={cn(
                      "-mb-px border-b-2 px-3 py-2 text-xs transition-colors",
                      activeTab === "output"
                        ? "border-b-blue-500 font-medium text-foreground"
                        : "border-b-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Output
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("error")}
                    className={cn(
                      "-mb-px inline-flex items-center gap-1 border-b-2 px-3 py-2 text-xs transition-colors",
                      activeTab === "error"
                        ? "border-b-blue-500 font-medium text-foreground"
                        : "border-b-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    Error details
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-4">
                  {activeTab === "error" ? (
                    <div>
                      {effectiveError ? (
                        <div className="mb-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-red-700">
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100">
                            <AlertTriangleIcon className="size-3.5" />
                          </span>
                          <span className="text-xs leading-relaxed">
                            {effectiveError}
                          </span>
                        </div>
                      ) : (
                        <div className="mb-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                          No execution error is currently available.
                        </div>
                      )}

                      <div className="overflow-hidden rounded-md border border-border bg-muted/25">
                        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                          <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                            Stack trace
                          </span>

                          <button
                            type="button"
                            onClick={() => handleCopy(stackTraceText, "error")}
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                            disabled={!stackTraceText}
                          >
                            <CopyIcon className="size-3" />
                            {copiedState === "error" ? "Copied" : "Copy"}
                          </button>
                        </div>

                        <div className="max-h-[280px] overflow-auto px-3 py-2 font-mono text-xs leading-6">
                          {stackTraceLines.length > 0 ? (
                            stackTraceLines.map((line, index) => (
                              <div
                                key={`${index + 1}-${line}`}
                                className="flex gap-3"
                              >
                                <span className="w-5 shrink-0 select-none text-right text-[11px] text-muted-foreground">
                                  {index + 1}
                                </span>
                                <span
                                  className={cn(
                                    index === 0
                                      ? "text-red-600"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {line}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="px-1 py-1 text-muted-foreground">
                              No stack trace available for this execution.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      \n{" "}
                      {executionRawOutputQuery.isFetching ? (
                        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                          <Loader2Icon className="size-4 animate-spin" />
                          Loading output...
                        </div>
                      ) : selectedDatasetVariable && activeExecutionId ? (
                        <div className="rounded-md border border-border bg-muted/20 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-medium text-foreground">
                              Dataset: {selectedDatasetVariable}
                            </span>
                          </div>
                          <ExecutionDatasetViewer
                            executionId={activeExecutionId}
                            variable={selectedDatasetVariable}
                            enabled={true}
                          />
                        </div>
                      ) : outputPayloadText ? (
                        <div className="overflow-hidden rounded-md border border-border bg-muted/25">
                          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                            <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                              Step output
                            </span>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setIsOutputExpanded(true)}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <Maximize2Icon className="size-3" />
                                Expand
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  handleCopy(outputPayloadText, "output")
                                }
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <CopyIcon className="size-3" />
                                {copiedState === "output" ? "Copied" : "Copy"}
                              </button>

                              {isOutputPayloadLarge && (
                                <button
                                  type="button"
                                  onClick={handleDownloadOutput}
                                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                                >
                                  <DownloadIcon className="size-3" />
                                  Download
                                </button>
                              )}
                            </div>
                          </div>

                          {isOutputTooLargeToRender ? (
                            <div className="flex flex-col items-center justify-center p-8 border-t border-border/80 text-amber-500 bg-amber-950/10">
                              <div className="flex items-center gap-2 mb-4">
                                <AlertTriangleIcon className="size-5 shrink-0" />
                                <span className="text-[13px] font-medium text-amber-600 dark:text-amber-400">
                                  Output size is too large to render ( &gt; 1MB
                                  )
                                </span>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleDownloadOutput}
                                className="h-8 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                              >
                                <DownloadIcon className="mr-1.5 size-3.5" />
                                Download Raw Data
                              </Button>
                            </div>
                          ) : (
                            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-6 text-muted-foreground">
                              {outputPayloadPreview}
                            </pre>
                          )}
                        </div>
                      ) : (
                        <div className="flex h-[180px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
                          <Clock3Icon className="size-5" />
                          No output for this selection.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Dialog open={isOutputExpanded} onOpenChange={setIsOutputExpanded}>
        <DialogContent className="max-w-[80vw] w-[1000px] h-[80vh] flex flex-col p-0 gap-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/30">
            <DialogTitle className="text-sm font-medium m-0 p-0">
              Output Payload
            </DialogTitle>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy(outputPayloadText, "output")}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <CopyIcon className="size-3.5" />
                {copiedState === "output" ? "Copied" : "Copy"}
              </button>
              {isOutputPayloadLarge && (
                <button
                  type="button"
                  onClick={handleDownloadOutput}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <DownloadIcon className="size-3.5" />
                  Download
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-background p-4 flex">
            {isOutputTooLargeToRender ? (
              <div className="m-auto flex flex-col items-center justify-center p-8 text-amber-500 bg-amber-950/10 rounded-md border border-amber-900/20">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangleIcon className="size-5 shrink-0" />
                  <span className="text-[13px] font-medium text-amber-600 dark:text-amber-400">
                    Output size is too large to render ( &gt; 1MB )
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadOutput}
                  className="h-8 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                >
                  <DownloadIcon className="mr-1.5 size-3.5" />
                  Download Raw Data
                </Button>
              </div>
            ) : (
              <pre className="font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words">
                {outputPayloadText}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
