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
  AIWorkflowResponseSchema,
  validateNodeParameters,
} from "../lib/workflow-schema";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
});

// ─── Top-level response schema ────────────────────────────────────────────────
// Gemini can return either a complete workflow or a list of clarifying questions.
// We use a discriminated union on "type" so the panel knows which to render.

const TopLevelSchema = z.discriminatedUnion("type", [
  // Happy path — full workflow
  AIWorkflowResponseSchema.extend({ type: z.literal("workflow") }),

  // Ambiguous prompt — Gemini asks the user for more detail
  z.object({
    type: z.literal("clarification"),
    questions: z
      .array(z.string())
      .min(1)
      .max(3)
      .describe(
        "1-3 short specific questions to ask the user. " +
          "ONLY use this when critical information is truly missing and cannot be inferred. " +
          "DO NOT use this for clear requests like 'find CSV duplicates and make a PDF report' — " +
          "generate the workflow directly for those.",
      ),
  }),
]);

type TopLevelResult = z.infer<typeof TopLevelSchema>;

// ─── Generation helper ────────────────────────────────────────────────────────

async function attemptGeneration(
  userPrompt: string,
  correctionHint?: string,
): Promise<TopLevelResult> {
  const prompt = correctionHint
    ? `${userPrompt}\n\n---\nCORRECTION REQUIRED: A previous attempt left these ` +
      `fields empty. You MUST fill them with real content this time:\n${correctionHint}`
    : userPrompt;

  const { object } = await generateObject({
    model: google("gemini-2.0-flash"),
    schema: TopLevelSchema,
    system: NODE_CATALOG,
    prompt,
  });

  return object;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const aiAssistantRouter = createTRPCRouter({
  generateWorkflow: protectedProcedure
    .input(z.object({ prompt: z.string().min(10).max(1000) }))
    .mutation(async ({ input }) => {
      // ── Attempt 1 ──────────────────────────────────────────────────────────
      const result = await attemptGeneration(input.prompt);

      if (result.type === "clarification") {
        return { type: "clarification" as const, questions: result.questions };
      }

      // ── Validate that generative fields (code, html, prompt…) are filled ──
      const errors = validateNodeParameters(result.nodes as AIWorkflowNode[]);

      if (errors.length > 0) {
        // ── Attempt 2: pass the exact errors back to Gemini ────────────────
        const correctionHint = errors
          .map((e) => `• Node "${e.nodeId}", field "${e.field}": ${e.issue}`)
          .join("\n");

        const retry = await attemptGeneration(input.prompt, correctionHint);

        if (retry.type === "clarification") {
          return { type: "clarification" as const, questions: retry.questions };
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
          nodes: applyDagreLayout(retry.nodes as AIWorkflowNode[], retry.edges),
          edges: retry.edges,
          notes: retry.notes,
        };
      }

      // ── First attempt succeeded cleanly ────────────────────────────────────
      return {
        type: "workflow" as const,
        workflowName: result.workflowName,
        nodes: applyDagreLayout(result.nodes as AIWorkflowNode[], result.edges),
        edges: result.edges,
        notes: result.notes,
      };
    }),
});
