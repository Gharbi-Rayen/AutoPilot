import Handlebars from "handlebars";
import { NonRetriableError } from "inngest";
import ky from "ky";
import type { NodeExecutor } from "@/features/executions/components/types";
import { DiscordChannel } from "@/inngest/channels/discord";
import prisma from "@/lib/db";

Handlebars.registerHelper("json", (context: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(context, null, 2));
});

const DISCORD_MAX_CONTENT_LENGTH = 2000;

type DiscordData = {
  credentialId?: string;
  variableName?: string;
  content?: string;
  username?: string;
  avatarUrl?: string;
};

export const DiscordExecutor: NodeExecutor<DiscordData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  userId,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    return await publish(
      DiscordChannel().status({
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

  if (!data.content) {
    await updateStatePublish("error");
    throw new NonRetriableError("Message content is required");
  }

  if (!data.credentialId) {
    await updateStatePublish("error");
    throw new NonRetriableError(
      "Discord Webhook URL is required. Please configure a webhook credential in the node settings.",
    );
  }

  const credential = await step.run("fetch-discord-credential", async () => {
    const cred = await prisma.credentials.findUnique({
      where: { id: data.credentialId, userId },
    });
    if (!cred) {
      throw new NonRetriableError(
        "Webhook credential not found or access denied. It may have been deleted.",
      );
    }
    return cred;
  });

  const webhookUrl = credential.value;
  let messageContent = Handlebars.compile(data.content)(context);

  // Truncate if exceeding Discord's 2000 char limit
  if (messageContent.length > DISCORD_MAX_CONTENT_LENGTH) {
    messageContent = `${messageContent.substring(0, DISCORD_MAX_CONTENT_LENGTH - 14)} [truncated]`;
  }

  try {
    const result = await step.run("discord-send-message", async () => {
      const payload: Record<string, unknown> = {
        content: messageContent,
      };

      if (data.username) {
        payload.username = Handlebars.compile(data.username)(context);
      }

      if (data.avatarUrl) {
        payload.avatar_url = Handlebars.compile(data.avatarUrl)(context);
      }

      const response = await ky.post(webhookUrl, {
        json: payload,
        searchParams: { wait: "true" },
      });

      const timestamp = new Date().toISOString();

      // Discord returns 200 with message body when wait=true
      if (response.ok) {
        let messageId: string | undefined;
        try {
          const responseData = (await response.json()) as {
            id?: string;
          };
          messageId = responseData.id;
        } catch {
          // Response might be empty for 204
        }

        return {
          success: true,
          messageId,
          timestamp,
          provider: "discord",
        };
      }

      return {
        success: false,
        timestamp,
        provider: "discord",
        error: `Discord API returned ${response.status}: ${response.statusText}`,
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
      `Failed to send Discord message: ${errorMessage}`,
    );
  }
};
