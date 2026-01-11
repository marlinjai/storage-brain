---
name: Storage Brain Implementation Plan
overview: "Update all documentation with final decisions, then systematically implement the Storage Brain micro-product in 5 phases: Foundation Setup, Gatekeeper API, Client SDK, Processing Pipeline, and Testing & Polish."
todos: []
---

# Storage Brain - Complete Implementation Plan

## Phase 0: Documentation Updates

Update all documentation files to reflect final decisions:

### Files to Update:

1. **[docs/RFC.md](docs/RFC.md)** - Update database section to specify D1, authentication to API keys, file types to images+PDFs, deployment to single worker
2. **[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)** - Already aligned, verify all steps match decisions
3. **[README.md](README.md)** - Update with final tech stack and quick start

All decisions are already documented in [docs/DECISIONS.md](docs/DECISIONS.md) and [docs/CLARIFYING_QUESTIONS.md](docs/CLARIFYING_QUESTIONS.md).

---

## Phase 1: Foundation Setup

### 1.1 Project Structure & Configuration

**Create monorepo structure:**

```
UploadNode/
├── packages/
│   ├── api/              # Cloudflare Workers API
│   ├── client-sdk/       # TypeScript SDK
│   └── shared/          # Shared types & utilities
├── docs/                 # Documentation (existing)
└── .cursor/rules/        # Cursor rules (existing)
```

**Files to create:**

- [package.json](package.json) - Root workspace configuration
- [tsconfig.json](tsconfig.json) - Root TypeScript config with path aliases
- [.gitignore](.gitignore) - Node modules, build outputs, env files
- [.eslintrc.json](.eslintrc.json) - ESLint configuration
- [.prettierrc](.prettierrc) - Prettier configuration

**Dependencies:**

- Root: `workspaces` support, TypeScript, ESLint, Prettier
- Shared: Zod for validation schemas
- API: Hono, Wrangler, D1 types
- Client SDK: Build tools (esbuild/tsup)

### 1.2 Cloudflare Workers Setup

**Files to create:**

- [packages/api/wrangler.toml](packages/api/wrangler.toml) - Workers configuration
- [packages/api/package.json](packages/api/package.json) - API dependencies
- [packages/api/src/index.ts](packages/api/src/index.ts) - Worker entry point with Hono

**Configuration:**

- D1 database binding
- R2 bucket binding
- Environment variables (API keys, secrets)
- Queue binding for processing

### 1.3 Database Schema & Migrations

**Files to create:**

- [packages/api/migrations/001_initial_schema.sql](packages/api/migrations/001_initial_schema.sql) - D1 schema
- [packages/api/src/db/schema.ts](packages/api/src/db/schema.ts) - TypeScript types matching schema
- [packages/api/src/db/client.ts](packages/api/src/db/client.ts) - D1 connection utility

**Schema includes:**

- `tenants` table (id, name, api_key_hash, quota_bytes, used_bytes, allowed_file_types)
- `files` table (id, tenant_id, original_name, stored_path, file_type, size_bytes, context, tags, metadata)
- `upload_sessions` table (id, file_id, presigned_url, expires_at, status)
- Indexes on tenant_id, file_id, created_at

### 1.4 Shared Types & Validation

**Files to create:**

- [packages/shared/src/types.ts](packages/shared/src/types.ts) - TypeScript interfaces
- [packages/shared/src/schemas.ts](packages/shared/src/schemas.ts) - Zod validation schemas
- [packages/shared/src/constants.ts](packages/shared/src/constants.ts) - File type whitelist, default quotas

**Types include:**

- Tenant, File, UploadSession interfaces
- Request/Response types for all endpoints
- Processing context types (newsletter, invoice, framer-site, default)

**Schemas include:**

- Upload request validation (tenant_id, file_type, context, tags)
- File type whitelist validation (images + PDFs)
- API key format validation

---

## Phase 2: Gatekeeper API

### 2.1 Authentication Middleware

**Files to create:**

- [packages/api/src/middleware/auth.ts](packages/api/src/middleware/auth.ts) - API key authentication
- [packages/api/src/utils/crypto.ts](packages/api/src/utils/crypto.ts) - API key hashing (bcrypt)

**Implementation:**

- Extract API key from `Authorization: Bearer {key}` header
- Validate format (`sk_live_` or `sk_test_` prefix)
- Hash comparison with database
- Attach tenant context to request
- Error handling: 401 for invalid keys

### 2.2 Handshake Endpoint

**Files to create:**

- [packages/api/src/routes/upload.ts](packages/api/src/routes/upload.ts) - Upload endpoints
- [packages/api/src/services/quota.ts](packages/api/src/services/quota.ts) - Quota validation service
- [packages/api/src/services/r2.ts](packages/api/src/services/r2.ts) - R2 presigned URL generation

**POST /request-upload endpoint:**

