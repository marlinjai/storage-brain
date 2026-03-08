---
title: Clarifying Questions
description: Q&A on Storage Brain design choices
order: 5
summary: Q&A document capturing clarifying questions and answers about Storage Brain design choices before proceeding with the RFC and implementation.
category: internal
tags: [storage-brain, design, questions, planning]
projects: [storage-brain]
status: active
---

# Clarifying Questions for Storage Brain Implementation

Before we proceed with the RFC and implementation, please clarify the following:

## 1. Database Choice
- **Question**: Do you prefer **D1** (Cloudflare's native SQL) or **Prisma with Accelerate**?
- **Recommendation**: Start with D1 for simplicity and edge-native performance, migrate to Prisma if needed later.
- **Your Choice**: **D1** (Recommended)

**Rationale**:
- **D1**: Free tier (5M reads/day, 100K writes/day, 5GB storage). Workers Paid plan ($5/month) includes 25B reads/month, 50M writes/month, 5GB storage. Edge-native, zero config, perfect for Cloudflare Workers.
- **Prisma Accelerate**: $49/month Pro (10M operations) or $129/month Business (50M operations). Adds complexity and cost. Better for existing Prisma setups or when you need advanced caching.
- **Decision**: D1 is free for MVP, simpler, edge-native, and fits the stack perfectly. We can migrate to Prisma later if needed.

## 2. Authentication & Authorization
- **Question**: How should API keys be managed?
  - Option A: Simple API key per tenant (stored in database)
  - Option B: JWT tokens with tenant claims
  - Option C: OAuth2-style client credentials
- **Your Choice**: **Option A: Simple API key per tenant** (Recommended)

**Rationale**:
- Simplest to implement for MVP
- No token expiration complexity
- Easy to revoke (just delete/regenerate key)
- Can upgrade to JWT later if needed
- Perfect for server-to-server communication

## 3. File Type Restrictions
- **Question**: What file types should be allowed?
  - All types?
  - Image types only (jpg, png, webp, etc.)?
  - Specific whitelist?
- **Your Choice**: **Images + PDFs** (Recommended for MVP)

**Rationale**:
- **MVP Whitelist**: Images (JPEG, PNG, WebP, GIF, AVIF) + PDFs
- Covers most use cases: newsletters, invoices, framer-sites
- Easier to validate and process
- Can expand to all types later
- **Whitelist**:
  - Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`
  - Documents: `application/pdf`

## 4. Quota Management
- **Question**: How should quotas be enforced?
  - Hard limit (reject uploads when exceeded)?
  - Soft limit (warn but allow)?
  - Per-tenant custom limits?
- **Your Choice**: **Hard limit with per-tenant custom limits** (Recommended)

**Rationale**:
- **Hard limits**: Reject uploads when quota exceeded (prevents unexpected costs)
- **Per-tenant limits**: Each tenant has configurable `quota_bytes` in database
- **Default quota**: 500MB per tenant (configurable)
- **Benefits**: Predictable costs, clear error messages, flexible per tenant
- Can add soft limits later as a feature

## 5. Processing Services
- **Question**: For Google Cloud Vision OCR:
  - Do you have a GCP account set up?
  - Should we use service account keys or Workload Identity?
  - What's the budget/rate limit per tenant?
- **Your Choice**: **GCP Account Ready, API Key, Add Margin**

**Rationale**:
- **Authentication**: Use API key from environment variable (simplest for MVP)
- **Service Account Keys**: Store in Cloudflare Workers secrets (secure)
- **Rate Limiting**: Add configurable margin on top of GCP limits
  - Default: 100 requests/minute per tenant (configurable)
  - Can be adjusted per tenant in database
- **Cost Management**: Track usage per tenant, add billing hooks later
- **Future**: Can upgrade to Workload Identity for better security

## 6. Thumbnail Generation
- **Question**: For `framer-site` context thumbnails:
  - What dimensions? (e.g., 200x200, 400x400)
  - What format? (jpg, webp, avif)
  - Multiple sizes or single?
- **Your Choice**: **Multiple sizes, WebP format** (Recommended)

**Rationale**:
- **Sizes**: Generate 3 sizes for responsive images
  - `thumb`: 200x200px (small previews, lists)
  - `medium`: 400x400px (cards, galleries)
  - `large`: 800x800px (lightboxes, detail views)
- **Format**: WebP (best compression, modern browser support)
- **Fallback**: Generate JPEG as fallback if WebP not supported
- **Storage**: Store all sizes in R2 with suffix: `{file_id}_thumb.webp`, `{file_id}_medium.webp`, `{file_id}_large.webp`

## 7. Webhook Configuration
- **Question**: Should post-upload webhooks be:
  - Configured per tenant in database?
  - Passed in upload request?
  - Optional feature?
- **Your Choice**: **Optional feature, passed in upload request** (Recommended for MVP)

**Rationale**:
- **MVP**: Make webhooks optional, pass `webhook_url` in upload request
- **Flexibility**: Different webhooks per upload (useful for different contexts)
- **Future**: Can add per-tenant default webhooks in database later
- **Implementation**:
  - Optional `webhook_url` field in upload request
  - Call webhook after processing completes
  - Include file metadata in webhook payload
  - Retry logic for failed webhooks (3 attempts)

## 8. Multi-Tenancy Model
- **Question**: How are tenants created/managed?
  - Self-service signup?
  - Admin-created only?
  - Import from existing system?
- **Your Choice**: **Admin-created only** (Not priority for MVP)

**Rationale**:
- **MVP**: Admin creates tenants via database migration or simple admin script
- **Future**: Self-service signup can be added later
- **Implementation**:
  - Manual tenant creation via SQL or admin endpoint (protected)
  - Generate API key on tenant creation
  - Store in `tenants` table
- **Admin Endpoint**: `POST /admin/tenants` (protected by admin API key, separate from tenant keys)

## 9. Deployment Target
- **Question**: Cloudflare Workers deployment:
  - Single worker for all functionality?
  - Separate workers for API vs. processing?
  - Custom domain or workers.dev?
- **Your Choice**: **Single worker for MVP, workers.dev initially** (Recommended)

**Rationale**:
- **MVP**: Single worker for simplicity
  - All API endpoints in one worker
  - Processing via Cloudflare Queues (same worker, different route)
  - Easier to deploy and debug
- **Future**: Can split into separate workers if needed:
  - `api-worker`: Handshake, file management
  - `processor-worker`: Background processing
- **Domain**: Start with `*.workers.dev`, upgrade to custom domain later
- **Benefits**: Simpler deployment, shared D1 binding, easier local development

## 10. Client SDK Distribution
- **Question**: How should the SDK be distributed?
  - NPM package?
  - Bundled with monorepo?
  - CDN script tag?
- **Your Choice**: **NPM package + bundled with monorepo** (Recommended)

**Rationale**:
- **Primary**: NPM package for external use (`@your-org/storage-brain`)
- **Internal**: Also available as monorepo package for your other apps
- **Build**: ESM and CommonJS builds, tree-shakeable
- **Future**: Can add CDN script tag later if needed
- **Benefits**: TypeScript support, versioning, easy updates

## 11. Monitoring & Observability
- **Question**: What observability do you need?
  - Cloudflare Analytics only?
  - Custom logging to external service?
  - Metrics dashboard?
- **Your Choice**: **Cloudflare Analytics + Basic Logging** (Recommended for MVP)

**Rationale**:
- **MVP**: Cloudflare Analytics (built-in, free)
  - Request counts, error rates, latency
  - Worker logs via `wrangler tail`
- **Basic Logging**: Structured JSON logs to console
  - Log all API requests, errors, processing events
  - Can export to external service later
- **Future**: Add custom metrics dashboard, external logging (Datadog, etc.)

## 12. Initial Scope
- **Question**: For MVP, which features are essential?
  - [x] Handshake endpoint + presigned URLs
  - [x] Basic file upload to R2
  - [x] Database tracking
  - [x] Client SDK
  - [x] OCR processing (invoice context)
  - [x] Thumbnail generation (framer-site context)
  - [ ] Dashboard UI (Phase 2)
  - [ ] Widget component (Phase 2)

**MVP Priority** (Phase 1):
1. Handshake endpoint + presigned URLs
2. Basic file upload to R2
3. Database tracking (tenants, files, sessions)
4. Client SDK (TypeScript)
5. OCR processing (invoice context)
6. Thumbnail generation (framer-site context)

**Phase 2** (Future):
- Dashboard UI
- Widget component
- Advanced analytics

---

**Please fill in your choices, and we'll proceed with the detailed RFC.**
