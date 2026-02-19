import type {
  AllowedMimeType,
  UploadSessionStatus,
  ProcessingStatus,
} from './constants';

/**
 * Tenant entity
 */
export interface Tenant {
  id: string;
  name: string;
  apiKeyHash: string;
  quotaBytes: number;
  usedBytes: number;
  allowedFileTypes: AllowedMimeType[] | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * File entity
 */
export interface StoredFile {
  id: string;
  tenantId: string;
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
  createdAt: string;
}

// GET /files
export interface ListFilesInput {
  limit?: number;
  cursor?: string;
  context?: string;
  fileType?: AllowedMimeType;
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
 * API Error response
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Webhook payload sent after upload
 */
export interface WebhookPayload {
  event: 'file.uploaded' | 'file.failed';
  fileId: string;
  tenantId: string;
  file: FileResponse;
  timestamp: string;
}

/**
 * Tenant context attached to authenticated requests
 */
export interface TenantContext {
  tenant: Tenant;
}
