---
title: RFC
description: Full architecture specification for Storage Brain
order: 1
summary: Full architecture specification RFC for Storage Brain as an edge-native file storage micro-product, covering API design, tenant model, R2/D1 storage, and signed URL patterns.
category: internal
tags: [storage-brain, rfc, specification, architecture]
projects: [storage-brain]
status: superseded
---

# RFC: Storage Brain - Edge-Native File Storage Micro-Product

**Status**: Approved
**Author**: Architecture Team
**Date**: 2025-01-27
**Version**: 1.0.0

---

## Executive Summary

This RFC defines the architecture and implementation plan for a **Storage Brain** - an edge-native, TypeScript-based file storage service built on Cloudflare Workers, R2, and D1. The service is designed as both an internal foundation for a suite of products and a standalone micro-product (private "Upload-as-a-Service").

### Key Goals

1. **Edge-First Performance**: <20ms global response time
2. **Micro-Product Ready**: Exportable, reusable, pluggable architecture
3. **Type-Safe**: Full TypeScript with autocomplete support
4. **Multi-Tenant**: Secure tenant isolation and quota management
5. **Context-Aware Processing**: OCR, thumbnails, and extensible pipeline

---

## 1. Architecture Overview

### 1.1 Three-Layer Design

```
┌─────────────────────────────────────────────────────────┐
│                    Client Applications                    │
│  (Email Editor, Framer Clone, Future Products)           │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ TypeScript SDK
                     │
┌────────────────────▼────────────────────────────────────┐
│              C. Exportable Client SDK                      │
│  - Type-safe API client                                  │
│  - Full autocomplete support                             │
│  - Zero-configuration where possible                     │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ HTTP/REST
                     │
┌────────────────────▼────────────────────────────────────┐
│            A. Gatekeeper (Internal API)                   │
│  - Handshake endpoint (POST /request-upload)             │
│  - Tenant quota validation                               │
│  - Presigned URL generation                              │
│  - Business logic enforcement                            │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ R2 Upload
                     │
┌────────────────────▼────────────────────────────────────┐
│            B. Processor (Worker)                          │
│  - Post-upload webhooks                                  │
│  - Context-aware processing                              │
│  - OCR (Google Cloud Vision)                             │
│  - Thumbnail generation                                  │
│  - Metadata extraction                                   │
└─────────────────────────────────────────────────────────┘
```

### 1.2 Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Runtime** | Cloudflare Workers | Edge-native, <20ms global latency |
| **Framework** | Hono | Ultra-lightweight, faster than Express |
| **Language** | TypeScript | Type safety, autocomplete, pluggability |
| **Database** | D1 (Cloudflare SQL) | Serverless, edge-native, zero config |
| **Storage** | Cloudflare R2 | S3-compatible, edge-optimized |
| **Validation** | Zod | Runtime type safety, schema validation |
| **Processing** | Cloudflare Queues | Async job processing |

---

## 2. Core Components

### 2.1 Gatekeeper API (Layer A)

#### 2.1.1 Handshake Endpoint

**Endpoint**: `POST /request-upload`

**Purpose**: Secure upload initiation with business logic enforcement before file transfer.

**Request Schema** (Zod):
```typescript
{
  tenant_id: string;           // UUID
  file_type: string;            // MIME type (validated against whitelist)
  context: 'newsletter' | 'invoice' | 'framer-site' | 'default';
  file_size_bytes?: number;     // Optional pre-validation
  tags?: Record<string, string>; // Optional metadata
}
```

**Response Schema**:
```typescript
{
  file_id: string;             // UUID for tracking
  presigned_url: string;        // R2 presigned URL (expires in 15min)
  expires_at: string;           // ISO 8601 timestamp
  upload_metadata: {
    max_size_bytes: number;
    allowed_types: string[];
  }
}
```

**Business Logic**:
1. Validate `tenant_id` exists and is active
2. Check tenant quota (`used_bytes + file_size_bytes <= quota_bytes`)
3. Validate `file_type` against tenant's allowed types
4. Generate `file_id` (UUID)
5. Create presigned URL with R2 (15-minute expiration)
6. Store upload session in database
7. Return handshake response

**Error Responses**:
- `401 Unauthorized`: Invalid API key
- `403 Forbidden`: Quota exceeded
- `400 Bad Request`: Invalid file type or schema validation failure
- `404 Not Found`: Tenant not found

