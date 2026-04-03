import Handlebars from "handlebars";
import { NonRetriableError } from "inngest";
import ky from "ky";
import type { NodeExecutor } from "@/features/executions/components/types";
import { WhatsAppChannel } from "@/inngest/channels/whatsapp";
import prisma from "@/lib/db";

Handlebars.registerHelper("json", (context: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(context, null, 2));
});

const WHATSAPP_MAX_TEXT_LENGTH = 4096;
const WHATSAPP_API_BASE = "https://graph.facebook.com/v21.0";

type WhatsAppData = {
  credentialId?: string;
  variableName?: string;
  phoneNumberId?: string;
  recipientPhone?: string;
  text?: string;
  enablePreview?: boolean;
};

export const WhatsAppExecutor: NodeExecutor<WhatsAppData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  userId,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    return await publish(
      WhatsAppChannel().status({
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

  if (!data.phoneNumberId) {
    await updateStatePublish("error");
    throw new NonRetriableError("Phone Number ID is required");
  }

  if (!data.recipientPhone) {
    await updateStatePublish("error");
    throw new NonRetriableError("Recipient phone number is required");
  }

  if (!data.text) {
    await updateStatePublish("error");
    throw new NonRetriableError("Message text is required");
  }

  if (!data.credentialId) {
    await updateStatePublish("error");
    throw new NonRetriableError(
      "WhatsApp Access Token is required. Please configure a token credential in the node settings.",
    );
  }

  const credential = await step.run("fetch-whatsapp-credential", async () => {
    const cred = await prisma.credentials.findUnique({
      where: { id: data.credentialId, userId },
    });
    if (!cred) {
      throw new NonRetriableError(
        "Access token credential not found or access denied. It may have been deleted.",
      );
    }
    return cred;
  });

  const accessToken = credential.value;
  const recipientPhone = Handlebars.compile(data.recipientPhone)(context);
  let messageText = Handlebars.compile(data.text)(context);

  if (messageText.length > WHATSAPP_MAX_TEXT_LENGTH) {
    messageText = `${messageText.substring(0, WHATSAPP_MAX_TEXT_LENGTH - 14)} [truncated]`;
  }

  try {
    const result = await step.run("whatsapp-send-message", async () => {
      const payload = {
        messaging_product: "whatsapp" as const,
        recipient_type: "individual" as const,
        to: recipientPhone,
        type: "text" as const,
        text: {
          preview_url: data.enablePreview ?? false,
          body: messageText,
        },
      };

      const response = await ky
        .post(`${WHATSAPP_API_BASE}/${data.phoneNumberId}/messages`, {
          json: payload,
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        })
        .json<{
          messaging_product: string;
          contacts?: Array<{ input: string; wa_id: string }>;
          messages?: Array<{ id: string }>;
          error?: { message: string; code: number };
        }>();

      const timestamp = new Date().toISOString();

      if (response.messages?.[0]?.id) {
        return {
          success: true,
          messageId: response.messages[0].id,
          recipientPhone,
          timestamp,
          provider: "whatsapp",
        };
      }

      return {
        success: false,
        timestamp,
        provider: "whatsapp",
        error: response.error?.message || "Unknown WhatsApp API error",
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
      `Failed to send WhatsApp message: ${errorMessage}`,
    );
  }
};
