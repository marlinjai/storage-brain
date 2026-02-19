# @marlinjai/storage-brain-sdk

TypeScript SDK for **Storage Brain** - an edge-native file storage service built on Cloudflare Workers, R2, and D1.

## Features

- **Simple API** - Upload, download, list, and delete files with ease
- **Progress tracking** - Real-time upload progress callbacks
- **Type-safe** - Full TypeScript support with comprehensive types
- **Automatic retries** - Built-in retry logic with exponential backoff
- **Flexible context** - Optional free-form context labels for organizing files
- **Zero dependencies** - Uses only native browser/Node.js APIs

## Installation

```bash
npm install @marlinjai/storage-brain-sdk
```

## Quick Start

```typescript
import { StorageBrain } from '@marlinjai/storage-brain-sdk';

// Initialize the client
const storage = new StorageBrain({
  apiKey: 'sk_live_your_api_key_here',
});

// Upload a file
const file = await storage.upload(fileBlob, {
  context: 'my-app',  // Optional free-form context label
  onProgress: (progress) => console.log(`${progress}%`),
});

console.log('File uploaded:', file.url);
```

## API Reference

### Constructor

```typescript
const storage = new StorageBrain({
  apiKey: string;        // Required: Your API key
  baseUrl?: string;      // Optional: API base URL
  timeout?: number;      // Optional: Request timeout in ms (default: 30000)
  maxRetries?: number;   // Optional: Max retry attempts (default: 3)
});
```

### Methods

#### `upload(file, options)`

Upload a file to Storage Brain.

```typescript
const result = await storage.upload(file, {
  context: 'my-app',                // Optional free-form context label
  tags: { orderId: '123' },         // Optional metadata tags
  onProgress: (p) => {},            // Progress callback (0-100)
  webhookUrl: 'https://...',        // Optional webhook for notifications
  signal: abortController.signal    // Optional abort signal
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
  limit: 20,              // Max results (default: 20)
  cursor: 'abc...',       // Pagination cursor
  context: 'my-app',     // Filter by context (free-form string)
  fileType: 'image/png',  // Filter by MIME type
});
```

#### `deleteFile(fileId)`

Soft delete a file.

```typescript
await storage.deleteFile('file-uuid');
```

#### `getQuota()`

Get storage quota information.

```typescript
const quota = await storage.getQuota();
console.log(`Used: ${quota.usedBytes} / ${quota.quotaBytes} bytes`);
console.log(`Usage: ${quota.usagePercent}%`);
```

#### `getTenantInfo()`

Get tenant information.

```typescript
const tenant = await storage.getTenantInfo();
console.log(`Tenant: ${tenant.name}`);
```

## Supported File Types

- **Images:** JPEG, PNG, WebP, GIF, AVIF
- **Documents:** PDF

## Error Handling

The SDK throws typed errors for different scenarios:

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

All types are exported for your convenience:

```typescript
import type {
  StorageBrainConfig,
  UploadOptions,
  FileInfo,
  ListFilesOptions,
  ListFilesResult,
  QuotaInfo,
  TenantInfo,
  FileMetadata,
  AllowedMimeType,
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
