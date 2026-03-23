
import z from "zod";
import { PAGINATION } from "@/config/constants";
import { CredentialType } from "@/generated/prisma";

import prisma from "@/lib/db";
import {
  createTRPCRouter,
  protectedProcedure,
} from "@/trpc/init";


export const credentialsRouter = createTRPCRouter({

  create: protectedProcedure
  .input(z.object({
    name: z.string().min(1,"name is required"),
    type: z.nativeEnum(CredentialType),
    value: z.string().min(1,"value is required"),
  }))
  .mutation(({ ctx , input}) => {
    const { name, type, value } = input;

    return prisma.credentials.create({
      data: {
        name ,
        userId: ctx.auth.user.id,
        type,
        value,
        //add encryption in production
      },
    });
  }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return prisma.credentials.delete({
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
        name: z.string().min(1, "name is required"),
        type: z.nativeEnum(CredentialType),
        value: z.string().min(1, "value is required"),  
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, name, type, value } = input;

      // Verify the credential exists and belongs to the user
      await prisma.credentials.findUniqueOrThrow({
        where: {
          id,
          userId: ctx.auth.user.id,
        },
      });

      return prisma.credentials.update({
        where: {
          id,
          userId: ctx.auth.user.id,
        },
        data: {
          name,
          type,
          value,//add encryption in production
        }
      });
     

    }),
  
  getOne: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return prisma.credentials.findUniqueOrThrow({
        where: {
          id: input.id,
          userId: ctx.auth.user.id,
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
      const [items, totalCount] = await Promise.all([
        prisma.credentials.findMany({
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
            updatedAt: "desc",
          },
        
        }),
        prisma.credentials.count({
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

    getByType : protectedProcedure
    .input(z.object({ type: z.nativeEnum(CredentialType) }))
    .query(async ({ ctx, input }) => {
    const { type } = input;
    return prisma.credentials.findMany({
      where: {
        userId: ctx.auth.user.id,
        type,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  }),
   
    


});