#### 2.1.2 Additional Endpoints

- `GET /files/:file_id` - Retrieve file metadata
- `GET /files` - List files for tenant (with pagination)
- `DELETE /files/:file_id` - Soft delete file
- `GET /tenant/quota` - Get tenant quota usage

### 2.2 Processor Worker (Layer B)

#### 2.2.1 Post-Upload Processing Flow

1. **Trigger**: R2 webhook fires after successful upload
2. **Validation**: Verify file exists in R2, fetch metadata
3. **Context Routing**: Determine processor based on `context` field
4. **Execution**: Run context-specific processor
5. **Storage**: Save results to `files.metadata` JSON column
6. **Notification**: Optional webhook to requesting service

#### 2.2.2 Context Processors

**`invoice` Context**:
- Trigger Google Cloud Vision OCR
- Extract text, line items, totals
- Store in `files.metadata.ocr_data`

**`framer-site` Context**:
- Generate thumbnail (400x400px, WebP format)
- Store thumbnail in R2 with `_thumb` suffix
- Store thumbnail URL in `files.metadata.thumbnail_url`

**`newsletter` Context**:
- Validate image format (WebP, JPEG, PNG)
- Extract EXIF metadata
- Store in `files.metadata.image_info`

**`default` Context**:
- Basic validation only
- Store file size and type

#### 2.2.3 Processing Queue

- Use Cloudflare Queues for async processing
- Idempotent operations (safe to retry)
- Dead letter queue for permanent failures
- Progress tracking in database

### 2.3 Exportable Client SDK (Layer C)

#### 2.3.1 SDK API Surface

```typescript
// Core Client Class
class MyStorageBrain {
  constructor(config: {
    apiKey: string;
    baseUrl?: string;  // Defaults to production
  });

  // Main upload method
  upload(
    file: File | Blob,
    options: {
      context: 'newsletter' | 'invoice' | 'framer-site' | 'default';
      tags?: Record<string, string>;
      onProgress?: (progress: number) => void;
    }
  ): Promise<FileInfo>;

  // Utility methods
  getFile(fileId: string): Promise<FileInfo>;
  listFiles(options?: ListOptions): Promise<FileInfo[]>;
  deleteFile(fileId: string): Promise<void>;
  getQuota(): Promise<QuotaInfo>;
}

// Type definitions
interface FileInfo {
  id: string;
  url: string;              // Public R2 URL
  originalName: string;
  fileType: string;
  sizeBytes: number;
  context: string;
  tags?: Record<string, string>;
  metadata?: {
    thumbnailUrl?: string;
    ocrData?: OCRResult;
    [key: string]: unknown;
  };
  createdAt: string;
}
```

#### 2.3.2 SDK Features

- **Zero Configuration**: Works with just API key
- **Full TypeScript**: Complete type definitions
- **Tree-Shakeable**: ESM and CJS builds
- **Error Handling**: Custom error classes with retry logic
- **Progress Tracking**: Optional upload progress callbacks

---

## 3. Database Schema

### 3.1 Core Tables

#### `tenants`
```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,              -- UUID
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,       -- Hashed API key
  quota_bytes INTEGER NOT NULL,      -- Storage limit in bytes
  used_bytes INTEGER NOT NULL DEFAULT 0,
  allowed_file_types TEXT,           -- JSON array of MIME types
  created_at INTEGER NOT NULL,       -- Unix timestamp
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_tenants_api_key ON tenants(api_key_hash);
```

#### `files`
```sql
CREATE TABLE files (
  id TEXT PRIMARY KEY,              -- UUID
  tenant_id TEXT NOT NULL,          -- Foreign key to tenants
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,         -- R2 key
  file_type TEXT NOT NULL,           -- MIME type
  size_bytes INTEGER NOT NULL,
  context TEXT NOT NULL,             -- 'newsletter', 'invoice', etc.
  tags TEXT,                         -- JSON object
  metadata TEXT,                     -- JSON object (processing results)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,                -- Soft delete timestamp
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_files_tenant_id ON files(tenant_id);
CREATE INDEX idx_files_created_at ON files(created_at);
CREATE INDEX idx_files_context ON files(context);
```

