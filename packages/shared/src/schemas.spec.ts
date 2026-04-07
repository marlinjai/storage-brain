import { describe, it, expect } from 'vitest';
import {
  requestUploadSchema,
  listFilesQuerySchema,
  fileIdSchema,
  createTenantSchema,
  webhookPayloadSchema,
  createWorkspaceSchema,
  updateWorkspaceSchema,
  fileTypeSchema,
  tagsSchema,
} from './schemas';

describe('fileTypeSchema', () => {
  it('accepts valid MIME types', () => {
    expect(fileTypeSchema.parse('image/jpeg')).toBe('image/jpeg');
    expect(fileTypeSchema.parse('image/png')).toBe('image/png');
    expect(fileTypeSchema.parse('application/pdf')).toBe('application/pdf');
  });

  it('accepts any valid MIME type string', () => {
    expect(fileTypeSchema.parse('text/plain')).toBe('text/plain');
    expect(fileTypeSchema.parse('video/mp4')).toBe('video/mp4');
    expect(fileTypeSchema.parse('audio/wav')).toBe('audio/wav');
  });

  it('rejects invalid MIME type formats', () => {
    expect(() => fileTypeSchema.parse('')).toThrow();
    expect(() => fileTypeSchema.parse('not-a-mime')).toThrow();
    expect(() => fileTypeSchema.parse('just/spaces here')).toThrow();
  });
});

describe('tagsSchema', () => {
  it('accepts valid tags', () => {
    const result = tagsSchema.parse({ key: 'value', another: 'tag' });
    expect(result).toEqual({ key: 'value', another: 'tag' });
  });

  it('accepts undefined (optional)', () => {
    expect(tagsSchema.parse(undefined)).toBeUndefined();
  });

  it('rejects tag values exceeding 500 chars', () => {
    expect(() => tagsSchema.parse({ key: 'x'.repeat(501) })).toThrow();
  });

  it('rejects tag keys exceeding 100 chars', () => {
    expect(() => tagsSchema.parse({ ['k'.repeat(101)]: 'value' })).toThrow();
  });
});

