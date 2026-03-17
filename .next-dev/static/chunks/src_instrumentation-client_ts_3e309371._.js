(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/src/instrumentation-client.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
__turbopack_context__.s([
    "onRouterTransitionStart",
    ()=>onRouterTransitionStart
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$nextjs$2f$build$2f$esm$2f$client$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@sentry/nextjs/build/esm/client/index.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2d$internal$2f$replay$2f$build$2f$npm$2f$esm$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry-internal/replay/build/npm/esm/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$nextjs$2f$build$2f$esm$2f$client$2f$routing$2f$appRouterRoutingInstrumentation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/nextjs/build/esm/client/routing/appRouterRoutingInstrumentation.js [app-client] (ecmascript)");
globalThis["_sentryRouteManifest"] = "{\"dynamicRoutes\":[{\"path\":\"/workflows/:workflowId\",\"regex\":\"^/workflows/([^/]+)$\",\"paramNames\":[\"workflowId\"],\"hasOptionalPrefix\":false},{\"path\":\"/credentials/:credentialId\",\"regex\":\"^/credentials/([^/]+)$\",\"paramNames\":[\"credentialId\"],\"hasOptionalPrefix\":false},{\"path\":\"/executions/:executionId\",\"regex\":\"^/executions/([^/]+)$\",\"paramNames\":[\"executionId\"],\"hasOptionalPrefix\":false}],\"staticRoutes\":[{\"path\":\"/login\"},{\"path\":\"/signup\"},{\"path\":\"/credentials\"},{\"path\":\"/credentials/new\"},{\"path\":\"/executions\"},{\"path\":\"/workflows\"},{\"path\":\"/sentry-example-page\"}],\"isrRoutes\":[]}";
globalThis["_sentryNextJsVersion"] = "15.5.11";
globalThis["_sentryRewritesTunnelPath"] = "/monitoring";
;
__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$nextjs$2f$build$2f$esm$2f$client$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["init"]({
    dsn: "https://575814236cf333a1bddc47859f11b36c@o4510712105861120.ingest.de.sentry.io/4510741558526032",
    // Add optional integrations for additional features
    integrations: [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2d$internal$2f$replay$2f$build$2f$npm$2f$esm$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["replayIntegration"]()
    ],
    // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
    tracesSampleRate: 1,
    // Enable logs to be sent to Sentry
    enableLogs: true,
    // Define how likely Replay events are sampled.
    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production
    replaysSessionSampleRate: 0.1,
    // Define how likely Replay events are sampled when an error occurs.
    replaysOnErrorSampleRate: 1.0,
    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false
});
const onRouterTransitionStart = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$nextjs$2f$build$2f$esm$2f$client$2f$routing$2f$appRouterRoutingInstrumentation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["captureRouterTransitionStart"];
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=src_instrumentation-client_ts_3e309371._.js.map