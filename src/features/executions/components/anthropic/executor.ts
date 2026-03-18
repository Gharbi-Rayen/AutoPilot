import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import Handlebars from "handlebars";
import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { AnthropicChannel } from "@/inngest/channels/anthropic";
import prisma from "@/lib/db";

Handlebars.registerHelper("json", (context: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(context, null, 2));
});

type AnthropicData = {
  credentialId?: string;
  variableName?: string;
  model?: string;
  systemPrompt?: string;
  userPrompt?: string;
};

export const AnthropicExecutor: NodeExecutor<AnthropicData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  userId,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    return await publish(
      AnthropicChannel().status({
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

  if (!data.userPrompt) {
    await updateStatePublish("error");
    throw new NonRetriableError("User prompt is required");
  }

  if (!data.credentialId) {
    await updateStatePublish("error");
    throw new NonRetriableError(
      "Anthropic API key is required. Please configure an API key in the node settings.",
    );
  }

  const credential = await step.run("fetch-anthropic-credential", async () => {
    const cred = await prisma.credentials.findUnique({
      where: { id: data.credentialId, userId },
    });
    if (!cred) {
      throw new NonRetriableError(
        "API key not found or access denied. It may have been deleted.",
      );
    }
    return cred;
  });

  const systemPrompt = data.systemPrompt
    ? Handlebars.compile(data.systemPrompt)(context)
    : "You are a helpful assistant.";

  const userPrompt = Handlebars.compile(data.userPrompt)(context);

  const anthropic = createAnthropic({
    apiKey: credential.value,
  });

  try {
    const result = await step.ai.wrap(
      "anthropic-generate-text",
      generateText,
      {
        model: anthropic(data.model || "claude-sonnet-4-6"),
        system: systemPrompt,
        prompt: userPrompt,
        experimental_telemetry: {
          isEnabled: true,
          recordInputs: true,
          recordOutputs: true,
        },
      },
    );

    const raw = result as unknown as { text?: string; _output?: string };
    const text: string | undefined = raw.text || raw._output;

    if (!text) {
      console.error("[AnthropicExecutor] No text found in result", raw);
      throw new NonRetriableError("No text generated from Anthropic");
    }

    await updateStatePublish("success");

    return {
      [data.variableName]: text,
    };
  } catch (error) {
    await updateStatePublish("error");
    throw new NonRetriableError(`Failed to generate text: ${error}`);
  }
};
