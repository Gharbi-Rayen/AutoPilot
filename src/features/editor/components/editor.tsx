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
import { useCallback, useEffect, useMemo, useState } from "react";

import "@xyflow/react/dist/style.css";

import { useAtomValue, useSetAtom } from "jotai";
import { Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { LoadingView, ErrorView } from "@/components/entity-components";
import { nodeComponents } from "@/config/node-components";
import { useSuspenseWorkflow } from "@/features/workflows/hooks/use-workflows";
import { NodeType } from "@/generated/prisma";
import { editorAtom } from "../store/atoms";

const AddNodeButton = dynamic(
  () => import("./add-node-button").then((m) => m.AddNodeButton),
  { ssr: false }, // No need to SSR the button if it opens a heavy modal, or we can just leave default
);
const ExecuteWorkflowButton = dynamic(
  () =>
    import("./execute-workflow-button").then((m) => m.ExecuteWorkflowButton),
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
  const { data: workflow } = useSuspenseWorkflow(workflowId);

  const setEditor = useSetAtom(editorAtom);
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
  return (
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
          <Panel position="bottom-center">
            <ExecuteWorkflowButton workflowId={workflowId} />
          </Panel>
        )}
      </ReactFlow>

      <AiGenerationIndicator />
    </div>
  );
};
