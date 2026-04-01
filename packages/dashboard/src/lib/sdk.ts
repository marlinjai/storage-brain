import { StorageBrainAdmin } from '@marlinjai/storage-brain-sdk/admin';
import { getSession } from './session';

/**
 * Get an authenticated StorageBrainAdmin instance from the current session.
 * Throws if no session exists (user not logged in).
 */
export async function getAdmin(): Promise<StorageBrainAdmin> {
  const session = await getSession();

  if (!session.adminApiKey) {
    throw new Error('Not authenticated');
  }

  return new StorageBrainAdmin({
    adminApiKey: session.adminApiKey,
    baseUrl: session.baseUrl,
  });
}
