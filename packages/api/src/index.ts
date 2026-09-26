import type { Env } from './env';
import { R2StorageAdapter } from './adapters/storage/r2';
import { D1DatabaseAdapter } from './adapters/database/d1';
import { createApp } from './app';
import { expireStaleUploads } from './lib/upload/expire-stale-uploads';

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

  // Cron trigger (wrangler.toml [triggers]): release the quota held by upload
  // sessions that will never complete.
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      expireStaleUploads(new D1DatabaseAdapter(env.DB)).then(({ truncated }) => {
        if (truncated) {
          console.warn('Stale upload sweep hit its time budget; the next run continues.');
        }
      })
    );
  },
};
