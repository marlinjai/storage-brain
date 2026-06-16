import type { BaseTenant, BaseWorkspace, BaseTenantContext } from '@marlinjai/brain-core';
import type {
  AllowedMimeType,
  UploadSessionStatus,
  ProcessingStatus,
} from './constants';

// Re-export base types for convenience
export type { ApiErrorResponse as ApiError } from '@marlinjai/brain-core';

/**
 * Tenant entity — extends BaseTenant with storage-specific quota fields
 */
export interface Tenant extends BaseTenant {
  keyPrefix: string | null;
  quotaBytes: number;
  usedBytes: number;
  allowedFileTypes: AllowedMimeType[] | null;
  /**
   * Optional binding to an auth-brain workspace (one workspace per tenant).
   * Nullable: existing tenants predate this plumbing. Laid down for future
   * per-tenant authorization; not yet used to filter access.
   */
  authWorkspaceId: string | null;
}

/**
 * Workspace entity — extends BaseWorkspace with storage-specific quota fields
 */
export interface Workspace extends BaseWorkspace {
  quotaBytes: number | null;
  usedBytes: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Workspace info (public-facing)
 */
export interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  quotaBytes: number | null;
  usedBytes: number;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

/**
 * File entity
 */
export interface StoredFile {
  id: string;
  tenantId: string;
  workspaceId: string | null;
  originalName: string;
  storedPath: string;
  fileType: AllowedMimeType;
  sizeBytes: number;
  context: string | null;
  tags: Record<string, string> | null;
  metadata: FileMetadata | null;
  processingStatus: ProcessingStatus;
  webhookUrl: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * File metadata (stored as JSON)
 */
export interface FileMetadata {
  [key: string]: unknown;
}

/**
 * Upload session entity
 */
export interface UploadSession {
  id: string;
  fileId: string;
  presignedUrl: string;
  expiresAt: number;
  status: UploadSessionStatus;
  createdAt: number;
}

/**
 * Request/Response types
 */

// POST /request-upload
export interface RequestUploadInput {
  fileType: AllowedMimeType;
  fileName: string;
  fileSizeBytes?: number;
  context?: string;
  tags?: Record<string, string>;
  webhookUrl?: string;
  workspaceId?: string;
}

export interface RequestUploadResponse {
  fileId: string;
  presignedUrl: string;
  expiresAt: string;
  uploadMetadata: {
    maxSizeBytes: number;
    allowedTypes: AllowedMimeType[];
  };
}

// GET /files/:file_id
export interface FileResponse {
  id: string;
  url: string;
  originalName: string;
  fileType: AllowedMimeType;
  sizeBytes: number;
  context: string | null;
  tags: Record<string, string> | null;
  metadata: FileMetadata | null;
  processingStatus: ProcessingStatus;
  workspaceId: string | null;
  createdAt: string;
}

// GET /files
export interface ListFilesInput {
  limit?: number;
  cursor?: string;
  context?: string;
  fileType?: AllowedMimeType;
  workspaceId?: string;
}

export interface ListFilesResponse {
  files: FileResponse[];
  nextCursor: string | null;
  total: number;
}

// GET /tenant/quota
export interface QuotaResponse {
  quotaBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
}

/**
 * Webhook payload sent after upload
 */
export interface WebhookPayload {
  event: 'file.uploaded' | 'file.failed';
  fileId: string;
  tenantId: string;
  workspaceId: string | null;
  file: FileResponse;
  timestamp: string;
}

/**
 * Tenant context attached to authenticated requests
 */
export type TenantContext = BaseTenantContext<Tenant>;
