import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createId } from "@paralleldrive/cuid2";

const WORKFLOW_FILE_ASSET_PREFIX = "wfasset";
const WORKFLOW_FILE_ASSET_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const WORKFLOW_FILE_ASSET_DIRECTORY = join(
  process.cwd(),
  ".autopilot-data",
  "workflow-file-assets",
);

type WorkflowFileAssetStoredMetadata = {
  id: string;
  ownerUserId: string;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  createdAt: string;
};

type WorkflowFileAssetPaths = {
  metadataPath: string;
  contentPath: string;
};

export type WorkflowFileAssetSummary = {
  fileRef: string;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
};

export type WorkflowFileAssetMetadata = {
  ownerUserId: string;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
};

const ensureWorkflowFileAssetDirectory = async () => {
  await mkdir(WORKFLOW_FILE_ASSET_DIRECTORY, { recursive: true });
};

const buildWorkflowFileAssetPaths = (
  assetId: string,
): WorkflowFileAssetPaths => {
  return {
    metadataPath: join(WORKFLOW_FILE_ASSET_DIRECTORY, `${assetId}.json`),
    contentPath: join(WORKFLOW_FILE_ASSET_DIRECTORY, `${assetId}.bin`),
  };
};

const buildWorkflowFileReference = (assetId: string) => {
  return `${WORKFLOW_FILE_ASSET_PREFIX}:${assetId}`;
};

const parseWorkflowFileReference = (fileRef: string): string => {
  const [prefix, assetId] = fileRef.split(":");

  if (
    prefix !== WORKFLOW_FILE_ASSET_PREFIX ||
    !assetId ||
    !WORKFLOW_FILE_ASSET_ID_PATTERN.test(assetId)
  ) {
    throw new Error("Invalid file reference.");
  }

  return assetId;
};

export const resolveWorkflowFileAssetPaths = (fileRef: string) => {
  const assetId = parseWorkflowFileReference(fileRef);
  return buildWorkflowFileAssetPaths(assetId);
};

export const readWorkflowFileAssetMetadata = async (
  fileRef: string,
): Promise<WorkflowFileAssetMetadata> => {
  await ensureWorkflowFileAssetDirectory();

  const { metadataPath } = resolveWorkflowFileAssetPaths(fileRef);
  const metadataRaw = await readFile(metadataPath, "utf-8");
  const metadata = JSON.parse(metadataRaw) as WorkflowFileAssetStoredMetadata;

  return {
    ownerUserId: metadata.ownerUserId,
    name: metadata.name,
    mimeType: metadata.mimeType,
    size: metadata.size,
    lastModified: metadata.lastModified,
  };
};

export const resolveWorkflowFileAssetContentPath = async (fileRef: string) => {
  await ensureWorkflowFileAssetDirectory();
  return resolveWorkflowFileAssetPaths(fileRef).contentPath;
};

export const saveWorkflowFileAsset = async ({
  ownerUserId,
  file,
}: {
  ownerUserId: string;
  file: {
    name: string;
    mimeType: string;
    size: number;
    lastModified: number;
    buffer: Buffer;
  };
}) => {
  await ensureWorkflowFileAssetDirectory();

  const assetId = createId();
  const { contentPath, metadataPath } = buildWorkflowFileAssetPaths(assetId);

  const metadata: WorkflowFileAssetStoredMetadata = {
    id: assetId,
    ownerUserId,
    name: file.name,
    mimeType: file.mimeType || "application/octet-stream",
    size: file.size,
    lastModified: file.lastModified,
    createdAt: new Date().toISOString(),
  };

  await writeFile(contentPath, file.buffer);
  await writeFile(metadataPath, JSON.stringify(metadata), "utf-8");

  return {
    fileRef: buildWorkflowFileReference(assetId),
    name: metadata.name,
    mimeType: metadata.mimeType,
    size: metadata.size,
    lastModified: metadata.lastModified,
  } satisfies WorkflowFileAssetSummary;
};

export const loadWorkflowFileAsset = async (fileRef: string) => {
  await ensureWorkflowFileAssetDirectory();

  const assetId = parseWorkflowFileReference(fileRef);
  const { contentPath, metadataPath } = buildWorkflowFileAssetPaths(assetId);

  const metadataRaw = await readFile(metadataPath, "utf-8");
  const metadata = JSON.parse(metadataRaw) as WorkflowFileAssetStoredMetadata;
  const buffer = await readFile(contentPath);

  return {
    ownerUserId: metadata.ownerUserId,
    name: metadata.name,
    mimeType: metadata.mimeType,
    size: metadata.size,
    lastModified: metadata.lastModified,
    buffer,
  };
};

export const deleteWorkflowFileAsset = async (fileRef: string) => {
  await ensureWorkflowFileAssetDirectory();

  const { contentPath, metadataPath } = resolveWorkflowFileAssetPaths(fileRef);
  const { rm } = await import("node:fs/promises");
  await Promise.all([
    rm(contentPath, { force: true }),
    rm(metadataPath, { force: true }),
  ]);
};
