/**
 * Generates all PWA / browser icons from public/icons/icon.svg.
 *
 * Outputs:
 *   public/icons/icon-192.png
 *   public/icons/icon-512.png
 *   src/app/favicon.ico  (16 + 32 + 48 px, PNG-in-ICO)
 *
 * Run with: node scripts/generate-icons.mjs
 * Requires Google Chrome at the default Windows install path.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const svgRaw = readFileSync(resolve(root, "public/icons/icon.svg"), "utf-8");

/** Render SVG to PNG at `size×size` via Chrome headless. */
function renderPng(size) {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:${size}px; height:${size}px; overflow:hidden; background:transparent; }
svg { display:block; width:${size}px; height:${size}px; }
</style>
</head>
<body>${svgRaw}</body>
</html>`;

  const tmpHtml = resolve(tmpdir(), `ap-icon-${size}-${Date.now()}.html`);
  const tmpPng  = resolve(tmpdir(), `ap-icon-${size}-${Date.now()}.png`);
  writeFileSync(tmpHtml, html, "utf-8");

  const cmd = [
    `"${CHROME}"`,
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-extensions",
    "--force-device-scale-factor=1",
    `--window-size=${size},${size}`,
    `--screenshot="${tmpPng.replace(/\\/g, "/")}"`,
    `"file:///${tmpHtml.replace(/\\/g, "/")}"`,
  ].join(" ");

  execSync(cmd, { stdio: "pipe" });
  const buf = readFileSync(tmpPng);
  unlinkSync(tmpHtml);
  unlinkSync(tmpPng);
  return buf;
}

/** Pack an array of PNG buffers into a .ico binary (PNG-in-ICO, modern format). */
function buildIco(pngMap) {
  // pngMap: Array<{ size: number, buf: Buffer }>
  const n = pngMap.length;
  const headerSize = 6;
  const dirSize = n * 16;
  let offset = headerSize + dirSize;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = ICO
  header.writeUInt16LE(n, 4); // image count

  const dirs = pngMap.map(({ size, buf }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width  (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2);   // color count (0 = true color)
    entry.writeUInt8(0, 3);   // reserved
    entry.writeUInt16LE(1,  4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buf.byteLength, 8);  // image data size
    entry.writeUInt32LE(offset, 12);          // image data offset
    offset += buf.byteLength;
    return entry;
  });

  return Buffer.concat([header, ...dirs, ...pngMap.map(({ buf }) => buf)]);
}

// ── 1. PWA manifest icons ────────────────────────────────────────────────────
for (const size of [192, 512]) {
  console.log(`Rendering ${size}×${size} PNG…`);
  const buf = renderPng(size);
  const out = resolve(root, `public/icons/icon-${size}.png`);
  writeFileSync(out, buf);
  console.log(`  ✓  icon-${size}.png  (${buf.byteLength.toLocaleString()} bytes)`);
}

// ── 2. favicon.ico (browser tab + desktop shortcut) ─────────────────────────
const icoSizes = [16, 32, 48];
const pngMap = [];
for (const size of icoSizes) {
  console.log(`Rendering ${size}×${size} for favicon.ico…`);
  const buf = renderPng(size);
  pngMap.push({ size, buf });
  console.log(`  rendered ${size}px (${buf.byteLength.toLocaleString()} bytes)`);
}

const ico = buildIco(pngMap);
const icoOut = resolve(root, "src/app/favicon.ico");
writeFileSync(icoOut, ico);
console.log(`✓  favicon.ico  (${icoSizes.join("/")}px, ${ico.byteLength.toLocaleString()} bytes total)`);

console.log("\nDone. All icons updated.");
