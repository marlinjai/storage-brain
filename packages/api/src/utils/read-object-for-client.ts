import type { ByteRange, GetResult, StorageAdapter } from '@storage-brain/shared';

/**
 * nginx's "client closed request". Nobody receives it (the client is gone);
 * it exists so the request log says what happened instead of a fake 200/500.
 */
export const CLIENT_CLOSED_REQUEST = 499;

function clientClosedResponse(): Response {
  return new Response(null, { status: CLIENT_CLOSED_REQUEST });
}

/**
 * Read an object on behalf of an HTTP client, bound to that client's request
 * signal. Returns the object, null when it does not exist, or a ready-made
 * Response when the client left before there was anything to send.
 *
 * The departed-client branch is the leak this exists to close (incident
 * 2026-09-26): the HTTP layer only cancels a response body once it has started
 * writing it, so a body obtained after the client disconnected was never read
 * and never released, and its backend socket stayed checked out for good.
 */
export async function readObjectForClient(
  storage: StorageAdapter,
  key: string,
  range: ByteRange | undefined,
  signal: AbortSignal
): Promise<GetResult | null | Response> {
  let object: GetResult | null;
  try {
    object = await storage.get(key, range, { signal });
  } catch (err) {
    // The read was abandoned because the client left: not a server error.
    if (signal.aborted) return clientClosedResponse();
    throw err;
  }
  if (object && signal.aborted) {
    // Adapters that honour the signal have already released the body; this
    // covers the ones that do not, and is a no-op otherwise.
    await object.body.cancel().catch(() => {});
    return clientClosedResponse();
  }
  return object;
}
