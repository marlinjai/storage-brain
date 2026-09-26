---
title: Architecture
description: System architecture and design overview
order: 2
icon: "🏗️"
summary: System architecture documentation for Storage Brain covering edge-native design, Cloudflare Workers/R2/D1 tech stack, multi-tenant workspace isolation, and deployment patterns.
type: documentation
tags: [storage-brain, architecture, edge-native, cloudflare]
projects: [storage-brain]
---

# Architecture

Storage Brain is an edge-native file storage service. This page covers the system design, tech stack, and deployment architecture.

## Two-Layer Design

```
Client App
    |
    v
+-----------------------+
|   Gatekeeper API      |   Cloudflare Worker (Hono)
|   - Auth & quota      |
|   - Presigned URLs    |
|   - File management   |
|   - Workspace CRUD    |
|   - Signed URLs       |
|   - Webhook dispatch  |
+-----------------------+
    |              |
    v              v
+--------+   +-----------+
| Storage|   | Database  |
| Adapter|   |  Adapter  |
+--------+   +-----------+
  |                |
  v                v
R2 / S3       D1 / Postgres
```

### Layer 1: Gatekeeper API

The API layer handles all client-facing requests. Built with [Hono](https://hono.dev/) on Cloudflare Workers, it provides:

- **Authentication** -- API key validation via hashed lookup
- **Quota enforcement** -- Per-tenant and per-workspace storage limits checked before upload
- **Upload handshake** -- Returns presigned URLs for direct-to-storage uploads
- **File management** -- CRUD operations on file records
- **Workspace management** -- Create, list, get, update, and delete workspaces within a tenant
- **Signed download URLs** -- HMAC token-based URLs for time-limited, unauthenticated downloads
- **Webhooks** -- Notification delivery to client-specified URLs after upload

### Layer 2: Storage & Database (Adapter Pattern)

Storage and database access are abstracted via adapter interfaces, allowing different backends:

- **Storage adapters** -- **R2** (Cloudflare edge) or **S3** (self-hosted / AWS). Files are organized by tenant: `tenants/{tenantId}/files/{fileId}/{fileName}`
- **Database adapters** -- **D1** (Cloudflare SQLite at the edge) or **Postgres** (self-hosted). Stores tenant records, workspace records, file metadata, and upload sessions

## Tech Stack

| Component | Edge (Cloudflare) | Self-Hosted (Docker) |
|-----------|-------------------|----------------------|
| Runtime | Cloudflare Workers | Node.js |
| API Framework | Hono | Hono |
| Object Storage | Cloudflare R2 | S3-compatible (MinIO) |
| Database | Cloudflare D1 (SQLite) | PostgreSQL |
| Validation | Zod | Zod |
| Language | TypeScript | TypeScript |

## Database Schema

Storage Brain uses four tables:

### `tenants`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | UUID |
| `name` | TEXT (UNIQUE) | Tenant display name |
| `api_key_hash` | TEXT | Bcrypt hash of API key |
| `quota_bytes` | INTEGER | Storage quota in bytes (default: 500 MB) |
| `used_bytes` | INTEGER | Current storage usage |
| `allowed_file_types` | TEXT | JSON array of allowed MIME types |
| `created_at` | INTEGER | Unix timestamp |
| `updated_at` | INTEGER | Unix timestamp |

### `workspaces`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | UUID |
| `tenant_id` | TEXT (FK) | References `tenants.id` |
| `name` | TEXT | Workspace display name |
| `slug` | TEXT | URL-safe identifier (unique per tenant) |
| `quota_bytes` | INTEGER | Optional per-workspace quota in bytes |
| `used_bytes` | INTEGER | Current workspace storage usage (default: 0) |
| `metadata` | TEXT | Optional JSON metadata |
| `created_at` | INTEGER | Unix timestamp |
| `updated_at` | INTEGER | Unix timestamp |

### `files`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | UUID |
| `tenant_id` | TEXT (FK) | References `tenants.id` |
| `workspace_id` | TEXT (FK) | References `workspaces.id` (nullable) |
| `original_name` | TEXT | Original filename |
| `stored_path` | TEXT | Storage object key |
| `file_type` | TEXT | MIME type |
| `size_bytes` | INTEGER | File size |
| `context` | TEXT | Optional free-form string (max 100 chars) |
| `tags` | TEXT | JSON key-value pairs |
| `metadata` | TEXT | JSON object (`{ [key: string]: unknown }`) |
| `processing_status` | TEXT | `completed` (set immediately after upload) |
| `webhook_url` | TEXT | Optional callback URL |
| `created_at` | INTEGER | Unix timestamp |
| `updated_at` | INTEGER | Unix timestamp |
| `deleted_at` | INTEGER | Soft delete timestamp (nullable) |

### `upload_sessions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | UUID |
| `file_id` | TEXT (FK) | References `files.id` |
| `presigned_url` | TEXT | Presigned upload URL |
| `expires_at` | INTEGER | Expiration timestamp |
| `status` | TEXT | `pending` (URL issued), `uploading` (a transfer claimed it), then one of `completed`, `expired` or `failed` |
| `created_at` | INTEGER | Unix timestamp |

## Upload Flow

1. **Client** calls `POST /api/v1/upload/request` with file metadata, including the required `fileSizeBytes` (and optional `workspaceId`)
2. **API** validates auth and, in one atomic step, reserves the declared size against the tenant quota (and workspace quota if applicable) and creates the file record and upload session
3. **API** returns a presigned URL (valid for 15 minutes)
4. **Client** uploads file directly to storage using the presigned URL; a body larger than declared is refused with 413
5. **API** settles the session: the reservation is replaced by the bytes actually stored (a smaller file releases the difference), the file is marked `completed`, and a `file.uploaded` webhook is sent if configured

### Quota accounting

A tenant's (and a workspace's) `used_bytes` is always the sum of `size_bytes` over its live files, where a file whose upload is still open counts its declared size as a reservation. Every change to files, sessions and both counters happens in one transaction, and each upload session is settled exactly once:

