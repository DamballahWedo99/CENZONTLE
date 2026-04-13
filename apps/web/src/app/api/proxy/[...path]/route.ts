import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

/**
 * BFF proxy — TODOS los requests al backend pasan por aquí.
 *
 * Extrae el access token de Auth0 de la sesión del usuario y lo reenvía
 * como Authorization: Bearer al backend NestJS. El backend valida el JWT
 * y aplica el rol REAL del usuario para cada request.
 *
 * Esto garantiza que ningún endpoint del backend sea accesible sin
 * autenticación, incluyendo los de lectura.
 */
const API_BASE = process.env.API_INTERNAL_URL || 'http://localhost:3001';

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Fail closed: si Auth0 no está configurado, rechazar toda mutación
  if (!auth0) {
    return NextResponse.json(
      { message: 'Authentication service not configured' },
      { status: 503 },
    );
  }

  // Extraer el access token real del usuario desde la sesión Auth0.
  // Si la sesión expiró o no existe, el middleware ya redirigió a /login,
  // pero verificamos de nuevo como defensa en profundidad.
  let token: string;
  try {
    const result = await auth0.getAccessToken();
    if (!result.token) {
      return NextResponse.json(
        { message: 'No access token in session — check Auth0 audience config' },
        { status: 401 },
      );
    }
    token = result.token;
  } catch {
    return NextResponse.json(
      { message: 'Not authenticated — session expired or missing' },
      { status: 401 },
    );
  }

  const { path } = await params;
  const apiPath = path.join('/');
  const queryString = request.nextUrl.search;
  const url = `${API_BASE}/api/${apiPath}${queryString}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  // Forward content-type para que el backend parsee correctamente
  // (funciona tanto para JSON como multipart/form-data)
  const contentType = request.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  try {
    // Forward raw body (funciona para JSON y multipart)
    const hasBody = !['GET', 'HEAD'].includes(request.method);
    const body = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;

    const res = await fetch(url, {
      method: request.method,
      headers,
      body,
    });

    if (res.status === 204) return new NextResponse(null, { status: 204 });

    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status });
    } catch {
      return new NextResponse(text, {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    return NextResponse.json(
      { message: 'Proxy error: backend unreachable' },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, ctx);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, ctx);
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, ctx);
}