#### `upload_sessions`
```sql
CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,              -- UUID
  file_id TEXT NOT NULL,            -- Foreign key to files
  presigned_url TEXT NOT NULL,
  expires_at INTEGER NOT NULL,      -- Unix timestamp
  status TEXT NOT NULL,             -- 'pending', 'completed', 'expired'
  created_at INTEGER NOT NULL,
  FOREIGN KEY (file_id) REFERENCES files(id)
);

CREATE INDEX idx_upload_sessions_file_id ON upload_sessions(file_id);
CREATE INDEX idx_upload_sessions_expires_at ON upload_sessions(expires_at);
```

### 3.2 Migration Strategy

- Use D1 migrations (SQL files)
- Version all migrations (e.g., `001_initial_schema.sql`)
- Include rollback scripts
- Test on staging before production

---

## 4. Security & Multi-Tenancy

### 4.1 Authentication

- **API Keys**: Per-tenant API keys (secured via cryptographic hashing (via brain-core))
- **Key Format**: `sk_live_` or `sk_test_` prefix + random 32 chars
- **Storage**: Hashed in database, never returned in responses

### 4.2 Tenant Isolation

- **Database Level**: All queries filtered by `tenant_id`
- **R2 Level**: Tenant-specific prefixes in R2 keys (e.g., `tenant-{id}/files/{file_id}`)
- **API Level**: Tenant extracted from API key, enforced on all endpoints

### 4.3 Quota Enforcement

- **Hard Limits**: Reject uploads when quota exceeded
- **Real-Time Updates**: Update `used_bytes` atomically
- **Quota Checks**: Before presigned URL generation

### 4.4 Input Validation

- **Zod Schemas**: All inputs validated
- **File Type Whitelist**: Enforced per tenant
- **Size Limits**: Configurable per tenant
- **Sanitization**: All user inputs sanitized

---

## 5. Processing Pipeline

### 5.1 OCR Processing (Invoice Context)

**Service**: Google Cloud Vision API

**Flow**:
1. Download file from R2 to worker memory (if small) or use streaming
2. Call GCP Vision API with `DOCUMENT_TEXT_DETECTION`
3. Parse response, extract structured data
4. Store in `files.metadata.ocr_data`

**Error Handling**:
- Retry on transient failures (3 attempts)
- Log errors, mark file with `processing_error` status
- Don't block file availability if OCR fails

### 5.2 Thumbnail Generation (Framer-Site Context)

**Library**: Sharp (via WASM) or Cloudflare Images API

**Flow**:
1. Download image from R2
2. Resize to 400x400px (maintain aspect ratio)
3. Convert to WebP format
4. Upload thumbnail to R2: `{original_path}_thumb.webp`
5. Store URL in `files.metadata.thumbnail_url`

### 5.3 Queue Management

- **Cloudflare Queues**: For async processing
- **Retry Logic**: Exponential backoff (3 attempts)
- **Dead Letter Queue**: For permanent failures
- **Monitoring**: Track processing times and failures

---

## 6. Deployment Architecture

### 6.1 Cloudflare Workers Setup

**Single Worker** (MVP):
- All endpoints in one worker
- Route-based handlers
- Shared D1 database binding

**Future**: Split into separate workers if needed:
- `api-worker`: Handshake and file management
- `processor-worker`: Background processing

### 6.2 Environment Variables

```bash
# Required
R2_BUCKET_NAME=storage-brain-prod
R2_ACCOUNT_ID=your-account-id
D1_DATABASE_ID=your-database-id

# Optional
GOOGLE_CLOUD_VISION_API_KEY=your-key
WEBHOOK_SECRET=your-secret
ENVIRONMENT=production|staging|development
```

### 6.3 R2 Bucket Configuration

- **CORS**: Configured for presigned URL uploads
- **Lifecycle Rules**: Optional cleanup for old files
- **Public Access**: Disabled (presigned URLs only)

---

## 7. Client SDK Implementation

### 7.1 Package Structure

```
storage-client/
├── src/
│   ├── client.ts          # Main client class
│   ├── types.ts           # TypeScript definitions
│   ├── errors.ts          # Custom error classes
│   ├── utils.ts           # Helper functions
│   └── index.ts           # Public exports
├── dist/                  # Built outputs
│   ├── esm/              # ESM build
│   └── cjs/              # CommonJS build
├── package.json
├── tsconfig.json
└── README.md
```

