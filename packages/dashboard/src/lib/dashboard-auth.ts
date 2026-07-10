import { cookies } from 'next/headers';
import type { User } from '@marlinjai/auth-brain-sdk';
import { getAuthBrainClient } from './auth-brain';
import { getSession } from './session';

/** Cookie set by auth-brain on successful Lumitra login. */
export const LUMITRA_SESSION_COOKIE = 'lumitra_session';

/** Requirement gating access to this admin tool (platform-wide admin role). */
export const PLATFORM_ADMIN_REQUIREMENT = 'platform.admin';

/**
 * Resource handle for the platform-wide admin check. The dashboard is an
 * all-or-nothing admin tool today; per-tenant filtering arrives in a later
 * slice once auth-brain grants are provisioned.
 */
const PLATFORM_RESOURCE = { type: 'platform', id: 'lumitra' };

export type DashboardSession =
  | { mode: 'auth-brain'; user: User }
  | { mode: 'legacy'; adminApiKey: string; baseUrl?: string };

/**
 * Resolve the current dashboard session, hybrid and fail-closed:
 *
 * 1. `lumitra_session` cookie present -> verify it. If the session is valid AND
 *    the user is a platform admin -> auth-brain mode. If the session is valid
 *    but the user is NOT a platform admin (or the session is invalid, or
 *    verify/can throws or times out) -> unauthorized (`null`). A logged-in but
 *    unauthorized user must never silently fall back to legacy admin access.
 * 2. else the legacy `sb-dashboard` iron-session with an `adminApiKey` -> legacy
 *    mode.
 * 3. else `null`.
 */
export async function getDashboardSession(): Promise<DashboardSession | null> {
  const cookieStore = await cookies();
  const lumitraCookie = cookieStore.get(LUMITRA_SESSION_COOKIE)?.value;

  if (lumitraCookie) {
    try {
      const client = getAuthBrainClient();
      const verified = await client.verifySession(lumitraCookie);
      if (verified?.user) {
        const allowed = await client.can(
          verified.user.id,
          PLATFORM_ADMIN_REQUIREMENT,
          PLATFORM_RESOURCE
        );
        if (allowed) {
          return { mode: 'auth-brain', user: verified.user };
        }
      }
    } catch (err) {
      // verifySession / can threw or timed out: fail closed, never an allow.
      // Log the cause: a silent null here surfaces as a bare 401 and is
      // indistinguishable from a plain unauthorized user when debugging.
      console.error('[dashboard] auth-brain session check failed:', err);
      return null;
    }
    // Lumitra cookie present but not a valid platform-admin session: do not fall
    // through to legacy. Fail closed.
    return null;
  }

  const session = await getSession();
  if (session.adminApiKey) {
    return {
      mode: 'legacy',
      adminApiKey: session.adminApiKey,
      baseUrl: session.baseUrl,
    };
  }

  return null;
}
