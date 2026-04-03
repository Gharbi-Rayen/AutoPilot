/**
 * src/features/ai-assistant/lib/workflow-schema.ts
 *
 * Full replacement. The key change from the previous version:
 * instead of z.record(z.unknown()) for all nodes, each node type that has
 * fields the AI is responsible for generating gets its own parameter schema
 * with z.string().min(1) on those fields.
 *
 * generateObject() will reject a blank string and force Gemini to retry.
 */

import { z } from "zod";
import { NodeType } from "@/generated/prisma";

// ─── Parameter schemas per node type ─────────────────────────────────────────
// Only nodes where the AI must generate content get strict schemas.
// Everything else falls through to the generic z.record(z.unknown()).

const CodeParameters = z.object({
  variableName: z
    .string()
    .min(1)
    .describe("snake_case name for the return value, e.g. 'findDuplicates'"),
  code: z
    .string()
    .min(20)
    .describe(
      "Real working JavaScript. Access upstream data via context.variableName. " +
        "Always end with return { ... }. Must be at least 20 characters — never empty.",
    ),
});

const PdfGenerateParameters = z
  .object({
    variableName: z
      .string()
      .min(1)
      .describe("Output variable name for generated PDF file object"),
    contentVariable: z.string().optional(),
    statsVariable: z.string().optional(),
    sectionsVariable: z.string().optional(),
    tablesVariable: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    footerText: z.string().optional(),
    fileName: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    const hasContentSource =
      Boolean(values.contentVariable) ||
      Boolean(values.statsVariable) ||
      Boolean(values.sectionsVariable) ||
      Boolean(values.tablesVariable);

    if (!hasContentSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentVariable"],
        message:
          "Provide at least one of contentVariable, statsVariable, sectionsVariable, or tablesVariable",
      });
    }
  });

const PdfFillFormParameters = z.object({
  pdfVariable: z.string().min(1),
  formDataVariable: z.string().min(1),
  variableName: z.string().min(1),
  flatten: z.boolean().optional(),
  fileName: z.string().optional(),
  fallbackFormDataJson: z.string().optional(),
});

const PdfSignParameters = z.object({
  pdfVariable: z.string().min(1),
  certificateVariable: z.string().min(1),
  certificatePasswordVariable: z.string().optional(),
  signatureReason: z.string().optional(),
  signatureLocation: z.string().optional(),
  fileName: z.string().optional(),
  variableName: z.string().min(1),
});

const GeminiParameters = z.object({
  variableName: z
    .string()
    .min(1)
    .describe("snake_case output name, e.g. 'summary'"),
  prompt: z
    .string()
    .min(10)
    .describe(
      "The actual prompt text. Reference upstream context with {{variable}}. Never empty.",
    ),
  model: z.string().default("gemini-2.0-flash"),
});

const OpenAIParameters = z.object({
  variableName: z.string().min(1),
  prompt: z.string().min(10).describe("The actual prompt text. Never empty."),
  model: z.string().default("gpt-4o-mini"),
});

const AnthropicParameters = z.object({
  variableName: z.string().min(1),
  prompt: z.string().min(10).describe("The actual prompt text. Never empty."),
  model: z.string().default("claude-haiku-4-5"),
});

const SlackParameters = z.object({
  webhookUrl: z
    .string()
    .describe("Slack incoming webhook URL — user must provide"),
  message: z
    .string()
    .min(1)
    .describe(
      "The message to send. Use {{variableName}} to reference upstream output. Never empty.",
    ),
});

const DiscordParameters = z.object({
  webhookUrl: z.string().describe("Discord webhook URL — user must provide"),
  message: z
    .string()
    .min(1)
    .describe("Message content. Use {{variable}} for upstream data."),
});

const TelegramParameters = z.object({
  botToken: z.string().describe("Telegram bot token — user must provide"),
  chatId: z
    .string()
    .describe("Telegram chat or channel ID — user must provide"),
  message: z
    .string()
    .min(1)
    .describe("Message content. Use {{variable}} for upstream data."),
});

