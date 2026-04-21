"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  MiniMap,
  type Node,
  type NodeChange,
  Panel,
  ReactFlow,
} from "@xyflow/react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import "@xyflow/react/dist/style.css";

import { useAtom, useSetAtom } from "jotai";
import dynamic from "next/dynamic";
import { ErrorView, LoadingView } from "@/components/entity-components";
import { nodeComponents } from "@/config/node-components";
import {
  useAutoSaveWorkflow,
  useSuspenseWorkflow,
} from "@/features/workflows/hooks/use-workflows";
import { cn } from "@/lib/utils";
import { workflowProgressPanelCollapsedAtom } from "@/store/execution-status";
import { NodeType } from "@/types/node-type";
import { editorAtom, workflowIdAtom } from "../store/atoms";

const AddNodeButton = dynamic(
  () => import("./add-node-button").then((m) => m.AddNodeButton),
  { ssr: false },
);
const QuickConnectSelector = dynamic(
  () => import("./quick-connect-selector").then((m) => m.QuickConnectSelector),
  { ssr: false },
);
const WorkflowProgressPanel = dynamic(
  () =>
    import("./workflow-progress-panel").then((m) => m.WorkflowProgressPanel),
  { ssr: false },
);

export const EditorLoading = () => {
  return <LoadingView message="Loading Editor ... " />;
};

export const EditorError = () => {
  return <ErrorView message="Failed to load the editor." />;
};

export const Editor = ({ workflowId }: { workflowId: string }) => {
  const DEFAULT_PANEL_HEIGHT = 360;
  const COLLAPSED_PANEL_HEIGHT = 12;
  const MIN_PANEL_HEIGHT = 220;
  const COLLAPSE_THRESHOLD_HEIGHT = MIN_PANEL_HEIGHT - 40;
  const DRAG_CLICK_THRESHOLD_PX = 5;
  const MAX_PANEL_HEIGHT_RATIO = 0.95;

  const { data: workflow } = useSuspenseWorkflow(workflowId);

  const setEditor = useSetAtom(editorAtom);
  const setWorkflowId = useSetAtom(workflowIdAtom);
  const [progressPanelCollapsed, setProgressPanelCollapsed] = useAtom(
    workflowProgressPanelCollapsedAtom,
  );

  useEffect(() => {
    setWorkflowId(workflowId);
  }, [workflowId, setWorkflowId]);
  const resizeStateRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    didDrag: boolean;
  } | null>(null);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [nodes, setNodes] = useState<Node[]>(workflow.nodes);
  const [edges, setEdges] = useState<Edge[]>(workflow.edges);

  const autoSave = useAutoSaveWorkflow();
  const hasInitializedRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSave.mutate({ id: workflowId, nodes, edges });
    }, 1500);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [nodes, edges, workflowId, autoSave.mutate]);

  // Reset nodes and edges only when switching workflows, not on background refetches
  // biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally only sync when workflow ID changes to prevent overwriting local changes on refetch
  useEffect(() => {
    setNodes(workflow.nodes);
    setEdges(workflow.edges);
  }, [workflow.id]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((nodesSnapshot) => applyNodeChanges(changes, nodesSnapshot)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((edgesSnapshot) => applyEdgeChanges(changes, edgesSnapshot)),
    [],
  );
  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)),
    [],
  );
  const hasManualTrigger = useMemo(() => {
    return nodes.some(
      (node) =>
        node.type !== NodeType.INITIAL &&
        node.type !== undefined,
    );
  }, [nodes]);

  const clampPanelHeight = useCallback((height: number) => {
    if (typeof window === "undefined") {
      return Math.max(MIN_PANEL_HEIGHT, height);
    }

    const maxPanelHeight = Math.max(
      MIN_PANEL_HEIGHT,
      Math.floor(window.innerHeight * MAX_PANEL_HEIGHT_RATIO),
    );

    return Math.min(maxPanelHeight, Math.max(MIN_PANEL_HEIGHT, height));
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setPanelHeight((previousHeight) => clampPanelHeight(previousHeight));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampPanelHeight]);

  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();

      const initialHeight = progressPanelCollapsed
        ? MIN_PANEL_HEIGHT
        : panelHeight;

      event.currentTarget.setPointerCapture(event.pointerId);
      resizeStateRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: initialHeight,
        didDrag: false,
      };

      document.body.style.userSelect = "none";
      document.body.style.cursor = "row-resize";
    },
    [panelHeight, progressPanelCollapsed],
  );

  const handleResizeMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }

      const deltaY = resizeState.startY - event.clientY;
      const nextHeight = resizeState.startHeight + deltaY;

      if (Math.abs(deltaY) > DRAG_CLICK_THRESHOLD_PX) {
        resizeState.didDrag = true;
      }

      if (nextHeight <= COLLAPSE_THRESHOLD_HEIGHT) {
        if (!progressPanelCollapsed) {
          setProgressPanelCollapsed(true);
        }
        return;
      }

      if (progressPanelCollapsed) {
        setProgressPanelCollapsed(false);
      }

      setPanelHeight(clampPanelHeight(nextHeight));
    },
    [
      clampPanelHeight,
      progressPanelCollapsed,
      setProgressPanelCollapsed,
      COLLAPSE_THRESHOLD_HEIGHT,
    ],
  );

  const handleResizeEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }

      const shouldToggleCollapsed = !resizeState.didDrag;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      resizeStateRef.current = null;

      if (shouldToggleCollapsed) {
        setProgressPanelCollapsed((previous) => !previous);
      }

      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    },
    [setProgressPanelCollapsed],
  );

  const flowBottomOffset = progressPanelCollapsed
    ? COLLAPSED_PANEL_HEIGHT + 4
    : panelHeight + 10;

  const panelContainerClassName = cn(
    "absolute bottom-0 z-40 overflow-hidden transition-[height] duration-200 ease-out",
    progressPanelCollapsed
      ? "inset-x-0"
      : "inset-x-0 border-t bg-background shadow-2xl",
  );

  return (
    <div className="size-full relative">
      <div className="size-full relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeComponents}
          onInit={setEditor}
          fitView
          snapGrid={[10, 10]}
          snapToGrid
          panOnScroll
          //panOnDrag = {false}
          //selectionOnDrag

          //  proOptions={{
          //     hideAttribution: true,
          // }}
        >
          <Background />
          <Controls />
          <MiniMap />
          <Panel position="top-right" className="flex gap-2">
            <AddNodeButton />
          </Panel>
          <QuickConnectSelector />
          {hasManualTrigger && (
            <Panel
              position="bottom-center"
              style={{ marginBottom: flowBottomOffset }}
            />
          )}
        </ReactFlow>
      </div>

      {hasManualTrigger && (
        <div
          className={panelContainerClassName}
          style={
            progressPanelCollapsed
              ? { height: COLLAPSED_PANEL_HEIGHT }
              : { height: panelHeight }
          }
        >
          {/* Drag handle — the only thing visible when collapsed */}
          <div
            className="absolute inset-x-0 top-0 z-20 flex h-3 touch-none select-none items-center justify-center"
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
          >
            <span
              className={cn(
                "h-1 w-10 rounded-full transition-colors",
                progressPanelCollapsed
                  ? "cursor-pointer bg-muted-foreground/40 hover:bg-blue-500/70"
                  : "cursor-row-resize bg-border/70 hover:bg-blue-500/65",
              )}
            />
          </div>
          {!progressPanelCollapsed && (
            <WorkflowProgressPanel
              nodes={nodes}
              edges={edges}
              workflowId={workflowId}
            />
          )}
        </div>
      )}
    </div>
  );
};
