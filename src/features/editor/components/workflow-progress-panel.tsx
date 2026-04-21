"use client";

import { useQuery } from "@tanstack/react-query";
import type { Edge, Node } from "@xyflow/react";
import { useAtom, useAtomValue } from "jotai";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Clock3Icon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  Maximize2Icon,
  PlayIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeStatusLine } from "@/components/node-status-line";
import type { NodeStatus } from "@/components/react-flow/node-status-indicator";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ExecutionDatasetViewer } from "@/features/executions/components/execution-dataset-viewer";
import {
  ExecutionCompareViewer,
  type CompareResult,
} from "@/features/executions/components/execution-compare-viewer";
import { executionKeys } from "@/features/executions/hooks/use-executions";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  activeExecutionIdAtom,
  executionStartedAtAtom,
  nodeProgressMapAtom,
  nodeStatusMapAtom,
  type WorkflowExecutionState,
  workflowExecutionErrorAtom,
  workflowExecutionResultAtom,
  workflowExecutionStateAtom,
  workflowProgressPanelCollapsedAtom,
} from "@/store/execution-status";

// ─── Types ───────────────────────────────────────────────────────────────────

type TraceStatus = NodeStatus;

interface WorkflowTraceNode {
  id: string;
  label: string;
  status: TraceStatus;
  variableKeys: string[];
  type?: string;
  data?: Record<string, unknown>;
}

// ─── Config maps ─────────────────────────────────────────────────────────────

const workflowStateConfig: Record<
  WorkflowExecutionState,
  { label: string; className: string }
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
    label: "Canceled",
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
  { dotClassName: string; textClassName: string; barClassName: string }
> = {
  initial: {
    dotClassName: "bg-zinc-400",
    textClassName: "text-zinc-500",
    barClassName: "bg-zinc-400",
  },
  loading: {
    dotClassName: "bg-amber-500",
    textClassName: "text-amber-700",
    barClassName: "bg-amber-500",
  },
  success: {
    dotClassName: "bg-emerald-500",
    textClassName: "text-emerald-600",
    barClassName: "bg-emerald-500",
  },
  error: {
    dotClassName: "bg-red-500",
    textClassName: "text-red-600",
    barClassName: "bg-red-500",
  },
};

// ─── Constants ────────────────────────────────────────────────────────────────

const FALLBACK_TIMELINE_MAX_MS = 9200;
const FALLBACK_SYNTHETIC_STEP_DURATION_MS = 420;
const FALLBACK_SYNTHETIC_STEP_GAP_MS = 110;

