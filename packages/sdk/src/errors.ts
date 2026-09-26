import { BrainSdkError } from '@marlinjai/brain-core/sdk';

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
export class AuthenticationError extends StorageBrainError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

/**
 * Quota exceeded error
 */
export class QuotaExceededError extends StorageBrainError {
  constructor(
    message = 'Storage quota exceeded',
    public quotaBytes?: number,
    public usedBytes?: number
  ) {
    super(message, 'QUOTA_EXCEEDED', 403, { quotaBytes, usedBytes });
    this.name = 'QuotaExceededError';
  }
}

/**
 * Invalid file type error
 */
export class InvalidFileTypeError extends StorageBrainError {
  constructor(fileType: string, allowedTypes?: string[]) {
    super(`File type '${fileType}' is not allowed`, 'INVALID_FILE_TYPE', 400, {
      fileType,
      allowedTypes,
    });
    this.name = 'InvalidFileTypeError';
  }
}

/**
 * File too large error
 */
export class FileTooLargeError extends StorageBrainError {
  constructor(fileSize: number, maxSize: number) {
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
export class FileNotFoundError extends StorageBrainError {
  constructor(fileId: string) {
    super(`File not found: ${fileId}`, 'NOT_FOUND', 404, { fileId });
    this.name = 'FileNotFoundError';
  }
}

/**
 * Network error - connection issues
 */
export class NetworkError extends StorageBrainError {
  constructor(
    message = 'Network request failed',
    public originalError?: Error
  ) {
    super(message, 'NETWORK_ERROR', undefined, { originalError: originalError?.message });
    this.name = 'NetworkError';
  }
}

/**
 * Upload error - file upload failed
 */
export class UploadError extends StorageBrainError {
  constructor(
    message: string,
    public originalError?: Error
  ) {
    super(message, 'UPLOAD_ERROR', undefined, { originalError: originalError?.message });
    this.name = 'UploadError';
  }
}

/**
 * Validation error - request validation failed
 */
export class ValidationError extends StorageBrainError {
  constructor(
    message: string,
    public errors?: Array<{ path: string; message: string }>
  ) {
    super(message, 'VALIDATION_ERROR', 400, { errors });
    this.name = 'ValidationError';
  }
}

/**
 * Whether a failed request is worth repeating. Client errors (4xx) describe a
 * request that will fail the same way again, so only 408 (request timeout) and
 * 429 (rate limited) are retried among them. Server errors (5xx) and anything
 * that is not an API error at all (a dropped connection, an aborted timeout)
 * are transient by nature.
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof BrainSdkError) || error.statusCode === undefined) return true;
  const status = error.statusCode;
  if (status >= 400 && status < 500) return status === 408 || status === 429;
  return true;
}

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
      return new AuthenticationError(message);
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
      return new FileTooLargeError(details?.fileSize as number, details?.maxSize as number);
    case 'FILE_NOT_FOUND':
    case 'NOT_FOUND':
      return new FileNotFoundError((details?.fileId as string) ?? 'unknown');
    case 'VALIDATION_ERROR':
      return new ValidationError(
        message ?? 'Validation failed',
        details?.errors as Array<{ path: string; message: string }>
      );
    default:
      return new StorageBrainError(
        message ?? 'An error occurred',
        code ?? 'UNKNOWN_ERROR',
        statusCode,
        details
      );
  }
}
