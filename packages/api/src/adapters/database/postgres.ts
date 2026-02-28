import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  QuotaResponse,
  AllowedMimeType,
  UploadSessionStatus,
  ProcessingStatus,
} from '@storage-brain/shared';
import { verifyApiKey } from '../../utils/crypto';

export interface PostgresAdapterConfig {
  connectionString: string;
  /** Override path to migration SQL file (absolute). Defaults to built-in 001_init.sql. */
  migrationPath?: string;
}

export class PostgresDatabaseAdapter implements DatabaseAdapter {
  private sql: postgres.Sql;
  private migrationPath: string | undefined;

  constructor(config: PostgresAdapterConfig) {
    this.sql = postgres(config.connectionString);
    this.migrationPath = config.migrationPath;
  }

  /** Gracefully close the connection pool */
  async close(): Promise<void> {
    await this.sql.end();
  }

  // ============================================================================
  // Tenant
  // ============================================================================

  async createTenant(input: CreateTenantInput): Promise<void> {
    const now = Date.now();
    await this.sql`
      INSERT INTO tenants (id, name, api_key_hash, quota_bytes, used_bytes, allowed_file_types, created_at, updated_at)
      VALUES (${input.id}, ${input.name}, ${input.apiKeyHash}, ${input.quotaBytes}, 0, ${JSON.stringify(input.allowedFileTypes)}, ${now}, ${now})
    `;
  }

  async getTenantByApiKey(apiKey: string): Promise<Tenant | null> {
    const rows = await this.sql`SELECT * FROM tenants`;

    for (const row of rows) {
      const tenant = this.mapTenantRow(row);
      const isValid = await verifyApiKey(apiKey, tenant.apiKeyHash);
      if (isValid) return tenant;
    }

    return null;
  }

  async getTenantByName(name: string): Promise<Tenant | null> {
    const rows = await this.sql`SELECT * FROM tenants WHERE name = ${name}`;
    const row = rows[0];
    return row ? this.mapTenantRow(row) : null;
  }

  async getTenantById(id: string): Promise<Tenant | null> {
    const rows = await this.sql`SELECT * FROM tenants WHERE id = ${id}`;
    const row = rows[0];
    return row ? this.mapTenantRow(row) : null;
  }

  async updateTenantApiKeyHash(tenantId: string, newHash: string): Promise<boolean> {
    const now = Date.now();
    const result = await this.sql`
      UPDATE tenants SET api_key_hash = ${newHash}, updated_at = ${now} WHERE id = ${tenantId}
    `;
    return result.count > 0;
  }

  // ============================================================================
  // Files
  // ============================================================================

  async createFile(input: CreateFileInput): Promise<void> {
    const now = Date.now();
    await this.sql`
      INSERT INTO files (id, tenant_id, workspace_id, original_name, stored_path, file_type, size_bytes, context, tags, metadata, processing_status, webhook_url, created_at, updated_at)
      VALUES (${input.id}, ${input.tenantId}, ${input.workspaceId ?? null}, ${input.originalName}, ${input.storedPath}, ${input.fileType}, ${input.sizeBytes}, ${input.context}, ${input.tags ? JSON.stringify(input.tags) : null}, ${null}, ${'pending'}, ${input.webhookUrl ?? null}, ${now}, ${now})
    `;
  }

  async getFileById(fileId: string, tenantId: string): Promise<StoredFile | null> {
    const rows = await this.sql`
      SELECT * FROM files WHERE id = ${fileId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    `;
    const row = rows[0];
    return row ? this.mapFileRow(row) : null;
  }

  async getFileByIdUnscoped(fileId: string): Promise<StoredFile | null> {
    const rows = await this.sql`
      SELECT * FROM files WHERE id = ${fileId} AND deleted_at IS NULL
    `;
    const row = rows[0];
    return row ? this.mapFileRow(row) : null;
  }

  async getFileByStoredPath(storedPath: string): Promise<StoredFile | null> {
    const rows = await this.sql`
      SELECT * FROM files WHERE stored_path = ${storedPath} AND deleted_at IS NULL
    `;
    const row = rows[0];
    return row ? this.mapFileRow(row) : null;
  }

