---
title: Architecture
description: System architecture and design overview
order: 2
icon: layers
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
|   - Webhook dispatch  |
+-----------------------+
    |              |
    v              v
+--------+   +-----------+
|  R2    |   |    D1     |   Cloudflare Storage
| Bucket |   | Database  |
+--------+   +-----------+
    |
    v
  Webhook --> Your App
```

### Layer 1: Gatekeeper API

The API layer handles all client-facing requests. Built with [Hono](https://hono.dev/) on Cloudflare Workers, it provides:

- **Authentication** -- API key validation via hashed lookup in D1
- **Quota enforcement** -- Per-tenant storage limits checked before upload
- **Upload handshake** -- Returns presigned URLs for direct-to-R2 uploads
- **File management** -- CRUD operations on file records
- **Tenant management** -- Admin endpoints for tenant provisioning
- **Webhooks** -- Notification delivery to client-specified URLs after upload

### Layer 2: Storage

- **Cloudflare R2** -- Object storage for uploaded files. Files are organized by tenant: `tenants/{tenantId}/files/{fileId}/{fileName}`
- **Cloudflare D1** -- SQLite-based database at the edge for tenant records, file metadata, and upload sessions

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Cloudflare Workers |
| API Framework | Hono |
| Object Storage | Cloudflare R2 |
| Database | Cloudflare D1 (SQLite) |
| Validation | Zod |
| Language | TypeScript |

## Database Schema

Storage Brain uses three tables in Cloudflare D1:

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

### `files`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | UUID |
| `tenant_id` | TEXT (FK) | References `tenants.id` |
| `original_name` | TEXT | Original filename |
| `stored_path` | TEXT | R2 object key |
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
| `presigned_url` | TEXT | R2 presigned upload URL |
| `expires_at` | INTEGER | Expiration timestamp |
| `status` | TEXT | `pending`, `completed`, `expired`, or `failed` |
| `created_at` | INTEGER | Unix timestamp |

## Upload Flow

1. **Client** calls `POST /api/v1/upload/request` with file metadata
2. **API** validates auth, checks quota, creates file record and upload session
3. **API** returns a presigned URL (valid for 15 minutes)
4. **Client** uploads file directly to R2 using the presigned URL
5. **R2** triggers an event notification on upload completion
6. **API** receives the notification, marks the file as `completed`, and sends webhook if configured

## Deployment Architecture

### Current: Single Worker (MVP)

All functionality is deployed as a single Cloudflare Worker:

```
Single Cloudflare Worker
+-- API Routes (Hono)
|   +-- POST /api/v1/upload/request
|   +-- GET  /api/v1/files
|   +-- GET  /api/v1/files/:fileId
|   +-- DELETE /api/v1/files/:fileId
|   +-- GET  /api/v1/files/:fileId/download
|   +-- GET  /api/v1/tenant/quota
|   +-- GET  /api/v1/tenant/info
|   +-- POST /api/v1/admin/tenants
|   +-- POST /api/v1/admin/tenants/:tenantId/regenerate-key
+-- Bindings
    +-- D1 Database
    +-- R2 Bucket
```
