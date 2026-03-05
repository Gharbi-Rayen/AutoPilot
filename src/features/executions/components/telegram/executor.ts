import Handlebars from "handlebars";
import { NonRetriableError } from "inngest";
import ky from "ky";
import type { NodeExecutor } from "@/features/executions/components/types";
import { TelegramChannel } from "@/inngest/channels/telegram";
import prisma from "@/lib/db";

Handlebars.registerHelper("json", (context: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(context, null, 2));
});

const TELEGRAM_MAX_TEXT_LENGTH = 4096;
const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

type TelegramData = {
  credentialId?: string;
  variableName?: string;
  chatId?: string;
  text?: string;
  parseMode?: "HTML" | "MarkdownV2" | "none";
};

export const TelegramExecutor: NodeExecutor<TelegramData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  userId,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    return await publish(
      TelegramChannel().status({
        nodeId,
        status: state,
      }),
    );
  };

  await updateStatePublish("loading");

  if (!data.variableName) {
    await updateStatePublish("error");
    throw new NonRetriableError("Variable name is required");
  }

  if (!data.chatId) {
    await updateStatePublish("error");
    throw new NonRetriableError("Chat ID is required");
  }

  if (!data.text) {
    await updateStatePublish("error");
    throw new NonRetriableError("Message text is required");
  }

  if (!data.credentialId) {
    await updateStatePublish("error");
    throw new NonRetriableError(
      "Telegram Bot Token is required. Please configure a bot token credential in the node settings.",
    );
  }

  const credential = await step.run("fetch-telegram-credential", async () => {
    const cred = await prisma.credentials.findUnique({
      where: { id: data.credentialId, userId },
    });
    if (!cred) {
      throw new NonRetriableError(
        "Bot token credential not found or access denied. It may have been deleted.",
      );
    }
    return cred;
  });

  const botToken = credential.value;
  const chatId = Handlebars.compile(data.chatId)(context);
  let messageText = Handlebars.compile(data.text)(context);

  // Truncate if exceeding Telegram's 4096 char limit
  if (messageText.length > TELEGRAM_MAX_TEXT_LENGTH) {
    messageText = `${messageText.substring(0, TELEGRAM_MAX_TEXT_LENGTH - 14)} [truncated]`;
  }

  try {
    const result = await step.run("telegram-send-message", async () => {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text: messageText,
      };

      if (data.parseMode && data.parseMode !== "none") {
        payload.parse_mode = data.parseMode;
      }

      const response = await ky
        .post(`${TELEGRAM_API_BASE}${botToken}/sendMessage`, {
          json: payload,
        })
        .json<{
          ok: boolean;
          result?: {
            message_id: number;
            chat: { id: number };
          };
          description?: string;
        }>();

      const timestamp = new Date().toISOString();

      if (response.ok && response.result) {
        return {
          success: true,
          messageId: String(response.result.message_id),
          chatId,
          timestamp,
          provider: "telegram",
        };
      }

      return {
        success: false,
        timestamp,
        provider: "telegram",
        error: response.description || "Unknown Telegram API error",
      };
    });

    await updateStatePublish("success");

    return {
      ...context,
      [data.variableName]: result,
    };
  } catch (error) {
    await updateStatePublish("error");
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new NonRetriableError(
      `Failed to send Telegram message: ${errorMessage}`,
    );
  }
};
