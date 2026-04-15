import { channel, topic } from "@inngest/realtime";

export const FILE_CHANNEL_NAME = "file-execution";

export const FileChannel = channel(FILE_CHANNEL_NAME)
  .addTopic(
    topic("status").type<{
      nodeId: string;
      status: "loading" | "error" | "success";
    }>(),
  )
  .addTopic(
    topic("progress").type<{
      executionId: string;
      nodeId: string;
      stage: string;
      variableName?: string;
      strategy?: string;
      sourceRows?: number;
      rowsScanned?: number;
      rowsMatched?: number;
      rowsWritten?: number;
      runCount?: number;
      mergePass?: number;
      mergeFanIn?: number;
      elapsedMs?: number;
    }>(),
  );