  async listFilesByTenant(tenantId: string, options: ListFilesInput): Promise<ListFilesResult> {
    const { limit = 20, cursor, context, fileType, workspaceId } = options;

    // Build dynamic conditions
    const conditions: postgres.PendingQuery<postgres.Row[]>[] = [
      this.sql`tenant_id = ${tenantId}`,
      this.sql`deleted_at IS NULL`,
    ];

    if (workspaceId) conditions.push(this.sql`workspace_id = ${workspaceId}`);
    if (context) conditions.push(this.sql`context = ${context}`);
    if (fileType) conditions.push(this.sql`file_type = ${fileType}`);

    if (cursor) {
      try {
        const cursorTimestamp = parseInt(atob(cursor), 10);
        conditions.push(this.sql`created_at < ${cursorTimestamp}`);
      } catch {
        // Invalid cursor, ignore
      }
    }

    const where = conditions.reduce(
      (acc, cond) => this.sql`${acc} AND ${cond}`,
    );

    const countRows = await this.sql`SELECT COUNT(*)::int as count FROM files WHERE ${where}`;
    const total = (countRows[0]?.count as number) ?? 0;

    const fileRows = await this.sql`
      SELECT * FROM files WHERE ${where} ORDER BY created_at DESC LIMIT ${limit + 1}
    `;

    const files = fileRows.map((row) => this.mapFileRow(row));
    const hasMore = files.length > limit;
    if (hasMore) files.pop();

    const lastFile = files[files.length - 1];
    const nextCursor = hasMore && lastFile ? btoa(lastFile.createdAt.toString()) : null;

    return { files, nextCursor, total };
  }

  async softDeleteFile(fileId: string, tenantId: string): Promise<void> {
    const now = Date.now();
    await this.sql`
      UPDATE files SET deleted_at = ${now}, updated_at = ${now}
      WHERE id = ${fileId} AND tenant_id = ${tenantId}
    `;
  }

  async updateFileMetadata(
    fileId: string,
    metadata: Record<string, unknown>,
    status: ProcessingStatus,
  ): Promise<void> {
    const now = Date.now();
    await this.sql`
      UPDATE files SET metadata = ${JSON.stringify(metadata)}, processing_status = ${status}, updated_at = ${now}
      WHERE id = ${fileId}
    `;
  }

  async updateFileProcessingStatus(fileId: string, status: ProcessingStatus): Promise<void> {
    const now = Date.now();
    await this.sql`
      UPDATE files SET processing_status = ${status}, updated_at = ${now} WHERE id = ${fileId}
    `;
  }

  async updateFileSizeBytes(fileId: string, sizeBytes: number): Promise<void> {
    const now = Date.now();
    await this.sql`
      UPDATE files SET size_bytes = ${sizeBytes}, updated_at = ${now} WHERE id = ${fileId}
    `;
  }

