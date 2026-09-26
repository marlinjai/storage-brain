import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requestLifecycle } from './request-lifecycle';

// Hono answers HEAD by running the GET handler and dropping its body without
// cancelling it. For a storage stream that leaked the backend socket behind it
// (incident 2026-09-26). The middleware makes that harmless for every route.
function appWithStreamingRoute() {
  const state = { cancelled: false };
  const app = new Hono();
  app.use('*', requestLifecycle);
  app.get('/stream', () => {
    const body = new ReadableStream({
      cancel() {
        state.cancelled = true;
      },
    });
    return new Response(body, { headers: { 'Content-Length': '10' } });
  });
  return { app, state };
}

describe('requestLifecycle', () => {
  it('cancels the body a GET handler produced when the request is HEAD', async () => {
    const { app, state } = appWithStreamingRoute();

    const res = await app.request('/stream', { method: 'HEAD' });

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(res.headers.get('Content-Length')).toBe('10');
    expect(state.cancelled).toBe(true);
  });

  it('leaves a GET body alone', async () => {
    const { app, state } = appWithStreamingRoute();

    const res = await app.request('/stream');

    expect(res.body).not.toBeNull();
    expect(state.cancelled).toBe(false);
    await res.body!.cancel();
  });
});
