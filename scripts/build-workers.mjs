/**
 * Build script: bundles Web Worker TypeScript files and prepares public assets.
 *
 * Run via: node scripts/build-workers.mjs
 *
 * Does three things:
 *   1. Bundles src/workers/*.worker.ts → public/workers/*.worker.js  (esbuild)
 *   2. Copies pdfjs-dist worker        → public/pdf.worker.min.mjs
 *   3. Generates icon-192.png and icon-512.png from the SVG icon spec
 */

import { build } from "esbuild";
import { readdir, copyFile, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname, join, basename } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import zlib from "zlib";
import { promisify } from "util";

const deflate = promisify(zlib.deflate);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ─── 1. Bundle workers ────────────────────────────────────────────────────────

async function buildWorkers() {
  const workerDir = join(root, "src", "workers");
  const outDir = join(root, "public", "workers");

  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

  const files = await readdir(workerDir);
  const workerFiles = files.filter(
    (f) => f.endsWith(".worker.ts") && !f.startsWith("_"),
  );

  if (workerFiles.length === 0) {
    console.warn("[workers] No worker files found in src/workers/");
    return;
  }

  const entryPoints = workerFiles.map((f) => join(workerDir, f));

  await build({
    entryPoints,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome108", "edge108"],
    outdir: outDir,
    // Rename output: csv-parse.worker.ts → csv-parse.worker.js
    entryNames: "[name]",
    alias: {
      "@/lib": join(root, "src", "lib"),
      "@/types": join(root, "src", "types"),
      "@/workers": join(root, "src", "workers"),
    },
    // pdfjs-dist has its own worker file we copy separately; keep it external
    // to avoid bundling the entire 3MB library into the main worker bundle.
    // For non-PDF workers pdfjs-dist isn't imported so this is a no-op.
    external: [],
    minify: false, // keep readable for debugging; set true for prod if desired
    sourcemap: false,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });

  console.log(`[workers] Bundled ${workerFiles.length} workers → public/workers/`);
}

// ─── 2. Copy pdfjs worker ─────────────────────────────────────────────────────

async function copyPdfjsWorker() {
  const require = createRequire(import.meta.url);
  let pdfjsDir;
  try {
    // Resolve the pdfjs-dist package root
    const pdfjsMain = require.resolve("pdfjs-dist/package.json");
    pdfjsDir = dirname(pdfjsMain);
  } catch {
    console.warn("[pdfjs] pdfjs-dist not found — skipping worker copy");
    return;
  }

  const src = join(pdfjsDir, "build", "pdf.worker.min.mjs");
  const dest = join(root, "public", "pdf.worker.min.mjs");

  if (!existsSync(src)) {
    console.warn(`[pdfjs] Worker file not found at ${src}`);
    return;
  }

  await copyFile(src, dest);
  console.log("[pdfjs] Copied pdf.worker.min.mjs → public/");
}

// ─── 3. Generate PNG icons ────────────────────────────────────────────────────

/**
 * Build a minimal valid PNG from raw RGBA pixel data using only Node.js built-ins.
 * The PNG uses color type 2 (RGB, no alpha) and no interlacing.
 */
async function buildPng(width, height, pixelFn) {
  // Each row: 1 filter byte (0 = None) + width * 3 bytes (R,G,B)
  const rowBytes = 1 + width * 3;
  const raw = Buffer.allocUnsafe(height * rowBytes);

  for (let y = 0; y < height; y++) {
    const base = y * rowBytes;
    raw[base] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y, width, height);
      raw[base + 1 + x * 3] = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }

  const compressed = await deflate(raw, { level: 6 });

  function chunk(type, data) {
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(data.length, 0);
    const typeBytes = Buffer.from(type, "ascii");
    const crcBuf = Buffer.concat([typeBytes, data]);
    const crc = crc32(crcBuf);
    const crcOut = Buffer.allocUnsafe(4);
    crcOut.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, typeBytes, data, crcOut]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdrData),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** CRC-32 table for PNG chunk checksums */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Icon pixel function: dark rounded square background + white "A" letterform.
 *
 * Background: #09090b
 * Foreground: #ffffff
 * Corner radius: ~15% of size
 */
function iconPixel(x, y, w, h) {
  const BG = [9, 9, 11];
  const FG = [255, 255, 255];

  const cx = x / w - 0.5; // -0.5 .. +0.5
  const cy = y / h - 0.5;

  // Rounded rect mask (15% radius)
  const rx = 0.35;
  const dx = Math.max(Math.abs(cx) - (0.5 - rx), 0);
  const dy = Math.max(Math.abs(cy) - (0.5 - rx), 0);
  if (dx * dx + dy * dy > rx * rx) return BG;

  // Draw "A" glyph using simple geometric shapes
  // Normalised coords: 0..1
  const nx = x / w;
  const ny = y / h;

  // The "A" occupies roughly 20%–80% horizontally, 20%–80% vertically
  const lx = (nx - 0.2) / 0.6; // 0..1 within letter box
  const ly = (ny - 0.18) / 0.64;

  if (lx < 0 || lx > 1 || ly < 0 || ly > 1) return BG;

  const stroke = 0.13; // stroke width as fraction of letter box

  // Left leg: diagonal from bottom-left to top-center
  // Line from (0, 1) to (0.5, 0): slope = -1/0.5 = -2, or ly = -2*(lx - 0.5) = 1 - 2*lx
  // Distance from point to line: |2*lx + ly - 1| / sqrt(5)
  const distLeft = Math.abs(2 * lx + ly - 1) / Math.sqrt(5);
  const onLeft = distLeft < stroke && lx < 0.5 + stroke;

  // Right leg: diagonal from bottom-right to top-center
  // Line from (1, 1) to (0.5, 0): slope = 2, ly = 2*(lx - 0.5) = 2*lx - 1
  // Distance: |2*lx - ly - 1| / sqrt(5)
  const distRight = Math.abs(2 * lx - ly - 1) / Math.sqrt(5);
  const onRight = distRight < stroke && lx > 0.5 - stroke;

  // Crossbar: horizontal band around ly = 0.52
  const crossY = 0.52;
  const crossH = stroke * 0.75;
  const onCross = Math.abs(ly - crossY) < crossH && lx > 0.22 && lx < 0.78;

  if (onLeft || onRight || onCross) return FG;

  return BG;
}

async function generateIcons() {
  const iconsDir = join(root, "public", "icons");
  if (!existsSync(iconsDir)) await mkdir(iconsDir, { recursive: true });

  for (const size of [192, 512]) {
    const png = await buildPng(size, size, iconPixel);
    const dest = join(iconsDir, `icon-${size}.png`);
    await writeFile(dest, png);
    console.log(`[icons] Generated icon-${size}.png (${png.length} bytes)`);
  }
}

// ─── Run all steps ─────────────────────────────────────────────────────────────

async function main() {
  console.log("=== AutoPilot pre-build ===\n");

  await Promise.all([buildWorkers(), copyPdfjsWorker(), generateIcons()]);

  console.log("\n=== Pre-build complete ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
