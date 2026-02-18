import type { NodeExecutor } from "@/features/executions/components/types";
import { ManualTriggerChannel } from "@/inngest/channels/manual-triggers";

type ManualTriggerData = Record<string, unknown>;

export const manualTriggerExecutor: NodeExecutor<ManualTriggerData> = async ({
  nodeId,
  context,
  step,
  publish,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    console.log("[ManualTriggerExecutor] Publishing status:", {
      nodeId,
      state,
    });
    const result = await publish(
      ManualTriggerChannel().status({
        nodeId,
        status: state,
      }),
    );
    console.log("[ManualTriggerExecutor] Status published:", {
      nodeId,
      state,
      result,
    });
    return result;
  };

  // publish "loading" state for manual trigger node
  await updateStatePublish("loading");

  try {
    const result = await step.run("manual-trigger", async () => {
      console.log("[ManualTriggerExecutor] Processing context:", {
        nodeId,
        contextKeys: Object.keys(context),
      });
      return context;
    });

    // publish "completed" in success state for manual trigger node
    await updateStatePublish("success");
    return result;
  } catch (error) {
    console.error("[ManualTriggerExecutor] Error:", { nodeId, error });
    await updateStatePublish("error");
    throw error;
  }
};
