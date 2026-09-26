import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import type { CreateFileInput, DatabaseAdapter } from '@storage-brain/shared';
import { D1DatabaseAdapter } from '../adapters/database/d1';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

interface ShimStatement {
  sql: string;
  bound: unknown[];
}

function execute(sqlite: DatabaseSync, { sql, bound }: ShimStatement) {
  const stmt = sqlite.prepare(sql);
  if (/^\s*SELECT/i.test(sql)) {
    const results = stmt.all(...(bound as never[]));
    return { success: true, results, meta: { changes: 0 } };
  }
  const r = stmt.run(...(bound as never[]));
  return {
    success: true,
    results: [],
    meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
  };
}

/**
 * A D1Database over node:sqlite, enough for the adapter: prepare().bind() with
 * run() / first() / all(), and batch(), which like D1 runs its statements in
 * order inside one transaction and rolls all of them back if one throws.
 */
export function createD1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const state: ShimStatement = { sql, bound: [] };
      const stmt = {
        __shim: state,
        bind(...args: unknown[]) {
          state.bound = args;
          return stmt;
        },
        run() {
          return Promise.resolve(execute(sqlite, state));
        },
        first() {
          const row = sqlite.prepare(sql).get(...(state.bound as never[]));
          return Promise.resolve(row ?? null);
        },
        all() {
          const results = sqlite.prepare(sql).all(...(state.bound as never[]));
          return Promise.resolve({ success: true, results, meta: {} });
        },
      };
      return stmt;
    },
    batch(statements: { __shim: ShimStatement }[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((s) => execute(sqlite, s.__shim));
        sqlite.exec('COMMIT');
        return Promise.resolve(results);
      } catch (err) {
        sqlite.exec('ROLLBACK');
        return Promise.reject(err);
      }
    },
  } as unknown as D1Database;
}

/**
 * Apply every D1 migration in order. 0004 is a Postgres-only column widening
 * (ALTER COLUMN ... TYPE) that SQLite cannot parse; it is a no-op for SQLite,
 * so only that file may throw. Any other migration failing is a real error.
 */
export function applyMigrations(sqlite: DatabaseSync): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
    try {
      sqlite.exec(sql);
    } catch (err) {
      if (!file.startsWith('0004')) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  }
}

/** A fresh in-memory D1 adapter with every migration applied. */
export function makeD1Adapter(): D1DatabaseAdapter {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  return new D1DatabaseAdapter(createD1(sqlite));
}

export interface SeedFileOptions {
  /** Leave the upload open (the declared size stays reserved). */
  pending?: boolean;
  /** Soft-delete the file afterwards (its bytes are released). */
  deleted?: boolean;
  expiresAt?: number;
}

/**
 * Create a file the way production does: reserve its size and open an upload
 * session, then (unless `pending`) settle the upload as completed with exactly
 * that size. Returns the upload session id.
 */
export async function seedFile(
  db: DatabaseAdapter,
  file: CreateFileInput,
  opts: SeedFileOptions = {}
): Promise<string> {
  const result = await db.createPendingUpload({
    file,
    session: {
      presignedUrl: `/_internal/upload/${encodeURIComponent(file.storedPath)}`,
      expiresAt: opts.expiresAt ?? Date.now() + 60_000,
    },
  });
  if (!result.created) throw new Error(`seedFile: no quota left for ${file.id}`);
  if (!opts.pending) {
    await db.settleUploadSession(result.sessionId, {
      status: 'completed',
      actualBytes: file.sizeBytes,
    });
  }
  if (opts.deleted) await db.deleteFileAndReleaseQuota(file.id, file.tenantId);
  return result.sessionId;
}
