import { describe, it, expect } from 'vitest';
import {
  ALLOWED_FILE_TYPES,
  ALLOWED_MIME_TYPES,
  IMAGE_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  DEFAULT_QUOTA_BYTES,
  MAX_FILE_SIZE_BYTES,
  PRESIGNED_URL_EXPIRATION_SECONDS,
  UPLOAD_SESSION_STATUSES,
  PROCESSING_STATUSES,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
} from './constants';

describe('ALLOWED_FILE_TYPES', () => {
  it('contains expected image types', () => {
    expect(ALLOWED_FILE_TYPES['image/jpeg']).toEqual({ extension: 'jpg', category: 'image' });
    expect(ALLOWED_FILE_TYPES['image/png']).toEqual({ extension: 'png', category: 'image' });
    expect(ALLOWED_FILE_TYPES['image/webp']).toEqual({ extension: 'webp', category: 'image' });
    expect(ALLOWED_FILE_TYPES['image/gif']).toEqual({ extension: 'gif', category: 'image' });
    expect(ALLOWED_FILE_TYPES['image/avif']).toEqual({ extension: 'avif', category: 'image' });
  });

  it('contains PDF document type', () => {
    expect(ALLOWED_FILE_TYPES['application/pdf']).toEqual({ extension: 'pdf', category: 'document' });
  });
});

describe('ALLOWED_MIME_TYPES', () => {
  it('is an array of all keys from ALLOWED_FILE_TYPES', () => {
    expect(ALLOWED_MIME_TYPES).toEqual(expect.arrayContaining(Object.keys(ALLOWED_FILE_TYPES)));
    expect(ALLOWED_MIME_TYPES.length).toBe(Object.keys(ALLOWED_FILE_TYPES).length);
  });
});

describe('IMAGE_MIME_TYPES', () => {
  it('only contains image types', () => {
    for (const type of IMAGE_MIME_TYPES) {
      expect(type).toMatch(/^image\//);
    }
  });

  it('does not contain document types', () => {
    expect(IMAGE_MIME_TYPES).not.toContain('application/pdf');
  });
});

describe('DOCUMENT_MIME_TYPES', () => {
  it('only contains document types', () => {
    expect(DOCUMENT_MIME_TYPES).toContain('application/pdf');
  });

  it('does not contain image types', () => {
    for (const type of DOCUMENT_MIME_TYPES) {
      expect(type).not.toMatch(/^image\//);
    }
  });
});

describe('quota defaults', () => {
  it('DEFAULT_QUOTA_BYTES is 500MB', () => {
    expect(DEFAULT_QUOTA_BYTES).toBe(500 * 1024 * 1024);
  });

  it('MAX_FILE_SIZE_BYTES is 100MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe('PRESIGNED_URL_EXPIRATION_SECONDS', () => {
  it('is 15 minutes', () => {
    expect(PRESIGNED_URL_EXPIRATION_SECONDS).toBe(15 * 60);
  });
});

describe('status constants', () => {
  it('UPLOAD_SESSION_STATUSES contains expected values', () => {
    expect(UPLOAD_SESSION_STATUSES).toEqual(['pending', 'completed', 'expired', 'failed']);
  });

  it('PROCESSING_STATUSES contains expected values', () => {
    expect(PROCESSING_STATUSES).toEqual(['pending', 'processing', 'completed', 'failed']);
  });
});

describe('DEFAULT_RATE_LIMIT_PER_MINUTE', () => {
  it('is 100', () => {
    expect(DEFAULT_RATE_LIMIT_PER_MINUTE).toBe(100);
  });
});
