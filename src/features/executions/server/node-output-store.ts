import { randomUUID } from "node:crypto";
import prisma from "@/lib/db";

type NodeOutputRow = {
  variableName: string;
  value: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const resolveDatasetId = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind !== "dataset") {
    return null;
  }

  return typeof value.datasetId === "string" ? value.datasetId : null;
};

let missingTableWarningShown = false;

const isMissingTableError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("execution_node_output") &&
    (message.includes("does not exist") ||
      message.includes("relation") ||
      message.includes("42P01"))
  );
};

const warnMissingTable = () => {
  if (missingTableWarningShown) {
    return;
  }

  missingTableWarningShown = true;
  console.warn(
    "[ExecutionNodeOutput] Table execution_node_output is missing. Apply latest Prisma migrations to enable live node outputs.",
  );
};

export const persistExecutionNodeOutputs = async ({
  executionId,
  nodeId,
  output,
}: {
  executionId: string;
  nodeId: string;
  output: Record<string, unknown>;
}) => {
  const entries = Object.entries(output);

  if (entries.length === 0) {
    return;
  }

  try {
    await Promise.all(
      entries.map(async ([variableName, value]) => {
        const serializedValue = JSON.stringify(value ?? null);
        const datasetId = resolveDatasetId(value);

        await prisma.$executeRawUnsafe(
          `
            INSERT INTO "execution_node_output" (
              "id",
              "executionId",
              "nodeId",
              "variableName",
              "datasetId",
              "value",
              "createdAt",
              "updatedAt"
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
            ON CONFLICT ("executionId", "nodeId", "variableName")
            DO UPDATE
            SET
              "datasetId" = EXCLUDED."datasetId",
              "value" = EXCLUDED."value",
              "updatedAt" = NOW()
          `,
          randomUUID(),
          executionId,
          nodeId,
          variableName,
          datasetId,
          serializedValue,
        );
      }),
    );
  } catch (error) {
    if (isMissingTableError(error)) {
      warnMissingTable();
      return;
    }

    throw error;
  }
};

export const resolveExecutionVariableFromNodeOutputs = async ({
  executionId,
  variableName,
  nodeId,
}: {
  executionId: string;
  variableName: string;
  nodeId?: string;
}): Promise<unknown | null> => {
  try {
    const rows = nodeId
      ? await prisma.$queryRawUnsafe<Array<{ value: unknown }>>(
          `
            SELECT "value"
            FROM "execution_node_output"
            WHERE "executionId" = $1
              AND "nodeId" = $2
              AND "variableName" = $3
            ORDER BY "updatedAt" DESC
            LIMIT 1
          `,
          executionId,
          nodeId,
          variableName,
        )
      : await prisma.$queryRawUnsafe<Array<{ value: unknown }>>(
          `
            SELECT "value"
            FROM "execution_node_output"
            WHERE "executionId" = $1
              AND "variableName" = $2
            ORDER BY "updatedAt" DESC
            LIMIT 1
          `,
          executionId,
          variableName,
        );

    const [latest] = rows;
    return latest?.value ?? null;
  } catch (error) {
    if (isMissingTableError(error)) {
      warnMissingTable();
      return null;
    }

    throw error;
  }
};

export const getNodeOutputRecord = async ({
  executionId,
  nodeId,
}: {
  executionId: string;
  nodeId: string;
}): Promise<Record<string, unknown>> => {
  try {
    const rows = await prisma.$queryRawUnsafe<NodeOutputRow[]>(
      `
        SELECT "variableName", "value"
        FROM "execution_node_output"
        WHERE "executionId" = $1
          AND "nodeId" = $2
        ORDER BY "updatedAt" DESC
      `,
      executionId,
      nodeId,
    );

    return Object.fromEntries(
      rows
        .filter(
          (row): row is NodeOutputRow =>
            typeof row.variableName === "string" && row.variableName.length > 0,
        )
        .map((row) => [row.variableName, row.value]),
    );
  } catch (error) {
    if (isMissingTableError(error)) {
      warnMissingTable();
      return {};
    }

    throw error;
  }
};
