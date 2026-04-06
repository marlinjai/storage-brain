import type { D1Database } from '@cloudflare/workers-types';
import type {
  DatabaseAdapter,
  CreateTenantInput,
  CreateFileInput,
  ListFilesResult,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  QuotaCheckResult,
  CreateUploadSessionInput,
  Tenant,
  StoredFile,
  UploadSession,
  Workspace,
  ListFilesInput,
  ListTenantsInput,
  ListTenantsResult,
  UpdateTenantInput,
  QuotaResponse,
  AllowedMimeType,
  UploadSessionStatus,
  ProcessingStatus,
} from '@storage-brain/shared';
import { hashApiKey, verifyApiKey } from '../../utils/crypto';

export class D1DatabaseAdapter implements DatabaseAdapter {
  constructor(private db: D1Database) {}

  // ============================================================================
  // Tenant
  // ============================================================================

  async createTenant(input: CreateTenantInput): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO tenants (id, name, api_key_hash, key_prefix, quota_bytes, used_bytes, allowed_file_types, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .bind(
        input.id,
        input.name,
        input.apiKeyHash,
        input.keyPrefix,
        input.quotaBytes,
        JSON.stringify(input.allowedFileTypes),
        now,
        now
      )
      .run();
  }

  async getTenantByApiKey(apiKey: string): Promise<Tenant | null> {
    const apiKeyHash = await hashApiKey(apiKey);
    const result = await this.db
      .prepare('SELECT * FROM tenants WHERE api_key_hash = ?')
      .bind(apiKeyHash)
      .first();

    if (!result) return null;

    const tenant = this.mapTenantRow(result);
    const isValid = await verifyApiKey(apiKey, tenant.apiKeyHash);
    return isValid ? tenant : null;
  }

  async getTenantByName(name: string): Promise<Tenant | null> {
    const result = await this.db.prepare('SELECT * FROM tenants WHERE name = ?').bind(name).first();
    return result ? this.mapTenantRow(result) : null;
  }

  async getTenantById(id: string): Promise<Tenant | null> {
    const result = await this.db.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    return result ? this.mapTenantRow(result) : null;
  }

  async updateTenantApiKeyHash(tenantId: string, newHash: string, keyPrefix: string): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE tenants SET api_key_hash = ?, key_prefix = ?, updated_at = ? WHERE id = ?')
      .bind(newHash, keyPrefix, Date.now(), tenantId)
      .run();

