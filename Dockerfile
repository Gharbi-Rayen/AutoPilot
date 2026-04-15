# ── Stage 1: install deps ───────────────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app

COPY package*.json ./
# Install all deps (including devDeps — needed for tsx and build tools)
RUN npm ci

# ── Stage 2: build Next.js ──────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client before build
RUN npx prisma generate

# Build Next.js (skips Sentry source map upload unless SENTRY_AUTH_TOKEN is set)
RUN npm run build

# ── Stage 3: production image ───────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install PM2 globally
RUN npm install -g pm2

# Copy everything needed to run Next.js + workers
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src/workers ./src/workers
COPY --from=builder /app/src/features ./src/features
COPY --from=builder /app/src/inngest ./src/inngest
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/src/config ./src/config
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/ecosystem.config.js ./ecosystem.config.js

# Dataset storage — override DATASET_STORAGE_ROOT via env to point at a
# mounted volume so data persists across container restarts.
RUN mkdir -p /app/data/datasets
ENV DATASET_STORAGE_ROOT=/app/data/datasets

EXPOSE 3000

# Run migrations then hand off to PM2
CMD ["sh", "-c", "npx prisma migrate deploy && pm2-runtime ecosystem.config.js"]
