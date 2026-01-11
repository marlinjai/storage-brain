// Main client
export { StorageBrain, StorageBrain as default } from './client';

// Types
export type {
  StorageBrainConfig,
  UploadOptions,
  FileInfo,
  ListFilesOptions,
  ListFilesResult,
  QuotaInfo,
  TenantInfo,
  UploadHandshake,
} from './types';

// Errors
export {
  StorageBrainError,
  AuthenticationError,
  QuotaExceededError,
  InvalidFileTypeError,
  FileTooLargeError,
  FileNotFoundError,
  NetworkError,
  UploadError,
  ValidationError,
} from './errors';

// Re-export useful types from shared
export type {
  ProcessingContext,
  AllowedMimeType,
  ProcessingStatus,
  FileMetadata,
  ThumbnailUrls,
  OcrResult,
} from '@storage-brain/shared';

// Re-export constants
export {
  ALLOWED_MIME_TYPES,
  PROCESSING_CONTEXTS,
  THUMBNAIL_SIZES,
} from '@storage-brain/shared';
