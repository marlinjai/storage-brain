# Storage Brain

Multi-tenant file storage service built on Cloudflare Workers, D1, and R2. Provides a REST API for file upload/download with presigned URLs, tenant isolation, workspace management, quota enforcement, and webhook notifications. Ships with a TypeScript SDK published as `@marlinjai/storage-brain-sdk`.

## Architecture

```
storage-brain/
├── packages/
│   ├── api/      # Cloudflare Workers API (Hono)       @storage-brain/api
│   ├── sdk/      # TypeScript SDK (npm published)       @marlinjai/storage-brain-sdk
│   └── shared/   # Internal types & Zod schemas         @storage-brain/shared
├── docs/         # Clearify documentation
└── package.json  # pnpm workspaces root
```

Upload flow:

1. Client calls `POST /api/v1/upload/request` with file metadata.
2. API validates quota, creates a file record, generates a presigned R2 URL, and returns it.
3. Client PUTs the file bytes to the presigned URL (or to the internal `/_internal/upload/*` endpoint).
4. On completion, the file record is marked `completed` and an optional webhook fires.

### Infrastructure Bindings

| Binding | Type | Resource | Purpose |
|---------|------|----------|---------|
| `DB` | D1 Database | `storage-brain-db` (4ed90c66-738c-4199-893a-158f24b5c50b) | Metadata, tenants, files, workspaces |
| `BUCKET` | R2 Bucket | `storage-brain-files` | Object storage for uploaded files |

## API Endpoints

Base URL: `https://storage-brain-api.marlin-pohl.workers.dev`

### Public

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Health check; returns `{ status, timestamp, environment }` |

### Admin (Bearer token = ADMIN_API_KEY)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/admin/tenants` | Create a new tenant (returns API key once) |
| `POST` | `/api/v1/admin/tenants/:tenantId/regenerate-key` | Regenerate tenant API key |

### Tenant (Bearer token = tenant API key `sk_live_*` / `sk_test_*`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tenant/info` | Get tenant info |
| `GET` | `/api/v1/tenant/quota` | Get quota usage |

### Files

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/upload/request` | Request a presigned upload URL |
| `GET` | `/api/v1/files` | List files (supports `limit`, `cursor`, `context`, `fileType`, `workspaceId`) |
| `GET` | `/api/v1/files/:fileId` | Get file metadata |
| `GET` | `/api/v1/files/:fileId/download` | Download file bytes from R2 |
| `DELETE` | `/api/v1/files/:fileId` | Soft-delete a file |

### Workspaces

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/workspaces` | List workspaces |
| `POST` | `/api/v1/workspaces` | Create a workspace |
| `GET` | `/api/v1/workspaces/:workspaceId` | Get workspace details |
| `PATCH` | `/api/v1/workspaces/:workspaceId` | Update workspace (name, quota, metadata) |
| `DELETE` | `/api/v1/workspaces/:workspaceId` | Delete workspace and soft-delete its files |

### Internal / Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/_internal/upload/*` | Internal upload endpoint (receives file bytes) |
| `POST` | `/webhooks/r2-upload-complete` | R2 event notification callback |

## SDK Usage

### Install

```bash
npm install @marlinjai/storage-brain-sdk
```

### Create a Client

```typescript
import { StorageBrain } from '@marlinjai/storage-brain-sdk';

const storage = new StorageBrain({
  apiKey: 'sk_live_your_api_key_here',
  // baseUrl: 'https://storage-brain-api.marlin-pohl.workers.dev', // default
  // timeout: 30000,   // default
  // maxRetries: 3,    // default
});
```

### Upload a File

```typescript
const file = await storage.upload(fileBlob, {
  context: 'invoices',
  tags: { year: '2026', department: 'finance' },
  onProgress: (percent) => console.log(`${percent}%`),
  webhookUrl: 'https://example.com/hooks/upload-done',
});

console.log(file.id, file.url);
```

### List Files

```typescript
const { files, nextCursor, total } = await storage.listFiles({
  limit: 20,
  context: 'invoices',
  // cursor: nextCursor,  // for pagination
});
```

### Get and Delete a File

```typescript
const file = await storage.getFile('file-uuid');
await storage.deleteFile('file-uuid');
```

### Quota

