"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { ErrorView, LoadingView } from "@/components/entity-components";
import { nodeComponents } from "@/config/node-components";
import { useSuspenseWorkflow } from "@/features/workflows/hooks/use-workflows";
import { AddNodeButton } from "./add-node-button";

export const EditorLoading = () => {

    return <LoadingView message="Loading Editor ... "/>;
};

 export const EditorError = () => {
    return <ErrorView message="Failed to load the editor."/>;
};





export const Editor = ({workflowId} : {workflowId: string}) => {
    const {data: workflow} = useSuspenseWorkflow(workflowId);

    const [nodes, setNodes] = useState<Node[]>(workflow.nodes);
    const [edges, setEdges] = useState<Edge[]>(workflow.edges);

    // Reset nodes and edges only when switching workflows, not on background refetches
    // biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally only sync when workflow ID changes to prevent overwriting local changes on refetch
    useEffect(() => {
        setNodes(workflow.nodes);
        setEdges(workflow.edges);
    }, [workflow.id]);

    const onNodesChange = useCallback(
    (changes : NodeChange[]) => setNodes((nodesSnapshot) => applyNodeChanges(changes, nodesSnapshot)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes : EdgeChange[]) => setEdges((edgesSnapshot) => applyEdgeChanges(changes, edgesSnapshot)),
    [],
  );
  const onConnect = useCallback(
    (params : Connection) => setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)),
    [],
  );

        return (
        <div className="size-full">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeComponents}
                fitView
              //  proOptions={{
              //     hideAttribution: true,
              // }}
            >
                <Background />
                <Controls />
                <MiniMap />
                <Panel position="top-right">
                    <AddNodeButton onClick={() => { /* TODO: implement add node logic */ }} />
                </Panel>
            </ReactFlow>
        </div>
    );
};