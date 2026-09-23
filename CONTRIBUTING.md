# Contributing to CENZONTLE

Thanks for taking the time. This guide covers what you need to know to get your
contribution into `main`: how to find your way around the repo, which workflow to
follow, and which checks your change has to pass.

If this is your first time here, start with the
**[Getting Started](docs/getting-started.md)** guide: it takes you from `git clone`
to the app running and logged in in about 20–30 min. Don't read further until you
have it up — almost everything below assumes you can run the project.

The vocabulary this repo uses for itself — Forge, batch, wave, Pod, sign-off, gate —
is defined in [docs/glossary.md](docs/glossary.md). Use those terms exactly.

Participating means accepting the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## How you can help

Code isn't the only valuable contribution, and it isn't the scarcest one either:

- **Bug reproductions.** A minimal repro we can run is worth more than five vague
  reports. Confirming (or ruling out) a bug someone else reported helps enormously
  too.
- **Documentation.** If a setup step failed for you, if an `.env.example` doesn't
  explain what a variable is for, if `docs/troubleshooting.md` doesn't cover the
  error you hit — fix it. That pull request gets merged fast.
- **Translations.** The documentation is written in English, and English is the
  canonical version: corrections and new documents land there first. If you want to
  translate `docs/` or the README into another language, open an issue first so we
  can agree where those files would live; there is no structure for that yet.
  Issues and pull requests themselves are welcome in Spanish or English — use the
  language you express yourself best in.
- **Triage.** Answering issues, asking for the information that's missing, pointing
  out duplicates.
- **Code.** Bugs, agreed-on features, tests that don't exist yet.

---

## Where to start

Two GitHub labels mark work that's ready to pick up:

