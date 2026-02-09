
import { NonRetriableError } from "inngest";
import prisma from "@/lib/db";
import { inngest } from "./client";
import { topologicalSort } from "./utils";
import type { NodeType } from "@/generated/prisma";
import { getExecutor } from "@/features/executions/components/lib/executor-registry";
import { HttpRequestChannel } from "./channels/http-request";
import { ManualTriggerChannel } from "./channels/manual-triggers";
import { GoogleFormTriggerChannel } from "./channels/google-form-trigger";


export const executeWorkflow = inngest.createFunction(
  { 
    id: "execute/workflow",
    retries: 0,// remove in production
  },
  { event: "workflows/execute.workflow" ,
    channels: [HttpRequestChannel() , ManualTriggerChannel(), GoogleFormTriggerChannel()],
  },
  async ({ event, step , publish }) => {
    console.log("[Inngest] executeWorkflow triggered with event:", {
      name: event.name,
      workflowId: event.data.workflowId,
      hasInitialData: !!event.data.initialData,
    });

    const workflowId = event.data.workflowId;
 
    if (!workflowId) {
      throw new NonRetriableError("No workflow ID provided");
    }

    const sortedNodes = await step.run("prepare-workflow", async () => {
      console.log("[Inngest] Fetching workflow:", workflowId);
      
      const workflow = await prisma.workflow.findUnique({
        where: { id: workflowId },
        include: {
          nodes: true,
          connections: true,
        },
      });

      if (!workflow) {
        console.error("[Inngest] Workflow not found:", workflowId);
        throw new NonRetriableError(`Workflow not found: ${workflowId}`);
      }

      console.log("[Inngest] Workflow found:", {
        id: workflow.id,
        name: workflow.name,
        nodeCount: workflow.nodes.length,
        connectionCount: workflow.connections.length,
      });

      return topologicalSort(workflow.nodes, workflow.connections);
    });

    //intialize context with any initial data from the trigger

    let context = event.data.initialData || {};
    console.log("[Inngest] Initial context:", JSON.stringify(context, null, 2));

    //execute each node

    console.log("[Inngest] Executing", sortedNodes.length, "nodes");

    for (const node of sortedNodes) {
      console.log("[Inngest] Executing node:", { id: node.id, type: node.type, name: node.name });
      
      try {
        const executor = getExecutor(node.type as NodeType);
        context = await executor(
          {
            data: node.data as Record<string, unknown>,
            nodeId: node.id,
            context,
            step,
            publish,
          }
        );
        
        console.log("[Inngest] Node completed:", node.id);
      } catch (error) {
        console.error("[Inngest] Node execution failed:", { 
          nodeId: node.id, 
          nodeType: node.type,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    };

    return {
       workflowId ,
       result : context, 
      };
  },
);
