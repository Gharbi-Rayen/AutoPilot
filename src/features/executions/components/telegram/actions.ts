"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";

import { TelegramChannel } from "@/inngest/channels/telegram";
import { inngest } from "@/inngest/client";

export type TelegramToken = Realtime.Token<typeof TelegramChannel, ["status"]>;

export async function fetchTelegramRealTimeToken(): Promise<TelegramToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: TelegramChannel(),
    topics: ["status"],
  });
  return token;
}
