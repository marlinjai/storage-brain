---
title: API Reference
description: Complete REST API endpoint documentation
order: 3
icon: "💻"
summary: Complete REST API endpoint documentation for Storage Brain, covering file upload, download, signed URLs, workspace management, and admin tenant operations.
type: documentation
tags: [storage-brain, api-reference, rest, endpoints]
projects: [storage-brain]
---

# API Reference

Base URL: `https://your-storage-brain-instance.example.com`

All endpoints (except admin, health, and signed-URL downloads) require tenant authentication via Bearer token.

## Authentication

Include your API key in the `Authorization` header:

```
Authorization: Bearer sk_live_your_api_key_here
```

Admin endpoints use a separate admin API key.

## Error Format

All errors follow a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

Common error codes: `UNAUTHORIZED`, `QUOTA_EXCEEDED`, `INVALID_FILE_TYPE`, `FILE_TOO_LARGE`, `FILE_NOT_FOUND`, `VALIDATION_ERROR`.

---

## Upload

### Request Upload

Request a presigned URL for file upload.

```
POST /api/v1/upload/request
```

**Auth:** Tenant API key (Bearer token)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fileType` | string | Yes | MIME type. One of: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`, `application/pdf` |
| `fileName` | string | Yes | Original filename (1-255 chars, no special characters) |
| `fileSizeBytes` | number | No | File size in bytes (max: 104857600) |
| `context` | string | No | Optional free-form string for categorization (max 100 chars) |
| `tags` | object | No | Key-value string pairs for categorization |
| `webhookUrl` | string | No | URL to notify after upload completes |
| `workspaceId` | string (UUID) | No | Workspace to upload into |

**Example Request:**

```json
{
  "fileType": "image/jpeg",
  "fileName": "receipt-2026.jpg",
  "fileSizeBytes": 245000,
  "context": "expense-receipts",
  "tags": { "department": "finance" },
  "webhookUrl": "https://your-app.com/webhooks/file-uploaded",
  "workspaceId": "workspace-uuid-here"
}
```

**Example Response (200):**

```json
{
  "fileId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "presignedUrl": "/_internal/upload/tenants/tenant-id/files/file-id/receipt-2026.jpg",
  "expiresAt": "2026-02-28T12:15:00.000Z",
  "uploadMetadata": {
    "maxSizeBytes": 104857600,
    "allowedTypes": ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "application/pdf"]
  }
}
```

After receiving the response, upload the file via `PUT` to the `presignedUrl` with the file content as the request body and `Content-Type` set to the file's MIME type.

---

## Files

### List Files

List files for the authenticated tenant with pagination.

```
GET /api/v1/files
```

**Auth:** Tenant API key (Bearer token)

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Results per page (1-100) |
| `cursor` | string | -- | Pagination cursor from previous response |
| `context` | string | -- | Filter by context string |
| `fileType` | string | -- | Filter by MIME type |
| `workspaceId` | string | -- | Filter by workspace |

**Example Response (200):**

```json
{
  "files": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "url": "/api/v1/files/a1b2c3d4-e5f6-7890-abcd-ef1234567890/download",
      "originalName": "receipt-2026.jpg",
      "fileType": "image/jpeg",
      "sizeBytes": 245000,
      "context": "expense-receipts",
      "tags": { "department": "finance" },
      "metadata": null,
      "processingStatus": "completed",
      "workspaceId": "workspace-uuid-here",
      "createdAt": "2026-02-28T10:30:00.000Z"
    }
  ],
  "nextCursor": "eyJpZCI6Imxhc3QtaWQifQ==",
  "total": 42
}
```

### Get File

Retrieve metadata for a specific file.

```
GET /api/v1/files/:fileId
```

**Auth:** Tenant API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `fileId` | UUID | File identifier |

