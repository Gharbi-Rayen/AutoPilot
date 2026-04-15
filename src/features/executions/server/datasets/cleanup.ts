import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { DATASET_STORAGE } from "@/config/constants";
import prisma from "@/lib/db";
import {
  getDatasetsRootDirectory,
  getExecutionDatasetsDirectory,
  listExecutionDatasetDirectories,
} from "./paths";

export interface DatasetCleanupOptions {
  executionIds?: string[];
  dryRun?: boolean;
  now?: Date;
  completedTtlMs?: number;
  orphanTtlMs?: number;
  /** When true, also cleans executions still marked as RUNNING (e.g. stale from a previous process). */
  forceCleanRunning?: boolean;
}

export interface DatasetCleanupResult {
  dryRun: boolean;
  scannedExecutions: number;
  deletedExecutionDirectories: number;
  skippedActiveExecutions: number;
  skippedFreshExecutions: number;
  deletedOrphanDirectories: number;
  errors: string[];
}

const isOlderThan = async (
  directoryPath: string,
  nowMs: number,
  maxAgeMs: number,
): Promise<boolean> => {
  const details = await stat(directoryPath).catch(() => null);
  if (!details) {
    return false;
  }

  return nowMs - details.mtimeMs >= maxAgeMs;
};

export const cleanupExecutionDatasets = async (
  options: DatasetCleanupOptions = {},
): Promise<DatasetCleanupResult> => {
  const rootDirectory = getDatasetsRootDirectory();
  const nowMs = (options.now ?? new Date()).getTime();
  const completedTtlMs =
    options.completedTtlMs ?? DATASET_STORAGE.COMPLETED_DATASET_TTL_MS;
  const orphanTtlMs =
    options.orphanTtlMs ?? DATASET_STORAGE.ORPHAN_DATASET_TTL_MS;
  const dryRun = options.dryRun ?? false;

  const allExecutionDirectories = await listExecutionDatasetDirectories();
  const scopedExecutionDirectories = options.executionIds
    ? allExecutionDirectories.filter((directory) =>
        options.executionIds?.includes(directory),
      )
    : allExecutionDirectories;

  const executions = await prisma.execution.findMany({
    where: {
      id: {
        in: scopedExecutionDirectories,
      },
    },
    select: {
      id: true,
      status: true,
      finishedAt: true,
    },
  });

  const executionById = new Map(
    executions.map((execution) => [execution.id, execution]),
  );

  let deletedExecutionDirectories = 0;
  let skippedActiveExecutions = 0;
  let skippedFreshExecutions = 0;
  let deletedOrphanDirectories = 0;
  const errors: string[] = [];

  for (const executionId of scopedExecutionDirectories) {
    const executionDirectory = getExecutionDatasetsDirectory(executionId);
    const execution = executionById.get(executionId);

    if (!execution) {
      const canDeleteOrphan = await isOlderThan(
        executionDirectory,
        nowMs,
        orphanTtlMs,
      );

      if (!canDeleteOrphan) {
        continue;
      }

      if (!dryRun) {
        try {
          await rm(executionDirectory, { recursive: true, force: true });
        } catch (error) {
          errors.push(
            `Failed to remove orphan dataset directory '${executionId}': ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
      }

      deletedExecutionDirectories += 1;
      deletedOrphanDirectories += 1;
      continue;
    }

    if (
      execution.status === "RUNNING" &&
      !(options.forceCleanRunning ?? false)
    ) {
      skippedActiveExecutions += 1;
      continue;
    }

    const finishedAtMs = execution.finishedAt?.getTime();
    if (!finishedAtMs || nowMs - finishedAtMs < completedTtlMs) {
      skippedFreshExecutions += 1;
      continue;
    }

    if (!dryRun) {
      try {
        await rm(join(rootDirectory, executionId), {
          recursive: true,
          force: true,
        });
      } catch (error) {
        errors.push(
          `Failed to remove dataset directory '${executionId}': ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
    }

    deletedExecutionDirectories += 1;
  }

  return {
    dryRun,
    scannedExecutions: scopedExecutionDirectories.length,
    deletedExecutionDirectories,
    skippedActiveExecutions,
    skippedFreshExecutions,
    deletedOrphanDirectories,
    errors,
  };
};
