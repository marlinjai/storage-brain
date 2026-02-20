---
title: Quick Start
description: Get started with Storage Brain
order: 1
icon: rocket
---

# Quick Start

Get up and running with Storage Brain in minutes.

## Prerequisites

- An active Storage Brain tenant with an API key (`sk_live_...` or `sk_test_...`)
- Node.js 18+ (for SDK usage)

## Install the SDK

```bash
npm install @marlinjai/storage-brain-sdk
```

## Upload Your First File

```typescript
import { StorageBrain } from '@marlinjai/storage-brain-sdk';

const storage = new StorageBrain({
  apiKey: 'sk_live_your_api_key_here',
});

// Upload a file with progress tracking
const file = await storage.upload(myFile, {
  context: 'default',
  onProgress: (percent) => console.log(`${percent}%`),
});

console.log(file.id);  // UUID of the uploaded file
console.log(file.url);  // Public URL to access the file
```

## Key Concepts

### Authentication

All API requests require a Bearer token in the `Authorization` header:

```
Authorization: Bearer sk_live_...
```

API keys use the `sk_live_` prefix for production and `sk_test_` for testing environments. Keys are hashed with bcrypt before storage -- the plaintext key is only returned once at creation time.

### Processing Contexts

Every uploaded file is assigned a processing context that determines how it gets processed:

| Context | Processing |
|---------|-----------|
| `invoice` | OCR text extraction, structured data parsing |
| `newsletter` | Image optimization, thumbnail generation |
| `framer-site` | Image optimization, thumbnail generation |
| `default` | Basic metadata extraction |

### Supported File Types

**Images:** JPEG, PNG, WebP, GIF, AVIF

**Documents:** PDF

Maximum file size: 100 MB per file.

### Quota Management

Each tenant has a storage quota (default: 500 MB). Uploads that would exceed the quota are rejected. Check your usage at any time:

```typescript
const quota = await storage.getQuota();
console.log(`${quota.usagePercent}% used`);
// { quotaBytes: 524288000, usedBytes: 10485760, availableBytes: 513802240, usagePercent: 2 }
```

### Thumbnails

Images are automatically processed into three thumbnail sizes in WebP format:

| Size | Dimensions |
|------|-----------|
| `thumb` | 200 x 200 px |
| `medium` | 400 x 400 px |
| `large` | 800 x 800 px |

### Webhooks

Optionally receive a notification when file processing completes:

```typescript
const file = await storage.upload(myFile, {
  context: 'invoice',
  webhookUrl: 'https://your-app.com/webhooks/storage-brain',
});
```

The webhook payload includes the full file object with processing results. Failed deliveries are retried up to 3 times with exponential backoff.

## Next Steps

- [Architecture](/architecture) -- Understand the system design
- [API Reference](/api-reference) -- Explore all endpoints
- [SDK Guide](/sdk) -- Full SDK documentation