### 7.2 Build Configuration

- **Bundler**: esbuild or tsup
- **Targets**: ESM and CommonJS
- **Tree-Shaking**: Enabled
- **Type Definitions**: Included in package

### 7.3 Usage Example

```typescript
import { MyStorageBrain } from '@your-org/storage-brain';

const storage = new MyStorageBrain({
  apiKey: 'sk_live_...',
  baseUrl: 'https://storage-api.yourdomain.com'
});

// Upload with progress
const fileInfo = await storage.upload(file, {
  context: 'newsletter',
  tags: { campaign: 'january_promo' },
  onProgress: (progress) => {
    console.log(`Upload: ${progress}%`);
  }
});

console.log(fileInfo.url); // Public R2 URL
```

---

## 8. Micro-Product Features (Future)

### 8.1 Widget Component

**React Component**:
```typescript
<StorageBrainWidget
  apiKey={apiKey}
  context="newsletter"
  onUploadComplete={(fileInfo) => {
    // Handle completion
  }}
/>
```

**Features**:
- Drag & drop UI
- Progress indicators
- Error handling
- Returns file URL to parent

### 8.2 Dashboard UI

**Features**:
- Tenant management
- Storage usage visualization
- File browser
- Quota management
- Analytics

### 8.3 Documentation

- OpenAPI/Swagger spec
- Integration guides
- Code examples
- SDK documentation

---

## 9. Implementation Phases

### Phase 1: Foundation & MVP
- [ ] Hono + Cloudflare Workers setup
- [ ] D1 database schema and migrations
- [ ] Handshake endpoint (`POST /request-upload`)
- [ ] R2 presigned URL generation
- [ ] Basic file upload flow
- [ ] Client SDK (TypeScript)
- [ ] API key authentication

### Phase 2: Gatekeeper API
- [ ] File metadata endpoints
- [ ] Quota enforcement (hard limits, per-tenant)
- [ ] Post-upload webhook system (optional, per-request)
- [ ] Error handling and retries
- [ ] Testing suite

### Phase 3: Processing Pipeline
- [ ] OCR integration (Google Cloud Vision) for `invoice` context
- [ ] Thumbnail generation (200x200, 400x400, 800x800 WebP) for `framer-site` context
- [ ] Queue-based async processing (Cloudflare Queues)
- [ ] Metadata storage
- [ ] Processing status tracking

### Phase 4: Client SDK
- [ ] SDK structure and build configuration
- [ ] Core client implementation (`MyStorageBrain` class)
- [ ] Progress tracking, error handling, retry logic
- [ ] NPM package + monorepo distribution

### Phase 5: Testing & Deployment
- [ ] Unit and integration tests
- [ ] Documentation (API, SDK, deployment guide)
- [ ] Production deployment (single worker, workers.dev)
- [ ] Monitoring (Cloudflare Analytics + structured logging)

---

## 10. Success Metrics

- **Performance**: <20ms API response time (p95)
- **Reliability**: 99.9% uptime
- **Throughput**: Handle 1000+ uploads/minute
- **Type Safety**: 100% TypeScript coverage
- **Documentation**: Complete API and SDK docs

---

## 11. Decisions Summary

All clarifying questions have been answered. See [Clarifying Questions](./clarifying-questions) for full details and [Decisions](./decisions) for rationale.

**Key Decisions**:
- **Database**: D1 (edge-native, free tier sufficient)
- **Authentication**: Simple API keys per tenant (secured via cryptographic hashing (via brain-core))
- **File Types**: Images (JPEG, PNG, WebP, GIF, AVIF) + PDFs
- **Quotas**: Hard limits, per-tenant configurable (default 500MB)
- **Thumbnails**: 3 sizes (200x200, 400x400, 800x800) in WebP format
- **Webhooks**: Optional, passed per upload request
- **Deployment**: Single worker on workers.dev (MVP)
- **Multi-tenancy**: Admin-created only (MVP)
- **SDK Distribution**: NPM package + monorepo
- **Monitoring**: Cloudflare Analytics + structured JSON logs

---

## 12. References

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Hono Framework](https://hono.dev/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Zod Validation](https://zod.dev/)

---

**Next Steps**: All decisions finalized. Ready to proceed with Phase 1 implementation.
