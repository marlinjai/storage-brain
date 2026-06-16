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

/**
 * Resolve the browser-reachable base URL of the Storage Brain API for the
 * current session, used to absolutize the API-relative presigned upload URL so
 * the browser can PUT file bytes directly to the API origin.
 *
 * Resolution order:
 * - `NEXT_PUBLIC_STORAGE_BRAIN_URL` (public override; set this when the
 *   server-side `STORAGE_BRAIN_URL` is an internal-only hostname not reachable
 *   from the browser).
 * - auth-brain mode: server `STORAGE_BRAIN_URL`.
 * - legacy mode: the base URL the user typed at `/login` (from the session).
 *
 * Returns '' when nothing is configured; callers then leave the presigned URL
 * relative.
 */
export async function getStorageBrainBaseUrl(): Promise<string> {
  const session = await getDashboardSession();

  if (!session) {
    throw new Error('Not authenticated');
  }

  const publicOverride = process.env.NEXT_PUBLIC_STORAGE_BRAIN_URL;
  if (publicOverride) {
    return publicOverride.replace(/\/$/, '');
  }

  if (session.mode === 'auth-brain') {
    return (process.env.STORAGE_BRAIN_URL ?? '').replace(/\/$/, '');
  }

  return (session.baseUrl ?? '').replace(/\/$/, '');
}
