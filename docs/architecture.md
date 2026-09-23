# Architecture

Explanation of how CENZONTLE fits together: the monorepo, the three apps, the external
services and the Forge flow. To *run* it, go to [getting-started.md](getting-started.md);
this is the *why* and the *how it connects*. For the vocabulary, see
[glossary.md](glossary.md).

---

## The monorepo

Turborepo + pnpm workspaces. Three deployable applications and three internal
packages:

```
apps/
  web/      Next.js 16 — UI + BFF proxy to the API
  api/      NestJS 11  — REST + SSE + Prisma + AI agents
  worker/   CLI        — the Forge fleet (factory-worker)
packages/
  shared/        shared domain types (tsup → CJS + ESM + .d.ts)
  ts-config/     base tsconfig (base / nextjs / nestjs)
  eslint-config/ shared ESLint config
```

`@cenzontle/shared` is the **type boundary**: everything web, api and worker share
(Factory models, auth, endpoint contracts) lives there. That is why `pnpm dev` builds
`shared` first — everything else depends on its output.

**Turbo pipeline** (`turbo.json`): `dev` is `persistent` and depends on `^build`
(dependencies build first); `build`, `lint`, `test` and `type-check` are cached and
also depend on `^build`. Two global keys:

- `globalDependencies` — `**/.env.*local`. Changing one of those files invalidates
  every task's cache.
- `globalPassThroughEnv` — `FORGE_PAUSED`, `FORGE_EXECUTION_MODE`,
  `FACTORY_WORKER_ALLOW_INSECURE`, `FACTORY_WORKER_ALLOW_NO_SANDBOX`,
  `FACTORY_WORKER_SANDBOX_MODE`, `CLAUDE_BIN`, `PUBLIC_API_URL`. These are forwarded
  into task processes **and deliberately excluded from the cache hash**.

Read that second bullet carefully: a variable listed in `globalPassThroughEnv` does
**not** invalidate anything. Change one and re-run a cached task and Turbo will happily
replay the previous output. If a run must observe a new value, use `--force`.

---

## The three apps

### `apps/web` — Frontend + BFF

Next.js 16 (App Router) + React 19 + Tailwind 4 + Radix UI. The browser never talks to
the API directly: every call goes through a **BFF proxy** (Backend-for-Frontend) route
handler running on the Next server
(`apps/web/src/app/api/proxy/[...path]/route.ts`). The proxy pulls the user's Auth0
access token out of the session and forwards it to the API as
`Authorization: Bearer <token>` (`route.ts:110`), so the API sees the real user on
every request — there is no shared web↔api secret in the request path.

The middleware **fails closed**: if Auth0 is not configured it answers 503 to
everything (`apps/web/src/middleware.ts`), JSON for `/api/*` and an HTML error page for
pages. If a session is missing it redirects to `/auth/login`.

Visualizations use D3 and XYFlow (epic diagrams) with elkjs for layout; the text editor
is Tiptap; state is React Context (no Redux, no Zustand).

### `apps/api` — Backend

NestJS 11, organized **one module per feature** under `apps/api/src/modules/`:

| Module | What it owns |
| --- | --- |
| `proyectos` | Initiatives, epics, stories, Pods, sprints, story DAG, diagrams, the editing assistant, the executive summary, the in-product changelog, vault sync |
| `factory` | The Forge: `fleet`, `queue`, `execution`, `dod`, `qa`, `preview`, `github`, `prs`, `cost`, `velocity`, `logs`, `metrics`, `branch-strategy`, `agent-tools`, `authz`, plus the terminal controller |
| `auth` | Auth0 JWT verification and the three global guards |
| `vault` | The GitHub-backed knowledge base |
| `code-repositories` | Repositories the agents clone and search |
| `documents` | Attachments and text extraction |
| `integrations` | External providers and their encrypted tokens |
| `external-secrets` | Third-party API keys, encrypted at rest |
| `org-anthropic-config` | The Anthropic API key, encrypted at rest |
| `agent-token-settings` | Per-agent model, effort and token settings |
| `branding-settings` | Logo, colors and login-screen branding |
| `diagram-theme-settings` | Diagram themes |
| `prisma`, `redis` | Infrastructure modules |

