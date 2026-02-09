import { sendWorkflowExecution } from "@/inngest/utils";
import { NextRequest , NextResponse } from "next/server";

// GET handler for testing/debugging
export async function GET(request: NextRequest) {
    return NextResponse.json({ 
        message: "Google Form webhook endpoint is active",
        method: "POST",
        requiredParams: ["workflowId"]
    });
}

export async function POST (request: NextRequest){

    try {
        const url = new URL(request.url);
        const workflowId = url.searchParams.get("workflowId");


        if(!workflowId){
            return  NextResponse.json(
            {success : false ,  error: "Missing required query parameter: workflowId" }, { status: 400 });
        }

        const body = await request.json();
        const formData = {
            formId : body.formId,
            formTitle : body.formTitle,
            responseId : body.responseId,
            timestamp : body.timestamp,
            respondentEmail : body.respondentEmail,
            responses : body.responses,
            raw : body,
        };

        console.log("[Google Form Webhook] Received form submission:", {
            workflowId,
            formId: formData.formId,
            formTitle: formData.formTitle,
        });

        //trigger an inngest job

            const result = await sendWorkflowExecution({
                workflowId: workflowId,
                initialData : {
                    googleFormData : formData,
                }
            });

            console.log("[Google Form Webhook] Inngest event sent:", result);

            return NextResponse.json(
                { success: true, message: "Google form submission processed successfully" }, 
                { status: 200 }
            );

    } catch (error) {
        console.error("Google form webhook error:", error);
        return NextResponse.json(
            {success : false ,  error: "Failed to process Google form Submission" }, { status: 500 });
    }


} 