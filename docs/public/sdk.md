---
title: SDK Guide
description: TypeScript SDK usage and reference
order: 4
icon: "📦"
summary: Usage guide and reference for the Storage Brain TypeScript SDK, providing a type-safe client for uploading files, managing workspaces, and querying file metadata.
type: documentation
tags: [storage-brain, sdk, typescript, client]
projects: [storage-brain]
---

# SDK Guide

The Storage Brain TypeScript SDK provides a type-safe client for uploading files, managing workspaces, and querying file metadata.

## Installation

```bash
pnpm add @marlinjai/storage-brain-sdk
```

The SDK ships ESM and CommonJS builds with full TypeScript type definitions.

## Creating a Client

```typescript
import { StorageBrain } from '@marlinjai/storage-brain-sdk';

const storage = new StorageBrain({
  apiKey: 'sk_live_your_api_key_here',
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | (required) | Tenant API key (`sk_live_...` or `sk_test_...`) |
| `baseUrl` | string | Production URL | API base URL |
| `timeout` | number | `30000` | Request timeout in milliseconds |
| `maxRetries` | number | `3` | Number of retry attempts for failed requests |
| `workspaceId` | string | -- | Default workspace ID for all operations |

## Uploading Files

```typescript
const file = await storage.upload(myFile, {
  context: 'expense-receipts',
  tags: { department: 'finance', year: '2026' },
  onProgress: (percent) => {
    console.log(`Upload progress: ${percent}%`);
  },
});

console.log(file.id);       // "a1b2c3d4-..."
console.log(file.url);      // Download URL
console.log(file.metadata); // { [key: string]: unknown } | null
```

The `upload` method handles the full upload flow:

1. Requests a presigned URL from the API (handshake)
2. Uploads the file content directly to storage
3. Returns the final file metadata

### Upload Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `context` | string | No | Optional free-form string for categorization (max 100 characters) |
| `tags` | `Record<string, string>` | No | Key-value pairs for categorization |
| `onProgress` | `(percent: number) => void` | No | Progress callback (0-100) |
| `webhookUrl` | string | No | URL to notify after upload completes |
| `signal` | `AbortSignal` | No | Signal for cancelling the upload |
| `workspaceId` | string | No | Workspace to upload into (overrides client default) |

### Cancelling an Upload

```typescript
const controller = new AbortController();

// Start upload
const uploadPromise = storage.upload(file, {
  context: 'documents',
  signal: controller.signal,
});

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
  const result = await uploadPromise;
} catch (error) {
  if (error instanceof UploadError) {
    console.log('Upload cancelled');
  }
}
```

## Workspace Management

Workspaces partition files within a tenant. Each workspace has a name, slug, and optional quota.

### Create a Workspace

```typescript
const workspace = await storage.createWorkspace({
  name: 'Marketing',
  slug: 'marketing',
  quotaBytes: 100 * 1024 * 1024, // 100 MB
  metadata: { team: 'growth' },
});

console.log(workspace.id);   // "ws-uuid-..."
console.log(workspace.slug); // "marketing"
```

### List Workspaces

```typescript
const workspaces = await storage.listWorkspaces();
// Workspace[]
```

### Get a Workspace

```typescript
const workspace = await storage.getWorkspace('ws-uuid-...');
```

### Update a Workspace

```typescript
const updated = await storage.updateWorkspace('ws-uuid-...', {
  name: 'Marketing Team',
  quotaBytes: 200 * 1024 * 1024,
});
```

### Delete a Workspace

Deleting a workspace soft-deletes all files within it and releases quota.

```typescript
await storage.deleteWorkspace('ws-uuid-...');
```

### Scoping a Client to a Workspace

Use `withWorkspace()` to create a new client instance that automatically scopes all uploads and file listings to a specific workspace. The workspace ID is sent as an `X-Workspace-Id` header on every request.

```typescript
const marketingStorage = storage.withWorkspace(workspace.id);

// Upload goes into the marketing workspace
const file = await marketingStorage.upload(myFile, {
  context: 'campaign-assets',
});

