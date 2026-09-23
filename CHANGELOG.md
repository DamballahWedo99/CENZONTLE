# Changelog

Every notable change to CENZONTLE is documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org).

## How to read this file

- Each version groups its changes into **Added**, **Changed**, **Fixed**,
  **Deprecated**, **Removed** and **Security**.
- The **⚠️ Action required** block comes first in every version and lists what *you*
  have to do when you upgrade: apply database migrations, set new environment
  variables, or adjust your deployment. If you only read one part of a version, read
  that one.
- Entries describe what changes for someone who **uses** the project, not which files
  were touched.
- The application UI is in Spanish; this file is in English. Where an entry names a
  button or a screen, the literal Spanish label is in bold with an English gloss in
  parentheses, so you can match what you read against what is on screen. Domain terms
  are defined in [`docs/glossary.md`](docs/glossary.md).

---

## [Unreleased]

### Added

- **[`docs/glossary.md`](docs/glossary.md)** — the vocabulary CENZONTLE uses for
  itself, derived from the Prisma schema, the shared types and the `factory` module.
  When a document and the glossary disagree, the glossary wins.
- **`apps/api/tsconfig.seed.json`**, so `pnpm type-check` also type-checks
  `apps/api/prisma/`. That directory sat outside the type check, which is exactly why
  the database seed could stay broken without CI noticing.

### Changed

- **The documentation is now in English.** Every guide was translated from Spanish and
  corrected against the code in the same pass. The application itself is still in
  Spanish — the docs quote the literal UI labels so you can follow an English
  instruction against a Spanish screen.

### Fixed

- **Settings → Ecosistema → "Roles y permisos" reported saves it never made.** The
  screen rendered an editable role × permission matrix with a **Guardar cambios**
  ("Save changes") button, but the handler was an 800 ms timer that flipped a "Saved"
  badge and wrote nothing: the edits lived in React state and vanished on reload, while
  the server kept resolving permissions against the compile-time `ROLE_PERMISSIONS`
  constant. The section is now hidden behind `ROLES_SECTION_ENABLED`, and
  `?section=roles` falls back to the default section instead of rendering a blank
  panel. The component is untouched — the flag restores it once it has a server to talk
  to. Changing what a role may do still means editing
  `packages/shared/src/types/auth.ts` and redeploying.
- **An unknown `?section=` on the settings page left it blank.** The query parameter was
  cast straight to the section type without validation, so any unrecognized value
  selected nothing in the sidebar and rendered an empty panel. It is now checked against
  the real section list.
- **`prisma db seed` did not compile.** It referenced two models (`productOwner`,
  `podProductOwner`) that had been dropped from the schema, so it failed before it
  ever opened a connection. Rewritten: it now creates a small sample dataset — 2 pods,
  1 initiative, 1 epic, its 2 epic↔pod rows and 3 stories — and it is **idempotent and
  additive**. Everything is written with `upsert`, so re-running it is safe: it
  **never deletes, and never overwrites a row it did not create**. Pods are matched by
  name and left untouched if they already exist, and the epic `upsert` deliberately
  leaves every Forge timestamp alone, so it cannot resurrect or overwrite a batch in
  flight.
- **`pnpm clean` did nothing.** The root script called `turbo clean`, but no workspace
  declared a `clean` task and `turbo.json` did not define one. Each workspace now has
  its own `clean` script and the root command removes every workspace's build
  artifacts (`.next/`, `dist/`, `coverage/`, Playwright reports,
  `tsconfig.tsbuildinfo`) **and** the Turbo cache. It does not remove or reinstall your
  dependencies, your `.env*` files or the generated Prisma client; the only thing it
  deletes inside `node_modules/` is `node_modules/.cache/turbo`, part of that cache.
- **The end-to-end suite could not pass in a clean clone.** Playwright started only the
  Next.js server, while part of the suite fetches the NestJS backend directly. It now
  starts **two** servers — the API on `:3001` and web on `:3000` — waits on
  `/api/health` for the API, honors `WEB_PORT` for the real port the front end binds
  to (not just the URL the tests hit), and shuts the API down with `SIGTERM` so its
  shutdown hooks run and no preview child processes are orphaned.
