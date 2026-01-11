import type { Context } from 'hono';
import { ZodError } from 'zod';
import type { AppEnv } from '../env';

/**
 * Custom API error class
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: Record<string, unknown>) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string) {
    return new ApiError(409, 'CONFLICT', message);
  }

  static quotaExceeded(message = 'Storage quota exceeded') {
    return new ApiError(403, 'QUOTA_EXCEEDED', message);
  }

  static invalidFileType(message = 'File type not allowed') {
    return new ApiError(400, 'INVALID_FILE_TYPE', message);
  }

  static fileTooLarge(message = 'File size exceeds maximum allowed') {
    return new ApiError(400, 'FILE_TOO_LARGE', message);
  }

  static rateLimited(message = 'Rate limit exceeded') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}

/**
 * Global error handler for Hono
 */
export function errorHandler(err: Error, c: Context<AppEnv>) {
  const requestId = c.get('requestId') ?? 'unknown';

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));

    console.error(`[${requestId}] Validation error:`, JSON.stringify(details));

    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: { errors: details },
        },
      },
      400
    );
  }

  // Handle custom API errors
  if (err instanceof ApiError) {
    console.error(`[${requestId}] API error: ${err.code} - ${err.message}`);

    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details && { details: err.details }),
        },
      },
      err.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500
    );
  }

  // Handle unexpected errors
  console.error(`[${requestId}] Unexpected error:`, err);

  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message:
          c.env.ENVIRONMENT === 'production'
            ? 'An unexpected error occurred'
            : err.message || 'An unexpected error occurred',
      },
    },
    500
  );
}
