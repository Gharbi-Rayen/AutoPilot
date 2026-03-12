"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";

import { CodeChannel } from "@/inngest/channels/code";
import { inngest } from "@/inngest/client";

export type CodeToken = Realtime.Token<typeof CodeChannel, ["status"]>;

export async function fetchCodeRealTimeToken(): Promise<CodeToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: CodeChannel(),
    topics: ["status"],
  });
  return token;
}
