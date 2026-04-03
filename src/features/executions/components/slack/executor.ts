import Handlebars from "handlebars";
import { NonRetriableError } from "inngest";
import ky from "ky";
import type { NodeExecutor } from "@/features/executions/components/types";
import { SlackChannel } from "@/inngest/channels/slack";
import prisma from "@/lib/db";

Handlebars.registerHelper("json", (context: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(context, null, 2));
});

const SLACK_MAX_TEXT_LENGTH = 40000;

type SlackData = {
  credentialId?: string;
  variableName?: string;
  text?: string;
};

export const SlackExecutor: NodeExecutor<SlackData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  userId,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    return await publish(
      SlackChannel().status({
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

  if (!data.text) {
    await updateStatePublish("error");
    throw new NonRetriableError("Message text is required");
  }

  if (!data.credentialId) {
    await updateStatePublish("error");
    throw new NonRetriableError(
      "Slack Webhook URL is required. Please configure a webhook credential in the node settings.",
    );
  }

  const credential = await step.run("fetch-slack-credential", async () => {
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
  let messageText = Handlebars.compile(data.text)(context);

  // Truncate if exceeding Slack's 40,000 char limit
  if (messageText.length > SLACK_MAX_TEXT_LENGTH) {
    messageText = `${messageText.substring(0, SLACK_MAX_TEXT_LENGTH - 14)} [truncated]`;
  }

  try {
    const result = await step.run("slack-send-message", async () => {
      const payload = {
        text: messageText,
      };

      const response = await ky.post(webhookUrl, {
        json: payload,
      });

      const timestamp = new Date().toISOString();
      const responseText = await response.text();

      if (response.ok && responseText === "ok") {
        return {
          success: true,
          timestamp,
          provider: "slack",
        };
      }

      return {
        success: false,
        timestamp,
        provider: "slack",
        error: `Slack API returned ${response.status}: ${responseText}`,
      };
    });

    await updateStatePublish("success");

    return {
      [data.variableName]: result,
    };
  } catch (error) {
    await updateStatePublish("error");
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new NonRetriableError(
      `Failed to send Slack message: ${errorMessage}`,
    );
  }
};
