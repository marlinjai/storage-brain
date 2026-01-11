-- Storage Brain Initial Schema
-- Database: Cloudflare D1

-- Tenants table
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  api_key_hash TEXT NOT NULL,
  quota_bytes INTEGER NOT NULL DEFAULT 524288000, -- 500MB default
  used_bytes INTEGER NOT NULL DEFAULT 0,
  allowed_file_types TEXT, -- JSON array of MIME types
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Index for API key lookup (we store hash)
CREATE INDEX IF NOT EXISTS idx_tenants_api_key_hash ON tenants(api_key_hash);

-- Files table
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  context TEXT NOT NULL DEFAULT 'default',
  tags TEXT, -- JSON object
  metadata TEXT, -- JSON object (processing results)
  processing_status TEXT NOT NULL DEFAULT 'pending',
  webhook_url TEXT, -- Optional webhook to call after processing
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER, -- Soft delete timestamp
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Indexes for files
CREATE INDEX IF NOT EXISTS idx_files_tenant_id ON files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at);
CREATE INDEX IF NOT EXISTS idx_files_context ON files(context);
CREATE INDEX IF NOT EXISTS idx_files_tenant_deleted ON files(tenant_id, deleted_at);

-- Upload sessions table
CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  presigned_url TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, completed, expired, failed
  created_at INTEGER NOT NULL,
  FOREIGN KEY (file_id) REFERENCES files(id)
);

-- Indexes for upload sessions
CREATE INDEX IF NOT EXISTS idx_upload_sessions_file_id ON upload_sessions(file_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires_at ON upload_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status);
