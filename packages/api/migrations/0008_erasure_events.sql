-- Idempotency ledger for the auth-brain GDPR erasure webhook consumer
-- (company-isolation S4, POST /api/v1/internal/erasure). One row per delivered
-- event_id: its presence marks the delivery already fully processed, so a replay
-- is a no-op ack. Holds ids + a processed timestamp only, NEVER the webhook body
-- or signing secret.
CREATE TABLE IF NOT EXISTS erasure_events (
  event_id             TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL, -- 'user.erased' | 'tenant.erased'
  auth_tenant_id       TEXT,          -- erased auth-brain company id, when present
  matched_tenant_count INTEGER NOT NULL DEFAULT 0,
  processed_at         INTEGER NOT NULL
);