const PANEL_ANIMATION_CSS = `
  @keyframes workflow-trace-bar-grow {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }
  @keyframes workflow-trace-bar-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const humanizeNodeType = (type: string) =>
  type
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

const getNodeLabel = (node: Node): string => {
  if (typeof node.data === "object" && node.data !== null) {
    const data = node.data as Record<string, unknown>;
    if (typeof data.name === "string" && data.name.length > 0) return data.name;
  }
  return humanizeNodeType(String(node.type ?? "Node"));
};

const sortNodesByExecutionOrder = (
  nodes: Node[],
  edges: Pick<Edge, "source" | "target">[],
): Node[] => {
  if (nodes.length === 0) return nodes;
  try {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const children = new Map<string, string[]>();
    const hasParent = new Set<string>();

    for (const n of nodes) children.set(n.id, []);
    for (const e of edges) {
      if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
        children.get(e.source)?.push(e.target);
        hasParent.add(e.target);
      }
    }

    const visited = new Set<string>();
    const result: string[] = [];

    const dfs = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const kids = children.get(id) ?? [];
      for (let i = kids.length - 1; i >= 0; i--) dfs(kids[i]);
      result.push(id);
    };

    for (const n of nodes) {
      if (!hasParent.has(n.id)) dfs(n.id);
    }

    result.reverse();
    const sortedIds = result;
    const connectedIds = new Set(sortedIds);
    const sorted = sortedIds.map((id) => nodeMap.get(id)).filter((n): n is Node => Boolean(n));
    const isolated = nodes.filter((n) => !connectedIds.has(n.id));
    return [...sorted, ...isolated];
  } catch {
    return nodes;
  }
};

const formatTimeLabel = (ms: number) =>
  ms <= 0 ? "0s" : `${(ms / 1000).toFixed(1)}s`;

const formatBytes = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "-";
  }
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const isDatasetLikeValue = (value: unknown): boolean => {
  if (Array.isArray(value))
    return value.every(
      (i) => typeof i === "object" && i !== null && !Array.isArray(i),
    );
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.kind === "dataset" || r.kind === "dataset-summary") return true;
  return Array.isArray(r.records) || Array.isArray(r.preview);
};

const formatDateTime = (value: Date | string | number | null | undefined) => {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
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
  if (!startedAt) return "-";
  const end = finishedAt ?? (isRunning ? new Date() : null);
  if (!end) return "-";
  const ms = Math.max(end.getTime() - startedAt.getTime(), 0);
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

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
  if (status === "success")
    return (
      <CheckCircle2Icon
        className={cn("shrink-0", colorMap.success)}
        size={size}
      />
    );
  if (status === "error")
    return (
      <XCircleIcon className={cn("shrink-0", colorMap.error)} size={size} />
    );
  if (status === "loading")
    return (
      <Loader2Icon
        className={cn("shrink-0 animate-spin mt-[1px]", colorMap.loading)}
        size={size}
      />
    );
  return (
    <Clock3Icon className={cn("shrink-0", colorMap.initial)} size={size} />
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const WorkflowProgressPanel = ({
  nodes,
  edges,
  workflowId: _workflowId,
}: {
  nodes: Node[];
  edges: Edge[];
  workflowId: string;
}) => {
  const [isCollapsed, setIsCollapsed] = useAtom(
    workflowProgressPanelCollapsedAtom,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isOutputExpanded, setIsOutputExpanded] = useState(false);
  const [splitPercent, setSplitPercent] = useState(38);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [copiedState, setCopiedState] = useState<"output" | "error" | null>(
    null,
  );

  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const splitDraggingRef = useRef(false);

  // ── Atom reads (source of truth — populated by execution engine) ──────────

  const executionState = useAtomValue(workflowExecutionStateAtom);
  const activeExecutionId = useAtomValue(activeExecutionIdAtom);
  const executionStartedAt = useAtomValue(executionStartedAtAtom);
  const nodeStatusMap = useAtomValue(nodeStatusMapAtom);
  const nodeProgressMap = useAtomValue(nodeProgressMapAtom);
  const executionError = useAtomValue(workflowExecutionErrorAtom);
  const executionResult = useAtomValue(workflowExecutionResultAtom);

  // ── Per-node output (Dexie) ────────────────────────────────────────────────

  const nodeOutputQuery = useQuery({
    queryKey: executionKeys.nodeOutput(
      activeExecutionId ?? "",
      selectedNodeId ?? "",
    ),
    queryFn: async () => {
      if (!activeExecutionId || !selectedNodeId) return null;
      return db.executionNodeOutputs
        .where("executionId")
        .equals(activeExecutionId)
        .filter((r) => r.nodeId === selectedNodeId)
        .first()
        .then((r) => r ?? null);
    },
    enabled: Boolean(activeExecutionId && selectedNodeId),
    refetchInterval: executionState === "running" ? 1000 : false,
    retry: false,
  });

  // Refetch node output once when execution transitions from running to done
  // so the final DB write is always reflected without waiting for another poll.
  const prevExecutionStateRef = useRef(executionState);
  useEffect(() => {
    const prev = prevExecutionStateRef.current;
    prevExecutionStateRef.current = executionState;
    if (prev === "running" && (executionState === "success" || executionState === "error")) {
      void nodeOutputQuery.refetch();
    }
  }, [executionState, nodeOutputQuery]);

  // ── Derived data ───────────────────────────────────────────────────────────

  const stateConfig = workflowStateConfig[executionState];

  const outputPreview = executionResult ?? null;
  const outputRecord =
    typeof outputPreview === "object" && outputPreview !== null
      ? (outputPreview as Record<string, unknown>)
      : null;

  const orderedNodes = useMemo(
    () => sortNodesByExecutionOrder(nodes, edges),
    [edges, nodes],
  );

  const workflowNodes = useMemo<WorkflowTraceNode[]>(() => {
    return orderedNodes
      .filter((node) => node.type !== "INITIAL")
      .map((node) => {
        const status = nodeStatusMap[node.id] ?? "initial";
        const nodeData =
          typeof node.data === "object" && node.data !== null
            ? (node.data as Record<string, unknown>)
            : {};

        const variableKeys = [...new Set(Object.values(nodeData))].filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );

        return {
          id: node.id,
          label: getNodeLabel(node),
          status,
          variableKeys,
          type: String(node.type ?? ""),
          data: nodeData,
        };
      });
  }, [nodeStatusMap, orderedNodes]);

  const runnerMetrics = useMemo(() => {
    return Array.isArray(outputRecord?.__executionMetrics)
      ? outputRecord.__executionMetrics.filter(isRecord)
      : [];
  }, [outputRecord]);

  const nodeTimingMap = useMemo(() => {
    const map = new Map<string, { startMs: number; endMs: number }>();

    if (runnerMetrics.length > 0) {
      let cursor = 0;
      for (const metric of runnerMetrics) {
        if (typeof metric.nodeId === "string") {
          const duration =
            typeof metric.durationMs === "number" &&
            Number.isFinite(metric.durationMs)
              ? Math.max(metric.durationMs, 80)
              : 180;
          map.set(metric.nodeId, { startMs: cursor, endMs: cursor + duration });
          cursor += duration;
        }
      }
    } else {
      workflowNodes.forEach((node, index) => {
        const startMs =
          index *
          (FALLBACK_SYNTHETIC_STEP_DURATION_MS + FALLBACK_SYNTHETIC_STEP_GAP_MS);
        map.set(node.id, {
          startMs,
          endMs: startMs + FALLBACK_SYNTHETIC_STEP_DURATION_MS,
        });
      });
    }

    return map;
  }, [runnerMetrics, workflowNodes]);

  const timelineMaxMs = useMemo(() => {
    let maxMs = 0;
    for (const t of nodeTimingMap.values()) maxMs = Math.max(maxMs, t.endMs);
    return Math.max(FALLBACK_TIMELINE_MAX_MS, maxMs, 1);
  }, [nodeTimingMap]);

  const timelineMarkers = useMemo(() => {
    const count = 4;
    return Array.from({ length: count + 1 }, (_, i) =>
      Math.round((timelineMaxMs / count) * i),
    );
  }, [timelineMaxMs]);

  const totalNodes = workflowNodes.length;
  const completedCount = workflowNodes.filter(
    (n) => n.status === "success" || n.status === "error",
  ).length;

  // ── Selected node ──────────────────────────────────────────────────────────

  const selectedWorkflowNode = selectedNodeId
    ? (workflowNodes.find((n) => n.id === selectedNodeId) ?? null)
    : null;

  const selectedNodeLiveOutputRecord = useMemo(() => {
    const output = nodeOutputQuery.data?.inlineOutput;
    return isRecord(output) ? output : null;
  }, [nodeOutputQuery.data?.inlineOutput]);

  // Auto-select most relevant node
  useEffect(() => {
    const hasValid =
      selectedNodeId && workflowNodes.some((n) => n.id === selectedNodeId);
    if (hasValid) return;

    const toSelect =
      workflowNodes.find((n) => n.status === "error") ??
      workflowNodes.find((n) => n.status === "loading") ??
      (executionState !== "idle"
        ? workflowNodes[workflowNodes.length - 1]
        : null);

    if (toSelect) setSelectedNodeId(toSelect.id);
  }, [executionState, workflowNodes, selectedNodeId]);

  const selectedNodeOutput = useMemo(() => {
    if (!selectedWorkflowNode) return null;

    const resolveFromRecord = (record: Record<string, unknown> | null) => {
      if (!record) return null;
      for (const key of selectedWorkflowNode.variableKeys) {
        if (key in record) return record[key];
      }
      if (selectedWorkflowNode.id in record) return record[selectedWorkflowNode.id];
      const entries = Object.entries(record);
      if (entries.length === 1) return entries[0]?.[1] ?? null;
      return null;
    };

    return (
      resolveFromRecord(selectedNodeLiveOutputRecord) ??
      resolveFromRecord(outputRecord)
    );
  }, [outputRecord, selectedNodeLiveOutputRecord, selectedWorkflowNode]);

  const selectedDatasetVariable = useMemo(() => {
    if (!selectedWorkflowNode) return null;

    // For dataset nodes inlineOutput is undefined; the engine writes variableName
    // + datasetId as separate fields on the DB record — use them directly.
    // Skip for CSV_COMPARE: the compare viewer renders its own dataset tables.
    const dbRecord = nodeOutputQuery.data;
    if (
      dbRecord?.datasetId &&
      dbRecord?.variableName &&
      selectedWorkflowNode.type !== "CSV_COMPARE"
    )
      return dbRecord.variableName;

    const resolveFromRecord = (record: Record<string, unknown> | null) => {
      if (!record) return null;
      for (const key of selectedWorkflowNode.variableKeys) {
        if (isDatasetLikeValue(record[key])) return key;
      }
      const firstDatasetEntry = Object.entries(record).find(([, value]) =>
        isDatasetLikeValue(value),
      );
      return firstDatasetEntry?.[0] ?? null;
    };

    return (
      resolveFromRecord(selectedNodeLiveOutputRecord) ??
      resolveFromRecord(outputRecord)
    );
  }, [nodeOutputQuery.data, outputRecord, selectedNodeLiveOutputRecord, selectedWorkflowNode]);

  const selectedOutputPayload = selectedNodeOutput;
  const outputPayloadText = selectedOutputPayload
    ? safeStringify(selectedOutputPayload)
    : "";
  const isOutputPayloadLarge =
    outputPayloadText.length > 24000 ||
    outputPayloadText.split("\n").length > 400;
  const outputPayloadPreview = isOutputPayloadLarge
    ? `${outputPayloadText.slice(0, 1200)}\n\n... (output truncated)`
    : outputPayloadText;

  const effectiveError = executionError;

  const outputLimitInfo = isRecord(outputRecord?.__outputLimit)
    ? (outputRecord.__outputLimit as Record<string, unknown>)
    : null;

  const selectedBlobOutput = useMemo(() => {
    if (!isRecord(selectedOutputPayload)) return null;
    // Accept both legacy { type: "blob" } shape and upload executor's { kind: "file" } shape
    const isBlob = selectedOutputPayload.type === "blob";
    const isFileKind = selectedOutputPayload.kind === "file";
    if (!isBlob && !isFileKind) return null;
    const rawName = selectedOutputPayload.name ?? selectedOutputPayload.fileName;
    const rawSize = selectedOutputPayload.size ?? selectedOutputPayload.byteSize;
    return {
      name: typeof rawName === "string" ? rawName : "uploaded-file",
      mimeType:
        typeof selectedOutputPayload.mimeType === "string"
          ? selectedOutputPayload.mimeType
          : "application/octet-stream",
      size: rawSize,
      uploadedAt:
        typeof selectedOutputPayload.uploadedAt === "string"
          ? selectedOutputPayload.uploadedAt
          : null,
      fileBlobPath:
        typeof selectedOutputPayload.fileBlobPath === "string"
          ? selectedOutputPayload.fileBlobPath
          : null,
    };
  }, [selectedOutputPayload]);

  const selectedCompareResult = useMemo((): CompareResult | null => {
    if (selectedWorkflowNode?.type !== "CSV_COMPARE") return null;
    if (!isRecord(selectedOutputPayload)) return null;
    if (selectedOutputPayload._compareResult !== true) return null;
    if (typeof selectedOutputPayload.isIdentical !== "boolean") return null;
    return selectedOutputPayload as unknown as CompareResult;
  }, [selectedWorkflowNode, selectedOutputPayload]);

  // Per-node times from DB record (fall back to workflow-level startedAt)
  const nodeRecord = nodeOutputQuery.data;
  const startedAt = nodeRecord?.startedAt
    ? new Date(nodeRecord.startedAt as string)
    : executionStartedAt ? new Date(executionStartedAt) : null;
  const finishedAt = nodeRecord?.finishedAt
    ? new Date(nodeRecord.finishedAt as string)
    : null;
  const durationMs = typeof nodeRecord?.durationMs === "number" ? nodeRecord.durationMs : null;

  const inspectorName = selectedWorkflowNode?.label ?? "Inspector";
  const inspectorStatus: TraceStatus =
    selectedWorkflowNode?.status ?? "initial";
  const durationLabel = durationMs !== null
    ? durationMs < 1000
      ? `${durationMs}ms`
      : `${(durationMs / 1000).toFixed(2)}s`
    : getDurationLabel({
        startedAt,
        finishedAt,
        isRunning: executionState === "running" && selectedWorkflowNode?.status === "loading",
      });

  // ── Split drag ─────────────────────────────────────────────────────────────

  const handleSplitMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      splitDraggingRef.current = true;
      setIsDraggingSplit(true);
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!splitDraggingRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const relative = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.min(Math.max(relative, 22), 62));
    };
    const onUp = () => {
      splitDraggingRef.current = false;
      setIsDraggingSplit(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleCopy = async (value: string, target: "output" | "error") => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedState(target);
    window.setTimeout(() => setCopiedState(null), 1800);
  };

  const handleDownloadOutput = () => {
    if (!outputPayloadText) return;
    const blob = new Blob([outputPayloadText], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-output-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Execution status label ─────────────────────────────────────────────────

  const executionStatusLabel =
    executionState === "running"
      ? "RUNNING"
      : executionState === "success"
        ? "SUCCESS"
        : executionState === "error" || executionState === "paused"
          ? "FAILED"
          : "PENDING";

  // ── Right panel renderer ───────────────────────────────────────────────────

  const metadataView = (
    <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-xs">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            Status
          </p>
          <p
            className={cn(
              "font-medium",
              executionStatusLabel === "FAILED"
                ? "text-red-600"
                : "text-foreground",
            )}
          >
            {executionStatusLabel}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            Started
          </p>
          <p className="text-foreground">{formatDateTime(startedAt)}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            Finished
          </p>
          <p className="text-foreground">{formatDateTime(finishedAt)}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            Duration
          </p>
          <p className="text-foreground">{durationLabel}</p>
        </div>
      </div>
    </div>
  );

  const renderRightPanel = () => {
    if (executionState === "idle") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <PlayIcon className="size-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              No execution yet
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Click the play icon on the Manual Trigger node to run the workflow
            </p>
          </div>
        </div>
      );
    }

    if (!selectedWorkflowNode) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <Clock3Icon className="size-8 opacity-20" />
          <p className="text-xs text-muted-foreground">
            Select a node to inspect its output
          </p>
        </div>
      );
    }

    const { status, label } = selectedWorkflowNode;

    if (status === "loading") {
      const liveProgress = nodeProgressMap[selectedWorkflowNode.id];
      const progressText = liveProgress?.message ?? `Running ${label}…`;
      return (
        <div className="space-y-3">
          {metadataView}
          <NodeStatusLine text={progressText} />
          {typeof liveProgress?.progress === "number" && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${liveProgress.progress}%` }}
              />
            </div>
          )}
        </div>
      );
    }

    if (executionState === "running" && status === "initial") {
      return (
        <div className="space-y-3">
          {metadataView}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <Clock3Icon className="size-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Not started yet
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (status === "error" || executionState === "error") {
      return (
        <div className="space-y-3">
          {effectiveError && (
            <div className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-red-700">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100">
                <AlertTriangleIcon className="size-3.5" />
              </span>
              <span className="text-xs leading-relaxed">{effectiveError}</span>
            </div>
          )}
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Execution failed. Check the error above for details.
          </div>
        </div>
      );
    }

    if (status === "success") {
      if (selectedWorkflowNode.type === "MANUAL_TRIGGER") {
        const statusText =
          executionState === "running"
            ? "Workflow is running..."
            : executionState === "success"
              ? "Workflow completed"
              : executionState === "paused" || executionState === "error"
                ? "Workflow stopped"
                : "Workflow completed";
        return (
          <div className="space-y-3">
            {metadataView}
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <CheckCircle2Icon className="size-4 shrink-0 text-green-500" />
              <p className="text-sm font-medium text-foreground">{statusText}</p>
            </div>
          </div>
        );
      }

      if (selectedBlobOutput) {
        return (
          <div className="space-y-3">
            {metadataView}
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs font-medium text-foreground">
                Uploaded file
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <div className="rounded border border-border bg-background/70 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                    Name
                  </p>
                  <p className="truncate text-foreground" title={selectedBlobOutput.name}>
                    {selectedBlobOutput.name}
                  </p>
                </div>
                <div className="rounded border border-border bg-background/70 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                    Type
                  </p>
                  <p className="truncate text-foreground" title={selectedBlobOutput.mimeType}>
                    {selectedBlobOutput.mimeType}
                  </p>
                </div>
                <div className="rounded border border-border bg-background/70 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                    Size
                  </p>
                  <p className="text-foreground">{formatBytes(selectedBlobOutput.size)}</p>
                </div>
                <div className="rounded border border-border bg-background/70 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                    Uploaded
                  </p>
                  <p className="text-foreground">
                    {selectedBlobOutput.uploadedAt
                      ? formatDateTime(selectedBlobOutput.uploadedAt)
                      : "-"}
                  </p>
                </div>
              </div>
              {selectedBlobOutput.fileBlobPath && (
                <p
                  className="mt-2 truncate text-[11px] text-muted-foreground"
                  title={selectedBlobOutput.fileBlobPath}
                >
                  {selectedBlobOutput.fileBlobPath}
                </p>
              )}
            </div>
          </div>
        );
      }

      if (selectedCompareResult && activeExecutionId) {
        const nodeData = selectedWorkflowNode.data as Record<string, unknown>;
        const leftLabel =
          typeof nodeData.leftVariable === "string" && nodeData.leftVariable
            ? nodeData.leftVariable
            : "File 1";
        const rightLabel =
          typeof nodeData.rightVariable === "string" && nodeData.rightVariable
            ? nodeData.rightVariable
            : "File 2";
        return (
          <div className="space-y-3">
            {metadataView}
            <ExecutionCompareViewer
              result={selectedCompareResult}
              executionId={activeExecutionId}
              nodeId={selectedWorkflowNode.id}
              leftLabel={leftLabel}
              rightLabel={rightLabel}
            />
          </div>
        );
      }

      if (selectedDatasetVariable && activeExecutionId) {
        return (
          <div className="space-y-3">
            {metadataView}
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  Dataset: {selectedDatasetVariable}
                </span>
              </div>
              <ExecutionDatasetViewer
                executionId={activeExecutionId}
                variable={selectedDatasetVariable}
                nodeId={selectedWorkflowNode.id}
                enabled={true}
              />
            </div>
          </div>
        );
      }

      if (outputPayloadText) {
        return (
          <div className="space-y-3">
            {metadataView}
            <div className="overflow-hidden rounded-md border border-border bg-muted/20">
              <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                  Output
                </span>
                <div className="flex items-center gap-2">
                  {isOutputPayloadLarge && (
                    <button
                      type="button"
                      onClick={() => setIsOutputExpanded(true)}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Maximize2Icon className="size-3" />
                      Expand
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopy(outputPayloadText, "output")}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <CopyIcon className="size-3" />
                    {copiedState === "output" ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadOutput}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <DownloadIcon className="size-3" />
                    Download
                  </button>
                </div>
              </div>
              <pre className="max-h-[340px] overflow-auto px-3 py-2 font-mono text-xs leading-5 text-foreground">
                {outputPayloadPreview}
              </pre>
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-3">
          {metadataView}
          {outputLimitInfo ? (
            <div className="rounded-md border border-amber-300 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
              {typeof outputLimitInfo.message === "string"
                ? outputLimitInfo.message
                : "Execution output exceeded the limit."}
            </div>
          ) : (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              No returned data available for this node.
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {metadataView}
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {executionState === "paused"
            ? "Execution was canceled."
            : "No output available."}
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{PANEL_ANIMATION_CSS}</style>

      <Dialog open={isOutputExpanded} onOpenChange={setIsOutputExpanded}>
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-hidden p-0">
          <DialogTitle className="border-b border-border px-4 py-3 text-sm font-medium">
            {inspectorName} — Full Output
          </DialogTitle>
          <div className="overflow-auto p-4">
            <pre className="font-mono text-xs leading-5">{outputPayloadText}</pre>
          </div>
        </DialogContent>
      </Dialog>

      <div
        className={cn(
          "flex h-full flex-col overflow-hidden bg-background transition-all duration-300 ease-out",
          isCollapsed
            ? "rounded-none border-0 pt-5"
            : "rounded-xl border border-border",
        )}
      >
        {/* ── Panel header ──────────────────────────────────────────────── */}
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

          {!isCollapsed && activeExecutionId && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] text-muted-foreground"
            >
              {durationLabel}
            </Badge>
          )}

          <div className="ml-auto flex min-w-0 items-center gap-2">
            {activeExecutionId && (
              <span
                className={cn(
                  "truncate font-mono text-[11px] text-muted-foreground transition-[max-width] duration-300",
                  isCollapsed ? "max-w-[86px]" : "max-w-[220px]",
                )}
              >
                {isCollapsed
                  ? `${activeExecutionId.slice(0, 8)}…`
                  : `Execution: ${activeExecutionId}`}
              </span>
            )}
            {isCollapsed && (
              <button
                type="button"
                onClick={() => setIsCollapsed(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Expand panel"
              >
                <ChevronDownIcon className="size-4 -rotate-180" />
              </button>
            )}
          </div>
        </div>

        {/* ── Collapsible body ───────────────────────────────────────────── */}
        <div
          className="grid min-h-0 flex-1 transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: isCollapsed ? "0fr" : "1fr" }}
        >
          <div className="h-full min-h-0 overflow-hidden">
            <div
              ref={splitContainerRef}
              className={cn(
                "flex h-full min-h-0",
                isDraggingSplit && "select-none",
              )}
            >
              {/* ── Left: Nodes in trace style ──────────────────────────── */}
              <div
                className="flex h-full min-w-[220px] flex-col border-r border-border"
                style={{ width: `${splitPercent}%` }}
              >
                <div className="shrink-0 border-b border-border bg-muted/40 px-2.5 py-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Trace
                  </span>
                  <div className="mt-1 flex pl-[128px] pr-2">
                    {timelineMarkers.map((ms) => (
                      <span
                        key={ms}
                        className="flex-1 font-mono text-[10px] text-muted-foreground"
                      >
                        {formatTimeLabel(ms)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {workflowNodes.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      No nodes in workflow
                    </div>
                  ) : (
                    workflowNodes.map((node) => {
                      const timing = nodeTimingMap.get(node.id) ?? {
                        startMs: 0,
                        endMs: 0,
                      };
                      const isSelected = selectedNodeId === node.id;
                      const isLoading = node.status === "loading";
                      const visualStatus: TraceStatus = node.status;
                      const statusCfg = traceStatusConfig[visualStatus] ?? traceStatusConfig.initial;
                      const leftPercent =
                        (timing.startMs / timelineMaxMs) * 100;
                      const widthPercent = Math.max(
                        ((timing.endMs - timing.startMs) / timelineMaxMs) * 100,
                        1.8,
                      );

                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => setSelectedNodeId(node.id)}
                          className={cn(
                            "flex h-[26px] w-full items-center gap-1.5 px-2 pr-2 text-left transition-colors",
                            isSelected
                              ? "border-l-2 border-l-blue-500 bg-blue-500/10 pl-1.5"
                              : "border-l-2 border-l-transparent hover:bg-accent/50",
                          )}
                        >
                          <TraceStatusIcon status={visualStatus} size={14} />

                          <span
                            className={cn(
                              "w-[72px] shrink-0 truncate text-[11px]",
                              isSelected
                                ? "font-medium text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {node.label}
                          </span>

                          {typeof node.data?.variableName === "string" && (
                            <span className="shrink-0 max-w-[60px] truncate rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">
                              {node.data.variableName}
                            </span>
                          )}

                          <div className="relative h-[11px] flex-1">
                            {isLoading ? (
                              <div
                                className="absolute top-0 h-full rounded-[2px]"
                                style={{
                                  left: `${leftPercent}%`,
                                  width: `${Math.max(widthPercent * 0.55, 1.8)}%`,
                                  backgroundImage:
                                    "linear-gradient(90deg, rgba(245,158,11,0.75) 25%, rgba(255,255,255,0.55) 50%, rgba(245,158,11,0.75) 75%)",
                                  backgroundSize: "200% 100%",
                                  animation:
                                    "workflow-trace-bar-shimmer 1.1s linear infinite",
                                }}
                              />
                            ) : (
                              <div
                                className={cn(
                                  "absolute top-0 h-full rounded-[2px]",
                                  statusCfg.barClassName,
                                  isSelected ? "opacity-100" : "opacity-70",
                                )}
                                style={{
                                  left: `${leftPercent}%`,
                                  width: `${widthPercent}%`,
                                  transformOrigin: "left center",
                                  animation:
                                    node.status === "success" ||
                                    node.status === "error"
                                      ? "workflow-trace-bar-grow 360ms ease both"
                                      : undefined,
                                }}
                              />
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* ── Resize handle ──────────────────────────────────────── */}
              <button
                type="button"
                aria-label="Resize panels"
                className={cn(
                  "w-1 cursor-col-resize border-0 bg-transparent p-0 transition-colors hover:bg-blue-400/45",
                  isDraggingSplit && "bg-blue-500/60",
                )}
                onMouseDown={handleSplitMouseDown}
              />

              {/* ── Right: Output / Error / Loading ────────────────────── */}
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <TraceStatusIcon status={inspectorStatus} size={16} />
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {inspectorName}
                    </span>
                  </div>

                  {selectedWorkflowNode?.status === "success" &&
                    outputPayloadText && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(outputPayloadText, "output")
                          }
                          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
                        >
                          <CopyIcon className="size-3" />
                          {copiedState === "output" ? "Copied" : "Copy"}
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadOutput}
                          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
                        >
                          <DownloadIcon className="size-3" />
                          Download
                        </button>
                      </div>
                    )}
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-4">
                  {renderRightPanel()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
