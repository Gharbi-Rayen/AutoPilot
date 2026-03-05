import { GoogleFormExecutor } from "@/features/triggers/components/googleForm-trigger/executor";
import { manualTriggerExecutor } from "@/features/triggers/components/manual-trigger/executor";
import { StripeExecutor } from "@/features/triggers/components/stripe-trigger/executor";
import { NodeType } from "@/generated/prisma";
import { AnthropicExecutor } from "../anthropic/executor";
import { DiscordExecutor } from "../discord/executor";
import { EmailExecutor } from "../email/executor";
import { GeminiExecutor } from "../gemini/executor";
import { HttpRequestExecutor } from "../http-request/executor";
import { OpenAIExecutor } from "../openai/executor";
import { SlackExecutor } from "../slack/executor";
import { TelegramExecutor } from "../telegram/executor";
import type { NodeExecutor } from "../types";

export const executorRegistry: Record<NodeType, NodeExecutor> = {
  [NodeType.MANUAL_TRIGGER]: manualTriggerExecutor,
  [NodeType.HTTP_REQUEST]: HttpRequestExecutor,
  [NodeType.INITIAL]: manualTriggerExecutor,
  [NodeType.GOOGLE_FORM_TRIGGER]: GoogleFormExecutor,
  [NodeType.STRIPE_TRIGGER]: StripeExecutor,
  [NodeType.GEMINI]: GeminiExecutor,
  [NodeType.OPENAI]: OpenAIExecutor,
  [NodeType.ANTHROPIC]: AnthropicExecutor,
  [NodeType.DISCORD]: DiscordExecutor,
  [NodeType.SLACK]: SlackExecutor,
  [NodeType.TELEGRAM]: TelegramExecutor,
  [NodeType.EMAIL_SMTP]: EmailExecutor,
};

export const getExecutor = (type: NodeType): NodeExecutor => {
  const executor = executorRegistry[type];
  if (!executor) {
    throw new Error(`No executor found for node type: ${type}`);
  }

  return executor;
};
