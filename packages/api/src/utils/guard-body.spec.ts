import { describe, it, expect, vi, afterEach } from 'vitest';
import { guardBody, BodyIdleTimeoutError } from './guard-body';

// A source that records whether it was cancelled, the stand-in for an S3
// GetObject body whose cancel() is what hands the socket back to the pool.
function trackedSource(chunks: Uint8Array[] = [], opts: { endAfterChunks?: boolean } = {}) {
  const state = { cancelled: false, reason: undefined as unknown };
  let i = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(chunks[i++]);
        } else if (opts.endAfterChunks) {
          controller.close();
        }
        // Otherwise: never answer, like a backend that went silent.
      },
      cancel(reason) {
        state.cancelled = true;
        state.reason = reason;
      },
    },
    { highWaterMark: 0 }
  );
  return { stream, state };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('guardBody', () => {
  it('passes every byte through and ends normally', async () => {
    const { stream, state } = trackedSource([new Uint8Array([1, 2]), new Uint8Array([3])], {
      endAfterChunks: true,
    });

    const out = await new Response(guardBody(stream, { idleTimeoutMs: 1_000 })).arrayBuffer();

    expect(new Uint8Array(out)).toEqual(new Uint8Array([1, 2, 3]));
    expect(state.cancelled).toBe(false);
  });

  it('cancels the source when its consumer cancels', async () => {
    const { stream, state } = trackedSource([new Uint8Array([1])]);

    await guardBody(stream, { idleTimeoutMs: 1_000 }).cancel('gone');

    expect(state.cancelled).toBe(true);
  });

  it('cancels the source on abort even while another reader holds the stream', async () => {
    const { stream, state } = trackedSource([new Uint8Array([1])]);
    const controller = new AbortController();
    const guarded = guardBody(stream, { signal: controller.signal, idleTimeoutMs: 1_000 });
    const reader = guarded.getReader();
    await reader.read();

    controller.abort();
    await flush();

    expect(state.cancelled).toBe(true);
    // Ends quietly: the consumer is a client that no longer exists, and an
    // error here would only be logged as a server fault.
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it('releases the source at once when the signal was already aborted', async () => {
    const { stream, state } = trackedSource();
    const controller = new AbortController();
    controller.abort();

    guardBody(stream, { signal: controller.signal, idleTimeoutMs: 1_000 });
    await flush();

    expect(state.cancelled).toBe(true);
  });

  it('gives up a body whose backend went silent', async () => {
    vi.useFakeTimers();
    const { stream, state } = trackedSource([new Uint8Array([1])]);
    const reader = guardBody(stream, { idleTimeoutMs: 1_000 }).getReader();
    await reader.read();

    // Attach the expectation before time moves, so the rejection is handled.
    const pending = expect(reader.read()).rejects.toBeInstanceOf(BodyIdleTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);

    await pending;
    expect(state.cancelled).toBe(true);
  });

  it('gives up a body whose consumer stopped reading', async () => {
    vi.useFakeTimers();
    const { stream, state } = trackedSource(Array.from({ length: 10 }, () => new Uint8Array([1])));
    const reader = guardBody(stream, { idleTimeoutMs: 1_000 }).getReader();
    await reader.read();

    // Nobody reads for longer than the idle window.
    await vi.advanceTimersByTimeAsync(1_000);

    expect(state.cancelled).toBe(true);
  });

  it('does not time out a body that keeps making progress', async () => {
    vi.useFakeTimers();
    const { stream, state } = trackedSource(Array.from({ length: 5 }, () => new Uint8Array([1])));
    const reader = guardBody(stream, { idleTimeoutMs: 1_000 }).getReader();

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(900);
      await reader.read();
    }

    expect(state.cancelled).toBe(false);
  });

  it('stops watching once the body has been read to the end', async () => {
    vi.useFakeTimers();
    const { stream, state } = trackedSource([new Uint8Array([1])], { endAfterChunks: true });
    const controller = new AbortController();
    const reader = guardBody(stream, {
      signal: controller.signal,
      idleTimeoutMs: 1_000,
    }).getReader();
    await reader.read();
    await reader.read();

    await vi.advanceTimersByTimeAsync(5_000);
    controller.abort();

    expect(state.cancelled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
