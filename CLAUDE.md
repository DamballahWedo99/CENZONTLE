# CENZONTLE

Software factory and project management platform. Turborepo monorepo with pnpm
workspaces. Requires Node >= 22.19.0 and pnpm >= 9.15.0.

The documentation is in English; the application UI is still in Spanish. Never
translate a user-facing string as a side effect of another change.

Domain vocabulary (Forge, batch, wave, Pod, gate, sign-off, vault, DAG) is defined in
[`docs/glossary.md`](docs/glossary.md). Use those terms exactly.

## Structure

```
apps/
  web/     → Next.js 16 + React 19 + Tailwind 4 + Radix UI
  api/     → NestJS 11 + Express + Swagger + Prisma 7 (PostgreSQL)
  worker/  → factory-worker daemon: registers a compute node, claims stories and runs
             Claude Code headless inside an OS sandbox
packages/
  shared/  → Shared types (tsup: CJS + ESM)
  ts-config/     → Base TypeScript configs
  eslint-config/ → Shared ESLint configs
```

## Commands

```bash
pnpm dev          # Builds @cenzontle/shared, then starts web + api
pnpm dev:web      # Frontend only (also pre-builds shared)
pnpm dev:api      # Backend only (also pre-builds shared)
pnpm dev:unsafe   # turbo dev with no --filter: dev in every workspace, worker included
pnpm build        # Production build
pnpm lint         # Lint every workspace
pnpm test         # Test every workspace
pnpm type-check   # Type checking
pnpm clean        # Removes all workspace build artifacts + Turbo cache
```

`pnpm clean` does not remove or reinstall the installed dependencies, `.env*` files,
the generated Prisma client (which lives under `node_modules/`) or the Turbo daemon.
The only thing it deletes inside `node_modules/` is `node_modules/.cache/turbo`, part
of the Turbo cache (`package.json:14`).

`dev:unsafe` is plain `turbo dev`. It drops both the explicit `@cenzontle/shared`
pre-build and the `--filter` flags, so the `dev` task starts in *every* workspace —
`@cenzontle/worker` included, and `@cenzontle/shared` in `tsup --watch` mode.
`shared` still gets built before anything else either way: the `dev` task declares
`dependsOn: ["^build"]` in `turbo.json`. Prefer `pnpm dev` unless you specifically
want a worker running.

### Per workspace

```bash
# Web
pnpm --filter @cenzontle/web dev
pnpm --filter @cenzontle/web build
pnpm --filter @cenzontle/web lint

# API
pnpm --filter @cenzontle/api dev
pnpm --filter @cenzontle/api build
pnpm --filter @cenzontle/api test

# Worker
pnpm --filter @cenzontle/worker build
pnpm --filter @cenzontle/worker dev

# Shared
pnpm --filter @cenzontle/shared build
```

## Code conventions

### TypeScript

- Strict mode enabled everywhere: every workspace extends
  `@cenzontle/ts-config/base.json`, which sets `strict: true`.
- Web: `@/*` maps to `./src/*` (Next.js alias).
- API: no path aliases, standard Node resolution.
- Worker: native ESM (`"type": "module"`), so relative imports and dynamic
  `import()` behave differently there than in the API.
- Shared exports CJS + ESM with type declarations.

### Naming

- Directories: kebab-case (`app/factory/agents`, `modules/proyectos`,
  `modules/external-secrets`).
- React components: PascalCase (`AgentCard.tsx`, `BatchDetail.tsx`).
- NestJS modules: kebab-case under `modules/<feature>/`.
- Shared types: PascalCase for interfaces and types; the files that hold them are
  kebab-case.

### Imports

- Workspace dependencies use `workspace:*` in package.json.
- Import shared types from `@cenzontle/shared`.
- Import UI components from `@/components/ui/` (Radix UI wrappers).
- Keep relative imports shallow. In web and worker, never climb past `../../` — reach
  for the `@/*` alias instead. The API has no alias, so nested modules reach
  `src/common/` and `src/lib/` with `../../../` (and `../../../../` from
  `modules/proyectos/diagrams/generation/`); that is the established pattern there.

### Frontend style

- Tailwind CSS 4 for styling, no CSS modules.
- Radix UI as the component base.
- Lucide React for icons.
- React Context API for state (no Redux, no Zustand).
- Visualizations with D3 and XYFlow (`@xyflow/react`); graph layout with elkjs, edge
  routing with libavoid-js. Dagre is not a dependency.

### Backend style

- One NestJS module per feature (`modules/proyectos`, `modules/factory`).
- Small modules are a controller + service + `dto/`. The two large ones (`factory`,
  `proyectos`) split into sub-feature folders that follow the same shape.
- Decorators enabled (`emitDecoratorMetadata`).
- class-validator for DTO validation.
- Swagger for API documentation, served at `/api/docs` only when `NODE_ENV` is not
  `production` (`apps/api/src/main.ts:52,60`).

### File organization

- Web: `app/` (routes), `components/`, `context/`, `hooks/`, `lib/`, `types/`,
  `actions/` (server actions), `config/`, `data/mock/`, plus `middleware.ts`.
- API: `modules/` (features), `common/` (guards, filters, DTOs, shared services,
  utils), `lib/`, and `main.ts` / `app.module.ts` / `health.controller.ts` at the root
  of `src/`.
- Shared: `src/types/` (domain models), `src/index.ts` (barrel export).

## Project modules

The API modules under `apps/api/src/modules/`:

- **proyectos**: the planning hierarchy — initiatives, epics, stories, Pods, story
  dependencies (the DAG), diagrams, executive summaries, the editing assistant, the
  changelog and vault migration.
- **factory**: the Forge — queue, fleet and worker API, Definition of Done, execution,
  QA pipeline, pull requests, cost, velocity, logs, metrics, previews, branch strategy
  and the agent terminal.
- **vault**: the markdown knowledge base backed by a GitHub repository, plus its
  encryption. Security-critical — `.github/CODEOWNERS` requires an owner review for
  any change under this path.
- **auth**: authentication, guards and role decorators.
- **external-secrets**: third-party API keys, encrypted at rest and forwarded to
  workers inside a claim.
- **code-repositories**: repository configuration, cloning and code search.
- **integrations**: external tracker and provider integrations.
- **documents**: file attachments and their storage.
- **agent-token-settings**: per-agent model and thinking-effort configuration.
- **org-anthropic-config**: the organization's Anthropic API key and model catalog.
- **branding-settings**: branding for the UI.
- **diagram-theme-settings**: diagram themes.
- **prisma**, **redis**: infrastructure modules, no controllers.

Note that `/equipo` is a web route, not an API module — team data comes from
`proyectos/pods` and `auth`.

## Commit rules

- Messages in Spanish or English, consistent within one PR.
- Prefixes: `Feat:`, `Fix:`, `Refactor:`, `Docs:`, `Test:`, `Chore:`.
- One branch per feature, never commit directly to `main`.
