-- Stamp the owning tenant onto upload sessions so the token-only upload route
-- can scope lookups instead of relying on unscoped file/session lookups
-- (company-isolation S1, recon finding 7). Nullable so sessions created before
-- this column are unaffected (backfillable).
ALTER TABLE upload_sessions ADD COLUMN tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_upload_sessions_tenant_id ON upload_sessions(tenant_id);
