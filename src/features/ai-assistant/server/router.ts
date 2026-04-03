/**
 * src/features/ai-assistant/server/router.ts
 *
 * Changes from previous version:
 *
 * 1. Retry with error feedback — if validateNodeParameters() finds empty required
 *    fields, we do NOT surface that to the user. Instead we call generateObject()
 *    a second time, passing the validation errors back to Gemini as explicit
 *    correction instructions. Only if the retry also fails do we throw a generic
 *    internal error (never blaming the user's prompt).
 *
 * 2. Clarification response type — if Gemini determines the prompt is genuinely
 *    too ambiguous, it returns { type: "clarification", questions: string[] }
 *    instead of a workflow. The panel renders these as questions to the user.
 *    A clear task like "find CSV duplicates and generate a PDF" must NOT trigger
 *    this — only genuinely under-specified prompts should.
 *
 * 3. Removed the "Try rephrasing your prompt" error — that was wrong to show
 *    when the failure was a Gemini generation problem, not a user problem.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { TRPCError } from "@trpc/server";
import { generateObject } from "ai";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { applyDagreLayout } from "../lib/layout";
import { NODE_CATALOG } from "../lib/system-prompt";
import {
  type AIWorkflowNode,
  type TopLevelResult,
  TopLevelSchema,
  validateNodeParameters,
} from "../lib/workflow-schema";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
});

// ─── Conversation input schemas ──────────────────────────────────────────────

const ConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  // When role is assistant and a workflow was generated, store it
  // as a JSON string so the agent can reference it for refinements
  workflowSnapshot: z.string().optional(),
});

const inputSchema = z.object({
  // The current user message
  prompt: z.string().min(1).max(2000),
  // All previous turns in this session (empty on first message)
  history: z.array(ConversationMessageSchema).default([]),
});

type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

function buildPromptWithHistory(
  userPrompt: string,
  history: ConversationMessage[],
  correctionHint?: string,
): string {
  let fullPrompt = "";

  if (history.length > 0) {
    fullPrompt += "CONVERSATION HISTORY (most recent first):\n";
    const recentHistory = history.slice(-6);
    for (const msg of recentHistory) {
      fullPrompt += `${msg.role.toUpperCase()}: ${msg.content}\n`;
      if (msg.workflowSnapshot) {
        fullPrompt += `[Previously generated workflow: ${msg.workflowSnapshot}]\n`;
      }
    }
    fullPrompt += "\n---\n";
  }

  fullPrompt += `USER: ${userPrompt}`;

  if (correctionHint) {
    fullPrompt +=
      "\n\n---\nCORRECTION REQUIRED: Previous attempt left these fields empty. " +
      "Fill them with real content:\n" +
      correctionHint;
  }

  return fullPrompt;
}

// ─── Generation helper ────────────────────────────────────────────────────────

async function attemptGeneration(
  input: z.infer<typeof inputSchema>,
  correctionHint?: string,
): Promise<TopLevelResult> {
  const prompt = buildPromptWithHistory(
    input.prompt,
    input.history,
    correctionHint,
  );
  try {
    const { object } = await generateObject({
      model: google("gemini-2.0-flash"),
      schema: TopLevelSchema,
      system: NODE_CATALOG,
      prompt,
    });

    return object;
  } catch (error) {
    // Log full error for debugging while keeping client-facing message generic
    // eslint-disable-next-line no-console
    console.error("generateObject failed:", error);
    throw error;
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const aiAssistantRouter = createTRPCRouter({
  generateWorkflow: protectedProcedure
    .input(inputSchema)
    .mutation(async ({ input }) => {
      // eslint-disable-next-line no-console
      console.log("router hit", input);
      // ── Attempt 1 ──────────────────────────────────────────────────────────
      const result = await attemptGeneration(input);

      if (result.type === "clarification" || result.type === "suggestion") {
        return result;
      }

      // ── Validate that generative fields (code, html, prompt…) are filled ──
      const errors = validateNodeParameters(result.nodes as AIWorkflowNode[]);

      if (errors.length > 0) {
        // ── Attempt 2: pass the exact errors back to Gemini ────────────────
        const correctionHint = errors
          .map((e) => `• Node "${e.nodeId}", field "${e.field}": ${e.issue}`)
          .join("\n");

        const retry = await attemptGeneration(input, correctionHint);

        if (retry.type === "clarification" || retry.type === "suggestion") {
          return retry;
        }

        const retryErrors = validateNodeParameters(
          retry.nodes as AIWorkflowNode[],
        );

        if (retryErrors.length > 0) {
          // Both attempts produced empty required fields.
          // This is an internal generation problem — do not blame the user.
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "The AI was unable to complete the workflow. Please try again.",
          });
        }

        // Retry succeeded — use the corrected result
        return {
          type: "workflow" as const,
          workflowName: retry.workflowName,
          explanation: retry.explanation,
          nodes: applyDagreLayout(retry.nodes as AIWorkflowNode[], retry.edges),
          edges: retry.edges,
          notes: retry.notes,
        };
      }

      // ── First attempt succeeded cleanly ────────────────────────────────────
      return {
        type: "workflow" as const,
        workflowName: result.workflowName,
        explanation: result.explanation,
        nodes: applyDagreLayout(result.nodes as AIWorkflowNode[], result.edges),
        edges: result.edges,
        notes: result.notes,
      };
    }),
});
