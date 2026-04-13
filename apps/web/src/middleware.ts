import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function middleware(request: NextRequest) {
  // Fail closed: si Auth0 no está configurado, bloquear todas las rutas
  // protegidas. Sin IdP configurado, la app no puede autenticar a nadie.
  if (!auth0) {
    const { pathname } = request.nextUrl;

    // API routes → 503 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { message: 'Auth not configured' },
        { status: 503 },
      );
    }

    // Page routes → mostrar error
    return new NextResponse(
      '<!DOCTYPE html><html><head><title>503</title></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#020C41;color:#fff;flex-direction:column"><h1>503 — Auth not configured</h1><p>Set AUTH0_DOMAIN, AUTH0_SECRET, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET in .env.local</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
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
