/**
 * Generates PWA icon PNGs from public/icons/icon.svg using Chrome headless.
 * Run with: node scripts/generate-icons.mjs
 *
 * Requires Google Chrome installed at the default Windows path.
 * No npm install needed — uses built-in Node.js modules + Chrome.
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

for (const size of [192, 512]) {
  // Embed the SVG inline so Chrome renders it without any file-loading quirks.
  // Force exact pixel dimensions — no viewport scaling artifacts.
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
svg { display: block; width: ${size}px; height: ${size}px; }
</style>
</head>
<body>
${svgRaw.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`)}
</body>
</html>`;

  const tmpHtml = resolve(tmpdir(), `autopilot-icon-${size}.html`);
  const outPng = resolve(root, `public/icons/icon-${size}.png`);
  const outPngFwd = outPng.replace(/\\/g, "/");

  writeFileSync(tmpHtml, html, "utf-8");

  const fileUrl = `file:///${tmpHtml.replace(/\\/g, "/")}`;
  const cmd = [
    `"${CHROME}"`,
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-extensions",
    `--window-size=${size},${size}`,
    `--screenshot="${outPngFwd}"`,
    `"${fileUrl}"`,
  ].join(" ");

  console.log(`Rendering ${size}×${size}…`);
  execSync(cmd, { stdio: "inherit" });
  unlinkSync(tmpHtml);
  console.log(`✓  icon-${size}.png  →  ${outPng}`);
}

console.log("Done.");
