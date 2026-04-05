FROM infisical/cli:0.43.69 AS infisical

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/sdk/package.json packages/sdk/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/dashboard/node_modules ./packages/dashboard/node_modules
COPY --from=deps /app/packages/sdk/node_modules ./packages/sdk/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
# Build SDK first (dashboard depends on it)
RUN pnpm --filter @marlinjai/storage-brain-sdk build
RUN pnpm --filter @storage-brain/dashboard build

# --- Runner ---
FROM base AS runner
ENV NODE_ENV=production

# Infisical CLI from official image (pinned version, no curl|bash)
COPY --from=infisical /bin/infisical /usr/local/bin/infisical

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 app
WORKDIR /app

COPY --from=builder /app/packages/dashboard/.next/standalone ./
COPY --from=builder /app/packages/dashboard/.next/static ./packages/dashboard/.next/static
# public/ is optional — only copy if it exists
RUN mkdir -p packages/dashboard/public

USER app
EXPOSE 3000
ENV PORT=3000

HEALTHCHECK NONE

COPY packages/dashboard/entrypoint.sh ./entrypoint.sh
CMD ["sh", "entrypoint.sh"]
