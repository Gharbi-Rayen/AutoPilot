import type {NodeExecutor} from "@/features/executions/components/types";
import { GoogleFormTriggerChannel } from "@/inngest/channels/google-form-trigger";


type GoogleFormTriggerData=Record<string,unknown>;

export const GoogleFormExecutor: NodeExecutor<GoogleFormTriggerData> = async ({
    nodeId,
    context,
    step,
    publish,
 }) => {

    const updateStatePublish = async (state : "loading" | "error" | "success" ) => {
        console.log("[GoogleFormExecutor] Publishing status:", { nodeId, state });
        const result = await publish(
            GoogleFormTriggerChannel().status({
                nodeId,
                status: state,
            }),
        );
        console.log("[GoogleFormExecutor] Status published:", { nodeId, state, result });
        return result;
    }

     // publish "loading" state for google form trigger node
    await updateStatePublish("loading");
   
    try {
        const result = await step.run("google-form-trigger", async () => {
            console.log("[GoogleFormExecutor] Processing context:", { 
                nodeId, 
                contextKeys: Object.keys(context),
                contextStructure: JSON.stringify(context, null, 2)
            });
            
            // Log the available variable paths for debugging
            if (context.googleFormData) {
                console.log("[GoogleFormExecutor] Available variable paths:");
                console.log("  - {{googleFormData.formId}}:", context.googleFormData.formId);
                console.log("  - {{googleFormData.formTitle}}:", context.googleFormData.formTitle);
                console.log("  - {{googleFormData.responses}}:", JSON.stringify(context.googleFormData.responses));
                console.log("  - To access response fields, use: {{googleFormData.responses.fieldName}}");
            }
            
            return context;
        });

        // publish "completed" in success state for google form trigger node
        await updateStatePublish("success");
        return result;
    } catch (error) {
        console.error("[GoogleFormExecutor] Error:", { nodeId, error });
        await updateStatePublish("error");
        throw error;
    }
};

