---
type: plan
status: draft
date: 2026-07-27
title: Storage-brain company isolation (platform identity end-state)
summary: Align storage-brain with the platform model: storage tenants keyed to auth-brain COMPANIES, company-scoped machine keys accepted, an app_grants door, the shared five-app key split per company, and the token/webhook hygiene the recon surfaced. Pre-launch gate item 11.
tags: [storage-brain, multi-tenancy, auth-brain, isolation, pre-launch]
projects: [storage-brain, auth-brain]
---

# Storage-Brain Company Isolation

## Where we are (recon 2026-07-27)

Already landed: dashboard auth via auth-brain sessions + platform-admin check; API accepts auth-brain service-account keys (workspace-scoped only) alongside legacy `sk_live_` tenant keys. The gaps that matter:

| # | Finding | Where |
|---|---------|-------|
| 1 | FIVE apps share ONE tenant key -> one flat namespace (lumitra-studio, receipt-ocr-app, lola-stories, email-editor, data-table all on the "Receipts OCR APP" tenant) | docs/plans/2026-04-06-automated-key-rotation.md |
| 2 | Company-scoped auth-brain keys are hard-403'd (only `workspace` scope accepted); `auth_workspace_id` is 1:1 and never filters anything | api middleware/auth.ts |
| 3 | `POST /webhooks/r2-upload-complete` is fully unauthenticated; derives tenant from the object key | routes/webhooks.ts |
| 4 | Public download path ignores auth-brain keys (legacy hash lookup only): SA keys cannot download | routes/public-download.ts |
| 5 | One global `URL_SIGNING_SECRET` signs every tenant's permanent URLs; revocation is all-or-nothing | services/signed-url.ts |
| 6 | `X-Workspace-Id` is sent by the SDK on every call and read by nothing | sdk/client.ts vs API |
| 7 | `upload_sessions` has no tenant column; unscoped lookups serve the token-only upload route | migrations 001 |
| 8 | No `app_grants` awareness anywhere | - |

## Target model (mirrors the platform decisions)

Storage-brain's `tenant` maps 1:1 to an **auth-brain COMPANY** (`auth_tenant_id`), exactly like Studio's boundary. Machine callers authenticate with **company-scoped auth-brain API keys**; the key's company must carry the **`storage` app grant** (registry entry in auth-brain; grants delivered inside the existing verify response since shared 1.3.0). The five-app shared key dies: each company gets its own storage tenant, and each consumer app holds a key scoped to the company whose data it touches. SB-internal "workspaces" stay what they are (quota/grouping INSIDE a company), explicitly not an auth boundary.

## Slices

1. **S1 `storage-company-keys` (storage-brain)**: add `auth_tenant_id` to tenants; accept `tenant`-scoped auth-brain keys (resolve SB tenant via `auth_tenant_id`; keep workspace-scope + legacy keys working during migration); require the `storage` grant from the key's verify response (fail closed, skew-logged); replace the hand-rolled verify fetch with SDK `verifyApiKey`; fix the public-download SA-key gap (finding 4); stamp `tenant_id` onto `upload_sessions`. Registry side: `storage` app entry + erasure entry ride in a small auth-brain docs/registry commit.
2. **S2 `storage-split-tenants` (ops + repoint tooling)**: create per-company SB tenants (Lumitra, Lola Stories, marlinjai/sharondisalvo as needed), an idempotent `--map`-style repoint script moving files' `tenant_id` per consumer (stored_path stays; objects do not move), mint company-scoped keys per consumer app and swap their Infisical secrets, then retire the shared key. PERMANENT-URL CAVEAT: tokens sign `tenantId:fileId`, so re-tenanted files' existing permanent links break; the script must emit the affected-URL list and the slice decides per consumer (regenerate links vs a legacy-tenant token acceptance shim with an expiry date).
3. **S3 `storage-hygiene`**: HMAC-sign the R2 webhook (finding 3); per-tenant signed-URL key derivation (HKDF from the global secret, old tokens accepted until rotated); either enforce `X-Workspace-Id` or delete it from the SDK; CORS tightening where the dashboard flow allows.
4. **S4 `storage-erasure-consumer`**: the signed `tenant.erased` webhook (same contract as Studio/analytics): delete the company's SB tenant, files, and OBJECTS; registry entry from S1.
5. **Dashboard follow-up (deferred)**: per-company `can()` filtering instead of the all-or-nothing platform-admin gate; recorded, not scheduled.

## Definition of done (wave level)

Company A's key cannot list, read, download, or delete company B's files (positive + negative tests incl. the public/token paths); the shared five-app key is revoked; every consumer app runs on its own company-scoped key; webhook signed; erasure wave covers storage; SDK released with a version bump for any wire change.

## Out of scope

- Physical bucket separation (path-prefix + SQL scoping stays; revisit with real customer volume).
- Per-workspace keys inside a company (the 2026-04-06 draft stays superseded).
- Dashboard per-company views beyond the deferred follow-up.
