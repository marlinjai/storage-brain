import { describe, it, expect, vi } from 'vitest';
import type { GetResult, StorageAdapter } from '@storage-brain/shared';
import { readObjectForClient, CLIENT_CLOSED_REQUEST } from './read-object-for-client';

function storageReturning(get: StorageAdapter['get']): StorageAdapter {
  return { get } as unknown as StorageAdapter;
}

function object(onCancel: () => void): GetResult {
  return {
    body: new ReadableStream({ cancel: onCancel }),
    contentType: 'video/mp4',
    size: 10,
  };
}

describe('readObjectForClient', () => {
  it('passes the request signal to the adapter and returns the object', async () => {
    const result = object(() => {});
    const get = vi.fn().mockResolvedValue(result);
    const signal = new AbortController().signal;

    const out = await readObjectForClient(storageReturning(get), 'k', { start: 0 }, signal);

    expect(out).toBe(result);
    expect(get).toHaveBeenCalledWith('k', { start: 0 }, { signal });
  });

  it('returns null for a missing object', async () => {
    const out = await readObjectForClient(
      storageReturning(vi.fn().mockResolvedValue(null)),
      'k',
      undefined,
      new AbortController().signal
    );

    expect(out).toBeNull();
  });

  it('answers 499 instead of a server error when the read was abandoned for a departed client', async () => {
    const controller = new AbortController();
    const get = vi.fn(() => {
      controller.abort();
      return Promise.reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
    });

    const out = await readObjectForClient(storageReturning(get), 'k', undefined, controller.signal);

    expect(out).toBeInstanceOf(Response);
    expect((out as Response).status).toBe(CLIENT_CLOSED_REQUEST);
  });

  it('cancels a body obtained after the client left', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const get = vi.fn(() => {
      controller.abort();
      return Promise.resolve(
        object(() => {
          cancelled = true;
        })
      );
    });

    const out = await readObjectForClient(storageReturning(get), 'k', undefined, controller.signal);

    expect((out as Response).status).toBe(CLIENT_CLOSED_REQUEST);
    expect(cancelled).toBe(true);
  });

  it('still throws a real storage error while the client is connected', async () => {
    const get = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(
      readObjectForClient(storageReturning(get), 'k', undefined, new AbortController().signal)
    ).rejects.toThrow('boom');
  });
});
