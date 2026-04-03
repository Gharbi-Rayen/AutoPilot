import { DATASET_STORAGE } from "@/config/constants";

interface ResourceBudgetState {
  diskUsageBytes: number;
  tempFiles: number;
  pipelineMemoryBytes: number;
  peakPipelineMemoryBytes: number;
  updatedAt: number;
}

const executionBudgets = new Map<string, ResourceBudgetState>();

const ensureExecutionBudget = (executionId: string): ResourceBudgetState => {
  const existing = executionBudgets.get(executionId);
  if (existing) {
    return existing;
  }

  const created: ResourceBudgetState = {
    diskUsageBytes: 0,
    tempFiles: 0,
    pipelineMemoryBytes: 0,
    peakPipelineMemoryBytes: 0,
    updatedAt: Date.now(),
  };

  executionBudgets.set(executionId, created);
  return created;
};

const updateTimestamp = (budget: ResourceBudgetState) => {
  budget.updatedAt = Date.now();
};

const throwBudgetExceeded = (message: string): never => {
  throw new Error(message);
};

export const estimateDataSizeBytes = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
};

export const initializeExecutionBudget = (executionId: string) => {
  ensureExecutionBudget(executionId);
};

export const clearExecutionBudget = (executionId: string) => {
  executionBudgets.delete(executionId);
};

export const reserveDiskUsage = (
  executionId: string,
  bytes: number,
  label = "workflow data",
) => {
  const safeBytes = Math.max(0, Math.floor(bytes));
  if (safeBytes === 0) {
    return;
  }

  const budget = ensureExecutionBudget(executionId);
  const next = budget.diskUsageBytes + safeBytes;

  if (next > DATASET_STORAGE.MAX_TOTAL_DISK_USAGE_BYTES) {
    throwBudgetExceeded(
      `Workflow stopped because ${label} exceeded the configured disk budget. Try reducing input size or splitting the workflow.`,
    );
  }

  budget.diskUsageBytes = next;
  updateTimestamp(budget);
};

export const releaseDiskUsage = (executionId: string, bytes: number) => {
  const safeBytes = Math.max(0, Math.floor(bytes));
  if (safeBytes === 0) {
    return;
  }

  const budget = ensureExecutionBudget(executionId);
  budget.diskUsageBytes = Math.max(0, budget.diskUsageBytes - safeBytes);
  updateTimestamp(budget);
};

export const reserveTempFiles = (
  executionId: string,
  count = 1,
  label = "temporary files",
) => {
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0) {
    return;
  }

  const budget = ensureExecutionBudget(executionId);
  const next = budget.tempFiles + safeCount;

  if (next > DATASET_STORAGE.MAX_TOTAL_TEMP_FILES) {
    throwBudgetExceeded(
      `Workflow stopped because ${label} exceeded the configured temporary file budget.`,
    );
  }

  budget.tempFiles = next;
  updateTimestamp(budget);
};

export const releaseTempFiles = (executionId: string, count = 1) => {
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0) {
    return;
  }

  const budget = ensureExecutionBudget(executionId);
  budget.tempFiles = Math.max(0, budget.tempFiles - safeCount);
  updateTimestamp(budget);
};

export const reservePipelineMemory = (
  executionId: string,
  bytes: number,
  label = "pipeline stage",
) => {
  const safeBytes = Math.max(0, Math.floor(bytes));
  if (safeBytes === 0) {
    return;
  }

  const budget = ensureExecutionBudget(executionId);
  const next = budget.pipelineMemoryBytes + safeBytes;

  if (next > DATASET_STORAGE.MAX_PIPELINE_MEMORY_BYTES) {
    throwBudgetExceeded(
      `Workflow stopped because ${label} buffered more data than allowed. Try reducing batch size or processing data in streams.`,
    );
  }

  budget.pipelineMemoryBytes = next;
  budget.peakPipelineMemoryBytes = Math.max(
    budget.peakPipelineMemoryBytes,
    next,
  );
  updateTimestamp(budget);
};

export const releasePipelineMemory = (executionId: string, bytes: number) => {
  const safeBytes = Math.max(0, Math.floor(bytes));
  if (safeBytes === 0) {
    return;
  }

  const budget = ensureExecutionBudget(executionId);
  budget.pipelineMemoryBytes = Math.max(
    0,
    budget.pipelineMemoryBytes - safeBytes,
  );
  updateTimestamp(budget);
};

export const getExecutionBudgetSnapshot = (executionId: string) => {
  const budget = ensureExecutionBudget(executionId);

  return {
    diskUsageBytes: budget.diskUsageBytes,
    tempFiles: budget.tempFiles,
    pipelineMemoryBytes: budget.pipelineMemoryBytes,
    peakPipelineMemoryBytes: budget.peakPipelineMemoryBytes,
    updatedAt: budget.updatedAt,
  };
};
