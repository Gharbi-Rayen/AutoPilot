import type { inferInput } from "@trpc/tanstack-react-query";
import { prefetch, trpc } from "@/trpc/server";

type Input = inferInput<typeof trpc.executions.getMany>;

export const prefetchExecutions = (params: Input) => {
  return prefetch(trpc.executions.getMany.queryOptions(params));
};

export const prefetchExecutionSummary = (id: string) => {
  return prefetch(trpc.executions.getOne.queryOptions({ id }));
};

export const prefetchExecutionRawOutput = (id: string) => {
  return prefetch(trpc.executions.getOneRawOutput.queryOptions({ id }));
};

export const prefetchExecution = prefetchExecutionSummary;
