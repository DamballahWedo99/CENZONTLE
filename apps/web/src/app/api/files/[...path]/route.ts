import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

/**
 * BFF binary streaming route — hermana del proxy JSON en /api/proxy/.
 *
 * El proxy JSON hace res.text() + JSON.parse, lo cual corrompe binarios.
 * Esta ruta stream el body raw para servir PDFs e imágenes inline al
 * cliente (viewer con iframe/img via blob URL).
 *
 * Defensas clave (revisión de seguridad):
 *  - Path traversal: rechazamos `..` y `.` crudos ANTES de build URL, y
 *    revalidamos el pathname canonicalizado contra la allowlist.
 *  - Inyección en query/headers: dropeamos el query string (el upstream
 *    no consume params en este endpoint).
 *  - XSS via MIME upstream: allowlist estricta de Content-Type (pdf +
 *    imágenes raster). SVG/HTML bloqueados explícitamente para evitar
 *    ejecución de JS en origen propio via blob URL.
 *  - Sniffing: X-Content-Type-Options: nosniff.
 *  - Embedding malicioso: Content-Security-Policy sandbox + frame-ancestors.
 *  - DoS: cap de Content-Length (15 MB; alinea con el cap de upload de 10 MB).
 */
const API_BASE = process.env.API_INTERNAL_URL || 'http://localhost:3001';

const ALLOWED_UPSTREAM_PATHNAME_PREFIX = '/api/documents/file/';

const ALLOWED_CONTENT_TYPES = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const MAX_CONTENT_LENGTH = 15 * 1024 * 1024;

function rejectsTraversalChars(rawPath: string): boolean {
  // Segmentos `..` o `.` crudos, slashes URL-encoded, CR/LF y null bytes.
  if (/(^|\/)(\.\.?)(\/|$)/.test(rawPath)) return true;
  if (/%2f|%2e%2e/i.test(rawPath)) return true;
  if (/[\r\n\0]/.test(rawPath)) return true;
  return false;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!auth0) {
    return NextResponse.json(
      { message: 'Authentication service not configured' },
      { status: 503 },
    );
  }

  const { path } = await params;
  const rawApiPath = path.join('/');

  if (rejectsTraversalChars(rawApiPath)) {
    return NextResponse.json(
      { message: 'Invalid path', code: 'E_TRAVERSAL_CHARS' },
      { status: 400 },
    );
  }

  // Validamos el pathname YA normalizado (cualquier `..` remanente se
  // colapsaría acá) para garantizar que el request upstream queda dentro
  // del prefijo permitido.
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(`${API_BASE}/${rawApiPath}`);
  } catch {
    return NextResponse.json(
      { message: 'Invalid upstream URL', code: 'E_BAD_URL' },
      { status: 400 },
    );
  }

  if (!upstreamUrl.pathname.startsWith(ALLOWED_UPSTREAM_PATHNAME_PREFIX)) {
    return NextResponse.json(
      {
        message: 'Path not allowed for binary streaming',
        code: 'E_NOT_ALLOWED',
      },
      { status: 400 },
    );
  }

  // El endpoint upstream no acepta query params; dropearlos evita smuggling.
  upstreamUrl.search = '';

  let token: string;
  try {
    const result = await auth0.getAccessToken();
    if (!result.token) {
      return NextResponse.json(
        { message: 'No access token in session' },
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

  try {
    const res = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return NextResponse.json(
        { message: `Upstream error ${res.status}` },
        { status: res.status },
      );
    }

    if (!res.body) {
      return NextResponse.json(
        { message: 'Empty response body' },
        { status: 502 },
      );
    }

    // Allowlist de MIME: bloqueamos SVG, HTML y otros vectores de XSS en
    // blob URLs renderizados same-origin. Si el backend alguna vez envía
    // un tipo no listado, respondemos 415 en vez de filtrar al cliente.
    const upstreamContentType = (
      res.headers.get('content-type') || 'application/octet-stream'
    )
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (!ALLOWED_CONTENT_TYPES.has(upstreamContentType)) {
      return NextResponse.json(
        { message: `Unsupported media type: ${upstreamContentType}` },
        { status: 415 },
      );
    }

    const upstreamLength = res.headers.get('content-length');
    if (upstreamLength && Number(upstreamLength) > MAX_CONTENT_LENGTH) {
      return NextResponse.json(
        { message: 'File too large for preview' },
        { status: 413 },
      );
    }

    return new NextResponse(res.body as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': upstreamContentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
        // Defense in depth contra MIME sniffing y ejecución en frame.
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy':
          "default-src 'none'; sandbox; frame-ancestors 'self'",
      },
    });
  } catch {
    return NextResponse.json(
      { message: 'Proxy error: backend unreachable' },
      { status: 502 },
    );
  }
}
