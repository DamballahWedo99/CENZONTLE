# Troubleshooting

Common errors when bringing CENZONTLE up, and how to fix them. If your case is not
here, read the `pnpm dev` logs (web and api) and the Swagger UI at
`http://localhost:3001/api/docs`.

---

## 503 when you open the app

**Symptom:** every route returns 503 / an error screen when you open
`http://localhost:3000`.

**Cause:** Auth0 is not configured. The web middleware **fails closed** when
`AUTH0_DOMAIN`, `AUTH0_SECRET`, `AUTH0_CLIENT_ID`, or `AUTH0_CLIENT_SECRET` is
missing. There is no dev bypass.

**Fix:** fill `apps/web/.env.local` with all the `AUTH0_*` values and restart
`pnpm dev`. See [auth0-setup.md](auth0-setup.md).

---

## I can log in, but everything is read-only

**Cause:** the JWT carries no role. Either the post-login **Action is not deployed**,
or your user has no `app_metadata.role`. The API guard downgrades any token whose role
claim is missing or unrecognized to `viewer`, so you get read access and nothing else.

**Fix:** deploy the Action (step 3 of [auth0-setup.md](auth0-setup.md)) and set
`{ "role": "alta_gerencia" }` in the user's `app_metadata`. Log in again — log out
first, so the token is refreshed.

---

## `relation "..." does not exist` / the API blows up on queries

**Cause:** migrations not applied, so the tables don't exist. Typical right after
cloning, or after adding new models.

**Fix:**
```bash
pnpm --filter @cenzontle/api exec prisma migrate deploy
```
If you added models while the process was already running, **restart `pnpm dev`** so
the reloaded Prisma client sees the tables. See [database.md](database.md).

---

## `pnpm install` fails with `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`

**Cause:** you ran `pnpm install` before creating `apps/api/.env`. The API's
`postinstall` runs `prisma generate`, which loads `apps/api/prisma.config.ts`; that
file resolves `DATABASE_URL` strictly and aborts when it is missing. The install
isn't broken — the order is.

**Fix:** create the `.env` files and install again.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm install
```

`prisma generate` opens no connection, so `DATABASE_URL` only has to exist and be a
valid postgres URL — the database does not have to be up yet.

---

## `PrismaConfigEnvError` on `pnpm dev` or any `prisma` command

**Symptom:** the same abort as above, but outside `pnpm install`:

```
Cannot resolve environment variable: DATABASE_URL.
```

`pnpm dev` and `pnpm dev:api` hit it too, because the API workspace runs
`prisma generate` in its `predev` hook before Nest ever starts.

**Cause:** `apps/api/.env` is missing, or it has no `DATABASE_URL`. Every Prisma CLI
entry point loads `apps/api/prisma.config.ts`, which resolves the variable strictly.

**Fix:**
```bash
cp apps/api/.env.example apps/api/.env
```
Then check that `DATABASE_URL` points at your Postgres — with Docker, the default
value already works.

> Older Prisma versions reported this as `Environment variable not found:
> DATABASE_URL`. That message can no longer appear: `schema.prisma` declares the
> datasource with no `url`, so the connection string comes from `prisma.config.ts`
> for the CLI and from the adapter at runtime. Search for `PrismaConfigEnvError`
> instead.

---

## `Can't reach database server at localhost:5432`

**Cause:** Postgres isn't up, or there's a port conflict.

