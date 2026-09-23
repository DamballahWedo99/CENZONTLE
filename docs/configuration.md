# Configuration — environment variable reference

Reference for every environment variable the code actually reads, and for the external
services behind them. To get running fast, use the `.env.example` files and
[Getting Started](getting-started.md); this page is the source of truth when you need
the detail. Domain words used below (Forge, vault, worker, batch, gate) are defined in
the [glossary](glossary.md).

**Where they go:**

- `apps/api/.env` — backend (NestJS). Loaded by `ConfigModule.forRoot({ isGlobal: true })`.
- `apps/web/.env.local` — frontend (Next.js).
- The worker reads **no `.env` file**. `apps/worker/.env.example` documents its runtime
  flags, but nothing loads them into the process: export them in the shell or the
  service unit that runs `factory-worker`. Everything about the connection itself is
  set by `factory-worker register`, not by env vars.

One more thing about the worker's flags: when you run through Turbo (`pnpm dev`), a
variable only reaches the child process if it is listed in `globalPassThroughEnv` in
`turbo.json`. Today that list holds `FORGE_PAUSED`, `FORGE_EXECUTION_MODE`,
`FACTORY_WORKER_ALLOW_INSECURE`, `FACTORY_WORKER_ALLOW_NO_SANDBOX`,
`FACTORY_WORKER_SANDBOX_MODE`, `CLAUDE_BIN` and `PUBLIC_API_URL`. Set anything else on
the process directly.

Legend: **REQ** = required · **OPT** = optional · 🔒 = secret (never commit).

The `Default` column is what the **code** falls back to when the variable is absent —
not what the `.env.example` files happen to suggest. A `—` means there is no fallback.

---

## PostgreSQL — `apps/api`

| Variable | | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` 🔒 | **REQ** | — | Prisma connection string. Dev (Docker): `postgresql://cenzontle:cenzontle_dev@localhost:5432/cenzontle` |

## Encryption at rest — `apps/api`

| Variable | | Default | Purpose |
|---|---|---|---|
| `VAULT_ENCRYPTION_KEY` 🔒 | **REQ** | — | Master secret for AES-256-GCM. Encrypts every secret stored in the database (GitHub token, code repos, external secrets, Anthropic API key). **Generate it with `openssl rand -base64 32`** and treat it as a random secret, not a passphrase: `CryptoService` derives the 32-byte key with scrypt over a *fixed, public* salt (`cenzontle:vault:v1`), so anyone holding a database dump can attack a memorable phrase offline. The code only enforces a 16-character floor, which is a compile-time guard, not a security recommendation. Rotating it invalidates everything already encrypted. |

`CryptoService` throws in its constructor when the variable is missing or shorter than
16 characters, so the API refuses to start.

## Auth0 — frontend (`apps/web`)

| Variable | | Default | Purpose |
|---|---|---|---|
| `AUTH0_DOMAIN` | **REQ** | — | Tenant domain, without `https://` (`TENANT.auth0.com`) |
| `AUTH0_CLIENT_ID` | **REQ** | — | Client ID of the Regular Web App |
| `AUTH0_CLIENT_SECRET` 🔒 | **REQ** | — | Client Secret of the Web App |
| `AUTH0_SECRET` 🔒 | **REQ** | — | Encryption key for the BFF (Backend-for-Frontend) session (≥32 chars). `openssl rand -hex 32` |
| `APP_BASE_URL` | **REQ** | — | Base URL of the frontend, used for callbacks. Read by the Auth0 SDK itself. Example value: `http://localhost:3000` |
| `AUTH0_AUDIENCE` | **REQ** | — | API Identifier in Auth0, passed as the authorization `audience`. Without it the access token carries no audience and the API rejects every call. Example value: `https://api.cenzontle.app` |
| `AUTH0_M2M_CLIENT_ID` | OPT | — | Machine-to-machine app. Powers the whole Equipo module — see below |
| `AUTH0_M2M_CLIENT_SECRET` 🔒 | OPT | — | Companion of the M2M app |

