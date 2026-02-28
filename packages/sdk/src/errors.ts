import {
  BrainSdkError,
  AuthenticationError as BaseAuthenticationError,
  NotFoundError as BaseNotFoundError,
  ValidationError as BaseValidationError,
  QuotaExceededError as BaseQuotaExceededError,
  NetworkError as BaseNetworkError,
} from '@marlinjai/brain-core/sdk';

/**
 * Base error class for Storage Brain SDK — extends BrainSdkError
 */
export class StorageBrainError extends BrainSdkError {
  constructor(
    message: string,
    code: string,
    statusCode?: number,
    details?: Record<string, unknown>
  ) {
    super(message, code, statusCode, details);
    this.name = 'StorageBrainError';
  }
}

/**
 * Authentication error - invalid or missing API key
 */
export class AuthenticationError extends BaseAuthenticationError {}

/**
 * Quota exceeded error
 */
export class QuotaExceededError extends BaseQuotaExceededError {
  constructor(
    message = 'Storage quota exceeded',
    public quotaBytes?: number,
    public usedBytes?: number
  ) {
    super(message);
    this.details = { quotaBytes, usedBytes };
    this.name = 'QuotaExceededError';
  }
}

/**
 * Invalid file type error
 */
export class InvalidFileTypeError extends StorageBrainError {
  constructor(
    fileType: string,
    allowedTypes?: string[]
  ) {
    super(
      `File type '${fileType}' is not allowed`,
      'INVALID_FILE_TYPE',
      400,
      { fileType, allowedTypes }
    );
    this.name = 'InvalidFileTypeError';
  }
}

/**
 * File too large error
 */
export class FileTooLargeError extends StorageBrainError {
  constructor(
    fileSize: number,
    maxSize: number
  ) {
    super(
      `File size ${fileSize} bytes exceeds maximum of ${maxSize} bytes`,
      'FILE_TOO_LARGE',
      400,
      { fileSize, maxSize }
    );
    this.name = 'FileTooLargeError';
  }
}

/**
 * File not found error
 */
export class FileNotFoundError extends BaseNotFoundError {
  constructor(fileId: string) {
    super(`File not found: ${fileId}`);
    this.details = { fileId };
    this.name = 'FileNotFoundError';
  }
}

/**
 * Network error - connection issues
 */
export class NetworkError extends BaseNetworkError {}

/**
 * Upload error - file upload failed
 */
export class UploadError extends StorageBrainError {
  constructor(message: string, public originalError?: Error) {
    super(message, 'UPLOAD_ERROR', undefined, { originalError: originalError?.message });
    this.name = 'UploadError';
  }
}

/**
 * Validation error - request validation failed
 */
export class ValidationError extends BaseValidationError {}

/**
 * Parse API error response into appropriate error class
 */
export function parseApiError(
  statusCode: number,
  response: { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
): StorageBrainError {
  const { code, message, details } = response.error ?? {};

  switch (code) {
    case 'UNAUTHORIZED':
      return new AuthenticationError(message) as unknown as StorageBrainError;
    case 'QUOTA_EXCEEDED':
      return new QuotaExceededError(
        message,
        details?.quotaBytes as number,
        details?.usedBytes as number
      );
    case 'INVALID_FILE_TYPE':
      return new InvalidFileTypeError(
        details?.fileType as string,
        details?.allowedTypes as string[]
      );
    case 'FILE_TOO_LARGE':
      return new FileTooLargeError(
        details?.fileSize as number,
        details?.maxSize as number
      );
    case 'FILE_NOT_FOUND':
    case 'NOT_FOUND':
      return new FileNotFoundError(details?.fileId as string ?? 'unknown') as unknown as StorageBrainError;
    case 'VALIDATION_ERROR':
      return new ValidationError(
        message ?? 'Validation failed',
        details?.errors as Array<{ path: string; message: string }>
      ) as unknown as StorageBrainError;
    default:
      return new StorageBrainError(
        message ?? 'An error occurred',
        code ?? 'UNKNOWN_ERROR',
        statusCode,
        details
      );
  }
}
