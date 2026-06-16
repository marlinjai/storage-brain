---
type: plan
status: draft
title: "Spec: Storage Brain dashboard upload UI (slice 3)"
summary: "Add an upload UI (dropzone + dialog, progress, cancel, unhappy-path handling) to the Storage Brain dashboard files page. Requires a new admin-scoped upload-request endpoint on the API (the admin SDK has no upload path today), so the dashboard uploads with the admin credential it already holds and never touches tenant keys. Independent of auth-brain."
date: 2026-06-16
tags: [storage-brain, dashboard, upload, ui]
projects: [storage-brain]
---

# Spec: Storage Brain dashboard upload UI (slice 3)

Parent plan: `auth-brain/docs/superpowers/plans/2026-06-16-centralized-api-keys-and-storage-brain-upload.md`.
This is **slice 3**, the original ask: upload files to buckets from the dashboard. Sequenced
after slice 2A (shared `migrations`/`lockfile` state + both touch the admin SDK and dashboard),
but **functionally independent of auth-brain** — it works under whichever dashboard auth mode is
active, using the existing admin credential.

## The core problem this slice solves

The dashboard authenticates as ADMIN and calls the API via `getAdmin()` (`StorageBrainAdmin`).
But `StorageBrainAdmin` has **no upload method**, and `POST /api/v1/upload/request` is a
TENANT-scoped route requiring a tenant API key. So there is no way for the dashboard to upload
today. Two ways to fix it:

- (A, CHOSEN) Add an **admin-scoped upload-request endpoint** + admin SDK method. The dashboard
  uploads with the admin credential it already has. Clean admin boundary, no tenant-key exposure.
- (B, REJECTED) Fetch/mint the tenant's own API key into the dashboard and use the tenant SDK.
  Leaks a tenant credential into the dashboard for no benefit.

## Design decisions

1. **Admin upload-request endpoint** `POST /api/v1/admin/tenants/:tenantId/upload/request`
   (admin-key authed, sibling of the existing admin `listTenantFiles`/`deleteTenantFile`). It
   runs the SAME validation as the tenant route: allowed-MIME check, `MAX_FILE_SIZE_BYTES`,
   tenant quota (`checkQuota`), workspace existence + workspace quota. Returns
   `{ fileId, presignedUrl, expiresAt, uploadMetadata }`. To avoid drift, EXTRACT the shared
   logic from `packages/api/src/routes/upload.ts` into a helper (e.g.
   `lib/upload/request-upload.ts`) and call it from BOTH the tenant route and the new admin route
   (tenant resolved by key vs by path param). Do not copy-paste the checks.
2. **Admin SDK method** `requestTenantUpload(tenantId, { fileName, fileType, fileSizeBytes, context?, tags?, workspaceId?, webhookUrl? })` on `StorageBrainAdmin` (`packages/sdk/src/admin.ts`), returning the handshake.
3. **The byte upload is browser-direct to the presigned URL** with `XMLHttpRequest` for progress
   and an `AbortSignal` for cancel (mirror `StorageBrain.uploadToPresignedUrl` in
   `packages/sdk/src/client.ts`). This avoids streaming up to 100MB through the Next server.
   The presigned URL points at the API's `PUT /_internal/upload/:storedPath` (HMAC-token authed,
   no key needed). REQUIREMENT: that internal route must allow CORS for the dashboard origin
   (add the dashboard origin to its CORS config). If CORS proves impractical, fall back to a
   dashboard server proxy route that streams the bytes — but prefer browser-direct.
4. **Dashboard route** `POST /api/tenants/[id]/upload/request` (Next handler) validates the body
   against `requestUploadSchema`, calls `admin.requestTenantUpload(id, body)`, returns the
   handshake. Same try/catch + `getAdmin()` + 401-on-"Not authenticated" pattern as the existing
   `files` route. Map API errors (400/403/404/410/413) to the response so the UI can render them.

## UI

New `packages/dashboard/src/components/files/UploadDialog.tsx`, opened from an "Upload" button
in the files page header (`src/app/(dashboard)/tenants/[tenantId]/files/page.tsx`, the header bar
beside the grid/list toggle). Follow the existing modal/form conventions (`ConfirmModal.tsx`,
`CreateTenantModal.tsx`): backdrop `bg-black/60`, box `border-gray-800 bg-gray-900`, inputs
`bg-gray-800 border-gray-700`, primary `bg-blue-600`, error box `border-red-800 bg-red-900/30`.

The dialog:
- Drag-and-drop zone + file picker (multi-file allowed; upload sequentially or in parallel with
  per-file progress rows).
- **Workspace selector** (fetch `/api/tenants/[tenantId]/workspaces` -> `listTenantWorkspaces`),
  optional, plus an optional **context** text field and tags.
- Per-file **progress bar** (no existing component: bar `h-2 bg-gray-800 rounded-full`, fill
  `bg-blue-600 transition-all` by `%`) and a **cancel** button (fires the `AbortSignal`).
- On success, refresh the files list (the `useFiles` SWR key) so the new file appears.

## Unhappy paths (all must surface to the user, never swallow)

| Case | API | UI message |
|------|-----|-----------|
| Disallowed MIME | 400 `INVALID_FILE_TYPE` | "File type '<x>' is not allowed for this tenant." |
| Too large | 400 `FILE_TOO_LARGE` (>100MB) | "File exceeds the 100 MB limit." |
| Tenant quota | 403 `QUOTA_EXCEEDED` | "Storage full: <used>/<quota>." |
| Workspace quota | 403 `QUOTA_EXCEEDED` | same, workspace-scoped |
| Workspace missing | 404 | "Selected workspace no longer exists." |
| Presigned expired mid-upload | 410 | auto re-request a fresh handshake once, then retry; if it fails again, surface it |
| Network / aborted | (client) | "Upload failed, check your connection and retry" / "Upload canceled." |

Validate client-side BEFORE requesting the handshake where cheap (size, obvious MIME) so the
common rejections are instant, but the server checks remain authoritative.

## Files

New:
- `packages/api/src/lib/upload/request-upload.ts` (shared handshake logic)
- `packages/api/src/routes/admin/...` upload-request route (or extend `routes/admin.ts`)
- `packages/dashboard/src/components/files/UploadDialog.tsx`
- `packages/dashboard/src/app/api/tenants/[id]/upload/request/route.ts`
- spec/co-located `*.spec.ts`

Edit:
- `packages/api/src/routes/upload.ts` (call the shared helper; behavior unchanged)
- `packages/api/src/routes/internal-upload.ts` (CORS for the dashboard origin)
- `packages/api/src/app.ts` (register the admin upload route)
- `packages/sdk/src/admin.ts` (`requestTenantUpload`)
- `packages/dashboard/.../files/page.tsx` (Upload button + dialog wiring; refresh on success)

## Tests (vitest; mock DB + storage, `app.request(...)`)

- Admin upload-request route: success returns a handshake; each error case (invalid type, too
  large, tenant quota, workspace missing, workspace quota) maps to the right status. Admin auth
  required (401 without admin key).
- Shared helper: tenant route and admin route produce identical validation results for the same
  inputs (guard against drift).
- SDK `requestTenantUpload`: shapes the request + parses the handshake (mock fetch).
- Dashboard route: 401 when unauthenticated, forwards body + maps errors.
- UploadDialog: progress updates from a mocked XHR, cancel aborts, error states render.

## Out of scope

- auth-brain service-account-key auth on the worker (deferred slice).
- Per-tenant `can()` filtering (deferred).
- Physical centralization (workstream 4).
- Resumable/multipart uploads for >100MB (the limit stays 100MB; document it, do not raise it).
