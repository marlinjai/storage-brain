-- Bind a Storage Brain tenant to an auth-brain workspace (one workspace per tenant).
-- Nullable so existing tenants are unaffected. D1/SQLite cannot add an inline FK
-- on ALTER, so this is a logical reference only.
ALTER TABLE tenants ADD COLUMN auth_workspace_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tenants_auth_workspace ON tenants(auth_workspace_id);
