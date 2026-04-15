import { serve } from "inngest/next";
import { cleanupRedisQueue } from "@/inngest/cleanup-scheduled";
import { inngest } from "@/inngest/client";
import {
  executeWorkflow,
  relayCsvFilterProgress,
  relayCsvSortProgress,
} from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    executeWorkflow,
    relayCsvSortProgress,
    relayCsvFilterProgress,
    cleanupRedisQueue,
  ],
});
