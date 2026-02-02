import type {NodeExecutor} from "@/features/executions/components/types";
import { NonRetriableError } from "inngest";
import ky , {type Options as KyOptions} from "ky"
import Handlebars from "handlebars"; 

Handlebars.registerHelper('json', (context) => {
    const jsonString = JSON.stringify(context , null, 2);
    const safeString = new Handlebars.SafeString(jsonString);
    return safeString;
});

type HttpRequestData={
    variableName:string;
    endpoint:string;
    method:"GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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

    if(!data.variableName){
        //TODO : publish "error" state for http request node
        throw new NonRetriableError("HTTP Request node is not configured with a variable name");
    }

    if(!data.method){
        //TODO : publish "error" state for http request node
        throw new NonRetriableError("HTTP Request node is not configured with a method");
    }

    //const result = await step.fetch(data.endpoint);

    const result = await step.run("http-request",async() => {
        //compile endpoint and body with handlebars
        const endpoint = Handlebars.compile(data.endpoint)(context);
        const method = data.method || "GET";


        const options : KyOptions={
            method,
        };
        if (["POST", "PUT", "PATCH"].includes(method)) {
           
            const resolvedBody = Handlebars.compile(data.body || "{}")(context);
            JSON.parse(resolvedBody);
            options.body = resolvedBody;
            options.headers = {
                "Content-Type": "application/json",
            };

        }

        const response = await ky(endpoint,options);
        const contentType = response.headers.get("content-type");

        const responseData = contentType?.includes("application/json")
        ? await response.json()
        : await response.text();

        
        const responsePlayload = {
            httpResponse : {
                status: response.status,
                statusText: response.statusText,
                data: responseData,
        
            }
        };

        

        return { 
            ...context,
            [data.variableName]: responsePlayload
        };

    



});

    //TODO : publish "completed" in success state for http request node
    return result;
};

