import { NextRequest, NextResponse } from 'next/server';
import { BRANDING_ASSET_TYPES } from '@cenzontle/shared';

/**
 * Ruta pública del frontend que reenvía los assets binarios de branding
 * desde el backend NestJS, SIN requerir auth.
 *
 * Por qué no usar el BFF proxy `/api/proxy/...`:
 *  - El BFF requiere session de Auth0; el navegador carga favicon/logo SIN
 *    cookies de auth (especialmente el favicon de la pestaña).
 *  - Mantener el endpoint público pero bajo el mismo dominio del frontend
 *    evita CORS y mantiene compatibilidad si el backend está detrás del
 *    proxy en producción.
 *
 * El backend valida que `type` sea un BrandingAssetType válido — duplicamos
 * la validación aquí para devolver 400 sin gastar el round-trip si el path
 * es basura.
 */
const API_BASE = process.env.API_INTERNAL_URL || 'http://localhost:3001';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const { type } = await params;
  if (!(BRANDING_ASSET_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json(
      { error: `Invalid asset type: ${type}` },
      { status: 400 },
    );
  }

  // Preservamos el query string (que contiene el cache buster `?v=...`)
  // para que llegue idéntico al backend — aunque el backend lo ignora,
  // mantenerlo identifica la versión en logs y debugging.
  const queryString = request.nextUrl.search;
  const upstreamUrl = `${API_BASE}/api/branding-settings/asset/${type}${queryString}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      // No cacheamos en el server-side de Next.js — el backend ya manda
      // `Cache-Control: max-age=300, must-revalidate` y la URL es
      // versionada por `?v=<ts>`. Cachear aquí solo añade latencia tras
      // un cambio de asset.
      cache: 'no-store',
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Asset not found' },
        { status: upstream.status },
      );
    }
    const buffer = await upstream.arrayBuffer();
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    const cacheControl = upstream.headers.get('cache-control') ?? 'public, max-age=300, must-revalidate';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
      },
    });
  } catch (err) {
    console.error('[branding-asset proxy] upstream fetch failed:', (err as Error).message);
    return NextResponse.json(
      { error: 'Failed to fetch asset from backend' },
      { status: 502 },
    );
  }
}
