---
title: Quick Start
description: Key decisions and deployment architecture overview
order: 2
---

# Quick Start Guide - Storage Brain

## Key Decisions Summary

### ✅ Database: **D1** (Cloudflare)
- **Free Tier**: 5M reads/day, 100K writes/day, 5GB storage
- **Why**: Free for MVP, edge-native, zero config, perfect for Cloudflare Workers
- **Cost**: $0 for MVP, $5/month Workers plan if you exceed free tier

### ✅ Authentication: **Simple API Keys**
- Format: `sk_live_` or `sk_test_` + 32 random chars
- Stored: Hashed with bcrypt in database
- Usage: `Authorization: Bearer {api_key}` header

### ✅ File Types: **Images + PDFs** (MVP)
- Images: JPEG, PNG, WebP, GIF, AVIF
- Documents: PDF
- Can expand to all types later

### ✅ Quota: **Hard Limits, Per-Tenant**
- Default: 500MB per tenant (configurable)
- Enforcement: Reject uploads when quota exceeded
- Benefits: Cost control, clear errors, flexible per tenant

### ✅ Thumbnails: **3 Sizes, WebP Format**
- `thumb`: 200x200px
- `medium`: 400x400px  
- `large`: 800x800px
- Format: WebP (best compression)

### ✅ Webhooks: **Optional, Pass in Request**
- Field: `webhook_url` in upload request (optional)
- Trigger: After processing completes
- Retry: 3 attempts with exponential backoff

### ✅ Deployment: **Single Worker (MVP)**
- All endpoints in one Cloudflare Worker
- Processing via Cloudflare Queues
- Domain: `*.workers.dev` initially
- Can split later if needed

### ✅ Multi-Tenancy: **Admin-Created Only**
- Manual creation via SQL or admin endpoint
- Self-service signup: Phase 2

### ✅ SDK: **NPM Package**
- Published as `@your-org/storage-brain`
- Also available in monorepo
- ESM + CommonJS builds

---

## D1 vs Prisma Accelerate - Detailed Comparison

### Cloudflare D1
**What it is**: Serverless SQL database (SQLite-based) built for Cloudflare Workers.

**Pricing**:
- **Free Tier**: 
  - 5 million rows read/day
  - 100,000 rows written/day
  - 5 GB storage
- **Workers Paid Plan** ($5/month):
  - 25 billion rows read/month (included)
  - 50 million rows written/month (included)
  - 5 GB storage (included)
  - Then: $0.001 per million reads, $1.00 per million writes, $0.75/GB storage

**Pros**:
- ✅ Free for MVP scale
- ✅ Edge-native (queries execute close to users)
- ✅ Zero configuration
- ✅ Perfect integration with Cloudflare Workers
- ✅ No external dependencies

**Cons**:
- ❌ SQLite limitations (no advanced PostgreSQL features)
- ❌ No built-in caching (can add Cloudflare Cache API)
- ❌ Less mature than PostgreSQL

**Best For**: MVP, edge-native apps, Cloudflare Workers projects

---

### Prisma Accelerate
**What it is**: Global caching layer that sits in front of your database (PostgreSQL, MySQL, etc.) to speed up queries.

**Pricing**:
- **Pro Plan** ($49/month):
  - 10 million operations/month (included)
  - Then: $0.02 per 10,000 operations
- **Business Plan** ($129/month):
  - 50 million operations/month (included)
  - Then: $0.01 per 10,000 operations

**Note**: You still need a database (PostgreSQL, etc.) - Accelerate is just the caching layer.

**Pros**:
- ✅ Advanced caching (reduces database load)
- ✅ Works with PostgreSQL (more features)
- ✅ Global edge caching
- ✅ Good for high-traffic apps

**Cons**:
- ❌ $49/month minimum (even for low usage)
- ❌ Adds complexity (need database + Accelerate)
- ❌ Not edge-native (adds latency)
- ❌ Overkill for MVP

**Best For**: High-traffic apps, existing Prisma setups, when caching is critical

---

### Our Recommendation: **D1**

**Why D1 wins for MVP**:
1. **Cost**: Free tier covers MVP needs, $5/month if you scale
2. **Simplicity**: One less service to manage, zero config
3. **Performance**: Edge-native means queries execute at the edge
4. **Integration**: Perfect for Cloudflare Workers stack
5. **Future**: Can migrate to Prisma Accelerate later if needed

**When to Consider Prisma Accelerate**:
- You already have a PostgreSQL database
- You need advanced SQL features
- You have high read traffic and need caching
- You're willing to pay $49/month minimum

---

## Deployment Architecture - More Context

### Single Worker (MVP) - Recommended

**Structure**:
```
Single Cloudflare Worker
├── API Routes (Hono)
│   ├── POST /request-upload
│   ├── GET /files/:id
│   ├── GET /files
│   └── DELETE /files/:id
├── Processing Queue Consumer
│   ├── OCR processing
│   ├── Thumbnail generation
│   └── Webhook notifications
└── Shared D1 Binding
```

**Benefits**:
- ✅ Simpler deployment (one worker)
- ✅ Shared D1 database binding
- ✅ Easier debugging (all code in one place)
- ✅ Lower cost (one worker vs multiple)
- ✅ No cross-worker communication needed

**Drawbacks**:
- ❌ Larger worker bundle size
- ❌ All code deployed together (can't scale independently)

**When to Split**:
- Worker bundle exceeds 10MB
- Need to scale API and processing independently
- Different rate limits needed
- Processing becomes resource-intensive

---

### Separate Workers (Future)

**Structure**:
```
api-worker (Cloudflare Worker)
├── Handshake endpoint
├── File management
└── D1 binding

processor-worker (Cloudflare Worker)
├── Queue consumer
├── OCR processing
├── Thumbnail generation
└── D1 binding (read-only for updates)
```

**Benefits**:
- ✅ Independent scaling
- ✅ Smaller bundles
- ✅ Different rate limits
- ✅ Can deploy independently

**Drawbacks**:
- ❌ More complex deployment
- ❌ Higher cost (multiple workers)
- ❌ Need to manage multiple deployments

**Recommendation**: Start with single worker, split later if needed.

---

## Next Steps

1. ✅ All questions answered
2. ✅ Decisions documented
3. 🚀 **Ready to start Phase 1 implementation**

See the [Implementation Plan](./implementation-plan) for step-by-step execution guide.
