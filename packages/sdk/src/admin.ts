import { RETRY_CONFIG } from './constants';
import {
  StorageBrainError,
  NetworkError,
  parseApiError,
} from './errors';
import type { AllowedMimeType } from './constants';

const DEFAULT_BASE_URL = 'https://storage-brain-api.marlin-pohl.workers.dev';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;

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
          const errorBody = await response.json().catch(() => ({}));
          throw parseApiError(
            response.status,
            errorBody as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
          );
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
