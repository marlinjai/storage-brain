import type { D1Database } from '@cloudflare/workers-types';
import type {
  Tenant,
  StoredFile,
  UploadSession,
  AllowedMimeType,
  UploadSessionStatus,
  ProcessingStatus,
  ListFilesInput,
} from '@storage-brain/shared';
import { verifyApiKey } from '../utils/crypto';

// ============================================================================
// Tenant Queries
// ============================================================================

interface CreateTenantInput {
  id: string;
  name: string;
  apiKeyHash: string;
  quotaBytes: number;
  allowedFileTypes: AllowedMimeType[];
}

export async function createTenant(db: D1Database, input: CreateTenantInput): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO tenants (id, name, api_key_hash, quota_bytes, used_bytes, allowed_file_types, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
    )
    .bind(
      input.id,
      input.name,
      input.apiKeyHash,
      input.quotaBytes,
      JSON.stringify(input.allowedFileTypes),
      now,
      now
    )
    .run();
}

export async function getTenantByName(db: D1Database, name: string): Promise<Tenant | null> {
  const result = await db.prepare('SELECT * FROM tenants WHERE name = ?').bind(name).first();

  return result ? mapTenantRow(result) : null;
}

export async function getTenantByApiKey(db: D1Database, apiKey: string): Promise<Tenant | null> {
  // Get all tenants and verify against each hash
  // This is necessary because we can't reverse the hash
  // For production with many tenants, consider a different approach
  const results = await db.prepare('SELECT * FROM tenants').all();

  for (const row of results.results) {
    const tenant = mapTenantRow(row);
    const isValid = await verifyApiKey(apiKey, tenant.apiKeyHash);
    if (isValid) {
      return tenant;
    }
  }

  return null;
}

export async function getTenantById(db: D1Database, id: string): Promise<Tenant | null> {
  const result = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();

  return result ? mapTenantRow(result) : null;
}

