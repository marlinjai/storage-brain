---
title: Storage Brain Roadmap
type: roadmap
tags: [storage-brain, roadmap]
date: 2026-09-10
---

# Roadmap

Every open item is one checkbox line, dated with when it was last confirmed. A line links a
plan when the item carries a decision or a sequence.

## Now

- [ ] Dependabot exceptions with no fix a parent allows (security fleet, 2026-11-08): minimatch
      10.2.6 under typescript-eslint 8 (GHSA-g3hv-75wg-m249 is fixed only in minimatch 11.0.1,
      and no typescript-eslint release declares 11) and postcss-selector-parser 6.0.10 under
      @tailwindcss/typography 0.5.20, which clearify 2.2.2 pulls for the docs build
      (GHSA-rj75-hqrm-r3gf, fixed in 6.1.5; typography pins 6.0.10 exactly in its latest
      release). Both are build tools that only read this repository's own files; neither is
      loaded by the API or the dashboard at runtime (no import in packages/*/src, not traced
      into the dashboard's standalone output), though both sit in the API image, which copies
      the whole install including dev dependencies. Close each when its parent ships a release
      whose range allows the fix, never with an override. (2026-11-08)
- [x] EU data residency: finished. Storage Brain's objects rest in the EU-jurisdiction
      Cloudflare R2 bucket `storage-brain-files-eu`, and the pre-EU bucket and its rollback
      are gone. The soak (a week of production traffic on the new bucket with the old one
      kept, ended 2026-09-27) closed with a final comparison on 2026-10-12: all 2052 objects
      of the old bucket present in the EU bucket at identical size and checksum
      (3560872814 bytes), none only in the old one, no write to the old bucket since before
      the cutover. On Marlin's go of 2026-10-12 the three things that were one rollback went
      in one pass: the Cloudflare token `storage-brain-hetzner`, the
      `AWS_ACCESS_KEY_ID_PRE_EU` / `AWS_SECRET_ACCESS_KEY_PRE_EU` pair in Infisical, and the
      `storage-brain-files` bucket. The EU bucket is now the only copy. Production keeps
      running on the account-wide R2 key (decided 2026-09-20, Marlin's call; do not re-open
      this as a finding). The privacy texts of the consuming projects may now claim EU
      storage; changing them is those projects' work (ŌPUNTIA's needs a new consent version).
      [plan](docs/plans/2026-09-20-eu-data-residency.md) (2026-10-12)
- [ ] auth-brain cutover residuals: revoke lola-stories' legacy Storage Brain tenant key after
      a soak period, delete the dead `8263***` client secret on the Lumitra secrets-proxy
      Infisical identity, and visually confirm the dashboard Tenants page lists all 5 tenants
      in prod [notes](backlog/intents/storage-brain-authbrain-cutover-residuals.md) : needs
      Marlin, all three are production or secret actions only he can do; the fourth sub-item
      in the note (auth-brain #41's push.ts fix) is already merged (2026-07-16) Reviewed 2026-11-12, kept open and NOT verified: the current status of lola-stories' legacy tenant key and of the dead client secret is unknown (the 2026-11-07 Lola teardown may already have retired them), so this needs an investigation before any revoke; no production or secret action was taken (2026-11-12)
- [ ] tenant-scope rebinding: issue the tenant-scoped service-account key for lola-stories in
      auth.lumitra.co, store it in the lola-stories Infisical project, redeploy, then revoke
      the old workspace-scoped key plus one unused orphaned key
      [plan](docs/plans/2026-08-13-tenant-scope-rebinding.md) : code side is shipped (the
      `authTenantId` route accepts it); only this operator cutover is left, needs Marlin
      because it is a production/secret action Reviewed 2026-11-12, kept open and NOT verified: whether the old workspace-scoped key and the orphaned key still exist, and whether lola-stories still uses a key at all after the 2026-11-07 teardown, is unknown and needs an investigation before any revoke; no production or secret action was taken (2026-11-12)
- [x] company isolation: the 361 orphaned `kie-input` files (371 MB) in lola-stories' tenant,
      produced only by lumitra-studio during a 2026-06 borrowed-key window, were cleaned up on
      2026-08-09. Marlin answered "delete all of them except one distinct file of each", so
      348 files were deleted and 13 kept (one copy of each distinct reference image), which
      reclaimed 354 MB and took the tenant from 1.33 GB to 1005 MB used. The deletes went
      through the single-file delete route only after pull request #23 (delete the stored
      object and release quota, where it used to only flag the row) was merged and deployed the
      same day, so the objects are really gone. Evidence is the executing session's own staged
      selection, deletion log (319 of 319 paced deletes after 29 earlier ones, no failures) and
      the closing count of exactly 13 undeleted `kie-input` rows in that tenant; this
      repository recorded none of it until this line, and the plan's reality update of
      2026-09-10 still said "not yet acted on".
      [plan](docs/plans/2026-07-27-company-isolation.md) (2026-10-10)
- [ ] permanent-URL revocation: design a per-file revocation token for `getPermanentUrl`,
      since today revocation is only whole-tenant, not per-file
      [notes](backlog/intents/storage-brain-permanent-url-revocation-all-or-nothing.md) :
      needs Marlin's product/design sign-off, changes the SDK's public contract and needs a
      migration story for existing permanent URLs; note the all-tenants-at-once blast radius
      this note originally described is already narrowed to per-tenant (per-tenant HKDF key
      derivation shipped as part of company isolation S3), so what remains open is per-file
      granularity specifically Reviewed 2026-11-12: no per-file revocation token exists in the code, still open (2026-11-12)
- [ ] The tenant quota counter can drift from the files table, and nothing reconciles it:
      on 2026-11-06 the `lumitra-studio` tenant (shared by every Studio company, 2,382
      files) read 8.913 GB used while its files table summed 9.636 GB, and the counter was
      what refused Studio's uploads when the quota filled (164 failed jobs that day). The
      investigation of that day found Studio is NOT the cause: Studio's calls declare the
      exact byte size, so under the reconcile logic below its uploads keep counter and table
      consistent. Storage Brain already settles each NEW upload exactly (the fix of
      2026-09-26, #35: the declared size is reserved atomically, completion replaces the
      reservation with the stored bytes by adjusting the counter by the difference, a
      failed or expired upload releases its reservation, a 5-minute sweep reclaims stale
      sessions, and deletes release in the same transaction). What is still missing is a
      reconciliation: `recalculateQuota` (postgres.ts and d1.ts) exists but is never called
      at runtime, so (a) drift accumulated before #35 (or before its deploy) is never
      repaired, and (b) any future divergence (a bug, a manual database edit, an admin
      tenant repoint) has no self-healing. Fix: run `recalculateQuota` once per tenant as
      an ops backfill (it sets used_bytes to the sum of the live files, which also repairs
      the 8.913 vs 9.636 GB gap), and schedule it periodically (daily) so the counter
      self-corrects. (2026-11-06)
- [x] file deletes never fail silently, and a purge sweeper closes the gap: every delete path
      now records whether the storage object is really gone (`purged_at`), logs a failed R2/S3
      delete instead of swallowing it, and leaves such rows unpurged for a sweeper that retries
      them in bounded batches and raises exactly one operator alert per object that keeps
      failing (admin API lists and acknowledges them, SDK methods added). The delete paths
      changed are the tenant file delete, the admin per-file delete, the workspace bulk delete
      and the internal upload route; the R2 upload-complete webhook already logged its delete
      failures. The HTTP contract of `DELETE /files/:id` is unchanged (row deleted, quota
      released), so Studio's transaction-and-rollback handling keeps working. First production
      sweep and orphan report numbers are in the pull request that shipped this. (2026-11-06)

## Planned

- [ ] automated key rotation: end-to-end automated key rotation with dual-key grace period,
      Infisical push, and Coolify auto-redeploy
      [plan](docs/plans/2026-04-06-automated-key-rotation.md) : phases 2 to 5 are written on
      branch `feat/key-rotation-pipeline` (commit 9bd60ec, 2026-04-06, only local until
      2026-09-25). Not merged: it needs a rebase onto main, its migrations renumbered to
      0009/0010 (0004/0005 are taken), 9 conflicting files resolved, and a fresh security
      review before a pull request (2026-10-26)
- [ ] bring your own S3 bucket: per-tenant S3/R2/GCS bucket configuration for data sovereignty
      and cost isolation [plan](docs/plans/2026-04-06-bring-your-own-s3.md) : still wanted,
      not started Reviewed 2026-11-12: the plan is still a draft and no per-tenant bucket configuration exists in the code, still open (2026-11-12)
- [x] upload body size limit: `packages/api/src/routes/internal-upload.ts` buffered the whole
      request body (`c.req.arrayBuffer()`) without enforcing the 100 MB `MAX_FILE_SIZE_BYTES`;
      only the size declared when the upload is requested was checked, so an oversized or
      lying client could exhaust the container's memory. Shipped: the upload body is refused
      unread (413) on a `Content-Length` above the maximum or the declared size and is counted
      while streaming and cut off at that limit, and every other route (JSON API, signed
      webhooks) is capped at 1 MB by `hono/body-limit` (2026-09-26)
- [x] undeclared upload size skips quota: an upload requested without `fileSizeBytes`
      reserved no quota and the real size was never reconciled with the reservation.
      Shipped: `fileSizeBytes` is required (400 otherwise); the declared size is reserved
      atomically with the file and session; each session is settled exactly once (stored bytes
      replace the reservation, a failed, cut-off or expired upload releases it, a 5-minute sweep
      reclaims stale sessions); deletes release and close sessions in the same transaction
      (2026-09-26)
- [x] orphaned objects after a crash mid-upload: when a server process dies after writing an
      upload's object but before settling its session, the expiry sweep reclaims the quota
      after the one-hour grace period, but the object already written to storage stays behind,
      uncounted in any quota and attached only to a failed zero-byte file record. Shipped
      (2026-11-06 report half, 2026-11-07 deletion half): the orphan sweep lists storage keys
      without any file row, older than 24 hours, with sizes, and deletes them (age-gated and
      row-gated). Marlin approved deletion on 2026-11-07 after the report showed 0 orphans on
      production. (2026-11-07)

## Completed

- **Dashboard auth via auth-brain (slice 2A)** [plan](docs/plans/2026-06-16-storage-brain-auth-brain-dashboard-session.md): dashboard humans authenticate via auth-brain's `lumitra_session`, with the legacy admin-key login kept as a fallback.
- **Dashboard upload UI (slice 3)** [plan](docs/plans/2026-06-16-storage-brain-dashboard-upload-ui.md): dropzone/dialog upload flow wired to a new admin-scoped upload-request endpoint.
- **Machine auth via auth-brain service-account keys (slice 2B)** [plan](docs/plans/2026-06-17-storage-brain-machine-key-auth.md): the API worker accepts auth-brain-issued keys for machine callers, alongside the legacy tenant key path.
- **2026-09-11 incident fix** - The S3 client (`packages/api/src/adapters/storage/s3.ts`) had
  no request timeout, so a hung connection to R2 (Cloudflare's S3-compatible object storage
  backend) never freed its socket. Every download queued behind the wedged pool
  (`@smithy/node-http-handler:WARN - socket usage at capacity=50 and 691 additional requests
  are enqueued`, growing with no completions), breaking every image load across every product
  on Storage Brain until the container was restarted. Fixed: a shared `NodeHttpHandler` with a
  5s connection timeout, 30s request timeout, and 300-socket cap, so a hung request now fails
  and frees its socket instead of blocking forever.
- **v0.5.0** - Multi-tenant workspaces, workspace quotas, workspace-scoped file listing
- **v0.4.0** - Removed processing pipeline (OCR, thumbnails) - Storage Brain is now storage-only
- **v0.3.0** - Self-hosting with Docker, S3 + Postgres adapters, admin SDK
- **v0.2.0** - TypeScript SDK (`@marlinjai/storage-brain-sdk`), presigned URL uploads
- **v0.1.0** - Initial release: multi-tenant file storage on Cloudflare R2 + D1

## Archived

- **Per-Workspace API Keys** [plan](docs/plans/2026-04-06-per-workspace-api-keys.md): superseded by the company-isolation plan's company-scoped key model.
