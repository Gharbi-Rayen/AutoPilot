"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";

import { WhatsAppChannel } from "@/inngest/channels/whatsapp";
import { inngest } from "@/inngest/client";

export type WhatsAppToken = Realtime.Token<typeof WhatsAppChannel, ["status"]>;

export async function fetchWhatsAppRealTimeToken(): Promise<WhatsAppToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: WhatsAppChannel(),
    topics: ["status"],
    ...(process.env.NODE_ENV === "development"
      ? { apiBaseUrl: "http://127.0.0.1:8288/" }
      : {}),
  });
  return token;
}
