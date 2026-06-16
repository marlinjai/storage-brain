import { StorageBrainAdmin } from '@marlinjai/storage-brain-sdk/admin';
import { getDashboardSession } from './dashboard-auth';

/**
 * Get an authenticated StorageBrainAdmin instance for the current request.
 *
 * - auth-brain mode: the dashboard server holds its own backend credential
 *   (`STORAGE_BRAIN_ADMIN_KEY` + `STORAGE_BRAIN_URL`, server-only env). auth-brain
 *   governs which humans may drive it.
 * - legacy mode: the admin key the user typed at `/login`, from the iron-session.
 *
 * Throws `Not authenticated` when there is no session (callers map this to 401).
 */
export async function getAdmin(): Promise<StorageBrainAdmin> {
  const session = await getDashboardSession();

  if (!session) {
    throw new Error('Not authenticated');
  }

  if (session.mode === 'auth-brain') {
    const adminApiKey = process.env.STORAGE_BRAIN_ADMIN_KEY;
    if (!adminApiKey) {
      throw new Error('STORAGE_BRAIN_ADMIN_KEY is not configured');
    }
    return new StorageBrainAdmin({
      adminApiKey,
      baseUrl: process.env.STORAGE_BRAIN_URL,
    });
  }

  return new StorageBrainAdmin({
    adminApiKey: session.adminApiKey,
    baseUrl: session.baseUrl,
  });
}
