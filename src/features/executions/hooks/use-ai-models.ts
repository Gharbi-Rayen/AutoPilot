"use client";

import { useQuery } from "@tanstack/react-query";
import type { AIModel } from "@/features/executions/server/ai-models-router";
import { useTRPC } from "@/trpc/client";

export function useAIModels(provider: "google" | "openai" | "anthropic") {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.aiModels.list.queryOptions({ provider }),
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 15 * 60 * 1000,
    retry: 1,
  });
}

export type { AIModel };
