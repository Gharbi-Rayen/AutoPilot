import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useExecutionsParams } from "./use-executions-params";

export const useSuspenseExecutions = () => {
  const trpc = useTRPC();
  const [params] = useExecutionsParams();

  return useSuspenseQuery(trpc.executions.getMany.queryOptions(params));
};

export const useSuspenseExecutionSummary = (id: string) => {
  const trpc = useTRPC();

  return useSuspenseQuery(trpc.executions.getOne.queryOptions({ id }));
};

export const useExecutionRawOutput = (id: string, enabled = true) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.executions.getOneRawOutput.queryOptions({ id }),
    enabled: enabled && Boolean(id),
    retry: false,
  });
};

export const useExecutionNodeOutput = (
  executionId: string,
  nodeId: string,
  enabled = true,
) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.executions.getNodeOutput.queryOptions({
      executionId,
      nodeId,
    }),
    enabled: enabled && Boolean(executionId) && Boolean(nodeId),
    retry: false,
  });
};

export const useExecutionDatasetMeta = (
  executionId: string,
  variable: string,
  nodeId?: string,
  enabled = true,
) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.executions.getDatasetMeta.queryOptions({
      executionId,
      variable,
      nodeId,
    }),
    enabled: enabled && Boolean(executionId) && Boolean(variable),
    retry: false,
  });
};

export const useExecutionDatasetChunk = (
  executionId: string,
  variable: string,
  chunkIndex: number,
  nodeId?: string,
  enabled = true,
) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.executions.getDatasetChunk.queryOptions({
      executionId,
      variable,
      chunkIndex,
      nodeId,
    }),
    enabled:
      enabled &&
      Boolean(executionId) &&
      Boolean(variable) &&
      Number.isInteger(chunkIndex) &&
      chunkIndex >= 0,
    retry: false,
  });
};

export const useExecutionDatasetRows = (
  executionId: string,
  variable: string,
  chunkIndex: number,
  offset: number,
  limit: number,
  nodeId?: string,
  enabled = true,
) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.executions.getDatasetRows.queryOptions({
      executionId,
      variable,
      chunkIndex,
      offset,
      limit,
      nodeId,
    }),
    enabled:
      enabled &&
      Boolean(executionId) &&
      Boolean(variable) &&
      Number.isInteger(chunkIndex) &&
      chunkIndex >= 0,
    retry: false,
  });
};

export const useExecutionDatasetPage = (
  executionId: string,
  variable: string,
  page: number,
  pageSize: number,
  nodeId?: string,
  enabled = true,
) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.executions.getDatasetPage.queryOptions({
      executionId,
      variable,
      page,
      pageSize,
      nodeId,
    }),
    enabled:
      enabled &&
      Boolean(executionId) &&
      Boolean(variable) &&
      Number.isInteger(page) &&
      page > 0 &&
      Number.isInteger(pageSize) &&
      pageSize > 0,
    retry: false,
  });
};

export const useExecutionDatasetDownload = (
  executionId: string,
  variable: string,
  format: "json" | "jsonl" = "json",
  nodeId?: string,
  enabled = false,
) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.executions.downloadDataset.queryOptions({
      executionId,
      variable,
      format,
      nodeId,
    }),
    enabled: enabled && Boolean(executionId) && Boolean(variable),
    retry: false,
  });
};

export const useSuspenseExecution = useSuspenseExecutionSummary;
