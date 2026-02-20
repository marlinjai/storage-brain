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
  FileMetadata,
  Workspace,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
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

// Constants and types from constants
export type {
  AllowedMimeType,
  ProcessingStatus,
} from './constants';

export {
  ALLOWED_FILE_TYPES,
  ALLOWED_MIME_TYPES,
  IMAGE_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  PROCESSING_STATUSES,
  MAX_FILE_SIZE_BYTES,
} from './constants';
