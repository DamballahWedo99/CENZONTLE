# API reference

*Reference.* Every HTTP route the NestJS backend (`apps/api`) exposes, what it
does, and what it takes to be allowed to call it.

Until now the only reference for this API was the Swagger UI — which
`apps/api/src/main.ts:52` mounts **only when `NODE_ENV` is not `production`**. In
a production deployment there is no `/api/docs` at all. This file is the
versioned replacement: it lives in git, it survives the environment check, and
it is derived from the route decorators in the source, not from prose.

**Terms** — Forge, batch, wave, gate, sign-off, Pod, vault, worker token, DAG —
are defined in [`glossary.md`](glossary.md). **Roles and permissions** —
`alta_gerencia`, `product_owner`, `tech_lead`, `qa`, `viewer`, and the
permission identifiers used in the tables below — are defined in
[`authorization.md`](authorization.md).

## Contents

- [Scope of this document](#scope-of-this-document)
- [How the API works](#how-the-api-works)
- [`GET /api/health`](#get-apihealth)
- [Endpoint index](#endpoint-index)
- [SSE streaming endpoints](#sse-streaming-endpoints)
- [The worker API](#the-worker-api)
- [Regenerating this reference](#regenerating-this-reference)

---

## Scope of this document

The API declares **180 route handlers across 39 controllers**. That is the count
of `@Get` / `@Post` / `@Put` / `@Patch` / `@Delete` decorators under
`apps/api/src/**/*.controller.ts`, and **every one of them is listed below** — no
module is skipped.

What this document deliberately does *not* cover:

- **Request and response bodies.** The DTOs live next to their controllers in
  `dto/` folders and are validated by class-validator; read them there, or read
  the Swagger UI in a development environment. Documenting 180 payload shapes by
  hand would rot faster than it helps.
- **Query parameters**, except where a parameter changes what an endpoint *is*
  (for example `?includeContent=true`, which makes an entity read also fetch
  markdown from the vault, or `?vaultId=`, which switches the vault endpoints
  into browse mode).
- **Per-endpoint status codes**, except the non-obvious ones (`204` where you
  would expect a body, `202` for fire-and-forget work, `410`/`409` in the worker
  lifecycle).

---

## How the API works

### Base URL and the global prefix

`apps/api/src/main.ts:36` sets a global prefix of `api` with no exclusions, so
**every** route in this document — the health check included — is served under
`/api`. The server listens on `PORT`, defaulting to `3001`
(`apps/api/src/main.ts:63`).

```
http://localhost:3001/api/<route>
```

### Who calls the API

The browser never calls the API directly. The Next.js frontend ships a
Backend-for-Frontend (BFF) proxy at
`apps/web/src/app/api/proxy/[...path]/route.ts`: it reads the user's Auth0
access token out of the session and forwards it as
`Authorization: Bearer <token>` on every proxied request
(`route.ts:89,110`). If the session is missing or expired, the proxy answers
`401` itself and never reaches the backend. So a request the browser makes to
`/api/proxy/proyectos/epicas` arrives at the API as
`GET /api/proyectos/epicas`.

Two kinds of caller bypass the proxy:

- **Forge workers**, which authenticate with a worker token — see
  [The worker API](#the-worker-api).
- **Anything you run by hand** (`curl`, a test harness, another service), which
  must supply its own valid Auth0 access token.

### Authentication

`JwtAuthGuard` is registered as a global `APP_GUARD` in
`apps/api/src/modules/auth/auth.module.ts:11`, so it runs on every route in the
application. It expects an `Authorization: Bearer <jwt>` header, verifies the
token against the Auth0 JWKS endpoint with the configured issuer and audience,
and rejects anything else with `401`
(`apps/api/src/modules/auth/guards/jwt-auth.guard.ts:42-73`).

On success it attaches an `AuthenticatedUser` to the request. `sub` comes from
the standard JWT claim (`jwt-auth.guard.ts:62`); `email`, `name`, `picture`,
`role` and `pod_ids` come from claims namespaced under `https://cenzontle.app`
(`:52`). **An unrecognized role claim silently falls
back to `viewer`** rather than failing the request
(`jwt-auth.guard.ts:54-59`), which is why a misconfigured Auth0 Action shows up
as "everything is read-only" instead of as an auth error.

Routes marked `@Public()` skip this guard entirely. There are exactly eight of
them in the whole application. Three are genuinely unauthenticated —
`GET /api/health` (`health.controller.ts:11`), `GET /api/branding-settings` and
`GET /api/branding-settings/asset/:type`
(`branding-settings.controller.ts:53,141`, so the login screen can render the
logo). The other five are the worker routes
(`worker-api.controller.ts:50,66,93,116,135`), which are public only in the
sense that they escape the *JWT* guard, and are then gated by `WorkerAuthGuard`
instead.

### Authorization

Three layers stack on top of authentication. The tables in the
[Endpoint index](#endpoint-index) name the first two; see
[`authorization.md`](authorization.md) for the full model.

1. **Permission checks.** `PermissionsGuard` (global, `auth.module.ts:13`) reads
   the `@Permissions(...)` decorator on a handler and compares the required
   permissions against the fixed permission set of the caller's role. Missing
   even one is a `403`
   (`apps/api/src/modules/auth/guards/permissions.guard.ts:31-34`).
2. **Role checks.** `RolesGuard` (global, `auth.module.ts:12`) reads `@Roles(...)`.
   Only one controller uses it, at class level:
   `apps/api/src/modules/factory/terminal.controller.ts:120` restricts all eight
   terminal endpoints to senior management. Most Forge management endpoints do
   the equivalent check in code instead, via
   `FactoryAuthzService.assertCanManageFleet`, which throws `403` for any role
   other than `alta_gerencia`
   (`apps/api/src/modules/factory/authz/factory-authz.service.ts:28-34`).
3. **Object-level access.** Reads and writes of planning entities are additionally
   filtered or gated by **Pod intersection**: a caller who is not senior
   management only sees initiatives, epics, stories and batches belonging to a
   Pod they are a member of. This is enforced inside the services, not by a
   decorator, so it does not appear as a column in the tables. Vault reads and
   writes use a dedicated `VaultAccessGuard` instead
   (`apps/api/src/modules/vault/guards/vault-access.guard.ts`).

A fourth control applies to the highest-consequence writes: **step-up
authentication**. The three epic sign-offs, both human gates and the destructive
`align-dev` operation re-verify the caller's password against Auth0 before doing
anything (`epics.service.ts:2329`, `factory-queue.service.ts:1214`,
`qa-gate.service.ts:71`). A wrong password is a `401`, not a `403`.

### Validation and the error format

`apps/api/src/main.ts:41` installs a global
`ValidationPipe({ whitelist: true, transform: true })`. Two consequences worth
knowing:

- Properties that are not declared on the DTO are **stripped silently**, not
  rejected. `forbidNonWhitelisted` is not set, so a typo in a field name gives
  you a successful request that ignored that field, not a `400`.
- Payloads are transformed into DTO class instances, so `@Type`-annotated
  numbers and dates arrive typed.

Validation failures produce the standard NestJS shape, with `message` as an
array of human-readable strings:

```json
{ "statusCode": 400, "message": ["title should not be empty"], "error": "Bad Request" }
```

`PrismaExceptionFilter` is registered globally at `apps/api/src/main.ts:42` and
catches `PrismaClientKnownRequestError` only
(`apps/api/src/common/filters/prisma-exception.filter.ts:27`). It maps database
error codes to semantic HTTP statuses:

| Prisma code | Status | Meaning |
| --- | --- | --- |
| `P2002` | `409` | Unique constraint violated |
| `P2025` | `404` | Record not found |
| `P2003` | `400` | Foreign key points at a record that does not exist |
| `P2021` | `503` | Table does not exist — a migration has not been applied |
| `P2022` | `503` | Column does not exist — schema drift or a stale Prisma client |
| `P2034` | `409` | Serializable transaction conflict — retry the operation |
| `P1001`, `P1002` | `503` | Postgres unreachable or refusing connections |
| anything else | `500` | Generic database error |

The response body is `{ statusCode, message }`, plus a `hint` field with the
exact command to run and a `code` field with the raw Prisma code **only outside
production** (`prisma-exception.filter.ts:126-131`). In production both are
omitted and the message is generic, so the schema is not leaked to a caller.

Note what this filter does *not* cover: it catches known Prisma errors only.
Everything else falls through to the default NestJS exception layer.

### Rate limiting

`@nestjs/throttler` is configured in `apps/api/src/app.module.ts:136-149` with a
single default bucket: **60 requests per minute**
(`app.module.ts:143`). `AuthAwareThrottlerGuard` is the global `APP_GUARD`
(`app.module.ts:175-176`); it buckets by the JWT subject (`u:<sub>`) when the
request is authenticated and falls back to the client IP (`ip:<addr>`) when it
is not (`apps/api/src/common/guards/auth-aware-throttler.guard.ts:22-29`). This
is why `app.set("trust proxy", 1)` at `main.ts:34` matters: without it every
user behind the BFF proxy would share one IP bucket.

Individual endpoints tighten the cap with `@Throttle(...)`. The stricter caps in
force today:

| Cap | Endpoints |
| --- | --- |
| 3/min | `POST /api/vault/connections` |
| 5/min | `POST /api/auth/verify-password`; the three epic sign-offs; `POST /api/factory/queue/enqueue/:epicId`; the story retry; five of the six SSE streams (all but the assistant chat turn) |
| 10/min | `POST /api/proyectos/assistant-chat/:entityType/:entityId` |
| 20/min | `POST /api/proyectos/assistant-chat/session/:sessionId/proposal-feedback` |
| 30/min | Worker `register`, `heartbeat` and `runs/:runId/complete` |
| 60/min | Worker `claim-story` and `runs/:runId/progress` |

`GET /api/health` is exempt via `@SkipThrottle()`
(`apps/api/src/health.controller.ts:12`).

**The counters live in Redis, and the limiter fails open.** Storage is
`ResilientThrottlerStorage` wrapping the Redis-backed store
(`app.module.ts:144-147`). Redis is shared so that the caps stay global across
API replicas instead of degrading to "limit × N replicas". But if Redis is
unhealthy or an increment throws, the wrapper returns a fail-open record and the
request is allowed through — rate limiting switches off rather than taking the
API down with it
(`apps/api/src/common/throttler/resilient-throttler.storage.ts:73-88,96-110`).
The trade-off is deliberate and it is absolute: **while Redis is down, every cap is
off, including the one on password verification.** The degraded state is logged
at most once every 30 s so it is alertable.

### CORS

`apps/api/src/main.ts:37-39` allows a single origin, read from `CORS_ORIGIN` and
defaulting to `http://localhost:3000`.

### Swagger is not available in production

`apps/api/src/main.ts:52` wraps the whole `DocumentBuilder` +
`SwaggerModule.setup` block in `if (process.env.NODE_ENV !== "production")`. In
a production deployment `/api/docs` does not exist and returns a 404 — that is
the intended behavior, not a misconfiguration. Use this file instead, and see
[Regenerating this reference](#regenerating-this-reference) for how to get the
raw OpenAPI spec out of a development instance.

---

## `GET /api/health`

One of the three unauthenticated reads in the application — the other two serve
branding assets to the login screen. It is `@Public()` and
`@SkipThrottle()` (`apps/api/src/health.controller.ts:11-12`), and it returns
exactly this (`health.controller.ts:16-18`):

```json
{ "status": "ok", "timestamp": "2026-08-05T12:34:56.789Z" }
```

`timestamp` is `new Date().toISOString()` at request time. There are no other
fields, and there is no `?verbose` variant.

**If you are wiring a load balancer or a readiness probe, read this
paragraph.** `HealthController` has no constructor and no injected
dependencies — it never touches Prisma, Redis, GitHub or Auth0. A green
`/api/health` proves one thing only: the Node process is up and accepting HTTP.
It does **not** prove that the database is reachable. An API whose Postgres is
down still answers `200` here while every real endpoint answers `503` through
the Prisma filter. Treat it as a liveness probe, not a readiness probe; if you
need readiness, probe an endpoint that actually queries the database.

Note also that the path is `/api/health`, not `/health` — the global prefix
applies. `apps/web/playwright.config.ts:108` uses `/api/health` as its
server-ready check for exactly this reason.

---

## Endpoint index

**How to read the tables.** Paths include the `/api` prefix. The *Authorization*
column names the strongest **declarative** gate on the route:

| Value | Meaning |
| --- | --- |
| `Public` | `@Public()` — no JWT required |
| `JWT` | Any authenticated user; further filtering may happen inside the service |
| `<PERMISSION>` | JWT plus that `@Permissions(...)` requirement |
| `Senior management` | JWT plus a role check for `alta_gerencia`, via `@Roles` or `assertCanManageFleet` |
| `Worker token` | `@Public()` + `@WorkerRoute()` + `WorkerAuthGuard`; these five routes are documented in [The worker API](#the-worker-api) |

Pod-intersection filtering and step-up authentication are **not** in this column,
because they are enforced in service code rather than by a decorator. Where they
apply, the description says so.

### `auth` — `apps/api/src/modules/auth/auth.controller.ts`

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/auth/me` | Current user profile as resolved from the JWT claims | JWT |
| GET | `/api/auth/permissions` | The permission set implied by the caller's role | JWT |
| POST | `/api/auth/verify-password` | Step-up authentication: re-verifies the caller's password against Auth0. Returns `204` on success, `401` on a wrong password. Capped at 5/min | JWT |

### `proyectos` — planning hierarchy

The largest module (69 routes). Grouped below by sub-feature, the same way the
code is (`apps/api/src/modules/proyectos/`).

Note the Spanish path segments — `iniciativas`, `epicas`, `historias` — are
literal route strings and are not translated.

#### Initiatives (`initiatives/initiatives.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/proyectos/iniciativas` | List initiatives. Non-senior-management callers only see initiatives with at least one epic in one of their Pods | JWT |
| GET | `/api/proyectos/iniciativas/:id` | One initiative with its epics. `?includeContent=true` also loads the description from the vault | JWT |
| POST | `/api/proyectos/iniciativas` | Create an initiative | `CREATE_INITIATIVE` |
| PATCH | `/api/proyectos/iniciativas/:id` | Update an initiative | `EDIT_INITIATIVE` |
| DELETE | `/api/proyectos/iniciativas/:id` | Delete an initiative and cascade to its epics. `204` | `DELETE_INITIATIVE` |
| POST | `/api/proyectos/iniciativas/:id/publish-to-tracker` | Publish the initiative to the configured external tracker | `MANAGE_INTEGRATIONS` |

#### Epics (`epics/epics.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/proyectos/epicas` | List epics with optional filters, Pod-filtered for non-admins | JWT |
| GET | `/api/proyectos/epicas/:id` | One epic with its initiative and Pods. `?includeContent=true` loads the markdown from the vault | JWT |
| GET | `/api/proyectos/epicas/:id/discovered-dependencies` | Dependencies discovered by the QA agent, read from the vault — distinct from the manually maintained `epic.dependencies` | JWT |
| GET | `/api/proyectos/epicas/:id/story-dependencies` | The story DAG for this epic: each story with its direct blockers | JWT |
| GET | `/api/proyectos/epicas/:id/coverage-check` | Design-bundle coverage against the stories, plus a `canEnqueue` flag. Degrades without blocking for epics with no bundle | JWT |
| POST | `/api/proyectos/epicas` | Create an epic | `CREATE_EPIC` |
| PATCH | `/api/proyectos/epicas/:id` | Update an epic | `EDIT_EPIC` |
| DELETE | `/api/proyectos/epicas/:id` | Delete an epic. `204` | `DELETE_EPIC` |
| POST | `/api/proyectos/epicas/:id/designs/upload` | Upload a design to the epic's design bundle. `multipart/form-data`, 10 MB limit | `EDIT_EPIC` |
| DELETE | `/api/proyectos/epicas/:id/designs/:designId` | Delete a design and clean up the vault and storage. `204` | `EDIT_EPIC` |
| POST | `/api/proyectos/epicas/:id/publish-to-tracker` | Publish the epic to the external tracker | `MANAGE_INTEGRATIONS` |
| POST | `/api/proyectos/epicas/:id/approvals/po` | Product Owner sign-off. Step-up auth, 5/min | `APPROVE_EPIC_PO` |
| POST | `/api/proyectos/epicas/:id/approvals/tl` | Tech Lead sign-off. Step-up auth, 5/min | `APPROVE_EPIC_TL` |
| POST | `/api/proyectos/epicas/:id/approvals/qa` | QA sign-off. Step-up auth, 5/min | `APPROVE_QA` |

#### Epic generation (`epics/generation/epic-generation.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/proyectos/epic-generation/:initiativeId` | **SSE.** Generate epic proposals with an AI agent. 5/min | `CREATE_EPIC` |
| GET | `/api/proyectos/epic-generation/:initiativeId/cache` | Rehydrate a cached generation session | `CREATE_EPIC` |
| GET | `/api/proyectos/epic-generation/:initiativeId/cache/ttl` | Remaining TTL of that cache | `CREATE_EPIC` |
| DELETE | `/api/proyectos/epic-generation/:initiativeId/cache` | Invalidate the cached session | `CREATE_EPIC` |
| DELETE | `/api/proyectos/epic-generation/:initiativeId/active` | Cancel the running generation. Only the user who started it, or senior management | `CREATE_EPIC` |
| DELETE | `/api/proyectos/epic-generation/:initiativeId/cache/proposals/:clientId` | Drop one proposal from the cache | `CREATE_EPIC` |

#### Executive summary (`initiatives/executive-summary/executive-summary.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/proyectos/executive-summary/:initiativeId` | **SSE.** Generate the executive summary with an AI agent. 5/min | `EDIT_INITIATIVE` |
| GET | `/api/proyectos/executive-summary/:initiativeId/cached` | The last summary persisted on the initiative, or `null` | `EDIT_INITIATIVE` |
| DELETE | `/api/proyectos/executive-summary/:initiativeId/active` | Cancel the running generation | `EDIT_INITIATIVE` |

#### Stories (`stories/stories.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/proyectos/historias` | List stories, filtered by the intersection of the caller's Pods with `story.podId` ∪ `epic.pods` | JWT |
| GET | `/api/proyectos/historias/:id` | One story. `?includeContent=true` loads the markdown from the vault | JWT |
| POST | `/api/proyectos/historias` | Create a story | `CREATE_STORY` |
| PATCH | `/api/proyectos/historias/:id` | Update a story | `EDIT_STORY` |
| DELETE | `/api/proyectos/historias/:id` | Delete a story. `204` | `DELETE_STORY` |
| POST | `/api/proyectos/historias/:id/publish-to-tracker` | Publish the story to the external tracker | `MANAGE_INTEGRATIONS` |

#### Story generation (`stories/generation/story-generation.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/proyectos/story-generation/:epicId` | **SSE.** Generate stories with the Product Owner, Tech Lead and QA agents. 5/min | `CREATE_STORY` |
| GET | `/api/proyectos/story-generation/:epicId/session` | Current session, including an in-flight stream | `CREATE_STORY` |
| DELETE | `/api/proyectos/story-generation/:epicId/session/active` | Cancel the running agent and invalidate the cache. Owner or senior management only | `CREATE_STORY` |
| GET | `/api/proyectos/story-generation/:epicId/cache` | Rehydrate the cached session | `CREATE_STORY` |
| GET | `/api/proyectos/story-generation/:epicId/cache/ttl` | Remaining TTL of that cache | `CREATE_STORY` |
| DELETE | `/api/proyectos/story-generation/:epicId/cache` | Invalidate the cached session | `CREATE_STORY` |
| DELETE | `/api/proyectos/story-generation/:epicId/cache/proposals/:clientId` | Drop one proposed story from the cache | `CREATE_STORY` |

#### Story dependencies (`stories/dependencies/`)

Two controllers share this area. `story-dependencies.controller.ts` is scoped to
one story; `story-dependencies-rollup.controller.ts` is scoped to an epic.

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/proyectos/historias/:storyId/dependencies` | The story's own technical dependencies. Legacy epic-level ones are not included here | JWT |
| POST | `/api/proyectos/historias/:storyId/dependencies` | Create a technical dependency | `EDIT_STORY` |
| PATCH | `/api/proyectos/historias/:storyId/dependencies/:depId` | Update one | `EDIT_STORY` |
| DELETE | `/api/proyectos/historias/:storyId/dependencies/:depId` | Delete one. `204` | `EDIT_STORY` |
| GET | `/api/proyectos/epicas/:epicId/story-dependencies/rollup` | Read-only roll-up that merges the new per-story dependencies with the legacy JSONB + vault ones during the transition | JWT |

#### Pods (`pods/pods.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/proyectos/pods` | List all Pods | JWT |
| GET | `/api/proyectos/pods/:id` | One Pod | JWT |
| POST | `/api/proyectos/pods` | Create a Pod | `MANAGE_INTEGRATIONS` |
| PATCH | `/api/proyectos/pods/:id` | Update a Pod | `MANAGE_INTEGRATIONS` |
| DELETE | `/api/proyectos/pods/:id` | Delete a Pod. `204` | `MANAGE_INTEGRATIONS` |

#### Diagram generation (`diagrams/generation/diagram-generation.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/proyectos/diagram-generation/:epicId` | **SSE.** Generate an epic diagram with an AI agent. 5/min | `CREATE_DIAGRAM` |
| GET | `/api/proyectos/diagram-generation/:epicId/generate-integration-doc` | **SSE.** Backfill: generate the flow document for a diagram that already exists. 5/min | `CREATE_DIAGRAM` |
| GET | `/api/proyectos/diagram-generation/:epicId/cached` | The cached diagram, if any | `CREATE_DIAGRAM` |
| PUT | `/api/proyectos/diagram-generation/:epicId/cached` | Persist an edited diagram to the Redis cache (5-day TTL) | `EDIT_DIAGRAM` |
| PATCH | `/api/proyectos/diagram-generation/:epicId/reset-layout` | Recompute the layout, discarding manual node positions | `EDIT_DIAGRAM` |
| GET | `/api/proyectos/diagram-generation/:epicId/session` | Replay the cached SSE session for a run in flight or finished | `CREATE_DIAGRAM` |
| DELETE | `/api/proyectos/diagram-generation/:epicId/session/active` | Cancel the running generation. Owner or senior management only | `CREATE_DIAGRAM` |

#### Editing assistant (`assistant/assistant-chat.controller.ts`)

`:entityType` is one of `initiative`, `epic` or `story`. The required permission
depends on it, so it cannot be a static decorator — the controller resolves it
at runtime from the same `ROLE_PERMISSIONS` table the global guard uses
(`assistant-chat.controller.ts:49-53,71-77`): `EDIT_INITIATIVE`, `EDIT_EPIC` or
`EDIT_STORY` respectively. Pod intersection is checked on top
(`assistant-chat.controller.ts:87-134`).

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| POST | `/api/proyectos/assistant-chat/:entityType/:entityId` | **SSE.** One chat turn with the editing assistant; may emit edit proposals. 10/min | `EDIT_*` by entity type |
| GET | `/api/proyectos/assistant-chat/:entityType/:entityId/session` | The active session, for rehydrating the transcript after a page reload | `EDIT_*` by entity type |
| POST | `/api/proyectos/assistant-chat/session/:sessionId/proposal-feedback` | Record that a proposal was applied or discarded. 20/min | JWT (session ownership checked in the service) |
| DELETE | `/api/proyectos/assistant-chat/session/:sessionId` | Destroy a chat session | JWT (session ownership checked in the service) |

#### Changelog (`changelog/changelog.controller.ts`)

This is the in-product audit trail, not the repository's `CHANGELOG.md`.

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/proyectos/changelog` | List entries, optionally filtered by `?entityType=` and `?entityId=` | JWT |
| POST | `/api/proyectos/changelog` | Create one entry | `MANAGE_DOCUMENTS` |
| POST | `/api/proyectos/changelog/batch` | Create many entries in one call | `MANAGE_DOCUMENTS` |

#### Vault migration (`migration/vault-migration.controller.ts`)

Administrative one-shots, mounted under `admin/`, not under `proyectos/`.

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| POST | `/api/admin/vault/migration/run` | Migrate every initiative, epic and story from the flat vault layout to the nested one. Idempotent; `409` if a migration is already running | `MANAGE_USERS` |
| POST | `/api/admin/vault/migration/cleanup-orphans` | Delete story folders whose short id matches no story in Postgres. Idempotent | `MANAGE_USERS` |
| POST | `/api/admin/vault/migration/cleanup-legacy-roots` | Delete the legacy `epics/`, `stories/` and `initiatives/` roots. `409` if any row still points at them | `MANAGE_USERS` |

### `factory` — the Forge

51 routes in the `factory` module itself, grouped below by sub-feature to mirror
`apps/api/src/modules/factory/`. One extra sub-section is added at the end for
`org-anthropic-config`, which is a separate NestJS module but is mounted under
the same `factory/` path prefix — 3 more routes, for 54 under `/api/factory` in
total.

#### Queue and gates (`queue/factory-queue.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/factory/queue` | Epics currently in the Forge's `In Queue` stage, Pod-filtered for non-admins | JWT |
| POST | `/api/factory/queue/enqueue/:epicId` | Enqueue an epic as a batch. Validates Pod intersection, complete artifacts (definition, diagram, stories) and all three sign-offs. 5/min | JWT (checked in the service) |
| GET | `/api/factory/queue/:batchId/detail` | Full batch detail for the dashboard: stories and their statuses, active agent runs, aggregated cost and the wave DAG | JWT |
| POST | `/api/factory/queue/:batchId/approve-staging` | **Staging gate.** Merges the consolidated PR into DEV and moves the batch to `Staged`. Requires step-up auth and the Tech Lead or senior-management role (`factory-queue.service.ts:1147`) | JWT + role check in the service |
| POST | `/api/factory/queue/:batchId/stories/:storyId/retry` | Reset a story to `backlog` so a worker re-claims it and runs the full Forge flow again. Spends real tokens. 5/min | JWT (checked in the service) |

#### Fleet (`fleet/fleet.controller.ts`)

Every handler calls `assertCanManageFleet`, so all nine are senior-management
only (`fleet.controller.ts:37,47,60,72,83,94,107,114,126`).

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/factory/nodes` | List non-retired compute nodes with their effective status | Senior management |
| GET | `/api/factory/nodes/active-runs` | Agent runs currently in flight across the fleet | Senior management |
| GET | `/api/factory/nodes/runs/:runId` | One agent run in detail | Senior management |
| POST | `/api/factory/nodes` | Register a compute node. `201` | Senior management |
| PATCH | `/api/factory/nodes/:id` | Rename a node or change its slot count | Senior management |
| DELETE | `/api/factory/nodes/:id` | Retire a node (soft delete, so historical runs survive). `204` | Senior management |
| POST | `/api/factory/nodes/:id/tokens` | Mint a worker token for the node. The plaintext is returned **once**. `201` | Senior management |
| GET | `/api/factory/nodes/:id/tokens` | List the node's tokens — prefix and metadata only, never the plaintext | Senior management |
| DELETE | `/api/factory/nodes/:id/tokens/:tokenId` | Revoke a token. Workers using it get `401` on their next call. `204` | Senior management |

#### Worker API (`fleet/worker-api.controller.ts`)

Five routes, all authenticated with a worker token instead of a JWT. Covered in
detail in [The worker API](#the-worker-api).

#### Definition of Done (`dod/dod.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/factory/dod/criteria` | The DoD catalog ordered by position, disabled criteria included | Senior management |
| PUT | `/api/factory/dod/criteria` | Replace the whole list in one transaction — this is what the settings screen saves | Senior management |
| POST | `/api/factory/dod/criteria/reset-defaults` | Restore the canonical text and description of every criterion that has a `kind`. Operator-added criteria (`kind = null`) survive and are reordered to the end | Senior management |

#### QA and the release gate (`qa/qa.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/factory/tests` | QA results per batch: campaign, lenses, adversarially verified findings and the synthesized QAReport. Pod-filtered for non-admins | JWT |
| POST | `/api/factory/tests/:batchId/rerun` | Re-enqueue the QA campaign for a batch. `202` | JWT + Pod and role checks in the service |
| POST | `/api/factory/tests/:batchId/approve` | **Release gate.** Approves the rollout and moves the batch to `Released`. Requires step-up auth and the Tech Lead or senior-management role (`qa-gate.service.ts:49`). `400` while the QA campaign has not completed | JWT + role check in the service |

#### Dashboards (`prs/`, `cost/`, `velocity/`, `logs/`, `metrics/`)

All read-only aggregations derived at read time from Prisma. The first four are
Pod-filtered for non-admins; `metrics/timeseries` is senior-management only
(`metrics.controller.ts:32`).

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/factory/prs` | Story PRs against the integration branch and consolidated PRs against the DEV branch, enriched with live GitHub state | JWT |
| GET | `/api/factory/cost` | Cost analytics: planner, generator and verifier token spend per batch and per story over the last 50 batches, plus a 30-day run rate. **Client-side SDK estimates, not billing** | JWT |
| GET | `/api/factory/velocity` | Story points against measured effort (cost, duration, DoD attempts), each story classified `over` / `calibrated` / `under`, with the weekly trend and the Fibonacci calibration table | JWT |
| GET | `/api/factory/logs` | Forge log stream derived from persisted state: batch lifecycle, agent-run lifecycle, worker milestones and DoD verdicts | JWT |
| GET | `/api/factory/metrics/timeseries` | 24-hour time series for the Factory dashboard charts: occupied slots per hour and token burn per hour | Senior management |

#### Ephemeral previews (`preview/preview.controller.ts`)

All three handlers call `assertCanManageFleet`
(`preview.controller.ts:83,110,141`). `:batchId` is the epic's enqueued batch id.

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| POST | `/api/factory/batch/:batchId/preview/start` | Clone the batch branch and spawn a dev server. Returns immediately with `status=starting`; poll the GET until `status=running`. `201` | Senior management |
| GET | `/api/factory/batch/:batchId/preview` | Current preview state: status, URL, port, branch, project type, start time, error, and the last 20 log lines | Senior management |
| DELETE | `/api/factory/batch/:batchId/preview` | Stop the preview and clean up the temp directory. Idempotent — returns `stopped=false` when there was nothing running | Senior management |

#### Branch strategy and the kill switch (`branch-strategy/branch-strategy.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/factory/branch-strategy` | The Forge's branch-model configuration, auto-seeded with defaults if absent | Senior management |
| PUT | `/api/factory/branch-strategy` | Partial update — only the fields you send change | Senior management |
| POST | `/api/factory/branch-strategy/pause` | **Kill switch: pause.** `claim-story` stops handing out work. Persisted, so it survives a restart | Senior management |
| POST | `/api/factory/branch-strategy/resume` | **Kill switch: resume.** `claim-story` accepts requests again | Senior management |
| POST | `/api/factory/branch-strategy/abort-all-runs` | **Kill switch: abort all.** Marks every `claimed` or `running` run abandoned; each worker sees `410` on its next progress ping (about 30 s later) and kills its agent | Senior management |
| GET | `/api/factory/branch-strategy/git-state` | Validates that `dev` and `main` exist and share history; the UI shows a banner when they do not | Senior management |
| POST | `/api/factory/branch-strategy/align-dev` | Force-update `dev` to share history with `main`. **Destructive** — discards history unique to `dev`. Requires step-up auth and the Tech Lead or senior-management role, checked in the service rather than the controller (`branch-strategy.controller.ts:149`) | Step-up + role check in the service |

#### Agent terminal (`terminal.controller.ts`)

The whole controller is gated at class level by `@Roles(UserRole.AltaGerencia)`
(`terminal.controller.ts:120`) — spawning an interactive `claude` process with
filesystem and repository-credential access is a fleet-management operation.
These endpoints drive the ttyd-backed terminal; `POST /start` returns the URL of
a ttyd instance that the frontend embeds in an iframe
(`terminal.controller.ts:135-141`). The terminal's own transport is ttyd's, not
this API's.

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| POST | `/api/factory/terminal/start` | Start a terminal session; returns `agentId`, `port`, `url`, `worktreePath` and `branch` | Senior management |
| POST | `/api/factory/terminal/stop` | Stop a session. `204` | Senior management |
| POST | `/api/factory/terminal/send-keys` | Send keystrokes to a session. `204` | Senior management |
| POST | `/api/factory/terminal/upload/:agentId` | Upload a file into the session's workspace. `multipart/form-data`, 10 MB limit | Senior management |
| GET | `/api/factory/terminal/copy-mode/:agentId` | Whether the session is in tmux copy mode | Senior management |
| GET | `/api/factory/terminal/session/:agentId` | One session's state | Senior management |
| GET | `/api/factory/terminal/sessions` | All live sessions | Senior management |
| GET | `/api/factory/terminal/audit-log` | The terminal audit log, filterable by `?agentId=` and `?limit=` | Senior management |

#### Placeholder endpoints (`factory.controller.ts`)

Three routes remain from the original scaffold. They are wired and they answer
`200`, but the service returns fixed values and never queries anything
(`apps/api/src/modules/factory/factory.service.ts:5-15`). They are listed here so
you do not mistake them for the real dashboards above.

| Method | Path | What it actually returns | Authorization |
| --- | --- | --- | --- |
| GET | `/api/factory/status` | `{ status: "online", timestamp }` — a constant, not a real Forge health check | JWT |
| GET | `/api/factory/agents` | `{ data: [], message: "Agents endpoint ready" }` — always empty | JWT |
| GET | `/api/factory/pipelines` | `{ data: [], message: "Pipelines endpoint ready" }` — always empty | JWT |

#### Organization Anthropic configuration (`org-anthropic-config/`)

A separate NestJS module, but mounted under the `factory/` path
(`org-anthropic-config.controller.ts:29`). All three handlers are
senior-management only.

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/factory/anthropic-config` | Metadata about the configured Anthropic API key — never the plaintext | Senior management |
| PUT | `/api/factory/anthropic-config` | Set or rotate the key. Encrypted with AES-256-GCM; only ciphertext, IV and auth tag are persisted. `204` | Senior management |
| GET | `/api/factory/anthropic-config/models` | The Claude model catalog for the per-agent selectors: a curated list (pricing, descriptions, compatibility) checked live against the provider's model list when a key is present | Senior management |

### `vault` — knowledge base

21 routes across two controllers.

#### Vault content (`vault/vault.controller.ts`)

Every route except `GET /api/vault/config` is additionally protected by
`VaultAccessGuard` (`vault.controller.ts:65,72,81,88,101,108,115,123,134,150`),
which enforces Pod membership against the target vault and a deny-by-default
role map, and re-resolves the target from `?vaultId=` so a caller cannot point a
write at a vault they have no access to. Holders of `MANAGE_INTEGRATIONS` bypass
it (`vault-access.guard.ts:37-41`).

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/vault/config` | Public configuration of the vault: owner, repo, branch, connected. No token, no sensitive data | JWT |
| GET | `/api/vault/tree` | Recursive listing of a vault folder. `?vaultId=` switches to browse mode | JWT + `VaultAccessGuard` |
| GET | `/api/vault/file` | Read a file's contents. `?vaultId=` supported | JWT + `VaultAccessGuard` |
| PUT | `/api/vault/file` | Create or update a file. `?vaultId=` supported | `MANAGE_DOCUMENTS` + `VaultAccessGuard` |
| DELETE | `/api/vault/file` | Delete a file. `204`. `?vaultId=` supported | `MANAGE_DOCUMENTS` + `VaultAccessGuard` |
| GET | `/api/vault/changelog` | Commit history of the vault repository | JWT + `VaultAccessGuard` |
| GET | `/api/vault/changelog/:sha` | One commit, including the file diffs | JWT + `VaultAccessGuard` |
| GET | `/api/vault/tags` | `path → tags` map for every `.md` document; feeds the graph view | JWT + `VaultAccessGuard` |
| POST | `/api/vault/connections` | Fire off the AI agent that tags every document to build graph connections. Fire-and-forget: poll the status endpoint. `202`, `409` if a job is already running, 3/min | `MANAGE_DOCUMENTS` + `VaultAccessGuard` |
| GET | `/api/vault/connections/status` | Phase, progress and final summary of that job. One job at a time per process; returns idle if the running job belongs to another vault | JWT + `VaultAccessGuard` |
| GET | `/api/vault/connections/last-run` | ISO date of the last connection generation, derived from the vault's git history. `null` if never | JWT + `VaultAccessGuard` |

#### Vault configuration (`vault/vault-config.controller.ts`)

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/vault/configs` | List every configured vault | `MANAGE_INTEGRATIONS` |
| GET | `/api/vault/configs/accessible` | List the vaults the caller can reach, filtered server-side by Pod membership | JWT |
| GET | `/api/vault/configs/:id` | One vault config | `MANAGE_INTEGRATIONS` |
| POST | `/api/vault/configs` | Create a vault config; clones in the background when it is the active one | `MANAGE_INTEGRATIONS` |
| PATCH | `/api/vault/configs/:id` | Update a vault config; the token is optional | `MANAGE_INTEGRATIONS` |
| DELETE | `/api/vault/configs/:id` | Delete a vault config and its local clone. `204` | `MANAGE_INTEGRATIONS` |
| POST | `/api/vault/configs/:id/activate` | Make this vault the active one; the others are deactivated and the new one is cloned | `MANAGE_INTEGRATIONS` |
| POST | `/api/vault/configs/:id/test` | Test the GitHub connection with the stored token | `MANAGE_INTEGRATIONS` |
| POST | `/api/vault/configs/:id/sync` | Force a clone or pull now | `MANAGE_INTEGRATIONS` |
| GET | `/api/vault/configs/:id/status` | Clone status, for polling from the UI | `MANAGE_INTEGRATIONS` |

### `code-repositories` — `code-repositories/code-repository.controller.ts`

13 routes. Every one requires `MANAGE_INTEGRATIONS` except `accessible`, which is
Pod-filtered instead (`code-repository.controller.ts:39-41`).

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/code-repositories` | List every repository | `MANAGE_INTEGRATIONS` |
| GET | `/api/code-repositories/accessible` | List the repositories the caller can reach, Pod-filtered | JWT |
| GET | `/api/code-repositories/:id` | One repository | `MANAGE_INTEGRATIONS` |
| POST | `/api/code-repositories` | Create a repository; the clone starts in the background | `MANAGE_INTEGRATIONS` |
| PATCH | `/api/code-repositories/:id` | Update a repository; the token is optional | `MANAGE_INTEGRATIONS` |
| DELETE | `/api/code-repositories/:id` | Delete a repository and its local clone. `204` | `MANAGE_INTEGRATIONS` |
| POST | `/api/code-repositories/:id/enable` | Enable it. Several may be enabled at once | `MANAGE_INTEGRATIONS` |
| POST | `/api/code-repositories/:id/disable` | Disable it without removing the clone | `MANAGE_INTEGRATIONS` |
| POST | `/api/code-repositories/:id/forge-writable/enable` | Let the Forge write to this repository | `MANAGE_INTEGRATIONS` |
| POST | `/api/code-repositories/:id/forge-writable/disable` | Take that write permission away (back to read-only) | `MANAGE_INTEGRATIONS` |
| POST | `/api/code-repositories/:id/test` | Test the GitHub connection with the stored token | `MANAGE_INTEGRATIONS` |
| POST | `/api/code-repositories/:id/sync` | Force a clone or pull now | `MANAGE_INTEGRATIONS` |
| GET | `/api/code-repositories/:id/status` | Clone status, for polling from the UI | `MANAGE_INTEGRATIONS` |

### `integrations` — `integrations/integrations.controller.ts`

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/integrations/linear` | The Linear configuration, without the API key plaintext. `404` when not configured | `MANAGE_INTEGRATIONS` |
| PUT | `/api/integrations/linear` | Save the Linear configuration | `MANAGE_INTEGRATIONS` |
| POST | `/api/integrations/linear/test` | Test the Linear connection | `MANAGE_INTEGRATIONS` |
| DELETE | `/api/integrations/:provider` | Delete a provider's configuration. `204` | `MANAGE_INTEGRATIONS` |

### `external-secrets` — `external-secrets/external-secrets.controller.ts`

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/external-secrets` | List external secrets with masked values | `MANAGE_EXTERNAL_SECRETS` |
| POST | `/api/external-secrets` | Create a secret. A `sourceDependencyId` auto-resolves the technical dependency that prompted it | `MANAGE_EXTERNAL_SECRETS` |
| DELETE | `/api/external-secrets/:id` | Delete a secret. Destructive; the UI confirms with type-to-confirm. `204` | `MANAGE_EXTERNAL_SECRETS` |

### `documents` — `documents/documents.controller.ts`

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| POST | `/api/documents/upload` | Upload an attachment. `multipart/form-data`, 10 MB limit, optional `?folder=` | `MANAGE_DOCUMENTS` |
| GET | `/api/documents/file/:type/:entityId/:filename` | Download an attachment, streamed | JWT |
| DELETE | `/api/documents/file/:type/:entityId/:filename` | Delete an attachment | `MANAGE_DOCUMENTS` |

### `agent-token-settings` — `agent-token-settings/agent-token-settings.controller.ts`

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/agent-token-settings` | Current per-agent model and thinking-effort configuration | JWT |
| PATCH | `/api/agent-token-settings` | Partially update it | `MANAGE_AGENT_TOKENS` |

### `branding-settings` — `branding-settings/branding-settings.controller.ts`

The two reads are `@Public()` (`branding-settings.controller.ts:53,141`) because
the login screen has to render the logo before anyone is authenticated. The
three writes additionally validate the `Origin` and `Referer` headers against an
allowlist as defense in depth, which is why the BFF proxy forwards both
(`apps/web/src/app/api/proxy/[...path]/route.ts:124-127`).

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/branding-settings` | Current branding settings | Public |
| GET | `/api/branding-settings/asset/:type` | Stream the asset binary (`logo`, `logoCollapsed` or `favicon`) | Public |
| PATCH | `/api/branding-settings` | Update the branding settings | `MANAGE_BRANDING` |
| POST | `/api/branding-settings/upload/:type` | Upload a branding asset. `multipart/form-data` | `MANAGE_BRANDING` |
| DELETE | `/api/branding-settings/asset/:type` | Delete an asset; the frontend falls back to its static default | `MANAGE_BRANDING` |

### `diagram-theme-settings` — `diagram-theme-settings/diagram-theme-settings.controller.ts`

| Method | Path | What it does | Authorization |
| --- | --- | --- | --- |
| GET | `/api/diagram-theme` | Current diagram color configuration | JWT |
| PUT | `/api/diagram-theme` | Replace the diagram colors | `MANAGE_DIAGRAM_THEME` |

---

## SSE streaming endpoints

Six endpoints stream Server-Sent Events instead of returning a JSON body. They
are the AI agent surfaces: everything a long-running agent does is pushed to the
client as it happens.

**These are not WebSockets.** There is no WebSocket server and no
`@WebSocketGateway` anywhere in `apps/api` — `socket.io` and
`@nestjs/platform-socket.io` are declared in `apps/api/package.json` but nothing
imports them. Every stream is plain HTTP with
`Content-Type: text/event-stream`, one-directional from server to client. (The
agent terminal *does* use a WebSocket, but that connection belongs to ttyd and
is opened by the embedded iframe directly against the ttyd port — it never goes
through this API.)

### The six streams

| Method | Path | Emits | Event union |
| --- | --- | --- | --- |
| GET | `/api/proyectos/epic-generation/:initiativeId` | Epic proposals | `EpicGenerationEvent` |
| GET | `/api/proyectos/story-generation/:epicId` | Story proposals from the PO, TL and QA agents | `StoryGenerationEvent` |
| GET | `/api/proyectos/diagram-generation/:epicId` | A generated epic diagram | `DiagramGenerationEvent` |
| GET | `/api/proyectos/diagram-generation/:epicId/generate-integration-doc` | A flow document over an existing diagram | `DiagramGenerationEvent` |
| GET | `/api/proyectos/executive-summary/:initiativeId` | Initiative metrics and the narrative summary | `ExecutiveSummaryEvent` |
| POST | `/api/proyectos/assistant-chat/:entityType/:entityId` | One assistant turn, with edit proposals | `AssistantChatEvent` |

The event unions are exported from `@cenzontle/shared`
(`packages/shared/src/types/proyectos.ts:773,829,876,1353` and
`packages/shared/src/types/executive-summary.ts:162`), so a TypeScript client
gets the exhaustive list for free.

Note that the last one is a **`POST`**. `EventSource` cannot issue a POST, which
is one reason the web client does not use it — see
[Consuming a stream](#consuming-a-stream).

### Wire format

Every stream sets the same four headers before flushing
(`epic-generation.controller.ts:227-231`, and the equivalent lines in the other
five controllers):

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

`X-Accel-Buffering: no` tells nginx-family proxies not to buffer the response,
which would otherwise hold events until the stream ended.

Frames are written as a bare `data:` line with a JSON payload and no event name
(`epic-generation.controller.ts:284`):

```
data: {"type":"phase_change","phase":"drafting","label":"Drafting epics"}

data: {"type":"thinking","delta":"Looking at the initiative's scope…"}

data: {"type":"proposal_ready","epic":{ … }}

data: {"type":"done"}
```

Every payload is an object with a discriminating **`type`** field and an optional
`timestamp` (`packages/shared/src/types/proyectos.ts:768-770`). The type names
differ per stream, but the shape of a run is consistent:

- The four generation streams open with `run_started` and close with
  `run_finished` and then `done`. In between they report progress with
  `phase_change` and `thinking` — plus `step_start` and `step_done` on the epic,
  story and diagram streams, and `tool_progress` on the epic one.
- The result event is what each stream exists to deliver: `proposal_ready` for
  epics and stories, `diagram_ready` and `document_ready` for diagrams,
  `metrics_ready` and `summary_ready` for the executive summary, `proposal` for
  the assistant.
- The assistant stream has its own vocabulary: `session`, `text_delta`,
  `thinking_delta`, `tool_start`, `tool_done`, `proposal`, then `done`. It emits
  no `run_started` or `phase_change`.
- **`{"type":"error","message":"…"}` is delivered as a normal `data:` frame,
  not as an HTTP error status.** By the time the agent fails, headers have long
  since been flushed with `200`. Your client must inspect event types; a `200`
  and a clean stream end do not mean the run succeeded.

### Heartbeats

Every stream installs a heartbeat that writes the SSE comment `: ping\n\n` every
15 s (`apps/api/src/common/utils/sse-heartbeat.util.ts:18,56`). Comments are
ignored by any conforming SSE consumer; the point is to reset idle timeouts in
undici, the Next.js proxy and any load balancer in between. Without it a long
agent run with a quiet stretch dies with `UND_ERR_BODY_TIMEOUT`.

### Errors before the stream opens

Authorization and concurrency are checked **before** `flushHeaders()`, precisely
so that a failure is a clean JSON error rather than half a stream
(`epic-generation.controller.ts:210-231`):

- `403` — the caller lacks the permission or the Pod intersection.
- `409` — a run is already active for this resource, or the caller already has
  three concurrent runs. The cap is per user and shared across the generation
  endpoints (`apps/api/src/common/services/agent-run-registry.service.ts:36,89-100`).

Once headers are flushed you get `200` and everything else arrives in-band.

### Disconnect, cancel, and resume

Closing the connection does **not** cancel the agent
(`epic-generation.controller.ts:239-252`). The run keeps going in the background
and its events keep accumulating in Redis, so you can reload the page and
rehydrate from the matching `…/session` or `…/cache` endpoint. Two things end a
run early:

- An explicit `DELETE …/session/active` (or `…/active`), which only the user who
  started the run — or senior management — may call.
- The registry's hard timeout: 10 minutes by default, overridable per stream for
  the multi-agent story flow
  (`agent-run-registry.service.ts:45,87`).

### Consuming a stream

The web client uses `fetch` plus a `ReadableStream` reader, not `EventSource`
(`apps/web/src/lib/epic-agent.ts:30,41`, and the same pattern in
`story-agent.ts`, `diagram-agent.ts`, `executive-summary.ts` and
`assistant-chat.ts`). Three reasons: the assistant stream is a POST, the request
needs an `Authorization` header, and the responses arrive through the BFF proxy.

The proxy pipes any `text/event-stream` response body straight through without
buffering (`apps/web/src/app/api/proxy/[...path]/route.ts:168-177`). For the
generation streams and the assistant it also swaps in an undici dispatcher with
`bodyTimeout: 0` and `headersTimeout: 0` so a slow agent cannot trip a client
timeout (`route.ts:36-40,144-150`). That dispatcher is selected by a path
pattern (`route.ts:55-70`) that matches `story-generation`, `epic-generation`
and `diagram-generation` followed by a bare UUID, plus the assistant chat turn.
The executive-summary stream and the `generate-integration-doc` backfill fall
outside that pattern and therefore run on undici's default 5-minute body
timeout; they still stream correctly, because the pass-through at `route.ts:168`
keys off the response content type, not the path.

A minimal direct consumer:

```bash
curl -N \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: text/event-stream" \
  "http://localhost:3001/api/proyectos/epic-generation/$INITIATIVE_ID?count=5"
```

`-N` disables curl's own buffering. Every non-comment line will be a
`data: {...}` frame.

---

## The worker API

Forge workers are daemons, not people. They have no Auth0 session and no JWT, so
the five endpoints they use sit outside the global authentication guard and use
their own credential instead.

### How a worker route is wired

Each handler in `apps/api/src/modules/factory/fleet/worker-api.controller.ts`
carries three decorators, and the controller registers the guard:

```ts
@Controller('factory/workers')
@UseGuards(WorkerAuthGuard)   // worker-api.controller.ts:37-38
// …
  @Public()        // skips the global JwtAuthGuard
  @WorkerRoute()   // switches WorkerAuthGuard on for this handler
  @Post('claim-story')
```

`@Public()` is what removes the JWT requirement — without it the global
`JwtAuthGuard` would reject a worker token as an invalid JWT. `@WorkerRoute()`
is what puts a credential check back. The two must always travel together, and
`WorkerAuthGuard` enforces that: if the guard runs on a handler that is *not*
marked `@WorkerRoute()`, it logs an error and throws `401` rather than allowing
the request through
(`apps/api/src/modules/factory/fleet/worker-auth.guard.ts:48-53`). A future
`@Public()` endpoint added to this controller therefore fails closed instead of
silently becoming unauthenticated.

### Authenticating

The worker sends its token as an ordinary bearer credential:

```
Authorization: Bearer worker_<32 chars>
```

`WorkerAuthGuard` rejects a missing header, a non-`Bearer` scheme and any token
that does not start with `worker_` (`worker-auth.guard.ts:60-70`). It then
resolves the plaintext against the database — the stored form is an
11-character prefix plus a SHA-256 hash, never the token itself — and rejects
tokens that are unknown, revoked or expired with `401`
(`worker-auth.guard.ts:72-79`).

On success it attaches `{ id, tokenId }` to the request as `req.workerNode`, so
handlers know which node is calling and which token claimed each run
(`worker-auth.guard.ts:82`), and it updates `lastUsedAt` fire-and-forget. Tokens
are minted per node at `POST /api/factory/nodes/:id/tokens` and revoked at
`DELETE /api/factory/nodes/:id/tokens/:tokenId`; revocation takes effect on the
worker's very next call.

### The five endpoints

| Method | Path | What it does | Cap |
| --- | --- | --- | --- |
| POST | `/api/factory/workers/register` | Handshake at worker boot. Reports OS, hostname and slot count, and marks the node online | 30/min |
| POST | `/api/factory/workers/heartbeat` | Liveness ping every 30 s. Refreshes `lastHeartbeat` and keeps the node online | 30/min |
| POST | `/api/factory/workers/claim-story` | Atomically claim the next ready story, respecting hard DAG edges. `200` with the claim payload, or **`204` with no body when nothing is claimable** | 60/min |
| POST | `/api/factory/workers/runs/:runId/progress` | Report progress on a run in flight. `204`. **`410 Gone` once the run is terminal** — this is how a worker learns its run was aborted | 60/min |
| POST | `/api/factory/workers/runs/:runId/complete` | Report completion. Exit code `0` plus a PR number means `completed`; a non-zero exit code means `failed`. `204`, or `409` if the run is already terminal | 30/min |

Two response codes carry protocol meaning rather than error meaning:

- **`204` from `claim-story`** is the normal idle answer. The worker polls every
  5 s while it has free slots; most of those polls return `204`
  (`worker-api.controller.ts:109-112`).
- **`410` from `progress`** is how the kill switch reaches a running worker.
  `POST /api/factory/branch-strategy/abort-all-runs` marks runs abandoned; the
  worker finds out about 30 seconds later, on its next progress ping, and
  terminates its agent.

For how to build, register and run a worker, see
[`forge-worker.md`](forge-worker.md).

---

## Regenerating this reference

There is **no export script**. `apps/api/package.json:6-18` has no OpenAPI task,
and neither does `turbo.json`. The OpenAPI document is built at runtime inside
`bootstrap()` and never written to disk.

What exists is the `DocumentBuilder` block in `apps/api/src/main.ts:52-61`:

```ts
if (process.env.NODE_ENV !== "production") {
  const config = new DocumentBuilder()
    .setTitle("Cenzontle API")
    .setDescription("API backend para el sistema de gestion CENZONTLE")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);
}
```

`SwaggerModule.setup(path, …)` from `@nestjs/swagger` 11 serves, alongside the
UI, the raw document at `<path>-json` and `<path>-yaml`. No options object is
passed here, so `useGlobalPrefix` stays off and the paths are literal.

**To export the spec**, start the API in a non-production environment and fetch
it:

```bash
# From the repo root, in one shell
pnpm dev:api

# In another
curl -s http://localhost:3001/api/docs-json > openapi.json
curl -s http://localhost:3001/api/docs-yaml > openapi.yaml
```

Both are unauthenticated in a development environment, because the Swagger
routes are registered on the HTTP adapter rather than as controllers and never
pass through `JwtAuthGuard`. The interactive UI is at
<http://localhost:3001/api/docs>.

Two caveats about the generated spec:

- **`NODE_ENV=production` produces nothing.** The whole block is skipped, so
  `/api/docs`, `/api/docs-json` and `/api/docs-yaml` all 404. That is the reason
  this file exists.
- **It is only as good as the decorators.** Bodies and responses are described
  by `@ApiOperation`, `@ApiOkResponse` and the class-validator DTOs; a route
  without them still appears, but with an empty schema. It also cannot express
  the authorization rules enforced in service code — the Pod intersections, the
  role assertions and the step-up password checks that the tables above call
  out.

**To update this file by hand**, re-derive the counts and the route list from the
source rather than editing entries in place:

```bash
# Every route decorator, per controller, with line numbers
cd apps/api/src
for f in $(find . -name '*.controller.ts' | sort); do
  echo "=== $f"
  grep -nE '^\s*@(Controller|Get|Post|Put|Patch|Delete|Public|WorkerRoute|Roles|Permissions|Throttle)\(' "$f"
done

# Total route handlers — the number quoted at the top of this document
grep -rhcE '^\s*@(Get|Post|Put|Patch|Delete)\(' --include='*.controller.ts' . \
  | paste -sd+ - | bc
```
