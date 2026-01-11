import type {
  AllowedMimeType,
  ProcessingContext,
  UploadSessionStatus,
  ProcessingStatus,
  ThumbnailSize,
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
  context: ProcessingContext;
  tags: Record<string, string> | null;
  metadata: FileMetadata | null;
  processingStatus: ProcessingStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * File metadata (stored as JSON)
 */
export interface FileMetadata {
  thumbnailUrls?: ThumbnailUrls;
  ocrData?: OcrResult;
  imageInfo?: ImageInfo;
  processingError?: string;
  [key: string]: unknown;
}

/**
 * Thumbnail URLs for different sizes
 */
export type ThumbnailUrls = {
  [K in ThumbnailSize]?: string;
};

/**
 * OCR result from Google Cloud Vision
 */
export interface OcrResult {
  fullText: string;
  confidence: number;
  blocks: OcrBlock[];
}

export interface OcrBlock {
  text: string;
  confidence: number;
  boundingBox: BoundingBox;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Image information extracted from EXIF
 */
export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  colorSpace?: string;
  hasAlpha?: boolean;
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
  context: ProcessingContext;
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
  context: ProcessingContext;
  tags: Record<string, string> | null;
  metadata: FileMetadata | null;
  processingStatus: ProcessingStatus;
  createdAt: string;
}

// GET /files
export interface ListFilesInput {
  limit?: number;
  cursor?: string;
  context?: ProcessingContext;
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
 * Webhook payload sent after processing
 */
export interface WebhookPayload {
  event: 'file.processed' | 'file.failed';
  fileId: string;
  tenantId: string;
  file: FileResponse;
  timestamp: string;
}

/**
 * Queue message for processing
 */
export interface ProcessingQueueMessage {
  fileId: string;
  tenantId: string;
  context: ProcessingContext;
  storedPath: string;
  fileType: AllowedMimeType;
  webhookUrl?: string;
}

/**
 * Tenant context attached to authenticated requests
 */
export interface TenantContext {
  tenant: Tenant;
}
