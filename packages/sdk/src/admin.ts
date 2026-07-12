import { RETRY_CONFIG } from './constants';
import {
  StorageBrainError,
  NetworkError,
  parseApiError,
} from './errors';
import type { AllowedMimeType } from './constants';

const DEFAULT_BASE_URL = 'https://api.storage-brain.lumitra.co';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;

/** Shape of an API error envelope returned on non-2xx responses. */
type ApiErrorBody = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

// ============================================================================
// Admin Types
// ============================================================================

export interface StorageBrainAdminConfig {
  adminApiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface AdminTenant {
  id: string;
  name: string;
  keyPrefix: string | null;
  quotaBytes: number;
  usedBytes: number;
  allowedFileTypes: AllowedMimeType[] | null;
  createdAt: number;
  updatedAt: number;
}

export interface AdminTenantDetail extends AdminTenant {
  quota: {
    quotaBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  };
}

export interface CreateTenantInput {
  name: string;
  quotaBytes?: number;
  allowedFileTypes?: AllowedMimeType[];
  /** Optional auth-brain workspace binding (one workspace per tenant). */
  authWorkspaceId?: string;
}

export interface CreateTenantResult {
  id: string;
  name: string;
  apiKey: string;
  quotaBytes: number;
  allowedFileTypes: AllowedMimeType[];
}

export interface UpdateTenantInput {
  name?: string;
  quotaBytes?: number;
  allowedFileTypes?: AllowedMimeType[] | null;
  /** Optional auth-brain workspace binding; null clears it. */
  authWorkspaceId?: string | null;
}

export interface ListTenantsOptions {
  limit?: number;
  cursor?: string;
}

export interface ListTenantsResult {
  tenants: AdminTenant[];
  nextCursor: string | null;
  total: number;
}

export interface RegenerateKeyResult {
  tenantId: string;
  apiKey: string;
  message: string;
}

export interface AdminFileInfo {
  id: string;
  url: string;
  originalName: string;
  fileType: string;
  sizeBytes: number;
  context: string | null;
  tags: Record<string, string> | null;
  metadata: Record<string, unknown> | null;
  processingStatus: string;
  workspaceId: string | null;
  createdAt: string;
}

export interface ListTenantFilesOptions {
  limit?: number;
  cursor?: string;
  context?: string;
  fileType?: string;
  workspaceId?: string;
}

export interface ListTenantFilesResult {
  files: AdminFileInfo[];
  nextCursor: string | null;
  total: number;
}

export interface SignedUrlResult {
  fileId: string;
  url: string;
  expiresAt: string;
  expiresIn: number;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  quotaBytes: number | null;
  usedBytes: number;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  quotaBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface QuotaInfo {
  quotaBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
}

export interface RequestTenantUploadInput {
  fileName: string;
  fileType: string;
  fileSizeBytes?: number;
  context?: string;
  tags?: Record<string, string>;
  workspaceId?: string;
  webhookUrl?: string;
}

export interface AdminUploadHandshake {
  fileId: string;
  presignedUrl: string;
  expiresAt: string;
  uploadMetadata: {
    maxSizeBytes: number;
    allowedTypes: AllowedMimeType[] | null;
  };
}

/** Selector for a bulk workspace migration — by tag or by explicit file IDs. */
export type MigrateFilesFilter =
  | { tag: { key: string; value: string } }
  | { fileIds: string[] };

export interface MigrateFilesToWorkspaceInput {
  /** Target workspace; must belong to the tenant. */
  workspaceId: string;
  filter: MigrateFilesFilter;
  /** Only move files that currently have no workspace. Defaults to true server-side. */
  onlyUnassigned?: boolean;
}

export interface MigrateFilesToWorkspaceResult {
  migratedCount: number;
  totalBytes: number;
  workspaceId: string;
}

// ============================================================================
// Admin Client
// ============================================================================

export class StorageBrainAdmin {
  private readonly adminApiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(config: StorageBrainAdminConfig) {
    if (!config.adminApiKey) {
      throw new StorageBrainError('Admin API key is required', 'CONFIGURATION_ERROR');
    }

    this.adminApiKey = config.adminApiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async createTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
    return this.request<CreateTenantResult>('POST', '/api/v1/admin/tenants', input);
  }

  async listTenants(options?: ListTenantsOptions): Promise<ListTenantsResult> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.cursor) params.set('cursor', options.cursor);

    const query = params.toString();
    const path = query ? `/api/v1/admin/tenants?${query}` : '/api/v1/admin/tenants';

    return this.request<ListTenantsResult>('GET', path);
  }

  async getTenant(tenantId: string): Promise<AdminTenantDetail> {
    return this.request<AdminTenantDetail>('GET', `/api/v1/admin/tenants/${tenantId}`);
  }

