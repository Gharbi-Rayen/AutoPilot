import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import type { Edge, Node } from "@xyflow/react";
import { generateSlug } from "random-word-slugs";
import z from "zod";
import { PAGINATION } from "@/config/constants";
import { registerExecutionInQueue } from "@/features/executions/server/execution-queue";
import { classifyExecutionProfile } from "@/features/executions/server/queue-policy";
import { NodeType, Prisma } from "@/generated/prisma";
import { inngest } from "@/inngest/client";
import prisma from "@/lib/db";
import {
  createTRPCRouter,
  premiumProcedure,
  protectedProcedure,
} from "@/trpc/init";

const nodeTypeEnum = z.nativeEnum(NodeType);

export const workflowsRouter = createTRPCRouter({
  execute: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: {
          id: input.id,
          userId: ctx.auth.user.id,
        },
        include: {
          nodes: {
            select: {
              type: true,
            },
          },
        },
      });

      const executionProfile = classifyExecutionProfile(
        workflow.nodes.map((node) => node.type),
      );

      // Create execution record BEFORE sending event to ensure user sees it immediately
      const executionId = createId();
      const inngestId = createId();

      // Clean up ALL previous execution datasets for this workflow before starting a new run.
      // Include stuck RUNNING executions — any prior run is stale once we launch a new one.
      const previousExecutions = await prisma.execution.findMany({
        where: { workflowId: input.id },
        select: { id: true },
      });

      if (previousExecutions.length > 0) {
        const { cleanupExecutionDatasets } = await import(
          "@/features/executions/server/datasets/cleanup"
        );
        await cleanupExecutionDatasets({
          executionIds: previousExecutions.map((e) => e.id),
          completedTtlMs: 0,
          orphanTtlMs: 0,
          forceCleanRunning: true,
        }).catch((err) =>
          console.warn("[Router] Failed previous execution cleanup:", err),
        );
      }

      await prisma.execution.create({
        data: {
          id: executionId,
          workflowId: input.id,
          // userId removed as it is not in the schema
          status: "RUNNING",
          startedAt: new Date(),
          inngestEventId: inngestId,
        },
      });

      const queueState = await registerExecutionInQueue({
        executionId,
        profile: executionProfile,
      });

      await inngest.send({
        id: inngestId,
        name: "workflows/execute.workflow",
        data: {
          workflowId: input.id,
          executionId: executionId,
          executionProfile,
        },
      });

      const workflowWithoutNodes = {
        ...workflow,
      };

      delete (workflowWithoutNodes as { nodes?: unknown }).nodes;

      return {
        ...workflowWithoutNodes,
        executionId,
        queueState,
        executionProfile,
      };
    }),

  pauseExecution: protectedProcedure
    .input(z.object({ executionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const execution = await prisma.execution.findFirstOrThrow({
        where: {
          id: input.executionId,
          workflow: {
            userId: ctx.auth.user.id,
          },
        },
        select: {
          id: true,
          status: true,
          workflow: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (execution.status !== "RUNNING") {
        return {
          ...execution,
          paused: false,
        };
      }

      await prisma.execution.update({
        where: {
          id: execution.id,
        },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          error: "Canceled by user.",
          errorStack: null,
          output: Prisma.JsonNull,
        },
      });

      // Clean up any heavy dataset files to instantly free disk space when canceled
      const { getExecutionDatasetsDirectory } = await import(
        "@/features/executions/server/datasets/paths"
      );
      const { rm } = await import("node:fs/promises");
      try {
        await rm(getExecutionDatasetsDirectory(execution.id), {
          recursive: true,
          force: true,
        });
      } catch (cleanupError) {
        console.warn(
          "[Router] Failed to cleanup execution directory on pause:",
          cleanupError,
        );
      }

      return {
        ...execution,
        status: "FAILED" as const,
        paused: true,
      };
    }),

  create: premiumProcedure.mutation(({ ctx }) => {
    return prisma.workflow.create({
      data: {
        name: generateSlug(3),
        userId: ctx.auth.user.id,
        nodes: {
          create: {
            type: NodeType.INITIAL,
            name: NodeType.INITIAL,
            position: { x: 0, y: 0 },
            data: {},
          },
        },
      },
    });
  }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return prisma.workflow.delete({
        where: {
          id: input.id,
          userId: ctx.auth.user.id,
        },
      });
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        nodes: z
          .array(
            z.object({
              id: z.string(),
              type: nodeTypeEnum,
              position: z.object({
                x: z.number(),
                y: z.number(),
              }),
              data: z.record(z.string(), z.any()).optional(),
            }),
          )
          .min(1, "Workflow must have at least one node"),

        edges: z.array(
          z.object({
            source: z.string(),
            target: z.string(),
            sourceHandle: z.string().nullish(),
            targetHandle: z.string().nullish(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, nodes, edges } = input;

      for (const node of nodes) {
        if (
          node.data?.contentBase64 &&
          typeof node.data.contentBase64 === "string" &&
          node.data.contentBase64.length > 1_000
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "contentBase64 must not be persisted for files larger than 1KB. " +
              "Store the file on disk and save only the fileRef pointer.",
          });
        }
      }

      // Verify the workflow exists and belongs to the user
      await prisma.workflow.findUniqueOrThrow({
        where: {
          id,
          userId: ctx.auth.user.id,
        },
      });

      //transaction to ensure consistency
      return await prisma.$transaction(async (tsx) => {
        const existingNodes = await tsx.node.findMany({
          where: { workflowId: id },
          select: {
            id: true,
            name: true,
            type: true,
            position: true,
            data: true,
          },
        });

        const existingNodeById = new Map(
          existingNodes.map((node) => [node.id, node]),
        );
        const incomingNodeById = new Map(nodes.map((node) => [node.id, node]));
        const incomingNodeIds = Array.from(incomingNodeById.keys());

        await tsx.node.deleteMany({
          where: {
            workflowId: id,
            id: {
              notIn: incomingNodeIds,
            },
          },
        });

        const nodesToCreate = nodes.filter(
          (node) => !existingNodeById.has(node.id),
        );
        if (nodesToCreate.length > 0) {
          await tsx.node.createMany({
            data: nodesToCreate.map((node) => ({
              id: node.id,
              workflowId: id,
              name: node.type,
              type: node.type,
              position: node.position,
              data: node.data || {},
            })),
          });
        }

        for (const existingNode of existingNodes) {
          const incomingNode = incomingNodeById.get(existingNode.id);
          if (!incomingNode) {
            continue;
          }

          const nextData = incomingNode.data || {};
          const hasNodeChanged =
            existingNode.name !== incomingNode.type ||
            existingNode.type !== incomingNode.type ||
            JSON.stringify(existingNode.position) !==
              JSON.stringify(incomingNode.position) ||
            JSON.stringify(existingNode.data) !== JSON.stringify(nextData);

          if (!hasNodeChanged) {
            continue;
          }

          await tsx.node.update({
            where: { id: existingNode.id },
            data: {
              name: incomingNode.type,
              type: incomingNode.type,
              position: incomingNode.position,
              data: nextData,
            },
          });
        }

        const toConnectionKey = (connection: {
          source: string;
          target: string;
          sourceHandle?: string | null;
          targetHandle?: string | null;
        }) => {
          return [
            connection.source,
            connection.target,
            connection.sourceHandle || "main",
            connection.targetHandle || "main",
          ].join("|");
        };

        const normalizedIncomingEdges = Array.from(
          new Map(edges.map((edge) => [toConnectionKey(edge), edge])).values(),
        );

        const existingConnections = await tsx.connection.findMany({
          where: { workflowId: id },
          select: {
            id: true,
            fromNodeId: true,
            toNodeId: true,
            fromOutput: true,
            toInput: true,
          },
        });

        const existingConnectionByKey = new Map(
          existingConnections.map((connection) => [
            toConnectionKey({
              source: connection.fromNodeId,
              target: connection.toNodeId,
              sourceHandle: connection.fromOutput,
              targetHandle: connection.toInput,
            }),
            connection,
          ]),
        );

        const incomingConnectionKeys = new Set(
          normalizedIncomingEdges.map((edge) => toConnectionKey(edge)),
        );

        const connectionIdsToDelete = existingConnections
          .filter(
            (connection) =>
              !incomingConnectionKeys.has(
                toConnectionKey({
                  source: connection.fromNodeId,
                  target: connection.toNodeId,
                  sourceHandle: connection.fromOutput,
                  targetHandle: connection.toInput,
                }),
              ),
          )
          .map((connection) => connection.id);

        if (connectionIdsToDelete.length > 0) {
          await tsx.connection.deleteMany({
            where: {
              workflowId: id,
              id: {
                in: connectionIdsToDelete,
              },
            },
          });
        }

        const connectionsToCreate = normalizedIncomingEdges.filter(
          (edge) => !existingConnectionByKey.has(toConnectionKey(edge)),
        );

        if (connectionsToCreate.length > 0) {
          await tsx.connection.createMany({
            data: connectionsToCreate.map((edge) => ({
              workflowId: id,
              fromNodeId: edge.source,
              toNodeId: edge.target,
              fromOutput: edge.sourceHandle || "main",
              toInput: edge.targetHandle || "main",
            })),
          });
        }

        // update workflow's updateAt timestamp
        await tsx.workflow.update({
          where: {
            id,
          },
          data: {
            updatedAt: new Date(),
          },
        });

        // Re-query the workflow to get fresh data with updated timestamp
        return tsx.workflow.findUniqueOrThrow({
          where: {
            id,
          },
        });
      });
    }),
  updateName: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      return prisma.workflow.update({
        where: {
          id: input.id,
          userId: ctx.auth.user.id,
        },
        data: {
          name: input.name,
        },
      });
    }),

  getOne: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: {
          id: input.id,
          userId: ctx.auth.user.id,
        },
        include: {
          nodes: true,
          connections: true,
        },
      });
      //transform server nodes to react flow compatable nodes

      const nodes: Node[] = workflow.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position as { x: number; y: number },
        data: (node.data as Record<string, unknown>) || {},
      }));

      const edges: Edge[] = workflow.connections.map((connection) => ({
        id: connection.id,
        source: connection.fromNodeId,
        target: connection.toNodeId,
        sourceHandle: connection.fromOutput,
        targetHandle: connection.toInput,
      }));

      return { id: workflow.id, name: workflow.name, nodes, edges };
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
      const [items, totalCount] = await Promise.all([
        prisma.workflow.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,

          where: {
            userId: ctx.auth.user.id,
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        }),
        prisma.workflow.count({
          where: {
            userId: ctx.auth.user.id,
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
        }),
      ]);

      const totalPages = Math.ceil(totalCount / pageSize);
      const hasNextPage = page < totalPages;
      const hasPreviousPage = page > 1;

      return {
        items,
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      };
    }),
});
