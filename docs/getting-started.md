# Getting Started

This guide takes you from **`git clone`** to the app **running and logged in**,
step by step. Follow the steps exactly in order — each one assumes the previous
one. Estimated time: ~20–30 min (most of it is setting up Auth0 the first time).

> This is a **tutorial**: the guaranteed happy path. The exhaustive variable
> reference lives in [configuration.md](configuration.md); common errors in
> [troubleshooting.md](troubleshooting.md). For the vocabulary, see
> [glossary.md](glossary.md).

---

## 0. Prerequisites

| Tool | Version | How |
|---|---|---|
| **Node.js** | **22.19+** | https://nodejs.org — recommended via `nvm` |
| **pnpm** | 9.15+ | `corepack enable` (ships with Node) or `npm i -g pnpm@9.15.0` |
| **Docker** | recent | https://docs.docker.com/get-docker/ (for Postgres/Redis/MinIO) |
| **Auth0 account** | — | https://auth0.com (free) — **login is mandatory** |
| `openssl` | any | already on macOS/Linux — used to generate secrets |

> The repo ships a `.nvmrc` pinned to Node 22: `nvm use` picks it up on its own,
> and CI starts from that same file. Node 22.19 is a REAL floor, not a
> recommendation: `undici@8` **is** the API's HTTP client and a direct
> dependency of `apps/api`, and it requires that version.
> pnpm is mandatory (`packageManager` pins it); do not use npm/yarn to install
> the monorepo.

---

## 1. Clone

```bash
git clone https://github.com/DamballahWedo99/CENZONTLE.git
cd CENZONTLE
```

> **Do not run `pnpm install` yet.** The API's `postinstall` runs
> `prisma generate`, which loads `apps/api/prisma.config.ts`; that file requires
> `DATABASE_URL` and aborts the install if it is missing. That is why the
> environment-variable step comes **before** the install. If you skip the order,
> you will see `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`
> — the repo isn't broken, you're just missing the `.env`.

---

## 2. Bring up the local services (Docker)

The repo ships a `docker-compose.yml` that starts **everything** the app needs as
infrastructure, in one command:

```bash
docker compose up -d
```

That brings up:

| Service | Port | Dev credentials |
|---|---|---|
| **PostgreSQL 16** | 5432 | `cenzontle` / `cenzontle_dev`, db `cenzontle` |
| **Redis 7** | 6379 | — (rate limiting + cache; degrades gracefully if absent) |
| **MinIO** (S3) | 9000 (API), 9001 (console) | `cenzontle` / `cenzontle_dev` |

Check that everything is up:

```bash
docker compose ps -a
```

The three services above must show **STATUS `Up`** (or `running`, depending on
your Docker Compose version). **Do not expect to see `healthy`**: the
`docker-compose.yml` defines no `healthcheck` on any service, so Docker never
reports that state.

That listing also shows a **fourth** service, `minio-init`, in `Exited (0)`. That
is correct: it is a one-shot job that creates the `cenzontle-documents` bucket and
exits. An `Exited (0)` there **is not a failure** — it is the work done. Watch the
flag: `docker compose ps` **without `-a`** lists only live containers, so
`minio-init` does not show up there and its absence is not a problem either.

