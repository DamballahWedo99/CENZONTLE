import { NextRequest, NextResponse } from 'next/server';
import { Agent, fetch as undiciFetch } from 'undici';
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

/**
 * Dispatcher de undici para endpoints SSE — desactiva los timeouts del
 * body porque un stream SSE legítimamente puede tardar minutos entre
 * eventos significativos (deep research del agente, web search, etc.).
 *
 * El default de undici es `bodyTimeout: 300_000` (5min) — lo que causaba
 * `UND_ERR_BODY_TIMEOUT` cuando el LLM tardaba más de 5min entre eventos.
 * Con heartbeats SSE en el backend (cada 15s) esto no debería disparar,
 * pero como defensa en profundidad mantenemos ambos timeouts en 0 para
 * los SSE.
 *
 * `headersTimeout` también a 0 porque el backend puede demorar en
 * empezar a responder si está cargando contexto pesado (vault scan,
 * cross-epic queries) antes del primer flushHeaders.
 *
 * `keepAliveTimeout` se mantiene generoso (10min) para reciclar
 * conexiones después del SSE largo. Si no, el next request reusa una
 * conexión potencialmente medio-cerrada.
 */
const sseDispatcher = new Agent({
  bodyTimeout: 0,
  headersTimeout: 0,
  keepAliveTimeout: 10 * 60 * 1000,
});

/**
 * Detecta paths SSE conocidos por convención. Mantener sincronizado con
 * los `@Controller` que retornan `text/event-stream`. Aplicamos el
 * dispatcher con timeouts desactivados solo aquí — para JSON normal
 * preferimos los defaults de undici (5min body timeout) como protección
 * contra hangs accidentales.
 *
 * IMPORTANTE: cada controller SSE tiene también endpoints JSON hermanos
 * bajo el mismo prefijo (ej. `/cache`, `/cache/ttl`, `/session`,
 * `/session/active`). Solo el GET de `/<prefijo>/<uuid>` SIN sub-segmentos
 * es el SSE real. Matcheamos ese shape exacto: `prefix/<uuid>` opcionalmente
 * con query string. UUID v4 charset: hex + guiones, longitud 36.
 */
const SSE_PATH_RE = new RegExp(
  '^proyectos/(?:story-generation|epic-generation|diagram-generation)/' +
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'i',
);
function isSseEndpoint(apiPath: string): boolean {
  return SSE_PATH_RE.test(apiPath);
}

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

  // Forward Origin/Referer para que módulos del backend que implementan
  // defense-in-depth CSRF (e.g. branding-settings) puedan validar contra
  // su allowlist. Sin esto, el backend ve `undefined` en ambos y debe
  // fail-open al asumir que es un client API legítimo. CON esto, un PATCH
  // legítimo del browser lleva el Origin del frontend; un atacante cross-
  // origin lleva su propio Origin → el backend lo rechaza.
  const origin = request.headers.get('origin');
  if (origin) headers['Origin'] = origin;
  const referer = request.headers.get('referer');
  if (referer) headers['Referer'] = referer;

  try {
    // Forward raw body (funciona para JSON y multipart)
    const hasBody = !['GET', 'HEAD'].includes(request.method);
    const body = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;

    // Para SSE usamos `undici.fetch` (importado del package) en vez del
    // `globalThis.fetch` que Next.js envuelve. El wrapper de Next no
    // propaga el campo `dispatcher` hacia undici — lo silencia o tira
    // TypeError. Usar el `fetch` exportado de undici evita el wrapper y
    // garantiza que el dispatcher con `bodyTimeout: 0` se aplique.
    //
    // Para JSON normal mantenemos el `globalThis.fetch` de Next porque
    // queremos sus features (caching, RSC fetch dedup, etc.) y no
    // necesitamos un dispatcher custom.
    let res: Response;
    if (isSseEndpoint(apiPath)) {
      const undiciRes = await undiciFetch(url, {
        method: request.method,
        headers,
        body,
        dispatcher: sseDispatcher,
      });
      // El `Response` de undici es estructuralmente compatible con el
      // global Response (ambos exponen body como ReadableStream); cast
      // explícito porque los tipos no son nominalmente equivalentes.
      res = undiciRes as unknown as Response;
    } else {
      res = await fetch(url, {
        method: request.method,
        headers,
        body,
      });
    }

    if (res.status === 204) return new NextResponse(null, { status: 204 });

    // SSE streaming: if the backend returns text/event-stream, pipe the
    // response body directly to the client without buffering.
    const resContentType = res.headers.get('content-type') || '';
    if (resContentType.includes('text/event-stream') && res.body) {
      return new NextResponse(res.body as ReadableStream, {
        status: res.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status });
    } catch {
      return new NextResponse(text, {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    // Log el error original — sin esto, fallos de fetch (ECONNREFUSED,
    // AbortError por timeout, errores de DNS, etc.) se pierden y solo
    // vemos "backend unreachable" en el cliente. `TypeError: fetch failed`
    // SIEMPRE viene con un `cause` interno que tiene la info real
    // (ECONNREFUSED, ENOTFOUND, AbortError, validation errors del fetch
    // wrapper de Next, etc.) — sin desempacarlo el log es inútil.
    let causeStr = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const inner = (err as { cause?: unknown })?.cause;
    if (inner) {
      const innerStr = inner instanceof Error ? `${inner.name}: ${inner.message}` : String(inner);
      causeStr += ` | cause=${innerStr}`;
      const innerCode = (inner as { code?: string })?.code;
      if (innerCode) causeStr += ` code=${innerCode}`;
    }
    console.error(`[proxy] fetch error path=${apiPath} ${causeStr}`);
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
