import dagre from "@dagrejs/dagre";
import type { AIWorkflowNode } from "./workflow-schema";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 70;

export function applyDagreLayout(
  nodes: AIWorkflowNode[],
  edges: { source: string; target: string }[]
): (AIWorkflowNode & { position: { x: number; y: number } })[] {
  const g = new dagre.graphlib.Graph();

  g.setGraph({
    rankdir: "LR",   // left-to-right (matches typical workflow reading direction)
    nodesep: 80,     // vertical gap between nodes in the same rank
    ranksep: 140,    // horizontal gap between ranks
    marginx: 40,
    marginy: 40,
  });

  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const { x, y } = g.node(node.id);
    return {
      ...node,
      position: {
        x: x - NODE_WIDTH / 2,
        y: y - NODE_HEIGHT / 2,
      },
    };
  });
}
