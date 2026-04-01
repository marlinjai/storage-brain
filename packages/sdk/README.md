---
title: Storage Brain SDK
summary: README for the Storage Brain TypeScript SDK providing file upload, download, listing, signed URLs, workspace management, progress tracking, and automatic retries with zero dependencies.
type: readme
tags: [storage-brain, sdk, typescript, file-storage, npm]
date: 2026-02-20
---

# @marlinjai/storage-brain-sdk

TypeScript SDK for **Storage Brain** — a multi-tenant file storage service. Works with the managed Cloudflare Workers deployment and self-hosted (Docker + S3 + Postgres) instances.

## Features

- **Simple API** — Upload, download, list, and delete files with ease
- **Workspaces** — Scope files to workspaces with per-workspace quotas
- **Signed URLs** — Time-limited public download links without API key
- **Progress tracking** — Real-time upload progress callbacks
- **Type-safe** — Full TypeScript support with comprehensive types
- **Automatic retries** — Built-in retry logic with exponential backoff
- **Zero dependencies** — Uses only native browser/Node.js APIs

## Installation

```bash
pnpm add @marlinjai/storage-brain-sdk
```

## Quick Start

```typescript
import { StorageBrain } from '@marlinjai/storage-brain-sdk';

const storage = new StorageBrain({
  apiKey: 'sk_live_your_api_key_here',
  // baseUrl: 'http://localhost:3000', // for self-hosted
});

// Upload a file
const file = await storage.upload(fileBlob, {
  context: 'my-app',
  onProgress: (progress) => console.log(`${progress}%`),
});

console.log('File uploaded:', file.url);
```

## API Reference

### Constructor

```typescript
const storage = new StorageBrain({
  apiKey: string;          // Required: Your API key (sk_live_* or sk_test_*)
  baseUrl?: string;        // Optional: API base URL (default: managed cloud)
  timeout?: number;        // Optional: Request timeout in ms (default: 30000)
  maxRetries?: number;     // Optional: Max retry attempts (default: 3)
  workspaceId?: string;    // Optional: Default workspace for all operations
});
```

### File Operations

#### `upload(file, options?)`

Upload a file to Storage Brain.

```typescript
const result = await storage.upload(file, {
  context: 'invoices',                // Optional context label
  tags: { orderId: '123' },           // Optional metadata tags
  onProgress: (p) => {},              // Progress callback (0-100)
  webhookUrl: 'https://...',          // Optional webhook notification
  workspaceId: 'ws-uuid',            // Optional workspace override
  signal: abortController.signal,     // Optional abort signal
});
```

#### `getFile(fileId)`

Get file information by ID.

```typescript
const file = await storage.getFile('file-uuid');
```

#### `listFiles(options?)`

List files with optional filtering and pagination.

```typescript
const { files, nextCursor, total } = await storage.listFiles({
  limit: 20,
  cursor: 'abc...',
  context: 'invoices',
  fileType: 'image/png',
  workspaceId: 'ws-uuid',
});
```

#### `deleteFile(fileId)`

Soft-delete a file.

```typescript
await storage.deleteFile('file-uuid');
```

#### `getSignedUrl(fileId, expiresIn?)`

Get a time-limited signed URL for unauthenticated file download.

```typescript
const { url, expiresAt } = await storage.getSignedUrl('file-uuid', 3600);
// url can be shared publicly — no API key needed to download
```

### Workspace Operations

#### `withWorkspace(workspaceId)`

Create a workspace-scoped client. All uploads and listings default to this workspace.

```typescript
const wsStorage = storage.withWorkspace('ws-uuid');
await wsStorage.upload(fileBlob, { context: 'campaign-images' });
const { files } = await wsStorage.listFiles();
```

#### `createWorkspace(input)`

```typescript
const ws = await storage.createWorkspace({
  name: 'Marketing Assets',
  slug: 'marketing-assets',
  quotaBytes: 100 * 1024 * 1024,  // 100 MB
  metadata: { team: 'marketing' },
});
```

#### `listWorkspaces()`

```typescript
const workspaces = await storage.listWorkspaces();
```

#### `getWorkspace(workspaceId)`

```typescript
const ws = await storage.getWorkspace('ws-uuid');
```

#### `updateWorkspace(workspaceId, updates)`

```typescript
await storage.updateWorkspace('ws-uuid', {
  name: 'Rebranded Assets',
  quotaBytes: 200 * 1024 * 1024,
});
```

#### `deleteWorkspace(workspaceId)`

Deletes the workspace and soft-deletes all its files.

```typescript
await storage.deleteWorkspace('ws-uuid');
```

### Tenant Operations

#### `getQuota()`

```typescript
const quota = await storage.getQuota();
console.log(`Used: ${quota.usedBytes} / ${quota.quotaBytes} bytes`);
console.log(`Usage: ${quota.usagePercent}%`);
```

#### `getTenantInfo()`

```typescript
const tenant = await storage.getTenantInfo();
console.log(`Tenant: ${tenant.name}`);
```

## Self-Hosting

Storage Brain can be self-hosted with Docker (S3 + Postgres). Point the SDK at your instance:

```typescript
const storage = new StorageBrain({
  apiKey: 'sk_live_...',
  baseUrl: 'http://localhost:3000',
});
```

See the [self-hosting docs](https://github.com/marlinjai/storage-brain/blob/main/docs/self-hosting.md) for setup instructions.

## Supported File Types

- **Images:** JPEG, PNG, WebP, GIF, AVIF
- **Documents:** PDF

## Error Handling

```typescript
import {
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
  await storage.upload(file, { context: 'my-app' });
} catch (error) {
  if (error instanceof QuotaExceededError) {
    console.error('Storage quota exceeded');
  } else if (error instanceof InvalidFileTypeError) {
    console.error('File type not allowed');
  } else if (error instanceof AuthenticationError) {
    console.error('Invalid API key');
  }
}
```

## TypeScript Types

```typescript
import type {
  StorageBrainConfig,
  UploadOptions,
  FileInfo,
  ListFilesOptions,
  ListFilesResult,
  QuotaInfo,
  TenantInfo,
  SignedUrlInfo,
  FileMetadata,
  Workspace,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  AllowedMimeType,
  ProcessingStatus,
} from '@marlinjai/storage-brain-sdk';
```

## Constants

```typescript
import {
  ALLOWED_MIME_TYPES,     // ['image/jpeg', 'image/png', ...]
  PROCESSING_STATUSES,    // ['pending', 'processing', 'completed', 'failed']
  MAX_FILE_SIZE_BYTES,    // 100MB
} from '@marlinjai/storage-brain-sdk';
```

## License

MIT
