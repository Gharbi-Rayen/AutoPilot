module.exports = [
"[project]/src/features/executions/hooks/use-node-status.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useNodeStatus",
    ()=>useNodeStatus
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$inngest$2f$realtime$2f$hooks$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@inngest/realtime/hooks.mjs [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
;
;
function useNodeStatus({ nodeId, channel, topic, refreshToken }) {
    const [status, setStatus] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])("initial");
    const { data } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$inngest$2f$realtime$2f$hooks$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useInngestSubscription"])({
        refreshToken,
        enabled: true
    });
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!data?.length) {
            return;
        }
        //find the latest message for the given nodeId
        const latestMessage = data.filter((msg)=>msg.kind === "data" && msg.channel === channel && msg.topic === topic && msg.data.nodeId === nodeId).sort((a, b)=>{
            if (a.kind === "data" && b.kind === "data") {
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            }
            return 0;
        })[0];
        if (latestMessage?.kind === "data") {
            setStatus(latestMessage.data.status);
        }
    }, [
        data,
        nodeId,
        channel,
        topic
    ]);
    return status;
}
}),
"[project]/src/features/executions/hooks/use-ai-models.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useAIModels",
    ()=>useAIModels
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@tanstack/react-query/build/modern/useQuery.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$trpc$2f$client$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/trpc/client.tsx [app-ssr] (ecmascript)");
"use client";
;
;
function useAIModels(provider) {
    const trpc = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$trpc$2f$client$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useTRPC"])();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useQuery"])({
        ...trpc.aiModels.list.queryOptions({
            provider
        }),
        staleTime: 10 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
        retry: 1
    });
}
}),
];

//# sourceMappingURL=src_features_executions_hooks_e31226fd._.js.map