describe('requestUploadSchema', () => {
  const validInput = {
    fileType: 'image/png',
    fileName: 'test.png',
  };

  it('accepts minimal valid input', () => {
    const result = requestUploadSchema.parse(validInput);
    expect(result.fileType).toBe('image/png');
    expect(result.fileName).toBe('test.png');
  });

  it('accepts full valid input', () => {
    const result = requestUploadSchema.parse({
      ...validInput,
      fileSizeBytes: 1024,
      context: 'my-app',
      tags: { project: 'test' },
      webhookUrl: 'https://example.com/hook',
      workspaceId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.fileSizeBytes).toBe(1024);
    expect(result.context).toBe('my-app');
  });

  it('rejects empty fileName', () => {
    expect(() => requestUploadSchema.parse({ ...validInput, fileName: '' })).toThrow();
  });

  it('rejects fileName with invalid characters', () => {
    expect(() => requestUploadSchema.parse({ ...validInput, fileName: 'file<>.png' })).toThrow();
  });

  it('rejects fileName exceeding 255 chars', () => {
    expect(() => requestUploadSchema.parse({ ...validInput, fileName: 'a'.repeat(256) })).toThrow();
  });

  it('rejects invalid fileType format', () => {
    expect(() => requestUploadSchema.parse({ ...validInput, fileType: 'notamime' })).toThrow();
  });

  it('rejects negative fileSizeBytes', () => {
    expect(() => requestUploadSchema.parse({ ...validInput, fileSizeBytes: -1 })).toThrow();
  });

  it('rejects fileSizeBytes exceeding max', () => {
    expect(() =>
      requestUploadSchema.parse({ ...validInput, fileSizeBytes: 200 * 1024 * 1024 })
    ).toThrow();
  });

  it('rejects invalid webhookUrl', () => {
    expect(() => requestUploadSchema.parse({ ...validInput, webhookUrl: 'not-a-url' })).toThrow();
  });

  it('rejects invalid workspaceId (not UUID)', () => {
    expect(() => requestUploadSchema.parse({ ...validInput, workspaceId: 'not-a-uuid' })).toThrow();
  });
});

describe('listFilesQuerySchema', () => {
  it('applies defaults for empty input', () => {
    const result = listFilesQuerySchema.parse({});
    expect(result.limit).toBe(20);
  });

  it('coerces limit from string', () => {
    const result = listFilesQuerySchema.parse({ limit: '50' });
    expect(result.limit).toBe(50);
  });

  it('clamps limit to max 100', () => {
    expect(() => listFilesQuerySchema.parse({ limit: '200' })).toThrow();
  });

  it('clamps limit to min 1', () => {
    expect(() => listFilesQuerySchema.parse({ limit: '0' })).toThrow();
  });

  it('accepts optional filters', () => {
    const result = listFilesQuerySchema.parse({
      context: 'my-app',
      fileType: 'image/png',
      workspaceId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.context).toBe('my-app');
    expect(result.fileType).toBe('image/png');
  });
});

describe('fileIdSchema', () => {
  it('accepts valid UUID', () => {
    expect(fileIdSchema.parse('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    );
  });

  it('rejects non-UUID strings', () => {
    expect(() => fileIdSchema.parse('not-a-uuid')).toThrow();
    expect(() => fileIdSchema.parse('')).toThrow();
  });
});

describe('createTenantSchema', () => {
  it('accepts valid input', () => {
    const result = createTenantSchema.parse({ name: 'My Tenant' });
    expect(result.name).toBe('My Tenant');
  });

  it('accepts optional fields', () => {
    const result = createTenantSchema.parse({
      name: 'My Tenant',
      quotaBytes: 1024 * 1024,
      allowedFileTypes: ['image/png', 'application/pdf'],
    });
    expect(result.quotaBytes).toBe(1024 * 1024);
    expect(result.allowedFileTypes).toEqual(['image/png', 'application/pdf']);
  });

  it('rejects empty name', () => {
    expect(() => createTenantSchema.parse({ name: '' })).toThrow();
  });

  it('rejects name exceeding 100 chars', () => {
    expect(() => createTenantSchema.parse({ name: 'a'.repeat(101) })).toThrow();
  });
});

describe('webhookPayloadSchema', () => {
  const validPayload = {
    event: 'file.uploaded',
    fileId: '550e8400-e29b-41d4-a716-446655440000',
    tenantId: '660e8400-e29b-41d4-a716-446655440000',
    workspaceId: null,
    file: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      url: 'https://example.com/file.png',
      originalName: 'test.png',
      fileType: 'image/png',
      sizeBytes: 1024,
      context: null,
      tags: null,
      metadata: null,
      processingStatus: 'completed',
      workspaceId: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    timestamp: '2024-01-01T00:00:00.000Z',
  };

  it('accepts valid payload', () => {
    const result = webhookPayloadSchema.parse(validPayload);
    expect(result.event).toBe('file.uploaded');
  });

  it('accepts file.failed event', () => {
    const result = webhookPayloadSchema.parse({ ...validPayload, event: 'file.failed' });
    expect(result.event).toBe('file.failed');
  });

  it('rejects invalid event', () => {
    expect(() => webhookPayloadSchema.parse({ ...validPayload, event: 'invalid' })).toThrow();
  });
});

describe('createWorkspaceSchema', () => {
  it('accepts valid input', () => {
    const result = createWorkspaceSchema.parse({ name: 'My Workspace', slug: 'my-workspace' });
    expect(result.name).toBe('My Workspace');
    expect(result.slug).toBe('my-workspace');
  });

  it('accepts single-char slug', () => {
    const result = createWorkspaceSchema.parse({ name: 'X', slug: 'x' });
    expect(result.slug).toBe('x');
  });

  it('rejects slug with uppercase', () => {
    expect(() => createWorkspaceSchema.parse({ name: 'Test', slug: 'My-Workspace' })).toThrow();
  });

  it('rejects slug starting with hyphen', () => {
    expect(() => createWorkspaceSchema.parse({ name: 'Test', slug: '-workspace' })).toThrow();
  });

  it('rejects slug ending with hyphen', () => {
    expect(() => createWorkspaceSchema.parse({ name: 'Test', slug: 'workspace-' })).toThrow();
  });

  it('accepts optional quotaBytes and metadata', () => {
    const result = createWorkspaceSchema.parse({
      name: 'Ws',
      slug: 'ws',
      quotaBytes: 5000,
      metadata: { env: 'test' },
    });
    expect(result.quotaBytes).toBe(5000);
    expect(result.metadata).toEqual({ env: 'test' });
  });
});

describe('updateWorkspaceSchema', () => {
  it('accepts empty object (all optional)', () => {
    const result = updateWorkspaceSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts name update', () => {
    const result = updateWorkspaceSchema.parse({ name: 'New Name' });
    expect(result.name).toBe('New Name');
  });

  it('accepts null quotaBytes (to remove quota)', () => {
    const result = updateWorkspaceSchema.parse({ quotaBytes: null });
    expect(result.quotaBytes).toBeNull();
  });

  it('rejects empty name', () => {
    expect(() => updateWorkspaceSchema.parse({ name: '' })).toThrow();
  });
});
