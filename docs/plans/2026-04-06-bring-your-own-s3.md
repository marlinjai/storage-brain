---
title: Bring Your Own S3 Bucket (Per-Tenant Storage)
type: plan
status: draft
summary: Allow tenants to configure their own S3/R2/GCS bucket instead of using the shared global storage, for data sovereignty and cost isolation.
tags: [storage, multi-tenancy, architecture]
date: 2026-04-06
---

# Bring Your Own S3 Bucket

## Problem

All tenants share a single R2 bucket with path-based isolation. This works for internal use but doesn't support:
- **Data sovereignty** — tenant needs files in a specific region/provider
- **Cost isolation** — tenant pays their own storage costs
- **Compliance** — tenant's data must stay in their infrastructure

## Current Architecture

```
All tenants → Single StorageAdapter (S3/R2) → One bucket
               Initialized once at startup (node.ts line 19)
               Path isolation: tenants/{id}/files/{fileId}/{name}
```

The `StorageAdapter` is a global singleton injected into Hono context at app startup.

## Proposed Design

### Tenant Storage Config

Add optional S3 config columns to tenants table:
```sql
ALTER TABLE tenants ADD COLUMN storage_config JSONB;
-- Schema: { provider, bucket, region, endpoint, accessKeyId, secretAccessKeyEncrypted }
```

Encrypted at rest using a server-side encryption key (`STORAGE_ENCRYPTION_KEY` env var). Secrets are decrypted only when creating the storage adapter.

### Dynamic Adapter Resolution

Replace the global singleton with a per-request adapter factory:

```
Request → Auth middleware resolves tenant
        → Storage middleware checks tenant.storageConfig
        → If custom config: create/cache S3 adapter for that tenant
        → If null: use default global adapter
        → Inject adapter into context
```

### Adapter Cache

LRU cache of `StorageAdapter` instances keyed by tenant ID. Prevents creating a new S3 client per request. Cache invalidation on tenant config change.

### Presigned URLs

Current "presigned URLs" are internal endpoints (`/_internal/upload/*`). For BYOS tenants, generate real S3 presigned URLs pointing directly to the tenant's bucket. This means:

1. Upload request → resolve tenant storage config → generate presigned PUT URL to tenant's bucket
2. Client uploads directly to tenant's S3 (no proxy)
3. Confirm upload → update metadata in Storage Brain DB

### Admin API

- `PATCH /admin/tenants/:id` — add/update `storageConfig`
- Validate credentials by attempting a HEAD request to the bucket
- Dashboard: add storage config form to tenant settings

### File Operations

| Operation | Default (shared bucket) | BYOS (tenant bucket) |
|-----------|------------------------|---------------------|
| Upload | Internal endpoint | Real S3 presigned PUT |
| Download | Proxy through API | Real S3 presigned GET |
| Delete | API calls S3 | API calls tenant's S3 |
| List | DB query (unchanged) | DB query (unchanged) |

Metadata always lives in Storage Brain's database. Only file bytes go to the tenant's bucket.

## Security Considerations

- **Credential encryption**: S3 secret keys encrypted at rest, decrypted only in memory
- **Credential validation**: Test bucket access on config save, reject invalid credentials
- **Isolation**: Tenant can only configure their own storage, not access the shared bucket directly
- **Audit**: Log all storage config changes

## Migration Path

Fully backward compatible. Tenants without `storageConfig` use the shared bucket (current behavior). No data migration needed.

## Effort Estimate

Large — touches storage adapter layer, auth middleware, upload flow, admin API, SDK, dashboard. Requires encryption key management. ~4-5 focused sessions.

## Dependencies

- Encryption key management (`STORAGE_ENCRYPTION_KEY` in Infisical)
- Real S3 presigned URL generation (currently using internal endpoints)
- The HMAC upload validation (item #3, now implemented) provides a good foundation for the internal endpoint path, but BYOS tenants bypass it entirely with real presigned URLs
