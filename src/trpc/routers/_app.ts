import { aiAssistantRouter } from "@/features/ai-assistant/server/router";
import { credentialsRouter } from "@/features/credentials/server/routers";
import { aiModelsRouter } from "@/features/executions/server/ai-models-router";
import { executionsRouter } from "@/features/executions/server/executions-router";
import { workflowsRouter } from "@/features/workflows/server/routers";
import { createTRPCRouter } from "../init";

export const appRouter = createTRPCRouter({
  workflows: workflowsRouter,
  aiModels: aiModelsRouter,
  credentials: credentialsRouter,
  executions: executionsRouter,
  aiAssistant: aiAssistantRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