> **Already running a native Postgres on :5432?** Watch out for the "dual trap" —
> read [database.md › Dual Postgres](database.md#dual-postgres-native-vs-docker).

---

## 3. Environment variables

Copy the templates:

```bash
cp apps/api/.env.example  apps/api/.env
cp apps/web/.env.example  apps/web/.env.local
```

Generate the secrets:

```bash
openssl rand -base64 32   # → VAULT_ENCRYPTION_KEY   (apps/api/.env)
openssl rand -hex 32      # → AUTH0_SECRET           (apps/web/.env.local)
```

Edit the two files:

- **`apps/api/.env`** — `DATABASE_URL` is already correct for Docker. Paste
  `VAULT_ENCRYPTION_KEY` and the `AUTH0_*` values (step 5).
- **`apps/web/.env.local`** — paste the `AUTH0_*` values and `AUTH0_SECRET`.

> `VAULT_ENCRYPTION_KEY` is the AES-256-GCM master key for every secret stored in
> the database: the vault's GitHub token, code-repo tokens, external secrets and
> the Anthropic API key. Rotating it invalidates everything already encrypted.
>
> The complete list of variables (what is required, what is optional, its default
> and what it's for) is in [configuration.md](configuration.md).

With `apps/api/.env` in place, install the dependencies:

```bash
pnpm install
```

The API's `postinstall` runs `prisma generate` and leaves the client ready. It
needs to read `DATABASE_URL` from the `.env` you just created — that is why this
step is here and not at the beginning.

---

## 4. Migrate the database

```bash
pnpm --filter @cenzontle/api exec prisma migrate deploy
```

This applies every migration against the Docker database. **Use `migrate deploy`,
not `migrate dev`** (deploy only applies what is pending and never resets). More
detail in [database.md](database.md).

Optionally, load the sample dataset:

```bash
pnpm --filter @cenzontle/api exec prisma db seed
```

> The seed creates a small sample dataset — 2 Pods, 1 initiative, 1 epic and 3
> stories — so there is something to look at on first boot. It is idempotent
> (re-running it updates the same rows) and it **never deletes anything**. Skip it
> if you would rather start from an empty database; everything else is created
> from the UI.

---

## 5. Configure Auth0 (required)

The app **fails closed (503) without Auth0** — there is no dev bypass. In the
[Auth0 dashboard](https://manage.auth0.com) you need to create:

1. An **API** (audience `https://api.cenzontle.app`).
2. A **Regular Web Application** (callbacks to `http://localhost:3000/auth/callback`).
3. A **post-login Action** that injects `role` and `pod_ids` into the token.
4. Your **first user**, with `app_metadata.role = "alta_gerencia"`.

The values go into the `AUTH0_*` variables of both `.env` files. **Exact steps for
what to copy where:** [auth0-setup.md](auth0-setup.md). Do it now and come back.

---

## 6. Start the app

```bash
pnpm dev
```

This builds `@cenzontle/shared` and brings up web + api in parallel:

| URL | What it is |
|---|---|
| **http://localhost:3000** | Frontend (redirects you to the Auth0 login) |
| **http://localhost:3001** | API |
| **http://localhost:3001/api/docs** | Swagger (endpoint reference) |

Swagger is only mounted when `NODE_ENV !== 'production'`, so that last URL exists
in dev and is absent in a production build.

Open **http://localhost:3000**, sign in with the user you created in Auth0, and
you land on **`/proyectos`**. 🎉

---

## 7. First run (after login)

Signed in as `alta_gerencia` ("Alta Gerencia", senior management) you see the
whole product. The sidebar has three
destinations — **Proyectos** ("Projects", `/proyectos`), **Matriz** ("Matrix") and
**Vault** — plus the Factory dashboards under `/factory`. Settings
("Configuración") lives in the avatar menu at the bottom of the sidebar and is
only rendered for `alta_gerencia`.

A sensible order for the first session:

1. **Paste your Anthropic API key.** Go to Settings → Automatización →
   **Anthropic API Key** (`/factory/settings?section=anthropic-key`). The key is
   stored **encrypted in the database** with `VAULT_ENCRYPTION_KEY`, not in
   `.env`. Without it the AI agents generate nothing.
2. **Review your Pods.** Settings → Ecosistema → **Células** ("Pods")
   (`/factory/settings?section=pods`). Every story belongs to exactly one Pod,
   and Pod membership is also an authorization boundary. The seed leaves you
   two; add your own.
3. **Connect the repositories.** Two different things, on two screens that sit
   in two different groups of the settings rail:
   - the **vault** — the GitHub repo where initiatives, epics and stories are
     stored as markdown: Settings → Integraciones → **Vault**
     (`/factory/settings?section=vault`);
   - the **target repository of the Forge** — the repo the agents clone, commit
     to and open pull requests against: Settings → Control de código →
     **Código** ("Code") (`/factory/settings?section=codigo`). A repo added here
     is read-only for the agents by default; writing is a per-repo opt-in you
     turn on with **Activar Forge write** ("Enable Forge write").
4. **Create work.** In `/proyectos` the buttons are **Nueva Iniciativa** ("New
   initiative"), **Nueva Épica** ("New epic") and **Nueva Historia** ("New
   story"), following the initiative → epic → story hierarchy.
5. **Collect the three sign-offs.** An epic needs a Product Owner, a Tech Lead
   and a QA sign-off — the **Dar VoBo** ("sign off") button on the epic — before
   **Enviar al Forge** ("Send to the Forge") will enqueue it. The dialog
   **always** asks for your password (step-up authentication) and will not
   submit while the field is empty. Whether that password is actually *checked*
   is a separate question. Without the M2M credentials from the optional
   [step 5 of auth0-setup.md](auth0-setup.md#5-optional-step-up-authentication-and-user-management),
   the API skips verification outside production and accepts anything you type —
   so on a fresh local install you type any string and the sign-off lands.
6. **Register a compute node**, if you plan to run the Forge. Settings →
   Infraestructura → **Nodos de cómputo** ("Compute nodes")
   (`/factory/settings?section=nodes`). There is no token without a node, so the
   order is fixed: fill in the row at the bottom and click **Crear nodo**
   ("Create node") first — that on its own opens the token dialog. Afterwards,
   **Generar** ("Generate") on that node's row mints a fresh token whenever you
   need one. Either way the token is shown **exactly once** — copy it now, you
   need it in step 8.

If a term on screen doesn't map onto anything you have read here, look it up in
[glossary.md](glossary.md); it is written against the schema and the `factory`
module, not against prose.

---

## 8. (Optional) Bring up a Forge worker

The Forge is optional — the projects app works without it. To have AI agents
implement stories, bring up a worker.

Prerequisites on the worker machine:

- The **API running** (`pnpm dev:api` or `pnpm dev`).
- The **Claude Code CLI** (`claude`) installed and on your `PATH`. The worker
  spawns it for every story; without it the daemon starts fine and no story ever
  makes progress.
- **`tmux` and `ttyd`** installed and on your `PATH`. They are not optional: the
  worker streams the agent's log through `tmux` + `ttyd`, and if either binary is
  missing every claimed story fails immediately with exit code `127`. Install
  with `brew install tmux ttyd` on macOS; on Linux take `tmux` from your package
  manager and `ttyd` from
  [its own instructions](https://github.com/tsl0922/ttyd#installation).
- A **worker token**, minted in Settings → **Nodos de cómputo** → **Generar**
  (step 7).
- On **Linux**, install `firejail` first (`sudo apt install firejail`). It is the
  worker's sandbox tool; without it the daemon starts but every story aborts. On
  macOS you install nothing (`sandbox-exec` ships with the system).

```bash
# build the worker
pnpm --filter @cenzontle/worker build

# The worker refuses any dashboard URL that is not https — no exception for
# localhost. Export this in the shell you run BOTH commands below from.
# Local dev only: the claim response carries the Anthropic key in cleartext.
export FACTORY_WORKER_ALLOW_INSECURE=1

# register this machine as a compute node (token from step 7)
node apps/worker/dist/cli.js register \
  --dashboard http://localhost:3001 \
  --token worker_XXXXXXXX \
  --slots 1

# start the daemon (heartbeat + story claiming)
node apps/worker/dist/cli.js start
```

Full guide (sandbox, tmux/ttyd, gotchas): [forge-worker.md](forge-worker.md).

---

## Verification checklist

- [ ] `docker compose ps -a` shows postgres + redis + minio as `Up` (and `minio-init` as `Exited (0)`)
- [ ] `apps/api/.env` and `apps/web/.env.local` exist and carry the secrets
- [ ] `prisma migrate deploy` ran without error
- [ ] Auth0 configured + admin user with role `alta_gerencia`
- [ ] `pnpm dev` starts without errors
- [ ] http://localhost:3000 → login → `/proyectos`
- [ ] http://localhost:3001/api/docs loads Swagger

Did a step fail? → [troubleshooting.md](troubleshooting.md).
