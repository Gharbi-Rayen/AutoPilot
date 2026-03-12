import type { NodeTypes } from "@xyflow/react";

import { InitialNode } from "@/components/initial-node";
import { AnthropicNode } from "@/features/executions/components/anthropic/node";
import { CodeNode } from "@/features/executions/components/code/node";
import { DiscordNode } from "@/features/executions/components/discord/node";
import { EmailNode } from "@/features/executions/components/email/node";
import { GeminiNode } from "@/features/executions/components/gemini/node";
import { HttpRequestNode } from "@/features/executions/components/http-request/node";
import { OpenAINode } from "@/features/executions/components/openai/node";
import { SlackNode } from "@/features/executions/components/slack/node";
import { TelegramNode } from "@/features/executions/components/telegram/node";
import { WhatsAppNode } from "@/features/executions/components/whatsapp/node";
import { GoogleFormTrigger } from "@/features/triggers/components/googleForm-trigger/node";
import { ManualTriggerNode } from "@/features/triggers/components/manual-trigger/node";
import { StripeTriggerNode } from "@/features/triggers/components/stripe-trigger/node";
import { NodeType } from "@/generated/prisma";

export const nodeComponents: NodeTypes = {
  [NodeType.INITIAL]: InitialNode,
  [NodeType.MANUAL_TRIGGER]: ManualTriggerNode,
  [NodeType.HTTP_REQUEST]: HttpRequestNode,
  [NodeType.GOOGLE_FORM_TRIGGER]: GoogleFormTrigger,
  [NodeType.STRIPE_TRIGGER]: StripeTriggerNode,
  [NodeType.GEMINI]: GeminiNode,
  [NodeType.OPENAI]: OpenAINode,
  [NodeType.ANTHROPIC]: AnthropicNode,
  [NodeType.DISCORD]: DiscordNode,
  [NodeType.SLACK]: SlackNode,
  [NodeType.TELEGRAM]: TelegramNode,
  [NodeType.EMAIL_SMTP]: EmailNode,
  [NodeType.WHATSAPP]: WhatsAppNode,
  [NodeType.CODE]: CodeNode,
} as const satisfies NodeTypes;

export type RegisteredNodeType = keyof typeof nodeComponents;
