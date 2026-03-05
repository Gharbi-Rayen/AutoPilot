import { channel, topic } from "@inngest/realtime";

export const EMAIL_CHANNEL_NAME = "email-execution";

export const EmailChannel = channel(EMAIL_CHANNEL_NAME).addTopic(
  topic("status").type<{
    nodeId: string;
    status: "loading" | "error" | "success";
  }>(),
);
