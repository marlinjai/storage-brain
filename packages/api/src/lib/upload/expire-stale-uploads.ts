import type { DatabaseAdapter } from '@storage-brain/shared';
import { UPLOAD_IN_FLIGHT_GRACE_MS } from '@storage-brain/shared';

/** How often the long-running entry points sweep for stale upload sessions. */
export const EXPIRE_STALE_UPLOADS_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Release the quota held by upload sessions that will never complete: a URL
 * that lapsed unused, or a transfer whose process died mid-upload. Each one is
 * settled as expired, which returns its reservation to the tenant and the
 * workspace. Safe to run concurrently and repeatedly: settling is exactly-once.
 */
export async function expireStaleUploads(db: DatabaseAdapter, now = Date.now()): Promise<number> {
  return db.expireStaleUploadSessions(now, UPLOAD_IN_FLIGHT_GRACE_MS);
}