  async updateTenant(tenantId: string, updates: UpdateTenantInput): Promise<AdminTenant> {
    return this.request<AdminTenant>('PATCH', `/api/v1/admin/tenants/${tenantId}`, updates);
  }

  async deleteTenant(tenantId: string): Promise<void> {
    await this.request<{ success: boolean }>('DELETE', `/api/v1/admin/tenants/${tenantId}`);
  }

  async regenerateKey(tenantId: string): Promise<RegenerateKeyResult> {
    return this.request<RegenerateKeyResult>(
      'POST',
      `/api/v1/admin/tenants/${tenantId}/regenerate-key`
    );
  }

  async listTenantFiles(
    tenantId: string,
    options?: ListTenantFilesOptions
  ): Promise<ListTenantFilesResult> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.context) params.set('context', options.context);
    if (options?.fileType) params.set('fileType', options.fileType);
    if (options?.workspaceId) params.set('workspaceId', options.workspaceId);

    const query = params.toString();
    const path = query
      ? `/api/v1/admin/tenants/${tenantId}/files?${query}`
      : `/api/v1/admin/tenants/${tenantId}/files`;

    return this.request<ListTenantFilesResult>('GET', path);
  }

  async getTenantFile(tenantId: string, fileId: string): Promise<AdminFileInfo> {
    return this.request<AdminFileInfo>(
      'GET',
      `/api/v1/admin/tenants/${tenantId}/files/${fileId}`
    );
  }

  async getTenantFileSignedUrl(
    tenantId: string,
    fileId: string,
    expiresIn?: number
  ): Promise<SignedUrlResult> {
    const params = new URLSearchParams();
    if (expiresIn !== undefined) params.set('expiresIn', expiresIn.toString());

    const query = params.toString();
    const path = query
      ? `/api/v1/admin/tenants/${tenantId}/files/${fileId}/signed-url?${query}`
      : `/api/v1/admin/tenants/${tenantId}/files/${fileId}/signed-url`;

    return this.request<SignedUrlResult>('GET', path);
  }

  async deleteTenantFile(tenantId: string, fileId: string): Promise<void> {
    await this.request<{ success: boolean }>(
      'DELETE',
      `/api/v1/admin/tenants/${tenantId}/files/${fileId}`
    );
  }

  async listTenantWorkspaces(
    tenantId: string
  ): Promise<{ workspaces: AdminWorkspace[] }> {
    return this.request<{ workspaces: AdminWorkspace[] }>(
      'GET',
      `/api/v1/admin/tenants/${tenantId}/workspaces`
    );
  }

  async createTenantWorkspace(
    tenantId: string,
    input: CreateWorkspaceInput
  ): Promise<AdminWorkspace> {
    return this.request<AdminWorkspace>(
      'POST',
      `/api/v1/admin/tenants/${tenantId}/workspaces`,
      input
    );
  }

  async getTenantQuota(tenantId: string): Promise<QuotaInfo> {
    return this.request<QuotaInfo>(
      'GET',
      `/api/v1/admin/tenants/${tenantId}/quota`
    );
  }

  /**
   * Request an upload handshake for a tenant using the admin credential.
   *
   * The dashboard uses this so it can upload files into a tenant's bucket
   * without ever holding a tenant API key. The returned handshake carries the
   * presigned URL the caller then PUTs the file bytes to.
   */
  async requestTenantUpload(
    tenantId: string,
    input: RequestTenantUploadInput
  ): Promise<AdminUploadHandshake> {
    return this.request<AdminUploadHandshake>(
      'POST',
      `/api/v1/admin/tenants/${tenantId}/upload/request`,
      input
    );
  }

  /**
   * Bulk-move a tenant's files into a target workspace, selected by tag or by
   * explicit file IDs. Backfills historically workspace-less files into the
   * right workspace (e.g. by their `env` provenance tag).
   */
  async migrateFilesToWorkspace(
    tenantId: string,
    input: MigrateFilesToWorkspaceInput
  ): Promise<MigrateFilesToWorkspaceResult> {
    return this.request<MigrateFilesToWorkspaceResult>(
      'POST',
      `/api/v1/admin/tenants/${tenantId}/files/migrate-workspace`,
      input
    );
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.adminApiKey}`,
        };

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as ApiErrorBody;
          throw parseApiError(response.status, errorBody);
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof StorageBrainError && error.statusCode && error.statusCode < 500) {
          throw error;
        }

        if (attempt < this.maxRetries - 1) {
          const delay = Math.min(
            RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
            RETRY_CONFIG.maxDelayMs
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new NetworkError(`Request failed after ${this.maxRetries} attempts`, lastError);
  }
}

export default StorageBrainAdmin;