    return (result.meta.changes ?? 0) > 0;
  }

  async listTenants(input: ListTenantsInput): Promise<ListTenantsResult> {
    const { limit = 20, cursor } = input;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (cursor) {
      try {
        const cursorTimestamp = parseInt(atob(cursor), 10);
        conditions.push('created_at < ?');
        params.push(cursorTimestamp);
      } catch {
        // Invalid cursor, ignore
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.db
      .prepare(`SELECT COUNT(*) as count FROM tenants ${whereClause}`)
      .bind(...params)
      .first<{ count: number }>();
    const total = countResult?.count ?? 0;

    const tenantsResult = await this.db
      .prepare(`SELECT * FROM tenants ${whereClause} ORDER BY created_at DESC LIMIT ?`)
      .bind(...params, limit + 1)
      .all();

    const tenants = tenantsResult.results.map((row) => this.mapTenantRow(row));
    const hasMore = tenants.length > limit;
    if (hasMore) tenants.pop();

    const lastTenant = tenants[tenants.length - 1];
    const nextCursor = hasMore && lastTenant ? btoa(lastTenant.createdAt.toString()) : null;

    return { tenants, nextCursor, total };
  }

  async updateTenant(tenantId: string, updates: UpdateTenantInput): Promise<Tenant | null> {
    const now = Date.now();
    const setClauses: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [now];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      params.push(updates.name);
    }

    if (updates.quotaBytes !== undefined) {
      setClauses.push('quota_bytes = ?');
      params.push(updates.quotaBytes);
    }

    if (updates.allowedFileTypes !== undefined) {
      setClauses.push('allowed_file_types = ?');
      params.push(updates.allowedFileTypes ? JSON.stringify(updates.allowedFileTypes) : null);
    }

    params.push(tenantId);

    await this.db
      .prepare(`UPDATE tenants SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();

    return this.getTenantById(tenantId);
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    // Delete in order: upload_sessions → files → workspaces → tenant
    await this.db
      .prepare(
        'DELETE FROM upload_sessions WHERE file_id IN (SELECT id FROM files WHERE tenant_id = ?)'
      )
      .bind(tenantId)
      .run();

    await this.db
      .prepare('DELETE FROM files WHERE tenant_id = ?')
      .bind(tenantId)
      .run();

    await this.db
      .prepare('DELETE FROM workspaces WHERE tenant_id = ?')
      .bind(tenantId)
      .run();

    const result = await this.db
      .prepare('DELETE FROM tenants WHERE id = ?')
      .bind(tenantId)
      .run();

    return (result.meta.changes ?? 0) > 0;
  }

  // ============================================================================
  // Files
  // ============================================================================

  async createFile(input: CreateFileInput): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO files (id, tenant_id, workspace_id, original_name, stored_path, file_type, size_bytes, context, tags, metadata, processing_status, webhook_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?, ?)`
      )
      .bind(
        input.id,
        input.tenantId,
        input.workspaceId ?? null,
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

  async getFileById(fileId: string, tenantId: string): Promise<StoredFile | null> {
    const result = await this.db
      .prepare('SELECT * FROM files WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
      .bind(fileId, tenantId)
      .first();

    return result ? this.mapFileRow(result) : null;
  }

  async getFileByIdUnscoped(fileId: string): Promise<StoredFile | null> {
    const result = await this.db
      .prepare('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL')
      .bind(fileId)
      .first();

    return result ? this.mapFileRow(result) : null;
  }

  async getFileByStoredPath(storedPath: string): Promise<StoredFile | null> {
    const result = await this.db
      .prepare('SELECT * FROM files WHERE stored_path = ? AND deleted_at IS NULL')
      .bind(storedPath)
      .first();

    return result ? this.mapFileRow(result) : null;
  }

  async listFilesByTenant(tenantId: string, options: ListFilesInput): Promise<ListFilesResult> {
    const { limit = 20, cursor, context, fileType, workspaceId } = options;

    const conditions: string[] = ['tenant_id = ?', 'deleted_at IS NULL'];
    const params: (string | number)[] = [tenantId];

    if (workspaceId) {
      conditions.push('workspace_id = ?');
      params.push(workspaceId);
    }

    if (context) {
      conditions.push('context = ?');
      params.push(context);
    }

    if (fileType) {
      conditions.push('file_type = ?');
      params.push(fileType);
    }

    if (cursor) {
      try {
        const cursorTimestamp = parseInt(atob(cursor), 10);
        conditions.push('created_at < ?');
        params.push(cursorTimestamp);
      } catch {
        // Invalid cursor, ignore
      }
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await this.db
      .prepare(`SELECT COUNT(*) as count FROM files WHERE ${whereClause}`)
      .bind(...params)
      .first<{ count: number }>();
    const total = countResult?.count ?? 0;

    const filesResult = await this.db
      .prepare(
        `SELECT * FROM files WHERE ${whereClause} ORDER BY created_at DESC LIMIT ?`
      )
      .bind(...params, limit + 1)
      .all();

    const files = filesResult.results.map((row) => this.mapFileRow(row));
    const hasMore = files.length > limit;

    if (hasMore) {
      files.pop();
    }

    const lastFile = files[files.length - 1];
    const nextCursor = hasMore && lastFile ? btoa(lastFile.createdAt.toString()) : null;

    return { files, nextCursor, total };
  }

  async softDeleteFile(fileId: string, tenantId: string): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare('UPDATE files SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .bind(now, now, fileId, tenantId)
      .run();
  }

  async updateFileMetadata(
    fileId: string,
    metadata: Record<string, unknown>,
    status: ProcessingStatus
  ): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare('UPDATE files SET metadata = ?, processing_status = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(metadata), status, now, fileId)
      .run();
  }

  async updateFileProcessingStatus(fileId: string, status: ProcessingStatus): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare('UPDATE files SET processing_status = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, fileId)
      .run();
  }

  async updateFileSizeBytes(fileId: string, sizeBytes: number): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare('UPDATE files SET size_bytes = ?, updated_at = ? WHERE id = ?')
      .bind(sizeBytes, now, fileId)
      .run();
  }

  // ============================================================================
  // Workspaces
  // ============================================================================

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO workspaces (id, tenant_id, name, slug, quota_bytes, used_bytes, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .bind(
        input.id,
        input.tenantId,
        input.name,
        input.slug,
        input.quotaBytes ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        now
      )
      .run();

    return {
      id: input.id,
      tenantId: input.tenantId,
      name: input.name,
      slug: input.slug,
      quotaBytes: input.quotaBytes ?? null,
      usedBytes: 0,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getWorkspaceById(workspaceId: string, tenantId: string): Promise<Workspace | null> {
    const result = await this.db
      .prepare('SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?')
      .bind(workspaceId, tenantId)
      .first();

    return result ? this.mapWorkspaceRow(result) : null;
  }

  async listWorkspacesByTenant(tenantId: string): Promise<Workspace[]> {
    const result = await this.db
      .prepare('SELECT * FROM workspaces WHERE tenant_id = ? ORDER BY created_at DESC')
      .bind(tenantId)
      .all();

    return result.results.map((row) => this.mapWorkspaceRow(row));
  }

  async updateWorkspace(
    workspaceId: string,
    tenantId: string,
    updates: UpdateWorkspaceInput
  ): Promise<Workspace | null> {
    const now = Date.now();
    const setClauses: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [now];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      params.push(updates.name);
    }

    if (updates.quotaBytes !== undefined) {
      setClauses.push('quota_bytes = ?');
      params.push(updates.quotaBytes);
    }

    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?');
      params.push(JSON.stringify(updates.metadata));
    }

    params.push(workspaceId, tenantId);

    await this.db
      .prepare(
        `UPDATE workspaces SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`
      )
      .bind(...params)
      .run();

    return this.getWorkspaceById(workspaceId, tenantId);
  }

  async deleteWorkspace(workspaceId: string, tenantId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM workspaces WHERE id = ? AND tenant_id = ?')
      .bind(workspaceId, tenantId)
      .run();
  }

  async getActiveFilesByWorkspace(workspaceId: string, tenantId: string): Promise<StoredFile[]> {
    const result = await this.db
      .prepare(
        'SELECT * FROM files WHERE workspace_id = ? AND tenant_id = ? AND deleted_at IS NULL'
      )
      .bind(workspaceId, tenantId)
      .all();

    return result.results.map((row) => this.mapFileRow(row));
  }

  async softDeleteFilesByWorkspace(workspaceId: string, tenantId: string): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        'UPDATE files SET deleted_at = ?, updated_at = ? WHERE workspace_id = ? AND tenant_id = ? AND deleted_at IS NULL'
      )
      .bind(now, now, workspaceId, tenantId)
      .run();
  }

  // ============================================================================
  // Upload Sessions
  // ============================================================================

  async createUploadSession(input: CreateUploadSessionInput): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await this.db
      .prepare(
        `INSERT INTO upload_sessions (id, file_id, presigned_url, expires_at, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`
      )
      .bind(id, input.fileId, input.presignedUrl, input.expiresAt, now)
      .run();

    return id;
  }

  async getUploadSessionByFileId(fileId: string): Promise<UploadSession | null> {
    const result = await this.db
      .prepare('SELECT * FROM upload_sessions WHERE file_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(fileId)
      .first();

    return result ? this.mapUploadSessionRow(result) : null;
  }

  async updateUploadSessionStatus(sessionId: string, status: UploadSessionStatus): Promise<void> {
    await this.db
      .prepare('UPDATE upload_sessions SET status = ? WHERE id = ?')
      .bind(status, sessionId)
      .run();
  }

  // ============================================================================
  // Quota — Tenant Level
  // ============================================================================

  async checkQuota(tenantId: string, fileSizeBytes: number): Promise<QuotaCheckResult> {
    const result = await this.db
      .prepare('SELECT quota_bytes, used_bytes FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first<{ quota_bytes: number; used_bytes: number }>();

    if (!result) {
      return { hasCapacity: false, quotaBytes: 0, usedBytes: 0, availableBytes: 0 };
    }

    const availableBytes = result.quota_bytes - result.used_bytes;
    const hasCapacity = availableBytes >= fileSizeBytes;

    return { hasCapacity, quotaBytes: result.quota_bytes, usedBytes: result.used_bytes, availableBytes };
  }

  async reserveQuota(tenantId: string, sizeBytes: number): Promise<void> {
    const now = Date.now();

    const result = await this.db
      .prepare(
        `UPDATE tenants
         SET used_bytes = used_bytes + ?, updated_at = ?
         WHERE id = ? AND (quota_bytes - used_bytes) >= ?`
      )
      .bind(sizeBytes, now, tenantId, sizeBytes)
      .run();

    if (result.meta.changes === 0) {
      throw new Error('Insufficient quota or tenant not found');
    }
  }

  async releaseQuota(tenantId: string, sizeBytes: number): Promise<void> {
    const now = Date.now();

    await this.db
      .prepare(
        `UPDATE tenants
         SET used_bytes = MAX(0, used_bytes - ?), updated_at = ?
         WHERE id = ?`
      )
      .bind(sizeBytes, now, tenantId)
      .run();
  }

  async getQuotaUsage(tenantId: string): Promise<QuotaResponse> {
    const result = await this.db
      .prepare('SELECT quota_bytes, used_bytes FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first<{ quota_bytes: number; used_bytes: number }>();

    if (!result) {
      return { quotaBytes: 0, usedBytes: 0, availableBytes: 0, usagePercent: 0 };
    }

    const availableBytes = Math.max(0, result.quota_bytes - result.used_bytes);
    const usagePercent =
      result.quota_bytes > 0 ? Math.round((result.used_bytes / result.quota_bytes) * 100) : 0;

    return {
      quotaBytes: result.quota_bytes,
      usedBytes: result.used_bytes,
      availableBytes,
      usagePercent,
    };
  }

  async recalculateQuota(tenantId: string): Promise<number> {
    const result = await this.db
      .prepare(
        `SELECT COALESCE(SUM(size_bytes), 0) as total
         FROM files
         WHERE tenant_id = ? AND deleted_at IS NULL`
      )
      .bind(tenantId)
      .first<{ total: number }>();

    const totalUsed = result?.total ?? 0;
    const now = Date.now();

    await this.db
      .prepare('UPDATE tenants SET used_bytes = ?, updated_at = ? WHERE id = ?')
      .bind(totalUsed, now, tenantId)
      .run();

    return totalUsed;
  }

  // ============================================================================
  // Quota — Workspace Level
  // ============================================================================

  async checkWorkspaceQuota(
    workspaceId: string,
    fileSizeBytes: number
  ): Promise<QuotaCheckResult | null> {
    const result = await this.db
      .prepare('SELECT quota_bytes, used_bytes FROM workspaces WHERE id = ?')
      .bind(workspaceId)
      .first<{ quota_bytes: number | null; used_bytes: number }>();

    if (!result || result.quota_bytes === null) {
      return null;
    }

    const availableBytes = result.quota_bytes - result.used_bytes;
    const hasCapacity = availableBytes >= fileSizeBytes;

    return { hasCapacity, quotaBytes: result.quota_bytes, usedBytes: result.used_bytes, availableBytes };
  }

  async reserveWorkspaceQuota(workspaceId: string, sizeBytes: number): Promise<void> {
    const now = Date.now();

    const result = await this.db
      .prepare(
        `UPDATE workspaces
         SET used_bytes = used_bytes + ?, updated_at = ?
         WHERE id = ? AND (quota_bytes IS NULL OR (quota_bytes - used_bytes) >= ?)`
      )
      .bind(sizeBytes, now, workspaceId, sizeBytes)
      .run();

    if (result.meta.changes === 0) {
      throw new Error('Insufficient workspace quota or workspace not found');
    }
  }

  async releaseWorkspaceQuota(workspaceId: string, sizeBytes: number): Promise<void> {
    const now = Date.now();

    await this.db
      .prepare(
        `UPDATE workspaces
         SET used_bytes = MAX(0, used_bytes - ?), updated_at = ?
         WHERE id = ?`
      )
      .bind(sizeBytes, now, workspaceId)
      .run();
  }

  // ============================================================================
  // Migrations
  // ============================================================================

  async migrate(): Promise<void> {
    // D1 migrations are handled by Wrangler CLI
    // This is a no-op for the Cloudflare D1 adapter
  }

  // ============================================================================
  // Row Mappers (private)
  // ============================================================================

  private mapTenantRow(row: Record<string, unknown>): Tenant {
    return {
      id: row.id as string,
      name: row.name as string,
      apiKeyHash: row.api_key_hash as string,
      keyPrefix: (row.key_prefix as string) ?? null,
      quotaBytes: row.quota_bytes as number,
      usedBytes: row.used_bytes as number,
      allowedFileTypes: row.allowed_file_types
        ? (JSON.parse(row.allowed_file_types as string) as AllowedMimeType[])
        : null,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  private mapFileRow(row: Record<string, unknown>): StoredFile {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      workspaceId: (row.workspace_id as string) ?? null,
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

  private mapWorkspaceRow(row: Record<string, unknown>): Workspace {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      name: row.name as string,
      slug: row.slug as string,
      quotaBytes: (row.quota_bytes as number) ?? null,
      usedBytes: row.used_bytes as number,
      metadata: row.metadata
        ? (JSON.parse(row.metadata as string) as Record<string, unknown>)
        : null,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  private mapUploadSessionRow(row: Record<string, unknown>): UploadSession {
    return {
      id: row.id as string,
      fileId: row.file_id as string,
      presignedUrl: row.presigned_url as string,
      expiresAt: row.expires_at as number,
      status: row.status as UploadSessionStatus,
      createdAt: row.created_at as number,
    };
  }
}
