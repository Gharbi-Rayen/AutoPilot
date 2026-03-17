"use server";

import { getSubscriptionToken, type Realtime } from "@inngest/realtime";

import { FileChannel } from "@/inngest/channels/file";
import { inngest } from "@/inngest/client";

export type FileToken = Realtime.Token<typeof FileChannel, ["status"]>;

export async function fetchFileRealTimeToken(): Promise<FileToken> {
  const token = await getSubscriptionToken(inngest, {
    channel: FileChannel(),
    topics: ["status"],
  });
  return token;
}