function mapTenantRow(row: Record<string, unknown>): Tenant {
  return {
    id: row.id as string,
    name: row.name as string,
    apiKeyHash: row.api_key_hash as string,
    quotaBytes: row.quota_bytes as number,
    usedBytes: row.used_bytes as number,
    allowedFileTypes: row.allowed_file_types
      ? (JSON.parse(row.allowed_file_types as string) as AllowedMimeType[])
      : null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

// ============================================================================
// File Queries
// ============================================================================

interface CreateFileInput {
  id: string;
  tenantId: string;
  originalName: string;
  storedPath: string;
  fileType: AllowedMimeType;
  sizeBytes: number;
  context: string | null;
  tags: Record<string, string> | null;
  webhookUrl?: string;
}

export async function createFile(db: D1Database, input: CreateFileInput): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO files (id, tenant_id, original_name, stored_path, file_type, size_bytes, context, tags, metadata, processing_status, webhook_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?, ?)`
    )
    .bind(
      input.id,
      input.tenantId,
      input.originalName,
      input.storedPath,
      input.fileType,
      input.sizeBytes,
      input.context,
      input.tags ? JSON.stringify(input.tags) : null,
      input.webhookUrl ?? null,
      now,
      now
    )
    .run();
}

export async function getFileById(
  db: D1Database,
  fileId: string,
  tenantId: string
): Promise<StoredFile | null> {
  const result = await db
    .prepare('SELECT * FROM files WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
    .bind(fileId, tenantId)
    .first();

  return result ? mapFileRow(result) : null;
}

interface ListFilesResult {
  files: StoredFile[];
  nextCursor: string | null;
  total: number;
}

export async function listFilesByTenant(
  db: D1Database,
  tenantId: string,
  options: ListFilesInput
): Promise<ListFilesResult> {
  const { limit = 20, cursor, context, fileType } = options;

  // Build WHERE clause
  const conditions: string[] = ['tenant_id = ?', 'deleted_at IS NULL'];
  const params: (string | number)[] = [tenantId];

  if (context) {
    conditions.push('context = ?');
    params.push(context);
  }

  if (fileType) {
    conditions.push('file_type = ?');
    params.push(fileType);
  }

  // Decode cursor (base64 encoded created_at timestamp)
  let cursorTimestamp: number | null = null;
  if (cursor) {
    try {
      cursorTimestamp = parseInt(atob(cursor), 10);
      conditions.push('created_at < ?');
      params.push(cursorTimestamp);
    } catch {
      // Invalid cursor, ignore
    }
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countResult = await db
    .prepare(`SELECT COUNT(*) as count FROM files WHERE ${whereClause}`)
    .bind(...params)
    .first<{ count: number }>();
  const total = countResult?.count ?? 0;

  // Get files
  const filesResult = await db
    .prepare(
      `SELECT * FROM files WHERE ${whereClause} ORDER BY created_at DESC LIMIT ?`
    )
    .bind(...params, limit + 1) // Fetch one extra to determine if there's a next page
    .all();

  const files = filesResult.results.map(mapFileRow);
  const hasMore = files.length > limit;

  if (hasMore) {
    files.pop(); // Remove the extra item
  }

  // Generate next cursor
  const lastFile = files[files.length - 1];
  const nextCursor = hasMore && lastFile ? btoa(lastFile.createdAt.toString()) : null;

  return { files, nextCursor, total };
}

export async function softDeleteFile(
  db: D1Database,
  fileId: string,
  tenantId: string
): Promise<void> {
  const now = Date.now();
  await db
    .prepare('UPDATE files SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .bind(now, now, fileId, tenantId)
    .run();
}

export async function updateFileMetadata(
  db: D1Database,
  fileId: string,
  metadata: Record<string, unknown>,
  processingStatus: ProcessingStatus
): Promise<void> {
  const now = Date.now();
  await db
    .prepare('UPDATE files SET metadata = ?, processing_status = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(metadata), processingStatus, now, fileId)
    .run();
}

export async function updateFileProcessingStatus(
  db: D1Database,
  fileId: string,
  status: ProcessingStatus
): Promise<void> {
  const now = Date.now();
  await db
    .prepare('UPDATE files SET processing_status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now, fileId)
    .run();
}

function mapFileRow(row: Record<string, unknown>): StoredFile {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    originalName: row.original_name as string,
    storedPath: row.stored_path as string,
    fileType: row.file_type as AllowedMimeType,
    sizeBytes: row.size_bytes as number,
    context: (row.context as string) ?? null,
    tags: row.tags ? (JSON.parse(row.tags as string) as Record<string, string>) : null,
    metadata: row.metadata ? (JSON.parse(row.metadata as string) as Record<string, unknown>) : null,
    processingStatus: row.processing_status as ProcessingStatus,
    webhookUrl: (row.webhook_url as string) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    deletedAt: (row.deleted_at as number) ?? null,
  };
}

// ============================================================================
// Upload Session Queries
// ============================================================================

interface CreateUploadSessionInput {
  fileId: string;
  presignedUrl: string;
  expiresAt: number;
}

export async function createUploadSession(
  db: D1Database,
  input: CreateUploadSessionInput
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO upload_sessions (id, file_id, presigned_url, expires_at, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    )
    .bind(id, input.fileId, input.presignedUrl, input.expiresAt, now)
    .run();

  return id;
}

export async function getUploadSessionByFileId(
  db: D1Database,
  fileId: string
): Promise<UploadSession | null> {
  const result = await db
    .prepare('SELECT * FROM upload_sessions WHERE file_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(fileId)
    .first();

  return result ? mapUploadSessionRow(result) : null;
}

export async function updateUploadSessionStatus(
  db: D1Database,
  sessionId: string,
  status: UploadSessionStatus
): Promise<void> {
  await db
    .prepare('UPDATE upload_sessions SET status = ? WHERE id = ?')
    .bind(status, sessionId)
    .run();
}

function mapUploadSessionRow(row: Record<string, unknown>): UploadSession {
  return {
    id: row.id as string,
    fileId: row.file_id as string,
    presignedUrl: row.presigned_url as string,
    expiresAt: row.expires_at as number,
    status: row.status as UploadSessionStatus,
    createdAt: row.created_at as number,
  };
}

// ============================================================================
// Additional File Queries (for upload handling)
// ============================================================================

/**
 * Get a file by its stored path (used during upload to find the file record)
 */
export async function getFileByStoredPath(
  db: D1Database,
  storedPath: string
): Promise<StoredFile | null> {
  const result = await db
    .prepare('SELECT * FROM files WHERE stored_path = ? AND deleted_at IS NULL')
    .bind(storedPath)
    .first();

  return result ? mapFileRow(result) : null;
}

/**
 * Update file size after actual upload (client may not know exact size upfront)
 */
export async function updateFileSizeBytes(
  db: D1Database,
  fileId: string,
  sizeBytes: number
): Promise<void> {
  const now = Date.now();
  await db
    .prepare('UPDATE files SET size_bytes = ?, updated_at = ? WHERE id = ?')
    .bind(sizeBytes, now, fileId)
    .run();
}
