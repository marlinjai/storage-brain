---
title: Move Storage Brain's objects into the EU jurisdiction
type: plan
status: completed
date: 2026-09-20
summary: Storage Brain keeps every project's uploaded files in an R2 bucket created without a jurisdiction, so Cloudflare may hold them anywhere. This moves them to an EU-jurisdiction bucket, which every project that stores files through Storage Brain inherits, and lets their privacy policies say the files rest in the EU.
tags: [storage, r2, gdpr, data-residency, cloudflare]
projects: [storage-brain, email-editor, opuntia-website, lumitra-studio, receipt-ocr-app, data-table]
---

# Move Storage Brain's objects into the EU jurisdiction

## Why

Storage Brain is the file layer for the whole suite: mail images, receipts,
Studio renders, Data Table attachments. Its production bucket,
`storage-brain-files`, was created without a jurisdiction, so Cloudflare may
keep those objects in any region. Every project storing files through it
inherits that, and each of their privacy policies has to say so.

This surfaced on 2026-09-19 reviewing the Lumitra Mail landing page, whose copy
claimed "hosted in the EU, on servers we run ourselves at Hetzner in Germany"
while images sat in R2. The landing page and ŌPUNTIA's privacy policy were both
corrected to name Cloudflare. Correcting the text was right; the better end
state is that the bytes actually rest in the EU, which is what Marlin asked for
on 2026-09-20: "every project using Storage Brain needs to go to EU".

The analytics platform was meant to do this already: `deployments/lumitra-replay-assets`
has described an EU-jurisdiction bucket since 2026-06. Correction (2026-09-20):
that bucket had never actually been created, so the replay-asset pipeline was
pointing at nothing. It was created, imported into Terraform and given its
public custom domain on 2026-09-20, in the same sweep as this migration.

## What is true today (verified 2026-09-20)

- Production Storage Brain is **not** a Cloudflare Worker. `packages/api/src/node.ts`
  runs on Coolify (`api.storage-brain.lumitra.co`) and reaches storage over the
  S3 protocol with `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` and the AWS keys from
  Infisical (project `86dcae14-6cb2-473b-8b2d-43b37977f04e`, env `production`).
  `packages/api/wrangler.toml` with its `BUCKET` binding is the older Workers
  path and is not what serves production.
- The endpoint is the **default-jurisdiction** R2 host
  (`<account>.r2.cloudflarestorage.com`), the bucket is `storage-brain-files`,
  the region is `auto`. Checked through the secrets proxy, as a class test, so
  no credential was printed.
- The bucket holds **2052 objects, 3.4 GB**, largest object 40 MB, all under one
  top-level prefix. A copy is minutes, not hours.
- Consumers never name the bucket: they call Storage Brain's HTTP API with an
  API key and get back `/a/<id>`-style URLs. **No consumer needs a change**, which
  is why one migration moves every project at once.

## The constraint

R2 cannot change a bucket's jurisdiction in place, and cannot server-side copy
across jurisdictions. EU residency therefore means: a new bucket, a copy of
every object, a repointed service, and the old bucket deleted afterwards.

## What happened (2026-09-20)

Steps 1 to 5 are done and verified in production. What is left is the soak and
the deletion of the old bucket.

- No Cloudflare API token in Infisical carries R2 permissions (all three answer
  403 on `/accounts/<id>/r2/buckets`), so Terraform could not create the bucket.
  Marlin minted an R2 Admin Read and Write key instead; it went into the Storage
  Brain project as `R2_MIGRATION_ACCESS_KEY_ID` and
  `R2_MIGRATION_SECRET_ACCESS_KEY`.
