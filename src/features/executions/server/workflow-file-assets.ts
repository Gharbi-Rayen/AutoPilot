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

type WorkflowFileAssetMetadata = {
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

  const metadata: WorkflowFileAssetMetadata = {
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
  };
};

export const loadWorkflowFileAsset = async (fileRef: string) => {
  await ensureWorkflowFileAssetDirectory();

  const assetId = parseWorkflowFileReference(fileRef);
  const { contentPath, metadataPath } = buildWorkflowFileAssetPaths(assetId);

  const metadataRaw = await readFile(metadataPath, "utf-8");
  const metadata = JSON.parse(metadataRaw) as WorkflowFileAssetMetadata;
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
