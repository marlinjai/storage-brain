import type {
  Tenant,
  StoredFile,
  UploadSession,
  Workspace,
  ListFilesInput,
  QuotaResponse,
} from './types';
import type { AllowedMimeType, ProcessingStatus } from './constants';

export interface CreateTenantInput {
  id: string;
  name: string;
  apiKeyHash: string;
  keyPrefix: string;
  quotaBytes: number;
  allowedFileTypes: AllowedMimeType[] | null;
  authWorkspaceId?: string;
  /** auth-brain COMPANY (tenant) this storage tenant maps to (company-isolation S1). */
  authTenantId?: string;
}

export interface CreateFileInput {
  id: string;
  tenantId: string;
  originalName: string;
  storedPath: string;
  fileType: AllowedMimeType;
  sizeBytes: number;
  context: string | null;
  tags: Record<string, string> | null;
  webhookUrl?: string;
  workspaceId?: string;
}

export interface ListFilesResult {
  files: StoredFile[];
  nextCursor: string | null;
  total: number;
}

export interface CreateWorkspaceInput {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  quotaBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkspaceInput {
  name?: string;
  quotaBytes?: number | null;
  metadata?: Record<string, unknown>;
}

export interface QuotaCheckResult {
  hasCapacity: boolean;
  quotaBytes: number;
  usedBytes: number;
  availableBytes: number;
}

/**
 * How an upload session ended. `completed` stores `actualBytes`; `failed` (the
 * transfer was rejected, cut off or could not be stored) and `expired` (the
 * signed URL lapsed unused, or a transfer never finished) store nothing.
 */
export type UploadSessionOutcome =
  | { status: 'completed'; actualBytes: number }
  | { status: 'failed' }
  | { status: 'expired' };

export interface CreatePendingUploadInput {
  /** The file row to create; `sizeBytes` is the declared size, reserved as quota. */
  file: CreateFileInput;
  session: { presignedUrl: string; expiresAt: number };
}

export type CreatePendingUploadResult =
  | { created: true; sessionId: string }
  /** Nothing was written: the tenant (or workspace) had no room for the reservation. */
  | { created: false };

/** Selector for which of a tenant's files to migrate — by tag or by explicit IDs. */
export type MigrateFilesFilter = { tag: { key: string; value: string } } | { fileIds: string[] };

export interface MigrateFilesToWorkspaceInput {
  tenantId: string;
  /** Target workspace. Must already be validated as belonging to the tenant. */
  workspaceId: string;
  filter: MigrateFilesFilter;
  /** When true, only files with a NULL workspace_id are moved. */
  onlyUnassigned: boolean;
}

export interface MigrateFilesToWorkspaceResult {
  migratedCount: number;
  totalBytes: number;
}

/** One "folder" in the context view: a distinct `files.context` value with rollups. */
export interface FileContextAggregate {
  context: string;
  fileCount: number;
  totalBytes: number;
}

export interface ListTenantsInput {
  cursor?: string;
  limit?: number;
}

export interface ListTenantsResult {
  tenants: Tenant[];
  nextCursor: string | null;
  total: number;
}

export interface UpdateTenantInput {
  name?: string;
  quotaBytes?: number;
  allowedFileTypes?: AllowedMimeType[] | null;
  authWorkspaceId?: string | null;
  authTenantId?: string | null;
}

/** A processed GDPR erasure webhook delivery, keyed by its stable event id. */
export interface ErasureEventRecord {
  eventId: string;
  kind: string;
  processedAt: number;
}

export interface RecordErasureEventInput {
  eventId: string;
  /** 'user.erased' | 'tenant.erased'. */
  kind: string;
  /** The erased auth-brain company id, when the event carries one. */
  authTenantId: string | null;
  /** How many SB tenants this delivery matched and deleted. */
  matchedTenantCount: number;
  processedAt: number;
}

export interface DatabaseAdapter {
  // Tenant
  createTenant(input: CreateTenantInput): Promise<void>;
  getTenantByApiKey(apiKey: string): Promise<Tenant | null>;
  getTenantByName(name: string): Promise<Tenant | null>;
  getTenantById(id: string): Promise<Tenant | null>;
  getTenantByAuthWorkspaceId(authWorkspaceId: string): Promise<Tenant | null>;
  /** Resolve a storage tenant by its bound auth-brain COMPANY (tenant) id. */
  getTenantByAuthTenantId(authTenantId: string): Promise<Tenant | null>;
  /**
   * Resolve every storage tenant affected by a company erasure: bound to the
   * company id (`auth_tenant_id`) OR to any of the given workspace ids
   * (`auth_workspace_id`). Results are de-duplicated. A null company id and an
   * empty workspace list match nothing (returns []).
   */
  findTenantsForErasure(authTenantId: string | null, authWorkspaceIds: string[]): Promise<Tenant[]>;
  updateTenantApiKeyHash(tenantId: string, newHash: string, keyPrefix: string): Promise<boolean>;
  listTenants(input: ListTenantsInput): Promise<ListTenantsResult>;
  updateTenant(tenantId: string, updates: UpdateTenantInput): Promise<Tenant | null>;
  deleteTenant(tenantId: string): Promise<boolean>;

