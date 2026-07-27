---
title: Storage Brain
summary: README for Storage Brain, a multi-tenant file storage service with pluggable storage (R2/S3) and database (D1/Postgres) backends, presigned URL uploads, workspace isolation, and a TypeScript SDK published on npm.
type: readme
tags: [storage-brain, file-storage, cloudflare, multi-tenant, sdk]
date: 2026-01-11
---

# Storage Brain

Multi-tenant file storage service with pluggable storage and database backends. Deploy on Cloudflare Workers (R2 + D1) or self-host with Docker (S3 + Postgres). Ships with a TypeScript SDK published as `@marlinjai/storage-brain-sdk`.

## Architecture

```
storage-brain/
├── packages/
│   ├── api/      # API server (Hono)                       @storage-brain/api
│   │   └── src/
│   │       ├── app.ts                # createApp() factory
│   │       ├── index.ts              # Cloudflare Workers entry (R2 + D1)
│   │       ├── node.ts               # Node.js entry (S3 + Postgres)
│   │       ├── adapters/
│   │       │   ├── storage/r2.ts     # Cloudflare R2 adapter
│   │       │   ├── storage/s3.ts     # S3/MinIO/DO Spaces adapter
│   │       │   ├── database/d1.ts    # Cloudflare D1 adapter
│   │       │   └── database/postgres.ts  # Postgres adapter
│   │       └── migrations/001_init.sql   # Postgres schema
│   ├── sdk/      # TypeScript SDK (npm)                    @marlinjai/storage-brain-sdk
│   └── shared/   # Internal types, schemas, adapter interfaces  @storage-brain/shared
├── Dockerfile
├── docker-compose.yml
└── docs/self-hosting.md
```

### Adapter Pattern

Storage and database backends are abstracted via interfaces (`StorageAdapter`, `DatabaseAdapter`). The `createApp()` factory accepts any combination:

| Adapter | Package | Use Case |
|---------|---------|----------|
| `R2StorageAdapter` | Built-in | Cloudflare Workers deployment |
| `S3StorageAdapter` | Built-in | Self-hosted (AWS S3, MinIO, Backblaze, DO Spaces) |
| `D1DatabaseAdapter` | Built-in | Cloudflare Workers deployment |
| `PostgresDatabaseAdapter` | Built-in | Self-hosted (any Postgres) |

### Upload Flow

1. Client calls `POST /api/v1/upload/request` with file metadata.
2. API validates quota, creates a file record, generates a presigned URL, and returns it.
3. Client PUTs the file bytes to the presigned URL (or to the internal `/_internal/upload/*` endpoint).
4. On completion, the file record is marked `completed` and an optional webhook fires.

## Self-Hosting (Docker)

```bash
git clone https://github.com/marlinjai/storage-brain.git
cd storage-brain
docker compose up
```

See [docs/self-hosting.md](docs/self-hosting.md) for full environment variable reference.

## API Endpoints

Base URL: `https://storage-brain-api.marlin-pohl.workers.dev` (managed) or `http://localhost:3000` (self-hosted)

### Public

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Health check |

### Admin (Bearer token = ADMIN_API_KEY)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/admin/tenants` | Create a new tenant (returns API key once) |
| `GET` | `/api/v1/admin/tenants` | List all tenants (paginated) |
| `GET` | `/api/v1/admin/tenants/:tenantId` | Get tenant details |
| `PATCH` | `/api/v1/admin/tenants/:tenantId` | Update tenant properties |
| `DELETE` | `/api/v1/admin/tenants/:tenantId` | Delete tenant and all associated data |
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
| `GET` | `/api/v1/files/:fileId/download` | Download file (signed token auth) |
| `GET` | `/api/v1/files/:fileId/signed-url` | Get a time-limited signed download URL |
| `GET` | `/api/v1/files/:fileId/permanent-url` | Get a permanent (non-expiring) download URL — revoke by rotating `URL_SIGNING_SECRET` |
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
| `POST` | `/webhooks/r2-upload-complete` | R2 event notification callback. Requires an HMAC-SHA256 signature of the raw body in `X-Webhook-Signature`, keyed by `R2_WEBHOOK_SIGNING_SECRET`; the internal R2-event queue consumer is the signer. |

## SDK Usage

### Install

```bash
pnpm add @marlinjai/storage-brain-sdk
```

### Create a Client

```typescript
import { StorageBrain } from '@marlinjai/storage-brain-sdk';

const storage = new StorageBrain({
  apiKey: 'sk_live_your_api_key_here',
  // baseUrl: 'http://localhost:3000', // for self-hosted
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
});
```

