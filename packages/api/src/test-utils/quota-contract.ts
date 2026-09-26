import { describe, it, expect, beforeEach } from 'vitest';
import type { CreateFileInput, DatabaseAdapter } from '@storage-brain/shared';
import { seedFile } from './d1-sqlite';

/**
 * The quota-accounting contract of DatabaseAdapter, run against every adapter
 * (D1 over node:sqlite, and a real Postgres). Invariant under test: a tenant's
 * and a workspace's `used_bytes` always equal the sum of `size_bytes` of their
 * live files, where an open upload counts its declared size as a reservation
 * and a settled one counts exactly the bytes stored.
 */
export function describeQuotaContract(adapterName: string, getDb: () => DatabaseAdapter): void {
  describe(`${adapterName}: upload quota accounting`, () => {
    let db: DatabaseAdapter;
    let tenantId: string;
    let workspaceId: string;
    const GRACE = 60 * 60 * 1000;
    const BATCH = 500;

    beforeEach(async () => {
      db = getDb();
      // Unique ids per test, so a shared database needs no cleanup.
      tenantId = `t-${crypto.randomUUID()}`;
      workspaceId = crypto.randomUUID();
      await db.createTenant({
        id: tenantId,
        name: `Quota ${tenantId}`,
        apiKeyHash: `hash-${tenantId}`,
        keyPrefix: 'sk_live_qa',
        quotaBytes: 1_000,
        allowedFileTypes: null,
      });
      await db.createWorkspace({
        id: workspaceId,
        tenantId,
        name: 'WS',
        slug: `ws-${workspaceId}`,
        quotaBytes: 800,
      });
    });

    function fileInput(size: number, opts: { workspace?: boolean } = {}): CreateFileInput {
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
        workspaceId: opts.workspace ? workspaceId : undefined,
      };
    }

    async function tenantUsed(): Promise<number> {
      return (await db.getQuotaUsage(tenantId)).usedBytes;
    }

    async function workspaceUsed(): Promise<number> {
      return (await db.getWorkspaceById(workspaceId, tenantId))?.usedBytes ?? -1;
    }

    it('reserves the declared size when the upload is requested', async () => {
      const file = fileInput(300, { workspace: true });
      await seedFile(db, file, { pending: true });

      expect(await tenantUsed()).toBe(300);
      expect(await workspaceUsed()).toBe(300);
      const session = await db.getUploadSessionByFileId(file.id);
      expect(session?.status).toBe('pending');
      expect(session?.tenantId).toBe(tenantId);
    });

    it('keeps accounting exact for an upload of exactly the declared size', async () => {
      const file = fileInput(300, { workspace: true });
      const sessionId = await seedFile(db, file, { pending: true });

      expect(await db.claimUploadSession(sessionId)).toBe(true);
      expect(
        await db.settleUploadSession(sessionId, { status: 'completed', actualBytes: 300 })
      ).toBe(true);

      expect(await tenantUsed()).toBe(300);
      expect(await workspaceUsed()).toBe(300);
      const stored = await db.getFileById(file.id, tenantId);
      expect(stored?.sizeBytes).toBe(300);
      expect(stored?.processingStatus).toBe('completed');
      expect((await db.getUploadSessionByFileId(file.id))?.status).toBe('completed');
    });

    it('releases the unused part of the reservation for an upload smaller than declared', async () => {
      const file = fileInput(300, { workspace: true });
      const sessionId = await seedFile(db, file, { pending: true });

      await db.settleUploadSession(sessionId, { status: 'completed', actualBytes: 120 });

      expect(await tenantUsed()).toBe(120);
      expect(await workspaceUsed()).toBe(120);
      expect((await db.getFileById(file.id, tenantId))?.sizeBytes).toBe(120);
    });

    it('releases the whole reservation for a failed or cut-off upload', async () => {
      const file = fileInput(300, { workspace: true });
      const sessionId = await seedFile(db, file, { pending: true });
      await db.claimUploadSession(sessionId);

      await db.settleUploadSession(sessionId, { status: 'failed' });

      expect(await tenantUsed()).toBe(0);
      expect(await workspaceUsed()).toBe(0);
      const stored = await db.getFileById(file.id, tenantId);
      expect(stored?.sizeBytes).toBe(0);
      expect(stored?.processingStatus).toBe('failed');
      expect((await db.getUploadSessionByFileId(file.id))?.status).toBe('failed');
    });

    it('settles exactly once: a retried or late settle changes nothing', async () => {
      const file = fileInput(300);
      const sessionId = await seedFile(db, file, { pending: true });

      expect(await db.settleUploadSession(sessionId, { status: 'failed' })).toBe(true);
      expect(await db.settleUploadSession(sessionId, { status: 'failed' })).toBe(false);
      expect(
        await db.settleUploadSession(sessionId, { status: 'completed', actualBytes: 300 })
      ).toBe(false);
      expect(await db.settleUploadSession(sessionId, { status: 'expired' })).toBe(false);

      expect(await tenantUsed()).toBe(0);
      expect((await db.getUploadSessionByFileId(file.id))?.status).toBe('failed');
    });

    it('lets exactly one transfer claim a session', async () => {
      const sessionId = await seedFile(db, fileInput(100), { pending: true });

      expect(await db.claimUploadSession(sessionId)).toBe(true);
      expect(await db.claimUploadSession(sessionId)).toBe(false);
    });

    it('releases the reservation of a session that expired unused', async () => {
      const lapsed = fileInput(300, { workspace: true });
      await seedFile(db, lapsed, { pending: true, expiresAt: Date.now() - 1_000 });
      const fresh = fileInput(200);
      await seedFile(db, fresh, { pending: true, expiresAt: Date.now() + 60_000 });
      expect(await tenantUsed()).toBe(500);

      const { expired } = await db.expireStaleUploadSessions(Date.now(), GRACE, BATCH);

      expect(expired).toBeGreaterThanOrEqual(1);
      expect(await tenantUsed()).toBe(200);
      expect(await workspaceUsed()).toBe(0);
      expect((await db.getUploadSessionByFileId(lapsed.id))?.status).toBe('expired');
      expect((await db.getUploadSessionByFileId(fresh.id))?.status).toBe('pending');
      // Running the sweep again releases nothing more.
      await db.expireStaleUploadSessions(Date.now(), GRACE, BATCH);
      expect(await tenantUsed()).toBe(200);
    });

    it('gives an upload in flight the grace period before reclaiming it', async () => {
      const expiresAt = Date.now() - 1_000;
      const file = fileInput(300);
      const sessionId = await seedFile(db, file, { pending: true, expiresAt });
      await db.claimUploadSession(sessionId);

      await db.expireStaleUploadSessions(Date.now(), GRACE, BATCH);
      expect((await db.getUploadSessionByFileId(file.id))?.status).toBe('uploading');
      expect(await tenantUsed()).toBe(300);

      await db.expireStaleUploadSessions(expiresAt + GRACE + 1, GRACE, BATCH);
      expect((await db.getUploadSessionByFileId(file.id))?.status).toBe('expired');
      expect(await tenantUsed()).toBe(0);
    });

    it('refuses a reservation beyond the tenant quota and writes nothing', async () => {
      await seedFile(db, fileInput(900));
      const file = fileInput(200);

      const result = await db.createPendingUpload({
        file,
        session: { presignedUrl: '/x', expiresAt: Date.now() + 60_000 },
      });

      expect(result).toEqual({ created: false });
      expect(await tenantUsed()).toBe(900);
      expect(await db.getFileById(file.id, tenantId)).toBeNull();
      expect(await db.getUploadSessionByFileId(file.id)).toBeNull();
    });

    it('refuses a reservation beyond the workspace quota and leaves the tenant untouched', async () => {
      await seedFile(db, fileInput(700, { workspace: true }));
      const file = fileInput(200, { workspace: true });

      const result = await db.createPendingUpload({
        file,
        session: { presignedUrl: '/x', expiresAt: Date.now() + 60_000 },
      });

      expect(result).toEqual({ created: false });
      expect(await tenantUsed()).toBe(700);
      expect(await workspaceUsed()).toBe(700);
      expect(await db.getFileById(file.id, tenantId)).toBeNull();
    });

    it('never lets concurrent reservations push usage past the quota', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          db.createPendingUpload({
            file: fileInput(300),
            session: { presignedUrl: '/x', expiresAt: Date.now() + 60_000 },
          })
        )
      );

      expect(results.filter((r) => r.created)).toHaveLength(3);
      expect(await tenantUsed()).toBe(900);
      expect(await db.recalculateQuota(tenantId)).toBe(900);
    });

    it('releases once when a pending upload is deleted, even if it later expires', async () => {
      const file = fileInput(300, { workspace: true });
      await seedFile(db, file, { pending: true, expiresAt: Date.now() - 1_000 });

      expect(await db.deleteFileAndReleaseQuota(file.id, tenantId)).not.toBeNull();
      expect(await tenantUsed()).toBe(0);
      expect(await workspaceUsed()).toBe(0);
      expect((await db.getUploadSessionByFileId(file.id))?.status).toBe('failed');

      await db.expireStaleUploadSessions(Date.now(), GRACE, BATCH);
      expect(await db.deleteFileAndReleaseQuota(file.id, tenantId)).toBeNull();
      expect(await tenantUsed()).toBe(0);
    });

    it('releases exactly the stored bytes when a delete races the settle', async () => {
      await seedFile(db, fileInput(500)); // unrelated file that must stay counted
      const file = fileInput(300);
      const sessionId = await seedFile(db, file, { pending: true });
      await db.claimUploadSession(sessionId);

      await Promise.all([
        db.settleUploadSession(sessionId, { status: 'completed', actualBytes: 100 }),
        db.deleteFileAndReleaseQuota(file.id, tenantId),
      ]);

      expect(await tenantUsed()).toBe(500);
      expect(await db.recalculateQuota(tenantId)).toBe(500);
    });

    it('releases completed and reserved bytes when a workspace is emptied', async () => {
      const completed = fileInput(200, { workspace: true });
      await seedFile(db, completed);
      const pending = fileInput(300, { workspace: true });
      await seedFile(db, pending, { pending: true });
      const outside = fileInput(100);
      await seedFile(db, outside);

      const { releasedBytes, files } = await db.deleteWorkspaceFilesAndReleaseQuota(
        workspaceId,
        tenantId
      );

      expect(releasedBytes).toBe(500);
      // Exactly the files it soft-deleted, with the keys of their objects.
      const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
      expect([...files].sort(byId)).toEqual(
        [
          { id: completed.id, storedPath: completed.storedPath },
          { id: pending.id, storedPath: pending.storedPath },
        ].sort(byId)
      );
      expect(await db.getFileById(completed.id, tenantId)).toBeNull();
      expect(await db.getFileById(pending.id, tenantId)).toBeNull();
      expect(await db.getFileById(outside.id, tenantId)).not.toBeNull();
      expect(await tenantUsed()).toBe(100);
      expect(await workspaceUsed()).toBe(0);
      expect((await db.getUploadSessionByFileId(pending.id))?.status).toBe('failed');
    });

    it('reports a file created after an earlier listing, so its object is removed too', async () => {
      const early = fileInput(200, { workspace: true });
      await seedFile(db, early);
      const listed = await db.getActiveFilesByWorkspace(workspaceId, tenantId);
      // An upload lands between a listing and the delete.
      const late = fileInput(100, { workspace: true });
      await seedFile(db, late, { pending: true });

      const { releasedBytes, files } = await db.deleteWorkspaceFilesAndReleaseQuota(
        workspaceId,
        tenantId
      );

      expect(listed.map((f) => f.id)).toEqual([early.id]);
      expect(releasedBytes).toBe(300);
      expect(files.map((f) => f.id).sort()).toEqual([early.id, late.id].sort());
      expect(files.find((f) => f.id === late.id)?.storedPath).toBe(late.storedPath);
      expect(await tenantUsed()).toBe(0);
      expect(await workspaceUsed()).toBe(0);
    });

    it('reports nothing when an empty workspace is emptied', async () => {
      expect(await db.deleteWorkspaceFilesAndReleaseQuota(workspaceId, tenantId)).toEqual({
        releasedBytes: 0,
        files: [],
      });
    });

    it('settles from the named state only: a claimed session is not settled as pending', async () => {
      const file = fileInput(300, { workspace: true });
      const sessionId = await seedFile(db, file, { pending: true });
      await db.claimUploadSession(sessionId);

      expect(
        await db.settleUploadSession(
          sessionId,
          { status: 'completed', actualBytes: 300 },
          'pending'
        )
      ).toBe(false);
      expect((await db.getUploadSessionByFileId(file.id))?.status).toBe('uploading');
      expect(await tenantUsed()).toBe(300);
      expect((await db.getFileById(file.id, tenantId))?.processingStatus).toBe('pending');

      expect(
        await db.settleUploadSession(
          sessionId,
          { status: 'completed', actualBytes: 120 },
          'uploading'
        )
      ).toBe(true);
      expect(await tenantUsed()).toBe(120);
      expect(await workspaceUsed()).toBe(120);
    });

    it('settles a pending session from pending, and an unclaimed one never from uploading', async () => {
      const file = fileInput(300);
      const sessionId = await seedFile(db, file, { pending: true });

      expect(await db.settleUploadSession(sessionId, { status: 'failed' }, 'uploading')).toBe(
        false
      );
      expect(await tenantUsed()).toBe(300);
      expect(
        await db.settleUploadSession(
          sessionId,
          { status: 'completed', actualBytes: 250 },
          'pending'
        )
      ).toBe(true);
      expect(await tenantUsed()).toBe(250);
      expect((await db.getUploadSessionByFileId(file.id))?.status).toBe('completed');
    });

    it('drains stale sessions in bounded batches', async () => {
      // Other tests share the database, so these sessions lapse at a moment
      // long before any other session could, and the sweep is judged against
      // the instant right after it: only these three are stale then.
      const lapsedAt = 1_000;
      const files = [fileInput(100), fileInput(100), fileInput(100)];
      for (const f of files) await seedFile(db, f, { pending: true, expiresAt: lapsedAt });
      expect(await tenantUsed()).toBe(300);

      const at = lapsedAt + 1;
      const first = await db.expireStaleUploadSessions(at, GRACE, 2);
      expect(first).toEqual({ scanned: 2, expired: 2 });
      expect(await tenantUsed()).toBe(100);

      const second = await db.expireStaleUploadSessions(at, GRACE, 2);
      expect(second).toEqual({ scanned: 1, expired: 1 });
      expect(await tenantUsed()).toBe(0);

      expect(await db.expireStaleUploadSessions(at, GRACE, 2)).toEqual({ scanned: 0, expired: 0 });
    });

    it('charges the stored bytes of a legacy upload that declared no size', async () => {
      const file = fileInput(0);
      const sessionId = await seedFile(db, file, { pending: true });
      expect(await tenantUsed()).toBe(0);

      await db.settleUploadSession(sessionId, { status: 'completed', actualBytes: 250 });

      expect(await tenantUsed()).toBe(250);
      expect((await db.getFileById(file.id, tenantId))?.sizeBytes).toBe(250);
    });
  });
}
