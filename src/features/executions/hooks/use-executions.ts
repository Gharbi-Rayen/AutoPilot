"use client";

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { db } from "@/lib/db";
import { readDataset, readDatasetPage } from "@/lib/opfs";
import { useExecutionsParams } from "./use-executions-params";

// ─── Query keys ───────────────────────────────────────────────────────────────

export const executionKeys = {
  all: ["executions"] as const,
  list: (params: object) => ["executions", "list", params] as const,
  detail: (id: string) => ["executions", "detail", id] as const,
  nodeOutput: (executionId: string, nodeId: string) =>
    ["executions", "nodeOutput", executionId, nodeId] as const,
  datasetPage: (
    executionId: string,
    variable: string,
    page: number,
    pageSize: number,
  ) => ["executions", "datasetPage", executionId, variable, page, pageSize] as const,
};

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchExecutions(params: {
  page?: number;
  pageSize?: number;
  workflowId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  durationMin?: number | null;
  durationMax?: number | null;
}) {
  const {
    page = 1,
    pageSize = 10,
    workflowId,
    search = "",
    dateFrom = "",
    dateTo = "",
    durationMin,
    durationMax,
  } = params;

  let all = await db.executions.orderBy("startedAt").reverse().toArray();

  if (workflowId) all = all.filter((e) => e.workflowId === workflowId);
  if (dateFrom) all = all.filter((e) => e.startedAt >= dateFrom);
  if (dateTo) {
    const toEnd = `${dateTo}T23:59:59.999Z`;
    all = all.filter((e) => e.startedAt <= toEnd);
  }
  if (durationMin != null || durationMax != null) {
    all = all.filter((e) => {
      if (!e.completedAt) return false;
      const durSec =
        (new Date(e.completedAt).getTime() - new Date(e.startedAt).getTime()) / 1000;
      if (durationMin != null && durSec < durationMin) return false;
      if (durationMax != null && durSec > durationMax) return false;
      return true;
    });
  }

  // Join workflow names for all filtered items (needed for search)
  const allWorkflowIds = [...new Set(all.map((e) => e.workflowId))];
  const allWorkflows = await db.workflows.bulkGet(allWorkflowIds);
  const nameMap = new Map(allWorkflows.map((w) => [w?.id, w?.name]));

  let withNames = all.map((e) => ({
    ...e,
    workflowName: nameMap.get(e.workflowId) ?? e.workflowId,
  }));

  if (search.trim()) {
    const q = search.toLowerCase();
    withNames = withNames.filter((e) =>
      (e.workflowName ?? "").toLowerCase().includes(q),
    );
  }

  const totalCount = withNames.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const items = withNames.slice((page - 1) * pageSize, page * pageSize);

  return { items, page, pageSize, totalCount, totalPages };
}

async function fetchExecution(id: string) {
  const exec = await db.executions.get(id);
  if (!exec) throw new Error(`Execution ${id} not found`);
  const nodeOutputs = await db.executionNodeOutputs
    .where("executionId")
    .equals(id)
    .toArray();
  return { ...exec, nodeOutputs };
}

async function fetchNodeOutput(executionId: string, nodeId: string) {
  const output = await db.executionNodeOutputs
    .where("executionId")
    .equals(executionId)
    .filter((r) => r.nodeId === nodeId)
    .first();
  return output ?? null;
}

async function fetchDatasetPage(
  executionId: string,
  variable: string,
  page: number,
  pageSize: number,
) {
  const dataset = await db.datasets
    .where("executionId")
    .equals(executionId)
    .filter((d) => d.variableName === variable)
    .first();
  if (!dataset) return { rows: [], totalRows: 0, totalPages: 0, page, pageSize };
  return readDatasetPage(executionId, dataset.id, dataset.manifest, page, pageSize);
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export const useSuspenseExecutions = () => {
  const [params] = useExecutionsParams();
  return useSuspenseQuery({
    queryKey: executionKeys.list(params),
    queryFn: () =>
      fetchExecutions({
        page: params.page,
        pageSize: params.pageSize,
        search: params.search,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        durationMin: params.durationMin,
        durationMax: params.durationMax,
      }),
  });
};

export const useSuspenseExecutionSummary = (id: string) =>
  useSuspenseQuery({
    queryKey: executionKeys.detail(id),
    queryFn: () => fetchExecution(id),
  });

export const useSuspenseExecution = useSuspenseExecutionSummary;

export const useExecutionNodeOutput = (
  executionId: string,
  nodeId: string,
  enabled = true,
) =>
  useQuery({
    queryKey: executionKeys.nodeOutput(executionId, nodeId),
    queryFn: () => fetchNodeOutput(executionId, nodeId),
    enabled: enabled && Boolean(executionId) && Boolean(nodeId),
    retry: false,
  });

export const useExecutionDatasetMeta = (
  executionId: string,
  variable: string,
  _nodeId?: string,
  enabled = true,
) =>
  useQuery({
    queryKey: ["executions", "datasetMeta", executionId, variable] as const,
    queryFn: async () => {
      const dataset = await db.datasets
        .where("executionId")
        .equals(executionId)
        .filter((d) => d.variableName === variable)
        .first();
      if (!dataset) return null;
      return {
        ...dataset,
        rowCount: dataset.manifest.rowCount,
        chunkCount: dataset.manifest.chunkCount,
        schema: dataset.manifest.schema,
        byteSize: dataset.manifest.byteSize,
      };
    },
    enabled: enabled && Boolean(executionId) && Boolean(variable),
    retry: false,
  });

export const useExecutionDatasetDownload = (
  executionId: string,
  variable: string,
  _format: string,
  _nodeId?: string,
  enabled = false,
) =>
  useQuery({
    queryKey: ["executions", "datasetDownload", executionId, variable] as const,
    queryFn: async () => {
      const dataset = await db.datasets
        .where("executionId")
        .equals(executionId)
        .filter((d) => d.variableName === variable)
        .first();
      if (!dataset) throw new Error(`Dataset not found: ${variable}`);
      const rows = await readDataset(executionId, dataset.id, dataset.manifest);
      return { data: rows as Record<string, unknown>[], format: "json" as const };
    },
    enabled,
    retry: false,
  });

export const useExecutionDatasetPage = (
  executionId: string,
  variable: string,
  page: number,
  pageSize: number,
  _nodeId?: string,
  enabled = true,
) =>
  useQuery({
    queryKey: executionKeys.datasetPage(executionId, variable, page, pageSize),
    queryFn: () => fetchDatasetPage(executionId, variable, page, pageSize),
    enabled:
      enabled &&
      Boolean(executionId) &&
      Boolean(variable) &&
      page > 0 &&
      pageSize > 0,
    retry: false,
  });
