/**
 * generate-sw-manifest.mjs
 *
 * Runs after `next build`. Scans the static export output for every
 * /_next/static/ asset and writes public/sw-manifest.json — a JSON array
 * of URL paths the service worker pre-caches during install.
 *
 * Run via: node scripts/generate-sw-manifest.mjs
 */

import { readdir, writeFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Next.js with output:"export" puts static files in distDir (.next/)
// Older setups used out/. Support both.
function getOutDir() {
  for (const candidate of [".next", "out"]) {
    const dir = join(root, candidate);
    if (existsSync(join(dir, "_next", "static"))) return dir;
  }
  throw new Error(
    "[sw-manifest] Could not find build output. Run `npm run build` first.",
  );
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const outDir = getOutDir();
  const staticDir = join(outDir, "_next", "static");

  console.log(`[sw-manifest] Scanning ${staticDir}`);

  // Collect all /_next/static/ assets
  const staticFiles = await walk(staticDir);
  const staticUrls = staticFiles.map((f) => {
    const rel = relative(outDir, f).replace(/\\/g, "/");
    return `/${rel}`;
  });

  // Also include public/ assets that are served at root URL
  const publicAssets = [
    "/pdf.worker.min.mjs",
    "/logos/logo.svg",
    "/logos/logo-dark.svg",
  ];

  // Include all worker JS files
  const workersDir = join(root, "public", "workers");
  if (existsSync(workersDir)) {
    const workerFiles = await readdir(workersDir);
    for (const f of workerFiles) {
      if (f.endsWith(".js") || f.endsWith(".mjs")) {
        publicAssets.push(`/workers/${f}`);
      }
    }
  }

  // Include icon PNGs
  const iconsDir = join(root, "public", "icons");
  if (existsSync(iconsDir)) {
    const iconFiles = await readdir(iconsDir);
    for (const f of iconFiles) {
      publicAssets.push(`/icons/${f}`);
    }
  }

  // Merge and deduplicate, filter out source maps (not needed offline)
  const allUrls = [...new Set([...staticUrls, ...publicAssets])].filter(
    (u) => !u.endsWith(".map"),
  );

  const manifest = JSON.stringify(allUrls, null, 2);
  const outPath = join(root, "public", "sw-manifest.json");
  await writeFile(outPath, manifest, "utf8");

  console.log(
    `[sw-manifest] Written ${allUrls.length} assets to public/sw-manifest.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
