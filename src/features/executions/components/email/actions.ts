"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";

import { EmailChannel } from "@/inngest/channels/email";
import { inngest } from "@/inngest/client";

export type EmailToken = Realtime.Token<typeof EmailChannel, ["status"]>;

export async function fetchEmailRealTimeToken(): Promise<EmailToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: EmailChannel(),
    topics: ["status"],
  });
  return token;
}
