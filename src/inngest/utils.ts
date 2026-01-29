import toposort from "toposort";
import { Node , Connection} from "@/generated/prisma";
import { boolean } from "zod";



export const topologicalSort = (
    nodes: Node[],
    connections : Connection[],
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
        //add nodes with no connections as self edges to ensure they are included
       const connectedNodeIds = new Set<string>();
        for (const conn of connections) {
            connectedNodeIds.add(conn.fromNodeId);
            connectedNodeIds.add(conn.toNodeId);
        }
        
        for (const node of nodes) {

            if (!connectedNodeIds.has(node.id)) {
                edges.push([node.id, node.id]);
            }
        }
        // Perform topological sort

        let sortedNodeIds : string[];

        try{
            sortedNodeIds = toposort(edges);
            //remove duplicates from self edges
            sortedNodeIds = [...new Set(sortedNodeIds)];
        } catch (error) {
            if (error instanceof Error && error.message.includes("Cyclic")) {
                throw new Error("Workflow contains a cycle, which is not allowed.");
            }
           throw error;
        }

        // Map sorted IDs back to nodes
        const nodeMap = new Map(nodes.map((node) => [node.id, node]));

        return sortedNodeIds.map((id) => nodeMap.get(id)!).filter(Boolean);
    };