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

import { useAtomValue, useSetAtom } from "jotai";
import dynamic from "next/dynamic";
import { ErrorView, LoadingView } from "@/components/entity-components";
import { nodeComponents } from "@/config/node-components";
import { useSuspenseWorkflow } from "@/features/workflows/hooks/use-workflows";
import { NodeType } from "@/generated/prisma";
import { cn } from "@/lib/utils";
import { workflowProgressPanelCollapsedAtom } from "@/store/execution-status";
import { editorAtom } from "../store/atoms";

const AddNodeButton = dynamic(
  () => import("./add-node-button").then((m) => m.AddNodeButton),
  { ssr: false }, // No need to SSR the button if it opens a heavy modal, or we can just leave default
);
const WorkflowProgressPanel = dynamic(
  () =>
    import("./workflow-progress-panel").then((m) => m.WorkflowProgressPanel),
  { ssr: false },
);

import { AiAssistantTrigger } from "@/features/ai-assistant/components/ai-assistant-trigger";
import { AiGenerationIndicator } from "@/features/ai-assistant/components/ai-generation-indicator";

const AiAssistantPanel = dynamic(
  () =>
    import("@/features/ai-assistant/components/ai-assistant-panel").then(
      (m) => m.AiAssistantPanel,
    ),
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
  const COLLAPSED_PANEL_HEIGHT = 56;
  const MIN_PANEL_HEIGHT = 220;
  const MAX_PANEL_HEIGHT_RATIO = 0.8;

  const { data: workflow } = useSuspenseWorkflow(workflowId);

  const setEditor = useSetAtom(editorAtom);
  const progressPanelCollapsed = useAtomValue(
    workflowProgressPanelCollapsedAtom,
  );
  const resizeStateRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [nodes, setNodes] = useState<Node[]>(workflow.nodes);
  const [edges, setEdges] = useState<Edge[]>(workflow.edges);

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
    return nodes.some((node) => node.type === NodeType.MANUAL_TRIGGER);
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
      if (progressPanelCollapsed) {
        return;
      }

      event.preventDefault();

      event.currentTarget.setPointerCapture(event.pointerId);
      resizeStateRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: panelHeight,
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
      setPanelHeight(clampPanelHeight(resizeState.startHeight + deltaY));
    },
    [clampPanelHeight],
  );

  const handleResizeEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }

      event.currentTarget.releasePointerCapture(event.pointerId);
      resizeStateRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    },
    [],
  );

  const flowBottomOffset = progressPanelCollapsed
    ? COLLAPSED_PANEL_HEIGHT + 8
    : panelHeight + 10;

  const panelContainerClassName = cn(
    "absolute inset-x-0 bottom-0 z-40 overflow-hidden border-t bg-background shadow-2xl",
    progressPanelCollapsed && "h-14",
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
            <AiAssistantTrigger />
            <AddNodeButton />
          </Panel>
          <AiAssistantPanel />
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
          style={progressPanelCollapsed ? undefined : { height: panelHeight }}
        >
          {!progressPanelCollapsed && (
            <div
              className="absolute inset-x-0 top-0 z-20 h-5 cursor-row-resize touch-none select-none flex items-start justify-center pt-1"
              onPointerDown={handleResizeStart}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              onPointerCancel={handleResizeEnd}
            >
              <span className="h-1.5 w-14 rounded-full bg-border/80 shadow-sm" />
            </div>
          )}
          <WorkflowProgressPanel nodes={nodes} workflowId={workflowId} />
        </div>
      )}

      <AiGenerationIndicator />
    </div>
  );
};
