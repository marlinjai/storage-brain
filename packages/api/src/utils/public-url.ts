/**
 * Resolve the public base URL for shareable file URLs.
 *
 * Prefers the configured `PUBLIC_BASE_URL` env var so we never leak internal
 * hostnames (e.g. http://api in Docker). Falls back to deriving from the
 * inbound request, respecting `x-forwarded-proto` for reverse-proxied TLS.
 */
export function resolvePublicBaseUrl(c: {
  req: { url: string; header: (name: string) => string | undefined };
  env: { PUBLIC_BASE_URL?: string };
}): string {
  if (c.env.PUBLIC_BASE_URL) {
    return c.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${url.host}`;
}
