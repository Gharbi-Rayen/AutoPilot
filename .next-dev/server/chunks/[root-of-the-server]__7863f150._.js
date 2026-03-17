module.exports = [
"[externals]/node:async_hooks [external] (node:async_hooks, cjs, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.resolve().then(() => {
        return parentImport("[externals]/node:async_hooks [external] (node:async_hooks, cjs)");
    });
});
}),
"[project]/node_modules/@vercel/oidc/dist/token-util.js [app-route] (ecmascript, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "server/chunks/node_modules_@vercel_oidc_dist_a704630d._.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[project]/node_modules/@vercel/oidc/dist/token-util.js [app-route] (ecmascript)");
    });
});
}),
"[project]/node_modules/@vercel/oidc/dist/token.js [app-route] (ecmascript, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "server/chunks/node_modules_@vercel_oidc_dist_db6ae372._.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[project]/node_modules/@vercel/oidc/dist/token.js [app-route] (ecmascript)");
    });
});
}),
"[externals]/pdf-parse/worker [external] (pdf-parse/worker, esm_import, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "server/chunks/[externals]_pdf-parse_worker_9dbdb537._.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[externals]/pdf-parse/worker [external] (pdf-parse/worker, esm_import)");
    });
});
}),
"[externals]/pdf-parse [external] (pdf-parse, esm_import, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "server/chunks/[externals]_pdf-parse_1ac68b14._.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[externals]/pdf-parse [external] (pdf-parse, esm_import)");
    });
});
}),
];