- `storage-brain-files-eu` was created over the S3 API against the EU endpoint.
  Terraform (infra PR #42) must `terraform import` it rather than create it.
- All 2052 objects were copied and verified twice: identical object count,
  identical total bytes (3560872814) and zero ETag mismatches. The delta pass
  immediately before the cutover found nothing to copy.
- The app's own key was bucket-scoped to `storage-brain-files`, so it could not
  have reached the new bucket. `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
  in `production` now hold the account-wide key, copied inside Infisical with
  `copy_secret` so no value was ever read. **The previous values are backed up
  as `AWS_ACCESS_KEY_ID_PRE_EU` and `AWS_SECRET_ACCESS_KEY_PRE_EU`**, which is
  what a rollback restores.
- `S3_BUCKET` and `S3_ENDPOINT` were switched to the EU bucket and the `.eu.`
  host, and the API was redeployed on Coolify (deployment
  `lm2j718z2hirff7b81twbhnz`, 68 seconds).
- Verified live: `/health` 200; an upload through the admin handshake landed in
  the EU bucket and not in the old one (2053 against 2052, back to 2052 after
  the throwaway tenant was deleted); a pre-migration file downloaded through the
  service with exactly its recorded size (52815 bytes).

**Rollback**, if anything surfaces during the soak: restore `AWS_ACCESS_KEY_ID`
and `AWS_SECRET_ACCESS_KEY` from their `_PRE_EU` copies, set `S3_BUCKET` back to
`storage-brain-files` and `S3_ENDPOINT` back to the default host, redeploy. The
old bucket is untouched and still holds every object.

## Reality update (2026-10-12): the old bucket is deleted, the plan is complete

Step 6 is done. Marlin gave the explicit go on 2026-10-12, and the three things
that were one rollback went in one pass, in this order.

**The final comparison** (run through the secrets proxy, listing both buckets
with the production key):

| | Old `storage-brain-files` | New `storage-brain-files-eu` |
|---|---|---|
| Objects | 2052 | 3349 |
| Bytes | 3560872814 | 7237010717 |
| Newest object | 2026-09-20 08:54 UTC | 2026-10-11 22:49 UTC |

- Only in the old bucket: 0.
- In both: 2052, with zero size mismatches and zero ETag (the storage checksum)
  mismatches, and identical bytes on both sides.
- Only in the new bucket: 1297 objects, 3676137903 bytes, every one dated after
  the cutover (earliest 2026-09-20 10:34 UTC).
- The old bucket's newest object predates the first object of the EU bucket
  (2026-09-20 10:07 UTC), and its count was still the 2052 of the cutover: nothing
  wrote to it during the soak. It had no incomplete multipart uploads.
- In the Cloudflare dashboard the old bucket had no public `r2.dev` access, no
  custom domain, no event notification rule and no Worker bound to it, and the
  EU bucket has the same settings (only the default rule that aborts incomplete
  multipart uploads after seven days).

**What was removed:**

1. The Cloudflare account API token `storage-brain-hetzner` (issued 2026-04-04,
   scoped to the old bucket only). Afterwards the `_PRE_EU` pair answered 401 on
   both buckets, the production key still listed the EU bucket, `/health` 200.
2. `AWS_ACCESS_KEY_ID_PRE_EU` and `AWS_SECRET_ACCESS_KEY_PRE_EU` in Infisical
   (`production`, path `/`), with the secrets proxy's `delete_secret`. The four
   live keys (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`,
   `S3_ENDPOINT`) were confirmed still present by name.
3. The bucket `storage-brain-files`: 2052 objects deleted in three batches with
   no errors, then the bucket itself. It now answers `NoSuchBucket`.

**Proof afterwards:** the EU bucket held the same 3349 objects and 7237010717
bytes as before the deletion; `/health` 200; three pre-migration files (dated
2026-04-08, 2026-07-24 and 2026-09-20) downloaded through the API at exactly
their recorded sizes (269986, 1384257 and 5067205 bytes); a test upload through
the admin handshake on a throwaway tenant landed in the EU bucket, downloaded
byte-identical, and was removed again together with the tenant.

