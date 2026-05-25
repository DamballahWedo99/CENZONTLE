import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración de Playwright para E2E tests del frontend CENZONTLE.
 *
 * Best practices 2026 aplicadas:
 *  - `webServer` arranca api+web automáticamente y reusa instancias dev
 *    si ya están corriendo (no doble-instancia cuando el dev está local).
 *  - `fullyParallel: true` — cada test corre en su propio browser context
 *    para isolation.
 *  - `forbidOnly` en CI — previene `test.only` accidentalmente comiteado.
 *  - `trace: 'on-first-retry'` — graba trace SOLO en reintentos para no
 *    inflar storage en CI (el viewer es muy útil para debug post-mortem).
 *  - `actionTimeout` agresivo (10s) — fuerza tests rápidos y bien selectorizados.
 *  - Chromium-only por default — los otros browsers se habilitan via
 *    --project=firefox si se necesitan cross-browser.
 *
 * Reuse del dev server: en local, si `pnpm dev` ya corre, Playwright no
 * arranca un segundo instance. En CI, siempre arranca uno limpio.
 */

const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Carpeta para snapshots de assertions visuales — checked in.
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{arg}{ext}',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    // Solo grabamos trace en reintentos — produce un .zip pesado por test
    // que infla artifacts si lo activamos siempre. En retry SÍ lo queremos
    // para diagnosticar flakiness.
    trace: 'on-first-retry',
    // Screenshot SOLO en fallos — debugging visual sin inflar storage.
    screenshot: 'only-on-failure',
    // Video grabado solo en fallos (con compresión por default).
    video: 'retain-on-failure',
    // Timeout corto por acción — fuerza selectores robustos. Si una
    // acción tarda más de 10s, casi siempre es un selector ambiguo o
    // un loading state mal manejado.
    actionTimeout: 10_000,
    // Navigation timeout más generoso porque Next.js dev server tiene
    // primera compilación lenta cuando el test toca rutas no compiladas.
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Habilitar otros browsers cuando sea necesario:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit',  use: { ...devices['Desktop Safari'] } },
  ],

  /**
   * Auto-start de dev servers. `reuseExistingServer: true` permite correr
   * `pnpm test:e2e` mientras `pnpm dev` ya está activo sin conflicto de
   * puertos. En CI siempre arranca uno fresco.
   *
   * El comando `pnpm dev` corre desde la raíz del monorepo via Turbo, que
   * arranca api + web simultáneamente. Espera a que el frontend responda
   * en `http://localhost:3000` antes de empezar los tests.
   */
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'pnpm --filter @cenzontle/web dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