Miss any of `AUTH0_DOMAIN`, `AUTH0_SECRET`, `AUTH0_CLIENT_ID` or `AUTH0_CLIENT_SECRET`
and the middleware serves a `503 — Auth not configured` page instead of the app.

**What the M2M app does on the web side.** Beyond step-up authentication, the same
credentials mint a token for the Auth0 **Management API** (`apps/web/src/lib/auth0-management.ts`),
and every team-management operation goes through it: list users, read a user's role,
create a user, change a role, change the Pods a user belongs to, block, unblock and
delete. Roles and the Pod list live in the user's `app_metadata`, so the M2M
application must be authorized against `https://TENANT.auth0.com/api/v2/` with grants
to read, create, update and delete users **and** to read and write their
`app_metadata`. Without those grants the token request fails and the Equipo screens
return errors.

## Auth0 — backend (`apps/api`)

| Variable | | Default | Purpose |
|---|---|---|---|
| `AUTH0_ISSUER_URL` | **REQ** | — | Issuer, **with** the trailing slash (`https://TENANT.auth0.com/`) |
| `AUTH0_AUDIENCE` | **REQ** | — | Must match the frontend's. Example value: `https://api.cenzontle.app` |
| `AUTH0_M2M_CLIENT_ID` | OPT | — | Step-up authentication over ROPC. Read the warning below before leaving it empty |
| `AUTH0_M2M_CLIENT_SECRET` 🔒 | OPT | — | Companion of the M2M app |

`AUTH0_ISSUER_URL` and `AUTH0_AUDIENCE` are read with `getOrThrow` in the constructor of
`JwtAuthGuard` (`apps/api/src/modules/auth/guards/jwt-auth.guard.ts:23-24`), and that
guard is registered as a global `APP_GUARD`. Neither has a default: without them the
API does not boot.

> **⚠️ Action required — the step-up bypass outside production.**
> Without `AUTH0_M2M_CLIENT_ID` / `AUTH0_M2M_CLIENT_SECRET`, `/auth/verify-password`
> behaves in two very different ways
> (`apps/api/src/modules/auth/auth.service.ts:88-116`):
>
> - `NODE_ENV=production` → it throws **503** and every sign-off and gate is blocked.
> - Anything else, **including `NODE_ENV` unset** → it logs a `[DEV BYPASS]` warning and
>   **returns `true` without checking the password at all**. Sign-offs and both human
>   gates go through on the session JWT alone.
>
> That is deliberate for local development. It is a hole anywhere else: a staging
> deployment that forgets to set `NODE_ENV=production` inherits the bypass and its
> approvals are not non-repudiable. Set `NODE_ENV=production` on every deployed
> environment, or configure the M2M app.

Step-up also fails closed on transport: if `AUTH0_ISSUER_URL` is not `https://`, the
endpoint returns 503 rather than send the password in cleartext.

> Full Auth0 setup (apps, action, first admin, roles): [auth0-setup.md](auth0-setup.md).

## Redis — `apps/api`

| Variable | | Default | Purpose |
|---|---|---|---|
| `REDIS_HOST` | OPT* | `localhost` | Redis host (rate limiter + cache) |
| `REDIS_PORT` | OPT* | `6379` | Port |
| `PROPOSAL_CACHE_TTL` | OPT | `1800` | TTL in seconds for the epic proposal cache (30 min) |
| `STORY_PROPOSAL_CACHE_TTL` | OPT | `432000` | TTL in seconds for the story proposal cache (5 days). **It does not inherit from `PROPOSAL_CACHE_TTL`** — it is a separate variable with its own, much longer default, sized for a human review window |

\* If Redis is not there, the throttler **fails open** (it does not block) and the cache
misses. Recommended in production with replicas.

## S3 / object storage — `apps/api`

Branding (logo, favicon) and future documents. Dev = MinIO; production = AWS S3 / R2.

