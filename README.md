<div align="center">

# 🐦 CENZONTLE

**Plataforma de Software Factory y gestión de proyectos.**
Genera iniciativas, épicas e historias con IA, y orquesta una flota de agentes
(el *Forge*) que las implementan, prueban y liberan de punta a punta.

Monorepo Turborepo + pnpm · Next.js 16 · NestJS 11 · Prisma 7 · PostgreSQL

</div>

---

## Tabla de contenidos

- [¿Qué es esto?](#qué-es-esto)
- [Arquitectura en 30 segundos](#arquitectura-en-30-segundos)
- [Quick Start](#quick-start) — de `git clone` a la app corriendo
- [Comandos](#comandos)
- [Documentación](#documentación)
- [Stack tecnológico](#stack-tecnológico)
- [Estructura del repo](#estructura-del-repo)
- [Cómo contribuir](#cómo-contribuir)

---

## ¿Qué es esto?

CENZONTLE es una plataforma interna con dos mitades:

1. **Gestión de proyectos** — iniciativas → épicas → historias, generadas y
   editadas con agentes de IA (Product Owner, Tech Lead, QA), con diagramas,
   un vault de conocimiento y un asistente de edición.
2. **El Forge (Software Factory)** — una flota de *workers* que reclaman
   historias y las implementan con Claude Code en modo headless, abren PRs, las
   verifican (Definition of Done), las prueban (pipeline de QA automático) y las
   llevan hasta *Released* — con gates humanos en los puntos críticos.

> Si solo quieres **arrancarlo y explorarlo**, ve directo al [Quick Start](#quick-start).
> El Forge (workers) es **opcional**: la app de proyectos funciona sin él.

---

## Arquitectura en 30 segundos

```
┌────────────┐      BFF proxy       ┌────────────┐      Prisma      ┌──────────────┐
│  apps/web  │ ───────────────────▶ │  apps/api  │ ───────────────▶ │  PostgreSQL  │
│  Next.js   │  (:3000)             │  NestJS    │  (:3001)         │  (:5432)     │
└────────────┘                      └─────┬──────┘                  └──────────────┘
      ▲                                   │  ├─ Redis (:6379)  rate-limit + caché
      │ Auth0 (OIDC)                      │  ├─ MinIO/S3 (:9000)  branding/docs
      │                                   │  └─ Anthropic API   agentes de IA
      │                          claim-story / heartbeat
                                          │
                                   ┌──────┴───────┐
                                   │ apps/worker  │  flota del Forge (opcional)
                                   │ factory-worker│  corre Claude Code headless
                                   └──────────────┘
```

`packages/shared` contiene los tipos compartidos (web + api + worker). Detalle
completo en **[docs/architecture.md](docs/architecture.md)**.

---

## Quick Start

> Camino feliz garantizado para correr todo en local. La versión paso a paso
> con explicaciones y troubleshooting está en
> **[docs/getting-started.md](docs/getting-started.md)**.

**Prerrequisitos:** [Node.js 20+](https://nodejs.org), [pnpm 9.15+](https://pnpm.io/installation)
(`corepack enable`), [Docker](https://docs.docker.com/get-docker/) y una cuenta
[Auth0](https://auth0.com) (el login es obligatorio — ver [docs/auth0-setup.md](docs/auth0-setup.md)).

```bash
# 1. Clonar e instalar
git clone <repo-url> && cd CENZONTLE
pnpm install                              # postinstall corre `prisma generate`

# 2. Levantar servicios locales (Postgres + Redis + MinIO) con un comando
docker compose up -d                      # crea el bucket de MinIO automáticamente

# 3. Configurar variables de entorno
cp apps/api/.env.example   apps/api/.env
cp apps/web/.env.example   apps/web/.env.local
#   → edita ambos: pega tus credenciales de Auth0 y genera los secretos:
#     openssl rand -base64 32   # VAULT_ENCRYPTION_KEY (api)
#     openssl rand -hex 32      # AUTH0_SECRET (web) e INTERNAL_API_KEY (mismo en api y web)

# 4. Migrar la base de datos
pnpm --filter @cenzontle/api exec prisma migrate deploy

# 5. Arrancar web + api
pnpm dev
```

Abre **http://localhost:3000** → te redirige al login de Auth0 → tras
autenticarte aterrizas en `/proyectos`. La API expone Swagger en
**http://localhost:3001/api/docs**.

> **Tu primer usuario admin** se crea en el dashboard de Auth0 (no hay seed de
> usuarios). Ponle `app_metadata.role = "alta_gerencia"` y despliega la
> post-login Action. Pasos exactos: **[docs/auth0-setup.md](docs/auth0-setup.md)**.

¿Algo falla? → **[docs/troubleshooting.md](docs/troubleshooting.md)**.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Build de `shared` + dev de **web + api** (lo más común) |
| `pnpm dev:web` | Solo el frontend |
| `pnpm dev:api` | Solo el backend |
| `pnpm dev:unsafe` | Turbo dev de **todos** los workspaces (incluye worker) |
| `pnpm build` | Build de producción de todo |
| `pnpm lint` | ESLint en todos los workspaces |
| `pnpm test` | Tests (Jest en api, Vitest en web/worker) |
| `pnpm type-check` | Verificación de tipos (todos) |
| `pnpm clean` | Limpia el cache de Turbo |

Por workspace: `pnpm --filter @cenzontle/<web\|api\|worker\|shared> <script>`.

---

## Documentación

La documentación sigue el framework **[Diátaxis](https://diataxis.fr)** (tutorial /
how-to / referencia / explicación):

| Doc | Tipo | Para qué |
|---|---|---|
| **[docs/getting-started.md](docs/getting-started.md)** | Tutorial | De cero a la app corriendo y con login, paso a paso |
| **[docs/architecture.md](docs/architecture.md)** | Explicación | Cómo encaja todo: monorepo, apps, el Forge, data flow |
| **[docs/configuration.md](docs/configuration.md)** | Referencia | TODAS las variables de entorno y servicios externos |
| **[docs/auth0-setup.md](docs/auth0-setup.md)** | How-to | Configurar Auth0 y crear el primer admin |
| **[docs/database.md](docs/database.md)** | How-to | Prisma: migraciones, seed, la trampa dual-Postgres |
| **[docs/forge-worker.md](docs/forge-worker.md)** | How-to | Levantar y registrar un worker de la flota |
| **[docs/troubleshooting.md](docs/troubleshooting.md)** | How-to | Los errores comunes y sus soluciones |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | How-to | Flujo de git, convenciones, review y tests |
| **[CLAUDE.md](CLAUDE.md)** | Referencia | Convenciones del repo (para humanos y para Claude Code) |

---

## Stack tecnológico

| Área | Tecnologías |
|---|---|
| **Frontend** (`apps/web`) | Next.js 16, React 19, Tailwind 4, Radix UI, Tiptap, XYFlow, D3, Zod |
| **Backend** (`apps/api`) | NestJS 11, Prisma 7, PostgreSQL, Redis, Socket.IO, Swagger, pino |
| **Worker** (`apps/worker`) | TypeScript + Commander (CLI `factory-worker`), corre Claude Code headless |
| **IA** | Anthropic Claude (SDK) — generación de épicas/historias/diagramas, Forge, QA |
| **Infra dev** | Docker Compose (Postgres 16 · Redis 7 · MinIO), Auth0 (OIDC) |
| **Tooling** | Turborepo, pnpm workspaces, ESLint 9, Jest, Vitest, Playwright |

---

## Estructura del repo

```
apps/
  web/      → Next.js (frontend + BFF proxy a la API)
  api/      → NestJS (REST + WebSocket + Prisma + agentes de IA)
  worker/   → CLI `factory-worker` (flota del Forge)
packages/
  shared/        → tipos compartidos (tsup: CJS + ESM)
  ts-config/     → configs base de TypeScript
  eslint-config/ → config compartida de ESLint
docs/         → documentación (Diátaxis)
docker-compose.yml  → Postgres + Redis + MinIO para dev local
```

---

## Cómo contribuir

Branches por feature, PRs a `main`, commits con prefijo (`Feat:`, `Fix:`,
`Refactor:`, `Docs:`, `Test:`, `Chore:`). Detalle en **[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

<div align="center">
<sub>Proyecto interno. Consulta a Alta Gerencia para acceso, credenciales y despliegue.</sub>
</div>
