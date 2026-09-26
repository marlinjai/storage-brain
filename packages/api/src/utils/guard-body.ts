export interface GuardBodyOptions {
  /** Abort releases the source at once, whoever holds the returned stream. */
  signal?: AbortSignal;
  /**
   * How long the body may make no progress at all before it is given up.
   * Progress means a chunk passed through, so this catches both directions of
   * a stall: a backend that stopped sending, and a consumer that stopped
   * reading (a paused `<video>`, a client that never drains its socket). On
   * expiry the source is released and the returned stream errors, which ends
   * the HTTP response instead of letting it hold a backend socket forever.
   */
  idleTimeoutMs: number;
}

export class BodyIdleTimeoutError extends Error {
  constructor(idleTimeoutMs: number) {
    super(`storage body made no progress for ${idleTimeoutMs} ms and was released`);
    this.name = 'BodyIdleTimeoutError';
  }
}

/**
 * Wrap a storage response body so the backend connection behind it is always
 * released: when the stream is read to the end, when its consumer cancels it,
 * when `signal` aborts, or when it stalls for `idleTimeoutMs`.
 *
 * Why this exists (incident 2026-09-26): an S3 GetObject body holds a pooled
 * socket until it is fully read or destroyed, and nothing else ever frees it.
 * The HTTP layer only cancels a response body it has started writing, so a
 * body obtained for a client that has already left, or one Hono discards when
 * it answers HEAD, stayed checked out for the life of the process. Holding our
 * own reader is what makes release possible no matter who has locked the
 * returned stream.
 */
export function guardBody(
  source: ReadableStream<Uint8Array>,
  { signal, idleTimeoutMs }: GuardBodyOptions
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let released = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

  const release = (reason: unknown): void => {
    if (released) return;
    released = true;
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    signal?.removeEventListener('abort', onAbort);
    reader.cancel(reason).catch(() => {});
  };

  const fail = (reason: unknown): void => {
    release(reason);
    try {
      controllerRef?.error(reason);
    } catch {
      // The consumer already cancelled or finished; nothing left to signal.
    }
  };

  const armIdleTimer = (): void => {
    if (released) return;
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => fail(new BodyIdleTimeoutError(idleTimeoutMs)), idleTimeoutMs);
  };

  // The request was aborted, so the consumer is a client that no longer
  // exists: release the source and end quietly. Erroring here would only make
  // the HTTP layer log every ordinary client disconnect as a server error.
  function onAbort(): void {
    release(signal?.reason ?? new Error('request aborted'));
    try {
      controllerRef?.close();
    } catch {
      // Already closed, errored or cancelled.
    }
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      armIdleTimer();
    },
    async pull(controller) {
      if (released) return;
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        fail(err);
        return;
      }
      if (released) return;
      if (chunk.done) {
        // Read to the end: the backend has already handed its socket back.
        released = true;
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        signal?.removeEventListener('abort', onAbort);
        controller.close();
        return;
      }
      controller.enqueue(chunk.value);
      armIdleTimer();
    },
    cancel(reason) {
      release(reason);
    },
  });
}
