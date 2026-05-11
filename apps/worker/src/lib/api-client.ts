import { logger } from './logger.js';

/**
 * Error tipado para responses non-2xx de la API.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiClientOptions {
  dashboardUrl: string;
  token: string;
}

/**
 * Cliente HTTP minimalista del worker hacia el backend del dashboard.
 *
 * Features:
 *  - Bearer token auto-incluido en headers
 *  - Retry exponencial en errores 5xx y network failures (3 intentos max)
 *  - 401 NO se reintenta (token revocado/inválido — caller decide qué hacer)
 *  - Logs estructurados de cada intento + retry
 *
 * El backend está bajo `/api/*` (proxy BFF en dev, Render path en prod).
 * El worker llama directo al backend sin pasar por proxy BFF — el dashboard
 * URL apunta directamente al servicio API.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(opts: ApiClientOptions) {
    // Normaliza trailing slash y asegura prefijo /api
    const trimmed = opts.dashboardUrl.replace(/\/$/, '');
    this.baseUrl = trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
    this.token = opts.token;

    // ════════════════════════════════════════════════════════════════════
    // PRE-PRODUCTION CHECKLIST (cuando vayan a deployar workers en prod):
    //
    //   1. El backend del API debe estar detrás de TLS (Caddy/Nginx/Traefik
    //      o el platform managed cert: Render, Railway, Fly.io, etc.)
    //   2. La env var `PUBLIC_API_URL` del API debe ser `https://...`
    //      (eso hace que el frontend muestre el comando correcto al operador)
    //   3. El operador NO debe setear `FACTORY_WORKER_ALLOW_INSECURE=1`
    //      en la máquina del worker. Si está seteado, el banner amarillo
    //      del modal "Token de conexión" sí aparece — eso es el síntoma.
    //   4. Verificar al boot del worker que NO aparece el WARN
    //      `[apiclient.insecure]` en los logs.
    //
    // Si las 4 condiciones se cumplen, el ANTHROPIC_API_KEY (que viaja en
    // CADA response de claim-story, cada ~5s × N workers) está cifrado
    // por TLS extremo a extremo. Si UNA falla, está plaintext en la red.
    // ════════════════════════════════════════════════════════════════════
    //
    // SECURITY (security-reviewer F-01 2026-05-06): rechaza dashboardUrl
    // sin TLS. El claim-story devuelve el ANTHROPIC_API_KEY plaintext en
    // cada response (~5s × N workers). Sobre HTTP cualquier MITM en la
    // red lo extrae con un tcpdump.
    //
    // Override SOLO para dev local con `FACTORY_WORKER_ALLOW_INSECURE=1`.
    // Nunca en producción — si alguien lo setea por error, queda evidencia
    // en los logs de boot del worker (event: 'apiclient.insecure').
    let parsed: URL;
    try {
      parsed = new URL(this.baseUrl);
    } catch {
      throw new Error(`ApiClient: dashboardUrl inválido: "${opts.dashboardUrl}"`);
    }
    if (parsed.protocol !== 'https:') {
      const allowInsecure = process.env.FACTORY_WORKER_ALLOW_INSECURE === '1';
      if (!allowInsecure) {
        throw new Error(
          `ApiClient: dashboardUrl debe usar HTTPS (encontrado: ${parsed.protocol}). ` +
            `Para dev local, exporta FACTORY_WORKER_ALLOW_INSECURE=1 (NUNCA en producción — ` +
            `el ANTHROPIC_API_KEY se transmite en cleartext).`,
        );
      }
      logger.warn(
        {
          event: 'apiclient.insecure',
          protocol: parsed.protocol,
          host: parsed.host,
        },
        '⚠️  FACTORY_WORKER_ALLOW_INSECURE=1 — dashboardUrl usa HTTP. Secrets viajan en cleartext. NUNCA usar en producción.',
      );
    }
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const maxAttempts = 3;
    const baseBackoffMs = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (res.status === 401) {
          throw new ApiError(401, null, 'Worker token rejected (revoked or invalid)');
        }

        if (res.status === 204) {
          return undefined as T;
        }

        if (res.ok) {
          return (await res.json()) as T;
        }

        const errorBody = await res.json().catch(() => null);
        // 4xx (excepto 401) — no retry, error del cliente.
        if (res.status >= 400 && res.status < 500) {
          throw new ApiError(res.status, errorBody, `${method} ${path} → ${res.status}`);
        }

        // 5xx — retry con backoff exponencial.
        if (attempt < maxAttempts) {
          const backoffMs = baseBackoffMs * Math.pow(2, attempt - 1);
          logger.warn(
            { event: 'api.retry', endpoint: path, attempt, maxAttempts, backoffMs, status: res.status },
            'Retrying after server error',
          );
          await sleep(backoffMs);
          continue;
        }
        throw new ApiError(res.status, errorBody, `${method} ${path} → ${res.status} after ${maxAttempts} retries`);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        // Network error (fetch rejected) — retry con backoff.
        if (attempt < maxAttempts) {
          const backoffMs = baseBackoffMs * Math.pow(2, attempt - 1);
          logger.warn(
            { event: 'api.retry', endpoint: path, attempt, maxAttempts, backoffMs, error: (err as Error).message },
            'Network error, retrying',
          );
          await sleep(backoffMs);
          continue;
        }
        throw new ApiError(0, null, `Network error: ${(err as Error).message}`);
      }
    }
    // Unreachable, but TypeScript requiere return.
    throw new ApiError(0, null, 'Exhausted retries');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
