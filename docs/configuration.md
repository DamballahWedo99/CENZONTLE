# Configuración — Referencia de variables de entorno

Referencia exhaustiva de **todas** las variables de entorno y servicios externos.
Para arrancar rápido usa los `.env.example` y el [Getting Started](getting-started.md);
esta página es la fuente de verdad cuando necesitas el detalle.

**Dónde van:**
- `apps/api/.env` — backend (NestJS)
- `apps/web/.env.local` — frontend (Next.js)
- `apps/worker/.env` — worker (opcional, casi todo se setea con `register`)

Leyenda: **REQ** = requerido · **OPT** = opcional · 🔒 = secreto (nunca commitear).

---

## PostgreSQL — `apps/api`

| Variable | | Default | Propósito |
|---|---|---|---|
| `DATABASE_URL` 🔒 | **REQ** | — | Cadena de conexión Prisma. Dev (Docker): `postgresql://cenzontle:cenzontle_dev@localhost:5432/cenzontle` |

## Encriptación at-rest — `apps/api`

| Variable | | Default | Propósito |
|---|---|---|---|
| `VAULT_ENCRYPTION_KEY` 🔒 | **REQ** | — | Llave maestra AES-256-GCM (base64, 32 bytes). Cifra todos los secretos en BD (GitHub token, code repos, external secrets, API key Anthropic). `openssl rand -base64 32`. Rotarla invalida lo cifrado. |

## BFF proxy — `apps/api` **y** `apps/web`

| Variable | | Default | Propósito |
|---|---|---|---|
| `INTERNAL_API_KEY` 🔒 | **REQ** | — | Secreto compartido web↔api (workaround CWE-306). **Mismo valor en ambos.** `openssl rand -hex 32`. |

## Auth0 — frontend (`apps/web`)

| Variable | | Default | Propósito |
|---|---|---|---|
| `AUTH0_DOMAIN` | **REQ** | — | Dominio del tenant, sin `https://` (`TENANT.auth0.com`) |
| `AUTH0_CLIENT_ID` | **REQ** | — | Client ID de la Regular Web App |
| `AUTH0_CLIENT_SECRET` 🔒 | **REQ** | — | Client Secret de la Web App |
| `AUTH0_SECRET` 🔒 | **REQ** | — | Llave de cifrado de la sesión BFF (≥32 chars). `openssl rand -hex 32` |
| `APP_BASE_URL` | **REQ** | `http://localhost:3000` | URL base del frontend (callbacks) |
| `AUTH0_AUDIENCE` | **REQ** | `https://api.cenzontle.app` | Identifier de la API en Auth0 |
| `AUTH0_M2M_CLIENT_ID` | OPT | — | Para step-up auth (ROPC). Si falta, VoBo/gates quedan deshabilitados |
| `AUTH0_M2M_CLIENT_SECRET` 🔒 | OPT | — | Companion del M2M |

## Auth0 — backend (`apps/api`)

| Variable | | Default | Propósito |
|---|---|---|---|
| `AUTH0_ISSUER_URL` | **REQ** | — | Issuer, **con** slash final (`https://TENANT.auth0.com/`) |
| `AUTH0_AUDIENCE` | **REQ** | `https://api.cenzontle.app` | Debe coincidir con el del web |
| `AUTH0_M2M_CLIENT_ID` | OPT | — | Step-up auth. Sin él, `/auth/verify-password` → 503 |
| `AUTH0_M2M_CLIENT_SECRET` 🔒 | OPT | — | Companion del M2M |

> Setup completo de Auth0 (apps, action, primer admin, roles): [auth0-setup.md](auth0-setup.md).

## Redis — `apps/api`

| Variable | | Default | Propósito |
|---|---|---|---|
| `REDIS_HOST` | OPT* | `localhost` | Host de Redis (rate-limiter + caché) |
| `REDIS_PORT` | OPT* | `6379` | Puerto |
| `PROPOSAL_CACHE_TTL` | OPT | `1800` | TTL (s) del caché de propuestas IA (el ejemplo usa 432000 = 5d) |
| `STORY_PROPOSAL_CACHE_TTL` | OPT | hereda de `PROPOSAL_CACHE_TTL` | TTL del caché de historias |

