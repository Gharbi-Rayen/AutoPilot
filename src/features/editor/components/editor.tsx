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

import { useSetAtom, useAtomValue } from "jotai";
import { ErrorView, LoadingView } from "@/components/entity-components";
import { nodeComponents } from "@/config/node-components";
import { useSuspenseWorkflow } from "@/features/workflows/hooks/use-workflows";
import dynamic from "next/dynamic";
import { NodeType } from "@/generated/prisma";
import { editorAtom } from "../store/atoms";
import { aiGeneratingAtom } from "@/features/ai-assistant/store/atoms";
import { Sparkles } from "lucide-react";

const AddNodeButton = dynamic(
  () => import("./add-node-button").then((m) => m.AddNodeButton),
  { ssr: false } // No need to SSR the button if it opens a heavy modal, or we can just leave default
);
const ExecuteWorkflowButton = dynamic(
  () => import("./execute-workflow-button").then((m) => m.ExecuteWorkflowButton),
  { ssr: false }
);

import { AiAssistantTrigger } from "@/features/ai-assistant/components/ai-assistant-trigger";

const AiAssistantPanel = dynamic(
  () => import("@/features/ai-assistant/components/ai-assistant-panel").then((m) => m.AiAssistantPanel),
  { ssr: false }
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
  const isAiGenerating = useAtomValue(aiGeneratingAtom);
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

      {/* AI Generating Overlay */}
      {isAiGenerating && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-background/60 backdrop-blur-[2px] transition-all duration-300">
           <div className="flex flex-col items-center gap-4 p-6 bg-background rounded-xl border shadow-lg max-w-sm w-full text-center">
             <div className="flex bg-primary/10 p-4 rounded-full">
               <Sparkles className="w-8 h-8 text-primary animate-pulse" />
             </div>
             <div className="space-y-1">
               <h3 className="font-semibold text-lg">AI is building your workflow</h3>
               <p className="text-sm text-muted-foreground">Selecting nodes and wiring variables...</p>
             </div>
             <div className="w-full h-1.5 bg-secondary/50 rounded-full overflow-hidden mt-4">
               <div className="h-full bg-primary/80 w-full animate-pulse" />
             </div>
           </div>
        </div>
      )}
    </div>
  );
};
