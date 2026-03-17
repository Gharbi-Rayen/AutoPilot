import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

type PolarCustomerClient = {
  customer?: {
    state?: () => Promise<{ data: PolarCustomerState | null }>;
  };
};

type PolarCustomerState = {
  activeSubscriptions?: Array<Record<string, unknown>>;
};

export const useSubscription = () => {
  const polarAuthClient = authClient as PolarCustomerClient;

  return useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      if (!polarAuthClient.customer?.state) {
        return null;
      }

      const { data } = await polarAuthClient.customer.state();
      return data;
    },
  });
};

export const useHasActiveSubscription = () => {
  const { data: customerState, isLoading, ...rest } = useSubscription();

  const hasActiveSubscription =
    customerState?.activeSubscriptions &&
    customerState?.activeSubscriptions.length > 0;

  return {
    hasActiveSubscription,
    subscription: customerState?.activeSubscriptions?.[0],
    isLoading,
    ...rest,
  };
};
