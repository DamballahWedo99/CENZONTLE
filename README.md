<div align="center">

# 🐦 CENZONTLE

**A software factory and project-management platform.**
Generate initiatives, epics and stories with AI, then let the *Forge* — a fleet of
workers running headless Claude Code — implement, test and release them end to end.

Turborepo + pnpm monorepo · Next.js 16 · NestJS 11 · Prisma 7 · PostgreSQL

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/DamballahWedo99/CENZONTLE/ci.yml?branch=main&label=CI)](https://github.com/DamballahWedo99/CENZONTLE/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.19-brightgreen.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9.15%2B-f69220.svg)](https://pnpm.io/installation)

</div>

---

## Table of contents

- [What is this?](#what-is-this)
- [Architecture in 30 seconds](#architecture-in-30-seconds)
- [Quick Start](#quick-start) — from `git clone` to the app running
- [Commands](#commands)
- [Documentation](#documentation)
- [Tech stack](#tech-stack)
- [Repo structure](#repo-structure)
- [Project status](#project-status)
- [Contributing](#contributing)
- [License](#license)

---

## What is this?

CENZONTLE is a platform with two halves:

1. **Project management** — initiatives → epics → stories, generated and edited
   by AI agents (Product Owner, Tech Lead, QA), with diagrams, a knowledge vault
   and an editing assistant.
2. **The Forge (software factory)** — a fleet of *workers* that claim stories and
   implement them with headless Claude Code, open pull requests, verify them
   (Definition of Done), test them (automated QA pipeline) and drive them to
   *Released* — with human gates at the critical points.

> If you just want to **run it and poke around**, go straight to the
> [Quick Start](#quick-start).

> [!WARNING]
> **Read this before you bring up a worker.**
> - `apps/worker` runs Claude Code with `--dangerously-skip-permissions`: the agent
>   runs commands on your machine without asking you to confirm. The real isolation
>   comes from the OS sandbox (`sandbox-exec` on macOS, `firejail` on Linux),
>   **not** from the CLI.
> - On Linux, `firejail` is **not** installed by default — install it with your
>   distro's package manager. Running without a sandbox takes an explicit double
>   opt-in (`FACTORY_WORKER_SANDBOX_MODE=none` **and**
>   `FACTORY_WORKER_ALLOW_NO_SANDBOX=1`); if the second one is missing, the daemon
>   starts but aborts every story before spawning the agent.
> - The agents consume the Anthropic API with **your** API key and **there is no
>   spending cap**. The DoD verifier retries when a story fails, which roughly
>   doubles its cost. Start with one small story.
> - The project-management app (`apps/web` + `apps/api`) works **without** bringing
>   up a single worker: if you only want to explore the platform, none of the above
>   applies to you.
>
> The full security model is in **[SECURITY.md](SECURITY.md)**.

---

## Architecture in 30 seconds

```
┌────────────┐      BFF proxy       ┌────────────┐      Prisma      ┌──────────────┐
│  apps/web  │ ───────────────────▶ │  apps/api  │ ───────────────▶ │  PostgreSQL  │
│  Next.js   │  (:3000)             │  NestJS    │  (:3001)         │  (:5432)     │
└────────────┘                      └─────┬──────┘                  └──────────────┘
      ▲                                   │  ├─ Redis (:6379)      rate limiting + cache
      │ Auth0 (OIDC)                      │  ├─ MinIO/S3 (:9000)   branding + documents
      │                                   │  └─ Anthropic API      AI agents
                                          │
                                          │  claim-story / heartbeat
                                          │
                                   ┌──────┴─────────┐
                                   │  apps/worker   │  Forge fleet (optional)
                                   │ factory-worker │  runs headless Claude Code
                                   └────────────────┘
```

`packages/shared` holds the types shared by web, api and worker. Full detail in
**[docs/architecture.md](docs/architecture.md)**.

---

## Quick Start

> The guaranteed happy path for running everything locally. The step-by-step
> version, with explanations and troubleshooting, is in
> **[docs/getting-started.md](docs/getting-started.md)**.

**Prerequisites:** [Node.js 22.19+](https://nodejs.org), [pnpm 9.15+](https://pnpm.io/installation)
(`corepack enable`), [Docker](https://docs.docker.com/get-docker/) and an
[Auth0](https://auth0.com) account (login is mandatory — see
[docs/auth0-setup.md](docs/auth0-setup.md)).

```bash
# 1. Clone
git clone https://github.com/DamballahWedo99/CENZONTLE.git && cd CENZONTLE

# 2. Set the environment variables — BEFORE installing: the postinstall runs
#    `prisma generate`, which reads DATABASE_URL from apps/api/.env and fails without it.
cp apps/api/.env.example   apps/api/.env
cp apps/web/.env.example   apps/web/.env.local
#   → edit both: paste your Auth0 credentials and generate the secrets:
#     openssl rand -base64 32   # VAULT_ENCRYPTION_KEY (api)
#     openssl rand -hex 32      # AUTH0_SECRET (web)

# 3. Install
pnpm install                              # postinstall runs `prisma generate`

# 4. Bring up the local services (Postgres + Redis + MinIO) with one command
docker compose up -d                      # creates the MinIO bucket automatically

# 5. Migrate the database
pnpm --filter @cenzontle/api exec prisma migrate deploy

# 6. Start web + api
pnpm dev
```

Open **http://localhost:3000** → you get redirected to the Auth0 login → after you
authenticate you land on `/proyectos`. The API exposes Swagger at
**http://localhost:3001/api/docs**.

> **Your first admin user** is created in the Auth0 dashboard (there is no user
> seed). Give it `app_metadata.role = "alta_gerencia"` and deploy the post-login
> Action. Exact steps: **[docs/auth0-setup.md](docs/auth0-setup.md)**.

Something broken? → **[docs/troubleshooting.md](docs/troubleshooting.md)**.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Builds `shared`, then runs dev for **web + api** (the one you'll use most) |
| `pnpm dev:web` | Frontend only |
| `pnpm dev:api` | Backend only |
| `pnpm dev:unsafe` | Turbo `dev` across **every** workspace (adds `shared` in watch mode and the worker CLI) |
| `pnpm build` | Production build of everything |
| `pnpm lint` | ESLint across every workspace |
| `pnpm test` | Tests (Jest in api, Vitest in web and worker) |
| `pnpm type-check` | Type checking (all workspaces) |
| `pnpm clean` | Removes every workspace's build artifacts (`.next/`, `dist/`, `coverage/`, Playwright reports, `tsconfig.tsbuildinfo`) **and** the Turbo cache |

`pnpm clean` does **not** remove or reinstall your dependencies, your `.env*` files,
the generated Prisma client (which lives under `node_modules/`) or the Turbo daemon.
The only thing it deletes inside `node_modules/` is `node_modules/.cache/turbo`, which
is part of the Turbo cache.

Per workspace: `pnpm --filter @cenzontle/<web\|api\|worker\|shared> <script>`.

---

## Documentation

The documentation follows the **[Diátaxis](https://diataxis.fr)** framework
(tutorial / how-to / reference / explanation). Full index:
**[docs/README.md](docs/README.md)**.

| Doc | Type | What it's for |
|---|---|---|
| **[docs/getting-started.md](docs/getting-started.md)** | Tutorial | From zero to the app running and logged in, step by step |
| **[docs/glossary.md](docs/glossary.md)** | Reference | The vocabulary the rest of the docs assume — Forge, batch, wave, sign-off, gate, lens — derived from the schema and the shared types |
| **[docs/architecture.md](docs/architecture.md)** | Explanation | How it all fits together: monorepo, apps, the Forge, data flow |
| **[docs/data-model.md](docs/data-model.md)** | Reference | The entities behind the product — initiatives, epics, stories, Pods, Forge runs — and how they relate |
| **[docs/api-reference.md](docs/api-reference.md)** | Reference | The API's HTTP surface: the endpoints, what they expect and what they return |
| **[docs/authorization.md](docs/authorization.md)** | Reference | Who is allowed to do what: roles, permissions, Pod boundaries and vault access |
| **[docs/configuration.md](docs/configuration.md)** | Reference | Every environment variable the code reads, and the external services behind them |
| **[docs/auth0-setup.md](docs/auth0-setup.md)** | How-to | Configure Auth0 and create the first admin user |
| **[docs/database.md](docs/database.md)** | How-to | Prisma: migrations, the seed, the dual-Postgres trap |
| **[docs/forge-worker.md](docs/forge-worker.md)** | How-to | Build, register and start a worker of the fleet |
| **[docs/troubleshooting.md](docs/troubleshooting.md)** | How-to | The common errors and how to fix them |
| **[SECURITY.md](SECURITY.md)** | How-to | Security model, the worker sandbox, and how to report a vulnerability |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | How-to | Git workflow, conventions, review and tests |
| **[CHANGELOG.md](CHANGELOG.md)** | Reference | What changed in each version, and what you have to do when you upgrade |
| **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** | Reference | How we treat each other in issues, pull requests and discussions |
| **[CLAUDE.md](CLAUDE.md)** | Reference | Repo conventions (for humans and for Claude Code) |

The documentation is in English; the application UI is still in Spanish. Wherever a
doc names something on screen it quotes the literal Spanish label with an English
gloss, so you can match what you read against what you see.

---

## Tech stack

| Area | Technologies |
|---|---|
| **Frontend** (`apps/web`) | Next.js 16, React 19, Tailwind 4, Radix UI, Tiptap, XYFlow, D3, Zod |
| **Backend** (`apps/api`) | NestJS 11, Prisma 7, PostgreSQL, Redis, Swagger, pino — agent output streams over SSE (`socket.io` is still in `package.json`, but no gateway uses it) |
| **Worker** (`apps/worker`) | TypeScript + Commander (the `factory-worker` CLI), runs headless Claude Code |
| **AI** | Anthropic Claude (SDK) — epic, story and diagram generation, the Forge, QA |
| **Dev infrastructure** | Docker Compose (Postgres 16 · Redis 7 · MinIO), Auth0 (OIDC) |
| **Tooling** | Turborepo, pnpm workspaces, ESLint 9, Jest, Vitest, Playwright |

---

## Repo structure

```
apps/
  web/      → Next.js (frontend + BFF proxy to the API)
  api/      → NestJS (REST + SSE + Prisma + AI agents)
  worker/   → the `factory-worker` CLI (the Forge fleet)
packages/
  shared/        → shared types (tsup: CJS + ESM)
  ts-config/     → base TypeScript configs
  eslint-config/ → shared ESLint config
docs/         → documentation (Diátaxis)
docker-compose.yml  → Postgres + Redis + MinIO for local dev
```

---

## Project status

**Version 0.1.0.** CENZONTLE is designed and tested for **local development**: the
[Quick Start](#quick-start) is the supported path, and there is no production
deployment guide yet.

- **The API carries no stability guarantee.** The REST endpoints, the SSE event
  streams and the types in `packages/shared` can change without notice between
  versions. Do not build integrations on top of them assuming they will stay as
  they are.
- The database schema evolves through Prisma migrations; to update, run
  `prisma migrate deploy` (see [docs/database.md](docs/database.md)).
- `pnpm type-check`, `pnpm lint`, `pnpm test` (Jest in `api` + Vitest in `web` and
  `worker`) and `pnpm build` pass on a clean checkout. If one of them fails on a
  fresh clone, that's a bug:
  [open an issue](https://github.com/DamballahWedo99/CENZONTLE/issues/new/choose).
- Test coverage is uneven: the backend is well covered (874 Jest cases across 49
  suites) and the worker reasonably so (134 Vitest cases across 7 files), the
  frontend much less (165 Vitest cases, 9 of its 11 test files concentrated in the
  diagram layout). Green tests say very little about the React components; review
  those by hand.
- The Forge is validated end to end locally (implementation, pull request, DoD
  verification and the QA pipeline), but it is the youngest part and the one that
  demands the most care — read the warning above and
  [SECURITY.md](SECURITY.md).

---

## Contributing

Feature branches, pull requests to `main`, commits with a prefix (`Feat:`, `Fix:`,
`Refactor:`, `Docs:`, `Test:`, `Chore:`). The detail — conventions, the checks your
change has to pass and how it gets reviewed — is in
**[CONTRIBUTING.md](CONTRIBUTING.md)**. By taking part you accept the
**[Code of Conduct](CODE_OF_CONDUCT.md)**.

The documentation in this repo is written in **English**. Issues and pull requests
are welcome **in English or Spanish**: use the language you express yourself best
in, nobody is going to turn down a contribution over that.

**Where do you ask for help?**

| I want to… | Go to |
|---|---|
| Report a bug or propose a feature | [Issues](https://github.com/DamballahWedo99/CENZONTLE/issues/new/choose) |
| Ask something, discuss ideas or show what you built | [Discussions](https://github.com/DamballahWedo99/CENZONTLE/discussions) |
| Report a vulnerability (**never** in a public issue) | [Private security report](https://github.com/DamballahWedo99/CENZONTLE/security/advisories/new) · [SECURITY.md](SECURITY.md) |

---

## License

Distributed under the **Apache-2.0** license — see **[LICENSE](./LICENSE)**.
Third-party attributions and licenses are in **[NOTICES.md](NOTICES.md)**.
