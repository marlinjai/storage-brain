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

  /**
   * auth-brain machine-auth (slice 2B). ALL OPTIONAL: when AUTH_BRAIN_URL is
   * unset the Worker boots and only the legacy tenant api_key_hash path works
   * (the auth-brain branch is skipped). Set these to also accept auth-brain
   * service-account keys for machine callers.
   */
  AUTH_BRAIN_URL?: string;
  OPENFGA_API_URL?: string;
  OPENFGA_STORE_ID?: string;
  // Optional OpenFGA authorization model id + pre-shared bearer token. Omit the
  // token when OpenFGA runs unauthenticated (e.g. local dev).
  OPENFGA_MODEL_ID?: string;
  OPENFGA_API_TOKEN?: string;
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
