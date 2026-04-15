import z from "zod";
import { PAGINATION } from "@/config/constants";
import prisma from "@/lib/db";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { cleanupExecutionDatasets } from "./datasets/cleanup";
import { isDatasetRef } from "./datasets/dataset-ref";
import { datasetService } from "./datasets/dataset-service";
import { inferDatasetSchema } from "./datasets/schema-inference";
import {
  datasetChunkInput,
  datasetDownloadInput,
  datasetPageInput,
  datasetRowsInput,
  datasetVariableInput,
  nodeOutputInput,
} from "./datasets/trpc-inputs";
import {
  getExecutionQueueState,
  getExecutionQueueStates,
} from "./execution-queue";
import {
  getNodeOutputRecord,
  resolveExecutionVariableFromNodeOutputs,
} from "./node-output-store";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toOutputRecord = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : {};
};

const resolveInlineRows = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  if (Array.isArray(value.records)) {
    return value.records.filter(isRecord);
  }

  if (Array.isArray(value.preview)) {
    return value.preview.filter(isRecord);
  }

  return [];
};

const resolveExecutionVariableValue = async ({
  userId,
  executionId,
  variable,
  nodeId,
}: {
  userId: string;
  executionId: string;
  variable: string;
  nodeId?: string;
}) => {
  const execution = await prisma.execution.findFirstOrThrow({
    where: {
      id: executionId,
      workflow: {
        userId,
      },
    },
    select: {
      id: true,
      output: true,
    },
  });

  const output = toOutputRecord(execution.output);
  if (variable in output) {
    return {
      executionId: execution.id,
      value: output[variable],
    };
  }

  const liveValue = await resolveExecutionVariableFromNodeOutputs({
    executionId: execution.id,
    variableName: variable,
    nodeId,
  });

  if (liveValue !== null) {
    return {
      executionId: execution.id,
      value: liveValue,
    };
  }

  throw new Error(
    `Variable '${variable}' not found in execution output or live node outputs.`,
  );
};

