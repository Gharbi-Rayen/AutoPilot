"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { StripeTriggerChannel } from "@/inngest/channels/stripe-trigger";
import { inngest } from "@/inngest/client";

export type StripeTriggerToken = Realtime.Token<
  typeof StripeTriggerChannel,
  ["status"]
>;

export async function fetchStripeTriggerRealTimeToken(): Promise<StripeTriggerToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: StripeTriggerChannel(),
    topics: ["status"],
  });
  return token;
}
