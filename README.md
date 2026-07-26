<div align="center">

# 🐦 CENZONTLE

**Plataforma de Software Factory y gestión de proyectos.**
Genera iniciativas, épicas e historias con IA, y orquesta una flota de agentes
(el *Forge*) que las implementan, prueban y liberan de punta a punta.

Monorepo Turborepo + pnpm · Next.js 16 · NestJS 11 · Prisma 7 · PostgreSQL

[![Licencia: Apache-2.0](https://img.shields.io/badge/licencia-Apache--2.0-blue.svg)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/DamballahWedo99/CENZONTLE/ci.yml?branch=main&label=CI)](https://github.com/DamballahWedo99/CENZONTLE/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9.15%2B-f69220.svg)](https://pnpm.io/installation)

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
- [Estado del proyecto](#estado-del-proyecto)
- [Cómo contribuir](#cómo-contribuir)
- [Licencia](#licencia)

---

## ¿Qué es esto?

CENZONTLE es una plataforma con dos mitades:

1. **Gestión de proyectos** — iniciativas → épicas → historias, generadas y
   editadas con agentes de IA (Product Owner, Tech Lead, QA), con diagramas,
   un vault de conocimiento y un asistente de edición.
2. **El Forge (Software Factory)** — una flota de *workers* que reclaman
   historias y las implementan con Claude Code en modo headless, abren PRs, las
   verifican (Definition of Done), las prueban (pipeline de QA automático) y las
   llevan hasta *Released* — con gates humanos en los puntos críticos.

> Si solo quieres **arrancarlo y explorarlo**, ve directo al [Quick Start](#quick-start).

> [!WARNING]
> **Lee esto antes de levantar un worker.**
> - `apps/worker` ejecuta Claude Code con `--dangerously-skip-permissions`: el
>   agente corre comandos en tu máquina sin pedirte confirmación. El aislamiento
>   real lo da el sandbox del sistema operativo (`sandbox-exec` en macOS,
>   `firejail` en Linux), **no** la CLI.
> - En Linux, `firejail` **no** viene instalado por defecto — instálalo con el
>   gestor de paquetes de tu distro. Correr sin sandbox exige un doble opt-in
>   explícito (`FACTORY_WORKER_SANDBOX_MODE=none` **y**
>   `FACTORY_WORKER_ALLOW_NO_SANDBOX=1`); si falta el segundo, el daemon arranca
>   pero aborta cada historia antes de lanzar el agente.
> - Los agentes consumen la API de Anthropic con **tu** API key y **no hay techo
>   de gasto**. El verificador de DoD reintenta cuando una historia falla, lo que
>   aproximadamente duplica su costo. Empieza con una historia pequeña.
> - La app de gestión de proyectos (`apps/web` + `apps/api`) funciona **sin**
>   levantar ningún worker: si solo quieres explorar la plataforma, no te expones
>   a nada de lo anterior.
>
> El modelo de seguridad completo está en **[SECURITY.md](SECURITY.md)**.

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
                                          │
                                          │  claim-story / heartbeat
                                          │
                                   ┌──────┴─────────┐
                                   │  apps/worker   │  flota del Forge (opcional)
                                   │ factory-worker │  corre Claude Code headless
                                   └────────────────┘
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
# 1. Clonar
git clone https://github.com/DamballahWedo99/CENZONTLE.git && cd CENZONTLE

# 2. Configurar variables de entorno — ANTES de instalar: el postinstall corre
#    `prisma generate`, que lee DATABASE_URL de apps/api/.env y falla sin él.
cp apps/api/.env.example   apps/api/.env
cp apps/web/.env.example   apps/web/.env.local
#   → edita ambos: pega tus credenciales de Auth0 y genera los secretos:
#     openssl rand -base64 32   # VAULT_ENCRYPTION_KEY (api)
#     openssl rand -hex 32      # AUTH0_SECRET (web) e INTERNAL_API_KEY (mismo en api y web)

# 3. Instalar
pnpm install                              # postinstall corre `prisma generate`

# 4. Levantar servicios locales (Postgres + Redis + MinIO) con un comando
docker compose up -d                      # crea el bucket de MinIO automáticamente

# 5. Migrar la base de datos
pnpm --filter @cenzontle/api exec prisma migrate deploy

# 6. Arrancar web + api
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
| **[SECURITY.md](SECURITY.md)** | Explicación | Modelo de seguridad, sandbox del worker y cómo reportar vulnerabilidades |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | How-to | Flujo de git, convenciones, review y tests |
| **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** | Referencia | Las reglas de convivencia del proyecto |
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

## Estado del proyecto

**Versión 0.1.0.** CENZONTLE está pensado y probado para **desarrollo local**:
el [Quick Start](#quick-start) es el camino soportado y no hay todavía una guía
de despliegue en producción.

- **La API no tiene garantía de estabilidad.** Los endpoints REST, los eventos
  de WebSocket y los tipos de `packages/shared` pueden cambiar sin aviso entre
  versiones. No construyas integraciones sobre ellos dando por hecho que van a
  seguir igual.
- El esquema de base de datos evoluciona por migraciones de Prisma; para
  actualizar, corre `prisma migrate deploy` (ver [docs/database.md](docs/database.md)).
- `pnpm type-check`, `pnpm lint`, `pnpm test` (Jest en `api` + Vitest en `web` y
  `worker`) y `pnpm build` pasan en verde sobre un checkout limpio. Si alguno te
  falla recién clonado, es un bug: [ábrenos un issue](https://github.com/DamballahWedo99/CENZONTLE/issues/new/choose).
- La cobertura de tests es desigual: el backend está bien cubierto (874 casos) y
  el frontend mucho menos (153, concentrados en el layout de diagramas). Los tests
  en verde dicen poco sobre los componentes de React; revísalos a mano.
- El Forge está validado de punta a punta en local (implementación, PR,
  verificación de DoD y pipeline de QA), pero es la parte más joven y la que más
  cuidado exige — lee la advertencia de arriba y [SECURITY.md](SECURITY.md).

---

## Cómo contribuir

Branches por feature, PRs a `main`, commits con prefijo (`Feat:`, `Fix:`,
`Refactor:`, `Docs:`, `Test:`, `Chore:`). El detalle —convenciones, checks que
tu cambio debe pasar y cómo se revisa— está en **[CONTRIBUTING.md](CONTRIBUTING.md)**.
Al participar aceptas el **[Código de conducta](CODE_OF_CONDUCT.md)**.

La documentación de este repo está escrita en **español**. Los issues y los PRs
son bienvenidos **en español o en inglés**: usa el idioma en el que te expreses
mejor, nadie va a rechazar un aporte por eso.

**¿Dónde pedir ayuda?**

| Quiero… | Ve a |
|---|---|
| Reportar un bug o proponer una feature | [Issues](https://github.com/DamballahWedo99/CENZONTLE/issues/new/choose) |
| Preguntar, discutir ideas o enseñar lo que hiciste | [Discussions](https://github.com/DamballahWedo99/CENZONTLE/discussions) |
| Reportar una vulnerabilidad (**nunca** en un issue público) | [Reporte privado de seguridad](https://github.com/DamballahWedo99/CENZONTLE/security/advisories/new) · [SECURITY.md](SECURITY.md) |

---

## Licencia

Distribuido bajo la licencia **Apache-2.0** — ver **[LICENSE](./LICENSE)**.
Las atribuciones y licencias de terceros están en **[NOTICES.md](NOTICES.md)**.
