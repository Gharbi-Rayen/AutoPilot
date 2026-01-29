import type {NodeExecutor} from "@/features/executions/components/types";


type ManualTriggerData=Record<string,unknown>;

export const manualTriggerExecutor: NodeExecutor<ManualTriggerData> = async ({
    nodeId,
    context,
    step }) => {
    //TODO : publish "loading" state for manual trigger node

    const result = await step.run("manual-trigger",async() => context);

    //TODO : publish "completed" in success state for manual trigger node

    return result;
};

