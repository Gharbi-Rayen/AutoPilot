import { z } from "zod";
import { NodeType } from "@/generated/prisma";

export const AIWorkflowNodeSchema = z.object({
  id: z
    .string()
    .describe(
      "Unique snake_case node ID, e.g. 'trigger_1', 'summarize_gemini', 'notify_slack'"
    ),
  type: z
    .nativeEnum(NodeType)
    .describe("Must exactly match a NodeType enum value from the catalog"),
  data: z.object({
    label: z.string().describe("Short human-readable name shown on the node card"),
    parameters: z
      .record(z.unknown())
      .describe(
        "All node parameters. AI/HTTP nodes must include a variableName field. " +
        "Messaging nodes must include filled message/body content using {{variable}} syntax " +
        "when upstream AI or HTTP nodes are present. Never leave message fields as empty strings " +
        "if you have output variables available to reference."
      ),
  }),
});

export const AIWorkflowEdgeSchema = z.object({
  id: z.string().describe("Unique edge ID, e.g. 'edge_1', 'edge_2'"),
  source: z.string().describe("ID of the source (upstream) node"),
  target: z.string().describe("ID of the target (downstream) node"),
});

export const AIWorkflowResponseSchema = z.object({
  workflowName: z
    .string()
    .describe(
      "Short, descriptive workflow name, e.g. 'Stripe Payment to Slack Notifier'"
    ),
  nodes: z
    .array(AIWorkflowNodeSchema)
    .min(2)
    .describe("Must include at least one trigger and one action node"),
  edges: z
    .array(AIWorkflowEdgeSchema)
    .min(1)
    .describe("Every node except the trigger must be connected to at least one other node"),
  notes: z
    .string()
    .describe(
      "Specific list of what the user must still configure manually. " +
      "Reference the exact node ID and exact parameter name. " +
      "Example: 'notify_slack -> webhookUrl: paste your Slack incoming webhook URL here. " +
      "stripe_trigger -> eventType: change to the Stripe event you want to listen for.'"
    ),
});

export type AIWorkflowResponse = z.infer<typeof AIWorkflowResponseSchema>;
export type AIWorkflowNode = z.infer<typeof AIWorkflowNodeSchema>;
