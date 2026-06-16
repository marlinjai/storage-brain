import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Accept EITHER an auth-brain session or the legacy admin-key iron-session.
  // Deep verification (verifySession + can) happens in getDashboardSession() at
  // the route/page layer, not here: keeps the verify/can fetch off every static
  // asset request.
  const hasAuthCookie =
    request.cookies.has('lumitra_session') || request.cookies.has('sb-dashboard');
  const isLoginPage = request.nextUrl.pathname === '/login';

  if (!hasAuthCookie && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (hasAuthCookie && isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