- **Completed:** the file's size becomes the stored bytes and the counters move by the difference to the reservation.
- **Failed** (body rejected, cut off, or not storable) or **expired** (URL lapsed unused, or a transfer that never finished): the whole reservation is released and the file is marked `failed` with size 0.
- A sweep settles stale sessions as expired every 5 minutes (a timer in the Node server, a cron trigger on Workers). A transfer already under way gets one hour past its URL expiry before it is reclaimed.
- Deleting a file (or a workspace) releases its bytes and closes any open upload session in the same transaction, so a later settle or sweep cannot release them a second time.

## Deployment

### Edge (Cloudflare)

All functionality deploys as a single Cloudflare Worker with R2 and D1 bindings:

```
Cloudflare Worker
+-- API Routes (Hono)
|   +-- POST /api/v1/upload/request
|   +-- GET  /api/v1/files
|   +-- GET  /api/v1/files/:fileId
|   +-- DELETE /api/v1/files/:fileId
|   +-- GET  /api/v1/files/:fileId/download
|   +-- GET  /api/v1/files/:fileId/signed-url
|   +-- GET  /api/v1/workspaces
|   +-- POST /api/v1/workspaces
|   +-- GET  /api/v1/workspaces/:id
|   +-- PATCH /api/v1/workspaces/:id
|   +-- DELETE /api/v1/workspaces/:id
|   +-- GET  /api/v1/tenant/quota
|   +-- GET  /api/v1/tenant/info
|   +-- POST /api/v1/admin/tenants
|   +-- POST /api/v1/admin/tenants/:tenantId/regenerate-key
+-- Bindings
    +-- D1 Database
    +-- R2 Bucket
```

### Self-Hosted (Docker)

Run the same API with S3-compatible storage (MinIO) and PostgreSQL via `docker-compose up`:

```
docker-compose.yml
+-- api        (Node.js, port 3000)
+-- postgres   (PostgreSQL 16)
+-- minio      (S3-compatible storage)
```

Environment variables configure the S3 endpoint, credentials, database URL, and admin API key.

