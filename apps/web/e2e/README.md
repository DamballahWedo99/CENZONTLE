# E2E Tests (Playwright)

Tests end-to-end del frontend CENZONTLE con Playwright 1.57.

## Comandos

```bash
# Desde apps/web
pnpm test:e2e:install     # Instalar Chromium (solo la primera vez)
pnpm test:e2e             # Correr suite completo (headless)
pnpm test:e2e:headed      # Con browser visible
pnpm test:e2e:ui          # Modo UI interactivo (debug)
pnpm test:e2e --grep public  # Solo tests que no requieren auth
```

El dev server se arranca automáticamente. Si ya tienes `pnpm dev` corriendo,
se reusa esa instancia.

## Suites disponibles

### `branding-settings.spec.ts`
Cubre el módulo de identidad de marca:

- **API pública** (sin auth): contrato del GET, manejo de 404/400 en el proxy
- **Roundtrip de upload** (requiere JWT con MANAGE_BRANDING): POST → GET → byte equality
- **UI smoke** (sin auth): `<link rel="icon">` y `<title>` derivados del singleton

### Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `WEB_PORT` | 3000 | Puerto del Next.js dev server |
| `API_INTERNAL_URL` | `http://localhost:3001` | URL del backend para tests directos |
| `PLAYWRIGHT_BASE_URL` | `http://localhost:3000` | Base URL para `page.goto()` |
| `BRANDING_TEST_BEARER` | (vacío) | JWT con MANAGE_BRANDING para tests protected |
| `PLAYWRIGHT_SKIP_WEBSERVER` | (vacío) | Si está set, no arranca dev server (asume ya corriendo) |

## Obtener un JWT de test (BRANDING_TEST_BEARER)

1. Loguéate en la app como Alta Gerencia
2. Abre DevTools → Network
3. Ejecuta cualquier acción (e.g. PATCH de branding)
4. Busca el request `/api/proxy/branding-settings` y copia el `Authorization`
   header (sin el prefijo `Bearer `)

```bash
BRANDING_TEST_BEARER="eyJhbG..." pnpm test:e2e
```

## Fixtures

`fixtures/png-builder.ts` genera PNGs 1×1 in-memory desde base64. Mantiene
los fixtures inmutables y portátiles (sin diffs por line endings o git
autocrlf) y evita comitear binarios al repo. SVG fue descartado del allowlist
del backend (vector XSS) — ver `BRANDING_ASSET_CONSTRAINTS.acceptedMimeTypes`
en `packages/shared/src/types/branding-settings.ts`.

## CI

En CI:
- `retries: 2` para tolerar flakiness de la red
- `workers: 1` para evitar resource contention
- `trace: on-first-retry` para diagnosticar fallos sin inflar artifacts
- Reporter `github` + `html`
