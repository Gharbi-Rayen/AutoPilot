import { aiModelsRouter } from "@/features/executions/server/ai-models-router";
import { workflowsRouter } from "@/features/workflows/server/routers";
import { createTRPCRouter } from "../init";
import { credentialsRouter } from "@/features/credentials/server/routers";


export const appRouter = createTRPCRouter({
  workflows: workflowsRouter,
  aiModels: aiModelsRouter,
  credentials: credentialsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
