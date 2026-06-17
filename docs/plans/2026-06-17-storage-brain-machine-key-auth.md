---
type: plan
status: draft
title: "Spec: Storage Brain machine auth via auth-brain service-account keys (slice 2B)"
summary: "The Storage Brain Worker API accepts auth-brain-issued service-account keys (verifyApiKey -> can) for machine callers, alongside the existing legacy tenant api_key_hash path (fallback). First cut supports workspace-scoped keys only, mapped 1:1 to an SB tenant via auth_workspace_id; broader (tenant/tenant_group) scopes are explicitly deferred."
date: 2026-06-17
tags: [storage-brain, auth-brain, service-account, api-keys, openfga]
projects: [storage-brain, auth-brain]
---

# Spec: Storage Brain machine auth via auth-brain keys (slice 2B)

Parent plan: `auth-brain/docs/superpowers/plans/2026-06-16-centralized-api-keys-and-storage-brain-upload.md`.
This is the deferred machine half of slice 2. Consumes `@marlinjai/auth-brain-sdk@^1.1.0`
(published, has `verifyApiKey` + `can(..., {subjectType:'service_account'})`). Additive: the
legacy `api_key_hash` tenant path stays fully working.

## Scope decision (DECIDED)

**Workspace-scoped service-account keys only**, in this first cut. An SB tenant binds 1:1 to an
auth-brain workspace via `auth_workspace_id` (added in slice 2A). A workspace-scoped key resolves
unambiguously to one SB tenant. `tenant`- and `tenant_group`-scoped keys are explicitly REJECTED
on this path for now (clear error), because they span multiple SB tenants and need a
target-resolution UX that is out of scope here. Account-wide keys remain valid auth-brain
principals; they just are not the machine path for per-tenant storage ops yet.

## Auth flow (compound middleware, fail-closed)

Both legacy SB tenant keys and auth-brain SA keys use the `sk_live_` prefix (both from
brain-core), so they cannot be told apart by shape. The middleware tries both:

1. **Legacy first (cheap, local D1):** `getTenantByApiKey(token)`. Hit -> set tenant, done.
   (Keeps existing-key latency unchanged, no network call for legacy callers.)
2. **auth-brain fallback (network):** `authBrainClient.verifyApiKey(token)`.
   - `null`/throw/timeout -> 401 (fail-closed; never an allow on error).
   - `principal.scope.type !== 'workspace'` -> 403 with a clear "only workspace-scoped keys are
     supported for the Storage Brain API" message (deferred-scope case).
   - `tenant = db.getTenantByAuthWorkspaceId(principal.scope.id)`. No bound SB tenant -> 401.
   - `allowed = can(principal.id, 'workspace.member', { workspaceId: principal.scope.id }, { subjectType: 'service_account' })`.
     Not allowed -> 403. (member is the floor to act as the tenant; this is the write/read gate
     for the tenant data routes.)
   - Allowed -> `c.set('tenant', tenant)` exactly like the legacy path, so every downstream
     tenant route works unchanged.
3. Neither path resolves -> 401.

A failure anywhere in the auth-brain branch resolves to 401/403, never a silent allow, mirroring
the dashboard `getDashboardSession` fail-closed property.

## Files

New:
- `packages/api/src/lib/auth-brain.ts` (auth-brain client singleton, fetch-based, Workers-safe;
  mirrors analytics-platform's client and the dashboard's slice-2A client)
- `packages/api/src/middleware/service-account-auth.ts` (or extend `middleware/auth.ts` into a
  compound middleware) implementing the flow above

Edit:
- `packages/api/src/middleware/auth.ts` (wire the compound: legacy -> auth-brain)
- `packages/api/src/env.ts` (add `AUTH_BRAIN_URL`, `OPENFGA_API_URL`, `OPENFGA_STORE_ID`; all
  optional with sane defaults so the worker still boots without them, in which case the
  auth-brain branch is simply skipped and only legacy keys work)
- `packages/api/wrangler.toml` (declare the new vars; secrets via `wrangler secret` / Infisical)
- `.env.example` (document the new vars for the Node self-host path)

Do NOT touch the upload/admin routes themselves; this is purely the tenant-auth resolution layer.

## Graceful degradation

If `AUTH_BRAIN_URL`/OpenFGA config is absent (e.g. local dev, or before provisioning), the
auth-brain branch is skipped entirely and only legacy tenant keys work. No hard dependency on
auth-brain being reachable for the existing path. This keeps the existing API fully functional
pre-provisioning.

## Tests (vitest; mock the auth-brain client; CI verify.yml now enforces build+typecheck+lint+test)

- Legacy tenant key still authenticates (no regression; auth-brain branch not even called).
- auth-brain workspace-scoped key: `verifyApiKey` hit + `can=true` -> 200 and the resolved tenant
  is the one bound via `auth_workspace_id`.
- `can=false` -> 403. No bound SB tenant for the workspace -> 401.
- `tenant`/`tenant_group`-scoped key -> 403 deferred-scope error (not a 500, not a silent allow).
- `verifyApiKey` returns null (bad/expired/revoked) -> falls through to legacy, then 401.
- auth-brain network error/timeout -> fail-closed (legacy already missed -> 401), never allow.
- Worker boots and legacy auth works with AUTH_BRAIN_URL unset (degradation path).
- Mock `can()` and `verifyApiKey`; mirror existing `routes/*.spec.ts` style.

## Out of scope

- `tenant`/`tenant_group`-scoped (account-wide) keys on the storage API (deferred; needs target
  resolution UX).
- Per-tenant `can()` filtering in the dashboard (separate slice, best after provisioning).
- Removing the legacy `api_key_hash` path.
- Physical centralization / dropping SB's own tenants+workspaces (workstream 4).
