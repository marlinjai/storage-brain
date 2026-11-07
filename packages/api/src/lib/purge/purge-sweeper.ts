import type { DatabaseAdapter, StorageAdapter } from '@storage-brain/shared';

/**
 * The purge sweeper and the orphan sweep.
 *
 * The sweeper makes the "delete never fails silently" invariant hold over time:
 * any soft-deleted file whose storage object is still present (`deleted_at`
 * set, `purged_at` NULL, i.e. an earlier delete call failed) is retried in
 * bounded batches, and its `purged_at` is set once the R2/S3 delete succeeds.
 * A repeated failure for the same object raises exactly one operator alert (the
 * alert row's unique (kind, file_id) key makes the raise idempotent).
 *
 * The orphan sweep handles storage keys that have no file row at all (left by a
 * crash mid-upload, or any other path that wrote the object but never its row).
 * Keys younger than ORPHAN_MIN_AGE_MS are never touched (an upload may be
 * mid-flight). Deletion is age-gated and row-gated; Marlin approved enabling it
 * on 2026-11-07 after seeing the report's production numbers.
 */

/** How many files one sweeper cycle attempts (bounded batch). */
export const PURGE_BATCH_SIZE = 100;

/** Objects younger than this are never listed as orphans (an upload may be mid-flight). */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** How many orphaned objects one deletion pass attempts (bounded batch). */
export const ORPHAN_DELETE_BATCH_SIZE = 100;

export interface PurgeOutcome {
  /** Files selected for this cycle (`deleted_at` set, `purged_at` NULL). */
  scanned: number;
  /** Files whose object delete succeeded this cycle (purged_at now set). */
  purged: number;
  /** Files whose object delete failed this cycle (left unpurged, alert raised). */
  failed: number;
}

export interface PurgeSweeperDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  /** Test seam for clock-dependent assertions. Defaults to Date.now. */
  now?: () => number;
  /** Cycle batch size. Defaults to PURGE_BATCH_SIZE. */
  limit?: number;
}

/**
 * One purge cycle. Idempotent by construction: selection is by database state,
 * the storage delete is idempotent for an already-gone key (R2 and S3 answer
 * without an error), and a crash after deleting the object but before marking
 * `purged_at` just re-runs the whole thing on the next cycle.
 */
export async function runPurgeSweep(deps: PurgeSweeperDeps): Promise<PurgeOutcome> {
  const { db, storage } = deps;
  const now = deps.now ?? (() => Date.now());
  const pending = await db.listUnpurgedFiles(deps.limit ?? PURGE_BATCH_SIZE);

  let purged = 0;
  let failed = 0;
  for (const file of pending) {
    try {
      await storage.delete(file.storedPath);
      await db.setFilePurgedAt(file.id, now());
      purged += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `Purge sweep failed for file ${file.id} (tenant ${file.tenantId}, path ${file.storedPath}); it stays unpurged and will be retried:`,
        err
      );
      // Exactly one alert per object: raiseAlert upserts on (kind, file_id).
      await db
        .raiseAlert({
          kind: 'purge_failed',
          tenantId: file.tenantId,
          fileId: file.id,
          storedPath: file.storedPath,
          payload: { message: err instanceof Error ? err.message : String(err) },
        })
        .catch((alertErr) => {
          console.error(`Failed to record purge alert for file ${file.id}:`, alertErr);
        });
    }
  }

  return { scanned: pending.length, purged, failed };
}

export interface OrphanReport {
  /** Storage keys older than `olderThanMs` that have no file row. */
  orphanCount: number;
  /** Total bytes of those orphaned objects. */
  orphanBytes: number;
  /** The age cutoff used (keys younger than this are ignored). */
  olderThanMs: number;
}

export interface OrphanReportDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  /** Test seam. Defaults to Date.now. */
  now?: () => number;
  /** Age cutoff. Defaults to ORPHAN_MIN_AGE_MS. */
  minAgeMs?: number;
}

/**
 * Report-only list of storage keys older than `minAgeMs` that have no file row
 * at all. A key with any row (live, soft-deleted or failed) is not an orphan.
 * Never deletes anything.
 */
export async function runOrphanReport(deps: OrphanReportDeps): Promise<OrphanReport> {
  const { db, storage } = deps;
  const now = deps.now ?? (() => Date.now());
  const olderThanMs = deps.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const cutoff = now() - olderThanMs;

  const [objects, storedPaths] = await Promise.all([storage.listObjects(), db.getAllStoredPaths()]);
  const known = new Set(storedPaths);

  let orphanCount = 0;
  let orphanBytes = 0;
  for (const object of objects) {
    if (object.lastModified.getTime() > cutoff) continue;
    if (known.has(object.key)) continue;
    orphanCount += 1;
    orphanBytes += object.size;
  }

  if (orphanCount > 0) {
    console.warn(
      `[orphans] ${orphanCount} object(s) (${orphanBytes} bytes) older than ${olderThanMs} ms have no file row`
    );
  }
  return { orphanCount, orphanBytes, olderThanMs };
}

export interface OrphanDeletionOutcome {
  /** Orphaned objects selected (older than `minAgeMs`, no file row). */
  scanned: number;
  /** Objects whose delete succeeded this pass. */
  deleted: number;
  /** Objects whose delete failed this pass (logged; retried next cycle). */
  failed: number;
}

export interface OrphanDeletionDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  /** Test seam. Defaults to Date.now. */
  now?: () => number;
  /** Age cutoff. Defaults to ORPHAN_MIN_AGE_MS. */
  minAgeMs?: number;
  /** Per-pass batch size. Defaults to ORPHAN_DELETE_BATCH_SIZE. */
  batchSize?: number;
}

/**
 * Delete storage keys older than `minAgeMs` that have no file row at all
 * (left by a crash mid-upload, or any path that wrote the object but never its
 * row). Age-gated so an upload still in flight is never touched; row-gated so
 * a key with any row (live, soft-deleted or failed) is never deleted.
 *
 * Idempotent: deletion is by key, so a crash mid-pass re-lists and re-selects
 * only what is still there. A failed delete is logged and retried on the next
 * cycle, never swallowed.
 */
export async function runOrphanDeletion(deps: OrphanDeletionDeps): Promise<OrphanDeletionOutcome> {
  const { db, storage } = deps;
  const now = deps.now ?? (() => Date.now());
  const olderThanMs = deps.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const cutoff = now() - olderThanMs;

  const [objects, storedPaths] = await Promise.all([storage.listObjects(), db.getAllStoredPaths()]);
  const known = new Set(storedPaths);
  const orphans = objects.filter(
    (object) => object.lastModified.getTime() <= cutoff && !known.has(object.key)
  );

  let deleted = 0;
  let failed = 0;
  const batchSize = deps.batchSize ?? ORPHAN_DELETE_BATCH_SIZE;
  for (let i = 0; i < orphans.length; i += batchSize) {
    const chunk = orphans.slice(i, i + batchSize);
    for (const orphan of chunk) {
      try {
        await storage.delete(orphan.key);
        deleted += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `Orphan delete failed for ${orphan.key} (${orphan.size} bytes); it will be retried on the next cycle:`,
          err
        );
      }
    }
  }

  if (orphans.length > 0) {
    const bytes = orphans.reduce((sum, o) => sum + o.size, 0);
    console.warn(
      `[orphans] deleted ${deleted} of ${orphans.length} orphaned object(s) (${bytes} bytes) older than ${olderThanMs} ms with no file row`
    );
  }
  return { scanned: orphans.length, deleted, failed };
}