  // ============================================================================
  // Workspaces
  // ============================================================================

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const now = Date.now();
    await this.sql`
      INSERT INTO workspaces (id, tenant_id, name, slug, quota_bytes, used_bytes, metadata, created_at, updated_at)
      VALUES (${input.id}, ${input.tenantId}, ${input.name}, ${input.slug}, ${input.quotaBytes ?? null}, 0, ${input.metadata ? JSON.stringify(input.metadata) : null}, ${now}, ${now})
    `;

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
    const rows = await this.sql`
      SELECT * FROM workspaces WHERE id = ${workspaceId} AND tenant_id = ${tenantId}
    `;
    const row = rows[0];
    return row ? this.mapWorkspaceRow(row) : null;
  }

  async listWorkspacesByTenant(tenantId: string): Promise<Workspace[]> {
    const rows = await this.sql`
      SELECT * FROM workspaces WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
    `;
    return rows.map((row) => this.mapWorkspaceRow(row));
  }

  async updateWorkspace(
    workspaceId: string,
    tenantId: string,
    updates: UpdateWorkspaceInput,
  ): Promise<Workspace | null> {
    const now = Date.now();
    const sets: postgres.PendingQuery<postgres.Row[]>[] = [
      this.sql`updated_at = ${now}`,
    ];

    if (updates.name !== undefined) sets.push(this.sql`name = ${updates.name}`);
    if (updates.quotaBytes !== undefined) sets.push(this.sql`quota_bytes = ${updates.quotaBytes}`);
    if (updates.metadata !== undefined) sets.push(this.sql`metadata = ${JSON.stringify(updates.metadata)}`);

    const setClause = sets.reduce((acc, s) => this.sql`${acc}, ${s}`);

    await this.sql`
      UPDATE workspaces SET ${setClause} WHERE id = ${workspaceId} AND tenant_id = ${tenantId}
    `;

    return this.getWorkspaceById(workspaceId, tenantId);
  }

  async deleteWorkspace(workspaceId: string, tenantId: string): Promise<void> {
    await this.sql`
      DELETE FROM workspaces WHERE id = ${workspaceId} AND tenant_id = ${tenantId}
    `;
  }

  async getActiveFilesByWorkspace(workspaceId: string, tenantId: string): Promise<StoredFile[]> {
    const rows = await this.sql`
      SELECT * FROM files WHERE workspace_id = ${workspaceId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    `;
    return rows.map((row) => this.mapFileRow(row));
  }

  async softDeleteFilesByWorkspace(workspaceId: string, tenantId: string): Promise<void> {
    const now = Date.now();
    await this.sql`
      UPDATE files SET deleted_at = ${now}, updated_at = ${now}
      WHERE workspace_id = ${workspaceId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    `;
  }

  // ============================================================================
  // Upload Sessions
  // ============================================================================

  async createUploadSession(input: CreateUploadSessionInput): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.sql`
      INSERT INTO upload_sessions (id, file_id, presigned_url, expires_at, status, created_at)
      VALUES (${id}, ${input.fileId}, ${input.presignedUrl}, ${input.expiresAt}, ${'pending'}, ${now})
    `;
    return id;
  }

  async getUploadSessionByFileId(fileId: string): Promise<UploadSession | null> {
    const rows = await this.sql`
      SELECT * FROM upload_sessions WHERE file_id = ${fileId} ORDER BY created_at DESC LIMIT 1
    `;
    const row = rows[0];
    return row ? this.mapUploadSessionRow(row) : null;
  }

  async updateUploadSessionStatus(sessionId: string, status: UploadSessionStatus): Promise<void> {
    await this.sql`
      UPDATE upload_sessions SET status = ${status} WHERE id = ${sessionId}
    `;
  }

  // ============================================================================
  // Quota — Tenant Level
  // ============================================================================

  async checkQuota(tenantId: string, fileSizeBytes: number): Promise<QuotaCheckResult> {
    const rows = await this.sql`
      SELECT quota_bytes, used_bytes FROM tenants WHERE id = ${tenantId}
    `;

    const row = rows[0];
    if (!row) {
      return { hasCapacity: false, quotaBytes: 0, usedBytes: 0, availableBytes: 0 };
    }

    const quotaBytes = Number(row.quota_bytes);
    const usedBytes = Number(row.used_bytes);
    const availableBytes = quotaBytes - usedBytes;
    const hasCapacity = availableBytes >= fileSizeBytes;

    return { hasCapacity, quotaBytes, usedBytes, availableBytes };
  }

  async reserveQuota(tenantId: string, sizeBytes: number): Promise<void> {
    const now = Date.now();
    const result = await this.sql`
      UPDATE tenants
      SET used_bytes = used_bytes + ${sizeBytes}, updated_at = ${now}
      WHERE id = ${tenantId} AND (quota_bytes - used_bytes) >= ${sizeBytes}
    `;

    if (result.count === 0) {
      throw new Error('Insufficient quota or tenant not found');
    }
  }

  async releaseQuota(tenantId: string, sizeBytes: number): Promise<void> {
    const now = Date.now();
    await this.sql`
      UPDATE tenants
      SET used_bytes = GREATEST(0, used_bytes - ${sizeBytes}), updated_at = ${now}
      WHERE id = ${tenantId}
    `;
  }

  async getQuotaUsage(tenantId: string): Promise<QuotaResponse> {
    const rows = await this.sql`
      SELECT quota_bytes, used_bytes FROM tenants WHERE id = ${tenantId}
    `;

    const row = rows[0];
    if (!row) {
      return { quotaBytes: 0, usedBytes: 0, availableBytes: 0, usagePercent: 0 };
    }

    const quotaBytes = Number(row.quota_bytes);
    const usedBytes = Number(row.used_bytes);
    const availableBytes = Math.max(0, quotaBytes - usedBytes);
    const usagePercent = quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0;

    return { quotaBytes, usedBytes, availableBytes, usagePercent };
  }

  async recalculateQuota(tenantId: string): Promise<number> {
    const rows = await this.sql`
      SELECT COALESCE(SUM(size_bytes), 0)::bigint as total
      FROM files
      WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    `;

    const row = rows[0];
    const totalUsed = row ? Number(row.total) : 0;
    const now = Date.now();

    await this.sql`
      UPDATE tenants SET used_bytes = ${totalUsed}, updated_at = ${now} WHERE id = ${tenantId}
    `;

    return totalUsed;
  }

  // ============================================================================
  // Quota — Workspace Level
  // ============================================================================

  async checkWorkspaceQuota(
    workspaceId: string,
    fileSizeBytes: number,
  ): Promise<QuotaCheckResult | null> {
    const rows = await this.sql`
      SELECT quota_bytes, used_bytes FROM workspaces WHERE id = ${workspaceId}
    `;

    const row = rows[0];
    if (!row || row.quota_bytes === null) return null;

    const quotaBytes = Number(row.quota_bytes);
    const usedBytes = Number(row.used_bytes);
    const availableBytes = quotaBytes - usedBytes;
    const hasCapacity = availableBytes >= fileSizeBytes;

    return { hasCapacity, quotaBytes, usedBytes, availableBytes };
  }

  async reserveWorkspaceQuota(workspaceId: string, sizeBytes: number): Promise<void> {
    const now = Date.now();
    const result = await this.sql`
      UPDATE workspaces
      SET used_bytes = used_bytes + ${sizeBytes}, updated_at = ${now}
      WHERE id = ${workspaceId} AND (quota_bytes IS NULL OR (quota_bytes - used_bytes) >= ${sizeBytes})
    `;

    if (result.count === 0) {
      throw new Error('Insufficient workspace quota or workspace not found');
    }
  }

  async releaseWorkspaceQuota(workspaceId: string, sizeBytes: number): Promise<void> {
    const now = Date.now();
    await this.sql`
      UPDATE workspaces
      SET used_bytes = GREATEST(0, used_bytes - ${sizeBytes}), updated_at = ${now}
      WHERE id = ${workspaceId}
    `;
  }

  // ============================================================================
  // Migrations
  // ============================================================================

  async migrate(): Promise<void> {
    const sqlPath =
      this.migrationPath ??
      resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations/001_init.sql');
    const migrationSQL = readFileSync(sqlPath, 'utf-8');
    await this.sql.unsafe(migrationSQL);
  }

  // ============================================================================
  // Row Mappers (private)
  // ============================================================================

  private mapTenantRow(row: postgres.Row): Tenant {
    return {
      id: row.id as string,
      name: row.name as string,
      apiKeyHash: row.api_key_hash as string,
      quotaBytes: Number(row.quota_bytes),
      usedBytes: Number(row.used_bytes),
      allowedFileTypes: row.allowed_file_types
        ? (JSON.parse(row.allowed_file_types as string) as AllowedMimeType[])
        : null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private mapFileRow(row: postgres.Row): StoredFile {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      workspaceId: (row.workspace_id as string) ?? null,
      originalName: row.original_name as string,
      storedPath: row.stored_path as string,
      fileType: row.file_type as AllowedMimeType,
      sizeBytes: Number(row.size_bytes),
      context: (row.context as string) ?? null,
      tags: row.tags ? (JSON.parse(row.tags as string) as Record<string, string>) : null,
      metadata: row.metadata
        ? (JSON.parse(row.metadata as string) as Record<string, unknown>)
        : null,
      processingStatus: row.processing_status as ProcessingStatus,
      webhookUrl: (row.webhook_url as string) ?? null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      deletedAt: row.deleted_at ? Number(row.deleted_at) : null,
    };
  }

  private mapWorkspaceRow(row: postgres.Row): Workspace {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      name: row.name as string,
      slug: row.slug as string,
      quotaBytes: row.quota_bytes !== null ? Number(row.quota_bytes) : null,
      usedBytes: Number(row.used_bytes),
      metadata: row.metadata
        ? (JSON.parse(row.metadata as string) as Record<string, unknown>)
        : null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private mapUploadSessionRow(row: postgres.Row): UploadSession {
    return {
      id: row.id as string,
      fileId: row.file_id as string,
      presignedUrl: row.presigned_url as string,
      expiresAt: Number(row.expires_at),
      status: row.status as UploadSessionStatus,
      createdAt: Number(row.created_at),
    };
  }
}
