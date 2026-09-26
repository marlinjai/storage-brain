import { describe, it, expect, vi } from 'vitest';
import type { DatabaseAdapter, ExpireStaleUploadSessionsResult } from '@storage-brain/shared';
import { UPLOAD_IN_FLIGHT_GRACE_MS } from '@storage-brain/shared';
import { expireStaleUploads, EXPIRE_STALE_UPLOADS_BATCH_SIZE } from './expire-stale-uploads';

function dbReturning(...batches: ExpireStaleUploadSessionsResult[]) {
  const expireStaleUploadSessions = vi.fn();
  for (const batch of batches) expireStaleUploadSessions.mockResolvedValueOnce(batch);
  return {
    db: { expireStaleUploadSessions } as unknown as DatabaseAdapter,
    expireStaleUploadSessions,
  };
}

describe('expireStaleUploads', () => {
  it('runs one batch when the backlog fits in it', async () => {
    const { db, expireStaleUploadSessions } = dbReturning({ scanned: 3, expired: 3 });

    const result = await expireStaleUploads(db, { now: 5_000 });

    expect(result).toEqual({ expired: 3, batches: 1, truncated: false });
    expect(expireStaleUploadSessions).toHaveBeenCalledWith(
      5_000,
      UPLOAD_IN_FLIGHT_GRACE_MS,
      EXPIRE_STALE_UPLOADS_BATCH_SIZE
    );
  });

  it('keeps draining while full batches come back, judging every batch at the same instant', async () => {
    const { db, expireStaleUploadSessions } = dbReturning(
      { scanned: 2, expired: 2 },
      { scanned: 2, expired: 1 }, // one was settled elsewhere first
      { scanned: 1, expired: 1 }
    );

    const result = await expireStaleUploads(db, { now: 5_000, batchSize: 2 });

    expect(result).toEqual({ expired: 4, batches: 3, truncated: false });
    expect(expireStaleUploadSessions).toHaveBeenCalledTimes(3);
    for (const call of expireStaleUploadSessions.mock.calls) {
      expect(call).toEqual([5_000, UPLOAD_IN_FLIGHT_GRACE_MS, 2]);
    }
  });

  it('stops at the time budget and reports the sweep as truncated', async () => {
    const { db, expireStaleUploadSessions } = dbReturning(
      { scanned: 2, expired: 2 },
      { scanned: 2, expired: 2 },
      { scanned: 2, expired: 2 }
    );
    // Each clock reading advances 10 ms: the start, then one after each batch.
    let t = 0;
    const clock = () => (t += 10);

    const result = await expireStaleUploads(db, { now: 5_000, batchSize: 2, budgetMs: 15, clock });

    expect(result).toEqual({ expired: 4, batches: 2, truncated: true });
    expect(expireStaleUploadSessions).toHaveBeenCalledTimes(2);
  });

  it('stops on an empty batch', async () => {
    const { db } = dbReturning({ scanned: 0, expired: 0 });

    expect(await expireStaleUploads(db)).toEqual({ expired: 0, batches: 1, truncated: false });
  });

  it('propagates an adapter failure to the caller', async () => {
    const expireStaleUploadSessions = vi.fn().mockRejectedValue(new Error('db down'));
    const db = { expireStaleUploadSessions } as unknown as DatabaseAdapter;

    await expect(expireStaleUploads(db)).rejects.toThrow('db down');
  });
});
