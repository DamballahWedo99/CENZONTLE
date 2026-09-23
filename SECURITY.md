# Security policy

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting:

**[→ Report a vulnerability](https://github.com/DamballahWedo99/CENZONTLE/security/advisories/new)**

That opens a private channel between you and the maintainers. The report stays hidden
until a fix exists.

Include as much of this as you can:

- Which component it affects (`apps/web`, `apps/api`, `apps/worker`) and at which version or commit.
- The steps to reproduce it. A repro we can run is worth more than a long description.
- The impact you see: what someone abusing this can read, modify or run.
- If you have an idea for the fix, say it.

**What to expect:** this project is maintained by a small number of people with limited
time. We aim to acknowledge receipt within a week and to agree a disclosure window with
you based on severity. If you get no answer, follow up — it's not disinterest.

There is no bug bounty program.

---

## Before you report: what we already know

CENZONTLE is a platform that **runs AI-generated code**. Several things that look like
vulnerabilities are deliberate, documented design decisions. These are **not** new
findings:

- The worker runs `claude` with `--dangerously-skip-permissions`
  (`apps/worker/src/lib/runner.ts`, `apps/worker/src/lib/dod-verifier-agent.ts`). That
  is intentional: the agent has to work without asking for confirmation on every
  action. **The real isolation comes from the OS sandbox, not from the CLI.**
- `FACTORY_WORKER_ALLOW_NO_SANDBOX=1` disables that isolation. It is a deliberate
  double opt-in (see below).
- `FACTORY_WORKER_ALLOW_INSECURE=1` allows a plain-HTTP `dashboardUrl`
  (`apps/worker/src/lib/api-client.ts`).
- A short list of API routes carries `@Public()` and skips the JWT guard on purpose:
  the health check, the two read-only branding endpoints the login screen needs before
  anyone is signed in, and the worker routes, which authenticate with a worker token
  instead. They are enumerated in
  [Authentication and authorization](#authentication-and-authorization).

What we **do** want you to report: ways to **escape** the sandbox, bypass the role or
Pod guards, read another tenant's secrets, injection (SQL, command, prompt) that
escalates privileges, or any route that exposes the encrypted secrets in the database.

---

## Security model

> [!WARNING]
> The Forge downloads instructions from a server, hands them to a language model and
> **runs the resulting code on your machine**, with your Git credentials and network
> access. Treat it with the same care you'd give a self-hosted CI runner. The project
> management app (`apps/web` + `apps/api`) works perfectly **without** bringing up any
> worker; if you only want to explore the platform, don't start one.

### Isolation of generated code

The worker wraps every run with the operating system's native sandbox
(`apps/worker/src/lib/sandbox.ts`):

| Mode | Platform | When it is used |
|---|---|---|
| `sandbox-exec` | macOS | Auto-detected (SBPL profile) |
| `firejail` | Linux | Auto-detected if installed |
| `none` | any | Only with an explicit **double** opt-in |

Running without a sandbox takes `FACTORY_WORKER_SANDBOX_MODE=none` **and**
`FACTORY_WORKER_ALLOW_NO_SANDBOX=1`. If the second one is missing, the worker **aborts
every run right before spawning `claude`**: the daemon starts and heartbeats normally,
but no story moves. That friction is intentional — without isolation, a prompt
injection in a story's content can read the host's credentials (`~/.ssh`, `~/.aws`,
`~/.config/gh`).

On Linux, `firejail` is not installed by default. If you don't install it
(`apt install firejail`), the worker resolves the mode to `none` and stops on every run
instead of running unprotected.

The full mode table, the detection order and the sandbox's known limits are in
[forge-worker.md › Sandbox](docs/forge-worker.md#sandbox-running-generated-code).

### The live terminal

`/factory/agents/<id>/terminal` gives an operator an interactive Claude Code session in
the browser. It is a real shell on the machine running `apps/api`, so treat it as one:

- The API spawns `ttyd` in writable mode wrapping a `tmux` session that runs `claude`
  (`apps/api/src/modules/factory/terminal.service.ts`). Anything that shell can do, the
  API process can do.
- Every `/factory/terminal/*` endpoint requires the `alta_gerencia` role
  (`apps/api/src/modules/factory/terminal.controller.ts`).
- **The `ttyd` port itself carries no authentication.** It binds to `127.0.0.1` on a
  port between 7681 and 7999, and the browser loads that URL straight into an iframe.
  Anything that can reach loopback on the API host — another local process, an SSH port
  forward, a misconfigured reverse proxy — gets the shell without ever passing the role
  check.
- The working directory is rejected if it contains `..` and is confined to
  `AGENT_WORKDIR_ROOT`, but that variable defaults to `/`, which disables the
  containment check.
- Session start and stop are appended to `~/.cenzontle/terminal-audit.jsonl`
  (`TERMINAL_AUDIT_DIR` overrides the directory). Each entry records the agent id, the
  port, the workdir and the branch — **not which user opened the session**.

Keep the API host's loopback interface closed to anything you don't trust.

### Secrets

- GitHub tokens, Anthropic API keys and *external secrets* are stored **encrypted in
  the database** with AES-256-GCM, not in `.env`
  (`apps/api/src/modules/vault/crypto.service.ts`). The master key is
  `VAULT_ENCRYPTION_KEY`.
- **Rotating `VAULT_ENCRYPTION_KEY` invalidates everything already encrypted.** It is
  not a hot rotation: it requires re-encrypting.
- Generate every secret with real entropy (`openssl rand -base64 32` /
  `openssl rand -hex 32`). Don't reuse values across environments.
- The values in `docker-compose.yml` (`cenzontle_dev`) are **for local development
  only**. Never use them on a machine reachable from a network.

### Authentication and authorization

Auth0 is mandatory and there is **no development bypass** for signing in. If it isn't
configured, the web middleware fails closed with a 503 instead of letting the request
through (`apps/web/src/middleware.ts`).

Every API route is authenticated by default. `JwtAuthGuard` is registered as a global
`APP_GUARD`, followed by `RolesGuard` and `PermissionsGuard`
(`apps/api/src/modules/auth/auth.module.ts`). It verifies the Auth0 access token
against the tenant's JWKS and rejects everything else with a 401
(`apps/api/src/modules/auth/guards/jwt-auth.guard.ts`). The browser never talks to the
API directly: the BFF proxy in `apps/web` takes the user's own Auth0 access token out
of their session and forwards it as `Authorization: Bearer`
(`apps/web/src/app/api/proxy/[...path]/route.ts`), so the backend applies that user's
real role on every request.

Three sets of routes opt out with `@Public()`, and none of them are unauthenticated by
accident:

| Route | Why it is public |
|---|---|
| `GET /health` | Liveness check; returns no data (`apps/api/src/health.controller.ts`) |
| `GET /branding-settings` and `GET /branding-settings/asset/:type` | The login screen needs the logo and the title before anyone is signed in. The response drops `updatedBy` so an anonymous caller can't harvest an Auth0 `sub` (`apps/api/src/modules/branding-settings/branding-settings.controller.ts`) |
| `/factory/workers/*` | Workers have no human session. They present a `worker_…` bearer token, which `WorkerAuthGuard` resolves by SHA-256 hash. The guard also demands `@WorkerRoute()` and throws 401 when it is missing, so a `@Public()` route can never end up with no authentication at all (`apps/api/src/modules/factory/fleet/worker-auth.guard.ts`) |

Access control combines the roles (`AltaGerencia`, `ProductOwner`, `TechLead`, `QA`,
`Viewer`) with Pod filtering, and the high-consequence approvals — the three epic
sign-offs, both Forge gates and DEV branch alignment — additionally require step-up
authentication. See [`docs/authorization.md`](docs/authorization.md) for the full
role × permission matrix and the vault access rules.

> [!WARNING]
> Step-up authentication is the one control that does **not** fail closed outside
> production. With `AUTH0_M2M_CLIENT_ID` / `AUTH0_M2M_CLIENT_SECRET` unset and
> `NODE_ENV` set to anything other than `production`, password verification logs a
> `[DEV BYPASS]` warning and returns success without ever contacting Auth0
> (`apps/api/src/modules/auth/auth.service.ts`). Under `NODE_ENV=production` the same
> path throws a 503 instead. The switch is `NODE_ENV` alone — a staging box that
> forgets to set it accepts any password. Details:
> [auth0-setup.md › Step-up authentication](docs/auth0-setup.md#5-optional-step-up-authentication-and-user-management).

### Before exposing this to a network

This project is designed and tested for **local development**. If you are going to
deploy it:

- [ ] TLS everywhere; never `FACTORY_WORKER_ALLOW_INSECURE`.
- [ ] Sandbox enabled on every worker; never `FACTORY_WORKER_ALLOW_NO_SANDBOX`.
- [ ] `VAULT_ENCRYPTION_KEY` generated with real entropy and kept out of the repo.
- [ ] `NODE_ENV=production` plus real `AUTH0_M2M_CLIENT_ID` / `AUTH0_M2M_CLIENT_SECRET`, or step-up authentication silently accepts any password.
- [ ] The API host's loopback interface closed to untrusted processes and port forwards — the live terminal's `ttyd` ports listen there without authentication.
- [ ] With multiple API replicas, a **shared Redis**: the rate limiter keeps its counters there (`REDIS_HOST` / `REDIS_PORT`), and without a shared instance the limits are per replica instead of global.
- [ ] Postgres and S3 bucket credentials different from the ones in `docker-compose.yml`.
- [ ] Workers on disposable machines, with minimally scoped Git tokens.

### Costs

The agents consume the Anthropic API with **your** API key. An enqueued epic launches
several agents in parallel, and the DoD verifier retries on failure, which roughly
doubles the cost of that story each time. Start with one small story and check the
**Cost** dashboard in the Factory before you enqueue large work. Those figures are
client-side SDK estimates, not billing — read them as orders of magnitude.

---

## Scope

**In scope:** the code in this repository — `apps/web`, `apps/api`, `apps/worker`,
`packages/*`.

**Out of scope:** vulnerabilities in third-party dependencies (report them upstream; if
they affect us directly, tell us anyway), in Auth0, Anthropic, GitHub or your
infrastructure provider, and any problem that follows from running the project with the
guardrails deliberately disabled.
