# Deployment Guide

> How to get AutoPilot running in production. The app requires persistent worker processes and a shared filesystem, so Vercel alone is not enough. This guide uses Railway as the primary target.

---

## Why not Vercel-only

Vercel serverless functions time out at 60 seconds. CSV operations on large files take 5–30 minutes. The BullMQ workers run outside Vercel as long-lived processes. Additionally, workers write dataset files to a shared local filesystem that the Next.js API must also be able to read. Vercel cannot mount a persistent volume.

**Required topology:**

```
 ┌─────────────────────────────────┐
 │         Railway Service          │
 │  (single container, persistent) │
 │                                 │
 │  next start         :3000       │
 │  worker-parse       (BullMQ)    │
 │  worker-sort        (BullMQ)    │
 │  worker-filter      (BullMQ)    │
 │  worker-join        (BullMQ)    │
 │  worker-sequence    (BullMQ)    │
 │                                 │
 │  Volume → /app/data/datasets    │
 └───────────┬─────────────────────┘
             │
    ┌────────▼────────┐   ┌─────────────────┐
    │  Railway Redis  │   │  Neon Postgres   │
    │  (managed)      │   │  (existing)      │
    └─────────────────┘   └─────────────────┘
```

All processes share the same container filesystem, so datasets written by workers are immediately readable by Next.js API routes.

---

## Prerequisites

- Node.js 20 (production)
- A Railway account (railway.app)
- Your existing Neon PostgreSQL URL
- An Inngest account (cloud) with an event key and signing key
- Git repository on GitHub/GitLab

---

## Option 1 — Railway (recommended)

### 1.1 Create the Railway project

1. Go to railway.app → **New Project** → **Deploy from GitHub repo**
2. Select your repository

### 1.2 Add Redis

Inside the project:
- Click **+ New** → **Database** → **Redis**
- Railway automatically injects `REDIS_URL` into the service environment

### 1.3 Add a persistent volume

- Click your web service → **Volumes** tab → **Add Volume**
- Mount path: `/app/data`
- Size: start at 10 GB, increase as needed

### 1.4 Set environment variables

In your Railway service → **Variables** tab, add:

```
# Database
DATABASE_URL=postgresql://...   ← your Neon connection string

# Redis — Railway sets this automatically from the Redis plugin
# REDIS_URL is already injected, do not set it manually

# Dataset storage — must match the volume mount path
DATASET_STORAGE_ROOT=/app/data/datasets

# Inngest
INNGEST_EVENT_KEY=...           ← from Inngest dashboard → Event Keys
INNGEST_SIGNING_KEY=...         ← from Inngest dashboard → Signing Keys
INNGEST_BASE_URL=https://your-app.railway.app   ← your Railway public URL

# Auth (better-auth)
BETTER_AUTH_SECRET=...          ← generate with: openssl rand -base64 32
BETTER_AUTH_URL=https://your-app.railway.app

# Sentry (optional — leave unset to disable)
SENTRY_AUTH_TOKEN=...

# Node memory (optional — ecosystem.config.js sets these per worker already)
# NODE_OPTIONS=--max-old-space-size=512
```

### 1.5 Configure the build

Railway detects the `Dockerfile` automatically via `railway.toml`. No extra config needed.

The `Dockerfile` does:
1. `npm ci` — install all dependencies
2. `npx prisma generate` — generate Prisma client
3. `npm run build` — build Next.js
4. Container start: `npx prisma migrate deploy && pm2-runtime ecosystem.config.js`

PM2 starts and monitors:
- `web` — Next.js server
- `worker-parse`, `worker-sort`, `worker-filter`, `worker-join`, `worker-sequence`

### 1.6 Register the app URL with Inngest

In the **Inngest Dashboard** → **Apps** → **Register App**:
- URL: `https://your-app.railway.app/api/inngest`

Inngest will call your app's `/api/inngest` endpoint to register all functions.

### 1.7 Deploy

```bash
git push origin main
```

Railway picks up the push, builds the Dockerfile, and deploys. Watch the deploy logs for:
```
[csv-sort] boot {"version":"csv-sort@...","queue":"csv-sort","concurrency":2,...}
[csv-filter] boot ...
[csv-parse] boot ...
[csv-join] Worker online ...
[csv-consecutive-sequence] Worker online ...
```

