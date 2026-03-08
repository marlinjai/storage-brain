---
title: Decisions
description: Architectural rationale for key design choices
order: 4
summary: Record of key architectural decisions made during Storage Brain planning, with rationale for technology choices, API design, and storage patterns.
category: decision
tags: [storage-brain, architecture-decisions, adr, rationale]
projects: [storage-brain]
status: active
---

# Architecture Decisions & Rationale

This document captures key architectural decisions made during the planning phase, with rationale for each choice.

## Database: D1 over Prisma Accelerate

**Decision**: Use Cloudflare D1 for MVP.

**Rationale**:
- **Cost**: D1 free tier (5M reads/day, 100K writes/day, 5GB) is sufficient for MVP
- **Simplicity**: Zero configuration, edge-native, perfect for Cloudflare Workers
- **Performance**: Edge-native means queries execute close to users
- **Future**: Can migrate to Prisma Accelerate later if caching becomes critical

**Trade-offs**:
- Simpler setup, no external dependencies
- Free for MVP scale
- Edge-native performance
- Less advanced query features than PostgreSQL
- No built-in caching (can add later)

## Authentication: Simple API Keys

**Decision**: Use simple API key per tenant (hashed in database).

**Rationale**:
- **Simplicity**: Easiest to implement for MVP
- **Security**: API keys hashed with bcrypt, never returned in responses
- **Flexibility**: Easy to revoke, regenerate, or rotate
- **Future**: Can upgrade to JWT tokens later if needed

**Implementation**:
- Format: `sk_live_` or `sk_test_` prefix + 32 random characters
- Storage: Hashed with bcrypt in `tenants.api_key_hash`
- Validation: Middleware extracts key from `Authorization: Bearer {key}` header

## File Types: Images + PDFs (MVP)

**Decision**: Whitelist images and PDFs for MVP, expand later.

**Rationale**:
- **Coverage**: Covers all initial use cases (newsletters, invoices, framer-sites)
- **Security**: Easier to validate and sanitize
- **Processing**: Simpler to handle known formats
- **Future**: Can expand to all types later

**Whitelist**:
- Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`
- Documents: `application/pdf`

## Quota: Hard Limits with Per-Tenant Custom Limits

**Decision**: Enforce hard limits (reject when exceeded) with configurable per-tenant quotas.

**Rationale**:
- **Cost Control**: Prevents unexpected storage costs
- **Flexibility**: Each tenant can have different limits
- **Clarity**: Clear error messages when quota exceeded
- **Future**: Can add soft limits (warnings) as a feature

**Default**: 500MB per tenant (configurable in database)

## Thumbnails: Multiple Sizes, WebP Format

**Decision**: Generate 3 thumbnail sizes (200x200, 400x400, 800x800) in WebP format.

**Rationale**:
- **Responsive**: Different sizes for different contexts (lists, cards, lightboxes)
- **Performance**: WebP offers best compression (30-50% smaller than JPEG)
- **Compatibility**: Modern browsers support WebP, can add JPEG fallback later
- **Storage**: Multiple sizes enable better UX without storing full-size originals everywhere

**Sizes**:
- `thumb`: 200x200px (previews, lists)
- `medium`: 400x400px (cards, galleries)
- `large`: 800x800px (lightboxes, detail views)

## Webhooks: Optional, Passed in Request

**Decision**: Make webhooks optional, pass `webhook_url` in upload request.

**Rationale**:
- **Flexibility**: Different webhooks per upload (useful for different contexts)
- **Simplicity**: No need to configure webhooks in database for MVP
- **Future**: Can add per-tenant default webhooks later

**Implementation**:
- Optional `webhook_url` field in upload request
- Call webhook after processing completes
- Retry logic: 3 attempts with exponential backoff

## Deployment: Single Worker (MVP)

**Decision**: Use single Cloudflare Worker for all functionality in MVP.

**Rationale**:
- **Simplicity**: Easier to deploy, debug, and maintain
- **Cost**: Single worker is cheaper than multiple
- **Performance**: Shared D1 binding, no cross-worker communication
- **Future**: Can split into separate workers if needed

**Future Split**:
- `api-worker`: Handshake, file management endpoints
- `processor-worker`: Background processing via queues

## Multi-Tenancy: Admin-Created Only (MVP)

**Decision**: Tenants created manually by admin for MVP.

**Rationale**:
- **Not Priority**: Self-service signup not needed for MVP
- **Simplicity**: Manual creation via SQL or admin endpoint
- **Security**: Admin-controlled access
- **Future**: Can add self-service signup later

**Implementation**:
- Admin endpoint: `POST /admin/tenants` (protected by admin API key)
- Or: Direct SQL insertion for initial tenants
- Generate API key on creation, store hashed

## SDK Distribution: NPM Package + Monorepo

**Decision**: Publish as NPM package, also available in monorepo.

**Rationale**:
- **External Use**: NPM package for other projects/teams
- **Internal Use**: Monorepo package for your other apps
- **TypeScript**: Full type definitions, autocomplete
- **Versioning**: Semantic versioning, easy updates

**Build**: ESM and CommonJS, tree-shakeable

## Monitoring: Cloudflare Analytics + Basic Logging

**Decision**: Use Cloudflare Analytics (built-in) + structured JSON logs.

**Rationale**:
- **Cost**: Free with Cloudflare Workers
- **Simplicity**: No external services needed for MVP
- **Future**: Can add external logging (Datadog, etc.) later

**Logging**:
- Structured JSON logs to console
- Export via `wrangler tail` or Cloudflare dashboard
- Log: API requests, errors, processing events

---

## Summary

All decisions prioritize **simplicity and speed for MVP** while maintaining flexibility to scale and add features later. The architecture is designed to be:

1. **Edge-Native**: Leverages Cloudflare's edge network
2. **Type-Safe**: Full TypeScript coverage
3. **Cost-Effective**: Free tier sufficient for MVP
4. **Extensible**: Easy to add features later
5. **Production-Ready**: Secure, scalable, maintainable
