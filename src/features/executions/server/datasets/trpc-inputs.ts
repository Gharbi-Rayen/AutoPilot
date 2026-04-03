import z from "zod";

export const datasetVariableInput = z.object({
  executionId: z.string(),
  variable: z.string().min(1),
});

export const datasetChunkInput = datasetVariableInput.extend({
  chunkIndex: z.number().int().min(0),
});

export const datasetRowsInput = datasetChunkInput.extend({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(5000).default(100),
});

export const datasetPageInput = datasetVariableInput.extend({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(5000).default(100),
});

export const datasetDownloadInput = datasetVariableInput.extend({
  format: z.enum(["json", "jsonl"]).default("json"),
});