// List only returns files in the marketing workspace
const result = await marketingStorage.listFiles();
```

You can also pass `workspaceId` per-call to override the client default:

```typescript
const file = await storage.upload(myFile, {
  workspaceId: 'specific-workspace-id',
});
```

## Retrieving Files

### Get a Single File

```typescript
const file = await storage.getFile('a1b2c3d4-e5f6-7890-abcd-ef1234567890');

console.log(file.originalName);  // "receipt.jpg"
console.log(file.sizeBytes);     // 245000
console.log(file.workspaceId);   // "ws-uuid" or null
console.log(file.metadata);      // { [key: string]: unknown } | null
```

### List Files

```typescript
const result = await storage.listFiles({
  limit: 50,
  context: 'expense-receipts',
  fileType: 'application/pdf',
  workspaceId: 'ws-uuid-...',
});

console.log(result.files);      // FileInfo[]
console.log(result.total);      // Total matching files
console.log(result.nextCursor); // Pagination cursor or null
```

#### Pagination

```typescript
let cursor: string | undefined;

do {
  const result = await storage.listFiles({ limit: 100, cursor });

  for (const file of result.files) {
    console.log(file.originalName);
  }

  cursor = result.nextCursor ?? undefined;
} while (cursor);
```

### List Files Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | number | 20 | Results per page (1-100) |
| `cursor` | string | -- | Pagination cursor from previous response |
| `context` | string | -- | Filter by context string |
| `fileType` | string | -- | Filter by MIME type |
| `workspaceId` | string | -- | Filter by workspace |

## Signed Download URLs

Generate time-limited URLs for unauthenticated file downloads. Useful for sharing files externally or embedding in emails.

```typescript
const signed = await storage.getSignedUrl('file-uuid', 3600); // 1 hour

console.log(signed.url);       // Full URL with HMAC token
console.log(signed.expiresAt); // ISO 8601 expiration
console.log(signed.expiresIn); // Seconds until expiry
```

The `expiresIn` parameter defaults to 3600 seconds (1 hour) and accepts values from 60 to 86400 seconds.

## Permanent Download URLs

For consumers that need a link that survives indefinitely (e.g. Trello card attachments, review backlogs, emails), use `getPermanentUrl`. The returned URL never expires on its own; revoke every existing permanent URL at once by rotating the `URL_SIGNING_SECRET` server-side.

```typescript
const permanent = await storage.getPermanentUrl('file-uuid');

