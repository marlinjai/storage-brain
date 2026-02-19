---
title: SDK Guide
description: TypeScript SDK usage and reference
order: 4
icon: package
---

# SDK Guide

The Storage Brain TypeScript SDK provides a type-safe client for uploading files, managing storage, and querying file metadata.

## Installation

```bash
npm install @marlinjai/storage-brain-sdk
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
| `baseUrl` | string | `https://storage-brain-api.workers.dev` | API base URL |
| `timeout` | number | `30000` | Request timeout in milliseconds |
| `maxRetries` | number | `3` | Number of retry attempts for failed requests |

## Uploading Files

```typescript
const file = await storage.upload(myFile, {
  context: 'invoice',
  tags: { department: 'finance', year: '2026' },
  onProgress: (percent) => {
    console.log(`Upload progress: ${percent}%`);
  },
});

console.log(file.id);       // "a1b2c3d4-..."
console.log(file.url);      // Public URL
console.log(file.metadata); // { [key: string]: unknown }
```

The `upload` method handles the full upload flow:

1. Requests a presigned URL from the API (handshake)
2. Uploads the file content directly to R2
3. Returns the final file metadata

### Upload Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `context` | string | No | Optional free-form string for categorization (max 100 characters) |
| `tags` | `Record<string, string>` | No | Key-value pairs for categorization |
| `onProgress` | `(percent: number) => void` | No | Progress callback (0-100) |
| `webhookUrl` | string | No | URL to notify after upload completes |
| `signal` | `AbortSignal` | No | Signal for cancelling the upload |

### Cancelling an Upload

```typescript
const controller = new AbortController();

// Start upload
const uploadPromise = storage.upload(file, {
  context: 'my-app-receipts',
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

## Retrieving Files

### Get a Single File

```typescript
const file = await storage.getFile('a1b2c3d4-e5f6-7890-abcd-ef1234567890');

console.log(file.originalName); // "receipt.jpg"
console.log(file.sizeBytes);   // 245000
console.log(file.metadata);    // { [key: string]: unknown }
```

### List Files

```typescript
const result = await storage.listFiles({
  limit: 50,
  context: 'invoice',
  fileType: 'application/pdf',
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
  await storage.upload(file, { context: 'invoice' });
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
  AllowedMimeType,
  FileMetadata,
} from '@marlinjai/storage-brain-sdk';
```

## Constants

Useful constants are also exported:

```typescript
import {
  ALLOWED_MIME_TYPES,    // ['image/jpeg', 'image/png', ...]
} from '@marlinjai/storage-brain-sdk';
```
