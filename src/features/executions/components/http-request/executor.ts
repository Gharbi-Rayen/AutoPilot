import type {NodeExecutor} from "@/features/executions/components/types";
import { NonRetriableError } from "inngest";
import ky , {type Options as KyOptions} from "ky"

type HttpRequestData={
    endpoint?:string;
    method?:"GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?:string;
};

export const HttpRequestExecutor: NodeExecutor<HttpRequestData> = async ({
    data,
    nodeId,
    context,
    step }) => {
    //TODO : publish "loading" state for http request node

    if(!data.endpoint){
        //TODO : publish "error" state for http request node
        throw new NonRetriableError("HTTP Request node is not configured with an endpoint");
    }

    //const result = await step.fetch(data.endpoint);

    const result = await step.run("http-request",async() => {
        const endpoint = data.endpoint as string;
        const method = data.method || "GET";


        const options : KyOptions={
            method,
        };
        if (["POST", "PUT", "PATCH"].includes(method)) {
           
            options.body = data.body;
            

        }

        const response = await ky(endpoint,options);
        const contentType = response.headers.get("content-type");

        const responseData = contentType?.includes("application/json")
        ? await response.json()
        : await response.text();

        
        return { 
            ...context,
            httpResponse :{
            status: response.status,
            statusText: response.statusText,
            data: responseData,
            }
        };

    });

    //TODO : publish "completed" in success state for http request node
    return result;
};

