-- When the storage object was confirmed gone (deleted_at set, purged_at NULL
-- means "deleted but not yet purged -> the purge sweeper retries"). Nullable:
-- rows soft-deleted before this column existed keep NULL and are swept.
ALTER TABLE files ADD COLUMN purged_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_files_purge_sweep ON files(deleted_at, purged_at);
