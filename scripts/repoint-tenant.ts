#!/usr/bin/env tsx
/**
 * Repoint storage tenants for company-isolation S2 (`storage-split-tenants`).
 *
 * Usage:
 *   DATABASE_URL=postgres://... tsx scripts/repoint-tenant.ts \
 *     --map oldTenantId=newTenantId [--map old2=new2 ...]
 *
 * Moves `files`, `workspaces`, and `upload_sessions` rows from each old tenant
 * id to the new one, one pair per transaction. Idempotent (re-running moves
 * zero rows). Prints per-table counts and the list of file ids whose permanent
 * URLs break, because permanent download tokens sign `${tenantId}:${fileId}`
 * and re-tenanting invalidates them. No tenant ids are hardcoded: they come
 * only from --map.
 *
 * The transactional orchestration and the arg parsing live in the API package
 * (`packages/api/src/lib/repoint-tenant.ts`) so they are typechecked, linted,
 * and unit-tested. This file is the thin Postgres-backed CLI over that logic.
 */
import postgres from 'postgres';
import {
  parseMapArgs,
  repointTenants,
  formatRepointResults,
  type RepointStore,
  type RepointTx,
} from '../packages/api/src/lib/repoint-tenant';

function makeStore(sql: postgres.Sql): RepointStore {
  return {
    withTransaction: (fn) =>
      sql.begin((txHandle) => {
        // postgres.js Omits the tagged-template signature off the tx handle.
        const tx = txHandle as unknown as postgres.Sql;
        const now = Date.now();
        const ops: RepointTx = {
          async listActiveFileIds(tenantId) {
            const rows = await tx`SELECT id FROM files WHERE tenant_id = ${tenantId} AND deleted_at IS NULL`;
            return rows.map((r) => r.id as string);
          },
          async moveFiles(from, to) {
            const r = await tx`UPDATE files SET tenant_id = ${to}, updated_at = ${now} WHERE tenant_id = ${from}`;
            return r.count;
          },
          async moveWorkspaces(from, to) {
            const r = await tx`UPDATE workspaces SET tenant_id = ${to}, updated_at = ${now} WHERE tenant_id = ${from}`;
            return r.count;
          },
          async moveUploadSessions(from, to) {
            const r = await tx`UPDATE upload_sessions SET tenant_id = ${to} WHERE tenant_id = ${from}`;
            return r.count;
          },
        };
        return fn(ops);
      }) as Promise<unknown>,
  } as RepointStore;
}

async function main(): Promise<void> {
  const pairs = parseMapArgs(process.argv.slice(2));

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const sql = postgres(connectionString);
  try {
    const results = await repointTenants(makeStore(sql), pairs);
    console.log(formatRepointResults(results));
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