If any worker boot log is missing, that operation will silently time out.

---

## Option 2 — Self-hosted (VPS / Docker)

Use this if you want to run on a VPS (DigitalOcean, Hetzner, etc.).

### 2.1 Install prerequisites on the server

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Docker Compose
apt-get install docker-compose-plugin
```

### 2.2 Create `docker-compose.yml`

```yaml
version: "3.9"

services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

  app:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: redis://redis:6379
      DATASET_STORAGE_ROOT: /app/data/datasets
      INNGEST_EVENT_KEY: ${INNGEST_EVENT_KEY}
      INNGEST_SIGNING_KEY: ${INNGEST_SIGNING_KEY}
      INNGEST_BASE_URL: ${INNGEST_BASE_URL}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${INNGEST_BASE_URL}
      NODE_ENV: production
    volumes:
      - datasets:/app/data
    depends_on:
      - redis

volumes:
  redis-data:
  datasets:
```

Create a `.env` file on the server with the same variables as section 1.4.

### 2.3 Deploy

```bash
# On the server
git clone https://github.com/your/repo autopilot
cd autopilot
cp .env.example .env
nano .env  # fill in values

docker compose up -d --build
docker compose logs -f app  # watch startup
```

### 2.4 Set up a reverse proxy (nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Larger body size for file uploads
    client_max_body_size 500M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;

        # SSE (progress events) — disable buffering
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

---

## Local development

### Start everything at once (recommended)

```bash
mprocs
```

This starts (from `mprocs.yaml`):
- Redis (Docker)
- Next.js dev server
- Inngest Dev Server (`inngest-cli dev`)
- All 5 workers with `tsx watch`

### Start services individually

```bash
# Terminal 1 — Redis
docker run --rm -p 6379:6379 redis:7-alpine

# Terminal 2 — Next.js
npm run dev

# Terminal 3 — Inngest dev server
npm run inngest:dev

# Terminal 4-8 — Workers (each in its own terminal)
npm run worker:parse
npm run worker:sort
npm run worker:filter
npm run worker:join
npm run worker:sequence
```

### Start all workers at once (alternative)

```bash
npm run dev:all
```

Uses `concurrently`. All logs appear in one terminal with color-coded prefixes.

---

## Environment variable reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Neon or self-hosted) |
| `REDIS_URL` | Yes | Redis connection string. Default: `redis://localhost:6379` |
| `DATASET_STORAGE_ROOT` | Yes | Absolute path where dataset files are stored. Must be writable by all workers AND readable by Next.js |
| `INNGEST_EVENT_KEY` | Yes (production) | Found in Inngest dashboard → Settings → Event Keys |
| `INNGEST_SIGNING_KEY` | Yes (production) | Found in Inngest dashboard → Settings → Signing Keys |
| `INNGEST_BASE_URL` | Yes (production) | Your app's public URL, used by Inngest to call back to `/api/inngest` |
| `BETTER_AUTH_SECRET` | Yes | Random secret for auth sessions. Generate: `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Yes | Your app's public URL |
| `SENTRY_AUTH_TOKEN` | No | Sentry source map upload token. Skip to disable Sentry |
| `PORT` | No | Next.js listen port. Default: `3000` |
| `NODE_ENV` | No | Set to `production` in all production environments |
| `MAX_IN_MEMORY_ROWS` | No | Override default 200,000 row in-memory limit |
| `DATASET_STORAGE_FORMAT` | No | `jsonl` (default). Future: `object-storage` |
| `DATASET_MAX_CONCURRENT_HEAVY_EXECUTIONS` | No | Max concurrent workflow slots. Default: `2` |

---

## Health checks

### Verify the app is running

```bash
curl https://your-domain.com/api/health
# → 200 OK  {"status":"ok"}
```

To add a health check endpoint, create `src/app/api/health/route.ts`:

```typescript
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "ok", timestamp: Date.now() });
}
```

### Verify workers are running

Check PM2 process status inside the container:

```bash
# Railway — use Railway CLI
railway run pm2 status

