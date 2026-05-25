import type {
  AllowedMimeType,
  ProcessingStatus,
} from './constants';

// ============================================================================
// Shared Types (inlined from @storage-brain/shared)
// ============================================================================

/**
 * File metadata (stored as JSON)
 */
export type FileMetadata = { [key: string]: unknown };

// ============================================================================
// SDK-Specific Types
// ============================================================================

/**
 * Configuration for Storage Brain client
 */
export interface StorageBrainConfig {
  /** API key for authentication (sk_live_... or sk_test_...) */
  apiKey: string;
  /** Base URL of the Storage Brain API (defaults to production) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of retry attempts for failed requests (default: 3) */
  maxRetries?: number;
  /** Default workspace ID — auto-sends with upload/list requests */
  workspaceId?: string;
}

/**
 * Options for uploading a file
 */
export interface UploadOptions {
  /** Optional free-form context label for the file */
  context?: string;
  /** Optional tags for the file */
  tags?: Record<string, string>;
  /** Progress callback (0-100) */
  onProgress?: (progress: number) => void;
  /** Optional webhook URL to call after processing */
  webhookUrl?: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Workspace to upload into (overrides client default) */
  workspaceId?: string;
}

/**
 * File information returned from the API
 */
export interface FileInfo {
  /** Unique file identifier */
  id: string;
  /** Public URL to access the file */
  url: string;
  /** Original file name */
  originalName: string;
  /** MIME type */
  fileType: AllowedMimeType;
  /** File size in bytes */
  sizeBytes: number;
  /** Free-form context label */
  context: string | null;
  /** User-defined tags */
  tags: Record<string, string> | null;
  /** Processing results and metadata */
  metadata: FileMetadata | null;
  /** Current processing status */
  processingStatus: ProcessingStatus;
  /** Workspace the file belongs to, or null for tenant-level files */
  workspaceId: string | null;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * Options for listing files
 */
export interface ListFilesOptions {
  /** Maximum number of files to return (1-100, default: 20) */
  limit?: number;
  /** Cursor for pagination */
  cursor?: string;
  /** Filter by context */
  context?: string;
  /** Filter by file type */
  fileType?: AllowedMimeType;
  /** Filter by workspace */
  workspaceId?: string;
}

/**
 * Result of listing files
 */
export interface ListFilesResult {
  /** Array of file information */
  files: FileInfo[];
  /** Cursor for next page, null if no more pages */
  nextCursor: string | null;
  /** Total number of files matching the query */
  total: number;
}

/**
 * Quota usage information
 */
export interface QuotaInfo {
  /** Total quota in bytes */
  quotaBytes: number;
  /** Used storage in bytes */
  usedBytes: number;
  /** Available storage in bytes */
  availableBytes: number;
  /** Usage percentage (0-100) */
  usagePercent: number;
}

/**
 * Tenant information
 */
export interface TenantInfo {
  /** Tenant ID */
  id: string;
  /** Tenant name */
  name: string;
  /** Allowed file types for this tenant */
  allowedFileTypes: AllowedMimeType[] | null;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * Signed URL information returned from the API
 */
export interface SignedUrlInfo {
  fileId: string;
  url: string;
  expiresAt: string;
  expiresIn: number;
}

/**
 * Permanent (non-expiring) URL information returned from the API.
 *
 * The URL never expires on its own. Revoke every existing permanent URL at
 * once by rotating `URL_SIGNING_SECRET` on the server.
 */
export interface PermanentUrlInfo {
  fileId: string;
  url: string;
}

/**
 * Upload handshake response
 */
export interface UploadHandshake {
  /** File ID assigned to this upload */
  fileId: string;
  /** Presigned URL for uploading */
  presignedUrl: string;
  /** Expiration timestamp (ISO 8601) */
  expiresAt: string;
  /** Upload constraints */
  uploadMetadata: {
    maxSizeBytes: number;
    allowedTypes: AllowedMimeType[];
  };
}

// ============================================================================
// Workspace Types
// ============================================================================

/**
 * Workspace entity
 */
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  quotaBytes: number | null;
  usedBytes: number;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Input for creating a workspace
 */
export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  quotaBytes?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Input for updating a workspace
 */
export interface UpdateWorkspaceInput {
  name?: string;
  quotaBytes?: number | null;
  metadata?: Record<string, unknown>;
}
