/**
 * Framework-agnostic browser upload engine for the dashboard.
 *
 * The dashboard never holds a tenant API key: it asks its own server route
 * (`POST /api/tenants/[id]/upload/request`, admin-credentialed) for an upload
 * handshake, then PUTs the file bytes browser-direct to the returned presigned
 * URL via XMLHttpRequest (so we get progress + AbortSignal cancel without
 * streaming up to 100MB through the Next server).
 *
 * All orchestration lives here (and is unit-tested) so the React dialog can
 * stay a thin consumer. Every failure path produces a user-facing message; none
 * are swallowed.
 */

/** Per-file 100MB cap. Mirrors the server-side MAX_FILE_SIZE_BYTES; do not raise. */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

const MIME_RE = /^[a-z]+\/[a-z0-9.+\-]+$/i;

export interface UploadHandshake {
  fileId: string;
  presignedUrl: string;
  expiresAt: string;
  uploadMetadata: {
    maxSizeBytes: number;
    allowedTypes: string[] | null;
  };
}

export interface UploadFileMeta {
  context?: string;
  tags?: Record<string, string>;
  workspaceId?: string;
}

export interface UploadFileOptions {
  tenantId: string;
  file: File;
  meta?: UploadFileMeta;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** User-facing messages for every unhappy path. */
export const UPLOAD_MESSAGES = {
  tooLarge: 'File exceeds the 100 MB limit.',
  storageFull: 'Storage full.',
  workspaceMissing: 'Selected workspace no longer exists.',
  expired: 'Upload link expired, please retry.',
  network: 'Upload failed, check your connection and retry.',
  canceled: 'Upload canceled.',
  generic: 'Upload failed, please retry.',
};

/** Error carrying a message safe to render directly in the dialog. */
export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

/** The user aborted the upload. */
export class UploadCanceledError extends Error {
  constructor() {
    super(UPLOAD_MESSAGES.canceled);
    this.name = 'UploadCanceledError';
  }
}

/** Internal: a non-2xx HTTP status from the byte PUT. */
class HttpStatusError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}

