/*
  Warnings:

  - You are about to drop the `Connection` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Credentials` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Node` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Workflow` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "DatasetStorageType" AS ENUM ('JSONL', 'OBJECT_STORAGE', 'COLUMNAR');

-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('WRITING', 'READY', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NodeType" ADD VALUE 'UPLOAD_FILE';
ALTER TYPE "NodeType" ADD VALUE 'DOWNLOAD_FILE';
ALTER TYPE "NodeType" ADD VALUE 'READ_FILE';
ALTER TYPE "NodeType" ADD VALUE 'WRITE_FILE';
ALTER TYPE "NodeType" ADD VALUE 'CONVERT_FILE';
ALTER TYPE "NodeType" ADD VALUE 'PDF_EXTRACT_TEXT';
ALTER TYPE "NodeType" ADD VALUE 'PDF_EXTRACT_TABLES';
ALTER TYPE "NodeType" ADD VALUE 'PDF_SPLIT';
ALTER TYPE "NodeType" ADD VALUE 'PDF_MERGE';
ALTER TYPE "NodeType" ADD VALUE 'PDF_FILL_FORM';
ALTER TYPE "NodeType" ADD VALUE 'PDF_GENERATE';
ALTER TYPE "NodeType" ADD VALUE 'PDF_SIGN';
ALTER TYPE "NodeType" ADD VALUE 'CSV_PARSE';
ALTER TYPE "NodeType" ADD VALUE 'CSV_GENERATE';
ALTER TYPE "NodeType" ADD VALUE 'CSV_FILTER';
ALTER TYPE "NodeType" ADD VALUE 'CSV_AGGREGATE';
ALTER TYPE "NodeType" ADD VALUE 'CSV_JOIN';
ALTER TYPE "NodeType" ADD VALUE 'READ_EXCEL';
ALTER TYPE "NodeType" ADD VALUE 'WRITE_EXCEL';
ALTER TYPE "NodeType" ADD VALUE 'APPEND_ROW';
ALTER TYPE "NodeType" ADD VALUE 'SHEET_TRANSFORM';
ALTER TYPE "NodeType" ADD VALUE 'CREATE_PRESENTATION';
ALTER TYPE "NodeType" ADD VALUE 'ADD_SLIDE';
ALTER TYPE "NodeType" ADD VALUE 'FILL_TEMPLATE';
ALTER TYPE "NodeType" ADD VALUE 'RESIZE_IMAGE';
ALTER TYPE "NodeType" ADD VALUE 'CROP_IMAGE';
ALTER TYPE "NodeType" ADD VALUE 'CONVERT_IMAGE';
ALTER TYPE "NodeType" ADD VALUE 'OCR_IMAGE';
ALTER TYPE "NodeType" ADD VALUE 'JSON_TRANSFORM';
ALTER TYPE "NodeType" ADD VALUE 'FILTER';
ALTER TYPE "NodeType" ADD VALUE 'LOOP';
ALTER TYPE "NodeType" ADD VALUE 'CONDITION';
ALTER TYPE "NodeType" ADD VALUE 'DELAY';
ALTER TYPE "NodeType" ADD VALUE 'MERGE';
ALTER TYPE "NodeType" ADD VALUE 'SPLIT';
ALTER TYPE "NodeType" ADD VALUE 'S3_UPLOAD';
ALTER TYPE "NodeType" ADD VALUE 'S3_DOWNLOAD';
ALTER TYPE "NodeType" ADD VALUE 'GOOGLE_DRIVE';
ALTER TYPE "NodeType" ADD VALUE 'DROPBOX';
ALTER TYPE "NodeType" ADD VALUE 'LOCAL_STORAGE';

-- DropForeignKey
ALTER TABLE "Connection" DROP CONSTRAINT "Connection_fromNodeId_fkey";

-- DropForeignKey
ALTER TABLE "Connection" DROP CONSTRAINT "Connection_toNodeId_fkey";

-- DropForeignKey
ALTER TABLE "Connection" DROP CONSTRAINT "Connection_workflowId_fkey";

-- DropForeignKey
ALTER TABLE "Credentials" DROP CONSTRAINT "Credentials_userId_fkey";

-- DropForeignKey
ALTER TABLE "Node" DROP CONSTRAINT "Node_credentialId_fkey";

-- DropForeignKey
ALTER TABLE "Node" DROP CONSTRAINT "Node_workflowId_fkey";

-- DropForeignKey
ALTER TABLE "Workflow" DROP CONSTRAINT "Workflow_userId_fkey";

-- DropTable
DROP TABLE "Connection";

-- DropTable
DROP TABLE "Credentials";

-- DropTable
DROP TABLE "Node";

-- DropTable
DROP TABLE "Workflow";

-- CreateTable
CREATE TABLE "credentials" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CredentialType" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "NodeType" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "credentialId" TEXT,
    "position" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "fromOutput" TEXT NOT NULL DEFAULT 'main',
    "toInput" TEXT NOT NULL DEFAULT 'main',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "output" JSONB,
    "error" TEXT,
    "errorStack" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "inngestEventId" TEXT NOT NULL,

    CONSTRAINT "execution_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "execution_dataset_variable" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "variableName" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_dataset_variable_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "credentials_userId_idx" ON "credentials"("userId");

-- CreateIndex
CREATE INDEX "workflow_userId_idx" ON "workflow"("userId");

-- CreateIndex
CREATE INDEX "node_workflowId_idx" ON "node"("workflowId");

-- CreateIndex
CREATE INDEX "connection_workflowId_idx" ON "connection"("workflowId");

-- CreateIndex
CREATE INDEX "connection_fromNodeId_idx" ON "connection"("fromNodeId");

-- CreateIndex
CREATE INDEX "connection_toNodeId_idx" ON "connection"("toNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "connection_fromNodeId_toNodeId_fromOutput_toInput_key" ON "connection"("fromNodeId", "toNodeId", "fromOutput", "toInput");

-- CreateIndex
CREATE UNIQUE INDEX "execution_inngestEventId_key" ON "execution"("inngestEventId");

-- CreateIndex
CREATE INDEX "execution_workflowId_idx" ON "execution"("workflowId");

-- CreateIndex
CREATE INDEX "execution_status_idx" ON "execution"("status");

-- CreateIndex
CREATE INDEX "execution_startedAt_idx" ON "execution"("startedAt");

-- CreateIndex
CREATE INDEX "execution_dataset_variable_datasetId_idx" ON "execution_dataset_variable"("datasetId");

-- CreateIndex
CREATE INDEX "execution_dataset_variable_executionId_idx" ON "execution_dataset_variable"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "execution_dataset_variable_executionId_variableName_key" ON "execution_dataset_variable"("executionId", "variableName");

-- CreateIndex
CREATE INDEX "ExecutionDatasetChunk_datasetId_idx" ON "ExecutionDatasetChunk"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionDatasetChunk_datasetId_chunkIndex_key" ON "ExecutionDatasetChunk"("datasetId", "chunkIndex");

-- CreateIndex
CREATE INDEX "user_email_idx" ON "user"("email");

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node" ADD CONSTRAINT "node_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node" ADD CONSTRAINT "node_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection" ADD CONSTRAINT "connection_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection" ADD CONSTRAINT "connection_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection" ADD CONSTRAINT "connection_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution" ADD CONSTRAINT "execution_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_dataset_variable" ADD CONSTRAINT "execution_dataset_variable_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_dataset_variable" ADD CONSTRAINT "execution_dataset_variable_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ExecutionDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionDatasetChunk" ADD CONSTRAINT "ExecutionDatasetChunk_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ExecutionDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
