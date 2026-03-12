import { channel, topic } from "@inngest/realtime";

export const CODE_CHANNEL_NAME = "code-execution";

export const CodeChannel = channel(CODE_CHANNEL_NAME).addTopic(
  topic("status").type<{
    nodeId: string;
    status: "loading" | "error" | "success";
  }>(),
);
