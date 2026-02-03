
import { NonRetriableError } from "inngest";
import prisma from "@/lib/db";
import { inngest } from "./client";
import { topologicalSort } from "./utils";
import type { NodeType } from "@/generated/prisma";
import { getExecutor } from "@/features/executions/components/lib/executor-registry";
import { HttpRequestChannel } from "./channels/http-request";
import { ManualTriggerChannel } from "./channels/manual-triggers";


export const executeWorkflow = inngest.createFunction(
  { 
    id: "execute/workflow",
    retries: 0,// remove in production
  },
  { event: "workflows/execute.workflow" ,
    channels: [HttpRequestChannel() , ManualTriggerChannel()],
  },
  async ({ event, step , publish }) => {
    const workflowId = event.data.workflowId;
 
    if (!workflowId) {
      throw new NonRetriableError("No workflow ID provided");
    }

    const sortedNodes = await step.run("prepare-workflow", async () => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: { id: workflowId },
        include: {
          nodes: true,
          connections: true,
        },
      });

      return topologicalSort(workflow.nodes, workflow.connections);
    });

    //intialize context with any initial data from the trigger

    let context = event.data.initialData || {};

    //execute each node

    for (const node of sortedNodes) {
      const executor = getExecutor(node.type as NodeType);
      context =  await executor(
        {
          data :node.data as Record<string, unknown>,
          nodeId: node.id,
          context,
          step,
          publish,
        }
      );

    };

    return {
       workflowId ,
       result : context, 
      };
  },
);
