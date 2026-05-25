import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { TenantContext, StorageAdapter, DatabaseAdapter } from '@storage-brain/shared';

/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Bucket
  BUCKET: R2Bucket;

  // Environment variables
  ENVIRONMENT: 'development' | 'staging' | 'production';

  // Secrets (set via wrangler secret put)
  ADMIN_API_KEY?: string;
  URL_SIGNING_SECRET: string;

  /**
   * Fully-qualified public base URL (e.g. https://api.storage-brain.lumitra.co).
   * Used to construct shareable permanent file URLs so they don't leak internal
   * Docker hostnames (e.g. http://api/...). If unset, falls back to deriving
   * the base URL from the inbound request (works in dev but not behind a
   * reverse proxy that strips Host).
   */
  PUBLIC_BASE_URL?: string;
}

/**
 * Hono context variables
 */
export interface Variables extends TenantContext {
  requestId: string;
  storage: StorageAdapter;
  db: DatabaseAdapter;
}

/**
 * Hono app type with environment and variables
 */
export type AppEnv = {
  Bindings: Env;
  Variables: Variables;
};
