---
type: plan
status: done
title: "Spec: Storage Brain dashboard auth via auth-brain session (slice 2A)"
summary: "Dashboard humans authenticate via auth-brain's lumitra_session + verifySession + can(platform.admin), with the legacy admin-key iron-session kept as a transitional fallback. Backend API credential moves to a server-side env var. Adds the auth_workspace_id tenant binding as plumbing for future per-tenant authz. Machine/service-account-key auth on the API worker is explicitly deferred."
date: 2026-06-16
tags: [storage-brain, auth-brain, dashboard, session, openfga]
projects: [storage-brain, auth-brain]
---

# Spec: Storage Brain dashboard auth via auth-brain (slice 2A)

Parent plan: `auth-brain/docs/superpowers/plans/2026-06-16-centralized-api-keys-and-storage-brain-upload.md`.
This is **slice 2, scoped to dashboard auth only** (decided 2026-06-16). It unblocks slice 3
(the dashboard upload UI). Depends on slice 1 (auth-brain service-account keys, merged PR #35),
though this slice consumes only `verifySession` + `can()` from the auth-brain SDK, not the new
key surface.

## What this slice does / does not do

- **Does:** the Storage Brain dashboard recognizes an auth-brain `lumitra_session`, verifies it,
  and gates access on `can(user, 'platform.admin', platform)`. Keeps the existing admin-key
  iron-session login working as a transitional fallback (hybrid). Moves the dashboard's backend
  API credential to a server-side env var for the auth-brain path. Lays down the
  `auth_workspace_id` tenant binding.
- **Does NOT:** add service-account-key (`verifyApiKey`) auth to the Cloudflare Worker API
  (deferred to a later slice — a `tenant_group`/`tenant`-scoped key spanning multiple SB tenants
  needs its own target-resolution decision). Does NOT rip out the legacy `api_key_hash` tenant
  path. Does NOT do the upload UI (slice 3) or physical centralization (workstream 4).

## Why the backend credential moves to env

Today the user types an admin key at `/login`; it is stored in the `sb-dashboard` iron-session
and used for every dashboard→API call (`packages/dashboard/src/lib/sdk.ts` `getAdmin()`). With
auth-brain login the user no longer supplies a key. So the dashboard **server** holds its own
`STORAGE_BRAIN_ADMIN_KEY` + `STORAGE_BRAIN_URL` (env, server-only, never sent to the client),
and auth-brain governs *which humans* may drive it. This is strictly more correct: a shared
secret typed into a form becomes a deployment secret gated by real identity.

## Auth model (hybrid, fail-closed)

A single helper `getDashboardSession()` (new, `packages/dashboard/src/lib/dashboard-auth.ts`)
resolves, in order:
1. `lumitra_session` cookie present → `authBrainClient.verifySession(cookie)`. If valid AND
   `can(user.id, 'platform.admin', { /* platform */ })` is true → `{ mode: 'auth-brain', user }`.
   If the session is valid but `can()` is false → treat as unauthorized (fail-closed): the user
   is logged in but not allowed into this admin tool.
2. else `sb-dashboard` iron-session with an `adminApiKey` → `{ mode: 'legacy', adminApiKey, baseUrl }`.
3. else `null`.

`getAdmin()` (edit `sdk.ts`) builds the `StorageBrainAdmin` client by mode:
- `auth-brain` → `new StorageBrainAdmin({ adminApiKey: env.STORAGE_BRAIN_ADMIN_KEY, baseUrl: env.STORAGE_BRAIN_URL })`
- `legacy` → from the iron-session values (unchanged).
- `null` → throw the existing unauthorized error.

Middleware (`packages/dashboard/src/middleware.ts`): allow the request through if EITHER
`lumitra_session` OR `sb-dashboard` cookie is present; otherwise redirect to `/login`. Deep
verification (verifySession + can) happens in `getDashboardSession()` at the route/page layer,
not in edge middleware (keeps the `can()`/verify fetch out of every static asset request).

`/login` page: add an "Sign in with Lumitra" button that redirects to
`${AUTH_BRAIN_URL}/login?return_to=${thisDashboardUrl}`, alongside the existing admin-key form
(kept as fallback). Logout clears both `lumitra_session` (best-effort) and `sb-dashboard`.

## auth_workspace_id binding (plumbing, additive)

One auth-brain workspace per Storage Brain tenant. Nullable, so existing tenants are unaffected.

- Migration `packages/api/migrations/0005_auth_workspace_id.sql`:
  ```sql
  ALTER TABLE tenants ADD COLUMN auth_workspace_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_tenants_auth_workspace ON tenants(auth_workspace_id);
  ```
  (D1/SQLite: no inline FK on ALTER; treat as a logical reference. Keep nullable.)
- `packages/shared/src/types.ts`: add `authWorkspaceId: string | null` to `Tenant`.
- `packages/shared/src/database-adapter.ts`: add `authWorkspaceId?: string` to
  `CreateTenantInput`, `authWorkspaceId?: string | null` to `UpdateTenantInput`.
- `packages/api/src/adapters/database/d1.ts`: `mapTenantRow()` reads `auth_workspace_id`;
  `createTenant()`/`updateTenant()` persist it; add `getTenantByAuthWorkspaceId(id)` (returns
  `Tenant | null`) for future use.
- Storage Brain admin SDK (`@marlinjai/storage-brain-sdk`): thread `authWorkspaceId` through the
  create/update tenant calls (additive optional field).
- Dashboard tenant create/edit form: optional `auth_workspace_id` field.

This binding is laid down but NOT yet used to filter what a user sees — that fine-grained
per-tenant `can()` authorization is a later slice once auth-brain grants are provisioned. For
now access is all-or-nothing via `platform.admin`.

## Env / config

- Dashboard (`packages/dashboard`): `AUTH_BRAIN_URL` (default `https://auth.lumitra.co`),
  `OPENFGA_API_URL`, `OPENFGA_STORE_ID`, `STORAGE_BRAIN_ADMIN_KEY` (server-only),
  `STORAGE_BRAIN_URL`, and a real `SESSION_SECRET` (drop the hardcoded 32-char fallback for prod;
  keep a dev-only default behind a NODE_ENV check). Add `@marlinjai/auth-brain-sdk` to deps.
- API worker (`packages/api/src/env.ts`, `wrangler.toml`): no auth change in this slice. (The
  `AUTH_BRAIN_URL`/`OPENFGA_*` worker vars belong to the deferred machine-key slice; do not add
  them here unless the auth_workspace_id work needs them — it does not.)
- Mirror the analytics-platform client singleton: `analytics-platform/.../src/lib/auth-brain.ts`.

## Files

New:
- `packages/dashboard/src/lib/auth-brain.ts` (auth-brain client singleton)
- `packages/dashboard/src/lib/dashboard-auth.ts` (`getDashboardSession()` helper)
- `packages/api/migrations/0005_auth_workspace_id.sql`

Edit:
- `packages/dashboard/package.json` (+ `@marlinjai/auth-brain-sdk`)
- `packages/dashboard/src/middleware.ts` (accept either cookie)
- `packages/dashboard/src/lib/sdk.ts` (`getAdmin()` mode-aware)
- `packages/dashboard/src/app/api/auth/login/route.ts` (keep admin-key fallback) + the `/login`
  page (add Lumitra button) + `.../auth/logout/route.ts` (clear both)
- `packages/dashboard/src/lib/session.ts` (keep; gate hardcoded secret behind dev-only)
- `packages/shared/src/types.ts`, `packages/shared/src/database-adapter.ts`
- `packages/api/src/adapters/database/d1.ts`
- `@marlinjai/storage-brain-sdk` admin client create/update tenant
- dashboard tenant create/edit form (optional auth_workspace_id field)
- `.env.example` (+ the new dashboard vars)

## Tests (vitest, mirror existing `packages/*/src/**/*.spec.ts`)

- `getDashboardSession()`: valid `lumitra_session` + `can(platform.admin)=true` → `auth-brain`
  mode; valid session + `can=false` → unauthorized (NOT silently allowed); no auth-brain cookie
  but valid iron-session → `legacy` mode; neither → `null`. Mock `authBrainClient`.
- `getAdmin()`: builds the client from env in auth-brain mode, from iron-session in legacy mode,
  throws when unauthorized.
- Fail-closed: a thrown/timed-out `verifySession` or `can()` resolves to unauthorized, never an
  allow.
- d1: `auth_workspace_id` round-trips through create/map/update; `getTenantByAuthWorkspaceId`
  hits and misses; existing tenants with NULL `auth_workspace_id` still map cleanly (no
  regression in existing d1 tests).
- Migration 0005 applies on top of 0001-0004 in the test DB.

## Out of scope (do NOT do)

- Service-account-key (`verifyApiKey`) auth on the API worker. Deferred slice.
- Upload UI (slice 3). Per-tenant `can()` filtering of the file/tenant lists.
- Removing the legacy admin-key login or the `api_key_hash` tenant path.
- Physical centralization / dropping SB's own tenants/workspaces (workstream 4).
