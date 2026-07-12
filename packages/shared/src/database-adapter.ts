import type {
  Tenant,
  StoredFile,
  UploadSession,
  Workspace,
  ListFilesInput,
  QuotaResponse,
} from './types';
import type {
  AllowedMimeType,
  UploadSessionStatus,
  ProcessingStatus,
} from './constants';

export interface CreateTenantInput {
  id: string;
  name: string;
  apiKeyHash: string;
  keyPrefix: string;
  quotaBytes: number;
  allowedFileTypes: AllowedMimeType[] | null;
  authWorkspaceId?: string;
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

export interface CreateUploadSessionInput {
  fileId: string;
  presignedUrl: string;
  expiresAt: number;
}

/** Selector for which of a tenant's files to migrate — by tag or by explicit IDs. */
export type MigrateFilesFilter =
  | { tag: { key: string; value: string } }
  | { fileIds: string[] };

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
}

export interface DatabaseAdapter {
  // Tenant
  createTenant(input: CreateTenantInput): Promise<void>;
  getTenantByApiKey(apiKey: string): Promise<Tenant | null>;
  getTenantByName(name: string): Promise<Tenant | null>;
  getTenantById(id: string): Promise<Tenant | null>;
  getTenantByAuthWorkspaceId(authWorkspaceId: string): Promise<Tenant | null>;
  updateTenantApiKeyHash(tenantId: string, newHash: string, keyPrefix: string): Promise<boolean>;
  listTenants(input: ListTenantsInput): Promise<ListTenantsResult>;
  updateTenant(tenantId: string, updates: UpdateTenantInput): Promise<Tenant | null>;
  deleteTenant(tenantId: string): Promise<boolean>;

  // Files
  createFile(input: CreateFileInput): Promise<void>;
  getFileById(fileId: string, tenantId: string): Promise<StoredFile | null>;
  getFileByIdUnscoped(fileId: string): Promise<StoredFile | null>;
  getFileByStoredPath(storedPath: string): Promise<StoredFile | null>;
  listFilesByTenant(tenantId: string, options: ListFilesInput): Promise<ListFilesResult>;
  softDeleteFile(fileId: string, tenantId: string): Promise<void>;
  updateFileMetadata(fileId: string, metadata: Record<string, unknown>, status: ProcessingStatus): Promise<void>;
  updateFileProcessingStatus(fileId: string, status: ProcessingStatus): Promise<void>;
  updateFileSizeBytes(fileId: string, sizeBytes: number): Promise<void>;

  // Workspaces
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  getWorkspaceById(workspaceId: string, tenantId: string): Promise<Workspace | null>;
  listWorkspacesByTenant(tenantId: string): Promise<Workspace[]>;
  updateWorkspace(workspaceId: string, tenantId: string, updates: UpdateWorkspaceInput): Promise<Workspace | null>;
  deleteWorkspace(workspaceId: string, tenantId: string): Promise<void>;
  getActiveFilesByWorkspace(workspaceId: string, tenantId: string): Promise<StoredFile[]>;
  softDeleteFilesByWorkspace(workspaceId: string, tenantId: string): Promise<void>;
  /**
   * Bulk-move matching active files into a target workspace, keeping workspace
   * quota (`used_bytes`) consistent: bytes are added to the target and released
   * from any source workspace a file is moving out of. Tenant-level usage is
   * unchanged. This is an admin migration and does NOT enforce the target
   * workspace quota limit (moves are allowed to exceed it).
   */
  migrateFilesToWorkspace(input: MigrateFilesToWorkspaceInput): Promise<MigrateFilesToWorkspaceResult>;
  /**
   * Aggregate a tenant's ACTIVE files by their `context` value (the "folder"
   * view), optionally scoped to one workspace. NULL/empty contexts fold into
   * "default". Sorted by totalBytes desc.
   */
  aggregateFileContexts(tenantId: string, workspaceId?: string): Promise<FileContextAggregate[]>;

  // Upload sessions
  createUploadSession(input: CreateUploadSessionInput): Promise<string>;
  getUploadSessionByFileId(fileId: string): Promise<UploadSession | null>;
  updateUploadSessionStatus(sessionId: string, status: UploadSessionStatus): Promise<void>;

  // Quota — tenant level
  checkQuota(tenantId: string, fileSizeBytes: number): Promise<QuotaCheckResult>;
  reserveQuota(tenantId: string, sizeBytes: number): Promise<void>;
  releaseQuota(tenantId: string, sizeBytes: number): Promise<void>;
  getQuotaUsage(tenantId: string): Promise<QuotaResponse>;
  recalculateQuota(tenantId: string): Promise<number>;

  // Quota — workspace level
  checkWorkspaceQuota(workspaceId: string, fileSizeBytes: number): Promise<QuotaCheckResult | null>;
  reserveWorkspaceQuota(workspaceId: string, sizeBytes: number): Promise<void>;
  releaseWorkspaceQuota(workspaceId: string, sizeBytes: number): Promise<void>;

  // Migrations
  migrate(): Promise<void>;
}
