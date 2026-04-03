import toposort from "toposort";
import type { Connection, Node } from "@/generated/prisma";
import { inngest } from "./client";

export const topologicalSort = (
  nodes: Node[],
  connections: Connection[],
): Node[] => {
  // If there are no connections, return the nodes as is
  if (connections.length === 0) {
    return nodes;
  }

  //create the edges array for toposort
  const edges: [string, string][] = connections.map((connection) => [
    connection.fromNodeId,
    connection.toNodeId,
  ]);

  let sortedNodeIds: string[];

  try {
    sortedNodeIds = toposort(edges);
    //remove duplicates
    sortedNodeIds = [...new Set(sortedNodeIds)];
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cyclic")) {
      throw new Error("Workflow contains a cycle, which is not allowed.");
    }
    throw error;
  }

  // Find isolated nodes (nodes that were not part of any connection)
  const connectedNodeIds = new Set(sortedNodeIds);
  const isolatedNodes = nodes.filter((node) => !connectedNodeIds.has(node.id));

  // Combine connected nodes (in topological order) with isolated nodes
  // We map sorted IDs back to nodes first
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const sortedNodes = sortedNodeIds
    .map((id) => nodeMap.get(id))
    .filter((node): node is Node => Boolean(node));

  return [...sortedNodes, ...isolatedNodes];
};

export type WorkflowExecutionPayload = {
  workflowId: string;
  [key: string]: unknown;
};

export const sendWorkflowExecution = async (data: WorkflowExecutionPayload) => {
  return inngest.send({
    name: "workflows/execute.workflow",
    data,
  });
};
