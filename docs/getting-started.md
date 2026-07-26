# Getting Started

Esta guía te lleva de **`git clone`** a la app **corriendo y con login**, paso a
paso. Sigue el orden tal cual — cada paso asume el anterior. Tiempo estimado:
~20–30 min (la mayoría es configurar Auth0 la primera vez).

> Es un **tutorial**: el camino feliz garantizado. La referencia exhaustiva de
> variables vive en [configuration.md](configuration.md); los errores comunes en
> [troubleshooting.md](troubleshooting.md).

---

## 0. Prerrequisitos

| Herramienta | Versión | Cómo |
|---|---|---|
| **Node.js** | **22.19+** | https://nodejs.org — recomendado vía `nvm` |
| **pnpm** | 9.15+ | `corepack enable` (viene con Node) o `npm i -g pnpm@9.15.0` |
| **Docker** | reciente | https://docs.docker.com/get-docker/ (para Postgres/Redis/MinIO) |
| **Cuenta Auth0** | — | https://auth0.com (gratis) — **el login es obligatorio** |
| `openssl` | cualquiera | ya viene en macOS/Linux — para generar secretos |

> El repo trae un `.nvmrc` con Node 22: `nvm use` lo toma solo, y el CI arranca de
> ese mismo archivo. Node 22.19 es un piso REAL, no una recomendación: `undici@8`
> (dependencia del cliente HTTP del API) lo exige. pnpm es obligatorio (`packageManager` lo
> fija); no uses npm/yarn para instalar el monorepo.

---

## 1. Clonar

```bash
git clone https://github.com/DamballahWedo99/CENZONTLE.git
cd CENZONTLE
```

> **No corras `pnpm install` todavía.** El `postinstall` del API ejecuta
> `prisma generate`, que carga `apps/api/prisma.config.ts`; ese archivo exige
> `DATABASE_URL` y aborta la instalación si no existe. Por eso el paso de
> variables de entorno va **antes** que la instalación. Si te saltas el orden,
> verás `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`
> — no está roto el repo, solo falta el `.env`.

---

## 2. Levantar los servicios locales (Docker)

El repo trae un `docker-compose.yml` que arranca **todo** lo que la app necesita
como infraestructura, con un comando:

```bash
docker compose up -d
```

Esto levanta:

| Servicio | Puerto | Credenciales dev |
|---|---|---|
| **PostgreSQL 16** | 5432 | `cenzontle` / `cenzontle_dev`, db `cenzontle` |
| **Redis 7** | 6379 | — (rate-limit + caché; degrada elegante si falta) |
| **MinIO** (S3) | 9000 (API), 9001 (consola) | `cenzontle` / `cenzontle_dev` |

Verifica que todo esté arriba:

```bash
docker compose ps -a
```

Los tres servicios de arriba deben aparecer con **STATUS `Up`** (o `running`, según
tu versión de Docker Compose). **No esperes ver `healthy`**: el `docker-compose.yml`
no define `healthcheck` en ningún servicio, así que Docker nunca reporta ese estado.

En esa lista aparece además un **cuarto** servicio, `minio-init`, en `Exited (0)`.
Es correcto: es un job de un solo uso que crea el bucket `cenzontle-documents` y
termina. Un `Exited (0)` ahí **no es un fallo** — es el trabajo hecho. Ojo con el
flag: `docker compose ps` **sin `-a`** lista solo los contenedores vivos, así que
`minio-init` no sale ahí y su ausencia tampoco es un problema.