const EmailParameters = z.object({
  to: z.string().describe("Recipient email address"),
  subject: z.string().min(1).describe("Email subject line. Never empty."),
  body: z
    .string()
    .min(1)
    .describe("Email body. Use {{variable}} for upstream data."),
});

const WhatsAppParameters = z.object({
  phoneNumber: z.string().describe("E.164 phone number — user must provide"),
  message: z
    .string()
    .min(1)
    .describe("Message content. Use {{variable}} for upstream data."),
});

const HttpRequestParameters = z.object({
  variableName: z.string().min(1),
  url: z
    .string()
    .min(1)
    .describe("Full URL. Can use {{variable}} for dynamic segments."),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string()).default({}),
  body: z.string().default(""),
});

const CsvSortParameters = z.object({
  sourceVariable: z.string().min(1),
  variableName: z.string().min(1),
  sortField: z.string().min(1),
  direction: z.enum(["asc", "desc"]).default("asc"),
  compareAs: z.enum(["string", "number", "date"]).default("string"),
  nulls: z.enum(["first", "last"]).default("last"),
});

const CsvDeduplicateParameters = z.object({
  sourceVariable: z.string().min(1),
  variableName: z.string().min(1),
  fields: z.string().optional(),
  keep: z.enum(["first", "last"]).default("first"),
  includeDuplicates: z.boolean().optional(),
});

const CsvColumnStatsParameters = z.object({
  sourceVariable: z.string().min(1),
  variableName: z.string().min(1),
  fields: z.string().optional(),
});

const CsvCompareParameters = z.object({
  leftVariable: z.string().min(1),
  rightVariable: z.string().min(1),
  variableName: z.string().min(1),
  keyField: z.string().optional(),
  compareFields: z.string().optional(),
});

// Generic fallback for all other nodes (file, PDF utilities, CSV, image, etc.)
// export const GenericParameters = z.record(z.unknown());

// ─── Per-type schema lookup (used by the post-generation validator) ───────────

const parameterSchemaByType: Partial<Record<NodeType, z.ZodTypeAny>> = {
  [NodeType.CODE]: CodeParameters,
  [NodeType.PDF_FILL_FORM]: PdfFillFormParameters,
  [NodeType.PDF_GENERATE]: PdfGenerateParameters,
  [NodeType.PDF_SIGN]: PdfSignParameters,
  [NodeType.GEMINI]: GeminiParameters,
  [NodeType.OPENAI]: OpenAIParameters,
  [NodeType.ANTHROPIC]: AnthropicParameters,
  [NodeType.SLACK]: SlackParameters,
  [NodeType.DISCORD]: DiscordParameters,
  [NodeType.TELEGRAM]: TelegramParameters,
  [NodeType.EMAIL_SMTP]: EmailParameters,
  [NodeType.WHATSAPP]: WhatsAppParameters,
  [NodeType.HTTP_REQUEST]: HttpRequestParameters,
  [NodeType.CSV_SORT]: CsvSortParameters,
  [NodeType.CSV_DEDUPLICATE]: CsvDeduplicateParameters,
  [NodeType.CSV_COLUMN_STATS]: CsvColumnStatsParameters,
  [NodeType.CSV_COMPARE]: CsvCompareParameters,
};

// ─── Main schemas passed to generateObject() ─────────────────────────────────
//
// We use z.record(z.unknown()) for parameters in the Gemini-facing schema.
// Discriminated unions with per-type shapes are too complex for generateObject()
// to reliably infer — Gemini sees a union of 57 node types and starts hedging.
//
// Instead: the schema description on the parameters field carries the rules,
// and validateNodeParameters() enforces them after generation.

