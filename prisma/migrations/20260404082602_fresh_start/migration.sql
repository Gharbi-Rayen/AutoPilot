-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('WHATSAPP_TOKEN');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('INITIAL', 'MANUAL_TRIGGER', 'WHATSAPP', 'UPLOAD_FILE', 'PDF_EXTRACT_TEXT', 'PDF_EXTRACT_TABLES', 'PDF_SPLIT', 'PDF_MERGE', 'PDF_FILL_FORM', 'PDF_GENERATE', 'PDF_SIGN', 'CSV_PARSE', 'CSV_GENERATE', 'CSV_FILTER', 'CSV_AGGREGATE', 'CSV_JOIN', 'CSV_SORT', 'CSV_DEDUPLICATE', 'CSV_COLUMN_STATS', 'CSV_COMPARE');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "DatasetStorageType" AS ENUM ('JSONL', 'OBJECT_STORAGE', 'COLUMNAR');

-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('WRITING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "user_email_idx" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

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

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
