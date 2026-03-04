import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import Handlebars from "handlebars";
import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { OpenAIChannel } from "@/inngest/channels/openai";
import prisma from "@/lib/db";

Handlebars.registerHelper("json", (context: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(context, null, 2));
});

type OpenAIData = {
  credentialId?: string;
  variableName?: string;
  model?: string;
  systemPrompt?: string;
  userPrompt?: string;
};

export const OpenAIExecutor: NodeExecutor<OpenAIData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  userId,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    return await publish(
      OpenAIChannel().status({
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
      "OpenAI API key is required. Please configure an API key in the node settings.",
    );
  }

  const credential = await step.run("fetch-openai-credential", async () => {
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

  const openai = createOpenAI({
    apiKey: credential.value,
  });

  try {
    const { text } = await step.ai.wrap("openai-generate-text", generateText, {
      model: openai(data.model || "gpt-4.1-mini"),
      system: systemPrompt,
      prompt: userPrompt,
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: true,
        recordOutputs: true,
      },
    });

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
