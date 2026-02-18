import Handlebars from "handlebars";
import { NonRetriableError } from "inngest";
import ky, { type Options as KyOptions } from "ky";
import type { NodeExecutor } from "@/features/executions/components/types";
import { HttpRequestChannel } from "@/inngest/channels/http-request";

Handlebars.registerHelper("json", (context) => {
  const jsonString = JSON.stringify(context, null, 2);
  const safeString = new Handlebars.SafeString(jsonString);
  return safeString;
});

type HttpRequestData = {
  variableName?: string;
  endpoint?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: string;
};

export const HttpRequestExecutor: NodeExecutor<HttpRequestData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
}) => {
  //publish "loading" state for http request node

  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    const result = await publish(
      HttpRequestChannel().status({
        nodeId,
        status: state,
      }),
    );
    return result;
  };
  await updateStatePublish("loading");

  try {
    const result = await step.run("http-request", async () => {
      //validate data
      if (!data.endpoint) {
        // publish "error" state for http request node
        await updateStatePublish("error");

        throw new NonRetriableError(
          "HTTP Request node is not configured with an endpoint",
        );
      }

      if (!data.variableName) {
        // publish "error" state for http request node
        await updateStatePublish("error");
        throw new NonRetriableError(
          "HTTP Request node is not configured with a variable name",
        );
      }

      if (!data.method) {
        // publish "error" state for http request node
        await updateStatePublish("error");
        throw new NonRetriableError(
          "HTTP Request node is not configured with a method",
        );
      }

      //compile endpoint and body with handlebars
      const endpoint = Handlebars.compile(data.endpoint)(context);

      // Validate the compiled endpoint
      if (!endpoint || endpoint.trim() === "") {
        console.error("[HttpRequestExecutor] Endpoint compilation failed:", {
          template: data.endpoint,
          compiledResult: endpoint,
          contextKeys: Object.keys(context),
          contextSample: JSON.stringify(context).substring(0, 500),
        });
        throw new NonRetriableError(
          `Endpoint URL is empty after variable interpolation. ` +
            `Template: "${data.endpoint}". ` +
            `Available context keys: ${Object.keys(context).join(", ")}. ` +
            `Check that your variable names match exactly (case-sensitive).`,
        );
      }

      console.log("[HttpRequestExecutor] Endpoint compiled:", {
        template: data.endpoint,
        compiled: endpoint,
      });

      const method = data.method || "GET";

      const options: KyOptions = {
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

      const response = await ky(endpoint, options);
      const contentType = response.headers.get("content-type");

      const responseData = contentType?.includes("application/json")
        ? await response.json()
        : await response.text();

      const responsePlayload = {
        httpResponse: {
          status: response.status,
          statusText: response.statusText,
          data: responseData,
        },
      };

      return {
        ...context,
        [data.variableName]: responsePlayload,
      };
    });

    // publish "completed" in success state for http request node
    await updateStatePublish("success");
    return result;
  } catch (error) {
    console.error("[HttpRequestExecutor] Request failed:", {
      nodeId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
