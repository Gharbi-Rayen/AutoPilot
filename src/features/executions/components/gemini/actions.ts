"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";
import { GeminiChannel } from "@/inngest/channels/gemini";
import { inngest } from "@/inngest/client";

export type GeminiToken = Realtime.Token<typeof GeminiChannel, ["status"]>;

export async function fetchGeminiRealTimeToken(): Promise<GeminiToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: GeminiChannel(),
    topics: ["status"],
  });
  return token;
}