**Example Response (200):**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "url": "/api/v1/files/a1b2c3d4-e5f6-7890-abcd-ef1234567890/download",
  "originalName": "receipt-2026.jpg",
  "fileType": "image/jpeg",
  "sizeBytes": 245000,
  "context": "expense-receipts",
  "tags": { "department": "finance" },
  "metadata": null,
  "processingStatus": "completed",
  "workspaceId": null,
  "createdAt": "2026-02-28T10:30:00.000Z"
}
```

**Error Responses:**
- `404` -- File not found or belongs to another tenant

### Delete File

Soft-delete a file. The file record is marked as deleted but not immediately removed from storage.

```
DELETE /api/v1/files/:fileId
```

**Auth:** Tenant API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `fileId` | UUID | File identifier |

**Example Response (200):**

```json
{
  "success": true
}
```

**Error Responses:**
- `404` -- File not found or belongs to another tenant

### Download File

Download the raw file content from storage. Supports both authenticated and signed-URL access.

```
GET /api/v1/files/:fileId/download
```

**Auth:** Tenant API key (Bearer token) OR signed URL query parameters (`token` + `expires`)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `fileId` | UUID | File identifier |

**Response:** Binary file content with appropriate `Content-Type` and `Content-Disposition` headers.

**Error Responses:**
- `401` -- Missing or invalid authentication
- `404` -- File not found or not in storage

### Get Signed URL

Generate a time-limited signed URL for unauthenticated file download.

```
GET /api/v1/files/:fileId/signed-url
```

**Auth:** Tenant API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `fileId` | UUID | File identifier |

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `expiresIn` | number | 3600 | URL lifetime in seconds (60-86400) |

**Example Response (200):**

```json
{
  "fileId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "url": "https://your-instance.com/api/v1/files/a1b2c3d4-.../download?token=abc123&expires=1740750000000",
  "expiresAt": "2026-02-28T11:30:00.000Z",
  "expiresIn": 3600
}
```

The returned `url` can be shared publicly. It does not require an `Authorization` header and will expire after the specified duration.

**Error Responses:**
- `404` -- File not found or belongs to another tenant

### Get Permanent URL

Generate a permanent (non-expiring) URL for unauthenticated file download. Suitable for review backlogs, Trello attachments, or any consumer that needs a link that survives indefinitely.

```
GET /api/v1/files/:fileId/permanent-url
```

**Auth:** Tenant API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `fileId` | UUID | File identifier |

**Example Response (200):**

```json
{
  "fileId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "url": "https://your-instance.com/api/v1/files/a1b2c3d4-.../download?token=abc123&expires=0&tid=tenant-uuid"
}
```

The returned `url` never expires on its own. Revoke every existing permanent URL at once by rotating the `URL_SIGNING_SECRET` server-side.

**Error Responses:**
- `404` -- File not found or belongs to another tenant

---

## Workspaces

Workspaces partition files within a tenant. Each workspace has its own slug (unique per tenant) and optional quota.

### List Workspaces

```
GET /api/v1/workspaces
```

**Auth:** Tenant API key (Bearer token)

**Example Response (200):**

```json
{
  "workspaces": [
    {
      "id": "ws-uuid-1",
      "name": "Marketing",
      "slug": "marketing",
      "quotaBytes": 104857600,
      "usedBytes": 5242880,
      "metadata": null,
      "createdAt": 1740700000,
      "updatedAt": 1740700000
    }
  ]
}
```

### Create Workspace

```
POST /api/v1/workspaces
```

**Auth:** Tenant API key (Bearer token)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Workspace name (1-255 chars) |
| `slug` | string | Yes | URL-safe identifier (lowercase alphanumeric + hyphens) |
| `quotaBytes` | number | No | Optional storage quota in bytes |
| `metadata` | object | No | Arbitrary key-value metadata |

**Example Request:**

```json
{
  "name": "Marketing",
  "slug": "marketing",
  "quotaBytes": 104857600
}
```

**Example Response (201):**

```json
{
  "id": "ws-uuid-1",
  "name": "Marketing",
  "slug": "marketing",
  "quotaBytes": 104857600,
  "usedBytes": 0,
  "metadata": null,
  "createdAt": 1740700000,
  "updatedAt": 1740700000
}
```

### Get Workspace

```
GET /api/v1/workspaces/:workspaceId
```

**Auth:** Tenant API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `workspaceId` | UUID | Workspace identifier |

**Example Response (200):** Same shape as create response.

**Error Responses:**
- `404` -- Workspace not found or belongs to another tenant

### Update Workspace

```
PATCH /api/v1/workspaces/:workspaceId
```

**Auth:** Tenant API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `workspaceId` | UUID | Workspace identifier |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | New workspace name |
| `quotaBytes` | number or null | No | New quota (null to remove limit) |
| `metadata` | object | No | New metadata (replaces existing) |

**Example Response (200):** Updated workspace object.

**Error Responses:**
- `404` -- Workspace not found or belongs to another tenant

### Delete Workspace

Deletes the workspace and soft-deletes all files within it. Releases quota at both workspace and tenant levels.

```
DELETE /api/v1/workspaces/:workspaceId
```

**Auth:** Tenant API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `workspaceId` | UUID | Workspace identifier |

**Example Response (200):**

```json
{
  "success": true
}
```

**Error Responses:**
- `404` -- Workspace not found or belongs to another tenant

---

## Tenant

### Get Quota

Retrieve storage quota usage for the authenticated tenant.

```
GET /api/v1/tenant/quota
```

**Auth:** Tenant API key (Bearer token)

**Example Response (200):**

```json
{
  "quotaBytes": 524288000,
  "usedBytes": 10485760,
  "availableBytes": 513802240,
  "usagePercent": 2
}
```

### Get Tenant Info

Retrieve information about the authenticated tenant.

```
GET /api/v1/tenant/info
```

**Auth:** Tenant API key (Bearer token)

**Example Response (200):**

```json
{
  "id": "tenant-uuid-here",
  "name": "My App",
  "allowedFileTypes": ["image/jpeg", "image/png", "application/pdf"],
  "createdAt": "2026-01-15T08:00:00.000Z"
}
```

---

## Admin

Admin endpoints require the `ADMIN_API_KEY` environment variable to be configured. They use a separate API key from tenant keys.

### Create Tenant

Provision a new tenant with an API key.

```
POST /api/v1/admin/tenants
```

**Auth:** Admin API key (Bearer token)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Tenant name (1-100 chars, must be unique) |
| `quotaBytes` | number | No | Storage quota in bytes (default: 524288000 / 500 MB) |
| `allowedFileTypes` | string[] | No | Allowed MIME types (defaults to all supported types) |

**Example Request:**

```json
{
  "name": "My Application",
  "quotaBytes": 1073741824,
  "allowedFileTypes": ["image/jpeg", "image/png", "application/pdf"]
}
```

**Example Response (201):**

```json
{
  "id": "new-tenant-uuid",
  "name": "My Application",
  "apiKey": "sk_live_abc123def456...",
  "quotaBytes": 1073741824,
  "allowedFileTypes": ["image/jpeg", "image/png", "application/pdf"]
}
```

> **Important:** The `apiKey` field is only returned once at creation. Store it securely.

**Error Responses:**
- `409` -- Tenant with that name already exists

### List Tenants

List all tenants with pagination.

```
GET /api/v1/admin/tenants
```

**Auth:** Admin API key (Bearer token)

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Results per page |
| `cursor` | string | -- | Pagination cursor from previous response |

**Example Response (200):**

```json
{
  "tenants": [
    {
      "id": "tenant-uuid",
      "name": "My Application",
      "quotaBytes": 524288000,
      "usedBytes": 10485760,
      "allowedFileTypes": ["image/jpeg", "image/png", "application/pdf"],
      "createdAt": 1740700000,
      "updatedAt": 1740700000
    }
  ],
  "nextCursor": null,
  "total": 1
}
```

### Get Tenant

Retrieve details for a specific tenant, including quota usage.

```
GET /api/v1/admin/tenants/:tenantId
```

**Auth:** Admin API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tenantId` | UUID | Tenant identifier |