\* Si Redis no está, el throttler **falla-abierto** (no bloquea) y el caché hace miss. Recomendado en prod con réplicas.

## S3 / Object Storage — `apps/api`

Branding (logo/favicon) y futuros documentos. Dev = MinIO; prod = AWS S3 / R2.

| Variable | | Default | Propósito |
|---|---|---|---|
| `S3_ENDPOINT` | OPT | — | Dev: `http://localhost:9000`. AWS: vacío. R2: `https://<id>.r2.cloudflarestorage.com` |
| `S3_ACCESS_KEY` 🔒 | **REQ** | — | Dev MinIO: `cenzontle` |
| `S3_SECRET_KEY` 🔒 | **REQ** | — | Dev MinIO: `cenzontle_dev` |
| `S3_BUCKET` | **REQ** | `cenzontle-documents` | Nombre del bucket |
| `S3_REGION` | **REQ** | `us-east-1` | Región (R2: `auto`) |
| `S3_FORCE_PATH_STYLE` | OPT | auto (`true` si endpoint contiene `localhost`) | Path-style URLs (MinIO) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 🔒 | OPT | — | Fallback si no se usan los `S3_*` |

## Anthropic (Claude) — `apps/api`

| Variable | | Default | Propósito |
|---|---|---|---|
| `ANTHROPIC_API_KEY` 🔒 | Condicional | — | Key de Claude. **Preferido: pegarla en la UI** (se guarda cifrada en BD, `OrgAnthropicConfig`). El env var es un fallback. |

## Vault GitHub — `apps/api` (opcional)

Todo configurable también desde la UI de Integraciones; el env auto-siembra un vault al arrancar.

| Variable | | Default | Propósito |
|---|---|---|---|
| `VAULT_GITHUB_OWNER` | OPT | — | Owner del repo del vault |
| `VAULT_GITHUB_REPO` | OPT | — | Nombre del repo |
| `VAULT_GITHUB_BRANCH` | OPT | `main` | Branch a sincronizar |
| `VAULT_GITHUB_TOKEN` 🔒 | OPT | — | PAT. Se cifra y persiste en BD; quítalo del env después |

## Code Repos (exploración de código) — `apps/api` (opcional)

| Variable | | Default | Propósito |
|---|---|---|---|
| `CODE_REPOS_DIR` | OPT | `~/.cenzontle/code-repos` | Cache de clones para análisis |
| `CODE_REPOS_MAX_BYTES_PER_FILE` | OPT | `262144` | Límite por archivo en grep |
| `CODE_REPOS_GREP_TIMEOUT_MS` | OPT | `8000` | Timeout de grep |
| `CODE_REPOS_AUTO_SYNC_AGE_MS` | OPT | `300000` | Umbral de re-pull |

## Frontend / BFF — `apps/web`

| Variable | | Default | Propósito |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **REQ** | `http://localhost:3001` | URL de la API (expuesta al browser) |
| `API_INTERNAL_URL` | **REQ** | `http://localhost:3001` | URL de la API para SSR/BFF (server-only) |
| `NEXT_PUBLIC_PROJECT_ROOT` | OPT | — | Ruta absoluta del monorepo en el host del API; habilita el botón "Abrir Claude Code". Vacío = deshabilitado |

## API runtime — `apps/api`

| Variable | | Default | Propósito |
|---|---|---|---|
| `PORT` | OPT | `3001` | Puerto HTTP de la API |
| `CORS_ORIGIN` | **REQ** | `http://localhost:3000` | Origen permitido (URL del frontend) |
| `NODE_ENV` | OPT | — | `development` / `production` (afecta logs y toggles) |
| `LOG_LEVEL` | OPT | `debug` (dev) / `info` (prod) | Nivel de pino |

## Factory runtime — `apps/api` (opcional, defaults sanos)

