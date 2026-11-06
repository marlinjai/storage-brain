import { describe, it, expect, beforeEach } from 'vitest';
import type { CreateFileInput, DatabaseAdapter } from '@storage-brain/shared';
import { seedFile } from './d1-sqlite';

/**
 * The purge-tracking and alert contract of DatabaseAdapter, run against every
 * adapter (D1 over node:sqlite, and a real Postgres). It pins the two
 * invariants this change exists for:
 *
 *  - a soft-deleted file records whether its storage object is really gone
 *    (`purged_at` set only when the delete confirmed it), so the sweeper can
 *    retry exactly the rows that still hold an object;
 *  - an alert is exactly-once per (kind, fileId), so repeated failures never
 *    pile up rows.
 *
 * The sweeper's reads (`listUnpurgedFiles`, `listOpenAlerts`) are global by
 * design, and the Postgres run shares one database across tests, so assertions
 * are membership-based (does MY file/alert appear, in the expected state)
 * rather than whole-list equality.
 */
export function describePurgeContract(adapterName: string, getDb: () => DatabaseAdapter): void {
  describe(`${adapterName}: purge tracking and alerts`, () => {
    let db: DatabaseAdapter;
    let tenantId: string;

    beforeEach(async () => {
      db = getDb();
      tenantId = `t-${crypto.randomUUID()}`;
      await db.createTenant({
        id: tenantId,
        name: `Purge ${tenantId}`,
        apiKeyHash: `hash-${tenantId}`,
        keyPrefix: 'sk_live_pg',
        quotaBytes: 10_000,
        allowedFileTypes: null,
      });
    });

    function fileInput(size = 100): CreateFileInput {
      const id = crypto.randomUUID();
      return {
        id,
        tenantId,
        originalName: `${id}.bin`,
        storedPath: `tenants/${tenantId}/files/${id}/${id}.bin`,
        fileType: 'application/octet-stream',
        sizeBytes: size,
        context: 'default',
        tags: null,
      };
    }

    async function pendingIds(limit = 1000): Promise<string[]> {
      return (await db.listUnpurgedFiles(limit)).map((p) => p.id);
    }

    it('records purged_at when the delete confirms the object is gone', async () => {
      const file = fileInput();
      await seedFile(db, file);
      await db.deleteFileAndReleaseQuota(file.id, tenantId, Date.now());
      expect(await pendingIds()).not.toContain(file.id);
    });

    it('leaves purged_at unset when the delete did not confirm the object', async () => {
      const file = fileInput();
      await seedFile(db, file);
      await db.deleteFileAndReleaseQuota(file.id, tenantId);
      const pending = await db.listUnpurgedFiles(1000);
      const mine = pending.find((p) => p.id === file.id);
      expect(mine).toBeDefined();
      expect(mine).toMatchObject({ id: file.id, tenantId, storedPath: file.storedPath });
    });

    it('lists only deleted, unpurged files, oldest delete first, bounded by limit', async () => {
      const f1 = fileInput();
      const f2 = fileInput();
      const f3 = fileInput();
      await seedFile(db, f1);
      await seedFile(db, f2);
      await seedFile(db, f3);

      await db.deleteFileAndReleaseQuota(f1.id, tenantId);
      // Let the clock advance so the delete order is observable (deleted_at
      // has millisecond resolution and the two deletes could otherwise tie).
      await new Promise((resolve) => setTimeout(resolve, 3));
      await db.deleteFileAndReleaseQuota(f3.id, tenantId);

      // The two deleted, unpurged files of THIS tenant appear, oldest delete
      // first; the still-live file does not.
      const mine = (await db.listUnpurgedFiles(1000)).filter((p) => p.tenantId === tenantId);
      expect(mine.map((p) => p.id)).toEqual([f1.id, f3.id]);

      // A bounded call never exceeds its limit.
      const bounded = await db.listUnpurgedFiles(2);
      expect(bounded.length).toBeLessThanOrEqual(2);
    });

    it('setFilePurgedAt only marks soft-deleted rows; a live row stays live', async () => {
      const live = fileInput();
      const dead = fileInput();
      await seedFile(db, live);
      await seedFile(db, dead);
      await db.deleteFileAndReleaseQuota(dead.id, tenantId);

      await db.setFilePurgedAt(dead.id, Date.now());
      await db.setFilePurgedAt(live.id, Date.now()); // must be a no-op

      expect(await pendingIds()).not.toContain(dead.id);
      expect(await db.getFileById(live.id, tenantId)).not.toBeNull();
    });

    it('getAllStoredPaths includes live and soft-deleted rows', async () => {
      const file = fileInput();
      await seedFile(db, file);
      await db.deleteFileAndReleaseQuota(file.id, tenantId);
      const paths = await db.getAllStoredPaths();
      expect(paths).toContain(file.storedPath);
    });

    it('raiseAlert is exactly-once per (kind, fileId), bumping the existing row', async () => {
      const file = fileInput();
      await seedFile(db, file);
      await db.raiseAlert({
        kind: 'purge_failed',
        tenantId,
        fileId: file.id,
        storedPath: file.storedPath,
        payload: { message: 'first' },
      });
      // Let the clock advance so the bump is observable.
      await new Promise((resolve) => setTimeout(resolve, 2));
      await db.raiseAlert({
        kind: 'purge_failed',
        tenantId,
        fileId: file.id,
        storedPath: file.storedPath,
        payload: { message: 'second' },
      });

      const mine = (await db.listOpenAlerts()).filter((a) => a.fileId === file.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.kind).toBe('purge_failed');
      expect(mine[0]!.tenantId).toBe(tenantId);
      expect(mine[0]!.storedPath).toBe(file.storedPath);
      expect(mine[0]!.payload?.message).toBe('second');
    });

    it('acknowledgeAlert closes the alert; listOpenAlerts then omits it', async () => {
      const file = fileInput();
      await seedFile(db, file);
      await db.raiseAlert({
        kind: 'purge_failed',
        tenantId,
        fileId: file.id,
        storedPath: file.storedPath,
      });
      const mine = (await db.listOpenAlerts()).filter((a) => a.fileId === file.id);
      expect(mine).toHaveLength(1);

      expect(await db.acknowledgeAlert(mine[0]!.id)).toBe(true);
      // A second acknowledge changes nothing.
      expect(await db.acknowledgeAlert(mine[0]!.id)).toBe(false);
      const after = (await db.listOpenAlerts()).filter((a) => a.fileId === file.id);
      expect(after).toEqual([]);
    });
  });
}
