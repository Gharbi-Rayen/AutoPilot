"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { GoogleFormTriggerChannel } from "@/inngest/channels/google-form-trigger";
import { inngest } from "@/inngest/client";

export type GoogleFormTriggerToken = Realtime.Token<
  typeof GoogleFormTriggerChannel,
  ["status"]
>;

export async function fetchGoogleFormTriggerRealTimeToken(): Promise<GoogleFormTriggerToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: GoogleFormTriggerChannel(),
    topics: ["status"],
  });
  return token;
}
