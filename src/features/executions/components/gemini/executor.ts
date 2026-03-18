import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import Handlebars from "handlebars";
import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { GeminiChannel } from "@/inngest/channels/gemini";
import prisma from "@/lib/db";

Handlebars.registerHelper("json", (context: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(context, null, 2));
});

type GeminiData = {
  credentialId?: string;
  variableName?: string;
  model?: string;
  systemPrompt?: string;
  userPrompt?: string;
};

export const GeminiExecutor: NodeExecutor<GeminiData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  userId,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    return await publish(
      GeminiChannel().status({
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
      "Gemini API key is required. Please configure an API key in the node settings.",
    );
  }

  const credential = await step.run("fetch-gemini-credential", async () => {
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

  const google = createGoogleGenerativeAI({
    apiKey: credential.value,
  });

  try {
    const result = await step.ai.wrap("gemini-generate-text", generateText, {
      model: google(data.model || "gemini-2.5-flash"),
      system: systemPrompt,
      prompt: userPrompt,
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: true,
        recordOutputs: true,
      },
    });

    const raw = result as unknown as { text?: string; _output?: string };

    // Handle both direct text and internal Inngest output structure
    const text: string | undefined = raw.text || raw._output;

    if (!text) {
      console.error("[GeminiExecutor] No text found in result", raw);
      throw new NonRetriableError("No text generated from Gemini");
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
