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

- [ ] EU data residency: the cutover is DONE and verified (2052 objects copied, production
      serving from `storage-brain-files-eu`, Terraform import done and the plan clean). What
      remains is the **soak**, which is simply a week of real production traffic on the new
      bucket with the old one left intact so a rollback stays one edit away. It is not a
      process running anywhere, it is elapsed time with attention on it. **It ends
      2026-09-27** (cutover was 2026-09-20). Three things must hold before the cleanup:
      no storage errors from any Storage Brain consumer, the EU bucket's object count still
      growing (2052 at cutover, 2070 within hours, so production writes really land there),
      and a last comparison showing every object of the old bucket exists in the new one at
      the same size. Then, in **one pass and only on Marlin's explicit go**, three things go
      together because they are one rollback: the `storage-brain-files` bucket, the
      `AWS_ACCESS_KEY_ID_PRE_EU` / `AWS_SECRET_ACCESS_KEY_PRE_EU` pair in Infisical, and the
      Cloudflare token `storage-brain-hetzner` that was scoped to that bucket.
      [plan](docs/plans/2026-09-20-eu-data-residency.md) : the privacy texts can claim EU
      storage only after the soak (ŌPUNTIA's needs a new consent version when they do).
      Decided 2026-09-20: production keeps running on the account-wide R2 key, Marlin's call,
      so `R2_MIGRATION_ACCESS_KEY_ID` / `R2_MIGRATION_SECRET_ACCESS_KEY` stay and no
      bucket-scoped replacement is planned; do not re-open this as a finding (2026-09-20)
- [ ] auth-brain cutover residuals: revoke lola-stories' legacy Storage Brain tenant key after
      a soak period, delete the dead `8263***` client secret on the Lumitra secrets-proxy
      Infisical identity, and visually confirm the dashboard Tenants page lists all 5 tenants
      in prod [notes](backlog/intents/storage-brain-authbrain-cutover-residuals.md) : needs
      Marlin, all three are production or secret actions only he can do; the fourth sub-item
      in the note (auth-brain #41's push.ts fix) is already merged (2026-07-16) (2026-09-10)
- [ ] tenant-scope rebinding: issue the tenant-scoped service-account key for lola-stories in
      auth.lumitra.co, store it in the lola-stories Infisical project, redeploy, then revoke
      the old workspace-scoped key plus one unused orphaned key
      [plan](docs/plans/2026-08-13-tenant-scope-rebinding.md) : code side is shipped (the
      `authTenantId` route accepts it); only this operator cutover is left, needs Marlin
      because it is a production/secret action (2026-09-10)
- [ ] company isolation: delete 361 orphaned `kie-input` files (371 MB) in lola-stories'
      tenant, produced only by lumitra-studio during a 2026-06 borrowed-key window
      [plan](docs/plans/2026-07-27-company-isolation.md) : deletion is irreversible, needs
      Marlin's go; every other slice of this plan (company-scoped keys, webhook signing,
      per-tenant URL key derivation, the erasure webhook, the rate-limit fix) already shipped
      (2026-09-10)
- [ ] permanent-URL revocation: design a per-file revocation token for `getPermanentUrl`,
      since today revocation is only whole-tenant, not per-file
      [notes](backlog/intents/storage-brain-permanent-url-revocation-all-or-nothing.md) :
      needs Marlin's product/design sign-off, changes the SDK's public contract and needs a
      migration story for existing permanent URLs; note the all-tenants-at-once blast radius
      this note originally described is already narrowed to per-tenant (per-tenant HKDF key
      derivation shipped as part of company isolation S3), so what remains open is per-file
      granularity specifically (2026-09-10)

## Planned

- [ ] automated key rotation: end-to-end automated key rotation with dual-key grace period,
      Infisical push, and Coolify auto-redeploy
      [plan](docs/plans/2026-04-06-automated-key-rotation.md) : phases 2 to 5 are written on
      branch `feat/key-rotation-pipeline` (commit 9bd60ec, 2026-04-06, only local until
      2026-09-25). Not merged: it needs a rebase onto main, its migrations renumbered to
      0009/0010 (0004/0005 are taken), 9 conflicting files resolved, and a fresh security
      review before a pull request (2026-09-25)
- [ ] bring your own S3 bucket: per-tenant S3/R2/GCS bucket configuration for data sovereignty
      and cost isolation [plan](docs/plans/2026-04-06-bring-your-own-s3.md) : still wanted,
      not started (2026-09-10)
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
- [ ] orphaned objects after a crash mid-upload: when a server process dies after writing an
      upload's object but before settling its session, the expiry sweep reclaims the quota
      after the one-hour grace period, but the object already written to storage stays behind,
      uncounted in any quota and attached only to a failed zero-byte file record. Needs an
      orphan sweep that lists storage keys without an active completed file row (or writes a
      pre-write intent record) and deletes them after a grace period (2026-09-26)

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
