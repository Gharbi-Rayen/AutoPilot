# AutoPilot — Deployment Guide

> **Who this guide is for:** Anyone who wants to get AutoPilot running — no prior deployment
> experience required. Every technical term is explained the first time it appears.

---

## Table of Contents

1. [Understanding How AutoPilot Works](#1-understanding-how-autopilot-works)
2. [Step 1 — Build the App](#2-step-1--build-the-app)
3. [Option A — Personal Use on Your Own Computer](#3-option-a--personal-use-on-your-own-computer)
4. [Option B — Deploy to Cloudflare Pages (Free, Recommended)](#4-option-b--deploy-to-cloudflare-pages-free-recommended)
5. [Option C — Deploy to Netlify (Free Alternative)](#5-option-c--deploy-to-netlify-free-alternative)
6. [Option D — Deploy to Vercel (Free Alternative)](#6-option-d--deploy-to-vercel-free-alternative)
7. [Installing AutoPilot as a Desktop App (PWA)](#7-installing-autopilot-as-a-desktop-app-pwa)
8. [Where Your Data Lives](#8-where-your-data-lives)
9. [Updating the App](#9-updating-the-app)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Understanding How AutoPilot Works

Before deploying, it helps to understand what kind of app AutoPilot is and why it is unusually simple to deploy.

### What is a "static" app?

Most web apps require a running server — a computer somewhere that is always on, listening for requests, querying a database, and sending responses. AutoPilot is different. It is a **static app**, which means:

- All the code (HTML, JavaScript, CSS, fonts) is pre-built into plain files.
- There is no server to keep running.
- There is no database server. All your data is stored directly in your browser on your own computer.
- To "deploy" it, you simply put those files somewhere that a browser can download them.

Think of it like copying a Word document onto a USB drive vs. running a full SharePoint server. AutoPilot is the USB drive approach.

### Where does the data go?

AutoPilot stores everything locally on the computer of whoever is using it, using two browser technologies:

- **IndexedDB** — a built-in browser database (think: a mini SQLite that lives in your browser). This stores your workflows, execution records, and settings.
- **OPFS (Origin Private File System)** — a private folder that the browser manages on your computer's disk. This stores large dataset files (CSVs) you process. It is invisible to the rest of your operating system but fully accessible to AutoPilot.

Neither of these requires a server. They are wiped if you clear your browser data, so treat them like local application storage.

### What is HTTPS and why does it matter?

**HTTPS** (HyperText Transfer Protocol Secure) is the encrypted version of the web protocol. You can tell a site uses it because the URL starts with `https://` instead of `http://`.

AutoPilot requires HTTPS (or `localhost`) for two reasons:

1. **Service Workers** — the piece of code that makes the app work offline — are only allowed to run on HTTPS pages. This is a browser security rule, not something we can change.
2. **PWA installation** — Chrome and Edge will only offer to install an app as a desktop application if it is served over HTTPS.

All the cloud hosting options in this guide (Cloudflare Pages, Netlify, Vercel) provide HTTPS automatically and for free.

### What is a PWA?

**PWA** stands for Progressive Web App. It is a web app that the browser can install onto your computer so it behaves like a native desktop application — it gets its own window, its own icon in the taskbar, and it works without a browser tab. AutoPilot is configured as a PWA and can be installed this way on Windows, Mac, and Linux.

### What is a Service Worker?

A **Service Worker** is a script that the browser runs in the background, separate from the web page. AutoPilot's service worker does one job: it intercepts all network requests and serves cached files instead of making real network calls. This is what makes the app work completely offline after the first load.

---

## 2. Step 1 — Build the App

Before you can deploy, you need to build the app. **Building** means taking the TypeScript source code and compiling it into plain HTML, JavaScript, and CSS files that any browser can understand.

### Prerequisites

You need these tools installed on your computer:

- **Node.js** (version 20 or later) — the JavaScript runtime that runs the build tools.
  Download from: https://nodejs.org — click the "LTS" version.
- **Git** — version control software used to download the code.
  Download from: https://git-scm.com

Verify they are installed by opening a terminal (Command Prompt or PowerShell on Windows, Terminal on Mac/Linux) and running:

```bash
node --version
# Should print something like: v20.11.0

git --version
# Should print something like: git version 2.43.0
```

### Install dependencies

Dependencies are third-party packages (libraries) that the app relies on. They are not included in the source code — you download them with:

```bash
cd path/to/autopilot
npm install
```

`npm` is the Node Package Manager — it reads the `package.json` file and downloads everything listed there into a folder called `node_modules`.

### Run the build

```bash
npm run build
```

This command does several things in order:

1. **Pre-build step** (`scripts/build-workers.mjs`):
   - Bundles the Web Worker scripts (the code that processes CSV files) into plain `.js` files and puts them in `public/workers/`.
   - Copies the PDF processing library's worker file to `public/pdf.worker.min.mjs`.
   - Generates the app icons (`icon-192.png` and `icon-512.png`).

2. **Next.js build** (`next build`):
   - Compiles all TypeScript into JavaScript.
   - Generates a static HTML file for every page.
   - Bundles and minifies all CSS and JavaScript.
   - Downloads and self-hosts the app fonts (so they work offline).
   - Outputs everything into a folder called `out/`.

When the build finishes successfully, you will see output like this:

```
Route (app)                         Size  First Load JS
┌ ○ /                              244 B         158 kB
├ ○ /executions                   7.49 kB         266 kB
├ ○ /executions/detail            17.5 kB         270 kB
├ ○ /workflows                    12.9 kB         271 kB
└ ○ /workflows/editor              141 kB         392 kB

○  (Static)  prerendered as static content
```

The `○` symbol means each page is a static file — no server needed.

### What is the `out/` folder?

After building, the `out/` folder contains the **entire app** as plain files:

```
out/
├── index.html              ← the home page
├── workflows/
│   ├── index.html          ← the workflows list page
│   └── editor/
│       └── index.html      ← the workflow editor page
├── executions/
│   ├── index.html          ← the executions list page
│   └── detail/
│       └── index.html      ← the execution detail page
├── _next/
│   └── static/             ← all JavaScript, CSS, fonts (hashed filenames)
├── workers/
│   ├── csv-parse.worker.js     ← CSV processing workers
│   ├── csv-filter.worker.js
│   └── ... (11 total)
├── pdf.worker.min.mjs      ← PDF processing library worker
├── manifest.json           ← PWA configuration (name, icons, colors)
├── sw.js                   ← Service worker (offline caching)
├── sw-register.js          ← Registers the service worker on load
└── icons/
    ├── icon.svg
    ├── icon-192.png        ← Required for Android / PWA install
    └── icon-512.png        ← Required for desktop PWA install
```

This folder is everything. To "deploy", you put it somewhere that serves files over HTTPS.

---

## 3. Option A — Personal Use on Your Own Computer

This option is for running AutoPilot locally on your own machine, without publishing it to the internet. It is the simplest possible setup.

### Why can't you just open index.html?

You might think you could just double-click `out/index.html` to open it. Unfortunately, this does not work for apps that use Service Workers. Browsers block Service Workers when you open files directly from disk (using the `file://` protocol). You need a local web server.

### Install a simple file server

```bash
npm install -g serve
```

This installs a tool called `serve` globally on your computer. **Globally** means it is available from any folder, not just this project.

### Run the app

```bash
serve out
```

You will see output like:

```
   ┌─────────────────────────────────────────────┐
   │                                             │
   │   Serving!                                  │
   │                                             │
   │   - Local:    http://localhost:3000         │
   │   - Network:  http://192.168.1.45:3000      │
   │                                             │
   └─────────────────────────────────────────────┘
```

Open Chrome or Edge and go to `http://localhost:3000`. The app loads.

**Important:** `localhost` is treated as trusted by browsers (equivalent to HTTPS for this purpose), so the Service Worker will work and you can install it as a PWA.

### Keep the server running

The `serve` command keeps running in the terminal. If you close the terminal, the app stops being accessible. To keep it running in the background:

- **Windows:** Run it in a terminal window you leave open, or use Windows Task Scheduler.
- **Mac/Linux:** Use `serve out &` to run it in the background, or add it to your startup scripts.

---

## 4. Option B — Deploy to Cloudflare Pages (Free, Recommended)

**Cloudflare Pages** is a free hosting service by Cloudflare. It:
- Hosts your static files on servers around the world (called a **CDN** — Content Delivery Network).
- Provides free HTTPS automatically.
- Deploys automatically whenever you push code to GitHub.
- Has a generous free tier with no time limits.

### What you need

- A free GitHub account (https://github.com)
- A free Cloudflare account (https://cloudflare.com)

### Step 1 — Push your code to GitHub

If your code is not already on GitHub:

```bash
# Create a new repository on github.com first, then:
git remote add origin https://github.com/YOUR_USERNAME/autopilot.git
git branch -M main
git push -u origin main
```

### Step 2 — Connect to Cloudflare Pages

1. Log in to https://dash.cloudflare.com
2. In the left sidebar, click **Workers & Pages**
3. Click **Create application** → **Pages** → **Connect to Git**
4. Click **Connect GitHub** and authorize Cloudflare to access your repositories
5. Select your **autopilot** repository
6. Click **Begin setup**

### Step 3 — Configure the build settings

On the build configuration screen, fill in:

| Setting | Value |
|---|---|
| Project name | `autopilot` (or any name you like) |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `out` |

> **What is "build output directory"?** Cloudflare will run `npm run build` on their servers to build the app. This tells them where the built files end up — in the `out/` folder.

Leave all other settings at their defaults.

### Step 4 — Deploy

Click **Save and Deploy**.

Cloudflare will:
1. Download your code from GitHub
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the app
4. Copy the `out/` folder to their global CDN

The first deploy takes 2–5 minutes. When it finishes, you get a URL like:
```
https://autopilot.pages.dev
```

Your app is now live and accessible from anywhere in the world, over HTTPS.

### Step 5 — Enable custom domain (optional)

If you own a domain name (e.g., `myautopilot.com`), you can point it to your Cloudflare Pages project:

1. In your Pages project → **Custom domains** → **Set up a custom domain**
2. Enter your domain name
3. Follow Cloudflare's instructions to update your DNS records

### Automatic deployments

Every time you run `git push origin main`, Cloudflare automatically rebuilds and redeploys the app. You never need to come back to the Cloudflare dashboard unless you want to change settings.

---

## 5. Option C — Deploy to Netlify (Free Alternative)

**Netlify** is another free static hosting service, similar to Cloudflare Pages.

### Step 1 — Create a Netlify account

Go to https://netlify.com and sign up (you can use your GitHub account).

### Step 2 — Import your project

1. In the Netlify dashboard, click **Add new site** → **Import an existing project**
2. Click **Deploy with GitHub**
3. Authorize Netlify to access your GitHub repositories
4. Select your **autopilot** repository

### Step 3 — Configure build settings

| Setting | Value |
|---|---|
| Branch to deploy | `main` |
| Build command | `npm run build` |
| Publish directory | `out` |

### Step 4 — Configure for single-page routing

Netlify needs a configuration file to handle navigation correctly (so that going to `/workflows/editor/` doesn't return a 404). Create a file called `netlify.toml` in the root of your project:

```toml
[build]
  command = "npm run build"
  publish = "out"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

> **What does this do?** It tells Netlify: "if someone visits a URL you don't have a file for, serve `index.html` instead." The JavaScript in `index.html` then handles the routing. This is standard for single-page apps.

Commit and push this file:

```bash
git add netlify.toml
git commit -m "add netlify config"
git push
```

### Step 5 — Deploy

Click **Deploy site**. Netlify builds and deploys in 2–4 minutes. You get a URL like:
```
https://autopilot-abc123.netlify.app
```

---

## 6. Option D — Deploy to Vercel (Free Alternative)

**Vercel** is the company that makes Next.js. They have a free tier for personal projects.

### Step 1 — Create a Vercel account

Go to https://vercel.com and sign up with your GitHub account.

### Step 2 — Import project

1. Click **Add New...** → **Project**
2. Select your **autopilot** repository from the list
3. Click **Import**

### Step 3 — Configure settings

Vercel automatically detects Next.js and sets the right defaults. You do not need to change anything. Click **Deploy**.

### Step 4 — Done

Vercel builds and deploys in about 2 minutes. You get a URL like:
```
https://autopilot-yourname.vercel.app
```

---

## 7. Installing AutoPilot as a Desktop App (PWA)

Once the app is accessible over HTTPS (or on localhost), you can install it as a desktop application. This gives it its own window, taskbar icon, and makes it feel like a native app.

### On Windows (Chrome or Edge)

1. Open the app in Google Chrome or Microsoft Edge
2. Look for the **install icon** in the address bar — it looks like a computer with a download arrow (⊕) on Chrome, or a `+` in a square on Edge
3. Click it and then click **Install** in the popup
4. AutoPilot appears in your Start Menu and on your taskbar
5. You can launch it without opening a browser

> **If you don't see the install icon:** Go to the browser menu (three dots `⋯`) → **Cast, save, and share** → **Install page as app** (Chrome) or **Apps** → **Install this site as an app** (Edge).

### On Mac (Chrome)

1. Open the app in Google Chrome
2. Click the three-dot menu (⋮) → **Cast, save, and share** → **Install AutoPilot...**
3. Click **Install**
4. AutoPilot appears in your Applications folder and Launchpad

### On Linux (Chrome)

1. Open Chrome and navigate to the app
2. Click the three-dot menu → **More tools** → **Create shortcut...**
3. Check **Open as window** → click **Create**

### Verifying the install worked

After installation, launch AutoPilot from your taskbar or Start Menu. It should open in its own window (no browser address bar, no tabs) with a dark background. This is the standalone PWA mode.

---

## 8. Where Your Data Lives

Understanding where data is stored is important so you know what happens when you uninstall, clear browser data, or switch computers.

### Workflows and execution history

Stored in **IndexedDB** inside your browser. IndexedDB is a database that the browser manages on your local disk, under a folder specific to the website's origin (its URL). You can see it in Chrome DevTools → Application → IndexedDB → `autopilot-db`.

**Consequences:**
- If you clear your browser data (cookies, cache, storage), your workflows are deleted.
- If you access the app from a different computer, you start fresh — data does not sync between devices.
- If you use Chrome on one machine and Edge on the same machine, they have separate databases.

### Dataset files (CSVs you process)

Stored in **OPFS** (Origin Private File System). This is a sandboxed folder on your disk that the browser controls. You cannot browse it in Windows Explorer — it is invisible to the regular file system. You can see it in Chrome DevTools → Application → Storage → File System.

**Consequences:**
- Dataset files stay between app relaunches (they are on disk, not in memory).
- Like IndexedDB, they are tied to the browser and the URL. Clearing site data deletes them.
- Large dataset files (hundreds of MB) are supported.

### Backing up your data

Currently there is no automatic backup system. To avoid losing work:
- Export workflows you care about before clearing browser data.
- Be cautious when clicking "Clear browsing data" — check what categories you are clearing.
- Consider bookmarking the app URL so you always use the same origin.

---

## 9. Updating the App

### If you used Cloudflare Pages / Netlify / Vercel

1. Make your changes to the code
2. Commit them:
   ```bash
   git add .
   git commit -m "describe what you changed"
   git push
   ```
3. The hosting service detects the push, rebuilds the app, and deploys it automatically.
4. Within a few minutes, anyone who opens the app gets the new version.

### How users receive the update

AutoPilot uses a **Service Worker** to cache files for offline use. When you deploy a new version, the cache version in `public/sw.js` changes (it is set to `autopilot-v3`). The browser detects this change and downloads the new files.

The update happens in the background. The user sees the new version the next time they close and reopen the app.

> **If users are stuck on an old version:** Have them go to Chrome DevTools → Application → Service Workers → click **Update**, then reload the page.

---

## 10. Troubleshooting

### The app loads but immediately shows a blank white page

**Cause:** JavaScript failed to execute, or the page component crashed.

**How to diagnose:**
1. Open Chrome DevTools by pressing `F12`
2. Click the **Console** tab
3. Look for red error messages

**Common fixes:**
- If you see "Failed to fetch" errors, a required file is missing from the `out/` folder. Rebuild the app.
- If you see "No QueryClient set", the React Query provider is missing — this should not happen in production builds, try rebuilding.

---

### The install icon (⊕) never appears in the address bar

**Possible causes and fixes:**

1. **The app is not on HTTPS**
   - Check that the URL starts with `https://` (or is `localhost`)
   - Fix: use one of the cloud hosting options which provides HTTPS automatically

2. **The manifest.json is not loading**
   - Open DevTools → Application → Manifest
   - If it shows errors, check that `out/manifest.json` exists and that the build succeeded

3. **The Service Worker is not registered**
   - Open DevTools → Application → Service Workers
   - If none is listed, the `sw-register.js` script did not run
   - Check DevTools → Console for errors about the service worker

4. **You already installed it**
   - If AutoPilot is already installed, the install icon disappears. Look for it in your Start Menu or taskbar instead.

---

### The app works online but not offline

**Cause:** The Service Worker has not cached all necessary files yet.

**Fix:**
1. Visit the app while online and navigate to all pages at least once (home, workflows, executions)
2. The Service Worker caches files as you visit them
3. After visiting all pages, the app works offline

**To verify the Service Worker is active:**
1. DevTools → Application → Service Workers
2. You should see `sw.js` listed with status **Activated**

---

### CSV processing operations never finish

**Cause:** The Web Worker scripts are not loading.

**How to diagnose:**
1. DevTools → Network tab
2. Refresh the page and run a workflow
3. Filter by `/workers/` in the search bar
4. You should see requests for files like `csv-parse.worker.js`

**If the workers are returning 404:**
- The `out/workers/` folder is missing
- Rebuild the app with `npm run build` — the pre-build step generates these files
- Check that `scripts/build-workers.mjs` completed without errors

---

### PDF processing fails

**Cause:** The `pdf.worker.min.mjs` file is missing.

**How to check:**
- Open your deployed URL + `/pdf.worker.min.mjs` in the browser
- You should see JavaScript code, not a 404 page

**Fix:**
- Rebuild with `npm run build` — the pre-build step copies this file from `node_modules/pdfjs-dist/build/`

---

### Changes I push are not showing up for users

**Cause:** The browser is serving the old version from the Service Worker cache.

**Fixes:**
1. **Force refresh:** Press `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac) — this bypasses the Service Worker for that one request
2. **Update the Service Worker:** DevTools → Application → Service Workers → click **Update** → reload
3. **Clear all caches:** DevTools → Application → Storage → click **Clear site data** (warning: this also deletes IndexedDB and OPFS data)

**For all users:** When you push a new build, the Service Worker's cache version (`autopilot-v3` in `public/sw.js`) changes, which tells browsers to download new files automatically. This happens the next time a user opens the app.

---

### The app shows data from the old version of the database

**Cause:** Dexie (the local database) runs schema migrations automatically, but if a migration has a bug it can get stuck.

**Fix:**
1. DevTools → Application → IndexedDB
2. Find `autopilot-db`
3. If you see unexpected tables or missing tables, you may need to delete the database and let it rebuild (you will lose your workflow data)

---

## Quick Reference

| Task | Command |
|---|---|
| Build the app | `npm run build` |
| Test locally | `npx serve out` then open `http://localhost:3000` |
| See built files | Look in the `out/` folder |
| Deploy (after setup) | `git push origin main` |
| Force update (dev) | DevTools → Application → Service Workers → Update |

| Term | Plain English |
|---|---|
| Static app | An app made of plain files — no server needed to run it |
| HTTPS | Encrypted web connection — required for offline features |
| Service Worker | A background script that caches files for offline use |
| PWA | A web app that can be installed like a desktop application |
| IndexedDB | A database built into your browser — stores workflows and execution history |
| OPFS | A private folder on your disk managed by the browser — stores large CSV files |
| CDN | A network of servers around the world that serve your files fast |
| `out/` folder | The folder containing the complete built app, ready to deploy |
| `npm run build` | The command that compiles source code into the deployable `out/` folder |