- **[`good first issue`](https://github.com/DamballahWedo99/CENZONTLE/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)**
  — bounded, with enough context to solve it without knowing the whole repo.
- **[`help wanted`](https://github.com/DamballahWedo99/CENZONTLE/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22)**
  — things we know are missing and won't get to any time soon. Usually bigger than
  the ones above.

Comment on the issue before you start working ("I'm taking this one") so nobody
duplicates the effort. If you've been at it a while and can't continue, say that
too: no hard feelings, but let it go free.

Nothing labeled catches your eye? Bring the project up and work through the
[Getting Started verification checklist](docs/getting-started.md#verification-checklist).
Anything that cost you more than it should have is a good first docs PR.

---

## Before you write code

**For large changes, open or comment on an issue first.** New functionality, a broad
refactor, a change to the Prisma schema, a new dependency, a change to an API
contract: describe what you want to do and why before you write it. It costs ten
minutes and avoids the two worst ways to waste time — duplicating what someone else
is already doing, or finishing a PR that won't be merged because it goes against a
decision that wasn't written down anywhere.

**Small, obvious fixes go straight to a PR.** A typo, a broken link, a one-line bug
with an evident cause, a confusing error message. No ceremony needed for that.

If you're unsure which side your change falls on, open the issue. It's the cheap
option.

---

## Reporting a bug

Issues use templates — pick the one that fits:

| Template | For |
|---|---|
| [🐛 Bug report](https://github.com/DamballahWedo99/CENZONTLE/issues/new?template=bug_report.yml) | Something doesn't work the way it should |
| [✨ Feature request](https://github.com/DamballahWedo99/CENZONTLE/issues/new?template=feature_request.yml) | An improvement or a new capability |

Usage questions and half-baked ideas go to
[Discussions](https://github.com/DamballahWedo99/CENZONTLE/discussions), not to
issues.

> [!WARNING]
> **Security vulnerabilities never go in a public issue.** Follow
> [SECURITY.md](SECURITY.md), which explains how to open a private report and which
> behaviors we already know about and are intentional (the worker running with broad
> permissions inside a sandbox, among others). Read it before you report: it saves
> you the work of documenting something that is already documented.

Before opening a bug issue, check
[docs/troubleshooting.md](docs/troubleshooting.md) — it covers most setup failures.
And when you paste logs, **strip the secrets** (worker tokens,
`VAULT_ENCRYPTION_KEY`, Anthropic keys, Auth0 keys).

---

## Where things live

A map to orient yourself without reading the whole repo. How the pieces fit together
is in [docs/architecture.md](docs/architecture.md).

| You want to touch… | Go to `…` |
|---|---|
| A frontend screen or route | `apps/web/src/app/` (App Router: `proyectos/`, `factory/`, `equipo/`, `login/`) |
| A UI component | `apps/web/src/components/` (the Radix primitives live in `components/ui/`) |
| Shared frontend state | `apps/web/src/context/` — React Context, scoped per route layout |
| The frontend's call into the API | `apps/web/src/app/api/proxy/[...path]/route.ts` (the BFF proxy) |
| **A new endpoint** | `apps/api/src/modules/<feature>/` — controller + service + `dto/` in the same module |
| Guards, filters, throttler, storage | `apps/api/src/common/` |
| The data model | `apps/api/prisma/schema.prisma` + the generated migration in `apps/api/prisma/migrations/` |
| **How the worker runs a story** | `apps/worker/src/lib/runner.ts` |
| Isolation of generated code | `apps/worker/src/lib/sandbox.ts` (`sandbox-exec` on macOS, `firejail` on Linux) |
| Definition of Done verification | `apps/worker/src/lib/dod-verifier.ts` and `dod-verifier-agent.ts` |
| The worker CLI (`register`, `start`) | `apps/worker/src/cli.ts` and `apps/worker/src/commands/` |
| **A type used by both web and api** | `packages/shared/src/types/` + export it from `packages/shared/src/index.ts` |
| Base TypeScript or ESLint config | `packages/ts-config/`, `packages/eslint-config/` |
| An environment variable | the workspace's `.env.example` **and** [docs/configuration.md](docs/configuration.md) |
| The documentation | `docs/` ([Diátaxis](https://diataxis.fr) framework) |

Where the tests go:

- **api** — Jest, `*.spec.ts` files **next to the code** they test.
- **web** and **worker** — Vitest, `*.test.ts` files next to the code (web also has
  `__tests__/` folders for the larger modules).
- **web end-to-end** — Playwright in `apps/web/e2e/`
  (`pnpm --filter @cenzontle/web test:e2e`; the first time, `test:e2e:install`
  pulls Chromium). They do **not** run in `pnpm test`. Prerequisites and the
  environment variables the suite reads are in
  [apps/web/e2e/README.md](apps/web/e2e/README.md).

### The `.claude/` directory

The repo versions the [Claude Code](https://claude.com/claude-code) configuration
the maintainers use. One detail worth knowing before it surprises you:

`.claude/settings.json` registers a `SessionStart` hook that runs
`.claude/hooks/start-dev-servers.sh` **automatically** when you open the project
with Claude Code. That script copies any missing `.env` files from the main repo
(only when you are in a worktree), runs `pnpm install` if `node_modules/` is
missing, builds `packages/shared` if its `dist/` is missing, runs `prisma generate`,
and finishes with a non-blocking `pnpm lint`. It is written for the maintainers'
worktree flow: in a plain clone the `.env` copy does nothing, but everything else
still runs.

If you'd rather it didn't run, delete `.claude/settings.json` from your local copy
(don't commit that) or open the project with another editor. Nothing in normal
development depends on that hook: the `pnpm` commands documented here work on their
own.

---

## Git workflow

- **Feature branches**, never commit directly to `main`.
- Name the branch after its intent: `feat/qa-pipeline`, `fix/staging-gate`, and so
  on.
- Open a **PR against `main`**. Keep PRs focused (one coherent change). Three
  independent changes are three PRs, and all three move faster that way.
- Before you stage: `git status` and `git diff` to review what you're about to
  commit.
- The [PR template](.github/PULL_REQUEST_TEMPLATE.md) fills itself in when you open
  the PR; delete the sections that don't apply, but don't leave it empty.

### Commit messages

Prefix + a description of the **why** (not just the what). Consistent within one PR
(Spanish or English, but only one):

| Prefix | For |
|---|---|
| `Feat:` | New functionality |
| `Fix:` | Bug fix |
| `Refactor:` | Internal change that doesn't alter behavior |
| `Docs:` | Documentation |
| `Test:` | Tests |
| `Chore:` | Tooling, deps, maintenance |

Example: `Feat: multi-agent QA pipeline with adversarial verification`.

---

## Checks before opening the PR

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs **type-check, lint,
test, and build** on every PR. Running the same thing locally first saves you the
push → wait → fix → push cycle:

```bash
pnpm type-check     # types across shared + web + api + worker
pnpm lint           # ESLint in every workspace
pnpm test           # Jest (api) + Vitest (web/worker)
pnpm build          # production build of everything
```

To iterate faster, filter by workspace:
`pnpm --filter @cenzontle/api test`, `pnpm --filter @cenzontle/web type-check`.

- The Playwright end-to-end suite is **not** part of `pnpm test` and does not run in
  CI — it needs the app up and a browser. If you touched the frontend or the BFF
  proxy, run it yourself: `pnpm --filter @cenzontle/web test:e2e` (the first time,
  `pnpm --filter @cenzontle/web test:e2e:install`). Read
  [apps/web/e2e/README.md](apps/web/e2e/README.md) first — the suite needs
  PostgreSQL reachable and `packages/shared` built.
- If you touched `packages/shared`, remember that `pnpm dev` and `pnpm type-check`
  already build it; when in doubt: `pnpm --filter @cenzontle/shared build`.
- If you touched the Prisma schema, generate the migration with
  `pnpm --filter @cenzontle/api exec prisma migrate dev --name description_of_the_change`
  and commit the resulting `.sql` (the Prisma CLI lives in `apps/api`, not at the
  root — see [docs/database.md](docs/database.md)).
- If `pnpm test` fails on something you didn't touch, check against a clean `main`
  before chasing it: it may be a pre-existing failure and not yours. If it is, say
  so in the PR instead of trying to fix it there and then.

---

## Code conventions

A summary; the detail lives in [CLAUDE.md](CLAUDE.md).

### Naming
- Directories: `kebab-case` (`modules/proyectos`, `app/factory/agents`).
- React components: `PascalCase` (`AgentCard.tsx`).
- NestJS modules: `kebab-case`, `modules/<feature>/` shape (controller + service +
  `dto/`).
- Shared types: `PascalCase`, in `packages/shared/src/types/`.

### Imports
- Workspace dependencies with `workspace:*`.
- Shared types from `@cenzontle/shared`.
- Web: `@/*` alias → `./src/*`. UI components from `@/components/ui/`.
- Keep relative imports shallow. In web and worker, never climb past `../../` —
  reach for the `@/*` alias instead. The API has no alias, so nested modules do
  reach `src/common/` with longer relative paths; that is the established pattern
  there.

### Style
- **Frontend:** Tailwind 4 (no CSS modules), Radix UI as the base, Lucide for icons,
  React Context for state (no Redux/Zustand). D3 and XYFlow for visualizations.
- **Backend:** one NestJS module per feature; `class-validator` on the DTOs;
  documented with Swagger; structured logging with pino.
- TypeScript strict mode in every workspace.

### Principles
SOLID, DRY, KISS, YAGNI (in that priority order). No TODOs and no stubs in code that
gets merged; fix root causes, not symptoms; never disable tests to make the build
pass.

---

## Migrations and secrets

- **Don't hand-edit migration `.sql` files** (except for SQL that Prisma can't
  express, such as partial indexes — document it in the file).
- **Never commit secrets.** `.env` and `.env.local` are in `.gitignore`. If you add
  a new variable, **document it** in the matching `.env.example` and in
  [docs/configuration.md](docs/configuration.md).
- Don't paste secrets into the PR description either, or into the logs you attach,
  or into screenshots.

---

## Self-review before requesting review

Before you mark the PR ready, take an adversarial pass over what you changed,
especially if you touched:

- **Auth, endpoints, user input, crypto, env vars** → security review.
- **New modules, schema, API contracts** → architecture review.
- **Any code** → quality review (bugs, edge cases, coverage).

Include in the PR: what changed, why, how you tested it, and any finding still open.
If you know something came out half-done, write it yourself under "Notes for
reviewers" instead of waiting for it to surface in review.

---

## What to expect from review

Let's be honest: **CENZONTLE is maintained by a small number of people with limited
time.** There is no SLA. A PR may get an answer the same day or sit for a week or
two, especially if it's large or touches the Forge. If that much time passed with no
signal, a reminder comment on the PR is welcome and won't bother anyone.

What makes a PR merge fast:

- **Narrow scope.** One coherent change that can be reviewed in a single sitting.
- **The why, explained.** The diff says what you changed; the description has to say
  why, and which alternative you discarded.
- **Tests.** Ideally one that fails without your change and passes with it. For a
  bug, that test is the best proof you understood it.
- **Green checks** before you request review.
- **A prior issue** when the change isn't trivial.

What slows it down, in order of severity:

- Mixing refactor + feature + reformatting in the same PR. It's the number one cause
  of PRs that stall: nobody can review it in parts.
- Reformatting files that had nothing to do with your change (it muddies the diff).
- Changing visible behavior without updating `docs/`.
- Adding dependencies without justifying why what's already there wasn't enough.

Review will ask questions and request changes. Code review is about the code, never
about the person who wrote it; and if a review comment isn't clear or seems wrong to
you, argue it — that's part of the process too.

---

## Licensing of contributions

CENZONTLE is distributed under the **[Apache License 2.0](./LICENSE)**. By sending a
PR you agree that your contribution is licensed under those same terms (which is
what Apache-2.0 itself establishes in its section 5). You keep the copyright on what
you wrote; what you grant is the license to use it.

**There is no CLA to sign** and no extra paperwork: opening the PR is all of it.

If you incorporate third-party code, make sure its license is compatible, keep its
copyright notices, and add it to [NOTICES.md](NOTICES.md) if it carries attribution
obligations or is copyleft (GPL/LGPL/AGPL/MPL/EPL).

---

## Code of conduct

This project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). It applies to
issues, PRs, discussions, and any other project space. Read it before you take part.

---

Questions this guide doesn't answer?
[Discussions](https://github.com/DamballahWedo99/CENZONTLE/discussions) or
[docs/](docs/README.md).
