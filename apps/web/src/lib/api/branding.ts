import type { BrandingAssetType, BrandingSettings } from '@cenzontle/shared';
import { apiFetch, ApiError } from './client';

const LOG_PREFIX = '[Branding UI]';

/**
 * Helper para extraer un hint accionable de errores del backend. El backend
 * (PrismaExceptionFilter) ahora devuelve un campo `hint` en dev cuando el
 * error es accionable (tabla missing, conexión Postgres rechazada, etc.).
 * Lo extraemos y loggeamos como warn para que el dev lo vea en DevTools.
 */
function logApiError(method: string, path: string, err: unknown, startedAt: number): void {
  const elapsed = Date.now() - startedAt;
  if (err instanceof ApiError) {
    console.error(
      `${LOG_PREFIX} ${method} ${path} → ${err.status} (${elapsed}ms): ${err.message}`,
      err,
    );
    // Mensaje genérico de "Error de base de datos" → hint accionable. Solo
    // si estamos en dev (Next.js expone NODE_ENV).
    if (err.status === 503 && err.message?.includes('Tabla') && err.message?.includes('no existe')) {
      console.warn(
        `${LOG_PREFIX} 💡 HINT: La tabla de branding no existe. Aplica la migración:\n` +
          `   pnpm --filter @cenzontle/api exec prisma migrate deploy`,
      );
    }
    if (err.status === 503 && err.message?.includes('Base de datos no disponible')) {
      console.warn(
        `${LOG_PREFIX} 💡 HINT: Postgres no responde. Arranca el contenedor:\n` +
          `   docker compose up -d postgres`,
      );
    }
  } else {
    console.error(`${LOG_PREFIX} ${method} ${path} — non-ApiError after ${elapsed}ms`, err);
  }
}

/**
 * Cliente del API de branding.
 *
 * GET: el endpoint backend es PÚBLICO, pero pasamos por BFF proxy igual
 *      desde el cliente (la auth del proxy es transparente para endpoints
 *      `@Public`). Para SSR del layout raíz existe `fetchBrandingSettingsSSR`
 *      que hace un fetch directo al backend con `API_INTERNAL_URL` (no
 *      requiere session de Auth0).
 *
 * PATCH/POST/DELETE: requieren MANAGE_BRANDING (Alta Gerencia). Pasan por
 *      BFF proxy con el access token del usuario.
 *
 * Logging strategy: solo loggeamos errores en consola del browser (visible
 * en DevTools, ayuda a usuarios y soporte). El success path es silencioso
 * para no pollute la consola del usuario final en producción — DevTools
 * Network tab ya muestra status + latencia del request.
 */
export async function getBrandingSettings(): Promise<BrandingSettings> {
  const startedAt = Date.now();
  try {
    return await apiFetch<BrandingSettings>('/branding-settings');
  } catch (err) {
    logApiError('GET', '/branding-settings', err, startedAt);
    throw err;
  }
}

