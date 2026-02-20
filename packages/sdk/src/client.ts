import type { AllowedMimeType } from './constants';
import { ALLOWED_MIME_TYPES, RETRY_CONFIG } from './constants';
import type {
  StorageBrainConfig,
  UploadOptions,
  FileInfo,
  ListFilesOptions,
  ListFilesResult,
  QuotaInfo,
  TenantInfo,
  UploadHandshake,
  Workspace,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from './types';
import {
  StorageBrainError,
  NetworkError,
  UploadError,
  InvalidFileTypeError,
  parseApiError,
} from './errors';

const DEFAULT_BASE_URL = 'https://storage-brain-api.marlin-pohl.workers.dev';
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
 *   context: 'my-app',
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
  private readonly workspaceId?: string;

  constructor(config: StorageBrainConfig) {
    if (!config.apiKey) {
      throw new StorageBrainError('API key is required', 'CONFIGURATION_ERROR');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.workspaceId = config.workspaceId;
  }

  /**
   * Return a new client instance scoped to a specific workspace.
   * All uploads and file listings will default to this workspace.
   */
  withWorkspace(workspaceId: string): StorageBrain {
    return new StorageBrain({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      workspaceId,
    });
  }

  /**
   * Upload a file
   */
  async upload(file: File | Blob, options: UploadOptions = {}): Promise<FileInfo> {
    const { context, tags, onProgress, webhookUrl, signal, workspaceId } = options;

    // Get file info
    const fileName = file instanceof File ? file.name : 'file';
    const fileType = file.type as AllowedMimeType;
    const fileSize = file.size;

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(fileType)) {
      throw new InvalidFileTypeError(fileType, [...ALLOWED_MIME_TYPES]);
    }

    // Resolve workspace: option override > client default
    const resolvedWorkspaceId = workspaceId ?? this.workspaceId;

    // Request upload handshake
    const handshake = await this.requestUpload({
      fileType,
      fileName,
      fileSizeBytes: fileSize,
      context,
      tags,
      webhookUrl,
      workspaceId: resolvedWorkspaceId,
    });

    onProgress?.(10);

    // Upload file to presigned URL
    await this.uploadToPresignedUrl(handshake.presignedUrl, file, fileType, (progress) => {
      // Map upload progress to 10-90%
      onProgress?.(10 + Math.round(progress * 0.8));
    }, signal);

    onProgress?.(90);

    // Fetch the completed file info
    const fileInfo = await this.getFile(handshake.fileId);

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
    context?: string;
    tags?: Record<string, string>;
    webhookUrl?: string;
    workspaceId?: string;
  }): Promise<UploadHandshake> {
    return this.request<UploadHandshake>('POST', '/api/v1/upload/request', params);
  }

  /**
   * Check if running in a browser environment
   */
  private isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof XMLHttpRequest !== 'undefined';
  }

  /**
   * Upload file content to presigned URL
   * Uses XMLHttpRequest in browsers (for progress tracking) and fetch in Node.js
   * Returns upload response which may include immediate OCR results for small files
   */
  private async uploadToPresignedUrl(
    presignedUrl: string,
    file: File | Blob,
    contentType: string,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<{ processingStatus?: string; metadata?: Record<string, unknown> } | null> {
    // Determine if URL is relative (our internal endpoint) or absolute (direct R2)
    const uploadUrl = presignedUrl.startsWith('/')
      ? `${this.baseUrl}${presignedUrl}`
      : presignedUrl;

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': contentType,
    };

    // Add auth header for internal endpoint
    if (presignedUrl.startsWith('/')) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      if (this.isBrowser()) {
        // Use XMLHttpRequest in browsers for progress tracking
        return await this.uploadWithXHR(uploadUrl, file, headers, onProgress, signal);
      } else {
        // Use fetch in Node.js (no granular progress, but works universally)
        return await this.uploadWithFetch(uploadUrl, file, headers, onProgress, signal);
      }
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
   * Upload using XMLHttpRequest (browser only, supports progress)
   * Returns the parsed JSON response if available
   */
  private uploadWithXHR(
    url: string,
    file: File | Blob,
    headers: Record<string, string>,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<{ processingStatus?: string; metadata?: Record<string, unknown> } | null> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Try to parse JSON response
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch {
            resolve(null);
          }
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

      xhr.open('PUT', url);
      for (const [key, value] of Object.entries(headers)) {
        xhr.setRequestHeader(key, value);
      }
      xhr.send(file);
    });
  }

  /**
   * Upload using fetch (works in Node.js and browsers, limited progress support)
   * Returns the parsed JSON response if available
   */
  private async uploadWithFetch(
    url: string,
    file: File | Blob,
    headers: Record<string, string>,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<{ processingStatus?: string; metadata?: Record<string, unknown> } | null> {
    // In Node.js, we can't track granular upload progress with fetch
    // Report 0% at start and 100% on completion
    onProgress?.(0);

    // Convert Blob to buffer for Node.js compatibility
    const body = await this.blobToBuffer(file);

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body,
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new UploadError(`Upload failed with status ${response.status}: ${errorText}`);
    }

    onProgress?.(100);

    // Try to parse JSON response
    try {
      const result = await response.json();
      return result as { processingStatus?: string; metadata?: Record<string, unknown> };
    } catch {
      return null;
    }
  }

  /**
   * Convert Blob to ArrayBuffer for Node.js fetch compatibility
   */
  private async blobToBuffer(blob: File | Blob): Promise<ArrayBuffer> {
    if (typeof blob.arrayBuffer === 'function') {
      return blob.arrayBuffer();
    }
    // Fallback for older environments
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(blob);
    });
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

    // Resolve workspace: option override > client default
    const resolvedWorkspaceId = options?.workspaceId ?? this.workspaceId;
    if (resolvedWorkspaceId) params.set('workspaceId', resolvedWorkspaceId);

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

  // ==========================================================================
  // Workspace Methods
  // ==========================================================================

  /**
   * Create a workspace
   */
  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    return this.request<Workspace>('POST', '/api/v1/workspaces', input);
  }

  /**
   * List workspaces
   */
  async listWorkspaces(): Promise<Workspace[]> {
    const result = await this.request<{ workspaces: Workspace[] }>('GET', '/api/v1/workspaces');
    return result.workspaces;
  }

  /**
   * Get a workspace by ID
   */
  async getWorkspace(workspaceId: string): Promise<Workspace> {
    return this.request<Workspace>('GET', `/api/v1/workspaces/${workspaceId}`);
  }

  /**
   * Update a workspace
   */
  async updateWorkspace(workspaceId: string, updates: UpdateWorkspaceInput): Promise<Workspace> {
    return this.request<Workspace>('PATCH', `/api/v1/workspaces/${workspaceId}`, updates);
  }

  /**
   * Delete a workspace and soft-delete all its files
   */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.request<{ success: boolean }>('DELETE', `/api/v1/workspaces/${workspaceId}`);
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

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        };
        if (this.workspaceId) {
          headers['X-Workspace-Id'] = this.workspaceId;
        }

        const response = await fetch(url, {
          method,
          headers,
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
