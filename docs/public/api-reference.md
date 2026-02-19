---
title: API Reference
description: Complete REST API endpoint documentation
order: 3
icon: code
---

# API Reference

Base URL: `https://storage-brain-api.workers.dev`

All endpoints (except admin and health) require tenant authentication via Bearer token.

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
| `context` | string | Yes | Processing context: `newsletter`, `invoice`, `framer-site`, or `default` |
| `tags` | object | No | Key-value string pairs for categorization |
| `webhookUrl` | string | No | URL to notify after processing completes |

**Example Request:**

```json
{
  "fileType": "image/jpeg",
  "fileName": "receipt-2024.jpg",
  "fileSizeBytes": 245000,
  "context": "invoice",
  "tags": { "department": "finance" },
  "webhookUrl": "https://your-app.com/webhooks/file-processed"
}
```

**Example Response (200):**

```json
{
  "fileId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "presignedUrl": "/_internal/upload/tenants/tenant-id/files/file-id/receipt-2024.jpg",
  "expiresAt": "2026-02-19T12:15:00.000Z",
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
| `context` | string | -- | Filter by processing context |
| `fileType` | string | -- | Filter by MIME type |

**Example Response (200):**

```json
{
  "files": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "url": "https://r2-bucket.example.com/tenants/.../file.jpg",
      "originalName": "receipt-2024.jpg",
      "fileType": "image/jpeg",
      "sizeBytes": 245000,
      "context": "invoice",
      "tags": { "department": "finance" },
      "metadata": {
        "ocrData": {
          "fullText": "Invoice #1234...",
          "confidence": 0.95,
          "blocks": []
        }
      },
      "processingStatus": "completed",
      "createdAt": "2026-02-19T10:30:00.000Z"
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
  "url": "https://r2-bucket.example.com/tenants/.../file.jpg",
  "originalName": "receipt-2024.jpg",
  "fileType": "image/jpeg",
  "sizeBytes": 245000,
  "context": "invoice",
  "tags": { "department": "finance" },
  "metadata": null,
  "processingStatus": "pending",
  "createdAt": "2026-02-19T10:30:00.000Z"
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

Download the raw file content from R2 storage.

```
GET /api/v1/files/:fileId/download
```

**Auth:** Tenant API key (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `fileId` | UUID | File identifier |

**Response:** Binary file content with appropriate `Content-Type` and `Content-Disposition` headers.

**Error Responses:**
- `404` -- File not found or not in storage

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
  "status": "ok"
}
```

---

## Webhooks

When a file has a `webhookUrl` set, Storage Brain sends a POST request to that URL after processing completes or fails.

**Webhook Payload:**

```json
{
  "event": "file.processed",
  "fileId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "tenantId": "tenant-uuid",
  "file": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "url": "https://r2-bucket.example.com/tenants/.../file.jpg",
    "originalName": "receipt-2024.jpg",
    "fileType": "image/jpeg",
    "sizeBytes": 245000,
    "context": "invoice",
    "tags": { "department": "finance" },
    "metadata": { "ocrData": { "fullText": "...", "confidence": 0.95, "blocks": [] } },
    "processingStatus": "completed",
    "createdAt": "2026-02-19T10:30:00.000Z"
  },
  "timestamp": "2026-02-19T10:30:45.000Z"
}
```

**Events:**
- `file.processed` -- Processing completed successfully
- `file.failed` -- Processing failed

**Retry policy:** Up to 3 attempts with exponential backoff (1s, 2s, 4s).