# Docker
docker compose exec app pm2 status
```

Expected output:
```
┌─────────────────────┬────┬─────────┬──────┐
│ name                │ id │ status  │ cpu  │
├─────────────────────┼────┼─────────┼──────┤
│ web                 │ 0  │ online  │ 0%   │
│ worker-parse        │ 1  │ online  │ 0%   │
│ worker-sort         │ 2  │ online  │ 0%   │
│ worker-filter       │ 3  │ online  │ 0%   │
│ worker-join         │ 4  │ online  │ 0%   │
│ worker-sequence     │ 5  │ online  │ 0%   │
└─────────────────────┴────┴─────────┴──────┘
```

Any worker showing `errored` means that queue is dead and operations will time out.

### Verify Redis connectivity

```bash
# Railway
railway run redis-cli PING
# → PONG

# Docker
docker compose exec redis redis-cli PING
```

### Verify Inngest registered

In the Inngest Dashboard → **Apps** → your app should show:
- `execute/workflow`
- `relay/csv-sort-progress`
- `relay/csv-filter-progress`
- `cleanup/redis-queue`

If the app is listed but functions are missing, re-deploy or trigger a re-sync by visiting `https://your-domain.com/api/inngest` in a browser.

---

## Troubleshooting

### Operations hang for 30–60 minutes then fail with "timed out"

**Cause:** A worker is not running.

**Fix:**
1. Check `pm2 status` (see above)
2. Check worker logs: `railway run pm2 logs worker-sort --lines 50`
3. Common causes: missing `REDIS_URL`, volume not mounted, worker process crashed repeatedly

### "connection refused" on Redis

**Cause:** Redis is not reachable at `REDIS_URL`.

**Fix:**
1. Confirm `REDIS_URL` is set correctly
2. On Railway: verify the Redis plugin is in the same project and `REDIS_URL` is injected
3. On Docker: confirm the container name matches the compose service name (`redis://redis:6379`)

### "Disk budget exceeded" errors

**Cause:** `DATASET_STORAGE_ROOT` volume is full or `DATASET_MAX_TOTAL_DISK_USAGE_BYTES` limit reached.

**Fix:**
1. Increase the Railway volume size in the dashboard
2. Or delete old executions to free disk space via the app's execution history UI
3. Or increase `DATASET_MAX_TOTAL_DISK_USAGE_BYTES` env var (in bytes, default 4 GB)

### File uploads fail or are very slow

**Cause:** Next.js body size limit (4 MB default) or nginx `client_max_body_size`.

**Fix:**
1. nginx: set `client_max_body_size 500M;`
2. Next.js: the upload route should already handle streaming — check `src/features/executions/components/upload-file/actions.ts`

### Prisma migration fails on startup

**Cause:** Database is unreachable at container start, or migration has a conflict.

**Fix:**
1. Check `DATABASE_URL` is correct
2. Run migrations manually: `railway run npx prisma migrate deploy`
3. If there's a migration conflict, reset dev database: `npx prisma migrate reset` (destroys all data — dev only)

### Build fails: "turbopack not found" or native binary error

**Cause:** Alpine Linux musl vs glibc issue with Rust/Turbopack binaries.

**Fix:** The `Dockerfile` uses `node:20-slim` (Debian-based), not Alpine, to avoid this. If you changed the base image back to Alpine, revert it.

### PWA install prompt not appearing

**Cause:** App is served over HTTP (not HTTPS), or the manifest is invalid.

**Fix:**
1. PWA requires HTTPS — Railway provides this automatically
2. Check `/manifest.json` is accessible (curl `https://your-domain.com/manifest.json`)
3. Chrome: DevTools → Application → Manifest — check for errors

---

## Updating the app

### Railway (automatic)

Push to your main branch. Railway automatically rebuilds and redeploys.

Workers drain gracefully on shutdown (SIGTERM → `worker.close()` → wait for active jobs → exit). In-flight jobs are re-queued by BullMQ on restart.

### Docker (manual)

```bash
git pull
docker compose up -d --build
```

The `--build` flag rebuilds the image. The old container is stopped (SIGTERM sent), workers drain, then the new container starts.

### Database migrations

Migrations run automatically at container startup via `npx prisma migrate deploy`. For a zero-downtime migration strategy, run `prisma migrate deploy` on the new instance before routing traffic to it.
