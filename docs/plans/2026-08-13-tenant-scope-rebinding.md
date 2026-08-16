---
type: plan
status: decided
title: "Rebind Storage Brain tenants from auth_workspace_id to auth_tenant_id"
summary: "Company-wide storage binds to the auth-brain tenant, not to the invisible default Main workspace. Rebind existing SB tenants and rescope the consuming service accounts to tenant scope; workspace binding stays available only for real project isolation."
date: 2026-08-13
tags: [storage-brain, auth-brain, tenants, service-accounts, migration]
---

# Rebind Storage Brain tenants to auth_tenant_id

Decided with Marlin 2026-08-13. Rule going forward: **a company-wide resource
binds to the auth-brain tenant; a workspace binding is used only when one
company genuinely needs several isolated storage tenants (project isolation).**

## Why

The legacy binding hangs every company's storage off its default "Main"
workspace, an object the portal barely surfaces. That makes an invisible
provisioning artifact load-bearing: renaming or cleaning up default workspaces
(the confusion class Marlin hit on 2026-08-13) risks storage access. The auth
middleware already accepts both machine paths (`getTenantByAuthWorkspaceId`
and `getTenantByAuthTenantId` in `packages/api/src/middleware/auth.ts`), so
this is a data migration plus one small route gap, not an architecture change.

## Preconditions (verified in code)

- `requireStorageGrant` demands the `storage` app grant ON THE KEY'S SCOPE.
  A tenant-scoped key therefore needs the grant at tenant level (auth-brain
  `/admin/apps`) BEFORE the switch, or every call 403s.
- Service accounts have exactly one scope FK (tenant_group | tenant |
  workspace, CHECK-enforced). Rescoping is therefore done by CREATING a new
  tenant-scoped service account and retiring the old one, not by mutating the
  scope of a live principal (zero-downtime, revocable, auditable).

## Reality update (2026-08-16)

Executed the additive half, verified against production:

- The `storage` grant already sat at TENANT level on lola-stories, so step 1
  needed no change.
- A tenant-scoped service account `agentic-os-ops` exists per company in
  auth-brain (created for the platform migration, role `admin`), and a separate
  `lola-stories-api-tenant` account exists for this rebinding.
- The Storage Brain tenant `lola-stories` now carries `authTenantId` (set via
  the machine admin API). The workspace binding was left in place on purpose:
  both lookup paths are legal, so the tenant binding is additive and carries no
  cutover risk.
- The route gap this plan named is closed: `authTenantId` is accepted on tenant
  create and update since `3bbedff`.

STILL OPEN, and it is the only thing left here: the CONSUMER KEY CUTOVER.
Marlin must issue a key for the tenant-scoped service account in the
auth.lumitra.co companies page, store it as `STORAGE_BRAIN_API_KEY` in the
lola-stories Infisical project, redeploy the lola API, then revoke the old
workspace-scoped key and verify it 401s. This step is blocked for automation
by an organization boundary: the secrets proxy machine identity cannot write
into that Infisical organization, so no agent can move that value. There is
also one orphaned key on `lola-stories-api-tenant` from an automated attempt
whose plaintext was discarded; revoke it in the same pass (it has never been
used).

Only after the cutover: null out `auth_workspace_id` for that tenant so the
binding is unambiguous, and update the auth-brain consuming-apps registry row.

## Steps per company (first: lola-stories)

1. auth-brain `/admin/apps`: ensure the company holds the `storage` grant at
   tenant level.
2. auth-brain: create service account `lola-stories-api` (tenant scope) or a
   successor name, issue a key. The plaintext key goes straight into Infisical
   (lola-stories project) by Marlin; it never transits chat or shell output.
3. Storage Brain: set the SB tenant's `auth_tenant_id` to the auth-brain tenant
   id. Gap: `packages/api/src/routes/admin.ts` currently accepts only
   `authWorkspaceId` in the tenant upsert body; extend it to accept
   `authTenantId` (nullable, mutually exclusive validation with
   `authWorkspaceId` is NOT required since both lookup paths are legal, but the
   rebind sets `auth_workspace_id = NULL` to make the binding unambiguous).
4. Consumer (lola-stories API) switches to the new key via Infisical, redeploy.
5. Verify forward: an authed call succeeds via the tenant-scoped key.
6. Revoke the old workspace-scoped key in auth-brain; verify it now 401s
   (the revision-path check: revoked credential dies within the verify cache
   TTL, re-issued credential works without SB-side changes).
7. Registry: update the storage-brain row in auth-brain
   `docs/internal/consuming-apps.md` ("SB tenants bound via authWorkspaceId"
   becomes "bound via authTenantId; workspace binding reserved for project
   isolation").

## Tests (storage-brain repo, with the route change)

- Admin upsert accepts `authTenantId` and persists it; lookup via
  `getTenantByAuthTenantId` resolves the tenant.
- A tenant-scoped key whose scope lacks the `storage` grant is 403, with the
  grant it resolves the SB tenant.
- A workspace-scoped key against a tenant whose `auth_workspace_id` was nulled
  is 401 ("no Storage Brain tenant bound"), proving the old path is dead for
  rebound tenants.

## Out of scope

- Deleting the `auth_workspace_id` column: stays, it is the project-isolation
  escape hatch.
- The duplicate "Main" companies cleanup in auth-brain (separate item, needs
  Marlin's confirmation before deleting anything).
