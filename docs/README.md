# CENZONTLE documentation

Organized after the [Diátaxis](https://diataxis.fr) framework: every document
serves one distinct need (learn, do a task, look something up, understand why).

## Start here

- **[getting-started.md](getting-started.md)** — *Tutorial.* From `git clone` to
  the app running and logged in. The happy path, step by step.
- **[glossary.md](glossary.md)** — *Reference.* Read this one first if any term
  below is new to you. It defines the vocabulary the rest of the docs assume —
  Forge, batch, wave, sign-off, gate, lens — straight from the Prisma schema, the
  shared types and the `factory` module. It also quotes the literal Spanish UI
  labels, because the documentation is in English while the application UI is
  still in Spanish.

## How-to guides (specific tasks)

- **[auth0-setup.md](auth0-setup.md)** — Configure Auth0 and create your first
  admin user, plus the optional step-up authentication setup.
- **[database.md](database.md)** — Prisma: migrations, the seed, the dual-Postgres
  trap.
- **[forge-worker.md](forge-worker.md)** — Build, register and start a Forge worker
  on a compute node, and how its sandbox works.
- **[troubleshooting.md](troubleshooting.md)** — Common errors and how to fix them.
- **[../apps/web/e2e/README.md](../apps/web/e2e/README.md)** — Run the Playwright
  end-to-end suite: prerequisites, commands, environment variables, test JWT.
- **[../CONTRIBUTING.md](../CONTRIBUTING.md)** — Git workflow, code conventions,
  review, tests.
- **[../SECURITY.md](../SECURITY.md)** — Security model and how to report a
  vulnerability.

## Reference (things to look up)

- **[glossary.md](glossary.md)** — Every domain term, grouped by area.
- **[configuration.md](configuration.md)** — Every environment variable the code
  actually reads, and the external services behind them.
- **[authorization.md](authorization.md)** — The role and permission model: which
  roles exist, what each one may do, the API guards that enforce it, and how
  access to the vault is controlled (ReBAC).
- **[data-model.md](data-model.md)** — The Prisma models, ERD diagrams and the
  design decisions behind the schema.
- **[api-reference.md](api-reference.md)** — Versioned reference for the HTTP
  endpoints and the SSE streams.
- **[../CLAUDE.md](../CLAUDE.md)** — Repo conventions (for humans and for Claude
  Code).
- **[../CHANGELOG.md](../CHANGELOG.md)** — What changed in each version.
- **[../LICENSE](../LICENSE)** — Apache-2.0.
- **[../NOTICES.md](../NOTICES.md)** — Third-party components that require
  attribution, carry copyleft obligations, or ship under a non-OSI-approved
  license. Read it before you fork.
- **[../LICENSES/README.md](../LICENSES/README.md)** — Why each full license text
  in `LICENSES/` has to travel with the repository, and which dependency it
  covers.

## Explanation (understanding the why)

- **[architecture.md](architecture.md)** — The monorepo, the three apps, external
  services, ports, auth, the Forge flow, notable design decisions.

## Community

- **[../CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)** — How we treat each other in
  issues, pull requests and discussions.

---

Just want to run it? → [getting-started.md](getting-started.md).
Project overview → [../README.md](../README.md).
