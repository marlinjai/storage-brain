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
2. **S2 `storage-split-tenants` (ops + repoint tooling)** AMENDED 2026-07-27 after S1 ops recon: (a) SB already has six per-app tenants (social-planner, receipts OCR, lumitra-studio, VideoBucket, ArboSano, lola-stories); the problem is narrower than documented: several apps BORROW the `receipts OCR` tenant key. (b) PLATFORM apps act for many companies (Studio stores every company's generated assets), so "one key per company" cannot hold for them: the amended model is per-APP service tenants (blast-radius isolation per credential) while company-scoped keys serve DIRECT company access when such a feature exists. (c) The borrowed-key untangling requires per-context file attribution (inventory captured 2026-07-27: image/kie-input/character-reference/story-*/marketplace-* = studio+lola pipelines, receipt = receipts app, flowmap-thumbnail + feedback-screenshot = to attribute) and is PARKED for a dedicated ops session; nothing is repointed until each context is confidently mapped. (d) The lola-stories SB tenant maps auth_workspace_id to the lola-stories auth-brain workspace: that workspace is LOAD-BEARING and must never be deleted while this mapping exists. Original text follows for reference: create per-company SB tenants (Lumitra, Lola Stories, marlinjai/sharondisalvo as needed), an idempotent `--map`-style repoint script moving files' `tenant_id` per consumer (stored_path stays; objects do not move), mint company-scoped keys per consumer app and swap their Infisical secrets, then retire the shared key. PERMANENT-URL CAVEAT: tokens sign `tenantId:fileId`, so re-tenanted files' existing permanent links break; the script must emit the affected-URL list and the slice decides per consumer (regenerate links vs a legacy-tenant token acceptance shim with an expiry date).
   **S2 EXECUTED 2026-07-27 (ops session).** What the live system actually showed, which differs from the assumption above:
   - **The file split was already done.** A per-tenant/per-context inventory of the production database returned 20 tenant+context pairs, every one already on the right per-app tenant: lola-stories holds its own story/marketplace/voice/avatar/`flowmap-thumbnail`/`feedback-screenshot` files, lumitra-studio holds `image`/`character-reference`/`model3d`, and the shared `receipts OCR` tenant holds ONLY 57 `receipt` files. No broad repoint was needed and none was performed.
   - **The two unknown contexts resolved to lola-stories** and needed no action. The one real misattribution is `kie-input`: 361 files, 371 MB, produced ONLY by lumitra-studio (`packages/lumitra-core/src/providers/kie-image-upload.ts`), sitting in lola's tenant because Studio dev held lola's borrowed key 2026-06-01..06-04. They are transient KIE bridge uploads, all 361 untagged (the only untagged files in the system, so orphans by the provenance rule), and the producing code's own comment says the context exists so they can be cleaned up later. RECOMMENDATION: delete rather than repoint; pending Marlin's go because deletion is irreversible. Note `scripts/repoint-tenant.ts` moves WHOLE tenants and has no per-context filter, so a repoint would need tooling work first.
   - **A latent production outage was found and fixed.** lola-stories prod holds a WORKSPACE-scoped auth-brain key, but auth-brain returned `app_grants: []` for every non-tenant scope, so the S1 workspace branch could never pass its own `storage` grant door: unconditional 403. Prod was only alive because the lola API container (started 2026-07-24) still held a legacy tenant key in memory; the next redeploy would have broken all lola storage. Fixed by seeding the `storage` grant for the lola-stories company AND auth-brain#68 (workspace scope inherits its parent company's grants; `tenant_group` still `[]`). S1's unit tests missed this because they mock a workspace-scoped verify response carrying a grant that real auth-brain never sent.
   - **Key hygiene:** Studio dev and lola dev/staging held the dead, rotated-away lola key; Receipt OCR dev held another dead key plus an unused `NEXT_PUBLIC_STORAGE_BRAIN_API_KEY` (browser-exposed by prefix, read by nothing). Studio dev and Receipt OCR dev now resolve 200 to their own tenants and the dead public key was deleted. `STORAGE_BRAIN_SA_KEY` in the storage project points at a workspace that exists in no company (an era-2 magic workspace deleted during the isolation program): dead, needs retiring.
   - **Not done:** regenerating the shared `receipts OCR` key is unnecessary, because no app borrows it any more (receipts prod/dev are the only holders and both are legitimately that tenant). The borrowed-key problem the slice was written for no longer exists.

3. **S3 `storage-hygiene`**: HMAC-sign the R2 webhook (finding 3); per-tenant signed-URL key derivation (HKDF from the global secret, old tokens accepted until rotated); either enforce `X-Workspace-Id` or delete it from the SDK; CORS tightening where the dashboard flow allows.
4. **S4 `storage-erasure-consumer`**: the signed `tenant.erased` webhook (same contract as Studio/analytics): delete the company's SB tenant, files, and OBJECTS; registry entry from S1.
5. **Rate-limit bucketing (found + fixed 2026-07-27, PR #21).** Measured on the live API over 6 hours: 846 x 200 and 54 x 429, so ~6% of requests were rate-limited and every 429 was on `signed-url`. `/download` already had a generous 1000/60s gallery bucket, but `signed-url` and `permanent-url` are also one-call-per-file-per-render and were still on the 100/60s API bucket, which is keyed per TENANT so a whole product's users share it. Both now sit on the gallery bucket, and the broad `/files/*` wildcard was narrowed to single-segment patterns so it cannot double-meter them back onto the small bucket.
6. **Dashboard follow-up (deferred)**: per-company `can()` filtering instead of the all-or-nothing platform-admin gate; recorded, not scheduled.

## Definition of done (wave level)

Company A's key cannot list, read, download, or delete company B's files (positive + negative tests incl. the public/token paths); the shared five-app key is revoked; every consumer app runs on its own company-scoped key; webhook signed; erasure wave covers storage; SDK released with a version bump for any wire change.

## Out of scope

- Physical bucket separation (path-prefix + SQL scoping stays; revisit with real customer volume).
- Per-workspace keys inside a company (the 2026-04-06 draft stays superseded).
- Dashboard per-company views beyond the deferred follow-up.
