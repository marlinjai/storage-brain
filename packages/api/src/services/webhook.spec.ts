import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendWebhook } from './webhook';
import type { FileResponse } from '@storage-brain/shared';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockFile: FileResponse = {
  id: 'file-1',
  url: '/api/v1/files/file-1/download',
  originalName: 'test.png',
  fileType: 'image/png',
  sizeBytes: 1024,
  context: null,
  tags: null,
  metadata: null,
  processingStatus: 'completed',
  workspaceId: null,
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('sendWebhook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends webhook with correct payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await sendWebhook({
      fileId: 'file-1',
      tenantId: 'tenant-1',
      workspaceId: null,
      file: mockFile,
      webhookUrl: 'https://example.com/webhook',
      event: 'file.uploaded',
    });

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://example.com/webhook');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(body.event).toBe('file.uploaded');
    expect(body.fileId).toBe('file-1');
    expect(body.tenantId).toBe('tenant-1');
    expect(body.file.id).toBe('file-1');
    expect(body.timestamp).toBeDefined();
  });

  it('retries on failure and succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true });

    const p = sendWebhook({
      fileId: 'file-1',
      tenantId: 'tenant-1',
      workspaceId: null,
      file: mockFile,
      webhookUrl: 'https://example.com/webhook',
      event: 'file.uploaded',
    });

    // Advance past retry delay
    await vi.advanceTimersByTimeAsync(10000);
    const result = await p;

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns false after all retries fail', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const p = sendWebhook({
      fileId: 'file-1',
      tenantId: 'tenant-1',
      workspaceId: null,
      file: mockFile,
      webhookUrl: 'https://example.com/webhook',
      event: 'file.failed',
    });

    // Advance past all retry delays
    await vi.advanceTimersByTimeAsync(60000);
    const result = await p;

    expect(result).toBe(false);
  });

  it('handles fetch errors (network issues)', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    const p = sendWebhook({
      fileId: 'file-1',
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      file: mockFile,
      webhookUrl: 'https://example.com/webhook',
      event: 'file.uploaded',
    });

    await vi.advanceTimersByTimeAsync(60000);
    const result = await p;

    expect(result).toBe(false);
  });

  it('includes workspaceId in payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await sendWebhook({
      fileId: 'file-1',
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      file: mockFile,
      webhookUrl: 'https://example.com/webhook',
      event: 'file.uploaded',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.workspaceId).toBe('ws-1');
  });
});
