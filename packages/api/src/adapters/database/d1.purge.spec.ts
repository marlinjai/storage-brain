import { makeD1Adapter } from '../../test-utils/d1-sqlite';
import { describePurgeContract } from '../../test-utils/purge-contract';

// D1 over node:sqlite: every operation is one batch() transaction. This run
// of the purge contract checks the SQL and the row mapping against a real
// SQLite schema (all migrations applied, including 0009 and 0010).
describePurgeContract('D1DatabaseAdapter', () => makeD1Adapter());
