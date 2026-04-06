---
title: Automated Key Rotation with Tenant Isolation
type: plan
status: draft
summary: End-to-end automated key rotation — separate tenants per project, dual-key grace period, Infisical push, Coolify auto-redeploy.
tags: [security, infrastructure, infisical, coolify, automation]
date: 2026-04-06
---

# Automated Key Rotation with Tenant Isolation

## Problem

1. **Shared tenant** — 5 projects share a single `production-tenant` API key. A leak in one project exposes all projects' files.
2. **Manual rotation** — Rotating a key requires: regenerate in dashboard → copy key → paste in Infisical → manually redeploy each consumer. Error-prone and slow.
3. **Downtime risk** — The old key is immediately invalidated on regeneration, breaking consumers until they redeploy.

## Goal

One-click (or scheduled) key rotation that:
- Rotates a single tenant's key
- Keeps the old key valid during a grace period
- Pushes the new key to Infisical automatically
- Triggers consumer redeployment automatically
- Zero downtime, zero manual steps after the trigger

## Current State

### Tenants (DB)

| Tenant | ID | Used By |
|--------|-----|---------|
| lola-stories | `4233a074-336e-451c-9f38-c7dd68ce379b` | **Unused** — Lola API uses production-tenant |
| Receipts OCR APP | `7a96acd4-481c-4fd6-94fd-a9ea30a73106` | receipt-ocr-app, but also lola-stories, email-editor, lumitra-studio, data-table (all share this key) |

### Consumer Apps

| Project | Deployment | Infisical Org | Infisical Path | Coolify UUID |
|---------|-----------|--------------|----------------|-------------|
| Lola Stories API | Coolify (Docker) | Lola Stories | `/apps/api` | `r14l3twsxmfdxsplfagd2dmw` |
| Receipt OCR | Coolify (Docker) | Lumitra | TBD | `vlpgynxyzasgqr3gvp3zi1on` |
| Email Editor | TBD | TBD | TBD | TBD |
| Lumitra Studio | TBD | TBD | TBD | TBD |
| Data Table | TBD | TBD | TBD | TBD |

---

## Phase 1: Tenant Isolation

**Create dedicated tenants** so each project has its own key. If one leaks, only that project's files are exposed.

### New Tenants to Create

| Tenant Name | For Project | Allowed File Types |
|-------------|------------|-------------------|
| `email-editor` | Email Editor | image/jpeg, image/png, image/webp |
| `lumitra-studio` | Lumitra Studio | image/jpeg, image/png, image/webp, application/pdf |
| `data-table` | Data Table | image/jpeg, image/png, image/webp, application/pdf |

### Migrate Existing

