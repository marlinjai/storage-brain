import type { AllowedMimeType } from '@storage-brain/shared';
import { ALLOWED_MIME_TYPES, RETRY_CONFIG } from '@storage-brain/shared';
import type {
  StorageBrainConfig,
  UploadOptions,
  FileInfo,
  ListFilesOptions,
  ListFilesResult,
  QuotaInfo,
  TenantInfo,
  UploadHandshake,
} from './types';
import {
  StorageBrainError,
  NetworkError,
  UploadError,
  InvalidFileTypeError,
  parseApiError,
} from './errors';

const DEFAULT_BASE_URL = 'https://storage-brain-api.workers.dev';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Storage Brain SDK Client
 *
 * @example
 * ```typescript
 * const storage = new StorageBrain({
 *   apiKey: 'sk_live_...',
 * });
 *
 * // Upload a file
 * const file = await storage.upload(fileBlob, {
 *   context: 'newsletter',
 *   onProgress: (p) => console.log(`${p}%`),
 * });
 *
 * console.log(file.url);
 * ```
 */
export class StorageBrain {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(config: StorageBrainConfig) {
    if (!config.apiKey) {
      throw new StorageBrainError('API key is required', 'CONFIGURATION_ERROR');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /**
   * Upload a file
   */
  async upload(file: File | Blob, options: UploadOptions): Promise<FileInfo> {
    const { context, tags, onProgress, webhookUrl, signal } = options;

    // Get file info
    const fileName = file instanceof File ? file.name : 'file';
    const fileType = file.type as AllowedMimeType;
    const fileSize = file.size;

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(fileType)) {
      throw new InvalidFileTypeError(fileType, [...ALLOWED_MIME_TYPES]);
    }

    // Request upload handshake
    const handshake = await this.requestUpload({
      fileType,
      fileName,
      fileSizeBytes: fileSize,
      context,
      tags,
      webhookUrl,
    });

    onProgress?.(10);

    // Upload file to presigned URL
    await this.uploadToPresignedUrl(handshake.presignedUrl, file, fileType, (progress) => {
      // Map upload progress to 10-90%
      onProgress?.(10 + Math.round(progress * 0.8));
    }, signal);

    onProgress?.(90);

    // Poll for file status (processing may take time)
    const fileInfo = await this.waitForProcessing(handshake.fileId, signal);

    onProgress?.(100);

    return fileInfo;
  }

  /**
   * Request an upload handshake
   */
  private async requestUpload(params: {
    fileType: AllowedMimeType;
    fileName: string;
    fileSizeBytes: number;
    context: string;
    tags?: Record<string, string>;
    webhookUrl?: string;
  }): Promise<UploadHandshake> {
    return this.request<UploadHandshake>('POST', '/api/v1/upload/request', params);
  }

  /**
   * Upload file content to presigned URL
   */
  private async uploadToPresignedUrl(
    presignedUrl: string,
    file: File | Blob,
    contentType: string,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    // Determine if URL is relative (our internal endpoint) or absolute (direct R2)
    const uploadUrl = presignedUrl.startsWith('/')
      ? `${this.baseUrl}${presignedUrl}`
      : presignedUrl;

    try {
      // Use XMLHttpRequest for progress tracking
      await new Promise<void>((resolve, reject) => {
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
            reject(new UploadError(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new NetworkError('Network error during upload'));
        });

        xhr.addEventListener('abort', () => {
          reject(new UploadError('Upload was cancelled'));
        });

        if (signal) {
          signal.addEventListener('abort', () => {
            xhr.abort();
          });
        }

        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', contentType);

        // Add auth header for internal endpoint
        if (presignedUrl.startsWith('/')) {
          xhr.setRequestHeader('Authorization', `Bearer ${this.apiKey}`);
        }

        xhr.send(file);
      });
    } catch (error) {
      if (error instanceof StorageBrainError) {
        throw error;
      }
      throw new UploadError(
        'Failed to upload file',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Wait for file processing to complete
   */
  private async waitForProcessing(
    fileId: string,
    signal?: AbortSignal,
    maxWaitMs = 60000,
    pollIntervalMs = 1000
  ): Promise<FileInfo> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      if (signal?.aborted) {
        throw new UploadError('Operation was cancelled');
      }

      const file = await this.getFile(fileId);

      if (file.processingStatus === 'completed' || file.processingStatus === 'failed') {
        return file;
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Return current state even if not fully processed
    return this.getFile(fileId);
  }

  /**
   * Get a file by ID
   */
  async getFile(fileId: string): Promise<FileInfo> {
    return this.request<FileInfo>('GET', `/api/v1/files/${fileId}`);
  }

  /**
   * List files
   */
  async listFiles(options?: ListFilesOptions): Promise<ListFilesResult> {
    const params = new URLSearchParams();

    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.context) params.set('context', options.context);
    if (options?.fileType) params.set('fileType', options.fileType);

    const query = params.toString();
    const path = query ? `/api/v1/files?${query}` : '/api/v1/files';

    return this.request<ListFilesResult>('GET', path);
  }

  /**
   * Delete a file
   */
  async deleteFile(fileId: string): Promise<void> {
    await this.request<{ success: boolean }>('DELETE', `/api/v1/files/${fileId}`);
  }

  /**
   * Get quota usage
   */
  async getQuota(): Promise<QuotaInfo> {
    return this.request<QuotaInfo>('GET', '/api/v1/tenant/quota');
  }

  /**
   * Get tenant information
   */
  async getTenantInfo(): Promise<TenantInfo> {
    return this.request<TenantInfo>('GET', '/api/v1/tenant/info');
  }

  /**
   * Make an authenticated API request with retry logic
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw parseApiError(response.status, errorBody as { error?: { code?: string; message?: string; details?: Record<string, unknown> } });
        }

        return await response.json() as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx) or specific errors
        if (error instanceof StorageBrainError && error.statusCode && error.statusCode < 500) {
          throw error;
        }

        // Exponential backoff for retries
        if (attempt < this.maxRetries - 1) {
          const delay = Math.min(
            RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
            RETRY_CONFIG.maxDelayMs
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new NetworkError(
      `Request failed after ${this.maxRetries} attempts`,
      lastError
    );
  }
}

// Default export for convenience
export default StorageBrain;
