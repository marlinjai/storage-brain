import type { D1Database, R2Bucket, Queue } from '@cloudflare/workers-types';
import type { TenantContext } from '@storage-brain/shared';

/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Bucket
  BUCKET: R2Bucket;

  // Processing Queue (optional - requires Workers Paid plan)
  PROCESSING_QUEUE?: Queue;

  // Environment variables
  ENVIRONMENT: 'development' | 'staging' | 'production';

  // Secrets (set via wrangler secret put)
  ADMIN_API_KEY?: string;
  GCP_VISION_API_KEY?: string;
}

/**
 * Hono context variables
 */
export interface Variables extends TenantContext {
  requestId: string;
}

/**
 * Hono app type with environment and variables
 */
export type AppEnv = {
  Bindings: Env;
  Variables: Variables;
};
