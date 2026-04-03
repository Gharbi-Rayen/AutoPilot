-- CreateEnum
CREATE TYPE "DatasetStorageType" AS ENUM ('JSONL', 'OBJECT_STORAGE', 'COLUMNAR');

-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('WRITING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "ExecutionDataset" (
    "id" TEXT NOT NULL,
    "storage" "DatasetStorageType" NOT NULL DEFAULT 'JSONL',
    "status" "DatasetStatus" NOT NULL DEFAULT 'WRITING',
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "schema" JSONB,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "byteSize" BIGINT,
    "manifestPath" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionDatasetVariable" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "variableName" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionDatasetVariable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionDatasetChunk" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "rowStart" INTEGER NOT NULL,
    "rowEnd" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "byteSize" INTEGER,
    "filePath" TEXT NOT NULL,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionDatasetChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionDatasetVariable_executionId_variableName_key" ON "ExecutionDatasetVariable"("executionId", "variableName");

-- CreateIndex
CREATE INDEX "ExecutionDatasetVariable_datasetId_idx" ON "ExecutionDatasetVariable"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionDatasetChunk_datasetId_chunkIndex_key" ON "ExecutionDatasetChunk"("datasetId", "chunkIndex");

-- CreateIndex
CREATE INDEX "ExecutionDatasetChunk_datasetId_idx" ON "ExecutionDatasetChunk"("datasetId");

-- AddForeignKey
ALTER TABLE "ExecutionDatasetVariable" ADD CONSTRAINT "ExecutionDatasetVariable_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionDatasetVariable" ADD CONSTRAINT "ExecutionDatasetVariable_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ExecutionDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionDatasetChunk" ADD CONSTRAINT "ExecutionDatasetChunk_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ExecutionDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
