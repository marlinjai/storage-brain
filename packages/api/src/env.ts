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