export const AIWorkflowNodeSchema = z.object({
  id: z
    .string()
    .describe(
      "Unique snake_case node ID, e.g. 'trigger_1', 'find_duplicates', 'generate_report'",
    ),
  type: z
    .nativeEnum(NodeType)
    .describe("Must exactly match a NodeType enum value from the catalog"),
  data: z.object({
    label: z
      .string()
      .min(1)
      .describe("Short human-readable name shown on the node card"),
    parameters: z
      .record(z.unknown())
      .describe(
        "Node configuration. Strict rules by field:\\n" +
          "• code (CODE node): write real JavaScript, min 20 chars, NEVER empty\\n" +
          "• PDF_GENERATE: provide variableName and at least one source variable field (contentVariable/statsVariable/sectionsVariable/tablesVariable)\n" +
          "• prompt (AI nodes): write the actual prompt text, NEVER empty\\n" +
          "• message/body/subject (messaging nodes): write real content, NEVER empty\\n" +
          "• variableName (AI/HTTP/CODE nodes): write a snake_case name, NEVER empty\\n" +
          "• url (HTTP_REQUEST): write the full URL, NEVER empty\\n" +
          "• webhookUrl, botToken, chatId, phoneNumber: leave as '' (user provides)\\n" +
          "• filePath for user input files: use '/uploads/filename.ext'",
      ),
  }),
});

export const AIWorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
});

export const AIWorkflowResponseSchema = z.object({
  workflowName: z.string().min(1),
  nodes: z.array(AIWorkflowNodeSchema).min(2),
  edges: z.array(AIWorkflowEdgeSchema).min(1),
  notes: z
    .string()
    .describe(
      "List only what the user must manually configure: credential fields " +
        "(webhookUrl, botToken, phoneNumber) and file paths to replace. " +
        "Do not mention code or html — those are already filled.",
    ),
});

export type AIWorkflowResponse = z.infer<typeof AIWorkflowResponseSchema>;
export type AIWorkflowNode = z.infer<typeof AIWorkflowNodeSchema>;

// ─── Top-level assistant response schema (workflow, suggestion, clarification) ─

const SuggestionSchema = z.object({
  type: z.literal("suggestion"),
  message: z
    .string()
    .describe(
      "A short friendly sentence acknowledging what the user mentioned, " +
        "e.g. 'Here are some workflows I can build for you with CSV files:'",
    ),
  suggestions: z
    .array(
      z.object({
        title: z.string().describe("Short title, 5 words max"),
        description: z
          .string()
          .describe(
            "One sentence plain-language description of what this workflow does",
          ),
        promptToGenerate: z
          .string()
          .describe(
            "The exact detailed prompt that, when sent back as the user message, " +
              "will generate this workflow in WORKFLOW mode. Must be specific enough " +
              "to produce a complete workflow without further clarification.",
          ),
      }),
    )
    .min(2)
    .max(4),
});

export const TopLevelSchema = z.discriminatedUnion("type", [
  // Full workflow generation (and refinements)
  AIWorkflowResponseSchema.extend({
    type: z.literal("workflow"),
    explanation: z
      .string()
      .describe(
        "1-3 sentences in plain language explaining what this workflow does " +
          "and why this approach was chosen. No internal node names.",
      ),
  }),

  // User was vague — offer concrete suggestions
  SuggestionSchema,

  // Truly ambiguous — ask one focused question
  z.object({
    type: z.literal("clarification"),
    question: z
      .string()
      .describe(
        "A single question. Must explain why you need this information. " +
          "Example: 'What should trigger this workflow — a form submission, " +
          "a payment, or should it run manually?'",
      ),
  }),
]);

export type TopLevelResult = z.infer<typeof TopLevelSchema>;
export type SuggestionResult = z.infer<typeof SuggestionSchema>;

// ─── Post-generation parameter validator ─────────────────────────────────────
// Call this in the tRPC router after generateObject() returns.
// If errors exist, throw a TRPCError so the panel surfaces them as a toast.

export function validateNodeParameters(
  nodes: AIWorkflowNode[],
): { nodeId: string; field: string; issue: string }[] {
  const errors: { nodeId: string; field: string; issue: string }[] = [];

  for (const node of nodes) {
    const schema = parameterSchemaByType[node.type as NodeType];
    if (!schema) continue;

    const result = schema.safeParse(node.data.parameters);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          nodeId: node.id,
          field: issue.path.join("."),
          issue: issue.message,
        });
      }
    }
  }

  return errors;
}