export const executionsRouter = createTRPCRouter({
  getNodeOutput: protectedProcedure
    .input(nodeOutputInput)
    .query(async ({ ctx, input }) => {
      const execution = await prisma.execution.findFirstOrThrow({
        where: {
          id: input.executionId,
          workflow: {
            userId: ctx.auth.user.id,
          },
        },
        select: {
          id: true,
        },
      });

      const output = await getNodeOutputRecord({
        executionId: execution.id,
        nodeId: input.nodeId,
      });

      return {
        executionId: execution.id,
        nodeId: input.nodeId,
        output,
      };
    }),

  cleanupDatasets: protectedProcedure
    .input(
      z
        .object({
          executionId: z.string().optional(),
          dryRun: z.boolean().default(false),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const scopedExecutions = await prisma.execution.findMany({
        where: {
          workflow: {
            userId: ctx.auth.user.id,
          },
          ...(input?.executionId ? { id: input.executionId } : {}),
        },
        select: {
          id: true,
        },
      });

      if (input?.executionId && scopedExecutions.length === 0) {
        throw new Error("Execution not found or not accessible.");
      }

      return cleanupExecutionDatasets({
        executionIds: scopedExecutions.map((execution) => execution.id),
        dryRun: input?.dryRun ?? false,
      });
    }),

  getOne: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const execution = await prisma.execution.findFirstOrThrow({
        where: {
          id: input.id,
          workflow: {
            userId: ctx.auth.user.id,
          },
        },
        select: {
          id: true,
          workflowId: true,
          status: true,
          error: true,
          errorStack: true,
          startedAt: true,
          finishedAt: true,
          inngestEventId: true,
          workflow: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      const queueState =
        execution.status === "RUNNING"
          ? await getExecutionQueueState(execution.id)
          : null;

      return {
        ...execution,
        queueState,
      };
    }),

  getOneRawOutput: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return prisma.execution.findFirstOrThrow({
        where: {
          id: input.id,
          workflow: {
            userId: ctx.auth.user.id,
          },
        },
        select: {
          id: true,
          status: true,
          output: true,
        },
      });
    }),

  getDatasetMeta: protectedProcedure
    .input(datasetVariableInput)
    .query(async ({ ctx, input }) => {
      const { value } = await resolveExecutionVariableValue({
        userId: ctx.auth.user.id,
        executionId: input.executionId,
        variable: input.variable,
        nodeId: input.nodeId,
      });

      if (isDatasetRef(value)) {
        const metadata = await datasetService.getDatasetMeta(
          value.executionId,
          value.datasetId,
        );

        return {
          kind: "dataset-ref" as const,
          variable: input.variable,
          ...metadata,
        };
      }

      const rows = resolveInlineRows(value);
      const schema =
        isRecord(value) && isRecord(value.schema)
          ? value.schema
          : inferDatasetSchema(rows);

      return {
        kind: "inline" as const,
        variable: input.variable,
        datasetId: `${input.executionId}:${input.variable}:inline`,
        executionId: input.executionId,
        rowCount: rows.length,
        chunkCount: rows.length > 0 ? 1 : 0,
        byteSize: Buffer.byteLength(JSON.stringify(rows)),
        schema,
      };
    }),

  getDatasetChunk: protectedProcedure
    .input(datasetChunkInput)
    .query(async ({ ctx, input }) => {
      const { value } = await resolveExecutionVariableValue({
        userId: ctx.auth.user.id,
        executionId: input.executionId,
        variable: input.variable,
        nodeId: input.nodeId,
      });

      if (isDatasetRef(value)) {
        const chunk = await datasetService.getDatasetChunk(
          value.executionId,
          value.datasetId,
          input.chunkIndex,
        );

        return {
          kind: "dataset-ref" as const,
          variable: input.variable,
          ...chunk,
        };
      }

      if (input.chunkIndex !== 0) {
        throw new Error("Inline datasets expose only chunkIndex 0.");
      }

      const rows = resolveInlineRows(value);
      return {
        kind: "inline" as const,
        variable: input.variable,
        chunk: {
          chunkIndex: 0,
          fileName: `${input.variable}.inline.json`,
          rowStart: rows.length > 0 ? 1 : 0,
          rowEnd: rows.length,
          rowCount: rows.length,
          cumulativeRowCount: rows.length,
          byteSize: Buffer.byteLength(JSON.stringify(rows)),
          createdAt: new Date(0).toISOString(),
        },
        rows,
      };
    }),

  getDatasetRows: protectedProcedure
    .input(datasetRowsInput)
    .query(async ({ ctx, input }) => {
      const { value } = await resolveExecutionVariableValue({
        userId: ctx.auth.user.id,
        executionId: input.executionId,
        variable: input.variable,
        nodeId: input.nodeId,
      });

      if (isDatasetRef(value)) {
        const page = await datasetService.getDatasetRows(
          value.executionId,
          value.datasetId,
          input.chunkIndex,
          input.offset,
          input.limit,
        );

        return {
          kind: "dataset-ref" as const,
          variable: input.variable,
          ...page,
        };
      }

      if (input.chunkIndex !== 0) {
        throw new Error("Inline datasets expose only chunkIndex 0.");
      }

      const rows = resolveInlineRows(value);
      const safeOffset = Math.max(0, input.offset);
      const safeLimit = Math.max(1, input.limit);

      return {
        kind: "inline" as const,
        variable: input.variable,
        chunk: {
          chunkIndex: 0,
          fileName: `${input.variable}.inline.json`,
          rowStart: rows.length > 0 ? 1 : 0,
          rowEnd: rows.length,
          rowCount: rows.length,
          cumulativeRowCount: rows.length,
          byteSize: Buffer.byteLength(JSON.stringify(rows)),
          createdAt: new Date(0).toISOString(),
        },
        offset: safeOffset,
        limit: safeLimit,
        totalRows: rows.length,
        rows: rows.slice(safeOffset, safeOffset + safeLimit),
      };
    }),

  getDatasetPage: protectedProcedure
    .input(datasetPageInput)
    .query(async ({ ctx, input }) => {
      const { value } = await resolveExecutionVariableValue({
        userId: ctx.auth.user.id,
        executionId: input.executionId,
        variable: input.variable,
        nodeId: input.nodeId,
      });

      if (isDatasetRef(value)) {
        const page = await datasetService.getDatasetRowsByPage(
          value.executionId,
          value.datasetId,
          input.page,
          input.pageSize,
        );

        return {
          kind: "dataset-ref" as const,
          variable: input.variable,
          ...page,
        };
      }

      const rows = resolveInlineRows(value);
      const safePage = Math.max(1, input.page);
      const safePageSize = Math.max(1, input.pageSize);
      const globalOffset = (safePage - 1) * safePageSize;
      const totalPages =
        rows.length === 0 ? 0 : Math.ceil(rows.length / safePageSize);

      return {
        kind: "inline" as const,
        variable: input.variable,
        page: safePage,
        pageSize: safePageSize,
        totalRows: rows.length,
        totalPages,
        window:
          globalOffset >= rows.length
            ? null
            : {
                chunkIndex: 0,
                offset: globalOffset,
                limit: safePageSize,
                globalOffset,
              },
        rows: rows.slice(globalOffset, globalOffset + safePageSize),
      };
    }),

  downloadDataset: protectedProcedure
    .input(datasetDownloadInput)
    .query(async ({ ctx, input }) => {
      const { value } = await resolveExecutionVariableValue({
        userId: ctx.auth.user.id,
        executionId: input.executionId,
        variable: input.variable,
        nodeId: input.nodeId,
      });

      let rows: Array<Record<string, unknown>> = [];

      if (isDatasetRef(value)) {
        for await (const row of datasetService.streamDatasetRows(
          value.executionId,
          value.datasetId,
        )) {
          if (isRecord(row)) {
            rows.push(row);
          }
        }
      } else {
        rows = resolveInlineRows(value);
      }

      if (input.format === "jsonl") {
        const content = rows.map((row) => JSON.stringify(row)).join("\n");
        return {
          format: "jsonl" as const,
          variable: input.variable,
          fileName: `${input.variable}.jsonl`,
          mimeType: "application/x-ndjson",
          content,
        };
      }

      return {
        format: "json" as const,
        variable: input.variable,
        fileName: `${input.variable}.json`,
        mimeType: "application/json",
        data: rows,
      };
    }),

  getMany: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
        pageSize: z
          .number()
          .int()
          .min(PAGINATION.MIN_PAGE_SIZE)
          .max(PAGINATION.MAX_PAGE_SIZE)
          .default(PAGINATION.DEFAULT_PAGE_SIZE),
        search: z.string().default(""),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, search } = input;

      const where = {
        workflow: {
          userId: ctx.auth.user.id,
          ...(search
            ? { name: { contains: search, mode: "insensitive" as const } }
            : {}),
        },
      };

      const [items, totalCount] = await Promise.all([
        prisma.execution.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
          where,
          include: {
            workflow: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            startedAt: "desc",
          },
        }),
        prisma.execution.count({ where }),
      ]);

      const queueStates = await getExecutionQueueStates(
        items
          .filter((item) => item.status === "RUNNING")
          .map((item) => item.id),
      );

      const itemsWithQueueState = items.map((item) => ({
        ...item,
        queueState: item.status === "RUNNING" ? queueStates[item.id] : null,
      }));

      const totalPages = Math.ceil(totalCount / pageSize);
      const hasNextPage = page < totalPages;
      const hasPreviousPage = page > 1;

      return {
        items: itemsWithQueueState,
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      };
    }),
});
