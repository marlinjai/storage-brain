FROM node:22-alpine AS base
RUN npm i -g pnpm@9

WORKDIR /app

# Install, build and run as the image's unprivileged node user: /app and
# everything copied into it belong to node, so nothing at runtime needs root.
RUN chown node:node /app
USER node

# Copy workspace config
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Copy package manifests
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node packages/api/package.json packages/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY --chown=node:node packages/shared/ packages/shared/
COPY --chown=node:node packages/api/ packages/api/

# Build shared package
RUN pnpm --filter @storage-brain/shared build

EXPOSE 3000

CMD ["pnpm", "--filter", "@storage-brain/api", "start:node"]
