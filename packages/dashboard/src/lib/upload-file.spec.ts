import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadFile, UploadCanceledError, UPLOAD_MESSAGES } from './upload-file';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type Listener = (ev?: unknown) => void;

class FakeUpload {
  listeners: Record<string, Listener[]> = {};
  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ||= []).push(cb);
  }
  emit(type: string, ev?: unknown) {
    (this.listeners[type] || []).forEach((cb) => cb(ev));
  }
}

class FakeXHR {
  static onSend: ((xhr: FakeXHR) => void) | null = null;

  upload = new FakeUpload();
  listeners: Record<string, Listener[]> = {};
  status = 0;

  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ||= []).push(cb);
  }
  emit(type: string, ev?: unknown) {
    (this.listeners[type] || []).forEach((cb) => cb(ev));
  }
  open() {}
  setRequestHeader() {}
  send() {
    FakeXHR.onSend?.(this);
  }
  abort() {
    this.emit('abort');
  }

  // test helpers
  emitProgress(loaded: number, total: number) {
    this.upload.emit('progress', { lengthComputable: true, loaded, total });
  }
  complete(status: number) {
    this.status = status;
    this.emit('load');
  }
}

const mockFetch = vi.fn();

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const handshake = {
  fileId: 'file-1',
  presignedUrl: 'https://api.example.com/_internal/upload/x?token=a&expires=1',
  expiresAt: '2026-06-16T00:00:00.000Z',
  uploadMetadata: { maxSizeBytes: 100 * 1024 * 1024, allowedTypes: null },
};

function makeFile(over: Partial<{ name: string; type: string; size: number }> = {}): File {
  return {
    name: over.name ?? 'a.png',
    type: over.type ?? 'image/png',
    size: over.size ?? 1024,
  } as unknown as File;
}

beforeEach(() => {
  mockFetch.mockReset();
  FakeXHR.onSend = null;
  vi.stubGlobal('fetch', mockFetch);
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadFile', () => {
  it('reports progress from the XHR and resolves with the file id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(handshake));
    FakeXHR.onSend = (xhr) => {
      xhr.emitProgress(50, 100);
      xhr.emitProgress(100, 100);
      xhr.complete(200);
    };

    const progress: number[] = [];
    const result = await uploadFile({
      tenantId: 't1',
      file: makeFile(),
      onProgress: (p) => progress.push(p),
    });

    expect(result.fileId).toBe('file-1');
    expect(progress).toContain(50);
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('cancels: aborting the signal aborts the XHR and rejects with UploadCanceledError', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(handshake));
    FakeXHR.onSend = () => {
      /* hang: never completes until aborted */
    };

    const controller = new AbortController();
    const p = uploadFile({ tenantId: 't1', file: makeFile(), signal: controller.signal });

    await tick();
    controller.abort();

    await expect(p).rejects.toBeInstanceOf(UploadCanceledError);
    await expect(p).rejects.toThrowError(UPLOAD_MESSAGES.canceled);
  });

  describe('client-side validation (no network)', () => {
    it('rejects an over-size file before requesting a handshake', async () => {
      await expect(
        uploadFile({ tenantId: 't1', file: makeFile({ size: 200 * 1024 * 1024 }) })
      ).rejects.toThrowError(UPLOAD_MESSAGES.tooLarge);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects a file with no/invalid MIME type', async () => {
      await expect(
        uploadFile({ tenantId: 't1', file: makeFile({ type: '' }) })
      ).rejects.toThrowError(/not allowed for this tenant/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('handshake unhappy paths (all surface a message)', () => {
    it('disallowed MIME type', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ code: 'INVALID_FILE_TYPE', details: { fileType: 'image/png' } }, 400)
      );
      await expect(uploadFile({ tenantId: 't1', file: makeFile() })).rejects.toThrowError(
        /File type 'image\/png' is not allowed for this tenant\./
      );
    });

    it('too large', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 'FILE_TOO_LARGE' }, 400));
      await expect(uploadFile({ tenantId: 't1', file: makeFile() })).rejects.toThrowError(
        UPLOAD_MESSAGES.tooLarge
      );
    });

    it('tenant quota exceeded (with byte details)', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ code: 'QUOTA_EXCEEDED', details: { usedBytes: 1048576, quotaBytes: 2097152 } }, 403)
      );
      await expect(uploadFile({ tenantId: 't1', file: makeFile() })).rejects.toThrowError(
        /Storage full: 1\.0 MB\/2\.0 MB\./
      );
    });

    it('quota exceeded without details falls back to a plain message', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 'QUOTA_EXCEEDED' }, 403));
      await expect(uploadFile({ tenantId: 't1', file: makeFile() })).rejects.toThrowError(
        UPLOAD_MESSAGES.storageFull
      );
    });

    it('workspace missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 'NOT_FOUND' }, 404));
      await expect(uploadFile({ tenantId: 't1', file: makeFile() })).rejects.toThrowError(
        UPLOAD_MESSAGES.workspaceMissing
      );
    });

    it('network failure requesting the handshake', async () => {
      mockFetch.mockRejectedValueOnce(new Error('connection refused'));
      await expect(uploadFile({ tenantId: 't1', file: makeFile() })).rejects.toThrowError(
        UPLOAD_MESSAGES.network
      );
    });
  });

  describe('byte-PUT unhappy paths', () => {
    it('re-requests a fresh handshake once on 410 and succeeds on retry', async () => {
      const handshake2 = { ...handshake, fileId: 'file-2' };
      mockFetch
        .mockResolvedValueOnce(jsonResponse(handshake))
        .mockResolvedValueOnce(jsonResponse(handshake2));

      let attempt = 0;
      FakeXHR.onSend = (xhr) => {
        attempt += 1;
        if (attempt === 1) {
          xhr.complete(410);
        } else {
          xhr.emitProgress(100, 100);
          xhr.complete(200);
        }
      };

      const result = await uploadFile({ tenantId: 't1', file: makeFile() });

      expect(result.fileId).toBe('file-2');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('surfaces an expired message when the 410 retry also fails', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(handshake))
        .mockResolvedValueOnce(jsonResponse(handshake));

      FakeXHR.onSend = (xhr) => xhr.complete(410);

      await expect(uploadFile({ tenantId: 't1', file: makeFile() })).rejects.toThrowError(
        UPLOAD_MESSAGES.expired
      );
    });

    it('maps a transport error during the PUT to a network message', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(handshake));
      FakeXHR.onSend = (xhr) => xhr.emit('error');

      await expect(uploadFile({ tenantId: 't1', file: makeFile() })).rejects.toThrowError(
        UPLOAD_MESSAGES.network
      );
    });

    it('maps an unexpected PUT status to a generic message', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(handshake));
      FakeXHR.onSend = (xhr) => xhr.complete(500);

      await expect(uploadFile({ tenantId: 't1', file: makeFile() })).rejects.toThrowError(
        UPLOAD_MESSAGES.generic
      );
    });
  });
});
