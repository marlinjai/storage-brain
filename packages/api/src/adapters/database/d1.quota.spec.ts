import { makeD1Adapter } from '../../test-utils/d1-sqlite';
import { describeQuotaContract } from '../../test-utils/quota-contract';

// D1 over node:sqlite: every operation is one batch() transaction. SQLite runs
// them one at a time, so the concurrency cases here check the guards; the
// Postgres run of the same contract checks them under real concurrency.
describeQuotaContract('D1DatabaseAdapter', () => makeD1Adapter());
