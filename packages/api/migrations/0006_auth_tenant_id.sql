-- Bind a Storage Brain tenant to an auth-brain COMPANY (tenant) for company
-- isolation (S1). A `tenant`-scoped auth-brain key resolves to this storage
-- tenant via auth_tenant_id. Nullable so existing tenants are unaffected and
-- can be backfilled during the migration. D1/SQLite cannot add an inline FK on
-- ALTER, so this is a logical reference only.
ALTER TABLE tenants ADD COLUMN auth_tenant_id TEXT;

-- A company maps to at most one storage tenant: unique among non-null (live) rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_auth_tenant
  ON tenants(auth_tenant_id) WHERE auth_tenant_id IS NOT NULL;
