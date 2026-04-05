FROM infisical/cli:0.43.69 AS infisical

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
COPY packages/sdk/package.json packages/sdk/
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/sdk/node_modules ./packages/sdk/node_modules
COPY . .
# Build shared + sdk first (api depends on them)
RUN pnpm --filter @storage-brain/shared build 2>/dev/null || true
RUN pnpm --filter @marlinjai/storage-brain-sdk build
# API runs via tsx directly, no build step needed

# --- Runner ---
FROM base AS runner
ENV NODE_ENV=production

# Infisical CLI from official image (pinned version, no curl|bash)
COPY --from=infisical /bin/infisical /usr/local/bin/infisical

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 app
WORKDIR /app

COPY --from=builder /app ./
USER app

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode < 400 ? 0 : 1)).on('error', () => process.exit(1))"

# Secrets injected from Infisical at runtime via machine identity (Universal Auth).
# Coolify only provides INFISICAL_CLIENT_ID + INFISICAL_CLIENT_SECRET.
CMD ["sh", "packages/api/entrypoint.sh"]
