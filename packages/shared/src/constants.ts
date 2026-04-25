// Re-export shared constants from brain-core
export { API_KEY_PREFIX_LIVE, API_KEY_PREFIX_TEST, RETRY_CONFIG } from '@marlinjai/brain-core';

/**
 * Known MIME types with metadata (extension, category).
 * This is a convenience lookup — NOT an enforcement gate.
 * Any valid MIME type string is accepted for upload.
 */
export const KNOWN_FILE_TYPES: Record<string, { extension: string; category: string }> = {
  // Images
  'image/jpeg': { extension: 'jpg', category: 'image' },
  'image/png': { extension: 'png', category: 'image' },
  'image/webp': { extension: 'webp', category: 'image' },
  'image/gif': { extension: 'gif', category: 'image' },
  'image/avif': { extension: 'avif', category: 'image' },
  // Documents
  'application/pdf': { extension: 'pdf', category: 'document' },
  'text/plain': { extension: 'txt', category: 'document' },
  // Audio
  'audio/mpeg': { extension: 'mp3', category: 'audio' },
  'audio/mp4': { extension: 'm4a', category: 'audio' },
  'audio/wav': { extension: 'wav', category: 'audio' },
  'audio/ogg': { extension: 'ogg', category: 'audio' },
  'audio/webm': { extension: 'webm', category: 'audio' },
  // Video
  'video/mp4': { extension: 'mp4', category: 'video' },
};

/**
 * @deprecated Use `string` type directly — file types are no longer restricted to an enum.
 * Kept for backwards compatibility during migration.
 */
export type AllowedMimeType = string;

/** @deprecated Use KNOWN_FILE_TYPES instead */
export const ALLOWED_FILE_TYPES = KNOWN_FILE_TYPES;
/** @deprecated No longer used — any MIME type is accepted */
export const ALLOWED_MIME_TYPES = Object.keys(KNOWN_FILE_TYPES);

/**
 * Quota defaults
 */
export const DEFAULT_QUOTA_BYTES = 500 * 1024 * 1024; // 500MB
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB per file

/**
 * Presigned URL configuration
 */
export const PRESIGNED_URL_EXPIRATION_SECONDS = 15 * 60; // 15 minutes

/**
 * Upload session statuses
 */
export const UPLOAD_SESSION_STATUSES = ['pending', 'completed', 'expired', 'failed'] as const;
export type UploadSessionStatus = (typeof UPLOAD_SESSION_STATUSES)[number];

/**
 * Processing statuses
 */
export const PROCESSING_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

/**
 * Rate limiting
 */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 100;