| Variable | | Default | Purpose |
|---|---|---|---|
| `S3_ENDPOINT` | OPT | — | Dev: `http://localhost:9000`. AWS: leave empty. R2: `https://<id>.r2.cloudflarestorage.com` |
| `S3_ACCESS_KEY` 🔒 | OPT (REQ in prod) | — | Dev MinIO: `cenzontle`. Falls back to `AWS_ACCESS_KEY_ID` |
| `S3_SECRET_KEY` 🔒 | OPT (REQ in prod) | — | Dev MinIO: `cenzontle_dev`. Falls back to `AWS_SECRET_ACCESS_KEY` |
| `S3_BUCKET` | OPT (REQ in prod) | — | Bucket name. **No default** — the service reads it as an empty string when unset, which counts as missing |
| `S3_REGION` | OPT | `us-east-1` | Region (R2: `auto`). Not part of the startup check |
| `S3_FORCE_PATH_STYLE` | OPT | auto (`true` when the endpoint contains `localhost`) | Path-style URLs (MinIO) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 🔒 | OPT | — | Fallback when the `S3_*` pair is not used |

The three credentials above (`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`) are checked
in `onModuleInit`. With `NODE_ENV=production` a missing one throws and the API does not
boot; anywhere else it logs a warning, the API starts, and any upload fails until you
configure it.

## Anthropic (Claude) — `apps/api`

**There is no environment variable for this.** Paste the key in
Settings ("Configuración") → Automatización → **Anthropic API Key**
(`/factory/settings?section=anthropic-key`); it is stored encrypted in the
`OrgAnthropicConfig` singleton.

`OrgAnthropicConfigService.getApiKeyPlaintext()` queries only the database and throws
`NotFoundException` when nothing is stored — there is no branch that reads
`process.env.ANTHROPIC_API_KEY`, so putting the key in `apps/api/.env` has no effect.
The name is a real environment variable in exactly one place: the worker receives the
decrypted key inside the claim payload and sets `ANTHROPIC_API_KEY` on the `claude`
child process. It is also a reserved name for external secrets — you cannot shadow it
from Settings → Integraciones → **Secretos externos** ("External secrets")
(`/factory/settings?section=external-secrets`).

## Vault GitHub — `apps/api` (optional)

All of this is also configurable in Settings → Integraciones → **Vault**
(`/factory/settings?section=vault`); the env vars only auto-seed a vault named
"Default" at startup so a fresh install is not empty. The neighboring integrations are
separate screens: the Forge repository lives in Settings → Control de código →
**Código** ("Code") (`/factory/settings?section=codigo`), and third-party keys in
Settings → Integraciones → **Secretos externos**.

| Variable | | Default | Purpose |
|---|---|---|---|
| `VAULT_GITHUB_OWNER` | OPT | — | Owner of the vault repository |
| `VAULT_GITHUB_REPO` | OPT | — | Repository name |
| `VAULT_GITHUB_BRANCH` | OPT | `main` | Branch to sync |
| `VAULT_GITHUB_TOKEN` 🔒 | OPT | — | Personal access token. It is encrypted and persisted in the database on first boot; remove it from the environment afterward |

## Code repos (code exploration) — `apps/api` (optional)

| Variable | | Default | Purpose |
|---|---|---|---|
| `CODE_REPOS_DIR` | OPT | `~/.cenzontle/code-repos` | Clone cache used for analysis |
| `CODE_REPOS_MAX_BYTES_PER_FILE` | OPT | `262144` | Per-file limit when grepping |
| `CODE_REPOS_GREP_TIMEOUT_MS` | OPT | `8000` | Grep timeout |
| `CODE_REPOS_AUTO_SYNC_AGE_MS` | OPT | `300000` | Re-pull threshold |

## Frontend / BFF — `apps/web`

