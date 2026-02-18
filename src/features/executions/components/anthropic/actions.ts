"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { AnthropicChannel } from "@/inngest/channels/anthropic";
import { inngest } from "@/inngest/client";

export type AnthropicToken = Realtime.Token<
  typeof AnthropicChannel,
  ["status"]
>;

export async function fetchAnthropicRealTimeToken(): Promise<AnthropicToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: AnthropicChannel(),
    topics: ["status"],
  });
  return token;
}