  // Files
  getFileById(fileId: string, tenantId: string): Promise<StoredFile | null>;
  getFileByIdUnscoped(fileId: string): Promise<StoredFile | null>;
  getFileByStoredPath(storedPath: string): Promise<StoredFile | null>;
  listFilesByTenant(tenantId: string, options: ListFilesInput): Promise<ListFilesResult>;
  /**
   * Every stored object key for a tenant, INCLUDING soft-deleted files, so an
   * erasure can purge objects whose DB rows are only tombstoned. Ordering is
   * unspecified.
   */
  getAllStoredPathsByTenant(tenantId: string): Promise<string[]>;
  updateFileMetadata(
    fileId: string,
    metadata: Record<string, unknown>,
    status: ProcessingStatus
  ): Promise<void>;
  /**
   * Rename a file's display name (the `originalName` field only). The
   * backing storage object keeps its original key — nothing moves in R2/S3,
   * this is a metadata-only update. Returns the updated file, or null if no
   * active file with this id exists for the tenant.
   */
  renameFile(fileId: string, tenantId: string, originalName: string): Promise<StoredFile | null>;

  // Workspaces
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  getWorkspaceById(workspaceId: string, tenantId: string): Promise<Workspace | null>;
  listWorkspacesByTenant(tenantId: string): Promise<Workspace[]>;
  updateWorkspace(
    workspaceId: string,
    tenantId: string,
    updates: UpdateWorkspaceInput
  ): Promise<Workspace | null>;
  deleteWorkspace(workspaceId: string, tenantId: string): Promise<void>;
  getActiveFilesByWorkspace(workspaceId: string, tenantId: string): Promise<StoredFile[]>;
  /**
   * Bulk-move matching active files into a target workspace, keeping workspace
   * quota (`used_bytes`) consistent: bytes are added to the target and released
   * from any source workspace a file is moving out of. Tenant-level usage is
   * unchanged. This is an admin migration and does NOT enforce the target
   * workspace quota limit (moves are allowed to exceed it).
   */
  migrateFilesToWorkspace(
    input: MigrateFilesToWorkspaceInput
  ): Promise<MigrateFilesToWorkspaceResult>;
  /**
   * Aggregate a tenant's ACTIVE files by their `context` value (the "folder"
   * view), optionally scoped to one workspace. NULL/empty contexts fold into
   * "default". Sorted by totalBytes desc.
   */
  aggregateFileContexts(tenantId: string, workspaceId?: string): Promise<FileContextAggregate[]>;

  // Upload sessions and quota accounting
  //
  // Quota contract: `used_bytes` of a tenant (and of a workspace) is the sum of
  // `size_bytes` over its live files. A file whose upload is still open holds
  // its declared size there as a reservation; settling the upload replaces the
  // reservation with the bytes actually stored (0 when nothing was stored).
  // Every method below changes the files, the sessions and both counters
  // together, atomically, so the invariant survives concurrency and retries.

  /**
   * Reserve `file.sizeBytes` at tenant level (and workspace level when the file
   * has one) and create the file row and its pending upload session, all or
   * nothing. The reservation is conditional on free capacity at the moment of
   * the write, so concurrent requests can never push `used_bytes` past a quota.
   */
  createPendingUpload(input: CreatePendingUploadInput): Promise<CreatePendingUploadResult>;
  getUploadSessionByFileId(fileId: string): Promise<UploadSession | null>;
  /**
   * Move a session from `pending` to `uploading`. Returns false when it was not
   * pending (another transfer claimed it, or it was already settled).
   */
  claimUploadSession(sessionId: string): Promise<boolean>;
  /**
   * Settle an open (`pending` or `uploading`) session exactly once: record the
   * outcome, set the file's size to the stored bytes (0 unless completed),
   * adjust both counters by the difference to the reservation, and mark the
   * file `completed` or `failed`. Returns false, changing nothing, when the
   * session was already settled, so a retry can never release twice. A file
   * deleted meanwhile keeps its counters untouched (the delete released them).
   */
  settleUploadSession(sessionId: string, outcome: UploadSessionOutcome): Promise<boolean>;
  /**
   * Settle as `expired` every session still `pending` after its `expiresAt`,
   * or still `uploading` `uploadingGraceMs` after it. Returns how many.
   */
  expireStaleUploadSessions(now: number, uploadingGraceMs: number): Promise<number>;
  /**
   * Soft-delete a live file, release its bytes from both counters and close
   * its open upload session, atomically. Returns null (changing nothing) when
   * the file does not exist or is already deleted.
   */
  deleteFileAndReleaseQuota(fileId: string, tenantId: string): Promise<StoredFile | null>;
  /**
   * Soft-delete every live file of a workspace, release their bytes from both
   * counters and close their open upload sessions, atomically. Returns the
   * number of bytes released.
   */
  deleteWorkspaceFilesAndReleaseQuota(workspaceId: string, tenantId: string): Promise<number>;

  // Quota — tenant level
  checkQuota(tenantId: string, fileSizeBytes: number): Promise<QuotaCheckResult>;
  getQuotaUsage(tenantId: string): Promise<QuotaResponse>;
  recalculateQuota(tenantId: string): Promise<number>;

  // Quota — workspace level
  checkWorkspaceQuota(workspaceId: string, fileSizeBytes: number): Promise<QuotaCheckResult | null>;

  // Erasure webhook idempotency ledger
  /** Look up a previously-processed erasure delivery by its event id. */
  getErasureEvent(eventId: string): Promise<ErasureEventRecord | null>;
  /** Record an erasure delivery as processed (idempotency key = eventId). */
  recordErasureEvent(input: RecordErasureEventInput): Promise<void>;

  // Migrations
  migrate(): Promise<void>;
}
