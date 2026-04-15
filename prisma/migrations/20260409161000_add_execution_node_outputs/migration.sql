-- CreateTable
CREATE TABLE "execution_node_output" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "variableName" TEXT NOT NULL,
    "datasetId" TEXT,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_node_output_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "execution_node_output_executionId_nodeId_variableName_key" ON "execution_node_output"("executionId", "nodeId", "variableName");

-- CreateIndex
CREATE INDEX "execution_node_output_executionId_nodeId_idx" ON "execution_node_output"("executionId", "nodeId");

-- CreateIndex
CREATE INDEX "execution_node_output_executionId_variableName_idx" ON "execution_node_output"("executionId", "variableName");

-- AddForeignKey
ALTER TABLE "execution_node_output" ADD CONSTRAINT "execution_node_output_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