### Signed URLs

```typescript
const { url, expiresAt } = await storage.getSignedUrl('file-uuid', 3600);
// Share this URL publicly — no API key required to download
```

### Permanent URLs

For consumers that need a link that survives indefinitely (e.g. Trello card
attachments, review backlogs, emails), use `getPermanentUrl`. The returned URL
never expires on its own; revoke every permanent URL at once by rotating the
`URL_SIGNING_SECRET` server-side.

```typescript
const { url } = await storage.getPermanentUrl('file-uuid');
// Paste into Trello / email / any consumer that needs a long-lived link.
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

// Scope a client to a workspace
const wsStorage = storage.withWorkspace(ws.id);
await wsStorage.upload(fileBlob, { context: 'campaign-images' });
const { files } = await wsStorage.listFiles();

// Or pass workspaceId per-call
await storage.upload(fileBlob, { workspaceId: ws.id });

// List, update, delete workspaces
const workspaces = await storage.listWorkspaces();
await storage.updateWorkspace(ws.id, { name: 'Rebranded Assets' });
await storage.deleteWorkspace(ws.id);
```

## Deployment

### Cloudflare Workers

```bash
cd packages/api
wrangler secret put ADMIN_API_KEY
wrangler secret put URL_SIGNING_SECRET
wrangler d1 migrations apply storage-brain-db
wrangler deploy
```

### Self-Hosted (Docker)

```bash
docker compose up
```

### Publish the SDK

```bash
pnpm publish:sdk
```

## Development

```bash
pnpm install           # Install dependencies
pnpm dev               # Start local dev server (Wrangler)
pnpm build             # Build all packages
pnpm typecheck         # Type check all packages
pnpm lint              # Lint
pnpm format            # Format
```

## Environment Variables

| Name | Where | Description |
|------|-------|-------------|
| `ENVIRONMENT` | `wrangler.toml` / env | `development`, `staging`, or `production` |
| `ADMIN_API_KEY` | Secret / env | Admin bearer token for tenant management |
| `URL_SIGNING_SECRET` | Secret / env | Root HMAC key for signed download URLs. Per-tenant keys are derived from it via `HKDF(URL_SIGNING_SECRET, tenantId)`; rotating the root invalidates every derived signed/permanent/upload URL; that is the revocation mechanism. |
| `R2_WEBHOOK_SIGNING_SECRET` | Secret / env | HMAC-SHA256 key for the `POST /webhooks/r2-upload-complete` signature (`X-Webhook-Signature`). Must be at least 16 chars; the route fails closed (500) when unset. |
| `PUBLIC_BASE_URL` | env | Fully-qualified public origin (e.g. `https://api.storage-brain.example.com`) used to build shareable file URLs. Set this in production so links don't leak internal hostnames. Defaults to the inbound request host. |
| `DB` | Binding | D1 database (Workers only) |
| `BUCKET` | Binding | R2 bucket (Workers only) |
| `DATABASE_URL` | env | Postgres connection string (self-hosted) |
| `S3_BUCKET` | env | S3 bucket name (self-hosted) |
| `S3_REGION` | env | S3 region (self-hosted) |
| `S3_ENDPOINT` | env | Custom S3 endpoint for MinIO/DO Spaces (self-hosted) |
| `AWS_ACCESS_KEY_ID` | env | S3 access key (self-hosted) |
| `AWS_SECRET_ACCESS_KEY` | env | S3 secret key (self-hosted) |

## Database Schema

### Tables

- **tenants** — id, name, api_key_hash, quota_bytes (default 500 MB), used_bytes, allowed_file_types (JSON), timestamps
- **files** — id, tenant_id, workspace_id, original_name, stored_path, file_type, size_bytes, context, tags (JSON), metadata (JSON), processing_status, webhook_url, timestamps, deleted_at (soft delete)
- **upload_sessions** — id, file_id, presigned_url, expires_at, status, created_at
- **workspaces** — id, tenant_id, name, slug (unique per tenant), quota_bytes, used_bytes, metadata (JSON), timestamps

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
| Runtime | Cloudflare Workers / Node.js |
| Framework | Hono |
| Language | TypeScript |
| Database | Cloudflare D1 / Postgres |
| Storage | Cloudflare R2 / S3 (MinIO, Backblaze, DO Spaces) |
| Validation | Zod |
| SDK Bundler | tsup |
| Package Manager | pnpm (workspaces) |

## License

MIT
