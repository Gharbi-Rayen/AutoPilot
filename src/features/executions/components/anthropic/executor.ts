import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import Handlebars from "handlebars";
import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { AnthropicChannel } from "@/inngest/channels/anthropic";

Handlebars.registerHelper("json", (context: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(context, null, 2));
});

type AnthropicData = {
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

  const systemPrompt = data.systemPrompt
    ? Handlebars.compile(data.systemPrompt)(context)
    : "You are a helpful assistant.";

  const userPrompt = Handlebars.compile(data.userPrompt)(context);

  const credentialValue = process.env.ANTHROPIC_API_KEY || "";

  const anthropic = createAnthropic({
    apiKey: credentialValue,
  });

  try {
    const { text } = await step.ai.wrap(
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

    await updateStatePublish("success");

    return {
      ...context,
      [data.variableName]: {
        aiResponse: text,
      },
    };
  } catch (error) {
    await updateStatePublish("error");
    throw new NonRetriableError(`Failed to generate text: ${error}`);
  }
};
