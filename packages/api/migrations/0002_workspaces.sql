-- Workspaces within a tenant
CREATE TABLE IF NOT EXISTS workspaces (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  quota_bytes   INTEGER,
  used_bytes    INTEGER NOT NULL DEFAULT 0,
  metadata      TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces(tenant_id);

-- Add workspace_id to files (nullable for backward compat)
ALTER TABLE files ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

CREATE INDEX IF NOT EXISTS idx_files_workspace ON files(workspace_id);
