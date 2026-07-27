import { describe, it, expect } from 'vitest';
import {
  parseMapArgs,
  repointTenants,
  formatRepointResults,
  type RepointStore,
  type RepointTx,
} from './repoint-tenant';

// ---------------------------------------------------------------------------
// In-memory store: rows are just { id, tenantId } tuples per table. Mirrors the
// real transactional UPDATE ... WHERE tenant_id = from semantics without a DB.
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  tenantId: string;
  deleted?: boolean;
}

function makeStore(seed: {
  files?: Row[];
  workspaces?: Row[];
  uploadSessions?: Row[];
}): RepointStore & {
  files: Row[];
  workspaces: Row[];
  uploadSessions: Row[];
  transactions: number;
} {
  const files = seed.files ?? [];
  const workspaces = seed.workspaces ?? [];
  const uploadSessions = seed.uploadSessions ?? [];

  const move = (rows: Row[], from: string, to: string): number => {
    let count = 0;
    for (const row of rows) {
      if (row.tenantId === from) {
        row.tenantId = to;
        count++;
      }
    }
    return count;
  };

  const state = {
    files,
    workspaces,
    uploadSessions,
    transactions: 0,
    async withTransaction<T>(fn: (tx: RepointTx) => Promise<T>): Promise<T> {
      state.transactions++;
      const tx: RepointTx = {
        listActiveFileIds: (tenantId) =>
          Promise.resolve(files.filter((f) => f.tenantId === tenantId && !f.deleted).map((f) => f.id)),
        moveFiles: (from, to) => Promise.resolve(move(files, from, to)),
        moveWorkspaces: (from, to) => Promise.resolve(move(workspaces, from, to)),
        moveUploadSessions: (from, to) => Promise.resolve(move(uploadSessions, from, to)),
      };
      return fn(tx);
    },
  };

  return state;
}

describe('parseMapArgs', () => {
  it('parses repeated --map flags', () => {
    expect(parseMapArgs(['--map', 'a=b', '--map', 'c=d'])).toEqual([
      { from: 'a', to: 'b' },
      { from: 'c', to: 'd' },
    ]);
  });

  it('parses --map=value and comma-separated pairs', () => {
    expect(parseMapArgs(['--map=a=b,c=d'])).toEqual([
      { from: 'a', to: 'b' },
      { from: 'c', to: 'd' },
    ]);
  });

  it('throws on a malformed pair', () => {
    expect(() => parseMapArgs(['--map', 'noequals'])).toThrow(/Malformed/);
    expect(() => parseMapArgs(['--map', '=b'])).toThrow(/Malformed/);
    expect(() => parseMapArgs(['--map', 'a='])).toThrow(/Malformed/);
  });

  it('throws on a self-map', () => {
    expect(() => parseMapArgs(['--map', 'a=a'])).toThrow(/itself/);
  });

  it('throws on a duplicate source tenant', () => {
    expect(() => parseMapArgs(['--map', 'a=b', '--map', 'a=c'])).toThrow(/Duplicate/);
  });

  it('throws when no pairs are given', () => {
    expect(() => parseMapArgs([])).toThrow(/No --map pairs/);
  });

  it('throws when --map has no value', () => {
    expect(() => parseMapArgs(['--map'])).toThrow(/requires a value/);
    expect(() => parseMapArgs(['--map', '--other'])).toThrow(/requires a value/);
  });

  it('throws on an unrecognized argument', () => {
    expect(() => parseMapArgs(['--nope', 'x'])).toThrow(/Unrecognized/);
  });
});

describe('repointTenants', () => {
  it('moves rows across all three tables per pair and reports counts', async () => {
    const store = makeStore({
      files: [
        { id: 'f1', tenantId: 'old' },
        { id: 'f2', tenantId: 'old' },
        { id: 'f3', tenantId: 'other' },
      ],
      workspaces: [{ id: 'w1', tenantId: 'old' }],
      uploadSessions: [
        { id: 's1', tenantId: 'old' },
        { id: 's2', tenantId: 'old' },
      ],
    });

    const [result] = await repointTenants(store, [{ from: 'old', to: 'new' }]);

    expect(result).toMatchObject({ from: 'old', to: 'new', files: 2, workspaces: 1, uploadSessions: 2 });
    // Untouched tenant stays put.
    expect(store.files.find((f) => f.id === 'f3')?.tenantId).toBe('other');
    // Moved rows now carry the new tenant.
    expect(store.files.filter((f) => f.tenantId === 'new').map((f) => f.id).sort()).toEqual(['f1', 'f2']);
    expect(store.transactions).toBe(1);
  });

  it('reports the file ids whose permanent URLs break (active files only)', async () => {
    const store = makeStore({
      files: [
        { id: 'f1', tenantId: 'old' },
        { id: 'f2', tenantId: 'old', deleted: true },
      ],
    });

    const [result] = await repointTenants(store, [{ from: 'old', to: 'new' }]);

    // Deleted files are excluded from the broken-URL report.
    expect(result?.brokenPermanentUrlFileIds).toEqual(['f1']);
  });

  it('runs each pair in its own transaction', async () => {
    const store = makeStore({
      files: [
        { id: 'f1', tenantId: 'a' },
        { id: 'f2', tenantId: 'c' },
      ],
    });

    const results = await repointTenants(store, [
      { from: 'a', to: 'b' },
      { from: 'c', to: 'd' },
    ]);

    expect(results.map((r) => r.files)).toEqual([1, 1]);
    expect(store.transactions).toBe(2);
  });

  it('is idempotent: a second run moves nothing and reports no broken URLs', async () => {
    const store = makeStore({
      files: [{ id: 'f1', tenantId: 'old' }],
      workspaces: [{ id: 'w1', tenantId: 'old' }],
      uploadSessions: [{ id: 's1', tenantId: 'old' }],
    });

    await repointTenants(store, [{ from: 'old', to: 'new' }]);
    const [second] = await repointTenants(store, [{ from: 'old', to: 'new' }]);

    expect(second).toMatchObject({ files: 0, workspaces: 0, uploadSessions: 0 });
    expect(second?.brokenPermanentUrlFileIds).toEqual([]);
  });
});

describe('formatRepointResults', () => {
  it('prints per-table counts and the broken permanent-URL ids', () => {
    const out = formatRepointResults([
      { from: 'old', to: 'new', files: 2, workspaces: 1, uploadSessions: 3, brokenPermanentUrlFileIds: ['f1', 'f2'] },
    ]);

    expect(out).toContain('old -> new');
    expect(out).toContain('files: 2, workspaces: 1, upload_sessions: 3');
    expect(out).toContain('permanent URLs broken (2)');
    expect(out).toContain('f1');
    expect(out).toContain('f2');
  });

  it('says "none" when nothing broke', () => {
    const out = formatRepointResults([
      { from: 'old', to: 'new', files: 0, workspaces: 0, uploadSessions: 0, brokenPermanentUrlFileIds: [] },
    ]);
    expect(out).toContain('permanent URLs broken: none');
  });
});
