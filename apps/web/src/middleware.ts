import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function middleware(request: NextRequest) {
  if (!auth0) {
    return NextResponse.next();
  }

  const response = await auth0.middleware(request);

  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/auth') || pathname === '/login') {
    return response;
  }

  const session = await auth0.getSession(request);
  if (!session) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|Imagotipo.svg|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)',
  ],
};
