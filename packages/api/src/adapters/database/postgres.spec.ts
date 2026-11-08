import { afterAll, beforeAll, describe, it } from 'vitest';
import { PostgresDatabaseAdapter } from './postgres';
import { describeQuotaContract } from '../../test-utils/quota-contract';
import { describePurgeContract } from '../../test-utils/purge-contract';

// The Postgres contract runs are intentionally colocated in THIS file, which
// runs in one worker, so the two suites never touch the shared database from
// parallel workers. Running them in parallel (as separate spec files do)
// occasionally raised a real `deadlock detected` inside `settleUploadSession`
// when transactions from the two files interleaved. Sequential in one worker,
// the contracts are deterministic and the concurrency cases still exercise
// real parallelism within a single test.
//
// CI provides the database (the Verify workflow's postgres service); locally:
//   docker run -d --rm -p 55432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres pnpm test
// Without TEST_DATABASE_URL the suite is reported as skipped, except in CI,
// where a missing database fails the run instead of silently passing.
const url = process.env.TEST_DATABASE_URL;

if (!url && process.env.CI) {
  describe('PostgresDatabaseAdapter contracts', () => {
    it('needs TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL is not set: the Postgres contracts cannot run');
    });
  });
} else {
  describe.skipIf(!url)('PostgresDatabaseAdapter (TEST_DATABASE_URL)', () => {
    let db: PostgresDatabaseAdapter;

    beforeAll(async () => {
      db = new PostgresDatabaseAdapter({ connectionString: url as string });
      await db.migrate();
    });

    afterAll(async () => {
      await db?.close();
    });

    const getDb = () => db;
    describeQuotaContract('PostgresDatabaseAdapter', getDb);
    describePurgeContract('PostgresDatabaseAdapter', getDb);
  });
}
