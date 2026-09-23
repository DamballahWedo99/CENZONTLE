# Reference: Authorization

*Reference.* Who may do what in CENZONTLE, and which line of code decides it. Every
claim here is anchored to a file and a line. When this document and the code disagree,
the code wins — tell us in an issue.

Domain vocabulary (Pod, vault, gate, sign-off, batch) is defined in
[`glossary.md`](glossary.md). The deployment-facing summary lives in
[`../SECURITY.md`](../SECURITY.md); this file is the detail behind it.

Authorization is built from **four independent layers**, and a request has to survive
all of the ones that apply to it:

| Layer | Question it answers | Where it lives |
| --- | --- | --- |
| Authentication | Is this a valid Auth0 access token? | `JwtAuthGuard` |
| RBAC | Does this user's role hold the required permission? | `PermissionsGuard`, `RolesGuard` |
| Pod scoping | Does this user share a Pod with the resource? | Service-layer helpers |
| Step-up | Did this user retype their password *right now*? | `AuthService.assertPasswordValid` |

The fifth path — the Forge workers — bypasses all four and authenticates with its own
bearer credential. See [Worker routes](#worker-routes).

- [The role model](#the-role-model)
- [The permissions](#the-permissions)
- [The role × permission matrix](#the-role--permission-matrix)
- [Permissions nothing enforces](#permissions-nothing-enforces)
- [How the API enforces it](#how-the-api-enforces-it)
- [Vault access (ReBAC)](#vault-access-rebac)
- [Assigning roles and Pods](#assigning-roles-and-pods)
- [Step-up authentication](#step-up-authentication)

---

## The role model

Five roles, defined once as an enum and never extended at runtime
(`packages/shared/src/types/auth.ts:3-9`). A user holds **exactly one**.

| Identifier | UI label | In English prose | What the code's own description says |
| --- | --- | --- | --- |
| `alta_gerencia` | *"Alta Gerencia"* | senior management | Can create initiatives, manage users and see everything |
| `product_owner` | *"Product Owner"* | Product Owner | Can create epics, approve stories and manage stories |
| `tech_lead` | *"Tech Lead"* | Tech Lead | Can create and approve diagrams, technical definitions and epics |
| `qa` | *"QA"* | QA | Can create and approve QA matrices, Gherkin and test execution |
| `viewer` | *"Viewer"* | Viewer | Read-only: dashboards, reports and tracking |

The labels come from `USER_ROLE_LABELS` (`auth.ts:11-17`) and the descriptions from
`USER_ROLE_DESCRIPTIONS` (`auth.ts:19-25`), both still in Spanish because they render
in the UI. The last column is a translation of those in-code descriptions, not an
independent claim — the binding statement of what a role may do is
[the matrix](#the-role--permission-matrix) below.

Three things about the model that surprise people:

- **`alta_gerencia` is an admin bypass, not just a big role.** Beyond holding every
  permission, it short-circuits every Pod check (`epic-access.util.ts:23`, `:50`,
  `:86`), can sign off on behalf of any role (`epics.service.ts:2304-2305`), and is the
  only role that may drive the agent-terminal controller — spawning an interactive
  `claude` process with the host filesystem and the repository credentials is treated as
  a fleet-management operation (`terminal.controller.ts:105-120`).
- **The role is a single value, and an unknown one silently becomes `viewer`.** If the
  Auth0 token carries no `role` claim, or one that is not in the enum, the guard
  assigns `viewer` rather than rejecting the request
  (`apps/api/src/modules/auth/guards/jwt-auth.guard.ts:54-59`). A misconfigured
  post-login Action therefore looks like "everything is read-only", not like an outage.
- **`viewer` is not enforced by a permission.** See
  [Permissions nothing enforces](#permissions-nothing-enforces).

---

## The permissions

**There are 25.** The `Permission` enum is the single source
(`packages/shared/src/types/auth.ts:35-88`); its values are the strings the enum holds,
and those strings — not the TypeScript member names — are what a permission *is*.

| # | Value | Enum member | Group |
| --- | --- | --- | --- |
| 1 | `create:initiative` | `CREATE_INITIATIVE` | Initiatives |
| 2 | `edit:initiative` | `EDIT_INITIATIVE` | Initiatives |
| 3 | `delete:initiative` | `DELETE_INITIATIVE` | Initiatives |
| 4 | `create:epic` | `CREATE_EPIC` | Epics |
| 5 | `edit:epic` | `EDIT_EPIC` | Epics |
| 6 | `delete:epic` | `DELETE_EPIC` | Epics |
| 7 | `approve:epic_po` | `APPROVE_EPIC_PO` | Epics |
| 8 | `approve:epic_tl` | `APPROVE_EPIC_TL` | Epics |
| 9 | `create:story` | `CREATE_STORY` | Stories |
| 10 | `edit:story` | `EDIT_STORY` | Stories |
| 11 | `delete:story` | `DELETE_STORY` | Stories |
| 12 | `create:diagram` | `CREATE_DIAGRAM` | Diagrams |
| 13 | `edit:diagram` | `EDIT_DIAGRAM` | Diagrams |
| 14 | `create:qa_matrix` | `CREATE_QA_MATRIX` | QA |
| 15 | `edit:qa_matrix` | `EDIT_QA_MATRIX` | QA |
| 16 | `approve:qa` | `APPROVE_QA` | QA |
| 17 | `manage:documents` | `MANAGE_DOCUMENTS` | Documents |
| 18 | `manage:dependencies` | `MANAGE_DEPENDENCIES` | Dependencies |
| 19 | `manage:users` | `MANAGE_USERS` | Admin |
| 20 | `manage:integrations` | `MANAGE_INTEGRATIONS` | Admin |
| 21 | `manage:diagram-theme` | `MANAGE_DIAGRAM_THEME` | Admin |
| 22 | `manage:agent-tokens` | `MANAGE_AGENT_TOKENS` | Admin |
| 23 | `manage:external_secrets` | `MANAGE_EXTERNAL_SECRETS` | Admin |
| 24 | `manage:branding` | `MANAGE_BRANDING` | Admin |
| 25 | `view:all` | `VIEW_ALL` | View |

Note the inconsistent separators — `manage:diagram-theme` uses a hyphen,
`manage:external_secrets` an underscore, `approve:epic_po` an underscore. They are
literal strings; reproduce them exactly.

Three of the `manage:*` permissions were deliberately split out of
`manage:integrations` rather than folded into it, and the enum says why
(`auth.ts:72-84`):

- `manage:agent-tokens` touches the Anthropic budget — a careless token setting can
  inflate cost by an order of magnitude.
- `manage:external_secrets` covers crypto operations (encrypt, rotate, delete) on
  third-party API keys, which the code considers more sensitive than integration
  config, and which should be grantable and revocable on its own.
- `manage:branding` changes what *every* user sees, so its blast radius is global. Only
  `PATCH`/`POST`/`DELETE` need it; the `GET` is public, because the login screen renders
  before anyone is signed in.

---

## The role × permission matrix

Transcribed from `ROLE_PERMISSIONS` (`packages/shared/src/types/auth.ts:200-241`) —
the map the server actually reads. `•` means the role holds the permission.

| Permission | `alta_gerencia` | `product_owner` | `tech_lead` | `qa` | `viewer` |
| --- | :---: | :---: | :---: | :---: | :---: |
| `create:initiative` | • | | | | |
| `edit:initiative` | • | | | | |
| `delete:initiative` | • | | | | |
| `create:epic` | • | • | | | |
| `edit:epic` | • | • | • | | |
| `delete:epic` | • | | | | |
| `approve:epic_po` | • | • | | | |
| `approve:epic_tl` | • | | • | | |
| `create:story` | • | • | • | | |
| `edit:story` | • | • | • | | |
| `delete:story` | • | • | | | |
| `create:diagram` | • | • | • | | |
| `edit:diagram` | • | • | • | | |
| `create:qa_matrix` | • | | | • | |
| `edit:qa_matrix` | • | | | • | |
| `approve:qa` | • | | | • | |
| `manage:documents` | • | • | • | • | |
| `manage:dependencies` | • | • | • | | |
| `manage:users` | • | | | | |
| `manage:integrations` | • | | | | |
| `manage:diagram-theme` | • | | | | |
| `manage:agent-tokens` | • | | | | |
| `manage:external_secrets` | • | | • | | |
| `manage:branding` | • | | | | |
| `view:all` | • | • | • | • | • |
| **Total** | **25** | **11** | **10** | **5** | **1** |

Read it carefully before you hand someone a role:

- **`tech_lead` can edit an epic but cannot create or delete one.** Creating epics is a
  Product Owner act; deleting one is admin-only.
- **`tech_lead` is the only non-admin role with `manage:external_secrets`** — that is,
  the only non-admin who can read the list of third-party API keys and rotate them.
- **`product_owner` can delete stories; `tech_lead` cannot.**
- **`qa` cannot touch stories or epics at all** — no `edit:story`, no `edit:epic`. Its
  write surface is QA matrices and documents.
- **`viewer` holds exactly one permission**, and no API guard checks it.

There is a second, identical map next to it, `DEFAULT_ROLE_PERMISSIONS`
(`auth.ts:154-198`). It is the *reset baseline for the settings UI*, not a second
enforcement path: the server never reads it. Today the two maps have the same contents;
if you edit one, edit both, or the "reset to defaults" button will start proposing a
matrix the server does not honor.

> [!WARNING]
> **The matrix is compile-time.** Changing what a role may do means editing
> `packages/shared/src/types/auth.ts` and redeploying. There is no runtime path.
>
> A Settings screen used to render an editable matrix, but its save handler was an
> 800 ms timer that flipped a "Saved" badge and wrote nothing
> (`RolesPermissionsSection.tsx:114-120`) — the edits lived in React state
> (`apps/web/src/context/AuthContext.tsx:108-114`) and vanished on reload. Because a
> screen that reports success without persisting is worse than no screen, it is
> disabled behind `ROLES_SECTION_ENABLED`
> (`apps/web/src/components/factory/settings/SettingsDashboard.tsx:134`): it is absent
> from the sidebar and `?section=roles` falls back to the default section. The
> component is untouched in the tree, so flipping that flag to `true` restores it once
> it has a server to talk to.

---

## Permissions nothing enforces

Four of the 25 are declared, labelled and assigned to roles, but no guard anywhere
reads them. Grant or revoke them and nothing changes:

| Permission | Status |
| --- | --- |
| `create:qa_matrix` | Never referenced outside `packages/shared/src/types/auth.ts`. No API guard, no client gate. |
| `edit:qa_matrix` | Same. |
| `manage:dependencies` | Same. Story dependency endpoints are gated on `edit:story` instead (`apps/api/src/modules/proyectos/stories/dependencies/story-dependencies.controller.ts`). |
| `view:all` | No API guard reads it. Its only consumer is one client-side gate on a download menu (`apps/web/src/components/proyectos/shared/DownloadMenu.tsx:182`). |

Two consequences worth internalizing:

- **The QA role's write surface is narrower than the matrix suggests.** `qa` is granted
  `create:qa_matrix` and `edit:qa_matrix`, but the endpoints that write QA matrices do
  not check them, so those two entries are documentation, not enforcement.
- **`viewer` is read-only by omission, not by rule.** Nothing checks `view:all`;
  `viewer` is confined because it holds *none of the other 24* permissions, so every
  `@Permissions`-decorated endpoint rejects it. That is a real boundary, but it only
  covers endpoints that carry the decorator — and some do not. See the next section.

---

## How the API enforces it

### The global guards

Four guards are registered globally, so they apply to every route without a controller
opting in:

| Order | Guard | Registered in |
| --- | --- | --- |
| 1 | `AuthAwareThrottlerGuard` (rate limiting) | `apps/api/src/app.module.ts:174-177` |
| 2 | `JwtAuthGuard` | `apps/api/src/modules/auth/auth.module.ts:11` |
| 3 | `RolesGuard` | `apps/api/src/modules/auth/auth.module.ts:12` |
| 4 | `PermissionsGuard` | `apps/api/src/modules/auth/auth.module.ts:13` |

The intended pipeline is spelled out in the code: throttle → auth → permissions →
handler (`app.module.ts:172-173`). Note that the three authorization guards live in
`auth.module.ts`, **not** in `app.module.ts` — the only `APP_GUARD` in `app.module.ts`
is the rate limiter. If you go looking for the auth wiring in the root module you will
not find it.

**`JwtAuthGuard`** (`apps/api/src/modules/auth/guards/jwt-auth.guard.ts`):

1. Returns `true` immediately if the handler or its controller is marked `@Public()`
   (`:34-38`).
2. Otherwise extracts `Authorization: Bearer <token>`; a missing or non-Bearer header is
   a 401 `Missing access token` (`:43`, `:77-82`).
3. Verifies the token against the tenant's JWKS with the configured issuer and audience
   (`:46-49`). Any failure — expired, wrong audience, bad signature — is a 401
   `Invalid access token` (`:72-74`), with no distinction between causes.
4. On success it builds `request.user` from the namespaced claims under
   `https://cenzontle.app` — `role`, `pod_ids`, `email`, `name`, `picture` (`:52-68`).
   An unknown or absent role becomes `viewer` (`:54-59`); absent `pod_ids` becomes `[]`
   (`:67`), which means "member of no Pod" and, for most resources, no access.

**`RolesGuard`** (`guards/roles.guard.ts`) reads `@Roles(...)` metadata from the handler
then the controller (`:16-19`). No metadata means the guard passes through (`:20`).
Otherwise the user's single role must appear in the list, or it throws 403
`Insufficient role` (`:25-27`).

**`PermissionsGuard`** (`guards/permissions.guard.ts`) reads `@Permissions(...)`
metadata the same way (`:20-23`), passes through when there is none (`:24`), and
otherwise requires **every** listed permission — the check is `every`, not `some`
(`:32`). Failure is 403 `Insufficient permissions` (`:33`). It resolves the user's set
by looking their role up in `ROLE_PERMISSIONS` (`:31`); an unknown role resolves to an
empty set, so it fails closed.

Both metadata guards use `getAllAndOverride([handler, class])`, so a decorator on the
controller class covers every route in it and a route-level decorator overrides the
class. `TerminalController` uses exactly that: one `@Roles(UserRole.AltaGerencia)` on
the class gates all eight of its endpoints
(`apps/api/src/modules/factory/terminal.controller.ts:120-123`).

The decorators themselves are three lines each —
`@Public()` (`decorators/public.decorator.ts:3-4`),
`@Roles()` (`decorators/roles.decorator.ts:4-5`),
`@Permissions()` (`decorators/permissions.decorator.ts:4-6`) — plus `@CurrentUser()`,
the param decorator that hands the handler the `request.user` the JWT guard attached
(`decorators/current-user.decorator.ts:4-10`).

### What `@Public()` is used for

Three families of routes opt out of authentication, and none of them is an accident:

| Route | Why | Anchor |
| --- | --- | --- |
| `GET /health` | Liveness probe; returns a status string and a timestamp, nothing else. Also `@SkipThrottle()`, so load-balancer pings do not eat the global rate budget. | `apps/api/src/health.controller.ts:11-18` |
| `GET /branding-settings` | The login screen needs the logo and title before anyone is signed in. The handler strips `updatedBy` — an Auth0 `sub` — from the public response so anonymous callers cannot harvest user identifiers. | `apps/api/src/modules/branding-settings/branding-settings.controller.ts:52-66` |
| `GET /branding-settings/asset/:type` | Serves the logo/favicon binary for the same screen, with `nosniff`, an inline `Content-Disposition` and `default-src 'none'`. | `branding-settings.controller.ts:140-143` |
| `POST /factory/workers/*` (5 endpoints) | Workers have no human session. `@Public()` here skips *Auth0*, not authentication — see below. | `apps/api/src/modules/factory/fleet/worker-api.controller.ts:50, 66, 93, 116, 135` |

The `PATCH`, `POST` and `DELETE` routes of the branding controller are **not** public;
they carry `@Permissions(Permission.MANAGE_BRANDING)` (`branding-settings.controller.ts:69`).

### Worker routes

A worker is not a user. It presents a `worker_<32 chars>` bearer token
([worker token](glossary.md#worker-token)) instead of an Auth0 JWT, so its endpoints
combine three decorators (`worker-api.controller.ts:24-38`):

- `@Public()` — skips the global `JwtAuthGuard`.
- `@WorkerRoute()` — sets the metadata flag `isWorkerRoute`
  (`fleet/worker-route.decorator.ts:12`, `:26`).
- `@UseGuards(WorkerAuthGuard)` — registered once on the controller class
  (`worker-api.controller.ts:38`), covering `register`, `heartbeat`, `claim-story`,
  `runs/:runId/progress` and `runs/:runId/complete`.

`WorkerAuthGuard` (`fleet/worker-auth.guard.ts`) then:

1. **Fails closed if `@WorkerRoute()` is missing** — 401 `Worker route misconfigured`
   (`:39-53`). This is the interlock that makes the pattern safe: a future developer who
   adds a `@Public()` endpoint to this controller and forgets `@WorkerRoute()` gets a
   dead route, not an unauthenticated one.
2. Rejects a missing header, a non-Bearer scheme, or a token that does not start with
   `worker_` (`:60-70`).
3. Resolves the token by SHA-256 hash against the database; unknown, revoked or expired
   tokens are 401 `Invalid or revoked worker token`, and the log line deliberately omits
   the token so a probing attacker cannot leak a real secret into your logs (`:72-79`).
4. On success attaches `request.workerNode = { id, tokenId }` (`:82`) and updates
   `lastUsedAt` fire-and-forget (`:85`).

Handlers read the node through `@WorkerNode()`, which throws a 500 rather than passing
`undefined` if the guard did not run (`worker-route.decorator.ts:37-48`).

Worker tokens carry **no role and no permissions**. Their authority is exactly the five
endpoints above. Operational detail — minting, rotating, revoking — is in
[`forge-worker.md`](forge-worker.md).

### Pod scoping, which is not a guard

RBAC answers "may this role do this kind of thing". It does not answer "may this user
touch *this* epic". That second question is [Pod](glossary.md#pod) membership, and it is
enforced **inside the services**, after the guards have passed, by three pure helpers in
`apps/api/src/modules/proyectos/epics/epic-access.util.ts`:

| Helper | Rule | Lines |
| --- | --- | --- |
| `assertUserCanAccessEpicPods` | The user must share at least one Pod with the epic. An epic with **no** Pods is forbidden to everyone but admins — fail-closed, so an orphaned epic is not editable by default. | `:19-34` |
| `assertUserCanAccessStoryByEpic` | Same, against the union of the parent epic's Pods and the story's own `podId` — so a story transferred between Pods stays reachable by its current owner. | `:46-64` |
| `assertUserCanAssignPods` | On **create**, the rule tightens from intersection to subset: you may only assign Pods you belong to, which closes the "mix one of my Pods with one of yours" escalation. An empty list is allowed. | `:82-96` |

All three return early for `alta_gerencia` (`:23`, `:50`, `:86`) and all three throw
`ForbiddenException`, but with different Spanish messages: the epic and story helpers
answer *"Sin acceso a esta épica"* ("no access to this epic", `:26`, `:32`) and *"Sin
acceso a esta historia"* ("no access to this story", `:56`, `:62`), while
`assertUserCanAssignPods` names the offending Pods — *"No autorizado: no perteneces a
el/los pod(s) destino: …"* ("not authorized: you do not belong to the target pod(s)",
`:92-93`). Match on the message you actually got in the response body.

This matters because **not every endpoint carries a permission decorator**. The Forge
queue controller has none at all
(`apps/api/src/modules/factory/queue/factory-queue.controller.ts:18-79`): enqueueing an
epic, approving the staging gate and retrying a story are authorized by the JWT plus
service-layer checks — `enqueueEpic` calls the Pod helper at
`factory-queue.service.ts:276`, `getBatchDetail` at `:714`, `retryStory` at `:1564` —
and, for the gate, an explicit role comparison (`:1147-1152`). If you are auditing an
endpoint, reading its decorators is not enough; read the service method too.

The two Forge gates are enforced entirely at that layer:

| Gate | Pod check | Role check | Step-up |
| --- | --- | --- | --- |
| [staging gate](glossary.md#staging-gate) | `factory-queue.service.ts:1141` | `:1147-1152` — *"Solo Tech Lead puede aprobar el merge a DEV (staging gate). Tu rol actual es …"* | `:1214` |
| [release gate](glossary.md#release-gate) | `qa-gate.service.ts:44-47` | `:49-54` — *"Solo Tech Lead o Alta Gerencia puede aprobar el release gate. Tu rol actual es …"* | `:71` |

Both accept `tech_lead` **or** `alta_gerencia`, despite the staging gate's message
naming only the Tech Lead. The release gate additionally refuses while the QA campaign
has not finished — 400, *"El batch no está listo para liberar: la campaña de QA aún no
completa."* (`qa-gate.service.ts:64-69`).

The three epic [sign-offs](glossary.md#sign-off) stack all four layers: the
`@Permissions` decorator on the route (`approve:epic_po`, `approve:epic_tl`,
`approve:qa` at `apps/api/src/modules/proyectos/epics/epics.controller.ts:196-229`), the
Pod check (`epics.service.ts:2293-2296`), an exact role match against
`ROLE_BY_APPROVAL_KIND` (`:2303-2309`, table at `:2475-2479`) which also admits
`alta_gerencia`, and step-up (`:2329`). An admin signing off in someone else's name is
recorded as themselves: the approver's display name is snapshotted into the approval and
the changelog in the same transaction (`:2345-2352`, `:2384-2400`).

### Where permissions are actually checked

One row per permission that at least one guard reads. Paths are relative to
`apps/api/src/modules/`.

| Permission | Enforced on |
| --- | --- |
| `create:initiative`, `edit:initiative`, `delete:initiative` | `proyectos/initiatives/initiatives.controller.ts`; `edit:initiative` also guards the executive-summary endpoints (`proyectos/initiatives/executive-summary/executive-summary.controller.ts`) |
| `create:epic` | `proyectos/epics/epics.controller.ts:77`; the whole epic-generation SSE surface (`proyectos/epics/generation/epic-generation.controller.ts`) |
| `edit:epic` | `proyectos/epics/epics.controller.ts:84, 124, 161` |
| `delete:epic` | `proyectos/epics/epics.controller.ts:95` |
| `approve:epic_po` / `approve:epic_tl` / `approve:qa` | `proyectos/epics/epics.controller.ts:197, 213, 229` |
| `create:story` | `proyectos/stories/stories.controller.ts`; the story-generation SSE surface (`proyectos/stories/generation/story-generation.controller.ts`) |
| `edit:story` | `proyectos/stories/stories.controller.ts`; all three story-dependency routes (`proyectos/stories/dependencies/story-dependencies.controller.ts`) |
| `delete:story` | `proyectos/stories/stories.controller.ts` |
| `create:diagram` / `edit:diagram` | `proyectos/diagrams/generation/diagram-generation.controller.ts` |
| `manage:documents` | `documents/documents.controller.ts`; `proyectos/changelog/changelog.controller.ts`; the three vault **write** routes (`vault/vault.controller.ts:89, 135, 151`) |
| `manage:users` | `proyectos/migration/vault-migration.controller.ts:32, 55, 76` — plus the web server actions, see [Assigning roles and Pods](#assigning-roles-and-pods) |
| `manage:integrations` | `integrations/integrations.controller.ts`; `code-repositories/code-repository.controller.ts`; `vault/vault-config.controller.ts`; `proyectos/pods/pods.controller.ts`; the `publish-to-tracker` routes of initiatives, epics and stories. Also the vault ReBAC bypass (`vault/guards/vault-access.guard.ts:38-41`) |
| `manage:diagram-theme` | `diagram-theme-settings/diagram-theme-settings.controller.ts` |
| `manage:agent-tokens` | `agent-token-settings/agent-token-settings.controller.ts` |
| `manage:external_secrets` | `external-secrets/external-secrets.controller.ts` |
| `manage:branding` | `branding-settings/branding-settings.controller.ts` (the three write routes only) |

`manage:integrations` is by far the most load-bearing permission in the system: it
controls the Forge's target repository, the vault configuration, Pod CRUD, tracker
publishing, and it bypasses vault access control outright. Treat it as
admin-equivalent — which it is, since only `alta_gerencia` holds it.

---

## Vault access (ReBAC)

The [vault](glossary.md#vault) has its own guard, `VaultAccessGuard`
(`apps/api/src/modules/vault/guards/vault-access.guard.ts`), applied per route with
`@UseGuards` on ten endpoints of `vault/vault.controller.ts` (`:65, 72, 81, 88, 101,
108, 115, 123, 134, 150`). It runs **after** the global guards, so the user is already
authenticated and their `@Permissions`, if any, already satisfied.

It performs **two independent denials**, and a request must clear both.

Before either, two short-circuits:

- No `request.user` → 403 *"Not authenticated"* (`:33-35`). Defense in depth; the JWT
  guard should already have rejected this.
- The user holds `manage:integrations` → allowed unconditionally (`:38-41`). Vault
  admins skip both checks.

Then the guard **re-resolves the target vault from the request** (`:58-81`). If the
request carries `?vaultId=`, the checks run against *that* vault; otherwise against the
active one. This is what prevents a broken-object-reference attack: without it, a user
authorized for the active vault could pass another vault's id and operate on a vault
their Pod cannot reach. Only `query.vaultId` is consulted, never `body.vaultId`, because
every handler resolves its own target from the query string — reading the body would let
an attacker point the guard at one vault and the handler at another (`:49-57`). A
missing or unknown id is reported as 403 *"No tienes acceso a este vault o el vault no
existe."*, not 404, so the guard does not leak which vaults exist (`:64-71`). With no
`?vaultId=` and no active vault configured: 403 *"No hay vault activo configurado.
Contacta a un administrador."* (`:75-79`).

**Denial 1 — Pod intersection** (`:85-97`). If the target vault's `allowedPodIds` is
non-empty, the user's `pod_ids` must intersect it. An empty array means "no restriction"
(`apps/api/prisma/schema.prisma:377`, on `model VaultConfig` at `:357`). On failure the
guard logs the user, role and Pod counts — never the ids — and throws 403:

> *"No tienes acceso a este vault. Tu pod no está en la lista de pods permitidos."*
> ("You do not have access to this vault. Your pod is not in the list of allowed pods.")

**Denial 2 — the role map, deny-by-default** (`:99-114`). The vault carries a
`roleDefaults` JSON column, shaped `Record<UserRole, AccessLevel>`
(`schema.prisma:371-374`). **If that map has any entries at all**, the user's role must
map to one of `owner`, `editor` or `viewer` (`ALLOWED_ACCESS_LEVELS`, `:11`). A role
that is absent from the map, or present with the value `none`, is denied:

> *"Tu rol no tiene acceso configurado para este vault."*
> ("Your role has no configured access to this vault.")

The two together are the whole of what the server enforces. Note the asymmetry that
makes deny-by-default real: an **empty** `roleDefaults` skips the check entirely, but a
**partially filled** one denies every role you forgot to list. Configure all five or
none. Both fields are edited in Settings → Integraciones → **Vault**
(`/factory/settings?section=vault`), behind `manage:integrations`
(`vault/vault-config.controller.ts`).

One route of that controller is authenticated but not Pod-gated: `GET /vault/config`
carries no `@UseGuards(VaultAccessGuard)` (`vault/vault.controller.ts:58-62`). It
returns the connection summary only — owner, repo, branch, connected — and no document
content.

### The access levels, and what inheritance really means

`AccessLevel` is `owner | editor | viewer | none`, ranked 3/2/1/0
(`packages/shared/src/types/access.ts:5-12`). The per-role default is `owner` for
`alta_gerencia`, `editor` for `product_owner` and `tech_lead`, `viewer` for `qa` and
`viewer` (`access.ts:61-67`). The UI labels them *"Admin"*, *"Editor"*, *"Lector"*
("Reader") and *"Sin acceso"* ("No access") (`access.ts:14-19`).

> [!IMPORTANT]
> **Per-folder ACLs and their inheritance are a client-side feature.** The shared types
> describe a richer model — `AccessControlEntry` with a `nodeId`, a principal that can
> be a user or a role, an `inherited` flag and an `inheritedFrom` pointer, plus
> `NodeAccessConfig.inheritFromParent` (`packages/shared/src/types/access.ts:28-46`).
> Nothing on the server consumes it: there is no ACL table in `schema.prisma`, no
> endpoint that reads or writes one, and the only consumers in the whole repository are
> two web client files: `DefinicionesContext`, which resolves an effective level in
> browser memory (`apps/web/src/context/DefinicionesContext.tsx:552-604`), and the
> `AccessEntryRow` component that renders it
> (`apps/web/src/components/definiciones/AccessEntryRow.tsx`).
>
> So: a folder shown as restricted in the vault reader is restricted **in that browser
> tab**. The server-side boundary is the vault, not the folder — the two denials above.
> Do not treat folder inheritance as a security guarantee. See also
> [`glossary.md#rebac`](glossary.md#rebac).

---

## Assigning roles and Pods

Both the role and the Pod list are **Auth0 `app_metadata`**, not rows in CENZONTLE's
database. They reach the API only as JWT claims.

**Where the claims come from.** The post-login Action copies
`app_metadata.role` and `app_metadata.pod_ids` onto the token as
`https://cenzontle.app/role` and `https://cenzontle.app/pod_ids` (plus `email`, `name`
and `picture`), defaulting the role to `viewer` when the metadata is absent. The Action
source, and the steps to deploy it, are in
[`auth0-setup.md` § 3](auth0-setup.md#3-create-the-post-login-action-injects-role--pods).
The very first admin is bootstrapped by hand in the Auth0 dashboard — there is no user
seed ([`auth0-setup.md` § 4](auth0-setup.md#4-create-your-first-admin-user)). The
matching env vars are documented in [`configuration.md`](configuration.md).

**Where you change them afterwards.** Settings ("Configuración") → Ecosistema →
**Equipo** ("Team") (`/factory/settings?section=team`), listed at
`apps/web/src/components/factory/settings/SettingsDashboard.tsx:142`. Pods themselves
are created one item above, in Settings → Ecosistema → **Células** ("Pods")
(`?section=pods`, `SettingsDashboard.tsx:141`).

That screen does **not** go through the NestJS API. It calls Next.js server actions in
`apps/web/src/actions/users.ts`, which write to the Auth0 Management API
(`apps/web/src/lib/auth0-management.ts:171-179` for the role, `:194-201` for the Pods —
the Management API merges `app_metadata`, so writing `pod_ids` leaves `role` intact).
Each action re-checks `manage:users` server-side before writing
(`actions/users.ts:26-48`, called at `:85`, `:94`, `:120`, `:126`, `:137`, `:142`),
reading the role from the session claim and falling back to a Management API lookup when
the claim is missing.

**Reads are not gated the same way.** `getTeamMembers` (`actions/users.ts:74-77`) calls
`requireAuth()`, not `requirePermission`, so any authenticated user — a `viewer`
included — can retrieve the full roster from the Management API: every member's email,
role and `pod_ids`. Only the writes require `manage:users`. If that exposure is not
intended, the fix is to swap `requireAuth()` for
`requirePermission(Permission.MANAGE_USERS)` in that one function.

Three self-service guards are hard-coded, and one deliberate hole:

- You cannot change your own role (`actions/users.ts:97-99`), deactivate yourself
  (`:129-131`) or delete yourself (`:145-147`).
- You **can** change your own Pods. The code says so on purpose: joining or leaving a
  Pod does not cross a privilege boundary the way granting yourself a role would
  (`actions/users.ts:104-115`).

Also from that comment: the action does not verify that the Pod ids exist. Auth0 stores
opaque strings; the API validates the intersection against real Pods on every request,
so an orphaned id simply never matches anything.

**Changes take effect on the user's next login**, because the claims are minted by the
post-login Action. A role change does not revoke an access token already issued.

---

## Step-up authentication

Six operations re-verify the current user's password at the moment of the decision, on
top of an already valid session. They all funnel through
`AuthService.assertPasswordValid` (`apps/api/src/modules/auth/auth.service.ts:203-209`),
which wraps `verifyPassword` (`:64-196`) and turns a wrong password into a 401
*"Contraseña incorrecta"* ("wrong password").

| Operation | Call site |
| --- | --- |
| PO sign-off, TL sign-off, QA sign-off | `apps/api/src/modules/proyectos/epics/epics.service.ts:2329` |
| Staging gate approval | `apps/api/src/modules/factory/queue/factory-queue.service.ts:1214` |
| Release gate approval | `apps/api/src/modules/factory/qa/qa-gate.service.ts:71` |
| DEV branch alignment | `apps/api/src/modules/factory/branch-strategy/branch-strategy.service.ts:395` |

The mechanism is Auth0's Resource Owner Password Credentials grant, called with the M2M
client credentials (`auth.service.ts:131-147`). Consequences worth knowing:

- **It only works for Database connections.** SSO and social users cannot complete
  step-up; Auth0 masks the case as a wrong password.
- **A user with no `email` claim gets a 400 with a specific message** rather than a
  confusing failure (`:73-77`).
- **The issuer must be HTTPS.** If `AUTH0_ISSUER_URL` is plain HTTP the call aborts
  before the password leaves the process, returning 503 (`:118-129`).
- The step-up call is deliberately last, after every synchronous check, so cheap
  failures do not cost an Auth0 round trip (`epics.service.ts:2326-2329`).
- Retries re-verify. Approving the staging gate a second time after a failed merge asks
  for the password again — a stolen session cannot replay the endpoint
  (`factory-queue.service.ts:1210-1214`).

> [!WARNING]
> **Step-up is the one control in CENZONTLE that does not fail closed outside
> production.** When `AUTH0_M2M_CLIENT_ID` / `AUTH0_M2M_CLIENT_SECRET` are unset, the
> behavior forks on `NODE_ENV` and nothing else (`auth.service.ts:88-116`):
>
> - `NODE_ENV=production` → 503, and every sign-off and gate is blocked (`:110-115`).
> - **anything else, including unset — which the code reads as `development`
>   (`:102-103`) — → verification is skipped and the approval succeeds.** The API logs
>   a `[DEV BYPASS]` warning and returns `true` without ever contacting Auth0
>   (`:104-109`).
>
> The switch is the variable, not the hostname. A staging, demo or review instance that
> forgets `NODE_ENV=production` inherits the bypass: anyone holding a valid session can
> sign off an epic and walk a batch through both gates without typing a password. Set
> `NODE_ENV=production` on every deployment that is not your laptop, and configure the
> M2M credentials. Full breakdown:
> [`auth0-setup.md` § 5.3](auth0-setup.md#53-what-happens-if-you-skip-step-5-entirely).

Step-up proves *who is approving*. It does not replace the role check that runs beside
it — see [sign-off vs. gate](glossary.md#a-note-on-vobo) for which approvals sit on
which side of the pipeline.