console.log(permanent.url);    // Full URL with HMAC token
console.log(permanent.fileId); // 'file-uuid'
```

## Deleting Files

```typescript
await storage.deleteFile('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
```

This performs a soft delete. The file metadata is marked as deleted but not immediately removed from storage.

## Tenant Information

### Check Quota

```typescript
const quota = await storage.getQuota();

console.log(quota.quotaBytes);     // 524288000 (500 MB)
console.log(quota.usedBytes);      // 10485760
console.log(quota.availableBytes); // 513802240
console.log(quota.usagePercent);   // 2
```

### Get Tenant Info

```typescript
const tenant = await storage.getTenantInfo();

console.log(tenant.id);               // "tenant-uuid"
console.log(tenant.name);             // "My App"
console.log(tenant.allowedFileTypes); // ["image/jpeg", "image/png", ...]
```

## Error Handling

The SDK provides specific error classes for different failure scenarios:

```typescript
import {
  StorageBrain,
  StorageBrainError,
  AuthenticationError,
  QuotaExceededError,
  InvalidFileTypeError,
  FileTooLargeError,
  FileNotFoundError,
  NetworkError,
  UploadError,
  ValidationError,
} from '@marlinjai/storage-brain-sdk';

try {
  await storage.upload(file, { context: 'documents' });
} catch (error) {
  if (error instanceof AuthenticationError) {
    // Invalid or expired API key (HTTP 401)
  } else if (error instanceof QuotaExceededError) {
    // Storage quota exceeded (HTTP 403)
    console.log(error.quotaBytes, error.usedBytes);
  } else if (error instanceof InvalidFileTypeError) {
    // File type not allowed (HTTP 400)
  } else if (error instanceof FileTooLargeError) {
    // File exceeds 100 MB limit (HTTP 400)
  } else if (error instanceof FileNotFoundError) {
    // File does not exist (HTTP 404)
  } else if (error instanceof NetworkError) {
    // Connection failure or timeout
  } else if (error instanceof UploadError) {
    // Upload failed or was cancelled
  } else if (error instanceof ValidationError) {
    // Request validation failed (HTTP 400)
    console.log(error.errors); // [{ path: "fileName", message: "..." }]
  }
}
```

All error classes extend `StorageBrainError`, which has the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `message` | string | Human-readable error message |
| `code` | string | Machine-readable error code |
| `statusCode` | number or undefined | HTTP status code (if from API) |
| `details` | object or undefined | Additional error context |

### Retry Behavior

The SDK automatically retries requests that fail with server errors (5xx) or network issues. Client errors (4xx) are not retried.

Retry configuration:
- **Max attempts:** 3 (configurable via `maxRetries`)
- **Backoff:** Exponential (1s, 2s, 4s, capped at 10s)

## TypeScript Types

The SDK exports all types for use in your application:

```typescript
import type {
  StorageBrainConfig,
  UploadOptions,
  FileInfo,
  ListFilesOptions,
  ListFilesResult,
  QuotaInfo,
  TenantInfo,
  UploadHandshake,
  SignedUrlInfo,
  Workspace,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  AllowedMimeType,
  FileMetadata,
} from '@marlinjai/storage-brain-sdk';
```

## Admin SDK

The SDK ships a separate admin client for tenant management, available via the `/admin` export path.

```typescript
import { StorageBrainAdmin } from '@marlinjai/storage-brain-sdk/admin';

const admin = new StorageBrainAdmin({
  adminApiKey: 'your-admin-api-key',
  // baseUrl: 'http://localhost:3000', // for self-hosted
});
```

### Admin Methods

| Method | Description |
|--------|-------------|
| `createTenant(input)` | Create a new tenant (returns API key once) |
| `listTenants(options?)` | List all tenants with pagination |
| `getTenant(tenantId)` | Get tenant details including quota usage |
| `updateTenant(tenantId, updates)` | Update tenant name, quota, or allowed file types |
| `deleteTenant(tenantId)` | Delete a tenant and all associated data |
| `regenerateKey(tenantId)` | Regenerate a tenant's API key (invalidates the old one) |

### Example: Create and Manage a Tenant

```typescript
// Create a tenant
const result = await admin.createTenant({
  name: 'My App',
  quotaBytes: 1024 * 1024 * 1024, // 1 GB
  allowedFileTypes: ['image/jpeg', 'image/png', 'application/pdf'],
});
console.log(result.apiKey); // Store this securely — only returned once

// List tenants
const { tenants, total } = await admin.listTenants({ limit: 50 });

// Get tenant details
const tenant = await admin.getTenant(result.id);
console.log(tenant.quota.usagePercent);

// Update tenant
await admin.updateTenant(result.id, { name: 'Renamed App' });

// Regenerate API key
const { apiKey } = await admin.regenerateKey(result.id);

// Delete tenant
await admin.deleteTenant(result.id);
```

### Admin Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `adminApiKey` | string | (required) | Admin API key (`ADMIN_API_KEY` env var value) |
| `baseUrl` | string | Production URL | API base URL |
| `timeout` | number | `30000` | Request timeout in milliseconds |
| `maxRetries` | number | `3` | Number of retry attempts for failed requests |

## Constants

Useful constants are also exported:

```typescript
import {
  ALLOWED_FILE_TYPES,    // Record mapping MIME types to { category, extensions }
  ALLOWED_MIME_TYPES,    // ['image/jpeg', 'image/png', ...] (derived from ALLOWED_FILE_TYPES)
  IMAGE_MIME_TYPES,      // MIME types where category is 'image'
  DOCUMENT_MIME_TYPES,   // MIME types where category is 'document'
  MAX_FILE_SIZE_BYTES,   // 104857600 (100 MB)
  PROCESSING_STATUSES,   // ['pending', 'completed', 'failed']
} from '@marlinjai/storage-brain-sdk';
```

### Exported Types

The following utility types are also available:

```typescript
import type {
  AllowedMimeType,   // Union of all supported MIME type strings
  ProcessingStatus,  // 'pending' | 'completed' | 'failed'
} from '@marlinjai/storage-brain-sdk';
```
