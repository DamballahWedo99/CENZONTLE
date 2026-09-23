import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the CENZONTLE frontend E2E tests.
 *
 * Choices worth knowing about:
 *  - `webServer` starts api+web automatically and reuses running dev
 *    instances (no second instance when you already have dev up locally).
 *  - `fullyParallel: true` — each test runs in its own browser context
 *    for isolation.
 *  - `forbidOnly` on CI — catches a `test.only` committed by accident.
 *  - `trace: 'on-first-retry'` — records a trace ONLY on retries, to keep CI
 *    storage down (the viewer is very useful for post-mortem debugging).
 *  - Aggressive `actionTimeout` (10s) — forces fast, well-targeted tests.
 *  - Chromium only by default — enable the other browsers with
 *    --project=firefox when you need cross-browser coverage.
 *
 * Dev server reuse: locally, if `pnpm dev` is already running, Playwright does
 * not start a second instance. On CI it always starts a clean one.
 */

const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${WEB_PORT}`;

// Same env var (and same default) the BFF proxy and the specs consume:
// `apps/web/src/app/api/proxy/[...path]/route.ts` and `e2e/branding-settings.spec.ts`.
// The suite hits the backend DIRECTLY, so the API has to be up.
const API_BASE_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
// `main.ts` listens on `process.env.PORT || 3001`, so we derive the port from
// the same URL the tests fetch against — they cannot drift apart.
const API_PORT = new URL(API_BASE_URL).port || '3001';

export default defineConfig({
  testDir: './e2e',
  // Folder for visual assertion snapshots — checked in.
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
    // Trace only on retries — it produces a heavy .zip per test that bloats
    // artifacts if always on. On a retry we DO want it, to diagnose flakiness.
    trace: 'on-first-retry',
    // Screenshot ONLY on failure — visual debugging without bloating storage.
    screenshot: 'only-on-failure',
    // Video recorded only on failure (compressed by default).
    video: 'retain-on-failure',
    // Short per-action timeout — forces robust selectors. An action that takes
    // more than 10s is almost always an ambiguous selector or a mishandled
    // loading state.
    actionTimeout: 10_000,
    // More generous navigation timeout, because the Next.js dev server has a
    // slow first compile when a test touches routes that are not built yet.
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Enable the other browsers when you need them:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit',  use: { ...devices['Desktop Safari'] } },
  ],

  /**
   * Dev server auto-start. These are TWO independent processes, not one:
   *
   *  - **API (NestJS, :3001)** — the `Branding API — public read` suite fetches
   *    the backend directly (`${API_INTERNAL_URL}/api/branding-settings`),
   *    bypassing the BFF; and the UI suites read the backend singleton to know
   *    which favicon/title to expect in the HTML. Without the API up, the
   *    public part of the suite cannot pass in a clean clone.
   *  - **Web (Next.js, :3000)** — serves the `/api/branding/asset/*` proxy
   *    routes and the pages `page.goto()` opens.
   *
   * `reuseExistingServer: true` (everywhere except CI) lets you run
   * `pnpm test:e2e` while you already have `pnpm dev` up by hand: Playwright
   * sees the port is taken and reuses that instance instead of fighting for it.
   * On CI it always starts fresh processes.
   *
   * PREREQUISITE Playwright cannot resolve for you: the API needs PostgreSQL
   * running and `apps/api/.env` with `DATABASE_URL`. Without the database the
   * process still starts, but the endpoints return 500 and the tests fail.
   * See `apps/web/e2e/README.md`.
   */
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : [
        {
          // Prefixes the logs with `[api]` — with two servers, the default
          // `[WebServer]` makes it impossible to tell which one threw.
          name: 'api',
          command: 'pnpm --filter @cenzontle/api dev',
          // `/api/health` (HealthController) is `@Public()` + `@SkipThrottle()`:
          // readiness polling neither consumes the throttler budget nor depends
          // on the database answering to report "up".
          url: `${API_BASE_URL}/api/health`,
          reuseExistingServer: !process.env.CI,
          // Far more generous than the frontend's: `nest start --watch`
          // compiles the WHOLE TS project and `predev` runs `prisma generate`
          // first. On a cold clone that easily passes two minutes.
          timeout: 240_000,
          env: { PORT: API_PORT },
          // `main.ts` calls `enableShutdownHooks()` so `PreviewModule` kills its
          // child dev servers on the way down. With Playwright's default
          // SIGKILL that hook never runs and orphan processes keep holding
          // ports.
          gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
          // Unlike the frontend: the API logs through pino, which writes to
          // STDOUT. With 'ignore', a Postgres connection failure (the #1 failure
          // mode here) would be swallowed and you would only see
          // "Timed out waiting 240000ms".
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          name: 'web',
          command: 'pnpm --filter @cenzontle/web dev',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          // `next dev` honors `PORT`; without this, `WEB_PORT` only changed the
          // URL Playwright waited on, not the port the server came up on.
          env: { PORT: String(WEB_PORT) },
          stdout: 'ignore',
          stderr: 'pipe',
        },
      ],
});
