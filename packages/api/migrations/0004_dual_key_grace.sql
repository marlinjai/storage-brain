-- Dual-key grace period: allow old key to remain valid during rotation
ALTER TABLE tenants ADD COLUMN previous_api_key_hash TEXT;
ALTER TABLE tenants ADD COLUMN previous_key_expires_at BIGINT;
