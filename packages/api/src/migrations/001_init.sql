-- Storage Brain — Postgres schema
-- Combined from D1 migrations 0001_initial_schema + 0002_workspaces + 0003_key_prefix

-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  api_key_hash    TEXT NOT NULL,
  key_prefix      VARCHAR(16),
  quota_bytes     BIGINT NOT NULL DEFAULT 524288000,
  used_bytes      BIGINT NOT NULL DEFAULT 0,
  allowed_file_types TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

-- Backfill key_prefix for existing deployments (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'key_prefix'
  ) THEN
    ALTER TABLE tenants ADD COLUMN key_prefix VARCHAR(16);
  END IF;
END $$;

-- Widen key_prefix to fit 12-char prefixes (was varchar(10))
ALTER TABLE tenants ALTER COLUMN key_prefix TYPE VARCHAR(16);

-- Bind a tenant to an auth-brain workspace (nullable, idempotent for existing deployments)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'auth_workspace_id'
  ) THEN
    ALTER TABLE tenants ADD COLUMN auth_workspace_id TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_api_key_hash ON tenants(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_tenants_auth_workspace ON tenants(auth_workspace_id);

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  quota_bytes     BIGINT,
  used_bytes      BIGINT NOT NULL DEFAULT 0,
  metadata        TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces(tenant_id);

-- Files
CREATE TABLE IF NOT EXISTS files (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  workspace_id      TEXT REFERENCES workspaces(id),
  original_name     TEXT NOT NULL,
  stored_path       TEXT NOT NULL,
  file_type         TEXT NOT NULL,
  size_bytes        BIGINT NOT NULL,
  context           TEXT DEFAULT 'default',
  tags              TEXT,
  metadata          TEXT,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  webhook_url       TEXT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL,
  deleted_at        BIGINT
);

CREATE INDEX IF NOT EXISTS idx_files_tenant_id ON files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at);
CREATE INDEX IF NOT EXISTS idx_files_context ON files(context);
CREATE INDEX IF NOT EXISTS idx_files_tenant_deleted ON files(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_files_workspace ON files(workspace_id);

-- Upload sessions
CREATE TABLE IF NOT EXISTS upload_sessions (
  id              TEXT PRIMARY KEY,
  file_id         TEXT NOT NULL REFERENCES files(id),
  presigned_url   TEXT NOT NULL,
  expires_at      BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_file_id ON upload_sessions(file_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires_at ON upload_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status);
