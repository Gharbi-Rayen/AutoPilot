import { channel, topic } from "@inngest/realtime";

export const TELEGRAM_CHANNEL_NAME = "telegram-execution";

export const TelegramChannel = channel(TELEGRAM_CHANNEL_NAME).addTopic(
  topic("status").type<{
    nodeId: string;
    status: "loading" | "error" | "success";
  }>(),
);
