import type { Env } from './env';
import { R2StorageAdapter } from './adapters/storage/r2';
import { D1DatabaseAdapter } from './adapters/database/d1';
import { createApp } from './app';

// Re-export for consumers
export { createApp } from './app';
export type { AppConfig } from './app';

// Export for Cloudflare Workers
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const app = createApp({
      storage: new R2StorageAdapter(env.BUCKET),
      db: new D1DatabaseAdapter(env.DB),
    });
    return app.fetch(request, env, ctx);
  },
};
