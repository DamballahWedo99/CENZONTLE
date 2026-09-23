# E2E Tests (Playwright)

End-to-end tests of the CENZONTLE frontend with Playwright 1.57.

## Prerequisites

Playwright starts the servers for you, but it cannot provision these. Do them
once before your first run.

1. **PostgreSQL running, and `apps/api/.env` with a valid `DATABASE_URL`.** The
   API process boots without a database and `/api/health` still answers `200`:
   `HealthController.check()` returns a static payload and never touches Prisma
   (`apps/api/src/health.controller.ts:16-18`). Playwright polls that endpoint to
   decide the API is ready, so **a green `/api/health` does not prove the
   database is reachable**. Without it the suite starts anyway and every branding
   endpoint fails later with a 500.
2. **Build the shared package at least once**, from the repo root:

   ```bash
   pnpm --filter @cenzontle/shared build
   ```

   `branding-settings.spec.ts` imports `@cenzontle/shared`, which resolves to
   `./dist/index.js`, and nothing builds it for you — that workspace has no
   `postinstall`. Skip this and the suite fails at import time, before a single
   test runs.

## Commands

```bash
# From apps/web
pnpm test:e2e:install     # Install Chromium (first time only)
pnpm test:e2e             # Run the whole suite (headless)
pnpm test:e2e:headed      # With a visible browser
pnpm test:e2e:ui          # Interactive UI mode (debugging)
pnpm test:e2e --grep public  # Only the tests that need no auth
```

Playwright starts **two** dev servers for you: the API (NestJS, port 3001) and
the web app (Next.js, port 3000). If you already have `pnpm dev` running, it
reuses those instances instead of fighting for the ports — that applies to both.

## Available suites

### `branding-settings.spec.ts`
Covers the brand identity module:

- **Public API** (no auth): the GET contract, 404/400 handling in the proxy
- **Upload roundtrip** (needs a JWT with MANAGE_BRANDING): POST → GET → byte equality
- **UI smoke** (no auth): `<link rel="icon">` and `<title>` derived from the singleton

### Environment variables

| Variable | Default | Use |
|---|---|---|
| `WEB_PORT` | 3000 | Port the Next.js dev server binds to, and the port `PLAYWRIGHT_BASE_URL` falls back to |
| `API_INTERNAL_URL` | `http://localhost:3001` | Backend URL the tests hit directly **and** the source of the port Playwright binds the API to — the config derives `API_PORT` from this URL (`playwright.config.ts:31`), so the two can never diverge |
| `PLAYWRIGHT_BASE_URL` | `http://localhost:$WEB_PORT` | Base URL for `page.goto()` (`playwright.config.ts:23`) |
| `BRANDING_TEST_BEARER` | (empty) | JWT with MANAGE_BRANDING for the protected tests |
| `BRANDING_TEST_ORIGIN` | `http://localhost:3000` | `Origin` header the `callProtected` helper sends with every authenticated request (`branding-settings.spec.ts:31`, `:48`). The branding controller runs a same-origin check, so a value outside the API's allowlist turns the whole protected suite into 403s. The CSRF test does not use this — it sends its own `https://attacker.example.com` and asserts the 403 (`:295-307`), so it keeps passing and hides the misconfiguration |
| `PLAYWRIGHT_SKIP_WEBSERVER` | (empty) | If set, Playwright starts **neither** server and assumes both are already up |

## Getting a test JWT (BRANDING_TEST_BEARER)

1. Log in to the app as **Alta Gerencia** ("senior management")
2. Open DevTools → Network
3. Trigger any action (e.g. a branding PATCH)
4. Find the `/api/proxy/branding-settings` request and copy the `Authorization`
   header (without the `Bearer ` prefix)

```bash
BRANDING_TEST_BEARER="eyJhbG..." pnpm test:e2e
```

## Fixtures

`fixtures/png-builder.ts` generates 1×1 PNGs in memory from base64. That keeps
the fixtures immutable and portable (no diffs from line endings or git autocrlf)
and avoids committing binaries to the repo. SVG was dropped from the backend
allowlist (vector XSS) — see `BRANDING_ASSET_CONSTRAINTS.acceptedMimeTypes` in
`packages/shared/src/types/branding-settings.ts`.

## CI

**The e2e suite does not run in GitHub Actions.** `.github/workflows/ci.yml`
runs type-check, unit tests (Jest in `apps/api`, Vitest in `apps/web` and
`apps/worker`) and the production build. Playwright hangs off a separate script
and is deliberately left out, because it needs the app up and a browser
(`.github/workflows/ci.yml:60-62`). Run it locally.

The config does carry a CI mode, keyed on the `CI` environment variable
(`playwright.config.ts:39-45`), ready for whenever the suite gets wired into a
pipeline:

- `forbidOnly` — a stray `test.only` fails the run instead of silently skipping the rest
- `retries: 2` — to tolerate network flakiness
- `workers: 1` — to avoid resource contention
- `reuseExistingServer: false` — always start fresh servers
- Reporters `github` + `html`

`trace: 'on-first-retry'` is on in both modes: traces are recorded only on
retries, so failures stay diagnosable without inflating artifacts.