**Example Response (200):**

```json
{
  "id": "tenant-uuid",
  "name": "My Application",
  "quotaBytes": 524288000,
  "usedBytes": 10485760,
  "allowedFileTypes": ["image/jpeg", "image/png", "application/pdf"],
  "createdAt": 1740700000,
  "updatedAt": 1740700000,
  "quota": {
    "quotaBytes": 524288000,
    "usedBytes": 10485760,
    "availableBytes": 513802240,
    "usagePercent": 2
  }
}
```

**Error Responses:**
- `404` -- Tenant not found

### Update Tenant

Update tenant properties (name, quota, allowed file types).

```
PATCH /api/v1/admin/tenants/:tenantId
```

**Auth:** Admin API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tenantId` | UUID | Tenant identifier |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | New tenant name |
| `quotaBytes` | number | No | New storage quota in bytes |
| `allowedFileTypes` | string[] or null | No | New allowed MIME types |

**Example Response (200):**

```json
{
  "id": "tenant-uuid",
  "name": "Updated Name",
  "quotaBytes": 1073741824,
  "usedBytes": 10485760,
  "allowedFileTypes": ["image/jpeg", "image/png", "application/pdf"],
  "createdAt": 1740700000,
  "updatedAt": 1740800000
}
```

**Error Responses:**
- `404` -- Tenant not found
- `409` -- Tenant with that name already exists

### Delete Tenant

Delete a tenant and all associated data (files, workspaces, upload sessions). Files are removed from storage on a best-effort basis.

```
DELETE /api/v1/admin/tenants/:tenantId
```

**Auth:** Admin API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tenantId` | UUID | Tenant identifier |