| Variable | | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | OPT (REQ in prod) | `http://localhost:3001` | API URL exposed to the browser. Inlined at build time — changing it needs a rebuild |
| `API_INTERNAL_URL` | OPT (REQ in prod) | `http://localhost:3001` | API URL for SSR and the BFF proxy (server-only). The Playwright config also derives the port it binds the API to from this value |
| `NEXT_PUBLIC_PROJECT_ROOT` | OPT | — | Absolute path of the monorepo on the API host — the working directory the embedded Claude Code terminal starts in. It does **not** gate the button: **Abrir Claude Code** ("Open Claude Code") always renders and always opens `/factory/agents/<run id>/terminal` in a new tab (`apps/web/src/components/factory/BatchDetail.tsx:1158-1172`, `:1392-1406`). The destination is what refuses. With the variable empty the terminal skips its auto-start and prints *"Configura la variable NEXT_PUBLIC_PROJECT_ROOT…"* instead of a session — `ClaudeCodeTerminal.tsx:44,100` for a run workspace, `AgentTerminal.tsx:179,186` for the mock workdir. No fallback is compiled in, deliberately: an absolute host path would leak into the browser bundle |

## API runtime — `apps/api`

| Variable | | Default | Purpose |
|---|---|---|---|
| `PORT` | OPT | `3001` | HTTP port of the API |
| `CORS_ORIGIN` | OPT (REQ in prod) | `http://localhost:3000` | Allowed origin (the frontend URL). Also the allowlist — comma-separated — for the branding upload origin check. In production without it that check **fails open**, so set it |
| `NODE_ENV` | OPT (REQ in prod) | — | `development` / `production`. Not cosmetic: it gates the step-up bypass, the `forceCompletion` hard-deny, the S3 startup check and the log level |
| `LOG_LEVEL` | OPT | `debug` (dev) / `info` (prod) | pino level |
| `PUBLIC_API_URL` | OPT (REQ in prod) | `http://localhost:3001` | The **canonical API URL** that Settings → Infraestructura → **Nodos de cómputo** ("Compute nodes") (`/factory/settings?section=nodes`) hands the worker to register with. The worker does not go through the BFF; it needs the NestJS host directly. The default is fine in dev; in production it must be your public URL **over https** (over http the worker refuses to connect unless `FACTORY_WORKER_ALLOW_INSECURE=1`) |

