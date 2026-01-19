import { inngest } from '@/inngest/client';
import {  createTRPCRouter , portectedprocedure} from '../init';
import prisma from '@/lib/db';
export const appRouter = createTRPCRouter({
  getWorkflows: portectedprocedure
    .query(({ ctx }) => {
      return prisma.workflow.findMany();
    }),
        createWorkflow: portectedprocedure.mutation(async () => {
          // Implementation for creating a workflow
         await inngest.send({
            name: "test/hello.world",
            data: { email: "rayen@gmail.com"},
         }) 

         return { success: true, message : "Job queued successfully" };
        }),
      });
    

// export type definition of API
export type AppRouter = typeof appRouter;