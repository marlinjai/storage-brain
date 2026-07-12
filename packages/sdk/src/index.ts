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
  SignedUrlInfo,
  PermanentUrlInfo,
  FileMetadata,
  FileContextAggregate,
  ListContextsOptions,
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
  KNOWN_FILE_TYPES,
  ALLOWED_FILE_TYPES,
  ALLOWED_MIME_TYPES,
  PROCESSING_STATUSES,
  MAX_FILE_SIZE_BYTES,
} from './constants';
