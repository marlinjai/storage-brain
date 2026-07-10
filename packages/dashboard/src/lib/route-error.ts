import { NextResponse } from 'next/server';

/**
 * Map an API-route error to its response and log everything that is not a
 * plain auth miss. Every dashboard route funnels its catch through here so
 * failures land in the server log instead of vanishing into a generic 500
 * (which the UI used to render as an empty state).
 */
export function routeError(err: unknown, context: string): NextResponse {
  if (err instanceof Error && err.message === 'Not authenticated') {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  console.error(`[dashboard] ${context} failed:`, err);
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}
