import { ApiError as BaseApiError, createErrorHandler } from '@marlinjai/brain-core';
import type { AppEnv } from '../env';

/**
 * Storage Brain API error — extends base with domain-specific static methods
 */
export class ApiError extends BaseApiError {
  static invalidFileType(message = 'File type not allowed') {
    return new ApiError(400, 'INVALID_FILE_TYPE', message);
  }

  static fileTooLarge(message = 'File size exceeds maximum allowed') {
    return new ApiError(400, 'FILE_TOO_LARGE', message);
  }

  static rateLimited(message = 'Rate limit exceeded') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static override quotaExceeded(message = 'Storage quota exceeded') {
    return new ApiError(403, 'QUOTA_EXCEEDED', message);
  }
}

/**
 * Global error handler for Hono
 */
export const errorHandler = createErrorHandler<AppEnv>();
