FROM node:20-alpine AS base
RUN npm i -g pnpm@9

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package manifests
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/

# Build shared package
RUN pnpm --filter @storage-brain/shared build

EXPOSE 3000

CMD ["pnpm", "--filter", "@storage-brain/api", "start:node"]
