import { describe, it, expect } from 'vitest';
import { ApiError } from './error-handler';

describe('ApiError', () => {
  it('creates a basic error', () => {
    const err = new ApiError(400, 'BAD_REQUEST', 'Invalid input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.message).toBe('Invalid input');
  });

  describe('static factories', () => {
    it('invalidFileType returns 400', () => {
      const err = ApiError.invalidFileType('not allowed');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('INVALID_FILE_TYPE');
      expect(err.message).toBe('not allowed');
    });

    it('invalidFileType has default message', () => {
      const err = ApiError.invalidFileType();
      expect(err.message).toBe('File type not allowed');
    });

    it('fileTooLarge returns 400', () => {
      const err = ApiError.fileTooLarge('too big');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('FILE_TOO_LARGE');
    });

    it('rateLimited returns 429', () => {
      const err = ApiError.rateLimited();
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('RATE_LIMITED');
    });

    it('quotaExceeded returns 403', () => {
      const err = ApiError.quotaExceeded();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('QUOTA_EXCEEDED');
    });

    it('notFound returns 404', () => {
      const err = ApiError.notFound('File not found');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
    });

    it('unauthorized returns 401', () => {
      const err = ApiError.unauthorized('Bad key');
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('UNAUTHORIZED');
    });

    it('internal returns 500', () => {
      const err = ApiError.internal('Boom');
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
    });

    it('conflict returns 409', () => {
      const err = ApiError.conflict('Already exists');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('CONFLICT');
    });
  });
});
