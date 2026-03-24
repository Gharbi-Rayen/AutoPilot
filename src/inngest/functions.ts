import { randomUUID } from "node:crypto";
import { NonRetriableError } from "inngest";
import { getExecutor } from "@/features/executions/components/lib/executor-registry";
import type { NodeType } from "@/generated/prisma";
import prisma from "@/lib/db";
import { AnthropicChannel } from "./channels/anthropic";
import { CodeChannel } from "./channels/code";
import { DiscordChannel } from "./channels/discord";
import { EmailChannel } from "./channels/email";
import { GeminiChannel } from "./channels/gemini";
import { GoogleFormTriggerChannel } from "./channels/google-form-trigger";
import { HttpRequestChannel } from "./channels/http-request";
import { ManualTriggerChannel } from "./channels/manual-triggers";
import { OpenAIChannel } from "./channels/openai";
import { SlackChannel } from "./channels/slack";
import { StripeTriggerChannel } from "./channels/stripe-trigger";
import { TelegramChannel } from "./channels/telegram";
import { WhatsAppChannel } from "./channels/whatsapp";
import { inngest } from "./client";
import { topologicalSort } from "./utils";

export const executeWorkflow = inngest.createFunction(
  {
    id: "execute/workflow",
    retries: 0, // remove in production
  },
  {
    event: "workflows/execute.workflow",
    channels: [
      HttpRequestChannel(),
      ManualTriggerChannel(),
      GoogleFormTriggerChannel(),
      StripeTriggerChannel(),
      GeminiChannel(),
      OpenAIChannel(),
      AnthropicChannel(),
      DiscordChannel(),
      SlackChannel(),
      TelegramChannel(),
      EmailChannel(),
      WhatsAppChannel(),
      CodeChannel(),
    ],
  },
  async ({ event, step, publish }) => {
    console.log("[Inngest] executeWorkflow triggered with event:", {
      name: event.name,
      workflowId: event.data.workflowId,
      hasInitialData: !!event.data.initialData,
    });

    const workflowId = event.data.workflowId;

    if (!workflowId) {
      throw new NonRetriableError("No workflow ID provided");
    }

    // 1. Get or Create Execution Record
    const executionId = await step.run("get-or-create-execution", async () => {
      // If passed from manual trigger, use that ID
      if (
        event.data.executionId &&
        typeof event.data.executionId === "string"
      ) {
        return event.data.executionId;
      }

      // Check if already exists by Inngest Event ID (idempotency)
      if (event.id) {
        const existing = await prisma.execution.findUnique({
          where: { inngestEventId: event.id },
          select: { id: true },
        });

        if (existing) {
          return existing.id;
        }
      }

      // Create new execution record
      const newExecution = await prisma.execution.create({
        data: {
          workflowId,
          status: "RUNNING",
          inngestEventId: event.id ?? randomUUID(),
          startedAt: new Date(),
        },
        select: { id: true },
      });

      return newExecution.id;
    });

    const workflowData = await step.run("prepare-workflow", async () => {
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

      return {
        userId: workflow.userId,
        sortedNodes: topologicalSort(workflow.nodes, workflow.connections),
      };
    });

    const { sortedNodes } = workflowData;

    // Resolve the workflow owner for credential ownership checks
    const ownerId = await step.run("find-user-id", async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: workflowData.userId },
        select: { id: true },
      });
      return user.id;
    });

    //intialize context with any initial data from the trigger

    let context = event.data.initialData || {};
    console.log("[Inngest] Initial context:", JSON.stringify(context, null, 2));

    try {
      //execute each node

      console.log("[Inngest] Executing", sortedNodes.length, "nodes");

      for (const node of sortedNodes) {
        console.log("[Inngest] Executing node:", {
          id: node.id,
          type: node.type,
          name: node.name,
        });

        const executor = getExecutor(node.type as NodeType);
        const output = await executor({
          data: node.data as Record<string, unknown>,
          nodeId: node.id,
          context,
          step,
          publish,
          userId: ownerId,
        });

        context = {
          ...context,
          ...output,
        };

        console.log("[Inngest] Node completed:", node.id);
      }

      // Mark execution as SUCCESS
      await step.run("complete-execution", async () => {
        await prisma.execution.update({
          where: { id: executionId },
          data: {
            status: "SUCCESS",
            finishedAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            output: context as any,
          },
        });
      });
    } catch (error) {
      console.error("[Inngest] Workflow execution failed:", {
        workflowId,
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Mark execution as FAILED
      await step.run("fail-execution", async () => {
        await prisma.execution.update({
          where: { id: executionId },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
          },
        });
      });

      throw error; // Re-throw to allow Inngest retries if configured (though retries=0 currently)
    }

    return {
      workflowId,
      result: context,
    };
  },
);
