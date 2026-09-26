/**
 * Thrown when a request body is, or announces that it will be, larger than the
 * byte limit it is read under. `declaredBytes` is the Content-Length when the
 * rejection came from the header alone, `null` when it came from counting.
 */
export class BodyTooLargeError extends Error {
  constructor(
    readonly limitBytes: number,
    readonly declaredBytes: number | null
  ) {
    super(
      declaredBytes === null
        ? `request body exceeds the ${limitBytes} byte limit`
        : `request body of ${declaredBytes} bytes exceeds the ${limitBytes} byte limit`
    );
    this.name = 'BodyTooLargeError';
  }
}

/**
 * The Content-Length of a request, or `null` when it is absent or not a plain
 * non-negative integer (a malformed header is treated as absent; the byte
 * count below still enforces the limit).
 */
export function declaredContentLength(request: Request): number | null {
  const header = request.headers.get('content-length');
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  const value = Number(header.trim());
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Read a request body into memory without ever holding more than `limitBytes`
 * of it.
 *
 * - A Content-Length above the limit is rejected before a single byte is read.
 * - Otherwise the body is streamed and counted, and the first chunk that takes
 *   the total past the limit cancels the stream (releasing the socket's data)
 *   and throws, so a body without a Content-Length, or with one the runtime
 *   does not enforce, is cut off at the limit instead of being buffered whole.
 *
 * Returns an ArrayBuffer whose byteLength is exactly the number of bytes read.
 */
export async function readBodyWithLimit(
  request: Request,
  limitBytes: number
): Promise<ArrayBuffer> {
  const declared = declaredContentLength(request);
  if (declared !== null && declared > limitBytes) {
    // Tell the runtime we will not read it, so it can drop the rest.
    await request.body?.cancel().catch(() => {});
    throw new BodyTooLargeError(limitBytes, declared);
  }

  if (!request.body) return new ArrayBuffer(0);

  const reader = (request.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLargeError(limitBytes, null);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