> **¿Ya tienes Postgres nativo en :5432?** Cuidado con la "trampa dual" — lee
> [database.md › Postgres dual](database.md#postgres-dual-nativo-vs-docker).

---

## 3. Variables de entorno

Copia los templates:

```bash
cp apps/api/.env.example  apps/api/.env
cp apps/web/.env.example  apps/web/.env.local
```

Genera los secretos:

```bash
openssl rand -base64 32   # → VAULT_ENCRYPTION_KEY   (apps/api/.env)
openssl rand -hex 32      # → AUTH0_SECRET           (apps/web/.env.local)
openssl rand -hex 32      # → INTERNAL_API_KEY       (¡EL MISMO en api y web!)
```

Edita los dos archivos:

- **`apps/api/.env`** — `DATABASE_URL` ya viene correcto para Docker. Pega
  `VAULT_ENCRYPTION_KEY`, `INTERNAL_API_KEY`, y los `AUTH0_*` (paso 5).
- **`apps/web/.env.local`** — pega `AUTH0_*`, `AUTH0_SECRET`, y el **mismo**
  `INTERNAL_API_KEY` que pusiste en el API.

> `INTERNAL_API_KEY` debe ser **idéntico** en ambos: es el secreto compartido del
> BFF proxy (web → api). Si difieren, el frontend no puede hablar con la API.
>
> La lista completa de variables (qué es requerido, opcional, su default y para
> qué sirve) está en [configuration.md](configuration.md).

Ya con `apps/api/.env` en su lugar, instala las dependencias:

```bash
pnpm install
```

El `postinstall` del API corre `prisma generate` y deja el cliente listo. Necesita
leer `DATABASE_URL` del `.env` que acabas de crear — por eso este paso va aquí y no
al principio.

---

## 4. Migrar la base de datos

```bash
pnpm --filter @cenzontle/api exec prisma migrate deploy
```

Esto aplica todas las migraciones contra la BD de Docker. **Usa `migrate deploy`,
no `migrate dev`** (deploy solo aplica lo pendiente y nunca resetea). Más detalle
en [database.md](database.md).

> El `seed` (`prisma db seed`) **solo limpia tablas** — no crea datos. La data se
> crea desde la UI tras loguearte. Córrelo solo si quieres una BD vacía limpia.

---

## 5. Configurar Auth0 (obligatorio)

La app **falla cerrada (503) sin Auth0** — no hay bypass de dev. Necesitas crear,
en el [dashboard de Auth0](https://manage.auth0.com):

1. Una **API** (audience `https://api.cenzontle.app`).
2. Una **Regular Web Application** (callbacks a `http://localhost:3000/auth/callback`).
3. Una **post-login Action** que inyecta el `role` y `pod_ids` en el token.
4. Tu **primer usuario** con `app_metadata.role = "alta_gerencia"`.

Los valores van a los `AUTH0_*` de ambos `.env`. **Pasos exactos con capturas de
qué copiar dónde:** [auth0-setup.md](auth0-setup.md). Hazlo ahora y vuelve aquí.

---

## 6. Arrancar la app

```bash
pnpm dev
```

Esto compila `@cenzontle/shared` y levanta web + api en paralelo:

| URL | Qué es |
|---|---|
| **http://localhost:3000** | Frontend (te redirige al login de Auth0) |
| **http://localhost:3001** | API |
| **http://localhost:3001/api/docs** | Swagger (referencia de endpoints) |

Abre **http://localhost:3000**, inicia sesión con el usuario que creaste en Auth0,
y aterrigas en **`/proyectos`**. 🎉

---

## 7. Primer uso (post-login)

Como `AltaGerencia` puedes ahora, desde la UI:

- **Crear Pods, iniciativas, épicas e historias.**
- **Pegar tu API key de Anthropic** (Tokens IA / config) — se guarda **cifrada en
  la BD**, no en `.env`. Sin esto, los agentes de IA no generan.
- **Configurar el repo de GitHub** del Forge y del vault (Integraciones).
- **Generar un worker token** (Factory → Fleet) si vas a usar el Forge.

---

## 8. (Opcional) Levantar un worker del Forge

El Forge es opcional — la app de proyectos funciona sin él. Para procesar
historias con agentes de IA, levanta un worker.

> **En Linux, instala `firejail` antes** (`sudo apt install firejail`). Es la
> herramienta de sandbox del worker; sin ella el daemon arranca pero toda historia
> aborta. En macOS no instalas nada (`sandbox-exec` viene con el sistema).

```bash
# build del worker
pnpm --filter @cenzontle/worker build

# registra esta máquina como nodo de cómputo (token desde la UI: Factory → Fleet)
node apps/worker/dist/cli.js register \
  --dashboard http://localhost:3001 \
  --token worker_XXXXXXXX \
  --slots 1

# arranca el daemon (heartbeat + claim de historias)
node apps/worker/dist/cli.js start
```

Guía completa (sandbox, tmux/ttyd, gotchas): [forge-worker.md](forge-worker.md).

---

## Checklist de verificación

- [ ] `docker compose ps -a` muestra postgres + redis + minio en `Up` (y `minio-init` en `Exited (0)`)
- [ ] `apps/api/.env` y `apps/web/.env.local` existen y tienen los secretos
- [ ] `INTERNAL_API_KEY` es idéntico en ambos
- [ ] `prisma migrate deploy` corrió sin error
- [ ] Auth0 configurado + usuario admin con rol `alta_gerencia`
- [ ] `pnpm dev` levanta sin errores
- [ ] http://localhost:3000 → login → `/proyectos`
- [ ] http://localhost:3001/api/docs carga el Swagger

¿Algún paso falló? → [troubleshooting.md](troubleshooting.md).