**Example Response (200):**

```json
{
  "success": true
}
```

**Error Responses:**
- `404` -- Tenant not found

### Regenerate API Key

Generate a new API key for an existing tenant. The old key is immediately invalidated.

```
POST /api/v1/admin/tenants/:tenantId/regenerate-key
```

**Auth:** Admin API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tenantId` | UUID | Tenant identifier |

**Example Response (200):**

```json
{
  "tenantId": "tenant-uuid-here",
  "apiKey": "sk_live_newkey789xyz...",
  "message": "API key regenerated successfully. Store this key securely."
}
```

> **Important:** The `apiKey` field is only returned once. Store it securely.

**Error Responses:**
- `404` -- Tenant not found

---

## Health

### Health Check

```
GET /health
```

**Auth:** None

**Example Response (200):**

```json
{
  "status": "ok",
  "timestamp": "2026-02-28T10:30:00.000Z",
  "environment": "production"
}
```

---

## Webhooks

When a file has a `webhookUrl` set, Storage Brain sends a POST request to that URL after the upload completes.

**Webhook Payload:**

```json
{
  "event": "file.uploaded",
  "fileId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "tenantId": "tenant-uuid",
  "workspaceId": "workspace-uuid-or-null",
  "file": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "url": "/api/v1/files/a1b2c3d4-.../download",
    "originalName": "receipt-2026.jpg",
    "fileType": "image/jpeg",
    "sizeBytes": 245000,
    "context": "expense-receipts",
    "tags": { "department": "finance" },
    "metadata": null,
    "processingStatus": "completed",
    "workspaceId": "workspace-uuid-or-null",
    "createdAt": "2026-02-28T10:30:00.000Z"
  },
  "timestamp": "2026-02-28T10:30:05.000Z"
}
```

**Events:**
- `file.uploaded` -- Upload completed successfully
- `file.failed` -- Upload failed

**Retry policy:** Up to 3 attempts with exponential backoff (1s, 2s, 4s).