1. Validate request schema (Zod)
2. Authenticate tenant (middleware)
3. Validate file type against whitelist
4. Check tenant quota (atomic check)
5. Generate file_id (UUID)
6. Create presigned URL (15-minute expiration)
7. Store upload session in database
8. Return handshake response

**Error responses:**

- 400: Invalid schema or file type
- 401: Invalid API key
- 403: Quota exceeded
- 404: Tenant not found

### 2.3 File Management Endpoints

**Files to create:**

- [packages/api/src/routes/files.ts](packages/api/src/routes/files.ts) - File CRUD endpoints

**Endpoints:**

- `GET /files/:file_id` - Get file metadata (tenant-isolated)
- `GET /files` - List files with pagination (tenant-isolated)
- `DELETE /files/:file_id` - Soft delete file (update deleted_at)

**Features:**

- Tenant isolation on all queries
- Pagination (cursor-based)
- Filtering by context, file_type
- Soft deletes (preserve data, mark deleted_at)

### 2.4 Quota Management

**Files to update:**

- [packages/api/src/services/quota.ts](packages/api/src/services/quota.ts) - Quota service

**Features:**

- Atomic quota check (prevent race conditions)
- Atomic quota update (increment used_bytes)
- Quota calculation (used_bytes + file_size_bytes <= quota_bytes)
- `GET /tenant/quota` endpoint - Return quota usage

---

## Phase 3: Client SDK

### 3.1 SDK Structure

**Files to create:**

- [packages/client-sdk/package.json](packages/client-sdk/package.json) - SDK dependencies
- [packages/client-sdk/tsconfig.json](packages/client-sdk/tsconfig.json) - TypeScript config
- [packages/client-sdk/src/index.ts](packages/client-sdk/src/index.ts) - Public exports

### 3.2 Core Client Implementation

**Files to create:**

- [packages/client-sdk/src/client.ts](packages/client-sdk/src/client.ts) - MyStorageBrain class
- [packages/client-sdk/src/types.ts](packages/client-sdk/src/types.ts) - SDK type definitions
- [packages/client-sdk/src/errors.ts](packages/client-sdk/src/errors.ts) - Custom error classes
- [packages/client-sdk/src/utils.ts](packages/client-sdk/src/utils.ts) - Helper functions

**MyStorageBrain class methods:**

- `constructor(config)` - Initialize with API key and base URL
- `upload(file, options)` - Main upload with progress callback
- `getFile(fileId)` - Retrieve file metadata
- `listFiles(options)` - List files with pagination
- `deleteFile(fileId)` - Delete file
- `getQuota()` - Get tenant quota usage

**Features:**

- Progress tracking (XMLHttpRequest or Fetch with ReadableStream)
- Retry logic for transient failures (3 attempts, exponential backoff)
- Custom error classes (StorageBrainError, QuotaExceededError, etc.)
- Full TypeScript types exported

### 3.3 SDK Build Configuration

**Files to create:**

- [packages/client-sdk/build.config.ts](packages/client-sdk/build.config.ts) - Build configuration
- [packages/client-sdk/README.md](packages/client-sdk/README.md) - Usage documentation

**Build targets:**

- ESM build (modern browsers, Node.js)
- CommonJS build (legacy support)
- Type definitions (.d.ts files)
- Tree-shakeable exports

---

## Phase 4: Processing Pipeline

### 4.1 R2 Webhook Handler

**Files to create:**

- [packages/api/src/routes/webhooks.ts](packages/api/src/routes/webhooks.ts) - Webhook endpoint
- [packages/api/src/utils/webhook-validation.ts](packages/api/src/utils/webhook-validation.ts) - Signature validation

**POST /webhooks/r2-upload-complete:**

- Validate webhook signature (if configured)
- Extract file metadata from webhook payload
- Create queue message for processing
- Update upload session status to 'completed'

### 4.2 Processing Queue

**Files to create:**

- [packages/api/src/workers/processor.ts](packages/api/src/workers/processor.ts) - Queue consumer
- [packages/api/src/services/queue.ts](packages/api/src/services/queue.ts) - Queue utilities

**Queue consumer:**

- Process messages from Cloudflare Queue
- Route to context-specific processor
- Handle retries (3 attempts, exponential backoff)
- Dead letter queue for permanent failures
- Update file metadata with processing results

### 4.3 OCR Integration (Invoice Context)

**Files to create:**

- [packages/api/src/processors/ocr.ts](packages/api/src/processors/ocr.ts) - OCR processor
- [packages/api/src/services/gcp-vision.ts](packages/api/src/services/gcp-vision.ts) - GCP Vision API client

**OCR flow:**

1. Download file from R2 (streaming for large files)
2. Call Google Cloud Vision API (DOCUMENT_TEXT_DETECTION)
3. Parse response, extract structured data
4. Store in `files.metadata.ocr_data` (JSON)
5. Handle errors (retry on transient, log permanent)

**Rate limiting:**

- Configurable per tenant (default: 100 req/min)
- Track in database
- Return 429 if exceeded

