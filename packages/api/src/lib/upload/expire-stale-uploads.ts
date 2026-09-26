import type { DatabaseAdapter } from '@storage-brain/shared';
import { UPLOAD_IN_FLIGHT_GRACE_MS } from '@storage-brain/shared';

/** How often the long-running entry points sweep for stale upload sessions. */
export const EXPIRE_STALE_UPLOADS_INTERVAL_MS = 5 * 60 * 1000;

/** Sessions settled per adapter call; small enough that one batch never runs long. */
export const EXPIRE_STALE_UPLOADS_BATCH_SIZE = 100;

/**
 * Wall-clock budget for one sweep. A Workers cron invocation gets 30 seconds of
 * CPU by default, so the sweep stops starting new batches well before that and
 * leaves any remaining backlog to the next run, five minutes later.
 */
export const EXPIRE_STALE_UPLOADS_BUDGET_MS = 20 * 1000;

export interface ExpireStaleUploadsOptions {
  /** The instant sessions are judged stale against. Defaults to the current time. */
  now?: number;
  batchSize?: number;
  budgetMs?: number;
  /** Clock for the budget, injectable for tests. */
  clock?: () => number;
}

export interface ExpireStaleUploadsResult {
  /** Sessions this sweep settled as expired. */
  expired: number;
  /** Adapter batches the sweep ran. */
  batches: number;
  /** True when the budget ran out while full batches were still coming back. */
  truncated: boolean;
}

/**
 * Release the quota held by upload sessions that will never complete: a URL
 * that lapsed unused, or a transfer whose process died mid-upload. Each one is
 * settled as expired, which returns its reservation to the tenant and the
 * workspace. Drains the backlog in bounded batches until a batch comes back
 * short or the time budget is spent, so a burst of abandoned uploads cannot
 * outgrow the sweep. Safe to run concurrently and repeatedly: settling is
 * exactly-once.
 */
export async function expireStaleUploads(
  db: DatabaseAdapter,
  options: ExpireStaleUploadsOptions = {}
): Promise<ExpireStaleUploadsResult> {
  const clock = options.clock ?? Date.now;
  const now = options.now ?? clock();
  const batchSize = options.batchSize ?? EXPIRE_STALE_UPLOADS_BATCH_SIZE;
  const budgetMs = options.budgetMs ?? EXPIRE_STALE_UPLOADS_BUDGET_MS;
  const startedAt = clock();

  let expired = 0;
  let batches = 0;
  for (;;) {
    const result = await db.expireStaleUploadSessions(now, UPLOAD_IN_FLIGHT_GRACE_MS, batchSize);
    batches += 1;
    expired += result.expired;
    if (result.scanned < batchSize) return { expired, batches, truncated: false };
    if (clock() - startedAt >= budgetMs) return { expired, batches, truncated: true };
  }
}
