import z from "zod";
import { PAGINATION } from "@/config/constants";
import prisma from "@/lib/db";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";

export const executionsRouter = createTRPCRouter({
  getOne: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return prisma.execution.findFirstOrThrow({
        where: {
          id: input.id,
          workflow: {
            userId: ctx.auth.user.id,
          },
        },
        include: {
          workflow: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
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
