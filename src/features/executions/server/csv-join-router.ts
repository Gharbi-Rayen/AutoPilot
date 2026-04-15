import { z } from "zod";
import prisma from "@/lib/db";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  streamContextRows,
} from "../components/csv-shared/executor-utils";
import { estimateJoinCardinality } from "./datasets/cardinality-estimator";
import { isDatasetRef } from "./datasets/dataset-ref";
import { type JoinType, planJoinStrategy } from "./datasets/join-planner";

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
            "full_exclusive",
            "left_exclusive",
            "right_exclusive",
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
        const joinType: JoinType = input.joinType ?? "inner";

        let leftKeys: string[] = [];
        let rightKeys: string[] = [];

        if (input.keyPairs) {
          leftKeys = input.keyPairs.map((p) => p.leftKey);
          rightKeys = input.keyPairs.map((p) => p.rightKey);
        }

        const leftRowCount = getRowCount(leftSource);
        const rightRowCount = getRowCount(rightSource);

        const estimateResult = await Promise.race([
          estimateJoinCardinality({
            leftRows: streamContextRows(leftSource),
            rightRows: streamContextRows(rightSource),
            leftKeys,
            rightKeys,
            joinType,
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
          joinType,
          allowPartitionedLargeJoin: false,
          estimate: estimateResult,
          caseInsensitive: false,
        });

        // inner_estimate: expected matched output rows (shared by several formulas).
        const innerEstimate = Math.max(
          0,
          Math.min(leftRowCount, rightRowCount) *
            estimateResult.estimatedFanout,
        );

        let estimatedOutputRows = 0;
        if (joinType === "inner") {
          estimatedOutputRows = innerEstimate;
        } else if (joinType === "full") {
          // full = matched rows + unmatched-left + unmatched-right
          //      ≈ L + R − inner  (clamped to [max(L,R), L+R])
          estimatedOutputRows = Math.max(
            Math.max(leftRowCount, rightRowCount),
            leftRowCount + rightRowCount - innerEstimate,
          );
        } else if (joinType === "full_exclusive") {
          // Rows that don't match on either side = left_exclusive + right_exclusive
          estimatedOutputRows =
            Math.max(0, leftRowCount - innerEstimate) +
            Math.max(0, rightRowCount - innerEstimate);
        } else if (joinType === "left") {
          // All left rows preserved; multiplied by right fanout.
          estimatedOutputRows = leftRowCount * estimateResult.estimatedFanout;
        } else if (joinType === "left_exclusive") {
          estimatedOutputRows = Math.max(0, leftRowCount - innerEstimate);
        } else if (joinType === "right") {
          estimatedOutputRows = rightRowCount * estimateResult.estimatedFanout;
        } else if (joinType === "right_exclusive") {
          estimatedOutputRows = Math.max(0, rightRowCount - innerEstimate);
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