## Factory runtime — `apps/api` (optional, sane defaults)

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_WORKDIR_ROOT` | `/` | Allowed root for agent working directories (restrict this in production) |
| `WORKTREE_ROOT` | `$HOME/.worktrees` | Base directory for Claude Code worktrees |
| `TERMINAL_AUDIT_DIR` | `$HOME/.cenzontle` | Terminal session logs |
| `PREVIEW_BIND_HOST` | `127.0.0.1` | Bind address of the preview server |
| `QA_BIND_HOST` | `127.0.0.1` | Bind address of the QA runner |
| `DESIGN_BUNDLES_DIR` | `~/.cenzontle/design-bundles` | Design bundle cache |
| `DOCUMENTS_DIR` | `~/.cenzontle/documents` | Document storage |
| `VAULT_REPOS_DIR` | `~/.cenzontle/vault-repos` | Local clones of the vault repositories (one subdirectory per vault). In production point this at a persistent volume |
| `STORY_AGENT_CONCURRENCY` | `5` | How many story-generation agents run in parallel. Absent or unparseable → the default `5`; parseable but outside `[1, 10]` → **clamped** into that range (`0` becomes `1`, `999` becomes `10`), with a warning logged. Resolved once in the constructor (`apps/api/src/modules/proyectos/stories/generation/story-generation.service.ts:594-616`). Lower it if the Anthropic API starts rate-limiting you |

## Feature flags and kill switches — `apps/api`

| Variable | Default | Purpose |
|---|---|---|
| `FORGE_PAUSED` | — (enabled) | Blocks claiming of new stories. **Only the exact value `1` works** (`apps/api/src/modules/factory/fleet/agent-run.service.ts:811`). `FORGE_PAUSED=true` pauses nothing and the agents keep burning tokens. When you need this in a hurry, prefer the UI switch in Settings → Infraestructura → **Kill Switch del Forge** (`/factory/settings?section=kill-switch`): it is a database flag, so it survives restarts and does not depend on env propagation |
| `FORGE_EXECUTION_MODE` | auto | Overrides the fleet auto-detect. **The only accepted values are `local` and `remote`** (`apps/api/src/modules/factory/execution/execution-router.service.ts:72`); anything else is logged as an error and discarded, and auto-detect stays on. `local` selects the `local-tmux` executor, `remote` the `remote-worker` one — those are the internal mode names, not valid values for this variable. An active override logs a warning on every routing decision and writes an audit row at boot |
| `DIAGRAM_LAYOUT_PASS_ENABLED` | `true` | Diagram layout pass. Only the exact string `false` disables it |
| `FORGE_ALLOW_FORCE_COMPLETION` | false | Server-side gate for the worker's `forceCompletion` flag, which triggers an **irreversible** squash merge of the pull request, skipping human review. It opens only with the exact value `1` **and** `NODE_ENV !== production`: in production it is always denied and the variable is ignored. Use it only for end-to-end MOCK runs in dev |

## Definition of Done (DoD) verifier and code security — `apps/worker` (optional)

These are read by the **worker**, not by the API — `apps/worker/src/lib/dod-verifier-agent.ts`
and `apps/worker/src/lib/dod-verifier.ts`. The API mentions them only in comments,
because the model and effort it sends inside the claim take precedence; the env vars
are the legacy fallback for when the claim carries nothing. In normal operation you
tune them from Settings → Automatización → **Tokens IA** (`/factory/settings?section=agent-tokens`),
tab **Factory**, and never touch the environment.

| Variable | Default | Purpose |
|---|---|---|
| `DOD_VERIFIER_MODEL` | `claude-haiku-4-5-20251001` | Model for the DoD verifier. Note the dated identifier — `claude-haiku-4-5` is not what the code uses |
| `DOD_VERIFIER_EFFORT` | `low` | Thinking effort of the verifier |
| `DOD_VERIFIER_TIMEOUT_MS` | `90000` | Per-verification timeout |
| `DOD_VERIFIER_MAX_RETRIES` | `2` | Retries on verifier error. `0` disables them |
| `DOD_VERIFIER_RETRY_BASE_MS` | `2000` | Base for the retry backoff |
| `DOD_VERIFIER_BATCH` | `1` | Batch every criterion into one verifier call. `0` falls back to one call per criterion |
| `CODE_SECURITY_MODEL` | `claude-sonnet-4-6` | Model for the `code-security` review |
| `CODE_SECURITY_EFFORT` | `medium` | Thinking effort of that review |
| `CODE_SECURITY_TIMEOUT_MS` | `300000` | Timeout of that review |
| `CODE_SECURITY_DIFF_MAX_BYTES` | `200000` | The diff is truncated past this size |

> **⚠️ Action required — `DOD_VERIFIER_MOCK` is not a debug flag.**
> `DOD_VERIFIER_MOCK=1` does two things. First, it stops the verifier from spawning
> `claude` at all and hardcodes every DoD verdict to passed — nothing is checked
> against the real repository. Second, the runner sets `forceCompletion` on the
> completion payload (`apps/worker/src/lib/runner.ts:3359`), and if the backend gate is
> open (`FORGE_ALLOW_FORCE_COMPLETION=1` and `NODE_ENV !== production`, see
> `apps/api/src/modules/factory/fleet/agent-run.service.ts:2311-2317`) the API performs
> an **irreversible squash merge of the pull request, skipping human review**.
> That is the double opt-in: neither half is dangerous on its own, both together
> auto-merge unverified code. Production denies it unconditionally. Never set it
> anywhere else.

## Worker runtime flags

| Variable | Default | Purpose |
|---|---|---|
| `FACTORY_WORKER_ALLOW_INSECURE` | false | Allows an http dashboard URL (dev only). Requires the exact value `1` |
| `FACTORY_WORKER_SANDBOX_MODE` | auto | Exactly `sandbox-exec` (macOS) / `firejail` (Linux, needs `apt install firejail`) / `none`. Any other value is ignored and falls through to auto-detect |
| `FACTORY_WORKER_ALLOW_NO_SANDBOX` | false | Second opt-in for running without a sandbox. If the mode resolves to `none` and this is not `1`, every run aborts before spawning `claude`. See [forge-worker.md › Sandbox](forge-worker.md#sandbox-running-generated-code) |
| `FACTORY_WORKER_USE_USER_SESSION` | false | Use the Claude Code OAuth session instead of an API key. Requires the exact value `1` |
| `FACTORY_WORKER_PUBLIC_HOST` | `localhost` | Host or IP shown in the UI for the live terminal |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code binary when it is not on `PATH` |
| `CLAUDE_MODEL` / `CLAUDE_EFFORT` | `claude-sonnet-4-6` / `high` | Model and effort for the generator. The backend normally dictates both per story; these only apply when the claim carries nothing |
| `CLAUDE_CODE_OAUTH_TOKEN` 🔒 | — | OAuth token (used when `FACTORY_WORKER_USE_USER_SESSION=1`) |
| `TMUX_BIN` / `TTYD_BIN` | `tmux` / `ttyd` | Binaries behind the live terminal |

> The worker's connection details (dashboard URL, token, node id, slots) live in
> `~/.factory-worker/config.json` after `factory-worker register`, not in the
> environment.

## Test and internal variables

Not needed to run the product. They exist so you are not surprised when you find them
in the code.

| Variable | Default | Purpose |
|---|---|---|
| `WEB_PORT` | `3000` | Port Playwright starts the Next.js server on and expects it at (`apps/web/playwright.config.ts`) |
| `PLAYWRIGHT_BASE_URL` | `http://localhost:$WEB_PORT` | Base URL for `page.goto()` |
| `PLAYWRIGHT_SKIP_WEBSERVER` | — | If set to anything, Playwright starts no server and assumes the API and the web app are already up |
| `BRANDING_TEST_BEARER` 🔒 | — | JWT with the branding-management permission, needed by the protected half of the branding e2e suite. Without it those tests skip |
| `BRANDING_TEST_ORIGIN` | `http://localhost:3000` | `Origin` header the same suite sends |
| `RUN_SECRET_READ_CHECK` | — | Opt-in for `pnpm --filter @cenzontle/api verify:secrets`, the internal check that an external secret really reaches the agent. Requires the exact value `1`, plus a real `ANTHROPIC_API_KEY` in the environment of that script |
| `TEST_EXTERNAL_SECRET` | — | The probe secret that check injects and then asserts the agent could read |
| `CI` | — | Standard CI marker. Playwright reads it to forbid `test.only`, retry twice, run single-worker and never reuse an existing server |

---

## Validation

`ConfigModule.forRoot({ isGlobal: true })` does **not** validate a schema; defaults are
injected at each call site with `config.get<T>(key, fallback)`. So there is no single
startup report of what is missing — failures surface where the variable is used. Three
things do fail loudly at boot: `VAULT_ENCRYPTION_KEY` (throws in `CryptoService`),
`AUTH0_ISSUER_URL` and `AUTH0_AUDIENCE` (`getOrThrow` in the global JWT guard), and the
S3 credentials when `NODE_ENV=production`. Everything else fails at runtime — Prisma
without `DATABASE_URL`, a 503 page without the frontend Auth0 variables. *Future
improvement:* Zod/Joi validation at startup.

## Secrets (never commit)

`DATABASE_URL`, `VAULT_ENCRYPTION_KEY`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`,
`AUTH0_M2M_CLIENT_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `AWS_*`,
`VAULT_GITHUB_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `BRANDING_TEST_BEARER`.
The `.env` and `.env.local` files are in `.gitignore`. The Anthropic key, and the
Linear and Jira keys, are stored **encrypted in the database**, never in the
environment.