**There is no rollback any more.** The EU bucket is the only copy, with no
versioning and no second bucket, which is the same single-copy posture as before
2026-09-20. Production keeps running on the account-wide R2 key (decided
2026-09-20, Marlin's call), so `R2_MIGRATION_ACCESS_KEY_ID` and
`R2_MIGRATION_SECRET_ACCESS_KEY` stay.

**Two caveats, recorded so nobody takes the soak for more than it was:**

- **No service logs for 2026-09-20 to 2026-09-26.** Coolify keeps logs only for
  the running container, and the service was redeployed four times on
  2026-09-26. The logs that exist (2026-09-26 13:43 UTC to 2026-10-11, 210910
  lines) show no 5xx response and no storage error across 7518 successful
  upload, download and file requests. For the first six days the evidence is
  indirect: objects kept landing in the EU bucket on five of those days.
- **Cloudflare Pages bindings were not readable.** The dashboard's listing call
  for Pages projects answered 400, so a Pages project bound to the old bucket
  could not be ruled out that way. No Worker had such a binding, and no code in
  any repository names the bucket.

**Also tidied in the same pull request:** `packages/api/wrangler.toml` no longer
names the deleted bucket (the binding stays for local `wrangler dev` under a
local-only name), and the `deploy` scripts for the Worker are gone, because no
Worker is deployed and production is the Node service on Coolify.

**Step 7, the texts, is now unblocked and is not part of this repository.** The
Lumitra Mail landing page and ŌPUNTIA's privacy policy may say the files rest in
the EU; ŌPUNTIA's needs a new consent version when it does.

## Steps

1. **The bucket.** `deployments/storage-brain/r2.tf` in the infra repository:
   `cloudflare_r2_bucket` `storage-brain-files-eu`, `jurisdiction = "eu"`, with
   outputs for the name, the jurisdiction and the EU S3 endpoint
   (`https://<account>.eu.r2.cloudflarestorage.com`, which is the only host an
   EU bucket answers on). `terraform fmt` and `validate` pass.
2. **Credentials.** Check whether the existing R2 access key reaches the new
   bucket (an account-scoped R2 token does; a bucket-scoped one does not). If it
   does not, mint a token scoped to both buckets for the migration, and store it
   in Infisical through the secrets proxy so the value never appears anywhere
   else.
3. **Copy.** Stream every object old to new with its content type and metadata,
   from the secrets proxy (boto3 is available there, and the credentials are
   injected server-side). Verify by count, by total bytes and by comparing each
   object's ETag.
4. **Second pass.** Repeat the copy for anything written since the first pass,
   immediately before the cutover, so nothing uploaded meanwhile is left behind.
5. **Cutover.** Change `S3_BUCKET` and `S3_ENDPOINT` in Infisical
   (`production`), redeploy the Storage Brain API on Coolify, then verify: a
   fresh upload lands in the EU bucket, an old file still downloads, and a
   consumer that reads through the API (the mail service's `/a/<id>`) still
   serves bytes. Rollback is the reverse edit and a redeploy, which is why the
   old bucket stays untouched until the soak passes.
6. **Soak, then delete.** Leave the old bucket read-only-in-practice for a week.
   Deleting it is destructive and irreversible, so it happens only on Marlin's
   explicit go, after a last comparison shows the EU bucket holds everything.
7. **The texts.** Once the objects are EU-resident, the Lumitra Mail landing
   page and ŌPUNTIA's privacy policy can say so. ŌPUNTIA's policy is a consent
   document: changing its substance needs a new `CONSENT_V5`, per the rule in
   `lib/forms/consent.ts`. Do not touch those texts before the cutover has
   soaked, or they describe a state that does not exist yet.

## Open

- Whether to also give the EU bucket a custom domain, as the replay assets have
  (`replay-assets.lumitra.co`). Not needed: Storage Brain streams bytes through
  its own API and never hands a bucket URL to a browser.
- Lifecycle rules and versioning on the new bucket were not carried over,
  because the old bucket has none.
