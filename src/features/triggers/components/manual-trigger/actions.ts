"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";

import { ManualTriggerChannel } from "@/inngest/channels/manual-triggers";
import { inngest } from "@/inngest/client";

export type ManualTriggerToken = Realtime.Token<
  typeof ManualTriggerChannel,
  ["status"]
>;

export async function fetchManualTriggerRealTimeToken(): Promise<ManualTriggerToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: ManualTriggerChannel(),
    topics: ["status"],
    ...(process.env.NODE_ENV === "development"
      ? { apiBaseUrl: "http://127.0.0.1:8288/" }
      : {}),
  });
  return token;
}
