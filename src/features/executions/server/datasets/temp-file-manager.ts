import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DATASET_STORAGE } from "@/config/constants";
import { releaseTempFiles, reserveTempFiles } from "../resource-budget";

interface TempFileManagerOptions {
  scope?: string;
  rootDirectory?: string;
  executionId?: string;
}

export class TempFileManager {
  private readonly rootDirectory: string;
  private readonly executionId?: string;
  private readonly trackedFiles = new Set<string>();

  constructor(options: TempFileManagerOptions = {}) {
    const scope = options.scope ?? randomUUID();
    const tempRoot =
      options.rootDirectory ??
      join(DATASET_STORAGE.ROOT_DIRECTORY, "_tmp", "external-sort");

    this.rootDirectory = join(tempRoot, scope);
    this.executionId = options.executionId;
  }

  async createTempFilePath(prefix: string): Promise<string> {
    if (this.executionId) {
      reserveTempFiles(this.executionId, 1, "external sort temp files");
    }

    await mkdir(this.rootDirectory, { recursive: true });

    try {
      const filePath = join(
        this.rootDirectory,
        `${prefix}-${randomUUID()}.jsonl`,
      );
      this.trackedFiles.add(filePath);

      return filePath;
    } catch (error) {
      if (this.executionId) {
        releaseTempFiles(this.executionId, 1);
      }
      throw error;
    }
  }

  async removeFile(filePath: string): Promise<void> {
    const wasTracked = this.trackedFiles.delete(filePath);
    await rm(filePath, { force: true });

    if (wasTracked && this.executionId) {
      releaseTempFiles(this.executionId, 1);
    }
  }

  async cleanup(): Promise<void> {
    const trackedPaths = [...this.trackedFiles];

    for (const filePath of trackedPaths) {
      await rm(filePath, { force: true });
    }

    this.trackedFiles.clear();

    if (this.executionId && trackedPaths.length > 0) {
      releaseTempFiles(this.executionId, trackedPaths.length);
    }

    await rm(this.rootDirectory, { recursive: true, force: true });
  }
}
