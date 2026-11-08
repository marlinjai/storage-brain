import type { MiddlewareHandler } from 'hono';

/**
 * Keeps response bodies from outliving their request. Must be the OUTERMOST
 * middleware.
 *
 * 1. It touches the request's abort signal before anything else runs.
 *    @hono/node-server creates that signal lazily. Version 1 only aborted it
 *    on a client disconnect if it already existed at that moment, so a route
 *    that read the signal after an `await` never learned that its client left.
 *    Version 2 remembers the disconnect and aborts a signal created later;
 *    touching it first keeps the behaviour independent of the adapter version
 *    (download-socket-release.spec.ts runs both cases on a real server).
 *
 * 2. On HEAD it cancels whatever body the route produced. Hono answers HEAD by
 *    running the GET handler and dropping its body WITHOUT cancelling it. For a
 *    storage stream that leaks the backend socket behind it, permanently
 *    (incident 2026-09-26). Routes should still skip the object read on HEAD;
 *    this makes forgetting to do so harmless.
 */
export const requestLifecycle: MiddlewareHandler = async (c, next) => {
  void c.req.raw.signal;
  await next();
  if (c.req.method === 'HEAD') {
    const body = c.res.body;
    if (body) await body.cancel().catch(() => {});
  }
};
