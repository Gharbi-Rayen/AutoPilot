import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DATASET_STORAGE } from "@/config/constants";

const resolveStorageRoot = () => {
  return resolve(process.cwd(), DATASET_STORAGE.ROOT_DIRECTORY);
};

export const getDatasetsRootDirectory = () => {
  return resolveStorageRoot();
};

export const getExecutionDatasetsDirectory = (executionId: string) => {
  return join(resolveStorageRoot(), executionId);
};

export const getExecutionQueueDirectory = () => {
  return join(resolveStorageRoot(), "_queue");
};

export const getDatasetRootDirectory = (
  executionId: string,
  datasetId: string,
) => {
  return join(getExecutionDatasetsDirectory(executionId), datasetId);
};

export const getDatasetTemporaryDirectory = (
  executionId: string,
  datasetId: string,
) => {
  return join(getExecutionDatasetsDirectory(executionId), `${datasetId}.tmp`);
};

export const getDatasetManifestPath = (
  executionId: string,
  datasetId: string,
) => {
  return join(getDatasetRootDirectory(executionId, datasetId), "manifest.json");
};

export const getDatasetChunkPath = (
  executionId: string,
  datasetId: string,
  fileName: string,
) => {
  return join(getDatasetRootDirectory(executionId, datasetId), fileName);
};

export const ensureDirectory = async (directory: string) => {
  await mkdir(directory, { recursive: true });
};

export const listExecutionDatasetDirectories = async (): Promise<string[]> => {
  const root = getDatasetsRootDirectory();

  try {
    const entries = await readdir(root, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("_"));
  } catch (error) {
    const maybeError = error as { code?: string };
    if (maybeError.code === "ENOENT") {
      return [];
    }

    throw error;
  }
};