/** Internal: a transport-level failure during the byte PUT. */
class TransportError extends Error {
  constructor() {
    super('transport error');
    this.name = 'TransportError';
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

interface HandshakeErrorBody {
  error?: string;
  code?: string;
  details?: { fileType?: string; usedBytes?: number; quotaBytes?: number };
}

/**
 * Map a failed handshake response to a user-facing message. Maps by API error
 * `code` first, then falls back to HTTP status, then to the raw error text, so
 * no failure is ever rendered as a blank or generic-only message.
 */
export function messageForHandshakeError(
  status: number,
  body: HandshakeErrorBody,
  fileType: string
): string {
  const code = body?.code;
  const details = body?.details ?? {};

  switch (code) {
    case 'INVALID_FILE_TYPE':
      return `File type '${details.fileType ?? fileType}' is not allowed for this tenant.`;
    case 'FILE_TOO_LARGE':
      return UPLOAD_MESSAGES.tooLarge;
    case 'QUOTA_EXCEEDED':
      return details.usedBytes != null && details.quotaBytes != null
        ? `Storage full: ${formatBytes(details.usedBytes)}/${formatBytes(details.quotaBytes)}.`
        : UPLOAD_MESSAGES.storageFull;
    case 'NOT_FOUND':
    case 'FILE_NOT_FOUND':
      return UPLOAD_MESSAGES.workspaceMissing;
    case 'VALIDATION_ERROR':
      return body?.error ?? UPLOAD_MESSAGES.generic;
  }

  switch (status) {
    case 400:
      return body?.error ?? UPLOAD_MESSAGES.generic;
    case 403:
      return UPLOAD_MESSAGES.storageFull;
    case 404:
      return UPLOAD_MESSAGES.workspaceMissing;
    case 413:
      return UPLOAD_MESSAGES.tooLarge;
    default:
      return body?.error ?? UPLOAD_MESSAGES.generic;
  }
}

async function requestHandshake(
  tenantId: string,
  meta: {
    fileName: string;
    fileType: string;
    fileSizeBytes: number;
    context?: string;
    tags?: Record<string, string>;
    workspaceId?: string;
  },
  signal?: AbortSignal
): Promise<UploadHandshake> {
  let res: Response;
  try {
    res = await fetch(`/api/tenants/${tenantId}/upload/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
      signal,
    });
  } catch (err) {
    if (signal?.aborted || (err as Error)?.name === 'AbortError') {
      throw new UploadCanceledError();
    }
    throw new UploadError(UPLOAD_MESSAGES.network);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as HandshakeErrorBody;
    throw new UploadError(messageForHandshakeError(res.status, body, meta.fileType));
  }

  return (await res.json()) as UploadHandshake;
}

/**
 * PUT the file bytes to the presigned URL. Uses XMLHttpRequest when available
 * (for upload progress + abort); falls back to fetch otherwise. Resolves on a
 * 2xx; rejects with HttpStatusError / TransportError / UploadCanceledError.
 */
function putBytes(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<void> {
  if (typeof XMLHttpRequest !== 'undefined') {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new HttpStatusError(xhr.status));
        }
      });

      xhr.addEventListener('error', () => reject(new TransportError()));
      xhr.addEventListener('abort', () => reject(new UploadCanceledError()));

      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', contentType);

      if (signal) {
        signal.addEventListener('abort', () => xhr.abort());
        if (signal.aborted) {
          xhr.abort();
          return;
        }
      }

      xhr.send(file);
    });
  }

  // Fetch fallback (e.g. non-browser / SSR). No granular progress.
  return (async () => {
    onProgress?.(0);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
        signal,
      });
    } catch (err) {
      if (signal?.aborted || (err as Error)?.name === 'AbortError') {
        throw new UploadCanceledError();
      }
      throw new TransportError();
    }
    if (!res.ok) {
      throw new HttpStatusError(res.status);
    }
    onProgress?.(100);
  })();
}

/**
 * Upload a single file end to end: client-side validation, admin handshake,
 * browser-direct byte PUT with progress + cancel, and a single auto-retry if
 * the presigned URL expires (410) mid-upload.
 */
export async function uploadFile(options: UploadFileOptions): Promise<{ fileId: string }> {
  const { tenantId, file, meta = {}, onProgress, signal } = options;

  if (signal?.aborted) {
    throw new UploadCanceledError();
  }

  // Cheap client-side checks so the common rejections are instant. The server
  // checks remain authoritative.
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new UploadError(UPLOAD_MESSAGES.tooLarge);
  }
  const fileType = file.type;
  if (!fileType || !MIME_RE.test(fileType)) {
    throw new UploadError(`File type '${fileType || 'unknown'}' is not allowed for this tenant.`);
  }

  onProgress?.(0);

  const requestMeta = {
    fileName: file.name,
    fileType,
    fileSizeBytes: file.size,
    context: meta.context,
    tags: meta.tags,
    workspaceId: meta.workspaceId,
  };

  let handshake = await requestHandshake(tenantId, requestMeta, signal);

  try {
    await putBytes(handshake.presignedUrl, file, fileType, onProgress, signal);
  } catch (err) {
    if (err instanceof UploadCanceledError) throw err;

    // Presigned URL expired mid-upload: re-request a fresh handshake once and
    // retry. If it fails again, surface it.
    if (err instanceof HttpStatusError && err.status === 410) {
      handshake = await requestHandshake(tenantId, requestMeta, signal);
      try {
        await putBytes(handshake.presignedUrl, file, fileType, onProgress, signal);
      } catch (retryErr) {
        if (retryErr instanceof UploadCanceledError) throw retryErr;
        throw new UploadError(UPLOAD_MESSAGES.expired);
      }
    } else if (err instanceof TransportError) {
      throw new UploadError(UPLOAD_MESSAGES.network);
    } else if (err instanceof HttpStatusError) {
      throw new UploadError(UPLOAD_MESSAGES.generic);
    } else if (err instanceof UploadError) {
      throw err;
    } else {
      throw new UploadError(UPLOAD_MESSAGES.generic);
    }
  }

  onProgress?.(100);
  return { fileId: handshake.fileId };
}
