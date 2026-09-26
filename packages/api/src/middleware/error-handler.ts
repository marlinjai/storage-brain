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

  /** 413: the request body itself is larger than the route accepts. */
  static payloadTooLarge(message = 'Request body too large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', message);
  }

  static rateLimited(message = 'Rate limit exceeded') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static override quotaExceeded(message = 'Storage quota exceeded') {
    return new ApiError(403, 'QUOTA_EXCEEDED', message);
  }
}

const baseErrorHandler = createErrorHandler<AppEnv>();

/**
 * Global error handler for Hono.
 *
 * A body cut off by `hono/body-limit` surfaces in the route as a
 * `BodyLimitError` from `c.req.json()` / `c.req.text()`. The middleware then
 * replaces the response with its 413, but the base handler would first log the
 * error as an unexpected 500, so it is answered as the 413 it is right here.
 */
export const errorHandler: typeof baseErrorHandler = (err, c) => {
  if (err instanceof Error && err.name === 'BodyLimitError') {
    return baseErrorHandler(ApiError.payloadTooLarge('Request body too large'), c);
  }
  return baseErrorHandler(err, c);
};