### 4.4 Thumbnail Generation (Framer-Site Context)

**Files to create:**

- [packages/api/src/processors/thumbnail.ts](packages/api/src/processors/thumbnail.ts) - Thumbnail processor
- [packages/api/src/services/image-processing.ts](packages/api/src/services/image-processing.ts) - Image utilities

**Thumbnail flow:**

1. Download image from R2
2. Generate 3 sizes: 200x200, 400x400, 800x800 (maintain aspect ratio)
3. Convert to WebP format
4. Upload thumbnails to R2: `{file_id}_thumb.webp`, `{file_id}_medium.webp`, `{file_id}_large.webp`
5. Store URLs in `files.metadata.thumbnail_urls` (JSON object)

**Image processing:**

- Use Sharp (WASM) or Cloudflare Images API
- Maintain aspect ratio (crop to fit)
- Optimize WebP quality (80% for good balance)

### 4.5 Webhook Notifications

**Files to create:**

- [packages/api/src/services/webhook-notifier.ts](packages/api/src/services/webhook-notifier.ts) - Webhook notification service

**Webhook notification:**

- Call `webhook_url` from upload request (if provided)
- Include file metadata in payload
- Retry logic: 3 attempts, exponential backoff
- Log failures, don't block file availability

---

## Phase 5: Testing & Polish

### 5.1 Unit Tests

**Files to create:**

- [packages/api/tests/](packages/api/tests/) - Test directory
- [packages/api/tests/setup.ts](packages/api/tests/setup.ts) - Test setup
- [packages/api/tests/routes/upload.test.ts](packages/api/tests/routes/upload.test.ts) - Upload endpoint tests
- [packages/api/tests/services/quota.test.ts](packages/api/tests/services/quota.test.ts) - Quota service tests
- [packages/client-sdk/tests/](packages/client-sdk/tests/) - SDK tests

**Test coverage:**

- API endpoints (handshake, file management)
- Business logic (quota, validation)
- SDK client methods
- Error handling
- Processing functions

### 5.2 Integration Tests

**Files to create:**

- [packages/api/tests/integration/](packages/api/tests/integration/) - Integration tests
- [packages/api/tests/integration/upload-flow.test.ts](packages/api/tests/integration/upload-flow.test.ts) - End-to-end upload

**Integration tests:**

- Full upload flow (handshake → upload → processing)
- Quota enforcement
- Tenant isolation
- Error scenarios

### 5.3 Documentation

**Files to update/create:**

- [packages/api/README.md](packages/api/README.md) - API documentation
- [packages/client-sdk/README.md](packages/client-sdk/README.md) - SDK usage guide
- [docs/API.md](docs/API.md) - Complete API reference
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - Deployment guide

**Documentation includes:**

- API endpoint specifications
- SDK usage examples
- Authentication guide
- Error codes reference
- Deployment instructions

### 5.4 Deployment Configuration

**Files to create/update:**

- [packages/api/wrangler.toml](packages/api/wrangler.toml) - Production configuration
- [.github/workflows/deploy.yml](.github/workflows/deploy.yml) - CI/CD pipeline (optional)

**Deployment steps:**

1. Create D1 database (production)
2. Run migrations
3. Configure R2 bucket CORS
4. Set environment variables (secrets)
5. Deploy worker
6. Configure custom domain (optional)
7. Set up monitoring

---

## Execution Order

1. **Phase 0**: Update documentation (if needed)
2. **Phase 1**: Foundation (project structure, Workers setup, database, shared types)
3. **Phase 2**: Gatekeeper API (auth, handshake, file management, quota)
4. **Phase 3**: Client SDK (structure, implementation, build)
5. **Phase 4**: Processing (webhooks, queue, OCR, thumbnails)
6. **Phase 5**: Testing & deployment (tests, docs, deploy)

Each phase builds on the previous. Complete Phase 1 before Phase 2, etc.

---

## Key Implementation Details

### Database Queries

- Always filter by `tenant_id` for isolation
- Use parameterized queries (prevent SQL injection)
- Atomic operations for quota updates

### Error Handling

- Structured error responses (consistent format)
- Custom error classes in SDK
- Retry logic for transient failures
- Logging for debugging

### Security

- API keys hashed with bcrypt
- Presigned URLs with expiration
- Input validation with Zod
- Tenant isolation at all layers

### Performance

- Edge-native (D1, R2, Workers)
- Streaming for large files
- Async processing via queues
- Caching where appropriate

---

## Success Criteria

- [ ] All API endpoints functional
- [ ] Client SDK works with full TypeScript support
- [ ] OCR processing works for invoice context
- [ ] Thumbnail generation works for framer-site context
- [ ] Quota enforcement working
- [ ] Tenant isolation verified
- [ ] Tests passing (>80% coverage)
- [ ] Documentation complete
- [ ] Deployed to production
- [ ] <20ms API response time (p95)