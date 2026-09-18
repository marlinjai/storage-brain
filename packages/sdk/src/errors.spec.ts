import { describe, it, expect } from 'vitest';
import {
  StorageBrainError,
  AuthenticationError,
  QuotaExceededError,
  InvalidFileTypeError,
  FileTooLargeError,
  FileNotFoundError,
  UploadError,
  NetworkError,
  ValidationError,
  isRetryableError,
  parseApiError,
} from './errors';

describe('error classes', () => {
  it('StorageBrainError has correct properties', () => {
    const err = new StorageBrainError('test', 'TEST_CODE', 400, { key: 'val' });
    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ key: 'val' });
    expect(err.name).toBe('StorageBrainError');
  });

  it('InvalidFileTypeError includes fileType and allowedTypes', () => {
    const err = new InvalidFileTypeError('video/mp4', ['image/png']);
    expect(err.message).toContain('video/mp4');
    expect(err.code).toBe('INVALID_FILE_TYPE');
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ fileType: 'video/mp4', allowedTypes: ['image/png'] });
  });

  it('FileTooLargeError includes size details', () => {
    const err = new FileTooLargeError(200, 100);
    expect(err.message).toContain('200');
    expect(err.message).toContain('100');
    expect(err.code).toBe('FILE_TOO_LARGE');
  });

  it('FileNotFoundError includes fileId', () => {
    const err = new FileNotFoundError('abc-123');
    expect(err.message).toContain('abc-123');
    expect(err.details).toEqual({ fileId: 'abc-123' });
  });

  it('UploadError stores originalError', () => {
    const cause = new Error('network');
    const err = new UploadError('upload failed', cause);
    expect(err.originalError).toBe(cause);
    expect(err.code).toBe('UPLOAD_ERROR');
  });

  it('QuotaExceededError stores quota info', () => {
    const err = new QuotaExceededError('Quota exceeded', 1000, 900);
    expect(err.quotaBytes).toBe(1000);
    expect(err.usedBytes).toBe(900);
  });
});

describe('parseApiError', () => {
  it('returns AuthenticationError for UNAUTHORIZED', () => {
    const err = parseApiError(401, { error: { code: 'UNAUTHORIZED', message: 'Bad key' } });
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it('returns QuotaExceededError for QUOTA_EXCEEDED', () => {
    const err = parseApiError(403, {
      error: {
        code: 'QUOTA_EXCEEDED',
        message: 'Over',
        details: { quotaBytes: 100, usedBytes: 100 },
      },
    });
    expect(err).toBeInstanceOf(QuotaExceededError);
  });

  it('returns InvalidFileTypeError for INVALID_FILE_TYPE', () => {
    const err = parseApiError(400, {
      error: {
        code: 'INVALID_FILE_TYPE',
        details: { fileType: 'text/plain', allowedTypes: ['image/png'] },
      },
    });
    expect(err).toBeInstanceOf(InvalidFileTypeError);
  });

  it('returns FileTooLargeError for FILE_TOO_LARGE', () => {
    const err = parseApiError(400, {
      error: { code: 'FILE_TOO_LARGE', details: { fileSize: 200, maxSize: 100 } },
    });
    expect(err).toBeInstanceOf(FileTooLargeError);
  });

  it('returns FileNotFoundError for FILE_NOT_FOUND', () => {
    const err = parseApiError(404, {
      error: { code: 'FILE_NOT_FOUND', details: { fileId: 'abc' } },
    });
    expect(err).toBeInstanceOf(FileNotFoundError);
  });

  it('returns FileNotFoundError for NOT_FOUND', () => {
    const err = parseApiError(404, { error: { code: 'NOT_FOUND' } });
    expect(err).toBeInstanceOf(FileNotFoundError);
  });

  it('returns generic StorageBrainError for unknown codes', () => {
    const err = parseApiError(500, { error: { code: 'SOMETHING', message: 'oops' } });
    expect(err).toBeInstanceOf(StorageBrainError);
    expect(err.code).toBe('SOMETHING');
  });

  it('handles empty error response', () => {
    const err = parseApiError(500, {});
    expect(err).toBeInstanceOf(StorageBrainError);
    expect(err.code).toBe('UNKNOWN_ERROR');
  });
});

describe('error hierarchy', () => {
  it.each([
    ['AuthenticationError', new AuthenticationError(), 401],
    ['QuotaExceededError', new QuotaExceededError(), 403],
    ['FileNotFoundError', new FileNotFoundError('f1'), 404],
    ['ValidationError', new ValidationError('bad'), 400],
    ['NetworkError', new NetworkError('down'), undefined],
    ['UploadError', new UploadError('failed'), undefined],
    ['InvalidFileTypeError', new InvalidFileTypeError('x/y'), 400],
    ['FileTooLargeError', new FileTooLargeError(2, 1), 400],
  ])('%s is a StorageBrainError with the right name and status', (name, err, status) => {
    expect(err).toBeInstanceOf(StorageBrainError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe(name);
    expect(err.statusCode).toBe(status);
  });

  it('every parseApiError result is a StorageBrainError', () => {
    for (const code of [
      'UNAUTHORIZED',
      'QUOTA_EXCEEDED',
      'INVALID_FILE_TYPE',
      'FILE_TOO_LARGE',
      'FILE_NOT_FOUND',
      'NOT_FOUND',
      'VALIDATION_ERROR',
      'OTHER',
    ]) {
      expect(parseApiError(400, { error: { code } })).toBeInstanceOf(StorageBrainError);
    }
  });

  it('ValidationError keeps its field errors', () => {
    const err = new ValidationError('bad', [{ path: 'a', message: 'required' }]);
    expect(err.errors).toEqual([{ path: 'a', message: 'required' }]);
  });

  it('NetworkError keeps its cause', () => {
    const cause = new Error('boom');
    expect(new NetworkError('down', cause).originalError).toBe(cause);
  });
});

describe('isRetryableError', () => {
  it.each([400, 401, 403, 404, 409, 413, 422])('does not retry %i', (status) => {
    expect(isRetryableError(new StorageBrainError('x', 'X', status))).toBe(false);
  });

  it.each([408, 429, 500, 502, 503, 504])('retries %i', (status) => {
    expect(isRetryableError(new StorageBrainError('x', 'X', status))).toBe(true);
  });

  it('retries errors with no status and non-API errors', () => {
    expect(isRetryableError(new NetworkError('down'))).toBe(true);
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableError(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('does not retry the typed 4xx classes', () => {
    expect(isRetryableError(new AuthenticationError())).toBe(false);
    expect(isRetryableError(new FileNotFoundError('f1'))).toBe(false);
    expect(isRetryableError(new ValidationError('bad'))).toBe(false);
    expect(isRetryableError(new QuotaExceededError())).toBe(false);
  });
});
