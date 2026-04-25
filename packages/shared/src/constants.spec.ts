import { describe, it, expect } from 'vitest';
import {
  KNOWN_FILE_TYPES,
  ALLOWED_MIME_TYPES,
  DEFAULT_QUOTA_BYTES,
  MAX_FILE_SIZE_BYTES,
  PRESIGNED_URL_EXPIRATION_SECONDS,
  UPLOAD_SESSION_STATUSES,
  PROCESSING_STATUSES,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
} from './constants';

describe('KNOWN_FILE_TYPES', () => {
  it('contains expected image types', () => {
    expect(KNOWN_FILE_TYPES['image/jpeg']).toEqual({ extension: 'jpg', category: 'image' });
    expect(KNOWN_FILE_TYPES['image/png']).toEqual({ extension: 'png', category: 'image' });
    expect(KNOWN_FILE_TYPES['image/webp']).toEqual({ extension: 'webp', category: 'image' });
    expect(KNOWN_FILE_TYPES['image/gif']).toEqual({ extension: 'gif', category: 'image' });
    expect(KNOWN_FILE_TYPES['image/avif']).toEqual({ extension: 'avif', category: 'image' });
  });

  it('contains document types', () => {
    expect(KNOWN_FILE_TYPES['application/pdf']).toEqual({ extension: 'pdf', category: 'document' });
    expect(KNOWN_FILE_TYPES['text/plain']).toEqual({ extension: 'txt', category: 'document' });
  });

  it('contains audio types', () => {
    expect(KNOWN_FILE_TYPES['audio/mpeg']).toEqual({ extension: 'mp3', category: 'audio' });
    expect(KNOWN_FILE_TYPES['audio/mp4']).toEqual({ extension: 'm4a', category: 'audio' });
    expect(KNOWN_FILE_TYPES['audio/wav']).toEqual({ extension: 'wav', category: 'audio' });
    expect(KNOWN_FILE_TYPES['audio/ogg']).toEqual({ extension: 'ogg', category: 'audio' });
    expect(KNOWN_FILE_TYPES['audio/webm']).toEqual({ extension: 'webm', category: 'audio' });
  });

  it('contains video types', () => {
    expect(KNOWN_FILE_TYPES['video/mp4']).toEqual({ extension: 'mp4', category: 'video' });
  });
});

describe('ALLOWED_MIME_TYPES (deprecated compat)', () => {
  it('is an array of all keys from KNOWN_FILE_TYPES', () => {
    expect(ALLOWED_MIME_TYPES).toEqual(expect.arrayContaining(Object.keys(KNOWN_FILE_TYPES)));
    expect(ALLOWED_MIME_TYPES.length).toBe(Object.keys(KNOWN_FILE_TYPES).length);
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