**Fix:**
```bash
docker compose up -d postgres
docker compose ps          # confirm it says "running"
lsof -i :5432              # is a NATIVE Postgres holding the port?
```
If a native Postgres and Docker are fighting over `:5432`, read
[database.md › Dual Postgres](database.md#dual-postgres-native-vs-docker). Short
version: use only one, or map the container to `:5433` and adjust `DATABASE_URL`.

---

## The frontend loads but API calls fail (401 / 403)

**Symptom:** the app renders, but requests through `/api/proxy/...` come back 401 or
403.

Read the message in the response body first — it tells you which layer rejected you.

- **401 `Invalid access token`** (from the API) — the JWT did not verify. Almost
  always `AUTH0_AUDIENCE` or `AUTH0_ISSUER_URL` in `apps/api/.env` disagreeing with
  what Auth0 minted, or a token that simply expired. `AUTH0_AUDIENCE` must be
  **identical** in `apps/web/.env.local` and `apps/api/.env`, and equal to the API
  Identifier in Auth0. Fix it, log out, and log back in.
- **401 `Missing access token`** (from the API) — the request arrived without an
  `Authorization: Bearer` header, which means you're calling the backend directly
  instead of going through the BFF proxy.
- **403 `Insufficient permissions` / `Insufficient role`** — you authenticated fine,
  but your role doesn't carry the permission the endpoint requires. See
  [I can log in, but everything is read-only](#i-can-log-in-but-everything-is-read-only):
  a token with no usable role claim is downgraded to `viewer`.
- **403 from a vault endpoint** — Pod membership and the vault's role map, not the
  RBAC permission set. `VaultAccessGuard` denies you when your `pod_ids` claim
  intersects none of the vault's allowed Pods
  (`No tienes acceso a este vault. Tu pod no está en la lista de pods permitidos.`),
  and again when the vault's role map is configured and your role is absent from it
  or set to `none` (`Tu rol no tiene acceso configurado para este vault.`). The
  `pod_ids` claim comes from the same post-login Action as the role.

For 401s the Next.js proxy emits itself rather than forwarding, see
[The frontend proxy returns 401 or 502](#the-frontend-proxy-returns-401-or-502).

> **`Invalid access token` never tells you which of its causes fired.** The guard
> wraps the whole verification in one `try` and rethrows a single message
> (`apps/api/src/modules/auth/guards/jwt-auth.guard.ts:45-74`), so expiry and a
> misconfigured audience are indistinguishable from the response. Rule out the cheap
> one first — log out, log back in, retry — before you start diffing `.env` files.

---

## The AI agents don't generate anything (epics/stories/diagrams)

**Symptom:** every generation stream fails immediately. The SSE error event carries the
message you see in the UI — one string per surface, same prefix:

```
Anthropic API key no configurada. Configúrala en /factory/settings antes de generar épicas.
Anthropic API key no configurada. Configúrala en /factory/settings antes de generar historias.
Anthropic API key no configurada. Configúrala en /factory/settings antes de generar diagramas.
```

Grep for `Anthropic API key no configurada` and you catch all of them. Each generation
service also logs that line under its own tag (`[EpicGen]`, `[StoryGen:PO]`,
`[DiagramAgent]`, …), with the underlying exception in the `err` field. Don't be
thrown by the wording of that inner message: it comes from
`OrgAnthropicConfigService.getApiKeyPlaintext()`, which is shared with the worker
claim path and therefore talks about workers processing stories. Same root cause.

**Cause:** no Anthropic API key is stored. The backend reads that key **only** from
the database, encrypted — `ANTHROPIC_API_KEY` in `apps/api/.env` is not a fallback for
agent work, and setting it there changes nothing.

**Fix:** log in with the senior-management role (`alta_gerencia`) and paste the key in
Settings ("Configuración") → Automatización → **Anthropic API Key**
(`/factory/settings?section=anthropic-key`). It is encrypted server-side with
`VAULT_ENCRYPTION_KEY`.

---

## Encryption error / I can't save tokens or the Anthropic key

**Cause:** `VAULT_ENCRYPTION_KEY` is missing from `apps/api/.env`.

**Fix:** generate one and restart:
```bash
openssl rand -base64 32   # paste it into VAULT_ENCRYPTION_KEY
```
Don't change it after encrypting data: rotating it invalidates everything already
encrypted.

---

## `pnpm install` fails or uses the wrong package manager

**Cause:** the repo pins `packageManager: pnpm@9.15.0`. npm and yarn do not install
this monorepo correctly.

**Fix:** `corepack enable` (it ships with Node) or `npm i -g pnpm@9.15.0`, then
`pnpm install`. Node itself must be 22 or newer — the version in `.nvmrc`.

---

## `prisma generate` / stale Prisma types

**Cause:** the Prisma client wasn't regenerated after a schema change.

**Fix:** `pnpm --filter @cenzontle/api exec prisma generate`, then restart the dev
server — a live Node process caches the old client in memory.

---

## `pnpm build` fails

Two causes account for almost every case.

**`@cenzontle/shared` can't be resolved.** `apps/web` and `apps/api` both import the
shared package from its built `dist/`, which does not exist in a fresh clone or after
`pnpm clean`. `pnpm build` handles this on its own — the turbo tasks declare
`dependsOn: ["^build"]`, so `packages/shared` compiles first. You only hit the failure
when you invoke a workspace script **directly**, which bypasses turbo's task graph:

```bash
pnpm --filter @cenzontle/web build     # fails on a clean tree
pnpm --filter @cenzontle/shared build  # build the dependency first, then retry
```

That is exactly why the root `dev`, `dev:web`, and `dev:api` scripts prefix
`pnpm --filter @cenzontle/shared build`.

**The Prisma client was never generated.** `apps/api` has no `prebuild` hook, so
`nest build` assumes `prisma generate` already ran during `postinstall`. If that
aborted with `PrismaConfigEnvError` (see above), the generated model types are absent
and the API build fails on `@prisma/client`. Fix the `.env`, run
`pnpm --filter @cenzontle/api exec prisma generate`, then build again.

---

## The worker won't connect (401 / 404 / http rejected)

- **401** → the token is invalid or revoked. Generate another one in Settings →
  Infraestructura → **Nodos de cómputo** ("Compute nodes")
  (`/factory/settings?section=nodes`) with the **Generar** ("Generate") button on the
  node's row, then re-register. If the worker was already running, it logs
  `Token rejected mid-flight — was the token revoked? Exiting.` and exits.
- **404** → the node was retired in the dashboard (`Node has been retired in
  dashboard — exiting`). Create it again and run `register`.
- **http rejected** → the worker refuses a non-HTTPS dashboard URL. For local dev,
  set `FACTORY_WORKER_ALLOW_INSECURE=1`. Never in production: secrets travel in
  cleartext.

See [forge-worker.md](forge-worker.md).

---

## The worker is online but no story moves (`Sandbox unavailable`)

**Symptom:** `factory-worker start` comes up without errors and the node shows
**online** in Settings → **Nodos de cómputo**, but every story it claims dies
immediately. In the worker logs:

```
Sandbox unavailable — aborting run before spawn
No sandbox available on linux and FACTORY_WORKER_ALLOW_NO_SANDBOX is not '1'.
```

**Cause:** the sandbox tool is missing. The worker wraps every spawn of `claude` with
`sandbox-exec` (macOS) or `firejail` (Linux); when it finds neither, the mode resolves
to `none` and it **refuses to run**. That is deliberate: `claude` runs with
`--dangerously-skip-permissions`, and without isolation a prompt injection in the
epic's markdown can read the host's `~/.ssh`, `~/.aws`, or `~/.config/gh`.

It's confusing because the check happens **when each run spawns**, not when the daemon
starts — which is why the node looks healthy.

**Fix (Linux):** install firejail and restart the worker.

```bash
sudo apt install firejail     # Debian/Ubuntu
sudo dnf install firejail     # Fedora
sudo pacman -S firejail       # Arch
```

On macOS `sandbox-exec` ships with the system; if you still see the error, check that
`FACTORY_WORKER_SANDBOX_MODE` isn't forced to `none`.

> **Don't "fix" this with `FACTORY_WORKER_ALLOW_NO_SANDBOX=1`.** That variable exists
> for disposable dev environments and disables the project's only isolation control.
> Details: [forge-worker.md › Sandbox](forge-worker.md#sandbox-running-generated-code).

---

## `FACTORY_WORKER_SANDBOX_MODE` seems to have no effect

**Cause:** the value isn't one of the three accepted ones. The worker recognizes
`sandbox-exec`, `firejail`, and `none` **exactly**; anything else — a typo, or a mode
that doesn't exist like `nix` — is **silently ignored** and falls through to
auto-detection.

**Fix:** correct the value. When a run starts, the log states which mode ended up
active and where it came from (`source: env_override` vs `auto_detect`).

---

## The frontend proxy returns 401 or 502

These come from the Next.js BFF (`/api/proxy/...`), not from the backend:

- **401 `No access token in session — check Auth0 audience config`** → the Auth0
  session carries no access token. Nearly always `AUTH0_AUDIENCE`: it must be
  **identical** in `apps/web/.env.local` and `apps/api/.env`, and match the API
  Identifier in Auth0. Log out and back in after fixing it.
- **401 `Not authenticated — session expired or missing`** → the session expired; log
  in again.
- **503 `Authentication service not configured`** → the `AUTH0_*` variables are
  missing on the web side (the same case as the 503 above).
- **502 `Proxy error: backend unreachable`** → the API isn't up, or
  `API_INTERNAL_URL` points somewhere wrong. Check that `pnpm dev:api` is running on
  the port that variable names; the web console prints the real cause
  (`ECONNREFUSED`, `ENOTFOUND`, …) prefixed with `[proxy] fetch error`.

---

## The Playwright e2e suite fails or times out

The suite lives in `apps/web/e2e/`. It does **not** run in CI — it needs a browser and
a running app — so a fresh clone hits these in order.

**`Executable doesn't exist` on the first run.** Install the browser once:

```bash
pnpm --filter @cenzontle/web test:e2e:install   # Chromium only
pnpm --filter @cenzontle/web test:e2e
```

**`Timed out waiting 240000ms` on the `api` server.** Playwright starts **two**
servers, not one: the API on `:3001` and the web app on `:3000`. It waits for
`/api/health` on the API for up to 240 s and for the web app for up to 120 s. On a
cold clone `nest start --watch` compiles the whole project and `predev` runs
`prisma generate` first, so the first run really can take minutes. If it times out for
good, read the piped API output — it is the fastest way to see a Postgres connection
failure.

**Tests fail with 500s even though the servers came up.** PostgreSQL must be running
and `apps/api/.env` must have `DATABASE_URL`. Playwright cannot resolve this for you,
and a green `/api/health` does **not** prove the database is reachable: that endpoint
is `@Public()` and returns `{ status: "ok", timestamp }` without touching Prisma.

**Port conflicts, or you want to reuse a server you already have.** Outside CI,
`reuseExistingServer` is on, so running the suite while `pnpm dev` is already up
reuses those processes instead of fighting for the ports. To point the suite at
servers on other ports, set `WEB_PORT`, `PLAYWRIGHT_BASE_URL`, and `API_INTERNAL_URL`
— the last one determines both the URL the tests hit and the port Playwright binds
the API to. Set `PLAYWRIGHT_SKIP_WEBSERVER` to skip the auto-start entirely.

**The upload roundtrip suite is skipped.** That is expected: it needs a real JWT with
`MANAGE_BRANDING` in `BRANDING_TEST_BEARER`. See
[apps/web/e2e/README.md](../apps/web/e2e/README.md) for how to get one.

---

## Branding / asset upload fails

**Cause:** MinIO/S3 isn't configured, or the bucket doesn't exist.

**Fix:** `docker compose up -d minio minio-init` — the init service creates the
`cenzontle-documents` bucket. In production, set the `S3_*` variables to point at AWS
S3 or R2.

---

## Redis warnings in the logs

**Not critical.** Without Redis the rate limiter **fails open** (it stops blocking)
and the proposal caches always miss, so epic, story, and diagram generation still
work — they just lose their streaming state on a reload, and assistant chat sessions
don't survive a restart. To silence the warnings: `docker compose up -d redis`.

---

## Port 3000 or 3001 is already in use

**Cause:** another instance is running.

**Fix:** kill the process (`lsof -i :3000` / `:3001` → `kill <pid>`) or change the
port — `PORT` for the API, `PORT` or `next dev -p 3002` for the web app — adjusting
the Auth0 callback URLs and `NEXT_PUBLIC_API_URL` / `API_INTERNAL_URL` /
`CORS_ORIGIN` to match.
