---
title: Quick Start
description: Get started with Storage Brain
order: 1
icon: "🚀"
summary: Quick start guide for getting up and running with Storage Brain in minutes, covering SDK installation, API key setup, and first file upload.
category: documentation
tags: [storage-brain, quickstart, getting-started, sdk]
projects: [storage-brain]
status: active
---

# Quick Start

Get up and running with Storage Brain in minutes.

## Prerequisites

- An active Storage Brain tenant with an API key (`sk_live_...` or `sk_test_...`)
- Node.js 18+ (for SDK usage)

## Install the SDK

```bash
pnpm add @marlinjai/storage-brain-sdk
```

## Upload Your First File

```typescript
import { StorageBrain } from '@marlinjai/storage-brain-sdk';

const storage = new StorageBrain({
  apiKey: 'sk_live_your_api_key_here',
});

// Upload a file with progress tracking
const file = await storage.upload(myFile, {
  context: 'receipts',
  onProgress: (percent) => console.log(`${percent}%`),
});

console.log(file.id);  // UUID of the uploaded file
console.log(file.url); // Download URL for the file
```

## Key Concepts

### Authentication

All API requests require a Bearer token in the `Authorization` header:

```
Authorization: Bearer sk_live_...
```

API keys use the `sk_live_` prefix for production and `sk_test_` for testing environments. Keys are hashed with bcrypt before storage -- the plaintext key is only returned once at creation time.

### Context

Every uploaded file can optionally be assigned a `context` -- a free-form string (max 100 characters) for your own categorization. Use it however you like, for example `"invoices"`, `"profile-photos"`, or `"project-alpha-assets"`.

### Workspaces

Workspaces let you partition files within a tenant. Each workspace has its own optional quota and slug. Scope the SDK client to a workspace using `withWorkspace()`:

```typescript
const workspace = await storage.createWorkspace({
  name: 'Marketing',
  slug: 'marketing',
  quotaBytes: 100 * 1024 * 1024, // 100 MB
});

// All operations on this client are scoped to the workspace
const marketingStorage = storage.withWorkspace(workspace.id);

const file = await marketingStorage.upload(myFile, {
  context: 'campaign-assets',
});
```

### Supported File Types

**Images:** JPEG, PNG, WebP, GIF, AVIF

**Documents:** PDF

Maximum file size: 100 MB per file.

### Quota Management

Each tenant has a storage quota (default: 500 MB). Workspaces can have their own quotas. Uploads that would exceed either quota are rejected. Check your usage at any time:

```typescript
const quota = await storage.getQuota();
console.log(`${quota.usagePercent}% used`);
// { quotaBytes: 524288000, usedBytes: 10485760, availableBytes: 513802240, usagePercent: 2 }
```

### Signed Download URLs

Generate time-limited URLs that allow unauthenticated downloads -- useful for sharing files with external users or embedding in emails:

```typescript
const signed = await storage.getSignedUrl(file.id, 3600); // expires in 1 hour
console.log(signed.url); // Public URL, no auth required
```

### Webhooks

Optionally receive a notification when a file upload completes:

```typescript
const file = await storage.upload(myFile, {
  context: 'documents',
  webhookUrl: 'https://your-app.com/webhooks/storage-brain',
});
```

The webhook payload includes the full file object. The event type is `file.uploaded`. Failed deliveries are retried up to 3 times with exponential backoff.

## Next Steps

- [Architecture](/architecture) -- Understand the system design
- [API Reference](/api-reference) -- Explore all endpoints
- [SDK Guide](/sdk) -- Full SDK documentation
