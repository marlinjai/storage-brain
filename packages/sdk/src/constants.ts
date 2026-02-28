// Re-export shared retry config from brain-core
export { RETRY_CONFIG } from '@marlinjai/brain-core/sdk';

/**
 * Allowed MIME types for file uploads
 */
export const ALLOWED_FILE_TYPES = {
  // Images
  'image/jpeg': { extension: 'jpg', category: 'image' },
  'image/png': { extension: 'png', category: 'image' },
  'image/webp': { extension: 'webp', category: 'image' },
  'image/gif': { extension: 'gif', category: 'image' },
  'image/avif': { extension: 'avif', category: 'image' },
  // Documents
  'application/pdf': { extension: 'pdf', category: 'document' },
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_FILE_TYPES;

export const ALLOWED_MIME_TYPES = Object.keys(ALLOWED_FILE_TYPES) as AllowedMimeType[];

export const IMAGE_MIME_TYPES = ALLOWED_MIME_TYPES.filter(
  (type) => ALLOWED_FILE_TYPES[type].category === 'image'
);

export const DOCUMENT_MIME_TYPES = ALLOWED_MIME_TYPES.filter(
  (type) => ALLOWED_FILE_TYPES[type].category === 'document'
);

/**
 * File size limits
 */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB per file

/**
 * Processing statuses
 */
export const PROCESSING_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];
