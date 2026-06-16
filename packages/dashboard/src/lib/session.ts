import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  adminApiKey?: string;
  baseUrl?: string;
}

// Dev-only fallback secret (>= 32 chars, required by iron-session). Never shipped
// as a production default: production must provide a real SESSION_SECRET.
const DEV_SESSION_SECRET = 'storage-brain-dashboard-dev-secret-at-least-32-chars';

function resolveSessionPassword(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }
  return DEV_SESSION_SECRET;
}

function getSessionOptions(): SessionOptions {
  return {
    password: resolveSessionPassword(),
    cookieName: 'sb-dashboard',
    cookieOptions: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
    },
  };
}

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}
