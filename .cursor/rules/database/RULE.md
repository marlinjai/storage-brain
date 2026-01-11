---
description: "Database schema and migration standards for tenant and file metadata"
alwaysApply: false
globs:
  - "**/schema/**"
  - "**/migrations/**"
  - "**/prisma/**"
---

# Database Standards

## Schema Requirements

### Core Tables

1. **tenants**
   - `id`: UUID (primary key)
   - `name`: string
   - `quota_bytes`: integer (storage limit)
   - `used_bytes`: integer (current usage)
   - `created_at`: timestamp
   - `updated_at`: timestamp

2. **files**
   - `id`: UUID (primary key)
   - `tenant_id`: UUID (foreign key)
   - `original_name`: string
   - `stored_path`: string (R2 key)
   - `file_type`: string
   - `size_bytes`: integer
   - `context`: string
   - `tags`: JSON
   - `metadata`: JSON (processing results, OCR data, etc.)
   - `created_at`: timestamp
   - `updated_at`: timestamp

3. **upload_sessions**
   - `id`: UUID (primary key)
   - `file_id`: UUID (foreign key)
   - `presigned_url`: string
   - `expires_at`: timestamp
   - `status`: enum ('pending', 'completed', 'expired')
   - `created_at`: timestamp

## Migration Standards

- Use Prisma migrations or D1 migrations
- Version all migrations
- Include rollback scripts
- Test migrations on staging before production

## Query Patterns

- Always filter by `tenant_id` for isolation
- Use indexes on `tenant_id`, `file_id`, `created_at`
- Soft deletes preferred over hard deletes
- Batch operations for quota updates
