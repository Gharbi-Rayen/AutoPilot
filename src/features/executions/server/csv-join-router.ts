import { z } from "zod";
import prisma from "@/lib/db";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import {
  availableContextKeys,
  resolveContextValue,
  streamContextRows,
  extractInlineRows,
} from "../components/csv-shared/executor-utils";
import { estimateJoinCardinality } from "./datasets/cardinality-estimator";
import { type JoinType, planJoinStrategy } from "./datasets/join-planner";
import { isDatasetRef } from "./datasets/dataset-ref";

const getRowCount = (value: unknown): number => {
  if (isDatasetRef(value)) return value.rowCount;
  return extractInlineRows(value).length;
};

export const csvJoinRouter = createTRPCRouter({
  estimateOutput: protectedProcedure
    .input(
      z.object({
        workflowId: z.string(),
        leftVariable: z.string().optional(),
        rightVariable: z.string().optional(),
        joinType: z
          .enum([
            "inner",
            "left",
            "right",
            "full",
            "cross",
            "natural",
            "union",
            "union_all",
          ])
          .optional(),
        keyPairs: z
          .array(z.object({ leftKey: z.string(), rightKey: z.string() }))
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const workflow = await prisma.workflow.findFirstOrThrow({
        where: { id: input.workflowId, userId: ctx.auth.user.id },
      });

      const execution = await prisma.execution.findFirst({
        where: { workflowId: workflow.id, status: "SUCCESS" },
        orderBy: { finishedAt: "desc" },
      });

      if (!execution) {
        return {
          estimatedOutputRows: 0,
          riskLevel: "low",
          warnings: [
            "No completed execution found for this workflow. Run it first to preview joins.",
          ],
        };
      }

      const output = execution.output as Record<string, unknown>;
      const contextKeys = availableContextKeys(output);

      if (!input.leftVariable || !input.rightVariable) {
        return { estimatedOutputRows: 0, riskLevel: "low", warnings: [] };
      }

      if (
        !contextKeys.includes(input.leftVariable) ||
        !contextKeys.includes(input.rightVariable)
      ) {
        return {
          estimatedOutputRows: 0,
          riskLevel: "low",
          warnings: [
            "Selected variables not found in the latest execution output.",
          ],
        };
      }

      const leftSource = resolveContextValue(output, input.leftVariable);
      const rightSource = resolveContextValue(output, input.rightVariable);

      try {
        const joinType = (input.joinType ?? "inner") as
          | JoinType
          | "cross"
          | "natural"
          | "union"
          | "union_all";

        let leftKeys: string[] = [];
        let rightKeys: string[] = [];

        if (input.keyPairs) {
          leftKeys = input.keyPairs.map((p) => p.leftKey);
          rightKeys = input.keyPairs.map((p) => p.rightKey);
        }

        const leftRowCount = getRowCount(leftSource);
        const rightRowCount = getRowCount(rightSource);
        
        const processedJoinType = (joinType === "union" || joinType === "union_all") ? "inner" : joinType;

        const estimateResult = await Promise.race([
          estimateJoinCardinality({
            leftRows: streamContextRows(leftSource),
            rightRows: streamContextRows(rightSource),
            leftKeys,
            rightKeys,
            joinType: processedJoinType,
            leftRowCount,
            rightRowCount,
            sampleSize: 100,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);

        if (!estimateResult) {
          return {
            estimatedOutputRows: -1,
            riskLevel: "high",
            warnings: [
              "Estimation timed out. Data might be too large or complex.",
            ],
          };
        }

        const plan = planJoinStrategy({
          leftRows: leftRowCount,
          rightRows: rightRowCount,
          leftKeys,
          rightKeys,
          joinType: joinType as any,
          allowPartitionedLargeJoin: false,
          estimate: estimateResult,
          caseInsensitive: false,
        });

        let estimatedOutputRows = 0;
        if (joinType === "union" || joinType === "union_all") {
          estimatedOutputRows = leftRowCount + rightRowCount;
        } else if (joinType === "cross") {
          estimatedOutputRows = leftRowCount * rightRowCount;
        } else if (joinType === "inner") {
          estimatedOutputRows = Math.min(leftRowCount, rightRowCount) * estimateResult.estimatedFanout;
        } else if (joinType === "full") {
          estimatedOutputRows = Math.max(leftRowCount, rightRowCount) * estimateResult.estimatedFanout;
        } else if (joinType === "left" || joinType === "left_exclusive") {
          estimatedOutputRows = leftRowCount * estimateResult.estimatedFanout;
        } else if (joinType === "right" || joinType === "right_exclusive") {
          estimatedOutputRows = rightRowCount * estimateResult.estimatedFanout;
        } else {
          estimatedOutputRows = leftRowCount;
        }
        
        estimatedOutputRows = Math.floor(estimatedOutputRows);

        let riskLevel = "low";
        const warnings = [...(estimateResult.warnings || [])];

        if (estimatedOutputRows > 100000 || plan.reason.includes("partition")) {
          riskLevel = "high";
        } else if (estimatedOutputRows > 10000) {
          riskLevel = "medium";
        }

        return {
          estimatedOutputRows,
          riskLevel,
          warnings,
        };
      } catch (e) {
        return {
          estimatedOutputRows: 0,
          riskLevel: "low",
          warnings: [e instanceof Error ? e.message : "Estimation failed"],
        };
      }
    }),
});
