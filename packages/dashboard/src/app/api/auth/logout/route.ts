import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';
import { LUMITRA_SESSION_COOKIE } from '@/lib/dashboard-auth';

export async function POST() {
  // Clear the legacy iron-session.
  const session = await getSession();
  session.destroy();

  // Best-effort clear of the auth-brain session cookie on this domain. The
  // upstream auth-brain session is not revoked from here.
  const cookieStore = await cookies();
  cookieStore.delete(LUMITRA_SESSION_COOKIE);

  return NextResponse.json({ ok: true });
}
