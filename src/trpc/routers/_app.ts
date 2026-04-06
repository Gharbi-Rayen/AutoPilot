import { credentialsRouter } from "@/features/credentials/server/routers";
import { csvJoinRouter } from "@/features/executions/server/csv-join-router";
import { executionsRouter } from "@/features/executions/server/executions-router";
import { workflowsRouter } from "@/features/workflows/server/routers";
import { createTRPCRouter } from "../init";

export const appRouter = createTRPCRouter({
  workflows: workflowsRouter,
  csvJoin: csvJoinRouter,
  credentials: credentialsRouter,
  executions: executionsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
