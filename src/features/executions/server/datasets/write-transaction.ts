import { readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DATASET_STORAGE } from "@/config/constants";
import {
  ensureDirectory,
  getDatasetRootDirectory,
  getDatasetsRootDirectory,
  getDatasetTemporaryDirectory,
} from "./paths";

const TEMP_DIRECTORY_SUFFIX = ".tmp";

export interface DatasetWriteTransaction {
  executionId: string;
  datasetId: string;
  tempDirectory: string;
  finalDirectory: string;
}

export const createWriteTransaction = ({
  executionId,
  datasetId,
}: {
  executionId: string;
  datasetId: string;
}): DatasetWriteTransaction => {
  return {
    executionId,
    datasetId,
    tempDirectory: getDatasetTemporaryDirectory(executionId, datasetId),
    finalDirectory: getDatasetRootDirectory(executionId, datasetId),
  };
};

export const commitWriteTransaction = async (
  transaction: DatasetWriteTransaction,
) => {
  await ensureDirectory(dirname(transaction.finalDirectory));
  await rm(transaction.finalDirectory, { recursive: true, force: true });
  await rename(transaction.tempDirectory, transaction.finalDirectory);
};

export const rollbackWriteTransaction = async (
  transaction: DatasetWriteTransaction,
) => {
  await rm(transaction.tempDirectory, { recursive: true, force: true });
};

const listExecutionDirectories = async (rootDirectory: string) => {
  try {
    const rootEntries = await readdir(rootDirectory, { withFileTypes: true });
    return rootEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    const maybeError = error as { code?: string };
    if (maybeError.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

export const cleanupStaleWriteTransactions = async (
  maxAgeMs = DATASET_STORAGE.TEMP_DATASET_MAX_AGE_MS,
) => {
  const now = Date.now();
  const rootDirectory = getDatasetsRootDirectory();
  const executionDirectories = await listExecutionDirectories(rootDirectory);

  let cleanedCount = 0;

  for (const executionDirectoryName of executionDirectories) {
    const executionDirectoryPath = join(rootDirectory, executionDirectoryName);
    const datasetDirectories = await readdir(executionDirectoryPath, {
      withFileTypes: true,
    }).catch(() => []);

    for (const datasetDirectory of datasetDirectories) {
      if (!datasetDirectory.isDirectory()) {
        continue;
      }

      if (!datasetDirectory.name.endsWith(TEMP_DIRECTORY_SUFFIX)) {
        continue;
      }

      const temporaryDirectoryPath = join(
        executionDirectoryPath,
        datasetDirectory.name,
      );

      const directoryStats = await stat(temporaryDirectoryPath).catch(
        () => null,
      );
      if (!directoryStats) {
        continue;
      }

      if (now - directoryStats.mtimeMs < maxAgeMs) {
        continue;
      }

      await rm(temporaryDirectoryPath, { recursive: true, force: true });
      cleanedCount += 1;
    }
  }

  return cleanedCount;
};
