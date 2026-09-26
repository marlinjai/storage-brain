import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DatabaseAdapter,
  CreateTenantInput,
  ListFilesResult,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  QuotaCheckResult,
  CreatePendingUploadInput,
  CreatePendingUploadResult,
  UploadSessionOutcome,
  UploadSessionStatus,
  MigrateFilesToWorkspaceInput,
  MigrateFilesToWorkspaceResult,
  FileContextAggregate,
  Tenant,
  StoredFile,
  UploadSession,
  Workspace,
  ListFilesInput,
  ListTenantsInput,
  ListTenantsResult,
  UpdateTenantInput,
  ErasureEventRecord,
  RecordErasureEventInput,
  QuotaResponse,
  AllowedMimeType,
  ProcessingStatus,
} from '@storage-brain/shared';
import { hashApiKey, verifyApiKey } from '../../utils/crypto';

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
      INSERT INTO tenants (id, name, api_key_hash, key_prefix, quota_bytes, used_bytes, allowed_file_types, auth_workspace_id, auth_tenant_id, created_at, updated_at)
      VALUES (${input.id}, ${input.name}, ${input.apiKeyHash}, ${input.keyPrefix}, ${input.quotaBytes}, 0, ${JSON.stringify(input.allowedFileTypes)}, ${input.authWorkspaceId ?? null}, ${input.authTenantId ?? null}, ${now}, ${now})
    `;
  }

  async getTenantByApiKey(apiKey: string): Promise<Tenant | null> {
    const apiKeyHash = await hashApiKey(apiKey);
    const rows = await this.sql`SELECT * FROM tenants WHERE api_key_hash = ${apiKeyHash}`;

    const row = rows[0];
    if (!row) return null;

    const tenant = this.mapTenantRow(row);
    const isValid = await verifyApiKey(apiKey, tenant.apiKeyHash);
    return isValid ? tenant : null;
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

  async getTenantByAuthWorkspaceId(authWorkspaceId: string): Promise<Tenant | null> {
    const rows = await this.sql`SELECT * FROM tenants WHERE auth_workspace_id = ${authWorkspaceId}`;
    const row = rows[0];
    return row ? this.mapTenantRow(row) : null;
  }

  async getTenantByAuthTenantId(authTenantId: string): Promise<Tenant | null> {
    const rows = await this.sql`SELECT * FROM tenants WHERE auth_tenant_id = ${authTenantId}`;
    const row = rows[0];
    return row ? this.mapTenantRow(row) : null;
  }

  async findTenantsForErasure(
    authTenantId: string | null,
    authWorkspaceIds: string[]
  ): Promise<Tenant[]> {
    const clauses: postgres.PendingQuery<postgres.Row[]>[] = [];
    if (authTenantId) clauses.push(this.sql`auth_tenant_id = ${authTenantId}`);
    if (authWorkspaceIds.length > 0) {
      clauses.push(this.sql`auth_workspace_id = ANY(${authWorkspaceIds})`);
    }

    // No selector -> nothing to erase (never a table scan).
    if (clauses.length === 0) return [];

    // OR of the two bindings; a row satisfying both still appears once.
    const where = clauses.reduce((acc, clause) => this.sql`${acc} OR ${clause}`);
    const rows = await this.sql`SELECT * FROM tenants WHERE ${where}`;
    return rows.map((row) => this.mapTenantRow(row));
  }

  async updateTenantApiKeyHash(
    tenantId: string,
    newHash: string,
    keyPrefix: string
  ): Promise<boolean> {
    const now = Date.now();
    const result = await this.sql`
      UPDATE tenants SET api_key_hash = ${newHash}, key_prefix = ${keyPrefix}, updated_at = ${now} WHERE id = ${tenantId}
    `;
    return result.count > 0;
  }

  async listTenants(input: ListTenantsInput): Promise<ListTenantsResult> {
    const { limit = 20, cursor } = input;

    if (cursor) {
      let cursorTimestamp: number;
      try {
        cursorTimestamp = parseInt(atob(cursor), 10);
      } catch {
        // Invalid cursor — fall through without filter
        cursorTimestamp = 0;
      }

      if (cursorTimestamp > 0) {
        const countRows = await this
          .sql`SELECT COUNT(*)::int as count FROM tenants WHERE created_at < ${cursorTimestamp}`;
        const total = (countRows[0]?.count as number) ?? 0;

        const tenantRows = await this.sql`
          SELECT * FROM tenants WHERE created_at < ${cursorTimestamp} ORDER BY created_at DESC LIMIT ${limit + 1}
        `;

        const tenants = tenantRows.map((row) => this.mapTenantRow(row));
        const hasMore = tenants.length > limit;
        if (hasMore) tenants.pop();

        const lastTenant = tenants[tenants.length - 1];
        const nextCursor = hasMore && lastTenant ? btoa(lastTenant.createdAt.toString()) : null;

        return { tenants, nextCursor, total };
      }
    }

    const countRows = await this.sql`SELECT COUNT(*)::int as count FROM tenants`;
    const total = (countRows[0]?.count as number) ?? 0;

    const tenantRows = await this.sql`
      SELECT * FROM tenants ORDER BY created_at DESC LIMIT ${limit + 1}
    `;

    const tenants = tenantRows.map((row) => this.mapTenantRow(row));
    const hasMore = tenants.length > limit;
    if (hasMore) tenants.pop();

    const lastTenant = tenants[tenants.length - 1];
    const nextCursor = hasMore && lastTenant ? btoa(lastTenant.createdAt.toString()) : null;

    return { tenants, nextCursor, total };
  }

  async updateTenant(tenantId: string, updates: UpdateTenantInput): Promise<Tenant | null> {
    const now = Date.now();
    const sets: postgres.PendingQuery<postgres.Row[]>[] = [this.sql`updated_at = ${now}`];

    if (updates.name !== undefined) sets.push(this.sql`name = ${updates.name}`);
    if (updates.quotaBytes !== undefined) sets.push(this.sql`quota_bytes = ${updates.quotaBytes}`);
    if (updates.allowedFileTypes !== undefined) {
      sets.push(
        this
          .sql`allowed_file_types = ${updates.allowedFileTypes ? JSON.stringify(updates.allowedFileTypes) : null}`
      );
    }
    if (updates.authWorkspaceId !== undefined) {
      sets.push(this.sql`auth_workspace_id = ${updates.authWorkspaceId}`);
    }
    if (updates.authTenantId !== undefined) {
      sets.push(this.sql`auth_tenant_id = ${updates.authTenantId}`);
    }

    const setClause = sets.reduce((acc, s) => this.sql`${acc}, ${s}`);

    await this.sql`UPDATE tenants SET ${setClause} WHERE id = ${tenantId}`;

    return this.getTenantById(tenantId);
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    // Delete in order: upload_sessions → files → workspaces → tenant
    await this.sql`
      DELETE FROM upload_sessions WHERE file_id IN (SELECT id FROM files WHERE tenant_id = ${tenantId})
    `;

    await this.sql`DELETE FROM files WHERE tenant_id = ${tenantId}`;
    await this.sql`DELETE FROM workspaces WHERE tenant_id = ${tenantId}`;

    const result = await this.sql`DELETE FROM tenants WHERE id = ${tenantId}`;
    return result.count > 0;
  }

  // ============================================================================
  // Files
  // ============================================================================

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

  async getAllStoredPathsByTenant(tenantId: string): Promise<string[]> {
    // Every file row for the tenant, including soft-deleted ones (deleted_at NOT
    // filtered) so erasure purges tombstoned objects too.
    const rows = await this.sql`SELECT stored_path FROM files WHERE tenant_id = ${tenantId}`;
    return rows.map((row) => row.stored_path as string);
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

    const where = conditions.reduce((acc, cond) => this.sql`${acc} AND ${cond}`);

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

  async updateFileMetadata(
    fileId: string,
    metadata: Record<string, unknown>,
    status: ProcessingStatus
  ): Promise<void> {
    const now = Date.now();
    await this.sql`
      UPDATE files SET metadata = ${JSON.stringify(metadata)}, processing_status = ${status}, updated_at = ${now}
      WHERE id = ${fileId}
    `;
  }

  async renameFile(
    fileId: string,
    tenantId: string,
    originalName: string
  ): Promise<StoredFile | null> {
    const now = Date.now();
    await this.sql`
      UPDATE files SET original_name = ${originalName}, updated_at = ${now}
      WHERE id = ${fileId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    `;
    return this.getFileById(fileId, tenantId);
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
    updates: UpdateWorkspaceInput
  ): Promise<Workspace | null> {
    const now = Date.now();
    const sets: postgres.PendingQuery<postgres.Row[]>[] = [this.sql`updated_at = ${now}`];

    if (updates.name !== undefined) sets.push(this.sql`name = ${updates.name}`);
    if (updates.quotaBytes !== undefined) sets.push(this.sql`quota_bytes = ${updates.quotaBytes}`);
    if (updates.metadata !== undefined)
      sets.push(this.sql`metadata = ${JSON.stringify(updates.metadata)}`);

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

  async migrateFilesToWorkspace(
    input: MigrateFilesToWorkspaceInput
  ): Promise<MigrateFilesToWorkspaceResult> {
    const { tenantId, workspaceId, filter, onlyUnassigned } = input;

    // Explicit-ID filter with an empty list can never match — short-circuit
    // before opening a transaction. (The schema forbids this, but be defensive.)
    if ('fileIds' in filter && filter.fileIds.length === 0) {
      return { migratedCount: 0, totalBytes: 0 };
    }

    const now = Date.now();

    return this.sql.begin(async (tx) => {
      // postgres.js types `Omit` the tagged-template call signature off the
      // transaction handle; cast back to the callable Sql type.
      const sql = tx as unknown as postgres.Sql;

      // Selection: active files of this tenant, not already in the target
      // workspace, matching the requested filter.
      const conditions: postgres.PendingQuery<postgres.Row[]>[] = [
        sql`tenant_id = ${tenantId}`,
        sql`deleted_at IS NULL`,
        sql`workspace_id IS DISTINCT FROM ${workspaceId}`,
      ];

      if (onlyUnassigned) conditions.push(sql`workspace_id IS NULL`);

      if ('tag' in filter) {
        // tags is a TEXT column holding a JSON object; cast to jsonb to read a key.
        conditions.push(sql`tags IS NOT NULL`);
        conditions.push(sql`(tags::jsonb ->> ${filter.tag.key}) = ${filter.tag.value}`);
      } else {
        conditions.push(sql`id IN ${sql(filter.fileIds)}`);
      }

      const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

      const rows = await sql`
        SELECT id, size_bytes, workspace_id FROM files WHERE ${where} FOR UPDATE
      `;

      if (rows.length === 0) {
        return { migratedCount: 0, totalBytes: 0 };
      }

      const ids = rows.map((row) => row.id as string);
      let totalBytes = 0;
      const sourceReleases = new Map<string, number>();
      for (const row of rows) {
        const size = Number(row.size_bytes);
        totalBytes += size;
        const source = (row.workspace_id as string | null) ?? null;
        if (source) {
          sourceReleases.set(source, (sourceReleases.get(source) ?? 0) + size);
        }
      }

      // Release bytes from each source workspace the files are leaving.
      for (const [source, bytes] of sourceReleases) {
        await sql`
          UPDATE workspaces SET used_bytes = GREATEST(0, used_bytes - ${bytes}), updated_at = ${now}
          WHERE id = ${source}
        `;
      }

      // Reassign the files.
      await sql`
        UPDATE files SET workspace_id = ${workspaceId}, updated_at = ${now}
        WHERE id IN ${sql(ids)}
      `;

      // Add moved bytes to the target workspace (no quota-limit enforcement).
      await sql`
        UPDATE workspaces SET used_bytes = used_bytes + ${totalBytes}, updated_at = ${now}
        WHERE id = ${workspaceId}
      `;

      return { migratedCount: rows.length, totalBytes };
    });
  }

  async aggregateFileContexts(
    tenantId: string,
    workspaceId?: string
  ): Promise<FileContextAggregate[]> {
    const conditions: postgres.PendingQuery<postgres.Row[]>[] = [
      this.sql`tenant_id = ${tenantId}`,
      this.sql`deleted_at IS NULL`,
    ];
    if (workspaceId) conditions.push(this.sql`workspace_id = ${workspaceId}`);

    const where = conditions.reduce((acc, cond) => this.sql`${acc} AND ${cond}`);

    const rows = await this.sql`
      SELECT
        COALESCE(NULLIF(context, ''), 'default') AS context,
        COUNT(*)::int AS file_count,
        COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes
      FROM files
      WHERE ${where}
      GROUP BY COALESCE(NULLIF(context, ''), 'default')
      ORDER BY total_bytes DESC
    `;

    return rows.map((row) => ({
      context: row.context as string,
      fileCount: Number(row.file_count),
      totalBytes: Number(row.total_bytes),
    }));
  }

  // ============================================================================
  // Upload Sessions and quota accounting (contract: DatabaseAdapter)
  //
  // Lock order is always file row before session row, in every method that
  // takes both, so a delete racing a settle serialises instead of deadlocking.
  // ============================================================================

  async createPendingUpload(input: CreatePendingUploadInput): Promise<CreatePendingUploadResult> {
    const { file, session } = input;
    const size = file.sizeBytes;
    const workspaceId = file.workspaceId ?? null;
    const sessionId = crypto.randomUUID();
    const now = Date.now();

    try {
      return await this.sql.begin(async (tx) => {
        const sql = tx as unknown as postgres.Sql;

        // Conditional increments: the row lock taken by UPDATE serialises
        // concurrent reservations, and each re-checks the capacity it sees.
        const tenantRows = await sql`
          UPDATE tenants SET used_bytes = used_bytes + ${size}, updated_at = ${now}
          WHERE id = ${file.tenantId} AND (quota_bytes - used_bytes) >= ${size}
          RETURNING id
        `;
        if (tenantRows.length === 0) throw new NoCapacity();

        if (workspaceId) {
          const wsRows = await sql`
            UPDATE workspaces SET used_bytes = used_bytes + ${size}, updated_at = ${now}
            WHERE id = ${workspaceId} AND tenant_id = ${file.tenantId}
              AND (quota_bytes IS NULL OR (quota_bytes - used_bytes) >= ${size})
            RETURNING id
          `;
          // Rolls back the tenant increment with the rest of the transaction.
          if (wsRows.length === 0) throw new NoCapacity();
        }

        await sql`
          INSERT INTO files (id, tenant_id, workspace_id, original_name, stored_path, file_type, size_bytes, context, tags, metadata, processing_status, webhook_url, created_at, updated_at)
          VALUES (${file.id}, ${file.tenantId}, ${workspaceId}, ${file.originalName}, ${file.storedPath}, ${file.fileType}, ${size}, ${file.context}, ${file.tags ? JSON.stringify(file.tags) : null}, ${null}, ${'pending'}, ${file.webhookUrl ?? null}, ${now}, ${now})
        `;
        await sql`
          INSERT INTO upload_sessions (id, file_id, tenant_id, presigned_url, expires_at, status, created_at)
          VALUES (${sessionId}, ${file.id}, ${file.tenantId}, ${session.presignedUrl}, ${session.expiresAt}, ${'pending'}, ${now})
        `;
        return { created: true as const, sessionId };
      });
    } catch (err) {
      if (err instanceof NoCapacity) return { created: false };
      throw err;
    }
  }

  async getUploadSessionByFileId(fileId: string): Promise<UploadSession | null> {
    const rows = await this.sql`
      SELECT * FROM upload_sessions WHERE file_id = ${fileId} ORDER BY created_at DESC LIMIT 1
    `;
    const row = rows[0];
    return row ? this.mapUploadSessionRow(row) : null;
  }

  async claimUploadSession(sessionId: string): Promise<boolean> {
    const rows = await this.sql`
      UPDATE upload_sessions SET status = ${'uploading'}
      WHERE id = ${sessionId} AND status = ${'pending'}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async settleUploadSession(sessionId: string, outcome: UploadSessionOutcome): Promise<boolean> {
    const now = Date.now();
    const actualBytes = outcome.status === 'completed' ? outcome.actualBytes : 0;
    const processingStatus: ProcessingStatus =
      outcome.status === 'completed' ? 'completed' : 'failed';

    return this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;

      const sessions = await sql`SELECT file_id FROM upload_sessions WHERE id = ${sessionId}`;
      const fileId = sessions[0]?.file_id as string | undefined;
      if (!fileId) return false;

      // File row first (see the lock-order note above).
      const files = await sql`
        SELECT tenant_id, workspace_id, size_bytes, deleted_at FROM files
        WHERE id = ${fileId} FOR UPDATE
      `;

      // The status guard makes settling exactly-once: a second settle, or one
      // racing a delete that already closed the session, matches no row.
      const settled = await sql`
        UPDATE upload_sessions SET status = ${outcome.status}
        WHERE id = ${sessionId} AND status IN ${sql(['pending', 'uploading'])}
        RETURNING id
      `;
      if (settled.length === 0) return false;

      const file = files[0];
      if (!file || file.deleted_at !== null) return true;

      const delta = actualBytes - Number(file.size_bytes);
      if (delta !== 0) {
        await sql`
          UPDATE tenants SET used_bytes = GREATEST(0, used_bytes + ${delta}), updated_at = ${now}
          WHERE id = ${file.tenant_id as string}
        `;
        if (file.workspace_id) {
          await sql`
            UPDATE workspaces SET used_bytes = GREATEST(0, used_bytes + ${delta}), updated_at = ${now}
            WHERE id = ${file.workspace_id as string}
          `;
        }
      }
      await sql`
        UPDATE files SET size_bytes = ${actualBytes}, processing_status = ${processingStatus}, updated_at = ${now}
        WHERE id = ${fileId}
      `;
      return true;
    });
  }

  async expireStaleUploadSessions(now: number, uploadingGraceMs: number): Promise<number> {
    const rows = await this.sql`
      SELECT id FROM upload_sessions
      WHERE (status = ${'pending'} AND expires_at < ${now})
         OR (status = ${'uploading'} AND expires_at < ${now - uploadingGraceMs})
      ORDER BY expires_at
      LIMIT 500
    `;
    let expired = 0;
    for (const row of rows) {
      if (await this.settleUploadSession(row.id as string, { status: 'expired' })) expired += 1;
    }
    return expired;
  }

  async deleteFileAndReleaseQuota(fileId: string, tenantId: string): Promise<StoredFile | null> {
    const now = Date.now();
    return this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;

      // The UPDATE locks the file row and returns the size as of any settle
      // that committed before it, so the release is always the current value.
      const rows = await sql`
        UPDATE files SET deleted_at = ${now}, updated_at = ${now}
        WHERE id = ${fileId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
        RETURNING *
      `;
      const row = rows[0];
      if (!row) return null;
      const file = this.mapFileRow(row);

      await releaseBytes(sql, file.tenantId, file.workspaceId, file.sizeBytes, now);
      await sql`
        UPDATE upload_sessions SET status = ${'failed'}
        WHERE file_id = ${fileId} AND status IN ${sql(['pending', 'uploading'])}
      `;
      return file;
    });
  }

  async deleteWorkspaceFilesAndReleaseQuota(
    workspaceId: string,
    tenantId: string
  ): Promise<number> {
    const now = Date.now();
    return this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;

      const rows = await sql`
        UPDATE files SET deleted_at = ${now}, updated_at = ${now}
        WHERE workspace_id = ${workspaceId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
        RETURNING id, size_bytes
      `;
      if (rows.length === 0) return 0;

      const total = rows.reduce((sum, r) => sum + Number(r.size_bytes), 0);
      await releaseBytes(sql, tenantId, workspaceId, total, now);
      await sql`
        UPDATE upload_sessions SET status = ${'failed'}
        WHERE file_id IN ${sql(rows.map((r) => r.id as string))}
          AND status IN ${sql(['pending', 'uploading'])}
      `;
      return total;
    });
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
    fileSizeBytes: number
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

  // ============================================================================
  // Erasure webhook idempotency ledger
  // ============================================================================

  async getErasureEvent(eventId: string): Promise<ErasureEventRecord | null> {
    const rows = await this.sql`
      SELECT event_id, kind, processed_at FROM erasure_events WHERE event_id = ${eventId}
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      eventId: row.event_id as string,
      kind: row.kind as string,
      processedAt: Number(row.processed_at),
    };
  }

  async recordErasureEvent(input: RecordErasureEventInput): Promise<void> {
    await this.sql`
      INSERT INTO erasure_events (event_id, kind, auth_tenant_id, matched_tenant_count, processed_at)
      VALUES (${input.eventId}, ${input.kind}, ${input.authTenantId ?? null}, ${input.matchedTenantCount}, ${input.processedAt})
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
      keyPrefix: (row.key_prefix as string) ?? null,
      quotaBytes: Number(row.quota_bytes),
      usedBytes: Number(row.used_bytes),
      allowedFileTypes: row.allowed_file_types
        ? (JSON.parse(row.allowed_file_types as string) as AllowedMimeType[])
        : null,
      authWorkspaceId: (row.auth_workspace_id as string) ?? null,
      authTenantId: (row.auth_tenant_id as string) ?? null,
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
      tenantId: (row.tenant_id as string) ?? null,
      presignedUrl: row.presigned_url as string,
      expiresAt: Number(row.expires_at),
      status: row.status as UploadSessionStatus,
      createdAt: Number(row.created_at),
    };
  }
}

/** Thrown inside a reservation transaction to roll it back: no room left. */
class NoCapacity extends Error {}

/** Release bytes from a tenant and, when set, one of its workspaces (clamped at 0). */
async function releaseBytes(
  sql: postgres.Sql,
  tenantId: string,
  workspaceId: string | null,
  bytes: number,
  now: number
): Promise<void> {
  if (bytes <= 0) return;
  await sql`
    UPDATE tenants SET used_bytes = GREATEST(0, used_bytes - ${bytes}), updated_at = ${now}
    WHERE id = ${tenantId}
  `;
  if (workspaceId) {
    await sql`
      UPDATE workspaces SET used_bytes = GREATEST(0, used_bytes - ${bytes}), updated_at = ${now}
      WHERE id = ${workspaceId}
    `;
  }
}