- **Roughly 90 false statements in the documentation.** Screens that do not exist,
  navigation paths that lead somewhere else, environment-variable contracts that did
  not match the code, and commands described as doing something they did not do.

### Removed

- **`INTERNAL_API_KEY` is gone** from `apps/api/.env.example`, `apps/web/.env.example`,
  the bug-report issue template and the documentation. **No code reads it.** The BFF
  (Backend-for-Frontend) proxy in `apps/web` authenticates to the API by forwarding the
  user's own Auth0 access token, and the API validates that token in a globally
  registered `JwtAuthGuard` — one of the three `APP_GUARD` providers declared in
  `apps/api/src/modules/auth/auth.module.ts`, alongside `RolesGuard` and
  `PermissionsGuard`. The variable was a placeholder for a shared secret that the token
  relay made unnecessary, and it never enforced anything. If you run an existing
  deployment, delete it from both `.env` files — nothing changes.

---

## [0.1.0] - 2026-07-26

First public release of the monorepo. CENZONTLE is a project-management platform with
a software factory built in ("the Forge"): you define initiatives, epics and stories,
AI agents help you draft and diagram them, and the Forge dispatches those stories to a
fleet of workers that run Claude Code to implement them, verify them against a
Definition of Done, and carry them to a human release gate.

### ⚠️ Action required

This is the first release: if you are coming from a clone that predates publication,
treat it as an installation from scratch.

**Database — 47 Prisma migrations to apply**

```bash
pnpm --filter @cenzontle/api exec prisma migrate deploy
```

Without this the API starts, but returns `503` with the code `P2021`
(`relation "..." does not exist`) as soon as you touch any endpoint. Details and
troubleshooting in [`docs/database.md`](docs/database.md).

**Environment variables**

The `.env.example` files of 0.1.0 ask for these three, and all three are new if you
are coming from an earlier state of the project:

| Variable | What it's for | How to generate it |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection | The bundled `docker-compose.yml` uses `postgresql://cenzontle:cenzontle_dev@localhost:5432/cenzontle` |
| `VAULT_ENCRYPTION_KEY` | AES-256-GCM master key that encrypts **every** secret stored in the database (GitHub tokens, the Anthropic API key, external secrets) | `openssl rand -base64 32` |
| `INTERNAL_API_KEY` | Shipped as a shared secret between the `apps/web` BFF and the API — but inert, see the note below | **Do not set it.** It is removed in [Unreleased](#unreleased) |

Without `VAULT_ENCRYPTION_KEY` the API **does not start**: the encryption service
fails at boot (`VAULT_ENCRYPTION_KEY missing or too short`) instead of falling back to
an insecure default key. Rotating it invalidates everything already encrypted in the
database and requires manual re-encryption.

`INTERNAL_API_KEY` had to carry **exactly the same value** in `apps/api/.env` and
`apps/web/.env.local`, as both `.env.example` files asked. **It was never an access
control**: no component verifies it — the BFF authenticates by forwarding the user's
Auth0 access token, and the API validates that token in a global guard. The variable
is removed in [Unreleased](#unreleased); you can delete it from an existing
deployment without consequences.

With `NODE_ENV=production` the storage credentials become mandatory too
(`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`): if they are missing, the
API aborts at boot. Locally it only warns, and file operations fail until you
configure them.

**Auth0 is mandatory and has no development bypass.** Without the Auth0 variables set
in web and API, the middleware fails closed with `503` and you cannot even get in
locally. The step-by-step guide is in [`docs/auth0-setup.md`](docs/auth0-setup.md);
the full variable reference (including `REDIS_*`, `S3_*`, `ANTHROPIC_API_KEY` and the
optional step-up authentication variables `AUTH0_M2M_*`) is in
[`docs/configuration.md`](docs/configuration.md).

**Supporting services.** `docker compose up -d` brings up PostgreSQL 16, Redis 7 and
MinIO, which are the API's infrastructure dependencies (database, throttling and
session caching, and storage for documents and branding assets).

**Forge worker.** The `factory-worker` CLI runs AI-generated code on your machine. By
default it runs inside a sandbox (`sandbox-exec` on macOS, `firejail` on Linux).
Disabling it requires an explicit **double opt-in**:
`FACTORY_WORKER_SANDBOX_MODE=none` **and** `FACTORY_WORKER_ALLOW_NO_SANDBOX=1`; if the
second one is missing, the daemon starts but aborts every story before spawning the
agent. See [`docs/forge-worker.md`](docs/forge-worker.md).

### Added

#### Project management

- **The full work hierarchy**: initiatives → epics → user stories, with statuses,
  story points, dates, assignment to pods — **Células** ("Pods") in the UI — and a
  traceability matrix.
- **Definitions vault**: an in-house Tiptap editor backed by a GitHub repository, with
  a folder tree, a document graph view and a per-document changelog. The vault is the
  source of truth for content; CENZONTLE is its only writer.
- **AI epic generation**: a Claude agent drafts the epic from your context and leaves
  it versioned in the vault.
- **Story generation with three chained agents** (Product Owner → Tech Lead → QA): the
  PO proposes the scope, the Tech Lead adds the technical design and QA the test
  strategy. The number of stories is the agent's call based on the epic's real scope,
  with a defensive cap. Each story materializes as a vault folder holding its business
  definition, technical definition and testing strategy.
- **Dependencies and ordering between stories**: the Tech Lead emits a DAG of blockers
  (`blockedBy`), and discovered external dependencies are listed with hard/soft type
  badges; accepting a proposal refreshes the graph without a page reload.
- **AI-generated epic diagrams**, with a side panel of steps and a flow document saved
  to the vault, plus an XYFlow editor with Figma-style pan and zoom, custom nodes,
  configurable themes, persistence and autosave. Every node in the graph must be
  justified by at least one step of the document (validated range of 3 to 10 steps).
- **A Design tab on epics**, with a handoff to Claude that generates the visual
  reference the Forge later consumes.
- **Vault connections agent**: it reads every document, assigns thematic tags to the
  frontmatter and populates the graph view with real connections. It preserves
  existing tags and only accepts tags that connect between 2 and 5 documents.
- **Executive summaries per initiative**: the backend computes every metric from the
  database (progress, story points, distribution by status, load per pod, timeline,
  dependencies) and the AI only writes the executive reading, anchored to those
  figures, with a KPI block and five D3 visualizations (health, calendar versus
  progress, story distribution, load per pod and progress per epic). The AI never
  produces numbers.
- **Editing assistant sidebar**: a chat that reads the vault, the code and the
  documents, and proposes edits to initiatives, epics and stories as a diff you apply
  human-in-the-loop. The agent never writes directly — you accept every change.
  Sessions survive a browser reload.
- **Sign-off protocol** with three approvals (PO, Tech Lead, QA) and step-up
  authentication by password before approving. The button is **Dar VoBo** ("sign
  off"). Senior management (`alta_gerencia`) can sign off in any role, and the
  changelog keeps the real name of whoever approved.
- **Export of initiatives, epics and stories** to PDF, Excel, Word, CSV and JSON from
  the right-click context menu, with type-to-confirm on destructive actions.
- **Attached documents**: upload to S3, inline preview of PDFs and images on the
  cards, and a synchronized copy in the vault with the extracted text, so the agents
  can read them as context.
- **External secrets vault**: encrypted third-party credentials, automatically
  resolving the discovered dependency that motivated them. The API only ever returns
  the masked value.
- **Tracker-agnostic model**: projects can live with or without an external tool; when
  no integration is configured, the UI falls back to short internal identifiers and
  hides the tracker buttons.
- **Team, Approvals and Reports modules**, with chart dashboards and management of
  members and pods through the Auth0 Management API.

#### The Forge

- **Software factory command center**: a multi-batch dashboard, the Fleet Monitor on
  `/factory/agents`, and compute-node management in Settings ("Configuración") →
  Infraestructura → **Nodos de cómputo** ("Compute nodes")
  (`/factory/settings?section=nodes`).
- **`factory-worker` CLI**: registers against the dashboard with a worker token,
  exposes execution slots, and runs Claude Code in headless mode to implement stories.
  Ships preflight scripts that detect missing setup before the runner starts.
- **Five-stage pipeline** — In Queue → Forge → Staged → QA Testing → Released — with a
  visual board showing where every batch sits. The stage is derived from the epic's
  timestamps, never stored as an enum.
- **Forge queue**: you send a signed-off epic to the Forge with **Enviar al Forge**
  ("Send to the Forge"), and an LLM planner arranges its stories into waves that
  respect the dependency DAG.
- **Configurable Definition of Done**: evidence-based criteria, an adversarial
  verifier that judges each criterion against the diff, retries with backoff on
  infrastructure failures, a **differential** security scan (only new advisories
  against the base branch count against you) and a dedicated code-security verifier
  where only high-severity findings block.
- **Cross-story auto-merge** with automatic conflict resolution.
- **Staging gate**: human approval of the consolidated batch behind five defensive
  layers (pod intersection, role, password step-up, state readiness and optimistic
  concurrency control).
- **Batch previews**: brings the generated application up in an isolated environment,
  with an environment-variable allowlist (it never exposes the encryption key or the
  database connection string) and a bind to `127.0.0.1`.
- **Automated multi-agent QA pipeline**: when a batch merges, a campaign opens four
  lenses in parallel (the repository's test suite, e2e in an ephemeral preview
  environment, differential security, and performance/accessibility), verifies the
  findings adversarially — refuters that vote under a conservative majority rule —
  synthesizes a report with a rollout-or-rollback recommendation and an honest
  confidence score, and presents it at a human release gate with step-up
  authentication. One failing lens does not abort the campaign.
- **Dashboards on real data**, all fed by backend endpoints rather than sample data:
  - **Pull Requests**: which pull requests exist per story and per batch, crossed with
    live status and diffstat from GitHub, with an asymmetric TTL cache so the rate
    limit survives.
  - **Cost**: aggregated cost and tokens across every agent run (planner, generator
    and verifier, retries included) per batch and per story, with a 30-day run-rate
    projection and a **Costo de reintentos del DoD** ("Cost of DoD retries") panel that
    measures the waste of the verification loop. All figures are client-side SDK
    estimates, not billing.
  - **Logs**: an event stream derived from state that is already persisted (epic and
    run lifecycle, worker technical milestones and DoD verdicts), so it survives a
    restart of the API, the worker or the browser and is reconstructed retroactively
    for old batches.
  - **Velocity**: story-point estimates against measured effort (cost, duration and
    attempts), classified as over/calibrated/under-estimated, with a deviation badge
    in the story detail.
  - **QA**: campaign status, findings per lens, and release-gate approval.
- **Calibration loop back to the PO agent**: the numeric velocity aggregates are
  injected into the Product Owner's prompt so its next estimates learn from history.
- **Live agent terminal** (ttyd + tmux) to watch Claude Code working, with image
  upload, milestones, a summary when the run completes, and a per-agent detail drawer.
- **Per-agent AI settings** in Settings → Automatización → **Tokens IA** ("AI tokens")
  (`/factory/settings?section=agent-tokens`): every agent (PO, Tech Lead, QA, epics,
  diagrams, assistant, worker and DoD verifier) picks its own Claude model and effort
  level, from a live-verified model catalog, alongside the maximum number of DoD
  attempts and the maximum run duration.
- **Factory metrics** for cost and latency per agent.

#### Infrastructure and security

- **Turborepo + pnpm workspaces monorepo**: `apps/web` (Next.js 16, React 19,
  Tailwind 4, Radix UI), `apps/api` (NestJS 11, Prisma 7, PostgreSQL, Redis),
  `apps/worker` (the Forge CLI) and the shared packages `shared`, `ts-config` and
  `eslint-config`.
- **Auth0 authentication with the BFF pattern**: the browser never talks to the API
  directly; the front end proxies the calls server-side.
- **RBAC with five roles and 25 permissions** across the whole application, with a
  permission matrix you edit in the UI and enforcement on the server. Vault access
  adds a relationship layer (ReBAC) on top: the server checks that you belong to one
  of the vault's allowed pods and applies a deny-by-default role map. The richer
  per-folder ACL model is consumed by the web client only — do not read folder-level
  inheritance as a server-enforced guarantee.
- **AES-256-GCM encryption at rest** for every secret stored in the database.
- **Execution sandbox** for AI-generated code, specific to each operating system.
- **Git worktree isolation** for the agents, so two runs never step on each other's
  working tree.
- **Per-organization branding**: expanded logo, collapsed mark, favicon and name,
  configurable from the UI, with S3/MinIO storage compatible with AWS and R2. The
  browser title, the sidebar and the login screen react without a reload.
- **`docker-compose.yml`** with PostgreSQL 16, Redis 7 and MinIO to bring the whole
  local environment up.
- **Observability**: structured logging with Pino, with redaction of sensitive headers
  and fields; a Prisma exception filter that translates database errors into
  actionable messages (for example, "run `prisma migrate deploy`"); an S3 healthcheck
  at boot; and structured auditing of administrative mutations.
- **Throttling** of sensitive endpoints, stored in Redis and shared across replicas,
  with fail-open behavior if Redis goes down.
- **Onboarding documentation** following the Diátaxis framework in
  [`docs/`](docs/README.md): a getting-started tutorial, an explanation of the
  architecture, a configuration reference, and guides for Auth0, the database, the
  Forge worker and troubleshooting. Plus [`README.md`](README.md),
  [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).
- **Collaboration templates** in [`.github/`](.github): bug report, feature request,
  pull request template and Dependabot configuration.
- **Apache-2.0 license** ([`LICENSE`](LICENSE)), also declared in the `license` field
  of all seven `package.json` files in the monorepo. Third-party attributions —
  including the copyleft dependencies (LGPL, EPL, AGPL) and the single one whose
  license is not OSI-approved — live in [`NOTICES.md`](NOTICES.md), with the full
  texts in [`LICENSES/`](LICENSES). Life in the project is governed by the
  [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1).
- The Prisma client regenerates itself in the API's `postinstall`, so after a `pull`
  that brings new migrations the project compiles with no manual steps.

### Changed

- The repository went from a single Next.js application to a **Turborepo monorepo with
  a NestJS backend**. Commands now run from the repo root (`pnpm dev`, `pnpm build`,
  `pnpm test`) or per workspace with `--filter`.
- The vault was **restructured into a nested hierarchy**
  (`iniciativas/<slug-id>/epics/<slug-id>/` with subfolders for diagrams, documents,
  dependencies, matrices and stories), so the agents automatically read all of an
  epic's material before proposing stories. Migrating existing vaults is idempotent
  and is triggered from an admin endpoint.
- **Epics and stories collapsed their separate fields into a single markdown document**
  per entity, which simplifies both editing and vault synchronization.
- The **Forge dashboards stopped showing sample data**: Pull Requests, Cost, Logs and
  Velocity consume real endpoints, and the views that still have no data source show an
  honest empty state instead of invented figures.
- The per-component efficiency panel was replaced by **Costo de reintentos del DoD**
  ("Cost of DoD retries"): cost per thousand tokens was a constant of the model and not
  actionable; the waste of the verification loop is.
- A DoD verifier failure now marks the criterion **skipped**, not failed: an error in
  the measuring instrument does not penalize the agent that wrote the code.
- The definitions editor stopped depending on Obsidian and became an **in-house
  Tiptap-based editor** inside the application.
- The vault selector moved into Settings → Integraciones → **Vault**
  (`/factory/settings?section=vault`) and the action was renamed to **Vincular**
  ("Link"), to make clear that it associates an existing repository rather than
  creating one.
- The design reference now travels **inline in the prompt** of the agent that writes
  the code, because the worker runs Claude Code without vault tools and could not read
  it any other way. That is what makes the output faithful to the design.
- **A fresh install now really does start empty.** Sprints and ceremonies used to be
  initialized with invented data that no API ever replaced, and the detail of a Forge
  batch showed fixed sample epics. Both now start empty, and the UI shows its
  corresponding empty state until real information exists.
- The example that guides the epic agent was rewritten around a **fictional domain**.
  The format and the level of detail are the same — the quality of what it generates
  depends on them — but it no longer describes any real organization's operation.

### Fixed

- The Forge cost dashboard crashed with `Cannot read properties of undefined` and,
  when it did not crash, showed fictional data.
- The Forge logs view stayed permanently empty with the message *"Logs del Forge sin
  conectar"* ("Forge logs not connected").
- Previews of Vite projects rendered a blank page (they are now served by the dev
  server instead of statically), and preview processes were orphaned when the API shut
  down (they are now killed by process group and on `SIGINT`/`SIGTERM`).
- Valid epics were reported as *"definición incompleta"* ("incomplete definition")
  because the headings the front end required did not match the backend's.
- Reloading `/factory/settings` redirected to `/factory`, because the authentication
  gate evaluated permissions before the session had finished loading.
- The D3 charts caused a hydration mismatch during server rendering.
- `pnpm lint` failed in the `web` and `shared` workspaces because of ESLint
  configurations that did not exist.
- The Next.js build broke on the Definitions page because it used `useSearchParams()`
  without a `Suspense` boundary.
- The diagram agent could emit decorative nodes with no step to justify them, and the
  declared range of 3 to 10 steps was only a suggestion in the prompt: both are now
  validated, and an incoherent diagram is rejected.
- The PO agent hallucinated vault paths when the prompt asked it to read material the
  epic did not have; it now discovers the real paths before reading.
- Agent responses were truncated mid-JSON when they hit the output token limit.
- Short internal identifiers now replace the empty dash that showed up in seven places
  in the UI when no external tracker was configured.
- Links to Forge branches and pull requests pointed at a hard-coded repository, so they
  404'd for anyone who configured their own. They are now derived from the configured
  repository, and when there is none they render plain text instead of a broken link.
- Three Forge views called `useMemo` conditionally, after an early return. React
  identifies hooks by call order, so that order shifted when the view went from
  "loading" to "loaded" — and in two of them the affected hook was the one validating
  the scheme of the URL loaded into an `iframe`.
- A batch's metrics card read the clock during render, which made the render impure and
  could cause hydration mismatches.

### Security

- **Prompt injection (CWE-1427)**: user-written text is escaped before it reaches the
  generating agents, and the content of vault documents and paths is injected with
  banners that mark it explicitly as data, not instructions.
- **Object-level authorization by pod (CWE-639 / BOLA)** on initiatives, epics and
  stories, fail-closed: someone with no pods assigned sees nothing, and `findOne`
  returns `404` instead of `403` so it does not leak the existence of identifiers. The
  agents that emit events authorize against the **union** of the epic's pods and its
  stories' pods, closing a leak on epics with no pods of their own. Creating or
  reassigning content into another pod is blocked too.
- **Path traversal**: guards on vault path resolution, on design references and on
  prior flow documents.
- **Secrets**: AES-256-GCM encryption with key derivation and a random IV per
  operation; the plaintext value is never returned over HTTP and never written to
  logs. The diff is scanned before every push, reserved variable names are blocked, and
  secrets are scrubbed (`scrubSecrets`) from tool output, from the agents' visible
  reasoning and from QA evidence. The worker sandbox denies the agent any read of the
  host's credentials (`~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.netrc`, `~/.npmrc` and
  friends), and the authenticated clone URL is redacted from logs and error messages
  before it reaches the backend or the UI.
- **YAML injection** in the vault frontmatter and **log injection (CWE-117)**
  neutralized with strict normalization.
- **Branding assets**: only raster images are accepted (no SVG, to avoid XSS), magic
  bytes are validated against the declared type, and they are served with `nosniff`, a
  restrictive CSP and `Content-Disposition: inline`.
- **Agent terminal**: three layers of defense against shell escape, plus a JSONL audit
  log.
- **Worker guard fail-closed** by default, and forced completion blocked when
  `NODE_ENV=production`.
- **Throttling** on `verify-password` and on the approval endpoints.
- Destructive operations (such as realigning the development branch against `main`)
  protected by role and password step-up.
- Vulnerability reporting policy published in [`SECURITY.md`](SECURITY.md).

---

## A note on stability

CENZONTLE is **pre-1.0**. While the major version is `0`, any minor release can bring
breaking changes: API endpoints, payload shapes, the database schema, environment
variable names and the shared type contracts can all change with no deprecation
period. Pin a specific version if you build on top of this, and read the **⚠️ Action
required** block of every release before you upgrade.

<!--
  There is no `v0.1.0` git tag yet, and the root `package.json` declares no `version`.
  The 0.1.0 link points at the commit that published the repository, so it keeps
  resolving to that state once `main` moves on. Replace both links with tag
  comparisons the day tags exist.
-->

[Unreleased]: https://github.com/DamballahWedo99/CENZONTLE/commits/main
[0.1.0]: https://github.com/DamballahWedo99/CENZONTLE/commit/42437e8de2ec40d6aa964783928421e3e2a54648
