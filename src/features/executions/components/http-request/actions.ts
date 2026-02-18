"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";

import { HttpRequestChannel } from "@/inngest/channels/http-request";
import { inngest } from "@/inngest/client";

export type HttpRequestToken = Realtime.Token<
  typeof HttpRequestChannel,
  ["status"]
>;

export async function fetchHttpRequestRealTimeToken(): Promise<HttpRequestToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: HttpRequestChannel(),
    topics: ["status"],
  });
  return token;
}
