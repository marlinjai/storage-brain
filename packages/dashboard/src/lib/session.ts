import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  adminApiKey?: string;
  baseUrl?: string;
}

const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || 'storage-brain-dashboard-secret-that-is-at-least-32-chars',
  cookieName: 'sb-dashboard',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
