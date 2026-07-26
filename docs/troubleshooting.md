# Troubleshooting

Errores comunes al arrancar CENZONTLE y cómo resolverlos. Si tu caso no está
aquí, revisa los logs de `pnpm dev` (web y api) y el Swagger en
`http://localhost:3001/api/docs`.

---

## 503 al abrir la app

**Síntoma:** todas las rutas devuelven 503 / pantalla de error al abrir
`http://localhost:3000`.

**Causa:** Auth0 no está configurado. El middleware del web **falla cerrado** si
falta `AUTH0_DOMAIN`, `AUTH0_SECRET`, `AUTH0_CLIENT_ID` o `AUTH0_CLIENT_SECRET`.

**Solución:** completa `apps/web/.env.local` con todos los `AUTH0_*` y reinicia
`pnpm dev`. Ver [auth0-setup.md](auth0-setup.md).

---

## Entro pero todo es read-only / no puedo crear nada

**Causa:** el JWT no lleva el rol. O la post-login **Action no está desplegada**, o
tu usuario no tiene `app_metadata.role`.

**Solución:** despliega la Action (paso 3 de [auth0-setup.md](auth0-setup.md)) y
pon `{ "role": "alta_gerencia" }` en el `app_metadata` del usuario. Vuelve a
iniciar sesión (cierra sesión primero para refrescar el token).

---

## `relation "..." does not exist` / la API truena al consultar

**Causa:** migraciones sin aplicar (tablas no existen). Típico tras clonar o tras
agregar modelos nuevos.

**Solución:**
```bash
pnpm --filter @cenzontle/api exec prisma migrate deploy
```
Si agregaste modelos y el proceso ya corría, **reinicia `pnpm dev`** para que el
cliente Prisma recargado vea las tablas. Ver [database.md](database.md).

---

## `Environment variable not found: DATABASE_URL`

**Causa:** falta `apps/api/.env` o no tiene `DATABASE_URL`.

**Solución:** `cp apps/api/.env.example apps/api/.env` y verifica que
`DATABASE_URL` apunte a tu Postgres (Docker: el valor por default ya sirve).

---

## `Can't reach database server at localhost:5432`

**Causa:** Postgres no está arriba, o hay conflicto de puerto.

**Solución:**
```bash
docker compose up -d postgres
docker compose ps          # confirma que está "running"
lsof -i :5432              # ¿hay un Postgres NATIVO ocupando el puerto?
```
Si tienes Postgres nativo y Docker peleando por `:5432`, lee
[database.md › Postgres dual](database.md). Resumen: usa uno solo, o mapea el
contenedor a `:5433` y ajusta `DATABASE_URL`.

---

## El frontend carga pero las llamadas a la API fallan (401/403/proxy)

**Causa:** `INTERNAL_API_KEY` no coincide entre `apps/web/.env.local` y
`apps/api/.env`. Es el secreto compartido del BFF proxy.

**Solución:** pon el **mismo** valor en ambos y reinicia. Genera uno con
`openssl rand -hex 32`.

---

## Los agentes de IA no generan (épicas/historias/diagramas)

**Causa:** falta la API key de Anthropic. Aunque pongas `ANTHROPIC_API_KEY` en
`.env`, el backend prioriza la key **guardada en BD** (cifrada).

**Solución:** loguéate como AltaGerencia y pega la key en la UI (Tokens IA /
config de Anthropic). Se cifra server-side con `VAULT_ENCRYPTION_KEY`.

---

## Error de cifrado / no puedo guardar tokens o la key de Anthropic

**Causa:** falta `VAULT_ENCRYPTION_KEY` en `apps/api/.env`.

**Solución:** genera una y reinicia:
```bash
openssl rand -base64 32   # pégala en VAULT_ENCRYPTION_KEY
```
No la cambies después de cifrar datos: rotarla invalida lo ya cifrado.

---

## `pnpm install` falla o usa el package manager equivocado

**Causa:** el repo fija `packageManager: pnpm@9.15.0`. npm/yarn no instalan bien el
monorepo.

**Solución:** `corepack enable` (trae pnpm con Node) o `npm i -g pnpm@9.15.0`,
luego `pnpm install`.

---

## `prisma generate` / tipos de Prisma desactualizados

**Causa:** el cliente Prisma no se regeneró tras cambiar el schema.

**Solución:** `pnpm --filter @cenzontle/api exec prisma generate` y reinicia el
dev server (un proceso Node vivo cachea el cliente viejo en memoria).

---

## El worker no conecta (401 / 404 / http rechazado)

