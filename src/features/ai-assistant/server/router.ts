import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";
import { NODE_CATALOG } from "../lib/system-prompt";
import { AIWorkflowResponseSchema } from "../lib/workflow-schema";
import { applyDagreLayout } from "../lib/layout";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
});

export const aiAssistantRouter = createTRPCRouter({
  generateWorkflow: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(10).max(1000),
      })
    )
    .mutation(async ({ input }) => {
      const { object } = await generateObject({
        model: google("gemini-2.5-flash"),
        schema: AIWorkflowResponseSchema,
        system: NODE_CATALOG,
        prompt: input.prompt,
      });

      // Assign positions using Dagre — AI never touches coordinates
      const laidOutNodes = applyDagreLayout(object.nodes, object.edges);

      return {
        workflowName: object.workflowName,
        nodes: laidOutNodes,
        edges: object.edges,
        notes: object.notes,
      };
    }),
});