export async function updateBrandingSettings(patch: {
  companyName?: string;
}): Promise<BrandingSettings> {
  const startedAt = Date.now();
  try {
    return await apiFetch<BrandingSettings>('/branding-settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  } catch (err) {
    logApiError('PATCH', '/branding-settings', err, startedAt);
    throw err;
  }
}

/**
 * Sube un asset (logo, logoCollapsed, favicon). Usa FormData — el BFF proxy
 * forwarda el body raw con content-type multipart/form-data al backend.
 *
 * IMPORTANTE: NO setear Content-Type manualmente en headers — fetch lo
 * autocompleta con el boundary correcto al usar FormData. Si lo seteamos
 * manualmente, multer no puede parsear y rechaza con 400.
 */
export async function uploadBrandingAsset(
  type: BrandingAssetType,
  file: File,
): Promise<BrandingSettings> {
  const form = new FormData();
  form.append('file', file);
  const startedAt = Date.now();
  try {
    const res = await fetch(`/api/proxy/branding-settings/upload/${type}`, {
      method: 'POST',
      body: form,
      // Sin Content-Type override — fetch genera multipart/form-data con boundary.
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      if (res.status === 401 && typeof window !== 'undefined') {
        window.location.href = '/auth/login';
        return new Promise<never>(() => {});
      }
      throw new ApiError(res.status, body.message || res.statusText);
    }
    return (await res.json()) as BrandingSettings;
  } catch (err) {
    logApiError('POST', `/branding-settings/upload/${type}`, err, startedAt);
    throw err;
  }
}

export async function deleteBrandingAsset(
  type: BrandingAssetType,
): Promise<BrandingSettings> {
  const startedAt = Date.now();
  try {
    return await apiFetch<BrandingSettings>(`/branding-settings/asset/${type}`, {
      method: 'DELETE',
    });
  } catch (err) {
    logApiError('DELETE', `/branding-settings/asset/${type}`, err, startedAt);
    throw err;
  }
}

/**
 * Fetch SSR-only — server component del layout raíz lo usa para hidratar
 * el branding ANTES de Auth0 (el favicon debe estar en el HTML inicial).
 *
 * **Cache strategy**: `cache: 'no-store'` (siempre fresh). Esto es
 * INTENCIONAL y NECESARIO para consistencia entre páginas client/server:
 *
 *  - Páginas client (factory/*) usan `useDocumentTitle()` que lee el
 *    `BrandingContext` — reactivo, refleja cambios instantáneamente.
 *  - Páginas server (/proyectos, /proyectos/matriz, etc.) heredan el title
 *    template del layout raíz, que se construye desde este fetch.
 *
 * Si cacheamos este fetch 60s, las páginas server muestran el companyName
 * VIEJO mientras las páginas client ya muestran el nuevo → inconsistencia
 * visible en las pestañas del navegador al navegar entre rutas.
 *
 * Con `no-store`: cada navegación a una página server hace 1 round-trip al
 * backend (~20-50ms en local). El costo es bajo porque:
 *  - El backend tiene cache in-memory 15s (`BrandingSettingsService.cached`)
 *  - El round-trip es localhost en dev, intra-cluster en prod
 *  - El admin cambia el branding rara vez (1-2 veces / año típicamente)
 *
 * Failure modes (todos retornan null para que el layout caiga a defaults):
 *  - Backend caído (`fetch` reject)
 *  - Network timeout (≥3s)
 *  - Migración no aplicada → backend 503 con mensaje accionable (loggeamos hint)
 *  - 5xx genérico
 *
 * Loggeamos en server-side stdout (visible en pino logs) con contexto
 * suficiente para que el operador diagnostique sin reproducir.
 */
export async function fetchBrandingSettingsSSR(): Promise<BrandingSettings | null> {
  const apiBase = process.env.API_INTERNAL_URL || 'http://localhost:3001';
  const url = `${apiBase}/api/branding-settings`;
  const startedAt = Date.now();
  try {
    // AbortController con timeout 3s — si el backend está colgado, el SSR
    // del layout no debe quedar bloqueado más de eso (degrada a defaults).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(url, {
      // 'no-store' — ver doc-block del método para razón (consistencia con
      // useDocumentTitle reactive). El backend tiene cache 15s in-memory
      // que absorbe el load extra.
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message = body?.message ?? res.statusText;
      const hint = body?.hint;
      // WARN visible en server stdout (pino lo captura). Frontend Next.js
      // SSR no debe inflar logs en cada navigation, pero un fallback al
      // default es señal real de que algo del backend no responde bien —
      // siempre la queremos en prod para que el operador note el degraded.
      console.warn(
        `${LOG_PREFIX} SSR fetch ${url} → ${res.status} (${Date.now() - startedAt}ms): ${message}` +
          (hint ? `\n${LOG_PREFIX} 💡 ${hint}` : '') +
          `\n${LOG_PREFIX} Falling back to static defaults (/Logo.svg, /Imagotipo.svg).`,
      );
      return null;
    }
    // Success silencioso — happy path en cada SSR navigation, sin valor de audit.
    return (await res.json()) as BrandingSettings;
  } catch (err) {
    const errorObj = err as Error & { name?: string };
    const isAbort = errorObj.name === 'AbortError';
    console.warn(
      `${LOG_PREFIX} SSR fetch ${url} ${isAbort ? 'TIMED OUT' : 'FAILED'} after ${Date.now() - startedAt}ms — ${errorObj.message}\n` +
        `${LOG_PREFIX} Falling back to static defaults. ${
          isAbort
            ? 'Check that the API backend is responsive.'
            : 'Check that the API backend is running at ' + apiBase + '.'
        }`,
    );
    return null;
  }
}
