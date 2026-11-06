-- Operator alerts. The purge sweeper writes one row per object whose storage
-- delete keeps failing; the partial unique index (kind, file_id) makes that
-- exactly once per object, so repeated failures bump one row instead of
-- creating new ones (mirrors Studio's operatorAlert pattern: an alert is a
-- fact in the database, not a timer in memory).
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  tenant_id TEXT,
  file_id TEXT,
  stored_path TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  acknowledged_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_kind_file
  ON alerts(kind, file_id) WHERE file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_open
  ON alerts(acknowledged_at) WHERE acknowledged_at IS NULL;