There is **no `aprobacion` module and no `reportes` module**. `aprobacion.ts` and
`reportes.ts` exist only as type files in `packages/shared/src/types/`; the epic
sign-offs are served by `proyectos/epics` (`epics.controller.ts`) and reporting is
read-time aggregation inside `factory` (`cost`, `velocity`, `metrics`).

Persistence is Prisma 7 over PostgreSQL (the `@prisma/adapter-pg` driver adapter).
Agent output streams to the browser over **SSE** (`text/event-stream`), not WebSocket —
`socket.io` is still in `package.json` but no gateway exists. Structured logging with
pino. Swagger is mounted at `/api/docs` **only when `NODE_ENV !== 'production'`**
(`main.ts:52`); in production the route does not exist.

The AI agents (epic, story and diagram generation, the assistant, the Forge planner,
QA) call the Anthropic API. The Anthropic key, the GitHub tokens and the external
secrets are stored **encrypted in the database** (AES-256-GCM under
`VAULT_ENCRYPTION_KEY`), not in `.env`.

### `apps/worker` — the Forge fleet (optional)

The `factory-worker` CLI (Commander). Each worker is a machine that registers as a
*compute node* and polls to **claim stories** (`claim-story`), implements them by
running **Claude Code in headless mode**, opens pull requests, and reports progress and
completion. You do not need it to run the project-management side of the app. Details:
[forge-worker.md](forge-worker.md).

---

## External services

| Service | What for | Local dev |
|---|---|---|
| **PostgreSQL** | All persistence (Prisma) | Docker `:5432` |
| **Redis** | Shared rate limiter (throttler) + AI proposal and assistant-session caches | Docker `:6379` |
| **MinIO / S3** | Branding assets and documents | Docker `:9000` |
| **Auth0** | Identity (OIDC) — login, roles, step-up authentication | Cloud tenant |
| **Anthropic** | Every AI agent | API key (in the database, set from the UI) |
| **GitHub** | Knowledge vault + code repositories + Forge pull requests | Tokens (in the database, set from the UI) |

---

## Ports

| Port | Service |
|---|---|
| 3000 | web (Next.js) |
| 3001 | api (NestJS) — Swagger at `/api/docs` outside production |
| 5432 | PostgreSQL |
| 6379 | Redis |
| 9000 / 9001 | MinIO (API / console) |

---

## Auth and roles

Auth0 issues the JWT; a **post-login Action** injects `role` and `pod_ids` as custom
claims under the `https://cenzontle.app` namespace
(`apps/api/src/modules/auth/guards/jwt-auth.guard.ts:52-67`).

Protection is global and opt-out, not opt-in. `AuthModule` registers three `APP_GUARD`
providers that run on every request (`auth.module.ts:11-13`):

1. `JwtAuthGuard` — verifies the token against Auth0's JWKS, checks issuer and
   audience, and attaches the user.
2. `RolesGuard` — enforces `@Roles(...)`.
3. `PermissionsGuard` — enforces `@RequirePermissions(...)`.

A fourth global guard, `AuthAwareThrottlerGuard`, sits in front of them
(`app.module.ts:174-177`) and buckets rate limits by `req.user.sub` when the request is
authenticated, falling back to the IP for anonymous ones.

Exactly three things skip the JWT guard, each with `@Public()`:

- the health endpoint (`health.controller.ts:11`);
- two branding endpoints — the public branding settings and the asset stream — because
  the login screen has to render before anyone is authenticated
  (`branding-settings.controller.ts:53,141`);
- the worker API routes, which do not carry an Auth0 session at all. They combine
  `@Public()` with `@WorkerRoute()` and `WorkerAuthGuard`, which authenticates the
  worker token instead (`worker-api.controller.ts:50-136`). That guard **fails closed**:
  a `@Public()` route that reaches it without `@WorkerRoute()` is refused with 401
  (`worker-auth.guard.ts:44-50`).

