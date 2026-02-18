"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { OpenAIChannel } from "@/inngest/channels/openai";
import { inngest } from "@/inngest/client";

export type OpenAIToken = Realtime.Token<typeof OpenAIChannel, ["status"]>;

export async function fetchOpenAIRealTimeToken(): Promise<OpenAIToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: OpenAIChannel(),
    topics: ["status"],
  });
  return token;
}