| Variable | Default | Propósito |
|---|---|---|
| `AGENT_WORKDIR_ROOT` | `/` | Raíz permitida para workdirs de agentes (prod: restringir) |
| `WORKTREE_ROOT` | `~/.worktrees` | Base de worktrees de Claude Code |
| `TERMINAL_AUDIT_DIR` | `~/.cenzontle` | Logs de sesiones de terminal |
| `PREVIEW_BIND_HOST` | `127.0.0.1` | Bind del preview server |
| `QA_BIND_HOST` | `127.0.0.1` | Bind del runner de QA |
| `DESIGN_BUNDLES_DIR` | `~/.cenzontle/design-bundles` | Cache de bundles de diseño |
| `DOCUMENTS_DIR` | `~/.cenzontle/documents` | Storage de documentos |

## Feature flags / kill-switches — `apps/api`

| Variable | Default | Propósito |
|---|---|---|
| `FORGE_PAUSED` | — (activo) | Cualquier valor pausa el claim de nuevas historias |
| `FORGE_EXECUTION_MODE` | auto | Fuerza `local-tmux` o `remote-worker` |
| `DIAGRAM_LAYOUT_PASS_ENABLED` | `true` | Pase de layout de diagramas |

## DoD Verifier / Code Security — `apps/api` o worker (opcional)

Tienen defaults; normalmente se ajustan desde la UI de Tokens IA. Variables:
`DOD_VERIFIER_MODEL` (`claude-haiku-4-5`), `DOD_VERIFIER_EFFORT` (`low`),
`DOD_VERIFIER_TIMEOUT_MS` (90000), `DOD_VERIFIER_MAX_RETRIES` (2),
`DOD_VERIFIER_RETRY_BASE_MS` (2000), `DOD_VERIFIER_BATCH` (1), `DOD_VERIFIER_MOCK`;
`CODE_SECURITY_MODEL` (`claude-sonnet-4-6`), `CODE_SECURITY_EFFORT` (`medium`),
`CODE_SECURITY_TIMEOUT_MS` (300000), `CODE_SECURITY_DIFF_MAX_BYTES` (200000).

## Worker (flags de runtime)

| Variable | Default | Propósito |
|---|---|---|
| `FACTORY_WORKER_ALLOW_INSECURE` | false | Permite dashboard URL con http (solo dev) |
| `FACTORY_WORKER_SANDBOX_MODE` | auto | `none` / `nix` / `sandbox-exec` |
| `FACTORY_WORKER_ALLOW_NO_SANDBOX` | false | Opt-in para correr sin sandbox |
| `FACTORY_WORKER_USE_USER_SESSION` | false | Usa sesión OAuth de Claude Code |
| `FACTORY_WORKER_PUBLIC_HOST` | auto | Host/IP mostrado en la UI |
| `CLAUDE_BIN` / `CLAUDE_MODEL` / `CLAUDE_EFFORT` | `claude` / backend / backend | CLI de Claude Code |
| `CLAUDE_CODE_OAUTH_TOKEN` 🔒 | — | Token OAuth (si `USE_USER_SESSION=1`) |
| `TMUX_BIN` / `TTYD_BIN` | `tmux` / `ttyd` | Terminal en vivo |

> La conexión del worker (dashboardUrl, token, nodeId, slots) vive en
> `~/.factory-worker/config.json` tras `factory-worker register`, no en env.

---

## Validación

Hoy `ConfigModule.forRoot({ isGlobal: true })` **no valida** el esquema; los
defaults se inyectan en los servicios con `config.get<T>(key, fallback)`. Si una
var requerida falta, el error aparece en runtime (p.ej. Prisma sin `DATABASE_URL`,
o middleware 503 sin Auth0). *Mejora futura:* validación con Zod/Joi al arrancar.

## Secretos (nunca commitear)

`DATABASE_URL`, `VAULT_ENCRYPTION_KEY`, `INTERNAL_API_KEY`, `AUTH0_CLIENT_SECRET`,
`AUTH0_SECRET`, `AUTH0_M2M_CLIENT_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`AWS_*`, `ANTHROPIC_API_KEY`, `VAULT_GITHUB_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`.
Los `.env` / `.env.local` están en `.gitignore`. Las keys de Linear/Jira se
guardan **cifradas en BD**, no en env.
