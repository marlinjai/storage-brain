/**
 * Shared SWR fetcher for the dashboard's own API routes.
 *
 * Throws on any non-2xx response so SWR surfaces `error` and pages render
 * their error state. Without this check an auth failure (401) or server error
 * (500) parses as `{ error: ... }`, the typed field access yields `undefined`,
 * and pages silently render their empty state ("No tenants yet") instead of an
 * error, which is exactly the failure mode that hid the platform-scope auth
 * bug in production.
 */
export class FetchError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = `: ${body.error}`;
    } catch {
      // Non-JSON error body: status alone is enough.
    }
    throw new FetchError(`Request to ${url} failed (${res.status})${detail}`, res.status);
  }
  return res.json() as Promise<T>;
}
