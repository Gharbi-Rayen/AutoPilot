import type {NodeExecutor} from "@/features/executions/components/types";
import { ManualTriggerChannel } from "@/inngest/channels/manual-triggers";


type ManualTriggerData=Record<string,unknown>;

export const manualTriggerExecutor: NodeExecutor<ManualTriggerData> = async ({
    nodeId,
    context,
    step,
    publish,
 }) => {

    const updateStatePublish = async (state : "loading" | "error" | "success" ) => {
               return await publish(
                ManualTriggerChannel().status({
                    nodeId,
                    status: state  ,
                }),
            );
        }

     // publish "loading" state for manual trigger node
    await updateStatePublish("loading");
   

    const result = await step.run("manual-trigger",async() => context);

    // publish "completed" in success state for manual trigger node
    await updateStatePublish("success");
    return result;
};

