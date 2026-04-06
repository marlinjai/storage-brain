---
title: Per-Workspace API Keys
type: plan
status: draft
summary: Scoped API keys that restrict access to a single workspace within a tenant, enabling multi-app tenants with isolated credentials.
tags: [security, workspaces, multi-tenancy]
date: 2026-04-06
---

# Per-Workspace API Keys

## Problem

A single tenant API key grants access to **all** workspaces within that tenant. If receipt-ocr-app and lola-stories share a tenant with separate workspaces, a leak of one app's key exposes both apps' files.

## Proposed Design

### Key Types

| Key Type | Prefix | Scope |
|----------|--------|-------|
| Tenant key | `sk_live_` | All workspaces (current behavior) |
| Workspace key | `wk_live_` | Single workspace only |

### Database Changes

New `workspace_api_keys` table:
```sql
CREATE TABLE workspace_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  api_key_hash TEXT NOT NULL,
  key_prefix VARCHAR(10),
  name TEXT,           -- e.g. "receipt-ocr-production"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_workspace_api_keys_hash ON workspace_api_keys(api_key_hash);
```

### Auth Middleware Changes

The auth middleware tries tenant key lookup first (`sk_live_` prefix), then workspace key lookup (`wk_live_` prefix). Workspace keys set both `tenant` and `workspace` context — all file operations auto-scope to that workspace.

### Route Behavior

- **Workspace key**: `listFiles` only returns files in that workspace. `upload` auto-assigns the workspace. Cannot create/delete workspaces.
- **Tenant key**: Current behavior unchanged — full access.

### Admin API

- `POST /admin/tenants/:id/workspaces/:wid/keys` — create workspace key
- `GET /admin/tenants/:id/workspaces/:wid/keys` — list workspace keys
- `DELETE /admin/tenants/:id/workspaces/:wid/keys/:kid` — revoke key

### Dashboard

Add key management to the workspace detail page (alongside the existing workspace settings).

## Migration Path

Backward compatible — existing tenant keys keep working. Workspace keys are opt-in.

## Effort Estimate

Medium — touches auth middleware, DB schema, admin routes, SDK, and dashboard. ~2-3 focused sessions.