Five roles: `alta_gerencia` (senior management — full access), `product_owner`,
`tech_lead`, `qa`, `viewer`. Data access is filtered by **Pod** membership — a user
only sees what belongs to their Pods, except `alta_gerencia`. Pods are managed in
Settings ("Configuración") → Ecosistema → **Células** ("Pods")
(`/factory/settings?section=pods`). Setup: [auth0-setup.md](auth0-setup.md).

---

## The Forge (software factory) — the life of a story

An epic that has collected its three sign-offs (Product Owner, Tech Lead, QA) is
enqueued with the **Enviar al Forge** ("Send to the Forge") button, which turns it into
a batch:

```
Epic with 3 sign-offs ─▶ Enviar al Forge (enqueue)
        │
        ▼
   In Queue ─▶ Forge ────────────▶ Staged ────────▶ QA Testing ──────▶ Released
   (waiting)   workers implement   the Tech Lead    multi-agent QA     the human
               the stories         approves the     campaign:          release gate
               (Claude Code),      consolidated     4 lenses in        approves the
               verify the DoD,     PR merge         parallel →         rollout
               open PRs            into DEV         adversarial
                                                    verification →
                                                    QAReport
```

- **Parallel claiming:** workers claim stories with `FOR UPDATE ... SKIP LOCKED`
  (`agent-run.service.ts:939`), honoring the hard edges of the story DAG (waves). One
  active run per story comes from that atomic SQL, not from a database constraint: the
  partial unique index `agent_runs_story_active_unique` is documented in
  `apps/api/prisma/schema.prisma:889-896` as raw SQL to run by hand, and **no migration
  in `apps/api/prisma/migrations/` creates it** — a database built from the migrations
  does not have it. What the schema declares is a plain, non-unique
  `@@index([storyId, status])` (`schema.prisma:905`). If you want the safety net, create
  the index yourself.
- **Definition of Done (DoD) verifier:** once the generator finishes, a separate agent
  verifies the DoD (tests, lint, security, acceptance criteria) with a retry loop and
  doom-loop detection.
- **QA pipeline** (the `QA Testing` stage): on merge to DEV, a campaign fans out four
  lenses (the repository's own suite, e2e against an ephemeral preview environment,
  differential security, perf/a11y), verifies the findings adversarially (refuters that
  vote), and synthesizes a `QAReport` with a rollout-or-rollback recommendation for a
  human gate.
- **Human gates:** staging (merge to DEV) and release (rollout) both require step-up
  authentication — re-entering your password — and the `tech_lead` or `alta_gerencia`
  role.

---

## Design decisions worth knowing

- **Secrets encrypted in the database, not in the environment.** The Anthropic key, the
  GitHub tokens and the external secrets are encrypted with `VAULT_ENCRYPTION_KEY` and
  configured from the UI — you can rotate them without a redeploy.
- **Stage derived from timestamps**, never stored as a status enum. A batch's stage is
  computed from `Epic` fields (`enqueuedAt`, `stagingApprovedAt`,
  `consolidatedPrMergedAt`, `qaStartedAt`, `qaCompletedAt`, `releaseApprovedAt`), with
  later timestamps taking precedence (`factory/qa/qa-stage.ts:19-24`). The API returns
  the raw timestamps and the frontend derives the kanban column
  (`factory-queue.service.ts:635-647`).
- **Plural data in tables, scalars on the owner.** Runs (`AgentRun`, `QaLensRun`) are
  tables; terminal milestones live as timestamps on the `Epic`.
- **Acyclic modules.** NestJS module dependencies are kept acyclic. When a feature would
  close a cycle it gets split into its own module instead: the velocity calibration fed
  back into the Product Owner agent lives in `VelocityCalibrationModule`, importable
  from `ProyectosModule` without dragging in `FactoryModule`
  (`factory/velocity/velocity-calibration.module.ts:7`).
