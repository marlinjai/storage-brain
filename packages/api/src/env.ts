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
   * HMAC-SHA256 secret for the R2 upload-complete webhook (S3, finding 3).
   * The R2 event-notification queue consumer (an internal Worker we control)
   * signs the raw JSON body with this secret and sends the hex digest in the
   * `X-Webhook-Signature` header; the route rejects any request whose signature
   * does not verify. OPTIONAL at the type level so unrelated tests boot without
   * it, but the route fails closed with a 500 when it is unset (never processes
   * an unsigned webhook). Must be at least MIN_WEBHOOK_SECRET_LENGTH chars.
   */
  R2_WEBHOOK_SIGNING_SECRET?: string;

  /**
   * Fully-qualified public base URL (e.g. https://api.storage-brain.lumitra.co).
   * Used to construct shareable permanent file URLs so they don't leak internal
   * Docker hostnames (e.g. http://api/...). If unset, falls back to deriving
   * the base URL from the inbound request (works in dev but not behind a
   * reverse proxy that strips Host).
   */
  PUBLIC_BASE_URL?: string;

  /**
   * auth-brain machine-auth (slice 2B). OPTIONAL: when unset the Worker boots
   * and only the legacy tenant api_key_hash path works (the auth-brain branch
   * is skipped). Set it to also accept auth-brain service-account keys for
   * machine callers. The OpenFGA authorization check is folded into
   * auth-brain's verify endpoint, so the Worker needs no OpenFGA access.
   */
  AUTH_BRAIN_URL?: string;

  /**
   * HMAC signing secret for the auth-brain GDPR erasure webhook consumer
   * (POST /api/v1/internal/erasure). Shared with auth-brain's registry entry
   * for the `storage` app. FAIL-CLOSED: when unset the endpoint answers 500 and
   * processes nothing, so a misconfiguration can never accept an unsigned or
   * unverifiable erasure. Never logged.
   */
  STORAGE_ERASURE_WEBHOOK_SECRET?: string;
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
