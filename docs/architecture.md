# Arquitectura

Explicación de cómo encaja CENZONTLE: el monorepo, las tres apps, los servicios
externos y el flujo del Forge. Para *correrlo* ve a [getting-started.md](getting-started.md);
esto es el *por qué* y el *cómo se conecta*.

---

## El monorepo

Turborepo + pnpm workspaces. Tres aplicaciones desplegables y tres paquetes
internos:

```
apps/
  web/      Next.js 16 — UI + BFF proxy hacia la API
  api/      NestJS 11  — REST + WebSocket + Prisma + agentes de IA
  worker/   CLI        — flota del Forge (factory-worker)
packages/
  shared/        tipos de dominio compartidos (tsup → CJS + ESM + .d.ts)
  ts-config/     tsconfig base (base / nextjs / nestjs)
  eslint-config/ config ESLint compartida
```

`@cenzontle/shared` es la **frontera de tipos**: lo que web, api y worker
comparten (modelos del Factory, auth, contratos de endpoints) vive ahí. Por eso
`pnpm dev` hace `build` de `shared` primero — el resto depende de su salida.

**Turbo pipeline** (`turbo.json`): `dev` es `persistent` y depende de `^build`
(construye dependencias primero); `build/lint/test/type-check` cachean y dependen
de `^build`. Variables globales que invalidan cache se declaran en `globalEnv`.

---

## Las tres apps

### `apps/web` — Frontend + BFF

Next.js 16 (App Router) + React 19 + Tailwind 4 + Radix UI. No habla con la API
directamente desde el browser: usa un **BFF proxy** (Backend-for-Frontend) en el
server de Next que reenvía a la API con un secreto compartido (`INTERNAL_API_KEY`)
mientras se completa el relay de tokens Auth0. El middleware **falla cerrado**
(503) si Auth0 no está configurado.

Visualizaciones con D3, XYFlow (diagramas de épicas), Dagre/ELK (layout); editor
de texto con Tiptap; estado con React Context (no Redux/Zustand).

### `apps/api` — Backend

NestJS 11, organizado **un módulo por feature** (`modules/<feature>/`): proyectos,
factory, auth, aprobación, reportes, integraciones, vault, etc. Persistencia con
Prisma 7 sobre PostgreSQL (adapter `@prisma/adapter-pg`). WebSocket (Socket.IO)
para streaming de agentes. Swagger en `/api/docs`. Logging estructurado con pino.

Los agentes de IA (generación de épicas/historias/diagramas, asistente, Forge
planner, QA) llaman a la API de Anthropic. La API key y los tokens de GitHub se
guardan **cifrados en BD** (AES-256-GCM con `VAULT_ENCRYPTION_KEY`), no en `.env`.

### `apps/worker` — Flota del Forge (opcional)

CLI `factory-worker` (Commander). Cada worker es una máquina que se registra como
*compute node* y hace polling para **reclamar historias** (`claim-story`), las
implementa corriendo **Claude Code en modo headless**, abre PRs, y reporta
progreso/resultado. No es necesario para la app de proyectos. Detalle:
[forge-worker.md](forge-worker.md).

---

## Servicios externos

| Servicio | Para qué | Dev local |
|---|---|---|
| **PostgreSQL** | Toda la persistencia (Prisma) | Docker `:5432` |
| **Redis** | Rate-limiter (throttler) compartido + caché de propuestas IA | Docker `:6379` |
| **MinIO / S3** | Assets de branding y documentos | Docker `:9000` |
| **Auth0** | Identidad (OIDC) — login, roles, step-up auth | Tenant en la nube |
| **Anthropic** | Todos los agentes de IA | API key (en BD vía UI) |
| **GitHub** | Vault de conocimiento + code repos + PRs del Forge | Tokens (en BD vía UI) |

---

## Puertos

| Puerto | Servicio |
|---|---|
| 3000 | web (Next.js) |
| 3001 | api (NestJS) — Swagger en `/api/docs` |
| 5432 | PostgreSQL |
| 6379 | Redis |
| 9000 / 9001 | MinIO (API / consola) |

---

## Auth y roles

Auth0 emite el JWT; una **post-login Action** inyecta `role` y `pod_ids` como
custom claims. La API valida el JWT (JWKS) y aplica guards por rol/permiso. Cinco
roles: `AltaGerencia` (admin), `ProductOwner`, `TechLead`, `QA`, `Viewer`. El
acceso a datos se filtra por **pods** (células) — un usuario solo ve lo de sus
pods (salvo AltaGerencia). Setup: [auth0-setup.md](auth0-setup.md).

---

## El Forge (Software Factory) — flujo de una historia

```
Épica aprobada (3 VoBos) ─▶ "Subir al Forge" (enqueue)
        │
        ▼
   IN QUEUE ─▶ FORGE ─────────▶ STAGED ──────▶ QA TESTING ─────▶ RELEASED
   (espera)   workers la        TechLead       campaña QA         release gate
              implementan       aprueba el     multi-agente:      humano aprueba
              (Claude Code),    merge del      4 lentes en        el rollout
              verifican DoD,    PR consolidado paralelo →
              abren PRs         a DEV          verificación
                                               adversarial →
                                               QAReport
```

- **Claim paralelo:** los workers reclaman historias con `FOR UPDATE SKIP LOCKED`
  respetando el DAG de dependencias (waves). Un índice parcial único garantiza un
  solo run activo por historia.
- **DoD verifier:** tras implementar, un agente verifica la Definition of Done
  (tests, lint, seguridad, criterios de aceptación) con loop de reintentos y
  detección de doom-loop.
- **Pipeline de QA** (etapa QA TESTING): al mergear a DEV, una campaña fan-outea
  4 lentes (suite del repo, E2E contra entorno efímero, seguridad diferencial,
  perf/a11y), verifica los fallos adversarialmente (refutadores que votan) y
  sintetiza un `QAReport` con recomendación rollout/rollback para un gate humano.
- **Gates humanos:** staging (merge a DEV) y release (rollout) requieren step-up
  auth (re-confirmar password) y rol TechLead/AltaGerencia.

---

## Decisiones de diseño notables

- **Secretos cifrados en BD, no en env.** Anthropic key, tokens de GitHub y
  external secrets se cifran con `VAULT_ENCRYPTION_KEY` y se configuran desde la
  UI — permite rotación sin redeploy.
- **Stage derivado de timestamps**, no de un enum de estado. La etapa de un batch
  se calcula desde campos del `Epic` (`enqueuedAt`, `stagingApprovedAt`,
  `qaStartedAt`, `releaseApprovedAt`); el frontend deriva la columna del kanban.
- **Datos plurales en tablas, escalares en el dueño.** Los runs (AgentRun,
  QaLensRun) son tablas; los hitos terminales viven como timestamps en el Epic.
- **Módulos sin ciclos.** Las dependencias entre módulos NestJS se mantienen
  acíclicas; los singletons de config se leen directo por Prisma cuando inyectar
  el servicio crearía un ciclo.