```typescript
const quota = await storage.getQuota();
console.log(`${quota.usagePercent}% used (${quota.usedBytes}/${quota.quotaBytes})`);
```

### Workspace Management

```typescript
// Create a workspace
const ws = await storage.createWorkspace({
  name: 'Marketing Assets',
  slug: 'marketing-assets',
  quotaBytes: 100 * 1024 * 1024, // 100 MB
});

// Scope a client to a workspace (all uploads/listings use this workspace)
const wsStorage = storage.withWorkspace(ws.id);
await wsStorage.upload(fileBlob, { context: 'campaign-images' });
const { files } = await wsStorage.listFiles();

// Or pass workspaceId per-call
await storage.upload(fileBlob, { workspaceId: ws.id });
await storage.listFiles({ workspaceId: ws.id });

// List, update, delete workspaces
const workspaces = await storage.listWorkspaces();
await storage.updateWorkspace(ws.id, { name: 'Rebranded Assets' });
await storage.deleteWorkspace(ws.id); // soft-deletes all files in it
```

## Deployment

### Prerequisites

- Node.js >= 18
- pnpm
- Wrangler CLI (`npm i -g wrangler`)
- Cloudflare account with Workers, D1, and R2 enabled

### Set Secrets

```bash
cd packages/api
wrangler secret put ADMIN_API_KEY
# staging:
wrangler secret put ADMIN_API_KEY --env staging
```

### Run Database Migrations

```bash
# Production
wrangler d1 migrations apply storage-brain-db

# Staging
wrangler d1 migrations apply storage-brain-db --env staging

# Local (for wrangler dev)
wrangler d1 migrations apply storage-brain-db --local
```

### Deploy

```bash
# Production
pnpm --filter @storage-brain/api deploy
# or: cd packages/api && wrangler deploy

# Staging
pnpm --filter @storage-brain/api deploy:staging
# or: cd packages/api && wrangler deploy --env staging
```

### Publish the SDK

```bash
pnpm publish:sdk
# runs build + npm publish --access public for @marlinjai/storage-brain-sdk
```

## Development

```bash
# Install dependencies
pnpm install

# Start local dev server (packages/api)
pnpm dev

# Build all packages
pnpm build

# Build SDK only
pnpm build:sdk

# Type check all packages
pnpm typecheck

# Lint / format
pnpm lint
pnpm format

# Open D1 Studio (browser-based SQL explorer)
cd packages/api && wrangler d1 studio storage-brain-db
```

Local dev uses `wrangler dev`, which creates a local D1 database and R2 bucket. Run `wrangler d1 migrations apply storage-brain-db --local` before first use.

## Environment Variables and Secrets

| Name | Type | Where | Description |
|------|------|-------|-------------|
| `ENVIRONMENT` | Var | `wrangler.toml` | `production` or `staging` |
| `ADMIN_API_KEY` | Secret | `wrangler secret put` | Admin bearer token for tenant management |
| `DB` | Binding | `wrangler.toml` | D1 database binding |
| `BUCKET` | Binding | `wrangler.toml` | R2 bucket binding |

## Database Schema

### Tables

- **tenants** -- id, name, api_key_hash, quota_bytes (default 500 MB), used_bytes, allowed_file_types (JSON), created_at, updated_at
- **files** -- id, tenant_id, workspace_id (nullable), original_name, stored_path, file_type, size_bytes, context, tags (JSON), metadata (JSON), processing_status, webhook_url, created_at, updated_at, deleted_at (soft delete)
- **upload_sessions** -- id, file_id, presigned_url, expires_at, status (pending/completed/expired/failed), created_at
- **workspaces** -- id, tenant_id, name, slug (unique per tenant), quota_bytes (nullable), used_bytes, metadata (JSON), created_at, updated_at

### Limits

| Limit | Value |
|-------|-------|
| Default tenant quota | 500 MB |
| Max file size | 100 MB |
| Presigned URL TTL | 15 minutes |
| Allowed file types | JPEG, PNG, WebP, GIF, AVIF, PDF |
| API key prefixes | `sk_live_`, `sk_test_` |

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Cloudflare Workers |
| Framework | Hono |
| Language | TypeScript |
| Database | Cloudflare D1 |
| Storage | Cloudflare R2 |
| Validation | Zod |
| SDK Bundler | tsup |
| Package Manager | pnpm (workspaces) |