- **lola-stories** tenant already exists → update Lola API to use it (change `STORAGE_BRAIN_API_KEY` in Infisical to this tenant's key)
- **receipt-ocr** tenant already exists → keep as-is, rename to `receipt-ocr` for clarity

### File Migration

Files uploaded by different apps are currently all under the `production-tenant` (receipt-ocr). They stay there — we don't move existing files. New uploads go to the correct tenant.

### Consumer Code Changes

Each project needs its env var updated to the new tenant-specific key. No code changes needed — just Infisical secret values.

---

## Phase 2: Dual-Key Grace Period

### DB Migration

```sql
ALTER TABLE tenants
  ADD COLUMN previous_api_key_hash TEXT,
  ADD COLUMN previous_key_expires_at BIGINT;
```

### Auth Middleware Change

In `getTenantByApiKey()`:
1. Hash incoming key
2. Query: `WHERE api_key_hash = $hash OR (previous_api_key_hash = $hash AND previous_key_expires_at > NOW())`
3. Timing-safe verify on match

### Regenerate-Key Change

In `POST /admin/tenants/:id/regenerate-key`:
1. Accept optional `gracePeriodSeconds` param (default: 300)
2. Copy current `api_key_hash` → `previous_api_key_hash`
3. Set `previous_key_expires_at` = now + gracePeriodSeconds
4. Generate new key + hash as before

### Cleanup

Periodic job or on-read: null out `previous_api_key_hash` when `previous_key_expires_at` has passed.

---

## Phase 3: Infisical Push (Storage Brain → Infisical)

After key regeneration, Storage Brain automatically updates the new key in Infisical.

### Tenant → Infisical Mapping

New columns on the `tenants` table (or a separate `tenant_integrations` table):

```sql
ALTER TABLE tenants ADD COLUMN infisical_config JSONB;
-- Schema:
-- {
--   "projectId": "a510e5be-...",
--   "environment": "prod",
--   "secretPath": "/apps/api",
--   "secretName": "STORAGE_BRAIN_API_KEY",
--   "orgSlug": "lola-stories"
-- }
```

### Push Mechanism

Storage Brain API uses the Infisical API to update the secret:
```
PATCH https://infisical.lumitra.co/api/v3/secrets/raw/STORAGE_BRAIN_API_KEY
```

Requires a machine identity with write access to each project. The `terraform-admin` identities already exist in both orgs.

### Auth

Storage Brain needs Infisical credentials to push secrets. Options:
- **Shared machine identity** with write access to all consumer projects
- **Per-tenant Infisical credentials** stored encrypted in tenant config

The per-tenant approach is more isolated but more complex. Start with a shared identity scoped to `STORAGE_BRAIN_API_KEY` writes only.

---

## Phase 4: Consumer Auto-Redeploy

After updating Infisical, trigger redeployment of the consumer app.

### Option A: Coolify Webhook from Storage Brain

Tenant config includes the Coolify deploy webhook:
```json
{
  "coolifyAppUuid": "r14l3twsxmfdxsplfagd2dmw",
  "deployTrigger": "coolify"
}
```

Storage Brain calls `POST /api/v1/deploy` on Coolify after Infisical push.

### Option B: Infisical Webhook → Coolify

Configure Infisical webhooks per project that fire on secret change. These call a bridge endpoint (Cloudflare Worker or small service) that maps the secret change to a Coolify deploy.

### Option C: Infisical Webhook → GitHub Actions

Infisical fires webhook → triggers `workflow_dispatch` on the consumer repo → CI builds and deploys.

**Recommendation**: Option A is simplest — Storage Brain orchestrates the full flow. It already has the Coolify context via tenant config.

### Vercel Apps

For Vercel-deployed apps (if any use Storage Brain):
- Infisical → Vercel sync handles env var updates automatically
- Trigger a redeploy via Vercel API: `POST /v1/deployments` or `vercel redeploy`
- Tenant config includes Vercel project ID

---

## Phase 5: Rotation Admin UI + Scheduling

### Dashboard Enhancement

The "Regenerate API Key" button in tenant settings becomes:
1. Click "Rotate Key"
2. Shows: grace period (default 5 min), connected Infisical project, Coolify app
3. Confirms the rotation plan
4. Executes: regenerate → push to Infisical → trigger redeploy
5. Shows live status: "Key rotated" → "Infisical updated" → "Redeploy triggered" → "Consumer healthy"

### Scheduled Rotation

Optional: CRON-based automatic rotation (e.g., every 90 days). Storage Brain triggers the full pipeline on schedule.

---

## End-to-End Flow

```
Admin clicks "Rotate Key" for tenant receipt-ocr
  │
  ├── 1. Generate new key + hash
  ├── 2. Move old hash to previous_api_key_hash (5 min grace)
  ├── 3. Store new hash + prefix
  │
  ├── 4. PATCH Infisical secret (new key value)
  │      └── POST infisical.lumitra.co/api/v3/secrets/raw/STORAGE_BRAIN_API_KEY
  │
  ├── 5. Trigger Coolify redeploy
  │      └── POST coolify API /deploy?uuid=vlpgynxyzasgqr3gvp3zi1on
  │
  ├── 6. Wait for health check (poll Coolify deployment status)
  │
  └── 7. Done — old key expires after grace period
         Consumer is already using the new key
```

**Total downtime: zero.** Old key valid throughout. New key active after redeploy (~60s).

---

## Implementation Order

| Phase | Effort | Depends On |
|-------|--------|-----------|
| **Phase 1**: Tenant isolation | 1 session | Nothing — do this first |
| **Phase 2**: Dual-key grace period | 1 session | Nothing |
| **Phase 3**: Infisical push | 1 session | Phase 2 |
| **Phase 4**: Coolify auto-redeploy | 1 session | Phase 3 |
| **Phase 5**: Dashboard UI + scheduling | 1-2 sessions | Phase 4 |

Phases 1 and 2 are independent and should be done first. Phases 3-5 build sequentially.

---

## Security Considerations

- Infisical write credentials stored encrypted in Storage Brain DB (same pattern as BYOS S3 credentials in the other plan)
- Coolify deploy tokens scoped per-app, stored alongside tenant config
- Audit log: every rotation records timestamp, old key prefix, new key prefix, Infisical push status, deploy trigger status
- Grace period is a security tradeoff — 5 min window where two keys are valid. Acceptable given the automation speed.

## Open Questions

- Should we support non-Coolify deployment targets (Vercel, Fly, Railway) in the tenant config?
- Should the bridge be inside Storage Brain or a separate microservice?
- Do we want rotation notifications (Slack, email) when automated rotations happen?
