import "server-only"; // <-- ensure this file cannot be imported from the client
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { cache } from "react";
import { createTRPCContext } from "./init";
import { makeQueryClient } from "./query-client";
import { appRouter } from "./routers/_app";

// IMPORTANT: Create a stable getter for the query client that
//            will return the same client during the same request.
export const getQueryClient = cache(makeQueryClient);
export const trpc = createTRPCOptionsProxy({
  ctx: createTRPCContext,
  router: appRouter,
  queryClient: getQueryClient,
});
export const caller = appRouter.createCaller(createTRPCContext);

type PrefetchQueryOptions = {
  queryKey: readonly unknown[];
};

/**
 * Prefetches a TRPC query into the stable per-request QueryClient to prepare server-side hydration.
 *
 * @param queryOptions - TRPC query options (from `TRPCQueryOptions`) whose `queryKey` determines the prefetch method; if `queryKey[1]?.type === 'infinite'` an infinite prefetch is performed, otherwise a regular prefetch is used.
 */
export function prefetch(queryOptions: PrefetchQueryOptions) {
  const queryClient = getQueryClient();

  const queryMeta =
    queryOptions.queryKey.length > 1 &&
    typeof queryOptions.queryKey[1] === "object" &&
    queryOptions.queryKey[1] !== null
      ? (queryOptions.queryKey[1] as { type?: unknown })
      : undefined;

  if (queryMeta?.type === "infinite") {
    void queryClient.prefetchInfiniteQuery(
      queryOptions as unknown as Parameters<
        (typeof queryClient)["prefetchInfiniteQuery"]
      >[0],
    );
  } else {
    void queryClient.prefetchQuery(
      queryOptions as Parameters<(typeof queryClient)["prefetchQuery"]>[0],
    );
  }
}

/**
 * Provides React Query hydration state to its children using the server's query client.
 *
 * @param props.children - React nodes that will receive the hydrated query state
 * @returns A React element that wraps `children` with a HydrationBoundary populated from the server query client
 */
export function HydrateClient(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {props.children}
    </HydrationBoundary>
  );
}
