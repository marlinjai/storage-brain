import { NextResponse } from 'next/server';

/**
 * Kick off Lumitra (auth-brain) login. Redirects to the auth-brain login page
 * with a return_to back to this dashboard. AUTH_BRAIN_URL is a server-only env
 * var, so building the redirect here keeps it out of the client bundle.
 */
export function GET(request: Request) {
  const authBrainUrl = process.env.AUTH_BRAIN_URL ?? 'https://auth.lumitra.co';
  const origin = new URL(request.url).origin;
  const returnTo = `${origin}/`;
  const target = `${authBrainUrl.replace(/\/$/, '')}/login?return_to=${encodeURIComponent(returnTo)}`;
  return NextResponse.redirect(target);
}