- **401** → token inválido o revocado: genera otro en la UI (Fleet) y re-registra.
- **404** → el nodo fue retirado: vuelve a `register`.
- **http rechazado** → en dev local añade `FACTORY_WORKER_ALLOW_INSECURE=1`.

Ver [forge-worker.md](forge-worker.md).

---

## El worker está online pero ninguna historia avanza (`Sandbox unavailable`)

**Síntoma:** `factory-worker start` arranca sin errores y el nodo aparece **online**
en Fleet, pero toda historia que reclama muere de inmediato. En los logs del worker:

```
Sandbox unavailable — aborting run before spawn
No sandbox available on linux and FACTORY_WORKER_ALLOW_NO_SANDBOX is not '1'.
```

**Causa:** falta la herramienta de sandbox. El worker envuelve cada spawn de
`claude` con `sandbox-exec` (macOS) o `firejail` (Linux); si no encuentra ninguna,
el modo resuelve a `none` y **se niega a ejecutar**. Es deliberado: `claude` corre
con `--dangerously-skip-permissions`, y sin aislamiento un prompt injection en el
markdown de la épica puede leer `~/.ssh`, `~/.aws` o `~/.config/gh` del host.

Confunde porque el chequeo pasa **al spawnear cada run**, no al arrancar el daemon
— por eso el nodo se ve sano.

**Solución (Linux):** instala firejail y reinicia el worker.

```bash
sudo apt install firejail     # Debian/Ubuntu
sudo dnf install firejail     # Fedora
sudo pacman -S firejail       # Arch
```

En macOS `sandbox-exec` viene con el sistema; si igual ves el error, revisa que
`FACTORY_WORKER_SANDBOX_MODE` no esté forzado a `none`.

> **No lo "arregles" con `FACTORY_WORKER_ALLOW_NO_SANDBOX=1`.** Esa variable existe
> para dev desechable y desactiva el único control de aislamiento del proyecto.
> Detalle: [forge-worker.md › Sandbox](forge-worker.md#sandbox-ejecución-de-código-generado).

---

## `FACTORY_WORKER_SANDBOX_MODE` no parece tener efecto

**Causa:** el valor no es uno de los tres aceptados. El worker sólo reconoce
`sandbox-exec`, `firejail` y `none` **exactos**; cualquier otra cosa (un typo, o un
valor que no existe como `nix`) se **ignora en silencio** y cae al auto-detect.

**Solución:** corrige el valor. Al arrancar un run, el log dice qué modo quedó
activo y de dónde salió (`source: env_override` vs `auto_detect`).

---

## El proxy del frontend devuelve 401 o 502

Los devuelve el BFF de Next (`/api/proxy/...`), no el backend:

- **401 `No access token in session`** → la sesión de Auth0 no trae access token.
  Casi siempre es el `AUTH0_AUDIENCE`: debe ser **idéntico** en `apps/web/.env.local`
  y `apps/api/.env`, y coincidir con el Identifier de la API en Auth0. Cierra sesión
  y vuelve a entrar tras corregirlo.
- **401 `Not authenticated — session expired`** → la sesión caducó; vuelve a loguearte.
- **503 `Authentication service not configured`** → faltan los `AUTH0_*` en el web
  (mismo caso que el 503 de arriba).
- **502 `Proxy error: backend unreachable`** → la API no está arriba o
  `API_INTERNAL_URL` apunta al lugar equivocado. Revisa que `pnpm dev:api` esté
  corriendo en el puerto que dice esa variable; la consola del web imprime la causa
  real (`ECONNREFUSED`, `ENOTFOUND`, …) con el prefijo `[proxy] fetch error`.

---

## Branding / upload de assets falla

**Causa:** MinIO/S3 no configurado o el bucket no existe.

**Solución:** `docker compose up -d minio minio-init` (el init crea el bucket
`cenzontle-documents`). En prod, configura `S3_*` apuntando a AWS S3 o R2.

---

## Redis warnings en los logs

**No es crítico.** Si Redis no está, el rate-limiter **falla-abierto** (no bloquea)
y el caché de propuestas hace miss. Para silenciarlo: `docker compose up -d redis`.

---

## El puerto 3000 o 3001 ya está en uso

**Causa:** otra instancia corriendo.

**Solución:** mata el proceso (`lsof -i :3000` / `:3001` → `kill <pid>`) o cambia
`PORT` (api) / el puerto de Next (`next dev -p 3002`, ajustando las URLs de Auth0
y `NEXT_PUBLIC_API_URL`/`CORS_ORIGIN`).
