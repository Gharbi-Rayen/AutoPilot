import { channel, topic } from "@inngest/realtime";

export const FILE_CHANNEL_NAME = "file-execution";

export const FileChannel = channel(FILE_CHANNEL_NAME).addTopic(
  topic("status").type<{
    nodeId: string;
    status: "loading" | "error" | "success";
  }>(),
);
