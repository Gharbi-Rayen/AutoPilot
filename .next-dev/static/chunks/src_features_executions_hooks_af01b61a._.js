(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/src/features/executions/hooks/use-node-status.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useNodeStatus",
    ()=>useNodeStatus
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$inngest$2f$realtime$2f$hooks$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@inngest/realtime/hooks.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
;
;
function useNodeStatus(param) {
    let { nodeId, channel, topic, refreshToken } = param;
    _s();
    const [status, setStatus] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("initial");
    const { data } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$inngest$2f$realtime$2f$hooks$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useInngestSubscription"])({
        refreshToken,
        enabled: true
    });
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useNodeStatus.useEffect": ()=>{
            if (!(data === null || data === void 0 ? void 0 : data.length)) {
                return;
            }
            //find the latest message for the given nodeId
            const latestMessage = data.filter({
                "useNodeStatus.useEffect": (msg)=>msg.kind === "data" && msg.channel === channel && msg.topic === topic && msg.data.nodeId === nodeId
            }["useNodeStatus.useEffect"]).sort({
                "useNodeStatus.useEffect": (a, b)=>{
                    if (a.kind === "data" && b.kind === "data") {
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    }
                    return 0;
                }
            }["useNodeStatus.useEffect"])[0];
            if ((latestMessage === null || latestMessage === void 0 ? void 0 : latestMessage.kind) === "data") {
                setStatus(latestMessage.data.status);
            }
        }
    }["useNodeStatus.useEffect"], [
        data,
        nodeId,
        channel,
        topic
    ]);
    return status;
}
_s(useNodeStatus, "32gEAlUU2aYeTZjGtJoOBdCNsmY=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$inngest$2f$realtime$2f$hooks$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useInngestSubscription"]
    ];
});
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/features/executions/hooks/use-ai-models.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useAIModels",
    ()=>useAIModels
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@tanstack/react-query/build/modern/useQuery.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$trpc$2f$client$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/trpc/client.tsx [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
"use client";
;
;
function useAIModels(provider) {
    _s();
    const trpc = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$trpc$2f$client$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useTRPC"])();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useQuery"])({
        ...trpc.aiModels.list.queryOptions({
            provider
        }),
        staleTime: 10 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
        retry: 1
    });
}
_s(useAIModels, "y1sv+zSdNIsjevyUOOGT2UrOVEk=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$trpc$2f$client$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useTRPC"],
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useQuery"]
    ];
});
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=src_features_executions_hooks_af01b61a._.js.map