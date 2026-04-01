import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const cookie = request.cookies.get('sb-dashboard');
  const isLoginPage = request.nextUrl.pathname === '/login';

  if (!cookie && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (cookie && isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
